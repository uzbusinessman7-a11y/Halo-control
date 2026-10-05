import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* Yetkazib beruvchi profili: mahsulotlar ro'yxati va «Yangi kirim» — bitta saqlashda ombor + qarz + to'lov.
   Asosiy talab: 1 wongacha to'g'ri va hech narsa ikki marta xarajat bo'lmasin. */
const { GET, POST } = await import('../app/api/v2/qarz/route.ts');
const intakeApi = await import('../app/api/intake/route.ts');
const pos = await import('../app/api/pos-terminal/route.ts');
const removals = await import('../app/api/record-removals/route.ts');
const { calculateDailyReport } = await import('../app/lib/daily-report.ts');
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
const api = async (body) => { const response = await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: response.status, ...(await response.json()) }; };
const intake = (body) => api({ action: 'intake', supplierId: 'n', operationId: crypto.randomUUID(), date: today, paidAmount: 0, ...body });
const stock = (id) => state().inventory.find((item) => item.id === id).stock;
const balance = (id = 'n') => state().suppliers.find((supplier) => supplier.id === id).balance;
/** Foydaga ta'sir qiladigan xarajat yozuvlari (bekor qilinmagan). */
const profitExpenses = () => state().financialEntries.filter((entry) => entry.type === 'expense' && entry.affectsProfit !== false && !entry.cancelledAt && !entry.reversedEntryId);
const sum = (list) => list.reduce((total, entry) => total + Number(entry.amount), 0);
const P = {}; // ro'yxatdagi mahsulotlar: nom → id

test('tayyorgarlik: sahifa faqat rahbarga; boshlang‘ich holat', async () => {
  assert.equal((await GET(new Request(url))).status, 303);
  assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 401);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const p = state();
  p.accounts = [{ id: 'cash', name: 'Naqd kassa', type: 'cash', openingBalance: 0 }, { id: 'bank', name: 'Hisob-raqam', type: 'bank', openingBalance: 0 }, { id: 'card', name: 'Karta', type: 'card', openingBalance: 0 }];
  p.suppliers = [{ id: 'n', name: 'Nodir aka', phone: '', openingBalance: 0, balance: 0 }, { id: 'b', name: 'Bozor', phone: '', openingBalance: 0, balance: 0 }, { id: 'mz', name: 'MEZANA', phone: '', openingBalance: 0, balance: 0 }];
  p.inventory = [
    { id: 'gosht', name: 'Go‘sht', unit: 'g', stock: 0, minStock: 0, unitCost: 15 },
    { id: 'lavash', name: 'Lavash', unit: 'dona', stock: 0, minStock: 0, unitCost: 500, packageName: 'quti', unitsPerPackage: 20 },
    { id: 'pomidor', name: 'Pomidor', unit: 'g', stock: 0, minStock: 0, unitCost: 0, expenseOnly: true },
    { id: 'eski', name: 'Eski mahsulot', unit: 'dona', stock: 0, unitCost: 0, catalogArchived: true },
  ];
  p.recipes = [{ id: 'donar', name: 'Donar', salePrice: 9000, ingredients: [{ inventoryId: 'gosht', quantity: 100 }, { inventoryId: 'pomidor', quantity: 30 }] }];
  p.transactions = [];
  // Omborsiz (xarajat) hisobi yoqilgan filial: Pomidor har qanday sanada omborsiz.
  Object.assign(p, { vegetableExpenseVersion: 1, vegetableExpenseStartedAt: '2026-01-01T00:00:00.000Z', vegetableExpenseSettings: { normPct: 6 }, vegetablePurchases: [], vegetableNotifications: [] });
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
});

