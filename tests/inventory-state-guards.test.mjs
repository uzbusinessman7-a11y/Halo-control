import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  preservesClosedMonthDatedRecords,
  preservesClosedMonthPurchaseOrderOrigins,
  preservesMonthCloseStockMovements,
} from "../app/lib/closed-month-guards.ts";
import {
  archiveInventoryProduct,
  archiveStockMovement,
  WarehouseDeletionError,
} from "../app/lib/inventory-deletions.ts";
import { validPurchaseOrderLifecycleLinks } from "../app/lib/purchase-order-validation.ts";

const monthlyCloses = [{ month: "2026-08" }];

const purchaseOrderState = ({
  orders,
  movements = [],
  transactions = [],
  finance = [],
  stock = 5,
  unitCost = 500,
  balance = 100,
  closes = monthlyCloses,
  inventoryRows,
  supplierRows,
  accountRows = [{ id: "bank" }],
}) => ({
  purchaseOrders: orders,
  stockMovements: movements,
  transactions,
  financialEntries: finance,
  inventory: inventoryRows ?? [{ id: "meat", stock, unitCost }],
  suppliers: supplierRows ?? [{ id: "supplier-a", balance }],
  accounts: accountRows,
  monthlyCloses: closes,
});

test("closed-month dated records reject additions, edits, deletions, and date moves", () => {
  const closed = { id: "closed", date: "2026-08-31", quantity: 1 };
  const open = { id: "open", date: "2026-09-01", quantity: 1 };
  const current = [closed, open];

  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, current, [...current].reverse()), true);
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, current, [open]), false);
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, current, [
    { ...closed, quantity: 2 }, open,
  ]), false);
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, current, [
    closed, { ...open, date: "2026-08-30" },
  ]), false, "an existing open entry cannot be moved into a closed month");
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, current, [
    { ...closed, date: "2026-09-02" }, open,
  ]), false, "a protected entry cannot be moved out of its closed month");
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, current, [
    closed, { ...open, quantity: 5 }, { id: "new-open", date: "2026-09-03" },
  ]), true, "open-month records remain editable");
});

test("payroll payments are frozen by actual cash date, not the salary month", () => {
  const paidAfterClose = {
    id: "august-salary-paid-in-september",
    month: "2026-08",
    date: "2026-09-02",
    staffId: "staff-a",
    amount: 100_000,
  };
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, [], [paidAfterClose]), true,
    "an August salary may be paid with cash in September after August is closed");
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, [paidAfterClose], [
    { ...paidAfterClose, amount: 110_000 },
  ]), true, "an open cash-date draft remains editable");

  const paidInClosedMonth = {
    id: "september-salary-paid-in-august",
    month: "2026-09",
    date: "2026-08-31",
    staffId: "staff-b",
    amount: 50_000,
  };
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, [paidInClosedMonth], [
    { ...paidInClosedMonth, month: "2026-08" },
  ]), false, "every field of a payment whose cash date is closed stays frozen");
  assert.equal(preservesClosedMonthDatedRecords(monthlyCloses, [paidAfterClose], [
    { ...paidAfterClose, date: "2026-08-30" },
  ]), false, "an open payment cannot be moved into a closed cash date");
});

