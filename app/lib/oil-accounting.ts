type JsonRecord = Record<string, unknown>;

export const CHICKEN_OIL_CAN_LITERS = 18;
export const OIL_PURCHASE_CATEGORY = "Chicken moyi xaridi";
export const OIL_RESALE_CATEGORY = "Ishlatilgan moy sotuvi";

export type OilFlowType = "purchase" | "resale";

export type OilLedgerRecord = {
  oilFlowType?: unknown;
  oilCanCount?: unknown;
  oilLiters?: unknown;
  oilUnitAmount?: unknown;
  amount?: unknown;
};

const positiveNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function isOilLedgerEntry(entry: OilLedgerRecord) {
  return entry.oilFlowType === "purchase" || entry.oilFlowType === "resale";
}

export function oilLedgerEntries<T extends OilLedgerRecord>(entries: T[]) {
  return entries.filter(isOilLedgerEntry);
}

export function summarizeOilLedger(entries: OilLedgerRecord[]) {
  const totals = entries.reduce((summary, entry) => {
    if (!isOilLedgerEntry(entry)) return summary;
    const cans = positiveNumber(entry.oilCanCount);
    const liters = positiveNumber(entry.oilLiters) || cans * CHICKEN_OIL_CAN_LITERS;
    const amount = Math.round(positiveNumber(entry.amount));
    if (entry.oilFlowType === "purchase") {
      summary.purchaseCans += cans;
      summary.purchaseLiters += liters;
      summary.purchaseCost += amount;
    } else {
      summary.resaleCans += cans;
      summary.resaleLiters += liters;
      summary.resaleIncome += amount;
    }
    return summary;
  }, {
    purchaseCans: 0,
    purchaseLiters: 0,
    purchaseCost: 0,
    resaleCans: 0,
    resaleLiters: 0,
    resaleIncome: 0,
  });
  const averagePurchaseUnitAmount = totals.purchaseCans > 0
    ? Math.round(totals.purchaseCost / totals.purchaseCans)
    : 0;
  const averageResaleUnitAmount = totals.resaleCans > 0
    ? Math.round(totals.resaleIncome / totals.resaleCans)
    : 0;
  return {
    ...totals,
    averagePurchaseUnitAmount,
    averageResaleUnitAmount,
    averageUnitDifference: totals.purchaseCans > 0 && totals.resaleCans > 0
      ? averageResaleUnitAmount - averagePurchaseUnitAmount
      : 0,
    netOilCost: totals.purchaseCost - totals.resaleIncome,
    recoveryRate: totals.purchaseCost > 0
      ? totals.resaleIncome / totals.purchaseCost * 100
      : 0,
  };
}

export function validOilLedgerMetadata(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.every((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const entry = candidate as JsonRecord;
    if (entry.oilFlowType === undefined) return true;
    if (!isOilLedgerEntry(entry)) return false;
    const cans = Number(entry.oilCanCount);
    const liters = Number(entry.oilLiters);
    const unitAmount = Number(entry.oilUnitAmount);
    const amount = Number(entry.amount);
    if (!Number.isInteger(cans) || cans <= 0 || cans > 10_000) return false;
    if (liters !== cans * CHICKEN_OIL_CAN_LITERS) return false;
    if (!Number.isSafeInteger(unitAmount) || unitAmount <= 0) return false;
    if (!Number.isSafeInteger(amount) || amount !== cans * unitAmount) return false;
    if (entry.affectsProfit !== true || entry.reversedEntryId) return false;
    if (entry.oilFlowType === "purchase") {
      return entry.type === "expense" && entry.category === OIL_PURCHASE_CATEGORY;
    }
    return entry.type === "income" && entry.category === OIL_RESALE_CATEGORY;
  });
}
