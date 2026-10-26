import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import type { D1Like } from "../../../lib/full-migration";
import { DigitalMenuError, readDm, tvMemoClear } from "../../../core/digital-menu";
import { canEditMenu, renameItem, replaceImage, saveStaffChange, StaffMenuError, staffMenuView } from "../../../core/menu-staff";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — xodim ilovasidagi «🍽 Menyu» (PIN bilan kirgan xodim).
 *  - `access` — rahbar ruxsat berganmi (tugma ochiq/yopiq ko'rinishi uchun).
 *  - `list`   — Monitor menyudagi taomlar: nomi, rasmi, qaysi ekranda.
 *  - `rename` — taom nomini o'zgartirish; `photo` — rasmni almashtirish (brauzerda kichraytirilgan JPG).
 * Narx, variant, tartib va ekran — faqat rahbar (Monitor menyu). Har o'zgarish jurnalga yoziladi, rahbar qaytara oladi.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function database(): D1Like {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "Faqat yangi saytda." }, 403);
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return json({ error: "PIN bilan kiring.", login: true }, 401);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "list");
    const db = database();
    const allowed = await canEditMenu(db, session.branchId, session.userId);
    if (action === "access") return json({ ok: true, allowed });
    if (!allowed) return json({ error: "Menyuni o‘zgartirishga rahbar ruxsat bermagan.", allowed: false }, 403);
    const actor = { id: session.userId, name: session.name };
    if (action === "rename") {
      const out = await saveStaffChange(db, session.branchId, actor, (config) => renameItem(config, body.id, body.name));
      if (out.change) tvMemoClear();
      return json({ ok: true, changed: Boolean(out.change), items: staffMenuView(out.config) });
    }
    if (action === "photo") {
      const out = await replaceImage(db, session.branchId, actor, body.id, body.mime, body.data);
      tvMemoClear();
      return json({ ok: true, changed: true, items: staffMenuView(out.config) });
    }
    if (action !== "list") return json({ error: "Noto‘g‘ri amal." }, 400);
    const { config } = await readDm(db, session.branchId);
    return json({ ok: true, allowed, items: staffMenuView(config) });
  } catch (error) {
    if (error instanceof StaffMenuError || error instanceof DigitalMenuError) return json({ error: error.message }, error.status);
    console.error("[v2/menyu-xodim]", error);
    return json({ error: "Saqlanmadi. Qayta urinib ko‘ring." }, 500);
  }
}