test('profil: mahsulot bir marta saqlanadi; mos kelmaydigan birlik, takror va omborda bor nom rad etiladi', async () => {
  const empty = await api({ action: 'profile', supplierId: 'n' });
  assert.deepEqual([empty.ok, empty.products.length, empty.accounts.map((a) => a.id).join()], [true, 0, 'cash,bank'], 'karta hisobi to‘lov uchun taklif qilinmaydi');
  assert.deepEqual(empty.inventory.map((item) => item.id).sort(), ['gosht', 'lavash', 'pomidor'], 'olib tashlangan mahsulot ro‘yxatda yo‘q');
  assert.equal(empty.inventory.find((item) => item.id === 'pomidor').vegetable, true);
  assert.equal((await api({ action: 'profile', supplierId: 'yoq' })).status, 404);

  const save = (product) => api({ action: 'saveProduct', supplierId: 'n', product: { id: crypto.randomUUID(), ...product } });
  const a = await save({ inventoryId: 'gosht', unit: 'kg', price: 15000 });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal((await save({ inventoryId: 'lavash', unit: 'quti', price: 10000 })).ok, true);
  assert.equal((await save({ inventoryId: 'pomidor', unit: 'kg', price: 3000 })).ok, true);
  const last = await save({ name: 'Salfetka', unit: 'quti', price: 5000 });
  assert.deepEqual(last.products.map((p) => [p.name, p.unit, p.price, Boolean(p.inventoryId)]), [['Go‘sht', 'kg', 15000, true], ['Lavash', 'quti', 10000, true], ['Pomidor', 'kg', 3000, true], ['Salfetka', 'quti', 5000, false]]);
  for (const product of last.products) P[product.name] = product.id;

  const bad = await save({ inventoryId: 'lavash', unit: 'kg', price: 1 });
  assert.equal(bad.status, 400);
  assert.match(bad.error, /mos emas/, 'dona bilan yuritiladigan mahsulot kg bilan olinmaydi');
  assert.match((await save({ inventoryId: 'gosht', unit: 'kg', price: 1 })).error, /allaqachon bor/);
  assert.match((await save({ name: 'salfetka', unit: 'dona', price: 1 })).error, /allaqachon bor/);
  assert.match((await save({ name: 'go‘sht', unit: 'kg', price: 1 })).error, /omborda bor/, 'ombordagi mahsulot omborsiz xarajat qilib qo‘shilmaydi');
  assert.match((await save({ inventoryId: 'eski', unit: 'dona', price: 1 })).error, /topilmadi/);
  assert.equal((await api({ action: 'saveProduct', supplierId: 'mz', product: { id: crypto.randomUUID(), inventoryId: 'gosht', unit: 'kg', price: 1 } })).status, 400, 'MEZANA — alohida bo‘lim');
  assert.equal((await api({ action: 'profile', supplierId: 'n' })).products.length, 4, 'rad etilganlar saqlanmadi');
  // Narxni tahrirlash — o'sha yozuv yangilanadi.
  const edit = await api({ action: 'saveProduct', supplierId: 'n', product: { id: P['Salfetka'], name: 'Salfetka', unit: 'quti', price: 5500 } });
  assert.equal(edit.products.find((p) => p.name === 'Salfetka').price, 5500);
  await api({ action: 'saveProduct', supplierId: 'n', product: { id: P['Salfetka'], name: 'Salfetka', unit: 'quti', price: 5000 } });
  assert.equal(state().stockMovements?.length || 0, 0, 'ro‘yxatga saqlash kirim yozmaydi');
  assert.equal(balance(), 0);
});

