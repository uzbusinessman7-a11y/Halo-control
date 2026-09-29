import { isAdminRequest } from "../../lib/integration-store";
import {
  safeStockDocumentKey,
  STOCK_DOCUMENT_MAX_BYTES,
  STOCK_DOCUMENT_TYPES,
  type StockDocument,
} from "../../lib/stock-documents";

const extensions: Record<StockDocument["contentType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

declare global {
  var __HALO_CONTROL_BUCKET__: R2Bucket | undefined;
}

function bucket() {
  return globalThis.__HALO_CONTROL_BUCKET__;
}

function safeBranchId(value: unknown) {
  const branchId = String(value || "main").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(branchId) ? branchId : "";
}

function safeFileName(value: unknown) {
  return String(value || "nakladnoy")
    .replace(/[\r\n"]/g, "")
    .trim()
    .slice(0, 180) || "nakladnoy";
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  const storage = bucket();
  if (!storage) return Response.json({ error: "Fayl ombori ulanmagan." }, { status: 503 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const branchId = safeBranchId(form.get("branchId"));
    if (!(file instanceof File) || !branchId) {
      return Response.json({ error: "Nakladnoy fayli yoki filial noto‘g‘ri." }, { status: 400 });
    }
    if (!STOCK_DOCUMENT_TYPES.includes(file.type as StockDocument["contentType"])) {
      return Response.json({ error: "Faqat JPG, PNG yoki WebP rasm yuklang." }, { status: 415 });
    }
    if (!file.size || file.size > STOCK_DOCUMENT_MAX_BYTES) {
      return Response.json({ error: "Rasm hajmi 8 MB dan oshmasin." }, { status: 413 });
    }
    const contentType = file.type as StockDocument["contentType"];
    const key = `stock-documents/${branchId}/${crypto.randomUUID()}.${extensions[contentType]}`;
    const fileName = safeFileName(file.name);
    const uploadedAt = new Date().toISOString();
    await storage.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType },
      customMetadata: { fileName, uploadedAt },
    });
    return Response.json({
      document: { key, fileName, contentType, size: file.size, uploadedAt } satisfies StockDocument,
    });
  } catch {
    return Response.json({ error: "Nakladnoy rasmini saqlab bo‘lmadi." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  const storage = bucket();
  if (!storage) return Response.json({ error: "Fayl ombori ulanmagan." }, { status: 503 });
  const key = new URL(request.url).searchParams.get("key");
  if (!safeStockDocumentKey(key)) {
    return Response.json({ error: "Nakladnoy manzili noto‘g‘ri." }, { status: 400 });
  }
  const object = await storage.get(key);
  if (!object) return Response.json({ error: "Nakladnoy topilmadi." }, { status: 404 });
  const fileName = safeFileName(object.customMetadata?.fileName || "nakladnoy").replace(/[^a-zA-Z0-9._-]/g, "_");
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  const storage = bucket();
  if (!storage) return Response.json({ error: "Fayl ombori ulanmagan." }, { status: 503 });
  try {
    const input = await request.json() as { key?: unknown };
    if (!safeStockDocumentKey(input.key)) {
      return Response.json({ error: "Nakladnoy manzili noto‘g‘ri." }, { status: 400 });
    }
    await storage.delete(input.key);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Nakladnoyni o‘chirib bo‘lmadi." }, { status: 500 });
  }
}
