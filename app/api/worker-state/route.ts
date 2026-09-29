import {
  HaloStateConflictError,
  readHaloRevision,
  readHaloState,
  replaceHaloState,
} from "../../lib/halo-store";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import {
  buildWorkerStateView,
  workerInventoryView,
  workerRecipeView,
} from "../../lib/worker-state-view";
import { costRuleCoversCategory } from "../../lib/daily-report";
import { calculateRecipeCostBreakdown } from "../../lib/recipe-costing";
import {
  inferLegacyCategoryId,
  normalizeProductCategories,
  validCategoryId,
  validProductCategories,
} from "../../lib/product-categories";
import { isAccountingMonthClosed } from "../../lib/month-end";
import { snapshotSaleFinancialRates } from "../../lib/sale-financial-snapshots";
import {
  exactNegativeMovementTotals,
  exactWorkerStockDeltas,
  expectedWorkerRecipeMovementTotals,
  finiteWorkerStock,
} from "../../lib/worker-stock-validation";

const MAX_STATE_BYTES = 5 * 1024 * 1024;
const immutableKeys = [
  "suppliers",
  "transactions",
  "accounts",
  "dailyCloses",
  "fixedExpenses",
  "purchaseOrders",
  "deletedItems",
  "costRules",
  "workerConsumptions",
  "posOrders",
  "monthlyCloses",
] as const;

function equal(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutStock(item: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "stock"));
}

function newEntries(current: unknown, next: unknown) {
  const currentIds = new Set((Array.isArray(current) ? current : [])
    .map((entry) => String((entry as Record<string, unknown>)?.id || "")));
  return (Array.isArray(next) ? next : [])
    .filter((entry) => !currentIds.has(String((entry as Record<string, unknown>)?.id || "")))
    .map((entry) => entry as Record<string, unknown>);
}

