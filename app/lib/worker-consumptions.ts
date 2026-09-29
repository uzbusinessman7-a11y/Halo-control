import { expenseOnlyOnDate } from "./vegetable-expenses.ts";
import { calculateRecipeCostBreakdown } from "./recipe-costing.ts";
import { missingRecipeIngredient } from "./recipe-availability.ts";
import { isAccountingMonthClosed } from "./month-end.ts";
import {
  isKitchenConsumptionEntry,
} from "./outflow-classification.ts";

export {
  isKitchenConsumptionEntry,
  KITCHEN_CONSUMPTION_REASON,
} from "./outflow-classification.ts";

type JsonRecord = Record<string, unknown>;

export type WorkerConsumptionKind = "meal" | "product" | "waste" | "inventory_only";
export type InventoryOutflowCategory = "kitchen_consumption" | "other_inventory_outflow";

export const INVENTORY_OUTFLOW_REASONS = [
  "Oshxonada yeyilgan ovqat",
  "Isrof / buzilgan",
  "Bepul berildi / namuna",
  "Ichki foydalanish",
  "Boshqa nosavdo chiqim",
] as const;

const normalizedInventoryUnit = (value: unknown) => String(value || "")
  .trim()
  .toLocaleLowerCase("uz-UZ")
  .replace(/^l$/, "litr");

export function compatibleInventoryInputUnits(inventoryUnit: string) {
  const unit = normalizedInventoryUnit(inventoryUnit);
  if (unit === "kg") return ["kg", "g"];
  if (unit === "g") return ["g", "kg"];
  if (unit === "litr") return ["litr", "ml"];
  if (unit === "ml") return ["ml", "litr"];
  return [inventoryUnit || "birlik"];
}

export function inventoryQuantityFromInput(quantity: number, inputUnit: string, inventoryUnit: string) {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  const source = normalizedInventoryUnit(inputUnit || inventoryUnit);
  const target = normalizedInventoryUnit(inventoryUnit);
  if (source === target) return quantity;
  if (source === "g" && target === "kg") return quantity / 1_000;
  if (source === "kg" && target === "g") return quantity * 1_000;
  if (source === "ml" && target === "litr") return quantity / 1_000;
  if (source === "litr" && target === "ml") return quantity * 1_000;
  return 0;
}

const LEGACY_INVENTORY_OUTFLOW_REASONS = ["Xodim ovqati"] as const;

export type WorkerConsumptionInput = {
  operationId: string;
  kind: WorkerConsumptionKind;
  recipeId?: string;
  inventoryId?: string;
  items?: Array<{ recipeId: string; quantity: number }>;
  quantity?: number;
  date: string;
  reason?: string;
  note?: string;
};

export type WorkerConsumptionEditInput = WorkerConsumptionInput & {
  recordId: string;
};

export type WorkerConsumptionActor = {
  id: string;
  name: string;
};

export class WorkerConsumptionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WorkerConsumptionError";
    this.status = status;
  }
}

const records = (value: unknown) => Array.isArray(value) ? value as JsonRecord[] : [];
const cleanText = (value: unknown, limit: number) => String(value || "").trim().slice(0, limit);

