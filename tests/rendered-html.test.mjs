import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateRecipeCost,
  calculateRecipeCostBreakdown,
  calculateRecipeExtraCost,
  calculateRecipeMarginAudit,
  convertRecipeQuantity,
  linkRecipeIngredientsToInventory,
  normalizeHumanNameKey,
  normalizeRecipeIngredients,
} from "../app/lib/recipe-costing.ts";
import { validRecipeCosts } from "../app/lib/recipe-validation.ts";
import {
  calculatePackagedInventory,
  normalizeInventoryPackaging,
  validInventoryPackaging,
} from "../app/lib/inventory-packaging.ts";
import { decodeHaloHeader, encodeHaloHeader } from "../app/lib/halo-header.ts";
import {
  canApplyOcrAlternative,
  deletionMovesAwayFromReceipt,
  ocrOkposCodeQuantityColumns,
  ocrOkposDailyProductTable,
  ocrTextToPosTable,
  parseNumericOcrPairs,
  parseOcrTsvLines,
  parseProductOcrLines,
  photoPosMapping,
  reconcileNumericOcrPasses,
  rebuildOcrRowsFromProductColumn,
  removedRowsFillReceiptGap,
  summarizeOcrRows,
} from "../app/photo-import.ts";
import {
  applyStatePatch,
  createStatePatch,
  isStatePatchEmpty,
} from "../app/lib/state-patch.ts";
import {
  autoDetectPosColumns,
  detectPosReportDate,
  extractPosTable,
  parsePosRows,
} from "../app/pos-import.ts";
import {
  categoriesForKind,
  DEFAULT_PRODUCT_CATEGORIES,
  inferLegacyCategoryId,
  INVENTORY_FALLBACK_CATEGORY_ID,
  normalizeProductCategories,
  RECIPE_FALLBACK_CATEGORY_ID,
  validCategoryId,
  validProductCategories,
} from "../app/lib/product-categories.ts";
import {
  calculatePayroll,
  calculatePayrollForDate,
  calculateWorkdayPay,
  calculateWorkdayPayEntries,
  conflictingWorkShiftIds,
  freezeWorkShiftRates,
  normalizeAttendanceDays,
  normalizePayrollAdjustments,
  normalizePayrollPayments,
  normalizeStaff,
  normalizeWorkShifts,
  roundPayrollMinutes,
  shiftRange,
  staffPayWindowForInstant,
  toWorkerAttendanceShift,
  validPayrollFinanceLinks,
  validPayrollState,
  workerMonthlyEarnings,
  workShiftPay,
  workShiftCalendarDate,
  workShiftMinutes,
} from "../app/lib/payroll.ts";
import { buildPayrollReport } from "../app/lib/payroll-report.ts";
import { calculateDailyReport, costRuleCoversCategory, selectActiveFinancialEntries, validCostRules } from "../app/lib/daily-report.ts";
import {
  seoulBusinessDate,
  seoulCalendarDate,
  seoulDateTimeLocal,
  seoulLocalDateTimeToIso,
  seoulOperationDate,
} from "../app/lib/business-time.ts";
import {
  HALO_LIVE_SYNC_INTERVAL_MS,
  rolloverFormDate,
  rolloverSelectedDate,
  stateRevisionChanged,
} from "../app/lib/live-state.ts";
import {
  dateIsInRange,
  dateRangeForPreset,
  filterDateRange,
  normalizeDateRange,
} from "../app/lib/date-range.ts";
import {
  canAutomateRecurringExpenseCategory,
  materializeRecurringExpenses,
  nextRecurringExpenseDate,
  nextRecurringExpenseDateAfter,
  repairRecurringExpenseDuplicates,
  recurringExpenseEntryId,
  recurringExpenseTemplateIdentity,
  validRecurringExpenseMetadata,
} from "../app/lib/recurring-expenses.ts";
import { prepareBatchSales } from "../app/lib/batch-sales.ts";
import { missingRecipeIngredient, recipeIsSellable } from "../app/lib/recipe-availability.ts";
import {
  allMenuCodes,
  ensureMenuCodes,
  nextMenuCode,
  preferredMenuCode,
  promoteLearnedMenuCodes,
  recipeHasMenuCode,
} from "../app/lib/menu-codes.ts";
import {
  activeDeletedEntityConflicts,
  activeDeletedItems,
  createDeletedItem,
  markDeletedItemRestored,
  normalizeDeletedItems,
  validDeletedItems,
  withoutActiveDeletedEntities,
} from "../app/lib/deleted-items.ts";
import {
  archivedInventoryMovements,
  reconcileArchivedState,
  selectActiveStockMovements,
} from "../app/lib/warehouse-consistency.ts";
import {
  archiveInventoryProduct,
  archiveStockMovement,
  WarehouseDeletionError,
} from "../app/lib/inventory-deletions.ts";
import {
  safeFilePart,
  safeSpreadsheetValue,
  spreadsheetRowsToCsv,
} from "../app/lib/spreadsheet-export.ts";
import {
  buildGoogleSheetsExport,
  createGoogleSheetsAppsScript,
  googleSheetsDateRangeDays,
} from "../app/lib/google-sheets-export.ts";
import {
  CHICKEN_OIL_CAN_LITERS,
  OIL_PURCHASE_CATEGORY,
  OIL_RESALE_CATEGORY,
  summarizeOilLedger,
  validOilLedgerMetadata,
} from "../app/lib/oil-accounting.ts";
import { createZipArchive } from "../app/lib/zip-export.ts";
import {
  buildKitchenRulesTelegramMessage,
  DEFAULT_KITCHEN_RULES,
  normalizeKitchenRuleReminderHours,
  normalizeKitchenRules,
  validKitchenRuleReminderHours,
  validKitchenRules,
} from "../app/lib/kitchen-rules.ts";
import {
  normalizeWorkerLanguage,
  translateWorker,
  translateWorkerError,
  workerLocale,
  WORKER_LANGUAGES,
} from "../app/lib/worker-i18n.ts";
import {
  applyOperationCompletion,
  buildOperationAlerts,
  operationChecklistView,
  OPERATION_CHECKLIST_ITEMS,
  validOperationChecklistDays,
} from "../app/lib/operations.ts";

import {
  STOCK_DOCUMENT_MAX_BYTES,
  validStockDocument,
  validStockDocuments,
} from "../app/lib/stock-documents.ts";
import { buildWorkerStateView } from "../app/lib/worker-state-view.ts";
import {
  exactNegativeMovementTotals,
  exactWorkerStockDeltas,
  expectedWorkerRecipeMovementTotals,
  finiteWorkerStock,
} from "../app/lib/worker-stock-validation.ts";
import {
  applyWorkerConsumption,
  compatibleInventoryInputUnits,
  deleteWorkerConsumption,
  editWorkerConsumption,
  inventoryQuantityFromInput,
  isKitchenConsumptionEntry,
} from "../app/lib/worker-consumptions.ts";
import {
  applyPosOrder,
  buildPosTerminalView,
  deletePosRecord,
  editPosRecord,
  PosTerminalError,
  updatePosOrderStatus,
} from "../app/lib/pos-terminal.ts";
import {
  applyStockMovementToInventory,
  bypassRemovedReceiptCost,
  stockMovementQuantity,
} from "../app/lib/stock-movements.ts";
import { shouldRetryFailedStateSave } from "../app/lib/save-retry.ts";
import {
  duplicateEntryConfirmationMessage,
  findPotentialDuplicateEntries,
} from "../app/lib/duplicate-entry-warning.ts";
import { allocateDeliveryCommission } from "../app/lib/delivery-sales.ts";

import {
  rebalanceSuppliers,
  supplierPurchaseSettlements,
  supplierPurchaseStatuses,
  supplierTransactionEffect,
  auditSupplierBalances,
  reconcileSupplierBalances,
  restoreSupplierOpeningBalances,
} from "../app/lib/supplier-transactions.ts";
import {
  missingUnarchivedSupplierPurchases,
  recoverMissingSupplierPurchases,
  validSupplierPurchaseRecord,
} from "../app/lib/supplier-invoices.ts";
import { resetInventoryForFreshCount } from "../app/lib/inventory-reset.ts";
import {
  closeBusinessMonth,
  MonthEndError,
  nextAccountingMonth,
  preservesClosedMonthFinance,
  preservesClosedMonthSales,
  preservesMonthlyCloseHistory,
  validMonthlyCloses,
} from "../app/lib/month-end.ts";
import {
  parseSupplierDeliveryLines,
  supplierDeliveryTotal,
  validSupplierDelivery,
} from "../app/lib/supplier-deliveries.ts";
import {
  buildMezanaDebtTelegramMessage,
  hasNegativeMezanaBorrowedQuantity,
  isMezanaSupplierName,
  mezanaBorrowedQuantityBalance,
  mezanaDebtBalance,
  mezanaDebtEntryValue,
  mezanaTelegramDestination,
  normalizeMezanaDebtEntries,
  normalizeMezanaSettings,
  validMezanaDebtEntry,
} from "../app/lib/mezana-debts.ts";

test("exact duplicate business entries require confirmation while changed dates do not", () => {
  const existingExpense = {
    id: "expense-existing",
    type: "expense",
    category: "Ijara",
    amount: 750_000,
    date: "2026-08-20",
    accountId: "account-bank",
    note: "Avgust",
  };
  const duplicateExpense = { ...existingExpense, id: "expense-new", note: "Qayta yozildi" };
  const warnings = findPotentialDuplicateEntries(
    { financialEntries: [existingExpense] },
    { financialEntries: [duplicateExpense, existingExpense] },
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].collection, "financialEntries");
  assert.match(duplicateEntryConfirmationMessage(warnings), /TAKRORIY MA’LUMOT EHTIMOLI/);
  assert.match(duplicateEntryConfirmationMessage(warnings), /750,000 ₩/);

  const changedDate = { ...duplicateExpense, date: "2026-08-21" };
  assert.deepEqual(findPotentialDuplicateEntries(
    { financialEntries: [existingExpense] },
    { financialEntries: [changedDate, existingExpense] },
  ), []);
});

test("delivery commission rounds once per whole order and reconciles its item rows", () => {
  const allocated = allocateDeliveryCommission([100, 100, 101], 12.5);
  assert.equal(allocated.reduce((sum, amount) => sum + amount, 0), Math.round(301 * 0.125));
  assert.deepEqual(allocateDeliveryCommission([0, Number.NaN, 10_000], 15), [0, 0, 1_500]);
});

test("warehouse, supplier and same-batch duplicate entries are detected without counting cancellations", () => {
  const stock = { id: "stock-a", inventoryId: "flour", type: "receipt", quantity: 20_000, unitCost: 2, date: "2026-08-20", supplierId: "supplier-a" };
  const payment = { id: "payment-a", supplierId: "supplier-a", type: "payment", amount: 384_600, date: "2026-08-20", accountId: "account-bank" };
  const before = { stockMovements: [stock], transactions: [payment] };
  const after = {
    stockMovements: [{ ...stock, id: "stock-b" }, stock],
    transactions: [{ ...payment, id: "payment-b" }, payment],
  };
  assert.deepEqual(
    findPotentialDuplicateEntries(before, after).map((warning) => warning.collection),
    ["transactions", "stockMovements"],
  );

  const firstSale = { id: "sale-a", recipeId: "chicken", quantity: 2, totalRevenue: 20_000, date: "2026-08-20", accountId: "account-cash", taxTreatment: "accountant_managed" };
  const secondSale = { ...firstSale, id: "sale-b" };
  assert.equal(findPotentialDuplicateEntries(
    { sales: [] },
    { sales: [firstSale, secondSale] },
  ).length, 1, "two identical additions inside one import are also warned");

  const cancelledExpense = { id: "old-expense", type: "expense", category: "Ijara", amount: 750_000, date: "2026-08-20", accountId: "account-bank" };
  const reversal = { id: "old-expense-reversal", type: "income", category: "Ijara", amount: 750_000, date: "2026-08-20", accountId: "account-bank", reversedEntryId: "old-expense", cancelledAt: "2026-08-21T00:00:00.000Z" };
  const replacement = { ...cancelledExpense, id: "replacement" };
  assert.deepEqual(findPotentialDuplicateEntries(
    { financialEntries: [reversal, cancelledExpense] },
    { financialEntries: [replacement, reversal, cancelledExpense] },
  ), [], "a replacement for a cancelled entry must not be blocked");
});

test("owner, worker and public POS screens all ask before saving semantic duplicates", () => {
  const ownerSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const terminalSource = readFileSync(new URL("../app/pos-terminal/page.tsx", import.meta.url), "utf8");
  for (const source of [ownerSource, workerSource, terminalSource]) {
    assert.match(source, /findPotentialDuplicateEntries/);
    assert.match(source, /window\.confirm\(duplicateEntryConfirmationMessage/);
  }
  assert.match(ownerSource, /Saqlash allaqachon boshlandi — ikkinchi bosish qabul qilinmadi/);
  assert.match(workerSource, /Saqlash allaqachon boshlandi — ikkinchi bosish qabul qilinmadi/);
});

test("every data section can keep an independent safe date range", () => {
  const sevenDays = dateRangeForPreset("2026-08-22", "7d");
  const month = dateRangeForPreset("2026-08-22", "month");
  const all = dateRangeForPreset("2026-08-22", "all");
  assert.deepEqual(sevenDays, { start: "2026-08-16", end: "2026-08-22", preset: "7d" });
  assert.deepEqual(month, { start: "2026-08-01", end: "2026-08-22", preset: "month" });
  assert.equal(dateIsInRange("2026-08-16T23:59:00+09:00", sevenDays), true);
  assert.equal(dateIsInRange("2026-08-15", sevenDays), false);
  assert.equal(dateIsInRange("2024-01-01", all), true);
  assert.deepEqual(normalizeDateRange({ start: "2026-08-20", end: "2026-08-10", preset: "custom" }, "2026-08-22"), {
    start: "2026-08-10", end: "2026-08-20", preset: "custom",
  });
  const rows = [{ section: "pos", date: "2026-08-22" }, { section: "cash", date: "2026-08-10" }];
  assert.deepEqual(filterDateRange(rows, sevenDays, (row) => row.date), [rows[0]],
    "one section's range must not pull older records from another section");
});

test("kitchen rules are normalized, validated, and formatted for Telegram", () => {
  const rules = normalizeKitchenRules(["  Qo‘lni yuving  ", "Qo‘lni yuving", "Joyni toza tuting"]);
  assert.deepEqual(rules, ["Qo‘lni yuving", "Joyni toza tuting"]);
  assert.equal(validKitchenRules(rules), true);
  assert.equal(validKitchenRules([]), false);
  assert.equal(normalizeKitchenRules(undefined).length, DEFAULT_KITCHEN_RULES.length);
  assert.equal(normalizeKitchenRuleReminderHours(2), 2);
  assert.equal(normalizeKitchenRuleReminderHours(9), 3);
  assert.equal(validKitchenRuleReminderHours(4), true);
  assert.equal(validKitchenRuleReminderHours(1), false);
  const message = buildKitchenRulesTelegramMessage(" Xurshidbek ", rules);
  assert.match(message, /Salom, Xurshidbek/);
  assert.match(message, /1\. Qo‘lni yuving/);
  assert.match(buildKitchenRulesTelegramMessage("Xurshidbek", rules, true), /ESLATMASI/);
});

test("monthly recurring expenses catch up once and preserve the billing day", () => {
  const template = {
    id: "rent-main", name: "HALO ijara", category: "Ijara", amount: 900_000,
    accountId: "bank", frequency: "monthly", nextDue: "2026-01-31", active: true,
    automatic: true, billingDay: 31,
  };
  assert.equal(nextRecurringExpenseDate("2026-01-31", 31), "2026-02-28");
  assert.equal(nextRecurringExpenseDate("2028-01-31", 31), "2028-02-29");
  assert.equal(nextRecurringExpenseDate("2026-02-28", 31), "2026-03-31");
  assert.equal(nextRecurringExpenseDateAfter("2026-01-31", 31, "2026-03-15"), "2026-03-31",
    "reactivating a paused template skips missed cycles instead of backfilling them");

  const first = materializeRecurringExpenses({ fixedExpenses: [template], financialEntries: [], throughDate: "2026-03-31" });
  assert.deepEqual(first.createdEntries.map((entry) => entry.date), ["2026-03-31", "2026-02-28", "2026-01-31"]);
  assert.equal(first.fixedExpenses[0].nextDue, "2026-04-30");
  assert.equal(first.financialEntries[0].id, recurringExpenseEntryId("rent-main", "2026-03-31"));
  assert.ok(first.createdEntries.every((entry) => entry.affectsProfit && entry.fixedExpenseId === "rent-main"));

  const second = materializeRecurringExpenses({
    fixedExpenses: first.fixedExpenses,
    financialEntries: first.financialEntries,
    throughDate: "2026-03-31",
  });
  assert.equal(second.createdEntries.length, 0, "opening the site again cannot duplicate a month");
  assert.equal(second.financialEntries.length, 3);
  assert.equal(validRecurringExpenseMetadata(second.fixedExpenses, second.financialEntries), true);

  const skipped = materializeRecurringExpenses({
    fixedExpenses: [
      { ...template, id: "paused", active: false },
      { ...template, id: "legacy-manual", automatic: undefined },
      { ...template, id: "weekly", frequency: "weekly" },
      { ...template, id: "purchase", category: "Mahsulot xaridi" },
      { ...template, id: "salary", category: "Maosh va avans" },
    ],
    financialEntries: [],
    throughDate: "2026-03-31",
  });
  assert.equal(skipped.createdEntries.length, 0);
  assert.equal(canAutomateRecurringExpenseCategory("Ijara"), true);
  assert.equal(canAutomateRecurringExpenseCategory("Mahsulot xaridi"), false);
  assert.equal(canAutomateRecurringExpenseCategory("Maosh / avans"), false);
});

test("duplicate monthly expenses are repaired once and cannot inflate the month total", () => {
  const fixedExpenses = [
    {
      id: "rent-current", name: "HALO ijarasi", category: "Ijara", amount: 750_000,
      accountId: "bank", frequency: "monthly", nextDue: "2026-09-18", active: true,
      automatic: true, billingDay: 18,
    },
    {
      id: "rent-duplicate", name: "  halo IJARASI ", category: "Ijara", amount: 750_000,
      accountId: "bank", frequency: "monthly", nextDue: "2026-09-18", active: true,
      automatic: true, billingDay: 18,
    },
    {
      id: "staff-meal", name: "Xodim ovqati", category: "Boshqa xarajat", amount: 600_000,
      accountId: "cash", frequency: "monthly", nextDue: "2026-09-01", active: true,
      automatic: true, billingDay: 1,
    },
    {
      id: "pos", name: "POS/kiosk", category: "Boshqa xarajat", amount: 60_000,
      accountId: "bank", frequency: "monthly", nextDue: "2026-09-30", active: true,
      automatic: true, billingDay: 30,
    },
    {
      id: "wifi", name: "WIFI, TELEFON", category: "Boshqa xarajat", amount: 52_000,
      accountId: "bank", frequency: "monthly", nextDue: "2026-09-30", active: true,
      automatic: true, billingDay: 30,
    },
  ];
  const expense = (id, fixedExpenseId, date, amount, category = "Ijara", accountId = "bank") => ({
    id, fixedExpenseId, fixedExpenseDueDate: date, date, amount, category, accountId,
    type: "expense", note: `Avtomatik oylik xarajat · ${category}`, affectsProfit: true,
  });
  const financialEntries = [
    expense("rent-19", "rent-current", "2026-08-19", 750_000),
    expense("rent-17", "rent-current", "2026-08-17", 750_000),
    expense("rent-15", "rent-duplicate", "2026-08-15", 750_000),
    expense("rent-14", "rent-duplicate", "2026-08-14", 750_000),
    expense("meal-aug", "staff-meal", "2026-08-01", 600_000, "Boshqa xarajat", "cash"),
    expense("pos-aug", "pos", "2026-08-30", 60_000, "Boshqa xarajat"),
    expense("wifi-aug", "wifi", "2026-08-30", 52_000, "Boshqa xarajat"),
  ];

  assert.equal(
    recurringExpenseTemplateIdentity(fixedExpenses[0]),
    recurringExpenseTemplateIdentity(fixedExpenses[1]),
    "case and extra spaces cannot create a second copy of the same monthly rule",
  );
  const repaired = repairRecurringExpenseDuplicates({
    fixedExpenses,
    financialEntries,
    repairedAt: "2026-08-26T10:00:00.000Z",
  });
  assert.equal(repaired.stoppedTemplates, 1);
  assert.equal(repaired.reversedEntries, 3);
  assert.equal(repaired.fixedExpenses[0].active, true);
  assert.equal(repaired.fixedExpenses[1].active, false);
  assert.equal(repaired.fixedExpenses[1].automatic, false);
  assert.equal(repaired.fixedExpenses.filter((entry) => entry.active && entry.automatic)
    .reduce((sum, entry) => sum + entry.amount, 0), 1_462_000);
  const activeAugust = selectActiveFinancialEntries(repaired.financialEntries)
    .filter((entry) => entry.type === "expense" && entry.date.startsWith("2026-08"));
  assert.equal(activeAugust.reduce((sum, entry) => sum + entry.amount, 0), 1_462_000);
  assert.equal(activeAugust.filter((entry) => entry.category === "Ijara").length, 1);
  assert.equal(validRecurringExpenseMetadata(repaired.fixedExpenses, repaired.financialEntries), true);

  const repeated = repairRecurringExpenseDuplicates({
    fixedExpenses: repaired.fixedExpenses,
    financialEntries: repaired.financialEntries,
    repairedAt: "2026-08-26T10:01:00.000Z",
  });
  assert.equal(repeated.changed, false, "the automatic repair itself must be retry-safe");
});

test("batch daily sales keep every selected menu item and report stock shortages without blocking", () => {
  const inventory = [{ id: "sausage", name: "Sosiska", unit: "dona", stock: 10, unitCost: 500 }];
  const recipes = [
    { id: "hotdog", name: "Hotdog", salePrice: 5_000, ingredients: [{ inventoryId: "sausage", quantity: 2 }] },
    { id: "corn", name: "Corn dog", salePrice: 6_000, ingredients: [{ inventoryId: "sausage", quantity: 1 }] },
  ];
  const ready = prepareBatchSales({ recipes, inventory, quantities: { hotdog: 3, corn: 4 } });
  assert.equal(ready.ok, true);
  assert.equal(ready.totalRequirements.get("sausage"), 10, "shared ingredients are added before saving");
  assert.equal(ready.selected.reduce((sum, row) => sum + row.quantity, 0), 7);

  const shortage = prepareBatchSales({ recipes, inventory, quantities: { hotdog: 4, corn: 3 } });
  assert.equal(shortage.ok, true);
  assert.equal(shortage.totalRequirements.get("sausage"), 11);
  assert.equal(shortage.shortageCount, 1);
  assert.equal(prepareBatchSales({ recipes, inventory, quantities: { hotdog: 1.5 } }).ok, false);
  assert.equal(prepareBatchSales({ recipes, inventory, quantities: {} }).ok, false);
});

test("deleted-item history stays append-only and records one-click restore status", () => {
  const deleted = createDeletedItem({
    kind: "inventory",
    entityId: "sausage",
    label: "Sosiska",
    section: "Ombor",
    reason: "Noto‘g‘ri mahsulot kiritilgan",
    record: { id: "sausage", name: "Sosiska", unit: "dona", stock: 10, unitCost: 650 },
    now: new Date("2026-08-14T05:30:00.000Z"),
  });
  assert.equal(validDeletedItems([deleted]), true);
  assert.equal(activeDeletedItems([deleted]).length, 1);
  assert.equal(deleted.reason, "Noto‘g‘ri mahsulot kiritilgan");
  const restored = markDeletedItemRestored([deleted], deleted.id, new Date("2026-08-14T06:00:00.000Z"));
  assert.equal(restored.length, 1, "the deletion event remains in history after restore");
  assert.equal(activeDeletedItems(restored).length, 0);
  assert.equal(restored[0].restoredAt, "2026-08-14T06:00:00.000Z");
  assert.equal(validDeletedItems(restored), true);
  assert.equal(validDeletedItems([{ ...deleted, entityId: "different" }]), false);
  assert.equal(validDeletedItems([{ ...deleted, deletedAt: "not-a-date" }]), false);
  assert.equal(validDeletedItems([deleted, { ...deleted, id: `${deleted.id}:duplicate` }]), false,
    "the same active entity cannot be placed in the trash twice");
});

test("archive normalization deduplicates active tombstones and makes deletion win over stale edits", () => {
  const product = {
    id: "sausage", name: "Sosiska", unit: "dona", stock: 10, minStock: 2,
    unitCost: 650, packageCost: 6_500, unitsPerPackage: 10,
  };
  const deleted = createDeletedItem({
    kind: "inventory",
    entityId: product.id,
    label: product.name,
    section: "Ombor",
    reason: "Takror yozilgan",
    record: product,
    now: new Date("2026-08-21T04:00:00.000Z"),
  });
  const duplicate = { ...deleted, id: `${deleted.id}:newer` };
  assert.equal(normalizeDeletedItems([deleted, duplicate]).length, 1,
    "one malformed duplicate cannot poison the whole trash history");

  const source = {
    inventory: [product],
    stockMovements: [],
    deletedItems: [deleted],
    suppliers: [{ id: "supplier", name: "Yetkazuvchi" }],
  };
  const canonical = withoutActiveDeletedEntities(source);
  assert.deepEqual(canonical.inventory, [], "an old edit cannot resurrect an actively archived product");
  assert.equal(source.inventory.length, 1, "canonicalization does not mutate the caller state");

  const base = { ...source, deletedItems: [] };
  const deletedState = { ...base, inventory: [], deletedItems: [deleted] };
  const staleEditedState = { ...base, inventory: [{ ...product, name: "Sosiska eski qurilmadan" }] };
  const afterDelete = applyStatePatch(base, createStatePatch(base, deletedState));
  const resurrectedByStalePatch = applyStatePatch(afterDelete, createStatePatch(base, staleEditedState));
  assert.equal(resurrectedByStalePatch.inventory.length, 1, "the raw delayed patch reproduces the former ghost bug");
  assert.equal(activeDeletedEntityConflicts(resurrectedByStalePatch)[0].entityId, product.id,
    "a save endpoint can reject the whole stale patch before dependent stock fields are applied");
  assert.deepEqual(reconcileArchivedState(resurrectedByStalePatch).state.inventory, [],
    "the tombstone removes a delayed edit before it reaches the UI or database");
});

test("warehouse reconciliation detaches deleted-product history and stays idempotent", () => {
  const product = {
    id: "sausage", name: "Sosiska", unit: "dona", stock: 10, minStock: 2,
    unitCost: 650, packageCost: 6_500, unitsPerPackage: 10,
  };
  const other = { ...product, id: "bread", name: "Non" };
  const deleted = createDeletedItem({
    kind: "inventory",
    entityId: product.id,
    label: product.name,
    section: "Ombor",
    reason: "Noto‘g‘ri mahsulot",
    record: product,
    now: new Date("2026-08-21T04:00:00.000Z"),
  });
  const movements = [
    { id: "move-a", inventoryId: product.id, type: "receipt", quantity: 10, date: "2026-08-20", note: "Kirim" },
    { id: "move-b", inventoryId: other.id, type: "receipt", quantity: 5, date: "2026-08-20", note: "Kirim" },
  ];
  const once = reconcileArchivedState({
    inventory: [product, other],
    stockMovements: movements,
    deletedItems: [deleted],
  });
  assert.deepEqual(once.state.inventory.map((item) => item.id), [other.id]);
  assert.deepEqual(once.state.stockMovements.map((movement) => movement.id), ["move-b"]);
  assert.deepEqual(archivedInventoryMovements(once.state.deletedItems[0]).map((movement) => movement.id), ["move-a"]);
  assert.equal(once.state.deletedItems[0].record.stock, 10,
    "adopting legacy pre-delete history cannot apply its quantity a second time");
  assert.deepEqual(selectActiveStockMovements(once.state.inventory, movements, once.state.deletedItems).map((movement) => movement.id), ["move-b"]);
  const twice = reconcileArchivedState(once.state);
  assert.deepEqual(twice.state, once.state, "the repair can safely run after every read and write");
  assert.equal(twice.changed, false);

  const refundWhileArchived = reconcileArchivedState({
    ...once.state,
    stockMovements: [
      { id: "refund-a", inventoryId: product.id, type: "adjustment", quantity: 2, date: "2026-08-21", note: "POS REFUND" },
      ...once.state.stockMovements,
    ],
  });
  assert.equal(refundWhileArchived.state.deletedItems[0].record.stock, 12,
    "a movement created after deletion updates the archived stock snapshot");
  assert.deepEqual(
    archivedInventoryMovements(refundWhileArchived.state.deletedItems[0]).map((movement) => movement.id),
    ["move-a", "refund-a"],
  );
  assert.deepEqual(
    reconcileArchivedState(refundWhileArchived.state).state,
    refundWhileArchived.state,
    "the post-delete stock delta is folded exactly once",
  );
});

test("atomic warehouse deletion removes a product with its history and reverses a movement once", () => {
  const inventory = [{
    id: "sausage", name: "Sosiska", unit: "dona", stock: 10, minStock: 2,
    unitCost: 650, packageCost: 6_500, unitsPerPackage: 10,
  }];
  const movement = {
    id: "receipt-1", inventoryId: "sausage", type: "receipt", quantity: 4,
    date: "2026-08-20", note: "Kirim", unitCost: 650, previousUnitCost: 500,
  };
  const base = { inventory, stockMovements: [movement], purchaseOrders: [], deletedItems: [] };
  const productDeleted = archiveInventoryProduct(base, "sausage", "Takror mahsulot");
  assert.equal(productDeleted.state.inventory.length, 0);
  assert.equal(productDeleted.state.stockMovements.length, 0);
  assert.equal(productDeleted.result.detachedMovementCount, 1);
  assert.equal(archivedInventoryMovements(productDeleted.state.deletedItems[0]).length, 1);

  const movementDeleted = archiveStockMovement(base, movement.id, "Miqdor xato");
  assert.equal(movementDeleted.state.inventory[0].stock, 6);
  assert.equal(movementDeleted.state.stockMovements.length, 0);
  assert.equal(movementDeleted.state.deletedItems[0].kind, "stockMovement");
  const repeated = archiveStockMovement(movementDeleted.state, movement.id, "Qayta bosildi");
  assert.equal(repeated.result.alreadyDeleted, true);
  assert.equal(repeated.state.inventory[0].stock, 6, "an idempotent retry cannot reverse stock twice");

  assert.throws(
    () => archiveStockMovement({ ...base, inventory: [{ ...inventory[0], stock: 2 }] }, movement.id, "Xato"),
    (error) => error instanceof WarehouseDeletionError && /minusga/.test(error.message),
  );
  assert.throws(
    () => archiveStockMovement({ ...base, stockMovements: [{ ...movement, type: "sale" }] }, movement.id, "Xato"),
    (error) => error instanceof WarehouseDeletionError && /Savdo bo‘limidan/.test(error.message),
  );
});

test("an archived linked ingredient stays visible and live ingredients remain deductible", () => {
  const inventory = [{ id: "bread", name: "Non", unit: "dona", stock: 20, unitCost: 300 }];
  const blocked = {
    id: "hotdog",
    name: "Hotdog",
    salePrice: 5_000,
    ingredients: [
      { inventoryId: "bread", name: "Non", quantity: 1 },
      { inventoryId: "sausage", name: "Sosiska", quantity: 2 },
    ],
  };
  assert.equal(recipeIsSellable(blocked, inventory), false);
  assert.equal(missingRecipeIngredient(blocked, inventory)?.inventoryId, "sausage");
  const result = prepareBatchSales({ recipes: [blocked], inventory, quantities: { hotdog: 1 } });
  assert.equal(result.ok, true);
  assert.equal(result.totalRequirements.get("bread"), 1);
  assert.equal(result.totalRequirements.has("sausage"), false);

  const manual = {
    ...blocked,
    id: "manual",
    name: "Qo‘lda retsept",
    ingredients: [{ inventoryId: "", name: "Qo‘lda tannarx", quantity: 1 }],
  };
  assert.equal(recipeIsSellable(manual, inventory), true, "an intentionally untracked ingredient stays allowed");
  assert.equal(prepareBatchSales({ recipes: [manual], inventory, quantities: { manual: 1 } }).ok, true);
});

test("worker projection hides trash but keeps every active menu item visible", () => {
  const view = buildWorkerStateView({
    productCategories: [],
    inventory: [{ id: "bread", name: "Non", unit: "dona", stock: 5, minStock: 1 }],
    recipes: [
      { id: "ready", name: "Tost", ingredients: [{ inventoryId: "bread", quantity: 1 }] },
      { id: "blocked", name: "Hotdog", ingredients: [{ inventoryId: "sausage", quantity: 1 }] },
    ],
    suppliers: [], supplierDeliveries: [], sales: [], accounts: [],
    deletedItems: [{ id: "private-trash-row" }],
  }, "worker-1", "revision-1");
  assert.deepEqual(view.recipes.map((recipe) => recipe.id), ["ready", "blocked"]);
  assert.deepEqual(view.deletedItems, []);
});

test("waste entry converts grams and liters into the warehouse unit", () => {
  assert.deepEqual(compatibleInventoryInputUnits("kg"), ["kg", "g"]);
  assert.deepEqual(compatibleInventoryInputUnits("litr"), ["litr", "ml"]);
  assert.equal(inventoryQuantityFromInput(200, "g", "kg"), 0.2);
  assert.equal(inventoryQuantityFromInput(250, "ml", "litr"), 0.25);
  assert.equal(inventoryQuantityFromInput(2, "kg", "g"), 2_000);
  assert.equal(inventoryQuantityFromInput(2, "dona", "kg"), 0);
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  assert.match(workerSource, /Ombordagi barcha mahsulotlardan tanlang/);
  assert.match(workerSource, /CHIQITNI HISOBLAB OMBORDAN AYIRISH/);
  assert.match(workerSource, /Chiqit qiymati/);
});

test("employee meal and product records deduct stock once and stay under that employee", () => {
  const initial = {
    inventory: [
      { id: "bread", name: "Non", unit: "dona", stock: 10, unitCost: 500 },
      { id: "meat", name: "Go‘sht", unit: "g", stock: 2_000, unitCost: 20 },
    ],
    recipes: [{
      id: "burger",
      name: "Burger",
      ingredients: [{ inventoryId: "bread", quantity: 1 }, { inventoryId: "meat", quantity: 120 }],
    }],
    stockMovements: [],
    workerConsumptions: [],
  };
  const meal = applyWorkerConsumption(initial, {
    operationId: "123e4567-e89b-12d3-a456-426614174000",
    kind: "meal",
    recipeId: "burger",
    quantity: 2,
    date: "2026-08-21",
    reason: "Xodim yegan taom",
  }, { id: "worker-1", name: "Aziz" }, "2026-08-21T10:00:00.000Z");
  assert.equal(meal.state.inventory[0].stock, 8);
  assert.equal(meal.state.inventory[1].stock, 1_760);
  assert.equal(meal.state.workerConsumptions[0].workerName, "Aziz");
  assert.equal(meal.state.stockMovements.length, 2);
  assert.match(meal.state.stockMovements[0].note, /Aziz/);
  assert.deepEqual(buildPosTerminalView(meal.state).inventoryOutflows.map((entry) => entry.id), [meal.result.entry.id]);

  const duplicate = applyWorkerConsumption(meal.state, {
    operationId: "123e4567-e89b-12d3-a456-426614174000",
    kind: "meal",
    recipeId: "burger",
    quantity: 2,
    date: "2026-08-21",
  }, { id: "worker-1", name: "Aziz" });
  assert.equal(duplicate.result.alreadySaved, true);
  assert.equal(duplicate.state.inventory[0].stock, 8, "a retried request must not deduct stock twice");

  const shortage = applyWorkerConsumption(meal.state, {
    operationId: "shortage-operation-0001",
    kind: "product",
    inventoryId: "bread",
    quantity: 100,
    date: "2026-08-21",
  }, { id: "worker-1", name: "Aziz" });
  assert.equal(shortage.state.inventory[0].stock, -92, "employee consumption must be saved even when stock is short");
  assert.equal(shortage.result.entry.stockShortages[0].quantity, 92);

  const view = buildWorkerStateView({
    ...meal.state,
    productCategories: [], suppliers: [], supplierDeliveries: [], sales: [], accounts: [],
    workerConsumptions: [
      ...meal.state.workerConsumptions,
      { id: "other", workerId: "worker-2", label: "Maxfiy", quantity: 1 },
    ],
  }, "worker-1", "revision-2");
  assert.deepEqual(view.workerConsumptions.map((entry) => entry.id), [meal.result.entry.id]);
  assert.equal(JSON.stringify(view).includes("Maxfiy"), false);
});

test("non-sale inventory outflow deducts recipes with a reason but creates no sale", () => {
  const initial = {
    inventory: [{ id: "bread", name: "Non", unit: "dona", stock: 20, unitCost: 500 }],
    recipes: [{ id: "toast", name: "Tost", ingredients: [{ inventoryId: "bread", quantity: 2 }] }],
    sales: [], stockMovements: [], workerConsumptions: [],
  };
  const saved = applyWorkerConsumption(initial, {
    operationId: "inventory-outflow-test-0001",
    kind: "inventory_only",
    items: [{ recipeId: "toast", quantity: 3 }],
    date: "2026-08-21",
    reason: "Oshxonada yeyilgan ovqat",
  }, { id: "worker-1", name: "Aziz" });
  assert.equal(saved.state.inventory[0].stock, 14);
  assert.equal(saved.state.sales.length, 0, "a non-sale outflow must never become financial revenue");
  assert.equal(saved.state.workerConsumptions[0].kind, "inventory_only");
  assert.equal(saved.state.workerConsumptions[0].reason, "Oshxonada yeyilgan ovqat");
  assert.equal(saved.state.workerConsumptions[0].outflowCategory, "kitchen_consumption");
  assert.equal(saved.state.workerConsumptions[0].totalCost, 3_000);
  assert.equal(saved.state.workerConsumptions[0].items[0].unitCostAtOutflow, 1_000);
  assert.equal(saved.state.workerConsumptions[0].items[0].totalCostAtOutflow, 3_000);
  assert.deepEqual(saved.state.workerConsumptions[0].ingredientUsage[0], {
    inventoryId: "bread",
    name: "Non",
    unit: "dona",
    quantity: 6,
    deductedQuantity: 6,
    expenseOnlyAtOutflow: false,
    unitCostAtOutflow: 500,
    totalCostAtOutflow: 3_000,
  });
  assert.equal(saved.state.stockMovements[0].unitCost, 500, "future outflow analysis keeps the historical warehouse unit cost");
  const publicView = buildPosTerminalView(saved.state);
  assert.equal(publicView.inventoryOutflows[0].isKitchenConsumption, true);
  assert.equal("totalCost" in publicView.inventoryOutflows[0], false, "the public POS history does not expose owner cost data");
  assert.equal("ingredientUsage" in publicView.inventoryOutflows[0], false, "ingredient cost snapshots stay owner-only");
});

test("kitchen consumption uses the complete saved recipe cost, including manual and extra costs", () => {
  const initial = {
    inventory: [{ id: "bread", name: "Non", unit: "dona", stock: 20, unitCost: 500 }],
    recipes: [{
      id: "toast",
      name: "Tost",
      ingredients: [
        { inventoryId: "bread", quantity: 2, unitCost: 600 },
        { name: "Qo‘lda sous", unit: "porsiya", quantity: 1, lineCost: 350 },
      ],
      extraCosts: [{ name: "Paket", amount: 150 }],
    }],
    sales: [], stockMovements: [], workerConsumptions: [],
  };
  const saved = applyWorkerConsumption(initial, {
    operationId: "kitchen-full-cost-0001",
    kind: "inventory_only",
    items: [{ recipeId: "toast", quantity: 3 }],
    date: "2026-08-26",
    reason: "Oshxonada yeyilgan ovqat",
  }, { id: "pos-terminal", name: "HALO POS" });

  const entry = saved.state.workerConsumptions[0];
  assert.equal(entry.items[0].ingredientCostAtOutflow, 1_550);
  assert.equal(entry.items[0].extraCostAtOutflow, 150);
  assert.equal(entry.items[0].unitCostAtOutflow, 1_700);
  assert.equal(entry.items[0].totalCostAtOutflow, 5_100);
  assert.equal(entry.totalCost, 5_100, "the owner analysis must match the full recipe cost");
  assert.equal(entry.costSnapshotVersion, 3);
  assert.equal(entry.ingredientUsage[0].unitCostAtOutflow, 600, "saved recipe unit cost wins over current warehouse cost");
  assert.equal(entry.ingredientUsage[0].totalCostAtOutflow, 3_600);
  assert.equal(saved.state.inventory[0].stock, 14, "manual and extra costs do not create fake stock deductions");
});

test("kitchen history recognises stable, legacy, and old public-POS entries", () => {
  assert.equal(isKitchenConsumptionEntry({
    kind: "inventory_only",
    outflowCategory: "kitchen_consumption",
    reason: "Boshqa nom",
  }), true);
  assert.equal(isKitchenConsumptionEntry({ kind: "inventory_only", reason: "Xodim ovqati" }), true);
  assert.equal(isKitchenConsumptionEntry({ kind: "inventory_only", reason: "Oshxonaga yeyilgan ovqat" }), true);
  assert.equal(isKitchenConsumptionEntry({
    kind: "inventory_only",
    reason: "",
    sourceType: "recipe",
    workerId: "pos-terminal",
  }), true);
  assert.equal(isKitchenConsumptionEntry({
    kind: "inventory_only",
    outflowCategory: "other_inventory_outflow",
    reason: "Oshxonada yeyilgan ovqat",
  }), false, "the stable category wins over a misleading label");
  assert.equal(isKitchenConsumptionEntry({ kind: "inventory_only", reason: "Isrof / buzilgan" }), false);
  assert.equal(isKitchenConsumptionEntry({ kind: "waste", reason: "Oshxonada yeyilgan ovqat" }), false);
});

test("standalone POS saves cash, bank, or card orders and keeps non-sales separate", () => {
  const initial = {
    productCategories: [{ id: "food", kind: "recipe", name: "Taom", sortOrder: 1 }],
    accounts: [
      { id: "cash", name: "Naqd", type: "cash" },
      { id: "card", name: "Karta", type: "card" },
      { id: "bank", name: "Hisob-raqam", type: "bank" },
    ],
    inventory: [{ id: "bread", name: "Non", unit: "dona", stock: 20, unitCost: 500 }],
    recipes: [{ id: "toast", name: "Tost", categoryId: "food", salePrice: 5_000, ingredients: [{ inventoryId: "bread", quantity: 2 }] }],
    sales: [], stockMovements: [], posOrders: [],
  };
  const saved = applyPosOrder(initial, {
    operationId: "223e4567-e89b-12d3-a456-426614174000",
    paymentType: "card",
    items: [{ recipeId: "toast", quantity: 3 }],
    note: "Soussiz",
  }, { id: "worker-1", name: "Aziz" }, "2026-08-21T10:00:00.000Z");
  assert.equal(saved.state.inventory[0].stock, 14);
  assert.equal(saved.state.sales[0].totalRevenue, 15_000);
  assert.equal(saved.state.sales[0].accountId, "card");
  assert.equal(saved.result.order.status, "new");
  assert.equal(saved.result.order.workerName, "Aziz");
  assert.equal(buildPosTerminalView(saved.state).catalog[0].salePrice, 5_000);

  const preparing = updatePosOrderStatus(saved.state, saved.result.order.id, "preparing", { id: "worker-2", name: "Malika" }, "2026-08-21T10:01:00.000Z");
  assert.equal(preparing.result.order.status, "preparing");
  assert.equal(preparing.result.order.updatedByWorkerName, "Malika");

  const duplicate = applyPosOrder(saved.state, {
    operationId: "223e4567-e89b-12d3-a456-426614174000",
    paymentType: "card",
    items: [{ recipeId: "toast", quantity: 3 }],
  }, { id: "worker-1", name: "Aziz" });
  assert.equal(duplicate.result.alreadySaved, true);
  assert.equal(duplicate.state.inventory[0].stock, 14);

  const bankSale = applyPosOrder(initial, {
    operationId: "pos-bank-sale-test-0001",
    paymentType: "bank",
    items: [{ recipeId: "toast", quantity: 1 }],
  }, { id: "worker-1", name: "Aziz" });
  assert.equal(bankSale.state.sales[0].accountId, "bank");
  assert.equal(bankSale.state.sales[0].totalRevenue, 5_000);

  for (const paymentType of ["cash", "bank"]) {
    const scarceStock = applyPosOrder({
      ...initial,
      inventory: [{ ...initial.inventory[0], stock: 1 }],
    }, {
      operationId: `pos-shortage-${paymentType}-0001`,
      paymentType,
      items: [{ recipeId: "toast", quantity: 2 }],
    }, { id: "pos-terminal", name: "POS terminal" });
    assert.equal(scarceStock.state.inventory[0].stock, -3, `${paymentType} sale must record the full recipe usage even when stock is short`);
    assert.equal(scarceStock.state.sales[0].totalRevenue, 10_000);
    assert.equal(scarceStock.state.sales[0].stockUsage[0].quantity, 4, "the full recipe usage is deducted");
    assert.equal(scarceStock.state.sales[0].stockShortages[0].quantity, 3, "unavailable recipe stock stays traceable");
    assert.equal(scarceStock.state.stockMovements[0].quantity, -4);
    assert.equal(scarceStock.result.order.stockShortages[0].quantity, 3);
  }

  assert.throws(() => applyPosOrder({
    ...initial,
    inventory: [{ ...initial.inventory[0], stock: 0 }],
  }, {
    operationId: "pos-shortage-card-0001",
    paymentType: "card",
    items: [{ recipeId: "toast", quantity: 1 }],
  }, { id: "pos-terminal", name: "POS terminal" }), (error) => error instanceof PosTerminalError && error.status === 409);

  const outflow = applyPosOrder(saved.state, {
    operationId: "pos-inventory-outflow-0001",
    mode: "inventory_only",
    inventoryReason: "Isrof / buzilgan",
    items: [{ recipeId: "toast", quantity: 1 }],
  }, { id: "worker-1", name: "Aziz" }, "2026-08-21T10:05:00.000Z");
  assert.equal(outflow.state.inventory[0].stock, 12);
  assert.equal(outflow.state.sales.length, 1, "POS stock-only mode cannot create a hidden sale");
  assert.equal(outflow.state.posOrders.length, 1, "stock-only mode does not enter the customer order queue");
  assert.equal(outflow.result.inventoryOutflow.reason, "Isrof / buzilgan");
  assert.equal(buildPosTerminalView(outflow.state).inventoryOutflows.length, 1);

  const kitchenShortage = applyPosOrder({
    ...initial,
    inventory: [{ ...initial.inventory[0], stock: 0 }],
  }, {
    operationId: "pos-shortage-kitchen-0001",
    mode: "inventory_only",
    items: [{ recipeId: "toast", quantity: 1 }],
  }, { id: "pos-terminal", name: "POS terminal" });
  assert.equal(kitchenShortage.state.inventory[0].stock, -2);
  assert.equal(kitchenShortage.result.inventoryOutflow.stockShortages[0].quantity, 2);
  assert.equal(kitchenShortage.result.inventoryOutflow.reason, "Oshxonada yeyilgan ovqat", "the public kitchen entry gets its reason automatically");
});

test("cash and bank order edits or deletes recalculate revenue and stock exactly once", () => {
  const initial = {
    productCategories: [{ id: "food", kind: "recipe", name: "Taom", sortOrder: 1 }],
    accounts: [
      { id: "cash", name: "Naqd", type: "cash" },
      { id: "bank", name: "Hisob-raqam", type: "bank" },
    ],
    inventory: [{ id: "bread", name: "Non", unit: "dona", stock: 20, unitCost: 500 }],
    recipes: [{ id: "toast", name: "Tost", categoryId: "food", salePrice: 5_000, ingredients: [{ inventoryId: "bread", quantity: 2 }] }],
    sales: [], stockMovements: [], posOrders: [], workerConsumptions: [],
  };
  const actor = { id: "pos-terminal", name: "POS terminal" };
  const createdAt = "2026-08-21T10:00:00.000Z";
  const saved = applyPosOrder(initial, {
    operationId: "cash-edit-delete-test-0001",
    paymentType: "cash",
    items: [{ recipeId: "toast", quantity: 3 }],
  }, actor, createdAt);
  assert.equal(saved.state.inventory[0].stock, 14);

  const priceChangedState = {
    ...saved.state,
    recipes: [{ ...saved.state.recipes[0], salePrice: 6_000 }],
  };
  const editedAt = "2026-08-21T11:30:00.000Z";
  const edited = editPosRecord(priceChangedState, {
    recordId: saved.result.order.id,
    recordType: "sale",
    operationId: "ignored-edit-operation",
    paymentType: "bank",
    items: [{ recipeId: "toast", quantity: 1 }],
    note: "To‘g‘rilandi",
  }, actor, editedAt);
  assert.equal(edited.state.inventory[0].stock, 18, "old quantity is restored before the corrected quantity is deducted");
  assert.equal(edited.state.sales.length, 1);
  assert.equal(edited.state.sales[0].accountId, "bank");
  assert.equal(edited.state.sales[0].quantity, 1);
  assert.equal(edited.state.sales[0].unitPrice, 5_000, "editing keeps the original historical selling price");
  assert.equal(edited.state.sales[0].totalRevenue, 5_000);
  assert.equal(edited.state.stockMovements.length, 1);
  assert.equal(edited.state.stockMovements[0].quantity, -2);
  assert.equal(edited.result.order.createdAt, createdAt, "sold time stays unchanged");
  assert.equal(edited.result.order.editedAt, editedAt);

  const deleted = deletePosRecord(edited.state, "sale", edited.result.order.id);
  assert.equal(deleted.state.inventory[0].stock, 20);
  assert.equal(deleted.state.sales.length, 0);
  assert.equal(deleted.state.stockMovements.length, 0);
  assert.equal(deleted.state.posOrders.length, 0);
  assert.throws(() => deletePosRecord(deleted.state, "sale", edited.result.order.id), (error) => (
    error instanceof PosTerminalError && error.status === 404
  ));
});

test("POS and employee outflows reject broken recipes and closed accounting months", () => {
  const base = {
    accounts: [{ id: "cash", name: "Naqd", type: "cash" }],
    inventory: [{ id: "bread", name: "Non", unit: "dona", stock: 20, unitCost: 500 }],
    recipes: [{
      id: "toast",
      name: "Tost",
      salePrice: 5_000,
      ingredients: [
        { inventoryId: "bread", quantity: 2 },
        { inventoryId: "missing-sauce", quantity: 1 },
      ],
    }],
    sales: [],
    stockMovements: [],
    posOrders: [],
    workerConsumptions: [],
    monthlyCloses: [],
  };
  assert.throws(() => applyPosOrder(base, {
    operationId: "broken-pos-recipe-0001",
    paymentType: "cash",
    items: [{ recipeId: "toast", quantity: 1 }],
  }, { id: "pos-terminal", name: "POS terminal" }), (error) => (
    error instanceof PosTerminalError && error.status === 409
  ));
  assert.throws(() => applyWorkerConsumption(base, {
    operationId: "broken-worker-recipe-0001",
    kind: "meal",
    recipeId: "toast",
    quantity: 1,
    date: "2026-08-21",
  }, { id: "worker-1", name: "Aziz" }), (error) => error.status === 409);

  const closed = {
    ...base,
    recipes: [{ ...base.recipes[0], ingredients: [{ inventoryId: "bread", quantity: 2 }] }],
    monthlyCloses: [{
      id: "monthly-close:2026-08",
      month: "2026-08",
      closedAt: "2026-09-01T00:00:00.000Z",
      closedBy: "Rahbar",
      inventoryItems: [],
      inventoryValue: 0,
      payrollItems: [],
      payrollGross: 0,
      payrollPaid: 0,
      payrollRemaining: 0,
    }],
  };
  assert.throws(() => applyPosOrder(closed, {
    operationId: "closed-pos-period-0001",
    paymentType: "cash",
    items: [{ recipeId: "toast", quantity: 1 }],
  }, { id: "pos-terminal", name: "POS terminal" }, "2026-08-21T10:00:00.000Z"), (error) => (
    error instanceof PosTerminalError && error.status === 409
  ));
  assert.throws(() => applyWorkerConsumption(closed, {
    operationId: "closed-worker-period-0001",
    kind: "meal",
    recipeId: "toast",
    quantity: 1,
    date: "2026-08-21",
  }, { id: "worker-1", name: "Aziz" }), (error) => error.status === 409);
});

test("public and employee eaten-product edits preserve ownership, time, and inventory", () => {
  const initial = {
    accounts: [{ id: "cash", name: "Naqd", type: "cash" }],
    inventory: [{ id: "bread", name: "Non", unit: "dona", stock: 20, unitCost: 500 }],
    recipes: [{ id: "toast", name: "Tost", salePrice: 5_000, ingredients: [{ inventoryId: "bread", quantity: 2 }] }],
    sales: [], stockMovements: [], posOrders: [], workerConsumptions: [],
  };
  const posActor = { id: "pos-terminal", name: "POS terminal" };
  const createdAt = "2026-08-21T10:05:00.000Z";
  const savedPublic = applyPosOrder(initial, {
    operationId: "kitchen-edit-delete-test-0001",
    mode: "inventory_only",
    items: [{ recipeId: "toast", quantity: 3 }],
  }, posActor, createdAt);
  const editedPublic = editPosRecord(savedPublic.state, {
    recordId: savedPublic.result.inventoryOutflow.id,
    recordType: "inventory_only",
    operationId: "ignored-kitchen-edit",
    mode: "inventory_only",
    items: [{ recipeId: "toast", quantity: 1 }],
  }, posActor, "2026-08-21T10:30:00.000Z");
  assert.equal(editedPublic.state.inventory[0].stock, 18);
  assert.equal(editedPublic.state.workerConsumptions.length, 1);
  assert.equal(editedPublic.result.inventoryOutflow.quantity, 1);
  assert.equal(editedPublic.result.inventoryOutflow.createdAt, createdAt);
  const deletedPublic = deletePosRecord(editedPublic.state, "inventory_only", editedPublic.result.inventoryOutflow.id);
  assert.equal(deletedPublic.state.inventory[0].stock, 20);
  assert.equal(deletedPublic.state.workerConsumptions.length, 0);
  assert.equal(deletedPublic.state.stockMovements.length, 0);

  const worker = { id: "worker-1", name: "Aziz" };
  const savedWorker = applyWorkerConsumption(initial, {
    operationId: "worker-edit-delete-test-0001",
    kind: "meal",
    recipeId: "toast",
    quantity: 2,
    date: "2026-08-21",
    reason: "Xodim yegan taom",
  }, worker, createdAt);
  assert.equal(buildPosTerminalView(savedWorker.state).inventoryOutflows[0].editable, false,
    "passwordless history cannot edit an authenticated employee record");
  assert.throws(() => deletePosRecord(savedWorker.state, "inventory_only", savedWorker.result.entry.id), (error) => (
    error instanceof PosTerminalError && error.status === 403
  ));
  assert.throws(() => deleteWorkerConsumption(savedWorker.state, savedWorker.result.entry.id, { id: "worker-2", name: "Boshqa" }), (error) => (
    error.status === 403
  ));
  const editedWorker = editWorkerConsumption(savedWorker.state, {
    recordId: savedWorker.result.entry.id,
    operationId: "ignored-worker-edit",
    kind: "meal",
    recipeId: "toast",
    quantity: 1,
    date: "2026-08-22",
    reason: "Xodim yegan taom",
  }, worker, "2026-08-21T11:00:00.000Z");
  assert.equal(editedWorker.state.inventory[0].stock, 18);
  assert.equal(editedWorker.result.entry.date, "2026-08-22");
  assert.equal(editedWorker.result.entry.createdAt, createdAt);
  assert.equal(editedWorker.result.entry.editedAt, "2026-08-21T11:00:00.000Z");
  const deletedWorker = deleteWorkerConsumption(editedWorker.state, editedWorker.result.entry.id, worker);
  assert.equal(deletedWorker.state.inventory[0].stock, 20);
  assert.equal(deletedWorker.state.workerConsumptions.length, 0);
  assert.equal(deletedWorker.state.stockMovements.length, 0);
});

test("lightweight polling avoids full state reads while recurring expenses stay current", () => {
  const stateRoute = readFileSync(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const branchesRoute = readFileSync(new URL("../app/api/branches/route.ts", import.meta.url), "utf8");
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(stateRoute, /searchParams\.get\("reconcile"\) === "1"[\s\S]{0,300}readHaloStateWithRecurringExpenses\(branchId\)/,
    "periodic reconciliation must still materialize due automatic expenses");
  assert.match(stateRoute, /updatedAt: await readHaloRevision\(branchId\)/,
    "ordinary polling must read only the state revision");
  assert.match(branchesRoute, /readHaloStateWithRecurringExpenses\(branchId\)/,
    "initial owner bootstrap must reconcile recurring expenses");
  assert.match(pageSource, /revision=1\$\{shouldReconcile \? "&reconcile=1" : ""\}/,
    "the owner periodically asks the server to reconcile recurring expenses");
  assert.match(pageSource, /archivedEditingIngredient[\s\S]{0,800}Savat \/ tiklash/,
    "saving a recipe cannot discard an archived inventory link");
  assert.match(pageSource, /const editRecipeCost[\s\S]{0,500}missingRecipeIngredient\(recipe, data\.inventory\)/,
    "opening the editor is blocked until its archived ingredient is restored");
});

test("Seoul payment datetime round-trips without using the device timezone", () => {
  const iso = seoulLocalDateTimeToIso("2026-08-15T00:30");
  assert.equal(iso, "2026-08-14T15:30:00.000Z");
  assert.equal(seoulDateTimeLocal(new Date(iso)), "2026-08-15T00:30");
  assert.equal(seoulLocalDateTimeToIso("2026-02-30T12:00"), "");
});

test("worker supplier delivery uses warehouse products and a valid receipt", () => {
  const document = {
    key: "stock-documents/main/123e4567-e89b-12d3-a456-426614174000.jpg",
    fileName: "nakladnoy.jpg",
    contentType: "image/jpeg",
    size: 1024,
    uploadedAt: "2026-08-13T10:00:00.000Z",
  };
  const lines = parseSupplierDeliveryLines([
    { id: "one", inventoryId: "kolbasa", name: "Kolbasa", packageSize: "500 g", quantity: 10, totalAmount: 50_000 },
    { id: "two", inventoryId: "suv", name: "Suv", packageSize: "", quantity: 5, totalAmount: 5_000 },
  ]);
  assert.ok(lines);
  assert.equal(supplierDeliveryTotal(lines), 55_000);
  assert.equal(validSupplierDelivery({
    id: "delivery-1", supplierId: "supplier-1", date: "2026-08-13", note: "",
    lines, totalAmount: 55_000, document, createdByWorkerId: "worker-1",
    createdByName: "Ali", createdAt: "2026-08-13T10:00:00.000Z", status: "submitted",
  }), true);
  assert.equal(validSupplierDelivery({
    id: "delivery-paid", supplierId: "supplier-1", date: "2026-08-13", note: "",
    lines, totalAmount: 55_000, document, createdByWorkerId: "worker-1",
    createdByName: "Ali", createdAt: "2026-08-13T10:00:00.000Z", status: "approved",
    settlementMode: "paid", paymentAccountId: "account-cash", paymentTransactionId: "delivery-payment:1",
  }), true, "a paid delivery keeps its account and linked payment snapshot");
  assert.equal(validSupplierDelivery({
    id: "delivery-bad-paid", supplierId: "supplier-1", date: "2026-08-13", note: "",
    lines, totalAmount: 55_000, createdByWorkerId: "worker-1", createdByName: "Ali",
    createdAt: "2026-08-13T10:00:00.000Z", status: "approved", settlementMode: "paid",
  }), false, "paid delivery cannot be saved without its payment account and transaction");
  assert.equal(parseSupplierDeliveryLines([{ id: "bad", name: "Suv", quantity: 5, totalAmount: 5_000 }]), null, "warehouse inventory id is required");
  assert.equal(parseSupplierDeliveryLines([
    { id: "first", inventoryId: "suv", name: "Suv", quantity: 2, totalAmount: 2_000 },
    { id: "duplicate", inventoryId: "suv", name: "Suv", quantity: 3, totalAmount: 3_000 },
  ]), null, "one receipt cannot contain the same warehouse product twice");

  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../app/api/worker-deliveries/route.ts", import.meta.url), "utf8");
  assert.match(workerSource, /deliveryProductSearch/);
  assert.match(workerSource, /addDeliveryProduct/);
  assert.match(workerSource, /t\("delivery\.quantity"\)/);
  assert.match(workerSource, /delivery\.settlementMode === "paid"/);
  assert.match(workerSource, /item\.gramsPerUnit/);
  assert.match(routeSource, /authenticateWorkerRequest/);
  assert.match(routeSource, /Tanlangan mahsulot Ombor bazasida topilmadi/);
});

test("manager can save a supplier purchase and immediate payment in one action", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const supplierRoute = readFileSync(new URL("../app/api/supplier-records/route.ts", import.meta.url), "utf8");
  assert.match(pageSource, /QARZ YOKI TO‘LOV KIRITISH/);
  assert.match(pageSource, /Qarzga olindi/);
  assert.match(pageSource, /Darhol to‘landi/);
  assert.match(pageSource, /savePurchaseAndPayment/);
  assert.match(supplierRoute, /function savePurchaseAndPayment/);
  assert.match(supplierRoute, /const paid = saveTransaction\(purchased\.state/);
});

test("MEZANA stays separate, accepts optional photos, and sends only its own debt record to Telegram", () => {
  assert.equal(isMezanaSupplierName("Mezana"), true);
  assert.equal(isMezanaSupplierName("MEZANA do‘koni"), true);
  assert.equal(isMezanaSupplierName("Boshqa do‘kon"), false);
  assert.equal(mezanaDebtBalance([
    { action: "borrowed", amount: 27_000 },
    { action: "borrowed", amount: 0 },
    { action: "purchased", amount: 5_000 },
    { action: "returned", amount: 7_000 },
    { action: "returned", amount: 0 },
  ]), 25_000);
  assert.deepEqual(normalizeMezanaSettings({
    telegramChatId: "-100123",
    telegramChatName: "Do‘kon",
    telegramThreadId: 42,
  }), {
    telegramChatId: "-100123",
    telegramChatName: "Do‘kon",
    telegramThreadId: 42,
    purchasedTelegramChatId: "",
    purchasedTelegramChatName: "",
    purchasedTelegramThreadId: 0,
  });
  const routedSettings = normalizeMezanaSettings({
    telegramChatId: "-100111",
    telegramChatName: "Olib turildi",
    telegramThreadId: 11,
    purchasedTelegramChatId: "-100222",
    purchasedTelegramChatName: "Sotib olindi",
    purchasedTelegramThreadId: 22,
  });
  assert.deepEqual(mezanaTelegramDestination(routedSettings, "borrowed"), {
    chatId: "-100111", chatName: "Olib turildi", threadId: 11,
  });
  assert.deepEqual(mezanaTelegramDestination(routedSettings, "returned"), {
    chatId: "-100111", chatName: "Olib turildi", threadId: 11,
  });
  assert.deepEqual(mezanaTelegramDestination(routedSettings, "purchased"), {
    chatId: "-100222", chatName: "Sotib olindi", threadId: 22,
  });
  const quantityLedger = [
    { action: "borrowed", productName: "Sut", quantity: 5 },
    { action: "returned", productName: " sut ", quantity: 2 },
    { action: "borrowed", productName: "Non", quantity: 4 },
  ];
  assert.equal(mezanaBorrowedQuantityBalance(quantityLedger), 7);
  assert.equal(mezanaBorrowedQuantityBalance(quantityLedger, "SUT"), 3);
  assert.equal(hasNegativeMezanaBorrowedQuantity(quantityLedger), false);
  assert.equal(hasNegativeMezanaBorrowedQuantity([
    ...quantityLedger,
    { action: "returned", productName: "Sut", quantity: 4 },
  ]), true);
  const message = buildMezanaDebtTelegramMessage({
    action: "borrowed",
    date: "2026-08-28",
    workerName: "Ali",
    productName: "Sut 2 dona",
    amount: 7_000,
    currentBalance: 27_000,
  });
  assert.match(message, /MEZANA · OLIB TURILDI/);
  assert.match(message, /Ali/);
  assert.match(message, /Sut/);
  assert.doesNotMatch(message, /₩27,000|MEZANA qolgan qarzi/);
  assert.match(buildMezanaDebtTelegramMessage({
    action: "purchased",
    date: "2026-08-28",
    workerName: "Ali",
    productName: "Sut 2 dona",
    amount: 7_000,
    currentBalance: 34_000,
  }), /MEZANA · SOTIB OLINDI/);
  const quantityMessage = buildMezanaDebtTelegramMessage({
    action: "borrowed",
    date: "2026-08-28",
    workerName: "Ali",
    productName: "Sut",
    quantity: 2,
    amount: 0,
    currentBalance: 34_000,
    currentBorrowedQuantity: 2,
  });
  assert.match(quantityMessage, /Olib turildi: 2 ta/);
  assert.match(quantityMessage, /Hozir olib turilgan: 2 ta/);
  assert.doesNotMatch(quantityMessage, /Summa:/);
  const returnedMessage = buildMezanaDebtTelegramMessage({
    action: "returned",
    date: "2026-08-28",
    workerName: "Ali",
    productName: "Sut",
    quantity: 1,
    amount: 0,
    currentBalance: 34_000,
    currentBorrowedQuantity: 1,
  });
  assert.match(returnedMessage, /Qaytarildi: 1 ta/);
  assert.match(returnedMessage, /Hozir olib turilgan: 1 ta/);
  assert.doesNotMatch(returnedMessage, /MEZANA qolgan qarzi/);
  assert.equal(validMezanaDebtEntry({
    id: `mezana:${"b".repeat(36)}`,
    action: "returned",
    productName: "Sut",
    quantity: 2,
    amount: 0,
    date: "2026-08-28",
    note: "",
    documents: [{
      key: `stock-documents/main/${"b".repeat(8)}-${"b".repeat(4)}-${"b".repeat(4)}-${"b".repeat(4)}-${"b".repeat(12)}.jpg`,
      fileName: "yuqori.jpg",
      contentType: "image/jpeg",
      size: 1_024,
      uploadedAt: "2026-08-28T00:00:00.000Z",
    }],
    createdByWorkerId: "worker-a",
    createdByName: "Ali",
    createdAt: "2026-08-28T00:00:00.000Z",
  }), true);
  assert.equal(validMezanaDebtEntry({
    id: `mezana:${"d".repeat(36)}`,
    action: "borrowed",
    productName: "Sut",
    quantity: 2,
    amount: 0,
    date: "2026-08-28",
    note: "",
    documents: [],
    createdByWorkerId: "worker-a",
    createdByName: "Ali",
    createdAt: "2026-08-28T00:00:00.000Z",
  }), true, "MEZANA must accept a record without a photo");
  const purchasedWithStaleQuantity = {
    id: `mezana:${"c".repeat(36)}`,
    action: "purchased",
    productName: "Sut",
    quantity: 2,
    amount: 9_000,
    date: "2026-08-28",
    note: "",
    documents: [{
      key: `stock-documents/main/${"c".repeat(8)}-${"c".repeat(4)}-${"c".repeat(4)}-${"c".repeat(4)}-${"c".repeat(12)}.jpg`,
      fileName: "yuqori.jpg",
      contentType: "image/jpeg",
      size: 1_024,
      uploadedAt: "2026-08-28T00:00:00.000Z",
    }],
    createdByWorkerId: "worker-a",
    createdByName: "Ali",
    createdAt: "2026-08-28T00:00:00.000Z",
  };
  assert.equal(validMezanaDebtEntry(purchasedWithStaleQuantity), false,
    "a purchased row cannot carry a stale borrowed/returned quantity");
  const repairedPurchased = normalizeMezanaDebtEntries([purchasedWithStaleQuantity])[0];
  assert.equal(repairedPurchased.action, "purchased", "normalization never changes the selected action");
  assert.equal(repairedPurchased.quantity, undefined);
  assert.equal(repairedPurchased.amount, 9_000);
  assert.equal(mezanaDebtEntryValue(repairedPurchased), "₩9,000");
  assert.equal(validMezanaDebtEntry({
    id: `mezana:${"a".repeat(36)}`,
    action: "borrowed",
    productName: "Sut 2 dona",
    amount: 7_000,
    date: "2026-08-28",
    note: "",
    documents: [{
      key: `stock-documents/main/${"a".repeat(8)}-${"a".repeat(4)}-${"a".repeat(4)}-${"a".repeat(4)}-${"a".repeat(12)}.jpg`,
      fileName: "yuqori.jpg",
      contentType: "image/jpeg",
      size: 1_024,
      uploadedAt: "2026-08-28T00:00:00.000Z",
    }],
    createdByWorkerId: "worker-a",
    createdByName: "Ali",
    createdAt: "2026-08-28T00:00:00.000Z",
  }), true);

  const deliveryRoute = readFileSync(new URL("../app/api/worker-deliveries/route.ts", import.meta.url), "utf8");
  const mezanaRoute = readFileSync(new URL("../app/api/worker-mezana/route.ts", import.meta.url), "utf8");
  const ownerMezanaRoute = readFileSync(new URL("../app/api/owner-mezana/route.ts", import.meta.url), "utf8");
  const ownerMezanaNotifyRoute = readFileSync(new URL("../app/api/owner-mezana-notify/route.ts", import.meta.url), "utf8");
  const stateRoute = readFileSync(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const expenseRoute = readFileSync(new URL("../app/api/worker-expenses/route.ts", import.meta.url), "utf8");
  const oilRoute = readFileSync(new URL("../app/api/worker-oil/route.ts", import.meta.url), "utf8");
  const authRoute = readFileSync(new URL("../app/api/worker-auth/route.ts", import.meta.url), "utf8");
  const authStore = readFileSync(new URL("../app/lib/worker-auth.ts", import.meta.url), "utf8");
  const workerPage = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const ownerPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const controlPage = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");
  const multipartUpload = readFileSync(new URL("../app/lib/multipart-upload.ts", import.meta.url), "utf8");
  const mezanaTelegramDelivery = readFileSync(new URL("../app/lib/mezana-telegram-delivery.ts", import.meta.url), "utf8");
  const databaseSchema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(deliveryRoute, /!session\.canSupplierDelivery/);
  assert.match(deliveryRoute, /status: "approved"/);
  assert.match(deliveryRoute, /applyWarehouseIntake/, "worker receipts use the same inventory-only path as owner receipts");
  assert.match(deliveryRoute, /supplierAccounting: "separate"/, "supplier debt stays in the separate ledger");
  assert.match(deliveryRoute, /MEZANA mahsulotini faqat alohida MEZANA bo‘limidan kiriting/);
  assert.doesNotMatch(deliveryRoute, /sendMezanaDebtNotice/);
  assert.match(deliveryRoute, /buildWorkerStateView\(saved\.state/);
  assert.match(mezanaRoute, /fileTop/);
  assert.match(mezanaRoute, /fileBottom/);
  assert.match(mezanaRoute, /sendMediaGroup/);
  assert.match(mezanaRoute, /sendMessage/);
  assert.doesNotMatch(mezanaRoute, /yuqori qismini biriktiring/);
  assert.match(mezanaRoute, /files\.length && !storage/);
  assert.match(mezanaRoute, /message_thread_id/);
  assert.match(mezanaRoute, /action !== "borrowed" && action !== "returned" && action !== "purchased"/);
  assert.match(mezanaRoute, /action === "purchased" \|\| input\.entry\.action === "paid"/);
  assert.match(mezanaRoute, /form\.get\("quantity"\)/);
  assert.match(mezanaRoute, /export async function PATCH/);
  assert.match(mezanaRoute, /export async function PUT/);
  assert.match(mezanaRoute, /export async function DELETE/);
  assert.match(mezanaRoute, /deliverMezanaTelegramOnce/);
  assert.match(mezanaRoute, /telegramFetch/);
  assert.match(mezanaRoute, /mutateHaloState/,
    "a worker MEZANA entry must save atomically without a stale whole-state revision");
  assert.match(mezanaRoute, /mezanaEntries: \[entry, \.\.\.rawEntries\]/,
    "a new worker MEZANA entry must preserve malformed legacy rows for explicit repair");
  assert.match(mezanaRoute, /entry: savedEntry,\s*balance,\s*updatedAt: mutation\.updatedAt,\s*telegram/,
    "a MEZANA upload returns a compact receipt instead of the entire worker state");
  assert.match(mezanaRoute, /entry\.createdByWorkerId === session\.userId/);
  assert.match(mezanaRoute, /createDeletedItem/);
  assert.match(mezanaRoute, /MEZANA YOZUVI TAHRIRLANDI/);
  assert.match(mezanaRoute, /MEZANA YOZUVI O‘CHIRILDI/);
  assert.match(mezanaRoute, /nextState = \{ \.\.\.current\.state, mezanaEntries: nextEntries \}/);
  assert.doesNotMatch(mezanaRoute, /financialEntries|supplier\.telegramChatId|settings\.chatId/);
  assert.match(ownerMezanaRoute, /isAdminRequest/);
  assert.match(ownerMezanaRoute, /createdByWorkerId: "owner"/);
  assert.match(ownerMezanaRoute, /createdByName: "Rahbar"/);
  assert.match(ownerMezanaRoute, /fileTop/);
  assert.match(ownerMezanaRoute, /fileBottom/);
  assert.match(ownerMezanaRoute, /sendMediaGroup/);
  assert.match(ownerMezanaRoute, /sendMessage/);
  assert.doesNotMatch(ownerMezanaRoute, /yuqori qismini biriktiring/);
  assert.match(ownerMezanaRoute, /files\.length && !storage/);
  assert.match(ownerMezanaRoute, /message_thread_id/);
  assert.match(ownerMezanaRoute, /"borrowed", "returned", "purchased"/);
  assert.match(ownerMezanaRoute, /action === "purchased" \|\| input\.entry\.action === "paid"/);
  assert.match(ownerMezanaRoute, /form\.get\("quantity"\)/);
  assert.match(ownerMezanaRoute, /deliverMezanaTelegramOnce/);
  assert.match(ownerMezanaRoute, /telegramFetch/);
  assert.match(ownerMezanaRoute, /claimMezanaTelegramDelivery/);
  assert.match(ownerMezanaRoute, /finishMezanaTelegramDelivery/);
  assert.match(ownerMezanaRoute, /storedMezanaFiles/);
  assert.match(ownerMezanaRoute, /export async function PUT/);
  assert.match(ownerMezanaRoute, /entry: existingEntry,[\s\S]*balance,[\s\S]*updatedAt: current\.updatedAt,[\s\S]*telegram/,
    "an owner retry returns the original compact receipt and retries Telegram without duplicating debt");
  assert.match(ownerMezanaRoute, /mutateHaloState/,
    "owner MEZANA entry must save atomically without a stale whole-state revision");
  assert.match(ownerMezanaRoute, /mezanaEntries: \[entry, \.\.\.rawEntries\]/,
    "a new owner MEZANA entry must preserve malformed legacy rows for explicit repair");
  assert.match(ownerMezanaRoute, /entry: savedEntry, balance, updatedAt: mutation\.updatedAt, telegram/,
    "a new owner MEZANA upload returns a compact receipt");
  assert.doesNotMatch(ownerPage, /Avval saqlanmay qolgan o‘zgarishni qayta saqlang, keyin MEZANA yozuvini kiriting/,
    "a failed POS or other HALO save must not block a separate MEZANA entry");
  assert.match(stateRoute, /const mezanaEntriesChanged = JSON\.stringify\(submittedMezanaEntries\) !== JSON\.stringify\(currentMezanaEntries\)/);
  assert.match(stateRoute, /if \(mezanaEntriesChanged\)/,
    "legacy MEZANA validation must run only when MEZANA itself changes");
  assert.doesNotMatch(ownerMezanaRoute, /authenticateWorkerRequest/);
  assert.match(ownerMezanaNotifyRoute, /isAdminRequest/);
  assert.match(ownerMezanaNotifyRoute, /"edited" \| "deleted"/);
  assert.match(ownerMezanaNotifyRoute, /MEZANA YOZUVI TAHRIRLANDI/);
  assert.match(ownerMezanaNotifyRoute, /MEZANA YOZUVI O‘CHIRILDI/);
  assert.match(ownerMezanaNotifyRoute, /message_thread_id/);
  assert.match(ownerMezanaNotifyRoute, /sendMessage/);
  assert.match(ownerMezanaNotifyRoute, /telegramFetch/);
  assert.match(ownerPage, /action: "discover-mezana"/);
  assert.doesNotMatch(ownerPage, /action: "mezana-resend-latest"/);
  assert.match(ownerPage, /OXIRGI MEZANA YOZUVINI GURUHGA QAYTA YUBORISH/);
  assert.match(ownerPage, /YOZUVLAR TARIXI/);
  assert.match(ownerPage, />TAHRIRLASH<\/button>/);
  assert.match(ownerPage, /Olib tashlash/);
  assert.match(ownerPage, /quantity: undefined/);
  assert.match(ownerPage, /Amal turi .* o‘zgartiriladi/);
  assert.match(workerPage, />TAHRIRLASH<\/button>/);
  assert.match(workerPage, /O‘CHIRISH/);
  const telegramRoute = (readFileSync(new URL("../app/api/telegram/route.ts", import.meta.url), "utf8") + readFileSync(new URL("../app/lib/telegram-service.ts", import.meta.url), "utf8"));
  assert.match(telegramRoute, /message\.chat\.type === "group" \|\| message\.chat\.type === "supergroup"/);
  assert.match(telegramRoute, /\^\\\/mezana/);
  assert.match(telegramRoute, /sendTelegramPhotos/);
  assert.match(telegramRoute, /!entry\.documents\.length/);
  assert.match(telegramRoute, /message_thread_id/);
  assert.match(telegramRoute, /telegramThreadId/);
  assert.match(expenseRoute, /!session\.canWarehouseReceipt/);
  assert.match(oilRoute, /!session\.canWarehouseReceipt/);
  assert.match(authRoute, /warehouse-receipt/);
  assert.match(authRoute, /supplier-delivery/);
  assert.match(authStore, /can_warehouse_receipt/);
  assert.match(authStore, /can_supplier_delivery/);
  assert.match(workerPage, /taskId === "delivery" \? canSupplierDelivery/);
  assert.match(controlPage, /YETKAZUVCHI KIRIMI/);
  assert.match(controlPage, /toggleWorkerSupplierDelivery/);
  assert.match(workerPage, /Asosiy rasm/);
  assert.match(workerPage, /Qo‘shimcha rasm/);
  assert.match(workerPage, /Ixtiyoriy · rasmsiz ham qabul qilinadi/);
  assert.match(workerPage, /STOCK_IMAGE_ACCEPT/);
  assert.match(workerPage, /prepareStockImageUpload/);
  assert.match(workerPage, /postMultipartJson/);
  assert.match(workerPage, /Yozuv serverda tekshirilmoqda/);
  assert.match(workerPage, /normalizeMezanaDebtEntry\(result\.entry\)/);
  assert.match(workerPage, /TELEGRAMGA YUBORISH/);
  assert.match(workerPage, /method: "PUT"/);
  assert.match(workerPage, /appendImageToForm\(form, "fileTop"/);
  assert.match(ownerPage, /postMultipartJson/);
  assert.match(ownerPage, /appendImageToForm\(form, "fileTop"/);
  assert.match(ownerPage, /Yozuv serverda tekshirilmoqda/);
  assert.match(ownerPage, /normalizeMezanaDebtEntry\(result\.entry\)/);
  assert.match(ownerPage, /postMultipartJson<OwnerMezanaReceipt>\("\/api\/owner-mezana", form\)/);
  assert.match(ownerPage, /method: "PUT"/);
  assert.match(multipartUpload, /new XMLHttpRequest\(\)/);
  assert.match(multipartUpload, /request\.withCredentials = true/);
  assert.match(multipartUpload, /form\.append\(field, file/);
  assert.doesNotMatch(workerPage, /fetch\("\/api\/worker-mezana", \{ method: "POST", body: form \}\)/);
  assert.match(workerPage, />SOTIB OLINDI<\/button>/);
  assert.match(workerPage, /Mahsulot soni/);
  assert.match(workerPage, />TAHRIRLASH<\/button>/);
  assert.match(workerPage, /O‘CHIRISH/);
  assert.match(workerPage, /startMezanaEdit/);
  assert.match(workerPage, /deleteMezana/);
  assert.doesNotMatch(workerPage, /Chek yoki mahsulot rasmining yuqori qismini biriktiring/);
  assert.match(mezanaTelegramDelivery, /INSERT OR IGNORE INTO mezana_telegram_deliveries/);
  assert.match(mezanaTelegramDelivery, /status != 'sent'/);
  assert.match(mezanaTelegramDelivery, /result\.sent \? "sent" : "failed"/);
  assert.match(databaseSchema, /mezanaTelegramDeliveries = sqliteTable/);
  assert.match(ownerPage, /id: "mezana" as Tab, icon: "M", label: "MEZANA"/);
  assert.match(ownerPage, /tab === "mezana"/);
  assert.match(ownerPage, />SOTIB OLINDI<\/button>/);
  assert.match(ownerPage, /ownerMezanaAvailableCatalog/);
  assert.match(ownerPage, /ownerSelectedMezanaCatalogItem/);
  assert.match(ownerPage, /Olib turilgan qoldiqqa qo‘shiladi/);
  assert.match(ownerPage, /<option value="purchased">Sotib olindi<\/option>/);
  assert.match(ownerPage, /\/mezana_olib/);
  assert.match(ownerPage, /\/mezana_sotib/);
  assert.match(ownerPage, /discoverMezanaTelegram\("borrowed"\)/);
  assert.match(ownerPage, /discoverMezanaTelegram\("purchased"\)/);
  assert.match(ownerPage, /purchasedTelegramChatId/);
  assert.match(ownerMezanaRoute, /mezanaTelegramDestination\(input\.settings, input\.entry\.action\)/);
  assert.match(ownerMezanaRoute, /mezanaCatalogItemForAction/);
  assert.match(ownerMezanaRoute, /productImage: catalogItem\.image/);
  assert.match(mezanaRoute, /mezanaTelegramDestination\(input\.settings, input\.entry\.action\)/);
  assert.match(ownerMezanaNotifyRoute, /sendMezanaChangeToActions\(settings, targetActions, message\)/);
  assert.match(ownerMezanaNotifyRoute, /before\.action === edited\.action \? \[edited\.action\] : \[before\.action, edited\.action\]/);
  assert.match(mezanaRoute, /sendMezanaTextToActions\(settings, targetActions/);
  assert.match(ownerPage, /editMezanaEntry/);
  assert.match(ownerPage, /saveMezanaEdit/);
  assert.match(ownerPage, /deleteMezanaEntry/);
  assert.match(ownerPage, /kind: "mezanaEntry"/);
  assert.match(ownerPage, /saveOwnerMezana/);
  assert.match(ownerPage, /\/api\/owner-mezana/);
  assert.match(ownerPage, /\/api\/owner-mezana-notify/);
  assert.match(ownerPage, /notifyMezanaChange\("edited"/);
  assert.match(ownerPage, /notifyMezanaChange\("deleted"/);
  assert.match(ownerPage, /SAQLASH VA MEZANA GURUHIGA YUBORISH/);
  assert.match(ownerPage, /Ixtiyoriy · rasmsiz ham qabul qilinadi/);
  assert.match(ownerPage, /Hozir olib turilgan qoldiq/);
  assert.match(ownerPage, /hasNegativeMezanaBorrowedQuantity/);
  assert.doesNotMatch(ownerPage, /Chek yoki mahsulot rasmining yuqori qismini biriktiring/);
  assert.match(ownerPage, /O‘ZGARISHNI SAQLASH/);
  assert.match(ownerPage, /Olib tashlash/);
  assert.doesNotMatch(ownerPage, /supplier-mezana-summary-card/);
  assert.match(ownerPage, /OLDI-BERDI BOSHQARUVI/);
  assert.doesNotMatch(ownerPage, /HALO YETKAZUVCHILAR hisobotida MEZANA alohida qatorda/);
  assert.match(ownerPage, /HALO HISOBIDAN ALOHIDA/);
  assert.match(controlPage, /XARAJAT · MOY · MEZANA/);
  assert.match(controlPage, /YETKAZUVCHI KIRIMI/);
});

test("warehouse supplier receipt history shows what entered and when", () => {
  const ownerPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../app/warehouse-records-panel.tsx", import.meta.url), "utf8");
  assert.match(ownerPage, /WarehouseRecordsPanel/);
  assert.match(panel, /Kirimlarni boshqarish/);
  assert.match(panel, /Yetkazib beruvchi/);
  assert.match(panel, /d\.supplierId===supplier/);
  assert.match(panel, /d\.date>=from/);
  assert.match(panel, /d\.date<=to/);
  assert.match(panel, /l\.quantity/);
  assert.match(panel, /l\.amount/);
  assert.match(panel, /Tahrir va bekor qilish tarixi/);
});

test("phone images are normalized once and management screens stay compact", () => {
  const imageUpload = readFileSync(new URL("../app/lib/image-upload.ts", import.meta.url), "utf8");
  const multipartUpload = readFileSync(new URL("../app/lib/multipart-upload.ts", import.meta.url), "utf8");
  const ownerPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workerPage = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(imageUpload, /STOCK_IMAGE_INPUT_MAX_BYTES = 30 \* 1024 \* 1024/);
  assert.match(imageUpload, /STOCK_IMAGE_MOBILE_SAFE_BYTES = 1 \* 1024 \* 1024/);
  assert.match(imageUpload, /standardFile\.size <= STOCK_IMAGE_MOBILE_SAFE_BYTES/,
    "a standard phone JPEG above the mobile request limit must be compressed instead of passed through unchanged");
  assert.match(imageUpload, /heic2any/);
  assert.match(imageUpload, /canvas\.toBlob/);
  assert.match(imageUpload, /"image\/jpeg"/);
  assert.match(ownerPage, /prepareStockImageUpload/);
  assert.match(ownerPage, /accept=\{STOCK_IMAGE_ACCEPT\}/);
  assert.match(workerPage, /prepareStockImageUpload/);
  assert.match(workerPage, /accept=\{STOCK_IMAGE_ACCEPT\}/);
  assert.match(multipartUpload, /request\.status === 413/);
  assert.match(multipartUpload, /Rasm hajmi server chegarasidan oshdi/);
  assert.match(ownerPage, /supplier-control-hero/);
  assert.match(ownerPage, /supplier-command-card/);
  assert.doesNotMatch(ownerPage, /supplier-auto-order-panel/);
  assert.doesNotMatch(ownerPage, /supplier-mezana-jump/);
  assert.doesNotMatch(styles, /\.supplier-auto-order-panel/);
  assert.doesNotMatch(styles, /\.supplier-mezana-jump/);
});

test("supplier transaction editing recalculates old and new balances exactly once", () => {
  const suppliers = [{ id: "a", balance: 1_000 }, { id: "b", balance: 200 }];
  assert.equal(supplierTransactionEffect({ supplierId: "a", type: "purchase", amount: 300 }), 300);
  assert.equal(supplierTransactionEffect({ supplierId: "a", type: "payment", amount: 300 }), -300);
  assert.deepEqual(
    rebalanceSuppliers(
      suppliers,
      { supplierId: "a", type: "purchase", amount: 500 },
      { supplierId: "a", type: "purchase", amount: 650 },
    ),
    [{ id: "a", balance: 1_150 }, { id: "b", balance: 200 }],
  );
  assert.deepEqual(
    rebalanceSuppliers(
      suppliers,
      { supplierId: "a", type: "purchase", amount: 500 },
      { supplierId: "b", type: "payment", amount: 100 },
    ),
    [{ id: "a", balance: 500 }, { id: "b", balance: 100 }],
  );
  assert.deepEqual(
    rebalanceSuppliers(suppliers, { supplierId: "a", type: "payment", amount: 400 }, null),
    [{ id: "a", balance: 1_400 }, { id: "b", balance: 200 }],
  );
});

test("supplier ledger catches and repairs even a one-won stored balance drift", () => {
  const state = {
    suppliers: [
      { id: "nodir", name: "Nodir aka", balance: 1 },
      { id: "mezana", name: "MEZANA", balance: 99_000 },
    ],
    transactions: [
      { id: "purchase", supplierId: "nodir", type: "purchase", amount: 75_000, date: "2026-09-19" },
      { id: "payment", supplierId: "nodir", type: "payment", amount: 75_000, date: "2026-09-19" },
    ],
  };
  const before = auditSupplierBalances(state.suppliers, state.transactions);
  assert.equal(before.length, 1, "MEZANA remains isolated from HALO supplier accounting");
  assert.equal(before[0].difference, 1);
  const repaired = reconcileSupplierBalances(state);
  assert.equal(repaired.changed, true);
  assert.equal(repaired.repairedWon, 1);
  assert.equal(repaired.state.suppliers[0].balance, 0);
  assert.equal(repaired.state.suppliers[1].balance, 99_000);
  assert.equal(reconcileSupplierBalances(repaired.state).changed, false, "repair is idempotent");
});

test("legacy supplier debt becomes an opening balance and only a real payment can zero it", () => {
  const beforeReconciliation = {
    suppliers: [{ id: "nodir", name: "Nodir aka", balance: 158_500 }],
    transactions: [],
  };
  const afterBadReconciliationAndPayment = {
    suppliers: [{ id: "nodir", name: "Nodir aka", balance: -158_500 }],
    transactions: [{ id: "paid", supplierId: "nodir", type: "payment", amount: 158_500, date: "2026-09-19" }],
  };
  const restored = restoreSupplierOpeningBalances(afterBadReconciliationAndPayment, beforeReconciliation);
  assert.equal(restored.changed, true);
  assert.equal(restored.state.suppliers[0].openingBalance, 158_500);
  assert.equal(restored.state.suppliers[0].balance, 0);
  const audit = auditSupplierBalances(restored.state.suppliers, restored.state.transactions);
  assert.equal(audit[0].difference, 0);
  assert.equal(audit[0].ledgerBalance, 0);
});

test("supplier cards separate taken, paid, and current debt so payments never look like debt", () => {
  const ownerPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(ownerPage, /KIRIM \+ QARZ QOLDIG‘I TUZATISHI/);
  assert.match(ownerPage, /JAMI TO‘LANGAN/);
  assert.match(ownerPage, /HOZIRGI QARZ/);
  assert.match(ownerPage, /Qarz qolmagan/);
  assert.match(ownerPage, /TO‘LIQ TO‘LANGAN/);
});

test("finance shield audits cash ledger values without flagging recipe cost fractions", () => {
  const ownerPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const shieldStart = ownerPage.indexOf("const cashLedgerWholeWonValues");
  const shieldEnd = ownerPage.indexOf("const cashLedgerProblemCount", shieldStart);
  assert.notEqual(shieldStart, -1);
  assert.notEqual(shieldEnd, -1);
  const shieldValues = ownerPage.slice(shieldStart, shieldEnd);
  assert.match(shieldValues, /data\.financialEntries/);
  assert.match(shieldValues, /data\.transactions/);
  assert.match(shieldValues, /data\.dailyCloses/);
  assert.doesNotMatch(shieldValues, /data\.sales/);
});

test("supplier products and warehouse counts are separated into clear single-window views", () => {
  const ownerPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(ownerPage, /YETKAZIB BERUVCHI BO‘YICHA MAHSULOTLAR/);
  assert.match(ownerPage, /Kimdan nima olingan\?/);
  assert.match(ownerPage, /selectedSupplierReceipts[\s\S]{0,500}movement\.type === "receipt"/);
  assert.match(ownerPage, /selectedSupplierProductRows[\s\S]{0,1400}receiptCount/);
  const countPanel = readFileSync(new URL("../app/inventory-accounting-panel.tsx", import.meta.url), "utf8");
  assert.match(countPanel, /Kimdan olingan mahsulotlar\?/);
  assert.match(countPanel, /actualValue-systemValue/);
  assert.match(countPanel, /Haqiqiy qiymat/);
});

test("supplier purchases change from unpaid to paid as payments cover the debt", () => {
  const transactions = [
    { id: "payment", supplierId: "a", type: "payment", amount: 600, date: "2026-08-20" },
    { id: "new-purchase", supplierId: "a", type: "purchase", amount: 400, date: "2026-08-19" },
    { id: "old-purchase", supplierId: "a", type: "purchase", amount: 300, date: "2026-08-18" },
  ];
  const statuses = supplierPurchaseStatuses(transactions);
  assert.equal(statuses["old-purchase"], "paid", "older debt is paid first");
  assert.equal(statuses["new-purchase"], "unpaid", "a partly covered purchase stays unpaid");
  const settlements = supplierPurchaseSettlements(transactions);
  assert.deepEqual(settlements["new-purchase"], {
    paidAmount: 300,
    remainingAmount: 100,
    status: "partial",
  });
  const historical = supplierPurchaseSettlements(transactions, "2026-08-19");
  assert.equal(historical["old-purchase"].status, "unpaid", "a future payment cannot change an older report");
  assert.equal(historical["new-purchase"].status, "unpaid");
});

test("supplier invoices cannot disappear during payment without an explicit archive", () => {
  const invoice = {
    id: "invoice-with-photo",
    supplierId: "supplier-a",
    type: "purchase",
    amount: 976_800,
    date: "2026-08-17",
    note: "GLOBAL SERVIS nakladnoyi",
    document: {
      key: "stock-documents/main/123e4567-e89b-12d3-a456-426614174000.jpg",
      fileName: "nakladnoy.jpg",
      contentType: "image/jpeg",
      size: 1024,
      uploadedAt: "2026-08-17T12:00:00.000Z",
    },
  };
  const payment = {
    id: "payment",
    supplierId: "supplier-a",
    type: "payment",
    amount: 976_800,
    date: "2026-08-20",
    note: "Qarz to‘liq to‘landi",
  };
  assert.equal(validSupplierPurchaseRecord(invoice), true);
  assert.deepEqual(
    missingUnarchivedSupplierPurchases([invoice], [payment], []),
    [invoice],
    "adding a payment may not silently replace its invoice",
  );
  assert.deepEqual(
    missingUnarchivedSupplierPurchases([invoice], [{ ...invoice, type: "payment" }], []),
    [invoice],
    "changing an invoice row into a payment is also protected",
  );

  const archivedInvoice = {
    id: "deleted-invoice",
    kind: "transaction",
    entityId: invoice.id,
    label: "GLOBAL SERVIS · ₩976,800",
    section: "Oldi-berdi",
    deletedAt: "2026-08-21T05:00:00.000Z",
    deletedBy: "Rahbar",
    reason: "Takror yozuv",
    record: invoice,
  };
  assert.deepEqual(
    missingUnarchivedSupplierPurchases([invoice], [payment], [archivedInvoice]),
    [],
    "an explicit trash tombstone is the only allowed removal path",
  );
});

test("missing supplier invoices are recovered from the pre-payment backup exactly once", () => {
  const first = {
    id: "invoice-first", supplierId: "supplier-a", type: "purchase",
    amount: 499_500, date: "2026-08-17", note: "Birinchi nakladnoy",
  };
  const archived = {
    id: "invoice-archived", supplierId: "supplier-a", type: "purchase",
    amount: 100_000, date: "2026-08-18", note: "Bekor qilingan nakladnoy",
  };
  const payment = {
    id: "payment", supplierId: "supplier-a", type: "payment",
    amount: 599_500, date: "2026-08-20", note: "Qarz to‘liq to‘landi",
  };
  const tombstone = {
    id: "deleted-archived-invoice",
    kind: "transaction",
    entityId: archived.id,
    label: "Bekor qilingan nakladnoy",
    section: "Oldi-berdi",
    deletedAt: "2026-08-20T12:00:00.000Z",
    deletedBy: "Rahbar",
    reason: "Takror yozuv",
    record: archived,
  };
  const recovered = recoverMissingSupplierPurchases(
    [payment],
    [{ transactions: [first, archived] }],
    [tombstone],
  );
  assert.deepEqual(recovered, [first]);
  assert.deepEqual(
    recoverMissingSupplierPurchases([payment, ...recovered], [{ transactions: [first, archived] }], [tombstone]),
    [],
    "re-running recovery cannot duplicate an invoice",
  );
});

test("fresh inventory count preserves product identity but resets quantities and costs", () => {
  const reset = resetInventoryForFreshCount([{
    id: "meat", name: "Go‘sht", unit: "g", categoryId: "meat", supplierId: "sup",
    stock: 15_000, minStock: 2_000, unitCost: 12, packageName: "quti",
    unitsPerPackage: 10_000, packageCost: 120_000, gramsPerUnit: 1,
  }]);
  assert.deepEqual(reset, [{
    id: "meat", name: "Go‘sht", unit: "g", categoryId: "meat", supplierId: "sup",
    stock: 0, minStock: 0, unitCost: 0, packageName: "quti",
    unitsPerPackage: 1, packageCost: 0, gramsPerUnit: 0,
  }]);
});

test("month end freezes sales, inventory, expenses, and payroll then resets selected stock", () => {
  const range = shiftRange("2026-08-10", "12:00", "00:00");
  assert.ok(range);
  const staff = normalizeStaff([{
    id: "staff-month-end", name: "Ali", payType: "monthly", monthlySalary: 2_600_000,
    hourlyRate: 0, workDays: 26, dailyHours: 12, active: true,
  }]);
  const workShifts = normalizeWorkShifts([{
    id: "shift-month-end", staffId: "staff-month-end", date: "2026-08-10",
    clockIn: range.clockIn, clockOut: range.clockOut, breakMinutes: 0,
    source: "owner", status: "closed",
  }]);
  const initial = {
    inventory: [{
      id: "meat", name: "Go‘sht", unit: "g", stock: 15_000, unitCost: 12,
      minStock: 2_000, packageName: "quti", unitsPerPackage: 10_000,
      packageCost: 120_000, gramsPerUnit: 1, supplierId: "sup", categoryId: "meat",
    }],
    stockMovements: [], staff, workShifts,
    payrollAdjustments: [], attendanceDays: [], payrollPayments: [], monthlyCloses: [],
    sales: [{ id: "sale-august", date: "2026-08-10", totalRevenue: 200_000, totalCost: 80_000 }],
    financialEntries: [{
      id: "expense-rent", type: "expense", category: "Ijara", amount: 750_000,
      date: "2026-08-01", accountId: "bank", note: "Avgust", affectsProfit: true,
    }],
  };

  assert.equal(closeBusinessMonth(initial, "2026-08", "Rahbar", "2026-09-01T00:00:00.000Z").state.inventory[0].stock, 15_000);
  const closed = closeBusinessMonth(
    initial,
    "2026-08",
    "Rahbar",
    "2026-09-01T00:00:00.000Z",
    { meat: 0 },
    ["meat"],
  );
  assert.equal(closed.alreadyClosed, false);
  assert.equal(closed.state.inventory[0].stock, 15_000);
  assert.equal(closed.state.inventory[0].unitCost, 12, "fresh count keeps product setup and cost");
  assert.equal(closed.state.inventory[0].minStock, 2_000);
  assert.equal(closed.state.stockMovements.length, 0);
  assert.equal(closed.record.inventoryItems[0].systemStock, 15_000);
  assert.equal(closed.record.inventoryItems[0].closingStock, 15_000);
  assert.equal(closed.record.inventoryItems[0].openingStock, 15_000);
  assert.equal(closed.record.inventoryItems[0].resetForRecount, false);
  assert.equal(closed.record.inventoryItems[0].stock, 15_000);
  assert.equal(closed.record.inventoryItems[0].difference, 0);
  assert.equal(closed.record.inventoryValue, 180_000);
  assert.deepEqual(closed.record.resetInventoryIds, []);
  assert.equal(closed.record.salesCount, 1);
  assert.equal(closed.record.salesRevenue, 200_000);
  assert.equal(closed.record.salesCost, 80_000);
  assert.equal(closed.record.salesProfit, 120_000);
  assert.equal(closed.record.expenseItems.length, 1);
  assert.equal(closed.record.expenseTotal, 750_000);
  assert.equal(closed.record.payrollItems[0].grossPay, 100_000);
  assert.equal(closed.record.payrollRemaining, 100_000);
  assert.equal(validMonthlyCloses(closed.state.monthlyCloses), true);
  assert.equal(nextAccountingMonth("2026-08"), "2026-09");

  const duplicate = closeBusinessMonth(closed.state, "2026-08", "Rahbar", "2026-09-02T00:00:00.000Z");
  assert.equal(duplicate.alreadyClosed, true);
  assert.equal(duplicate.state.stockMovements.length, 0, "double click keeps physical stock intact");
  assert.equal(preservesMonthlyCloseHistory(closed.state.monthlyCloses, []), false);
  assert.equal(preservesMonthlyCloseHistory(closed.state.monthlyCloses, closed.state.monthlyCloses), true);
  assert.equal(preservesClosedMonthFinance(closed.state.monthlyCloses, initial.financialEntries, initial.financialEntries), true);
  assert.equal(preservesClosedMonthFinance(closed.state.monthlyCloses, initial.financialEntries, []), false);
  assert.equal(preservesClosedMonthFinance(closed.state.monthlyCloses, initial.financialEntries, [{
    ...initial.financialEntries[0], amount: 800_000,
  }]), false);
  assert.equal(preservesClosedMonthFinance(closed.state.monthlyCloses, initial.financialEntries, [
    ...initial.financialEntries,
    { id: "late-august", type: "expense", category: "Boshqa", amount: 1_000, date: "2026-08-20", accountId: "cash", note: "", affectsProfit: true },
  ]), false);
  assert.equal(preservesClosedMonthFinance(closed.state.monthlyCloses, initial.financialEntries, [
    ...initial.financialEntries,
    { id: "september", type: "expense", category: "Boshqa", amount: 1_000, date: "2026-09-02", accountId: "cash", note: "", affectsProfit: true },
  ]), true);
  assert.equal(preservesClosedMonthFinance(closed.state.monthlyCloses, initial.financialEntries, [
    ...initial.financialEntries,
    { id: "reverse-closed", type: "income", category: "Bekor qilish", amount: 750_000, date: "2026-09-02", accountId: "bank", note: "", affectsProfit: true, reversedEntryId: "expense-rent" },
  ]), false);
  assert.throws(
    () => closeBusinessMonth(initial, "2026-08", "Rahbar", "2026-08-26T00:00:00.000Z"),
    MonthEndError,
    "the current month cannot be closed before its last Seoul calendar day",
  );
});

test("closed-month sales reject additions, edits, deletions, and date moves", () => {
  const monthlyCloses = [{
    id: "monthly-close:2026-08",
    month: "2026-08",
    closedAt: "2026-09-01T00:00:00.000Z",
    closedBy: "Rahbar",
    inventoryItems: [],
    inventoryValue: 0,
    payrollItems: [],
    payrollGross: 0,
    payrollPaid: 0,
    payrollRemaining: 0,
  }];
  const closedSale = {
    id: "sale-august",
    recipeId: "lavash",
    quantity: 2,
    date: "2026-08-31",
    totalRevenue: 20_000,
    totalCost: 8_000,
  };
  const openSale = {
    id: "sale-september",
    recipeId: "lavash",
    quantity: 1,
    date: "2026-09-01",
    totalRevenue: 10_000,
    totalCost: 4_000,
  };
  const currentSales = [closedSale, openSale];

  assert.equal(preservesClosedMonthSales(monthlyCloses, currentSales, currentSales), true);
  assert.equal(preservesClosedMonthSales(monthlyCloses, currentSales, [...currentSales].reverse()), true,
    "reordering the sales list does not change closed records");
  assert.equal(preservesClosedMonthSales(monthlyCloses, currentSales, [openSale]), false,
    "a closed sale cannot be deleted");
  assert.equal(preservesClosedMonthSales(monthlyCloses, currentSales, [
    { ...closedSale, quantity: 3 }, openSale,
  ]), false, "a closed sale cannot be edited");
  assert.equal(preservesClosedMonthSales(monthlyCloses, currentSales, [
    closedSale, openSale,
    { ...openSale, id: "late-august-sale", date: "2026-08-30" },
  ]), false, "a new sale cannot be added to a closed month");
  assert.equal(preservesClosedMonthSales(monthlyCloses, currentSales, [
    closedSale, { ...openSale, date: "2026-08-30" },
  ]), false, "an open sale cannot be moved into a closed month");
  assert.equal(preservesClosedMonthSales(monthlyCloses, currentSales, [
    closedSale, { ...openSale, quantity: 4 },
    { ...openSale, id: "new-september-sale" },
  ]), true, "open-month sales remain editable");
});

test("month end is blocked while an employee shift is still open", () => {
  const staff = normalizeStaff([{
    id: "staff-open", name: "Vali", payType: "hourly", hourlyRate: 10_000,
    monthlySalary: 0, workDays: 26, dailyHours: 8, active: true,
  }]);
  const workShifts = normalizeWorkShifts([{
    id: "shift-open-month", staffId: "staff-open", date: "2026-08-31",
    clockIn: "2026-08-31T03:00:00.000Z", clockOut: "", breakMinutes: 0,
    source: "owner", status: "open",
  }]);
  assert.throws(() => closeBusinessMonth({
    inventory: [], stockMovements: [], staff, workShifts,
    payrollAdjustments: [], attendanceDays: [], payrollPayments: [], monthlyCloses: [],
  }, "2026-08", "Rahbar", "2026-09-01T00:00:00.000Z"), /tugatilmagan ish vaqti/);
});

test("month-end controls and immutable history protection are wired into the owner and worker APIs", () => {
  const controlSource = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");
  const ownerStateRoute = readFileSync(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const workerStateRoute = readFileSync(new URL("../app/api/worker-state/route.ts", import.meta.url), "utf8");
  const workerExpenseRoute = readFileSync(new URL("../app/api/worker-expenses/route.ts", import.meta.url), "utf8");
  assert.match(controlSource, /OY YAKUNI · SAVDO \+ OMBOR \+ XARAJAT \+ OYLIK/);
  assert.match(controlSource, /oyini yopish va yangi hisobni ochish/);
  assert.match(controlSource, /Ombor qoldiqlari nol qilinmaydi/);
  assert.doesNotMatch(controlSource, /Hammasini belgilash/);
  assert.match(controlSource, /Oldingi yakunlar:/);
  assert.match(ownerStateRoute, /preservesMonthlyCloseHistory/);
  assert.match(ownerStateRoute, /preservesClosedMonthSales/);
  assert.match(ownerStateRoute, /Yopilgan oyning savdolari o‘zgarmaydi/);
  assert.match(ownerStateRoute, /preservesClosedMonthFinance/);
  assert.match(workerStateRoute, /"monthlyCloses"/);
  assert.match(workerExpenseRoute, /Bu oy yopilgan/);
});

test("supplier and account history expose explicit edit controls", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /editingTransactionId/);
  assert.match(pageSource, /saveSupplierTransaction/);
  assert.match(pageSource, /qarz va pul hisobi qayta hisoblandi/);
  assert.match(pageSource, /className="transaction-edit-button"/);
  assert.match(pageSource, /editingSupplierId/);
  assert.match(pageSource, /saveSupplierEdit/);
  assert.match(pageSource, /Firma nomi/);
});

test("purchase-order receipts and payments are idempotent and keep finance links", () => {
  const controlSource = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");
  assert.match(controlSource, /purchaseOrderActionsRef/);
  assert.match(controlSource, /purchase-order-purchase:\$\{order\.id\}/);
  assert.match(controlSource, /purchase-order-receipt:\$\{order\.id\}:\$\{index\}/);
  assert.match(controlSource, /purchase-order-payment:\$\{order\.id\}/);
  assert.match(controlSource, /purchase-order-finance:\$\{order\.id\}/);
  assert.match(controlSource, /transactionId,/);
  assert.match(controlSource, /accountId,/);
  assert.match(controlSource, /Takror pul chiqimi yaratilmadi/);
});

test("supplier bank details and editable receipt documents are wired safely", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../app/api/stock-documents/route.ts", import.meta.url), "utf8");
  const stateRouteSource = readFileSync(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const storeSource = readFileSync(new URL("../app/lib/halo-store.ts", import.meta.url), "utf8");
  const hosting = JSON.parse(readFileSync(new URL("../.openai/hosting.json", import.meta.url), "utf8"));

  assert.equal(hosting.r2, "BUCKET");
  assert.match(pageSource, /bankAccount/);
  assert.match(pageSource, /editingMovementId/);
  assert.match(pageSource, /movementDocumentFile/);
  assert.match(pageSource, /transactionDocumentFile/);
  assert.match(pageSource, /Oldi-berdi nakladnoy rasmi/);
  assert.match(pageSource, /className="transaction-document-link"/);
  assert.match(pageSource, /NAKLADNOYLAR BAZASI/);
  assert.match(pageSource, /Qarz to‘langanda nakladnoy o‘chmaydi/);
  assert.match(pageSource, /Nakladnoylar bazada saqlandi/);
  assert.match(pageSource, /disabled=\{Boolean\(editingTransactionId\)\}/,
    "an existing invoice cannot be silently converted into a payment");
  assert.match(pageSource, /\/api\/stock-documents/);
  assert.match(routeSource, /isAdminRequest/);
  assert.match(routeSource, /STOCK_DOCUMENT_MAX_BYTES/);
  assert.match(stateRouteSource, /validStockDocuments\(body\.stockMovements\)/);
  assert.match(stateRouteSource, /validStockDocuments\(body\.transactions\)/);
  assert.match(stateRouteSource, /activeDeletedEntityConflicts\(body\)/,
    "a stale edit is rejected before it can keep dependent warehouse stock");
  assert.match(stateRouteSource, /missingUnarchivedSupplierPurchases/,
    "the server rejects payment saves that silently drop an invoice");
  assert.match(storeSource, /recover-supplier-invoices-after-payment-2026-08-21-v1/);
  assert.match(storeSource, /Historical one-off repairs\/resets are retired/, "upgrades do not repeat old balance repairs");
});

test("stock receipt photos accept only owned image keys and bounded files", () => {
  const valid = {
    key: "stock-documents/main/123e4567-e89b-12d3-a456-426614174000.jpg",
    fileName: "nakladnoy.jpg",
    contentType: "image/jpeg",
    size: 1024,
    uploadedAt: "2026-08-13T10:00:00.000Z",
  };
  assert.equal(validStockDocument(valid), true);
  assert.equal(validStockDocuments([{ id: "movement", document: valid }, { id: "without-photo" }]), true);
  assert.equal(validStockDocuments([{ id: "transaction", type: "purchase", document: valid }]), true);
  assert.equal(validStockDocument({ ...valid, key: "private/other-file.jpg" }), false);
  assert.equal(validStockDocument({ ...valid, contentType: "image/svg+xml" }), false);
  assert.equal(validStockDocument({ ...valid, size: STOCK_DOCUMENT_MAX_BYTES + 1 }), false);
});

test("editing a stock receipt reverses the old quantity before applying the new one", () => {
  assert.equal(stockMovementQuantity("receipt", -8), 8);
  assert.equal(stockMovementQuantity("waste", 3), -3);
  assert.equal(stockMovementQuantity("adjustment", -2), -2);

  const inventory = [{ id: "a", stock: 10 }, { id: "b", stock: 3 }];
  assert.deepEqual(
    applyStockMovementToInventory(inventory, { inventoryId: "a", quantity: 5 }, { inventoryId: "a", quantity: 8 }),
    [{ id: "a", stock: 13 }, { id: "b", stock: 3 }],
  );
  assert.deepEqual(
    applyStockMovementToInventory(inventory, { inventoryId: "a", quantity: 5 }, { inventoryId: "b", quantity: 8 }),
    [{ id: "a", stock: 5 }, { id: "b", stock: 11 }],
  );
  assert.equal(
    applyStockMovementToInventory([{ id: "a", stock: 2 }], null, { inventoryId: "a", quantity: -3 }),
    null,
  );
});

test("a positive warehouse receipt saves despite existing negative balances", () => {
  assert.deepEqual(
    applyStockMovementToInventory(
      [{ id: "un", stock: -500 }, { id: "yog", stock: -1 }],
      null,
      { inventoryId: "un", quantity: 100 },
    ),
    [{ id: "un", stock: -400 }, { id: "yog", stock: -1 }],
    "a receipt that improves flour stock must not be blocked while it is still negative",
  );
  assert.deepEqual(
    applyStockMovementToInventory(
      [{ id: "un", stock: 0 }, { id: "yog", stock: -1 }],
      null,
      { inventoryId: "un", quantity: 100 },
    ),
    [{ id: "un", stock: 100 }, { id: "yog", stock: -1 }],
    "an unrelated negative item must not block a flour receipt",
  );
});

test("only retryable state-save failures remain in the save queue", () => {
  assert.equal(shouldRetryFailedStateSave(400), false);
  assert.equal(shouldRetryFailedStateSave(401), false);
  assert.equal(shouldRetryFailedStateSave(413), false);
  assert.equal(shouldRetryFailedStateSave(409), true);
  assert.equal(shouldRetryFailedStateSave(429), true);
  assert.equal(shouldRetryFailedStateSave(503), true);
});

test("deleting an older priced receipt keeps the original fallback cost chain", () => {
  const first = {
    id: "a", inventoryId: "stock", type: "receipt", date: "2026-08-01",
    unitCost: 10, previousUnitCost: 5,
  };
  const second = {
    id: "b", inventoryId: "stock", type: "receipt", date: "2026-08-02",
    unitCost: 20, previousUnitCost: 10,
  };
  const remaining = bypassRemovedReceiptCost([second], first);
  assert.equal(remaining[0].previousUnitCost, 5,
    "the next receipt bypasses a deleted predecessor instead of resurrecting its price later");
  assert.deepEqual(bypassRemovedReceiptCost([], remaining[0]), [],
    "deleting the final receipt leaves its corrected base fallback available to the caller");
});

test("warehouse products and manual incoming records expose clear edit and delete controls", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const deleteRouteSource = readFileSync(new URL("../app/api/inventory-records/route.ts", import.meta.url), "utf8");

  assert.match(pageSource, /Mahsulotni tahrirlash/);
  assert.match(pageSource, /Mahsulotni o‘chirish/);
  assert.match(pageSource, /WarehouseRecordsPanel/);
  assert.match(pageSource, /Kirim hujjatini boshqarish/);
  assert.match(pageSource, /qoldiq qayta hisoblandi va sabab “Bekor qilinganlar” tarixiga yozildi/);
  assert.match(pageSource, /isPurchaseOrderMovement\(movement\)/,
    "linked purchase-order receipts cannot corrupt stock and supplier debt through row-only edits");
  assert.match(pageSource, /Buyurtmadan boshqarish/);
  assert.match(pageSource, /filteredInventoryRangeMovements\.slice\(0, stockHistoryLimit\)/,
    "archived product history cannot remain in the active warehouse table");
  assert.match(pageSource, /const queuedArchiveConflicts = activeDeletedEntityConflicts\(payloadCandidate\)/,
    "a save queued during deletion is checked again against the fresh archive before reconciliation");
  assert.match(pageSource, /saveQueueRef\.current = resultOperation\.then\(\(\) => true, \(\) => false\)/,
    "DELETE and authoritative reload stay inside the same save queue");
  assert.match(pageSource, /Mahsulotni tez topish/);
  assert.match(pageSource, /Kam qolgan/);
  assert.match(deleteRouteSource, /isAdminRequest\(request\)/);
  assert.match(deleteRouteSource, /mutateHaloState<InventoryDeletionResult>/,
    "warehouse deletion retries atomically instead of losing a delete on a stale revision");
  assert.match(cssSource, /\.inventory-edit-guide/);
  assert.match(cssSource, /\.inventory-browser/);
  assert.match(cssSource, /\.inventory-owner-table \.table-row\.inventory-row/,
    "mobile product actions are rendered as visible cards instead of an off-screen table column");
});

test("owner reaches staff control from an exact five-area mobile navigation", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(pageSource, /const primaryNav = \(\["dashboard", "sales", "intake", "inventory"\] as const\)/);
  assert.match(pageSource, /<span>Yana<\/span>/);
  assert.match(pageSource, /className="more-nav-item" href="\/davomat"/);
  assert.match(pageSource, /moreNavGroups\.map/,
    "all secondary capabilities remain available from grouped Yana navigation");
  assert.match(cssSource, /\.mode-owner \.sidebar>nav\.primary-nav\{width:calc\(100% - 56px\)!important;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important\}/,
    "the mobile dock has four direct destinations plus the separate Yana button");
});

test("reads a Korean daily product XLS structure with its own date and stable IDs", () => {
  const matrix = [
    ["당일매출종합현황 (상품별 매출현황)", "", "", "", ""],
    ["", "", "", "", ""],
    ["조회일자 : 2026-01-15", "", "", "", ""],
    ["", "", "", "", ""],
    [" ", "", "", "", ""],
    ["No.", "상품코드", "상품명", "수량", "실매출"],
    [1, "000101", "MENU A", 2, 20_000],
    [2, "000102", "MENU B", 3, 45_000],
    ["합계", "", "", 5, 65_000],
  ];
  const table = extractPosTable(matrix, "daily-report.xls", "Sheet");
  const renamedTable = extractPosTable(matrix, "daily-report (2).xls", "Sheet");
  const mapping = autoDetectPosColumns(table.headers);
  const parsed = parsePosRows(table, mapping, "2026-08-14");
  const renamed = parsePosRows(renamedTable, mapping, "2026-08-14");

  assert.equal(table.headerRowNumber, 6);
  assert.equal(table.reportDate, "2026-01-15");
  assert.equal(table.reportFormat, "okpos-daily-product");
  assert.deepEqual(mapping, {
    product: "",
    productCode: "상품코드",
    quantity: "수량",
    total: "실매출",
    discount: "",
    date: "",
    externalId: "",
  });
  assert.equal(parsed.rows.length, 2, "the 합계 footer is not imported as a menu item");
  assert.deepEqual(parsed.rows.map((row) => row.productCode), ["000101", "000102"], "leading zero product codes are preserved");
  assert.deepEqual(parsed.rows.map((row) => row.mappingKey), ["code:000101", "code:000102"]);
  assert.ok(parsed.rows.every((row) => row.date === "2026-01-15"));
  assert.equal(parsed.rows.reduce((sum, row) => sum + row.quantity, 0), 5);
  assert.equal(parsed.rows.reduce((sum, row) => sum + row.totalRevenue, 0), 65_000,
    "actual POS revenue is preserved independently of current menu prices");
  assert.equal(parsed.summary?.matches, true);
  assert.deepEqual(renamed.rows.map((row) => row.externalId), parsed.rows.map((row) => row.externalId), "renaming the same report cannot bypass duplicate protection");
  assert.equal(detectPosReportDate([["조회일자 : 2026-02-31"]]), "", "impossible metadata dates are rejected");

  const footerInProductColumn = extractPosTable([
    ...matrix.slice(0, -1),
    ["", "", "총계", 5, 65_000],
  ], "daily-report.xls", "Sheet");
  assert.equal(parsePosRows(footerInProductColumn, mapping, "2026-08-14").rows.length, 2,
    "a total label in the product column is never imported as a menu item");

  const negativeAggregate = extractPosTable(matrix.map((row, index) => index === 6
    ? [1, "000101", "MENU A", -2, -20_000]
    : row), "daily-report.xls", "Sheet");
  const negativeParsed = parsePosRows(negativeAggregate, mapping, "2026-08-14");
  assert.deepEqual(negativeParsed.rows.map((row) => row.product), ["Kod 000102"],
    "negative aggregate rows are not silently turned into positive sales");
  assert.equal(negativeParsed.summary?.matches, false, "the footer check blocks a partial aggregate import");
});

test("POS identifies products by code and preserves actual sales totals", () => {
  const table = extractPosTable([
    ["Mahsulot kodi", "Taom nomi", "Sotilgan soni", "Savdo summasi"],
    ["0007", "Chicken", 2, 20_000],
    ["0008", "Chicken", 1, 12_000],
  ], "savdo.xlsx", "Kunlik");
  const mapping = autoDetectPosColumns(table.headers);
  const parsed = parsePosRows(table, mapping, "2026-08-22");

  assert.equal(mapping.productCode, "Mahsulot kodi");
  assert.equal(mapping.quantity, "Sotilgan soni");
  assert.equal(mapping.product, "");
  assert.equal(mapping.total, "Savdo summasi");
  assert.deepEqual(parsed.rows.map((row) => row.productCode), ["0007", "0008"]);
  assert.deepEqual(parsed.rows.map((row) => row.mappingKey), ["code:0007", "code:0008"]);
  assert.deepEqual(parsed.rows.map((row) => row.quantity), [2, 1]);
  assert.deepEqual(parsed.rows.map((row) => row.totalRevenue), [20_000, 12_000]);
  assert.equal(new Set(parsed.rows.map((row) => row.externalId)).size, 2);

  const noQuantityTable = extractPosTable([
    ["상품코드", "상품명", "실매출"],
    ["0007", "Chicken", 20_000],
  ], "bad.xlsx", "Kunlik");
  const noQuantityMapping = autoDetectPosColumns(noQuantityTable.headers);
  assert.equal(noQuantityMapping.quantity, "");
  assert.equal(parsePosRows(noQuantityTable, noQuantityMapping, "2026-08-22").rows.length, 0,
    "a code without 수량 is never guessed as one sale");
});

test("owner and employee import by code with actual Excel amounts or explicit photo estimates", () => {
  const ownerPage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workerPage = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const photoImport = readFileSync(new URL("../app/photo-import.ts", import.meta.url), "utf8");

  assert.match(ownerPage, /photoPosCodeQuantityMapping/);
  assert.match(ownerPage, /const totalRevenue = row\.importRevenue/);
  assert.match(ownerPage, /Tushum menyu narxi bo‘yicha TAXMIN/);
  assert.doesNotMatch(ownerPage, /className="photo-product-input"/);
  assert.doesNotMatch(ownerPage, /className="photo-total-input"/);
  assert.doesNotMatch(ownerPage, /className="photo-date-input"/);
  assert.match(workerPage, /Faqat 상품코드 va 수량/);
  assert.match(photoImport, /export const photoPosCodeQuantityMapping/);
});

test("POS totals stay attached to the correct 27 codes and quantities", () => {
  const pairs = [
    ["000045", 4], ["000039", 4], ["000011", 16], ["000023", 4], ["000041", 15],
    ["000003", 2], ["000038", 3], ["000032", 4], ["000031", 4], ["000065", 2],
    ["000035", 26], ["000034", 2], ["000019", 2], ["000066", 1], ["000051", 1],
    ["000046", 1], ["000050", 1], ["000029", 1], ["000044", 1], ["000049", 1],
    ["000061", 1], ["000009", 4], ["000047", 2], ["000063", 1], ["000043", 1],
    ["000042", 1], ["000021", 1],
  ];
  const table = extractPosTable([
    ["No.", "상품코드", "상품명", "수량", "실매출"],
    ...pairs.map(([code, quantity], index) => [index + 1, code, `IGNORED ${index + 1}`, quantity, 999_999]),
  ], "6095791790263833163_121.jpg.xlsx", "Sheet1");
  const parsed = parsePosRows(table, autoDetectPosColumns(table.headers), "2026-08-29");

  assert.equal(parsed.rows.length, 27);
  assert.equal(parsed.rows.reduce((sum, row) => sum + row.quantity, 0), 106);
  assert.equal(parsed.rows.reduce((sum, row) => sum + row.totalRevenue, 0), 27 * 999_999);
  assert.deepEqual(parsed.rows.slice(0, 3).map((row) => row.productCode), ["000045", "000039", "000011"]);
  assert.equal(parsed.rows.at(-1).productCode, "000021");
  assert.ok(parsed.rows.every((row) => row.product.startsWith("Kod ")),
    "상품명 never becomes the product identity");

  const strictPhoto = ocrOkposCodeQuantityColumns(
    pairs.map(([code]) => code).join("\n"),
    [...pairs.map(([, quantity]) => quantity), 106].join("\n"),
    [],
    "2026-08-29",
    "6095791790263833163_121.jpg",
  );
  assert.ok(strictPhoto);
  assert.equal(strictPhoto.table.rows.length, 27);
  assert.equal(strictPhoto.parsedQuantity, 106);
  assert.equal(strictPhoto.parsedTotal, 0);
  assert.equal(strictPhoto.table.rows[0].values[photoPosMapping.productCode], "000045");
  assert.equal(strictPhoto.table.rows[0].values[photoPosMapping.quantity], 4);
  assert.equal(ocrOkposCodeQuantityColumns("000045\n000039", "4", [], "2026-08-29", "bad.jpg"), null,
    "a missing value blocks import instead of shifting quantities onto the wrong code");
});

test("reads a product code from a photographed daily receipt", () => {
  const parsed = ocrTextToPosTable(
    "000101 CHICKEN 2 20,000\nTOTAL 2 20,000",
    [{ id: "chicken", name: "CHICKEN", posCode: "000101", salePrice: 10_000 }],
    "2026-08-22",
    "daily-check.jpg",
  );
  assert.equal(parsed.table.rows.length, 1);
  assert.equal(parsed.table.rows[0].values[photoPosMapping.product], "CHICKEN");
  assert.equal(parsed.table.rows[0].values[photoPosMapping.productCode], "000101");
  const rows = parsePosRows(parsed.table, photoPosMapping, "2026-08-22").rows;
  assert.equal(rows[0].mappingKey, "code:000101");
});

test("menu codes are unique, editable, and retain learned POS aliases", () => {
  const coded = ensureMenuCodes([
    { id: "a", posCode: "", posAliases: [] },
    { id: "b", posCode: "menu-22", posAliases: ["000101"] },
    { id: "c", posCode: "menu-22", posAliases: [] },
  ]);
  assert.equal(coded[0].posCode, "M0001");
  assert.equal(coded[1].posCode, "MENU-22");
  assert.notEqual(coded[2].posCode, coded[1].posCode);
  assert.equal(recipeHasMenuCode(coded[1], "000101"), true);
  assert.equal(nextMenuCode(coded), "M0003");
  assert.equal(preferredMenuCode(coded[0]), "M0001");
  assert.equal(preferredMenuCode({ id: "legacy", posCode: "M0042", posAliases: ["000777"] }), "000777");
  assert.deepEqual(allMenuCodes({ id: "legacy", posCode: "M0042", posAliases: ["000777"] }), ["000777", "M0042"]);

  const promoted = promoteLearnedMenuCodes(coded, [
    { recipeId: "b", code: "000102" },
    { recipeId: "b", code: "000103" },
  ]);
  assert.equal(promoted[1].posCode, "000103", "the latest confirmed POS code becomes the primary Sheets code");
  assert.equal(recipeHasMenuCode(promoted[1], "MENU-22"), true, "the former primary code remains a safe alias");
  assert.equal(recipeHasMenuCode(promoted[1], "000102"), true);
});

test("HALO Xodim installs as a separate iPhone home-screen app", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/xodim-manifest.webmanifest", import.meta.url), "utf8"));
  const layoutSource = readFileSync(new URL("../app/worker/layout.tsx", import.meta.url), "utf8");
  const installerSource = readFileSync(new URL("../app/xodim-install.tsx", import.meta.url), "utf8");
  const languageSource = readFileSync(new URL("../app/lib/worker-i18n.ts", import.meta.url), "utf8");
  const controlSource = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");
  const appleIcon = readFileSync(new URL("../public/icons/halo-xodim-180.png", import.meta.url));

  assert.equal(manifest.id, "/xodim");
  assert.equal(manifest.start_url, "/xodim");
  assert.equal(manifest.scope, "/xodim");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.every((icon) => icon.src.includes("halo-xodim-")), "employee app uses its own green icon");
  assert.match(layoutSource, /halo-xodim-180\.png/);
  assert.match(layoutSource, /apple-mobile-web-app-capable/);
  assert.match(installerSource, /#iphone-app/);
  assert.match(installerSource, /install\.step3/);
  assert.match(languageSource, /Add to Home Screen \/ 홈 화면에 추가/);
  assert.match(controlSource, /href="\/xodim#iphone-app"/);
  assert.deepEqual([...appleIcon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], "Apple touch icon is a real PNG");
});

test("HALO Control installs as a Windows desktop app", () => {
  const installerSource = readFileSync(new URL("../app/apple-install.tsx", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const shellSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.display_override, ["standalone"]);
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.deepEqual(manifest.shortcuts.map((entry) => entry.url), ["/pos-terminal", "/hisob", "/nazorat"]);
  assert.match(installerSource, /beforeinstallprompt/);
  assert.match(installerSource, /appinstalled/);
  assert.match(installerSource, /Windows’ga o‘rnatish/);
  assert.match(installerSource, /#windows-app/);
  assert.match(shellSource, /<AppleInstall\s*\/>\s*<details className="header-more">/);
});

test("desktop management navigation shows every section without depending on scrolling", () => {
  const shellSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const section of ["recipes", "reports", "fees", "finance", "suppliers", "control", "integrations"]) {
    assert.match(shellSource, new RegExp(`id: "${section}" as Tab`));
  }
  assert.match(shellSource, /summary aria-label="Yana bo‘limlarini ochish"/);
  assert.match(shellSource, /moreNavGroups\.map/);
  assert.match(cssSource, /\.sidebar \{[^}]*overflow-y:auto;[^}]*scrollbar-gutter:stable/);
  assert.match(cssSource, /\.more-nav>div\{position:fixed;z-index:90;left:254px;bottom:24px;width:min\(430px,calc\(100vw - 278px\)\);max-height:calc\(100dvh - 48px\);padding:10px;overflow-y:scroll;[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(cssSource, /\.more-nav>div\{position:fixed;right:8px;left:auto;bottom:80px;width:min\(330px,calc\(100vw - 16px\)\);max-height:calc\(100dvh - 96px\)/);
});

test("HALO Xodim attendance uses work-start/work-finish wording in four languages", () => {
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");

  assert.deepEqual(WORKER_LANGUAGES.map((item) => item.code), ["uz", "en", "ko", "ru"]);
  assert.equal(translateWorker("uz", "attendance.start"), "ISHNI BOSHLADIM");
  assert.equal(translateWorker("uz", "attendance.finish"), "ISHNI TUGATDIM");
  assert.equal(translateWorker("en", "attendance.start"), "STARTED WORK");
  assert.equal(translateWorker("ko", "attendance.finish"), "업무 종료");
  assert.equal(translateWorker("ru", "attendance.start"), "НАЧАЛ РАБОТУ");
  assert.equal(translateWorker("uz", "login.retry"), "Qayta urinish");
  assert.equal(translateWorker("ko", "login.retry"), "다시 시도");
  assert.equal(workerLocale("ko"), "ko-KR");
  assert.equal(normalizeWorkerLanguage("invalid"), "uz");
  assert.equal(
    translateWorkerError("Ochiq smena topilmadi. Avval “KELDI”ni bosing.", "ru", "attendance.saveError"),
    "Открытая смена не найдена. Сначала нажмите «НАЧАЛ РАБОТУ».",
  );
  assert.match(workerSource, /halo-worker-language/);
  assert.match(workerSource, /t\("attendance\.start"\)/);
  assert.match(workerSource, /t\("attendance\.finish"\)/);
  assert.match(workerSource, /attendance\.todayStatus && !attendance\.openShift/, "a new-day status must not hide an overnight open shift");
  assert.match(workerSource, /Boolean\(attendance\.todayStatus && !attendance\.openShift\)/, "ISHNI TUGATDIM stays enabled across midnight");
  assert.match(workerSource, /attendance\.openShift \? t\("attendance\.finish"\) : attendance\.todayStatus/, "finish action has priority over the new calendar day's status");
});

test("creates a Google Sheets CSV with UTF-8 text and safe user-entered cells", () => {
  const csv = spreadsheetRowsToCsv([{
    Xodim: "Otabek",
    Holat: "Dam olish",
    Sabab: "Oilaviy, \"muhim\" sabab",
    Summa: 12000,
    Xavfli: "=SUM(1,2)",
  }]);
  assert.ok(csv.startsWith("\uFEFF"), "Google Sheets must receive a UTF-8 BOM");
  assert.ok(csv.includes('"Oilaviy, ""muhim"" sabab"'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'), "formula-like text must stay plain text");
  assert.equal(safeSpreadsheetValue("@buyruq"), "'@buyruq");
  assert.equal(safeFilePart("Main / Filial: 1"), "Main-Filial-1");
});

test("creates a real ZIP archive with API and section files", () => {
  const archive = createZipArchive([
    { name: "HALO-CONTROL-API.json", content: '{"product":"HALO Control"}' },
    { name: "malumotlar/inventory.json", content: "[]" },
    { name: "nakladnoy/test.jpg", content: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
  ], new Date("2026-08-13T12:00:00+09:00"));
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const text = new TextDecoder().decode(archive);
  assert.equal(view.getUint32(0, true), 0x04034b50, "ZIP starts with a local file header");
  assert.equal(view.getUint32(archive.byteLength - 22, true), 0x06054b50, "ZIP ends with the central directory record");
  assert.ok(text.includes("HALO-CONTROL-API.json"));
  assert.ok(text.includes("malumotlar/inventory.json"));
  assert.ok(text.includes("nakladnoy/test.jpg"));
});

test("control center exposes prominent API JSON and ZIP download actions", () => {
  const source = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");
  const backupRoute = readFileSync(new URL("../app/api/backups/route.ts", import.meta.url), "utf8");
  assert.match(source, /API VA ZIP YUKLASH/);
  assert.match(source, /API JSON yuklash/);
  assert.match(source, /To‘liq ZIP yuklash/);
  assert.match(backupRoute, /halo-control-api-export/);
  assert.match(backupRoute, /Cache-Control/);
});

test("attendance window exposes separate monthly downloads for every employee", () => {
  const source = readFileSync(new URL("../app/davomat/davomat-client.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /monthlyReport\(member\.id\)/);
  assert.match(source, /exportStaffExcel\(member\)/);
  assert.match(source, /exportStaffCsv\(member\)/);
  assert.match(source, /safeFilePart\(member\.name\)/, "employee name is included safely in the file name");
  assert.match(source, /KUNMA-KUN ISH HAQI/);
  assert.match(source, /revision=1/, "owner attendance window refreshes after worker clock-out");
  assert.match(source, /freezeWorkShiftRates\(selectedMember, data\.workShifts\)/, "salary edits preserve historical daily rates");
  assert.match(source, /ISHNI TUGATGACH HISOBLANADI/, "an open shift never presents provisional money as earned");
  assert.match(source, /loadRequestRef/, "stale branch loads cannot replace the selected branch");
  assert.match(source, /pollInFlightRef/, "attendance revision polls cannot overlap");
  assert.match(styles, /grid-template-areas:"date total"/, "mobile daily cards keep the date beside its total");

  const staff = [{
    id: "ali",
    name: "Ali",
    monthlySalary: 2_600_000,
    hourlyRate: 0,
    payType: "monthly",
    workDays: 26,
    dailyHours: 8,
    overtimeAfterHours: 8,
    overtimeMultiplier: 1,
    workerId: "",
    active: true,
  }];
  const report = buildPayrollReport({
    staff,
    workShifts: [],
    payrollAdjustments: [],
    attendanceDays: [],
    payrollPayments: [],
    month: "2026-08",
  });
  assert.deepEqual(report.summaryRows.map((row) => row.Xodim), ["Ali"]);
  assert.ok(report.googleSheetsRows.every((row) => row.Xodim === "Ali"));
});

test("payroll rounds each workday with HALO minute thresholds", () => {
  const hour = 60;
  for (const minute of [0, 10, 14, 20, 27]) assert.equal(roundPayrollMinutes(8 * hour + minute), 8 * hour);
  for (const minute of [28, 30, 40, 45, 50, 57]) assert.equal(roundPayrollMinutes(8 * hour + minute), 8 * hour + 30);
  for (const minute of [58, 59, 60]) assert.equal(roundPayrollMinutes(8 * hour + minute), 9 * hour);

  const member = {
    id: "rounding-staff",
    name: "Rounding",
    monthlySalary: 0,
    hourlyRate: 10_000,
    payType: "hourly",
    workDays: 26,
    dailyHours: 8,
    overtimeAfterHours: 8,
    overtimeMultiplier: 1,
    workerId: "",
    active: true,
  };
  const shift = (id, clockIn, clockOut) => ({
    id,
    staffId: member.id,
    date: "2026-08-13",
    clockIn,
    clockOut,
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    overtimeAfterHoursAtShift: 8,
    overtimeMultiplierAtShift: 1,
    note: "",
    source: "owner",
    status: "closed",
    createdAt: clockIn,
    updatedAt: clockOut,
  });
  const day = calculateWorkdayPay(member, [
    shift("morning", "2026-08-13T00:00:00.000Z", "2026-08-13T04:20:00.000Z"),
    shift("evening", "2026-08-13T05:00:00.000Z", "2026-08-13T09:20:00.000Z"),
  ]);
  assert.equal(day.workedMinutes, 8 * hour + 40, "actual clock time is preserved");
  assert.equal(day.payableMinutes, 8 * hour + 30, "rounding is applied once to the daily total");
  assert.equal(day.totalPay, 85_000);
  const dailyEntries = calculateWorkdayPayEntries(member, [
    shift("morning", "2026-08-13T00:00:00.000Z", "2026-08-13T04:20:00.000Z"),
    shift("evening", "2026-08-13T05:00:00.000Z", "2026-08-13T09:20:00.000Z"),
  ]);
  assert.equal(dailyEntries.length, 1, "split shifts create one daily wage row");
  assert.equal(dailyEntries[0].payableMinutes, 8 * hour + 30);
  assert.equal(dailyEntries[0].roundedTotalPay, 85_000);

  const summaryShift = shift("summary", "2026-08-13T00:00:00.000Z", "2026-08-13T08:20:00.000Z");
  const summary = calculatePayroll(member, [summaryShift], [], "2026-08");
  assert.equal(summary.workedMinutes, 8 * hour + 20);
  assert.equal(summary.payableWorkedMinutes, 8 * hour);
  assert.equal(summary.grossPay, 80_000);

  const report = buildPayrollReport({
    staff: [member],
    workShifts: [summaryShift],
    payrollAdjustments: [],
    attendanceDays: [],
    payrollPayments: [],
    month: "2026-08",
  });
  assert.equal(report.summaryRows[0]["Ishlangan soat"], 8.3, "the report keeps actual time visible");
  assert.equal(report.summaryRows[0]["Maoshga hisoblangan ish soati"], 8);
  assert.equal(report.shiftRows[0]["Kun hisoblangan soat"], 8);
  assert.equal(report.dailyPayRows.length, 1);
  assert.equal(report.dailyPayRows[0]["Kunlik qo‘shilgan pul"], 80_000);
});

test("employee payroll ignores arrival before and departure after the manager schedule", () => {
  const member = normalizeStaff([{
    id: "scheduled-staff",
    name: "Ali",
    payType: "hourly",
    monthlySalary: 0,
    hourlyRate: 10_000,
    workDays: 26,
    dailyHours: 12,
    overtimeAfterHours: 12,
    overtimeMultiplier: 1,
    scheduledStartTime: "10:00",
    scheduledEndTime: "22:00",
    workerId: "",
    active: true,
  }])[0];
  const window = staffPayWindowForInstant(member, new Date("2026-09-17T00:00:00.000Z"));
  assert.deepEqual(window, {
    start: "2026-09-17T01:00:00.000Z",
    end: "2026-09-17T13:00:00.000Z",
  });
  const shift = normalizeWorkShifts([{
    id: "scheduled-shift",
    staffId: member.id,
    date: "2026-09-17",
    clockIn: "2026-09-17T00:00:00.000Z",
    clockOut: "2026-09-17T14:00:00.000Z",
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    overtimeAfterHoursAtShift: 12,
    overtimeMultiplierAtShift: 1,
    payWindowStartAtShift: window.start,
    payWindowEndAtShift: window.end,
    note: "",
    source: "worker",
    status: "closed",
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T14:00:00.000Z",
  }])[0];
  assert.equal(workShiftMinutes(shift), 12 * 60);
  assert.equal(workShiftPay(member, shift), 120_000);
  assert.equal(shift.clockIn, "2026-09-17T00:00:00.000Z", "actual early arrival stays in history");
  assert.equal(shift.clockOut, "2026-09-17T14:00:00.000Z", "actual late departure stays in history");
});

test("daily wage whole-won allocation reconciles to the monthly work total", () => {
  const member = normalizeStaff([{
    id: "won-reconcile",
    name: "Won reconcile",
    payType: "monthly",
    monthlySalary: 1_000_000,
    workDays: 26,
    dailyHours: 7,
    overtimeAfterHours: 7,
    overtimeMultiplier: 1,
  }])[0];
  const rate = 1_000_000 / (26 * 7);
  const shifts = Array.from({ length: 26 }, (_, index) => ({
    id: `won-${index + 1}`,
    staffId: member.id,
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    clockIn: `2026-08-${String(index + 1).padStart(2, "0")}T03:00:00.000Z`,
    clockOut: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    breakMinutes: 0,
    hourlyRateAtShift: rate,
    overtimeAfterHoursAtShift: 7,
    overtimeMultiplierAtShift: 1,
    note: "",
    source: "owner",
    status: "closed",
    createdAt: "",
    updatedAt: "",
  }));
  const entries = calculateWorkdayPayEntries(member, shifts);
  const summary = calculatePayroll(member, shifts, [], "2026-08");
  assert.equal(entries.length, 26);
  assert.ok(entries.every((entry) => entry.roundedRegularPay + entry.roundedOvertimePay === entry.roundedTotalPay), "visible pay components reconcile on every day");
  assert.equal(entries.reduce((sum, entry) => sum + entry.roundedTotalPay, 0), Math.round(summary.regularPay + summary.overtimePay));
  assert.equal(Math.round(summary.basePay), 1_000_000);
});

test("daily and Telegram reports share all profit expenses", () => {
  const state = {
    accounts: [
      { id: "account-card", type: "card" },
      { id: "delivery", type: "delivery" },
      { id: "cash", type: "cash" },
    ],
    sales: [
      { date: "2026-08-13", quantity: 2, totalRevenue: 100_000, totalCost: 40_000, accountId: "account-card" },
      { date: "2026-08-13", quantity: 1, totalRevenue: 50_000, totalCost: 20_000, accountId: "delivery" },
      { date: "2026-08-13", quantity: 0, totalRevenue: 20_000, totalCost: 5_000 },
      { date: "2026-08-12", quantity: 9, totalRevenue: 999_000, totalCost: 0, accountId: "cash" },
    ],
    financialEntries: [
      { date: "2026-08-13", type: "expense", amount: 10_000, affectsProfit: true },
      { date: "2026-08-13", type: "expense", amount: 5_000, fixedExpenseId: "rent" },
      { date: "2026-08-13", type: "expense", amount: 50_000, affectsProfit: false },
      { date: "2026-08-13", type: "expense", category: "Soliq", amount: 99_000, affectsProfit: true },
      { date: "2026-08-13", type: "expense", category: "POS / karta komissiyasi", amount: 99_000, affectsProfit: true },
      { date: "2026-08-13", type: "expense", category: "Yetkazib berish komissiyasi", amount: 99_000, affectsProfit: true },
      { date: "2026-08-13", type: "income", amount: 7_000, affectsProfit: true },
    ],
    costRules: { cardCommissionPct: 2, deliveryCommissionPct: 10, taxPct: 3 },
    staff: [{
      id: "daily-report-worker",
      name: "Ali",
      payType: "hourly",
      monthlySalary: 0,
      hourlyRate: 10_000,
      workDays: 26,
      dailyHours: 8,
      overtimeAfterHours: 8,
      overtimeMultiplier: 1,
      workerId: "",
      active: true,
    }],
    workShifts: [{
      id: "daily-report-shift",
      staffId: "daily-report-worker",
      date: "2026-08-13",
      clockIn: "2026-08-13T00:00:00.000Z",
      clockOut: "2026-08-13T08:30:00.000Z",
      breakMinutes: 0,
      hourlyRateAtShift: 10_000,
      overtimeAfterHoursAtShift: 8,
      overtimeMultiplierAtShift: 1,
      note: "",
      source: "owner",
      status: "closed",
    }],
    payrollAdjustments: [],
    attendanceDays: [],
  };
  const report = calculateDailyReport(state, "2026-08-13");

  assert.equal(report.revenue, 170_000);
  assert.equal(report.cost, 65_000);
  assert.equal(report.manualExpenses, 15_000, "legacy expenses without the flag still affect profit");
  assert.equal(report.enteredExpenses, 10_000, "manually entered expenses stay separately visible");
  assert.equal(report.recurringExpenses, 5_000, "automatic monthly expenses stay separately visible");
  assert.equal(report.payroll, 85_000);
  assert.equal(report.cardCommission, 2_400, "legacy sales without an account use the card account");
  assert.equal(report.deliveryCommission, 5_000);
  assert.equal(report.tax, 3_600);
  assert.equal(report.totalExpenses, 111_000);
  assert.equal(report.netProfit, 1_000);
  assert.equal(report.itemCount, 3);
  assert.equal(validCostRules({ cardCommissionPct: 0, deliveryCommissionPct: 1.5, taxPct: 10 }), true);
  assert.equal(validCostRules({ cardCommissionPct: 101, deliveryCommissionPct: 0, taxPct: 0 }), false);
  assert.equal(costRuleCoversCategory("Soliq", state.costRules), true);
  assert.equal(costRuleCoversCategory("Ijara", state.costRules), false);

  const telegramSource = (readFileSync(new URL("../app/api/telegram/route.ts", import.meta.url), "utf8") + readFileSync(new URL("../app/lib/telegram-service.ts", import.meta.url), "utf8"));
  assert.match(telegramSource, /calculateDailyReport\(state, reportDate\)/);
  assert.match(telegramSource, /Jami xarajat/);
});

test("cash and bank sales stay in revenue while their tax is accountant-managed", () => {
  const report = calculateDailyReport({
    accounts: [
      { id: "card", type: "card" },
      { id: "delivery", type: "delivery" },
      { id: "cash", type: "cash" },
      { id: "bank", type: "bank" },
    ],
    sales: [
      { date: "2026-08-20", quantity: 2, totalRevenue: 100_000, totalCost: 40_000, accountId: "card" },
      { date: "2026-08-20", quantity: 1, totalRevenue: 40_000, totalCost: 15_000, accountId: "delivery" },
      { date: "2026-08-20", quantity: 3, totalRevenue: 30_000, totalCost: 12_000, accountId: "cash" },
      { date: "2026-08-20", quantity: 4, totalRevenue: 20_000, totalCost: 8_000, accountId: "bank" },
    ],
    workerConsumptions: [
      { date: "2026-08-20", kind: "inventory_only", quantity: 7, totalCost: 20_000 },
    ],
    costRules: { cardCommissionPct: 2, deliveryCommissionPct: 10, taxPct: 3 },
  }, "2026-08-20");

  assert.equal(report.taxableSales, 100_000);
  assert.equal(report.accountantManagedSales, 90_000);
  assert.equal(report.taxExemptSales, 0);
  assert.equal(report.revenue, 190_000, "cash and bank sales remain visible in financial revenue");
  assert.equal(report.cost, 75_000, "all sale costs remain in the financial result");
  assert.equal(report.itemCount, 10, "all actual sold items are counted");
  assert.equal(report.cashSales, 30_000);
  assert.equal(report.bankSales, 20_000);
  assert.equal(report.inventoryOnlyItemCount, 7, "only explicit non-sale outflows are separated");
  assert.equal(report.inventoryOnlyCost, 20_000);
  assert.equal(report.totalExpenses, 29_000, "non-sale inventory usage must reduce profit exactly once");
  assert.equal(report.netProfit, 86_000);
  assert.equal(report.tax, 3_000);
  assert.equal(report.cardCommission, 2_000);
  assert.equal(report.cardSettlement, 98_000);
});

test("all financial totals use one whole-won rule without one-won reconciliation gaps", () => {
  const report = calculateDailyReport({
    accounts: [{ id: "card", type: "card" }],
    sales: [{
      date: "2026-08-20",
      quantity: 1,
      totalRevenue: 33_333,
      totalCost: 1_000.6,
      accountId: "card",
      source: "pos",
      taxTreatment: "automatic",
    }],
    costRules: { cardCommissionPct: 1.5, deliveryCommissionPct: 0, taxPct: 1.5 },
  }, "2026-08-20");

  assert.equal(report.revenue, 33_333);
  assert.equal(report.cost, 1_001);
  assert.equal(report.grossProfit, 32_332);
  assert.equal(report.cardCommission, 500);
  assert.equal(report.tax, 500);
  assert.equal(report.totalExpenses, 1_000);
  assert.equal(report.netProfit, 31_332);
  assert.equal(report.taxableSales + report.accountantManagedSales, report.revenue);
  assert.equal(report.grossProfit - report.totalExpenses + report.otherIncome, report.netProfit);
});

test("manual warehouse waste and staff food reduce profit once with a saved cost", () => {
  const report = calculateDailyReport({
    inventory: [{ id: "meat", unitCost: 1_000 }],
    workerConsumptions: [{
      id: "staff-meal",
      date: "2026-08-20",
      kind: "meal",
      quantity: 1,
      totalCost: 1_200,
    }],
    stockMovements: [
      { date: "2026-08-20", type: "waste", inventoryId: "meat", quantity: -2 },
      { date: "2026-08-20", type: "waste", inventoryId: "meat", quantity: -1, unitCost: 1_500 },
      {
        date: "2026-08-20",
        type: "waste",
        inventoryId: "meat",
        quantity: -1,
        unitCost: 1_000,
        referenceId: "staff-meal",
      },
    ],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
  }, "2026-08-20");

  assert.equal(report.manualWarehouseWasteCost, 3_500);
  assert.equal(report.kitchenOutflowCost, 1_200);
  assert.equal(report.wasteOutflowCost, 3_500);
  assert.equal(report.inventoryOnlyCost, 4_700);
  assert.equal(report.totalExpenses, 4_700);
  assert.equal(report.netProfit, -4_700);
});

test("MEZANA records stay fully isolated from HALO revenue, expense, and profit totals", () => {
  const base = {
    accounts: [{ id: "cash", type: "cash" }],
    sales: [{ date: "2026-08-28", quantity: 1, totalRevenue: 25_000, totalCost: 9_000, accountId: "cash" }],
    financialEntries: [{ id: "expense", date: "2026-08-28", type: "expense", amount: 2_000, affectsProfit: true }],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
  };
  const withoutMezana = calculateDailyReport(base, "2026-08-28");
  const withMezana = calculateDailyReport({
    ...base,
    mezanaEntries: [
      { action: "purchased", amount: 9_000 },
      { action: "returned", amount: 4_000 },
    ],
  }, "2026-08-28");
  assert.deepEqual(withMezana, withoutMezana,
    "MEZANA debt must never be counted again as HALO income, expense, or profit");
});

test("sale origin keeps POS and kiosk taxable while HALO HISOB stays accountant-managed", () => {
  const report = calculateDailyReport({
    accounts: [{ id: "cash", type: "cash" }, { id: "bank", type: "bank" }],
    sales: [
      { id: "sale-main-pos", source: "manual", date: "2026-08-22", totalRevenue: 545_000, totalCost: 200_000, quantity: 10, accountId: "cash" },
      { id: "kiosk-api-sale", source: "api", date: "2026-08-22", totalRevenue: 55_000, totalCost: 20_000, quantity: 1, accountId: "bank" },
      { id: "pos-terminal-sale:halo-hisob:0", source: "pos", date: "2026-08-22", totalRevenue: 30_000, totalCost: 10_000, quantity: 1, accountId: "cash" },
    ],
    costRules: { cardCommissionPct: 2, deliveryCommissionPct: 10, taxPct: 3 },
  }, "2026-08-22");

  assert.equal(report.revenue, 630_000);
  assert.equal(report.taxableSales, 600_000, "main POS and kiosk sales are classified by origin, not payment account");
  assert.equal(report.accountantManagedSales, 30_000, "only HALO HISOB entry stays outside automatic tax");
  assert.equal(report.cashSales, 575_000, "cash classification is independent of tax treatment");
  assert.equal(report.bankSales, 55_000);
  assert.equal(report.tax, 18_000);
});

test("cancelled financial records disappear from profit and expense totals without double counting", () => {
  const financialEntries = [
    { id: "expense-cancelled", date: "2026-08-20", type: "expense", category: "Ijara", amount: 100_000, affectsProfit: true },
    { id: "expense-reversal", date: "2026-08-20", type: "income", category: "Ijara", amount: 100_000, affectsProfit: true, reversedEntryId: "expense-cancelled" },
    { id: "expense-active", date: "2026-08-20", type: "expense", category: "Internet", amount: 20_000, affectsProfit: true },
  ];
  const report = calculateDailyReport({ financialEntries }, "2026-08-20");

  assert.deepEqual(selectActiveFinancialEntries(financialEntries).map((entry) => entry.id), ["expense-active"]);
  assert.equal(report.enteredExpenses, 20_000);
  assert.equal(report.manualExpenses, 20_000);
  assert.equal(report.otherIncome, 0);
  assert.equal(report.totalExpenses, 20_000);
});

test("old employee messages are cleared without touching payroll history", () => {
  const taskStore = readFileSync(new URL("../app/lib/worker-tasks.ts", import.meta.url), "utf8");
  const taskRoute = readFileSync(new URL("../app/api/worker-tasks/route.ts", import.meta.url), "utf8");
  const controlSource = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");

  assert.match(taskStore, /clear-old-worker-messages-2026-08-13-v1/);
  assert.match(taskStore, /DELETE FROM halo_worker_tasks/);
  assert.match(taskStore, /status = 'done'/, "cancelled tasks remain in the audit history");
  assert.doesNotMatch(taskStore, /status IN \('done','cancelled'\)/);
  assert.doesNotMatch(taskStore, /DELETE FROM app_state/);
  assert.match(taskRoute, /action === "clear-history"/);
  assert.match(controlSource, /Eski xabarlarni tozalash/);
});

test("every destructive action records a cancellation reason in one management window", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const archiveSource = readFileSync(new URL("../app/archive-center.tsx", import.meta.url), "utf8");
  const controlSource = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");
  const taskStore = readFileSync(new URL("../app/lib/worker-tasks.ts", import.meta.url), "utf8");
  const taskRoute = readFileSync(new URL("../app/api/worker-tasks/route.ts", import.meta.url), "utf8");
  const branchStore = readFileSync(new URL("../app/lib/halo-store.ts", import.meta.url), "utf8");

  assert.match(pageSource, /Bekor qilinganlar/);
  assert.match(pageSource, /id: "archive" as Tab/);
  assert.match(pageSource, /label: "XODIMLAR VA HISOBOT", ids: \["control", "reports", "archive"\]/);
  assert.match(archiveSource, /SABAB · KIM · VAQT/);
  assert.match(archiveSource, /QAYERDAN BEKOR QILINGAN/);
  assert.match(archiveSource, /cancellationReason/);
  assert.match(archiveSource, /voidReason/);
  assert.match(archiveSource, /cancelReason/);
  assert.match(taskStore, /cancel_reason/);
  assert.match(taskRoute, /String\(body\.reason \|\| ""\)/);
  assert.match(branchStore, /archived_reason/);
  assert.match(archiveSource, /Xodim faoliyati/);
  assert.match(archiveSource, /Filial faoliyati/);
  assert.match(archiveSource, /faqat shu oynada saqlanadi/);
  assert.match(pageSource, /financeRangeEntries\.slice\(0, financeHistoryLimit\)/,
    "cancelled money rows must disappear from the normal finance history");
  assert.match(controlSource, /activePurchaseOrders\.map/,
    "cancelled purchase orders must disappear from the active control window");
  assert.match(controlSource, /activeAssignedTasks\.map/,
    "cancelled tasks must disappear from the active task window");
});

test("rapid repeated save clicks share one in-flight write", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /saveActionLocksRef\.current\.get\(lockKey\)/);
  assert.match(pageSource, /ikkinchi bosish qabul qilinmadi/);
  assert.match(workerSource, /persistLocksRef\.current\.get\(action\)/);
  assert.match(workerSource, /workerMutationLocksRef\.current\.has\("supplier-delivery"\)/);
  assert.match(workerSource, /workerMutationLocksRef\.current\.has\("worker-consumption"\)/);
});

test("manager can keep individual tasks and send one task to selected employees at once", () => {
  const taskStore = readFileSync(new URL("../app/lib/worker-tasks.ts", import.meta.url), "utf8");
  const taskRoute = readFileSync(new URL("../app/api/worker-tasks/route.ts", import.meta.url), "utf8");
  const controlSource = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");

  assert.match(taskStore, /export async function createWorkerTask\(/, "individual sending remains available");
  assert.match(taskStore, /export async function createWorkerTasks\(/, "bulk sending creates independent records");
  assert.match(taskStore, /d1\(\)\.batch\(/, "bulk task rows are written together");
  assert.match(taskRoute, /action === "create-bulk"/);
  assert.match(taskRoute, /telegramResults\.filter\(\(entry\) => entry\.sent\)/);
  assert.match(controlSource, /Bitta hodimga vazifa/);
  assert.match(controlSource, /Bir nechta yoki barcha hodimga/);
  assert.match(controlSource, /Barchasini tanlash/);
  assert.match(controlSource, /Har biri alohida bajaradi/);
});

const okposReceiptRows = [
  ["BUFFALO WINGS 4PCS", 6, "27, 440"],
  ["CHEESE HOTDOG", 6, "57, 000"],
  ["CHEESE MEDIUM", 3, "35, 700"],
  ["CHEESE SMALL", 2, "17, 820"],
  ["CHICKEN MEDIUM", 5, "61, 160"],
  ["CHICKEN SMALL", 3, "33, 320"],
  ["COLA", 5, "10, 000"],
  ["FRESH GRANAT", 5, "15, 000"],
  ["FRIED 800", 3, "55, 720"],
  ["FRIED BONE", 4, "75, 620"],
  ["FRIED CHICKEN 450", 17, "183, 260"],
  ["FRIES", 2, "5, 000"],
  ["HAGGI CHICKEN", 6, "61, 040"],
  ["HAGGI LAMB", 14, "157, 080"],
  ["HAGGI MIX", 2, "25, 800"],
  ["HALO LAVASH CHICKEN", 12, "136, 100"],
  ["HALO LAVASH LAMB", 20, "243, 400"],
  ["HALO LAVASH MIX", 10, "136, 800"],
  ["HOTDOG", 10, "81, 600"],
  ["KEBAB CHICKEN", 14, "109, 020"],
  ["KEBAB LAMB", 10, "81, 880"],
  ["KEBAB MIX", 3, "29, 700"],
  ["LAMB MEDIUM", 4, "59, 600"],
  ["MOJITO LIME", 40, "108, 600"],
  ["MOJITO POMEGRANATE", 5, "15, 000"],
  ["MOJITO STRAWBERRY", 10, "28, 800"],
  ["PEPERONI MEDIUM", 9, "105, 780"],
  ["PEPERONI SMALL", 1, "55, 000"],
  ["RIKS GRANAT", 3, "9, 000"],
  ["SET", 2, "7, 800"],
  ["SNOW 800", 2, "43, 800"],
  ["SPICY 450", 3, "36, 120"],
  ["TANDIR LAVASH CHICKEN", 23, "283, 800"],
  ["TANDIR LAVASH LAMB", 20, "275, 220"],
  ["TANDIR LAVASH MIX", 7, "101, 320"],
  ["WATER", 7, "6, 600"],
];

const exactOkposProductCrop = [
  "SBS 4",
  "BUFFALO WINGS 4PCS",
  "CHEESE HOTDOG",
  "CHEESE MEDIUM",
  "CHEESE SMALL",
  "CHICKEN MEDIUM",
  "CHICKEN SMALL",
  "COLA",
  "FRESH GRANAT",
  "FRIED 800",
  "FRIED BONE",
  "FRIED CHICKEN 450",
  "FRIES",
  "HAGG! CHICKEN",
  "HAGG| LAMB",
  "HAGG! MIX",
  "HALO LAVASH CHICKEN",
  "HALO LAVASH LAMB",
  "HALO LAVASH MIX",
  "HOTDOG",
  "KEBAB CHICKEN",
  "KEBAB LAMB",
  "KEBAB MIX",
  "LAMB MEDIUM",
  "MOJITO LIME",
  "MOJITO POMEGRANATE",
  "MOJITO STRAWBERRY",
  "PEPERON! MEDIUM",
  "PEPERON| SMALL",
  "RIKS GRANAT",
  "SET",
  "SNOW 800",
  "SPICY 450",
  "TANDIR LAVASH CHICKEN",
  "TANDIR LAVASH LAMB",
  "TANDIR LAVASH MIX",
  "WATER",
  "B Hi",
].join("\n");

const exactOkposNumericColumn = okposReceiptRows
  .map(([, quantity, total]) => `${quantity} ${total}`)
  .join("\n");

const ocrTsv = (lines) => [
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  ...lines.flatMap((line, lineIndex) => line.words.map((word, wordIndex) => [
    5,
    1,
    line.block ?? 1,
    line.paragraph ?? 1,
    line.line ?? lineIndex + 1,
    wordIndex + 1,
    word.left,
    line.top,
    word.width,
    line.height ?? 18,
    word.confidence ?? 95,
    word.text,
  ].join("\t"))),
].join("\n");

test("reads the supplied landscape OKPOS daily-product screenshot with exact codes and footer", () => {
  const reportRows = [
    ["000045", "TANDIR LAVASH LAMB", 5, 69_500],
    ["000032", "KEBAB LAMB", 6, 53_400],
    ["000038", "HALO LAVASH CHICKEN", 4, 47_600],
    ["000023", "FRIED CHICKEN 450", 4, 47_600],
    ["000039", "HALO LAVASH LAMB", 3, 38_700],
    ["000018", "HAGGI LAMB", 3, 35_700],
    ["000031", "KEBAB CHICKEN", 4, 31_600],
    ["000002", "HOTDOG", 3, 25_500],
    ["000003", "FRIED CHICKEN 800", 1, 19_900],
    ["000051", "LAMB PIZZA MEDIUM", 1, 14_900],
    ["000052", "MUSHROOM CHICKEN PIZZA MEDIUM", 1, 13_900],
    ["000050", "CHICKEN PIZZA MEDIUM", 1, 13_900],
    ["000029", "SPICY CHICKEN 450", 1, 12_900],
    ["000034", "HAGGI CHEESE", 1, 12_900],
    ["000049", "PEPERONI PIZZA MEDIUM", 1, 12_900],
    ["000048", "CHEESE PIZZA MEDIUM", 1, 11_900],
    ["000019", "HAGGI CHICKEN", 1, 10_900],
    ["000033", "KEBAB CHEESE", 1, 9_900],
    ["000041", "MOJITO STRAWBERRY", 3, 9_000],
    ["000011", "MOJITO LIME", 3, 9_000],
    ["000009", "COLA", 4, 8_000],
    ["000043", "FRESH GRANAT", 2, 6_000],
    ["000008", "BUFFALO WINGS 4PCS", 1, 4_900],
    ["000047", "MOJITO POMEGRANATE", 1, 3_000],
    ["000035", "WATER", 1, 1_000],
  ];
  const text = [
    "당일매출종합현황 (상품별 매출현황)",
    "조회일자 : 2026-08-22",
    "No. 상품코드 상품명 수량 실매출",
    ...reportRows.map(([code, product, quantity, total], index) => (
      `${index + 1} ${code} ${product} ${code === "000002" ? "홍" : quantity} ${total.toLocaleString("en-US")}`
    )),
    "합계 57 524,500",
  ].join("\n");
  const nameWords = (name) => {
    let left = 340;
    return name.split(" ").map((word) => {
      const current = { text: word, left, width: Math.max(28, word.length * 7) };
      left += current.width + 12;
      return current;
    });
  };
  const tsv = ocrTsv([
    {
      top: 90,
      words: [
        { text: "No.", left: 20, width: 28 },
        { text: "상품코드", left: 135, width: 70 },
        { text: "상품명", left: 340, width: 55 },
        { text: "수량", left: 760, width: 35 },
        { text: "실매출", left: 1_000, width: 65 },
      ],
    },
    ...reportRows.map(([code, product, quantity, total], index) => ({
      top: 125 + index * 28,
      words: [
        { text: String(index + 1), left: 24, width: 22 },
        { text: code, left: 135, width: 70 },
        ...nameWords(product),
        { text: code === "000002" ? "홍" : String(quantity), left: 760, width: 22 },
        { text: total.toLocaleString("en-US"), left: 1_000, width: 84 },
      ],
    })),
    {
      top: 125 + reportRows.length * 28,
      words: [
        { text: "합계", left: 18, width: 42 },
        { text: "57", left: 760, width: 28 },
        { text: "524,500", left: 1_000, width: 84 },
      ],
    },
  ]);
  const parsed = ocrOkposDailyProductTable(text, tsv, [], "2026-08-23", "okpos-daily.jpeg");
  const renamed = ocrOkposDailyProductTable(text, tsv, [], "2026-08-23", "renamed.jpeg");

  assert.ok(parsed);
  assert.ok(renamed);
  assert.equal(parsed.date, "2026-08-22");
  assert.equal(parsed.table.reportFormat, "okpos-daily-product");
  assert.equal(parsed.table.rows.length, 25);
  assert.deepEqual(
    parsed.table.rows.map((row) => row.values[photoPosMapping.productCode]),
    reportRows.map(([code]) => code),
    "all leading-zero OKPOS codes are preserved",
  );
  assert.equal(parsed.table.rows[3].values[photoPosMapping.product], "FRIED CHICKEN 450");
  assert.equal(parsed.table.rows[8].values[photoPosMapping.product], "FRIED CHICKEN 800");
  assert.equal(parsed.table.rows[22].values[photoPosMapping.product], "BUFFALO WINGS 4PCS");
  assert.equal(parsed.table.rows[7].values[photoPosMapping.quantity], 3,
    "one unread quantity is recovered only from the exact printed quantity and revenue footer");
  assert.equal(parsed.parsedQuantity, 57);
  assert.equal(parsed.parsedTotal, 524_500);
  assert.equal(parsed.receiptQuantity, 57);
  assert.equal(parsed.receiptTotal, 524_500);
  const imported = parsePosRows(parsed.table, photoPosMapping, "2026-08-23");
  const renamedImported = parsePosRows(renamed.table, photoPosMapping, "2026-08-23");
  assert.equal(imported.rows.length, 25, "the 합계 footer is never imported as a product");
  assert.equal(imported.summary?.matches, true);
  assert.deepEqual(
    renamedImported.rows.map((row) => row.externalId),
    imported.rows.map((row) => row.externalId),
    "renaming the same screenshot cannot bypass duplicate protection",
  );
  const columnEvidence = {
    codesText: reportRows.map(([code]) => code).join("\n\n"),
    rowsText: [
      ...reportRows.slice(0, -1).map(([code, product, quantity]) => `${code} ${product} ${quantity}`),
      "000035",
      "WATER",
    ].join("\n"),
    amountsText: [
      ...reportRows.map(([, , , total]) => total.toLocaleString("en-US")),
      "294 200",
    ].join("\n\n"),
    footerText: "57\n\n524,500",
  };
  const degraded = ocrOkposDailyProductTable(
    "ASU ; 2026-08-22\n57 524,500]",
    "",
    [],
    "2026-08-23",
    "degraded.jpeg",
    columnEvidence,
  );
  assert.ok(degraded, "verified column passes recover a report even when the full OCR misses its Korean header and rows");
  assert.equal(degraded.okposColumnsVerified, true);
  assert.equal(degraded.date, "2026-08-22", "the unique top report date remains stable when 조회일자 is garbled");
  assert.equal(degraded.table.rows.length, 25);
  assert.equal(degraded.table.rows.at(-1).values[photoPosMapping.product], "WATER");
  assert.equal(degraded.table.rows.at(-1).values[photoPosMapping.quantity], 1,
    "only one missing row quantity may be inferred from the independently read footer");
  assert.deepEqual(
    degraded.table.rows.map((row) => row.values[photoPosMapping.productCode]),
    reportRows.map(([code]) => code),
  );
  const sameLineFooter = ocrOkposDailyProductTable(
    "ASU ; 2026-08-22\n57 524,500]",
    "",
    [],
    "2026-08-23",
    "same-line-footer.jpeg",
    { ...columnEvidence, footerText: "57 524,500" },
  );
  assert.equal(sameLineFooter?.okposColumnsVerified, true,
    "the dedicated footer remains verifiable when OCR puts its quantity and total on one line");
  const wrongCode = ocrOkposDailyProductTable(
    text,
    tsv,
    [],
    "2026-08-23",
    "wrong-code.jpeg",
    { ...columnEvidence, codesText: columnEvidence.codesText.replace("000045", "000046") },
  );
  assert.ok(wrongCode);
  assert.equal(wrongCode.okposColumnsVerified, false,
    "a code absent from the independent row crop cannot be inferred from the footer");
  const offsettingAmounts = ocrOkposDailyProductTable(
    text,
    tsv,
    [],
    "2026-08-23",
    "offsetting-amounts.jpeg",
    {
      ...columnEvidence,
      amountsText: columnEvidence.amountsText
        .replace("69,500", "70,000")
        .replace("53,400", "52,900"),
    },
  );
  assert.ok(offsettingAmounts);
  assert.equal(offsettingAmounts.okposColumnsVerified, false,
    "two offsetting wrong row amounts cannot hide behind a correct aggregate footer");
  assert.equal(ocrOkposDailyProductTable(
    "ASU ; 2026-08-22\n57 524,501]",
    "",
    [],
    "2026-08-23",
    "bad-footer.jpeg",
    { ...columnEvidence, footerText: "57\n524,501" },
  ), null, "a one-won footer disagreement cannot approve the dedicated code rows");
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /prepareOkposTableColumnCrop\(tableImage, 0\.09, 0\.325, 0\.04, 0\.97, 3, 209\)/,
    "the product-code column is cropped and enlarged independently");
  assert.match(pageSource, /prepareOkposTableColumnCrop\(tableImage, 0\.69, 0\.765, 0\.04, 0\.97, 4, 209\)/,
    "the quantity column is cropped and enlarged independently");
  assert.match(pageSource, /ocrOkposCodeQuantityColumns\(/,
    "landscape POS images use the strict two-column parser");
  assert.doesNotMatch(pageSource, /worker\.recognize\(tableImage/,
    "the full landscape table is never sent to OCR");
  assert.doesNotMatch(pageSource, /tableRowsImage|tableAmountImage|tableFooterImage/,
    "product names, sales totals and footer crops are absent from the strict path");
  assert.match(pageSource, /setPosMapping\(photoPosCodeQuantityMapping\)/,
    "photo imports expose only product code and quantity to the sales importer");
  assert.doesNotMatch(pageSource, /activeOcrPass = "table-amount"/,
    "실매출 is not reread in a dedicated OCR pass");
  assert.doesNotMatch(pageSource, /activeOcrPass = "table-footer"/,
    "the sales footer is not required for code-and-quantity import");
});

test("reads the supplied OKPOS receipt rows and reconciles its printed total", () => {
  const text = [
    "매장매출내역",
    "출력입시 : 2026-08-11 02:38:54",
    "상품명 수량 금액",
    ...okposReceiptRows.map(([name, quantity, total]) => `${name} ${quantity} ${total}`),
    "LE 298 2,775, 800",
  ].join("\n");
  const result = ocrTextToPosTable(text, [], "2026-08-10", "okpos.jpeg", "298 2,775, 900");

  assert.equal(result.table.rows.length, 36);
  assert.equal(result.receiptQuantity, 298);
  assert.equal(result.receiptTotal, 2_775_900);
  assert.equal(result.parsedQuantity, 298);
  assert.equal(result.parsedTotal, 2_775_900);
  assert.equal(result.table.rows[0].values[photoPosMapping.product], "BUFFALO WINGS 4PCS");
  assert.equal(result.table.rows[0].values[photoPosMapping.quantity], 6);
  assert.equal(result.table.rows[0].values[photoPosMapping.total], 27_440);
  assert.equal(result.table.rows[0].values[photoPosMapping.date], "2026-08-10", "print time after midnight is not the business date");
});

test("reads all 36 product names from the exact OKPOS product crop despite SBS and B Hi noise", () => {
  assert.deepEqual(
    parseProductOcrLines(exactOkposProductCrop),
    okposReceiptRows.map(([name]) => name),
  );
});

test("groups Tesseract TSV words into ordered physical receipt lines", () => {
  const tsv = ocrTsv([
    {
      top: 80,
      words: [{ text: "5", left: 310, width: 12 }, { text: "10,000", left: 355, width: 70 }],
    },
    {
      top: 40,
      words: [
        { text: "LAVASH", left: 70, width: 50, confidence: 88 },
        { text: "HALO", left: 10, width: 40, confidence: 92 },
      ],
    },
  ]);
  const lines = parseOcrTsvLines(tsv);

  assert.deepEqual(lines.map((line) => line.text), ["HALO LAVASH", "5 10,000"]);
  assert.deepEqual(
    { left: lines[0].left, top: lines[0].top, width: lines[0].width, height: lines[0].height, centerY: lines[0].centerY },
    { left: 10, top: 40, width: 110, height: 18, centerY: 49 },
  );
  assert.equal(lines[0].confidence, 90);
});

test("uses TSV row coordinates instead of a scrambled product-text order", () => {
  const parsed = ocrTextToPosTable(
    "WATER 7 6,600\nCOLA 5 10,000\nLE 12 16,600",
    [],
    "2026-08-10",
    "coordinate-alignment.jpeg",
  );
  const numericText = "5 10,000\n7 6,600";
  const productTsv = ocrTsv([
    { top: 50, words: [{ text: "SBS", left: 10, width: 34 }, { text: "4", left: 50, width: 10 }] },
    { top: 100, words: [{ text: "COLA", left: 10, width: 45 }] },
    { top: 140, words: [{ text: "WATER", left: 10, width: 58 }] },
  ]);
  const numericTsv = ocrTsv([
    { top: 100, words: [{ text: "5", left: 310, width: 12 }, { text: "10,000", left: 355, width: 70 }] },
    { top: 140, words: [{ text: "7", left: 310, width: 12 }, { text: "6,600", left: 355, width: 60 }] },
    { top: 200, words: [{ text: "12", left: 310, width: 22 }, { text: "16,600", left: 355, width: 70 }] },
  ]);
  const rebuilt = rebuildOcrRowsFromProductColumn(
    parsed,
    "WATER\nCOLA",
    [numericText, numericText, numericText, numericText],
    { productTsv, numericTsvs: [numericTsv] },
  );

  assert.equal(rebuilt.rebuilt, true);
  assert.equal(rebuilt.coordinateAligned, true);
  assert.deepEqual(
    rebuilt.parsed.table.rows.map((row) => row.values[photoPosMapping.product]),
    ["COLA", "WATER"],
  );
  assert.deepEqual(summarizeOcrRows(rebuilt.parsed.table.rows), { quantity: 12, total: 16_600 });
});

test("rejects TSV coordinate alignment when one product is not on its numeric row", () => {
  const parsed = ocrTextToPosTable(
    "COLA 5 10,000\nWATER 7 6,600\nLE 12 16,600",
    [],
    "2026-08-10",
    "coordinate-mismatch.jpeg",
  );
  const numericText = "5 10,000\n7 6,600";
  const productTsv = ocrTsv([
    { top: 100, words: [{ text: "COLA", left: 10, width: 45 }] },
    { top: 190, words: [{ text: "WATER", left: 10, width: 58 }] },
  ]);
  const numericTsv = ocrTsv([
    { top: 100, words: [{ text: "5", left: 310, width: 12 }, { text: "10,000", left: 355, width: 70 }] },
    { top: 140, words: [{ text: "7", left: 310, width: 12 }, { text: "6,600", left: 355, width: 60 }] },
  ]);
  const rebuilt = rebuildOcrRowsFromProductColumn(
    parsed,
    "COLA\nWATER",
    [numericText, numericText, numericText, numericText],
    { productTsv, numericTsvs: [numericTsv] },
  );

  assert.equal(rebuilt.rebuilt, true);
  assert.equal(rebuilt.coordinateAligned, false);
  assert.match(rebuilt.message, /joylashuvi|balandligi/i);
});

test("rebuilds two consecutive rows missing from mixed OCR using product and numeric columns", () => {
  const mixedText = [
    ...okposReceiptRows
      .filter(([name]) => name !== "FRIED CHICKEN 450" && name !== "FRIES")
      .map(([name, quantity, total]) => `${name} ${quantity} ${total}`),
    "LE 298 2,775,900",
  ].join("\n");
  const mixed = ocrTextToPosTable(mixedText, [], "2026-08-10", "two-missing.jpeg");
  assert.equal(mixed.table.rows.length, 34);
  assert.deepEqual(summarizeOcrRows(mixed.table.rows), { quantity: 279, total: 2_587_640 });

  const rebuilt = rebuildOcrRowsFromProductColumn(
    mixed,
    exactOkposProductCrop,
    [exactOkposNumericColumn, exactOkposNumericColumn.replaceAll(", ", ",")],
  );

  assert.equal(rebuilt.rebuilt, true);
  assert.equal(rebuilt.parsed.table.rows.length, 36);
  assert.deepEqual(
    rebuilt.parsed.table.rows.map((row) => row.values[photoPosMapping.product]),
    okposReceiptRows.map(([name]) => name),
  );
  assert.deepEqual(summarizeOcrRows(rebuilt.parsed.table.rows), { quantity: 298, total: 2_775_900 });

  const reconciled = reconcileNumericOcrPasses(
    rebuilt.parsed,
    [
      exactOkposNumericColumn,
      exactOkposNumericColumn.replaceAll(", ", ","),
      exactOkposNumericColumn.replaceAll(" ", "  "),
      exactOkposNumericColumn,
      exactOkposNumericColumn.replaceAll(", ", ","),
    ],
  );
  assert.equal(reconciled.verified, true);
  assert.equal(reconciled.issues.length, 0);
});

test("keeps fewer than four numeric passes unverified", () => {
  const parsed = ocrTextToPosTable(
    "COLA 5 10,000\nWATER 7 6,600\nLE 12 16,600",
    [],
    "2026-08-10",
    "ambiguous-passes.jpeg",
  );
  const reconciled = reconcileNumericOcrPasses(parsed, [
    "5 10,000\n7 6,600",
    "5 9,000\n7 7,600",
  ]);

  assert.equal(reconciled.verified, false);
  assert.ok(reconciled.issues.length > 0);
});

test("verifies five unanimous numeric readings that exactly match the printed footer", () => {
  const parsed = ocrTextToPosTable(
    "COLA 5 9,000\nWATER 7 6,600\nLE 12 16,600",
    [],
    "2026-08-10",
    "unique-pass.jpeg",
  );
  const reconciled = reconcileNumericOcrPasses(parsed, [
    "5 10,000\n7 6,600",
    "5 10,000\n7 6,600",
    "5 10,000\n7 6,600",
    "5 10,000\n7 6,600",
    "5 10,000\n7 6,600",
  ]);

  assert.equal(reconciled.verified, true);
  assert.equal(reconciled.issues.length, 0);
  assert.equal(reconciled.parsed.table.rows[0].values[photoPosMapping.total], 10_000);
  assert.deepEqual(summarizeOcrRows(reconciled.parsed.table.rows), { quantity: 12, total: 16_600 });
});

test("uses five numeric passes when the printed footer leaves one unique row solution", () => {
  const parsed = ocrTextToPosTable(
    "COLA 5 9,000\nWATER 7 6,600\nLE 12 16,600",
    [],
    "2026-08-10",
    "unique-footer-solution.jpeg",
  );
  const wrong = "5 9,000\n7 6,600";
  const correct = "5 10,000\n7 6,600";
  const reconciled = reconcileNumericOcrPasses(parsed, [wrong, correct, correct, correct, wrong]);

  assert.equal(reconciled.verified, true);
  assert.equal(reconciled.issues.length, 0);
  assert.equal(reconciled.parsed.table.rows[0].values[photoPosMapping.total], 10_000);
  assert.deepEqual(summarizeOcrRows(reconciled.parsed.table.rows), { quantity: 12, total: 16_600 });
});

test("restores the two exact OKPOS rows accidentally removed during review", () => {
  const parsed = ocrTextToPosTable([
    ...okposReceiptRows.map(([name, quantity, total]) => `${name} ${quantity} ${total}`),
    "LE 298 2,775,900",
  ].join("\n"), [], "2026-08-10", "okpos-row-recovery.jpeg");
  const originalRows = parsed.table.rows;
  assert.deepEqual(summarizeOcrRows(originalRows), { quantity: 298, total: 2_775_900 });

  const friedChickenIndex = originalRows.findIndex((row) => row.values[photoPosMapping.product] === "FRIED CHICKEN 450");
  const friesIndex = originalRows.findIndex((row) => row.values[photoPosMapping.product] === "FRIES");
  assert.ok(friedChickenIndex >= 0);
  assert.ok(friesIndex > friedChickenIndex);
  const friedChicken = originalRows[friedChickenIndex];
  const fries = originalRows[friesIndex];

  assert.equal(deletionMovesAwayFromReceipt(originalRows, friedChicken.rowNumber, 298, 2_775_900), true);
  const withoutFriedChicken = originalRows.filter((row) => row.rowNumber !== friedChicken.rowNumber);
  assert.equal(deletionMovesAwayFromReceipt(withoutFriedChicken, fries.rowNumber, 298, 2_775_900), true);
  const remainingRows = withoutFriedChicken.filter((row) => row.rowNumber !== fries.rowNumber);
  assert.deepEqual(summarizeOcrRows(remainingRows), { quantity: 279, total: 2_587_640 });

  const removedRows = [
    { row: friedChicken, index: friedChickenIndex },
    { row: fries, index: friesIndex },
  ];
  const exactGap = removedRowsFillReceiptGap(remainingRows, removedRows, 298, 2_775_900);
  assert.deepEqual(exactGap.map((entry) => entry.row.values[photoPosMapping.product]), [
    "FRIED CHICKEN 450",
    "FRIES",
  ]);

  const restoredRows = [...remainingRows];
  exactGap.forEach((entry) => restoredRows.splice(entry.index, 0, entry.row));
  assert.equal(restoredRows.length, 36);
  assert.deepEqual(restoredRows.map((row) => row.rowNumber), originalRows.map((row) => row.rowNumber));
  assert.deepEqual(summarizeOcrRows(restoredRows), { quantity: 298, total: 2_775_900 });
});

test("corrects offsetting row errors with the dedicated OKPOS numeric-column pass", () => {
  const mixedRows = okposReceiptRows.map(([name, quantity, total]) => {
    if (name === "KEBAB CHICKEN") return [name, quantity, "108, 020"];
    if (name === "RIKS GRANAT") return [name, quantity, "8, 000"];
    if (name === "WATER") return [name, quantity, "8, 600"];
    return [name, quantity, total];
  });
  const mixed = ocrTextToPosTable([
    ...mixedRows.map(([name, quantity, total]) => `${name} ${quantity} ${total}`),
    "LE 298 2,775, 900",
  ].join("\n"), [], "2026-08-10", "balanced-errors.jpeg");
  assert.equal(mixed.parsedTotal, 2_775_900, "three wrong rows can still hide behind a matching footer");

  const numericText = okposReceiptRows.map(([, quantity, total]) => `${quantity} ${total}`).join("\n");
  const reconciled = reconcileNumericOcrPasses(mixed, [numericText, numericText, numericText, numericText, numericText]);
  assert.equal(reconciled.verified, true);
  assert.equal(reconciled.issues.length, 0);
  const valuesByProduct = new Map(reconciled.parsed.table.rows.map((row) => [
    row.values[photoPosMapping.product],
    row.values[photoPosMapping.total],
  ]));
  assert.equal(valuesByProduct.get("KEBAB CHICKEN"), 109_020);
  assert.equal(valuesByProduct.get("RIKS GRANAT"), 9_000);
  assert.equal(valuesByProduct.get("WATER"), 6_600);
});

test("verifies the sixth targeted pass against the correct row majority", () => {
  const parsed = ocrTextToPosTable([
    ...okposReceiptRows.map(([name, quantity, total]) => `${name} ${quantity} ${total}`),
    "LE 298 2,775,900",
  ].join("\n"), [], "2026-08-10", "sixth-targeted-confirmation.jpeg");
  const numericPass = (replacements = {}) => okposReceiptRows.map(([name, quantity, total]) => (
    `${quantity} ${replacements[name] ?? total}`
  )).join("\n");
  const p3CancellingWrong = numericPass({
    "KEBAB CHICKEN": "108,020",
    "RIKS GRANAT": "8,000",
    WATER: "8,600",
  });
  const p4TwoOtherErrors = numericPass({
    COLA: "9,000",
    FRIES: "6,000",
  });
  const correct = numericPass();
  const reconciled = reconcileNumericOcrPasses(parsed, [
    correct,
    correct,
    p3CancellingWrong,
    p4TwoOtherErrors,
    correct,
    correct,
  ]);

  assert.equal(reconciled.verified, true);
  assert.equal(reconciled.issues.length, 0);
  const valuesByProduct = new Map(reconciled.parsed.table.rows.map((row) => [
    row.values[photoPosMapping.product],
    row.values[photoPosMapping.total],
  ]));
  assert.equal(valuesByProduct.get("KEBAB CHICKEN"), 109_020);
  assert.equal(valuesByProduct.get("RIKS GRANAT"), 9_000);
  assert.equal(valuesByProduct.get("WATER"), 6_600);
  assert.equal(valuesByProduct.get("COLA"), 10_000);
  assert.equal(valuesByProduct.get("FRIES"), 5_000);
  assert.deepEqual(summarizeOcrRows(reconciled.parsed.table.rows), { quantity: 298, total: 2_775_900 });
  assert.equal(reconciled.parsed.parsedQuantity, 298);
  assert.equal(reconciled.parsed.parsedTotal, 2_775_900);
});

test("blocks numeric reconciliation when the right column is incomplete", () => {
  const parsed = ocrTextToPosTable("COLA 5 10,000\nWATER 7 6,600\nLE 12 16,600", [], "2026-08-10", "incomplete.jpeg");
  const reconciled = reconcileNumericOcrPasses(parsed, ["5 10,000", "5 10,000", "5 10,000", "5 10,000", "5 10,000"]);
  assert.equal(reconciled.verified, false);
  assert.equal(reconciled.issues[0].id, "numeric-row-count");
  assert.equal(reconciled.issues[0].blocking, true);
});

test("reads explicit numeric-column pairs and recovers one missing quantity from the footer", () => {
  const pairs = parseNumericOcrPairs("14 109,020\n105,780\n7 6,600");
  assert.deepEqual(pairs, [
    { quantity: 14, total: 109_020 },
    { quantity: null, total: 105_780 },
    { quantity: 7, total: 6_600 },
  ]);
  const parsed = ocrTextToPosTable("KEBAB CHICKEN 14 109,020\nPEPERONI MEDIUM 9 105,780\nWATER 7 6,600\nLE 30 221,400", [], "2026-08-10", "one-missing.jpeg");
  const numericText = "14 109,020\n105,780\n7 6,600";
  const reconciled = reconcileNumericOcrPasses(parsed, [numericText, numericText, numericText, numericText, numericText]);
  assert.equal(reconciled.verified, true);
  assert.equal(reconciled.parsed.table.rows[1].values[photoPosMapping.quantity], 9);
});

test("blocks two correlated numeric errors even when their wrong rows still match the footer", () => {
  const parsed = ocrTextToPosTable(
    "COLA 5 10,000\nWATER 7 6,600\nLE 12 16,600",
    [],
    "2026-08-10",
    "correlated-errors.jpeg",
  );
  const wrong = "5 9,000\n7 7,600";
  const correct = "5 10,000\n7 6,600";
  const reconciled = reconcileNumericOcrPasses(parsed, [wrong, wrong, correct, correct, correct]);

  assert.equal(reconciled.verified, false);
  assert.ok(reconciled.issues.some((issue) => issue.blocking));
});

test("keeps rebuild-to-reconcile ambiguity blocking even when the first pass populated the rows", () => {
  const parsed = ocrTextToPosTable(
    "COLA 5 10,000\nWATER 7 6,600\nLE 12 16,600",
    [],
    "2026-08-10",
    "rebuild-ambiguity.jpeg",
  );
  const wrong = "5 9,000\n7 7,600";
  const correct = "5 10,000\n7 6,600";
  const passes = [wrong, wrong, correct, correct, correct];
  const rebuilt = rebuildOcrRowsFromProductColumn(parsed, "COLA\nWATER", passes);
  const reconciled = reconcileNumericOcrPasses(rebuilt.parsed, passes);

  assert.equal(rebuilt.parsed.table.rows[0].values[photoPosMapping.total], 9_000);
  assert.equal(reconciled.verified, false);
  assert.ok(reconciled.issues.some((issue) => issue.id === "numeric-pass-disagreement" && issue.blocking));
});

test("keeps a structural warning when one numeric-pass disagreement is hidden by other row issues", () => {
  const parsed = ocrTextToPosTable(
    "COLA 5 9,000\nWATER 7 7,600\nFRIES 2 5,000\nLE 14 21,600",
    [],
    "2026-08-10",
    "hidden-pass-disagreement.jpeg",
  );
  const reconciled = reconcileNumericOcrPasses(parsed, [
    "5 10,000\n7 6,600\n2 5,000",
    "5 10,000\n7 7,600\n2 4,000",
    "5 10,000\n7 6,600\n2 5,000",
    "5 10,000\n7 6,600\n2 5,000",
    "5 10,000\n7 6,600\n2 5,000",
  ]);

  assert.equal(reconciled.verified, false);
  assert.ok(reconciled.issues.some((issue) => issue.id === "numeric-pass-disagreement"));
  assert.ok(reconciled.issues.some((issue) => issue.id === "numeric-pass-disagreement" && issue.blocking));
  assert.ok(reconciled.issues.some((issue) => issue.rowNumber != null));
});

test("never applies a partial OCR alternative with an unread quantity", () => {
  assert.equal(canApplyOcrAlternative({
    id: "row-1",
    rowNumber: 1,
    product: "PEPERONI MEDIUM",
    fields: ["quantity", "total"],
    alternate: { total: 105_780 },
    reason: "quantity missing",
  }), false);
  assert.equal(canApplyOcrAlternative({
    id: "row-1",
    rowNumber: 1,
    product: "PEPERONI MEDIUM",
    fields: ["quantity", "total"],
    alternate: { quantity: 9, total: 105_780 },
    reason: "both available",
  }), true);
});

test("cleans common OKPOS thermal-printer OCR substitutions", () => {
  const result = ocrTextToPosTable([
    "BUFFALO WINGS 4005 6 27, 440",
    "HAGG! CHICKEN 6 61, 040",
    "10951! LAMB 14 157, 080",
    "PEPERON| MEDIUM 9 105, 780",
    "SNOU 800 2 43, 800",
    "LE 37 395, 140",
  ].join("\n"), [], "2026-08-10", "ocr-errors.jpeg");

  assert.deepEqual(result.table.rows.map((row) => row.values[photoPosMapping.product]), [
    "BUFFALO WINGS 4PCS",
    "HAGGI CHICKEN",
    "HAGGI LAMB",
    "PEPERONI MEDIUM",
    "SNOW 800",
  ]);
});

test("rejoins a product, quantity, and amount split by sparse OCR", () => {
  const result = ocrTextToPosTable(
    "CLASSIC FRIED CHICKEN\n2\n39, 800\n합 계\n2 39, 800",
    [{ id: "fried", name: "CLASSIC FRIED CHICKEN", salePrice: 19_900 }],
    "2026-08-11",
    "split.jpeg",
  );
  assert.equal(result.table.rows.length, 1);
  assert.equal(result.table.rows[0].values[photoPosMapping.quantity], 2);
  assert.equal(result.table.rows[0].values[photoPosMapping.total], 39_800);
  assert.equal(result.receiptQuantity, 2);
  assert.equal(result.receiptTotal, 39_800);
});

test("uses a short OCR grand-total label without importing it as a product", () => {
  const result = ocrTextToPosTable(
    "COLA 5 10, 000\nBa 5 10, 000",
    [],
    "2026-08-11",
    "english-summary.jpeg",
  );
  assert.equal(result.table.rows.length, 1);
  assert.equal(result.table.rows[0].values[photoPosMapping.product], "COLA");
  assert.equal(result.parsedQuantity, 5);
  assert.equal(result.parsedTotal, 10_000);
  assert.equal(result.receiptQuantity, 5);
  assert.equal(result.receiptTotal, 10_000);
});

test("keeps even a small grand-total mismatch visible for manual review", () => {
  const result = ocrTextToPosTable(
    "COLA 5 10, 000\nLE 5 9, 900",
    [],
    "2026-08-11",
    "faint-total.jpeg",
  );
  assert.equal(result.receiptQuantity, 5);
  assert.equal(result.receiptTotal, 9_900);
  assert.equal(result.parsedTotal, 10_000);
});

test("handles OKPOS quantity artifacts and never imports the footer as a product", () => {
  const result = ocrTextToPosTable([
    "CHEESE SMALL Z 17, 820",
    "HALO LAVASH LAMB 20. =. 243, 400",
    "TANDIR LAVASH CHICKEN 23 ~—« 283, 800",
    "TANDIR LAVASH LAMB 20 = 275, 220",
    "PEPERON| MEDIUM ) 105, 780",
    "Bt Al 74 926, 020",
  ].join("\n"), [{ id: "pep", name: "PEPERONI MEDIUM", salePrice: 0 }], "2026-08-10", "artifacts.jpeg", "74 926, 020");

  assert.equal(result.table.rows.length, 5);
  assert.equal(result.parsedQuantity, 74);
  assert.equal(result.parsedTotal, 926_020);
  assert.equal(result.table.rows[4].values[photoPosMapping.product], "PEPERONI MEDIUM");
  assert.equal(result.table.rows[4].values[photoPosMapping.quantity], 9);
});

test("rejects amount-only header artifacts and accepts a curly quantity separator", () => {
  const result = ocrTextToPosTable([
    "@ AA UWS 3,422",
    "TANDIR LAVASH MIX 7 ‘101,320",
    "LE 7 101,320",
  ].join("\n"), [], "2026-08-10", "curly.jpeg");
  assert.equal(result.table.rows.length, 1);
  assert.equal(result.table.rows[0].values[photoPosMapping.product], "TANDIR LAVASH MIX");
  assert.equal(result.table.rows[0].values[photoPosMapping.quantity], 7);
  assert.equal(result.table.rows[0].values[photoPosMapping.total], 101_320);
});

test("safely sends Uzbek tannarx audit text in HTTP headers", () => {
  const action = "Taom tannarxi qo‘shildi · Chicken Kebab · tannarx ₩1,860 · ombor o‘zgarmadi";
  const encoded = encodeHaloHeader(action);
  assert.match(encoded, /^[\x20-\x7E]+$/);
  assert.equal(decodeHaloHeader(encoded, "fallback"), action);
});

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  assert.match(await response.text(), developmentPreviewMeta);
});

test("blocks private admin APIs without an authenticated owner", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("security-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const environment = {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
  const context = {
    waitUntil() {},
    passThroughOnException() {},
  };

  for (const path of ["/api/state", "/api/branches", "/api/backups", "/api/telegram", "/api/stock-documents", "/api/inventory-records", "/api/worker-state", "/api/worker-consumptions", "/api/attendance", "/api/worker-tasks", "/api/worker-tasks?admin=1", "/api/admin/integrations"]) {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { headers: { accept: "application/json" } }),
      environment,
      context,
    );
    assert.equal(response.status, 401, `${path} must require owner authentication`);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const deliveryResponse = await worker.fetch(
    new Request("http://localhost/api/worker-deliveries", { method: "POST" }),
    environment,
    context,
  );
  assert.equal(deliveryResponse.status, 401, "supplier delivery upload requires an employee session");
});

test("renders the separate xodim application and legacy worker link", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("worker-page-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  for (const path of ["/xodim", "/worker"]) {
    const response = await worker.fetch(
      new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
      {
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
      },
      {
        waitUntil() {},
        passThroughOnException() {},
      },
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  }
});

test("keeps one cash, bank and kitchen POS outside the employee profile", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("pos-terminal-page-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/pos-terminal", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const cashBankResponse = await worker.fetch(
    new Request("http://localhost/cash-bank-entry", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(cashBankResponse.status, 200);
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const cashBankPosSource = readFileSync(new URL("../app/cash-bank-entry/page.tsx", import.meta.url), "utf8");
  const publicHisobSource = readFileSync(new URL("../app/hisob/page.tsx", import.meta.url), "utf8");
  const publicHisobLayout = readFileSync(new URL("../app/hisob/layout.tsx", import.meta.url), "utf8");
  const publicHisobManifest = JSON.parse(readFileSync(new URL("../public/halo-hisob-manifest.webmanifest", import.meta.url), "utf8"));
  const posPageSource = readFileSync(new URL("../app/pos-terminal/page.tsx", import.meta.url), "utf8");
  const posApiSource = readFileSync(new URL("../app/api/pos-terminal/route.ts", import.meta.url), "utf8");
  const workerConsumptionApiSource = readFileSync(new URL("../app/api/worker-consumptions/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(workerSource, /href="\/(?:pos-terminal|cash-bank-entry|inventory-outflow)"/);
  assert.doesNotMatch(posPageSource, /Coupang uslubidagi navbat|actionLabel="Tayyorlash"/);
  assert.doesNotMatch(posPageSource, />Buyurtma kiriting<|>Joriy buyurtma<|Buyurtmani saqlash/);
  assert.match(posPageSource, /Naqd va hisob-raqam savdosi/);
  assert.match(posPageSource, /Oshxonada yeyilgan ovqatlar/);
  assert.match(workerSource, /\/api\/worker-consumptions/);
  assert.match(cashBankPosSource, /salePaymentOptions=\{\["cash", "bank"\]\}/);
  assert.match(cashBankPosSource, /inventoryReasons=\{\["Oshxonada yeyilgan ovqat"\]\}/);
  assert.match(posPageSource, /entry\.isKitchenConsumption === true/, "server-classified kitchen rows stay visible even after a label change");
  assert.match(posPageSource, /inventoryReasons\.length > 1 && <label>/, "a single kitchen reason is automatic and does not show a selector");
  assert.doesNotMatch(posPageSource, /Kim yedi|Kim yegani/, "the public kitchen entry does not ask or display who ate");
  assert.match(cashBankPosSource, /OSHXONADA YEYILGAN OVQAT/);
  assert.match(publicHisobSource, /CashBankEntryPage/);
  assert.doesNotMatch(publicHisobSource, /authenticate|PIN|password|adminAccess/);
  assert.match(publicHisobLayout, /HALO HISOB — Naqd, hisob-raqam va delivery savdosi/);
  assert.equal(publicHisobManifest.id, "/hisob");
  assert.equal(publicHisobManifest.start_url, "/hisob");
  assert.doesNotMatch(posPageSource, /POS terminalga kiring|Xodim profili|action: "login"/);
  assert.match(posPageSource, /HIMOYALANGAN/);
  assert.match(posApiSource, /authenticateWorkerRequest/);
  assert.match(posApiSource, /POS_ACTOR/);
  assert.match(posApiSource, /activeBranch/);
  assert.match(posApiSource, /authorizePosRequest/);
  assert.match(posApiSource, /isAdminRequest/);
  assert.doesNotMatch(posPageSource, /halo_pos_access/);
  assert.match(posPageSource, /HIMOYALANGAN/);
  assert.match(posPageSource, /Sotilgan\/yeyilgan vaqt/);
  assert.match(posPageSource, /entryDate/);
  assert.match(posPageSource, /TAHRIRLASH/);
  assert.match(posPageSource, /O‘CHIRISH/);
  assert.match(posPageSource, /method: editingRecord \? "PUT" : "POST"/);
  assert.match(posPageSource, /method: "DELETE"/);
  assert.match(posApiSource, /export async function PUT/);
  assert.match(posApiSource, /export async function DELETE/);
  assert.match(workerSource, /Yeyilgan\/chiqqan vaqt/);
  assert.match(workerSource, /O‘ZGARISHNI SAQLASH VA QAYTA HISOBLASH/);
  assert.match(workerConsumptionApiSource, /export async function PUT/);
  assert.match(workerConsumptionApiSource, /export async function DELETE/);
});

test("owner has a separate cash and bank sales window with accountant-managed totals", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const posPageSource = readFileSync(new URL("../app/pos-terminal/page.tsx", import.meta.url), "utf8");
  const reportSource = readFileSync(new URL("../app/lib/daily-report.ts", import.meta.url), "utf8");
  assert.match(pageSource, /tab === "cashbank"/);
  assert.match(pageSource, /Naqd va hisob-raqam savdolari tarixi/);
  assert.match(pageSource, /cashBankSaleOrderMeta/);
  assert.match(pageSource, /displayRecordTime\(orderMeta\.createdAt\)/);
  assert.match(pageSource, /displayRecordTime\(entry\.createdAt\)/);
  assert.match(pageSource, /href="\/hisob"/);
  assert.match(pageSource, /label: "POS savdo"/);
  assert.doesNotMatch(pageSource, /label: "Savdo va POS"/);
  assert.match(pageSource, /id: "cashsales" as Tab, icon: "−", label: "Yeyilgan \/ chiqimlar"/);
  assert.match(pageSource, /\["inventory_only", "meal", "product", "waste"\]\.includes/, "new and legacy kitchen/product outflows are all visible to the owner");
  assert.match(pageSource, /Eng ko‘p yeyilgan taomlar/);
  assert.match(pageSource, /Ombordan ayrilgan mahsulotlar/);
  assert.match(pageSource, /Kunlar bo‘yicha yeyilgan va chiqqanlar/);
  assert.match(pageSource, /Barcha yeyilgan va chiqib ketganlar tarixi/);
  assert.match(pageSource, /account\.type === "card"/);
  assert.match(pageSource, /account\.type === "delivery"/);
  assert.match(pageSource, /tab === "deliverysales"/);
  assert.match(pageSource, /const unavailableBatchSale = batchSales\.find/,
    "editing a delivery order cannot silently drop an archived menu item");
  assert.match(pageSource, /posRangeSales\.length/);
  assert.match(posPageSource, /Soliq avtomatik (?:hisoblanmadi|ajratilmaydi)/);
  assert.match(reportSource, /else accountantManagedSales \+= saleRevenue/);
  assert.match(reportSource, /taxExact \+= saleRevenue \* taxPercent \/ 100/);
});

test("control and xodim bootstrap private data with one initial request", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const branchesRoute = readFileSync(new URL("../app/api/branches/route.ts", import.meta.url), "utf8");
  const workerAuthRoute = readFileSync(new URL("../app/api/worker-auth/route.ts", import.meta.url), "utf8");
  const workerTasks = readFileSync(new URL("../app/lib/worker-tasks.ts", import.meta.url), "utf8");
  const workerAuth = readFileSync(new URL("../app/lib/worker-auth.ts", import.meta.url), "utf8");
  const haloStore = readFileSync(new URL("../app/lib/halo-store.ts", import.meta.url), "utf8");
  const integrationStore = readFileSync(new URL("../app/lib/integration-store.ts", import.meta.url), "utf8");
  const telegramRoute = (readFileSync(new URL("../app/api/telegram/route.ts", import.meta.url), "utf8") + readFileSync(new URL("../app/lib/telegram-service.ts", import.meta.url), "utf8"));

  assert.match(pageSource, /\/api\/branches\?bootstrap=1&branch=/);
  assert.match(workerSource, /\/api\/worker-auth\?bootstrap=1/);
  assert.match(branchesRoute, /state: \{ \.\.\.current\.state, updatedAt: current\.updatedAt \}/);
  assert.match(workerAuthRoute, /buildWorkerStateView/);
  assert.doesNotMatch(workerSource, /const response = await fetch\("\/api\/worker-state", \{ cache: "no-store" \}\);\n      const value = await response\.json\(\)/);
  assert.match(pageSource, /if \(adminAccess !== "authorized"\) return;\n    fetch\(`\/api\/telegram/);
  assert.match(workerTasks, /workerTaskTablesReady/);
  assert.match(telegramRoute, /telegramTablesReady/);
  assert.doesNotMatch(
    [workerTasks, workerAuth, haloStore, integrationStore, telegramRoute].join("\n"),
    /Ready\s*:\s*Promise<void>/,
    "request-scoped runtime promises must never be cached across Cloudflare requests",
  );
  assert.match(workerSource, /new AbortController\(\)/);
  assert.match(workerSource, /controller\.abort\(\), 8_000/);
  assert.match(workerSource, /controller\.abort\(\), 12_000/);
  assert.match(workerSource, /if \(loginInFlightRef\.current\) return;/,
    "repeated Enter presses must not create duplicate PIN attempts");
  assert.match(workerSource, /loginResponse\.json\(\)\.catch\(\(\) => \(\{\}\)\)/,
    "an HTML or empty platform error response must remain retryable");
  assert.match(workerAuthRoute, /Promise\.all\(\[ensureHaloState\(\), ensureWorkerAccess\(\)\]\)/,
    "cold worker bootstrap initializes each schema before parallel reads");
  assert.match(workerSource, /setAuthReady\(true\);\n      setStatus\(t\("status\.loading"\)\)/,
    "the login form is shown while a slow session bootstrap continues");
  assert.match(workerAuthRoute, /status: 503/);
  assert.match(workerAuthRoute, /retryable: true/);
  assert.match(pageSource, /controller\.abort\(\), 8_000/);
  assert.match(workerAuth, /JOIN halo_branches b ON b\.id = u\.branch_id AND b\.active = 1/,
    "an archived branch must not authenticate or receive bootstrap state");
});

test("owner UI exposes separate expenses and one-click daily sales", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const stateRoute = readFileSync(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const workerStateRoute = readFileSync(new URL("../app/api/worker-state/route.ts", import.meta.url), "utf8");
  const supplierRoute = readFileSync(new URL("../app/api/supplier-records/route.ts", import.meta.url), "utf8");
  assert.match(pageSource, /tab === "expenses"/);
  assert.match(pageSource, /Har oy avtomatik hisoblash/);
  assert.match(pageSource, /Hammasini bitta bosishda saqlash/);
  assert.match(pageSource, /prepareBatchSales/);
  assert.match(supplierRoute, /delivery-purchase:\$\{typedDelivery\.id\}/);
  assert.match(supplierRoute, /stock: Number\(item\.stock \|\| 0\) \+ line\.quantity/);
  assert.match(supplierRoute, /rebalanceSuppliers\(suppliers, null, transaction\)/);
  assert.match(pageSource, /action: "approveDelivery", deliveryId: delivery\.id/);
  assert.match(pageSource, /Omborga va qarzga qo‘shish/);
  assert.match(pageSource, /supplierSourceDocument\(data, transaction\)/,
    "delivery-linked supplier transactions are protected from independent edits and deletes");
  assert.match(pageSource, /Xodim kirimiga bog‘langan/,
    "delivery-linked rows are visibly marked as protected");
  assert.match(pageSource, /isWorkerDeliveryMovement\(movement\)/,
    "delivery-linked stock movements are protected from independent edits and deletes");
  assert.match(pageSource, /current\.automatic !== true && updated\.active && updated\.nextDue <= accountingToday/,
    "enabling an overdue automatic expense skips inactive historical cycles");
  assert.match(pageSource, /entry\.affectsProfit !== false && !costRuleCoversCategory\(entry\.category, data\.costRules\)/,
    "the expense summary must use the same percentage-rule dedupe as the daily report");
  assert.match(workerStateRoute, /calculateRecipeCostBreakdown/,
    "worker POS costs are rebuilt from trusted server recipes");
  assert.match(workerStateRoute, /recipes: current\.recipes/,
    "a projected employee recipe cannot overwrite manager cost data");
  assert.match(stateRoute, /const current = await readHaloStateWithRecurringExpenses\(branchId\)/,
    "GET reconciles recurring expenses");
  assert.match(stateRoute, /compare-and-swap write[\s\S]*const current = await readHaloState\(branchId\)/,
    "PUT must not create a surprise revision before its conflict check");
});

test("employee POS stock validation accepts an exact sale while another item is already negative", () => {
  const inventory = [
    { id: "baget", name: "BAGET NON", unit: "dona", stock: -18, minStock: 0 },
    { id: "meat", name: "Go‘sht", unit: "g", stock: 10, minStock: 0 },
  ];
  const movement = {
    id: "movement-1",
    type: "sale",
    inventoryId: "meat",
    referenceId: "sale-1",
    quantity: -2,
  };
  const nextInventory = inventory.map((item) => item.id === "meat" ? { ...item, stock: 8 } : item);

  assert.equal(finiteWorkerStock(-18), true, "a finite legacy negative is a valid starting balance");
  assert.equal(exactNegativeMovementTotals(new Map([["meat", -2]]), new Map([["meat", -2]])), true,
    "the server must compare two negative recipe movements by subtraction, not addition");
  assert.equal(exactNegativeMovementTotals(new Map([["meat", -3]]), new Map([["meat", -2]])), false,
    "a movement larger than the trusted recipe requirement is rejected");
  const expectedLiveIngredients = expectedWorkerRecipeMovementTotals([
    { inventoryId: "meat", quantity: 2 },
    { inventoryId: "deleted-sauce", quantity: 3 },
  ], 1, new Set(inventory.map((item) => item.id)));
  assert.deepEqual([...expectedLiveIngredients], [["meat", -2]],
    "an archived legacy ingredient must not block deductions for ingredients that still exist");
  assert.equal(exactWorkerStockDeltas(inventory, nextInventory, [movement]), true,
    "the unrelated BAGET NON −18 balance must not block a valid HALO Lavash sale");
  assert.equal(exactWorkerStockDeltas(
    inventory,
    inventory.map((item) => item.id === "meat" ? { ...item, stock: 7 } : item),
    [movement],
  ), false, "stock tampering that exceeds the validated recipe movement is still rejected");
});

test("xodim bootstrap state keeps manager-only sections empty", () => {
  const view = buildWorkerStateView({
    productCategories: [],
    inventory: [{ id: "stock-1", name: "Sosiska", unitCost: 650, packageCost: 6_500 }],
    recipes: [{ id: "recipe-1", name: "Hotdog", salePrice: 5_000, extraCosts: [{ amount: 100 }], ingredients: [{ inventoryId: "stock-1", quantity: 2, lineCost: 1_300, unitCost: 650 }] }],
    suppliers: [{ id: "supplier-1", name: "Yetkazuvchi", bankAccount: "private" }],
    supplierDeliveries: [
      { id: "own", createdByWorkerId: "worker-1" },
      { id: "other", createdByWorkerId: "worker-2" },
    ],
    sales: [{ id: "sale-1", source: "pos", externalId: "receipt-1", totalRevenue: 500_000 }],
    accounts: [{ id: "cash", name: "Naqd", type: "cash", openingBalance: 9_000_000 }],
    staff: [{ id: "staff-1", monthlySalary: 3_200_000 }],
    payrollPayments: [{ id: "pay-1", amount: 3_200_000 }],
    financialEntries: [{ id: "profit", amount: 5_000_000 }],
    fixedExpenses: [{ id: "rent", amount: 900_000 }],
  }, "worker-1", "rev-1");

  assert.deepEqual(view.supplierDeliveries.map((entry) => entry.id), ["own"]);
  assert.deepEqual(view.staff, []);
  assert.deepEqual(view.payrollPayments, []);
  assert.deepEqual(view.financialEntries, []);
  assert.deepEqual(view.fixedExpenses, []);
  assert.equal(view.accounts[0].openingBalance, 0);
  assert.equal(JSON.stringify(view).includes("3200000"), false);
  assert.equal(JSON.stringify(view).includes("private"), false);
  assert.equal(JSON.stringify(view).includes("unitCost"), false);
  assert.equal(JSON.stringify(view).includes("lineCost"), false);
  assert.equal(JSON.stringify(view).includes("salePrice"), false);
  assert.equal(JSON.stringify(view).includes("extraCosts"), false);
});

test("normalizes product categories, removes duplicate names, and preserves both fallbacks", () => {
  const source = [
    { id: "recipe-special", kind: "recipe", name: "  Special taom  ", sortOrder: 30 },
    { id: "recipe-duplicate", kind: "recipe", name: "special TAOM", sortOrder: 10 },
    { id: "inventory-flour", kind: "inventory", name: "  Un  ", sortOrder: 5 },
    DEFAULT_PRODUCT_CATEGORIES.find((category) => category.id === RECIPE_FALLBACK_CATEGORY_ID),
    DEFAULT_PRODUCT_CATEGORIES.find((category) => category.id === INVENTORY_FALLBACK_CATEGORY_ID),
  ];
  const normalized = normalizeProductCategories(source);

  assert.equal(normalized.filter((category) => category.name.toLocaleLowerCase("uz") === "special taom").length, 1);
  assert.ok(normalized.some((category) => category.id === RECIPE_FALLBACK_CATEGORY_ID));
  assert.ok(normalized.some((category) => category.id === INVENTORY_FALLBACK_CATEGORY_ID));
  assert.deepEqual(
    categoriesForKind(normalized, "inventory").map((category) => category.id),
    ["inventory-flour", INVENTORY_FALLBACK_CATEGORY_ID],
  );
  assert.equal(validProductCategories(source), false, "duplicate category names must not pass server validation");
  assert.equal(validProductCategories(DEFAULT_PRODUCT_CATEGORIES), true);
});

test("keeps category IDs kind-safe and falls back when a category was deleted", () => {
  const categories = normalizeProductCategories([
    ...DEFAULT_PRODUCT_CATEGORIES,
    { id: "recipe-seasonal", kind: "recipe", name: "Kun aksiyasi", sortOrder: 45 },
  ]);

  assert.equal(validCategoryId(categories, "recipe", "recipe-seasonal"), "recipe-seasonal");
  assert.equal(validCategoryId(categories, "inventory", "recipe-seasonal"), INVENTORY_FALLBACK_CATEGORY_ID);
  assert.equal(validCategoryId(categories, "recipe", "deleted-category"), RECIPE_FALLBACK_CATEGORY_ID);
});

test("rejects malformed category arrays even when normalization could replace their rows", () => {
  const wrongFallbackKind = DEFAULT_PRODUCT_CATEGORIES.map((category) => (
    category.id === RECIPE_FALLBACK_CATEGORY_ID
      ? { ...category, kind: "inventory" }
      : category
  ));
  const sameLengthWithInvalidRows = DEFAULT_PRODUCT_CATEGORIES.map((category, index) => (
    index === 0
      ? { ...category, id: "INVALID ID" }
      : index === 1
        ? { ...category, name: "  noto‘g‘ri bo‘shliq  " }
        : category
  ));

  assert.equal(validProductCategories(wrongFallbackKind), false);
  assert.equal(validProductCategories(sameLengthWithInvalidRows), false);
});

test("infers legacy HALO products into their named default categories", () => {
  assert.deepEqual([
    "HALO LAVASH CHICKEN",
    "CHEESE HOTDOG",
    "FRIED CHICKEN 450",
    "COLA",
    "FRIES",
    "Noma’lum taom",
  ].map((name) => inferLegacyCategoryId("recipe", name)), [
    "recipe-kebab",
    "recipe-pizza",
    "recipe-chicken",
    "recipe-drinks",
    "recipe-set",
    RECIPE_FALLBACK_CATEGORY_ID,
  ]);
  assert.deepEqual([
    "Mozzarella cheese",
    "Chicken breast",
    "Mayonez sous",
    "Noma’lum xomashyo",
  ].map((name) => inferLegacyCategoryId("inventory", name)), [
    "inventory-dairy",
    "inventory-meat",
    "inventory-sauce",
    INVENTORY_FALLBACK_CATEGORY_ID,
  ]);
});

test("calculates a recipe from live inventory unit costs", () => {
  const ingredients = [
    { inventoryId: "cabbage", quantity: 2 },
    { inventoryId: "meat", quantity: 15 },
    { inventoryId: "sauce", quantity: 4 },
  ];
  const inventory = [
    { id: "cabbage", unitCost: 80 },
    { id: "meat", unitCost: 120 },
    { id: "sauce", unitCost: 30 },
  ];
  assert.equal(calculateRecipeCost(ingredients, inventory), 2_080);
  assert.equal(calculateRecipeCost(ingredients, inventory.map((item) => (
    item.id === "meat" ? { ...item, unitCost: 150 } : item
  ))), 2_530);
});

test("converts a supplier package into recipe units without mixing package and piece costs", () => {
  const packaged = calculatePackagedInventory(1, 10, 6_500);
  assert.deepEqual(packaged, { stock: 10, unitCost: 650 });
  assert.equal(calculateRecipeCost(
    [{ inventoryId: "sausage", quantity: 2 }],
    [{ id: "sausage", unitCost: packaged.unitCost }],
  ), 1_300);

  assert.deepEqual(normalizeInventoryPackaging({ unitCost: 650 }), {
    packageName: "birlik",
    unitsPerPackage: 1,
    packageCost: 650,
    gramsPerUnit: 0,
    unitCost: 650,
  });
  assert.equal(validInventoryPackaging([{
    packageName: "pachka",
    unitsPerPackage: 10,
    packageCost: 6_500,
    unitCost: 650,
  }]), true);
  assert.equal(validInventoryPackaging([{
    packageName: "pachka",
    unitsPerPackage: 10,
    packageCost: 6_500,
    gramsPerUnit: 50,
    unitCost: 650,
  }]), true, "per-piece weight can be saved when known");
  assert.equal(validInventoryPackaging([{
    packageName: "pachka",
    unitsPerPackage: 10,
    packageCost: 6_500,
    unitCost: 650,
  }]), true, "per-piece weight stays optional");
  assert.equal(validInventoryPackaging([{
    packageName: "pachka",
    unitsPerPackage: 10,
    packageCost: 6_500,
    gramsPerUnit: -1,
    unitCost: 650,
  }]), false, "negative weights are rejected");
  assert.equal(validInventoryPackaging([{
    packageName: "pachka",
    unitsPerPackage: 10,
    packageCost: 6_500,
    unitCost: 6_500,
  }]), false, "package price cannot be saved as the per-piece cost");

  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /<option value="BOX">BOX<\/option>/);
  assert.match(pageSource, /<option value="QADOQ">QADOQ<\/option>/);
  assert.match(pageSource, /<option value="DONA">DONA<\/option>/);
  assert.match(pageSource, /1 dona mahsulot vazni/);
  assert.match(pageSource, /gramsPerUnit\.toLocaleString\(\)} g/);
});

test("normalizes duplicate ingredients and drops invalid rows", () => {
  const inventory = [{ id: "meat", unitCost: 120 }];
  const normalized = normalizeRecipeIngredients([
    { inventoryId: "meat", quantity: 100 },
    { inventoryId: "meat", quantity: 20 },
    { inventoryId: "unknown", quantity: 7 },
    { inventoryId: "meat", quantity: 0 },
    { inventoryId: "meat", quantity: Number.NaN },
  ], inventory);
  assert.deepEqual(normalized, [{ inventoryId: "meat", quantity: 120 }]);
  assert.equal(calculateRecipeCost(normalized, inventory), 14_400);
});

test("ignores unsafe quantities, costs, and arithmetic overflow", () => {
  assert.equal(calculateRecipeCost([
    { inventoryId: "okay", quantity: 2 },
    { inventoryId: "infinite", quantity: 1 },
    { inventoryId: "negative", quantity: 5 },
    { inventoryId: "overflow", quantity: 2 },
  ], [
    { id: "okay", unitCost: 25 },
    { id: "infinite", unitCost: Number.POSITIVE_INFINITY },
    { id: "negative", unitCost: -5 },
    { id: "overflow", unitCost: 1e308 },
  ]), 50);
});

test("supports fractional ingredient quantities", () => {
  assert.equal(calculateRecipeCost(
    [{ inventoryId: "meat", quantity: 0.12 }],
    [{ id: "meat", unitCost: 12_000 }],
  ), 1_440);
});

test("links an existing gram recipe ingredient to kilogram inventory", () => {
  assert.equal(convertRecipeQuantity(250, "g", "kg"), 0.25);
  assert.equal(convertRecipeQuantity(1.5, "kg", "g"), 1_500);

  const linked = linkRecipeIngredientsToInventory([{
    id: "chicken-line",
    inventoryId: "",
    name: "Tovuq lahim son",
    unit: "g",
    quantity: 250,
    lineCost: 2_500,
  }], [{
    id: "chicken-stock",
    name: "Tovuq lahim son",
    unit: "kg",
    unitCost: 10_000,
    gramsPerUnit: 0,
  }]);

  assert.equal(linked[0].inventoryId, "chicken-stock");
  assert.equal(linked[0].unit, "kg");
  assert.equal(linked[0].quantity, 0.25);
  assert.equal(linked[0].lineCost, 2_500);
  assert.equal(linked[0].unitCost, 10_000);
});

test("links a legacy flour recipe without carrying invalid saved cost fields", () => {
  const currentRecipes = [{
    id: "flour-recipe",
    ingredients: [{
      id: "flour-line",
      inventoryId: "",
      name: "Un",
      unit: "g",
      quantity: 100,
      lineCost: "",
      unitCost: null,
    }],
    extraCosts: [],
  }];
  const linkedIngredients = linkRecipeIngredientsToInventory(currentRecipes[0].ingredients, [{
    id: "flour-stock",
    name: "Un",
    unit: "kg",
    unitCost: 2_000,
  }]);

  assert.equal(linkedIngredients[0].inventoryId, "flour-stock");
  assert.equal(linkedIngredients[0].quantity, 0.1);
  assert.equal(Object.hasOwn(linkedIngredients[0], "lineCost"), false);
  assert.equal(Object.hasOwn(linkedIngredients[0], "unitCost"), false);
  assert.equal(validRecipeCosts([{
    ...currentRecipes[0],
    ingredients: linkedIngredients,
  }], currentRecipes), true);
});

test("does not guess an inventory link when units are incompatible", () => {
  const ingredient = { inventoryId: "", name: "Sous", unit: "g", quantity: 20, lineCost: 100 };
  const linked = linkRecipeIngredientsToInventory([ingredient], [{
    id: "sauce-bottle",
    name: "Sous",
    unit: "ml",
    unitCost: 5,
  }]);
  assert.deepEqual(linked, [ingredient]);
});

test("persists a product cost snapshot through normalization and reload", () => {
  const storedIngredients = normalizeRecipeIngredients([
    { inventoryId: "meat", quantity: 0.12, unitCost: 12_000 },
    { inventoryId: "cabbage", quantity: 0.04, unitCost: 3_000 },
  ], [
    { id: "meat", unitCost: 0 },
    { id: "cabbage", unitCost: 0 },
  ]);
  const reloaded = JSON.parse(JSON.stringify(storedIngredients));

  assert.deepEqual(reloaded, [
    { inventoryId: "meat", quantity: 0.12, unitCost: 12_000 },
    { inventoryId: "cabbage", quantity: 0.04, unitCost: 3_000 },
  ]);
  assert.equal(calculateRecipeCost(reloaded, [
    { id: "meat", unitCost: 0 },
    { id: "cabbage", unitCost: 0 },
  ]), 1_560);
  assert.equal(calculateRecipeCost(reloaded, [
    { id: "meat", unitCost: 99_000 },
    { id: "cabbage", unitCost: 99_000 },
  ]), 1_560, "saved product cost must not silently change after reload");
});

test("keeps legacy recipes compatible with live inventory cost", () => {
  assert.equal(calculateRecipeCost(
    [{ inventoryId: "meat", quantity: 0.12 }],
    [{ id: "meat", unitCost: 12_000 }],
  ), 1_440);
});

test("normalizes and calculates a manual recipe ingredient without inventory", () => {
  const normalized = normalizeRecipeIngredients([{
    id: "ingredient-meat",
    name: "Go‘sht",
    unit: "g",
    quantity: 120,
    lineCost: 1_440,
  }], []);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, "ingredient-meat");
  assert.equal(normalized[0].inventoryId, "");
  assert.equal(normalized[0].name, "Go‘sht");
  assert.equal(normalized[0].unit, "g");
  assert.equal(normalized[0].quantity, 120);
  assert.equal(normalized[0].lineCost, 1_440);
  assert.equal(calculateRecipeCost(normalized, []), 1_440);
});

test("keeps a line-cost recipe independent from inventory price changes", () => {
  const ingredient = {
    inventoryId: "meat",
    name: "Go‘sht",
    unit: "g",
    quantity: 120,
    lineCost: 1_440,
  };

  assert.equal(calculateRecipeCost([ingredient], [{ id: "meat", unitCost: 12 }]), 1_440);
  assert.equal(calculateRecipeCost([ingredient], [{ id: "meat", unitCost: 99 }]), 1_440);
});

test("validates a complete manual recipe row and rejects a blank-name row", () => {
  const manualRecipe = {
    id: "manual-recipe",
    ingredients: [{
      name: "Karam",
      unit: "g",
      quantity: 40,
      lineCost: 120,
    }],
    extraCosts: [],
  };

  assert.equal(validRecipeCosts([manualRecipe], []), true);
  assert.equal(validRecipeCosts([{
    ...manualRecipe,
    ingredients: [{
      name: "   ",
      unit: "g",
      quantity: 40,
      lineCost: 120,
    }],
  }], []), false);
});

test("adds per-product expenses to one complete product cost", () => {
  const ingredients = [
    { inventoryId: "meat", quantity: 0.12 },
    { inventoryId: "cabbage", quantity: 0.04 },
    { inventoryId: "sauce", quantity: 0.03 },
  ];
  const inventory = [
    { id: "meat", unitCost: 12_000 },
    { id: "cabbage", unitCost: 3_000 },
    { id: "sauce", unitCost: 5_000 },
  ];
  const extraCosts = [
    { amount: 200 },
    { amount: 350 },
  ];
  assert.equal(calculateRecipeExtraCost(extraCosts), 550);
  assert.deepEqual(calculateRecipeCostBreakdown(ingredients, inventory, extraCosts), {
    ingredientCost: 1_710,
    extraCost: 550,
    totalCost: 2_260,
  });
  assert.equal(9_500 - 2_260, 7_240);
  assert.equal(calculateRecipeCostBreakdown(ingredients, inventory, extraCosts).totalCost * 3, 6_780);
});

test("uses one audited recipe margin and never turns missing cost into a false 100% margin", () => {
  const ready = calculateRecipeMarginAudit({
    salePrice: 12_000,
    ingredients: [{ inventoryId: "chicken", quantity: 1 }],
    extraCosts: [{ amount: 100 }],
  }, [{ id: "chicken", unitCost: 1_000 }]);
  assert.equal(ready.totalCost, 1_100);
  assert.equal(ready.grossProfit, 10_900);
  assert.equal(ready.marginRatio, 10_900 / 12_000);
  assert.equal(ready.marginPercent, 10_900 / 12_000 * 100);
  assert.equal(ready.status, "TAYYOR");

  const missingCost = calculateRecipeMarginAudit({
    salePrice: 12_000,
    ingredients: [{ inventoryId: "chicken", quantity: 1 }],
  }, [{ id: "chicken", unitCost: 0 }]);
  assert.equal(missingCost.status, "TANNARX KIRITILMAGAN");
  assert.equal(missingCost.marginRatio, null);
  assert.equal(missingCost.marginPercent, null);

  const archived = calculateRecipeMarginAudit({
    salePrice: 12_000,
    ingredients: [{ inventoryId: "deleted", quantity: 1, lineCost: 900 }],
  }, []);
  assert.equal(archived.status, "INGREDIENT ARXIVDA");
  assert.equal(archived.marginRatio, null);
});

test("ignores malformed extra-cost values in calculations", () => {
  assert.equal(calculateRecipeExtraCost([
    { amount: 120 },
    { amount: Number.NaN },
    { amount: Number.POSITIVE_INFINITY },
    { amount: -10 },
  ]), 120);
});

test("normalizes human product names without losing non-Latin scripts", () => {
  assert.equal(normalizeHumanNameKey("  Go‘sht Kebab! "), "goshtkebab");
  assert.equal(normalizeHumanNameKey("치킨 메뉴"), "치킨메뉴");
  assert.equal(normalizeHumanNameKey("Курица"), "курица");
  assert.notEqual(normalizeHumanNameKey("Курица"), normalizeHumanNameKey("Кебаб"));
});

test("composes delayed saves without erasing a newer product cost", () => {
  const base = {
    updatedAt: "rev-1",
    recipes: [{
      id: "recipe-1",
      name: "Lavash",
      ingredients: [{ inventoryId: "meat", quantity: 0.12, unitCost: 10_000 }],
      extraCosts: [],
    }],
    suppliers: [{ id: "supplier-1", name: "Supplier", telegramChatId: "" }],
  };
  const costUpdate = {
    ...base,
    recipes: [{
      ...base.recipes[0],
      ingredients: [{ inventoryId: "meat", quantity: 0.12, unitCost: 12_000 }],
      extraCosts: [{ id: "cost-1", name: "Qadoq", amount: 500 }],
    }],
  };
  const staleSupplierUpdate = {
    ...base,
    suppliers: [{ ...base.suppliers[0], telegramChatId: "12345" }],
  };
  const staleMenuPriceUpdate = {
    ...base,
    recipes: [{ ...base.recipes[0], salePrice: 13_900 }],
  };
  const staleQuantityUpdate = {
    ...base,
    recipes: [{
      ...base.recipes[0],
      ingredients: [{ inventoryId: "meat", quantity: 0.15, unitCost: 10_000 }],
    }],
  };

  const afterCost = applyStatePatch(base, createStatePatch(base, costUpdate));
  const afterBoth = applyStatePatch(afterCost, createStatePatch(base, staleSupplierUpdate));
  const afterAll = applyStatePatch(afterBoth, createStatePatch(base, staleMenuPriceUpdate));
  const afterQuantity = applyStatePatch(afterAll, createStatePatch(base, staleQuantityUpdate));
  assert.equal(afterQuantity.recipes[0].ingredients[0].unitCost, 12_000);
  assert.equal(afterQuantity.recipes[0].ingredients[0].quantity, 0.15);
  assert.equal(afterQuantity.recipes[0].extraCosts[0].amount, 500);
  assert.equal(afterQuantity.recipes[0].extraCosts.length, 1, "retrying the same cost row must not duplicate it");
  assert.equal(afterQuantity.recipes[0].salePrice, 13_900);
  assert.equal(afterQuantity.suppliers[0].telegramChatId, "12345");
  assert.equal(isStatePatchEmpty(createStatePatch(base, base)), true);
});

test("keeps unrelated legacy recipe rows while validating new tannarx", () => {
  const current = [{
    id: "legacy",
    ingredients: [
      { inventoryId: "old", quantity: 0 },
      { inventoryId: "meat", quantity: 0.1, unitCost: 10_000 },
    ],
    extraCosts: [],
  }];
  assert.equal(validRecipeCosts([{
    id: "legacy",
    ingredients: [
      { inventoryId: "old", quantity: 0 },
      { inventoryId: "meat", quantity: 0.1, unitCost: 12_000 },
    ],
    extraCosts: [{ id: "cost-1", name: "Qadoq", amount: 300 }],
  }], current), true);

  assert.equal(validRecipeCosts([{
    id: "new-recipe",
    ingredients: [{ inventoryId: "meat", quantity: 0 }],
    extraCosts: [],
  }], current), false);
  assert.equal(validRecipeCosts([{
    id: "legacy",
    ingredients: [
      { inventoryId: "old", quantity: null },
      current[0].ingredients[1],
    ],
    extraCosts: [],
  }], current), false);

  const currentWithNull = [{
    id: "legacy-null",
    ingredients: [{ inventoryId: "old", quantity: null }],
    extraCosts: [],
  }];
  assert.equal(validRecipeCosts(currentWithNull, currentWithNull), true);

  const reorderedLegacy = [{
    id: "legacy-reordered",
    ingredients: [
      { inventoryId: "remove-me", quantity: 0 },
      { inventoryId: "keep-me", quantity: null },
      { inventoryId: "meat", quantity: 0.1, unitCost: 12_000 },
    ],
    extraCosts: [],
  }];
  assert.equal(validRecipeCosts([{
    ...reorderedLegacy[0],
    ingredients: [
      reorderedLegacy[0].ingredients[2],
      reorderedLegacy[0].ingredients[1],
    ],
  }], reorderedLegacy), true, "removing or reordering another legacy row must not block save");
});

test("payroll calculates cross-midnight work hours and monthly salary consistently", () => {
  const range = shiftRange("2026-08-10", "12:00", "00:00");
  assert.ok(range);
  assert.equal(range.elapsedMinutes, 720);
  assert.equal(shiftRange("2026-08-10", "12:00", "12:00"), null, "equal times are invalid, not a 24-hour shift");

  const staff = normalizeStaff([{
    id: "staff-1",
    name: "Ali",
    monthlySalary: 2_600_000,
    workDays: 26,
    dailyHours: 12,
    payType: "monthly",
    active: true,
  }])[0];
  const shift = normalizeWorkShifts([{
    id: "shift-1",
    staffId: staff.id,
    date: "2026-08-10",
    clockIn: range.clockIn,
    clockOut: range.clockOut,
    breakMinutes: 0,
    source: "owner",
    status: "closed",
  }])[0];
  assert.equal(workShiftMinutes(shift), 720);
  const summary = calculatePayroll(staff, [shift], [], "2026-08");
  assert.equal(summary.workedDays, 1);
  assert.equal(summary.workedMinutes, 720);
  assert.equal(Math.round(summary.basePay), 100_000);
  assert.equal(Math.round(summary.payable), 100_000);
});

test("payroll applies hourly rate, break, bonus, advance and deduction without losing excess advance", () => {
  const staff = normalizeStaff([{
    id: "staff-hourly",
    name: "Vali",
    payType: "hourly",
    hourlyRate: 12_000,
    monthlySalary: 0,
    workDays: 26,
    dailyHours: 8,
    active: true,
  }])[0];
  const range = shiftRange("2026-08-11", "09:00", "20:00");
  assert.ok(range);
  const shift = normalizeWorkShifts([{
    id: "shift-hourly",
    staffId: staff.id,
    date: "2026-08-11",
    clockIn: range.clockIn,
    clockOut: range.clockOut,
    breakMinutes: 60,
    status: "closed",
    source: "owner",
  }])[0];
  const adjustments = normalizePayrollAdjustments([
    { id: "bonus", staffId: staff.id, date: "2026-08-11", type: "bonus", amount: 50_000 },
    { id: "advance", staffId: staff.id, date: "2026-08-11", type: "advance", amount: 200_000 },
    { id: "deduction", staffId: staff.id, date: "2026-08-11", type: "deduction", amount: 10_000 },
  ]);
  const summary = calculatePayroll(staff, [shift], adjustments, "2026-08");
  assert.equal(summary.workedMinutes, 600);
  assert.equal(summary.basePay, 120_000);
  assert.equal(summary.payable, -40_000, "excess advance stays visible instead of disappearing");
});

test("legacy payroll data normalizes safely and strict state validation blocks overlap", () => {
  const staff = normalizeStaff([{ id: "legacy", name: "Eski xodim", monthlySalary: 3_200_000, workDays: 26, active: true }]);
  assert.equal(staff[0].payType, "monthly");
  assert.equal(staff[0].dailyHours, 12);
  assert.equal(staff[0].workerId, "");
  const first = shiftRange("2026-08-10", "12:00", "18:00");
  const second = shiftRange("2026-08-10", "17:00", "20:00");
  assert.ok(first && second);
  const shifts = [
    { id: "a", staffId: "legacy", date: "2026-08-10", clockIn: first.clockIn, clockOut: first.clockOut, breakMinutes: 0, status: "closed", source: "owner" },
    { id: "b", staffId: "legacy", date: "2026-08-10", clockIn: second.clockIn, clockOut: second.clockOut, breakMinutes: 0, status: "closed", source: "owner" },
  ];
  assert.equal(validPayrollState(staff, [shifts[0]], []), true);
  assert.equal(validPayrollState(staff, shifts, []), false, "overlapping shifts are rejected");
  assert.deepEqual(normalizePayrollAdjustments([
    { id: "bad-date", staffId: "legacy", date: "2026-99-99", type: "bonus", amount: 10_000 },
  ]), [], "impossible calendar dates are rejected");
});

test("payroll keeps the rate captured when a shift was worked", () => {
  const original = normalizeStaff([{
    id: "rate-history",
    name: "Hasan",
    payType: "hourly",
    hourlyRate: 10_000,
    workDays: 26,
    dailyHours: 8,
  }])[0];
  const changed = { ...original, hourlyRate: 20_000 };
  const range = shiftRange("2026-08-10", "12:00", "20:00");
  assert.ok(range);
  const shift = normalizeWorkShifts([{
    id: "rate-shift",
    staffId: original.id,
    date: "2026-08-10",
    clockIn: range.clockIn,
    clockOut: range.clockOut,
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    status: "closed",
    source: "owner",
  }])[0];
  assert.equal(workShiftPay(changed, shift), 80_000);
  assert.equal(calculatePayroll(changed, [shift], [], "2026-08").basePay, 80_000);
  const legacyShift = { ...shift, hourlyRateAtShift: 0, overtimeAfterHoursAtShift: 0, overtimeMultiplierAtShift: 0 };
  const frozen = freezeWorkShiftRates(original, [legacyShift]);
  assert.equal(calculatePayroll(changed, frozen, [], "2026-08").basePay, 80_000, "salary edits cannot change a legacy day's frozen amount");
});

test("payroll blocks open-shift overlap and preserves a stale open shift for correction", () => {
  const staff = normalizeStaff([{
    id: "open-staff",
    name: "Umar",
    payType: "hourly",
    hourlyRate: 10_000,
    workDays: 26,
    dailyHours: 8,
  }]);
  const closed = shiftRange("2026-08-10", "15:00", "17:00");
  assert.ok(closed);
  const openClockIn = new Date("2026-08-10T03:00:00.000Z");
  const shifts = [
    { id: "open", staffId: "open-staff", date: "2026-08-10", clockIn: openClockIn.toISOString(), clockOut: "", breakMinutes: 0, status: "open", source: "worker" },
    { id: "future", staffId: "open-staff", date: "2026-08-10", clockIn: closed.clockIn, clockOut: closed.clockOut, breakMinutes: 0, status: "closed", source: "owner" },
  ];
  assert.equal(validPayrollState(staff, shifts, []), false, "future manual shifts cannot overlap an open worker shift");
  assert.equal(validPayrollState(staff, [...shifts].reverse(), []), false, "overlap validation is independent of row order");
  const before = shiftRange("2026-08-10", "08:00", "10:00");
  assert.ok(before);
  assert.equal(validPayrollState(staff, [shifts[0], { ...shifts[1], id: "before", clockIn: before.clockIn, clockOut: before.clockOut }], []), true, "a closed shift wholly before clock-in remains valid");
  const tomorrow = shiftRange("2026-08-11", "12:00", "14:00");
  assert.ok(tomorrow);
  assert.equal(validPayrollState(staff, [shifts[0], { ...shifts[1], id: "tomorrow", clockIn: tomorrow.clockIn, clockOut: tomorrow.clockOut, date: "2026-08-11" }], []), true, "a closed shift after the 18-hour open-shift limit is allowed");
  assert.equal(workShiftMinutes(normalizeWorkShifts([shifts[0]])[0], new Date(openClockIn.getTime() + 20 * 60 * 60_000)), 18 * 60, "forgotten clock-out remains visible at the 18-hour correction cap");
  const normalizedOpen = normalizeWorkShifts([{ ...shifts[0], hourlyRateAtShift: 10_000 }])[0];
  const openNow = new Date(openClockIn.getTime() + 8 * 60 * 60_000);
  const openDay = calculateWorkdayPayEntries(staff[0], [normalizedOpen], openNow)[0];
  assert.equal(openDay.open, true);
  assert.equal(openDay.roundedTotalPay, 0, "open work is not presented as earned money before clock-out");
  assert.equal(calculatePayroll(staff[0], [normalizedOpen], [], "2026-08", { now: openNow }).basePay, 0, "open work cannot enter payroll or the payment amount");
  const earlierClosed = normalizeWorkShifts([{
    ...shifts[0],
    id: "earlier-closed",
    clockIn: new Date(openClockIn.getTime() - 4 * 60 * 60_000).toISOString(),
    clockOut: new Date(openClockIn.getTime() - 2 * 60 * 60_000).toISOString(),
    hourlyRateAtShift: 10_000,
    status: "closed",
    source: "owner",
  }])[0];
  assert.equal(calculatePayroll(staff[0], [earlierClosed, normalizedOpen], [], "2026-08", { now: openNow }).basePay, 0, "a partly open split-shift day is finalized only after its last clock-out");
});

test("Seoul accounting date rolls at midnight while operations keep the noon shift", () => {
  assert.equal(seoulBusinessDate(new Date("2026-08-10T14:59:00.000Z")), "2026-08-10", "23:59 KST stays on the current accounting date");
  assert.equal(seoulBusinessDate(new Date("2026-08-10T15:00:00.000Z")), "2026-08-11", "00:00 KST starts the next accounting date");
  assert.equal(seoulBusinessDate(new Date("2026-08-31T15:00:00.000Z")), "2026-09-01", "midnight rollover works across a month change");
  assert.equal(seoulBusinessDate(new Date("2025-12-31T15:00:00.000Z")), "2026-01-01", "midnight rollover works across a year change");
  assert.equal(seoulOperationDate(new Date("2026-08-10T16:30:00.000Z")), "2026-08-10", "01:30 KST closing control stays with the shift that opened the day before");
  assert.equal(seoulOperationDate(new Date("2026-08-11T03:00:00.000Z")), "2026-08-11", "12:00 KST starts the next operating shift");
  const previousTz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    assert.equal(shiftRange("2026-03-08", "12:00", "00:00")?.elapsedMinutes, 720);
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test("open forms roll to the next date and live state revisions refresh automatically", () => {
  const form = { date: "2026-08-10", amount: 12_000 };
  assert.deepEqual(rolloverFormDate(form, "2026-08-10", "2026-08-11"), {
    date: "2026-08-11",
    amount: 12_000,
  });
  assert.equal(rolloverFormDate({ ...form, date: "2026-08-09" }, "2026-08-10", "2026-08-11").date, "2026-08-09");
  assert.equal(rolloverSelectedDate("2026-08-10", "2026-08-10", "2026-08-11"), "2026-08-11");
  assert.equal(stateRevisionChanged("rev-1", "rev-2"), true);
  assert.equal(stateRevisionChanged("rev-2", "rev-2"), false);
  assert.equal(HALO_LIVE_SYNC_INTERVAL_MS, 5_000);

  const ownerSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const terminalSource = readFileSync(new URL("../app/pos-terminal/page.tsx", import.meta.url), "utf8");
  const terminalRoute = readFileSync(new URL("../app/api/pos-terminal/route.ts", import.meta.url), "utf8");
  const workerStateRoute = readFileSync(new URL("../app/api/worker-state/route.ts", import.meta.url), "utf8");
  const haloStore = readFileSync(new URL("../app/lib/halo-store.ts", import.meta.url), "utf8");
  const integrationStore = readFileSync(new URL("../app/lib/integration-store.ts", import.meta.url), "utf8");
  assert.match(ownerSource, /HALO_LIVE_SYNC_INTERVAL_MS/);
  assert.match(ownerSource, /announceHaloStateChange/);
  assert.match(ownerSource, /subscribeHaloStateChanges/);
  assert.match(workerSource, /\/api\/worker-state\?revision=1/);
  assert.match(workerSource, /subscribeHaloStateChanges/);
  assert.match(workerSource, /document\.visibilityState !== "visible"/);
  assert.match(terminalSource, /HALO_LIVE_SYNC_INTERVAL_MS/);
  assert.match(terminalSource, /announceHaloStateChange/);
  assert.match(terminalSource, /subscribeHaloStateChanges/);
  assert.match(terminalSource, /visibilitychange/);
  assert.match(terminalSource, /\$\{terminalApi\}\?branch=\$\{encodeURIComponent\(branchId\)\}&revision=1/);
  assert.match(terminalSource, /terminalRefreshInFlightRef\.current/);
  assert.match(terminalRoute, /updatedAt: await readHaloRevision\(branchId\)/);
  assert.match(workerStateRoute, /searchParams\.get\("revision"\) === "1"/);
  assert.match(workerStateRoute, /updatedAt: await readHaloRevision\(session\.branchId\)/);
  assert.doesNotMatch(workerStateRoute, /Number\(candidate\.stock\) >= 0/,
    "an existing negative warehouse balance must not block a valid employee POS sale");
  assert.match(workerStateRoute, /exactNegativeMovementTotals\(actual, expected\)/,
    "trusted recipe and submitted negative movements must use exact signed comparison");
  assert.match(workerStateRoute, /expectedWorkerRecipeMovementTotals/,
    "archived recipe ingredients must not block POS sales that deduct the remaining live ingredients");
  assert.match(workerStateRoute, /exactWorkerStockDeltas\(currentInventory, nextInventory, addedMovements\)/,
    "worker inventory changes still have to equal the validated POS or waste movement exactly");
  assert.match(ownerSource, /document\.visibilityState !== "visible"/);
  assert.match(ownerSource, /let refreshing = false/);
  assert.match(haloStore, /HALO_SCHEMA_MARKER[\s\S]*SELECT id FROM halo_migrations WHERE id = \?/);
  assert.match(integrationStore, /INTEGRATION_SCHEMA_MARKER[\s\S]*SELECT id FROM integration_schema_markers WHERE id = \?/);
});

test("rare owner management sections are loaded only when opened", () => {
  const ownerSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(ownerSource, /const ControlCenter = lazy\(\(\) => import\("\.\/control-center"\)\)/);
  assert.match(ownerSource, /const ArchiveCenter = lazy\(\(\) => import\("\.\/archive-center"\)\)/);
  assert.match(ownerSource, /const IntegrationCenter = lazy\(\(\) => import\("\.\/integration-center"\)\)/);
  assert.match(ownerSource, /<Suspense fallback=/);
  assert.doesNotMatch(ownerSource, /import ControlCenter,/);
});

test("manual morning shifts keep the exact selected Seoul calendar date", () => {
  const selectedDate = "2026-08-03";
  const range = shiftRange(selectedDate, "09:00", "17:00");
  assert.ok(range);
  assert.equal(
    seoulCalendarDate(new Date(range.clockIn)),
    selectedDate,
    "3-sana qo‘lda kiritilganda 2-sanaga siljimasligi kerak",
  );
});

test("legacy morning worker attendance is repaired to its Seoul calendar date", () => {
  const member = normalizeStaff([{
    id: "calendar-worker",
    name: "Xurshidbek",
    payType: "hourly",
    hourlyRate: 10_000,
    workDays: 26,
    dailyHours: 12,
    overtimeAfterHours: 12,
    overtimeMultiplier: 1,
  }])[0];
  const rawShifts = [{
    id: "manual-aug-13",
    staffId: member.id,
    date: "2026-08-13",
    clockIn: "2026-08-13T01:00:00.000Z",
    clockOut: "2026-08-13T13:00:00.000Z",
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    overtimeAfterHoursAtShift: 12,
    overtimeMultiplierAtShift: 1,
    note: "Rahbar qo‘lda kiritdi",
    source: "owner",
    status: "closed",
    createdAt: "2026-08-13T01:00:00.000Z",
    updatedAt: "2026-08-13T13:00:00.000Z",
  }, {
    id: "worker-aug-14",
    staffId: member.id,
    // Legacy noon-boundary bug stored this real Aug 14 shift under Aug 13.
    date: "2026-08-13",
    clockIn: "2026-08-14T00:42:00.000Z",
    clockOut: "2026-08-14T13:13:00.000Z",
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    overtimeAfterHoursAtShift: 12,
    overtimeMultiplierAtShift: 1,
    note: "Xodim ilovasidan boshlandi",
    source: "worker",
    status: "closed",
    createdAt: "2026-08-14T00:42:00.000Z",
    updatedAt: "2026-08-14T13:13:00.000Z",
  }];
  const normalized = normalizeWorkShifts(rawShifts);
  assert.equal(normalized.length, 2, "repair never deletes a work-history row");
  assert.equal(normalized[0].date, "2026-08-13");
  assert.equal(normalized[1].date, "2026-08-14", "clock-in is authoritative for worker attendance");
  assert.equal(workShiftCalendarDate(rawShifts[1]), "2026-08-14");
  assert.deepEqual(
    Object.fromEntries(["id", "clockIn", "clockOut", "hourlyRateAtShift", "source", "note"].map((key) => [key, normalized[1][key]])),
    Object.fromEntries(["id", "clockIn", "clockOut", "hourlyRateAtShift", "source", "note"].map((key) => [key, rawShifts[1][key]])),
    "date repair preserves the actual shift audit fields",
  );
  assert.deepEqual(normalizeWorkShifts(normalized), normalized, "calendar-date repair is idempotent");

  const entries = calculateWorkdayPayEntries(member, normalized);
  assert.deepEqual(entries.map((entry) => entry.date), ["2026-08-13", "2026-08-14"]);
  assert.equal(entries[0].workedMinutes, 12 * 60);
  assert.equal(entries[0].roundedTotalPay, 120_000);
  assert.equal(entries[1].workedMinutes, 12 * 60 + 31);
  assert.equal(entries[1].payableMinutes, 12 * 60 + 30);
  assert.equal(entries[1].regularMinutes, 12 * 60);
  assert.equal(entries[1].overtimeMinutes, 30);
  assert.equal(entries[1].roundedRegularPay, 120_000);
  assert.equal(entries[1].roundedOvertimePay, 5_000);
  assert.equal(entries[1].roundedTotalPay, 125_000);

  const report = buildPayrollReport({
    staff: [member],
    workShifts: rawShifts,
    payrollAdjustments: [],
    attendanceDays: [],
    payrollPayments: [],
    month: "2026-08",
  });
  assert.deepEqual(report.dailyPayRows.map((row) => row.Sana), ["2026-08-13", "2026-08-14"]);
  assert.deepEqual(report.shiftRows.map((row) => row.Sana), ["2026-08-13", "2026-08-14"]);
  assert.ok(report.dailyPayRows.every((row) => row["Haqiqiy soat"] !== 24.5), "the false 24h31 day cannot reach exports");

  const morningOpen = normalizeWorkShifts([{
    ...rawShifts[1],
    id: "worker-aug-15-open",
    date: "2026-08-14",
    clockIn: "2026-08-15T01:00:00.000Z",
    clockOut: "",
    status: "open",
  }])[0];
  assert.equal(morningOpen.date, "2026-08-15", "10:00 KST belongs to Aug 15 attendance, not Aug 14");
  const attendanceRoute = readFileSync(new URL("../app/api/attendance/route.ts", import.meta.url), "utf8");
  const davomatClient = readFileSync(new URL("../app/davomat/davomat-client.tsx", import.meta.url), "utf8");
  const haloStore = readFileSync(new URL("../app/lib/halo-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(attendanceRoute, /seoulBusinessDate/, "worker clock-in must never use the noon sales boundary");
  assert.match(attendanceRoute, /date: seoulCalendarDate\(now\)/);
  assert.match(davomatClient, /const today = seoulCalendarDate/);
  assert.match(haloStore, /worker-attendance-calendar-date-2026-08-15-v1/, "deployed data receives an audited one-time repair");
});

test("genuine overlapping shifts fail closed while adjacent split shifts remain payable", () => {
  const member = normalizeStaff([{
    id: "conflict-worker",
    name: "Conflict worker",
    payType: "hourly",
    hourlyRate: 10_000,
    workDays: 26,
    dailyHours: 8,
    overtimeAfterHours: 8,
    overtimeMultiplier: 1.5,
  }])[0];
  const shift = (id, clockIn, clockOut) => ({
    id,
    staffId: member.id,
    date: "2026-08-16",
    clockIn,
    clockOut,
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    overtimeAfterHoursAtShift: 8,
    overtimeMultiplierAtShift: 1.5,
    note: "",
    source: "owner",
    status: "closed",
    createdAt: clockIn,
    updatedAt: clockOut,
  });
  const overlapping = [
    shift("overlap-a", "2026-08-16T00:00:00.000Z", "2026-08-16T08:00:00.000Z"),
    shift("overlap-b", "2026-08-16T03:00:00.000Z", "2026-08-16T11:00:00.000Z"),
  ];
  assert.deepEqual(new Set(conflictingWorkShiftIds(overlapping)), new Set(["overlap-a", "overlap-b"]));
  const conflictDay = calculateWorkdayPayEntries(member, overlapping)[0];
  assert.equal(conflictDay.conflict, true);
  assert.equal(conflictDay.recordedMinutes, 16 * 60, "raw rows remain visible for correction");
  assert.equal(conflictDay.workedMinutes, 0);
  assert.equal(conflictDay.payableMinutes, 0);
  assert.equal(conflictDay.roundedTotalPay, 0);
  assert.equal(calculatePayroll(member, overlapping, [], "2026-08").basePay, 0);
  assert.equal(calculatePayrollForDate(member, overlapping, [], [], "2026-08-16"), 0);
  const conflictReport = buildPayrollReport({
    staff: [member],
    workShifts: overlapping,
    payrollAdjustments: [],
    attendanceDays: [],
    payrollPayments: [],
    month: "2026-08",
  });
  assert.match(String(conflictReport.dailyPayRows[0].Holat), /ustma-ust/i);
  assert.equal(conflictReport.dailyPayRows[0]["Kunlik qo‘shilgan pul"], "");

  const adjacent = [
    shift("adjacent-a", "2026-08-16T00:00:00.000Z", "2026-08-16T04:00:00.000Z"),
    shift("adjacent-b", "2026-08-16T04:00:00.000Z", "2026-08-16T08:00:00.000Z"),
  ];
  assert.deepEqual(conflictingWorkShiftIds(adjacent), []);
  const adjacentDay = calculateWorkdayPayEntries(member, adjacent)[0];
  assert.equal(adjacentDay.conflict, false);
  assert.equal(adjacentDay.payableMinutes, 8 * 60);
  assert.equal(adjacentDay.roundedTotalPay, 80_000);
});

test("a cross-date overlap stays unpaid in monthly summary, daily UI data, and export", () => {
  const member = normalizeStaff([{
    id: "cross-date-worker",
    name: "Cross date worker",
    payType: "hourly",
    hourlyRate: 10_000,
    workDays: 26,
    dailyHours: 8,
    overtimeAfterHours: 8,
    overtimeMultiplier: 1,
  }])[0];
  const shifts = [{
    id: "aug-31-night",
    staffId: member.id,
    date: "2026-08-31",
    clockIn: "2026-08-31T14:00:00.000Z",
    clockOut: "2026-08-31T20:00:00.000Z",
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    overtimeAfterHoursAtShift: 8,
    overtimeMultiplierAtShift: 1,
    note: "",
    source: "owner",
    status: "closed",
    createdAt: "2026-08-31T14:00:00.000Z",
    updatedAt: "2026-08-31T20:00:00.000Z",
  }, {
    id: "sep-1-overlap",
    staffId: member.id,
    date: "2026-09-01",
    clockIn: "2026-08-31T17:00:00.000Z",
    clockOut: "2026-09-01T01:00:00.000Z",
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    overtimeAfterHoursAtShift: 8,
    overtimeMultiplierAtShift: 1,
    note: "",
    source: "owner",
    status: "closed",
    createdAt: "2026-08-31T17:00:00.000Z",
    updatedAt: "2026-09-01T01:00:00.000Z",
  }];
  assert.equal(calculatePayroll(member, shifts, [], "2026-08").basePay, 0);
  const augustDaily = calculateWorkdayPayEntries(member, [shifts[0]], new Date("2026-09-02T00:00:00.000Z"), shifts);
  assert.equal(augustDaily[0].conflict, true);
  assert.equal(augustDaily[0].roundedTotalPay, 0);
  const augustReport = buildPayrollReport({
    staff: [member],
    workShifts: shifts,
    payrollAdjustments: [],
    attendanceDays: [],
    payrollPayments: [],
    month: "2026-08",
    now: new Date("2026-09-02T00:00:00.000Z"),
  });
  assert.equal(augustReport.summaryRows[0]["Asosiy hisob"], 0);
  assert.match(String(augustReport.dailyPayRows[0].Holat), /ustma-ust/i);
  assert.equal(augustReport.dailyPayRows[0]["Kunlik qo‘shilgan pul"], "");
});

test("payroll calculates overtime per business day without offsetting a short day", () => {
  const member = normalizeStaff([{
    id: "daily-overtime",
    name: "Daily overtime",
    payType: "monthly",
    monthlySalary: 2_600_000,
    hourlyRate: 0,
    workDays: 26,
    dailyHours: 12,
    overtimeAfterHours: 12,
    overtimeMultiplier: 1.5,
  }])[0];
  const capturedRate = 2_600_000 / (26 * 12);
  const closedShift = (day, clockOut, idSuffix) => {
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    const range = shiftRange(date, "12:00", clockOut);
    assert.ok(range);
    return normalizeWorkShifts([{
      id: `daily-${idSuffix}`,
      staffId: member.id,
      date,
      clockIn: range.clockIn,
      clockOut: range.clockOut,
      breakMinutes: 0,
      hourlyRateAtShift: capturedRate,
      overtimeAfterHoursAtShift: 12,
      overtimeMultiplierAtShift: 1.5,
      status: "closed",
      source: "owner",
    }])[0];
  };
  const shifts = [
    ...Array.from({ length: 24 }, (_, index) => closedShift(index + 1, "00:00", index + 1)),
    closedShift(25, "01:00", "long"),
    closedShift(26, "23:00", "short"),
  ];
  const summary = calculatePayroll(member, shifts, [], "2026-08");

  assert.equal(summary.workedMinutes, 312 * 60, "total hours equal the monthly plan");
  assert.equal(summary.regularMinutes, 311 * 60, "the short day reduces only regular hours");
  assert.equal(summary.overtimeMinutes, 60, "the long day's overtime is not cancelled by a short day");
  assert.equal(Math.round(summary.regularPay), 2_591_667);
  assert.equal(Math.round(summary.overtimePay), 12_500);
  assert.equal(Math.round(summary.basePay), 2_604_167);

  const splitDate = "2026-09-01";
  const morning = shiftRange(splitDate, "09:00", "13:00");
  const evening = shiftRange(splitDate, "14:00", "20:00");
  assert.ok(morning && evening);
  const hourlyMember = normalizeStaff([{
    id: "split-overtime",
    name: "Split overtime",
    payType: "hourly",
    hourlyRate: 12_000,
    monthlySalary: 0,
    workDays: 26,
    dailyHours: 8,
    overtimeAfterHours: 8,
    overtimeMultiplier: 1.5,
  }])[0];
  const splitShifts = normalizeWorkShifts([
    { id: "split-a", staffId: hourlyMember.id, date: splitDate, clockIn: morning.clockIn, clockOut: morning.clockOut, breakMinutes: 0, status: "closed", source: "owner" },
    { id: "split-b", staffId: hourlyMember.id, date: splitDate, clockIn: evening.clockIn, clockOut: evening.clockOut, breakMinutes: 0, status: "closed", source: "owner" },
  ]);
  const splitPay = calculateWorkdayPay(hourlyMember, splitShifts);
  assert.equal(splitPay.regularMinutes, 8 * 60);
  assert.equal(splitPay.overtimeMinutes, 2 * 60);
  assert.equal(splitPay.regularPay, 96_000);
  assert.equal(splitPay.overtimePay, 36_000, "missing shift snapshots fall back to the staff 1.5× rule");
  assert.equal(splitPay.totalPay, 132_000);
});

test("attendance status and salary payments affect remaining pay exactly once", () => {
  const member = normalizeStaff([{
    id: "attendance-payments",
    name: "Attendance payments",
    payType: "hourly",
    hourlyRate: 12_000,
    monthlySalary: 0,
    workDays: 26,
    dailyHours: 8,
    overtimeAfterHours: 8,
    overtimeMultiplier: 1.5,
  }])[0];
  const range = shiftRange("2026-08-01", "09:00", "17:00");
  assert.ok(range);
  const shift = normalizeWorkShifts([{
    id: "attendance-shift",
    staffId: member.id,
    date: "2026-08-01",
    clockIn: range.clockIn,
    clockOut: range.clockOut,
    breakMinutes: 0,
    hourlyRateAtShift: 12_000,
    overtimeAfterHoursAtShift: 8,
    overtimeMultiplierAtShift: 1.5,
    status: "closed",
    source: "owner",
  }])[0];
  const attendanceDays = normalizeAttendanceDays([
    { id: "day-off", staffId: member.id, date: "2026-08-02", status: "off", payMode: "unpaid" },
    { id: "day-absent", staffId: member.id, date: "2026-08-03", status: "absent", payMode: "unpaid" },
    { id: "day-sick", staffId: member.id, date: "2026-08-04", status: "sick", payMode: "planned", plannedMinutesAtDay: 480, hourlyRateAtDay: 12_000 },
    { id: "day-void", staffId: member.id, date: "2026-08-05", status: "sick", payMode: "planned", plannedMinutesAtDay: 480, hourlyRateAtDay: 12_000, voided: true },
  ]);
  const adjustments = normalizePayrollAdjustments([
    { id: "bonus", staffId: member.id, date: "2026-08-10", type: "bonus", amount: 50_000 },
    { id: "legacy-advance", staffId: member.id, date: "2026-08-10", type: "advance", amount: 20_000 },
    { id: "deduction", staffId: member.id, date: "2026-08-10", type: "deduction", amount: 10_000 },
  ]);
  const payments = normalizePayrollPayments([
    { id: "salary", staffId: member.id, month: "2026-08", date: "2026-09-05", kind: "salary", amount: 50_000, accountId: "bank", financialEntryId: "fin-salary" },
    { id: "advance", staffId: member.id, month: "2026-08", date: "2026-08-15", kind: "advance", amount: 10_000, accountId: "cash", financialEntryId: "fin-advance", paidAt: "2026-08-14T15:30:00.000Z" },
    { id: "void-payment", staffId: member.id, month: "2026-08", date: "2026-08-16", kind: "salary", amount: 30_000, accountId: "cash", financialEntryId: "fin-void", voided: true },
    { id: "other-month", staffId: member.id, month: "2026-09", date: "2026-09-05", kind: "salary", amount: 40_000, accountId: "bank", financialEntryId: "fin-other" },
  ]);
  const summary = calculatePayroll(member, [shift], adjustments, "2026-08", { attendanceDays, payments });

  assert.equal(summary.regularPay, 96_000);
  assert.equal(summary.paidStatusMinutes, 480);
  assert.equal(summary.paidStatusPay, 96_000);
  assert.equal(summary.basePay, 192_000);
  assert.equal(summary.grossPay, 232_000);
  assert.equal(summary.advance, 20_000);
  assert.equal(summary.paymentAmount, 60_000, "payment month, not bank date, selects the payment");
  assert.equal(payments.find((payment) => payment.id === "advance").paidAt, "2026-08-14T15:30:00.000Z");
  assert.equal(validPayrollState([member], [shift], adjustments, attendanceDays, payments), true);
  assert.equal(validPayrollState(
    [member],
    [shift],
    adjustments,
    attendanceDays,
    payments.map((payment) => payment.id === "advance"
      ? { ...payment, date: "2026-08-14" }
      : payment),
  ), false, "advance datetime must match its Seoul payment date");
  assert.equal(summary.remaining, 152_000);
  assert.equal(summary.payable, 152_000);
  assert.deepEqual({ off: summary.offDays, absent: summary.absentDays, sick: summary.sickDays }, { off: 1, absent: 1, sick: 1 });
  assert.deepEqual(normalizePayrollPayments([
    { id: "bad-month", staffId: member.id, month: "2026-13", date: "2026-08-01", kind: "salary", amount: 1, accountId: "cash", financialEntryId: "fin" },
  ]), [], "impossible payroll months are rejected");

  const conflictingPaidDay = normalizeAttendanceDays([{
    id: "same-day-sick",
    staffId: member.id,
    date: shift.date,
    status: "sick",
    payMode: "planned",
    plannedMinutesAtDay: 480,
    hourlyRateAtDay: 12_000,
  }]);
  const conflictSummary = calculatePayroll(member, [shift], [], "2026-08", { attendanceDays: conflictingPaidDay });
  assert.equal(conflictSummary.paidStatusPay, 0, "a stale status on a worked date cannot pay the employee twice");
  assert.equal(conflictSummary.basePay, 96_000);
});

test("attendance and payroll payment patches are retry-safe and preserve soft voids", () => {
  const base = { attendanceDays: [], payrollPayments: [], financialEntries: [] };
  const paymentA = { id: "payment-a", staffId: "staff-1", month: "2026-08", amount: 50_000, voided: false, reversalEntryId: "" };
  const entryA = { id: "fin-a", payrollPaymentId: paymentA.id, type: "expense", amount: paymentA.amount, affectsProfit: false };
  const addA = { ...base, payrollPayments: [paymentA], financialEntries: [entryA] };
  const patchA = createStatePatch(base, addA);
  const once = applyStatePatch(base, patchA);
  const twice = applyStatePatch(once, patchA);
  assert.equal(twice.payrollPayments.length, 1, "retrying a payment cannot duplicate it");
  assert.equal(twice.financialEntries.length, 1, "retrying cannot duplicate its cash entry");

  const paymentB = { id: "payment-b", staffId: "staff-1", month: "2026-08", amount: 25_000, voided: false, reversalEntryId: "" };
  const entryB = { id: "fin-b", payrollPaymentId: paymentB.id, type: "expense", amount: paymentB.amount, affectsProfit: false };
  const addB = { ...base, payrollPayments: [paymentB], financialEntries: [entryB] };
  const concurrent = applyStatePatch(once, createStatePatch(base, addB));
  assert.deepEqual(new Set(concurrent.payrollPayments.map((payment) => payment.id)), new Set(["payment-a", "payment-b"]));
  assert.deepEqual(new Set(concurrent.financialEntries.map((entry) => entry.id)), new Set(["fin-a", "fin-b"]));

  const voidA = {
    ...addA,
    payrollPayments: [{ ...paymentA, voided: true, reversalEntryId: "fin-a-reversal" }],
    financialEntries: [...addA.financialEntries, { id: "fin-a-reversal", payrollPaymentId: paymentA.id, type: "income", amount: paymentA.amount, affectsProfit: false, reversedEntryId: "fin-a" }],
  };
  const staleNoteEdit = { ...addA, payrollPayments: [{ ...paymentA, note: "Bank receipt checked" }] };
  const voided = applyStatePatch(addA, createStatePatch(addA, voidA));
  const merged = applyStatePatch(voided, createStatePatch(addA, staleNoteEdit));
  assert.equal(merged.payrollPayments.length, 1);
  assert.equal(merged.payrollPayments[0].voided, true, "a stale edit cannot resurrect a voided payment");
  assert.equal(merged.payrollPayments[0].reversalEntryId, "fin-a-reversal");
  assert.equal(merged.payrollPayments[0].note, "Bank receipt checked");
  assert.equal(merged.financialEntries.filter((entry) => entry.id === "fin-a-reversal").length, 1);

  const attendanceBase = { attendanceDays: [{ id: "staff-1:2026-08-10", staffId: "staff-1", date: "2026-08-10", status: "off", voided: false }] };
  const absent = { attendanceDays: [{ ...attendanceBase.attendanceDays[0], status: "absent" }] };
  const sick = { attendanceDays: [{ ...attendanceBase.attendanceDays[0], status: "sick" }] };
  const afterAbsent = applyStatePatch(attendanceBase, createStatePatch(attendanceBase, absent));
  const afterSick = applyStatePatch(afterAbsent, createStatePatch(attendanceBase, sick));
  assert.equal(afterSick.attendanceDays.length, 1, "deterministic staff/date IDs prevent duplicate day statuses");
  assert.equal(afterSick.attendanceDays[0].status, "sick", "the later queued status wins");
});

test("payroll finance links reject duplicate create and void ledger entries", () => {
  const accounts = [{ id: "cash" }];
  const payment = {
    id: "payment-stable",
    staffId: "staff-1",
    month: "2026-08",
    date: "2026-08-31",
    kind: "salary",
    amount: 125_000,
    accountId: "cash",
    financialEntryId: "finance-stable",
    voided: false,
    reversalEntryId: "",
  };
  const debit = {
    id: payment.financialEntryId,
    type: "expense",
    category: "Maosh to‘lovi",
    amount: payment.amount,
    date: payment.date,
    accountId: payment.accountId,
    affectsProfit: false,
    payrollPaymentId: payment.id,
  };

  assert.equal(validPayrollFinanceLinks([payment], accounts, [debit]), true);
  assert.equal(validPayrollFinanceLinks([payment], accounts, [
    debit,
    { ...debit, id: "finance-duplicate" },
  ]), false, "one payment cannot debit the cash ledger twice");
  assert.equal(validPayrollFinanceLinks([payment], accounts, [
    debit,
    { ...debit, id: "finance-orphan", payrollPaymentId: "missing-payment" },
  ]), false, "every payroll-linked ledger row must belong to a saved payment");
  assert.equal(validPayrollFinanceLinks([payment], accounts, [
    { ...debit, date: "2026-09-01" },
  ]), false, "the payment and its cash entry must use the same date");

  const reversalId = `fin-reversal-${payment.id}`;
  const voidedPayment = { ...payment, voided: true, reversalEntryId: reversalId };
  const reversal = {
    id: reversalId,
    type: "income",
    category: "Maosh to‘lovi bekori",
    amount: payment.amount,
    date: "2026-09-02",
    accountId: payment.accountId,
    affectsProfit: false,
    payrollPaymentId: payment.id,
    reversedEntryId: payment.financialEntryId,
  };
  assert.equal(validPayrollFinanceLinks([voidedPayment], accounts, [debit, reversal]), true);
  assert.equal(validPayrollFinanceLinks([voidedPayment], accounts, [
    debit,
    reversal,
    { ...reversal, id: "fin-reversal-duplicate" },
  ]), false, "one voided payment cannot credit the cash ledger twice");
});

test("stable payroll operation ids make create and void retries idempotent", () => {
  const payment = {
    id: "payment-stable",
    accountId: "cash",
    amount: 125_000,
    financialEntryId: "finance-stable",
    voided: false,
    reversalEntryId: "",
  };
  const debit = { id: payment.financialEntryId, payrollPaymentId: payment.id };
  const base = { payrollPayments: [], financialEntries: [] };
  const created = { payrollPayments: [payment], financialEntries: [debit] };
  const createPatch = createStatePatch(base, created);
  const createRetried = applyStatePatch(applyStatePatch(base, createPatch), createPatch);
  assert.equal(createRetried.payrollPayments.length, 1);
  assert.equal(createRetried.financialEntries.length, 1);

  const reversalId = `fin-reversal-${payment.id}`;
  const voided = {
    payrollPayments: [{ ...payment, voided: true, reversalEntryId: reversalId }],
    financialEntries: [
      { id: reversalId, payrollPaymentId: payment.id, reversedEntryId: payment.financialEntryId },
      debit,
    ],
  };
  const voidPatch = createStatePatch(created, voided);
  const voidRetried = applyStatePatch(applyStatePatch(created, voidPatch), voidPatch);
  assert.equal(voidRetried.payrollPayments.length, 1);
  assert.equal(voidRetried.payrollPayments[0].reversalEntryId, reversalId);
  assert.equal(voidRetried.financialEntries.filter((entry) => entry.id === reversalId).length, 1);
});

test("monthly payroll report keeps only the selected month and adds day and month totals", () => {
  const staff = [{
    id: "staff-report",
    name: "Ali",
    monthlySalary: 0,
    hourlyRate: 10_000,
    payType: "hourly",
    workDays: 26,
    dailyHours: 8,
    overtimeAfterHours: 8,
    overtimeMultiplier: 1.5,
    workerId: "worker-ali",
    active: true,
  }, {
    id: "staff-archive",
    name: "Vali",
    monthlySalary: 2_600_000,
    hourlyRate: 0,
    payType: "monthly",
    workDays: 26,
    dailyHours: 8,
    overtimeAfterHours: 8,
    overtimeMultiplier: 1,
    workerId: "",
    active: false,
  }];
  const makeShift = (id, date, clockIn, clockOut) => ({
    id,
    staffId: "staff-report",
    date,
    clockIn,
    clockOut,
    breakMinutes: 0,
    hourlyRateAtShift: 10_000,
    overtimeAfterHoursAtShift: 8,
    overtimeMultiplierAtShift: 1.5,
    note: "",
    source: "owner",
    status: "closed",
    createdAt: clockIn,
    updatedAt: clockOut,
  });
  const report = buildPayrollReport({
    staff,
    workShifts: [
      makeShift("aug-1", "2026-08-03", "2026-08-03T03:00:00.000Z", "2026-08-03T07:00:00.000Z"),
      makeShift("aug-2", "2026-08-03", "2026-08-03T08:00:00.000Z", "2026-08-03T12:00:00.000Z"),
      makeShift("sep-1", "2026-09-03", "2026-09-03T03:00:00.000Z", "2026-09-03T07:00:00.000Z"),
    ],
    payrollAdjustments: [
      { id: "bonus-aug", staffId: "staff-report", date: "2026-08-20", type: "bonus", amount: 5_000, note: "", voided: false },
      { id: "bonus-sep", staffId: "staff-report", date: "2026-09-20", type: "bonus", amount: 7_000, note: "", voided: false },
    ],
    attendanceDays: [
      { id: "archive-off", staffId: "staff-archive", date: "2026-08-10", status: "off", payMode: "unpaid", plannedMinutesAtDay: 0, hourlyRateAtDay: 0, note: "Dam", voided: false, createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z" },
      { id: "sep-off", staffId: "staff-report", date: "2026-09-10", status: "off", payMode: "unpaid", plannedMinutesAtDay: 0, hourlyRateAtDay: 0, note: "", voided: false, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z" },
    ],
    payrollPayments: [
      { id: "pay-aug", staffId: "staff-report", month: "2026-08", date: "2026-09-01", kind: "salary", amount: 20_000, accountId: "cash", financialEntryId: "fin-aug", note: "", voided: false, reversalEntryId: "", paidAt: "2026-09-01T03:45:00.000Z", createdAt: "2026-09-01T03:45:00Z", updatedAt: "2026-09-01T03:45:00Z" },
      { id: "pay-sep", staffId: "staff-report", month: "2026-09", date: "2026-09-02", kind: "salary", amount: 10_000, accountId: "cash", financialEntryId: "fin-sep", note: "", voided: false, reversalEntryId: "", createdAt: "2026-09-02T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z" },
    ],
    month: "2026-08",
    now: new Date("2026-08-31T12:00:00.000Z"),
  });

  assert.equal(report.shiftRows.length, 2);
  assert.equal(report.dailyPayRows.length, 1, "two same-day shifts create one daily wage row");
  assert.equal(report.dailyPayRows[0]["Kunlik qo‘shilgan pul"], 80_000);
  assert.deepEqual(report.shiftRows.map((row) => row.Keldi), ["12:00", "17:00"]);
  assert.deepEqual(report.shiftRows.map((row) => row["Kun jami soat"]), [8, 8]);
  assert.deepEqual(report.shiftRows.map((row) => row["Oy jami soat"]), [8, 8]);
  assert.equal(report.adjustmentRows.length, 1);
  assert.equal(report.paymentRows.length, 1, "payment month, not payment date, controls inclusion");
  assert.equal(report.paymentRows[0].Sana, "2026-09-01");
  assert.equal(report.paymentRows[0]["Berilgan vaqt"], "12:45");
  assert.equal(report.dayRows.length, 1);
  assert.ok(report.summaryRows.some((row) => row.Xodim === "Vali" && row.Holat === "Arxiv"), "archived staff history stays exportable");
  assert.ok(report.googleSheetsRows.every((row) => row["Hisobot oyi"] === "2026-08"));
  const googleDetailRows = report.googleSheetsRows.filter((row) => row["Yozuv turi"] !== "Oylik xulosa");
  assert.ok(googleDetailRows.every((row) => row["Oy jami soat"] === undefined), "monthly totals are not repeated on detail rows");
  assert.equal(report.googleSheetsRows.filter((row) => row["Yozuv turi"] === "Kunlik ish haqi").length, 1, "Google Sheets receives daily money once per date");
  const googleSummary = report.googleSheetsRows.find((row) => row.Xodim === "Ali" && row["Yozuv turi"] === "Oylik xulosa");
  assert.equal(googleSummary["Oy jami soat"], 8);
  assert.equal(googleSummary["Smena soati"], "", "month total is not duplicated into the shift-hours column");
  const paidDayReport = buildPayrollReport({
    staff: [staff[0]],
    workShifts: [],
    payrollAdjustments: [],
    attendanceDays: [{ id: "paid-off", staffId: "staff-report", date: "2026-08-12", status: "off", payMode: "planned", plannedMinutesAtDay: 480, hourlyRateAtDay: 10_000, note: "Dam", voided: false, createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" }],
    payrollPayments: [],
    month: "2026-08",
  });
  const paidDayCsv = paidDayReport.googleSheetsRows.find((row) => row["Yozuv turi"] === "Kun holati");
  assert.equal(paidDayCsv["Hisoblangan soat"], 8);
  assert.equal(paidDayCsv["Maoshga ta’siri"], "Reja soati hisoblandi");

  const paymentAuditReport = buildPayrollReport({
    staff: [staff[0]],
    workShifts: [],
    payrollAdjustments: [],
    attendanceDays: [],
    payrollPayments: [
      { id: "active-pay", staffId: "staff-report", month: "2026-08", date: "2026-08-31", kind: "salary", amount: 100_000, accountId: "cash", financialEntryId: "fin-active", note: "", voided: false, reversalEntryId: "", createdAt: "", updatedAt: "" },
      { id: "void-pay", staffId: "staff-report", month: "2026-08", date: "2026-09-01", kind: "salary", amount: 50_000, accountId: "bank", financialEntryId: "fin-void", note: "Bekor", voided: true, reversalEntryId: "fin-reverse", createdAt: "", updatedAt: "" },
    ],
    accounts: [{ id: "cash", name: "Naqd kassa" }, { id: "bank", name: "Bank" }],
    month: "2026-08",
  });
  assert.equal(paymentAuditReport.summaryRows[0]["To‘langan"], 100_000, "voided money never reduces the balance");
  assert.deepEqual(paymentAuditReport.paymentRows.map((row) => [row.Hisob, row.Holat]), [
    ["Naqd kassa", "Amalda"],
    ["Bank", "Bekor qilingan"],
  ], "payment audit keeps account names and cancelled history");
});

test("worker attendance projection never contains pay or overtime fields", () => {
  const safe = toWorkerAttendanceShift({
    id: "safe-shift",
    staffId: "staff-private",
    date: "2026-08-13",
    clockIn: "2026-08-13T03:00:00.000Z",
    clockOut: "",
    breakMinutes: 0,
    hourlyRateAtShift: 25_000,
    overtimeAfterHoursAtShift: 8,
    overtimeMultiplierAtShift: 1.5,
    note: "private",
    source: "worker",
    status: "open",
    createdAt: "2026-08-13T03:00:00.000Z",
    updatedAt: "2026-08-13T03:00:00.000Z",
  });
  assert.deepEqual(Object.keys(safe).sort(), ["clockIn", "clockOut", "date", "id", "status"]);
  assert.equal(JSON.stringify(safe).includes("25000"), false);
  assert.equal(JSON.stringify(safe).includes("overtime"), false);
});

test("each employee account receives only its own monthly workdays and earned amounts", () => {
  const [member, other] = normalizeStaff([
    { id: "staff-own", name: "Ali", payType: "hourly", hourlyRate: 10_000, monthlySalary: 0, workDays: 26, dailyHours: 8, workerId: "worker-own", active: true },
    { id: "staff-other", name: "Vali", payType: "hourly", hourlyRate: 50_000, monthlySalary: 0, workDays: 26, dailyHours: 8, workerId: "worker-other", active: true },
  ]);
  const shifts = normalizeWorkShifts([
    { id: "own-a", staffId: member.id, date: "2026-08-10", clockIn: "2026-08-10T03:00:00.000Z", clockOut: "2026-08-10T11:00:00.000Z", breakMinutes: 0, hourlyRateAtShift: 10_000, overtimeAfterHoursAtShift: 8, overtimeMultiplierAtShift: 1, source: "owner", status: "closed" },
    { id: "own-b", staffId: member.id, date: "2026-08-11", clockIn: "2026-08-11T03:00:00.000Z", clockOut: "2026-08-11T07:00:00.000Z", breakMinutes: 0, hourlyRateAtShift: 10_000, overtimeAfterHoursAtShift: 8, overtimeMultiplierAtShift: 1, source: "owner", status: "closed" },
    { id: "other", staffId: other.id, date: "2026-08-10", clockIn: "2026-08-10T03:00:00.000Z", clockOut: "2026-08-10T11:00:00.000Z", breakMinutes: 0, hourlyRateAtShift: 50_000, overtimeAfterHoursAtShift: 8, overtimeMultiplierAtShift: 1, source: "owner", status: "closed" },
  ]);
  const view = workerMonthlyEarnings(member, shifts, "2026-08", new Date("2026-08-20T00:00:00.000Z"));
  assert.equal(view.workedDays, 2);
  assert.equal(view.workedMinutes, 12 * 60);
  assert.equal(view.totalEarned, 120_000);
  assert.deepEqual(view.days.map((day) => [day.date, day.amount]), [["2026-08-11", 40_000], ["2026-08-10", 80_000]]);
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("50000"), false, "another employee's amount never enters the response");
  assert.equal(serialized.includes("hourlyRate"), false, "wage settings stay private");
  assert.equal(serialized.includes("monthlySalary"), false, "salary settings stay private");
});

test("employee portal is organized into fast mobile-friendly sections", () => {
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(workerSource, /type WorkerPortalSection = "today" \| "account" \| "actions" \| "tasks"/);
  assert.match(workerSource, /activePortalSection === "today"/);
  assert.match(workerSource, /activePortalSection === "account"/);
  assert.match(workerSource, /activePortalSection === "actions"/);
  assert.match(workerSource, /activePortalSection === "tasks"/);
  assert.match(workerSource, /id="xodim-portal-window"/);
  assert.match(workerSource, /id="xodim-amal-form"/);
  assert.match(workerSource, /className="worker-section-nav"/);
  assert.match(workerSource, /className="worker-mobile-quick-nav"/);
  assert.match(workerSource, /openPortalSection\("account"\)/, "each bottom button opens its own attached window");
  assert.match(workerSource, /openWorkerTask\(taskId\)/, "an action opens its form instead of returning to the page top");
  assert.match(css, /grid-template-columns:repeat\(4,1fr\)/);
  assert.match(css, /position:fixed;z-index:70/, "mobile quick navigation stays reachable with one hand");
  assert.match(css, /worker-mobile-quick-nav button\.active/, "the selected window remains visually highlighted");
});

test("daily operations checklist stores one actor and timestamp per item", () => {
  const now = new Date("2026-08-20T03:10:00.000Z");
  const first = applyOperationCompletion([], {
    date: "2026-08-20",
    itemId: "opening-hygiene",
    completed: true,
    actor: "Xurshidbek",
    workerId: "worker-x",
    now,
  });
  const repeated = applyOperationCompletion(first, {
    date: "2026-08-20",
    itemId: "opening-hygiene",
    completed: true,
    actor: "Xurshidbek",
    workerId: "worker-x",
    now,
  });
  assert.equal(validOperationChecklistDays(repeated), true);
  const view = operationChecklistView(repeated, "2026-08-20");
  assert.equal(view.completed, 1);
  assert.equal(view.phases[0].items[0].completion.completedBy, "Xurshidbek");
  assert.equal(view.phases[0].items[0].completion.completedAt, now.toISOString());
  assert.equal(repeated[0].completions.length, 1, "a repeated save never duplicates a checklist item");
});

test("daily operations alerts turn red when opening is late and clear after completion", () => {
  const now = new Date("2026-08-20T03:45:00.000Z"); // 12:45 Seoul
  const state = { operationChecklistDays: [], workShifts: [], inventory: [], suppliers: [], dailyCloses: [] };
  assert.equal(buildOperationAlerts(state, "2026-08-20", now)[0].id, "opening-incomplete");
  let days = [];
  for (const item of OPERATION_CHECKLIST_ITEMS.filter((entry) => entry.phase === "opening")) {
    days = applyOperationCompletion(days, {
      date: "2026-08-20",
      itemId: item.id,
      completed: true,
      actor: "Rahbar",
      now,
    });
  }
  const alerts = buildOperationAlerts({ ...state, operationChecklistDays: days }, "2026-08-20", now);
  assert.equal(alerts.some((alert) => alert.id === "opening-incomplete"), false);
});

test("owner and employee interfaces both expose the same secured operations flow", () => {
  const ownerSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../app/worker/page.tsx", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../app/api/operations/route.ts", import.meta.url), "utf8");
  assert.match(ownerSource, /href="\/nazorat"/);
  assert.match(workerSource, /Ochilish \/ Yopilish nazorati/);
  assert.match(workerSource, /scope: "worker"/);
  assert.match(routeSource, /Avval “ISHNI BOSHLADIM”/);
  assert.match(routeSource, /completedByWorkerId/);
});

test("owner interface keeps daily navigation short and exposes a separate API window", () => {
  const ownerSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const integrationSource = readFileSync(new URL("../app/integration-center.tsx", import.meta.url), "utf8");
  assert.match(ownerSource, /id: "integrations" as Tab/);
  assert.match(ownerSource, /<IntegrationCenter key=\{activeBranchId\}/);
  assert.match(ownerSource, /const primaryNav = \(\["dashboard", "sales", "intake", "inventory"\] as const\)/);
  assert.match(ownerSource, /label: "SOZLAMALAR", ids: \["recipes", "fees", "integrations"\]/);
  assert.match(integrationSource, /API va boshqa tizimlar/);
  assert.match(integrationSource, /To‘liq ma’lumotni yuklash/);
});

test("portable API supports branch-scoped reads and full export", () => {
  const storeSource = readFileSync(new URL("../app/lib/integration-store.ts", import.meta.url), "utf8");
  const schemaSource = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  const inventoryRoute = readFileSync(new URL("../app/api/integrations/v1/inventory/route.ts", import.meta.url), "utf8");
  const salesRoute = readFileSync(new URL("../app/api/integrations/v1/sales/route.ts", import.meta.url), "utf8");
  const reportsRoute = readFileSync(new URL("../app/api/integrations/v1/reports/route.ts", import.meta.url), "utf8");
  const exportRoute = readFileSync(new URL("../app/api/integrations/v1/export/route.ts", import.meta.url), "utf8");
  const googleSheetsRoute = readFileSync(new URL("../app/api/integrations/v1/google-sheets/route.ts", import.meta.url), "utf8");
  assert.match(schemaSource, /integrationApiKeys[\s\S]*branchId: text\("branch_id"\)/);
  assert.match(storeSource, /"inventory:read"/);
  assert.match(storeSource, /"sales:read"/);
  assert.match(storeSource, /"reports:read"/);
  assert.match(storeSource, /"export:read"/);
  assert.match(storeSource, /WHERE branch_id = \?/);
  assert.match(inventoryRoute, /readHaloState\(key\.branchId\)/);
  assert.match(salesRoute, /readHaloState\(key\.branchId\)/);
  assert.match(reportsRoute, /calculateDailyReport/);
  assert.match(exportRoute, /halo-control-portable-export/);
  assert.match(googleSheetsRoute, /authenticateApiKey\(request, "reports:read"\)/);
  assert.match(googleSheetsRoute, /buildGoogleSheetsExport/);
});

test("portable sales API exposes validated delivery metadata without changing legacy rows", () => {
  const salesRoute = readFileSync(new URL("../app/api/integrations/v1/sales/route.ts", import.meta.url), "utf8");
  assert.match(salesRoute, /new Set\(\["coupang", "baemin", "yogiyo"\]\)/);
  assert.match(salesRoute, /deliveryMetadata\(sale\)/);
  assert.match(salesRoute, /metadata\.deliveryPlatform = platform/);
  assert.match(salesRoute, /\["deliveryOrderNumber", "deliveryBatchId"\]/);
  assert.match(salesRoute, /metadata\.soldAt/);
  assert.match(salesRoute, /metadata\.deliveryCommissionPct/);
  assert.match(salesRoute, /metadata\.deliveryCommissionAmount/);
});

test("Google Sheets report exports live sales, expenses, outflows, profit and product analysis", () => {
  const state = {
    accounts: [
      { id: "cash", name: "Naqd kassa", type: "cash", openingBalance: 0 },
      { id: "card", name: "Karta POS", type: "card", openingBalance: 0 },
    ],
    suppliers: [
      { id: "supplier-a", name: "GLOBAL SERVIS", phone: "+82 10", bankAccount: "KB 123", balance: 50_000 },
      { id: "supplier-b", name: "HALAL FOOD", phone: "", bankAccount: "", balance: -10_000 },
    ],
    mezanaEntries: [
      { id: "mezana-sheet-purchase", action: "purchased", productName: "Kolbasa", amount: 25_000, quantity: 0, date: "2026-08-22", createdByName: "Ali" },
      { id: "mezana-sheet-return", action: "returned", productName: "Non", amount: 0, quantity: 2, date: "2026-08-22", createdByName: "Ali" },
    ],
    transactions: [
      { id: "pay-a-future", supplierId: "supplier-a", type: "payment", amount: 20_000, date: "2026-08-23", note: "Keyingi kun to‘lovi", accountId: "cash" },
      { id: "pay-a", supplierId: "supplier-a", type: "payment", amount: 30_000, date: "2026-08-22", note: "Qarz to‘lovi", accountId: "cash" },
      {
        id: "purchase-a",
        supplierId: "supplier-a",
        type: "purchase",
        amount: 100_000,
        date: "2026-08-22",
        note: "Kolbasa nakladnoyi",
        document: {
          key: "stock-documents/main/123e4567-e89b-12d3-a456-426614174000.jpg",
          fileName: "nakladnoy.jpg",
          contentType: "image/jpeg",
          size: 1024,
          uploadedAt: "2026-08-22T10:00:00.000Z",
        },
      },
      { id: "pay-b", supplierId: "supplier-b", type: "payment", amount: 30_000, date: "2026-08-22", note: "Oldindan to‘lov", accountId: "cash" },
      { id: "purchase-b", supplierId: "supplier-b", type: "purchase", amount: 20_000, date: "2026-08-22", note: "Go‘sht", accountId: "" },
    ],
    inventory: [{ id: "chicken", name: "Tovuq", categoryId: "main", stock: 5, minStock: 2, unit: "kg", unitCost: 1_000 }],
    productCategories: [{ id: "main", name: "Asosiy taom" }],
    recipes: [
      {
        id: "tandir",
        name: "Tandir Lavash Chicken",
        posCode: "000038",
        categoryId: "main",
        salePrice: 12_000,
        ingredients: [{ inventoryId: "chicken", quantity: 1 }],
        extraCosts: [{ amount: 100 }],
      },
      {
        id: "mojito",
        name: "Mojito Lime",
        posCode: "000011",
        categoryId: "main",
        salePrice: 3_000,
        ingredients: [{ name: "Mojito siropi", unit: "ml", quantity: 1, lineCost: 800 }],
        extraCosts: [],
      },
    ],
    sales: [
      {
        id: "sale-card",
        externalId: "=DANGER",
        recipeId: "tandir",
        date: "2026-08-22",
        quantity: 2,
        unitPrice: 12_000,
        totalRevenue: 24_000,
        totalCost: 2_200,
        accountId: "card",
        source: "pos",
        taxTreatment: "automatic",
      },
      {
        id: "sale-cash",
        recipeId: "tandir",
        date: "2026-08-22",
        quantity: 1,
        unitPrice: 10_000,
        totalRevenue: 10_000,
        totalCost: 1_100,
        accountId: "cash",
        source: "manual",
        taxTreatment: "accountant_managed",
      },
      {
        id: "sale-cancelled-order",
        posOrderId: "order-cancelled",
        recipeId: "tandir",
        date: "2026-08-22",
        quantity: 9,
        unitPrice: 11_000,
        totalRevenue: 99_000,
        totalCost: 9_900,
        accountId: "card",
        source: "pos",
        taxTreatment: "automatic",
      },
    ],
    posOrders: [
      { id: "order-1", date: "2026-08-22", total: 24_000, status: "completed" },
      { id: "order-2", date: "2026-08-22", total: 10_000, status: "new" },
      { id: "order-cancelled", date: "2026-08-22", total: 99_000, status: "cancelled" },
    ],
    financialEntries: [
      { id: "expense-active", date: "2026-08-22", type: "expense", category: "Ijara", amount: 3_000, accountId: "cash", affectsProfit: true },
      { id: "expense-covered", date: "2026-08-22", type: "expense", category: "Soliq", amount: 777, accountId: "cash", affectsProfit: true },
      { id: "income-active", date: "2026-08-22", type: "income", category: "Boshqa kirim", amount: 2_000, accountId: "cash", affectsProfit: true },
      { id: "expense-old", date: "2026-08-22", type: "expense", category: "Boshqa", amount: 5_000, accountId: "cash", affectsProfit: true },
      { id: "expense-reversal", date: "2026-08-22", type: "income", category: "Bekor", amount: 5_000, accountId: "cash", reversedEntryId: "expense-old" },
      { id: "supplier-pay-a-future", date: "2026-08-23", type: "expense", category: "Mahsulot xaridi", amount: 20_000, accountId: "cash", affectsProfit: false, transactionId: "pay-a-future" },
      { id: "supplier-pay-a", date: "2026-08-22", type: "expense", category: "Mahsulot xaridi", amount: 30_000, accountId: "cash", affectsProfit: false, transactionId: "pay-a" },
      { id: "supplier-pay-b", date: "2026-08-22", type: "expense", category: "Mahsulot xaridi", amount: 30_000, accountId: "cash", affectsProfit: false, transactionId: "pay-b" },
    ],
    workerConsumptions: [
      { id: "waste", date: "2026-08-22", kind: "waste", label: "Tovuq", quantity: 1, unit: "kg", totalCost: 900 },
      { id: "meal", date: "2026-08-22", kind: "inventory_only", label: "Lavash", quantity: 1, unit: "dona", totalCost: 500 },
    ],
    dailyCloses: [{ date: "2026-08-22", expectedTotal: 31_000, actualTotal: 30_000, difference: -1_000 }],
    deletedItems: [{
      id: "deleted:return-a",
      kind: "transaction",
      entityId: "return-a",
      label: "GLOBAL SERVIS · ₩15,000",
      section: "Oldi-berdi",
      deletedAt: "2026-08-22T10:00:00.000Z",
      deletedBy: "Rahbar",
      reason: "Mahsulot yetkazib beruvchiga vozvrat qilindi",
      record: {
        id: "return-a", supplierId: "supplier-a", type: "purchase", amount: 15_000,
        date: "2026-08-22", note: "Qaytarilgan mahsulot",
      },
    }],
    costRules: { cardCommissionPct: 2, deliveryCommissionPct: 0, taxPct: 1 },
    staff: [{
      id: "staff-a", name: "Ali", payType: "hourly", hourlyRate: 10_000,
      monthlySalary: 0, workDays: 26, dailyHours: 8, active: true,
    }],
    workShifts: [],
    payrollAdjustments: [],
    attendanceDays: [],
    payrollPayments: [],
  };

  assert.equal(googleSheetsDateRangeDays("2024-02-29", "2024-03-01"), 2);
  assert.equal(googleSheetsDateRangeDays("2026-02-29", "2026-03-01"), 0);

  const exported = buildGoogleSheetsExport(state, "2026-08-22", "2026-08-22");
  assert.throws(() => buildGoogleSheetsExport({
    ...state,
    suppliers: state.suppliers.map((supplier, index) => index ? supplier : { ...supplier, balance: 50_000.4 }),
  }, "2026-08-22", "2026-08-22"), /balansi noto‘g‘ri/,
  "a fractional or malformed supplier balance must not be rounded into a false match");
  const sheets = new Map(exported.sheets.map((sheet) => [sheet.name, sheet]));
  assert.deepEqual([...sheets.keys()], [
    "HALO HISOBOT",
    "HALO KUNLIK",
    "HALO SAVDO",
    "HALO DELIVERY",
    "HALO PUL HARAKATI",
    "HALO OMBOR",
    "HALO CHIQIM",
    "HALO YETKAZUVCHILAR",
    "HALO XODIMLAR",
    "HALO SABZAVOT SARFI",
  ]);

  const daily = sheets.get("HALO KUNLIK");
  const dailyRow = Object.fromEntries(daily.headers.map((header, index) => [header, daily.rows[0][index]]));
  assert.equal(dailyRow["Jami savdo (₩)"], 34_000);
  assert.equal(dailyRow["Boshqa kirim (₩)"], 2_000);
  assert.equal(dailyRow["Jami xarajat (₩)"], 5_120);
  assert.equal(dailyRow["Sof foyda (₩)"], 27_580);
  assert.equal(dailyRow["POS / kiosk (₩)"], 24_000);
  assert.equal(dailyRow["Naqd (₩)"], 10_000);
  assert.equal(dailyRow["Hisob-raqam (₩)"], 0);
  assert.equal(dailyRow["Oshxonada yeyilgan (₩)"], 500);
  assert.equal(dailyRow["Chiqit / isrof (₩)"], 900);
  assert.equal(dailyRow["Kun yakuni farqi (₩)"], -1_000);
  assert.deepEqual(daily.headers, [
    "Sana", "Jami savdo (₩)", "POS / kiosk (₩)", "Naqd (₩)", "Hisob-raqam (₩)",
    "Tannarx (₩)", "Yalpi foyda (₩)", "Boshqa kirim (₩)", "Jami xarajat (₩)", "Sof foyda (₩)",
    "Oshxonada yeyilgan (₩)", "Chiqit / isrof (₩)", "Sotilgan dona", "Kun yakuni farqi (₩)",
    "Delivery jami (₩)", "Coupang Eats (₩)", "Baemin (₩)", "Yogiyo (₩)", "Delivery / Eski (₩)",
  ]);
  assert.ok(exported.sheets.every((sheet) => sheet.rows.every((row) => row.length === sheet.headers.length)),
    "every Google Sheets row must match its headers exactly");

  const money = sheets.get("HALO PUL HARAKATI");
  assert.equal(money.headers.includes("Xarajat ID"), false);
  assert.equal(money.rows.some((row) => row.includes("Boshqa")), false);
  assert.equal(money.rows.some((row) => row.includes("Ijara")), true);
  assert.equal(money.rows.some((row) => row.includes(777)), false,
    "a manual tax row covered by the automatic rule cannot be counted twice");
  assert.equal(money.rows.some((row) => row.includes("POS / karta komissiyasi")), true);
  assert.equal(money.rows.some((row) => row.includes("Soliq")), true);
  const operatingExpenseRows = money.rows.filter((row) => row[1] === "Xarajat");
  assert.equal(operatingExpenseRows.reduce((sum, row) => sum + Number(row[4] || 0), 0), 5_120,
    "expense detail must reconcile exactly with operating expenses");
  assert.equal(money.rows.some((row) => row[1] === "Kirim" && row[4] === 2_000), true);
  assert.equal(money.rows.filter((row) => row.includes("Mahsulot xaridi")).every((row) => row[5] === "Foydaga qayta ta’sir qilmaydi"), true,
    "supplier payments are visible cash outflows but not a second operating-profit expense");

  const supplierSummary = sheets.get("HALO YETKAZUVCHILAR");
  assert.equal(supplierSummary.rows.length, 2);
  assert.deepEqual(supplierSummary.headers, [
    "Yetkazib beruvchi", "QARZ (₩)", "AVANS (₩)", "TO‘LIQ TO‘LANDI (₩)", "VOZVRAT QILINDI (₩)",
  ]);
  const globalSupplier = Object.fromEntries(supplierSummary.headers.map((header, index) => [header, supplierSummary.rows[0][index]]));
  assert.equal(globalSupplier["Yetkazib beruvchi"], "GLOBAL SERVIS");
  assert.equal(globalSupplier["QARZ (₩)"], 50_000);
  assert.equal(globalSupplier["AVANS (₩)"], 0);
  assert.equal(globalSupplier["TO‘LIQ TO‘LANDI (₩)"], 0);
  assert.equal(globalSupplier["VOZVRAT QILINDI (₩)"], 15_000);
  const halalSupplier = Object.fromEntries(supplierSummary.headers.map((header, index) => [header, supplierSummary.rows[1][index]]));
  assert.equal(halalSupplier["QARZ (₩)"], 0);
  assert.equal(halalSupplier["AVANS (₩)"], 10_000);
  assert.equal(halalSupplier["TO‘LIQ TO‘LANDI (₩)"], 20_000);
  assert.equal(halalSupplier["VOZVRAT QILINDI (₩)"], 0);
  assert.equal(supplierSummary.rows.some((row) => row[0] === "MEZANA"), false);
  assert.equal(sheets.has("HALO OLDI-BERDI"), false);
  assert.equal(sheets.has("HALO NAKLADNOYLAR"), false);
  assert.equal(sheets.has("HALO QARZ TO‘LOVLARI"), false);
  const product = sheets.get("HALO SAVDO").rows[0];
  assert.equal(product[0], "000038");
  assert.equal(product[1], "Tandir Lavash Chicken");
  assert.equal(product[2], 3);
  assert.equal(product[3], 34_000);
  assert.equal(product[4], 3_300);
  assert.equal(product[5], 30_700);
  assert.equal(product[6], 30_700 / 34_000);
  assert.equal(product[7], 12_000);
  assert.equal(product[8], 1_100);
  assert.equal(product[9], 10_900);
  assert.equal(product[10], 10_900 / 12_000);
  assert.equal(product[11], "TAYYOR");
  assert.equal(product[12], 24_000);
  assert.equal(product[13], 10_000);
  assert.equal(product[14], "000038");
  const unsoldProduct = sheets.get("HALO SAVDO").rows.find((row) => row[0] === "000011");
  assert.ok(unsoldProduct, "all current menu products must appear even when they have no sales in the selected period");
  assert.equal(unsoldProduct[1], "Mojito Lime");
  assert.equal(unsoldProduct[2], 0);
  assert.equal(unsoldProduct[3], 0);
  assert.equal(unsoldProduct[7], 3_000);

  const changedExport = buildGoogleSheetsExport({
    ...state,
    recipes: state.recipes.map((recipe) => recipe.id === "mojito" ? {
      ...recipe,
      name: "Mojito Green Lime",
      posCode: "000777",
      salePrice: 3_500,
    } : recipe),
  }, "2026-08-22", "2026-08-22");
  const changedProducts = changedExport.sheets.find((sheet) => sheet.name === "HALO SAVDO");
  const changedProduct = changedProducts.rows.find((row) => row[0] === "000777");
  assert.ok(changedProduct, "HALO menu code changes must be reflected in Google Sheets export");
  assert.equal(changedProduct[1], "Mojito Green Lime");
  assert.equal(changedProduct[7], 3_500);

  const repairedCodeExport = buildGoogleSheetsExport({
    ...state,
    recipes: [
      { ...state.recipes[0], id: "code-a", name: "A mahsulot", posCode: "000038" },
      { ...state.recipes[1], id: "code-b", name: "B mahsulot", posCode: "000038" },
      { ...state.recipes[1], id: "code-c", name: "C mahsulot", posCode: "" },
      { ...state.recipes[1], id: "code-d", name: "D mahsulot", posCode: "M0042", posAliases: ["000777"] },
    ],
    sales: [],
  }, "2026-08-22", "2026-08-22");
  const repairedCodeSheet = repairedCodeExport.sheets.find((sheet) => sheet.name === "HALO SAVDO");
  const repairedCodesByProduct = new Map(repairedCodeSheet.rows.map((row) => [row[1], row[0]]));
  assert.equal(repairedCodesByProduct.get("A mahsulot"), "000038");
  assert.equal(repairedCodesByProduct.get("B mahsulot"), "M0001");
  assert.equal(repairedCodesByProduct.get("C mahsulot"), "M0002");
  assert.equal(repairedCodesByProduct.get("D mahsulot"), "000777");
  const repairedAllCodes = new Map(repairedCodeSheet.rows.map((row) => [row[1], row[14]]));
  assert.equal(repairedAllCodes.get("D mahsulot"), "000777 · M0042");

  const report = Object.fromEntries(sheets.get("HALO HISOBOT").rows);
  assert.equal(report["Boshlanish sanasi"], "2026-08-22");
  assert.equal(report["Tugash sanasi"], "2026-08-22");
  assert.equal(report["Hisob tekshiruvi"], "MOS ✓");
  assert.equal(report["Jami savdo (₩)"], 34_000);
  assert.equal(report["POS / kiosk (₩)"], 24_000);
  assert.equal(report["Naqd savdo (₩)"], 10_000);
  assert.equal(report["Hisob-raqam savdosi (₩)"], 0);
  assert.equal(report["Boshqa kirim (₩)"], 2_000);
  assert.equal(report["Karta / POS komissiyasi (₩)"], 480);
  assert.equal(report["Avtomatik soliq (₩)"], 240);
  assert.equal(report["Jami xarajat (₩)"], 5_120);
  assert.equal(report["Sof foyda (₩)"], 27_580);
  assert.equal(report["Oshxonada yeyilgan (₩)"], 500);
  assert.equal(report["Chiqit / isrof (₩)"], 900);
  assert.equal(report["Davrda mahsulot olindi (₩)"], 120_000);
  assert.equal(report["Davrda pul to‘landi (₩)"], 60_000);
  assert.equal(report["Hozirgi qarz (₩)"], 50_000);
  assert.equal(report["Hozirgi avans (₩)"], 10_000);
  assert.equal(report["MEZANA davrda sotib olindi (₩)"], undefined);
  assert.equal(report["MEZANA hozirgi qarzi (₩)"], undefined);
  assert.equal(report["Eng yaxshi kun"], "2026-08-22");
  assert.equal(report["Eng ko‘p savdo qilgan mahsulot"], "Tandir Lavash Chicken");

  const inventory = sheets.get("HALO OMBOR");
  assert.deepEqual(inventory.rows[0], ["Tovuq", "Asosiy taom", 5, "kg", 1_000, 5_000, 2, "YETARLI"]);
  const outflows = sheets.get("HALO CHIQIM");
  assert.equal(outflows.rows.length, 2);
  assert.equal(outflows.rows.reduce((sum, row) => sum + Number(row[5] || 0), 0), 1_400);
  const payroll = sheets.get("HALO XODIMLAR");
  assert.equal(payroll.rows.length, 1);
  assert.equal(payroll.rows[0][1], "Ali");

  const script = createGoogleSheetsAppsScript({
    origin: "https://halo-control.example/",
    apiKey: "halo_live_secret",
    branchId: "main",
    days: 365,
  });
  assert.match(script, /https:\/\/halo-control\.example\/api\/integrations\/v1\/google-sheets/);
  assert.match(script, /halo_live_secret/);
  assert.match(script, /function HALO_SETUP/);
  assert.match(script, /scriptVersion: "3\.4"/);
  assert.match(script, /addItem\("Sana oralig‘ini tanlash", "HALO_OPEN_DATE_RANGE"\)/);
  assert.match(script, /function HALO_OPEN_DATE_RANGE\(\)/);
  assert.match(script, /haloEnsureDateRange_\(sheet/);
  assert.match(script, /exportVersion: "3\.1"/);
  assert.match(script, /branchId: "main"/);
  assert.match(script, /setSpreadsheetTimeZone\(HALO_CONFIG\.timezone\)/);
  assert.match(script, /everyMinutes\(1\)/);
  assert.match(script, /function haloSyncStatus_/);
  assert.match(script, /function haloTrySyncStatus_/);
  assert.match(script, /function HALO_REFRESH_CHARTS/);
  assert.doesNotMatch(script, /haloOrderSheets_\(book\);\s*haloBuildAnalysisCharts_\(book\);/);
  assert.match(script, /getDataRange\(\)\.clearContent\(\)/);
  assert.match(script, /setBackgrounds\(/);
  assert.match(script, /getSheetByName\("HALO ULANISH"\)/);
  assert.match(script, /\["1 daqiqalik yangilash", automatic \? "YOQILGAN"/);
  assert.match(script, /HALO’dagi yangi ma’lumotlar 1 daqiqa ichida avtomatik tushadi/);
  assert.match(script, /haloTrySyncStatus_\("XATO"/);
  assert.ok(
    script.indexOf("HALO_SYNC({ haloSetup: true });") < script.indexOf('ScriptApp.newTrigger("HALO_SYNC")'),
    "the first live sync must succeed before automatic triggers are installed",
  );
  assert.match(script, /function HALO_DATE_EDIT/);
  assert.match(script, /newTrigger\("HALO_DATE_EDIT"\)\.forSpreadsheet\(book\)\.onEdit\(\)\.create\(\)/);
  assert.match(script, /getName\(\) !== "HALO HISOBOT"/);
  assert.match(script, /editsB2/);
  assert.match(script, /editsB3/);
  assert.match(script, /requireDate\(\)\.setAllowInvalid\(false\)/);
  assert.match(script, /function HALO_OPEN_REPORT/);
  assert.doesNotMatch(script, /function HALO_DAILY_SEARCH/);
  assert.doesNotMatch(script, /function HALO_OPEN_DAILY_ANALYSIS/);
  assert.match(script, /haloFetchAndWrite_\(selected\.from, selected\.to, silent\)/);
  assert.doesNotMatch(script, /function haloSelectedDailyDate_/);
  assert.match(script, /payload\.from !== from \|\| payload\.to !== to/);
  assert.match(script, /payload\.branchId !== HALO_CONFIG\.branchId/);
  assert.match(script, /sources\.forEach\(function\(source\) \{ haloWriteSheet_/);
  assert.match(script, /function haloRemoveLegacySheets_/);
  assert.match(script, /book\.deleteSheet\(sheet\)/);
  assert.match(script, /source\.name === "HALO YETKAZUVCHILAR"/);
  assert.match(script, /source\.name === "HALO OMBOR"/);
  assert.match(script, /source\.name === "HALO XODIMLAR"/);
  assert.match(
    script,
    /const codeColumn = source\.headers\.indexOf\("Kod"\) \+ 1;[\s\S]*setNumberFormat\("@"\);[\s\S]*setValues\(values\)/,
    "product codes must be formatted as text before writing so leading zeroes stay intact",
  );
  assert.match(script, /if_updated_at/);
  assert.match(script, /if_export_version/);
  assert.match(script, /payload\.unchanged === true/);
  assert.match(script, /function haloValidSource_/);
  assert.match(script, /Eski hisobot saqlandi/);
  assert.match(script, /getSheetByName\("HALO HISOBOT"\)/);
  assert.match(script, /getRange\("B2"\)/);
  assert.match(script, /getRange\("B3"\)/);
  assert.match(script, /rangeDays < 1 \|\| rangeDays > 366/);
  assert.match(script, /function haloBuildAnalysisCharts_/);
  assert.match(script, /LockService\.getDocumentLock/);
  assert.match(script, /response\.getResponseCode\(\) === 401/);
  assert.match(script, /HALO ulanish kaliti bekor bo‘lgan/);
  assert.match(script, /"HALO PUL HARAKATI"/);
  assert.match(script, /"HALO DELIVERY"/);
  assert.match(script, /"HALO OMBOR"/);
  assert.match(script, /"HALO XODIMLAR"/);
  assert.match(script, /"HALO KUNLIK TAHLIL"/,
    "known legacy sheet names stay in the cleanup list");
  assert.doesNotThrow(() => new Function(script));
  const parseHaloDate = new Function(`${script}; return haloIsoDate_;`)();
  assert.equal(parseHaloDate("2026.08.20"), "2026-08-20");
  assert.equal(parseHaloDate("2026-08-20"), "2026-08-20");
  assert.equal(parseHaloDate("2026.02.29"), "");
  assert.equal(parseHaloDate("2026.13.01"), "");
  assert.equal(parseHaloDate("noto‘g‘ri"), "");
});

test("Google Sheets exports delivery platforms, settlement and profit without breaking version 3.1", () => {
  const exported = buildGoogleSheetsExport({
    accounts: [{ id: "delivery", name: "Delivery", type: "delivery" }],
    inventory: [],
    recipes: [
      {
        id: "delivery-a", name: "Halo Lavash", posCode: "000038", salePrice: 10_000,
        ingredients: [{ name: "Masalliq", unit: "dona", quantity: 1, lineCost: 4_000 }], extraCosts: [],
      },
      {
        id: "delivery-b", name: "Mojito", posCode: "000011", salePrice: 8_000,
        ingredients: [{ name: "Sirop", unit: "ml", quantity: 1, lineCost: 3_000 }], extraCosts: [],
      },
    ],
    sales: [
      {
        id: "delivery-coupang", recipeId: "delivery-a", date: "2026-08-22", soldAt: "2026-08-22T03:34:00.000Z",
        quantity: 2, totalRevenue: 20_000, totalCost: 8_000, accountId: "delivery", source: "delivery",
        deliveryPlatform: "coupang", deliveryOrderNumber: "C-001", deliveryBatchId: "batch-c",
        deliveryCommissionPct: 12, deliveryCommissionAmount: 2_400, taxTreatment: "automatic",
      },
      {
        id: "delivery-baemin", recipeId: "delivery-b", date: "2026-08-22", soldAt: "2026-08-22T04:00:00.000Z",
        quantity: 1, totalRevenue: 15_000, totalCost: 5_000, accountId: "delivery", source: "delivery",
        deliveryPlatform: "baemin", deliveryOrderNumber: "B-001", deliveryBatchId: "batch-b",
        deliveryCommissionPct: 10, deliveryCommissionAmount: 1_500, taxTreatment: "automatic",
      },
      {
        id: "delivery-yogiyo", recipeId: "delivery-b", date: "2026-08-22", soldAt: "2026-08-22T05:00:00.000Z",
        quantity: 1, totalRevenue: 8_000, totalCost: 3_000, accountId: "delivery", source: "delivery",
        deliveryPlatform: "yogiyo", deliveryOrderNumber: "Y-001", deliveryBatchId: "batch-y",
        taxTreatment: "automatic",
      },
      {
        id: "delivery-legacy", recipeId: "delivery-a", date: "2026-08-22", createdAt: "2026-08-22T06:00:00.000Z",
        quantity: 1, totalRevenue: 7_000, totalCost: 2_000, accountId: "delivery", source: "manual",
        taxTreatment: "automatic",
      },
    ],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 15, taxPct: 0 },
    staff: [], workShifts: [], payrollAdjustments: [], attendanceDays: [], payrollPayments: [],
  }, "2026-08-22", "2026-08-22");

  assert.equal(exported.exportVersion, "3.1", "installed 3.1 scripts must continue accepting the payload");
  const sheets = new Map(exported.sheets.map((sheet) => [sheet.name, sheet]));
  const delivery = sheets.get("HALO DELIVERY");
  assert.deepEqual(delivery.headers, [
    "Sana", "Vaqt", "Platforma", "Buyurtma raqami", "Kod", "Mahsulot", "Soni",
    "Savdo (₩)", "Tannarx (₩)", "Komissiya %", "Komissiya (₩)",
    "Hisobga tushadi (₩)", "Sof foyda (₩)",
  ]);
  assert.equal(delivery.rows.length, 4);
  const coupang = Object.fromEntries(delivery.headers.map((header, index) => [header, delivery.rows[0][index]]));
  assert.equal(coupang.Platforma, "Coupang Eats");
  assert.equal(coupang.Vaqt, "12:34");
  assert.equal(coupang["Buyurtma raqami"], "C-001");
  assert.equal(coupang.Kod, "000038");
  assert.equal(coupang["Komissiya %"], 0.12);
  assert.equal(coupang["Komissiya (₩)"], 2_400);
  assert.equal(coupang["Hisobga tushadi (₩)"], 17_600);
  assert.equal(coupang["Sof foyda (₩)"], 9_600);
  assert.equal(delivery.rows.some((row) => row[2] === "Delivery / Eski"), true);

  const daily = Object.fromEntries(sheets.get("HALO KUNLIK").headers.map((header, index) => (
    [header, sheets.get("HALO KUNLIK").rows[0][index]]
  )));
  assert.equal(daily["Delivery jami (₩)"], 50_000);
  assert.equal(daily["Coupang Eats (₩)"], 20_000);
  assert.equal(daily["Baemin (₩)"], 15_000);
  assert.equal(daily["Yogiyo (₩)"], 8_000);
  assert.equal(daily["Delivery / Eski (₩)"], 7_000);

  const products = sheets.get("HALO SAVDO");
  const lavashRow = products.rows.find((row) => row[0] === "000038");
  const lavash = Object.fromEntries(products.headers.map((header, index) => [header, lavashRow[index]]));
  assert.equal(lavash["Delivery jami (₩)"], 27_000);
  assert.equal(lavash["Coupang Eats (₩)"], 20_000);
  assert.equal(lavash["Delivery / Eski (₩)"], 7_000);

  const report = Object.fromEntries(sheets.get("HALO HISOBOT").rows);
  assert.equal(report["Delivery jami savdo (₩)"], 50_000);
  assert.equal(report["Delivery jami buyurtma"], 4);
  assert.equal(report["Coupang Eats · komissiya (₩)"], 2_400);
  assert.equal(report["Baemin · hisobga tushadi (₩)"], 13_500);
  assert.equal(report["Yogiyo · sof foyda (₩)"], 3_800);
  assert.equal(report["Delivery / Eski · sof foyda (₩)"], 3_950);
});

test("Google Sheets flags zero-cost sales instead of publishing a false product margin", () => {
  const exported = buildGoogleSheetsExport({
    accounts: [{ id: "card", name: "Karta", type: "card" }],
    inventory: [{ id: "missing-cost", name: "Tannarxsiz", stock: 1, unit: "dona", unitCost: 0 }],
    recipes: [{
      id: "recipe-missing-cost",
      name: "Tannarxsiz taom",
      posCode: "000099",
      salePrice: 10_000,
      ingredients: [{ inventoryId: "missing-cost", quantity: 1 }],
      extraCosts: [],
    }],
    sales: [{
      id: "sale-missing-cost",
      recipeId: "recipe-missing-cost",
      date: "2026-08-22",
      quantity: 1,
      totalRevenue: 10_000,
      totalCost: 0,
      accountId: "card",
      taxTreatment: "automatic",
    }],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
  }, "2026-08-22", "2026-08-22");
  const sheets = new Map(exported.sheets.map((sheet) => [sheet.name, sheet]));
  const product = sheets.get("HALO SAVDO").rows[0];
  assert.equal(product[4], "");
  assert.equal(product[5], "");
  assert.equal(product[6], "");
  assert.equal(product[10], "");
  assert.equal(product[11], "SOTUV TANNARXI 0 — TEKSHIRING");
  const report = Object.fromEntries(sheets.get("HALO HISOBOT").rows);
  assert.match(report["Hisob tekshiruvi"], /SOTUV TANNARXI 0/);
});

test("Google Sheets setup is visible and creates a report-only integration key", () => {
  const integrationSource = readFileSync(new URL("../app/integration-center.tsx", import.meta.url), "utf8");
  const adminSource = readFileSync(new URL("../app/api/admin/integrations/route.ts", import.meta.url), "utf8");
  assert.match(integrationSource, /Bitta oynadan kunlik yoki davriy hisobotni tanlang/);
  assert.match(integrationSource, /Bitta kun uchun ikkala sanani bir xil qo‘ying/);
  assert.match(integrationSource, /Google Sheets ulash kodini yaratish/);
  assert.match(integrationSource, /Yangi ishlaydigan kod yaratish/);
  assert.match(integrationSource, /oldingi kalit o‘chirilmaydi/);
  assert.match(integrationSource, /yangi ma’lumotlar 1 daqiqa ichida avtomatik tushadi/);
  assert.match(integrationSource, /HALO_SETUP/);
  assert.match(integrationSource, /HALO ULANISH/);
  assert.match(integrationSource, /eski varaqlar saqlanadi, yangi HALO SABZAVOT SARFI varag‘i qo‘shiladi/);
  assert.match(integrationSource, /10 ta hisobot, eski varaqlar saqlanadi/);
  assert.match(integrationSource, /<span>Ombor<\/span>/);
  assert.match(integrationSource, /<span>Xodimlar<\/span>/);
  assert.match(integrationSource, /<span>Yetkazuvchilar<\/span>/);
  assert.doesNotMatch(integrationSource, /<span>Oldi-berdi<\/span>/);
  assert.doesNotMatch(integrationSource, /<span>Nakladnoylar<\/span>/);
  assert.match(integrationSource, /keyin hech narsa bosmaysiz/);
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /Bitta kunni alohida ko‘rish/);
  assert.match(pageSource, /start: event\.target\.value, end: event\.target\.value/);
  assert.match(adminSource, /action === "setup-google-sheets"/);
  assert.match(adminSource, /\["reports:read"\]/);
  assert.doesNotMatch(adminSource, /previousGoogleKeys/);
  assert.doesNotMatch(adminSource, /Promise\.all\([^)]*revokeApiKey/,
    "generating a replacement Sheets script must not revoke the currently installed key");
});

test("Chicken oil purchase and used-oil resale reconcile once across finance and Google Sheets", () => {
  const entries = [
    {
      id: "oil-buy", date: "2026-08-22", type: "expense", category: OIL_PURCHASE_CATEGORY,
      amount: 90_000, accountId: "cash", note: "2 kanistr", affectsProfit: true,
      oilFlowType: "purchase", oilCanCount: 2, oilLiters: 36, oilUnitAmount: 45_000,
    },
    {
      id: "oil-resale", date: "2026-08-22", type: "income", category: OIL_RESALE_CATEGORY,
      amount: 28_000, accountId: "cash", note: "Qayta sotildi", affectsProfit: true,
      oilFlowType: "resale", oilCanCount: 1, oilLiters: 18, oilUnitAmount: 28_000,
    },
  ];
  assert.equal(CHICKEN_OIL_CAN_LITERS, 18);
  assert.equal(validOilLedgerMetadata(entries), true);
  assert.equal(validOilLedgerMetadata([{ ...entries[0], amount: 89_999 }]), false,
    "oil total must equal can count multiplied by the unit amount");
  assert.deepEqual(summarizeOilLedger(entries), {
    purchaseCans: 2,
    purchaseLiters: 36,
    purchaseCost: 90_000,
    resaleCans: 1,
    resaleLiters: 18,
    resaleIncome: 28_000,
    averagePurchaseUnitAmount: 45_000,
    averageResaleUnitAmount: 28_000,
    averageUnitDifference: -17_000,
    netOilCost: 62_000,
    recoveryRate: 28_000 / 90_000 * 100,
  });
  assert.deepEqual(summarizeOilLedger([
    entries[0],
    { ...entries[0], id: "oil-buy-later", amount: 42_000, oilCanCount: 1, oilLiters: 18, oilUnitAmount: 42_000 },
    entries[1],
    { ...entries[1], id: "oil-resale-later", amount: 54_000, oilCanCount: 2, oilLiters: 36, oilUnitAmount: 27_000 },
  ]), {
    purchaseCans: 3,
    purchaseLiters: 54,
    purchaseCost: 132_000,
    resaleCans: 3,
    resaleLiters: 54,
    resaleIncome: 82_000,
    averagePurchaseUnitAmount: 44_000,
    averageResaleUnitAmount: 27_333,
    averageUnitDifference: -16_667,
    netOilCost: 50_000,
    recoveryRate: 82_000 / 132_000 * 100,
  }, "different purchase and resale prices must produce weighted per-can averages");

  const exported = buildGoogleSheetsExport({
    accounts: [{ id: "cash", name: "Naqd kassa", type: "cash", openingBalance: 0 }],
    financialEntries: entries,
    inventory: [], recipes: [], productCategories: [], suppliers: [], transactions: [], sales: [],
    posOrders: [], workerConsumptions: [], dailyCloses: [], costRules: {}, staff: [], workShifts: [],
    payrollAdjustments: [], attendanceDays: [],
  }, "2026-08-22", "2026-08-22");
  const sheets = new Map(exported.sheets.map((sheet) => [sheet.name, sheet]));
  const money = sheets.get("HALO PUL HARAKATI");
  assert.equal(money.rows.some((row) => row[1] === "Xarajat" && row[4] === 90_000 && String(row[3]).includes("45,000 ₩")), true);
  assert.equal(money.rows.some((row) => row[1] === "Kirim" && row[4] === 28_000 && String(row[3]).includes("28,000 ₩")), true);
  const daily = Object.fromEntries(sheets.get("HALO KUNLIK").headers.map((header, index) => (
    [header, sheets.get("HALO KUNLIK").rows[0][index]]
  )));
  assert.equal(daily["Jami xarajat (₩)"], 90_000);
  assert.equal(daily["Boshqa kirim (₩)"], 28_000);
  assert.equal(daily["Sof foyda (₩)"], -62_000);
  const report = Object.fromEntries(sheets.get("HALO HISOBOT").rows);
  assert.equal(report["O‘rtacha olish narxi, 18 L (₩)"], 45_000);
  assert.equal(report["O‘rtacha sotish narxi, 18 L (₩)"], 28_000);
  assert.equal(report["Sotish − olish farqi, 18 L (₩)"], -17_000);
  assert.equal(report["Moy xarajati (₩)"], 90_000);
  assert.equal(report["Ishlatilgan moy sotildi (₩)"], 28_000);
  assert.equal(report["Sof moy xarajati (₩)"], 62_000);
  assert.equal(report["Sof foyda (₩)"], -62_000, "oil must not be counted twice in profit");

  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const ownerOilRoute = readFileSync(new URL("../app/api/oil-records/route.ts", import.meta.url), "utf8");
  assert.match(pageSource, /CHICKEN MOYI HISOBI/);
  assert.match(pageSource, /1 kanistr = \{CHICKEN_OIL_CAN_LITERS\} L/);
  assert.match(pageSource, /oilSavingRef\.current/);
  assert.match(pageSource, /oilOperationIdRef\.current/);
  assert.match(pageSource, /ownerMezanaSavingRef\.current \|\| oilSavingRef\.current/,
    "branch changes must wait while a branch-scoped MEZANA or oil request is running");
  assert.equal((pageSource.match(/ownerMezanaSavingRef\.current \|\| oilSavingRef\.current/g) || []).length, 2,
    "branch transition must recheck direct saves after waiting for the normal save queue");
  assert.match(pageSource, /branchTransitionRef\.current/,
    "branch-scoped direct writes must not start while another branch is opening");
  assert.match(pageSource, /\/api\/oil-records\?branch=/);
  assert.match(ownerOilRoute, /mutateHaloState/);
  assert.match(ownerOilRoute, /entries\.some\(\(entry\) => entry\.id === entryId\)/,
    "a repeated oil save must not create a duplicate finance row");
  assert.match(ownerOilRoute, /entries\.some\(\(entry\) => entry\.id === entryId\)[\s\S]*isAccountingMonthClosed/,
    "an already-saved oil retry succeeds even if the accounting month was closed afterward");
  assert.match(pageSource, /Har safar o‘sha kundagi narxni kiriting/);
});
