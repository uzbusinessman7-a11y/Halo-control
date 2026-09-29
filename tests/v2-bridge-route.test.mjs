import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/admin/v2/bridge/route.ts');

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

const OWNER = 'owner@example.com';
const url = 'https://halo.example.workers.dev/api/admin/v2/bridge';
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);

test('begona odam kira olmaydi', async () => {
  globalThis.__HALO_SELF_HOSTED__ = true;
  assert.equal((await GET(new Request(url))).status, 303);
  assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 401);
});

test('rahbar: sahifa skripti to‘g‘ri, ko‘prik haqiqiy filial holatida ishlaydi', async () => {
  globalThis.__HALO_SELF_HOSTED__ = true;
  const headers = { 'oai-authenticated-user-email': OWNER };
  const html = await (await GET(new Request(url, { headers }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const payload = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  payload.sales = [{ id: 's1', date: '2026-09-28', totalRevenue: 7000, accountId: 'account-cash' }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(payload));
  const res = await (await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.report.posted, 1);
  assert.ok(res.report.comparison.every((row) => row.difference === 0));
});

test('eski saytda ishlamaydi', async () => {
  globalThis.__HALO_SELF_HOSTED__ = false;
  const res = await POST(new Request(url, { method: 'POST', headers: { 'oai-authenticated-user-email': OWNER }, body: '{}' }));
  assert.equal(res.status, 403);
});
