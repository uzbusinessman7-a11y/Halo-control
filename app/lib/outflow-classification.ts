export const KITCHEN_CONSUMPTION_REASON = "Oshxonada yeyilgan ovqat";

const LEGACY_KITCHEN_REASONS = ["Xodim ovqati"] as const;

const normalizedReason = (value: unknown) => String(value || "")
  .trim()
  .toLocaleLowerCase("uz-UZ")
  .replace(/[ʻʼ‘’`´]/g, "'")
  .replace(/\s+/g, " ");

/** Stable classification shared by reports, exports, and entry forms. */
export function isKitchenConsumptionEntry(entry: Record<string, unknown>) {
  const kind = String(entry.kind || "");
  if (kind === "meal") return true;
  if (kind !== "inventory_only") return false;
  if (entry.outflowCategory === "kitchen_consumption") return true;
  if (entry.outflowCategory === "other_inventory_outflow") return false;
  const reason = normalizedReason(entry.reason);
  if (reason === normalizedReason(KITCHEN_CONSUMPTION_REASON)
    || reason === normalizedReason(LEGACY_KITCHEN_REASONS[0])) return true;
  if (/^oshxona(?:da|ga)?\b.*(?:yey|ovqat)/u.test(reason)) return true;
  if (/^xodim\b.*ovqat/u.test(reason)) return true;
  // The oldest inventory-only rows had no saved reason or category. Other
  // inventory-outflow forms required a reason, so a blank legacy row is food.
  return !reason;
}
