import { HaloStateConflictError, readHaloState, replaceHaloState } from "../../lib/halo-store";
import { isMezanaSupplierName } from "../../lib/mezana-debts";
import { STOCK_DOCUMENT_MAX_BYTES, STOCK_DOCUMENT_TYPES, type StockDocument } from "../../lib/stock-documents";
import { parseSupplierDeliveryLines, supplierDeliveryTotal, validSupplierDelivery, type SupplierDelivery } from "../../lib/supplier-deliveries";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { buildWorkerStateView } from "../../lib/worker-state-view";
import { applyWarehouseIntake } from "../../lib/warehouse-intake";
import { IntakeError } from "../../lib/unified-intake";
import { VegetableExpenseError } from "../../lib/vegetable-expenses";

const MAX_REQUEST_BYTES = STOCK_DOCUMENT_MAX_BYTES + 256 * 1024;
const extensions: Record<StockDocument["contentType"], string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
type Row = Record<string, any>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
declare global { var __HALO_CONTROL_BUCKET__: R2Bucket | undefined; }
const safeFileName = (value: unknown) => String(value || "nakladnoy").replace(/[\r\n"]/g, "").trim().slice(0, 180) || "nakladnoy";

export async function POST(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
  if (!session.canSupplierDelivery) return Response.json({ error: "Rahbar bu akkauntga ombor kirimini kiritish ruxsatini bermagan." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) return Response.json({ error: "Nakladnoy rasmi 8 MB dan oshmasin." }, { status: 413 });
  const storage = globalThis.__HALO_CONTROL_BUCKET__;
  let uploadedKey = "";
  let committed = false;
  try {
    const form = await request.formData();
    // A cached form must not silently discard the worker's payment/debt intent.
    if (form.get("inventoryOnly") !== "true" || form.has("settlementMode") || form.has("paymentAccountId")) {
      return Response.json({ error: "Kirim tartibi yangilandi. Sahifani yangilang: bu yerda faqat mahsulot kirimi saqlanadi; qarz va to‘lov yetkazib beruvchilar bo‘limida yoziladi.", code: "FORM_VERSION_CHANGED" }, { status: 409 });
    }
    const operationId = String(form.get("operationId") || "");
    const supplierId = String(form.get("supplierId") || "").trim();
    const date = String(form.get("date") || "").trim();
    const note = String(form.get("note") || "").trim().replace(/\s+/g, " ").slice(0, 300);
    const updatedAt = String(form.get("updatedAt") || "");
    let requestedLines;
    try { requestedLines = parseSupplierDeliveryLines(JSON.parse(String(form.get("lines") || "[]"))); }
    catch { return Response.json({ error: "Tovar qatorlarini tekshiring." }, { status: 400 }); }
    if (!requestedLines || requestedLines.some(line => !Number.isSafeInteger(line.totalAmount))) return Response.json({ error: "Sana, mahsulot, miqdor va jami narxni tekshiring." }, { status: 400 });
    const current = await readHaloState(session.branchId);
    const inventoryById = new Map(rows(current.state.inventory).map(item => [String(item.id), item]));
    if (requestedLines.some(line => !inventoryById.has(line.inventoryId))) return Response.json({ error: "Tanlangan mahsulot Ombor bazasida topilmadi." }, { status: 400 });
    const lines = requestedLines.map(line => ({ ...line, name: String(inventoryById.get(line.inventoryId)!.name).slice(0, 100), unit: line.unit || String(inventoryById.get(line.inventoryId)!.unit) }));
    const applied = applyWarehouseIntake(current.state, {
      inventoryOnly: true, operationId, date,
      lines: lines.map(line => ({ inventoryId: line.inventoryId, name: line.name, quantity: line.quantity, unit: line.unit, amount: line.totalAmount })),
      duplicateReason: String(form.get("duplicateReason") || ""),
    });
    const deliveryId = `delivery-${operationId}`;
    if (applied.result.alreadySaved) {
      const prior = rows(current.state.supplierDeliveries).find(delivery => delivery.id === deliveryId && delivery.createdByWorkerId === session.userId);
      if (!prior) return Response.json({ error: "Kirim raqami boshqa yozuvga tegishli. Sahifani yangilang." }, { status: 409 });
      if (prior.supplierId !== supplierId || prior.note !== note) return Response.json({ error: "Bu kirim oldin saqlangan. Tarixni tekshiring; yangi kirimni alohida kiriting." }, { status: 409 });
      return Response.json({ ok: true, alreadySaved: true, delivery: prior, updatedAt: current.updatedAt, state: buildWorkerStateView(current.state, session.userId, current.updatedAt) });
    }
    if (!updatedAt || updatedAt !== current.updatedAt) return Response.json({ error: "Ma’lumot yangilangan. Sahifani qayta oching." }, { status: 409 });
    const supplier = rows(current.state.suppliers).find(entry => String(entry.id) === supplierId);
    if (supplierId && !supplier) return Response.json({ error: "Yetkazib beruvchi topilmadi." }, { status: 400 });
    if (supplier && isMezanaSupplierName(supplier.name)) return Response.json({ error: "MEZANA mahsulotini faqat alohida MEZANA bo‘limidan kiriting." }, { status: 400 });
    const fileValue = form.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
    if (file && !STOCK_DOCUMENT_TYPES.includes(file.type as StockDocument["contentType"])) return Response.json({ error: "Faqat JPG, PNG yoki WebP rasm yuklang." }, { status: 415 });
    if (file && file.size > STOCK_DOCUMENT_MAX_BYTES) return Response.json({ error: "Nakladnoy rasmi 8 MB dan oshmasin." }, { status: 413 });
    if (file && !storage) return Response.json({ error: "Fayl ombori ulanmagan." }, { status: 503 });
    const createdAt = new Date().toISOString();
    let document: StockDocument | undefined;
    if (file && storage) {
      const contentType = file.type as StockDocument["contentType"];
      uploadedKey = `stock-documents/${session.branchId}/${crypto.randomUUID()}.${extensions[contentType]}`;
      document = { key: uploadedKey, fileName: safeFileName(file.name), contentType, size: file.size, uploadedAt: createdAt };
    }
    const delivery: SupplierDelivery = {
      id: deliveryId, supplierId, supplierAccounting: "separate", operationId, date, note, lines,
      totalAmount: supplierDeliveryTotal(lines), ...(document ? { document } : {}),
      createdByWorkerId: session.userId, createdByName: session.name.slice(0, 100), createdAt, status: "approved", approvedAt: createdAt,
    };
    if (!validSupplierDelivery(delivery)) return Response.json({ error: "Kirim ma’lumotini tekshiring." }, { status: 400 });
    const nextState = {
      ...applied.state,
      stockMovements: rows(applied.state.stockMovements).map(m => m.warehouseOperationId === applied.result.id ? {
        ...m, referenceId: deliveryId, supplierId, recordedBy: session.name, createdByWorkerId: session.userId,
        ...(document ? { document } : {}),
      } : m),
      supplierDeliveries: [delivery, ...rows(current.state.supplierDeliveries)],
    };
    if (document && storage) await storage.put(uploadedKey, await file!.arrayBuffer(), { httpMetadata: { contentType: document.contentType }, customMetadata: { fileName: document.fileName, uploadedAt: createdAt } });
    await replaceHaloState(nextState, updatedAt, session.branchId, session.name, `Ombor kirimi · ${lines.length} tur · ₩${delivery.totalAmount.toLocaleString("en-US")} · qarz va to‘lov yaratilmagan`, "Xodim dasturi");
    committed = true;
    // Use the persisted view after vegetable-reserve processing, not the draft.
    const saved = await readHaloState(session.branchId);
    return Response.json({ ok: true, delivery, updatedAt: saved.updatedAt, state: buildWorkerStateView(saved.state, session.userId, saved.updatedAt) });
  } catch (error) {
    if (!committed && uploadedKey && storage) await storage.delete(uploadedKey).catch(() => undefined);
    if (error instanceof HaloStateConflictError) return Response.json({ error: "Ma’lumot yangilangan. Sahifani qayta oching." }, { status: 409 });
    if (error instanceof IntakeError || error instanceof VegetableExpenseError) return Response.json({ error: error.message, ...(error instanceof IntakeError && error.code ? { code: error.code } : {}) }, { status: 400 });
    return Response.json({ error: "Ombor kirimini saqlab bo‘lmadi." }, { status: 500 });
  }
}
