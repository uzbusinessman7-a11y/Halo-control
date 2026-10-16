/**
 * HALO V2 — «Savdo kunlari»: tanlangan davrdagi HAR BIR kun savdosi bitta ro'yxatda (sof funksiya).
 *
 * Asosiy maqsad: qaysi kunga POS savdosi kiritilgan, qaysi biriga yo'q — bir qarashda ko'rinsin
 * (POS hisobot 2–3 kunda bir, har kun alohida kiritiladi). Shuning uchun savdosi yo'q kunlar ham ro'yxatda turadi.
 *
 * Kanallar «POS» oynasidagi kunlik hisobot bilan bir xil ajratiladi (`channelOf` + `saleDeductions`):
 *  - POS apparati: karta va naqd (Excel hisobot yoki qo'lda);
 *  - HALO hisob: naqd va hisob-raqam (soliqsiz);
 *  - Delivery.
 * Xodim bonusi — eski tizimdagi qoida: kunlik savdoning 800 000 ₩ dan oshgan qismining 10%i (`dailySalesBonus`).
 * Hech narsa yozmaydi.
 */
import { dailySalesBonus } from "../lib/sales-bonus";
import { DELIVERY_PLATFORMS } from "../lib/delivery-sales";
import { isAccountingMonthClosed } from "../lib/month-end";
import { cancelPosOrder, removeSalesById } from "../lib/pos-terminal";
import { cancelClubSale, clubPosOrderId } from "./club";
import { saleDeductions } from "./deductions";
import { channelOf } from "./pos-report";

type Row = Record<string, unknown>;
export class SalesDaysError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Bir ko'rishda ko'pi bilan ~3 oy. */
export const MAX_DAYS = 93;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
const active = (row: Row) => !row.cancelledAt && row.voided !== true && !["cancelled", "voided"].includes(String(row.status || ""));
const realDate = (value: string) => {
  const ms = DATE.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
};

export interface SalesDay {
  date: string;
  /** 0 — yakshanba … 6 — shanba */
  weekday: number;
  pos: { card: number; cash: number; total: number; excel: boolean; manual: boolean };
  halo: number;
  delivery: number;
  total: number;
  bonus: number;
  today: boolean;
}

/** from..to (ikkalasi ham kiradi), eskisidan yangisiga. */
export function dateList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); at <= end && out.length <= MAX_DAYS; at += 86_400_000) {
    out.push(new Date(at).toISOString().slice(0, 10));
  }
  return out;
}

export function salesDays(state: Row, fromInput: unknown, toInput: unknown, today: string) {
  const from = String(fromInput ?? "") || `${today.slice(0, 7)}-01`;
  let to = String(toInput ?? "") || today;
  if (!realDate(from) || !realDate(to)) throw new SalesDaysError("Sanani tekshiring.");
  if (to > today) to = today;
  if (from > to) throw new SalesDaysError("Boshlanish sanasi tugash sanasidan keyin bo'lmaydi.");
  const dates = dateList(from, to);
  if (dates.length > MAX_DAYS) throw new SalesDaysError(`Bir martada ko'pi bilan ${MAX_DAYS} kun ko'rinadi.`);

  const days = new Map<string, SalesDay>(dates.map((date) => [date, {
    date, weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    pos: { card: 0, cash: 0, total: 0, excel: false, manual: false }, halo: 0, delivery: 0, total: 0, bonus: 0, today: date === today,
  }]));
  const accountTypeById = new Map(rows(state.accounts).map((account) => [String(account.id), String(account.type || "")]));
  for (const sale of rows(state.sales)) {
    const day = days.get(String(sale.date || ""));
    if (!day || !active(sale)) continue;
    const gross = Math.max(0, Math.round(Number(sale.totalRevenue) || 0));
    const { accountType } = saleDeductions(sale, state, accountTypeById);
    const channel = channelOf(sale, accountType);
    if (channel === "pos") {
      if (accountType === "card") day.pos.card += gross; else day.pos.cash += gross;
      day.pos.total += gross;
      if (sale.posImport) day.pos.excel = true; else day.pos.manual = true;
    } else if (channel === "delivery") day.delivery += gross;
    else day.halo += gross;
    day.total += gross;
  }
  const list = [...days.values()];
  for (const day of list) day.bonus = dailySalesBonus(day.total).bonus;
  const past = list.filter((day) => !day.today);
  const totals = list.reduce((sum, day) => ({
    pos: sum.pos + day.pos.total, posCard: sum.posCard + day.pos.card, posCash: sum.posCash + day.pos.cash,
    halo: sum.halo + day.halo, delivery: sum.delivery + day.delivery, total: sum.total + day.total, bonus: sum.bonus + day.bonus,
  }), { pos: 0, posCard: 0, posCash: 0, halo: 0, delivery: 0, total: 0, bonus: 0 });
  return {
    from, to, today,
    days: list.reverse(),
    totals,
    /** Bugundan oldingi kunlar: POS kiritilmagan (eng yangisi birinchi). Bugun hisobga olinmaydi — kun tugamagan. */
    missingPos: past.filter((day) => day.pos.total === 0).map((day) => day.date).reverse(),
    /** Bugundan oldingi kunlar: hech qanday savdo yozilmagan. */
    empty: past.filter((day) => day.total === 0).map((day) => day.date).reverse(),
    enteredDays: list.filter((day) => day.total > 0).length,
  };
}

