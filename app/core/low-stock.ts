/**
 * HALO V2 — «Kam qolgan»: xodim tugayotgan mahsulotlarni telefonidan yuboradi, xabar HALO Telegram botiga boradi.
 *
 * - Xodim ombor ro'yxatidan tanlaydi (nomi serverda ombordan olinadi) yoki ro'yxatda yo'q narsani yozadi;
 *   har biriga ixtiyoriy izoh («2 quti», «deyarli tugadi»).
 * - Xabarni HALO hisobot boti yuboradi, hisobot boradigan chatga (Ulanishlar → Telegram bot).
 *   Bot ulanmagan yoki Telegram javob bermasa ham yozuv saqlanadi va sababi yoziladi — rahbar Ombor sahifasida ko'radi.
 * - Hisobga (pul, ombor qoldig'i) hech narsa yozilmaydi — bu faqat xabar.
 * - Bir amal raqami — bitta yozuv: tugma ikki marta bosilsa ham bir marta saqlanadi va bir marta yuboriladi.
 * Yozuvlar `v2_low_reports` jadvalida (eski saytdan ma'lumot ko'chirilganda tegilmaydi).
 */
import type { D1Like } from "../lib/full-migration";

type Row = Record<string, unknown>;
export class LowStockError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const MAX_ITEMS = 40;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export interface LowItem { inventoryId: string; name: string; note: string }
export interface LowReport {
  id: string; branchId: string; createdAt: string; workerName: string; items: LowItem[];
  telegram: { sent: boolean; reason: string }; doneAt: string; doneBy: string;
}

