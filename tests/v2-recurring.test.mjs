import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { materializeRecurring, saveRecurring, stopRecurring, recurringList } = await import('../app/core/recurring.ts');
const { validRecurringExpenseMetadata } = await import('../app/lib/recurring-expenses.ts');

const base = () => ({ accounts: [{ id: 'cash', name: 'Kassa', type: 'cash' }, { id: 'bank', name: 'Bank', type: 'bank' }], fixedExpenses: [], financialEntries: [] });

test('oylik xarajat: kuni kelganda bir marta yoziladi, takrorlanmaydi', () => {
  let s = saveRecurring(base(), { name: 'Ijara', category: 'Ijara', amount: 1500000, billingDay: 5, accountId: 'bank' }, '2026-10-01').state;
  assert.equal(s.fixedExpenses[0].nextDue, '2026-10-05');
  assert.equal(materializeRecurring(s, '2026-10-04').created.length, 0);
  const a = materializeRecurring(s, '2026-10-05');
  assert.equal(a.created.length, 1);
  assert.equal(a.created[0].amount, 1500000);
  assert.equal(a.state.fixedExpenses[0].nextDue, '2026-11-05');
  assert.equal(materializeRecurring(a.state, '2026-10-20').created.length, 0);
  assert.equal(materializeRecurring(a.state, '2026-12-06').created.length, 2);
  assert.ok(validRecurringExpenseMetadata(a.state.fixedExpenses, a.state.financialEntries));
});

test('kuni o‘tgan bo‘lsa keyingi oydan; “shu oy ham” belgilansa bugun yoziladi', () => {
  const later = saveRecurring(base(), { name: 'Internet', category: 'Wi-Fi / telefon', amount: 33000, billingDay: 1, accountId: 'cash' }, '2026-10-10').state;
  assert.equal(later.fixedExpenses[0].nextDue, '2026-11-01');
  const now = saveRecurring(base(), { name: 'Internet', category: 'Wi-Fi / telefon', amount: 33000, billingDay: 1, accountId: 'cash', includeThisMonth: true }, '2026-10-10').state;
  assert.equal(materializeRecurring(now, '2026-10-10').created[0].date, '2026-10-01');
});

test('yopilgan kunga tushgan yozuv birinchi ochiq kunga o‘tadi; 31-kun qisqa oyda oxirgi kun', () => {
  const s = saveRecurring(base(), { name: 'Sug‘urta', category: 'Sug‘urta', amount: 90000, billingDay: 31, accountId: 'bank' }, '2026-11-01').state;
  assert.equal(s.fixedExpenses[0].nextDue, '2026-11-30');
  const out = materializeRecurring(s, '2026-12-02', '2026-11-30');
  assert.equal(out.created[0].date, '2026-12-01');
  assert.equal(out.created[0].fixedExpenseDueDate, '2026-11-30');
});

test('takroriy faol xarajat, mahsulot xaridi va maosh rad etiladi; to‘xtatilgani yozilmaydi', () => {
  const s = saveRecurring(base(), { name: 'Ijara', category: 'Ijara', amount: 1000, billingDay: 5, accountId: 'bank' }, '2026-10-01').state;
  assert.throws(() => saveRecurring(s, { name: 'Ijara', category: 'Ijara', amount: 2000, billingDay: 7, accountId: 'bank' }, '2026-10-01'), /faol oylik/);
  assert.throws(() => saveRecurring(base(), { name: 'Go‘sht', category: 'Mahsulot xaridi', amount: 1000, billingDay: 5, accountId: 'bank' }, '2026-10-01'), /avtomatik bo/);
  const stopped = stopRecurring(s, { id: s.fixedExpenses[0].id }).state;
  assert.equal(materializeRecurring(stopped, '2026-12-31').created.length, 0);
  assert.equal(recurringList(stopped)[0].active, false);
  const again = saveRecurring(stopped, { id: s.fixedExpenses[0].id, name: 'Ijara', category: 'Ijara', amount: 1000, billingDay: 5, accountId: 'bank' }, '2027-01-10').state;
  assert.equal(again.fixedExpenses[0].nextDue, '2027-02-05');
});