const FIRST = () => [
  { productId: P['Go‘sht'], quantity: 30, amount: 450000 },
  { productId: P['Lavash'], quantity: 2, amount: 20000 },
  { productId: P['Pomidor'], quantity: 5, amount: 15000 },
  { productId: P['Salfetka'], quantity: 1, amount: 5000 },
];
let firstOp = '';
test('qarzga kirim: ombor, tannarx va qarz bitta saqlashda; xarajat faqat omborsiz mahsulotlar uchun, bir marta', async () => {
  firstOp = crypto.randomUUID();
  const out = await intake({ operationId: firstOp, lines: FIRST() });
  assert.equal(out.status, 200, JSON.stringify(out));
  assert.deepEqual([out.result.total, out.result.paid, out.result.debt, out.result.alreadySaved], [490000, 0, 490000, false]);
  assert.deepEqual(out.result.lines.map((line) => line.destination), ['stock', 'stock', 'vegetableExpense', 'expense']);
  // Ombor: go'sht 30 kg = 30 000 g (1 g = 15 ₩), lavash 2 quti = 40 dona; pomidor va salfetka omborda yuritilmaydi.
  assert.deepEqual([stock('gosht'), stock('lavash'), stock('pomidor')], [30000, 40, 0]);
  assert.equal(state().inventory.find((item) => item.id === 'gosht').unitCost, 15);
  assert.equal(state().inventory.find((item) => item.id === 'lavash').unitCost, 500);
  // Qarz: aynan jami summa; bitta xarid yozuvi, to'lov yo'q, sabzavot uchun alohida qarz ochilmagan.
  const s = state();
  assert.equal(balance(), 490000);
  assert.deepEqual(s.transactions.map((tx) => [tx.type, tx.amount, tx.supplierId]), [['purchase', 490000, 'n']]);
  // Xarajat: faqat pomidor (15 000) va salfetka (5 000). Go'sht va lavash xarajat EMAS — sotilganda bo'ladi.
  assert.deepEqual(profitExpenses().map((entry) => [entry.category, entry.amount]).sort(), [['Sabzavot va sous', 15000], ['Xarid / kirim', 5000]]);
  assert.equal(s.financialEntries.filter((entry) => entry.accountId).length, 0, 'pul hech qaysi hisobdan chiqmagan');
  const report = calculateDailyReport(s, today);
  assert.equal(report.manualExpenses, 20000, JSON.stringify(report));
  assert.equal(report.cost, 0, 'sotuv yo‘q — tannarx yo‘q');
  // Qarz daftari (V2) eski qoldiq bilan bir xil.
  const list = await api({});
  const party = list.bridge.parties.find((entry) => entry.oldId === 'n');
  assert.deepEqual([party.ledgerBalance, party.difference, list.bridge.totalDebt], [490000, 0, 490000]);
});

test('takror: tugma ikki marta bosilsa ikkinchisi yozilmaydi; shu kuni aynan shu yuk — sabab so‘raladi', async () => {
  const again = await intake({ operationId: firstOp, lines: FIRST() });
  assert.deepEqual([again.status, again.result.alreadySaved], [200, true]);
  assert.deepEqual([stock('gosht'), balance(), sum(profitExpenses())], [30000, 490000, 20000], 'hech narsa ikki marta yozilmadi');
  const twin = await intake({ lines: FIRST() });
  assert.deepEqual([twin.status, twin.code], [409, 'SIMILAR_PURCHASE']);
  assert.deepEqual([stock('gosht'), balance()], [30000, 490000]);
  // Boshqa ma'lumot bilan o'sha amal raqami — rad etiladi (eski kirim buzilmaydi).
  const other = await intake({ operationId: firstOp, lines: [{ productId: P['Go‘sht'], quantity: 1, amount: 15000 }] });
  assert.equal(other.status, 400);
  assert.equal(balance(), 490000);
});

test('sotilganda: tannarx retsept bo‘yicha bir marta; omborsiz mahsulot qayta xarajat bo‘lmaydi', async () => {
  const sale = await pos.POST(new Request(base + '/api/pos-terminal', { method: 'POST', headers: owner, body: JSON.stringify({ operationId: crypto.randomUUID().replace(/-/g, ''), date: today, mode: 'sale', paymentType: 'cash', branchId: 'main', items: [{ recipeId: 'donar', quantity: 2 }] }) }));
  assert.equal(sale.status, 200, JSON.stringify(await sale.clone().json()));
  assert.equal(stock('gosht'), 30000 - 200);
  const report = calculateDailyReport(state(), today);
  assert.equal(report.revenue, 18000);
  assert.equal(report.cost, 3000, '2 × 100 g × 15 ₩ — faqat go‘sht; pomidor olingan kuni xarajat bo‘lgan');
  assert.equal(report.manualExpenses, 20000, 'xarid xarajati o‘zgarmadi');
  assert.equal(report.netProfit, 18000 - 3000 - 20000);
});

