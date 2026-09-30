import { isAdminRequest } from "../../../lib/integration-store";
import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { seoulBusinessDate } from "../../../lib/business-time";
import { applyPosImport, MAX_POS_FILE_BYTES, PosExcelError, previewPosImport, readPosFile } from "../../../core/pos-excel";
import { assertV2DayOpen, ClosedDayError } from "../../../core/closed-days";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * POS apparati kunlik hisobotini yuklash (rahbar yoki xodim). multipart: file, action=preview|apply,
 * branchId (rahbar), links (JSON: POS kalit → retsept), accountId (apply: karta yoki naqd hisob).
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Row = Record<string, unknown>;

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "Faqat yangi saytda." }, 403);
  try {
    const owner = await isAdminRequest(request);
    const worker = owner ? null : await authenticateWorkerRequest(request);
    if (!owner && !worker) return json({ error: "Avval kiring.", login: true }, 401);
    if (Number(request.headers.get("content-length") || 0) > MAX_POS_FILE_BYTES + 200_000) return json({ error: "Fayl 15 MB dan katta." }, 413);
    const form = await request.formData();
    const branches = await listHaloBranches();
    const branchId = worker ? String(worker.branchId) : String(form.get("branchId") || "main");
    if (!branches.some((branch) => branch.id === branchId)) return json({ error: "Filial topilmadi." }, 404);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return json({ error: "POS hisobot faylini tanlang." }, 400);
    let links: Record<string, string> = {};
    try {
      const parsed = JSON.parse(String(form.get("links") || "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) links = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => typeof key === "string" && key.length < 200 && typeof value === "string").slice(0, 500)) as Record<string, string>;
    } catch { /* bo'sh */ }
    const table = await readPosFile(await file.arrayBuffer(), file.name);
    const today = seoulBusinessDate(new Date());
    const actorName = worker ? String(worker.name || "Xodim") : "Rahbar";
    if (String(form.get("action")) === "apply") {
      const pre = previewPosImport((await readHaloState(branchId)).state as Row, table, links, today);
      // Xodim faqat bugungi yoki kechagi (tungi yopilish) hisobotni yuklaydi; eskisini — rahbar.
      const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      if (worker && pre.dates.some((date) => date < yesterday)) return json({ error: `Xodim faqat bugungi yoki kechagi POS hisobotini yuklaydi. ${pre.dates[0]} — rahbarga ayting.` }, 403);
      await assertV2DayOpen(branchId, pre.dates);
      const mutation = await mutateHaloState((state) => applyPosImport(state as Row, table, links, {
        accountId: String(form.get("accountId") || ""), actor: { id: worker ? String(worker.userId) : "owner", name: actorName }, createdAt: new Date().toISOString(), today,
      }), 5, branchId, actorName, `POS hisobot yuklandi: ${file.name.slice(0, 60)}`, "POS hisobot (yangi)");
      const preview = previewPosImport(mutation.state as Row, table, links, today);
      return json({ ok: true, applied: mutation.result, preview });
    }
    const { state } = await readHaloState(branchId);
    const accounts = (Array.isArray((state as Row).accounts) ? (state as Row).accounts as Row[] : [])
      .filter((account) => ["card", "cash"].includes(String(account.type))).map((account) => ({ id: String(account.id), name: String(account.name || account.id), type: String(account.type) }));
    return json({ ok: true, preview: previewPosImport(state as Row, table, links, today), accounts });
  } catch (error) {
    if (error instanceof PosExcelError) return json({ error: error.message }, error.status);
    if (error instanceof ClosedDayError) return json({ error: error.message }, 409);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /oy|filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}
