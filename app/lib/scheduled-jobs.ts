/**
 * Cloudflare cron (har 10 daqiqada) — faqat yangi saytda va to'liq o'tishdan KEYIN ishlaydi.
 *  1. Eski uslubdagi kunlik hisobot (belgilangan vaqtda, bir kunda bir marta).
 *  2. U yuborilgan zahoti — V2 qisqa "flash" hisobot (prime cost, pul, qarz, ogohlantirishlar).
 * Parallel rejimda hech narsa yubormaydi (hisobotlar eski saytdan keladi).
 */
import { isParallelMode } from "./cutover";
import { dispatchScheduledDailyReport } from "./telegram-scheduler";
import { listHaloBranches, readHaloState } from "./halo-store";
import { readSettings, telegramCall } from "./telegram-service";
import { flashText, homeReport } from "../core/home";
import type { D1Like } from "./full-migration";

const seoulToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export async function runScheduledJobs(now = new Date()) {
  if (await isParallelMode()) return { skipped: "parallel-mode" as const, branches: [] };
  const results: Array<Record<string, unknown>> = [];
  for (const branch of await listHaloBranches()) {
    try {
      const result = await dispatchScheduledDailyReport(branch.id, now) as Record<string, unknown>;
      let flash = false;
      if (result.sentAt) flash = await sendFlash(branch.id, branch.name, now);
      results.push({ branchId: branch.id, ...result, flash });
    } catch (error) {
      results.push({ branchId: branch.id, ok: false, error: error instanceof Error ? error.message : "xato" });
    }
  }
  return { skipped: null, branches: results };
}

async function sendFlash(branchId: string, name: string, now: Date): Promise<boolean> {
  try {
    const settings = await readSettings();
    if (!settings.botToken || !settings.chatId) return false;
    const { state } = await readHaloState(branchId);
    const db = globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
    const report = await homeReport(db, { tenantId: "halo", branchId }, state as Record<string, unknown>, seoulToday(now), now);
    await telegramCall(settings.botToken, "sendMessage", { chat_id: settings.chatId, text: flashText(report, `HALO ${name}`), disable_web_page_preview: true });
    return true;
  } catch {
    return false;
  }
}
