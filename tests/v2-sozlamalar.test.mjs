import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/sozlamalar/route.ts');
const { createWorkerAccount } = await import('../app/lib/worker-auth.ts');
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
const url = 'https://halo.example.workers.dev/api/v2/sozlamalar';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };

test('sozlamalar: sahifa; akkauntni xodimga bog‘lash — bitta akkaunt bitta xodimda', async () => {
  const sqlite = new DatabaseSync(':memory:');
  globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
  globalThis.__HALO_SELF_HOSTED__ = true;
  assert.equal((await GET(new Request(url))).status, 303);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.staff = [{ id: 'a', name: 'Aziz', payType: 'hourly', hourlyRate: 10000 }, { id: 'l', name: 'Lola', payType: 'hourly', hourlyRate: 10000 }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const workerId = await createWorkerAccount('main', 'Aziz', 'aziz', '1234');
  const call = async (body) => (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) }))).json();
  let r = await call({ action: 'link', workerId, staffId: 'a' });
  assert.equal(r.staff.find((m) => m.id === 'a').workerId, workerId);
  r = await call({ action: 'link', workerId, staffId: 'l' });
  assert.equal(r.staff.find((m) => m.id === 'a').workerId, '', 'eski bog‘lanish olib tashlandi');
  assert.equal(r.staff.find((m) => m.id === 'l').workerId, workerId);
});
