import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const staff = await import('../app/core/staff.ts');
const { validPayrollState, validPayrollFinanceLinks } = await import('../app/lib/payroll.ts');
const MCID = 'monthly-close:2026-08';
const { projectRemoval, applyRecordRemoval, removalFingerprint } = await import('../app/lib/record-removals.ts');

const op = () => crypto.randomUUID();
const base = () => ({
  staff: [{ id: 'st1', name: 'Aziz', payType: 'hourly', hourlyRate: 12000, monthlySalary: 0, workDays: 26, dailyHours: 8, overtimeAfterHours: 8, overtimeMultiplier: 1, active: true, workerId: '' }],
  accounts: [{ id: 'cash', name: 'Kassa', type: 'cash', openingBalance: 0 }],
  workShifts: [], payrollAdjustments: [], attendanceDays: [], payrollPayments: [], financialEntries: [], monthlyCloses: [],
});
const valid = (s) => validPayrollState(s.staff, s.workShifts, s.payrollAdjustments, s.attendanceDays, s.payrollPayments)
  && validPayrollFinanceLinks(s.payrollPayments, s.accounts, s.financialEntries);

test('smena tuzatiladi va bekor qilinadi — maosh holati to‘g‘ri qoladi', () => {
  let s = staff.addShift(base(), { operationId: op(), staffId: 'st1', date: '2026-09-24', from: '10:00', to: '18:00' }, '2026-09-25').state;
  const id = s.workShifts[0].id;
  assert.throws(() => staff.editShift(s, { id, from: '09:00', to: '17:00', reason: '' }), /Sababini/);
  s = staff.editShift(s, { id, from: '09:00', to: '17:30', reason: 'xato vaqt' }).state;
  assert.equal(s.workShifts[0].edits.length, 1);
  assert.equal(s.workShifts[0].status, 'closed');
  assert.ok(valid(s));
  s = staff.voidShift(s, { id, reason: 'kelmagan' }).state;
  assert.equal(s.workShifts[0].status, 'void');
  assert.ok(valid(s));
});

test('kun holati: smena bor kunda bo‘lmaydi; bekor qilingach qayta yozsa ID takrorlanmaydi', () => {
  let s = staff.addShift(base(), { operationId: op(), staffId: 'st1', date: '2026-09-24', from: '10:00', to: '18:00' }, '2026-09-25').state;
  assert.throws(() => staff.setDayStatus(s, { staffId: 'st1', date: '2026-09-24', status: 'sick' }, '2026-09-25'), /smenani bekor/);
  s = staff.setDayStatus(s, { staffId: 'st1', date: '2026-09-25', status: 'off', payMode: 'planned' }, '2026-09-25').state;
  assert.equal(s.attendanceDays[0].plannedMinutesAtDay, 480);
  const first = s.attendanceDays[0].id;
  s = staff.voidDayStatus(s, { id: first, reason: 'xato kun' }).state;
  s = staff.setDayStatus(s, { staffId: 'st1', date: '2026-09-25', status: 'sick' }, '2026-09-25').state;
  assert.notEqual(s.attendanceDays[0].id, first);
  assert.ok(valid(s));
});

test('bonus va to‘lov bekor qilinadi; to‘lov puli hisobga qaytadi', () => {
  let s = staff.addAdjustment(base(), { operationId: op(), staffId: 'st1', type: 'bonus', amount: 50000, date: '2026-09-24', note: 'yaxshi ish' }, '2026-09-25').state;
  s = staff.voidAdjustment(s, { id: s.payrollAdjustments[0].id, reason: 'xato' }).state;
  assert.equal(s.payrollAdjustments[0].voided, true);
  s = staff.payStaff(s, { operationId: op(), staffId: 'st1', kind: 'advance', amount: 100000, date: '2026-09-24', month: '2026-09', accountId: 'cash' }, '2026-09-25').state;
  const pid = s.payrollPayments[0].id;
  s = staff.voidPayment(s, { id: pid, reason: 'ikki marta' }, '2026-09-25').state;
  assert.equal(s.payrollPayments[0].voided, true);
  assert.equal(s.financialEntries[0].type, 'income');
  assert.equal(s.financialEntries[0].amount, 100000);
  assert.ok(valid(s));
  assert.throws(() => staff.voidPayment({ ...s, payrollPayments: s.payrollPayments.map((p) => ({ ...p, voided: false })) }, { id: pid, reason: 'yana' }, '2026-09-25'), /allaqachon/);
});

