import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* Stavka sanadan: «oyning o'rtasidan oylik oshsa — faqat o'sha kundan hisoblansin». */
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
const staffCore = await import('../app/core/staff.ts');
const rates = await import('../app/core/staff-rates.ts');
const payroll = await import('../app/lib/payroll.ts');
const maosh = await import('../app/api/v2/maosh/route.ts');
const attendance = await import('../app/api/attendance/route.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const { seoulCalendarDate } = await import('../app/lib/business-time.ts');
const base = 'https://halo.example.workers.dev';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const op = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const kst = (date, time) => new Date(`${date}T${time}:00+09:00`).toISOString();
const shift = (id, date, extra = {}) => ({ id, staffId: 'a', date, clockIn: kst(date, '10:00'), clockOut: kst(date, '18:00'), breakMinutes: 0, hourlyRateAtShift: 10_000, overtimeAfterHoursAtShift: 8, overtimeMultiplierAtShift: 1, source: 'owner', status: 'closed', ...extra });
const ali = { id: 'a', name: 'Ali', payType: 'hourly', hourlyRate: 10_000, monthlySalary: 0, workDays: 26, dailyHours: 8, overtimeAfterHours: 8, overtimeMultiplier: 1, active: true };
const body = (extra) => ({ id: 'a', name: 'Ali', payType: 'hourly', hourlyRate: 10_000, workDays: 26, dailyHours: 8, overtimeAfterHours: 8, overtimeMultiplier: 1, active: true, operationId: op(1), ...extra });

test('soatlik stavka 15-oktabrdan oshdi: 15-dan keyingi kunlar — yangi, oldingilari — eski; stavkasiz eski smena muzlatildi', () => {
  const st = { staff: [ali], workShifts: [
    shift('s05', '2026-10-05', { hourlyRateAtShift: 0, overtimeAfterHoursAtShift: 0, overtimeMultiplierAtShift: 0, edits: [{ reason: 'eski' }] }),
    shift('s10', '2026-10-10'), shift('s15', '2026-10-15'), shift('s20', '2026-10-20'), shift('v', '2026-10-21', { status: 'void' }),
  ], attendanceDays: [{ id: 'd18', staffId: 'a', date: '2026-10-18', status: 'off', payMode: 'planned', plannedMinutesAtDay: 480, hourlyRateAtDay: 10_000, voided: false }] };
  const out = staffCore.saveStaffMember(st, body({ hourlyRate: 12_000, effectiveFrom: '2026-10-15' }), '2026-10-16');
  const rateOf = (id) => out.state.workShifts.find((x) => x.id === id).hourlyRateAtShift;
  assert.deepEqual([rateOf('s05'), rateOf('s10'), rateOf('s15'), rateOf('s20'), rateOf('v')], [10_000, 10_000, 12_000, 12_000, 10_000]);
  assert.deepEqual(out.state.workShifts.find((x) => x.id === 's05').edits, [{ reason: 'eski' }], 'smenaning boshqa maydonlari o‘zgarmadi');
  assert.equal(out.state.attendanceDays[0].hourlyRateAtDay, 12_000, 'pullik dam kuni (18-sana) ham yangi stavkada');
  assert.deepEqual(out.result.rateChange, { from: '2026-10-15', shifts: 2, days: 1 });
  const saved = out.state.staff[0];
  assert.equal(saved.rateHistory.length, 1);
  assert.deepEqual([saved.rateHistory[0].from, saved.rateHistory[0].prev.hourlyRate, saved.rateHistory[0].next.hourlyRate], ['2026-10-15', 10_000, 12_000]);
  // Oylik hisob: 2 kun × 8 soat eski + 2 kun × 8 soat yangi.
  const member = payroll.normalizeStaff(out.state.staff)[0];
  const pay = payroll.normalizeWorkShifts(out.state.workShifts).filter((x) => x.status !== 'void').reduce((sum, x) => sum + payroll.workShiftPay(member, x), 0);
  assert.equal(pay, 2 * 80_000 + 2 * 96_000);
  assert.deepEqual(staffCore.staffList(out.state)[0].rateHistory, [{ from: '2026-10-15', before: '10,000 ₩ / soat', after: '12,000 ₩ / soat' }]);
});

test('oylik maosh oy o‘rtasidan oshdi — soatlik ulushi faqat o‘sha kundan', () => {
  const monthly = { ...ali, payType: 'monthly', hourlyRate: 0, monthlySalary: 2_600_000 };
  const st = { staff: [monthly], workShifts: [shift('m1', '2026-10-10', { hourlyRateAtShift: 12_500 }), shift('m2', '2026-10-20', { hourlyRateAtShift: 12_500 })] };
  const out = staffCore.saveStaffMember(st, body({ payType: 'monthly', hourlyRate: 0, monthlySalary: 3_120_000, effectiveFrom: '2026-10-16' }), '2026-10-21');
  assert.deepEqual(out.state.workShifts.map((x) => x.hourlyRateAtShift), [12_500, 15_000], '2 600 000/208 = 12 500 → 3 120 000/208 = 15 000');
});

test('keyin kiritilgan oldingi sanali kun — o‘z sanasidagi stavkada; kelajakdagi o‘zgarish bugunga ta’sir qilmaydi', () => {
  const st = { staff: [ali], workShifts: [] };
  const raised = staffCore.saveStaffMember(st, body({ hourlyRate: 12_000, effectiveFrom: '2026-10-15' }), '2026-10-20').state;
  const before = staffCore.addShift(raised, { operationId: op(2), staffId: 'a', date: '2026-10-10', from: '10:00', to: '18:00' }, '2026-10-20');
  const after = staffCore.addShift(raised, { operationId: op(3), staffId: 'a', date: '2026-10-16', from: '10:00', to: '18:00' }, '2026-10-20');
  assert.deepEqual([before.result.shift.hourlyRateAtShift, after.result.shift.hourlyRateAtShift], [10_000, 12_000]);
  const leave = staffCore.setDayStatus(raised, { staffId: 'a', date: '2026-10-12', status: 'off', payMode: 'planned' }, '2026-10-20');
  assert.equal(leave.result.day.hourlyRateAtDay, 10_000);
  // Kelajak: 1-noyabrdan oshadi — bugungi (20-oktabr) smena hali eski stavkada.
  const future = staffCore.saveStaffMember(raised, body({ hourlyRate: 13_000, effectiveFrom: '2026-11-01' }), '2026-10-20').state;
  assert.equal(rates.memberOn(future.staff[0], '2026-10-20').hourlyRate, 12_000);
  assert.equal(rates.memberOn(future.staff[0], '2026-11-01').hourlyRate, 13_000);
  assert.equal(rates.memberOn(future.staff[0], '2026-10-01').hourlyRate, 10_000);
});

test('tekshiruvlar: yopilgan oy, oxirgi o‘zgarishdan oldingi sana, noto‘g‘ri sana; faqat ism o‘zgarsa — hech narsa qayta hisoblanmaydi', () => {
  const st = { staff: [ali], workShifts: [shift('s10', '2026-10-10')] };
  const closed = { ...st, monthlyCloses: [{ id: 'monthly-close:2026-09', month: '2026-09', closedAt: '2026-10-01T00:00:00.000Z', inventoryItems: [], payrollItems: [] }] };
  assert.throws(() => staffCore.saveStaffMember(closed, body({ hourlyRate: 12_000, effectiveFrom: '2026-09-20' }), '2026-10-16'), /2026-09 oyi yopilgan/);
  assert.throws(() => staffCore.saveStaffMember(st, body({ hourlyRate: 12_000, effectiveFrom: '2026-1x-01' }), '2026-10-16'), /qachondan/);
  const once = staffCore.saveStaffMember(st, body({ hourlyRate: 12_000, effectiveFrom: '2026-10-15' }), '2026-10-16').state;
  assert.throws(() => staffCore.saveStaffMember(once, body({ hourlyRate: 13_000, effectiveFrom: '2026-10-10' }), '2026-10-16'), /2026-10-15 dan/);
  const renamed = staffCore.saveStaffMember(st, body({ name: 'Ali aka' }), '2026-10-16');
  assert.equal(renamed.result.rateChange, undefined);
  assert.equal(renamed.state.staff[0].rateHistory, undefined);
  assert.equal(renamed.state.workShifts, st.workShifts, 'smenalarga tegilmadi');
  const plain = staffCore.saveStaffMember(st, body({ hourlyRate: 11_000 }), '2026-10-16');
  assert.equal(plain.result.rateChange.from, '2026-10-16', 'sana berilmasa — bugundan');
});

test('server va sahifa: Maosh orqali saqlash, natija qaytadi; ISHNI BOSHLADIM bugungi shartni oladi', async () => {
  const html = await (await maosh.GET(new Request(base + '/api/v2/maosh', { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /id="fFrom"/);
  const today = seoulCalendarDate(new Date());
  const tomorrow = new Date(Date.parse(`${today}T12:00:00+09:00`) + 86_400_000).toISOString().slice(0, 10);
  const wid = await createWorkerAccount('main', 'Ali', 'ali', '1234');
  const cookie = (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0];
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.staff = [{ ...ali, workerId: wid }]; p.workShifts = [];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const r = await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', headers: owner, body: JSON.stringify({ action: 'saveStaff', branchId: 'main', ...body({ hourlyRate: 15_000, effectiveFrom: tomorrow }) }) }));
  const out = await r.json();
  assert.deepEqual([r.status, out.rateChange.from], [200, tomorrow]);
  assert.equal(out.staff[0].hourlyRate, 15_000);
  const press = await attendance.POST(new Request(base + '/api/attendance', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'clock-in' }) }));
  assert.equal(press.status, 200);
  const saved = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload).workShifts[0];
  assert.equal(saved.hourlyRateAtShift, 10_000, 'ertangi o‘zgarish bugungi ish kuniga ta’sir qilmadi');
  const bad = await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', headers: owner, body: JSON.stringify({ action: 'saveStaff', branchId: 'main', ...body({ hourlyRate: 16_000, effectiveFrom: today }) }) }));
  assert.equal(bad.status, 400, 'oxirgi o‘zgarishdan (ertadan) oldingi sana — yo‘q');
});

