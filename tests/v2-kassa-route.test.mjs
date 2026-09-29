import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/kassa/route.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');

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

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const url = 'https://halo.example.workers.dev/api/v2/kassa';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;

const post = async (headers, body) => { const r = await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const scriptOf = (html) => html.match(/<script>([\s\S]*?)<\/script>/)[1];
let staff;

test('tayyorlash: filial ma’lumoti va xodim logini', async () => {
  await GET(new Request(url, { headers: owner }));
  const payload = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  payload.accounts = [
    { id: 'account-cash', name: 'Naqd kassa', type: 'cash', openingBalance: 100000 },
    { id: 'account-card', name: 'Karta / POS', type: 'card', openingBalance: 0 },
    { id: 'account-bank', name: 'Bank', type: 'bank', openingBalance: 0 },
  ];
  payload.sales = [
    { id: 's1', date: today, totalRevenue: 7000, accountId: 'account-cash' },
    { id: 's2', date: today, totalRevenue: 50000, accountId: 'account-card' },
  ];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(payload));
  await createWorkerAccount('main', 'Ali', 'ali', '1234');
  staff = { cookie: (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0], 'content-type': 'application/json' };
});

test('kirmagan odam: faqat kirish havolalari, amal taqiqlangan', async () => {
  const html = await (await GET(new Request(url))).text();
  assert.match(html, /var USER=null/);
  assert.doesNotThrow(() => new vm.Script(scriptOf(html)));
  assert.equal((await post({ 'content-type': 'application/json' }, { action: 'summary' })).status, 401);
});

test('xodim: faqat kassa nomlarini ko‘radi — birorta summa yo‘q; rahbar amallari taqiqlangan', async () => {
  const html = await (await GET(new Request(url, { headers: staff }))).text();
  assert.match(html, /"role":"staff"/);
  assert.doesNotThrow(() => new vm.Script(scriptOf(html)));
  const view = await post(staff, { action: 'staff-view' });
  assert.equal(view.body.ok, true);
  assert.deepEqual(view.body.cashAccounts.map((a) => a.name), ['Naqd kassa']);
  assert.ok(!/107000|107,000|57000/.test(JSON.stringify(view.body)), 'kutilgan summa ko‘rinmaydi');
  for (const action of ['summary', 'review', 'close', 'settle']) assert.equal((await post(staff, { action, date: today })).status, 403, action);
});

test('xodim ko‘r sanog‘i → rahbar ko‘rib chiqadi → farq sababi bilan kunni yopadi', async () => {
  const cash = (await post(staff, { action: 'staff-view' })).body.cashAccounts[0].id;
  const sent = await post(staff, { action: 'count', operationId: 'count-aaaaaaaa', counts: { [cash]: 105000 } });
  assert.equal(sent.body.ok, true);
  assert.ok(!JSON.stringify(sent.body).includes('107'), 'javobda kutilgan summa yo‘q');

  const summary = (await post(owner, { action: 'summary', branchId: 'main' })).body.summary;
  const day = summary.days.find((d) => d.date === today);
  assert.deepEqual([day.counted, day.closed, day.countedBy], [true, false, 'Ali']);
  assert.equal(summary.balances.find((b) => b.name === 'Naqd kassa').balance, 107000);

  const review = (await post(owner, { action: 'review', branchId: 'main', date: today })).body.review;
  assert.equal(review.totalVariance, -2000);
  assert.equal((await post(owner, { action: 'close', branchId: 'main', date: today, note: '', operationId: 'close-aaaaaaaa' })).status, 400);
  const closed = await post(owner, { action: 'close', branchId: 'main', date: today, note: 'Qaytim xato', operationId: 'close-aaaaaaaa' });
  assert.equal(closed.body.result.varianceTotal, -2000);
  const after = (await post(owner, { action: 'summary', branchId: 'main' })).body.summary;
  assert.equal(after.balances.find((b) => b.name === 'Naqd kassa').balance, 105000, 'kassa = sanalgan haqiqiy pul');
  assert.equal(after.days.find((d) => d.date === today).variance, -2000);
  assert.equal((await post(staff, { action: 'count', operationId: 'count-bbbbbbbb', counts: { [cash]: 1 } })).status, 400, 'yopilgan kunni qayta sanab bo‘lmaydi');
});

test('karta puli bankka tushdi: kutilayotgan pul kamayadi, komissiya ajraladi', async () => {
  const s = (await post(owner, { action: 'summary', branchId: 'main' })).body.summary;
  const card = s.balances.find((b) => b.role === 'receivable');
  const bank = s.balances.find((b) => b.role === 'bank');
  assert.equal(s.receivables[0].outstanding, 50000);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  assert.equal((await post(owner, { action: 'settle', branchId: 'main', operationId: 'settle-aaaaaaa', date: tomorrow, fromAccountId: card.id, toAccountId: bank.id, received: 48500, fee: 1500 })).status, 400, 'kelajak sanasi rad etiladi');
  assert.equal((await post(owner, { action: 'settle', branchId: 'main', operationId: 'settle-bbbbbbb', date: today, fromAccountId: bank.id, toAccountId: card.id, received: 1, fee: 0 })).status, 400, 'teskari yo‘nalish rad etiladi');
  // Kun yopilgan bo'lsa ham, kassaga tegmaydigan tushum yoziladi (sanalgan kassa o'zgarmaydi).
  const res = await post(owner, { action: 'settle', branchId: 'main', operationId: 'settle-ccccccc', date: today, fromAccountId: card.id, toAccountId: bank.id, received: 48500, fee: 1500 });
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  const after = (await post(owner, { action: 'summary', branchId: 'main' })).body.summary;
  assert.equal(after.receivables[0].outstanding, 0);
  assert.equal(after.balances.find((b) => b.role === 'bank').balance, 48500);
  assert.equal(after.balances.find((b) => b.name === 'Naqd kassa').balance, 105000, 'kassa o‘zgarmadi');
  const cash = after.balances.find((b) => b.name === 'Naqd kassa');
  assert.equal((await post(owner, { action: 'settle', branchId: 'main', operationId: 'settle-ddddddd', date: today, fromAccountId: card.id, toAccountId: cash.id, received: 1000, fee: 0 })).status, 400, 'yopilgan kunda naqd kassaga yozilmaydi');
});

test('rahbar sahifasi skripti to‘g‘ri va filial tanlovi bor', async () => {
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.match(html, /"role":"owner"/);
  assert.doesNotThrow(() => new vm.Script(scriptOf(html)));
});
