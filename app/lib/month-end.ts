import {
  calculatePayroll,
  conflictingWorkShiftIds,
  normalizeAttendanceDays,
  normalizePayrollAdjustments,
  normalizePayrollPayments,
  normalizeStaff,
  normalizeWorkShifts,
  type AttendanceDay,
  type PayrollAdjustment,
  type PayrollPayment,
  type StaffMember,
  type WorkShift,
} from "./payroll.ts";
import { calculateDailyReport, reportCoversExpenseCategory } from "./daily-report.ts";

type InventoryLike = {
  id: string;
  name: string;
  unit: string;
  stock: number;
  unitCost: number;
};

type StockMovementLike = {
  id: string;
  inventoryId: string;
  type: string;
  quantity: number;
  date: string;
  note: string;
  referenceId?: string;
  unitCost?: number;
};

type FinancialEntryLike = {
  id: string;
  type: "income" | "expense" | "transfer";
  category: string;
  amount: number;
  date: string;
  accountId: string;
  note: string;
  affectsProfit: boolean;
  reversedEntryId?: string;
  cancelledAt?: string;
};

type SaleLike = {
  id: string;
  date: string;
  totalRevenue: number;
  totalCost: number;
  status?: string;
  cancelledAt?: string;
  voided?: boolean;
};

type MonthEndState = {
  inventory: InventoryLike[];
  stockMovements: StockMovementLike[];
  staff: StaffMember[];
  workShifts: WorkShift[];
  payrollAdjustments: PayrollAdjustment[];
  attendanceDays: AttendanceDay[];
  payrollPayments: PayrollPayment[];
  sales?: SaleLike[];
  financialEntries?: FinancialEntryLike[];
  accounts?: Array<{ id?: string; type?: string }>;
  workerConsumptions?: Array<{
    id?: string;
    date?: string;
    kind?: string;
    quantity?: number;
    totalCost?: number;
    reason?: string;
    outflowCategory?: string;
  }>;
  costRules?: {
    cardCommissionPct?: number;
    deliveryCommissionPct?: number;
    taxPct?: number;
  };
  monthlyCloses?: unknown;
};

export type MonthlyInventorySnapshot = {
  inventoryId: string;
  name: string;
  unit: string;
  systemStock?: number;
  closingStock?: number;
  stock: number;
  openingStock?: number;
  resetForRecount?: boolean;
  difference?: number;
  unitCost: number;
  value: number;
};

export type MonthlyExpenseSnapshot = {
  id: string;
  category: string;
  amount: number;
  date: string;
  accountId: string;
  note: string;
};

export type MonthlyPayrollSnapshot = {
  staffId: string;
  name: string;
  payType: "monthly" | "hourly";
  workedDays: number;
  workedMinutes: number;
  grossPay: number;
  paidAmount: number;
  remaining: number;
};

export type MonthlyCloseRecord = {
  id: string;
  month: string;
  closedAt: string;
  closedBy: string;
  inventoryItems: MonthlyInventorySnapshot[];
  inventoryValue: number;
  resetInventoryIds?: string[];
  salesCount?: number;
  salesRevenue?: number;
  salesCost?: number;
  salesProfit?: number;
  expenseItems?: MonthlyExpenseSnapshot[];
  expenseTotal?: number;
  otherIncome?: number;
  cardCommission?: number;
  deliveryCommission?: number;
  tax?: number;
  inventoryOutflowCost?: number;
  payrollExpense?: number;
  operatingExpenseTotal?: number;
  netProfit?: number;
  payrollItems: MonthlyPayrollSnapshot[];
  payrollGross: number;
  payrollPaid: number;
  payrollRemaining: number;
};

export class MonthEndError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonthEndError";
  }
}

const validMonth = (value: unknown): value is string => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value: unknown, limit: number) => String(value || "").trim().slice(0, limit);
const monthCloseId = (month: string) => `monthly-close:${month}`;

const lastDateOfMonth = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
};

