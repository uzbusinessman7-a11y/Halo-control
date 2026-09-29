import { isExpenseOnlyInventory } from './vegetable-expenses.ts';
import {
  listProductMappings,
  normalizeExternalName,
} from "./integration-store";
import { mutateHaloState } from "./halo-store";
import { calculateRecipeCostBreakdown } from "./recipe-costing";
import { type InventoryAccountingFields } from './inventory-accounting.ts';
import { missingRecipeIngredient } from "./recipe-availability.ts";
import { ensureMenuCodes, recipeHasMenuCode } from "./menu-codes.ts";
import { posBusinessDate } from "./business-time.ts";
import { isAccountingMonthClosed } from "./month-end.ts";
import { snapshotSaleFinancialRates } from "./sale-financial-snapshots.ts";

export { posBusinessDate } from "./business-time.ts";

type Inventory = InventoryAccountingFields & {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  unitCost: number;
  supplierId: string;
};
type Ingredient = { id?: string; inventoryId: string; name?: string; unit?: string; quantity: number; unitCost?: number; lineCost?: number };
type RecipeExtraCost = { id: string; name: string; amount: number };
type Recipe = { id: string; name: string; posCode?: string; posAliases?: string[]; salePrice: number; ingredients: Ingredient[]; extraCosts?: RecipeExtraCost[] };
type Account = { id: string; name: string; type: string; openingBalance: number };
type SaleUsage = { inventoryId: string; quantity: number; deductedQuantity?: number; unitCostAtSale: number; totalCostAtSale: number };
type Sale = {
  id: string;
  recipeId: string;
  quantity: number;
  unitPrice: number;
  totalRevenue: number;
  totalCost: number;
  date: string;
  source: "api";
  taxTreatment: "automatic";
  externalId: string;
  posOrderId: string;
  posProductCode: string;
  accountId: string;
  stockUsage: SaleUsage[];
  accountTypeAtSale: string;
  cardCommissionPctAtSale: number;
  taxPctAtSale: number;
};
type StockMovement = {
  theoreticalQuantity?: number;
  id: string;
  inventoryId: string;
  type: "sale" | "adjustment";
  quantity: number;
  date: string;
  note: string;
  referenceId: string;
};
type PosItemInput = {
  productCode?: unknown;
  productName?: unknown;
  name?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  totalAmount?: unknown;
  total?: unknown;
};
type PosOrderInput = {
  orderId?: unknown;
  externalId?: unknown;
  soldAt?: unknown;
  date?: unknown;
  paymentMethod?: unknown;
  accountId?: unknown;
  branchId?: unknown;
  items?: unknown;
};
type PosImportResult = {
  duplicate: boolean;
  branchId: string;
  orderId: string;
  importedItems: number;
  quantity: number;
  totalAmount: number;
  saleIds: string[];
  date: string;
};
type PosRefundResult = {
  duplicate: boolean;
  branchId: string;
  orderId: string;
  refundedItems: number;
  restoredIngredients: number;
  cancellationRecorded: boolean;
};

export class PosApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "PosApiError";
    this.status = status;
    this.details = details;
  }
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function branchId(value: unknown) {
  const id = String(value || "main").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) {
    throw new PosApiError(400, "Noto‘g‘ri branchId.");
  }
  return id;
}

export function assertOpenPosAccountingMonth(
  monthlyCloses: unknown,
  date: string,
  action = "POS amali",
) {
  if (!isAccountingMonthClosed(monthlyCloses, date)) return;
  throw new PosApiError(
    409,
    `${date.slice(0, 7)} oyi yopilgan. ${action} yopilgan oy hisobini o‘zgartira olmaydi.`,
  );
}

function paymentAccount(
  paymentMethod: string,
  requestedAccountId: string,
  accounts: Account[],
) {
  if (requestedAccountId && accounts.some((account) => account.id === requestedAccountId)) {
    return requestedAccountId;
  }
  const normalized = paymentMethod.toLowerCase();
  if (/cash|naqd|현금/.test(normalized)) return "account-cash";
  if (/delivery|yetkaz|배달/.test(normalized)) return "account-delivery";
  if (/bank|transfer|o‘tkaz|이체/.test(normalized)) return "account-bank";
  return "account-card";
}

