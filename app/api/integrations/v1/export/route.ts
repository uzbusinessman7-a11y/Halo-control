import {
  authenticateApiKey,
  writeIntegrationLog,
} from "../../../../lib/integration-store";
import { readHaloState } from "../../../../lib/halo-store";

export async function GET(request: Request) {
  const key = await authenticateApiKey(request, "export:read");
  const endpoint = "/api/integrations/v1/export";
  if (!key) {
    await writeIntegrationLog({ endpoint, method: "GET", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const current = await readHaloState(key.branchId);
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 200, message: "To‘liq ko‘chirish nusxasi olindi" });
    return Response.json({
      ok: true,
      product: "HALO Control",
      format: "halo-control-portable-export",
      apiVersion: "1.0",
      exportedAt: new Date().toISOString(),
      branchId: key.branchId,
      updatedAt: current.updatedAt,
      sections: Object.keys(current.state).sort(),
      state: current.state,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 500, message: "Eksport tayyorlanmadi" });
    return Response.json({ ok: false, error: "Eksport tayyorlanmadi." }, { status: 500 });
  }
}
