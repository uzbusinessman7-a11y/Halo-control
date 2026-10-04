import {
  calculatePayrollForDate,
  createPayrollDateAllocator,
  normalizeAttendanceDays,
  normalizePayrollAdjustments,
  normalizeStaff,
  normalizeWorkShifts,
} from "./payroll.ts";
import { isAutomaticTaxSale } from "./sale-tax.ts";
import { deliveryCommissionAmount, deliveryCommissionPercent } from "./delivery-sales.ts";
import { isKitchenConsumptionEntry } from "./outflow-classification.ts";
import {
  saleAccountType,
  saleCardCommissionPercent,
  saleTaxPercent,
} from "./sale-financial-snapshots.ts";

type DailyReportState = {
  inventory?: Array<{
    id?: string;
    unitCost?: number;
  }>;
  accounts?: Array<{ id?: string; type?: string }>;
  sales?: Array<{
    date?: string;
    quantity?: number;
    totalRevenue?: number;
    totalCost?: number;
    expenseOnlyCost?: number;
    accountId?: string;
    id?: string;
    source?: string;
    externalId?: string;
    taxTreatment?: "automatic" | "accountant_managed";
    deliveryCommissionPct?: number;
    deliveryCommissionAmount?: number;
    accountTypeAtSale?: string;
    cardCommissionPctAtSale?: number;
    taxPctAtSale?: number;
    status?: string;
    cancelledAt?: string;
    voided?: boolean;
  }>;
  financialEntries?: Array<{
    id?: string;
    date?: string;
    type?: "income" | "expense" | "transfer";
    category?: string;
    amount?: number;
    affectsProfit?: boolean;
    fixedExpenseId?: string;
    reversedEntryId?: string;
    cancelledAt?: string;
    voided?: boolean;
  }>;
  workerConsumptions?: Array<{
    id?: string;
    date?: string;
    kind?: string;
    quantity?: number;
    totalCost?: number;
    expenseOnlyCost?: number;
  }>;
  stockMovements?: Array<{
    date?: string;
    type?: string;
    quantity?: number;
    unitCost?: number;
    inventoryId?: string;
    referenceId?: string;
  }>;
  costRules?: {
    cardCommissionPct?: number;
    deliveryCommissionPct?: number;
    taxPct?: number;
  };
  staff?: unknown;
  workShifts?: unknown;
  payrollAdjustments?: unknown;
  attendanceDays?: unknown;
};

const amount = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};
const wonAmount = (value: unknown) => Math.round(amount(value));

const percent = (value: unknown) => Math.min(100, amount(value));

export function validCostRules(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rules = value as Record<string, unknown>;
  const baseIsValid = [rules.cardCommissionPct, rules.deliveryCommissionPct, rules.taxPct].every((entry) => {
    const number = Number(entry ?? 0);
    return Number.isFinite(number) && number >= 0 && number <= 100;
  });
  if (!baseIsValid) return false;
  if (rules.deliveryPlatformRules === undefined) return true;
  if (!rules.deliveryPlatformRules || typeof rules.deliveryPlatformRules !== "object" || Array.isArray(rules.deliveryPlatformRules)) return false;
  const platforms = rules.deliveryPlatformRules as Record<string, unknown>;
  return Object.entries(platforms).every(([platform, value]) => {
    if (!["coupang", "baemin", "yogiyo"].includes(platform)) return false;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const rule = value as Record<string, unknown>;
    const percentKeys = ["brokeragePct", "paymentPct", "vatPct", "couponPct", "advertisingPct"];
    const wonKeys = ["deliveryFeeWon", "instantDiscountWon"];
    return (rule.combinedPct === undefined || (() => {
      const number = Number(rule.combinedPct);
      return Number.isFinite(number) && number >= 0 && number <= 100;
    })()) && percentKeys.every((key) => {
      const number = Number(rule[key] ?? 0);
      return Number.isFinite(number) && number >= 0 && number <= 100;
    }) && wonKeys.every((key) => {
      const number = Number(rule[key] ?? 0);
      return Number.isFinite(number) && number >= 0 && number <= 100_000_000;
    });
  });
}

export function costRuleCoversCategory(
  category: string,
  rules: DailyReportState["costRules"] = {},
) {
  if (category === "Soliq") return percent(rules?.taxPct) > 0;
  if (category === "POS / karta komissiyasi") return percent(rules?.cardCommissionPct) > 0;
  if (category === "Yetkazib berish komissiyasi") return percent(rules?.deliveryCommissionPct) > 0;
  return false;
}

export function reportCoversExpenseCategory(
  report: { automaticExpenseCategories?: string[] } | undefined,
  category: string,
) {
  return Boolean(report?.automaticExpenseCategories?.includes(category));
}

