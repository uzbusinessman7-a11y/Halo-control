import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/* Baza: jonli saytdagi kabi avval drizzle migratsiyalari (yordamchi va MEZANA jadvallari). */
const sqlite = new DatabaseSync(':memory:');
for (const file of fs.readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
  for (const sql of fs.readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (sql.trim()) sqlite.exec(sql);
}
const stmt = (q, p = []) => ({ bind: (...v) => stmt(q, v), all: async () => ({ results: sqlite.prepare(q).all(...p) }), first: async () => sqlite.prepare(q).get(...p) ?? null, run: async () => { const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(q).run(...p) });
const FAIL = { query: null };
globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => { if (FAIL.query && FAIL.query.test(q)) { FAIL.query = null; throw new Error('D1_ERROR: vaqtincha nosozlik'); } return stmt(q); }, batch: async (list) => { sqlite.exec('BEGIN'); try { const out = list.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
globalThis.__HALO_SELF_HOSTED__ = true;

/* Soxta Telegram: haqiqiy xabar ketmaydi; ikki bot (hisobot va yordamchi) so'rovlari alohida yoziladi. */
const REPORT_TOKEN = '111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BOT_TOKEN = '222222:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const TG = { sent: [], webhook: '', secret: '', fail: '' };
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const match = url.match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)/);
  assert.ok(match, `tashqi so‘rov kutilmagan: ${url}`);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  TG.sent.push({ bot: match[1] === BOT_TOKEN ? 'yordamchi' : match[1] === REPORT_TOKEN ? 'hisobot' : 'boshqa', method: match[2], body });
  if (TG.fail) return Response.json({ ok: false, description: TG.fail }, { status: 400 });
  if (match[2] === 'getMe') return Response.json({ ok: true, result: { username: match[1] === BOT_TOKEN ? 'halo_yordamchi_bot' : 'halo_hisobot_bot' } });
  if (match[2] === 'getWebhookInfo') return Response.json({ ok: true, result: { url: TG.webhook, pending_update_count: 0 } });
  if (match[2] === 'setWebhook') { TG.webhook = body.url; TG.secret = body.secret_token; return Response.json({ ok: true, result: true }); }
  if (match[2] === 'deleteWebhook') { TG.webhook = ''; return Response.json({ ok: true, result: true }); }
  return Response.json({ ok: true, result: { message_id: 1000 + TG.sent.length } });
};

const owner = { 'oai-authenticated-user-email': 'rahbar@example.com', 'content-type': 'application/json' };
const assistant = await import('../app/api/assistant/route.ts');
const webhook = await import('../app/api/assistant/telegram/route.ts');
const telegram = await import('../app/api/telegram/route.ts');
const ulanishlar = await import('../app/api/v2/ulanishlar/route.ts');
const store = await import('../app/lib/halo-store.ts');
const bot = await import('../app/core/bot.ts');
const ORIGIN = 'https://halo.example';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ownerPost = async (body) => (await assistant.POST(new Request(`${ORIGIN}/api/assistant`, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) }))).json();
let updateId = 100;
const OWNER_CHAT = 777001;
const send = async (payload, secret = TG.secret) => webhook.POST(new Request(`${ORIGIN}/api/assistant/telegram`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify({ update_id: updateId++, ...payload }) }));
const say = async (text, from = OWNER_CHAT) => { TG.sent.length = 0; const response = await send({ message: { message_id: updateId, from: { id: from, first_name: 'Otabek' }, chat: { id: from, type: 'private' }, text } }); assert.equal(response.status, 200); return replies(); };
const press = async (data, messageId = 5000, from = OWNER_CHAT) => { TG.sent.length = 0; const response = await send({ callback_query: { id: 'cb' + updateId, from: { id: from }, data, message: { message_id: messageId, chat: { id: from, type: 'private' } } } }); assert.equal(response.status, 200); return replies(); };
/** Yordamchi bot rahbarga yuborgan xabarlar (matn + tugmalar). */
const replies = () => TG.sent.filter((call) => call.bot === 'yordamchi' && (call.method === 'sendMessage' || call.method === 'editMessageText')).map((call) => ({ text: call.body.text, buttons: (call.body.reply_markup?.inline_keyboard || []).flat(), keyboard: call.body.reply_markup?.keyboard, edited: call.method === 'editMessageText' }));
const button = (reply, label) => { const found = reply.buttons.find((item) => (label instanceof RegExp ? label.test(item.text) : item.text === label)); assert.ok(found, `tugma topilmadi: ${label} · bor: ${reply.buttons.map((item) => item.text).join(' | ')}`); return found.callback_data; };
const state = async (branch = 'main') => (await store.readHaloState(branch)).state;
const patchState = async (patch, branch = 'main') => { const current = await store.readHaloState(branch); await store.replaceHaloState({ ...current.state, ...patch }, current.updatedAt, branch, 'Sinov', 'sinov', 'Sinov'); };

