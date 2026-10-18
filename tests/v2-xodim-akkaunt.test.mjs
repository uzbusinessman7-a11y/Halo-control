import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* Xodim akkaunti: bir oynada ochish + xodimga bog'lash, filialni noto'g'ri tanlasa ham kirish, xato akkaunt/xodimni o'chirish. */
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
const sozlamalar = await import('../app/api/v2/sozlamalar/route.ts');
const maosh = await import('../app/api/v2/maosh/route.ts');
const attendance = await import('../app/api/attendance/route.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const { createHaloBranch } = await import('../app/lib/halo-store.ts');
const base = 'https://halo.example.workers.dev';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const call = async (mod, path, body) => { const r = await mod.POST(new Request(base + path, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: r.status, ...(await r.json()) }; };
const akk = (body) => call(sozlamalar, '/api/v2/sozlamalar', body);
const state = (id = 'main') => JSON.parse(sqlite.prepare('SELECT payload FROM app_state WHERE id = ?').get(id).payload);
const accounts = () => sqlite.prepare('SELECT id, name, username, branch_id FROM halo_worker_users ORDER BY name').all();
const attendanceOf = async (cookie) => (await attendance.GET(new Request(base + '/api/attendance', { headers: { cookie } }))).json();

test('sahifa skripti buzilmagan', async () => {
  const html = await (await sozlamalar.GET(new Request(base + '/api/v2/sozlamalar?b=akkaunt', { headers: owner }))).text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /action:'createAccount'/);
  assert.match(script, /data-del=/);
  // Ismdan login yasash (brauzerdagi funksiya).
  const fn = new vm.Script(script.match(/function loginFrom[\s\S]*?\.slice\(0,32\)\}/)[0] + '; [loginFrom("O‘tkir"), loginFrom("G‘ayrat Ali"), loginFrom("Жасур"), loginFrom("Шахзод")]');
  assert.deepEqual(JSON.parse(JSON.stringify(fn.runInNewContext({}))), ['otkir', 'gayratali', 'jasur', 'shaxzod']);
});

test('bir oynada: yangi xodim (Maosh’ga ham) + akkaunt + bog‘lanish → xodim darrov davomat qila oladi', async () => {
  const p = state(); p.staff = [{ id: 'old-1', name: 'Lola', payType: 'hourly', hourlyRate: 10_000, active: true }]; p.workShifts = [];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  // Noto'g'ri ma'lumot — hech narsa yaratilmaydi.
  assert.equal((await akk({ action: 'createAccount', name: 'Sardor', username: 'sardor', pin: '1234', staffId: 'new', payType: 'hourly', rate: 0 })).status, 400, 'stavkasiz yangi xodim');
  const badLogin = await akk({ action: 'createAccount', name: 'O‘tkir', username: 'o‘tkir', pin: '1234', staffId: 'new', payType: 'hourly', rate: 11_000 });
  assert.equal(badLogin.status, 400);
  assert.match(badLogin.error, /lotin/);
  assert.deepEqual([accounts().length, state().staff.length], [0, 1], 'xato bo‘lsa na akkaunt, na xodim yaratildi');

  const ok = await akk({ action: 'createAccount', name: 'Sardor', username: 'sardor', pin: '1234', staffId: 'new', payType: 'hourly', rate: 11_000 });
  assert.equal(ok.status, 200);
  assert.equal(ok.created.staffName, 'Sardor');
  const sardor = state().staff.find((m) => m.name === 'Sardor');
  assert.deepEqual([sardor.payType, sardor.hourlyRate, sardor.workerId], ['hourly', 11_000, ok.created.workerId]);
  const cookie = (await loginWorker('main', 'sardor', '1234')).cookie.split(';')[0];
  const view = await attendanceOf(cookie);
  assert.deepEqual([view.linked, view.member.name], [true, 'Sardor'], 'akkaunt xodimga bog‘langan — «bog‘lamagan» xabari chiqmaydi');

  // Bor xodimga (Lola) akkaunt.
  const lola = await akk({ action: 'createAccount', name: 'Lola', username: 'lola', pin: '5678', staffId: 'old-1' });
  assert.equal(lola.status, 200);
  assert.equal(state().staff.find((m) => m.id === 'old-1').workerId, lola.created.workerId);
  assert.equal((await akk({ action: 'createAccount', name: 'Lola 2', username: 'lola2', pin: '5678', staffId: 'old-1' })).status, 400, 'bog‘langan xodimga ikkinchi akkaunt — yo‘q');
  assert.equal(accounts().length, 2);
});

