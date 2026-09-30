import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { toBaseState, rollFixedExpense, nextMonthStart } = await import('../app/lib/base-reset.ts');

const OLD = {
  productCategories: [{ id: 'c1', name: 'Go‘sht' }],
  accounts: [{ id: 'account-cash', name: 'Naqd kassa', type: 'cash', openingBalance: 350000 }],
  inventory: [
    { id: 'i1', name: 'Tovuq', unit: 'kg', stock: 12.5, minStock: 5, unitCost: 8200, packageName: 'quti', unitsPerPackage: 10, packageCost: 82000, gramsPerUnit: 1000, supplierId: 'p1', categoryId: 'c1', lastCountedAt: '2026-09-20' },
    { id: 'i2', name: 'Non', unit: 'dona', stock: 0, minStock: 20, unitCost: 700, packageName: '', unitsPerPackage: 1, packageCost: 0, gramsPerUnit: 0, supplierId: '', categoryId: 'c1' },
  ],
  recipes: [{ id: 'r1', name: 'Kabob', price: 9000, ingredients: [{ inventoryId: 'i1', quantity: 0.2, unitCost: 8000, lineCost: 1600 }] }],
  suppliers: [{ id: 'p1', name: 'Ali', phone: '010', balance: 450000, openingBalance: 100000, balanceEdits: [{ id: 'e' }], bankAccount: '123' }],
  staff: [{ id: 'st1', name: 'Aziz', monthlySalary: 2500000, payType: 'monthly', active: true }],
  fixedExpenses: [
    { id: 'f1', name: 'Ijara', amount: 1500000, frequency: 'monthly', nextDue: '2026-08-25', billingDay: 25, lastPaidDate: '2026-07-25', active: true },
    { id: 'f2', name: 'Suv', amount: 10000, frequency: 'weekly', nextDue: '2026-09-28', active: true },
  ],
  costRules: { cardCommissionPct: 1.5, deliveryCommissionPct: 15, taxPct: 10 },
  kitchenRules: ['Qo‘l yuving'],
  mezanaSettings: { telegramChatId: '1' },
  sales: [{ id: 's1', totalRevenue: 9000 }, { id: 's2', totalRevenue: 9000 }],
  financialEntries: [{ id: 'fe' }],
  transactions: [{ id: 't' }],
  stockMovements: [{ id: 'm' }],
  workShifts: [{ id: 'w' }],
  payrollPayments: [{ id: 'pp' }],
  dailyCloses: [{ date: '2026-09-29' }],
  auditLog: [{ id: 'a' }],
  customLog: [{ id: 'x' }],
  someSetting: { on: true },
};

test('noldan boshlash: baza qoladi, qoldiq/qarz/tarix nol', () => {
  const { state, report } = toBaseState(structuredClone(OLD), '2026-10-01');
  // Baza
  assert.deepEqual(state.inventory.map((i) => i.name), ['Tovuq', 'Non']);
  assert.equal(state.inventory[0].stock, 0);
  assert.equal(state.inventory[0].unitCost, 8200, 'oxirgi narx saqlanadi (ombor qiymati baribir 0)');
  assert.equal(state.inventory[0].minStock, 5);
  assert.equal(state.inventory[0].packageCost, 82000);
  assert.equal('lastCountedAt' in state.inventory[0], false);
  assert.equal(state.recipes[0].price, 9000);
  assert.equal('lineCost' in state.recipes[0].ingredients[0], false);
  assert.equal(state.recipes[0].ingredients[0].quantity, 0.2);
  assert.equal(state.suppliers[0].name, 'Ali');
  assert.equal(state.suppliers[0].bankAccount, '123');
  assert.equal(state.suppliers[0].balance, 0);
  assert.equal(state.suppliers[0].openingBalance, 0);
  assert.equal('balanceEdits' in state.suppliers[0], false);
  assert.equal(state.accounts[0].openingBalance, 0);
  assert.equal(state.staff[0].monthlySalary, 2500000);
  assert.deepEqual(state.costRules, OLD.costRules);
  assert.deepEqual(state.kitchenRules, OLD.kitchenRules);
  assert.deepEqual(state.someSetting, { on: true });
  // Tarix
  for (const key of ['sales', 'financialEntries', 'transactions', 'stockMovements', 'workShifts', 'payrollPayments', 'dailyCloses', 'auditLog', 'customLog', 'monthlyCloses']) {
    assert.deepEqual(state[key], [], key);
  }
  // Hisobot
  assert.equal(report.cleared.sales, 2);
  assert.equal(report.unknownCleared.customLog, 1);
  assert.deepEqual(report.unknownKept, ['someSetting']);
  assert.equal(report.zeroed.stockItems, 1);
  assert.equal(report.zeroed.supplierDebt, 450000);
  assert.equal(report.zeroed.accountOpening, 350000);
  assert.equal(report.kept.inventory, 2);
  // Asl ob'ekt o'zgarmaydi
  assert.equal(OLD.inventory[0].stock, 12.5);
});

test('doimiy xarajat eski oylar uchun qayta yozilmaydi: sana yangi davrga suriladi', () => {
  const { state } = toBaseState(structuredClone(OLD), '2026-10-01');
  assert.equal(state.fixedExpenses[0].nextDue, '2026-10-25');
  assert.equal('lastPaidDate' in state.fixedExpenses[0], false);
  assert.equal(state.fixedExpenses[1].nextDue, '2026-10-05');
  assert.equal(rollFixedExpense({ frequency: 'monthly', nextDue: '2026-01-31', billingDay: 31 }, '2026-10-01').nextDue, '2026-10-31');
  assert.equal(rollFixedExpense({ frequency: 'monthly', nextDue: '2026-11-03' }, '2026-10-01').nextDue, '2026-11-03');
  assert.equal(rollFixedExpense({ frequency: 'daily', nextDue: '' }, '2026-10-01').nextDue, '2026-10-01');
});

test('keyingi oy boshi Seul vaqti bo‘yicha', () => {
  assert.equal(nextMonthStart(new Date('2026-09-30T06:00:00Z')), '2026-10-01');
  assert.equal(nextMonthStart(new Date('2026-09-30T15:30:00Z')), '2026-11-01'); // Seulda allaqachon 1-oktabr
  assert.equal(nextMonthStart(new Date('2026-12-15T00:00:00Z')), '2027-01-01');
  assert.throws(() => toBaseState({}, '1-oktabr'));
});
