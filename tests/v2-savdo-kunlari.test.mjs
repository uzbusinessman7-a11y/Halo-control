import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

/* «Savdo kunlari»: davrdagi har kun savdosi bitta oynada; POS kiritilmagan kunlar alohida ko'rinadi. */
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
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;
const savdo = await import('../app/api/v2/savdo/route.ts');
const bosh = await import('../app/api/v2/bosh/route.ts');
const kiritish = await import('../app/api/v2/kiritish/route.ts');
const core = await import('../app/core/sales-days.ts');
const { calculateDailyReport } = await import('../app/lib/daily-report.ts');
const { isAccountingMonthClosed } = await import('../app/lib/month-end.ts');
const monthCloseId = (month) => `monthly-close:${month}`;
const base = 'https://halo.example.workers.dev';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };

const accounts = [{ id: 'cash', name: 'Naqd', type: 'cash' }, { id: 'card', name: 'Karta', type: 'card' }, { id: 'bank', name: 'Bank', type: 'bank' }];
const sales = [
  // 1-oktabr: hammasi bor
  { id: 'x1', date: '2026-10-01', totalRevenue: 500_000, accountId: 'card', accountTypeAtSale: 'card', salesChannel: 'pos', source: 'pos', posImport: { batch: 'b1', fileName: 'pos.xlsx' } },
  { id: 'x2', date: '2026-10-01', totalRevenue: 100_000, accountId: 'cash', accountTypeAtSale: 'cash', salesChannel: 'pos', source: 'manual' },
  { id: 'pos-terminal-sale:1', date: '2026-10-01', totalRevenue: 300_000, accountId: 'cash', accountTypeAtSale: 'cash', salesChannel: 'halo' },
  { id: 'pos-terminal-sale:2', date: '2026-10-01', totalRevenue: 50_000, accountId: 'bank', accountTypeAtSale: 'bank', salesChannel: 'halo' },
  { id: 'd1', date: '2026-10-01', totalRevenue: 70_000, accountId: 'cash', accountTypeAtSale: 'delivery', source: 'delivery', deliveryPlatform: 'coupang', salesChannel: 'delivery' },
  // 2-oktabr: faqat HALO hisob — POS yo'q; bekor qilingan POS hisobga kirmaydi
  { id: 'pos-terminal-sale:3', date: '2026-10-02', totalRevenue: 200_000, accountId: 'cash', accountTypeAtSale: 'cash', salesChannel: 'halo' },
  { id: 'x3', date: '2026-10-02', totalRevenue: 400_000, accountId: 'card', accountTypeAtSale: 'card', salesChannel: 'pos', cancelledAt: '2026-10-02T10:00:00.000Z' },
  { id: 'x4', date: '2026-10-02', totalRevenue: 400_000, accountId: 'card', accountTypeAtSale: 'card', salesChannel: 'pos', voided: true },
  // 3-oktabr: hech narsa. 4-oktabr (bugun): hali hech narsa.
  // Davrdan tashqarida
  { id: 'x5', date: '2026-09-30', totalRevenue: 999_000, accountId: 'card', accountTypeAtSale: 'card', salesChannel: 'pos' },
  // Eski savdo (kanal yozilmagan): karta — POS
  { id: 'old', date: '2026-10-01', totalRevenue: 30_000, accountId: 'card' },
];
const state = { accounts, sales };
/** Kun yozuvlari uchun: buyurtma (2 qator, ombor sarfi bilan) va boshqa kunga tushgan Excel qismi qo'shilgan holat. */
const dayState = () => ({
  accounts,
  recipes: [{ id: 'r1', name: 'Donar' }, { id: 'r2', name: 'Cola' }, { id: 'r3', name: 'Lavash' }],
  inventory: [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 700 }],
  stockMovements: [{ id: 'm1', inventoryId: 'g', type: 'sale', quantity: -300, date: '2026-10-01', referenceId: 'h1' }],
  posOrders: [{ id: 'pos-order:op1', date: '2026-10-01', paymentType: 'cash', salesChannel: 'halo', workerName: 'Aziz', createdAt: '2026-10-01T03:15:00.000Z', items: [{ saleId: 'h1' }, { saleId: 'h2' }] }],
  sales: [
    ...sales.map((x) => (x.id === 'x1' ? { ...x, recipeId: 'r3', quantity: 50 } : x)),
    { id: 'x1b', date: '2026-10-02', totalRevenue: 10_000, accountId: 'card', accountTypeAtSale: 'card', salesChannel: 'pos', posImport: { batch: 'b1', fileName: 'pos.xlsx' } },
    { id: 'h1', date: '2026-10-01', recipeId: 'r1', quantity: 2, totalRevenue: 18_000, accountId: 'cash', accountTypeAtSale: 'cash', salesChannel: 'halo', externalId: 'pos-order:op1:0', stockUsage: [{ inventoryId: 'g', quantity: 300 }] },
    { id: 'h2', date: '2026-10-01', recipeId: 'r2', quantity: 1, totalRevenue: 9_000, accountId: 'cash', accountTypeAtSale: 'cash', salesChannel: 'halo', externalId: 'pos-order:op1:1' },
  ],
});

