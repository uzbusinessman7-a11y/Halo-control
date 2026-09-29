import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/qarz/route.ts');
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
const url = 'https://halo.example.workers.dev/api/v2/qarz';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;

test('faqat rahbar; ro‘yxat va akt matni', async () => {
  assert.equal((await GET(new Request(url))).status, 303);
  assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 401);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const payload = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  payload.suppliers = [{ id: 'n', name: 'Nodir aka', openingBalance: 0, balance: 198000 }];
  payload.transactions = [{ id: 't', supplierId: 'n', type: 'purchase', amount: 198000, date: '2026-09-05' }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(payload));
  const list = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(list.bridge.totalDebt, 198000);
  const st = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', action: 'statement', partyId: list.bridge.parties[0].partyId, from: '2026-09-01', to: '2026-09-30' }) }))).json();
  assert.equal(st.statement.closing, 198000);
  assert.match(st.text, /30\.09\.2026 holatiga qarz: 198,000 ₩/);
});

test('qarz sahifasidan xarid va to‘lov kiritish: eski tizim API orqali saqlanadi va qarz yangilanadi', async () => {
  const records = await import('../app/api/supplier-records/route.ts');
  const list = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  const party = list.bridge.parties[0];
  assert.equal(party.oldId, 'n');
  const payload = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  payload.accounts = [{ id: 'cash', name: 'Naqd', type: 'cash', openingBalance: 500000 }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(payload));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const save = (tx) => records.POST(new Request('https://halo.example.workers.dev/api/supplier-records?branch=main', { method: 'POST', headers: owner, body: JSON.stringify({ action: 'saveTransaction', transaction: tx }) }));
  const p1 = await save({ id: 'v2-test-purchase-1', supplierId: 'n', type: 'purchase', amount: 50000, date: today, note: 'Go‘sht' });
  assert.equal(p1.status, 200, JSON.stringify(await p1.clone().json()));
  const p2 = await save({ id: 'v2-test-payment-1', supplierId: 'n', type: 'payment', amount: 100000, date: today, accountId: 'cash' });
  assert.equal(p2.status, 200);
  const after = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(after.bridge.parties[0].ledgerBalance, 198000 + 50000 - 100000);
  assert.equal(after.bridge.parties[0].difference, 0);
  assert.deepEqual(after.accounts, [{ id: 'cash', name: 'Naqd', type: 'cash' }]);
});
