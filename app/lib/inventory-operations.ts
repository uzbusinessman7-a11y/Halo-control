import { validStockDocument, type StockDocument } from "./stock-documents.ts";
import {
  applyStockMovementToInventory,
  bypassRemovedReceiptCost,
  receiptCostsForInventory,
  stockMovementQuantity,
} from "./stock-movements.ts";

type JsonRecord = Record<string, unknown>;

type InventoryItem = JsonRecord & {
  id: string;
  name: string;
  stock: number;
  unit: string;
  unitCost: number;
  packageCost: number;
  unitsPerPackage: number;
  supplierId?: string;
};

type InventoryMovement = JsonRecord & {
  id: string;
  inventoryId: string;
  type: "receipt" | "waste" | "sale" | "adjustment";
  quantity: number;
  date: string;
  note: string;
  referenceId?: string;
  supplierId?: string;
  unitCost?: number;
  previousUnitCost?: number;
  document?: StockDocument;
};

export class InventoryOperationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "InventoryOperationError";
    this.status = status;
  }
}

const records = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const dateKey = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
const cleanText = (value: unknown, limit: number) => String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);

function inventoryRows(state: JsonRecord) {
  return records<InventoryItem>(state.inventory);
}

function movementRows(state: JsonRecord) {
  return records<InventoryMovement>(state.stockMovements);
}

function validInventoryId(value: unknown) {
  const id = String(value || "").trim();
  return id && id.length <= 160 ? id : "";
}

export function saveInventoryMovement(
  state: JsonRecord,
  input: { movement?: unknown; originalId?: unknown },
) {
  if (!input.movement || typeof input.movement !== "object" || Array.isArray(input.movement)) {
    throw new InventoryOperationError("Ombor harakati ma’lumotini tekshiring.");
  }
  const raw = input.movement as JsonRecord;
  const movementId = cleanText(raw.id, 100);
  const inventoryId = validInventoryId(raw.inventoryId);
  const type = String(raw.type || "");
  const rawQuantity = Number(raw.quantity);
  const quantity = stockMovementQuantity(type as "receipt" | "waste" | "adjustment", rawQuantity);
  const date = String(raw.date || "");
  const originalId = cleanText(input.originalId, 100);
  if (!movementId || !inventoryId || !["receipt", "waste", "adjustment"].includes(type)) {
    throw new InventoryOperationError("Mahsulot va Ombor harakati turini tekshiring.");
  }
  if (!Number.isFinite(rawQuantity) || rawQuantity === 0 || !Number.isFinite(quantity) || Math.abs(quantity) > 1_000_000_000) {
    throw new InventoryOperationError("Ombor miqdorini tekshiring.");
  }
  if (!dateKey(date)) throw new InventoryOperationError("Ombor kirimi sanasini tekshiring.");

  const inventory = inventoryRows(state);
  const movements = movementRows(state);
  const item = inventory.find((entry) => entry.id === inventoryId);
  if (!item) throw new InventoryOperationError("Tanlangan mahsulot Omborda topilmadi.", 404);

  const duplicate = movements.find((entry) => entry.id === movementId);
  if (!originalId && duplicate) {
    if (
      duplicate.inventoryId !== inventoryId
      || duplicate.type !== type
      || Number(duplicate.expenseOnlyAtMovement ? duplicate.purchaseBaseQuantity ?? duplicate.purchaseQuantity : duplicate.quantity) !== quantity
      || duplicate.date !== date
    ) {
      throw new InventoryOperationError("Bu Ombor amalining raqami boshqa yozuvda ishlatilgan.", 409);
    }
    return {
      state,
      result: {
        id: duplicate.id,
        inventoryId: duplicate.inventoryId,
        quantity: duplicate.quantity,
        stock: Number(inventory.find((entry) => entry.id === duplicate.inventoryId)?.stock || 0),
        alreadySaved: true,
      },
    };
  }

  const original = originalId ? movements.find((entry) => entry.id === originalId) : undefined;
  if (item.catalogArchived && !original) {
    throw new InventoryOperationError('Mahsulot faol ro‘yxatdan olib tashlangan. Yangi kirimdan oldin uni tiklang.', 409);
  }
  if (originalId && !original) throw new InventoryOperationError("Tahrirlanayotgan Ombor yozuvi topilmadi.", 404);
  if (original && (original.type === "sale" || original.referenceId)) {
    throw new InventoryOperationError("Bog‘langan Ombor harakatini faqat o‘z manba bo‘limidan o‘zgartirish mumkin.", 409);
  }
  if (original && movementId !== original.id) {
    throw new InventoryOperationError("Tahrirlash yozuvi mos kelmadi.", 409);
  }

  const supplierId = cleanText(raw.supplierId, 100);
  if (supplierId && !records<JsonRecord>(state.suppliers).some((supplier) => supplier.id === supplierId)) {
    throw new InventoryOperationError("Yetkazib beruvchini tekshiring.");
  }
  const unitCost = Number(raw.unitCost || 0);
  if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1_000_000_000_000) {
    throw new InventoryOperationError("Kirim narxini tekshiring.");
  }
  if (raw.document !== undefined && !validStockDocument(raw.document)) {
    throw new InventoryOperationError("Nakladnoy rasmini tekshiring.");
  }

  const nextInventoryStocks = applyStockMovementToInventory(
    inventory,
    original ? { inventoryId: original.inventoryId, quantity: Number(original.quantity) } : null,
    { inventoryId, quantity },
  );
  if (!nextInventoryStocks) {
    throw new InventoryOperationError("Bu o‘zgarish Ombor qoldig‘ini minusga tushiradi.");
  }

  const movement: InventoryMovement = {
    ...(original || {}),
    id: movementId,
    inventoryId,
    type: type as InventoryMovement["type"],
    quantity,
    date,
    note: cleanText(raw.note, 300) || (type === "receipt" ? "Kirim" : type === "waste" ? "Yo‘qotish" : "Tuzatish"),
    ...(type === "receipt" && supplierId ? { supplierId } : {}),
    ...(type === "receipt" && unitCost > 0 ? { unitCost } : {}),
    ...(type !== "receipt" ? { unitCost: Number(item.unitCost || 0) } : {}),
    ...(type === "receipt" && unitCost > 0 ? {
      previousUnitCost: original?.inventoryId === inventoryId && Number.isFinite(Number(original.previousUnitCost))
        ? Number(original.previousUnitCost)
        : Number(item.unitCost || 0),
    } : {}),
    ...(raw.document ? { document: raw.document as StockDocument } : {}),
    ...(type === "receipt" && (!original || original.supplierAccounting === 'separate') ? {supplierAccounting:'separate'} : {}),
  };

  const replaced = original
    ? movements.map((entry) => entry.id === original.id ? movement : entry)
    : [movement, ...movements];
  const nextMovements = original?.type === "receipt" && (
    movement.type !== "receipt"
    || movement.inventoryId !== original.inventoryId
    || !(Number(movement.unitCost) > 0)
  ) ? bypassRemovedReceiptCost(replaced, original) : replaced;
  const fallbackCosts: Record<string, number> = {};
  if (original?.type === "receipt" && Number.isFinite(Number(original.previousUnitCost))) {
    fallbackCosts[original.inventoryId] = Number(original.previousUnitCost);
  }
  const affectedIds = new Set([inventoryId, ...(original ? [original.inventoryId] : [])]);
  const nextInventory = receiptCostsForInventory(nextInventoryStocks, nextMovements, fallbackCosts, affectedIds)
    .map((entry) => entry.id === inventoryId && type === "receipt" && supplierId
      ? { ...entry, supplierId }
      : entry);

  return {
    state: { ...state, inventory: nextInventory, stockMovements: nextMovements },
    result: {
      id: movement.id,
      inventoryId,
      quantity,
      stock: Number(nextInventory.find((entry) => entry.id === inventoryId)?.stock || 0),
      alreadySaved: false,
    },
  };
}

