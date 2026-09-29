import { vegetablePeriodTotals } from './vegetable-expenses.ts';
import { calculateDailyReport, reportCoversExpenseCategory, selectActiveFinancialEntries } from "./daily-report.ts";
import { saleTaxTreatment } from "./sale-tax.ts";
import { safeSpreadsheetValue, type SpreadsheetValue } from "./spreadsheet-export.ts";
import { isKitchenConsumptionEntry } from "./outflow-classification.ts";
import { isOilLedgerEntry, summarizeOilLedger } from "./oil-accounting.ts";
import { seoulCalendarDate } from "./business-time.ts";
import {
  calculatePayroll,
  normalizeAttendanceDays,
  normalizePayrollAdjustments,
  normalizePayrollPayments,
  normalizeStaff,
  normalizeWorkShifts,
} from "./payroll.ts";
import {
  supplierPurchaseSettlements,
  type SupplierLedgerTransaction,
} from "./supplier-transactions.ts";
import { calculateRecipeMarginAudit } from "./recipe-costing.ts";
import { isMezanaSupplierName } from "./mezana-debts.ts";
import { allMenuCodes, ensureMenuCodes, preferredMenuCode } from "./menu-codes.ts";
import {
  deliveryCommissionAmount,
  deliveryCommissionPercent,
  deliveryPlatformLabel,
  isDeliveryPlatform,
  isDeliverySale,
  seoulTimeInputValue,
} from "./delivery-sales.ts";

type JsonRecord = Record<string, unknown>;

export type GoogleSheetsTable = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | boolean>>;
};

export const GOOGLE_SHEETS_EXPORT_VERSION = "3.1";

type DeliveryBucket = "coupang" | "baemin" | "yogiyo" | "legacy";

const DELIVERY_EXPORT_BUCKETS: Array<{ id: DeliveryBucket; label: string }> = [
  { id: "coupang", label: "Coupang Eats" },
  { id: "baemin", label: "Baemin" },
  { id: "yogiyo", label: "Yogiyo" },
  { id: "legacy", label: "Delivery / Eski" },
];

type DeliveryExportSummary = {
  quantity: number;
  revenue: number;
  cost: number;
  commission: number;
  settlement: number;
  profit: number;
  orderKeys: Set<string>;
};

const emptyDeliveryExportSummary = (): DeliveryExportSummary => ({
  quantity: 0,
  revenue: 0,
  cost: 0,
  commission: 0,
  settlement: 0,
  profit: 0,
  orderKeys: new Set<string>(),
});

const records = (value: unknown) => Array.isArray(value) ? value as JsonRecord[] : [];
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
const won = (value: unknown) => Math.round(number(value));
const signedNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};
const objectRecord = (value: unknown): JsonRecord | undefined => (
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined
);

const accountingDifference = (value: number) => Math.abs(value) < 0.000_001 ? 0 : value;

function utcDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function googleSheetsDateRangeDays(from: string, to: string) {
  const first = utcDay(from);
  const last = utcDay(to);
  if (!first || !last || first > last) return 0;
  return Math.floor((last.getTime() - first.getTime()) / 86_400_000) + 1;
}

function dateRange(from: string, to: string) {
  const days = googleSheetsDateRangeDays(from, to);
  if (!days || days > 366) throw new Error("Google Sheets davri 1 kundan 366 kungacha bo‘lishi kerak.");
  const start = utcDay(from)!;
  return Array.from({ length: days }, (_, index) => (
    new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10)
  ));
}

