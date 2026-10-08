import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET } = await import('../app/api/v2/ulanishlar/route.ts');
const { shell } = await import('../app/core/ui-shell.ts');

test('ulanishlar sahifasi, guruhli menyu va “⋯ Yana” oynasi', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const make = (q, p = []) => ({ bind: (...v) => make(q, v), all: async () => ({ results: sqlite.prepare(q).all(...p) }), first: async () => sqlite.prepare(q).get(...p) ?? null, run: async () => { const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(q).run(...p) });
  globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => make(q), batch: async (st) => st.map((s) => s._exec()) };
  globalThis.__HALO_SELF_HOSTED__ = true;
  const url = 'https://halo.example.workers.dev/api/v2/ulanishlar';
  assert.equal((await GET(new Request(url))).status, 303);
  const html = await (await GET(new Request(url, { headers: { 'oai-authenticated-user-email': 'owner@example.com' } }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  // Pastda: 5 asosiy guruh + “⋯ Yana”. Kam ishlatiladigan bo‘limlar faqat “Yana” oynasida, turkumlar bo‘yicha.
  const bottom = html.match(/<nav class="bottom"[\s\S]*?<\/nav>/)[0];
  assert.equal((bottom.match(/<a /g) || []).length, 5, 'pastda 5 ta asosiy guruh');
  assert.match(bottom, /<button[^>]*id="moreBtn"[^>]*>[\s\S]*Yana/, '“⋯ Yana” tugmasi');
  assert.match(bottom, /class="nav-a nav-more js-more on"/, 'kam ishlatiladigan sahifada “Yana” yoqilgan');
  for (const rare of ['/api/v2/ulanishlar', '/api/v2/sanoq', '/api/v2/sozlamalar']) assert.ok(!bottom.includes(rare), rare + ' pastki qatorda emas');
  const panel = html.match(/<div class="sheet-bg" id="morePanel" hidden>[\s\S]*?<\/section><\/div><\/div><\/div>/)[0];
  assert.deepEqual([...panel.matchAll(/<h4>[^ ]+ ([^<]+)<\/h4>/g)].map((m) => m[1]), ['Hisobot', 'Menyu vositalari', 'Xodimlar sozlamasi', 'Sozlash', 'Tizim']);
  for (const href of ['/api/v2/ulanishlar', '/api/v2/sozlamalar?b=akkaunt', '/api/v2/sozlamalar?b=filial', '/api/v2/sanoq', '/api/v2/tarix', '/api/v2/kochish', '/api/v2/maosh?b=joy', '/api/v2/maosh?b=vaqt', '/api/v2/eksport', '/api/v2/kalkulyator', '/api/v2/monitor', '/api/v2/club', '/api/v2/ushlanmalar', '/api/v2/ornatish', '/signout-with-chatgpt']) assert.ok(panel.includes(`href="${href}"`), href);
  assert.equal((panel.match(/class="more-a/g) || []).length, 20, 'oynada 20 ta bo‘lim');
  assert.ok(panel.includes('href="/pos"') && !html.match(/<nav class="bottom"[\s\S]*?<\/nav>/)[0].includes('/pos'), 'HALO HISOB — xodim oynalari qatorida');
  assert.match(panel, /class="more-a on" href="\/api\/v2\/ulanishlar"/, 'ochiq bo‘lim oynada belgilangan');
  for (const main of ['/api/v2/kiritish', '/api/v2/qarz', '/api/v2/ombor', '/api/v2/maosh"']) assert.ok(!panel.includes(`href="${main}`), main + ' oynada takrorlanmaydi');
  const sub = html.match(/<nav class="subnav"[\s\S]*?<\/nav>/)[0];
  assert.match(sub, /class="sub-a on"[^>]*>Ulanishlar</, 'ochiq bo‘lim tepada belgilangan');
  assert.match(sub, />Filiallar</);
  assert.doesNotMatch(sub, />Maosh<|>Chiqish</, 'boshqa turkum bo‘limlari va «Chiqish» aralashmaydi');
  const home = shell({ title: 'x', active: 'bosh', body: '', script: '' });
  assert.doesNotMatch(home, /<nav class="subnav"/, 'bitta sahifali guruhda tepada tugmachalar yo‘q');
  assert.doesNotMatch(home, /nav-more js-more on/, 'asosiy sahifada “Yana” yoqilmagan');
  assert.doesNotThrow(() => new vm.Script(home.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const worker = shell({ title: 'x', active: null, body: '', script: '' });
  assert.doesNotMatch(worker, /class="bottom"|class="subnav"|id="morePanel"/, 'xodim ekranida rahbar menyusi yo‘q');
});
