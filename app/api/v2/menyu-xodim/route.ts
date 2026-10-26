import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import type { D1Like } from "../../../lib/full-migration";
import { canEditMenu } from "../../../core/menu-staff";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — xodim ilovasi: «🍽 Menyu» tugmasi ochiqmi (rahbar ruxsat berganmi).
 * Ruxsat bo'lsa, tugma «Monitor menyu» sahifasini xodim ko'rinishida ochadi (app/api/v2/monitor/route.ts).
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "Faqat yangi saytda." }, 403);
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return json({ error: "PIN bilan kiring.", login: true }, 401);
    if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
    const allowed = await canEditMenu(globalThis.__HALO_CONTROL_DB__ as unknown as D1Like, session.branchId, session.userId);
    return json({ ok: true, allowed, url: allowed ? "/api/v2/monitor" : "" });
  } catch (error) {
    console.error("[v2/menyu-xodim]", error);
    return json({ error: "Qayta urinib ko‘ring." }, 500);
  }
}