const datesOfMonth = (month: string) => {
  const lastDay = Number(lastDateOfMonth(month).slice(-2));
  return Array.from({ length: lastDay }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
};

export const nextAccountingMonth = (month: string) => {
  if (!validMonth(month)) return month;
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
};

export function isAccountingMonthClosed(value: unknown, dateOrMonth: unknown) {
  const candidate = text(dateOrMonth, 10);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(candidate)
    ? candidate
    : /^\d{4}-\d{2}-\d{2}$/.test(candidate)
      ? candidate.slice(0, 7)
      : "";
  return Boolean(month) && normalizeMonthlyCloses(value).some((entry) => entry.month === month);
}

const BUSINESS_ACTIVITY_DATE_COLLECTIONS = [
  "sales",
  "stockMovements",
  "financialEntries",
  "transactions",
  "supplierDeliveries",
  "mezanaEntries",
  "workerConsumptions",
  "posOrders",
  "dailyCloses",
  "purchaseOrders",
  "workShifts",
  "payrollAdjustments",
  "attendanceDays",
  "payrollPayments",
  "operationChecklistDays",
] as const;

function validAccountingDate(value: unknown) {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function firstLaterBusinessActivity(state: MonthEndState, month: string) {
  const cutoff = lastDateOfMonth(month);
  const source = state as MonthEndState & Record<string, unknown>;
  for (const collection of BUSINESS_ACTIVITY_DATE_COLLECTIONS) {
    const entries = Array.isArray(source[collection]) ? source[collection] : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const date = validAccountingDate((entry as Record<string, unknown>).date);
      if (date > cutoff) return { collection, date };
    }
  }
  const laterClose = normalizeMonthlyCloses(state.monthlyCloses)
    .find((entry) => entry.month > month);
  return laterClose
    ? { collection: "monthlyCloses", date: `${laterClose.month}-01` }
    : undefined;
}

export function normalizeMonthlyCloses(value: unknown): MonthlyCloseRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const source = entry as Record<string, unknown>;
    const month = text(source.month, 7);
    const id = text(source.id, 40);
    const closedAt = text(source.closedAt, 40);
    if (!validMonth(month) || id !== monthCloseId(month) || seen.has(month) || !Number.isFinite(Date.parse(closedAt))) return [];
    if (!Array.isArray(source.inventoryItems) || !Array.isArray(source.payrollItems)) return [];
    const inventoryItems = source.inventoryItems.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const inventoryId = text(row.inventoryId, 100);
      const name = text(row.name, 120);
      const unit = text(row.unit, 30);
      const stock = finite(row.stock);
      const unitCost = Math.max(0, finite(row.unitCost));
      const itemValue = Math.max(0, finite(row.value));
      return inventoryId && name && unit ? [{
        inventoryId,
        name,
        unit,
        ...(sourceHas(row, "systemStock") ? { systemStock: finite(row.systemStock) } : {}),
        ...(sourceHas(row, "closingStock") ? { closingStock: finite(row.closingStock) } : {}),
        stock,
        ...(sourceHas(row, "openingStock") ? { openingStock: finite(row.openingStock) } : {}),
        ...(sourceHas(row, "resetForRecount") ? { resetForRecount: row.resetForRecount === true } : {}),
        ...(sourceHas(row, "difference") ? { difference: finite(row.difference) } : {}),
        unitCost,
        value: itemValue,
      }] : [];
    });
    const expenseItems = Array.isArray(source.expenseItems) ? source.expenseItems.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const id = text(row.id, 120);
      const category = text(row.category, 120);
      const date = text(row.date, 10);
      if (!id || !category || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      return [{
        id,
        category,
        amount: Math.max(0, Math.round(finite(row.amount))),
        date,
        accountId: text(row.accountId, 100),
        note: text(row.note, 300),
      }];
    }) : undefined;
    const payrollItems: MonthlyPayrollSnapshot[] = source.payrollItems.flatMap((item): MonthlyPayrollSnapshot[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      const staffId = text(row.staffId, 100);
      const name = text(row.name, 80);
      const payType = row.payType === "hourly" ? "hourly" : "monthly";
      if (!staffId || !name) return [];
      return [{
        staffId,
        name,
        payType,
        workedDays: Math.max(0, Math.floor(finite(row.workedDays))),
        workedMinutes: Math.max(0, Math.floor(finite(row.workedMinutes))),
        grossPay: finite(row.grossPay),
        paidAmount: finite(row.paidAmount),
        remaining: finite(row.remaining),
      }];
    });
    seen.add(month);
    return [{
      id,
      month,
      closedAt,
      closedBy: text(source.closedBy, 80) || "Rahbar",
      inventoryItems,
      inventoryValue: Math.max(0, finite(source.inventoryValue)),
      ...(Array.isArray(source.resetInventoryIds) ? {
        resetInventoryIds: source.resetInventoryIds.map((entry) => text(entry, 100)).filter(Boolean),
      } : {}),
      ...(sourceHas(source, "salesCount") ? {
        salesCount: Math.max(0, Math.floor(finite(source.salesCount))),
        salesRevenue: Math.max(0, Math.round(finite(source.salesRevenue))),
        salesCost: Math.max(0, Math.round(finite(source.salesCost))),
        salesProfit: Math.round(finite(source.salesProfit)),
      } : {}),
      ...(expenseItems ? {
        expenseItems,
        expenseTotal: Math.max(0, Math.round(finite(source.expenseTotal))),
      } : {}),
      ...(sourceHas(source, "operatingExpenseTotal") ? {
        otherIncome: Math.round(finite(source.otherIncome)),
        cardCommission: Math.max(0, Math.round(finite(source.cardCommission))),
        deliveryCommission: Math.max(0, Math.round(finite(source.deliveryCommission))),
        tax: Math.max(0, Math.round(finite(source.tax))),
        inventoryOutflowCost: Math.max(0, Math.round(finite(source.inventoryOutflowCost))),
        ...(sourceHas(source, "payrollExpense") ? {
          payrollExpense: Math.round(finite(source.payrollExpense)),
        } : {}),
        operatingExpenseTotal: Math.round(finite(source.operatingExpenseTotal)),
        netProfit: Math.round(finite(source.netProfit)),
      } : {}),
      payrollItems,
      payrollGross: finite(source.payrollGross),
      payrollPaid: finite(source.payrollPaid),
      payrollRemaining: finite(source.payrollRemaining),
    }];
  }).sort((left, right) => right.month.localeCompare(left.month));
}

