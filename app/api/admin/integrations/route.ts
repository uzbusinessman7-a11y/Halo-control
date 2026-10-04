import {
  API_PERMISSIONS,
  MAX_ACTIVE_API_KEYS,
  ApiKeyLimitError,
  createApiKey,
  deleteProductMapping,
  getIntegrationSettings,
  isAdminRequest,
  listApiKeys,
  listIntegrationLogs,
  listProductMappings,
  revokeApiKey,
  saveIntegrationSettings,
  saveProductMapping,
} from "../../../lib/integration-store";
import { buildGoogleSheetsExport, createGoogleSheetsAppsScript } from "../../../lib/google-sheets-export";
import { readHaloState } from "../../../lib/halo-store";
import { seoulBusinessDate } from "../../../lib/business-time";

async function snapshot(branchId: string) {
  const [keys, settings, mappings, logs] = await Promise.all([
    listApiKeys(branchId),
    getIntegrationSettings(branchId),
    listProductMappings(branchId),
    listIntegrationLogs(60, branchId),
  ]);
  return { keys, settings, mappings, logs, availablePermissions: API_PERMISSIONS, activeKeyLimit: MAX_ACTIVE_API_KEYS };
}

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Faqat rahbar kirishi mumkin." }, { status: 401 });
  }
  try {
    const branchId = new URL(request.url).searchParams.get("branch") || "main";
    return Response.json(await snapshot(branchId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Integratsiya sozlamalari ochilmadi." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Faqat rahbar kirishi mumkin." }, { status: 401 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const branchId = String(body.branchId || "main");
    if (action === "generate-key") {
      const name = String(body.name || "").trim();
      if (name.length < 2) {
        return Response.json({ error: "Kalit nomini kiriting." }, { status: 400 });
      }
      const createdKey = await createApiKey(name, body.permissions, branchId);
      return Response.json({ ok: true, createdKey, ...(await snapshot(branchId)) });
    }
    if (action === "setup-google-sheets") {
      const existingSettings = await getIntegrationSettings(branchId);
      await saveIntegrationSettings({
        branchId,
        providerName: existingSettings.providerName || "Google Sheets",
        storeId: existingSettings.storeId || `halo-sheets-${branchId}`,
        enabled: true,
      });
      const createdKey = await createApiKey(
        "Google Sheets avtomatik hisobot",
        ["reports:read"],
        branchId,
      );
      const googleSheetsScript = createGoogleSheetsAppsScript({
        origin: new URL(request.url).origin,
        apiKey: createdKey.key,
        branchId,
        days: 365,
      });
      return Response.json({ ok: true, createdKey, googleSheetsScript, ...(await snapshot(branchId)) });
    }
    if (action === "check-google-sheets") {
      // Jadval so'raydigan hisobotning o'zini shu yerda tayyorlab ko'ramiz: ulanmasa, sababi rahbarga ko'rinadi.
      const to = seoulBusinessDate();
      const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - 364 * 86_400_000).toISOString().slice(0, 10);
      const current = await readHaloState(branchId);
      let check: { ok: boolean; from: string; to: string; sheets?: Array<{ name: string; rows: number }>; error?: string };
      try {
        const exported = buildGoogleSheetsExport(current.state, from, to);
        check = { ok: true, from, to, sheets: exported.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows.length })) };
      } catch (error) {
        check = { ok: false, from, to, error: error instanceof Error ? error.message.slice(0, 300) : "Noma’lum xato" };
      }
      return Response.json({ ok: true, check, ...(await snapshot(branchId)) });
    }
    if (action === "revoke-key") {
      await revokeApiKey(String(body.keyId || ""), branchId);
      return Response.json({ ok: true, ...(await snapshot(branchId)) });
    }
    if (action === "save-settings") {
      await saveIntegrationSettings(body);
      return Response.json({ ok: true, ...(await snapshot(branchId)) });
    }
    if (action === "save-mapping") {
      await saveProductMapping(body);
      return Response.json({ ok: true, ...(await snapshot(branchId)) });
    }
    if (action === "delete-mapping") {
      await deleteProductMapping(String(body.mappingId || ""), branchId);
      return Response.json({ ok: true, ...(await snapshot(branchId)) });
    }
    return Response.json({ error: "Noto‘g‘ri amal." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Amal bajarilmadi." },
      { status: error instanceof ApiKeyLimitError ? 409 : 500 },
    );
  }
}
