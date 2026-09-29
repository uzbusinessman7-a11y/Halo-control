import { isAdminRequest } from "../../lib/integration-store";
import { mutateHaloState } from "../../lib/halo-store";
import { normalizeMezanaCatalog, type MezanaCatalogItem, type MezanaCatalogMode } from "../../lib/mezana-catalog";
import { STOCK_DOCUMENT_MAX_BYTES, STOCK_DOCUMENT_TYPES, type StockDocument } from "../../lib/stock-documents";

declare global {
  var __HALO_CONTROL_BUCKET__: R2Bucket | undefined;
}

const extensions: Record<StockDocument["contentType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const cleanText = (value: unknown, max: number) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  const storage = globalThis.__HALO_CONTROL_BUCKET__;
  let uploadedKey = "";
  try {
    const form = await request.formData();
    const branchId = cleanText(form.get("branchId") || "main", 80);
    const operationId = cleanText(form.get("operationId"), 36);
    const itemId = cleanText(form.get("itemId"), 100);
    const name = cleanText(form.get("name"), 140);
    const mode = cleanText(form.get("mode"), 20) as MezanaCatalogMode;
    const price = Number(form.get("price"));
    const inventoryId = cleanText(form.get("inventoryId"), 100);
    const inventoryUnitsPerItem = Number(form.get("inventoryUnitsPerItem"));
    const image = form.get("image");
    const file = image instanceof File && image.size > 0 ? image : null;
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)
      || (!itemId && !/^[a-f0-9-]{36}$/.test(operationId))
      || (itemId && !itemId.startsWith("mezana-product:"))
      || !name || !["borrowed", "purchased"].includes(mode)
      || !Number.isSafeInteger(price) || price <= 0 || price > 100_000_000_000) {
      return Response.json({ error: "Mahsulot nomi, turi va narxini tekshiring." }, { status: 400 });
    }
    if (file && !STOCK_DOCUMENT_TYPES.includes(file.type as StockDocument["contentType"])) {
      return Response.json({ error: "Faqat JPG, PNG yoki WebP rasm yuklang." }, { status: 415 });
    }
    if (file && file.size > STOCK_DOCUMENT_MAX_BYTES) {
      return Response.json({ error: "Rasm 8 MB dan oshmasin." }, { status: 413 });
    }
    if (file && !storage) return Response.json({ error: "Rasm ombori ulanmagan." }, { status: 503 });

    const now = new Date().toISOString();
    let uploadedImage: StockDocument | undefined;
    if (file && storage) {
      const contentType = file.type as StockDocument["contentType"];
      // Keep the same validated R2 key shape used by every stock document.
      // Historical records can then safely reuse this image snapshot.
      uploadedKey = `stock-documents/${branchId}/${crypto.randomUUID()}.${extensions[contentType]}`;
      uploadedImage = {
        key: uploadedKey,
        fileName: cleanText(file.name, 180) || "mezana-mahsulot",
        contentType,
        size: file.size,
        uploadedAt: now,
      };
      await storage.put(uploadedKey, await file.arrayBuffer(), {
        httpMetadata: { contentType },
        customMetadata: { fileName: uploadedImage.fileName, uploadedAt: now },
      });
    }

    const id = itemId || `mezana-product:${operationId}`;
    const mutation = await mutateHaloState((state) => {
      const catalog = normalizeMezanaCatalog(state.mezanaCatalog);
      const existing = catalog.find((item) => item.id === id);
      const duplicate = catalog.find((item) => item.id !== id && item.mode === mode && item.name.toLocaleLowerCase("uz-UZ") === name.toLocaleLowerCase("uz-UZ"));
      if (duplicate) throw new Error("Bu mahsulot shu ro‘yxatda avvaldan bor.");
      if (inventoryId && (!(Array.isArray(state.inventory) && state.inventory.some((row: any) => row.id === inventoryId)) || !Number.isFinite(inventoryUnitsPerItem) || inventoryUnitsPerItem <= 0 || inventoryUnitsPerItem > 1_000_000_000)) throw new Error("Ombor mahsuloti va 1 donaning miqdorini tekshiring.");
      const item: MezanaCatalogItem = {
        ...(inventoryId ? { inventoryId, inventoryUnitsPerItem } : {}),
        id,
        name,
        mode,
        price,
        ...(uploadedImage ? { image: uploadedImage } : existing?.image ? { image: existing.image } : {}),
        active: existing?.active ?? true,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      return {
        state: { ...state, mezanaCatalog: existing ? catalog.map((candidate) => candidate.id === id ? item : candidate) : [item, ...catalog] },
        result: { item, previousImage: existing?.image },
      };
    }, 5, branchId, "Rahbar", `MEZANA mahsuloti saqlandi · ${name}`, "MEZANA");
    // Old catalog images stay in storage because historical MEZANA entries
    // may reference the exact product image that was shown when they were saved.
    return Response.json({ ok: true, item: mutation.result.item, updatedAt: mutation.updatedAt });
  } catch (error) {
    if (uploadedKey && storage) await storage.delete(uploadedKey).catch(() => undefined);
    return Response.json({ error: error instanceof Error ? error.message : "MEZANA mahsuloti saqlanmadi." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  try {
    const body = await request.json() as { branchId?: unknown; itemId?: unknown; active?: unknown };
    const branchId = cleanText(body.branchId || "main", 80);
    const itemId = cleanText(body.itemId, 100);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId) || !itemId.startsWith("mezana-product:") || typeof body.active !== "boolean") {
      return Response.json({ error: "Mahsulot topilmadi." }, { status: 400 });
    }
    const mutation = await mutateHaloState((state) => {
      const catalog = normalizeMezanaCatalog(state.mezanaCatalog);
      const current = catalog.find((item) => item.id === itemId);
      if (!current) throw new Error("Mahsulot topilmadi.");
      const item = { ...current, active: body.active as boolean, updatedAt: new Date().toISOString() };
      return { state: { ...state, mezanaCatalog: catalog.map((candidate) => candidate.id === itemId ? item : candidate) }, result: item };
    }, 5, branchId, "Rahbar", `MEZANA mahsuloti ${body.active ? "qayta ochildi" : "yashirildi"}`, "MEZANA");
    return Response.json({ ok: true, item: mutation.result, updatedAt: mutation.updatedAt });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mahsulot holati o‘zgarmadi." }, { status: 400 });
  }
}
