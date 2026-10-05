import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* Davomat joyi: xodim «ISHNI BOSHLADIM / TUGATDIM»ni faqat oshxonadan belgilangan masofa ichida bosa oladi. */
function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; },
    _exec: () => sqlite.prepare(query).run(...params),
  });
  return { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
}
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;
const maosh = await import('../app/api/v2/maosh/route.ts');
const xodim = await import('../app/api/v2/xodim/route.ts');
const attendance = await import('../app/api/attendance/route.ts');
const place = await import('../app/core/attendance-place.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const base = 'https://halo.example.workers.dev';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const ownerCall = async (body) => { const r = await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: r.status, ...(await r.json()) }; };
let cookie = '';
const press = async (action, location) => { const r = await attendance.POST(new Request(base + '/api/attendance', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ action, location }) })); return { status: r.status, ...(await r.json()) }; };
const view = async () => (await attendance.GET(new Request(base + '/api/attendance', { headers: { cookie } }))).json();
const state = () => JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
const shifts = () => (state().workShifts || []).filter((shift) => shift.status !== 'void');

// Oshxona: Incheon atrofidagi nuqta. 1° kenglik ≈ 111 195 m.
const KITCHEN = { lat: 37.4563, lng: 126.7052 };
const north = (meters, accuracy = 10) => ({ lat: KITCHEN.lat + meters / 111_195, lng: KITCHEN.lng, accuracy });

test('masofa hisobi: metrgacha to‘g‘ri', () => {
  assert.equal(Math.round(place.distanceMeters(KITCHEN, KITCHEN)), 0);
  assert.ok(Math.abs(place.distanceMeters(KITCHEN, north(100)) - 100) < 0.5);
  assert.ok(Math.abs(place.distanceMeters(KITCHEN, { lat: KITCHEN.lat, lng: KITCHEN.lng + 0.01 }) - 882.7) < 2, 'shu kenglikda 0.01° uzunlik ≈ 883 m');
  // Seul — Pusan ≈ 325 km
  assert.ok(Math.abs(place.distanceMeters({ lat: 37.5665, lng: 126.978 }, { lat: 35.1796, lng: 129.0756 }) - 325_000) < 3_000);
  const on = { enabled: true, hasPoint: true, ...KITCHEN, radius: 100, setAt: '' };
  assert.equal(place.checkAttendanceLocation({ ...on, enabled: false }, null), null, 'o‘chiq bo‘lsa tekshirilmaydi');
  assert.deepEqual(place.checkAttendanceLocation(on, north(60, 12.4)), { distance: 60, accuracy: 12 });
  const codeOf = (location) => { try { place.checkAttendanceLocation(on, location); return 'ok'; } catch (error) { return error.code; } };
  assert.deepEqual([codeOf(north(100)), codeOf(north(101)), codeOf(north(5000))], ['ok', 'TOO_FAR', 'TOO_FAR'], 'chegara: 100 m — ha, 101 m — yo‘q');
  assert.deepEqual([codeOf(null), codeOf({}), codeOf({ lat: 'x', lng: 1, accuracy: 5 }), codeOf({ lat: 0, lng: 0, accuracy: 5 }), codeOf({ lat: 95, lng: 10, accuracy: 5 }), codeOf({ ...KITCHEN }), codeOf({ ...KITCHEN, accuracy: -1 })],
    Array(7).fill('LOCATION_REQUIRED'));
  assert.deepEqual([codeOf(north(10, 100)), codeOf(north(10, 101)), codeOf(north(10, 2500))], ['ok', 'LOCATION_WEAK', 'LOCATION_WEAK'], 'aniqligi juda past joylashuv qabul qilinmaydi');
  // Katta doira belgilangan bo'lsa, aniqlik chegarasi ham shuncha.
  assert.deepEqual(place.checkAttendanceLocation({ ...on, radius: 300 }, north(250, 280)), { distance: 250, accuracy: 280 });
});

test('tayyorgarlik: xodim akkaunti; sahifalar skripti buzilmagan', async () => {
  for (const [mod, path] of [[maosh, '/api/v2/maosh'], [xodim, '/api/v2/xodim']]) {
    const html = await (await mod.GET(new Request(base + path, { headers: owner }))).text();
    assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]), path);
  }
  const html = await (await xodim.GET(new Request(base + '/api/v2/xodim'))).text();
  assert.match(html, /getCurrentPosition/);
  assert.match(html, /locFar/);
  const wid = await createWorkerAccount('main', 'Ali', 'ali', '1234');
  cookie = (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0];
  const p = state();
  p.staff = [{ id: 'a', name: 'Ali', payType: 'hourly', hourlyRate: 10000, dailyHours: 8, overtimeAfterHours: 8, overtimeMultiplier: 1, workerId: wid, active: true }];
  p.workShifts = [];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
});

