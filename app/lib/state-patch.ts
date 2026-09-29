type UnknownRecord = Record<string, unknown>;

type SetChange = {
  kind: "set";
  value: unknown;
};

type IdArrayChange = {
  kind: "id-array";
  removedIds: string[];
  upserts: Array<{ id: string; value: UnknownRecord; base?: UnknownRecord }>;
  order: string[];
};

export type StatePatch = {
  changes: Record<string, SetChange | IdArrayChange>;
};

const storedJson = (value: unknown) => JSON.stringify(value);
const sameValue = (left: unknown, right: unknown) => storedJson(left) === storedJson(right);
const hasStringId = (value: unknown): value is UnknownRecord & { id: string } => Boolean(
  value
  && typeof value === "object"
  && typeof (value as UnknownRecord).id === "string"
  && (value as UnknownRecord).id,
);

const identityKeyFor = (left: unknown[], right: unknown[]) => {
  const keys = ["id", "inventoryId"];
  return keys.find((key) => [...left, ...right].every((value) => (
    value
    && typeof value === "object"
    && typeof (value as UnknownRecord)[key] === "string"
    && (value as UnknownRecord)[key]
  )));
};

const canPatchById = (left: unknown[], right: unknown[]) => (
  left.every(hasStringId) && right.every(hasStringId)
);

export const createStatePatch = <T extends object>(
  base: T,
  next: T,
  ignoredKeys = new Set(["updatedAt", "auditLog"]),
): StatePatch => {
  const baseRecord = base as UnknownRecord;
  const nextRecord = next as UnknownRecord;
  const changes: StatePatch["changes"] = {};

  Object.keys(nextRecord).forEach((key) => {
    if (ignoredKeys.has(key) || sameValue(baseRecord[key], nextRecord[key])) return;
    const left = baseRecord[key];
    const right = nextRecord[key];
    if (Array.isArray(left) && Array.isArray(right) && canPatchById(left, right)) {
      const leftById = new Map(left.map((entry) => [entry.id, entry]));
      const rightIds = new Set(right.map((entry) => entry.id));
      changes[key] = {
        kind: "id-array",
        removedIds: left.filter((entry) => !rightIds.has(entry.id)).map((entry) => entry.id),
        upserts: right.filter((entry) => !sameValue(leftById.get(entry.id), entry)).map((entry) => ({
          id: entry.id,
          value: entry,
          base: leftById.get(entry.id),
        })),
        order: right.map((entry) => entry.id),
      };
      return;
    }
    changes[key] = { kind: "set", value: right };
  });

  return { changes };
};

export const isStatePatchEmpty = (patch: StatePatch) => Object.keys(patch.changes).length === 0;

const mergeChangedValue = (current: unknown, base: unknown, next: unknown): unknown => {
  if (sameValue(base, next)) return current;
  if (sameValue(current, base)) return next;

  if (Array.isArray(current) && Array.isArray(base) && Array.isArray(next)) {
    const identityKey = identityKeyFor(base, next);
    if (!identityKey) return next;
    const currentById = new Map(current.filter((value) => (
      value && typeof value === "object" && typeof (value as UnknownRecord)[identityKey] === "string"
    )).map((value) => [(value as UnknownRecord)[identityKey] as string, value as UnknownRecord]));
    const baseById = new Map(base.map((value) => [
      (value as UnknownRecord)[identityKey] as string,
      value as UnknownRecord,
    ]));
    const nextIds = new Set(next.map((value) => (value as UnknownRecord)[identityKey] as string));
    baseById.forEach((_value, entryId) => {
      if (!nextIds.has(entryId)) currentById.delete(entryId);
    });
    const merged = next.map((value) => {
      const nextRecord = value as UnknownRecord;
      const entryId = nextRecord[identityKey] as string;
      const baseRecord = baseById.get(entryId);
      const currentRecord = currentById.get(entryId);
      if (!baseRecord || !currentRecord) return nextRecord;
      return mergeChangedRecord(currentRecord, baseRecord, nextRecord);
    });
    current.forEach((value) => {
      if (!value || typeof value !== "object") return;
      const entryId = (value as UnknownRecord)[identityKey];
      if (typeof entryId === "string" && !baseById.has(entryId) && !nextIds.has(entryId)) merged.push(value);
    });
    return merged;
  }

  if (
    current && typeof current === "object" && !Array.isArray(current)
    && base && typeof base === "object" && !Array.isArray(base)
    && next && typeof next === "object" && !Array.isArray(next)
  ) {
    return mergeChangedRecord(current as UnknownRecord, base as UnknownRecord, next as UnknownRecord);
  }
  return next;
};

const mergeChangedRecord = (current: UnknownRecord, base: UnknownRecord, next: UnknownRecord) => {
  const merged: UnknownRecord = { ...current };
  Object.keys(next).forEach((key) => {
    if (!sameValue(base[key], next[key])) merged[key] = mergeChangedValue(current[key], base[key], next[key]);
  });
  Object.keys(base).forEach((key) => {
    if (!(key in next)) delete merged[key];
  });
  return merged;
};

export const applyStatePatch = <T extends object>(current: T, patch: StatePatch): T => {
  const result: UnknownRecord = { ...(current as UnknownRecord) };

  Object.entries(patch.changes).forEach(([key, change]) => {
    if (change.kind === "set") {
      result[key] = change.value;
      return;
    }

    const existing = Array.isArray(result[key]) ? result[key] as unknown[] : [];
    const removed = new Set(change.removedIds);
    const upserts = new Map(change.upserts.map((entry) => [entry.id, entry]));
    const merged: unknown[] = [];
    const presentIds = new Set<string>();

    existing.forEach((entry) => {
      if (!hasStringId(entry)) {
        merged.push(entry);
        return;
      }
      if (removed.has(entry.id)) return;
      const upsert = upserts.get(entry.id);
      merged.push(upsert
        ? upsert.base
          ? mergeChangedRecord(entry, upsert.base, upsert.value)
          : upsert.value
        : entry);
      presentIds.add(entry.id);
    });
    change.upserts.forEach((entry) => {
      const entryId = entry.id;
      if (!presentIds.has(entryId)) {
        merged.push(entry.value);
        presentIds.add(entryId);
      }
    });

    const mergedById = new Map(
      merged.filter(hasStringId).map((entry) => [entry.id, entry]),
    );
    const ordered = change.order.flatMap((entryId) => {
      const entry = mergedById.get(entryId);
      if (!entry) return [];
      mergedById.delete(entryId);
      return [entry];
    });
    const extras = merged.filter((entry) => !hasStringId(entry) || mergedById.has(entry.id));
    result[key] = [...ordered, ...extras];
  });

  return result as T;
};
