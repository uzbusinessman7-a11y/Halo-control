import {
  createHaloBackup,
  listHaloBackups,
  readHaloState,
  restoreHaloBackup,
} from "../../lib/halo-store";
import { isAdminRequest } from "../../lib/integration-store";

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branch") || "main";
    if (url.searchParams.get("download") === "current") {
      const current = await readHaloState(branchId);
      return Response.json({
        product: "HALO Control",
        format: "halo-control-api-export",
        apiVersion: "1.0",
        exportedAt: new Date().toISOString(),
        branchId,
        updatedAt: current.updatedAt,
        sections: Object.keys(current.state).sort(),
        state: current.state,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ backups: await listHaloBackups(branchId) });
  } catch {
    return Response.json({ error: "Zaxira nusxalar ochilmadi." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const body = await request.json() as {
      branchId?: unknown;
      backupId?: unknown;
      action?: unknown;
      label?: unknown;
      section?: unknown;
    };
    const branchId = String(body.branchId || "main");
    const backupId = String(body.backupId || "");
    if (String(body.action || "") === "snapshot") {
      const label = String(body.label || "Hozirgi holat qo‘lda saqlandi").trim().slice(0, 160);
      const section = String(body.section || "Arxiv").trim().slice(0, 80);
      return Response.json({
        ok: true,
        backup: await createHaloBackup(branchId, "Rahbar", label, section),
      });
    }
    if (!backupId) {
      return Response.json({ error: "Zaxira nusxa tanlanmagan." }, { status: 400 });
    }
    return Response.json({ ok: true, ...(await restoreHaloBackup(branchId, backupId)) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Qaytarib bo‘lmadi." },
      { status: 400 },
    );
  }
}
