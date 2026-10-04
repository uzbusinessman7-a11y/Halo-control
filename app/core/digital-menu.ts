/**
 * HALO V2 — monitor menyusi (oshxona/zal televizoridagi reklama menyu).
 *
 * Qoidalar:
 *  - Monitor menyusi biznes hisobidan ALOHIDA jadvalda saqlanadi (v2_digital_menu). Savdo, ombor, kassa va
 *    retseptlarga hech narsa yozmaydi — faqat menyudagi taomning SOTUV NARXINI o'qiydi.
 *  - Variant HALO Control menyusidagi taomga bog'langan bo'lsa, ekrandagi narx doim o'sha taomning hozirgi
 *    sotuv narxi (narx bir joyda yuritiladi). Bog'lanmagan bo'lsa — shu yerda qo'lda yozilgan narx.
 *  - Ekran sahifasi parolsiz ochiladi va faqat ko'rinadigan ma'lumotni oladi (nom, tavsif, narx, rasm).
 *  - Rasmlar bazada saqlanadi (v2_digital_menu_media); brauzer yuklashdan oldin kichraytiradi.
 */
import type { D1Like } from "../lib/full-migration";
import { DIGITAL_MENU_SEED } from "./digital-menu-seed";

type Row = Record<string, unknown>;
export class DigitalMenuError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface DmVariant { id: string; label: string; recipeId: string; price: number }
export interface DmItem {
  id: string; name: string; description: string; screen: string; badge: string; imageId: string; imageUrl: string;
  visible: boolean; soldOut: boolean; soldOutText: string; variants: DmVariant[];
}
export interface DmScreen { id: string; title: string; itemsPerPage: number; spotlightSeconds: number }
export interface DmOffer { visible: boolean; title: string; description: string; price: number; imageId: string; imageUrl: string }
export interface DmPromotion extends DmOffer { eyebrow: string; oldPrice: number; badge: string; intervalSeconds: number; durationSeconds: number; startsAt: string; endsAt: string }
export interface DmThanks { visible: boolean; title: string; message: string; intervalSeconds: number; durationSeconds: number }
export interface DmConfig {
  restaurant: { name: string; slogan: string; hours: string; phone: string; footer: string };
  screens: DmScreen[]; items: DmItem[]; setOffer: DmOffer; promotion: DmPromotion; thanks: DmThanks;
}
export interface RecipePrice { id: string; name: string; price: number; categoryId: string }

const MAX_ITEMS = 120;
const MAX_VARIANTS = 6;
const MAX_SCREENS = 8;
/** Kichraytirilgan rasm: 900 KB dan oshmasin (D1 qatori 2 MB gacha). */
export const MAX_IMAGE_BYTES = 900_000;
const IMAGE_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
const text = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max);
const bool = (value: unknown) => value === true;
const int = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const idOk = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const slug = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
/** Faqat https rasm manzili (eski saytdagi vaqtinchalik rasm). */
const safeUrl = (value: unknown) => {
  const url = text(value, 400);
  return /^https:\/\/[a-z0-9.-]+\/[^\s"'<>]*$/i.test(url) ? url : "";
};
const moment = (value: unknown) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || "")) ? String(value) : "");

function cleanOffer(input: Row, fallbackTitle: string): DmOffer {
  return {
    visible: bool(input.visible), title: text(input.title, 40) || fallbackTitle, description: text(input.description, 120),
    price: int(input.price, 0, 10_000_000, 0), imageId: idOk(input.imageId) ? String(input.imageId) : "", imageUrl: safeUrl(input.imageUrl),
  };
}

