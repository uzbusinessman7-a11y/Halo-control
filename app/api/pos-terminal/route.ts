import { listHaloBranches, mutateHaloState, readHaloRevision, readHaloState } from "../../lib/halo-store";
import {
  applyPosOrder,
  buildPosTerminalView,
  deletePosRecord,
  editPosRecord,
  PosTerminalError,
  updatePosOrderStatus,
  type PosOrderInput,
  type PosRecordEditInput,
  type PosRecordType,
  type PosOrderStatus,
} from "../../lib/pos-terminal";

import { isAdminRequest } from "../../lib/integration-store";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { seoulBusinessDate } from "../../lib/business-time";
import { assertV2DayOpen, ClosedDayError } from "../../core/closed-days";

const POS_ACTOR = { id: "pos-terminal", name: "POS terminal" } as const;

async function activeBranch(value: unknown, fallback = false) {
  const branchId = String(value || "main").trim();
  const branches = await listHaloBranches();
  if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId) && branches.some((branch) => branch.id === branchId)) {
    return { branchId, branches };
  }
  if (fallback) {
    const defaultBranchId = branches.find((branch) => branch.id === "main")?.id || branches[0]?.id;
    if (defaultBranchId) return { branchId: defaultBranchId, branches };
  }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)) {
    throw new PosTerminalError("Filial noto‘g‘ri tanlangan.", 400);
  }
  throw new PosTerminalError("Faol filial topilmadi.", 404);
}

async function authorizePosRequest(request: Request, value: unknown, fallback = false) {
  const owner = await isAdminRequest(request);
  const worker = owner ? null : await authenticateWorkerRequest(request);
  if (!owner && !worker) throw new PosTerminalError("Avval rahbar yoki xodim hisobiga kiring.", 401);
  if (!owner && ["PUT", "DELETE"].includes(request.method)) {
    throw new PosTerminalError("Hisob oynasidagi eski yozuvlarni faqat rahbar tahrirlaydi yoki o‘chiradi.", 403);
  }
  if (worker && value && String(value) !== worker.branchId && !fallback) {
    throw new PosTerminalError("Boshqa filialga kirish taqiqlangan.", 403);
  }
  const result = await activeBranch(worker?.branchId || value, fallback);
  return { ...result, owner, actor: { ...POS_ACTOR, name: worker?.name || "Rahbar" },
    branches: worker ? result.branches.filter((branch) => branch.id === worker.branchId) : result.branches };
}

