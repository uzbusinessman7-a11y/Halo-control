import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierPurchaseSettlements } from '../app/lib/supplier-transactions.ts';
import { normalizeRecipeIngredients, calculateRecipeCost } from '../app/lib/recipe-costing.ts';
import { receiptCostsForInventory, bypassRemovedReceiptCost } from '../app/lib/stock-movements.ts';
import { auditBusinessState } from '../app/lib/business-audit.ts';
import { supplierLedger } from '../app/lib/supplier-ledger.ts';
import { calculateDailyReport } from '../app/lib/daily-report.ts';
import { applyUnifiedIntake } from '../app/lib/unified-intake.ts';

const purchase = { id: 'p1', supplierId: 's', type: 'purchase', date: '2026-09-01', amount: 100_000 };
const payment = { id: 'm1', supplierId: 's', type: 'payment', date: '2026-09-02', amount: 158_500 };

test('unallocated payments settle opening debt first without changing the ledger', () => {
  const transactions = [payment, purchase];
  const before = JSON.stringify(transactions);
  const result = supplierPurchaseSettlements(transactions, undefined, [{ id: 's', openingBalance: 948_000 }]);
  assert.equal(result.p1.paidAmount, 0);
  assert.equal(result.p1.remainingAmount, 100_000);
  assert.equal(JSON.stringify(transactions), before);
  const partial = supplierPurchaseSettlements(transactions, undefined, [{ id: 's', openingBalance: 100_000 }]);
  assert.deepEqual(partial.p1, { paidAmount: 58_500, remainingAmount: 41_500, status: 'partial' });
});
test('opening advance pays a later invoice and an explicit receipt payment skips old debt', () => {
  const advance = supplierPurchaseSettlements([purchase], undefined, [{ id: 's', openingBalance: -30_000 }]);
  assert.equal(advance.p1.remainingAmount, 70_000);
  for (const link of [{ id: 'paid:p1' }, { intakeId: 'p1' }]) {
    const result = supplierPurchaseSettlements([{ ...payment, ...link, amount: 100_000 }, purchase], undefined, [{ id: 's', openingBalance: 948_000 }]);
    assert.equal(result.p1.remainingAmount, 0);
  }
});
test('historical invoice settlement does not include a later opening-balance correction', () => {
  const supplier = { id: 's', openingBalance: 948_000, balanceEdits: [{ at: '2026-09-24T01:00:00Z', previousOpeningBalance: 100_000, openingBalance: 948_000 }] };
  const result = supplierPurchaseSettlements([payment, purchase], '2026-09-02', [supplier]);
  assert.equal(result.p1.remainingAmount, 41_500);
});
test('same-day intake payment preceding the purchase is not consumed by opening debt', () => {
  const result = supplierPurchaseSettlements([purchase, { ...payment, date: purchase.date, intakeId: 'p1', amount: 30_000 }], undefined, [{ id: 's', openingBalance: 948_000 }]);
  assert.deepEqual(result.p1, { paidAmount: 30_000, remainingAmount: 70_000, status: 'partial' });
});
test('duplicate recipe lines preserve the sum for mixed line, unit and inventory costs', () => {
  const inventory = [{ id: 'flour', unitCost: 50 }];
  const cases = [
    [{ inventoryId: 'flour', quantity: 2, lineCost: 180 }, { inventoryId: 'flour', quantity: 3 }],
    [{ inventoryId: 'flour', quantity: 2, unitCost: 100 }, { inventoryId: 'flour', quantity: 3, unitCost: 70 }],
    [{ inventoryId: 'flour', quantity: 2 }, { inventoryId: 'flour', quantity: 3 }],
  ];
  for (const ingredients of cases) {
    const expected = calculateRecipeCost(ingredients, inventory);
    for (const order of [ingredients, [...ingredients].reverse()]) {
      const merged = normalizeRecipeIngredients(order, inventory);
      assert.equal(merged.length, 1);
      assert.equal(merged[0].quantity, 5);
      assert.equal(calculateRecipeCost(merged, inventory), expected);
    }
  }
});
test('same-day receipt price follows stored chronology, never random UUID order', () => {
  const inventory = [{ id: 'flour', stock: 10, unitCost: 1, unitsPerPackage: 1000 }];
  const latest = { id: 'aaa-new', inventoryId: 'flour', type: 'receipt', date: '2026-09-25', unitCost: 3, previousUnitCost: 2 };
  const earlier = { ...latest, id: 'zzz-old', unitCost: 2, previousUnitCost: 1 };
  const movements = [latest, earlier];
  assert.equal(receiptCostsForInventory(inventory, movements)[0].unitCost, 3);
  assert.equal(bypassRemovedReceiptCost(movements, earlier)[0].previousUnitCost, 1);
});
test('malformed balance adjustment date is reported rather than crashing the supplier screen', () => {
  const ledger = supplierLedger({ id: 's', balance: 100, openingBalance: 100, balanceEdits: [{ at: 'invalid', openingBalance: 100, previousOpeningBalance: 0 }] }, []);
  assert.equal(ledger.incomplete, true);
});
test('audit distinguishes errors and missing evidence without mutating financial data', () => {
  const state = { inventory: [{ id: 'i', name: 'Un', stock: -2 }], recipes: [], suppliers: [], transactions: [],
    sales: [
      { id: 'a', date: '2026-09-25', source: 'pos', externalId: 'same', totalRevenue: 1000, quantity: 1, totalCost: 0 },
      { id: 'b', date: '2026-09-25', source: 'pos', externalId: 'same', totalRevenue: 1000, quantity: 1, totalCost: 0 },
    ] };
  const snapshot = structuredClone(state);
  const audit = auditBusinessState(state);
  assert.equal(audit.errorCount, 1);
  assert.equal(audit.issues.find((issue) => issue.code === 'duplicate_sales').count, 1);
  assert.equal(audit.issues.find((issue) => issue.code === 'estimated_pos_revenue').severity, 'review');
  assert.equal(audit.issues.find((issue) => issue.code === 'negative_stock').count, 1);
  assert.deepEqual(state, snapshot);
});
test('tax reserve is separately exposed and never changes the already saved rate', () => {
  const report = calculateDailyReport({ sales: [{ id: 's', date: '2026-09-25', source: 'pos', quantity: 1, totalRevenue: 100_000, totalCost: 40_000, taxPctAtSale: 10, cardCommissionPctAtSale: 0 }], costRules: { taxPct: 20 } }, '2026-09-25');
  assert.equal(report.taxReserve, 10_000);
  assert.equal(report.netProfit, 50_000);
  assert.equal(report.operatingProfitBeforeTaxReserve, 60_000);
});
test('unknown product cannot silently become an expense because its name was mistyped', () => {
  const state = { inventory: [], suppliers: [], transactions: [], accounts: [{ id: 'cash' }] };
  const body = { operationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', supplierName: 'Coupang', date: '2026-09-25', paidAmount: 0, lines: [{ name: 'Salfetka', unit: 'dona', quantity: 1, amount: 1000 }] };
  assert.throws(() => applyUnifiedIntake(state, body), /omborda topilmadi/);
  const saved = applyUnifiedIntake(state, { ...body, lines: body.lines.map((line) => ({ ...line, expenseConfirmed: true })) }).state;
  assert.equal(saved.suppliers[0].balance, 1000);
  assert.equal(saved.financialEntries[0].amount, 1000);
});
test('delivery profitability is reviewed per order after fees, not per split item', () => {
  const state = { sales: [
    { id: 'a', source: 'delivery', deliveryBatchId: 'order', totalRevenue: 5000, totalCost: 6000, deliveryCommissionAmount: 500 },
    { id: 'b', source: 'delivery', deliveryBatchId: 'order', totalRevenue: 10000, totalCost: 1000, deliveryCommissionAmount: 500 },
    { id: 'c', source: 'delivery', deliveryBatchId: 'loss', totalRevenue: 5000, totalCost: 4000, deliveryCommissionAmount: 1500 },
  ] };
  const issue = auditBusinessState(state).issues.find((row) => row.code === 'delivery_loss');
  assert.equal(issue.count, 1);
  assert.deepEqual(issue.examples, ['loss']);
});
