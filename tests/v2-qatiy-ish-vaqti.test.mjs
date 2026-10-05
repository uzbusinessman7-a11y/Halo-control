import './helpers/ts-resolve.mjs';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* Qat'iy ish vaqti: xodim erta kelib «ISHNI BOSHLADIM»ni bossa ham, haq rahbar belgilagan vaqtdan hisoblanadi. */
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
const hours = await import('../app/core/work-hours.ts');
const staffCore = await import('../app/core/staff.ts');
const payroll = await import('../app/lib/payroll.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const base = 'https://halo.example.workers.dev';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const ownerCall = async (body) => { const r = await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: r.status, ...(await r.json()) }; };
let cookie = '';
const press = async (action) => { const r = await attendance.POST(new Request(base + '/api/attendance', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ action }) })); return { status: r.status, ...(await r.json()) }; };
const view = async () => (await attendance.GET(new Request(base + '/api/attendance', { headers: { cookie } }))).json();
const state = () => JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
const put = (p) => sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
const shifts = () => (state().workShifts || []).filter((shift) => shift.status !== 'void');
/** Seul vaqti → aniq lahza. */
const kst = (date, time) => new Date(`${date}T${time}:00+09:00`);
const member = (extra = {}) => payroll.normalizeStaff([{ id: 'a', name: 'Ali', payType: 'hourly', hourlyRate: 10_000, workDays: 26, dailyHours: 12, overtimeAfterHours: 18, overtimeMultiplier: 1, active: true, ...extra }])[0];

test('tugash vaqti yozilmagan — «boshlanish + 18 soat» sifatida saqlanadi, rahbarga bo‘sh ko‘rinadi', () => {
  assert.deepEqual(['11:00', '06:00', '23:30', '00:00'].map(hours.openEndFor), ['05:00', '00:00', '17:30', '18:00']);
  assert.deepEqual(hours.workHoursOf(member()), { start: '', end: '' });
  assert.deepEqual(hours.workHoursOf(member({ scheduledStartTime: '11:00', scheduledEndTime: '05:00' })), { start: '11:00', end: '' });
  assert.deepEqual(hours.workHoursOf(member({ scheduledStartTime: '11:00', scheduledEndTime: '23:00' })), { start: '11:00', end: '23:00' });
});