function hasUniqueIds(value: unknown) {
  if (!Array.isArray(value)) return false;
  const ids = value.map((entry) => String((entry as Record<string, unknown>)?.id || ""));
  return ids.every(Boolean) && new Set(ids).size === ids.length;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function workerUpdateAllowed(current: Record<string, unknown>, next: Record<string, unknown>) {
  if (immutableKeys.some((key) => !equal(current[key], next[key]))) return false;
  const currentCategories = normalizeProductCategories(current.productCategories);
  if (next.productCategories !== undefined && !validProductCategories(next.productCategories)) return false;
  const nextCategories = next.productCategories === undefined
    ? currentCategories
    : normalizeProductCategories(next.productCategories);
  if (!equal(currentCategories, nextCategories)) return false;
  const currentInventory = Array.isArray(current.inventory) ? current.inventory as Array<Record<string, unknown>> : [];
  const normalizedRecipes = (value: unknown) => workerRecipeView(value).map((entry) => {
    const recipe = entry as Record<string, unknown>;
    return {
      ...recipe,
      categoryId: validCategoryId(
        currentCategories,
        "recipe",
        recipe.categoryId || inferLegacyCategoryId("recipe", String(recipe.name || "")),
      ),
    };
  });
  if (!equal(normalizedRecipes(current.recipes), normalizedRecipes(next.recipes))) return false;
  const nextInventory = Array.isArray(next.inventory) ? next.inventory as Array<Record<string, unknown>> : [];
  if (
    !hasUniqueIds(nextInventory)
    || !hasUniqueIds(next.sales)
    || !hasUniqueIds(next.stockMovements)
    || !hasUniqueIds(next.financialEntries)
  ) return false;
  if (currentInventory.length !== nextInventory.length) return false;
  const nextInventoryById = new Map(nextInventory.map((item) => [String(item.id || ""), item]));
  const inventorySafe = currentInventory.every((item) => {
    const candidate = nextInventoryById.get(String(item.id || ""));
    if (!candidate) return false;
    const normalizedCurrent = {
      ...workerInventoryView([item])[0],
      categoryId: validCategoryId(
        currentCategories,
        "inventory",
        item.categoryId || inferLegacyCategoryId("inventory", String(item.name || "")),
      ),
    };
    const normalizedCandidate = {
      ...candidate,
      categoryId: validCategoryId(
        currentCategories,
        "inventory",
        candidate.categoryId || inferLegacyCategoryId("inventory", String(candidate.name || "")),
      ),
    };
    return equal(withoutStock(normalizedCurrent), withoutStock(normalizedCandidate))
      && finiteWorkerStock(candidate.stock);
  });
  if (!inventorySafe) return false;
  const addedSales = newEntries(current.sales, next.sales);
  const addedMovements = newEntries(current.stockMovements, next.stockMovements);
  const addedFinancial = newEntries(current.financialEntries, next.financialEntries);
  if (addedSales.length > 5_000 || addedMovements.length > 20_000 || addedFinancial.length > 100) return false;
  if (addedFinancial.length && (addedSales.length || addedMovements.length)) return false;
  const recipes = Array.isArray(current.recipes) ? current.recipes as Array<Record<string, unknown>> : [];
  const accounts = Array.isArray(current.accounts) ? current.accounts as Array<Record<string, unknown>> : [];
  const recipeIds = new Set(recipes.map((recipe) => String(recipe.id || "")));
  const recipesById = new Map(recipes.map((recipe) => [String(recipe.id || ""), recipe]));
  const accountIds = new Set(accounts.map((account) => String(account.id || "")));
  const accountTypes = new Map(accounts.map((account) => [String(account.id || ""), String(account.type || "")]));
  if (addedSales.some((sale) => (
    !["pos", "manual"].includes(String(sale.source))
    || (sale.source === "manual" && !["cash", "bank"].includes(accountTypes.get(String(sale.accountId || "")) || ""))
    || !finiteNumber(sale.quantity)
    || Number(sale.quantity) <= 0
    || Number(sale.quantity) > 100_000
    || !finiteNumber(sale.totalRevenue)
    || Number(sale.totalRevenue) < 0
    || Number(sale.totalRevenue) > 100_000_000_000
    || !finiteNumber(sale.totalCost)
    || Number(sale.totalCost) < 0
    || !recipeIds.has(String(sale.recipeId || ""))
    || !accountIds.has(String(sale.accountId || ""))
  ))) return false;
  const existingExternalIds = new Set((Array.isArray(current.sales) ? current.sales : [])
    .map((entry) => String((entry as Record<string, unknown>)?.externalId || "").trim())
    .filter(Boolean));
  for (const sale of addedSales) {
    const externalId = String(sale.externalId || "").trim();
    if (externalId && existingExternalIds.has(externalId)) return false;
    if (externalId) existingExternalIds.add(externalId);
  }
  if (addedMovements.some((movement) => (
    !["sale", "waste"].includes(String(movement.type))
    || !finiteNumber(movement.quantity)
    || Number(movement.quantity) >= 0
    || !nextInventoryById.has(String(movement.inventoryId || ""))
  ))) return false;
  const addedSaleIds = new Set(addedSales.map((sale) => String(sale.id || "")));
  if (addedSales.length) {
    if (addedMovements.some((movement) => (
      movement.type !== "sale" || !addedSaleIds.has(String(movement.referenceId || ""))
    ))) return false;
    for (const sale of addedSales) {
      const recipe = recipesById.get(String(sale.recipeId || ""));
      const saleQuantity = Number(sale.quantity);
      const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
      const expected = expectedWorkerRecipeMovementTotals(
        ingredients as Array<Record<string, unknown>>,
        saleQuantity,
        new Set(nextInventoryById.keys()),
      );
      const actual = new Map<string, number>();
      addedMovements
        .filter((movement) => String(movement.referenceId || "") === String(sale.id || ""))
        .forEach((movement) => {
          const inventoryId = String(movement.inventoryId || "");
          actual.set(inventoryId, (actual.get(inventoryId) || 0) + Number(movement.quantity));
        });
      if (!exactNegativeMovementTotals(actual, expected)) return false;
    }
  } else if (addedMovements.some((movement) => movement.type !== "waste")) {
    return false;
  }
  if (addedFinancial.some((entry) => (
    entry.type !== "expense"
    || String(entry.category || "").trim().toLocaleLowerCase("uz-UZ").includes("maosh")
    || entry.payrollPaymentId !== undefined
    || entry.fixedExpenseId !== undefined
    || entry.fixedExpenseDueDate !== undefined
    || entry.reversedEntryId !== undefined
    || (entry.affectsProfit !== true && String(entry.category || "") !== "Mahsulot xaridi")
    || !finiteNumber(entry.amount)
    || Number(entry.amount) <= 0
    || Number(entry.amount) > 100_000_000_000
    || !accountIds.has(String(entry.accountId || ""))
    || costRuleCoversCategory(
      String(entry.category || ""),
      current.costRules as { cardCommissionPct?: number; deliveryCommissionPct?: number; taxPct?: number } | undefined,
    )
  ))) return false;
  return exactWorkerStockDeltas(currentInventory, nextInventory, addedMovements);
}

function canonicalWorkerState(current: Record<string, unknown>, next: Record<string, unknown>) {
  const categories = normalizeProductCategories(current.productCategories);
  const currentInventory = Array.isArray(current.inventory) ? current.inventory as Array<Record<string, unknown>> : [];
  const submittedInventory = new Map((Array.isArray(next.inventory) ? next.inventory : []).map((entry) => {
    const item = entry as Record<string, unknown>;
    return [String(item.id || ""), item];
  }));
  const recipesById = new Map((Array.isArray(current.recipes) ? current.recipes : []).map((entry) => {
    const recipe = entry as Record<string, unknown>;
    return [String(recipe.id || ""), recipe];
  }));
  const inventoryById = new Map(currentInventory.map((item) => [String(item.id || ""), item]));
  const accountTypes = new Map((Array.isArray(current.accounts) ? current.accounts : []).map((entry) => {
    const account = entry as Record<string, unknown>;
    return [String(account.id || ""), String(account.type || "")] as const;
  }));
  const addedSales = newEntries(current.sales, next.sales).map((sale) => {
    const recipe = recipesById.get(String(sale.recipeId || ""));
    const quantity = Number(sale.quantity || 0);
    const ingredients = Array.isArray(recipe?.ingredients)
      ? recipe.ingredients as Array<{ inventoryId?: string; quantity: number; unitCost?: number; lineCost?: number }>
      : [];
    const requirements = new Map<string, number>();
    ingredients.forEach((ingredient) => {
      const inventoryId = String(ingredient.inventoryId || "");
      const required = Number(ingredient.quantity) * quantity;
      if (!inventoryId || !inventoryById.has(inventoryId) || !Number.isFinite(required) || required <= 0) return;
      requirements.set(inventoryId, (requirements.get(inventoryId) || 0) + required);
    });
    const stockUsage = [...requirements].map(([inventoryId, required]) => {
      const ingredient = ingredients.find((entry) => String(entry.inventoryId || "") === inventoryId);
      const savedUnitCost = Number(ingredient?.unitCost);
      const savedLineCost = Number(ingredient?.lineCost);
      const ingredientQuantity = Number(ingredient?.quantity);
      const unitCostAtSale = Number.isFinite(savedUnitCost) && savedUnitCost > 0
        ? savedUnitCost
        : Number.isFinite(savedLineCost) && savedLineCost > 0 && ingredientQuantity > 0
          ? savedLineCost / ingredientQuantity
          : Number(inventoryById.get(inventoryId)?.unitCost || 0);
      return { inventoryId, quantity: required, unitCostAtSale, totalCostAtSale: required * unitCostAtSale };
    });
    const submittedRevenue = Number(sale.totalRevenue || 0);
    const menuRevenue = Number(recipe?.salePrice || 0) * quantity;
    const totalRevenue = sale.revenueSource === "pos_actual" || submittedRevenue > 0
      ? submittedRevenue : Math.max(0, menuRevenue);
    const totalCost = calculateRecipeCostBreakdown(
      ingredients,
      currentInventory.map((item) => ({ ...item, id: String(item.id || ""), unitCost: Number(item.unitCost || 0) })),
      Array.isArray(recipe?.extraCosts) ? recipe.extraCosts as Array<{ amount: number }> : [],
    ).totalCost * quantity;
    return snapshotSaleFinancialRates({
      ...sale,
      unitPrice: quantity > 0 ? totalRevenue / quantity : 0,
      totalRevenue,
      totalCost,
      stockUsage,
    }, accountTypes.get(String(sale.accountId || "")), current.costRules as {
      cardCommissionPct?: unknown;
      taxPct?: unknown;
    });
  });
  return {
    // Start from the trusted server state so worker payloads cannot add or
    // overwrite unknown/future top-level sections.
    ...current,
    sales: [...addedSales, ...(Array.isArray(current.sales) ? current.sales : [])],
    stockMovements: [...newEntries(current.stockMovements, next.stockMovements), ...(Array.isArray(current.stockMovements) ? current.stockMovements : [])],
    financialEntries: [...newEntries(current.financialEntries, next.financialEntries), ...(Array.isArray(current.financialEntries) ? current.financialEntries : [])],
    productCategories: categories,
    recipes: current.recipes,
    inventory: currentInventory.map((item) => ({
      ...item,
      stock: Number(submittedInventory.get(String(item.id || ""))?.stock),
    })),
  };
}

function workerAction(current: Record<string, unknown>, next: Record<string, unknown>) {
  const addedSales = newEntries(current.sales, next.sales);
  const addedMovements = newEntries(current.stockMovements, next.stockMovements);
  const addedFinancial = newEntries(current.financialEntries, next.financialEntries);
  if (addedSales.length) {
    const quantity = addedSales.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0);
    const manualCashSale = addedSales.every((sale) => sale.source === "manual");
    return manualCashSale
      ? `Naqd / hisob savdosi: ${addedSales.length} tur, ${quantity.toLocaleString()} ta kiritildi`
      : `POS Excel: ${addedSales.length} qator, ${quantity.toLocaleString()} ta savdo kiritildi`;
  }
  const waste = addedMovements.find((movement) => movement.type === "waste");
  if (waste) {
    const inventory = (Array.isArray(next.inventory) ? next.inventory : [])
      .find((item) => String((item as Record<string, unknown>).id || "") === String(waste.inventoryId || "")) as Record<string, unknown> | undefined;
    return `Minus mahsulot: ${String(inventory?.name || "Mahsulot")} ${Number(waste.quantity).toLocaleString()}`;
  }
  const expense = addedFinancial[0];
  if (expense) {
    return `Xarajat: ${String(expense.category || "Boshqa")} · ₩${Number(expense.amount).toLocaleString()}`;
  }
  return "Xodim ma’lumot kiritdi";
}