function monthRange(from: string, to: string) {
  const months: string[] = [];
  const [fromYear, fromMonth] = from.slice(0, 7).split("-").map(Number);
  const [toYear, toMonth] = to.slice(0, 7).split("-").map(Number);
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

type ExportSupplierTransaction = SupplierLedgerTransaction & {
  note: string;
  accountId: string;
  document?: JsonRecord;
};

function normalizedSupplierTransactions(value: unknown): ExportSupplierTransaction[] {
  const ids = new Set<string>();
  return records(value).map((entry, index) => {
    const id = text(entry.id);
    const supplierId = text(entry.supplierId);
    const type = text(entry.type);
    const date = text(entry.date);
    const rawAmount = Number(entry.amount);
    if (
      !id || ids.has(id) || !supplierId || !["purchase", "payment"].includes(type)
      || !utcDay(date) || !Number.isFinite(rawAmount) || rawAmount <= 0
      || Math.abs(rawAmount - Math.round(rawAmount)) > 0.000_001
    ) {
      throw new Error(`Yetkazib beruvchi oldi-berdisining ${index + 1}-yozuvini tekshiring.`);
    }
    ids.add(id);
    return {
      id,
      supplierId,
      intakeId: text(entry.intakeId),
      type: type as "purchase" | "payment",
      amount: Math.round(rawAmount),
      date,
      note: text(entry.note),
      accountId: text(entry.accountId),
      document: objectRecord(entry.document),
    };
  });
}

function safeTable(
  name: string,
  headers: string[],
  rows: Array<Array<SpreadsheetValue>>,
): GoogleSheetsTable {
  const invalidRow = rows.findIndex((row) => row.length !== headers.length);
  if (invalidRow >= 0) {
    throw new Error(`${name} hisoboti ${invalidRow + 2}-qatorda ustunlar soni mos kelmadi.`);
  }
  const invalidNumber = rows.some((row) => row.some((value) => (
    typeof value === "number" && !Number.isFinite(value)
  )));
  if (invalidNumber) {
    throw new Error(`${name} hisobotida noto‘g‘ri son aniqlandi. Hisobot chiqarilmadi.`);
  }
  return {
    name,
    headers,
    rows: rows.map((row) => row.map((value) => safeSpreadsheetValue(value))),
  };
}

const outflowKindLabel = (kind: string) => ({
  inventory_only: "Oshxonada yeyilgan ovqat",
  meal: "Yeyilgan taom",
  product: "Yeyilgan mahsulot",
  waste: "Minus / isrof",
}[kind] || kind || "Ombor chiqimi");

function outflowName(entry: JsonRecord) {
  const items = records(entry.items).flatMap((item) => {
    const name = text(item.name);
    const quantity = number(item.quantity);
    return name && quantity ? [`${name} × ${quantity}`] : [];
  });
  return items.length ? items.join(", ") : text(entry.label) || "Noma’lum mahsulot";
}

function currentRecipeMargin(recipe: JsonRecord, inventory: JsonRecord[]) {
  return calculateRecipeMarginAudit({
    salePrice: Number(recipe.salePrice),
    ingredients: records(recipe.ingredients).map((ingredient) => ({
      inventoryId: text(ingredient.inventoryId),
      name: text(ingredient.name),
      unit: text(ingredient.unit),
      quantity: Number(ingredient.quantity),
      unitCost: Number(ingredient.unitCost),
      lineCost: Number(ingredient.lineCost),
    })),
    extraCosts: records(recipe.extraCosts).map((entry) => ({ amount: Number(entry.amount) })),
  }, inventory.map((item) => ({
    ...item,
    id: text(item.id),
    unitCost: Number(item.unitCost),
  })));
}

export function buildGoogleSheetsExport(state: JsonRecord, from: string, to: string) {
  const dates = dateRange(from, to);
  const selectedDates = new Set(dates);
  const cancelledOrderIds = new Set(records(state.posOrders).flatMap((order) => {
    const orderId = text(order.id);
    return text(order.status) === "cancelled" && orderId ? [orderId] : [];
  }));
  const activeSales = records(state.sales)
    .filter((sale) => (
      !cancelledOrderIds.has(text(sale.posOrderId))
      && sale.voided !== true
      && text(sale.status) !== "cancelled"
      && !text(sale.cancelledAt)
    ));
  const activeWorkerOutflows = records(state.workerConsumptions)
    .filter((entry) => entry.voided !== true && text(entry.status) !== "cancelled" && !text(entry.cancelledAt));
  const inventoryRecords = records(state.inventory);
  const inventoryById = new Map(inventoryRecords.map((item) => [text(item.id), item]));
  const workerOutflowIds = new Set(activeWorkerOutflows.map((entry) => text(entry.id)).filter(Boolean));
  const manualWarehouseOutflows = records(state.stockMovements).flatMap((movement) => {
    const quantity = number(movement.quantity);
    const inventory = inventoryById.get(text(movement.inventoryId));
    if (
      text(movement.type) !== "waste"
      || quantity >= 0
      || workerOutflowIds.has(text(movement.referenceId))
      || !utcDay(text(movement.date))
    ) return [];
    return [{
      id: text(movement.id),
      date: text(movement.date),
      kind: "waste",
      label: text(inventory?.name) || "Ombor mahsuloti",
      quantity: Math.abs(quantity),
      unit: text(inventory?.unit) || "birlik",
      totalCost: Math.round(Math.abs(quantity) * (
        number(movement.unitCost) || number(inventory?.unitCost)
      )),
      note: text(movement.note) || "Ombordan chiqit",
    }];
  });
  const activeOutflows = [...activeWorkerOutflows, ...manualWarehouseOutflows];
  const reportState = {
    ...state,
    sales: activeSales,
    workerConsumptions: activeWorkerOutflows,
  } as Parameters<typeof calculateDailyReport>[0];
  const reports = dates.map((date) => ({ date, report: calculateDailyReport(reportState, date) }));
  const reportByDate = new Map(reports.map(({ date, report }) => [date, report]));
  const rangeSales = activeSales.filter((sale) => selectedDates.has(text(sale.date)));
  const rangeOutflows = activeOutflows.filter((entry) => selectedDates.has(text(entry.date)));
  const recipes = ensureMenuCodes(records(state.recipes).map((recipe) => ({
    ...recipe,
    id: text(recipe.id),
    name: text(recipe.name),
    posCode: text(recipe.posCode),
    posAliases: Array.isArray(recipe.posAliases) ? recipe.posAliases.map((alias) => text(alias)) : [],
  })));
  const recipeById = new Map(recipes.map((recipe) => [text(recipe.id), recipe]));
  const currentRecipeAuditById = new Map(recipes.map((recipe) => [
    text(recipe.id),
    currentRecipeMargin(recipe, inventoryRecords),
  ]));
  const categories = new Map(records(state.productCategories).map((category) => [text(category.id), text(category.name)]));
  const accounts = records(state.accounts);
  const accountById = new Map(accounts.map((account) => [text(account.id), account]));
  const deliveryFallbackCommissionPct = objectRecord(state.costRules)?.deliveryCommissionPct;
  const deliveryBucketForSale = (sale: JsonRecord): DeliveryBucket => (
    isDeliveryPlatform(sale.deliveryPlatform) ? sale.deliveryPlatform : "legacy"
  );
  const rangeDeliverySales = rangeSales.filter((sale) => isDeliverySale(
    sale,
    text(accountById.get(text(sale.accountId))?.type),
  ));
  const deliveryRangeSummary = emptyDeliveryExportSummary();
  const deliveryRangeByBucket = new Map<DeliveryBucket, DeliveryExportSummary>(
    DELIVERY_EXPORT_BUCKETS.map((bucket) => [bucket.id, emptyDeliveryExportSummary()]),
  );
  const deliveryByDate = new Map<string, {
    total: DeliveryExportSummary;
    buckets: Map<DeliveryBucket, DeliveryExportSummary>;
  }>(dates.map((date) => [date, {
    total: emptyDeliveryExportSummary(),
    buckets: new Map(DELIVERY_EXPORT_BUCKETS.map((bucket) => [bucket.id, emptyDeliveryExportSummary()])),
  }]));
  const addDeliverySale = (summary: DeliveryExportSummary, sale: JsonRecord) => {
    const revenue = won(sale.totalRevenue);
    const cost = won(sale.totalCost);
    const commission = deliveryCommissionAmount(sale, deliveryFallbackCommissionPct);
    const orderReference = text(sale.deliveryBatchId) || text(sale.deliveryOrderNumber) || text(sale.id);
    summary.quantity += number(sale.quantity);
    summary.revenue += revenue;
    summary.cost += cost;
    summary.commission += commission;
    summary.settlement += revenue - commission;
    summary.profit += revenue - cost - commission;
    if (orderReference) {
      summary.orderKeys.add(`${text(sale.date)}|${deliveryBucketForSale(sale)}|${orderReference}`);
    }
  };
  rangeDeliverySales.forEach((sale) => {
    const bucket = deliveryBucketForSale(sale);
    addDeliverySale(deliveryRangeSummary, sale);
    addDeliverySale(deliveryRangeByBucket.get(bucket)!, sale);
    const daily = deliveryByDate.get(text(sale.date));
    if (daily) {
      addDeliverySale(daily.total, sale);
      addDeliverySale(daily.buckets.get(bucket)!, sale);
    }
  });
  const allSuppliers = records(state.suppliers);
  const mezanaSupplierIds = new Set(allSuppliers
    .filter((supplier) => isMezanaSupplierName(supplier.name))
    .map((supplier) => text(supplier.id))
    .filter(Boolean));
  const suppliers = allSuppliers.filter((supplier) => !mezanaSupplierIds.has(text(supplier.id)));
  const currentSupplierIds = new Set<string>();
  suppliers.forEach((supplier, index) => {
    const supplierId = text(supplier.id);
    const balance = Number(supplier.balance);
    if (
      !supplierId || currentSupplierIds.has(supplierId) || !text(supplier.name)
      || !Number.isFinite(balance) || Math.abs(balance - Math.round(balance)) > 0.000_001
    ) {
      throw new Error(`Yetkazib beruvchining ${index + 1}-yozuvi yoki balansi noto‘g‘ri.`);
    }
    currentSupplierIds.add(supplierId);
  });
  const supplierById = new Map(suppliers.map((supplier) => [text(supplier.id), supplier]));
  const archivedSupplierNames = new Map(records(state.deletedItems).flatMap((entry) => {
    const record = objectRecord(entry.record);
    const supplierId = text(entry.entityId) || text(record?.id);
    const name = text(record?.name) || text(entry.label);
    return text(entry.kind) === "supplier" && supplierId && name ? [[supplierId, name] as const] : [];
  }));
  const supplierName = (supplierId: string) => (
    text(supplierById.get(supplierId)?.name)
    || archivedSupplierNames.get(supplierId)
    || "O‘chirilgan yetkazib beruvchi"
  );
  const supplierTransactions = normalizedSupplierTransactions(state.transactions)
    .filter((entry) => !mezanaSupplierIds.has(entry.supplierId));
  const supplierSettlements = supplierPurchaseSettlements(supplierTransactions, to, suppliers.map((supplier) => ({
    id: text(supplier.id),
    openingBalance: number(supplier.openingBalance),
    balanceEdits: records(supplier.balanceEdits)
      .filter((edit) => Number.isFinite(edit.openingBalance) && Number.isFinite(edit.previousOpeningBalance))
      .map((edit) => ({ at: text(edit.at), openingBalance: number(edit.openingBalance), previousOpeningBalance: number(edit.previousOpeningBalance) })),
  })));
  const supplierReturns = records(state.deletedItems).flatMap((entry) => {
    const record = objectRecord(entry.record);
    const reason = text(entry.reason);
    const rawAmount = Number(record?.amount);
    const restored = Boolean(text(entry.restoredAt));
    const deletedAt = new Date(text(entry.deletedAt));
    const returnDate = Number.isFinite(deletedAt.getTime())
      ? seoulCalendarDate(deletedAt)
      : text(record?.date);
    if (
      text(entry.kind) !== "transaction"
      || restored
      || text(record?.type) !== "purchase"
      || !/(vozvrat|qaytar|return)/i.test(reason)
      || !selectedDates.has(returnDate)
      || !Number.isFinite(rawAmount)
      || rawAmount <= 0
    ) return [];
    return [{
      supplierId: text(record?.supplierId),
      amount: Math.round(rawAmount),
    }];
  }).filter((entry) => entry.supplierId && !mezanaSupplierIds.has(entry.supplierId));

  const closeByDate = new Map(records(state.dailyCloses).map((close) => [text(close.date), close]));
  const outflowByDate = new Map<string, { total: number; kitchen: number; waste: number }>();
  rangeOutflows.forEach((entry) => {
    const date = text(entry.date);
    const current = outflowByDate.get(date) || { total: 0, kitchen: 0, waste: 0 };
    current.total += won(entry.totalCost);
    if (isKitchenConsumptionEntry(entry)) current.kitchen += won(entry.totalCost);
    else current.waste += won(entry.totalCost);
    outflowByDate.set(date, current);
  });
  const dailyRows: Array<Array<SpreadsheetValue>> = reports.map(({ date, report }) => {
    const close = closeByDate.get(date);
    const outflow = outflowByDate.get(date) || { total: 0, kitchen: 0, waste: 0 };
    const delivery = deliveryByDate.get(date)!;
    return [
      date,
      report.revenue,
      report.taxableSales,
      report.cashSales,
      report.bankSales,
      report.cost,
      report.grossProfit,
      report.otherIncome,
      report.totalExpenses,
      report.netProfit,
      outflow.kitchen,
      outflow.waste,
      report.itemCount,
      signedNumber(close?.difference),
      delivery.total.revenue,
      delivery.buckets.get("coupang")!.revenue,
      delivery.buckets.get("baemin")!.revenue,
      delivery.buckets.get("yogiyo")!.revenue,
      delivery.buckets.get("legacy")!.revenue,
    ];
  });

  const activeEntries = selectActiveFinancialEntries(records(state.financialEntries));
  const rangeOilEntries = activeEntries.filter((entry) => (
    selectedDates.has(text(entry.date)) && isOilLedgerEntry(entry)
  ));
  const oilSummary = summarizeOilLedger(rangeOilEntries);
  const supplierIds = new Set([
    ...suppliers.map((supplier) => text(supplier.id)).filter(Boolean),
    ...supplierTransactions.map((entry) => entry.supplierId),
    ...supplierReturns.map((entry) => entry.supplierId),
  ]);
  const supplierSummaryValues = [...supplierIds].map((supplierId) => {
    const supplier = supplierById.get(supplierId);
    const allRows = supplierTransactions.filter((entry) => entry.supplierId === supplierId);
    const opening = allRows
      .filter((entry) => entry.date < from)
      .reduce((sum, entry) => sum + (entry.type === "purchase" ? entry.amount : -entry.amount), 0);
    const periodRows = allRows.filter((entry) => selectedDates.has(entry.date));
    const purchases = periodRows
      .filter((entry) => entry.type === "purchase")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const payments = periodRows
      .filter((entry) => entry.type === "payment")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const closing = opening + purchases - payments;
    const current = allRows.reduce((sum, entry) => (
      sum + (entry.type === "purchase" ? entry.amount : -entry.amount)
    ), 0);
    const periodPurchases = periodRows.filter((entry) => entry.type === "purchase");
    const fullyPaid = periodPurchases
      .filter((entry) => supplierSettlements[entry.id]?.status === "paid")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const returned = supplierReturns
      .filter((entry) => entry.supplierId === supplierId)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const storedBalance = supplier ? signedNumber(supplier.balance) : null;
    const balanceDifference = storedBalance === null ? 0 : storedBalance - current;
    return {
      supplierId,
      opening,
      purchases,
      payments,
      closing,
      current,
      storedBalance,
      balanceDifference,
      rows: [
        supplierName(supplierId),
        Math.max(0, current),
        Math.max(0, -current),
        fullyPaid,
        returned,
      ] as Array<SpreadsheetValue>,
    };
  }).sort((left, right) => supplierName(left.supplierId).localeCompare(supplierName(right.supplierId)));
  const supplierSummaryRows = supplierSummaryValues.map((entry) => entry.rows);
  const supplierTotals = supplierSummaryValues.reduce((result, entry) => ({
    openingDebt: result.openingDebt + Math.max(0, entry.opening),
    openingAdvance: result.openingAdvance + Math.max(0, -entry.opening),
    purchases: result.purchases + entry.purchases,
    payments: result.payments + entry.payments,
    closingDebt: result.closingDebt + Math.max(0, entry.closing),
    closingAdvance: result.closingAdvance + Math.max(0, -entry.closing),
    currentDebt: result.currentDebt + Math.max(0, entry.current),
    currentAdvance: result.currentAdvance + Math.max(0, -entry.current),
    balanceDifference: result.balanceDifference + Math.abs(entry.balanceDifference),
    mismatchCount: result.mismatchCount + (entry.storedBalance !== null && entry.balanceDifference !== 0 ? 1 : 0),
  }), {
    openingDebt: 0,
    openingAdvance: 0,
    purchases: 0,
    payments: 0,
    closingDebt: 0,
    closingAdvance: 0,
    currentDebt: 0,
    currentAdvance: 0,
    balanceDifference: 0,
    mismatchCount: 0,
  });
  const supplierFormulaDifference = accountingDifference(
    supplierSummaryValues.reduce((sum, entry) => sum + entry.closing, 0)
    - supplierSummaryValues.reduce((sum, entry) => sum + entry.opening + entry.purchases - entry.payments, 0),
  );
  if (supplierFormulaDifference !== 0) {
    throw new Error("Yetkazib beruvchi qarzi formulasi mos kelmadi. Hisobot chiqarilmadi.");
  }

  const expenseRows: Array<Array<SpreadsheetValue>> = activeEntries
    .filter((entry) => (
      selectedDates.has(text(entry.date))
      && text(entry.type) === "expense"
      && entry.affectsProfit !== false
      && !reportCoversExpenseCategory(reportByDate.get(text(entry.date)), text(entry.category))
    ))
    .sort((left, right) => `${text(left.date)}|${text(left.id)}`.localeCompare(`${text(right.date)}|${text(right.id)}`))
    .map((entry) => {
      const account = accountById.get(text(entry.accountId));
      const description = isOilLedgerEntry(entry)
        ? `${text(entry.note)} · ${number(entry.oilCanCount)} ta / ${number(entry.oilLiters)} L · 1 ta ${won(entry.oilUnitAmount).toLocaleString("en-US")} ₩`
        : text(entry.note);
      return [
        text(entry.date),
        "Xarajat",
        text(entry.category) || "Boshqa xarajat",
        description,
        won(entry.amount),
        entry.fixedExpenseId ? "Oylik avtomatik xarajat" : "Qo‘lda kiritilgan xarajat",
        text(account?.name),
      ];
    });

  reports.forEach(({ date, report }) => {
    const automaticRows: Array<[string, number]> = [
      ["POS / karta komissiyasi", report.cardCommission],
      ["Yetkazib berish komissiyasi", report.deliveryCommission],
      ["Soliq", report.tax],
      ["Kunlik ish haqi", report.payroll],
    ];
    automaticRows.forEach(([category, value]) => {
      const isPayroll = category === "Kunlik ish haqi";
      if (isPayroll ? value === 0 : value <= 0) return;
      expenseRows.push([
        date,
        "Xarajat",
        category,
        "HALO Control sozlamasidan avtomatik hisoblandi",
        value,
        "Avtomatik hisob",
        "",
      ]);
    });
    if (report.inventoryOnlyCost > 0) {
      expenseRows.push([
        date,
        "Xarajat",
        "Nosavdo ombor chiqimi",
        `Yeyilgan ${won(report.kitchenOutflowCost).toLocaleString("en-US")} ₩ · chiqit ${won(report.wasteOutflowCost).toLocaleString("en-US")} ₩`,
        report.inventoryOnlyCost,
        "Ombordan avtomatik tannarx",
        "",
      ]);
    }
  });
  expenseRows.sort((left, right) => `${left[0]}|${left[1]}`.localeCompare(`${right[0]}|${right[1]}`));

  const incomeRows: Array<Array<SpreadsheetValue>> = activeEntries
    .filter((entry) => (
      selectedDates.has(text(entry.date))
      && text(entry.type) === "income"
      && entry.affectsProfit !== false
    ))
    .sort((left, right) => `${text(left.date)}|${text(left.id)}`.localeCompare(`${text(right.date)}|${text(right.id)}`))
    .map((entry) => {
      const account = accountById.get(text(entry.accountId));
      const description = isOilLedgerEntry(entry)
        ? `${text(entry.note)} · ${number(entry.oilCanCount)} ta / ${number(entry.oilLiters)} L · 1 ta ${won(entry.oilUnitAmount).toLocaleString("en-US")} ₩`
        : text(entry.note);
      return [
        text(entry.date),
        "Kirim",
        text(entry.category) || "Boshqa kirim",
        description,
        won(entry.amount),
        "Qo‘lda kiritilgan kirim",
        text(account?.name),
      ];
    });
  const settlementRows: Array<Array<SpreadsheetValue>> = activeEntries
    .filter((entry) => selectedDates.has(text(entry.date)) && entry.affectsProfit === false)
    .map((entry) => {
      const account = accountById.get(text(entry.accountId));
      return [
        text(entry.date),
        text(entry.type) === "income" ? "Kirim" : text(entry.type) === "transfer" ? "O‘tkazma" : "Pul chiqimi",
        text(entry.category) || "Hisob yopilishi",
        text(entry.note),
        won(entry.amount),
        "Foydaga qayta ta’sir qilmaydi",
        text(account?.name),
      ];
    });
  const moneyRows = [...expenseRows, ...incomeRows, ...settlementRows]
    .sort((left, right) => `${left[0]}|${left[1]}|${left[2]}`.localeCompare(`${right[0]}|${right[1]}|${right[2]}`));

  const outflowRows: Array<Array<SpreadsheetValue>> = rangeOutflows
    .sort((left, right) => `${text(left.date)}|${text("createdAt" in left ? left.createdAt : "")}`.localeCompare(`${text(right.date)}|${text("createdAt" in right ? right.createdAt : "")}`))
    .map((entry) => [
      text(entry.date),
      outflowKindLabel(text(entry.kind)),
      outflowName(entry),
      number(entry.quantity),
      text(entry.unit) || "birlik",
      won(entry.totalCost),
      text(entry.note) || text("reason" in entry ? entry.reason : ""),
    ]);

  const inventoryRows: Array<Array<SpreadsheetValue>> = inventoryRecords
    .slice()
    .sort((left, right) => text(left.name).localeCompare(text(right.name)))
    .map((item) => {
      const rawStock = Number(item.stock);
      const stock = Number.isFinite(rawStock) ? rawStock : 0;
      const unitCost = number(item.unitCost);
      const minStock = number(item.minStock);
      return [
        text(item.name),
        categories.get(text(item.categoryId)) || "Boshqa",
        stock,
        text(item.unit) || "birlik",
        unitCost,
        Math.round(Math.max(0, stock) * unitCost),
        minStock,
        stock <= 0 ? "TUGAGAN" : minStock > 0 && stock <= minStock ? "KAM" : "YETARLI",
      ];
    });
  const currentInventoryValue = inventoryRows.reduce((sum, row) => sum + Number(row[5] || 0), 0);

  const payrollStaff = normalizeStaff(state.staff);
  const payrollShifts = normalizeWorkShifts(state.workShifts);
  const payrollAdjustments = normalizePayrollAdjustments(state.payrollAdjustments);
  const attendanceDays = normalizeAttendanceDays(state.attendanceDays);
  const payrollPayments = normalizePayrollPayments(state.payrollPayments);
  const payrollRows: Array<Array<SpreadsheetValue>> = monthRange(from, to).flatMap((month) => (
    payrollStaff.flatMap((member) => {
      const summary = calculatePayroll(member, payrollShifts, payrollAdjustments, month, {
        attendanceDays,
        payments: payrollPayments,
      });
      if (!member.active && summary.workedDays === 0 && summary.grossPay === 0 && summary.paymentAmount === 0 && summary.advance === 0) return [];
      return [[
        month,
        member.name,
        member.payType === "hourly" ? "Soatbay" : "Oylik",
        summary.workedDays,
        Number((summary.workedMinutes / 60).toFixed(2)),
        Math.round(summary.bonus),
        Math.round(summary.advance),
        Math.round(summary.deduction),
        Math.round(summary.grossPay),
        Math.round(summary.paymentAmount),
        Math.round(summary.remaining),
      ] as Array<SpreadsheetValue>];
    })
  ));

  const productAnalysis = new Map<string, {
    code: string;
    allCodes: string;
    name: string;
    quantity: number;
    revenue: number;
    cost: number;
    missingCostSaleCount: number;
    automaticRevenue: number;
    accountantRevenue: number;
    deliveryRevenueByBucket: Record<DeliveryBucket, number>;
  }>();
  recipes.forEach((recipe) => {
    const recipeId = text(recipe.id);
    if (!recipeId) return;
    productAnalysis.set(recipeId, {
      code: preferredMenuCode(recipe),
      allCodes: allMenuCodes(recipe).join(" · "),
      name: text(recipe.name) || "Nomsiz mahsulot",
      quantity: 0,
      revenue: 0,
      cost: 0,
      missingCostSaleCount: 0,
      automaticRevenue: 0,
      accountantRevenue: 0,
      deliveryRevenueByBucket: { coupang: 0, baemin: 0, yogiyo: 0, legacy: 0 },
    });
  });
  rangeSales.forEach((sale) => {
    const recipe = recipeById.get(text(sale.recipeId));
    const account = accountById.get(text(sale.accountId));
    const accountType = text(account?.type) || "card";
    const recipeId = text(sale.recipeId) || `deleted:${text(sale.id)}`;
    const current = productAnalysis.get(recipeId) || {
      code: recipe ? preferredMenuCode(recipe) : "",
      allCodes: recipe ? allMenuCodes(recipe).join(" · ") : "",
      name: text(recipe?.name) || "O‘chirilgan taom",
      quantity: 0,
      revenue: 0,
      cost: 0,
      missingCostSaleCount: 0,
      automaticRevenue: 0,
      accountantRevenue: 0,
      deliveryRevenueByBucket: { coupang: 0, baemin: 0, yogiyo: 0, legacy: 0 },
    };
    current.quantity += number(sale.quantity);
    current.revenue += won(sale.totalRevenue);
    current.cost += won(sale.totalCost);
    if (number(sale.quantity) > 0 && won(sale.totalRevenue) > 0 && won(sale.totalCost) <= 0) {
      current.missingCostSaleCount += 1;
    }
    if (saleTaxTreatment(sale, accountType) === "automatic") current.automaticRevenue += won(sale.totalRevenue);
    else current.accountantRevenue += won(sale.totalRevenue);
    if (isDeliverySale(sale, accountType)) {
      current.deliveryRevenueByBucket[deliveryBucketForSale(sale)] += won(sale.totalRevenue);
    }
    productAnalysis.set(recipeId, current);
  });
  const productAnalysisRows: Array<Array<SpreadsheetValue>> = [...productAnalysis.entries()]
    .sort(([, left], [, right]) => right.revenue - left.revenue || right.quantity - left.quantity || left.name.localeCompare(right.name))
    .map(([recipeId, item]) => {
      const recipe = recipeById.get(recipeId);
      const historicalCostReady = item.missingCostSaleCount === 0;
      const audit = recipe ? currentRecipeAuditById.get(recipeId)! : null;
      const status = !historicalCostReady
        ? "SOTUV TANNARXI 0 — TEKSHIRING"
        : !recipe
          ? "MAHSULOT O‘CHIRILGAN — FAQAT TARIXIY HISOB"
          : audit!.status;
      return [
        item.code,
        item.name,
        item.quantity,
        item.revenue,
        historicalCostReady ? item.cost : null,
        historicalCostReady ? item.revenue - item.cost : null,
        historicalCostReady && item.revenue ? (item.revenue - item.cost) / item.revenue : null,
        audit?.salePrice || null,
        audit?.complete ? audit.totalCost : null,
        audit?.grossProfit ?? null,
        audit?.marginRatio ?? null,
        status,
        item.automaticRevenue,
        item.accountantRevenue,
        item.allCodes,
        Object.values(item.deliveryRevenueByBucket).reduce((sum, value) => sum + value, 0),
        item.deliveryRevenueByBucket.coupang,
        item.deliveryRevenueByBucket.baemin,
        item.deliveryRevenueByBucket.yogiyo,
        item.deliveryRevenueByBucket.legacy,
      ];
    });

  const deliveryDetailRows: Array<Array<SpreadsheetValue>> = rangeDeliverySales
    .slice()
    .sort((left, right) => (
      `${text(left.date)}|${text(left.soldAt) || text("createdAt" in left ? left.createdAt : "")}|${text(left.id)}`
        .localeCompare(`${text(right.date)}|${text(right.soldAt) || text("createdAt" in right ? right.createdAt : "")}|${text(right.id)}`)
    ))
    .map((sale) => {
      const recipe = recipeById.get(text(sale.recipeId));
      const timestamp = text(sale.soldAt) || text(sale.createdAt);
      const commissionPercent = deliveryCommissionPercent(sale, deliveryFallbackCommissionPct);
      const commission = deliveryCommissionAmount(sale, deliveryFallbackCommissionPct);
      const revenue = won(sale.totalRevenue);
      const cost = won(sale.totalCost);
      return [
        text(sale.date),
        timestamp ? seoulTimeInputValue(timestamp, "") : "",
        isDeliveryPlatform(sale.deliveryPlatform)
          ? deliveryPlatformLabel(sale.deliveryPlatform)
          : "Delivery / Eski",
        text(sale.deliveryOrderNumber),
        recipe ? preferredMenuCode(recipe) : "",
        text(recipe?.name) || "O‘chirilgan taom",
        number(sale.quantity),
        revenue,
        cost,
        commissionPercent / 100,
        commission,
        revenue - commission,
        revenue - cost - commission,
      ];
    });

  const summarize = (selected: typeof reports) => selected.reduce((result, { report }) => ({
    revenue: result.revenue + report.revenue,
    cost: result.cost + report.cost,
    grossProfit: result.grossProfit + report.grossProfit,
    expenses: result.expenses + report.totalExpenses,
    outflowCost: result.outflowCost + report.inventoryOnlyCost,
    kitchenOutflowCost: result.kitchenOutflowCost + report.kitchenOutflowCost,
    wasteCost: result.wasteCost + report.wasteOutflowCost,
    netProfit: result.netProfit + report.netProfit,
    itemCount: result.itemCount + report.itemCount,
    cashSales: result.cashSales + report.cashSales,
    bankSales: result.bankSales + report.bankSales,
    cardSales: result.cardSales + report.cardSales,
    deliverySales: result.deliverySales + report.deliverySales,
    taxableSales: result.taxableSales + report.taxableSales,
    accountantManagedSales: result.accountantManagedSales + report.accountantManagedSales,
    enteredExpenses: result.enteredExpenses + report.enteredExpenses,
    recurringExpenses: result.recurringExpenses + report.recurringExpenses,
    cardCommission: result.cardCommission + report.cardCommission,
    deliveryCommission: result.deliveryCommission + report.deliveryCommission,
    tax: result.tax + report.tax,
    payroll: result.payroll + report.payroll,
    otherIncome: result.otherIncome + report.otherIncome,
  }), {
    revenue: 0,
    cost: 0,
    grossProfit: 0,
    expenses: 0,
    outflowCost: 0,
    kitchenOutflowCost: 0,
    wasteCost: 0,
    netProfit: 0,
    itemCount: 0,
    cashSales: 0,
    bankSales: 0,
    cardSales: 0,
    deliverySales: 0,
    taxableSales: 0,
    accountantManagedSales: 0,
    enteredExpenses: 0,
    recurringExpenses: 0,
    cardCommission: 0,
    deliveryCommission: 0,
    tax: 0,
    payroll: 0,
    otherIncome: 0,
  });
  const totals = summarize(reports);
  const productTotals = [...productAnalysis.values()].reduce((result, item) => ({
    revenue: result.revenue + item.revenue,
    cost: result.cost + item.cost,
    quantity: result.quantity + item.quantity,
    automaticRevenue: result.automaticRevenue + item.automaticRevenue,
    accountantRevenue: result.accountantRevenue + item.accountantRevenue,
  }), { revenue: 0, cost: 0, quantity: 0, automaticRevenue: 0, accountantRevenue: 0 });
  // Dish margins retain the full recipe estimate. Expense-only ingredients are
  // already recognized at purchase, so reconcile the financial COGS separately.
  // Legacy sales have no expenseOnlyCost and keep their original treatment.
  const purchaseExpensedRecipeCost = rangeSales.reduce((sum, sale) => (
    sum + won(sale.totalCost) - won(Math.max(0, number(sale.totalCost) - number(sale.expenseOnlyCost)))
  ), 0);
  const accountingChecks = {
    sales: accountingDifference(totals.revenue - totals.taxableSales - totals.accountantManagedSales),
    grossProfit: accountingDifference(totals.grossProfit - (totals.revenue - totals.cost)),
    expenses: accountingDifference(totals.expenses - (
      totals.enteredExpenses
      + totals.recurringExpenses
      + totals.cardCommission
      + totals.deliveryCommission
      + totals.tax
      + totals.payroll
      + totals.outflowCost
    )),
    netProfit: accountingDifference(totals.netProfit - (totals.grossProfit + totals.otherIncome - totals.expenses)),
    outflow: accountingDifference(totals.outflowCost - totals.kitchenOutflowCost - totals.wasteCost),
    productRevenue: accountingDifference(totals.revenue - productTotals.revenue),
    productCost: accountingDifference(totals.cost - (productTotals.cost - purchaseExpensedRecipeCost)),
    productQuantity: accountingDifference(totals.itemCount - productTotals.quantity),
    productTaxStreams: accountingDifference(
      productTotals.revenue - productTotals.automaticRevenue - productTotals.accountantRevenue,
    ),
  };
  if (Object.values(accountingChecks).some((difference) => difference !== 0)) {
    throw new Error("Google Sheets hisob tekshiruvi mos kelmadi. Noto‘g‘ri summa chiqarilmadi.");
  }
  const soldWithoutHistoricalCost = [...productAnalysis.values()]
    .filter((item) => item.missingCostSaleCount > 0).length;
  const soldWithIncompleteCurrentCost = [...productAnalysis.keys()]
    .filter((recipeId) => {
      const audit = currentRecipeAuditById.get(recipeId);
      return audit ? !audit.complete : false;
    }).length;
  const dataWarnings = [
    ...(soldWithoutHistoricalCost ? [`${soldWithoutHistoricalCost} TA MAHSULOTDA SOTUV TANNARXI 0`] : []),
    ...(soldWithIncompleteCurrentCost ? [`${soldWithIncompleteCurrentCost} TA JORIY RETSEPT TANNARXI TO‘LIQ EMAS`] : []),
    ...(supplierTotals.mismatchCount ? [`${supplierTotals.mismatchCount} TA YETKAZUVCHI BALANSI`] : []),
  ];
  const overallCheck = dataWarnings.length ? `TEKSHIRING: ${dataWarnings.join("; ")}` : "MOS ✓";
  const bestDay = totals.revenue > 0
    ? reports.slice().sort((left, right) => right.report.revenue - left.report.revenue)[0]
    : null;
  const bestProduct = productAnalysisRows[0];
  const returnedTotal = supplierReturns.reduce((sum, entry) => sum + entry.amount, 0);
  const payrollExportTotals = payrollRows.reduce((result, row) => ({
    gross: result.gross + Number(row[8] || 0),
    paid: result.paid + Number(row[9] || 0) + Number(row[6] || 0),
    remaining: result.remaining + Number(row[10] || 0),
  }), { gross: 0, paid: 0, remaining: 0 });
  const deliveryReportRows: Array<Array<SpreadsheetValue>> = [
    ["— DELIVERY SAVDO —", ""],
    ["Delivery jami savdo (₩)", deliveryRangeSummary.revenue],
    ["Delivery jami buyurtma", deliveryRangeSummary.orderKeys.size],
    ["Delivery jami komissiya (₩)", deliveryRangeSummary.commission],
    ["Delivery hisobga tushadi (₩)", deliveryRangeSummary.settlement],
    ["Delivery sof foyda (₩)", deliveryRangeSummary.profit],
    ...DELIVERY_EXPORT_BUCKETS.flatMap((bucket) => {
      const summary = deliveryRangeByBucket.get(bucket.id)!;
      return [
        [`${bucket.label} · savdo (₩)`, summary.revenue],
        [`${bucket.label} · buyurtma`, summary.orderKeys.size],
        [`${bucket.label} · komissiya (₩)`, summary.commission],
        [`${bucket.label} · hisobga tushadi (₩)`, summary.settlement],
        [`${bucket.label} · sof foyda (₩)`, summary.profit],
      ];
    }),
  ];

  return {
    exportVersion: GOOGLE_SHEETS_EXPORT_VERSION,
    from,
    to,
    generatedAt: new Date().toISOString(),
    totals,
    sheets: [
      safeTable("HALO HISOBOT", ["Ko‘rsatkich", "Natija"], [
        ["Boshlanish sanasi", from],
        ["Tugash sanasi", to],
        ["Hisob tekshiruvi", overallCheck],
        ["Foyda va soliq izohi", "Sof foyda ustuni boshqaruv uchun hisobiy natija. Soliq foizi — reja zaxirasi, deklaratsiya emas. Tannarx saqlangan retsept asosida; hujjatlar bilan solishtiring."],
        ["— SAVDO VA FOYDA —", ""],
        ["Jami savdo (₩)", totals.revenue],
        ["POS / kiosk (₩)", totals.taxableSales],
        ["Naqd savdo (₩)", totals.cashSales],
        ["Hisob-raqam savdosi (₩)", totals.bankSales],
        ["Tannarx (₩)", totals.cost],
        ["Yalpi foyda (₩)", totals.grossProfit],
        ["Jami xarajat (₩)", totals.expenses],
        ["Boshqa kirim (₩)", totals.otherIncome],
        ["Sof foyda (₩)", totals.netProfit],
        ["Sof foyda marjasi", totals.revenue ? totals.netProfit / totals.revenue : 0],
        ...deliveryReportRows,
        ["— XARAJAT TARKIBI —", ""],
        ["Qo‘lda kiritilgan (₩)", totals.enteredExpenses],
        ["Oylik avtomatik xarajat (₩)", totals.recurringExpenses],
        ["Karta / POS komissiyasi (₩)", totals.cardCommission],
        ["Delivery komissiyasi (₩)", totals.deliveryCommission],
        ["Avtomatik soliq (₩)", totals.tax],
        ["Ish haqi (₩)", totals.payroll],
        ["— OMBOR —", ""],
        ["Hozirgi ombor qiymati (₩)", currentInventoryValue],
        ["Oshxonada yeyilgan (₩)", totals.kitchenOutflowCost],
        ["Chiqit / isrof (₩)", totals.wasteCost],
        ["— YETKAZIB BERUVCHILAR —", ""],
        ["Davrda mahsulot olindi (₩)", supplierTotals.purchases],
        ["Davrda pul to‘landi (₩)", supplierTotals.payments],
        ["Hozirgi qarz (₩)", supplierTotals.currentDebt],
        ["Hozirgi avans (₩)", supplierTotals.currentAdvance],
        ["Vozvrat qilindi (₩)", returnedTotal],
        ["— XODIMLAR —", ""],
        ["Hisoblangan oylik (₩)", payrollExportTotals.gross],
        ["Berilgan / avans (₩)", payrollExportTotals.paid],
        ["Qolgan oylik (₩)", payrollExportTotals.remaining],
        ["— CHICKEN MOYI —", ""],
        ["Yangi moy olindi", `${oilSummary.purchaseCans} ta / ${oilSummary.purchaseLiters} L`],
        ["O‘rtacha olish narxi, 18 L (₩)", oilSummary.averagePurchaseUnitAmount],
        ["Moy xarajati (₩)", oilSummary.purchaseCost],
        ["O‘rtacha sotish narxi, 18 L (₩)", oilSummary.averageResaleUnitAmount],
        ["Ishlatilgan moy sotildi (₩)", oilSummary.resaleIncome],
        ["Sotish − olish farqi, 18 L (₩)", oilSummary.averageUnitDifference],
        ["Sof moy xarajati (₩)", oilSummary.netOilCost],
        ["— ENG YAXSHI NATIJA —", ""],
        ["Sotilgan dona", totals.itemCount],
        ["Eng yaxshi kun", bestDay?.date || "Ma’lumot yo‘q"],
        ["Eng yaxshi kun savdosi (₩)", bestDay?.report.revenue || 0],
        ["Eng ko‘p savdo qilgan mahsulot", bestProduct?.[1] || "Ma’lumot yo‘q"],
        ["Eng yaxshi mahsulot savdosi (₩)", Number(bestProduct?.[3] || 0)],
      ]),
      safeTable("HALO KUNLIK", [
        "Sana", "Jami savdo (₩)", "POS / kiosk (₩)", "Naqd (₩)", "Hisob-raqam (₩)",
        "Tannarx (₩)", "Yalpi foyda (₩)", "Boshqa kirim (₩)", "Jami xarajat (₩)", "Sof foyda (₩)",
        "Oshxonada yeyilgan (₩)", "Chiqit / isrof (₩)", "Sotilgan dona", "Kun yakuni farqi (₩)",
        "Delivery jami (₩)", "Coupang Eats (₩)", "Baemin (₩)", "Yogiyo (₩)", "Delivery / Eski (₩)",
      ], dailyRows),
      safeTable("HALO SAVDO", [
        "Kod", "Mahsulot", "Sotilgan dona", "Sotuv summasi (₩)",
        "Sotuv paytidagi tannarx (₩)", "Sotuv paytidagi foyda (₩)", "Sotuv paytidagi marja %",
        "HALO joriy menyu narxi (₩)", "HALO joriy retsept tannarxi (₩)", "HALO joriy foyda (₩)",
        "HALO joriy retsept marjasi %", "Tannarx holati",
        "POS / kiosk (₩)", "Naqd + hisob-raqam (₩)", "Barcha POS kodlari",
        "Delivery jami (₩)", "Coupang Eats (₩)", "Baemin (₩)", "Yogiyo (₩)", "Delivery / Eski (₩)",
      ], productAnalysisRows),
      safeTable("HALO DELIVERY", [
        "Sana", "Vaqt", "Platforma", "Buyurtma raqami", "Kod", "Mahsulot", "Soni",
        "Savdo (₩)", "Tannarx (₩)", "Komissiya %", "Komissiya (₩)",
        "Hisobga tushadi (₩)", "Sof foyda (₩)",
      ], deliveryDetailRows),
      safeTable("HALO PUL HARAKATI", [
        "Sana", "Turi", "Kategoriya", "Tavsif", "Summa (₩)", "Hisoblash turi", "Hisob",
      ], moneyRows),
      safeTable("HALO OMBOR", [
        "Mahsulot", "Kategoriya", "Qoldiq", "Birlik", "Birlik tannarxi (₩)", "Ombor qiymati (₩)",
        "Minimal qoldiq", "Holat",
      ], inventoryRows),
      safeTable("HALO CHIQIM", [
        "Sana", "Turi", "Taom yoki mahsulot", "Miqdor", "Birlik", "Tannarx (₩)", "Izoh",
      ], outflowRows),
      safeTable("HALO YETKAZUVCHILAR", [
        "Yetkazib beruvchi", "QARZ (₩)", "AVANS (₩)", "TO‘LIQ TO‘LANDI (₩)", "VOZVRAT QILINDI (₩)",
      ], supplierSummaryRows),
      safeTable("HALO XODIMLAR", [
        "Oy", "Xodim", "Oylik turi", "Ishlagan kun", "Ishlagan soat", "Bonus (₩)", "Avans (₩)",
        "Ayrilgan (₩)", "Hisoblangan oylik (₩)", "To‘langan (₩)", "Qolgan (₩)",
      ], payrollRows),
      safeTable("HALO SABZAVOT SARFI", ["Sana", "Mahsulot", "Miqdor", "Summa (₩)", "Yetkazib beruvchi"], vegetablePeriodTotals(state, from, to).purchases.map(p => [p.date, p.name, `${p.quantity} ${p.unit}`, p.amount, p.supplierName])),
    ],
  };
}

function cleanGoogleSheetsAppsScript(input: {
  endpoint: string;
  apiKey: string;
  branchId: string;
  days: number;
}) {
  return `const HALO_CONFIG = Object.freeze({
  scriptVersion: "3.4",
  exportVersion: ${JSON.stringify(GOOGLE_SHEETS_EXPORT_VERSION)},
  endpoint: ${JSON.stringify(input.endpoint)},
  apiKey: ${JSON.stringify(input.apiKey)},
  branchId: ${JSON.stringify(input.branchId)},
  days: ${input.days},
  timezone: "Asia/Seoul"
});

const HALO_REPORT_SHEETS = [
  "HALO HISOBOT",
  "HALO KUNLIK",
  "HALO SAVDO",
  "HALO DELIVERY",
  "HALO PUL HARAKATI",
  "HALO OMBOR",
  "HALO CHIQIM",
  "HALO YETKAZUVCHILAR",
  "HALO XODIMLAR",
  "HALO SABZAVOT SARFI"
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("HALO CONTROL")
    .addItem("Hisobotni ochish", "HALO_OPEN_REPORT")
    .addItem("Sana oralig‘ini tanlash", "HALO_OPEN_DATE_RANGE")
    .addItem("Hozir yangilash", "HALO_SYNC")
    .addItem("Grafiklarni yangilash", "HALO_REFRESH_CHARTS")
    .addSeparator()
    .addItem("1 daqiqalik avtomatik yangilashni yoqish", "HALO_SETUP")
    .addToUi();
}

function HALO_OPEN_REPORT() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName("HALO HISOBOT");
  if (!sheet) {
    HALO_SYNC();
    sheet = book.getSheetByName("HALO HISOBOT");
  }
  if (!sheet) throw new Error("HALO HISOBOT oynasi yaratilmadi.");
  haloEnsureDateRange_(sheet);
  sheet.activate();
  book.toast("B2 va B3 kataklaridan sana tanlang. Bitta kun uchun ikkala sanani ham bir xil qo‘ying.", "HALO HISOBOT", 9);
}

function HALO_OPEN_DATE_RANGE() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName("HALO HISOBOT");
  if (!sheet) {
    HALO_SYNC();
    sheet = book.getSheetByName("HALO HISOBOT");
  }
  if (!sheet) throw new Error("HALO HISOBOT oynasi yaratilmadi.");
  haloEnsureDateRange_(sheet);
  sheet.activate();
  book.setActiveRange(sheet.getRange("B2:B3"));
  book.toast("Sariq B2 va B3 kataklaridan sanani tanlang.", "SANA ORALIG‘I", 7);
}

function HALO_SETUP() {
  const book = SpreadsheetApp.getActive();
  book.setSpreadsheetTimeZone(HALO_CONFIG.timezone);
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) { return ["HALO_SYNC", "HALO_DATE_EDIT"].indexOf(trigger.getHandlerFunction()) >= 0; })
    .forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  HALO_SYNC({ haloSetup: true });
  ScriptApp.newTrigger("HALO_SYNC").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("HALO_DATE_EDIT").forSpreadsheet(book).onEdit().create();
  const handlers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
  if (handlers.indexOf("HALO_SYNC") < 0 || handlers.indexOf("HALO_DATE_EDIT") < 0) {
    haloTrySyncStatus_("XATO", "Avtomatik yangilash vazifasi yaratilmadi");
    throw new Error("Avtomatik yangilash vazifasi yaratilmadi. HALO_SETUP’ni qayta ishga tushiring.");
  }
  haloTrySyncStatus_("ISHLAYAPTI", "HALO’dagi yangi ma’lumotlar 1 daqiqa ichida avtomatik tushadi");
  const report = book.getSheetByName("HALO HISOBOT");
  if (report) report.activate();
  book.toast("Tayyor: 10 ta aniq hisobot oynasi avtomatik yangilanadi", "HALO ULANDI", 9);
}

function HALO_SYNC(event) {
  const silent = Boolean(event && (event.triggerUid || event.haloSetup));
  try {
    const selected = haloSelectedRange_();
    haloFetchAndWrite_(selected.from, selected.to, silent);
    if (!silent) haloTrySyncStatus_("ISHLAYAPTI", "Oxirgi tekshiruv muvaffaqiyatli. HALO o‘zgarsa avtomatik yangilanadi");
  } catch (error) {
    haloTrySyncStatus_("XATO", error && error.message ? error.message : String(error || "Noma’lum xato"));
    throw error;
  }
}

function HALO_REFRESH_CHARTS() {
  const book = SpreadsheetApp.getActive();
  haloBuildAnalysisCharts_(book);
  book.toast("Grafiklar yangilandi.", "HALO HISOBOT", 5);
}

function HALO_DATE_EDIT(event) {
  if (!event || !event.range || event.range.getSheet().getName() !== "HALO HISOBOT") return;
  const range = event.range;
  const firstRow = range.getRow();
  const lastRow = firstRow + range.getNumRows() - 1;
  const firstColumn = range.getColumn();
  const lastColumn = firstColumn + range.getNumColumns() - 1;
  const editsB2 = firstRow <= 2 && lastRow >= 2 && firstColumn <= 2 && lastColumn >= 2;
  const editsB3 = firstRow <= 3 && lastRow >= 3 && firstColumn <= 2 && lastColumn >= 2;
  if (!editsB2 && !editsB3) return;
  try {
    const selected = haloSelectedRange_();
    haloFetchAndWrite_(selected.from, selected.to, false);
    haloTrySyncStatus_("ISHLAYAPTI", selected.from + " — " + selected.to + " hisoboti yangilandi");
  } catch (error) {
    SpreadsheetApp.getActive().toast(error && error.message ? error.message : String(error), "SANA XATO", 8);
  }
}

function haloTrySyncStatus_(status, detail) {
  try {
    haloSyncStatus_(status, detail);
  } catch (error) {
    console.log("HALO holat oynasi vaqtincha yangilanmadi: " + String(error));
  }
}

function haloSyncStatus_(status, detail) {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName("HALO ULANISH");
  if (!sheet) sheet = book.insertSheet("HALO ULANISH", 0);
  const handlers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
  const automatic = handlers.indexOf("HALO_SYNC") >= 0;
  const checkedAt = Utilities.formatDate(new Date(), HALO_CONFIG.timezone, "yyyy-MM-dd HH:mm:ss");
  sheet.getRange("A1:B6").setValues([
    ["HALO → GOOGLE SHEETS", "AVTOMATIK ALOQA"],
    ["Holat", status],
    ["Oxirgi tekshiruv", checkedAt],
    ["1 daqiqalik yangilash", automatic ? "YOQILGAN" : "HALO_SETUP KUTILMOQDA"],
    ["Izoh", detail],
    ["Kod versiyasi", HALO_CONFIG.scriptVersion]
  ]);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 430);
  sheet.getRange("A1:B1").setBackground("#15181b").setFontColor("#f4b41b").setFontWeight("bold");
  sheet.getRange("A2:A6").setBackground("#eef3ef").setFontWeight("bold");
  sheet.getRange("B2").setBackground(status === "ISHLAYAPTI" ? "#d9ead3" : status === "XATO" ? "#f4cccc" : "#fff2cc")
    .setFontColor(status === "ISHLAYAPTI" ? "#1b5e20" : status === "XATO" ? "#9c0006" : "#7f6000")
    .setFontWeight("bold");
  sheet.setTabColor(status === "ISHLAYAPTI" ? "#34a853" : status === "XATO" ? "#d93025" : "#f4b41b");
}

function haloFetchAndWrite_(from, to, silent) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    if (!silent) SpreadsheetApp.getActive().toast("Boshqa yangilash davom etmoqda. Bir ozdan keyin qayta urinib ko‘ring.", "HALO CONTROL", 6);
    return;
  }
  try {
    const properties = PropertiesService.getDocumentProperties();
    const rangeKey = from + "|" + to;
    const previousRange = properties.getProperty("HALO_LAST_RANGE") || "";
    const previousVersion = properties.getProperty("HALO_LAST_STATE_VERSION") || "";
    const previousExportVersion = properties.getProperty("HALO_LAST_EXPORT_VERSION") || "";
    let url = HALO_CONFIG.endpoint + "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
    if (previousRange === rangeKey && previousVersion) {
      url += "&if_updated_at=" + encodeURIComponent(previousVersion);
      url += "&if_export_version=" + encodeURIComponent(previousExportVersion);
    }
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + HALO_CONFIG.apiKey },
      muteHttpExceptions: true
    });
    const payload = JSON.parse(response.getContentText() || "{}");
    if (response.getResponseCode() === 401) {
      throw new Error("HALO ulanish kaliti bekor bo‘lgan. HALO Control ichidan yangi kod yarating, Code.gs kodini to‘liq almashtiring va HALO_SETUP’ni ishga tushiring.");
    }
    if (response.getResponseCode() !== 200 || !payload.ok) throw new Error(payload.error || "HALO Control ma’lumoti olinmadi");
    if (payload.branchId !== HALO_CONFIG.branchId) throw new Error("Filial mos kelmadi. Google Sheets kodi shu filial uchun qayta yaratilishi kerak.");
    if (payload.from !== from || payload.to !== to) throw new Error("So‘ralgan sana bilan kelgan hisobot sanasi mos kelmadi. Eski hisobot saqlandi.");
    if (payload.exportVersion !== HALO_CONFIG.exportVersion) throw new Error("HALO va Google Sheets hisobot versiyasi mos kelmadi. HALO Control ichidan yangi Code.gs kodini oling.");
    if (payload.unchanged === true) {
      if (!silent) SpreadsheetApp.getActive().toast(from + " — " + to + " ma’lumoti o‘zgarmagan", "HALO CONTROL", 5);
      return;
    }
    if (!Array.isArray(payload.sheets) || !payload.sheets.every(haloValidSource_)) {
      throw new Error("HALO Control hisobotining qator yoki ustunlari mos kelmadi. Eski hisobot saqlandi.");
    }
    const sources = HALO_REPORT_SHEETS.map(function(name) {
      return payload.sheets.find(function(source) { return source.name === name; });
    });
    if (sources.some(function(source) { return !source; })) {
      throw new Error(HALO_REPORT_SHEETS.length + " ta majburiy hisobotdan biri kelmadi. Eski hisobot saqlandi.");
    }
    const book = SpreadsheetApp.getActive();
    sources.forEach(function(source) { haloWriteSheet_(book, source); });
    // Existing tabs are retained; the vegetable tab is additive.
    haloOrderSheets_(book);
    SpreadsheetApp.flush();
    properties.setProperties({
      HALO_LAST_SYNC: payload.generatedAt || new Date().toISOString(),
      HALO_LAST_STATE_VERSION: payload.updatedAt || "",
      HALO_LAST_EXPORT_VERSION: payload.exportVersion || "",
      HALO_LAST_RANGE: rangeKey,
      HALO_BRANCH_ID: payload.branchId,
      HALO_SCRIPT_VERSION: HALO_CONFIG.scriptVersion
    });
    if (!silent) book.toast(from + " — " + to + " bo‘yicha " + HALO_REPORT_SHEETS.length + " ta hisobot yangilandi", "HALO CONTROL", 7);
  } finally {
    lock.releaseLock();
  }
}

function haloValidSource_(source) {
  return source
    && typeof source.name === "string"
    && Array.isArray(source.headers)
    && source.headers.length > 0
    && Array.isArray(source.rows)
    && source.rows.every(function(row) { return Array.isArray(row) && row.length === source.headers.length; });
}

function haloRemoveLegacySheets_(book) {
  [
    "HALO DASHBOARD", "HALO KUNLIK TAHLIL", "HALO SANA TAHLILI", "HALO KUNLIK HISOBOT",
    "HALO KUNLIK SAVDO", "HALO XARAJATLAR", "HALO BOSHQA KIRIMLAR", "HALO CHICKEN MOYI",
    "HALO OMBOR CHIQIMI", "HALO MAHSULOT TAHLILI", "HALO MAHSULOTLAR",
    "HALO YETKAZUVCHI TAHLILI", "HALO OLDI-BERDI", "HALO NAKLADNOYLAR", "HALO QARZ TO‘LOVLARI"
  ].forEach(function(name) {
    const sheet = book.getSheetByName(name);
    if (sheet && book.getSheets().length > 1) book.deleteSheet(sheet);
  });
}

function haloOrderSheets_(book) {
  const connection = book.getSheetByName("HALO ULANISH");
  if (connection) {
    book.setActiveSheet(connection);
    book.moveActiveSheet(1);
  }
  HALO_REPORT_SHEETS.forEach(function(name, index) {
    const sheet = book.getSheetByName(name);
    if (!sheet) return;
    book.setActiveSheet(sheet);
    book.moveActiveSheet(index + 2);
  });
  const report = book.getSheetByName("HALO HISOBOT");
  if (report) report.activate();
}

function haloSelectedRange_() {
  const now = new Date();
  const start = new Date(now.getTime() - (HALO_CONFIG.days - 1) * 86400000);
  const fallback = {
    from: Utilities.formatDate(start, HALO_CONFIG.timezone, "yyyy-MM-dd"),
    to: Utilities.formatDate(now, HALO_CONFIG.timezone, "yyyy-MM-dd")
  };
  const sheet = SpreadsheetApp.getActive().getSheetByName("HALO HISOBOT");
  if (!sheet) return fallback;
  haloEnsureDateRange_(sheet, fallback);
  const from = haloIsoDate_(sheet.getRange("B2").getValue());
  const to = haloIsoDate_(sheet.getRange("B3").getValue());
  if (!from || !to) throw new Error("Boshlanish va tugash sanalarini to‘g‘ri kiriting.");
  const fromTime = new Date(from + "T00:00:00Z").getTime();
  const toTime = new Date(to + "T00:00:00Z").getTime();
  const rangeDays = Math.floor((toTime - fromTime) / 86400000) + 1;
  if (rangeDays < 1 || rangeDays > 366) throw new Error("Sana oralig‘i 1 kundan 366 kungacha bo‘lishi kerak.");
  return { from: from, to: to };
}

function haloEnsureDateRange_(sheet, fallback) {
  const now = new Date();
  const start = new Date(now.getTime() - (HALO_CONFIG.days - 1) * 86400000);
  const safeFallback = fallback || {
    from: Utilities.formatDate(start, HALO_CONFIG.timezone, "yyyy-MM-dd"),
    to: Utilities.formatDate(now, HALO_CONFIG.timezone, "yyyy-MM-dd")
  };
  const fromValue = sheet.getRange("B2").getValue();
  const toValue = sheet.getRange("B3").getValue();
  const currentFrom = haloIsoDate_(fromValue);
  const currentTo = haloIsoDate_(toValue);
  const labelsPresent = String(sheet.getRange("A2").getValue() || "") === "Boshlanish sanasi"
    && String(sheet.getRange("A3").getValue() || "") === "Tugash sanasi";
  if (!labelsPresent || !(fromValue instanceof Date) || !(toValue instanceof Date) || !currentFrom || !currentTo) {
    sheet.getRange("A2:B3").setValues([
      ["Boshlanish sanasi", new Date((currentFrom || safeFallback.from) + "T00:00:00Z")],
      ["Tugash sanasi", new Date((currentTo || safeFallback.to) + "T00:00:00Z")]
    ]);
  }
  ["B2", "B3"].forEach(function(address) {
    sheet.getRange(address)
      .setNumberFormat("yyyy-mm-dd")
      .setBackground("#fff3c4")
      .setFontColor("#15181b")
      .setFontWeight("bold")
      .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  });
  sheet.getRange("A2:A3").setBackground("#fff8df").setFontWeight("bold");
  sheet.getRange("B2").setNote("Boshlanish sanasi. Bitta kun uchun B2 va B3 sanasini bir xil tanlang.");
  sheet.getRange("B3").setNote("Tugash sanasi. Sana o‘zgarsa hisobot avtomatik yangilanadi.");
}

function haloIsoDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, HALO_CONFIG.timezone, "yyyy-MM-dd");
  const source = String(value || "").trim().replace(/[.\\/]/g, "-");
  const match = source.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? source : "";
}

function haloWriteSheet_(book, source) {
  let sheet = book.getSheetByName(source.name);
  if (!sheet) sheet = book.insertSheet(source.name);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getDataRange().clearContent();
  const values = [source.headers].concat(source.rows || []);
  const codeColumn = source.headers.indexOf("Kod") + 1;
  if (codeColumn > 0) {
    sheet.getRange(1, codeColumn, Math.max(1, values.length), 1).setNumberFormat("@");
  }
  sheet.getRange(1, 1, values.length, source.headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.setTabColor(source.name === "HALO HISOBOT" ? "#f4b41b" : "#34a853");
  sheet.getRange(1, 1, 1, source.headers.length)
    .setBackground("#15181b").setFontColor("#f4b41b").setFontWeight("bold").setHorizontalAlignment("center");
  const summarySheet = source.name === "HALO HISOBOT";
  if (values.length > 1) {
    sheet.getRange(2, 1, values.length - 1, source.headers.length).setVerticalAlignment("middle");
    if (!summarySheet) sheet.getRange(1, 1, values.length, source.headers.length).createFilter();
  }
  source.headers.forEach(function(header, index) {
    const column = index + 1;
    const rows = Math.max(1, values.length - 1);
    if (header === "Kod") sheet.getRange(2, column, rows, 1).setNumberFormat("@");
    if (header.indexOf("(₩)") >= 0) sheet.getRange(2, column, rows, 1).setNumberFormat("#,##0");
    if (header.indexOf("%") >= 0 || header.indexOf("marjasi") >= 0) sheet.getRange(2, column, rows, 1).setNumberFormat("0.0%");
  });
  if (source.name === "HALO SAVDO") {
    const soldMarginColumn = source.headers.indexOf("Sotuv paytidagi marja %") + 1;
    const currentMarginColumn = source.headers.indexOf("HALO joriy retsept marjasi %") + 1;
    if (soldMarginColumn > 0) sheet.getRange(1, soldMarginColumn).setNote(
      "Tanlangan sanalardagi savdo summasi va aynan sotuv vaqtida saqlangan tannarxdan hisoblanadi."
    );
    if (currentMarginColumn > 0) sheet.getRange(1, currentMarginColumn).setNote(
      "HALO Control → Retsept va marja oynasidagi hozirgi menyu narxi va hozirgi saqlangan retsept tannarxidan hisoblanadi."
    );
  }
  sheet.setColumnWidths(1, source.headers.length, 140);
  if (summarySheet) haloStyleSummary_(sheet, values);
  if (source.name === "HALO YETKAZUVCHILAR") haloStyleSuppliers_(sheet, source, values);
  if (source.name === "HALO OMBOR") haloStyleInventory_(sheet, source, values);
  if (source.name === "HALO XODIMLAR") haloStylePayroll_(sheet, source, values);
}

function haloStyleSummary_(sheet, values) {
  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 190);
  const rowCount = Math.max(1, values.length - 1);
  const backgrounds = [];
  const colors = [];
  const weights = [];
  const formats = [];
  for (let index = 1; index < values.length; index += 1) {
    const label = String(values[index][0] || "");
    const section = label.indexOf("— ") === 0;
    const check = label === "Hisob tekshiruvi";
    const ok = String(values[index][1] || "") === "MOS ✓";
    backgrounds.push([section ? "#eef3ef" : null, section ? "#eef3ef" : check ? (ok ? "#d9ead3" : "#fff2cc") : null]);
    colors.push([section ? "#15181b" : null, section ? "#15181b" : check ? (ok ? "#1b5e20" : "#7f6000") : null]);
    weights.push([section ? "bold" : "normal", "bold"]);
    formats.push([label.indexOf("marjasi") >= 0 || label.indexOf("foizi") >= 0 ? "0.0%" : label.indexOf("(₩)") >= 0 ? "#,##0" : "@"]) ;
  }
  if (values.length > 1) {
    sheet.getRange(2, 1, rowCount, 2).setBackgrounds(backgrounds).setFontColors(colors).setFontWeights(weights);
    sheet.getRange(2, 2, rowCount, 1).setNumberFormats(formats);
  }
  haloEnsureDateRange_(sheet);
}

function haloStyleSuppliers_(sheet, source, values) {
  sheet.setFrozenColumns(1);
  sheet.setColumnWidth(1, 240);
  [
    { header: "QARZ (₩)", background: "#f4cccc", color: "#9c0006" },
    { header: "AVANS (₩)", background: "#fff2cc", color: "#7f6000" },
    { header: "TO‘LIQ TO‘LANDI (₩)", background: "#d9ead3", color: "#1b5e20" },
    { header: "VOZVRAT QILINDI (₩)", background: "#d9eaf7", color: "#174ea6" }
  ].forEach(function(status) {
    const index = source.headers.indexOf(status.header);
    if (index < 0 || values.length <= 1) return;
    const active = values.slice(1).map(function(row) { return Number(row[index] || 0) > 0; });
    sheet.getRange(2, index + 1, values.length - 1, 1)
      .setNumberFormat("#,##0")
      .setFontWeight("bold")
      .setBackgrounds(active.map(function(value) { return [value ? status.background : null]; }))
      .setFontColors(active.map(function(value) { return [value ? status.color : null]; }));
  });
}

function haloStyleInventory_(sheet, source, values) {
  const index = source.headers.indexOf("Holat");
  if (index < 0 || values.length <= 1) return;
  const statuses = values.slice(1).map(function(row) { return String(row[index] || ""); });
  sheet.getRange(2, index + 1, statuses.length, 1)
    .setFontWeight("bold")
    .setBackgrounds(statuses.map(function(status) { return [status === "TUGAGAN" ? "#f4cccc" : status === "KAM" ? "#fff2cc" : "#d9ead3"]; }))
    .setFontColors(statuses.map(function(status) { return [status === "TUGAGAN" ? "#9c0006" : status === "KAM" ? "#7f6000" : "#1b5e20"]; }));
}

function haloStylePayroll_(sheet, source, values) {
  const index = source.headers.indexOf("Qolgan (₩)");
  if (index < 0 || values.length <= 1) return;
  const remaining = values.slice(1).map(function(row) { return Number(row[index] || 0); });
  sheet.getRange(2, index + 1, remaining.length, 1)
    .setBackgrounds(remaining.map(function(value) { return [value > 0 ? "#fff2cc" : "#d9ead3"]; }))
    .setFontColors(remaining.map(function(value) { return [value > 0 ? "#7f6000" : "#1b5e20"]; }))
    .setFontWeight("bold");
}

function haloHeaderColumn_(sheet, header) {
  if (!sheet || sheet.getLastColumn() < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.indexOf(header) + 1;
}

function haloBuildAnalysisCharts_(book) {
  const analysis = book.getSheetByName("HALO HISOBOT");
  const daily = book.getSheetByName("HALO KUNLIK");
  const products = book.getSheetByName("HALO SAVDO");
  if (!analysis) return;
  analysis.getCharts().forEach(function(chart) { analysis.removeChart(chart); });
  if (daily && daily.getLastRow() > 2) {
    const lastRow = daily.getLastRow();
    const dateColumn = haloHeaderColumn_(daily, "Sana");
    const revenueColumn = haloHeaderColumn_(daily, "Jami savdo (₩)");
    const profitColumn = haloHeaderColumn_(daily, "Sof foyda (₩)");
    if (dateColumn && revenueColumn && profitColumn) {
      analysis.insertChart(analysis.newChart().asLineChart()
        .addRange(daily.getRange(1, dateColumn, lastRow, 1))
        .addRange(daily.getRange(1, revenueColumn, lastRow, 1))
        .addRange(daily.getRange(1, profitColumn, lastRow, 1))
        .setOption("title", "Kunlik savdo va sof foyda").setOption("legend", { position: "bottom" }).setPosition(2, 4, 0, 0).build());
    }
    const taxableColumn = haloHeaderColumn_(daily, "POS / kiosk (₩)");
    const cashColumn = haloHeaderColumn_(daily, "Naqd (₩)");
    const bankColumn = haloHeaderColumn_(daily, "Hisob-raqam (₩)");
    if (dateColumn && taxableColumn && cashColumn && bankColumn) {
      analysis.insertChart(analysis.newChart().asColumnChart()
        .addRange(daily.getRange(1, dateColumn, lastRow, 1))
        .addRange(daily.getRange(1, taxableColumn, lastRow, 1))
        .addRange(daily.getRange(1, cashColumn, lastRow, 1))
        .addRange(daily.getRange(1, bankColumn, lastRow, 1))
        .setOption("title", "POS va naqd / hisob-raqam savdosi").setOption("legend", { position: "bottom" }).setPosition(34, 4, 0, 0).build());
    }
  }
  if (products && products.getLastRow() > 1) {
    const rows = Math.min(10, products.getLastRow() - 1);
    const nameColumn = haloHeaderColumn_(products, "Mahsulot");
    const salesColumn = haloHeaderColumn_(products, "Sotuv summasi (₩)");
    if (nameColumn && salesColumn) {
      analysis.insertChart(analysis.newChart().asBarChart()
        .addRange(products.getRange(1, nameColumn, rows + 1, 1))
        .addRange(products.getRange(1, salesColumn, rows + 1, 1))
        .setOption("title", "TOP mahsulotlar savdosi").setOption("legend", { position: "none" }).setPosition(18, 4, 0, 0).build());
    }
  }
}
`;
}

export function createGoogleSheetsAppsScript(input: {
  origin: string;
  apiKey: string;
  branchId: string;
  days?: number;
}) {
  const origin = input.origin.replace(/\/+$/, "");
  const days = Math.min(366, Math.max(1, Math.floor(Number(input.days) || 365)));
  const endpoint = `${origin}/api/integrations/v1/google-sheets`;
  return cleanGoogleSheetsAppsScript({
    endpoint,
    apiKey: input.apiKey,
    branchId: input.branchId,
    days,
  });
}
