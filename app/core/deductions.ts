/**
 * HALO V2 — avtomatik ushlanmalar: soliq, karta to'lov kompaniyasi komissiyasi, delivery ushlanmasi.
 *
 * Rahbar foizlarni BIR MARTA kiritadi (filial sozlamasi: state.costRules). Har bir savdo
 * saqlanayotganda o'sha paytdagi foiz savdoning o'ziga yoziladi (snapshot) — keyin foiz
 * o'zgartirilsa ham eski savdolar qayta hisoblanmaydi (eski tizim qoidasi, app/lib/sale-financial-snapshots.ts).
 *
 * Qoidalar (eski tizim bilan bir xil):
 *  - Soliq: POS apparati orqali (karta yoki naqd) va delivery savdosidan, savdo × foiz.
 *    HALO hisob (naqd pul va hisob-raqamga o'tkazma) — soliqsiz.
 *  - Karta komissiyasi: faqat karta savdosidan, savdo × foiz. Pul kutilayotgan summadan ayriladi.
 *  - Delivery: har platforma uchun umumiy ushlanma foizi + har buyurtmadan qat'iy summa (₩).
 * Har bir summa savdo bo'yicha bir marta butun wonga yaxlitlanadi.
 */
import { DELIVERY_PLATFORMS, deliveryCombinedPercent, deliveryCommissionAmount, deliveryFeeRuleForPlatform, withSimpleDeliveryRule, type DeliveryPlatform, type DeliveryPlatformRules } from "../lib/delivery-sales";
import { validCostRules } from "../lib/daily-report";
import { saleAccountType, saleCardCommissionPercent } from "../lib/sale-financial-snapshots";

type Row = Record<string, unknown>;

export class DeductionError extends Error {}

export interface DeductionRulesView {
  taxPct: number;
  cardPct: number;
  platforms: Array<{ id: DeliveryPlatform; label: string; pct: number; feeWon: number }>;
}

export interface DeductionRulesInput {
  taxPct: unknown;
  cardPct: unknown;
  platforms?: Array<{ id: unknown; pct: unknown; feeWon: unknown }>;
}

const rulesOf = (state: Row) => (state.costRules && typeof state.costRules === "object" && !Array.isArray(state.costRules)
  ? state.costRules as Row & { deliveryPlatformRules?: DeliveryPlatformRules } : {});

const clampPct = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
};

export function readDeductionRules(state: Row): DeductionRulesView {
  const rules = rulesOf(state);
  return {
    taxPct: clampPct(rules.taxPct),
    cardPct: clampPct(rules.cardCommissionPct),
    platforms: DELIVERY_PLATFORMS.map((platform) => {
      const rule = deliveryFeeRuleForPlatform(rules, platform.id);
      return { id: platform.id, label: platform.label, pct: deliveryCombinedPercent(rule), feeWon: rule.deliveryFeeWon };
    }),
  };
}

function percentInput(value: unknown, label: string): number {
  const text = String(value ?? "").trim().replace(",", ".");
  const number = text === "" ? 0 : Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new DeductionError(`${label}: 0 dan 100 gacha foiz yozing.`);
  return Math.round(number * 100) / 100;
}

function wonInput(value: unknown, label: string): number {
  const text = String(value ?? "").replace(/[\s,₩]/g, "");
  const number = text === "" ? 0 : Number(text);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1_000_000) throw new DeductionError(`${label}: 0 yoki musbat butun summa yozing.`);
  return number;
}

/** Yangi foizlarni filial holatiga yozadi. Boshqa sozlamalar (masalan, "darhol chegirma") saqlanadi. */
export function applyDeductionRules(state: Row, input: DeductionRulesInput): Row {
  const current = rulesOf(state);
  let next: Row & { deliveryPlatformRules?: DeliveryPlatformRules } = {
    ...current,
    taxPct: percentInput(input.taxPct, "Soliq"),
    cardCommissionPct: percentInput(input.cardPct, "Karta komissiyasi"),
  };
  const seen = new Set<string>();
  for (const item of input.platforms || []) {
    const platform = DELIVERY_PLATFORMS.find((entry) => entry.id === item.id);
    if (!platform) throw new DeductionError("Delivery platformasi noto'g'ri.");
    if (seen.has(platform.id)) throw new DeductionError(`${platform.label} ikki marta yuborildi.`);
    seen.add(platform.id);
    const existing = deliveryFeeRuleForPlatform(current, platform.id);
    next = withSimpleDeliveryRule(next, platform.id, {
      combinedPct: percentInput(item.pct, platform.label),
      deliveryFeeWon: wonInput(item.feeWon, `${platform.label} qat'iy summa`),
      instantDiscountWon: existing.instantDiscountWon,
    });
  }
  if (!validCostRules(next)) throw new DeductionError("Foizlarni tekshiring.");
  return { ...state, costRules: next };
}

export interface SaleDeduction { card: number; delivery: number; tax: number; accountType: string }

/** Bitta savdodan avtomatik ushlanmalar (won). Savdoda saqlangan foiz ustun; bo'lmasa — joriy qoida. */
export function saleDeductions(sale: Row, state: Row, accountTypeById: Map<string, string>): SaleDeduction {
  const rules = rulesOf(state);
  const revenue = Math.max(0, Math.round(Number(sale.totalRevenue) || 0));
  const accountType = saleAccountType(sale, accountTypeById.get(String(sale.accountId ?? "account-card")) || "card");
  const card = accountType === "card" ? Math.round(revenue * saleCardCommissionPercent(sale, rules.cardCommissionPct) / 100) : 0;
  const delivery = accountType === "delivery" ? Math.max(0, deliveryCommissionAmount(sale, rules.deliveryCommissionPct)) : 0;
  // Soliq: POS apparati (karta yoki naqd) va delivery savdosidan. HALO hisob (naqd/hisob-raqam) — soliqsiz.
  // Savdoga yozilgan foiz ustun; eski (foizi yozilmagan) savdolarda: karta va delivery — joriy foiz, qolgani — 0.
  const saved = sale.taxPctAtSale === undefined || sale.taxPctAtSale === null || sale.taxPctAtSale === "" ? NaN : Number(sale.taxPctAtSale);
  const taxPct = Number.isFinite(saved) && saved >= 0 && saved <= 100
    ? saved
    : accountType === "card" || accountType === "delivery" ? clampPct(rules.taxPct) : 0;
  const tax = Math.round(revenue * taxPct / 100);
  return { card: Math.min(card, revenue), delivery: Math.min(delivery, revenue), tax, accountType };
}

/** Misol uchun: 10 000 ₩ savdodan nima ushlanadi (sahifada ko'rsatiladi). */
export function exampleDeductions(rules: DeductionRulesView, amount = 10_000) {
  const card = Math.round(amount * rules.cardPct / 100);
  const tax = Math.round(amount * rules.taxPct / 100);
  return {
    amount,
    card: { commission: card, tax, net: amount - card - tax },
    posCash: { tax, net: amount - tax },
    delivery: rules.platforms.map((platform) => {
      const fee = Math.min(amount, Math.round(amount * platform.pct / 100) + platform.feeWon);
      return { id: platform.id, label: platform.label, fee, tax, net: amount - fee - tax };
    }),
  };
}
