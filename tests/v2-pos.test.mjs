import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/pos/route.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const hisob = await import('../app/api/hisob/route.ts');
const { posDayReport, channelOf } = await import('../app/core/pos-report.ts');
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
const url = 'https://halo.example.workers.dev/api/v2/pos';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const op = () => crypto.randomUUID().replace(/-/g, '');

test('kanal: yozilgani ustun, eski savdolarda hisob turidan', () => {
  assert.equal(channelOf({ salesChannel: 'pos' }, 'cash'), 'pos');
  assert.equal(channelOf({}, 'card'), 'pos');
  assert.equal(channelOf({}, 'delivery'), 'delivery');
  assert.equal(channelOf({}, 'cash'), 'halo');
  assert.equal(channelOf({}, 'bank'), 'halo');
});

test('hisobot: HALO hisob alohida, soliqsiz', () => {
  const state = {
    accounts: [{ id: 'cash', type: 'cash' }, { id: 'bank', type: 'bank' }],
    costRules: { taxPct: 10 },
    sales: [
      { id: 'a', date: '2026-10-01', totalRevenue: 5000, accountId: 'cash', salesChannel: 'halo', taxPctAtSale: 0 },
      { id: 'b', date: '2026-10-01', totalRevenue: 7000, accountId: 'bank' },
    ],
  };
  const report = posDayReport(state, '2026-10-01');
  assert.deepEqual([report.halo.gross, report.halo.tax, report.pos.total.gross], [12000, 0, 0]);
});


test('HALO HISOB oynasi: naqd/hisob-raqam soliqsiz, delivery alohida narx bilan, oshxona va chiqit alohida', async () => {
  const sqlite = new DatabaseSync(':memory:');
  globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
  globalThis.__HALO_SELF_HOSTED__ = true;
  const url = 'https://halo.example.workers.dev/api/v2/pos';
  const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
  const anon = { 'content-type': 'application/json' };
  const html = await (await GET(new Request(url))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const call = async (headers, body) => { const r = await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })); const j = await r.json(); j._status = r.status; return j; };
  await call(owner, { action: 'load' });
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.costRules = { ...p.costRules, taxPct: 10, cardCommissionPct: 2, deliveryPlatformRules: { baemin: { combinedPct: 10, deliveryFeeWon: 500, instantDiscountWon: 0, brokeragePct: 0, paymentPct: 0, vatPct: 0, couponPct: 0, advertisingPct: 0 } } };
  p.inventory = [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 5000, unitCost: 20 }];
  p.recipes = [{ id: 'd', name: 'Donar', salePrice: 10000, deliveryPrices: { baemin: 12000 }, ingredients: [{ inventoryId: 'g', quantity: 100 }] }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));

  // Loginsiz (do'kon planshet): faqat asosiy filial, faqat kiritish, hisobot yo'q.
  let r = await call(anon, { action: 'load' });
  assert.equal(r.role, 'public');
  assert.deepEqual(r.report.entries, []);
  assert.equal(r.report.halo, undefined);
  const one = [{ recipeId: 'd', quantity: 1 }];
  assert.equal((await call(anon, { action: 'sale', paymentType: 'cash', operationId: op(), items: [{ recipeId: 'd', quantity: 2 }] })).ok, true);
  assert.equal((await call(anon, { action: 'sale', paymentType: 'bank', operationId: op(), items: one })).ok, true);
  assert.equal((await call(anon, { action: 'sale', paymentType: 'card', operationId: op(), items: one }))._status, 400, 'POS karta bu oynaga kiritilmaydi');
  assert.equal((await call(anon, { action: 'load', date: '2020-01-01' }))._status, 403);
  assert.equal((await call(anon, { action: 'cancel', id: 'pos-order:x' }))._status, 403);

  await createWorkerAccount('main', 'Ali', 'ali', '1234');
  const staff = { cookie: (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0], 'content-type': 'application/json' };
  const delOp = op();
  r = await call(staff, { action: 'sale', paymentType: 'delivery', deliveryPlatform: 'baemin', deliveryOrderNumber: 'B1', expectedTotal: 12000, operationId: delOp, items: one });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.role, 'worker');
  assert.equal((await call(staff, { action: 'sale', paymentType: 'delivery', deliveryPlatform: 'baemin', deliveryOrderNumber: 'B1', expectedTotal: 12000, operationId: delOp, items: one })).saved.alreadySaved, true, 'takror bosish ikki marta yozmaydi');
  assert.equal((await call(staff, { action: 'meal', operationId: op(), items: one })).ok, true);
  r = await call(staff, { action: 'waste', mode: 'product', operationId: op(), inventoryId: 'g', quantity: 0.5, unit: 'kg', reason: 'Muddati o‘tgan' });
  assert.equal(r.ok, true, r.error);
  assert.equal((await call(staff, { action: 'waste', mode: 'dish', operationId: op(), items: one })).ok, true);
  assert.equal(r.report.halo, undefined, 'xodim jami summalarni ko‘rmaydi');
  assert.ok(r.report.entries.length >= 4);
  assert.equal((await call(staff, { action: 'cancel', id: 'pos-order:x' }))._status, 403);

  let state = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  // 5000 − savdo (2+1+1)×100 − oshxona 100 − chiqit 500 g − chiqit taom 100
  assert.equal(state.inventory[0].stock, 3900);
  assert.equal(state.sales.filter((s) => s.salesChannel === 'halo').every((s) => s.taxPctAtSale === 0), true);

  r = await call(owner, { action: 'load' });
  const rep = r.report;
  assert.deepEqual([rep.halo.gross, rep.halo.tax], [30000, 0]);
  const baemin = rep.delivery.platforms.find((x) => x.id === 'baemin');
  assert.deepEqual([baemin.gross, baemin.commission, baemin.tax, baemin.orders], [12000, 1700, 1200, 1]);
  assert.deepEqual([rep.meals.count, rep.meals.cost], [1, 2000]);
  assert.deepEqual([rep.waste.count, rep.waste.cost], [2, 10000 + 2000]);
  const cashOrder = rep.entries.find((e) => e.kind === 'sale' && e.payment === 'cash');
  r = await call(owner, { action: 'cancel', id: cashOrder.id });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.report.halo.gross, 10000);
  r = await call(owner, { action: 'cancel', id: r.report.entries.find((e) => e.kind === 'waste').id });
  assert.equal(r.ok, true, r.error);
  state = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  assert.ok(state.inventory[0].stock > 3900, 'bekor qilinganda ombor qaytadi');
});
