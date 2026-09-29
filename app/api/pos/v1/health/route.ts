import {
  authenticateApiKey,
  getIntegrationSettings,
  writeIntegrationLog,
} from "../../../../lib/integration-store";

export async function GET(request: Request) {
  const key = await authenticateApiKey(request, "health:read");
  if (!key) {
    await writeIntegrationLog({ endpoint: "/api/pos/v1/health", method: "GET", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getIntegrationSettings(key.branchId);
  await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint: "/api/pos/v1/health", method: "GET", status: 200, message: "Ulanish tekshirildi" });
  return Response.json({
    ok: true,
    service: "HALO Control POS API",
    version: "v1",
    branchId: key.branchId,
    integrationEnabled: settings.enabled,
    provider: settings.providerName,
    storeId: settings.storeId,
    serverTime: new Date().toISOString(),
  });
}
