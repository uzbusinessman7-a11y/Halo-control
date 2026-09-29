export type ProductCategoryKind = "recipe" | "inventory";

export type ProductCategory = {
  id: string;
  kind: ProductCategoryKind;
  name: string;
  sortOrder: number;
};

export const RECIPE_FALLBACK_CATEGORY_ID = "recipe-other";
export const INVENTORY_FALLBACK_CATEGORY_ID = "inventory-other";

export const DEFAULT_PRODUCT_CATEGORIES: ProductCategory[] = [
  { id: "recipe-kebab", kind: "recipe", name: "Kebab / Lavash", sortOrder: 10 },
  { id: "recipe-chicken", kind: "recipe", name: "Chicken", sortOrder: 20 },
  { id: "recipe-pizza", kind: "recipe", name: "Pizza / Hotdog", sortOrder: 30 },
  { id: "recipe-drinks", kind: "recipe", name: "Ichimlik", sortOrder: 40 },
  { id: "recipe-set", kind: "recipe", name: "Set / qo‘shimcha", sortOrder: 50 },
  { id: RECIPE_FALLBACK_CATEGORY_ID, kind: "recipe", name: "Boshqa taom", sortOrder: 999 },
  { id: "inventory-meat", kind: "inventory", name: "Go‘sht / tovuq", sortOrder: 10 },
  { id: "inventory-vegetables", kind: "inventory", name: "Sabzavot", sortOrder: 20 },
  { id: "inventory-dairy", kind: "inventory", name: "Pishloq / sut", sortOrder: 30 },
  { id: "inventory-sauce", kind: "inventory", name: "Sous / ziravor", sortOrder: 40 },
  { id: "inventory-drinks", kind: "inventory", name: "Ichimlik", sortOrder: 50 },
  { id: "inventory-packaging", kind: "inventory", name: "Qadoq", sortOrder: 60 },
  { id: INVENTORY_FALLBACK_CATEGORY_ID, kind: "inventory", name: "Boshqa xomashyo", sortOrder: 999 },
];

const fallbackFor = (kind: ProductCategoryKind) => (
  kind === "recipe" ? RECIPE_FALLBACK_CATEGORY_ID : INVENTORY_FALLBACK_CATEGORY_ID
);

const defaultFallback = (kind: ProductCategoryKind) => (
  DEFAULT_PRODUCT_CATEGORIES.find((category) => category.id === fallbackFor(kind)) as ProductCategory
);

export function normalizeProductCategories(value: unknown): ProductCategory[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_PRODUCT_CATEGORIES;
  const ids = new Set<string>();
  const names = new Set<string>();
  const categories = source.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Partial<ProductCategory>;
    const kind = record.kind === "recipe" || record.kind === "inventory" ? record.kind : null;
    const id = String(record.id || "").trim().slice(0, 80);
    const name = String(record.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const normalizedName = `${kind}:${name.toLocaleLowerCase("uz")}`;
    if (!kind || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || !name || ids.has(id) || names.has(normalizedName)) return [];
    ids.add(id);
    names.add(normalizedName);
    return [{
      id,
      kind,
      name,
      sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : (index + 1) * 10,
    }];
  });

  (["recipe", "inventory"] as const).forEach((kind) => {
    const fallback = defaultFallback(kind);
    if (!categories.some((category) => category.id === fallback.id)) categories.push({ ...fallback });
  });

  return categories.sort((left, right) => (
    left.kind.localeCompare(right.kind)
    || left.sortOrder - right.sortOrder
    || left.name.localeCompare(right.name, "uz")
  ));
}

export function categoriesForKind(categories: ProductCategory[], kind: ProductCategoryKind) {
  return categories
    .filter((category) => category.kind === kind)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "uz"));
}

export function validCategoryId(
  categories: ProductCategory[],
  kind: ProductCategoryKind,
  categoryId: unknown,
) {
  const requested = String(categoryId || "");
  return categories.some((category) => category.kind === kind && category.id === requested)
    ? requested
    : fallbackFor(kind);
}

export function inferLegacyCategoryId(kind: ProductCategoryKind, name: string) {
  const key = name.normalize("NFKC").toLocaleLowerCase("uz").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (kind === "recipe") {
    if (/(cola|water|mojito|granat|drink|ichimlik)/.test(key)) return "recipe-drinks";
    if (/\b(?:fries?|fri|set|sauce|sous|garnir)\b/.test(key)) return "recipe-set";
    // Specific product families must win over generic words such as CHICKEN
    // and CHEESE inside "HALO LAVASH CHICKEN" / "CHEESE HOTDOG".
    if (/(kebab|lavash|haggi)/.test(key)) return "recipe-kebab";
    if (/(pizza|pitsa|hotdog|hot dog|peperoni|pepperoni|mushroom|vegetable|cheese medium|cheese small|hunter)/.test(key)) return "recipe-pizza";
    if (/(fried|chicken|yangnyeom|snow|spicy|wing)/.test(key)) return "recipe-chicken";
    return RECIPE_FALLBACK_CATEGORY_ID;
  }
  if (/(cola|water|mojito|ichimlik|drink|juice|suv)/.test(key)) return "inventory-drinks";
  if (/(box|qadoq|package|stakan|cup|salfetka|napkin|idish)/.test(key)) return "inventory-packaging";
  if (/(cheese|pishloq|milk|sut|cream|qaymoq)/.test(key)) return "inventory-dairy";
  if (/(cabbage|karam|onion|piyoz|potato|kartosh|tomato|pomidor|sabzi|vegetable)/.test(key)) return "inventory-vegetables";
  if (/(chicken|tovuq|meat|go sht|gosht|lamb|mol|qo y|qoy)/.test(key)) return "inventory-meat";
  if (/(sauce|sous|spice|ziravor|salt|tuz|oil|yog|mayonez|ketchup)/.test(key)) return "inventory-sauce";
  return INVENTORY_FALLBACK_CATEGORY_ID;
}

export function validProductCategories(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 100) return false;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return false;
    const record = candidate as Partial<ProductCategory>;
    if (record.kind !== "recipe" && record.kind !== "inventory") return false;
    if (typeof record.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.id)) return false;
    if (typeof record.name !== "string") return false;
    const name = record.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 60 || name !== record.name) return false;
    if (typeof record.sortOrder !== "number" || !Number.isFinite(record.sortOrder)) return false;
    const nameKey = `${record.kind}:${name.toLocaleLowerCase("uz")}`;
    if (ids.has(record.id) || names.has(nameKey)) return false;
    ids.add(record.id);
    names.add(nameKey);
  }
  return value.some((candidate) => (
    (candidate as ProductCategory).id === RECIPE_FALLBACK_CATEGORY_ID
    && (candidate as ProductCategory).kind === "recipe"
  )) && value.some((candidate) => (
    (candidate as ProductCategory).id === INVENTORY_FALLBACK_CATEGORY_ID
    && (candidate as ProductCategory).kind === "inventory"
  ));
}
