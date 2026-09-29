import {
  authenticateApiKey,
  writeIntegrationLog,
} from "../../../../lib/integration-store";
import { PosApiError, refundPosOrder } from "../../../../lib/pos-service";

export async function POST(request: Request) {
  const key = await authenticateApiKey(request, "refunds:write");
  if (!key) {
    await writeIntegrationLog({ endpoint: "/api/pos/v1/refunds", method: "POST", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let externalId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    externalId = String(body.orderId || "");
    const refunded = await refundPosOrder({ ...body, branchId: key.branchId });
    await writeIntegrationLog({
      branchId: key.branchId,
      keyId: key.id,
      endpoint: "/api/pos/v1/refunds",
      method: "POST",
      status: 200,
      externalId,
      message: refunded.result.duplicate ? "Oldin bekor qilingan" : `${refunded.result.refundedItems} ta qator bekor qilindi`,
    });
    return Response.json({ ok: true, ...refunded.result, updatedAt: refunded.updatedAt });
  } catch (error) {
    const status = error instanceof PosApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "POS savdosi bekor qilinmadi.";
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint: "/api/pos/v1/refunds", method: "POST", status, externalId, message });
    return Response.json({ ok: false, error: message }, { status });
  }
}
