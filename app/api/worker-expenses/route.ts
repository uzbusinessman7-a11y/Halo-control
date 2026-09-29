import { costRuleCoversCategory } from "../../lib/daily-report";
import {
  HaloStateConflictError,
  readHaloState,
  replaceHaloState,
} from "../../lib/halo-store";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { buildWorkerStateView } from "../../lib/worker-state-view";
import { preservesClosedMonthFinance } from "../../lib/month-end";

const allowedCategories = new Set([
  "Ijara",
  "Elektr / gaz / suv",
  "Wi-Fi / telefon",
  "POS abonent to‘lovi",
  "POS / karta komissiyasi",
  "Yetkazib berish komissiyasi",
  "Reklama",
  "Ta’mirlash",
  "Soliq",
  "Sug‘urta",
  "Mahsulot xaridi",
  "Do‘kon / omborsiz mahsulot",
  "Boshqa",
]);

const cleanText = (value: unknown, max: number) => String(value || "")
  .trim()
  .replace(/\s+/g, " ")
  .slice(0, max);

export async function POST(request: Request) {
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    if (!session.canWarehouseReceipt) {
      return Response.json({ error: "Rahbar bu akkauntga xarajat kiritish ruxsatini bermagan." }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const operationId = cleanText(body.operationId, 36);
    const category = cleanText(body.category, 80);
    const sourceName = cleanText(body.sourceName, 120);
    const itemName = cleanText(body.itemName, 140);
    const note = cleanText(body.note, 300);
    const accountId = cleanText(body.accountId, 100);
    const date = cleanText(body.date, 10);
    const amount = Number(body.amount);
    const updatedAt = cleanText(body.updatedAt, 120);
    if (!/^[a-f0-9-]{36}$/.test(operationId) || !allowedCategories.has(category) || !itemName
      || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(amount)
      || amount <= 0 || amount > 100_000_000_000) {
      return Response.json({ error: "Xarajat nomi, turi, sanasi va summasini tekshiring." }, { status: 400 });
    }
    const current = await readHaloState(session.branchId);
    const entries = Array.isArray(current.state.financialEntries)
      ? current.state.financialEntries as Array<Record<string, unknown>>
      : [];
    const entryId = `worker-expense:${operationId}`;
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
      return Response.json({ error: "Pul chiqadigan hisobni tanlang." }, { status: 400 });
    }
    if (costRuleCoversCategory(category, current.state.costRules as { cardCommissionPct?: number; deliveryCommissionPct?: number; taxPct?: number } | undefined)) {
      return Response.json({ error: "Bu xarajat avtomatik hisoblanadi; qayta kiritmang." }, { status: 400 });
    }
    const description = [sourceName, itemName, note].filter(Boolean).join(" · ");
    const entry = {
      id: entryId,
      type: "expense" as const,
      category,
      amount,
      date,
      accountId,
      note: description,
      affectsProfit: category !== "Mahsulot xaridi",
      createdByWorkerId: session.userId,
      createdByName: session.name,
      createdAt: new Date().toISOString(),
    };
    const nextState = { ...current.state, financialEntries: [entry, ...entries] };
    if (!preservesClosedMonthFinance(current.state.monthlyCloses, entries, nextState.financialEntries)) {
      return Response.json({ error: "Bu oy yopilgan. Xarajatni yangi oy sanasi bilan kiriting." }, { status: 409 });
    }
    const revision = await replaceHaloState(
      nextState,
      updatedAt,
      session.branchId,
      session.name,
      `Xarajat: ${itemName} · ₩${amount.toLocaleString("en-US")}`,
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
    return Response.json({ error: "Xarajatni saqlab bo‘lmadi." }, { status: 500 });
  }
}