export interface DayEntry {
  key: string;
  /** ISO vaqt (bo'lmasa — bo'sh) */
  time: string;
  worker: string;
  /** «POS karta», «POS hisobot (Excel)», «Naqd», «Hisob-raqam», «Coupang» … */
  label: string;
  channel: "pos" | "halo" | "delivery";
  summary: string;
  amount: number;
}

/**
 * Bir kunning hamma savdo yozuvlari — «Savdo kunlari»da qatorni ochganda shu oynada ko'rinadi.
 * Bir buyurtma (yoki bir POS Excel yuklash) — bitta yozuv; buyurtmasiz eski savdolar — har biri alohida.
 * Yozuvlar yig'indisi o'sha kunning jamisiga wonma-won teng (hech bir savdo tushib qolmaydi).
 */
export function salesDayDetail(state: Row, dateInput: unknown) {
  const { date, entries } = dayGroups(state, dateInput);
  return { date, entries: entries.map(({ saleIds: _ids, ...entry }) => entry), total: entries.reduce((sum, entry) => sum + entry.amount, 0) };
}

function dayGroups(state: Row, dateInput: unknown) {
  const date = String(dateInput ?? "");
  if (!realDate(date)) throw new SalesDaysError("Sanani tekshiring.");
  const accountTypeById = new Map(rows(state.accounts).map((account) => [String(account.id), String(account.type || "")]));
  const orders = new Map(rows(state.posOrders).map((order) => [String(order.id), order]));
  const recipeName = new Map(rows(state.recipes).map((recipe) => [String(recipe.id), String(recipe.name || "")]));
  const platformName = new Map<string, string>(DELIVERY_PLATFORMS.map((platform) => [platform.id, platform.shortLabel]));
  type Group = DayEntry & { lines: string[]; file: string; excel: boolean; accountType: string; platform: string; saleIds: string[] };
  const groups = new Map<string, Group>();
  for (const sale of rows(state.sales)) {
    if (String(sale.date || "") !== date || !active(sale)) continue;
    const gross = Math.max(0, Math.round(Number(sale.totalRevenue) || 0));
    const { accountType } = saleDeductions(sale, state, accountTypeById);
    const channel = channelOf(sale, accountType);
    const posImport = sale.posImport && typeof sale.posImport === "object" ? sale.posImport as Row : null;
    const batch = posImport ? String(posImport.batch || "") : "";
    const key = batch ? `import:${batch}` : String(sale.posOrderId || sale.deliveryBatchId || String(sale.externalId || "").split(":").slice(0, 2).join(":") || sale.id || "");
    const order = orders.get(key);
    let group = groups.get(key);
    if (!group) {
      group = {
        key, time: String(order?.createdAt || sale.createdAt || sale.soldAt || ""), worker: String(order?.workerName || sale.createdByName || ""),
        label: "", channel, summary: "", amount: 0, lines: [], file: posImport ? String(posImport.fileName || "") : "",
        excel: Boolean(sale.posImport), accountType, platform: String(sale.deliveryPlatform || order?.deliveryPlatform || ""), saleIds: [],
      };
      groups.set(key, group);
    }
    const name = recipeName.get(String(sale.recipeId || "")) || String(sale.recipeName || sale.name || sale.note || "").trim() || "Savdo";
    const quantity = Math.round(Number(sale.quantity) || 0);
    group.lines.push(quantity > 0 ? `${name} × ${quantity}` : name);
    group.amount += gross;
    group.saleIds.push(String(sale.id || ""));
  }
  const entries: Array<DayEntry & { saleIds: string[] }> = [...groups.values()].map((group) => ({
    key: group.key, time: group.time, worker: group.worker, channel: group.channel, amount: group.amount,
    label: group.excel ? "POS hisobot (Excel)"
      : group.channel === "pos" ? (group.accountType === "card" ? "POS karta" : "POS naqd")
      : group.channel === "delivery" ? (platformName.get(group.platform) || "Delivery")
      : group.accountType === "bank" ? "Hisob-raqam" : "Naqd",
    summary: (group.excel ? `${group.lines.length} xil taom${group.file ? ` · ${group.file}` : ""}` : group.lines.join(", ")).slice(0, 200),
    saleIds: group.saleIds.filter(Boolean),
  })).sort((left, right) => (right.time || "").localeCompare(left.time || "") || right.amount - left.amount);
  return { date, entries };
}