test('saqlash: noto‘g‘ri vaqt qabul qilinmaydi; bitta xato — hech biri saqlanmaydi; smenalarga tegilmaydi', () => {
  const old = { id: 's0', staffId: 'a', date: '2026-10-01', clockIn: kst('2026-10-01', '10:00').toISOString(), clockOut: kst('2026-10-01', '22:00').toISOString(), breakMinutes: 0, hourlyRateAtShift: 10_000, source: 'worker', status: 'closed' };
  const st = { staff: [{ id: 'a', name: 'Ali', payType: 'hourly', hourlyRate: 10_000, active: true, workerId: 'w1' }, { id: 'b', name: 'Vali', payType: 'hourly', hourlyRate: 9_000, active: true }, { id: 'c', name: 'Ketgan', payType: 'hourly', hourlyRate: 9_000, active: false }], workShifts: [old] };
  assert.deepEqual(hours.workHoursList(st), [{ id: 'a', name: 'Ali', start: '', end: '', hasAccount: true }, { id: 'b', name: 'Vali', start: '', end: '', hasAccount: false }], 'ishdan ketgan ko‘rinmaydi');
  const fail = (items, pattern) => assert.throws(() => hours.saveWorkHours(st, { items }), (error) => error instanceof hours.WorkHoursError && pattern.test(error.message));
  fail([], /yo'q/);
  fail([{ id: 'zzz', start: '11:00', end: '' }], /topilmadi/);
  fail([{ id: 'a', start: '', end: '23:00' }], /Ali: avval ish boshlanish/);
  fail([{ id: 'a', start: '25:00', end: '' }], /11:00 ko'rinishida/);
  fail([{ id: 'a', start: '11:00', end: '11:00' }], /bir xil/);
  fail([{ id: 'a', start: '11:00', end: '10:00' }], /18 soatdan uzun/);
  fail([{ id: 'a', start: '11:00', end: '' }, { id: 'b', start: '9', end: '' }], /Vali/);
  assert.equal(st.staff[0].scheduledStartTime, undefined, 'xato bo‘lsa hech narsa o‘zgarmaydi');

  const saved = hours.saveWorkHours(st, { items: [{ id: 'a', start: '11:00', end: '' }, { id: 'b', start: '17:00', end: '23:00' }] });
  assert.equal(saved.result.changed, 2);
  assert.deepEqual(saved.state.staff.map((m) => [m.id, m.scheduledStartTime, m.scheduledEndTime]), [['a', '11:00', '05:00'], ['b', '17:00', '23:00'], ['c', undefined, undefined]]);
  assert.deepEqual(saved.state.workShifts, [old], 'smenalarga tegilmadi');
  assert.deepEqual(hours.workHoursList(saved.state).map((m) => [m.name, m.start, m.end]), [['Ali', '11:00', ''], ['Vali', '17:00', '23:00']]);
  const again = hours.saveWorkHours(saved.state, { items: [{ id: 'a', start: '11:00', end: '' }] });
  assert.equal(again.result.changed, 0);
  assert.equal(again.state, saved.state, 'o‘zgarish bo‘lmasa yozilmaydi');
  const cleared = hours.saveWorkHours(saved.state, { items: [{ id: 'a', start: '', end: '' }] });
  assert.deepEqual(hours.workHoursList(cleared.state)[0], { id: 'a', name: 'Ali', start: '', end: '', hasAccount: true }, 'qoida olib tashlandi');
});

test('tugma bosilgan payt: erta kelsa — oyna yoziladi; tugashsiz qoidada vaqtida yoki kech kelsa — yozilmaydi', () => {
  const open = member({ scheduledStartTime: '11:00', scheduledEndTime: hours.openEndFor('11:00') });
  const day = '2026-10-06';
  const early = { start: kst(day, '11:00').toISOString(), end: kst('2026-10-07', '05:00').toISOString() };
  assert.deepEqual(hours.clockInPayWindow(open, kst(day, '10:00')), early);
  assert.deepEqual(hours.clockInPayWindow(open, kst(day, '10:59')), early);
  assert.deepEqual(hours.clockInPayWindow(open, kst(day, '06:00')), early, '5 soat erta kelsa ham — 11:00 dan');
  assert.equal(hours.clockInPayWindow(open, kst(day, '11:00')), null);
  assert.equal(hours.clockInPayWindow(open, kst(day, '12:30')), null, 'kech keldi — bosgan vaqtidan');
  assert.equal(hours.clockInPayWindow(open, kst(day, '23:50')), null);
  assert.equal(hours.clockInPayWindow(member(), kst(day, '10:00')), null, 'qoida yo‘q xodim');

  const both = member({ scheduledStartTime: '11:00', scheduledEndTime: '23:00' });
  const fixed = { start: kst(day, '11:00').toISOString(), end: kst(day, '23:00').toISOString() };
  assert.deepEqual(hours.clockInPayWindow(both, kst(day, '10:30')), fixed);
  assert.deepEqual(hours.clockInPayWindow(both, kst(day, '12:00')), fixed, 'tugash vaqti bor — kech kelsa ham oxiri cheklanadi');

  assert.deepEqual(hours.shiftPayWindow({ payWindowStartAtShift: early.start, payWindowEndAtShift: early.end }), { from: early.start, until: '' });
  assert.deepEqual(hours.shiftPayWindow({ payWindowStartAtShift: fixed.start, payWindowEndAtShift: fixed.end }), { from: fixed.start, until: fixed.end });
  assert.equal(hours.shiftPayWindow({}), null);
  assert.equal(hours.shiftPayWindow(null), null);
});

test('hisob: 10:00 da bosgan xodimga 11:00 dan; asl vaqt tarixda qoladi', () => {
  const open = member({ scheduledStartTime: '11:00', scheduledEndTime: hours.openEndFor('11:00') });
  const day = '2026-10-06';
  const make = (m, from, to) => {
    const window = hours.clockInPayWindow(m, kst(day, from));
    return payroll.normalizeWorkShifts([{ id: 's-' + from, staffId: 'a', date: day, clockIn: kst(day, from).toISOString(), clockOut: kst(day, to).toISOString(), breakMinutes: 0, hourlyRateAtShift: 10_000, overtimeAfterHoursAtShift: 18, overtimeMultiplierAtShift: 1, source: 'worker', status: 'closed', ...(window ? { payWindowStartAtShift: window.start, payWindowEndAtShift: window.end } : {}) }])[0];
  };
  const early = make(open, '10:00', '22:00');
  assert.equal(payroll.workShiftMinutes(early), 11 * 60);
  assert.equal(payroll.workShiftPay(open, early), 110_000);
  assert.equal(early.clockIn, kst(day, '10:00').toISOString(), 'kelgan asl vaqt o‘zgarmadi');
  assert.equal(payroll.workShiftMinutes(make(open, '10:30', '22:00')), 11 * 60, '10:30 da kelsa ham 11:00 dan');
  assert.equal(payroll.workShiftMinutes(make(open, '11:20', '22:00')), 10 * 60 + 40, 'kech kelsa — kelgan vaqtidan');
  assert.equal(payroll.workShiftMinutes(make(open, '10:00', '23:50')), 12 * 60 + 50, 'tugash yozilmagan — ketgan vaqtigacha');
  assert.equal(payroll.workShiftMinutes(make(open, '10:00', '10:40')), 0, 'ish vaqtidan oldin kelib-ketgan');

  const both = member({ scheduledStartTime: '11:00', scheduledEndTime: '23:00' });
  assert.equal(payroll.workShiftMinutes(make(both, '10:30', '23:40')), 12 * 60, 'ikki tomoni ham qat’iy');
  assert.equal(payroll.workShiftMinutes(make(both, '12:00', '23:40')), 11 * 60);
});

test('oldingi kunlar o‘zgarmaydi: qoida keyin qo‘yilsa ham, eski ekranda xodim tahrirlansa ham', () => {
  const day = '2026-09-20';
  const old = { id: 'old', staffId: 'a', date: day, clockIn: kst(day, '10:00').toISOString(), clockOut: kst(day, '22:00').toISOString(), breakMinutes: 0, hourlyRateAtShift: 10_000, overtimeAfterHoursAtShift: 18, overtimeMultiplierAtShift: 1, source: 'worker', status: 'closed' };
  const st = { staff: [{ id: 'a', name: 'Ali', payType: 'hourly', hourlyRate: 10_000, dailyHours: 12, active: true }], workShifts: [old] };
  const next = hours.saveWorkHours(st, { items: [{ id: 'a', start: '11:00', end: '23:00' }] }).state;
  const strict = payroll.normalizeStaff(next.staff)[0];
  const normalized = payroll.normalizeWorkShifts(next.workShifts);
  assert.equal(payroll.workShiftMinutes(normalized[0]), 12 * 60);
  // Eski ekranda xodim tahrirlanganda stavka «muzlatiladi» — hisob oynasi orqaga qarab qo'shilmasligi kerak.
  const frozen = payroll.freezeWorkShiftRates(strict, normalized.map((shift) => ({ ...shift, hourlyRateAtShift: 0 })));
  assert.equal(frozen[0].hourlyRateAtShift, 10_000, 'stavka avvalgidek muzlatiladi');
  assert.equal(frozen[0].payWindowStartAtShift, undefined);
  assert.equal(payroll.workShiftMinutes(frozen[0]), 12 * 60, 'eski kun 12 soatligicha qoldi');
});

test('rahbar tuzatishi: qoida saqlanadi; «qat’iy vaqt qo‘llanmasin» — bir martalik istisno, tarixda qoladi', () => {
  const day = '2026-10-01';
  const window = { payWindowStartAtShift: kst(day, '11:00').toISOString(), payWindowEndAtShift: kst(day, '23:00').toISOString() };
  const shift = { id: 'w1', staffId: 'a', date: day, clockIn: kst(day, '10:00').toISOString(), clockOut: '', breakMinutes: 0, hourlyRateAtShift: 10_000, source: 'worker', status: 'open', ...window };
  const st = { staff: [{ id: 'a', name: 'Ali', payType: 'hourly', hourlyRate: 10_000, active: true }], workShifts: [shift, { ...shift, id: 'plain', date: '2026-10-02', clockIn: kst('2026-10-02', '10:00').toISOString(), payWindowStartAtShift: undefined, payWindowEndAtShift: undefined }] };
  const rec = staffCore.staffRecords(st, 'a', '2026-10').shifts;
  assert.deepEqual(rec.find((x) => x.id === 'w1').pay, { from: window.payWindowStartAtShift, until: window.payWindowEndAtShift });
  assert.equal(rec.find((x) => x.id === 'plain').pay, null);

  const kept = staffCore.editShift(st, { id: 'w1', from: '10:00', to: '22:00', reason: 'ketishni unutgan' }).result.shift;
  assert.equal(kept.payWindowStartAtShift, window.payWindowStartAtShift, 'oddiy tuzatishda qoida saqlanadi');
  assert.equal(payroll.workShiftMinutes(payroll.normalizeWorkShifts([kept])[0]), 11 * 60);

  const freed = staffCore.editShift(st, { id: 'w1', from: '10:00', to: '22:00', reason: 'o‘zim erta chaqirdim', free: true }).result.shift;
  assert.equal('payWindowStartAtShift' in freed, false);
  assert.equal('payWindowEndAtShift' in freed, false);
  assert.equal(payroll.workShiftMinutes(payroll.normalizeWorkShifts([freed])[0]), 12 * 60, 'yozilgan vaqt to‘liq hisoblandi');
  assert.deepEqual([freed.edits[0].reason, freed.edits[0].before.payWindowStartAtShift, freed.edits[0].before.payWindowEndAtShift], ['o‘zim erta chaqirdim', window.payWindowStartAtShift, window.payWindowEndAtShift]);
  const plain = staffCore.editShift(st, { id: 'plain', from: '10:00', to: '22:00', reason: 'tuzatish', free: true }).result.shift;
  assert.equal('payWindowStartAtShift' in plain.edits[0].before, false, 'qoidasiz smenada istisno hech narsani o‘zgartirmaydi');
});

test('sahifalar: sozlash oynasi, menyu va xodim ilovasi skripti buzilmagan', async () => {
  const get = async (mod, path) => (await mod.GET(new Request(base + path, { headers: owner }))).text();
  const compile = (html, path) => assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]), path);
  const vaqt = await get(maosh, '/api/v2/maosh?b=vaqt');
  compile(vaqt, 'vaqt');
  assert.match(vaqt, /<h1[^>]*>Qat’iy ish vaqti<\/h1>/);
  assert.match(vaqt, /VAQT=true/);
  assert.match(vaqt, /function hoursBox/);
  assert.match(vaqt, /id="sumCard" hidden/, 'maosh kartalari bu ko‘rinishda yashirin');
  const main = await get(maosh, '/api/v2/maosh');
  compile(main, 'maosh');
  assert.match(main, /href="\/api\/v2\/maosh\?b=vaqt"/);
  assert.match(main, /VAQT=false/);
  assert.match(main, /class="more-a[^"]*" href="\/api\/v2\/maosh\?b=vaqt"/, '«Yana» oynasida bor');
  const joy = await get(maosh, '/api/v2/maosh?b=joy');
  assert.match(joy, /JOY=true,VAQT=false/);
  const app = await (await xodim.GET(new Request(base + '/api/v2/xodim'))).text();
  compile(app, 'xodim');
  for (const key of ['hrsFrom', 'hrsBoth', 'payWait', 'payOver']) assert.equal((app.match(new RegExp(key + ":'", 'g')) || []).length, 4, key + ' — 4 tilda');
});