test('narx himoyasi: oxirgi narxdan 30% dan ko‘p farq — tasdiq; tasdiqlangach ro‘yxatdagi narx yangilanadi', async () => {
  const lines = [{ productId: P['Go‘sht'], quantity: 10, amount: 250000 }];
  const jump = await intake({ date: daysAgo(1), lines });
  assert.deepEqual([jump.status, jump.code], [409, 'PRICE_JUMP']);
  assert.deepEqual(jump.details, [{ index: 0, name: 'Go‘sht', unit: 'kg', before: 15000, now: 25000 }]);
  assert.equal(balance(), 490000, 'tasdiqsiz yozilmadi');
  // 30% ichida — so'ralmaydi (15 000 → 19 000).
  const near = await intake({ date: daysAgo(1), lines: [{ productId: P['Go‘sht'], quantity: 10, amount: 190000 }] });
  assert.equal(near.status, 200, JSON.stringify(near));
  assert.equal(near.products.find((p) => p.name === 'Go‘sht').price, 19000, 'ro‘yxatda oxirgi narx');
  const ok = await intake({ date: daysAgo(2), lines, priceConfirmed: true });
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(ok.products.find((p) => p.name === 'Go‘sht').price, 25000);
  assert.equal(balance(), 490000 + 190000 + 250000);
  assert.equal(stock('gosht'), 30000 - 200 + 20000);
});

test('to‘langan va qisman to‘langan kirim: pul bir marta chiqadi, foydaga ta’sir qilmaydi', async () => {
  const before = { balance: balance(), expenses: sum(profitExpenses()) };
  const paid = await intake({ date: daysAgo(3), lines: [{ productId: P['Lavash'], quantity: 1, amount: 10000 }], paidAmount: 10000, accountId: 'cash' });
  assert.equal(paid.status, 200, JSON.stringify(paid));
  assert.deepEqual([paid.result.total, paid.result.paid, paid.result.debt], [10000, 10000, 0]);
  assert.equal(balance(), before.balance, 'to‘liq to‘landi — qarz o‘zgarmadi');
  const money = state().financialEntries.filter((entry) => entry.accountId === 'cash');
  assert.deepEqual(money.map((entry) => [entry.type, entry.category, entry.amount, entry.affectsProfit]), [['expense', 'Mahsulot xaridi', 10000, false]]);
  assert.equal(sum(profitExpenses()), before.expenses, 'to‘lov xarajat emas');
  const part = await intake({ date: daysAgo(4), lines: [{ productId: P['Lavash'], quantity: 1, amount: 10000 }], paidAmount: 4000, accountId: 'bank' });
  assert.deepEqual([part.status, part.result.debt], [200, 6000]);
  assert.equal(balance(), before.balance + 6000);
  assert.equal(stock('lavash'), 40 + 20 + 20);
  // Noto'g'ri to'lovlar yozilmaydi.
  const base2 = { date: daysAgo(5), lines: [{ productId: P['Lavash'], quantity: 1, amount: 10000 }] };
  assert.equal((await intake({ ...base2, paidAmount: 10001, accountId: 'cash' })).status, 400, 'jamidan ko‘p');
  assert.equal((await intake({ ...base2, paidAmount: 5000, accountId: 'card' })).status, 400, 'karta hisobidan to‘lanmaydi');
  assert.equal((await intake({ ...base2, paidAmount: 5000 })).status, 400, 'hisob tanlanmagan');
  assert.equal((await intake({ ...base2, paidAmount: '' })).status, 400, 'qarzga yoki to‘landi — tanlanishi shart');
  assert.equal((await intake({ ...base2, date: seoul(new Date(Date.now() + 2 * 86_400_000)) })).status, 400, 'kelajak sana');
  assert.equal(balance(), before.balance + 6000);
  const list = await api({});
  assert.equal(list.bridge.parties.find((entry) => entry.oldId === 'n').difference, 0);
});

