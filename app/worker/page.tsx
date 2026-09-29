"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  autoDetectPosColumns,
  extractPosTable,
  normalizeProductKey,
  parsePosRows,
  type PosColumnMapping,
  type PosTable,
  type SpreadsheetValue,
} from "../pos-import";
import InventoryAccountingPanel from "../inventory-accounting-panel";
import { applySaleInventoryAccounting, type InventoryAccountingFields } from "../lib/inventory-accounting";
import XodimInstall from "../xodim-install";
import { reconcilePosImport } from "../lib/pos-reconciliation";
import { encodeHaloHeader } from "../lib/halo-header";
import { type WorkerAttendanceShift, type WorkerMonthlyEarnings } from "../lib/payroll";
import { seoulBusinessDate, seoulCalendarDate } from "../lib/business-time";
import {
  announceHaloStateChange,
  HALO_LIVE_SYNC_INTERVAL_MS,
  rolloverFormDate,
  stateRevisionChanged,
  subscribeHaloStateChanges,
} from "../lib/live-state";
import {
  categoriesForKind,
  DEFAULT_PRODUCT_CATEGORIES,
  inferLegacyCategoryId,
  normalizeProductCategories,
  validCategoryId,
  type ProductCategory,
} from "../lib/product-categories";
import {
  normalizeWorkerLanguage,
  translateWorker,
  translateWorkerError,
  workerLocale,
  WORKER_LANGUAGES,
  type WorkerLanguage,
  type WorkerTranslationKey,
} from "../lib/worker-i18n";
import {
  prepareStockImageUpload,
  preparedImageNotice,
  STOCK_IMAGE_ACCEPT,
} from "../lib/image-upload";
import { appendImageToForm, postMultipartJson } from "../lib/multipart-upload";
import { type SupplierDelivery, type SupplierDeliveryLine } from "../lib/supplier-deliveries";
import {
  isMezanaSupplierName,
  mezanaDebtActionLabel,
  mezanaDebtEntryValue,
  normalizeMezanaDebtEntry,
  normalizeMezanaDebtEntries,
  type MezanaDebtAction,
  type MezanaDebtEntry,
} from "../lib/mezana-debts";
import { normalizeMezanaCatalog, type MezanaCatalogItem } from "../lib/mezana-catalog";
import {
  CHICKEN_OIL_CAN_LITERS,
  type OilFlowType,
} from "../lib/oil-accounting";
import {
  DEFAULT_KITCHEN_RULE_REMINDER_HOURS,
  DEFAULT_KITCHEN_RULES,
  normalizeKitchenRuleReminderHours,
  normalizeKitchenRules,
} from "../lib/kitchen-rules";
import type { OperationChecklistView } from "../lib/operations";
import {
  compatibleInventoryInputUnits,
  inventoryQuantityFromInput,
  INVENTORY_OUTFLOW_REASONS,
} from "../lib/worker-consumptions";
import { ensureMenuCodes, recipeHasMenuCode } from "../lib/menu-codes";
import {
  duplicateEntryConfirmationMessage,
  findPotentialDuplicateEntries,
} from "../lib/duplicate-entry-warning";

type Inventory = InventoryAccountingFields & {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  unitCost?: number;
  supplierId: string;
  categoryId: string;
  packageName?: string;
  unitsPerPackage?: number;
  gramsPerUnit?: number;
};
type Ingredient = { id?: string; inventoryId: string; name?: string; unit?: string; quantity: number; unitCost?: number; lineCost?: number };
type RecipeExtraCost = { id: string; name: string; amount: number };
type SaleIngredientUsage = Ingredient & { unitCostAtSale?: number; totalCostAtSale?: number };
type Recipe = { id: string; name: string; posCode: string; posAliases: string[]; salePrice?: number; ingredients: Ingredient[]; extraCosts?: RecipeExtraCost[]; categoryId: string };
type Supplier = { id: string; name: string; phone: string; balance: number; telegramChatId?: string; autoOrder?: boolean };
type Transaction = { id: string; supplierId: string; type: "purchase" | "payment"; amount: number; date: string; note: string };
type Sale = {
  id: string;
  recipeId: string;
  quantity: number;
  unitPrice: number;
  totalRevenue: number;
  revenueSource?: "pos_actual" | "menu_estimate";
  totalCost: number;
  date: string;
  source: "manual" | "pos" | "photo" | "api";
  taxTreatment?: "automatic" | "accountant_managed";
  externalId?: string;
  stockUsage?: SaleIngredientUsage[];
  accountId?: string;
};
type StockMovement = {
  id: string;
  inventoryId: string;
  type: "receipt" | "waste" | "sale" | "adjustment";
  quantity: number;
  date: string;
  note: string;
  referenceId?: string;
};
type WorkerConsumption = {
  id: string;
  kind: "meal" | "product" | "waste" | "inventory_only";
  sourceType: "recipe" | "inventory";
  recipeId?: string;
  inventoryId?: string;
  label: string;
  quantity: number;
  unit: string;
  date: string;
  reason: string;
  note: string;
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
  items?: Array<{ recipeId: string; name: string; quantity: number }>;
  stockShortages?: Array<{ inventoryId: string; name: string; unit: string; quantity: number }>;
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
};
type Branch = {
  id: string;
  name: string;
  address: string;
  active: boolean;
  configured?: boolean;
};
type AssignedTask = {
  id: string;
  title: string;
  description: string;
  priority: "normal" | "important" | "urgent";
  dueAt: string;
  status: "new" | "started" | "done" | "cancelled";
  createdAt: string;
  completedAt: string;
};
type AttendanceView = {
  linked: boolean;
  member?: { id: string; name: string };
  businessDate?: string;
  openShift?: WorkerAttendanceShift | null;
  todayStatus?: { status: "off" | "absent" | "sick"; note: string } | null;
  earnings?: WorkerMonthlyEarnings;
};
type WorkerOperationsView = {
  role: "worker";
  date: string;
  checklist: OperationChecklistView;
  linked: boolean;
  canEdit: boolean;
  workerName?: string;
  updatedAt?: string;
};
type AppState = {
  productCategories: ProductCategory[];
  inventory: Inventory[];
  recipes: Recipe[];
  suppliers: Supplier[];
  supplierDirectory: Array<{ id: string; name: string }>;
  transactions: Transaction[];
  supplierDeliveries: SupplierDelivery[];
  mezanaCatalog: MezanaCatalogItem[];
  mezanaBorrowedBalances: Record<string, number>;
  mezanaEntries: MezanaDebtEntry[];
  mezanaTelegramConfigured: boolean;
  mezanaTelegramConfiguredByAction: { borrowed: boolean; purchased: boolean };
  workerConsumptions: WorkerConsumption[];
  posOrders: Array<Record<string, unknown>>;
  sales: Sale[];
  stockMovements: StockMovement[];
  accounts: MoneyAccount[];
  financialEntries: FinancialEntry[];
  dailyCloses: DailyClose[];
  fixedExpenses: FixedExpense[];
  purchaseOrders: Array<Record<string, unknown>>;
  staff: Array<Record<string, unknown>>;
  kitchenRules: string[];
  kitchenRuleReminderHours: number;
  costRules: {
    cardCommissionPct: number;
    deliveryCommissionPct: number;
    taxPct: number;
  };
  auditLog: Array<Record<string, unknown>>;
  updatedAt?: string;
};
type WorkerTask = "pos" | "cashsale" | "waste" | "expense" | "delivery" | "oil" | "mezana";
type WorkerPortalSection = "today" | "account" | "actions" | "tasks";

