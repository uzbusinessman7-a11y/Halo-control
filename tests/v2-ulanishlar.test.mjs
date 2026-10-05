import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET } = await import('../app/api/v2/ulanishlar/route.ts');
const { shell } = await import('../app/core/ui-shell.ts');

test('ulanishlar sahifasi va guruhli menyu', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const make = (q, p = []) => ({ bind: (...v) => make(q, v), all: async () => ({ results: sqlite.prepare(q).all(...p) }), first: async () => sqlite.prepare(q).get(...p) ?? null, run: async () => { const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(q).run(...p) });
  globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => make(q), batch: async (st) => st.map((s) => s._exec()) };
  globalThis.__HALO_SELF_HOSTED__ = true;
  const url = 'https://halo.example.workers.dev/api/v2/ulanishlar';
  assert.equal((await GET(new Request(url))).status, 303);
  const html = await (await GET(new Request(url, { headers: { 'oai-authenticated-user-email': 'owner@example.com' } }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.doesNotMatch(html, /id="moreBtn"/, 'eski “⋯ Yana” ro‘yxati yo‘q');
  for (const href of ['/api/v2/ulanishlar', '/api/v2/sozlamalar?b=akkaunt', '/api/v2/sozlamalar?b=filial', '/api/v2/sanoq', '/api/v2/tarix', '/api/v2/kochish', '/api/v2/maosh?b=joy']) assert.ok(html.includes(`href="${href}"`), href);
  const bottom = html.match(/<nav class="bottom"[\s\S]*?<\/nav>/)[0];
  assert.equal((bottom.match(/<a /g) || []).length, 6, 'pastda 6 ta guruh');
  const sub = html.match(/<nav class="subnav"[\s\S]*?<\/nav>/)[0];
  assert.match(sub, /class="sub-a on"[^>]*>Ulanishlar</, 'ochiq bo‘lim belgilangan');
  assert.match(sub, />Filiallar</);
  assert.doesNotMatch(sub, />Maosh</, 'boshqa guruh bo‘limlari aralashmaydi');
  const worker = shell({ title: 'x', active: null, body: '', script: '' });
  assert.doesNotMatch(worker, /class="bottom"|class="subnav"/, 'xodim ekranida rahbar menyusi yo‘q');
});
