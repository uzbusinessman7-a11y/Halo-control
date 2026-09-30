/**
 * HALO V2 — rahbar bosh ekrani va kunlik "flash" hisobot.
 *
 * Bitta so'rovda hamma bo'limlar eski tizim bilan yangilanadi (kassa, ombor, qarz, maosh)
 * va eng muhim raqamlar yig'iladi:
 *  - savdo (kecha, bugun, oy boshidan) va o'tgan davr bilan solishtirish;
 *  - prime cost = oziq-ovqat tannarxi + ish haqi, savdoga nisbatan %;
 *  - pul qayerda (kassa, bank, kutilayotgan karta/delivery puli);
 *  - qarzlar, maosh, yopilmagan kunlar va boshqa ogohlantirishlar.
 */
import { ownerSummary } from "./kassa-service";
import { runStockBridge } from "./stock-bridge";
import { runDebtBridge } from "./debt-bridge";
import { runPayrollBridge } from "./payroll-bridge";
import { outflowSplit } from "./pos-report";
import { assertScope, isIsoDate, LedgerError, type LedgerScope } from "./ledger";
import type { D1Like } from "../lib/full-migration";
import { isAccountingMonthClosed } from "../lib/month-end";

type Row = Record<string, unknown>;
const DAY = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export interface HomeAlert { level: "bad" | "warn"; text: string; page: "kassa" | "ombor" | "qarz" | "maosh" | "sanoq#oy" }
export interface HomeReport {
  today: string; yesterday: string; monthStart: string;
  sales: { today: number; yesterday: number; weekAgo: number; monthToDate: number; lastMonthSamePeriod: number; days: Array<{ date: string; amount: number }> };
  expenses: { monthToDate: number };
  /** Avtomatik ushlanmalar (oy boshidan): karta/delivery komissiyasi va POS soliq zaxirasi. */
  deductions: { commission: number; tax: number; taxReserve: number };
  prime: {
    theoreticalFood: number; waste: number; countLoss: number; food: number; labor: number; total: number;
    /** Chiqitdan: oshxonada yeyilgan ovqat va haqiqiy isrof (tannarx) alohida. */
    staffMeals: number; wasteOnly: number;
    foodPercent: number | null; laborPercent: number | null; primePercent: number | null;
  };
  money: { cash: number; bank: number; receivable: number; oldestReceivableDays: number | null };
  debts: { total: number; overdue: number; overdueCount: number };
  payroll: { thisMonthToPay: number; unpaidPast: number };
  days: { unclosed: string[]; varianceLast14: number };
  alerts: HomeAlert[];
}

async function accountSum(db: D1Like, scope: LedgerScope, codes: string[], from: string, to: string): Promise<number> {
  const ids = codes.map((code) => `${scope.tenantId}:${scope.branchId}:${code}`);
  const row = await db.prepare(
    `SELECT COALESCE(SUM(l.amount), 0) AS total FROM v2_ledger_lines l JOIN v2_ledger_entries e ON e.id = l.entry_id
     WHERE l.tenant_id = ? AND l.branch_id = ? AND l.account_id IN (${ids.map(() => "?").join(",")}) AND e.date >= ? AND e.date <= ?`,
  ).bind(scope.tenantId, scope.branchId, ...ids, from, to).first<{ total: number }>();
  return Number(row?.total || 0);
}

/** Savdo har bir kun uchun (bitta so'rov): sana → summa. */
async function salesByDay(db: D1Like, scope: LedgerScope, from: string, to: string): Promise<Map<string, number>> {
  const result = await db.prepare(
    `SELECT e.date AS date, SUM(l.amount) AS total FROM v2_ledger_lines l JOIN v2_ledger_entries e ON e.id = l.entry_id
     WHERE l.tenant_id = ? AND l.branch_id = ? AND l.account_id = ? AND e.date >= ? AND e.date <= ? GROUP BY e.date`,
  ).bind(scope.tenantId, scope.branchId, `${scope.tenantId}:${scope.branchId}:savdo`, from, to).all<{ date: string; total: number }>();
  return new Map(result.results.map((row) => [row.date, -Number(row.total)]));
}

/** Oziq-ovqat tannarxi: retsept bo'yicha sarf, qayd etilgan chiqit va sanoq kamomadi — won.
 *  Narx: har mahsulotning oxirgi ma'lum narxi (davrdan oldingi harakatlardan ham olinadi). */
