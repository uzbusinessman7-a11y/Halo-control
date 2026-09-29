import { normalizeDeliveryPlatformPrices, isDeliveryPlatform, emptyDeliveryManualFees, deliveryAutomaticManualFees, deliveryFeeRuleForPlatform, calculateDeliveryManualFees, validDeliveryManualFees, allocateDeliveryFeeBreakdown, type DeliveryPlatform } from "./delivery-sales.ts";
import { isExpenseOnlyInventory } from './vegetable-expenses.ts';
import { calculateRecipeCostBreakdown } from "./recipe-costing.ts";
import { seoulBusinessDate } from "./business-time.ts";
import {
  applyWorkerConsumption,
  isKitchenConsumptionEntry,
  WorkerConsumptionError,
} from "./worker-consumptions.ts";
import { ensureMenuCodes } from "./menu-codes.ts";
import { missingRecipeIngredient } from "./recipe-availability.ts";
import { isAccountingMonthClosed } from "./month-end.ts";
import { snapshotSaleFinancialRates } from "./sale-financial-snapshots.ts";
import { applySaleInventoryAccounting } from './inventory-accounting.ts';

type JsonRecord = Record<string, unknown>;

export type PosPaymentType = "cash" | "card" | "bank" | "delivery";
export type PosOrderStatus = "new" | "preparing" | "done";

export type PosOrderInput = {
  operationId: string;
  date?: string;
  mode?: "sale" | "inventory_only";
  paymentType?: PosPaymentType;
  deliveryPlatform?: DeliveryPlatform;
  deliveryOrderNumber?: string;
  deliveryFeesWon?: Record<string, unknown>;
  expectedTotal?: number;
  inventoryReason?: string;
  items: Array<{ recipeId: string; quantity: number }>;
  note?: string;
};

export type PosRecordType = "sale" | "inventory_only";

export type PosRecordEditInput = PosOrderInput & {
  recordId: string;
  recordType: PosRecordType;
};

type PosMutationResult = {
  order?: JsonRecord;
  inventoryOutflow?: JsonRecord;
  alreadySaved: boolean;
};

export class PosTerminalError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PosTerminalError";
    this.status = status;
  }
}

const records = (value: unknown) => Array.isArray(value) ? value as JsonRecord[] : [];
const cleanText = (value: unknown, limit: number) => String(value || "").trim().slice(0, limit);
const money = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

function validIsoDate(value: unknown) {
  return Number.isFinite(Date.parse(String(value || "")));
}

function restoreInventory(
  inventory: JsonRecord[],
  quantities: Map<string, number>,
) {
  return inventory.map((item) => {
    const restored = quantities.get(String(item.id || "")) || 0;
    return restored > 0 ? { ...item, stock: Number(item.stock || 0) + restored } : item;
  });
}

type RemovalUsage = { inventoryId: string; quantity: number; referenceId?: string };

function removalQuantities(
  movements: JsonRecord[],
  referenceIds: Set<string>,
  fallbackUsage: RemovalUsage[],
) {
  const restored = new Map<string, number>();
  const movementReferences = new Set<string>();
  movements.forEach((movement) => {
    const referenceId = cleanText(movement.referenceId, 160);
    if (!referenceIds.has(referenceId)) return;
    const inventoryId = cleanText(movement.inventoryId, 100);
    const quantity = Number(movement.quantity);
    movementReferences.add(referenceId);
    if (!inventoryId || !Number.isFinite(quantity) || quantity >= 0) return;
    restored.set(inventoryId, (restored.get(inventoryId) || 0) + Math.abs(quantity));
  });
  fallbackUsage.forEach((usage) => {
    if (!usage.inventoryId || usage.quantity <= 0 || movementReferences.has(usage.referenceId || "")) return;
    restored.set(usage.inventoryId, (restored.get(usage.inventoryId) || 0) + usage.quantity);
  });
  return restored;
}

