import type { ParsedPosRow } from "../pos-import.ts";

type ExistingSale = {
  id: string;
  recipeId: string;
  quantity: number;
  date: string;
  source?: string;
  externalId?: string;
  totalRevenue?: number;
};

export type PosImportStatus = "new" | "saved" | "conflict" | "unmatched";
export type PosImportConflict = "file_duplicate" | "saved_duplicate" | "changed" | "";

export function posRowRevenue(row: Pick<ParsedPosRow, "totalRevenue" | "revenueSource"> & { menuRevenue?: number }) {
  return row.revenueSource === "pos_actual" ? row.totalRevenue : Number(row.menuRevenue || 0);
}

// A daily product report is a snapshot. Reusing its identity does not prove
// that the quantity is unchanged; never silently discard a revised snapshot.
export function reconcilePosImport<T extends ParsedPosRow & { recipeId: string; menuRevenue?: number }>(
  incoming: T[],
  sales: ExistingSale[],
  options: { compareRevenue?: boolean } = {},
) {
  const existingById = new Map<string, ExistingSale[]>();
  for (const sale of sales) {
    if (sale.source === "manual" || !sale.externalId) continue;
    const list = existingById.get(sale.externalId) || [];
    list.push(sale);
    existingById.set(sale.externalId, list);
  }
  const incomingCounts = new Map<string, number>();
  for (const row of incoming) incomingCounts.set(row.externalId, (incomingCounts.get(row.externalId) || 0) + 1);

  const rows = incoming.map((row) => {
    const existing = existingById.get(row.externalId) || [];
    let status: PosImportStatus = row.recipeId ? "new" : "unmatched";
    let conflict: PosImportConflict = "";
    if ((incomingCounts.get(row.externalId) || 0) > 1) conflict = "file_duplicate";
    else if (existing.length > 1) conflict = "saved_duplicate";
    else if (existing.length === 1 && row.recipeId) {
      const sale = existing[0];
      if (sale.recipeId !== row.recipeId || sale.date !== row.date || Number(sale.quantity) !== row.quantity
        || (options.compareRevenue !== false && row.revenueSource === "pos_actual" && Number(sale.totalRevenue) !== row.totalRevenue)) conflict = "changed";
      else status = "saved";
    }
    if (conflict) status = "conflict";
    return {
      ...row,
      importRevenue: posRowRevenue(row),
      status,
      conflict,
      duplicate: status === "saved",
      existingCount: existing.length,
      savedQuantity: existing.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0),
      savedRevenue: existing.reduce((sum, sale) => sum + Number(sale.totalRevenue || 0), 0),
    };
  });
  const newRows = rows.filter((row) => row.status === "new");
  const savedRows = rows.filter((row) => row.status === "saved");
  const conflicts = rows.filter((row) => row.status === "conflict");
  const unmatchedRows = rows.filter((row) => !row.recipeId);
  const menuRevenue = rows.reduce((sum, row) => sum + Number(row.menuRevenue || 0), 0);
  const newRevenue = newRows.reduce((sum, row) => sum + row.importRevenue, 0);
  const savedRevenue = savedRows.reduce((sum, row) => sum + row.savedRevenue, 0);
  return {
    rows, newRows, savedRows, conflicts, unmatchedRows,
    menuRevenue, newRevenue, savedRevenue,
    projectedRevenue: conflicts.length || unmatchedRows.length ? null : savedRevenue + newRevenue,
  };
}

// Validate only additions so legacy duplicates do not block unrelated saves.
// This also protects a retry made after another device imported the same file.
export function newPosDuplicateId(current: unknown[], submitted: unknown[]) {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object"
    ? value as Record<string, unknown> : {};
  const previous = current.map(record);
  const previousIds = new Set(previous.map((sale) => String(sale.id || "")));
  const externalIds = new Set(previous.map((sale) => String(sale.externalId || "")).filter(Boolean));
  for (const value of submitted) {
    const sale = record(value);
    if (previousIds.has(String(sale.id || "")) || !["pos", "photo"].includes(String(sale.source))) continue;
    const externalId = String(sale.externalId || "");
    if (!externalId) continue;
    if (externalIds.has(externalId)) return externalId;
    externalIds.add(externalId);
  }
  return "";
}
