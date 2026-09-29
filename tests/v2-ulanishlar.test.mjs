import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET } = await import('../app/api/v2/ulanishlar/route.ts');
const { shell } = await import('../app/core/ui-shell.ts');

test('ulanishlar sahifasi va “⋯” menyu', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const make = (q, p = []) => ({ bind: (...v) => make(q, v), all: async () => ({ results: sqlite.prepare(q).all(...p) }), first: async () => sqlite.prepare(q).get(...p) ?? null, run: async () => { const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(q).run(...p) });
  globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => make(q), batch: async (st) => st.map((s) => s._exec()) };
  globalThis.__HALO_SELF_HOSTED__ = true;
  const url = 'https://halo.example.workers.dev/api/v2/ulanishlar';
  assert.equal((await GET(new Request(url))).status, 303);
  const html = await (await GET(new Request(url, { headers: { 'oai-authenticated-user-email': 'owner@example.com' } }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /id="moreBtn"/);
  for (const href of ['/api/v2/ulanishlar', '/api/v2/sozlamalar', '/api/v2/sanoq', '/api/v2/tarix', '/api/v2/kochish']) assert.ok(html.includes(`href="${href}"`), href);
  const worker = shell({ title: 'x', active: null, body: '', script: '' });
  assert.doesNotMatch(worker, /id="moreBtn"/, 'xodim ekranida rahbar menyusi yo‘q');
});
