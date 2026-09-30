import { listHaloBranches, mutateHaloState, readHaloRevision, readHaloState } from "../../lib/halo-store";
import { isAdminRequest } from "../../lib/integration-store";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { applyPosOrder, buildPosTerminalView, PosTerminalError, type PosOrderInput } from "../../lib/pos-terminal";
import { GET as authenticatedGet, POST as authenticatedPost, PUT as authenticatedPut, DELETE as authenticatedDelete } from "../pos-terminal/route";

const actor = { id: "pos-terminal", name: "HALO HISOB · loginsiz" };
const headers = { "Cache-Control": "no-store" };
const signedIn = async (request: Request) => await isAdminRequest(request) || Boolean(await authenticateWorkerRequest(request));

async function publicBranch(value: unknown) {
  if (value && value !== "main") throw new PosTerminalError("Bu ochiq oyna asosiy filial uchun.", 403);
  const branch = (await listHaloBranches()).find(branch => branch.id === "main");
  if (!branch) throw new PosTerminalError("Asosiy filial topilmadi.", 404);
  return branch;
}

function publicView(state: Record<string, unknown>) {
  // Public entry needs menu prices, never historical sales, staff records or costs.
  return { ...buildPosTerminalView({ recipes: state.recipes, productCategories: state.productCategories }), publicEntry: true };
}

function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof PosTerminalError ? error.message : "Hisob oynasida xato. Qayta urinib ko‘ring." }, { status: error instanceof PosTerminalError ? error.status : 500, headers });
}

export async function GET(request: Request) {
  try {
    if (await signedIn(request)) return authenticatedGet(request);
    const url = new URL(request.url);
    const branch = await publicBranch(url.searchParams.get("branch"));
    if (url.searchParams.get("revision") === "1") return Response.json({ branchId: branch.id, updatedAt: await readHaloRevision(branch.id) }, { headers });
    const current = await readHaloState(branch.id);
    return Response.json({ ...publicView(current.state), branches: [{ id: branch.id, name: branch.name }], branchId: branch.id, workerName: actor.name, updatedAt: current.updatedAt }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (await signedIn(request)) return authenticatedPost(request);
    const body = await request.json() as PosOrderInput & { branchId?: unknown };
    const branch = await publicBranch(body.branchId);
    if (body.mode !== "inventory_only" && (body.mode !== "sale" || !["cash", "bank", "delivery"].includes(String(body.paymentType)))) throw new PosTerminalError("Naqd, hisob-raqam yoki delivery savdosini tanlang.");
    // Ochiq oynada ikki sabab: oshxonada yeyilgan ovqat yoki chiqit (isrof / buzilgan).
    if (body.mode === "inventory_only") body.inventoryReason = body.inventoryReason === "Isrof / buzilgan" ? "Isrof / buzilgan" : "Oshxonada yeyilgan ovqat";
    const mutation = await mutateHaloState(state => applyPosOrder(state, body, actor), 5, branch.id, actor.name,
      body.mode === "inventory_only" ? `HALO HISOB: ${body.inventoryReason === "Isrof / buzilgan" ? "chiqit" : "oshxonada yeyilgan ovqat"}` : `HALO HISOB: ${body.paymentType} savdo`, "HALO HISOB · ochiq kirish");
    const saved = mutation.result.order || mutation.result.inventoryOutflow;
    // Confirm only this action; do not publish the underlying financial record.
    const receipt = saved ? { id: saved.id, date: saved.date, total: saved.total, createdAt: saved.createdAt, editable: false } : undefined;
    return Response.json({ ...publicView(mutation.state), ok: true,
      order: mutation.result.order ? receipt : undefined,
      inventoryOutflow: mutation.result.inventoryOutflow ? receipt : undefined,
      alreadySaved: mutation.result.alreadySaved, branchId: branch.id, workerName: actor.name, updatedAt: mutation.updatedAt }, { headers });
  } catch (error) { return errorResponse(error); }
}

// Historical corrections still require the original owner authorization.
export async function PUT(request: Request) { return authenticatedPut(request); }
export async function DELETE(request: Request) { return authenticatedDelete(request); }
