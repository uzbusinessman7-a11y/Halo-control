import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { runStockBridge, stockItemCode, moveKindOf } = await import('../app/core/stock-bridge.ts');
const { avtReport, stockBalances, toMilli, fromMilli, validateMove } = await import('../app/core/stock.ts');

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
const today = '2026-09-29';

/** Go'sht: kirim 5 kg, 20 savdo × 120.5 g, chiqit 200 g, sanoqda 300 g kamomad. */
function oldState() {
  const movements = [{ id: 'r1', inventoryId: 'goosht', type: 'receipt', quantity: 5000, unitCost: 15, date: '2026-09-01' }];
  for (let i = 0; i < 20; i += 1) movements.push({ id: `s${i}`, inventoryId: 'goosht', type: 'sale', quantity: -120.5, theoreticalQuantity: 120.5, date: '2026-09-10', referenceId: `sale-${i}` });
  movements.push({ id: 'w1', inventoryId: 'goosht', type: 'waste', quantity: -200, date: '2026-09-12', note: 'Kuygan' });
  movements.push({ id: 'c1', inventoryId: 'goosht', type: 'adjustment', quantity: -300, unitCost: 15, date: '2026-09-20', referenceId: 'inventory-count:op1' });
  movements.push({ id: 'r2', inventoryId: 'lavash', type: 'receipt', quantity: 100, unitCost: 300, date: '2026-09-01' });
  movements.push({ id: 'sv', inventoryId: 'sous', type: 'sale', quantity: 0, theoreticalQuantity: 30, date: '2026-09-10' });
  const gooshtStock = 5000 - 20 * 120.5 - 200 - 300;
  return {
    inventory: [
      { id: 'goosht', name: 'Go‘sht', unit: 'g', stock: gooshtStock, unitCost: 15 },
      { id: 'lavash', name: 'Lavash', unit: 'dona', stock: 95, unitCost: 300 },
      { id: 'sous', name: 'Sous', unit: 'g', stock: 0, unitCost: 4, expenseOnly: true },
    ],
    stockMovements: movements,
  };
}

async function db() { const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON'); return { sqlite, db: d1(sqlite) }; }

test('har bir mahsulot qoldig‘i eski tizim bilan milligrammgacha solishtiriladi; hujjatsiz o‘zgarish ushlanadi', async () => {
  const { db: database } = await db();
  const report = await runStockBridge(database, scope, oldState(), today);
  const byName = new Map(report.items.map((row) => [row.name, row]));
  assert.equal(byName.get('Go‘sht').difference, 0);
  assert.equal(byName.get('Go‘sht').ledgerStock, 2090);
  assert.equal(byName.get('Lavash').oldStock, 95);
  assert.equal(byName.get('Lavash').ledgerStock, 100);
  assert.equal(byName.get('Lavash').difference, 5, 'qoldiq 100 → 95 harakatsiz o‘zgartirilgan — 5 dona hujjatsiz');
  assert.equal(report.mismatched, 1);
  assert.equal(report.items[0].name, 'Lavash', 'eng katta farq birinchi');
});

test('AvT: nazariy sarf, qayd etilgan chiqit va sanoq kamomadi — gramm, won va foizda', async () => {
  const { db: database } = await db();
  await runStockBridge(database, scope, oldState(), today);
  const report = await avtReport(database, scope, '2026-09-01', '2026-09-30');
  const meat = report.find((row) => row.name === 'Go‘sht');
  assert.deepEqual({ receipts: meat.receipts, theoretical: meat.theoretical, waste: meat.recordedWaste, variance: meat.countVariance, value: meat.varianceValue, pct: meat.variancePercent },
    { receipts: 5000, theoretical: 2410, waste: 200, variance: -300, value: -4500, pct: -12.4 });
  assert.equal(report[0].name, 'Go‘sht', 'eng katta yo‘qotish birinchi');
  const sauce = report.find((row) => row.name === 'Sous');
  assert.equal(sauce.theoretical, 30, 'xarajat mahsuloti ham retsept bo‘yicha nazariy sarfni ko‘rsatadi');
});

test('takror ishga tushirish takror yozmaydi; o‘chirilgan harakat teskari yoziladi va AvT dan chiqadi', async () => {
  const { db: database, sqlite } = await db();
  const state = oldState();
  const first = await runStockBridge(database, scope, state, today);
  assert.equal((await runStockBridge(database, scope, state, today)).posted, 0);
  state.stockMovements = state.stockMovements.filter((m) => m.id !== 'w1' && m.id !== 'sv');
  state.inventory[0].stock += 200;
  const again = await runStockBridge(database, scope, state, today);
  assert.equal(again.reversed, 2);
  assert.equal(again.items.find((r) => r.name === 'Go‘sht').difference, 0);
  const avt = await avtReport(database, scope, '2026-09-01', '2026-09-30');
  assert.equal(avt.find((r) => r.name === 'Go‘sht').recordedWaste, 0);
  assert.equal(avt.find((r) => r.name === 'Sous'), undefined, 'bekor qilingan nazariy sarf ham chiqdi');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM v2_stock_moves WHERE operation_id = 'bridge:m:w1'").get().n, 1, 'asl harakat tarixda');
  assert.equal(first.posted, 25);
});

test('keyin o‘zgartirilgan eski harakat jim o‘tmaydi', async () => {
  const { db: database } = await db();
  const state = oldState();
  await runStockBridge(database, scope, state, today);
  state.stockMovements[1].quantity = -120.4;
  const report = await runStockBridge(database, scope, state, today);
  assert.deepEqual(report.changed, ['harakat:s0']);
});

test('baza ombor harakatini o‘zgartirish va o‘chirishni rad etadi', async () => {
  const { db: database, sqlite } = await db();
  await runStockBridge(database, scope, oldState(), today);
  assert.throws(() => sqlite.exec('UPDATE v2_stock_moves SET quantity_milli = 1'), /o'zgartirilmaydi/);
  assert.throws(() => sqlite.exec('DELETE FROM v2_stock_moves'), /o'chirilmaydi/);
  assert.throws(() => sqlite.exec("UPDATE v2_stock_items SET unit = 'kg'"), /o'zgartirilmaydi/);
});

test('milli-birlik aniqligi: kasr gramm yig‘indisi drift qilmaydi', () => {
  let milli = 0, float = 0;
  for (let i = 0; i < 1000; i += 1) { milli += toMilli(0.1); float += 0.1; }
  assert.equal(fromMilli(milli), 100);
  assert.notEqual(float, 100, 'oddiy kasr qo‘shish drift qiladi — shuning uchun milli ishlatiladi');
  assert.equal(moveKindOf({ type: 'adjustment', referenceId: 'inventory-count:x' }), 'count');
  assert.equal(moveKindOf({ type: 'adjustment' }), 'adjustment');
  assert.match(stockItemCode("x'; DROP"), /^[a-z0-9_-]{2,60}$/);
  assert.throws(() => validateMove({ operationId: 'op-00000001', itemId: 'x', date: today, kind: 'sale', quantityMilli: 0, actor: 'a' }, new Map([['x', {}]])), /0 bo'lmasin/);
});