test('ulash: token → webhook shu saytga, bog‘lash havolasi, rahbar tasdiqlagachgina ishlaydi; token javoblarda yo‘q', async () => {
  const stamp = new Date().toISOString();
  await patchState({
    accounts: [{ id: 'cash', name: 'Naqd kassa', type: 'cash', openingBalance: 300000 }, { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 1000000 }, { id: 'card', name: 'Karta', type: 'card' }],
    suppliers: [{ id: 's1', name: 'Nodir aka', openingBalance: 0, balance: 540000 }, { id: 's2', name: 'Coupang', openingBalance: 0, balance: 0 }, { id: 'sm', name: 'MEZANA', openingBalance: 0, balance: 0 }],
    transactions: [{ id: 't1', supplierId: 's1', type: 'purchase', amount: 540000, date: today }],
    inventory: [{ id: 'un', name: 'Un', unit: 'kg', stock: 4, unitCost: 4000, minStock: 10 }],
    sales: [{ id: 'sale1', date: today, totalRevenue: 250000, accountId: 'cash' }],
    mezanaCatalog: [
      { id: 'mezana-product:lavash', name: 'Lavash', mode: 'borrowed', price: 500, active: true, createdAt: stamp, updatedAt: stamp },
      { id: 'mezana-product:pishloq', name: 'Pishloq', mode: 'purchased', price: 4500, active: true, createdAt: stamp, updatedAt: stamp },
    ],
    mezanaSettings: { telegramChatId: '-100777', telegramChatName: 'HALO × MEZANA', telegramThreadId: 0, purchasedTelegramChatId: '-100777', purchasedTelegramChatName: 'HALO × MEZANA', purchasedTelegramThreadId: 9 },
  });
  // hisobot boti (MEZANA guruhiga shu bot yozadi)
  assert.equal((await (await telegram.POST(new Request(`${ORIGIN}/api/telegram`, { method: 'POST', headers: owner, body: JSON.stringify({ action: 'save', branchId: 'main', botToken: REPORT_TOKEN, chatId: '555' }) }))).json()).ok, true);

  assert.match((await ownerPost({ action: 'setup', botToken: REPORT_TOKEN })).error, /hisobotlar botining tokeni/);
  const setup = await ownerPost({ action: 'setup', botToken: BOT_TOKEN });
  assert.equal(setup.ok, true);
  assert.equal(TG.webhook, `${ORIGIN}/api/assistant/telegram`);
  assert.deepEqual((await ownerPost({ action: 'status' })).webhook, { checked: true, here: true, elsewhere: false, pending: 0, lastError: '', lastErrorAt: 0 });

  // bog'lanmagan paytda bot hech narsa bermaydi
  let out = await say('📊 Bugun');
  assert.deepEqual(out, []);
  assert.equal((await send({ message: { message_id: 1, from: { id: OWNER_CHAT }, chat: { id: OWNER_CHAT, type: 'private' }, text: '/start' } }, 'soxta-sir')).status, 403);

  const pair = await ownerPost({ action: 'pair' });
  assert.match(pair.link, /^https:\/\/t\.me\/halo_yordamchi_bot\?start=[a-f0-9]{32}$/);
  await say(`/start ${pair.link.split('start=')[1]}`);
  let view = await (await assistant.GET(new Request(`${ORIGIN}/api/assistant?branch=main`, { headers: owner }))).json();
  assert.deepEqual([view.telegram.enabled, view.telegram.candidateId, view.telegram.candidateName], [false, String(OWNER_CHAT), 'Otabek']);
  assert.deepEqual(await say('📊 Bugun'), [], 'rahbar saytda tasdiqlamaguncha ma’lumot berilmaydi');
  assert.equal((await ownerPost({ action: 'activate', candidateId: String(OWNER_CHAT) })).ok, true);
  view = await (await assistant.GET(new Request(`${ORIGIN}/api/assistant?branch=main`, { headers: owner }))).json();
  assert.equal(view.telegram.enabled, true);
  assert.ok(!JSON.stringify(view).includes(BOT_TOKEN.split(':')[1]) && !JSON.stringify(setup).includes(BOT_TOKEN.split(':')[1]), 'token javoblarda yo‘q');
  // Ulanishlar sahifasida karta bor
  assert.match(await (await ulanishlar.GET(new Request(`${ORIGIN}/api/v2/ulanishlar`, { headers: owner }))).text(), /Yordamchi bot/);
});

