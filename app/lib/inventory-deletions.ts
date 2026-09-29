import {
  activeDeletedItems,
  createDeletedItem,
  normalizeDeletedItems,
  prependDeletedItem,
  validDeletedItems,
} from "./deleted-items.ts";
import {
  bypassRemovedReceiptCost,
  receiptCostsForInventory,
} from "./stock-movements.ts";
import { reconcileArchivedState } from "./warehouse-consistency.ts";
import { isAccountingMonthClosed } from "./month-end.ts";

type JsonRecord = Record<string, unknown>;
type InventoryRecord = JsonRecord & {
  id: string;
  name: string;
  unit: string;
  stock: number;
  unitCost: number;
  packageCost: number;
  unitsPerPackage: number;
};
type MovementRecord = JsonRecord & {
  id: string;
  inventoryId: string;
  type: string;
  quantity: number;
  date: string;
  unitCost?: number;
  previousUnitCost?: number;
  referenceId?: string;
};

export class WarehouseDeletionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WarehouseDeletionError";
    this.status = status;
  }
}

const records = (value: unknown) => (Array.isArray(value)
  ? value.filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
  : []);

const cleanReason = (value: string) => {
  const reason = value.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!reason) throw new WarehouseDeletionError("O‘chirish sababini yozish majburiy.");
  return reason;
};

const canonicalState = (state: JsonRecord) => reconcileArchivedState(state).state as JsonRecord;

export function archiveInventoryProduct(
  inputState: JsonRecord,
  entityId: string,
  reasonValue: string,
) {
  const state = canonicalState(inputState);
  const reason = cleanReason(reasonValue);
  const inventory = records(state.inventory) as InventoryRecord[];
  const stockMovements = records(state.stockMovements) as MovementRecord[];
  const deletedItems = normalizeDeletedItems(state.deletedItems);
  const existingArchive = activeDeletedItems(deletedItems)
    .find((item) => item.kind === "inventory" && item.entityId === entityId);
  const item = inventory.find((entry) => String(entry.id || "") === entityId);
  if (!item) {
    if (existingArchive) return {
      state,
      result: {
        kind: "inventory" as const,
        id: entityId,
        label: existingArchive.label,
        alreadyDeleted: true,
        detachedMovementCount: 0,
      },
    };
    throw new WarehouseDeletionError("Ombor mahsuloti topilmadi.", 404);
  }

  const linkedPurchaseOrder = records(state.purchaseOrders).find((order) => (
    String(order.status || "") !== "cancelled"
    && records(order.items).some((orderItem) => String(orderItem.inventoryId || "") === entityId)
  ));
  if (linkedPurchaseOrder) {
    const ordered = String(linkedPurchaseOrder.status || "") === "ordered";
    throw new WarehouseDeletionError(ordered
      ? "Bu mahsulot faol xarid buyurtmasida bor. Avval Xaridlar nazoratida buyurtmani bekor qiling."
      : "Bu mahsulot qabul qilingan xarid va ombor tarixiga bog‘langan. Hisob tarixi saqlanishi uchun uni o‘chirib bo‘lmaydi.", 409);
  }

  const relatedMovements = stockMovements.filter((movement) => movement.inventoryId === entityId);
  if (relatedMovements.some((movement) => (
    isAccountingMonthClosed(state.monthlyCloses, movement.date)
    || String(movement.referenceId || "").startsWith("monthly-close:")
  ))) {
    throw new WarehouseDeletionError(
      "Bu mahsulot yopilgan oy ombor tarixiga bog‘langan. Tarix saqlanishi uchun mahsulotni o‘chirib bo‘lmaydi.",
      409,
    );
  }
  const archive = createDeletedItem({
    kind: "inventory",
    entityId,
    label: String(item.name || "Mahsulot"),
    section: "Ombor",
    record: item,
    // The empty array is also a version marker: future movements created while
    // the product is archived must update the archived stock snapshot once.
    related: { stockMovements: relatedMovements },
    reason,
  });
  if (!validDeletedItems([archive])) {
    throw new WarehouseDeletionError("Mahsulot arxiv nusxasi tekshiruvdan o‘tmadi. Ma’lumot o‘chirilmadi.");
  }
  const next = canonicalState({
    ...state,
    inventory: inventory.filter((entry) => entry.id !== entityId),
    stockMovements: stockMovements.filter((movement) => movement.inventoryId !== entityId),
    deletedItems: prependDeletedItem(deletedItems, archive),
  });
  return {
    state: next,
    result: {
      kind: "inventory" as const,
      id: entityId,
      label: archive.label,
      alreadyDeleted: false,
      detachedMovementCount: relatedMovements.length,
    },
  };
}

