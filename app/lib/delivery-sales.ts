export const DELIVERY_PLATFORMS = [
  { id: "coupang", label: "Coupang Eats", shortLabel: "Coupang" },
  { id: "baemin", label: "Baemin · 배달의민족", shortLabel: "Baemin" },
  { id: "yogiyo", label: "Yogiyo · 요기요", shortLabel: "Yogiyo" },
] as const;

export type DeliveryPlatform = typeof DELIVERY_PLATFORMS[number]["id"];

export type DeliveryFeeRule = {
  combinedPct?: number;
  brokeragePct: number;
  paymentPct: number;
  deliveryFeeWon: number;
  vatPct: number;
  couponPct: number;
  instantDiscountWon: number;
  advertisingPct: number;
};

export type DeliveryFeeBreakdown = {
  brokerage: number;
  payment: number;
  delivery: number;
  vat: number;
  coupon: number;
  instantDiscount: number;
  advertising: number;
  total: number;
};

export const DELIVERY_FEE_KEYS = ["brokerage", "payment", "delivery", "vat", "coupon", "instantDiscount", "advertising"] as const;
export type DeliveryFeeKey = typeof DELIVERY_FEE_KEYS[number];
export type DeliveryManualFees = Record<DeliveryFeeKey, { unit: "percent" | "won"; value: number | "" }>;

export function emptyDeliveryManualFees(): DeliveryManualFees {
  return Object.fromEntries(DELIVERY_FEE_KEYS.map((key) => [key, { unit: "won", value: 0 }])) as DeliveryManualFees;
}

export function deliveryManualFeesFromRule(rule: DeliveryFeeRule): DeliveryManualFees {
  return {
    brokerage: { unit: "percent", value: rule.brokeragePct },
    payment: { unit: "percent", value: rule.paymentPct },
    delivery: { unit: "won", value: rule.deliveryFeeWon },
    vat: { unit: "percent", value: rule.vatPct },
    coupon: { unit: "percent", value: rule.couponPct },
    instantDiscount: { unit: "won", value: rule.instantDiscountWon },
    advertising: { unit: "percent", value: rule.advertisingPct },
  };
}

export function deliveryCombinedPercent(rule: DeliveryFeeRule) {
  if (rule.combinedPct !== undefined) return cleanPercent(rule.combinedPct);
  const percentFees = cleanPercent(rule.brokeragePct) + cleanPercent(rule.paymentPct) + cleanPercent(rule.advertisingPct);
  return Math.min(100, Math.round((percentFees + (cleanPercent(rule.brokeragePct) + cleanPercent(rule.paymentPct)) * cleanPercent(rule.vatPct) / 100) * 100) / 100);
}

// New orders use one easy percentage plus two fixed won deductions. Older detailed
// rules continue to work until the owner saves the simplified rule.
export function deliveryAutomaticManualFees(rule: DeliveryFeeRule): DeliveryManualFees {
  if (rule.combinedPct === undefined) return deliveryManualFeesFromRule(rule);
  const result = emptyDeliveryManualFees();
  result.brokerage = { unit: "percent", value: cleanPercent(rule.combinedPct) };
  result.delivery = { unit: "won", value: cleanWon(rule.deliveryFeeWon) };
  result.instantDiscount = { unit: "won", value: cleanWon(rule.instantDiscountWon) };
  return result;
}

export function calculateDeliveryManualFees(revenue: number, inputs: DeliveryManualFees): DeliveryFeeBreakdown {
  const gross = Number.isFinite(revenue) ? Math.max(0, Math.round(revenue)) : 0;
  const amount = (key: DeliveryFeeKey, base = gross) => {
    const entry = inputs[key];
    const value = Number(entry?.value);
    if (!gross || !Number.isFinite(value) || value < 0) return 0;
    return Math.round(entry.unit === "percent" ? base * value / 100 : value);
  };
  const brokerage = amount("brokerage");
  const coupon = amount("coupon");
  const instantDiscount = amount("instantDiscount");
  const payment = amount("payment", Math.max(0, gross - coupon - instantDiscount));
  const delivery = amount("delivery");
  const vat = amount("vat", brokerage + payment + delivery);
  const advertising = amount("advertising");
  return { brokerage, payment, delivery, vat, coupon, instantDiscount, advertising,
    total: brokerage + payment + delivery + vat + coupon + instantDiscount + advertising };
}

