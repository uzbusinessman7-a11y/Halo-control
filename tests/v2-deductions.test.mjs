import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { applyDeductionRules, readDeductionRules, saleDeductions, exampleDeductions, DeductionError } = await import('../app/core/deductions.ts');
const { buildBridgePlan } = await import('../app/core/bridge.ts');
const { runBridge } = await import('../app/core/bridge-sync.ts');
const { homeReport } = await import('../app/core/home.ts');
const route = await import('../app/api/v2/ushlanmalar/route.ts');
const pos = await import('../app/api/pos-terminal/route.ts');
const kiritish = await import('../app/api/v2/kiritish/route.ts');
const posRoute = await import('../app/api/v2/pos/route.ts');

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
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

test('foizlar: bir marta saqlanadi, tekshiriladi, boshqa delivery sozlamalari saqlanadi', () => {
  const state = { costRules: { taxPct: 0, cardCommissionPct: 0, deliveryPlatformRules: { coupang: { combinedPct: 5, deliveryFeeWon: 0, instantDiscountWon: 700, brokeragePct: 0, paymentPct: 0, vatPct: 0, couponPct: 0, advertisingPct: 0 } } } };
  const next = applyDeductionRules(state, { taxPct: '10', cardPct: '1,5', platforms: [{ id: 'coupang', pct: 15.4, feeWon: '3,400' }, { id: 'baemin', pct: 6.8, feeWon: 0 }] });
  const view = readDeductionRules(next);
  assert.equal(view.taxPct, 10);
  assert.equal(view.cardPct, 1.5);
  assert.deepEqual(view.platforms.find((p) => p.id === 'coupang'), { id: 'coupang', label: 'Coupang Eats', pct: 15.4, feeWon: 3400 });
  assert.equal(next.costRules.deliveryPlatformRules.coupang.instantDiscountWon, 700, 'darhol chegirma yo‘qolmaydi');
  assert.throws(() => applyDeductionRules(state, { taxPct: 120, cardPct: 0 }), DeductionError);
  assert.throws(() => applyDeductionRules(state, { taxPct: 10, cardPct: -1 }), DeductionError);
  assert.throws(() => applyDeductionRules(state, { taxPct: 10, cardPct: 1, platforms: [{ id: 'x', pct: 1, feeWon: 0 }] }), DeductionError);
  const ex = exampleDeductions(view);
  assert.deepEqual(ex.card, { commission: 150, tax: 1000, net: 8850 });
  assert.equal(ex.delivery.find((d) => d.id === 'coupang').fee, 1540 + 3400);
  assert.deepEqual(ex.posCash, { tax: 1000, net: 9000 });
});

test('har savdodan: soliq POS va delivery’dan, HALO hisobdan emas; komissiya karta/delivery; savdodagi foiz ustun', () => {
  const state = { costRules: { taxPct: 10, cardCommissionPct: 2 } };
  const types = new Map([['card', 'card'], ['cash', 'cash'], ['bank', 'bank'], ['dl', 'delivery']]);
  assert.deepEqual(saleDeductions({ totalRevenue: 12345, accountId: 'card', source: 'pos', taxTreatment: 'automatic', cardCommissionPctAtSale: 1.5, taxPctAtSale: 10, accountTypeAtSale: 'card' }, state, types),
    { card: 185, delivery: 0, tax: 1235, accountType: 'card' });
  assert.deepEqual(saleDeductions({ totalRevenue: 9000, accountId: 'cash', source: 'pos', taxTreatment: 'automatic' }, state, types), { card: 0, delivery: 0, tax: 0, accountType: 'cash' });
  assert.deepEqual(saleDeductions({ totalRevenue: 9000, accountId: 'bank', source: 'pos' }, state, types), { card: 0, delivery: 0, tax: 0, accountType: 'bank' });
  assert.deepEqual(saleDeductions({ totalRevenue: 20000, accountId: 'dl', source: 'delivery', deliveryPlatform: 'coupang', deliveryCommissionAmount: 4480 }, state, types), { card: 0, delivery: 4480, tax: 2000, accountType: 'delivery' });
  // POS apparati orqali naqd: savdoda yozilgan foiz bo'yicha soliq.
  assert.equal(saleDeductions({ totalRevenue: 9000, accountId: 'cash', salesChannel: 'pos', taxPctAtSale: 10 }, state, types).tax, 900);
  assert.equal(saleDeductions({ totalRevenue: 9000, accountId: 'cash', salesChannel: 'halo', taxPctAtSale: 0 }, state, types).tax, 0);
  // Saqlangan 0 — ataylab: joriy foiz qo'llanmaydi.
  assert.equal(saleDeductions({ totalRevenue: 10000, accountId: 'card', taxTreatment: 'automatic', cardCommissionPctAtSale: 0, taxPctAtSale: 0, accountTypeAtSale: 'card' }, state, types).tax, 0);
});

test('ko‘prik: ushlanma alohida yozuv, kutilayotgan pul sof, soliq zaxiraga; soliq to‘lovi zaxirani yopadi', () => {
  const state = {
    accounts: [{ id: 'card', name: 'Karta', type: 'card', openingBalance: 0 }, { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 0 }],
    costRules: { taxPct: 10, cardCommissionPct: 1.5 },
    sales: [{ id: 's1', date: '2026-10-01', totalRevenue: 10000, quantity: 1, accountId: 'card', source: 'pos', taxTreatment: 'automatic', accountTypeAtSale: 'card', cardCommissionPctAtSale: 1.5, taxPctAtSale: 10 }],
    financialEntries: [{ id: 'f1', type: 'expense', category: 'Soliq', amount: 1000, date: '2026-10-05', accountId: 'bank', affectsProfit: false }],
  };
  const plan = buildBridgePlan(state, '2026-10-05');
  const fee = plan.entries.find((e) => e.source === 'komissiya:s1');
  const tax = plan.entries.find((e) => e.source === 'soliq:s1');
  assert.deepEqual(fee.lines.map((l) => l.amount), [150, -150]);
  assert.deepEqual(tax.lines, [{ code: 'soliq', amount: 1000 }, { code: 'soliq-zaxira', amount: -1000 }]);
  assert.equal(plan.entries.find((e) => e.source === 'pul:f1').lines[0].code, 'soliq-zaxira');
  assert.equal(plan.feeByOldAccount.get('card'), 150);
});

