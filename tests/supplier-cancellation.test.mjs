import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { cancelSupplierTransaction } from '../app/lib/supplier-cancellation.ts';
import { validDeletedItems } from '../app/lib/deleted-items.ts';

const original = { id: 'intake:original-sauce', supplierId: 'nodir', type: 'purchase', amount: 198000, date: '2026-09-26', note: 'SOUS', intakeId: 'intake:original-sauce', intakeLines: [{ inventoryId: 'sauce', quantity: 4000, amount: 198000 }] };
const duplicate = { id: 'manual-duplicate', supplierId: 'nodir', type: 'purchase', amount: 198000, date: '2026-09-26', note: 'SOUS', supplierLedgerOnly: true };
const fixture = () => ({ suppliers: [{ id: 'nodir', name: 'Nodir aka', balance: 396000, openingBalance: 0 }, { id: 'other', name: 'Other', balance: 7000 }], transactions: [duplicate, original], inventory: [{ id: 'sauce', name: 'SOUS', unit: 'g', stock: 4000, unitCost: 49.5 }], stockMovements: [{ id: 'receipt', intakeId: original.id, type: 'receipt', inventoryId: 'sauce', date: '2026-09-26', quantity: 4000, unitCost: 49.5 }], financialEntries: [], deletedItems: [], monthlyCloses: [], sales: [{ id: 'old-sale', totalRevenue: 26000 }], vegetablePurchases: [] });
const request = () => ({ id: duplicate.id, operationId: 'cancel-duplicate-198000', expectedTransaction: structuredClone(duplicate), expectedBalance: 396000, reason: '198 ming qarz ikki marta kiritilgan' });
const now = new Date('2026-09-27T09:30:00Z');

test('cancel only duplicate 198000 debt; preserve original, stock, sales, payments and full history', () => {
  const before = fixture(), untouched = structuredClone(before);
  const { state, result } = cancelSupplierTransaction(before, request(), now);
  assert.equal(result.balance, 198000); assert.equal(state.suppliers[0].balance, 198000);
  assert.deepEqual(state.transactions, [original]); assert.deepEqual(before, untouched);
  for (const key of ['inventory', 'stockMovements', 'financialEntries', 'sales', 'vegetablePurchases']) assert.deepEqual(state[key], before[key]);
  assert.deepEqual(state.suppliers[1], before.suppliers[1]);
  assert.equal(state.deletedItems.length, 1); assert.ok(validDeletedItems(state.deletedItems));
  assert.deepEqual(state.deletedItems[0].record, duplicate);
  assert.equal(state.deletedItems[0].reason, request().reason);
  assert.equal(state.deletedItems[0].deletedBy, 'Rahbar');
  assert.equal(state.deletedItems[0].deletedAt, now.toISOString());
  const replay = cancelSupplierTransaction(state, request(), now);
  assert.equal(replay.result.alreadySaved, true); assert.deepEqual(replay.state, state);
});

test('stale edits, stale balances, linked original, restored retries and closed months are blocked', () => {
  assert.throws(() => cancelSupplierTransaction(fixture(), { ...request(), expectedBalance: 395000 }), /boshqa oynada/);
  assert.throws(() => cancelSupplierTransaction(fixture(), { ...request(), expectedTransaction: { ...duplicate, amount: 197000 } }), /boshqa oynada/);
  assert.throws(() => cancelSupplierTransaction(fixture(), { ...request(), id: original.id, expectedTransaction: original }), /ombor kirimiga/);
  const next = cancelSupplierTransaction(fixture(), request(), now).state;
  assert.throws(() => cancelSupplierTransaction(next, { ...request(), reason: 'boshqa sabab' }), /boshqa ma’lumot/);
  const restored = structuredClone(next); restored.deletedItems[0].restoredAt = now.toISOString();
  assert.throws(() => cancelSupplierTransaction(restored, request()), /tiklangan/);
  assert.throws(() => cancelSupplierTransaction({ ...fixture(), monthlyCloses: [{ id: 'monthly-close:2026-09', month: '2026-09', closedAt: now.toISOString(), inventoryItems: [], payrollItems: [] }] }, request()), /oy yopilgan/);
});