export function validDeliveryManualFees(inputs: DeliveryManualFees, revenue: number) {
  const valid = DELIVERY_FEE_KEYS.every((key) => {
    const entry = inputs[key];
    const value = Number(entry?.value);
    return entry && Number.isFinite(value) && value >= 0
      && (entry.unit === "percent" ? value <= 100 : entry.unit === "won" && Number.isSafeInteger(value) && value <= 1_000_000_000);
  });
  const fees = calculateDeliveryManualFees(revenue, inputs);
  return valid && fees.coupon + fees.instantDiscount <= revenue;
}

export function deliveryManualFeesForEdit(sales: {
  totalRevenue: number; deliveryManualFees?: DeliveryManualFees; deliveryFeeBreakdown?: DeliveryFeeBreakdown;
  deliveryCommissionAmount?: number; deliveryCommissionPct?: number;
}[], fallbackPct = 0): DeliveryManualFees {
  const saved = sales.find((sale) => sale.deliveryManualFees)?.deliveryManualFees;
  if (saved) return Object.fromEntries(DELIVERY_FEE_KEYS.map((key) => [key, { ...saved[key] }])) as DeliveryManualFees;
  const result = emptyDeliveryManualFees();
  if (sales.length && sales.every((sale) => sale.deliveryFeeBreakdown)) {
    for (const key of DELIVERY_FEE_KEYS) result[key].value = sales.reduce((sum, sale) => sum + (sale.deliveryFeeBreakdown?.[key] || 0), 0);
  } else {
    // Older records contain only a total; preserve it without inventing a split.
    result.brokerage.value = sales.reduce((sum, sale) => sum + deliveryCommissionAmount(sale, fallbackPct), 0);
  }
  return result;
}

export function deliveryWonFeesForEdit(sales: Parameters<typeof deliveryManualFeesForEdit>[0], fallbackPct = 0): DeliveryManualFees {
  const result = emptyDeliveryManualFees();
  if (sales.length && sales.every((sale) => sale.deliveryFeeBreakdown)) {
    for (const key of DELIVERY_FEE_KEYS) result[key].value = sales.reduce((sum, sale) => sum + (sale.deliveryFeeBreakdown?.[key] || 0), 0);
  } else {
    const fees = calculateDeliveryManualFees(sales.reduce((sum, sale) => sum + sale.totalRevenue, 0), deliveryManualFeesForEdit(sales, fallbackPct));
    for (const key of DELIVERY_FEE_KEYS) result[key].value = fees[key];
  }
  return result;
}

// Amounts belong to the whole order, even when the order has several sale rows.
export type DeliveryOrderAdjustments = {
  couponWon: number;
  instantDiscountWon: number;
  deliveryFeeWon?: number;
};

export type DeliveryPlatformRules = Partial<Record<DeliveryPlatform, DeliveryFeeRule>>;
export type DeliveryPlatformPrices = Partial<Record<DeliveryPlatform, number>>;

// Saving one platform must not convert the other platforms' existing rules.
export function withSimpleDeliveryRule<T extends { deliveryPlatformRules?: DeliveryPlatformRules }>(
  rules: T,
  platform: DeliveryPlatform,
  values: { combinedPct: number; deliveryFeeWon: number; instantDiscountWon: number },
): T & { deliveryPlatformRules: DeliveryPlatformRules } {
  if (!Number.isFinite(values.combinedPct) || values.combinedPct < 0 || values.combinedPct > 100
    || ![values.deliveryFeeWon, values.instantDiscountWon].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000)) {
    throw new Error("Ushlanma foizi 0–100 oralig‘ida, von summalari esa 0 yoki musbat butun son bo‘lsin.");
  }
  return {
    ...rules,
    deliveryPlatformRules: {
      ...rules.deliveryPlatformRules,
      [platform]: {
        ...values,
        brokeragePct: 0, paymentPct: 0, vatPct: 0, couponPct: 0, advertisingPct: 0,
      },
    },
  };
}

export const DEFAULT_DELIVERY_FEE_RULES: Record<DeliveryPlatform, DeliveryFeeRule> = {
  coupang: {
    brokeragePct: 7.8,
    paymentPct: 3,
    deliveryFeeWon: 3400,
    vatPct: 10,
    couponPct: 0,
    instantDiscountWon: 0,
    advertisingPct: 0,
  },
  baemin: {
    brokeragePct: 0,
    paymentPct: 0,
    deliveryFeeWon: 0,
    vatPct: 0,
    couponPct: 0,
    instantDiscountWon: 0,
    advertisingPct: 0,
  },
  yogiyo: {
    brokeragePct: 0,
    paymentPct: 0,
    deliveryFeeWon: 0,
    vatPct: 0,
    couponPct: 0,
    instantDiscountWon: 0,
    advertisingPct: 0,
  },
};