/** Har qanday kiruvchi ma'lumotni to'g'ri shaklga keltiradi (noto'g'ri maydonlar tashlanadi, hech qachon xato bermaydi). */
export function normalizeDm(input: unknown): DmConfig {
  const source = (input && typeof input === "object" ? input : {}) as Row;
  const restaurant = (source.restaurant && typeof source.restaurant === "object" ? source.restaurant : {}) as Row;
  const seenScreens = new Set<string>();
  const screens: DmScreen[] = [];
  for (const entry of rows(source.screens)) {
    const id = slug(entry.id);
    if (!id || seenScreens.has(id) || screens.length >= MAX_SCREENS) continue;
    seenScreens.add(id);
    screens.push({ id, title: text(entry.title, 24) || id, itemsPerPage: int(entry.itemsPerPage, 3, 10, 8), spotlightSeconds: int(entry.spotlightSeconds, 4, 120, 8) });
  }
  if (!screens.length) screens.push({ id: "menyu", title: "Menyu", itemsPerPage: 8, spotlightSeconds: 8 });
  const seenItems = new Set<string>();
  const items: DmItem[] = [];
  for (const entry of rows(source.items)) {
    if (!idOk(entry.id) || seenItems.has(String(entry.id)) || items.length >= MAX_ITEMS) continue;
    const name = text(entry.name, 60);
    if (!name) continue;
    seenItems.add(String(entry.id));
    const seenVariants = new Set<string>();
    const variants: DmVariant[] = [];
    for (const variant of rows(entry.variants)) {
      if (!idOk(variant.id) || seenVariants.has(String(variant.id)) || variants.length >= MAX_VARIANTS) continue;
      seenVariants.add(String(variant.id));
      variants.push({ id: String(variant.id), label: text(variant.label, 40), recipeId: text(variant.recipeId, 100), price: int(variant.price, 0, 10_000_000, 0) });
    }
    items.push({
      id: String(entry.id), name, description: text(entry.description, 160), screen: seenScreens.has(slug(entry.screen)) ? slug(entry.screen) : screens[0].id,
      badge: text(entry.badge, 16), imageId: idOk(entry.imageId) ? String(entry.imageId) : "", imageUrl: safeUrl(entry.imageUrl),
      visible: entry.visible !== false, soldOut: bool(entry.soldOut), soldOutText: text(entry.soldOutText, 20) || "SOTILDI", variants,
    });
  }
  const promo = (source.promotion && typeof source.promotion === "object" ? source.promotion : {}) as Row;
  const thanks = (source.thanks && typeof source.thanks === "object" ? source.thanks : {}) as Row;
  return {
    restaurant: {
      name: text(restaurant.name, 24) || "HALO", slogan: text(restaurant.slogan, 80), hours: text(restaurant.hours, 60),
      phone: text(restaurant.phone, 30), footer: text(restaurant.footer, 80),
    },
    screens, items,
    setOffer: cleanOffer((source.setOffer && typeof source.setOffer === "object" ? source.setOffer : {}) as Row, "SET MENU"),
    promotion: {
      ...cleanOffer(promo, "AKSIYA"), eyebrow: text(promo.eyebrow, 40), oldPrice: int(promo.oldPrice, 0, 10_000_000, 0), badge: text(promo.badge, 12),
      intervalSeconds: int(promo.intervalSeconds, 10, 3600, 30), durationSeconds: int(promo.durationSeconds, 4, 120, 8), startsAt: moment(promo.startsAt), endsAt: moment(promo.endsAt),
    },
    thanks: {
      visible: bool(thanks.visible), title: text(thanks.title, 60), message: text(thanks.message, 160),
      intervalSeconds: int(thanks.intervalSeconds, 5, 3600, 15), durationSeconds: int(thanks.durationSeconds, 3, 120, 10),
    },
  };
}

export const seedDm = (): DmConfig => normalizeDm(DIGITAL_MENU_SEED);

