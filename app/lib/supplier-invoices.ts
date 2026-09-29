import { normalizeDeletedItems } from "./deleted-items.ts";
import { validStockDocument } from "./stock-documents.ts";

type UnknownRecord = Record<string, unknown>;

export type SupplierPurchaseRecord = UnknownRecord & {
  id: string;
  supplierId: string;
  type: "purchase";
  amount: number;
  date: string;
};

const recordValue = (value: unknown): value is UnknownRecord => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);

export function validSupplierPurchaseRecord(value: unknown): value is SupplierPurchaseRecord {
  if (!recordValue(value)) return false;
  return typeof value.id === "string"
    && Boolean(value.id.trim())
    && typeof value.supplierId === "string"
    && Boolean(value.supplierId.trim())
    && value.type === "purchase"
    && Number.isFinite(Number(value.amount))
    && Number(value.amount) > 0
    && typeof value.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.date)
    && (value.note === undefined || typeof value.note === "string")
    && (value.document === undefined || value.document === null || validStockDocument(value.document));
}

const activeDeletedTransactionIds = (deletedItems: unknown) => new Set(
  normalizeDeletedItems(deletedItems)
    .filter((item) => item.kind === "transaction" && !item.restoredAt)
    .map((item) => item.entityId),
);

/**
 * A supplier purchase is an invoice ledger record. It may leave the active
 * ledger only together with an explicit trash/archive tombstone.
 */
export function missingUnarchivedSupplierPurchases(
  previousTransactions: unknown,
  nextTransactions: unknown,
  deletedItems: unknown,
) {
  const previous = Array.isArray(previousTransactions) ? previousTransactions : [];
  const nextPurchaseIds = new Set(
    (Array.isArray(nextTransactions) ? nextTransactions : [])
      .filter(validSupplierPurchaseRecord)
      .map((transaction) => transaction.id),
  );
  const deletedIds = activeDeletedTransactionIds(deletedItems);
  return previous
    .filter(validSupplierPurchaseRecord)
    .filter((transaction) => !nextPurchaseIds.has(transaction.id) && !deletedIds.has(transaction.id));
}

/**
 * Older payment saves could leave the ledger without a purchase that was
 * present in the automatic pre-save backup. Recover only valid purchase rows,
 * never rows explicitly moved to the trash, and never overwrite a live id.
 */
export function recoverMissingSupplierPurchases(
  currentTransactions: unknown,
  paymentBackupStates: unknown,
  deletedItems: unknown,
) {
  const current = Array.isArray(currentTransactions) ? currentTransactions : [];
  const currentIds = new Set(current.flatMap((entry) => (
    recordValue(entry) && typeof entry.id === "string" && entry.id ? [entry.id] : []
  )));
  const deletedIds = activeDeletedTransactionIds(deletedItems);
  const candidates = new Map<string, SupplierPurchaseRecord>();

  for (const state of Array.isArray(paymentBackupStates) ? paymentBackupStates : []) {
    if (!recordValue(state) || !Array.isArray(state.transactions)) continue;
    for (const transaction of state.transactions) {
      if (validSupplierPurchaseRecord(transaction)) candidates.set(transaction.id, transaction);
    }
  }

  return [...candidates.values()].filter((transaction) => (
    !currentIds.has(transaction.id) && !deletedIds.has(transaction.id)
  ));
}
