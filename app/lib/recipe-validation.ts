type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => Boolean(value && typeof value === "object");
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const strictIngredient = (ingredient: unknown) => {
  if (!isRecord(ingredient)) return false;
  const { inventoryId, name, unit, quantity, unitCost, lineCost } = ingredient;
  const linkedInventory = typeof inventoryId === "string" && inventoryId.length > 0;
  const namedIngredient = typeof name === "string"
    && name.trim().length > 0
    && name.trim().length <= 80
    && typeof unit === "string"
    && ["g", "kg", "ml", "litr", "dona"].includes(unit);
  const validUnitCost = unitCost === undefined || (
    typeof unitCost === "number"
    && Number.isFinite(unitCost)
    && unitCost >= 0
    && unitCost <= 1_000_000_000_000
  );
  const validLineCost = lineCost === undefined || (
    typeof lineCost === "number"
    && Number.isFinite(lineCost)
    && lineCost >= 0
    && lineCost <= 1_000_000_000_000
  );
  return (linkedInventory || namedIngredient)
    && typeof quantity === "number"
    && Number.isFinite(quantity)
    && quantity > 0
    && quantity <= 1_000_000_000
    && validUnitCost
    && validLineCost
    && (linkedInventory || Number(lineCost) > 0 || Number(unitCost) > 0);
};

const strictExtraCost = (extraCost: unknown) => {
  if (!isRecord(extraCost)) return false;
  const { name, amount } = extraCost;
  return typeof name === "string"
    && name.trim().length > 0
    && name.trim().length <= 80
    && typeof amount === "number"
    && Number.isFinite(amount)
    && amount > 0
    && amount <= 1_000_000_000;
};

const validIngredientRows = (next: unknown, current: unknown) => {
  if (!Array.isArray(next)) return false;
  const currentRows = Array.isArray(current) ? current : [];
  const usedCurrentRows = new Set<number>();
  return next.every((row) => {
    if (strictIngredient(row)) return true;
    const matchIndex = currentRows.findIndex((currentRow, index) => (
      !usedCurrentRows.has(index) && sameValue(row, currentRow)
    ));
    if (matchIndex < 0) return false;
    usedCurrentRows.add(matchIndex);
    return true;
  });
};

const validExtraCostRows = (next: unknown, current: unknown) => {
  if (next === undefined) return true;
  if (!Array.isArray(next) || next.length > 20) return false;
  const currentRows = Array.isArray(current) ? current : [];
  const usedCurrentRows = new Set<number>();
  return next.every((row) => {
    if (strictExtraCost(row)) return true;
    const matchIndex = currentRows.findIndex((currentRow, index) => (
      !usedCurrentRows.has(index) && sameValue(row, currentRow)
    ));
    if (matchIndex < 0) return false;
    usedCurrentRows.add(matchIndex);
    return true;
  });
};

export function validRecipeCosts(nextRecipes: unknown[], currentRecipes: unknown[]) {
  const currentById = new Map<string, UnknownRecord>();
  currentRecipes.forEach((recipe) => {
    if (isRecord(recipe) && typeof recipe.id === "string") currentById.set(recipe.id, recipe);
  });

  return nextRecipes.every((recipe) => {
    if (!isRecord(recipe)) return false;
    const current = typeof recipe.id === "string" ? currentById.get(recipe.id) : undefined;
    return validIngredientRows(recipe.ingredients, current?.ingredients)
      && validExtraCostRows(recipe.extraCosts, current?.extraCosts);
  });
}
