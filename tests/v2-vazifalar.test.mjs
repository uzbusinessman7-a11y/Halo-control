import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const page = await import('../app/api/v2/vazifalar/route.ts');
const tasks = await import('../app/api/worker-tasks/route.ts');

test('vazifalar: rahbar yuboradi, xodim ilovasida ko‘radi va bajaradi, rahbar holatni ko‘radi', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const make = (query, params = []) => ({ bind: (...v) => make(query, v), all: async () => ({ results: sqlite.prepare(query).all(...params) }), first: async () => sqlite.prepare(query).get(...params) ?? null, run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(query).run(...params) });
  globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  globalThis.__HALO_SELF_HOSTED__ = true;
  const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
  assert.equal((await page.GET(new Request('https://x.example/api/v2/vazifalar'))).status, 303);
  const html = await (await page.GET(new Request('https://x.example/api/v2/vazifalar', { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
  const wid = await createWorkerAccount('main', 'Ali', 'ali', '1234');
  const sent = await (await tasks.POST(new Request('https://x.example/api/worker-tasks', { method: 'POST', headers: owner, body: JSON.stringify({ action: 'create-bulk', branchId: 'main', branchName: 'HALO', workerIds: [wid], title: 'Muzlatkichni tozalash', description: '', priority: 'urgent', dueAt: '2026-10-01T18:00' }) }))).json();
  assert.equal(sent.created, 1, JSON.stringify(sent));
  const cookie = (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0];
  const mine = await (await tasks.GET(new Request('https://x.example/api/worker-tasks', { headers: { cookie } }))).json();
  assert.equal(mine.tasks[0].title, 'Muzlatkichni tozalash');
  assert.equal(mine.tasks[0].dueAt, '2026-10-01T18:00');
  const done = await tasks.PATCH(new Request('https://x.example/api/worker-tasks', { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ taskId: mine.tasks[0].id, status: 'done' }) }));
  assert.equal(done.status, 200);
  const admin = await (await tasks.GET(new Request('https://x.example/api/worker-tasks?admin=1&branch=main', { headers: owner }))).json();
  assert.equal(admin.tasks[0].status, 'done');
});
