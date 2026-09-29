import {
  normalizeKitchenRuleReminderHours,
  normalizeKitchenRules,
} from "./kitchen-rules.ts";
import { ensureMenuCodes } from "./menu-codes.ts";
import { normalizeMezanaDebtEntries } from "./mezana-debts.ts";
import { normalizeMezanaCatalog } from "./mezana-catalog.ts";

type JsonRecord = Record<string, unknown>;

function records(value: unknown) {
  return Array.isArray(value) ? value as JsonRecord[] : [];
}

export function workerInventoryView(value: unknown) {
  return records(value).map((entry) => ({
    id: entry.id,
    name: entry.name,
    posCode: entry.posCode,
    posAliases: entry.posAliases,
    salePrice: entry.salePrice,
    unit: entry.unit,
    stock: entry.stock,
    minStock: entry.minStock,
    supplierId: entry.supplierId,
    categoryId: entry.categoryId,
    packageName: entry.packageName,
    unitsPerPackage: entry.unitsPerPackage,
    gramsPerUnit: entry.gramsPerUnit,
    expenseOnly: entry.expenseOnly,
  }));
}

export function workerRecipeView(value: unknown) {
  return ensureMenuCodes(records(value).map((entry) => ({
    ...entry,
    id: String(entry.id || ""),
  })) as Array<JsonRecord & { id: string }>).map((entry) => ({
    id: entry.id,
    name: entry.name,
    categoryId: entry.categoryId,
    ingredients: records(entry.ingredients).map((ingredient) => ({
      id: ingredient.id,
      inventoryId: ingredient.inventoryId,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity: ingredient.quantity,
    })),
  }));
}

export function buildWorkerStateView(state: JsonRecord, workerId: string, updatedAt: string) {
  const inventory = workerInventoryView(state.inventory);
  const recipes = workerRecipeView(state.recipes);
  return {
    productCategories: state.productCategories,
    inventory,
    recipes,
    suppliers: [],
    supplierDirectory: records(state.suppliers).map((entry) => ({
      id: entry.id,
      name: entry.name,
    })),
    transactions: [],
    supplierDeliveries: records(state.supplierDeliveries)
      .filter((entry) => String(entry.createdByWorkerId || "") === workerId)
      .slice(0, 30),
    mezanaCatalog: normalizeMezanaCatalog(state.mezanaCatalog).filter((item) => item.active),
    mezanaBorrowedBalances: Object.fromEntries(normalizeMezanaCatalog(state.mezanaCatalog)
      .filter((item) => item.mode === "borrowed")
      .map((item) => [item.id, Math.max(0, normalizeMezanaDebtEntries(state.mezanaEntries).reduce((balance, entry) => {
        if (entry.catalogItemId !== item.id && entry.productName.toLocaleLowerCase("uz-UZ") !== item.name.toLocaleLowerCase("uz-UZ")) return balance;
        if (entry.action === "borrowed") return balance + Number(entry.quantity || 0);
        if (entry.action === "returned") return balance - Number(entry.quantity || 0);
        return balance;
      }, 0))])),
    mezanaEntries: normalizeMezanaDebtEntries(state.mezanaEntries)
      .filter((entry) => String(entry.createdByWorkerId || "") === workerId)
      .slice(0, 30),
    mezanaTelegramConfigured: Boolean(
      state.mezanaSettings
      && typeof state.mezanaSettings === "object"
      && (
        String((state.mezanaSettings as JsonRecord).telegramChatId || "").trim()
        || String((state.mezanaSettings as JsonRecord).purchasedTelegramChatId || "").trim()
      ),
    ),
    mezanaTelegramConfiguredByAction: {
      borrowed: Boolean(
        state.mezanaSettings
        && typeof state.mezanaSettings === "object"
        && String((state.mezanaSettings as JsonRecord).telegramChatId || "").trim()
      ),
      purchased: Boolean(
        state.mezanaSettings
        && typeof state.mezanaSettings === "object"
        && String((state.mezanaSettings as JsonRecord).purchasedTelegramChatId || "").trim()
      ),
    },
    workerConsumptions: records(state.workerConsumptions)
      .filter((entry) => String(entry.workerId || "") === workerId)
      .slice(0, 50)
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        sourceType: entry.sourceType,
        recipeId: entry.recipeId,
        inventoryId: entry.inventoryId,
        items: entry.items,
        label: entry.label,
        quantity: entry.quantity,
        unit: entry.unit,
        date: entry.date,
        reason: entry.reason,
        outflowCategory: entry.outflowCategory,
        note: entry.note,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        editedAt: entry.editedAt,
      })),
    posOrders: [],
    sales: records(state.sales).map((entry) => ({
      id: entry.id,
      source: entry.source,
      externalId: entry.externalId,
      recipeId: entry.recipeId,
      date: entry.date,
      quantity: entry.quantity,
    })),
    stockMovements: [],
    accounts: records(state.accounts).map((entry) => ({
      id: entry.id,
      name: entry.name,
      type: entry.type,
      openingBalance: 0,
    })),
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
    kitchenRules: normalizeKitchenRules(state.kitchenRules),
    kitchenRuleReminderHours: normalizeKitchenRuleReminderHours(state.kitchenRuleReminderHours),
    deletedItems: [],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
    auditLog: [],
    updatedAt,
  };
}
