/**
 * HALO CLUB (Telegram do'kon) → HALO Control: menyu sinxroni.
 * Do'kon o'z mahsulotlari ro'yxatini yuboradi va har biri uchun ko'rsatma oladi: narx (yoqilgan bo'lsa) va "tugadi" belgisi.
 * Faqat do'konning o'z kaliti bilan (Authorization: Bearer halo_club_…). Hech narsa savdo/ombor/kassaga yozilmaydi.
 */
import { readHaloState } from "../../../../../lib/halo-store";
import { writeIntegrationLog } from "../../../../../lib/integration-store";
import { authenticateClub, ClubError, syncClubCatalog } from "../../../../../core/club";
import { clubDb } from "../../../../../core/club-service";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
const ENDPOINT = "/api/integrations/v1/club/sync";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ ok: false, error: "Bu manzil faqat yangi saytda ishlaydi." }, 403);
  let branchId = "";
  try {
    const db = clubDb();
    branchId = await authenticateClub(db, request);
    if (!branchId) {
      await writeIntegrationLog({ endpoint: ENDPOINT, method: "POST", status: 401, message: "Do‘kon kaliti noto‘g‘ri" });
      return json({ ok: false, error: "Kalit noto‘g‘ri." }, 401);
    }
    const raw = await request.text();
    if (raw.length > 400_000) return json({ ok: false, error: "So‘rov juda katta." }, 413);
    const body = JSON.parse(raw || "{}") as unknown;
    const { state, updatedAt } = await readHaloState(branchId);
    const result = await syncClubCatalog(db, branchId, body, state as Record<string, unknown>);
    return json({ ok: true, updatedAt, ...result });
  } catch (error) {
    const status = error instanceof ClubError ? error.status : error instanceof SyntaxError ? 400 : 500;
    const message = error instanceof ClubError ? error.message : error instanceof SyntaxError ? "So‘rov JSON emas." : "Sinxron bajarilmadi.";
    await writeIntegrationLog({ branchId: branchId || undefined, endpoint: ENDPOINT, method: "POST", status, message });
    return json({ ok: false, error: message }, status);
  }
}