test('ma’lumot: /start tugmalari, Bugun, Kassa, MEZANA; begona odamga javob yo‘q; eski buyruqlar ishlayveradi', async () => {
  let out = await say('/start');
  assert.match(out[0].text, /pastdagi tugmalar bilan ishlaydi/);
  assert.deepEqual(out[0].keyboard.map((row) => row.map((item) => item.text)), [['📊 Bugun', '💰 Kassa', 'Qarzlar'], ['Ombor', '🤝 MEZANA', 'Eksport'], ['➕ Xarajat', '➕ MEZANA', '➕ Qarz to‘lovi']]);

  out = await say('📊 Bugun');
  assert.match(out[0].text, /HALO Asosiy filial — \d\d\.\d\d, hozirgacha/);
  assert.match(out[0].text, /Bugun savdo: 250,000 ₩/);
  assert.match(out[0].text, /Pul: kassa 550,000 ₩ · bank 1,000,000 ₩/);
  assert.match(out[0].text, /Qarz: 540,000 ₩/);

  out = await say('💰 Kassa');
  assert.match(out[0].text, /Naqd kassa: 550,000 ₩\nBank: 1,000,000 ₩\nJami: 1,550,000 ₩/);

  out = await say('🤝 MEZANA');
  assert.match(out[0].text, /Qarz: 0 ₩\nOlib turilgan mahsulot yo‘q/);

  out = await say('Qarzlar');
  assert.match(out[0].text, /Nodir aka: ₩540,000/, 'eski yordamchi javobi o‘zgarmagan');
  out = await say('Ombor');
  assert.match(out[0].text, /Un: 4 kg · kam qolgan/);

  // Eksport: tugma bilan tur va davr tanlanadi, fayl shu chatga keladi; asosiy tugmalar o'rnida qoladi
  out = await say('Eksport');
  assert.deepEqual(out[0].buttons.map((item) => item.text), ['Yetkazib beruvchilar va qarzlar', 'Yetkazib beruvchilar oldi-berdisi', 'Ombor qoldig‘i', 'Ombor harakatlari', 'Savdo yozuvlari', 'Xarajat va pul harakatlari', '✖ Bekor qilish']);
  assert.equal(out[0].keyboard, undefined);
  const kinds = out[0];
  out = await press(button(kinds, 'Savdo yozuvlari'));
  assert.deepEqual(out[0].buttons.map((item) => item.text.replace(/ \(.*\)$/, '')), ['Shu oy', 'O‘tgan oy', 'Hamma yozuvlar', '✖ Bekor qilish']);
  out = await press(button(out[0], /^Shu oy/));
  assert.match(out[0].text, /Savdo yozuvlari — fayl tayyorlanmoqda/);
  assert.deepEqual(TG.sent.filter((call) => call.method === 'sendDocument').map((call) => call.bot), ['yordamchi']);
  out = await say('Eksport');
  await press(button(out[0], 'Ombor qoldig‘i'));
  assert.equal(TG.sent.filter((call) => call.method === 'sendDocument').length, 1, 'ombor qoldig‘i — davr so‘ralmaydi, fayl darhol');

  assert.deepEqual(await say('📊 Bugun', 999), [], 'boshqa Telegram akkauntga javob berilmaydi');
  assert.deepEqual(await press('v:00000000-0000-4000-8000-000000000000:ok', 1, 999), []);
});

