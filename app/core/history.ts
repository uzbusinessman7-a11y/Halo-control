/**
 * HALO V2 — o'zgarishlar tarixi: har bir bekor qilish, keyin o'zgartirish, qarz tuzatish va kassa farqi
 * bitta ro'yxatda. "Kim qachon nimani o'zgartirdi" — yashirin o'zgarish qolmaydi.
 * Faqat o'qiydi.
 */
import { assertScope, type LedgerScope } from "./ledger";
import { ensureLedgerSchema } from "./ledger-store";
import { ensureStockSchema } from "./stock";
import { ensureDebtSchema } from "./debts";
import { ensurePayrollSchema } from "./payroll-ledger";
import type { D1Like } from "../lib/full-migration";

export type HistoryArea = "pul" | "ombor" | "qarz" | "maosh" | "kassa";
export interface HistoryItem {
  at: string; date: string; area: HistoryArea; what: string; detail: string;
  /** Won (ombor uchun — miqdor matni detail ichida). */
  amount: number | null; originalDate: string | null; severity: "bad" | "warn" | "info";
}

const KIND: Record<string, string> = { sale: "Savdo", expense: "Xarajat", income: "Kirim", transfer: "O'tkazma", opening: "Ochilish", settlement: "Karta puli tushishi" };

export async function historyReport(db: D1Like, scope: LedgerScope, limit = 300): Promise<HistoryItem[]> {
  assertScope(scope);
  await ensureLedgerSchema(db);
  await ensureStockSchema(db);
  await ensureDebtSchema(db);
  await ensurePayrollSchema(db);
  const t = [scope.tenantId, scope.branchId];
  const items: HistoryItem[] = [];

  const money = await db.prepare(
    `SELECT r.created_at AS at, r.date AS date, r.memo AS memo, r.actor AS actor, o.date AS odate, o.kind AS okind, o.memo AS omemo,
       (SELECT SUM(ABS(amount)) FROM v2_ledger_lines WHERE entry_id = o.id) / 2 AS amount
     FROM v2_ledger_entries r JOIN v2_ledger_entries o ON o.id = r.reverses_id
     WHERE r.tenant_id = ? AND r.branch_id = ? ORDER BY r.created_at DESC LIMIT ?`,
  ).bind(...t, limit).all<{ at: string; date: string; memo: string; actor: string; odate: string; okind: string; omemo: string; amount: number }>();
  for (const row of money.results) {
    items.push({
      at: row.at, date: row.date, area: "pul", what: `${KIND[row.okind] || row.okind} bekor qilindi`,
      detail: [row.memo, row.omemo].filter(Boolean).join(" · "), amount: Math.round(Number(row.amount) || 0), originalDate: row.odate,
      severity: /o'zgartirildi/.test(row.memo) ? "warn" : "bad",
    });
  }

  const closes = await db.prepare(
    "SELECT closed_at AS at, date, variance_total AS v, reviewer, note FROM v2_day_closes WHERE tenant_id = ? AND branch_id = ? AND variance_total <> 0 ORDER BY closed_at DESC LIMIT ?",
  ).bind(...t, limit).all<{ at: string; date: string; v: number; reviewer: string; note: string }>();
  for (const row of closes.results) {
    items.push({ at: row.at, date: row.date, area: "kassa", what: Number(row.v) < 0 ? "Kassa kamomadi" : "Kassada ortiqcha pul", detail: `${row.reviewer}: ${row.note || "sabab yozilmagan"}`, amount: Number(row.v), originalDate: row.date, severity: Number(row.v) < 0 ? "bad" : "warn" });
  }

  const stock = await db.prepare(
    `SELECT r.created_at AS at, r.date AS date, r.memo AS memo, o.date AS odate, o.kind AS okind, o.quantity_milli AS q, o.unit_cost AS cost, i.name AS name, i.unit AS unit
     FROM v2_stock_moves r JOIN v2_stock_moves o ON o.id = r.reverses_id JOIN v2_stock_items i ON i.id = o.item_id
     WHERE r.tenant_id = ? AND r.branch_id = ? ORDER BY r.created_at DESC LIMIT ?`,
  ).bind(...t, limit).all<{ at: string; date: string; memo: string; odate: string; okind: string; q: number; cost: number | null; name: string; unit: string }>();
  const STOCK_KIND: Record<string, string> = { receipt: "Kirim", sale: "Savdo sarfi", waste: "Chiqit", count: "Sanoq", adjustment: "Qoldiq tuzatish" };
  for (const row of stock.results) {
    const qty = Number(row.q) / 1000;
    items.push({
      at: row.at, date: row.date, area: "ombor", what: `${row.name}: ${STOCK_KIND[row.okind] || row.okind} bekor qilindi`,
      detail: `${qty.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${row.unit} · ${row.memo}`,
      amount: row.cost ? Math.round(Math.abs(qty) * Number(row.cost)) : null, originalDate: row.odate, severity: /o'zgartirildi/.test(row.memo) ? "warn" : "bad",
    });
  }

  const debts = await db.prepare(
    `SELECT m.created_at AS at, m.date AS date, m.kind AS kind, m.amount AS amount, m.memo AS memo, p.name AS name,
       (SELECT date FROM v2_party_moves o WHERE o.id = m.reverses_id) AS odate
     FROM v2_party_moves m JOIN v2_parties p ON p.id = m.party_id
     WHERE m.tenant_id = ? AND m.branch_id = ? AND m.kind IN ('reversal','adjustment') ORDER BY m.created_at DESC LIMIT ?`,
  ).bind(...t, limit).all<{ at: string; date: string; kind: string; amount: number; memo: string; name: string; odate: string | null }>();
  for (const row of debts.results) {
    items.push({
      at: row.at, date: row.date, area: "qarz", what: `${row.name}: ${row.kind === "adjustment" ? "boshlang'ich qarz tuzatildi" : "yozuv bekor qilindi"}`,
      detail: row.memo, amount: Number(row.amount), originalDate: row.odate, severity: "warn",
    });
  }

  const pay = await db.prepare(
    `SELECT m.created_at AS at, m.date AS date, m.amount AS amount, m.memo AS memo, m.month AS month, e.name AS name,
       (SELECT kind FROM v2_pay_moves o WHERE o.id = m.reverses_id) AS okind
     FROM v2_pay_moves m JOIN v2_employees e ON e.id = m.employee_id
     WHERE m.tenant_id = ? AND m.branch_id = ? AND m.kind = 'reversal' ORDER BY m.created_at DESC LIMIT ?`,
  ).bind(...t, limit).all<{ at: string; date: string; amount: number; memo: string; month: string; name: string; okind: string | null }>();
  const PAY_KIND: Record<string, string> = { earned: "ish kuni", paid_leave: "dam kuni", rounding: "yaxlitlash", bonus: "bonus", deduction: "ushlanma", advance: "avans", payment: "to'lov" };
  for (const row of pay.results) {
    items.push({
      at: row.at, date: row.date, area: "maosh", what: `${row.name}: ${PAY_KIND[row.okind || ""] || "yozuv"} (${row.month}) ${/o'zgartirildi/.test(row.memo) ? "o'zgartirildi" : "bekor qilindi"}`,
      detail: row.memo, amount: -Number(row.amount), originalDate: row.month, severity: row.okind === "payment" || row.okind === "advance" ? "bad" : "warn",
    });
  }

  return items.sort((left, right) => right.at.localeCompare(left.at)).slice(0, limit);
}