export function selectActiveFinancialEntries<T extends {
  id?: string;
  reversedEntryId?: string;
  cancelledAt?: string;
  voided?: boolean;
}>(entries: T[]) {
  const reversedEntryIds = new Set(entries.flatMap((entry) => entry.reversedEntryId ? [entry.reversedEntryId] : []));
  return entries.filter((entry) => (
    !entry.reversedEntryId
    && !reversedEntryIds.has(String(entry.id || ""))
    && !entry.cancelledAt
    && entry.voided !== true
  ));
}

/** The payroll line of the daily report for any date, computed over one unchanged state. */
export type DailyPayrollSource = (date: string) => number;

/**
 * For reports over many days (the Google Sheets export asks for up to 366 of them): payroll
 * rows are normalized once and each member's month is allocated once, instead of repeating
 * all of it for every day. Every date gets exactly the amount calculateDailyReport computes
 * on its own. Build a new source whenever the state changes.
 */
export function createDailyPayrollSource(
  state: Pick<DailyReportState, "staff" | "workShifts" | "payrollAdjustments" | "attendanceDays">,
): DailyPayrollSource {
  const staff = normalizeStaff(state.staff);
  const payrollForMember = createPayrollDateAllocator(
    normalizeWorkShifts(state.workShifts),
    normalizePayrollAdjustments(state.payrollAdjustments),
    normalizeAttendanceDays(state.attendanceDays),
  );
  return (date) => Math.round(staff.reduce((sum, member) => sum + payrollForMember(member, date), 0));
}

