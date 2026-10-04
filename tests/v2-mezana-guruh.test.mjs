import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/* Baza: jonli saytdagi kabi avval drizzle migratsiyalari (mezana_telegram_deliveries shu yerda yaratiladi). */
const sqlite = new DatabaseSync(':memory:');
for (const file of fs.readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
  for (const sql of fs.readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (sql.trim()) sqlite.exec(sql);
}
const stmt = (q, p = []) => ({ bind: (...v) => stmt(q, v), all: async () => ({ results: sqlite.prepare(q).all(...p) }), first: async () => sqlite.prepare(q).get(...p) ?? null, run: async () => { const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(q).run(...p) });
globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => stmt(q), batch: async (list) => { sqlite.exec('BEGIN'); try { const out = list.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
globalThis.__HALO_SELF_HOSTED__ = true;

/* Soxta Telegram: haqiqiy xabar ketmaydi, so'rovlar yozib boriladi. */
const TG = { sent: [], updates: [], fail: '' };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const match = url.match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)/);
  if (!match) return realFetch(input, init);
  const body = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : `fayl:${value.type}`])) : typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  TG.sent.push({ token: match[1], method: match[2], body });
  if (TG.fail) return Response.json({ ok: false, description: TG.fail }, { status: 400 });
  if (match[2] === 'getMe') return Response.json({ ok: true, result: { username: 'halo_sinov_bot' } });
  if (match[2] === 'getUpdates') return Response.json({ ok: true, result: TG.updates });
  return Response.json({ ok: true, result: { message_id: TG.sent.length } });
};

