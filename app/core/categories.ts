/**
 * HALO V2 — kategoriyalar: ombor mahsulotlari va menyu taomlari uchun alohida ro'yxat.
 * Ma'lumot eski tizim formatida (state.productCategories, app/lib/product-categories.ts) — hisobotlar,
 * HALO HISOB oynasi va xodim ilovasi shu ro'yxatni ishlatadi. "Boshqa" kategoriyasi o'chirilmaydi:
 * kategoriya o'chirilsa, ichidagi mahsulot/taomlar "Boshqa"ga o'tadi (hech narsa yo'qolmaydi).
 */
import {
  categoriesForKind, inferLegacyCategoryId, INVENTORY_FALLBACK_CATEGORY_ID, normalizeProductCategories, RECIPE_FALLBACK_CATEGORY_ID,
  validCategoryId, validProductCategories, type ProductCategory, type ProductCategoryKind,
} from "../lib/product-categories";

type Row = Record<string, unknown>;
export class CategoryError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const kindOf = (value: unknown): ProductCategoryKind => {
  if (value !== "recipe" && value !== "inventory") throw new CategoryError("Kategoriya turi noto‘g‘ri.");
  return value;
};
const fallbackId = (kind: ProductCategoryKind) => (kind === "recipe" ? RECIPE_FALLBACK_CATEGORY_ID : INVENTORY_FALLBACK_CATEGORY_ID);
const itemsKey = (kind: ProductCategoryKind) => (kind === "recipe" ? "recipes" : "inventory");
const activeItem = (kind: ProductCategoryKind, item: Row) => (kind === "recipe" ? item.archived !== true : item.catalogArchived !== true);

/** Mahsulot/taomning amaldagi kategoriyasi (yo'q yoki o'chirilgan bo'lsa — "Boshqa"). */
export function categoryIdOf(state: Row, kind: ProductCategoryKind, item: Row): string {
  return validCategoryId(normalizeProductCategories(state.productCategories), kind, item.categoryId);
}

