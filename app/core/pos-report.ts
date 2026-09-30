/**
 * HALO V2 — POS oynasi uchun kunlik hisobot (sof funksiya).
 *
 * Kanallar:
 *  - POS apparati: karta va naqd (soliq ushlanadi, karta — komissiya ham);
 *  - Delivery: har platforma alohida (o'z narxi, ushlanmasi va soliq);
 *  - HALO hisob: naqd pul va hisob-raqamga o'tkazma (soliqsiz) — faqat rahbarga ko'rinadi.
 * Nosavdo chiqimlar alohida: oshxonada yeyilgan ovqat va chiqit (isrof / buzilgan).
 */
import { DELIVERY_PLATFORMS } from "../lib/delivery-sales";
import { isKitchenConsumptionEntry } from "../lib/outflow-classification";
import { saleDeductions } from "./deductions";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value)
  ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
const won = (value: unknown) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
const active = (row: Row) => !row.cancelledAt && row.voided !== true && !["cancelled", "voided"].includes(String(row.status || ""));

export type SalesChannel = "pos" | "delivery" | "halo";

/** Savdo kanali: yozilgan bo'lsa — o'sha; eski savdolarda hisob turidan. */
export function channelOf(sale: Row, accountType: string): SalesChannel {
  if (sale.salesChannel === "pos" || sale.salesChannel === "delivery" || sale.salesChannel === "halo") return sale.salesChannel;
  if (accountType === "delivery" || sale.source === "delivery") return "delivery";
  if (accountType === "card") return "pos";
  // POS apparati hisobotidan import qilingan savdo (HALO HISOB oynasidan emas).
  if (sale.source === "pos" && !String(sale.id || "").startsWith("pos-terminal-sale:")) return "pos";
  return "halo";
}

export interface ChannelTotals { gross: number; tax: number; commission: number; net: number; orders: number }
const empty = (): ChannelTotals => ({ gross: 0, tax: 0, commission: 0, net: 0, orders: 0 });

export interface OutflowTotals { cost: number; count: number }

export interface PosDayReport {
  date: string;
  pos: { card: ChannelTotals; cash: ChannelTotals; total: ChannelTotals };
  delivery: { platforms: Array<{ id: string; label: string } & ChannelTotals>; total: ChannelTotals };
  halo: ChannelTotals;
  meals: OutflowTotals;
  waste: OutflowTotals;
  entries: Array<{
    id: string; kind: "sale" | "meal" | "waste"; channel?: SalesChannel; payment?: string; platform?: string;
    time: string; worker: string; summary: string; amount: number; cost?: number; orderNumber?: string;
  }>;
}

function add(target: ChannelTotals, gross: number, tax: number, commission: number) {
  target.gross += gross;
  target.tax += tax;
  target.commission += commission;
  target.net += gross - tax - commission;
}