test('server: mavjud ish kunlari qayta hisoblanib saqlanadi (holat tekshiruvidan o‘tadi), tarixga yoziladi', async () => {
  const today = seoulCalendarDate(new Date());
  const day = (k) => new Date(Date.parse(`${today}T12:00:00+09:00`) - k * 86_400_000).toISOString().slice(0, 10);
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.staff = [{ ...ali, id: 'b', name: 'Bek' }];
  p.workShifts = [shift('b3', day(3), { staffId: 'b' }), shift('b1', day(1), { staffId: 'b' })];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const r = await maosh.POST(new Request(base + '/api/v2/maosh', { method: 'POST', headers: owner, body: JSON.stringify({ action: 'saveStaff', branchId: 'main', ...body({ id: 'b', name: 'Bek', hourlyRate: 11_000, effectiveFrom: day(2) }) }) }));
  const out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out));
  assert.deepEqual(out.rateChange, { from: day(2), shifts: 1, days: 0 });
  const saved = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload).workShifts;
  assert.deepEqual(saved.map((x) => [x.id, x.hourlyRateAtShift]), [['b3', 10_000], ['b1', 11_000]]);
  const log = sqlite.prepare("SELECT action FROM halo_state_backups ORDER BY created_at DESC").get();
  assert.match(log.action, new RegExp('yangi shart ' + day(2) + ' dan'));
});
