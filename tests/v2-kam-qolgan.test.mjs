import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* «Kam qolgan»: xodim tugayotgan mahsulotni yuboradi → HALO Telegram boti orqali xabar; yozuv saqlanadi; rahbar ko'radi. */
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
const sqlite = new DatabaseSync(':memory:');
const db = d1(sqlite);
globalThis.__HALO_CONTROL_DB__ = db;
globalThis.__HALO_SELF_HOSTED__ = true;
// Soxta Telegram: haqiqiy xabar ketmaydi, yuborilganlar shu yerda.
const SENT = []; let TG_FAIL = '';
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url);
  if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
  SENT.push({ url, body: JSON.parse(init.body) });
  return TG_FAIL ? Response.json({ ok: false, description: TG_FAIL }, { status: 400 }) : Response.json({ ok: true, result: { message_id: SENT.length } });
};
const kam = await import('../app/api/v2/kam/route.ts');
const ombor = await import('../app/api/v2/ombor/route.ts');
const xodim = await import('../app/api/v2/xodim/route.ts');
const core = await import('../app/core/low-stock.ts');
const { writeSettings } = await import('../app/lib/telegram-service.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const base = 'https://halo.example.workers.dev';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const state = { inventory: [{ id: 'tom', name: 'Pomidor', unit: 'g' }, { id: 'lav', name: 'Lavash', unit: 'dona' }, { id: 'old', name: 'Eski', catalogArchived: true }] };
const op = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('ro‘yxat: nom ombordan olinadi; ro‘yxatda yo‘q narsa; takror birlashadi; noto‘g‘ri qiymat rad etiladi', () => {
  assert.deepEqual(core.cleanItems(state, [{ inventoryId: 'tom', name: 'XAKER', note: ' 2  quti ' }, { name: 'Salfetka' }, { inventoryId: 'tom' }, { name: 'salfetka' }]), [
    { inventoryId: 'tom', name: 'Pomidor', note: '2 quti' }, { inventoryId: '', name: 'Salfetka', note: '' },
  ]);
  const fail = (items, pattern) => assert.throws(() => core.cleanItems(state, items), (e) => e instanceof core.LowStockError && pattern.test(e.message));
  fail([], /Kamida bitta/);
  fail([{ inventoryId: 'yoq' }], /topilmadi/);
  fail([{ inventoryId: 'old' }], /topilmadi/, 'ro‘yxatdan olingan mahsulot');
  fail([{ name: 'x' }], /kamida 2 harf/);
  fail(Array.from({ length: 41 }, (_, i) => ({ name: 'n' + i })), /40 ta/);
  const text = core.lowMessage('HALO Asosiy', 'Aziz', '2026-10-16T03:20:00.000Z', [{ inventoryId: 'tom', name: 'Pomidor', note: '2 quti' }, { inventoryId: '', name: 'Salfetka', note: '' }]);
  assert.equal(text, "🛒 Kam qolgan — HALO Asosiy\n👤 Aziz · 16.10 12:20\n\n• Pomidor — 2 quti\n• Salfetka (ro'yxatda yo'q)\n\nJami: 2 ta · HALO Control → Ombor");
});

test('saqlash: avval yoziladi, keyin yuboriladi; takror bosilsa bir marta; yuborilmasa sababi qoladi', async () => {
  let calls = 0;
  const ok = async () => { calls += 1; return { sent: true, reason: '' }; };
  const input = { branchId: 'b1', branchName: 'B1', workerId: 'w1', workerName: 'Aziz', operationId: op(1), items: [{ inventoryId: 'lav' }], state, send: ok };
  const first = await core.saveLowReport(db, input);
  assert.deepEqual([first.alreadySaved, first.report.telegram, first.report.items[0].name, first.report.workerName], [false, { sent: true, reason: '' }, 'Lavash', 'Aziz']);
  const again = await core.saveLowReport(db, input);
  assert.deepEqual([again.alreadySaved, calls], [true, 1], 'ikkinchi bosish — qayta yuborilmadi');
  await assert.rejects(core.saveLowReport(db, { ...input, operationId: 'yomon' }), /Oynani yangilang/);
  const off = await core.saveLowReport(db, { ...input, operationId: op(2), send: async () => ({ sent: false, reason: 'Bot ulanmagan' }) });
  assert.deepEqual(off.report.telegram, { sent: false, reason: 'Bot ulanmagan' });
  const boom = await core.saveLowReport(db, { ...input, operationId: op(3), send: async () => { throw new Error('tarmoq'); } });
  assert.deepEqual(boom.report.telegram, { sent: false, reason: 'Telegramga yuborilmadi.' }, 'yuborishda xato bo‘lsa ham yozuv saqlanadi');
  const list = await core.listLowReports(db, 'b1', '2000-01-01T00:00:00.000Z');
  assert.equal(list.length, 3);
  const resent = await core.resendLowReport(db, 'b1', 'B1', off.report.id, ok);
  assert.deepEqual([resent.telegram.sent, calls], [true, 2]);
  assert.equal((await core.resendLowReport(db, 'b1', 'B1', off.report.id, ok)).telegram.sent, true);
  assert.equal(calls, 2, 'yuborilgani qayta ketmaydi');
  const done = await core.markLowReport(db, 'b1', first.report.id, true);
  assert.ok(done.doneAt);
  assert.equal((await core.markLowReport(db, 'b1', first.report.id, false)).doneAt, '');
  await assert.rejects(core.markLowReport(db, 'boshqa', first.report.id, true), /topilmadi/, 'boshqa filial yozuviga tegolmaydi');
});

test('sahifalar: xodim ilovasida «Kam qolgan» 4 tilda; Ombor sahifasida rahbar ro‘yxati; skriptlar buzilmagan', async () => {
  const compile = (html, path) => assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]), path);
  const app = await (await xodim.GET(new Request(base + '/api/v2/xodim'))).text();
  compile(app, 'xodim');
  assert.match(app, /function lowScreen/);
  assert.match(app, /tile\('low'/);
  assert.equal((app.match(/aLow:'/g) || []).length, 4);
  const page = await (await ombor.GET(new Request(base + '/api/v2/ombor', { headers: owner }))).text();
  compile(page, 'ombor');
  assert.match(page, /function kamHtml/);
});

test('server: xodim yuboradi → Telegram; rahbar ko‘radi, «Olindi», qayta yuborish; ruxsatsiz — yo‘q', async () => {
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  // Sinov mahsulotlari mavjud ro'yxatga qo'shiladi (boshqa yozuvlar buzilmasin).
  p.inventory = [...(p.inventory || []).filter((i) => !['tom', 'lav', 'old'].includes(i.id)), ...state.inventory.map((i) => ({ stock: 5000, minStock: 0, unitCost: 10, ...i }))];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  await createWorkerAccount('main', 'Aziz', 'aziz', '1234');
  const cookie = (await loginWorker('main', 'aziz', '1234')).cookie.split(';')[0];
  const worker = async (body) => { const r = await kam.POST(new Request(base + '/api/v2/kam', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
  const boss = async (body) => { const r = await kam.POST(new Request(base + '/api/v2/kam', { method: 'POST', headers: owner, body: JSON.stringify({ scope: 'owner', branchId: 'main', ...body }) })); return { status: r.status, ...(await r.json()) }; };

  assert.equal((await kam.POST(new Request(base + '/api/v2/kam', { method: 'POST', body: JSON.stringify({ action: 'list' }) }))).status, 401, 'kirmagan — yo‘q');
  assert.equal((await kam.POST(new Request(base + '/api/v2/kam', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'owner', action: 'list' }) }))).status, 401, 'xodim rahbar ro‘yxatini ko‘ra olmaydi');

  // Bot ulanmagan: saqlanadi, sababi aytiladi.
  const noBot = await worker({ action: 'send', operationId: op(10), items: [{ inventoryId: 'tom', note: '2 quti' }] });
  assert.deepEqual([noBot.status, noBot.report.telegram.sent], [200, false]);
  assert.match(noBot.report.telegram.reason, /boti ulanmagan/);
  assert.equal(SENT.length, 0);

  await writeSettings({ botToken: '123456:TEST', chatId: '-100777', botName: 'halo_bot', enabled: true, reportTime: '00:10', lastSentDate: '', lastSentAt: '' });
  const sent = await worker({ action: 'send', operationId: op(11), items: [{ inventoryId: 'lav' }, { name: 'Salfetka', note: 'tugadi' }] });
  assert.deepEqual([sent.status, sent.report.telegram], [200, { sent: true, reason: '' }]);
  assert.equal(SENT.length, 1);
  assert.equal(SENT[0].body.chat_id, '-100777', 'hisobot chatiga');
  assert.match(SENT[0].body.text, /^🛒 Kam qolgan — .+\n👤 Aziz · /);
  assert.match(SENT[0].body.text, /• Lavash\n• Salfetka — tugadi \(ro'yxatda yo'q\)/);
  assert.doesNotMatch(JSON.stringify(sent), /123456:TEST/, 'bot tokeni javobda yo‘q');
  assert.equal((await worker({ action: 'send', operationId: op(11), items: [{ inventoryId: 'lav' }] })).alreadySaved, true);
  assert.equal(SENT.length, 1, 'takror bosish — bitta xabar');

  const today = await worker({ action: 'list' });
  assert.deepEqual(today.reports.map((r) => r.items), [['Lavash', 'Salfetka'], ['Pomidor']], 'xodim bugungi xabarlarni ko‘radi');
  assert.equal('telegram' in today.reports[0], false, 'xodimga faqat kerakli qism');

  const list = await boss({ action: 'list' });
  assert.equal(list.reports.length, 2);
  const failed = list.reports.find((r) => !r.telegram.sent);
  const resent = await boss({ action: 'resend', id: failed.id });
  assert.equal(resent.reports.find((r) => r.id === failed.id).telegram.sent, true, 'bot ulangach qayta yuborildi');
  assert.equal(SENT.length, 2);
  const done = await boss({ action: 'done', id: failed.id });
  assert.ok(done.reports.find((r) => r.id === failed.id).doneAt);
  TG_FAIL = 'Forbidden: bot was kicked';
  const kicked = await worker({ action: 'send', operationId: op(12), items: [{ inventoryId: 'tom' }] });
  assert.deepEqual(kicked.report.telegram, { sent: false, reason: 'Forbidden: bot was kicked' });
  TG_FAIL = '';
  assert.equal((await worker({ action: 'send', operationId: op(13), items: [] })).status, 400);
});
