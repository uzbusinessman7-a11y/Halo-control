import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { saveProduct, productList } = await import('../app/core/catalog.ts');
const { applySaleInventoryAccounting } = await import('../app/lib/inventory-accounting.ts');
const { liveRecipeCost } = await import('../app/core/recipes.ts').then((m) => ({ liveRecipeCost: m.recipeViews }));

const op = () => crypto.randomUUID();
const base = () => ({
  inventory: [{ id: 'g', name: 'Mol go‘shti', unit: 'g', stock: 5000, unitCost: 18, packageName: 'quti', unitsPerPackage: 1000, packageCost: 18000, minStock: 0 }],
  stockMovements: [{ id: 'r1', inventoryId: 'g', type: 'receipt', quantity: 5000, unitCost: 18, date: '2026-10-01' }],
  recipes: [{ id: 'r', name: 'Lavash', salePrice: 9000, ingredients: [{ inventoryId: 'g', quantity: 200 }] }],
  suppliers: [], sales: [],
});
const same = { id: 'g', name: 'Mol go‘shti', unit: 'g', packageName: 'quti', unitsPerPackage: 1000 };

test('mahsulot narxini qo‘lda o‘zgartirish: narx, qadoq narxi va tarix; qoldiq o‘zgarmaydi', () => {
  const out = saveProduct(base(), { ...same, unitCost: 25 });
  const item = out.state.inventory[0];
  assert.equal(item.unitCost, 25);
  assert.equal(item.packageCost, 25000);
  assert.equal(item.stock, 5000);
  assert.deepEqual([item.costEdits[0].from, item.costEdits[0].to], [18, 25]);
  assert.equal(out.result.priceChanged, true);
  // retsept tannarxi yangi narx bilan
  assert.equal(liveRecipeCost(out.state)[0].cost, 5000);
  // yozish quvuridan o'tganda ham saqlanadi
  assert.equal(applySaleInventoryAccounting(base(), out.state).inventory[0].unitCost, 25);
});

test('narx yuborilmasa o‘zgarmaydi; noto‘g‘ri narx rad etiladi; yangi mahsulotga narx qo‘yiladi', () => {
  const keep = saveProduct(base(), { ...same, minStock: 2000 });
  assert.equal(keep.state.inventory[0].unitCost, 18);
  assert.equal(keep.state.inventory[0].packageCost, 18000);
  assert.equal(keep.state.inventory[0].costEdits, undefined);
  assert.equal(saveProduct(base(), { ...same, unitCost: 18 }).result.priceChanged, false);
  assert.throws(() => saveProduct(base(), { ...same, unitCost: -1 }), /Narxni/);
  assert.throws(() => saveProduct(base(), { ...same, unitCost: 'abc' }), /Narxni/);
  const made = saveProduct(base(), { operationId: op(), name: 'Pishloq', unit: 'g', unitCost: 12.5 }).state.inventory[0];
  assert.equal(made.unitCost, 12.5);
  assert.equal(productList({ ...base(), inventory: [made] }, '2026-10-04')[0].unitCost, 12.5);
  // qadoq o'zgarsa, qadoq narxi birlik narxiga mos qoladi
  const pack = saveProduct(base(), { ...same, unitsPerPackage: 500 }).state.inventory[0];
  assert.equal(pack.packageCost, 9000);
});
