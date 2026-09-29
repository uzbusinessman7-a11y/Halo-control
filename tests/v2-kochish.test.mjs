import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/kochish/route.ts');
const { runScheduledJobs } = await import('../app/lib/scheduled-jobs.ts');
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
const url = 'https://halo.example.workers.dev/api/v2/kochish';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const post = async (body) => { const r = await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

test('ko‘chish: holat, tasdiqsiz yakunlanmaydi, KOCHISH bilan yakunlanadi va qaytariladi; cron faqat o‘tishdan keyin', async () => {
  globalThis.__HALO_CONTROL_DB__ = d1(new DatabaseSync(':memory:'));
  globalThis.__HALO_SELF_HOSTED__ = true;
  assert.equal((await GET(new Request(url))).status, 303);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const s = await post({});
  assert.equal(s.body.ok, true);
  assert.equal(s.body.cutover.completed, false);
  assert.equal(s.body.branches[0].staff, 0);
  assert.equal((await runScheduledJobs()).skipped, 'parallel-mode');
  assert.equal((await post({ action: 'complete', confirm: 'ha' })).status, 400);
  const done = await post({ action: 'complete', confirm: 'kochish' });
  assert.equal(done.body.cutover.completed, true);
  const jobs = await runScheduledJobs();
  assert.equal(jobs.skipped, null);
  assert.equal(jobs.branches[0].skipped, 'disabled', 'bot ulanmagan — hech narsa yuborilmaydi');
  const back = await post({ action: 'revert', confirm: 'QAYTARISH' });
  assert.equal(back.body.cutover.completed, false);
});
