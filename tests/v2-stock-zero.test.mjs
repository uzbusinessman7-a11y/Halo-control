import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { resetStockToZero, applyOpeningCounts, stockZeroPreview, STOCK_ZERO_WORD } = await import('../app/core/stock-reset.ts');
const { saveAccountingCount } = await import('../app/lib/inventory-counting.ts');
const { applySaleInventoryAccounting } = await import('../app/lib/inventory-accounting.ts');
const { moveKindOf } = await import('../app/core/stock-bridge.ts');
const { foodCostTotals } = await import('../app/core/home.ts');
const { GET, POST } = await import('../app/api/v2/ombor/route.ts');

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const op = () => crypto.randomUUID();
const actor = { id: 'owner', name: 'Rahbar' };
const base = () => ({
  inventory: [
    { id: 'g', name: 'Go‘sht', unit: 'g', stock: 4200, unitCost: 18, packageName: 'quti', unitsPerPackage: 1000, packageCost: 18000, minStock: 2000, categoryId: 'inventory-meat', supplierId: 's1' },
    { id: 'n', name: 'Non', unit: 'dona', stock: -6, unitCost: 300, minStock: 20 },
    { id: 'd', name: 'Hujjatsiz', unit: 'g', stock: 700, unitCost: 2 },
    { id: 'v', name: 'Sabzavot', unit: 'g', stock: 50, unitCost: 3, expenseOnly: true },
    { id: 'z', name: 'Bo‘sh', unit: 'g', stock: 0, unitCost: 9, catalogArchived: true },
  ],
  stockMovements: [
    { id: 'r1', inventoryId: 'g', type: 'receipt', quantity: 5000, unitCost: 18, date: '2026-09-20' },
    { id: 's1', inventoryId: 'g', type: 'sale', quantity: -800, theoreticalQuantity: 800, date: '2026-09-21', referenceId: 'sale-1' },
    { id: 's2', inventoryId: 'n', type: 'sale', quantity: -6, theoreticalQuantity: 6, date: '2026-09-21', referenceId: 'sale-1' },
    { id: 'r2', inventoryId: 'd', type: 'receipt', quantity: 500, unitCost: 2, date: '2026-09-20' },
    { id: 'r3', inventoryId: 'v', type: 'receipt', quantity: 50, unitCost: 3, date: '2026-09-20' },
  ],
  recipes: [{ id: 'rc', name: 'Lavash', salePrice: 9000, ingredients: [{ inventoryId: 'g', quantity: 200 }, { inventoryId: 'n', quantity: 1 }] }],
  sales: [{ id: 'sale-1', date: '2026-09-21', total: 36000 }],
  financialEntries: [{ id: 'f1', amount: 36000, date: '2026-09-21' }],
  suppliers: [{ id: 's1', name: 'Go‘sht bozori', balance: 90000 }],
  accounts: [{ id: 'account-cash', name: 'Naqd kassa', type: 'cash', openingBalance: 100000 }],
  inventoryCounts: [{ id: 'old-count', operationId: 'old', inventoryId: 'g', actualStock: 4200 }],
  productCategories: [{ id: 'inventory-meat', kind: 'inventory', name: 'Go‘sht', sortOrder: 10 }],
  monthlyCloses: [],
});
const sumOf = (state, id) => state.stockMovements.filter((m) => m.inventoryId === id).reduce((n, m) => n + m.quantity, 0);

