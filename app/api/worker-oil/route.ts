import {
  CHICKEN_OIL_CAN_LITERS,
  OIL_PURCHASE_CATEGORY,
  OIL_RESALE_CATEGORY,
  type OilFlowType,
} from "../../lib/oil-accounting";
import {
  HaloStateConflictError,
  readHaloState,
  replaceHaloState,
} from "../../lib/halo-store";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { buildWorkerStateView } from "../../lib/worker-state-view";
import { isAccountingMonthClosed } from "../../lib/month-end";

const cleanText = (value: unknown, max: number) => String(value || "")
  .trim()
  .replace(/\s+/g, " ")
  .slice(0, max);

export async function POST(request: Request) {
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    if (!session.canWarehouseReceipt) {
      return Response.json({ error: "Rahbar bu akkauntga moy kirim-chiqimini kiritish ruxsatini bermagan." }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const operationId = cleanText(body.operationId, 36);
    const flowType = cleanText(body.flowType, 20) as OilFlowType;
    const accountId = cleanText(body.accountId, 100);
    const date = cleanText(body.date, 10);
    const note = cleanText(body.note, 300);
    const updatedAt = cleanText(body.updatedAt, 120);
    const canCount = Number(body.canCount);
    const unitAmount = Number(body.unitAmount);
    if (!/^[a-f0-9-]{36}$/.test(operationId) || !["purchase", "resale"].includes(flowType)
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(canCount) || canCount <= 0 || canCount > 10_000
      || !Number.isSafeInteger(unitAmount) || unitAmount <= 0 || unitAmount > 100_000_000_000) {
      return Response.json({ error: "Moy turi, kanistr soni, sana va narxni tekshiring." }, { status: 400 });
    }
    const amount = canCount * unitAmount;
    if (!Number.isSafeInteger(amount) || amount > 100_000_000_000) {
      return Response.json({ error: "Moy summasi juda katta." }, { status: 400 });
    }
    const current = await readHaloState(session.branchId);
    if (isAccountingMonthClosed(current.state.monthlyCloses, date)) {
      return Response.json({ error: `${date.slice(0, 7)} oyi yopilgan. Moy yozuvini ochiq oyga kiriting.` }, { status: 409 });
    }
    const entries = Array.isArray(current.state.financialEntries)
      ? current.state.financialEntries as Array<Record<string, unknown>>
      : [];
    const entryId = `worker-oil:${operationId}`;
    if (entries.some((entry) => entry.id === entryId)) {
      return Response.json({
        ok: true,
        updatedAt: current.updatedAt,
        state: buildWorkerStateView(current.state, session.userId, current.updatedAt),
      });
    }
    if (!updatedAt || current.updatedAt !== updatedAt) {
      return Response.json({ error: "Ma’lumot yangilangan. Sahifani qayta oching." }, { status: 409 });
    }
    const accounts = Array.isArray(current.state.accounts)
      ? current.state.accounts as Array<Record<string, unknown>>
      : [];
    if (!accounts.some((account) => String(account.id || "") === accountId)) {
      return Response.json({ error: "Pul hisobi tanlanmagan." }, { status: 400 });
    }
    const purchase = flowType === "purchase";
    const entry = {
      id: entryId,
      type: purchase ? "expense" as const : "income" as const,
      category: purchase ? OIL_PURCHASE_CATEGORY : OIL_RESALE_CATEGORY,
      amount,
      date,
      accountId,
      note: [purchase ? "Moy keldi" : "Ishlatilgan moy ketdi", note].filter(Boolean).join(" · "),
      affectsProfit: true,
      oilFlowType: flowType,
      oilCanCount: canCount,
      oilLiters: canCount * CHICKEN_OIL_CAN_LITERS,
      oilUnitAmount: unitAmount,
      createdByWorkerId: session.userId,
      createdByName: session.name,
      createdAt: new Date().toISOString(),
    };
    const nextState = { ...current.state, financialEntries: [entry, ...entries] };
    const revision = await replaceHaloState(
      nextState,
      updatedAt,
      session.branchId,
      session.name,
      `${purchase ? "Moy keldi" : "Ishlatilgan moy ketdi"} · ${canCount} kanistr · ₩${amount.toLocaleString("en-US")}`,
      "Xodim dasturi",
    );
    return Response.json({
      ok: true,
      entry,
      updatedAt: revision,
      state: buildWorkerStateView(nextState, session.userId, revision),
    });
  } catch (error) {
    if (error instanceof HaloStateConflictError) {
      return Response.json({ error: "Ma’lumot yangilangan. Sahifani qayta oching." }, { status: 409 });
    }
    return Response.json({ error: "Moy yozuvini saqlab bo‘lmadi." }, { status: 500 });
  }
}
