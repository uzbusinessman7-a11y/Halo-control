/**
 * HALO V2 — xodim menyuni boshqaradi: rahbar ruxsat bergan xodim «Monitor menyu»ning hamma ishini qiladi
 * (taom qo'shish/o'chirish, nom, rasm, narx, yashirish, «Sotildi», tartib, ekran va SET MENU sozlamalari).
 *
 * - Ruxsat alohida jadvalda (v2_worker_menu_access): rahbar Sozlamalar → Akkauntlar'da har xodimga belgilaydi.
 *   Eski xodim jadvaliga (halo_worker_users) ustun qo'shilmaydi.
 * - Narx: taom HALO Control menyusiga bog'langan bo'lsa — o'sha taomning sotuv narxi o'zgaradi (kassa ham shu narxdan
 *   sotadi), «O'zgarishlar tarixi»ga xodim nomi bilan yoziladi. Bog'lanmagan bo'lsa — faqat ekrandagi narx.
 * - Xodimning har o'zgarishi jurnalga yoziladi (v2_digital_menu_log): kim, qachon, nima o'zgardi; oldingi va keyingi
 *   menyu nusxasi saqlanadi. Rahbar Monitor menyuda ko'radi va bir bosishda qaytaradi (keyin yana o'zgarmagan bo'lsa).
 *   Jurnaldagi eski rasmlar tozalashda o'chirilmaydi.
 * - Xodim saqlayotganda rahbar ham saqlagan bo'lsa — ustma-ust yozilmaydi (menyu nusxasi tekshiriladi).
 */
import type { D1Like } from "../lib/full-migration";
import { ensureDmSchema, normalizeDm, readDm, type DmConfig, type RecipePrice } from "./digital-menu";

export class StaffMenuError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
type Row = Record<string, unknown>;
const clean = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max);
const won = (amount: number) => `₩${Math.round(amount).toLocaleString("en-US")}`;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
/** Jurnalda saqlanadigan yozuvlar soni (filial bo'yicha) — shulardagi eski rasmlar o'chirilmaydi. */
export const LOG_KEEP = 150;