test('qo‘lda yozish: ombordan tanlash, yangi ombor mahsuloti yaratish, omborsiz xarajat; «ro‘yxatga saqlansin»', async () => {
  const before = { balance: balance('b'), expenses: sum(profitExpenses()) };
  const newOp = crypto.randomUUID();
  const body = {
    supplierId: 'b', date: daysAgo(1), lines: [
      { inventoryId: 'gosht', unit: 'kg', quantity: 2, amount: 30000, remember: true },
      { mode: 'new', name: 'Kolbasa', newUnit: 'kg', newItemOp: newOp, quantity: 5, amount: 60000, remember: true },
      { mode: 'expense', name: 'Paket', unit: 'bog‘lam', quantity: 3, amount: 9000, remember: false },
    ],
  };
  const out = await intake(body);
  assert.equal(out.status, 200, JSON.stringify(out));
  assert.deepEqual(out.result.lines.map((line) => line.destination), ['stock', 'stock', 'expense']);
  assert.deepEqual(out.result.createdInventory, ['Kolbasa']);
  const kolbasa = state().inventory.find((item) => item.name === 'Kolbasa');
  assert.deepEqual([kolbasa.unit, kolbasa.stock, kolbasa.unitCost], ['g', 5000, 12], 'kg bilan olinadi, omborda gramm bilan yuritiladi');
  assert.equal(balance('b'), before.balance + 99000);
  assert.equal(sum(profitExpenses()), before.expenses + 9000, 'faqat omborsiz Paket xarajat bo‘ldi');
  assert.deepEqual(out.products.map((p) => [p.name, p.unit, p.price]), [['Go‘sht', 'kg', 15000], ['Kolbasa', 'kg', 12000]], 'belgilanganlar ro‘yxatga tushdi, Paket — yo‘q');
  // Keyingi safar ro'yxatdan — bir bosishda.
  const next = await intake({ supplierId: 'b', date: daysAgo(2), lines: [{ productId: out.products.find((p) => p.name === 'Kolbasa').id, quantity: 2, amount: 24000 }] });
  assert.equal(next.status, 200, JSON.stringify(next));
  assert.equal(state().inventory.find((item) => item.name === 'Kolbasa').stock, 7000);
  // Xatolar: omborda bor narsa omborsiz xarajat bo'lmaydi; tanlov ko'rsatilmagan qator; ikki marta bir mahsulot.
  const day = { supplierId: 'b', date: daysAgo(6) };
  assert.match((await intake({ ...day, lines: [{ mode: 'expense', name: 'kolbasa', unit: 'kg', quantity: 1, amount: 12000 }] })).error, /omborda bor/);
  assert.match((await intake({ ...day, lines: [{ name: 'Nimadir', unit: 'dona', quantity: 1, amount: 1000 }] })).error, /tanlang/);
  assert.match((await intake({ ...day, lines: [{ mode: 'new', name: 'Kolbasa', newUnit: 'kg', newItemOp: crypto.randomUUID(), quantity: 1, amount: 12000 }] })).error, /allaqachon bor/);
  assert.equal((await intake({ ...day, lines: [{ inventoryId: 'gosht', unit: 'kg', quantity: 1, amount: 15000 }, { inventoryId: 'gosht', unit: 'kg', quantity: 2, amount: 30000 }] })).status, 400);
  assert.equal((await intake({ ...day, lines: [{ inventoryId: 'lavash', unit: 'dona', quantity: 1.5, amount: 750 }] })).status, 400, 'dona kasr bo‘lmaydi');
  assert.equal((await intake({ ...day, lines: [{ productId: 'yoq-mahsulot', quantity: 1, amount: 1000 }] })).status, 409);
  assert.equal((await intake({ ...day, supplierId: 'mz', lines: [{ inventoryId: 'gosht', unit: 'kg', quantity: 1, amount: 25000 }] })).status, 400, 'MEZANA — alohida bo‘lim');
  assert.equal(state().inventory.filter((item) => item.name === 'Nimadir').length, 0);
  assert.equal(balance('b'), before.balance + 99000 + 24000, 'rad etilganlardan hech narsa yozilmadi');
});

