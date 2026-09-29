type StockRecord = Record<string, unknown>;

const EPSILON = 0.000001;

export function finiteWorkerStock(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

export function exactNegativeMovementTotals(
  actual: Map<string, number>,
  expected: Map<string, number>,
) {
  if (actual.size !== expected.size) return false;
  return [...actual].every(([inventoryId, quantity]) => (
    expected.has(inventoryId)
    && quantity < 0
    && Math.abs(quantity - Number(expected.get(inventoryId))) <= EPSILON
  ));
}

export function expectedWorkerRecipeMovementTotals(
  ingredients: StockRecord[],
  saleQuantity: number,
  inventoryIds: Set<string>,
) {
  const expected = new Map<string, number>();
  ingredients.forEach((ingredient) => {
    const inventoryId = String(ingredient.inventoryId || "");
    const quantity = Number(ingredient.quantity);
    if (!inventoryId || !inventoryIds.has(inventoryId) || !Number.isFinite(quantity) || quantity <= 0) return;
    expected.set(inventoryId, (expected.get(inventoryId) || 0) - quantity * saleQuantity);
  });
  return expected;
}

export function exactWorkerStockDeltas(
  currentInventory: StockRecord[],
  nextInventory: StockRecord[],
  movements: StockRecord[],
) {
  const nextById = new Map(nextInventory.map((item) => [String(item.id || ""), item]));
  const movementTotals = new Map<string, number>();
  movements.forEach((movement) => {
    const inventoryId = String(movement.inventoryId || "");
    movementTotals.set(inventoryId, (movementTotals.get(inventoryId) || 0) + Number(movement.quantity));
  });
  return currentInventory.every((item) => {
    const inventoryId = String(item.id || "");
    const candidate = nextById.get(inventoryId);
    return Boolean(candidate)
      && finiteWorkerStock(candidate!.stock)
      && Math.abs(
        Number(candidate!.stock) - Number(item.stock) - (movementTotals.get(inventoryId) || 0),
      ) <= EPSILON;
  });
}
