import { isAdminRequest } from "../../../lib/integration-store";
import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { readSettings, telegramCall } from "../../../lib/telegram-service";
import type { D1Like } from "../../../lib/full-migration";
import { listLowReports, LowStockError, markLowReport, resendLowReport, saveLowReport } from "../../../core/low-stock";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — «Kam qolgan» xabarlari.
 *  - Xodim (PIN bilan kirgan): `list` — bugun filialda yuborilganlar (takror yozmaslik uchun), `send` — yangi xabar.
 *  - Rahbar (`scope: "owner"`): `list` — oxirgi 7 kun, `done` — «✓ Olindi» / qaytarib ochish, `resend` — Telegramga qayta.
 * Xabarni HALO hisobot boti yuboradi (Ulanishlar → Telegram bot, hisobot boradigan chat). Bot tokeni javobda qaytmaydi.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function database(): D1Like {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
}

/** HALO boti orqali hisobot chatiga yuborish. Bot ulanmagan bo'lsa — yuborilmaydi, sababi qaytadi. */
async function sender() {
  const settings = await readSettings();
  return async (text: string) => {
    if (!settings.botToken || !settings.chatId) return { sent: false, reason: "HALO Telegram boti ulanmagan (Yana → Sozlash → Ulanishlar → Telegram bot)." };
    try {
      await telegramCall(settings.botToken, "sendMessage", { chat_id: settings.chatId, text, disable_web_page_preview: true });
      return { sent: true, reason: "" };
    } catch (error) {
      return { sent: false, reason: error instanceof Error ? error.message.slice(0, 160) : "Telegramga yuborilmadi." };
    }
  };
}
const branchName = async (branchId: string) => (await listHaloBranches()).find((branch) => branch.id === branchId)?.name || "HALO";

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "Faqat yangi saytda." }, 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "list");
    if (body.scope === "owner") {
      if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
      const branchId = String(body.branchId || "main");
      if (!(await listHaloBranches()).some((branch) => branch.id === branchId)) return json({ error: "Filial topilmadi." }, 400);
      if (action === "done") await markLowReport(database(), branchId, body.id, body.done !== false);
      else if (action === "resend") await resendLowReport(database(), branchId, await branchName(branchId), body.id, await sender());
      else if (action !== "list") return json({ error: "Noto‘g‘ri amal." }, 400);
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      return json({ ok: true, reports: await listLowReports(database(), branchId, since) });
    }
    const session = await authenticateWorkerRequest(request);
    if (!session) return json({ error: "PIN bilan kiring.", login: true }, 401);
    if (action === "send") {
      const { state } = await readHaloState(session.branchId);
      const out = await saveLowReport(database(), {
        branchId: session.branchId, branchName: await branchName(session.branchId), workerId: session.userId, workerName: session.name,
        operationId: body.operationId, items: body.items, state: state as Record<string, unknown>, send: await sender(),
      });
      return json({ ok: true, ...out });
    }
    if (action !== "list") return json({ error: "Noto‘g‘ri amal." }, 400);
    const since = new Date(`${seoulToday()}T00:00:00+09:00`).toISOString();
    return json({ ok: true, reports: (await listLowReports(database(), session.branchId, since, 30)).map((report) => ({ createdAt: report.createdAt, workerName: report.workerName, items: report.items.map((item) => item.name) })) });
  } catch (error) {
    if (error instanceof LowStockError) return json({ error: error.message }, error.status);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}