test("closed purchase orders freeze origin terms but allow later lifecycle progress", () => {
  const order = {
    id: "order-august",
    supplierId: "supplier-a",
    status: "ordered",
    date: "2026-08-31",
    items: [{ inventoryId: "meat", quantity: 10, unitCost: 2_000 }],
    total: 20_000,
  };
  assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [order], [{
    ...order,
    status: "received",
    receivedAt: "2026-09-02T03:00:00.000Z",
  }]), true, "a closed-month order can be received in the next month");
  const received = {
    ...order,
    status: "received",
    receivedAt: "2026-09-02T03:00:00.000Z",
  };
  assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [received], [{
    ...received,
    status: "paid",
    paidAt: "2026-09-03T03:00:00.000Z",
    accountId: "bank",
  }]), true, "a received order can be paid in the next month");
  assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [order], [{
    ...order,
    status: "paid",
    receivedAt: "2026-09-02T03:00:00.000Z",
    paidAt: "2026-09-03T03:00:00.000Z",
    accountId: "bank",
  }]), false, "the guarded lifecycle cannot skip receipt");
  assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [received], [{
    ...received,
    status: "ordered",
  }]), false, "the guarded lifecycle cannot move backwards");
  assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [order], [{
    ...order,
    status: "cancelled",
    cancelReason: "Yetkazuvchi bekor qildi",
    cancelledAt: "2026-09-02T03:00:00.000Z",
    cancelledBy: "Rahbar",
  }]), true, "an unreceived order can be cancelled with an audit reason");
  assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [order], [{
    ...order,
    status: "cancelled",
  }]), false, "a cancellation without audit metadata is rejected");
  for (const edited of [
    { ...order, date: "2026-09-01" },
    { ...order, supplierId: "supplier-b" },
    { ...order, items: [{ ...order.items[0], quantity: 11 }] },
    { ...order, total: 22_000 },
  ]) {
    assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [order], [edited]), false);
  }
  assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [order], []), false);
  assert.equal(preservesClosedMonthPurchaseOrderOrigins(monthlyCloses, [], [{
    ...order,
    id: "new-order-in-closed-month",
  }]), false);
});

