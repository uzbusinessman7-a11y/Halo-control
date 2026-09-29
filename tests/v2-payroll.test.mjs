import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { runPayrollBridge, payOperationId } = await import('../app/core/payroll-bridge.ts');
const { payslip, payslipText } = await import('../app/core/payroll-ledger.ts');
const { calculatePayroll, normalizeStaff, normalizeWorkShifts, normalizePayrollAdjustments, normalizeAttendanceDays, normalizePayrollPayments } = await import('../app/lib/payroll.ts');

function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => sqlite.prepare(query).run(...params),
    _exec: () => sqlite.prepare(query).run(...params),
  });
  return { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
}
const scope = { tenantId: 'halo', branchId: 'main' };
const today = '2026-09-30';
const now = new Date('2026-09-30T12:00:00Z');
const shift = (id, staffId, date, fromUtc, toUtc, extra = {}) => ({
  id, staffId, date, clockIn: `${date}T${fromUtc}:00.000Z`, clockOut: toUtc ? `${date}T${toUtc}:00.000Z` : '',
  breakMinutes: 0, hourlyRateAtShift: 10_333, overtimeAfterHoursAtShift: 8, overtimeMultiplierAtShift: 1.5, note: '', source: 'owner', status: toUtc ? 'closed' : 'open', ...extra,
});
const state = () => ({
  staff: [
    { id: 'aziz', name: 'Aziz', payType: 'hourly', hourlyRate: 10_333, workDays: 26, dailyHours: 8, overtimeAfterHours: 8, overtimeMultiplier: 1.5, active: true },
    { id: 'lola', name: 'Lola', payType: 'monthly', monthlySalary: 2_500_000, workDays: 26, dailyHours: 10, overtimeAfterHours: 10, overtimeMultiplier: 1, active: true },
  ],
  workShifts: [
    shift('s1', 'aziz', '2026-08-30', '01:00', '09:20'),
    shift('s2', 'aziz', '2026-09-01', '01:00', '11:07'),
    shift('s3', 'aziz', '2026-09-02', '01:00', '08:45'),
    shift('s4', 'aziz', '2026-09-03', '01:00', '09:00', { status: 'void' }),
    shift('s5', 'lola', '2026-09-01', '00:00', '10:00', { hourlyRateAtShift: 0, overtimeAfterHoursAtShift: 10, overtimeMultiplierAtShift: 1 }),
    shift('s6', 'lola', '2026-09-02', '00:00', '09:13', { hourlyRateAtShift: 0, overtimeAfterHoursAtShift: 10, overtimeMultiplierAtShift: 1 }),
  ],
  attendanceDays: [
    { id: 'a1', staffId: 'lola', date: '2026-09-03', status: 'sick', payMode: 'planned', plannedMinutesAtDay: 0, hourlyRateAtDay: 0, note: '', voided: false },
    { id: 'a2', staffId: 'lola', date: '2026-09-04', status: 'off', payMode: 'unpaid', plannedMinutesAtDay: 0, hourlyRateAtDay: 0, note: '', voided: false },
  ],
  payrollAdjustments: [
    { id: 'j1', staffId: 'aziz', date: '2026-09-05', type: 'bonus', amount: 50_000, note: 'Chorshanba ko‘p savdo', voided: false },
    { id: 'j2', staffId: 'aziz', date: '2026-09-06', type: 'deduction', amount: 12_000, note: 'Singan idish', voided: false },
    { id: 'j3', staffId: 'aziz', date: '2026-09-07', type: 'advance', amount: 30_000, note: '', voided: false },
    { id: 'j4', staffId: 'aziz', date: '2026-09-08', type: 'bonus', amount: 99_000, note: '', voided: true },
  ],
  payrollPayments: [
    { id: 'p1', staffId: 'aziz', month: '2026-08', date: '2026-09-03', kind: 'salary', amount: 50_000, accountId: 'cash', financialEntryId: 'f1', note: '', voided: false },
    { id: 'p2', staffId: 'aziz', month: '2026-09', date: '2026-09-10', kind: 'advance', amount: 40_000, accountId: 'cash', financialEntryId: 'f2', note: '', voided: false },
  ],
});
function oldRemaining(s, staffId, month) {
  const member = normalizeStaff(s.staff).find((m) => m.id === staffId);
  return Math.round(calculatePayroll(member, normalizeWorkShifts(s.workShifts), normalizePayrollAdjustments(s.payrollAdjustments), month, {
    attendanceDays: normalizeAttendanceDays(s.attendanceDays), payments: normalizePayrollPayments(s.payrollPayments), now,
  }).remaining);
}
async function db() { const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON'); return { sqlite, db: d1(sqlite) }; }

test('har bir xodim va oy qoldig‘i eski calculatePayroll bilan wonma-won teng', async () => {
  const { db: database } = await db();
  const s = state();
  const report = await runPayrollBridge(database, scope, s, today, now);
  assert.deepEqual(report.invalid, []);
  assert.equal(report.mismatched, 0);
  for (const employee of report.employees) {
    for (const month of employee.months) {
      const oldId = employee.name === 'Aziz' ? 'aziz' : 'lola';
      assert.equal(month.ledgerRemaining, oldRemaining(s, oldId, month.month), `${employee.name} ${month.month}`);
    }
  }
  const aziz = report.employees.find((e) => e.name === 'Aziz');
  assert.deepEqual(aziz.months.map((m) => m.month), ['2026-09', '2026-08']);
  assert.equal(report.advancesWithoutCash, 1);
  assert.equal(report.unpaidPast.length, 1, 'avgust oyligi to‘liq to‘lanmagan');
  assert.equal(report.unpaidPast[0].month, '2026-08');
  const again = await runPayrollBridge(database, scope, s, today, now);
  assert.equal(again.posted, 0, 'qayta — takror yo‘q');
  assert.equal(again.reversed, 0);
});

test('smena tuzatilsa — eski versiya teskari yozuv bilan yopiladi, yangi versiya qo‘shiladi', async () => {
  const { db: database, sqlite } = await db();
  const s = state();
  await runPayrollBridge(database, scope, s, today, now);
  s.workShifts[2].clockOut = '2026-09-02T09:45:00.000Z';
  s.payrollAdjustments[1].voided = true;
  const report = await runPayrollBridge(database, scope, s, today, now);
  assert.equal(report.corrected, 1);
  assert.equal(report.reversed, 2, 'tuzatilgan smena + bekor qilingan ushlanma');
  assert.equal(report.mismatched, 0);
  const aziz = report.employees.find((e) => e.name === 'Aziz').months.find((m) => m.month === '2026-09');
  assert.equal(aziz.ledgerRemaining, oldRemaining(s, 'aziz', '2026-09'));
  assert.equal(aziz.deduction, 0);
  const rev = sqlite.prepare("SELECT memo FROM v2_pay_moves WHERE kind = 'reversal' AND memo LIKE 'Eski tizimda o''zgartirildi%'").get();
  assert.match(rev.memo, /→/);
  assert.throws(() => sqlite.prepare("UPDATE v2_pay_moves SET amount = 1").run(), /o'zgartirilmaydi/);
  assert.throws(() => sqlite.prepare("DELETE FROM v2_pay_moves").run(), /o'chirilmaydi/);
  assert.equal((await runPayrollBridge(database, scope, s, today, now)).posted, 0);
});

test('hisob varaqasi: kunlar, soatlar, bonus, ushlanma, avans, to‘lov va yuborish matni', async () => {
  const { db: database } = await db();
  const s = state();
  const report = await runPayrollBridge(database, scope, s, today, now);
  const aziz = report.employees.find((e) => e.name === 'Aziz');
  const p = await payslip(database, scope, aziz.employeeId, '2026-09');
  assert.equal(p.workedDays, 2, 'bekor qilingan smena hisobga kirmaydi');
  assert.equal(p.bonus, 50_000);
  assert.equal(p.deduction, 12_000);
  assert.equal(p.advance, 30_000);
  assert.equal(p.paid, 40_000);
  assert.equal(p.remaining, p.earned + p.bonus - p.deduction - p.advance - p.paid);
  assert.equal(p.remaining, oldRemaining(s, 'aziz', '2026-09'));
  assert.equal(p.earlierMonths, oldRemaining(s, 'aziz', '2026-08'));
  const text = payslipText(p);
  assert.match(text, /Aziz · 2026-yil sentabr/);
  assert.match(text, /\+ Bonus: 50,000 ₩/);
  assert.match(text, /− Avans: 30,000 ₩/);
  assert.match(text, /To'lanishi kerak: /);
  const lola = report.employees.find((e) => e.name === 'Lola');
  const lp = await payslip(database, scope, lola.employeeId, '2026-09');
  assert.equal(lp.paidLeaveDays, 1, 'kasal kuni haq to‘lanadi, dam kuni to‘lanmaydi');
  assert.equal(lp.remaining, oldRemaining(s, 'lola', '2026-09'));
});

test('amal raqami barqaror va uzun ID bilan ham to‘g‘ri', () => {
  const id = payOperationId('j:' + 'x'.repeat(300), 3);
  assert.match(id, /^bridge:w:[a-z0-9]+:3$/);
  assert.equal(id, payOperationId('j:' + 'x'.repeat(300), 3));
  assert.notEqual(id, payOperationId('j:' + 'x'.repeat(299), 3));
});
