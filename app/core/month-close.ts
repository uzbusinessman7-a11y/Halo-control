/**
 * HALO V2 — oyni yopish (eski tizimning closeBusinessMonth qoidasi bilan bir xil).
 * Oy hisoboti (savdo, xarajat, foyda, maosh, ombor qiymati) muzlatiladi; keyin o'sha oyga yozuv qo'shib
 * yoki o'zgartirib bo'lmaydi. Ombor qoldig'i yo'qolmaydi — keyingi oyga o'tadi.
 */
import { closeBusinessMonth, isAccountingMonthClosed, MonthEndError, normalizeMonthlyCloses } from "../lib/month-end";

type Row = Record<string, unknown>;
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const prevMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Qaysi oyni yopish mumkinligi: oxirgi kuni joriy oy, yoki (keyingi oyga hali yozuv bo'lmasa) o'tgan oy. */
export function monthCloseStatus(state: Row, today: string) {
  const current = today.slice(0, 7);
  const candidates = [prevMonth(current), current];
  const closes = normalizeMonthlyCloses(state.monthlyCloses);
  const last = closes.slice().sort((a, b) => b.month.localeCompare(a.month))[0];
  const options = candidates.map((month) => {
    if (isAccountingMonthClosed(state.monthlyCloses, month)) return { month, closed: true, canClose: false, reason: "Yopilgan" };
    if (month === current && today !== lastDay(month)) return { month, closed: false, canClose: false, reason: `Oyning oxirgi kuni (${lastDay(month)}) ish tugagach yopiladi.` };
    try {
      closeBusinessMonth(structuredClone(state) as never, month, "Rahbar", new Date(`${today}T14:00:00Z`).toISOString());
      return { month, closed: false, canClose: true, reason: "" };
    } catch (error) {
      return { month, closed: false, canClose: false, reason: error instanceof MonthEndError ? error.message : "Tekshirib bo‘lmadi." };
    }
  });
  return {
    today, isLastDay: today === lastDay(current), options,
    last: last ? {
      month: last.month, closedAt: last.closedAt, revenue: last.salesRevenue, expenses: last.operatingExpenseTotal, netProfit: last.netProfit,
      payrollGross: last.payrollGross, payrollRemaining: last.payrollRemaining, inventoryValue: last.inventoryValue, tax: last.tax,
      commission: (last.cardCommission || 0) + (last.deliveryCommission || 0),
    } : null,
  };
}

export function closeMonth(state: Row, month: string, closedAt = new Date().toISOString()) {
  const result = closeBusinessMonth(state as never, month, "Rahbar", closedAt,
    Object.fromEntries((Array.isArray(state.inventory) ? state.inventory as Row[] : []).map((item) => [String(item.id), Number(item.stock) || 0])));
  return { state: result.state as unknown as Row, result: { alreadyClosed: result.alreadyClosed, month: result.record.month, netProfit: result.record.netProfit } };
}
export { MonthEndError };
