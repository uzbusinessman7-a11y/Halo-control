import {
  archiveHaloBranch,
  createHaloBranch,
  listHaloBranches,
  renameHaloBranch,
  restoreHaloBranch,
} from "../../lib/halo-store";
import { isAdminRequest } from "../../lib/integration-store";
import { readHaloStateWithRecurringExpenses } from "../../lib/recurring-expense-store";

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const branches = await listHaloBranches(includeArchived);
    if (url.searchParams.get("bootstrap") === "1") {
      const requestedBranch = url.searchParams.get("branch") || "main";
      const activeBranches = branches.filter((branch) => branch.active);
      const branchId = activeBranches.some((branch) => branch.id === requestedBranch)
        ? requestedBranch
        : activeBranches[0]?.id || "main";
      const current = await readHaloStateWithRecurringExpenses(branchId);
      return Response.json(
        { branches, branchId, state: { ...current.state, updatedAt: current.updatedAt } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { branches },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Filiallar ochilmadi." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const body = await request.json() as { name?: unknown; address?: unknown };
    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    if (name.length < 2 || name.length > 60) {
      return Response.json({ error: "Filial nomini to‘g‘ri kiriting." }, { status: 400 });
    }
    const branch = await createHaloBranch(name, address);
    return Response.json({ branch }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Filial qo‘shilmadi." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const body = await request.json() as { branchId?: unknown; name?: unknown; action?: unknown };
    const branchId = String(body.branchId || "").trim();
    if (String(body.action || "") === "restore") {
      return Response.json({ branch: await restoreHaloBranch(branchId) });
    }
    const name = String(body.name || "").trim();
    if (name.length < 2 || name.length > 60) {
      return Response.json({ error: "Filial nomini to‘g‘ri kiriting." }, { status: 400 });
    }
    const branch = await renameHaloBranch(branchId, name);
    return Response.json({ branch });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Filial nomi o‘zgarmadi." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const branchId = new URL(request.url).searchParams.get("branch") || "";
    const body = await request.json().catch(() => ({})) as { reason?: unknown };
    return Response.json({ ok: true, branch: await archiveHaloBranch(branchId, String(body.reason || "")) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Filial o‘chirilmadi." },
      { status: 400 },
    );
  }
}
