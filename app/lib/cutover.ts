/**
 * Parallel ishlash rejimi: yangi saytda eski tizim ma'lumotlari faqat nusxa. To'liq o'tishga qadar
 * yangi sayt o'zidan avtomatik Telegram hisobot yubormaydi (aks holda eski nusxadan ikkinchi,
 * eskirgan hisobot boradi). O'tish kuni rahbar bayroqni yoqadi.
 */
declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const SQL = "CREATE TABLE IF NOT EXISTS halo_cutover (id TEXT PRIMARY KEY NOT NULL, completed_at TEXT NOT NULL, completed_by TEXT NOT NULL)";

export async function isParallelMode(): Promise<boolean> {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return false;
  const db = globalThis.__HALO_CONTROL_DB__;
  if (!db) return true;
  await db.prepare(SQL).run();
  const row = await db.prepare("SELECT completed_at FROM halo_cutover WHERE id = 'main'").first<{ completed_at: string }>();
  return !row;
}

export async function completeCutover(by: string, now = new Date()) {
  const db = globalThis.__HALO_CONTROL_DB__;
  if (!db) throw new Error("Baza ulanmagan.");
  await db.prepare(SQL).run();
  await db.prepare("INSERT OR IGNORE INTO halo_cutover (id, completed_at, completed_by) VALUES ('main', ?, ?)").bind(now.toISOString(), by.slice(0, 80)).run();
}

export async function cutoverStatus(): Promise<{ completed: boolean; completedAt: string | null; completedBy: string | null }> {
  const db = globalThis.__HALO_CONTROL_DB__;
  if (!db) return { completed: false, completedAt: null, completedBy: null };
  await db.prepare(SQL).run();
  const row = await db.prepare("SELECT completed_at, completed_by FROM halo_cutover WHERE id = 'main'").first<{ completed_at: string; completed_by: string }>();
  return { completed: Boolean(row), completedAt: row?.completed_at ?? null, completedBy: row?.completed_by ?? null };
}

/** Favqulodda holat uchun: parallel rejimga qaytish (yangi sayt yana avtomatik hisobot yubormaydi). */
export async function revertCutover() {
  const db = globalThis.__HALO_CONTROL_DB__;
  if (!db) throw new Error("Baza ulanmagan.");
  await db.prepare(SQL).run();
  await db.prepare("DELETE FROM halo_cutover WHERE id = 'main'").run();
}
