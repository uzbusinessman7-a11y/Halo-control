import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { assignCategory, autoAssignCategories, CategoryError, categoryList, deleteCategory, moveCategory, saveCategory } from "../../../core/categories";

/**
 * HALO V2 — kategoriyalarni boshqarish (ombor mahsulotlari va menyu taomlari): qo'shish, nomlash, tartib,
 * o'chirish, mahsulotni kategoriyaga o'tkazish va nomga qarab avtomatik taqsimlash. Faqat rahbar.
 */
declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
type Row = Record<string, unknown>;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Row;
    const branchId = String(body.branchId || "main");
    const kind = body.kind === "recipe" ? "recipe" : body.kind === "inventory" ? "inventory" : null;
    if (!kind) return json({ error: "Kategoriya turi noto‘g‘ri." }, 400);
    const actions: Record<string, [(state: Row) => { state: Row; result: unknown }, string]> = {
      save: [(state) => saveCategory(state, body), `Kategoriya saqlandi: ${String(body.name || "").slice(0, 60)}`],
      delete: [(state) => deleteCategory(state, body), "Kategoriya o‘chirildi"],
      move: [(state) => moveCategory(state, body), "Kategoriyalar tartibi o‘zgardi"],
      assign: [(state) => assignCategory(state, body), "Kategoriya belgilandi"],
      auto: [(state) => autoAssignCategories(state, body), "Kategoriyalar avtomatik taqsimlandi"],
    };
    const action = actions[String(body.action || "")];
    if (action) {
      const mutation = await mutateHaloState((state) => { const out = action[0](state as Row); return { state: out.state, result: out.result }; }, 5, branchId, "Rahbar", action[1], kind === "recipe" ? "Menyu (yangi)" : "Ombor (yangi)");
      return json({ ok: true, result: mutation.result, categories: categoryList(mutation.state as Row, kind) });
    }
    const { state } = await readHaloState(branchId);
    return json({ ok: true, categories: categoryList(state as Row, kind) });
  } catch (error) {
    if (error instanceof CategoryError) return json({ error: error.message }, error.status);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}