test('Ombor kirimi bilan ikki marta kiritishdan himoya — ikkala tomonga', async () => {
  const date = daysAgo(8);
  // Avval «Ombor kirimi», keyin shu yukni yetkazib beruvchi orqali — to'xtatiladi.
  const sep = await intakeApi.POST(new Request(base + '/api/intake?branch=main', { method: 'POST', headers: owner, body: JSON.stringify({ inventoryOnly: true, vegetableOnly: false, operationId: crypto.randomUUID(), date, lines: [{ inventoryId: 'gosht', quantity: 7, unit: 'kg', amount: 175000 }] }) }));
  assert.equal(sep.status, 200, JSON.stringify(await sep.clone().json()));
  const debt = balance();
  const dup = await intake({ date: daysAgo(7), lines: [{ productId: P['Go‘sht'], quantity: 7, amount: 175000 }] });
  assert.deepEqual([dup.status, dup.code], [409, 'SIMILAR_PURCHASE']);
  assert.match(dup.error, /ikki marta hisoblanadi/);
  assert.equal(balance(), debt);
  const stockBefore = stock('gosht');
  const sure = await intake({ date: daysAgo(7), lines: [{ productId: P['Go‘sht'], quantity: 7, amount: 175000 }], duplicateReason: 'boshqa yuk, ertasiga keldi' });
  assert.equal(sure.status, 200, JSON.stringify(sure));
  assert.deepEqual([stock('gosht'), balance()], [stockBefore + 7000, debt + 175000]);
  // Teskarisi: yetkazib beruvchi orqali kiritilgan yuk keyin «Ombor kirimi»ga ham yozilsa — eski himoya ushlaydi.
  const sup = await intake({ date: daysAgo(12), lines: [{ productId: P['Lavash'], quantity: 3, amount: 30000 }] });
  assert.equal(sup.status, 200, JSON.stringify(sup));
  const back = await intakeApi.POST(new Request(base + '/api/intake?branch=main', { method: 'POST', headers: owner, body: JSON.stringify({ inventoryOnly: true, vegetableOnly: false, operationId: crypto.randomUUID(), date: daysAgo(12), lines: [{ inventoryId: 'lavash', quantity: 3, unit: 'quti', amount: 30000 }] }) }));
  const backBody = await back.json();
  assert.deepEqual([back.status, backBody.code], [400, 'SIMILAR_PURCHASE']);
  // Har kuni bir xil yuk keladigan yetkazib beruvchi har safar so'roqqa tutilmaydi.
  const daily = await intake({ date: daysAgo(11), lines: [{ productId: P['Lavash'], quantity: 3, amount: 30000 }] });
  assert.equal(daily.status, 200, JSON.stringify(daily));
});

