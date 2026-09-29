import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { menuReport } = await import('../app/core/menu.ts');
const { GET } = await import('../app/api/v2/menyu/route.ts');

const inv = [{ id: 'g', name: 'Go‘sht', unit: 'g', unitCost: 20 }, { id: 'l', name: 'Lavash', unit: 'dona', unitCost: 300 }];
const recipe = (id, name, price, meat) => ({ id, name, salePrice: price, ingredients: [{ inventoryId: 'g', quantity: meat }, { inventoryId: 'l', quantity: 1 }] });
const sales = (recipeId, n, price, date = '2026-09-20') => ({ id: `${recipeId}-${n}-${date}`, recipeId, quantity: n, totalRevenue: n * price, totalCost: 0, date });

test('menyu tahlili: 4 guruh, food cost va ogohlantirishlar', () => {
  const state = {
    inventory: inv,
    recipes: [recipe('d', 'Donar', 9000, 150), recipe('s', 'Shaurma katta', 12000, 350), recipe('k', 'Kabob', 15000, 200), recipe('b', 'Burger', 6000, 200), { id: 'x', name: 'Yangi taom', salePrice: 8000, ingredients: [] }],
    sales: [sales('d', 100, 9000), sales('s', 90, 10500), sales('k', 10, 15000), sales('b', 8, 6000), sales('d', 500, 9000, '2026-07-01')],
  };
  const r = menuReport(state, '2026-09-29', 30);
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(by.d.cost, 3300);
  assert.equal(by.d.costPercent, 36.7);
  assert.equal(by.d.sold, 100, '90 kundan eski savdo kirmaydi');
  assert.equal(by.d.cls, 'star');
  assert.equal(by.s.cls, 'plowhorse');
  assert.equal(by.k.cls, 'puzzle');
  assert.equal(by.b.cls, 'dog');
  assert.equal(by.x.cls, null);
  assert.equal(r.incomplete, 1);
  assert.ok(by.s.flags.some((f) => /o'rtacha sotuv narxi 10,500/.test(f)));
  assert.ok(by.b.flags.some((f) => /food cost 71\.7%/.test(f)));
  assert.equal(r.items[0].id, 'd', 'eng ko‘p foyda birinchi');
});

test('sahifa: faqat rahbar, skript to‘g‘ri', async () => {
  globalThis.__HALO_SELF_HOSTED__ = true;
  const sqlite = new DatabaseSync(':memory:');
  const make = (q, p = []) => ({ bind: (...v) => make(q, v), all: async () => ({ results: sqlite.prepare(q).all(...p) }), first: async () => sqlite.prepare(q).get(...p) ?? null, run: async () => { const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(q).run(...p) });
  globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => make(q), batch: async (st) => st.map((s) => s._exec()) };
  const url = 'https://halo.example.workers.dev/api/v2/menyu';
  assert.equal((await GET(new Request(url))).status, 303);
  const html = await (await GET(new Request(url, { headers: { 'oai-authenticated-user-email': 'owner@example.com' } }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
