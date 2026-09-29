import { seoulCalendarDate } from "./business-time.ts";

type JsonRecord = Record<string, unknown>;

const records = (value: unknown): JsonRecord[] => (Array.isArray(value)
  ? value.filter((entry): entry is JsonRecord => (
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
  ))
  : []);

const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : Number.NaN;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as JsonRecord;
    return `{${Object.keys(source)
      .filter((key) => source[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

const withoutKeys = (entry: JsonRecord, keys: readonly string[]) => Object.fromEntries(
  Object.entries(entry).filter(([key]) => !keys.includes(key)),
);

const validDate = (value: unknown) => {
  if (typeof value !== "string") return false;
  const date = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

const sameNumber = (left: unknown, right: unknown) => {
  const a = finite(left);
  const b = finite(right);
  return Number.isFinite(a) && Number.isFinite(b)
    && Math.abs(a - b) <= 0.000001;
};

const wholeWon = (value: unknown): value is number => (
  typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 1e15
);

function validPurchaseOrder(order: JsonRecord, strict = true) {
  const itemsValue = order.items;
  const items = records(itemsValue);
  const total = finite(order.total);
  if (
    typeof order.id !== "string" || !order.id.trim() || order.id.length > 160
    || (strict && !/^[A-Za-z0-9_-]+$/.test(order.id))
    || typeof order.supplierId !== "string" || !order.supplierId.trim() || order.supplierId.length > 160
    || typeof order.status !== "string" || !["ordered", "received", "paid", "cancelled"].includes(order.status)
    || (strict ? !validDate(order.date) : typeof order.date !== "string")
    || !Array.isArray(itemsValue) || !items.length
    || items.length !== itemsValue.length
    || (strict ? !wholeWon(order.total) : typeof order.total !== "number" || !Number.isFinite(total) || Math.abs(total) > 1e15)
    || total < 0
  ) return false;
  let calculatedTotal = 0;
  const itemIds = new Set<string>();
  for (const item of items) {
    const quantity = finite(item.quantity);
    const unitCost = finite(item.unitCost);
    const inventoryId = typeof item.inventoryId === "string" ? item.inventoryId.trim() : "";
    if (
      !inventoryId || inventoryId.length > 160 || itemIds.has(inventoryId)
      || typeof item.quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e12
      || typeof item.unitCost !== "number" || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1e12
    ) return false;
    itemIds.add(inventoryId);
    calculatedTotal += quantity * unitCost;
  }
  return Number.isFinite(calculatedTotal)
    && (strict ? total === Math.round(calculatedTotal) : sameNumber(total, calculatedTotal));
}

const isClosedDate = (monthlyCloses: unknown, date: string) => records(monthlyCloses).some((entry) => (
  /^\d{4}-(0[1-9]|1[0-2])$/.test(String(entry.month || ""))
  && String(entry.month) === date.slice(0, 7)
));

function eventDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? seoulCalendarDate(new Date(timestamp)) : "";
}

function sameMoney(left: unknown, right: unknown) {
  return typeof left === "number" && Number.isFinite(left) && Math.abs(left) <= 1e15
    && typeof right === "number" && Number.isFinite(right) && Math.abs(right) <= 1e15
    && left === right;
}

function validReceiptLinks(
  order: JsonRecord,
  movements: JsonRecord[],
  transactions: JsonRecord[],
  monthlyCloses: unknown,
  requireOpenDate = true,
) {
  const orderId = typeof order.id === "string" ? order.id : "";
  const supplierId = typeof order.supplierId === "string" ? order.supplierId : "";
  const date = eventDate(order.receivedAt);
  const items = records(order.items);
  const purchaseId = `purchase-order-purchase:${orderId}`;
  const purchases = transactions.filter((entry) => entry.id === purchaseId);
  const purchase = purchases[0];
  const linkedMovements = movements.filter((entry) => (
    entry.referenceId === orderId
  ));
  if (
    !orderId || !supplierId || !date || !items.length || (requireOpenDate && isClosedDate(monthlyCloses, date))
    || purchases.length !== 1 || !purchase || purchase.type !== "purchase"
    || typeof purchase.id !== "string" || typeof purchase.supplierId !== "string" || typeof purchase.date !== "string"
    || purchase.supplierId !== supplierId
    || purchase.date !== date
    || !sameMoney(purchase.amount, order.total)
    || linkedMovements.length !== items.length
  ) return false;

  return items.every((item, index) => {
    const matches = linkedMovements.filter((entry) => (
      entry.id === `purchase-order-receipt:${orderId}:${index}`
    ));
    const movement = matches[0];
    return Boolean(
      matches.length === 1 && movement
      && typeof movement.id === "string"
      && typeof movement.referenceId === "string"
      && typeof movement.inventoryId === "string"
      && typeof movement.date === "string"
      && movement.type === "receipt"
      && movement.referenceId === orderId
      && movement.inventoryId === item.inventoryId
      && movement.date === date
      && typeof movement.quantity === "number"
      && sameNumber(movement.quantity, item.quantity),
    );
  });
}

function validPaymentLinks(
  order: JsonRecord,
  transactions: JsonRecord[],
  financialEntries: JsonRecord[],
  monthlyCloses: unknown,
  requireOpenDate = true,
) {
  const orderId = typeof order.id === "string" ? order.id : "";
  const supplierId = typeof order.supplierId === "string" ? order.supplierId : "";
  const accountId = typeof order.accountId === "string" ? order.accountId : "";
  const date = eventDate(order.paidAt);
  const transactionId = `purchase-order-payment:${orderId}`;
  const payments = transactions.filter((entry) => entry.id === transactionId);
  const relatedFinance = financialEntries.filter((entry) => (
    entry.id === `purchase-order-finance:${orderId}`
    || entry.transactionId === transactionId
  ));
  const payment = payments[0];
  const finance = relatedFinance[0];
  return Boolean(
    orderId && supplierId && accountId && date && (!requireOpenDate || !isClosedDate(monthlyCloses, date))
    && payments.length === 1 && payment && payment.type === "payment"
    && typeof payment.id === "string" && typeof payment.supplierId === "string"
    && typeof payment.accountId === "string" && typeof payment.date === "string"
    && payment.supplierId === supplierId
    && payment.accountId === accountId
    && payment.date === date
    && sameMoney(payment.amount, order.total)
    && relatedFinance.length === 1 && finance
    && typeof finance.id === "string" && typeof finance.transactionId === "string"
    && typeof finance.accountId === "string" && typeof finance.date === "string"
    && finance.id === `purchase-order-finance:${orderId}`
    && finance.type === "expense" && finance.category === "Mahsulot xaridi"
    && finance.affectsProfit === false
    && finance.transactionId === transactionId
    && finance.accountId === accountId
    && finance.date === date
    && sameMoney(finance.amount, order.total),
  );
}

function validTransitionShape(current: JsonRecord, next: JsonRecord) {
  const currentStatus = String(current.status || "");
  const nextStatus = String(next.status || "");
  if (currentStatus === "ordered" && nextStatus === "received") {
    return canonicalJson(withoutKeys(current, ["status", "receivedAt"]))
      === canonicalJson(withoutKeys(next, ["status", "receivedAt"]));
  }
  if (currentStatus === "ordered" && nextStatus === "cancelled") {
    return canonicalJson(withoutKeys(current, ["status", "cancelReason", "cancelledAt", "cancelledBy"]))
      === canonicalJson(withoutKeys(next, ["status", "cancelReason", "cancelledAt", "cancelledBy"]));
  }
  if (currentStatus === "received" && nextStatus === "paid") {
    return canonicalJson(withoutKeys(current, ["status", "paidAt", "accountId"]))
      === canonicalJson(withoutKeys(next, ["status", "paidAt", "accountId"]));
  }
  return false;
}

const addDelta = (target: Map<string, number>, id: string, amount: number) => {
  target.set(id, (target.get(id) || 0) + amount);
};

const idIsUnused = (entries: JsonRecord[], id: string) => (
  !entries.some((entry) => entry.id === id)
);

function validMaterializedDelta(
  currentValue: unknown,
  nextValue: unknown,
  expected: Map<string, number>,
  field: "stock" | "balance",
) {
  const current = records(currentValue);
  const next = records(nextValue);
  for (const [id, delta] of expected) {
    const currentMatches = current.filter((entry) => String(entry.id || "") === id);
    const nextMatches = next.filter((entry) => String(entry.id || "") === id);
    if (
      currentMatches.length !== 1 || nextMatches.length !== 1
      || typeof currentMatches[0][field] !== "number"
      || typeof nextMatches[0][field] !== "number"
      || !sameNumber(finite(nextMatches[0][field]) - finite(currentMatches[0][field]), delta)
    ) return false;
  }
  return true;
}

type UnitCostEvent = { at: number; unitCost: number };

function validReceivedUnitCosts(
  currentValue: unknown,
  nextValue: unknown,
  events: Map<string, UnitCostEvent[]>,
) {
  const current = records(currentValue);
  const next = records(nextValue);
  for (const [id, rows] of events) {
    const currentMatches = current.filter((entry) => String(entry.id || "") === id);
    const nextMatches = next.filter((entry) => String(entry.id || "") === id);
    if (
      currentMatches.length !== 1 || nextMatches.length !== 1
      || typeof currentMatches[0].unitCost !== "number"
      || typeof nextMatches[0].unitCost !== "number"
    ) return false;
    let expected = finite(currentMatches[0].unitCost);
    if (!Number.isFinite(expected) || expected < 0) return false;
    for (const row of [...rows].sort((left, right) => left.at - right.at)) {
      if (row.unitCost > 0) expected = row.unitCost;
    }
    if (!sameNumber(nextMatches[0].unitCost, expected)) return false;
  }
  return true;
}

function sameRelevantRowsOutside(
  currentValue: unknown,
  nextValue: unknown,
  relevant: (entry: JsonRecord) => boolean,
  allowedIds: Set<string>,
) {
  const select = (value: unknown) => records(value)
    .filter(relevant)
    .filter((entry) => !allowedIds.has(String(entry.id || "")))
    .map(canonicalJson)
    .sort();
  const current = select(currentValue);
  const next = select(nextValue);
  return current.length === next.length && current.every((entry, index) => entry === next[index]);
}

function uniqueRelevantIds(value: unknown, relevant: (entry: JsonRecord) => boolean) {
  const ids = records(value).filter(relevant).map((entry) => String(entry.id || ""));
  return ids.every(Boolean) && new Set(ids).size === ids.length;
}

type PurchaseOrderState = {
  [key: string]: unknown;
  purchaseOrders?: unknown;
  stockMovements?: unknown;
  transactions?: unknown;
  financialEntries?: unknown;
  inventory?: unknown;
  suppliers?: unknown;
  accounts?: unknown;
  monthlyCloses?: unknown;
};

const idCounts = (value: unknown) => {
  const result = new Map<string, number>();
  records(value).forEach((entry) => {
    if (typeof entry.id !== "string" || !entry.id.trim()) return;
    result.set(entry.id, (result.get(entry.id) || 0) + 1);
  });
  return result;
};

const preservesKnownReference = (
  currentCounts: Map<string, number>,
  nextCounts: Map<string, number>,
  id: string,
) => {
  const current = currentCounts.get(id) || 0;
  const next = nextCounts.get(id) || 0;
  if (current === 0) return next <= 1;
  if (current === 1) return next === 1;
  return next === current || next === 1;
};

/**
 * Status is an accounting consequence, not a free-form label. A transition is
 * accepted only when the corresponding stock, supplier, and cash ledger rows
 * are included in the same atomic state write and use the real event date.
 */
export function validPurchaseOrderLifecycleLinks(
  currentStateValue: PurchaseOrderState,
  nextStateValue: PurchaseOrderState,
) {
  const currentOrdersValue = currentStateValue.purchaseOrders;
  const nextOrdersValue = nextStateValue.purchaseOrders;
  if (!Array.isArray(currentOrdersValue) || !Array.isArray(nextOrdersValue)) return false;
  const currentOrders = records(currentOrdersValue);
  const nextOrders = records(nextOrdersValue);
  if (
    currentOrders.length !== currentOrdersValue.length
    || nextOrders.length !== nextOrdersValue.length
  ) return false;
  const currentById = new Map(currentOrders.map((entry) => [String(entry.id || ""), entry]));
  const nextById = new Map(nextOrders.map((entry) => [String(entry.id || ""), entry]));
  if (
    currentById.size !== currentOrders.length || nextById.size !== nextOrders.length
    || currentOrders.some((entry) => typeof entry.id !== "string" || !entry.id)
    || nextOrders.some((entry) => {
      const current = currentById.get(typeof entry.id === "string" ? entry.id : "");
      if (current && canonicalJson(current) === canonicalJson(entry)) return false;
      if (validPurchaseOrder(entry, true)) return false;
      return !(current && validPurchaseOrder(current, false)
        && validPurchaseOrder(entry, false) && validTransitionShape(current, entry));
    })
  ) return false;
  const currentMovements = records(currentStateValue.stockMovements);
  const nextMovements = records(nextStateValue.stockMovements);
  const currentTransactions = records(currentStateValue.transactions);
  const nextTransactions = records(nextStateValue.transactions);
  const currentFinancialEntries = records(currentStateValue.financialEntries);
  const nextFinancialEntries = records(nextStateValue.financialEntries);
  const monthlyCloses = nextStateValue.monthlyCloses;
  const allowedMovementIds = new Set<string>();
  const allowedTransactionIds = new Set<string>();
  const allowedFinanceIds = new Set<string>();
  const expectedStockDelta = new Map<string, number>();
  const expectedSupplierDelta = new Map<string, number>();
  const receivedUnitCosts = new Map<string, UnitCostEvent[]>();
  const currentInventoryCounts = idCounts(currentStateValue.inventory);
  const nextInventoryCounts = idCounts(nextStateValue.inventory);
  const currentSupplierCounts = idCounts(currentStateValue.suppliers);
  const nextSupplierCounts = idCounts(nextStateValue.suppliers);
  const currentAccountCounts = idCounts(currentStateValue.accounts);
  const nextAccountCounts = idCounts(nextStateValue.accounts);

  for (const order of currentOrders) {
    if (nextById.has(String(order.id || ""))) continue;
    if (["received", "paid", "cancelled"].includes(String(order.status || ""))) return false;
  }

  for (const order of nextOrders) {
    const orderId = String(order.id || "");
    const current = currentById.get(orderId);
    const nextStatus = String(order.status || "");
    if (!orderId || !current) {
      if (
        !orderId || nextStatus !== "ordered"
        || nextSupplierCounts.get(String(order.supplierId || "")) !== 1
        || records(order.items).some((item) => nextInventoryCounts.get(String(item.inventoryId || "")) !== 1)
      ) return false;
      continue;
    }
    const currentStatus = String(current.status || "");
    const changedStatus = currentStatus !== nextStatus;
    if (nextStatus === "ordered") {
      const changedOrder = canonicalJson(current) !== canonicalJson(order);
      const supplierId = String(order.supplierId || "");
      const itemIds = records(order.items).map((item) => String(item.inventoryId || ""));
      if (
        (changedOrder && nextSupplierCounts.get(supplierId) !== 1)
        || (!changedOrder && !preservesKnownReference(currentSupplierCounts, nextSupplierCounts, supplierId))
        || itemIds.some((id) => (
          changedOrder
            ? nextInventoryCounts.get(id) !== 1
            : !preservesKnownReference(currentInventoryCounts, nextInventoryCounts, id)
        ))
      ) return false;
    }
    if (!changedStatus && currentStatus !== "ordered" && canonicalJson(current) !== canonicalJson(order)) return false;
    if (changedStatus && !validTransitionShape(current, order)) return false;
    if (changedStatus && currentStatus === "ordered" && nextStatus === "cancelled") {
      const cancelledDate = eventDate(order.cancelledAt);
      if (
        !cancelledDate || isClosedDate(monthlyCloses, cancelledDate)
        || !String(order.cancelReason || "").trim() || !String(order.cancelledBy || "").trim()
      ) return false;
    } else if (changedStatus && currentStatus === "ordered" && nextStatus === "received") {
      if (!validReceiptLinks(order, nextMovements, nextTransactions, monthlyCloses, true)) return false;
      const receiptIds = records(order.items).map((_, index) => `purchase-order-receipt:${orderId}:${index}`);
      const purchaseId = `purchase-order-purchase:${orderId}`;
      if (
        receiptIds.some((id) => !idIsUnused(currentMovements, id))
        || !idIsUnused(currentTransactions, purchaseId)
      ) return false;
      records(order.items).forEach((item, index) => {
        const inventoryId = String(item.inventoryId || "");
        allowedMovementIds.add(`purchase-order-receipt:${orderId}:${index}`);
        addDelta(expectedStockDelta, inventoryId, finite(item.quantity));
        const costEvents = receivedUnitCosts.get(inventoryId) || [];
        costEvents.push({ at: Date.parse(String(order.receivedAt || "")), unitCost: finite(item.unitCost) });
        receivedUnitCosts.set(inventoryId, costEvents);
      });
      allowedTransactionIds.add(`purchase-order-purchase:${orderId}`);
      addDelta(expectedSupplierDelta, String(order.supplierId || ""), finite(order.total));
    } else if (changedStatus && currentStatus === "received" && nextStatus === "paid") {
      const paymentId = `purchase-order-payment:${orderId}`;
      const financeId = `purchase-order-finance:${orderId}`;
      if (
        nextAccountCounts.get(String(order.accountId || "")) !== 1
        || !idIsUnused(currentTransactions, paymentId)
        || !idIsUnused(currentFinancialEntries, financeId)
        || !validPaymentLinks(order, nextTransactions, nextFinancialEntries, monthlyCloses, true)
      ) return false;
      allowedTransactionIds.add(paymentId);
      allowedFinanceIds.add(financeId);
      addDelta(expectedSupplierDelta, String(order.supplierId || ""), -finite(order.total));
    } else if (changedStatus) {
      return false;
    }

    if (["received", "paid"].includes(nextStatus)) {
      const currentReceiptIsManaged = ["received", "paid"].includes(currentStatus)
        && validReceiptLinks(current, currentMovements, currentTransactions, monthlyCloses, false);
      if (
        (changedStatus || currentReceiptIsManaged)
        && !validReceiptLinks(order, nextMovements, nextTransactions, monthlyCloses, false)
      ) return false;
    }
    if (nextStatus === "paid") {
      const currentPaymentIsManaged = currentStatus === "paid"
        && validPaymentLinks(current, currentTransactions, currentFinancialEntries, monthlyCloses, false);
      if (
        (changedStatus || currentPaymentIsManaged)
        && !validPaymentLinks(order, nextTransactions, nextFinancialEntries, monthlyCloses, false)
      ) return false;
      if (
        !changedStatus
        && !preservesKnownReference(
          currentAccountCounts,
          nextAccountCounts,
          String(order.accountId || ""),
        )
      ) return false;
    }
  }

  const orderIds = new Set([...currentOrders, ...nextOrders].map((entry) => String(entry.id || "")));
  const relevantMovement = (entry: JsonRecord) => (
    String(entry.id || "").startsWith("purchase-order-receipt:")
    || orderIds.has(String(entry.referenceId || ""))
  );
  const relevantTransaction = (entry: JsonRecord) => (
    /^purchase-order-(?:purchase|payment):/.test(String(entry.id || ""))
  );
  const relevantFinance = (entry: JsonRecord) => (
    String(entry.id || "").startsWith("purchase-order-finance:")
    || String(entry.transactionId || "").startsWith("purchase-order-payment:")
  );
  if (
    !uniqueRelevantIds(nextMovements, relevantMovement)
    || !uniqueRelevantIds(nextTransactions, relevantTransaction)
    || !uniqueRelevantIds(nextFinancialEntries, relevantFinance)
    || !sameRelevantRowsOutside(currentMovements, nextMovements, relevantMovement, allowedMovementIds)
    || !sameRelevantRowsOutside(currentTransactions, nextTransactions, relevantTransaction, allowedTransactionIds)
    || !sameRelevantRowsOutside(currentFinancialEntries, nextFinancialEntries, relevantFinance, allowedFinanceIds)
    || !validMaterializedDelta(currentStateValue.inventory, nextStateValue.inventory, expectedStockDelta, "stock")
    || !validMaterializedDelta(currentStateValue.suppliers, nextStateValue.suppliers, expectedSupplierDelta, "balance")
    || !validReceivedUnitCosts(currentStateValue.inventory, nextStateValue.inventory, receivedUnitCosts)
  ) return false;
  return true;
}
