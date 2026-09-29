import assert from "node:assert/strict";
import test from "node:test";

import {
  mezanaCatalogItemForAction,
  normalizeMezanaCatalog,
} from "../app/lib/mezana-catalog.ts";
import { safeStockDocumentKey } from "../app/lib/stock-documents.ts";
import {
  mezanaDebtBalance,
  mezanaDebtActionLabel,
  validMezanaDebtEntry,
} from "../app/lib/mezana-debts.ts";

const item = {
  id: `mezana-product:${"a".repeat(36)}`,
  name: "Sut",
  mode: "borrowed",
  price: 2_500,
  active: true,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

test("MEZANA catalog exposes only manager-approved products for the selected action", () => {
  const catalog = normalizeMezanaCatalog([item, { ...item }]);
  assert.equal(catalog.length, 1);
  assert.equal(mezanaCatalogItemForAction(catalog, item.id, "borrowed")?.name, "Sut");
  assert.equal(mezanaCatalogItemForAction(catalog, item.id, "returned")?.name, "Sut");
  assert.equal(mezanaCatalogItemForAction(catalog, item.id, "purchased"), null);
  assert.equal(mezanaCatalogItemForAction([{ ...item, active: false }], item.id, "borrowed"), null);
});

test("paid settlement keeps history and brings accumulated purchased debt to zero", () => {
  const entries = [
    { action: "purchased", amount: 8_900 },
    { action: "purchased", amount: 12_100 },
    { action: "paid", amount: 21_000 },
  ];
  assert.equal(mezanaDebtBalance(entries), 0);
  assert.equal(mezanaDebtActionLabel("paid"), "TO‘LIQ TO‘LANDI");
});

test("catalog-backed purchased entry keeps its price snapshot and item count", () => {
  assert.equal(validMezanaDebtEntry({
    id: `mezana:${"b".repeat(36)}`,
    action: "purchased",
    productName: "Kolbasa",
    amount: 27_000,
    catalogItemId: `mezana-product:${"c".repeat(36)}`,
    unitPrice: 9_000,
    itemCount: 3,
    date: "2026-09-14",
    note: "",
    documents: [],
    createdByWorkerId: "worker-1",
    createdByName: "Ali",
    createdAt: "2026-09-14T00:00:00.000Z",
  }), true);
});

test("MEZANA catalog images use the shared valid stock-document key shape", () => {
  assert.equal(safeStockDocumentKey("stock-documents/main/7bf96eb8-68dc-4c30-b8ff-f1f25d03bc34.jpg"), true);
  assert.equal(safeStockDocumentKey("stock-documents/main/mezana-catalog-7bf96eb8-68dc-4c30-b8ff-f1f25d03bc34.jpg"), false);
});