function removeEditableSale(state: JsonRecord, orderIdInput: string) {
  const orderId = cleanText(orderIdInput, 160);
  const orders = records(state.posOrders);
  const order = orders.find((entry) => String(entry.id || "") === orderId);
  if (!order || !orderId.startsWith("pos-order:")) throw new PosTerminalError("Savdo yozuvi topilmadi.", 404);
  if (!["cash", "bank"].includes(String(order.paymentType || ""))) {
    throw new PosTerminalError("Faqat naqd yoki hisob-raqam savdosini o‘zgartirish mumkin.", 403);
  }
  if (cleanText(order.workerId, 100) !== "pos-terminal") {
    throw new PosTerminalError("Faqat HALO HISOB oynasidan kiritilgan savdoni o‘zgartirish mumkin.", 403);
  }
  if (isAccountingMonthClosed(state.monthlyCloses, order.date)) {
    throw new PosTerminalError("Yopilgan oydagi savdoni tahrirlash yoki o‘chirish mumkin emas.", 409);
  }
  const saleIds = new Set(records(order.items).map((item) => cleanText(item.saleId, 160)).filter(Boolean));
  if (!saleIds.size) throw new PosTerminalError("Savdo tarkibi topilmadi.", 409);
  const sales = records(state.sales);
  const linkedSales = sales.filter((sale) => saleIds.has(String(sale.id || "")));
  const fallbackUsage: RemovalUsage[] = linkedSales.flatMap((sale) => records(sale.stockUsage).flatMap((usage) => {
    const inventoryId = cleanText(usage.inventoryId, 100);
    const quantity = Number(usage.deductedQuantity ?? usage.quantity);
    return inventoryId && Number.isFinite(quantity) && quantity > 0
      ? [{ inventoryId, quantity, referenceId: cleanText(sale.id, 160) }]
      : [];
  }));
  const movements = records(state.stockMovements);
  const restored = removalQuantities(movements, saleIds, fallbackUsage);
  return {
    order,
    state: {
      ...state,
      inventory: restoreInventory(records(state.inventory), restored),
      sales: sales.filter((sale) => !saleIds.has(String(sale.id || ""))),
      stockMovements: movements.filter((movement) => !saleIds.has(String(movement.referenceId || ""))),
      posOrders: orders.filter((entry) => String(entry.id || "") !== orderId),
    },
  };
}

function removeEditableKitchenOutflow(state: JsonRecord, entryIdInput: string) {
  const entryId = cleanText(entryIdInput, 160);
  const entries = records(state.workerConsumptions);
  const entry = entries.find((candidate) => String(candidate.id || "") === entryId);
  if (!entry) throw new PosTerminalError("Yeyilgan mahsulot yozuvi topilmadi.", 404);
  if (!isKitchenConsumptionEntry(entry)) {
    throw new PosTerminalError("Bu oynada faqat oshxonada yeyilgan mahsulot o‘zgartiriladi.", 403);
  }
  if (cleanText(entry.workerId, 100) !== "pos-terminal") {
    throw new PosTerminalError("Xodim kiritgan yozuv faqat o‘sha xodim akkauntidan o‘zgartiriladi.", 403);
  }
  if (isAccountingMonthClosed(state.monthlyCloses, entry.date)) {
    throw new PosTerminalError("Yopilgan oydagi yeyilgan mahsulot yozuvini o‘zgartirib bo‘lmaydi.", 409);
  }
  const referenceIds = new Set([entryId]);
  const fallbackUsage: RemovalUsage[] = records(entry.ingredientUsage).flatMap((usage) => {
    const inventoryId = cleanText(usage.inventoryId, 100);
    const quantity = Number(usage.deductedQuantity ?? usage.quantity);
    return inventoryId && Number.isFinite(quantity) && quantity > 0
      ? [{ inventoryId, quantity, referenceId: entryId }]
      : [];
  });
  const movements = records(state.stockMovements);
  const movementIds = new Set((Array.isArray(entry.movementIds) ? entry.movementIds : [])
    .map((value) => cleanText(value, 160))
    .filter(Boolean));
  const restored = removalQuantities(movements, referenceIds, fallbackUsage);
  return {
    entry,
    state: {
      ...state,
      inventory: restoreInventory(records(state.inventory), restored),
      stockMovements: movements.filter((movement) => (
        String(movement.referenceId || "") !== entryId
        && !movementIds.has(String(movement.id || ""))
      )),
      workerConsumptions: entries.filter((candidate) => String(candidate.id || "") !== entryId),
    },
  };
}

function validOperationId(value: string) {
  return /^[a-zA-Z0-9_-]{10,100}$/.test(value);
}