const CLUB_PREFIX = clubPosOrderId("");

/**
 * Adashib kiritilgan savdoni bekor qilish (rahbar, «Savdo kunlari» → kun → yozuv). Tizimdagi tekshirilgan yo'llar:
 *  - HALO HISOB / Kiritish buyurtmasi (POS karta, POS naqd, naqd, hisob-raqam, delivery) → `cancelPosOrder`;
 *  - Telegram do'kon savdosi → `cancelClubSale` (kuryer puli yozuvi ham olib tashlanadi);
 *  - POS hisobot (Excel) yuklashi — faqat shu kundagi qismi → `removeSalesById`;
 *  - buyurtmasiz eski savdo → `removeSalesById`.
 * Hamma holatda ombor qaytariladi. Holatning oldingi nusxasi «O'zgarishlar tarixi»da sababi bilan qoladi.
 * Yopilgan oy — bekor qilinmaydi (kassada yopilgan kun yo'nalishda tekshiriladi).
 */
export function cancelSalesEntry(state: Row, dateInput: unknown, keyInput: unknown) {
  const { date, entries } = dayGroups(state, dateInput);
  const key = String(keyInput ?? "");
  const entry = entries.find((item) => item.key === key);
  if (!entry || !entry.saleIds.length) throw new SalesDaysError("Yozuv topilmadi. Sahifani yangilang.", 404);
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new SalesDaysError(`${date.slice(0, 7)} oyi yopilgan — bekor qilib bo'lmaydi.`, 409);
  const isOrder = rows(state.posOrders).some((order) => String(order.id) === key);
  const club = isOrder && key.startsWith(CLUB_PREFIX) ? key.slice(CLUB_PREFIX.length) : "";
  const next = club ? cancelClubSale(state, club)
    : isOrder && key.startsWith("pos-order:") ? cancelPosOrder(state, key).state as Row
    : removeSalesById(state, new Set(entry.saleIds)) as Row;
  const { saleIds: _ids, ...shown } = entry;
  return { state: next, result: { entry: shown, clubOrderId: club } };
}