test('nolga tushirish: faqat qoldiq 0 bo‘ladi — narx, retsept, savdo, pul, qarz va eski tarix o‘zgarmaydi', () => {
  const start = base();
  const frozen = structuredClone(start);
  const id = op();
  const out = resetStockToZero(start, { operationId: id, confirm: STOCK_ZERO_WORD }, today);
  assert.deepEqual(start, frozen, 'kiruvchi holat o‘zgartirilmaydi');
  const next = out.state;
  // 1) hamma qoldiq 0, jurnal yig'indisi ham 0 (hujjatsiz farq qolmaydi)
  for (const item of next.inventory) {
    assert.equal(item.stock, 0, item.name);
    assert.ok(Math.abs(sumOf(next, item.id)) < 1e-9, `${item.name}: harakatlar yig‘indisi 0`);
  }
  // 2) mahsulotning boshqa hamma maydoni aynan o'zidek
  for (const [index, item] of next.inventory.entries()) {
    const { stock: _a, openingCountPending: _b, ...rest } = item;
    const { stock: _c, ...old } = frozen.inventory[index];
    assert.deepEqual(rest, old, `${item.name}: narx, qadoq, minimum, kategoriya o‘zgarmaydi`);
  }
  // 3) boshqa bo'limlarning birortasi o'zgarmaydi
  for (const key of ['recipes', 'sales', 'financialEntries', 'suppliers', 'accounts', 'inventoryCounts', 'productCategories', 'monthlyCloses']) {
    assert.deepEqual(next[key], frozen[key], `${key} o‘zgarmaydi`);
  }
  // 4) eski harakatlar o'chirilmaydi va o'zgarmaydi — faqat yangi tuzatishlar qo'shiladi
  const added = next.stockMovements.filter((m) => String(m.referenceId || '').startsWith('stock-zero:'));
  assert.deepEqual(next.stockMovements.filter((m) => !added.includes(m)), frozen.stockMovements);
  assert.deepEqual(added.map((m) => [m.inventoryId, m.quantity, m.type, m.date]).sort(), [['d', -500, 'adjustment', today], ['g', -4200, 'adjustment', today], ['n', 6, 'adjustment', today], ['v', -50, 'adjustment', today]]);
  assert.ok(added.every((m) => moveKindOf(m) === 'adjustment'), 'nolga tushirish — kamomad ham, chiqit ham emas');
  // 5) sanaladigan mahsulotlar boshlang'ich sanoqni kutadi; xarajat sifatidagi — yo'q
  assert.deepEqual(next.inventory.map((i) => i.openingCountPending === true), [true, true, true, false, true]);
  assert.equal(out.result.items, 4);
  assert.equal(out.result.value, 4200 * 18 + 700 * 2, 'manfiy qoldiq va xarajat mahsuloti qiymatga kirmaydi');
  assert.equal(next.stockZeroResets[0].id, id);
  // 6) yozish quvuri qoldiqni qayta hisoblab yubormaydi
  assert.ok(applySaleInventoryAccounting(start, next).inventory.every((i) => i.stock === 0));
});

test('nolga tushirish: tasdiq so‘zi, takror so‘rov, yopilgan oy, yaxlitlash', () => {
  assert.throws(() => resetStockToZero(base(), { operationId: op(), confirm: '' }, today), /NOL/);
  assert.throws(() => resetStockToZero(base(), { operationId: op(), confirm: 'ha' }, today), /NOL/);
  assert.throws(() => resetStockToZero(base(), { operationId: 'x', confirm: 'NOL' }, today), /yangilab/);
  assert.doesNotThrow(() => resetStockToZero(base(), { operationId: op(), confirm: ' nol ' }, today));
  // takror so'rov (bir xil raqam) ikkinchi marta hech narsa yozmaydi
  const id = op();
  const first = resetStockToZero(base(), { operationId: id, confirm: 'NOL' }, today);
  const again = resetStockToZero(first.state, { operationId: id, confirm: 'NOL' }, today);
  assert.equal(again.result.alreadySaved, true);
  assert.equal(again.state, first.state);
  // ikkinchi marta bosilsa: qoldiq allaqachon 0 — yangi harakat yozilmaydi
  const second = resetStockToZero(first.state, { operationId: op(), confirm: 'NOL' }, today);
  assert.equal(second.state.stockMovements.length, first.state.stockMovements.length);
  assert.equal(second.result.items, 0);
  // yopilgan oyda bo'lmaydi
  const closed = { ...base(), monthlyCloses: [{ id: `monthly-close:${today.slice(0, 7)}`, month: today.slice(0, 7), closedAt: new Date().toISOString(), inventoryItems: [], payrollItems: [] }] };
  assert.throws(() => resetStockToZero(closed, { operationId: op(), confirm: 'NOL' }, today), /yopilgan/);
  // jurnal milli-birlikda yaxlitlanadi: 0.0004 × 3 jurnalda 0 — tuzatish yozilmaydi, qoldiq baribir 0
  const tiny = { inventory: [{ id: 't', name: 'T', unit: 'g', stock: 0.0012, unitCost: 1 }], stockMovements: [1, 2, 3].map((n) => ({ id: `m${n}`, inventoryId: 't', type: 'receipt', quantity: 0.0004, date: today })) };
  const tinyOut = resetStockToZero(tiny, { operationId: op(), confirm: 'NOL' }, today);
  assert.equal(tinyOut.state.stockMovements.length, 3);
  assert.equal(tinyOut.state.inventory[0].stock, 0);
  // oldindan ko'rish
  const preview = stockZeroPreview(base());
  assert.deepEqual([preview.items, preview.negative, preview.total, preview.pending, preview.last], [4, 1, 5, 0, null]);
  assert.equal(stockZeroPreview(first.state).pending, 3, 'arxivdagi mahsulot kutayotganlar soniga kirmaydi');
});