test('xarajat: tur → summa va izoh → hisob → tasdiqlash; tasdiqlanmaguncha yozilmaydi; ikki marta yozilmaydi', async () => {
  const before = (await state()).financialEntries.length;
  let out = await say('➕ Xarajat');
  assert.match(out[0].text, /Turini tanlang/);
  assert.equal(out[0].buttons.length, 12, '11 ta tur (kuryer puli ham) + bekor');
  const id = button(out[0], 'Elektr / gaz / suv').split(':')[1];
  out = await press(button(out[0], 'Elektr / gaz / suv'));
  assert.match(out[0].text, /Summani yozing/);
  assert.equal(out[0].edited, true);
  out = await say('qirq besh ming');
  assert.match(out[0].text, /faqat raqam bilan yozing/);
  out = await say('45 000 gaz balloni');
  assert.match(out[0].text, /45,000 ₩\nQaysi hisobdan to‘landi\?/);
  out = await press(button(out[0], 'Naqd kassa'));
  assert.match(out[0].text, /Turi: Elektr \/ gaz \/ suv\nNima uchun: gaz balloni\nSumma: 45,000 ₩\nHisob: Naqd kassa/);
  assert.match(out[0].text, /«Tasdiqlash» bosilmaguncha hisobga yozilmaydi/);
  assert.equal((await state()).financialEntries.length, before, 'tasdiqlanmaguncha hech narsa yozilmagan');

  out = await press(button(out[0], '✅ Tasdiqlash'));
  assert.match(out[0].text, /^✅ Saqlandi\n💸 Xarajat/);
  const entries = (await state()).financialEntries;
  assert.equal(entries.length, before + 1);
  assert.deepEqual([entries[0].id, entries[0].type, entries[0].category, entries[0].amount, entries[0].date, entries[0].accountId, entries[0].affectsProfit], [`v2-expense:${id}`, 'expense', 'Elektr / gaz / suv', 45000, today, 'cash', true]);
  assert.match(entries[0].note, /gaz balloni · Telegram bot/);
  // tugma qayta bosilsa (yoki Telegram qayta yuborsa) ikkinchi yozuv bo'lmaydi
  out = await press(`v:${id}:ok`);
  assert.match(out[0].text, /eskirgan yoki yakunlangan/);
  assert.equal((await state()).financialEntries.length, before + 1);
  assert.match((await say('💰 Kassa'))[0].text, /Naqd kassa: 505,000 ₩/, 'kassa xarajatga kamaydi');

  // tez yo'l + bir xil xarajat: alohida ekanini so'raydi
  out = await say('xarajat 45 ming gaz balloni');
  assert.match(out[0].text, /45,000 ₩ · gaz balloni\nTurini tanlang/);
  out = await press(button(out[0], 'Elektr / gaz / suv'));
  assert.match(out[0].text, /Qaysi hisobdan/, 'summa va izoh bor — to‘g‘ri hisobga o‘tadi');
  out = await press(button(out[0], 'Bank'));
  out = await press(button(out[0], '✅ Tasdiqlash'));
  assert.match(out[0].text, /Shu kuni aynan shu turdagi va shu summadagi xarajat bor[\s\S]*alohida xarajatmi\?/);
  assert.equal((await state()).financialEntries.length, before + 1);
  out = await press(button(out[0], 'Ha, bu boshqa xarajat'));
  assert.match(out[0].text, /^✅ Saqlandi/);
  const twin = (await state()).financialEntries[0];
  assert.deepEqual([twin.amount, twin.accountId, twin.duplicateOf], [45000, 'bank', `v2-expense:${id}`]);

  // nosozlik (baza javob bermadi): yozuv saqlangani noma'lum deb aytiladi, tugma qoladi; qayta bosilganda bir marta yoziladi
  out = await say('xarajat 7000 choy');
  out = await press(button(out[0], 'Boshqa'));
  out = await press(button(out[0], 'Naqd kassa'));
  const retry = button(out[0], '✅ Tasdiqlash');
  FAIL.query = /^UPDATE app_state SET payload/;
  out = await press(retry);
  assert.match(out[0].text, /Javob kelmadi\. «Tasdiqlash»ni yana bir marta bosing — yozuv ikki marta yozilmaydi/);
  assert.equal((await state()).financialEntries.filter((entry) => entry.amount === 7000).length, 0);
  out = await press(button(out[0], '✅ Tasdiqlash'));
  assert.match(out[0].text, /^✅ Saqlandi/);
  assert.equal((await state()).financialEntries.filter((entry) => entry.amount === 7000).length, 1);
  const total = (await state()).financialEntries.length;

  // bekor qilish: tugma bilan ham, so'z bilan ham
  out = await say('➕ Xarajat');
  out = await press(button(out[0], 'Ijara'));
  out = await say('bekor');
  assert.match(out[0].text, /Bekor qilindi\. Hisobga hech narsa yozilmadi/);
  assert.match((await say('100000'))[0].text, /Bu matnni tushunmadim\. Pastdagi tugmalardan foydalaning/, 'bekor qilingandan keyin son xarajat deb olinmaydi');
  out = await say('➕ Xarajat');
  out = await press(button(out[0], '✖ Bekor qilish'));
  assert.match(out[0].text, /Bekor qilindi/);
  assert.equal((await state()).financialEntries.length, total);
});