function authorizedView(state: Parameters<typeof buildPosTerminalView>[0], owner: boolean) {
  const view = buildPosTerminalView(state);
  return { ...view,
    orders: view.orders.map((order) => ({ ...order, editable: owner && order.editable })),
    inventoryOutflows: view.inventoryOutflows.map((entry) => ({ ...entry, editable: owner && entry.editable })),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { branchId, branches, owner, actor } = await authorizePosRequest(request, url.searchParams.get("branch"), true);
    if (url.searchParams.get("revision") === "1") {
      return Response.json(
        { branchId, updatedAt: await readHaloRevision(branchId) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const current = await readHaloState(branchId);
    return Response.json({
      ...authorizedView(current.state, owner),
      branches: branches.map((branch) => ({ id: branch.id, name: branch.name })),
      workerName: actor.name,
      branchId,
      updatedAt: current.updatedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PosTerminalError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "POS terminal ma’lumotlari ochilmadi." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as PosOrderInput & { branchId?: unknown };
    const { branchId, owner, actor } = await authorizePosRequest(request, body.branchId);
    const createdAt = new Date().toISOString();
    if (body.mode !== "inventory_only") {
      try { await assertV2DayOpen(branchId, String(body.date || seoulBusinessDate(new Date()))); }
      catch (error) { if (error instanceof ClosedDayError) throw new PosTerminalError(error.message, 409); throw error; }
    }
    const mutation = await mutateHaloState(
      (state) => applyPosOrder(state, body, actor, createdAt, { ownerEntry: owner }),
      5,
      branchId,
      actor.name,
      body.mode === "inventory_only"
        ? `POS terminal: oshxonada yeyilgan ovqat · ${body.inventoryReason || "avtomatik"}`
        : `POS terminal: ${body.paymentType === "delivery" ? `Delivery · ${body.deliveryPlatform}` : body.paymentType === "card" ? "karta" : body.paymentType === "bank" ? "hisob-raqam" : "naqd"} savdo`,
      "POS terminal",
    );
    return Response.json({
      ok: true,
      order: mutation.result.order,
      inventoryOutflow: mutation.result.inventoryOutflow,
      alreadySaved: mutation.result.alreadySaved,
      ...authorizedView(mutation.state, owner),
      workerName: actor.name,
      branchId,
      updatedAt: mutation.updatedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PosTerminalError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Yozuv saqlanmadi. Qayta urinib ko‘ring." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as PosRecordEditInput & { branchId?: unknown };
    const { branchId, owner, actor } = await authorizePosRequest(request, body.branchId);
    const updatedAt = new Date().toISOString();
    const mutation = await mutateHaloState<ReturnType<typeof editPosRecord>["result"]>(
      (state) => editPosRecord(state, body, actor, updatedAt),
      5,
      branchId,
      actor.name,
      body.recordType === "inventory_only"
        ? "HALO HISOB: yeyilgan mahsulot tahrirlandi"
        : "HALO HISOB: naqd / hisob-raqam savdosi tahrirlandi",
      "HALO HISOB · tahrirlash",
    );
    return Response.json({
      ok: true,
      order: mutation.result.order,
      inventoryOutflow: mutation.result.inventoryOutflow,
      ...authorizedView(mutation.state, owner),
      workerName: actor.name,
      branchId,
      updatedAt: mutation.updatedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PosTerminalError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Yozuv tahrirlanmadi. Qayta urinib ko‘ring." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { recordId?: unknown; recordType?: PosRecordType; branchId?: unknown };
    const { branchId, owner, actor } = await authorizePosRequest(request, body.branchId);
    const recordType = String(body.recordType || "") as PosRecordType;
    const mutation = await mutateHaloState<ReturnType<typeof deletePosRecord>["result"]>(
      (state) => deletePosRecord(state, recordType, String(body.recordId || "")),
      5,
      branchId,
      actor.name,
      recordType === "inventory_only"
        ? "HALO HISOB: yeyilgan mahsulot o‘chirildi va omborga qaytarildi"
        : "HALO HISOB: naqd / hisob-raqam savdosi o‘chirildi va omborga qaytarildi",
      "HALO HISOB · o‘chirish",
    );
    return Response.json({
      ok: true,
      deletedId: String(body.recordId || ""),
      ...authorizedView(mutation.state, owner),
      workerName: actor.name,
      branchId,
      updatedAt: mutation.updatedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PosTerminalError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Yozuv o‘chirilmadi. Qayta urinib ko‘ring." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { orderId?: string; status?: PosOrderStatus; branchId?: unknown };
    const { branchId, owner, actor } = await authorizePosRequest(request, body.branchId);
    const status = String(body.status || "") as PosOrderStatus;
    const changedAt = new Date().toISOString();
    const mutation = await mutateHaloState(
      (state) => updatePosOrderStatus(
        state,
        String(body.orderId || ""),
        status,
        actor,
        changedAt,
      ),
      5,
      branchId,
      actor.name,
      `POS buyurtma holati: ${status}`,
      "POS terminal",
    );
    return Response.json({
      ok: true,
      order: mutation.result.order,
      ...authorizedView(mutation.state, owner),
      workerName: actor.name,
      branchId,
      updatedAt: mutation.updatedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PosTerminalError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Buyurtma holati saqlanmadi." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