export async function foodCostTotals(db: D1Like, scope: LedgerScope, from: string, to: string) {
  const rows = (await db.prepare(
    `SELECT item_id, date, kind, quantity_milli, theoretical_milli, unit_cost FROM v2_stock_moves
     WHERE tenant_id = ? AND branch_id = ? AND date <= ? AND kind <> 'reversal'
       AND id NOT IN (SELECT reverses_id FROM v2_stock_moves WHERE tenant_id = ? AND branch_id = ? AND reverses_id IS NOT NULL)
     ORDER BY date, created_at`,
  ).bind(scope.tenantId, scope.branchId, to, scope.tenantId, scope.branchId).all<{ item_id: string; date: string; kind: string; quantity_milli: number; theoretical_milli: number; unit_cost: number | null }>()).results;
  const cost = new Map<string, number>();
  let theoretical = 0;
  let waste = 0;
  let count = 0;
  for (const move of rows) {
    const unitCost = Number(move.unit_cost);
    if (move.unit_cost !== null && Number.isFinite(unitCost) && unitCost > 0) cost.set(move.item_id, unitCost);
    if (move.date < from) continue;
    const price = cost.get(move.item_id) || 0;
    const quantity = Number(move.quantity_milli) / 1000;
    if (move.kind === "sale") theoretical += (Number(move.theoretical_milli) ? Number(move.theoretical_milli) / 1000 : -quantity) * price;
    if (move.kind === "waste") waste += -quantity * price;
    if (move.kind === "count") count += quantity * price;
  }
  const countLoss = Math.round(-count);
  return { theoretical: Math.round(theoretical), waste: Math.round(waste), countLoss, food: Math.round(theoretical) + Math.round(waste) + countLoss };
}

export async function homeReport(db: D1Like, scope: LedgerScope, state: Row, today: string, now = new Date()): Promise<HomeReport> {
  assertScope(scope);
  if (!isIsoDate(today)) throw new LedgerError("Sana noto'g'ri.");
  const summary = await ownerSummary(db, scope, state, today);
  const stock = await runStockBridge(db, scope, state, today, now);
  const debt = await runDebtBridge(db, scope, state, today, now);
  const pay = await runPayrollBridge(db, scope, state, today, now);

  const yesterday = shift(today, -1);
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  const lastMonthStart = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  const lastMonthEnd = shift(monthStart, -1);
  const lastMonthSameDay = `${lastMonthStart.slice(0, 8)}${today.slice(8, 10)}`;
  const lastMonthTo = lastMonthSameDay > lastMonthEnd ? lastMonthEnd : lastMonthSameDay;

  const daily = await salesByDay(db, scope, shift(today, -13), today);
  const salesMtd = -(await accountSum(db, scope, ["savdo"], monthStart, today));
  const salesLast = -(await accountSum(db, scope, ["savdo"], lastMonthStart, lastMonthTo));
  const expensesMtd = await accountSum(db, scope, ["xarajat", "komissiya", "kassa-farqi", "soliq"], monthStart, today);
  const commissionMtd = await accountSum(db, scope, ["komissiya"], monthStart, today);
  const taxMtd = await accountSum(db, scope, ["soliq"], monthStart, today);
  const taxReserve = -(await accountSum(db, scope, ["soliq-zaxira"], "0000-01-01", today));

  const food = await foodCostTotals(db, scope, monthStart, today);
  const split = outflowSplit(state, monthStart, today);
  const staffMeals = Math.min(split.meals, Math.max(0, food.waste));
  const labor = pay.employees.reduce((sum, employee) => {
    const current = employee.months.find((item) => item.month === month);
    return sum + (current ? current.earned + current.bonus - current.deduction : 0);
  }, 0);
  const prime = food.food + labor;

  const byRole = (role: string) => summary.balances.filter((item) => item.role === role).reduce((sum, item) => sum + item.balance, 0);
  const receivable = summary.receivables.reduce((sum, item) => sum + Math.max(0, item.outstanding), 0);
  const oldestReceivableDays = summary.receivables.reduce<number | null>((max, item) => (item.ageDays != null && item.outstanding > 0 && (max == null || item.ageDays > max) ? item.ageDays : max), null);

  const overdueParties = debt.parties.filter((party) => party.ledgerBalance > 0 && (party.ageDays ?? 0) > 30);
  const thisMonthToPay = pay.employees.reduce((sum, employee) => sum + Math.max(0, employee.months.find((item) => item.month === month)?.ledgerRemaining || 0), 0);
  const unpaidPast = pay.unpaidPast.reduce((sum, item) => sum + item.amount, 0);
  const unclosed = summary.days.filter((day) => !day.closed && day.date < today).map((day) => day.date);
  const varianceLast14 = summary.days.reduce((sum, day) => sum + (day.variance || 0), 0);

  const alerts: HomeAlert[] = [];
  const w = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")} ₩`;
  if (!summary.bridge.ok) alerts.push({ level: "bad", page: "kassa", text: "Pul hisoblari eski tizim bilan mos emas — tekshiring" });
  if (unclosed.length) alerts.push({ level: "warn", page: "kassa", text: `${unclosed.length} ta kun yopilmagan (oxirgisi ${unclosed[0]})` });
  if (varianceLast14 < 0) alerts.push({ level: "bad", page: "kassa", text: `Kassa kamomadi (14 kun): ${w(varianceLast14)}` });
  if (oldestReceivableDays != null && oldestReceivableDays > 7) alerts.push({ level: "warn", page: "kassa", text: `Karta/delivery puli ${oldestReceivableDays} kundan beri bankka tushmagan: ${w(receivable)}` });
  if (food.countLoss > 0) alerts.push({ level: "bad", page: "ombor", text: `Ombor sanoq kamomadi (oy boshidan): ${w(food.countLoss)}` });
  if (stock.mismatched) alerts.push({ level: "warn", page: "ombor", text: `${stock.mismatched} ta mahsulot qoldig'i hujjatsiz o'zgartirilgan` });
  if (overdueParties.length) alerts.push({ level: "warn", page: "qarz", text: `${overdueParties.length} ta yetkazib beruvchiga 30 kundan oshgan qarz: ${w(overdueParties.reduce((sum, party) => sum + party.ledgerBalance, 0))}` });
  if (debt.mismatched) alerts.push({ level: "warn", page: "qarz", text: `${debt.mismatched} ta qarz qoldig'i tarix bilan mos emas` });
  if (unpaidPast > 0) alerts.push({ level: "warn", page: "maosh", text: `O'tgan oylardan to'lanmagan maosh: ${w(unpaidPast)}` });
  if (pay.advancesWithoutCash) alerts.push({ level: "warn", page: "maosh", text: `${pay.advancesWithoutCash} ta avans kassadan chiqmagan holda yozilgan` });
  if (pay.mismatched) alerts.push({ level: "bad", page: "maosh", text: `${pay.mismatched} ta oyda maosh eski hisob bilan mos emas` });
  // Oy oxiri eslatmasi: bugun oyning oxirgi kuni va oy hali yopilmagan.
  const nextMonth = shift(`${today.slice(0, 7)}-01`, 40).slice(0, 7);
  if (shift(today, 1).slice(0, 7) === nextMonth && !isAccountingMonthClosed(state.monthlyCloses, today)) {
    alerts.push({ level: "warn", page: "sanoq#oy", text: "Bugun oy oxiri — ish tugagach sanoq qilib, oyni yoping" });
  }
  alerts.sort((left, right) => (left.level === right.level ? 0 : left.level === "bad" ? -1 : 1));

  return {
    today, yesterday, monthStart,
    sales: {
      today: daily.get(today) || 0, yesterday: daily.get(yesterday) || 0, weekAgo: daily.get(shift(yesterday, -7)) || 0,
      monthToDate: salesMtd, lastMonthSamePeriod: salesLast,
      days: Array.from({ length: 14 }, (_, index) => { const date = shift(today, index - 13); return { date, amount: daily.get(date) || 0 }; }),
    },
    expenses: { monthToDate: expensesMtd },
    deductions: { commission: commissionMtd, tax: taxMtd, taxReserve },
    prime: {
      theoreticalFood: food.theoretical, waste: food.waste, countLoss: food.countLoss,
      staffMeals, wasteOnly: Math.max(0, food.waste - staffMeals), food: food.food, labor, total: prime,
      foodPercent: pct(food.food, salesMtd), laborPercent: pct(labor, salesMtd), primePercent: pct(prime, salesMtd),
    },
    money: { cash: byRole("cash"), bank: byRole("bank"), receivable, oldestReceivableDays },
    debts: { total: debt.totalDebt, overdue: overdueParties.reduce((sum, party) => sum + party.ledgerBalance, 0), overdueCount: overdueParties.length },
    payroll: { thisMonthToPay, unpaidPast },
    days: { unclosed, varianceLast14 },
    alerts,
  };
}