test('MEZANA yozuvi: olib turildi → guruhga boradi; qaytarish cheklovi; qarzga olish va to‘lov kassadan', async () => {
  let out = await say('➕ MEZANA');
  assert.deepEqual(out[0].buttons.map((item) => item.text), ['📥 Olib turildi', '📤 Qaytarildi', '🛒 Qarzga olindi', '💸 To‘lov', '✖ Bekor qilish']);
  const actions = out[0];
  // qarz yo'q — to'lov boshlanmaydi; olib turilgan narsa yo'q — qaytarish boshlanmaydi
  assert.match((await press(button(actions, '💸 To‘lov')))[0].text, /qarz yo‘q/);
  assert.match((await press(button(actions, '📤 Qaytarildi')))[0].text, /Qaytariladigan olib turilgan mahsulot yo‘q/);

  out = await press(button(actions, '📥 Olib turildi'));
  assert.deepEqual(out[0].buttons.map((item) => item.text), ['Lavash', '✏️ Boshqa (nomini yozaman)', '✖ Bekor qilish']);
  out = await press(button(out[0], 'Lavash'));
  assert.match(out[0].text, /Lavash\nSonini tanlang yoki yozing/);
  out = await say('7 ta');
  assert.match(out[0].text, /📥 Olib turildi[\s\S]*Mahsulot: Lavash\nSoni: 7 ta[\s\S]*MEZANA guruhiga yuboriladi/);
  assert.equal((await state()).mezanaEntries.length, 0);
  TG.sent.length = 0;
  out = await press(button(out[0], '✅ Tasdiqlash'));
  assert.match(out[0].text, /^✅ Saqlandi[\s\S]*Hozir olib turilgan: 7 ta\n📨 MEZANA guruhiga yuborildi/);
  const group = TG.sent.find((call) => call.bot === 'hisobot' && call.method === 'sendMessage');
  assert.equal(group.body.chat_id, '-100777');
  assert.match(group.body.text, /MEZANA · OLIB TURILDI[\s\S]*Kiritgan hodim: Rahbar[\s\S]*Lavash[\s\S]*Olib turildi: 7 ta/);
  assert.deepEqual((await state()).mezanaEntries.map((entry) => [entry.action, entry.productName, entry.quantity, entry.catalogItemId]), [['borrowed', 'Lavash', 7, 'mezana-product:lavash']]);

  // qaytarish: tez tugmalar faqat bor songacha, ortiqcha yozilsa rad etiladi
  out = await say('➕ MEZANA');
  out = await press(button(out[0], '📤 Qaytarildi'));
  out = await press(button(out[0], /^Lavash \(olingan: 7\)$/));
  assert.deepEqual(out[0].buttons.map((item) => item.text), ['1', '2', '3', '5', '✖ Bekor qilish']);
  assert.match((await say('8'))[0].text, /faqat 7 ta olib turilgan/);
  out = await say('2');
  out = await press(button(out[0], '✅ Tasdiqlash'));
  assert.match(out[0].text, /Hozir olib turilgan: 5 ta/);

  // qarzga olish: narx ro'yxatdan, summa o'zi hisoblanadi; xabar sotib olish mavzusiga
  out = await say('➕ MEZANA');
  out = await press(button(out[0], '🛒 Qarzga olindi'));
  out = await press(button(out[0], /^Pishloq · 4,500 ₩$/));
  out = await press(button(out[0], '2'));
  assert.match(out[0].text, /Mahsulot: Pishloq\nSoni: 2 ta\nSumma: 9,000 ₩/);
  TG.sent.length = 0;
  out = await press(button(out[0], '✅ Tasdiqlash'));
  assert.match(out[0].text, /MEZANA qarzi: 9,000 ₩\n📨 MEZANA guruhiga yuborildi/);
  assert.equal(TG.sent.find((call) => call.bot === 'hisobot').body.message_thread_id, 9);

  // to'lov: qarzdan katta bo'lmaydi, «To'liq» tugmasi, kassadan chiqadi (foydaga ta'sirsiz)
  out = await say('➕ MEZANA');
  out = await press(button(out[0], '💸 To‘lov'));
  assert.match(out[0].text, /qarz: 9,000 ₩/);
  assert.match((await say('10000'))[0].text, /To‘lov qarzdan katta bo‘lmasin/);
  out = await press(button(out[0], 'To‘liq: 9,000 ₩'));
  assert.deepEqual(out[0].buttons.map((item) => item.text), ['Naqd kassa', 'Bank', 'Hisobga yozilmasin', '✖ Bekor qilish']);
  out = await press(button(out[0], 'Naqd kassa'));
  assert.match(out[0].text, /💸 To‘lov[\s\S]*Summa: 9,000 ₩\nHisob: Naqd kassa/);
  out = await press(button(out[0], '✅ Tasdiqlash'));
  assert.match(out[0].text, /MEZANA qarzi: 0 ₩/);
  const paid = (await state()).financialEntries.find((entry) => entry.category === 'MEZANA to‘lovi');
  assert.deepEqual([paid.amount, paid.accountId, paid.affectsProfit], [9000, 'cash', false]);
  assert.match((await say('🤝 MEZANA'))[0].text, /Qarz: 0 ₩\nOlib turilgan \(qaytarilmagan\): Lavash 5 ta/);

  // guruhga yuborilmasa ham yozuv saqlanadi, sababi aytiladi
  TG.fail = 'Forbidden: bot was kicked from the supergroup chat';
  const call = async (payload) => { TG.fail = ''; const result = await payload(); return result; };
  out = await call(() => say('➕ MEZANA'));
  out = await call(() => press(button(out[0], '📥 Olib turildi')));
  out = await call(() => press(button(out[0], '✏️ Boshqa (nomini yozaman)')));
  out = await call(() => say('Non'));
  out = await call(() => press(button(out[0], '3')));
  // faqat guruhga yuborish rad etiladi (yordamchi bot javobi o'tadi)
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => (String(input).includes(REPORT_TOKEN) ? Response.json({ ok: false, description: 'Forbidden: bot was kicked from the supergroup chat' }, { status: 403 }) : original(input, init));
  out = await press(button(out[0], '✅ Tasdiqlash'));
  globalThis.fetch = original;
  assert.match(out[0].text, /^✅ Saqlandi[\s\S]*⚠️ Guruhga yuborilmadi: Forbidden: bot was kicked/);
  assert.equal((await state()).mezanaEntries[0].productName, 'Non');
});

