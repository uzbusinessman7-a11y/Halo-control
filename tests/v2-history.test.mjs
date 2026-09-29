import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/tarix/route.ts');
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
const url = 'https://halo.example.workers.dev/api/v2/tarix';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };

test('tarix: eski tizimda o‘zgartirilgan savdo va o‘chirilgan xarid ko‘rinadi', async () => {
  const sqlite = new DatabaseSync(':memory:');
  globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
  globalThis.__HALO_SELF_HOSTED__ = true;
  assert.equal((await GET(new Request(url))).status, 303);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const set = (fn) => { const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload); fn(p); sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p)); };
  set((p) => {
    p.accounts = [{ id: 'cash', name: 'Kassa', type: 'cash', openingBalance: 0 }];
    p.sales = [{ id: 's1', date: '2026-09-20', totalRevenue: 10000, accountId: 'cash' }];
    p.suppliers = [{ id: 'n', name: 'Nodir aka', openingBalance: 0, balance: 5000 }];
    p.transactions = [{ id: 't1', supplierId: 'n', type: 'purchase', amount: 5000, date: '2026-09-21' }];
  });
  const first = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(first.items.length, 0);
  set((p) => { p.sales[0].totalRevenue = 9000; p.transactions = []; p.suppliers[0].balance = 0; });
  const res = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(res.ok, true);
  const sale = res.items.find((i) => i.area === 'pul');
  assert.match(sale.what, /Savdo bekor qilindi/);
  assert.equal(sale.amount, 10000);
  assert.equal(sale.severity, 'warn', 'o‘zgartirilgan — sariq');
  const debt = res.items.find((i) => i.area === 'qarz');
  assert.match(debt.what, /Nodir aka: yozuv bekor qilindi/);
});