const wonText = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")} ₩`;
const change = (now: number, before: number) => (before > 0 ? ` (${now >= before ? "+" : "−"}${Math.abs(Math.round(((now - before) / before) * 100))}%)` : "");
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Telegram uchun qisqa kunlik hisobot (ertalab kechagi kun bo'yicha). */
export function flashText(report: HomeReport, branchName = "HALO"): string {
  const p = report.prime;
  const lines = [
    `📊 ${branchName} — ${dm(report.yesterday)} hisobot`,
    "",
    `Kecha savdo: ${wonText(report.sales.yesterday)}${change(report.sales.yesterday, report.sales.weekAgo)} — o'tgan hafta shu kunga nisbatan`,
    `Oy boshidan: ${wonText(report.sales.monthToDate)}${change(report.sales.monthToDate, report.sales.lastMonthSamePeriod)} — o'tgan oy shu davrga nisbatan`,
    "",
    `Prime cost: ${p.primePercent == null ? "—" : `${p.primePercent}%`} (oziq-ovqat ${p.foodPercent ?? "—"}% + ish haqi ${p.laborPercent ?? "—"}%)`,
    ...(report.deductions.commission || report.deductions.tax ? [`Avtomatik ushlanma (oy): komissiya ${wonText(report.deductions.commission)} · soliq ${wonText(report.deductions.tax)}`] : []),
    `Pul: kassa ${wonText(report.money.cash)} · bank ${wonText(report.money.bank)} · kutilmoqda ${wonText(report.money.receivable)}`,
    `Qarz: ${wonText(report.debts.total)}${report.debts.overdueCount ? ` (30+ kun: ${wonText(report.debts.overdue)})` : ""}`,
  ];
  lines.push("", report.alerts.length ? "⚠️ Diqqat:" : "✅ Muammo yo'q");
  for (const alert of report.alerts.slice(0, 6)) lines.push(`${alert.level === "bad" ? "🔴" : "🟡"} ${alert.text}`);
  return lines.join("\n");
}
