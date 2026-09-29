export const DELETED_ITEM_KINDS = [
  "inventory",
  "recipe",
  "productCategory",
  "fixedExpense",
  "dailyClose",
  "supplier",
  "transaction",
  "stockMovement",
  "sale",
  "mezanaEntry",
] as const;

export type DeletedItemKind = typeof DELETED_ITEM_KINDS[number];

export type DeletedItem = {
  id: string;
  kind: DeletedItemKind;
  entityId: string;
  label: string;
  section: string;
  deletedAt: string;
  deletedBy: string;
  reason?: string;
  record: Record<string, unknown>;
  related?: Record<string, unknown>;
  restoredAt?: string;
  restoredBy?: string;
};

const kindSet = new Set<string>(DELETED_ITEM_KINDS);
const recordValue = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);
const canonicalIso = (value: unknown) => {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const payloadLooksValid = (kind: DeletedItemKind, record: Record<string, unknown>) => {
  if (!String(record.id || "").trim()) return false;
  if (["inventory", "recipe", "supplier", "fixedExpense"].includes(kind)) {
    if (!String(record.name || "").trim()) return false;
  }
  if (kind === "inventory") {
    return typeof record.unit === "string"
      && Number.isFinite(Number(record.stock))
      && Number.isFinite(Number(record.unitCost));
  }
  if (kind === "recipe") return Array.isArray(record.ingredients);
  if (kind === "productCategory") return ["recipe", "inventory"].includes(String(record.kind || ""));
  if (kind === "fixedExpense") return Number.isFinite(Number(record.amount)) && typeof record.nextDue === "string";
  if (kind === "dailyClose") return typeof record.date === "string";
  if (kind === "transaction") return typeof record.supplierId === "string" && Number.isFinite(Number(record.amount));
  if (kind === "stockMovement") return typeof record.inventoryId === "string" && Number.isFinite(Number(record.quantity));
  if (kind === "sale") return typeof record.recipeId === "string" && Number.isFinite(Number(record.quantity));
  if (kind === "mezanaEntry") {
    return (record.action === "borrowed" || record.action === "returned" || record.action === "purchased")
      && typeof record.productName === "string" && Boolean(record.productName.trim())
      && Number.isSafeInteger(Number(record.amount)) && Number(record.amount) >= 0
      && (record.quantity === undefined || (Number.isSafeInteger(Number(record.quantity)) && Number(record.quantity) > 0 && Number(record.quantity) <= 1_000_000))
      && (Number(record.amount) > 0 || Number(record.quantity || 0) > 0)
      && (record.action !== "purchased" || Number(record.amount) > 0)
      && typeof record.date === "string"
      && Array.isArray(record.documents);
  }
  return true;
};

export function validDeletedItems(value: unknown) {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  const activeEntities = new Set<string>();
  for (const raw of value) {
    if (!recordValue(raw)) return false;
    const id = String(raw.id || "");
    const entityId = String(raw.entityId || "");
    const label = String(raw.label || "");
    const section = String(raw.section || "");
    const deletedAt = String(raw.deletedAt || "");
    const deletedBy = String(raw.deletedBy || "");
    const kind = String(raw.kind || "") as DeletedItemKind;
    const restored = raw.restoredAt !== undefined || raw.restoredBy !== undefined;
    const activeKey = `${kind}:${entityId}`;
    if (
      !id || id.length > 180 || ids.has(id)
      || !kindSet.has(kind)
      || !entityId || entityId.length > 180
      || !label || label.length > 180
      || !section || section.length > 80
      || !deletedBy || deletedBy.length > 50
      || (raw.reason !== undefined && (typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 500))
      || !canonicalIso(deletedAt)
      || !recordValue(raw.record)
      || String(raw.record.id || "") !== entityId
      || !payloadLooksValid(kind, raw.record)
      || (raw.related !== undefined && !recordValue(raw.related))
      || (restored && (raw.restoredAt === undefined || raw.restoredBy === undefined))
      || (raw.restoredAt !== undefined && !canonicalIso(raw.restoredAt))
      || (raw.restoredBy !== undefined && (typeof raw.restoredBy !== "string" || !raw.restoredBy || raw.restoredBy.length > 50))
      || (!restored && activeEntities.has(activeKey))
    ) return false;
    ids.add(id);
    if (!restored) activeEntities.add(activeKey);
  }
  return true;
}

export function normalizeDeletedItems(value: unknown): DeletedItem[] {
  if (!Array.isArray(value)) return [];
  const normalized: DeletedItem[] = [];
  for (const entry of value) {
    if (!validDeletedItems([entry])) continue;
    const candidate = entry as DeletedItem;
    if (!validDeletedItems([...normalized, candidate])) continue;
    normalized.push(candidate);
  }
  return normalized;
}

const activeCollectionByKind: Record<DeletedItemKind, string> = {
  inventory: "inventory",
  recipe: "recipes",
  productCategory: "productCategories",
  fixedExpense: "fixedExpenses",
  dailyClose: "dailyCloses",
  supplier: "suppliers",
  transaction: "transactions",
  stockMovement: "stockMovements",
  sale: "sales",
  mezanaEntry: "mezanaEntries",
};

export function activeDeletedEntityConflicts<T extends object>(value: T) {
  const source = value as Record<string, unknown>;
  return normalizeDeletedItems(source.deletedItems).filter((item) => {
    if (item.restoredAt) return false;
    const entries = source[activeCollectionByKind[item.kind]];
    return Array.isArray(entries) && entries.some((entry) => (
      entry
      && typeof entry === "object"
      && !Array.isArray(entry)
      && String((entry as Record<string, unknown>).id || "") === item.entityId
    ));
  });
}

/**
 * An active archive entry is a tombstone: it always wins over an older edit
 * that tries to re-add the same entity. This keeps delayed saves from
 * resurrecting records that the owner already moved to the trash.
 */
export function withoutActiveDeletedEntities<T extends object>(value: T): T {
  const source = value as Record<string, unknown>;
  const deletedItems = normalizeDeletedItems(source.deletedItems);
  const hiddenByCollection = new Map<string, Set<string>>();
  for (const item of deletedItems) {
    if (item.restoredAt) continue;
    const collection = activeCollectionByKind[item.kind];
    const hiddenIds = hiddenByCollection.get(collection) || new Set<string>();
    hiddenIds.add(item.entityId);
    hiddenByCollection.set(collection, hiddenIds);
  }
  const next: Record<string, unknown> = { ...source, deletedItems };
  for (const [collection, hiddenIds] of hiddenByCollection) {
    const entries = source[collection];
    if (!Array.isArray(entries)) continue;
    next[collection] = entries.filter((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
      return !hiddenIds.has(String((entry as Record<string, unknown>).id || ""));
    });
  }
  return next as T;
}

export function createDeletedItem({
  kind,
  entityId,
  label,
  section,
  record,
  related,
  reason,
  now = new Date(),
}: {
  kind: DeletedItemKind;
  entityId: string;
  label: string;
  section: string;
  record: Record<string, unknown>;
  related?: Record<string, unknown>;
  reason: string;
  now?: Date;
}): DeletedItem {
  const deletedAt = now.toISOString();
  return {
    id: `deleted:${kind}:${now.getTime()}:${crypto.randomUUID()}`,
    kind,
    entityId,
    label: label.trim().slice(0, 180),
    section: section.trim().slice(0, 80),
    deletedAt,
    deletedBy: "Rahbar",
    reason: reason.trim().slice(0, 500),
    record,
    ...(related ? { related } : {}),
  };
}

export function markDeletedItemRestored(
  items: DeletedItem[],
  archiveId: string,
  now = new Date(),
) {
  return items.map((item) => item.id === archiveId
    ? { ...item, restoredAt: now.toISOString(), restoredBy: "Rahbar" }
    : item);
}

export function prependDeletedItem(items: DeletedItem[], item: DeletedItem) {
  return [item, ...items];
}

export function activeDeletedItems(items: DeletedItem[]) {
  return items.filter((item) => !item.restoredAt);
}
