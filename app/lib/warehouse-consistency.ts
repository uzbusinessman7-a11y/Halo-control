import {
  normalizeDeletedItems,
  withoutActiveDeletedEntities,
  type DeletedItem,
} from "./deleted-items.ts";

type WarehouseEntity = { id: string };
type WarehouseMovement = WarehouseEntity & { inventoryId: string };

const recordValue = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);

export function archivedInventoryMovements<M extends WarehouseMovement = WarehouseMovement>(
  archive: DeletedItem,
): M[] {
  if (archive.kind !== "inventory" || !Array.isArray(archive.related?.stockMovements)) return [];
  const seen = new Set<string>();
  return archive.related.stockMovements.filter((entry): entry is M => {
    if (!recordValue(entry)) return false;
    const movementId = String(entry.id || "");
    const inventoryId = String(entry.inventoryId || "");
    if (!movementId || inventoryId !== archive.entityId || seen.has(movementId)) return false;
    seen.add(movementId);
    return true;
  });
}

export function reconcileWarehouseArchive<
  I extends WarehouseEntity,
  M extends WarehouseMovement,
>({
  inventory,
  stockMovements,
  deletedItems,
}: {
  inventory: I[];
  stockMovements: M[];
  deletedItems: DeletedItem[];
}) {
  const normalizedDeletedItems = normalizeDeletedItems(deletedItems);
  const activeInventoryArchives = new Map(
    normalizedDeletedItems
      .filter((item) => item.kind === "inventory" && !item.restoredAt)
      .map((item) => [item.entityId, item]),
  );
  const deletedMovementIds = new Set(
    normalizedDeletedItems
      .filter((item) => item.kind === "stockMovement" && !item.restoredAt)
      .map((item) => item.entityId),
  );
  const detachedByInventory = new Map<string, M[]>();
  const activeMovements: M[] = [];

  for (const movement of stockMovements) {
    if (deletedMovementIds.has(movement.id)) continue;
    if (activeInventoryArchives.has(movement.inventoryId)) {
      const detached = detachedByInventory.get(movement.inventoryId) || [];
      detached.push(movement);
      detachedByInventory.set(movement.inventoryId, detached);
      continue;
    }
    activeMovements.push(movement);
  }

  const nextDeletedItems = normalizedDeletedItems.map((archive) => {
    if (archive.kind !== "inventory" || archive.restoredAt) return archive;
    const hasMovementSnapshot = Array.isArray(archive.related?.stockMovements);
    const existingArchivedMovements = archivedInventoryMovements<M>(archive);
    const existingMovementIds = new Set(existingArchivedMovements.map((movement) => movement.id));
    const newlyDetachedMovements = (detachedByInventory.get(archive.entityId) || [])
      .filter((movement) => !deletedMovementIds.has(movement.id) && !existingMovementIds.has(movement.id));
    const seen = new Set<string>();
    const archivedMovements = [
      ...existingArchivedMovements,
      ...(detachedByInventory.get(archive.entityId) || []),
    ].filter((movement) => {
      if (deletedMovementIds.has(movement.id) || seen.has(movement.id)) return false;
      seen.add(movement.id);
      return movement.inventoryId === archive.entityId;
    });
    if (!archivedMovements.length && !archive.related?.stockMovements) return archive;
    const archivedStock = Number(archive.record.stock);
    const postDeleteDelta = hasMovementSnapshot
      ? newlyDetachedMovements.reduce((sum, movement) => {
        const quantity = Number((movement as Record<string, unknown>).quantity);
        return Number.isFinite(quantity) ? sum + quantity : sum;
      }, 0)
      : 0;
    return {
      ...archive,
      record: Number.isFinite(archivedStock) && postDeleteDelta
        ? { ...archive.record, stock: archivedStock + postDeleteDelta }
        : archive.record,
      related: {
        ...(archive.related || {}),
        stockMovements: archivedMovements,
      },
    };
  });
  const activeInventory = inventory.filter((item) => !activeInventoryArchives.has(item.id));

  return {
    inventory: activeInventory,
    stockMovements: activeMovements,
    deletedItems: nextDeletedItems,
    detachedMovementCount: [...detachedByInventory.values()].reduce((sum, entries) => sum + entries.length, 0),
  };
}

export function selectActiveStockMovements<
  I extends WarehouseEntity,
  M extends WarehouseMovement,
>(inventory: I[], stockMovements: M[], deletedItems: DeletedItem[]) {
  const activeInventoryIds = new Set(inventory.map((item) => item.id));
  const deletedMovementIds = new Set(
    normalizeDeletedItems(deletedItems)
      .filter((item) => item.kind === "stockMovement" && !item.restoredAt)
      .map((item) => item.entityId),
  );
  return stockMovements.filter((movement) => (
    activeInventoryIds.has(movement.inventoryId) && !deletedMovementIds.has(movement.id)
  ));
}

export function reconcileArchivedState<T extends object>(value: T) {
  const source = value as Record<string, unknown>;
  const inventory = (Array.isArray(source.inventory) ? source.inventory : [])
    .filter(recordValue) as Array<Record<string, unknown> & WarehouseEntity>;
  const stockMovements = (Array.isArray(source.stockMovements) ? source.stockMovements : [])
    .filter(recordValue) as Array<Record<string, unknown> & WarehouseMovement>;
  const deletedItems = normalizeDeletedItems(source.deletedItems);
  const warehouse = reconcileWarehouseArchive({ inventory, stockMovements, deletedItems });
  const canonical = withoutActiveDeletedEntities({
    ...source,
    inventory: warehouse.inventory,
    stockMovements: warehouse.stockMovements,
    deletedItems: warehouse.deletedItems,
  });
  const state = canonical as T;
  const canonicalRecord = canonical as Record<string, unknown>;
  const relevantKeys = [
    "inventory",
    "stockMovements",
    "deletedItems",
    "recipes",
    "productCategories",
    "fixedExpenses",
    "dailyCloses",
    "suppliers",
    "transactions",
    "sales",
  ];
  const changed = JSON.stringify(relevantKeys.map((key) => source[key]))
    !== JSON.stringify(relevantKeys.map((key) => canonicalRecord[key]));
  return { state, changed, detachedMovementCount: warehouse.detachedMovementCount };
}
