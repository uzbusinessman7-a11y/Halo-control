import {
  CHICKEN_OIL_CAN_LITERS,
  OIL_PURCHASE_CATEGORY,
  OIL_RESALE_CATEGORY,
  type OilFlowType,
} from "../../lib/oil-accounting";
import { HaloStateConflictError, mutateHaloState } from "../../lib/halo-store";
import { isAdminRequest } from "../../lib/integration-store";
import { isAccountingMonthClosed } from "../../lib/month-end";
import { assertV2DayOpen, ClosedDayError } from "../../core/closed-days";

class OilRecordError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "OilRecordError";
  }
}

const cleanText = (value: unknown, max: number) => String(value || "")
  .trim()
  .replace(/\s+/g, " ")
  .slice(0, max);

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const branchId = new URL(request.url).searchParams.get("branch") || "main";
    const body = await request.json() as Record<string, unknown>;
    const operationId = cleanText(body.operationId, 36);
    const flowType = cleanText(body.flowType, 20) as OilFlowType;
    const accountId = cleanText(body.accountId, 100);
    const date = cleanText(body.date, 10);
    const note = cleanText(body.note, 200);
    const canCount = Number(body.canCount);
    const unitAmount = Number(body.unitAmount);
    if (!/^[a-f0-9-]{36}$/.test(operationId) || !["purchase", "resale"].includes(flowType)
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(canCount) || canCount <= 0 || canCount > 10_000
      || !Number.isSafeInteger(unitAmount) || unitAmount <= 0 || unitAmount > 100_000_000_000) {
      throw new OilRecordError("Moy turi, kanistr soni, sana va narxni tekshiring.");
    }
    await assertV2DayOpen(branchId, date);
    const amount = canCount * unitAmount;
    if (!Number.isSafeInteger(amount) || amount > 100_000_000_000) {
      throw new OilRecordError("Moy summasi juda katta.");
    }
    const purchase = flowType === "purchase";
    const entryId = `owner-oil:${operationId}`;
    const mutation = await mutateHaloState((state) => {
      const entries = Array.isArray(state.financialEntries)
        ? state.financialEntries as Array<Record<string, unknown>>
        : [];
      if (entries.some((entry) => entry.id === entryId)) {
        return { state, result: { entryId, alreadySaved: true } };
      }
      if (isAccountingMonthClosed(state.monthlyCloses, date)) {
        throw new OilRecordError(`${date.slice(0, 7)} oyi yopilgan. Moy yozuvini ochiq oyga kiriting.`, 409);
      }
      const accounts = Array.isArray(state.accounts) ? state.accounts as Array<Record<string, unknown>> : [];
      if (!accounts.some((account) => String(account.id || "") === accountId)) {
        throw new OilRecordError("Pul hisobi tanlanmagan.");
      }
      const entry = {
        id: entryId,
        type: purchase ? "expense" as const : "income" as const,
        category: purchase ? OIL_PURCHASE_CATEGORY : OIL_RESALE_CATEGORY,
        amount,
        date,
        accountId,
        note,
        affectsProfit: true,
        oilFlowType: flowType,
        oilCanCount: canCount,
        oilLiters: canCount * CHICKEN_OIL_CAN_LITERS,
        oilUnitAmount: unitAmount,
        createdAt: new Date().toISOString(),
      };
      return {
        state: { ...state, financialEntries: [entry, ...entries] },
        result: { entryId, alreadySaved: false },
      };
    }, 5, branchId, "Rahbar", `${purchase ? "Yangi moy olindi" : "Ishlatilgan moy sotildi"} · ${canCount} kanistr · ₩${amount.toLocaleString("en-US")}`, "Chicken moyi");
    return Response.json({ ok: true, updatedAt: mutation.updatedAt, ...mutation.result });
  } catch (error) {
    if (error instanceof ClosedDayError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof OilRecordError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof HaloStateConflictError) {
      return Response.json({ error: "Ma’lumot boshqa qurilmada yangilandi. Qayta urinib ko‘ring." }, { status: 409 });
    }
    return Response.json({ error: "Moy yozuvini saqlab bo‘lmadi. Qayta urinib ko‘ring." }, { status: 500 });
  }
}
