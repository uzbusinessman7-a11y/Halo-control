type JsonRecord = Record<string, unknown>;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const records = (value: unknown): JsonRecord[] => (Array.isArray(value)
  ? value.filter((entry): entry is JsonRecord => (
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
  ))
  : []);

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

const closedMonths = (value: unknown) => new Set(records(value).flatMap((entry) => {
  const month = String(entry.month || "").trim();
  return MONTH_PATTERN.test(month) ? [month] : [];
}));

/**
 * Protects every record whose effective date belongs to an already closed
 * month. The canonical multiset comparison catches additions, deletions,
 * edits, moves out of a closed month, and moves from an open month into one.
 * Array order and object-key order are intentionally ignored.
 */
export function preservesClosedMonthDatedRecords(
  currentCloses: unknown,
  currentRecordsValue: unknown,
  nextRecordsValue: unknown,
  dateField: string | readonly string[] = "date",
) {
  const months = closedMonths(currentCloses);
  if (!months.size) return true;
  const dateFields = typeof dateField === "string" ? [dateField] : [...dateField];
  const protectedRecords = (value: unknown) => records(value)
    .filter((entry) => dateFields.some((field) => (
      months.has(String(entry[field] || "").trim().slice(0, 7))
    )))
    .map(canonicalJson)
    .sort();
  const current = protectedRecords(currentRecordsValue);
  const next = protectedRecords(nextRecordsValue);
  return current.length === next.length
    && current.every((entry, index) => entry === next[index]);
}

const purchaseOrderOrigin = (entry: JsonRecord) => ({
  id: entry.id,
  supplierId: entry.supplierId,
  date: entry.date,
  items: entry.items,
  total: entry.total,
});

const withoutKeys = (entry: JsonRecord, keys: readonly string[]) => Object.fromEntries(
  Object.entries(entry).filter(([key]) => !keys.includes(key)),
);

const validTimestamp = (value: unknown) => (
  typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value))
);

function validClosedPurchaseOrderTransition(current: JsonRecord, next: JsonRecord) {
  if (canonicalJson(current) === canonicalJson(next)) return true;
  const currentStatus = String(current.status || "");
  const nextStatus = String(next.status || "");
  if (currentStatus === "ordered" && nextStatus === "received") {
    return canonicalJson(withoutKeys(current, ["status", "receivedAt"]))
      === canonicalJson(withoutKeys(next, ["status", "receivedAt"]))
      && validTimestamp(next.receivedAt);
  }
  if (currentStatus === "ordered" && nextStatus === "cancelled") {
    return canonicalJson(withoutKeys(current, ["status", "cancelReason", "cancelledAt", "cancelledBy"]))
      === canonicalJson(withoutKeys(next, ["status", "cancelReason", "cancelledAt", "cancelledBy"]))
      && String(next.cancelReason || "").trim().length > 0
      && String(next.cancelledBy || "").trim().length > 0
      && validTimestamp(next.cancelledAt);
  }
  if (currentStatus === "received" && nextStatus === "paid") {
    return canonicalJson(withoutKeys(current, ["status", "paidAt", "accountId"]))
      === canonicalJson(withoutKeys(next, ["status", "paidAt", "accountId"]))
      && String(next.accountId || "").trim().length > 0
      && validTimestamp(next.paidAt);
  }
  return false;
}

/**
 * An order placed in a closed month may still be received, paid, or cancelled
 * later. Freeze its original commercial terms while allowing only the exact
 * ordered -> received/cancelled and received -> paid lifecycle transitions.
 */
export function preservesClosedMonthPurchaseOrderOrigins(
  currentCloses: unknown,
  currentValue: unknown,
  nextValue: unknown,
) {
  const months = closedMonths(currentCloses);
  if (!months.size) return true;
  const current = records(currentValue);
  const next = records(nextValue);
  const currentById = new Map(current.map((entry) => [String(entry.id || ""), entry]));
  const nextById = new Map(next.map((entry) => [String(entry.id || ""), entry]));
  if (currentById.size !== current.length || nextById.size !== next.length) return false;

  for (const entry of current) {
    if (!months.has(String(entry.date || "").trim().slice(0, 7))) continue;
    const replacement = nextById.get(String(entry.id || ""));
    if (!replacement) return false;
    if (canonicalJson(purchaseOrderOrigin(entry)) !== canonicalJson(purchaseOrderOrigin(replacement))) return false;
    if (!validClosedPurchaseOrderTransition(entry, replacement)) return false;
  }

  for (const entry of next) {
    if (!months.has(String(entry.date || "").trim().slice(0, 7))) continue;
    const original = currentById.get(String(entry.id || ""));
    if (!original || !months.has(String(original.date || "").trim().slice(0, 7))) return false;
  }
  return true;
}

/** Month-close stock rows are an immutable part of the frozen accounting
 * snapshot. Other referenced movements are intentionally excluded here:
 * owner workflows update their source sale/consumption and linked movements
 * together in one state write.
 */
export function preservesMonthCloseStockMovements(
  currentValue: unknown,
  nextValue: unknown,
) {
  const nextById = new Map(records(nextValue).map((entry) => [String(entry.id || ""), entry]));
  return records(currentValue)
    .filter((entry) => String(entry.referenceId || "").trim().startsWith("monthly-close:"))
    .every((entry) => canonicalJson(nextById.get(String(entry.id || ""))) === canonicalJson(entry));
}
