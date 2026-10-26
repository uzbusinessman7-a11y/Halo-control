/**
 * HALO V2 — xodim «Menyu»: rahbar ruxsat bergan xodim «Monitor menyu»dagi taomning NOMI va RASMIni o'zgartiradi.
 *
 * - Narx, variant, tartib, ekran, yashirish, SET MENU — faqat rahbar (Monitor menyu). Narx hisobga bog'liq, xodim tegmaydi.
 * - Ruxsat alohida jadvalda (v2_worker_menu_access): rahbar Sozlamalar → Akkauntlar'da har xodimga belgilaydi.
 *   Eski xodim jadvaliga (halo_worker_users) ustun qo'shilmaydi.
 * - Har o'zgarish jurnalga yoziladi (v2_digital_menu_log): kim, qachon, qaysi taom, oldin → keyin.
 *   Rahbar Monitor menyuda ko'radi va bir bosishda qaytaradi. Almashtirilgan eski rasm jurnalda turguncha o'chirilmaydi.
 * - Rahbar bilan bir vaqtda saqlansa ustma-ust yozilmaydi: menyu nusxasi tekshiriladi, o'zgargan bo'lsa qayta o'qiladi.
 * - Hisobga (savdo, ombor, kassa, retsept narxi) hech narsa yozilmaydi — faqat ekrandagi menyu.
 */
import type { D1Like } from "../lib/full-migration";
import { DigitalMenuError, ensureDmSchema, normalizeDm, putMedia, readDm, type DmConfig } from "./digital-menu";

export class StaffMenuError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const clean = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max);
/** Jurnalda saqlanadigan yozuvlar soni (filial bo'yicha) — shulardagi eski rasmlar o'chirilmaydi. */
export const LOG_KEEP = 200;

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
  const rows = await db.prepare("SELECT worker_id FROM v2_worker_menu_access WHERE branch_id = ? AND allowed = 1").bind(branchId).all<{ worker_id: string }>();
  return (rows.results || []).map((row) => row.worker_id);
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

/* ---------- xodim ko'radigan ro'yxat ---------- */
export interface StaffMenuItem { id: string; name: string; screen: string; screenTitle: string; image: string; hidden: boolean }
export function staffMenuView(config: DmConfig): StaffMenuItem[] {
  const title = new Map(config.screens.map((screen) => [screen.id, screen.title]));
  const order = new Map(config.screens.map((screen, index) => [screen.id, index]));
  return config.items
    .map((item) => ({ id: item.id, name: item.name, screen: item.screen, screenTitle: title.get(item.screen) || item.screen, image: item.imageId ? `/api/v2/tv?media=${item.imageId}` : item.imageUrl, hidden: !item.visible }))
    .sort((left, right) => (order.get(left.screen) ?? 99) - (order.get(right.screen) ?? 99));
}

/* ---------- o'zgartirish (sof funksiyalar) ---------- */
export type StaffField = "name" | "image";
export interface StaffChange { itemId: string; itemName: string; field: StaffField; before: string; after: string }

export function renameItem(config: DmConfig, idInput: unknown, nameInput: unknown): { config: DmConfig; change: StaffChange | null } {
  const id = clean(idInput, 80);
  const item = config.items.find((entry) => entry.id === id);
  if (!item) throw new StaffMenuError("Taom topilmadi. Sahifani yangilang.", 404);
  const name = clean(nameInput, 60);
  if (name.length < 2) throw new StaffMenuError("Taom nomini yozing (kamida 2 harf).");
  if (name === item.name) return { config, change: null };
  return {
    config: { ...config, items: config.items.map((entry) => entry.id === id ? { ...entry, name } : entry) },
    change: { itemId: id, itemName: item.name, field: "name", before: item.name, after: name },
  };
}

export function setItemImage(config: DmConfig, idInput: unknown, imageId: string): { config: DmConfig; change: StaffChange } {
  const id = clean(idInput, 80);
  const item = config.items.find((entry) => entry.id === id);
  if (!item) throw new StaffMenuError("Taom topilmadi. Sahifani yangilang.", 404);
  const before = item.imageId ? `id:${item.imageId}` : item.imageUrl ? `url:${item.imageUrl}` : "";
  return {
    config: { ...config, items: config.items.map((entry) => entry.id === id ? { ...entry, imageId, imageUrl: "" } : entry) },
    change: { itemId: id, itemName: item.name, field: "image", before, after: `id:${imageId}` },
  };
}