test('har kun alohida: kanallar, Excel belgisi, bonus; savdosi yo‘q kunlar ham ro‘yxatda', () => {
  const r = core.salesDays(state, '2026-10-01', '2026-10-04', '2026-10-04');
  assert.deepEqual(r.days.map((d) => d.date), ['2026-10-04', '2026-10-03', '2026-10-02', '2026-10-01'], 'eng yangisi tepada, bo‘sh kunlar ham bor');
  const first = r.days[3];
  assert.deepEqual(first.pos, { card: 530_000, cash: 100_000, total: 630_000, excel: true, manual: true });
  assert.deepEqual([first.halo, first.delivery, first.total], [350_000, 70_000, 1_050_000]);
  assert.equal(first.bonus, 25_000, '(1 050 000 − 800 000) × 10%');
  assert.equal(first.total, calculateDailyReport(state, '2026-10-01').revenue, 'jami — kunlik hisobot bilan wonma-won bir xil');
  assert.equal(first.weekday, 4, '2026-10-01 — payshanba');
  const second = r.days[2];
  assert.deepEqual([second.pos.total, second.halo, second.total, second.bonus], [0, 200_000, 200_000, 0], 'bekor qilingan va o‘chirilgan savdo hisobga kirmadi');
  assert.deepEqual([r.days[0].today, r.days[0].total], [true, 0]);
  assert.deepEqual(r.missingPos, ['2026-10-03', '2026-10-02'], 'bugun «POS yo‘q» deb hisoblanmaydi');
  assert.deepEqual(r.empty, ['2026-10-03']);
  assert.equal(r.enteredDays, 2);
  assert.deepEqual(r.totals, { pos: 630_000, posCard: 530_000, posCash: 100_000, halo: 550_000, delivery: 70_000, total: 1_250_000, bonus: 25_000 });
});

test('davr: standart — oy boshidan bugungacha; kelajak kesiladi; noto‘g‘ri sana rad etiladi', () => {
  const r = core.salesDays(state, '', '', '2026-10-04');
  assert.deepEqual([r.from, r.to, r.days.length], ['2026-10-01', '2026-10-04', 4]);
  assert.equal(core.salesDays(state, '2026-10-01', '2026-12-31', '2026-10-04').to, '2026-10-04');
  const fail = (from, to, pattern) => assert.throws(() => core.salesDays(state, from, to, '2026-10-04'), (e) => e instanceof core.SalesDaysError && pattern.test(e.message));
  fail('2026-10-xx', '2026-10-04', /Sanani tekshiring/);
  fail('2026-02-30', '2026-03-01', /Sanani tekshiring/);
  fail('2026-10-04', '2026-10-01', /keyin bo'lmaydi/);
  fail('2026-01-01', '2026-10-04', /93 kun/);
  assert.equal(core.salesDays(state, '2026-07-04', '2026-10-04', '2026-10-04').days.length, 93, '93 kun — chegara');
  assert.deepEqual(core.dateList('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
});

test('sahifa: faqat rahbar; skript buzilmagan; menyuda va Bosh sahifada yo‘l bor; Kiritish sanani qabul qiladi', async () => {
  const get = async (mod, path) => (await mod.GET(new Request(base + path, { headers: owner }))).text();
  const compile = (html, path) => assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]), path);
  const html = await get(savdo, '/api/v2/savdo');
  compile(html, 'savdo');
  assert.match(html, /<h1[^>]*>Savdo kunlari<\/h1>/);
  assert.match(html, /class="sub-a on" href="\/api\/v2\/savdo"/, 'Bosh guruhida «Savdo kunlari»');
  assert.match(html, /class="sub-a" href="\/api\/v2\/bosh"/);
  const home = await get(bosh, '/api/v2/bosh');
  compile(home, 'bosh');
  assert.match(home, /href="\/api\/v2\/savdo"/);
  const entry = await get(kiritish, '/api/v2/kiritish');
  compile(entry, 'kiritish');
  assert.match(entry, /q\.get\('sana'\)/);
  assert.equal((await savdo.GET(new Request(base + '/api/v2/savdo'))).status, 303, 'kirmagan — kirish sahifasiga');
  assert.equal((await savdo.POST(new Request(base + '/api/v2/savdo', { method: 'POST', body: '{}' }))).status, 401);
});

