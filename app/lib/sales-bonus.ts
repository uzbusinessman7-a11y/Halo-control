import { calculateDailyReport } from "./daily-report.ts";
import { dateIsInRange, type DateRange } from "./date-range.ts";

export const SALES_BONUS_THRESHOLD = 800_000;
export const SALES_BONUS_PERCENT = 10;
export type SalesSummaryState = Pick<Parameters<typeof calculateDailyReport>[0], "sales" | "accounts">;

export function dailySalesBonus(revenue: number) {
  const total = Number.isFinite(revenue) ? Math.max(0, Math.round(revenue)) : 0;
  const excess = Math.max(0, total - SALES_BONUS_THRESHOLD);
  return { excess, bonus: Math.round(excess * SALES_BONUS_PERCENT / 100) };
}

export function summarizeSalesChannels(state: SalesSummaryState, range: Pick<DateRange, "start" | "end">) {
  const dates = new Set((state.sales || []).map((sale) => sale.date || "").filter((date) => dateIsInRange(date, range)));
  if (range.start && range.start === range.end) dates.add(range.start);
  const days = [...dates].sort().map((date) => {
    const report = calculateDailyReport(state, date);
    return {
      date,
      cash: report.cashSales,
      pos: report.cardSales,
      delivery: report.deliverySales,
      bank: report.bankSales,
      total: report.revenue,
      ...dailySalesBonus(report.revenue),
    };
  });
  const totals = days.reduce((sum, day) => ({
    cash: sum.cash + day.cash,
    pos: sum.pos + day.pos,
    delivery: sum.delivery + day.delivery,
    bank: sum.bank + day.bank,
    total: sum.total + day.total,
    excess: sum.excess + day.excess,
    bonus: sum.bonus + day.bonus,
  }), { cash: 0, pos: 0, delivery: 0, bank: 0, total: 0, excess: 0, bonus: 0 });
  return { days, totals };
}