function parseState(value: Record<string, unknown>) {
  return {
    ...value,
    inventory: (Array.isArray(value.inventory) ? value.inventory : []) as Inventory[],
    recipes: ensureMenuCodes((Array.isArray(value.recipes) ? value.recipes : []) as Recipe[]),
    accounts: (Array.isArray(value.accounts) ? value.accounts : []) as Account[],
    sales: (Array.isArray(value.sales) ? value.sales : []) as Array<Record<string, unknown>>,
    stockMovements: (Array.isArray(value.stockMovements) ? value.stockMovements : []) as Array<Record<string, unknown>>,
    monthlyCloses: value.monthlyCloses,
    costRules: value.costRules as { cardCommissionPct?: unknown; taxPct?: unknown } | undefined,
    refundedPosOrders: (Array.isArray(value.refundedPosOrders) ? value.refundedPosOrders : []) as Array<{
      orderId: string;
      refundedAt: string;
      reason: string;
    }>,
  };
}

export async function importPosOrder(input: PosOrderInput) {
  const orderId = String(input.orderId || input.externalId || "").trim().slice(0, 160);
  if (!orderId) throw new PosApiError(400, "orderId majburiy.");
  if (!Array.isArray(input.items) || !input.items.length) {
    throw new PosApiError(400, "Kamida bitta items qatori kerak.");
  }
  if (input.items.length > 100) throw new PosApiError(413, "Bitta buyurtmada 100 tadan ko‘p qator mumkin emas.");

  const rawItems = input.items as PosItemInput[];
  const date = posBusinessDate(input.soldAt || input.date);
  const targetBranchId = branchId(input.branchId);
  const mappings = await listProductMappings(targetBranchId);

  return mutateHaloState<PosImportResult>((rawState) => {
    const state = parseState(rawState);
    if (state.refundedPosOrders.some((entry) => entry.orderId === orderId)) {
      throw new PosApiError(409, "Bu orderId oldin bekor qilingan va qayta import qilinmaydi.");
    }
    const duplicateSales = state.sales.filter((sale) => sale.posOrderId === orderId);
    if (duplicateSales.length) {
      return {
        state,
        result: {
          duplicate: true,
          branchId: targetBranchId,
          orderId,
          importedItems: duplicateSales.length,
          quantity: duplicateSales.reduce((sum, sale) => sum + number(sale.quantity), 0),
          totalAmount: duplicateSales.reduce((sum, sale) => sum + number(sale.totalRevenue), 0),
          saleIds: duplicateSales.map((sale) => String(sale.id || "")),
          date,
        },
      };
    }
    assertOpenPosAccountingMonth(state.monthlyCloses, date, "POS savdoni import qilish");

    const resolved = rawItems.map((rawItem, index) => {
      const productCode = String(rawItem.productCode || "").trim().slice(0, 100);
      const productName = String(rawItem.productName || rawItem.name || "").trim().slice(0, 150);
      const normalizedName = normalizeExternalName(productName);
      const mapping = mappings.find((entry) => productCode && entry.externalCode === productCode)
        || mappings.find((entry) => normalizedName && entry.normalizedName === normalizedName);
      const recipe = state.recipes.find((entry) => entry.id === mapping?.recipeId)
        || state.recipes.find((entry) => productCode && recipeHasMenuCode(entry, productCode))
        || state.recipes.find((entry) => normalizeExternalName(entry.name) === normalizedName);
      const quantity = Math.floor(Math.abs(number(rawItem.quantity)));
      const explicitTotal = Math.abs(number(rawItem.totalAmount ?? rawItem.total));
      const unitPrice = Math.abs(number(rawItem.unitPrice));
      return {
        index,
        productCode,
        productName,
        recipe,
        quantity,
        explicitTotal,
        unitPrice,
      };
    });

    const invalid = resolved.filter((item) => !item.productName && !item.productCode);
    if (invalid.length) throw new PosApiError(400, "Har bir qatorga productCode yoki productName kerak.");
    const invalidQuantity = resolved.filter((item) => item.quantity <= 0 || item.quantity > 10_000);
    if (invalidQuantity.length) {
      throw new PosApiError(400, "quantity 1 dan 10 000 gacha bo‘lishi kerak.");
    }
    const unmatched = resolved.filter((item) => !item.recipe).map((item) => ({
      productCode: item.productCode,
      productName: item.productName,
    }));
    if (unmatched.length) {
      throw new PosApiError(422, "Ba’zi POS mahsulotlari HALO retseptiga bog‘lanmagan.", { unmatched });
    }
    const emptyRecipes = resolved.filter((item) => !item.recipe?.ingredients?.length)
      .map((item) => item.recipe?.name);
    if (emptyRecipes.length) {
      throw new PosApiError(422, "Retsept tarkibi to‘ldirilmagan.", { recipes: emptyRecipes });
    }
    const unavailableRecipes = resolved.flatMap((item) => {
      const missing = item.recipe ? missingRecipeIngredient(item.recipe, state.inventory) : undefined;
      return missing ? [{ recipe: item.recipe?.name, ingredient: String(missing.name || missing.inventoryId || "") }] : [];
    });
    if (unavailableRecipes.length) {
      throw new PosApiError(422, "Retsept ingredienti ombor savatida. Avval Bekor qilinganlar → Savat / tiklash oynasidan mahsulotni qaytaring.", { recipes: unavailableRecipes });
    }

    const requirements = new Map<string, number>();
    resolved.forEach((item) => {
      item.recipe?.ingredients.forEach((ingredient) => {
        if (!ingredient.inventoryId || !state.inventory.some((entry) => entry.id === ingredient.inventoryId)) return;
        requirements.set(
          ingredient.inventoryId,
          (requirements.get(ingredient.inventoryId) || 0) + number(ingredient.quantity) * item.quantity,
        );
      });
    });
    const shortage = state.inventory.find((item) => !isExpenseOnlyInventory(item) && item.stock + 0.000001 < (requirements.get(item.id) || 0));
    if (shortage) {
      throw new PosApiError(422, `${shortage.name} omborda yetarli emas.`, {
        inventoryId: shortage.id,
        available: shortage.stock,
        required: requirements.get(shortage.id) || 0,
      });
    }
    const accountId = paymentAccount(
      String(input.paymentMethod || ""),
      String(input.accountId || ""),
      state.accounts,
    );
    const newSales: Sale[] = [];
    const newMovements: StockMovement[] = [];
    resolved.forEach((item) => {
      const recipe = item.recipe!;
      const saleId = id("sale");
      const usage = recipe.ingredients.filter((ingredient) => (
        ingredient.inventoryId && state.inventory.some((entry) => entry.id === ingredient.inventoryId)
      )).map((ingredient) => {
        const quantity = number(ingredient.quantity) * item.quantity;
        const savedUnitCost = Number(ingredient.unitCost);
        const unitCostAtSale = Number.isFinite(savedUnitCost) && savedUnitCost > 0
          ? savedUnitCost
          : Number(ingredient.lineCost) > 0 && Number(ingredient.quantity) > 0
            ? Number(ingredient.lineCost) / Number(ingredient.quantity)
          : state.inventory.find((entry) => entry.id === ingredient.inventoryId)?.unitCost || 0;
        return {
          inventoryId: ingredient.inventoryId,
          quantity,
          unitCostAtSale,
          totalCostAtSale: quantity * unitCostAtSale,
        };
      });
      const totalCost = calculateRecipeCostBreakdown(recipe.ingredients, state.inventory, recipe.extraCosts).totalCost * item.quantity;
      const totalRevenue = item.explicitTotal
        || (item.unitPrice ? item.unitPrice * item.quantity : recipe.salePrice * item.quantity);
      newSales.push(snapshotSaleFinancialRates({
        id: saleId,
        recipeId: recipe.id,
        quantity: item.quantity,
        unitPrice: totalRevenue / item.quantity,
        totalRevenue,
        totalCost,
        date,
        source: "api",
        taxTreatment: "automatic",
        externalId: `${orderId}:${item.productCode || normalizeExternalName(item.productName)}:${item.index}`,
        posOrderId: orderId,
        posProductCode: item.productCode,
        accountId,
        stockUsage: usage,
      }, state.accounts.find((entry) => entry.id === accountId)?.type, state.costRules));
      usage.forEach((entry) => newMovements.push({
        id: id("mov"),
        inventoryId: entry.inventoryId,
        type: "sale",
        quantity: -entry.quantity,
        date,
        note: `POS API · ${recipe.name} × ${item.quantity} · ${orderId}`,
        referenceId: saleId,
      }));
    });

    const next = {
      ...state,
      inventory: state.inventory.map((item) => ({
        ...item,
        stock: item.stock - (requirements.get(item.id) || 0),
      })),
      sales: [...newSales, ...state.sales],
      stockMovements: [...newMovements, ...state.stockMovements],
    };
    return {
      state: next,
      result: {
        duplicate: false,
        branchId: targetBranchId,
        orderId,
        importedItems: newSales.length,
        quantity: newSales.reduce((sum, sale) => sum + sale.quantity, 0),
        totalAmount: newSales.reduce((sum, sale) => sum + sale.totalRevenue, 0),
        saleIds: newSales.map((sale) => sale.id),
        date,
      },
    };
  }, 5, targetBranchId, "POS API", `POS savdo: ${orderId}`, "POS integratsiya");
}