function validOperationId(value: string) {
  return /^[a-zA-Z0-9_-]{10,100}$/.test(value);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function inventoryCost(item: JsonRecord) {
  const value = Number(item.unitCost || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function ingredientUnitCostAtOutflow(ingredient: JsonRecord, inventoryItem: JsonRecord, expenseOnly = false) {
  if (expenseOnly) return inventoryCost(inventoryItem);
  const quantity = Number(ingredient.quantity);
  const lineCost = Number(ingredient.lineCost);
  if (Number.isFinite(lineCost) && lineCost > 0 && Number.isFinite(quantity) && quantity > 0) {
    return lineCost / quantity;
  }
  const savedUnitCost = Number(ingredient.unitCost);
  if (Number.isFinite(savedUnitCost) && savedUnitCost > 0) return savedUnitCost;
  return inventoryCost(inventoryItem);
}

function recipeCostAtOutflow(recipe: JsonRecord, inventory: JsonRecord[], expenseOnly: (item: JsonRecord) => boolean) {
  return calculateRecipeCostBreakdown(
    records(recipe.ingredients).map((ingredient) => ({
      inventoryId: cleanText(ingredient.inventoryId, 100),
      name: cleanText(ingredient.name, 80),
      unit: cleanText(ingredient.unit, 20),
      quantity: Number(ingredient.quantity || 0),
      unitCost: Number(ingredient.unitCost || 0),
      lineCost: Number(ingredient.lineCost || 0),
    })),
    inventory.map((item) => ({
      id: cleanText(item.id, 100),
      unitCost: inventoryCost(item),
      expenseOnly: expenseOnly(item),
    })),
    records(recipe.extraCosts).map((extraCost) => ({ amount: Number(extraCost.amount || 0) })),
  );
}

export function applyWorkerConsumption(
  state: JsonRecord,
  input: WorkerConsumptionInput,
  worker: WorkerConsumptionActor,
  createdAt = new Date().toISOString(),
  historicalEntry?: JsonRecord,
) {
  const operationId = cleanText(input.operationId, 100);
  if (!validOperationId(operationId)) throw new WorkerConsumptionError("Amal identifikatori noto‘g‘ri.");
  const entryId = `worker-consumption:${operationId}`;
  const existing = records(state.workerConsumptions).find((entry) => String(entry.id || "") === entryId);
  if (existing) return { state, result: { entry: existing, alreadySaved: true } };

  if (!["meal", "product", "waste", "inventory_only"].includes(input.kind)) {
    throw new WorkerConsumptionError("Yozuv turini tanlang.");
  }
  const inventoryOnlyItems = input.kind === "inventory_only" && Array.isArray(input.items)
    ? input.items
    : [];
  const quantity = input.kind === "inventory_only"
    ? inventoryOnlyItems.reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
    : Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000) {
    throw new WorkerConsumptionError("Miqdor musbat va to‘g‘ri bo‘lishi kerak.");
  }
  if ((input.kind === "meal" || input.kind === "inventory_only") && !Number.isInteger(quantity)) {
    throw new WorkerConsumptionError("Taom porsiyasi butun son bo‘lishi kerak.");
  }
  const date = cleanText(input.date, 10);
  if (!validDate(date)) throw new WorkerConsumptionError("Sanani tekshiring.");
  if (isAccountingMonthClosed(state.monthlyCloses, date)) {
    throw new WorkerConsumptionError(`${date.slice(0, 7)} oyi yopilgan. Yozuvni ochiq oyga kiriting.`, 409);
  }
  const workerId = cleanText(worker.id, 100);
  const workerName = cleanText(worker.name, 80) || "Xodim";
  if (!workerId) throw new WorkerConsumptionError("Xodim profili aniqlanmadi.", 401);

  const inventory = records(state.inventory);
  const inventoryById = new Map(inventory.map((item) => [String(item.id || ""), item]));
  // Only new outflows adopt the current policy. Editing a historical record
  // keeps its saved physical treatment, including legacy records with no flag.
  const expenseOnlyAtOutflow = (item: JsonRecord) => historicalEntry
    ? records(historicalEntry.ingredientUsage).find(u => u.inventoryId === item.id)?.expenseOnlyAtOutflow === true
    : expenseOnlyOnDate(item, date, createdAt);
  const requirements = new Map<string, number>();
  const requirementCosts = new Map<string, number>();
  let label = "";
  let unit = "";
  let sourceType: "recipe" | "inventory";
  let recipeId = "";
  let inventoryId = "";
  let fullRecipeCostAtOutflow = 0;
  const recordedItems: Array<{
    recipeId: string;
    name: string;
    quantity: number;
    unitCostAtOutflow: number;
    totalCostAtOutflow: number;
    ingredientCostAtOutflow: number;
    extraCostAtOutflow: number;
  }> = [];

  if (input.kind === "inventory_only") {
    if (!inventoryOnlyItems.length || inventoryOnlyItems.length > 50) {
      throw new WorkerConsumptionError("Kamida bitta, ko‘pi bilan 50 tur taom tanlang.");
    }
    const combined = new Map<string, number>();
    for (const item of inventoryOnlyItems) {
      const selectedRecipeId = cleanText(item?.recipeId, 100);
      const selectedQuantity = Number(item?.quantity);
      if (!selectedRecipeId || !Number.isInteger(selectedQuantity) || selectedQuantity <= 0 || selectedQuantity > 1_000) {
        throw new WorkerConsumptionError("Taom sonini tekshiring.");
      }
      combined.set(selectedRecipeId, (combined.get(selectedRecipeId) || 0) + selectedQuantity);
    }
    const recipesById = new Map(records(state.recipes).map((entry) => [String(entry.id || ""), entry]));
    for (const [selectedRecipeId, selectedQuantity] of combined) {
      const recipe = recipesById.get(selectedRecipeId);
      if (!recipe) throw new WorkerConsumptionError("Taom topilmadi. Sahifani yangilang.", 404);
      if (missingRecipeIngredient(recipe, inventory)) {
        throw new WorkerConsumptionError("Taom retseptidagi ombor mahsuloti topilmadi. Avval retseptni tuzating.", 409);
      }
      const recipeName = cleanText(recipe.name, 120) || "Taom";
      const costBreakdown = recipeCostAtOutflow(recipe, inventory, expenseOnlyAtOutflow);
      for (const ingredient of records(recipe.ingredients)) {
        const linkedInventoryId = cleanText(ingredient.inventoryId, 100);
        if (!linkedInventoryId) continue;
        const inventoryItem = inventoryById.get(linkedInventoryId);
        if (!inventoryItem) continue;
        const perPortion = Number(ingredient.quantity);
        if (!Number.isFinite(perPortion) || perPortion <= 0) continue;
        requirements.set(
          linkedInventoryId,
          (requirements.get(linkedInventoryId) || 0) + perPortion * selectedQuantity,
        );
        requirementCosts.set(
          linkedInventoryId,
          (requirementCosts.get(linkedInventoryId) || 0)
            + perPortion * selectedQuantity * ingredientUnitCostAtOutflow(ingredient, inventoryItem, expenseOnlyAtOutflow(inventoryItem)),
        );
      }
      fullRecipeCostAtOutflow += costBreakdown.totalCost * selectedQuantity;
      recordedItems.push({
        recipeId: selectedRecipeId,
        name: recipeName,
        quantity: selectedQuantity,
        unitCostAtOutflow: costBreakdown.totalCost,
        totalCostAtOutflow: costBreakdown.totalCost * selectedQuantity,
        ingredientCostAtOutflow: costBreakdown.ingredientCost,
        extraCostAtOutflow: costBreakdown.extraCost,
      });
    }
    label = recordedItems.length === 1
      ? recordedItems[0].name
      : `${recordedItems.length} tur taom`;
    sourceType = "recipe";
    unit = "porsiya";
  } else if (input.kind === "meal") {
    recipeId = cleanText(input.recipeId, 100);
    const recipe = records(state.recipes).find((entry) => String(entry.id || "") === recipeId);
    if (!recipe) throw new WorkerConsumptionError("Taom topilmadi. Sahifani yangilang.", 404);
    if (missingRecipeIngredient(recipe, inventory)) {
      throw new WorkerConsumptionError("Taom retseptidagi ombor mahsuloti topilmadi. Avval retseptni tuzating.", 409);
    }
    label = cleanText(recipe.name, 120) || "Taom";
    sourceType = "recipe";
    unit = "porsiya";
    const costBreakdown = recipeCostAtOutflow(recipe, inventory, expenseOnlyAtOutflow);
    fullRecipeCostAtOutflow = costBreakdown.totalCost * quantity;
    for (const ingredient of records(recipe.ingredients)) {
      const linkedInventoryId = cleanText(ingredient.inventoryId, 100);
      const perPortion = Number(ingredient.quantity);
      if (!linkedInventoryId || !inventoryById.has(linkedInventoryId)) continue;
      if (!Number.isFinite(perPortion) || perPortion <= 0) continue;
      requirements.set(
        linkedInventoryId,
        (requirements.get(linkedInventoryId) || 0) + perPortion * quantity,
      );
      const inventoryItem = inventoryById.get(linkedInventoryId)!;
      requirementCosts.set(
        linkedInventoryId,
        (requirementCosts.get(linkedInventoryId) || 0)
          + perPortion * quantity * ingredientUnitCostAtOutflow(ingredient, inventoryItem, expenseOnlyAtOutflow(inventoryItem)),
      );
    }
  } else {
    inventoryId = cleanText(input.inventoryId, 100);
    const item = inventoryById.get(inventoryId);
    if (!item) throw new WorkerConsumptionError("Mahsulot topilmadi. Sahifani yangilang.", 404);
    label = cleanText(item.name, 120) || "Mahsulot";
    unit = cleanText(item.unit, 30) || "birlik";
    sourceType = "inventory";
    requirements.set(inventoryId, quantity);
    requirementCosts.set(inventoryId, quantity * inventoryCost(item));
  }

  const stockShortages: Array<{ inventoryId: string; name: string; unit: string; quantity: number }> = [];
  for (const [requiredInventoryId, required] of requirements) {
    const item = inventoryById.get(requiredInventoryId)!;
    if (expenseOnlyAtOutflow(item)) continue;
    const stock = Number(item.stock || 0);
    if (!Number.isFinite(stock)) throw new WorkerConsumptionError("Ombor qoldig‘i noto‘g‘ri.");
    const shortage = Math.max(0, required - Math.max(0, stock));
    if (shortage > 0.000001) stockShortages.push({
      inventoryId: requiredInventoryId,
      name: cleanText(item.name, 120) || "Mahsulot",
      unit: cleanText(item.unit, 30) || "birlik",
      quantity: shortage,
    });
  }

  const reason = cleanText(input.reason || (
    input.kind === "inventory_only"
      ? "Boshqa nosavdo chiqim"
      : input.kind === "meal"
        ? "Xodim yegan taom"
        : input.kind === "product"
          ? "Xodim yegan mahsulot"
          : "Boshqa minus"
  ), 120);
  if (input.kind === "inventory_only"
    && !INVENTORY_OUTFLOW_REASONS.includes(reason as typeof INVENTORY_OUTFLOW_REASONS[number])
    && !LEGACY_INVENTORY_OUTFLOW_REASONS.includes(reason as typeof LEGACY_INVENTORY_OUTFLOW_REASONS[number])) {
    throw new WorkerConsumptionError("Ombor chiqimi sababini tanlang.");
  }
  const note = cleanText(input.note, 300);
  const outflowCategory: InventoryOutflowCategory | undefined = input.kind === "meal"
    ? "kitchen_consumption"
    : input.kind === "inventory_only"
      ? (isKitchenConsumptionEntry({
        kind: input.kind,
        reason,
        sourceType,
        workerId,
        workerName,
      }) ? "kitchen_consumption" : "other_inventory_outflow")
      : undefined;
  const kindLabel = input.kind === "inventory_only"
    ? "NOSAVDO OMBOR CHIQIMI"
    : input.kind === "meal"
      ? "YEGAN TAOM"
      : input.kind === "product"
        ? "YEGAN MAHSULOT"
        : "MINUS / ISROF";
  const itemSummary = recordedItems.length
    ? recordedItems.map((item) => `${item.name} × ${item.quantity}`).join(", ")
    : `${label} × ${quantity}`;
  const ingredientUsage = [...requirements].map(([requiredInventoryId, required]) => {
    const inventoryItem = inventoryById.get(requiredInventoryId)!;
    const savedTotalCost = requirementCosts.get(requiredInventoryId) || 0;
    const unitCostAtOutflow = required > 0 ? savedTotalCost / required : 0;
    return {
      inventoryId: requiredInventoryId,
      name: cleanText(inventoryItem.name, 120) || "Mahsulot",
      unit: cleanText(inventoryItem.unit, 30) || "birlik",
      quantity: required,
      unitCostAtOutflow,
      totalCostAtOutflow: savedTotalCost,
      expenseOnlyAtOutflow: expenseOnlyAtOutflow(inventoryItem),
      deductedQuantity: expenseOnlyAtOutflow(inventoryItem) ? 0 : required,
    };
  });
  const movements = ingredientUsage.map((usage, index) => ({
    id: `worker-consumption-movement:${operationId}:${index}`,
    inventoryId: usage.inventoryId,
    type: "waste",
    quantity: -usage.deductedQuantity || 0,
    theoreticalQuantity: usage.quantity,
    expenseOnlyAtMovement: usage.expenseOnlyAtOutflow,
    unitCost: usage.unitCostAtOutflow,
    date,
    note: `${kindLabel} · ${itemSummary} · ${workerName}${reason ? ` · ${reason}` : ""}${note ? ` · ${note}` : ""}`,
    referenceId: entryId,
  }));
  const stockIngredientCost = ingredientUsage.reduce((sum, usage) => sum + usage.totalCostAtOutflow, 0);
  const totalCost = sourceType === "recipe" ? fullRecipeCostAtOutflow : stockIngredientCost;
  const entry = {
    id: entryId,
    operationId,
    workerId,
    workerName,
    kind: input.kind,
    sourceType,
    ...(recipeId ? { recipeId } : {}),
    ...(inventoryId ? { inventoryId } : {}),
    ...(recordedItems.length ? { items: recordedItems } : {}),
    label,
    quantity,
    unit,
    date,
    reason,
    note,
    ...(outflowCategory ? { outflowCategory } : {}),
    movementIds: movements.map((movement) => movement.id),
    ingredientUsage,
    totalCost,
    expenseOnlyCost: Math.min(totalCost, ingredientUsage.filter(u => u.expenseOnlyAtOutflow).reduce((sum, u) => sum + u.totalCostAtOutflow, 0)),
    costSnapshotVersion: 3,
    ...(stockShortages.length ? { stockShortages } : {}),
    createdAt,
  };

  const updatedInventory = inventory.map((item) => {
    const itemId = String(item.id || "");
    const required = requirements.get(itemId) || 0;
    return required && !expenseOnlyAtOutflow(item) ? { ...item, stock: Number(item.stock || 0) - required } : item;
  });
  return {
    state: {
      ...state,
      inventory: updatedInventory,
      stockMovements: [...movements, ...records(state.stockMovements)],
      workerConsumptions: [entry, ...records(state.workerConsumptions)],
    },
    result: { entry, alreadySaved: false },
  };
}

function removeOwnedWorkerConsumption(
  state: JsonRecord,
  recordIdInput: string,
  worker: WorkerConsumptionActor,
) {
  const recordId = cleanText(recordIdInput, 160);
  const entries = records(state.workerConsumptions);
  const entry = entries.find((candidate) => String(candidate.id || "") === recordId);
  if (!entry) throw new WorkerConsumptionError("Yeyilgan yoki minus yozuvi topilmadi.", 404);
  if (cleanText(entry.workerId, 100) !== cleanText(worker.id, 100)) {
    throw new WorkerConsumptionError("Faqat o‘zingiz kiritgan yozuvni o‘zgartira olasiz.", 403);
  }
  if (isAccountingMonthClosed(state.monthlyCloses, entry.date)) {
    throw new WorkerConsumptionError("Yopilgan oydagi yeyilgan yoki chiqit yozuvini o‘zgartirib bo‘lmaydi.", 409);
  }

  const movements = records(state.stockMovements);
  const linkedMovements = movements.filter((movement) => String(movement.referenceId || "") === recordId);
  const movementIds = new Set((Array.isArray(entry.movementIds) ? entry.movementIds : [])
    .map((value) => cleanText(value, 160))
    .filter(Boolean));
  const restored = new Map<string, number>();
  if (linkedMovements.length) {
    linkedMovements.forEach((movement) => {
      const inventoryId = cleanText(movement.inventoryId, 100);
      const quantity = Number(movement.quantity);
      if (inventoryId && Number.isFinite(quantity) && quantity < 0) {
        restored.set(inventoryId, (restored.get(inventoryId) || 0) + Math.abs(quantity));
      }
    });
  } else {
    records(entry.ingredientUsage).forEach((usage) => {
      const inventoryId = cleanText(usage.inventoryId, 100);
      const quantity = Number(usage.deductedQuantity ?? usage.quantity);
      if (inventoryId && Number.isFinite(quantity) && quantity > 0) {
        restored.set(inventoryId, (restored.get(inventoryId) || 0) + quantity);
      }
    });
  }

  return {
    entry,
    state: {
      ...state,
      inventory: records(state.inventory).map((item) => {
        const quantity = restored.get(String(item.id || "")) || 0;
        return quantity > 0 ? { ...item, stock: Number(item.stock || 0) + quantity } : item;
      }),
      stockMovements: movements.filter((movement) => (
        String(movement.referenceId || "") !== recordId
        && !movementIds.has(String(movement.id || ""))
      )),
      workerConsumptions: entries.filter((candidate) => String(candidate.id || "") !== recordId),
    },
  };
}

function reusableWorkerConsumptionOperationId(entry: JsonRecord) {
  const saved = cleanText(entry.operationId, 100);
  if (validOperationId(saved)) return saved;
  const fromId = cleanText(entry.id, 160).replace("worker-consumption:", "");
  return validOperationId(fromId) ? fromId : `edit-${crypto.randomUUID()}`;
}

export function editWorkerConsumption(
  state: JsonRecord,
  input: WorkerConsumptionEditInput,
  worker: WorkerConsumptionActor,
  updatedAt = new Date().toISOString(),
) {
  const removed = removeOwnedWorkerConsumption(state, input.recordId, worker);
  const createdAt = Number.isFinite(Date.parse(String(removed.entry.createdAt || "")))
    ? String(removed.entry.createdAt)
    : updatedAt;
  const reapplied = applyWorkerConsumption(removed.state, {
    ...input,
    operationId: reusableWorkerConsumptionOperationId(removed.entry),
  }, worker, createdAt, removed.entry);
  const entry = {
    ...reapplied.result.entry,
    createdAt,
    updatedAt,
    editedAt: updatedAt,
    editedByWorkerId: cleanText(worker.id, 100),
    editedByWorkerName: cleanText(worker.name, 80) || "Xodim",
  };
  return {
    state: {
      ...reapplied.state,
      workerConsumptions: records(reapplied.state.workerConsumptions).map((candidate) => (
        String(candidate.id || "") === String(reapplied.result.entry.id || "") ? entry : candidate
      )),
    },
    result: { entry, previousId: cleanText(input.recordId, 160) },
  };
}

export function deleteWorkerConsumption(
  state: JsonRecord,
  recordId: string,
  worker: WorkerConsumptionActor,
) {
  const removed = removeOwnedWorkerConsumption(state, recordId, worker);
  return { state: removed.state, result: { deleted: removed.entry } };
}
