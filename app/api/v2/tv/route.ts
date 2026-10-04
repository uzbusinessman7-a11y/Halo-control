import { ensureHaloState } from "../../../lib/halo-store";
import { getMedia, readDm, readRecipePrices, tvMemoGet, tvMemoSet, tvView } from "../../../core/digital-menu";
import { tvPage, TV_VERSION } from "../../../core/tv-page";
import type { D1Like } from "../../../lib/full-migration";

/**
 * HALO monitor menyusi — televizor uchun OCHIQ manzil (parolsiz, faqat o'qiydi).
 *  - GET /api/v2/tv?screen=kebab            → ekran sahifasi (qisqa manzil: /tv/kebab; &d=kino — ko'rinishni sinab ko'rish)
 *  - GET /api/v2/tv?data=1&screen=kebab     → ekran ma'lumoti (nom, tavsif, narx, rasm manzili)
 *  - GET /api/v2/tv?media=<id>              → taom rasmi
 * Hech narsa yozmaydi. Tannarx, retsept, savdo va boshqa ichki ma'lumot bu yerdan chiqmaydi.
 */
declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
const database = () => {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
};
const slug = (value: string | null) => String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
const branchOf = (value: string | null) => (/^[a-z0-9][a-z0-9_-]{0,79}$/.test(String(value || "")) ? String(value) : "main");

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("Monitor menyusi faqat yangi saytda.", { status: 403 });
  const url = new URL(request.url);
  try {
    const mediaId = url.searchParams.get("media");
    if (mediaId) {
      const file = await getMedia(database(), mediaId);
      if (!file) return new Response("Rasm topilmadi.", { status: 404, headers: { "Cache-Control": "no-store" } });
      return new Response(file.bytes as unknown as BodyInit, { headers: { "Content-Type": file.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
    }
    const branchId = branchOf(url.searchParams.get("b"));
    const screen = slug(url.searchParams.get("screen"));
    if (url.searchParams.get("data") !== "1") {
      return new Response(tvPage({ screen, branch: branchId, design: slug(url.searchParams.get("d")) }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    const key = `${branchId}:${screen}`;
    let body = tvMemoGet(key);
    if (!body) {
      await ensureHaloState();
      const recipes = await readRecipePrices(database(), branchId);
      if (!recipes) return Response.json({ ok: false, error: "Filial topilmadi." }, { status: 404, headers: { "Cache-Control": "no-store" } });
      const { config } = await readDm(database(), branchId);
      body = JSON.stringify({ ok: true, v: TV_VERSION, ...tvView(config, recipes, screen) });
      tvMemoSet(key, body);
    }
    return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Xatolik yuz berdi." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