test('to‘liq oqim: sahifada saqlash → karta/naqd/delivery savdo → jurnal va bosh ekran', async () => {
  const sqlite = new DatabaseSync(':memory:');
  globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
  globalThis.__HALO_SELF_HOSTED__ = true;
  const url = base + '/api/v2/ushlanmalar';
  assert.equal((await route.GET(new Request(url))).status, 303);
  const html = await (await route.GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.inventory = [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 0, unitCost: 20 }];
  p.recipes = [{ id: 'd', name: 'Donar', salePrice: 10000, deliveryPrices: { coupang: 12000 }, ingredients: [{ inventoryId: 'g', quantity: 100 }] }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const call = async (body) => (await route.POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) }))).json();
  const bad = await route.POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ action: 'save', branchId: 'main', rules: { taxPct: 200, cardPct: 1 } }) }));
  assert.equal(bad.status, 400);
  const saved = await call({ action: 'save', allBranches: true, rules: { taxPct: 10, cardPct: 1.5, platforms: [{ id: 'coupang', pct: 10, feeWon: 1000 }] } });
  assert.equal(saved.ok, true);
  assert.equal(saved.rules.taxPct, 10);

  const posUrl = base + '/api/v2/pos';
  const posCall = async (body) => (await posRoute.POST(new Request(posUrl, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', operationId: crypto.randomUUID().replace(/-/g, ''), ...body }) }))).json();
  const card = await posCall({ action: 'sale', paymentType: 'card', items: [{ recipeId: 'd', quantity: 1 }] });
  assert.equal(card.ok, true, 'karta savdosi ombor 0 bo‘lsa ham saqlanadi: ' + JSON.stringify(card.error));
  assert.equal((await posCall({ action: 'sale', paymentType: 'cash', items: [{ recipeId: 'd', quantity: 1 }] })).ok, true);
  assert.equal((await posCall({ action: 'sale', paymentType: 'delivery', deliveryPlatform: 'coupang', expectedTotal: 12000, items: [{ recipeId: 'd', quantity: 1 }] })).ok, true);
  // HALO hisob (Kiritish): naqd — soliqsiz.
  const halo = await pos.POST(new Request(base + '/api/pos-terminal', { method: 'POST', headers: owner, body: JSON.stringify({ operationId: crypto.randomUUID().replace(/-/g, ''), date: today, mode: 'sale', paymentType: 'cash', branchId: 'main', items: [{ recipeId: 'd', quantity: 1 }] }) }));
  assert.equal(halo.status, 200);

  const state = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  const cardSale = state.sales.find((s) => s.accountTypeAtSale === 'card');
  assert.equal(cardSale.taxPctAtSale, 10);
  assert.equal(cardSale.cardCommissionPctAtSale, 1.5);
  assert.equal(state.sales.find((s) => s.salesChannel === 'pos' && s.accountTypeAtSale === 'cash').taxPctAtSale, 10, 'POS naqd — soliq');
  assert.equal(state.sales.find((s) => s.salesChannel === 'halo').taxPctAtSale, 0, 'HALO hisob — soliqsiz');
  assert.equal(state.sales.find((s) => s.salesChannel === 'delivery').taxPctAtSale, 10, 'delivery — soliq');

  const report = await homeReport(globalThis.__HALO_CONTROL_DB__, { tenantId: 'halo', branchId: 'main' }, state, today);
  assert.equal(report.deductions.tax, 1000 + 1000 + 1200, 'karta + POS naqd + delivery; HALO hisob — yo‘q');
  assert.equal(report.deductions.commission, 150 + 1200 + 1000, 'karta 1.5% + delivery 10% + 1000₩');
  assert.equal(report.deductions.taxReserve, 3200);
  const bridge = await runBridge(globalThis.__HALO_CONTROL_DB__, { tenantId: 'halo', branchId: 'main' }, state, today);
  assert.equal(bridge.ok, true, 'eski tizim qoldig‘i bilan solishtirish komissiyani hisobga oladi');
  assert.equal(bridge.posted, 0, 'qayta ishga tushirish takror yozmaydi');

  // Foiz o'zgarsa, eski savdo o'zgarmaydi.
  await call({ action: 'save', rules: { taxPct: 5, cardPct: 3 } });
  const again = await runBridge(globalThis.__HALO_CONTROL_DB__, { tenantId: 'halo', branchId: 'main' }, JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload), today);
  assert.equal(again.posted, 0);
  assert.equal(again.corrected, 0);

  // Soliq to'lovi: "Soliq" xarajati endi rad etilmaydi, zaxiradan yopiladi.
  const bank = state.accounts.find((a) => a.type === 'bank');
  const pay = await (await kiritish.POST(new Request(base + '/api/v2/kiritish', { method: 'POST', headers: owner, body: JSON.stringify({ action: 'expense', branchId: 'main', operationId: crypto.randomUUID(), category: 'Soliq', name: 'QQS', amount: 1000, date: today, accountId: bank.id }) }))).json();
  assert.equal(pay.ok, true, JSON.stringify(pay));
  assert.equal(pay.entry.affectsProfit, false);
});
