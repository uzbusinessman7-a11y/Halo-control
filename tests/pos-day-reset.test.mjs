import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelPosDayImport, previewPosDayReset } from '../app/lib/pos-day-reset.ts';
import { applySaleInventoryAccounting } from '../app/lib/inventory-accounting.ts';
import { calculateDailyReport } from '../app/lib/daily-report.ts';
import { reconcilePosImport, newPosDuplicateId } from '../app/lib/pos-reconciliation.ts';
import { validDeletedItems } from '../app/lib/deleted-items.ts';

import { date, fixture } from './fixtures/pos-day-reset.mjs';
const command = async state => ({ date, token: (await previewPosDayReset(state, date)).token, operationId: 'pos-reset-local-0001' });
test('cancel restores exactly the historical stock and all derived money; leaves other days/channels and originals in archive', async () => {
  const state = fixture(), original = structuredClone(state);
  const preview = await previewPosDayReset(state, date);
  assert.equal(preview.count, 1); assert.equal(preview.revenue, 800000);
  assert.deepEqual(preview.stocks, [{ inventoryId: 'bread', name: 'NON', unit: 'dona', quantity: 4 }]);
  assert.equal(preview.effects.cardCommission, 12800); assert.equal(preview.effects.tax, 80000);
  assert.equal(preview.effects.bonusBefore, 21000); assert.equal(preview.effects.bonusAfter, 0);
  assert.deepEqual(preview.reopenedDates, [date, '2026-09-24']);
  const input = await command(state), cancelled = await cancelPosDayImport(state, input);
  const next = applySaleInventoryAccounting(state, cancelled.state);
  assert.equal(next.inventory[0].stock, 10); assert.equal(next.inventory[1].stock, 1000);
  assert.deepEqual(next.sales, original.sales.slice(1)); assert.deepEqual(next.stockMovements, [original.stockMovements[2]]);
  assert.deepEqual(next.dailyCloses, [original.dailyCloses[0]]);
  assert.equal(calculateDailyReport(next, date).revenue, 210000);
  assert.deepEqual(next.deletedItems[0].record, original.sales[0]); assert.deepEqual(next.deletedItems[0].related.movements, original.stockMovements.slice(0, 2));
  assert.equal(validDeletedItems(next.deletedItems), true);
  assert.deepEqual(next.transactions, original.transactions); assert.deepEqual(next.customData, original.customData);
  assert.deepEqual(state, original, 'preview and cancellation do not mutate their input');
  const retry = await cancelPosDayImport(next, input); assert.equal(retry.result.alreadyCancelled, true); assert.deepEqual(retry.state, next);
});
test('same Excel identity is importable again; retry cancellation after reimport cannot cancel the new sale', async () => {
  const before = fixture(), input = await command(before);
  const cancelled = applySaleInventoryAccounting(before, (await cancelPosDayImport(before, input)).state);
  const replacement = { ...before.sales[0], id: 'replacement', totalRevenue: 782500, unitPrice: 195625 };
  const row = { ...replacement, menuRevenue: 999999, revenueSource: 'pos_actual', rowNumber: 1 };
  assert.equal(reconcilePosImport([row], cancelled.sales).newRevenue, 782500);
  assert.equal(newPosDuplicateId(cancelled.sales, [replacement, ...cancelled.sales]), '');
  const reimported = applySaleInventoryAccounting(cancelled, { ...cancelled, sales: [replacement, ...cancelled.sales], stockMovements: [
    ...before.stockMovements.slice(0, 2).map(m => ({ ...m, id: `${m.id}-new`, referenceId: replacement.id })), ...cancelled.stockMovements] });
  assert.equal(reimported.inventory[0].stock, 6); assert.equal(reimported.inventory[1].stock, 1000);
  assert.equal(calculateDailyReport(reimported, date).cardSales, 792500);
  assert.equal(reconcilePosImport([row], reimported.sales).savedRows.length, 1);
  assert.equal((await cancelPosDayImport(reimported, input)).state, reimported);
  assert.equal(newPosDuplicateId(reimported.sales, [...reimported.sales, { ...replacement, id: 'old-archive-restored' }]), replacement.externalId);
});
test('stale previews, closed months, invalid dates and incomplete stock history are blocked atomically', async () => {
  const initial = fixture(), input = await command(initial);
  for (const change of [s => { s.sales[0].totalRevenue++; }, s => { s.stockMovements[0].quantity--; }, s => { s.dailyCloses[1].actualTotal++; }]) {
    const state = fixture(); change(state); const before = structuredClone(state);
    await assert.rejects(cancelPosDayImport(state, input), /o‘zgardi/); assert.deepEqual(state, before);
  }
  for (const month of ['2026-09', '2026-10']) await assert.rejects(previewPosDayReset({ ...fixture(), monthlyCloses: [{ month }] }, date), /yopilgan/);
  for (const invalid of ['', '2026-02-30', '2099-01-01']) await assert.rejects(previewPosDayReset(fixture(), invalid), /sanani/);
  const incomplete = fixture(); incomplete.stockMovements = incomplete.stockMovements.slice(1);
  await assert.rejects(previewPosDayReset(incomplete, date), /topilmadi/);
  const missing = fixture(); missing.inventory = missing.inventory.slice(1);
  await assert.rejects(previewPosDayReset(missing, date), /topilmadi/);
});
