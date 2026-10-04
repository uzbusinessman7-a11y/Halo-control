import { dispatchVegetableNotification } from '../../../../lib/vegetable-notifications';
import { dispatchScheduledDailyReport } from '../../../../lib/telegram-scheduler';
import {
  authenticateApiKey,
  writeIntegrationLog,
} from "../../../../lib/integration-store";
import { readHaloRevision, readHaloState } from "../../../../lib/halo-store";
import {
  buildGoogleSheetsExport,
  GOOGLE_SHEETS_EXPORT_VERSION,
  googleSheetsDateRangeDays,
} from "../../../../lib/google-sheets-export";
import { seoulBusinessDate } from "../../../../lib/business-time";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

function daysBefore(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const key = await authenticateApiKey(request, "reports:read");
  const endpoint = "/api/integrations/v1/google-sheets";
  if (!key) {
    await writeIntegrationLog({ endpoint, method: "GET", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const today = seoulBusinessDate();
    const to = url.searchParams.get("to") || today;
    const from = url.searchParams.get("from") || daysBefore(to, 30);
    const rangeDays = googleSheetsDateRangeDays(from, to);
    if (!rangeDays || rangeDays > 366) {
      return Response.json({ ok: false, error: "from va to haqiqiy sana bo‘lsin; davr 366 kundan oshmasin." }, { status: 400 });
    }
    const ifUpdatedAt = url.searchParams.get("if_updated_at") || "";
    const ifExportVersion = url.searchParams.get("if_export_version") || "";
    const unchanged = (updatedAt: string) => Response.json({
      ok: true,
      unchanged: true,
      branchId: key.branchId,
      updatedAt,
      exportVersion: GOOGLE_SHEETS_EXPORT_VERSION,
      from,
      to,
    }, { headers: { "Cache-Control": "no-store" } });
    if (globalThis.__HALO_SELF_HOSTED__ === true) {
      // O'z Cloudflare akkauntida: avtomatik xabarlar cron orqali yuboriladi (scheduled-jobs.ts),
      // jadval esa har daqiqada so'raydi. Ma'lumot o'zgarmagan bo'lsa, butun bazani o'qimasdan javob beramiz.
      if (ifUpdatedAt && ifExportVersion === GOOGLE_SHEETS_EXPORT_VERSION) {
        const revision = await readHaloRevision(key.branchId);
        if (revision === ifUpdatedAt) return unchanged(revision);
      }
    } else {
      // The authenticated Apps Script minute trigger also delivers the fixed weekly report.
      // Telegram failure never prevents a spreadsheet export.
      try { await dispatchVegetableNotification(key.branchId, new Date(), true); } catch { /* retried by the next scheduled sync */ }
      try { await dispatchScheduledDailyReport(key.branchId); } catch { /* Notification errors never prevent an export. */ }
    }
    const current = await readHaloState(key.branchId);
    if (
      ifUpdatedAt
      && ifUpdatedAt === current.updatedAt
      && ifExportVersion === GOOGLE_SHEETS_EXPORT_VERSION
    ) {
      return unchanged(current.updatedAt);
    }
    let exported: ReturnType<typeof buildGoogleSheetsExport>;
    try {
      exported = buildGoogleSheetsExport(current.state, from, to);
    } catch (error) {
      // Hisobot o'zi rad etgan holat (masalan, yozuvlardan biri noto'g'ri): sabab jadvalda va jurnalda ko'rinsin.
      const reason = error instanceof Error ? error.message.slice(0, 300) : "";
      await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 500, message: `Google Sheets hisoboti ochilmadi${reason ? `: ${reason}` : ""}` });
      return Response.json({ ok: false, error: `Google Sheets hisoboti ochilmadi.${reason ? ` Sabab: ${reason}` : ""}` }, { status: 500 });
    }
    await writeIntegrationLog({
      branchId: key.branchId,
      keyId: key.id,
      endpoint,
      method: "GET",
      status: 200,
      message: `${from} — ${to} Google Sheets hisoboti`,
    });
    return Response.json({
      ok: true,
      branchId: key.branchId,
      updatedAt: current.updatedAt,
      ...exported,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 500, message: `Google Sheets hisoboti ochilmadi (${error instanceof Error ? error.name : "xato"})` });
    return Response.json({ ok: false, error: "Google Sheets hisoboti ochilmadi." }, { status: 500 });
  }
}
