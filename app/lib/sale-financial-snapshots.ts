import { isAutomaticTaxSale, isDeliveryTaxSale } from "./sale-tax.ts";

type JsonRecord = Record<string, unknown>;

export type SaleFinancialRules = {
  cardCommissionPct?: unknown;
  deliveryCommissionPct?: unknown;
  taxPct?: unknown;
};

export type SaleFinancialSnapshot = {
  source?: unknown;
  deliveryPlatform?: unknown;
  accountTypeAtSale?: unknown;
  cardCommissionPctAtSale?: unknown;
  taxPctAtSale?: unknown;
};

const ACCOUNT_TYPES = new Set(["cash", "bank", "card", "delivery"]);

const records = (value: unknown): JsonRecord[] => (Array.isArray(value)
  ? value.filter((entry): entry is JsonRecord => (
    Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
  ))
  : []);

const percentage = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
};

const savedPercentage = (value: unknown) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : undefined;
};

export function saleAccountType(sale: SaleFinancialSnapshot, fallbackType: unknown) {
  if (isDeliveryTaxSale(sale)) return "delivery";
  const saved = String(sale.accountTypeAtSale || "");
  if (ACCOUNT_TYPES.has(saved)) return saved;
  const fallback = String(fallbackType || "");
  return ACCOUNT_TYPES.has(fallback) ? fallback : "card";
}

/** A saved zero is intentional and must not fall back to today's rule. */
export function saleCardCommissionPercent(
  sale: SaleFinancialSnapshot,
  fallbackPercent: unknown,
) {
  if (isDeliveryTaxSale(sale)) return 0;
  return savedPercentage(sale.cardCommissionPctAtSale) ?? percentage(fallbackPercent);
}

/** A saved zero is intentional and must not fall back to today's rule. */
export function saleTaxPercent(
  sale: SaleFinancialSnapshot,
  fallbackPercent: unknown,
) {
  if (isDeliveryTaxSale(sale)) return 0;
  return savedPercentage(sale.taxPctAtSale) ?? percentage(fallbackPercent);
}

/**
 * Freezes the automatic rates which applied when a sale was created or its
 * money-bearing fields were edited. Historical reports can then be rebuilt
 * without applying today's configuration to an older sale.
 */
export function snapshotSaleFinancialRates<T extends JsonRecord>(
  sale: T,
  accountType: unknown,
  rules: SaleFinancialRules | undefined,
): T & { accountTypeAtSale: string; cardCommissionPctAtSale: number; taxPctAtSale: number } {
  const requestedAccountType = String(accountType || "");
  const normalizedAccountType = isDeliveryTaxSale(sale, requestedAccountType)
    ? "delivery" : ACCOUNT_TYPES.has(requestedAccountType) ? requestedAccountType : "card";
  return {
    ...sale,
    accountTypeAtSale: normalizedAccountType,
    cardCommissionPctAtSale: normalizedAccountType === "card"
      ? percentage(rules?.cardCommissionPct)
      : 0,
    taxPctAtSale: isAutomaticTaxSale(sale, normalizedAccountType)
      ? percentage(rules?.taxPct)
      : 0,
  };
}

const SNAPSHOT_FIELDS = ["accountTypeAtSale", "cardCommissionPctAtSale", "taxPctAtSale"] as const;

function financialInputSignature(sale: JsonRecord) {
  return JSON.stringify([
    String(sale.id || ""),
    Number(sale.totalRevenue),
    String(sale.accountId || ""),
    String(sale.taxTreatment || ""),
    String(sale.source || ""),
    String(sale.externalId || ""),
  ]);
}

function accountTypes(value: unknown) {
  return new Map(records(value).map((account) => [
    String(account.id || ""),
    String(account.type || ""),
  ]));
}

function cleanSubmittedSale(submitted: JsonRecord) {
  const clean: JsonRecord = { ...submitted };
  SNAPSHOT_FIELDS.forEach((field) => delete clean[field]);
  return clean;
}

function copyValidSavedFields(target: JsonRecord, current: JsonRecord) {
  SNAPSHOT_FIELDS.forEach((field) => {
    if (field === "accountTypeAtSale") {
      const saved = String(current[field] || "");
      if (ACCOUNT_TYPES.has(saved)) target[field] = saved;
      return;
    }
    const saved = savedPercentage(current[field]);
    if (saved !== undefined) target[field] = saved;
  });
  return target;
}

/** Restores only snapshots which already exist, without migrating legacy rows. */
export function preserveTrustedSaleFinancialRateSnapshots(
  currentValue: unknown,
  nextValue: unknown,
) {
  const currentById = new Map(records(currentValue).map((sale) => [String(sale.id || ""), sale]));
  const submittedEntries = Array.isArray(nextValue) ? nextValue : [];
  return submittedEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const submitted = entry as JsonRecord;
    const clean = cleanSubmittedSale(submitted);
    const current = currentById.get(String(submitted.id || ""));
    return current && financialInputSignature(current) === financialInputSignature(submitted)
      ? copyValidSavedFields(clean, current)
      : clean;
  });
}

/**
 * Owner clients submit the whole state and older open browser tabs do not know
 * about newly added fields. Preserve trusted snapshots on unchanged sales,
 * while always calculating them server-side for new or financially edited
 * sales. Client-provided snapshot values are never trusted.
 */
export function reconcileSaleFinancialRateSnapshots(
  currentValue: unknown,
  nextValue: unknown,
  currentAccountsValue: unknown,
  currentRules: SaleFinancialRules | undefined,
  nextAccountsValue: unknown = currentAccountsValue,
  nextRules: SaleFinancialRules | undefined = currentRules,
) {
  const currentById = new Map(records(currentValue).map((sale) => [String(sale.id || ""), sale]));
  const currentAccountTypes = accountTypes(currentAccountsValue);
  const nextAccountTypes = accountTypes(nextAccountsValue);

  const submittedEntries = Array.isArray(nextValue) ? nextValue : [];
  return submittedEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const submitted = entry as JsonRecord;
    const clean = cleanSubmittedSale(submitted);
    const current = currentById.get(String(submitted.id || ""));
    const changed = !current || financialInputSignature(current) !== financialInputSignature(submitted);
    if (changed) {
      return snapshotSaleFinancialRates(
        clean,
        nextAccountTypes.get(String(submitted.accountId || "")),
        nextRules,
      );
    }
    const trusted = snapshotSaleFinancialRates(
      clean,
      saleAccountType(current, currentAccountTypes.get(String(current.accountId || ""))),
      currentRules,
    );
    return copyValidSavedFields(trusted, current);
  });
}