const cleanPercent = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
};

const cleanWon = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
};

export function normalizeDeliveryFeeRule(value: unknown, fallback: DeliveryFeeRule): DeliveryFeeRule {
  const rule = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<DeliveryFeeRule>
    : {};
  return {
    ...(rule.combinedPct !== undefined ? { combinedPct: cleanPercent(rule.combinedPct) } : {}),
    brokeragePct: cleanPercent(rule.brokeragePct ?? fallback.brokeragePct),
    paymentPct: cleanPercent(rule.paymentPct ?? fallback.paymentPct),
    deliveryFeeWon: cleanWon(rule.deliveryFeeWon ?? fallback.deliveryFeeWon),
    vatPct: cleanPercent(rule.vatPct ?? fallback.vatPct),
    couponPct: cleanPercent(rule.couponPct ?? fallback.couponPct),
    instantDiscountWon: cleanWon(rule.instantDiscountWon ?? fallback.instantDiscountWon),
    advertisingPct: cleanPercent(rule.advertisingPct ?? fallback.advertisingPct),
  };
}

export function deliveryFeeRuleForPlatform(
  rules: { deliveryPlatformRules?: DeliveryPlatformRules; deliveryCommissionPct?: unknown } | undefined,
  platform: DeliveryPlatform,
) {
  const saved = rules?.deliveryPlatformRules?.[platform];
  if (saved) return normalizeDeliveryFeeRule(saved, DEFAULT_DELIVERY_FEE_RULES[platform]);
  const legacyPct = cleanPercent(rules?.deliveryCommissionPct);
  if (legacyPct > 0) {
    return normalizeDeliveryFeeRule({ brokeragePct: legacyPct }, DEFAULT_DELIVERY_FEE_RULES.baemin);
  }
  return { ...DEFAULT_DELIVERY_FEE_RULES[platform] };
}

export function deliveryFeeRuleForOrder(
  rules: Parameters<typeof deliveryFeeRuleForPlatform>[0],
  platform: DeliveryPlatform,
  sale?: { deliveryPlatform?: unknown; deliveryFeeRule?: DeliveryFeeRule; deliveryCommissionPct?: number },
) {
  if (sale?.deliveryPlatform === platform) {
    if (sale.deliveryFeeRule) return normalizeDeliveryFeeRule(sale.deliveryFeeRule, DEFAULT_DELIVERY_FEE_RULES.baemin);
    if (sale.deliveryCommissionPct !== undefined) {
      return normalizeDeliveryFeeRule({ brokeragePct: sale.deliveryCommissionPct }, DEFAULT_DELIVERY_FEE_RULES.baemin);
    }
  }
  return deliveryFeeRuleForPlatform(rules, platform);
}

export function validDeliveryOrderAdjustments(value: DeliveryOrderAdjustments, grossRevenue: number) {
  return [value.couponWon, value.instantDiscountWon].every((amount) => Number.isSafeInteger(amount) && amount >= 0)
    && (value.deliveryFeeWon === undefined || (Number.isSafeInteger(value.deliveryFeeWon) && value.deliveryFeeWon >= 0))
    && value.couponWon + value.instantDiscountWon <= grossRevenue;
}

export function deliveryOrderAdjustmentsForEdit(
  sales: { totalRevenue: number; deliveryOrderAdjustments?: DeliveryOrderAdjustments; deliveryFeeBreakdown?: DeliveryFeeBreakdown }[],
  rule: DeliveryFeeRule,
): DeliveryOrderAdjustments & { deliveryFeeWon: number } {
  const saved = sales.find((sale) => sale.deliveryOrderAdjustments)?.deliveryOrderAdjustments;
  const hasBreakdown = sales.length > 0 && sales.every((sale) => sale.deliveryFeeBreakdown);
  const deliveryFeeWon = saved?.deliveryFeeWon ?? (hasBreakdown
    ? sales.reduce((sum, sale) => sum + (sale.deliveryFeeBreakdown?.delivery || 0), 0)
    : rule.deliveryFeeWon);
  if (saved) return { ...saved, deliveryFeeWon };
  if (hasBreakdown) {
    return sales.reduce((result, sale) => ({
      couponWon: result.couponWon + (sale.deliveryFeeBreakdown?.coupon || 0),
      instantDiscountWon: result.instantDiscountWon + (sale.deliveryFeeBreakdown?.instantDiscount || 0),
      deliveryFeeWon,
    }), { couponWon: 0, instantDiscountWon: 0, deliveryFeeWon });
  }
  const calculated = calculateDeliveryFeeBreakdown(sales.reduce((sum, sale) => sum + sale.totalRevenue, 0), rule);
  return { couponWon: calculated.coupon, instantDiscountWon: calculated.instantDiscount, deliveryFeeWon };
}

