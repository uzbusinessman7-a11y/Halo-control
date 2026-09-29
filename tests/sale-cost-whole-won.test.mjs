import test from 'node:test';
import assert from 'node:assert/strict';
import { sumWholeWon, wholeWon } from '../app/lib/sale-cost.ts';
import { calculateDailyReport } from '../app/lib/daily-report.ts';

// Retsept tannarxi kasr bo'lishi mumkin; savdoda shunday saqlanadi.
const sales = [
  { id: 'a', date: '2026-09-29', recipeId: 'r', quantity: 1, unitPrice: 5000, totalRevenue: 5000, totalCost: 1200.5, accountId: 'account-card' },
  { id: 'b', date: '2026-09-29', recipeId: 'r', quantity: 1, unitPrice: 5000, totalRevenue: 5000, totalCost: 1200.5, accountId: 'account-card' },
  { id: 'c', date: '2026-09-29', recipeId: 'r', quantity: 1, unitPrice: 5000, totalRevenue: 5000, totalCost: 1200.5, accountId: 'account-card' },
];

test('eski usul (avval qo\'shib, keyin yaxlitlash) kunlik hisobotdan 1₩ farq qilardi', () => {
  const oldDashboardCost = Math.round(sales.reduce((sum, sale) => sum + sale.totalCost, 0));
  const report = calculateDailyReport({ sales, accounts: [{ id: 'account-card', type: 'card' }] }, '2026-09-29');
  assert.equal(oldDashboardCost, 3602);
  assert.equal(report.cost, 3603);
  assert.notEqual(oldDashboardCost, report.cost);
});

test('yagona qoida: bosh sahifa jami kunlik hisobot bilan wonma-won bir xil', () => {
  const report = calculateDailyReport({ sales, accounts: [{ id: 'account-card', type: 'card' }] }, '2026-09-29');
  assert.equal(sumWholeWon(sales, (sale) => sale.totalCost), report.cost);
});

test('har bir qatordagi tannarx + foyda = savdo (1₩ ham yo\'qolmaydi)', () => {
  for (const cost of [0.5, 1.5, 1200.5, 1200.49, 99.999, 0]) {
    const revenue = 5000;
    const shownCost = wholeWon(cost);
    const shownProfit = revenue - shownCost;
    assert.equal(shownCost + shownProfit, revenue);
    assert.ok(Number.isSafeInteger(shownCost));
  }
});

test('saqlangan kasr qiymat o\'zgartirilmaydi va buzilgan qiymat 0 hisoblanadi', () => {
  const copy = structuredClone(sales);
  sumWholeWon(sales, (sale) => sale.totalCost);
  assert.deepEqual(sales, copy);
  assert.equal(wholeWon(undefined), 0);
  assert.equal(wholeWon('abc'), 0);
  assert.equal(wholeWon(Infinity), 0);
  assert.equal(wholeWon('1234.6'), 1235);
});