/** Jurnaldagi rasm qiymati («id:…» yoki «url:…») → menyudagi maydonlar va ko'rsatiladigan manzil. */
const imageFields = (value: string) => value.startsWith("id:") ? { imageId: value.slice(3), imageUrl: "" } : value.startsWith("url:") ? { imageId: "", imageUrl: value.slice(4) } : { imageId: "", imageUrl: "" };
export const imageSrc = (value: string) => { const f = imageFields(value); return f.imageId ? `/api/v2/tv?media=${f.imageId}` : f.imageUrl; };

/* ---------- saqlash: nusxa tekshiriladi + jurnal ---------- */
async function writeIf(db: D1Like, branchId: string, config: DmConfig, expected: { saved: boolean; updatedAt: string }, now: Date) {
  const payload = JSON.stringify(normalizeDm(config));
  const at = now.toISOString();
  const result: { meta?: { changes?: number } } = expected.saved
    ? await db.prepare("UPDATE v2_digital_menu SET payload = ?, updated_at = ? WHERE branch_id = ? AND updated_at = ?").bind(payload, at, branchId, expected.updatedAt).run() as { meta?: { changes?: number } }
    : await db.prepare("INSERT OR IGNORE INTO v2_digital_menu (branch_id, payload, updated_at) VALUES (?, ?, ?)").bind(branchId, payload, at).run() as { meta?: { changes?: number } };
  return Number(result.meta?.changes || 0) === 1;
}

export interface Actor { id: string; name: string }
/**
 * Menyuni o'zgartirib saqlaydi va jurnalga yozadi. Boshqa joyda (rahbar) shu payt saqlangan bo'lsa — yangi nusxa
 * o'qilib, o'zgarish qayta qo'llanadi (3 marta). O'zgarish bo'lmasa (nom o'sha) — hech narsa yozilmaydi.
 */
