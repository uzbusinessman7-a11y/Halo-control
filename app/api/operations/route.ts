import { isAdminRequest } from "../../lib/integration-store";
import { mutateHaloState, readHaloState } from "../../lib/halo-store";
import {
  applyOperationCompletion,
  buildOperationAlerts,
  dailyCloseHref,
  isDerivedOperationChecklistItem,
  normalizeOperationChecklistDays,
  operationChecklistView,
  OPERATION_CHECKLIST_ITEMS,
} from "../../lib/operations";
import { normalizeStaff, normalizeWorkShifts } from "../../lib/payroll";
import { seoulOperationDate } from "../../lib/business-time";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { isAccountingMonthClosed } from "../../lib/month-end";

class OperationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "OperationError";
    this.status = status;
  }
}

function safeDate(value: unknown) {
  const date = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function workerAccess(state: Record<string, unknown>, workerId: string) {
  const member = normalizeStaff(state.staff).find((entry) => entry.workerId === workerId && entry.active);
  if (!member) return { linked: false as const, canEdit: false as const };
  const openShift = normalizeWorkShifts(state.workShifts).find((shift) => (
    shift.staffId === member.id && shift.status === "open"
  ));
  return {
    linked: true as const,
    canEdit: Boolean(openShift),
    member: { id: member.id, name: member.name },
    openShift: openShift ? { id: openShift.id, clockIn: openShift.clockIn } : null,
  };
}

function ownerPayload(state: Record<string, unknown>, date: string, updatedAt: string) {
  const days = normalizeOperationChecklistDays(state.operationChecklistDays);
  return {
    role: "owner" as const,
    date,
    checklist: operationChecklistView(days, date, state.dailyCloses),
    alerts: buildOperationAlerts(state, date),
    history: days.slice(0, 14).map((day) => operationChecklistView(days, day.date, state.dailyCloses)),
    updatedAt,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedDate = safeDate(url.searchParams.get("date"));
    const date = requestedDate || seoulOperationDate();
    const workerOnly = url.searchParams.get("scope") === "worker";
    if (!workerOnly && await isAdminRequest(request)) {
      const branchId = url.searchParams.get("branch") || "main";
      const current = await readHaloState(branchId);
      return Response.json(ownerPayload(current.state, date, current.updatedAt), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    const current = await readHaloState(session.branchId);
    const access = workerAccess(current.state, session.userId);
    return Response.json({
      role: "worker" as const,
      date,
      checklist: operationChecklistView(current.state.operationChecklistDays, date, current.state.dailyCloses),
      linked: access.linked,
      canEdit: access.canEdit,
      workerName: access.linked ? access.member.name : session.name,
      updatedAt: current.updatedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Kunlik nazorat ochilmadi." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      branchId?: unknown;
      date?: unknown;
      itemId?: unknown;
      completed?: unknown;
      scope?: unknown;
    };
    const workerOnly = body.scope === "worker";
    const admin = workerOnly ? false : await isAdminRequest(request);
    const session = admin ? null : await authenticateWorkerRequest(request);
    if (!admin && !session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    const date = safeDate(body.date) || seoulOperationDate();
    const itemId = String(body.itemId || "");
    const completed = body.completed === true;
    if (!OPERATION_CHECKLIST_ITEMS.some((item) => item.id === itemId)) {
      return Response.json({ error: "Noto‘g‘ri nazorat bandi." }, { status: 400 });
    }
    if (isDerivedOperationChecklistItem(itemId)) {
      return Response.json({
        error: "Kassa nazorati qo‘lda belgilanmaydi. Tanlangan kunni Moliya bo‘limida yoping.",
        href: dailyCloseHref(date),
      }, { status: 409 });
    }
    const branchId = admin ? String(body.branchId || "main") : session!.branchId;
    const actor = admin ? "Rahbar" : session!.name;
    const workerId = admin ? "" : session!.userId;
    if (!admin && date !== seoulOperationDate()) {
      return Response.json({ error: "Hodim faqat bugungi nazoratni bajara oladi." }, { status: 403 });
    }
    const mutation = await mutateHaloState((state) => {
      if (isAccountingMonthClosed(state.monthlyCloses, date)) {
        throw new OperationError(`${date.slice(0, 7)} oyi yopilgan. Kunlik nazorat tarixi o‘zgarmaydi.`, 409);
      }
      if (!admin) {
        const access = workerAccess(state, session!.userId);
        if (!access.linked) throw new OperationError("Rahbar profilingizni xodim akkauntiga bog‘lamagan.");
        if (!access.canEdit) throw new OperationError("Avval “ISHNI BOSHLADIM” tugmasini bosing.");
        const currentItem = operationChecklistView(state.operationChecklistDays, date, state.dailyCloses)
          .phases.flatMap((phase) => phase.items).find((item) => item.id === itemId);
        if (currentItem?.completion?.completedByWorkerId
          && currentItem.completion.completedByWorkerId !== session!.userId) {
          if (completed) return { state, result: { unchanged: true } };
          throw new OperationError("Bu bandni boshqa hodim bajargan. Faqat rahbar bekor qila oladi.");
        }
      }
      const operationChecklistDays = applyOperationCompletion(state.operationChecklistDays, {
        date,
        itemId,
        completed,
        actor,
        workerId,
      });
      return {
        state: { ...state, operationChecklistDays },
        result: { unchanged: false },
      };
    }, 5, branchId, actor, `${completed ? "Bajarildi" : "Belgi olib tashlandi"}: ${itemId}`, "Kunlik nazorat");
    const current = await readHaloState(branchId);
    const payload = admin
      ? ownerPayload(current.state, date, mutation.updatedAt)
      : {
        role: "worker" as const,
        date,
        checklist: operationChecklistView(current.state.operationChecklistDays, date, current.state.dailyCloses),
        ...workerAccess(current.state, session!.userId),
        updatedAt: mutation.updatedAt,
      };
    return Response.json({ ok: true, ...mutation.result, ...payload });
  } catch (error) {
    if (error instanceof OperationError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Kunlik nazorat saqlanmadi. Qayta urinib ko‘ring." }, { status: 500 });
  }
}