function orderNumberForDate(orders: JsonRecord[], date: string) {
  return orders.reduce((highest, order) => {
    if (String(order.date || "") !== date) return highest;
    const number = Number(order.orderNumber || 0);
    return Number.isInteger(number) ? Math.max(highest, number) : highest;
  }, 0) + 1;
}

export function buildPosTerminalView(state: JsonRecord) {
  const recipes = ensureMenuCodes(records(state.recipes).map((recipe) => ({
    ...recipe,
    id: cleanText(recipe.id, 100),
  })) as Array<JsonRecord & { id: string }>);
  const catalog = recipes.flatMap((recipe) => {
    const id = cleanText(recipe.id, 100);
    const name = cleanText(recipe.name, 120);
    if (!id || !name) return [];
    return [{
      id,
      name,
      posCode: cleanText(recipe.posCode, 100),
      categoryId: cleanText(recipe.categoryId, 100),
      salePrice: money(recipe.salePrice),
      deliveryPrices: normalizeDeliveryPlatformPrices(recipe.deliveryPrices),
    }];
  });
  const orders = records(state.posOrders)
    .slice()
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, 120)
    .flatMap((order) => {
      if(order.paymentType==='delivery') {
        const linked=records(state.sales).filter(s=>s.deliveryBatchId===order.id && !s.cancelledAt && !s.voided);
        if(!linked.length)return [];
        return [{...order,editable:false,total:linked.reduce((sum,s)=>sum+Number(s.totalRevenue||0),0),items:linked.map(s=>({id:s.id,saleId:s.id,recipeId:s.recipeId,name:recipes.find(r=>r.id===s.recipeId)?.name||'Taom',quantity:s.quantity,unitPrice:s.unitPrice,total:s.totalRevenue}))}];
      }
      return [{...order,editable:cleanText(order.workerId,100)==='pos-terminal' && ['cash','bank'].includes(String(order.paymentType||''))}];
    });
  const inventoryOutflows = records(state.workerConsumptions)
    .filter((entry) => entry.kind === "inventory_only" || entry.kind === "meal")
    .slice()
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, 30)
    .map((entry) => {
      const items = records(entry.items).flatMap((item) => {
        const recipeId = cleanText(item.recipeId, 100);
        const name = cleanText(item.name, 120);
        const quantity = money(item.quantity);
        return recipeId && name && quantity > 0 ? [{ recipeId, name, quantity }] : [];
      });
      const stockShortages = records(entry.stockShortages).flatMap((shortage) => {
        const inventoryId = cleanText(shortage.inventoryId, 100);
        const name = cleanText(shortage.name, 120);
        const unit = cleanText(shortage.unit, 30);
        const quantity = money(shortage.quantity);
        return inventoryId && quantity > 0 ? [{ inventoryId, name, unit, quantity }] : [];
      });
      return {
        id: cleanText(entry.id, 140),
        kind: cleanText(entry.kind, 30),
        recipeId: cleanText(entry.recipeId, 100),
        label: cleanText(entry.label, 120),
        quantity: money(entry.quantity),
        unit: cleanText(entry.unit, 30),
        reason: cleanText(entry.reason, 120),
        outflowCategory: cleanText(entry.outflowCategory, 40),
        isKitchenConsumption: isKitchenConsumptionEntry(entry),
        note: cleanText(entry.note, 240),
        workerName: cleanText(entry.workerName, 80),
        date: cleanText(entry.date, 10),
        createdAt: cleanText(entry.createdAt, 40),
        updatedAt: cleanText(entry.updatedAt, 40),
        editedAt: cleanText(entry.editedAt, 40),
        editable: cleanText(entry.workerId, 100) === "pos-terminal" && isKitchenConsumptionEntry(entry),
        ...(items.length ? { items } : {}),
        ...(stockShortages.length ? { stockShortages } : {}),
      };
    });
  return {
    productCategories: records(state.productCategories)
      .filter((entry) => entry.kind === "recipe")
      .map((entry) => ({ id: entry.id, name: entry.name, sortOrder: entry.sortOrder })),
    catalog,
    orders,
    inventoryOutflows,
  };
}

