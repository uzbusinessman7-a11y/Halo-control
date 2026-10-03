import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const C = await import('../app/core/categories.ts');
const { validProductCategories } = await import('../app/lib/product-categories.ts');
const { saveProduct, productList } = await import('../app/core/catalog.ts');
const { saveRecipe, recipeViews } = await import('../app/core/recipes.ts');

const op = () => crypto.randomUUID();
const base = () => ({
  inventory: [{ id: 'i1', name: 'Mol go‘shti', unit: 'g', stock: 0, unitCost: 10 }, { id: 'i2', name: 'Stakan 300ml', unit: 'dona', stock: 0, unitCost: 50, categoryId: '' }, { id: 'i3', name: 'Xyz', unit: 'dona', stock: 0, unitCost: 1 }],
  recipes: [{ id: 'r1', name: 'HALO LAVASH', salePrice: 9000, ingredients: [] }, { id: 'r2', name: 'Cola', salePrice: 2000, ingredients: [], categoryId: 'recipe-drinks' }],
  stockMovements: [], suppliers: [],
});

test('yangi kategoriya, nomini o‘zgartirish, tartib va takror nom', () => {
  let s = C.saveCategory(base(), { kind: 'inventory', name: 'Muzlatilgan', operationId: op() }).state;
  const made = C.categoryList(s, 'inventory').find((c) => c.name === 'Muzlatilgan');
  assert.ok(made && /^inventory-[a-f0-9]{12}$/.test(made.id));
  assert.ok(validProductCategories(s.productCategories));
  assert.throws(() => C.saveCategory(s, { kind: 'inventory', name: 'muzlatilgan', operationId: op() }), /allaqachon/);
  s = C.saveCategory(s, { kind: 'inventory', id: made.id, name: 'Muzlatilgan mahsulot' }).state;
  assert.equal(C.categoryList(s, 'inventory').find((c) => c.id === made.id).name, 'Muzlatilgan mahsulot');
  const before = C.categoryList(s, 'inventory').map((c) => c.id);
  s = C.moveCategory(s, { kind: 'inventory', id: made.id, direction: -1 }).state;
  const after = C.categoryList(s, 'inventory').map((c) => c.id);
  assert.equal(after.indexOf(made.id), before.indexOf(made.id) - 1);
  assert.equal(after.at(-1), 'inventory-other'); // "Boshqa" doim oxirida
  assert.ok(validProductCategories(s.productCategories));
});

test('kategoriyasiz mahsulot “Boshqa”da; avtomatik taqsimlash nomga qarab, qo‘lda qo‘yilganiga tegmaydi', () => {
  let s = base();
  assert.equal(C.categoryList(s, 'inventory').find((c) => c.fallback).count, 3);
  const out = C.autoAssignCategories(s, { kind: 'inventory' });
  assert.equal(out.result.changed, 2);
  s = out.state;
  const byId = Object.fromEntries(productList(s, '2026-10-03').map((p) => [p.id, p.categoryId]));
  assert.deepEqual(byId, { i1: 'inventory-meat', i2: 'inventory-packaging', i3: 'inventory-other' });
  s = C.assignCategory(s, { kind: 'inventory', itemId: 'i3', categoryId: 'inventory-sauce' }).state;
  assert.equal(C.autoAssignCategories(s, { kind: 'inventory' }).result.changed, 0);
  const r = C.autoAssignCategories(s, { kind: 'recipe' }).state;
  assert.deepEqual(Object.fromEntries(recipeViews(r).map((x) => [x.id, x.categoryId])), { r1: 'recipe-kebab', r2: 'recipe-drinks' });
});

test('kategoriya o‘chirilsa ichidagilar “Boshqa”ga o‘tadi; “Boshqa” o‘chirilmaydi', () => {
  let s = C.assignCategory(base(), { kind: 'inventory', itemIds: ['i1', 'i2'], categoryId: 'inventory-meat' }).state;
  const out = C.deleteCategory(s, { kind: 'inventory', id: 'inventory-meat' });
  assert.equal(out.result.moved, 2);
  assert.ok(out.state.inventory.every((i) => i.categoryId !== 'inventory-meat'));
  assert.equal(C.categoryList(out.state, 'inventory').find((c) => c.fallback).count, 3);
  assert.throws(() => C.deleteCategory(s, { kind: 'inventory', id: 'inventory-other' }), /o‘chirilmaydi/);
  assert.throws(() => C.assignCategory(s, { kind: 'inventory', itemId: 'i1', categoryId: 'recipe-kebab' }), /tanlang/);
  assert.ok(validProductCategories(out.state.productCategories));
});

test('yangi mahsulot va taom: tanlangan kategoriya saqlanadi, tanlanmasa nomidan topiladi', () => {
  let s = saveProduct(base(), { operationId: op(), name: 'Pishloq mozzarella', unit: 'g' }).state;
  assert.equal(s.inventory[0].categoryId, 'inventory-dairy');
  s = saveProduct(s, { operationId: op(), name: 'Maxsus un', unit: 'g', categoryId: 'inventory-sauce' }).state;
  assert.equal(s.inventory[0].categoryId, 'inventory-sauce');
  s = saveProduct(s, { id: 'i1', name: 'Mol go‘shti', unit: 'g' }).state; // tahrirda kategoriya yuborilmasa o'zgarmaydi
  assert.equal(s.inventory.find((i) => i.id === 'i1').categoryId, undefined);
  assert.throws(() => saveProduct(s, { operationId: op(), name: 'Yana bir narsa', unit: 'g', categoryId: 'yoq' }), /Kategoriya/);
  const r = saveRecipe(s, { operationId: op(), name: 'Pepperoni pizza', salePrice: 15000, ingredients: [], extraCosts: [] }).state;
  assert.equal(r.recipes.find((x) => x.name === 'Pepperoni pizza').categoryId, 'recipe-pizza');
  const r2 = saveRecipe(r, { id: 'r2', name: 'Cola', salePrice: 2500, ingredients: [], extraCosts: [] }).state;
  assert.equal(r2.recipes.find((x) => x.id === 'r2').categoryId, 'recipe-drinks');
});