export function saveInventoryCount(
  state: JsonRecord,
  input: { counts?: unknown; date?: unknown; operationId?: unknown },
) {
  const counts = records<JsonRecord>(input.counts);
  const date = String(input.date || "");
  const operationId = cleanText(input.operationId, 100);
  if (!operationId || !dateKey(date) || !counts.length || counts.length > 300) {
    throw new InventoryOperationError("Ombor sanog‘i ma’lumotini tekshiring.");
  }
  const inventory = inventoryRows(state);
  const movements = movementRows(state);
  if (movements.some((entry) => entry.referenceId === `inventory-count:${operationId}`)) {
    return { state, result: { changed: 0, alreadySaved: true } };
  }
  const seen = new Set<string>();
  const desired = new Map<string, number>();
  counts.forEach((entry) => {
    const inventoryId = validInventoryId(entry.inventoryId);
    const actualStock = Number(entry.actualStock);
    if (!inventoryId || seen.has(inventoryId) || !Number.isFinite(actualStock) || actualStock < 0 || actualStock > 1_000_000_000_000) {
      throw new InventoryOperationError("Sanalgan mahsulot miqdorini tekshiring.");
    }
    if (!inventory.some((item) => item.id === inventoryId)) {
      throw new InventoryOperationError("Sanalgan mahsulotlardan biri Omborda topilmadi.", 404);
    }
    seen.add(inventoryId);
    desired.set(inventoryId, actualStock);
  });

  const referenceId = `inventory-count:${operationId}`;
  const adjustments: InventoryMovement[] = [];
  const nextInventory = inventory.map((item) => {
    if (!desired.has(item.id)) return item;
    const actualStock = desired.get(item.id)!;
    const difference = actualStock - Number(item.stock || 0);
    if (Math.abs(difference) <= 0.000001) return item;
    adjustments.push({
      id: `count-${crypto.randomUUID()}`,
      inventoryId: item.id,
      type: "adjustment",
      quantity: difference,
      date,
      note: "Ombor sanog‘i",
      referenceId,
      unitCost: Number(item.unitCost || 0),
    });
    return { ...item, stock: actualStock };
  });

  return {
    state: {
      ...state,
      inventory: nextInventory,
      stockMovements: [...adjustments, ...movements],
    },
    result: {
      changed: adjustments.length,
      alreadySaved: false,
      adjustments: adjustments.map((entry) => ({ inventoryId: entry.inventoryId, quantity: entry.quantity })),
    },
  };
}