test('qarz to‘lovi: yetkazib beruvchi → summa → hisob → eski tekshirilgan tasdiqlash yo‘li; yopilgan kun himoyasi', async () => {
  let out = await say('➕ Qarz to‘lovi');
  assert.deepEqual(out[0].buttons.map((item) => item.text), ['Nodir aka · 540,000 ₩', '✖ Bekor qilish'], 'faqat qarzi borlar, MEZANA alohida');
  out = await press(button(out[0], /^Nodir aka/));
  assert.match(out[0].text, /Nodir aka\nTo‘langan summani yozing \(qarz: 540,000 ₩\)/);
  assert.match((await say('600000'))[0].text, /To‘lov qarzdan katta bo‘lmasin/);
  out = await say('200 ming');
  out = await press(button(out[0], 'Bank'));
  assert.match(out[0].text, /Qarz to‘lovi[\s\S]*Nodir aka: ₩200,000\nHisob: Bank\nQarz: ₩540,000 → ₩340,000/);
  const confirm = button(out[0], 'Tasdiqlash');
  assert.match(confirm, /^ok:[a-f0-9-]{36}$/, 'saqlash eski yordamchining yo‘li orqali');
  assert.equal((await state()).suppliers.find((supplier) => supplier.id === 's1').balance, 540000);
  out = await press(confirm);
  assert.match(out[0].text, /^Saqlandi\./);
  const after = await state();
  assert.equal(after.suppliers.find((supplier) => supplier.id === 's1').balance, 340000);
  assert.deepEqual(after.transactions.filter((tx) => tx.type === 'payment').map((tx) => [tx.supplierId, tx.amount, tx.accountId]), [['s1', 200000, 'bank']]);
  out = await press(confirm);
  assert.equal(after.transactions.length, (await state()).transactions.length, 'ikkinchi bosish qayta to‘lamaydi');

  // kassa bugun yopilgan bo'lsa, bot ham yopilgan kunga yozmaydi
  const kassa = await import('../app/core/kassa-service.ts');
  const scope = { tenantId: 'halo', branchId: 'main' };
  const cashAccounts = (await kassa.staffView(globalThis.__HALO_CONTROL_DB__, scope, await state(), today)).cashAccounts;
  await kassa.staffCount(globalThis.__HALO_CONTROL_DB__, scope, await state(), today, { operationId: 'count-botsinov', actor: 'Ali', counts: Object.fromEntries(cashAccounts.map((account) => [account.id, 1000])) });
  await kassa.ownerClose(globalThis.__HALO_CONTROL_DB__, scope, await state(), today, { date: today, note: 'sinov', reviewer: 'Rahbar', operationId: 'close-botsinov' });
  out = await say('xarajat 5000 choy');
  out = await press(button(out[0], 'Boshqa'));
  out = await press(button(out[0], 'Naqd kassa'));
  const count = (await state()).financialEntries.length;
  out = await press(button(out[0], '✅ Tasdiqlash'));
  assert.match(out[0].text, /❌ Saqlanmadi: .*kuni kassada yopilgan/);
  assert.equal((await state()).financialEntries.length, count);
});