export function posDayReport(state: Row, date: string): PosDayReport {
  const accountTypeById = new Map(rows(state.accounts).map((account) => [String(account.id), String(account.type || "")]));
  const report: PosDayReport = {
    date,
    pos: { card: empty(), cash: empty(), total: empty() },
    delivery: { platforms: DELIVERY_PLATFORMS.map((platform) => ({ id: platform.id, label: platform.label, ...empty() })), total: empty() },
    halo: empty(),
    meals: { cost: 0, count: 0 },
    waste: { cost: 0, count: 0 },
    entries: [],
  };
  const recipeName = new Map(rows(state.recipes).map((recipe) => [String(recipe.id), String(recipe.name || "Taom")]));
  const salesByOrder = new Map<string, Row[]>();

  for (const sale of rows(state.sales)) {
    if (sale.date !== date || !active(sale)) continue;
    const cut = saleDeductions(sale, state, accountTypeById);
    const channel = channelOf(sale, cut.accountType);
    const gross = Math.max(0, won(sale.totalRevenue));
    const commission = cut.card + cut.delivery;
    if (channel === "delivery") {
      const platform = report.delivery.platforms.find((item) => item.id === sale.deliveryPlatform);
      if (platform) add(platform, gross, cut.tax, commission);
      add(report.delivery.total, gross, cut.tax, commission);
    } else if (channel === "pos") {
      add(cut.accountType === "card" ? report.pos.card : report.pos.cash, gross, cut.tax, commission);
      add(report.pos.total, gross, cut.tax, commission);
    } else {
      add(report.halo, gross, cut.tax, commission);
    }
    const orderId = String(sale.posOrderId || sale.deliveryBatchId || String(sale.externalId || "").split(":").slice(0, 2).join(":") || sale.id);
    const list = salesByOrder.get(orderId) || [];
    list.push(sale);
    salesByOrder.set(orderId, list);
  }

  // Buyurtmalar ro'yxati (POS oynasi yozuvlari) — eng yangisi tepada.
  for (const order of rows(state.posOrders)) {
    if (order.date !== date) continue;
    const linked = salesByOrder.get(String(order.id)) || rows(state.sales).filter((sale) => sale.deliveryBatchId === order.id && active(sale));
    if (!linked.length) continue;
    const accountType = accountTypeById.get(String(order.accountId)) || String(order.paymentType || "");
    const channel = channelOf({ salesChannel: order.salesChannel, source: order.paymentType === "delivery" ? "delivery" : "" }, accountType);
    for (const [key, value] of [["pos", report.pos.total], ["delivery", report.delivery.total], ["halo", report.halo]] as const) {
      if (key === channel) value.orders += 1;
    }
    if (channel === "pos") (order.paymentType === "card" ? report.pos.card : report.pos.cash).orders += 1;
    if (channel === "delivery") {
      const platform = report.delivery.platforms.find((item) => item.id === order.deliveryPlatform);
      if (platform) platform.orders += 1;
    }
    report.entries.push({
      id: String(order.id), kind: "sale", channel, payment: String(order.paymentType || ""),
      platform: order.deliveryPlatform ? String(order.deliveryPlatform) : undefined,
      orderNumber: String(order.deliveryOrderNumber || order.orderNumber || ""),
      time: String(order.createdAt || ""), worker: String(order.workerName || ""),
      summary: linked.map((sale) => `${recipeName.get(String(sale.recipeId)) || "Taom"} × ${won(sale.quantity)}`).join(", ").slice(0, 200),
      amount: linked.reduce((sum, sale) => sum + won(sale.totalRevenue), 0),
    });
  }

  // POS apparati hisobotidan yuklangan savdolar — har yuklash bitta yozuv (bekor qilish mumkin).
  const imports = new Map<string, { amount: number; count: number; time: string; worker: string; file: string }>();
  for (const sale of rows(state.sales)) {
    const batch = sale.posImport && typeof sale.posImport === "object" ? String((sale.posImport as Row).batch || "") : "";
    if (!batch || sale.date !== date || !active(sale)) continue;
    const item = imports.get(batch) || { amount: 0, count: 0, time: String(sale.createdAt || ""), worker: String(sale.createdByName || ""), file: String((sale.posImport as Row).fileName || "") };
    item.amount += won(sale.totalRevenue); item.count += 1;
    imports.set(batch, item);
  }
  for (const [batch, item] of imports) {
    report.entries.push({ id: `pos-import:${batch}`, kind: "sale", channel: "pos", payment: "import", time: item.time, worker: item.worker, summary: `POS hisobot · ${item.count} xil taom${item.file ? ` · ${item.file}` : ""}`.slice(0, 200), amount: item.amount });
    report.pos.total.orders += 1;
  }

  for (const entry of rows(state.workerConsumptions)) {
    if (entry.date !== date || !active(entry)) continue;
    const cost = Math.max(0, won(Number(entry.totalCost || 0) - Number(entry.expenseOnlyCost || 0)));
    const kitchen = isKitchenConsumptionEntry(entry);
    const bucket = kitchen ? report.meals : report.waste;
    bucket.cost += cost;
    bucket.count += 1;
    report.entries.push({
      id: String(entry.id), kind: kitchen ? "meal" : "waste",
      time: String(entry.createdAt || ""), worker: String(entry.workerName || ""),
      summary: `${String(entry.label || "")}${entry.quantity ? ` × ${Number(entry.quantity)}${entry.unit && entry.unit !== "porsiya" ? ` ${String(entry.unit)}` : ""}` : ""}${entry.reason && !kitchen ? ` · ${String(entry.reason)}` : ""}`.slice(0, 200),
      amount: 0, cost,
    });
  }
  report.entries.sort((left, right) => right.time.localeCompare(left.time));
  return report;
}

/** Oy bo'yicha: oshxonada yeyilgan va chiqit tannarxi alohida (bosh ekran uchun). */
export function outflowSplit(state: Row, from: string, to: string) {
  let meals = 0;
  let waste = 0;
  for (const entry of rows(state.workerConsumptions)) {
    const date = String(entry.date || "");
    if (date < from || date > to || !active(entry)) continue;
    const cost = Math.max(0, won(Number(entry.totalCost || 0) - Number(entry.expenseOnlyCost || 0)));
    if (isKitchenConsumptionEntry(entry)) meals += cost;
    else waste += cost;
  }
  return { meals, waste };
}