test('kun yozuvlari: bir buyurtma — bitta yozuv; yig‘indisi kun jamisiga teng', () => {
  const st = dayState();
  const day = core.salesDayDetail(st, '2026-10-01');
  assert.equal(day.total, core.salesDays(st, '2026-10-01', '2026-10-01', '2026-10-04').days[0].total, 'hech bir savdo tushib qolmadi');
  const by = Object.fromEntries(day.entries.map((e) => [e.key, e]));
  assert.deepEqual([by['pos-order:op1'].label, by['pos-order:op1'].amount, by['pos-order:op1'].worker, by['pos-order:op1'].summary], ['Naqd', 27_000, 'Aziz', 'Donar × 2, Cola × 1']);
  assert.deepEqual([by['import:b1'].label, by['import:b1'].summary, by['import:b1'].amount], ['POS hisobot (Excel)', '1 xil taom · pos.xlsx', 500_000]);
  assert.equal(by['x2'].label, 'POS naqd');
  assert.equal(by['d1'].label, 'Coupang');
  assert.equal(by['old'].label, 'POS karta');
  assert.equal(by['pos-terminal-sale:2'].label, 'Hisob-raqam');
  assert.equal('saleIds' in by['x2'], false, 'ichki ro‘yxat tashqariga chiqmaydi');
  assert.equal(day.entries[0].key, 'pos-order:op1', 'vaqti bor yozuv tepada');
  assert.throws(() => core.salesDayDetail(st, '2026-13-01'), core.SalesDaysError);
});

test('bekor qilish: buyurtma, POS Excel (faqat shu kun), eski savdo — ombor qaytadi', () => {
  const st = dayState();
  const order = core.cancelSalesEntry(st, '2026-10-01', 'pos-order:op1');
  assert.deepEqual(order.result.entry.label, 'Naqd');
  assert.equal(order.state.sales.some((x) => x.id === 'h1' || x.id === 'h2'), false, 'buyurtma savdolari olib tashlandi');
  assert.equal(order.state.posOrders.length, 0);
  assert.equal(order.state.inventory.find((i) => i.id === 'g').stock, 1_000, 'go‘sht omborga qaytdi (700 + 300)');
  assert.equal(order.state.stockMovements.some((m) => m.referenceId === 'h1'), false);
  assert.equal(core.salesDayDetail(order.state, '2026-10-01').total, 1_050_000, 'qolgan yozuvlar joyida');

  const imp = core.cancelSalesEntry(st, '2026-10-01', 'import:b1');
  assert.equal(imp.state.sales.some((x) => x.id === 'x1'), false);
  assert.equal(imp.state.sales.some((x) => x.id === 'x1b'), true, 'o‘sha fayl boshqa kunni ham qamragan bo‘lsa — u kun tegilmaydi');

  const legacy = core.cancelSalesEntry(st, '2026-10-01', 'old');
  assert.equal(legacy.state.sales.some((x) => x.id === 'old'), false);
  assert.equal(legacy.state.sales.length, st.sales.length - 1);

  assert.throws(() => core.cancelSalesEntry(st, '2026-10-01', 'yoq'), (e) => e instanceof core.SalesDaysError && e.status === 404);
  assert.throws(() => core.cancelSalesEntry({ ...st, monthlyCloses: [{ id: monthCloseId('2026-10'), month: '2026-10', closedAt: '2026-11-01T00:00:00.000Z', inventoryItems: [], payrollItems: [] }] }, '2026-10-01', 'old'), (e) => e instanceof core.SalesDaysError && e.status === 409 && /oyi yopilgan/.test(e.message));
  assert.equal(isAccountingMonthClosed([{ id: monthCloseId('2026-10'), month: '2026-10', closedAt: '2026-11-01T00:00:00.000Z', inventoryItems: [], payrollItems: [] }], '2026-10-01'), true, 'sinovdagi yopilgan oy haqiqiy');
});