export async function GET(request: Request) {
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    if (new URL(request.url).searchParams.get("revision") === "1") {
      return Response.json(
        { updatedAt: await readHaloRevision(session.branchId) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const current = await readHaloState(session.branchId);
    return Response.json(
      buildWorkerStateView(current.state, session.userId, current.updatedAt),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Ma’lumotlar ochilmadi." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > MAX_STATE_BYTES) {
      return Response.json({ error: "Ma’lumot hajmi juda katta." }, { status: 413 });
    }
    const body = await request.json() as Record<string, unknown> & { updatedAt?: string };
    if (!body.updatedAt) return Response.json({ error: "Sahifani yangilang." }, { status: 409 });
    const current = await readHaloState(session.branchId);
    if (current.updatedAt !== body.updatedAt) {
      return Response.json({ error: "Boshqa qurilmada ma’lumot yangilandi." }, { status: 409 });
    }
    const protectedBody: Record<string, unknown> = {
      productCategories: body.productCategories,
      inventory: body.inventory,
      recipes: body.recipes,
      sales: body.sales,
      stockMovements: body.stockMovements,
      financialEntries: body.financialEntries,
      ...Object.fromEntries(immutableKeys.map((key) => [key, current.state[key]])),
      staff: current.state.staff,
      workShifts: current.state.workShifts,
      payrollAdjustments: current.state.payrollAdjustments,
      attendanceDays: current.state.attendanceDays,
      payrollPayments: current.state.payrollPayments,
      auditLog: current.state.auditLog,
    };
    const closedPeriodEntry = [
      ...newEntries(current.state.sales, body.sales),
      ...newEntries(current.state.stockMovements, body.stockMovements),
      ...newEntries(current.state.financialEntries, body.financialEntries),
    ].find((entry) => isAccountingMonthClosed(current.state.monthlyCloses, entry.date));
    if (closedPeriodEntry) {
      return Response.json({ error: "Yopilgan oyga yangi yozuv kiritib bo‘lmaydi." }, { status: 409 });
    }
    if (!session.canWarehouseReceipt && newEntries(current.state.financialEntries, body.financialEntries).length) {
      return Response.json({ error: "Rahbar bu akkauntga xarajat kiritish ruxsatini bermagan." }, { status: 403 });
    }
    if (!workerUpdateAllowed(current.state, protectedBody)) {
      return Response.json({ error: "Bu amal xodimga ruxsat etilmagan." }, { status: 403 });
    }
    const canonicalBody = canonicalWorkerState(current.state, protectedBody);
    const updatedAt = await replaceHaloState(
      canonicalBody,
      body.updatedAt,
      session.branchId,
      session.name,
      workerAction(current.state, canonicalBody),
      "Xodim dasturi",
    );
    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    if (error instanceof HaloStateConflictError) {
      return Response.json({ error: "Ma’lumot yangilangan. Sahifani qayta oching." }, { status: 409 });
    }
    return Response.json({ error: "Saqlash amalga oshmadi." }, { status: 500 });
  }
}
