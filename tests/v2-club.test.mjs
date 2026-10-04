import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/* Baza: jonli saytdagi kabi avval drizzle migratsiyalari. */
const sqlite = new DatabaseSync(':memory:');
for (const file of fs.readdirSync(new URL('../drizzle/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) {
  for (const sql of fs.readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8').split('--> statement-breakpoint')) if (sql.trim()) sqlite.exec(sql);
}
/* DB.trips — bazaga borilgan so'rovlar soni (bitta batch = bitta borish). batch() javobi haqiqiy D1'dagidek: har ifoda uchun { results, meta }. */
const DB = { trips: 0 };
const exec = (q, p) => { const prepared = sqlite.prepare(q); if (/^\s*SELECT/i.test(q)) return { results: prepared.all(...p), meta: { changes: 0 } }; const r = prepared.run(...p); return { results: [], meta: { changes: Number(r.changes) } }; };
const stmt = (q, p = []) => ({ bind: (...v) => stmt(q, v), all: async () => { DB.trips += 1; return { results: sqlite.prepare(q).all(...p) }; }, first: async () => { DB.trips += 1; return sqlite.prepare(q).get(...p) ?? null; }, run: async () => { DB.trips += 1; const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => exec(q, p) });
globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => stmt(q), batch: async (list) => { DB.trips += 1; sqlite.exec('BEGIN'); try { const out = list.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
globalThis.__HALO_SELF_HOSTED__ = true;

/* Soxta Telegram: haqiqiy xabar ketmaydi. */
const REPORT_TOKEN = '111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TG = { sent: [], fail: '', updates: [] };
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const match = url.match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)/);
  assert.ok(match, `tashqi so‘rov kutilmagan: ${url}`);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  TG.sent.push({ method: match[2], body });
  if (TG.fail) return Response.json({ ok: false, description: TG.fail }, { status: 400 });
  if (match[2] === 'getMe') return Response.json({ ok: true, result: { username: 'halo_hisobot_bot' } });
  if (match[2] === 'getUpdates') return Response.json({ ok: true, result: TG.updates });
  return Response.json({ ok: true, result: { message_id: 1000 + TG.sent.length } });
};

const owner = { 'oai-authenticated-user-email': 'rahbar@example.com', 'content-type': 'application/json' };
const club = await import('../app/core/club.ts');
const page = await import('../app/api/v2/club/route.ts');
const syncRoute = await import('../app/api/integrations/v1/club/sync/route.ts');
const ordersRoute = await import('../app/api/integrations/v1/club/orders/route.ts');
const posPage = await import('../app/api/v2/pos/route.ts');
const kiritish = await import('../app/api/v2/kiritish/route.ts');
const telegram = await import('../app/api/telegram/route.ts');
const bridge = await import('../app/core/bridge.ts');
const store = await import('../app/lib/halo-store.ts');
const ORIGIN = 'https://halo.example';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const state = async (branch = 'main') => (await store.readHaloState(branch)).state;
const patchState = async (patch, branch = 'main') => { const current = await store.readHaloState(branch); await store.replaceHaloState({ ...current.state, ...patch }, current.updatedAt, branch, 'Sinov', 'sinov', 'Sinov'); };
const ownerPost = async (body) => { const response = await page.POST(new Request(`${ORIGIN}/api/v2/club`, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: response.status, ...(await response.json()) }; };
let KEY = '';
const shop = async (route, path, body, key = KEY) => { const response = await route.POST(new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) })); return { status: response.status, ...(await response.json()) }; };
const sync = (body, key) => shop(syncRoute, '/api/integrations/v1/club/sync', body, key);
const event = (order, key) => shop(ordersRoute, '/api/integrations/v1/club/orders', { order }, key);
const groupMessages = () => TG.sent.filter((call) => call.method === 'sendMessage').map((call) => call.body);
const stock = async (id) => (await state()).inventory.find((item) => item.id === id).stock;

const CATALOG = {
  products: [
    { id: 'lavash', name: 'Lavash', category: 'Lavash', price: 7000, active: true },
    { id: 'burger', name: 'HALO Burger', category: 'Burger', price: 8000, active: true },
    { id: 'cola', name: 'Cola 500', category: 'Ichimlik', price: 2000, active: true },
  ],
  addons: [{ id: 'a-cheese', name: 'Pishloq', price: 1000, active: true }, { id: 'a-sauce', name: 'Achchiq sous', price: 500, active: true }],
};
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
/** Do'kon yuboradigan buyurtma (hisob-kitobi do'kondagi kabi). */
function order(overrides = {}) {
  const items = overrides.items || [{ productId: 'lavash', name: 'Lavash', quantity: 2, unitPrice: 7000, lineTotal: 14000, addons: [] }];
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const promotionDiscount = overrides.promotionDiscount || 0;
  const cashbackUsed = overrides.cashbackUsed || 0;
  const deliveryFee = overrides.deliveryFee || 0;
  const id = overrides.id || uuid();
  return {
    id, number: overrides.number || `T${String(seq).padStart(3, '0')}`, status: 'new', fulfillment: deliveryFee ? 'DELIVERY' : 'PICKUP', paymentMethod: 'CASH', paymentStatus: 'PAY_AT_STORE',
    subtotal, promotionDiscount, cashbackUsed, deliveryFee, total: subtotal - promotionDiscount + deliveryFee - cashbackUsed,
    promotionName: promotionDiscount ? 'Juma aksiyasi' : '', arrivalMinutes: 0, createdAt: new Date().toISOString(), completedAt: '', ...overrides, items,
  };
}
const complete = (value) => ({ ...value, status: 'completed', paymentStatus: 'PAID', completedAt: new Date().toISOString() });

test('sof hisob: buyurtma tekshiruvi, 1 wongacha taqsimlash, to‘lov turlari', () => {
  assert.throws(() => club.normalizeClubOrder({ ...order(), subtotal: 13999 }), /Qatorlar yig‘indisi/);
  assert.throws(() => club.normalizeClubOrder({ ...order(), total: 1 }), /To‘lanadigan summa hisobi/);
  assert.throws(() => club.normalizeClubOrder({ ...order(), items: [{ productId: 'lavash', name: 'Lavash', quantity: 2, unitPrice: 7000, lineTotal: 13000, addons: [] }], subtotal: 13000, total: 13000 }), /narx × son/);
  assert.throws(() => club.normalizeClubOrder({ ...order(), paymentMethod: 'CRYPTO' }), /To‘lov turi/);
  assert.throws(() => club.normalizeClubOrder({ ...order(), deliveryFee: 4000, total: 18000 }), /faqat yetkazib berishda/);
  // mijozning shaxsiy ma'lumoti yuborilsa ham saqlanmaydi
  const kept = club.normalizeClubOrder({ ...order(), phone: '010-1234-5678', address: 'Seoul', customerName: 'Ali', note: 'eshik oldida' });
  assert.equal(JSON.stringify(kept).includes('010-1234'), false);
  assert.equal(JSON.stringify(kept).includes('Seoul'), false);

  assert.deepEqual(club.allocateExact([7000, 8000, 2000], 15300), [6300, 7200, 1800]);
  const split = club.allocateExact([3333, 3333, 3334], 1000);
  assert.equal(split.reduce((a, b) => a + b, 0), 1000);
  assert.deepEqual(club.allocateExact([1, 1, 1], 100), [34, 33, 33]);
  assert.deepEqual(club.allocateExact([5000, 0], 0), [0, 0]);

  const links = new Map([['product:lavash', 'r-lavash'], ['product:burger', 'r-burger'], ['addon:a-cheese', 'r-cheese']]);
  const card = club.clubSalePlan(club.normalizeClubOrder({ ...order(), paymentMethod: 'CARD' }), links);
  assert.match(card.skip, /OKPOS/);
  const unlinked = club.clubSalePlan(club.normalizeClubOrder(order({ items: [{ productId: 'cola', name: 'Cola 500', quantity: 1, unitPrice: 2000, lineTotal: 2000, addons: [] }] })), links);
  assert.match(unlinked.wait, /Cola 500.*bog‘lanmagan/);
  // yetkazish: bank; chegirma va cashback savdodan ayriladi; kuryer puli alohida
  const delivery = club.clubSalePlan(club.normalizeClubOrder(order({
    paymentMethod: 'BANK_TRANSFER', deliveryFee: 4000, promotionDiscount: 1700, cashbackUsed: 1000,
    items: [{ productId: 'lavash', name: 'Lavash', quantity: 1, unitPrice: 8500, lineTotal: 8500, addons: [{ id: 'a-cheese', name: 'Pishloq', price: 1000 }, { id: 'a-sauce', name: 'Achchiq sous', price: 500 }] },
      { productId: 'burger', name: 'HALO Burger', quantity: 1, unitPrice: 8500, lineTotal: 8500, addons: [] }],
  })), links);
  assert.equal(delivery.paymentType, 'bank');
  assert.equal(delivery.foodRevenue, 17000 - 1700 - 1000);
  assert.equal(delivery.courier, 4000);
  assert.equal(delivery.courierShortfall, 0);
  // bog'langan qo'shimcha — alohida taom; bog'lanmagani (sous) narxi lavashda qoladi
  assert.deepEqual([...delivery.grossByRecipe], [['r-cheese', 1000], ['r-lavash', 7500], ['r-burger', 8500]]);
  assert.deepEqual(delivery.items, [{ recipeId: 'r-cheese', quantity: 1 }, { recipeId: 'r-lavash', quantity: 1 }, { recipeId: 'r-burger', quantity: 1 }]);
  // cashback yetkazish haqining bir qismini ham qoplagan
  const covered = club.clubSalePlan(club.normalizeClubOrder(order({ paymentMethod: 'BANK_TRANSFER', deliveryFee: 4000, cashbackUsed: 16000 })), links);
  assert.deepEqual([covered.foodRevenue, covered.courier, covered.courierShortfall], [0, 2000, 2000]);
});

test('kalit: bir marta ko‘rinadi, bazada faqat xeshi; noto‘g‘ri kalit rad etiladi; sahifa faqat rahbarga', async () => {
  const stamp = new Date().toISOString();
  await patchState({
    accounts: [{ id: 'cash', name: 'Naqd kassa', type: 'cash', openingBalance: 100000 }, { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 500000 }, { id: 'card', name: 'Karta', type: 'card' }],
    inventory: [
      { id: 'non', name: 'Lavash noni', unit: 'dona', stock: 10, unitCost: 500 },
      { id: 'gosht', name: 'Go‘sht', unit: 'g', stock: 2000, unitCost: 20 },
      { id: 'bulka', name: 'Burger bulkasi', unit: 'dona', stock: 0, unitCost: 600 },
      { id: 'pishloq', name: 'Pishloq', unit: 'dona', stock: 5, unitCost: 300 },
      { id: 'karam', name: 'KARAM', unit: 'g', stock: 0, unitCost: 2, expenseOnly: true },
    ],
    recipes: [
      { id: 'r-lavash', name: 'Lavash', salePrice: 7500, categoryId: '', ingredients: [{ inventoryId: 'non', quantity: 1 }, { inventoryId: 'gosht', quantity: 150 }, { inventoryId: 'karam', quantity: 30 }] },
      { id: 'r-burger', name: 'Halo burger', salePrice: 8000, categoryId: '', ingredients: [{ inventoryId: 'bulka', quantity: 1 }, { inventoryId: 'gosht', quantity: 120 }] },
      { id: 'r-cheese', name: 'Pishloq qo‘shimcha', salePrice: 1000, categoryId: '', ingredients: [{ inventoryId: 'pishloq', quantity: 1 }] },
      { id: 'r-cola', name: 'Cola', salePrice: 2000, categoryId: '', ingredients: [] },
    ],
    sales: [], posOrders: [], stockMovements: [], financialEntries: [], createdAt: stamp,
  });
  assert.equal((await page.GET(new Request(`${ORIGIN}/api/v2/club`))).status, 303, 'kirmagan odam sahifani ko‘rmaydi');
  assert.equal((await page.POST(new Request(`${ORIGIN}/api/v2/club`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 401);
  const html = await (await page.GET(new Request(`${ORIGIN}/api/v2/club`, { headers: owner }))).text();
  assert.match(html, /Telegram do‘kon/);

  assert.equal((await sync(CATALOG, '')).status, 401);
  assert.equal((await sync(CATALOG, 'halo_club_' + 'x'.repeat(43))).status, 401);
  const created = await ownerPost({ action: 'key' });
  assert.match(created.key, /^halo_club_[A-Za-z0-9_-]{43}$/);
  KEY = created.key;
  assert.equal(created.origin, ORIGIN);
  const loaded = await ownerPost({ action: 'load' });
  assert.equal(loaded.key, undefined, 'kalit qayta ko‘rsatilmaydi');
  assert.equal(JSON.stringify(loaded).includes(KEY.slice(12)), false);
  const stored = sqlite.prepare('SELECT * FROM v2_club_settings').all();
  assert.equal(JSON.stringify(stored).includes(KEY), false, 'bazada kalitning o‘zi yo‘q');
  assert.equal(stored[0].key_hash.length, 64);
  // umumiy API kaliti ham, eski kalit ham do'kon manzillarida ishlamaydi
  assert.equal((await sync(CATALOG, 'halo_live_' + 'y'.repeat(43))).status, 401);
  const renewed = await ownerPost({ action: 'key' });
  assert.equal((await sync(CATALOG)).status, 401, 'yangi kalit yaratilgach eskisi ishlamaydi');
  KEY = renewed.key;
  assert.equal((await sync(CATALOG)).status, 200);
});

test('sinxron: mahsulotlar keladi; bog‘lash faqat rahbarda; narx va «tugadi» faqat yoqilganda', async () => {
  let out = await sync(CATALOG);
  assert.equal(out.ok, true);
  assert.deepEqual(out.products, [{ id: 'lavash', linked: false, price: null, soldOut: false }, { id: 'burger', linked: false, price: null, soldOut: false }, { id: 'cola', linked: false, price: null, soldOut: false }]);
  let view = await ownerPost({ action: 'load' });
  assert.ok(view.settings.lastSyncAt);
  assert.deepEqual(view.products.map((p) => [p.kind, p.id, p.recipeId, p.suggest]), [
    ['product', 'burger', '', 'r-burger'], ['product', 'cola', '', ''], ['product', 'lavash', '', 'r-lavash'], ['addon', 'a-sauce', '', ''], ['addon', 'a-cheese', '', ''],
  ], 'nomi mos taom faqat TAKLIF qilinadi');
  assert.equal(view.recipes.find((r) => r.id === 'r-lavash').portions, 10, 'KARAM (omborsiz) hisobga kirmaydi');
  assert.equal(view.recipes.find((r) => r.id === 'r-burger').portions, 0);
  assert.equal(view.recipes.find((r) => r.id === 'r-cola').portions, null);

  assert.match((await ownerPost({ action: 'links', links: [{ kind: 'product', id: 'lavash', recipeId: 'yo‘q-taom' }] })).error, /noto‘g‘ri|topilmadi/);
  view = await ownerPost({ action: 'links', links: [{ kind: 'product', id: 'lavash', recipeId: 'r-lavash' }, { kind: 'product', id: 'burger', recipeId: 'r-burger' }, { kind: 'addon', id: 'a-cheese', recipeId: 'r-cheese' }] });
  assert.equal(view.ok, true);
  out = await sync(CATALOG);
  assert.deepEqual(out.products.map((p) => [p.linked, p.price, p.soldOut]), [[true, null, false], [true, null, false], [false, null, false]], 'bog‘langan, lekin kalit-tugmalar o‘chiq — hech narsa o‘zgarmaydi');

  await ownerPost({ action: 'switch', priceSync: true });
  out = await sync(CATALOG);
  assert.deepEqual(out.products.map((p) => p.price), [7500, 8000, null], 'narx HALO Control’dagi sotuv narxi');
  assert.deepEqual(out.addons, [{ id: 'a-cheese', linked: true, price: 1000 }, { id: 'a-sauce', linked: false, price: null }]);
  await ownerPost({ action: 'switch', stockSync: true });
  out = await sync(CATALOG);
  assert.deepEqual(out.products.map((p) => p.soldOut), [false, true, false], 'bulka 0 — burger tugagan');
  // do'kon yuborgan narx/nom bog'lanishni buzmaydi; do'kon "recipeId" yuborsa ham e'tiborga olinmaydi
  out = await sync({ products: [{ id: 'burger', name: 'HALO Burger XL', category: 'Burger', price: 9000, active: true, recipeId: 'r-cola' }], addons: [] });
  assert.deepEqual(out.products, [{ id: 'burger', linked: true, price: 8000, soldOut: true }]);
  await patchState({ inventory: (await state()).inventory.map((item) => item.id === 'bulka' ? { ...item, stock: 3 } : item) });
  assert.equal((await sync(CATALOG)).products[1].soldOut, false, 'ombor to‘ldirilgach ochiladi');
  await ownerPost({ action: 'switch', priceSync: false, stockSync: false });
});

test('guruh: /buyurtma bilan topiladi; yangi buyurtma bir marta boradi, mijoz ma’lumotisiz; bekor qilinsa xabar', async () => {
  assert.match((await ownerPost({ action: 'discoverGroup' })).error, /Telegram botini ulang/);
  assert.equal((await (await telegram.POST(new Request(`${ORIGIN}/api/telegram`, { method: 'POST', headers: owner, body: JSON.stringify({ action: 'save', branchId: 'main', botToken: REPORT_TOKEN, chatId: '555' }) }))).json()).ok, true);
  TG.updates = [{ message: { text: 'salom', chat: { id: -100111, type: 'supergroup', title: 'Boshqa guruh' } } }];
  assert.match((await ownerPost({ action: 'discoverGroup' })).error, /\/buyurtma deb yozing/);
  TG.updates.push({ message: { text: '/buyurtma@halo_hisobot_bot', message_thread_id: 7, chat: { id: -100222, type: 'supergroup', title: 'HALO buyurtmalar' } } });
  TG.sent.length = 0;
  let view = await ownerPost({ action: 'discoverGroup' });
  assert.deepEqual([view.settings.groupChatId, view.settings.groupChatName, view.settings.groupThreadId], ['-100222', 'HALO buyurtmalar', 7]);
  assert.match(groupMessages()[0].text, /buyurtmalar guruhi ulandi/);

  TG.sent.length = 0;
  const first = order({ items: [{ productId: 'lavash', name: 'Lavash', quantity: 2, unitPrice: 8000, lineTotal: 16000, addons: [{ id: 'a-cheese', name: 'Pishloq', price: 1000 }] }], promotionDiscount: 1600 });
  let out = await event({ ...first, phone: '010-9999-0000', address: 'Incheon', customerName: 'Vali' });
  assert.equal(out.ok, true);
  assert.equal(out.notified, true);
  const sent = groupMessages();
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].chat_id, sent[0].message_thread_id], ['-100222', 7]);
  assert.match(sent[0].text, /🛎 Yangi Telegram buyurtma #T\d+\n🥡 Olib ketish\n💵 Naqd \(do‘konda\)\n\n• Lavash × 2 — ₩16,000\n {3}\+ Pishloq\n\nAksiya \(Juma aksiyasi\): −₩1,600\nJami: ₩14,400/);
  assert.equal(/010-9999|Incheon|Vali/.test(sent[0].text), false);
  assert.equal(JSON.stringify(sqlite.prepare('SELECT payload FROM v2_club_orders').all()).match(/010-9999|Incheon|Vali/), null, 'shaxsiy ma’lumot bazaga ham yozilmaydi');
  await event(first);
  assert.equal(groupMessages().length, 1, 'qayta yuborilsa ikkinchi xabar ketmaydi');
  // guruhga bormasa — sababi saqlanadi, keyingi urinishda boradi
  const second = order();
  TG.fail = 'Bad Request: chat not found';
  out = await event(second);
  assert.deepEqual([out.ok, out.notified, out.noticeReason], [true, false, 'Bad Request: chat not found']);
  TG.fail = '';
  assert.equal((await event(second)).notified, true);
  // bekor qilindi
  TG.sent.length = 0;
  out = await event({ ...second, status: 'cancelled' });
  assert.equal(out.order.status, 'cancelled');
  assert.match(groupMessages()[0].text, /❌ Telegram buyurtma #T\d+ bekor qilindi/);
  out = await event({ ...second, status: 'accepted' });
  assert.equal(out.order.status, 'cancelled', 'yopilgan buyurtma holati orqaga qaytmaydi');
  // do'kon buyurtmani qabul qilib ulgurgan bo'lsa ham "yangi buyurtma" xabari bir marta boradi; topshirilgani uchun esa bormaydi
  TG.sent.length = 0;
  const quick = order();
  out = await event({ ...quick, status: 'accepted' });
  assert.equal(out.notified, true);
  assert.match(groupMessages()[0].text, /🛎 Yangi Telegram buyurtma/);
  await event({ ...quick, status: 'ready' });
  assert.equal(groupMessages().length, 1);
  const done = order({ paymentMethod: 'CARD' });
  out = await event({ ...done, status: 'completed', completedAt: new Date().toISOString() });
  assert.equal(groupMessages().length, 1, 'allaqachon topshirilgan buyurtma uchun "yangi" xabari ketmaydi');
  await event({ ...quick, status: 'cancelled' });
  view = await ownerPost({ action: 'testGroup' });
  assert.equal(view.ok, true);
  await event({ ...first, status: 'cancelled' });
});

test('topshirildi → savdo: o‘chiq bo‘lsa kutadi; yoqilgach tushum, ombor, kassa va kuryer puli 1 wongacha to‘g‘ri; takror yozilmaydi', async () => {
  const before = await state();
  // 1) yozish o'chiq
  const cash = order({ items: [{ productId: 'lavash', name: 'Lavash', quantity: 2, unitPrice: 8000, lineTotal: 16000, addons: [{ id: 'a-cheese', name: 'Pishloq', price: 1000 }] }], promotionDiscount: 1600, cashbackUsed: 400 });
  await event(cash);
  let out = await event(complete(cash));
  assert.deepEqual([out.sale.state, /o‘chirilgan/.test(out.sale.note)], ['waiting', true]);
  assert.equal((await state()).sales.length, before.sales.length);
  // 2) yoqiladi va kutayotganlar yoziladi
  await ownerPost({ action: 'switch', salesEnabled: true });
  let view = await ownerPost({ action: 'writeWaiting' });
  assert.deepEqual(view.written, { saved: 1, waiting: 0, skipped: 1 }, 'naqd buyurtma yozildi; oldingi sinovdagi karta buyurtmasi o‘tkazib yuborildi');
  let now = await state();
  const sales = now.sales.filter((sale) => sale.clubOrderId === cash.id);
  assert.deepEqual(sales.map((sale) => [sale.recipeId, sale.quantity, sale.totalRevenue, sale.listRevenue, sale.accountId, sale.salesChannel, sale.taxPctAtSale]).sort(), [
    ['r-cheese', 2, 1750, 2000, 'cash', 'halo', 0], ['r-lavash', 2, 12250, 14000, 'cash', 'halo', 0],
  ]);
  assert.equal(sales.reduce((sum, sale) => sum + sale.totalRevenue, 0), 16000 - 1600 - 400, 'tushum = mijoz to‘lagan pul');
  assert.equal(await stock('non'), 8);
  assert.equal(await stock('gosht'), 2000 - 300);
  assert.equal(await stock('pishloq'), 3);
  const posOrder = now.posOrders.find((entry) => entry.clubOrderId === cash.id);
  assert.deepEqual([posOrder.total, posOrder.workerName, posOrder.paymentType, posOrder.clubDiscount], [14000, 'Telegram do‘kon', 'cash', 2000]);
  assert.match(posOrder.note, /Telegram #T\d+ · olib ketish/);
  assert.equal(now.financialEntries.length, 0, 'yetkazish yo‘q — kuryer puli ham yo‘q');
  // 3) qayta yuborilsa ikkinchi marta yozilmaydi
  out = await event(complete(cash));
  assert.deepEqual([out.sale.state, out.sale.alreadySaved], ['saved', true]);
  assert.equal((await state()).sales.length, now.sales.length);
  assert.equal(await stock('non'), 8);

  // 4) yetkazib berish: bank; yetkazish haqi daromad emas
  const delivery = order({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', deliveryFee: 4000, items: [{ productId: 'burger', name: 'HALO Burger', quantity: 1, unitPrice: 8000, lineTotal: 8000, addons: [] }, { productId: 'lavash', name: 'Lavash', quantity: 1, unitPrice: 7000, lineTotal: 7000, addons: [] }], promotionDiscount: 1001 });
  out = await event(complete(delivery));
  assert.equal(out.sale.state, 'saved');
  assert.match(out.sale.note, /Hisob-raqam · ₩13,999 · kuryer puli ₩4,000/);
  now = await state();
  const lines = now.sales.filter((sale) => sale.clubOrderId === delivery.id);
  assert.equal(lines.reduce((sum, sale) => sum + sale.totalRevenue, 0), 13999);
  assert.ok(lines.every((sale) => Number.isInteger(sale.totalRevenue) && sale.accountId === 'bank'));
  const courier = now.financialEntries.find((entry) => entry.id === `club-courier:${delivery.id}`);
  assert.deepEqual([courier.type, courier.amount, courier.accountId, courier.affectsProfit, courier.category], ['income', 4000, 'bank', false, club.COURIER_CATEGORY]);
  // bankka tushgan pul = mijoz to'lagan jami (1 won ham yo'qolmaydi)
  assert.equal(lines.reduce((sum, sale) => sum + sale.totalRevenue, 0) + courier.amount, delivery.total);

  // 5) pul jurnali: kuryer puli alohida hisobda; kuryerga to'langach nolga tushadi; foydaga ta'sir qilmaydi
  let plan = bridge.buildBridgePlan(now, today);
  const courierLines = (p) => p.entries.flatMap((entry) => entry.lines).filter((line) => line.code === 'kuryer-puli').reduce((sum, line) => sum + line.amount, 0);
  assert.equal(courierLines(plan), -4000, 'kuryerga 4,000 qarzmiz');
  assert.equal(plan.entries.filter((entry) => entry.source === `pul:club-courier:${delivery.id}`)[0].lines.some((line) => line.code === 'savdo' || line.code === 'boshqa-kirim'), false);
  const paid = await kiritish.POST(new Request(`${ORIGIN}/api/v2/kiritish`, { method: 'POST', headers: owner, body: JSON.stringify({ action: 'expense', branchId: 'main', operationId: '11111111-1111-4111-8111-111111111111', category: club.COURIER_CATEGORY, name: 'kuryer Aziz', amount: 4000, date: today, accountId: 'bank' }) }));
  assert.equal((await paid.json()).ok, true);
  now = await state();
  assert.equal(now.financialEntries.find((entry) => entry.type === 'expense').affectsProfit, false);
  plan = bridge.buildBridgePlan(now, today);
  assert.equal(courierLines(plan), 0);
  assert.equal(plan.entries.flatMap((entry) => entry.lines).filter((line) => line.code === 'xarajat').length, 0, 'kuryer to‘lovi xarajatga tushmaydi');

  // 6) karta — yozilmaydi; to'liq cashback — tushum 0, ombor kamayadi
  const card = order({ paymentMethod: 'CARD' });
  out = await event(complete(card));
  assert.deepEqual([out.sale.state, /OKPOS/.test(out.sale.note)], ['skipped', true]);
  assert.equal((await state()).sales.some((sale) => sale.clubOrderId === card.id), false);
  const nonBefore = await stock('non');
  const free = order({ paymentMethod: 'CASHBACK', paymentStatus: 'PAID', cashbackUsed: 14000 });
  out = await event(complete(free));
  assert.equal(out.sale.state, 'saved');
  assert.deepEqual((await state()).sales.filter((sale) => sale.clubOrderId === free.id).map((sale) => sale.totalRevenue), [0]);
  assert.equal(await stock('non'), nonBefore - 2);

  // 7) hisobi noto'g'ri buyurtma qabul qilinmaydi (422 — qayta yuborish foydasiz)
  out = await event({ ...complete(order()), total: 5 });
  assert.deepEqual([out.status, out.ok, out.retry], [422, false, false]);
});

test('bog‘lanmagan mahsulot kutadi; bog‘langach yoziladi; rahbar bekor qilsa ombor va kuryer puli qaytadi, do‘kon qayta yozdira olmaydi', async () => {
  const cola = order({ items: [{ productId: 'cola', name: 'Cola 500', quantity: 3, unitPrice: 2000, lineTotal: 6000, addons: [] }] });
  let out = await event(complete(cola));
  assert.deepEqual([out.sale.state, /Cola 500.*bog‘lanmagan/.test(out.sale.note)], ['waiting', true]);
  let view = await ownerPost({ action: 'load' });
  assert.equal(view.orders.find((o) => o.id === cola.id).saleState, 'waiting');
  await ownerPost({ action: 'links', links: [{ kind: 'product', id: 'cola', recipeId: 'r-cola' }] });
  view = await ownerPost({ action: 'rewrite', orderId: cola.id });
  // Cola retsepti omborga bog'lanmagan — HALO HISOB qoidasi bo'yicha yozilmaydi, sababi ko'rinadi
  assert.deepEqual([view.outcome.state, /omborga bog‘lanmagan/.test(view.outcome.note)], ['waiting', true]);
  await patchState({
    inventory: [...(await state()).inventory, { id: 'cola-b', name: 'Cola 500ml', unit: 'dona', stock: 24, unitCost: 900 }],
    recipes: (await state()).recipes.map((recipe) => recipe.id === 'r-cola' ? { ...recipe, ingredients: [{ inventoryId: 'cola-b', quantity: 1 }] } : recipe),
  });
  view = await ownerPost({ action: 'rewrite', orderId: cola.id });
  assert.equal(view.outcome.state, 'saved');
  assert.equal(await stock('cola-b'), 21);

  // rahbar sahifadan bekor qiladi
  const delivery = order({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', deliveryFee: 5000 });
  await event(complete(delivery));
  const nonAfterSale = await stock('non');
  assert.ok((await state()).financialEntries.some((entry) => entry.id === `club-courier:${delivery.id}`));
  view = await ownerPost({ action: 'cancelSale', orderId: delivery.id });
  assert.equal(view.orders.find((o) => o.id === delivery.id).saleState, 'cancelled');
  let now = await state();
  assert.equal(now.sales.some((sale) => sale.clubOrderId === delivery.id), false);
  assert.equal(now.financialEntries.some((entry) => entry.id === `club-courier:${delivery.id}`), false);
  assert.equal(await stock('non'), nonAfterSale + 2);
  out = await event(complete(delivery));
  assert.equal(out.sale.state, 'cancelled', 'do‘kon qayta yuborsa ham tirilmaydi');
  assert.equal((await state()).sales.some((sale) => sale.clubOrderId === delivery.id), false);

  // HALO HISOB oynasidan bekor qilish ham kuryer pulini olib tashlaydi va belgini qo'yadi
  const second = order({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', deliveryFee: 4000 });
  await event(complete(second));
  const cancel = await posPage.POST(new Request(`${ORIGIN}/api/v2/pos`, { method: 'POST', headers: owner, body: JSON.stringify({ action: 'cancel', branchId: 'main', date: today, id: club.clubPosOrderId(second.id) }) }));
  assert.equal((await cancel.json()).ok, true);
  now = await state();
  assert.equal(now.sales.some((sale) => sale.clubOrderId === second.id), false);
  assert.equal(now.financialEntries.some((entry) => entry.id === `club-courier:${second.id}`), false);
  assert.equal((await ownerPost({ action: 'load' })).orders.find((o) => o.id === second.id).saleState, 'cancelled');

  // ma'lumot qayta ko'chirilsa (savdo yozuvi yo'qolsa) — "yozuv yo'q" deb ko'rinadi va rahbar qayta yozadi
  const kept = order();
  await event(complete(kept));
  const snapshot = await state();
  await patchState({ sales: snapshot.sales.filter((sale) => sale.clubOrderId !== kept.id), posOrders: snapshot.posOrders.filter((entry) => entry.clubOrderId !== kept.id) });
  view = await ownerPost({ action: 'load' });
  assert.equal(view.orders.find((o) => o.id === kept.id).missing, true);
  assert.equal((await event(complete(kept))).sale.alreadySaved, true, 'do‘kon qayta yuborsa o‘zi yozilmaydi');
  assert.equal((await state()).sales.some((sale) => sale.clubOrderId === kept.id), false);
  view = await ownerPost({ action: 'rewrite', orderId: kept.id });
  assert.equal(view.outcome.state, 'saved');
  assert.equal(view.orders.find((o) => o.id === kept.id).missing, false);
  assert.equal((await state()).sales.filter((sale) => sale.clubOrderId === kept.id).length, 1);
});

test('yopilgan kun: buyurtma kutadi; rahbar bugungi sana bilan yozadi (faqat ochiq kunga)', async () => {
  const kassa = await import('../app/core/kassa-service.ts');
  const scope = { tenantId: 'halo', branchId: 'main' };
  const cashAccounts = (await kassa.staffView(globalThis.__HALO_CONTROL_DB__, scope, await state(), today)).cashAccounts;
  await kassa.staffCount(globalThis.__HALO_CONTROL_DB__, scope, await state(), today, { operationId: 'count-clubsinov', actor: 'Ali', counts: Object.fromEntries(cashAccounts.map((account) => [account.id, 1000])) });
  await kassa.ownerClose(globalThis.__HALO_CONTROL_DB__, scope, await state(), today, { date: today, note: 'sinov', reviewer: 'Rahbar', operationId: 'close-clubsinov' });
  const late = order();
  const count = (await state()).sales.length;
  const out = await event(complete(late));
  assert.deepEqual([out.ok, out.sale.state, /kassada yopilgan/.test(out.sale.note)], [true, 'waiting', true]);
  assert.equal((await state()).sales.length, count, 'yopilgan kunga hech narsa yozilmadi');
  const view = await ownerPost({ action: 'rewrite', orderId: late.id, useToday: true });
  assert.equal(view.outcome.state, 'waiting', 'bugun ham yopiq — baribir yozilmaydi');
  assert.equal((await state()).sales.length, count);
});

test('tezlik: do‘kon so‘rovi bazaga kam boradi (har borish ~0,2 soniya)', async () => {
  const trips = async (run) => { const before = DB.trips; const out = await run(); return [out, DB.trips - before]; };
  // Ikkala kalit-tugma o'chiq: kalitni tekshirish + bitta to'plam. Filial holati o'qilmaydi.
  await ownerPost({ action: 'switch', priceSync: false, stockSync: false });
  const [off, offTrips] = await trips(() => sync(CATALOG));
  assert.deepEqual([off.ok, off.priceSync, off.stockSync, off.updatedAt], [true, false, false, '']);
  assert.equal(offTrips, 2, 'kalit + bitta to‘plam');
  assert.equal(off.products.find((item) => item.id === 'lavash').linked, true, 'bog‘lanish holati filial holatisiz ham ko‘rinadi');
  assert.deepEqual(off.products.map((item) => [item.price, item.soldOut]), off.products.map(() => [null, false]));
  // Yoqilgan: ustiga faqat filial holatini o'qish qo'shiladi.
  await ownerPost({ action: 'switch', priceSync: true, stockSync: true });
  const [on, onTrips] = await trips(() => sync(CATALOG));
  assert.deepEqual([on.ok, on.priceSync, on.stockSync, Boolean(on.updatedAt)], [true, true, true, true]);
  assert.equal(onTrips, 3, 'kalit + to‘plam + filial holati');
  // 41 ta mahsulot: ikki to'plam, javob baribir to'liq.
  const many = { products: Array.from({ length: 41 }, (_, index) => ({ id: `ko-p-${index}`, name: `Sinov ${index}`, category: 'Sinov', price: 1000 + index, active: true })), addons: [] };
  const [big, bigTrips] = await trips(() => sync(many));
  assert.deepEqual([big.ok, big.products.length, bigTrips], [true, 41, 4]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM v2_club_products WHERE external_id LIKE 'ko-p-%'").get().n, 41);
  sqlite.prepare("DELETE FROM v2_club_products WHERE external_id LIKE 'ko-p-%'").run();
  // Bo'sh ro'yxat ham ishlaydi.
  const [empty] = await trips(() => sync({ products: [], addons: [] }));
  assert.deepEqual([empty.ok, empty.products.length], [true, 0]);
  // Buyurtma hodisasi: yozish, shartli yangilash va o'qish — bitta to'plamda.
  const fast = order();
  const [first] = await trips(() => event(fast));
  assert.deepEqual([first.ok, first.order.status], [true, 'new']);
  const [again, againTrips] = await trips(() => event({ ...fast, status: 'accepted' }));
  assert.deepEqual([again.ok, again.order.status], [true, 'accepted']);
  assert.ok(againTrips <= 3, `oraliq holat: kalit + to‘plam + jurnal, chiqdi ${againTrips}`);
  // Holat orqaga qaytmaydi, yopilgani o'zgarmaydi (endi bitta SQL shartida).
  assert.equal((await event({ ...fast, status: 'new' })).order.status, 'accepted');
  assert.equal((await event({ ...fast, status: 'cancelled' })).order.status, 'cancelled');
  assert.equal((await event(complete(fast))).order.status, 'cancelled', 'bekor qilingan buyurtma topshirilganga aylanmaydi');
  assert.equal((await event({ ...fast, status: 'ready' })).order.status, 'cancelled');
});
