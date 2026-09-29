import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/ombor/route.ts');
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
const url = 'https://halo.example.workers.dev/api/v2/ombor';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

test('faqat rahbar; sahifa skripti to‘g‘ri; AvT va hujjatsiz farq qaytadi', async () => {
  assert.equal((await GET(new Request(url))).status, 303);
  assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 401);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const payload = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  payload.inventory = [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 700, unitCost: 15 }];
  payload.stockMovements = [
    { id: 'r', inventoryId: 'g', type: 'receipt', quantity: 1000, unitCost: 15, date: today },
    { id: 'c', inventoryId: 'g', type: 'adjustment', quantity: -200, date: today, referenceId: 'inventory-count:x' },
  ];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(payload));
  const res = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.avt[0].varianceValue, -3000);
  assert.equal(res.bridge.mismatched, 1, '800 bo‘lishi kerak, 700 saqlangan — 100 g hujjatsiz');
  assert.equal(res.bridge.items[0].difference, 100);
});