export function validMonthlyCloses(value: unknown) {
  if (!Array.isArray(value)) return false;
  const normalized = normalizeMonthlyCloses(value);
  return normalized.length === value.length && JSON.stringify(normalized) === JSON.stringify(value);
}

export function preservesMonthlyCloseHistory(currentValue: unknown, nextValue: unknown) {
  const current = normalizeMonthlyCloses(currentValue);
  const next = normalizeMonthlyCloses(nextValue);
  const nextById = new Map(next.map((entry) => [entry.id, entry]));
  return current.every((entry) => JSON.stringify(nextById.get(entry.id)) === JSON.stringify(entry));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/**
 * Closed-month sales are immutable. Comparing the complete, canonicalized
 * records (rather than totals) also catches quantity/product edits, moves to a
 * different month, additions, and deletions while still allowing array order
 * to change.
 */
export function preservesClosedMonthSales(
  currentCloses: unknown,
  currentSalesValue: unknown,
  nextSalesValue: unknown,
) {
  const closedMonths = new Set(normalizeMonthlyCloses(currentCloses).map((entry) => entry.month));
  if (!closedMonths.size) return true;
  const protectedSales = (value: unknown) => (Array.isArray(value) ? value : [])
    .filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const date = text((entry as Record<string, unknown>).date, 10);
      return closedMonths.has(date.slice(0, 7));
    })
    .map(canonicalJson)
    .sort();
  const current = protectedSales(currentSalesValue);
  const next = protectedSales(nextSalesValue);
  return current.length === next.length && current.every((entry, index) => entry === next[index]);
}