test('cancellation retains credit if earlier payment exceeds remaining purchases', () => {
  const state = fixture(); state.suppliers[0].balance = 100000;
  const payment = { id: 'real-payment', supplierId: 'nodir', type: 'payment', amount: 296000, date: '2026-09-26' };
  state.transactions.push(payment); state.financialEntries.push({ id: 'cash-out', transactionId: payment.id, amount: payment.amount });
  const out = cancelSupplierTransaction(state, { ...request(), expectedBalance: 100000 });
  assert.equal(out.state.suppliers[0].balance, -98000);
  assert.deepEqual(out.state.financialEntries, state.financialEntries);
  assert.ok(out.state.transactions.some(t => t.id === payment.id));
});

test('payment cancellation archives linked money once and preserves other entries', () => {
  const state = fixture(); const payment = { id: 'wrong-payment', supplierId: 'nodir', type: 'payment', date: '2026-09-26', amount: 98000, accountId: 'cash' };
  const entry = { id: 'cash-out', transactionId: payment.id, amount: 98000, type: 'expense', date: payment.date, accountId: 'cash' };
  state.suppliers[0].balance = 298000; state.transactions.push(payment); state.financialEntries.push(entry);
  const body = { ...request(), id: payment.id, expectedTransaction: payment, expectedBalance: 298000 };
  const next = cancelSupplierTransaction(state, body).state;
  assert.equal(next.suppliers[0].balance, 396000); assert.deepEqual(next.financialEntries, []);
  assert.deepEqual(next.deletedItems[0].related.financialEntry, entry);
  assert.equal(cancelSupplierTransaction(next, body).result.alreadySaved, true);
});

test('built cancellation API: owner only, atomic persistence, branch isolation and retry after reload', async () => {
  const sql = new DatabaseSync(':memory:');
  const db = { prepare(query) { let values = []; return { bind(...v) { values = v; return this; }, async first(column) { const r = sql.prepare(query).get(...values); return column ? r?.[column] ?? null : r ?? null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; } }; }, async batch(q) { const out = []; for (const s of q) out.push(await s.run()); return out; }, async exec(s) { sql.exec(s); return { count: 1, duration: 0 }; } };
  const { default: worker } = await import('../dist/server/index.js');
  const env = { DB: db, ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
  const call = (body, owner = true, branch = 'main') => worker.fetch(new Request(`http://localhost${body ? '/api/supplier-records?branch=' + branch : '/api/worker-auth?bootstrap=1'}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(owner ? { 'oai-authenticated-user-email': 'owner@cancellation-local-test.invalid' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil() {}, passThroughOnException() {} });
  const read = () => JSON.parse(sql.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
  try {
    await call();
    const seed = { ...read(), ...fixture(), sales: [], vegetableExpenseVersion: 1, vegetableExpenseStartedAt: '2026-09-01T00:00:00Z' };
    sql.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(seed), 'seed', 'main');
    const body = { action: 'cancelTransaction', ...request() };
    assert.equal((await call(body, false)).status, 401); assert.equal(read().suppliers[0].balance, 396000);
    let response = await call(body, true, 'unrelated-branch'); assert.notEqual(response.status, 200); assert.equal(read().suppliers[0].balance, 396000);
    response = await call(body); assert.equal(response.status, 200, await response.clone().text());
    assert.equal(read().suppliers[0].balance, 198000); assert.deepEqual(read().transactions, [original]);
    assert.deepEqual(read().inventory, seed.inventory); assert.deepEqual(read().stockMovements, seed.stockMovements);
    assert.deepEqual(read().financialEntries, []); assert.deepEqual(read().deletedItems[0].record, duplicate);
    response = await call(body); assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).alreadySaved, true);
    assert.equal(read().suppliers[0].balance, 198000); assert.equal(read().deletedItems.length, 1);
    response = await call({ action: 'saveTransaction', transaction: duplicate }); assert.equal(response.status, 409); assert.equal(read().suppliers[0].balance, 198000);
  } finally { sql.close(); delete globalThis.__HALO_CONTROL_DB__; }
});