const defaultAccounts: MoneyAccount[] = [
  { id: "account-cash", name: "Naqd kassa", type: "cash", openingBalance: 0 },
  { id: "account-bank", name: "Bank", type: "bank", openingBalance: 0 },
  { id: "account-card", name: "Karta / POS", type: "card", openingBalance: 0 },
  { id: "account-delivery", name: "Yetkazib berish", type: "delivery", openingBalance: 0 },
];
const emptyState: AppState = {
  productCategories: DEFAULT_PRODUCT_CATEGORIES.map((category) => ({ ...category })),
  inventory: [],
  recipes: [],
  suppliers: [],
  supplierDirectory: [],
  transactions: [],
  supplierDeliveries: [],
  mezanaCatalog: [],
  mezanaBorrowedBalances: {},
  mezanaEntries: [],
  mezanaTelegramConfigured: false,
  mezanaTelegramConfiguredByAction: { borrowed: false, purchased: false },
  workerConsumptions: [],
  posOrders: [],
  sales: [],
  stockMovements: [],
  accounts: defaultAccounts,
  financialEntries: [],
  dailyCloses: [],
  fixedExpenses: [],
  purchaseOrders: [],
  staff: [],
  kitchenRules: [...DEFAULT_KITCHEN_RULES],
  kitchenRuleReminderHours: DEFAULT_KITCHEN_RULE_REMINDER_HOURS,
  costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
  auditLog: [],
};
const normalizeAppState = (value: Partial<AppState>): AppState => {
  const productCategories = normalizeProductCategories(value.productCategories);
  return ({
  productCategories,
  inventory: (Array.isArray(value.inventory) ? value.inventory : []).map((item) => ({
    ...item,
    categoryId: validCategoryId(productCategories, "inventory", item.categoryId || inferLegacyCategoryId("inventory", item.name)),
  })),
  recipes: ensureMenuCodes((Array.isArray(value.recipes) ? value.recipes : []).map((recipe) => ({
    ...recipe,
    categoryId: validCategoryId(productCategories, "recipe", recipe.categoryId || inferLegacyCategoryId("recipe", recipe.name)),
  }))),
  suppliers: Array.isArray(value.suppliers) ? value.suppliers : [],
  supplierDirectory: Array.isArray(value.supplierDirectory) ? value.supplierDirectory : [],
  transactions: Array.isArray(value.transactions) ? value.transactions : [],
  supplierDeliveries: Array.isArray(value.supplierDeliveries) ? value.supplierDeliveries : [],
  mezanaCatalog: normalizeMezanaCatalog(value.mezanaCatalog),
  mezanaBorrowedBalances: value.mezanaBorrowedBalances && typeof value.mezanaBorrowedBalances === "object" ? value.mezanaBorrowedBalances : {},
  mezanaEntries: normalizeMezanaDebtEntries(value.mezanaEntries),
  mezanaTelegramConfigured: value.mezanaTelegramConfigured === true,
  mezanaTelegramConfiguredByAction: {
    borrowed: value.mezanaTelegramConfiguredByAction?.borrowed === true,
    purchased: value.mezanaTelegramConfiguredByAction?.purchased === true,
  },
  workerConsumptions: Array.isArray(value.workerConsumptions) ? value.workerConsumptions : [],
  posOrders: Array.isArray(value.posOrders) ? value.posOrders : [],
  sales: Array.isArray(value.sales) ? value.sales : [],
  stockMovements: Array.isArray(value.stockMovements) ? value.stockMovements : [],
  accounts: Array.isArray(value.accounts) && value.accounts.length ? value.accounts : defaultAccounts,
  financialEntries: Array.isArray(value.financialEntries) ? value.financialEntries : [],
  dailyCloses: Array.isArray(value.dailyCloses) ? value.dailyCloses : [],
  fixedExpenses: Array.isArray(value.fixedExpenses) ? value.fixedExpenses : [],
  purchaseOrders: Array.isArray(value.purchaseOrders) ? value.purchaseOrders : [],
  staff: Array.isArray(value.staff) ? value.staff : [],
  kitchenRules: normalizeKitchenRules(value.kitchenRules),
  kitchenRuleReminderHours: normalizeKitchenRuleReminderHours(value.kitchenRuleReminderHours),
  costRules: value.costRules && typeof value.costRules === "object"
    ? value.costRules
    : { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
  auditLog: Array.isArray(value.auditLog) ? value.auditLog : [],
  updatedAt: value.updatedAt,
  });
};
const emptyPosMapping: PosColumnMapping = {
  product: "",
  productCode: "",
  quantity: "",
  total: "",
  discount: "",
  date: "",
  externalId: "",
};
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
const wasteReasons = ["Buzildi", "Yo‘qoldi", "Muddati o‘tdi", "Hisob xatosi", "Boshqa"];
const wasteReasonKeys: Record<string, WorkerTranslationKey> = {
  Buzildi: "waste.reasonSpoiled",
  "Yo‘qoldi": "waste.reasonLost",
  "Muddati o‘tdi": "waste.reasonExpired",
  "Hisob xatosi": "waste.reasonCount",
  Boshqa: "waste.reasonOther",
};
const expenseCategoryKeys: Record<string, WorkerTranslationKey> = {
  Ijara: "expense.rent",
  "Elektr / gaz / suv": "expense.utilities",
  "Wi-Fi / telefon": "expense.phone",
  "POS abonent to‘lovi": "expense.posSubscription",
  "POS / karta komissiyasi": "expense.cardCommission",
  "Yetkazib berish komissiyasi": "expense.deliveryCommission",
  Reklama: "expense.advertising",
  "Ta’mirlash": "expense.repair",
  Soliq: "expense.tax",
  "Sug‘urta": "expense.insurance",
  "Mahsulot xaridi": "expense.purchase",
  "Do‘kon / omborsiz mahsulot": "expense.purchase",
  Boshqa: "expense.other",
};
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const emptyDeliveryLine = (): SupplierDeliveryLine => ({
  id: id("delivery-line"),
  inventoryId: "",
  name: "",
  packageSize: "",
  unit: "",
  quantity: 0,
  totalAmount: 0,
});
const businessDate = seoulBusinessDate;
const calendarMonth = () => seoulCalendarDate().slice(0, 7);
const displayDate = (value: string) => {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
};
const displayWorkerRecordTime = (value: string) => {
  if (!Number.isFinite(Date.parse(value))) return "—";
  return new Date(value).toLocaleString("uz-UZ", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
};
const displayMinutes = (value: number) => {
  const minutes = Math.max(0, Math.round(value));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};
const CASH_SALE_COPY: Record<WorkerLanguage, {
  navTitle: string; navDetail: string; kicker: string; title: string; description: string;
  date: string; reason: string; search: string; clear: string; total: string;
  submit: string; saving: string; empty: string; stock: string;
}> = {
  uz: { navTitle: "Nosavdo ombor chiqimi", navDetail: "Ovqat, isrof, namuna yoki ichki foydalanishni ayirish", kicker: "02 · NOSAVDO OMBOR", title: "Savdo bo‘lmagan ombor chiqimini kiriting", description: "Bu oyna faqat xodim ovqati, isrof, buzilish, namuna yoki ichki foydalanish uchun. Mijozga sotilgan taom Savdo/POS orqali kiritiladi.", date: "Chiqim sanasi", reason: "Chiqim sababi", search: "Taom nomini qidiring", clear: "Sonlarni tozalash", total: "Sababi bilan omborga yoziladi", submit: "Sabab bilan ombordan ayirish", saving: "Saqlanmoqda…", empty: "Qidiruv bo‘yicha taom topilmadi.", stock: "Retsept bo‘yicha ombor minus" },
  en: { navTitle: "Non-sale stock out", navDetail: "Deduct meals, waste, samples, or internal use", kicker: "02 · NON-SALE STOCK", title: "Record a non-sale stock outflow", description: "Use this only for staff meals, waste, damage, samples, or internal use. Customer sales must be entered through Sales/POS.", date: "Outflow date", reason: "Outflow reason", search: "Search menu item", clear: "Clear quantities", total: "Saved to stock with a reason", submit: "Deduct stock with reason", saving: "Saving…", empty: "No menu item matches the search.", stock: "Recipe stock deduction" },
  ko: { navTitle: "비판매 재고 차감", navDetail: "직원 식사·폐기·샘플·내부 사용 차감", kicker: "02 · 비판매 재고", title: "비판매 재고 차감을 입력하세요", description: "직원 식사, 폐기, 파손, 샘플 또는 내부 사용에만 사용하세요. 고객 판매는 판매/POS에 입력해야 합니다.", date: "차감 날짜", reason: "차감 사유", search: "메뉴 검색", clear: "수량 지우기", total: "사유와 함께 재고에 저장", submit: "사유와 함께 재고 차감", saving: "저장 중…", empty: "검색된 메뉴가 없습니다.", stock: "레시피 기준 재고 차감" },
  ru: { navTitle: "Нескладская продажа: списание", navDetail: "Списать питание, брак, образцы или внутреннее использование", kicker: "02 · НЕПРОДАЖНОЕ СПИСАНИЕ", title: "Внесите непродажное списание со склада", description: "Только для питания сотрудников, брака, порчи, образцов или внутреннего использования. Продажи клиентам вносятся через Продажи/POS.", date: "Дата списания", reason: "Причина списания", search: "Найти блюдо", clear: "Очистить количество", total: "Сохранение на складе с причиной", submit: "Списать склад с причиной", saving: "Сохранение…", empty: "По запросу блюда не найдены.", stock: "Списание по рецепту" },
};
const WORKER_USAGE_COPY: Record<WorkerLanguage, {
  navTitle: string; navDetail: string; kicker: string; title: string; description: string;
  meal: string; product: string; waste: string; mealHelp: string; productHelp: string; wasteHelp: string;
  chooseMeal: string; chooseProduct: string; quantity: string; reason: string; date: string; note: string;
  notePlaceholder: string; submit: string; saving: string; history: string; historyEmpty: string;
}> = {
  uz: { navTitle: "Yegan / minus", navDetail: "Taom, mahsulot yoki isrofni o‘z nomingizdan yozing", kicker: "03 · SHAXSIY OMBOR YOZUVI", title: "Yegan taom yoki minusni kiriting", description: "Yozuv aynan sizning profilingizga saqlanadi va tanlangan retsept yoki mahsulot ombordan avtomatik ayriladi.", meal: "Taom yedim", product: "Mahsulot yedim", waste: "Boshqa minus / isrof", mealHelp: "Retseptdagi barcha mahsulotlar ayriladi", productHelp: "Bitta ombor mahsuloti ayriladi", wasteHelp: "Buzilgan, yo‘qolgan yoki boshqa minus", chooseMeal: "Taomni tanlang", chooseProduct: "Mahsulotni tanlang", quantity: "Miqdor", reason: "Sabab", date: "Sana", note: "Izoh", notePlaceholder: "Ixtiyoriy tushuntirish", submit: "Saqlash va ombordan ayirish", saving: "Saqlanmoqda…", history: "Mening oxirgi yozuvlarim", historyEmpty: "Hali yegan yoki minus yozuvingiz yo‘q." },
  en: { navTitle: "Consumed / minus", navDetail: "Record a meal, product, or waste under your profile", kicker: "03 · PERSONAL STOCK RECORD", title: "Record consumed food or stock minus", description: "The entry is saved under your profile and its recipe or product is deducted from inventory automatically.", meal: "I ate a meal", product: "I used a product", waste: "Other minus / waste", mealHelp: "All recipe ingredients are deducted", productHelp: "One inventory product is deducted", wasteHelp: "Spoiled, lost, or another minus", chooseMeal: "Choose meal", chooseProduct: "Choose product", quantity: "Quantity", reason: "Reason", date: "Date", note: "Note", notePlaceholder: "Optional explanation", submit: "Save and deduct inventory", saving: "Saving…", history: "My latest records", historyEmpty: "You have no consumption or minus records yet." },
  ko: { navTitle: "직원 식사 / 차감", navDetail: "내 프로필로 식사·상품·폐기를 기록", kicker: "03 · 개인 재고 기록", title: "먹은 음식 또는 재고 차감을 입력하세요", description: "내 프로필 이름으로 저장되며 선택한 레시피 또는 상품이 재고에서 자동 차감됩니다.", meal: "식사를 먹었어요", product: "상품을 사용했어요", waste: "기타 차감 / 폐기", mealHelp: "레시피의 모든 재료가 차감됩니다", productHelp: "재고 상품 하나가 차감됩니다", wasteHelp: "파손, 분실 또는 기타 차감", chooseMeal: "메뉴 선택", chooseProduct: "상품 선택", quantity: "수량", reason: "사유", date: "날짜", note: "메모", notePlaceholder: "선택 설명", submit: "저장하고 재고 차감", saving: "저장 중…", history: "내 최근 기록", historyEmpty: "아직 식사 또는 차감 기록이 없습니다." },
  ru: { navTitle: "Съедено / минус", navDetail: "Записать блюдо, продукт или списание на свой профиль", kicker: "03 · ЛИЧНАЯ ЗАПИСЬ СКЛАДА", title: "Внесите съеденное блюдо или списание", description: "Запись сохраняется на ваш профиль, а рецепт или продукт автоматически списывается со склада.", meal: "Я съел блюдо", product: "Я использовал продукт", waste: "Другой минус / отход", mealHelp: "Списываются все ингредиенты рецепта", productHelp: "Списывается один складской продукт", wasteHelp: "Порча, потеря или другой минус", chooseMeal: "Выберите блюдо", chooseProduct: "Выберите продукт", quantity: "Количество", reason: "Причина", date: "Дата", note: "Примечание", notePlaceholder: "Необязательное пояснение", submit: "Сохранить и списать склад", saving: "Сохранение…", history: "Мои последние записи", historyEmpty: "У вас пока нет записей о потреблении или списании." },
};
const posSummaryMismatch = (language: WorkerLanguage) => ({
  uz: "Excel yakuniy jami qatorlar bilan mos emas. Faylni qayta yuklang.",
  en: "The Excel grand total does not match its item rows. Upload the file again.",
  ko: "엑셀 총합계와 상품 행 합계가 일치하지 않습니다. 파일을 다시 업로드하세요.",
  ru: "Итог Excel не совпадает с суммой строк. Загрузите файл повторно.",
})[language];
const posConflictMessage = (language: WorkerLanguage) => ({
  uz: "Import to‘xtatildi. Shu sana va kod bo‘yicha fayl bilan saqlangan yozuv farq qiladi yoki takrorlangan. Rahbar tekshirsin (fayldagi / saqlangan dona):",
  en: "Import stopped: this date and code has a changed or repeated record. Ask the manager to check (file / saved quantity):",
  ko: "가져오기 중단: 같은 날짜·코드의 기록이 다르거나 중복됩니다. 관리자에게 확인하세요 (파일 / 저장 수량):",
  ru: "Импорт остановлен: запись с этой датой и кодом отличается или повторяется. Сообщите руководителю (в файле / сохранено):",
})[language];

export default function WorkerPage() {
  const [data, setData] = useState<AppState>(emptyState);
  const [language, setLanguage] = useState<WorkerLanguage>("uz");
  const [languageReady, setLanguageReady] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([
    { id: "main", name: "HALO Asosiy filial", address: "", active: true, configured: true },
  ]);
  const [activeBranchId, setActiveBranchId] = useState("main");
  const [task, setTask] = useState<WorkerTask | null>(null);
  const [inventoryCountOpen, setInventoryCountOpen] = useState(false);
  const [activePortalSection, setActivePortalSection] = useState<WorkerPortalSection>("today");
  const [status, setStatus] = useState("Ma’lumotlar yuklanmoqda…");
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [canWarehouseReceipt, setCanWarehouseReceipt] = useState(false);
  const [canSupplierDelivery, setCanSupplierDelivery] = useState(false);
  const [workerName, setWorkerName] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [today, setToday] = useState(() => businessDate());
  const previousBusinessDateRef = useRef(today);
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  const [assignedTaskNotice, setAssignedTaskNotice] = useState("");
  const [assignedTaskBusy, setAssignedTaskBusy] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramChatName, setTelegramChatName] = useState("");
  const [telegramPairUrl, setTelegramPairUrl] = useState("");
  const [telegramPairNotice, setTelegramPairNotice] = useState("");
  const [telegramPairBusy, setTelegramPairBusy] = useState("");
  const [attendance, setAttendance] = useState<AttendanceView>({ linked: false });
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [attendanceNotice, setAttendanceNotice] = useState("");
  const [attendanceMonth, setAttendanceMonth] = useState(calendarMonth);
  const [operations, setOperations] = useState<WorkerOperationsView | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [operationBusy, setOperationBusy] = useState("");
  const [operationNotice, setOperationNotice] = useState("");
  const attendanceVersion = useRef(0);
  const authBootstrapVersion = useRef(0);
  const loginInFlightRef = useRef(false);
  const persistLocksRef = useRef(new Map<string, Promise<boolean>>());
  const workerMutationLocksRef = useRef(new Set<string>());
  const expenseOperationIdRef = useRef("");
  const oilOperationIdRef = useRef("");
  const mezanaOperationIdRef = useRef("");
  const knownAssignedTaskIds = useRef<Set<string> | null>(null);
  const dataRevisionRef = useRef("");

  const [posTable, setPosTable] = useState<PosTable | null>(null);
  const [posMapping, setPosMapping] = useState<PosColumnMapping>(emptyPosMapping);
  const [posProductMap, setPosProductMap] = useState<Record<string, string>>({});
  const [posNotice, setPosNotice] = useState("");
  const [posReading, setPosReading] = useState(false);
  const [posAccountId, setPosAccountId] = useState("account-card");

  const [cashSaleForm, setCashSaleForm] = useState({ date: today, reason: INVENTORY_OUTFLOW_REASONS[0] as string });
  const [cashSaleQuantities, setCashSaleQuantities] = useState<Record<string, number>>({});
  const [cashSaleSearch, setCashSaleSearch] = useState("");
  const [cashSaleNotice, setCashSaleNotice] = useState("");

  const [wasteForm, setWasteForm] = useState({
    kind: "waste" as WorkerConsumption["kind"],
    recipeId: "",
    inventoryId: "",
    quantity: 0,
    date: today,
    reason: wasteReasons[0],
    note: "",
  });
  const [wasteInputUnit, setWasteInputUnit] = useState("");
  const [wasteNotice, setWasteNotice] = useState("");
  const [editingConsumption, setEditingConsumption] = useState<WorkerConsumption | null>(null);
  const [consumptionActionBusy, setConsumptionActionBusy] = useState("");

  const [expenseForm, setExpenseForm] = useState({
    category: "Do‘kon / omborsiz mahsulot",
    sourceName: "",
    itemName: "",
    amount: 0,
    date: today,
    accountId: "account-cash",
    note: "",
  });
  const [expenseNotice, setExpenseNotice] = useState("");

  const [oilForm, setOilForm] = useState({
    flowType: "purchase" as OilFlowType,
    canCount: 1,
    unitAmount: 0,
    date: today,
    accountId: "account-cash",
    note: "",
  });
  const [oilNotice, setOilNotice] = useState("");
  const [oilSaving, setOilSaving] = useState(false);

  const [mezanaForm, setMezanaForm] = useState({
    action: "borrowed" as MezanaDebtAction,
    catalogItemId: "",
    productName: "",
    quantity: 0,
    amount: 0,
    itemCount: 1,
    date: today,
    note: "",
  });
  const [mezanaTopFile, setMezanaTopFile] = useState<File | null>(null);
  const [mezanaBottomFile, setMezanaBottomFile] = useState<File | null>(null);
  const [mezanaTopPreview, setMezanaTopPreview] = useState("");
  const [mezanaBottomPreview, setMezanaBottomPreview] = useState("");
  const [mezanaFileInputKey, setMezanaFileInputKey] = useState(0);
  const [mezanaNotice, setMezanaNotice] = useState("");
  const [mezanaSaving, setMezanaSaving] = useState(false);
  const [editingMezanaId, setEditingMezanaId] = useState("");
  const [deletingMezanaId, setDeletingMezanaId] = useState("");
  const [mezanaTelegramBusyId, setMezanaTelegramBusyId] = useState("");
  const mezanaAvailableCatalog = useMemo(() => data.mezanaCatalog.filter((item) => {
    if (!item.active) return false;
    if (mezanaForm.action === "purchased") return item.mode === "purchased";
    if (mezanaForm.action === "borrowed") return item.mode === "borrowed";
    return item.mode === "borrowed" && Number(data.mezanaBorrowedBalances[item.id] || 0) > 0;
  }), [data.mezanaBorrowedBalances, data.mezanaCatalog, mezanaForm.action]);
  const selectedMezanaCatalogItem = data.mezanaCatalog.find((item) => item.id === mezanaForm.catalogItemId) || null;

  const [deliveryForm, setDeliveryForm] = useState({
    supplierId: "",
    date: today,
    note: "",
  });
  const deliveryOperationIdRef = useRef("");
  const [deliverySection, setDeliverySection] = useState<"stock" | "reserve">("stock");
  const [deliveryDuplicateReason, setDeliveryDuplicateReason] = useState("");
  const [deliveryDuplicatePending, setDeliveryDuplicatePending] = useState(false);
  const [deliveryLines, setDeliveryLines] = useState<SupplierDeliveryLine[]>([]);
  const [deliveryProductSearch, setDeliveryProductSearch] = useState("");
  const [deliveryDocumentFile, setDeliveryDocumentFile] = useState<File | null>(null);
  const [deliveryDocumentPreview, setDeliveryDocumentPreview] = useState("");
  const [deliveryFileInputKey, setDeliveryFileInputKey] = useState(0);
  const [deliveryNotice, setDeliveryNotice] = useState("");
  const [deliverySaving, setDeliverySaving] = useState(false);

  const t = useCallback((key: WorkerTranslationKey, variables?: Record<string, string | number>) =>
    translateWorker(language, key, variables), [language]);

  const changeLanguage = (nextLanguage: WorkerLanguage) => {
    setLanguage(nextLanguage);
    window.localStorage.setItem("halo-worker-language", nextLanguage);
    document.documentElement.lang = nextLanguage;
    if (authReady) setStatus(translateWorker(nextLanguage, authenticated ? "status.ready" : "status.login"));
  };

  useEffect(() => {
    const savedLanguage = normalizeWorkerLanguage(window.localStorage.getItem("halo-worker-language"));
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      setLanguage(savedLanguage);
      document.documentElement.lang = savedLanguage;
      setLanguageReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setToday(businessDate()), 60_000);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    dataRevisionRef.current = data.updatedAt || "";
    if (authenticated && activeBranchId && data.updatedAt) {
      announceHaloStateChange(activeBranchId, data.updatedAt);
    }
  }, [activeBranchId, authenticated, data.updatedAt]);

  useEffect(() => {
    const previousDate = previousBusinessDateRef.current;
    if (previousDate === today) return;
    setCashSaleForm((current) => rolloverFormDate(current, previousDate, today));
    setWasteForm((current) => rolloverFormDate(current, previousDate, today));
    setExpenseForm((current) => rolloverFormDate(current, previousDate, today));
    setOilForm((current) => rolloverFormDate(current, previousDate, today));
    setMezanaForm((current) => rolloverFormDate(current, previousDate, today));
    setDeliveryForm((current) => rolloverFormDate(current, previousDate, today));
    previousBusinessDateRef.current = today;
  }, [today]);

  useEffect(() => () => {
    if (deliveryDocumentPreview) URL.revokeObjectURL(deliveryDocumentPreview);
  }, [deliveryDocumentPreview]);

  useEffect(() => () => {
    if (mezanaTopPreview) URL.revokeObjectURL(mezanaTopPreview);
  }, [mezanaTopPreview]);

  useEffect(() => () => {
    if (mezanaBottomPreview) URL.revokeObjectURL(mezanaBottomPreview);
  }, [mezanaBottomPreview]);

  useEffect(() => {
    if (!authenticated) return;
    let inFlight = false;
    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await fetch(`/api/inventory-accounting?branch=${encodeURIComponent(activeBranchId)}&portal=worker`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notify" }) }); } catch { /* Retry on the next check. */ }
      finally { inFlight = false; }
    };
    void check();
    const timer = window.setInterval(check, 300_000);
    return () => window.clearInterval(timer);
  }, [authenticated, activeBranchId]);

  useEffect(() => {
    if (!authenticated) {
      knownAssignedTaskIds.current = null;
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/worker-tasks", { cache: "no-store" });
        const value = await response.json() as {
          tasks?: AssignedTask[];
          telegram?: { linked?: boolean; chatName?: string };
          error?: string;
        };
        if (!response.ok) throw new Error(value.error || t("tasks.loadError"));
        const nextTasks = value.tasks || [];
        if (active) {
          const previousIds = knownAssignedTaskIds.current;
          setAssignedTasks(nextTasks);
          setTelegramLinked(Boolean(value.telegram?.linked));
          setTelegramChatName(value.telegram?.chatName || "");
          if (previousIds && "Notification" in window && Notification.permission === "granted") {
            const incoming = nextTasks.find((entry) => entry.status === "new" && !previousIds.has(entry.id));
            if (incoming && "serviceWorker" in navigator) {
              navigator.serviceWorker.ready
                .then((registration) => registration.showNotification(t("notify.newTask"), {
                  body: incoming.title,
                  icon: "/icons/halo-xodim-192.png",
                  badge: "/icons/halo-xodim-192.png",
                  tag: `halo-task-${incoming.id}`,
                  data: { url: "/xodim" },
                }))
                .catch(() => undefined);
            }
          }
          knownAssignedTaskIds.current = new Set(nextTasks.map((entry) => entry.id));
        }
      } catch (error) {
        if (active) setAssignedTaskNotice(translateWorkerError(error instanceof Error ? error.message : "", language, "tasks.loadError"));
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [authenticated, language, t]);

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    const refresh = async () => {
      const version = attendanceVersion.current;
      try {
        const response = await fetch(`/api/attendance?month=${encodeURIComponent(attendanceMonth)}`, { cache: "no-store" });
        const value = await response.json() as AttendanceView & { error?: string };
        if (!response.ok) throw new Error(value.error || t("attendance.loadError"));
        if (active && version === attendanceVersion.current) {
          setAttendance(value);
          setAttendanceNotice("");
        }
      } catch (error) {
        if (active && version === attendanceVersion.current) {
          setAttendanceNotice(translateWorkerError(error instanceof Error ? error.message : "", language, "attendance.loadError"));
        }
      } finally {
        if (active && version === attendanceVersion.current) setAttendanceLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [attendanceMonth, authenticated, language, t]);

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/operations?scope=worker", { cache: "no-store" });
        const value = await response.json() as WorkerOperationsView & { error?: string };
        if (!response.ok) throw new Error(value.error || "Kunlik nazorat ochilmadi.");
        if (active) {
          setOperations(value);
          setOperationNotice("");
        }
      } catch (error) {
        if (active) setOperationNotice(error instanceof Error ? error.message : "Kunlik nazorat ochilmadi.");
      } finally {
        if (active) setOperationsLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [authenticated, attendance.openShift?.id]);

  useEffect(() => {
    if (!languageReady) return;
    let active = true;
    const version = ++authBootstrapVersion.current;
    const requestBootstrap = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8_000);
        try {
          const response = await fetch("/api/worker-auth?bootstrap=1", {
            cache: "no-store",
            signal: controller.signal,
          });
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
      setBootstrapFailed(false);
      setAuthReady(true);
      setStatus(t("status.loading"));
      try {
        const branchResponse = await requestBootstrap();
        const branchValue = await branchResponse.json() as {
          branches?: Branch[];
          authenticated?: boolean;
          branchId?: string;
          userName?: string;
          username?: string;
          canWarehouseReceipt?: boolean;
          canSupplierDelivery?: boolean;
          state?: Partial<AppState>;
        };
        if (!branchResponse.ok || !branchValue.branches?.length) throw new Error("branches");
        const saved = window.localStorage.getItem("halo-worker-branch") || "main";
        const configuredBranches = branchValue.branches.filter((branch) => branch.configured);
        const selected = branchValue.branchId || (
          configuredBranches.some((branch) => branch.id === saved)
            ? saved
            : configuredBranches[0]?.id || ""
        );
        if (!active || version !== authBootstrapVersion.current) return;
        setBranches(branchValue.branches);
        setActiveBranchId(selected);
        window.localStorage.setItem("halo-worker-branch", selected);
        if (branchValue.authenticated) {
          if (!branchValue.state?.updatedAt) throw new Error("load");
          setData(normalizeAppState(branchValue.state));
          setAuthenticated(true);
          setWorkerName(branchValue.userName || t("common.employee"));
          setUsername(branchValue.username || "");
          setCanWarehouseReceipt(Boolean(branchValue.canWarehouseReceipt));
          setCanSupplierDelivery(Boolean(branchValue.canSupplierDelivery));
          setStatus(t("status.ready"));
        } else {
          setCanWarehouseReceipt(false);
          setCanSupplierDelivery(false);
          setStatus(t("status.login"));
        }
      } catch {
        if (active && version === authBootstrapVersion.current) {
          setStatus(t("status.offline"));
          setBootstrapFailed(true);
        }
      } finally {
        if (active && version === authBootstrapVersion.current) setAuthReady(true);
      }
    };
    void open();
    return () => {
      active = false;
    };
  }, [bootstrapAttempt, languageReady, t]);

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    let refreshing = false;
    const refreshState = async () => {
      if (
        refreshing
        || document.visibilityState !== "visible"
        || persistLocksRef.current.size
        || workerMutationLocksRef.current.size
      ) return;
      refreshing = true;
      const knownRevision = dataRevisionRef.current;
      try {
        const revisionResponse = await fetch("/api/worker-state?revision=1", { cache: "no-store" });
        const revision = await revisionResponse.json() as { updatedAt?: string };
        if (revisionResponse.status === 401) {
          if (active) setAuthenticated(false);
          return;
        }
        if (!revisionResponse.ok || !stateRevisionChanged(knownRevision, revision.updatedAt)) return;
        const response = await fetch("/api/worker-state", { cache: "no-store" });
        const value = await response.json() as Partial<AppState> & { error?: string };
        if (
          !response.ok
          || !value.updatedAt
          || !active
          || dataRevisionRef.current !== knownRevision
        ) return;
        const normalized = normalizeAppState(value);
        dataRevisionRef.current = normalized.updatedAt || "";
        setData(normalized);
      } catch {
        // Keyingi davriy tekshiruv avtomatik qayta urinadi.
      } finally {
        refreshing = false;
      }
    };
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refreshState();
    };
    void refreshState();
    const interval = window.setInterval(() => void refreshState(), HALO_LIVE_SYNC_INTERVAL_MS);
    const unsubscribe = subscribeHaloStateChanges((signal) => {
      if (signal.branchId === activeBranchId) void refreshState();
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
  }, [activeBranchId, authenticated]);

  const login = async () => {
    if (!activeBranchId || !username.trim() || !pin) {
      setLoginNotice(t("login.required"));
      return;
    }
    if (loginInFlightRef.current) return;
    loginInFlightRef.current = true;
    setBusy(true);
    setLoginNotice("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const loginResponse = await fetch("/api/worker-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", branchId: activeBranchId, username, pin }),
        signal: controller.signal,
      });
      const loginResult = await loginResponse.json().catch(() => ({})) as {
        error?: string;
        retryable?: boolean;
        userName?: string;
        username?: string;
        canWarehouseReceipt?: boolean;
        canSupplierDelivery?: boolean;
        state?: Partial<AppState>;
      };
      if (!loginResponse.ok) {
        if (loginResponse.status >= 500 || loginResult.retryable) throw new Error("HALO_RETRYABLE_LOGIN");
        throw new Error(loginResult.error || t("error.invalidLogin"));
      }
      if (!loginResult.state?.updatedAt) throw new Error("HALO_RETRYABLE_LOGIN");
      authBootstrapVersion.current += 1;
      setData(normalizeAppState(loginResult.state));
      setAuthenticated(true);
      setWorkerName(loginResult.userName || username);
      setUsername(loginResult.username || username.trim().toLowerCase());
      setCanWarehouseReceipt(Boolean(loginResult.canWarehouseReceipt));
      setCanSupplierDelivery(Boolean(loginResult.canSupplierDelivery));
      setPin("");
      window.localStorage.setItem("halo-worker-branch", activeBranchId);
      setStatus(t("status.ready"));
    } catch (error) {
      let message: string;
      if (error instanceof Error && (error.name === "AbortError" || error instanceof TypeError)) {
        message = t("status.offline");
      } else if (error instanceof Error && error.message === "HALO_RETRYABLE_LOGIN") {
        message = t("status.offline");
      } else {
        message = translateWorkerError(error instanceof Error ? error.message : "", language, "error.invalidLogin");
      }
      setLoginNotice(message);
    } finally {
      window.clearTimeout(timeout);
      loginInFlightRef.current = false;
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/worker-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setAuthenticated(false);
    setWorkerName("");
    setCanWarehouseReceipt(false);
    setCanSupplierDelivery(false);
    setTask(null);
    setActivePortalSection("today");
    setAssignedTasks([]);
    setTelegramLinked(false);
    setTelegramChatName("");
    setTelegramPairUrl("");
    attendanceVersion.current += 1;
    setAttendance({ linked: false });
    setAttendanceLoading(true);
    setAttendanceNotice("");
    setOperations(null);
    setOperationsLoading(true);
    setOperationNotice("");
    knownAssignedTaskIds.current = null;
    setData(emptyState);
    setStatus(t("status.login"));
  };

  const updateAttendance = async (action: "clock-in" | "clock-out") => {
    if (action === "clock-out" && !window.confirm(t("attendance.confirmFinish"))) return;
    attendanceVersion.current += 1;
    setAttendanceBusy(true);
    setAttendanceNotice("");
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, month: attendanceMonth }),
      });
      const value = await response.json() as AttendanceView & { error?: string; updatedAt?: string; telegramRules?: { sent?: boolean } };
      if (!response.ok) throw new Error(value.error || t("attendance.saveError"));
      // Ignore every GET response that started while this mutation was pending.
      attendanceVersion.current += 1;
      setAttendance(value);
      if (value.updatedAt) setData((current) => ({ ...current, updatedAt: value.updatedAt }));
      setAttendanceNotice(action === "clock-in"
        ? value.telegramRules?.sent ? "✓ Ish vaqtingiz saqlandi va qoidalar Telegramga yuborildi." : t("attendance.savedStart")
        : t("attendance.savedFinish"));
    } catch (error) {
      setAttendanceNotice(translateWorkerError(error instanceof Error ? error.message : "", language, "attendance.saveError"));
    } finally {
      setAttendanceBusy(false);
    }
  };

  const updateOperation = async (itemId: string, completed: boolean) => {
    setOperationBusy(itemId);
    setOperationNotice("");
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "worker", date: operations?.date || today, itemId, completed }),
      });
      const value = await response.json() as WorkerOperationsView & { error?: string };
      if (!response.ok) throw new Error(value.error || "Belgi saqlanmadi.");
      setOperations(value);
      setOperationNotice(completed ? "✓ Bajarildi deb saqlandi." : "✓ Belgi olib tashlandi.");
    } catch (error) {
      setOperationNotice(error instanceof Error ? error.message : "Belgi saqlanmadi.");
    } finally {
      setOperationBusy("");
    }
  };

  const openWorkerTask = (nextTask: WorkerTask) => {
    if (nextTask === "delivery" && !canSupplierDelivery) {
      setAssignedTaskNotice("Rahbar bu akkauntga yetkazuvchi kirimini kiritish ruxsatini bermagan.");
      return;
    }
    if (["expense", "oil", "mezana"].includes(nextTask) && !canWarehouseReceipt) {
      setAssignedTaskNotice("Rahbar bu akkauntga xarajat, ombor, moy va MEZANA kiritish ruxsatini bermagan.");
      return;
    }
    const editingTask = editingConsumption?.kind === "inventory_only" ? "cashsale" : editingConsumption ? "waste" : null;
    if (editingTask && nextTask !== editingTask) {
      setEditingConsumption(null);
      setCashSaleQuantities({});
    }
    setActivePortalSection("actions");
    setTask(nextTask);
    window.setTimeout(() => {
      document.getElementById("xodim-amal-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const openPortalSection = (section: WorkerPortalSection) => {
    setActivePortalSection(section);
    window.setTimeout(() => {
      document.getElementById("xodim-portal-window")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const closeWorkerTask = () => {
    setTask(null);
    window.setTimeout(() => {
      document.getElementById("xodim-portal-window")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const persist = (next: AppState, action: string) => {
    const inFlight = persistLocksRef.current.get(action);
    if (inFlight) {
      setStatus("Saqlash allaqachon boshlandi — ikkinchi bosish qabul qilinmadi.");
      return inFlight;
    }
    const duplicateWarnings = findPotentialDuplicateEntries(data, next);
    if (duplicateWarnings.length && !window.confirm(duplicateEntryConfirmationMessage(duplicateWarnings))) {
      setStatus("Takroriy ma’lumot saqlanmadi. Kiritilgan qiymatlarni tekshiring.");
      return Promise.resolve(false);
    }
    const operation = (async () => {
      setBusy(true);
      setStatus(t("status.saving"));
      try {
        const response = await fetch("/api/worker-state", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Halo-Action": encodeHaloHeader(action),
          },
          body: JSON.stringify({ ...next, updatedAt: next.updatedAt || data.updatedAt }),
        });
        const result = await response.json() as { updatedAt?: string; error?: string };
        if (!response.ok) {
          if (response.status === 401) {
            setAuthenticated(false);
            setAssignedTasks([]);
          }
          if (response.status === 409) {
            const freshResponse = await fetch("/api/worker-state", { cache: "no-store" });
            const fresh = await freshResponse.json() as Partial<AppState>;
            if (freshResponse.ok) setData(normalizeAppState(fresh));
          }
          throw new Error(result.error || "save");
        }
        const calculated = applySaleInventoryAccounting(data, next);
        setData({ ...calculated, updatedAt: result.updatedAt || next.updatedAt });
        try {
          const freshResponse = await fetch("/api/worker-state", { cache: "no-store" });
          if (freshResponse.ok) setData(normalizeAppState(await freshResponse.json()));
        } catch { /* The saved local calculation remains usable. */ }
        setStatus(t("status.saved"));
        return true;
      } catch (error) {
        setStatus(translateWorkerError(
          error instanceof Error && error.message !== "save" ? error.message : "",
          language,
          "status.saveFailed",
        ));
        return false;
      } finally {
        setBusy(false);
      }
    })();
    persistLocksRef.current.set(action, operation);
    void operation.finally(() => {
      if (persistLocksRef.current.get(action) === operation) persistLocksRef.current.delete(action);
    });
    return operation;
  };

  const updateAssignedTask = async (taskId: string, nextStatus: "started" | "done") => {
    setAssignedTaskBusy(taskId);
    setAssignedTaskNotice("");
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, status: nextStatus }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
          setAssignedTasks([]);
        }
        throw new Error(result.error || t("tasks.updateError"));
      }
      const completedAt = nextStatus === "done" ? new Date().toISOString() : "";
      setAssignedTasks((current) => current.map((entry) => entry.id === taskId
        ? { ...entry, status: nextStatus, completedAt }
        : entry));
      setAssignedTaskNotice(nextStatus === "done" ? t("tasks.doneNotice") : t("tasks.startedNotice"));
    } catch (error) {
      setAssignedTaskNotice(translateWorkerError(error instanceof Error ? error.message : "", language, "tasks.updateError"));
    } finally {
      setAssignedTaskBusy("");
    }
  };

  const enableNotifications = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setAssignedTaskNotice(t("notify.unsupported"));
      return;
    }
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    setNotificationsEnabled(enabled);
    if (!enabled) {
      setAssignedTaskNotice(t("notify.denied"));
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(t("notify.title"), {
      body: t("notify.body"),
      icon: "/icons/halo-192.png",
      badge: "/icons/halo-192.png",
      tag: "halo-notification-ready",
      data: { url: "/xodim" },
    });
    setAssignedTaskNotice(t("notify.enabled"));
  };

  const prepareOwnTelegram = async () => {
    setTelegramPairBusy("link");
    setTelegramPairNotice("");
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "worker-telegram-link" }),
      });
      const result = await response.json() as { error?: string; url?: string; botName?: string };
      if (!response.ok || !result.url) throw new Error(result.error || t("telegram.linkError"));
      setTelegramPairUrl(result.url);
      setTelegramPairNotice(t("telegram.startBot", { bot: result.botName || "HALO bot" }));
    } catch (error) {
      setTelegramPairNotice(translateWorkerError(error instanceof Error ? error.message : "", language, "telegram.linkError"));
    } finally {
      setTelegramPairBusy("");
    }
  };

  const checkOwnTelegram = async () => {
    setTelegramPairBusy("check");
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "worker-telegram-check" }),
      });
      const result = await response.json() as { error?: string; chatName?: string };
      if (!response.ok) throw new Error(result.error || t("telegram.notLinked"));
      setTelegramLinked(true);
      setTelegramChatName(result.chatName || "");
      setTelegramPairUrl("");
      setTelegramPairNotice(t("telegram.linked", { name: result.chatName ? ` · ${result.chatName}` : "" }));
    } catch (error) {
      setTelegramPairNotice(translateWorkerError(error instanceof Error ? error.message : "", language, "telegram.notLinked"));
    } finally {
      setTelegramPairBusy("");
    }
  };

  const parsedPos = useMemo(
    () => posTable ? parsePosRows(posTable, posMapping, today) : { rows: [], ignored: 0, summary: undefined, errors: [] as string[] },
    [posTable, posMapping, today],
  );
  const recipeCategories = categoriesForKind(data.productCategories, "recipe");
  const inventoryCategories = categoriesForKind(data.productCategories, "inventory");
  const posReconciliation = useMemo(() => {
    const rows = parsedPos.rows.map((row) => {
      const automaticRecipe = row.productCode
        ? data.recipes.find((recipe) => recipeHasMenuCode(recipe, row.productCode))
        : undefined;
      const recipeId = posProductMap[row.mappingKey] || automaticRecipe?.id || "";
      return { ...row, recipeId };
    });
    return reconcilePosImport(rows, data.sales, { compareRevenue: false });
  }, [data.recipes, data.sales, parsedPos.rows, posProductMap]);
  const resolvedPosRows = posReconciliation.rows;
  const posProducts = useMemo(() => {
    const products = new Map<string, {
      key: string;
      name: string;
      productCode: string;
      rowCount: number;
      quantity: number;
      recipeId: string;
    }>();
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
  const duplicatePosRows = posReconciliation.savedRows;

  const readPosFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setPosNotice(t("pos.fileTooLarge"));
      event.target.value = "";
      return;
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setPosNotice(t("pos.badFileType"));
      event.target.value = "";
      return;
    }

    setPosReading(true);
    setPosTable(null);
    setPosProductMap({});
    setPosNotice(t("pos.checkingFile"));
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: true,
        sheetRows: 25_002,
      });
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
      if (!table) throw new Error("table");
      const mapping = autoDetectPosColumns(table.headers);
      const parsed = parsePosRows(table, mapping, today);
      setPosTable(table);
      setPosMapping(mapping);
      setPosNotice(mapping.productCode && mapping.quantity
        ? parsed.summary && !parsed.summary.matches
          ? posSummaryMismatch(language)
          : `${t("pos.rowsLoaded", { count: parsed.rows.length.toLocaleString(workerLocale(language)) })}${table.reportDate ? ` · ${t("pos.date")}: ${table.reportDate}` : ""}`
        : "Faqat 상품코드 va 수량 ustunlarini tanlang.");
    } catch {
      setPosTable(null);
      setPosMapping(emptyPosMapping);
      setPosNotice(t("pos.openError"));
    } finally {
      setPosReading(false);
      event.target.value = "";
    }
  };

  const importPosSales = async () => {
    if (parsedPos.errors?.length) { setPosNotice(parsedPos.errors.join(" ")); return; }
    if (posReconciliation.conflicts.length) {
      setPosNotice(posConflictMessage(language));
      return;
    }
    if (!posTable || !posMapping.productCode || !posMapping.quantity || !importablePosRows.length) {
      setPosNotice("Import uchun 상품코드 va 수량 ustunlari hamda mos HALO menyusi kerak.");
      return;
    }
    if (parsedPos.summary && !parsedPos.summary.matches) {
      setPosNotice(posSummaryMismatch(language));
      return;
    }
    if (unmatchedPosRows.length) {
      setPosNotice(t("pos.linkAll"));
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
        usageMap.set(
          ingredient.inventoryId,
          (usageMap.get(ingredient.inventoryId) ?? 0) + ingredient.quantity * row.quantity,
        );
      });
      const stockUsage: SaleIngredientUsage[] = [...usageMap.entries()].flatMap(([inventoryId, quantity]) => {
        const available = remainingPosStock.get(inventoryId) || 0;
        const deducted = quantity;
        remainingPosStock.set(inventoryId, available - deducted);
        if (deducted <= 0) return [];
        const unitCostAtSale = 0;
        return [{ inventoryId, quantity: deducted, unitCostAtSale, totalCostAtSale: deducted * unitCostAtSale }];
      });
      // The server fills trusted menu revenue and cost snapshots. They are not
      // sent to employee devices, so tannarx and margin stay manager-only.
      const totalCost = 0;
      const totalRevenue = row.totalRevenue || 0;
      newSales.push({
        id: saleId,
        recipeId: recipe.id,
        quantity: row.quantity,
        unitPrice: totalRevenue / row.quantity,
        totalRevenue,
        totalCost,
        date: row.date,
        source: "pos",
        taxTreatment: "automatic",
        externalId: row.externalId,
        revenueSource: row.revenueSource,
        accountId: posAccountId,
        stockUsage,
      });
      stockUsage.forEach((usage) => newMovements.push({
        id: id("mov"),
        inventoryId: usage.inventoryId,
        type: "sale",
        quantity: -usage.quantity,
        date: row.date,
        note: `POS · ${recipe.name} × ${row.quantity}`,
        referenceId: saleId,
      }));
    });

    const saved = await persist({
      ...data,
      inventory: data.inventory.map((item) => ({
        ...item,
        stock: remainingPosStock.get(item.id) ?? item.stock,
      })),
      sales: [...newSales, ...data.sales],
      stockMovements: [...newMovements, ...data.stockMovements],
    }, `POS Excel: ${newSales.length} ta savdo kiritildi`);
    if (saved) {
      setPosNotice(t("pos.saved", {
        count: newSales.length,
        stock: t(totalRequirements.size ? "pos.stockUpdated" : "pos.stockUntouched"),
      }));
      setPosTable(null);
      setPosMapping(emptyPosMapping);
      setPosProductMap({});
    }
  };

  const editConsumption = (entry: WorkerConsumption) => {
    setEditingConsumption(entry);
    if (entry.kind === "inventory_only") {
      const quantities = Object.fromEntries((entry.items || []).map((item) => [item.recipeId, item.quantity]));
      if (!Object.keys(quantities).length && entry.recipeId) quantities[entry.recipeId] = entry.quantity;
      if (!Object.keys(quantities).length) {
        setWasteNotice("Bu eski yozuv tarkibi topilmadi. Uni o‘chirish mumkin, lekin tahrirlab bo‘lmaydi.");
        setEditingConsumption(null);
        return;
      }
      const editableReason = INVENTORY_OUTFLOW_REASONS.includes(entry.reason as typeof INVENTORY_OUTFLOW_REASONS[number])
        ? entry.reason
        : INVENTORY_OUTFLOW_REASONS[0];
      setCashSaleForm({ date: entry.date, reason: editableReason });
      setCashSaleQuantities(quantities);
      setCashSaleNotice("Tahrirlash rejimi: taom, soni, sana yoki sababni to‘g‘rilang.");
      openWorkerTask("cashsale");
      return;
    }

    const inventory = data.inventory.find((item) => item.id === entry.inventoryId);
    setWasteForm({
      kind: entry.kind,
      recipeId: entry.recipeId || "",
      inventoryId: entry.inventoryId || "",
      quantity: entry.quantity,
      date: entry.date,
      reason: entry.reason,
      note: entry.note || "",
    });
    setWasteInputUnit(entry.kind === "meal" ? "" : inventory?.unit || entry.unit);
    setWasteNotice("Tahrirlash rejimi: mahsulot, miqdor, sana yoki izohni to‘g‘rilang.");
    openWorkerTask("waste");
  };

  const cancelConsumptionEdit = () => {
    setEditingConsumption(null);
    setCashSaleQuantities({});
    setWasteForm((current) => ({ ...current, recipeId: "", inventoryId: "", quantity: current.kind === "meal" ? 1 : 0, note: "" }));
    setWasteInputUnit("");
    if (task === "cashsale") setCashSaleNotice("Tahrirlash bekor qilindi.");
    else setWasteNotice("Tahrirlash bekor qilindi.");
  };

  const deleteConsumption = async (entry: WorkerConsumption) => {
    if (!window.confirm(`“${entry.label}” yozuvini o‘chirasizmi? Ombordan ayrilgan miqdor avtomatik qaytariladi.`)) return;
    setConsumptionActionBusy(entry.id);
    setWasteNotice("");
    try {
      const response = await fetch("/api/worker-consumptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: entry.id }),
      });
      const result = await response.json() as { state?: Partial<AppState>; error?: string };
      if (!response.ok || !result.state) throw new Error(result.error || "Yozuv o‘chirilmadi.");
      const next = normalizeAppState(result.state);
      setData(next);
      announceHaloStateChange(activeBranchId, next.updatedAt || "");
      if (editingConsumption?.id === entry.id) {
        setEditingConsumption(null);
        setCashSaleQuantities({});
      }
      setWasteNotice("✓ Yozuv o‘chirildi va ombor qoldig‘i qaytarildi.");
    } catch (error) {
      setWasteNotice(error instanceof Error ? error.message : "Yozuv o‘chirilmadi.");
    } finally {
      setConsumptionActionBusy("");
    }
  };

  const saveCashBankSales = async () => {
    if (workerMutationLocksRef.current.has("inventory-only-batch")) return;
    const selected = data.recipes.flatMap((recipe) => {
      const quantity = Number(cashSaleQuantities[recipe.id] || 0);
      return quantity > 0 ? [{ recipe, quantity }] : [];
    });
    if (!selected.length) {
      setCashSaleNotice("Kamida bitta taomning chiqim sonini kiriting.");
      return;
    }
    if (selected.some(({ quantity }) => !Number.isInteger(quantity) || quantity <= 0)) {
      setCashSaleNotice("Chiqim soni faqat butun va musbat bo‘lishi kerak.");
      return;
    }
    if (!INVENTORY_OUTFLOW_REASONS.includes(cashSaleForm.reason as typeof INVENTORY_OUTFLOW_REASONS[number])) {
      setCashSaleNotice("Nosavdo ombor chiqimi sababini tanlang.");
      return;
    }
    const duplicateProbe = {
      id: `duplicate-probe:${crypto.randomUUID()}`,
      kind: "inventory_only",
      date: cashSaleForm.date,
      reason: cashSaleForm.reason,
      label: selected.length === 1 ? selected[0].recipe.name : `${selected.length} tur taom`,
      quantity: selected.reduce((sum, entry) => sum + entry.quantity, 0),
      unit: "porsiya",
      items: selected.map(({ recipe, quantity }) => ({ recipeId: recipe.id, name: recipe.name, quantity })),
    };
    const duplicateWarnings = editingConsumption ? [] : findPotentialDuplicateEntries(data, {
      ...data,
      workerConsumptions: [duplicateProbe, ...data.workerConsumptions],
    });
    if (duplicateWarnings.length && !window.confirm(duplicateEntryConfirmationMessage(duplicateWarnings))) {
      setCashSaleNotice("Takroriy ombor chiqimi saqlanmadi. Sana va taom sonini tekshiring.");
      return;
    }
    workerMutationLocksRef.current.add("inventory-only-batch");
    setBusy(true);
    setCashSaleNotice("");
    try {
      const response = await fetch("/api/worker-consumptions", {
        method: editingConsumption ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: expenseOperationIdRef.current || (expenseOperationIdRef.current = crypto.randomUUID()),
          ...(editingConsumption ? { recordId: editingConsumption.id } : {}),
          kind: "inventory_only",
          items: selected.map(({ recipe, quantity }) => ({ recipeId: recipe.id, quantity })),
          date: cashSaleForm.date,
          reason: cashSaleForm.reason,
        }),
      });
      const result = await response.json() as { state?: Partial<AppState>; entry?: WorkerConsumption; error?: string };
      if (!response.ok || !result.state || !result.entry) throw new Error(result.error || "Ombor chiqimi saqlanmadi.");
      const next = normalizeAppState(result.state);
      setData(next);
      announceHaloStateChange(activeBranchId, next.updatedAt || "");
      expenseOperationIdRef.current = "";
      const totalQuantity = selected.reduce((sum, entry) => sum + entry.quantity, 0);
      setCashSaleQuantities({});
      const wasEditing = Boolean(editingConsumption);
      setEditingConsumption(null);
      setCashSaleNotice(`✓ ${totalQuantity.toLocaleString(workerLocale(language))} porsiya ${wasEditing ? "tahrirlandi va ombor qayta hisoblandi" : `“${cashSaleForm.reason}” sababi bilan ombordan ayrildi`}. Bu savdo yoki pul tushumi emas${result.entry.stockShortages?.length ? "; yetishmagan qoldiq manfiy ko‘rsatildi" : ""}.`);
    } catch (error) {
      setCashSaleNotice(error instanceof Error ? error.message : "Ombor chiqimi saqlanmadi.");
    } finally {
      workerMutationLocksRef.current.delete("inventory-only-batch");
      setBusy(false);
    }
  };

  const saveWaste = async () => {
    if (workerMutationLocksRef.current.has("worker-consumption")) return;
    const hasSelection = wasteForm.kind === "meal" ? wasteForm.recipeId : wasteForm.inventoryId;
    const selectedInventory = data.inventory.find((entry) => entry.id === wasteForm.inventoryId);
    const stockQuantity = wasteForm.kind === "meal"
      ? wasteForm.quantity
      : inventoryQuantityFromInput(wasteForm.quantity, wasteInputUnit, selectedInventory?.unit || "");
    if (!hasSelection || stockQuantity <= 0 || !wasteForm.date) {
      setWasteNotice(t("waste.required"));
      return;
    }
    const selectedRecipe = data.recipes.find((entry) => entry.id === wasteForm.recipeId);
    const duplicateProbe = {
      id: `duplicate-probe:${crypto.randomUUID()}`,
      kind: wasteForm.kind,
      date: wasteForm.date,
      reason: wasteForm.reason,
      recipeId: wasteForm.recipeId || undefined,
      inventoryId: wasteForm.inventoryId || undefined,
      label: selectedRecipe?.name || selectedInventory?.name || "Ombor chiqimi",
      quantity: stockQuantity,
      unit: wasteForm.kind === "meal" ? "porsiya" : selectedInventory?.unit || "birlik",
    };
    const duplicateWarnings = editingConsumption ? [] : findPotentialDuplicateEntries(data, {
      ...data,
      workerConsumptions: [duplicateProbe, ...data.workerConsumptions],
    });
    if (duplicateWarnings.length && !window.confirm(duplicateEntryConfirmationMessage(duplicateWarnings))) {
      setWasteNotice("Takroriy ombor chiqimi saqlanmadi. Sana, mahsulot va miqdorni tekshiring.");
      return;
    }
    workerMutationLocksRef.current.add("worker-consumption");
    setBusy(true);
    setWasteNotice("");
    try {
      const response = await fetch("/api/worker-consumptions", {
        method: editingConsumption ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: oilOperationIdRef.current || (oilOperationIdRef.current = crypto.randomUUID()),
          ...(editingConsumption ? { recordId: editingConsumption.id } : {}),
          kind: wasteForm.kind,
          recipeId: wasteForm.recipeId,
          inventoryId: wasteForm.inventoryId,
          quantity: stockQuantity,
          date: wasteForm.date,
          reason: wasteForm.reason,
          note: wasteForm.note.trim(),
        }),
      });
      const result = await response.json() as { state?: Partial<AppState>; entry?: WorkerConsumption; error?: string };
      if (!response.ok || !result.state || !result.entry) throw new Error(result.error || "Yozuv saqlanmadi.");
      const next = normalizeAppState(result.state);
      setData(next);
      announceHaloStateChange(activeBranchId, next.updatedAt || "");
      oilOperationIdRef.current = "";
      const wasEditing = Boolean(editingConsumption);
      setEditingConsumption(null);
      setWasteNotice(`✓ ${result.entry.label} · ${result.entry.quantity.toLocaleString(workerLocale(language))} ${result.entry.unit} ${wasEditing ? "tahrirlandi va ombor qayta hisoblandi" : "saqlandi va ombordan ayrildi"}${result.entry.stockShortages?.length ? "; yetishmagan qoldiq manfiy ko‘rsatildi" : ""}.`);
      setWasteForm((current) => ({ ...current, recipeId: "", inventoryId: "", quantity: current.kind === "meal" ? 1 : 0, note: "" }));
      setWasteInputUnit("");
    } catch (error) {
      setWasteNotice(error instanceof Error ? error.message : "Yozuv saqlanmadi.");
    } finally {
      workerMutationLocksRef.current.delete("worker-consumption");
      setBusy(false);
    }
  };

  const saveExpense = async () => {
    if (expenseForm.amount <= 0 || !expenseForm.accountId || !expenseForm.itemName.trim()) {
      setExpenseNotice("Xarajat yoki mahsulot nomi, summa va pul hisobini kiriting.");
      return;
    }
    if (workerMutationLocksRef.current.has("worker-expense")) return;
    workerMutationLocksRef.current.add("worker-expense");
    setBusy(true);
    setExpenseNotice("Saqlanmoqda…");
    try {
      const response = await fetch("/api/worker-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          ...expenseForm,
          updatedAt: data.updatedAt || "",
        }),
      });
      const result = await response.json() as { state?: Partial<AppState>; error?: string };
      if (!response.ok || !result.state) throw new Error(result.error || "Xarajat saqlanmadi.");
      setData(normalizeAppState(result.state));
      setExpenseNotice(`✓ ${expenseForm.itemName.trim()} · ₩${expenseForm.amount.toLocaleString(workerLocale(language))} xarajatga yozildi.`);
      setExpenseForm((current) => ({ ...current, sourceName: "", itemName: "", amount: 0, note: "" }));
    } catch (error) {
      setExpenseNotice(error instanceof Error ? error.message : "Xarajat saqlanmadi.");
    } finally {
      workerMutationLocksRef.current.delete("worker-expense");
      setBusy(false);
    }
  };

  const saveOil = async () => {
    if (oilForm.canCount <= 0 || oilForm.unitAmount <= 0 || !oilForm.accountId) {
      setOilNotice("Kanistr soni, 1 kanistr narxi va pul hisobini kiriting.");
      return;
    }
    if (workerMutationLocksRef.current.has("worker-oil")) return;
    workerMutationLocksRef.current.add("worker-oil");
    setOilSaving(true);
    setOilNotice("Saqlanmoqda…");
    try {
      const response = await fetch("/api/worker-oil", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          ...oilForm,
          updatedAt: data.updatedAt || "",
        }),
      });
      const result = await response.json() as { state?: Partial<AppState>; error?: string };
      if (!response.ok || !result.state) throw new Error(result.error || "Moy yozuvi saqlanmadi.");
      setData(normalizeAppState(result.state));
      setOilNotice(`✓ ${oilForm.flowType === "purchase" ? "Moy keldi" : "Ishlatilgan moy ketdi"} · ${oilForm.canCount} kanistr · ₩${(oilForm.canCount * oilForm.unitAmount).toLocaleString(workerLocale(language))}.`);
      setOilForm((current) => ({ ...current, unitAmount: 0, note: "" }));
    } catch (error) {
      setOilNotice(error instanceof Error ? error.message : "Moy yozuvi saqlanmadi.");
    } finally {
      workerMutationLocksRef.current.delete("worker-oil");
      setOilSaving(false);
    }
  };

  const chooseMezanaFile = async (position: "top" | "bottom", event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile) return;
    setMezanaNotice("Rasm tayyorlanmoqda…");
    try {
      const prepared = await prepareStockImageUpload(selectedFile);
      if (position === "top") {
        if (mezanaTopPreview) URL.revokeObjectURL(mezanaTopPreview);
        setMezanaTopFile(prepared.file);
        setMezanaTopPreview(URL.createObjectURL(prepared.file));
      } else {
        if (mezanaBottomPreview) URL.revokeObjectURL(mezanaBottomPreview);
        setMezanaBottomFile(prepared.file);
        setMezanaBottomPreview(URL.createObjectURL(prepared.file));
      }
      setMezanaNotice(preparedImageNotice(prepared));
    } catch (error) {
      setMezanaNotice(error instanceof Error ? error.message : "Rasm qabul qilinmadi.");
      setMezanaFileInputKey((current) => current + 1);
    }
  };

  const saveMezana = async () => {
    if (editingMezanaId) {
      if (!mezanaForm.productName.trim() || !mezanaForm.date
        || (mezanaForm.action === "purchased" && mezanaForm.amount <= 0)
        || (mezanaForm.action !== "purchased" && mezanaForm.quantity <= 0)) {
        setMezanaNotice("Mahsulot ma’lumotini tekshiring.");
        return;
      }
    } else if (!selectedMezanaCatalogItem
      || !mezanaForm.date
      || (mezanaForm.action === "purchased" && mezanaForm.itemCount <= 0)
      || (mezanaForm.action !== "purchased" && mezanaForm.quantity <= 0)) {
        setMezanaNotice("Rahbar belgilagan mahsulotni va sonini tanlang.");
        return;
      }
    if (workerMutationLocksRef.current.has("worker-mezana")) return;
    workerMutationLocksRef.current.add("worker-mezana");
    setMezanaSaving(true);
    setMezanaNotice("Saqlanmoqda va MEZANA guruhiga yuborilmoqda…");
    try {
      if (editingMezanaId) {
        const previous = data.mezanaEntries.find((entry) => entry.id === editingMezanaId);
        if (previous && previous.action !== mezanaForm.action && !window.confirm(
          `Amal turi “${mezanaDebtActionLabel(previous.action)}”dan “${mezanaDebtActionLabel(mezanaForm.action)}”ga o‘zgartiriladi. Davom etilsinmi?`,
        )) return;
        const response = await fetch("/api/worker-mezana", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entryId: editingMezanaId,
            action: mezanaForm.action,
            productName: mezanaForm.productName.trim(),
            quantity: mezanaForm.quantity,
            amount: mezanaForm.amount,
            date: mezanaForm.date,
            note: mezanaForm.note.trim(),
            updatedAt: data.updatedAt || "",
          }),
        });
        const result = await response.json() as { state?: Partial<AppState>; telegram?: { sent?: boolean; reason?: string }; error?: string };
        if (!response.ok || !result.state) throw new Error(result.error || "MEZANA yozuvi tahrirlanmadi.");
        setData(normalizeAppState(result.state));
        setEditingMezanaId("");
        setMezanaNotice(result.telegram?.sent ? "✓ Yozuv tahrirlandi va o‘zgarish MEZANA guruhiga yuborildi." : `✓ Yozuv tahrirlandi. ${result.telegram?.reason || "Telegramga yuborilmadi."}`);
        setMezanaForm((current) => ({ ...current, catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1, note: "" }));
        return;
      }
      if (!selectedMezanaCatalogItem) throw new Error("Mahsulotni qayta tanlang.");
      const form = new FormData();
      form.set("operationId", mezanaOperationIdRef.current || (mezanaOperationIdRef.current = crypto.randomUUID()));
      form.set("action", mezanaForm.action);
      form.set("catalogItemId", selectedMezanaCatalogItem.id);
      form.set("productName", selectedMezanaCatalogItem.name);
      form.set("amount", String(mezanaForm.action === "purchased" ? selectedMezanaCatalogItem.price * mezanaForm.itemCount : 0));
      form.set("quantity", String(mezanaForm.quantity));
      form.set("itemCount", String(mezanaForm.itemCount));
      form.set("date", mezanaForm.date);
      form.set("note", mezanaForm.note.trim());
      form.set("updatedAt", data.updatedAt || "");
      if (mezanaTopFile) appendImageToForm(form, "fileTop", mezanaTopFile, "mezana-yuqori");
      if (mezanaBottomFile) appendImageToForm(form, "fileBottom", mezanaBottomFile, "mezana-pastki");
      let uploadResult;
      try {
        uploadResult = await postMultipartJson<{
          entry?: MezanaDebtEntry;
          updatedAt?: string;
          balance?: number;
          telegram?: { sent?: boolean; reason?: string };
          error?: string;
        }>("/api/worker-mezana", form);
      } catch (firstError) {
        setMezanaNotice("Yozuv serverda tekshirilmoqda…");
        await new Promise((resolve) => window.setTimeout(resolve, 1_200));
        try {
          uploadResult = await postMultipartJson<{
            entry?: MezanaDebtEntry;
            updatedAt?: string;
            balance?: number;
            telegram?: { sent?: boolean; reason?: string };
            error?: string;
          }>("/api/worker-mezana", form);
        } catch {
          throw firstError;
        }
      }
      const result = uploadResult.data;
      const savedEntry = normalizeMezanaDebtEntry(result.entry);
      if (!uploadResult.ok || !savedEntry || !result.updatedAt) throw new Error(result.error || "MEZANA yozuvi saqlanmadi.");
      setData((current) => normalizeAppState({
        ...current,
        mezanaEntries: [savedEntry, ...current.mezanaEntries.filter((entry) => entry.id !== savedEntry.id)],
        mezanaBorrowedBalances: savedEntry.catalogItemId && (savedEntry.action === "borrowed" || savedEntry.action === "returned")
          ? {
              ...current.mezanaBorrowedBalances,
              [savedEntry.catalogItemId]: Math.max(0, Number(current.mezanaBorrowedBalances[savedEntry.catalogItemId] || 0)
                + (savedEntry.action === "returned" ? -Number(savedEntry.quantity || 0) : Number(savedEntry.quantity || 0))),
            }
          : current.mezanaBorrowedBalances,
        updatedAt: result.updatedAt,
      }));
      mezanaOperationIdRef.current = "";
      const savedText = `✓ ${mezanaDebtActionLabel(mezanaForm.action)} · ${selectedMezanaCatalogItem.name} · ${mezanaForm.action === "purchased" ? `₩${(selectedMezanaCatalogItem.price * mezanaForm.itemCount).toLocaleString(workerLocale(language))}` : `${mezanaForm.quantity} ta`}`;
      setMezanaNotice(result.telegram?.sent
        ? `${savedText} · MEZANA guruhiga yuborildi.`
        : `${savedText}. ${result.telegram?.reason || "MEZANA guruhiga yuborilmadi. Pastdagi TELEGRAMGA YUBORISH tugmasini bosing."}`);
      setMezanaForm((current) => ({ ...current, catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1, note: "" }));
      setMezanaTopFile(null);
      setMezanaBottomFile(null);
      setMezanaTopPreview("");
      setMezanaBottomPreview("");
      setMezanaFileInputKey((current) => current + 1);
    } catch (error) {
      setMezanaNotice(error instanceof Error ? error.message : "MEZANA yozuvi saqlanmadi.");
    } finally {
      workerMutationLocksRef.current.delete("worker-mezana");
      setMezanaSaving(false);
    }
  };

  const resendMezanaTelegram = async (entry: MezanaDebtEntry) => {
    if (mezanaTelegramBusyId) return;
    setMezanaTelegramBusyId(entry.id);
    setMezanaNotice(`${entry.productName} Telegramga yuborilmoqda…`);
    try {
      const response = await fetch("/api/worker-mezana", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id }),
      });
      const responseText = await response.text();
      let result: { ok?: boolean; telegram?: { sent?: boolean; reason?: string }; error?: string } = {};
      try {
        result = responseText ? JSON.parse(responseText) as typeof result : {};
      } catch {
        throw new Error("Telegram serveri javobi olinmadi. Tugmani qayta bosing.");
      }
      if (!response.ok || !result.ok) throw new Error(result.error || "Telegramga yuborilmadi.");
      setMezanaNotice(result.telegram?.sent
        ? `✓ ${entry.productName} MEZANA guruhiga yuborildi.`
        : result.telegram?.reason || "Telegramga yuborilmadi. Tugmani qayta bosing.");
    } catch (error) {
      setMezanaNotice(error instanceof Error ? error.message : "Telegramga yuborilmadi. Tugmani qayta bosing.");
    } finally {
      setMezanaTelegramBusyId("");
    }
  };

  const startMezanaEdit = (entry: MezanaDebtEntry) => {
    if (mezanaTopPreview) URL.revokeObjectURL(mezanaTopPreview);
    if (mezanaBottomPreview) URL.revokeObjectURL(mezanaBottomPreview);
    setMezanaTopFile(null);
    setMezanaBottomFile(null);
    setMezanaTopPreview("");
    setMezanaBottomPreview("");
    setMezanaFileInputKey((current) => current + 1);
    setEditingMezanaId(entry.id);
    setMezanaForm({
      action: entry.action,
      catalogItemId: entry.catalogItemId || "",
      productName: entry.productName,
      quantity: entry.quantity || 0,
      amount: entry.amount,
      itemCount: entry.itemCount || 1,
      date: entry.date,
      note: entry.note,
    });
    setMezanaNotice("Tahrirlash rejimi: mavjud rasmlar saqlanib qoladi.");
    window.setTimeout(() => document.getElementById("xodim-amal-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const cancelMezanaEdit = () => {
    setEditingMezanaId("");
    setMezanaForm((current) => ({ ...current, catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1, note: "" }));
    setMezanaNotice("Tahrirlash bekor qilindi.");
  };

  const deleteMezana = async (entry: MezanaDebtEntry) => {
    if (deletingMezanaId || !window.confirm(`“${entry.productName}” MEZANA yozuvi o‘chirilsinmi?`)) return;
    const reason = window.prompt("O‘chirish sababini yozing:", "Xato kiritildi")?.trim();
    if (!reason) return;
    setDeletingMezanaId(entry.id);
    setMezanaNotice("MEZANA yozuvi o‘chirilmoqda…");
    try {
      const response = await fetch("/api/worker-mezana", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id, reason, updatedAt: data.updatedAt || "" }),
      });
      const result = await response.json() as { state?: Partial<AppState>; telegram?: { sent?: boolean; reason?: string }; error?: string };
      if (!response.ok || !result.state) throw new Error(result.error || "MEZANA yozuvi o‘chirilmadi.");
      setData(normalizeAppState(result.state));
      if (editingMezanaId === entry.id) setEditingMezanaId("");
      setMezanaNotice(result.telegram?.sent ? "✓ Yozuv o‘chirildi va MEZANA guruhiga xabar yuborildi." : `✓ Yozuv o‘chirildi. ${result.telegram?.reason || "Telegramga yuborilmadi."}`);
    } catch (error) {
      setMezanaNotice(error instanceof Error ? error.message : "MEZANA yozuvi o‘chirilmadi.");
    } finally {
      setDeletingMezanaId("");
    }
  };

  const updateDeliveryLine = (lineId: string, patch: Partial<SupplierDeliveryLine>) => {
    setDeliveryLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  };

  const matchingDeliveryProducts = (deliveryLines.length >= 50 ? [] : data.inventory).filter((item) => (deliverySection === "reserve") === (item.expenseOnly === true)).filter((item) => (
    !deliveryProductSearch.trim()
    || normalizeProductKey(item.name).includes(normalizeProductKey(deliveryProductSearch))
  )).filter((item) => !deliveryLines.some((line) => line.inventoryId === item.id)).slice(0, 24);

  const addDeliveryProduct = (inventoryItem: Inventory) => {
    if (deliveryLines.length >= 50) return;
    setDeliveryLines((current) => [...current, {
      ...emptyDeliveryLine(),
      inventoryId: inventoryItem.id,
      name: inventoryItem.name,
      unit: inventoryItem.unit,
      packageSize: inventoryItem.gramsPerUnit ? `${inventoryItem.gramsPerUnit} g` : "",
      quantity: 0,
    }]);
    setDeliveryProductSearch("");
    setDeliveryNotice("");
  };

  const chooseDeliveryDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile) return;
    setDeliveryNotice("Rasm tayyorlanmoqda…");
    try {
      const prepared = await prepareStockImageUpload(selectedFile);
      if (deliveryDocumentPreview) URL.revokeObjectURL(deliveryDocumentPreview);
      setDeliveryDocumentFile(prepared.file);
      setDeliveryDocumentPreview(URL.createObjectURL(prepared.file));
      setDeliveryNotice(preparedImageNotice(prepared));
    } catch (error) {
      setDeliveryNotice(error instanceof Error ? error.message : "Rasm qabul qilinmadi.");
      setDeliveryFileInputKey((current) => current + 1);
    }
  };

  const saveSupplierDelivery = async () => {
    if (workerMutationLocksRef.current.has("supplier-delivery")) return;
    const completedLines = deliveryLines.filter((line) => (
      line.name.trim() || line.packageSize.trim() || line.quantity || line.totalAmount
    ));
    if (
      !deliveryForm.date
      || !completedLines.length
      || completedLines.some((line) => !line.name.trim() || line.quantity <= 0 || line.totalAmount <= 0)
    ) {
      setDeliveryNotice(t("delivery.required"));
      return;
    }
    if (deliveryDuplicatePending && deliveryDuplicateReason.trim().length < 5) {
      setDeliveryNotice(t("delivery.duplicateHelp"));
      return;
    }
    if (!deliveryOperationIdRef.current) deliveryOperationIdRef.current = crypto.randomUUID();
    workerMutationLocksRef.current.add("supplier-delivery");
    setDeliverySaving(true);
    setDeliveryNotice(t("delivery.saving"));
    try {
      const form = new FormData();
      form.set("supplierId", deliveryForm.supplierId);
      form.set("date", deliveryForm.date);
      form.set("note", deliveryForm.note.trim());
      form.set("inventoryOnly", "true");
      form.set("operationId", deliveryOperationIdRef.current);
      if (deliveryDuplicatePending) form.set("duplicateReason", deliveryDuplicateReason.trim());
      form.set("updatedAt", data.updatedAt || "");
      form.set("lines", JSON.stringify(completedLines));
      if (deliveryDocumentFile) form.set("file", deliveryDocumentFile);
      const response = await fetch("/api/worker-deliveries", { method: "POST", body: form });
      const result = await response.json() as {
        delivery?: SupplierDelivery;
        code?: string;
        updatedAt?: string;
        state?: Partial<AppState>;
        error?: string;
      };
      if (!response.ok || !result.delivery || !result.updatedAt || !result.state) {
        if (result.code === "SIMILAR_PURCHASE") setDeliveryDuplicatePending(true);
        throw new Error(result.error || t("delivery.saveError"));
      }
      setData(normalizeAppState(result.state));
      deliveryOperationIdRef.current = "";
      setDeliveryDuplicatePending(false);
      setDeliveryDuplicateReason("");
      setDeliveryForm({ supplierId: "", date: today, note: "" });
      setDeliveryLines([]);
      setDeliveryProductSearch("");
      setDeliveryDocumentFile(null);
      setDeliveryDocumentPreview("");
      setDeliveryFileInputKey((current) => current + 1);
      setDeliveryNotice(t("delivery.saved", { count: completedLines.length, total: completedLines.reduce((sum, line) => sum + line.totalAmount, 0).toLocaleString(workerLocale(language)) }));
    } catch (error) {
      setDeliveryNotice(translateWorkerError(error instanceof Error ? error.message : "", language, "delivery.saveError"));
    } finally {
      workerMutationLocksRef.current.delete("supplier-delivery");
      setDeliverySaving(false);
    }
  };

  const selectedInventory = data.inventory.find((item) => item.id === wasteForm.inventoryId);
  const wasteInputUnits = selectedInventory ? compatibleInventoryInputUnits(selectedInventory.unit) : [];
  const selectedWasteStockQuantity = selectedInventory
    ? inventoryQuantityFromInput(wasteForm.quantity, wasteInputUnit, selectedInventory.unit)
    : 0;
  const selectedWasteCost = selectedInventory ? selectedWasteStockQuantity * Number(selectedInventory.unitCost || 0) : 0;
  const cashSaleCopy = CASH_SALE_COPY[language];
  const workerUsageCopy = WORKER_USAGE_COPY[language];
  const selectedUsageRecipe = data.recipes.find((recipe) => recipe.id === wasteForm.recipeId);
  const visibleCashSaleRecipes = data.recipes.filter((recipe) => (
    !cashSaleSearch.trim()
    || normalizeProductKey(recipe.name).includes(normalizeProductKey(cashSaleSearch))
    || recipe.posCode.includes(cashSaleSearch.trim().toLocaleUpperCase("en-US"))
  ));
  const selectedCashSaleKinds = data.recipes.filter((recipe) => Number(cashSaleQuantities[recipe.id] || 0) > 0).length;
  const selectedCashSaleQuantity = data.recipes.reduce((sum, recipe) => sum + Math.max(0, Number(cashSaleQuantities[recipe.id] || 0)), 0);
  const openAssignedTasks = assignedTasks.filter((entry) => entry.status === "new" || entry.status === "started");
  const visibleAssignedTasks = [
    ...openAssignedTasks,
    ...assignedTasks.filter((entry) => entry.status === "done").slice(0, 10),
  ];
  const taskInfo = {
    pos: { step: "01", icon: "XL", title: t("nav.posTitle"), detail: t("nav.posDetail") },
    cashsale: { step: "02", icon: "−", title: cashSaleCopy.navTitle, detail: cashSaleCopy.navDetail },
    waste: { step: "03", icon: "−", title: workerUsageCopy.navTitle, detail: workerUsageCopy.navDetail },
    expense: { step: "04", icon: "₩", title: t("nav.expenseTitle"), detail: t("nav.expenseDetail") },
    delivery: { step: "05", icon: "📦", title: t("nav.deliveryTitle"), detail: t("nav.deliveryDetail") },
    oil: { step: "06", icon: "🛢", title: "Chicken moyi", detail: "Moy keldi yoki ishlatilgan moy ketdi" },
    mezana: { step: "07", icon: "M", title: "MEZANA", detail: "Faqat MEZANA qarzi va qaytarilgan summa" },
  } satisfies Record<WorkerTask, { step: string; icon: string; title: string; detail: string }>;
  const visibleWorkerTasks = (Object.keys(taskInfo) as WorkerTask[]).filter((taskId) => (
    taskId === "delivery" ? canSupplierDelivery : !["expense", "oil", "mezana"].includes(taskId) || canWarehouseReceipt
  ));
  const earnings = attendance.earnings;
  const attendanceDateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(
    workerLocale(language),
    { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Seoul" },
  );
  const attendanceTimeLabel = (value: string) => value
    ? new Date(value).toLocaleTimeString(workerLocale(language), {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      })
    : "—";

  const languagePicker = (compact = false) => (
    <label className={`worker-language-picker${compact ? " compact" : ""}`}>
      <span>{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        value={language}
        onChange={(event) => changeLanguage(event.target.value as WorkerLanguage)}
      >
        {WORKER_LANGUAGES.map((item) => <option value={item.code} key={item.code}>{compact ? item.shortLabel : item.label}</option>)}
      </select>
    </label>
  );

  if (!authReady) {
    return <main className="worker-shell worker-login-shell"><section className="worker-login-card"><div className="worker-brand"><span>H</span><div><strong>HALO</strong><small>{t("brand.subtitle")}</small></div></div><p>{t("loading.checking")}</p></section></main>;
  }

  if (!authenticated) {
    return <main className="worker-shell worker-login-shell"><section className="worker-login-card">
      <div className="worker-login-tools"><Link className="worker-login-back" href="/">{t("login.back")}</Link>{languagePicker()}</div>
      <div className="worker-brand"><span>H</span><div><strong>HALO</strong><small>{t("brand.subtitle")}</small></div></div>
      <div className="worker-login-copy"><span>{t("login.kicker")}</span><h1>{t("login.title")}</h1><p>{t("login.description")}</p></div>
      <label><span>{t("login.branch")}</span><select value={activeBranchId} onChange={(event) => setActiveBranchId(event.target.value)}><option value="">{t("login.chooseBranch")}</option>{branches.filter((branch) => branch.configured).map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
      <label><span>{t("login.username")}</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder={t("login.usernamePlaceholder")} /></label>
      <label><span>{t("login.pin")}</span><input type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="••••" onKeyDown={(event) => { if (event.key === "Enter") void login(); }} /></label>
      {loginNotice && <p className="worker-notice">{loginNotice}</p>}
      {bootstrapFailed && <><p className="worker-notice">{status}</p><button className="worker-retry-action" type="button" onClick={() => setBootstrapAttempt((current) => current + 1)}>{t("login.retry")}</button></>}
      <button className="worker-primary-action" onClick={() => void login()} disabled={busy}>{busy ? t("login.checking") : t("login.submit")}</button>
      {!branches.some((branch) => branch.configured) && <small className="worker-login-help">{t("login.setupHelp")}</small>}
      <XodimInstall language={language} />
    </section></main>;
  }

  return (
    <main className="worker-shell">
      <header className="worker-header">
        <div className="worker-brand">
          <span>H</span>
          <div><strong>HALO</strong><small>{t("brand.subtitle")}</small></div>
        </div>
        <div className="worker-header-status">
          {activePortalSection === "actions" && task && <button className="worker-back" type="button" onClick={closeWorkerTask}>{t("header.backTasks")}</button>}
          <label className="worker-branch-switcher"><span>{t("header.branch")}</span><select value={activeBranchId} disabled><option value={activeBranchId}>{branches.find((branch) => branch.id === activeBranchId)?.name || t("header.branchFallback")}</option></select></label>
          <strong className="worker-account-name">{workerName}</strong>
          <span><i /> {status}</span>
          {languagePicker(true)}
          <XodimInstall compact language={language} />
          <button className="worker-logout" onClick={() => void logout()}>{t("header.logout")}</button>
          <b>{displayDate(today)}</b>
        </div>
      </header>

      <div className="worker-page">
        <section className="worker-welcome worker-welcome-compact">
          <div>
            <span>{t("welcome.kicker")}</span>
            <h1>{t("welcome.hello", { name: workerName })}</h1>
            <p>{t("welcome.dashboard")}</p>
            <div className="worker-kitchen-rules">
              <div><span>🍳</span><strong>Oshxona qonun-qoidalari</strong></div>
              <ol>{data.kitchenRules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
            </div>
          </div>
          <b>{openAssignedTasks.length ? t("welcome.newTasks", { count: openAssignedTasks.length }) : "12:00 → 00:00"}</b>
        </section>

        <nav className="worker-section-nav" aria-label={t("quick.label")}>
          <button className={activePortalSection === "today" ? "active" : ""} type="button" onClick={() => openPortalSection("today")}><i>●</i><span><small>01</small><b>{t("quick.today")}</b></span></button>
          <button className={activePortalSection === "account" ? "active" : ""} type="button" onClick={() => openPortalSection("account")}><i>₩</i><span><small>02</small><b>{t("quick.account")}</b></span></button>
          <button className={activePortalSection === "actions" ? "active" : ""} type="button" onClick={() => openPortalSection("actions")}><i>＋</i><span><small>03</small><b>{t("quick.actions")}</b></span></button>
          <button className={activePortalSection === "tasks" ? "active" : ""} type="button" onClick={() => openPortalSection("tasks")}><i>✓</i><span><small>04</small><b>{t("quick.tasks")}</b></span></button>
        </nav>

        {activePortalSection === "today" && <section id="xodim-portal-window" className={`worker-portal-window worker-attendance-card${attendance.openShift ? " working" : ""}${attendance.todayStatus && !attendance.openShift ? " day-status" : ""}`}>
          <div className="worker-attendance-copy"><span>{t("attendance.kicker")}</span><h2>{attendanceLoading ? t("attendance.loadingTitle") : attendance.linked ? attendance.openShift ? t("attendance.working") : attendance.todayStatus ? t(attendance.todayStatus.status === "off" ? "attendance.off" : attendance.todayStatus.status === "sick" ? "attendance.sick" : "attendance.absent") : t("attendance.ready") : t("attendance.unlinked")}</h2><p>{attendanceLoading ? t("attendance.loadingDetail") : attendance.linked ? attendance.openShift ? t("attendance.startedAt", { time: new Date(attendance.openShift.clockIn).toLocaleTimeString(workerLocale(language), { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }) }) : attendance.todayStatus ? (attendance.todayStatus.note || t("attendance.managerStatus")) : t("attendance.instruction") : t("attendance.unlinkedDetail")}</p></div>
          <div className="worker-attendance-month"><small>{t("attendance.historyEarned")}</small><strong>₩{(earnings?.totalEarned || 0).toLocaleString(workerLocale(language))}</strong><span>{t("attendance.historyDayCount", { count: earnings?.workedDays || 0 })} · {displayMinutes(earnings?.workedMinutes || 0)}</span></div>
          <button className={attendance.openShift ? "finish" : "start"} type="button" disabled={attendanceLoading || !attendance.linked || attendanceBusy || Boolean(attendance.todayStatus && !attendance.openShift)} onClick={() => void updateAttendance(attendance.openShift ? "clock-out" : "clock-in")}>{attendanceBusy ? t("status.saving") : attendance.openShift ? t("attendance.finish") : attendance.todayStatus ? t("attendance.managerMarked") : t("attendance.start")}</button>
          {attendanceNotice && <p className={attendanceNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"} role={attendanceNotice.startsWith("✓") ? "status" : "alert"}>{attendanceNotice}</p>}
        </section>}

        {activePortalSection === "today" && <section className="worker-operations-panel">
          <div className="worker-operations-head">
            <div><span>KUNLIK TARTIB</span><h2>Ochilish / Yopilish nazorati</h2><p>Bandni bajarganingizdan keyin belgilang. Ismingiz va vaqt avtomatik saqlanadi.</p></div>
            <b>{operations?.checklist.completed || 0}/{operations?.checklist.total || 12}</b>
          </div>
          {!operationsLoading && operations && !operations.canEdit && <div className="worker-operations-lock"><i>◷</i><span><strong>Avval ishni boshlang</strong><small>Belgilar faqat ochiq smena davomida bosiladi.</small></span></div>}
          <div className="worker-operations-grid">
            {(operations?.checklist.phases || []).map((phase) => <article className={phase.phase} key={phase.phase}>
              <header><span><i>{phase.phase === "opening" ? "☀" : "☾"}</i><span><small>{phase.phase === "opening" ? "SMENA BOSHI" : "SMENA OXIRI"}</small><strong>{phase.title}</strong></span></span><b>{phase.completed}/{phase.total}</b></header>
              <div>{phase.items.map((item) => <button className={item.completed ? "done" : ""} type="button" disabled={operations?.canEdit !== true || operationBusy === item.id} onClick={() => void updateOperation(item.id, !item.completed)} key={item.id}><i>{operationBusy === item.id ? "…" : item.completed ? "✓" : ""}</i><span><strong>{item.title}</strong><small>{item.completion ? `${item.completion.completedBy} · ${new Date(item.completion.completedAt).toLocaleTimeString(workerLocale(language), { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })}` : item.detail}</small></span></button>)}</div>
            </article>)}
          </div>
          {operationsLoading && <p className="worker-operations-loading">Kunlik nazorat yuklanmoqda…</p>}
          {operationNotice && <p className={operationNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{operationNotice}</p>}
        </section>}

        {activePortalSection === "account" && <section id="xodim-portal-window" className="worker-portal-window worker-earnings-panel">
          <div className="worker-earnings-head">
            <div><span>{t("attendance.historyKicker")}</span><h2>{t("attendance.historyTitle")}</h2><p>{t("attendance.historyPrivacy")}</p></div>
            <label><span>{t("attendance.historyMonth")}</span><input type="month" value={attendanceMonth} onChange={(event) => { setAttendanceLoading(true); setAttendanceMonth(event.target.value || calendarMonth()); }} /></label>
          </div>
          <div className="worker-earnings-metrics">
            <article><span>{t("attendance.historyDays")}</span><strong>{earnings?.workedDays || 0}</strong></article>
            <article><span>{t("attendance.historyHours")}</span><strong>{displayMinutes(earnings?.workedMinutes || 0)}</strong></article>
            <article className="money"><span>{t("attendance.historyEarned")}</span><strong>₩{(earnings?.totalEarned || 0).toLocaleString(workerLocale(language))}</strong></article>
          </div>
          <div className="worker-earnings-list">
            <div className="worker-earnings-labels"><span>{t("attendance.historyDate")}</span><span>{t("attendance.historyTime")}</span><span>{t("attendance.historyDuration")}</span><span>{t("attendance.historyAmount")}</span></div>
            {earnings?.days.length ? earnings.days.map((day) => <article className={day.status} key={day.date}>
              <b>{attendanceDateLabel(day.date)}</b>
              <span>{attendanceTimeLabel(day.clockIn)} → {day.status === "open" ? t("attendance.historyOpen") : attendanceTimeLabel(day.clockOut)}</span>
              <strong>{displayMinutes(day.workedMinutes)}</strong>
              <em>{day.status === "conflict" ? t("attendance.historyConflict") : day.status === "open" ? t("attendance.historyPending") : `₩${day.amount.toLocaleString(workerLocale(language))}`}</em>
            </article>) : <div className="worker-earnings-empty">{attendanceLoading ? t("attendance.loadingTitle") : t("attendance.historyEmpty")}</div>}
          </div>
        </section>}

        {activePortalSection === "actions" && <section id="xodim-portal-window" className="worker-inventory-count">
          <button type="button" className="worker-count-toggle" aria-expanded={inventoryCountOpen} aria-controls="worker-inventory-count-panel" onClick={() => setInventoryCountOpen(value => !value)}>📋 Omborni sanash {inventoryCountOpen ? '−' : '+'}</button>
          {inventoryCountOpen && <div id="worker-inventory-count-panel"><InventoryAccountingPanel workerMode key={activeBranchId} branchId={activeBranchId} onBefore={async () => { if (persistLocksRef.current.size || workerMutationLocksRef.current.size) throw new Error("Avval joriy saqlash tugasin."); }} onSaved={async () => { const response = await fetch("/api/worker-state", { cache: "no-store" }); if (response.ok) setData(normalizeAppState(await response.json())); }} /></div>}
        </section>}

        {activePortalSection === "actions" && <section className="worker-portal-window worker-actions-section">
          <div className="worker-actions-head"><span>{t("actions.kicker")}</span><h2>{t("actions.title")}</h2><p>{t("actions.detail")}</p></div>
          <nav className="worker-task-nav" aria-label={t("tasks.navLabel")}>
            {visibleWorkerTasks.map((taskId) => {
              const item = taskInfo[taskId];
              return (
                <button
                  key={taskId}
                  className={`${task === taskId ? "active " : ""}task-${taskId}`}
                  onClick={() => openWorkerTask(taskId)}
                >
                  <i>{item.icon}</i>
                  <span><small>{t("tasks.step", { step: item.step })}</small><strong>{item.title}</strong><em>{item.detail}</em></span>
                  <b>→</b>
                </button>
              );
            })}
          </nav>
        </section>}

        {activePortalSection === "tasks" && <section id="xodim-portal-window" className="worker-portal-window worker-assigned-panel">
          <div className="worker-assigned-summary"><span><i>{openAssignedTasks.length ? "!" : "✓"}</i><span><small>{t("tasks.kicker")}</small><strong>{t("tasks.title")}</strong></span></span><b>{t("tasks.openCount", { count: openAssignedTasks.length })}</b></div>
          <div className="worker-assigned-body">
            <div className="worker-assigned-tools"><button className={telegramLinked ? "telegram enabled" : "telegram"} disabled={telegramLinked || telegramPairBusy === "link"} onClick={() => void prepareOwnTelegram()}>{telegramLinked ? `✈ Telegram ✓${telegramChatName ? ` · ${telegramChatName}` : ""}` : telegramPairBusy === "link" ? t("tasks.linkLoading") : t("tasks.linkTelegram")}</button><button className={notificationsEnabled ? "enabled" : ""} onClick={() => void enableNotifications()}>{notificationsEnabled ? t("tasks.notificationsOn") : t("tasks.notificationsEnable")}</button></div>
            {telegramPairUrl && <div className="worker-telegram-connect"><span><b>{t("tasks.telegramStep1")}</b><small>{t("tasks.telegramStart")}</small></span><a href={telegramPairUrl} target="_blank" rel="noreferrer">{t("tasks.openTelegram")}</a><button disabled={telegramPairBusy === "check"} onClick={() => void checkOwnTelegram()}>{telegramPairBusy === "check" ? t("tasks.checking") : t("tasks.checkTelegram")}</button></div>}
            {telegramPairNotice && <p className={telegramPairNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{telegramPairNotice}</p>}
            {assignedTaskNotice && <p className={assignedTaskNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{assignedTaskNotice}</p>}
            <div className="worker-assigned-list">
              {visibleAssignedTasks.length ? visibleAssignedTasks.map((entry) => <article className={`${entry.status} ${entry.priority}`} key={entry.id}>
                <div className="worker-assigned-priority"><i>{entry.priority === "urgent" ? "!" : entry.priority === "important" ? "●" : "✓"}</i><span><b>{t(entry.priority === "urgent" ? "tasks.priorityUrgent" : entry.priority === "important" ? "tasks.priorityImportant" : "tasks.priorityNormal")}</b><small>{entry.dueAt ? t("tasks.deadline", { date: entry.dueAt.replace("T", " ") }) : t("tasks.noDeadline")}</small></span></div>
                <div className="worker-assigned-copy"><h3>{entry.title}</h3>{entry.description && <p>{entry.description}</p>}<small>{t("tasks.sent", { date: new Date(entry.createdAt).toLocaleString(workerLocale(language)) })}</small></div>
                <div className="worker-assigned-actions">
                  {entry.status === "new" && <button disabled={assignedTaskBusy === entry.id} onClick={() => void updateAssignedTask(entry.id, "started")}>{t("tasks.start")}</button>}
                  {(entry.status === "new" || entry.status === "started") && <button className="done" disabled={assignedTaskBusy === entry.id} onClick={() => void updateAssignedTask(entry.id, "done")}>{t("tasks.done")}</button>}
                  {entry.status === "done" && <b>{t("tasks.completed")}</b>}
                </div>
              </article>) : <div className="worker-assigned-empty"><i>✓</i><span><strong>{t("tasks.emptyTitle")}</strong><small>{t("tasks.emptyDetail")}</small></span></div>}
            </div>
          </div>
        </section>}

        {activePortalSection === "actions" && task === "pos" && (
          <section id="xodim-amal-form" className="worker-card">
            <div className="worker-card-head">
              <div><span>{t("pos.kicker")}</span><h2>{t("pos.title")}</h2><p>{t("pos.description")}</p></div>
              <label className={`worker-upload${posReading ? " reading" : ""}`}>
                <i>XL</i>
                <span><strong>{posReading ? t("pos.reading") : t("pos.chooseFile")}</strong><small>.xlsx · .xls · .csv</small></span>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={readPosFile} disabled={posReading || busy} />
              </label>
            </div>

            {posNotice && <p className={posNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{posNotice}</p>}

            {posTable && (
              <>
                <div className="worker-file-meta">
                  <div><small>{t("pos.file")}</small><strong>{posTable.fileName}</strong></div>
                  <div><small>{posTable.reportDate ? t("pos.date") : t("pos.sheet")}</small><strong>{posTable.reportDate || posTable.sheetName}</strong></div>
                  <div><small>{t("pos.rowsRead")}</small><strong>{t("pos.count", { count: parsedPos.rows.length.toLocaleString(workerLocale(language)) })}</strong></div>
                </div>

                <div className="worker-section-title"><span>{t("pos.step1")}</span><h3>상품코드, 수량 va savdo summasi</h3></div>
                <div className="worker-mapping-grid">
                  <label><span>상품코드 · Mahsulot kodi</span><select value={posMapping.productCode} onChange={(event) => { setPosMapping({ ...posMapping, productCode: event.target.value, quantity: posMapping.quantity }); setPosProductMap({}); }}><option value="">상품코드 ustunini tanlang</option>{posTable.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
                  <label><span>수량 · {t("pos.quantity")}</span><select value={posMapping.quantity} onChange={(event) => setPosMapping({ ...posMapping, productCode: posMapping.productCode, quantity: event.target.value })}><option value="">수량 ustunini tanlang</option>{posTable.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
                </div>

                <div className="worker-section-title"><span>{t("pos.step2")}</span><h3>Kodlarni HALO menyusi bilan tekshiring</h3></div>
                <div className="worker-product-map">
                  {posProducts.map((product) => (
                    <div className={product.recipeId ? "matched" : "unmatched"} key={product.key}>
                      <span><i>{product.recipeId ? "✓" : "!"}</i><b>{product.name}</b><small>{product.productCode ? `${product.productCode} · ` : ""}{t("pos.itemCount", { count: product.quantity.toLocaleString(workerLocale(language)) })}</small></span>
                      <select value={product.recipeId} aria-label={`${product.name} retsepti`} onChange={(event) => setPosProductMap({ ...posProductMap, [product.key]: event.target.value })}>
                        <option value="">{t("pos.chooseRecipe")}</option>
                        {recipeCategories.map((category) => <optgroup label={category.name} key={category.id}>{data.recipes.filter((recipe) => recipe.categoryId === category.id).map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.posCode} · {recipe.name}</option>)}</optgroup>)}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="worker-import-summary">
                  <div><span>{t("pos.ready")}</span><strong>{importablePosRows.length}</strong></div>
                  <div className={unmatchedPosRows.length ? "warning" : ""}><span>{t("pos.unmatched")}</span><strong>{unmatchedPosRows.length}</strong></div>
                  <div><span>{t("pos.duplicate")}</span><strong>{duplicatePosRows.length}</strong></div>
                </div>
                {duplicatePosRows.length > 0 && <p className="worker-notice">Oldingi qatorlar qayta yozilmaydi. Ularning summasini rahbar POS fayli bilan solishtiradi.</p>}
                {!!parsedPos.errors?.length && <p className="worker-notice" role="alert">{parsedPos.errors.join(" ")}</p>}
                {!!posReconciliation.conflicts.length && <p className="worker-notice" role="alert">{posConflictMessage(language)} {posReconciliation.conflicts.map((row) => `${row.productCode}: ${row.quantity} / ${row.savedQuantity}`).join("; ")}</p>}
                <div className="worker-submit-row">
                  <label><span>{t("pos.paymentAccount")}</span><select value={posAccountId} onChange={(event) => setPosAccountId(event.target.value)}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                  <button onClick={importPosSales} disabled={busy || !importablePosRows.length || unmatchedPosRows.length > 0 || posReconciliation.conflicts.length > 0 || !!parsedPos.errors?.length || !!(parsedPos.summary && !parsedPos.summary.matches)}>{busy ? t("status.saving") : t("pos.confirm")}</button>
                </div>
              </>
            )}
          </section>
        )}

        {activePortalSection === "actions" && task === "cashsale" && (
          <section id="xodim-amal-form" className="worker-card worker-cash-sale-card">
            <div className="worker-card-head">
              <div><span>{cashSaleCopy.kicker}</span><h2>{cashSaleCopy.title}</h2><p>{cashSaleCopy.description}</p></div>
              <i className="worker-card-icon">−</i>
            </div>
            {editingConsumption?.kind === "inventory_only" && <div className="worker-consumption-editing"><span><b>TAHRIRLASH REJIMI</b><small>Eski ombor ayirmasi qaytarilib, yangi miqdor bir marta hisoblanadi.</small></span><button type="button" onClick={cancelConsumptionEdit}>BEKOR QILISH</button></div>}
            <div className="worker-cash-sale-top">
              <label><span>{cashSaleCopy.date}</span><input type="date" value={cashSaleForm.date} onChange={(event) => setCashSaleForm({ ...cashSaleForm, date: event.target.value })} /></label>
              <label><span>{cashSaleCopy.reason}</span><select value={cashSaleForm.reason} onChange={(event) => setCashSaleForm({ ...cashSaleForm, reason: event.target.value })}>{INVENTORY_OUTFLOW_REASONS.map((reason) => <option value={reason} key={reason}>{reason}</option>)}</select></label>
            </div>
            <div className="worker-cash-sale-toolbar"><input aria-label={cashSaleCopy.search} placeholder={cashSaleCopy.search} value={cashSaleSearch} onChange={(event) => setCashSaleSearch(event.target.value)} /><button type="button" disabled={!selectedCashSaleKinds || busy} onClick={() => setCashSaleQuantities({})}>{cashSaleCopy.clear}</button></div>
            <div className="worker-cash-sale-categories">
              {recipeCategories.map((category) => {
                const recipes = visibleCashSaleRecipes.filter((recipe) => recipe.categoryId === category.id);
                if (!recipes.length) return null;
                return <section key={category.id}><h3>{category.name}</h3><div>{recipes.map((recipe) => <label className={Number(cashSaleQuantities[recipe.id] || 0) > 0 ? "selected" : ""} key={recipe.id}><span><strong>{recipe.name}</strong><small>{recipe.posCode} · {cashSaleCopy.stock}</small></span><input aria-label={`${recipe.name} sotilgan soni`} type="number" min="0" step="1" inputMode="numeric" disabled={busy} placeholder="0" value={cashSaleQuantities[recipe.id] || ""} onChange={(event) => setCashSaleQuantities((current) => ({ ...current, [recipe.id]: Number(event.target.value) }))} /></label>)}</div></section>;
              })}
              {!visibleCashSaleRecipes.length && <p>{cashSaleCopy.empty}</p>}
            </div>
            <div className="worker-cash-sale-summary"><span><small>{cashSaleCopy.total}</small><strong>{selectedCashSaleKinds} tur · {selectedCashSaleQuantity.toLocaleString(workerLocale(language))} porsiya</strong></span><b>Daromad yaratilmaydi · sabab saqlanadi</b></div>
            {cashSaleNotice && <p className={cashSaleNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{cashSaleNotice}</p>}
            <button className="worker-primary-action" onClick={() => void saveCashBankSales()} disabled={busy || !selectedCashSaleKinds}>{busy ? cashSaleCopy.saving : editingConsumption ? "O‘ZGARISHNI SAQLASH VA QAYTA HISOBLASH" : cashSaleCopy.submit}</button>
          </section>
        )}

        {activePortalSection === "actions" && task === "waste" && (
          <section id="xodim-amal-form" className="worker-card worker-simple-card worker-usage-card">
            <div className="worker-card-head">
              <div><span>{workerUsageCopy.kicker}</span><h2>{workerUsageCopy.title}</h2><p>{workerUsageCopy.description}</p></div>
              <i className="worker-card-icon">−</i>
            </div>
            {editingConsumption && editingConsumption.kind !== "inventory_only" && <div className="worker-consumption-editing"><span><b>TAHRIRLASH REJIMI</b><small>Yeyilgan vaqt saqlanadi; miqdor va ombor qoldig‘i qayta hisoblanadi.</small></span><button type="button" onClick={cancelConsumptionEdit}>BEKOR QILISH</button></div>}
            <div className="worker-usage-kind" role="group" aria-label="Yozuv turi">
              {([
                ["meal", "🍽", workerUsageCopy.meal, workerUsageCopy.mealHelp],
                ["product", "🥤", workerUsageCopy.product, workerUsageCopy.productHelp],
                ["waste", "−", workerUsageCopy.waste, workerUsageCopy.wasteHelp],
              ] as const).map(([kind, icon, title, detail]) => <button
                type="button"
                className={wasteForm.kind === kind ? "active" : ""}
                key={kind}
                onClick={() => {
                  setWasteForm((current) => ({
                    ...current,
                    kind,
                    recipeId: "",
                    inventoryId: "",
                    quantity: kind === "meal" ? 1 : 0,
                    reason: kind === "meal" ? "Xodim yegan taom" : kind === "product" ? "Xodim yegan mahsulot" : wasteReasons[0],
                  }));
                  setWasteInputUnit("");
                }}
              ><i>{icon}</i><span><strong>{title}</strong><small>{detail}</small></span></button>)}
            </div>
            <div className="worker-form">
              {wasteForm.kind === "meal" ? <label className="wide"><span>{workerUsageCopy.chooseMeal}</span><select value={wasteForm.recipeId} onChange={(event) => setWasteForm({ ...wasteForm, recipeId: event.target.value })}><option value="">{workerUsageCopy.chooseMeal}</option>{recipeCategories.map((category) => <optgroup label={category.name} key={category.id}>{data.recipes.filter((recipe) => recipe.categoryId === category.id).map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.name}</option>)}</optgroup>)}</select></label>
                : <label className="wide"><span>Ombordagi barcha mahsulotlardan tanlang</span><select value={wasteForm.inventoryId} onChange={(event) => { const item = data.inventory.find((entry) => entry.id === event.target.value); setWasteForm({ ...wasteForm, inventoryId: event.target.value, quantity: 0 }); setWasteInputUnit(item?.unit || ""); }}><option value="">{workerUsageCopy.chooseProduct}</option>{inventoryCategories.map((category) => <optgroup label={category.name} key={category.id}>{data.inventory.filter((item) => item.categoryId === category.id).map((item) => <option value={item.id} key={item.id}>{item.name} · {item.stock.toLocaleString(workerLocale(language))} {item.unit}</option>)}</optgroup>)}</select></label>}
              <label><span>{workerUsageCopy.quantity}</span><div className="worker-unit-input"><input type="number" min="0" step={wasteForm.kind === "meal" ? "1" : "any"} placeholder={wasteForm.kind === "waste" ? "Masalan: 200" : "0"} value={wasteForm.quantity || ""} onChange={(event) => setWasteForm({ ...wasteForm, quantity: Number(event.target.value) })} />{wasteForm.kind === "meal" ? <b>porsiya</b> : <select aria-label="Chiqit o‘lchov birligi" value={wasteInputUnit || selectedInventory?.unit || ""} onChange={(event) => setWasteInputUnit(event.target.value)}>{wasteInputUnits.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select>}</div></label>
              {wasteForm.kind === "waste" ? <label><span>{workerUsageCopy.reason}</span><select value={wasteForm.reason} onChange={(event) => setWasteForm({ ...wasteForm, reason: event.target.value })}>{wasteReasons.map((reason) => <option value={reason} key={reason}>{t(wasteReasonKeys[reason])}</option>)}</select></label> : <label><span>{workerUsageCopy.reason}</span><input value={wasteForm.kind === "meal" ? workerUsageCopy.meal : workerUsageCopy.product} disabled /></label>}
              <label><span>{workerUsageCopy.date}</span><input type="date" value={wasteForm.date} onChange={(event) => setWasteForm({ ...wasteForm, date: event.target.value })} /></label>
              <label className="wide"><span>{workerUsageCopy.note}</span><input value={wasteForm.note} onChange={(event) => setWasteForm({ ...wasteForm, note: event.target.value })} placeholder={workerUsageCopy.notePlaceholder} maxLength={300} /></label>
            </div>
            {(selectedInventory || selectedUsageRecipe) && <div className={`worker-current-stock ${selectedInventory && wasteForm.kind === "waste" ? "worker-waste-calculation" : ""}`}><span>{wasteForm.kind === "meal" ? workerUsageCopy.mealHelp : selectedInventory && wasteForm.kind === "waste" ? <><b>Omborda: {selectedInventory.stock.toLocaleString(workerLocale(language))} {selectedInventory.unit}</b><small>Chiqit qiymati: ₩{Math.round(selectedWasteCost).toLocaleString(workerLocale(language))}</small></> : t("waste.stock")}</span><strong>{selectedInventory ? wasteForm.kind === "waste" && selectedWasteStockQuantity > 0 ? `−${selectedWasteStockQuantity.toLocaleString(workerLocale(language), { maximumFractionDigits: 3 })} ${selectedInventory.unit} → ${(selectedInventory.stock - selectedWasteStockQuantity).toLocaleString(workerLocale(language), { maximumFractionDigits: 3 })} ${selectedInventory.unit} qoladi` : `${selectedInventory.stock.toLocaleString(workerLocale(language))} ${selectedInventory.unit}` : `${selectedUsageRecipe?.ingredients.length || 0} tur mahsulot`}</strong></div>}
            {wasteNotice && <p className={wasteNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{wasteNotice}</p>}
            <button className="worker-primary-action" onClick={() => void saveWaste()} disabled={busy}>{busy ? workerUsageCopy.saving : editingConsumption ? "O‘ZGARISHNI SAQLASH VA QAYTA HISOBLASH" : wasteForm.kind === "waste" ? "CHIQITNI HISOBLAB OMBORDAN AYIRISH" : workerUsageCopy.submit}</button>
            <div className="worker-usage-history">
              <h3>{workerUsageCopy.history}</h3>
              {data.workerConsumptions.length ? data.workerConsumptions.slice(0, 20).map((entry) => <article key={entry.id}>
                <i>{entry.kind === "meal" ? "🍽" : entry.kind === "product" ? "🥤" : "−"}</i>
                <span><strong>{entry.label}</strong><small>{entry.reason}{entry.note ? ` · ${entry.note}` : ""}</small>{entry.editedAt && <small className="worker-consumption-edited">Tahrirlangan · {displayWorkerRecordTime(entry.editedAt)}</small>}</span>
                <b>{entry.quantity.toLocaleString(workerLocale(language))} {entry.unit}</b>
                <time>Yeyilgan/chiqqan vaqt · {displayWorkerRecordTime(entry.createdAt)}</time>
                <footer className="worker-consumption-actions"><button type="button" disabled={Boolean(consumptionActionBusy)} onClick={() => editConsumption(entry)}>TAHRIRLASH</button><button type="button" className="danger" disabled={Boolean(consumptionActionBusy)} onClick={() => void deleteConsumption(entry)}>{consumptionActionBusy === entry.id ? "O‘CHIRILMOQDA…" : "O‘CHIRISH"}</button></footer>
              </article>) : <p>{workerUsageCopy.historyEmpty}</p>}
            </div>
          </section>
        )}

        {activePortalSection === "actions" && task === "expense" && canWarehouseReceipt && (
          <section id="xodim-amal-form" className="worker-card worker-simple-card">
            <div className="worker-card-head">
              <div><span>{t("expense.kicker")}</span><h2>{t("expense.title")}</h2><p>{t("expense.description")}</p></div>
              <i className="worker-card-icon">₩</i>
            </div>
            <div className="worker-form">
              <label><span>{t("expense.type")}</span><select value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}>{expenseCategories.map((category) => <option value={category} key={category}>{category === "Do‘kon / omborsiz mahsulot" ? category : t(expenseCategoryKeys[category])}</option>)}</select></label>
              <label><span>Do‘kon / yetkazib beruvchi</span><input maxLength={120} value={expenseForm.sourceName} onChange={(event) => setExpenseForm({ ...expenseForm, sourceName: event.target.value })} placeholder="Masalan: Mahalla do‘koni" /></label>
              <label className="wide"><span>Mahsulot yoki xarajat nomi</span><input maxLength={140} value={expenseForm.itemName} onChange={(event) => setExpenseForm({ ...expenseForm, itemName: event.target.value })} placeholder="Omborda yo‘q mahsulot yoki xarajat" /></label>
              <label><span>{t("expense.amount")}</span><input type="number" min="0" step="1" placeholder="0" value={expenseForm.amount || ""} onChange={(event) => setExpenseForm({ ...expenseForm, amount: Number(event.target.value) })} /></label>
              <label><span>{t("expense.account")}</span><select value={expenseForm.accountId} onChange={(event) => setExpenseForm({ ...expenseForm, accountId: event.target.value })}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
              <label><span>{t("expense.date")}</span><input type="date" value={expenseForm.date} onChange={(event) => setExpenseForm({ ...expenseForm, date: event.target.value })} /></label>
              <label className="wide"><span>{t("expense.note")}</span><input value={expenseForm.note} onChange={(event) => setExpenseForm({ ...expenseForm, note: event.target.value })} placeholder={t("expense.notePlaceholder")} /></label>
            </div>
            {expenseNotice && <p className={expenseNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{expenseNotice}</p>}
            <button className="worker-primary-action" onClick={saveExpense} disabled={busy}>{busy ? t("status.saving") : t("expense.confirm")}</button>
          </section>
        )}

        {activePortalSection === "actions" && task === "oil" && canWarehouseReceipt && (
          <section id="xodim-amal-form" className="worker-card worker-simple-card worker-oil-entry-card">
            <div className="worker-card-head">
              <div><span>CHICKEN MOYI</span><h2>Moy kirimi va chiqimi</h2><p>Yangi moy kelganda yoki ishlatilgan moy olib ketilganda shu yerga kiriting.</p></div>
              <i className="worker-card-icon">🛢</i>
            </div>
            <div className="worker-choice-buttons">
              <button type="button" className={oilForm.flowType === "purchase" ? "active" : ""} onClick={() => setOilForm({ ...oilForm, flowType: "purchase" })}>MOY KELDI</button>
              <button type="button" className={oilForm.flowType === "resale" ? "active" : ""} onClick={() => setOilForm({ ...oilForm, flowType: "resale" })}>ISHLATILGAN MOY KETDI</button>
            </div>
            <div className="worker-form">
              <label><span>Kanistr soni</span><input type="number" min="1" step="1" value={oilForm.canCount || ""} onChange={(event) => setOilForm({ ...oilForm, canCount: Number(event.target.value) })} /></label>
              <label><span>1 kanistr narxi</span><input type="number" min="1" step="1" value={oilForm.unitAmount || ""} onChange={(event) => setOilForm({ ...oilForm, unitAmount: Number(event.target.value) })} placeholder="0" /></label>
              <label><span>{oilForm.flowType === "purchase" ? "Pul chiqadigan hisob" : "Pul tushadigan hisob"}</span><select value={oilForm.accountId} onChange={(event) => setOilForm({ ...oilForm, accountId: event.target.value })}>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
              <label><span>Sana</span><input type="date" value={oilForm.date} onChange={(event) => setOilForm({ ...oilForm, date: event.target.value })} /></label>
              <label className="wide"><span>Izoh</span><input maxLength={300} value={oilForm.note} onChange={(event) => setOilForm({ ...oilForm, note: event.target.value })} placeholder="Ixtiyoriy" /></label>
            </div>
            <div className="worker-entry-total"><span>{oilForm.canCount} kanistr · {oilForm.canCount * CHICKEN_OIL_CAN_LITERS} L</span><strong>₩{(oilForm.canCount * oilForm.unitAmount).toLocaleString(workerLocale(language))}</strong></div>
            {oilNotice && <p className={oilNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{oilNotice}</p>}
            <button className="worker-primary-action" type="button" disabled={oilSaving} onClick={() => void saveOil()}>{oilSaving ? "Saqlanmoqda…" : "Moy yozuvini saqlash"}</button>
          </section>
        )}

        {activePortalSection === "actions" && task === "mezana" && canWarehouseReceipt && (
          <section id="xodim-amal-form" className="worker-card worker-mezana-entry-card">
            <div className="worker-card-head">
              <div><span>ALOHIDA DAFTAR</span><h2>MEZANA hisoblari</h2><p>Olib turilgan va qaytarilgan mahsulotlar soni, sotib olinganlar esa qarz summasi bilan kiritiladi.</p></div>
              <i className="worker-card-icon">M</i>
            </div>
            <div className="worker-mezana-isolation"><b>MEZANA HISOBI HALO HISOBIDAN ALOHIDA</b><span>Bu yozuv HALO xarajati, ombori va kundalik hisobotiga qo‘shilmaydi.</span></div>
            {!(mezanaForm.action === "purchased"
              ? data.mezanaTelegramConfiguredByAction.purchased
              : data.mezanaTelegramConfiguredByAction.borrowed) && <p className="worker-notice">Rahbar bu amal uchun Telegram guruhi yoki mavzusini hali ulamagan. Yozuv saqlanadi, lekin Telegramga yuborilmaydi.</p>}
            <div className="worker-choice-buttons mezana">
              <button type="button" className={mezanaForm.action === "borrowed" ? "active borrowed" : ""} onClick={() => setMezanaForm({ ...mezanaForm, action: "borrowed", catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1 })}>OLIB TURILDI</button>
              <button type="button" className={mezanaForm.action === "returned" ? "active returned" : ""} onClick={() => setMezanaForm({ ...mezanaForm, action: "returned", catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1 })}>QAYTARIB QO‘YILDI</button>
              <button type="button" className={mezanaForm.action === "purchased" ? "active purchased" : ""} onClick={() => setMezanaForm({ ...mezanaForm, action: "purchased", catalogItemId: "", productName: "", quantity: 0, amount: 0, itemCount: 1 })}>SOTIB OLINDI</button>
            </div>
            {!editingMezanaId && <>
              <div className="worker-section-title mezana-pick-title"><span>RAHBAR BELGILAGAN RO‘YXAT</span><h3>{mezanaForm.action === "purchased" ? "Sotib olinadigan mahsulotni tanlang" : mezanaForm.action === "returned" ? "Qaytariladigan mahsulotni tanlang" : "Olib turiladigan mahsulotni tanlang"}</h3></div>
              <div className="mezana-product-picker">
                {mezanaAvailableCatalog.map((item) => <button type="button" key={item.id} className={mezanaForm.catalogItemId === item.id ? "selected" : ""} onClick={() => setMezanaForm({ ...mezanaForm, catalogItemId: item.id, productName: item.name, amount: item.price, quantity: mezanaForm.action === "returned" ? Number(data.mezanaBorrowedBalances[item.id] || 0) : 1, itemCount: 1 })}>
                  {item.image ? <img src={`/api/stock-documents?key=${encodeURIComponent(item.image.key)}`} alt={item.name} /> : <i>📦</i>}
                  <span><strong>{item.name}</strong><small>{item.price > 0 ? `₩${item.price.toLocaleString(workerLocale(language))}` : "Narx belgilanmagan"}</small>{mezanaForm.action === "returned" && <em>Qoldiq: {Number(data.mezanaBorrowedBalances[item.id] || 0)} ta</em>}</span>
                </button>)}
                {!mezanaAvailableCatalog.length && <p className="worker-notice">Bu amal uchun rahbar hali mahsulot belgilamagan.</p>}
              </div>
            </>}
            <div className="worker-form">
              {editingMezanaId && <label className="wide"><span>Mahsulot nomi</span><input maxLength={140} value={mezanaForm.productName} onChange={(event) => setMezanaForm({ ...mezanaForm, productName: event.target.value })} /></label>}
              {mezanaForm.action === "purchased" ? <>
                <label><span>Mahsulot soni</span><input type="number" min="1" step="1" value={mezanaForm.itemCount || ""} onChange={(event) => setMezanaForm({ ...mezanaForm, itemCount: Number(event.target.value) })} placeholder="1" /></label>
                <label><span>Jami summa</span><input readOnly value={selectedMezanaCatalogItem ? `₩${(selectedMezanaCatalogItem.price * mezanaForm.itemCount).toLocaleString(workerLocale(language))}` : editingMezanaId ? `₩${mezanaForm.amount.toLocaleString(workerLocale(language))}` : "₩0"} /></label>
                <label><span>Sana</span><input type="date" value={mezanaForm.date} onChange={(event) => setMezanaForm({ ...mezanaForm, date: event.target.value })} /></label>
                <label className="wide"><span>Izoh</span><input maxLength={300} value={mezanaForm.note} onChange={(event) => setMezanaForm({ ...mezanaForm, note: event.target.value })} placeholder="Ixtiyoriy" /></label>
              </> : <>
                <label><span>Mahsulot soni</span><input type="number" min="1" step="1" max={mezanaForm.action === "returned" && selectedMezanaCatalogItem ? Number(data.mezanaBorrowedBalances[selectedMezanaCatalogItem.id] || 0) : undefined} value={mezanaForm.quantity || ""} onChange={(event) => setMezanaForm({ ...mezanaForm, quantity: Number(event.target.value) })} placeholder="Masalan: 2" /></label>
                <label><span>Sana</span><input type="date" value={mezanaForm.date} onChange={(event) => setMezanaForm({ ...mezanaForm, date: event.target.value })} /></label>
              </>}
            </div>
            {editingMezanaId ? <div className="worker-mezana-editing-note"><b>TAHRIRLASH REJIMI</b><span>Mavjud rasmlar saqlanib qoladi. Nom, son yoki summani tuzating.</span></div> : <><div className="worker-mezana-photo-grid">
              <label className="worker-upload"><i>1</i><span><strong>{mezanaTopFile ? mezanaTopFile.name : "Asosiy rasm"}</strong><small>Ixtiyoriy · rasmsiz ham qabul qilinadi</small></span><input key={`top-${mezanaFileInputKey}`} type="file" accept={STOCK_IMAGE_ACCEPT} onChange={(event) => void chooseMezanaFile("top", event)} /></label>
              <label className="worker-upload"><i>2</i><span><strong>{mezanaBottomFile ? mezanaBottomFile.name : "Qo‘shimcha rasm"}</strong><small>Ixtiyoriy · uzun chek yoki ikkinchi tomon</small></span><input key={`bottom-${mezanaFileInputKey}`} type="file" accept={STOCK_IMAGE_ACCEPT} onChange={(event) => void chooseMezanaFile("bottom", event)} /></label>
            </div>
            {(mezanaTopPreview || mezanaBottomPreview) && <div className="worker-mezana-previews">
              {mezanaTopPreview && <div><img src={mezanaTopPreview} alt="MEZANA chek yuqori qismi" /><button type="button" onClick={() => { setMezanaTopFile(null); setMezanaTopPreview(""); setMezanaFileInputKey((current) => current + 1); }}>Yuqori rasmni olib tashlash</button></div>}
              {mezanaBottomPreview && <div><img src={mezanaBottomPreview} alt="MEZANA chek pastki qismi" /><button type="button" onClick={() => { setMezanaBottomFile(null); setMezanaBottomPreview(""); setMezanaFileInputKey((current) => current + 1); }}>Pastki rasmni olib tashlash</button></div>}
            </div>}</>}
            <div className="worker-entry-total"><span>{mezanaForm.action === "purchased" ? "MEZANA qarziga qo‘shiladi" : mezanaForm.action === "returned" ? "Olib turilgan qoldiqdan ayriladi" : "Olib turilgan qoldiqqa qo‘shiladi"}</span><strong>{mezanaForm.action === "purchased" ? `₩${((selectedMezanaCatalogItem?.price || mezanaForm.amount) * mezanaForm.itemCount).toLocaleString(workerLocale(language))}` : `${mezanaForm.quantity || 0} ta`}</strong></div>
            {mezanaNotice && <p className={mezanaNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{mezanaNotice}</p>}
            <button className="worker-primary-action" type="button" disabled={mezanaSaving} onClick={() => void saveMezana()}>{mezanaSaving ? "Saqlanmoqda…" : editingMezanaId ? "O‘ZGARISHNI SAQLASH" : "Saqlash va MEZANA guruhiga yuborish"}</button>
            {editingMezanaId && <button className="worker-mezana-cancel-edit" type="button" disabled={mezanaSaving} onClick={cancelMezanaEdit}>TAHRIRLASHNI BEKOR QILISH</button>}
            {data.mezanaEntries.length > 0 && <div className="worker-own-deliveries worker-mezana-history"><div className="worker-section-title"><span>SHAXSIY TARIX · BOSHQARUV</span><h3>Siz kiritgan MEZANA yozuvlari</h3></div>{data.mezanaEntries.slice(0, 10).map((entry) => <article className={editingMezanaId === entry.id ? "editing" : ""} key={entry.id}>{entry.productImage && <img className="worker-mezana-product-image" src={`/api/stock-documents?key=${encodeURIComponent(entry.productImage.key)}`} alt={entry.productName} />}<span><strong>{entry.productName}</strong><small>{displayDate(entry.date)} · {entry.documents.length} ta qo‘shimcha rasm{entry.unitPrice !== undefined ? ` · 1 dona ₩${entry.unitPrice.toLocaleString(workerLocale(language))}` : ""}{entry.itemCount ? ` · ${entry.itemCount} dona` : ""}</small></span><b>{mezanaDebtEntryValue(entry)}</b><em>{mezanaDebtActionLabel(entry.action)}</em><div className="worker-mezana-history-actions"><button type="button" className="telegram" disabled={Boolean(mezanaTelegramBusyId || deletingMezanaId)} onClick={() => void resendMezanaTelegram(entry)}>{mezanaTelegramBusyId === entry.id ? "YUBORILMOQDA…" : "TELEGRAMGA YUBORISH"}</button>{!entry.catalogItemId && <button type="button" disabled={Boolean(deletingMezanaId)} onClick={() => startMezanaEdit(entry)}>TAHRIRLASH</button>}<button type="button" className="delete" disabled={Boolean(deletingMezanaId)} onClick={() => void deleteMezana(entry)}>{deletingMezanaId === entry.id ? "O‘CHIRILMOQDA…" : "O‘CHIRISH"}</button></div></article>)}</div>}
          </section>
        )}

        {activePortalSection === "actions" && task === "delivery" && canSupplierDelivery && (
          <section id="xodim-amal-form" className="worker-card worker-delivery-card">
            <div className="worker-card-head">
              <div><span>{t("delivery.kicker")}</span><h2>{t("delivery.title")}</h2><p>{t("delivery.description")}</p></div>
              <i className="worker-card-icon">📦</i>
            </div>
            <div className="worker-form delivery-top-form">
              <label><span>{t("delivery.optionalSupplier")}</span><select value={deliveryForm.supplierId} onChange={(event) => setDeliveryForm({ ...deliveryForm, supplierId: event.target.value })}><option value="">{t("delivery.chooseSupplier")}</option>{data.supplierDirectory.filter((supplier) => !isMezanaSupplierName(supplier.name)).map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
              <label><span>{t("delivery.date")}</span><input type="date" max={today} value={deliveryForm.date} onChange={(event) => setDeliveryForm({ ...deliveryForm, date: event.target.value })} /></label>
              <label className="wide"><span>{t("delivery.note")}</span><input value={deliveryForm.note} maxLength={300} onChange={(event) => setDeliveryForm({ ...deliveryForm, note: event.target.value })} placeholder={t("delivery.notePlaceholder")} /></label>
            </div>
            <div className="worker-delivery-lines">
              <div className="worker-section-title"><span>{t("delivery.itemsKicker")}</span><h3>{t("delivery.itemsTitle")}</h3></div>
              <label><span>{t("delivery.section")}</span><select value={deliverySection} onChange={event => setDeliverySection(event.target.value as "stock" | "reserve")}><option value="stock">{t("delivery.regularStock")}</option><option value="reserve">{t("delivery.reserveStock")}</option></select></label>
              <div className="worker-delivery-picker">
                <label><span>{t("delivery.searchProduct")}</span><input value={deliveryProductSearch} onChange={(event) => setDeliveryProductSearch(event.target.value)} placeholder={t("delivery.searchPlaceholder")} /></label>
                <div>{matchingDeliveryProducts.map((item) => <button type="button" key={item.id} onClick={() => addDeliveryProduct(item)}><strong>{item.name}</strong><small>{t("delivery.stockUnit", { unit: item.unit })}{item.unitsPerPackage && item.unitsPerPackage > 1 ? ` · 1 ${item.packageName || "qadoq"} = ${item.unitsPerPackage} ${item.unit}` : ""}{item.gramsPerUnit ? ` · ${item.gramsPerUnit} g` : ""}</small></button>)}</div>
                {!matchingDeliveryProducts.length && <p>{deliveryLines.length === data.inventory.length ? t("delivery.allSelected") : t("delivery.notFound")}</p>}
              </div>
              {deliveryLines.map((line, index) => <div className="worker-delivery-line" key={line.id}>
                <b>{index + 1}</b>
                <label className="delivery-product-selected"><span>{t("delivery.productName")}</span><strong>{line.name}</strong></label>
                <label><span>{t("delivery.unit")}</span><select value={line.unit} onChange={event => updateDeliveryLine(line.id, { unit: event.target.value })}>{[...new Set([line.unit || "dona", ...compatibleInventoryInputUnits(data.inventory.find(item => item.id === line.inventoryId)?.unit || "dona"), ...(data.inventory.find(item => item.id === line.inventoryId)?.expenseOnly ? ["dona", "kg", "g", "litr", "ml", "quti", "banka", "kalla"] : []), ...(data.inventory.find(item => item.id === line.inventoryId)?.unitsPerPackage ? ["qadoq"] : [])])].map(unit => <option value={unit} key={unit}>{unit}</option>)}</select></label>
                <label><span>{t("delivery.quantity")} ({line.unit || data.inventory.find((item) => item.id === line.inventoryId)?.unit || "dona"})</span><input type="number" min="0" step="any" value={line.quantity || ""} onChange={(event) => updateDeliveryLine(line.id, { quantity: Number(event.target.value) })} placeholder={line.unit === "g" ? "5000" : "10"} /></label>
                <label><span>{t("delivery.lineTotal")}</span><input type="number" min="0" step="1" value={line.totalAmount || ""} onChange={(event) => updateDeliveryLine(line.id, { totalAmount: Number(event.target.value) })} placeholder="50000" /></label>
                <button type="button" onClick={() => setDeliveryLines((current) => current.filter((entry) => entry.id !== line.id))}>{t("delivery.removeLine")}</button>
              </div>)}
            </div>

            <div className="worker-delivery-total"><span>{t("delivery.grandTotal")}</span><strong>₩{deliveryLines.reduce((sum, line) => sum + Number(line.totalAmount || 0), 0).toLocaleString(workerLocale(language))}</strong></div>
            <div className="worker-delivery-document">
              <label className="worker-upload"><i>📎</i><span><strong>{deliveryDocumentFile ? deliveryDocumentFile.name : t("delivery.chooseDocument")}</strong><small>JPG, PNG, WebP yoki HEIC · katta rasm avtomatik siqiladi</small></span><input key={deliveryFileInputKey} type="file" accept={STOCK_IMAGE_ACCEPT} onChange={chooseDeliveryDocument} /></label>
              {deliveryDocumentPreview && <div className="worker-delivery-preview"><img src={deliveryDocumentPreview} alt={t("delivery.documentAlt")} /><button type="button" onClick={() => { setDeliveryDocumentFile(null); setDeliveryDocumentPreview(""); setDeliveryFileInputKey((current) => current + 1); }}>{t("delivery.removeDocument")}</button></div>}
            </div>
            {deliveryNotice && <p className={deliveryNotice.startsWith("✓") ? "worker-notice success" : "worker-notice"}>{deliveryNotice}</p>}
            {deliveryDuplicatePending && <label><span>{t("delivery.duplicateHelp")}</span><input value={deliveryDuplicateReason} minLength={5} maxLength={300} onChange={event => setDeliveryDuplicateReason(event.target.value)} /></label>}
            <button className="worker-primary-action" type="button" disabled={deliverySaving} onClick={() => void saveSupplierDelivery()}>{deliverySaving ? t("delivery.saving") : t("delivery.confirm")}</button>

            {data.supplierDeliveries.length > 0 && <div className="worker-own-deliveries"><div className="worker-section-title"><span>{t("delivery.historyKicker")}</span><h3>{t("delivery.historyTitle")}</h3></div>{data.supplierDeliveries.slice(0, 10).map((delivery) => <article key={delivery.id}><span><strong>{data.supplierDirectory.find((supplier) => supplier.id === delivery.supplierId)?.name || t("delivery.supplier")}</strong><small>{delivery.date} · {t("delivery.linesCount", { count: delivery.lines.length })}</small></span><b>₩{delivery.totalAmount.toLocaleString(workerLocale(language))}</b><em>{delivery.supplierAccounting === "separate" ? t("delivery.stockOnly") : delivery.settlementMode === "paid" ? t("delivery.paid") : delivery.status === "approved" ? t("delivery.debt") : t("delivery.submitted")}</em></article>)}</div>}
          </section>
        )}

        <nav className="worker-mobile-quick-nav" aria-label={t("quick.label")}>
          <button className={activePortalSection === "today" ? "active" : ""} type="button" onClick={() => openPortalSection("today")}><i>●</i><span>{t("quick.today")}</span></button>
          <button className={activePortalSection === "account" ? "active" : ""} type="button" onClick={() => openPortalSection("account")}><i>₩</i><span>{t("quick.account")}</span></button>
          <button className={activePortalSection === "actions" ? "active" : ""} type="button" onClick={() => openPortalSection("actions")}><i>＋</i><span>{t("quick.actions")}</span></button>
          <button className={activePortalSection === "tasks" ? "active" : ""} type="button" onClick={() => openPortalSection("tasks")}><i>✓</i><span>{t("quick.tasks")}</span>{openAssignedTasks.length > 0 && <b>{openAssignedTasks.length}</b>}</button>
        </nav>

        <footer className="worker-footer">
          <span><i /> {t("footer.connected")}</span>
        </footer>
      </div>
    </main>
  );
}