test("owner state save wires purchase-order origins and payroll cash dates into the closed-period guard", () => {
  const source = readFileSync(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  assert.match(source, /current:\s*current\.state\.payrollPayments,[\s\S]*?next:\s*body\.payrollPayments/);
  assert.doesNotMatch(source, /dateFields:\s*\["date", "month"\]/);
  assert.match(source, /preservesClosedMonthPurchaseOrderOrigins\([\s\S]*?current\.state\.purchaseOrders,[\s\S]*?body\.purchaseOrders/);
  assert.match(source, /section\.dateFields \|\| "date"/);
  assert.match(source, /validPurchaseOrderLifecycleLinks\(current\.state, body\)/);
});

test("purchase-order status requires matching open-period stock, supplier, and cash ledgers", () => {
  const ordered = {
    id: "order-links",
    supplierId: "supplier-a",
    status: "ordered",
    date: "2026-08-31",
    items: [{ inventoryId: "meat", quantity: 10, unitCost: 2_000 }],
    total: 20_000,
  };
  const received = { ...ordered, status: "received", receivedAt: "2026-09-02T03:00:00.000Z" };
  const movement = {
    id: "purchase-order-receipt:order-links:0",
    inventoryId: "meat",
    type: "receipt",
    quantity: 10,
    date: "2026-09-02",
    referenceId: "order-links",
  };
  const purchase = {
    id: "purchase-order-purchase:order-links",
    supplierId: "supplier-a",
    type: "purchase",
    amount: 20_000,
    date: "2026-09-02",
  };
  const orderedState = purchaseOrderState({ orders: [ordered] });
  const receivedState = purchaseOrderState({
    orders: [received], movements: [movement], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 20_100,
  });
  assert.equal(validPurchaseOrderLifecycleLinks(
    orderedState,
    purchaseOrderState({ orders: [received] }),
  ), false);
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, receivedState), true);
  assert.equal(validPurchaseOrderLifecycleLinks(
    purchaseOrderState({
      orders: [ordered],
      movements: [{ ...movement, type: "adjustment", referenceId: "some-other-source", quantity: -5 }],
    }),
    receivedState,
  ), false, "a receipt transition cannot overwrite an existing movement id");
  assert.equal(validPurchaseOrderLifecycleLinks(
    purchaseOrderState({
      orders: [ordered],
      transactions: [{ ...purchase, type: "payment", amount: 1 }],
    }),
    receivedState,
  ), false, "a receipt transition cannot overwrite an existing supplier-transaction id");
  const fractionalOrder = {
    ...ordered,
    id: "order-fractional",
    items: [{ inventoryId: "meat", quantity: 0.5, unitCost: 40_000 }],
  };
  const fractionalReceived = { ...fractionalOrder, status: "received", receivedAt: received.receivedAt };
  assert.equal(validPurchaseOrderLifecycleLinks(
    purchaseOrderState({ orders: [fractionalOrder] }),
    purchaseOrderState({
      orders: [fractionalReceived],
      movements: [{ ...movement, id: "purchase-order-receipt:order-fractional:0", referenceId: "order-fractional", quantity: 0.5 }],
      transactions: [{ ...purchase, id: "purchase-order-purchase:order-fractional" }],
      stock: 5.5,
      unitCost: 40_000,
      balance: 20_100,
    }),
  ), true, "fractional stock quantities remain valid while money stays whole-won exact");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [{ ...received, receivedAt: "2026-08-31T03:00:00.000Z" }],
    movements: [{ ...movement, date: "2026-08-31" }],
    transactions: [{ ...purchase, date: "2026-08-31" }],
    stock: 15,
    unitCost: 2_000,
    balance: 20_100,
  })), false, "a receipt cannot post into a closed month");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [received], movements: [movement], transactions: [purchase], stock: 5, unitCost: 2_000, balance: 20_100,
  })), false, "receipt rows without the real inventory delta are rejected");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [received], movements: [movement], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 100,
  })), false, "receipt rows without the real supplier-balance delta are rejected");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [received], movements: [movement], transactions: [purchase], stock: 15, unitCost: 9_999, balance: 20_100,
  })), false, "receipt rows cannot leave a false inventory unit cost");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [received], movements: [movement], transactions: [purchase], stock: 14.99999, unitCost: 2_000, balance: 20_100,
  })), false, "large quantities do not widen the fixed stock tolerance");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [received], movements: [{ ...movement, quantity: "10" }], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 20_100,
  })), false, "linked stock quantities must stay numeric");

  const paid = { ...received, status: "paid", paidAt: "2026-09-03T03:00:00.000Z", accountId: "bank" };
  const payment = {
    id: "purchase-order-payment:order-links",
    supplierId: "supplier-a",
    type: "payment",
    amount: 20_000,
    date: "2026-09-03",
    accountId: "bank",
  };
  const finance = {
    id: "purchase-order-finance:order-links",
    type: "expense",
    category: "Mahsulot xaridi",
    amount: 20_000,
    date: "2026-09-03",
    accountId: "bank",
    affectsProfit: false,
    transactionId: "purchase-order-payment:order-links",
  };
  const paidState = purchaseOrderState({
    orders: [paid], movements: [movement], transactions: [purchase, payment], finance: [finance], stock: 15, unitCost: 2_000, balance: 100,
  });
  assert.equal(validPurchaseOrderLifecycleLinks(receivedState, purchaseOrderState({
    orders: [paid], movements: [movement], transactions: [purchase, payment], stock: 15, unitCost: 2_000, balance: 100,
  })), false);
  assert.equal(validPurchaseOrderLifecycleLinks(receivedState, paidState), true);
  assert.equal(validPurchaseOrderLifecycleLinks(
    purchaseOrderState({
      orders: [received],
      movements: [movement],
      transactions: [purchase, { ...payment, amount: 1 }],
      stock: 15,
      unitCost: 2_000,
      balance: 20_100,
    }),
    paidState,
  ), false, "a payment transition cannot overwrite an existing payment id");
  assert.equal(validPurchaseOrderLifecycleLinks(
    purchaseOrderState({
      orders: [received],
      movements: [movement],
      transactions: [purchase],
      finance: [{ ...finance, type: "income", amount: 1 }],
      stock: 15,
      unitCost: 2_000,
      balance: 20_100,
    }),
    paidState,
  ), false, "a payment transition cannot overwrite an existing finance id");
  assert.equal(validPurchaseOrderLifecycleLinks(receivedState, purchaseOrderState({
    orders: [paid], movements: [movement], transactions: [purchase, { ...payment, amount: 19_000 }], finance: [finance], stock: 15, unitCost: 2_000, balance: 100,
  })), false);
  assert.equal(validPurchaseOrderLifecycleLinks(receivedState, purchaseOrderState({
    orders: [paid], movements: [movement], transactions: [purchase, payment], finance: [finance], stock: 15, unitCost: 2_000, balance: 20_100,
  })), false, "payment rows without the real supplier-balance delta are rejected");
  const ghostPaid = { ...paid, accountId: "ghost-account" };
  assert.equal(validPurchaseOrderLifecycleLinks(receivedState, purchaseOrderState({
    orders: [ghostPaid],
    movements: [movement],
    transactions: [purchase, { ...payment, accountId: "ghost-account" }],
    finance: [{ ...finance, accountId: "ghost-account" }],
    stock: 15,
    unitCost: 2_000,
    balance: 100,
  })), false, "a payment cannot use a nonexistent money account");
  const numericAccountPaid = { ...paid, accountId: 1 };
  assert.equal(validPurchaseOrderLifecycleLinks(receivedState, purchaseOrderState({
    orders: [numericAccountPaid],
    movements: [movement],
    transactions: [purchase, { ...payment, accountId: 1 }],
    finance: [{ ...finance, accountId: 1 }],
    stock: 15,
    unitCost: 2_000,
    balance: 100,
    accountRows: [{ id: "1" }],
  })), false, "numeric account references cannot masquerade as string ids");

  const septemberClosed = [...monthlyCloses, { month: "2026-09" }];
  const paidInOctober = {
    ...received,
    status: "paid",
    paidAt: "2026-10-02T03:00:00.000Z",
    accountId: "bank",
  };
  const octoberPayment = { ...payment, date: "2026-10-02" };
  const octoberFinance = { ...finance, date: "2026-10-02" };
  assert.equal(validPurchaseOrderLifecycleLinks(
    purchaseOrderState({
      orders: [received], movements: [movement], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 20_100, closes: septemberClosed,
    }),
    purchaseOrderState({
      orders: [paidInOctober], movements: [movement], transactions: [purchase, octoberPayment], finance: [octoberFinance], stock: 15, unitCost: 2_000, balance: 100, closes: septemberClosed,
    }),
  ), true, "a receipt stays valid after its month closes and can be paid in the next open month");

  const extraMovement = { ...movement, id: "extra-receipt", quantity: 999 };
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [received], movements: [movement, extraMovement], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 20_100,
  })), false, "extra linked stock cannot hide behind a valid receipt row");
  assert.equal(validPurchaseOrderLifecycleLinks(receivedState, purchaseOrderState({
    orders: [received], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 20_100,
  })), false, "a later save cannot delete a managed receipt movement");
  assert.equal(validPurchaseOrderLifecycleLinks(receivedState, purchaseOrderState({
    orders: [], movements: [movement], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 20_100,
  })), false, "a received order cannot be deleted");
  assert.equal(validPurchaseOrderLifecycleLinks(paidState, purchaseOrderState({
    orders: [paid], movements: [movement], transactions: [purchase, payment], stock: 15, unitCost: 2_000, balance: 100,
  })), false, "a later save cannot delete a managed payment finance row");
  const legacyReceived = purchaseOrderState({ orders: [received], stock: 15, unitCost: 2_000, balance: 20_100 });
  assert.equal(validPurchaseOrderLifecycleLinks(legacyReceived, legacyReceived), true,
    "an unchanged legacy row without deterministic links does not block unrelated saves");

  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered], movements: [movement], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 20_100,
  })), false, "order ledgers cannot be added without the matching status transition");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered], movements: [{ ...movement, id: "purchase-order-receipt:orphan:0", referenceId: "orphan" }], stock: 15,
  })), false, "orphan deterministic rows are rejected");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [received], movements: [movement, { ...movement }], transactions: [purchase], stock: 15, unitCost: 2_000, balance: 20_100,
  })), false, "duplicate deterministic row ids are rejected");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered, "broken"],
  })), false, "primitive purchase-order rows are rejected");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered, { id: "missing-fields", status: "ordered" }],
  })), false, "unserviceable purchase orders are rejected");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered, { ...ordered, id: "numeric-string", items: [{ ...ordered.items[0], quantity: "10" }] }],
  })), false, "numeric strings are not accepted as purchase-order numbers");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered, {
      ...ordered,
      id: "one-won-short",
      items: [{ ...ordered.items[0], quantity: 1, unitCost: 999_999_999 }],
      total: 1_000_000_000,
    }],
  })), false, "a one-won total mismatch is never treated as equal");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered], inventoryRows: [],
  })), false, "an ordered purchase keeps its previously valid inventory reference");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered], supplierRows: [],
  })), false, "an ordered purchase keeps its previously valid supplier reference");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered],
    inventoryRows: [{ id: "meat", stock: 5, unitCost: 500 }, { id: "meat", stock: 5, unitCost: 500 }],
  })), false, "duplicate referenced inventory ids are rejected");
  const legacyOrphan = purchaseOrderState({ orders: [ordered], inventoryRows: [], supplierRows: [] });
  assert.equal(validPurchaseOrderLifecycleLinks(legacyOrphan, purchaseOrderState({
    orders: [ordered],
    inventoryRows: [{ id: "meat", stock: 5, unitCost: 500 }, { id: "meat", stock: 5, unitCost: 500 }],
    supplierRows: [{ id: "supplier-a", balance: 100 }, { id: "supplier-a", balance: 100 }],
  })), false, "a grandfathered orphan cannot gain duplicate references");
  assert.equal(validPurchaseOrderLifecycleLinks(legacyOrphan, purchaseOrderState({
    orders: [ordered],
  })), true, "a grandfathered orphan may be repaired to one real reference");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered, { ...ordered, id: "ghost-supplier-order", supplierId: "ghost-supplier" }],
  })), false, "new orders require one real supplier and inventory record");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered, { ...ordered, id: "unsafe:order:id" }],
  })), false, "new order ids cannot collide with deterministic ledger namespaces");

  const legacyFractional = {
    ...ordered,
    id: "legacy-fractional",
    items: [{ inventoryId: "meat", quantity: 1.2, unitCost: 333 }],
    total: 1.2 * 333,
  };
  const legacyFractionalState = purchaseOrderState({ orders: [legacyFractional], balance: 2_344_753 });
  assert.equal(validPurchaseOrderLifecycleLinks(legacyFractionalState, legacyFractionalState), true,
    "a fractional total saved by the old UI does not block unrelated work");
  const legacyFractionalReceived = {
    ...legacyFractional,
    status: "received",
    receivedAt: received.receivedAt,
  };
  assert.equal(validPurchaseOrderLifecycleLinks(legacyFractionalState, purchaseOrderState({
    orders: [legacyFractionalReceived],
    movements: [{
      ...movement,
      id: "purchase-order-receipt:legacy-fractional:0",
      referenceId: "legacy-fractional",
      quantity: 1.2,
    }],
    transactions: [{
      ...purchase,
      id: "purchase-order-purchase:legacy-fractional",
      amount: legacyFractional.total,
    }],
    stock: 6.2,
    unitCost: 333,
    balance: 2_344_753 + legacyFractional.total,
  })), true, "an exact legacy fractional order can still be received safely");
  assert.equal(validPurchaseOrderLifecycleLinks(orderedState, purchaseOrderState({
    orders: [ordered, { ...legacyFractional, id: "new-fractional-total" }],
  })), false, "new orders always store a rounded whole-won total");

  const legacyBlankDate = { ...ordered, id: "legacy-blank-date", date: "" };
  const legacyBlankState = purchaseOrderState({ orders: [legacyBlankDate] });
  assert.equal(validPurchaseOrderLifecycleLinks(legacyBlankState, legacyBlankState), true,
    "an unchanged blank date from the old UI does not block unrelated saves");
  assert.equal(validPurchaseOrderLifecycleLinks(legacyBlankState, purchaseOrderState({
    orders: [{
      ...legacyBlankDate,
      status: "cancelled",
      cancelReason: "Eski yozuv yopildi",
      cancelledAt: "2026-09-04T03:00:00.000Z",
      cancelledBy: "Rahbar",
    }],
  })), true, "an invalid legacy order can still be safely cancelled with an audit reason");
});