test('filial almashtirish va uzish; summa va son matnini o‘qish', async () => {
  const second = await store.createHaloBranch('Ikkinchi filial');
  let out = await say('/start');
  assert.deepEqual(out[0].keyboard.at(-1).map((item) => item.text), ['🏪 Filial'], 'ikki filial bo‘lsa «Filial» tugmasi chiqadi');
  out = await say('🏪 Filial');
  assert.deepEqual(out[0].buttons.map((item) => item.text), ['✓ HALO Asosiy filial', 'Ikkinchi filial', '✖ Bekor qilish']);
  out = await press(button(out[0], 'Ikkinchi filial'));
  assert.match(out[0].text, /Filial: Ikkinchi filial/);
  assert.match((await say('📊 Bugun'))[0].text, /Ikkinchi filial — [\s\S]*Bugun savdo: 0 ₩/);
  assert.equal(sqlite.prepare("SELECT branch_id FROM halo_assistant_config WHERE id='main'").get().branch_id, second.id);

  // uzish: webhook shu saytniki — o'chiriladi; keyin bot javob bermaydi
  assert.equal((await ownerPost({ action: 'disconnect' })).ok, true);
  assert.equal(TG.webhook, '');
  assert.equal((await send({ message: { message_id: 1, from: { id: OWNER_CHAT }, chat: { id: OWNER_CHAT, type: 'private' }, text: '📊 Bugun' } })).status, 403);
  // bot boshqa saytga ulangan bo'lsa (ko'chirilgan baza): uzish u yerdagi ulanishga tegmaydi
  await ownerPost({ action: 'setup', botToken: BOT_TOKEN });
  TG.webhook = 'https://halo-control.eski.example/api/assistant/telegram';
  assert.equal((await ownerPost({ action: 'status' })).webhook.elsewhere, true);
  TG.sent.length = 0;
  const gone = await ownerPost({ action: 'disconnect' });
  assert.match(gone.message, /Bot boshqa saytda avvalgidek ishlayveradi/);
  assert.ok(!TG.sent.some((call) => call.method === 'deleteWebhook'), 'boshqa saytdagi ulanish o‘chirilmaydi');
  assert.equal(TG.webhook, 'https://halo-control.eski.example/api/assistant/telegram');

  assert.deepEqual(['45000', '45 000', '45,000', '45.000', '45 ming', '45k', '1.5 mln', '45000 won', '₩? yo‘q'].map((text) => bot.parseAmount(text)?.amount ?? null), [45000, 45000, 45000, 45000, 45000, 45000, 1500000, 45000, null]);
  assert.deepEqual([bot.parseAmount('45.5'), bot.parseAmount('0'), bot.parseAmount('abc 500'), bot.parseAmount('1.2345 ming')], [null, null, null, null]);
  assert.deepEqual(bot.parseAmount('12 ming choy va shakar'), { amount: 12000, rest: 'choy va shakar' });
  assert.deepEqual(bot.parseAmount('8000 von gaz'), { amount: 8000, rest: 'gaz' });
  assert.deepEqual(['5', '5 ta', '12 dona', '0', '2.5', 'besh'].map((text) => bot.parseQuantity(text)), [5, 5, 12, null, null, null]);
});
