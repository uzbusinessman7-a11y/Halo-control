import { mutateHaloState, readHaloState } from "../../lib/halo-store";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { buildWorkerStateView } from "../../lib/worker-state-view";
import {
  applyWorkerConsumption,
  deleteWorkerConsumption,
  editWorkerConsumption,
  WorkerConsumptionError,
  type WorkerConsumptionEditInput,
  type WorkerConsumptionInput,
} from "../../lib/worker-consumptions";

export async function GET(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const current = await readHaloState(session.branchId);
    return Response.json(
      { state: buildWorkerStateView(current.state, session.userId, current.updatedAt) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Yozuvlar ochilmadi." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as WorkerConsumptionInput;
    const createdAt = new Date().toISOString();
    const mutation = await mutateHaloState(
      (state) => applyWorkerConsumption(state, body, { id: session.userId, name: session.name }, createdAt),
      5,
      session.branchId,
      session.name,
      "Xodim yegan mahsulot yoki minus kiritdi",
      "Xodim yegan / minus",
    );
    return Response.json({
      ok: true,
      entry: mutation.result.entry,
      alreadySaved: mutation.result.alreadySaved,
      state: buildWorkerStateView(mutation.state, session.userId, mutation.updatedAt),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkerConsumptionError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Yozuv saqlanmadi. Qayta urinib ko‘ring." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as WorkerConsumptionEditInput;
    const updatedAt = new Date().toISOString();
    const mutation = await mutateHaloState(
      (state) => editWorkerConsumption(state, body, { id: session.userId, name: session.name }, updatedAt),
      5,
      session.branchId,
      session.name,
      "Xodim o‘zining yeyilgan / minus yozuvini tahrirladi",
      "Xodim yegan / minus · tahrirlash",
    );
    return Response.json({
      ok: true,
      entry: mutation.result.entry,
      state: buildWorkerStateView(mutation.state, session.userId, mutation.updatedAt),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkerConsumptionError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Yozuv tahrirlanmadi. Qayta urinib ko‘ring." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as { recordId?: unknown };
    const mutation = await mutateHaloState(
      (state) => deleteWorkerConsumption(state, String(body.recordId || ""), { id: session.userId, name: session.name }),
      5,
      session.branchId,
      session.name,
      "Xodim o‘zining yeyilgan / minus yozuvini o‘chirdi va omborga qaytardi",
      "Xodim yegan / minus · o‘chirish",
    );
    return Response.json({
      ok: true,
      deletedId: String(body.recordId || ""),
      state: buildWorkerStateView(mutation.state, session.userId, mutation.updatedAt),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkerConsumptionError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Yozuv o‘chirilmadi. Qayta urinib ko‘ring." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