export function calculateDailyReport(state: DailyReportState, date: string, payrollSource?: DailyPayrollSource) {
  const sales = Array.isArray(state.sales) ? state.sales.filter((sale) => (
    sale.date === date
    && sale.status !== "cancelled"
    && !sale.cancelledAt
    && sale.voided !== true
  )) : [];
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  const allEntries = Array.isArray(state.financialEntries) ? state.financialEntries : [];
  const entries = selectActiveFinancialEntries(allEntries).filter((entry) => (
    entry.date === date
    && !entry.cancelledAt
    && entry.voided !== true
  ));
  const accountTypes = new Map(accounts.map((account) => [String(account.id || ""), String(account.type || "")]));
  const rules = state.costRules || {};
  let revenue = 0;
  let cost = 0;
  let itemCount = 0;
  let cardSales = 0;
  let cardCommissionExact = 0;
  let hasCardSale = false;
  let savedCardRuleCoversDate = false;
  let deliverySales = 0;
  let deliveryCommission = 0;
  let hasDeliverySale = false;
  let savedDeliveryRuleCoversDate = false;
  let cashSales = 0;
  let bankSales = 0;
  let taxableSales = 0;
  let taxExact = 0;
  let hasAutomaticTaxSale = false;
  let savedTaxRuleCoversDate = false;
  let accountantManagedSales = 0;
  let inventoryOnlyCost = 0;
  let inventoryOnlyItemCount = 0;
  for (const sale of sales) {
    const saleRevenue = wonAmount(sale.totalRevenue);
    // Recipe cost remains on the sale for margin; expensed-on-purchase ingredients must not be charged twice.
    const saleCost = wonAmount(Math.max(0, amount(sale.totalCost) - amount(sale.expenseOnlyCost)));
    const saleQuantity = amount(sale.quantity);
    const accountType = saleAccountType(
      sale,
      accountTypes.get(String(sale.accountId || "account-card")) || "card",
    );
    revenue += saleRevenue;
    cost += saleCost;
    itemCount += saleQuantity;
    const automaticTax = isAutomaticTaxSale(sale, accountType);
    if (automaticTax) {
      const taxPercent = saleTaxPercent(sale, rules.taxPct);
      hasAutomaticTaxSale = true;
      savedTaxRuleCoversDate ||= taxPercent > 0;
      taxableSales += saleRevenue;
      taxExact += saleRevenue * taxPercent / 100;
    }
    else accountantManagedSales += saleRevenue;
    if (accountType === "card") {
      const cardPercent = saleCardCommissionPercent(sale, rules.cardCommissionPct);
      hasCardSale = true;
      savedCardRuleCoversDate ||= cardPercent > 0;
      cardSales += saleRevenue;
      cardCommissionExact += saleRevenue * cardPercent / 100;
    }
    else if (accountType === "delivery") {
      hasDeliverySale = true;
      savedDeliveryRuleCoversDate ||= deliveryCommissionPercent(sale, rules.deliveryCommissionPct) > 0;
      deliverySales += saleRevenue;
      deliveryCommission += deliveryCommissionAmount(sale, rules.deliveryCommissionPct);
    }
    else if (accountType === "cash") cashSales += saleRevenue;
    else if (accountType === "bank") bankSales += saleRevenue;
  }
  const allWorkerOutflows = Array.isArray(state.workerConsumptions) ? state.workerConsumptions : [];
  const inventoryOutflows = allWorkerOutflows.filter((entry) => (
    entry.date === date
    && ["inventory_only", "meal", "product", "waste"].includes(String(entry.kind || ""))
  ));
  const workerOutflowIds = new Set(allWorkerOutflows.map((entry) => String(entry.id || "")).filter(Boolean));
  const inventoryCostById = new Map((Array.isArray(state.inventory) ? state.inventory : [])
    .map((item) => [String(item.id || ""), amount(item.unitCost)]));
  const manualWarehouseWasteCost = (Array.isArray(state.stockMovements) ? state.stockMovements : [])
    .filter((entry) => (
      entry.date === date
      && entry.type === "waste"
      && Number(entry.quantity) < 0
      && !workerOutflowIds.has(String(entry.referenceId || ""))
    ))
    .reduce((sum, entry) => (
      sum + wonAmount(
        Math.abs(Number(entry.quantity || 0))
        * (amount(entry.unitCost) || inventoryCostById.get(String(entry.inventoryId || "")) || 0),
      )
    ), 0);
  const workerOutflowCost = inventoryOutflows.reduce((sum, entry) => sum + wonAmount(Math.max(0, amount(entry.totalCost) - amount(entry.expenseOnlyCost))), 0);
  inventoryOnlyCost = workerOutflowCost + manualWarehouseWasteCost;
  inventoryOnlyItemCount = inventoryOutflows.reduce((sum, entry) => sum + amount(entry.quantity), 0);
  const kitchenOutflowCost = inventoryOutflows
    .filter((entry) => isKitchenConsumptionEntry(entry as Record<string, unknown>))
    .reduce((sum, entry) => sum + wonAmount(Math.max(0, amount(entry.totalCost) - amount(entry.expenseOnlyCost))), 0);
  const wasteOutflowCost = Math.max(0, inventoryOnlyCost - kitchenOutflowCost);
  let manualExpenses = 0;
  let recurringExpenses = 0;
  let enteredExpenses = 0;
  let otherIncome = 0;
  const automaticExpenseCategories = [
    (hasCardSale ? savedCardRuleCoversDate : percent(rules.cardCommissionPct))
      ? "POS / karta komissiyasi"
      : "",
    (hasDeliverySale ? savedDeliveryRuleCoversDate : percent(rules.deliveryCommissionPct))
      ? "Yetkazib berish komissiyasi"
      : "",
    (hasAutomaticTaxSale ? savedTaxRuleCoversDate : percent(rules.taxPct)) ? "Soliq" : "",
  ].filter(Boolean);
  const automaticallyCoveredCategories = new Set(automaticExpenseCategories);
  for (const entry of entries) {
    if (entry.affectsProfit === false) continue;
    if (entry.type === "income") otherIncome += wonAmount(entry.amount);
    if (entry.type === "expense" && !automaticallyCoveredCategories.has(String(entry.category || ""))) {
      const expenseAmount = wonAmount(entry.amount);
      manualExpenses += expenseAmount;
      if (entry.fixedExpenseId) recurringExpenses += expenseAmount;
      else enteredExpenses += expenseAmount;
    }
  }
  const taxExemptSales = 0;
  const cardCommission = Math.round(cardCommissionExact);
  const tax = Math.round(taxExact);
  let payroll: number;
  if (payrollSource) {
    payroll = payrollSource(date);
  } else {
    const staff = normalizeStaff(state.staff);
    const workShifts = normalizeWorkShifts(state.workShifts);
    const payrollAdjustments = normalizePayrollAdjustments(state.payrollAdjustments);
    const attendanceDays = normalizeAttendanceDays(state.attendanceDays);
    payroll = Math.round(staff.reduce((sum, member) => sum + calculatePayrollForDate(
      member,
      workShifts,
      payrollAdjustments,
      attendanceDays,
      date,
    ), 0));
  }
  const automaticExpenses = cardCommission + deliveryCommission + tax + payroll;
  // Inventory purchases are balance-sheet movements (affectsProfit=false).
  // Their cost reaches profit once: through sold-item COGS or a non-sale
  // outflow such as staff food, spoilage, or a manual warehouse waste entry.
  const totalExpenses = manualExpenses + automaticExpenses + inventoryOnlyCost;
  const grossProfit = revenue - cost;
  const netProfit = grossProfit + otherIncome - totalExpenses;
  return {
    revenue,
    cost,
    grossProfit,
    manualExpenses,
    recurringExpenses,
    enteredExpenses,
    otherIncome,
    cardCommission,
    deliveryCommission,
    tax,
    taxReserve: tax,
    operatingProfitBeforeTaxReserve: netProfit + tax,
    cardSales,
    deliverySales,
    cashSales,
    bankSales,
    taxableSales,
    accountantManagedSales,
    taxExemptSales,
    inventoryOnlyCost,
    inventoryOnlyItemCount,
    kitchenOutflowCost,
    wasteOutflowCost,
    manualWarehouseWasteCost,
    cardSettlement: Math.max(0, cardSales - cardCommission),
    payroll,
    automaticExpenses,
    automaticExpenseCategories,
    totalExpenses,
    netProfit,
    margin: revenue ? netProfit / revenue * 100 : 0,
    itemCount,
  };
}
