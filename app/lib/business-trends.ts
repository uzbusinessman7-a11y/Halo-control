import { seoulCalendarDate, previousSeoulDate } from './business-time.ts';
import { summarizeSalesChannels } from './sales-bonus.ts';
import { addDays, periodBounds, vegetablePeriodTotals } from './vegetable-expenses.ts';

type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
const calendarDate = (v: unknown) => {
  const value = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? seoulCalendarDate(instant) : '';
};

/** Report-only view: the saved sale rows are the single revenue source.
 * POS order headers and cash deposits must never be added a second time. */
export function salesPeriodTotals(state: Row, start: string, end: string) {
  const cancelledOrders = new Set(rows(state.posOrders).filter(o => o.status === 'cancelled' || o.cancelledAt || o.voided).map(o => o.id));
  const sales: Row[] = rows(state.sales).filter(s => !cancelledOrders.has(s.posOrderId)).map(s => ({ ...s, date: calendarDate(s.date || s.soldAt) }));
  const result = summarizeSalesChannels({ sales, accounts: rows(state.accounts) }, { start, end });
  return { revenue: result.totals.total, cash: result.totals.cash, pos: result.totals.pos,
    delivery: result.totals.delivery, bank: result.totals.bank,
    itemCount: sales.filter(s => s.date >= start && s.date <= end && s.status !== 'cancelled' && !s.cancelledAt && !s.voided)
      .reduce((total, s) => total + Math.max(0, Number(s.quantity) || 0), 0) };
}

/** A zero baseline is not an infinite percentage or a fabricated 100% increase. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous < 0) return null;
  return previous > 0 ? (current - previous) / previous * 100 : current === 0 ? 0 : null;
}

export function rollingComparisonBounds(endDate: string, days: number) {
  const length = Math.max(1, Math.floor(days));
  const current = { start: addDays(endDate, 1 - length), end: endDate };
  return { current, previous: { start: addDays(current.start, -length), end: addDays(current.start, -1) } };
}

function totals(state: Row, bounds: { start: string; end: string }) {
  const sales = salesPeriodTotals(state, bounds.start, bounds.end);
  const vegetables = vegetablePeriodTotals(state, bounds.start, bounds.end);
  return { ...bounds, ...sales, vegetableSpend: vegetables.expense,
    vegetableShare: sales.revenue > 0 ? vegetables.expense / sales.revenue * 100 : null,
    products: vegetables.products };
}

function comparison(state: Row, bounds: ReturnType<typeof rollingComparisonBounds>) {
  const current = totals(state, bounds.current), previous = totals(state, bounds.previous);
  const started = calendarDate(state.vegetableExpenseStartedAt);
  const vegetableComparable = !started || started <= previous.start;
  return { current, previous, changePct: percentChange(current.revenue, previous.revenue),
    vegetableChangePct: vegetableComparable ? percentChange(current.vegetableSpend, previous.vegetableSpend) : null,
    vegetableShareChangePoints: vegetableComparable && current.vegetableShare !== null && previous.vegetableShare !== null
      ? current.vegetableShare - previous.vegetableShare : null,
    vegetableComparable, vegetablePartial: Boolean(started && started > current.start) };
}

/** Comparisons end on a completed Seoul day, never today's unfinished sales. */
export function salesTrendReport(state: Row, endDate = previousSeoulDate(seoulCalendarDate())) {
  const referenceDay = addDays(endDate, 1);
  const windows = [3, 7, 15, 30].map(days => ({ days, ...comparison(state, rollingComparisonBounds(endDate, days)) }));
  const periods = (['day', 'week', 'month'] as const).map(kind => {
    const current = periodBounds(referenceDay, kind, -1);
    const previous = periodBounds(referenceDay, kind, -2);
    return { kind, label: kind === 'day' ? 'Oxirgi to‘liq kun' : kind === 'week' ? 'Oxirgi to‘liq hafta' : 'Oxirgi to‘liq oy',
      ...comparison(state, { current, previous }) };
  });
  const history = Array.from({ length: 30 }, (_, index) => {
    const date = addDays(endDate, index - 29);
    return { date, ...salesPeriodTotals(state, date, date) };
  });
  return { endDate, windows, periods, history };
}

export function trendChangeText(value: number | null, previous: number) {
  if (value === null) return previous === 0 ? 'Oldingi davrda savdo yo‘q' : 'Solishtirish uchun ma’lumot yetarli emas';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function businessTrendMessage(state: Row, now = new Date()) {
  const reportDate = previousSeoulDate(seoulCalendarDate(now));
  const report = salesTrendReport(state, reportDate);
  const won = (v: number) => `${Math.round(v).toLocaleString('en-US')}₩`;
  const week = report.windows.find(w => w.days === 7)!;
  const lines = [
    'HALO · Savdo va sarf tahlili', `Oxirgi to‘liq sana: ${reportDate} · Seoul`, '',
    ...report.periods.map(p => `${p.label}: ${won(p.current.revenue)} · ${trendChangeText(p.changePct, p.previous.revenue)}`),
    '', 'Oldingi teng davrga nisbatan:',
    ...report.windows.map(w => `${w.days} kun: ${won(w.current.revenue)} · ${trendChangeText(w.changePct, w.previous.revenue)} · sabzavot/sous ${w.current.vegetableShare === null ? 'savdo yo‘q' : `${w.current.vegetableShare.toFixed(2)}%`}`),
    '', `7 kunlik sabzavot/sous xaridi: ${won(week.current.vegetableSpend)}`,
    week.vegetableShareChangePoints === null ? 'Sarf ulushini solishtirish uchun ma’lumot yetarli emas.' : `Oldingi 7 kunga nisbatan: ${week.vegetableShareChangePoints >= 0 ? '+' : ''}${week.vegetableShareChangePoints.toFixed(2)} foiz punkt.`,
    ...week.current.products.slice(0, 3).map((p, i) => `${i + 1}. ${p.name}: ${won(p.amount)}`),
    week.vegetablePartial ? 'Sabzavot hisobi bu davr ichida boshlangan; davr to‘liq emas.' : '',
    'Sarf — xarid summasi. Bu haqiqiy ishlatilgan miqdor emas. Savdo — komissiyadan oldingi tushum. Nol savdo ma’lumot kiritilmaganini ham anglatishi mumkin.',
  ].filter(Boolean);
  return { id: `business-trend-day:${reportDate}`, text: lines.join('\n'), reportDate };
}
