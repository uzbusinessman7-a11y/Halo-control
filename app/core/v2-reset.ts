/**
 * To'liq o'tish kuni: yangi tizim jurnallarini (pul, ombor, qarz, maosh) toza boshlash.
 * Bu jurnallar eski ma'lumotdan ko'prik orqali QURILADI — yakuniy importdan keyin ular qaytadan,
 * sinov paytidagi yozuvlarsiz quriladi. Faqat parallel (sinov) rejimida ruxsat; o'tishdan keyin — hech qachon.
 * Oy yakuni sanog'i (v2_period_counts) saqlanadi — u haqiqiy sanoq.
 */
import { isParallelMode } from "../lib/cutover";
import type { D1Like } from "../lib/full-migration";

// Bolalar avval (tashqi kalitlar buzilmasin).
const ORDER = [
  "v2_ledger_lines", "v2_day_closes", "v2_cash_counts", "v2_ledger_entries", "v2_ledger_accounts",
  "v2_stock_moves", "v2_stock_items", "v2_party_moves", "v2_parties", "v2_pay_moves", "v2_employees",
];

export async function resetV2Journals(db: D1Like): Promise<string[]> {
  if (!await isParallelMode()) throw new Error("To'liq o'tishdan keyin jurnallarni o'chirib bo'lmaydi.");
  const existing = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'v2\\_%' ESCAPE '\\'")
    .all<{ name: string }>()).results.map((row) => row.name));
  const dropped: string[] = [];
  for (const name of ORDER) {
    if (!existing.has(name)) continue;
    await db.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
    dropped.push(name);
  }
  return dropped;
}

/** Noldan boshlashda: sinov paytidagi oy yakuni sanoqlari ham o'chadi (yangi oy — yangi sanoq). */
export async function clearPeriodCounts(db: D1Like): Promise<number> {
  if (!await isParallelMode()) throw new Error("To'liq o'tishdan keyin sanoqlarni o'chirib bo'lmaydi.");
  const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'v2_period_counts'").first<{ name: string }>();
  if (!exists) return 0;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM v2_period_counts").first<{ n: number }>();
  await db.prepare("DELETE FROM v2_period_counts").run();
  return Number(row?.n || 0);
}