test('nolga tushirilgandan keyingi birinchi sanoq — boshlang‘ich qoldiq; keyingisi — odatdagi sanoq', () => {
  const zero = resetStockToZero(base(), { operationId: op(), confirm: 'NOL' }, today).state;
  const c1 = `cnt-${op()}`;
  const counted = saveAccountingCount(zero, { counts: [{ inventoryId: 'g', actualStock: 3900 }, { inventoryId: 'n', actualStock: 0 }], date: today, operationId: c1 }, actor);
  const opened = applyOpeningCounts(zero, counted.state, c1);
  assert.deepEqual(opened.opening.sort(), ['g', 'n']);
  const moves = opened.state.stockMovements.filter((m) => m.referenceId === `inventory-count:${c1}`);
  assert.ok(moves.every((m) => m.openingBalance === true && moveKindOf(m) === 'adjustment' && /Boshlang‘ich qoldiq/.test(m.note)));
  const byId = Object.fromEntries(opened.state.inventory.map((i) => [i.id, i]));
  assert.equal(byId.g.stock, 3900);
  assert.equal(byId.g.unitCost, 18, 'narx o‘zgarmaydi');
  assert.equal(byId.g.openingCountPending, false);
  assert.equal(byId.n.openingCountPending, false, '0 deb sanalgan ham boshlang‘ich qoldiq (0)');
  assert.equal(byId.d.openingCountPending, true, 'sanalmagan mahsulot hali kutadi');
  // takror so'rov: hech narsa o'zgarmaydi
  const retry = saveAccountingCount(opened.state, { counts: [{ inventoryId: 'g', actualStock: 3900 }], date: today, operationId: c1 }, actor);
  assert.equal(applyOpeningCounts(opened.state, retry.state, c1).state, opened.state);
  // ikkinchi sanoq — haqiqiy farq (kamomad)
  const c2 = `cnt-${op()}`;
  const later = saveAccountingCount(opened.state, { counts: [{ inventoryId: 'g', actualStock: 3700 }], date: today, operationId: c2 }, actor);
  const laterMarked = applyOpeningCounts(opened.state, later.state, c2);
  assert.deepEqual(laterMarked.opening, []);
  const loss = laterMarked.state.stockMovements.find((m) => m.referenceId === `inventory-count:${c2}`);
  assert.equal(loss.quantity, -200);
  assert.equal(moveKindOf(loss), 'count');
});

test('birinchi sanoq kam chiqsa (noldan keyin kirim bo‘lgan) — bu haqiqiy kamomad, boshlang‘ich qoldiq emas', () => {
  const zero = resetStockToZero(base(), { operationId: op(), confirm: 'NOL' }, today).state;
  const received = { ...zero, inventory: zero.inventory.map((i) => (i.id === 'g' ? { ...i, stock: 1000 } : i)), stockMovements: [{ id: 'r9', inventoryId: 'g', type: 'receipt', quantity: 1000, unitCost: 18, date: today }, ...zero.stockMovements] };
  const c1 = `cnt-${op()}`;
  const counted = saveAccountingCount(received, { counts: [{ inventoryId: 'g', actualStock: 900 }], date: today, operationId: c1 }, actor);
  const marked = applyOpeningCounts(received, counted.state, c1);
  assert.deepEqual(marked.opening, []);
  const move = marked.state.stockMovements.find((m) => m.referenceId === `inventory-count:${c1}`);
  assert.equal(moveKindOf(move), 'count');
  assert.equal(marked.state.inventory.find((i) => i.id === 'g').openingCountPending, false, 'kutish belgisi baribir olinadi');
  // yozish quvuri (eski + yangi maydonlarni birlashtiradi) belgini qaytarib qo'ymaydi
  assert.equal(applySaleInventoryAccounting(received, marked.state).inventory.find((i) => i.id === 'g').openingCountPending, false);
});

