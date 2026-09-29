/**
 * HALO V2 — taom tannarxi (retseptlar).
 *
 * Qoidalar (restoran hisobining umumiy amaliyoti):
 *  - retseptdagi miqdor — XOM (sotib olingan holatdagi) miqdor, ombor birligida. Tozalashda chiqit bo'lsa,
 *    tayyor miqdor ÷ chiqish foizi = xom miqdor (masalan 100 g tayyor go'sht, 80% chiqish → 125 g xom);
 *  - tannarx har doim OMBORDAGI OXIRGI NARX bilan hisoblanadi. Retseptga eski narx "muzlatib" saqlanmaydi —
 *    aks holda narx oshganda foyda yolg'on ko'rinadi (eski tizimdagi asosiy xato manbai);
 *  - qadoq, sous idishi kabi qo'shimcha xarajatlar alohida qator;
 *  - food cost % = tannarx ÷ sotuv narxi; tavsiya narx = tannarx ÷ maqsad foizi.
 */
import { calculateRecipeMarginAudit, type RecipeCostInventory } from "../lib/recipe-costing";
import { DELIVERY_PLATFORMS } from "../lib/delivery-sales";
import { expenseOnlyOnDate } from "../lib/vegetable-expenses";

type Row = Record<string, unknown>;
export class RecipeError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const nameKey = (value: unknown) => clean(value, 120).toLocaleLowerCase().replace(/[‘’`ʻʼ']/g, "'");
export const TARGET_FOOD_COST = 0.3;

export interface RecipeLine { inventoryId: string; name: string; unit: string; quantity: number; unitCost: number; cost: number; missing: boolean }
export interface RecipeView {
  id: string; name: string; categoryId: string; salePrice: number; deliveryPrices: Record<string, number>;
  lines: RecipeLine[]; extraCosts: Array<{ id: string; name: string; amount: number }>;
  cost: number | null; foodCostPercent: number | null; margin: number | null; suggestedPrice: number | null;
  /** Eski tizim saqlab qo'ygan (muzlatilgan) tannarx — hozirgi narxdan farq qilsa ko'rsatiladi. */
  storedCost: number | null; stale: boolean; status: string;
}

function liveCost(recipe: Row, inventory: Row[]) {
  const byId = new Map(inventory.map((item) => [String(item.id), item]));
  const lines: RecipeLine[] = rows(recipe.ingredients).map((ingredient) => {
    const item = byId.get(String(ingredient.inventoryId || ""));
    const quantity = Number(ingredient.quantity) || 0;
    const unitCost = Number(item?.unitCost) || 0;
    return {
      inventoryId: String(ingredient.inventoryId || ""), name: String(item?.name || ingredient.name || "?"), unit: String(item?.unit || ingredient.unit || ""),
      quantity, unitCost, cost: Math.round(quantity * unitCost * 100) / 100, missing: !item || unitCost <= 0,
    };
  });
  const extraCosts = rows(recipe.extraCosts).map((extra) => ({ id: String(extra.id || ""), name: String(extra.name || ""), amount: Number(extra.amount) || 0 }));
  const total = lines.reduce((sum, line) => sum + line.cost, 0) + extraCosts.reduce((sum, extra) => sum + extra.amount, 0);
  return { lines, extraCosts, total, complete: lines.length > 0 && lines.every((line) => !line.missing) };
}

export function recipeViews(state: Row): RecipeView[] {
  const inventory = rows(state.inventory);
  return rows(state.recipes).filter((recipe) => typeof recipe.id === "string" && recipe.id && recipe.archived !== true).map((recipe) => {
    const live = liveCost(recipe, inventory);
    const stored = calculateRecipeMarginAudit(recipe as never, inventory as unknown as RecipeCostInventory[]);
    const salePrice = Math.round(Number(recipe.salePrice) || 0);
    const cost = live.complete ? Math.round(live.total) : null;
    const storedCost = stored.complete ? Math.round(stored.totalCost) : null;
    const prices = (recipe.deliveryPrices && typeof recipe.deliveryPrices === "object" ? recipe.deliveryPrices : {}) as Row;
    return {
      id: String(recipe.id), name: String(recipe.name || recipe.id), categoryId: String(recipe.categoryId || ""), salePrice,
      deliveryPrices: Object.fromEntries(DELIVERY_PLATFORMS.map((platform) => [platform.id, Math.round(Number(prices[platform.id]) || 0)])),
      lines: live.lines, extraCosts: live.extraCosts, cost,
      foodCostPercent: cost != null && salePrice > 0 ? Math.round((cost / salePrice) * 1000) / 10 : null,
      margin: cost != null && salePrice > 0 ? salePrice - cost : null,
      suggestedPrice: cost != null ? Math.ceil(cost / TARGET_FOOD_COST / 100) * 100 : null,
      storedCost, stale: cost != null && storedCost != null && Math.abs(storedCost - cost) > Math.max(10, cost * 0.02),
      status: !live.lines.length ? "Retsept kiritilmagan" : !live.complete ? "Mahsulot narxi yo'q" : salePrice <= 0 ? "Sotuv narxi yo'q" : "Tayyor",
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function recipeChoices(state: Row, today: string) {
  return rows(state.inventory)
    .filter((item) => typeof item.id === "string" && item.id && item.catalogArchived !== true)
    .map((item) => ({ id: String(item.id), name: String(item.name || item.id), unit: String(item.unit || ""), unitCost: Number(item.unitCost) || 0, vegetable: expenseOnlyOnDate(item as never, today) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function recipeCategories(state: Row) {
  return rows(state.productCategories).filter((category) => category.kind === "recipe")
    .map((category) => ({ id: String(category.id), name: String(category.name), sortOrder: Number(category.sortOrder) || 0 }))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

/** Retsept yaratish/tahrirlash. Ingredientlarga narx saqlanmaydi — tannarx doim ombordagi oxirgi narxdan. */
export function saveRecipe(state: Row, body: Row) {
  const recipes = rows(state.recipes);
  const inventory = rows(state.inventory);
  const byId = new Map(inventory.map((item) => [String(item.id), item]));
  let id = clean(body.id, 100);
  if (!id) {
    const op = clean(body.operationId, 36);
    if (!/^[a-f0-9-]{36}$/.test(op)) throw new RecipeError("Oynani yangilang.");
    id = `recipe-${op.slice(0, 13)}`;
    const again = recipes.find((recipe) => recipe.id === id);
    if (again) return { state, result: { recipe: again, created: false } };
  }
  const current = recipes.find((recipe) => recipe.id === id);
  if (clean(body.id, 100) && !current) throw new RecipeError("Taom topilmadi. Sahifani yangilang.", 404);
  const name = clean(body.name, 120);
  if (name.length < 2) throw new RecipeError("Taom nomini yozing.");
  if (recipes.some((recipe) => recipe.id !== id && recipe.archived !== true && nameKey(recipe.name) === nameKey(name))) throw new RecipeError(`«${name}» nomli taom allaqachon bor.`, 409);
  const salePrice = Number(body.salePrice);
  if (!Number.isSafeInteger(salePrice) || salePrice < 0 || salePrice > 10_000_000) throw new RecipeError("Sotuv narxini tekshiring.");
  const categoryId = clean(body.categoryId, 100);
  if (categoryId && !recipeCategories(state).some((category) => category.id === categoryId)) throw new RecipeError("Toifani tanlang.");
  const seen = new Set<string>();
  const ingredients = rows(body.ingredients).map((line, index) => {
    const item = byId.get(clean(line.inventoryId, 100));
    if (!item || item.catalogArchived === true) throw new RecipeError(`${index + 1}-qator: mahsulotni tanlang.`);
    if (seen.has(String(item.id))) throw new RecipeError(`«${String(item.name)}» ikki marta yozilgan — bitta qatorga jamlang.`);
    seen.add(String(item.id));
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) throw new RecipeError(`«${String(item.name)}»: miqdorni tekshiring.`);
    return { id: clean(line.id, 60) || `ing-${index + 1}-${String(item.id).slice(-8)}`, inventoryId: String(item.id), name: String(item.name), unit: String(item.unit || ""), quantity: Math.round(quantity * 1000) / 1000 };
  });
  if (ingredients.length > 60) throw new RecipeError("Juda ko'p ingredient.");
  const extraCosts = rows(body.extraCosts).filter((extra) => clean(extra.name, 60) || Number(extra.amount)).map((extra, index) => {
    const amount = Number(extra.amount);
    if (!clean(extra.name, 60) || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new RecipeError(`${index + 1}-qo'shimcha xarajat: nomi va summasini tekshiring.`);
    return { id: clean(extra.id, 60) || `extra-${index + 1}`, name: clean(extra.name, 60), amount: Math.round(amount) };
  });
  const prices = (body.deliveryPrices && typeof body.deliveryPrices === "object" ? body.deliveryPrices : {}) as Row;
  const deliveryPrices: Record<string, number> = {};
  for (const platform of DELIVERY_PLATFORMS) {
    const value = Number(prices[platform.id] || 0);
    if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000) throw new RecipeError(`${platform.shortLabel} narxini tekshiring.`);
    if (value) deliveryPrices[platform.id] = value;
  }
  const recipe = {
    ...(current || { posCode: "", posAliases: [] }),
    id, name, salePrice, categoryId, ingredients, extraCosts, deliveryPrices,
    updatedAt: new Date().toISOString(),
    ...(current ? {} : { createdAt: new Date().toISOString() }),
  };
  return {
    state: { ...state, recipes: current ? recipes.map((entry) => (entry.id === id ? recipe : entry)) : [recipe, ...recipes] },
    result: { recipe, created: !current },
  };
}