export function categoryList(state: Row, kind: ProductCategoryKind) {
  const all = normalizeProductCategories(state.productCategories);
  const counts = new Map<string, number>();
  for (const item of rows(state[itemsKey(kind)])) {
    if (!activeItem(kind, item)) continue;
    const id = validCategoryId(all, kind, item.categoryId);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return categoriesForKind(all, kind).map((category) => ({
    id: category.id, name: category.name, sortOrder: category.sortOrder, count: counts.get(category.id) || 0, fallback: category.id === fallbackId(kind),
  }));
}

function commit(state: Row, categories: ProductCategory[]): Row {
  const normalized = normalizeProductCategories(categories);
  if (!validProductCategories(normalized)) throw new CategoryError("Kategoriyalar ro‘yxatini tekshiring (nom takrorlanmasin, 100 tadan oshmasin).");
  return { ...state, productCategories: normalized };
}

/** Yangi kategoriya yoki nomini o'zgartirish. Yangi kategoriya "Boshqa"dan oldin, ro'yxat oxiriga qo'shiladi. */
export function saveCategory(state: Row, body: Row) {
  const kind = kindOf(body.kind);
  const all = normalizeProductCategories(state.productCategories);
  const name = clean(body.name, 60);
  if (name.length < 2) throw new CategoryError("Kategoriya nomini yozing.");
  const id = clean(body.id, 80);
  const twin = all.find((category) => category.kind === kind && category.id !== id && category.name.toLocaleLowerCase("uz") === name.toLocaleLowerCase("uz"));
  if (twin) throw new CategoryError(`«${twin.name}» kategoriyasi allaqachon bor.`, 409);
  if (id) {
    if (!all.some((category) => category.id === id && category.kind === kind)) throw new CategoryError("Kategoriya topilmadi. Sahifani yangilang.", 404);
    return { state: commit(state, all.map((category) => (category.id === id ? { ...category, name } : category))), result: { id, created: false } };
  }
  if (all.length >= 100) throw new CategoryError("Kategoriyalar soni 100 tadan oshmaydi.");
  const op = clean(body.operationId, 36).replace(/[^a-f0-9]/g, "").slice(0, 12);
  if (op.length < 8) throw new CategoryError("Oynani yangilang.");
  const newId = `${kind}-${op}`;
  if (all.some((category) => category.id === newId)) return { state, result: { id: newId, created: false } };
  const lastOrder = Math.max(0, ...all.filter((category) => category.kind === kind && category.id !== fallbackId(kind)).map((category) => category.sortOrder));
  return { state: commit(state, [...all, { id: newId, kind, name, sortOrder: Math.min(998, lastOrder + 10) }]), result: { id: newId, created: true } };
}

/** Kategoriyani o'chirish: ichidagilar "Boshqa"ga o'tadi. "Boshqa"ning o'zi o'chirilmaydi. */
export function deleteCategory(state: Row, body: Row) {
  const kind = kindOf(body.kind);
  const id = clean(body.id, 80);
  if (id === fallbackId(kind)) throw new CategoryError("“Boshqa” kategoriyasi o‘chirilmaydi — kategoriyasiz mahsulotlar shu yerda turadi.", 409);
  const all = normalizeProductCategories(state.productCategories);
  if (!all.some((category) => category.id === id && category.kind === kind)) return { state, result: { moved: 0, alreadySaved: true } };
  let moved = 0;
  const key = itemsKey(kind);
  const items = rows(state[key]).map((item) => {
    if (item.categoryId !== id) return item;
    moved += 1;
    return { ...item, categoryId: fallbackId(kind) };
  });
  return { state: { ...commit(state, all.filter((category) => category.id !== id)), [key]: items }, result: { moved, alreadySaved: false } };
}

/** Tartibni o'zgartirish (menyu va ro'yxatlarda shu tartibda ko'rinadi). direction: -1 yuqoriga, 1 pastga. */
export function moveCategory(state: Row, body: Row) {
  const kind = kindOf(body.kind);
  const id = clean(body.id, 80);
  const direction = Number(body.direction) < 0 ? -1 : 1;
  const all = normalizeProductCategories(state.productCategories);
  const ordered = categoriesForKind(all, kind).filter((category) => category.id !== fallbackId(kind));
  const index = ordered.findIndex((category) => category.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return { state, result: { moved: false } };
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const order = new Map(ordered.map((category, position) => [category.id, (position + 1) * 10]));
  return { state: commit(state, all.map((category) => (order.has(category.id) ? { ...category, sortOrder: order.get(category.id)! } : category))), result: { moved: true } };
}

/** Bitta (yoki bir nechta) mahsulot/taomni kategoriyaga o'tkazish. */
export function assignCategory(state: Row, body: Row) {
  const kind = kindOf(body.kind);
  const all = normalizeProductCategories(state.productCategories);
  const categoryId = clean(body.categoryId, 80);
  if (!all.some((category) => category.id === categoryId && category.kind === kind)) throw new CategoryError("Kategoriyani tanlang.");
  const ids = new Set((Array.isArray(body.itemIds) ? body.itemIds : [body.itemId]).map((value) => clean(value, 100)).filter(Boolean));
  if (!ids.size || ids.size > 500) throw new CategoryError("Mahsulotni tanlang.");
  let changed = 0;
  const key = itemsKey(kind);
  const items = rows(state[key]).map((item) => {
    if (!ids.has(String(item.id)) || item.categoryId === categoryId) return item;
    changed += 1;
    return { ...item, categoryId };
  });
  if (!changed) return { state, result: { changed: 0 } };
  return { state: { ...commit(state, all), [key]: items }, result: { changed } };
}

/** "Boshqa"da turgan (kategoriyasiz) mahsulot/taomlarni nomiga qarab avtomatik taqsimlash. Qo'lda qo'yilganiga tegmaydi. */
export function autoAssignCategories(state: Row, body: Row) {
  const kind = kindOf(body.kind);
  const all = normalizeProductCategories(state.productCategories);
  let changed = 0;
  const key = itemsKey(kind);
  const items = rows(state[key]).map((item) => {
    if (validCategoryId(all, kind, item.categoryId) !== fallbackId(kind)) return item;
    const guess = validCategoryId(all, kind, inferLegacyCategoryId(kind, String(item.name || "")));
    if (guess === fallbackId(kind) || guess === item.categoryId) return item;
    changed += 1;
    return { ...item, categoryId: guess };
  });
  if (!changed) return { state, result: { changed: 0 } };
  return { state: { ...commit(state, all), [key]: items }, result: { changed } };
}

/** Yangi mahsulot/taom uchun: tanlanmagan bo'lsa nomidan taxmin (topilmasa — "Boshqa"). */
export function resolveNewCategory(state: Row, kind: ProductCategoryKind, requested: unknown, name: string): string {
  const all = normalizeProductCategories(state.productCategories);
  const asked = clean(requested, 80);
  if (asked) {
    if (!all.some((category) => category.id === asked && category.kind === kind)) throw new CategoryError("Kategoriyani tanlang.");
    return asked;
  }
  return validCategoryId(all, kind, inferLegacyCategoryId(kind, name));
}
