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
const realDate = (value: string) => DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

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