const ready = new WeakSet<object>();
async function ensureSchema(db: D1Like) {
  if (ready.has(db)) return;
  await ensureDmSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS v2_worker_menu_access (worker_id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS v2_digital_menu_log (id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, created_at TEXT NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '', actor_name TEXT NOT NULL DEFAULT '', item_id TEXT NOT NULL, item_name TEXT NOT NULL DEFAULT '',
      field TEXT NOT NULL, before_value TEXT NOT NULL DEFAULT '', after_value TEXT NOT NULL DEFAULT '', reverted_at TEXT NOT NULL DEFAULT '')`),
  ]);
  ready.add(db);
}

/* ---------- ruxsat ---------- */
export async function menuAccessIds(db: D1Like, branchId: string): Promise<string[]> {
  await ensureSchema(db);
  const result = await db.prepare("SELECT worker_id FROM v2_worker_menu_access WHERE branch_id = ? AND allowed = 1").bind(branchId).all<{ worker_id: string }>();
  return (result.results || []).map((row) => row.worker_id);
}
export async function canEditMenu(db: D1Like, branchId: string, workerId: string): Promise<boolean> {
  await ensureSchema(db);
  const row = await db.prepare("SELECT allowed FROM v2_worker_menu_access WHERE worker_id = ? AND branch_id = ?").bind(workerId, branchId).first<{ allowed: number }>();
  return Boolean(row?.allowed);
}
export async function setMenuAccess(db: D1Like, branchId: string, workerId: string, allowed: boolean, now = new Date()) {
  await ensureSchema(db);
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(workerId)) throw new StaffMenuError("Akkauntni tanlang.");
  await db.prepare(`INSERT INTO v2_worker_menu_access (worker_id, branch_id, allowed, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET branch_id = excluded.branch_id, allowed = excluded.allowed, updated_at = excluded.updated_at`)
    .bind(workerId, branchId, allowed ? 1 : 0, now.toISOString()).run();
}

/* ---------- nima o'zgardi (rahbar uchun qisqa matn) ---------- */
const vname = (variant: { label: string; size: string }) => [variant.label, variant.size].filter(Boolean).join(" ") || "narx";
export function describeChange(before: DmConfig, after: DmConfig): string {
  const parts: string[] = [];
  const oldById = new Map(before.items.map((item) => [item.id, item]));
  const newIds = new Set(after.items.map((item) => item.id));
  for (const item of after.items) {
    const old = oldById.get(item.id);
    if (!old) { parts.push(`Yangi taom: ${item.name} (${item.variants.map((v) => `${vname(v)} ${won(v.price)}`).join(", ")})`); continue; }
    const d: string[] = [];
    if (old.name !== item.name) d.push(`nomi «${old.name}» → «${item.name}»`);
    if (old.description !== item.description) d.push("tavsifi");
    if (old.badge !== item.badge) d.push(`belgisi ${old.badge || "—"} → ${item.badge || "—"}`);
    if (old.screen !== item.screen) d.push("boshqa ekranga o‘tdi");
    if (old.imageId !== item.imageId || old.imageUrl !== item.imageUrl) d.push("rasm almashtirildi");
    if (old.visible !== item.visible) d.push(item.visible ? "ko‘rsatildi" : "yashirildi");
    if (old.soldOut !== item.soldOut) d.push(item.soldOut ? "«Sotildi» qo‘yildi" : "sotuvga qaytdi");
    const oldVariants = new Map(old.variants.map((variant) => [variant.id, variant]));
    for (const variant of item.variants) {
      const was = oldVariants.get(variant.id);
      if (!was) { d.push(`yangi narx ${vname(variant)} ${won(variant.price)}`); continue; }
      if (was.recipeId !== variant.recipeId) d.push(`${vname(variant)} — ${variant.recipeId ? "menyudagi taomga bog‘landi" : "bog‘lanish uzildi"}`);
      else if (!variant.recipeId && was.price !== variant.price) d.push(`${vname(variant)} ${won(was.price)} → ${won(variant.price)}`);
      if (was.label !== variant.label || was.size !== variant.size) d.push(`«${vname(was)}» → «${vname(variant)}»`);
      if (was.active !== variant.active) d.push(`${vname(variant)} ${variant.active ? "ko‘rsatildi" : "yashirildi"}`);
    }
    for (const was of old.variants) if (!item.variants.some((variant) => variant.id === was.id)) d.push(`narx olib tashlandi: ${vname(was)}`);
    if (d.length) parts.push(`${item.name}: ${d.join(", ")}`);
  }
  for (const old of before.items) if (!newIds.has(old.id)) parts.push(`Taom o‘chirildi: ${old.name}`);
  const keptOrder = (config: DmConfig, other: Set<string>) => config.items.filter((item) => other.has(item.id)).map((item) => item.id).join(",");
  if (keptOrder(before, newIds) !== keptOrder(after, new Set(before.items.map((item) => item.id)))) parts.push("taomlar tartibi o‘zgardi");
  if (JSON.stringify(before.setOffer) !== JSON.stringify(after.setOffer)) parts.push(`SET MENU${before.setOffer.price !== after.setOffer.price ? ` ${won(before.setOffer.price)} → ${won(after.setOffer.price)}` : " o‘zgardi"}`);
  if (JSON.stringify(before.screens) !== JSON.stringify(after.screens)) parts.push("ekranlar sozlamasi o‘zgardi");
  if (JSON.stringify([before.restaurant, before.promotion, before.thanks]) !== JSON.stringify([after.restaurant, after.promotion, after.thanks])) parts.push("umumiy sozlamalar o‘zgardi");
  return parts.join("; ").slice(0, 400) || "o‘zgarish";
}

/* ---------- menyu nusxasini tekshirib yozish ---------- */
/** `expected` — o'qilgan nusxa. Shu orada boshqa joyda saqlangan bo'lsa — yozmaydi (false). */
export async function writeIf(db: D1Like, branchId: string, config: DmConfig, expected: { saved: boolean; updatedAt: string }, now = new Date()) {
  const payload = JSON.stringify(normalizeDm(config));
  const at = now.toISOString();
  const result = (expected.saved
    ? await db.prepare("UPDATE v2_digital_menu SET payload = ?, updated_at = ? WHERE branch_id = ? AND updated_at = ?").bind(payload, at, branchId, expected.updatedAt).run()
    : await db.prepare("INSERT OR IGNORE INTO v2_digital_menu (branch_id, payload, updated_at) VALUES (?, ?, ?)").bind(branchId, payload, at).run()) as { meta?: { changes?: number } };
  return Number(result.meta?.changes || 0) === 1;
}

/* ---------- jurnal ---------- */
export interface Actor { id: string; name: string }
async function insertLog(db: D1Like, branchId: string, actor: Actor, entry: { itemId: string; itemName: string; field: string; before: string; after: string }, now: Date) {
  await ensureSchema(db);
  await db.prepare(`INSERT INTO v2_digital_menu_log (id, branch_id, created_at, actor_id, actor_name, item_id, item_name, field, before_value, after_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(`ml-${crypto.randomUUID()}`, branchId, now.toISOString(), clean(actor.id, 80), clean(actor.name, 60),
    clean(entry.itemId, 80), clean(entry.itemName, 400), entry.field, entry.before, entry.after).run();
  await db.prepare(`DELETE FROM v2_digital_menu_log WHERE branch_id = ? AND id NOT IN (SELECT id FROM v2_digital_menu_log WHERE branch_id = ? ORDER BY created_at DESC LIMIT ${LOG_KEEP})`)
    .bind(branchId, branchId).run();
}
const snapshot = (config: DmConfig) => JSON.stringify(normalizeDm(config));

/** Xodim Monitor menyuda saqlagan o'zgarish: oldingi va keyingi nusxa + qisqa matn. */
export async function logConfigChange(db: D1Like, branchId: string, actor: Actor, before: DmConfig, after: DmConfig, now = new Date()) {
  await insertLog(db, branchId, actor, { itemId: "menu", itemName: describeChange(before, after), field: "config", before: snapshot(before), after: snapshot(after) }, now);
}
/** Xodim menyudagi taomning sotuv narxini o'zgartirdi (kassa ham). */
export async function logPriceChange(db: D1Like, branchId: string, actor: Actor, change: { recipeId: string; label: string; before: number; after: number }, now = new Date()) {
  await insertLog(db, branchId, actor, { itemId: change.recipeId, itemName: change.label, field: "price", before: String(change.before), after: String(change.after) }, now);
}

/** Sof: HALO Control menyusidagi taomning sotuv narxi. `expected` berilsa — hozirgi narx shu bo'lishi shart (qaytarish uchun). */
export function setRecipeSalePrice(state: Row, recipeIdInput: unknown, priceInput: unknown, expected?: number) {
  const recipeId = clean(recipeIdInput, 100);
  const recipes = rows(state.recipes);
  const recipe = recipes.find((entry) => entry.id === recipeId && entry.archived !== true);
  if (!recipe) throw new StaffMenuError("Menyudagi taom topilmadi. Sahifani yangilang.", 404);
  const price = Number(priceInput);
  if (!Number.isSafeInteger(price) || price <= 0 || price > 10_000_000) throw new StaffMenuError("Narxni tekshiring (butun son, vonda).");
  const before = Math.max(0, Math.round(Number(recipe.salePrice) || 0));
  if (expected !== undefined && before !== expected) throw new StaffMenuError("Bu narx keyin yana o‘zgartirilgan. Avval oxirgi o‘zgarishni qaytaring.", 409);
  return { state: { ...state, recipes: recipes.map((entry) => entry.id === recipeId ? { ...entry, salePrice: price } : entry) }, result: { name: String(recipe.name || recipeId), before, after: price } };
}

export interface MenuLogEntry {
  id: string; createdAt: string; actorName: string; field: "name" | "image" | "config" | "price";
  summary: string; before: string; after: string; beforeImage: string; afterImage: string; reverted: boolean; current: boolean;
}
type LogRow = { id: string; created_at: string; actor_name: string; item_id: string; item_name: string; field: string; before_value: string; after_value: string; reverted_at: string };
const imageFields = (value: string) => value.startsWith("id:") ? { imageId: value.slice(3), imageUrl: "" } : value.startsWith("url:") ? { imageId: "", imageUrl: value.slice(4) } : { imageId: "", imageUrl: "" };
const imageSrc = (value: string) => { const f = imageFields(value); return f.imageId ? `/api/v2/tv?media=${f.imageId}` : f.imageUrl; };
const itemValue = (config: DmConfig, itemId: string, field: string) => {
  const item = config.items.find((entry) => entry.id === itemId);
  if (!item) return null;
  return field === "name" ? item.name : item.imageId ? `id:${item.imageId}` : item.imageUrl ? `url:${item.imageUrl}` : "";
};

export async function listMenuLog(db: D1Like, branchId: string, config: DmConfig, recipes: RecipePrice[], limit = 30): Promise<MenuLogEntry[]> {
  await ensureSchema(db);
  const result = await db.prepare("SELECT * FROM v2_digital_menu_log WHERE branch_id = ? ORDER BY created_at DESC LIMIT ?").bind(branchId, Math.max(1, Math.min(100, limit))).all<LogRow>();
  const now = snapshot(config);
  const price = new Map(recipes.map((recipe) => [recipe.id, recipe.price]));
  return (result.results || []).map((row) => {
    const field = (["name", "image", "config", "price"].includes(row.field) ? row.field : "config") as MenuLogEntry["field"];
    const current = field === "config" ? now === row.after_value
      : field === "price" ? price.get(row.item_id) === Number(row.after_value)
      : itemValue(config, row.item_id, field) === row.after_value;
    const summary = field === "price" ? `Narx (kassada ham): ${row.item_name} ${won(Number(row.before_value))} → ${won(Number(row.after_value))}`
      : field === "config" ? row.item_name : row.item_name;
    return {
      id: row.id, createdAt: row.created_at, actorName: row.actor_name, field, summary,
      before: field === "name" ? row.before_value : "", after: field === "name" ? row.after_value : "",
      beforeImage: field === "image" ? imageSrc(row.before_value) : "", afterImage: field === "image" ? imageSrc(row.after_value) : "",
      reverted: Boolean(row.reverted_at), current,
    };
  });
}

/** Jurnaldagi rasmlar — Monitor menyu tozalashda o'chirilmasin (qaytarish mumkin bo'lsin). */
export async function loggedMediaIds(db: D1Like, branchId: string): Promise<string[]> {
  await ensureSchema(db);
  const result = await db.prepare("SELECT field, before_value, after_value FROM v2_digital_menu_log WHERE branch_id = ? AND field IN ('image', 'config')").bind(branchId).all<{ field: string; before_value: string; after_value: string }>();
  const ids = new Set<string>();
  for (const row of result.results || []) {
    if (row.field === "image") { for (const value of [row.before_value, row.after_value]) if (value.startsWith("id:")) ids.add(value.slice(3)); continue; }
    for (const value of [row.before_value, row.after_value]) {
      try {
        const config = normalizeDm(JSON.parse(value));
        for (const id of [config.setOffer.imageId, config.promotion.imageId, ...config.items.map((item) => item.imageId), ...config.screens.map((screen) => screen.imageId)]) if (id) ids.add(id);
      } catch { /* buzilgan nusxa — o'tkazib yuboriladi */ }
    }
  }
  return [...ids];
}

/**
 * Rahbar xodim o'zgarishini qaytaradi — o'sha holat hali turgan bo'lsagina (keyin yana o'zgarmagan bo'lsa).
 * Narx — `revertPrice` orqali (HALO Control menyusiga, tarixga yoziladi). Yozuv «qaytarildi» deb belgilanadi.
 */
export async function revertMenuLog(db: D1Like, branchId: string, idInput: unknown, revertPrice: (recipeId: string, from: number, to: number) => Promise<void>, now = new Date()): Promise<void> {
  await ensureSchema(db);
  const id = clean(idInput, 80);
  const row = await db.prepare("SELECT * FROM v2_digital_menu_log WHERE id = ? AND branch_id = ?").bind(id, branchId).first<LogRow>();
  if (!row) throw new StaffMenuError("Yozuv topilmadi. Sahifani yangilang.", 404);
  if (row.reverted_at) throw new StaffMenuError("Bu o‘zgarish oldin qaytarilgan.", 409);
  if (row.field === "price") {
    await revertPrice(row.item_id, Number(row.after_value), Number(row.before_value));
  } else {
    const current = await readDm(db, branchId);
    let next: DmConfig;
    if (row.field === "config") {
      if (snapshot(current.config) !== row.after_value) throw new StaffMenuError("Menyu keyin yana o‘zgartirilgan. Avval oxirgi o‘zgarishni qaytaring.", 409);
      try { next = normalizeDm(JSON.parse(row.before_value)); } catch { throw new StaffMenuError("Oldingi nusxa o‘qilmadi.", 409); }
    } else {
      const value = itemValue(current.config, row.item_id, row.field);
      if (value === null) throw new StaffMenuError("Taom menyudan olib tashlangan — qaytarib bo‘lmaydi.", 409);
      if (value !== row.after_value) throw new StaffMenuError("Bu taom keyin yana o‘zgartirilgan. Avval oxirgi o‘zgarishni qaytaring.", 409);
      next = { ...current.config, items: current.config.items.map((item) => item.id !== row.item_id ? item
        : row.field === "name" ? { ...item, name: row.before_value } : { ...item, ...imageFields(row.before_value) }) };
    }
    if (!await writeIf(db, branchId, next, current, now)) throw new StaffMenuError("Menyu shu payt boshqa joyda o‘zgartirildi. Qayta urinib ko‘ring.", 409);
  }
  await db.prepare("UPDATE v2_digital_menu_log SET reverted_at = ? WHERE id = ?").bind(now.toISOString(), id).run();
}
