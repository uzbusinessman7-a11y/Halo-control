/**
 * V2 da yopilgan kunlar: kassa sanalib, kun yopilgach o'sha kunga (va undan oldingi kunlarga) pul
 * yozuvi kiritilmaydi — aks holda yopilgan kun qoldig'i o'zgarib ketadi. Tuzatish — ochiq kunga.
 */
declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

export const TENANT_ID = "halo";

export class ClosedDayError extends Error {
  status = 409;
}

/** Filialda V2 da yopilgan eng oxirgi kun ("" — hali yopilmagan). */
export async function v2ClosedThrough(branchId: string): Promise<string> {
  const db = globalThis.__HALO_CONTROL_DB__;
  if (!db || globalThis.__HALO_SELF_HOSTED__ !== true) return "";
  try {
    const row = await db.prepare("SELECT MAX(date) AS date FROM v2_day_closes WHERE tenant_id = ? AND branch_id = ?")
      .bind(TENANT_ID, branchId).first<{ date: string | null }>();
    return String(row?.date || "");
  } catch {
    return ""; // jadval hali yaratilmagan
  }
}

export async function assertV2DayOpen(branchId: string, dates: string | string[]): Promise<void> {
  const closed = await v2ClosedThrough(branchId);
  if (!closed) return;
  const list = (Array.isArray(dates) ? dates : [dates]).filter(Boolean);
  const bad = list.filter((date) => date <= closed).sort()[0];
  if (bad) throw new ClosedDayError(`${bad} kuni kassada yopilgan (${closed} gacha yopiq). Yozuvni ochiq kunga kiriting — yopilgan kun qoldig'i o'zgarmasligi kerak.`);
}
