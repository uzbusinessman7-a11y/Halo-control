"use client";
import RecordRemovalHistory from "./record-removal-history";
import RecordRemovalDialog from "./record-removal-dialog";
import type { RemovalTarget } from "./lib/record-removals";
import { calculateAccountBalances } from "./lib/account-balances";
import { receiptDisplay, receiptTotalRows } from "./lib/receipt-display";
import { supplierSourceDocument } from "./lib/supplier-source";
import VegetableExpensesPanel from "./vegetable-expenses-panel";
import { isExpenseOnlyInventory } from "./lib/vegetable-expenses";
import InventoryAccountingPanel from "./inventory-accounting-panel";
import WarehouseRecordsPanel from "./warehouse-records-panel";
import InventoryArchiveDialog from "./inventory-archive-dialog";
import { applySaleInventoryAccounting, type InventoryAccountingFields } from "./lib/inventory-accounting";
import BusinessAuditPanel from "./business-audit-panel";
import { auditBusinessState } from "./lib/business-audit";
/* eslint-disable @next/next/no-img-element */

import SupplierLedgerPanel from "./supplier-ledger-panel";
import SupplierCancellationPanel from "./supplier-cancellation-panel";
import PosImportReview from "./pos-import-review";
import PosDayResetPanel from "./pos-day-reset-panel";
import SalesChannelSummary from "./sales-channel-summary";
import { reconcilePosImport } from "./lib/pos-reconciliation";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  autoDetectPosColumns,
  extractPosTable,
  normalizeProductCode,
  parsePosRows,
  type PosColumnMapping,
  type PosRawRow,
  type PosTable,
  type SpreadsheetValue,
} from "./pos-import";
import {
  canApplyOcrAlternative,
  deletionMovesAwayFromReceipt,
  ocrOkposCodeQuantityColumns,
  ocrTextToPosTable,
  parseNumericOcrPairs,
  parseOcrTsvLines,
  photoPosCodeQuantityMapping,
  photoPosMapping,
  rebuildOcrRowsFromProductColumn,
  reconcileNumericOcrPasses,
  removedRowsFillReceiptGap,
  type OcrReviewIssue,
} from "./photo-import";
import {
  calculateRecipeCost,
  calculateRecipeCostBreakdown,
  calculateRecipeExtraCost,
  calculateRecipeMarginAudit,
  convertRecipeQuantity,
  linkRecipeIngredientsToInventory,
  normalizeHumanNameKey,
  normalizeRecipeIngredients,
} from "./lib/recipe-costing";
import {
  applyStatePatch,
  createStatePatch,
  isStatePatchEmpty,
  type StatePatch,
} from "./lib/state-patch";
import { encodeHaloHeader } from "./lib/halo-header";
import { ensureMenuCodes, nextMenuCode, normalizeMenuCode, promoteLearnedMenuCodes, recipeHasMenuCode } from "./lib/menu-codes";
import {
  categoriesForKind,
  DEFAULT_PRODUCT_CATEGORIES,
  inferLegacyCategoryId,
  INVENTORY_FALLBACK_CATEGORY_ID,
  normalizeProductCategories,
  RECIPE_FALLBACK_CATEGORY_ID,
  validCategoryId,
  type ProductCategory,
  type ProductCategoryKind,
} from "./lib/product-categories";
import {
  normalizePayrollAdjustments,
  normalizeAttendanceDays,
  normalizePayrollPayments,
  normalizeStaff,
  normalizeWorkShifts,
  type AttendanceDay,
  type PayrollPayment,
  type PayrollAdjustment,
  type StaffMember,
  type WorkShift,
} from "./lib/payroll";
import { calculateDailyReport, costRuleCoversCategory, selectActiveFinancialEntries, validCostRules } from "./lib/daily-report";
import { saleAccountType, reconcileSaleFinancialRateSnapshots } from "./lib/sale-financial-snapshots";
import { validateDailyCloseInput } from "./lib/daily-close";
import { formatExpenseEffectWon } from "./lib/money-format";
import { seoulBusinessDate, seoulCalendarDate } from "./lib/business-time";
import {
  announceHaloStateChange,
  HALO_LIVE_SYNC_INTERVAL_MS,
  rolloverFormDate,
  rolloverSelectedDate,
  stateRevisionChanged,
  subscribeHaloStateChanges,
} from "./lib/live-state";
import { type StockDocument } from "./lib/stock-documents";
import {
  prepareStockImageUpload,
  preparedImageNotice,
  STOCK_IMAGE_ACCEPT,
} from "./lib/image-upload";
import { appendImageToForm, postMultipartJson, type MultipartJsonResult } from "./lib/multipart-upload";
import {
  applyStockMovementToInventory,
  receiptCostsForInventory,
  stockMovementQuantity,
} from "./lib/stock-movements";
import { shouldRetryFailedStateSave } from "./lib/save-retry";
import {
  duplicateEntryConfirmationMessage,
  findPotentialDuplicateEntries,
} from "./lib/duplicate-entry-warning";
import { auditSupplierBalances, rebalanceSuppliers, supplierPurchaseStatuses } from "./lib/supplier-transactions";
import { type SupplierDelivery } from "./lib/supplier-deliveries";
import {
  isMezanaSupplierName,
  hasNegativeMezanaBorrowedQuantity,
  mezanaBorrowedQuantityBalance,
  mezanaDebtActionLabel,
  mezanaDebtBalance,
  mezanaDebtEntryValue,
  normalizeMezanaDebtEntry,
  normalizeMezanaDebtEntries,
  normalizeMezanaSettings,
  validMezanaDebtEntry,
  type MezanaDebtAction,
  type MezanaDebtEntry,
  type MezanaSettings,
} from "./lib/mezana-debts";
import { normalizeMezanaCatalog, type MezanaCatalogItem, type MezanaCatalogMode } from "./lib/mezana-catalog";
import { prepareBatchSales } from "./lib/batch-sales";
import { isAutomaticTaxSale } from "./lib/sale-tax";
import {
  dateIsInRange,
  dateRangeForPreset,
  dateRangeLabel,
  filterDateRange,
  type DateRange,
  type DateRangePreset,
} from "./lib/date-range";
import {
  applyWorkerConsumption,
  INVENTORY_OUTFLOW_REASONS,
  isKitchenConsumptionEntry,
  WorkerConsumptionError,
} from "./lib/worker-consumptions";
import { missingRecipeIngredient, recipeIsSellable } from "./lib/recipe-availability";
import {
  CHICKEN_OIL_CAN_LITERS,
  OIL_PURCHASE_CATEGORY,
  OIL_RESALE_CATEGORY,
  oilLedgerEntries,
  summarizeOilLedger,
  type OilFlowType,
} from "./lib/oil-accounting";
import {
  activeDeletedEntityConflicts,
  createDeletedItem,
  markDeletedItemRestored,
  normalizeDeletedItems,
  prependDeletedItem,
  type DeletedItem,
} from "./lib/deleted-items";
import {
  archivedInventoryMovements,
  reconcileArchivedState,
  selectActiveStockMovements,
} from "./lib/warehouse-consistency";
import {
  canAutomateRecurringExpenseCategory,
  materializeRecurringExpenses,
  nextRecurringExpenseDate,
  nextRecurringExpenseDateAfter,
  recurringExpenseEntryId,
  recurringExpenseTemplateIdentity,
} from "./lib/recurring-expenses";
import {
  calculatePackagedInventory,
  normalizeInventoryPackaging,
} from "./lib/inventory-packaging";
import { normalizeMonthlyCloses, type MonthlyCloseRecord } from "./lib/month-end";
import {
  allocateDeliveryFeeBreakdown,
  calculateDeliveryManualFees,
  deliveryAutomaticManualFees,
  deliveryCombinedPercent,
  withSimpleDeliveryRule,
  emptyDeliveryManualFees,
  deliveryManualFeesForEdit,
  deliveryWonFeesForEdit,
  validDeliveryManualFees,
  groupDeliveryOrders,
  type DeliveryManualFees,
  currentSeoulTimeInputValue,
  deliveryCommissionAmount,
  deliveryCommissionPercent,
  deliveryFeeRuleForPlatform,
  deliveryFeeRuleForOrder,
  deliveryMenuPrice,
  deliveryPlatformLabel,
  deliveryPlatformShortLabel,
  deliverySoldAt,
  DELIVERY_PLATFORMS,
  isDeliveryPlatform,
  isDeliverySale,
  normalizeDeliveryPlatformPrices,
  seoulTimeInputValue,
  type DeliveryFeeBreakdown,
  type DeliveryFeeRule,
  type DeliveryOrderAdjustments,
  type DeliveryPlatformPrices,
  type DeliveryPlatform,
} from "./lib/delivery-sales";
import AppleInstall from "./apple-install";
import ReportExportPanel from "./report-export-panel";
import DeliveryOrderPreview from "./delivery-order-preview";
import {
  type AuditEntry,
  type CostRules,
  type PurchaseOrder,
} from "./control-center";

const BusinessTrendsPanel = lazy(() => import("./business-trends-panel"));
const AssistantPanel = lazy(() => import("./assistant-panel"));
import type { IntakeDraft } from "./intake-panel";
const IntakePanel = lazy(() => import("./intake-panel"));
const ArchiveCenter = lazy(() => import("./archive-center"));
const IntegrationCenter = lazy(() => import("./integration-center"));
const ControlCenter = lazy(() => import("./control-center"));

type Inventory = InventoryAccountingFields & {
  catalogArchived?: boolean;
  catalogArchivedAt?: string;
  catalogArchiveReason?: string;
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  unitCost: number;
  packageName: string;
  unitsPerPackage: number;
  packageCost: number;
  gramsPerUnit: number;
  supplierId: string;
  categoryId: string;
};
type Ingredient = { id?: string; inventoryId: string; name?: string; unit?: string; quantity: number; unitCost?: number; lineCost?: number };
type RecipeDraftIngredient = { id: string; inventoryId: string; name: string; unit: string; quantity: number; lineCost: number };
type RecipeExtraCost = { id: string; name: string; amount: number };
type SaleIngredientUsage = Ingredient & { deductedQuantity?: number; unitCostAtSale?: number; totalCostAtSale?: number };
type Recipe = { id: string; name: string; posCode: string; posAliases: string[]; salePrice: number; deliveryPrices?: DeliveryPlatformPrices; ingredients: Ingredient[]; extraCosts: RecipeExtraCost[]; categoryId: string };
type RecipeDraft = { name: string; posCode: string; salePrice: number; ingredients: RecipeDraftIngredient[]; extraCosts: RecipeExtraCost[]; categoryId: string };
type Supplier = {
  id: string;
  name: string;
  phone: string;
  balance: number;
  balanceEdits?: { id: string; at: string; reason: string; previousBalance: number; balance: number; difference: number; previousOpeningBalance: number; openingBalance: number }[];
  openingBalance?: number;
  bankAccount?: string;
  telegramChatId?: string;
  autoOrder?: boolean;
};
type Transaction = { id: string; supplierId: string; type: "purchase" | "payment"; amount: number; date: string; note: string; accountId?: string; document?: StockDocument };
type Sale = {
  id: string;
  recipeId: string;
  quantity: number;
  unitPrice: number;
  totalRevenue: number;
  revenueSource?: "pos_actual" | "menu_estimate";
  totalCost: number;
  date: string;
  source: "manual" | "pos" | "photo" | "api" | "delivery";
  externalId?: string;
  stockUsage?: SaleIngredientUsage[];
  accountId?: string;
  taxTreatment?: "automatic" | "accountant_managed";
  accountTypeAtSale?: "cash" | "bank" | "card" | "delivery";
  cardCommissionPctAtSale?: number;
  taxPctAtSale?: number;
  deliveryPlatform?: DeliveryPlatform;
  deliveryOrderNumber?: string;
  deliveryBatchId?: string;
  deliveryCommissionPct?: number;
  deliveryCommissionAmount?: number;
  deliveryFeeRule?: DeliveryFeeRule;
  deliveryFeeBreakdown?: DeliveryFeeBreakdown;
  deliveryOrderAdjustments?: DeliveryOrderAdjustments;
  deliveryManualFees?: DeliveryManualFees;
  soldAt?: string;
  createdAt?: string;
  updatedAt?: string;
};
type InventoryOnlyEntry = {
  id: string;
  kind: "inventory_only" | "meal" | "product" | "waste";
  label: string;
  quantity: number;
  unit: string;
  date: string;
  reason: string;
  outflowCategory?: "kitchen_consumption" | "other_inventory_outflow";
  note?: string;
  totalCost: number;
  workerName?: string;
  recipeId?: string;
  inventoryId?: string;
  createdAt?: string;
  items?: Array<{
    recipeId: string;
    name: string;
    quantity: number;
    unitCostAtOutflow?: number;
    totalCostAtOutflow?: number;
    ingredientCostAtOutflow?: number;
    extraCostAtOutflow?: number;
  }>;
  ingredientUsage?: Array<{
    inventoryId: string;
    name: string;
    unit: string;
    quantity: number;
    unitCostAtOutflow?: number;
    totalCostAtOutflow?: number;
  }>;
  costSnapshotVersion?: number;
};
type StockMovement = {
  theoreticalQuantity?: number;
  recordedAt?: string;
  id: string;
  inventoryId: string;
  type: "receipt" | "waste" | "sale" | "adjustment";
  quantity: number;
  date: string;
  note: string;
  referenceId?: string;
  supplierId?: string;
  unitCost?: number;
  previousUnitCost?: number;
  document?: StockDocument;
};
type MoneyAccount = {
  id: string;
  name: string;
  type: "cash" | "bank" | "card" | "delivery";
  openingBalance: number;
};
type FinancialEntry = {
  id: string;
  type: "income" | "expense" | "transfer";
  category: string;
  amount: number;
  date: string;
  accountId: string;
  toAccountId?: string;
  note: string;
  affectsProfit: boolean;
  reversedEntryId?: string;
  transactionId?: string;
  payrollPaymentId?: string;
  fixedExpenseId?: string;
  fixedExpenseDueDate?: string;
  mezanaEntryId?: string;
  intakeId?: string;
  nonCash?: boolean;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  oilFlowType?: OilFlowType;
  oilCanCount?: number;
  oilLiters?: number;
  oilUnitAmount?: number;
};
type DailyClose = {
  id: string;
  date: string;
  expectedByAccount: Record<string, number>;
  actualByAccount: Record<string, number>;
  expectedTotal: number;
  actualTotal: number;
  difference: number;
  grossProfit: number;
  operatingExpenses: number;
  netProfit: number;
  note: string;
  closedAt: string;
};
type FixedExpense = {
  id: string;
  name: string;
  category: string;
  amount: number;
  accountId: string;
  frequency: "daily" | "weekly" | "monthly";
  nextDue: string;
  active: boolean;
  lastPaidDate?: string;
  automatic?: boolean;
  billingDay?: number;
};
type TelegramSettings = {
  configured: boolean;
  tokenSaved: boolean;
  chatId: string;
  botName: string;
  enabled: boolean;
  reportTime: string;
  lastSentDate: string;
  lastSentAt: string;
  deliveryStatus?: { status: string; report_date: string; last_error: string } | null;
};
type Branch = {
  id: string;
  name: string;
  address: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  archivedReason?: string;
  archivedAt?: string;
  archivedBy?: string;
};
type AppState = {
  productCategories: ProductCategory[];
  inventory: Inventory[];
  recipes: Recipe[];
  suppliers: Supplier[];
  transactions: Transaction[];
  supplierDeliveries: SupplierDelivery[];
  mezanaCatalog: MezanaCatalogItem[];
  mezanaEntries: MezanaDebtEntry[];
  mezanaSettings: MezanaSettings;
  workerConsumptions: Array<Record<string, unknown>>;
  posOrders: Array<Record<string, unknown>>;
  sales: Sale[];
  stockMovements: StockMovement[];
  warehouseRevisions: Array<Record<string, any>>;
  accounts: MoneyAccount[];
  financialEntries: FinancialEntry[];
  dailyCloses: DailyClose[];
  fixedExpenses: FixedExpense[];
  purchaseOrders: PurchaseOrder[];
  staff: StaffMember[];
  workShifts: WorkShift[];
  payrollAdjustments: PayrollAdjustment[];
  attendanceDays: AttendanceDay[];
  payrollPayments: PayrollPayment[];
  monthlyCloses: MonthlyCloseRecord[];
  deletedItems: DeletedItem[];
  costRules: CostRules;
  auditLog: AuditEntry[];
  updatedAt?: string;
};
type Tab = "vegetables" | "intake" | "dashboard" | "inventory" | "recipes" | "sales" | "deliverysales" | "cashbank" | "cashsales" | "oil" | "mezana" | "fees" | "expenses" | "finance" | "reports" | "suppliers" | "control" | "integrations" | "archive";
type AnalysisTab = "inventory" | "recipes" | "sales" | "deliverysales" | "cashbank" | "cashsales" | "oil" | "mezana" | "fees" | "expenses" | "finance" | "reports" | "suppliers";
type UserMode = "owner" | "employee";
type RemovedOcrRow = { row: PosRawRow; index: number; issue?: OcrReviewIssue };
type WarehouseDeleteResult = {
  ok: boolean;
  error?: string;
  alreadyDeleted?: boolean;
  detachedMovementCount?: number;
};

const TAB_IDS: readonly Tab[] = [
  "vegetables", "intake",
  "dashboard", "inventory", "recipes", "sales", "deliverysales", "cashbank", "cashsales",
  "oil", "mezana", "fees", "expenses", "finance", "reports", "suppliers", "control",
  "integrations", "archive",
];
const isTab = (value: string | null): value is Tab => Boolean(value && TAB_IDS.includes(value as Tab));
const isIsoDate = (value: string | null): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const defaultAccounts: MoneyAccount[] = [
  { id: "account-cash", name: "Naqd kassa", type: "cash", openingBalance: 0 },
  { id: "account-bank", name: "Bank", type: "bank", openingBalance: 0 },
  { id: "account-card", name: "Karta / POS", type: "card", openingBalance: 0 },
  { id: "account-delivery", name: "Yetkazib berish", type: "delivery", openingBalance: 0 },
];
const ANALYSIS_TABS: AnalysisTab[] = ["inventory", "recipes", "sales", "deliverysales", "cashbank", "cashsales", "oil", "mezana", "fees", "expenses", "finance", "reports", "suppliers"];
const expenseCategories = [
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
];
const emptyState: AppState = {
  productCategories: DEFAULT_PRODUCT_CATEGORIES.map((category) => ({ ...category })),
  inventory: [],
  recipes: [],
  suppliers: [],
  transactions: [],
  supplierDeliveries: [],
  mezanaCatalog: [],
  mezanaEntries: [],
  mezanaSettings: {
    telegramChatId: "",
    telegramChatName: "",
    telegramThreadId: 0,
    purchasedTelegramChatId: "",
    purchasedTelegramChatName: "",
    purchasedTelegramThreadId: 0,
  },
  workerConsumptions: [],
  posOrders: [],
  sales: [],
  stockMovements: [],
  warehouseRevisions: [],
  accounts: defaultAccounts,
  financialEntries: [],
  dailyCloses: [],
  fixedExpenses: [],
  purchaseOrders: [],
  staff: [],
  workShifts: [],
  payrollAdjustments: [],
  attendanceDays: [],
  payrollPayments: [],
  monthlyCloses: [],
  deletedItems: [],
  costRules: {
    cardCommissionPct: 0,
    deliveryCommissionPct: 0,
    taxPct: 0,
  },
  auditLog: [],
};
const emptyRecipeDraft = (): RecipeDraft => ({
  name: "",
  posCode: "",
  salePrice: 0,
  categoryId: RECIPE_FALLBACK_CATEGORY_ID,
  ingredients: [{ id: id("draft-ing"), inventoryId: "", name: "", unit: "g", quantity: 0, lineCost: 0 }],
  extraCosts: [],
});
const emptyStockForm = () => ({
  name: "",
  unit: "g",
  packageName: "pachka",
  packageCount: 0,
  date: "",
  unitsPerPackage: 1,
  packageCost: 0,
  gramsPerUnit: 0,
  minStock: 0,
  supplierId: "",
  categoryId: INVENTORY_FALLBACK_CATEGORY_ID,
});
const normalizeMoneyAccounts = (value: MoneyAccount[] | undefined) => {
  const accounts = Array.isArray(value) && value.length ? value.map((account) => ({ ...account })) : defaultAccounts.map((account) => ({ ...account }));
  defaultAccounts.forEach((fallback) => {
    if (!accounts.some((account) => account.type === fallback.type)) accounts.push({ ...fallback });
  });
  return accounts;
};
const normalizeAppState = (value: Partial<AppState>): AppState => {
  const productCategories = normalizeProductCategories(value.productCategories);
  const inventory = (Array.isArray(value.inventory) ? value.inventory : []).map((item) => {
    const packaging = normalizeInventoryPackaging(item);
    return {
      ...item,
      ...packaging,
      categoryId: validCategoryId(
        productCategories,
        "inventory",
        item.categoryId || inferLegacyCategoryId("inventory", item.name),
      ),
    };
  });
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const normalized: AppState = {
  productCategories,
  inventory,
  recipes: ensureMenuCodes(Array.isArray(value.recipes)
    ? value.recipes.map((recipe) => ({
      ...recipe,
      deliveryPrices: normalizeDeliveryPlatformPrices(recipe.deliveryPrices),
      categoryId: validCategoryId(
        productCategories,
        "recipe",
        recipe.categoryId || inferLegacyCategoryId("recipe", recipe.name),
      ),
      ingredients: linkRecipeIngredientsToInventory(Array.isArray(recipe.ingredients) ? recipe.ingredients.map((ingredient, ingredientIndex) => {
        const inventoryItem = inventoryById.get(ingredient.inventoryId);
        return {
          ...ingredient,
          id: ingredient.id || `ingredient-${recipe.id}-${ingredientIndex}`,
          inventoryId: String(ingredient.inventoryId || ""),
          name: String(ingredient.name || inventoryItem?.name || `Ingredient ${ingredientIndex + 1}`).trim().slice(0, 80),
          unit: String(ingredient.unit || inventoryItem?.unit || "g").trim().slice(0, 20),
          quantity: Number(ingredient.quantity),
          ...(Number.isFinite(Number(ingredient.unitCost)) ? { unitCost: Number(ingredient.unitCost) } : {}),
        };
      }) : [], inventory),
      extraCosts: Array.isArray(recipe.extraCosts)
        ? recipe.extraCosts.filter((extraCost) => (
          extraCost
          && typeof extraCost.name === "string"
          && extraCost.name.trim()
          && Number.isFinite(Number(extraCost.amount))
          && Number(extraCost.amount) > 0
        )).map((extraCost, extraCostIndex) => ({
          id: String(extraCost.id || `cost-${recipe.id}-${extraCostIndex}`),
          name: extraCost.name.trim().slice(0, 80),
          amount: Number(extraCost.amount),
        }))
        : [],
    }))
    : []),
  suppliers: Array.isArray(value.suppliers) ? value.suppliers : [],
  transactions: Array.isArray(value.transactions) ? value.transactions : [],
  supplierDeliveries: Array.isArray(value.supplierDeliveries) ? value.supplierDeliveries : [],
  mezanaCatalog: normalizeMezanaCatalog(value.mezanaCatalog),
  mezanaEntries: normalizeMezanaDebtEntries(value.mezanaEntries),
  mezanaSettings: normalizeMezanaSettings(value.mezanaSettings),
  workerConsumptions: Array.isArray(value.workerConsumptions) ? value.workerConsumptions : [],
  posOrders: Array.isArray(value.posOrders) ? value.posOrders : [],
  sales: Array.isArray(value.sales) ? value.sales : [],
  stockMovements: Array.isArray(value.stockMovements) ? value.stockMovements : [],
  warehouseRevisions: Array.isArray(value.warehouseRevisions) ? value.warehouseRevisions : [],
  accounts: normalizeMoneyAccounts(value.accounts),
  financialEntries: Array.isArray(value.financialEntries) ? value.financialEntries : [],
  dailyCloses: Array.isArray(value.dailyCloses) ? value.dailyCloses : [],
  fixedExpenses: Array.isArray(value.fixedExpenses) ? value.fixedExpenses.map((expense) => ({
    ...expense,
    automatic: expense.automatic === true,
    ...(Number.isInteger(expense.billingDay) && Number(expense.billingDay) >= 1 && Number(expense.billingDay) <= 31
      ? { billingDay: Number(expense.billingDay) }
      : {}),
  })) : [],
  purchaseOrders: Array.isArray(value.purchaseOrders) ? value.purchaseOrders : [],
  staff: normalizeStaff(value.staff),
  workShifts: normalizeWorkShifts(value.workShifts),
  payrollAdjustments: normalizePayrollAdjustments(value.payrollAdjustments),
  attendanceDays: normalizeAttendanceDays(value.attendanceDays),
  payrollPayments: normalizePayrollPayments(value.payrollPayments),
  monthlyCloses: normalizeMonthlyCloses(value.monthlyCloses),
  deletedItems: normalizeDeletedItems(value.deletedItems),
  costRules: value.costRules && typeof value.costRules === "object"
    ? value.costRules
    : { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
  auditLog: Array.isArray(value.auditLog) ? value.auditLog : [],
  updatedAt: value.updatedAt,
  };
  return reconcileArchivedState(normalized).state;
};
const sameStoredState = (left: AppState, right: AppState) => {
  const storedJson = (value: AppState) => JSON.stringify(value, (key, nestedValue) => (
    key === "updatedAt" || key === "auditLog" ? undefined : nestedValue
  ));
  return storedJson(left) === storedJson(right);
};
const withClientSaleFinancialSnapshots = (current: AppState, next: AppState): AppState => ({
  ...next,
  sales: reconcileSaleFinancialRateSnapshots(
    current.sales,
    next.sales,
    current.accounts,
    current.costRules,
    next.accounts,
    next.costRules,
  ) as Sale[],
});
const emptyPosMapping: PosColumnMapping = { product: "", productCode: "", quantity: "", total: "", discount: "", date: "", externalId: "" };
const tabSection: Record<Tab, string> = {
  vegetables: "Sabzavot va sous sarfi",
  intake: "Xarid / kirim",
  dashboard: "Bugun",
  inventory: "Ombor",
  recipes: "Retsept va marja",
  sales: "POS savdo",
  deliverysales: "Delivery savdo",
  cashbank: "Naqd va hisob-raqam savdosi",
  cashsales: "Yeyilgan va chiqimlar",
  oil: "Chicken moyi",
  mezana: "MEZANA",
  fees: "Soliq va ushlanmalar",
  expenses: "Xarajatlar",
  finance: "Hisob-kitob",
  reports: "Hisobot",
  suppliers: "Oldi-berdi",
  control: "Oy yakuni va boshqaruv",
  integrations: "API va ulanishlar",
  archive: "Bekor qilinganlar",
};
const tabHelp: Record<Tab, string> = {
  vegetables: "Xarid, taxminiy qoldiq va bog‘langan taomlar bo‘yicha sarf tahlili",
  intake: "Mahsulot, miqdor va narx · qarz va to‘lov alohida",
  dashboard: "Bugungi savdo, foyda va bajariladigan ishlar",
  inventory: "Mahsulot kirimi, qoldiq va chiqindilar",
  recipes: "Har bir taomning tannarxi, narxi va marjasi",
  sales: "Excel, chek rasmi yoki qo‘lda kiritilgan soliq hisoblanadigan POS savdo",
  deliverysales: "Coupang Eats, Baemin va Yogiyo savdolarini POS’dan alohida boshqarish",
  cashbank: "Naqd va hisob-raqam savdolarini alohida ko‘rish",
  cashsales: "Yeyilgan taomlar va ombordan chiqqan mahsulotlarni sana bo‘yicha tahlil qilish",
  oil: "18 L yangi moy xarajati va ishlatilgan moy qayta sotuv kirimini alohida hisoblash",
  mezana: "MEZANA xaridlari, olib turilgan va qaytarilgan mahsulotlar, ixtiyoriy rasmlar hamda alohida Telegram guruhi",
  fees: "POS va delivery ushlanmalari, soliq hisoboti",
  expenses: "Bir martalik va doimiy xarajatlar",
  finance: "Kassa, bank, o‘tkazmalar va kunni yopish",
  reports: "Kunlik va oylik natijalarni tahlil qilish",
  suppliers: "Yetkazib beruvchilar, xaridlar va qarzlar",
  control: "Oy yakuni, xodimlar, nazorat va xavfsizlik sozlamalari",
  integrations: "Boshqa POS va dasturlar bilan xavfsiz ma’lumot almashish",
  archive: "Sabab, kim, vaqt, bekor qilingan yozuvlar va tiklash tarixi",
};
const haloMenuUrl = "https://halo-digital-menu.uzbusinessman7.chatgpt.site";
const won = (value: number) => `₩${Math.round(value).toLocaleString("en-US")}`;
const mezanaEntryValue = mezanaDebtEntryValue;
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const localDate = seoulCalendarDate;
const businessDate = seoulBusinessDate;
const displayDate = (value: string) => {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
};
const displayRecordTime = (value: unknown) => {
  const timestamp = String(value || "");
  if (!Number.isFinite(Date.parse(timestamp))) return "—";
  return new Date(timestamp).toLocaleTimeString("uz-UZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
};
const safeOutflowNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const isKitchenOutflow = (entry: InventoryOnlyEntry) => (
  isKitchenConsumptionEntry(entry as unknown as Record<string, unknown>)
);
const outflowDishItems = (entry: InventoryOnlyEntry) => {
  const savedItems = Array.isArray(entry.items) ? entry.items.flatMap((item) => {
    const quantity = safeOutflowNumber(item?.quantity);
    const name = String(item?.name || entry.label || "Taom").trim();
    return quantity && name ? [{
      recipeId: String(item?.recipeId || ""),
      name,
      quantity,
      totalCostAtOutflow: safeOutflowNumber(item?.totalCostAtOutflow),
    }] : [];
  }) : [];
  if (savedItems.length) return savedItems;
  const quantity = safeOutflowNumber(entry.quantity);
  if (entry.recipeId && quantity) return [{
    recipeId: entry.recipeId,
    name: String(entry.label || "Taom"),
    quantity,
    totalCostAtOutflow: safeOutflowNumber(entry.totalCost),
  }];
  return [];
};
const outflowReasonLabel = (entry: InventoryOnlyEntry) => {
  if (isKitchenOutflow(entry)) return "Oshxonada yeyilgan";
  if (entry.kind === "product") return "Mahsulot chiqimi";
  if (entry.kind === "waste") return String(entry.reason || "Isrof / chiqindi");
  return String(entry.reason || "Boshqa ombor chiqimi");
};
const daysBetween = (newer: string, older: string) => Math.floor(
  (new Date(`${newer}T12:00:00`).getTime() - new Date(`${older}T12:00:00`).getTime()) / 86_400_000,
);
const nextExpenseDate = (value: string, frequency: FixedExpense["frequency"], billingDay?: number) => {
  if (frequency === "monthly") return nextRecurringExpenseDate(value, billingDay || Number(value.slice(8, 10)));
  const date = new Date(`${value}T12:00:00`);
  if (frequency === "daily") date.setDate(date.getDate() + 1);
  if (frequency === "weekly") date.setDate(date.getDate() + 7);
  return localDate(date);
};

function largestRun(values: number[], threshold: number) {
  let bestStart = 0;
  let bestEnd = values.length;
  let start = -1;
  for (let index = 0; index <= values.length; index += 1) {
    const active = index < values.length && values[index] >= threshold;
    if (active && start < 0) start = index;
    if (!active && start >= 0) {
      if (index - start > bestEnd - bestStart || bestEnd === values.length) {
        bestStart = start;
        bestEnd = index;
      }
      start = -1;
    }
  }
  return { start: bestStart, end: bestEnd };
}

function detectReceiptBounds(image: HTMLImageElement) {
  const analysisScale = Math.min(1, 1_000 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * analysisScale));
  const height = Math.max(1, Math.round(image.naturalHeight * analysisScale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const columnScores = new Array<number>(width).fill(0);
  const rowScores = new Array<number>(height).fill(0);
  const step = Math.max(1, Math.floor(Math.max(width, height) / 900));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const light = red * 0.299 + green * 0.587 + blue * 0.114;
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
      if (light >= 125 && spread <= 58) {
        columnScores[x] += 1;
        rowScores[y] += 1;
      }
    }
  }
  const sampledRows = Math.ceil(height / step);
  const sampledColumns = Math.ceil(width / step);
  const xRun = largestRun(columnScores, sampledRows * 0.24);
  const yRun = largestRun(rowScores, sampledColumns * 0.24);
  const detectedWidth = xRun.end - xRun.start;
  const detectedHeight = yRun.end - yRun.start;
  const useful = detectedWidth >= width * 0.28 && detectedHeight >= height * 0.35;
  if (!useful) return { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };

  const paddingX = Math.round(detectedWidth * 0.035);
  const paddingY = Math.round(detectedHeight * 0.025);
  const left = Math.max(0, xRun.start - paddingX);
  const top = Math.max(0, yRun.start - paddingY);
  const right = Math.min(width, xRun.end + paddingX);
  const bottom = Math.min(height, yRun.end + paddingY);
  return {
    x: Math.round(left / analysisScale),
    y: Math.round(top / analysisScale),
    width: Math.max(1, Math.round((right - left) / analysisScale)),
    height: Math.max(1, Math.round((bottom - top) / analysisScale)),
  };
}

function prepareOkposTableColumnCrop(
  source: HTMLCanvasElement,
  leftRatio: number,
  rightRatio: number,
  topRatio = 0.117,
  bottomRatio = 0.872,
  scale = 1,
  threshold = 0,
) {
  const left = Math.floor(source.width * leftRatio);
  const top = Math.floor(source.height * topRatio);
  const right = Math.max(left + 1, Math.floor(source.width * rightRatio));
  const bottom = Math.max(top + 1, Math.floor(source.height * bottomRatio));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((right - left) * scale));
  canvas.height = Math.max(1, Math.round((bottom - top) * scale));
  const context = canvas.getContext("2d", { willReadFrequently: threshold > 0 });
  if (!context) return canvas;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    source,
    left,
    top,
    right - left,
    bottom - top,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  if (threshold > 0) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const grey = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
      const value = grey >= threshold ? 255 : 0;
      pixels.data[index] = value;
      pixels.data[index + 1] = value;
      pixels.data[index + 2] = value;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

async function prepareImageForOcr(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Rasm ochilmadi"));
      element.src = url;
    });
    const bounds = detectReceiptBounds(image);
    const nativeReceipt = document.createElement("canvas");
    nativeReceipt.width = Math.max(1, bounds.width);
    nativeReceipt.height = Math.max(1, bounds.height);
    const nativeContext = nativeReceipt.getContext("2d");
    if (!nativeContext) throw new Error("Asl chek tasviri tayyorlanmadi");
    nativeContext.imageSmoothingEnabled = true;
    nativeContext.imageSmoothingQuality = "high";
    nativeContext.drawImage(
      image,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      nativeReceipt.width,
      nativeReceipt.height,
    );
    // Long receipts need a readable short side. The old path never enlarged a
    // small receipt inside a large phone photo, so quantities disappeared.
    const baseScale = bounds.width < 1_200
      ? Math.min(3, 1_200 / bounds.width)
      : Math.min(1, 1_400 / bounds.width);
    const scale = Math.max(0.1, Math.min(
      baseScale,
      Math.sqrt(3_600_000 / (bounds.width * bounds.height)),
      3_600 / bounds.height,
    ));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bounds.width * scale));
    canvas.height = Math.max(1, Math.round(bounds.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Rasm tayyorlanmadi");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    // Landscape OKPOS reports contain thin grid lines and red footer digits.
    // Preserve one clean-color copy before the thermal-receipt contrast pass;
    // contrast conversion can fade that footer and make a table look partial.
    const tableImage = canvas.width > canvas.height ? document.createElement("canvas") : null;
    if (tableImage) {
      tableImage.width = canvas.width;
      tableImage.height = canvas.height;
      const tableContext = tableImage.getContext("2d");
      if (!tableContext) throw new Error("OKPOS jadvali tasviri tayyorlanmadi");
      tableContext.imageSmoothingEnabled = true;
      tableContext.imageSmoothingQuality = "high";
      tableContext.drawImage(canvas, 0, 0);
    }
    const tableCodeImage = tableImage
      ? prepareOkposTableColumnCrop(tableImage, 0.09, 0.325, 0.04, 0.97, 3, 209)
      : null;
    const tableQuantityImage = tableImage
      ? prepareOkposTableColumnCrop(tableImage, 0.69, 0.765, 0.04, 0.97, 4, 209)
      : null;

    // Thermal-printer numerals must not use photographic interpolation. On
    // the real OKPOS receipt the smoothed 1200px copy closed the inner stroke
    // of 9 and made 109,020 look like 108,020 in every full-column pass.
    // Keep a pixel-preserving copy only for numeric OCR; names still use the
    // high-quality canvas above because it reads the Latin/Korean text better.
    const numericSource = document.createElement("canvas");
    numericSource.width = canvas.width;
    numericSource.height = canvas.height;
    const numericSourceContext = numericSource.getContext("2d");
    if (!numericSourceContext) throw new Error("Raqamlar tasviri tayyorlanmadi");
    numericSourceContext.imageSmoothingEnabled = false;
    numericSourceContext.drawImage(
      image,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      numericSource.width,
      numericSource.height,
    );

    // Keep clean copies of the numeric column and footer before the mixed-text
    // contrast pass. The numeric pass deliberately ignores letters and is much
    // less likely to turn 109,020 into 108,020.
    const numbersImage = prepareReceiptNumbersCrop(numericSource);
    const numbersVerificationImage = prepareReceiptNumbersVerificationCrop(numericSource);
    const productsImage = prepareReceiptProductsCrop(canvas);
    const nativeNumbersImage = prepareReceiptNumbersCrop(nativeReceipt);
    const summaryImage = prepareReceiptSummaryCrop(nativeReceipt);
    numericSource.width = 0;
    numericSource.height = 0;
    nativeReceipt.width = 0;
    nativeReceipt.height = 0;

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    let brightness = 0;
    const stride = Math.max(4, Math.floor(pixels.data.length / 80_000 / 4) * 4);
    for (let index = 0; index < pixels.data.length; index += stride) {
      brightness += (pixels.data[index] + pixels.data[index + 1] + pixels.data[index + 2]) / 3;
    }
    const samples = Math.ceil(pixels.data.length / stride);
    const invert = brightness / Math.max(1, samples) < 105;
    for (let index = 0; index < pixels.data.length; index += 4) {
      let grey = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
      if (invert) grey = 255 - grey;
      grey = Math.max(0, Math.min(255, (grey - 128) * 1.38 + 128));
      pixels.data[index] = grey;
      pixels.data[index + 1] = grey;
      pixels.data[index + 2] = grey;
    }
    context.putImageData(pixels, 0, 0);
    return {
      image: canvas,
      tableImage,
      tableCodeImage,
      tableQuantityImage,
      numbersImage,
      numbersVerificationImage,
      nativeNumbersImage,
      productsImage,
      summaryImage,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function prepareReceiptNumbersCrop(source: HTMLCanvasElement) {
  const left = Math.floor(source.width * 0.5);
  const top = Math.floor(source.height * 0.143);
  const right = Math.max(left + 1, Math.floor(source.width * 0.992));
  const bottom = Math.max(top + 1, Math.floor(source.height * 0.9665));
  const canvas = document.createElement("canvas");
  canvas.width = right - left;
  canvas.height = bottom - top;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function prepareReceiptNumbersVerificationCrop(source: HTMLCanvasElement) {
  // This pass intentionally uses a narrower crop and a separate gamma transform.
  // It is independent from the two clean-color layout passes, so a correlated
  // PSM error cannot silently approve a wrong row merely because the footer adds up.
  const left = Math.floor(source.width * 0.55);
  const top = Math.floor(source.height * 0.143);
  const right = Math.max(left + 1, Math.floor(source.width * 0.992));
  const bottom = Math.max(top + 1, Math.floor(source.height * 0.9665));
  const canvas = document.createElement("canvas");
  canvas.width = right - left;
  canvas.height = bottom - top;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const gamma = 0.9;
  const lookup = Array.from({ length: 256 }, (_, value) => (
    Math.max(0, Math.min(255, Math.round(255 * ((value / 255) ** (1 / gamma)))))
  ));
  for (let index = 0; index < pixels.data.length; index += 4) {
    pixels.data[index] = lookup[pixels.data[index]];
    pixels.data[index + 1] = lookup[pixels.data[index + 1]];
    pixels.data[index + 2] = lookup[pixels.data[index + 2]];
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function prepareReceiptProductsCrop(source: HTMLCanvasElement) {
  const top = Math.floor(source.height * 0.143);
  const right = Math.max(1, Math.floor(source.width * 0.55));
  const bottom = Math.max(top + 1, Math.floor(source.height * 0.9665));
  const canvas = document.createElement("canvas");
  canvas.width = right;
  canvas.height = bottom - top;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, top, right, canvas.height, 0, 0, right, canvas.height);
  return canvas;
}

function prepareReceiptSummaryCrop(source: HTMLCanvasElement) {
  // OKPOS prints the grand total on one narrow line near the bottom. Keeping
  // WATER/the separators in this crop made 298 look like 208 and 2,775,900
  // look like 2,775,800 on the real phone photo. Read only that physical line
  // from the native-resolution receipt.
  const left = Math.floor(source.width * 0.49);
  const top = Math.floor(source.height * 0.863);
  const right = Math.max(left + 1, Math.floor(source.width * 0.865));
  const bottom = Math.max(top + 1, Math.floor(source.height * 0.89));
  const canvas = document.createElement("canvas");
  canvas.width = (right - left) * 2;
  canvas.height = (bottom - top) * 2;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, left, top, right - left, bottom - top, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const grey = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
    const value = grey < 150 ? 0 : 255;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function numericLinePlans(tsv: string) {
  return parseOcrTsvLines(tsv).filter((line) => parseNumericOcrPairs(line.text).length === 1);
}

function prepareNumericLineCrop(
  source: HTMLCanvasElement,
  reference: HTMLCanvasElement,
  line: ReturnType<typeof parseOcrTsvLines>[number],
  threshold: number,
) {
  const scaleX = source.width / Math.max(1, reference.width);
  const scaleY = source.height / Math.max(1, reference.height);
  // Keep this crop inside one physical row. A taller crop mixed the previous
  // and next lines; narrow horizontal padding cut the first/last digit.
  const sourceTop = Math.max(0, Math.floor((line.top - line.height * 0.15) * scaleY));
  const sourceBottom = Math.min(source.height, Math.ceil((line.top + line.height * 1.15) * scaleY));
  const sourceLeft = Math.max(0, Math.floor((line.left - 60) * scaleX));
  const sourceRight = Math.min(source.width, Math.ceil((line.left + line.width + 60) * scaleX));
  const sourceWidth = Math.max(1, sourceRight - sourceLeft);
  const sourceHeight = Math.max(1, sourceBottom - sourceTop);
  const lineScale = Math.max(1, Math.min(2, 900 / sourceWidth, 140 / sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * lineScale));
  canvas.height = Math.max(1, Math.round(sourceHeight * lineScale));
  const context = canvas.getContext("2d", { willReadFrequently: threshold > 0 });
  if (!context) return canvas;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, sourceLeft, sourceTop, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  if (threshold > 0) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const grey = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
      // Thermal-receipt digits can have a faint inner stroke. A high cutoff
      // erased the tail of 9 in 109,020 and repeatedly turned it into 108,020.
      // The low-cutoff pass deliberately differs from the clean/full-column
      // passes and preserves that physical stroke on the real OKPOS receipt.
      const value = grey < threshold ? 0 : 255;
      pixels.data[index] = value;
      pixels.data[index + 1] = value;
      pixels.data[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

type SectionMetric = {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "warning";
};

function SectionDateAnalysis({
  title,
  range,
  referenceDate,
  metrics,
  onChange,
}: {
  title: string;
  range: DateRange;
  referenceDate: string;
  metrics: SectionMetric[];
  onChange: (range: DateRange) => void;
}) {
  const presets: Array<{ id: DateRangePreset; label: string }> = [
    { id: "today", label: "Bugun" },
    { id: "7d", label: "7 kun" },
    { id: "30d", label: "30 kun" },
    { id: "month", label: "Shu oy" },
    { id: "all", label: "Barchasi" },
  ];
  return <section className="section-date-analysis" aria-label={`${title} sana bo‘yicha tahlili`}>
    <div className="section-date-analysis-head">
      <div><span>ALOHIDA MA’LUMOT · SANA TAHLILI</span><h2>{title}</h2><small>{dateRangeLabel(range)} · Bu filtr faqat shu bo‘limga ta’sir qiladi.</small></div>
      <div className="section-date-presets" role="group" aria-label="Tahlil davrini tanlash">{presets.map((preset) => <button type="button" className={range.preset === preset.id ? "active" : ""} key={preset.id} onClick={() => onChange(dateRangeForPreset(referenceDate, preset.id))}>{preset.label}</button>)}</div>
    </div>
    <div className="section-date-single">
      <label><span>Bitta kunni alohida ko‘rish</span><input aria-label="Tahlil qilinadigan kun" type="date" value={range.start === range.end ? range.start : ""} onChange={(event) => event.target.value && onChange({ start: event.target.value, end: event.target.value, preset: "custom" })} /></label>
      <span><b>{range.start === range.end ? "Faqat shu kun ko‘rsatilmoqda" : "Kalendar orqali kun tanlang"}</b><small>Kun tanlanishi bilan savdo va barcha hisoblar darhol yangilanadi.</small></span>
    </div>
    <details className="section-date-range-more">
      <summary>Bir necha kunlik tahlilni ochish</summary>
      <div className="section-date-custom">
        <label><span>Boshlanish</span><input type="date" value={range.start} disabled={range.preset === "all"} onChange={(event) => onChange({ start: event.target.value, end: event.target.value, preset: "custom" })} /></label>
        <i>→</i>
        <label><span>Tugash</span><input type="date" value={range.end} disabled={range.preset === "all"} onChange={(event) => onChange({ start: range.start || event.target.value, end: event.target.value, preset: "custom" })} /></label>
      </div>
    </details>
    <div className="section-date-metrics">{metrics.map((metric) => <article className={metric.tone || ""} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></article>)}</div>
  </section>;
}

function revealInventorySection(elementId: string) {
  const element = document.getElementById(elementId);
  if (!element) return;
  document.querySelectorAll<HTMLDetailsElement>('.inventory-workflow[open]').forEach(section => {
    if (!section.contains(element)) section.open = false;
  });
  let parent: HTMLElement | null = element;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  window.requestAnimationFrame(() => element.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

export default function Home() {
  const [data, setData] = useState<AppState>(emptyState);
  const [adminAccess, setAdminAccess] = useState<"checking" | "authorized" | "denied" | "error">("checking");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState("main");
  const activeBranchRef = useRef("main");
  const serverRevisionRef = useRef("");
  const recurringReconcileAtRef = useRef(0);
  const saveActionLocksRef = useRef(new Map<string, Promise<boolean>>());
  const serverStateRef = useRef<AppState>(emptyState);
  const localStateRef = useRef<AppState>(emptyState);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const failedSaveRef = useRef<{ patch: StatePatch; action: string; branchId: string } | null>(null);
  const lastSaveErrorRef = useRef("");
  const ownerMezanaOperationIdRef = useRef("");
  const ownerMezanaSavingRef = useRef(false);
  const mezanaTelegramBusyRef = useRef(false);
  const branchTransitionRef = useRef(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [userMode] = useState<UserMode>("owner");
  const [status, setStatus] = useState("Yuklanmoqda…");
  const [today, setToday] = useState(() => businessDate());
  const previousBusinessDateRef = useRef(today);
  const [sectionDateRanges, setSectionDateRanges] = useState<Record<AnalysisTab, DateRange>>(() => Object.fromEntries(
    ANALYSIS_TABS.map((section) => [section, dateRangeForPreset(businessDate(), "month")]),
  ) as Record<AnalysisTab, DateRange>);
  const [stockForm, setStockForm] = useState(emptyStockForm);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [editingInventoryId, setEditingInventoryId] = useState("");
  const [stockNotice, setStockNotice] = useState("");
  const [stockSaving, setStockSaving] = useState(false);
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget|null>(null);
  const [warehouseEditingId, setWarehouseEditingId] = useState("");
  const [inventoryArchiveTarget, setInventoryArchiveTarget] = useState<Inventory|null>(null);
  const [inventoryDeletionBusy, setInventoryDeletionBusy] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryStockFilter, setInventoryStockFilter] = useState<"all" | "low" | "ready">("all");
  const [inventoryCountOpen, setInventoryCountOpen] = useState(false);
  const [inventoryCountSupplierId, setInventoryCountSupplierId] = useState("all");
  const [inventoryReceiptSupplierId, setInventoryReceiptSupplierId] = useState("all");
  const [inventoryCountValues, setInventoryCountValues] = useState<Record<string, string>>({});
  const [inventoryCountNotice, setInventoryCountNotice] = useState("");
  const [inventoryCountSaving, setInventoryCountSaving] = useState(false);
  const [movementForm, setMovementForm] = useState({ inventoryId: "", type: "receipt" as "receipt" | "waste" | "adjustment", quantity: 0, unitCost: 0, supplierId: "", date: today, note: "" });
  const [movementNotice, setMovementNotice] = useState("");
  const [editingMovementId, setEditingMovementId] = useState("");
  const [movementDocumentFile, setMovementDocumentFile] = useState<File | null>(null);
  const [movementDocumentPreview, setMovementDocumentPreview] = useState("");
  const [removeMovementDocument, setRemoveMovementDocument] = useState(false);
  const [movementFileInputKey, setMovementFileInputKey] = useState(0);
  const [movementSaving, setMovementSaving] = useState(false);
  const [movementDeletionBusy, setMovementDeletionBusy] = useState("");
  const [stockHistoryLimit, setStockHistoryLimit] = useState(80);
  const [salesHistoryLimit, setSalesHistoryLimit] = useState(100);
  const [deliveryHistoryLimit, setDeliveryHistoryLimit] = useState(100);
  const [expenseHistoryLimit, setExpenseHistoryLimit] = useState(100);
  const [financeHistoryLimit, setFinanceHistoryLimit] = useState(100);
  const [closeHistoryLimit, setCloseHistoryLimit] = useState(100);
  const [transactionHistoryLimit, setTransactionHistoryLimit] = useState(100);
  const [supplierInvoiceLimit, setSupplierInvoiceLimit] = useState(100);
  const [supplierInvoiceSearch, setSupplierInvoiceSearch] = useState("");
  const [supplierInvoiceStatus, setSupplierInvoiceStatus] = useState<"all" | "unpaid" | "paid">("all");
  const [supplierProductViewId, setSupplierProductViewId] = useState("");
  const [supplierForm, setSupplierForm] = useState({ name: "", phone: "", bankAccount: "" });
  const [supplierCreateOpen, setSupplierCreateOpen] = useState(false);
  const [supplierTransactionOpen, setSupplierTransactionOpen] = useState(true);
  const [editingSupplierId, setEditingSupplierId] = useState("");
  const [debtEdit, setDebtEdit] = useState<{ branchId: string; supplierId: string; id: string; balance: string; reason: string; expectedBalance: number; expectedOpeningBalance: number } | null>(null);
  const [debtSaving, setDebtSaving] = useState(false);
  const [debtNotice, setDebtNotice] = useState("");
  const [supplierEditForm, setSupplierEditForm] = useState({ name: "", phone: "", bankAccount: "" });
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierNotice, setSupplierNotice] = useState("");
  const [supplierPaymentAccounts, setSupplierPaymentAccounts] = useState<Record<string, string>>({});
  const [supplierPaymentBusy, setSupplierPaymentBusy] = useState("");
  const supplierFullPaymentOperationIdsRef = useRef<Record<string, string>>({});
  const [editingMezanaId, setEditingMezanaId] = useState("");
  const [mezanaEditForm, setMezanaEditForm] = useState({ action: "borrowed" as MezanaDebtAction, productName: "", quantity: 0, amount: 0, date: today, note: "" });
  const [mezanaEditNotice, setMezanaEditNotice] = useState("");
  const [mezanaSaving, setMezanaSaving] = useState(false);
  const [mezanaDeletionBusy, setMezanaDeletionBusy] = useState("");
  const [ownerMezanaForm, setOwnerMezanaForm] = useState({ action: "borrowed" as MezanaDebtAction, catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1, date: today, note: "" });
  const [mezanaCatalogForm, setMezanaCatalogForm] = useState({ name: "", mode: "borrowed" as MezanaCatalogMode, price: 0, inventoryId: "", inventoryUnitsPerItem: 1 });
  const [editingMezanaCatalogId, setEditingMezanaCatalogId] = useState("");
  const [mezanaCatalogFile, setMezanaCatalogFile] = useState<File | null>(null);
  const [mezanaCatalogPreview, setMezanaCatalogPreview] = useState("");
  const [mezanaCatalogFileKey, setMezanaCatalogFileKey] = useState(0);
  const [mezanaCatalogNotice, setMezanaCatalogNotice] = useState("");
  const [mezanaCatalogSaving, setMezanaCatalogSaving] = useState(false);
  const mezanaCatalogOperationIdRef = useRef("");
  const [mezanaZeroBusy, setMezanaZeroBusy] = useState("");
  const [ownerMezanaTopFile, setOwnerMezanaTopFile] = useState<File | null>(null);
  const [ownerMezanaBottomFile, setOwnerMezanaBottomFile] = useState<File | null>(null);
  const [ownerMezanaTopPreview, setOwnerMezanaTopPreview] = useState("");
  const [ownerMezanaBottomPreview, setOwnerMezanaBottomPreview] = useState("");
  const [ownerMezanaFileKey, setOwnerMezanaFileKey] = useState(0);
  const [ownerMezanaSaving, setOwnerMezanaSaving] = useState(false);
  const [ownerMezanaNotice, setOwnerMezanaNotice] = useState("");
  const approvingSupplierDeliveryRef = useRef(new Set<string>());
  const [recipeForm, setRecipeForm] = useState<RecipeDraft>(emptyRecipeDraft);
  const [recipeCategoryFilter, setRecipeCategoryFilter] = useState("all");
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState("all");
  const [editingRecipeId, setEditingRecipeId] = useState("");
  const draftRecipeIdRef = useRef("");
  const [recipeNotice, setRecipeNotice] = useState("");
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [saleForm, setSaleForm] = useState({ recipeId: "", quantity: 1, date: today, accountId: "account-card" });
  const [saleNotice, setSaleNotice] = useState("");
  const [batchSaleForm, setBatchSaleForm] = useState({ date: today, accountId: "account-card" });
  const [batchSaleQuantities, setBatchSaleQuantities] = useState<Record<string, number>>({});
  const [batchSaleSearch, setBatchSaleSearch] = useState("");
  const [batchSaleBusy, setBatchSaleBusy] = useState(false);
  const batchSaleSavingRef = useRef(false);
  const [deliverySaleForm, setDeliverySaleForm] = useState({
    platform: "coupang" as DeliveryPlatform,
    date: today,
    time: currentSeoulTimeInputValue(),
    orderNumber: "",
    commissionPct: "" as number | "",
    couponWon: 0 as number | "",
    instantDiscountWon: 0 as number | "",
    deliveryFeeWon: "" as number | "",
  });
  const [deliveryExtra, setDeliveryExtra] = useState({ name: "", price: "", cost: "", inventoryId: "", usage: "1" });
  const [deliveryExtraBusy, setDeliveryExtraBusy] = useState(false);
  const [deliveryExtraNotice, setDeliveryExtraNotice] = useState("");
  const [deliveryManualFees, setDeliveryManualFees] = useState<DeliveryManualFees>(emptyDeliveryManualFees);
  const [deliverySaleQuantities, setDeliverySaleQuantities] = useState<Record<string, number>>({});
  const [deliverySaleSearch, setDeliverySaleSearch] = useState("");
  const [deliverySaleNotice, setDeliverySaleNotice] = useState("");
  const [deliverySaleBusy, setDeliverySaleBusy] = useState(false);
  const [editingDeliverySaleId, setEditingDeliverySaleId] = useState("");
  const [deliveryPriceSearch, setDeliveryPriceSearch] = useState("");
  const [deliveryPriceDrafts, setDeliveryPriceDrafts] = useState<Partial<Record<DeliveryPlatform, Record<string, number | "">>>>({});
  const [deliveryPriceNotice, setDeliveryPriceNotice] = useState("");
  const [deliveryPriceBusy, setDeliveryPriceBusy] = useState(false);
  const deliverySaleSavingRef = useRef(false);
  const [cashSaleForm, setCashSaleForm] = useState({ date: today, reason: INVENTORY_OUTFLOW_REASONS[0] as string });
  const [cashSaleQuantities, setCashSaleQuantities] = useState<Record<string, number>>({});
  const [cashSaleSearch, setCashSaleSearch] = useState("");
  const [cashSaleNotice, setCashSaleNotice] = useState("");
  const [cashSaleBusy, setCashSaleBusy] = useState(false);
  const cashSaleSavingRef = useRef(false);
  const [feeRuleForm, setFeeRuleForm] = useState<CostRules>(emptyState.costRules);
  const [feeRulePlatform, setFeeRulePlatform] = useState<DeliveryPlatform>("coupang");
  const [feeRuleNotice, setFeeRuleNotice] = useState("");
  const [feeRuleBusy, setFeeRuleBusy] = useState(false);
  const feeRuleDirtyRef = useRef(false);
  const [feeReportDate, setFeeReportDate] = useState(today);
  const [posTable, setPosTable] = useState<PosTable | null>(null);
  const [posMapping, setPosMapping] = useState<PosColumnMapping>(emptyPosMapping);
  const [posProductMap, setPosProductMap] = useState<Record<string, string>>({});
  const [posNotice, setPosNotice] = useState("");
  const [posReading, setPosReading] = useState(false);
  const [posDayResetBusy, setPosDayResetBusy] = useState(false);
  const [salesOverviewDate, setSalesOverviewDate] = useState("");
  const [posSource, setPosSource] = useState<"excel" | "image" | null>(null);
  const [posImagePreview, setPosImagePreview] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStage, setOcrStage] = useState("");
  const [ocrReceiptSummary, setOcrReceiptSummary] = useState({ quantity: 0, total: 0 });
  const [ocrReviewIssues, setOcrReviewIssues] = useState<OcrReviewIssue[]>([]);
  const [ocrNumbersVerified, setOcrNumbersVerified] = useState(false);
  const [ocrVerificationMessage, setOcrVerificationMessage] = useState("");
  const [removedOcrRows, setRemovedOcrRows] = useState<RemovedOcrRow[]>([]);
  const [posAccountId, setPosAccountId] = useState("account-card");
  const [transactionForm, setTransactionForm] = useState({ supplierId: "", type: "purchase" as "purchase" | "payment", amount: 0, date: today, note: "", accountId: "account-bank", settlementMode: "debt" as "debt" | "paid" });
  const [editingTransactionId, setEditingTransactionId] = useState("");
  const [transactionDocumentFile, setTransactionDocumentFile] = useState<File | null>(null);
  const [transactionDocumentPreview, setTransactionDocumentPreview] = useState("");
  const [removeTransactionDocument, setRemoveTransactionDocument] = useState(false);
  const [transactionFileInputKey, setTransactionFileInputKey] = useState(0);
  const [transactionSaving, setTransactionSaving] = useState(false);
  const [transactionNotice, setTransactionNotice] = useState("");
  const supplierTransactionOperationIdRef = useRef("");
  const supplierTransactionBusyRef = useRef(false);
  const supplierEditingSnapshotRef = useRef<Transaction | undefined>(undefined);
  const supplierPendingDocumentRef = useRef<StockDocument | undefined>(undefined);
  const [supplierDuplicateReason, setSupplierDuplicateReason] = useState("");
  const [supplierDuplicateWarning, setSupplierDuplicateWarning] = useState(false);
  useEffect(() => { setSupplierDuplicateReason(""); setSupplierDuplicateWarning(false); }, [transactionForm.supplierId, transactionForm.type, transactionForm.amount, transactionForm.date, transactionForm.settlementMode]);
  const [financeForm, setFinanceForm] = useState({
    type: "income" as "income" | "expense" | "transfer",
    category: "Boshqa daromad",
    amount: 0,
    date: today,
    accountId: "account-cash",
    toAccountId: "account-bank",
    note: "",
  });
  const [financeNotice, setFinanceNotice] = useState("");
  const [oilForm, setOilForm] = useState({
    type: "purchase" as OilFlowType,
    canCount: 1,
    unitAmount: 0,
    date: today,
    accountId: "account-cash",
    note: "",
  });
  const [oilNotice, setOilNotice] = useState("");
  const [oilSaving, setOilSaving] = useState(false);
  const oilSavingRef = useRef(false);
  const oilOperationIdRef = useRef("");
  const [expenseForm, setExpenseForm] = useState({
    category: "Ijara",
    amount: 0,
    date: localDate(),
    accountId: "account-cash",
    note: "",
  });
  const [expenseNotice, setExpenseNotice] = useState("");
  const [expenseSearch, setExpenseSearch] = useState("");
  const [fixedExpenseForm, setFixedExpenseForm] = useState({
    name: "",
    category: "Ijara",
    amount: 0,
    accountId: "account-bank",
    frequency: "monthly" as FixedExpense["frequency"],
    nextDue: localDate(),
    automatic: true,
  });
  const [fixedExpenseNotice, setFixedExpenseNotice] = useState("");
  const [closeForm, setCloseForm] = useState({ date: today, actualByAccount: {} as Record<string, number>, note: "" });
  const [closeNotice, setCloseNotice] = useState("");
  const [closeSaving, setCloseSaving] = useState(false);
  const closeSavingRef = useRef(false);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings>({
    configured: false,
    tokenSaved: false,
    chatId: "",
    botName: "",
    enabled: false,
    reportTime: "00:10",
    lastSentDate: "",
    lastSentAt: "",
  });
  const [telegramForm, setTelegramForm] = useState({ botToken: "", chatId: "", reportTime: "00:10", enabled: true });
  const [telegramNotice, setTelegramNotice] = useState("");
  const [telegramBusy, setTelegramBusy] = useState("");
  const [supplierTelegramBusy, setSupplierTelegramBusy] = useState("");
  const [supplierTelegramNotice, setSupplierTelegramNotice] = useState("");

  useEffect(() => {
    const applyDeepLink = () => {
      const url = new URL(window.location.href);
      const requestedTab = url.searchParams.get("tab");
      const requestedDate = url.searchParams.get("date");
      setTab(isTab(requestedTab) ? requestedTab : "dashboard");
      if (isIsoDate(requestedDate)) {
        setCloseForm((current) => ({ ...current, date: requestedDate, actualByAccount: {} }));
      }
    };
    applyDeepLink();
    window.addEventListener("popstate", applyDeepLink);
    return () => window.removeEventListener("popstate", applyDeepLink);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "dashboard") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (!url.hash) return;
    const frame = window.requestAnimationFrame(() => {
      revealInventorySection(decodeURIComponent(url.hash.slice(1)));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tab]);

  useEffect(() => {
    const refreshBusinessDate = () => setToday(businessDate());
    refreshBusinessDate();
    const interval = window.setInterval(refreshBusinessDate, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const previousDate = previousBusinessDateRef.current;
    if (previousDate === today) return;
    if (!editingMovementId) setMovementForm((current) => rolloverFormDate(current, previousDate, today));
    if (!editingTransactionId) setTransactionForm((current) => rolloverFormDate(current, previousDate, today));
    setSaleForm((current) => rolloverFormDate(current, previousDate, today));
    setBatchSaleForm((current) => rolloverFormDate(current, previousDate, today));
    if (!editingDeliverySaleId) setDeliverySaleForm((current) => ({
      ...rolloverFormDate(current, previousDate, today),
      time: current.date === previousDate ? currentSeoulTimeInputValue() : current.time,
    }));
    setCashSaleForm((current) => rolloverFormDate(current, previousDate, today));
    setFinanceForm((current) => rolloverFormDate(current, previousDate, today));
    setOilForm((current) => rolloverFormDate(current, previousDate, today));
    setExpenseForm((current) => rolloverFormDate(current, previousDate, today));
    setCloseForm((current) => rolloverFormDate(current, previousDate, today));
    setFeeReportDate((current) => rolloverSelectedDate(current, previousDate, today));
    setSectionDateRanges((current) => Object.fromEntries(ANALYSIS_TABS.map((section) => {
      const range = current[section];
      return [section, range.preset === "custom" ? range : dateRangeForPreset(today, range.preset)];
    })) as Record<AnalysisTab, DateRange>);
    previousBusinessDateRef.current = today;
  }, [editingDeliverySaleId, editingMovementId, editingTransactionId, today]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [tab]);

  useEffect(() => {
    let active = true;
    const requestBootstrap = async (savedBranch: string) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8_000);
        try {
          const response = await fetch(
            `/api/branches?bootstrap=1&branch=${encodeURIComponent(savedBranch)}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (response.status >= 500 && attempt === 0) continue;
          return response;
        } catch (error) {
          lastError = error;
          if (!active || attempt > 0) throw error;
        } finally {
          window.clearTimeout(timeout);
        }
      }
      throw lastError;
    };
    const open = async () => {
      let denied = false;
      try {
        const savedBranch = window.localStorage.getItem("halo-active-branch") || "main";
        const branchResponse = await requestBootstrap(savedBranch);
        const branchValue = await branchResponse.json() as {
          branches?: Branch[];
          branchId?: string;
          state?: Partial<AppState>;
          error?: string;
        };
        if (!branchResponse.ok || !branchValue.branches?.length) {
          denied = branchResponse.status === 401;
          throw new Error(branchValue.error || "Filiallar ochilmadi");
        }
        const selected = branchValue.branchId || branchValue.branches[0].id;
        if (!active) return;
        setBranches(branchValue.branches);
        setActiveBranchId(selected);
        activeBranchRef.current = selected;
        window.localStorage.setItem("halo-active-branch", selected);
        const value = branchValue.state;
        if (!value?.updatedAt) throw new Error("Ma’lumotlar ochilmadi");
        if (!active) return;
        const normalized = normalizeAppState(value);
        serverRevisionRef.current = normalized.updatedAt || "";
        recurringReconcileAtRef.current = Date.now();
        serverStateRef.current = normalized;
        localStateRef.current = normalized;
        setData(normalized);
        if (!feeRuleDirtyRef.current) setFeeRuleForm(normalized.costRules);
        setAdminAccess("authorized");
        setStatus("Barcha ma’lumotlar saqlangan");
      } catch {
        if (active) {
          setStatus("Ma’lumotlar ochilmadi");
          setAdminAccess(denied ? "denied" : "error");
        }
      }
    };
    void open();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (adminAccess !== "authorized") return;
    let active = true;
    let refreshing = false;
    const refreshExternalChanges = async () => {
      if (refreshing || document.visibilityState !== "visible") return;
      const branchId = activeBranchRef.current;
      const queuedSave = saveQueueRef.current;
      await queuedSave;
      if (
        !active
        || refreshing
        || activeBranchRef.current !== branchId
        || saveQueueRef.current !== queuedSave
        || failedSaveRef.current
      ) return;
      refreshing = true;
      try {
        const shouldReconcile = Date.now() - recurringReconcileAtRef.current >= 60_000;
        if (shouldReconcile) recurringReconcileAtRef.current = Date.now();
        const revisionResponse = await fetch(
          `/api/state?branch=${encodeURIComponent(branchId)}&revision=1${shouldReconcile ? "&reconcile=1" : ""}`,
          { cache: "no-store" },
        );
        const revisionValue = await revisionResponse.json() as { updatedAt?: string };
        if (!revisionResponse.ok || !stateRevisionChanged(serverRevisionRef.current, revisionValue.updatedAt)) return;
        const response = await fetch(`/api/state?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" });
        const value = await response.json() as Partial<AppState>;
        if (!response.ok || !value.updatedAt || value.updatedAt === serverRevisionRef.current) return;
        if (
          !active
          || activeBranchRef.current !== branchId
          || saveQueueRef.current !== queuedSave
          || failedSaveRef.current
        ) return;
        const normalized = normalizeAppState(value);
        serverRevisionRef.current = normalized.updatedAt || "";
        serverStateRef.current = normalized;
        localStateRef.current = normalized;
        setData(normalized);
        if (!feeRuleDirtyRef.current) setFeeRuleForm(normalized.costRules);
        setStatus("✓ Xodim va filial ma’lumoti yangilandi");
      } catch {
        // Keyingi davriy tekshiruv avtomatik qayta urinadi.
      } finally {
        refreshing = false;
      }
    };
    void refreshExternalChanges();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refreshExternalChanges();
    };
    const interval = window.setInterval(() => void refreshExternalChanges(), HALO_LIVE_SYNC_INTERVAL_MS);
    const unsubscribe = subscribeHaloStateChanges((signal) => {
      if (signal.branchId === activeBranchRef.current) void refreshExternalChanges();
    });
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      unsubscribe();
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [adminAccess, activeBranchId]);

  useEffect(() => {
    if (adminAccess === "authorized" && data.updatedAt) {
      announceHaloStateChange(activeBranchId, data.updatedAt);
    }
  }, [activeBranchId, adminAccess, data.updatedAt]);

  useEffect(() => {
    if (adminAccess !== "authorized") return;
    fetch(`/api/telegram?branch=${encodeURIComponent(activeBranchId)}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Telegram sozlamalari ochilmadi.");
      return response.json();
    }).then((value: TelegramSettings) => {
      setTelegramSettings(value);
      setTelegramForm((current) => ({
        ...current,
        chatId: value.chatId || "",
        reportTime: value.reportTime || "00:10",
        enabled: value.enabled,
      }));
    }).catch(() => setTelegramNotice("Telegram sozlamalari ochilmadi."));
  }, [adminAccess, activeBranchId]);

  useEffect(() => {
    if (adminAccess !== "authorized" || userMode !== "owner") return;
    let active = true;
    const checkAutomaticReport = async () => {
      try {
        const response = await fetch("/api/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "auto", branchId: activeBranchId }),
        });
        const result = await response.json() as { automatic?: boolean; sentAt?: string; reportDate?: string; orderSent?: number };
        if (active && response.ok && result.automatic) {
          setTelegramSettings((current) => ({ ...current, lastSentDate: result.reportDate || today, lastSentAt: result.sentAt || new Date().toISOString() }));
          setTelegramNotice(`✓ ${result.reportDate ? displayDate(result.reportDate) : "Ish kuni"} hisoboti yuborildi${result.orderSent ? ` · ${result.orderSent} ta yetkazuvchiga buyurtma ketdi` : ""}.`);
        }
      } catch {
        // The next one-minute check retries automatically.
      }
    };
    void checkAutomaticReport();
    const interval = window.setInterval(checkAutomaticReport, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [adminAccess, activeBranchId, today, userMode]);

  useEffect(() => {
    if (adminAccess !== "authorized" || userMode !== "owner") return;
    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await fetch(`/api/inventory-accounting?branch=${encodeURIComponent(activeBranchId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify" }) }); } catch { /* Retry at the next check. */ }
      finally { inFlight = false; }
    };
    void check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [adminAccess, userMode, activeBranchId]);

  useEffect(() => () => {
    if (posImagePreview) URL.revokeObjectURL(posImagePreview);
  }, [posImagePreview]);

  useEffect(() => () => {
    if (movementDocumentPreview) URL.revokeObjectURL(movementDocumentPreview);
  }, [movementDocumentPreview]);

  useEffect(() => () => {
    if (transactionDocumentPreview) URL.revokeObjectURL(transactionDocumentPreview);
  }, [transactionDocumentPreview]);

  const enqueueStatePatch = async (patch: StatePatch, action = "Ma’lumot yangilandi") => {
    lastSaveErrorRef.current = "";
    const branchId = activeBranchRef.current;
    const section = tabSection[tab];
    const optimisticCandidate = applyStatePatch(localStateRef.current, patch);
    const optimisticArchiveConflicts = activeDeletedEntityConflicts(optimisticCandidate);
    if (optimisticArchiveConflicts.length) {
      if (failedSaveRef.current?.patch === patch) failedSaveRef.current = null;
      lastSaveErrorRef.current = `“${optimisticArchiveConflicts[0].label}” o‘chirilgan. Eski tahrir qo‘llanmadi.`;
      setStatus(lastSaveErrorRef.current);
      return false;
    }
    const optimistic = withClientSaleFinancialSnapshots(
      localStateRef.current,
      reconcileArchivedState(optimisticCandidate).state,
    );
    optimistic.updatedAt = localStateRef.current.updatedAt || serverRevisionRef.current;
    localStateRef.current = optimistic;
    setData(optimistic);
    setStatus("Saqlanmoqda…");
    const operation = saveQueueRef.current.then(async () => {
      if (activeBranchRef.current !== branchId) {
        lastSaveErrorRef.current = "Filial almashtirilgan. Amalni yangi filialda qayta bosing.";
        return false;
      }
      const pendingFailure = failedSaveRef.current?.branchId === branchId
        ? failedSaveRef.current
        : null;
      const restoreAuthoritativeState = async (): Promise<AppState | null> => {
        if (activeBranchRef.current !== branchId) return null;
        try {
          const freshResponse = await fetch(`/api/state?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" });
          const fresh = await freshResponse.json() as Partial<AppState>;
          if (!freshResponse.ok || activeBranchRef.current !== branchId) throw new Error("State reload failed");
          const normalized = normalizeAppState(fresh);
          serverRevisionRef.current = normalized.updatedAt || "";
          serverStateRef.current = normalized;
          localStateRef.current = normalized;
          setData(normalized);
          if (!feeRuleDirtyRef.current) setFeeRuleForm(normalized.costRules);
          return normalized;
        } catch {
          if (activeBranchRef.current === branchId) {
            localStateRef.current = serverStateRef.current;
            setData(serverStateRef.current);
          }
          return null;
        }
      };
      if (pendingFailure && pendingFailure.patch !== patch) {
        await restoreAuthoritativeState();
        lastSaveErrorRef.current = "Oldingi amal saqlanmagan. Avval “Qayta saqlash”ni bosing yoki formani qayta kiriting.";
        setStatus(lastSaveErrorRef.current);
        return false;
      }
      const payloadCandidate = applyStatePatch(serverStateRef.current, patch);
      const queuedArchiveConflicts = activeDeletedEntityConflicts(payloadCandidate);
      if (queuedArchiveConflicts.length) {
        if (failedSaveRef.current?.patch === patch) failedSaveRef.current = null;
        lastSaveErrorRef.current = `“${queuedArchiveConflicts[0].label}” o‘chirilgan. Navbatdagi eski tahrir qo‘llanmadi.`;
        setStatus(lastSaveErrorRef.current);
        return false;
      }
      const payload = withClientSaleFinancialSnapshots(
        serverStateRef.current,
        reconcileArchivedState(payloadCandidate).state,
      );
      const combinedPatch = createStatePatch(serverStateRef.current, payload);
      const combinedAction = action;
      const requiresFreshArchiveSnapshot = /savatga ko‘chirildi|savatdan tiklandi|oy yakunlandi|kun yopildi/i.test(combinedAction);
      payload.updatedAt = serverRevisionRef.current || serverStateRef.current.updatedAt;
      localStateRef.current = withClientSaleFinancialSnapshots(
        serverStateRef.current,
        reconcileArchivedState(applyStatePatch(localStateRef.current, patch)).state,
      );
      setData(localStateRef.current);
      try {
        const response = await fetch(`/api/state?branch=${encodeURIComponent(branchId)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Halo-Actor": "Rahbar",
            "X-Halo-Action": encodeHaloHeader(combinedAction),
            "X-Halo-Section": encodeHaloHeader(section, 300),
          },
          body: JSON.stringify(payload),
        });
        const responseText = await response.text();
        let result: { ok?: boolean; updatedAt?: string; error?: string } = {};
        try {
          result = responseText ? JSON.parse(responseText) as typeof result : {};
        } catch {
          result = { error: responseText.trim().slice(0, 180) || `Server javobi o‘qilmadi (${response.status})` };
        }
        if (!response.ok || !result.ok || !result.updatedAt) {
          const recovered = await restoreAuthoritativeState();
          if (recovered && sameStoredState(recovered, payload)) {
            failedSaveRef.current = null;
            lastSaveErrorRef.current = "";
            setStatus("✓ Saqlandi");
            return true;
          }
          if (requiresFreshArchiveSnapshot) {
            failedSaveRef.current = null;
            lastSaveErrorRef.current = "Ma’lumot boshqa qurilmada yangilandi. Amalni qayta bosing.";
            setStatus(lastSaveErrorRef.current);
            return false;
          }
          lastSaveErrorRef.current = result.error || "Saqlashda xatolik";
          failedSaveRef.current = shouldRetryFailedStateSave(response.status)
            ? { patch: combinedPatch, action: combinedAction, branchId }
            : null;
          setStatus(lastSaveErrorRef.current);
          return false;
        }
        if (JSON.stringify(payload.mezanaEntries) !== JSON.stringify(serverStateRef.current.mezanaEntries)) {
          const fresh = await restoreAuthoritativeState();
          if (!fresh) throw new Error("MEZANA hisobi qayta ochilmadi.");
          failedSaveRef.current = null;
          lastSaveErrorRef.current = "";
          setStatus("✓ MEZANA va bog‘langan hisoblar saqlandi");
          return true;
        }
        serverRevisionRef.current = result.updatedAt;
        serverStateRef.current = { ...payload, updatedAt: serverRevisionRef.current };
        localStateRef.current = { ...localStateRef.current, updatedAt: serverRevisionRef.current };
        failedSaveRef.current = null;
        lastSaveErrorRef.current = "";
        if (activeBranchRef.current === branchId) {
          setData((current) => ({ ...current, updatedAt: serverRevisionRef.current }));
        }
        setStatus("✓ Saqlandi");
        return true;
      } catch {
        const recovered = await restoreAuthoritativeState();
        if (recovered && sameStoredState(recovered, payload)) {
          failedSaveRef.current = null;
          lastSaveErrorRef.current = "";
          setStatus("✓ Saqlandi");
          return true;
        }
        if (requiresFreshArchiveSnapshot) {
          failedSaveRef.current = null;
          lastSaveErrorRef.current = "Aloqa uzildi. Amalni ma’lumot yangilangandan keyin qayta bosing.";
          setStatus(lastSaveErrorRef.current);
          return false;
        }
        failedSaveRef.current = { patch: combinedPatch, action: combinedAction, branchId };
        lastSaveErrorRef.current = "Internet aloqasini tekshiring";
        setStatus(lastSaveErrorRef.current);
        return false;
      }
    });
    saveQueueRef.current = operation;
    return operation;
  };

  const save = (next: AppState, action = "Ma’lumot yangilandi") => {
    next = applySaleInventoryAccounting(data, next);
    const lockKey = `${activeBranchRef.current}:${tab}:${action}`;
    const inFlight = saveActionLocksRef.current.get(lockKey);
    if (inFlight) {
      setStatus("Saqlash allaqachon boshlandi — ikkinchi bosish qabul qilinmadi.");
      return inFlight;
    }
    const duplicateWarnings = findPotentialDuplicateEntries(data, next);
    if (duplicateWarnings.length && !window.confirm(duplicateEntryConfirmationMessage(duplicateWarnings))) {
      setStatus("Takroriy ma’lumot saqlanmadi. Kiritilgan qiymatlarni tekshirib, kerak bo‘lsa qayta saqlang.");
      return Promise.resolve(false);
    }
    const operation = (async () => {
      const patch = createStatePatch(data, next);
      if (isStatePatchEmpty(patch)) {
        const saved = await saveQueueRef.current;
        if (saved) {
          lastSaveErrorRef.current = "";
          setStatus("✓ Barcha ma’lumotlar saqlangan");
        }
        return saved;
      }
      return enqueueStatePatch(patch, action);
    })();
    saveActionLocksRef.current.set(lockKey, operation);
    void operation.finally(() => {
      if (saveActionLocksRef.current.get(lockKey) === operation) {
        saveActionLocksRef.current.delete(lockKey);
      }
    });
    return operation;
  };

  const reloadAuthoritativeState = async (branchId = activeBranchRef.current) => {
    const response = await fetch(`/api/state?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" });
    const value = await response.json() as Partial<AppState> & { error?: string };
    if (!response.ok || !value.updatedAt) throw new Error(value.error || "Ombor ma’lumoti qayta ochilmadi.");
    if (activeBranchRef.current !== branchId) throw new Error("Filial almashtirilgan. Yangi filial ma’lumotini tekshiring.");
    const normalized = normalizeAppState(value);
    serverRevisionRef.current = normalized.updatedAt || "";
    serverStateRef.current = normalized;
    localStateRef.current = normalized;
    setData(normalized);
    if (!feeRuleDirtyRef.current) setFeeRuleForm(normalized.costRules);
    return normalized;
  };

  const saveAtomicSupplierRecord = async (body: Record<string, unknown>) => {
    const branchId = activeBranchRef.current;
    await saveQueueRef.current;
    if (activeBranchRef.current !== branchId) throw new Error("Filial almashtirilgan. Amalni qayta bosing.");
    const response = await fetch(`/api/supplier-records?branch=${encodeURIComponent(branchId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { ok?: boolean; error?: string; alreadySaved?: boolean; code?: string };
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || "Yetkazib beruvchi yozuvi saqlanmadi."), {code: result.code, requestRejected:true});
    // Once committed, a failed refresh must not make the user enter the same
    // debt again, or delete an uploaded document already referenced by it.
    await reloadAuthoritativeState(branchId).catch(() => setStatus("✓ Yozuv saqlandi. Hisobni ko‘rish uchun sahifani yangilang."));
    failedSaveRef.current = null;
    lastSaveErrorRef.current = "";
    setStatus("✓ Saqlandi");
    return result;
  };

  const deleteWarehouseRecord = async (
    kind: "inventory" | "stockMovement",
    entityId: string,
    reason: string,
  ) => {
    const branchId = activeBranchRef.current;
    const resultOperation = saveQueueRef.current.then(async (precedingSaveCompleted) => {
      if (!precedingSaveCompleted || failedSaveRef.current) {
        throw new Error("Avval saqlanmay qolgan o‘zgarishni qayta saqlang, keyin Ombor yozuvini o‘chiring.");
      }
      if (activeBranchRef.current !== branchId) throw new Error("Filial almashtirilgan. Amalni qayta bosing.");
      const response = await fetch(`/api/inventory-records?branch=${encodeURIComponent(branchId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: entityId, reason }),
      });
      const result = await response.json() as WarehouseDeleteResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Ombor yozuvi o‘chirilmadi.");
      await reloadAuthoritativeState(branchId);
      return result;
    });
    // The DELETE and its authoritative reload are one queue operation. Saves
    // started while it is running wait, then reapply their patch to fresh data.
    saveQueueRef.current = resultOperation.then(() => true, () => false);
    return resultOperation;
  };

  const requestPosDayReset = (body: Record<string, unknown>) => {
    const branchId = activeBranchRef.current;
    const operation = saveQueueRef.current.then(async (previousSaved) => {
      if (!previousSaved || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan o‘zgarishni qayta saqlang.");
      if (activeBranchRef.current !== branchId) throw new Error("Filial almashtirildi. Qayta tekshiring.");
      const response = await fetch(`/api/pos-day-reset?branch=${encodeURIComponent(branchId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "POS importini bekor qilib bo‘lmadi.");
      if (body.action === "cancel") {
        await reloadAuthoritativeState(branchId);
        setPosNotice("✓ Tanlangan kun importi bekor qilindi. To‘g‘ri Excel faylini yuklang va jami summani tekshiring.");
        announceHaloStateChange(branchId, result.updatedAt);
      }
      return result;
    });
    // Serialize the server mutation + reload with all owner saves.
    saveQueueRef.current = operation.then(() => true, () => !failedSaveRef.current);
    return operation;
  };

  const hasUnsavedRecipeDraft = () => Boolean(recipeForm.name.trim())
    || Boolean(recipeForm.posCode.trim())
    || Number(recipeForm.salePrice) !== 0
    || recipeForm.categoryId !== RECIPE_FALLBACK_CATEGORY_ID
    || recipeForm.ingredients.some((ingredient) => (
      ingredient.name.trim()
      || ingredient.unit !== "g"
      || Number(ingredient.quantity) !== 0
      || Number(ingredient.lineCost) !== 0
    ))
    || recipeForm.extraCosts.some((extraCost) => extraCost.name.trim() || Number(extraCost.amount) !== 0);
  const hasUnsavedStockDraft = () => Boolean(stockForm.name.trim())
    || stockForm.unit !== "g"
    || stockForm.packageName !== "pachka"
    || stockForm.categoryId !== INVENTORY_FALLBACK_CATEGORY_ID
    || [stockForm.packageCount, stockForm.minStock, stockForm.packageCost].some((value) => Number(value) !== 0)
    || Number(stockForm.unitsPerPackage) !== 1
    || Number(stockForm.gramsPerUnit) !== 0
    || Boolean(editingInventoryId)
    || Boolean(stockForm.supplierId);
  const hasUnsavedMovementDraft = () => Boolean(editingMovementId)
    || Boolean(movementDocumentFile)
    || Boolean(movementForm.inventoryId || movementForm.quantity || movementForm.unitCost || movementForm.supplierId || movementForm.note.trim());
  const hasUnsavedTransactionDraft = () => Boolean(editingTransactionId)
    || Boolean(transactionDocumentFile)
    || Boolean(transactionForm.supplierId || transactionForm.amount || transactionForm.note.trim());
  const hasUnsavedSupplierDraft = () => Boolean(editingSupplierId)
    || Boolean(supplierForm.name.trim() || supplierForm.phone.trim() || supplierForm.bankAccount.trim());
  const hasUnsavedMezanaDraft = () => Boolean(ownerMezanaOperationIdRef.current || ownerMezanaTopFile || ownerMezanaBottomFile)
    || Boolean(ownerMezanaForm.productName.trim() || ownerMezanaForm.amount || ownerMezanaForm.quantity || ownerMezanaForm.note.trim());
  const hasUnsavedOilDraft = () => Boolean(oilOperationIdRef.current)
    || Boolean(oilForm.unitAmount || oilForm.canCount !== 1 || oilForm.note.trim());
  const confirmBranchDraftLoss = () => (!hasUnsavedRecipeDraft() && !hasUnsavedStockDraft() && !hasUnsavedMovementDraft() && !hasUnsavedTransactionDraft() && !hasUnsavedSupplierDraft() && !hasUnsavedMezanaDraft() && !hasUnsavedOilDraft())
    || window.confirm("Saqlanmagan tahrir yoki yangi yozuv bor. Filialni almashtirsangiz, bu qoralama tozalanadi. Davom etasizmi?");

  const guardFailedSaveBeforeBranchAction = async (action: string) => {
    const showBlockedStatus = () => {
      const message = `O‘zgarish saqlanmadi. Avval “Qayta saqlash”ni bosing; ${action} to‘xtatildi.`;
      lastSaveErrorRef.current = message;
      setStatus(message);
      return false;
    };
    if (ownerMezanaSavingRef.current || oilSavingRef.current) {
      setStatus(`MEZANA yoki moy yozuvi saqlanmoqda; ${action} tugagach qayta urinib ko‘ring.`);
      return false;
    }
    if (failedSaveRef.current) return showBlockedStatus();
    await saveQueueRef.current;
    if (ownerMezanaSavingRef.current || oilSavingRef.current) {
      setStatus(`MEZANA yoki moy yozuvi saqlanmoqda; ${action} tugagach qayta urinib ko‘ring.`);
      return false;
    }
    if (failedSaveRef.current) return showBlockedStatus();
    return true;
  };

  const switchBranch = async (branchId: string, options: { skipRecipeDraftCheck?: boolean } = {}) => {
    if (!branchId || branchId === activeBranchRef.current || branchTransitionRef.current) return;
    if (!await guardFailedSaveBeforeBranchAction("filialni almashtirish")) return;
    if (!options.skipRecipeDraftCheck && !confirmBranchDraftLoss()) return;
    const previousBranchId = activeBranchRef.current;
    branchTransitionRef.current = true;
    setStatus("Filial ochilmoqda…");
    activeBranchRef.current = branchId;
    setActiveBranchId(branchId);
    window.localStorage.setItem("halo-active-branch", branchId);
    try {
      const response = await fetch(`/api/state?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" });
      const value = await response.json() as Partial<AppState> & { error?: string };
      if (!response.ok) throw new Error(value.error || "Filial ochilmadi");
      if (activeBranchRef.current !== branchId) return;
      const normalized = normalizeAppState(value);
      serverRevisionRef.current = normalized.updatedAt || "";
      serverStateRef.current = normalized;
      localStateRef.current = normalized;
      setData(normalized);
      feeRuleDirtyRef.current = false;
      setFeeRuleForm(normalized.costRules);
      setFeeRuleNotice("");
      setRecipeForm(emptyRecipeDraft());
      setEditingRecipeId("");
      draftRecipeIdRef.current = "";
      setRecipeNotice("");
      setStockForm(emptyStockForm());
      setIntakeDraft(null);
      setEditingInventoryId("");
      setInventorySearch("");
      setInventoryStockFilter("all");
      setMovementForm({ inventoryId: "", type: "receipt", quantity: 0, unitCost: 0, supplierId: "", date: today, note: "" });
      setEditingMovementId("");
      setMovementDocumentFile(null);
      setMovementDocumentPreview("");
      setRemoveMovementDocument(false);
      setMovementFileInputKey((current) => current + 1);
      setStockHistoryLimit(80);
      setTransactionForm({ supplierId: "", type: "purchase", amount: 0, date: today, note: "", accountId: "account-bank", settlementMode: "debt" });
      supplierTransactionOperationIdRef.current = "";
      supplierFullPaymentOperationIdsRef.current = {};
      setEditingTransactionId("");
      setTransactionDocumentFile(null);
      setTransactionDocumentPreview("");
      setRemoveTransactionDocument(false);
      setTransactionFileInputKey((current) => current + 1);
      setTransactionNotice("");
      setEditingSupplierId("");
      setSupplierEditForm({ name: "", phone: "", bankAccount: "" });
      setSupplierNotice("");
      ownerMezanaOperationIdRef.current = "";
      setOwnerMezanaForm({ action: "borrowed", catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1, date: today, note: "" });
      if (ownerMezanaTopPreview) URL.revokeObjectURL(ownerMezanaTopPreview);
      if (ownerMezanaBottomPreview) URL.revokeObjectURL(ownerMezanaBottomPreview);
      setOwnerMezanaTopFile(null);
      setOwnerMezanaBottomFile(null);
      setOwnerMezanaTopPreview("");
      setOwnerMezanaBottomPreview("");
      setOwnerMezanaFileKey((current) => current + 1);
      setOwnerMezanaNotice("");
      oilOperationIdRef.current = "";
      setOilForm({ type: "purchase", canCount: 1, unitAmount: 0, date: today, accountId: "account-cash", note: "" });
      setOilNotice("");
      setRecipeCategoryFilter("all");
      setInventoryCategoryFilter("all");
      setStockNotice("");
      setStatus("✓ Filial hisobi ochildi");
      setTab("dashboard");
    } catch {
      activeBranchRef.current = previousBranchId;
      setActiveBranchId(previousBranchId);
      window.localStorage.setItem("halo-active-branch", previousBranchId);
      setStatus("Filial ma’lumotlari ochilmadi");
    } finally {
      branchTransitionRef.current = false;
    }
  };

  const addBranch = async () => {
    if (!await guardFailedSaveBeforeBranchAction("yangi filial yaratish")) return;
    if (!confirmBranchDraftLoss()) return;
    const name = window.prompt("Yangi filial nomini yozing:", "HALO 2-filial")?.trim();
    if (!name) return;
    setStatus("Yangi filial ochilmoqda…");
    try {
      const response = await fetch("/api/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json() as { branch?: Branch; error?: string };
      if (!response.ok || !result.branch) throw new Error(result.error || "Filial qo‘shilmadi");
      const nextBranches = [...branches, result.branch];
      setBranches(nextBranches);
      await switchBranch(result.branch.id, { skipRecipeDraftCheck: true });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Filial qo‘shilmadi");
    }
  };

  const renameBranch = async () => {
    const currentBranch = branches.find((branch) => branch.id === activeBranchId);
    if (!currentBranch) return;
    const name = window.prompt("Filialning yangi nomini yozing:", currentBranch.name)?.trim();
    if (!name || name === currentBranch.name) return;
    setStatus("Filial nomi o‘zgartirilmoqda…");
    try {
      const response = await fetch("/api/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: currentBranch.id, name }),
      });
      const result = await response.json() as { branch?: Pick<Branch, "id" | "name">; error?: string };
      if (!response.ok || !result.branch) throw new Error(result.error || "Filial nomi o‘zgarmadi");
      setBranches((current) => current.map((branch) => (
        branch.id === result.branch?.id ? { ...branch, name: result.branch.name } : branch
      )));
      setStatus("✓ Filial nomi o‘zgartirildi");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Filial nomi o‘zgarmadi");
    }
  };

  const deleteBranch = async () => {
    const currentBranch = branches.find((branch) => branch.id === activeBranchId);
    if (!currentBranch) return;
    if (currentBranch.id === "main") {
      setStatus("Asosiy filialni o‘chirib bo‘lmaydi");
      return;
    }
    if (!await guardFailedSaveBeforeBranchAction("filialni o‘chirish")) return;
    if (!window.confirm(`“${currentBranch.name}” filialini o‘chirasizmi?\n\nFilial ro‘yxatdan yo‘qoladi. Uning eski ma’lumotlari xavfsizlik uchun arxivda saqlanadi.`)) return;
    const reason = askCancellationReason(`${currentBranch.name} filiali`);
    if (!reason) return;
    if (!confirmBranchDraftLoss()) return;
    setStatus("Filial o‘chirilmoqda…");
    try {
      const response = await fetch(`/api/branches?branch=${encodeURIComponent(currentBranch.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Filial o‘chirilmadi");
      const remaining = branches.filter((branch) => branch.id !== currentBranch.id);
      const nextBranch = remaining.find((branch) => branch.id === "main") || remaining[0];
      setBranches(remaining);
      window.localStorage.removeItem(`halo-branch-${currentBranch.id}`);
      if (nextBranch) await switchBranch(nextBranch.id, { skipRecipeDraftCheck: true });
      setStatus("✓ Xato kiritilgan filial o‘chirildi");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Filial o‘chirilmadi");
    }
  };

  const withDeletedItem = (
    next: AppState,
    archive: Omit<Parameters<typeof createDeletedItem>[0], "now" | "reason">,
    reason: string,
  ): AppState => ({
    ...next,
    deletedItems: prependDeletedItem(data.deletedItems, createDeletedItem({ ...archive, reason })),
  });

  const askCancellationReason = (label: string) => {
    const value = window.prompt(`“${label}” nima uchun bekor qilinmoqda?\n\nSabab alohida “Bekor qilinganlar” bo‘limida tarix bo‘lib qoladi.`);
    if (value === null) return null;
    const reason = value.trim();
    if (!reason) {
      window.alert("Bekor qilish sababini yozish majburiy.");
      return null;
    }
    return reason.slice(0, 500);
  };

  const confirmMoveToTrash = (
    label: string,
    next: AppState,
    archive: Omit<Parameters<typeof createDeletedItem>[0], "now" | "reason">,
    action: string,
  ) => {
    if (!window.confirm(`“${label}” savatga ko‘chirilsinmi?\n\nU hisob-kitoblarda ishlatilmaydi. Bekor qilinganlar → Savat / tiklash bo‘limidan qaytarasiz.`)) return;
    const reason = askCancellationReason(label);
    if (!reason) return;
    void save(withDeletedItem(next, archive, reason), `${action} · Sabab: ${reason}`);
  };

  const deleteInventoryItem = async (item: Inventory, reason: string) => {
    if (inventoryDeletionBusy) throw new Error("Oldingi amal tugashini kuting.");
    setInventoryDeletionBusy(item.id);
    try {
      await deleteWarehouseRecord("inventory", item.id, reason);
      if (editingInventoryId === item.id) { setEditingInventoryId(""); setStockForm(emptyStockForm()); }
      setStockNotice(`✓ “${item.name}” faol ro‘yxatdan olib tashlandi. Tarix va hisoblar saqlandi.`);
      setStatus("✓ Mahsulot faol ro‘yxatdan olib tashlandi");
    } finally { setInventoryDeletionBusy(""); }
  };
  const restoreInventoryProduct = async (id: string) => {
    if (inventoryDeletionBusy) return;
    const branch=activeBranchRef.current;setInventoryDeletionBusy(id);
    try {
      if (!await saveQueueRef.current || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan amalni saqlang.");
      const response=await fetch(`/api/inventory-records?branch=${encodeURIComponent(branch)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"restoreProduct",id})});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||"Mahsulot tiklanmadi.");
      await reloadAuthoritativeState(branch);setStockNotice("✓ Mahsulot faol ro‘yxatga tiklandi. Qoldiq va hisoblar o‘zgarmadi.");
    } catch(e) {setStockNotice(e instanceof Error?e.message:"Mahsulot tiklanmadi.");} finally {setInventoryDeletionBusy("");}
  };

  const deleteRecipe = (recipe: Recipe) => {
    confirmMoveToTrash(recipe.name, {
      ...data,
      recipes: data.recipes.filter((entry) => entry.id !== recipe.id),
    }, {
      kind: "recipe",
      entityId: recipe.id,
      label: recipe.name,
      section: "Taom tannarxi",
      record: recipe,
    }, `Taom savatga ko‘chirildi · ${recipe.name}`);
  };

  const addProductCategory = async (kind: ProductCategoryKind) => {
    const label = kind === "recipe" ? "Yangi taom kategoriyasi" : "Yangi xomashyo kategoriyasi";
    const name = window.prompt(`${label} nomini yozing:`)?.trim().replace(/\s+/g, " ");
    if (!name) return;
    const duplicate = data.productCategories.some((category) => (
      category.kind === kind && normalizeHumanNameKey(category.name) === normalizeHumanNameKey(name)
    ));
    if (duplicate) {
      setStatus("Bu kategoriya allaqachon mavjud.");
      return;
    }
    const sameKind = categoriesForKind(data.productCategories, kind);
    const nextCategory: ProductCategory = {
      id: id(kind === "recipe" ? "recipe-category" : "inventory-category"),
      kind,
      name: name.slice(0, 60),
      sortOrder: Math.max(0, ...sameKind.map((category) => category.sortOrder < 900 ? category.sortOrder : 0)) + 10,
    };
    const saved = await save({
      ...data,
      productCategories: [...data.productCategories, nextCategory],
    }, `Kategoriya qo‘shildi · ${nextCategory.name}`);
    if (!saved) return;
    if (kind === "recipe") {
      setRecipeCategoryFilter(nextCategory.id);
      setRecipeForm((current) => ({ ...current, categoryId: nextCategory.id }));
    } else {
      setInventoryCategoryFilter(nextCategory.id);
      setStockForm((current) => ({ ...current, categoryId: nextCategory.id }));
    }
  };

  const renameProductCategory = async (kind: ProductCategoryKind, categoryId: string) => {
    const category = data.productCategories.find((entry) => entry.kind === kind && entry.id === categoryId);
    if (!category) return;
    const name = window.prompt("Kategoriyaning yangi nomini yozing:", category.name)?.trim().replace(/\s+/g, " ");
    if (!name || name === category.name) return;
    if (data.productCategories.some((entry) => (
      entry.kind === kind
      && entry.id !== category.id
      && normalizeHumanNameKey(entry.name) === normalizeHumanNameKey(name)
    ))) {
      setStatus("Bu nomdagi kategoriya allaqachon mavjud.");
      return;
    }
    await save({
      ...data,
      productCategories: data.productCategories.map((entry) => entry.id === category.id
        ? { ...entry, name: name.slice(0, 60) }
        : entry),
    }, `Kategoriya nomi o‘zgardi · ${category.name} → ${name}`);
  };

  const deleteProductCategory = async (kind: ProductCategoryKind, categoryId: string) => {
    const fallbackId = kind === "recipe" ? RECIPE_FALLBACK_CATEGORY_ID : INVENTORY_FALLBACK_CATEGORY_ID;
    const category = data.productCategories.find((entry) => entry.kind === kind && entry.id === categoryId);
    if (!category || category.id === fallbackId) {
      setStatus("Asosiy “Boshqa” kategoriyasini o‘chirib bo‘lmaydi.");
      return;
    }
    const affected = kind === "recipe"
      ? data.recipes.filter((recipe) => recipe.categoryId === category.id).length
      : stockForecast.filter((item) => item.categoryId === category.id).length;
    if (!window.confirm(`“${category.name}” kategoriyasi savatga ko‘chirilsinmi?\n\n${affected} ta mahsulot “Boshqa” kategoriyasiga o‘tkaziladi. Mahsulotlar va eski savdolar o‘zgarmaydi; kategoriyani Bekor qilinganlar → Savat / tiklash oynasidan qaytarasiz.`)) return;
    const reason = askCancellationReason(category.name);
    if (!reason) return;
    const memberIds = kind === "recipe"
      ? data.recipes.filter((recipe) => recipe.categoryId === category.id).map((recipe) => recipe.id)
      : data.inventory.filter((item) => item.categoryId === category.id).map((item) => item.id);
    const saved = await save(withDeletedItem({
      ...data,
      productCategories: data.productCategories.filter((entry) => entry.id !== category.id),
      recipes: kind === "recipe"
        ? data.recipes.map((recipe) => recipe.categoryId === category.id ? { ...recipe, categoryId: fallbackId } : recipe)
        : data.recipes,
      inventory: kind === "inventory"
        ? data.inventory.map((item) => item.categoryId === category.id ? { ...item, categoryId: fallbackId } : item)
        : data.inventory,
    }, {
      kind: "productCategory",
      entityId: category.id,
      label: category.name,
      section: kind === "recipe" ? "Taom tannarxi" : "Ombor",
      record: category,
      related: { memberIds },
    }, reason), `Kategoriya savatga ko‘chirildi · ${category.name} · Sabab: ${reason} · mahsulotlar Boshqa kategoriyasiga o‘tkazildi`);
    if (!saved) return;
    if (kind === "recipe") {
      setRecipeCategoryFilter("all");
      setRecipeForm((current) => current.categoryId === category.id ? { ...current, categoryId: fallbackId } : current);
    } else {
      setInventoryCategoryFilter("all");
      setStockForm((current) => current.categoryId === category.id ? { ...current, categoryId: fallbackId } : current);
    }
  };

  const deleteFixedExpense = (expense: FixedExpense) => {
    confirmMoveToTrash(expense.name, {
      ...data,
      fixedExpenses: data.fixedExpenses.filter((entry) => entry.id !== expense.id),
    }, {
      kind: "fixedExpense",
      entityId: expense.id,
      label: expense.name,
      section: "Xarajatlar",
      record: expense,
    }, `Doimiy xarajat savatga ko‘chirildi · ${expense.name}`);
  };

  const deleteDailyClose = (close: DailyClose) => {
    if (data.monthlyCloses.some((entry) => entry.month === close.date.slice(0, 7))) {
      setCloseNotice(`${close.date.slice(0, 7)} oyi yopilgan. Shu oyga tegishli kun yakunini o‘chirib bo‘lmaydi.`);
      setTab("finance");
      return;
    }
    confirmMoveToTrash(displayDate(close.date), {
      ...data,
      dailyCloses: data.dailyCloses.filter((entry) => entry.id !== close.id),
    }, {
      kind: "dailyClose",
      entityId: close.id,
      label: displayDate(close.date),
      section: "Hisob-kitob",
      record: close,
    }, `Kun yopish yozuvi savatga ko‘chirildi · ${displayDate(close.date)}`);
  };

  const deleteSupplier = (supplier: Supplier) => {
    if (Math.abs(Number(supplier.balance || 0)) > 0.000001) {
      setSupplierNotice(`${supplier.name} hisobida ${won(Math.abs(supplier.balance))} ochiq balans bor. Avval qarz/to‘lovni yoping, keyin savatga ko‘chiring.`);
      return;
    }
    confirmMoveToTrash(supplier.name, {
      ...data,
      suppliers: data.suppliers.filter((entry) => entry.id !== supplier.id),
    }, {
      kind: "supplier",
      entityId: supplier.id,
      label: supplier.name,
      section: "Oldi-berdi",
      record: supplier,
    }, `Yetkazib beruvchi savatga ko‘chirildi · ${supplier.name}`);
  };

  const resetTransactionDraft = () => {
    setTransactionForm({ supplierId: "", type: "purchase", amount: 0, date: today, note: "", accountId: "account-bank", settlementMode: "debt" });
    setEditingTransactionId("");
    setTransactionDocumentFile(null);
    setTransactionDocumentPreview("");
    setRemoveTransactionDocument(false);
    setTransactionFileInputKey((current) => current + 1);
    supplierTransactionOperationIdRef.current = "";
    supplierPendingDocumentRef.current = undefined;
    supplierEditingSnapshotRef.current = undefined;
    setSupplierDuplicateReason("");
    setSupplierDuplicateWarning(false);
  };

  const linkedTransactionPayment = (transaction: Transaction) => {
    const direct = data.financialEntries.find((entry) => entry.transactionId === transaction.id);
    if (direct) return { entry: direct, ambiguous: false };
    if (transaction.type !== "payment") return { entry: undefined, ambiguous: false };
    const legacy = data.financialEntries.filter((entry) => (
          !entry.transactionId
          && entry.type === "expense"
          && entry.category === "Mahsulot xaridi"
          && entry.date === transaction.date
          && entry.amount === transaction.amount
          && entry.note.includes(supplierName(transaction.supplierId))
        ));
    return { entry: legacy.length === 1 ? legacy[0] : undefined, ambiguous: legacy.length > 1 };
  };

  const isWorkerDeliveryTransaction = (transaction: Transaction) => transaction.id.startsWith("delivery-purchase:");
  const isWorkerDeliveryMovement = (movement: StockMovement) => movement.id.startsWith("delivery-receipt:");
  const isPurchaseOrderMovement = (movement: StockMovement) => Boolean(
    movement.referenceId && data.purchaseOrders.some((order) => order.id === movement.referenceId),
  );

  const deleteTransaction = async (transaction: Transaction) => {
    editTransaction(transaction);
    if (supplierSourceDocument(data, transaction)) return;
    setTransactionNotice("Quyidagi tahrir oynasida ‘Takroriy / xato qarzni olib tashlash’ tugmasini bosing. Bekor qilishdan oldin yangi qarz qoldig‘i ko‘rsatiladi.");
  };

  const resetMovementDraft = (type: "receipt" | "waste" | "adjustment" = "receipt") => {
    setMovementForm({ inventoryId: "", type, quantity: 0, unitCost: 0, supplierId: "", date: today, note: "" });
    setEditingMovementId("");
    setMovementDocumentFile(null);
    setMovementDocumentPreview("");
    setRemoveMovementDocument(false);
    setMovementFileInputKey((current) => current + 1);
  };

  const deleteRemoteStockDocument = async (key: string) => {
    try {
      await fetch("/api/stock-documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
    } catch {
      // The state is authoritative; an unreachable orphan can be cleaned later.
    }
  };

  const deleteStockMovement = async (movement: StockMovement) => {
    if (movementDeletionBusy) return;
    if (isWorkerDeliveryMovement(movement)) {
      setMovementNotice("Bu ombor harakati xodim kirimi va yetkazuvchi qarzi bilan bog‘langan. Hisoblar buzilmasligi uchun uni alohida o‘chirib bo‘lmaydi.");
      return;
    }
    if (isPurchaseOrderMovement(movement)) {
      setMovementNotice("Bu kirim Xarid buyurtmasiga bog‘langan. Ombor, yetkazuvchi qarzi va buyurtma holati buzilmasligi uchun uni Nazorat markazi → Xaridlar nazoratidan boshqaring.");
      return;
    }
    if (movement.type === "sale") {
      setMovementNotice("Savdoga tegishli chiqimni Savdo bo‘limidan bekor qiling.");
      return;
    }
    const item = data.inventory.find((entry) => entry.id === movement.inventoryId);
    if (!item) return;
    if (item.stock - movement.quantity < 0) {
      setMovementNotice("Bu yozuvni o‘chirish qoldiqni minusga tushiradi.");
      return;
    }
    if (!window.confirm(`“${item.name} · ${movement.quantity > 0 ? "+" : ""}${movement.quantity.toLocaleString()} ${item.unit}” ombor yozuvi o‘chirilsinmi?\n\nOmbor qoldig‘i avtomatik qayta hisoblanadi. Yozuv “Bekor qilinganlar” tarixiga ko‘chadi va u yerdan tiklanadi.`)) return;
    const reason = askCancellationReason(`${item.name} · ${movement.quantity}`);
    if (!reason) return;
    setMovementDeletionBusy(movement.id);
    setMovementNotice(`${item.name} ombor yozuvi o‘chirilmoqda…`);
    setStatus("Ombor harakati o‘chirilmoqda…");
    try {
      const result = await deleteWarehouseRecord("stockMovement", movement.id, reason);
      // Keep the old file in R2 so the automatic pre-delete archive can restore it.
      if (editingMovementId === movement.id) resetMovementDraft();
      setMovementNotice(result.alreadyDeleted
        ? `✓ ${item.name} yozuvi avval o‘chirilgan edi; Ombor tarixi yangilandi.`
        : `✓ ${item.name} ombor yozuvi o‘chirildi, qoldiq qayta hisoblandi va sabab “Bekor qilinganlar” tarixiga yozildi.`);
      setStatus("✓ Ombor harakati o‘chirildi");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ombor harakati o‘chirilmadi. Qayta urinib ko‘ring.";
      setMovementNotice(message);
      setStatus(message);
    } finally {
      setMovementDeletionBusy("");
    }
  };

  const restoreDeletedItem = async (archive: DeletedItem): Promise<{ ok: boolean; message: string }> => {
    if (archive.related?.removalOperationId) return { ok:false, message:"Bu amal bog‘langan hisoblari bilan olib tashlangan. Alohida qatorni tiklash hisobni buzishi mumkin. Asl nusxa va hisob o‘zgarishi ‘Olib tashlash tarixi’da saqlangan; kerak bo‘lsa to‘g‘ri yozuvni qayta kiriting." };
    if (archive.related?.warehouseDocumentId) return { ok: false, message: "Bu butun kirim hujjati bekor qilingan. Nusxasi Ombor → Tahrir va bekor qilish tarixida. Alohida qarz yozuvini tiklash mumkin emas; zarur bo‘lsa yangi kirim kiriting." };
    if (archive.restoredAt) return { ok: false, message: "Bu yozuv oldin tiklangan." };
    const fail = (message: string) => {
      setStatus(message);
      return { ok: false, message };
    };
    const complete = async (next: AppState) => {
      const saved = await save({
        ...next,
        deletedItems: markDeletedItemRestored(data.deletedItems, archive.id),
      }, `${archive.section} yozuvi savatdan tiklandi · ${archive.label}`);
      return saved
        ? { ok: true, message: `✓ “${archive.label}” tiklandi. Keyin kiritilgan boshqa ma’lumotlar o‘zgarmadi.` }
        : { ok: false, message: "Tiklash saqlanmadi. Internetni tekshirib, qayta bosing." };
    };

    if (String(archive.record.id || "") !== archive.entityId) {
      return fail("Savatdagi tiklash yozuvi buzilgan. Tizim zaxirasidan foydalaning.");
    }

    if (archive.kind === "inventory") {
      const record = archive.record as unknown as Inventory;
      if (data.inventory.some((entry) => entry.id === record.id)) return fail("Bu mahsulot omborda allaqachon bor.");
      if (data.inventory.some((entry) => normalizeHumanNameKey(entry.name) === normalizeHumanNameKey(record.name))) {
        return fail(`“${record.name}” nomli boshqa mahsulot bor. Avval uning nomini o‘zgartiring.`);
      }
      const movements = archivedInventoryMovements<StockMovement>(archive);
      if (movements.some((movement) => data.stockMovements.some((entry) => entry.id === movement.id))) {
        return fail("Bu mahsulotning eski Ombor harakatlaridan biri allaqachon faol. Takroriy qoldiq yaratmaslik uchun tiklash to‘xtatildi.");
      }
      const restoredMovements = [...movements, ...data.stockMovements]
        .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
      return complete({
        ...data,
        inventory: [record, ...data.inventory],
        stockMovements: restoredMovements,
      });
    }

    if (archive.kind === "recipe") {
      const record = archive.record as unknown as Recipe;
      if (data.recipes.some((entry) => entry.id === record.id)) return fail("Bu taom allaqachon faol.");
      if (data.recipes.some((entry) => normalizeHumanNameKey(entry.name) === normalizeHumanNameKey(record.name))) {
        return fail(`“${record.name}” nomli boshqa taom bor. Avval uning nomini o‘zgartiring.`);
      }
      return complete({ ...data, recipes: [record, ...data.recipes] });
    }

    if (archive.kind === "productCategory") {
      const record = archive.record as unknown as ProductCategory;
      if (data.productCategories.some((entry) => entry.id === record.id)) return fail("Bu kategoriya allaqachon faol.");
      const fallbackId = record.kind === "recipe" ? RECIPE_FALLBACK_CATEGORY_ID : INVENTORY_FALLBACK_CATEGORY_ID;
      const memberIds = new Set(Array.isArray(archive.related?.memberIds)
        ? archive.related.memberIds.map(String)
        : []);
      return complete({
        ...data,
        productCategories: [...data.productCategories, record],
        recipes: record.kind === "recipe"
          ? data.recipes.map((entry) => memberIds.has(entry.id) && entry.categoryId === fallbackId
            ? { ...entry, categoryId: record.id }
            : entry)
          : data.recipes,
        inventory: record.kind === "inventory"
          ? data.inventory.map((entry) => memberIds.has(entry.id) && entry.categoryId === fallbackId
            ? { ...entry, categoryId: record.id }
            : entry)
          : data.inventory,
      });
    }

    if (archive.kind === "fixedExpense") {
      const record = archive.record as unknown as FixedExpense;
      if (data.fixedExpenses.some((entry) => entry.id === record.id)) return fail("Bu doimiy xarajat allaqachon faol.");
      const billingDay = record.billingDay || Number(record.nextDue.slice(8, 10));
      const restored = record.active && record.automatic && record.frequency === "monthly" && record.nextDue <= today
        ? { ...record, nextDue: nextRecurringExpenseDateAfter(record.nextDue, billingDay, today) }
        : record;
      return complete({ ...data, fixedExpenses: [restored, ...data.fixedExpenses] });
    }

    if (archive.kind === "dailyClose") {
      const record = archive.record as unknown as DailyClose;
      if (data.dailyCloses.some((entry) => entry.id === record.id || entry.date === record.date)) {
        return fail("Bu sana uchun kun yopish yozuvi allaqachon bor.");
      }
      return complete({ ...data, dailyCloses: [record, ...data.dailyCloses] });
    }

    if (archive.kind === "supplier") {
      const record = archive.record as unknown as Supplier;
      if (data.suppliers.some((entry) => entry.id === record.id)) return fail("Bu yetkazib beruvchi allaqachon faol.");
      if (data.suppliers.some((entry) => normalizeHumanNameKey(entry.name) === normalizeHumanNameKey(record.name))) {
        return fail(`“${record.name}” nomli boshqa yetkazib beruvchi bor.`);
      }
      return complete({ ...data, suppliers: [record, ...data.suppliers] });
    }

    if (archive.kind === "transaction") {
      const record = archive.record as unknown as Transaction;
      if (data.transactions.some((entry) => entry.id === record.id)) return fail("Bu oldi-berdi yozuvi allaqachon faol.");
      if (!data.suppliers.some((entry) => entry.id === record.supplierId)) {
        return fail(`Avval “${supplierName(record.supplierId)}” yetkazib beruvchisini tiklang.`);
      }
      const nextSuppliers = rebalanceSuppliers(data.suppliers, null, record);
      if (!nextSuppliers) return fail("Yetkazib beruvchi balansi tiklanmadi.");
      const financialEntry = archive.related?.financialEntry as FinancialEntry | undefined;
      if (financialEntry && data.financialEntries.some((entry) => entry.id === financialEntry.id)) {
        return fail("Bog‘langan pul yozuvi allaqachon mavjud.");
      }
      if (financialEntry && !data.accounts.some((entry) => entry.id === financialEntry.accountId)) {
        return fail("Bog‘langan pul hisobi topilmadi.");
      }
      return complete({
        ...data,
        suppliers: nextSuppliers,
        transactions: [record, ...data.transactions],
        financialEntries: financialEntry ? [financialEntry, ...data.financialEntries] : data.financialEntries,
      });
    }

    if (archive.kind === "stockMovement") {
      const record = archive.record as unknown as StockMovement;
      if (data.stockMovements.some((entry) => entry.id === record.id)) return fail("Bu ombor harakati allaqachon faol.");
      const inventoryItem = data.inventory.find((entry) => entry.id === record.inventoryId);
      if (!inventoryItem) return fail(`Avval “${inventoryName(record.inventoryId)}” mahsulotini tiklang.`);
      if (inventoryItem.stock + record.quantity < -0.000001) {
        return fail(`${inventoryItem.name} qoldig‘i yetmaydi. Tiklash omborni minusga tushiradi.`);
      }
      const movements = [record, ...data.stockMovements];
      const inventory = receiptCostsForInventory(data.inventory.map((entry) => entry.id === inventoryItem.id
        ? { ...entry, stock: entry.stock + record.quantity }
        : entry), movements, {}, new Set([inventoryItem.id]));
      return complete({ ...data, inventory, stockMovements: movements });
    }

    if (archive.kind === "sale") {
      const record = archive.record as unknown as Sale;
      if (data.sales.some((entry) => entry.id === record.id)) return fail("Bu savdo allaqachon faol.");
      const movements = Array.isArray(archive.related?.movements)
        ? archive.related.movements as StockMovement[]
        : [];
      if (movements.some((movement) => data.stockMovements.some((entry) => entry.id === movement.id))) {
        return fail("Savdoga bog‘langan ombor yozuvi allaqachon mavjud.");
      }
      const required = new Map<string, number>();
      if (Array.isArray(record.stockUsage) && record.stockUsage.length) {
        record.stockUsage.forEach((usage) => {
          if (!usage.inventoryId) return;
          required.set(
            usage.inventoryId,
            (required.get(usage.inventoryId) || 0) + Number(usage.deductedQuantity ?? usage.quantity ?? 0),
          );
        });
      } else {
        movements.forEach((movement) => {
          if (movement.quantity < 0) required.set(
            movement.inventoryId,
            (required.get(movement.inventoryId) || 0) - movement.quantity,
          );
        });
      }
      for (const [inventoryId, quantity] of required) {
        const inventoryItem = data.inventory.find((entry) => entry.id === inventoryId);
        if (!inventoryItem) return fail(`Avval “${inventoryName(inventoryId)}” mahsulotini tiklang.`);
        if (inventoryItem.stock + 0.000001 < quantity) {
          return fail(`${inventoryItem.name} qoldig‘i yetmaydi: kerak ${quantity.toLocaleString()} ${inventoryItem.unit}.`);
        }
      }
      return complete({
        ...data,
        inventory: data.inventory.map((entry) => ({
          ...entry,
          stock: entry.stock - (required.get(entry.id) || 0),
        })),
        sales: [record, ...data.sales],
        stockMovements: [...movements, ...data.stockMovements],
      });
    }

    if (archive.kind === "mezanaEntry") {
      const record = archive.record as unknown as MezanaDebtEntry;
      if (!validMezanaDebtEntry(record)) return fail("Savatdagi MEZANA yozuvi buzilgan.");
      if (data.mezanaEntries.some((entry) => entry.id === record.id)) return fail("Bu MEZANA yozuvi allaqachon faol.");
      const nextEntries = [record, ...data.mezanaEntries];
      if (hasNegativeMezanaBorrowedQuantity(nextEntries)) {
        return fail("Bu yozuvni tiklash olib turilgan mahsulot sonini minusga tushiradi.");
      }
      if (mezanaDebtBalance(nextEntries) < 0) {
        return fail("Bu yozuvni tiklash MEZANA qarzini minusga tushiradi. Avval boshqa MEZANA yozuvlarini tekshiring.");
      }
      return complete({ ...data, mezanaEntries: nextEntries });
    }

    return fail("Bu savat yozuvi hozir tiklanmaydi.");
  };

  const recipeMarginAudits = useMemo(() => new Map(data.recipes.map((recipe) => [
    recipe.id,
    calculateRecipeMarginAudit(recipe, data.inventory),
  ])), [data.inventory, data.recipes]);
  const recipeMarginAudit = (recipe: Recipe) => recipeMarginAudits.get(recipe.id) || calculateRecipeMarginAudit(recipe, data.inventory);
  const recipeCostBreakdown = (recipe: Recipe) => recipeMarginAudit(recipe) || {
    ingredientCost: 0,
    extraCost: 0,
    totalCost: 0,
  };
  const recipeCost = (recipe: Recipe) => recipeCostBreakdown(recipe).totalCost;
  const draftRecipeIngredients = normalizeRecipeIngredients(recipeForm.ingredients.map((ingredient) => ({
    id: ingredient.id,
    inventoryId: ingredient.inventoryId,
    name: ingredient.name,
    unit: ingredient.unit,
    quantity: Number(ingredient.quantity),
    lineCost: Number(ingredient.lineCost),
    unitCost: Number(ingredient.quantity) > 0 ? Number(ingredient.lineCost) / Number(ingredient.quantity) : 0,
  })), data.inventory);
  const draftIngredientCost = calculateRecipeCost(draftRecipeIngredients, data.inventory);
  const draftExtraCost = calculateRecipeExtraCost(recipeForm.extraCosts);
  const draftRecipeCost = draftIngredientCost + draftExtraCost;
  const draftRecipeProfit = recipeForm.salePrice - draftRecipeCost;
  const draftRecipeMargin = recipeForm.salePrice > 0 ? draftRecipeProfit / recipeForm.salePrice * 100 : 0;
  const hasIncompleteRecipeIngredient = !recipeForm.ingredients.every((ingredient) => (
    Boolean(ingredient.name.trim())
    && Number.isFinite(Number(ingredient.quantity))
    && Number(ingredient.quantity) > 0
    && Number.isFinite(Number(ingredient.lineCost))
    && Number(ingredient.lineCost) > 0
  ));
  const canAddRecipeIngredient = !hasIncompleteRecipeIngredient && recipeForm.ingredients.length < 30;
  const recipeIngredientSuggestions = [...new Set([
    ...data.inventory.map((item) => item.name.trim()),
    ...data.recipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.name?.trim() || "")),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, "uz"));
  const recipeCategories = categoriesForKind(data.productCategories, "recipe");
  const inventoryCategories = categoriesForKind(data.productCategories, "inventory");
  const sellableRecipes = useMemo(
    () => data.recipes.filter((recipe) => recipeIsSellable(recipe, data.inventory)),
    [data.inventory, data.recipes],
  );
  const unavailableRecipeIds = useMemo(
    () => new Set(data.recipes.filter((recipe) => !recipeIsSellable(recipe, data.inventory)).map((recipe) => recipe.id)),
    [data.inventory, data.recipes],
  );
  const visibleBatchRecipes = data.recipes.filter((recipe) => (
    !batchSaleSearch.trim()
    || recipe.name.toLocaleLowerCase("uz-UZ").includes(batchSaleSearch.trim().toLocaleLowerCase("uz-UZ"))
    || normalizeMenuCode(recipe.posCode).includes(normalizeMenuCode(batchSaleSearch))
  ));
  const batchSelectedRecipes = data.recipes.filter((recipe) => Number(batchSaleQuantities[recipe.id] || 0) > 0);
  const batchSelectedKinds = batchSelectedRecipes.length;
  const batchSelectedQuantity = batchSelectedRecipes.reduce((sum, recipe) => sum + Number(batchSaleQuantities[recipe.id] || 0), 0);
  const batchSelectedRevenue = batchSelectedRecipes.reduce((sum, recipe) => (
    sum + recipe.salePrice * Number(batchSaleQuantities[recipe.id] || 0)
  ), 0);
  const visibleDeliveryRecipes = data.recipes.filter((recipe) => (
    !deliverySaleSearch.trim()
    || recipe.name.toLocaleLowerCase("uz-UZ").includes(deliverySaleSearch.trim().toLocaleLowerCase("uz-UZ"))
    || normalizeMenuCode(recipe.posCode).includes(normalizeMenuCode(deliverySaleSearch))
  ));
  const visibleDeliveryPriceRecipes = data.recipes.filter((recipe) => (
    !deliveryPriceSearch.trim()
    || recipe.name.toLocaleLowerCase("uz-UZ").includes(deliveryPriceSearch.trim().toLocaleLowerCase("uz-UZ"))
    || normalizeMenuCode(recipe.posCode).includes(normalizeMenuCode(deliveryPriceSearch))
  ));
  const deliveryEditingSale = data.sales.find((sale) => sale.id === editingDeliverySaleId);
  const deliveryEditingBatchSales = deliveryEditingSale?.deliveryBatchId
    ? data.sales.filter((sale) => sale.deliveryBatchId === deliveryEditingSale.deliveryBatchId)
    : deliveryEditingSale ? [deliveryEditingSale] : [];
  const deliveryEditingSaleByRecipe = new Map(deliveryEditingBatchSales.map((sale) => [sale.recipeId, sale]));
  const deliverySelectedRecipes = data.recipes.filter((recipe) => Number(deliverySaleQuantities[recipe.id] || 0) > 0);
  const deliverySelectedKinds = deliverySelectedRecipes.length;
  const deliverySelectedQuantity = deliverySelectedRecipes.reduce((sum, recipe) => sum + Number(deliverySaleQuantities[recipe.id] || 0), 0);
  const deliverySelectedRevenue = deliverySelectedRecipes.reduce((sum, recipe) => (
    sum + (() => {
      const savedSale = deliveryEditingSaleByRecipe.get(recipe.id);
      const unitPrice = savedSale && savedSale.deliveryPlatform === deliverySaleForm.platform
        ? savedSale.unitPrice
        : deliveryMenuPrice(recipe, deliverySaleForm.platform);
      return unitPrice * Number(deliverySaleQuantities[recipe.id] || 0);
    })()
  ), 0);
  const deliverySelectedCost = deliverySelectedRecipes.reduce((sum, recipe) => (
    sum + (() => {
      const savedSale = deliveryEditingSaleByRecipe.get(recipe.id);
      const perItem = savedSale && savedSale.quantity > 0
        ? savedSale.totalCost / savedSale.quantity
        : recipeCost(recipe);
      return perItem * Number(deliverySaleQuantities[recipe.id] || 0);
    })()
  ), 0);
  const deliverySaleFeeRule = deliveryFeeRuleForOrder(data.costRules, deliverySaleForm.platform, deliveryEditingSale);
  const deliveryUsesSavedFees = Boolean(editingDeliverySaleId && (isDeliveryPlatform(deliveryEditingSale?.deliveryPlatform) ? deliveryEditingSale.deliveryPlatform : "coupang") === deliverySaleForm.platform);
  const deliveryAppliedManualFees = deliveryUsesSavedFees
    ? deliveryManualFees
    : deliveryAutomaticManualFees(deliverySaleFeeRule);
  const deliverySelectedFeeBreakdown = calculateDeliveryManualFees(deliverySelectedRevenue, deliveryAppliedManualFees);
  const deliveryOrderAdjustments: DeliveryOrderAdjustments = {
    couponWon: deliverySelectedFeeBreakdown.coupon,
    instantDiscountWon: deliverySelectedFeeBreakdown.instantDiscount,
    deliveryFeeWon: deliverySelectedFeeBreakdown.delivery,
  };
  const deliveryAdjustmentsValid = validDeliveryManualFees(deliveryAppliedManualFees, deliverySelectedRevenue);
  const deliverySelectedCommission = deliverySelectedFeeBreakdown.total;
  const deliverySaleCommissionPct = deliverySelectedRevenue > 0
    ? deliverySelectedCommission / deliverySelectedRevenue * 100
    : 0;
  const activeFeePlatformRule = feeRuleForm.deliveryPlatformRules?.[feeRulePlatform] ?? deliveryFeeRuleForPlatform(feeRuleForm, feeRulePlatform);
  const updateActiveFeePlatformRule = (patch: Partial<DeliveryFeeRule>) => {
    feeRuleDirtyRef.current = true;
    setFeeRuleNotice("");
    setFeeRuleForm((current) => ({
      ...current,
      deliveryPlatformRules: {
        ...current.deliveryPlatformRules,
        [feeRulePlatform]: {
          ...deliveryFeeRuleForPlatform(current, feeRulePlatform),
          ...patch,
        },
      },
    }));
  };
  const updateActiveSimpleDeliveryRule = (patch: { combinedPct?: number; deliveryFeeWon?: number; instantDiscountWon?: number }) => {
    updateActiveFeePlatformRule({
      combinedPct: patch.combinedPct ?? activeFeePlatformRule.combinedPct ?? deliveryCombinedPercent(activeFeePlatformRule),
      deliveryFeeWon: patch.deliveryFeeWon ?? activeFeePlatformRule.deliveryFeeWon,
      instantDiscountWon: patch.instantDiscountWon ?? activeFeePlatformRule.instantDiscountWon,
      brokeragePct: 0,
      paymentPct: 0,
      vatPct: 0,
      couponPct: 0,
      advertisingPct: 0,
    });
  };
  const cashSaleVisibleRecipes = data.recipes.filter((recipe) => (
    !cashSaleSearch.trim()
    || recipe.name.toLocaleLowerCase("uz-UZ").includes(cashSaleSearch.trim().toLocaleLowerCase("uz-UZ"))
    || normalizeMenuCode(recipe.posCode).includes(normalizeMenuCode(cashSaleSearch))
  ));
  const cashSaleSelectedRecipes = data.recipes.filter((recipe) => Number(cashSaleQuantities[recipe.id] || 0) > 0);
  const cashSaleSelectedKinds = cashSaleSelectedRecipes.length;
  const cashSaleSelectedQuantity = cashSaleSelectedRecipes.reduce((sum, recipe) => sum + Number(cashSaleQuantities[recipe.id] || 0), 0);
  const cashSaleSelectedCost = cashSaleSelectedRecipes.reduce((sum, recipe) => (
    sum + recipeCost(recipe) * Number(cashSaleQuantities[recipe.id] || 0)
  ), 0);
  const categoryName = (categoryId: string, kind: ProductCategoryKind) => (
    data.productCategories.find((category) => category.kind === kind && category.id === categoryId)?.name
    || (kind === "recipe" ? "Boshqa taom" : "Boshqa xomashyo")
  );
  const filteredRecipes = recipeCategoryFilter === "all"
    ? data.recipes
    : data.recipes.filter((recipe) => recipe.categoryId === recipeCategoryFilter);
  const inventoryValue = data.inventory.filter(item => !isExpenseOnlyInventory(item)).reduce((sum, item) => sum + item.stock * item.unitCost, 0);
  const debt = data.suppliers
    .filter((supplier) => !isMezanaSupplierName(supplier.name))
    .reduce((sum, supplier) => sum + Math.max(0, supplier.balance), 0);
  const mezanaCurrentBalance = Math.max(0, mezanaDebtBalance(data.mezanaEntries));
  const mezanaOpenBorrowedItems = data.mezanaCatalog
    .filter((item) => item.mode === "borrowed")
    .map((item) => ({
      item,
      balance: Math.max(0, data.mezanaEntries.reduce((total, entry) => {
        const matches = entry.catalogItemId
          ? entry.catalogItemId === item.id
          : entry.productName.trim().toLocaleLowerCase("uz-UZ") === item.name.trim().toLocaleLowerCase("uz-UZ");
        if (!matches) return total;
        if (entry.action === "borrowed") return total + Number(entry.quantity || 0);
        if (entry.action === "returned") return total - Number(entry.quantity || 0);
        return total;
      }, 0)),
    }))
    .filter(({ balance }) => balance > 0);
  const ownerMezanaAvailableCatalog = data.mezanaCatalog.filter((item) => {
    if (!item.active) return false;
    if (ownerMezanaForm.action === "purchased") return item.mode === "purchased";
    if (ownerMezanaForm.action === "borrowed") return item.mode === "borrowed";
    return item.mode === "borrowed" && mezanaOpenBorrowedItems.some((open) => open.item.id === item.id);
  });
  const ownerSelectedMezanaCatalogItem = data.mezanaCatalog.find((item) => item.id === ownerMezanaForm.catalogItemId) || null;
  const totalSupplierDebt = debt;
  const supplierDebtAccountCount = data.suppliers.filter((supplier) => (
    !isMezanaSupplierName(supplier.name) && supplier.balance > 0
  )).length;
  const lowStock = data.inventory.filter((item) => !item.catalogArchived && !isExpenseOnlyInventory(item) && item.stock <= item.minStock);
  const accountTypes = useMemo(() => new Map(data.accounts.map((account) => [account.id, account.type])), [data.accounts]);
  const posAccounts = useMemo(() => data.accounts.filter((account) => account.type === "card"), [data.accounts]);
  const deliveryAccount = useMemo(() => data.accounts.find((account) => account.type === "delivery"), [data.accounts]);
  const posTaxableSales = useMemo(() => data.sales.filter((sale) => {
    const accountType = accountTypes.get(String(sale.accountId || "account-card")) || "card";
    return accountType === "card" && isAutomaticTaxSale(sale, accountType);
  }), [accountTypes, data.sales]);
  const deliverySales = useMemo(() => data.sales.filter((sale) => (
    isDeliverySale(sale, accountTypes.get(String(sale.accountId || "")))
  )), [accountTypes, data.sales]);
  const todaySales = useMemo(() => data.sales.filter((sale) => sale.date === today), [data.sales, today]);
  const todayPosSales = useMemo(() => posTaxableSales.filter((sale) => sale.date === today), [posTaxableSales, today]);
  const todayFinancialSales = todayPosSales;
  const todayPosRevenue = todayPosSales.reduce((sum, sale) => sum + sale.totalRevenue, 0);
  const todayPosCost = todayPosSales.reduce((sum, sale) => sum + sale.totalCost, 0);
  const todayPosItems = todayPosSales.reduce((sum, sale) => sum + sale.quantity, 0);
  const todayReport = useMemo(() => calculateDailyReport(data, today), [data, today]);
  const todayRevenue = todayReport.revenue;
  const todayCost = todayReport.cost;
  const todayProfit = todayReport.grossProfit;
  const todayEnteredExpenses = todayReport.enteredExpenses;
  const todayRecurringExpenses = todayReport.recurringExpenses;
  const todayPayroll = todayReport.payroll;
  const todayAutomaticCosts = todayReport.automaticExpenses;
  const todayTotalExpenses = todayReport.totalExpenses;
  const todayNetProfit = todayReport.netProfit;
  const todayItems = todayReport.itemCount;
  const todayOpenShiftCount = data.workShifts.filter((shift) => shift.date === today && shift.status === "open").length;
  const feeReportState = data;
  const feeDayReport = useMemo(
    () => calculateDailyReport(feeReportState, feeReportDate),
    [feeReportDate, feeReportState],
  );
  const feeAnalysisRange = sectionDateRanges.fees;
  const feeRangeRows = useMemo(() => {
    if (tab !== "fees") return [];
    const dates = [...new Set([
      ...data.sales.map((sale) => sale.date),
      ...data.financialEntries.map((entry) => entry.date),
      ...data.workerConsumptions.map((entry) => String(entry.date || "")),
    ].filter((date) => dateIsInRange(date, feeAnalysisRange)))].sort((left, right) => right.localeCompare(left));
    return dates.map((date) => ({
      date,
      report: calculateDailyReport(feeReportState, date),
    }));
  }, [tab, data.financialEntries, data.sales, data.workerConsumptions, feeAnalysisRange, feeReportState]);
  const feeRangeTotals = useMemo(() => feeRangeRows.reduce((total, row) => ({
    revenue: total.revenue + row.report.revenue,
    cardSales: total.cardSales + row.report.cardSales,
    cashSales: total.cashSales + row.report.cashSales,
    bankSales: total.bankSales + row.report.bankSales,
    cardCommission: total.cardCommission + row.report.cardCommission,
    taxableSales: total.taxableSales + row.report.taxableSales,
    taxExemptSales: total.taxExemptSales + row.report.taxExemptSales,
    tax: total.tax + row.report.tax,
    deliveryCommission: total.deliveryCommission + row.report.deliveryCommission,
    deliverySales: total.deliverySales + row.report.deliverySales,
  }), { revenue: 0, cardSales: 0, cashSales: 0, bankSales: 0, cardCommission: 0, taxableSales: 0, taxExemptSales: 0, tax: 0, deliveryCommission: 0, deliverySales: 0 }), [feeRangeRows]);
  const feeRangeNet = feeRangeTotals.revenue - feeRangeTotals.cardCommission - feeRangeTotals.deliveryCommission - feeRangeTotals.tax;
  const cashBankSales = useMemo(() => {
    return data.sales.filter((sale) => {
      const accountType = accountTypes.get(String(sale.accountId || ""));
      return (accountType === "cash" || accountType === "bank")
        && !isAutomaticTaxSale(sale, accountType);
    });
  }, [accountTypes, data.sales]);
  const cashBankRangeSales = useMemo(() => filterDateRange(
    cashBankSales,
    sectionDateRanges.cashbank,
    (sale) => sale.date,
  ), [cashBankSales, sectionDateRanges.cashbank]);
  const cashBankRangeRevenue = cashBankRangeSales.reduce((sum, sale) => sum + sale.totalRevenue, 0);
  const cashBankRangeCost = cashBankRangeSales.reduce((sum, sale) => sum + sale.totalCost, 0);
  const cashBankRangeQuantity = cashBankRangeSales.reduce((sum, sale) => sum + sale.quantity, 0);
  const cashBankRangeCash = cashBankRangeSales.reduce((sum, sale) => (
    data.accounts.find((account) => account.id === sale.accountId)?.type === "cash"
      ? sum + sale.totalRevenue
      : sum
  ), 0);
  const cashBankRangeBank = cashBankRangeRevenue - cashBankRangeCash;
  const cashBankSaleOrderMeta = (saleId: string) => {
    for (const rawOrder of data.posOrders) {
      const order = rawOrder as Record<string, unknown>;
      const items = Array.isArray(order.items) ? order.items as Array<Record<string, unknown>> : [];
      if (items.some((item) => String(item.saleId || "") === saleId)) {
        return {
          workerName: String(order.workerName || "Xodim"),
          createdAt: String(order.createdAt || ""),
        };
      }
    }
    return { workerName: "Rahbar / import", createdAt: "" };
  };
  const cashSaleRangeSales = useMemo(() => data.workerConsumptions.filter((entry) => (
    ["inventory_only", "meal", "product", "waste"].includes(String(entry.kind || ""))
    && dateIsInRange(String(entry.date || ""), sectionDateRanges.cashsales)
  )) as unknown as InventoryOnlyEntry[], [data.workerConsumptions, sectionDateRanges.cashsales]);
  const cashSaleRangeCost = cashSaleRangeSales.reduce((sum, entry) => sum + safeOutflowNumber(entry.totalCost), 0);
  const accountingToday = localDate();
  const activeFinancialEntries = useMemo(
    () => selectActiveFinancialEntries(data.financialEntries),
    [data.financialEntries],
  );
  const reversedFinancialIds = useMemo(
    () => new Set(data.financialEntries.flatMap((entry) => entry.reversedEntryId ? [entry.reversedEntryId] : [])),
    [data.financialEntries],
  );
  const todayRecipeTotals = new Map<string, number>();
  todaySales.forEach((sale) => todayRecipeTotals.set(sale.recipeId, (todayRecipeTotals.get(sale.recipeId) ?? 0) + sale.quantity));
  const topTodayRecipe = [...todayRecipeTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const accountBalances = useMemo(() => {
    const current = calculateAccountBalances(data, accountingToday);
    return { current: current.balances, close: calculateAccountBalances(data, closeForm.date).balances, unmatched: current.unmatched };
  }, [accountingToday, activeFinancialEntries, closeForm.date, data.accounts, data.sales]);
  const accountBalance = (accountId: string) => accountBalances.current.get(accountId) || 0;
  const totalAccountBalance = [...accountBalances.current.values()].reduce((sum, balance) => sum + balance, 0);
  const closeReport = useMemo(() => calculateDailyReport(data, closeForm.date), [closeForm.date, data]);
  const closeTotalOperatingExpenses = closeReport.totalExpenses;
  const closeExpectedByAccount = Object.fromEntries(data.accounts.map((account) => [account.id, accountBalances.close.get(account.id) || 0]));
  const closeExpectedTotal = Object.values(closeExpectedByAccount).reduce((sum, value) => sum + value, 0);
  const closeActualTotal = data.accounts.reduce((sum, account) => sum + (closeForm.actualByAccount[account.id] ?? 0), 0);
  const closeAccountsComplete = data.accounts.every((account) => Object.prototype.hasOwnProperty.call(closeForm.actualByAccount, account.id));
  const closeDifference = closeActualTotal - closeExpectedTotal;
  const closeHasAccountDifference = data.accounts.some(a => Object.prototype.hasOwnProperty.call(closeForm.actualByAccount,a.id) && closeForm.actualByAccount[a.id] !== (closeExpectedByAccount[a.id] ?? 0));
  const closeGrossProfit = closeReport.grossProfit;
  const closeNetProfit = closeReport.netProfit;
  const incompleteRecipeCount = data.recipes.filter((recipe) => !recipeMarginAudit(recipe).complete).length;
  const currentWeekSales = data.sales.filter((sale) => {
    const age = daysBetween(today, sale.date);
    return age >= 0 && age < 7;
  });
  const previousWeekSales = data.sales.filter((sale) => {
    const age = daysBetween(today, sale.date);
    return age >= 7 && age < 14;
  });
  const summarizeSales = (sales: Sale[]) => {
    const revenue = sales.reduce((sum, sale) => sum + sale.totalRevenue, 0);
    const cost = sales.reduce((sum, sale) => sum + sale.totalCost, 0);
    return { revenue, cost, profit: revenue - cost, items: sales.reduce((sum, sale) => sum + sale.quantity, 0) };
  };
  const currentWeek = summarizeSales(currentWeekSales);
  const previousWeek = summarizeSales(previousWeekSales);
  const weekChange = previousWeek.revenue ? ((currentWeek.revenue - previousWeek.revenue) / previousWeek.revenue) * 100 : currentWeek.revenue ? 100 : 0;
  const recentUsage = new Map<string, number>();
  currentWeekSales.forEach((sale) => {
    const recipe = data.recipes.find((entry) => entry.id === sale.recipeId);
    const usage = Array.isArray(sale.stockUsage)
      ? sale.stockUsage
      : (recipe?.ingredients ?? []).map((ingredient) => ({ ...ingredient, quantity: ingredient.quantity * sale.quantity }));
    usage.forEach((ingredient) => {
      recentUsage.set(ingredient.inventoryId, (recentUsage.get(ingredient.inventoryId) ?? 0) + ingredient.quantity);
    });
  });
  const stockForecast = data.inventory.filter(item => !item.catalogArchived && !isExpenseOnlyInventory(item)).map((item) => {
    const dailyUsage = (recentUsage.get(item.id) ?? 0) / 7;
    const daysLeft = dailyUsage > 0 ? item.stock / dailyUsage : null;
    const target = Math.max(item.minStock * 2, Math.ceil(dailyUsage * 7));
    const shouldBuy = item.stock <= item.minStock || (daysLeft !== null && daysLeft <= 3);
    return { ...item, dailyUsage, daysLeft, buyQuantity: shouldBuy ? Math.max(0, target - item.stock) : 0 };
  });
  const inventorySearchKey = normalizeHumanNameKey(inventorySearch);
  const filteredStockForecast = stockForecast
    .filter((item) => inventoryCategoryFilter === "all" || item.categoryId === inventoryCategoryFilter)
    .filter((item) => !inventorySearchKey || normalizeHumanNameKey(item.name).includes(inventorySearchKey))
    .filter((item) => inventoryStockFilter === "all"
      || (inventoryStockFilter === "low" ? item.stock <= item.minStock : item.stock > item.minStock))
    .sort((left, right) => (
      Number(left.stock > left.minStock) - Number(right.stock > right.minStock)
      || left.name.localeCompare(right.name, "uz")
    ));
  const inventoryCountItems = filteredStockForecast.filter((item) => (
    inventoryCountSupplierId === "all" || item.supplierId === inventoryCountSupplierId
  ));
  const inventoryCountEnteredRows = inventoryCountItems.flatMap((item) => {
    const raw = inventoryCountValues[item.id] ?? "";
    if (raw.trim() === "" || !Number.isFinite(Number(raw))) return [];
    const actual = Number(raw);
    return [{ item, actual, difference: actual - item.stock }];
  });
  const inventoryCountSystemValue = inventoryCountEnteredRows.reduce((sum, row) => sum + row.item.stock * row.item.unitCost, 0);
  const inventoryCountActualValue = inventoryCountEnteredRows.reduce((sum, row) => sum + row.actual * row.item.unitCost, 0);
  const inventoryCountValueDifference = inventoryCountActualValue - inventoryCountSystemValue;
  const lowStockCount = stockForecast.filter((item) => item.stock <= item.minStock).length;
  const inventoryTotalValue = data.inventory.filter(item=>!isExpenseOnlyInventory(item)).reduce((sum, item) => sum + item.stock * item.unitCost, 0);
  const visibleStockMovements = useMemo(() => selectActiveStockMovements(
    data.inventory,
    data.stockMovements,
    data.deletedItems,
  ), [data.deletedItems, data.inventory, data.stockMovements]);
  const archivedWarehouseMovementCount = data.deletedItems
    .filter((item) => item.kind === "inventory" && !item.restoredAt)
    .reduce((sum, item) => sum + archivedInventoryMovements<StockMovement>(item).length, 0);
  const purchaseItems = stockForecast.filter((item) => item.buyQuantity > 0);
  const purchaseGroups = data.suppliers.map((supplier) => ({
    supplier,
    items: purchaseItems.filter((item) => item.supplierId === supplier.id),
  })).filter((group) => group.items.length);
  const haloPurchaseGroups = purchaseGroups.filter((group) => !isMezanaSupplierName(group.supplier.name));
  const autoOrderGroups = haloPurchaseGroups.filter((group) => group.supplier.autoOrder && group.supplier.telegramChatId);
  const supplierSetupNeeded = haloPurchaseGroups.filter((group) => !group.supplier.autoOrder || !group.supplier.telegramChatId);
  const unassignedPurchases = purchaseItems.filter((item) => !data.suppliers.some((supplier) => supplier.id === item.supplierId));
  const transactionPaymentStatus = supplierPurchaseStatuses(data.transactions, data.suppliers);
  const dueFixedExpenses = data.fixedExpenses.filter((expense) => expense.active && expense.nextDue <= accountingToday);
  const selectedExpenseHistory = useMemo(() => {
    const query = expenseSearch.trim().toLocaleLowerCase("uz-UZ");
    const accountNames = new Map(data.accounts.map((account) => [account.id, account.name]));
    return activeFinancialEntries
      .filter((entry) => entry.type === "expense" && dateIsInRange(entry.date, sectionDateRanges.expenses))
      .filter((entry) => !query || `${entry.category} ${entry.note} ${accountNames.get(entry.accountId) || ""}`.toLocaleLowerCase("uz-UZ").includes(query))
      .slice()
      .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  }, [activeFinancialEntries, data.accounts, expenseSearch, sectionDateRanges.expenses]);
  const activeSelectedExpenses = selectedExpenseHistory.filter((entry) => (
    !entry.reversedEntryId && !reversedFinancialIds.has(entry.id)
  ));
  const selectedExpenseTotal = activeSelectedExpenses.reduce((sum, entry) => sum + (entry.nonCash ? 0 : entry.amount), 0);
  const selectedProfitExpenseTotal = activeSelectedExpenses
    .filter((entry) => entry.affectsProfit !== false && !costRuleCoversCategory(entry.category, data.costRules))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const selectedRecurringExpenseTotal = activeSelectedExpenses
    .filter((entry) => entry.fixedExpenseId)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const selectedOtherExpenseTotal = Math.max(0, selectedExpenseTotal - selectedRecurringExpenseTotal);
  const monthlyRecurringPlan = data.fixedExpenses
    .filter((expense) => expense.active && expense.automatic === true && expense.frequency === "monthly")
    .reduce((sum, expense) => sum + expense.amount, 0);
  const todayClose = data.dailyCloses.find((close) => close.date === today);
  const businessAudit = useMemo(() => auditBusinessState(data), [data]);
  const supplierBalanceChecks = auditSupplierBalances(data.suppliers, data.transactions);
  const supplierBalanceProblems = supplierBalanceChecks.filter((entry) => !entry.valid || entry.difference !== 0);
  // Only audit amounts that represent actual cash or debt entries. Recipe-based
  // sales costs may contain valid sub-won fractions (for example, grams used).
  const cashLedgerWholeWonValues = [
    ...data.accounts.map((entry) => entry.openingBalance),
    ...data.financialEntries.map((entry) => entry.amount),
    ...data.transactions.map((entry) => entry.amount),
    ...data.suppliers.filter((entry) => !isMezanaSupplierName(entry.name)).map((entry) => entry.balance),
    ...data.dailyCloses.flatMap((entry) => [entry.expectedTotal, entry.actualTotal, entry.difference]),
  ];
  const cashLedgerProblemCount = cashLedgerWholeWonValues.filter((value) => !Number.isSafeInteger(Number(value))).length + accountBalances.unmatched.length;
  const cashDifference = todayClose ? Number(todayClose.difference || 0) : null;
  const financeShieldCriticalCount = supplierBalanceProblems.length
    + businessAudit.issues.filter((issue) => issue.severity === "error" && issue.code !== "supplier_balance").reduce((sum, issue) => sum + issue.count, 0)
    + cashLedgerProblemCount
    + (cashDifference !== null && cashDifference !== 0 ? 1 : 0);
  const dailyTasks = [
    { done: data.recipes.length > 0 && incompleteRecipeCount === 0, title: "1 · Taom tannarxlarini kiriting", detail: !data.recipes.length ? "Omborga bog‘lamasdan retsept narxini yozing" : incompleteRecipeCount ? `${incompleteRecipeCount} ta taomning narxi yoki tannarxi to‘liq emas` : `${data.recipes.length} ta taom narxi va tannarxi to‘liq`, tab: "recipes" as Tab },
    { done: data.inventory.length > 0, title: "2 · Ombor kirimini kiriting", detail: data.inventory.length ? `${data.inventory.length} turdagi mahsulot bor` : "Kelgan miqdor va xarid narxini yozing", tab: "inventory" as Tab },
    { done: todayFinancialSales.length > 0, title: "3 · Kunlik POS savdo chekini yuklang", detail: todayFinancialSales.length ? `${todayFinancialSales.length} ta POS yozuvi hisoblandi` : "Excel, surat yoki qo‘lda kiriting", tab: "sales" as Tab },
    { done: !purchaseItems.length, title: "Kam qolgan mahsulotlarni tekshiring", detail: purchaseItems.length ? `${purchaseItems.length} ta mahsulot olish kerak` : "Hozircha hammasi yetarli", tab: "inventory" as Tab },
    { done: data.dailyCloses.some((close) => close.date === today), title: "Kunni yoping", detail: data.dailyCloses.some((close) => close.date === today) ? "Bugungi hisob yopildi" : "Kassa va POS’ni solishtiring", tab: "finance" as Tab },
    { done: !dueFixedExpenses.length, title: "Doimiy xarajatlarni tekshiring", detail: dueFixedExpenses.length ? `${dueFixedExpenses.length} ta to‘lov muddati keldi` : "Bugun to‘lov yo‘q", tab: "finance" as Tab },
    { done: totalSupplierDebt <= 0, title: "Qarzlarni nazorat qiling", detail: totalSupplierDebt ? `${won(totalSupplierDebt)} yetkazuvchi qarzi` : "Qarz yo‘q", tab: "suppliers" as Tab },
  ].filter((task) => userMode === "owner" || (task.tab !== "recipes" && task.tab !== "finance" && task.tab !== "suppliers"));
  const pendingDailyTasks = dailyTasks.filter((task) => !task.done);
  const nextDailyTask = pendingDailyTasks[0] || null;
  const money = (value: number) => userMode === "owner" ? won(value) : "Yashirilgan";
  const archivedRecord = (kind: DeletedItem["kind"], entityId: string) => data.deletedItems.find((item) => (
    item.kind === kind && item.entityId === entityId && !item.restoredAt
  ))?.record || data.deletedItems.find((item) => item.kind === kind && item.entityId === entityId)?.record;
  const supplierName = (supplierId: string) => data.suppliers.find((item) => item.id === supplierId)?.name
    ?? String(archivedRecord("supplier", supplierId)?.name || "Noma’lum");
  const supplierInvoices = data.transactions.filter((transaction) => transaction.type === "purchase");
  const supplierInvoiceSearchKey = normalizeHumanNameKey(supplierInvoiceSearch);
  const filteredSupplierInvoices = supplierInvoices.filter((transaction) => {
    const paymentStatus = transactionPaymentStatus[transaction.id] || "unpaid";
    if (!dateIsInRange(transaction.date, sectionDateRanges.suppliers)) return false;
    if (supplierInvoiceStatus !== "all" && paymentStatus !== supplierInvoiceStatus) return false;
    if (!supplierInvoiceSearchKey) return true;
    return normalizeHumanNameKey([
      transaction.date,
      supplierName(transaction.supplierId),
      transaction.note,
      transaction.amount,
      transaction.document?.fileName || "",
    ].join(" ")).includes(supplierInvoiceSearchKey);
  });
  const paidSupplierInvoiceCount = supplierInvoices.filter((transaction) => (
    transactionPaymentStatus[transaction.id] === "paid"
  )).length;
  const supplierInvoiceDocumentCount = supplierInvoices.filter((transaction) => transaction.document).length;
  const supplierAccountingTotals = new Map(data.suppliers.map((supplier) => {
    const transactions = data.transactions.filter((transaction) => transaction.supplierId === supplier.id);
    const purchased = transactions.filter((transaction) => transaction.type === "purchase").reduce((sum, transaction) => sum + transaction.amount, 0);
    const paid = transactions.filter((transaction) => transaction.type === "payment").reduce((sum, transaction) => sum + transaction.amount, 0);
    return [supplier.id, {
      taken: Number(supplier.openingBalance || 0) + purchased,
      paid,
      balance: Number(supplier.balance || 0),
    }];
  }));
  const recipeName = (recipeId: string) => data.recipes.find((item) => item.id === recipeId)?.name
    ?? String(archivedRecord("recipe", recipeId)?.name || "O‘chirilgan taom");
  const inventoryName = (inventoryId: string) => data.inventory.find((item) => item.id === inventoryId)?.name
    ?? String(archivedRecord("inventory", inventoryId)?.name || "O‘chirilgan mahsulot");
  const movementLabel = (type: StockMovement["type"]) => ({
    receipt: "Kirim",
    waste: "Yo‘qotish",
    sale: "Savdo",
    adjustment: "Tuzatish",
  })[type];
  const saleChannelLabel = (sale: Sale) => (({cash: "Naqd", bank: "Bank", card: "POS / karta", delivery: "Delivery"} as Record<string, string>)[saleAccountType(sale, data.accounts.find(a => a.id === sale.accountId)?.type)] || "Savdo");
  const saleSourceLabel = (source: Sale["source"]) => source === "api" ? "POS API" : source === "pos" ? "POS" : source === "photo" ? "Surat" : source === "delivery" ? "Delivery" : "Qo‘lda";
  const updateSectionDateRange = (section: AnalysisTab, nextRange: DateRange) => {
    let next = nextRange;
    if (next.start && next.end && next.start > next.end) {
      next = { ...next, start: next.end, end: next.start, preset: "custom" };
    }
    setSectionDateRanges((current) => ({ ...current, [section]: next }));
  };
  const inventoryRangeMovements = useMemo(() => filterDateRange(
    visibleStockMovements,
    sectionDateRanges.inventory,
    (movement) => movement.date,
  ), [sectionDateRanges.inventory, visibleStockMovements]);
  const inventoryHistoryIds = new Set(data.inventory
    .filter((item) => inventoryCategoryFilter === "all" || item.categoryId === inventoryCategoryFilter)
    .filter((item) => !inventorySearchKey || normalizeHumanNameKey(item.name).includes(inventorySearchKey))
    .map((item) => item.id));
  const filteredInventoryRangeMovements = inventoryRangeMovements.filter((movement) => inventoryHistoryIds.has(movement.inventoryId));
  const warehouseReceiptSuppliers = data.suppliers.filter((supplier) => !isMezanaSupplierName(supplier.name));
  const supplierReceiptHistory = inventoryRangeMovements
    .filter((movement) => movement.type === "receipt" && Boolean(movement.supplierId))
    .filter((movement) => warehouseReceiptSuppliers.some((supplier) => supplier.id === movement.supplierId))
    .filter((movement) => inventoryReceiptSupplierId === "all" || movement.supplierId === inventoryReceiptSupplierId)
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  const supplierReceiptProductCount = new Set(supplierReceiptHistory.map((movement) => movement.inventoryId)).size;
  const supplierReceiptTotal = supplierReceiptHistory.reduce((sum, movement) => (
    sum + (receiptDisplay(movement, data.inventory.find(i => i.id === movement.inventoryId)).amount ?? 0)
  ), 0);
  const recipeRangeSales = useMemo(() => filterDateRange(
    data.sales,
    sectionDateRanges.recipes,
    (sale) => sale.date,
  ), [data.sales, sectionDateRanges.recipes]);
  const posRangeSales = useMemo(() => filterDateRange(
    posTaxableSales,
    sectionDateRanges.sales,
    (sale) => sale.date,
  ), [posTaxableSales, sectionDateRanges.sales]);
  const deliveryRangeSales = useMemo(() => filterDateRange(
    deliverySales,
    sectionDateRanges.deliverysales,
    (sale) => sale.date,
  ), [deliverySales, sectionDateRanges.deliverysales]);
  const deliveryRangeOrders = useMemo(() => groupDeliveryOrders(deliveryRangeSales), [deliveryRangeSales]);
  const financeRangeEntries = useMemo(() => filterDateRange(
    activeFinancialEntries,
    sectionDateRanges.finance,
    (entry) => entry.date,
  ), [activeFinancialEntries, sectionDateRanges.finance]);
  const oilRangeEntries = useMemo(() => filterDateRange(
    oilLedgerEntries(activeFinancialEntries),
    sectionDateRanges.oil,
    (entry) => entry.date,
  ), [activeFinancialEntries, sectionDateRanges.oil]);
  const oilRangeSummary = useMemo(() => summarizeOilLedger(oilRangeEntries), [oilRangeEntries]);
  const oilFormTotal = Math.round(Math.max(0, oilForm.canCount) * Math.max(0, oilForm.unitAmount));
  const financeRangeCloses = useMemo(() => filterDateRange(
    data.dailyCloses,
    sectionDateRanges.finance,
    (entry) => entry.date,
  ), [data.dailyCloses, sectionDateRanges.finance]);
  const supplierRangeTransactions = useMemo(() => filterDateRange(
    data.transactions,
    sectionDateRanges.suppliers,
    (entry) => entry.date,
  ).filter((entry) => !isMezanaSupplierName(data.suppliers.find((supplier) => supplier.id === entry.supplierId)?.name)), [data.suppliers, data.transactions, sectionDateRanges.suppliers]);
  const supplierRangeDeliveries = useMemo(() => filterDateRange(
    data.supplierDeliveries,
    sectionDateRanges.suppliers,
    (entry) => entry.date,
  ).filter((entry) => !isMezanaSupplierName(data.suppliers.find((supplier) => supplier.id === entry.supplierId)?.name)), [data.supplierDeliveries, data.suppliers, sectionDateRanges.suppliers]);
  const haloSuppliers = data.suppliers.filter((supplier) => !isMezanaSupplierName(supplier.name));
  const selectedSupplierProductId = haloSuppliers.some((supplier) => supplier.id === supplierProductViewId)
    ? supplierProductViewId
    : haloSuppliers[0]?.id || "";
  const selectedSupplierProduct = haloSuppliers.find((supplier) => supplier.id === selectedSupplierProductId);
  const selectedSupplierReceipts = visibleStockMovements
    .filter((movement) => movement.type === "receipt"
      && movement.supplierId === selectedSupplierProductId
      && dateIsInRange(movement.date, sectionDateRanges.suppliers))
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  const selectedSupplierTransactions = supplierRangeTransactions
    .filter((transaction) => transaction.supplierId === selectedSupplierProductId);
  const selectedSupplierPurchaseTotal = selectedSupplierTransactions
    .filter((transaction) => transaction.type === "purchase")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const selectedSupplierPaymentTotal = selectedSupplierTransactions
    .filter((transaction) => transaction.type === "payment")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const selectedSupplierProductRows = receiptTotalRows(selectedSupplierReceipts, data.inventory);
  const selectedSupplierReceiptTotal = selectedSupplierProductRows.reduce((sum, row) => sum + row.amount, 0);
  const mezanaRangeEntries = filterDateRange(
    data.mezanaEntries,
    sectionDateRanges.mezana,
    (entry) => entry.date,
  );
  const mezanaRangeBorrowedQuantity = mezanaRangeEntries
    .filter((entry) => entry.action === "borrowed")
    .reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
  const mezanaRangeReturnedQuantity = mezanaRangeEntries
    .filter((entry) => entry.action === "returned")
    .reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
  const mezanaHeldQuantity = Math.max(0, mezanaBorrowedQuantityBalance(data.mezanaEntries));
  const mezanaRangePurchasedTotal = mezanaRangeEntries
    .filter((entry) => entry.action === "purchased")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const reportRangeRows = useMemo(() => {
    if (tab !== "reports") return [];
    const dates = [...new Set([
      ...data.sales.map((entry) => entry.date),
      ...activeFinancialEntries.map((entry) => entry.date),
      ...data.workShifts.map((entry) => entry.date),
      ...data.workerConsumptions.map((entry) => String(entry.date || "")),
    ].filter((date) => dateIsInRange(date, sectionDateRanges.reports)))].sort((left, right) => left.localeCompare(right));
    return dates.map((date) => calculateDailyReport(data, date));
  }, [tab, activeFinancialEntries, data, sectionDateRanges.reports]);
  const reportRangeTotals = reportRangeRows.reduce((totals, report) => ({
    revenue: totals.revenue + report.revenue,
    cost: totals.cost + report.cost,
    expenses: totals.expenses + report.totalExpenses,
    netProfit: totals.netProfit + report.netProfit,
    items: totals.items + report.itemCount,
  }), { revenue: 0, cost: 0, expenses: 0, netProfit: 0, items: 0 });
  const inventoryRangeReceipts = inventoryRangeMovements.filter((movement) => movement.type === "receipt");
  const inventoryRangeReceiptValue = inventoryRangeReceipts.reduce((sum, movement) => sum + (receiptDisplay(movement, data.inventory.find(i => i.id === movement.inventoryId)).amount ?? 0), 0);
  const inventoryRangeOutQuantity = inventoryRangeMovements.filter((movement) => movement.quantity < 0).reduce((sum, movement) => sum + Math.abs(movement.quantity), 0);
  const recipeRangeSummary = summarizeSales(recipeRangeSales);
  const recipeRangeTotals = new Map<string, number>();
  recipeRangeSales.forEach((sale) => recipeRangeTotals.set(sale.recipeId, (recipeRangeTotals.get(sale.recipeId) || 0) + sale.quantity));
  const recipeRangeTop = [...recipeRangeTotals.entries()].sort((left, right) => right[1] - left[1])[0];
  const posRangeSummary = summarizeSales(posRangeSales);
  const deliveryRangeSummary = deliveryRangeSales.reduce((summary, sale) => {
    const commission = deliveryCommissionAmount(sale, data.costRules.deliveryCommissionPct);
    return {
      revenue: summary.revenue + sale.totalRevenue,
      cost: summary.cost + Math.round(sale.totalCost),
      commission: summary.commission + commission,
      profit: summary.profit + sale.totalRevenue - Math.round(sale.totalCost) - commission,
      quantity: summary.quantity + sale.quantity,
    };
  }, { revenue: 0, cost: 0, commission: 0, profit: 0, quantity: 0 });
  const deliveryPlatformSummaries = DELIVERY_PLATFORMS.map((platform) => {
    const sales = deliveryRangeSales.filter((sale) => sale.deliveryPlatform === platform.id);
    const totals = sales.reduce((summary, sale) => {
      const commission = deliveryCommissionAmount(sale, data.costRules.deliveryCommissionPct);
      return {
        revenue: summary.revenue + sale.totalRevenue,
        cost: summary.cost + Math.round(sale.totalCost),
        commission: summary.commission + commission,
        profit: summary.profit + sale.totalRevenue - Math.round(sale.totalCost) - commission,
        quantity: summary.quantity + sale.quantity,
      };
    }, { revenue: 0, cost: 0, commission: 0, profit: 0, quantity: 0 });
    const orderCount = new Set(sales.map((sale) => sale.deliveryBatchId || sale.deliveryOrderNumber || sale.id)).size;
    return { ...platform, ...totals, sales, orderCount };
  });
  const financeRangeIncome = financeRangeEntries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const financeRangeExpense = financeRangeEntries.filter((entry) => entry.type === "expense" && !entry.nonCash).reduce((sum, entry) => sum + entry.amount, 0);
  const financeRangeTransfers = financeRangeEntries.filter((entry) => entry.type === "transfer").reduce((sum, entry) => sum + entry.amount, 0);
  const supplierRangePurchases = supplierRangeTransactions.filter((entry) => entry.type === "purchase").reduce((sum, entry) => sum + entry.amount, 0);
  const supplierRangePayments = supplierRangeTransactions.filter((entry) => entry.type === "payment").reduce((sum, entry) => sum + entry.amount, 0);
  const kitchenOutflowRangeEntries = cashSaleRangeSales.filter(isKitchenOutflow);
  const productOutflowRangeEntries = cashSaleRangeSales.filter((entry) => entry.kind === "product");
  const otherOutflowRangeEntries = cashSaleRangeSales.filter((entry) => !isKitchenOutflow(entry) && entry.kind !== "product");
  const cashSaleRangeQuantity = kitchenOutflowRangeEntries.reduce((sum, entry) => (
    sum + outflowDishItems(entry).reduce((itemSum, item) => itemSum + item.quantity, 0)
  ), 0);
  const outflowDishSummary = useMemo(() => {
    const rows = new Map<string, { recipeId: string; name: string; quantity: number; cost: number }>();
    for (const entry of kitchenOutflowRangeEntries) {
      for (const item of outflowDishItems(entry)) {
        const key = item.recipeId || `saved:${normalizeHumanNameKey(item.name)}`;
        const current = rows.get(key) || { recipeId: item.recipeId, name: item.name, quantity: 0, cost: 0 };
        current.quantity += item.quantity;
        current.cost += item.totalCostAtOutflow;
        rows.set(key, current);
      }
    }
    return [...rows.values()].sort((left, right) => right.quantity - left.quantity || right.cost - left.cost);
  }, [kitchenOutflowRangeEntries]);
  const outflowIngredientSummary = useMemo(() => {
    const rows = new Map<string, { inventoryId: string; name: string; unit: string; quantity: number; cost: number }>();
    const movementsByReference = new Map<string, StockMovement[]>();
    for (const movement of visibleStockMovements) {
      if (!movement.referenceId || movement.quantity >= 0) continue;
      const linked = movementsByReference.get(movement.referenceId) || [];
      linked.push(movement);
      movementsByReference.set(movement.referenceId, linked);
    }
    const inventoryById = new Map(data.inventory.map((item) => [item.id, item]));
    const addUsage = (inventoryId: string, name: string, unit: string, quantity: number, cost: number) => {
      if (!inventoryId || !quantity) return;
      const current = rows.get(inventoryId) || { inventoryId, name, unit, quantity: 0, cost: 0 };
      current.quantity += quantity;
      current.cost += cost;
      rows.set(inventoryId, current);
    };
    for (const entry of cashSaleRangeSales) {
      const savedUsage = Array.isArray(entry.ingredientUsage) ? entry.ingredientUsage : [];
      if (savedUsage.length) {
        for (const usage of savedUsage) {
          const quantity = safeOutflowNumber(usage.quantity);
          const unitCost = safeOutflowNumber(usage.unitCostAtOutflow);
          addUsage(
            String(usage.inventoryId || ""),
            String(usage.name || inventoryById.get(String(usage.inventoryId || ""))?.name || "O‘chirilgan mahsulot"),
            String(usage.unit || inventoryById.get(String(usage.inventoryId || ""))?.unit || "birlik"),
            quantity,
            safeOutflowNumber(usage.totalCostAtOutflow) || quantity * unitCost,
          );
        }
        continue;
      }
      for (const movement of movementsByReference.get(entry.id) || []) {
        const item = inventoryById.get(movement.inventoryId);
        const quantity = Math.abs(Number(movement.quantity || 0));
        const unitCost = safeOutflowNumber(movement.unitCost) || safeOutflowNumber(item?.unitCost);
        addUsage(
          movement.inventoryId,
          item?.name || "O‘chirilgan mahsulot",
          item?.unit || "birlik",
          quantity,
          quantity * unitCost,
        );
      }
    }
    return [...rows.values()].sort((left, right) => right.cost - left.cost || right.quantity - left.quantity);
  }, [cashSaleRangeSales, data.inventory, visibleStockMovements]);
  const outflowDaySummary = useMemo(() => {
    const rows = new Map<string, { date: string; records: number; portions: number; cost: number }>();
    for (const entry of cashSaleRangeSales) {
      const date = String(entry.date || "");
      if (!date) continue;
      const current = rows.get(date) || { date, records: 0, portions: 0, cost: 0 };
      current.records += 1;
      current.cost += safeOutflowNumber(entry.totalCost);
      if (isKitchenOutflow(entry)) {
        current.portions += outflowDishItems(entry).reduce((sum, item) => sum + item.quantity, 0);
      }
      rows.set(date, current);
    }
    return [...rows.values()].sort((left, right) => right.date.localeCompare(left.date));
  }, [cashSaleRangeSales]);
  const sectionAnalysisMetrics: Record<AnalysisTab, SectionMetric[]> = {
    inventory: [
      { label: "Ombor harakati", value: `${inventoryRangeMovements.length} ta`, detail: "Faqat tanlangan davr" },
      { label: "Kirim", value: `${inventoryRangeReceipts.length} ta`, detail: won(inventoryRangeReceiptValue), tone: "positive" },
      { label: "Chiqim miqdori", value: inventoryRangeOutQuantity.toLocaleString(), detail: "Savdo, isrof va tuzatish", tone: "warning" },
      { label: "Hozirgi ombor", value: won(inventoryValue), detail: `${data.inventory.filter(item => !isExpenseOnlyInventory(item)).length} tur mahsulot` },
    ],
    recipes: [
      { label: "Davr savdosi", value: won(recipeRangeSummary.revenue), detail: `${recipeRangeSummary.items} ta taom` },
      { label: "Tannarx", value: won(recipeRangeSummary.cost), detail: "Sotilgan retseptlar" },
      { label: "Yalpi foyda", value: won(recipeRangeSummary.profit), detail: recipeRangeSummary.revenue ? `${(recipeRangeSummary.profit / recipeRangeSummary.revenue * 100).toFixed(1)}%` : "Savdo yo‘q", tone: "positive" },
      { label: "Eng ko‘p sotilgan", value: recipeRangeTop ? recipeName(recipeRangeTop[0]) : "—", detail: recipeRangeTop ? `${recipeRangeTop[1]} ta` : "Ma’lumot yo‘q" },
    ],
    sales: [
      { label: "POS savdo", value: won(posRangeSummary.revenue), detail: `${posRangeSales.length} yozuv` },
      { label: "Sotilgan", value: `${posRangeSummary.items} ta`, detail: "POS, kiosk, Excel va qo‘lda" },
      { label: "Tannarx", value: won(posRangeSummary.cost), detail: "Ombordan ayrilgan" },
      { label: "Yalpi foyda", value: won(posRangeSummary.profit), detail: "Soliqdan oldin", tone: "positive" },
    ],
    deliverysales: [
      { label: "Delivery savdo", value: won(deliveryRangeSummary.revenue), detail: `${deliveryRangeSummary.quantity} ta mahsulot` },
      { label: "Platforma komissiyasi", value: `−${won(deliveryRangeSummary.commission)}`, detail: "Har bir yozuvdagi foiz bo‘yicha", tone: "negative" },
      { label: "Retsept tannarxi", value: `−${won(deliveryRangeSummary.cost)}`, detail: "Ombordan avtomatik ayrilgan" },
      { label: "Sof delivery foydasi", value: won(deliveryRangeSummary.profit), detail: "Savdo − tannarx − komissiya", tone: deliveryRangeSummary.profit >= 0 ? "positive" : "negative" },
    ],
    cashbank: [
      { label: "Naqd + hisob", value: won(cashBankRangeRevenue), detail: `${cashBankRangeQuantity} ta taom` },
      { label: "Naqd", value: won(cashBankRangeCash), detail: "Naqd kassa" },
      { label: "Hisob-raqam", value: won(cashBankRangeBank), detail: "Bank tushumi" },
      { label: "Yalpi foyda", value: won(cashBankRangeRevenue - cashBankRangeCost), detail: "Soliqni buxgalter hisoblaydi", tone: "positive" },
    ],
    cashsales: [
      { label: "Yeyilgan taom", value: `${cashSaleRangeQuantity} porsiya`, detail: `${kitchenOutflowRangeEntries.length} yozuv` },
      { label: "Ombordan chiqqan", value: won(cashSaleRangeCost), detail: "Saqlangan tannarx", tone: "warning" },
      { label: "Eng ko‘p yeyilgan", value: outflowDishSummary[0]?.name || "—", detail: outflowDishSummary[0] ? `${outflowDishSummary[0].quantity} porsiya` : "Ma’lumot yo‘q" },
      { label: "Sarflangan xomashyo", value: `${outflowIngredientSummary.length} tur`, detail: outflowIngredientSummary[0]?.name || "Ma’lumot yo‘q" },
    ],
    oil: [
      { label: "O‘rtacha olish narxi", value: won(oilRangeSummary.averagePurchaseUnitAmount), detail: `${oilRangeSummary.purchaseCans} ta · ${oilRangeSummary.purchaseLiters} L` },
      { label: "O‘rtacha sotish narxi", value: won(oilRangeSummary.averageResaleUnitAmount), detail: `${oilRangeSummary.resaleCans} ta · ${oilRangeSummary.resaleLiters} L`, tone: "positive" },
      { label: "Sotish − olish farqi", value: `${oilRangeSummary.averageUnitDifference >= 0 ? "+" : "−"}${won(Math.abs(oilRangeSummary.averageUnitDifference))}`, detail: "1 ta 18 L kanistr bo‘yicha", tone: oilRangeSummary.averageUnitDifference >= 0 ? "positive" : "warning" },
      { label: oilRangeSummary.netOilCost >= 0 ? "Sof moy xarajati" : "Moydan ortiqcha foyda", value: won(Math.abs(oilRangeSummary.netOilCost)), detail: `${won(oilRangeSummary.purchaseCost)} xarajat · ${won(oilRangeSummary.resaleIncome)} kirim`, tone: oilRangeSummary.netOilCost >= 0 ? "warning" : "positive" },
    ],
    fees: [
      { label: "Soliq zaxirasi bazasi", value: won(feeRangeTotals.taxableSales), detail: "Faqat POS savdosi" },
      { label: "Karta komissiyasi", value: `−${won(feeRangeTotals.cardCommission)}`, detail: `${feeRuleForm.cardCommissionPct || 0}%`, tone: "negative" },
      { label: "Reja soliq zaxirasi", value: `−${won(feeRangeTotals.tax)}`, detail: `${feeRuleForm.taxPct || 0}%`, tone: "negative" },
      { label: "Foizlardan keyin", value: won(feeRangeNet), detail: "Tanlangan davr" },
    ],
    expenses: [
      { label: "Jami xarajat", value: won(selectedExpenseTotal), detail: `${activeSelectedExpenses.length} yozuv`, tone: "negative" },
      { label: "Avtomatik", value: won(selectedRecurringExpenseTotal), detail: "Takroriy xarajat" },
      { label: "Bir martalik", value: won(selectedOtherExpenseTotal), detail: "Qo‘lda kiritilgan" },
      { label: "Hisobiy foydaga ta’siri", value: won(selectedProfitExpenseTotal), detail: "Takroriy hisoblanmagan" },
    ],
    finance: [
      { label: "Pul harakati", value: `${financeRangeEntries.length} ta`, detail: "Faol yozuvlar" },
      { label: "Daromad", value: `+${won(financeRangeIncome)}`, detail: "Qo‘shimcha kirim", tone: "positive" },
      { label: "Xarajat", value: `−${won(financeRangeExpense)}`, detail: "Pul chiqimi", tone: "negative" },
      { label: "O‘tkazma", value: won(financeRangeTransfers), detail: `${financeRangeCloses.length} ta kun yopilgan` },
    ],
    reports: [
      { label: "Jami savdo", value: won(reportRangeTotals.revenue), detail: `${reportRangeTotals.items} ta taom` },
      { label: "Tannarx", value: won(reportRangeTotals.cost), detail: "Sotilgan mahsulot" },
      { label: "Barcha xarajat", value: won(reportRangeTotals.expenses), detail: `${reportRangeRows.length} faol kun`, tone: "negative" },
      { label: "Hisobiy foyda", value: won(reportRangeTotals.netProfit), detail: "Tanlangan davr yakuni", tone: reportRangeTotals.netProfit >= 0 ? "positive" : "negative" },
    ],
    mezana: [
      { label: "Hozirgi MEZANA qarzi", value: won(mezanaCurrentBalance), detail: `${data.mezanaEntries.length} ta jami yozuv`, tone: mezanaCurrentBalance > 0 ? "warning" : "positive" },
      { label: "Olib turilgan qoldiq", value: `${mezanaHeldQuantity} ta`, detail: `Olingan ${mezanaRangeBorrowedQuantity} · qaytgan ${mezanaRangeReturnedQuantity}` },
      { label: "Sotib olindi", value: won(mezanaRangePurchasedTotal), detail: `${mezanaRangeEntries.filter((entry) => entry.action === "purchased").length} ta yozuv` },
      { label: "Qaytarib qo‘yildi", value: `${mezanaRangeReturnedQuantity} ta`, detail: `${mezanaRangeEntries.filter((entry) => entry.action === "returned").length} ta yozuv`, tone: "positive" },
      { label: "Telegram yo‘nalishlari", value: data.mezanaSettings.telegramChatId && data.mezanaSettings.purchasedTelegramChatId ? "2 / 2 ULANGAN" : "SOZLASH KERAK", detail: "Olib turildi va sotib olindi alohida", tone: data.mezanaSettings.telegramChatId && data.mezanaSettings.purchasedTelegramChatId ? "positive" : "warning" },
    ],
    suppliers: [
      { label: "Mahsulot olindi", value: won(supplierRangePurchases), detail: `${supplierRangeTransactions.filter((entry) => entry.type === "purchase").length} nakladnoy` },
      { label: "Pul to‘landi", value: won(supplierRangePayments), detail: `${supplierRangeTransactions.filter((entry) => entry.type === "payment").length} to‘lov`, tone: "positive" },
      { label: "Xodim yetkazmasi", value: `${supplierRangeDeliveries.length} ta`, detail: "Tanlangan davr" },
      { label: "Jami hozirgi qarz", value: won(totalSupplierDebt), detail: `${supplierDebtAccountCount} ta yetkazuvchi hisobi`, tone: totalSupplierDebt > 0 ? "warning" : "positive" },
    ],
  };
  const parsedPos = useMemo(
    () => posTable ? parsePosRows(posTable, posMapping, today) : { rows: [], ignored: 0, summary: undefined, errors: [] as string[] },
    [posTable, posMapping, today],
  );
  const posReconciliation = useMemo(() => {
    const rows = parsedPos.rows.map((row) => {
      const automaticRecipe = row.productCode
        ? data.recipes.find((recipe) => recipeHasMenuCode(recipe, row.productCode))
        : undefined;
      const recipeId = posProductMap[row.mappingKey] || automaticRecipe?.id || "";
      const recipe = data.recipes.find((entry) => entry.id === recipeId);
      return { ...row, recipeId, menuRevenue: (recipe?.salePrice || 0) * row.quantity };
    });
    return reconcilePosImport(rows, data.sales);
  }, [data.recipes, data.sales, parsedPos.rows, posProductMap]);
  const resolvedPosRows = posReconciliation.rows;
  const posProducts = useMemo(() => {
    const products = new Map<string, { key: string; name: string; productCode: string; rowCount: number; quantity: number; recipeId: string }>();
    resolvedPosRows.forEach((row) => {
      const current = products.get(row.mappingKey);
      products.set(row.mappingKey, {
        key: row.mappingKey,
        name: data.recipes.find((recipe) => recipe.id === row.recipeId)?.name || row.product,
        productCode: row.productCode,
        rowCount: (current?.rowCount ?? 0) + 1,
        quantity: (current?.quantity ?? 0) + row.quantity,
        recipeId: row.recipeId,
      });
    });
    return [...products.values()];
  }, [data.recipes, resolvedPosRows]);
  const importablePosRows = posReconciliation.newRows;
  const unmatchedPosRows = posReconciliation.unmatchedRows;
  const ocrParsedSummary = useMemo(() => ({
    quantity: parsedPos.rows.reduce((sum, row) => sum + row.quantity, 0),
  }), [parsedPos.rows]);
  const ocrSummaryAvailable = parsedPos.rows.length > 0;
  const ocrSummaryMatches = posSource !== "image"
    || ocrSummaryAvailable;
  const recoverableRemovedRows = useMemo(() => posTable
    ? removedRowsFillReceiptGap(
      posTable.rows,
      removedOcrRows,
      ocrReceiptSummary.quantity,
      ocrReceiptSummary.total,
    )
    : [], [ocrReceiptSummary.quantity, ocrReceiptSummary.total, posTable, removedOcrRows]);
  const ocrImportReady = posSource !== "image"
    || (ocrSummaryMatches && ocrNumbersVerified && ocrReviewIssues.length === 0);
  const ocrIssuesByRow = useMemo(() => {
    const issues = new Map<number, OcrReviewIssue>();
    ocrReviewIssues.forEach((issue) => {
      if (issue.rowNumber != null) issues.set(issue.rowNumber, issue);
    });
    return issues;
  }, [ocrReviewIssues]);
  const globalOcrIssues = ocrReviewIssues.filter((issue) => issue.rowNumber == null);
  const importablePosRevenue = posReconciliation.newRevenue;

  const editInventoryItem = (item: Inventory) => {
    setEditingInventoryId(item.id);
    setStockForm({
      name: item.name,
      unit: item.unit,
      packageName: item.packageName,
      packageCount: 0,
      date: today,
      unitsPerPackage: item.unitsPerPackage,
      packageCost: item.packageCost,
      gramsPerUnit: item.gramsPerUnit,
      minStock: item.minStock,
      supplierId: item.supplierId,
      categoryId: item.categoryId,
    });
    setStockNotice(`“${item.name}” tahrirlash uchun ochildi. Nomi, kategoriya, qadoq, narx, minimum va yetkazuvchini o‘zgartirasiz. ${item.stock.toLocaleString()} ${item.unit} qoldiqni esa pastdagi kirim tarixidan tahrirlang.`);
    window.requestAnimationFrame(() => revealInventorySection("inventory-product-form"));
  };

  const cancelInventoryEdit = () => {
    setEditingInventoryId("");
    setStockForm(emptyStockForm());
    setStockNotice("");
  };

  const addInventory = async () => {
    if (stockSaving) return;
    const name = stockForm.name.trim();
    const packageName = stockForm.packageName.trim().replace(/\s+/g, " ").slice(0, 30);
    const existingItem = editingInventoryId
      ? data.inventory.find((item) => item.id === editingInventoryId)
      : undefined;
    if (!name) {
      setStockNotice("Mahsulot nomini kiriting.");
      return;
    }
    const nameKey = normalizeHumanNameKey(name);
    if (!nameKey) {
      setStockNotice("Mahsulot nomida kamida bitta harf yoki raqam bo‘lsin.");
      return;
    }
    const duplicateItem = data.inventory.find((item) => (
      item.id !== editingInventoryId && normalizeHumanNameKey(item.name) === nameKey
    ));
    if (duplicateItem && editingInventoryId) {
      setStockNotice(`“${duplicateItem.name}” nomli boshqa mahsulot allaqachon mavjud.`);
      return;
    }
    if (duplicateItem?.catalogArchived) {
      setStockNotice(`“${duplicateItem.name}” olib tashlangan mahsulotlar orasida bor. Uni “Olib tashlangan mahsulotlar”dan tiklang; qayta yaratish shart emas.`);
      window.requestAnimationFrame(() => revealInventorySection("inventory-archived-products"));
      return;
    }
    if (duplicateItem) {
      setIntakeDraft({supplier: data.suppliers.find(s=>s.id===(stockForm.supplierId || duplicateItem.supplierId))?.name || "", date: stockForm.date || today,
        lines:[{name:duplicateItem.name, quantity:String(stockForm.packageCount > 0 ? stockForm.packageCount * stockForm.unitsPerPackage : 1), unit:stockForm.packageCount > 0 ? stockForm.unit : duplicateItem.unit, amount:stockForm.packageCount > 0 && stockForm.packageCost > 0 ? String(stockForm.packageCount * stockForm.packageCost) : ""}]});
      setTab("intake");
      setStatus("Mavjud mahsulot tanlandi. Xarid summasi va to‘lovni tekshirib saqlang.");
      return;
    }
    if (editingInventoryId && !existingItem) {
      setStockNotice("Tahrirlanayotgan ombor mahsuloti topilmadi. Sahifani yangilang.");
      return;
    }
    if (!packageName) {
      setStockNotice("Qadoq nomini kiriting: masalan, pachka yoki qop.");
      return;
    }
    if (
      ![stockForm.packageCount, stockForm.unitsPerPackage, stockForm.packageCost, stockForm.gramsPerUnit, stockForm.minStock]
        .every((value) => Number.isFinite(value) && value >= 0)
      || stockForm.unitsPerPackage <= 0
      || (!editingInventoryId && stockForm.packageCount < 0)
    ) {
      setStockNotice("Qadoq soni, ichidagi miqdor, narx va minimumni tekshiring.");
      return;
    }
    const packaged = calculatePackagedInventory(
      editingInventoryId ? 0 : stockForm.packageCount,
      stockForm.unitsPerPackage,
      stockForm.packageCost,
    );
    if (![packaged.stock, packaged.unitCost].every(Number.isFinite)) {
      setStockNotice("Qadoq hisobida juda katta yoki noto‘g‘ri qiymat bor.");
      return;
    }
    const openingDate = stockForm.date || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate) || !Number.isFinite(Date.parse(openingDate)) || new Date(openingDate).toISOString().slice(0,10) !== openingDate) {
      setStockNotice("Boshlang‘ich qoldiq sanasini tekshiring."); return;
    }
    const inventoryId = existingItem?.id || id("inv");
    const nextItem: Inventory = {
      ...existingItem,
      id: inventoryId,
      name,
      unit: stockForm.unit,
      stock: existingItem?.stock ?? packaged.stock,
      minStock: stockForm.minStock,
      unitCost: packaged.unitCost,
      packageName,
      unitsPerPackage: stockForm.unitsPerPackage,
      packageCost: stockForm.packageCost,
      gramsPerUnit: stockForm.gramsPerUnit,
      supplierId: stockForm.supplierId,
      categoryId: validCategoryId(data.productCategories, "inventory", stockForm.categoryId),
    };
    const nextInventory = existingItem
      ? data.inventory.map((item) => item.id === existingItem.id ? nextItem : item)
      : [...data.inventory, nextItem];
    let linkedRecipeCount = 0;
    const linkedRecipes = data.recipes.map((recipe) => {
      const ingredients = linkRecipeIngredientsToInventory(recipe.ingredients, nextInventory);
      ingredients.forEach((ingredient, index) => {
        if (!recipe.ingredients[index]?.inventoryId && ingredient.inventoryId === inventoryId) linkedRecipeCount += 1;
      });
      return { ...recipe, ingredients };
    });
    const openingMovement: StockMovement[] = !existingItem && packaged.stock > 0 ? [{
      id: id("mov"),
      inventoryId,
      type: "receipt",
      quantity: packaged.stock,
      date: openingDate,
      ...(stockForm.supplierId ? { supplierId: stockForm.supplierId } : {}),
      note: `Boshlang‘ich qoldiq · ${stockForm.packageCount.toLocaleString()} ${packageName} × ${stockForm.unitsPerPackage.toLocaleString()} ${stockForm.unit}`,
      ...(packaged.unitCost > 0 ? { unitCost: packaged.unitCost, previousUnitCost: 0 } : {}),
    }] : [];
    setStockSaving(true);
    setStockNotice("Saqlanmoqda…");
    try {
      const saved = await save({
        ...data,
        inventory: nextInventory,
        recipes: linkedRecipes,
        stockMovements: [...openingMovement, ...data.stockMovements],
      }, `Ombor mahsuloti ${existingItem ? "yangilandi" : "qo‘shildi"} · ${nextItem.name} · 1 ${packageName} = ${stockForm.unitsPerPackage} ${stockForm.unit}${stockForm.gramsPerUnit > 0 ? ` · 1 dona = ${stockForm.gramsPerUnit} g` : ""}`);
      if (saved) {
        if (intakeDraft && !existingItem) setTab("intake");
        setStockForm(emptyStockForm());
        setEditingInventoryId("");
        setStockNotice(`✓ ${nextItem.name}: 1 ${packageName} = ${stockForm.unitsPerPackage.toLocaleString()} ${stockForm.unit}${stockForm.gramsPerUnit > 0 ? ` · 1 dona = ${stockForm.gramsPerUnit.toLocaleString()} g` : ""} · 1 ${stockForm.unit} ${won(packaged.unitCost)}${existingItem ? " · mavjud qoldiq o‘zgarmadi" : ""}${linkedRecipeCount ? ` · ${linkedRecipeCount} ta retsept bilan bog‘landi` : ""}.`);
      } else {
        setStockNotice(`Mahsulot saqlanmadi: ${lastSaveErrorRef.current || "kiritilgan ma’lumotni tekshirib, qayta urinib ko‘ring."}`);
      }
    } finally {
      setStockSaving(false);
    }
  };
  const chooseMovementDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile) {
      setMovementDocumentFile(null);
      setMovementDocumentPreview("");
      return;
    }
    setMovementNotice("Rasm tayyorlanmoqda…");
    try {
      const prepared = await prepareStockImageUpload(selectedFile);
      if (movementDocumentPreview) URL.revokeObjectURL(movementDocumentPreview);
      setMovementDocumentFile(prepared.file);
      setMovementDocumentPreview(URL.createObjectURL(prepared.file));
      setRemoveMovementDocument(false);
      setMovementNotice(preparedImageNotice(prepared));
    } catch (error) {
      setMovementNotice(error instanceof Error ? error.message : "Rasm qabul qilinmadi.");
      setMovementFileInputKey((current) => current + 1);
    }
  };

  const chooseTransactionDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    supplierPendingDocumentRef.current = undefined;
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile) {
      setTransactionDocumentFile(null);
      setTransactionDocumentPreview("");
      return;
    }
    setTransactionNotice("Rasm tayyorlanmoqda…");
    try {
      const prepared = await prepareStockImageUpload(selectedFile);
      if (transactionDocumentPreview) URL.revokeObjectURL(transactionDocumentPreview);
      setTransactionDocumentFile(prepared.file);
      setTransactionDocumentPreview(URL.createObjectURL(prepared.file));
      setRemoveTransactionDocument(false);
      setTransactionNotice(preparedImageNotice(prepared));
    } catch (error) {
      setTransactionNotice(error instanceof Error ? error.message : "Rasm qabul qilinmadi.");
      setTransactionFileInputKey((current) => current + 1);
    }
  };

  const uploadStockDocument = async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("branchId", activeBranchRef.current);
    const response = await fetch("/api/stock-documents", { method: "POST", body: form });
    const result = await response.json() as { document?: StockDocument; error?: string };
    if (!response.ok || !result.document) throw new Error(result.error || "Nakladnoy rasmi yuklanmadi.");
    return result.document;
  };

  const editStockMovement = (movement: StockMovement) => {
    if (isWorkerDeliveryMovement(movement)) {
      setMovementNotice("Bu ombor harakati xodim kirimi va yetkazuvchi qarzi bilan bog‘langan. Hisoblar buzilmasligi uchun uni alohida tahrirlab bo‘lmaydi.");
      return;
    }
    if (isPurchaseOrderMovement(movement)) {
      setMovementNotice("Bu kirim Xarid buyurtmasiga bog‘langan. Ombor va yetkazuvchi qarzi birga yuritilishi uchun uni Nazorat markazi → Xaridlar nazoratidan boshqaring.");
      return;
    }
    if (movement.type === "sale") {
      setMovementNotice("Savdoga tegishli chiqim Savdo bo‘limidan boshqariladi.");
      return;
    }
    if (movement.referenceId) {
      setMovementNotice("Bu ombor harakati boshqa yozuvga bog‘langan. Hisoblar buzilmasligi uchun uni o‘sha manba bo‘limidan boshqaring.");
      return;
    }
    const item = data.inventory.find((entry) => entry.id === movement.inventoryId);
    if (!item) return;
    setEditingMovementId(movement.id);
    setMovementForm({
      inventoryId: movement.inventoryId,
      type: movement.type,
      quantity: movement.type === "adjustment" ? movement.quantity : Math.abs(movement.quantity),
      unitCost: Number(movement.unitCost || 0),
      supplierId: movement.supplierId || item.supplierId || "",
      date: movement.date,
      note: movement.note,
    });
    setMovementDocumentFile(null);
    setMovementDocumentPreview("");
    setRemoveMovementDocument(false);
    setMovementFileInputKey((current) => current + 1);
    setMovementNotice(`“${item.name}” kirimi tahrirlash uchun ochildi.`);
    window.requestAnimationFrame(() => revealInventorySection("stock-movement-form"));
  };

  const addStockMovement = async () => {
    const item = data.inventory.find((entry) => entry.id === movementForm.inventoryId);
    if (!item || !movementForm.quantity) {
      setMovementNotice("Mahsulot va miqdorni kiriting.");
      return;
    }
    const original = editingMovementId
      ? data.stockMovements.find((entry) => entry.id === editingMovementId)
      : undefined;
    if (editingMovementId && (!original || original.type === "sale")) {
      setMovementNotice("Tahrirlanayotgan ombor yozuvi topilmadi. Sahifani yangilang.");
      return;
    }
    if (original && isWorkerDeliveryMovement(original)) {
      setMovementNotice("Bu yozuv xodim kirimi bilan bog‘langan va alohida o‘zgartirilmaydi.");
      resetMovementDraft("receipt");
      return;
    }
    if (original?.referenceId) {
      setMovementNotice("Bog‘langan ombor harakatini alohida tahrirlab bo‘lmaydi. Uni manba bo‘limidan boshqaring.");
      resetMovementDraft("receipt");
      return;
    }
    const delta = stockMovementQuantity(movementForm.type, movementForm.quantity);
    const inventoryWithNewStocks = applyStockMovementToInventory(
      data.inventory,
      original ? { inventoryId: original.inventoryId, quantity: original.quantity } : null,
      { inventoryId: item.id, quantity: delta },
    );
    if (!inventoryWithNewStocks) {
      setMovementNotice("Bu o‘zgarish ombor qoldig‘ini minusga tushiradi. Miqdorni tekshiring.");
      return;
    }
    setMovementSaving(true);
    setMovementNotice(movementDocumentFile ? "Nakladnoy rasmi yuklanmoqda…" : "Ombor harakati saqlanmoqda…");
    const branchId = activeBranchRef.current;
    let uploadedDocument: StockDocument | undefined;
    try {
      if (movementForm.type === "receipt" && movementDocumentFile) {
        uploadedDocument = await uploadStockDocument(movementDocumentFile);
      }
      const document = movementForm.type === "receipt"
        ? uploadedDocument || (removeMovementDocument ? undefined : original?.document)
        : undefined;
      const movement: StockMovement = {
        id: original?.id || id("mov"),
        inventoryId: item.id,
        type: movementForm.type,
        quantity: delta,
        date: movementForm.date,
        note: movementForm.note.trim() || movementLabel(movementForm.type),
        ...(movementForm.type === "receipt" && movementForm.supplierId ? { supplierId: movementForm.supplierId } : {}),
        ...(movementForm.type === "receipt" && movementForm.unitCost > 0 ? { unitCost: movementForm.unitCost } : {}),
        ...(movementForm.type !== "receipt" ? { unitCost: Number(item.unitCost || 0) } : {}),
        ...(movementForm.type === "receipt" && movementForm.unitCost > 0 ? {
          previousUnitCost: original?.inventoryId === item.id && Number.isFinite(original.previousUnitCost)
            ? original.previousUnitCost
            : item.unitCost,
        } : {}),
        ...(document ? { document } : {}),
      };
      const response = await fetch(`/api/inventory-records?branch=${encodeURIComponent(branchId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveMovement",
          label: `${item.name} ${delta > 0 ? "+" : ""}${delta}`,
          movement,
          originalId: original?.id || "",
        }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; alreadySaved?: boolean };
      if (!response.ok || !result.ok) {
        if (uploadedDocument) await deleteRemoteStockDocument(uploadedDocument.key);
        setMovementNotice(`Ombor harakati saqlanmadi: ${result.error || "kiritilgan ma’lumotni tekshirib, qayta urinib ko‘ring."}`);
        return;
      }
      await reloadAuthoritativeState(branchId);
      // Replaced files stay available to the automatic pre-edit archive.
      resetMovementDraft("receipt");
      setMovementNotice(`✓ ${item.name}: ${delta > 0 ? "+" : ""}${delta.toLocaleString()} ${item.unit}${document ? " · nakladnoy saqlandi" : ""}${result.alreadySaved ? " · oldin saqlangan" : ""}`);
    } catch (error) {
      if (uploadedDocument) await deleteRemoteStockDocument(uploadedDocument.key);
      setMovementNotice(error instanceof Error ? error.message : "Ombor harakatini saqlab bo‘lmadi.");
    } finally {
      setMovementSaving(false);
    }
  };


  const addSupplier = async () => {
    if (!supplierForm.name.trim()) {
      setSupplierNotice("Yetkazib beruvchi nomini kiriting.");
      return;
    }
    setSupplierSaving(true);
    setSupplierNotice("Yetkazib beruvchi saqlanmoqda…");
    try {
      await saveAtomicSupplierRecord({
        action: "saveSupplier",
        supplier: { ...supplierForm, id: id("sup"), telegramChatId: "", autoOrder: false },
      });
      setSupplierForm({ name: "", phone: "", bankAccount: "" });
      setSupplierCreateOpen(false);
      setSupplierNotice("✓ Yetkazib beruvchi saqlandi.");
    } catch (error) {
      setSupplierNotice(error instanceof Error ? error.message : "Yetkazib beruvchi saqlanmadi.");
    } finally {
      setSupplierSaving(false);
    }
  };
  const editSupplier = (supplier: Supplier) => {
    setEditingSupplierId(supplier.id);
    setSupplierEditForm({ name: supplier.name, phone: supplier.phone || "", bankAccount: supplier.bankAccount || "" });
    setSupplierNotice(`“${supplier.name}” ma’lumoti tahrirlash uchun ochildi.`);
  };
  const openDebtEdit = (supplier: Supplier) => {
    setDebtNotice("");
    setDebtEdit({ branchId: activeBranchRef.current, supplierId: supplier.id, id: id("balance-edit"), balance: String(supplier.balance), reason: "", expectedBalance: supplier.balance, expectedOpeningBalance: Number(supplier.openingBalance || 0) });
  };
  const saveDebtEdit = async () => {
    if (!debtEdit || debtSaving) return;
    if (debtEdit.branchId !== activeBranchRef.current) { setDebtEdit(null); return; }
    if (!debtEdit.balance.trim() || !Number.isSafeInteger(Number(debtEdit.balance)) || !debtEdit.reason.trim()) {
      setDebtNotice("Qoldiqni butun vonda va tuzatish sababini kiriting."); return;
    }
    setDebtSaving(true); setDebtNotice("");
    try {
      await saveAtomicSupplierRecord({ action: "editBalance", ...debtEdit, balance: Number(debtEdit.balance) });
      setDebtEdit(null); setSupplierNotice("✓ Qarz qoldig‘i yangilandi. To‘lovlar saqlandi, tuzatish tarixga yozildi.");
    } catch (error) { setDebtNotice(error instanceof Error ? error.message : "Qoldiq saqlanmadi."); }
    finally { setDebtSaving(false); }
  };
  const saveSupplierEdit = async () => {
    const supplier = data.suppliers.find((entry) => entry.id === editingSupplierId);
    const name = supplierEditForm.name.trim().replace(/\s+/g, " ").slice(0, 100);
    if (!supplier || !name) {
      setSupplierNotice("Yetkazib beruvchi nomini kiriting.");
      return;
    }
    setSupplierSaving(true);
    try {
      await saveAtomicSupplierRecord({
        action: "saveSupplier",
        supplier: {
          ...supplier,
          name,
          phone: supplierEditForm.phone,
          bankAccount: supplierEditForm.bankAccount,
        },
      });
      setEditingSupplierId("");
      setSupplierEditForm({ name: "", phone: "", bankAccount: "" });
      setSupplierNotice(`✓ ${name} ma’lumoti yangilandi. Eski hisob-kitob tarixi saqlandi.`);
    } catch (error) {
      setSupplierNotice(error instanceof Error ? error.message : "Yetkazib beruvchi ma’lumoti saqlanmadi.");
    } finally {
      setSupplierSaving(false);
    }
  };
  const paySupplierDebt = async (supplier: Supplier) => {
    const amount = Math.max(0, Number(supplier.balance));
    if (amount <= 0.000001) {
      setSupplierNotice(`✓ ${supplier.name} bo‘yicha qarz allaqachon to‘langan.`);
      return;
    }
    const accountId = supplierPaymentAccounts[supplier.id]
      || data.accounts.find((account) => account.id === "account-bank")?.id
      || data.accounts.find((account) => account.type === "bank")?.id
      || data.accounts[0]?.id
      || "";
    const account = data.accounts.find((entry) => entry.id === accountId);
    if (!account) {
      setSupplierNotice("Qarz qaysi pul hisobidan to‘langanini tanlang.");
      return;
    }
    if (!window.confirm(`${supplier.name} uchun ${won(amount)} qarz ${account.name} hisobidan to‘liq to‘landimi?`)) return;
    setSupplierPaymentBusy(supplier.id);
    setSupplierNotice(`${supplier.name} qarzi yopilmoqda…`);
    try {
      await saveAtomicSupplierRecord({
        action: "payFullDebt",
        supplierId: supplier.id,
        accountId,
        date: today,
        operationId: supplierFullPaymentOperationIdsRef.current[supplier.id]
          || (supplierFullPaymentOperationIdsRef.current[supplier.id] = crypto.randomUUID()),
      });
      delete supplierFullPaymentOperationIdsRef.current[supplier.id];
      setSupplierNotice(`✓ ${supplier.name} · ${won(amount)} qarz to‘landi. Nakladnoylar bazada saqlandi. Holat: TO‘LANDI.`);
    } catch (error) {
      setSupplierNotice(error instanceof Error ? error.message : "Qarz to‘lovi saqlanmadi.");
    } finally {
      setSupplierPaymentBusy("");
    }
  };
  const approveSupplierDelivery = async (delivery: SupplierDelivery) => {
    if (delivery.status === "approved" || approvingSupplierDeliveryRef.current.has(delivery.id)) return;
    approvingSupplierDeliveryRef.current.add(delivery.id);
    setSupplierNotice(`${supplierName(delivery.supplierId)} yetkazmasi ombor va qarzga qo‘shilmoqda…`);
    try {
      await saveAtomicSupplierRecord({ action: "approveDelivery", deliveryId: delivery.id });
      setSupplierNotice(`✓ ${supplierName(delivery.supplierId)} yetkazmasi tasdiqlandi: ombor qoldig‘i va yetkazuvchi qarzi bir marta yangilandi.`);
    } catch (error) {
      setSupplierNotice(error instanceof Error ? error.message : "Yetkazma tasdiqlanmadi.");
    } finally {
      approvingSupplierDeliveryRef.current.delete(delivery.id);
    }
  };
  const updateSupplier = async (supplierId: string, patch: Partial<Supplier>) => {
    const supplier = data.suppliers.find((entry) => entry.id === supplierId);
    if (!supplier) return false;
    try {
      await saveAtomicSupplierRecord({ action: "saveSupplier", supplier: { ...supplier, ...patch } });
      return true;
    } catch (error) {
      setSupplierNotice(error instanceof Error ? error.message : "Yetkazib beruvchi sozlamasi saqlanmadi.");
      return false;
    }
  };
  const discoverSupplierTelegram = async (supplier: Supplier) => {
    setSupplierTelegramBusy(supplier.id);
    setSupplierTelegramNotice("");
    try {
      const result = await telegramRequest({ action: "discover" });
      await updateSupplier(supplier.id, { telegramChatId: result.chatId });
      setSupplierTelegramNotice(`✓ ${supplier.name}: ${result.chatName || "Telegram chat"} topildi.`);
    } catch (error) {
      setSupplierTelegramNotice(error instanceof Error ? error.message : "Yetkazib beruvchi chati topilmadi.");
    } finally {
      setSupplierTelegramBusy("");
    }
  };
  const saveMezanaTelegramConnection = async (payload: Record<string, unknown>, busyKey: string) => {
    if (mezanaTelegramBusyRef.current || branchTransitionRef.current) return;
    const branchId = activeBranchRef.current;
    mezanaTelegramBusyRef.current = true;
    setSupplierTelegramBusy(busyKey);
    setSupplierTelegramNotice("Guruh ulanmoqda…");
    const operation = saveQueueRef.current.then(async () => {
      if (activeBranchRef.current !== branchId) throw new Error("Filial almashtirilgan. Shu filialda qayta urinib ko‘ring.");
      const result = await telegramRequest(payload, branchId);
      if (!result.ok || !result.mezanaSettings || !result.updatedAt) {
        throw new Error("MEZANA guruhi saqlanmadi. Shu oynada qayta urinib ko‘ring.");
      }
      const mezanaSettings = normalizeMezanaSettings(result.mezanaSettings);
      // Apply the confirmed settings without claiming the rest of the snapshot is current.
      serverStateRef.current = { ...serverStateRef.current, mezanaSettings };
      localStateRef.current = { ...localStateRef.current, mezanaSettings };
      setData((current) => ({ ...current, mezanaSettings }));
      try {
        const response = await fetch(`/api/state?branch=${encodeURIComponent(branchId)}`, {
          cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        const fresh = await response.json() as Partial<AppState>;
        if (response.ok && fresh.updatedAt && activeBranchRef.current === branchId) {
          // Preserve edits queued while Telegram was responding.
          const queuedPatch = createStatePatch(serverStateRef.current, localStateRef.current);
          const normalized = normalizeAppState(fresh);
          serverRevisionRef.current = normalized.updatedAt || "";
          serverStateRef.current = normalized;
          localStateRef.current = applyStatePatch(normalized, queuedPatch);
          setData(localStateRef.current);
        }
      } catch {
        // The link is already saved. Regular synchronization can refresh the snapshot.
      }
      return result;
    });
    // Joining the queue prevents polling or branch changes from replacing the receipt.
    // An unrelated failed save remains available for its own retry.
    saveQueueRef.current = operation.then(() => !failedSaveRef.current, () => !failedSaveRef.current);
    try {
      const result = await operation;
      setSupplierTelegramNotice(result.warning || `✓ ${result.chatName || "MEZANA Telegram sozlamasi"} saqlandi.`);
      return result;
    } catch (error) {
      setSupplierTelegramNotice(error instanceof Error ? error.message : "MEZANA guruhi ulanmagan. Shu oynada qayta urinib ko‘ring.");
    } finally {
      mezanaTelegramBusyRef.current = false;
      setSupplierTelegramBusy("");
    }
  };
  const updateMezanaTelegram = (patch: Partial<MezanaSettings>) => {
    const destination = patch.purchasedTelegramChatId !== undefined ? "purchased" : "borrowed";
    return saveMezanaTelegramConnection({
      action: "save-mezana",
      mezanaDestination: destination,
      chatId: destination === "purchased" ? patch.purchasedTelegramChatId : patch.telegramChatId,
    }, "mezana-" + destination);
  };
  const discoverMezanaTelegram = async (destination: "borrowed" | "purchased") => {
    await saveMezanaTelegramConnection({ action: "discover-mezana", mezanaDestination: destination }, "mezana-" + destination);
  };
  const resendLatestMezanaTelegram = async () => {
    setSupplierTelegramBusy("mezana-resend");
    setSupplierTelegramNotice("");
    try {
      const latestEntry = [...data.mezanaEntries].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (!latestEntry) throw new Error("Qayta yuborish uchun MEZANA yozuvi yo‘q.");
      const response = await fetch("/api/owner-mezana", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: activeBranchId, entryId: latestEntry.id }),
      });
      const result = await response.json() as { ok?: boolean; telegram?: { sent?: boolean; reason?: string }; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Oxirgi MEZANA yozuvi guruhga yuborilmadi.");
      setSupplierTelegramNotice(result.telegram?.sent
        ? `✓ ${latestEntry.productName} MEZANA guruhiga yuborildi.`
        : result.telegram?.reason || "Oxirgi MEZANA yozuvi guruhga yuborilmadi.");
    } catch (error) {
      setSupplierTelegramNotice(error instanceof Error ? error.message : "Oxirgi MEZANA yozuvi guruhga yuborilmadi.");
    } finally {
      setSupplierTelegramBusy("");
    }
  };
  const chooseOwnerMezanaFile = async (position: "top" | "bottom", event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile) return;
    setOwnerMezanaNotice("Rasm tayyorlanmoqda…");
    try {
      const prepared = await prepareStockImageUpload(selectedFile);
      if (position === "top") {
        if (ownerMezanaTopPreview) URL.revokeObjectURL(ownerMezanaTopPreview);
        setOwnerMezanaTopFile(prepared.file);
        setOwnerMezanaTopPreview(URL.createObjectURL(prepared.file));
      } else {
        if (ownerMezanaBottomPreview) URL.revokeObjectURL(ownerMezanaBottomPreview);
        setOwnerMezanaBottomFile(prepared.file);
        setOwnerMezanaBottomPreview(URL.createObjectURL(prepared.file));
      }
      setOwnerMezanaNotice(preparedImageNotice(prepared));
    } catch (error) {
      setOwnerMezanaNotice(error instanceof Error ? error.message : "Rasm qabul qilinmadi.");
      setOwnerMezanaFileKey((current) => current + 1);
    }
  };
  const chooseMezanaCatalogImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile) return;
    setMezanaCatalogNotice("Mahsulot rasmi tayyorlanmoqda…");
    try {
      const prepared = await prepareStockImageUpload(selectedFile);
      if (mezanaCatalogPreview) URL.revokeObjectURL(mezanaCatalogPreview);
      setMezanaCatalogFile(prepared.file);
      setMezanaCatalogPreview(URL.createObjectURL(prepared.file));
      setMezanaCatalogNotice(preparedImageNotice(prepared));
    } catch (error) {
      setMezanaCatalogNotice(error instanceof Error ? error.message : "Rasm qabul qilinmadi.");
      setMezanaCatalogFileKey((current) => current + 1);
    }
  };
  const resetMezanaCatalogForm = () => {
    if (mezanaCatalogPreview) URL.revokeObjectURL(mezanaCatalogPreview);
    setMezanaCatalogForm({ name: "", mode: "borrowed", price: 0, inventoryId: "", inventoryUnitsPerItem: 1 });
    setEditingMezanaCatalogId("");
    setMezanaCatalogFile(null);
    setMezanaCatalogPreview("");
    setMezanaCatalogFileKey((current) => current + 1);
    mezanaCatalogOperationIdRef.current = "";
  };
  const saveMezanaCatalogItem = async () => {
    if (mezanaCatalogSaving) return;
    if (!mezanaCatalogForm.name.trim() || !Number.isSafeInteger(mezanaCatalogForm.price) || mezanaCatalogForm.price <= 0) {
      setMezanaCatalogNotice("Mahsulot nomi va narxini tekshiring.");
      return;
    }
    setMezanaCatalogSaving(true);
    setMezanaCatalogNotice("Mahsulot ro‘yxatga saqlanmoqda…");
    try {
      const form = new FormData();
      form.set("branchId", activeBranchRef.current);
      form.set("operationId", mezanaCatalogOperationIdRef.current || (mezanaCatalogOperationIdRef.current = crypto.randomUUID()));
      if (editingMezanaCatalogId) form.set("itemId", editingMezanaCatalogId);
      form.set("name", mezanaCatalogForm.name.trim());
      form.set("mode", mezanaCatalogForm.mode);
      form.set("price", String(mezanaCatalogForm.price));
      form.set("inventoryId", mezanaCatalogForm.inventoryId);
      form.set("inventoryUnitsPerItem", String(mezanaCatalogForm.inventoryUnitsPerItem));
      if (mezanaCatalogFile) appendImageToForm(form, "image", mezanaCatalogFile, "mezana-mahsulot");
      const response = await postMultipartJson<{ ok?: boolean; item?: unknown; updatedAt?: string; error?: string }>("/api/owner-mezana-catalog", form);
      const item = normalizeMezanaCatalog(response.data.item ? [response.data.item] : [])[0];
      if (!response.ok || !response.data.ok || !item || !response.data.updatedAt) throw new Error(response.data.error || "Mahsulot saqlanmadi.");
      const merge = (current: AppState): AppState => ({
        ...current,
        mezanaCatalog: [item, ...current.mezanaCatalog.filter((candidate) => candidate.id !== item.id)],
        updatedAt: response.data.updatedAt || current.updatedAt,
      });
      serverRevisionRef.current = response.data.updatedAt;
      serverStateRef.current = merge(serverStateRef.current);
      localStateRef.current = merge(localStateRef.current);
      setData((current) => merge(current));
      resetMezanaCatalogForm();
      setMezanaCatalogNotice(`✓ ${item.name} xodimlar ro‘yxatiga saqlandi.`);
    } catch (error) {
      setMezanaCatalogNotice(error instanceof Error ? error.message : "Mahsulot saqlanmadi.");
    } finally {
      setMezanaCatalogSaving(false);
    }
  };
  const editMezanaCatalogItem = (item: MezanaCatalogItem) => {
    resetMezanaCatalogForm();
    setEditingMezanaCatalogId(item.id);
    setMezanaCatalogForm({ name: item.name, mode: item.mode, price: item.price, inventoryId: item.inventoryId || "", inventoryUnitsPerItem: item.inventoryUnitsPerItem || 1 });
    setMezanaCatalogNotice(`${item.name} tahrirlanmoqda. Yangi rasm tanlanmasa, hozirgi rasm qoladi.`);
  };
  const toggleMezanaCatalogItem = async (item: MezanaCatalogItem) => {
    if (mezanaCatalogSaving) return;
    setMezanaCatalogSaving(true);
    setMezanaCatalogNotice(item.active ? "Mahsulot xodimlar ro‘yxatidan yashirilmoqda…" : "Mahsulot qayta ochilmoqda…");
    try {
      const response = await fetch("/api/owner-mezana-catalog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: activeBranchRef.current, itemId: item.id, active: !item.active }),
      });
      const result = await response.json() as { ok?: boolean; item?: unknown; updatedAt?: string; error?: string };
      const updated = normalizeMezanaCatalog(result.item ? [result.item] : [])[0];
      if (!response.ok || !result.ok || !updated || !result.updatedAt) throw new Error(result.error || "Mahsulot holati o‘zgarmadi.");
      const merge = (current: AppState): AppState => ({
        ...current,
        mezanaCatalog: current.mezanaCatalog.map((candidate) => candidate.id === updated.id ? updated : candidate),
        updatedAt: result.updatedAt || current.updatedAt,
      });
      serverRevisionRef.current = result.updatedAt;
      serverStateRef.current = merge(serverStateRef.current);
      localStateRef.current = merge(localStateRef.current);
      setData((current) => merge(current));
      setMezanaCatalogNotice(`✓ ${updated.name} ${updated.active ? "xodimlarga ochildi" : "xodimlardan yashirildi"}.`);
    } catch (error) {
      setMezanaCatalogNotice(error instanceof Error ? error.message : "Mahsulot holati o‘zgarmadi.");
    } finally {
      setMezanaCatalogSaving(false);
    }
  };
  const closeMezanaBalance = async (kind: "paid" | "returned", item?: MezanaCatalogItem, quantity = 0) => {
    const amount = kind === "paid" ? mezanaCurrentBalance : 0;
    if (kind === "paid" && amount <= 0) return;
    if (kind === "returned" && (!item || quantity <= 0)) return;
    const label = kind === "paid" ? `₩${amount.toLocaleString("en-US")} qarzni to‘liq to‘langan` : `${item?.name || "Mahsulot"} ${quantity} ta to‘liq qaytarilgan`;
    if (!window.confirm(`${label} deb belgilab, qoldiq 0 qilinsinmi?\n\nOldingi yozuvlar o‘chmaydi, tarixda qoladi.`)) return;
    const busyKey = kind === "paid" ? "paid" : item!.id;
    setMezanaZeroBusy(busyKey);
    setMezanaEditNotice("0 qilish yozuvi saqlanmoqda…");
    try {
      const form = new FormData();
      form.set("branchId", activeBranchRef.current);
      form.set("operationId", crypto.randomUUID());
      form.set("action", kind);
      form.set("productName", kind === "paid" ? "MEZANA umumiy qarzi" : item!.name);
      if (item) form.set("catalogItemId", item.id);
      form.set("amount", String(amount));
      form.set("quantity", String(quantity));
      form.set("date", seoulCalendarDate());
      form.set("note", kind === "paid" ? "To‘liq to‘landi · qoldiq 0 qilindi" : "Hammasi qaytarildi · qoldiq 0 qilindi");
      const response = await postMultipartJson<{ ok?: boolean; entry?: unknown; updatedAt?: string; telegram?: { sent?: boolean; reason?: string }; error?: string }>("/api/owner-mezana", form);
      const entry = normalizeMezanaDebtEntry(response.data.entry);
      if (!response.ok || !response.data.ok || !entry || !response.data.updatedAt) throw new Error(response.data.error || "Qoldiq 0 qilinmadi.");
      const merge = (current: AppState): AppState => ({
        ...current,
        mezanaEntries: [entry, ...current.mezanaEntries.filter((candidate) => candidate.id !== entry.id)],
        updatedAt: response.data.updatedAt || current.updatedAt,
      });
      serverRevisionRef.current = response.data.updatedAt;
      serverStateRef.current = merge(serverStateRef.current);
      localStateRef.current = merge(localStateRef.current);
      setData((current) => merge(current));
      setMezanaEditNotice(`✓ ${kind === "paid" ? "MEZANA qarzi" : item!.name + " qoldig‘i"} 0 qilindi. Oldingi yozuvlar tarixda saqlandi.`);
    } catch (error) {
      setMezanaEditNotice(error instanceof Error ? error.message : "Qoldiq 0 qilinmadi.");
    } finally {
      setMezanaZeroBusy("");
    }
  };
  const saveOwnerMezana = async () => {
    if (ownerMezanaSavingRef.current || ownerMezanaSaving) return;
    if (branchTransitionRef.current) {
      setOwnerMezanaNotice("Filial ochilmoqda. Tugagach MEZANA yozuvini saqlang.");
      return;
    }
    if (!ownerSelectedMezanaCatalogItem
      || !ownerMezanaForm.date
      || (ownerMezanaForm.action === "purchased" && (!Number.isSafeInteger(ownerMezanaForm.itemCount) || ownerMezanaForm.itemCount <= 0))
      || (ownerMezanaForm.action !== "purchased" && (!Number.isSafeInteger(ownerMezanaForm.quantity) || ownerMezanaForm.quantity <= 0))) {
      setOwnerMezanaNotice("Rahbar ro‘yxatidagi mahsulotni va sonini tanlang.");
      return;
    }
    if (ownerMezanaForm.action === "returned") {
      const productName = ownerMezanaForm.productName.trim();
      const available = Math.max(0, mezanaBorrowedQuantityBalance(data.mezanaEntries, productName));
      if (ownerMezanaForm.quantity > available) {
        setOwnerMezanaNotice(`${productName}dan faqat ${available} ta olib turilgan. Qaytariladigan son bundan oshmasin.`);
        return;
      }
    }
    ownerMezanaSavingRef.current = true;
    setOwnerMezanaSaving(true);
    setOwnerMezanaNotice("Saqlanmoqda va MEZANA guruhiga yuborilmoqda…");
    try {
      const branchId = activeBranchRef.current;
      const form = new FormData();
      form.set("branchId", branchId);
      form.set("operationId", ownerMezanaOperationIdRef.current || (ownerMezanaOperationIdRef.current = crypto.randomUUID()));
      form.set("action", ownerMezanaForm.action);
      form.set("catalogItemId", ownerSelectedMezanaCatalogItem.id);
      form.set("productName", ownerSelectedMezanaCatalogItem.name);
      form.set("amount", String(ownerSelectedMezanaCatalogItem.price * ownerMezanaForm.itemCount));
      form.set("quantity", String(ownerMezanaForm.quantity));
      form.set("itemCount", String(ownerMezanaForm.itemCount));
      form.set("date", ownerMezanaForm.date);
      form.set("note", ownerMezanaForm.note.trim());
      form.set("updatedAt", serverRevisionRef.current || data.updatedAt || "");
      if (ownerMezanaTopFile) appendImageToForm(form, "fileTop", ownerMezanaTopFile, "mezana-yuqori");
      if (ownerMezanaBottomFile) appendImageToForm(form, "fileBottom", ownerMezanaBottomFile, "mezana-pastki");
      type OwnerMezanaReceipt = {
        ok?: boolean;
        entry?: unknown;
        balance?: number;
        updatedAt?: string;
        telegram?: { sent?: boolean; reason?: string };
        error?: string;
      };
      let uploadResult: MultipartJsonResult<OwnerMezanaReceipt>;
      try {
        uploadResult = await postMultipartJson<OwnerMezanaReceipt>("/api/owner-mezana", form);
      } catch (firstError) {
        setOwnerMezanaNotice("Yozuv serverda tekshirilmoqda…");
        await new Promise((resolve) => window.setTimeout(resolve, 1_200));
        try {
          uploadResult = await postMultipartJson<OwnerMezanaReceipt>("/api/owner-mezana", form);
        } catch {
          throw firstError;
        }
      }
      const result = uploadResult.data;
      const savedEntry = normalizeMezanaDebtEntry(result.entry);
      if (!uploadResult.ok || !result.ok || !savedEntry || !result.updatedAt) {
        throw new Error(result.error || "MEZANA yozuvi saqlanmadi.");
      }
      const mergeReceipt = (current: AppState): AppState => ({
        ...current,
        mezanaEntries: [savedEntry, ...normalizeMezanaDebtEntries(current.mezanaEntries).filter((entry) => entry.id !== savedEntry.id)],
        updatedAt: result.updatedAt || current.updatedAt,
      });
      serverRevisionRef.current = result.updatedAt;
      serverStateRef.current = mergeReceipt(serverStateRef.current);
      localStateRef.current = mergeReceipt(localStateRef.current);
      setData((current) => mergeReceipt(current));
      await reloadAuthoritativeState(branchId);
      ownerMezanaOperationIdRef.current = "";
      const savedText = `✓ ${mezanaDebtActionLabel(ownerMezanaForm.action)} · ${ownerSelectedMezanaCatalogItem.name} · ${ownerMezanaForm.action === "purchased" ? won(ownerSelectedMezanaCatalogItem.price * ownerMezanaForm.itemCount) : `${ownerMezanaForm.quantity} ta`}`;
      setOwnerMezanaNotice(result.telegram?.sent
        ? `${savedText} · MEZANA guruhiga yuborildi.`
        : `${savedText}. ${result.telegram?.reason || "MEZANA guruhiga yuborilmadi."}`);
      setOwnerMezanaForm((current) => ({ ...current, catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1, note: "" }));
      if (ownerMezanaTopPreview) URL.revokeObjectURL(ownerMezanaTopPreview);
      if (ownerMezanaBottomPreview) URL.revokeObjectURL(ownerMezanaBottomPreview);
      setOwnerMezanaTopFile(null);
      setOwnerMezanaBottomFile(null);
      setOwnerMezanaTopPreview("");
      setOwnerMezanaBottomPreview("");
      setOwnerMezanaFileKey((current) => current + 1);
    } catch (error) {
      setOwnerMezanaNotice(error instanceof Error ? error.message : "MEZANA yozuvi saqlanmadi.");
    } finally {
      ownerMezanaSavingRef.current = false;
      setOwnerMezanaSaving(false);
    }
  };
  const editMezanaEntry = (entry: MezanaDebtEntry) => {
    setEditingMezanaId(entry.id);
    setMezanaEditForm({
      action: entry.action,
      productName: entry.productName,
      quantity: entry.quantity || 0,
      amount: entry.amount,
      date: entry.date,
      note: entry.note,
    });
    setMezanaEditNotice("");
  };
  const cancelMezanaEdit = () => {
    setEditingMezanaId("");
    setMezanaEditNotice("Tahrirlash bekor qilindi.");
  };
  const notifyMezanaChange = async (event: "edited" | "deleted", entryId: string, before?: MezanaDebtEntry) => {
    try {
      const response = await fetch("/api/owner-mezana-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: activeBranchRef.current, event, entryId, before }),
      });
      const result = await response.json() as { ok?: boolean; telegram?: { sent?: boolean; reason?: string }; error?: string };
      if (!response.ok || !result.ok) return { sent: false, reason: result.error || "Telegramga o‘zgarish yuborilmadi." };
      return result.telegram || { sent: false, reason: "Telegramga o‘zgarish yuborilmadi." };
    } catch {
      return { sent: false, reason: "Telegramga o‘zgarish yuborilmadi." };
    }
  };
  const saveMezanaEdit = async () => {
    const current = data.mezanaEntries.find((entry) => entry.id === editingMezanaId);
    if (!current || mezanaSaving) return;
    const edited: MezanaDebtEntry = {
      ...current,
      action: mezanaEditForm.action,
      productName: mezanaEditForm.productName.trim(),
      amount: mezanaEditForm.action === "purchased" ? Math.round(Number(mezanaEditForm.amount)) : 0,
      ...(mezanaEditForm.action === "purchased"
        ? { quantity: undefined }
        : { quantity: Math.round(Number(mezanaEditForm.quantity)) }),
      date: mezanaEditForm.date,
      note: mezanaEditForm.note.trim(),
    };
    if (!validMezanaDebtEntry(edited)) {
      setMezanaEditNotice(mezanaEditForm.action === "purchased" ? "Mahsulot nomi va summani tekshiring." : "Mahsulot nomi va sonini tekshiring.");
      return;
    }
    if (current.action !== edited.action && !window.confirm(
      `Amal turi “${mezanaDebtActionLabel(current.action)}”dan “${mezanaDebtActionLabel(edited.action)}”ga o‘zgartiriladi. Davom etilsinmi?`,
    )) return;
    const nextEntries = data.mezanaEntries.map((entry) => entry.id === edited.id ? edited : entry);
    if (hasNegativeMezanaBorrowedQuantity(nextEntries)) {
      setMezanaEditNotice("Bu o‘zgarish olib turilgan mahsulot sonini minusga tushiradi.");
      return;
    }
    if (mezanaDebtBalance(nextEntries) < 0) {
      setMezanaEditNotice("Bu o‘zgarish MEZANA qarzini minusga tushiradi. Summa yoki amal turini tekshiring.");
      return;
    }
    setMezanaSaving(true);
    setMezanaEditNotice("O‘zgarish saqlanmoqda…");
    try {
      const saved = await save({ ...data, mezanaEntries: nextEntries }, `MEZANA yozuvi tahrirlandi · ${edited.productName} · ${mezanaEntryValue(edited)}`);
      if (!saved) {
        setMezanaEditNotice("O‘zgarish saqlanmadi. Qayta urinib ko‘ring.");
        return;
      }
      const telegram = await notifyMezanaChange("edited", edited.id, current);
      setEditingMezanaId("");
      setMezanaEditNotice(telegram.sent
        ? `✓ ${edited.productName} yozuvi tahrirlandi, qarz qayta hisoblandi va o‘zgarish MEZANA guruhiga yuborildi.`
        : `✓ ${edited.productName} yozuvi tahrirlandi va qarz qayta hisoblandi. ${telegram.reason}`);
    } finally {
      setMezanaSaving(false);
    }
  };
  const deleteMezanaEntry = async (entry: MezanaDebtEntry) => {
    if (mezanaDeletionBusy) return;
    if (!window.confirm(`“${entry.productName} · ${mezanaEntryValue(entry)}” MEZANA yozuvi o‘chirilsinmi?\n\nMEZANA hisobi avtomatik qayta hisoblanadi. Yozuv “Bekor qilinganlar” bo‘limidan tiklanadi.`)) return;
    const reason = askCancellationReason(`${entry.productName} · ${mezanaEntryValue(entry)}`);
    if (!reason) return;
    const nextEntries = data.mezanaEntries.filter((item) => item.id !== entry.id);
    if (hasNegativeMezanaBorrowedQuantity(nextEntries)) {
      setMezanaEditNotice("Bu yozuvni o‘chirish olib turilgan mahsulot sonini minusga tushiradi.");
      return;
    }
    if (mezanaDebtBalance(nextEntries) < 0) {
      setMezanaEditNotice("Bu yozuvni o‘chirish qarzni minusga tushiradi. Avval unga bog‘liq “Qaytarib qo‘yildi” yozuvini tahrirlang yoki o‘chiring.");
      return;
    }
    setMezanaDeletionBusy(entry.id);
    setMezanaEditNotice("MEZANA yozuvi o‘chirilmoqda…");
    try {
      const saved = await save(withDeletedItem(
        { ...data, mezanaEntries: nextEntries },
        {
          kind: "mezanaEntry",
          entityId: entry.id,
          label: `${entry.productName} · ${mezanaEntryValue(entry)}`,
          section: "MEZANA",
          record: entry as unknown as Record<string, unknown>,
        },
        reason,
      ), `MEZANA yozuvi o‘chirildi · ${entry.productName} · Sabab: ${reason}`);
      if (!saved) {
        setMezanaEditNotice("MEZANA yozuvi o‘chirilmadi. Qayta urinib ko‘ring.");
        return;
      }
      const telegram = await notifyMezanaChange("deleted", entry.id);
      if (editingMezanaId === entry.id) setEditingMezanaId("");
      setMezanaEditNotice(telegram.sent
        ? `✓ ${entry.productName} yozuvi o‘chirildi, qarz qayta hisoblandi va o‘zgarish MEZANA guruhiga yuborildi.`
        : `✓ ${entry.productName} yozuvi o‘chirildi va qarz qayta hisoblandi. ${telegram.reason}`);
    } finally {
      setMezanaDeletionBusy("");
    }
  };
  const addRecipeDraftIngredient = () => setRecipeForm((current) => ({
    ...current,
    ingredients: current.ingredients.every((ingredient) => (
      ingredient.name.trim() && Number(ingredient.quantity) > 0 && Number(ingredient.lineCost) > 0
    ))
      ? [...current.ingredients, { id: id("draft-ing"), inventoryId: "", name: "", unit: "g", quantity: 0, lineCost: 0 }]
      : current.ingredients,
  }));
  const updateRecipeDraftIngredient = (index: number, patch: Partial<RecipeDraftIngredient>) => setRecipeForm((current) => ({
    ...current,
    ingredients: current.ingredients.map((ingredient, ingredientIndex) => (
      ingredientIndex === index ? { ...ingredient, ...patch } : ingredient
    )),
  }));
  const selectRecipeInventoryIngredient = (index: number, inventoryId: string) => setRecipeForm((current) => ({
    ...current,
    ingredients: current.ingredients.map((ingredient, ingredientIndex) => {
      if (ingredientIndex !== index) return ingredient;
      const inventoryItem = data.inventory.find((item) => item.id === inventoryId);
      if (!inventoryItem) return { ...ingredient, inventoryId: "" };
      const convertedQuantity = Number(ingredient.quantity) > 0
        ? convertRecipeQuantity(ingredient.quantity, ingredient.unit, inventoryItem.unit, inventoryItem.gramsPerUnit)
        : 0;
      const quantity = convertedQuantity ?? 0;
      return {
        ...ingredient,
        inventoryId: inventoryItem.id,
        name: inventoryItem.name,
        unit: inventoryItem.unit,
        quantity,
        lineCost: quantity > 0
          ? inventoryItem.unitCost * quantity
          : 0,
      };
    }),
  }));
  const updateRecipeIngredientQuantity = (index: number, quantity: number) => setRecipeForm((current) => ({
    ...current,
    ingredients: current.ingredients.map((ingredient, ingredientIndex) => {
      if (ingredientIndex !== index) return ingredient;
      const inventoryItem = data.inventory.find((item) => item.id === ingredient.inventoryId);
      return {
        ...ingredient,
        quantity,
        ...(inventoryItem ? { lineCost: quantity > 0 ? inventoryItem.unitCost * quantity : 0 } : {}),
      };
    }),
  }));
  const removeRecipeDraftIngredient = (index: number) => setRecipeForm((current) => ({
    ...current,
    ingredients: current.ingredients.length === 1
      ? [{ id: id("draft-ing"), inventoryId: "", name: "", unit: "g", quantity: 0, lineCost: 0 }]
      : current.ingredients.filter((_, ingredientIndex) => ingredientIndex !== index),
  }));
  const addRecipeExtraCost = () => setRecipeForm((current) => ({
    ...current,
    extraCosts: current.extraCosts.length >= 20
      ? current.extraCosts
      : [...current.extraCosts, { id: id("draft-cost"), name: "", amount: 0 }],
  }));
  const updateRecipeExtraCost = (costId: string, patch: Partial<RecipeExtraCost>) => setRecipeForm((current) => ({
    ...current,
    extraCosts: current.extraCosts.map((extraCost) => (
      extraCost.id === costId ? { ...extraCost, ...patch } : extraCost
    )),
  }));
  const removeRecipeExtraCost = (costId: string) => setRecipeForm((current) => ({
    ...current,
    extraCosts: current.extraCosts.filter((extraCost) => extraCost.id !== costId),
  }));
  const showRecipeError = (message: string) => {
    setRecipeNotice(message);
    window.requestAnimationFrame(() => {
      document.getElementById("recipe-cost-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const addRecipe = async () => {
    if (recipeSaving) return;
    const name = recipeForm.name.trim();
    const posCode = normalizeMenuCode(recipeForm.posCode) || nextMenuCode(data.recipes);
    const salePrice = Number(recipeForm.salePrice);
    if (!name) {
      showRecipeError("Taom nomini kiriting.");
      return;
    }
    if (!Number.isFinite(salePrice) || salePrice < 0) {
      showRecipeError("Sotuv narxini tekshiring yoki hozircha bo‘sh qoldiring.");
      return;
    }
    const nameKey = normalizeHumanNameKey(name);
    if (!nameKey) {
      showRecipeError("Taom nomida kamida bitta harf yoki raqam bo‘lsin.");
      return;
    }
    if (data.recipes.some((recipe) => recipe.id !== editingRecipeId && normalizeHumanNameKey(recipe.name) === nameKey)) {
      showRecipeError("Bu nomdagi taom allaqachon mavjud. Mavjud retseptni tahrirlang.");
      return;
    }
    if (data.recipes.some((recipe) => recipe.id !== editingRecipeId && recipeHasMenuCode(recipe, posCode))) {
      showRecipeError(`“${posCode}” kodi boshqa taomga biriktirilgan. Boshqa kod kiriting.`);
      return;
    }
    const editingRecipe = editingRecipeId
      ? data.recipes.find((recipe) => recipe.id === editingRecipeId)
      : undefined;
    const archivedEditingIngredient = editingRecipe
      ? missingRecipeIngredient(editingRecipe, data.inventory)
      : undefined;
    if (archivedEditingIngredient) {
      const missingId = String(archivedEditingIngredient.inventoryId || "");
      showRecipeError(`“${String(archivedEditingIngredient.name || inventoryName(missingId))}” ombor savatida. Avval Bekor qilinganlar → Savat / tiklash oynasidan mahsulotni qaytaring, keyin retseptni tahrirlang.`);
      return;
    }
    const categoryId = validCategoryId(data.productCategories, "recipe", recipeForm.categoryId);
    const activeIngredientRows = recipeForm.ingredients.filter((ingredient) => (
      ingredient.name.trim() || Number(ingredient.quantity) !== 0 || Number(ingredient.lineCost) !== 0
    ));
    if (!activeIngredientRows.length) {
      showRecipeError("Kamida bitta ingredient va uning miqdorini kiriting.");
      return;
    }
    const invalidIngredientRow = activeIngredientRows.some((ingredient) => (
      !ingredient.name.trim()
      || ingredient.name.trim().length > 80
      || !["g", "kg", "ml", "litr", "dona"].includes(ingredient.unit)
      || !Number.isFinite(Number(ingredient.quantity))
      || Number(ingredient.quantity) <= 0
      || Number(ingredient.quantity) > 1_000_000_000
      || !Number.isFinite(Number(ingredient.lineCost))
      || Number(ingredient.lineCost) <= 0
      || Number(ingredient.lineCost) > 1_000_000_000_000
    ));
    if (invalidIngredientRow) {
      showRecipeError("Har bir ingredient nomi, miqdori va shu taomga ketgan narxini yozing.");
      return;
    }
    const ingredientKeys = activeIngredientRows.map((ingredient) => `${normalizeHumanNameKey(ingredient.name)}:${ingredient.unit}`);
    if (new Set(ingredientKeys).size !== ingredientKeys.length) {
      showRecipeError("Bir ingredient ikki marta tanlangan. Uni bitta qatorda umumiy miqdor bilan yozing.");
      return;
    }
    const cleanIngredients: Ingredient[] = normalizeRecipeIngredients(activeIngredientRows.map((ingredient) => {
      const matchedInventory = data.inventory.find((item) => item.id === ingredient.inventoryId)
        || data.inventory.find((item) => (
          normalizeHumanNameKey(item.name) === normalizeHumanNameKey(ingredient.name)
          && item.unit === ingredient.unit
        ));
      const quantity = Number(ingredient.quantity);
      const lineCost = Number(ingredient.lineCost);
      return {
        id: ingredient.id,
        inventoryId: matchedInventory?.id || "",
        name: matchedInventory?.name || ingredient.name.trim(),
        unit: matchedInventory?.unit || ingredient.unit,
        quantity,
        lineCost,
        unitCost: lineCost / quantity,
      };
    }), data.inventory).map((ingredient) => ({ ...ingredient, inventoryId: ingredient.inventoryId || "" }));
    const activeExtraCostRows = recipeForm.extraCosts.filter((extraCost) => (
      extraCost.name.trim() || Number(extraCost.amount) !== 0
    ));
    if (activeExtraCostRows.length > 20) {
      showRecipeError("Bitta taomga ko‘pi bilan 20 ta qo‘shimcha xarajat kiriting.");
      return;
    }
    const invalidExtraCost = activeExtraCostRows.some((extraCost) => (
      !extraCost.name.trim()
      || extraCost.name.trim().length > 80
      || !Number.isFinite(Number(extraCost.amount))
      || Number(extraCost.amount) <= 0
      || Number(extraCost.amount) > 1_000_000_000
    ));
    if (invalidExtraCost) {
      showRecipeError("Har bir qo‘shimcha xarajat nomi va 0 dan katta summasini kiriting.");
      return;
    }
    const cleanExtraCosts: RecipeExtraCost[] = activeExtraCostRows.map((extraCost) => ({
      id: extraCost.id || id("cost"),
      name: extraCost.name.trim(),
      amount: Number(extraCost.amount),
    }));
    const rawIngredientCost = cleanIngredients.reduce((sum, ingredient) => sum + Number(ingredient.lineCost || 0), 0);
    const rawExtraCost = cleanExtraCosts.reduce((sum, extraCost) => sum + extraCost.amount, 0);
    if (![rawIngredientCost, rawExtraCost, rawIngredientCost + rawExtraCost].every(Number.isFinite)) {
      showRecipeError("Tannarx hisobida juda katta yoki noto‘g‘ri qiymat bor. Miqdor va birlik narxini tekshiring.");
      return;
    }
    const costBreakdown = calculateRecipeCostBreakdown(cleanIngredients, data.inventory, cleanExtraCosts);
    if (![costBreakdown.ingredientCost, costBreakdown.extraCost, costBreakdown.totalCost].every(Number.isFinite)) {
      showRecipeError("Tannarx hisobida juda katta yoki noto‘g‘ri qiymat bor. Miqdor va birlik narxini tekshiring.");
      return;
    }

    const nextRecipeId = editingRecipeId || draftRecipeIdRef.current || id("rec");
    if (!editingRecipeId && !draftRecipeIdRef.current) draftRecipeIdRef.current = nextRecipeId;
    const nextRecipe: Recipe = {
      id: nextRecipeId,
      name,
      posCode,
      posAliases: editingRecipe?.posCode && normalizeMenuCode(editingRecipe.posCode) !== posCode
        ? [...new Set([...(editingRecipe.posAliases || []), normalizeMenuCode(editingRecipe.posCode)])]
        : editingRecipe?.posAliases || [],
      salePrice,
      categoryId,
      ingredients: cleanIngredients,
      extraCosts: cleanExtraCosts,
    };
    setRecipeSaving(true);
    setRecipeNotice("Saqlanmoqda…");
    try {
      const saved = await save(
        {
          ...data,
          recipes: editingRecipeId
            ? data.recipes.map((recipe) => recipe.id === editingRecipeId ? nextRecipe : recipe)
            : [...data.recipes, nextRecipe],
        },
        `${editingRecipeId ? "Taom tannarxi yangilandi" : "Taom tannarxi qo‘shildi"} · ${name} · tannarx ${won(costBreakdown.totalCost)} · ombor o‘zgarmadi`,
      );
      if (saved) {
        setRecipeForm(emptyRecipeDraft());
        setEditingRecipeId("");
        draftRecipeIdRef.current = "";
        setRecipeNotice(`✓ ${name} tannarxi saqlandi: ${won(costBreakdown.totalCost)}`);
      } else {
        showRecipeError("Taom saqlanmadi. Ma’lumotlar joyida qoldi — qayta urinib ko‘ring.");
      }
    } finally {
      setRecipeSaving(false);
    }
  };
  const editRecipeCost = (recipe: Recipe) => {
    const archivedIngredient = missingRecipeIngredient(recipe, data.inventory);
    if (archivedIngredient) {
      const missingId = String(archivedIngredient.inventoryId || "");
      setRecipeNotice(`“${String(archivedIngredient.name || inventoryName(missingId))}” ombor savatida. Retsept bog‘lanishini saqlash uchun avval Bekor qilinganlar → Savat / tiklash oynasidan mahsulotni qaytaring.`);
      return;
    }
    if (hasUnsavedRecipeDraft() && editingRecipeId !== recipe.id && !window.confirm("Hozirgi saqlanmagan tannarx ma’lumoti bekor qilinadi. Davom etasizmi?")) return;
    setEditingRecipeId(recipe.id);
    draftRecipeIdRef.current = "";
    setRecipeForm({
      name: recipe.name,
      posCode: recipe.posCode,
      salePrice: recipe.salePrice,
      categoryId: validCategoryId(data.productCategories, "recipe", recipe.categoryId),
      ingredients: recipe.ingredients.map((ingredient, ingredientIndex) => {
        const inventoryItem = data.inventory.find((item) => item.id === ingredient.inventoryId);
        const savedUnitCost = Number(ingredient.unitCost);
        const savedLineCost = Number(ingredient.lineCost);
        const unitCost = Number.isFinite(savedUnitCost) && savedUnitCost > 0
          ? savedUnitCost
          : inventoryItem?.unitCost ?? 0;
        return {
          id: ingredient.id || `ingredient-${recipe.id}-${ingredientIndex}`,
          inventoryId: ingredient.inventoryId || "",
          name: ingredient.name || inventoryItem?.name || `Ingredient ${ingredientIndex + 1}`,
          unit: ingredient.unit || inventoryItem?.unit || "g",
          quantity: ingredient.quantity,
          lineCost: Number.isFinite(savedLineCost) && savedLineCost > 0
            ? savedLineCost
            : unitCost * ingredient.quantity,
        };
      }),
      extraCosts: recipe.extraCosts.map((extraCost) => ({ ...extraCost })),
    });
    setRecipeNotice(`${recipe.name} tannarxini tahrirlayapsiz.`);
    window.setTimeout(() => document.getElementById("recipe-cost-builder")?.scrollIntoView({ block: "start" }), 0);
  };
  const cancelRecipeEdit = () => {
    setEditingRecipeId("");
    draftRecipeIdRef.current = "";
    setRecipeForm(emptyRecipeDraft());
    setRecipeNotice("");
  };
  const downloadCodedMenu = () => {
    const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Mahsulot kodi", "Taom nomi", "Kategoriya", "Sotuv narxi"],
      ...data.recipes.map((recipe) => [
        recipe.posCode,
        recipe.name,
        categoryName(recipe.categoryId, "recipe"),
        recipe.salePrice,
      ]),
    ];
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `halo-kodlangan-menyu-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const recordSale = async () => {
    const recipe = data.recipes.find((entry) => entry.id === saleForm.recipeId);
    const account = data.accounts.find((entry) => entry.id === saleForm.accountId);
    const quantity = Math.floor(saleForm.quantity);
    if (!recipe || quantity <= 0 || !account || account.type !== "card") {
      setSaleNotice("Taom, sotilgan soni va soliq hisoblanadigan POS hisobini tekshiring.");
      return;
    }
    const requirements = new Map<string, number>();
    recipe.ingredients.forEach((ingredient) => {
      if (!ingredient.inventoryId || !data.inventory.some((item) => item.id === ingredient.inventoryId)) return;
      requirements.set(ingredient.inventoryId, (requirements.get(ingredient.inventoryId) ?? 0) + ingredient.quantity * quantity);
    });
    const deductedRequirements = new Map([...requirements].filter(([, required]) => required > 0));
    const shortageCount = data.inventory.filter((item) => !isExpenseOnlyInventory(item) && item.stock + 0.000001 < (requirements.get(item.id) || 0)).length;

    const saleId = id("sale");
    const unitCost = recipeCost(recipe);
    const sale: Sale = {
      id: saleId,
      recipeId: recipe.id,
      quantity,
      unitPrice: recipe.salePrice,
      totalRevenue: recipe.salePrice * quantity,
      totalCost: unitCost * quantity,
      date: saleForm.date,
      source: "manual",
      taxTreatment: "automatic",
      accountId: account.id,
      stockUsage: [...deductedRequirements.entries()].map(([inventoryId, required]) => {
        const costIngredient = recipe.ingredients.find((ingredient) => ingredient.inventoryId === inventoryId);
        const savedUnitCost = Number(costIngredient?.unitCost);
        const unitCostAtSale = Number.isFinite(savedUnitCost) && savedUnitCost > 0
          ? savedUnitCost
          : Number(costIngredient?.lineCost) > 0 && Number(costIngredient?.quantity) > 0
            ? Number(costIngredient?.lineCost) / Number(costIngredient?.quantity)
          : data.inventory.find((item) => item.id === inventoryId)?.unitCost ?? 0;
        return { inventoryId, quantity: required, unitCostAtSale, totalCostAtSale: required * unitCostAtSale };
      }),
    };
    const saleMovements: StockMovement[] = [...deductedRequirements.entries()].map(([inventoryId, required]) => ({
      id: id("mov"),
      inventoryId,
      type: "sale",
      quantity: -required,
      date: saleForm.date,
      note: `${recipe.name} × ${quantity}`,
      referenceId: saleId,
    }));
    const saved = await save({
      ...data,
      inventory: data.inventory.map((item) => ({ ...item, stock: item.stock - (deductedRequirements.get(item.id) ?? 0) })),
      sales: [sale, ...data.sales],
      stockMovements: [...saleMovements, ...data.stockMovements],
    }, `Qo‘lda savdo kiritildi · ${recipe.name} × ${quantity}`);
    if (saved) {
      setSaleNotice(`✓ ${recipe.name} × ${quantity} yozildi. Tannarx va foyda hisoblandi${deductedRequirements.size ? "; mavjud ombor qoldig‘i kamaydi" : "; ombor aralashtirilmadi"}${shortageCount ? `; ${shortageCount} ta xomashyo yetishmovchiligi savdoni to‘xtatmadi` : ""}.`);
      setSaleForm({ ...saleForm, quantity: 1 });
    }
  };
  const recordBatchSales = async () => {
    if (batchSaleSavingRef.current) return;
    const account = data.accounts.find((entry) => entry.id === batchSaleForm.accountId);
    if (!account || account.type !== "card" || !/^\d{4}-\d{2}-\d{2}$/.test(batchSaleForm.date)) {
      setSaleNotice("Savdo sanasi va soliq hisoblanadigan POS hisobini tekshiring.");
      return;
    }
    const prepared = prepareBatchSales({
      recipes: data.recipes,
      inventory: data.inventory,
      quantities: batchSaleQuantities,
    });
    if (!prepared.ok) {
      setSaleNotice(prepared.error);
      return;
    }

    const newSales: Sale[] = [];
    const newMovements: StockMovement[] = [];
    const remainingBatchStock = new Map(data.inventory.map((item) => [item.id, item.stock]));
    prepared.selected.forEach(({ recipe, quantity, requirements }) => {
      const saleId = id("sale");
      const stockUsage: SaleIngredientUsage[] = [...requirements.entries()].flatMap(([inventoryId, required]) => {
        const available = remainingBatchStock.get(inventoryId) || 0;
        const deducted = required;
        remainingBatchStock.set(inventoryId, available - deducted);
        if (deducted <= 0) return [];
        const costIngredient = recipe.ingredients.find((ingredient) => ingredient.inventoryId === inventoryId);
        const savedUnitCost = Number(costIngredient?.unitCost);
        const unitCostAtSale = Number.isFinite(savedUnitCost) && savedUnitCost > 0
          ? savedUnitCost
          : Number(costIngredient?.lineCost) > 0 && Number(costIngredient?.quantity) > 0
            ? Number(costIngredient?.lineCost) / Number(costIngredient?.quantity)
            : data.inventory.find((item) => item.id === inventoryId)?.unitCost ?? 0;
        return [{ inventoryId, quantity: deducted, unitCostAtSale, totalCostAtSale: deducted * unitCostAtSale }];
      });
      newSales.push({
        id: saleId,
        recipeId: recipe.id,
        quantity,
        unitPrice: recipe.salePrice,
        totalRevenue: recipe.salePrice * quantity,
        totalCost: recipeCost(recipe) * quantity,
        date: batchSaleForm.date,
        source: "manual",
        taxTreatment: "automatic",
        accountId: account.id,
        stockUsage,
      });
      stockUsage.forEach((usage) => newMovements.push({
        id: id("mov"),
        inventoryId: usage.inventoryId,
        type: "sale",
        quantity: -usage.quantity,
        date: batchSaleForm.date,
        note: `KUNLIK SAVDO · ${recipe.name} × ${quantity}`,
        referenceId: saleId,
      }));
    });

    batchSaleSavingRef.current = true;
    setBatchSaleBusy(true);
    setSaleNotice("Kunlik savdolar saqlanmoqda…");
    try {
      const saved = await save({
        ...data,
        inventory: data.inventory.map((item) => ({ ...item, stock: remainingBatchStock.get(item.id) ?? item.stock })),
        sales: [...newSales, ...data.sales],
        stockMovements: [...newMovements, ...data.stockMovements],
      }, `Kunlik savdo kiritildi · ${newSales.length} tur · ${batchSelectedQuantity} ta`);
      if (!saved) {
        setSaleNotice("Kunlik savdo saqlanmadi. Kiritilgan sonlar o‘chmadi — qayta urinib ko‘ring.");
        return;
      }
      setBatchSaleQuantities({});
      setSaleNotice(`✓ ${newSales.length} turdagi ${batchSelectedQuantity} ta savdo bitta bosishda saqlandi. Tannarx va foyda yangilandi${prepared.shortageCount ? `; ${prepared.shortageCount} ta xomashyo yetishmovchiligi savdoni to‘xtatmadi` : "; bog‘langan ombor kamaydi"}.`);
    } finally {
      batchSaleSavingRef.current = false;
      setBatchSaleBusy(false);
    }
  };
  const resetDeliverySaleDraft = (notice = "") => {
    setDeliveryManualFees(emptyDeliveryManualFees());
    setEditingDeliverySaleId("");
    setDeliverySaleQuantities({});
    setDeliverySaleSearch("");
    setDeliverySaleForm((current) => ({
      ...current,
      date: today,
      time: currentSeoulTimeInputValue(),
      orderNumber: "",
      commissionPct: "",
      couponWon: 0,
      instantDiscountWon: 0,
      deliveryFeeWon: "",
    }));
    setDeliverySaleNotice(notice);
  };
  const beginDeliverySaleEdit = (sale: Sale) => {
    if (!isDeliverySale(sale, accountTypes.get(String(sale.accountId || "")))) return;
    if (data.monthlyCloses.some((close) => close.month === sale.date.slice(0, 7))) {
      setDeliverySaleNotice(`${sale.date.slice(0, 7)} oyi yopilgan. Tarixiy savdoni o‘zgartirib bo‘lmaydi; tuzatishni yangi oyga kiriting.`);
      return;
    }
    const batchSales = sale.deliveryBatchId
      ? data.sales.filter((entry) => entry.deliveryBatchId === sale.deliveryBatchId)
      : [sale];
    const unavailableBatchSale = batchSales.find((entry) => (
      !data.recipes.some((recipe) => recipe.id === entry.recipeId)
    ));
    if (unavailableBatchSale) {
      setDeliverySaleNotice(`Bu buyurtmadagi “${recipeName(unavailableBatchSale.recipeId)}” taomi o‘chirilgan. Buyurtmaning biror qatori yo‘qolib ketmasligi uchun avval uni Bekor qilinganlar bo‘limidan tiklang.`);
      return;
    }
    const quantities = batchSales.reduce<Record<string, number>>((result, entry) => ({
      ...result,
      [entry.recipeId]: (result[entry.recipeId] || 0) + entry.quantity,
    }), {});
    setDeliveryManualFees(deliveryManualFeesForEdit(batchSales, data.costRules.deliveryCommissionPct));
    setEditingDeliverySaleId(sale.id);
    setDeliverySaleQuantities(quantities);
    setDeliverySaleSearch("");
    setDeliverySaleForm({
      platform: isDeliveryPlatform(sale.deliveryPlatform) ? sale.deliveryPlatform : "coupang",
      date: sale.date,
      time: seoulTimeInputValue(sale.soldAt || sale.createdAt, "12:00"),
      orderNumber: String(sale.deliveryOrderNumber || ""),
      commissionPct: deliveryCommissionPercent(sale, data.costRules.deliveryCommissionPct),
      couponWon: 0, instantDiscountWon: 0, deliveryFeeWon: "",
    });
    setDeliverySaleNotice(`${deliveryPlatformLabel(sale.deliveryPlatform)} buyurtmasidagi ${batchSales.length} ta qator tahrirlash uchun ochildi.${batchSales.every((entry) => entry.deliveryFeeBreakdown || entry.deliveryManualFees) ? "" : " Eski yozuvdagi jami ushlanma saqlanadi."}`);
    window.setTimeout(() => document.getElementById("delivery-sale-entry")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const saveDeliveryMenuPrices = async () => {
    if (deliveryPriceBusy) return;
    const drafts = deliveryPriceDrafts[deliverySaleForm.platform] || {};
    const changedIds = Object.keys(drafts);
    if (!changedIds.length) {
      setDeliveryPriceNotice("Narx o‘zgartirilmagan.");
      return;
    }
    const invalid = Object.values(drafts).some((value) => value !== "" && (
      !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 1_000_000_000
    ));
    if (invalid) {
      setDeliveryPriceNotice("Delivery narxi 0 dan katta to‘g‘ri summa bo‘lishi kerak. Asosiy narx ishlatilsa maydonni bo‘sh qoldiring.");
      return;
    }
    setDeliveryPriceBusy(true);
    setDeliveryPriceNotice("Delivery narxlari saqlanmoqda…");
    try {
      const recipes = data.recipes.map((recipe) => {
        if (!Object.prototype.hasOwnProperty.call(drafts, recipe.id)) return recipe;
        const nextPrices = { ...normalizeDeliveryPlatformPrices(recipe.deliveryPrices) };
        const value = drafts[recipe.id];
        if (value === "") delete nextPrices[deliverySaleForm.platform];
        else nextPrices[deliverySaleForm.platform] = Math.round(Number(value));
        return { ...recipe, deliveryPrices: nextPrices };
      });
      const saved = await save(
        { ...data, recipes },
        `${deliveryPlatformShortLabel(deliverySaleForm.platform)} mahsulot narxlari yangilandi · ${changedIds.length} ta`,
      );
      if (!saved) {
        setDeliveryPriceNotice("Narxlar saqlanmadi. Kiritilgan qiymatlar o‘chmadi — qayta urinib ko‘ring.");
        return;
      }
      setDeliveryPriceDrafts((current) => ({ ...current, [deliverySaleForm.platform]: {} }));
      setDeliveryPriceNotice(`✓ ${deliveryPlatformLabel(deliverySaleForm.platform)} uchun ${changedIds.length} ta mahsulot narxi saqlandi.`);
    } finally {
      setDeliveryPriceBusy(false);
    }
  };
  const addDeliveryExtra = async () => {
    if (deliveryExtraBusy || deliverySaleBusy) return;
    const name = deliveryExtra.name.trim().replace(/\s+/g, " ");
    const price = Number(deliveryExtra.price);
    const cost = Number(deliveryExtra.cost);
    const usage = Number(deliveryExtra.usage);
    const stock = data.inventory.find((item) => item.id === deliveryExtra.inventoryId);
    if (!normalizeHumanNameKey(name) || name.length > 80 || deliveryExtra.price === "" || deliveryExtra.cost === ""
      || !Number.isSafeInteger(price) || price < 0 || price > 1_000_000_000
      || !Number.isSafeInteger(cost) || cost <= 0 || cost > 1_000_000_000
      || (deliveryExtra.inventoryId && (!stock || !Number.isFinite(usage) || usage <= 0 || usage > 1_000_000_000))) {
      setDeliveryExtraNotice("Nom, sotuv narxi va 1 dona tannarxini kiriting. Ombor tanlansa, sarf miqdorini ham yozing.");
      return;
    }
    if (data.recipes.some((recipe) => normalizeHumanNameKey(recipe.name) === normalizeHumanNameKey(name))) {
      setDeliveryExtraNotice("Bu nom allaqachon bor. Yuqoridagi qidiruvdan tanlang.");
      return;
    }
    const category = data.productCategories.find((entry) => entry.kind === "recipe" && entry.name === "Sous va qo‘shimchalar")
      || { id: id("recipe-category"), kind: "recipe" as const, name: "Sous va qo‘shimchalar", sortOrder: 800 };
    const recipe: Recipe = {
      id: id("rec"), name, posCode: nextMenuCode(data.recipes), posAliases: [], salePrice: price,
      deliveryPrices: { [deliverySaleForm.platform]: price }, categoryId: category.id, extraCosts: [],
      ingredients: [{ id: id("ingredient"), inventoryId: stock?.id || "", name: stock?.name || name,
        unit: stock?.unit || "dona", quantity: stock ? usage : 1, lineCost: cost, unitCost: cost / (stock ? usage : 1) }],
    };
    setDeliveryExtraBusy(true);
    setDeliveryExtraNotice("");
    try {
      const saved = await save({ ...data, recipes: [...data.recipes, recipe], productCategories: data.productCategories.some((entry) => entry.id === category.id) ? data.productCategories : [...data.productCategories, category] }, `Sous / qo‘shimcha qo‘shildi · ${name}`);
      if (!saved) { setDeliveryExtraNotice("Saqlanmadi. Qayta urinib ko‘ring."); return; }
      setDeliverySaleSearch("");
      setDeliveryExtra({ name: "", price: "", cost: "", inventoryId: "", usage: "1" });
      setDeliveryExtraNotice(`✓ ${name} Delivery menyusiga saqlandi. «Sous va qo‘shimchalar» bo‘limidan tanlashingiz mumkin.`);
    } catch { setDeliveryExtraNotice("Saqlanmadi. Qayta urinib ko‘ring."); }
    finally { setDeliveryExtraBusy(false); }
  };

  const recordDeliverySales = async () => {
    if (deliverySaleSavingRef.current) return;
    if (!deliveryAdjustmentsValid) {
      setDeliverySaleNotice("Bo‘sh ushlanma 0 hisoblanadi. Kiritilgan summa 0 yoki musbat butun son bo‘lsin. Kupon va chegirma jami savdodan oshmasin.");
      return;
    }
    const soldAt = deliverySoldAt(deliverySaleForm.date, deliverySaleForm.time);
    const commissionPct = deliverySaleCommissionPct;
    if (!deliveryAccount) {
      setDeliverySaleNotice("Delivery pul hisobi topilmadi. Sahifani yangilab, qayta urinib ko‘ring.");
      return;
    }
    if (!soldAt) {
      setDeliverySaleNotice("Sana va sotilgan vaqtni tekshiring.");
      return;
    }
    if (data.monthlyCloses.some((close) => close.month === deliverySaleForm.date.slice(0, 7))) {
      setDeliverySaleNotice(`${deliverySaleForm.date.slice(0, 7)} oyi yopilgan. Yangi yoki tahrirlangan savdoni ochiq oyga kiriting.`);
      return;
    }

    const editingSale = editingDeliverySaleId
      ? data.sales.find((sale) => sale.id === editingDeliverySaleId)
      : undefined;
    if (editingDeliverySaleId && (!editingSale || !isDeliverySale(editingSale, accountTypes.get(String(editingSale.accountId || ""))))) {
      setDeliverySaleNotice("Tahrirlanayotgan delivery yozuvi topilmadi. Ro‘yxatni yangilang.");
      return;
    }
    const editingSales = editingSale?.deliveryBatchId
      ? data.sales.filter((sale) => sale.deliveryBatchId === editingSale.deliveryBatchId)
      : editingSale ? [editingSale] : [];
    const orderNumber = deliverySaleForm.orderNumber.trim().replace(/\s+/g, " ").slice(0, 80);
    const duplicateOrder = orderNumber && data.sales.find((sale) => (
      sale.deliveryPlatform === deliverySaleForm.platform
      && String(sale.deliveryOrderNumber || "").trim().toLocaleLowerCase() === orderNumber.toLocaleLowerCase()
      && !editingSales.some((editingEntry) => editingEntry.id === sale.id)
    ));
    if (duplicateOrder) {
      setDeliverySaleNotice(`“${orderNumber}” buyurtma raqami ${deliveryPlatformShortLabel(deliverySaleForm.platform)}da oldin saqlangan. Takror kiritilmadi; tarixdan shu buyurtmani tahrirlang.`);
      return;
    }

    let workingInventory = data.inventory;
    let workingSales = data.sales;
    let workingMovements = data.stockMovements;
    if (editingSale) {
      const oldUsage = editingSales.flatMap((oldSale) => {
        const oldRecipe = data.recipes.find((recipe) => recipe.id === oldSale.recipeId);
        if (!Array.isArray(oldSale.stockUsage) && !oldRecipe) return [];
        return Array.isArray(oldSale.stockUsage)
          ? oldSale.stockUsage
          : (oldRecipe?.ingredients || []).map((ingredient) => ({
            ...ingredient,
            quantity: Number(ingredient.quantity || 0) * oldSale.quantity,
          }));
      });
      if (editingSales.some((oldSale) => !Array.isArray(oldSale.stockUsage) && !data.recipes.some((recipe) => recipe.id === oldSale.recipeId))) {
        setDeliverySaleNotice("Eski buyurtmadagi taomlardan birining ombor sarfi aniqlanmadi. Avval o‘chirilgan taomni tiklang.");
        return;
      }
      const missingInventory = oldUsage.find((usage) => (
        usage.inventoryId && !data.inventory.some((item) => item.id === usage.inventoryId)
      ));
      if (missingInventory) {
        setDeliverySaleNotice(`“${inventoryName(missingInventory.inventoryId)}” ombor mahsulotini avval tiklang.`);
        return;
      }
      const restored = new Map<string, number>();
      oldUsage.forEach((usage) => {
        if (!usage.inventoryId) return;
        restored.set(usage.inventoryId, (restored.get(usage.inventoryId) || 0) + Math.max(0, Number(usage.quantity) || 0));
      });
      workingInventory = data.inventory.map((item) => ({
        ...item,
        stock: item.stock + (restored.get(item.id) || 0),
      }));
      const editingIds = new Set(editingSales.map((sale) => sale.id));
      workingSales = data.sales.filter((sale) => !editingIds.has(sale.id));
      workingMovements = data.stockMovements.filter((movement) => !editingIds.has(String(movement.referenceId || "")));
    }

    const prepared = prepareBatchSales({
      recipes: data.recipes,
      inventory: workingInventory,
      quantities: deliverySaleQuantities,
    });
    if (!prepared.ok) {
      setDeliverySaleNotice(prepared.error);
      return;
    }
    const now = new Date().toISOString();
    const batchId = editingSale?.deliveryBatchId || id("delivery-batch");
    const oldSaleByRecipeId = new Map(editingSales.map((sale) => [sale.recipeId, sale]));
    const remainingStock = new Map(workingInventory.map((item) => [item.id, item.stock]));
    const newSales: Sale[] = [];
    const newMovements: StockMovement[] = [];
    prepared.selected.forEach(({ recipe, quantity, requirements }) => {
      const previousSale = oldSaleByRecipeId.get(recipe.id);
      const saleId = previousSale?.id || id("sale");
      const previousQuantity = Math.max(0, Number(previousSale?.quantity) || 0);
      const previousUsage = Array.isArray(previousSale?.stockUsage) ? previousSale.stockUsage : [];
      const effectiveRequirements = previousSale && previousQuantity > 0 && previousUsage.length
        ? previousUsage.reduce((result, usage) => {
          if (!usage.inventoryId) return result;
          result.set(usage.inventoryId, (result.get(usage.inventoryId) || 0) + Number(usage.quantity || 0) / previousQuantity * quantity);
          return result;
        }, new Map<string, number>())
        : requirements;
      const previousUsageByInventory = new Map(previousUsage.map((usage) => [usage.inventoryId, usage]));
      const stockUsage: SaleIngredientUsage[] = [...effectiveRequirements.entries()].flatMap(([inventoryId, required]) => {
        remainingStock.set(inventoryId, (remainingStock.get(inventoryId) || 0) - required);
        if (required <= 0) return [];
        const ingredient = recipe.ingredients.find((entry) => entry.inventoryId === inventoryId);
        const historicalUsage = previousUsageByInventory.get(inventoryId);
        const historicalUnitCost = Number(historicalUsage?.unitCostAtSale);
        const savedUnitCost = Number(ingredient?.unitCost);
        const unitCostAtSale = Number.isFinite(historicalUnitCost) && historicalUnitCost >= 0
          ? historicalUnitCost
          : Number.isFinite(savedUnitCost) && savedUnitCost > 0
          ? savedUnitCost
          : Number(ingredient?.lineCost) > 0 && Number(ingredient?.quantity) > 0
            ? Number(ingredient?.lineCost) / Number(ingredient?.quantity)
            : workingInventory.find((item) => item.id === inventoryId)?.unitCost || 0;
        return [{ inventoryId, quantity: required, unitCostAtSale, totalCostAtSale: required * unitCostAtSale }];
      });
      const unitPrice = previousSale && previousSale.deliveryPlatform === deliverySaleForm.platform
        ? Number(previousSale.unitPrice || 0)
        : deliveryMenuPrice(recipe, deliverySaleForm.platform);
      const totalRevenue = unitPrice * quantity;
      const totalCost = previousSale && previousQuantity > 0
        ? Number(previousSale.totalCost || 0) / previousQuantity * quantity
        : recipeCost(recipe) * quantity;
      newSales.push({
        id: saleId,
        recipeId: recipe.id,
        quantity,
        unitPrice,
        totalRevenue,
        totalCost,
        date: deliverySaleForm.date,
        source: "delivery",
        taxTreatment: "automatic",
        accountId: deliveryAccount.id,
        stockUsage,
        deliveryPlatform: deliverySaleForm.platform,
        deliveryOrderNumber: orderNumber,
        deliveryBatchId: batchId,
        deliveryCommissionPct: commissionPct,
        deliveryCommissionAmount: 0,
        deliveryFeeRule: { ...deliverySaleFeeRule },
        deliveryOrderAdjustments: { ...deliveryOrderAdjustments },
        deliveryManualFees: Object.fromEntries(Object.entries(deliveryAppliedManualFees).map(([key, fee]) => [key, { ...fee, value: Number(fee.value) }])) as DeliveryManualFees,
        soldAt,
        createdAt: previousSale?.createdAt || now,
        updatedAt: now,
      });
      stockUsage.forEach((usage) => newMovements.push({
        id: id("mov"),
        inventoryId: usage.inventoryId,
        type: "sale",
        quantity: -usage.quantity,
        date: deliverySaleForm.date,
        note: `DELIVERY · ${deliveryPlatformShortLabel(deliverySaleForm.platform)} · ${recipe.name} × ${quantity}`,
        referenceId: saleId,
      }));
    });
    const orderFeeBreakdown = calculateDeliveryManualFees(
      newSales.reduce((sum, sale) => sum + sale.totalRevenue, 0),
      deliveryAppliedManualFees,
    );
    const revenues = newSales.map((sale) => sale.totalRevenue);
    const allocatedBreakdown = allocateDeliveryFeeBreakdown(revenues, orderFeeBreakdown);
    newSales.forEach((sale, index) => {
      sale.deliveryCommissionAmount = allocatedBreakdown[index].total;
      sale.deliveryFeeBreakdown = allocatedBreakdown[index];
    });
    const deliveryShortageCount = [...remainingStock.values()].filter((stock) => stock < -0.000001).length;

    deliverySaleSavingRef.current = true;
    setDeliverySaleBusy(true);
    setDeliverySaleNotice(editingSale ? "Delivery savdosi yangilanmoqda…" : "Delivery savdolari saqlanmoqda…");
    try {
      const saved = await save({
        ...data,
        inventory: workingInventory.map((item) => ({ ...item, stock: remainingStock.get(item.id) ?? item.stock })),
        sales: [...newSales, ...workingSales],
        stockMovements: [...newMovements, ...workingMovements],
      }, editingSale
        ? `Delivery savdosi tahrirlandi · ${deliveryPlatformShortLabel(deliverySaleForm.platform)} · ${newSales[0].quantity} ta`
        : `Delivery savdo kiritildi · ${deliveryPlatformShortLabel(deliverySaleForm.platform)} · ${newSales.length} tur · ${deliverySelectedQuantity} ta`);
      if (!saved) {
        setDeliverySaleNotice("Delivery savdosi saqlanmadi. Kiritilgan sonlar o‘chmadi — qayta urinib ko‘ring.");
        return;
      }
      resetDeliverySaleDraft(`✓ ${deliveryPlatformLabel(deliverySaleForm.platform)} · ${newSales.length} turdagi ${newSales.reduce((sum, sale) => sum + sale.quantity, 0)} ta mahsulot ${editingSale ? "yangilandi" : "saqlandi"}. Ombor, tannarx, barcha ushlanmalar va foyda qayta hisoblandi${deliveryShortageCount ? `; ${deliveryShortageCount} ta xomashyo qoldig‘i yetishmaydi` : ""}.`);
    } finally {
      deliverySaleSavingRef.current = false;
      setDeliverySaleBusy(false);
    }
  };
  const reconcileSalesInventoryForDate = async (date: string) => {
    if (batchSaleSavingRef.current) return;
    const dateSales = data.sales.filter((sale) => sale.date === date);
    if (!dateSales.length) {
      setSaleNotice(`${displayDate(date)} sanasida savdo yozuvi topilmadi.`);
      return;
    }

    const inventoryIds = new Set(data.inventory.map((item) => item.id));
    const addedByInventory = new Map<string, number>();
    const repairMovements: StockMovement[] = [];
    let repairedSaleCount = 0;
    const sales = data.sales.map((sale) => {
      if (sale.date !== date) return sale;
      const recipe = data.recipes.find((entry) => entry.id === sale.recipeId);
      if (!recipe) return sale;

      const expected = new Map<string, number>();
      recipe.ingredients.forEach((ingredient) => {
        const required = Number(ingredient.quantity) * Number(sale.quantity);
        if (!ingredient.inventoryId || !inventoryIds.has(ingredient.inventoryId) || !Number.isFinite(required) || required <= 0) return;
        expected.set(ingredient.inventoryId, (expected.get(ingredient.inventoryId) || 0) + required);
      });
      const recorded = new Map<string, number>();
      if (Array.isArray(sale.stockUsage)) sale.stockUsage.forEach((usage) => {
        if (!usage.inventoryId) return;
        recorded.set(usage.inventoryId, (recorded.get(usage.inventoryId) || 0) + Math.max(0, Number(usage.quantity) || 0));
      });
      const movementUsage = new Map<string, number>();
      data.stockMovements.forEach((movement) => {
        if (movement.referenceId !== sale.id || movement.type !== "sale" || movement.quantity >= 0) return;
        movementUsage.set(movement.inventoryId, (movementUsage.get(movement.inventoryId) || 0) - movement.quantity);
      });

      const mergedUsage = new Map<string, SaleIngredientUsage>();
      if (Array.isArray(sale.stockUsage)) sale.stockUsage.forEach((usage) => {
        const current = mergedUsage.get(usage.inventoryId);
        mergedUsage.set(usage.inventoryId, current
          ? { ...current, quantity: current.quantity + Number(usage.quantity || 0) }
          : { ...usage });
      });
      let saleRepaired = false;
      expected.forEach((required, inventoryId) => {
        const alreadyDeducted = Math.max(recorded.get(inventoryId) || 0, movementUsage.get(inventoryId) || 0);
        const missing = Math.max(0, required - alreadyDeducted);
        if (missing <= 0.000001) return;
        saleRepaired = true;
        addedByInventory.set(inventoryId, (addedByInventory.get(inventoryId) || 0) + missing);
        const costIngredient = recipe.ingredients.find((ingredient) => ingredient.inventoryId === inventoryId);
        const savedUnitCost = Number(costIngredient?.unitCost);
        const unitCostAtSale = Number.isFinite(savedUnitCost) && savedUnitCost > 0
          ? savedUnitCost
          : Number(costIngredient?.lineCost) > 0 && Number(costIngredient?.quantity) > 0
            ? Number(costIngredient?.lineCost) / Number(costIngredient?.quantity)
            : data.inventory.find((item) => item.id === inventoryId)?.unitCost ?? 0;
        mergedUsage.set(inventoryId, {
          inventoryId,
          quantity: required,
          unitCostAtSale,
          totalCostAtSale: required * unitCostAtSale,
        });
        repairMovements.push({
          id: id("mov"),
          inventoryId,
          type: "sale",
          quantity: -missing,
          date: sale.date,
          note: `OMBOR QAYTA HISOBLANDI · ${recipe.name} × ${sale.quantity}`,
          referenceId: sale.id,
        });
      });
      if (!saleRepaired) return sale;
      repairedSaleCount += 1;
      return { ...sale, stockUsage: [...mergedUsage.values()] };
    });

    if (!addedByInventory.size) {
      setSaleNotice(`✓ ${displayDate(date)} savdolarining ombor sarfi to‘liq yozilgan. Qo‘shimcha ayirish kerak emas.`);
      return;
    }
    batchSaleSavingRef.current = true;
    setBatchSaleBusy(true);
    setSaleNotice(`${displayDate(date)} savdolarining yetishmagan ombor sarfi hisoblanmoqda…`);
    try {
      const saved = await save({
        ...data,
        inventory: data.inventory.map((item) => ({
          ...item,
          stock: item.stock - (addedByInventory.get(item.id) || 0),
        })),
        sales,
        stockMovements: [...repairMovements, ...data.stockMovements],
      }, `Savdo ombor sarfi qayta hisoblandi · ${date} · ${repairedSaleCount} ta savdo`);
      setSaleNotice(saved
        ? `✓ ${displayDate(date)} uchun ${repairedSaleCount} ta savdoning yetishmagan ombor sarfi ayrildi. Qoldiq yetishmasa manfiy ko‘rsatildi.`
        : "Ombor sarfi qayta hisoblanmadi. Qayta urinib ko‘ring.");
    } finally {
      batchSaleSavingRef.current = false;
      setBatchSaleBusy(false);
    }
  };
  const recordCashBankSales = async () => {
    if (cashSaleSavingRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cashSaleForm.date)
      || !INVENTORY_OUTFLOW_REASONS.includes(cashSaleForm.reason as typeof INVENTORY_OUTFLOW_REASONS[number])) {
      setCashSaleNotice("Sana va nosavdo ombor chiqimi sababini tanlang.");
      return;
    }
    const items = cashSaleSelectedRecipes.map((recipe) => ({
      recipeId: recipe.id,
      quantity: Number(cashSaleQuantities[recipe.id] || 0),
    }));
    if (!items.length) {
      setCashSaleNotice("Kamida bitta taom sonini kiriting.");
      return;
    }
    cashSaleSavingRef.current = true;
    setCashSaleBusy(true);
    setCashSaleNotice("Nosavdo ombor chiqimi saqlanmoqda…");
    try {
      const applied = applyWorkerConsumption(
        data as unknown as Record<string, unknown>,
        {
          operationId: id("inventory-outflow"),
          kind: "inventory_only",
          items,
          date: cashSaleForm.date,
          reason: cashSaleForm.reason,
        },
        { id: "owner", name: "Rahbar" },
      );
      const saved = await save(
        applied.state as unknown as AppState,
        `Nosavdo ombor chiqimi · ${cashSaleForm.reason} · ${cashSaleSelectedQuantity} porsiya`,
      );
      if (!saved) {
        setCashSaleNotice("Ombor chiqimi saqlanmadi. Kiritilgan sonlar o‘chmadi — qayta urinib ko‘ring.");
        return;
      }
      setCashSaleQuantities({});
      setCashSaleNotice(`✓ ${cashSaleSelectedQuantity} porsiya “${cashSaleForm.reason}” sababi bilan ombordan ayrildi. Bu savdo yoki pul tushumi emas${Array.isArray(applied.result.entry.stockShortages) && applied.result.entry.stockShortages.length ? "; yetishmagan qoldiq manfiy ko‘rsatildi" : ""}.`);
    } catch (error) {
      setCashSaleNotice(error instanceof WorkerConsumptionError
        ? error.message
        : "Ombor chiqimi saqlanmadi. Qayta urinib ko‘ring.");
    } finally {
      cashSaleSavingRef.current = false;
      setCashSaleBusy(false);
    }
  };
  const saveFeeRules = async () => {
    if (userMode !== "owner" || feeRuleBusy) return;
    let cleanRules: CostRules;
    try {
      cleanRules = withSimpleDeliveryRule({ ...feeRuleForm, taxPct: data.costRules.taxPct }, feeRulePlatform, {
        combinedPct: activeFeePlatformRule.combinedPct ?? deliveryCombinedPercent(activeFeePlatformRule),
        deliveryFeeWon: activeFeePlatformRule.deliveryFeeWon,
        instantDiscountWon: activeFeePlatformRule.instantDiscountWon,
      });
      if (!validCostRules(cleanRules)) throw new Error("Foizlarni tekshiring: 0–100 oralig‘ida bo‘lsin.");
    } catch (error) {
      setFeeRuleNotice(error instanceof Error ? error.message : "Ushlanma qiymatlarini tekshiring.");
      return;
    }
    const conflicting = data.fixedExpenses.find((expense) => (
      expense.active !== false
      && expense.automatic === true
      && costRuleCoversCategory(expense.category, cleanRules)
    ));
    if (conflicting) {
      setFeeRuleNotice(`“${conflicting.name}” oylik xarajatlarda faol. Ikki marta ayrilmasligi uchun avval uni to‘xtating.`);
      return;
    }
    setFeeRuleBusy(true);
    try {
      const saved = await save({ ...data, costRules: cleanRules }, "Soliq bo‘limida delivery va POS ushlanma qoidalari yangilandi");
      if (saved) {
        feeRuleDirtyRef.current = false;
        setFeeRuleForm(cleanRules);
        setFeeRuleNotice("✓ Saqlandi. Har bir yangi delivery buyurtmasidan avtomatik ayriladi. Eski buyurtmalar o‘zgarmadi.");
      } else {
        setFeeRuleNotice("Ushlanmalar saqlanmadi. Qayta urinib ko‘ring.");
      }
    } finally {
      setFeeRuleBusy(false);
    }
  };
  const cancelSale = async (saleId: string) => {
    const sale = data.sales.find((entry) => entry.id === saleId);
    const recipe = sale ? data.recipes.find((entry) => entry.id === sale.recipeId) : null;
    if (!sale) return;
    const delivery = isDeliverySale(sale, accountTypes.get(String(sale.accountId || "")));
    const showCancellationNotice = (message: string) => delivery
      ? setDeliverySaleNotice(message)
      : setSaleNotice(message);
    if (data.monthlyCloses.some((close) => close.month === sale.date.slice(0, 7))) {
      showCancellationNotice(`${sale.date.slice(0, 7)} oyi yopilgan. Tarixiy savdoni o‘chirib bo‘lmaydi; tuzatishni yangi oyga kiriting.`);
      return;
    }
    const salesToCancel = delivery && sale.deliveryBatchId
      ? data.sales.filter((entry) => entry.deliveryBatchId === sale.deliveryBatchId)
      : [sale];
    const unresolvedSale = salesToCancel.find((entry) => (
      !Array.isArray(entry.stockUsage) && !data.recipes.some((candidate) => candidate.id === entry.recipeId)
    ));
    if (unresolvedSale) {
      showCancellationNotice(`Bu eski savdoda ombor sarfi retsept orqali hisoblanadi. Avval “${recipeName(unresolvedSale.recipeId)}” taomini Bekor qilinganlar → Savat / tiklash oynasidan qaytaring.`);
      return;
    }
    const usageBySale = salesToCancel.map((entry) => {
      const currentRecipe = data.recipes.find((candidate) => candidate.id === entry.recipeId);
      const usage = Array.isArray(entry.stockUsage)
        ? entry.stockUsage
        : (currentRecipe?.ingredients ?? []).map((ingredient) => ({ ...ingredient, quantity: ingredient.quantity * entry.quantity }));
      return { sale: entry, recipe: currentRecipe, usage };
    });
    const missingInventoryId = usageBySale.flatMap((entry) => entry.usage).find((ingredient) => (
      ingredient.inventoryId && !data.inventory.some((item) => item.id === ingredient.inventoryId)
    ))?.inventoryId;
    if (missingInventoryId) {
      showCancellationNotice(`Avval “${inventoryName(missingInventoryId)}” mahsulotini Bekor qilinganlar → Savat / tiklash oynasidan qaytaring. Shundan keyin savdo va ombor birga xavfsiz tiklanadi.`);
      return;
    }
    if (!window.confirm(delivery
      ? `Bu delivery buyurtmasidagi ${salesToCancel.length} ta qator savatga ko‘chirilib, barcha mahsulotlari omborga qaytarilsinmi?\n\nHar bir qatorni Bekor qilinganlar bo‘limidan tiklash mumkin.`
      : "Bu savdo savatga ko‘chirilib, mahsulotlari omborga qaytarilsinmi?\n\nSavdoni Bekor qilinganlar → Savat / tiklash oynasidan qaytarish mumkin.")) return;
    const reason = askCancellationReason(delivery
      ? `${deliveryPlatformLabel(sale.deliveryPlatform)} buyurtmasi · ${salesToCancel.length} qator`
      : `${recipe?.name || sale.recipeId} × ${sale.quantity}`);
    if (!reason) return;
    const restored = new Map<string, number>();
    usageBySale.flatMap((entry) => entry.usage).forEach((ingredient) => {
      restored.set(ingredient.inventoryId, (restored.get(ingredient.inventoryId) ?? 0) + ingredient.quantity);
    });
    const cancelledIds = new Set(salesToCancel.map((entry) => entry.id));
    let deletedItems = data.deletedItems;
    usageBySale.forEach((entry) => {
      deletedItems = prependDeletedItem(deletedItems, createDeletedItem({
        kind: "sale",
        entityId: entry.sale.id,
        label: `${entry.recipe?.name || entry.sale.recipeId} × ${entry.sale.quantity}`,
        section: delivery ? "Delivery savdo" : "Savdo",
        record: entry.sale,
        related: { movements: data.stockMovements.filter((movement) => movement.referenceId === entry.sale.id) },
        reason,
      }));
    });
    const saved = await save({
      ...data,
      inventory: data.inventory.map((item) => ({ ...item, stock: item.stock + (restored.get(item.id) ?? 0) })),
      sales: data.sales.filter((entry) => !cancelledIds.has(entry.id)),
      stockMovements: data.stockMovements.filter((movement) => !cancelledIds.has(String(movement.referenceId || ""))),
      deletedItems,
    }, `${delivery ? "Delivery buyurtmasi" : "Savdo"} savatga ko‘chirildi · ${salesToCancel.length} qator · Sabab: ${reason}`);
    showCancellationNotice(saved
      ? `✓ ${delivery ? "Delivery buyurtmasi" : "Savdo"} savatga ko‘chirildi, mahsulotlar omborga qaytarildi.`
      : "Savdoni savatga ko‘chirib bo‘lmadi. Qayta urinib ko‘ring.");
  };
  const readPosFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
    if (file.size > (isImage ? 30 : 15) * 1024 * 1024) {
      setPosNotice(isImage ? "Rasm 30 MB dan katta. Kichikroq rasmni tanlang." : "Excel 15 MB dan katta. Kichikroq faylni tanlang.");
      event.target.value = "";
      return;
    }

    setPosSource(isImage ? "image" : "excel");
    setPosReading(true);
    setPosTable(null);
    setPosProductMap({});
    setOcrText("");
    setOcrProgress(0);
    setOcrStage(isImage ? "Surat tayyorlanmoqda…" : "Excel o‘qilmoqda…");
    setOcrReceiptSummary({ quantity: 0, total: 0 });
    setOcrReviewIssues([]);
    setOcrNumbersVerified(false);
    setOcrVerificationMessage("");
    setRemovedOcrRows([]);
    setPosNotice(isImage ? "Suratdagi savdolar avtomatik o‘qilmoqda…" : "Excel fayli o‘qilmoqda…");
    try {
      if (isImage) {
        const upload = await prepareStockImageUpload(file);
        if (posImagePreview) URL.revokeObjectURL(posImagePreview);
        setPosImagePreview(URL.createObjectURL(upload.file));
        setOcrProgress(4);
        const prepared = await prepareImageForOcr(upload.file);
        const preparedImage = prepared.image;
        const tableImage = prepared.tableImage;
        const tableCodeImage = prepared.tableCodeImage;
        const tableQuantityImage = prepared.tableQuantityImage;
        const numbersImage = prepared.numbersImage;
        const numbersVerificationImage = prepared.numbersVerificationImage;
        const nativeNumbersImage = prepared.nativeNumbersImage;
        const productsImage = prepared.productsImage;
        const summaryImage = prepared.summaryImage;
        const isLandscapePosImage = preparedImage.width > preparedImage.height;
        setOcrProgress(8);
        try {
          const { createWorker, OEM, PSM } = await import("tesseract.js");
          let activeOcrPass: "text" | "table-codes" | "table-quantity" | "numbers-1" | "numbers-2" | "numbers-3" | "numbers-4" | "numbers-5" | "numbers-6" | "products" | "summary" = "text";
          const worker = await createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
            logger: (message) => {
              const stage = message.status === "recognizing text"
                ? activeOcrPass === "table-codes"
                  ? "Mahsulot kodlari alohida o‘qilmoqda…"
                  : activeOcrPass === "table-quantity"
                    ? "Sotilgan sonlar alohida o‘qilmoqda…"
                : activeOcrPass === "numbers-1"
                  ? "Raqamlar birinchi marta tekshirilmoqda…"
                  : activeOcrPass === "numbers-2"
                    ? "Raqamlar ikkinchi marta tekshirilmoqda…"
                    : activeOcrPass === "numbers-3"
                      ? "Raqamlar uchinchi usulda tekshirilmoqda…"
                    : activeOcrPass === "numbers-4"
                      ? "Har bir raqam qatori asl o‘lchamda tekshirilmoqda…"
                    : activeOcrPass === "numbers-5"
                      ? "Noaniq raqamlar kontrast usulida tekshirilmoqda…"
                    : activeOcrPass === "numbers-6"
                      ? "Farqli qatorlar yakuniy tekshirilmoqda…"
                    : activeOcrPass === "products"
                      ? "Taom nomlari alohida tekshirilmoqda…"
                      : activeOcrPass === "summary"
                        ? "Chek jami qayta tekshirilmoqda…"
                        : "Suratdagi taomlar o‘qilmoqda…"
                : message.status.includes("language")
                  ? "Koreyscha va inglizcha lug‘at tayyorlanmoqda…"
                  : "OCR tizimi tayyorlanmoqda…";
              const passProgress = activeOcrPass === "text"
                ? { base: 42, range: 28 }
                : activeOcrPass === "table-codes"
                  ? { base: 69, range: 8 }
                  : activeOcrPass === "table-quantity"
                    ? { base: 77, range: 8 }
                : activeOcrPass === "numbers-1"
                  ? { base: 68, range: 9 }
                : activeOcrPass === "numbers-2"
                    ? { base: 76, range: 6 }
                    : activeOcrPass === "numbers-3"
                      ? { base: 82, range: 6 }
                      : activeOcrPass === "numbers-4"
                        ? { base: 86, range: 4 }
                        : activeOcrPass === "numbers-5"
                          ? { base: 89, range: 3 }
                        : activeOcrPass === "numbers-6"
                          ? { base: 91, range: 2 }
                      : activeOcrPass === "products"
                        ? { base: 92, range: 3 }
                        : { base: 95, range: 3 };
              const base = message.status === "recognizing text" ? passProgress.base : 10;
              const range = message.status === "recognizing text" ? passProgress.range : 30;
              setOcrStage(stage);
              setOcrProgress(Math.min(98, Math.round(base + message.progress * range)));
            },
          });
          try {
            if (isLandscapePosImage && tableCodeImage && tableQuantityImage) {
              activeOcrPass = "table-codes";
              setOcrStage("Mahsulot kodlari alohida o‘qilmoqda…");
              await worker.setParameters({
                tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
                preserve_interword_spaces: "1",
                tessedit_char_whitelist: "0123456789",
                user_defined_dpi: "300",
              });
              const codeResult = await worker.recognize(tableCodeImage, { rotateAuto: false }, { text: true, blocks: false });
              const tableCodeText = codeResult.data.text.trim();

              activeOcrPass = "table-quantity";
              setOcrStage("Sotilgan sonlar alohida o‘qilmoqda…");
              await worker.setParameters({
                tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
                preserve_interword_spaces: "1",
                tessedit_char_whitelist: "0123456789",
                user_defined_dpi: "300",
              });
              const quantityResult = await worker.recognize(tableQuantityImage, { rotateAuto: false }, { text: true, blocks: false });
              const tableQuantityText = quantityResult.data.text.trim();
              const strictReport = ocrOkposCodeQuantityColumns(
                tableCodeText,
                tableQuantityText,
                data.recipes,
                today,
                file.name,
              );

              setOcrText([
                tableCodeText ? `상품코드\n${tableCodeText}` : "",
                tableQuantityText ? `수량\n${tableQuantityText}` : "",
              ].filter(Boolean).join("\n\n"));
              setOcrProgress(100);
              setPosMapping(photoPosCodeQuantityMapping);
              if (!strictReport) {
                setOcrStage("Ikki ustunni qayta tekshiring");
                setOcrNumbersVerified(false);
                setOcrVerificationMessage("상품코드 va 수량 qatorlari teng o‘qilmadi. Rasmni to‘liq va tekis holatda qayta yuklang.");
                setPosNotice("Import to‘xtatildi: faqat 상품코드 va 수량 ustunlari o‘qildi, lekin ularning qatorlari teng kelmadi.");
                return;
              }

              const parsedQuantity = strictReport.parsedQuantity;
              setOcrReviewIssues([]);
              setOcrNumbersVerified(true);
              setOcrVerificationMessage(`Faqat 2 ta ustun o‘qildi: ${strictReport.table.rows.length} qator · ${parsedQuantity.toLocaleString()} dona.`);
              setOcrStage("상품코드 + 수량 o‘qildi");
              setOcrReceiptSummary({ quantity: parsedQuantity, total: 0 });
              setPosTable(strictReport.table);
              setPosNotice(`✓ Faqat 2 ta ustun o‘qildi · ${strictReport.table.rows.length} qator · ${parsedQuantity.toLocaleString()} dona. Narx HALO menyusidan hisoblanadi.`);
              return;
            }

            await worker.setParameters({
              tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
              preserve_interword_spaces: "1",
              user_defined_dpi: "300",
            });
            const result = await worker.recognize(preparedImage, { rotateAuto: true }, { text: true, tsv: true, blocks: false });
            const text = result.data.text.trim();
            let numericText = "";
            let numericTextSecond = "";
            let numericTextThird = "";
            let numericTextFourth = "";
            let numericTextFifth = "";
            let numericTextSixth = "";
            let numericTsv = "";
            let numericTsvSecond = "";
            let numericTsvThird = "";
            let productText = "";
            let productTsv = "";
            let summaryText = "";
            try {
              activeOcrPass = "numbers-1";
              setOcrStage("Raqamlar birinchi marta tekshirilmoqda…");
              await worker.setParameters({
                tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
                preserve_interword_spaces: "1",
                tessedit_char_whitelist: "0123456789,. ",
              });
              const numericResult = await worker.recognize(numbersImage, { rotateAuto: false }, { text: true, tsv: true, blocks: false });
              numericText = numericResult.data.text.trim();
              numericTsv = numericResult.data.tsv || "";

              activeOcrPass = "numbers-2";
              setOcrStage("Raqamlar ikkinchi marta tekshirilmoqda…");
              await worker.setParameters({
                tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
                preserve_interword_spaces: "1",
                tessedit_char_whitelist: "0123456789,. ",
              });
              const numericResultSecond = await worker.recognize(numbersImage, { rotateAuto: false }, { text: true, tsv: true, blocks: false });
              numericTextSecond = numericResultSecond.data.text.trim();
              numericTsvSecond = numericResultSecond.data.tsv || "";

              // Read the independently cropped/gamma-adjusted column before
              // any tight line reads. This keeps its layout evidence separate
              // from the two binary per-row passes below.
              try {
                activeOcrPass = "numbers-3";
                setOcrStage("Raqamlar uchinchi usulda tekshirilmoqda…");
                await worker.setParameters({
                  tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
                  preserve_interword_spaces: "1",
                  tessedit_char_whitelist: "0123456789,. ",
                });
                const numericResultThird = await worker.recognize(numbersVerificationImage, { rotateAuto: false }, { text: true, tsv: true, blocks: false });
                numericTextThird = numericResultThird.data.text.trim();
                numericTsvThird = numericResultThird.data.tsv || "";
              } finally {
                numbersVerificationImage.width = 0;
                numbersVerificationImage.height = 0;
              }

              try {
                const linePlans = numericLinePlans(numericTsv);
                const readPhysicalLines = async (threshold: number, progressBase: number) => {
                  const values: string[] = [];
                  for (let index = 0; index < linePlans.length; index += 1) {
                    const lineImage = prepareNumericLineCrop(
                      nativeNumbersImage,
                      numbersImage,
                      linePlans[index],
                      threshold,
                    );
                    try {
                      const lineResult = await worker.recognize(lineImage, { rotateAuto: false }, { text: true, blocks: false });
                      values.push(lineResult.data.text.trim());
                    } finally {
                      lineImage.width = 0;
                      lineImage.height = 0;
                    }
                    setOcrProgress(Math.min(92, Math.round(
                      progressBase + ((index + 1) / Math.max(1, linePlans.length)) * 3,
                    )));
                  }
                  return values;
                };
                if (linePlans.length) {
                  activeOcrPass = "numbers-4";
                  setOcrStage("Har bir raqam qatori yumshoq kontrastda tekshirilmoqda…");
                  await worker.setParameters({
                    tessedit_pageseg_mode: PSM.SINGLE_LINE,
                    preserve_interword_spaces: "1",
                    tessedit_char_whitelist: "0123456789,. ",
                  });
                  const mediumPhysicalLines = await readPhysicalLines(105, 86);
                  activeOcrPass = "numbers-5";
                  setOcrStage("Noaniq raqamlar chuqur kontrastda tekshirilmoqda…");
                  const strongPhysicalLines = await readPhysicalLines(90, 89);
                  numericTextFourth = mediumPhysicalLines.map((value, index) => {
                    const pair = parseNumericOcrPairs(value)[0];
                    return pair?.quantity != null && pair.quantity > 0 && pair.total > 0
                      ? value
                      : strongPhysicalLines[index] || value;
                  }).join("\n");
                  numericTextFifth = strongPhysicalLines.join("\n");

                  const trustedPasses = [numericTextThird, numericTextFourth, numericTextFifth]
                    .map((value) => parseNumericOcrPairs(value));
                  if (trustedPasses.every((pairs) => pairs.length === linePlans.length)) {
                    const majorityPairs: Array<{ quantity: number; total: number }> = [];
                    const disputedIndexes: number[] = [];
                    let majorityComplete = true;
                    for (let index = 0; index < linePlans.length; index += 1) {
                      const counts = new Map<string, { count: number; quantity: number; total: number }>();
                      trustedPasses.forEach((pairs) => {
                        const pair = pairs[index];
                        if (pair.quantity == null || pair.quantity <= 0 || pair.total <= 0) return;
                        const key = `${pair.quantity}:${pair.total}`;
                        const current = counts.get(key);
                        counts.set(key, {
                          count: (current?.count ?? 0) + 1,
                          quantity: pair.quantity,
                          total: pair.total,
                        });
                      });
                      const ranked = [...counts.values()].sort((left, right) => right.count - left.count);
                      if (!ranked[0] || ranked[0].count < 2 || ranked[0].count === ranked[1]?.count) {
                        majorityComplete = false;
                        break;
                      }
                      majorityPairs.push({ quantity: ranked[0].quantity, total: ranked[0].total });
                      const hasIncompletePrimary = trustedPasses.some((pairs) => (
                        pairs[index].quantity == null || pairs[index].total <= 0
                      ));
                      if (counts.size > 1 || hasIncompletePrimary) disputedIndexes.push(index);
                    }

                    // Only rows on which the three primary numeric layouts
                    // differ are reread. PSM6 is deliberately independent
                    // from the PSM4/PSM7 passes and must confirm the 2/3 row
                    // majority before a sixth verification pass is emitted.
                    if (majorityComplete && disputedIndexes.length) {
                      activeOcrPass = "numbers-6";
                      setOcrStage(`${disputedIndexes.length} ta farqli qator yakuniy tekshirilmoqda…`);
                      await worker.setParameters({
                        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
                        preserve_interword_spaces: "1",
                        tessedit_char_whitelist: "0123456789,. ",
                      });
                      let targetedConfirmed = true;
                      for (let targetIndex = 0; targetIndex < disputedIndexes.length; targetIndex += 1) {
                        const rowIndex = disputedIndexes[targetIndex];
                        const lineImage = prepareNumericLineCrop(
                          nativeNumbersImage,
                          numbersImage,
                          linePlans[rowIndex],
                          0,
                        );
                        try {
                          const targetedResult = await worker.recognize(lineImage, { rotateAuto: false }, { text: true, blocks: false });
                          const targetedPairs = parseNumericOcrPairs(targetedResult.data.text.trim());
                          const targetedPair = targetedPairs.length === 1 ? targetedPairs[0] : null;
                          const majorityPair = majorityPairs[rowIndex];
                          if (
                            !targetedPair
                            || targetedPair.quantity !== majorityPair.quantity
                            || targetedPair.total !== majorityPair.total
                          ) targetedConfirmed = false;
                        } finally {
                          lineImage.width = 0;
                          lineImage.height = 0;
                        }
                        setOcrProgress(Math.min(94, Math.round(
                          91 + ((targetIndex + 1) / disputedIndexes.length) * 3,
                        )));
                      }
                      if (targetedConfirmed) {
                        numericTextSixth = majorityPairs
                          .map((pair) => `${pair.quantity} ${pair.total}`)
                          .join("\n");
                      }
                    }
                  }
                }
              } finally {
                nativeNumbersImage.width = 0;
                nativeNumbersImage.height = 0;
              }
            } finally {
              numbersImage.width = 0;
              numbersImage.height = 0;
              nativeNumbersImage.width = 0;
              nativeNumbersImage.height = 0;
            }
            try {
              activeOcrPass = "products";
              setOcrStage("Taom nomlari alohida tekshirilmoqda…");
              await worker.setParameters({
                tessedit_pageseg_mode: isLandscapePosImage ? PSM.SINGLE_COLUMN : PSM.SINGLE_BLOCK,
                preserve_interword_spaces: "1",
                tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'",
              });
              const productResult = await worker.recognize(productsImage, { rotateAuto: false }, { text: true, tsv: true, blocks: false });
              productText = productResult.data.text.trim();
              productTsv = productResult.data.tsv || "";
            } finally {
              productsImage.width = 0;
              productsImage.height = 0;
            }
            try {
              activeOcrPass = "summary";
              setOcrStage("Chek jami qayta tekshirilmoqda…");
              await worker.setParameters({
                tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
                preserve_interword_spaces: "1",
                tessedit_char_whitelist: "0123456789, .",
              });
              const summaryResult = await worker.recognize(summaryImage, { rotateAuto: false }, { text: true, blocks: false });
              summaryText = summaryResult.data.text.trim();
            } finally {
              summaryImage.width = 0;
              summaryImage.height = 0;
            }
            const firstParsed = ocrTextToPosTable(
              text,
              data.recipes,
              today,
              file.name,
              [summaryText, numericText].filter(Boolean).join("\n"),
            );
            // Keep fixed pass positions: reconciliation treats passes 3/4/5
            // as the gamma and two physical-row reads even if an earlier
            // auxiliary pass returned no text.
            const numericTexts = [numericText, numericTextSecond, numericTextThird, numericTextFourth, numericTextFifth, numericTextSixth];
            const rebuilt = rebuildOcrRowsFromProductColumn(firstParsed, productText, numericTexts, {
              productTsv,
              numericTsvs: [numericTsv, numericTsvSecond, numericTsvThird],
              recipes: data.recipes,
            });
            const reconciliation = reconcileNumericOcrPasses(rebuilt.parsed, numericTexts);
            const parsed = reconciliation.parsed;
            const reviewIssues: OcrReviewIssue[] = parsed.table.rows.flatMap((row) => {
              const code = normalizeProductCode(row.values[photoPosMapping.productCode]);
              const quantity = Number(row.values[photoPosMapping.quantity]);
              if (code && Number.isSafeInteger(quantity) && quantity > 0) return [];
              return [{
                id: `photo-code-quantity-${row.rowNumber}`,
                rowNumber: row.rowNumber,
                product: code ? `Kod ${code}` : "Mahsulot kodi topilmadi",
                fields: quantity > 0 ? [] : ["quantity" as const],
                reason: "Faqat 상품코드 va 수량 tekshiriladi. Kod yoki sonni to‘g‘rilang.",
              }];
            });
            const parsedQuantity = parsed.table.rows.reduce((sum, row) => {
              const quantity = Number(row.values[photoPosMapping.quantity]);
              return sum + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0);
            }, 0);
            setOcrReviewIssues(reviewIssues);
            setOcrNumbersVerified(parsed.table.rows.length > 0 && reviewIssues.length === 0);
            setOcrVerificationMessage(reviewIssues.length
              ? `${reviewIssues.length} ta qatorning kodi yoki sonini tekshiring.`
              : `Faqat 상품코드 va 수량 o‘qildi: ${parsed.table.rows.length} qator · ${parsedQuantity.toLocaleString()} dona.`);
            setOcrText([
              parsed.table.rows.map((row) => `${row.values[photoPosMapping.productCode] || "?"} · ${row.values[photoPosMapping.quantity] || "?"}`).join("\n"),
            ].filter(Boolean).join("\n\n"));
            setOcrProgress(100);
            setOcrStage("상품코드 va 수량 o‘qildi");
            setOcrReceiptSummary({ quantity: parsedQuantity, total: 0 });
            setPosTable({ ...parsed.table, reportSummary: undefined });
            setPosMapping(photoPosCodeQuantityMapping);
            setPosNotice(parsed.table.rows.length
              ? reviewIssues.length
                ? `${reviewIssues.length} ta qatorning 상품코드 yoki 수량 qiymatini tekshiring.`
                : `✓ Faqat 상품코드 va 수량 o‘qildi · ${parsed.table.rows.length} qator · ${parsedQuantity.toLocaleString()} dona. Narx HALO menyusidan avtomatik hisoblanadi.`
              : "Suratdan 상품코드 va 수량 topilmadi. Quyida qatorni qo‘lda qo‘shib tasdiqlashingiz mumkin.");
          } finally {
            await worker.terminate();
          }
        } finally {
          preparedImage.width = 0;
          preparedImage.height = 0;
          if (tableImage) {
            tableImage.width = 0;
            tableImage.height = 0;
          }
          [tableCodeImage, tableQuantityImage].forEach((image) => {
            if (!image) return;
            image.width = 0;
            image.height = 0;
          });
          numbersImage.width = 0;
          numbersImage.height = 0;
          nativeNumbersImage.width = 0;
          nativeNumbersImage.height = 0;
          numbersVerificationImage.width = 0;
          numbersVerificationImage.height = 0;
          productsImage.width = 0;
          productsImage.height = 0;
          summaryImage.width = 0;
          summaryImage.height = 0;
        }
      } else {
        setPosImagePreview("");
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, sheetRows: 25_002 });
        const tables = workbook.SheetNames.slice(0, 10).map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            raw: false,
            defval: "",
            blankrows: false,
          }) as SpreadsheetValue[][];
          return extractPosTable(matrix, file.name, sheetName);
        }).filter((table) => table.headers.length && table.rows.length)
          .sort((left, right) => right.detectionScore - left.detectionScore || right.rows.length - left.rows.length);
        const table = tables[0];
        if (!table) throw new Error("Jadval topilmadi");
        const mapping = autoDetectPosColumns(table.headers);
        const parsed = parsePosRows(table, mapping, today);
        setPosTable(table);
        setPosMapping(mapping);
        setPosNotice(mapping.productCode && mapping.quantity
          ? parsed.summary && !parsed.summary.matches
            ? `Excel yakuniy jami qatorlar bilan mos emas: faylda ${parsed.summary.quantity.toLocaleString()} dona, o‘qilgani ${parsed.summary.parsedQuantity.toLocaleString()} dona. Faylni qayta yuklang.`
            : `✓ ${table.sheetName} varag‘idan ${parsed.rows.length.toLocaleString()} savdo qatori o‘qildi${table.reportDate ? ` · hisobot sanasi ${table.reportDate}` : ""}.`
          : "Fayl ochildi. Faqat “상품코드” va “수량” ustunlarini tanlang.");
      }
    } catch {
      setPosTable(null);
      setPosMapping(emptyPosMapping);
      setOcrStage("");
      setPosNotice(isImage
        ? "Suratni o‘qib bo‘lmadi. JPG, PNG yoki skrinshotni yorug‘ va to‘g‘ri holatda qayta tanlang."
        : "Excel faylini o‘qib bo‘lmadi. `.xlsx`, `.xls` yoki `.csv` faylini tekshiring.");
    } finally {
      setPosReading(false);
      event.target.value = "";
    }
  };
  const removeOcrIssue = (issueId: string) => {
    setOcrReviewIssues((current) => {
      const issue = current.find((entry) => entry.id === issueId);
      if (issue?.blocking) {
        setPosNotice("Bu tizimli tekshiruvni qo‘lda yopib bo‘lmaydi. Suratni qayta, tekis va yaqin holatda yuklang.");
        return current;
      }
      const next = current.filter((issue) => issue.id !== issueId);
      if (!next.length) setOcrNumbersVerified(true);
      return next;
    });
  };
  const resolveOcrField = (rowNumber: number, column: string) => {
    if (column === photoPosMapping.productCode) {
      setOcrReviewIssues((current) => {
        const next = current.filter((issue) => issue.rowNumber !== rowNumber || issue.fields.length > 0);
        if (!next.length) setOcrNumbersVerified(true);
        return next;
      });
      return;
    }
    const field = column === photoPosMapping.quantity
      ? "quantity"
      : column === photoPosMapping.total
        ? "total"
        : null;
    if (!field) return;
    setOcrReviewIssues((current) => {
      const next = current.flatMap((issue) => {
        if (issue.rowNumber !== rowNumber || !issue.fields.includes(field)) return [issue];
        const fields = issue.fields.filter((entry) => entry !== field);
        return fields.length ? [{ ...issue, fields }] : [];
      });
      if (!next.length) setOcrNumbersVerified(true);
      return next;
    });
  };
  const applyOcrAlternative = (issue: OcrReviewIssue) => {
    if (issue.rowNumber == null || !canApplyOcrAlternative(issue)) return;
    setPosTable((table) => table ? {
      ...table,
      rows: table.rows.map((row) => row.rowNumber === issue.rowNumber
        ? {
          ...row,
          values: {
            ...row.values,
            ...(issue.alternate?.quantity != null ? { [photoPosMapping.quantity]: issue.alternate.quantity } : {}),
            ...(issue.alternate?.total != null ? { [photoPosMapping.total]: issue.alternate.total } : {}),
          },
        }
        : row),
    } : table);
    removeOcrIssue(issue.id);
    setPosNotice("");
  };
  const updatePhotoRow = (rowNumber: number, column: string, value: SpreadsheetValue) => {
    setPosNotice("");
    resolveOcrField(rowNumber, column);
    setPosTable((table) => {
      if (!table) return table;
      const rows = table.rows.map((row) => row.rowNumber === rowNumber
        ? { ...row, values: { ...row.values, [column]: value } }
        : row);
      return { ...table, rows };
    });
  };
  const restoreRemovedRows = (entries: RemovedOcrRow[]) => {
    if (!entries.length) return;
    const rowNumbers = new Set(entries.map((entry) => entry.row.rowNumber));
    setPosTable((table) => {
      if (!table) return table;
      const rows = [...table.rows];
      entries
        .slice()
        .sort((left, right) => left.index - right.index)
        .forEach((entry) => {
          if (rows.some((row) => row.rowNumber === entry.row.rowNumber)) return;
          rows.splice(Math.min(entry.index, rows.length), 0, entry.row);
        });
      return { ...table, rows };
    });
    setRemovedOcrRows((current) => current.filter((entry) => !rowNumbers.has(entry.row.rowNumber)));
    setOcrReviewIssues((current) => {
      const remaining = current.filter((issue) => !rowNumbers.has(issue.rowNumber ?? -1)
        && ![...rowNumbers].some((rowNumber) => issue.id === `deleted-row-${rowNumber}`));
      const restoredIssues = entries.flatMap((entry) => entry.issue ? [entry.issue] : []);
      const next = [...remaining, ...restoredIssues];
      setOcrNumbersVerified(!next.length);
      return next;
    });
    setPosNotice(`✓ ${entries.length} ta o‘chirilgan qator chekdagi o‘z joyiga qaytarildi.`);
  };
  const removePhotoRow = (rowNumber: number) => {
    if (!posTable) return;
    const index = posTable.rows.findIndex((row) => row.rowNumber === rowNumber);
    const row = posTable.rows[index];
    if (!row) return;
    const product = String(row.values[photoPosMapping.product] ?? "Noma’lum taom");
    const quantity = Number(row.values[photoPosMapping.quantity] ?? 0);
    const total = Number(row.values[photoPosMapping.total] ?? 0);
    if (deletionMovesAwayFromReceipt(
      posTable.rows,
      rowNumber,
      ocrReceiptSummary.quantity,
      ocrReceiptSummary.total,
    )) {
      setPosNotice(`“${product}”ni o‘chirib bo‘lmaydi: chek jami ${quantity} dona va ${won(total)} ga buziladi. Qator xato bo‘lsa ichidagi qiymatni tahrirlang.`);
      return;
    }
    if (!window.confirm(`“${product}” · ${quantity} dona · ${won(total)} qatorini o‘chirasizmi?\n\nKeyin uni “Qaytarish” orqali tiklash mumkin.`)) return;
    const issue = ocrReviewIssues.find((entry) => entry.rowNumber === rowNumber);
    setRemovedOcrRows((current) => [...current, { row, index, issue }]);
    setOcrNumbersVerified(false);
    setOcrReviewIssues((current) => [
      ...current.filter((entry) => entry.rowNumber !== rowNumber && entry.id !== `deleted-row-${rowNumber}`),
      {
        id: `deleted-row-${rowNumber}`,
        rowNumber: null,
        product,
        fields: [],
        reason: `“${product}” qatori o‘chirildi. Importdan oldin bu o‘chirishni tasdiqlang yoki qatorni qaytaring.`,
      },
    ]);
    setPosTable({ ...posTable, rows: posTable.rows.filter((entry) => entry.rowNumber !== rowNumber) });
    setPosNotice(`“${product}” qatori o‘chirildi. Xato bo‘lsa pastdagi “Qaytarish”ni bosing.`);
  };
  const addPhotoRow = () => {
    setPosNotice("");
    if (!posTable) return;
    const rowNumber = Math.max(0, ...posTable.rows.map((row) => row.rowNumber)) + 1;
    setOcrNumbersVerified(false);
    setOcrReviewIssues((current) => [...current, {
      id: `manual-row-${rowNumber}`,
      rowNumber,
      product: "Yangi qo‘lda kiritilgan qator",
      fields: [],
      reason: "Qo‘lda qo‘shilgan qatorga 상품코드 kiriting va 수량ni tekshiring.",
    }]);
    setPosTable((table) => {
      if (!table) return table;
      return {
        ...table,
        rows: [...table.rows, {
          rowNumber,
          values: {
            [photoPosMapping.product]: "",
            [photoPosMapping.productCode]: "",
            [photoPosMapping.quantity]: 1,
            [photoPosMapping.total]: 0,
            [photoPosMapping.discount]: 0,
            [photoPosMapping.date]: today,
            [photoPosMapping.externalId]: `photo-${table.fileName}`,
          },
        }],
      };
    });
  };
  const importPosSales = async () => {
    if (posDayResetBusy) { setPosNotice("Avval POS importini bekor qilish tugashini kuting."); return; }
    if (parsedPos.errors?.length) { setPosNotice(parsedPos.errors.join(" ")); return; }
    if (posReconciliation.conflicts.length) {
      setPosNotice("Import to‘xtatildi: fayl va oldingi yozuvlar farq qiladi. Pastdagi qatorlar hisobini tekshiring.");
      return;
    }
    const selectedPosAccount = data.accounts.find((account) => account.id === posAccountId);
    if (!selectedPosAccount || selectedPosAccount.type !== "card") {
      setPosNotice("POS uchun karta/POS hisobini tanlang. Delivery savdo alohida bo‘limdan kiritiladi.");
      return;
    }
    if (!posTable || !posMapping.productCode || !posMapping.quantity || !importablePosRows.length) {
      setPosNotice("Import uchun “상품코드” va “수량” ustunlari hamda kamida bitta mos HALO menyusi kerak.");
      return;
    }
    if (parsedPos.summary && !parsedPos.summary.matches) {
      setPosNotice(`Import to‘xtatildi: Excel jami ${parsedPos.summary.quantity.toLocaleString()} dona / ${parsedPos.summary.totalRevenue.toLocaleString()}₩, qatorlar esa ${parsedPos.summary.parsedQuantity.toLocaleString()} dona / ${parsedPos.summary.parsedRevenue.toLocaleString()}₩. Faylni qayta yuklang.`);
      return;
    }
    if (unmatchedPosRows.length) {
      setPosNotice("Avval qizil belgilangan barcha taomlarni retseptga bog‘lang. Chek qisman import qilinmaydi.");
      return;
    }
    if (posSource === "image" && !ocrImportReady) {
      setPosNotice(ocrReviewIssues.length
        ? `Import to‘xtatildi: ${ocrReviewIssues.length} ta qator hali tekshirilmagan.`
        : `Import to‘xtatildi: o‘qilgan 상품코드 va 수량 qatorlarini tekshiring.`);
      return;
    }

    const primaryCodeConflict = importablePosRows.find((row) => row.productCode && data.recipes.some((recipe) => (
      recipe.id !== row.recipeId && normalizeMenuCode(recipe.posCode) === normalizeProductCode(row.productCode)
    )));
    if (primaryCodeConflict) {
      setPosNotice(`“${primaryCodeConflict.productCode}” kodi boshqa menyu taomining asosiy kodi. Avval Retsept va marja oynasida kodni tekshiring.`);
      return;
    }

    const totalRequirements = new Map<string, number>();
    importablePosRows.forEach((row) => {
      const recipe = data.recipes.find((entry) => entry.id === row.recipeId);
      recipe?.ingredients.forEach((ingredient) => {
        if (!ingredient.inventoryId || !data.inventory.some((item) => item.id === ingredient.inventoryId)) return;
        totalRequirements.set(
          ingredient.inventoryId,
          (totalRequirements.get(ingredient.inventoryId) ?? 0) + ingredient.quantity * row.quantity,
        );
      });
    });
    const shortageCount = data.inventory.filter((item) => !isExpenseOnlyInventory(item) && item.stock + 0.000001 < (totalRequirements.get(item.id) || 0)).length;
    const newSales: Sale[] = [];
    const newMovements: StockMovement[] = [];
    const remainingPosStock = new Map(data.inventory.map((item) => [item.id, item.stock]));
    importablePosRows.forEach((row) => {
      const recipe = data.recipes.find((entry) => entry.id === row.recipeId);
      if (!recipe) return;
      const saleId = id("sale");
      const usageMap = new Map<string, number>();
      recipe.ingredients.forEach((ingredient) => {
        if (!ingredient.inventoryId || !data.inventory.some((item) => item.id === ingredient.inventoryId)) return;
        usageMap.set(ingredient.inventoryId, (usageMap.get(ingredient.inventoryId) ?? 0) + ingredient.quantity * row.quantity);
      });
      const stockUsage: SaleIngredientUsage[] = [...usageMap.entries()].flatMap(([inventoryId, quantity]) => {
        const available = remainingPosStock.get(inventoryId) || 0;
        const deducted = quantity;
        remainingPosStock.set(inventoryId, available - deducted);
        if (deducted <= 0) return [];
        const costIngredient = recipe.ingredients.find((ingredient) => ingredient.inventoryId === inventoryId);
        const savedUnitCost = Number(costIngredient?.unitCost);
        const unitCostAtSale = Number.isFinite(savedUnitCost) && savedUnitCost > 0
          ? savedUnitCost
          : Number(costIngredient?.lineCost) > 0 && Number(costIngredient?.quantity) > 0
            ? Number(costIngredient?.lineCost) / Number(costIngredient?.quantity)
          : data.inventory.find((item) => item.id === inventoryId)?.unitCost ?? 0;
        return [{ inventoryId, quantity: deducted, unitCostAtSale, totalCostAtSale: deducted * unitCostAtSale }];
      });
      const totalCost = recipeCost(recipe) * row.quantity;
      const totalRevenue = row.importRevenue;
      newSales.push({
        id: saleId,
        recipeId: recipe.id,
        quantity: row.quantity,
        unitPrice: totalRevenue / row.quantity,
        totalRevenue,
        totalCost,
        date: row.date,
        source: posSource === "image" ? "photo" : "pos",
        taxTreatment: "automatic",
        externalId: row.externalId,
        revenueSource: row.revenueSource,
        accountId: selectedPosAccount.id,
        stockUsage,
      });
      stockUsage.forEach((usage) => newMovements.push({
        id: id("mov"),
        inventoryId: usage.inventoryId,
        type: "sale",
        quantity: -usage.quantity,
        date: row.date,
        note: `${posSource === "image" ? "SURAT" : "POS"} · ${recipe.name} × ${row.quantity}`,
        referenceId: saleId,
      }));
    });

    const learnedCodes = new Map<string, string>();
    importablePosRows.forEach((row) => {
      const code = normalizeProductCode(row.productCode);
      if (code) learnedCodes.set(code, row.recipeId);
    });
    const recipesWithLearnedCodes = promoteLearnedMenuCodes(
      data.recipes,
      [...learnedCodes].map(([code, recipeId]) => ({ recipeId, code })),
    );
    const saved = await save({
      ...data,
      recipes: recipesWithLearnedCodes,
      inventory: data.inventory.map((item) => ({ ...item, stock: remainingPosStock.get(item.id) ?? item.stock })),
      sales: [...newSales, ...data.sales],
      stockMovements: [...newMovements, ...data.stockMovements],
    }, `${posSource === "image" ? "Surat" : "POS Excel"} import qilindi · ${newSales.length} qator`);
    if (saved) setPosNotice(`✓ ${newSales.length} ta ${posSource === "image" ? "surat" : "POS"} qatori import qilindi. Savdo, tannarx va foyda hisoblandi${totalRequirements.size ? "; mavjud ombor qoldig‘i yangilandi" : "; ombor aralashtirilmadi"}${shortageCount ? `; ${shortageCount} ta xomashyo yetishmovchiligi importni to‘xtatmadi` : ""}${learnedCodes.size ? `; ${learnedCodes.size} ta mahsulot kodi keyingi fayllar uchun eslab qolindi` : ""}.`);
  };
  const editTransaction = (transaction: Transaction) => {
    const sourceDocument = supplierSourceDocument(data, transaction);
    if (sourceDocument) {
      setWarehouseEditingId(sourceDocument);
      setTab("inventory");
      return;
    }
    const payment = linkedTransactionPayment(transaction);
    if (payment.ambiguous) {
      setTransactionNotice("Bir xil eski to‘lovlar topildi. Xavfsiz tahrirlash uchun avval takror yozuvlardan birini o‘chiring.");
      return;
    }
    setEditingTransactionId(transaction.id);
    supplierEditingSnapshotRef.current = structuredClone(transaction);
    setSupplierTransactionOpen(true);
    setTransactionForm({
      supplierId: transaction.supplierId,
      type: transaction.type,
      amount: transaction.amount,
      date: transaction.date,
      note: transaction.note,
      accountId: transaction.accountId || payment.entry?.accountId || "account-bank",
      settlementMode: "debt",
    });
    setTransactionDocumentFile(null);
    setTransactionDocumentPreview("");
    setRemoveTransactionDocument(false);
    setTransactionFileInputKey((current) => current + 1);
    setTransactionNotice(`“${supplierName(transaction.supplierId)}” yozuvi tahrirlash uchun ochildi.`);
    window.requestAnimationFrame(() => document.getElementById("supplier-transaction-form")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const saveSupplierTransaction = async () => {
    if (supplierTransactionBusyRef.current) return;
    if (!transactionForm.supplierId || transactionForm.amount <= 0 || !transactionForm.date) {
      setTransactionNotice("Yetkazib beruvchi, summa va sanani kiriting.");
      return;
    }
    if ((transactionForm.type === "payment" || (transactionForm.type === "purchase" && transactionForm.settlementMode === "paid")) && !transactionForm.accountId) {
      setTransactionNotice("To‘lov qaysi hisobdan chiqqanini tanlang.");
      return;
    }
    const original = editingTransactionId
      ? supplierEditingSnapshotRef.current || data.transactions.find((transaction) => transaction.id === editingTransactionId)
      : undefined;
    if (editingTransactionId && !original) {
      setTransactionNotice("Tahrirlanayotgan yozuv topilmadi. Sahifani yangilang.");
      return;
    }
    if (original && isWorkerDeliveryTransaction(original)) {
      setTransactionNotice("Bu yozuv xodim kiritgan ombor kirimi bilan bog‘langan va alohida o‘zgartirilmaydi.");
      resetTransactionDraft();
      return;
    }
    if (original && original.type !== transactionForm.type) {
      setTransactionNotice("Kirimni to‘lovga yoki to‘lovni kirimga aylantirib bo‘lmaydi. Eski yozuvni Savatga ko‘chiring va to‘g‘ri turda yangi yozuv kiriting — nakladnoy tarixi shunda saqlanadi.");
      return;
    }
    const transactionId = original?.id
      || supplierTransactionOperationIdRef.current
      || (supplierTransactionOperationIdRef.current = id("tx"));
    const nextTransactionBase: Transaction = {
      id: transactionId,
      supplierId: transactionForm.supplierId,
      type: transactionForm.type,
      amount: Number(transactionForm.amount),
      date: transactionForm.date,
      note: transactionForm.note.trim().slice(0, 200),
      ...(transactionForm.type === "payment" ? { accountId: transactionForm.accountId } : {}),
    };

    supplierTransactionBusyRef.current = true;
    setTransactionSaving(true);
    setTransactionNotice(transactionDocumentFile ? "Nakladnoy rasmi yuklanmoqda…" : "Hisob-kitob saqlanmoqda…");
    let uploadedDocument: StockDocument | undefined;
    try {
      if (transactionForm.type === "purchase" && transactionDocumentFile) {
        uploadedDocument = supplierPendingDocumentRef.current || await uploadStockDocument(transactionDocumentFile);
        supplierPendingDocumentRef.current = uploadedDocument;
      }
      const document = transactionForm.type === "purchase"
        ? uploadedDocument || (removeTransactionDocument ? undefined : original?.document)
        : undefined;
      const nextTransaction: Transaction = { ...nextTransactionBase, ...(document ? { document } : {}) };
      const savePurchaseAsPaid = !original && transactionForm.type === "purchase" && transactionForm.settlementMode === "paid";
      await saveAtomicSupplierRecord(savePurchaseAsPaid
        ? { action: "savePurchaseAndPayment", transaction: nextTransaction, accountId: transactionForm.accountId, duplicateReason:supplierDuplicateReason }
        : { action: "saveTransaction", transaction: nextTransaction, duplicateReason:supplierDuplicateReason, ...(original ? {edit:true,expectedTransaction:original} : {}) });
      resetTransactionDraft();
      setSupplierTransactionOpen(false);
      setTransactionNotice(`✓ ${original ? "Yozuv tahrirlandi" : "Yozuv saqlandi"}${document ? " · nakladnoy saqlandi" : ""} · ${savePurchaseAsPaid ? "darhol to‘landi, qarz qolmadi" : "qarz va pul hisobi qayta hisoblandi"}.`);
    } catch (error) {
      if (uploadedDocument && (error as Error & {requestRejected?:boolean}).requestRejected) {
        await deleteRemoteStockDocument(uploadedDocument.key);
        supplierPendingDocumentRef.current = undefined;
      }
      setSupplierDuplicateWarning((error as Error & {code?:string}).code === 'SIMILAR_SUPPLIER_TRANSACTION');
      setTransactionNotice(error instanceof Error ? error.message : "Hisob-kitobni saqlab bo‘lmadi.");
    } finally {
      supplierTransactionBusyRef.current = false;
      setTransactionSaving(false);
    }
  };
  const materializeExpenseState = (next: AppState) => {
    const result = materializeRecurringExpenses({
      fixedExpenses: next.fixedExpenses,
      financialEntries: next.financialEntries,
      throughDate: accountingToday,
    });
    return {
      state: {
        ...next,
        fixedExpenses: result.fixedExpenses,
        financialEntries: result.financialEntries,
      },
      created: result.createdEntries.length,
    };
  };
  const addFinancialEntry = async () => {
    if (financeForm.amount <= 0 || !financeForm.accountId) {
      setFinanceNotice("Summa va pul hisobini kiriting.");
      return;
    }
    if (financeForm.type === "expense" && financeForm.category === "Maosh") {
      setFinanceNotice("Maosh va avansni Nazorat markazi → Xodimlar orqali kiriting. Shunda pul ham, ish soati ham to‘g‘ri hisoblanadi.");
      return;
    }
    if (financeForm.type === "transfer" && (!financeForm.toAccountId || financeForm.toAccountId === financeForm.accountId)) {
      setFinanceNotice("Pul o‘tkaziladigan boshqa hisobni tanlang.");
      return;
    }
    const affectsProfit = financeForm.type !== "transfer"
      && (financeForm.type === "income" || financeForm.category !== "Mahsulot xaridi");
    const entry: FinancialEntry = {
      id: id("fin"),
      ...financeForm,
      category: financeForm.type === "transfer" ? "Hisoblar orasida o‘tkazma" : financeForm.category,
      note: financeForm.note.trim(),
      affectsProfit,
    };
    const saved = await save(
      { ...data, financialEntries: [entry, ...data.financialEntries] },
      `${financeForm.type === "expense" ? "Xarajat" : financeForm.type === "income" ? "Daromad" : "O‘tkazma"} · ${entry.category} · ${won(entry.amount)}`,
    );
    if (!saved) {
      setFinanceNotice("Pul harakati saqlanmadi. Kiritilgan ma’lumot joyida qoldi.");
      return;
    }
    setFinanceNotice(`✓ ${financeForm.type === "expense" ? "Xarajat" : financeForm.type === "income" ? "Daromad" : "O‘tkazma"} yozildi.`);
    setFinanceForm({ ...financeForm, amount: 0, note: "" });
  };
  const saveOilEntry = async () => {
    if (oilSavingRef.current) return;
    if (branchTransitionRef.current) {
      setOilNotice("Filial ochilmoqda. Tugagach moy yozuvini saqlang.");
      return;
    }
    const canCount = Number(oilForm.canCount);
    const unitAmount = Number(oilForm.unitAmount);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(oilForm.date) || !oilForm.accountId) {
      setOilNotice("Sana va pul hisobini tanlang.");
      return;
    }
    if (!Number.isInteger(canCount) || canCount <= 0 || canCount > 10_000) {
      setOilNotice("18 L kanistr sonini butun va musbat kiriting.");
      return;
    }
    if (!Number.isSafeInteger(unitAmount) || unitAmount <= 0) {
      setOilNotice("Bitta 18 L kanistr narxini butun von bilan kiriting.");
      return;
    }
    const totalAmount = canCount * unitAmount;
    if (!Number.isSafeInteger(totalAmount)) {
      setOilNotice("Jami summa juda katta. Kanistr soni yoki narxini tekshiring.");
      return;
    }
    const isPurchase = oilForm.type === "purchase";
    oilSavingRef.current = true;
    setOilSaving(true);
    setOilNotice("Saqlanmoqda…");
    try {
      const operationId = oilOperationIdRef.current || (oilOperationIdRef.current = crypto.randomUUID());
      const branchId = activeBranchRef.current;
      const response = await fetch(`/api/oil-records?branch=${encodeURIComponent(branchId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId,
          flowType: oilForm.type,
          canCount,
          unitAmount,
          date: oilForm.date,
          accountId: oilForm.accountId,
          note: oilForm.note.trim(),
        }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; alreadySaved?: boolean };
      if (!response.ok || !result.ok) throw new Error(result.error || "Moy yozuvi saqlanmadi.");
      await reloadAuthoritativeState(branchId);
      oilOperationIdRef.current = "";
      setOilForm((current) => ({ ...current, canCount: 1, unitAmount: 0, note: "" }));
      setOilNotice(isPurchase
        ? `✓ ${canCount} ta (${canCount * CHICKEN_OIL_CAN_LITERS} L) yangi moy xarajati ${won(totalAmount)} sifatida yozildi${result.alreadySaved ? " · oldin saqlangan" : ""}.`
        : `✓ ${canCount} ta (${canCount * CHICKEN_OIL_CAN_LITERS} L) ishlatilgan moy sotuvi ${won(totalAmount)} kirim va foyda hisobiga yozildi${result.alreadySaved ? " · oldin saqlangan" : ""}.`);
    } catch (error) {
      setOilNotice(error instanceof Error
        ? `Moy hisobi saqlanmadi: ${error.message}`
        : "Moy hisobi saqlanmadi. Kiritilgan ma’lumot o‘chmadi — qayta urinib ko‘ring.");
    } finally {
      oilSavingRef.current = false;
      setOilSaving(false);
    }
  };
  const addExpenseEntry = async () => {
    if (expenseForm.amount <= 0 || !expenseForm.accountId || !expenseForm.date) {
      setExpenseNotice("Summa, sana va pul hisobini kiriting.");
      return;
    }
    if (costRuleCoversCategory(expenseForm.category, data.costRules)) {
      setExpenseNotice("Bu toifa Nazorat markazidagi foiz qoidasida avtomatik hisoblanadi. Ikki marta yozilmasligi uchun xarajat saqlanmadi.");
      return;
    }
    const entry: FinancialEntry = {
      id: id("fin"),
      type: "expense",
      category: expenseForm.category,
      amount: expenseForm.amount,
      date: expenseForm.date,
      accountId: expenseForm.accountId,
      note: expenseForm.note.trim(),
      affectsProfit: expenseForm.category !== "Mahsulot xaridi",
    };
    const saved = await save(
      { ...data, financialEntries: [entry, ...data.financialEntries] },
      `Xarajat · ${entry.category} · ${won(entry.amount)}`,
    );
    if (!saved) {
      setExpenseNotice("Xarajat saqlanmadi. Kiritilgan ma’lumot joyida qoldi.");
      return;
    }
    setExpenseNotice(`✓ ${entry.category}: ${won(entry.amount)} xarajat yozildi.`);
    setExpenseForm({ ...expenseForm, amount: 0, note: "" });
  };
  const addFixedExpense = async () => {
    if (!fixedExpenseForm.name.trim() || fixedExpenseForm.amount <= 0 || !fixedExpenseForm.accountId) {
      setFixedExpenseNotice("Xarajat nomi, summasi va pul hisobini kiriting.");
      return;
    }
    if (!canAutomateRecurringExpenseCategory(fixedExpenseForm.category)) {
      setFixedExpenseNotice("Mahsulot xaridi, maosh va avansni bu yerda takrorlamang. Ular Oldi-berdi yoki Xodimlar oynasidan hisoblanadi.");
      return;
    }
    if (
      costRuleCoversCategory(fixedExpenseForm.category, data.costRules)
    ) {
      setFixedExpenseNotice("Bu xarajat Nazorat markazidagi foiz qoidasida allaqachon avtomatik hisoblanadi. Ikki marta yozilmasligi uchun o‘sha qoidani tekshiring.");
      return;
    }
    const template: FixedExpense = {
      id: id("fixed"),
      ...fixedExpenseForm,
      name: fixedExpenseForm.name.trim(),
      active: true,
      automatic: fixedExpenseForm.frequency === "monthly" && fixedExpenseForm.automatic,
      billingDay: Number(fixedExpenseForm.nextDue.slice(8, 10)),
    };
    const duplicate = template.automatic ? data.fixedExpenses.find((expense) => (
      expense.active
      && expense.automatic === true
      && expense.frequency === "monthly"
      && recurringExpenseTemplateIdentity(expense) === recurringExpenseTemplateIdentity(template)
    )) : undefined;
    if (duplicate) {
      setFixedExpenseNotice(`“${duplicate.name}” allaqachon avtomatik xarajatlarda bor. Ikkinchi marta qo‘shilmadi.`);
      return;
    }
    const materialized = materializeExpenseState({ ...data, fixedExpenses: [template, ...data.fixedExpenses] });
    const saved = await save(
      materialized.state,
      `Doimiy xarajat qo‘shildi · ${template.name}`,
    );
    if (!saved) {
      setFixedExpenseNotice("Doimiy xarajat saqlanmadi. Kiritilgan ma’lumot joyida qoldi.");
      return;
    }
    setFixedExpenseNotice(`✓ ${template.name} saqlandi${materialized.created ? ` · ${materialized.created} oylik yozuv avtomatik hisoblandi` : " · sanasi kelganda avtomatik hisoblanadi"}.`);
    setFixedExpenseForm({ ...fixedExpenseForm, name: "", amount: 0 });
  };
  const payFixedExpense = async (templateId: string) => {
    const template = data.fixedExpenses.find((entry) => entry.id === templateId);
    if (!template || !template.active || template.automatic || template.nextDue > accountingToday) return;
    const dueDate = template.nextDue;
    const entryId = recurringExpenseEntryId(template.id, dueDate);
    const alreadyRecorded = data.financialEntries.some((entry) => (
      entry.id === entryId
      || (entry.fixedExpenseId === template.id && entry.fixedExpenseDueDate === dueDate)
    ));
    const entry: FinancialEntry = {
      id: entryId,
      type: "expense",
      category: template.category,
      amount: template.amount,
      date: dueDate,
      accountId: template.accountId,
      note: `Doimiy xarajat · ${template.name}`,
      affectsProfit: true,
      fixedExpenseId: template.id,
      fixedExpenseDueDate: dueDate,
    };
    const nextDue = nextExpenseDate(dueDate, template.frequency, template.billingDay);
    const saved = await save({
      ...data,
      financialEntries: alreadyRecorded ? data.financialEntries : [entry, ...data.financialEntries],
      fixedExpenses: data.fixedExpenses.map((item) => item.id === template.id
        ? { ...item, nextDue, lastPaidDate: dueDate }
        : item),
    }, `Doimiy xarajat to‘landi · ${template.name} · ${won(template.amount)}`);
    if (!saved) {
      setFixedExpenseNotice("Xarajat saqlanmadi. Qayta urinib ko‘ring.");
      return;
    }
    setFixedExpenseNotice(`✓ ${template.name}: ${won(template.amount)} ${accountName(template.accountId)}dan ayrildi.`);
  };
  const toggleFixedExpense = async (templateId: string) => {
    const selected = data.fixedExpenses.find((item) => item.id === templateId);
    if (!selected) return;
    if (!selected.active) {
      const duplicate = data.fixedExpenses.find((item) => (
        item.id !== selected.id
        && item.active
        && recurringExpenseTemplateIdentity(item) === recurringExpenseTemplateIdentity(selected)
      ));
      if (duplicate) {
        setFixedExpenseNotice(`“${duplicate.name}” allaqachon faol. Takroriy kartani faollashtirib bo‘lmaydi.`);
        return;
      }
    }
    const next = materializeExpenseState({
      ...data,
      fixedExpenses: data.fixedExpenses.map((item) => {
        if (item.id !== templateId) return item;
        if (item.active) return { ...item, active: false };
        if (!item.automatic || item.frequency !== "monthly") return { ...item, active: true };
        const billingDay = item.billingDay || Number(item.nextDue.slice(8, 10));
        return {
          ...item,
          active: true,
          billingDay,
          nextDue: nextRecurringExpenseDateAfter(item.nextDue, billingDay, accountingToday),
        };
      }),
    });
    await save(next.state, `Doimiy xarajat holati o‘zgartirildi`);
  };
  const updateFixedExpense = async (templateId: string, patch: Partial<FixedExpense>) => {
    const current = data.fixedExpenses.find((item) => item.id === templateId);
    if (!current) return;
    const category = patch.category ?? current.category;
    if (!canAutomateRecurringExpenseCategory(category)) {
      setFixedExpenseNotice("Mahsulot xaridi, maosh va avans bu oynada takroriy xarajat qilib saqlanmaydi.");
      return;
    }
    if (
      costRuleCoversCategory(category, data.costRules)
    ) {
      setFixedExpenseNotice("Bu xarajat foiz qoidasida allaqachon avtomatik hisoblanadi. Ikki marta yozilmasligi uchun o‘zgartirish saqlanmadi.");
      return;
    }
    const next = materializeExpenseState({
      ...data,
      fixedExpenses: data.fixedExpenses.map((item) => {
        if (item.id !== templateId) return item;
        const updated = { ...item, ...patch };
        if (patch.nextDue) updated.billingDay = Number(patch.nextDue.slice(8, 10));
        if (patch.frequency && patch.frequency !== "monthly") updated.automatic = false;
        if (patch.automatic === true) {
          updated.frequency = "monthly";
          updated.billingDay = updated.billingDay || Number(updated.nextDue.slice(8, 10));
          if (current.automatic !== true && updated.active && updated.nextDue <= accountingToday) {
            updated.nextDue = nextRecurringExpenseDateAfter(
              updated.nextDue,
              updated.billingDay,
              accountingToday,
            );
          }
        }
        return updated;
      }),
    });
    await save(next.state, `Doimiy xarajat sozlamasi yangilandi`);
  };
  const reverseFinancialEntry = async (entryId: string) => {
    const original = data.financialEntries.find((entry) => entry.id === entryId);
    if (!original || original.reversedEntryId || data.financialEntries.some((entry) => entry.reversedEntryId === original.id)) return;
    if (original.payrollPaymentId) {
      const message = "Oylik to‘lovini xodim kartasidagi “Kunlar va to‘lovlar” bo‘limidan bekor qiling.";
      setFinanceNotice(message);
      setExpenseNotice(message);
      return;
    }
    if (!window.confirm("Bu yozuv o‘chirilmaydi. Uni bekor qiluvchi qarama-qarshi yozuv yaratilsinmi?")) return;
    const reason = askCancellationReason(`${original.category} · ${won(original.amount)}`);
    if (!reason) return;
    const cancelledAt = new Date().toISOString();
    const reversal: FinancialEntry = original.type === "transfer"
      ? {
          ...original,
          id: id("fin"),
          accountId: original.toAccountId ?? original.accountId,
          toAccountId: original.accountId,
          note: `BEKOR QILINDI · ${original.note || original.category}`,
          reversedEntryId: original.id,
          fixedExpenseId: undefined,
          fixedExpenseDueDate: undefined,
          oilFlowType: undefined,
          oilCanCount: undefined,
          oilLiters: undefined,
          oilUnitAmount: undefined,
          cancellationReason: reason,
          cancelledAt,
          cancelledBy: "Rahbar",
        }
      : {
          ...original,
          id: id("fin"),
          type: original.type === "expense" ? "income" : "expense",
          note: `BEKOR QILINDI · ${original.note || original.category}`,
          reversedEntryId: original.id,
          fixedExpenseId: undefined,
          fixedExpenseDueDate: undefined,
          oilFlowType: undefined,
          oilCanCount: undefined,
          oilLiters: undefined,
          oilUnitAmount: undefined,
          cancellationReason: reason,
          cancelledAt,
          cancelledBy: "Rahbar",
        };
    const saved = await save(
      { ...data, financialEntries: [reversal, ...data.financialEntries] },
      `Moliyaviy yozuv bekor qilindi · ${original.category} · ${won(original.amount)} · Sabab: ${reason}`,
    );
    const message = saved
      ? "✓ Yozuv bekor qiluvchi qarama-qarshi operatsiya yaratildi."
      : "Yozuvni bekor qilib bo‘lmadi. Qayta urinib ko‘ring.";
    setFinanceNotice(message);
    setExpenseNotice(message);
    setOilNotice(message);
  };
  const closeDay = async () => {
    if (closeSavingRef.current) return;
    const missingAccounts = calculateAccountBalances(data, closeForm.date).unmatched;
    if (missingAccounts.length) {
      setCloseNotice(`${missingAccounts.length} ta yozuvning kassa yoki bank hisobi topilmadi. Pul hisobini tekshirmasdan kunni yopib bo‘lmaydi.`);
      return;
    }
    const validation = validateDailyCloseInput({
      date: closeForm.date,
      today,
      accounts: data.accounts,
      actualByAccount: closeForm.actualByAccount,
      expectedByAccount: closeExpectedByAccount,
      dailyCloses: data.dailyCloses,
      monthlyCloses: data.monthlyCloses,
      note: closeForm.note,
    });
    if (!validation.ok) {
      setCloseNotice(validation.error);
      return;
    }
    const accountSummary = data.accounts.map((account) => (
      `• ${account.name}: dasturda ${won(closeExpectedByAccount[account.id] || 0)} → haqiqiy ${won(validation.actualByAccount[account.id] || 0)}`
    )).join("\n");
    const confirmed = window.confirm(
      `${displayDate(validation.date)} kunini yopasizmi?\n\n${accountSummary}\n\n`
      + `Jami dasturda: ${won(validation.totalExpected)}\n`
      + `Jami haqiqiy: ${won(validation.totalActual)}\n`
      + `Farq: ${won(validation.difference)}`
      + (validation.note ? `\nSabab: ${validation.note}` : ""),
    );
    if (!confirmed) return;
    closeSavingRef.current = true;
    setCloseSaving(true);
    setCloseNotice("");
    const dailyClose: DailyClose = {
      id: id("close"),
      date: validation.date,
      expectedByAccount: closeExpectedByAccount,
      actualByAccount: validation.actualByAccount,
      expectedTotal: validation.totalExpected,
      actualTotal: validation.totalActual,
      difference: validation.difference,
      grossProfit: closeGrossProfit,
      operatingExpenses: closeTotalOperatingExpenses,
      netProfit: closeNetProfit,
      note: validation.note,
      closedAt: new Date().toISOString(),
    };
    const next = { ...data, dailyCloses: [dailyClose, ...data.dailyCloses] };
    try {
      const saved = await save(next, `Kun yopildi · ${displayDate(validation.date)} · farq ${won(dailyClose.difference)}`);
      if (!saved) {
        setCloseNotice("Kun yakuni saqlanmadi. Kiritilgan summalar joyida qoldi — qayta urinib ko‘ring.");
        return;
      }
      setCloseNotice(`✓ ${displayDate(validation.date)} yopildi. Farq: ${won(dailyClose.difference)}. Telegram hisobot vaqti: ${telegramSettings.reportTime} (Seul).`);
      setCloseForm((current) => ({ ...current, actualByAccount: {}, note: "" }));
    } catch {
      setCloseNotice("Kun yakuni saqlanmadi. Kiritilgan summalar joyida qoldi — qayta urinib ko‘ring.");
    } finally {
      closeSavingRef.current = false;
      setCloseSaving(false);
    }
  };
  const accountName = (accountId: string) => !accountId ? "Qarz / pulsiz xarajat" : data.accounts.find((account) => account.id === accountId)?.name ?? "Noma’lum hisob";
  const updateOpeningBalance = (accountId: string, openingBalance: number) => {
    save({
      ...data,
      accounts: data.accounts.map((account) => account.id === accountId ? { ...account, openingBalance } : account),
    }, `Boshlang‘ich qoldiq yangilandi · ${accountName(accountId)} · ${won(openingBalance)}`);
  };
  const telegramRequest = async (payload: Record<string, unknown>, branchId = activeBranchId) => {
    const response = await fetch("/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, branchId }),
    });
    const result = await response.json() as TelegramSettings & {
      ok?: boolean;
      error?: string;
      message?: string;
      warning?: string;
      mezanaSettings?: MezanaSettings;
      updatedAt?: string;
      chatName?: string;
      telegramThreadId?: number;
      mezanaDestination?: "borrowed" | "purchased";
      sentAt?: string;
      reportDate?: string;
      orderSent?: number;
      orderSkipped?: number;
      final?: boolean;
    };
    if (!response.ok) throw new Error(response.status === 401
      ? "Rahbar kirish muddati tugagan. Sahifani yangilab, rahbar sifatida qayta kiring."
      : result.error || "Telegram amali bajarilmadi.");
    return result;
  };
  const discoverTelegramChat = async () => {
    setTelegramBusy("discover");
    setTelegramNotice("");
    try {
      const result = await telegramRequest({ action: "discover", botToken: telegramForm.botToken });
      setTelegramForm({ ...telegramForm, chatId: result.chatId });
      setTelegramNotice(`✓ ${result.chatName || "Telegram chat"} topildi. Endi sozlamani saqlang.`);
    } catch (error) {
      setTelegramNotice(error instanceof Error ? error.message : "Chat topilmadi.");
    } finally {
      setTelegramBusy("");
    }
  };
  const saveTelegramSettings = async () => {
    setTelegramBusy("save");
    setTelegramNotice("");
    try {
      const result = await telegramRequest({
        action: "save",
        botToken: telegramForm.botToken,
        chatId: telegramForm.chatId,
        reportTime: telegramForm.reportTime,
        enabled: telegramForm.enabled,
      });
      setTelegramSettings(result);
      setTelegramForm({ ...telegramForm, botToken: "", chatId: result.chatId, reportTime: result.reportTime, enabled: result.enabled });
      setTelegramNotice("✓ Telegram bot sozlamalari saqlandi.");
    } catch (error) {
      setTelegramNotice(error instanceof Error ? error.message : "Sozlama saqlanmadi.");
    } finally {
      setTelegramBusy("");
    }
  };
  const testTelegram = async () => {
    setTelegramBusy("test");
    setTelegramNotice("");
    try {
      const result = await telegramRequest({ action: "test" });
      setTelegramNotice(`✓ ${result.message || "Sinov xabari yuborildi."}`);
    } catch (error) {
      setTelegramNotice(error instanceof Error ? error.message : "Sinov xabari yuborilmadi.");
    } finally {
      setTelegramBusy("");
    }
  };
  const sendTelegramReport = async (reportDate = today, silent = false) => {
    setTelegramBusy("send");
    if (!silent) setTelegramNotice("");
    try {
      const result = await telegramRequest({ action: "send", reportDate });
      setTelegramSettings((current) => ({
        ...current,
        lastSentDate: result.final ? (result.reportDate || reportDate) : current.lastSentDate,
        lastSentAt: result.sentAt || new Date().toISOString(),
      }));
      setTelegramNotice(`✓ ${result.message || "Hisobot Telegramga yuborildi."}`);
    } catch (error) {
      if (!silent) setTelegramNotice(error instanceof Error ? error.message : "Hisobot yuborilmadi.");
    } finally {
      setTelegramBusy("");
    }
  };
  const sendTelegramOrders = async () => {
    setTelegramBusy("orders");
    setTelegramNotice("");
    try {
      const result = await telegramRequest({ action: "orders", reportDate: today });
      setTelegramNotice(`✓ ${result.message || "Buyurtmalar yuborildi."}${result.orderSkipped ? ` · ${result.orderSkipped} ta yetkazuvchining Telegrami ulanmagan` : ""}`);
    } catch (error) {
      setTelegramNotice(error instanceof Error ? error.message : "Buyurtmalar yuborilmadi.");
    } finally {
      setTelegramBusy("");
    }
  };
  const openTelegram = (message: string) => {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(haloMenuUrl)}&text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  };
  const purchaseMessage = [
    "HALO — xarid ro‘yxati",
    ...purchaseGroups.flatMap((group) => [
      `\n${group.supplier.name}:`,
      ...group.items.map((item) => `• ${item.name}: ${Math.ceil(item.buyQuantity).toLocaleString()} ${item.unit}`),
    ]),
    ...(unassignedPurchases.length ? [
      "\nYetkazib beruvchi belgilanmagan:",
      ...unassignedPurchases.map((item) => `• ${item.name}: ${Math.ceil(item.buyQuantity).toLocaleString()} ${item.unit}`),
    ] : []),
  ].join("\n");
  const dailyReportMessage = [
    "📊 HALO | KUNLIK HISOBOT",
    `📅 ${displayDate(today)}`,
    "🕛 Hisob oralig‘i: 00:00–23:59",
    "",
    "💰 MOLIYA",
    `Savdo: ${won(todayRevenue)}`,
    `Tannarx: −${won(todayCost)}`,
    `Jami xarajat: ${formatExpenseEffectWon(todayTotalExpenses)}`,
    `Qo‘lda: ${formatExpenseEffectWon(todayEnteredExpenses)} · oylik avtomatik: ${formatExpenseEffectWon(todayRecurringExpenses)}`,
    `Maosh: ${formatExpenseEffectWon(todayPayroll)} · soliq/komissiya: ${formatExpenseEffectWon(todayAutomaticCosts - todayPayroll)}`,
    `Hisobiy foyda: ${won(todayNetProfit)}`,
    `Sof marja: ${todayRevenue ? ((todayNetProfit / todayRevenue) * 100).toFixed(1) : "0.0"}%`,
    "",
    "🧾 SAVDO",
    `Sotildi: ${todayItems} ta`,
    `TOP taom: ${topTodayRecipe ? `${recipeName(topTodayRecipe[0])} — ${topTodayRecipe[1]} ta` : "Savdo kiritilmagan"}`,
    "",
    "🏦 HISOBLAR",
    ...data.accounts.map((account) => `${account.name}: ${won(accountBalance(account.id))}`),
    `Jami pul: ${won(totalAccountBalance)}`,
    "",
    "📦 NAZORAT",
    `Ombor qiymati: ${won(inventoryValue)}`,
    `Kam qolgan mahsulot: ${purchaseItems.length} ta`,
    `Yetkazib beruvchi qarzi: ${won(debt)}`,
    `MEZANA qarzi: ${won(mezanaCurrentBalance)}`,
    `Muddati kelgan xarajat: ${dueFixedExpenses.length} ta`,
    "",
    "🛒 XARID TAVSIYASI",
    ...(purchaseItems.length ? purchaseGroups.flatMap((group) => [
      `${group.supplier.name}:`,
      ...group.items.map((item) => `• ${item.name}: ${Math.ceil(item.buyQuantity).toLocaleString()} ${item.unit}`),
    ]) : ["Bugun buyurtma kerak emas."]),
    ...(unassignedPurchases.length ? [
      "Yetkazib beruvchisi belgilanmagan:",
      ...unassignedPurchases.map((item) => `• ${item.name}: ${Math.ceil(item.buyQuantity).toLocaleString()} ${item.unit}`),
    ] : []),
    `Avtomatik yuboriladi: ${autoOrderGroups.length} ta yetkazuvchi`,
    `Sozlash kerak: ${supplierSetupNeeded.length + (unassignedPurchases.length ? 1 : 0)} ta`,
    "",
    todayClose ? `✅ Kun yopildi · kassa farqi: ${won(todayClose.difference)}` : "⚠️ Kun hali yopilmagan",
  ].join("\n");

  const cancellationCount = data.deletedItems.length
    + data.financialEntries.filter((entry) => entry.reversedEntryId && !entry.payrollPaymentId).length
    + data.purchaseOrders.filter((entry) => entry.status === "cancelled").length
    + data.workShifts.filter((entry) => entry.status === "void").length
    + data.payrollAdjustments.filter((entry) => entry.voided).length
    + data.attendanceDays.filter((entry) => entry.voided).length
    + data.payrollPayments.filter((entry) => entry.voided).length
    + data.staff.filter((entry) => entry.cancellationReason).length;
  const nav = useMemo(() => [
    { id: "dashboard" as Tab, icon: "◫", label: "Bugun" },
    { id: "recipes" as Tab, icon: "◉", label: "Taom tannarxi" },
    { id: "intake" as Tab, icon: "+", label: "Mahsulot kirimi" },
    { id: "vegetables" as Tab, icon: "◔", label: "Sabzavot va sous zaxirasi" },
    { id: "inventory" as Tab, icon: "▦", label: "Ombor" },
    { id: "sales" as Tab, icon: "↗", label: "Savdo" },
    { id: "deliverysales" as Tab, icon: "🛵", label: "Delivery savdo" },
    { id: "cashbank" as Tab, icon: "₩", label: "Naqd / hisob savdosi" },
    { id: "cashsales" as Tab, icon: "−", label: "Yeyilgan / chiqimlar" },
    { id: "mezana" as Tab, icon: "M", label: "MEZANA" },
    { id: "fees" as Tab, icon: "%", label: "Soliq va ushlanmalar" },
    { id: "expenses" as Tab, icon: "−₩", label: "Xarajat" },
    { id: "oil" as Tab, icon: "◒", label: "Chicken moyi" },
    { id: "finance" as Tab, icon: "₩", label: "Kassa va hisoblar" },
    { id: "reports" as Tab, icon: "✈", label: "Hisobot" },
    { id: "suppliers" as Tab, icon: "⇄", label: "Yetkazib beruvchilar" },
    { id: "control" as Tab, icon: "◆", label: "Xodimlar va boshqaruv" },
    { id: "integrations" as Tab, icon: "⌁", label: "API va ulanishlar" },
    { id: "archive" as Tab, icon: "!", label: cancellationCount ? `Bekor qilinganlar · ${cancellationCount}` : "Bekor qilinganlar" },
  ], [cancellationCount]);
  const navById = new Map(nav.map((item) => [item.id, item]));
  const primaryNav = (["dashboard", "sales", "intake", "inventory"] as const)
    .map((itemId) => navById.get(itemId))
    .filter((item): item is (typeof nav)[number] => Boolean(item));
  const visiblePrimaryNav = userMode === "owner"
    ? primaryNav
    : primaryNav.filter((item) => item.id !== "intake");
  const moreNavGroups = [
    { label: "SAVDO KANALLARI", ids: ["deliverysales", "cashbank"] as Tab[] },
    { label: "XARID VA SARF", ids: ["vegetables", "cashsales", "mezana", "oil"] as Tab[] },
    { label: "PUL VA QARZ", ids: ["suppliers", "expenses", "finance"] as Tab[] },
    { label: "XODIMLAR VA HISOBOT", ids: ["control", "reports", "archive"] as Tab[] },
    { label: "SOZLAMALAR", ids: ["recipes", "fees", "integrations"] as Tab[] },
  ].map((group) => ({
    ...group,
    items: group.ids.map((itemId) => navById.get(itemId)).filter((item): item is (typeof nav)[number] => Boolean(item)),
  }));
  const moreNavActive = moreNavGroups.some((group) => group.ids.includes(tab));
  const salesChannelTabs = [
    { id: "sales" as Tab, icon: "▣", label: "POS" },
    { id: "cashbank" as Tab, icon: "₩", label: "Naqd / hisob" },
    { id: "deliverysales" as Tab, icon: "🛵", label: "Delivery" },
  ];
  const salesChannelSwitcher = <nav className="sales-channel-switcher" aria-label="Savdo kanalini tanlash">
    {salesChannelTabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}><i>{item.icon}</i><span>{item.label}</span></button>)}
  </nav>;
  const openDailyClose = (date = today) => {
    setCloseNotice("");
    setCloseForm((current) => current.date === date ? current : { ...current, date, actualByAccount: {}, note: "" });
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "finance");
    url.searchParams.set("date", date);
    url.hash = "daily-close";
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setTab("finance");
    window.setTimeout(() => document.getElementById("daily-close")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const syncProblem = /xato|xatolik|saqlanmadi|internet|ochilmadi|taqiqlangan|qayta oching|amalga oshmadi|tekshiring|eskirgan|noto‘g‘ri/i.test(status);
  const contextualSaveBusy = recipeSaving || stockSaving;
  const contextualSaveDirty = syncProblem
    || (tab === "recipes" && hasUnsavedRecipeDraft())
    || (tab === "inventory" && hasUnsavedStockDraft());
  const contextualSaveLabel = recipeSaving || stockSaving
    ? "Saqlanmoqda…"
    : syncProblem && tab === "recipes" && hasUnsavedRecipeDraft()
      ? "Tannarxni qayta saqlash"
      : syncProblem
        ? "Qayta saqlash"
    : tab === "recipes" && hasUnsavedRecipeDraft()
      ? "Tannarxni saqlash"
      : tab === "inventory" && hasUnsavedStockDraft()
        ? "Mahsulotni saqlash"
        : "Saqlangan";
  const saveCurrentView = () => {
    if (tab === "recipes" && hasUnsavedRecipeDraft()) {
      void addRecipe();
      return;
    }
    if (tab === "inventory" && hasUnsavedStockDraft()) {
      void addInventory();
      return;
    }
    void saveQueueRef.current.then((saved) => {
      if (saved) setStatus("✓ Barcha ma’lumotlar saqlangan");
    });
  };
  const retryFailedSave = () => {
    if (tab === "recipes" && hasUnsavedRecipeDraft()) {
      void addRecipe();
      return;
    }
    if (tab === "inventory" && hasUnsavedStockDraft()) {
      void addInventory();
      return;
    }
    const failed = failedSaveRef.current;
    if (failed && failed.branchId === activeBranchRef.current) {
      void enqueueStatePatch(failed.patch, `${failed.action} · qayta urinish`);
      return;
    }
    window.location.reload();
  };
  const editingMovement = data.stockMovements.find((entry) => entry.id === editingMovementId);
  const movementInventoryItem = data.inventory.find((entry) => entry.id === movementForm.inventoryId);
  const movementUnitsPerPackage = movementInventoryItem?.unitsPerPackage || 1;
  const movementPackageName = movementInventoryItem?.packageName || "birlik";
  const stockPackagePreview = calculatePackagedInventory(
    stockForm.packageCount,
    stockForm.unitsPerPackage,
    stockForm.packageCost,
  );
  const editingTransaction = data.transactions.find((entry) => entry.id === editingTransactionId);

  if (adminAccess !== "authorized") {
    return (
      <main className="admin-gate">
        <section className="admin-gate-card">
          <div className="admin-gate-logo">H</div>
          <span>HALO CONTROL · RAHBAR</span>
          <h1>{adminAccess === "checking" ? "Tekshirilmoqda…" : adminAccess === "denied" ? "Rahbar kirishi kerak" : "Aloqa xatosi"}</h1>
          <p>{adminAccess === "denied"
            ? "Xodimlar bu sahifadan foydalana olmaydi. Rahbar akkauntingiz bilan xavfsiz kiring."
            : adminAccess === "error"
              ? "Internet yoki ma’lumotlar bazasi bilan aloqa bo‘lmadi. Qayta urinib ko‘ring."
              : "Rahbar ruxsati tekshirilmoqda."}</p>
          {adminAccess === "denied" && <a className="admin-gate-primary" href="/signin-with-chatgpt?return_to=%2F">Rahbar sifatida kirish</a>}
          {adminAccess === "error" && <button className="admin-gate-primary" onClick={() => window.location.reload()}>Qayta tekshirish</button>}
          <a className="admin-gate-worker" href="/xodim">HALO Xodim dasturiga o‘tish →</a>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell mode-${userMode}`}>
      {userMode === "owner" && <RecordRemovalDialog key={activeBranchId} branchId={activeBranchId} target={removalTarget} onClose={()=>setRemovalTarget(null)} onBeforeRemove={async()=>{if(!await saveQueueRef.current||failedSaveRef.current)throw new Error("Avval saqlanmay qolgan amalni saqlang.");}} onRemoved={async()=>{await reloadAuthoritativeState(activeBranchRef.current);}}/>}
      <aside className="sidebar">
        <div className="logo"><span>H</span><div><strong>HALO</strong><small>CONTROL</small></div></div>
        <nav className="primary-nav" aria-label="Asosiy bo‘limlar"><span className="sidebar-group-title">ASOSIY</span>{visiblePrimaryNav.map((item) => <button key={item.id} className={`${tab === item.id ? "active " : ""}nav-${item.id}`} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}><i>{item.icon}</i>{item.label}</button>)}</nav>
        {userMode === "owner" && <details className={`more-nav${moreNavActive ? " active" : ""}`}>
          <summary aria-label="Yana bo‘limlarini ochish" aria-current={moreNavActive ? "page" : undefined}><i>•••</i><span>Yana</span><b>⌄</b></summary>
          <div>{moreNavGroups.map((group) => <section className="more-nav-group" key={group.label}><strong>{group.label}</strong>{group.items.map((item) => <button type="button" key={item.id} className={`more-nav-item${tab === item.id ? " active" : ""}`} aria-current={tab === item.id ? "page" : undefined} onClick={(event) => { setTab(item.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}><i>{item.icon}</i><span>{item.label}</span></button>)}</section>)}
            <section className="more-nav-group"><strong>JAMOA</strong><a className="more-nav-item" href="/nazorat"><i>✓</i><span>Kunlik nazorat</span></a><a className="more-nav-item" href="/davomat"><i>◷</i><span>Hodimlar</span></a><a className="more-nav-item" href="/xodim"><i>♙</i><span>Xodim dasturi</span></a></section>
            <section className="more-nav-group"><strong>ALOHIDA OYNALAR</strong><a className="more-nav-item" href="/hisob" target="_blank" rel="noreferrer"><i>₩</i><span>HALO HISOB</span></a><a className="more-nav-item" href={haloMenuUrl} target="_blank" rel="noreferrer"><i>▣</i><span>HALO Menyu</span></a></section>
          </div>
        </details>}
        <div className="sidebar-foot"><span className="online-dot" /> {userMode === "owner" ? "Rahbar rejimi" : "Xodim rejimi"}<small>{status}</small></div>
      </aside>

      <section className="workspace">
        <header><div className="header-title">{tab !== "dashboard" && <button className="section-back" type="button" onClick={() => setTab("dashboard")} aria-label="Bugun sahifasiga qaytish">←</button>}<div><span className="kicker">HALO CONTROL</span><h1>{nav.find((item) => item.id === tab)?.label}</h1><p className="header-help">{tabHelp[tab]}</p></div></div><div className="header-actions"><div className="branch-switcher"><span>FILIAL</span><select value={activeBranchId} onChange={(event) => void switchBranch(event.target.value)} aria-label="Filialni tanlash">{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select><details className="branch-actions"><summary aria-label="Filial sozlamalari">•••</summary><div><button className="rename-branch" type="button" onClick={() => void renameBranch()}>Nomini o‘zgartirish</button><button className="add-branch" type="button" onClick={() => void addBranch()}>Yangi filial qo‘shish</button><button className="delete-branch" type="button" disabled={activeBranchId === "main"} onClick={() => void deleteBranch()}>Filialni o‘chirish</button></div></details></div><span>{displayDate(today)}</span><button className={`save-main${contextualSaveDirty ? " has-draft" : ""}`} disabled={contextualSaveBusy} onClick={syncProblem ? retryFailedSave : saveCurrentView}>{contextualSaveLabel}</button><AppleInstall /><details className="header-more"><summary>Yana ▾</summary><div>{userMode === "owner" && <a className="menu-control-button operations-menu-button" href="/nazorat" aria-label="Kunlik ochilish va yopilish nazoratini ochish"><i>✓</i><b>Kunlik nazorat</b><small>Chek-list va qizil alertlar →</small></a>}{userMode === "owner" && <a className="menu-control-button" href="/davomat" aria-label="Hodimlarning ish vaqti va maosh oynasini ochish"><i>◷</i><b>Hodimlar nazorati</b><small>Ish vaqti va maosh →</small></a>}<a className="worker-control-button" href="/xodim" aria-label="Alohida xodim dasturini ochish"><i>♙</i><b>Xodim dasturi</b><small>ISHNI BOSHLADIM / TUGATDIM →</small></a><a className="menu-control-button" href="/hisob" target="_blank" rel="noreferrer"><i>₩</i><b>HALO HISOB · parolsiz</b><small>Naqd va hisob-raqam savdosi ↗</small></a>{userMode === "owner" && <a className="menu-control-button" href={haloMenuUrl} target="_blank" rel="noreferrer" aria-label="HALO Menyu boshqaruvini yangi oynada ochish"><i>▣</i><b>HALO Menyu</b><small>Boshqaruvni ochish ↗</small></a>}</div></details></div></header>
        {syncProblem && <div className="sync-warning" role="alert"><span><b>Ma’lumot saqlanmadi</b><small>{status}. Kiritilgan ma’lumot o‘chmagan — qayta saqlang.</small></span><button type="button" onClick={retryFailedSave}>{tab === "recipes" && hasUnsavedRecipeDraft() ? "Tannarxni qayta saqlash" : "Qayta saqlash"}</button></div>}
        {tab === "inventory" && <div className="page inventory-accounting-page">
          <nav className="management-shortcuts" aria-label="Ombor amallari">
            {userMode === "owner" && <button type="button" onClick={() => setTab("intake")}><strong>+ Xarid kiritish</strong><small>Mahsulot, miqdor va narx</small></button>}
            {userMode === "owner" && <button type="button" onClick={() => { cancelInventoryEdit(); revealInventorySection("inventory-product-form"); }}><strong>+ Yangi mahsulot</strong><small>Mahsulot nomi va birligi</small></button>}
            <button type="button" onClick={() => revealInventorySection("warehouse-receipts")}><strong>Kirimlarni boshqarish</strong><small>Tahrirlash va bekor qilish</small></button>
            <button type="button" onClick={() => revealInventorySection("inventory-products")}><strong>Mahsulotlar</strong><small>Nomi, narxi va qoldig‘i</small></button>
            <button type="button" onClick={() => revealInventorySection("inventory-history")}><strong>Barcha harakatlar tarixi</strong><small>Kirim, savdo, chiqim va sanoq</small></button>
          </nav>
          {userMode === "owner" && <WarehouseRecordsPanel key={activeBranchId} state={data} onRemove={(id,label)=>setRemovalTarget({kind:"warehouse",id,label})} initialId={warehouseEditingId} onOpened={() => setWarehouseEditingId("")} onNavigate={(next) => setTab(next as Tab)} onNew={() => setTab("intake")} onSave={async (body) => {
            const branch = activeBranchRef.current;
            if (!await saveQueueRef.current || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan amalni saqlang.");
            const response = await fetch(`/api/warehouse-records?branch=${encodeURIComponent(branch)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            const result = await response.json();
            if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || "Kirim saqlanmadi."), {code:result.code});
            await reloadAuthoritativeState(branch);
          }} />}
          <details className="inventory-workflow" id="inventory-counting"><summary><strong>Qoldiqni tekshirish va sanash</strong><span>Amaldagi ombor, sanoq va farqlar</span></summary><div className="inventory-workflow-body">
          <InventoryAccountingPanel key={activeBranchId} branchId={activeBranchId} onReceive={() => setTab(userMode === "owner" ? "intake" : "suppliers")} onBefore={async () => { if (!await saveQueueRef.current || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan amalni saqlang."); }} onSaved={async () => { await reloadAuthoritativeState(activeBranchRef.current); }} />
          </div></details>
        </div>}
        {tab !== "inventory" && ANALYSIS_TABS.includes(tab as AnalysisTab) && <div className="page section-date-page"><SectionDateAnalysis
          title={`${tabSection[tab]} bo‘limi`}
          range={sectionDateRanges[tab as AnalysisTab]}
          referenceDate={today}
          metrics={sectionAnalysisMetrics[tab as AnalysisTab]}
          onChange={(range) => updateSectionDateRange(tab as AnalysisTab, range)}
        /></div>}
        {userMode === "owner" && (["dashboard", "sales", "deliverysales", "cashbank", "reports"] as string[]).includes(tab) && <div className="page sales-channel-overview-page"><SalesChannelSummary state={data} range={tab === "dashboard" ? { start: salesOverviewDate || today, end: salesOverviewDate || today, preset: "custom" } : sectionDateRanges[tab as AnalysisTab]} onDateChange={tab === "dashboard" ? setSalesOverviewDate : undefined} /></div>}

        {tab === "dashboard" && <div className="page">
          <section className="today-command-center" aria-label="Bugungi tezkor boshqaruv">
            <div className="today-command-head"><div><span>BUGUN · TEZKOR BOSHQARUV</span><h3>Asosiy raqamlar va amallar</h3></div><b className={todayClose ? "closed" : "open"}>{todayClose ? `✓ Kassa farqi ${won(todayClose.difference)}` : "KUN YOPILMAGAN"}</b></div>
            <div className="today-command-kpis">
              <article className="accent"><span>Savdo</span><strong>{money(todayRevenue)}</strong><small>{todayItems} ta taom</small></article>
              <article><span>Hisobiy foyda</span><strong className={todayNetProfit >= 0 ? "positive" : "negative"}>{money(todayNetProfit)}</strong><small>Tannarx va xarajatdan keyin</small></article>
              <article><span>Kam qolgan</span><strong className={purchaseItems.length ? "negative" : "positive"}>{purchaseItems.length} tur</strong><small>Ombor nazorati</small></article>
              <article><span>Jami qarz</span><strong>{money(totalSupplierDebt)}</strong><small>Faqat yetkazib beruvchilar</small></article>
              <article><span>Hozir ishda</span><strong>{todayOpenShiftCount} xodim</strong><small>Yopilmagan smenalar</small></article>
            </div>
            <div className="today-command-actions">
              <button type="button" onClick={() => setTab("sales")}><i>↗</i><span><strong>Savdo kiritish</strong><small>POS, naqd yoki delivery</small></span></button>
              <button type="button" onClick={() => setTab("intake")}><i>＋</i><span><strong>Omborga kirim</strong><small>Mahsulot, miqdor va narx</small></span></button>
              <button type="button" onClick={() => setTab("inventory")}><i>▦</i><span><strong>Omborni sanash</strong><small>Mahsulotni tanlang va qoldiqni yozing</small></span></button>
              <button type="button" onClick={() => setTab("suppliers")}><i>₩</i><span><strong>Xarid va qarz</strong><small>Yetkazuvchi, sana va to‘lov</small></span></button>
              <button type="button" onClick={() => setTab("expenses")}><i>−₩</i><span><strong>Xizmat xarajati</strong><small>Ijara, elektr, reklama</small></span></button>
              <button type="button" className={todayClose ? "done" : "primary"} onClick={() => openDailyClose(today)}><i>{todayClose ? "✓" : "₩"}</i><span><strong>{todayClose ? "Kun yopilgan" : "Kunni yopish"}</strong><small>Kassa va hisoblarni solishtirish</small></span></button>
              <button type="button" onClick={() => setTab("vegetables")}><i>◔</i><span><strong>Sabzavot va sous</strong><small>Kirim, taxminiy qoldiq va sarf</small></span></button>
            </div>
          </section>
          {userMode === "owner" && <section className={`finance-shield ${financeShieldCriticalCount ? "danger" : "safe"}`} aria-label="Moliya aniqligi nazorati">
            <div className="finance-shield-head"><span><i>{financeShieldCriticalCount ? "!" : "✓"}</i><b>MOLIYA QALQONI</b><small>Qarz tarixi, pul yozuvlari va kassa solishtiriladi</small></span><strong>{financeShieldCriticalCount ? `${financeShieldCriticalCount} TA MUAMMO` : "HISOB MOS ✓"}</strong></div>
            <div className="finance-shield-grid">
              <button type="button" className={supplierBalanceProblems.length ? "problem" : "ok"} onClick={() => setTab("suppliers")}><span>Jami yetkazuvchi qarzi</span><b>{won(totalSupplierDebt)}</b><small>{supplierBalanceProblems.length ? `${supplierBalanceProblems.length} ta hisobni tekshirish kerak` : `${supplierDebtAccountCount} ta ochiq hisob · hisob to‘g‘ri`}</small></button>
              <button type="button" className={cashLedgerProblemCount ? "problem" : "ok"} onClick={() => setTab("finance")}><span>Pul va qarz yozuvlari</span><b>{cashLedgerProblemCount ? `${cashLedgerProblemCount} ta xato` : "Aniq summa ✓"}</b><small>Faqat haqiqiy kirim, to‘lov va kassa tekshiriladi</small></button>
              <button type="button" className={cashDifference === null ? "waiting" : cashDifference === 0 ? "ok" : "problem"} onClick={() => openDailyClose(today)}><span>Bugungi kassa</span><b>{cashDifference === null ? "Yopilmagan" : cashDifference === 0 ? "₩0 farq" : `${won(cashDifference)} farq`}</b><small>Haqiqiy pul bilan tizim solishtiriladi</small></button>
              <button type="button" className={incompleteRecipeCount ? "waiting" : "ok"} onClick={() => setTab("recipes")}><span>Taom tannarxi</span><b>{incompleteRecipeCount ? `${incompleteRecipeCount} ta to‘liq emas` : "To‘liq ✓"}</b><small>Retsept to‘liqligi tekshirildi; eski savdo tannarxini ham tekshiring</small></button>
            </div>
            <p><b>Hisoblar alohida:</b> mahsulot → <button type="button" onClick={() => setTab("intake")}>Ombor kirimi</button>; sous va sabzavot → <button type="button" onClick={() => setTab("vegetables")}>Alohida zaxira</button>; xarid qarzi va to‘lov → <button type="button" onClick={() => setTab("suppliers")}>Yetkazib beruvchilar</button>.</p>
          </section>}
          {userMode === "owner" && <BusinessAuditPanel audit={businessAudit} onOpen={setTab} />}
          <section className={`management-autopilot ${nextDailyTask ? "attention" : "ready"}`}>
            <div className="autopilot-status"><span><i>{nextDailyTask ? "!" : "✓"}</i><small>BOSHQARUV AUTOPILOTI</small><strong>{nextDailyTask ? `${pendingDailyTasks.length} ta e’tibor kerak` : "Bugungi ishlar joyida"}</strong></span><b>{dailyTasks.length - pendingDailyTasks.length}/{dailyTasks.length}</b></div>
            {nextDailyTask ? <button type="button" className="autopilot-next" onClick={() => setTab(nextDailyTask.tab)}><span><small>HOZIR FAQAT SHUNI QILING</small><strong>{nextDailyTask.title.replace(/^\d+ · /, "")}</strong><em>{nextDailyTask.detail}</em></span><b>OCHISH →</b></button> : <div className="autopilot-all-clear"><strong>Qo‘shimcha majburiy amal yo‘q</strong><small>Tizimda qaror talab qiladigan muammo aniqlanmadi.</small></div>}
            <div className="autopilot-footer"><span>Qolgan oddiy hisoblarni tizim o‘zi yuritadi.</span>{userMode === "owner" && <a href="/nazorat">Barcha nazoratlar →</a>}</div>
          </section>
          {userMode === "owner" && <section className="owner-grid">
            <article className="panel purchase-panel"><div className="panel-head"><div><span>AVTOMATIK XARID RO‘YXATI</span><h3>Bugun nima olish kerak?</h3></div>{purchaseItems.length > 0 && <button onClick={() => openTelegram(purchaseMessage)}>Telegramga yuborish ↗</button>}</div>
              {purchaseItems.length ? <div className="purchase-groups">
                {purchaseGroups.map((group) => <div key={group.supplier.id}><div className="purchase-supplier"><span><strong>{group.supplier.name}</strong><small>{group.supplier.phone}</small></span><b>{group.items.length} tur</b></div>{group.items.map((item) => <p key={item.id}><span>{item.name}<small>{item.daysLeft === null ? "Savdo tarixi yetarli emas" : `Taxminan ${Math.max(0, item.daysLeft).toFixed(1)} kunlik qoldi`}</small></span><strong>＋ {Math.ceil(item.buyQuantity).toLocaleString()} {item.unit}</strong></p>)}</div>)}
                {unassignedPurchases.length > 0 && <div><div className="purchase-supplier"><span><strong>Yetkazib beruvchi belgilanmagan</strong><small>Omborda yetkazib beruvchini tanlang</small></span></div>{unassignedPurchases.map((item) => <p key={item.id}><span>{item.name}</span><strong>＋ {Math.ceil(item.buyQuantity).toLocaleString()} {item.unit}</strong></p>)}</div>}
              </div> : <p className="all-good">✓ Hozircha xarid qilish shart emas.</p>}
            </article>
            <article className="panel report-panel"><div className="panel-head"><div><span>KUN YAKUNI</span><h3>Bugungi qisqa hisobot</h3></div><button onClick={() => openTelegram(dailyReportMessage)}>Telegramga yuborish ↗</button></div>
              <div className="report-lines"><p><span>Jami savdo</span><strong>{won(todayRevenue)}</strong></p><p><span>Retsept tannarxi</span><strong>{won(todayCost)}</strong></p><p><span>Jami xarajatlar</span><strong className="negative">{won(todayTotalExpenses)}</strong></p><p><span>Haqiqiy hisobiy foyda</span><strong className={todayNetProfit >= 0 ? "positive" : "negative"}>{won(todayNetProfit)}</strong></p><p><span>Sotilgan taom</span><strong>{todayItems} ta</strong></p><p><span>Kam qolgan</span><strong className={purchaseItems.length ? "negative" : "positive"}>{purchaseItems.length} ta</strong></p></div>
            </article>
          </section>}
          {userMode === "owner" && <section className="week-panel">
            <div className="section-title"><div><span>HAFTALIK SOLISHTIRISH</span><h3>Bu hafta va o‘tgan hafta</h3></div><b className={weekChange >= 0 ? "positive" : "negative"}>{weekChange >= 0 ? "↑" : "↓"} {Math.abs(weekChange).toFixed(1)}%</b></div>
            <div className="week-cards"><article><span>Savdo</span><strong>{won(currentWeek.revenue)}</strong><small>Oldingi hafta: {won(previousWeek.revenue)}</small></article><article><span>Yalpi foyda</span><strong>{won(currentWeek.profit)}</strong><small>Oldingi hafta: {won(previousWeek.profit)}</small></article><article><span>Sotilgan taom</span><strong>{currentWeek.items} ta</strong><small>Oldingi hafta: {previousWeek.items} ta</small></article></div>
          </section>}
          <section className={`dashboard-grid ${userMode === "owner" ? "three-panels" : ""}`}>
            <article className="panel"><div className="panel-head"><div><span>OMBOR OGOHLANTIRISHI</span><h3>Kam qolgan mahsulotlar</h3></div><button onClick={() => setTab("inventory")}>Barchasi →</button></div>
              <div className="stock-alerts">{lowStock.length ? lowStock.map((item) => <div key={item.id}><span className="stock-icon">!</span><div><strong>{item.name}</strong><small>Minimum: {item.minStock.toLocaleString()} {item.unit}</small></div><b>{item.stock.toLocaleString()} {item.unit}</b></div>) : <p className="empty">Barcha mahsulotlar yetarli.</p>}</div>
            </article>
            <article className="panel"><div className="panel-head"><div><span>BUGUNGI SAVDO</span><h3>Oxirgi sotuvlar</h3></div><button onClick={() => setTab("sales")}>Savdo →</button></div>
              <div className="recent-sales">{todaySales.length ? todaySales.slice(0, 5).map((sale) => <div key={sale.id}><div><strong>{recipeName(sale.recipeId)}</strong><small>{sale.quantity} ta · {saleChannelLabel(sale)}</small></div><b>{userMode === "owner" ? won(sale.totalRevenue - sale.totalCost) : "Yozildi ✓"}</b></div>) : <p className="empty">Bugungi savdo hali kiritilmagan.</p>}</div>
            </article>
            {userMode === "owner" && <article className="panel"><div className="panel-head"><div><span>MARJA TAHLILI</span><h3>Taomlar rentabelligi</h3></div></div>
              <div className="margin-list">{sellableRecipes.map((recipe) => { const audit = recipeMarginAudit(recipe); const margin = audit.marginPercent; return <div key={recipe.id}><div><strong>{recipe.name}</strong><small>{audit.complete ? `${won(audit.totalCost)} tannarx` : audit.status}</small></div><span>{margin === null ? "TEKSHIRING" : `${margin.toFixed(1)}%`}</span><i style={{ width: `${Math.max(0, Math.min(100, margin ?? 0))}%` }} /></div>; })}{!sellableRecipes.length && <p className="empty">Hisoblanadigan faol taom yo‘q.</p>}</div>
            </article>}
          </section>
        </div>}

        {userMode === "owner" && ["reports", "suppliers"].includes(tab) && <ReportExportPanel key={activeBranchId} branchId={activeBranchId} onBefore={async () => { if (!await saveQueueRef.current || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan amalni saqlang."); }} />}
        {tab === "vegetables" && userMode === "owner" && <VegetableExpensesPanel key={activeBranchId} branchId={activeBranchId} onSaved={() => reloadAuthoritativeState(activeBranchId)} onIntegrations={() => setTab("integrations")} />}
        {tab === "inventory" && <div className="page inventory-simple-tools">
          <section className="panel"><div className="panel-head"><div><h3>Sabzavot va souslar</h3><p>Omborsiz mahsulotlar xarid summasi bilan alohida yuritiladi. Eski ombor tarixi saqlangan.</p></div><button type="button" onClick={() => setTab("vegetables")}>Sabzavot va sous sarfi →</button></div></section>
          <details className="inventory-workflow" id="inventory-receive">
            <summary><strong>Qo‘shimcha ombor amallari</strong><span>Chiqim va eski oddiy kirim shakli</span></summary>
            <div className="inventory-workflow-body">
          <section className={`form-card movement-card ${editingMovementId ? "editing" : ""}`} id="stock-movement-form"><div className="form-card-head"><div><span>{editingMovementId ? "OMBOR YOZUVINI TAHRIRLASH" : "OMBOR HARAKATI"}</span><h3>{editingMovementId ? "Saqlangan yozuvni tuzatish" : movementForm.type === "receipt" ? "Kelgan mahsulotni kiriting" : "Ombor chiqimini kiriting"}</h3></div><small>{editingMovementId ? "Eski miqdor qoldiqdan qaytarilib, yangi miqdor avtomatik hisoblanadi." : "Savdo chiqimi avtomatik yoziladi"}</small></div>
            <div className="form-grid movement-form">
              <select aria-label="Ombor mahsuloti" value={movementForm.inventoryId} onChange={(e) => { const selectedItem = data.inventory.find((item) => item.id === e.target.value); setMovementForm({ ...movementForm, inventoryId: e.target.value, quantity: 0, unitCost: selectedItem?.unitCost || 0, supplierId: movementForm.type === "receipt" ? selectedItem?.supplierId || movementForm.supplierId : movementForm.supplierId }); }}><option value="">Mahsulotni tanlang</option>{inventoryCategories.map((category) => <optgroup label={category.name} key={category.id}>{data.inventory.filter((item) => item.categoryId === category.id && !item.catalogArchived && !isExpenseOnlyInventory(item)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.stock.toLocaleString()} {item.unit} · 1 {item.packageName} = {item.unitsPerPackage.toLocaleString()} {item.unit}</option>)}</optgroup>)}</select>
              <select value={movementForm.type} onChange={(e) => setMovementForm({ ...movementForm, type: e.target.value as "receipt" | "waste" | "adjustment" })}><option value="receipt">Kirim (+)</option><option value="waste">Yo‘qotish (−)</option><option value="adjustment">Tuzatish (+/−)</option></select>
              {movementForm.type === "receipt" ? <label><span>Kelgan {movementPackageName} soni</span><input aria-label={`Kelgan ${movementPackageName} soni`} type="number" inputMode="decimal" min="0" step="any" placeholder="1" value={movementForm.quantity ? movementForm.quantity / movementUnitsPerPackage : ""} onChange={(e) => setMovementForm({ ...movementForm, quantity: Number(e.target.value) * movementUnitsPerPackage })} /></label> : <input type="number" step="any" placeholder={movementForm.type === "adjustment" ? `+ yoki − miqdor (${movementInventoryItem?.unit || "birlik"})` : `Miqdor (${movementInventoryItem?.unit || "birlik"})`} value={movementForm.quantity || ""} onChange={(e) => setMovementForm({ ...movementForm, quantity: Number(e.target.value) })} />}
              {userMode === "owner" && movementForm.type === "receipt" && <label><span>1 {movementPackageName} narxi</span><div className="recipe-money-input"><b>₩</b><input aria-label={`1 ${movementPackageName} narxi`} type="number" inputMode="numeric" min="0" step="any" placeholder="0" value={movementForm.unitCost ? movementForm.unitCost * movementUnitsPerPackage : ""} onChange={(e) => setMovementForm({ ...movementForm, unitCost: Number(e.target.value) / movementUnitsPerPackage })} /></div></label>}
              {movementForm.type === "receipt" && <select aria-label="Yetkazib beruvchi" value={movementForm.supplierId} onChange={(e) => setMovementForm({ ...movementForm, supplierId: e.target.value })}><option value="">Yetkazib beruvchi</option>{data.suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select>}
              <input type="date" value={movementForm.date} onChange={(e) => setMovementForm({ ...movementForm, date: e.target.value })} />
              <input placeholder="Izoh" value={movementForm.note} onChange={(e) => setMovementForm({ ...movementForm, note: e.target.value })} />
              <button type="button" disabled={movementSaving} onClick={() => void addStockMovement()}>{movementSaving ? "Saqlanmoqda…" : editingMovementId ? "O‘zgarishni saqlash" : "Saqlash"}</button>
            </div>
            {movementForm.type === "receipt" && movementInventoryItem && <div className="movement-package-equation"><strong>1 {movementPackageName} = {movementUnitsPerPackage.toLocaleString()} {movementInventoryItem.unit}</strong><span>{movementForm.quantity ? `${(movementForm.quantity / movementUnitsPerPackage).toLocaleString()} ${movementPackageName} → omborga ${movementForm.quantity.toLocaleString()} ${movementInventoryItem.unit}` : "Kelgan qadoq sonini kiriting"}</span><b>1 {movementInventoryItem.unit} = {won(movementForm.unitCost || movementInventoryItem.unitCost)}</b></div>}
            {movementForm.type === "receipt" && <div className="movement-document-field">
              <label className="movement-document-picker"><span>📎 Nakladnoy rasmi</span><small>JPG, PNG, WebP yoki HEIC · katta rasm avtomatik siqiladi</small><input key={movementFileInputKey} type="file" accept={STOCK_IMAGE_ACCEPT} capture="environment" onChange={chooseMovementDocument} /></label>
              {(movementDocumentPreview || (editingMovement?.document && !removeMovementDocument)) && <div className="movement-document-preview">
                <img src={movementDocumentPreview || `/api/stock-documents?key=${encodeURIComponent(editingMovement?.document?.key || "")}`} alt="Nakladnoy rasmi" />
                <span><b>{movementDocumentFile?.name || editingMovement?.document?.fileName}</b><small>{movementDocumentFile ? "Yangi rasm saqlashga tayyor" : "Avval saqlangan nakladnoy"}</small></span>
                <button type="button" onClick={() => { setMovementDocumentFile(null); setMovementDocumentPreview(""); setRemoveMovementDocument(Boolean(editingMovement?.document)); setMovementFileInputKey((current) => current + 1); }}>Rasmni olib tashlash</button>
              </div>}
            </div>}
            {editingMovementId && <button type="button" className="movement-cancel-edit" disabled={movementSaving} onClick={() => { resetMovementDraft("receipt"); setMovementNotice("Tahrirlash bekor qilindi."); }}>Tahrirlashni bekor qilish</button>}
            {movementNotice && <p role={movementNotice.startsWith("✓") ? "status" : "alert"} aria-live="polite" className={movementNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{movementNotice}</p>}
          </section>
              <button type="button" className="inventory-simple-link" onClick={() => revealInventorySection("inventory-product-form")}>Mahsulot ro‘yxatda yo‘qmi? Yangisini qo‘shish</button>
            </div>
          </details>
          <details className="inventory-workflow" id="inventory-history">
            <summary><strong>Kirim va chiqim tarixi</strong><span>Kimdan, qachon va qancha kelganini ko‘rish</span></summary>
            <div className="inventory-workflow-body">
              {(inventorySearch || inventoryCategoryFilter !== "all") && <button type="button" className="inventory-simple-link" onClick={() => { setInventorySearch(""); setInventoryCategoryFilter("all"); }}>Mahsulot filtrini tozalash — barcha tarixni ko‘rish</button>}
              <SectionDateAnalysis title="Ombor tarixi" range={sectionDateRanges.inventory} referenceDate={today} metrics={sectionAnalysisMetrics.inventory} onChange={(range) => updateSectionDateRange("inventory", range)} />
              {userMode === "owner" && <ReportExportPanel key={activeBranchId} branchId={activeBranchId} onBefore={async () => { if (!await saveQueueRef.current || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan amalni saqlang."); }} />}
          <button type="button" onClick={() => revealInventorySection("warehouse-receipts")}>Mahsulot yoki yetkazib beruvchi bo‘yicha kirimlarni ochish ↑</button>
          <section className="panel table-panel history-panel"><div className="panel-head"><div><span>OMBOR TARIXI</span><h3>{inventorySearch.trim() ? `“${inventorySearch.trim()}” harakatlari` : "Oxirgi harakatlar"}</h3><small>{filteredInventoryRangeMovements.length} ta yozuv · tanlangan davr</small></div><button type="button" onClick={() => updateSectionDateRange("inventory", dateRangeForPreset(today, "7d"))}>Oxirgi 7 kun</button></div>
            <p className="accounting-note">Kirimni yuqoridagi “Kirimlarni boshqarish” oynasidan tahrirlang. Bekor qilinganda asl nusxa tarixda saqlanadi.</p>
            {archivedWarehouseMovementCount > 0 && <p className="form-notice success warehouse-history-archive-note">O‘chirilgan mahsulotlarga tegishli {archivedWarehouseMovementCount.toLocaleString()} ta eski harakat faol Ombor tarixidan chiqarilgan. Mahsulot “Bekor qilinganlar”dan tiklansa, uning tarixi ham qaytadi.</p>}
            <div className="data-table"><div className="table-row movement head"><span>Sana</span><span>Mahsulot</span><span>Turi</span><span>Miqdor</span><span>Yetkazuvchi / hujjat / amal</span></div>
              {filteredInventoryRangeMovements.slice(0, stockHistoryLimit).map((movement) => { const item = data.inventory.find((entry) => entry.id === movement.inventoryId); const purchase = receiptDisplay(movement, item); const actionName = movement.type === "receipt" ? "Kirimni" : movement.type === "waste" ? "Chiqimni" : "Tuzatishni"; return <div className={`table-row movement ${editingMovementId === movement.id ? "active-edit" : ""}`} key={movement.id}><span data-label="Sana">{displayDate(movement.date)}</span><strong data-label="Mahsulot">{inventoryName(movement.inventoryId)}</strong><b data-label="Turi" className={`movement-${movement.type}`}>{(movement.type === "sale" && movement.quantity === 0 && Number(movement.theoreticalQuantity) > 0) ? "Nazariy sarf" : movementLabel(movement.type)}</b><strong data-label="Miqdor" className={movement.quantity >= 0 ? "positive" : "negative"}>{(movement.type === "sale" && movement.quantity === 0 && Number(movement.theoreticalQuantity) > 0) ? `−${Number(movement.theoreticalQuantity || 0).toLocaleString()}` : movement.type === "receipt" ? `+${purchase.quantity.toLocaleString()}` : `${movement.quantity > 0 ? "+" : ""}${movement.quantity.toLocaleString()}`} {movement.type === "receipt" ? purchase.unit : item?.unit ?? ""}{(movement.type === "sale" && movement.quantity === 0 && Number(movement.theoreticalQuantity) > 0) && <small>Ombordan ayirilmagan</small>}</strong><span className="movement-history-detail"><span><b>{movement.supplierId ? supplierName(movement.supplierId) : movement.note || "—"}</b>{movement.supplierId && movement.note && <small>{movement.note}</small>}{movement.type === "receipt" ? <small>{purchase.amount === null ? "Narx yo‘q" : `${won(purchase.amount)} jami`}</small> : Number(movement.unitCost) > 0 && <small>{won(Number(movement.unitCost))} / {item?.unit || "birlik"}</small>}</span><span className="movement-row-actions">{movement.document && <a href={`/api/stock-documents?key=${encodeURIComponent(movement.document.key)}`} target="_blank" rel="noreferrer">📎 Nakladnoy</a>}{movement.type === "receipt" && userMode === "owner" ? <button type="button" onClick={() => { setWarehouseEditingId(movement.id); revealInventorySection("warehouse-receipts"); }}>Kirim hujjatini boshqarish →</button> : isWorkerDeliveryMovement(movement) ? <span className="transaction-linked-badge">🔒 Xodim kirimiga bog‘langan</span> : isPurchaseOrderMovement(movement) ? <button type="button" className="movement-source-button" onClick={() => setTab("control")}>🔒 Buyurtmadan boshqarish</button> : movement.type === "sale" ? <span className="transaction-linked-badge">Savdodan boshqariladi</span> : movement.referenceId ? <span className="transaction-linked-badge">🔒 Sanash yoki boshqa manbaga bog‘langan</span> : userMode === "owner" ? <><button type="button" className="movement-edit-button" aria-label={`${inventoryName(movement.inventoryId)} ${actionName.toLocaleLowerCase()} tahrirlash`} onClick={() => editStockMovement(movement)} disabled={movementDeletionBusy === movement.id}>{actionName} tahrirlash</button></> : <span className="transaction-linked-badge">Faqat ko‘rish</span>}{userMode === "owner" && <button type="button" className="archive-delete remove-record" onClick={()=>setRemovalTarget({kind:"stockMovement",id:movement.id,label:`${inventoryName(movement.inventoryId)} · ${displayDate(movement.date)}`})}>Olib tashlash</button>}</span></span></div>; })}
              {!filteredInventoryRangeMovements.length && <div className="table-empty">Tanlangan davr va qidiruv bo‘yicha Ombor harakati yo‘q.</div>}
            </div>
            {filteredInventoryRangeMovements.length > stockHistoryLimit && <button type="button" className="stock-history-more" onClick={() => setStockHistoryLimit((current) => current + 80)}>Yana 80 ta tarixni ko‘rsatish</button>}
          </section>
            </div>
          </details>
          <details className="inventory-workflow" id="inventory-products">
            <summary><strong>Barcha mahsulotlar</strong><span>Qoldiqlarni ko‘rish yoki mahsulotni tahrirlash</span></summary>
            <div className="inventory-workflow-body">
          <section className="category-panel" aria-label="Ombor kategoriyalari">
            <div><span>KATEGORIYALAR</span><h3>Xomashyolarni tez toping</h3><small>Har bir filialning kategoriyalari alohida saqlanadi.</small></div>
            <div className="category-chips">
              <button className={inventoryCategoryFilter === "all" ? "active" : ""} type="button" onClick={() => setInventoryCategoryFilter("all")}>Hammasi <b>{stockForecast.length}</b></button>
              {inventoryCategories.map((category) => <button className={inventoryCategoryFilter === category.id ? "active" : ""} type="button" onClick={() => setInventoryCategoryFilter(category.id)} key={category.id}>{category.name} <b>{stockForecast.filter((item) => item.categoryId === category.id).length}</b></button>)}
            </div>
            <div className="inventory-browser" aria-label="Ombor mahsulotlarini qidirish va saralash">
              <label><span>Mahsulotni tez topish</span><input type="search" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Mahsulot nomini yozing…" aria-label="Ombor mahsulotini nomi bo‘yicha qidirish" /></label>
              <div className="inventory-status-filters" role="group" aria-label="Ombor qoldiq holati"><button type="button" className={inventoryStockFilter === "all" ? "active" : ""} onClick={() => setInventoryStockFilter("all")}>Hammasi <b>{stockForecast.length}</b></button><button type="button" className={inventoryStockFilter === "low" ? "active low" : ""} onClick={() => setInventoryStockFilter("low")}>Kam qolgan <b>{lowStockCount}</b></button><button type="button" className={inventoryStockFilter === "ready" ? "active" : ""} onClick={() => setInventoryStockFilter("ready")}>Yetarli <b>{Math.max(0, stockForecast.length - lowStockCount)}</b></button></div>
              {(inventorySearch || inventoryStockFilter !== "all") && <button type="button" className="inventory-filter-reset" onClick={() => { setInventorySearch(""); setInventoryStockFilter("all"); }}>Filtrni tozalash</button>}
            </div>
            {userMode === "owner" && <div className="category-actions"><button type="button" onClick={() => void addProductCategory("inventory")}>＋ Yangi kategoriya</button><button type="button" disabled={inventoryCategoryFilter === "all"} onClick={() => void renameProductCategory("inventory", inventoryCategoryFilter)}>Nomini o‘zgartirish</button><button className="danger" type="button" disabled={inventoryCategoryFilter === "all" || inventoryCategoryFilter === INVENTORY_FALLBACK_CATEGORY_ID} onClick={() => void deleteProductCategory("inventory", inventoryCategoryFilter)}>Kategoriyani savatga</button></div>}
          </section>
          {userMode === "owner" && <><InventoryArchiveDialog item={inventoryArchiveTarget} recipes={inventoryArchiveTarget ? data.recipes.filter(r=>r.ingredients.some(i=>i.inventoryId===inventoryArchiveTarget.id)).map(r=>r.name) : []} onClose={()=>setInventoryArchiveTarget(null)} onConfirm={async reason=>{if(inventoryArchiveTarget)await deleteInventoryItem(inventoryArchiveTarget,reason);}} />
          {stockNotice&&<p className="form-notice" role="status">{stockNotice}</p>}
          <details className="inventory-workflow" id="inventory-archived-products"><summary><strong>Olib tashlangan mahsulotlar</strong><span>{data.inventory.filter(i=>i.catalogArchived).length} ta · tarix va qoldiq saqlangan</span></summary><div className="inventory-workflow-body">{data.inventory.filter(i=>i.catalogArchived).map(item=><article key={item.id} className="warehouse-document"><div className="warehouse-document-title"><span><b>{item.name}</b><small>{item.catalogArchiveReason} · qoldiq {item.stock.toLocaleString()} {item.unit}</small></span><button type="button" disabled={Boolean(inventoryDeletionBusy)} onClick={()=>void restoreInventoryProduct(item.id)}>Tiklash</button></div></article>)}{!data.inventory.some(i=>i.catalogArchived)&&<p>Olib tashlangan mahsulot yo‘q. Eski usulda o‘chirilgan mahsulotlar “Bekor qilinganlar” bo‘limida.</p>}</div></details></>}
          <section className="panel table-panel"><div className="panel-head"><div><span>OMBOR QOLDIG‘I</span><h3>Ombordagi mahsulotlar</h3><small>{filteredStockForecast.length} ta ko‘rsatildi · kam qolganlar tepada</small></div></div>
            <div className="inventory-overview"><article><span>Jami mahsulot</span><strong>{stockForecast.length} tur</strong></article><article className={lowStockCount ? "warning" : "good"}><span>Kam qolgan</span><strong>{lowStockCount} tur</strong></article><article><span>Ombor qiymati</span><strong>{money(inventoryTotalValue)}</strong></article></div>
            {userMode === "owner" ? <div className="data-table inventory-owner-table"><div className="table-row inventory-row head"><span>Mahsulot</span><span>Qoldiq</span><span>Minimum</span><span>Kun qoldi</span><span>Birlik narxi</span><span>Qiymati</span><span>Holat / amallar</span></div>
              {filteredStockForecast.map((item) => <div className="table-row inventory-row" key={item.id}><strong><small className="category-badge">{categoryName(item.categoryId, "inventory")}</small>{item.name}<small className="inventory-accounting-badge">{isExpenseOnlyInventory(item) ? "Omborsiz (xarajat)" : "Oddiy · har sotuvda kamayadi"}</small><small className="inventory-package-note">1 {item.packageName} = {item.unitsPerPackage.toLocaleString()} {item.unit} · {won(item.packageCost)}{item.gramsPerUnit > 0 ? ` · 1 dona = ${item.gramsPerUnit.toLocaleString()} g` : ""}</small></strong><span data-label="Qoldiq">{item.stock.toLocaleString()} {item.unit}</span><span data-label="Minimum">{item.minStock.toLocaleString()} {item.unit}</span><span data-label="Kun qoldi">{item.daysLeft === null ? "—" : `${Math.max(0, item.daysLeft).toFixed(1)} kun`}</span><span data-label="Birlik narxi">{won(item.unitCost)} / {item.unit}</span><span data-label="Ombor qiymati">{won(item.stock * item.unitCost)}</span><span className="row-actions-inline inventory-row-actions"><b className={item.stock <= item.minStock ? "low" : "good"}>{item.stock <= item.minStock ? "Olish kerak" : "Yetarli"}</b><button type="button" className="movement-edit-button" aria-label={`${item.name} mahsulotini tahrirlash`} onClick={() => editInventoryItem(item)} disabled={inventoryDeletionBusy === item.id}>Mahsulotni tahrirlash</button><button type="button" className="archive-delete" aria-label={`${item.name} mahsulotini o‘chirish`} onClick={() => setInventoryArchiveTarget(item)} disabled={Boolean(inventoryDeletionBusy)}>{inventoryDeletionBusy === item.id ? "O‘chirilmoqda…" : "Mahsulotni o‘chirish"}</button></span></div>)}
              {!filteredStockForecast.length && <div className="table-empty">Qidiruv yoki tanlangan filtr bo‘yicha mahsulot topilmadi.</div>}
            </div> : <div className="employee-stock-list">{filteredStockForecast.map((item) => <article key={item.id} className={item.stock <= item.minStock ? "low" : ""}><span><strong>{item.name}</strong><small>{categoryName(item.categoryId, "inventory")} · Minimum: {item.minStock.toLocaleString()} {item.unit}</small></span><b>{item.stock.toLocaleString()} {item.unit}</b></article>)}
            </div>
            }
          </section>
              <button type="button" className="inventory-simple-link" onClick={() => revealInventorySection("inventory-product-form")}>+ Yangi mahsulot qo‘shish</button>
              <details className="inventory-product-settings"><summary>Mahsulot qo‘shish va tahrirlash</summary>
          {userMode === "owner" && <section className={`form-card inventory-product-form ${editingInventoryId ? "editing" : ""}`} id="inventory-product-form"><div className="form-card-head"><div><span>MAHSULOT MA’LUMOTI</span><h3>{editingInventoryId ? "Mahsulot ma’lumotini tahrirlash" : "Yangi ombor mahsuloti qo‘shish"}</h3></div><small>{editingInventoryId ? "Mavjud qoldiq o‘zgarmaydi; miqdorni Ombor tarixidagi kirimdan tahrirlang." : "Qadoq narxi ichidagi dona, gramm yoki millilitrga avtomatik bo‘linadi."}</small></div><div className="form-grid inventory-create">
            <label className="wide"><span>Mahsulot nomi</span><input placeholder="Masalan: Sosiska" value={stockForm.name} onChange={(e) => setStockForm({ ...stockForm, name: e.target.value })} /></label>
            <label><span>Kategoriya</span><select aria-label="Ombor mahsuloti kategoriyasi" value={stockForm.categoryId} onChange={(e) => setStockForm({ ...stockForm, categoryId: e.target.value })}>{inventoryCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
            <div><span>Hisoblash: {isExpenseOnlyInventory(data.inventory.find(item => item.id === editingInventoryId)) ? "Omborsiz (xarajat)" : "Oddiy — sotuvda ayiriladi"}</span><button type="button" onClick={() => setTab("vegetables")}>Omborsiz belgisini boshqarish</button></div>
            <label><span>Retseptda hisob birligi</span><select aria-label="Retsept hisob birligi" disabled={Boolean(editingInventoryId)} value={stockForm.unit} onChange={(e) => setStockForm({ ...stockForm, unit: e.target.value, gramsPerUnit: e.target.value === "dona" ? stockForm.gramsPerUnit : 0 })}><option>g</option><option>kg</option><option>ml</option><option>litr</option><option>dona</option></select></label>
            <label><span>Qadoq turi</span><select aria-label="Qadoq turi" value={stockForm.packageName} onChange={(e) => setStockForm({ ...stockForm, packageName: e.target.value })}><option value="dona">DONA</option><option value="kalla">KALLA</option><option value="pachka">PACHKA</option><option value="BOX">BOX</option><option value="QADOQ">QADOQ</option><option value="DONA">DONA</option><option value="quti">QUTI</option><option value="qop">QOP</option><option value="butilka">BUTILKA</option><option value="banka">BANKA</option><option value="blok">BLOK</option><option value="birlik">BIRLIK</option></select></label>
            {!editingInventoryId && <label><span>Boshlang‘ich qoldiq · qadoq soni</span><input type="number" inputMode="decimal" min="0" step="any" placeholder="1" value={stockForm.packageCount || ""} onChange={(e) => setStockForm({ ...stockForm, packageCount: Number(e.target.value) })} /></label>}
            {!editingInventoryId && <><label><span>Boshlang‘ich qoldiq sanasi</span><input type="date" value={stockForm.date || today} onChange={e=>setStockForm({...stockForm,date:e.target.value})}/></label><p className="wide accounting-note">Bu — mahsulot kartasi va boshlang‘ich qoldiq. To‘lov yoki yetkazuvchi qarzi yaratilmaydi. Yangi xarid uchun kartani 0 qoldiq bilan saqlang, so‘ng «+ Xarid kiritish»da miqdor, summa va to‘lovni yozing.</p></>}
            <label><span>1 qadoq ichidagi miqdor</span><div className="inventory-number-unit"><input type="number" inputMode="decimal" min="0" step="any" placeholder="10" value={stockForm.unitsPerPackage || ""} onChange={(e) => setStockForm({ ...stockForm, unitsPerPackage: Number(e.target.value) })} /><b>{stockForm.unit}</b></div></label>
            {stockForm.unit === "dona" && <label><span>1 dona mahsulot vazni</span><div className="inventory-number-unit"><input aria-label="Bir dona mahsulot vazni grammda" type="number" inputMode="decimal" min="0" step="any" placeholder="Masalan: 50" value={stockForm.gramsPerUnit || ""} onChange={(e) => setStockForm({ ...stockForm, gramsPerUnit: Number(e.target.value) })} /><b>g</b></div></label>}
            <label><span>1 qadoq xarid narxi</span><div className="recipe-money-input"><b>₩</b><input type="number" inputMode="numeric" min="0" step="any" placeholder="6500" value={stockForm.packageCost || ""} onChange={(e) => setStockForm({ ...stockForm, packageCost: Number(e.target.value) })} /></div></label>
            <label><span>Minimum qoldiq ({stockForm.unit})</span><input type="number" inputMode="decimal" min="0" step="any" placeholder="0" value={stockForm.minStock || ""} onChange={(e) => setStockForm({ ...stockForm, minStock: Number(e.target.value) })} /></label>
            <label><span>Yetkazib beruvchi</span><select value={stockForm.supplierId} onChange={(e) => setStockForm({ ...stockForm, supplierId: e.target.value })}><option value="">Tanlanmagan</option>{data.suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
            <div className="inventory-package-preview"><span>AVTOMATIK HISOB</span><strong>1 {stockForm.packageName.trim() || "qadoq"} = {stockForm.unitsPerPackage.toLocaleString()} {stockForm.unit}{stockForm.gramsPerUnit > 0 ? ` · 1 dona = ${stockForm.gramsPerUnit.toLocaleString()} g` : ""}</strong><b>{won(stockForm.packageCost)} ÷ {stockForm.unitsPerPackage || 0} = {won(stockPackagePreview.unitCost)} / {stockForm.unit}</b>{editingInventoryId ? <small>Mavjud ombor qoldig‘i o‘zgarmaydi.</small> : <small>{stockForm.packageCount || 0} {stockForm.packageName.trim() || "qadoq"} kirsa, omborga {stockPackagePreview.stock.toLocaleString()} {stockForm.unit} qo‘shiladi.</small>}</div>
            <div className="inventory-create-actions"><button type="button" onClick={() => void addInventory()} disabled={stockSaving}>{stockSaving ? "Saqlanmoqda…" : editingInventoryId ? "✓ Mahsulot o‘zgarishini saqlash" : "＋ Mahsulotni qo‘shish"}</button>{editingInventoryId && <button type="button" className="secondary" onClick={cancelInventoryEdit} disabled={stockSaving}>Tahrirlashni bekor qilish</button>}</div>
          </div>{stockNotice && <p role={stockNotice.startsWith("✓") ? "status" : "alert"} aria-live="polite" className={stockNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{stockNotice}</p>}<div className="recipe-jump-card"><div><span>SOTILADIGAN TAOM</span><strong>Endi retseptda Ombordagi mahsulotni tanlang.</strong><small>Masalan: Hotdog → Sosiska 2 dona; tizim qadoq narxidan tannarxni o‘zi hisoblaydi.</small></div><button type="button" onClick={() => setTab("recipes")}>Taom va tannarx yaratish →</button></div></section>}
              </details>
            </div>
          </details>
        </div>}

        {tab === "recipes" && <div className="page">
          <nav className="cost-flow-steps" aria-label="HALO hisoblash bosqichlari">
            <button type="button" className="active" onClick={() => setTab("recipes")}><i>1</i><span><strong>Taom tannarxi</strong><small>Retsept va narx</small></span></button>
            <button type="button" onClick={() => setTab("inventory")}><i>2</i><span><strong>Omborga kirim</strong><small>Qoldiq va narx</small></span></button>
            <button type="button" onClick={() => setTab("sales")}><i>3</i><span><strong>Kunlik chek</strong><small>Savdo va foyda</small></span></button>
          </nav>
          <section className="category-panel" aria-label="Taom kategoriyalari">
            <div><span>KATEGORIYALAR</span><h3>Taomlarni guruhlarga ajrating</h3><small>Chek va savdo tanlovlarida ham shu tartib ko‘rinadi.</small></div>
            <div className="category-chips">
              <button className={recipeCategoryFilter === "all" ? "active" : ""} type="button" onClick={() => setRecipeCategoryFilter("all")}>Hammasi <b>{data.recipes.length}</b></button>
              {recipeCategories.map((category) => <button className={recipeCategoryFilter === category.id ? "active" : ""} type="button" onClick={() => setRecipeCategoryFilter(category.id)} key={category.id}>{category.name} <b>{data.recipes.filter((recipe) => recipe.categoryId === category.id).length}</b></button>)}
            </div>
            <div className="category-actions"><button type="button" onClick={() => void addProductCategory("recipe")}>＋ Yangi kategoriya</button><button type="button" onClick={downloadCodedMenu}>↓ Kodlangan menyu CSV</button><button type="button" disabled={recipeCategoryFilter === "all"} onClick={() => void renameProductCategory("recipe", recipeCategoryFilter)}>Nomini o‘zgartirish</button><button className="danger" type="button" disabled={recipeCategoryFilter === "all" || recipeCategoryFilter === RECIPE_FALLBACK_CATEGORY_ID} onClick={() => void deleteProductCategory("recipe", recipeCategoryFilter)}>Kategoriyani savatga</button></div>
          </section>
          <section className="form-card recipe-builder-card" id="recipe-cost-builder">
            <div className="form-card-head"><div><span>1-QADAM · OMBORDAN MUSTAQIL</span><h3>{editingRecipeId ? "Taom tannarxini tahrirlash" : "Taom tannarxini kiriting"}</h3></div><small>Bu yerda ombor qoldig‘i ham, ombor narxi ham o‘zgarmaydi.</small></div>
            {editingRecipeId && <div className="recipe-editing-banner"><span><b>{recipeForm.name}</b><small>Mavjud mahsulot tannarxini yangilayapsiz</small></span><button type="button" onClick={cancelRecipeEdit}>Bekor qilish</button></div>}
            {recipeNotice && <p role={recipeNotice.startsWith("✓") ? "status" : "alert"} aria-live="polite" className={recipeNotice.startsWith("✓") ? "form-notice success recipe-notice-top" : "form-notice recipe-notice-top"}>{recipeNotice}</p>}
            <div className="recipe-builder-primary">
              <label><span>Taom nomi *</span><input aria-label="Yangi taom nomi" placeholder="Masalan: Chicken Kebab" required value={recipeForm.name} onChange={(event) => { setRecipeForm({ ...recipeForm, name: event.target.value }); setRecipeNotice(""); }} /></label>
              <label><span>Mahsulot / POS kodi</span><input aria-label="Taom mahsulot kodi" maxLength={100} placeholder={`Avtomatik: ${nextMenuCode(data.recipes)}`} value={recipeForm.posCode} onChange={(event) => { setRecipeForm({ ...recipeForm, posCode: event.target.value }); setRecipeNotice(""); }} /><small>Chek va Excel shu kod orqali taomni topadi</small></label>
              <label><span>Kategoriya *</span><select aria-label="Taom kategoriyasi" value={recipeForm.categoryId} onChange={(event) => { setRecipeForm({ ...recipeForm, categoryId: event.target.value }); setRecipeNotice(""); }}>{recipeCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
              <label><span>Sotuv narxi (ixtiyoriy)</span><input aria-label="Yangi taom sotuv narxi" type="number" inputMode="numeric" min="0" step="1" placeholder="Keyin ham yozish mumkin" value={recipeForm.salePrice || ""} onChange={(event) => { setRecipeForm({ ...recipeForm, salePrice: Number(event.target.value) }); setRecipeNotice(""); }} /></label>
            </div>
            <div className="recipe-builder-section-title"><div><span>RETSEPT TANNARXI</span><strong>Bir dona taomga nima va qancha ketadi?</strong></div><small>Ombordagi mahsulotni tanlasangiz, qadoq narxi dona yoki gramm narxiga avtomatik bo‘linadi.</small></div>
            <div className="recipe-draft-list">
              {recipeForm.ingredients.map((ingredient, index) => { const inventoryItem = data.inventory.find((item) => item.id === ingredient.inventoryId); return (
                <div className="recipe-draft-row" key={ingredient.id}>
                  <label className="recipe-draft-product"><span>Ombordan ingredient tanlang</span><select aria-label={`Ingredient ${index + 1} ombor mahsuloti`} value={ingredient.inventoryId} onChange={(event) => { selectRecipeInventoryIngredient(index, event.target.value); setRecipeNotice(""); }}><option value="">Qo‘lda kiritish</option>{inventoryCategories.map((category) => <optgroup label={category.name} key={category.id}>{data.inventory.filter((item) => item.categoryId === category.id).map((item) => <option value={item.id} key={item.id}>{item.name} · 1 {item.packageName} = {item.unitsPerPackage.toLocaleString()} {item.unit}{item.gramsPerUnit > 0 ? ` · ${item.gramsPerUnit.toLocaleString()} g/dona` : ""}</option>)}</optgroup>)}</select>{inventoryItem ? <small className="recipe-package-equation">1 {inventoryItem.packageName} = {inventoryItem.unitsPerPackage.toLocaleString()} {inventoryItem.unit} · {won(inventoryItem.packageCost)} → 1 {inventoryItem.unit} = {won(inventoryItem.unitCost)}{inventoryItem.gramsPerUnit > 0 ? ` · ${ingredient.quantity || 0} dona = ${((ingredient.quantity || 0) * inventoryItem.gramsPerUnit).toLocaleString()} g` : ""}</small> : <input list="recipe-ingredient-suggestions" aria-label={`Ingredient ${index + 1} nomi`} maxLength={80} placeholder="Ingredient nomini yozing" value={ingredient.name} onChange={(event) => { updateRecipeDraftIngredient(index, { name: event.target.value, inventoryId: "", lineCost: 0 }); setRecipeNotice(""); }} />}</label>
                  <label className="recipe-draft-unit"><span>Hisob birligi *</span><select aria-label={`${ingredient.name || `Ingredient ${index + 1}`} birligi`} disabled={Boolean(inventoryItem)} value={ingredient.unit} onChange={(event) => { updateRecipeDraftIngredient(index, { unit: event.target.value, inventoryId: "" }); setRecipeNotice(""); }}><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="litr">litr</option><option value="dona">dona</option></select></label>
                  <label className="recipe-draft-quantity"><span>Bir taomga miqdor *</span><div><input aria-label={`${ingredient.name || `Ingredient ${index + 1}`} miqdori, ${ingredient.unit}`} type="number" inputMode="decimal" min="0" step="any" placeholder="0" value={ingredient.quantity || ""} onChange={(event) => { updateRecipeIngredientQuantity(index, Number(event.target.value)); setRecipeNotice(""); }} /><b>{ingredient.unit}</b></div></label>
                  <label className={`recipe-draft-line-cost ${inventoryItem ? "automatic" : ""}`}><span>{inventoryItem ? "Avtomatik tannarx" : "Shu miqdorning narxi *"}</span><div className="recipe-money-input"><b>₩</b><input aria-label={`${ingredient.name || `Ingredient ${index + 1}`} tannarxi`} type="number" inputMode="numeric" min="0" step="any" readOnly={Boolean(inventoryItem)} placeholder="0" value={ingredient.lineCost || ""} onChange={(event) => { updateRecipeDraftIngredient(index, { lineCost: Number(event.target.value) }); setRecipeNotice(""); }} /></div><small>{inventoryItem ? `${ingredient.quantity || 0} ${inventoryItem.unit} × ${won(inventoryItem.unitCost)} = ${won(ingredient.lineCost)}` : "Qo‘lda kiritilgan ingredient uchun"}</small></label>
                  <button type="button" className="recipe-draft-remove" aria-label={`${ingredient.name || `Ingredient ${index + 1}`}ni olib tashlash`} onClick={() => removeRecipeDraftIngredient(index)}>×</button>
                </div>
              ); })}
              <datalist id="recipe-ingredient-suggestions">{recipeIngredientSuggestions.map((name) => <option value={name} key={name} />)}</datalist>
            </div>
            <button type="button" className="recipe-add-row" onClick={addRecipeDraftIngredient} disabled={!canAddRecipeIngredient}>{canAddRecipeIngredient ? "＋ Yana ingredient qo‘shish" : hasIncompleteRecipeIngredient ? "Avval ushbu qatorni to‘ldiring" : "Eng ko‘pi 30 ta ingredient"}</button>
            <div className="recipe-builder-section-title recipe-extra-title"><div><span>QO‘SHIMCHA XARAJAT</span><strong>Bir dona taomga yana nima sarflanadi?</strong></div><small>Faqat retseptda va boshqa xarajatlarda hisoblanmagan bevosita sarf: masalan, qadoq yoki salfetka. Maosh, ijara, gaz va platforma haqi alohida hisoblanadi; bu yerga qayta qo‘shmang.</small></div>
            {recipeForm.extraCosts.length ? <div className="recipe-extra-list">
              {recipeForm.extraCosts.map((extraCost, index) => <div className="recipe-extra-row" key={extraCost.id}>
                <label><span>Xarajat nomi</span><input list="recipe-extra-cost-names" aria-label={`Qo‘shimcha xarajat ${index + 1} nomi`} maxLength={80} placeholder="Masalan: Qadoq" value={extraCost.name} onChange={(event) => { updateRecipeExtraCost(extraCost.id, { name: event.target.value }); setRecipeNotice(""); }} /></label>
                <label><span>1 taom uchun summa</span><div className="recipe-money-input"><b>₩</b><input aria-label={`${extraCost.name || `Qo‘shimcha xarajat ${index + 1}`} summasi`} type="number" inputMode="numeric" min="0" step="1" placeholder="0" value={extraCost.amount || ""} onChange={(event) => { updateRecipeExtraCost(extraCost.id, { amount: Number(event.target.value) }); setRecipeNotice(""); }} /></div></label>
                <button type="button" aria-label={`Qo‘shimcha xarajat ${index + 1}ni olib tashlash`} onClick={() => removeRecipeExtraCost(extraCost.id)}>×</button>
              </div>)}
              <datalist id="recipe-extra-cost-names"><option value="Qadoq" /><option value="Sous / idish" /><option value="Salfetka" /><option value="Boshqa" /></datalist>
            </div> : <p className="recipe-extra-empty">Qo‘shimcha xarajat bo‘lmasa, bu qismni bo‘sh qoldiring.</p>}
            <button type="button" className="recipe-add-row recipe-add-extra" onClick={addRecipeExtraCost} disabled={recipeForm.extraCosts.length >= 20}>＋ Xarajat qo‘shish</button>
            <div className="recipe-builder-summary">
              <div><span>Xomashyo tannarxi</span><output>{won(draftIngredientCost)}</output></div>
              <div className="extra"><span>Qo‘shimcha xarajat</span><output>{won(draftExtraCost)}</output></div>
              <div className="cost"><span>Jami mahsulot tannarxi</span><output aria-live="polite" aria-label="Umumiy tannarx">{won(draftRecipeCost)}</output></div>
              <div><span>Sotuv narxi</span><strong>{recipeForm.salePrice > 0 ? won(recipeForm.salePrice) : "Keyin yoziladi"}</strong></div>
              <div className={recipeForm.salePrice > 0 ? (draftRecipeProfit >= 0 ? "profit" : "loss") : ""}><span>Yalpi foyda</span><strong>{recipeForm.salePrice > 0 ? won(draftRecipeProfit) : "—"}</strong></div>
              <div className={recipeForm.salePrice > 0 ? (draftRecipeMargin >= 30 ? "margin-good" : "margin-low") : ""}><span>Yalpi marja</span><strong>{recipeForm.salePrice > 0 ? `${draftRecipeMargin.toFixed(1)}%` : "—"}</strong></div>
            </div>
            <div className="recipe-builder-actions"><p>Jami tannarx shu taomning o‘zida saqlanadi. Ombor qoldig‘i va ombor narxi o‘zgarmaydi.</p><button type="button" onClick={() => void addRecipe()} disabled={recipeSaving}>{recipeSaving ? "Saqlanmoqda…" : editingRecipeId ? "✓ Tannarx o‘zgarishini saqlash" : "＋ Taom tannarxini saqlash"}</button></div>
          </section>
          <section className="recipe-grid">{filteredRecipes.map((recipe) => { const unavailable = unavailableRecipeIds.has(recipe.id); const audit = recipeMarginAudit(recipe); const breakdown = unavailable ? { ingredientCost: 0, extraCost: 0, totalCost: 0 } : audit; const cost = breakdown.totalCost; const profit = audit.grossProfit; const margin = audit.marginPercent; return <article className={`recipe-card${unavailable ? " unavailable" : ""}`} key={recipe.id}><div className="recipe-title"><div><span className="category-badge">{categoryName(recipe.categoryId, "recipe")}</span><span className="category-badge">KOD: {recipe.posCode}</span><h3>{recipe.name}</h3></div><div className="recipe-title-actions"><b>{margin === null ? audit.status : `${margin.toFixed(1)}%`}</b><button className="recipe-cost-edit" type="button" onClick={() => editRecipeCost(recipe)}>Tannarxni tahrirlash</button><button className="archive-delete" onClick={() => deleteRecipe(recipe)}>Savatga</button></div></div>
            {unavailable && <p className="recipe-unavailable-note">Ombordagi bog‘langan ingredient o‘chirilgan. Mahsulot Arxivdan tiklanguncha bu taom tannarx, marja va yangi savdoda hisoblanmaydi.</p>}
            {!unavailable && !audit.complete && <p className="recipe-unavailable-note">{audit.status}. Soxta marja ko‘rsatilmasligi uchun tannarx hisobi to‘xtatildi.</p>}
            <div className="ingredients ingredients-readonly">{recipe.ingredients.map((ingredient, index) => { const item = data.inventory.find((entry) => entry.id === ingredient.inventoryId); const ingredientName = ingredient.name || item?.name || inventoryName(ingredient.inventoryId) || `Ingredient ${index + 1}`; const ingredientUnit = ingredient.unit || item?.unit || ""; const archivedIngredient = Boolean(ingredient.inventoryId && !item); const savedLineCost = Number(ingredient.lineCost); const savedUnitCost = Number(ingredient.unitCost); const unitCost = Number.isFinite(savedUnitCost) && savedUnitCost > 0 ? savedUnitCost : item?.unitCost ?? 0; const lineCost = Number.isFinite(savedLineCost) && savedLineCost > 0 ? savedLineCost : unitCost * ingredient.quantity; return <div className={archivedIngredient ? "archived" : ""} key={ingredient.id || `${ingredient.inventoryId}-${index}`}><span>{ingredientName}</span><small>{ingredient.quantity.toLocaleString()} {ingredientUnit}</small><b>{archivedIngredient ? "Hisobdan tashqari" : won(lineCost)}</b><em>{archivedIngredient ? "Arxivda" : ingredient.inventoryId ? "Omborga bog‘langan" : "Faqat tannarx"}</em></div>; })}</div>
            {recipe.extraCosts.length ? <div className="saved-extra-costs"><span>QO‘SHIMCHA XARAJATLAR</span>{recipe.extraCosts.map((extraCost) => <div key={extraCost.id}><strong>{extraCost.name}</strong><b>{won(extraCost.amount)}</b></div>)}</div> : null}
            <div className="recipe-summary"><div><span>Xomashyo</span><strong>{unavailable ? "—" : won(breakdown.ingredientCost)}</strong></div><div><span>Qo‘shimcha xarajat</span><strong>{unavailable ? "—" : won(breakdown.extraCost)}</strong></div><div><span>Jami tannarx</span><strong>{audit.complete ? won(cost) : "—"}</strong></div><div><span>Menyu narxi</span><strong>{recipe.salePrice > 0 ? won(recipe.salePrice) : "Kiritilmagan"}</strong></div><div className="profit"><span>Yalpi foyda</span><strong>{profit !== null ? won(profit) : "—"}</strong></div></div>
            <a className="recipe-menu-link" href={haloMenuUrl} target="_blank" rel="noreferrer">Narxni televizor menyusida tekshirish ↗</a>
          </article>; })}{!filteredRecipes.length && <p className="category-empty">Bu kategoriyada taom yo‘q. Yuqoridagi forma orqali qo‘shing.</p>}</section>
        </div>}

        {tab === "sales" && <div className="page">
          {salesChannelSwitcher}
          {userMode === "owner" && <nav className="cost-flow-steps" aria-label="HALO hisoblash bosqichlari">
            <button type="button" onClick={() => setTab("recipes")}><i>1</i><span><strong>Taom tannarxi</strong><small>Retsept va narx</small></span></button>
            <button type="button" onClick={() => setTab("inventory")}><i>2</i><span><strong>Omborga kirim</strong><small>Qoldiq va narx</small></span></button>
            <button type="button" className="active" onClick={() => setTab("sales")}><i>3</i><span><strong>Kunlik chek</strong><small>Savdo va foyda</small></span></button>
          </nav>}
          {userMode === "owner" && <Suspense fallback={<p>Tahlil yuklanmoqda…</p>}><BusinessTrendsPanel state={data} branchName={branches.find(b=>b.id===activeBranchId)?.name} /></Suspense>}
          <section className="pos-banner"><div><span>3-QADAM · POS SAVDO</span><h2>Excel yoki qo‘lda POS savdoni hisoblang</h2><p>Bu oynadagi Excel, surat va qo‘lda kiritilgan savdolar karta/POS yoki yetkazib berish hisobiga yoziladi va belgilangan soliq avtomatik hisoblanadi. Naqd va hisob-raqam savdosini alohida oynaga kiriting.</p></div><div className="pos-status ready"><i /><div><strong>Soliq hisobi ulangan</strong><small>Excel · surat · qo‘lda</small></div></div></section>
          {userMode === "owner" && <PosDayResetPanel key={activeBranchId} request={requestPosDayReset} onBusy={setPosDayResetBusy} />}
          <section className="pos-import-card">
            <div className="pos-import-head">
              <div><span>AQLLI IMPORT</span><h3>Excel yoki suratni yuklash</h3><p>Tizim ma’lumotni avtomatik tekshiradi. Siz faqat topilgan savdolarni ko‘rib, “Import qilish”ni bosasiz.</p></div>
              <div className="pos-upload-buttons">
                <label className="pos-account-select"><span>Fayldagi savdoning to‘lov hisobi</span><select value={posAccountId} onChange={(e) => setPosAccountId(e.target.value)}>{posAccounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                <label className={`pos-file-button${posReading ? " reading" : ""}`}>
                  <i>XL</i>
                  <span><strong>{posReading && posSource === "excel" ? "O‘qilmoqda…" : "Excel / CSV"}</strong><small>POS hisoboti</small></span>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={readPosFile} disabled={posReading} />
                </label>
                <label className={`pos-file-button photo${posReading ? " reading" : ""}`}>
                  <i>▧</i>
                  <span><strong>{posReading && posSource === "image" ? "O‘qilmoqda…" : "Surat / skrinshot"}</strong><small>JPG, PNG yoki kamera</small></span>
                  <input type="file" accept="image/*,.heic,.heif" onChange={readPosFile} disabled={posReading} />
                </label>
              </div>
            </div>
            {posReading && posSource === "image" && <div className="ocr-progress"><div><span>{ocrStage || "Surat o‘qilmoqda…"}</span><strong>{ocrProgress}%</strong></div><i><b style={{ width: `${ocrProgress}%` }} /></i><small>Birinchi marta koreyscha OCR tayyorlanishi biroz vaqt olishi mumkin.</small></div>}
            {posNotice && <p className={posNotice.startsWith("✓") ? "pos-notice success" : "pos-notice"}>{posNotice}</p>}

            {posTable && <>
              <div className="pos-file-meta">
                <div><small>Fayl</small><strong>{posTable.fileName}</strong></div>
                <div><small>Manba</small><strong>{posSource === "image" ? "Surat · OCR" : `Excel · ${posTable.sheetName}`}</strong></div>
                <div><small>{posSource === "image" ? "Qator tekshiruvi" : posTable.reportDate ? "Hisobot sanasi" : "Sarlavha"}</small><strong>{posSource === "image" ? ocrNumbersVerified && !ocrReviewIssues.length ? "TO‘LIQ" : "TEKSHIRILMOQDA" : posTable.reportDate || `${posTable.headerRowNumber}-qator`}</strong></div>
                <div><small>O‘qildi</small><strong>{parsedPos.rows.length.toLocaleString()} savdo qatori</strong></div>
              </div>

              {posSource === "image" ? <>
                <div className="pos-section-title"><div><span>1-QADAM</span><h4>상품코드 va 수량 qiymatlarini tekshiring</h4></div><small>Boshqa ustunlar o‘qilmaydi</small></div>
                <div className={`ocr-number-status ${ocrNumbersVerified && !ocrReviewIssues.length ? "verified" : "review"}`} role="status" aria-live="polite">
                  <div><span>{ocrNumbersVerified && !ocrReviewIssues.length ? "✓" : "!"}</span><p><strong>{ocrNumbersVerified && !ocrReviewIssues.length ? "Kod va son o‘qildi" : `${ocrReviewIssues.length} ta tekshiruv qoldi`}</strong><small>{ocrVerificationMessage || "상품코드 va 수량 qatorma-qator tekshirilmoqda."}</small></p></div>
                  {!!ocrReviewIssues.length && <button onClick={() => document.getElementById(ocrReviewIssues[0].rowNumber == null ? `ocr-issue-${ocrReviewIssues[0].id}` : `ocr-row-${ocrReviewIssues[0].rowNumber}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>Birinchi xatoga o‘tish</button>}
                </div>
                <div className="photo-review-grid">
                  {posImagePreview && <figure><img src={posImagePreview} alt="Yuklangan POS hisoboti surati" /><figcaption><span>Mustaqil tekshiruv</span><strong>{ocrNumbersVerified && !ocrReviewIssues.length ? "✓ TO‘LIQ" : "DAVOM ETMOQDA"}</strong></figcaption></figure>}
                  <div className="photo-detected-rows photo-code-quantity-only">
                    <div className="photo-row photo-head"><span>상품코드</span><span>수량</span><span /></div>
                    {posTable.rows.map((row) => {
                      const issue = ocrIssuesByRow.get(row.rowNumber);
                      const issueDescriptionId = issue ? `ocr-row-${row.rowNumber}-issue` : undefined;
                      return <div className={`photo-row-block ${issue ? "review" : ""}`} id={`ocr-row-${row.rowNumber}`} key={row.rowNumber}>
                        <div className="photo-row" role="group" aria-label={`${row.rowNumber}-qator`}>
                          <input className="photo-code-input" aria-label={`${row.rowNumber}-qator mahsulot kodi`} value={String(row.values[photoPosMapping.productCode] ?? "")} onChange={(e) => updatePhotoRow(row.rowNumber, photoPosMapping.productCode, e.target.value)} placeholder="Kod" />
                          <input className="photo-quantity-input" aria-label={`${row.rowNumber}-qator soni`} aria-invalid={issue?.fields.includes("quantity") || undefined} aria-describedby={issue?.fields.includes("quantity") ? issueDescriptionId : undefined} type="number" min="1" step="1" value={Number(row.values[photoPosMapping.quantity]) || ""} onChange={(e) => updatePhotoRow(row.rowNumber, photoPosMapping.quantity, Number(e.target.value))} placeholder="1" />
                          <button aria-label={`${row.rowNumber}-qatorni o‘chirish`} onClick={() => removePhotoRow(row.rowNumber)}>×</button>
                        </div>
                        {issue && <div className="ocr-row-review" id={issueDescriptionId}>
                          <span><b>TEKSHIRISH KERAK</b><small>{issue.reason}</small></span>
                          {issue.alternate?.quantity != null && <em>OCR soni: {issue.alternate.quantity} dona</em>}
                          <div>{canApplyOcrAlternative(issue) && <button onClick={() => applyOcrAlternative(issue)}>Raqamlar OCR’ini qo‘llash</button>}<button onClick={() => removeOcrIssue(issue.id)}>Hozirgisi to‘g‘ri</button></div>
                        </div>}
                      </div>;
                    })}
                    {globalOcrIssues.map((issue) => <div className={`ocr-global-issue${issue.blocking ? " blocking" : ""}`} id={`ocr-issue-${issue.id}`} key={issue.id}><span><b>{issue.blocking ? "QAYTA SURAT KERAK" : "TEKSHIRISH KERAK"}</b><small>{issue.reason}</small></span>{issue.blocking ? <em>Bu holatda tizim taxmin qilmaydi va importni ochmaydi.</em> : <button onClick={() => removeOcrIssue(issue.id)}>Barcha qatorni surat bilan tekshirdim</button>}</div>)}
                    {!!removedOcrRows.length && <div className={`ocr-removed-rows${recoverableRemovedRows.length ? " recoverable" : ""}`}>
                      <span><b>{recoverableRemovedRows.length ? "YO‘QOLGAN QATOR TOPILDI" : `${removedOcrRows.length} TA QATOR O‘CHIRILGAN`}</b><small>{recoverableRemovedRows.length ? "O‘chirilgan qatorlar chekdagi yetishmayotgan son va summaga aynan teng." : "Xato o‘chirilgan bo‘lsa, bir bosishda qaytaring."}</small></span>
                      <div>
                        <button onClick={() => restoreRemovedRows(recoverableRemovedRows.length ? recoverableRemovedRows : [removedOcrRows[removedOcrRows.length - 1]])}>{recoverableRemovedRows.length ? "Yetishmaganini qaytarish" : "Oxirgisini qaytarish"}</button>
                        <button onClick={() => restoreRemovedRows(removedOcrRows)}>Hammasini qaytarish</button>
                      </div>
                    </div>}
                    {!posTable.rows.length && <p className="pos-empty">Aniq qator topilmadi. “Qator qo‘shish” orqali tekshirib kiriting.</p>}
                    <button className="photo-add-row" onClick={addPhotoRow}>＋ Qator qo‘shish</button>
                    {ocrText && <details className="ocr-raw"><summary>Suratdan o‘qilgan matnni ko‘rish</summary><pre>{ocrText}</pre></details>}
                  </div>
                </div>
                <div className={`ocr-reconcile ${!ocrSummaryAvailable ? "missing" : !ocrSummaryMatches ? "mismatch" : !ocrNumbersVerified || ocrReviewIssues.length ? "review" : "matched"}`} role="status" aria-live="polite">
                  <div className="ocr-receipt-total"><span>Jami o‘qilgan 수량</span><strong>{ocrParsedSummary.quantity.toLocaleString()} dona</strong></div>
                  <i>{ocrNumbersVerified && !ocrReviewIssues.length ? "✓" : "!"}</i>
                  <div><span>Avtomatik hisob</span><strong>{won(importablePosRevenue)}</strong></div>
                  <p>Bu suratdan faqat kod va miqdor o‘qildi. Tushum menyu narxi bo‘yicha TAXMIN; haqiqiy summa uchun POS Excel faylini yuklang.</p>
                </div>
              </> : <>
                <div className="pos-section-title"><div><span>1-QADAM</span><h4>Kod, miqdor va summani tekshiring</h4></div><small>Savdo summasi fayldan olinadi; summa bo‘lmasa taxmin ko‘rsatiladi</small></div>
                <div className="pos-mapping-grid">
                  <label><span>실매출 · Jami savdo summasi</span><select value={posMapping.total} onChange={(e) => setPosMapping({ ...posMapping, total: e.target.value })}><option value="">Summa yo‘q · menyu bo‘yicha taxmin</option>{posTable.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
                  <label><span>상품코드 · Mahsulot kodi</span><select value={posMapping.productCode} onChange={(e) => { setPosMapping({ ...posMapping, productCode: e.target.value, quantity: posMapping.quantity }); setPosProductMap({}); }}><option value="">상품코드 ustunini tanlang</option>{posTable.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
                  <label><span>수량 · Sotilgan soni</span><select value={posMapping.quantity} onChange={(e) => setPosMapping({ ...posMapping, productCode: posMapping.productCode, quantity: e.target.value })}><option value="">수량 ustunini tanlang</option>{posTable.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
                </div>
              </>}

              <div className="pos-section-title"><div><span>2-QADAM</span><h4>Kodlarni HALO menyusi bilan tekshiring</h4></div><small>{posProducts.length} ta kod topildi</small></div>
              <div className="pos-product-map">
                {posProducts.length ? posProducts.map((product) => <div className={product.recipeId ? "matched" : "unmatched"} key={product.key}>
                  <div className="pos-product-name"><i>{product.recipeId ? "✓" : "!"}</i><span><strong>{product.name}</strong><small>{product.productCode ? `Kod: ${product.productCode} · ` : ""}{product.rowCount} qator · {product.quantity.toLocaleString()} ta</small></span></div>
                  <select aria-label={`${product.name} uchun HALO retsepti`} value={product.recipeId} onChange={(e) => setPosProductMap({ ...posProductMap, [product.key]: e.target.value })}>
                    <option value="">Mos HALO retseptini tanlang</option>
                    {recipeCategories.map((category) => <optgroup label={category.name} key={category.id}>{data.recipes.filter((recipe) => recipe.categoryId === category.id).map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.posCode} · {recipe.name}{userMode === "owner" ? ` · ${won(recipe.salePrice)}` : ""}</option>)}</optgroup>)}
                  </select>
                </div>) : <p className="pos-empty">Tanlangan ustunda taomlar topilmadi.</p>}
              </div>

              {!!parsedPos.errors?.length && <p className="pos-warning" role="alert">{parsedPos.errors.join(" ")}</p>}
              {userMode === "owner" ? <PosImportReview result={posReconciliation} date={posTable.reportDate || today} reportTotal={posTable.reportSummary?.totalRevenue} recipes={data.recipes} /> : <p className="pos-warning">Yangi: {importablePosRows.length} qator · oldin saqlangan: {posReconciliation.savedRows.length} qator · tekshirish kerak: {posReconciliation.conflicts.length} qator.</p>}
              {!!unmatchedPosRows.length && <p className="pos-warning">{unmatchedPosRows.length} qator uchun HALO menyusini tanlang.</p>}
              {(parsedPos.ignored > 0 || posTable.truncated) && <p className="pos-warning">{parsedPos.ignored > 0 ? `${parsedPos.ignored} ta bo‘sh yoki noto‘g‘ri qator o‘tkazib yuboriladi. ` : ""}{posTable.truncated ? "Fayl juda katta: dastlabki 25 000 qator olindi." : ""}</p>}
              <p className="pos-warning">Fayl faqat tanlangan hisob savdosiga tegishli bo‘lsin. Agar POS fayli naqd yoki deliveryni ham jamlagan bo‘lsa, ularni yana alohida kiritish jami savdoni oshirib yuboradi.</p><div className="pos-import-actions"><p>{posSource === "image" && !ocrImportReady ? "Importdan oldin belgilangan 상품코드 va 수량 qatorlarini tekshiring." : "Savdo summasi POS faylidan olinadi. Summa yo‘q bo‘lsa menyu narxi bo‘yicha taxmin; tannarx va ombor chiqimi retseptdan hisoblanadi."}</p><button onClick={importPosSales} disabled={!importablePosRows.length || !!unmatchedPosRows.length || !!posReconciliation.conflicts.length || !!parsedPos.errors?.length || !!(parsedPos.summary && !parsedPos.summary.matches) || (posSource === "image" && !ocrImportReady)}>Yangi {importablePosRows.length} qatorni saqlash</button></div>
            </>}
          </section>
          <section className="batch-sale-card">
            <div className="batch-sale-head"><div><span>QO‘LDA POS SAVDO</span><h3>Tayyor taom yoniga faqat sotilgan sonini yozing</h3><p>Bu yerga kiritilgan mahsulotlar faqat POS savdoga qo‘shiladi. Delivery uchun alohida bo‘limdan foydalaning.</p></div><div><label><span>Sana</span><input type="date" disabled={batchSaleBusy} value={batchSaleForm.date} onChange={(event) => setBatchSaleForm({ ...batchSaleForm, date: event.target.value })} /></label><label><span>POS hisobi</span><select disabled={batchSaleBusy} value={batchSaleForm.accountId} onChange={(event) => setBatchSaleForm({ ...batchSaleForm, accountId: event.target.value })}>{posAccounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label></div></div>
            <div className="batch-sale-toolbar"><input aria-label="Taomni qidirish" placeholder="Taom nomini qidiring" value={batchSaleSearch} onChange={(event) => setBatchSaleSearch(event.target.value)} /><button type="button" disabled={batchSaleBusy || !batchSelectedKinds} onClick={() => setBatchSaleQuantities({})}>Sonlarni tozalash</button></div>
            <div className="batch-sale-categories">
              {recipeCategories.map((category) => {
                const recipes = visibleBatchRecipes.filter((recipe) => recipe.categoryId === category.id);
                if (!recipes.length) return null;
                return <section key={category.id}><h4>{category.name}</h4><div className="batch-sale-list">{recipes.map((recipe) => <label className={Number(batchSaleQuantities[recipe.id] || 0) > 0 ? "selected" : ""} key={recipe.id}><span><strong>{recipe.name}</strong><small>{recipe.posCode} · {won(recipe.salePrice)} · {recipe.ingredients.length ? `${recipe.ingredients.length} mahsulot` : "Retsept tarkibi yo‘q"}</small></span><input aria-label={`${recipe.name} sotilgan soni`} type="number" min="0" step="1" inputMode="numeric" disabled={batchSaleBusy} placeholder="0" value={batchSaleQuantities[recipe.id] || ""} onChange={(event) => setBatchSaleQuantities((current) => ({ ...current, [recipe.id]: Number(event.target.value) }))} /></label>)}</div></section>;
              })}
              {!visibleBatchRecipes.length && <p className="batch-sale-empty">Qidiruv bo‘yicha taom topilmadi.</p>}
            </div>
            <div className="batch-sale-submit"><span><small>Saqlanadigan savdo</small><strong>{batchSelectedKinds} tur · {batchSelectedQuantity.toLocaleString()} ta · {won(batchSelectedRevenue)}</strong></span><button className="batch-stock-repair" type="button" disabled={batchSaleBusy} onClick={() => void reconcileSalesInventoryForDate(batchSaleForm.date)}>Shu sana omborini qayta hisoblash</button><button type="button" disabled={batchSaleBusy || !batchSelectedKinds} onClick={() => void recordBatchSales()}>{batchSaleBusy ? "Saqlanmoqda…" : "Hammasini bitta bosishda saqlash"}</button></div>
            {saleNotice && <p className={saleNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{saleNotice}</p>}
          </section>
          <section className="form-card sale-entry"><div className="form-card-head"><div><span>BITTA POS SAVDONI QO‘LDA KIRITISH</span><h3>Soliq hisoblanadigan sotilgan taom</h3></div><small>Excel yoki surat bo‘lmagan POS savdo uchun</small></div>
            <div className="form-grid sale-form">
              <select value={saleForm.recipeId} onChange={(e) => setSaleForm({ ...saleForm, recipeId: e.target.value })}><option value="">Taomni tanlang</option>{recipeCategories.map((category) => <optgroup label={category.name} key={category.id}>{data.recipes.filter((recipe) => recipe.categoryId === category.id).map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.posCode} · {recipe.name}{userMode === "owner" ? ` · ${won(recipe.salePrice)}` : ""}</option>)}</optgroup>)}</select>
              <select value={saleForm.accountId} onChange={(e) => setSaleForm({ ...saleForm, accountId: e.target.value })}>{posAccounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select>
              <input type="number" min="1" step="1" placeholder="Soni" value={saleForm.quantity || ""} onChange={(e) => setSaleForm({ ...saleForm, quantity: Number(e.target.value) })} />
              <input type="date" value={saleForm.date} onChange={(e) => setSaleForm({ ...saleForm, date: e.target.value })} />
              <button onClick={recordSale}>＋ Savdoni yozish</button>
            </div>
            {saleNotice && <p className={saleNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{saleNotice}</p>}
          </section>
          <section className="stats sales-stats">
            <article className="accent"><span>Bugungi POS savdo</span><strong>{money(todayPosRevenue)}</strong><small>{todayPosItems} ta taom · soliq bazasiga kiradi</small></article>
            <article><span>POS retsept tannarxi</span><strong>{money(todayPosCost)}</strong><small>{userMode === "owner" ? "POS savdoga sarflangan qiymat" : "Faqat rahbar ko‘radi"}</small></article>
            <article><span>Soliq zaxirasi bazasi</span><strong>{money(todayReport.taxableSales)}</strong><small>Saqlangan zaxira qoidasi bo‘yicha</small></article>
            <article><span>Reja soliq zaxirasi</span><strong className="negative">−{money(todayReport.tax)}</strong><small>{data.costRules.taxPct || 0}% · faqat POS · delivery kiritilmagan</small></article>
          </section>
          <section className="panel table-panel"><div className="panel-head"><div><span>POS SAVDO TARIXI</span><h3>Excel, surat va qo‘lda kiritilgan soliq hisoblanadigan yozuvlar</h3></div></div>
            {userMode === "owner" ? <div className="data-table"><div className="table-row sales head"><span>Sana</span><span>Taom</span><span>Manba</span><span>Soni</span><span>Savdo</span><span>Tannarx</span><span>Foyda</span><span>Marja</span><span /></div>
              {posRangeSales.length ? posRangeSales.slice(0, salesHistoryLimit).map((sale) => { const profit = sale.totalRevenue - sale.totalCost; const margin = sale.totalRevenue ? (profit / sale.totalRevenue) * 100 : 0; return <div className="table-row sales" key={sale.id}><span>{displayDate(sale.date)}</span><strong>{recipeName(sale.recipeId)}</strong><b className={`source-${sale.source}`}>{saleSourceLabel(sale.source)}</b><span>{sale.quantity} ta</span><strong>{won(sale.totalRevenue)}</strong><span>{won(sale.totalCost)}</span><strong className="positive">{won(profit)}</strong><b className={margin >= 30 ? "margin-good" : "margin-low"}>{`${margin.toFixed(1)}%`}</b><button className="row-action" onClick={() => setRemovalTarget({kind:"sale",id:sale.id,label:`${recipeName(sale.recipeId)} · ${won(sale.totalRevenue)}`})}>Olib tashlash</button></div>; }) : <div className="table-empty">Tanlangan sanada POS savdo yo‘q.</div>}
            </div> : <div className="employee-sales-list">{posRangeSales.length ? posRangeSales.slice(0, 30).map((sale) => <article key={sale.id}><span><strong>{recipeName(sale.recipeId)}</strong><small>{displayDate(sale.date)} · {saleSourceLabel(sale.source)}</small></span><b>{sale.quantity} ta</b></article>) : <p className="table-empty">Tanlangan sanada POS savdo yo‘q.</p>}</div>}
            {userMode === "owner" && posRangeSales.length > salesHistoryLimit && <button type="button" className="stock-history-more" onClick={() => setSalesHistoryLimit((current) => current + 100)}>Yana 100 ta POS savdoni ko‘rsatish</button>}
          </section>
        </div>}

        {tab === "deliverysales" && <div className="page delivery-sales-page">
          {salesChannelSwitcher}
          <section className="delivery-sales-hero">
            <div><span>POS’DAN ALOHIDA · 🛵 DELIVERY</span><h2>Coupang, Baemin va Yogiyo savdosi</h2><p>Platformani tanlang, sotilgan mahsulotlar sonini yozing. HALO omborni kamaytiradi, ushlanmalar, kutiladigan o‘tkazma va tannarxdan keyingi marjani hisoblaydi.</p></div>
            <div className="delivery-platform-picker" role="group" aria-label="Delivery platformasini tanlash">
              {deliveryPlatformSummaries.map((platform) => <button type="button" key={platform.id} className={deliverySaleForm.platform === platform.id ? `active platform-${platform.id}` : `platform-${platform.id}`} disabled={deliverySaleBusy} onClick={() => { setDeliverySaleForm((current) => ({ ...current, platform: platform.id })); }}><i>{platform.id === "coupang" ? "C" : platform.id === "baemin" ? "B" : "Y"}</i><span><strong>{platform.shortLabel}</strong><small>{platform.orderCount} buyurtma · {won(platform.revenue)}</small></span><b>{deliverySaleForm.platform === platform.id ? "✓" : "→"}</b></button>)}
            </div>
          </section>

          {userMode === "owner" && <details className="delivery-price-settings">
            <summary><span><small>DELIVERY BO‘LIMI · ALOHIDA NARXLAR</small><strong>{deliveryPlatformShortLabel(deliverySaleForm.platform)} mahsulot narxlarini bir marta kiriting</strong><em>Oddiy HALO narxi o‘zgarmaydi</em></span><b>SOZLASH ＋</b></summary>
            <div className="delivery-price-settings-body">
              <div className="delivery-price-toolbar"><span><strong>{deliveryPlatformLabel(deliverySaleForm.platform)}</strong><small>Bo‘sh qoldirilgan mahsulotda oddiy HALO narxi ishlatiladi.</small></span><input type="search" placeholder="Mahsulot nomi yoki kodi…" value={deliveryPriceSearch} onChange={(event) => setDeliveryPriceSearch(event.target.value)} /></div>
              <div className="delivery-price-list">
                {visibleDeliveryPriceRecipes.map((recipe) => {
                  const platformDrafts = deliveryPriceDrafts[deliverySaleForm.platform] || {};
                  const hasDraft = Object.prototype.hasOwnProperty.call(platformDrafts, recipe.id);
                  const savedPlatformPrice = normalizeDeliveryPlatformPrices(recipe.deliveryPrices)[deliverySaleForm.platform];
                  const value = hasDraft ? platformDrafts[recipe.id] : savedPlatformPrice || "";
                  return <label key={recipe.id}><span><strong>{recipe.name}</strong><small>{recipe.posCode} · HALO narxi {won(recipe.salePrice)}</small></span><div><input aria-label={`${recipe.name} ${deliveryPlatformShortLabel(deliverySaleForm.platform)} narxi`} type="number" inputMode="numeric" min="1" step="100" placeholder={String(recipe.salePrice)} disabled={deliveryPriceBusy} value={value} onChange={(event) => { const nextValue = event.target.value === "" ? "" : Number(event.target.value); setDeliveryPriceDrafts((current) => ({ ...current, [deliverySaleForm.platform]: { ...(current[deliverySaleForm.platform] || {}), [recipe.id]: nextValue } })); }} /><b>₩</b></div></label>;
                })}
                {!visibleDeliveryPriceRecipes.length && <p className="table-empty">Qidiruv bo‘yicha mahsulot topilmadi.</p>}
              </div>
              <div className="delivery-price-actions"><span><small>Saqlangandan keyin yangi buyurtmalarda avtomatik ishlaydi</small><strong>{deliveryPlatformShortLabel(deliverySaleForm.platform)} uchun {data.recipes.filter((recipe) => normalizeDeliveryPlatformPrices(recipe.deliveryPrices)[deliverySaleForm.platform]).length} ta alohida narx saqlangan</strong></span><button type="button" disabled={deliveryPriceBusy || !Object.keys(deliveryPriceDrafts[deliverySaleForm.platform] || {}).length} onClick={() => void saveDeliveryMenuPrices()}>{deliveryPriceBusy ? "Saqlanmoqda…" : "Narxlarni saqlash"}</button></div>
              {deliveryPriceNotice && <p className={deliveryPriceNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{deliveryPriceNotice}</p>}
            </div>
          </details>}

          <section className={`batch-sale-card delivery-entry-card ${editingDeliverySaleId ? "editing" : ""}`} id="delivery-sale-entry">
            <div className="batch-sale-head delivery-entry-head"><div><span>{editingDeliverySaleId ? "DELIVERY SAVDOSINI TAHRIRLASH" : "YANGI DELIVERY SAVDO"}</span><h3>{deliveryPlatformLabel(deliverySaleForm.platform)}</h3><p>{editingDeliverySaleId ? "Eski ombor chiqimi avval qaytariladi, so‘ng yangi miqdor bir marta hisoblanadi." : "Bir buyurtmadagi barcha mahsulotlar sonini kiriting; bo‘sh qatorlar saqlanmaydi."}</p></div><div>
              <label><span>Sana</span><input aria-label="Delivery sotilgan sana" type="date" disabled={deliverySaleBusy} value={deliverySaleForm.date} onChange={(event) => setDeliverySaleForm({ ...deliverySaleForm, date: event.target.value })} /></label>
              <label><span>Aniq vaqt</span><input aria-label="Delivery sotilgan vaqt" type="time" disabled={deliverySaleBusy} value={deliverySaleForm.time} onChange={(event) => setDeliverySaleForm({ ...deliverySaleForm, time: event.target.value })} /></label>
              <label><span>Buyurtma raqami · ixtiyoriy</span><input aria-label="Delivery buyurtma raqami" maxLength={80} disabled={deliverySaleBusy} placeholder="Masalan: CE-1042" value={deliverySaleForm.orderNumber} onChange={(event) => setDeliverySaleForm({ ...deliverySaleForm, orderNumber: event.target.value })} /></label>
              <label><span>Ushlanma qoidasi</span><div className="delivery-rule-chip"><b>Avtomatik</b><small>{deliveryUsesSavedFees ? "Buyurtmada saqlangan qoida" : "Soliq bo‘limidagi saqlangan qoida"}</small></div></label>
            </div></div>
            {editingDeliverySaleId && <div className="delivery-edit-banner"><span><b>Butun buyurtma tahrirlanmoqda</b><small>Mahsulotlarni qo‘shish, olib tashlash, soni, platforma, vaqt va buyurtma raqamini o‘zgartirish mumkin.</small></span><button type="button" disabled={deliverySaleBusy} onClick={() => resetDeliverySaleDraft("Tahrirlash bekor qilindi.")}>Bekor qilish</button></div>}
            <div className="batch-sale-toolbar"><input type="search" disabled={deliverySaleBusy} placeholder="Taom nomi yoki kodi…" value={deliverySaleSearch} onChange={(event) => setDeliverySaleSearch(event.target.value)} /><button type="button" disabled={deliverySaleBusy || (!deliverySelectedKinds && !deliverySaleSearch)} onClick={() => { setDeliverySaleQuantities({}); setDeliverySaleSearch(""); }}>Tanlovni tozalash</button></div>
            <div className="batch-sale-categories">
              {recipeCategories.map((category) => { const recipes = visibleDeliveryRecipes.filter((recipe) => recipe.categoryId === category.id); return recipes.length ? <section key={category.id}><h4>{category.name}</h4><div className="batch-sale-list">{recipes.map((recipe) => { const platformPrice = deliveryMenuPrice(recipe, deliverySaleForm.platform); return <label className={Number(deliverySaleQuantities[recipe.id] || 0) > 0 ? "selected" : ""} key={recipe.id}><span><strong>{recipe.name}</strong><small>{recipe.posCode} · {deliveryPlatformShortLabel(deliverySaleForm.platform)} {won(platformPrice)}{platformPrice !== recipe.salePrice ? ` · HALO ${won(recipe.salePrice)}` : ""} · tannarx {won(recipeCost(recipe))}</small></span><input aria-label={`${recipe.name} delivery sotilgan soni`} type="number" min="0" step="1" inputMode="numeric" disabled={deliverySaleBusy} placeholder="0" value={deliverySaleQuantities[recipe.id] || ""} onChange={(event) => setDeliverySaleQuantities((current) => ({ ...current, [recipe.id]: Number(event.target.value) }))} /></label>; })}</div></section> : null; })}
              {!visibleDeliveryRecipes.length && <p className="batch-sale-empty">Qidiruv bo‘yicha taom topilmadi.</p>}
            </div>
            <details className="delivery-extra-builder">
              <summary>+ Delivery menyusiga mahsulot qo‘shish</summary>
              <p>Sous yoki mahsulotni menyuga doimiy saqlang. Buyurtma kiritganda «Sous va qo‘shimchalar» bo‘limidan tanlaysiz. Narx va tannarx 1 dona uchun.</p>
              <fieldset disabled={deliveryExtraBusy || deliverySaleBusy} className="delivery-extra-fields">
                <label>Nomi<input maxLength={80} placeholder="Masalan: sarimsoqli sous" value={deliveryExtra.name} onChange={(e) => setDeliveryExtra({ ...deliveryExtra, name: e.target.value })} /></label>
                <label>Sotuv narxi · ₩<input type="number" min="0" step="1" value={deliveryExtra.price} onChange={(e) => setDeliveryExtra({ ...deliveryExtra, price: e.target.value })} /></label>
                <label>1 dona tannarxi · ₩<input type="number" min="1" step="1" value={deliveryExtra.cost} onChange={(e) => setDeliveryExtra({ ...deliveryExtra, cost: e.target.value })} /></label>
                <label>Ombor mahsuloti · ixtiyoriy<select value={deliveryExtra.inventoryId} onChange={(e) => setDeliveryExtra({ ...deliveryExtra, inventoryId: e.target.value })}><option value="">Omborga bog‘lanmagan</option>{data.inventory.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select></label>
                {deliveryExtra.inventoryId && <label>1 dona uchun ombor sarfi · {data.inventory.find((item) => item.id === deliveryExtra.inventoryId)?.unit}<input type="number" min="0.001" step="any" value={deliveryExtra.usage} onChange={(e) => setDeliveryExtra({ ...deliveryExtra, usage: e.target.value })} /></label>}
                <button type="button" onClick={() => void addDeliveryExtra()}>{deliveryExtraBusy ? "Saqlanmoqda…" : "Delivery menyusiga saqlash"}</button>
              </fieldset>
              <small>Omborga bog‘lasangiz, buyurtma saqlanganda sarf ayriladi. Murakkab tarkibni Taom tannarxi bo‘limida tahrirlashingiz mumkin.</small>
              {deliveryExtraNotice && <p role="status" className="form-notice">{deliveryExtraNotice}</p>}
            </details>
            <DeliveryOrderPreview inputs={deliveryAppliedManualFees} fees={deliverySelectedFeeBreakdown} revenue={deliverySelectedRevenue} cost={deliverySelectedCost} valid={deliveryAdjustmentsValid} historical={deliveryUsesSavedFees} onSettings={userMode === "owner" ? () => { setFeeRulePlatform(deliverySaleForm.platform); setTab("fees"); } : undefined} won={won} />
            <div className="batch-sale-submit delivery-sale-submit"><span><small>Saqlanadigan delivery savdo</small><strong>{deliverySelectedKinds} tur · {deliverySelectedQuantity.toLocaleString()} ta · {deliveryPlatformShortLabel(deliverySaleForm.platform)}</strong></span><button type="button" disabled={deliverySaleBusy || deliveryExtraBusy || !deliverySelectedKinds || !deliveryAdjustmentsValid} onClick={() => void recordDeliverySales()}>{deliverySaleBusy ? "Saqlanmoqda…" : editingDeliverySaleId ? "O‘zgarishni saqlash" : "Buyurtmani saqlash"}</button></div>
            {deliverySaleNotice && <p role={deliverySaleNotice.startsWith("✓") ? "status" : "alert"} aria-live="polite" className={deliverySaleNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{deliverySaleNotice}</p>}
          </section>

          <section className="delivery-platform-stats">
            {deliveryPlatformSummaries.map((platform) => <article className={`platform-${platform.id}`} key={platform.id}><span><i>{platform.id === "coupang" ? "C" : platform.id === "baemin" ? "B" : "Y"}</i><b>{platform.shortLabel}</b></span><strong>{won(platform.revenue)}</strong><small>{platform.quantity} ta · ushlanma {won(platform.commission)}</small><em className={platform.profit >= 0 ? "positive" : "negative"}>Tannarxdan keyin {won(platform.profit)}</em></article>)}
            <article className="delivery-total-card"><span><i>Σ</i><b>Jami delivery</b></span><strong>{won(deliveryRangeSummary.revenue)}</strong><small>{deliveryRangeSummary.quantity} ta · {deliveryRangeOrders.length} buyurtma</small><em className={deliveryRangeSummary.profit >= 0 ? "positive" : "negative"}>Tannarxdan keyin {won(deliveryRangeSummary.profit)}</em></article>
          </section>

          <section className="panel table-panel delivery-history-panel"><div className="panel-head"><div><span>{dateRangeLabel(sectionDateRanges.deliverysales)}</span><h3>Delivery savdo tarixi</h3><small>Bir buyurtma — barcha taomlar va ushlanmalar bitta yozuvda</small></div><b>{deliveryRangeOrders.length} buyurtma</b></div>
            <div className="data-table delivery-history-table"><div className="table-row delivery-sale-row head"><span>Sana / vaqt</span><span>Platforma / buyurtma</span><span>Taom</span><span>Soni</span><span>Savdo</span><span>Tannarx</span><span>Ushlanma</span><span>Tannarxdan keyin</span><span>Amallar</span></div>
              {deliveryRangeOrders.slice(0, deliveryHistoryLimit).map((items) => {
                const sale = items[0];
                const revenue = items.reduce((sum, item) => sum + item.totalRevenue, 0);
                const cost = items.reduce((sum, item) => sum + Math.round(item.totalCost), 0);
                const commission = items.reduce((sum, item) => sum + deliveryCommissionAmount(item, data.costRules.deliveryCommissionPct), 0);
                const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
                const profit = revenue - cost - commission;
                const fees = deliveryWonFeesForEdit(items, data.costRules.deliveryCommissionPct);
                const batchIsEditing = items.some((item) => item.id === editingDeliverySaleId);
                return <div className={`table-row delivery-sale-row ${batchIsEditing ? "active-edit" : ""}`} key={sale.deliveryBatchId || sale.id}>
                  <span><strong>{displayDate(sale.date)}</strong><small>{displayRecordTime(sale.soldAt || sale.createdAt)}</small></span>
                  <span><b>{deliveryPlatformShortLabel(sale.deliveryPlatform)}</b><small>{sale.deliveryOrderNumber || "Buyurtma raqami yo‘q"}</small></span>
                  <span>{items.map((item) => <small key={item.id}><b>{recipeName(item.recipeId)}</b> × {item.quantity}</small>)}</span>
                  <span>{quantity} ta</span><strong>{won(revenue)}</strong><span>−{won(cost)}</span>
                  <span><strong>−{won(commission)}</strong><details><summary>Ushlanmalar</summary>{([
                    ["brokerage", "Platforma"], ["payment", "To‘lov"], ["delivery", "Yetkazish"], ["vat", "QQS"],
                    ["coupon", "Kupon"], ["instantDiscount", "Chegirma"], ["advertising", "Reklama"],
                  ] as const).map(([key, label]) => <small key={key}>{label}: {won(Number(fees[key].value))}</small>)}</details><small>O‘tkazma: {won(revenue - commission)}</small></span>
                  <strong className={profit >= 0 ? "positive" : "negative"}>{won(profit)}</strong>
                  <span className="delivery-row-actions"><button type="button" disabled={deliverySaleBusy} onClick={() => beginDeliverySaleEdit(sale)}>Buyurtmani tahrirlash</button><button type="button" className="danger" disabled={deliverySaleBusy} onClick={() => setRemovalTarget({kind:"sale",id:sale.id,label:`Delivery · ${won(sale.totalRevenue)}`})}>Olib tashlash</button></span>
                </div>;
              })}
              {!deliveryRangeSales.length && <div className="table-empty">Tanlangan davrda delivery savdo yo‘q.</div>}
            </div>
            {deliveryRangeOrders.length > deliveryHistoryLimit && <button type="button" className="stock-history-more" onClick={() => setDeliveryHistoryLimit((current) => current + 100)}>Yana 100 ta buyurtmani ko‘rsatish</button>}
          </section>
        </div>}

        {tab === "cashbank" && <div className="page cash-bank-sales-page">
          {salesChannelSwitcher}
          <section className="cash-sales-hero cash-bank-sales-hero">
            <div><span>HODIM KIRITGAN · SOLIQ ULANMAGAN</span><h2>Naqd va hisob-raqam savdolari</h2><p>Xodim o‘z hisobiga kirib naqd berilgan yoki hisob-raqamga tushgan savdoni kiritadi. Savdo daromad, tannarx, foyda, kassa/bank va omborga qo‘shiladi, lekin HALO undan avtomatik soliq ajratmaydi.</p></div>
            <div className="cash-sales-rule"><i>✓</i><span><strong>POS savdodan alohida</strong><small>Sana filtri yuqoridagi shu bo‘lim tahlilidan boshqariladi</small></span></div>
          </section>
          <a className="worker-pos-terminal-link" href="/hisob" target="_blank" rel="noreferrer"><span><i>₩</i><b>HALO HISOB · himoyalangan kiritish oynasi</b><small>Naqd yoki hisob-raqam · soliq avtomatik hisoblanmaydi</small></span><strong>Alohida havolani ochish →</strong></a>
          <section className="stats cash-sales-stats">
            <article className="accent"><span>Jami naqd + hisob-raqam savdosi</span><strong>{won(cashBankRangeRevenue)}</strong><small>{cashBankRangeQuantity} ta taom · tanlangan davr</small></article>
            <article><span>Naqd kassa</span><strong>{won(cashBankRangeCash)}</strong><small>Savdo va kassa balansida</small></article>
            <article><span>Hisob-raqam / bank</span><strong>{won(cashBankRangeBank)}</strong><small>Savdo va bank balansida</small></article>
            <article><span>Yalpi foyda</span><strong className="positive">{won(cashBankRangeRevenue - cashBankRangeCost)}</strong><small>Tannarx {won(cashBankRangeCost)} · soliqni buxgalter hisoblaydi</small></article>
          </section>
          <section className="panel table-panel cash-bank-history-panel">
            <div className="panel-head"><div><span>{dateRangeLabel(sectionDateRanges.cashbank)}</span><h3>Naqd va hisob-raqam savdolari tarixi</h3></div><b>{cashBankRangeSales.length} yozuv</b></div>
            <div className="data-table"><div className="table-row cash-bank-sale-history head"><span>Sana</span><span>Vaqti</span><span>Taom</span><span>To‘lov turi</span><span>Soni</span><span>Savdo</span><span>Tannarx</span><span>Foyda</span><span>Kiritdi</span></div>{cashBankRangeSales.length ? cashBankRangeSales.slice().sort((left, right) => right.date.localeCompare(left.date)).map((sale) => { const account = data.accounts.find((entry) => entry.id === sale.accountId); const orderMeta = cashBankSaleOrderMeta(sale.id); return <div className="table-row cash-bank-sale-history" key={sale.id}><span>{displayDate(sale.date)}</span><b>{displayRecordTime(orderMeta.createdAt)}</b><strong>{recipeName(sale.recipeId)}</strong><b>{account?.type === "bank" ? "Hisob-raqam" : "Naqd"}</b><span>{sale.quantity} ta</span><strong>{won(sale.totalRevenue)}</strong><span>{won(sale.totalCost)}</span><strong className="positive">{won(sale.totalRevenue - sale.totalCost)}</strong><em>{orderMeta.workerName}</em></div>; }) : <div className="table-empty">Tanlangan sanada naqd yoki hisob-raqam savdosi yo‘q.</div>}</div>
          </section>
        </div>}

        {tab === "cashsales" && <div className="page cash-sales-page">
          <section className="cash-sales-hero">
            <div><span>OMBOR CHIQIMI TAHLILI</span><h2>Yeyilgan va chiqib ketgan mahsulotlar</h2><p>Oshxonada yeyilgan taomlar, alohida mahsulot chiqimi, isrof va boshqa nosavdo harakatlar bir joyda ko‘rinadi. Yuqoridagi sana orqali bugun, hafta, oy yoki istalgan davrni tahlil qiling.</p></div>
            <div className="cash-sales-rule"><i>⌁</i><span><strong>Taom + xomashyo tahlili</strong><small>Eski va yangi yozuvlar birga hisoblanadi</small></span></div>
          </section>
          <a className="worker-pos-terminal-link" href="/hisob" target="_blank" rel="noreferrer"><span><i>−</i><b>Oshxonada yeyilgan ovqatni kiritish</b><small>Parolsiz POS oynasi · ombordan avtomatik ayriladi</small></span><strong>HALO HISOBNI OCHISH →</strong></a>
          <section className="stats cash-sales-stats">
            <article className="accent"><span>Oshxonada yeyilgan</span><strong>{cashSaleRangeQuantity} porsiya</strong><small>{kitchenOutflowRangeEntries.length} yozuv · tanlangan davr</small></article>
            <article><span>Ombordan chiqqan tannarx</span><strong>{won(cashSaleRangeCost)}</strong><small>Yeyilgan va boshqa chiqimlar jami</small></article>
            <article><span>Alohida mahsulot chiqimi</span><strong>{productOutflowRangeEntries.length}</strong><small>Taom retseptidan tashqari mahsulotlar</small></article>
            <article><span>Boshqa chiqimlar</span><strong>{otherOutflowRangeEntries.length}</strong><small>Isrof, buzilgan va ichki foydalanish</small></article>
          </section>
          <section className="outflow-analysis-grid">
            <article className="panel outflow-ranking-panel"><div className="panel-head"><div><span>TAOMLAR TAHLILI</span><h3>Eng ko‘p yeyilgan taomlar</h3></div><b>{outflowDishSummary.length} tur</b></div><div className="outflow-ranking-list">{outflowDishSummary.length ? outflowDishSummary.slice(0, 12).map((row, index) => <p key={row.recipeId || row.name}><i>{index + 1}</i><span><strong>{row.name}</strong><small>{row.cost > 0 ? `${won(row.cost)} saqlangan tannarx` : "Ombordan ayrilgan"}</small></span><b>{row.quantity.toLocaleString()} porsiya</b></p>) : <div className="table-empty">Tanlangan davrda yeyilgan taom yo‘q.</div>}</div></article>
            <article className="panel outflow-ranking-panel"><div className="panel-head"><div><span>XOMASHYO TAHLILI</span><h3>Ombordan ayrilgan mahsulotlar</h3></div><b>{outflowIngredientSummary.length} tur</b></div><div className="outflow-ranking-list">{outflowIngredientSummary.length ? outflowIngredientSummary.slice(0, 12).map((row, index) => <p key={row.inventoryId}><i>{index + 1}</i><span><strong>{row.name}</strong><small>{row.cost > 0 ? `${won(row.cost)} qiymat` : "Ombor harakatidan"}</small></span><b>{row.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })} {row.unit}</b></p>) : <div className="table-empty">Tanlangan davrda ombor chiqimi yo‘q.</div>}</div></article>
          </section>
          <section className="panel table-panel outflow-day-panel"><div className="panel-head"><div><span>KUNLIK TAHLIL</span><h3>Kunlar bo‘yicha yeyilgan va chiqqanlar</h3></div><b>{outflowDaySummary.length} kun</b></div><div className="data-table"><div className="table-row outflow-day-history head"><span>Sana</span><span>Yeyilgan taom</span><span>Chiqim yozuvi</span><span>Tannarx</span></div>{outflowDaySummary.length ? outflowDaySummary.map((row) => <div className="table-row outflow-day-history" key={row.date}><strong>{displayDate(row.date)}</strong><b>{row.portions} porsiya</b><span>{row.records} yozuv</span><strong>{won(row.cost)}</strong></div>) : <div className="table-empty">Tanlangan davrda chiqim yozuvi yo‘q.</div>}</div></section>
          <section className="panel table-panel outflow-history-panel"><div className="panel-head"><div><span>{dateRangeLabel(sectionDateRanges.cashsales)}</span><h3>Barcha yeyilgan va chiqib ketganlar tarixi</h3></div><b>{cashSaleRangeSales.length} yozuv</b></div>
            <div className="data-table"><div className="table-row cash-sale-history head"><span>Sana</span><span>Vaqti</span><span>Taom yoki mahsulot</span><span>Turi</span><span>Miqdori</span><span>Tannarx</span></div>{cashSaleRangeSales.length ? cashSaleRangeSales.slice().sort((left, right) => `${right.date}|${right.createdAt || ""}`.localeCompare(`${left.date}|${left.createdAt || ""}`)).map((entry) => { const dishItems = outflowDishItems(entry); const recipeOutflow = entry.kind === "inventory_only" || entry.kind === "meal"; return <div className="table-row cash-sale-history" key={entry.id}><strong>{displayDate(entry.date)}</strong><b>{displayRecordTime(entry.createdAt)}</b><span>{dishItems.length ? dishItems.map((item) => `${item.name} × ${item.quantity}`).join(", ") : entry.label}</span><b>{outflowReasonLabel(entry)}</b><span>{safeOutflowNumber(entry.quantity).toLocaleString("en-US", { maximumFractionDigits: 3 })} {recipeOutflow ? "porsiya" : entry.unit || "birlik"}</span><strong>{won(safeOutflowNumber(entry.totalCost))}</strong></div>; }) : <div className="table-empty">Tanlangan sanada yeyilgan yoki ombordan chiqqan mahsulot yo‘q.</div>}</div>
          </section>
          <details className="outflow-entry-details"><summary><span><b>Rahbar uchun boshqa chiqim kiritish</b><small>Isrof, buzilgan, bepul namuna yoki ichki foydalanish</small></span><strong>OCHISH ＋</strong></summary><section className="batch-sale-card cash-sale-entry-card">
            <div className="batch-sale-head"><div><span>QO‘SHIMCHA NOSAVDO CHIQIM</span><h3>Taom yoniga chiqqan sonini yozing</h3><p>Sana va chiqim sababi bir marta tanlanadi. Bo‘sh qatorlar hisoblanmaydi.</p></div><div><label><span>Sana</span><input type="date" disabled={cashSaleBusy} value={cashSaleForm.date} onChange={(event) => setCashSaleForm({ ...cashSaleForm, date: event.target.value })} /></label><label><span>Chiqim sababi</span><select disabled={cashSaleBusy} value={cashSaleForm.reason} onChange={(event) => setCashSaleForm({ ...cashSaleForm, reason: event.target.value })}>{INVENTORY_OUTFLOW_REASONS.map((reason) => <option value={reason} key={reason}>{reason}</option>)}</select></label></div></div>
            <div className="batch-sale-toolbar"><input aria-label="Ombor chiqimi taomini qidirish" placeholder="Taom nomini qidiring" value={cashSaleSearch} onChange={(event) => setCashSaleSearch(event.target.value)} /><button type="button" disabled={cashSaleBusy || !cashSaleSelectedKinds} onClick={() => setCashSaleQuantities({})}>Sonlarni tozalash</button></div>
            <div className="batch-sale-categories">{recipeCategories.map((category) => { const recipes = cashSaleVisibleRecipes.filter((recipe) => recipe.categoryId === category.id); if (!recipes.length) return null; return <section key={category.id}><h4>{category.name}</h4><div className="batch-sale-list">{recipes.map((recipe) => <label className={Number(cashSaleQuantities[recipe.id] || 0) > 0 ? "selected" : ""} key={recipe.id}><span><strong>{recipe.name}</strong><small>{won(recipeCost(recipe))} tannarx · retsept omborga bog‘langan</small></span><input aria-label={`${recipe.name} nosavdo chiqim soni`} type="number" min="0" step="1" inputMode="numeric" disabled={cashSaleBusy} placeholder="0" value={cashSaleQuantities[recipe.id] || ""} onChange={(event) => setCashSaleQuantities((current) => ({ ...current, [recipe.id]: Number(event.target.value) }))} /></label>)}</div></section>; })}{!cashSaleVisibleRecipes.length && <p className="batch-sale-empty">Qidiruv bo‘yicha taom topilmadi.</p>}</div>
            <div className="batch-sale-submit"><span><small>Nosavdo ombor chiqimi sifatida saqlanadi</small><strong>{cashSaleSelectedKinds} tur · {cashSaleSelectedQuantity.toLocaleString()} porsiya · tannarx {won(cashSaleSelectedCost)}</strong></span><button type="button" disabled={cashSaleBusy || !cashSaleSelectedKinds} onClick={() => void recordCashBankSales()}>{cashSaleBusy ? "Saqlanmoqda…" : "Ombordan ayirish"}</button></div>
            {cashSaleNotice && <p className={cashSaleNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{cashSaleNotice}</p>}
          </section></details>
        </div>}

        {tab === "fees" && userMode === "owner" && <div className="page fee-center-page">
          <section className="fee-hero">
            <div><span>SOLIQ VA USHLANMALAR</span><h2>Delivery ushlanmasini shu yerda bir marta belgilang</h2><p>Naqd va hisob-raqam savdosi daromad, hisob va omborda to‘liq yuradi, lekin uning solig‘ini HALO avtomatik ayirmaydi — “Buxgalter hisoblaydi” deb alohida jamlaydi. Umumiy savdo solig‘i va karta komissiyasi faqat POS savdosiga qo‘llanadi. Coupang, Baemin va Yogiyo uchun saqlangan foiz, yetkazish puli va chegirma har bir yangi buyurtmadan avtomatik ayriladi. Xodim faqat platforma, sana va sotilgan mahsulotlarni kiritadi.</p></div>
            <div className="fee-rate-badges"><span><small>Karta komissiyasi</small><strong>{feeRuleForm.cardCommissionPct || 0}%</strong></span><span><small>Soliq zaxirasi · taxmin</small><strong>{data.costRules.taxPct || 0}%</strong></span></div>
          </section>
          <p className="form-notice">Bu foizdan hisoblangan soliq — reja zaxirasi. Haqiqiy QQS barcha tegishli savdolar va xarid hujjatlari asosida buxgalter tomonidan aniqlanadi; delivery xizmatlarining QQSi uni almashtirmaydi.</p>
          <section className="fee-layout">
            <article className="fee-settings-card">
              <div className="fee-card-head"><div><span>BIR MARTALIK SOZLAMA</span><h3>Rahbar sozlamalari</h3></div><b>Avtomatik</b></div>
              <fieldset disabled={feeRuleBusy} className="fee-settings-fields"><div className="fee-rule-form">
                <label><span>Kartadan ushlanadigan foiz</span><div><input type="number" min="0" max="100" step="0.01" value={feeRuleForm.cardCommissionPct || ""} onChange={(event) => { feeRuleDirtyRef.current = true; setFeeRuleNotice(""); setFeeRuleForm({ ...feeRuleForm, cardCommissionPct: Number(event.target.value) }); }} /><b>%</b></div><small>POS kompaniyasi karta pulini tashlashdan oldin ushlab qoladi</small></label>
              </div>
              <div className="delivery-fee-settings">
                <div className="delivery-fee-settings-head"><span><small>DELIVERY USHLANMALARI</small><strong>{deliveryPlatformShortLabel(feeRulePlatform)} · har bir yangi buyurtma uchun</strong></span><div>{DELIVERY_PLATFORMS.map((platform) => <button type="button" className={feeRulePlatform === platform.id ? "active" : ""} key={platform.id} onClick={() => setFeeRulePlatform(platform.id)}>{platform.shortLabel}</button>)}</div></div>
                <div className="delivery-fee-fields">
                  <label><span>Delivery ushlanmasi · %</span><div><input type="number" min="0" max="100" step="0.01" value={activeFeePlatformRule.combinedPct ?? deliveryCombinedPercent(activeFeePlatformRule)} onChange={(event) => updateActiveSimpleDeliveryRule({ combinedPct: Number(event.target.value) })} /><b>%</b></div><small>Masalan 16: savdo summasining 16% qismi ayriladi</small></label>
                  <label><span>Yetkazib berish puli</span><div><input type="number" min="0" max="100000000" step="1" inputMode="numeric" value={activeFeePlatformRule.deliveryFeeWon} onChange={(event) => updateActiveSimpleDeliveryRule({ deliveryFeeWon: Number(event.target.value) })} /><b>₩</b></div><small>Har bir buyurtmadan bir marta ayriladi</small></label>
                  <label><span>Doimiy chegirma</span><div><input type="number" min="0" max="100000000" step="1" inputMode="numeric" value={activeFeePlatformRule.instantDiscountWon} onChange={(event) => updateActiveSimpleDeliveryRule({ instantDiscountWon: Number(event.target.value) })} /><b>₩</b></div><small>Aksiya yo‘q bo‘lsa 0; masalan 1,000₩ yoki 2,000₩</small></label>
                </div>
              </div>
              {activeFeePlatformRule.combinedPct === undefined && <p className="form-notice">Hozir eski batafsil qoida ishlayapti. Jami foizni tekshirib saqlang — yangi buyurtmalarda shu bitta foiz ishlaydi.</p>}
              <p className="delivery-preview-note">Savdo − ushlanma foizi − yetkazish puli − chegirma = qoladigan pul. Yetkazish va chegirma har mahsulotga emas, butun buyurtmaga bir marta ayriladi.</p>
              <button className="fee-save-button" type="button" onClick={() => void saveFeeRules()}>{feeRuleBusy ? "Saqlanmoqda…" : "Ushlanma sozlamalarini saqlash"}</button>
              </fieldset>
              {feeRuleNotice && <p className={feeRuleNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{feeRuleNotice}</p>}
            </article>
            <article className="fee-day-card">
              <div className="fee-card-head"><div><span>KUNLIK HISOB</span><h3>{displayDate(feeReportDate)}</h3></div><label><span>Sana</span><input type="date" value={feeReportDate} onChange={(event) => setFeeReportDate(event.target.value)} /></label></div>
              <div className="fee-lines"><p><span>Karta / POS savdosi</span><strong>{won(feeDayReport.cardSales)}</strong></p><p><span>Delivery savdosi</span><strong>{won(feeDayReport.deliverySales)}</strong></p><p className="minus"><span>Delivery ushlanmalari</span><strong>−{won(feeDayReport.deliveryCommission)}</strong></p><p><span>Deliverydan qoladigan pul</span><strong>{won(feeDayReport.deliverySales - feeDayReport.deliveryCommission)}</strong></p><p><span>Naqd savdo</span><strong>{won(feeDayReport.cashSales)}</strong></p><p><span>Bank / hisob-raqam savdosi</span><strong>{won(feeDayReport.bankSales)}</strong></p><p className="minus"><span>Karta komissiyasi · {data.costRules.cardCommissionPct || 0}%</span><strong>−{won(feeDayReport.cardCommission)}</strong></p><p><span>Kartadan hisobga tushadigan pul</span><strong>{won(feeDayReport.cardSettlement)}</strong></p><p><span>Soliq zaxirasi hisoblanadigan savdo</span><strong>{won(feeDayReport.taxableSales)}</strong></p><p className="minus"><span>Avtomatik hisob · {data.costRules.taxPct || 0}%</span><strong>−{won(feeDayReport.tax)}</strong></p><p className="exempt"><span>Buxgalter hisoblaydigan naqd / bank / delivery savdosi</span><strong>{won(feeDayReport.accountantManagedSales)}</strong></p><p className="exempt"><span>Nosavdo ombor chiqimi</span><strong>{feeDayReport.inventoryOnlyItemCount} porsiya · {won(feeDayReport.inventoryOnlyCost)}</strong></p></div>
            </article>
          </section>
          <section className="fee-month-panel">
            <div className="fee-month-head"><div><span>TANLANGAN DAVR HISOBI</span><h3>{dateRangeLabel(sectionDateRanges.fees)} bo‘yicha avtomatik ayrilmalar</h3></div><b>{feeRangeRows.length} faol kun</b></div>
            <div className="fee-month-stats"><article><span>Barcha haqiqiy savdo</span><strong>{won(feeRangeTotals.revenue)}</strong><small>{feeRangeRows.length} savdo kuni</small></article><article><span>Karta komissiyasi</span><strong className="negative">−{won(feeRangeTotals.cardCommission)}</strong><small>{data.costRules.cardCommissionPct || 0}% · karta savdosidan</small></article><article><span>Soliq uchun reja zaxirasi</span><strong className="negative">−{won(feeRangeTotals.tax)}</strong><small>{data.costRules.taxPct || 0}% · faqat POS savdosidan</small></article><article><span>Delivery ushlanmalari</span><strong className="negative">−{won(feeRangeTotals.deliveryCommission)}</strong><small>Delivery savdosi: {won(feeRangeTotals.deliverySales)}</small></article><article className="accent"><span>Ushlanmalardan keyin</span><strong>{won(feeRangeNet)}</strong><small>Komissiya + HALO hisoblagan qism ayrilgan</small></article></div>
            <div className="fee-tax-separation"><span><i>₩</i><span><small>BUXGALTER HISOBLAYDI</small><strong>Naqd, bank va delivery savdosi</strong></span><b>{won(feeRangeTotals.revenue - feeRangeTotals.taxableSales)}</b></span><span><i>%</i><span><small>HALO AVTOMATIK HISOBI</small><strong>Faqat POS savdosi</strong></span><b>{won(feeRangeTotals.taxableSales)}</b></span></div>
            <div className="data-table fee-history-table"><div className="table-row fee-history head"><span>Sana</span><span>Jami savdo</span><span>Delivery ushlanmasi</span><span>Karta foizi</span><span>Soliq zaxirasi</span><span>Ushlanmadan keyin</span></div>{feeRangeRows.length ? feeRangeRows.map(({ date, report }) => <div className="table-row fee-history" key={date}><strong>{displayDate(date)}</strong><span>{won(report.revenue)}</span><strong className="negative">−{won(report.deliveryCommission)}</strong><strong className="negative">−{won(report.cardCommission)}</strong><strong className="negative">−{won(report.tax)}</strong><b>{won(report.revenue - report.cardCommission - report.deliveryCommission - report.tax)}</b></div>) : <div className="table-empty">Tanlangan davr uchun savdo yozuvi yo‘q.</div>}</div>
          </section>
        </div>}

        {tab === "dashboard" && userMode === "owner" && <section className="panel intake-panel"><h3>Xarid kiritmoqchimisiz?</h3><p>Omborga mahsulot, miqdor va narxni kiriting. Qarz va to‘lov — yetkazib beruvchilar bo‘limida.</p><button type="button" onClick={() => setTab("intake")}>+ HALO yordamchini ochish</button></section>}
        {tab === "intake" && userMode === "owner" && <Suspense fallback={<p>Yuklanmoqda…</p>}><IntakePanel onRemove={(id,label)=>setRemovalTarget({kind:"warehouse",id,label})} key={activeBranchId} initialDraft={intakeDraft || undefined} inventory={data.inventory.filter(i=>!i.catalogArchived)} suppliers={data.suppliers} accounts={data.accounts} transactions={data.transactions} movements={data.stockMovements} today={today} onVegetables={() => setTab("vegetables")} onMezana={() => setTab("mezana")} onInventory={(draft,name) => { setIntakeDraft(draft); setStockForm({...emptyStockForm(),name:name||""}); setEditingInventoryId(""); setTab("inventory"); window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>revealInventorySection("inventory-product-form"))); }} onManage={(id) => { setWarehouseEditingId(id || ""); setTab("inventory"); }} onSave={async (body) => {
          const branch = activeBranchRef.current;
          if (!await saveQueueRef.current || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan amalni saqlang.");
          const response = await fetch(`/api/intake?branch=${encodeURIComponent(branch)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const result = await response.json();
          if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || "Kirim saqlanmadi."), {code:result.code});
          await reloadAuthoritativeState(branch);
          setIntakeDraft(null);
        }} /></Suspense>}
        {tab === "intake" && userMode === "owner" && <Suspense fallback={<p>Yordamchi yuklanmoqda…</p>}><AssistantPanel key={activeBranchId} branchId={activeBranchId} onBefore={async () => { if (!await saveQueueRef.current || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan amalni saqlang."); }} onChanged={async () => { await reloadAuthoritativeState(activeBranchRef.current); }} /></Suspense>}
        {tab === "expenses" && userMode === "owner" && <div className="page expenses-page">
          <button type="button" className="intake-open" onClick={() => setTab("intake")}>+ Xarid / kirim — bir marta kiritish</button>
          <section className="expense-hero">
            <div><span>ALOHIDA XARAJATLAR OYNASI</span><h2>Xarajatni tez kiriting, oyliklarini HALO o‘zi yozadi.</h2><p>Ijara, internet va sug‘urta bir marta saqlanadi. Belgilangan sana kelganda har oy takroriy yozuv avtomatik yaratiladi.</p></div>
            <div className="cash-sales-rule"><i>✓</i><span><strong>Umumiy xarajatga qo‘shiladi</strong><small>Sana oralig‘i yuqoridagi alohida tahlildan boshqariladi</small></span></div>
          </section>

          <section className="expense-stats">
            <article><span>Oy pul chiqimi</span><strong>{won(selectedExpenseTotal)}</strong><small>Boshqa {won(selectedOtherExpenseTotal)} + avtomatik {won(selectedRecurringExpenseTotal)}</small></article>
            <article><span>Hisobiy foydaga ta’siri</span><strong>{won(selectedProfitExpenseTotal)}</strong><small>Maosh va mahsulot xaridi alohida hisoblanadi</small></article>
            <article><span>Avtomatik yozilgan</span><strong>{won(selectedRecurringExpenseTotal)}</strong><small>Takrorlanmagan oylik yozuvlar</small></article>
            <article className="accent"><span>Har oylik reja</span><strong>{won(monthlyRecurringPlan)}</strong><small>Faol avtomatik xarajatlar</small></article>
          </section>

          <section className="expense-reconciliation" aria-label="Avtomatik xarajat umumiy xarajatga qo‘shilishi">
            <div><i>✓</i><span><small>ANIQ JAVOB</small><strong>Ha — avtomatik oylik xarajat umumiy xarajatga qo‘shilgan.</strong><em>Faqat belgilangan sanada avtomatik yozuv yaratilgandan keyin bir marta hisoblanadi.</em></span></div>
            <p><span>Boshqa amaldagi xarajatlar<b>{won(selectedOtherExpenseTotal)}</b></span><i>＋</i><span>Avtomatik oylik yozuvlar<b>{won(selectedRecurringExpenseTotal)}</b></span><i>＝</i><span className="total">Oy pul chiqimi<b>{won(selectedExpenseTotal)}</b></span></p>
          </section>

          <section className="expense-layout">
            <article className="form-card expense-quick-card">
              <div className="form-card-head"><div><span>TEZ KIRITISH</span><h3>Bir martalik xarajat</h3></div><small>Chek yoki to‘lovni shu zahoti yozing</small></div>
              <div className="expense-quick-form">
                <label><span>Xarajat turi</span><select value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label><span>Summa</span><input type="number" min="1" inputMode="numeric" placeholder="0" value={expenseForm.amount || ""} onChange={(event) => setExpenseForm({ ...expenseForm, amount: Number(event.target.value) })} /></label>
                <label><span>Qaysi hisobdan?</span><select value={expenseForm.accountId} onChange={(event) => setExpenseForm({ ...expenseForm, accountId: event.target.value })}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                <label><span>Sana</span><input type="date" value={expenseForm.date} onChange={(event) => setExpenseForm({ ...expenseForm, date: event.target.value })} /></label>
                <label className="wide"><span>Izoh / chek raqami</span><input maxLength={200} placeholder="Ixtiyoriy" value={expenseForm.note} onChange={(event) => setExpenseForm({ ...expenseForm, note: event.target.value })} /></label>
                <button type="button" onClick={() => void addExpenseEntry()}>＋ Xarajatni saqlash</button>
              </div>
              {expenseNotice && <p className={expenseNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{expenseNotice}</p>}
            </article>

            <article className="expense-guide-card">
              <span>AVTOMATIK HISOB</span><h3>Har oy nimani kutish mumkin?</h3>
              <p>Belgilangan kuni xarajat shu hisobdan ayriladi, moliya tarixiga yoziladi va hisobiy foydaga bir marta ta’sir qiladi.</p>
              <div><b>{data.fixedExpenses.filter((expense) => expense.active && expense.automatic).length} ta</b><small>faol avtomatik xarajat</small></div>
              <button type="button" onClick={() => setTab("finance")}>Hisoblar va kun yopishga o‘tish →</button>
            </article>
          </section>

          <section className="fixed-expense-panel">
            <div className="panel-head"><div><span>DOIMIY OYLIK XARAJATLAR</span><h3>Bir marta saqlang — keyingi oylar avtomatik hisoblanadi</h3></div><b>{dueFixedExpenses.length ? `${dueFixedExpenses.length} ta muddati kelgan` : "Jadval yangilangan"}</b></div>
            <div className="fixed-expense-create labeled">
              <label><span>Nomi</span><input placeholder="Masalan: HALO ijara" value={fixedExpenseForm.name} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, name: event.target.value })} /></label>
              <label><span>Toifa</span><select value={fixedExpenseForm.category} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, category: event.target.value })}>{expenseCategories.filter((category) => category !== "Mahsulot xaridi").map((category) => <option key={category}>{category}</option>)}</select></label>
              <label><span>Har oylik summa</span><input type="number" min="1" placeholder="0" value={fixedExpenseForm.amount || ""} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, amount: Number(event.target.value) })} /></label>
              <label><span>Qaysi hisobdan?</span><select value={fixedExpenseForm.accountId} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, accountId: event.target.value })}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
              <label><span>Birinchi hisob sanasi</span><input type="date" value={fixedExpenseForm.nextDue} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, nextDue: event.target.value })} /></label>
              <label className="fixed-create-auto"><input type="checkbox" checked={fixedExpenseForm.automatic} onChange={(event) => setFixedExpenseForm({ ...fixedExpenseForm, automatic: event.target.checked })} /><span><b>Har oy avtomatik</b><small>Takroriy yozuv o‘zi yaratiladi</small></span></label>
              <button type="button" onClick={() => void addFixedExpense()}>＋ Oylik xarajatni saqlash</button>
            </div>
            {fixedExpenseNotice && <p className={fixedExpenseNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{fixedExpenseNotice}</p>}
            <div className="fixed-expense-grid">
              {data.fixedExpenses.length ? data.fixedExpenses.map((expense) => {
                const due = expense.active && expense.nextDue <= accountingToday;
                return <article className={`${due ? "due" : ""}${expense.active ? "" : " paused"}`} key={expense.id}>
                  <div className="fixed-expense-title"><span><b>{expense.automatic ? "AVTOMATIK" : due ? "TO‘LASH KERAK" : expense.active ? "QO‘LDA" : "TO‘XTATILGAN"}</b><strong>{expense.name}</strong><small>{expense.category}</small></span><div className="fixed-expense-actions"><button type="button" onClick={() => void toggleFixedExpense(expense.id)}>{expense.active ? "To‘xtatish" : "Faollashtirish"}</button><button type="button" className="archive-delete" onClick={() => deleteFixedExpense(expense)}>Savatga</button></div></div>
                  <label><span>Summa</span><input aria-label={`${expense.name} summasi`} type="number" defaultValue={expense.amount} onBlur={(event) => void updateFixedExpense(expense.id, { amount: Number(event.target.value) })} /></label>
                  <label><span>Qaysi hisobdan</span><select value={expense.accountId} onChange={(event) => void updateFixedExpense(expense.id, { accountId: event.target.value })}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                  <div className="fixed-expense-schedule"><label><span>Takrorlanishi</span><select value={expense.frequency} onChange={(event) => void updateFixedExpense(expense.id, { frequency: event.target.value as FixedExpense["frequency"] })}><option value="monthly">Har oy</option><option value="weekly">Har hafta</option><option value="daily">Har kuni</option></select></label><label><span>Keyingi hisob</span><input type="date" value={expense.nextDue} onChange={(event) => void updateFixedExpense(expense.id, { nextDue: event.target.value })} /></label></div>
                  <label className="fixed-auto-toggle"><input type="checkbox" checked={Boolean(expense.automatic)} onChange={(event) => void updateFixedExpense(expense.id, { automatic: event.target.checked })} /><span>Har oy avtomatik hisoblash</span></label>
                  {expense.lastPaidDate && <p>Oxirgi hisob: {displayDate(expense.lastPaidDate)}</p>}
                  {expense.automatic
                    ? <div className="automatic-expense-status">✓ {displayDate(expense.nextDue)} kuni keyingi yozuv yaratiladi</div>
                    : <button className="pay-fixed-expense" disabled={!expense.active || !due} type="button" onClick={() => void payFixedExpense(expense.id)}>{due ? `To‘landi — ${won(expense.amount)} minus qilish` : `Keyingi muddat: ${displayDate(expense.nextDue)}`}</button>}
                </article>;
              }) : <p className="fixed-empty">Ijara, Wi‑Fi yoki sug‘urta xarajatini yuqoridan bir marta saqlang.</p>}
            </div>
          </section>

          <section className="panel table-panel expense-history">
            <div className="panel-head expense-history-head"><div><span>XARAJATLAR TARIXI</span><h3>{dateRangeLabel(sectionDateRanges.expenses)} oralig‘idagi barcha chiqimlar</h3></div><input aria-label="Xarajatlar tarixidan qidirish" placeholder="Toifa, izoh yoki hisobdan qidiring" value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} /></div>
            <div className="data-table"><div className="table-row expense-row head"><span>Sana</span><span>Manba</span><span>Hisob</span><span>Toifa / izoh</span><span>Summa</span><span /></div>
              {selectedExpenseHistory.length ? selectedExpenseHistory.slice(0, expenseHistoryLimit).map((entry) => {
                const alreadyReversed = Boolean(entry.reversedEntryId || reversedFinancialIds.has(entry.id));
                const payrollLinked = Boolean(entry.payrollPaymentId);
                const supplierLinked = Boolean(entry.transactionId);
                const source = entry.mezanaEntryId ? "MEZANA" : entry.intakeId ? "Xarid / kirim" : entry.fixedExpenseId ? "Avtomatik" : payrollLinked ? "Maosh" : supplierLinked ? "Oldi-berdi" : "Kiritilgan";
                return <div className={`table-row expense-row${alreadyReversed ? " reversal" : ""}`} key={entry.id}><strong>{displayDate(entry.date)}</strong><b className={entry.fixedExpenseId ? "automatic" : "manual"}>{source}</b><span>{accountName(entry.accountId)}</span><span>{entry.category}{entry.note ? ` · ${entry.note}` : ""}{entry.fixedExpenseDueDate ? ` · ${displayDate(entry.fixedExpenseDueDate)} davri` : ""}</span><strong className="negative">−{won(entry.amount)}</strong><button className="row-action remove-record" disabled={alreadyReversed || Boolean(entry.cancelledAt)} onClick={()=>setRemovalTarget({kind:"finance",id:entry.id,label:`${entry.category} · ${won(entry.amount)}`})}>{alreadyReversed || entry.cancelledAt ? "Olib tashlangan" : "Olib tashlash"}</button></div>;
              }) : <div className="table-empty">Tanlangan oyda xarajat topilmadi.</div>}
            </div>
            {selectedExpenseHistory.length > expenseHistoryLimit && <button type="button" className="stock-history-more" onClick={() => setExpenseHistoryLimit((current) => current + 100)}>Yana 100 ta xarajatni ko‘rsatish</button>}
          </section>
        </div>}

        {tab === "finance" && <div className="page">
          <section className="finance-hero">
            <div><span>MOLIYAVIY NAZORAT</span><h2>Hisoblar, daromad va kun yopish.</h2><p>Xarajatlar endi alohida oynada tez va tartibli kiritiladi.</p><button className="finance-expense-link" type="button" onClick={() => setTab("expenses")}>Xarajatlar oynasini ochish →</button></div>
            <div><small>Bugungi haqiqiy hisobiy foyda</small><strong className={todayNetProfit >= 0 ? "positive" : "negative"}>{won(todayNetProfit)}</strong><b>{won(todayProfit)} yalpi foyda − {won(todayTotalExpenses)} jami xarajat</b></div>
          </section>

          <section className="account-grid">
            {data.accounts.map((account) => <article key={account.id}><span>{account.type === "cash" ? "NAQD" : account.type === "bank" ? "BANK" : account.type === "card" ? "POS" : "YETKAZIB BERISH"}</span><h3>{account.name}</h3><strong>{won(accountBalance(account.id))}</strong><label><small>Boshlang‘ich qoldiq</small><input aria-label={`${account.name} boshlang‘ich qoldig‘i`} type="number" defaultValue={account.openingBalance} onBlur={(e) => updateOpeningBalance(account.id, Number(e.target.value))} /></label></article>)}
          </section>

          <section className="finance-grid">
            <article className="form-card finance-entry-card">
              <div className="form-card-head"><div><span>PUL HARAKATI</span><h3>Daromad yoki hisoblar orasida</h3></div><small>Xarajat kiritish uchun alohida “Xarajatlar” oynasidan foydalaning</small></div>
              <div className="finance-type-tabs two">
                <button className={financeForm.type === "income" ? "active" : ""} onClick={() => setFinanceForm({ ...financeForm, type: "income", category: "Boshqa daromad" })}>Boshqa daromad</button>
                <button className={financeForm.type === "transfer" ? "active" : ""} onClick={() => setFinanceForm({ ...financeForm, type: "transfer" })}>Hisoblar orasida</button>
              </div>
              <div className="finance-entry-form">
                {financeForm.type === "income"
                    ? <input placeholder="Daromad nomi" value={financeForm.category} onChange={(e) => setFinanceForm({ ...financeForm, category: e.target.value })} />
                    : <div className="transfer-label">Pul o‘tkazish</div>}
                <input type="number" placeholder="Summa" value={financeForm.amount || ""} onChange={(e) => setFinanceForm({ ...financeForm, amount: Number(e.target.value) })} />
                <select value={financeForm.accountId} onChange={(e) => setFinanceForm({ ...financeForm, accountId: e.target.value })}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{financeForm.type === "transfer" ? "Qayerdan: " : ""}{account.name}</option>)}</select>
                {financeForm.type === "transfer" && <select value={financeForm.toAccountId} onChange={(e) => setFinanceForm({ ...financeForm, toAccountId: e.target.value })}>{data.accounts.map((account) => <option value={account.id} key={account.id}>Qayerga: {account.name}</option>)}</select>}
                <input type="date" value={financeForm.date} onChange={(e) => setFinanceForm({ ...financeForm, date: e.target.value })} />
                <input placeholder="Izoh yoki chek raqami" value={financeForm.note} onChange={(e) => setFinanceForm({ ...financeForm, note: e.target.value })} />
                <button onClick={addFinancialEntry}>Saqlash</button>
              </div>
              {financeNotice && <p className={financeNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{financeNotice}</p>}
            </article>

            <article className="form-card close-card" id="daily-close">
              <div className="form-card-head"><div><span>KUN YOPISH · 마감</span><h3>Hisoblarni solishtirish</h3></div><small>Dasturdagi summa bilan haqiqiy kassani solishtiring</small></div>
              <p>1. Bugungi savdo, kirim va xarajatlar kiritilganini tekshiring. 2. Kassa va bankdagi haqiqiy qoldiqni yozing. 3. Har bir farq sababini yozib kunni yoping.</p>
              <input className="close-date" aria-label="Yopiladigan kun" type="date" max={today} disabled={closeSaving} value={closeForm.date} onChange={(e) => { setCloseForm({ ...closeForm, date: e.target.value, actualByAccount: {}, note: "" }); setCloseNotice(""); }} />
              <div className="close-accounts">
                {data.accounts.map((account) => { const amountEntered = Object.prototype.hasOwnProperty.call(closeForm.actualByAccount, account.id); return <label className={amountEntered ? "entered" : "missing"} key={account.id}><span><strong>{account.name}</strong><small>Dasturda: {won(closeExpectedByAccount[account.id] ?? 0)}</small>{amountEntered && <small>Farq: {won(closeForm.actualByAccount[account.id] - (closeExpectedByAccount[account.id] ?? 0))}</small>}</span><input aria-label={`${account.name} haqiqiy summa`} aria-invalid={!amountEntered} type="number" inputMode="numeric" min="0" placeholder="0 ham kiriting" disabled={closeSaving} value={amountEntered ? closeForm.actualByAccount[account.id] : ""} onChange={(e) => { const rawValue = e.target.value; setCloseForm((current) => { const actualByAccount = { ...current.actualByAccount }; if (rawValue === "") delete actualByAccount[account.id]; else actualByAccount[account.id] = Number(rawValue); return { ...current, actualByAccount }; }); setCloseNotice(""); }} /></label>; })}
              </div>
              {!closeAccountsComplete && <p className="close-form-help">Har bir hisobni sanab kiriting. Haqiqiy qoldiq bo‘lmasa ham <b>0</b> yozing.</p>}
              <div className="close-summary"><p><span>Dastur bo‘yicha</span><strong>{won(closeExpectedTotal)}</strong></p><p><span>Haqiqiy summa</span><strong>{closeAccountsComplete ? won(closeActualTotal) : "To‘liq kiriting"}</strong></p><p className={closeAccountsComplete && closeDifference === 0 ? "ok" : "warning"}><span>Farq</span><strong>{closeAccountsComplete ? won(closeDifference) : "—"}</strong></p><p><span>Hisobiy foyda</span><strong>{won(closeNetProfit)}</strong></p></div>
              <input aria-label="Kassa farqi sababi" aria-required={closeHasAccountDifference} disabled={closeSaving} placeholder={closeHasAccountDifference ? "Farq sababini yozish majburiy" : "Izoh · ixtiyoriy"} value={closeForm.note} onChange={(e) => { setCloseForm({ ...closeForm, note: e.target.value }); setCloseNotice(""); }} />
              <button className="close-button" disabled={closeSaving} onClick={() => void closeDay()}>{closeSaving ? "Kun yakuni saqlanmoqda…" : "Tekshirish va kunni yopish"}</button>
              {closeNotice && <p role={closeNotice.startsWith("✓") ? "status" : "alert"} aria-live="polite" className={closeNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{closeNotice}</p>}
            </article>
          </section>

          <section className="panel table-panel finance-history"><div className="panel-head"><div><span>PUL TARIXI</span><h3>Bekor qilish va qaytarish bilan himoyalangan yozuvlar</h3></div></div>
            <div className="data-table"><div className="table-row finance-row head"><span>Sana</span><span>Turi</span><span>Hisob</span><span>Toifa / izoh</span><span>Summa</span><span /></div>
              {financeRangeEntries.length ? financeRangeEntries.slice(0, financeHistoryLimit).map((entry) => { const payrollLinked = Boolean(entry.payrollPaymentId); const supplierLinked = Boolean(entry.transactionId); return <div className="table-row finance-row" key={entry.id}><span>{displayDate(entry.date)}</span><b className={entry.type}>{entry.type === "expense" ? "Xarajat" : entry.type === "income" ? "Daromad" : "O‘tkazma"}</b><span>{entry.mezanaEntryId ? "MEZANA qarzi" : accountName(entry.accountId)}{entry.toAccountId ? ` → ${accountName(entry.toAccountId)}` : ""}</span><span>{entry.category}{entry.note ? ` · ${entry.note}` : ""}{!entry.affectsProfit && entry.type !== "transfer" ? payrollLinked ? " · Hisobiy foydada oldin hisoblangan" : " · Tannarxda hisoblanadi" : ""}</span><strong className={entry.type === "expense" ? "negative" : entry.type === "income" ? "positive" : ""}>{entry.type === "expense" ? "−" : entry.type === "income" ? "＋" : ""}{won(entry.amount)}</strong><button className="row-action remove-record" onClick={()=>setRemovalTarget({kind:"finance",id:entry.id,label:`${entry.category} · ${won(entry.amount)}`})}>Olib tashlash</button></div>; }) : <div className="table-empty">Tanlangan sanada pul harakati yo‘q.</div>}
            </div>
            {financeRangeEntries.length > financeHistoryLimit && <button type="button" className="stock-history-more" onClick={() => setFinanceHistoryLimit((current) => current + 100)}>Yana 100 ta pul harakatini ko‘rsatish</button>}
          </section>

          <section className="panel table-panel close-history"><div className="panel-head"><div><span>KUN YOPISH TARIXI</span><h3>Oldingi yopilgan kunlar</h3></div></div>
            <div className="data-table"><div className="table-row close-row head"><span>Sana</span><span>Dasturda</span><span>Haqiqiy</span><span>Farq</span><span>Hisobiy foyda</span><span>Izoh</span></div>
              {financeRangeCloses.length ? financeRangeCloses.slice(0, closeHistoryLimit).map((close) => <div className="table-row close-row" key={close.id}><strong>{displayDate(close.date)}</strong><span>{won(close.expectedTotal)}</span><span>{won(close.actualTotal)}</span><strong className={close.difference === 0 ? "positive" : "negative"}>{won(close.difference)}</strong><strong>{won(close.netProfit)}</strong><span className="row-actions-inline"><span>{close.note || "—"}</span><button className="archive-delete" onClick={() => deleteDailyClose(close)}>Savatga</button></span></div>) : <div className="table-empty">Tanlangan sanada kun yopish yozuvi yo‘q.</div>}
            </div>
            {financeRangeCloses.length > closeHistoryLimit && <button type="button" className="stock-history-more" onClick={() => setCloseHistoryLimit((current) => current + 100)}>Yana 100 ta kunni ko‘rsatish</button>}
          </section>
        </div>}

        {tab === "oil" && userMode === "owner" && <div className="page oil-page">
          <section className="oil-hero">
            <div><span>CHICKEN MOYI HISOBI</span><h2>Har safargi olish va sotish narxi alohida saqlanadi.</h2><p>Har bir kanistr 18 L. Narx o‘zgarsa yangi yozuvda o‘sha kundagi narxni kiriting. HALO o‘rtacha olish narxi, o‘rtacha sotish narxi, farqi va sof moy xarajatini avtomatik hisoblaydi. Ikkalasi POS savdosiga yoki soliq bazasiga qo‘shilmaydi.</p></div>
            <div className="oil-formula"><span><b>{won(oilRangeSummary.averagePurchaseUnitAmount)}</b><small>o‘rtacha olish</small></span><i>→</i><span><b>{won(oilRangeSummary.averageResaleUnitAmount)}</b><small>o‘rtacha sotish</small></span><i>=</i><span className={oilRangeSummary.averageUnitDifference >= 0 ? "profit" : "cost"}><b>{oilRangeSummary.averageUnitDifference >= 0 ? "+" : "−"}{won(Math.abs(oilRangeSummary.averageUnitDifference))}</b><small>1 kanistr narx farqi</small></span></div>
          </section>

          <section className="oil-layout">
            <article className="oil-entry-card">
              <div className="oil-card-head"><div><span>YANGI YOZUV</span><h3>{oilForm.type === "purchase" ? "Chicken moyi keldi" : "Ishlatilgan moy sotildi"}</h3></div><b>1 kanistr = {CHICKEN_OIL_CAN_LITERS} L</b></div>
              <div className="oil-type-tabs">
                <button type="button" className={oilForm.type === "purchase" ? "active purchase" : ""} onClick={() => { setOilForm({ ...oilForm, type: "purchase" }); setOilNotice(""); }}><i>−</i><span><strong>Yangi moy olindi</strong><small>Xarajatga yoziladi</small></span></button>
                <button type="button" className={oilForm.type === "resale" ? "active resale" : ""} onClick={() => { setOilForm({ ...oilForm, type: "resale" }); setOilNotice(""); }}><i>＋</i><span><strong>Ishlatilgan moy sotildi</strong><small>Kirimga yoziladi</small></span></button>
              </div>
              <div className="oil-entry-form">
                <label><span>18 L kanistr soni</span><input type="number" min="1" max="10000" step="1" inputMode="numeric" value={oilForm.canCount || ""} onChange={(event) => setOilForm({ ...oilForm, canCount: Number(event.target.value) })} /></label>
                <label><span>1 kanistr {oilForm.type === "purchase" ? "kelgan" : "sotilgan"} narxi</span><small>Har safar o‘sha kundagi narxni kiriting</small><input type="number" min="1" step="1" inputMode="numeric" placeholder="0" value={oilForm.unitAmount || ""} onChange={(event) => setOilForm({ ...oilForm, unitAmount: Number(event.target.value) })} /></label>
                <label><span>Sana</span><input type="date" value={oilForm.date} onChange={(event) => setOilForm({ ...oilForm, date: event.target.value })} /></label>
                <label><span>{oilForm.type === "purchase" ? "Qaysi hisobdan to‘landi?" : "Pul qaysi hisobga tushdi?"}</span><select value={oilForm.accountId} onChange={(event) => setOilForm({ ...oilForm, accountId: event.target.value })}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                <label className="wide"><span>Izoh</span><input maxLength={200} placeholder="Ixtiyoriy" value={oilForm.note} onChange={(event) => setOilForm({ ...oilForm, note: event.target.value })} /></label>
              </div>
              <div className={`oil-total ${oilForm.type}`}><span><small>Hisoblanadigan miqdor</small><strong>{Number(oilForm.canCount || 0).toLocaleString()} ta × {CHICKEN_OIL_CAN_LITERS} L = {(Number(oilForm.canCount || 0) * CHICKEN_OIL_CAN_LITERS).toLocaleString()} L</strong></span><span><small>{oilForm.type === "purchase" ? "Jami xarajat" : "Jami kirim"}</small><strong>{oilForm.type === "purchase" ? "−" : "+"}{won(oilFormTotal)}</strong></span></div>
              <button className={`oil-save ${oilForm.type}`} type="button" disabled={oilSaving} onClick={() => void saveOilEntry()}>{oilSaving ? "Saqlanmoqda…" : oilForm.type === "purchase" ? "Yangi moy xarajatini saqlash" : "Ishlatilgan moy kirimini saqlash"}</button>
              {oilNotice && <p className={oilNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{oilNotice}</p>}
            </article>

            <aside className="oil-rules-card">
              <span>HISOB QOIDASI</span><h3>Takroriy hisob yo‘q</h3>
              <div><i>1</i><p><b>Yangi moy</b><small>Pul hisobidan ayriladi va hisobiy foydada bir marta xarajat bo‘ladi.</small></p></div>
              <div><i>2</i><p><b>Ishlatilgan moy sotuvi</b><small>Pul hisobiga qo‘shiladi va boshqa kirim sifatida foydani oshiradi.</small></p></div>
              <div><i>3</i><p><b>POS va soliqdan alohida</b><small>Bu yozuvlar savdo aylanmasi hamda avtomatik soliq bazasiga kirmaydi.</small></p></div>
              <p className="oil-rule-result"><span>Tanlangan davr hisoboti</span><b>O‘rtacha: {won(oilRangeSummary.averagePurchaseUnitAmount)} olish → {won(oilRangeSummary.averageResaleUnitAmount)} sotish · farq {oilRangeSummary.averageUnitDifference >= 0 ? "+" : "−"}{won(Math.abs(oilRangeSummary.averageUnitDifference))}</b><b>{won(oilRangeSummary.purchaseCost)} jami xarajat − {won(oilRangeSummary.resaleIncome)} jami kirim = {won(oilRangeSummary.netOilCost)} sof xarajat</b></p>
            </aside>
          </section>

          <section className="panel table-panel oil-history-panel">
            <div className="panel-head"><div><span>{dateRangeLabel(sectionDateRanges.oil)}</span><h3>Chicken moyi kirim-chiqim tarixi</h3></div><b>{oilRangeEntries.length} yozuv</b></div>
            <div className="data-table"><div className="table-row oil-history head"><span>Sana</span><span>Harakat</span><span>Miqdor</span><span>1 kanistr narxi</span><span>Hisob</span><span>Jami</span><span /></div>
              {oilRangeEntries.length ? oilRangeEntries.slice().sort((left, right) => `${right.date}|${right.id}`.localeCompare(`${left.date}|${left.id}`)).map((entry) => <div className="table-row oil-history" key={entry.id}><strong>{displayDate(entry.date)}</strong><b className={entry.oilFlowType === "purchase" ? "purchase" : "resale"}>{entry.oilFlowType === "purchase" ? "Yangi moy" : "Ishlatilgan moy sotuvi"}</b><span>{entry.oilCanCount} ta · {entry.oilLiters} L</span><span>{won(entry.oilUnitAmount || 0)}</span><span>{accountName(entry.accountId)}{entry.note ? <small>{entry.note}</small> : null}</span><strong className={entry.oilFlowType === "purchase" ? "negative" : "positive"}>{entry.oilFlowType === "purchase" ? "−" : "+"}{won(entry.amount)}</strong><button className="row-action" type="button" onClick={() => void reverseFinancialEntry(entry.id)}>Bekor qilish</button></div>) : <div className="table-empty">Tanlangan davrda Chicken moyi yozuvi yo‘q.</div>}
            </div>
          </section>
        </div>}

        {tab === "reports" && userMode === "owner" && <div className="page report-center-page">
          <section className="panel report-source-panel"><h2>Raqam qayerdan keladi?</h2><p>{displayDate(today)} · Savdo va xarajat bugungi kun uchun, pul va qarz esa hozirgi qoldiq.</p><div className="report-source-grid">
            <button type="button" onClick={() => setTab("sales")}><span>Bugungi jami savdo</span><strong>{won(todayRevenue)}</strong><small>POS, naqd / hisob va delivery yozuvlari →</small></button>
            <button type="button" onClick={() => setTab("expenses")}><span>Bugungi jami xarajat</span><strong>{won(todayTotalExpenses)}</strong><small>Qo‘lda va avtomatik xarajatlar →</small></button>
            <button type="button" onClick={() => setTab("finance")}><span>{accountBalances.unmatched.length ? "Hisoblangan pul · to‘liq emas" : "Hozir hisoblardagi pul"}</span><strong>{won(totalAccountBalance)}</strong><small>{accountBalances.unmatched.length ? `${accountBalances.unmatched.length} ta yozuvning pul hisobi topilmadi` : "Kassa va bank kirim–chiqimi →"}</small></button>
            <button type="button" onClick={() => setTab("suppliers")}><span>Hozir yetkazuvchilarga qarz</span><strong>{won(totalSupplierDebt)}</strong><small>Xaridlar, to‘lovlar va qoldiq →</small></button>
          </div><p>Hisobiy foyda = savdo + boshqa daromad − tannarx − xarajatlar. Hisobdagi pul va yetkazuvchiga qarz alohida ko‘rsatkichlar.</p></section>

          <section className="telegram-hero">
            <div className="telegram-mark">✈</div>
            <div><span>TELEGRAM HISOBOT MARKAZI</span><h2>Kunlik hisobot · {telegramSettings.reportTime} da</h2><p>Vaqt Seul bo‘yicha. {telegramSettings.reportTime < "12:00" ? "Oldingi kun" : "Shu kun"} hisoboti yuboriladi. Sayt yopiq paytda ishlashi uchun Google Sheets avtomatik sinxronlash jadvali yoqilgan bo‘lishi kerak. Xarid tavsiyasi hisobotda ko‘rinadi; yetkazib beruvchiga buyurtma alohida tugma bilan yuboriladi.</p></div>
            <div className={`telegram-status-card ${telegramSettings.configured && telegramSettings.enabled ? "connected" : ""}`}>
              <i />
              <span><b>{telegramSettings.configured ? telegramSettings.botName || "Telegram bot ulangan" : "Bot hali ulanmagan"}</b><small>{telegramSettings.configured && telegramSettings.enabled ? `Har kuni ${telegramSettings.reportTime} · ${telegramSettings.reportTime < "12:00" ? "oldingi kun" : "shu kun"}` : "3 qadamda ulang"}</small></span>
            </div>
          </section>

          <section className="report-center-grid">
            <article className="telegram-report-card">
              <div className="telegram-card-head"><div><span>KALENDAR KUNI HISOBOTI</span><h3>{displayDate(today)} · 00:00–23:59</h3></div><div className="telegram-report-actions"><button className="order-button" disabled={!telegramSettings.configured || !purchaseItems.length || telegramBusy === "orders"} onClick={() => void sendTelegramOrders()}>{telegramBusy === "orders" ? "Yuborilmoqda…" : "Buyurtmani yuborish"}</button><button disabled={!telegramSettings.configured || telegramBusy === "send"} onClick={() => void sendTelegramReport()}>{telegramBusy === "send" ? "Yuborilmoqda…" : "Hisobotni yuborish ↗"}</button></div></div>
              <div className="telegram-metrics">
                <div><span>Jami savdo</span><strong>{won(todayRevenue)}</strong><small>{todayItems} ta mahsulot</small></div>
                <div><span>Tannarx</span><strong>{won(todayCost)}</strong><small>Sotilgan taomlar</small></div>
                <div><span>Jami xarajat</span><strong className={todayTotalExpenses < 0 ? "positive" : "negative"}>{formatExpenseEffectWon(todayTotalExpenses)}</strong><small>Qo‘lda {won(todayEnteredExpenses)} + oylik avtomatik {won(todayRecurringExpenses)} + maosh/foiz {won(todayAutomaticCosts)}</small></div>
                <div className="primary"><span>Hisobiy foyda</span><strong className={todayNetProfit >= 0 ? "positive" : "negative"}>{won(todayNetProfit)}</strong><small>{todayRevenue ? `${((todayNetProfit / todayRevenue) * 100).toFixed(1)}% sof marja` : "Savdo kiritilmagan"}</small></div>
                <div><span>{accountBalances.unmatched.length ? "Hisoblangan pul · to‘liq emas" : "Hisoblardagi pul"}</span><strong>{won(totalAccountBalance)}</strong><small>{data.accounts.length} ta hisob</small></div>
                <div><span>Yetkazuvchi qarzi</span><strong className={totalSupplierDebt > 0 ? "negative" : "positive"}>{won(totalSupplierDebt)}</strong><small>{supplierDebtAccountCount} ta ochiq hisob</small></div>
              </div>

              <div className="telegram-report-details">
                <div><span>🏦 HISOBLAR</span>{data.accounts.map((account) => <p key={account.id}><small>{account.name}</small><strong>{won(accountBalance(account.id))}</strong></p>)}<p className="total"><small>Jami</small><strong>{won(totalAccountBalance)}</strong></p></div>
                <div><span>📦 NAZORAT</span><p><small>Ombor qiymati</small><strong>{won(inventoryValue)}</strong></p><p><small>Kamaygan / olish kerak</small><strong className={purchaseItems.length ? "negative" : "positive"}>{purchaseItems.length} ta</strong></p><p><small>Xarid tavsiyasi tayyor</small><strong className={autoOrderGroups.length ? "positive" : ""}>{autoOrderGroups.length} ta yetkazuvchi</strong></p><p><small>TOP taom</small><strong>{topTodayRecipe ? `${recipeName(topTodayRecipe[0])} · ${topTodayRecipe[1]} ta` : "Savdo yo‘q"}</strong></p></div>
              </div>

              <div className="auto-order-report">
                <div className="auto-order-report-head"><span>🛒 XARID TAVSIYASI</span><b className={purchaseItems.length ? "warning" : "ready"}>{purchaseItems.length ? `${purchaseItems.length} ta mahsulot kerak` : "HAMMASI YETARLI"}</b></div>
                {purchaseItems.length ? <div className="auto-order-groups">
                  {haloPurchaseGroups.map((group) => <div key={group.supplier.id}><span><strong>{group.supplier.name}</strong><small>{group.supplier.autoOrder && group.supplier.telegramChatId ? "«Buyurtmani yuborish» tugmasi orqali" : "Oldi-berdi bo‘limida Telegramni ulang"}</small></span><b>{group.items.map((item) => `${item.name} — ${Math.ceil(item.buyQuantity).toLocaleString()} ${item.unit}`).join(" · ")}</b></div>)}
                  {unassignedPurchases.length > 0 && <div><span><strong>Yetkazib beruvchi belgilanmagan</strong><small>Omborda yetkazib beruvchini tanlang</small></span><b>{unassignedPurchases.map((item) => `${item.name} — ${Math.ceil(item.buyQuantity).toLocaleString()} ${item.unit}`).join(" · ")}</b></div>}
                </div> : <p>✓ Ombordagi qoldiq hozircha yetarli. Buyurtma yuborilmaydi.</p>}
              </div>

              <div className="telegram-preview">
                <div className="telegram-preview-top"><span>Telegramda shunday ko‘rinadi</span><b>HALO BOT</b></div>
                <pre>{dailyReportMessage}</pre>
              </div>
            </article>

            <aside className="telegram-setup-card">
              <div className="telegram-card-head"><div><span>BOTNI ULASH</span><h3>Bir marta sozlanadi</h3></div><b className={telegramSettings.configured ? "ready" : ""}>{telegramSettings.configured ? "ULANGAN" : "SOZLANMAGAN"}</b></div>
              <ol className="telegram-steps">
                <li><b>1</b><span><a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> ichida <strong>/newbot</strong> yuboring va tokenni oling.</span></li>
                <li><b>2</b><span>Yangi botingizga oddiy <strong>“Salom”</strong> xabarini yuboring.</span></li>
                <li><b>3</b><span>Tokenni kiriting va <strong>Chat ID topish</strong> tugmasini bosing.</span></li>
              </ol>

              <div className="telegram-form">
                <label><span>Bot tokeni</span><input type="password" autoComplete="off" placeholder={telegramSettings.tokenSaved ? "Token saqlangan · almashtirish uchun yozing" : "123456789:AA..."} value={telegramForm.botToken} onChange={(event) => setTelegramForm({ ...telegramForm, botToken: event.target.value })} /></label>
                <button className="secondary" disabled={telegramBusy === "discover" || (!telegramForm.botToken && !telegramSettings.tokenSaved)} onClick={() => void discoverTelegramChat()}>{telegramBusy === "discover" ? "Qidirilmoqda…" : "Chat ID topish"}</button>
                <label><span>Telegram Chat ID</span><input inputMode="numeric" placeholder="Avtomatik topiladi" value={telegramForm.chatId} onChange={(event) => setTelegramForm({ ...telegramForm, chatId: event.target.value })} /></label>
                <label><span>Har kungi hisobot vaqti</span><input type="time" value={telegramForm.reportTime} onChange={(event) => setTelegramForm({ ...telegramForm, reportTime: event.target.value })} /></label>
                <label className="telegram-toggle"><input type="checkbox" checked={telegramForm.enabled} onChange={(event) => setTelegramForm({ ...telegramForm, enabled: event.target.checked })} /><span><b>Rahbarga kunlik hisobot</b><small>{telegramForm.reportTime} · {telegramForm.reportTime < "12:00" ? "oldingi kun" : "shu kun"} · Seul vaqti</small></span></label>
                <button className="primary" disabled={telegramBusy === "save" || (!telegramForm.botToken && !telegramSettings.tokenSaved) || !telegramForm.chatId} onClick={() => void saveTelegramSettings()}>{telegramBusy === "save" ? "Saqlanmoqda…" : "Botni saqlash"}</button>
              </div>

              {telegramSettings.configured && <div className="telegram-test-row"><button disabled={telegramBusy === "test"} onClick={() => void testTelegram()}>{telegramBusy === "test" ? "Yuborilmoqda…" : "Sinov xabari"}</button><span>{telegramSettings.lastSentAt ? `Oxirgi hisobot: ${new Date(telegramSettings.lastSentAt).toLocaleString("uz-UZ", { timeZone: "Asia/Seoul" })}` : "Hisobot hali yuborilmagan"}</span></div>}
              {telegramSettings.deliveryStatus?.last_error && <p className="telegram-notice" role="alert">{telegramSettings.deliveryStatus.report_date}: {telegramSettings.deliveryStatus.last_error}</p>}
              {telegramNotice && <p className={`telegram-notice ${telegramNotice.startsWith("✓") ? "success" : ""}`}>{telegramNotice}</p>}
              <p className="telegram-security">🔒 Bot tokeni hisobot ma’lumotlaridan alohida saqlanadi va ekranda qayta ko‘rsatilmaydi.</p>
            </aside>
          </section>
        </div>}

        {tab === "mezana" && userMode === "owner" && <div className="page mezana-page">
          <section className="mezana-connect-hero">
            <div><div><span>MEZANA TELEGRAM YO‘NALISHLARI</span><h2>Ikki hisob — ikki alohida guruh yoki mavzu</h2></div><b className={data.mezanaSettings.telegramChatId && data.mezanaSettings.purchasedTelegramChatId ? "connected" : ""}>{data.mezanaSettings.telegramChatId && data.mezanaSettings.purchasedTelegramChatId ? "IKKALASI ULANGAN ✓" : "ULASH KERAK"}</b></div>
            <details className="mezana-connect-guide">
              <summary>Ikki guruhni ulash bo‘yicha qisqa yo‘l</summary>
              <div className="mezana-connect-steps">
                <div><i>1</i><strong>HALO botni kerakli guruhlar yoki mavzularga qo‘shing</strong></div>
                <div><i>2</i><strong>Olib turildi joyida /mezana_olib deb yozing</strong></div>
                <div><i>3</i><strong>Sotib olindi joyida /mezana_sotib deb yozing</strong></div>
              </div>
            </details>
            {!telegramSettings.tokenSaved ? <button type="button" className="mezana-connect-first" onClick={() => setTab("reports")}>1 · AVVAL HALO BOTNI ULASH →</button> : <div className="mezana-route-grid">
              <article className={data.mezanaSettings.telegramChatId ? "connected" : ""}>
                <span>OLIB TURILDI − QAYTARILDI</span>
                <h3>{data.mezanaSettings.telegramChatName || "Olib turilganlar guruhi"}</h3>
                <p>Olib turildi qo‘shiladi, qaytarildi shu hisobdan minus qilinadi.</p>
                <b>{data.mezanaSettings.telegramChatId ? "QOLDIQ: " + mezanaHeldQuantity + " ta · ULANGAN ✓" : "/mezana_olib yozing"}</b>
                <button type="button" disabled={Boolean(supplierTelegramBusy)} onClick={() => void discoverMezanaTelegram("borrowed")}>{supplierTelegramBusy === "mezana-borrowed" ? "TOPILMOQDA…" : data.mezanaSettings.telegramChatId ? "QAYTA ULASH" : "GURUHNI ULASH"}</button>
              </article>
              <article className={data.mezanaSettings.purchasedTelegramChatId ? "connected purchased" : "purchased"}>
                <span>SOTIB OLINDI · QARZ</span>
                <h3>{data.mezanaSettings.purchasedTelegramChatName || "Sotib olinganlar guruhi"}</h3>
                <p>Faqat sotib olingan mahsulotlar va MEZANA qarzi shu yerga boradi.</p>
                <b>{data.mezanaSettings.purchasedTelegramChatId ? "QARZ: " + won(mezanaCurrentBalance) + " · ULANGAN ✓" : "/mezana_sotib yozing"}</b>
                <button type="button" disabled={Boolean(supplierTelegramBusy)} onClick={() => void discoverMezanaTelegram("purchased")}>{supplierTelegramBusy === "mezana-purchased" ? "TOPILMOQDA…" : data.mezanaSettings.purchasedTelegramChatId ? "QAYTA ULASH" : "GURUHNI ULASH"}</button>
              </article>
            </div>}
            {supplierTelegramNotice && <p role="status" aria-live="polite" className={`telegram-notice supplier-telegram-notice ${supplierTelegramNotice.startsWith("✓") ? "success" : ""}`}>{supplierTelegramNotice}</p>}
          </section>
          <section className="mezana-catalog-panel">
            <div className="panel-head"><div><span>RAHBAR BELGILAYDI</span><h3>Xodim tanlaydigan MEZANA mahsulotlari</h3><p>Mahsulot rasmi, narxi va qaysi ro‘yxatda chiqishini bir marta saqlang.</p></div><b>{data.mezanaCatalog.filter((item) => item.active).length} TA FAOL</b></div>
            <div className="mezana-catalog-form">
              <label><span>Mahsulot nomi</span><input maxLength={140} value={mezanaCatalogForm.name} onChange={(event) => setMezanaCatalogForm({ ...mezanaCatalogForm, name: event.target.value })} placeholder="Masalan: Sut" /></label>
              <label><span>Xodim qayerda ko‘radi?</span><select value={mezanaCatalogForm.mode} onChange={(event) => setMezanaCatalogForm({ ...mezanaCatalogForm, mode: event.target.value as MezanaCatalogMode })}><option value="borrowed">Olib turiladigan mahsulotlar</option><option value="purchased">Sotib olinadigan mahsulotlar</option></select></label>
              <label><span>1 dona narxi</span><input type="number" min="1" step="1" value={mezanaCatalogForm.price || ""} onChange={(event) => setMezanaCatalogForm({ ...mezanaCatalogForm, price: Number(event.target.value) })} placeholder="₩0" /></label>
              <label><span>Ombordagi mahsulot</span><select value={mezanaCatalogForm.inventoryId} onChange={(e) => setMezanaCatalogForm({ ...mezanaCatalogForm, inventoryId: e.target.value, inventoryUnitsPerItem: 1 })}><option value="">Nomi bo‘yicha avtomatik topish</option>{data.inventory.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}</select><small>Sotib olindi: nom omborda bo‘lmasa, xarajatga yoziladi. Olib turildi: xarajatga yozilmaydi.</small></label>
              {mezanaCatalogForm.inventoryId && <label><span>MEZANAdagi 1 dona = necha {data.inventory.find((item) => item.id === mezanaCatalogForm.inventoryId)?.unit}?</span><input type="number" min="0.001" step="any" value={mezanaCatalogForm.inventoryUnitsPerItem || ""} onChange={(e) => setMezanaCatalogForm({ ...mezanaCatalogForm, inventoryUnitsPerItem: Number(e.target.value) })} /><small>Masalan: 1 kg qadoq = 1 000 g</small></label>}
              <label className="mezana-catalog-upload"><span>Mahsulot rasmi</span><input key={mezanaCatalogFileKey} type="file" accept={STOCK_IMAGE_ACCEPT} onChange={(event) => void chooseMezanaCatalogImage(event)} /><small>{editingMezanaCatalogId ? "Yangi rasm tanlanmasa, avvalgi rasm qoladi" : "JPG, PNG yoki WebP"}</small></label>
              {(mezanaCatalogPreview || (editingMezanaCatalogId && data.mezanaCatalog.find((item) => item.id === editingMezanaCatalogId)?.image)) && <div className="mezana-catalog-preview"><img src={mezanaCatalogPreview || `/api/stock-documents?key=${encodeURIComponent(data.mezanaCatalog.find((item) => item.id === editingMezanaCatalogId)!.image!.key)}`} alt="MEZANA mahsuloti" /></div>}
              <div className="mezana-catalog-form-actions"><button type="button" disabled={mezanaCatalogSaving} onClick={() => void saveMezanaCatalogItem()}>{mezanaCatalogSaving ? "SAQLANMOQDA…" : editingMezanaCatalogId ? "O‘ZGARISHNI SAQLASH" : "MAHSULOTNI RO‘YXATGA QO‘SHISH"}</button>{editingMezanaCatalogId && <button type="button" className="secondary" disabled={mezanaCatalogSaving} onClick={resetMezanaCatalogForm}>BEKOR QILISH</button>}</div>
            </div>
            {mezanaCatalogNotice && <p role={mezanaCatalogNotice.startsWith("✓") ? "status" : "alert"} className={mezanaCatalogNotice.startsWith("✓") ? "telegram-notice success" : "telegram-notice"}>{mezanaCatalogNotice}</p>}
            <div className="mezana-catalog-grid">{data.mezanaCatalog.map((item) => <article key={item.id} className={`${item.mode} ${item.active ? "" : "inactive"}`}>
              {item.image ? <img src={`/api/stock-documents?key=${encodeURIComponent(item.image.key)}`} alt={item.name} /> : <div className="mezana-catalog-placeholder">📦</div>}
              <div><span>{item.mode === "purchased" ? "SOTIB OLINADI" : "OLIB TURILADI"}</span><h4>{item.name}</h4><strong>{won(item.price)}</strong><small>{item.active ? "Xodimga ko‘rinadi" : "Xodimdan yashirilgan"}</small></div>
              <footer><button type="button" disabled={mezanaCatalogSaving} onClick={() => editMezanaCatalogItem(item)}>TAHRIRLASH</button><button type="button" className={item.active ? "hide" : "show"} disabled={mezanaCatalogSaving} onClick={() => void toggleMezanaCatalogItem(item)}>{item.active ? "YASHIRISH" : "QAYTA OCHISH"}</button></footer>
            </article>)}{!data.mezanaCatalog.length && <p className="table-empty">Hali mahsulot qo‘shilmagan. Xodim MEZANA amalini kirita olmaydi.</p>}</div>
          </section>
          <section className="owner-mezana-entry-panel">
            <div className="panel-head"><div><span>RAHBAR HAM KIRITADI</span><h3>MEZANAdan olingan mahsulotni kiriting</h3></div><b>HALO HISOBIDAN ALOHIDA</b></div>
            <div className="worker-choice-buttons mezana owner-mezana-choice">
              <button type="button" className={ownerMezanaForm.action === "borrowed" ? "active borrowed" : ""} onClick={() => setOwnerMezanaForm({ ...ownerMezanaForm, action: "borrowed", catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1 })}>OLIB TURILDI</button>
              <button type="button" className={ownerMezanaForm.action === "returned" ? "active returned" : ""} onClick={() => setOwnerMezanaForm({ ...ownerMezanaForm, action: "returned", catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1 })}>QAYTARIB QO‘YILDI</button>
              <button type="button" className={ownerMezanaForm.action === "purchased" ? "active purchased" : ""} onClick={() => setOwnerMezanaForm({ ...ownerMezanaForm, action: "purchased", catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1 })}>SOTIB OLINDI</button>
            </div>
            <div className="mezana-product-picker worker-mezana-product-picker owner-mezana-product-picker">
              {ownerMezanaAvailableCatalog.map((item) => <button type="button" key={item.id} className={ownerMezanaForm.catalogItemId === item.id ? "selected" : ""} onClick={() => {
                const openBalance = mezanaOpenBorrowedItems.find((open) => open.item.id === item.id)?.balance || 0;
                setOwnerMezanaForm({ ...ownerMezanaForm, catalogItemId: item.id, productName: item.name, amount: item.price, quantity: ownerMezanaForm.action === "returned" ? openBalance : 1, itemCount: 1 });
              }}>
                {item.image ? <img src={`/api/stock-documents?key=${encodeURIComponent(item.image.key)}`} alt={item.name} /> : <i className="worker-mezana-product-placeholder" aria-hidden="true">📦</i>}
                <span><strong>{item.name}</strong><small>1 dona · {won(item.price)}</small></span>
              </button>)}
              {!ownerMezanaAvailableCatalog.length && <p className="worker-notice">Bu amal uchun mahsulot ro‘yxatga qo‘shilmagan.</p>}
            </div>
            <div className="owner-mezana-form">
              {ownerMezanaForm.action === "purchased" ? <>
                <label><span>Necha dona sotib olindi?</span><input type="number" min="1" step="1" value={ownerMezanaForm.itemCount || ""} onChange={(event) => setOwnerMezanaForm({ ...ownerMezanaForm, itemCount: Number(event.target.value) })} placeholder="1" /></label>
                <label><span>Sana</span><input type="date" value={ownerMezanaForm.date} onChange={(event) => setOwnerMezanaForm({ ...ownerMezanaForm, date: event.target.value })} /></label>
                <label className="wide"><span>Izoh</span><input maxLength={300} value={ownerMezanaForm.note} onChange={(event) => setOwnerMezanaForm({ ...ownerMezanaForm, note: event.target.value })} placeholder="Ixtiyoriy" /></label>
              </> : <label className="wide"><span>Mahsulot soni</span><input type="number" min="1" step="1" value={ownerMezanaForm.quantity || ""} onChange={(event) => setOwnerMezanaForm({ ...ownerMezanaForm, quantity: Number(event.target.value) })} placeholder="Masalan: 2" /></label>}
            </div>
            <div className="worker-mezana-photo-grid owner-mezana-photos">
              <label className="worker-upload"><i>1</i><span><strong>{ownerMezanaTopFile ? ownerMezanaTopFile.name : "Asosiy rasm"}</strong><small>Ixtiyoriy · rasmsiz ham qabul qilinadi</small></span><input key={`owner-top-${ownerMezanaFileKey}`} type="file" accept={STOCK_IMAGE_ACCEPT} onChange={(event) => void chooseOwnerMezanaFile("top", event)} /></label>
              <label className="worker-upload"><i>2</i><span><strong>{ownerMezanaBottomFile ? ownerMezanaBottomFile.name : "Qo‘shimcha rasm"}</strong><small>Ixtiyoriy · uzun chek yoki ikkinchi tomon</small></span><input key={`owner-bottom-${ownerMezanaFileKey}`} type="file" accept={STOCK_IMAGE_ACCEPT} onChange={(event) => void chooseOwnerMezanaFile("bottom", event)} /></label>
            </div>
            {(ownerMezanaTopPreview || ownerMezanaBottomPreview) && <div className="worker-mezana-previews owner-mezana-previews">
              {ownerMezanaTopPreview && <div><img src={ownerMezanaTopPreview} alt="MEZANA chek yuqori qismi" /><button type="button" onClick={() => { URL.revokeObjectURL(ownerMezanaTopPreview); setOwnerMezanaTopFile(null); setOwnerMezanaTopPreview(""); setOwnerMezanaFileKey((current) => current + 1); }}>Yuqori rasmni olib tashlash</button></div>}
              {ownerMezanaBottomPreview && <div><img src={ownerMezanaBottomPreview} alt="MEZANA chek pastki qismi" /><button type="button" onClick={() => { URL.revokeObjectURL(ownerMezanaBottomPreview); setOwnerMezanaBottomFile(null); setOwnerMezanaBottomPreview(""); setOwnerMezanaFileKey((current) => current + 1); }}>Pastki rasmni olib tashlash</button></div>}
            </div>}
            <div className="worker-entry-total owner-mezana-total"><span>{ownerMezanaForm.action === "purchased" ? "MEZANA qarziga qo‘shiladi" : ownerMezanaForm.action === "returned" ? "Olib turilgan qoldiqdan ayriladi" : "Olib turilgan qoldiqqa qo‘shiladi"}</span><strong>{ownerMezanaForm.action === "purchased" ? won((ownerSelectedMezanaCatalogItem?.price || 0) * ownerMezanaForm.itemCount) : `${ownerMezanaForm.quantity || 0} ta`}</strong></div>
            {ownerMezanaNotice && <p role={ownerMezanaNotice.startsWith("✓") ? "status" : "alert"} className={ownerMezanaNotice.startsWith("✓") ? "telegram-notice supplier-telegram-notice success" : "telegram-notice supplier-telegram-notice"}>{ownerMezanaNotice}</p>}
            <button className="owner-mezana-save" type="button" disabled={ownerMezanaSaving} onClick={() => void saveOwnerMezana()}>{ownerMezanaSaving ? "SAQLANMOQDA VA YUBORILMOQDA…" : "SAQLASH VA MEZANA GURUHIGA YUBORISH"}</button>
          </section>
          <section className="worker-mezana-debt-panel">
            <div className="panel-head"><div><span>MEZANA · ALOHIDA HISOB</span><h3>Olib turildi − qaytarildi va sotib olindi qarzi</h3></div><b>{data.mezanaSettings.telegramChatId && data.mezanaSettings.purchasedTelegramChatId ? "2 YO‘NALISH ✓" : "SOZLASH KERAK"}</b></div>
            <p className="supplier-invoice-safety">Olib turildi va qaytarildi bitta miqdor hisobida yuradi. Sotib olindi esa boshqa Telegram yo‘nalishida va qarz hisobida turadi. MEZANA yozuvlari HALO xarajatlari va omboriga qo‘shilmaydi.</p>
            <div className="mezana-debt-summary">
              <div className="debt"><small>Hozirgi MEZANA qarzi</small><strong>{won(mezanaCurrentBalance)}</strong></div>
              <div><small>Hozir olib turilgan qoldiq</small><strong>{mezanaHeldQuantity} ta</strong></div>
              <div><small>Tanlangan davr · olib turildi</small><strong>{mezanaRangeBorrowedQuantity} ta</strong></div>
              <div><small>Tanlangan davr · sotib olindi</small><strong>{won(mezanaRangePurchasedTotal)}</strong></div>
              <div><small>Tanlangan davr · qaytarildi</small><strong>{mezanaRangeReturnedQuantity} ta</strong></div>
            </div>
            <div className="mezana-zero-panel">
              <div><span><b>MEZANA QARZI</b><small>To‘liq to‘langanda tarixni o‘chirmay 0 qiling</small></span><strong>{won(mezanaCurrentBalance)}</strong><button type="button" disabled={mezanaCurrentBalance <= 0 || Boolean(mezanaZeroBusy)} onClick={() => void closeMezanaBalance("paid")}>{mezanaZeroBusy === "paid" ? "SAQLANMOQDA…" : "TO‘LIQ TO‘LANDI · 0 QILISH"}</button></div>
              {mezanaOpenBorrowedItems.map(({ item, balance }) => <div key={item.id}><span><b>{item.name}</b><small>Hozir olib turilgan mahsulot</small></span><strong>{balance} ta</strong><button type="button" disabled={Boolean(mezanaZeroBusy)} onClick={() => void closeMezanaBalance("returned", item, balance)}>{mezanaZeroBusy === item.id ? "SAQLANMOQDA…" : "HAMMASI QAYTARILDI · 0 QILISH"}</button></div>)}
              {!mezanaOpenBorrowedItems.length && <p>Olib turilgan mahsulot qoldig‘i yo‘q.</p>}
            </div>
            <details className="mezana-settings-details">
              <summary>Telegram sozlamalari va qayta yuborish</summary>
              <div className="mezana-telegram-setup">
                <label><span>OLIB TURILDI + QAYTARILDI Chat ID</span><input key={data.mezanaSettings.telegramChatId} disabled={Boolean(supplierTelegramBusy)} inputMode="numeric" placeholder="/mezana_olib orqali avtomatik topiladi" defaultValue={data.mezanaSettings.telegramChatId} onBlur={(event) => { const telegramChatId = event.target.value.trim(); if (telegramChatId !== data.mezanaSettings.telegramChatId) void updateMezanaTelegram({ telegramChatId, telegramChatName: telegramChatId ? data.mezanaSettings.telegramChatName : "", telegramThreadId: telegramChatId ? data.mezanaSettings.telegramThreadId : 0 }); }} /></label>
                <label><span>SOTIB OLINDI Chat ID</span><input key={data.mezanaSettings.purchasedTelegramChatId} disabled={Boolean(supplierTelegramBusy)} inputMode="numeric" placeholder="/mezana_sotib orqali avtomatik topiladi" defaultValue={data.mezanaSettings.purchasedTelegramChatId} onBlur={(event) => { const purchasedTelegramChatId = event.target.value.trim(); if (purchasedTelegramChatId !== data.mezanaSettings.purchasedTelegramChatId) void updateMezanaTelegram({ purchasedTelegramChatId, purchasedTelegramChatName: purchasedTelegramChatId ? data.mezanaSettings.purchasedTelegramChatName : "", purchasedTelegramThreadId: purchasedTelegramChatId ? data.mezanaSettings.purchasedTelegramThreadId : 0 }); }} /></label>
                <small>Qo‘lda faqat zarur bo‘lsa Chat ID yozing. Guruh mavzusini ulash uchun yuqoridagi tugmalardan foydalaning.</small>
              </div>
              {data.mezanaSettings.telegramChatId && data.mezanaEntries.length > 0 && <button type="button" className="mezana-resend-button" disabled={Boolean(supplierTelegramBusy)} onClick={() => void resendLatestMezanaTelegram()}>{supplierTelegramBusy === "mezana-resend" ? "OXIRGI YOZUV YUBORILMOQDA…" : "↻ OXIRGI MEZANA YOZUVINI GURUHGA QAYTA YUBORISH"}</button>}

            </details>
            {mezanaEditNotice && <p role={mezanaEditNotice.startsWith("✓") ? "status" : "alert"} className={mezanaEditNotice.startsWith("✓") ? "telegram-notice supplier-telegram-notice success" : "telegram-notice supplier-telegram-notice"}>{mezanaEditNotice}</p>}
            <div className="mezana-history-head"><span><b>YOZUVLAR TARIXI</b><small>Har bir yozuvda tahrirlash va o‘chirish tugmasi bor</small></span><strong>{mezanaRangeEntries.length} ta</strong></div>
            <div className="mezana-debt-list">{mezanaRangeEntries.slice(0, 30).map((entry) => <div className={`${entry.action}${editingMezanaId === entry.id ? " editing" : ""}`} key={entry.id}>
              <span>{displayDate(entry.date)}<small>{entry.createdByName}</small></span>
              <span><b>{mezanaDebtActionLabel(entry.action)}</b>{entry.productName}{entry.note ? <small>{entry.note}</small> : null}</span>
              <span className="mezana-entry-documents">{entry.productImage && <a href={`/api/stock-documents?key=${encodeURIComponent(entry.productImage.key)}`} target="_blank" rel="noreferrer">🖼 Mahsulot rasmi</a>}{entry.documents.map((document, index) => <a href={`/api/stock-documents?key=${encodeURIComponent(document.key)}`} target="_blank" rel="noreferrer" key={document.key}>📎 {index === 0 ? "Asosiy rasm" : "Qo‘shimcha rasm"}</a>)}{!entry.productImage && !entry.documents.length && <small>Rasm biriktirilmagan</small>}{entry.unitPrice !== undefined && <small>1 dona {won(entry.unitPrice)}{entry.itemCount ? ` · ${entry.itemCount} dona` : ""}</small>}</span>
              <span className="mezana-entry-actions"><strong>{mezanaEntryValue(entry)}</strong>{entry.posting && <small>{entry.posting.kind === "stock" ? `Ombor: ${entry.posting.quantity} ${entry.posting.unit}` : entry.posting.kind === "expense" ? "Xarajatga yozildi · MEZANA qarzi" : "Faqat MEZANA hisobi"}</small>}<span>{entry.action !== "paid" && <button type="button" disabled={Boolean(mezanaDeletionBusy)} onClick={() => editMezanaEntry(entry)}>TAHRIRLASH</button>}<button type="button" className="archive-delete" disabled={Boolean(mezanaDeletionBusy)} onClick={() => setRemovalTarget({kind:"mezana",id:entry.id,label:`MEZANA · ${entry.productName}`})}>Olib tashlash</button></span></span>
              {editingMezanaId === entry.id && <div className="mezana-inline-editor">
                <label><span>Amal turi</span><select value={mezanaEditForm.action} onChange={(event) => setMezanaEditForm({ ...mezanaEditForm, action: event.target.value as MezanaDebtAction })}><option value="borrowed">Olib turildi</option><option value="returned">Qaytarib qo‘yildi</option><option value="purchased">Sotib olindi</option></select></label>
                <label><span>Mahsulot nomi</span><input value={mezanaEditForm.productName} onChange={(event) => setMezanaEditForm({ ...mezanaEditForm, productName: event.target.value })} /></label>
                {mezanaEditForm.action === "purchased" ? <label><span>Summa</span><input type="number" min="1" step="1" value={mezanaEditForm.amount || ""} onChange={(event) => setMezanaEditForm({ ...mezanaEditForm, amount: Number(event.target.value) })} /></label> : <label><span>Mahsulot soni</span><input type="number" min="1" step="1" value={mezanaEditForm.quantity || ""} onChange={(event) => setMezanaEditForm({ ...mezanaEditForm, quantity: Number(event.target.value) })} /></label>}
                <label><span>Sana</span><input type="date" value={mezanaEditForm.date} onChange={(event) => setMezanaEditForm({ ...mezanaEditForm, date: event.target.value })} /></label>
                <label className="wide"><span>Izoh</span><input value={mezanaEditForm.note} onChange={(event) => setMezanaEditForm({ ...mezanaEditForm, note: event.target.value })} /></label>
                <div className="mezana-inline-editor-actions"><button type="button" className="save" disabled={mezanaSaving} onClick={() => void saveMezanaEdit()}>{mezanaSaving ? "Saqlanmoqda…" : "O‘ZGARISHNI SAQLASH"}</button><button type="button" disabled={mezanaSaving} onClick={cancelMezanaEdit}>Bekor qilish</button></div>
              </div>}
            </div>)}{!mezanaRangeEntries.length && <p className="table-empty">Tanlangan davrda MEZANA yozuvi yo‘q.</p>}</div>
          </section>
        </div>}

        {tab === "suppliers" && <div className="page supplier-management-page">
          <section className="supplier-control-hero"><div><span>OLDI-BERDI BOSHQARUVI</span><h2>Yetkazib beruvchi qarzlari</h2><p>Qarz, avans, to‘lov va nakladnoylar bitta tartibli oynada.</p></div><div className="supplier-control-metrics"><span><small>Jami qarz</small><strong>{won(totalSupplierDebt)}</strong></span><span><small>Yetkazuvchilar</small><strong>{data.suppliers.filter((supplier) => !isMezanaSupplierName(supplier.name)).length} ta</strong></span><span><small>Tekshirish kerak</small><strong>{supplierRangeDeliveries.filter((entry) => entry.status === "submitted").length} ta</strong></span><span><small>Nakladnoylar</small><strong>{supplierInvoices.length} ta</strong></span></div></section>
          <section className="split-forms supplier-command-grid"><details className="form-card supplier-command-card" open={supplierCreateOpen} onToggle={(event) => setSupplierCreateOpen(event.currentTarget.open)}><summary><span><b>YANGI YETKAZIB BERUVCHI</b><small>Firma, telefon va bank hisobini kiriting</small></span><strong>{supplierCreateOpen ? "YOPISH −" : "OCHISH ＋"}</strong></summary><div className="form-grid supplier-create"><input placeholder="Firma nomi" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} /><input placeholder="Telefon" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} /><input placeholder="Bank nomi va hisob raqami" value={supplierForm.bankAccount} onChange={(e) => setSupplierForm({ ...supplierForm, bankAccount: e.target.value })} /><button type="button" onClick={() => void addSupplier()}>＋ Qo‘shish</button></div></details>
            <details className={`form-card supplier-command-card supplier-transaction-card ${editingTransactionId ? "editing" : ""}`} id="supplier-transaction-form" open={supplierTransactionOpen} onToggle={(event) => setSupplierTransactionOpen(event.currentTarget.open)}>
              <summary><span><b>{editingTransactionId ? "HISOB-KITOBNI TAHRIRLASH" : "QARZ YOKI TO‘LOV KIRITISH"}</b><small>{editingTransactionId ? "Xato yozuvni to‘g‘rilash" : "Mahsulot olindi — qarzga yoki darhol to‘landi"}</small></span><strong>{supplierTransactionOpen ? "YOPISH −" : "OCHISH ＋"}</strong></summary>
              <div className="form-card-head"><div><span>{editingTransactionId ? "HISOB-KITOBNI TAHRIRLASH" : "OLDI-BERDI"}</span><h3>{editingTransactionId ? "Xato yozuvni to‘g‘rilash" : "Oldi-berdi kiritish"}</h3></div><small>{editingTransactionId ? "Summa, sana va izoh yangilanadi; yozuv turi va nakladnoy tarixi saqlanadi" : "Mahsulot qoldig‘i “Ombor” bo‘limida kirim qilinadi"}</small></div>
              <div className="form-grid supplier-transaction">
                <select value={transactionForm.supplierId} onChange={(e) => setTransactionForm({ ...transactionForm, supplierId: e.target.value })}><option value="">Yetkazib beruvchi</option>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                <select value={transactionForm.type} disabled={Boolean(editingTransactionId)} title={editingTransactionId ? "Nakladnoy tarixini saqlash uchun yozuv turi o‘zgartirilmaydi" : undefined} onChange={(e) => setTransactionForm({ ...transactionForm, type: e.target.value as "purchase" | "payment" })}><option value="purchase">Mahsulot olindi</option><option value="payment">Oldingi qarzdan pul to‘landi</option></select>
                {transactionForm.type === "purchase" && !editingTransactionId && <select aria-label="To‘lov holati" value={transactionForm.settlementMode} onChange={(event) => setTransactionForm({ ...transactionForm, settlementMode: event.target.value as "debt" | "paid" })}><option value="debt">Qarzga olindi</option><option value="paid">Darhol to‘landi</option></select>}
                <input type="number" min="0" placeholder="Summa" value={transactionForm.amount || ""} onChange={(e) => setTransactionForm({ ...transactionForm, amount: Number(e.target.value) })} />
                <select value={transactionForm.accountId} disabled={transactionForm.type !== "payment" && transactionForm.settlementMode !== "paid"} onChange={(e) => setTransactionForm({ ...transactionForm, accountId: e.target.value })}><option value="">Qaysi hisobdan to‘landi?</option>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select>
                <input type="date" value={transactionForm.date} onChange={(e) => setTransactionForm({ ...transactionForm, date: e.target.value })} />
                <input placeholder="Izoh" value={transactionForm.note} onChange={(e) => setTransactionForm({ ...transactionForm, note: e.target.value })} />
                <button type="button" disabled={transactionSaving || supplierDuplicateWarning} onClick={() => void saveSupplierTransaction()}>{transactionSaving ? "Saqlanmoqda…" : editingTransactionId ? "O‘zgarishni saqlash" : "Saqlash"}</button>
              </div>
              {!editingTransactionId && <p className="supplier-simple-flow"><b>Eng oson tartib:</b> mahsulot miqdori va narxini Omborga kiriting. Bu yerda faqat xarid qarzi va to‘lovni yuriting. Bu oynadagi yozuv mahsulotni omborga yana qo‘shmaydi.</p>}
              {transactionForm.type === "purchase" && <div className="movement-document-field transaction-document-field">
                <label className="movement-document-picker"><span>📎 Nakladnoy rasmi</span><small>Telefon yoki galereya · JPG, PNG, WebP, HEIC · avtomatik siqiladi</small><input key={transactionFileInputKey} type="file" accept={STOCK_IMAGE_ACCEPT} onChange={chooseTransactionDocument} /></label>
                {(transactionDocumentPreview || (editingTransaction?.document && !removeTransactionDocument)) && <div className="movement-document-preview transaction-document-preview">
                  <img src={transactionDocumentPreview || `/api/stock-documents?key=${encodeURIComponent(editingTransaction?.document?.key || "")}`} alt="Oldi-berdi nakladnoy rasmi" />
                  <span><b>{transactionDocumentFile?.name || editingTransaction?.document?.fileName}</b><small>{transactionDocumentFile ? "Yangi rasm saqlashga tayyor" : "Avval saqlangan nakladnoy"}</small></span>
                  <button type="button" onClick={() => { supplierPendingDocumentRef.current = undefined; setTransactionDocumentFile(null); setTransactionDocumentPreview(""); setRemoveTransactionDocument(Boolean(editingTransaction?.document)); setTransactionFileInputKey((current) => current + 1); }}>Rasmni olib tashlash</button>
                </div>}
              </div>}
              {editingTransaction && data.suppliers.find(s => s.id === editingTransaction.supplierId) && <SupplierCancellationPanel key={`${activeBranchId}:${editingTransaction.id}`} transaction={editingTransaction} supplier={data.suppliers.find(s => s.id === editingTransaction.supplierId)!} state={data} busy={transactionSaving} onConfirm={async (body) => {
                if (supplierTransactionBusyRef.current) throw new Error("Oldingi amal tugashini kuting.");
                supplierTransactionBusyRef.current = true; setTransactionSaving(true);
                try {
                  await saveAtomicSupplierRecord(body);
                  resetTransactionDraft();
                  setTransactionNotice("✓ Tanlangan yozuv bekor qilindi. Qarz qayta hisoblandi; asl yozuv va sababi ‘Bekor qilinganlar’ tarixida saqlandi.");
                } finally { supplierTransactionBusyRef.current = false; setTransactionSaving(false); }
              }} />}
              {editingTransactionId && <button type="button" className="transaction-cancel-edit" disabled={transactionSaving} onClick={() => { resetTransactionDraft(); setTransactionNotice("Tahrirlash bekor qilindi."); }}>Tahrirlashni bekor qilish</button>}
              {supplierDuplicateWarning && <div className="form-notice"><b>O‘xshash yozuv oldin saqlangan.</b><p>O‘sha xarid bo‘lsa, qayta saqlamang. Bu alohida xarid yoki to‘lov bo‘lsa, sababini yozib tasdiqlang.</p><label>Sabab<input value={supplierDuplicateReason} maxLength={300} onChange={e=>setSupplierDuplicateReason(e.target.value)} placeholder="Masalan: shu kuni ikkinchi yetkazma keldi" /></label><button type="button" disabled={transactionSaving || supplierDuplicateReason.trim().length < 5} onClick={()=>void saveSupplierTransaction()}>Alohida yozuv ekanini tasdiqlash</button></div>}
              {transactionNotice && <p role={transactionNotice.startsWith("✓") ? "status" : "alert"} aria-live="polite" className={transactionNotice.startsWith("✓") ? "form-notice success" : "form-notice"}>{transactionNotice}</p>}
            </details></section>
          {supplierNotice && <p role={supplierNotice.startsWith("✓") ? "status" : "alert"} aria-live="polite" className={supplierNotice.startsWith("✓") ? "telegram-notice supplier-telegram-notice success" : "telegram-notice supplier-telegram-notice"}>{supplierNotice}</p>}
          {supplierTelegramNotice && <p className={`telegram-notice supplier-telegram-notice ${supplierTelegramNotice.startsWith("✓") ? "success" : ""}`}>{supplierTelegramNotice}</p>}
          {supplierRangeDeliveries.length > 0 && <section className="worker-delivery-review-panel">
            <div className="panel-head"><div><span>XODIM KIRITGAN YETKAZMALAR</span><h3>Tovar turlari va nakladnoylar</h3></div><b>{supplierRangeDeliveries.filter((entry) => entry.status === "submitted").length} ta tekshirilmagan</b></div>
            <div className="worker-delivery-review-list">{supplierRangeDeliveries.length ? supplierRangeDeliveries.map((delivery) => <article className={delivery.status} key={delivery.id}>
              <div className="delivery-review-head"><span><strong>{supplierName(delivery.supplierId)}</strong><small>{displayDate(delivery.date)} · Xodim: {delivery.createdByName}</small></span><span><b>{won(delivery.totalAmount)}</b><em>{delivery.status === "approved" ? "✓ TASDIQLANGAN" : "TEKSHIRISH KERAK"}</em></span></div>
              <div className="delivery-review-lines">{delivery.lines.map((line) => <p key={line.id}><span><b>{line.name}</b><small>{line.packageSize || "Qadoq vazni yozilmagan"} · {line.quantity.toLocaleString()} {line.unit || data.inventory.find((item) => item.id === line.inventoryId)?.unit || "dona"}</small></span><strong>{won(line.totalAmount)}</strong></p>)}</div>
              {delivery.note && <p className="delivery-review-note">Izoh: {delivery.note}</p>}
              <div className="delivery-review-actions">{delivery.document ? <a href={`/api/stock-documents?key=${encodeURIComponent(delivery.document.key)}`} target="_blank" rel="noreferrer">📎 Nakladnoyni ochish</a> : <span className="transaction-linked-badge">Hujjat biriktirilmagan eski yozuv</span>}{delivery.status === "submitted" && <button type="button" onClick={() => void approveSupplierDelivery(delivery)}>✓ Omborga va qarzga qo‘shish</button>}</div>
            </article>) : <p className="table-empty">Tanlangan sanada xodim yetkazmasi yo‘q.</p>}</div>
          </section>}
          <section className="supplier-product-window" id="supplier-product-window">
            <div className="panel-head"><div><span>YETKAZIB BERUVCHI BO‘YICHA MAHSULOTLAR</span><h3>Kimdan nima olingan?</h3></div><b>{selectedSupplierProductRows.length} tur mahsulot</b></div>
            <div className="supplier-product-picker">
              <label><span>Yetkazib beruvchini tanlang</span><select value={selectedSupplierProductId} onChange={(event) => setSupplierProductViewId(event.target.value)}>{haloSuppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
              <small>Tanlangan sana oralig‘idagi ombor kirimlari, qarz va to‘lovlar bir joyda ko‘rsatiladi.</small>
            </div>
            {selectedSupplierProduct ? <>
              <SupplierLedgerPanel supplier={selectedSupplierProduct} transactions={data.transactions} movements={data.stockMovements} inventory={data.inventory}/>
              <div className="supplier-product-summary">
                <div><small>Mahsulot kirimi</small><strong>{won(selectedSupplierReceiptTotal)}</strong><span>{selectedSupplierReceipts.length} ta kirim</span></div>
                <div><small>Nakladnoy summasi</small><strong>{won(selectedSupplierPurchaseTotal)}</strong><span>{selectedSupplierTransactions.filter((entry) => entry.type === "purchase").length} ta yozuv</span></div>
                <div><small>To‘langan</small><strong className="positive">{won(selectedSupplierPaymentTotal)}</strong><span>Tanlangan davr</span></div>
                <div><small>Hozirgi qarz</small><strong className={selectedSupplierProduct.balance > 0 ? "negative" : "positive"}>{won(Math.abs(selectedSupplierProduct.balance))}</strong><span>{selectedSupplierProduct.balance > 0 ? "TO‘LANMAGAN" : selectedSupplierProduct.balance < 0 ? "OLDINDAN TO‘LOV" : "TO‘LANDI"}</span></div>
              </div>
              <div className="data-table supplier-product-table">
                <div className="table-row supplier-product head"><span>Mahsulot</span><span>Jami miqdor</span><span>Necha marta</span><span>Oxirgi kirim</span><span>Jami qiymat</span></div>
                {selectedSupplierProductRows.map((row) => <div className="table-row supplier-product" key={row.key}><strong>{row.name}</strong><span>{row.quantity.toLocaleString()} {row.unit}</span><span>{row.receiptCount} marta</span><span>{displayDate(row.lastDate)}</span><strong>{row.missingAmount ? "Narxni tekshiring" : won(row.amount)}</strong></div>)}
                {!selectedSupplierProductRows.length && <div className="table-empty">Bu yetkazib beruvchidan tanlangan davrda mahsulot kirimi topilmadi.</div>}
              </div>
              {selectedSupplierReceipts.length > 0 && <details className="supplier-product-details"><summary>Har bir kirimni alohida ko‘rish <b>＋</b></summary><div className="supplier-product-receipt-list">{selectedSupplierReceipts.map((movement) => { const item = data.inventory.find((entry) => entry.id === movement.inventoryId); const purchase = receiptDisplay(movement, item); return <article key={movement.id}><span><strong>{inventoryName(movement.inventoryId)}</strong><small>{displayDate(movement.date)}{movement.note ? ` · ${movement.note}` : ""}</small></span><span><b>{purchase.quantity.toLocaleString()} {purchase.unit}</b><strong>{purchase.amount === null ? "Narx yo‘q" : won(purchase.amount)}</strong></span></article>; })}</div></details>}
            </> : <p className="table-empty">Avval yetkazib beruvchi qo‘shing.</p>}
          </section>
          {debtEdit && debtEdit.branchId === activeBranchId && <section className="supplier-product-window" aria-label="Qarz qoldig‘ini tahrirlash">
            <div className="panel-head"><h3>{supplierName(debtEdit.supplierId)} · Qarz qoldig‘ini tahrirlash</h3></div>
            <p>Hozir qolgan qarzni yozing. Oldingi to‘lovlar o‘chmaydi. Bu tuzatish ombor, xarajat yoki kassaga pul harakati qo‘shmaydi.</p>
            <div className="supplier-profile-edit">
              <p>Avvalgi qoldiq: <b>{won(debtEdit.expectedBalance)}</b></p>
              <label><span>Yangi qarz qoldig‘i (von)</span><input type="number" step="1" value={debtEdit.balance} disabled={debtSaving} onChange={e => setDebtEdit({ ...debtEdit, balance: e.target.value })} /><small>Qarz bo‘lmasa 0. Oldindan to‘lov bo‘lsa manfiy summa yozing.</small></label>
              <label><span>Tuzatish sababi</span><input maxLength={300} placeholder="Masalan: Nodir aka bilan solishtirildi, qolgan qarz 948000 von" value={debtEdit.reason} disabled={debtSaving} onChange={e => setDebtEdit({ ...debtEdit, reason: e.target.value })} /></label>
              {debtEdit.balance.trim() && Number.isSafeInteger(Number(debtEdit.balance)) && <p>Yangi qoldiq: <b>{won(Number(debtEdit.balance))}</b> · Farq: {won(Number(debtEdit.balance) - debtEdit.expectedBalance)}</p>}
              <div><button type="button" className="save" disabled={debtSaving} onClick={() => void saveDebtEdit()}>{debtSaving ? "Saqlanmoqda…" : "Qarz qoldig‘ini saqlash"}</button><button type="button" disabled={debtSaving} onClick={() => setDebtEdit(null)}>Bekor qilish</button></div>
              {debtNotice && <p role="alert">{debtNotice}</p>}
            </div>
          </section>}
          <section className="supplier-cards supplier-order-cards">{data.suppliers.filter((supplier) => !isMezanaSupplierName(supplier.name)).map((supplier) => <article className={editingSupplierId === supplier.id ? "editing" : ""} key={supplier.id}>
            <div className="supplier-card-top"><span><small>YETKAZIB BERUVCHI</small><h3>{supplier.name}</h3><p>{supplier.phone || "Telefon kiritilmagan"}</p><p className="supplier-bank-summary">🏦 {supplier.bankAccount || "Bank hisobi kiritilmagan"}</p></span><span className="supplier-card-actions">{editingSupplierId !== supplier.id && <button type="button" className="supplier-edit-button" onClick={() => editSupplier(supplier)}>Yetkazuvchi ma’lumotlari</button>}<button type="button" className="archive-delete" disabled={editingSupplierId === supplier.id} onClick={() => deleteSupplier(supplier)}>Savatga</button></span></div>
            {editingSupplierId === supplier.id && <div className="supplier-profile-edit">
              <label><span>Firma nomi</span><input value={supplierEditForm.name} onChange={(event) => setSupplierEditForm({ ...supplierEditForm, name: event.target.value })} /></label>
              <label><span>Telefon</span><input value={supplierEditForm.phone} onChange={(event) => setSupplierEditForm({ ...supplierEditForm, phone: event.target.value })} /></label>
              <label><span>Bank nomi va hisob raqami</span><input placeholder="Masalan: KB Kookmin · 123-456-789" value={supplierEditForm.bankAccount} onChange={(event) => setSupplierEditForm({ ...supplierEditForm, bankAccount: event.target.value })} /></label>
              <div><button type="button" className="save" disabled={supplierSaving} onClick={() => void saveSupplierEdit()}>{supplierSaving ? "Saqlanmoqda…" : "O‘zgarishni saqlash"}</button><button type="button" disabled={supplierSaving} onClick={() => { setEditingSupplierId(""); setSupplierEditForm({ name: "", phone: "", bankAccount: "" }); setSupplierNotice("Tahrirlash bekor qilindi."); }}>Bekor qilish</button></div>
            </div>}
            <div className="supplier-account-equation" aria-label={`${supplier.name} oldi-berdi hisobi`}><span><small>KIRIM + QARZ QOLDIG‘I TUZATISHI</small><strong>{won(supplierAccountingTotals.get(supplier.id)?.taken || 0)}</strong></span><i>−</i><span className="paid"><small>JAMI TO‘LANGAN</small><strong>{won(supplierAccountingTotals.get(supplier.id)?.paid || 0)}</strong></span><i>=</i><span className={supplier.balance > 0.000001 ? "debt" : "clear"}><small>{supplier.balance < 0 ? "AVANS (MANFIY QOLDIQ)" : "HOZIRGI QARZ"}</small><strong>{won(supplier.balance)}</strong></span></div>
            <button type="button" className="supplier-products-open" disabled={debtSaving} onClick={() => { openDebtEdit(supplier); window.requestAnimationFrame(() => document.querySelector('[aria-label="Qarz qoldig‘ini tahrirlash"]')?.scrollIntoView({ behavior: "smooth", block: "start" })); }}>Qarz qoldig‘ini tahrirlash</button>
            {Boolean(supplier.balanceEdits?.length) && <details className="supplier-product-details"><summary>Qarz tuzatishlari tarixi</summary>{supplier.balanceEdits?.map(entry => <p key={entry.id}>{new Date(entry.at).toLocaleString("uz-UZ", { timeZone: "Asia/Seoul" })} · Rahbar<br />{won(entry.previousBalance)} → <b>{won(entry.balance)}</b><br />{entry.reason}</p>)}</details>}
            <div className={`supplier-balance ${supplier.balance > 0.000001 ? "unpaid" : "paid"}`}><small>{supplier.balance < -0.000001 ? `Oldindan to‘lov: ${won(Math.abs(supplier.balance))}` : supplier.balance > 0.000001 ? "To‘lanishi kerak bo‘lgan summa" : "Qarz qolmagan"}</small><strong>{supplier.balance > 0.000001 ? won(supplier.balance) : "₩0"}</strong><b>{supplier.balance > 0.000001 ? "● QARZ BOR" : supplier.balance < -0.000001 ? "✓ OLDINDAN TO‘LANGAN" : "✓ TO‘LIQ TO‘LANGAN"}</b></div>
            <button type="button" className="supplier-products-open" onClick={() => { setSupplierProductViewId(supplier.id); window.requestAnimationFrame(() => document.getElementById("supplier-product-window")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}>📦 Olingan mahsulotlarni ko‘rish</button>
            {supplier.balance > 0.000001 && <div className="supplier-quick-payment">
              <label><span>Qaysi hisobdan?</span><select value={supplierPaymentAccounts[supplier.id] || (data.accounts.find((account) => account.id === "account-bank")?.id || data.accounts[0]?.id || "")} onChange={(event) => setSupplierPaymentAccounts((current) => ({ ...current, [supplier.id]: event.target.value }))}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
              <button type="button" disabled={Boolean(supplierPaymentBusy)} onClick={() => void paySupplierDebt(supplier)}>{supplierPaymentBusy === supplier.id ? "Saqlanmoqda…" : "✓ QARZ TO‘LANDI"}</button>
            </div>}
            <div className="supplier-telegram-settings">
              <label><span>Telegram Chat ID</span><input inputMode="numeric" placeholder="Yetkazib beruvchi botga Salom yozadi" defaultValue={supplier.telegramChatId || ""} onBlur={(event) => { const chatId = event.target.value.trim(); if (chatId !== (supplier.telegramChatId || "")) void updateSupplier(supplier.id, { telegramChatId: chatId, autoOrder: chatId ? supplier.autoOrder : false }); }} /></label>
              <button disabled={!telegramSettings.tokenSaved || supplierTelegramBusy === supplier.id} onClick={() => void discoverSupplierTelegram(supplier)}>{supplierTelegramBusy === supplier.id ? "Topilmoqda…" : "Oxirgi chatni topish"}</button>
              <label className="supplier-auto-toggle"><input type="checkbox" checked={Boolean(supplier.autoOrder)} disabled={!supplier.telegramChatId} onChange={(event) => updateSupplier(supplier.id, { autoOrder: event.target.checked })} /><span><b>Telegram buyurtmalariga qo‘shish</b><small>{supplier.telegramChatId ? "Rahbar «Buyurtmani yuborish» tugmasini bosganda" : "Avval Telegram Chat ID’ni ulang"}</small></span></label>
            </div>
          </article>)}</section>
          <section className="supplier-invoice-panel">
            <div className="panel-head"><div><span>NAKLADNOYLAR BAZASI</span><h3>Barcha kirim hujjatlari</h3></div><b>{supplierInvoices.length} ta nakladnoy</b></div>
            <p className="supplier-invoice-safety">🔒 Qarz to‘langanda nakladnoy o‘chmaydi. Faqat holati “TO‘LANDI”ga o‘tadi va shu bazada qoladi.</p>
            <div className="supplier-invoice-summary">
              <div><small>Jami kirim</small><strong>{supplierInvoices.length}</strong></div>
              <div><small>To‘langan</small><strong className="positive">{paidSupplierInvoiceCount}</strong></div>
              <div><small>To‘lanmagan</small><strong className="negative">{supplierInvoices.length - paidSupplierInvoiceCount}</strong></div>
              <div><small>Rasmli hujjat</small><strong>{supplierInvoiceDocumentCount}</strong></div>
            </div>
            <div className="supplier-invoice-toolbar">
              <label><span>Qidirish</span><input type="search" value={supplierInvoiceSearch} placeholder="Firma, sana, summa yoki izoh" onChange={(event) => { setSupplierInvoiceSearch(event.target.value); setSupplierInvoiceLimit(100); }} /></label>
              <label><span>Holati</span><select value={supplierInvoiceStatus} onChange={(event) => { setSupplierInvoiceStatus(event.target.value as "all" | "unpaid" | "paid"); setSupplierInvoiceLimit(100); }}><option value="all">Hammasi</option><option value="unpaid">To‘lanmagan</option><option value="paid">To‘langan</option></select></label>
              {(supplierInvoiceSearch || supplierInvoiceStatus !== "all") && <button type="button" onClick={() => { setSupplierInvoiceSearch(""); setSupplierInvoiceStatus("all"); setSupplierInvoiceLimit(100); }}>Filtrni tozalash</button>}
            </div>
            <div className="data-table supplier-invoice-table">
              <div className="table-row invoice head"><span>Sana</span><span>Yetkazib beruvchi</span><span>Izoh</span><span>Holati</span><span>Summa va hujjat</span></div>
              {filteredSupplierInvoices.slice(0, supplierInvoiceLimit).map((invoice) => <div className="table-row invoice" key={invoice.id}>
                <span>{displayDate(invoice.date)}</span>
                <strong>{supplierName(invoice.supplierId)}</strong>
                <span>{invoice.note || "Izoh yo‘q"}</span>
                <em className={`transaction-payment-status ${transactionPaymentStatus[invoice.id] === "paid" ? "paid" : "unpaid"}`}>{transactionPaymentStatus[invoice.id] === "paid" ? "✓ TO‘LANDI" : "● TO‘LANMAGAN"}</em>
                <span className="supplier-invoice-actions"><strong>{won(invoice.amount)}</strong>{invoice.document ? <a className="transaction-document-link" href={`/api/stock-documents?key=${encodeURIComponent(invoice.document.key)}`} target="_blank" rel="noreferrer">📎 Nakladnoyni ochish</a> : <small>Rasm biriktirilmagan</small>}{isWorkerDeliveryTransaction(invoice) ? <span className="transaction-linked-badge">🔒 Xodim kirimi</span> : <button type="button" className="transaction-edit-button" onClick={() => editTransaction(invoice)}>Tahrirlash</button>}</span>
              </div>)}
              {!filteredSupplierInvoices.length && <div className="table-empty">Tanlangan filtr bo‘yicha nakladnoy topilmadi.</div>}
            </div>
            {filteredSupplierInvoices.length > supplierInvoiceLimit && <button type="button" className="stock-history-more" onClick={() => setSupplierInvoiceLimit((current) => current + 100)}>Yana 100 ta nakladnoy ko‘rsatish</button>}
          </section>
          <section className="panel table-panel"><div className="panel-head"><div><span>HISOB-KITOB TARIXI</span><h3>Kirim va to‘lov harakatlari</h3></div></div><div className="data-table supplier-transaction-history"><div className="table-row tx head"><span>Sana</span><span>Yetkazib beruvchi</span><span>Izoh</span><span>Turi</span><span>Summa va amal</span></div>{supplierRangeTransactions.slice(0, transactionHistoryLimit).map((tx) => <div className={`table-row tx ${editingTransactionId === tx.id ? "active-edit" : ""}`} key={tx.id}><span>{tx.date}</span><strong>{supplierName(tx.supplierId)}</strong><span>{tx.note || "—"}</span><b className={tx.type}>{tx.type === "purchase" ? "Kirim" : "To‘lov"}</b><span className="transaction-row-actions"><strong>{won(tx.amount)}</strong><em className={`transaction-payment-status ${tx.type === "payment" || transactionPaymentStatus[tx.id] === "paid" ? "paid" : "unpaid"}`}>{tx.type === "payment" || transactionPaymentStatus[tx.id] === "paid" ? "✓ TO‘LANDI" : "● TO‘LANMAGAN"}</em>{tx.document && <a className="transaction-document-link" href={`/api/stock-documents?key=${encodeURIComponent(tx.document.key)}`} target="_blank" rel="noreferrer">📎 Nakladnoy</a>}{supplierSourceDocument(data, tx) ? <button type="button" className="transaction-edit-button" onClick={() => editTransaction(tx)}>Kirimni boshqarish</button> : <><button type="button" className="transaction-edit-button" onClick={() => editTransaction(tx)}>Qarz / to‘lovni tahrirlash</button></>}<button type="button" className="archive-delete remove-record" onClick={()=>setRemovalTarget({kind:"transaction",id:tx.id,label:`${supplierName(tx.supplierId)} · ${won(tx.amount)}`})}>Olib tashlash</button></span></div>)}</div>{!supplierRangeTransactions.length && <div className="table-empty">Tanlangan sanada oldi-berdi harakati yo‘q.</div>}{supplierRangeTransactions.length > transactionHistoryLimit && <button type="button" className="stock-history-more" onClick={() => setTransactionHistoryLimit((current) => current + 100)}>Yana 100 ta oldi-berdini ko‘rsatish</button>}</section>
        </div>}

        <Suspense fallback={<section className="panel"><div className="table-empty">Bo‘lim ochilmoqda…</div></section>}>
          {tab === "integrations" && userMode === "owner" && (
            <IntegrationCenter key={activeBranchId} recipes={data.recipes} branchId={activeBranchId} />
          )}
          {tab === "control" && userMode === "owner" && (
            <ControlCenter
              onRemoveRecord={(kind,id,label)=>setRemovalTarget({kind,id,label})}
              onBeforeInventory={async () => { if (!await saveQueueRef.current || failedSaveRef.current) throw new Error("Avval saqlanmay qolgan amalni saqlang."); }}
              onInventorySaved={async () => { await reloadAuthoritativeState(activeBranchRef.current); }}
              key={activeBranchId}
              data={data}
              branchId={activeBranchId}
              branchName={branches.find((branch) => branch.id === activeBranchId)?.name || "HALO filial"}
              onSave={(next, action) => save(next as AppState, action)}
            />
          )}
          {tab === "archive" && userMode === "owner" && <RecordRemovalHistory key={`removals-${activeBranchId}`} branchId={activeBranchId}/> }
          {tab === "archive" && userMode === "owner" && <ArchiveCenter
            key={activeBranchId}
            initialBranchId={activeBranchId}
            deletedItems={data.deletedItems}
            financialEntries={data.financialEntries}
            suppliers={data.suppliers}
            purchaseOrders={data.purchaseOrders}
            staff={data.staff}
            workShifts={data.workShifts}
            payrollAdjustments={data.payrollAdjustments}
            attendanceDays={data.attendanceDays}
            payrollPayments={data.payrollPayments}
            onRestoreDeleted={restoreDeletedItem}
          />}
        </Suspense>
      </section>
    </main>
  );
}