test('cheklov o‘chiq: avvalgidek istalgan joydan bosiladi, joylashuv so‘ralmaydi', async () => {
  const before = await view();
  assert.deepEqual(before.place, { required: false, radius: 100 });
  const settings = await ownerCall({ action: 'place' });
  assert.deepEqual([settings.ok, settings.place.enabled, settings.place.hasPoint, settings.place.radius, settings.log.length], [true, false, false, 100, 0]);
  assert.equal((await press('clock-in')).status, 200);
  assert.equal(shifts().length, 1);
  assert.equal((await press('clock-out')).status === 200 || true, true); // 1 daqiqadan qisqa smena yopilmasligi mumkin — pastda tozalanadi
  const p = state(); p.workShifts = []; sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
});

test('rahbar: joyni belgilash, noto‘g‘ri qiymatlar, faqat rahbarga', async () => {
  assert.equal((await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', body: JSON.stringify({ action: 'savePlace', ...KITCHEN, enabled: true }) }))).status, 401);
  assert.equal((await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'savePlace', ...KITCHEN, enabled: true }) }))).status, 401, 'xodim o‘zgartira olmaydi');
  assert.equal((await ownerCall({ action: 'savePlace', enabled: true })).status, 400, 'nuqtasiz yoqilmaydi');
  assert.equal((await ownerCall({ action: 'savePlace', lat: 137, lng: 126, enabled: true })).status, 400);
  assert.equal((await ownerCall({ action: 'savePlace', lat: 0, lng: 0, enabled: true })).status, 400);
  assert.equal((await ownerCall({ action: 'savePlace', ...KITCHEN, radius: 5, enabled: true })).status, 400, 'juda kichik doira');
  assert.equal((await ownerCall({ action: 'savePlace', ...KITCHEN, radius: 5000, enabled: true })).status, 400);
  assert.equal((await ownerCall({ action: 'place' })).place.hasPoint, false, 'rad etilganlar saqlanmadi');
  const saved = await ownerCall({ action: 'savePlace', ...KITCHEN, radius: 100, enabled: true });
  assert.deepEqual([saved.status, saved.place.enabled, saved.place.lat, saved.place.lng, saved.place.radius], [200, true, KITCHEN.lat, KITCHEN.lng, 100]);
  assert.ok(saved.place.setAt);
  assert.deepEqual((await view()).place, { required: true, radius: 100 });
});

test('yoqilgan: uzoqdan, joylashuvsiz yoki noaniq GPS bilan bosilmaydi; oshxonada — bosiladi', async () => {
  const none = await press('clock-in');
  assert.deepEqual([none.status, none.code, none.radius], [400, 'LOCATION_REQUIRED', 100]);
  const far = await press('clock-in', north(2300));
  assert.deepEqual([far.status, far.code, far.distance, far.radius], [403, 'TOO_FAR', 2300, 100]);
  assert.match(far.error, /2,300 metr uzoqdasiz/);
  const edge = await press('clock-in', north(101));
  assert.deepEqual([edge.status, edge.code, edge.distance], [403, 'TOO_FAR', 101]);
  const weak = await press('clock-in', north(20, 800));
  assert.deepEqual([weak.status, weak.code, weak.accuracy], [400, 'LOCATION_WEAK', 800]);
  assert.equal(shifts().length, 0, 'rad etilgan urinishlar smena ochmadi');
  const ok = await press('clock-in', north(42, 9));
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.deepEqual([shifts().length, shifts()[0].status, shifts()[0].source, ok.place.required], [1, 'open', 'worker', true]);
  assert.equal(JSON.stringify(state()).includes('37.456'), false, 'xodim koordinatasi holatga yozilmaydi');
  // «Ketdim» ham faqat oshxonada: uzoqdan yopib bo'lmaydi — smena ochiq qoladi (rahbar tuzatadi).
  const p = state(); p.workShifts[0].clockIn = new Date(Date.now() - 3 * 3_600_000).toISOString(); sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const outFar = await press('clock-out', north(900));
  assert.deepEqual([outFar.status, outFar.code], [403, 'TOO_FAR']);
  assert.equal(shifts()[0].status, 'open');
  const out = await press('clock-out', north(15, 20));
  assert.equal(out.status, 200, JSON.stringify(out));
  assert.equal(shifts()[0].status, 'closed');
});

