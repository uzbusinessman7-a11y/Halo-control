import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { recipeViews, saveRecipe } = await import('../app/core/recipes.ts');

const state = () => ({
  productCategories: [{ id: 'c1', kind: 'recipe', name: 'Lavash', sortOrder: 1 }],
  inventory: [{ id: 'g', name: 'Go‘sht', unit: 'g', unitCost: 20 }, { id: 'l', name: 'Lavash', unit: 'dona', unitCost: 300 }, { id: 'z', name: 'Yangi sous', unit: 'g', unitCost: 0 }],
  recipes: [{ id: 'old', name: 'Donar', salePrice: 9000, posCode: 'P1', ingredients: [{ inventoryId: 'g', quantity: 150, lineCost: 2250 }, { inventoryId: 'l', quantity: 1, lineCost: 250 }], extraCosts: [{ id: 'e', name: 'Qadoq', amount: 200 }] }],
});

test('tannarx doim hozirgi narxdan; eski “muzlatilgan” narx ko‘rinadi', () => {
  const [r] = recipeViews(state());
  assert.equal(r.cost, 150 * 20 + 300 + 200);
  assert.equal(r.storedCost, 2250 + 250 + 200);
  assert.equal(r.stale, true);
  assert.equal(r.foodCostPercent, 38.9);
  assert.equal(r.suggestedPrice, 11700, '3500 / 0.30 → 11 700');
});

test('retsept saqlash: narx muzlatilmaydi, POS kodi saqlanadi, takror va xato kiritish rad etiladi', () => {
  const s = state();
  const edited = saveRecipe(s, { id: 'old', name: 'Donar', salePrice: 9500, categoryId: 'c1', ingredients: [{ inventoryId: 'g', quantity: 125 }, { inventoryId: 'l', quantity: 1 }], extraCosts: [{ name: 'Qadoq', amount: 200 }], deliveryPrices: { coupang: 11000 } });
  const saved = edited.state.recipes[0];
  assert.equal(saved.posCode, 'P1');
  assert.equal(saved.ingredients[0].lineCost, undefined);
  const [view] = recipeViews(edited.state);
  assert.equal(view.stale, false);
  assert.equal(view.cost, 125 * 20 + 300 + 200);
  assert.equal(view.deliveryPrices.coupang, 11000);
  const op = crypto.randomUUID();
  const created = saveRecipe(edited.state, { operationId: op, name: 'Shaurma', salePrice: 10000, ingredients: [{ inventoryId: 'g', quantity: 200 }] });
  assert.equal(created.result.created, true);
  assert.equal(saveRecipe(created.state, { operationId: op, name: 'Shaurma', salePrice: 10000, ingredients: [] }).result.created, false, 'takror so‘rov');
  assert.throws(() => saveRecipe(created.state, { operationId: crypto.randomUUID(), name: 'donar', salePrice: 1 }), /allaqachon bor/);
  assert.throws(() => saveRecipe(created.state, { operationId: crypto.randomUUID(), name: 'X taom', salePrice: 1, ingredients: [{ inventoryId: 'g', quantity: 1 }, { inventoryId: 'g', quantity: 2 }] }), /ikki marta/);
  assert.throws(() => saveRecipe(created.state, { operationId: crypto.randomUUID(), name: 'Y taom', salePrice: 1, ingredients: [{ inventoryId: 'yoq', quantity: 1 }] }), /mahsulotni tanlang/);
  const noPrice = recipeViews(saveRecipe(created.state, { operationId: crypto.randomUUID(), name: 'Sousli', salePrice: 5000, ingredients: [{ inventoryId: 'z', quantity: 30 }] }).state).find((r) => r.name === 'Sousli');
  assert.equal(noPrice.status, "Mahsulot narxi yo'q");
  assert.equal(noPrice.cost, null, 'narxsiz mahsulot bilan soxta tannarx chiqmaydi');
});