export async function saveStaffChange(db: D1Like, branchId: string, actor: Actor, apply: (config: DmConfig) => { config: DmConfig; change: StaffChange | null }, now = new Date()) {
  await ensureSchema(db);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readDm(db, branchId);
    const out = apply(current.config);
    if (!out.change) return { config: current.config, change: null };
    if (!await writeIf(db, branchId, out.config, current, now)) continue;
    await db.prepare(`INSERT INTO v2_digital_menu_log (id, branch_id, created_at, actor_id, actor_name, item_id, item_name, field, before_value, after_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(`ml-${crypto.randomUUID()}`, branchId, now.toISOString(), clean(actor.id, 80), clean(actor.name, 60),
      out.change.itemId, clean(out.change.itemName, 60), out.change.field, out.change.before.slice(0, 600), out.change.after.slice(0, 600)).run();
    await db.prepare(`DELETE FROM v2_digital_menu_log WHERE branch_id = ? AND id NOT IN (SELECT id FROM v2_digital_menu_log WHERE branch_id = ? ORDER BY created_at DESC LIMIT ${LOG_KEEP})`)
      .bind(branchId, branchId).run();
    return { config: normalizeDm(out.config), change: out.change };
  }
  throw new StaffMenuError("Menyu shu payt boshqa joyda o‘zgartirildi. Qayta urinib ko‘ring.", 409);
}

/** Xodim rasmi: yuklash va taomga qo'yish bitta amalda (yuklangan, lekin qo'yilmagan rasm qolmaydi). */
export async function replaceImage(db: D1Like, branchId: string, actor: Actor, itemId: unknown, mime: unknown, data: unknown, now = new Date()) {
  const current = await readDm(db, branchId);
  if (!current.config.items.some((item) => item.id === clean(itemId, 80))) throw new StaffMenuError("Taom topilmadi. Sahifani yangilang.", 404);
  const imageId = await putMedia(db, branchId, mime, data, now);
  try {
    return await saveStaffChange(db, branchId, actor, (config) => setItemImage(config, itemId, imageId), now);
  } catch (error) {
    await db.prepare("DELETE FROM v2_digital_menu_media WHERE id = ? AND branch_id = ?").bind(imageId, branchId).run().catch(() => undefined);
    throw error;
  }
}

/* ---------- rahbar: jurnal va qaytarish ---------- */
export interface MenuLogEntry {
  id: string; createdAt: string; actorName: string; itemId: string; itemName: string; field: StaffField;
  before: string; after: string; beforeImage: string; afterImage: string; reverted: boolean; current: boolean;
}
type LogRow = { id: string; created_at: string; actor_name: string; item_id: string; item_name: string; field: string; before_value: string; after_value: string; reverted_at: string };

const valueNow = (config: DmConfig, itemId: string, field: string) => {
  const item = config.items.find((entry) => entry.id === itemId);
  if (!item) return null;
  return field === "name" ? item.name : item.imageId ? `id:${item.imageId}` : item.imageUrl ? `url:${item.imageUrl}` : "";
};

export async function listMenuLog(db: D1Like, branchId: string, config: DmConfig, limit = 30): Promise<MenuLogEntry[]> {
  await ensureSchema(db);
  const rows = (await db.prepare("SELECT * FROM v2_digital_menu_log WHERE branch_id = ? ORDER BY created_at DESC LIMIT ?").bind(branchId, Math.max(1, Math.min(100, limit))).all<LogRow>()).results || [];
  return rows.map((row) => ({
    id: row.id, createdAt: row.created_at, actorName: row.actor_name, itemId: row.item_id, itemName: row.item_name, field: row.field === "image" ? "image" : "name",
    before: row.before_value, after: row.after_value,
    beforeImage: row.field === "image" ? imageSrc(row.before_value) : "", afterImage: row.field === "image" ? imageSrc(row.after_value) : "",
    reverted: Boolean(row.reverted_at), current: valueNow(config, row.item_id, row.field) === row.after_value,
  }));
}

/** Jurnaldagi rasmlar (oldingi va keyingi) — Monitor menyu tozalashda o'chirilmasin (qaytarish mumkin bo'lsin). */
export async function loggedMediaIds(db: D1Like, branchId: string): Promise<string[]> {
  await ensureSchema(db);
  const rows = (await db.prepare("SELECT before_value, after_value FROM v2_digital_menu_log WHERE branch_id = ? AND field = 'image'").bind(branchId).all<{ before_value: string; after_value: string }>()).results || [];
  return rows.flatMap((row) => [row.before_value, row.after_value]).filter((value) => value.startsWith("id:")).map((value) => value.slice(3));
}

/**
 * Rahbar xodim o'zgarishini qaytaradi: taom o'sha qiymatda turgan bo'lsagina (keyin yana o'zgarmagan bo'lsa).
 * Qaytarish ham menyu nusxasini tekshirib yoziladi; yozuv «qaytarildi» deb belgilanadi (o'chirilmaydi).
 */
export async function revertMenuLog(db: D1Like, branchId: string, idInput: unknown, now = new Date()): Promise<DmConfig> {
  await ensureSchema(db);
  const id = clean(idInput, 80);
  const row = await db.prepare("SELECT * FROM v2_digital_menu_log WHERE id = ? AND branch_id = ?").bind(id, branchId).first<LogRow>();
  if (!row) throw new StaffMenuError("Yozuv topilmadi. Sahifani yangilang.", 404);
  if (row.reverted_at) throw new StaffMenuError("Bu o‘zgarish oldin qaytarilgan.", 409);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readDm(db, branchId);
    const now0 = valueNow(current.config, row.item_id, row.field);
    if (now0 === null) throw new StaffMenuError("Taom menyudan olib tashlangan — qaytarib bo‘lmaydi.", 409);
    if (now0 !== row.after_value) throw new StaffMenuError("Bu taom keyin yana o‘zgartirilgan. Avval oxirgi o‘zgarishni qaytaring.", 409);
    if (row.field === "image" && row.before_value.startsWith("id:")) {
      const media = await db.prepare("SELECT id FROM v2_digital_menu_media WHERE id = ? AND branch_id = ?").bind(row.before_value.slice(3), branchId).first<{ id: string }>();
      if (!media) throw new StaffMenuError("Oldingi rasm saqlanmagan — qaytarib bo‘lmaydi.", 409);
    }
    const next: DmConfig = { ...current.config, items: current.config.items.map((item) => item.id !== row.item_id ? item
      : row.field === "name" ? { ...item, name: row.before_value } : { ...item, ...imageFields(row.before_value) }) };
    if (!await writeIf(db, branchId, next, current, now)) continue;
    await db.prepare("UPDATE v2_digital_menu_log SET reverted_at = ? WHERE id = ?").bind(now.toISOString(), id).run();
    return normalizeDm(next);
  }
  throw new StaffMenuError("Menyu shu payt boshqa joyda o‘zgartirildi. Qayta urinib ko‘ring.", 409);
}

export { DigitalMenuError };
