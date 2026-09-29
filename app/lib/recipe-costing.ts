import { isExpenseOnlyInventory } from './vegetable-expenses.ts';
import { type InventoryAccountingFields } from './inventory-accounting.ts';
export type RecipeCostInventory = InventoryAccountingFields & {
  id: string;
  unitCost: number;
};

export type RecipeLinkInventory = RecipeCostInventory & {
  name: string;
  unit: string;
  gramsPerUnit?: number;
};

export type RecipeCostIngredient = {
  id?: string;
  inventoryId?: string;
  name?: string;
  unit?: string;
  quantity: number;
  unitCost?: number;
  lineCost?: number;
};

export type RecipeExtraCostInput = {
  amount: number;
};

export type RecipeMarginInput = {
  salePrice?: number;
  ingredients?: RecipeCostIngredient[];
  extraCosts?: RecipeExtraCostInput[];
};

export type RecipeMarginStatus =
  | "TAYYOR"
  | "MENYU NARXI KIRITILMAGAN"
  | "RETSEPT KIRITILMAGAN"
  | "INGREDIENT ARXIVDA"
  | "TANNARX KIRITILMAGAN";

export const normalizeHumanNameKey = (value: unknown) => String(value ?? "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "");

const MASS_UNIT_GRAMS: Record<string, number> = { g: 1, kg: 1_000 };
const VOLUME_UNIT_MILLILITRES: Record<string, number> = { ml: 1, litr: 1_000 };

export const convertRecipeQuantity = (
  quantityValue: unknown,
  fromUnitValue: unknown,
  toUnitValue: unknown,
  gramsPerUnitValue: unknown = 0,
) => {
  const quantity = Number(quantityValue);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const fromUnit = String(fromUnitValue || "").trim().toLowerCase();
  const toUnit = String(toUnitValue || "").trim().toLowerCase();
  if (!fromUnit || !toUnit || fromUnit === toUnit) return quantity;

  if (MASS_UNIT_GRAMS[fromUnit] && MASS_UNIT_GRAMS[toUnit]) {
    return quantity * MASS_UNIT_GRAMS[fromUnit] / MASS_UNIT_GRAMS[toUnit];
  }
  if (VOLUME_UNIT_MILLILITRES[fromUnit] && VOLUME_UNIT_MILLILITRES[toUnit]) {
    return quantity * VOLUME_UNIT_MILLILITRES[fromUnit] / VOLUME_UNIT_MILLILITRES[toUnit];
  }

  const gramsPerUnit = Number(gramsPerUnitValue);
  if (toUnit === "dona" && MASS_UNIT_GRAMS[fromUnit] && Number.isFinite(gramsPerUnit) && gramsPerUnit > 0) {
    return quantity * MASS_UNIT_GRAMS[fromUnit] / gramsPerUnit;
  }
  return null;
};

export const linkRecipeIngredientsToInventory = <T extends RecipeCostIngredient>(
  ingredients: T[],
  inventory: RecipeLinkInventory[],
): Array<Omit<T, "unitCost" | "lineCost"> & RecipeCostIngredient> => {
  const maximumStoredCost = 1_000_000_000_000;
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const inventoryByName = new Map<string, RecipeLinkInventory[]>();
  inventory.forEach((item) => {
    const key = normalizeHumanNameKey(item.name);
    if (!key) return;
    inventoryByName.set(key, [...(inventoryByName.get(key) || []), item]);
  });

  return ingredients.map((ingredient) => {
    const linkedItem = inventoryById.get(String(ingredient.inventoryId || ""));
    const compatibleMatches = linkedItem
      ? [linkedItem]
      : (inventoryByName.get(normalizeHumanNameKey(ingredient.name)) || []).filter((item) => (
        convertRecipeQuantity(
          ingredient.quantity,
          ingredient.unit || item.unit,
          item.unit,
          item.gramsPerUnit,
        ) !== null
      ));
    if (compatibleMatches.length !== 1) return ingredient;

    const inventoryItem = compatibleMatches[0];
    const convertedQuantity = convertRecipeQuantity(
      ingredient.quantity,
      ingredient.unit || inventoryItem.unit,
      inventoryItem.unit,
      inventoryItem.gramsPerUnit,
    );
    if (convertedQuantity === null || convertedQuantity > 1_000_000_000) return ingredient;

    const originalQuantity = Number(ingredient.quantity);
    const { lineCost: rawLineCost, unitCost: rawUnitCost, ...ingredientWithoutCosts } = ingredient;
    const savedLineCost = Number(rawLineCost);
    const savedUnitCost = Number(rawUnitCost);
    const validSavedLineCost = Number.isFinite(savedLineCost)
      && savedLineCost > 0
      && savedLineCost <= maximumStoredCost;
    const validSavedUnitCost = Number.isFinite(savedUnitCost)
      && savedUnitCost > 0
      && savedUnitCost <= maximumStoredCost;
    const preservedLineCost = validSavedLineCost
      ? savedLineCost
      : validSavedUnitCost && Number.isFinite(originalQuantity) && originalQuantity > 0
        ? savedUnitCost * originalQuantity
        : 0;
    const convertedUnitCost = preservedLineCost / convertedQuantity;
    const validConvertedUnitCost = Number.isFinite(convertedUnitCost)
      && convertedUnitCost > 0
      && convertedUnitCost <= maximumStoredCost;

    return {
      ...ingredientWithoutCosts,
      inventoryId: inventoryItem.id,
      name: inventoryItem.name,
      unit: inventoryItem.unit,
      quantity: convertedQuantity,
      ...(validSavedLineCost ? { lineCost: savedLineCost } : {}),
      ...(validConvertedUnitCost ? { unitCost: convertedUnitCost } : {}),
    };
  });
};

export const normalizeRecipeIngredients = <T extends RecipeCostIngredient>(
  ingredients: T[],
  inventory: RecipeCostInventory[],
): RecipeCostIngredient[] => {
  const validInventoryIds = new Set(inventory.map((item) => item.id));
  const normalized = new Map<string, RecipeCostIngredient>();

  ingredients.forEach((ingredient) => {
    const quantity = Number(ingredient.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const inventoryId = String(ingredient.inventoryId || "").trim();
    const name = String(ingredient.name || "").trim().slice(0, 80);
    const unit = String(ingredient.unit || "").trim().slice(0, 20);
    const linkedInventoryId = validInventoryIds.has(inventoryId) ? inventoryId : "";
    if (!linkedInventoryId && !name) return;
    const savedUnitCost = Number(ingredient.unitCost);
    const savedLineCost = Number(ingredient.lineCost);
    const key = linkedInventoryId
      ? `inventory:${linkedInventoryId}`
      : `manual:${normalizeHumanNameKey(name)}:${unit.toLowerCase()}`;
    const current = normalized.get(key);
    const stableId = current?.id || ingredient.id;
    const savedName = name || current?.name;
    const savedUnit = unit || current?.unit;
    normalized.set(key, {
      ...(stableId ? { id: stableId } : {}),
      inventoryId: linkedInventoryId,
      ...(savedName ? { name: savedName } : {}),
      ...(savedUnit ? { unit: savedUnit } : {}),
      quantity: (current?.quantity ?? 0) + quantity,
      ...(Number.isFinite(savedLineCost) && savedLineCost > 0
        ? { lineCost: (current?.lineCost ?? 0) + savedLineCost }
        : current?.lineCost
          ? { lineCost: current.lineCost }
          : {}),
      ...(Number.isFinite(savedUnitCost) && savedUnitCost > 0
        ? { unitCost: savedUnitCost }
        : current?.unitCost
          ? { unitCost: current.unitCost }
          : {}),
    });
    // A saved line total covers only its own quantity. When duplicate lines
    // are merged, add every line's cost (including inventory-priced lines),
    // rather than letting the last unit price or first line total win.
    const merged = normalized.get(key)!;
    if (current && [current.lineCost, current.unitCost, ingredient.lineCost, ingredient.unitCost]
      .some((value) => Number.isFinite(Number(value)) && Number(value) > 0)) {
      const combinedCost = calculateRecipeCost([current, ingredient], inventory);
      merged.lineCost = combinedCost;
      merged.unitCost = combinedCost / merged.quantity;
    }
  });

  return [...normalized.values()];
};

export const calculateRecipeCost = (
  ingredients: RecipeCostIngredient[],
  inventory: RecipeCostInventory[],
) => {
  const unitCostByInventory = new Map(inventory.map((item) => {
    const unitCost = Number(item.unitCost);
    return [item.id, Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : 0];
  }));
  return ingredients.reduce((sum, ingredient) => {
    const quantity = Number(ingredient.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return sum;
    const linkedItem = inventory.find(item => item.id === ingredient.inventoryId);
    if (isExpenseOnlyInventory(linkedItem)) return sum + quantity * (unitCostByInventory.get(String(ingredient.inventoryId || '')) || 0);
    const savedLineCost = Number(ingredient.lineCost);
    if (Number.isFinite(savedLineCost) && savedLineCost > 0) {
      const nextTotal = sum + savedLineCost;
      return Number.isFinite(nextTotal) ? nextTotal : sum;
    }
    const savedUnitCost = Number(ingredient.unitCost);
    const unitCost = Number.isFinite(savedUnitCost) && savedUnitCost > 0
      ? savedUnitCost
      : unitCostByInventory.get(String(ingredient.inventoryId || "")) ?? 0;
    const lineCost = unitCost * quantity;
    if (!Number.isFinite(lineCost)) return sum;
    const nextTotal = sum + lineCost;
    return Number.isFinite(nextTotal) ? nextTotal : sum;
  }, 0);
};

export const calculateRecipeExtraCost = (extraCosts: RecipeExtraCostInput[] | undefined) => (
  Array.isArray(extraCosts) ? extraCosts : []
).reduce((sum, extraCost) => {
  const amount = Number(extraCost.amount);
  if (!Number.isFinite(amount) || amount < 0) return sum;
  const nextTotal = sum + amount;
  return Number.isFinite(nextTotal) ? nextTotal : sum;
}, 0);

export const calculateRecipeCostBreakdown = (
  ingredients: RecipeCostIngredient[],
  inventory: RecipeCostInventory[],
  extraCosts: RecipeExtraCostInput[] | undefined,
) => {
  const ingredientCost = calculateRecipeCost(ingredients, inventory);
  const extraCost = calculateRecipeExtraCost(extraCosts);
  const totalCost = ingredientCost + extraCost;
  return {
    ingredientCost,
    extraCost,
    totalCost: Number.isFinite(totalCost) ? totalCost : ingredientCost,
  };
};

/**
 * HALO Control va tashqi hisobotlar uchun yagona joriy retsept marjasi.
 * Noto‘liq tannarx 0 deb olinmaydi: aks holda soxta 100% marja chiqishi mumkin.
 */
export const calculateRecipeMarginAudit = (
  recipe: RecipeMarginInput,
  inventory: RecipeCostInventory[],
) => {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const extraCosts = Array.isArray(recipe.extraCosts) ? recipe.extraCosts : [];
  const breakdown = calculateRecipeCostBreakdown(ingredients, inventory, extraCosts);
  const inventoryById = new Map(inventory.map((item) => [String(item.id || ""), item]));
  const salePrice = Number(recipe.salePrice);
  let status: RecipeMarginStatus = "TAYYOR";

  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    status = "MENYU NARXI KIRITILMAGAN";
  } else if (!ingredients.length) {
    status = "RETSEPT KIRITILMAGAN";
  } else if (ingredients.some((ingredient) => (
    Boolean(String(ingredient.inventoryId || ""))
    && !inventoryById.has(String(ingredient.inventoryId || ""))
  ))) {
    status = "INGREDIENT ARXIVDA";
  } else if (ingredients.some((ingredient) => {
    const quantity = Number(ingredient.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return true;
    const linkedItem = inventoryById.get(String(ingredient.inventoryId || ""));
    if (isExpenseOnlyInventory(linkedItem)) return !Number.isFinite(Number(linkedItem?.unitCost)) || Number(linkedItem?.unitCost) <= 0;
    const savedLineCost = Number(ingredient.lineCost);
    if (Number.isFinite(savedLineCost) && savedLineCost > 0) return false;
    const savedUnitCost = Number(ingredient.unitCost);
    if (Number.isFinite(savedUnitCost) && savedUnitCost > 0) return false;
    const linkedUnitCost = Number(inventoryById.get(String(ingredient.inventoryId || ""))?.unitCost);
    return !Number.isFinite(linkedUnitCost) || linkedUnitCost <= 0;
  }) || breakdown.totalCost <= 0) {
    status = "TANNARX KIRITILMAGAN";
  }

  const complete = status === "TAYYOR";
  const grossProfit = complete ? salePrice - breakdown.totalCost : null;
  const marginRatio = complete && salePrice > 0 ? grossProfit! / salePrice : null;
  return {
    ...breakdown,
    salePrice: Number.isFinite(salePrice) && salePrice > 0 ? salePrice : 0,
    grossProfit,
    marginRatio,
    marginPercent: marginRatio === null ? null : marginRatio * 100,
    complete,
    status,
  };
};
