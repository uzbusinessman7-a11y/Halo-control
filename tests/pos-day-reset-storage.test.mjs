import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture, date } from './fixtures/pos-day-reset.mjs';
import { calculateDailyReport } from '../app/lib/daily-report.ts';

test('built owner API atomically cancels imports, refunds stock once, accepts reimport, and rejects duplicates/unauthorized/stale edits', async () => {
  const sqlite = new DatabaseSync(':memory:'); let failUpdate = false;
  const db = { prepare(query) { let values = []; return {
    bind(...v) { values = v; return this; },
    async first(column) { const r = sqlite.prepare(query).get(...values); return column ? r?.[column] ?? null : r ?? null; },
    async all() { return { results: sqlite.prepare(query).all(...values) }; },
    async run() { if (failUpdate && query.startsWith('UPDATE app_state SET payload')) throw new Error('Simulated storage failure'); return { meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } }; },
  }; }, async batch(q) { const out = []; for (const s of q) out.push(await s.run()); return out; }, async exec(s) { sqlite.exec(s); return { count: 1, duration: 0 }; } };
  const { default: worker } = await import('../dist/server/index.js');
  const env = { DB: db, ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
  const call = (path, body, owner = true, method = body ? 'POST' : 'GET') => worker.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(owner ? { 'oai-authenticated-user-email': 'owner@halo-local-test.invalid' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, { waitUntil() {}, passThroughOnException() {} });
  const read = () => JSON.parse(sqlite.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
  const revision = () => sqlite.prepare('SELECT updated_at FROM app_state WHERE id=?').get('main').updated_at;
  try {
    await call('/api/worker-auth?bootstrap=1', undefined, false);
    const seed = { ...read(), ...fixture(), inventoryAccountingVersion: 1, vegetableExpenseVersion: 1 };
    sqlite.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(seed), 'local-pos-reset-fixture', 'main');
    assert.equal((await call('/api/pos-day-reset', { action: 'preview', date }, false)).status, 401);
    assert.equal((await call('/api/pos-day-reset', { action: 'cancel', date }, false)).status, 401);
    let response = await call('/api/pos-day-reset', { action: 'preview', date });
    assert.equal(response.status, 200, await response.clone().text());
    const preview = await response.json(); assert.equal(preview.count, 1);
    const before = read(), beforeRevision = revision();
    const body = { action: 'cancel', date, token: preview.token, operationId: 'api-pos-reset-local-001' };
    failUpdate = true;
    response = await call('/api/pos-day-reset', body); assert.equal(response.status, 500);
    assert.deepEqual(read(), before, 'failed write leaves revenue, stock and archives unchanged'); assert.equal(revision(), beforeRevision);
    failUpdate = false;
    const results = await Promise.all([call('/api/pos-day-reset', body), call('/api/pos-day-reset', body)]);
    for (const r of results) assert.equal(r.status, 200, await r.clone().text());
    const cancelled = read();
    assert.equal(cancelled.inventory[0].stock, 10); assert.equal(cancelled.inventory[1].stock, 1000);
    assert.equal(cancelled.sales.length, before.sales.length - 1); assert.equal(cancelled.deletedItems.filter(a => a.kind === 'sale').length, 1);
    assert.deepEqual(cancelled.sales, before.sales.slice(1)); assert.deepEqual(cancelled.dailyCloses, [before.dailyCloses[0]]);
    assert.equal(cancelled.auditLog.length, before.auditLog.length + 1);
    assert.equal(calculateDailyReport(cancelled, date).revenue, 210000);
    for (const key of ['accounts', 'transactions', 'financialEntries', 'recipes', 'payrollPayments', 'customData']) assert.deepEqual(cancelled[key], before[key]);
    assert.ok(sqlite.prepare('SELECT COUNT(*) AS n FROM halo_state_backups WHERE section=?').get('POS savdo').n > 0);
    // Reimport through the real owner save endpoint, with the same Excel identity and corrected actual amount.
    const sale = { ...before.sales[0], id: 'new-import', unitPrice: 195625, totalRevenue: 782500 };
    const movements = before.stockMovements.slice(0, 2).map(m => ({ ...m, id: `${m.id}-reimport`, referenceId: sale.id }));
    response = await call('/api/state', { ...cancelled, updatedAt: revision(), sales: [sale, ...cancelled.sales], stockMovements: [...movements, ...cancelled.stockMovements] }, true, 'PUT');
    assert.equal(response.status, 200, await response.clone().text());
    const imported = read(); assert.equal(imported.inventory[0].stock, 6); assert.equal(imported.inventory[1].stock, 1000);
    assert.equal(calculateDailyReport(imported, date).cardSales, 792500);
    assert.equal(calculateDailyReport(imported, date).cardCommission, 12680);
    assert.equal(calculateDailyReport(imported, date).tax, 79250);
    response = await call('/api/pos-day-reset', body); assert.equal((await response.json()).alreadyCancelled, true); assert.deepEqual(read(), imported);
    response = await call('/api/state', { ...imported, updatedAt: revision(), sales: [{ ...sale, id: 'duplicate-import' }, ...imported.sales] }, true, 'PUT');
    assert.equal(response.status, 409, await response.clone().text()); assert.deepEqual(read(), imported);
    response = await call('/api/pos-day-reset', { ...body, operationId: 'api-pos-reset-local-002' });
    assert.equal(response.status, 409); assert.deepEqual(read(), imported, 'old confirmation cannot delete the replacement import');
  } finally { sqlite.close(); delete globalThis.__HALO_CONTROL_DB__; }
});