const owner = { 'oai-authenticated-user-email': 'rahbar@example.com', 'content-type': 'application/json' };
const ulanishlar = await import('../app/api/v2/ulanishlar/route.ts');
const mezana = await import('../app/api/v2/mezana/route.ts');
const xodim = await import('../app/api/v2/xodim/route.ts');
const telegram = await import('../app/api/telegram/route.ts');
const ownerMezana = await import('../app/api/owner-mezana/route.ts');
const workerMezana = await import('../app/api/worker-mezana/route.ts');
const store = await import('../app/lib/halo-store.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const call = async (route, path, body, headers = owner, method = 'POST') => {
  const response = await route[method](new Request(`https://halo.example${path}`, { method, headers, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};
const TOKEN = '111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const uuid = () => crypto.randomUUID();

test('Ulanishlar: MEZANA guruhi kartasi — bot yo‘q, guruh yo‘q, ulash, sinov xabari; token hech qachon qaytmaydi', async () => {
  assert.equal((await call(ulanishlar, '/api/v2/ulanishlar', { action: 'mezana' }, { 'content-type': 'application/json' })).status, 401);
  const html = await (await ulanishlar.GET(new Request('https://halo.example/api/v2/ulanishlar', { headers: owner }))).text();
  assert.match(html, /MEZANA guruhi/);
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));

  let status = (await call(ulanishlar, '/api/v2/ulanishlar', { action: 'mezana', branchId: 'main' })).body;
  assert.deepEqual([status.ok, status.botReady, status.borrowed.chatId, status.purchased.chatId, status.recent], [true, false, '', '', []]);
  assert.match((await call(ulanishlar, '/api/v2/ulanishlar', { action: 'mezanaTest', branchId: 'main' })).body.error, /Telegram botni ulang/);

  // hisobot boti (sinov tokeni) saqlanadi
  assert.equal((await call(telegram, '/api/telegram', { action: 'save', branchId: 'main', botToken: TOKEN, chatId: '555', enabled: false })).body.ok, true);
  assert.match((await call(ulanishlar, '/api/v2/ulanishlar', { action: 'mezanaTest', branchId: 'main' })).body.error, /guruhni ulang/);
  // guruhda buyruq yozilmagan
  TG.updates = [{ update_id: 1, message: { text: '/mezana_olib', chat: { id: 555, type: 'private' } } }];
  assert.match((await call(telegram, '/api/telegram', { action: 'discover-mezana', branchId: 'main', mezanaDestination: 'borrowed' })).body.error, /\/mezana_olib deb yozing/);
  // guruhda yozildi → ulanadi
  TG.updates = [{ update_id: 2, message: { text: '/mezana_olib', chat: { id: -100777, type: 'supergroup', title: 'HALO × MEZANA' } } }];
  const linked = (await call(telegram, '/api/telegram', { action: 'discover-mezana', branchId: 'main', mezanaDestination: 'borrowed' })).body;
  assert.deepEqual([linked.ok, linked.chatId, linked.chatName, linked.warning], [true, '-100777', 'HALO × MEZANA', '']);
  TG.updates = [{ update_id: 3, message: { text: '/mezana_sotib', message_thread_id: 9, chat: { id: -100777, type: 'supergroup', title: 'HALO × MEZANA' } } }];
  assert.equal((await call(telegram, '/api/telegram', { action: 'discover-mezana', branchId: 'main', mezanaDestination: 'purchased' })).body.telegramThreadId, 9);

  status = (await call(ulanishlar, '/api/v2/ulanishlar', { action: 'mezana', branchId: 'main' })).body;
  assert.deepEqual(status.borrowed, { chatId: '-100777', chatName: 'HALO × MEZANA', threadId: 0 });
  assert.deepEqual(status.purchased, { chatId: '-100777', chatName: 'HALO × MEZANA', threadId: 9 });
  assert.equal(status.botReady, true);
  assert.ok(!JSON.stringify(status).includes(TOKEN.split(':')[1]), 'bot tokeni javobda yo‘q');

  TG.sent.length = 0;
  const sent = (await call(ulanishlar, '/api/v2/ulanishlar', { action: 'mezanaTest', branchId: 'main', destination: 'purchased' })).body;
  assert.equal(sent.ok, true);
  assert.deepEqual([TG.sent[0].method, TG.sent[0].body.chat_id, TG.sent[0].body.message_thread_id], ['sendMessage', '-100777', 9]);
  assert.match(TG.sent[0].body.text, /MEZANA sinov xabari/);
  // Telegram rad etsa — sababi rahbarga ko'rinadi
  TG.fail = 'Forbidden: bot is not a member of the supergroup chat';
  const refused = await call(ulanishlar, '/api/v2/ulanishlar', { action: 'mezanaTest', branchId: 'main', destination: 'borrowed' });
  assert.equal(refused.status, 502);
  assert.match(refused.body.error, /Guruhga yuborilmadi: Forbidden: bot is not a member/);
  TG.fail = '';
  // sinov xabari hisobga hech narsa yozmaydi
  assert.deepEqual((await store.readHaloState('main')).state.mezanaEntries, []);
});

test('MEZANA sahifasi: yozuv guruhga boradi, bormasa sababi va qayta yuborish; bir yozuv bir marta', async () => {
  const html = await (await mezana.GET(new Request('https://halo.example/api/v2/mezana', { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /Guruhga yuborish/);

  TG.sent.length = 0;
  const saved = (await call(mezana, '/api/v2/mezana', { action: 'add', entryAction: 'borrowed', branchId: 'main', operationId: uuid(), date: today, productName: 'Lavash', quantity: 5 })).body;
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.group, { borrowed: true, purchased: true });
  assert.deepEqual(saved.sent, {}, 'hali yuborilmagan');
  assert.equal(TG.sent.length, 0, 'saqlashning o‘zi xabar yubormaydi — sahifa alohida yuboradi');

  const put = (await call(ownerMezana, '/api/owner-mezana', { branchId: 'main', entryId: saved.entryId }, owner, 'PUT')).body;
  assert.equal(put.telegram.sent, true);
  assert.equal(TG.sent.length, 1);
  assert.equal(TG.sent[0].body.chat_id, '-100777');
  assert.match(TG.sent[0].body.text, /MEZANA · OLIB TURILDI[\s\S]*Lavash[\s\S]*Olib turildi: 5 ta[\s\S]*Hozir olib turilgan: 5 ta/);
  // takror so'rov ikkinchi xabar yubormaydi
  const twice = (await call(ownerMezana, '/api/owner-mezana', { branchId: 'main', entryId: saved.entryId }, owner, 'PUT')).body;
  assert.deepEqual([twice.telegram.sent, TG.sent.length], [true, 1]);
  let view = (await call(mezana, '/api/v2/mezana', { branchId: 'main' })).body;
  assert.equal(view.sent[saved.entryId].status, 'sent');

  // Telegram rad etdi: yozuv saqlanadi, holati "failed" + sabab; keyin qayta yuboriladi
  TG.fail = 'Forbidden: bot was kicked from the supergroup chat';
  const second = (await call(mezana, '/api/v2/mezana', { action: 'add', entryAction: 'purchased', branchId: 'main', operationId: uuid(), date: today, productName: 'Pishloq', itemCount: 1, amount: 9000, note: 'chek 12' })).body;
  const failed = (await call(ownerMezana, '/api/owner-mezana', { branchId: 'main', entryId: second.entryId }, owner, 'PUT')).body;
  assert.deepEqual([failed.telegram.sent, failed.telegram.reason], [false, 'Forbidden: bot was kicked from the supergroup chat']);
  view = (await call(mezana, '/api/v2/mezana', { branchId: 'main' })).body;
  assert.deepEqual(view.sent[second.entryId], { status: 'failed', error: 'Forbidden: bot was kicked from the supergroup chat' });
  assert.equal(view.debt, 9000, 'yozuv hisobda turibdi');
  TG.fail = ''; TG.sent.length = 0;
  const retried = (await call(ownerMezana, '/api/owner-mezana', { branchId: 'main', entryId: second.entryId }, owner, 'PUT')).body;
  assert.equal(retried.telegram.sent, true);
  assert.deepEqual([TG.sent.length, TG.sent[0].body.message_thread_id], [1, 9], 'qarzga olish — sotib olish mavzusiga');
  assert.match(TG.sent[0].body.text, /SOTIB OLINDI[\s\S]*Pishloq[\s\S]*₩9,000[\s\S]*chek 12[\s\S]*qolgan qarzi: ₩9,000/);

  const status = (await call(ulanishlar, '/api/v2/ulanishlar', { action: 'mezana', branchId: 'main' })).body;
  assert.deepEqual(status.recent.map((row) => [row.label, row.status]).sort(), [['OLIB TURILDI · Lavash', 'sent'], ['SOTIB OLINDI · Pishloq', 'sent']]);

  // guruh uzilsa: sahifa ogohlantiradi, yozuv "ulanmagan" sababi bilan qoladi
  assert.equal((await call(telegram, '/api/telegram', { action: 'save-mezana', branchId: 'main', mezanaDestination: 'borrowed', chatId: '' })).body.ok, true);
  const third = (await call(mezana, '/api/v2/mezana', { action: 'add', entryAction: 'returned', branchId: 'main', operationId: uuid(), date: today, productName: 'Lavash', quantity: 2 })).body;
  assert.deepEqual(third.group, { borrowed: false, purchased: true });
  const unlinked = (await call(ownerMezana, '/api/owner-mezana', { branchId: 'main', entryId: third.entryId }, owner, 'PUT')).body;
  assert.deepEqual([unlinked.telegram.sent, unlinked.telegram.reason], [false, 'MEZANA Telegram guruhi alohida ulanmagan.']);
  assert.equal((await call(telegram, '/api/telegram', { action: 'save-mezana', branchId: 'main', mezanaDestination: 'borrowed', chatId: '-100777' })).body.ok, true);
});

test('xodim ilovasi: MEZANA oynasi — rahbar belgilagan mahsulotlar, o‘z yozuvlari, guruhga xodim nomi bilan boradi', async () => {
  const html = await (await xodim.GET()).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /data-act|mezanaScreen/);
  for (const word of ['Olib turildi, qaytarildi, qarzga olindi', 'Взяли, вернули, купили в долг', 'Borrowed, returned, bought on credit', '빌림, 반납, 외상 구매']) assert.ok(html.includes(word), word);

  const current = await store.readHaloState('main');
  const stamp = new Date().toISOString();
  await store.replaceHaloState({ ...current.state, mezanaCatalog: [
    { id: 'mezana-product:lavash', name: 'Lavash', mode: 'borrowed', price: 500, active: true, createdAt: stamp, updatedAt: stamp },
    { id: 'mezana-product:pishloq', name: 'Pishloq', mode: 'purchased', price: 4500, active: true, createdAt: stamp, updatedAt: stamp },
    { id: 'mezana-product:eski', name: 'Eski mahsulot', mode: 'borrowed', price: 100, active: false, createdAt: stamp, updatedAt: stamp },
  ] }, current.updatedAt, 'main', 'Sinov', 'sinov', 'MEZANA');
  const aliId = await createWorkerAccount('main', 'Ali', 'ali', '1234');
  await createWorkerAccount('main', 'Vali', 'vali', '1234');
  const cookieOf = async (login) => (await loginWorker('main', login, '1234')).cookie.split(';')[0];
  const data = async (cookie) => (await xodim.POST(new Request('https://halo.example/api/v2/xodim', { method: 'POST', headers: { cookie }, body: '{}' }))).json();

  // ruxsatsiz xodimga MEZANA ma'lumoti berilmaydi
  const vali = await cookieOf('vali');
  assert.equal((await data(vali)).mezana, null);
  sqlite.prepare('UPDATE halo_worker_users SET can_warehouse_receipt = 1 WHERE id = ?').run(aliId);
  const ali = await cookieOf('ali');
  let view = (await data(ali)).mezana;
  assert.deepEqual(view.catalog, [
    { id: 'mezana-product:lavash', name: 'Lavash', mode: 'borrowed', price: 500, borrowed: 3 },
    { id: 'mezana-product:pishloq', name: 'Pishloq', mode: 'purchased', price: 4500, borrowed: 0 },
  ], 'yashirilgan mahsulot chiqmaydi; Lavash: rahbar 5 ta olgan, 2 tasini qaytargan');
  assert.deepEqual(view.group, { borrowed: true, purchased: true });
  assert.equal(view.photos, false, 'rasm ombori ulanmagan — rasm maydoni ko‘rsatilmaydi');
  assert.deepEqual(view.mine, [], 'rahbar yozuvlari xodimning ro‘yxatida yo‘q');

  // xodim yozuvi: sahifa yuboradigan shakldagi so'rov
  TG.sent.length = 0;
  const form = new FormData();
  form.set('operationId', uuid()); form.set('action', 'borrowed'); form.set('catalogItemId', 'mezana-product:lavash'); form.set('date', today); form.set('quantity', '4');
  const saved = await (await workerMezana.POST(new Request('https://halo.example/api/worker-mezana', { method: 'POST', headers: { cookie: ali }, body: form }))).json();
  assert.equal(saved.ok, true);
  assert.equal(saved.telegram.sent, true);
  assert.match(TG.sent[0].body.text, /Kiritgan hodim: Ali[\s\S]*Olib turildi: 4 ta[\s\S]*Hozir olib turilgan: 7 ta/);
  view = (await data(ali)).mezana;
  assert.equal(view.catalog[0].borrowed, 7);
  assert.deepEqual(view.mine.map((entry) => [entry.action, entry.name, entry.quantity]), [['borrowed', 'Lavash', 4]]);
  // rahbar sahifasida ham ko'rinadi, guruhga yuborilgani belgilangan
  const ownerView = (await call(mezana, '/api/v2/mezana', { branchId: 'main' })).body;
  const row = ownerView.entries.find((entry) => entry.by === 'Ali');
  assert.deepEqual([row.name, row.quantity, ownerView.sent[row.id].status], ['Lavash', 4, 'sent']);
});
