export type SaleTaxTreatment = "automatic" | "accountant_managed";

type SaleTaxRecord = {
  id?: unknown;
  source?: unknown;
  externalId?: unknown;
  taxTreatment?: unknown;
  deliveryPlatform?: unknown;
  accountTypeAtSale?: unknown;
};

export function isDeliveryTaxSale(sale: SaleTaxRecord, accountType = "") {
  return accountType === "delivery" || sale.accountTypeAtSale === "delivery"
    || sale.source === "delivery" || ["coupang", "baemin", "yogiyo"].includes(String(sale.deliveryPlatform || ""));
}

export function saleTaxTreatment(sale: SaleTaxRecord, accountType = ""): SaleTaxTreatment {
  // Delivery fees include their own service VAT. Restaurant VAT remains accountant-managed.
  if (isDeliveryTaxSale(sale, accountType)) return "accountant_managed";
  if (sale.taxTreatment === "automatic" || sale.taxTreatment === "accountant_managed") {
    return sale.taxTreatment;
  }

  const id = String(sale.id || "");
  const externalId = String(sale.externalId || "");
  if (id.startsWith("pos-terminal-sale:") || externalId.startsWith("pos-order:")) {
    return "accountant_managed";
  }

  if (["manual", "pos", "photo", "api"].includes(String(sale.source || ""))) {
    return "automatic";
  }

  return accountType === "cash" || accountType === "bank"
    ? "accountant_managed"
    : "automatic";
}

export function isAutomaticTaxSale(sale: SaleTaxRecord, accountType = "") {
  return saleTaxTreatment(sale, accountType) === "automatic";
}
