import { IntakeError } from "../../lib/unified-intake";
import { MezanaPostingError } from "../../lib/mezana-posting";
import {
  HaloStateConflictError,
  readHaloRevision,
  readHaloState,
  replaceHaloState,
} from "../../lib/halo-store";
import { isAdminRequest } from "../../lib/integration-store";
import { validRecipeCosts } from "../../lib/recipe-validation";
import { decodeHaloHeader } from "../../lib/halo-header";
import {
  inferLegacyCategoryId,
  normalizeProductCategories,
  validCategoryId,
  validProductCategories,
} from "../../lib/product-categories";
import { validPayrollFinanceLinks, validPayrollState } from "../../lib/payroll";
import { validCostRules } from "../../lib/daily-report";
import { validStockDocuments } from "../../lib/stock-documents";
import { validSupplierDeliveries } from "../../lib/supplier-deliveries";
import { validInventoryPackaging } from "../../lib/inventory-packaging";
import { readHaloStateWithRecurringExpenses } from "../../lib/recurring-expense-store";
import { validRecurringExpenseMetadata } from "../../lib/recurring-expenses";
import { activeDeletedEntityConflicts, validDeletedItems } from "../../lib/deleted-items";
import { missingUnarchivedSupplierPurchases } from "../../lib/supplier-invoices";
import {
  normalizeKitchenRuleReminderHours,
  normalizeKitchenRules,
  validKitchenRuleReminderHours,
  validKitchenRules,
} from "../../lib/kitchen-rules";
import { validOperationChecklistDays } from "../../lib/operations";
import { validOilLedgerMetadata } from "../../lib/oil-accounting";
import {
  hasNegativeMezanaBorrowedQuantity,
  normalizeMezanaDebtEntries,
  normalizeMezanaSettings,
  validMezanaDebtEntry,
} from "../../lib/mezana-debts";
import { normalizeMezanaCatalog, validMezanaCatalogItem } from "../../lib/mezana-catalog";
import {
  preservesClosedMonthFinance,
  preservesClosedMonthSales,
  preservesMonthlyCloseHistory,
  validMonthlyCloses,
} from "../../lib/month-end";
import {
  preservesClosedMonthDatedRecords,
  preservesClosedMonthPurchaseOrderOrigins,
  preservesMonthCloseStockMovements,
} from "../../lib/closed-month-guards";
import {
  preserveTrustedSaleFinancialRateSnapshots,
  reconcileSaleFinancialRateSnapshots,
} from "../../lib/sale-financial-snapshots";
import { validPurchaseOrderLifecycleLinks } from "../../lib/purchase-order-validation";
import { newPosDuplicateId } from "../../lib/pos-reconciliation";