test('filialni noto‘g‘ri tanlasa ham kiradi (login faqat bitta filialda bo‘lsa); PIN baribir tekshiriladi', async () => {
  const branch = await createHaloBranch('Ikkinchi filial');
  await createWorkerAccount(branch.id, 'Jasur', 'jasur', '4321');
  const r = await loginWorker('main', 'jasur', '4321');
  assert.equal(r.branchId, branch.id, 'asosiy filial tanlangan, lekin jasur ikkinchi filialda — o‘sha yerga kirdi');
  await assert.rejects(loginWorker('main', 'jasur', '0000'), /Login yoki PIN noto‘g‘ri/);
  // Login ikki filialda ham bo'lsa — tanlangan filial qoladi.
  await createWorkerAccount('main', 'Jasur A', 'jasur', '1111');
  assert.equal((await loginWorker('main', 'jasur', '1111')).branchId, 'main');
  await assert.rejects(loginWorker('main', 'jasur', '4321'), /Login yoki PIN noto‘g‘ri/);
});

test('xato akkauntni o‘chirish: login bo‘shaydi, bog‘lanish uziladi, xodim va yozuvlari qoladi; vazifasi bori o‘chmaydi', async () => {
  const before = accounts().find((a) => a.username === 'sardor');
  const del = await akk({ action: 'deleteAccount', workerId: before.id });
  assert.equal(del.status, 200);
  assert.equal(accounts().some((a) => a.id === before.id), false);
  assert.equal(state().staff.some((m) => m.name === 'Sardor'), false, 'akkaunt bilan birga ochilgan, yozuvsiz profil ham o‘chdi');
  await assert.rejects(loginWorker('main', 'sardor', '1234'), /Login yoki PIN noto‘g‘ri/);
  // Bor xodimning (Lola) akkaunti o'chsa — profil qoladi, faqat bog'lanish uziladi.
  const lolaAcc = accounts().find((acc) => acc.username === 'lola');
  assert.equal((await akk({ action: 'deleteAccount', workerId: lolaAcc.id })).status, 200);
  const lola = state().staff.find((m) => m.id === 'old-1');
  assert.deepEqual([Boolean(lola), lola.workerId], [true, ''], 'oldindan bor xodim profili qoldi');
  // Ish kuni bor, akkaunt bilan ochilgan profil ham qoladi.
  const withShift = await akk({ action: 'createAccount', name: 'Sardor', username: 'sardor', pin: '2222', staffId: 'new', payType: 'hourly', rate: 10_000 });
  const p2 = state(); const prof = p2.staff.find((m) => m.workerId === withShift.created.workerId);
  p2.workShifts = [{ id: 'sx', staffId: prof.id, date: '2026-10-02', clockIn: '2026-10-02T01:00:00.000Z', clockOut: '2026-10-02T05:00:00.000Z', breakMinutes: 0, source: 'owner', status: 'closed' }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p2));
  assert.equal((await akk({ action: 'deleteAccount', workerId: withShift.created.workerId })).status, 200);
  assert.equal(state().staff.some((m) => m.id === prof.id), true, 'yozuvi bor profil o‘chmaydi');
  const sardor = state().staff.find((m) => m.id === prof.id);
  const again = await akk({ action: 'createAccount', name: 'Sardor', username: 'sardor', pin: '2222', staffId: sardor.id });
  assert.equal(again.status, 200, 'o‘sha login qayta ishlatildi');
  // Vazifa berilgan akkaunt o'chirilmaydi.
  sqlite.exec("CREATE TABLE IF NOT EXISTS halo_worker_tasks (id TEXT PRIMARY KEY, worker_id TEXT)");
  sqlite.prepare("INSERT INTO halo_worker_tasks (id, worker_id) VALUES ('t1', ?)").run(again.created.workerId);
  const refused = await akk({ action: 'deleteAccount', workerId: again.created.workerId });
  assert.equal(refused.status, 400);
  assert.match(refused.error, /vazifa berilgan.*To‘xtatish/);
  assert.equal((await akk({ action: 'deleteAccount', workerId: 'yomon' })).status, 400);
});

test('Maosh: yozuvsiz xodim o‘chadi; ish kuni bor xodim — yo‘q', async () => {
  const p = state();
  p.staff.push({ id: 'oops', name: 'Xato kiritilgan', payType: 'hourly', hourlyRate: 9_000, active: true });
  p.workShifts = [...(p.workShifts || []), { id: 's1', staffId: 'old-1', date: '2026-10-01', clockIn: '2026-10-01T01:00:00.000Z', clockOut: '2026-10-01T09:00:00.000Z', breakMinutes: 0, source: 'owner', status: 'closed' }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const op = '00000000-0000-4000-8000-000000000001';
  const ok = await call(maosh, '/api/v2/maosh', { action: 'deleteStaff', id: 'oops', operationId: op });
  assert.equal(ok.status, 200);
  assert.equal(state().staff.some((m) => m.id === 'oops'), false);
  const used = await call(maosh, '/api/v2/maosh', { action: 'deleteStaff', id: 'old-1', operationId: op });
  assert.equal(used.status, 409);
  assert.match(used.error, /1 ta yozuv bor.*Ishlayapti/);
  assert.equal(state().staff.some((m) => m.id === 'old-1'), true);
  const html = await (await maosh.GET(new Request(base + '/api/v2/maosh', { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /id="fDel"/);
});