export function applyPosOrder(
  state: JsonRecord,
  input: PosOrderInput,
  worker: { id: string; name: string },
  createdAt = new Date().toISOString(),
): { state: JsonRecord; result: PosMutationResult } {
  const today = seoulBusinessDate(new Date(createdAt));
  const date = input.date === undefined ? today : String(input.date).trim();
  const parsedDate = new Date(`${date}T12:00:00+09:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || seoulBusinessDate(parsedDate) !== date || date > today) {
    throw new PosTerminalError("Sanani tekshiring. Bugungi yoki oldingi kunni tanlang.");
  }
  if (input.mode === "inventory_only") {
    const previous = records(state.workerConsumptions).find(entry => entry.id === `worker-consumption:${input.operationId}`);
    if (input.date !== undefined && previous && previous.date !== date) throw new PosTerminalError("Bu amal boshqa sana bilan saqlangan.", 409);
    try {
      const result = applyWorkerConsumption(state, {
        operationId: input.operationId,
        kind: "inventory_only",
        items: input.items,
        date,
        reason: cleanText(input.inventoryReason, 120) || "Oshxonada yeyilgan ovqat",
        note: input.note,
      }, worker, createdAt);
      return {
        state: result.state,
        result: {
          inventoryOutflow: result.result.entry,
          alreadySaved: result.result.alreadySaved,
        },
      };
    } catch (error) {
      if (error instanceof WorkerConsumptionError) {
        throw new PosTerminalError(error.message, error.status);
      }
      throw error;
    }
  }
  const operationId = cleanText(input.operationId, 100);
  if (!validOperationId(operationId)) throw new PosTerminalError("Amal identifikatori noto‘g‘ri.");
  const orderId = `pos-order:${operationId}`;
  const orders = records(state.posOrders);
  const existing = orders.find((order) => String(order.id || "") === orderId);
  if (existing) {
    if (input.date !== undefined && existing.date !== date) throw new PosTerminalError("Bu amal boshqa sana bilan saqlangan.", 409);
    if(existing.deliveryRequestKey && existing.deliveryRequestKey!==JSON.stringify([input.paymentType,input.deliveryPlatform,input.items]))throw new PosTerminalError('Bu amal boshqa buyurtma bilan saqlangan. Tarixni tekshiring.',409);
    return { state, result: { order: existing, alreadySaved: true } };
  }
  const delivery=input.paymentType==='delivery';
  const platform=input.deliveryPlatform;
  const suppliedDeliveryNumber=cleanText(input.deliveryOrderNumber,64).toUpperCase();
  const deliveryNumber=suppliedDeliveryNumber || `HALO-${operationId.slice(-8).toUpperCase()}`;
  if(delivery && (!isDeliveryPlatform(platform) || String(input.deliveryOrderNumber || '').trim().length>64))throw new PosTerminalError('Delivery platformasini tanlang.');
  if(delivery && records(state.sales).some(s=>s.source==='delivery' && s.deliveryPlatform===platform && String(s.deliveryOrderNumber||'').toUpperCase()===deliveryNumber && s.date===date && !s.cancelledAt && !s.voided))throw new PosTerminalError('Bu platformadagi buyurtma tanlangan sanada oldin kiritilgan. Takror saqlanmadi.',409);

  if (!["cash", "card", "bank", "delivery"].includes(String(input.paymentType || ""))) throw new PosTerminalError("To‘lov turini tanlang.");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50) {
    throw new PosTerminalError("Kamida bitta, ko‘pi bilan 50 tur taom tanlang.");
  }

  const combined = new Map<string, number>();
  for (const line of input.items) {
    const recipeId = cleanText(line?.recipeId, 100);
    const quantity = Number(line?.quantity);
    if (!recipeId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000) {
      throw new PosTerminalError("Taom sonini tekshiring.");
    }
    combined.set(recipeId, (combined.get(recipeId) || 0) + quantity);
  }

  const inventory = records(state.inventory);
  const inventoryById = new Map(inventory.map((entry) => [String(entry.id || ""), entry]));
  const recipesById = new Map(records(state.recipes).map((entry) => [String(entry.id || ""), entry]));
  const requirements = new Map<string, number>();
  const preparedItems: Array<{ recipe: JsonRecord; recipeId: string; quantity: number; unitPrice: number }> = [];
  for (const [recipeId, quantity] of combined) {
    const recipe = recipesById.get(recipeId);
    if (!recipe) throw new PosTerminalError("Taom topilmadi. Terminalni yangilang.", 404);
    const missingIngredient = missingRecipeIngredient(recipe, inventory);
    if (missingIngredient) {
      throw new PosTerminalError(
        `“${cleanText(recipe.name, 120)}” retseptidagi ombor mahsuloti topilmadi. Avval retseptni tuzating.`,
        409,
      );
    }
    const linkedIngredients = records(recipe.ingredients).filter((ingredient) => (
      cleanText(ingredient.inventoryId, 100) && inventoryById.has(cleanText(ingredient.inventoryId, 100))
    ));
    if (!linkedIngredients.length) {
      throw new PosTerminalError(`“${cleanText(recipe.name, 120)}” retsepti omborga bog‘lanmagan.`);
    }
    for (const ingredient of linkedIngredients) {
      const inventoryId = cleanText(ingredient.inventoryId, 100);
      const perItem = Number(ingredient.quantity);
      if (!Number.isFinite(perItem) || perItem <= 0) continue;
      requirements.set(inventoryId, (requirements.get(inventoryId) || 0) + perItem * quantity);
    }
    const unitPrice=delivery?normalizeDeliveryPlatformPrices(recipe.deliveryPrices)[platform!]:money(recipe.salePrice);
    if(delivery && !unitPrice)throw new PosTerminalError(`“${cleanText(recipe.name,120)}” uchun delivery narxi kiritilmagan. Rahbar narx belgilashi kerak.`,409);
    preparedItems.push({ recipe, recipeId, quantity, unitPrice:unitPrice! });
  }
  const allowsUnstockedSale = delivery || input.paymentType === "cash" || input.paymentType === "bank";
  for (const [inventoryId, required] of requirements) {
    const item = inventoryById.get(inventoryId)!;
    const stock = Number(item.stock || 0);
    if (!Number.isFinite(stock)) {
      throw new PosTerminalError(`${cleanText(item.name, 120) || "Mahsulot"} ombor qoldig‘i noto‘g‘ri.`);
    }
    if (!isExpenseOnlyInventory(item) && !allowsUnstockedSale && stock + 0.000001 < required) {
      throw new PosTerminalError(
        `${cleanText(item.name, 120) || "Mahsulot"} yetmaydi: kerak ${required.toLocaleString("uz-UZ")} ${cleanText(item.unit, 30)}, omborda ${Math.max(0, stock).toLocaleString("uz-UZ")} ${cleanText(item.unit, 30)}.`,
        409,
      );
    }
  }

  let deliveryFees=emptyDeliveryManualFees();
  const gross=preparedItems.reduce((sum,p)=>sum+p.unitPrice*p.quantity,0);
  if(delivery){
    if(input.expectedTotal!==undefined && input.expectedTotal!==gross)throw new PosTerminalError('Delivery narxi o‘zgargan. Sahifani yangilab, jami summani tekshiring.',409);
    deliveryFees = deliveryAutomaticManualFees(deliveryFeeRuleForPlatform(state.costRules as Parameters<typeof deliveryFeeRuleForPlatform>[0], platform!));
    if(!validDeliveryManualFees(deliveryFees,gross))throw new PosTerminalError('Delivery ushlanmalarini tekshiring.');
  }
  const allocated=allocateDeliveryFeeBreakdown(preparedItems.map(p=>p.quantity*p.unitPrice),calculateDeliveryManualFees(gross,deliveryFees));
  const accountType = input.paymentType as PosPaymentType;
  const account = records(state.accounts).find((entry) => String(entry.type || "") === accountType);
  if (!account) throw new PosTerminalError(
    accountType === "delivery" ? "Delivery hisobi topilmadi. Rahbarga murojaat qiling." : accountType === "cash"
      ? "Naqd kassa topilmadi."
      : accountType === "bank"
        ? "Bank / hisob-raqam hisobi topilmadi."
        : "Karta / POS hisobi topilmadi.",
  );
  const accountId = cleanText(account.id, 100);
  if (isAccountingMonthClosed(state.monthlyCloses, date)) {
    throw new PosTerminalError(`${date.slice(0, 7)} oyi yopilgan. Savdoni ochiq oyga kiriting.`, 409);
  }
  const workerId = cleanText(worker.id, 100);
  const workerName = cleanText(worker.name, 80) || "Xodim";
  if (!workerId) throw new PosTerminalError("Xodim profili aniqlanmadi.", 401);

  const sales: JsonRecord[] = [];
  const movements: JsonRecord[] = [];
  const remainingStock = new Map(inventory.map((item) => [
    String(item.id || ""),
    Number(item.stock || 0),
  ]));
  const deductedStock = new Map<string, number>();
  const orderShortages = new Map<string, number>();
  const orderItems = preparedItems.map(({ recipe, recipeId, quantity, unitPrice }, itemIndex) => {
    const saleId = `pos-terminal-sale:${operationId}:${itemIndex}`;
    const usage = new Map<string, number>();
    for (const ingredient of records(recipe.ingredients)) {
      const inventoryId = cleanText(ingredient.inventoryId, 100);
      const required = Number(ingredient.quantity) * quantity;
      if (!inventoryId || !inventoryById.has(inventoryId) || !Number.isFinite(required) || required <= 0) continue;
      usage.set(inventoryId, (usage.get(inventoryId) || 0) + required);
    }
    const lineShortages: Array<{ inventoryId: string; name: string; unit: string; quantity: number }> = [];
    const stockUsage = [...usage].flatMap(([inventoryId, required]) => {
      const available = remainingStock.get(inventoryId) || 0;
      const deducted = required;
      const shortage = isExpenseOnlyInventory(inventoryById.get(inventoryId)) ? 0 : Math.max(0, required - Math.max(0, available));
      remainingStock.set(inventoryId, available - deducted);
      deductedStock.set(inventoryId, (deductedStock.get(inventoryId) || 0) + deducted);
      if (shortage > 0.000001) {
        const inventoryItem = inventoryById.get(inventoryId);
        lineShortages.push({
          inventoryId,
          name: cleanText(inventoryItem?.name, 120) || "Mahsulot",
          unit: cleanText(inventoryItem?.unit, 30),
          quantity: shortage,
        });
        orderShortages.set(inventoryId, (orderShortages.get(inventoryId) || 0) + shortage);
      }
      if (deducted <= 0.000001) return [];
      const unitCostAtSale = money(inventoryById.get(inventoryId)?.unitCost);
      return [{ inventoryId, quantity: deducted, unitCostAtSale, totalCostAtSale: deducted * unitCostAtSale }];
    });
    const totalCost = calculateRecipeCostBreakdown(
      records(recipe.ingredients).map((ingredient) => ({
        inventoryId: cleanText(ingredient.inventoryId, 100),
        quantity: Number(ingredient.quantity || 0),
        unitCost: money(ingredient.unitCost),
        lineCost: money(ingredient.lineCost),
      })),
      inventory.map((entry) => ({ ...entry, id: cleanText(entry.id, 100), unitCost: money(entry.unitCost) })),
      records(recipe.extraCosts).map((entry) => ({ amount: money(entry.amount) })),
    ).totalCost * quantity;
    sales.push(snapshotSaleFinancialRates({
      id: saleId,
      recipeId,
      quantity,
      unitPrice,
      totalRevenue: unitPrice * quantity,
      totalCost,
      date,
      source: delivery ? "delivery" : "pos",
      ...(delivery ? {deliveryPlatform:platform,deliveryOrderNumber:deliveryNumber,deliveryBatchId:orderId,deliveryCommissionAmount:allocated[itemIndex].total,deliveryCommissionPct:gross?calculateDeliveryManualFees(gross,deliveryFees).total/gross*100:0,deliveryFeeBreakdown:allocated[itemIndex],deliveryManualFees:deliveryFees,soldAt:date === today ? createdAt : date,createdAt,posOrderId:orderId} : {}),
      taxTreatment: "accountant_managed",
      externalId: `${orderId}:${itemIndex}`,
      stockUsage,
      ...(lineShortages.length ? { stockShortages: lineShortages } : {}),
      accountId,
    }, accountType, state.costRules as { cardCommissionPct?: unknown; taxPct?: unknown } | undefined));
    stockUsage.forEach((usageEntry, movementIndex) => movements.push({
      id: `pos-terminal-movement:${operationId}:${itemIndex}:${movementIndex}`,
      inventoryId: usageEntry.inventoryId,
      type: "sale",
      quantity: -usageEntry.quantity,
      date,
      note: `POS TERMINAL · ${cleanText(recipe.name, 120)} × ${quantity} · ${workerName}`,
      referenceId: saleId,
    }));
    return {
      id: `pos-order-line:${operationId}:${itemIndex}`,
      recipeId,
      name: cleanText(recipe.name, 120),
      quantity,
      unitPrice,
      total: unitPrice * quantity,
      saleId,
    };
  });
  const order = {
    id: orderId,
    operationId,
    orderNumber: orderNumberForDate(orders, date),
    date,
    paymentType: input.paymentType,
    ...(delivery?{deliveryPlatform:platform,deliveryOrderNumber:deliveryNumber,deliveryRequestKey:JSON.stringify([input.paymentType,input.deliveryPlatform,input.items])}:{}),
    accountId,
    status: "new",
    items: orderItems,
    total: orderItems.reduce((sum, item) => sum + item.total, 0),
    note: cleanText(input.note, 240),
    workerId,
    workerName,
    createdAt,
    updatedAt: createdAt,
    stockShortages: [...orderShortages].map(([inventoryId, quantity]) => {
      const inventoryItem = inventoryById.get(inventoryId);
      return {
        inventoryId,
        name: cleanText(inventoryItem?.name, 120) || "Mahsulot",
        unit: cleanText(inventoryItem?.unit, 30),
        quantity,
      };
    }),
  };

  return {
    state: applySaleInventoryAccounting(state, {
      ...state,
      inventory: inventory.map((item) => {
        const deducted = deductedStock.get(String(item.id || "")) || 0;
        return deducted ? { ...item, stock: Number(item.stock || 0) - deducted } : item;
      }),
      sales: [...sales, ...records(state.sales)],
      stockMovements: [...movements, ...records(state.stockMovements)],
      posOrders: [order, ...orders].slice(0, 5_000),
    }),
    result: { order, alreadySaved: false },
  };
}

function reusableOperationId(record: JsonRecord, prefix: string) {
  const saved = cleanText(record.operationId, 100);
  if (validOperationId(saved)) return saved;
  const fromId = cleanText(record.id, 160).replace(prefix, "");
  return validOperationId(fromId) ? fromId : `edit-${crypto.randomUUID()}`;
}

function originalRecordTime(record: JsonRecord, fallback: string) {
  if (validIsoDate(record.createdAt)) return String(record.createdAt);
  const date = cleanText(record.date, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T03:00:00.000Z` : fallback;
}

export function editPosRecord(
  state: JsonRecord,
  input: PosRecordEditInput,
  worker: { id: string; name: string },
  updatedAt = new Date().toISOString(),
) {
  const recordId = cleanText(input.recordId, 160);
  if (input.recordType === "sale") {
    if (!["cash", "bank"].includes(String(input.paymentType || ""))) {
      throw new PosTerminalError("To‘lov turini naqd yoki hisob-raqam qilib tanlang.");
    }
    const removed = removeEditableSale(state, recordId);
    const createdAt = originalRecordTime(removed.order, updatedAt);
    const operationId = reusableOperationId(removed.order, "pos-order:");
    const reapplied = applyPosOrder(removed.state, {
      operationId,
      date: cleanText(removed.order.date, 10) || undefined,
      mode: "sale",
      paymentType: input.paymentType,
      items: input.items,
      note: input.note,
    }, worker, createdAt);
    const generated = reapplied.result.order;
    if (!generated) throw new PosTerminalError("Savdo qayta hisoblanmadi.", 500);
    const savedPriceByRecipe = new Map(records(removed.order.items).flatMap((item) => {
      const recipeId = cleanText(item.recipeId, 100);
      const unitPrice = Number(item.unitPrice);
      return recipeId && Number.isFinite(unitPrice) && unitPrice >= 0 ? [[recipeId, unitPrice] as const] : [];
    }));
    const adjustedItems = records(generated.items).map((item) => {
      const recipeId = cleanText(item.recipeId, 100);
      const quantity = Number(item.quantity || 0);
      const unitPrice = savedPriceByRecipe.get(recipeId) ?? money(item.unitPrice);
      return { ...item, unitPrice, total: unitPrice * quantity };
    });
    const order = {
      ...generated,
      items: adjustedItems,
      total: adjustedItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
      orderNumber: Number(removed.order.orderNumber || generated.orderNumber || 0),
      createdAt,
      updatedAt,
      editedAt: updatedAt,
      editedByWorkerId: cleanText(worker.id, 100),
      editedByWorkerName: cleanText(worker.name, 80) || "Xodim",
    };
    const nextSaleIds = new Set(records(order.items).map((item) => cleanText(item.saleId, 160)).filter(Boolean));
    const saleValues = new Map(records(order.items).map((item) => [
      cleanText(item.saleId, 160),
      { unitPrice: Number(item.unitPrice || 0), totalRevenue: Number(item.total || 0) },
    ]));
    return {
      state: {
        ...reapplied.state,
        posOrders: records(reapplied.state.posOrders).map((entry) => (
          String(entry.id || "") === String(generated.id || "") ? order : entry
        )),
        sales: records(reapplied.state.sales).map((sale) => {
          const values = saleValues.get(String(sale.id || ""));
          return nextSaleIds.has(String(sale.id || "")) && values
            ? { ...sale, ...values, updatedAt, editedAt: updatedAt }
            : sale;
        }),
      },
      result: { order, inventoryOutflow: undefined, previousId: recordId },
    };
  }

  if (input.recordType === "inventory_only") {
    const removed = removeEditableKitchenOutflow(state, recordId);
    const createdAt = originalRecordTime(removed.entry, updatedAt);
    const operationId = reusableOperationId(removed.entry, "worker-consumption:");
    const reapplied = applyPosOrder(removed.state, {
      operationId,
      date: cleanText(removed.entry.date, 10) || undefined,
      mode: "inventory_only",
      inventoryReason: "Oshxonada yeyilgan ovqat",
      items: input.items,
      note: input.note,
    }, worker, createdAt);
    const generated = reapplied.result.inventoryOutflow;
    if (!generated) throw new PosTerminalError("Yeyilgan mahsulot qayta hisoblanmadi.", 500);
    const entry = {
      ...generated,
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
          String(candidate.id || "") === String(generated.id || "") ? entry : candidate
        )),
      },
      result: { order: undefined, inventoryOutflow: entry, previousId: recordId },
    };
  }

  throw new PosTerminalError("Tahrirlanadigan yozuv turi noto‘g‘ri.");
}