test('server: filial ma’lumoti bilan hisoblaydi', async () => {
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.accounts = accounts; p.sales = sales;
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const call = async (body) => { const r = await savdo.POST(new Request(base + '/api/v2/savdo', { method: 'POST', headers: owner, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
  const r = await call({ branchId: 'main', from: '2026-10-01', to: '2026-10-03' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.totals.total, r.missingPos], [1_250_000, ['2026-10-03', '2026-10-02']]);
  assert.equal((await call({ branchId: 'main', from: '2026-10-05', to: '2026-10-01' })).status, 400);
  assert.equal((await call({ branchId: 'yoq', from: '2026-10-01', to: '2026-10-03' })).status, 400);
  const day = await call({ branchId: 'main', action: 'day', date: '2026-10-01' });
  assert.deepEqual([day.status, day.total], [200, 1_050_000]);
});

test('server: bekor qilish — sababi majburiy, tarixda qoladi; kassada yopilgan kun tegilmaydi', async () => {
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  Object.assign(p, dayState());
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const call = async (body) => { const r = await savdo.POST(new Request(base + '/api/v2/savdo', { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: r.status, ...(await r.json()) }; };
  assert.equal((await call({ action: 'cancel', date: '2026-10-01', key: 'pos-order:op1', reason: '' })).status, 400, 'sababsiz — yo‘q');
  assert.equal((await savdo.POST(new Request(base + '/api/v2/savdo', { method: 'POST', body: JSON.stringify({ action: 'cancel', date: '2026-10-01', key: 'old', reason: 'xato' }) }))).status, 401);
  const ok = await call({ action: 'cancel', date: '2026-10-01', key: 'pos-order:op1', reason: 'ikki marta kiritilgan' });
  assert.deepEqual([ok.status, ok.cancelled, ok.total], [200, true, 1_050_000]);
  assert.equal(ok.entries.some((e) => e.key === 'pos-order:op1'), false);
  const after = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  assert.equal(after.inventory.find((i) => i.id === 'g').stock, 1_000, 'ombor qaytdi');
  const log = sqlite.prepare("SELECT action FROM halo_state_backups WHERE action LIKE 'Savdo bekor qilindi%' ORDER BY created_at DESC").get();
  assert.match(log.action, /2026-10-01 · Naqd 27,000 ₩ · Sabab: ikki marta kiritilgan/);
  assert.equal((await call({ action: 'cancel', date: '2026-10-01', key: 'pos-order:op1', reason: 'yana' })).status, 404, 'ikkinchi marta — topilmaydi');
  sqlite.exec("CREATE TABLE IF NOT EXISTS v2_day_closes (tenant_id TEXT, branch_id TEXT, date TEXT)");
  sqlite.prepare("INSERT INTO v2_day_closes (tenant_id, branch_id, date) VALUES ('halo', 'main', '2026-10-02')").run();
  const closed = await call({ action: 'cancel', date: '2026-10-01', key: 'old', reason: 'xato' });
  assert.equal(closed.status, 409);
  assert.match(closed.error, /kassada yopilgan/);
  sqlite.exec("DELETE FROM v2_day_closes");
});