export async function refundPosOrder(input: { orderId?: unknown; reason?: unknown; branchId?: unknown }) {
  const orderId = String(input.orderId || "").trim().slice(0, 160);
  const reason = String(input.reason || "POS bekor qilindi").trim().slice(0, 200);
  const targetBranchId = branchId(input.branchId);
  if (!orderId) throw new PosApiError(400, "orderId majburiy.");

  return mutateHaloState<PosRefundResult>((rawState) => {
    const state = parseState(rawState);
    const refundedSales = state.sales.filter((sale) => sale.posOrderId === orderId);
    if (!refundedSales.length) {
      const alreadyCancelled = state.refundedPosOrders.some((entry) => entry.orderId === orderId);
      return {
        state: alreadyCancelled ? state : {
          ...state,
          refundedPosOrders: [
            { orderId, refundedAt: new Date().toISOString(), reason },
            ...state.refundedPosOrders,
          ].slice(0, 10_000),
        },
        result: {
          duplicate: alreadyCancelled,
          branchId: targetBranchId,
          orderId,
          refundedItems: 0,
          restoredIngredients: 0,
          cancellationRecorded: !alreadyCancelled,
        },
      };
    }
    const date = posBusinessDate(undefined);
    refundedSales.forEach((sale) => {
      assertOpenPosAccountingMonth(
        state.monthlyCloses,
        String(sale.date || ""),
        "POS savdoni qaytarish",
      );
    });
    assertOpenPosAccountingMonth(state.monthlyCloses, date, "POS savdoni qaytarish");
    const restored = new Map<string, number>();
    const cancelledTheoretical = new Map<string, number>();
    refundedSales.forEach((sale) => {
      const usage = Array.isArray(sale.stockUsage) ? sale.stockUsage as SaleUsage[] : [];
      usage.forEach((entry) => {
        cancelledTheoretical.set(entry.inventoryId, (cancelledTheoretical.get(entry.inventoryId) || 0) + number(entry.quantity));
        restored.set(entry.inventoryId, (restored.get(entry.inventoryId) || 0) + number(entry.deductedQuantity ?? entry.quantity));
      });
    });
    const refundMovements: StockMovement[] = [...restored.entries()].map(([inventoryId, quantity]) => ({
      id: id("mov"),
      inventoryId,
      type: "adjustment",
      quantity,
      date,
      note: `POS REFUND · ${orderId} · ${reason}`,
      referenceId: `refund-${orderId}`,
      theoreticalQuantity: -(cancelledTheoretical.get(inventoryId) || 0),
    }));
    const refundedIds = new Set(refundedSales.map((sale) => String(sale.id || "")));
    const next = {
      ...state,
      inventory: state.inventory.map((item) => ({
        ...item,
        stock: item.stock + (restored.get(item.id) || 0),
      })),
      sales: state.sales.filter((sale) => !refundedIds.has(String(sale.id || ""))),
      stockMovements: [...refundMovements, ...state.stockMovements],
      refundedPosOrders: [
        { orderId, refundedAt: new Date().toISOString(), reason },
        ...state.refundedPosOrders.filter((entry) => entry.orderId !== orderId),
      ].slice(0, 10_000),
    };
    return {
      state: next,
      result: {
        duplicate: false,
        branchId: targetBranchId,
        orderId,
        refundedItems: refundedSales.length,
        restoredIngredients: restored.size,
        cancellationRecorded: true,
      },
    };
  }, 5, targetBranchId, "POS API", `POS savdo bekor qilindi: ${orderId}`, "POS integratsiya");
}
