import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { countSheet, saveCounts } = await import('../app/core/period-count.ts');
const { GET, POST } = await import('../app/api/v2/sanoq/route.ts');
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
const state = () => ({
  accounts: [{ id: 'cash', name: 'Naqd kassa', type: 'cash', openingBalance: 100000 }, { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 0 }],
  sales: [{ id: 's1', date: '2026-09-29', totalRevenue: 50000, accountId: 'cash' }, { id: 's2', date: '2026-10-01', totalRevenue: 70000, accountId: 'cash' }],
  inventory: [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 900, unitCost: 20 }, { id: 'k', name: 'Karam', unit: 'kg', stock: 3, expenseOnly: true }],
  stockMovements: [{ id: 'r', inventoryId: 'g', type: 'receipt', quantity: 1000, unitCost: 20, date: '2026-09-01' }, { id: 'x', inventoryId: 'g', type: 'sale', quantity: -100, date: '2026-09-20' }],
  suppliers: [{ id: 'n', name: 'Nodir aka', openingBalance: 0, balance: 300000 }],
  transactions: [{ id: 't', supplierId: 'n', type: 'purchase', amount: 300000, date: '2026-09-10' }],
});

test('sanoq varag‘i: sanagacha qoldiq, sabzavot kirmaydi; sanoq saqlanadi va farq chiqadi', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const db = d1(sqlite);
  const sheet = await countSheet(db, scope, state(), '2026-10-02', '2026-09-30');
  const cash = sheet.lines.find((l) => l.name === 'Naqd kassa');
  assert.equal(cash.system, 150000, '01.10 savdosi 30.09 qoldig‘iga kirmaydi');
  assert.equal(sheet.lines.some((l) => l.name === 'Karam'), false);
  const meat = sheet.lines.find((l) => l.domain === 'stock');
  assert.equal(meat.system, 900);
  const debt = sheet.lines.find((l) => l.domain === 'debt');
  const res = await saveCounts(db, scope, state(), '2026-10-02', { date: '2026-09-30', operationId: 'sanoq-000001', actor: 'Rahbar', counts: [
    { domain: 'money', refId: cash.refId, counted: 145000 },
    { domain: 'stock', refId: meat.refId, counted: 850.5 },
    { domain: 'debt', refId: debt.refId, counted: 300000 },
  ] });
  assert.equal(res.saved, 3);
  assert.equal(res.sheet.totals.money, -5000);
  assert.equal(res.sheet.totals.stock, -990, '−49,5 g × 20 ₩');
  assert.equal(res.sheet.totals.debt, 0);
  assert.equal(res.sheet.totals.counted, 3);
  const again = await saveCounts(db, scope, state(), '2026-10-02', { date: '2026-09-30', operationId: 'sanoq-000002', actor: 'Rahbar', counts: [{ domain: 'money', refId: cash.refId, counted: 150000 }] });
  assert.equal(again.sheet.totals.money, 0, 'qayta sanalsa oxirgisi amal qiladi');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v2_period_counts').get().n, 4, 'tarix saqlanadi');
  assert.throws(() => sqlite.prepare('DELETE FROM v2_period_counts').run(), /o'chirilmaydi/);
  await assert.rejects(saveCounts(db, scope, state(), '2026-10-02', { date: '2026-09-30', operationId: 'sanoq-000003', actor: 'Rahbar', counts: [{ domain: 'money', refId: cash.refId, counted: 10.5 }] }), /butun won/);
  await assert.rejects(countSheet(db, scope, state(), '2026-10-02', '2026-10-05'), /kelajak/);
});

test('sahifa: faqat rahbar, skript to‘g‘ri, varaq qaytadi', async () => {
  globalThis.__HALO_CONTROL_DB__ = d1(new DatabaseSync(':memory:'));
  globalThis.__HALO_SELF_HOSTED__ = true;
  const url = 'https://halo.example.workers.dev/api/v2/sanoq';
  const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
  assert.equal((await GET(new Request(url))).status, 303);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const res = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(res.ok, true);
  assert.ok(Array.isArray(res.sheet.lines));
});