function sourceHas(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function preservesClosedMonthFinance(
  currentCloses: unknown,
  currentEntriesValue: unknown,
  nextEntriesValue: unknown,
) {
  const closedMonths = new Set(normalizeMonthlyCloses(currentCloses).map((entry) => entry.month));
  if (!closedMonths.size) return true;
  const currentEntries = Array.isArray(currentEntriesValue) ? currentEntriesValue : [];
  const nextEntries = Array.isArray(nextEntriesValue) ? nextEntriesValue : [];
  const entryId = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? text((value as Record<string, unknown>).id, 120)
    : "";
  const entryDate = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? text((value as Record<string, unknown>).date, 10)
    : "";
  const reversedId = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? text((value as Record<string, unknown>).reversedEntryId, 120)
    : "";
  const currentById = new Map<string, unknown>(currentEntries
    .map((entry): [string, unknown] => [entryId(entry), entry])
    .filter(([id]) => Boolean(id)));
  const nextById = new Map<string, unknown>(nextEntries
    .map((entry): [string, unknown] => [entryId(entry), entry])
    .filter(([id]) => Boolean(id)));
  const protectedIds = new Set(currentEntries.flatMap((entry) => (
    closedMonths.has(entryDate(entry).slice(0, 7)) ? [entryId(entry)] : []
  )).filter(Boolean));
  currentEntries.forEach((entry) => {
    if (protectedIds.has(reversedId(entry))) protectedIds.add(entryId(entry));
  });
  for (const id of protectedIds) {
    if (JSON.stringify(currentById.get(id)) !== JSON.stringify(nextById.get(id))) return false;
  }
  return nextEntries.every((entry) => {
    const id = entryId(entry);
    if (currentById.has(id)) return true;
    return !closedMonths.has(entryDate(entry).slice(0, 7)) && !protectedIds.has(reversedId(entry));
  });
}

export function closeBusinessMonth<T extends MonthEndState>(
  state: T,
  month: string,
  closedBy = "Rahbar",
  closedAt = new Date().toISOString(),
  openingInventory?: Record<string, number>,
  resetInventoryIds: string[] = [],
): { state: T; record: MonthlyCloseRecord; alreadyClosed: boolean } {
  if (!validMonth(month)) throw new MonthEndError("Yakunlanadigan oy va yilni tanlang.");
  if (!Number.isFinite(Date.parse(closedAt))) throw new MonthEndError("Oy yakuni vaqti noto‘g‘ri.");
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(closedAt));
  const currentMonth = currentDate.slice(0, 7);
  if (month > currentMonth) throw new MonthEndError("Kelajakdagi oyni yakunlab bo‘lmaydi.");
  if (month === currentMonth && currentDate !== lastDateOfMonth(month)) {
    throw new MonthEndError("Joriy oy hali tugamagan. Oyni oxirgi kuni yakunlang.");
  }

  const monthlyCloses = normalizeMonthlyCloses(state.monthlyCloses);
  const existing = monthlyCloses.find((entry) => entry.month === month);
  if (existing) return { state, record: existing, alreadyClosed: true };
  const laterActivity = firstLaterBusinessActivity(state, month);
  if (laterActivity) {
    throw new MonthEndError(
      `${laterActivity.date} sanasida keyingi oy faoliyati bor. Eski oyni joriy ombor qoldig‘i bilan yopib bo‘lmaydi.`,
    );
  }

  const staff = normalizeStaff(state.staff);
  const workShifts = normalizeWorkShifts(state.workShifts);
  const payrollAdjustments = normalizePayrollAdjustments(state.payrollAdjustments);
  const attendanceDays = normalizeAttendanceDays(state.attendanceDays);
  const payrollPayments = normalizePayrollPayments(state.payrollPayments);
  const monthShifts = workShifts.filter((shift) => shift.status !== "void" && shift.date.startsWith(`${month}-`));
  if (monthShifts.some((shift) => shift.status === "open")) {
    throw new MonthEndError("Bu oyda tugatilmagan ish vaqti bor. Avval xodimning ketgan vaqtini kiriting.");
  }
  if (conflictingWorkShiftIds(monthShifts).length) {
    throw new MonthEndError("Bu oyda ustma-ust tushgan ish vaqti bor. Avval xato smenani tuzating.");
  }

  const recordedStaffIds = new Set([
    ...monthShifts.map((entry) => entry.staffId),
    ...attendanceDays.filter((entry) => entry.date.startsWith(`${month}-`)).map((entry) => entry.staffId),
    ...payrollAdjustments.filter((entry) => entry.date.startsWith(`${month}-`)).map((entry) => entry.staffId),
    ...payrollPayments.filter((entry) => entry.month === month).map((entry) => entry.staffId),
  ]);
  const payrollItems = staff
    .filter((member) => member.active || recordedStaffIds.has(member.id))
    .map((member): MonthlyPayrollSnapshot => {
      const summary = calculatePayroll(member, workShifts, payrollAdjustments, month, {
        attendanceDays,
        payments: payrollPayments,
        now: new Date(closedAt),
      });
      return {
        staffId: member.id,
        name: member.name,
        payType: member.payType,
        workedDays: summary.workedDays,
        workedMinutes: summary.workedMinutes,
        grossPay: Math.round(summary.grossPay),
        paidAmount: Math.round(summary.paymentAmount + summary.advance),
        remaining: Math.round(summary.remaining),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "uz"));

  // Month close freezes the report; it never destroys physical stock.
  openingInventory = Object.fromEntries(state.inventory.map(item => [item.id, finite(item.stock)]));
  const resetIds = new Set<string>();
  const inventoryItems = state.inventory.map((item): MonthlyInventorySnapshot => {
    const systemStock = finite(item.stock);
    const stock = finite(openingInventory?.[item.id]);
    if (!sourceHas(openingInventory || {}, item.id) || !Number.isFinite(stock)) {
      throw new MonthEndError(`“${text(item.name, 120) || "Mahsulot"}” yangi oy qoldig‘ini tekshiring.`);
    }
    const unitCost = Math.max(0, finite(item.unitCost));
    return {
      inventoryId: text(item.id, 100),
      name: text(item.name, 120) || "Mahsulot",
      unit: text(item.unit, 30) || "birlik",
      systemStock,
      closingStock: systemStock,
      stock,
      openingStock: stock,
      resetForRecount: resetIds.has(item.id),
      difference: stock - systemStock,
      unitCost,
      value: Math.round(Math.max(0, systemStock) * unitCost),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "uz"));
  const sales = (Array.isArray(state.sales) ? state.sales : []).filter((entry) => (
    entry.date.startsWith(`${month}-`)
    && entry.status !== "cancelled"
    && !entry.cancelledAt
    && entry.voided !== true
  ));
  const monthReportEntries = datesOfMonth(month).map((date) => (
    [date, calculateDailyReport(state, date)] as const
  ));
  const monthReports = monthReportEntries.map(([, report]) => report);
  const monthReportByDate = new Map(monthReportEntries);
  const financialEntries = Array.isArray(state.financialEntries) ? state.financialEntries : [];
  const reversedIds = new Set(financialEntries.flatMap((entry) => entry.reversedEntryId ? [entry.reversedEntryId] : []));
  const expenseItems = financialEntries
    .filter((entry) => entry.type === "expense"
      && entry.affectsProfit !== false
      && entry.date.startsWith(`${month}-`)
      && !reportCoversExpenseCategory(monthReportByDate.get(entry.date), entry.category)
      && !entry.cancelledAt
      && !entry.reversedEntryId
      && !reversedIds.has(entry.id))
    .map((entry): MonthlyExpenseSnapshot => ({
      id: text(entry.id, 120),
      category: text(entry.category, 120) || "Boshqa xarajat",
      amount: Math.max(0, Math.round(finite(entry.amount))),
      date: text(entry.date, 10),
      accountId: text(entry.accountId, 100),
      note: text(entry.note, 300),
    }))
    .sort((left, right) => right.date.localeCompare(left.date) || left.category.localeCompare(right.category, "uz"));
  const monthAccounting = monthReports.reduce((totals, report) => ({
    revenue: totals.revenue + report.revenue,
    cost: totals.cost + report.cost,
    grossProfit: totals.grossProfit + report.grossProfit,
    otherIncome: totals.otherIncome + report.otherIncome,
    cardCommission: totals.cardCommission + report.cardCommission,
    deliveryCommission: totals.deliveryCommission + report.deliveryCommission,
    tax: totals.tax + report.tax,
    inventoryOutflowCost: totals.inventoryOutflowCost + report.inventoryOnlyCost,
    payrollExpense: totals.payrollExpense + report.payroll,
    operatingExpenseTotal: totals.operatingExpenseTotal + report.totalExpenses,
    netProfit: totals.netProfit + report.netProfit,
  }), {
    revenue: 0,
    cost: 0,
    grossProfit: 0,
    otherIncome: 0,
    cardCommission: 0,
    deliveryCommission: 0,
    tax: 0,
    inventoryOutflowCost: 0,
    payrollExpense: 0,
    operatingExpenseTotal: 0,
    netProfit: 0,
  });
  const record: MonthlyCloseRecord = {
    id: monthCloseId(month),
    month,
    closedAt,
    closedBy: text(closedBy, 80) || "Rahbar",
    inventoryItems,
    inventoryValue: inventoryItems.reduce((sum, item) => sum + item.value, 0),
    resetInventoryIds: [...resetIds].sort(),
    salesCount: sales.length,
    salesRevenue: monthAccounting.revenue,
    salesCost: monthAccounting.cost,
    salesProfit: monthAccounting.grossProfit,
    expenseItems,
    expenseTotal: expenseItems.reduce((sum, item) => sum + item.amount, 0),
    otherIncome: monthAccounting.otherIncome,
    cardCommission: monthAccounting.cardCommission,
    deliveryCommission: monthAccounting.deliveryCommission,
    tax: monthAccounting.tax,
    inventoryOutflowCost: monthAccounting.inventoryOutflowCost,
    payrollExpense: monthAccounting.payrollExpense,
    operatingExpenseTotal: monthAccounting.operatingExpenseTotal,
    netProfit: monthAccounting.netProfit,
    payrollItems,
    payrollGross: payrollItems.reduce((sum, item) => sum + item.grossPay, 0),
    payrollPaid: payrollItems.reduce((sum, item) => sum + item.paidAmount, 0),
    payrollRemaining: payrollItems.reduce((sum, item) => sum + item.remaining, 0),
  };
  const resetDate = `${nextAccountingMonth(month)}-01`;
  const countMovements = state.inventory.flatMap((item) => {
    const systemStock = finite(item.stock);
    const nextStock = finite(openingInventory?.[item.id]);
    const difference = nextStock - systemStock;
    if (Math.abs(difference) <= 0.000_001) return [];
    return [{
      id: `${record.id}:inventory:${text(item.id, 100)}`,
      inventoryId: text(item.id, 100),
      type: "adjustment",
      quantity: difference,
      unitCost: Math.max(0, finite(item.unitCost)),
      date: resetDate,
      note: resetIds.has(item.id)
        ? `${month} oy yakuni · yangi sanov uchun 0 qilindi`
        : `${month} oy yakuni · yangi oy qoldig‘i saqlandi`,
      referenceId: record.id,
    }];
  });
  return {
    state: {
      ...state,
      inventory: state.inventory.map((item) => ({ ...item, stock: finite(openingInventory?.[item.id]) })),
      stockMovements: [...countMovements, ...state.stockMovements],
      monthlyCloses: [record, ...monthlyCloses],
    } as T,
    record,
    alreadyClosed: false,
  };
}
