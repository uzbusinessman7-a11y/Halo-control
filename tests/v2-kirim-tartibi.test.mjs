import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* "Bitta yo'l" tartibi: mahsulot kirimi faqat «Xarid → Yangi kirim» orqali. Kiritish sahifasida alohida
   «Ombor kirimi» / «Sabzavot va sous» yo'q, «+ Xarid» yo'q. Omborga puli yozilmay tushgan kirim (xodim qabul qilgan
   yoki eski yo'l bilan kiritilgan) «To'lovi yozilmagan kirimlar»da chiqadi va bir marta yopiladi.
   Asosiy talab: 1 wongacha to'g'ri, mahsulot ham, xarajat ham ikki marta yozilmasin. */
const { GET, POST } = await import('../app/api/v2/qarz/route.ts');
const kiritish = await import('../app/api/v2/kiritish/route.ts');
const intakeApi = await import('../app/api/intake/route.ts');
const removals = await import('../app/api/record-removals/route.ts');
const { pendingReceipts, receiptTransactionId, MARKET_SUPPLIER_ID, PENDING_DAYS } = await import('../app/core/receipts.ts');
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
const base = 'https://halo.example.workers.dev';
const url = base + '/api/v2/qarz';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;
const seoul = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
const today = seoul(new Date());
const daysAgo = (n) => seoul(new Date(Date.now() - n * 86_400_000));
const state = () => JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
const api = async (body, headers = owner) => { const response = await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: response.status, ...(await response.json()) }; };
const stock = (id) => state().inventory.find((item) => item.id === id).stock;
const balance = (id) => (state().suppliers.find((supplier) => supplier.id === id) || {}).balance;
const profitExpenses = () => state().financialEntries.filter((entry) => entry.type === 'expense' && entry.affectsProfit !== false && !entry.cancelledAt && !entry.reversedEntryId);
const sum = (list) => list.reduce((total, entry) => total + Number(entry.amount), 0);
/** Puli yozilmagan ombor kirimi (xodim «Mahsulot kirimi» yoki eski «Ombor kirimi» shu dvigatel bilan yozadi). */
const stockOnly = async (lines, date = today, vegetableOnly = false) => {
  const response = await intakeApi.POST(new Request(base + '/api/intake?branch=main', { method: 'POST', headers: owner, body: JSON.stringify({ inventoryOnly: true, vegetableOnly, operationId: crypto.randomUUID(), date, lines }) }));
  const body = await response.json();
  assert.equal(body.ok, true, JSON.stringify(body));
  return body;
};

