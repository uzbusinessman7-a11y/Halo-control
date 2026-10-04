/**
 * HALO CLUB (Telegram do'kon) → HALO Control: buyurtma hodisasi (yangi / qabul qilindi / tayyor / topshirildi / bekor).
 *  - yangi buyurtma → guruhga xabar (ulangan bo'lsa);
 *  - topshirildi → savdo, ombor va pul yozuvi (bir buyurtma bir marta; qoidalar app/core/club.ts da).
 * Faqat do'konning o'z kaliti bilan. Mijozning shaxsiy ma'lumoti qabul qilinmaydi va saqlanmaydi.
 * 503 — vaqtinchalik (do'kon keyinroq qayta yuboradi); 422 — buyurtma hisobi noto'g'ri (qayta yuborish foydasiz).
 */
import { writeIntegrationLog } from "../../../../../lib/integration-store";
import { authenticateClub, ClubError } from "../../../../../core/club";
import { clubDb, handleClubOrderEvent } from "../../../../../core/club-service";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
const ENDPOINT = "/api/integrations/v1/club/orders";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ ok: false, error: "Bu manzil faqat yangi saytda ishlaydi." }, 403);
  let branchId = "";
  let externalId = "";
  try {
    const settings = await authenticateClub(clubDb(), request);
    if (!settings) {
      await writeIntegrationLog({ endpoint: ENDPOINT, method: "POST", status: 401, message: "Do‘kon kaliti noto‘g‘ri" });
      return json({ ok: false, error: "Kalit noto‘g‘ri." }, 401);
    }
    branchId = settings.branchId;
    const raw = await request.text();
    if (raw.length > 100_000) return json({ ok: false, error: "So‘rov juda katta." }, 413);
    const body = JSON.parse(raw || "{}") as { order?: { id?: unknown } };
    externalId = String(body?.order?.id || "").slice(0, 80);
    const result = await handleClubOrderEvent(branchId, body, settings);
    await writeIntegrationLog({
      branchId, endpoint: ENDPOINT, method: "POST", status: 200, externalId,
      message: `#${result.order.number} · ${result.order.status}${result.sale.state ? ` · savdo: ${result.sale.state}` : ""}`,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof ClubError ? error.status : error instanceof SyntaxError ? 400 : 503;
    const message = error instanceof ClubError ? error.message : error instanceof SyntaxError ? "So‘rov JSON emas." : "Vaqtinchalik xatolik. Keyinroq qayta yuboriladi.";
    await writeIntegrationLog({ branchId: branchId || undefined, endpoint: ENDPOINT, method: "POST", status, externalId, message });
    return json({ ok: false, error: message, retry: status === 503 }, status);
  }
}
