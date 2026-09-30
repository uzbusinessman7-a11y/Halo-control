import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/pos/route.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
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

test('kassa oynasi: xodim POS/delivery/oshxona/chiqit kiritadi; rahbar hisobotni ko‘radi va bekor qiladi', async () => {
  const sqlite = new DatabaseSync(':memory:');
  globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
  globalThis.__HALO_SELF_HOSTED__ = true;
  const html = await (await GET(new Request(url))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const anon = await POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).login, true);

  const call = async (headers, body) => { const r = await POST(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })); const j = await r.json(); j._status = r.status; return j; };
  let r = await call(owner, { action: 'load' });
  assert.equal(r.role, 'owner');
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.costRules = { ...p.costRules, taxPct: 10, cardCommissionPct: 2, deliveryPlatformRules: { baemin: { combinedPct: 10, deliveryFeeWon: 500, instantDiscountWon: 0, brokeragePct: 0, paymentPct: 0, vatPct: 0, couponPct: 0, advertisingPct: 0 } } };
  p.inventory = [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 5000, unitCost: 20 }, { id: 'n', name: 'Non', unit: 'dona', stock: 10, unitCost: 500 }];
  p.recipes = [{ id: 'd', name: 'Donar', salePrice: 10000, deliveryPrices: { baemin: 12000 }, ingredients: [{ inventoryId: 'g', quantity: 100 }, { inventoryId: 'n', quantity: 1 }] }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));

  await createWorkerAccount('main', 'Ali', 'ali', '1234');
  const staff = { cookie: (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0], 'content-type': 'application/json' };
  r = await call(staff, { action: 'load' });
  assert.equal(r.role, 'worker');
  assert.equal(r.catalog[0].deliveryPrices.baemin, 12000);
  assert.equal(r.report.pos, undefined, 'xodim jami summalarni ko‘rmaydi');
  assert.equal((await call(staff, { action: 'load', date: '2020-01-01' }))._status, 403, 'xodim faqat bugunga');

  const item = [{ recipeId: 'd', quantity: 2 }];
  r = await call(staff, { action: 'sale', paymentType: 'card', operationId: op(), items: item });
  assert.equal(r.ok, true, r.error);
  const cashOp = op();
  assert.equal((await call(staff, { action: 'sale', paymentType: 'cash', operationId: cashOp, items: [{ recipeId: 'd', quantity: 1 }] })).ok, true);
  const again = await call(staff, { action: 'sale', paymentType: 'cash', operationId: cashOp, items: [{ recipeId: 'd', quantity: 1 }] });
  assert.equal(again.saved.alreadySaved, true, 'takror bosilsa ikki marta yozilmaydi');
  r = await call(staff, { action: 'sale', paymentType: 'delivery', deliveryPlatform: 'baemin', deliveryOrderNumber: 'B1', expectedTotal: 12000, operationId: op(), items: [{ recipeId: 'd', quantity: 1 }] });
  assert.equal(r.ok, true, r.error);
  assert.equal((await call(staff, { action: 'sale', paymentType: 'bank', operationId: op(), items: item }))._status, 400, 'hisob-raqam — faqat HALO hisobda');
  assert.equal((await call(staff, { action: 'meal', operationId: op(), items: [{ recipeId: 'd', quantity: 1 }] })).ok, true);
  r = await call(staff, { action: 'waste', mode: 'product', operationId: op(), inventoryId: 'g', quantity: 0.5, unit: 'kg', reason: 'Muddati o‘tgan' });
  assert.equal(r.ok, true, r.error);
  assert.equal((await call(staff, { action: 'waste', mode: 'dish', operationId: op(), items: [{ recipeId: 'd', quantity: 1 }] })).ok, true);
  assert.equal((await call(staff, { action: 'cancel', id: 'pos-order:x' }))._status, 403, 'bekor qilish — faqat rahbar');

  let state = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  // Go'sht: 5000 − savdo (2+1+1)×100 − oshxona 100 − chiqit 500 g − chiqit taom 100 = 3900
  assert.equal(state.inventory.find((i) => i.id === 'g').stock, 3900);

  r = await call(owner, { action: 'load' });
  const rep = r.report;
  assert.equal(rep.pos.card.gross, 20000);
  assert.equal(rep.pos.card.commission, 400);
  assert.equal(rep.pos.card.tax, 2000);
  assert.equal(rep.pos.cash.gross, 10000);
  assert.equal(rep.pos.cash.tax, 1000, 'POS naqd — soliq bor');
  assert.equal(rep.pos.cash.commission, 0);
  const baemin = rep.delivery.platforms.find((x) => x.id === 'baemin');
  assert.deepEqual([baemin.gross, baemin.commission, baemin.tax, baemin.orders], [12000, 1700, 1200, 1]);
  assert.equal(rep.meals.count, 1);
  assert.equal(rep.meals.cost, 100 * 20 + 500);
  assert.equal(rep.waste.count, 2);
  assert.equal(rep.waste.cost, 500 * 20 + (100 * 20 + 500));
  assert.equal(rep.halo.gross, 0);

  const cardOrder = rep.entries.find((e) => e.kind === 'sale' && e.payment === 'card');
  r = await call(owner, { action: 'cancel', id: cardOrder.id });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.report.pos.card.gross, 0);
  const wasteEntry = r.report.entries.find((e) => e.kind === 'waste');
  r = await call(owner, { action: 'cancel', id: wasteEntry.id });
  assert.equal(r.ok, true, r.error);
  state = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  assert.ok(state.inventory.find((i) => i.id === 'g').stock > 3900, 'bekor qilinganda ombor qaytadi');
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