const ready = new WeakSet<object>();
async function ensureSchema(db: D1Like) {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS v2_low_reports (
    id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, created_at TEXT NOT NULL, worker_id TEXT NOT NULL DEFAULT '',
    worker_name TEXT NOT NULL DEFAULT '', items TEXT NOT NULL, telegram_sent INTEGER NOT NULL DEFAULT 0,
    telegram_reason TEXT NOT NULL DEFAULT '', done_at TEXT NOT NULL DEFAULT '', done_by TEXT NOT NULL DEFAULT '')`).run();
  ready.add(db);
}

/** Xodim yuborgan ro'yxatni tekshiradi: ombordagi mahsulot nomi serverdan olinadi; takrorlar birlashtiriladi. */
export function cleanItems(state: Row, input: unknown): LowItem[] {
  const inventory = new Map(rows(state.inventory)
    .filter((item) => typeof item.id === "string" && item.id && item.catalogArchived !== true)
    .map((item) => [String(item.id), clean(item.name || item.id, 80)]));
  const list = rows(input);
  if (!list.length) throw new LowStockError("Kamida bitta mahsulotni tanlang.");
  if (list.length > MAX_ITEMS) throw new LowStockError(`Bir martada ko'pi bilan ${MAX_ITEMS} ta.`);
  const out: LowItem[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const inventoryId = clean(item.inventoryId, 100);
    const note = clean(item.note, 60);
    let name = "";
    if (inventoryId) {
      name = inventory.get(inventoryId) || "";
      if (!name) throw new LowStockError("Mahsulot topilmadi. Sahifani yangilang.", 404);
    } else {
      name = clean(item.name, 60);
      if (name.length < 2) throw new LowStockError("Ro'yxatda yo'q mahsulot nomini yozing (kamida 2 harf).");
    }
    const key = inventoryId || `t:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ inventoryId, name, note });
  }
  return out;
}

const seoulTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
  .format(new Date(iso)).replace(",", "").replace("/", ".");

/** Telegram xabari matni (oddiy matn — maxsus belgilar buzilmaydi). */
export function lowMessage(branchName: string, workerName: string, createdAt: string, items: LowItem[]) {
  return [
    `🛒 Kam qolgan — ${branchName}`,
    `👤 ${workerName || "Xodim"} · ${seoulTime(createdAt)}`,
    "",
    ...items.map((item) => `• ${item.name}${item.note ? ` — ${item.note}` : ""}${item.inventoryId ? "" : " (ro'yxatda yo'q)"}`),
    "",
    `Jami: ${items.length} ta · HALO Control → Ombor`,
  ].join("\n");
}

type Send = (text: string) => Promise<{ sent: boolean; reason: string }>;

/**
 * Yozuvni saqlaydi va Telegramga yuboradi. Avval yozuv saqlanadi (xabar yo'qolmasin), keyin yuboriladi va natija yoziladi.
 * Shu amal raqami bilan yozuv bor bo'lsa — qayta saqlanmaydi va qayta yuborilmaydi.
 */
export async function saveLowReport(db: D1Like, input: {
  branchId: string; branchName: string; workerId: string; workerName: string; operationId: unknown; items: unknown; state: Row; now?: Date; send: Send;
}): Promise<{ report: LowReport; alreadySaved: boolean }> {
  await ensureSchema(db);
  const op = clean(input.operationId, 36);
  if (!/^[a-f0-9-]{36}$/.test(op)) throw new LowStockError("Oynani yangilang.");
  const id = `low:${op}`;
  const existing = await readReport(db, id);
  if (existing) return { report: existing, alreadySaved: true };
  const items = cleanItems(input.state, input.items);
  const createdAt = (input.now || new Date()).toISOString();
  await db.prepare(`INSERT OR IGNORE INTO v2_low_reports (id, branch_id, created_at, worker_id, worker_name, items, telegram_sent, telegram_reason)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'Yuborilmoqda')`).bind(id, input.branchId, createdAt, clean(input.workerId, 100), clean(input.workerName, 60), JSON.stringify(items)).run();
  let result = { sent: false, reason: "Telegramga yuborilmadi." };
  try { result = await input.send(lowMessage(input.branchName, input.workerName, createdAt, items)); } catch { /* sababi pastda yoziladi */ }
  await db.prepare("UPDATE v2_low_reports SET telegram_sent = ?, telegram_reason = ? WHERE id = ?")
    .bind(result.sent ? 1 : 0, result.sent ? "" : clean(result.reason || "Telegramga yuborilmadi.", 200), id).run();
  return { report: (await readReport(db, id))!, alreadySaved: false };
}

type ReportRow = { id: string; branch_id: string; created_at: string; worker_name: string; items: string; telegram_sent: number; telegram_reason: string; done_at: string; done_by: string };
function fromRow(row: ReportRow): LowReport {
  let items: LowItem[] = [];
  try { items = rows(JSON.parse(row.items)).map((item) => ({ inventoryId: clean(item.inventoryId, 100), name: clean(item.name, 80), note: clean(item.note, 60) })); } catch { items = []; }
  return {
    id: row.id, branchId: row.branch_id, createdAt: row.created_at, workerName: row.worker_name, items,
    telegram: { sent: Boolean(row.telegram_sent), reason: row.telegram_reason || "" }, doneAt: row.done_at || "", doneBy: row.done_by || "",
  };
}
async function readReport(db: D1Like, id: string) {
  const row = await db.prepare("SELECT * FROM v2_low_reports WHERE id = ?").bind(id).first<ReportRow>();
  return row ? fromRow(row) : null;
}

/** Filialning oxirgi yozuvlari (eng yangisi birinchi). `since` — ISO vaqt. */
export async function listLowReports(db: D1Like, branchId: string, since: string, limit = 60): Promise<LowReport[]> {
  await ensureSchema(db);
  const result = await db.prepare("SELECT * FROM v2_low_reports WHERE branch_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?")
    .bind(branchId, since, Math.max(1, Math.min(200, limit))).all<ReportRow>();
  return (result.results || []).map(fromRow);
}

/** Rahbar: «✓ Olindi» (yoki qaytarib ochish). Yozuv o'chirilmaydi. */
export async function markLowReport(db: D1Like, branchId: string, idInput: unknown, done: boolean, by = "Rahbar", now = new Date()) {
  await ensureSchema(db);
  const id = clean(idInput, 60);
  const report = await readReport(db, id);
  if (!report || report.branchId !== branchId) throw new LowStockError("Yozuv topilmadi. Sahifani yangilang.", 404);
  await db.prepare("UPDATE v2_low_reports SET done_at = ?, done_by = ? WHERE id = ?").bind(done ? now.toISOString() : "", done ? clean(by, 60) : "", id).run();
  return (await readReport(db, id))!;
}

/** Yuborilmagan yozuvni qayta yuborish (masalan, bot keyin ulangan bo'lsa). Yuborilgani qayta ketmaydi. */
export async function resendLowReport(db: D1Like, branchId: string, branchName: string, idInput: unknown, send: Send) {
  await ensureSchema(db);
  const report = await readReport(db, clean(idInput, 60));
  if (!report || report.branchId !== branchId) throw new LowStockError("Yozuv topilmadi. Sahifani yangilang.", 404);
  if (report.telegram.sent) return report;
  let result = { sent: false, reason: "Telegramga yuborilmadi." };
  try { result = await send(lowMessage(branchName, report.workerName, report.createdAt, report.items)); } catch { /* pastda */ }
  await db.prepare("UPDATE v2_low_reports SET telegram_sent = ?, telegram_reason = ? WHERE id = ?")
    .bind(result.sent ? 1 : 0, result.sent ? "" : clean(result.reason || "Telegramga yuborilmadi.", 200), report.id).run();
  return (await readReport(db, report.id))!;
}