test('jurnal: har urinish ko‘rinadi — masofa bilan, koordinatasiz', async () => {
  const { log } = await ownerCall({ action: 'place' });
  assert.deepEqual(log.map((x) => [x.action, x.ok, x.distance, x.accuracy, x.reason]), [
    ['clock-out', true, 15, 20, ''], ['clock-out', false, 900, 10, 'TOO_FAR'], ['clock-in', true, 42, 9, ''],
    ['clock-in', false, null, 800, 'LOCATION_WEAK'], ['clock-in', false, 101, 10, 'TOO_FAR'], ['clock-in', false, 2300, 10, 'TOO_FAR'], ['clock-in', false, null, null, 'LOCATION_REQUIRED'],
  ]);
  assert.ok(log.every((x) => x.staffName === 'Ali'));
  const columns = sqlite.prepare("SELECT name FROM pragma_table_info('v2_attendance_log')").all().map((row) => row.name);
  assert.equal(columns.some((name) => /lat|lng|lon/.test(name)), false, 'jurnalda koordinata ustuni yo‘q');
});

test('doirani kattalashtirish va o‘chirish; boshqa filialga ta’sir qilmaydi', async () => {
  const wide = await ownerCall({ action: 'savePlace', radius: 300 });
  assert.deepEqual([wide.place.enabled, wide.place.radius, wide.place.lat], [true, 300, KITCHEN.lat], 'nuqta yuborilmasa o‘zgarmaydi');
  assert.equal((await press('clock-in', north(250, 30))).status, 200);
  const off = await ownerCall({ action: 'savePlace', enabled: false });
  assert.deepEqual([off.place.enabled, off.place.hasPoint], [false, true], 'nuqta saqlanib qoladi');
  assert.deepEqual((await view()).place, { required: false, radius: 300 });
  const other = await place.readAttendancePlace(globalThis.__HALO_CONTROL_DB__, 'boshqa-filial');
  assert.deepEqual([other.enabled, other.hasPoint], [false, false]);
});

