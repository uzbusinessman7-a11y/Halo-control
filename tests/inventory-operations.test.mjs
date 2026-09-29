import assert from "node:assert/strict";
import test from "node:test";

import {
  InventoryOperationError,
  saveInventoryCount,
  saveInventoryMovement,
} from "../app/lib/inventory-operations.ts";

const state = () => ({
  inventory: [{
    id: "baget",
    name: "BAGET NON",
    unit: "dona",
    stock: 38,
    minStock: 10,
    unitCost: 1_500,
    packageName: "birlik",
    unitsPerPackage: 1,
    packageCost: 1_500,
    gramsPerUnit: 0,
    supplierId: "",
  }],
  stockMovements: [],
  suppliers: [],
});

test("100 baguettes are received atomically", () => {
  const result = saveInventoryMovement(state(), {
    movement: {
      id: "mov-baget-100",
      inventoryId: "baget",
      type: "receipt",
      quantity: 100,
      unitCost: 1_500,
      date: "2026-09-07",
      note: "Kirim",
    },
  });
  assert.equal(result.state.inventory[0].stock, 138);
  assert.equal(result.state.stockMovements[0].quantity, 100);
  assert.equal(result.result.stock, 138);
});

test("a repeated movement id cannot add stock twice", () => {
  const first = saveInventoryMovement(state(), {
    movement: {
      id: "mov-baget-repeat",
      inventoryId: "baget",
      type: "receipt",
      quantity: 100,
      date: "2026-09-07",
      note: "Kirim",
    },
  });
  const repeated = saveInventoryMovement(first.state, {
    movement: {
      id: "mov-baget-repeat",
      inventoryId: "baget",
      type: "receipt",
      quantity: 100,
      date: "2026-09-07",
      note: "Kirim",
    },
  });
  assert.equal(repeated.state.inventory[0].stock, 138);
  assert.equal(repeated.state.stockMovements.length, 1);
  assert.equal(repeated.result.alreadySaved, true);
});

test("physical count writes only the difference", () => {
  const result = saveInventoryCount(state(), {
    operationId: "inventory-count-test",
    date: "2026-09-07",
    counts: [{ inventoryId: "baget", actualStock: 31 }],
  });
  assert.equal(result.state.inventory[0].stock, 31);
  assert.equal(result.state.stockMovements[0].quantity, -7);
  assert.equal(result.state.stockMovements[0].referenceId, "inventory-count:inventory-count-test");
  assert.equal(result.result.changed, 1);
});

test("physical count rejects negative actual stock", () => {
  assert.throws(() => saveInventoryCount(state(), {
    operationId: "inventory-count-negative",
    date: "2026-09-07",
    counts: [{ inventoryId: "baget", actualStock: -1 }],
  }), InventoryOperationError);
});
