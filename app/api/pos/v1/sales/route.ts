import {
  authenticateApiKey,
  writeIntegrationLog,
} from "../../../../lib/integration-store";
import { importPosOrder, PosApiError } from "../../../../lib/pos-service";

export async function POST(request: Request) {
  const key = await authenticateApiKey(request, "sales:write");
  if (!key) {
    await writeIntegrationLog({ endpoint: "/api/pos/v1/sales", method: "POST", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > 512 * 1024) {
    await writeIntegrationLog({ keyId: key.id, endpoint: "/api/pos/v1/sales", method: "POST", status: 413, message: "So‘rov juda katta" });
    return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }
  let externalId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    externalId = String(body.orderId || body.externalId || "");
    const imported = await importPosOrder({ ...body, branchId: key.branchId });
    await writeIntegrationLog({
      branchId: key.branchId,
      keyId: key.id,
      endpoint: "/api/pos/v1/sales",
      method: "POST",
      status: 200,
      externalId,
      message: imported.result.duplicate ? "Takroriy so‘rov — qayta yozilmadi" : `${imported.result.importedItems} ta qator import qilindi`,
    });
    return Response.json({ ok: true, ...imported.result, updatedAt: imported.updatedAt });
  } catch (error) {
    const status = error instanceof PosApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "POS savdosi import qilinmadi.";
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint: "/api/pos/v1/sales", method: "POST", status, externalId, message });
    return Response.json({
      ok: false,
      error: message,
      ...(error instanceof PosApiError && error.details ? { details: error.details } : {}),
    }, { status });
  }
}
