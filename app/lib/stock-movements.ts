type InventoryStock = { id: string; stock: number };
type MovementStock = { inventoryId: string; quantity: number };
type ReceiptCostMovement = {
  id: string;
  inventoryId: string;
  type: string;
  date: string;
  unitCost?: number;
  previousUnitCost?: number;
};
type InventoryCost = {
  id: string;
  unitCost: number;
  packageCost: number;
  unitsPerPackage: number;
};

export function stockMovementQuantity(
  type: "receipt" | "waste" | "adjustment",
  quantity: number,
) {
  if (!Number.isFinite(quantity)) return 0;
  if (type === "receipt") return Math.abs(quantity);
  if (type === "waste") return -Math.abs(quantity);
  return quantity;
}

export function applyStockMovementToInventory<T extends InventoryStock>(
  inventory: T[],
  previous: MovementStock | null,
  next: MovementStock,
): T[] | null {
  const stocks = new Map(inventory.map((item) => [item.id, Number(item.stock)]));
  if (previous) {
    const previousStock = stocks.get(previous.inventoryId);
    if (
      previousStock === undefined
      || !Number.isFinite(previousStock)
      || !Number.isFinite(previous.quantity)
    ) return null;
    const reversedStock = previousStock - previous.quantity;
    if (!Number.isFinite(reversedStock)) return null;
    stocks.set(previous.inventoryId, reversedStock);
  }
  const currentStock = stocks.get(next.inventoryId);
  if (
    currentStock === undefined
    || !Number.isFinite(currentStock)
    || !Number.isFinite(next.quantity)
  ) return null;
  const nextStock = currentStock + next.quantity;
  if (!Number.isFinite(nextStock)) return null;

  // POS and kitchen consumption may intentionally leave a temporary negative
  // balance. A receipt must always be able to improve that balance, and an
  // unrelated negative product must never block another product's receipt.
  if (next.quantity < 0 && nextStock < 0) return null;
  stocks.set(next.inventoryId, nextStock);
  return inventory.map((item) => ({ ...item, stock: Number(stocks.get(item.id)) }));
}

export function bypassRemovedReceiptCost<T extends ReceiptCostMovement>(
  movements: T[],
  removed: ReceiptCostMovement,
) {
  if (
    removed.type !== "receipt"
    || !(Number(removed.unitCost) > 0)
    || !Number.isFinite(Number(removed.previousUnitCost))
  ) return movements;
  const removedIndex = movements.findIndex((movement) => movement.id === removed.id);
  const orderedIndex = new Map(movements.map((movement, index) => [movement.id, index]));
  const successor = movements
    .filter((movement) => (
      movement.inventoryId === removed.inventoryId
      && movement.type === "receipt"
      && Number(movement.unitCost) > 0
      && (movement.date > removed.date || (movement.date === removed.date
        && removedIndex >= 0 && (orderedIndex.get(movement.id) ?? Infinity) < removedIndex))
    ))
    .sort((left, right) => left.date.localeCompare(right.date)
      || (orderedIndex.get(right.id) ?? 0) - (orderedIndex.get(left.id) ?? 0))[0];
  if (!successor) return movements;
  return movements.map((movement) => movement.id === successor.id
    ? { ...movement, previousUnitCost: Number(removed.previousUnitCost) }
    : movement);
}

export function receiptCostsForInventory<
  I extends InventoryCost,
  M extends ReceiptCostMovement,
>(
  inventory: I[],
  movements: M[],
  fallbackCosts: Record<string, number> = {},
  affectedIds?: Set<string>,
) {
  return inventory.map((item) => {
    if (affectedIds && !affectedIds.has(item.id)) return item;
    const latestPricedReceipt = movements
      .filter((entry) => entry.inventoryId === item.id && entry.type === "receipt" && Number(entry.unitCost) > 0)
      // Rows are stored newest first. Stable sorting preserves same-day entry
      // order; random UUIDs must never determine which purchase price wins.
      .sort((left, right) => right.date.localeCompare(left.date))[0];
    if (latestPricedReceipt?.unitCost) return {
      ...item,
      unitCost: latestPricedReceipt.unitCost,
      packageCost: latestPricedReceipt.unitCost * item.unitsPerPackage,
    };
    if (Number.isFinite(fallbackCosts[item.id])) return {
      ...item,
      unitCost: fallbackCosts[item.id],
      packageCost: fallbackCosts[item.id] * item.unitsPerPackage,
    };
    return item;
  });
}