test('olib tashlash: butun kirim — ombor, qarz, xarajat va pul birga qaytadi', async () => {
  const before = { gosht: stock('gosht'), balance: balance(), expenses: sum(profitExpenses()), cash: state().financialEntries.filter((entry) => entry.accountId === 'cash').length };
  const op = crypto.randomUUID();
  const out = await intake({ operationId: op, date: daysAgo(14), paidAmount: 100000, accountId: 'cash', priceConfirmed: true, lines: [
    { productId: P['Go‘sht'], quantity: 4, amount: 100000 }, { productId: P['Pomidor'], quantity: 2, amount: 6000 }, { productId: P['Salfetka'], quantity: 2, amount: 10000 },
  ] });
  assert.equal(out.status, 200, JSON.stringify(out));
  assert.deepEqual([stock('gosht'), balance(), sum(profitExpenses())], [before.gosht + 4000, before.balance + 16000, before.expenses + 16000]);
  const call = async (body) => { const response = await removals.POST(new Request(base + '/api/record-removals?branch=main', { method: 'POST', headers: owner, body: JSON.stringify(body) })); return { status: response.status, ...(await response.json()) }; };
  const preview = await call({ action: 'preview', kind: 'transaction', id: `intake:${op}` });
  assert.equal(preview.status, 200, JSON.stringify(preview));
  const removed = await call({ action: 'remove', kind: 'transaction', id: `intake:${op}`, expected: preview.expected, reason: 'xato kiritildi', operationId: 'v2rm-kirim0001', label: 'sinov' });
  assert.equal(removed.status, 200, JSON.stringify(removed));
  assert.deepEqual([stock('gosht'), balance(), sum(profitExpenses())], [before.gosht, before.balance, before.expenses], 'hammasi avvalgi holatga qaytdi');
  assert.equal(state().financialEntries.filter((entry) => entry.accountId === 'cash' && !entry.cancelledAt).length, before.cash, 'pul chiqimi ham bekor bo‘ldi');
  const list = await api({});
  assert.equal(list.bridge.parties.find((entry) => entry.oldId === 'n').difference, 0, 'qarz daftari eski qoldiq bilan mos');
});

test('ro‘yxatdan olib tashlash kirimlarga ta’sir qilmaydi', async () => {
  const debt = balance();
  const out = await api({ action: 'removeProduct', supplierId: 'n', id: P['Salfetka'] });
  assert.deepEqual(out.products.map((p) => p.name), ['Go‘sht', 'Lavash', 'Pomidor']);
  assert.equal(balance(), debt);
  assert.equal((await intake({ date: daysAgo(15), lines: [{ productId: P['Salfetka'], quantity: 1, amount: 5000 }] })).status, 409, 'olib tashlangan mahsulot bilan kirim — oynani yangilash so‘raladi');
});

test('kassada yopilgan kun: pul chiqadigan kirim yozilmaydi (kassa qoldig‘i o‘zgarmasin); qarzga kirim yoziladi', async () => {
  const kassa = await import('../app/core/kassa-service.ts');
  const store = await import('../app/lib/halo-store.ts');
  const scope = { tenantId: 'halo', branchId: 'main' };
  const db = globalThis.__HALO_CONTROL_DB__;
  const current = async () => (await store.readHaloState('main')).state;
  const cashAccounts = (await kassa.staffView(db, scope, await current(), today)).cashAccounts;
  await kassa.staffCount(db, scope, await current(), today, { operationId: 'count-kirim-sinov', actor: 'Ali', counts: Object.fromEntries(cashAccounts.map((account) => [account.id, 1000])) });
  await kassa.ownerClose(db, scope, await current(), today, { date: today, note: 'sinov', reviewer: 'Rahbar', operationId: 'close-kirim-sinov' });
  const debt = balance();
  const lines = [{ productId: P['Lavash'], quantity: 4, amount: 40000 }];
  const paid = await intake({ lines, paidAmount: 40000, accountId: 'cash' });
  assert.equal(paid.status, 409, JSON.stringify(paid));
  assert.match(paid.error, /kassada yopilgan/);
  assert.equal(balance(), debt);
  const credit = await intake({ lines });
  assert.equal(credit.status, 200, JSON.stringify(credit));
  assert.equal(balance(), debt + 40000);
});
