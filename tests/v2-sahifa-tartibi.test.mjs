import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* Sahifa tartibi — hamma bo'limda bir xil: 1) asosiy raqam, 2) asosiy amal, 3) diqqat talab qiladigani,
   4) ro'yxat, 5) kam ishlatiladigani pastda (yig'ilgan). Bu sinov tartib buzilib qolmasligini tekshiradi. */
const sqlite = new DatabaseSync(':memory:');
const make = (q, p = []) => ({ bind: (...v) => make(q, v), all: async () => ({ results: sqlite.prepare(q).all(...p) }), first: async () => sqlite.prepare(q).get(...p) ?? null, run: async () => { const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(q).run(...p) });
globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => make(q), batch: async (st) => st.map((s) => s._exec()) };
globalThis.__HALO_SELF_HOSTED__ = true;
const owner = { 'oai-authenticated-user-email': 'owner@example.com' };
const page = async (name, query = '') => {
  const { GET } = await import(`../app/api/v2/${name}/route.ts`);
  const html = await (await GET(new Request(`https://halo.example.workers.dev/api/v2/${name}${query}`, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]), name);
  return html;
};
/** Bo'laklar sahifada shu ketma-ketlikda uchraydi. */
const inOrder = (html, parts, label) => {
  let at = -1;
  for (const part of parts) {
    const next = html.indexOf(part, at + 1);
    assert.ok(next > at, `${label}: «${part}» o‘z o‘rnida emas`);
    at = next;
  }
};

test('har sahifa bir xil tartibda: raqam → amal → ro‘yxat → kam ishlatiladigani pastda', async () => {
  inOrder(await page('bosh'), ['<h2>Savdo</h2>', '<h2>Diqqat talab qiladi</h2>', 'Savdo · so‘nggi 14 kun', 'Prime cost', 'Pul va majburiyatlar', 'class="card fold"><details><summary><span><b>✈️ Kunlik Telegram hisobot'], 'Bosh');
  inOrder(await page('kassa'), ['<h2>Pul qayerda</h2>', 'id="openCount">🧮 Kassani sanash', 'data-mv="transfer"', 'data-mv="income"', 'id="ownCount"', 'Karta va delivery — hali tushmagan pul', '<h2>Kunlar</h2>'], 'Kassa');
  const maosh = await page('maosh');
  inOrder(maosh, ['id="sumCard"', 'id="checkCard"', 'id="listCard"', 'id="slipCard"', 'id="manage"'], 'Maosh');
  assert.match(await page('maosh', '?b=joy'), /id="sumCard" hidden/, 'joy sahifasida maosh summasi ko‘rinmaydi');
  const vazifa = await page('vazifalar');
  inOrder(vazifa, ['id="sum"', 'id="newBtn"', 'id="newForm" hidden', 'id="send"', '<h2>Vazifalar</h2><div id="list">'], 'Vazifalar');
  inOrder(await page('qarz'), ['id="sum"', 'id="newIn"', 'id="pendCard"', 'id="listCard"', 'id="stCard"', 'class="card fold noprint" id="histCard"'], 'Xarid');
  const menyu = await page('menyu');
  inOrder(menyu, ['id="rec"', 'href="/api/v2/menyu?b=tahlil"', 'href="/api/v2/kalkulyator"'], 'Menyu');
  assert.doesNotMatch(menyu, /id="rNew">\+ Yangi taom<\/button><a href="\/api\/v2\/kalkulyator"/, 'kalkulyator asosiy tugma yonida emas');
  inOrder(await page('nazorat'), ['Oxirgi kunlar', 'class="card fold"><details><summary><span><b>🍳 Oshxona qoidalari', 'id="rules"'], 'Kunlik nazorat');
  const kiritish = await page('kiritish');
  assert.match(kiritish, /class="card fold"><details data-fold="rec"/);
  assert.match(kiritish, /class="card fold"><details data-fold="oil"/);
});