export function calculateDeliveryFeeBreakdown(
  grossRevenue: unknown,
  value: DeliveryFeeRule,
  adjustments?: DeliveryOrderAdjustments,
): DeliveryFeeBreakdown {
  const revenue = cleanWon(grossRevenue);
  if (revenue <= 0) {
    return { brokerage: 0, payment: 0, delivery: 0, vat: 0, coupon: 0, instantDiscount: 0, advertising: 0, total: 0 };
  }
  const rule = normalizeDeliveryFeeRule(value, DEFAULT_DELIVERY_FEE_RULES.baemin);
  const brokerage = Math.round(revenue * rule.brokeragePct / 100);
  const coupon = Math.min(revenue, adjustments ? cleanWon(adjustments.couponWon) : Math.round(revenue * rule.couponPct / 100));
  const instantDiscount = Math.min(revenue - coupon, adjustments ? cleanWon(adjustments.instantDiscountWon) : rule.instantDiscountWon);
  const paymentBase = Math.max(0, revenue - coupon - instantDiscount);
  const payment = Math.round(paymentBase * rule.paymentPct / 100);
  const delivery = cleanWon(adjustments?.deliveryFeeWon ?? rule.deliveryFeeWon);
  const vat = Math.round((brokerage + payment + delivery) * rule.vatPct / 100);
  const advertising = Math.round(revenue * rule.advertisingPct / 100);
  return {
    brokerage,
    payment,
    delivery,
    vat,
    coupon,
    instantDiscount,
    advertising,
    total: brokerage + payment + delivery + vat + coupon + instantDiscount + advertising,
  };
}

export function allocateDeliveryAmount(revenues: unknown[], amount: unknown) {
  const cleanRevenues = revenues.map((value) => cleanWon(value));
  const revenueTotal = cleanRevenues.reduce((sum, revenue) => sum + revenue, 0);
  const target = cleanWon(amount);
  if (revenueTotal <= 0 || target <= 0) return cleanRevenues.map(() => 0);
  const exact = cleanRevenues.map((revenue) => target * revenue / revenueTotal);
  const allocated = exact.map((value) => Math.floor(value));
  let remainder = target - allocated.reduce((sum, value) => sum + value, 0);
  const priority = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value), revenue: cleanRevenues[index] }))
    .sort((left, right) => right.fraction - left.fraction || right.revenue - left.revenue || left.index - right.index);
  for (let index = 0; index < priority.length && remainder > 0; index += 1, remainder -= 1) {
    allocated[priority[index].index] += 1;
  }
  return allocated;
}

export function allocateDeliveryFeeBreakdown(revenues: number[], fees: DeliveryFeeBreakdown): DeliveryFeeBreakdown[] {
  const keys = ["brokerage", "payment", "delivery", "vat", "coupon", "instantDiscount", "advertising"] as const;
  const rows = revenues.map((): DeliveryFeeBreakdown => ({ brokerage: 0, payment: 0, delivery: 0, vat: 0, coupon: 0, instantDiscount: 0, advertising: 0, total: 0 }));
  for (const key of keys) {
    const allocated = allocateDeliveryAmount(revenues, fees[key]);
    rows.forEach((row, index) => {
      row[key] = allocated[index];
      row.total += allocated[index];
    });
  }
  return rows;
}

export function isDeliveryPlatform(value: unknown): value is DeliveryPlatform {
  return DELIVERY_PLATFORMS.some((platform) => platform.id === value);
}

export function normalizeDeliveryPlatformPrices(value: unknown): DeliveryPlatformPrices {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const prices = value as Record<string, unknown>;
  return Object.fromEntries(DELIVERY_PLATFORMS.flatMap((platform) => {
    const price = Number(prices[platform.id]);
    return Number.isFinite(price) && price > 0 && price <= 1_000_000_000
      ? [[platform.id, Math.round(price)]]
      : [];
  })) as DeliveryPlatformPrices;
}

