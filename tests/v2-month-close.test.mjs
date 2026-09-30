import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { monthCloseStatus, closeMonth } = await import('../app/core/month-close.ts');
const { isAccountingMonthClosed } = await import('../app/lib/month-end.ts');

const state = () => ({
  inventory: [{ id: 'i1', name: 'Go‘sht', unit: 'g', stock: 5000, unitCost: 20 }],
  recipes: [], sales: [{ id: 's1', date: '2026-10-10', recipeId: 'r', quantity: 1, totalRevenue: 10000, totalCost: 3000, accountId: 'cash' }],
  stockMovements: [], financialEntries: [{ id: 'e1', type: 'expense', category: 'Ijara', amount: 2000, date: '2026-10-05', accountId: 'cash', affectsProfit: true, note: '' }],
  accounts: [{ id: 'cash', type: 'cash', name: 'Kassa' }], staff: [], workShifts: [], payrollAdjustments: [], attendanceDays: [], payrollPayments: [],
  monthlyCloses: [], costRules: { taxPct: 0, cardCommissionPct: 0 }, suppliers: [], transactions: [],
});

test('oy o‘rtasida yopilmaydi, oxirgi kuni yopiladi va yopilgan oy qulflanadi', () => {
  const mid = monthCloseStatus(state(), '2026-10-15').options.find((o) => o.month === '2026-10');
  assert.equal(mid.canClose, false);
  const st = monthCloseStatus(state(), '2026-10-31');
  assert.equal(st.isLastDay, true);
  assert.equal(st.options.find((o) => o.month === '2026-10').canClose, true);
  const out = closeMonth(state(), '2026-10', '2026-10-31T14:00:00Z');
  assert.ok(isAccountingMonthClosed(out.state.monthlyCloses, '2026-10-20'));
  assert.equal(out.state.inventory[0].stock, 5000);
  const after = monthCloseStatus(out.state, '2026-10-31');
  assert.equal(after.options.find((o) => o.month === '2026-10').closed, true);
  assert.equal(after.last.revenue, 10000);
});

test('keyingi oyda yozuv bo‘lsa, o‘tgan oyni yopib bo‘lmaydi (sababi ko‘rsatiladi)', () => {
  const s = state();
  s.sales.push({ id: 's2', date: '2026-11-01', recipeId: 'r', quantity: 1, totalRevenue: 5000, totalCost: 1000, accountId: 'cash' });
  const o = monthCloseStatus(s, '2026-11-02').options.find((x) => x.month === '2026-10');
  assert.equal(o.canClose, false);
  assert.match(o.reason, /keyingi oy/);
});
