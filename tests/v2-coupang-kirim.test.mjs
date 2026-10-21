import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Yetkazib beruvchidan kirim (masalan Coupang): qarz qoldig'i buzilgan bo'lsa «Xatolik yuz berdi» chiqmasin, ro'yxat yo'qolmasin. */
const { applySupplierIntake, SupplierIntakeError } = await import('../app/core/supplier-intake.ts');
const { rebalanceInvolvedSuppliers } = await import('../app/lib/supplier-transactions.ts');
const { editSupplierBalance } = await import('../app/lib/supplier-balance-edit.ts');
const { cancelUnifiedIntake } = await import('../app/lib/unified-intake.ts');

const today = '2026-10-21';
const op = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = (patch = {}) => ({
  suppliers: [
    { id: 'n', name: 'Nodir aka', balance: 540000, openingBalance: 0, ...(patch.n || {}) },
    { id: 'c', name: 'Coupang', balance: 88000, openingBalance: 0, ...(patch.c || {}) },
  ],
  accounts: [{ id: 'cash', name: 'Naqd kassa', type: 'cash' }],
  inventory: [{ id: 'lavash', name: 'Lavash', unit: 'dona', stock: 90, unitCost: 350, packageName: 'quti', unitsPerPackage: 100 }],
  transactions: [], stockMovements: [], financialEntries: [], monthlyCloses: [], deletedItems: [],
});
const intake = (state, extra = {}) => applySupplierIntake(state, {
  supplierId: 'c', operationId: op(1), date: today,
  lines: [{ mode: 'expense', name: 'Salfetka', unit: 'quti', quantity: 2, amount: 10000 }],
  paidAmount: 0, ...extra,
}, [], today);

test('Coupang qoldig‘i buzilgan: qarzga ham, to‘langan ham — aniq sabab, TypeError emas', () => {
  for (const paid of [0, 10000]) {
    const state = base({ c: { balance: undefined } });
    assert.throws(() => intake(state, { paidAmount: paid, accountId: paid ? 'cash' : '' }), (error) => {
      assert.ok(error instanceof SupplierIntakeError, `kutilgan SupplierIntakeError, keldi: ${error && error.name}`);
      assert.match(error.message, /«Coupang» qarz qoldig‘i buzilgan/);
      assert.match(error.message, /Qoldiqni tuzatish/);
      return true;
    });
    assert.equal(state.suppliers.length, 2, 'ro‘yxat o‘zgarmagan');
  }
});

test('boshqa yetkazib beruvchining qoldig‘i buzilgan bo‘lsa ham Coupang kirimi saqlanadi va ro‘yxat yo‘qolmaydi', () => {
  for (const broken of [undefined, 'abc', '1,200,000']) {
    const out = intake(base({ n: { balance: broken } }), { paidAmount: 4000, accountId: 'cash' });
    const suppliers = out.state.suppliers;
    assert.equal(suppliers.length, 2, 'ikkala yetkazib beruvchi joyida');
    assert.equal(suppliers.find((s) => s.id === 'c').balance, 88000 + 10000 - 4000, 'Coupang qarzi: +xarid −to‘lov');
    assert.equal(suppliers.find((s) => s.id === 'n').balance, broken, 'boshqasiga tegilmadi');
    assert.equal(out.result.debt, 6000);
  }
});

test('to‘g‘ri ma’lumotda natija avvalgidek (xarid + to‘lov)', () => {
  const out = intake(base(), { paidAmount: 10000, accountId: 'cash' });
  assert.deepEqual(out.state.suppliers.map((s) => [s.id, s.balance]), [['n', 540000], ['c', 88000]]);
  assert.equal(out.state.transactions.filter((t) => t.supplierId === 'c').length, 2);
});