/* ---------- sayt orqali (haqiqiy yozish quvuri va ombor jurnali bilan) ---------- */
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
const url = 'https://halo.example.workers.dev/api/v2/ombor';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;
const req = (body, headers = owner) => POST(new Request(url, { method: 'POST', headers, body: JSON.stringify({ branchId: 'main', ...body }) }));
const payload = () => JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);

test('sayt: faqat rahbar; NOL so‘zisiz bo‘lmaydi; noldan keyin jurnal mos, birinchi sanoq kamomad/ortiqcha bermaydi', async () => {
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /Omborni nolga tushirish/);
  assert.equal((await req({ action: 'zeroStock', operationId: op(), confirm: 'NOL' }, { 'content-type': 'application/json' })).status, 401);

  const state = payload();
  state.inventory = [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 700, unitCost: 15, minStock: 300 }, { id: 'n', name: 'Non', unit: 'dona', stock: 40, unitCost: 300 }];
  state.stockMovements = [
    { id: 'r', inventoryId: 'g', type: 'receipt', quantity: 1000, unitCost: 15, date: today },
    { id: 'rn', inventoryId: 'n', type: 'receipt', quantity: 40, unitCost: 300, date: today },
  ];
  state.recipes = [{ id: 'rc', name: 'Lavash', salePrice: 9000, ingredients: [{ inventoryId: 'g', quantity: 200 }] }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(state));

  const seen = await (await req({ action: 'products' })).json();
  const before = payload(); // birinchi o'qishdan keyin (tizimning o'z ko'chirishlari yozilgach)
  assert.deepEqual([seen.zero.items, seen.zero.value], [2, 700 * 15 + 40 * 300]);
  assert.equal((await req({ action: 'zeroStock', operationId: op(), confirm: 'ha' })).status, 400);
  assert.deepEqual(payload().inventory, before.inventory, 'tasdiqsiz hech narsa o‘zgarmaydi');

  const done = await (await req({ action: 'zeroStock', operationId: op(), confirm: 'NOL' })).json();
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.items, 2);
  assert.ok(done.products.every((p) => p.stock === 0 && p.openingPending === !p.vegetable), 'sanaladigan mahsulotlar boshlang‘ich sanoqni kutadi');
  assert.equal(done.products.find((p) => p.id === 'g').unitCost, 15, 'narx o‘zgarmaydi');
  const after = payload();
  assert.deepEqual(after.recipes, before.recipes);
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.financialEntries, before.financialEntries);
  assert.deepEqual(after.sales, before.sales);

  const report = await (await req({})).json();
  assert.equal(report.bridge.mismatched, 0, 'qoldiq ham, jurnal ham 0 — hujjatsiz farq yo‘q');
  assert.ok(report.bridge.items.every((i) => i.oldStock === 0 && i.ledgerStock === 0));
  assert.ok(report.avt.every((r) => r.countVariance === 0));

  const counted = await (await req({ action: 'count', operationId: `cnt-${op()}`, counts: [{ inventoryId: 'g', actualStock: 650 }, { inventoryId: 'n', actualStock: 38 }] })).json();
  assert.equal(counted.ok, true, JSON.stringify(counted));
  assert.deepEqual(counted.opening.sort(), ['g', 'n']);
  assert.ok(counted.products.every((p) => p.openingPending === false));
  assert.deepEqual(counted.products.filter((p) => !p.vegetable).map((p) => p.stock).sort((a, b) => a - b), [38, 650]);
  const afterCount = await (await req({})).json();
  assert.equal(afterCount.bridge.mismatched, 0);
  assert.ok(afterCount.avt.every((r) => r.countVariance === 0), 'boshlang‘ich qoldiq sanoq farqi emas');
  const food = await foodCostTotals(globalThis.__HALO_CONTROL_DB__, { tenantId: 'halo', branchId: 'main' }, `${today.slice(0, 8)}01`, today);
  assert.equal(food.countLoss || 0, 0, 'boshlang‘ich qoldiq oziq-ovqat tannarxini kamaytirmaydi');

  // keyingi sanoq — odatdagidek kamomad
  const second = await (await req({ action: 'count', operationId: `cnt-${op()}`, counts: [{ inventoryId: 'g', actualStock: 600 }] })).json();
  assert.deepEqual(second.opening, []);
  await req({}); // ombor jurnali yangilanadi
  const food2 = await foodCostTotals(globalThis.__HALO_CONTROL_DB__, { tenantId: 'halo', branchId: 'main' }, `${today.slice(0, 8)}01`, today);
  assert.equal(food2.countLoss, 50 * 15);
});
