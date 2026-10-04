import { ensureHaloState } from "../../../lib/halo-store";
import { getMedia, readDm, readRecipePrices, tvMemoGet, tvMemoSet, tvView } from "../../../core/digital-menu";
import { tvLook, tvPage, tvRender, tvRevision, TV_VERSION } from "../../../core/tv-page";
import type { D1Like } from "../../../lib/full-migration";

/**
 * HALO monitor menyusi — televizor uchun OCHIQ manzil (parolsiz, FAQAT O'QIYDI).
 *  - GET /api/v2/tv?screen=kebab                 → ekran sahifasi (qisqa manzillar: /menu?screen=kebab, /tv/kebab)
 *  - GET /api/v2/tv?data=1&screen=kebab&rev=…    → ekran uchun tayyor menyu; rev hozirgi nusxa bilan bir xil bo'lsa — faqat belgi va server vaqti
 *  - GET /api/v2/tv?menu=1&screen=kebab          → menyu ma'lumoti oddiy JSON ko'rinishida (taom, variant, narx, rasm manzili)
 *  - GET /api/v2/tv?media=<id>                   → taom rasmi
 * Boshqa filial: &b=<filial> yoki &branch=<filial>. Sayqallangan variant (ixtiyoriy): &look=premium — odatda asl ko'rinish.
 * Hech narsa yozmaydi; POST/PUT/DELETE yo'q. Tannarx, retsept, savdo va boshqa ichki ma'lumot bu yerdan chiqmaydi.
 * Javoblar keshlanmaydi (no-store) — narx o'zgarsa eski narx ushlanib qolmaydi. Faqat rasm doimiy keshlanadi (manzili o'zgarmas).
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
const NO_STORE = { "Cache-Control": "no-store" };
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", ...NO_STORE };

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("Monitor menyusi faqat yangi saytda.", { status: 403 });
  const url = new URL(request.url);
  try {
    const mediaId = url.searchParams.get("media");
    if (mediaId) {
      const file = await getMedia(database(), mediaId);
      if (!file) return new Response("Rasm topilmadi.", { status: 404, headers: NO_STORE });
      return new Response(file.bytes as unknown as BodyInit, { headers: { "Content-Type": file.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
    }
    const branchId = branchOf(url.searchParams.get("b") || url.searchParams.get("branch"));
    const screen = slug(url.searchParams.get("screen"));
    const look = tvLook(url.searchParams.get("look"));
    const wantsData = url.searchParams.get("data") === "1";
    const wantsMenu = url.searchParams.get("menu") === "1";
    if (!wantsData && !wantsMenu) {
      return new Response(tvPage({ screen, branch: branchId, look }), { headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
    }
    // Xotiradagi nusxa: {"data": ekran uchun tayyor menyu, "menu": oddiy ma'lumot}. Server vaqti har javobda yangi qo'yiladi.
    const key = `${branchId}:${screen}:${look}`;
    let memo = tvMemoGet(key);
    if (!memo) {
      await ensureHaloState();
      const recipes = await readRecipePrices(database(), branchId);
      if (!recipes) return Response.json({ ok: false, error: "Filial topilmadi." }, { status: 404, headers: NO_STORE });
      const { config, updatedAt } = await readDm(database(), branchId);
      const view = tvView(config, recipes, screen);
      const payload = tvRender(view, look);
      const revision = tvRevision(payload);
      memo = JSON.stringify({ revision, data: { ...payload, revision }, menu: { revision, updatedAt, ...view } });
      tvMemoSet(key, memo);
    }
    const saved = JSON.parse(memo) as { revision: string; data: Record<string, unknown>; menu: Record<string, unknown> };
    const head = { ok: true, v: TV_VERSION, serverTime: Date.now() };
    if (wantsMenu) return new Response(JSON.stringify({ ...head, ...saved.menu }), { headers: jsonHeaders });
    // Ekrandagi nusxa hozirgisi bilan bir xil — menyuni qayta yubormaymiz (ekran ham qayta chizmaydi).
    if (url.searchParams.get("rev") === saved.revision) return new Response(JSON.stringify({ ...head, revision: saved.revision }), { headers: jsonHeaders });
    return new Response(JSON.stringify({ ...head, ...saved.data }), { headers: jsonHeaders });
  } catch {
    return Response.json({ ok: false, error: "Xatolik yuz berdi." }, { status: 500, headers: NO_STORE });
  }
}