test('to‘liq oqim: rahbar vaqt qo‘yadi → xodim erta bosadi → hisob belgilangan vaqtdan', async () => {
  mock.timers.enable({ apis: ['Date'], now: kst('2026-10-05', '09:00').getTime() });
  try {
    const wid = await createWorkerAccount('main', 'Ali', 'ali', '1234');
    cookie = (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0];
    const p = state();
    p.staff = [{ id: 'a', name: 'Ali', payType: 'hourly', hourlyRate: 10_000, workDays: 26, dailyHours: 12, overtimeAfterHours: 18, overtimeMultiplier: 1, workerId: wid, active: true }];
    p.workShifts = [];
    put(p);

    // Faqat rahbar o'zgartira oladi.
    const body = JSON.stringify({ action: 'saveHours', branchId: 'main', items: [{ id: 'a', start: '11:00', end: '' }] });
    assert.equal((await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', body }))).status, 401);
    assert.equal((await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body }))).status, 401, 'xodim o‘zgartira olmaydi');
    assert.deepEqual((await view()).hours, { start: '', end: '' });
    assert.equal((await ownerCall({ action: 'saveHours', items: [{ id: 'a', start: '11:00', end: '10:00' }] })).status, 400);

    const saved = await ownerCall({ action: 'saveHours', items: [{ id: 'a', start: '11:00', end: '' }] });
    assert.deepEqual([saved.status, saved.changed, saved.hours], [200, 1, [{ id: 'a', name: 'Ali', start: '11:00', end: '', hasAccount: true }]]);
    assert.deepEqual((await ownerCall({ action: 'hours' })).hours[0].start, '11:00');
    assert.deepEqual((await ownerCall({ action: 'staff' })).staff[0].workHours, { start: '11:00', end: '' });
    const before = await view();
    assert.deepEqual([before.hours, before.pay], [{ start: '11:00', end: '' }, null]);

    // 1-kun: 10:10 da bosdi, 21:00 da ketdi → 11:00–21:00 = 10 soat.
    mock.timers.setTime(kst('2026-10-05', '10:10').getTime());
    const started = await press('clock-in');
    assert.equal(started.status, 200);
    assert.equal(started.openShift.clockIn, kst('2026-10-05', '10:10').toISOString(), 'bosgan asl vaqt yozildi');
    assert.deepEqual(started.pay, { from: kst('2026-10-05', '11:00').toISOString(), until: '' });
    mock.timers.setTime(kst('2026-10-05', '10:40').getTime());
    assert.equal((await view()).earnings.workedMinutes, 0, '11:00 gacha hisob yurmaydi');
    mock.timers.setTime(kst('2026-10-05', '21:00').getTime());
    const done = await press('clock-out');
    assert.equal(done.status, 200);
    assert.deepEqual([done.earnings.workedMinutes, done.earnings.totalEarned, done.pay], [600, 100_000, null]);

    // 2-kun: 12:20 da (kech) bosdi, 20:20 da ketdi → bosgan vaqtidan, 8 soat.
    mock.timers.setTime(kst('2026-10-06', '12:20').getTime());
    assert.equal((await press('clock-in')).pay, null, 'kech keldi — kesadigan narsa yo‘q');
    mock.timers.setTime(kst('2026-10-06', '20:20').getTime());
    assert.deepEqual([(await press('clock-out')).earnings.workedMinutes], [600 + 480]);

    // 3-kun: rahbar tugash vaqtini ham qo'ydi (11:00–20:00). 10:40 da bosdi, 21:10 da ketdi → 9 soat.
    assert.equal((await ownerCall({ action: 'saveHours', items: [{ id: 'a', start: '11:00', end: '20:00' }] })).changed, 1);
    assert.deepEqual((await view()).earnings.workedMinutes, 1080, 'yangi vaqt oldingi kunlarni o‘zgartirmadi');
    mock.timers.setTime(kst('2026-10-07', '10:40').getTime());
    assert.deepEqual((await press('clock-in')).pay, { from: kst('2026-10-07', '11:00').toISOString(), until: kst('2026-10-07', '20:00').toISOString() });
    mock.timers.setTime(kst('2026-10-07', '21:10').getTime());
    const third = await press('clock-out');
    assert.deepEqual([third.earnings.workedMinutes, third.earnings.totalEarned], [1080 + 540, 270_000]);

    // Rahbar yozuvlarda asl vaqtni ham, hisob oynasini ham ko'radi; bir kunlik istisno qila oladi.
    const records = (await ownerCall({ action: 'records', staffId: 'a', month: '2026-10' })).records.shifts;
    assert.deepEqual(records.map((x) => [x.date, x.pay && x.pay.from, x.pay && x.pay.until]), [
      ['2026-10-07', kst('2026-10-07', '11:00').toISOString(), kst('2026-10-07', '20:00').toISOString()],
      ['2026-10-06', null, null],
      ['2026-10-05', kst('2026-10-05', '11:00').toISOString(), ''],
    ]);
    const fixed = await ownerCall({ action: 'editShift', id: records[0].id, from: '10:40', to: '21:10', reason: 'o‘zim erta chaqirdim', free: true });
    assert.equal(fixed.status, 200);
    assert.equal((await view()).earnings.workedMinutes, 1080 + 630, '10:40–21:10 to‘liq hisoblandi');
    assert.equal(shifts().length, 3);
    // Qoida olib tashlansa — xodim yana bosgan vaqtidan hisoblanadi.
    assert.equal((await ownerCall({ action: 'saveHours', items: [{ id: 'a', start: '', end: '' }] })).changed, 1);
    mock.timers.setTime(kst('2026-10-08', '09:30').getTime());
    assert.equal((await press('clock-in')).pay, null);
    const log = sqlite.prepare("SELECT COUNT(*) AS n FROM halo_state_backups WHERE action LIKE 'Qat’iy ish vaqti%'").get();
    assert.equal(log.n, 3, 'har o‘zgarish tarixga yozildi');
  } finally {
    mock.timers.reset();
  }
});
