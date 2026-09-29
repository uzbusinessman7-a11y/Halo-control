import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/kiritish/route.ts');
const pos = await import('../app/api/pos-terminal/route.ts');
const intake = await import('../app/api/intake/route.ts');
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

test('kiritish: sahifa, mahsulotlar ro‘yxati; savdo, ombor kirimi va sabzavot eski API orqali saqlanadi', async () => {
  const sqlite = new DatabaseSync(':memory:');
  globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
  globalThis.__HALO_SELF_HOSTED__ = true;
  assert.equal((await GET(new Request(base + '/api/v2/kiritish'))).status, 303);
  const html = await (await GET(new Request(base + '/api/v2/kiritish', { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.accounts = [{ id: 'cash', name: 'Naqd', type: 'cash', openingBalance: 0 }, { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 0 }];
  p.inventory = [
    { id: 'g', name: 'Go‘sht', unit: 'g', stock: 0, unitCost: 20 },
    { id: 'p', name: 'Pomidor', unit: 'dona', stock: 0, unitCost: 0, expenseOnly: true },
  ];
  p.recipes = [{ id: 'd', name: 'Donar', salePrice: 9000, ingredients: [{ inventoryId: 'g', quantity: 100 }] }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  const data = await (await POST(new Request(base + '/api/v2/kiritish', { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  const flags = Object.fromEntries(data.inventory.map((i) => [i.name, i.vegetable]));
  assert.equal(flags['Go‘sht'], false);
  assert.equal(flags['Pomidor'], true);

  const stock = await intake.POST(new Request(base + '/api/intake?branch=main', { method: 'POST', headers: owner, body: JSON.stringify({ inventoryOnly: true, vegetableOnly: false, operationId: crypto.randomUUID(), date: today, lines: [{ inventoryId: 'g', quantity: 5, unit: 'kg', amount: 100000 }] }) }));
  assert.equal(stock.status, 200, JSON.stringify(await stock.clone().json()));
  const veg = await intake.POST(new Request(base + '/api/intake?branch=main', { method: 'POST', headers: owner, body: JSON.stringify({ inventoryOnly: true, vegetableOnly: true, operationId: crypto.randomUUID(), date: today, lines: [{ inventoryId: 'p', quantity: 2, unit: 'qadoq', amount: 30000 }] }) }));
  assert.equal(veg.status, 200, JSON.stringify(await veg.clone().json()));

  const sale = await pos.POST(new Request(base + '/api/pos-terminal', { method: 'POST', headers: owner, body: JSON.stringify({ operationId: crypto.randomUUID().replace(/-/g, ''), date: today, mode: 'sale', paymentType: 'bank', branchId: 'main', items: [{ recipeId: 'd', quantity: 2 }] }) }));
  const saleBody = await sale.json();
  assert.equal(sale.status, 200, JSON.stringify(saleBody));
  assert.equal(saleBody.orders[0].total, 18000);
  const state = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  assert.equal(state.inventory.find((i) => i.id === 'g').stock, 5000 - 200, 'kirim 5 kg, savdo 2×100 g');
  assert.ok(state.sales.some((s) => s.recipeId === 'd' && s.accountId === 'bank'));

  const kir = (body) => POST(new Request(base + '/api/v2/kiritish', { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) }));
  const op = crypto.randomUUID();
  const e1 = await kir({ action: 'expense', operationId: op, category: 'Ijara', name: 'Oktabr ijarasi', amount: 1500000, accountId: 'bank', date: today });
  const e1b = await e1.json();
  assert.equal(e1.status, 200, JSON.stringify(e1b));
  assert.equal(e1b.expenses[0].amount, 1500000);
  const again = await (await kir({ action: 'expense', operationId: op, category: 'Ijara', name: 'Oktabr ijarasi', amount: 1500000, accountId: 'bank', date: today })).json();
  assert.equal(again.alreadySaved, true, 'takror so‘rov ikkinchi marta yozmaydi');
  const dup = await kir({ action: 'expense', operationId: crypto.randomUUID(), category: 'Ijara', name: 'Yana', amount: 1500000, accountId: 'bank', date: today });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).code, 'DUPLICATE');
  assert.equal((await kir({ action: 'expense', operationId: crypto.randomUUID(), category: 'Mahsulot xaridi', name: 'x', amount: 10, accountId: 'bank', date: today })).status, 400);
  assert.equal((await kir({ action: 'expense', operationId: crypto.randomUUID(), category: 'Ijara', name: 'x', amount: 10, accountId: 'yoq', date: today })).status, 400);
  const meal = await pos.POST(new Request(base + '/api/pos-terminal', { method: 'POST', headers: owner, body: JSON.stringify({ operationId: crypto.randomUUID().replace(/-/g, ''), date: today, mode: 'inventory_only', inventoryReason: 'Xodim ovqati', branchId: 'main', items: [{ recipeId: 'd', quantity: 1 }] }) }));
  assert.equal(meal.status, 200, JSON.stringify(await meal.clone().json()));
  const after = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  assert.equal(after.inventory.find((i) => i.id === 'g').stock, 5000 - 200 - 100, 'xodim ovqati ham ombordan ayirildi');
  assert.ok(after.financialEntries.some((f) => f.id === 'v2-expense:' + op && f.category === 'Ijara' && f.accountId === 'bank'));
});
