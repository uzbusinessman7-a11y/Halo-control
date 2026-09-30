import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { resetV2Journals } = await import('../app/core/v2-reset.ts');
const { runBridge } = await import('../app/core/bridge-sync.ts');
const { runStockBridge } = await import('../app/core/stock-bridge.ts');
const { completeCutover } = await import('../app/lib/cutover.ts');
function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; },
    _exec: () => sqlite.prepare(query).run(...params),
  });
  return { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
}
const scope = { tenantId: 'halo', branchId: 'main' };
const state = { accounts: [{ id: 'cash', name: 'Kassa', type: 'cash', openingBalance: 0 }], sales: [{ id: 's', date: '2026-09-20', totalRevenue: 1000, accountId: 'cash' }], inventory: [{ id: 'g', name: 'G', unit: 'g', stock: 5 }], stockMovements: [{ id: 'r', inventoryId: 'g', type: 'receipt', quantity: 5, date: '2026-09-20' }] };

test('yakuniy ko‘chirish: jurnallar toza qaytadan quriladi; o‘tishdan keyin taqiqlangan', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = d1(sqlite);
  globalThis.__HALO_CONTROL_DB__ = db;
  globalThis.__HALO_SELF_HOSTED__ = true;
  await runBridge(db, scope, state, '2026-09-30');
  await runStockBridge(db, scope, state, '2026-09-30');
  const dropped = await resetV2Journals(db);
  assert.ok(dropped.includes('v2_ledger_entries') && dropped.includes('v2_stock_moves'));
  const again = await runBridge(db, scope, state, '2026-09-30');
  assert.equal(again.ok, true);
  assert.equal(again.reversed, 0, 'toza — teskari yozuvlarsiz');
  await completeCutover('Rahbar');
  await assert.rejects(resetV2Journals(db), /o'tishdan keyin/);
});