test("month-close movements stay frozen while source workflows can update their own movements", () => {
  const inventory = [{
    id: "oil", name: "Moy", unit: "litr", stock: 10,
    unitCost: 1_000, packageCost: 1_000, unitsPerPackage: 1,
  }];
  const base = {
    inventory,
    purchaseOrders: [],
    supplierDeliveries: [],
    workerConsumptions: [{ id: "worker-consumption:operation-123" }],
    deletedItems: [],
  };
  const movement = {
    id: "worker-consumption-movement:operation-123:0",
    inventoryId: "oil",
    type: "waste",
    quantity: -1,
    date: "2026-09-01",
    note: "Yeyilgan",
    referenceId: "worker-consumption:operation-123",
  };
  assert.equal(preservesMonthCloseStockMovements([movement], [{ ...movement, quantity: -2 }]), true,
    "a coordinated worker-consumption edit remains possible");
  assert.equal(preservesMonthCloseStockMovements([movement], []), true,
    "a coordinated source deletion remains possible");
  const frozenMovement = {
    ...movement,
    id: "monthly-close:2026-08:inventory:oil",
    type: "adjustment",
    referenceId: "monthly-close:2026-08",
  };
  assert.equal(preservesMonthCloseStockMovements([frozenMovement], [frozenMovement]), true);
  assert.equal(preservesMonthCloseStockMovements([frozenMovement], [{ ...frozenMovement, quantity: -2 }]), false);
  assert.equal(preservesMonthCloseStockMovements([frozenMovement], []), false);
  assert.equal(preservesMonthCloseStockMovements([frozenMovement], [
    frozenMovement,
    { id: "manual", inventoryId: "oil", type: "waste", quantity: -1, date: "2026-09-01" },
  ]), true, "a new independent movement remains allowed");
  assert.throws(
    () => archiveStockMovement({ ...base, stockMovements: [movement] }, movement.id, "Xato"),
    (error) => error instanceof WarehouseDeletionError && /yeyilgan \/ chiqit yozuviga/.test(error.message),
  );
  assert.throws(
    () => archiveStockMovement({
      ...base,
      stockMovements: [{
        ...movement,
        id: "monthly-close:2026-08:inventory:oil",
        type: "adjustment",
        referenceId: "monthly-close:2026-08",
      }],
    }, "monthly-close:2026-08:inventory:oil", "Xato"),
    (error) => error instanceof WarehouseDeletionError && /Oy yakuni yozuviga/.test(error.message),
  );
  assert.throws(
    () => archiveStockMovement({
      ...base,
      stockMovements: [{
        ...movement,
        id: "refund-movement",
        type: "adjustment",
        referenceId: "refund-order-44",
      }],
    }, "refund-movement", "Xato"),
    (error) => error instanceof WarehouseDeletionError && /POS qaytaruvi yozuviga/.test(error.message),
  );

  const historicalMovement = {
    id: "manual-august-receipt",
    inventoryId: "oil",
    type: "receipt",
    quantity: 2,
    date: "2026-08-20",
    note: "Eski kirim",
  };
  const frozenState = {
    ...base,
    stockMovements: [historicalMovement],
    monthlyCloses: [{
      id: "monthly-close:2026-08",
      month: "2026-08",
      closedAt: "2026-09-01T00:00:00.000Z",
      closedBy: "Rahbar",
      inventoryItems: [],
      inventoryValue: 0,
      payrollItems: [],
      payrollGross: 0,
      payrollPaid: 0,
      payrollRemaining: 0,
    }],
  };
  assert.throws(
    () => archiveStockMovement(frozenState, historicalMovement.id, "Xato"),
    (error) => error instanceof WarehouseDeletionError && error.status === 409 && /Yopilgan oydagi/.test(error.message),
  );
  assert.throws(
    () => archiveInventoryProduct(frozenState, "oil", "Xato"),
    (error) => error instanceof WarehouseDeletionError && error.status === 409 && /yopilgan oy ombor tarixiga/.test(error.message),
  );

  const receivedPurchaseState = {
    ...base,
    stockMovements: [{ ...movement, type: "receipt", referenceId: "purchase-order-linked" }],
    purchaseOrders: [{
      id: "purchase-order-linked",
      supplierId: "supplier-a",
      status: "received",
      date: "2026-09-01",
      items: [{ inventoryId: "oil", quantity: 1, unitCost: 1_000 }],
      total: 1_000,
    }],
  };
  assert.throws(
    () => archiveInventoryProduct(receivedPurchaseState, "oil", "Xato"),
    (error) => error instanceof WarehouseDeletionError && error.status === 409 && /qabul qilingan xarid/.test(error.message),
  );
});