test('rebalanceInvolvedSuppliers: hech qachon bo‘sh ro‘yxat qaytarmaydi', () => {
  const list = [{ id: 'a', name: 'A', balance: 100 }, { id: 'b', name: 'B', balance: undefined }];
  const ok = rebalanceInvolvedSuppliers(list, null, { supplierId: 'a', type: 'purchase', amount: 50 });
  assert.deepEqual(ok.suppliers, [{ id: 'a', name: 'A', balance: 150 }, { id: 'b', name: 'B', balance: undefined }]);
  const bad = rebalanceInvolvedSuppliers(list, null, { supplierId: 'b', type: 'payment', amount: 50 });
  assert.equal(bad.suppliers, undefined);
  assert.match(bad.error, /«B» qarz qoldig‘i buzilgan/);
  assert.match(rebalanceInvolvedSuppliers(list, null, { supplierId: 'x', type: 'purchase', amount: 5 }).error, /topilmadi/);
  assert.match(rebalanceInvolvedSuppliers(list, null, { supplierId: 'a', type: 'purchase', amount: 0 }).error, /summasini tekshiring/);
});

test('«Qoldiqni tuzatish» buzilgan qoldiqni tuzata oladi, keyin kirim ishlaydi', () => {
  const state = base({ c: { balance: undefined } });
  const fixed = editSupplierBalance(state, { supplierId: 'c', balance: 88000, reason: 'Buzilgan qoldiqni tuzatish', id: 'v2edit-test1', expectedBalance: undefined, expectedOpeningBalance: 0 }, '2026-10-21T01:00:00.000Z');
  const coupang = fixed.state.suppliers.find((s) => s.id === 'c');
  assert.equal(coupang.balance, 88000);
  assert.equal(coupang.balanceEdits[0].previousBalance, 0);
  assert.deepEqual(coupang.balanceEdits[0].repairedBrokenBalance, { balance: '', openingBalance: '0' });
  const out = intake(fixed.state, { paidAmount: 10000, accountId: 'cash' });
  assert.equal(out.state.suppliers.find((s) => s.id === 'c').balance, 88000);
  // Oddiy (buzilmagan) holatda tarix avvalgidek: «tuzatilgan buzuq qoldiq» belgisi yo'q.
  const normal = editSupplierBalance(base(), { supplierId: 'c', balance: 90000, reason: 'Solishtirish', id: 'v2edit-test2', expectedBalance: 88000, expectedOpeningBalance: 0 });
  const entry = normal.state.suppliers.find((s) => s.id === 'c').balanceEdits[0];
  assert.equal(entry.previousBalance, 88000); assert.equal(entry.difference, 2000); assert.equal(entry.repairedBrokenBalance, undefined);
});

test('kirimni bekor qilish: boshqa buzuq qoldiq xalaqit bermaydi, ro‘yxat yo‘qolmaydi', () => {
  const saved = intake(base(), { paidAmount: 0 });
  const withBroken = { ...saved.state, suppliers: saved.state.suppliers.map((s) => s.id === 'n' ? { ...s, balance: undefined } : s) };
  const out = cancelUnifiedIntake(withBroken, { id: `intake:${op(1)}`, reason: 'xato kiritildi' });
  assert.equal(out.state.suppliers.length, 2);
  assert.equal(out.state.suppliers.find((s) => s.id === 'c').balance, 88000);
});

test('Xarid sahifasi: kutilmagan xatoda sababi ko‘rinadi, saqlangandan keyingi xato «saqlanmadi» demaydi', () => {
  const src = readFileSync(new URL('../app/api/v2/qarz/route.ts', import.meta.url), 'utf8');
  assert.match(src, /console\.error\("\[v2\/qarz\]", error\)/);
  assert.match(src, /Saqlanmadi — kutilmagan xato, hech narsa yozilmadi\./);
  assert.match(src, /error instanceof IntakeError \|\| error instanceof MezanaPostingError/);
  assert.match(src, /try \{ after = await profile\(mutation\.state as Row, supplierId\); \}/);
  for (const file of ['../app/lib/unified-intake.ts', '../app/lib/vegetable-expenses.ts']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /rebalanceSuppliers\(/, `${file}: eski (ro‘yxatni yo‘qotishi mumkin bo‘lgan) chaqiruv qolmasin`);
  }
});