export function deletePosRecord(
  state: JsonRecord,
  recordType: PosRecordType,
  recordIdInput: string,
) {
  if (recordType === "sale") {
    const removed = removeEditableSale(state, recordIdInput);
    return { state: removed.state, result: { deleted: removed.order, recordType } };
  }
  if (recordType === "inventory_only") {
    const removed = removeEditableKitchenOutflow(state, recordIdInput);
    return { state: removed.state, result: { deleted: removed.entry, recordType } };
  }
  throw new PosTerminalError("O‘chiriladigan yozuv turi noto‘g‘ri.");
}

export function updatePosOrderStatus(
  state: JsonRecord,
  orderIdInput: string,
  status: PosOrderStatus,
  worker: { id: string; name: string },
  updatedAt = new Date().toISOString(),
) {
  const orderId = cleanText(orderIdInput, 140);
  if (!orderId.startsWith("pos-order:")) throw new PosTerminalError("Buyurtma topilmadi.", 404);
  if (!["new", "preparing", "done"].includes(status)) throw new PosTerminalError("Holat noto‘g‘ri.");
  let changedOrder: JsonRecord | undefined;
  const posOrders = records(state.posOrders).map((order) => {
    if (String(order.id || "") !== orderId) return order;
    if (String(order.status || "") === status) {
      changedOrder = order;
      return order;
    }
    if (isAccountingMonthClosed(state.monthlyCloses, order.date)) {
      throw new PosTerminalError("Yopilgan oydagi buyurtma holatini o‘zgartirib bo‘lmaydi.", 409);
    }
    const next = {
      ...order,
      status,
      updatedAt,
      updatedByWorkerId: cleanText(worker.id, 100),
      updatedByWorkerName: cleanText(worker.name, 80) || "Xodim",
      ...(status === "preparing" ? { acceptedAt: updatedAt } : {}),
      ...(status === "done" ? { completedAt: updatedAt } : {}),
    };
    changedOrder = next;
    return next;
  });
  if (!changedOrder) throw new PosTerminalError("Buyurtma topilmadi.", 404);
  return { state: { ...state, posOrders }, result: { order: changedOrder } };
}