export function deliveryMenuPrice(
  recipe: { salePrice?: unknown; deliveryPrices?: unknown },
  platform: DeliveryPlatform,
) {
  const saved = normalizeDeliveryPlatformPrices(recipe.deliveryPrices)[platform];
  if (saved) return saved;
  const base = Number(recipe.salePrice);
  return Number.isFinite(base) && base > 0 ? Math.round(base) : 0;
}

export function deliveryPlatformLabel(value: unknown) {
  return DELIVERY_PLATFORMS.find((platform) => platform.id === value)?.label || "Eski delivery";
}

export function deliveryPlatformShortLabel(value: unknown) {
  return DELIVERY_PLATFORMS.find((platform) => platform.id === value)?.shortLabel || "Delivery";
}

export function isDeliverySale(
  sale: { deliveryPlatform?: unknown },
  accountType?: unknown,
) {
  return isDeliveryPlatform(sale.deliveryPlatform) || accountType === "delivery";
}

export function deliveryCommissionPercent(
  sale: { deliveryCommissionPct?: unknown },
  fallbackPercent: unknown,
) {
  const saved = Number(sale.deliveryCommissionPct);
  if (sale.deliveryCommissionPct !== undefined && Number.isFinite(saved)) {
    return Math.min(100, Math.max(0, saved));
  }
  const fallback = Number(fallbackPercent);
  return Number.isFinite(fallback) ? Math.min(100, Math.max(0, fallback)) : 0;
}

export function deliveryCommissionAmount(
  sale: {
    totalRevenue?: unknown;
    deliveryCommissionPct?: unknown;
    deliveryCommissionAmount?: unknown;
  },
  fallbackPercent: unknown,
) {
  const saved = Number(sale.deliveryCommissionAmount);
  if (sale.deliveryCommissionAmount !== undefined && Number.isFinite(saved) && saved >= 0) {
    return Math.round(saved);
  }
  const revenue = Number(sale.totalRevenue);
  if (!Number.isFinite(revenue) || revenue <= 0) return 0;
  return Math.round(revenue * deliveryCommissionPercent(sale, fallbackPercent) / 100);
}

export function allocateDeliveryCommission(revenues: unknown[], percentage: unknown) {
  const cleanRevenues = revenues.map((value) => {
    const revenue = Number(value);
    return Number.isFinite(revenue) && revenue > 0 ? revenue : 0;
  });
  const percent = deliveryCommissionPercent({}, percentage);
  const exact = cleanRevenues.map((revenue) => revenue * percent / 100);
  const allocated = exact.map((value) => Math.floor(value));
  const target = Math.round(cleanRevenues.reduce((sum, revenue) => sum + revenue, 0) * percent / 100);
  let remainder = target - allocated.reduce((sum, value) => sum + value, 0);
  const priority = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value), revenue: cleanRevenues[index] }))
    .sort((left, right) => right.fraction - left.fraction || right.revenue - left.revenue || left.index - right.index);
  for (let index = 0; index < priority.length && remainder > 0; index += 1, remainder -= 1) {
    allocated[priority[index].index] += 1;
  }
  return allocated;
}

export function deliverySoldAt(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "";
  const value = new Date(`${date}T${time}:00+09:00`);
  return Number.isFinite(value.getTime()) ? value.toISOString() : "";
}

// Building a formatter is slow; the options never change, so one is kept for every call
// (a year of delivery rows in the Google Sheets export formats thousands of times).
let seoulTimeFormatter: Intl.DateTimeFormat | undefined;

export function seoulTimeInputValue(value: unknown, fallback = "12:00") {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return fallback;
  seoulTimeFormatter ||= new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = seoulTimeFormatter.formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return hour && minute ? `${hour}:${minute}` : fallback;
}

export function currentSeoulTimeInputValue(now = new Date()) {
  return seoulTimeInputValue(now.toISOString());
}

// A saved batch is one order; line items remain the accounting source of truth.
export function groupDeliveryOrders<T extends { id: string; deliveryBatchId?: string; date: string; soldAt?: string; createdAt?: string }>(sales: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const sale of sales) {
    const key = sale.deliveryBatchId ? `batch:${sale.deliveryBatchId}` : `sale:${sale.id}`;
    const rows = groups.get(key) || [];
    rows.push(sale);
    groups.set(key, rows);
  }
  return [...groups.values()].sort((a, b) => `${b[0].date}|${b[0].soldAt || b[0].createdAt || ""}`.localeCompare(`${a[0].date}|${a[0].soldAt || a[0].createdAt || ""}`));
}