export function archiveStockMovement(
  inputState: JsonRecord,
  entityId: string,
  reasonValue: string,
) {
  const state = canonicalState(inputState);
  const reason = cleanReason(reasonValue);
  const inventory = records(state.inventory) as InventoryRecord[];
  const stockMovements = records(state.stockMovements) as MovementRecord[];
  const deletedItems = normalizeDeletedItems(state.deletedItems);
  const existingArchive = activeDeletedItems(deletedItems)
    .find((item) => item.kind === "stockMovement" && item.entityId === entityId);
  const movement = stockMovements.find((entry) => String(entry.id || "") === entityId);
  if (!movement) {
    if (existingArchive) return {
      state,
      result: {
        kind: "stockMovement" as const,
        id: entityId,
        label: existingArchive.label,
        alreadyDeleted: true,
        detachedMovementCount: 0,
      },
    };
    throw new WarehouseDeletionError("Ombor harakati topilmadi.", 404);
  }
  if (isAccountingMonthClosed(state.monthlyCloses, movement.date)) {
    throw new WarehouseDeletionError("Yopilgan oydagi ombor harakatini o‘chirib bo‘lmaydi.", 409);
  }
  if (movement.id.startsWith("delivery-receipt:")) {
    throw new WarehouseDeletionError("Bu harakat xodim kirimi va yetkazuvchi qarziga bog‘langan. Uni manba kirimidan boshqaring.");
  }
  const purchaseOrderIds = new Set(records(state.purchaseOrders).map((order) => String(order.id || "")));
  if (movement.referenceId && purchaseOrderIds.has(movement.referenceId)) {
    throw new WarehouseDeletionError("Bu kirim Xarid buyurtmasiga bog‘langan. Uni Xaridlar nazoratidan boshqaring.");
  }
  if (movement.type === "sale") {
    throw new WarehouseDeletionError("Savdoga tegishli chiqimni Savdo bo‘limidan bekor qiling.");
  }
  const referenceId = String(movement.referenceId || "").trim();
  if (referenceId) {
    const workerConsumptionIds = new Set(records(state.workerConsumptions).map((entry) => String(entry.id || "")));
    const supplierDeliveryIds = new Set(records(state.supplierDeliveries).map((entry) => String(entry.id || "")));
    const source = referenceId.startsWith("monthly-close:")
      ? "Oy yakuni yozuviga"
      : workerConsumptionIds.has(referenceId)
        ? "yeyilgan / chiqit yozuviga"
        : supplierDeliveryIds.has(referenceId)
          ? "yetkazuvchi kirimi yozuviga"
          : referenceId.startsWith("refund-")
            ? "POS qaytaruvi yozuviga"
            : `“${referenceId.slice(0, 120)}” manba yozuviga`;
    throw new WarehouseDeletionError(
      `Bu ombor harakati ${source} bog‘langan. Uni manba bo‘limidan tahrirlang yoki bekor qiling.`,
    );
  }

  const item = inventory.find((entry) => entry.id === movement.inventoryId);
  if (!item) throw new WarehouseDeletionError("Harakatga tegishli ombor mahsuloti topilmadi.", 404);
  const nextStock = Number(item.stock) - Number(movement.quantity);
  if (!Number.isFinite(nextStock) || (nextStock < -0.000001 && nextStock < Number(item.stock) - 0.000001)) {
    throw new WarehouseDeletionError("Bu yozuvni o‘chirish qoldiqni minusga tushiradi.");
  }
  const remainingMovements = bypassRemovedReceiptCost(
    stockMovements.filter((entry) => entry.id !== movement.id),
    movement,
  );
  const nextInventory = receiptCostsForInventory(
    inventory.map((entry) => entry.id === item.id
      ? { ...entry, stock: Math.abs(nextStock) < 0.000001 ? 0 : nextStock }
      : entry),
    remainingMovements,
    movement.type === "receipt" && Number.isFinite(Number(movement.previousUnitCost))
      ? { [movement.inventoryId]: Number(movement.previousUnitCost) }
      : {},
    new Set([movement.inventoryId]),
  );
  const label = `${item.name} · ${movement.quantity > 0 ? "+" : ""}${Number(movement.quantity).toLocaleString()} ${item.unit}`;
  const archive = createDeletedItem({
    kind: "stockMovement",
    entityId,
    label,
    section: "Ombor",
    record: movement,
    reason,
  });
  if (!validDeletedItems([archive])) {
    throw new WarehouseDeletionError("Ombor harakati arxiv nusxasi tekshiruvdan o‘tmadi. Ma’lumot o‘chirilmadi.");
  }
  const next = canonicalState({
    ...state,
    inventory: nextInventory,
    stockMovements: remainingMovements,
    deletedItems: prependDeletedItem(deletedItems, archive),
  });
  return {
    state: next,
    result: {
      kind: "stockMovement" as const,
      id: entityId,
      label,
      alreadyDeleted: false,
      detachedMovementCount: 0,
    },
  };
}