/* ---------- saqlash (alohida jadvallar; biznes holatiga tegmaydi) ---------- */
export const DM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS v2_digital_menu (branch_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS v2_digital_menu_media (id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, mime TEXT NOT NULL, data TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL)`,
];
let schemaReady: D1Like | null = null;
export async function ensureDmSchema(db: D1Like) {
  if (schemaReady === db) return;
  await db.batch(DM_SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady = db;
}
const branchOk = (branchId: string) => /^[a-z0-9][a-z0-9_-]{0,79}$/.test(branchId);

export async function readDm(db: D1Like, branchId: string): Promise<{ config: DmConfig; updatedAt: string; saved: boolean }> {
  if (!branchOk(branchId)) throw new DigitalMenuError("Filial topilmadi.", 404);
  await ensureDmSchema(db);
  const row = await db.prepare("SELECT payload, updated_at FROM v2_digital_menu WHERE branch_id = ?").bind(branchId).first<{ payload: string; updated_at: string }>();
  if (!row) return { config: seedDm(), updatedAt: "", saved: false };
  let parsed: unknown = {};
  try { parsed = JSON.parse(row.payload); } catch { /* buzilgan yozuv — bo'sh menyu sifatida ochiladi */ }
  return { config: normalizeDm(parsed), updatedAt: row.updated_at, saved: true };
}

export async function writeDm(db: D1Like, branchId: string, config: DmConfig, now = new Date()): Promise<string> {
  if (!branchOk(branchId)) throw new DigitalMenuError("Filial topilmadi.", 404);
  await ensureDmSchema(db);
  const updatedAt = now.toISOString();
  await db.prepare("INSERT INTO v2_digital_menu (branch_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(branch_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at")
    .bind(branchId, JSON.stringify(normalizeDm(config)), updatedAt).run();
  return updatedAt;
}

/** Rasm saqlash: brauzer kichraytirib, base64 ko'rinishida yuboradi. */
export async function putMedia(db: D1Like, branchId: string, mime: unknown, base64: unknown, now = new Date()): Promise<string> {
  if (!branchOk(branchId)) throw new DigitalMenuError("Filial topilmadi.", 404);
  const type = String(mime || "");
  const data = String(base64 || "");
  if (!IMAGE_TYPES.has(type)) throw new DigitalMenuError("Rasm JPG, PNG yoki WebP bo‘lishi kerak.");
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new DigitalMenuError("Rasm fayli buzilgan. Qayta tanlang.");
  const bytes = Math.floor(data.length * 3 / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  if (bytes < 100) throw new DigitalMenuError("Rasm fayli bo‘sh.");
  if (bytes > MAX_IMAGE_BYTES) throw new DigitalMenuError("Rasm juda katta. Kichikroq rasm tanlang.", 413);
  await ensureDmSchema(db);
  const id = `img-${crypto.randomUUID().replace(/-/g, "")}`;
  await db.prepare("INSERT INTO v2_digital_menu_media (id, branch_id, mime, data, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, branchId, type, data, bytes, now.toISOString()).run();
  return id;
}

export async function getMedia(db: D1Like, id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  if (!idOk(id)) return null;
  await ensureDmSchema(db);
  const row = await db.prepare("SELECT mime, data FROM v2_digital_menu_media WHERE id = ?").bind(id).first<{ mime: string; data: string }>();
  if (!row || !IMAGE_TYPES.has(row.mime)) return null;
  const binary = atob(row.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: row.mime, bytes };
}

/**
 * Menyuda ishlatilmayotgan rasmlarni o'chiradi (almashtirilgan yoki olib tashlangan rasm bazada qolib ketmasin).
 * Bir soatdan yangi rasmga tegilmaydi — rahbar yuklab, hali "Saqlash"ni bosmagan bo'lishi mumkin.
 */
export async function pruneMedia(db: D1Like, branchId: string, config: DmConfig, now = new Date()): Promise<number> {
  await ensureDmSchema(db);
  const used = new Set([config.setOffer.imageId, config.promotion.imageId, ...config.items.map((item) => item.imageId)].filter(Boolean));
  const before = new Date(now.getTime() - 3_600_000).toISOString();
  const all = (await db.prepare("SELECT id FROM v2_digital_menu_media WHERE branch_id = ? AND created_at < ?").bind(branchId, before).all<{ id: string }>()).results;
  const orphans = all.filter((row) => !used.has(row.id));
  for (const row of orphans) await db.prepare("DELETE FROM v2_digital_menu_media WHERE id = ? AND branch_id = ?").bind(row.id, branchId).run();
  return orphans.length;
}

/* ---------- ekran javobi qisqa vaqt xotirada turadi (uchta ekran har 30 soniyada so'raydi) ---------- */
const TV_MEMO_MS = 12_000;
const tvMemo = new Map<string, { at: number; body: string }>();
export function tvMemoGet(key: string, now = Date.now()): string {
  const hit = tvMemo.get(key);
  return hit && now - hit.at < TV_MEMO_MS ? hit.body : "";
}
export function tvMemoSet(key: string, body: string, now = Date.now()) {
  if (tvMemo.size > 200) tvMemo.clear();
  tvMemo.set(key, { at: now, body });
}
export function tvMemoClear() { tvMemo.clear(); }

/* ---------- HALO Control menyusidagi narxlar ---------- */
export function recipePrices(recipes: unknown): RecipePrice[] {
  return rows(recipes).filter((recipe) => typeof recipe.id === "string" && recipe.id && recipe.archived !== true)
    .map((recipe) => ({ id: String(recipe.id), name: String(recipe.name || recipe.id), price: Math.max(0, Math.round(Number(recipe.salePrice) || 0)), categoryId: String(recipe.categoryId || "") }));
}

/** Faqat retseptlar qismini o'qiydi (butun filial holatini ochmasdan) — ekran har 30 soniyada so'raydi. */
export async function readRecipePrices(db: D1Like, branchId: string): Promise<RecipePrice[] | null> {
  const row = await db.prepare("SELECT json_extract(payload, '$.recipes') AS recipes FROM app_state WHERE id = ?").bind(branchId).first<{ recipes: string | null }>();
  if (!row) return null;
  try { return recipePrices(JSON.parse(row.recipes || "[]")); } catch { return []; }
}

const nameKey = (value: string) => value.toLowerCase().replace(/[‘’`ʻʼ']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tokens = (value: string) => new Set(nameKey(value).split(" ").filter(Boolean));

/**
 * Bog'lash taklifi: taom nomi + variant yozuvidagi hamma so'z menyudagi AYNAN BITTA taom nomida uchrasa — o'sha taom.
 * Bir nechta mos kelsa yoki umuman kelmasa — taklif yo'q (noto'g'ri narx ekranga chiqib ketmasin). Faqat taklif: rahbar tasdiqlaydi.
 */
export function suggestRecipe(itemName: string, variantLabel: string, recipes: RecipePrice[], siblings = 1): string {
  const wanted = tokens(`${itemName} ${variantLabel}`);
  if (!wanted.size) return "";
  const exact = recipes.filter((recipe) => { const have = tokens(recipe.name); return have.size === wanted.size && [...wanted].every((token) => have.has(token)); });
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return "";
  const containing = recipes.filter((recipe) => { const have = tokens(recipe.name); return [...wanted].every((token) => have.has(token)); });
  if (containing.length === 1) return containing[0].id;
  // Bitta variantli taom (masalan pitsa): variant yozuvisiz, faqat nomi bilan.
  if (siblings === 1 && variantLabel) return suggestRecipe(itemName, "", recipes, 1);
  return "";
}

export function variantPrice(variant: DmVariant, byId: Map<string, RecipePrice>): { price: number; linked: boolean } {
  const recipe = variant.recipeId ? byId.get(variant.recipeId) : undefined;
  return recipe && recipe.price > 0 ? { price: recipe.price, linked: true } : { price: variant.price, linked: false };
}

const imageOf = (entry: { imageId: string; imageUrl: string }) => (entry.imageId ? `/api/v2/tv?media=${entry.imageId}` : entry.imageUrl);

/** Ekran uchun ochiq ma'lumot: faqat ko'rinadigan narsalar. Tannarx, retsept va boshqa ichki ma'lumot chiqmaydi. */
export function tvView(config: DmConfig, recipes: RecipePrice[], screenId: string) {
  const screen = config.screens.find((entry) => entry.id === screenId) || config.screens[0];
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const offer = (entry: DmOffer) => ({ title: entry.title, description: entry.description, price: entry.price, image: imageOf(entry) });
  return {
    screen: { id: screen.id, title: screen.title, itemsPerPage: screen.itemsPerPage, spotlightSeconds: screen.spotlightSeconds },
    screens: config.screens.map((entry) => ({ id: entry.id, title: entry.title })),
    restaurant: config.restaurant,
    items: config.items.filter((item) => item.screen === screen.id && item.visible).map((item) => ({
      id: item.id, name: item.name, description: item.description, badge: item.badge, image: imageOf(item), soldOut: item.soldOut, soldOutText: item.soldOutText,
      variants: item.variants.map((variant) => ({ label: variant.label, price: variantPrice(variant, byId).price })).filter((variant) => variant.price > 0),
    })),
    setOffer: config.setOffer.visible ? offer(config.setOffer) : null,
    promotion: config.promotion.visible ? {
      ...offer(config.promotion), eyebrow: config.promotion.eyebrow, oldPrice: config.promotion.oldPrice, badge: config.promotion.badge,
      intervalSeconds: config.promotion.intervalSeconds, durationSeconds: config.promotion.durationSeconds, startsAt: config.promotion.startsAt, endsAt: config.promotion.endsAt,
    } : null,
    thanks: config.thanks.visible && (config.thanks.title || config.thanks.message) ? {
      title: config.thanks.title, message: config.thanks.message, intervalSeconds: config.thanks.intervalSeconds, durationSeconds: config.thanks.durationSeconds,
    } : null,
  };
}

/* ---------- rahbar amallari (sof funksiyalar: holat → yangi holat) ---------- */
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

export function saveItem(config: DmConfig, body: Row, recipes: RecipePrice[]): { config: DmConfig; id: string; created: boolean } {
  const id = text(body.id, 80);
  const current = id ? config.items.find((item) => item.id === id) : undefined;
  if (id && !current) throw new DigitalMenuError("Taom topilmadi. Sahifani yangilang.", 404);
  if (!current && config.items.length >= MAX_ITEMS) throw new DigitalMenuError(`Monitor menyusida ${MAX_ITEMS} tadan ko‘p taom bo‘lmaydi.`);
  const name = text(body.name, 60);
  if (name.length < 2) throw new DigitalMenuError("Taom nomini yozing.");
  const screen = slug(body.screen);
  if (!config.screens.some((entry) => entry.id === screen)) throw new DigitalMenuError("Qaysi ekranda ko‘rinishini tanlang.");
  const known = new Set(recipes.map((recipe) => recipe.id));
  const list = rows(body.variants);
  if (!list.length) throw new DigitalMenuError("Kamida bitta narx yozing.");
  if (list.length > MAX_VARIANTS) throw new DigitalMenuError(`Bitta taomda ${MAX_VARIANTS} tadan ko‘p variant bo‘lmaydi.`);
  const used = new Set<string>();
  const variants: DmVariant[] = list.map((entry, index) => {
    const label = text(entry.label, 40);
    if (list.length > 1 && !label) throw new DigitalMenuError(`${index + 1}-variant: nomini yozing (masalan Chicken yoki 450 gram).`);
    const recipeId = text(entry.recipeId, 100);
    if (recipeId && !known.has(recipeId)) throw new DigitalMenuError(`${index + 1}-variant: bog‘langan taom menyuda topilmadi.`);
    const price = Number(entry.price);
    if (!recipeId && (!Number.isSafeInteger(price) || price <= 0 || price > 10_000_000)) throw new DigitalMenuError(`${index + 1}-variant: narxini yozing yoki menyudagi taomga bog‘lang.`);
    let variantId = idOk(entry.id) ? String(entry.id) : "";
    if (!variantId || used.has(variantId)) variantId = newId("var");
    used.add(variantId);
    // Bog'langan variantda qo'lda narx yuborilmasa — avvalgisi zaxira bo'lib qoladi (taom menyudan olib tashlansa ko'rinadi).
    const before = current?.variants.find((variant) => variant.id === variantId)?.price || 0;
    return { id: variantId, label, recipeId, price: Number.isSafeInteger(price) && price > 0 ? price : before };
  });
  const imageId = body.imageId === undefined ? (current?.imageId || "") : (idOk(body.imageId) ? String(body.imageId) : "");
  const item: DmItem = {
    id: current?.id || newId("item"), name, description: text(body.description, 160), screen, badge: text(body.badge, 16),
    imageId, imageUrl: body.imageId === "" ? "" : imageId ? "" : (current?.imageUrl || ""),
    visible: body.visible !== false, soldOut: bool(body.soldOut), soldOutText: text(body.soldOutText, 20) || "SOTILDI", variants,
  };
  return { config: { ...config, items: current ? config.items.map((entry) => (entry.id === current.id ? item : entry)) : [...config.items, item] }, id: item.id, created: !current };
}

export function deleteItem(config: DmConfig, id: unknown): DmConfig {
  if (!config.items.some((item) => item.id === id)) throw new DigitalMenuError("Taom topilmadi.", 404);
  return { ...config, items: config.items.filter((item) => item.id !== id) };
}

/** Bitta maydonni tez o'zgartirish: sotildi yoki ko'rinadi. */
export function toggleItem(config: DmConfig, id: unknown, field: unknown, value: unknown): DmConfig {
  if (field !== "soldOut" && field !== "visible") throw new DigitalMenuError("Noto‘g‘ri amal.");
  if (!config.items.some((item) => item.id === id)) throw new DigitalMenuError("Taom topilmadi.", 404);
  return { ...config, items: config.items.map((item) => (item.id === id ? { ...item, [field]: value === true } : item)) };
}

/** Tartib: shu ekran ichida bir pog'ona yuqoriga (-1) yoki pastga (1). */
export function moveItem(config: DmConfig, id: unknown, direction: unknown): DmConfig {
  const item = config.items.find((entry) => entry.id === id);
  if (!item) throw new DigitalMenuError("Taom topilmadi.", 404);
  const sameScreen = config.items.filter((entry) => entry.screen === item.screen);
  const index = sameScreen.indexOf(item);
  const target = index + (Number(direction) < 0 ? -1 : 1);
  if (target < 0 || target >= sameScreen.length) return config;
  const other = sameScreen[target];
  return { ...config, items: config.items.map((entry) => (entry === item ? other : entry === other ? item : entry)) };
}

/** Variantni menyudagi taomga bog'lash (narx o'sha yerdan olinadi) yoki uzish (recipeId bo'sh). */
export function linkVariant(config: DmConfig, body: Row, recipes: RecipePrice[]): DmConfig {
  const recipeId = text(body.recipeId, 100);
  const recipe = recipes.find((entry) => entry.id === recipeId);
  if (recipeId && !recipe) throw new DigitalMenuError("Menyudagi taom topilmadi.", 404);
  let found = false;
  const items = config.items.map((item) => (item.id !== body.itemId ? item : {
    ...item, variants: item.variants.map((variant) => {
      if (variant.id !== body.variantId) return variant;
      found = true;
      // Uzilganda ekrandagi narx o'zgarib ketmasin: oxirgi ko'rsatilgan narx qo'lda narx bo'lib qoladi.
      const shown = variantPrice(variant, new Map(recipes.map((entry) => [entry.id, entry]))).price;
      return { ...variant, recipeId, price: recipeId ? variant.price : shown };
    }),
  }));
  if (!found) throw new DigitalMenuError("Variant topilmadi. Sahifani yangilang.", 404);
  return { ...config, items };
}

export function saveSettings(config: DmConfig, body: Row): DmConfig {
  // Yangi rasm yuklansa yoki rasm olib tashlansa — eski saytdagi vaqtinchalik rasm manzili ham tozalanadi.
  for (const key of ["setOffer", "promotion"]) {
    const part = body[key];
    if (part && typeof part === "object" && (part as Row).imageId !== undefined) (part as Row).imageUrl = "";
  }
  const next = normalizeDm({
    ...config,
    restaurant: body.restaurant && typeof body.restaurant === "object" ? { ...config.restaurant, ...(body.restaurant as Row) } : config.restaurant,
    setOffer: body.setOffer && typeof body.setOffer === "object" ? { ...config.setOffer, ...(body.setOffer as Row) } : config.setOffer,
    promotion: body.promotion && typeof body.promotion === "object" ? { ...config.promotion, ...(body.promotion as Row) } : config.promotion,
    thanks: body.thanks && typeof body.thanks === "object" ? { ...config.thanks, ...(body.thanks as Row) } : config.thanks,
  });
  if (!next.restaurant.name) throw new DigitalMenuError("Nomini yozing.");
  if (next.promotion.startsAt && next.promotion.endsAt && next.promotion.startsAt > next.promotion.endsAt) throw new DigitalMenuError("Aksiya tugash vaqti boshlanishidan oldin bo‘lmasin.");
  return next;
}

export function saveScreen(config: DmConfig, body: Row): { config: DmConfig; id: string } {
  const title = text(body.title, 24);
  if (title.length < 2) throw new DigitalMenuError("Ekran nomini yozing.");
  const settings = { itemsPerPage: int(body.itemsPerPage, 3, 10, 8), spotlightSeconds: int(body.spotlightSeconds, 4, 120, 8) };
  const id = slug(body.id);
  if (id) {
    if (!config.screens.some((screen) => screen.id === id)) throw new DigitalMenuError("Ekran topilmadi.", 404);
    return { config: { ...config, screens: config.screens.map((screen) => (screen.id === id ? { ...screen, title, ...settings } : screen)) }, id };
  }
  if (config.screens.length >= MAX_SCREENS) throw new DigitalMenuError(`Ekranlar soni ${MAX_SCREENS} tadan oshmaydi.`);
  const fresh = slug(title);
  if (!fresh) throw new DigitalMenuError("Ekran nomida lotin harfi yoki raqam bo‘lsin (manzil uchun).");
  if (config.screens.some((screen) => screen.id === fresh)) throw new DigitalMenuError("Bunday ekran bor.", 409);
  return { config: { ...config, screens: [...config.screens, { id: fresh, title, ...settings }] }, id: fresh };
}

export function deleteScreen(config: DmConfig, id: unknown): DmConfig {
  if (!config.screens.some((screen) => screen.id === id)) throw new DigitalMenuError("Ekran topilmadi.", 404);
  if (config.screens.length <= 1) throw new DigitalMenuError("Kamida bitta ekran qolishi kerak.", 409);
  const count = config.items.filter((item) => item.screen === id).length;
  if (count) throw new DigitalMenuError(`Bu ekranda ${count} ta taom bor. Avval ularni boshqa ekranga o‘tkazing.`, 409);
  return { ...config, screens: config.screens.filter((screen) => screen.id !== id) };
}

/** Rahbar sahifasi uchun: har variantning hozirgi narxi, bog'langan taom va taklif. */
export function adminView(config: DmConfig, recipes: RecipePrice[]) {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  let unlinked = 0;
  const items = config.items.map((item) => ({
    ...item, image: imageOf(item),
    variants: item.variants.map((variant) => {
      const live = variantPrice(variant, byId);
      const missing = Boolean(variant.recipeId) && !byId.has(variant.recipeId);
      if (!live.linked) unlinked += 1;
      return {
        ...variant, shownPrice: live.price, linked: live.linked, missing, recipeName: byId.get(variant.recipeId)?.name || "",
        suggestion: live.linked ? "" : suggestRecipe(item.name, variant.label, recipes, item.variants.length),
      };
    }),
  }));
  return { ...config, items, setOffer: { ...config.setOffer, image: imageOf(config.setOffer) }, promotion: { ...config.promotion, image: imageOf(config.promotion) }, unlinked };
}