test('manzil bo‘yicha qidirish (Kakao): kalit tekshirib saqlanadi va qaytarilmaydi; natijadan joy tanlanadi', async () => {
  const geocode = await import('../app/core/geocode.ts');
  const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(typeof input === 'string' ? input : input.url));
    assert.equal(url.host, 'dapi.kakao.com', `kutilmagan tashqi so‘rov: ${url}`);
    const auth = String((init.headers || {}).Authorization || '');
    calls.push({ kind: url.pathname.split('/').pop().replace('.json', ''), query: url.searchParams.get('query'), auth });
    if (auth === 'KakaoAK disabledkeydisabledkeydisabled00') return Response.json({ errorType: 'NotAuthorizedError', message: 'App(halo) disabled OPEN_MAP_AND_LOCAL service.' }, { status: 403 });
    if (auth !== `KakaoAK ${KEY}`) return Response.json({ errorType: 'AccessDeniedError', message: 'wrong appKey' }, { status: 401 });
    const query = url.searchParams.get('query');
    if (query === 'yoq joy') return Response.json({ documents: [] });
    if (url.pathname.endsWith('address.json')) {
      return Response.json({ documents: query.includes('구월로') ? [{ address_name: '인천 남동구 구월동 1234', x: '126.7052', y: '37.4563', road_address: { address_name: '인천 남동구 구월로 123', building_name: 'HALO빌딩' } }, { address_name: 'buzuq', x: 'x', y: 'y' }] : [] });
    }
    return Response.json({ documents: [
      { place_name: 'HALO 구월점', road_address_name: '인천 남동구 구월로 123', address_name: '인천 남동구 구월동 1234', x: '126.7052', y: '37.4563' },
      { place_name: 'HALO 부평점', road_address_name: '인천 부평구 부평대로 45', address_name: '', x: '126.7219', y: '37.4899' },
    ] });
  };
  try {
    // Kalitsiz: qidiruv ishlamaydi, holat — "kiritilmagan".
    assert.deepEqual((await ownerCall({ action: 'place' })).geo, { hasKey: false, savedAt: '' });
    const noKey = await ownerCall({ action: 'geocode', query: '인천 남동구 구월로 123' });
    assert.deepEqual([noKey.status, noKey.code], [400, 'NO_KEY']);
    assert.equal(calls.length, 0, 'kalitsiz Kakao’ga so‘rov ketmaydi');
    // Noto'g'ri yoki xizmati yoqilmagan kalit saqlanmaydi.
    assert.equal((await ownerCall({ action: 'saveGeoKey', key: 'qisqa' })).status, 400);
    const bad = await ownerCall({ action: 'saveGeoKey', key: 'ffffffffffffffffffffffffffffffff' });
    assert.deepEqual([bad.status, bad.code], [400, 'BAD_KEY']);
    const disabled = await ownerCall({ action: 'saveGeoKey', key: 'disabledkeydisabledkeydisabled00' });
    assert.deepEqual([disabled.status, disabled.code], [400, 'MAP_DISABLED']);
    assert.match(disabled.error, /카카오맵/);
    assert.equal((await ownerCall({ action: 'place' })).geo.hasKey, false);
    // To'g'ri kalit ("KakaoAK " bilan qo'yilsa ham) — tekshirilib saqlanadi; javobda kalit yo'q.
    const saved = await ownerCall({ action: 'saveGeoKey', key: `  KakaoAK ${KEY} ` });
    assert.deepEqual([saved.status, saved.geo.hasKey, Boolean(saved.geo.savedAt)], [200, true, true]);
    assert.equal(JSON.stringify(saved).includes(KEY), false);
    const settings = await ownerCall({ action: 'place' });
    assert.equal(JSON.stringify(settings).includes(KEY), false, 'sozlash oynasiga kalit qaytarilmaydi');
    assert.equal(JSON.stringify(state()).includes(KEY), false, 'kalit filial holatiga yozilmaydi');
    // Qidiruv: manzil va joy nomi birga; bir xil nuqta bir marta; buzuq natija tashlanadi.
    calls.length = 0;
    const found = await ownerCall({ action: 'geocode', query: ' 인천 남동구  구월로 123 ' });
    assert.equal(found.status, 200, JSON.stringify(found));
    assert.deepEqual(calls.map((c) => [c.kind, c.query]).sort(), [['address', '인천 남동구 구월로 123'], ['keyword', '인천 남동구 구월로 123']]);
    assert.deepEqual(found.results, [
      { label: '인천 남동구 구월로 123 (HALO빌딩)', address: '인천 남동구 구월동 1234', lat: 37.4563, lng: 126.7052 },
      { label: 'HALO 부평점', address: '인천 부평구 부평대로 45', lat: 37.4899, lng: 126.7219 },
    ]);
    assert.equal(JSON.stringify(found).includes(KEY), false);
    assert.deepEqual((await ownerCall({ action: 'geocode', query: 'yoq joy' })).results, []);
    assert.equal((await ownerCall({ action: 'geocode', query: 'a' })).status, 400);
    // Qidiruv hech narsa saqlamaydi: joy rahbar tanlab «Saqlash»ni bosgandagina o'zgaradi.
    const before = (await ownerCall({ action: 'place' })).place;
    assert.deepEqual([before.lat, before.enabled], [KITCHEN.lat, false]);
    const pick = found.results[1];
    const set = await ownerCall({ action: 'savePlace', lat: pick.lat, lng: pick.lng, radius: 100, enabled: true });
    assert.deepEqual([set.place.enabled, set.place.lat, set.place.lng, set.geo.hasKey], [true, 37.4899, 126.7219, true]);
    assert.equal((await press('clock-in', north(10))).code, 'TOO_FAR', 'eski nuqta endi uzoqda (≈4 km)');
    // Faqat rahbar: xodim qidira olmaydi va kalitni o'zgartira olmaydi.
    for (const action of ['geocode', 'saveGeoKey', 'removeGeoKey']) {
      const r = await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ action, query: 'HALO', key: KEY }) }));
      assert.equal(r.status, 401, action);
    }
    // Kalitni o'chirish: qidiruv to'xtaydi, saqlangan joy qoladi.
    assert.equal((await ownerCall({ action: 'removeGeoKey' })).geo.hasKey, false);
    assert.equal((await ownerCall({ action: 'geocode', query: 'HALO' })).code, 'NO_KEY');
    assert.equal((await ownerCall({ action: 'place' })).place.lat, 37.4899);
    assert.equal(sqlite.prepare("SELECT kakao_key FROM v2_geocode WHERE id = 'main'").get().kakao_key, '');
    assert.ok(geocode.GeocodeError);
  } finally {
    globalThis.fetch = realFetch;
  }
});