test('yopilgan oyda tuzatib bo‘lmaydi', () => {
  let s = staff.addShift(base(), { operationId: op(), staffId: 'st1', date: '2026-08-10', from: '10:00', to: '18:00' }, '2026-09-25').state;
  s = { ...s, monthlyCloses: [{ id: MCID, month: '2026-08', closedAt: '2026-09-02T00:00:00Z', inventoryItems: [], payrollItems: [] }] };
  assert.throws(() => staff.voidShift(s, { id: s.workShifts[0].id, reason: 'test uchun' }), /yopilgan/);
});

test('xarajatni olib tashlash (eski dvigatel): qarama-qarshi yozuv, oylik to‘lovi ham to‘g‘ri bekor bo‘ladi', async () => {
  let s = staff.payStaff(base(), { operationId: op(), staffId: 'st1', kind: 'salary', amount: 70000, date: '2026-09-24', month: '2026-09', accountId: 'cash' }, '2026-09-25').state;
  s.financialEntries.push({ id: 'e1', type: 'expense', category: 'Ijara', amount: 30000, date: '2026-09-24', accountId: 'cash', affectsProfit: true, note: 'ijara' });
  const preview = projectRemoval(s, { kind: 'finance', id: 'e1' }, 'tekshirish', 'preview-removal');
  assert.ok(preview.effects.some((e) => e.label === 'Hisobiy xarajat' && e.before === 30000 && e.after === 0));
  const out = await applyRecordRemoval(s, { kind: 'finance', id: 'e1', reason: 'ikki marta', operationId: 'v2rm-abc12345', expected: await removalFingerprint(s) });
  assert.ok(out.state.financialEntries.some((e) => e.reversedEntryId === 'e1' && e.type === 'income'));
  const pay = out.state.financialEntries.find((e) => e.payrollPaymentId);
  const out2 = await applyRecordRemoval(out.state, { kind: 'finance', id: pay.id, reason: 'xato oylik', operationId: 'v2rm-def12345', expected: await removalFingerprint(out.state) });
  assert.equal(out2.state.payrollPayments[0].voided, true);
  assert.ok(valid(out2.state));
});

test('orqa sana bilan yozilgan eski V2 to‘lovining paidAt maydoni tuzatiladi', () => {
  let s = staff.payStaff(base(), { operationId: op(), staffId: 'st1', kind: 'advance', amount: 1000, date: '2026-09-24', month: '2026-09', accountId: 'cash' }, '2026-09-25').state;
  s = { ...s, payrollPayments: s.payrollPayments.map((p) => ({ ...p, paidAt: '2026-09-25T05:00:00.000Z' })) };
  assert.equal(valid(s), false);
  const fixed = staff.repairPaymentPaidAt(s);
  assert.ok(valid(fixed));
  assert.equal(staff.repairPaymentPaidAt(fixed), fixed);
});

test('tanaffus smenadan uzun bo‘lsa rad etiladi; yopilgan oydagi to‘lovni bekor qilib bo‘lmaydi', () => {
  let s = staff.addShift(base(), { operationId: op(), staffId: 'st1', date: '2026-09-24', from: '10:00', to: '18:00' }, '2026-09-25').state;
  assert.throws(() => staff.editShift(s, { id: s.workShifts[0].id, from: '10:00', to: '11:00', breakMinutes: 90, reason: 'qisqa smena' }), /Tanaffus/);
  assert.throws(() => staff.addShift(base(), { operationId: op(), staffId: 'st1', date: '2026-09-24', from: '10:00', to: '11:00', breakMinutes: 60 }, '2026-09-25'), /Tanaffus/);
  s = staff.payStaff(base(), { operationId: op(), staffId: 'st1', kind: 'advance', amount: 1000, date: '2026-08-20', month: '2026-08', accountId: 'cash' }, '2026-09-25').state;
  s = { ...s, monthlyCloses: [{ id: MCID, month: '2026-08', closedAt: '2026-09-02T00:00:00Z', inventoryItems: [], payrollItems: [] }] };
  assert.throws(() => staff.voidPayment(s, { id: s.payrollPayments[0].id, reason: 'xato to‘lov' }, '2026-09-25'), /yopilgan/);
});