const MAX_STATE_BYTES = 5 * 1024 * 1024;
const ARRAY_SECTIONS = [
  "productCategories",
  "inventory",
  "recipes",
  "suppliers",
  "transactions",
  "supplierDeliveries",
  "mezanaCatalog",
  "mezanaEntries",
  "workerConsumptions",
  "posOrders",
  "sales",
  "stockMovements",
  "financialEntries",
  "dailyCloses",
  "fixedExpenses",
  "purchaseOrders",
  "staff",
  "workShifts",
  "payrollAdjustments",
  "attendanceDays",
  "payrollPayments",
  "monthlyCloses",
  "operationChecklistDays",
  "deletedItems",
  "auditLog",
] as const;

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const branchId = url.searchParams.get("branch") || "main";
    if (url.searchParams.get("revision") === "1") {
      // Most two-second polls read only the revision column. The client asks
      // for reconciliation periodically so recurring expenses still materialize.
      if (url.searchParams.get("reconcile") === "1") {
        const current = await readHaloStateWithRecurringExpenses(branchId);
        return Response.json(
          { updatedAt: current.updatedAt },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        { updatedAt: await readHaloRevision(branchId) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const current = await readHaloStateWithRecurringExpenses(branchId);
    return Response.json(
      { ...current.state, updatedAt: current.updatedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Ma’lumotlar bazasi ochilmadi. Qayta urinib ko‘ring." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const branchId = new URL(request.url).searchParams.get("branch") || "main";
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > MAX_STATE_BYTES) {
      return Response.json({ error: "Ma’lumot hajmi juda katta." }, { status: 413 });
    }

    const input = await request.json() as Record<string, unknown> & { updatedAt?: string };
    if (!input.updatedAt) {
      return Response.json(
        { error: "Ma’lumot eskirgan. Sahifani yangilang." },
        { status: 409 },
      );
    }

    // Do not materialize a new recurring cycle between the client's read and
    // compare-and-swap write. Owner bootstrap/GET performs reconciliation.
    const current = await readHaloState(branchId);
    if (input.updatedAt !== current.updatedAt) {
      return Response.json(
        { error: "Boshqa qurilmada ma’lumot yangilandi. Sahifani qayta oching." },
        { status: 409 },
      );
    }
    // Older clients may omit sections they do not know about. Merge first so a
    // partial save cannot silently erase sales, finance, payroll, or archive data.
    const body: Record<string, unknown> & { updatedAt: string } = {
      ...current.state,
      ...input,
      updatedAt: input.updatedAt,
    };
    if (ARRAY_SECTIONS.some((key) => !Array.isArray(body[key]))) {
      return Response.json({ error: "Noto‘g‘ri ma’lumot." }, { status: 400 });
    }
    if (newPosDuplicateId(current.state.sales as unknown[], body.sales as unknown[])) {
      return Response.json({ error: "Bu POS qatori allaqachon saqlangan. Sahifani yangilab, faylni qayta tekshiring; savdo ikkinchi marta qo‘shilmadi." }, { status: 409 });
    }
    if (!validStockDocuments(body.stockMovements) || !validStockDocuments(body.transactions)) {
      return Response.json({ error: "Nakladnoy ma’lumotini tekshiring." }, { status: 400 });
    }
    if (!validSupplierDeliveries(body.supplierDeliveries)) {
      return Response.json({ error: "Xodim kiritgan yetkazuvchi kirimini tekshiring." }, { status: 400 });
    }
    const submittedMezanaCatalog = normalizeMezanaCatalog(body.mezanaCatalog);
    if (submittedMezanaCatalog.length !== (body.mezanaCatalog as unknown[]).length
      || !submittedMezanaCatalog.every(validMezanaCatalogItem)) {
      return Response.json({ error: "MEZANA mahsulot ro‘yxatini tekshiring." }, { status: 400 });
    }
    body.mezanaCatalog = submittedMezanaCatalog;
    // MEZANA is a separate ledger. Old or imperfect MEZANA rows must not
    // block a POS, warehouse, oil, payroll, or expense save that does not
    // actually change MEZANA. Compare canonical rows because older clients
    // may normalize optional fields while sending an otherwise identical state.
    const rawMezanaEntries = body.mezanaEntries as unknown[];
    const currentMezanaEntries = normalizeMezanaDebtEntries(current.state.mezanaEntries);
    const submittedMezanaEntries = normalizeMezanaDebtEntries(rawMezanaEntries);
    const mezanaEntriesChanged = JSON.stringify(submittedMezanaEntries) !== JSON.stringify(currentMezanaEntries);
    if (mezanaEntriesChanged) {
      body.mezanaEntries = submittedMezanaEntries;
      if (submittedMezanaEntries.length !== rawMezanaEntries.length) {
        return Response.json({ error: "MEZANA yozuvlari takrorlangan yoki buzilgan. Hech bir yozuv o‘chirilmadi." }, { status: 400 });
      }
      if (!submittedMezanaEntries.every(validMezanaDebtEntry)) {
        return Response.json({ error: "MEZANA qarzi va rasm ma’lumotini tekshiring." }, { status: 400 });
      }
      if (hasNegativeMezanaBorrowedQuantity(submittedMezanaEntries)) {
        return Response.json({ error: "Qaytarilgan mahsulot soni olib turilgan qoldiqdan oshib ketgan." }, { status: 400 });
      }
    } else {
      body.mezanaEntries = current.state.mezanaEntries;
    }
    const currentMezanaSettings = normalizeMezanaSettings(current.state.mezanaSettings);
    const submittedMezanaSettings = normalizeMezanaSettings(body.mezanaSettings);
    body.mezanaSettings = JSON.stringify(submittedMezanaSettings) === JSON.stringify(currentMezanaSettings)
      ? current.state.mezanaSettings
      : submittedMezanaSettings;
    if (!validInventoryPackaging(body.inventory)) {
      return Response.json({ error: "Ombor qadoq va birlik ma’lumotini tekshiring." }, { status: 400 });
    }
    if (!(body.suppliers as unknown[]).every((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const bankAccount = (entry as Record<string, unknown>).bankAccount;
      return bankAccount === undefined || (typeof bankAccount === "string" && bankAccount.length <= 120);
    })) {
      return Response.json({ error: "Yetkazib beruvchi bank hisobini tekshiring." }, { status: 400 });
    }
    if (!validCostRules(body.costRules)) {
      return Response.json({ error: "Hisoblash qoidalarini tekshiring." }, { status: 400 });
    }
    if (!validOilLedgerMetadata(body.financialEntries)) {
      return Response.json({ error: "Chicken moyi xaridi yoki qayta sotuv hisobini tekshiring." }, { status: 400 });
    }
    if (!Array.isArray(body.accounts) || !body.accounts.length) {
      return Response.json({ error: "Hisob raqamlarini tekshiring." }, { status: 400 });
    }
    const submittedSalesForClosedMonthGuard = preserveTrustedSaleFinancialRateSnapshots(
      current.state.sales,
      body.sales,
    );
    if (!preservesClosedMonthSales(
      current.state.monthlyCloses,
      current.state.sales,
      submittedSalesForClosedMonthGuard,
    )) {
      return Response.json({ error: "Yopilgan oyning savdolari o‘zgarmaydi. Tuzatishni yangi oyga kiriting." }, { status: 409 });
    }
    body.sales = reconcileSaleFinancialRateSnapshots(
      current.state.sales,
      body.sales,
      current.state.accounts,
      current.state.costRules as { cardCommissionPct?: unknown; deliveryCommissionPct?: unknown; taxPct?: unknown },
      body.accounts,
      body.costRules as { cardCommissionPct?: unknown; deliveryCommissionPct?: unknown; taxPct?: unknown },
    );
    if (!validRecurringExpenseMetadata(body.fixedExpenses, body.financialEntries)) {
      return Response.json({ error: "Doimiy xarajat ma’lumotini tekshiring." }, { status: 400 });
    }
    if (!validDeletedItems(body.deletedItems)) {
      return Response.json({ error: "Savat tarixini tekshiring." }, { status: 400 });
    }
    const missingSupplierPurchases = missingUnarchivedSupplierPurchases(
      current.state.transactions,
      body.transactions,
      body.deletedItems,
    );
    if (missingSupplierPurchases.length) {
      return Response.json(
        { error: "Yetkazuvchi nakladnoyi yo‘qolishdan himoyalandi. Uni faqat “Savatga” tugmasi orqali bekor qilish mumkin." },
        { status: 409 },
      );
    }
    const archiveConflicts = activeDeletedEntityConflicts(body);
    if (archiveConflicts.length) {
      return Response.json(
        { error: `“${archiveConflicts[0].label}” o‘chirilgan. Eski tahrir qo‘llanmadi.` },
        { status: 409 },
      );
    }
    body.kitchenRules = normalizeKitchenRules(body.kitchenRules);
    body.kitchenRuleReminderHours = normalizeKitchenRuleReminderHours(body.kitchenRuleReminderHours);
    if (!validKitchenRules(body.kitchenRules) || !validKitchenRuleReminderHours(body.kitchenRuleReminderHours)) {
      return Response.json({ error: "Oshxona qoidalari va Telegram eslatma vaqtini tekshiring." }, { status: 400 });
    }
    if (!validOperationChecklistDays(body.operationChecklistDays)) {
      return Response.json({ error: "Kunlik nazorat ma’lumotini tekshiring." }, { status: 400 });
    }
    if (!validPayrollState(body.staff, body.workShifts, body.payrollAdjustments, body.attendanceDays, body.payrollPayments)) {
      return Response.json({ error: "Xodim, ish vaqti yoki maosh ma’lumotini tekshiring." }, { status: 400 });
    }
    if (!validPayrollFinanceLinks(body.payrollPayments, body.accounts, body.financialEntries)) {
      return Response.json({ error: "Oylik to‘lovi va pul hisobi bog‘lanishini tekshiring." }, { status: 400 });
    }
    if (!validMonthlyCloses(body.monthlyCloses)) {
      return Response.json({ error: "Oy yakuni tarixini tekshiring." }, { status: 400 });
    }
    if (!preservesMonthlyCloseHistory(current.state.monthlyCloses, body.monthlyCloses)) {
      return Response.json({ error: "Yopilgan oy tarixi o‘zgartirish yoki o‘chirishdan himoyalangan." }, { status: 409 });
    }
    if (!preservesClosedMonthFinance(
      current.state.monthlyCloses,
      current.state.financialEntries,
      body.financialEntries,
    ) || !preservesClosedMonthDatedRecords(
      current.state.monthlyCloses,
      current.state.financialEntries,
      body.financialEntries,
    )) {
      return Response.json({ error: "Yopilgan oyning xarajatlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting." }, { status: 409 });
    }
    const closedOperationalSections: Array<{
      current: unknown;
      next: unknown;
      error: string;
      dateFields?: readonly string[];
    }> = [
      {
        current: current.state.workerConsumptions,
        next: body.workerConsumptions,
        error: "Yopilgan oyning yeyilgan va chiqit yozuvlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.stockMovements,
        next: body.stockMovements,
        error: "Yopilgan oyning ombor harakatlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.dailyCloses,
        next: body.dailyCloses,
        error: "Yopilgan oyning kun yakunlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.mezanaEntries,
        next: body.mezanaEntries,
        error: "Yopilgan oyning MEZANA yozuvlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.transactions,
        next: body.transactions,
        error: "Yopilgan oyning yetkazuvchi hisoblari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.supplierDeliveries,
        next: body.supplierDeliveries,
        error: "Yopilgan oyning ombor kirimlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.posOrders,
        next: body.posOrders,
        error: "Yopilgan oyning savdo buyurtmalari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.workShifts,
        next: body.workShifts,
        error: "Yopilgan oyning ish vaqti yozuvlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.payrollAdjustments,
        next: body.payrollAdjustments,
        error: "Yopilgan oyning oylik tuzatishlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.attendanceDays,
        next: body.attendanceDays,
        error: "Yopilgan oyning davomat yozuvlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
      {
        current: current.state.operationChecklistDays,
        next: body.operationChecklistDays,
        error: "Yopilgan oyning kunlik nazorat tarixi o‘zgarmaydi.",
      },
      {
        current: current.state.payrollPayments,
        next: body.payrollPayments,
        error: "Yopilgan oyda amalga oshirilgan oylik to‘lovlari o‘zgarmaydi. Tuzatishni yangi oyga kiriting.",
      },
    ];
    const closedOperationalConflict = closedOperationalSections.find((section) => !preservesClosedMonthDatedRecords(
      current.state.monthlyCloses,
      section.current,
      section.next,
      section.dateFields || "date",
    ));
    if (closedOperationalConflict) {
      return Response.json({ error: closedOperationalConflict.error }, { status: 409 });
    }
    if (!preservesClosedMonthPurchaseOrderOrigins(
      current.state.monthlyCloses,
      current.state.purchaseOrders,
      body.purchaseOrders,
    )) {
      return Response.json({
        error: "Yopilgan oy xarid buyurtmasining sanasi, yetkazuvchisi, mahsuloti va summasi o‘zgarmaydi.",
      }, { status: 409 });
    }
    if (!validPurchaseOrderLifecycleLinks(current.state, body)) {
      return Response.json({
        error: "Xarid holati ombor, yetkazuvchi qarzi va pul yozuvlari bilan birga saqlanishi kerak.",
      }, { status: 409 });
    }
    if (!preservesMonthCloseStockMovements(current.state.stockMovements, body.stockMovements)) {
      return Response.json({
        error: "Oy yakuniga bog‘langan ombor harakatini o‘zgartirib bo‘lmaydi.",
      }, { status: 409 });
    }
    const categorySource = body.productCategories === undefined
      ? normalizeProductCategories(current.state.productCategories)
      : body.productCategories;
    if (!validProductCategories(categorySource)) {
      return Response.json({ error: "Kategoriya ma’lumotini tekshiring." }, { status: 400 });
    }
    const categories = normalizeProductCategories(categorySource);
    const recipeCategoryIds = new Set(categories.filter((category) => category.kind === "recipe").map((category) => category.id));
    const inventoryCategoryIds = new Set(categories.filter((category) => category.kind === "inventory").map((category) => category.id));
    let categoryAssignmentsValid = true;
    body.recipes = (body.recipes as unknown[]).map((entry) => {
      const recipe = entry as Record<string, unknown>;
      const requested = String(recipe.categoryId || "");
      if (requested && !recipeCategoryIds.has(requested)) categoryAssignmentsValid = false;
      return {
        ...recipe,
        categoryId: validCategoryId(
          categories,
          "recipe",
          requested || inferLegacyCategoryId("recipe", String(recipe.name || "")),
        ),
      };
    });
    body.inventory = (body.inventory as unknown[]).map((entry) => {
      const item = entry as Record<string, unknown>;
      const requested = String(item.categoryId || "");
      if (requested && !inventoryCategoryIds.has(requested)) categoryAssignmentsValid = false;
      return {
        ...item,
        categoryId: validCategoryId(
          categories,
          "inventory",
          requested || inferLegacyCategoryId("inventory", String(item.name || "")),
        ),
      };
    });
    if (!categoryAssignmentsValid) {
      return Response.json({ error: "Mahsulot kategoriyasini tekshiring." }, { status: 400 });
    }
    body.productCategories = categories;
    const currentRecipes = Array.isArray(current.state.recipes) ? current.state.recipes : [];
    if (!validRecipeCosts(body.recipes as unknown[], currentRecipes)) {
      return Response.json({ error: "Retsept tannarxidagi ma’lumotni tekshiring." }, { status: 400 });
    }

    const updatedAt = await replaceHaloState(
      body,
      body.updatedAt,
      branchId,
      decodeHaloHeader(request.headers.get("x-halo-actor"), "Rahbar"),
      decodeHaloHeader(request.headers.get("x-halo-action"), "Ma’lumot yangilandi"),
      decodeHaloHeader(request.headers.get("x-halo-section"), "Tizim"),
    );
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    if (error instanceof MezanaPostingError || error instanceof IntakeError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof HaloStateConflictError) {
      return Response.json(
        { error: "Boshqa qurilmada ma’lumot yangilandi. Sahifani qayta oching." },
        { status: 409 },
      );
    }
    return Response.json({ error: "Saqlash amalga oshmadi." }, { status: 500 });
  }
}