test('tayyorgarlik va sahifalar: ikkinchi yo‘l yo‘q', async () => {
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /id="newIn"[^>]*>📦 Yangi kirim</);
  assert.match(html, /id="pendCard"/);
  assert.match(html, /id="histCard"/);
  assert.doesNotMatch(html, /addPur|\+ Xarid \(qarz oshadi\)/, '«+ Xarid» yo‘q');
  assert.doesNotMatch(html, /MEZANA hisobi ›/, 'MEZANA — menyuda, sahifada takror tugma yo‘q');

  const k = await (await kiritish.GET(new Request(base + '/api/v2/kiritish', { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(k.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.doesNotMatch(k, /Ombor kirimi|Sabzavot va sous|inventoryOnly|\/api\/intake/, 'Kiritishda alohida ombor kirimi yo‘q');
  assert.match(k, /href="\/api\/v2\/qarz\?kirim=1"[^>]*><button[^>]*>📦 Mahsulot kirimi ›/, 'tugma yagona «Yangi kirim» oynasiga olib boradi');
  for (const tab of ['Savdo', 'POS hisobot', 'Xarajat', 'Yeyilgan / isrof']) assert.ok(k.includes(tab), tab);

  const p = state();
  p.accounts = [{ id: 'cash', name: 'Naqd kassa', type: 'cash', openingBalance: 0 }, { id: 'bank', name: 'Hisob-raqam', type: 'bank', openingBalance: 0 }];
  p.suppliers = [{ id: 'n', name: 'Nodir aka', phone: '', openingBalance: 0, balance: 0 }, { id: 'mz', name: 'MEZANA', phone: '', openingBalance: 0, balance: 0 }];
  p.inventory = [
    { id: 'gosht', name: 'Go‘sht', unit: 'g', stock: 0, minStock: 0, unitCost: 15 },
    { id: 'lavash', name: 'Lavash', unit: 'dona', stock: 0, minStock: 0, unitCost: 500, packageName: 'quti', unitsPerPackage: 20 },
    { id: 'pomidor', name: 'Pomidor', unit: 'g', stock: 0, minStock: 0, unitCost: 0, expenseOnly: true },
  ];
  p.transactions = [];
  Object.assign(p, { vegetableExpenseVersion: 1, vegetableExpenseStartedAt: '2026-01-01T00:00:00.000Z', vegetableExpenseSettings: { normPct: 6 }, vegetablePurchases: [], vegetableNotifications: [] });
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));

  const kd = await (await kiritish.POST(new Request(base + '/api/v2/kiritish', { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(kd.ok, true);
  assert.deepEqual([kd.receipts, kd.inventory], [undefined, undefined], 'Kiritish ombor kirimi ma’lumotini yubormaydi');

  const first = await api({});
  assert.deepEqual([first.ok, first.pending, first.receipts, first.marketId], [true, [], [], MARKET_SUPPLIER_ID]);
  assert.equal((await api({ action: 'settle', key: 'x', supplierId: 'n' }, { 'content-type': 'application/json' })).status, 401, 'faqat rahbar');
});

test('to‘lovi yozilmagan kirim: ro‘yxatda chiqadi; «Qarzga» — faqat qarz oshadi, ombor va xarajat o‘zgarmaydi', async () => {
  await stockOnly([{ inventoryId: 'gosht', quantity: 10, unit: 'kg', amount: 150000 }, { inventoryId: 'lavash', quantity: 2, unit: 'quti', amount: 20000 }]);
  assert.deepEqual([stock('gosht'), stock('lavash'), balance('n')], [10000, 40, 0]);
  const list = (await api({})).pending;
  assert.equal(list.length, 1, 'ikki qatorli bitta kirim — bitta yozuv');
  const [r] = list;
  assert.deepEqual([r.date, r.amount, r.count, r.supplierId, r.veg], [today, 170000, 2, '', false]);
  assert.match(r.lines, /Go‘sht 10 kg, Lavash 2 quti/);
  const history = (await api({})).receipts;
  assert.deepEqual([history.reduce((total, entry) => total + entry.amount, 0), [...new Set(history.map((entry) => entry.money))]], [170000, ['pending']], 'tarixda ham ko‘rinadi — "to‘lovi yozilmagan" belgisi bilan');

  // Noto'g'ri so'rovlar hech narsa yozmaydi.
  assert.equal((await api({ action: 'settle', key: r.key, supplierId: '' })).status, 400);
  assert.equal((await api({ action: 'settle', key: r.key, supplierId: 'yoq' })).status, 400);
  assert.equal((await api({ action: 'settle', key: r.key, supplierId: 'mz' })).status, 400, 'MEZANA alohida bo‘limda');
  assert.equal((await api({ action: 'settle', key: 'boshqa', supplierId: 'n' })).status, 409);
  assert.equal((await api({ action: 'settle', key: r.key, supplierId: 'n', pay: 'paid', accountId: 'yoq' })).status, 400);
  assert.equal((await api({ action: 'settle', key: r.key, supplierId: MARKET_SUPPLIER_ID, pay: 'debt' })).status, 400, 'bozor xaridi qarzga yozilmaydi');
  assert.deepEqual([state().transactions.length, balance('n')], [0, 0]);

  const expensesBefore = sum(profitExpenses());
  const done = await api({ action: 'settle', key: r.key, supplierId: 'n', pay: 'debt', amount: 1 });
  assert.deepEqual([done.status, done.ok, done.amount, done.paid, done.supplierName], [200, true, 170000, false, 'Nodir aka'], 'summa kirimning o‘zidan olinadi');
  const tx = state().transactions.find((entry) => entry.id === receiptTransactionId(r.key));
  assert.deepEqual([tx.type, tx.supplierId, tx.amount, tx.date], ['purchase', 'n', 170000, today]);
  assert.match(tx.note, /^Kirim: Go‘sht 10 kg, Lavash 2 quti/);
  assert.deepEqual([balance('n'), stock('gosht'), stock('lavash')], [170000, 10000, 40], 'qarz +170 000; ombor qayta oshmadi');
  assert.equal(sum(profitExpenses()), expensesBefore, 'ombor mahsuloti xarajat bo‘lmaydi');
  const after = await api({});
  assert.deepEqual([after.pending, [...new Set(after.receipts.map((entry) => entry.money))]], [[], ['settled']], 'ro‘yxatdan chiqdi; tarixda "puli yozilgan"');
  // Ikkinchi marta bosilsa — ikkinchi qarz yozilmaydi.
  assert.equal((await api({ action: 'settle', key: r.key, supplierId: 'n', pay: 'debt' })).status, 409);
  assert.deepEqual([state().transactions.length, balance('n')], [1, 170000]);
});

test('«To‘landi» va Bozor / naqd: pul hisobdan chiqadi, qarz 0, foydaga ikkinchi marta ta’sir qilmaydi', async () => {
  await stockOnly([{ inventoryId: 'gosht', quantity: 2, unit: 'kg', amount: 31000 }], daysAgo(1));
  const [r] = (await api({})).pending;
  assert.equal(state().suppliers.some((supplier) => supplier.id === MARKET_SUPPLIER_ID), false);
  const expensesBefore = sum(profitExpenses());
  const done = await api({ action: 'settle', key: r.key, supplierId: MARKET_SUPPLIER_ID, pay: 'paid', accountId: 'cash' });
  assert.deepEqual([done.status, done.ok, done.amount, done.paid], [200, true, 31000, true], JSON.stringify(done));
  assert.deepEqual([balance(MARKET_SUPPLIER_ID), balance('n'), stock('gosht')], [0, 170000, 12000], '«Bozor / naqd xarid» hisobi o‘zi ochildi; qarzi 0');
  const money = state().financialEntries.filter((entry) => entry.category === 'Mahsulot xaridi');
  assert.deepEqual(money.map((entry) => [entry.amount, entry.accountId, entry.affectsProfit, entry.date]), [[31000, 'cash', false, daysAgo(1)]], 'kassadan 31 000 chiqdi, foydaga ta’sirsiz');
  assert.equal(sum(profitExpenses()), expensesBefore);
  assert.deepEqual((await api({})).pending, []);

  // Sabzavot / sous: olingan kuni bir marta xarajat bo'lgan — pul tomoni yozilganda ikkinchi marta xarajat bo'lmaydi.
  await stockOnly([{ inventoryId: 'pomidor', quantity: 5, unit: 'kg', amount: 15000 }], today, true);
  const vegExpenses = sum(profitExpenses());
  assert.equal(vegExpenses - expensesBefore, 15000, 'sabzavot olingan kuni xarajat');
  const [veg] = (await api({})).pending;
  assert.deepEqual([veg.amount, veg.veg], [15000, true]);
  assert.equal((await api({ action: 'settle', key: veg.key, supplierId: 'n', pay: 'paid', accountId: 'bank' })).ok, true);
  assert.equal(sum(profitExpenses()), vegExpenses, 'ikkinchi marta xarajat bo‘lmadi');
  assert.equal(balance('n'), 170000, 'to‘langan — qarz o‘zgarmadi');
});

test('«Yozuv kerak emas», yozuv olib tashlansa qaytishi, eski kirimlar', async () => {
  await stockOnly([{ inventoryId: 'lavash', quantity: 1, unit: 'quti', amount: 10000 }], daysAgo(2));
  await stockOnly([{ inventoryId: 'lavash', quantity: 3, unit: 'quti', amount: 30500 }], daysAgo(3));
  const before = JSON.stringify(state());
  const list = (await api({})).pending;
  assert.deepEqual(list.map((entry) => entry.amount), [10000, 30500], 'yangisi tepada');
  assert.equal((await api({ action: 'dismiss', keys: ['begona'] })).status, 409);
  const skip = await api({ action: 'dismiss', keys: [list[0].key], note: 'puli oldin yozilgan' });
  assert.deepEqual([skip.ok, skip.count], [true, 1]);
  const marked = await api({});
  assert.deepEqual(marked.pending.map((entry) => entry.amount), [30500]);
  assert.equal(marked.receipts.find((entry) => entry.amount === 10000).money, '', '"yozuv kerak emas" — tarixda belgisiz');
  assert.equal(JSON.stringify(state()), before, 'belgilash ombor, qarz va pulga tegmaydi');
  assert.equal((await api({ action: 'settle', key: list[0].key, supplierId: 'n', pay: 'debt' })).status, 409, 'belgilangan kirimga yozuv qo‘shilmaydi');
  assert.deepEqual([(await api({ action: 'dismiss', all: true })).count, (await api({})).pending.length], [1, 0]);

  // Qarz yozuvi olib tashlansa — kirim yana "to'lovi yozilmagan" bo'ladi (pul tomoni yo'qolib qolmaydi).
  await stockOnly([{ inventoryId: 'gosht', quantity: 1, unit: 'kg', amount: 16000 }], daysAgo(4));
  const [r] = (await api({})).pending;
  assert.equal((await api({ action: 'settle', key: r.key, supplierId: 'n', pay: 'debt' })).ok, true);
  assert.deepEqual([(await api({})).pending.length, balance('n')], [0, 186000]);
  const call = async (body) => { const response = await removals.POST(new Request(base + '/api/record-removals?branch=main', { method: 'POST', headers: owner, body: JSON.stringify(body) })); return { status: response.status, ...(await response.json()) }; };
  const preview = await call({ action: 'preview', kind: 'transaction', id: receiptTransactionId(r.key) });
  assert.equal(preview.status, 200, JSON.stringify(preview));
  const removed = await call({ action: 'remove', kind: 'transaction', id: receiptTransactionId(r.key), expected: preview.expected, reason: 'xato yetkazib beruvchi', operationId: 'v2rm-tartib0001', label: 'sinov' });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual([(await api({})).pending.map((entry) => entry.key), balance('n'), stock('gosht')], [[r.key], 170000, 13000]);

  // Juda eski kirim, «Yangi kirim» hujjati va narxsiz kirim ro'yxatga chiqmaydi.
  const s = state();
  const old = seoul(new Date(Date.now() - (PENDING_DAYS + 3) * 86_400_000));
  s.stockMovements.unshift(
    { id: 'm-old', type: 'receipt', supplierAccounting: 'separate', inventoryId: 'gosht', quantity: 1000, unitCost: 15, date: old },
    { id: 'm-free', type: 'receipt', supplierAccounting: 'separate', inventoryId: 'gosht', quantity: 1000, unitCost: 0, date: today },
    { id: 'm-intake', type: 'receipt', intakeId: 'intake:x', inventoryId: 'gosht', quantity: 1000, unitCost: 15, date: today },
    { id: 'm-mezana', type: 'receipt', supplierAccounting: 'separate', mezanaEntryId: 'e1', inventoryId: 'gosht', quantity: 1000, unitCost: 15, date: today },
    { id: 'm-plain', type: 'receipt', supplierAccounting: 'separate', inventoryId: 'gosht', quantity: 2000, unitCost: 15, date: today, supplierId: 'n', recordedBy: 'Aziz' },
  );
  const found = pendingReceipts(s, today, new Set(list.map((entry) => entry.key)));
  assert.deepEqual(found.map((entry) => entry.key).sort(), ['m-plain', r.key].sort());
  const plain = found.find((entry) => entry.key === 'm-plain');
  assert.deepEqual([plain.amount, plain.supplierId, plain.supplierName, plain.by, plain.lines], [30000, 'n', 'Nodir aka', 'Aziz', 'Go‘sht 2000 g']);
});

test('«Yangi kirim» — Bozor / naqd: darhol to‘lanadi, qarz yozilmaydi', async () => {
  const market = await api({ action: 'market' });
  assert.deepEqual([market.ok, market.supplierId], [true, MARKET_SUPPLIER_ID]);
  assert.equal(state().suppliers.filter((supplier) => supplier.id === MARKET_SUPPLIER_ID).length, 1, 'ikkinchi marta ochilmaydi');
  const body = { action: 'intake', supplierId: MARKET_SUPPLIER_ID, date: today, lines: [{ inventoryId: 'gosht', unit: 'kg', quantity: 3, amount: 45000 }, { mode: 'expense', name: 'Salfetka', unit: 'quti', quantity: 1, amount: 4000 }] };
  const debt = await api({ ...body, operationId: crypto.randomUUID(), paidAmount: 0 });
  assert.equal(debt.status, 400);
  assert.match(debt.error, /darhol to‘liq to‘lanadi/);
  assert.equal((await api({ ...body, operationId: crypto.randomUUID(), paidAmount: 40000, accountId: 'cash' })).status, 400, 'bir qismi ham bo‘lmaydi');
  const stockBefore = stock('gosht'), expensesBefore = sum(profitExpenses());
  const cashOut = () => sum(state().financialEntries.filter((entry) => entry.category === 'Mahsulot xaridi' && entry.accountId === 'cash'));
  const cashBefore = cashOut();
  const ok = await api({ ...body, operationId: crypto.randomUUID(), paidAmount: 49000, accountId: 'cash' });
  assert.deepEqual([ok.status, ok.ok, ok.result.total, ok.result.paid, ok.result.debt], [200, true, 49000, 49000, 0], JSON.stringify(ok));
  assert.deepEqual([stock('gosht') - stockBefore, balance(MARKET_SUPPLIER_ID), cashOut() - cashBefore], [3000, 0, 49000]);
  assert.equal(sum(profitExpenses()) - expensesBefore, 4000, 'faqat omborsiz mahsulot (salfetka) xarajat bo‘ldi');
  const view = await api({});
  assert.equal(view.pending.some((entry) => entry.amount === 49000 || entry.amount === 45000), false, '«Yangi kirim» hujjati "to‘lovi yozilmagan"ga tushmaydi');
  assert.deepEqual(view.receipts.filter((entry) => entry.amount === 49000).map((entry) => [entry.source, entry.money, entry.paid]), [['Yangi kirim', '', 49000]]);
  // Bozor hisobi hali ochilmagan filialda ham birinchi kirim o'zi ochadi.
  const s = state();
  s.suppliers = s.suppliers.filter((supplier) => supplier.id !== MARKET_SUPPLIER_ID);
  s.transactions = s.transactions.filter((tx) => tx.supplierId !== MARKET_SUPPLIER_ID);
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(s));
  const fresh = await api({ ...body, operationId: crypto.randomUUID(), date: daysAgo(5), paidAmount: 49000, accountId: 'bank' });
  assert.equal(fresh.ok, true, JSON.stringify(fresh));
  assert.equal(balance(MARKET_SUPPLIER_ID), 0);
});
