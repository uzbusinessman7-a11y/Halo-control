/**
 * HALO V2 — oy yakuni (davr) sanog'i: pul, ombor va qarzlar bir sanaga haqiqatda sanaladi.
 *
 * Sanoq "ko'r" usulda kiritiladi (dastur qoldig'i kiritishda ko'rsatilmaydi), keyin tizim bilan
 * solishtiriladi. Yozuvlar faqat qo'shiladi: qayta sanalsa, oxirgisi amal qiladi, tarix saqlanadi.
 * Bu sanoq yangi tizimga to'liq o'tishda tasdiqlangan boshlang'ich qoldiq bo'ladi.
 */
import { syncAndMap } from "./kassa-service";
import { runStockBridge, stockItemCode } from "./stock-bridge";
import { runDebtBridge } from "./debt-bridge";
import { displayBalance, isIsoDate, LedgerError, assertScope, type LedgerScope } from "./ledger";
import { rawBalances } from "./ledger-store";
import { fromMilli, stockBalances, toMilli } from "./stock";
import { partyBalances } from "./debts";
import { isExpenseOnlyInventory } from "../lib/vegetable-expenses";
import type { D1Like } from "../lib/full-migration";

type Row = Record<string, unknown>;
export type CountDomain = "money" | "stock" | "debt";

export const PERIOD_COUNT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS v2_period_counts (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, operation_id TEXT NOT NULL,
    count_date TEXT NOT NULL, domain TEXT NOT NULL CHECK (domain IN ('money','stock','debt')), ref_id TEXT NOT NULL,
    name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '', system_milli INTEGER NOT NULL, counted_milli INTEGER NOT NULL,
    unit_cost REAL, note TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, operation_id, domain, ref_id)
  )`,
  `CREATE INDEX IF NOT EXISTS v2_period_counts_date ON v2_period_counts (tenant_id, branch_id, count_date)`,
  `CREATE TRIGGER IF NOT EXISTS v2_period_counts_no_update BEFORE UPDATE ON v2_period_counts
    BEGIN SELECT RAISE(ABORT, 'HALO: sanoq o''zgartirilmaydi — qayta sanang'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_period_counts_no_delete BEFORE DELETE ON v2_period_counts
    BEGIN SELECT RAISE(ABORT, 'HALO: sanoq o''chirilmaydi'); END`,
];

export interface CountLine {
  domain: CountDomain; refId: string; name: string; unit: string; unitCost: number | null;
  /** Tizim qoldig'i (pul/qarz — won, ombor — birlik). */
  system: number;
  counted: number | null; difference: number | null; differenceWon: number | null; note: string; countedBy: string | null; countedAt: string | null;
}
export interface CountSheet {
  date: string; lines: CountLine[];
  totals: { money: number; stock: number; debt: number; counted: number; total: number };
}

export async function ensurePeriodCountSchema(db: D1Like) {
  await db.batch(PERIOD_COUNT_SCHEMA.map((sql) => db.prepare(sql)));
}

/** Sanoq varag'i: hamma sanaladigan narsalar, tizim qoldig'i (sana oxiriga) va oxirgi sanoq. */
export async function countSheet(db: D1Like, scope: LedgerScope, state: Row, today: string, date: string): Promise<CountSheet> {
  assertScope(scope);
  if (!isIsoDate(date) || date > today) throw new LedgerError("Sanoq sanasi noto'g'ri (kelajak bo'lmasin).");
  await ensurePeriodCountSchema(db);
  const { money } = await syncAndMap(db, scope, state, today);
  await runStockBridge(db, scope, state, today);
  const debt = await runDebtBridge(db, scope, state, today);
  const raw = await rawBalances(db, scope, date);
  const stock = await stockBalances(db, scope, date);
  const parties = await partyBalances(db, scope, date);

  const lines: CountLine[] = [];
  for (const item of money) {
    if (item.role === "other") continue;
    lines.push(blank("money", item.id, item.name, "₩", null, displayBalance(item.account, raw.get(item.id) || 0)));
  }
  const inventory = (Array.isArray(state.inventory) ? state.inventory : []) as Row[];
  for (const item of inventory) {
    if (typeof item.id !== "string" || !item.id || isExpenseOnlyInventory(item)) continue;
    const id = `${scope.tenantId}:${scope.branchId}:${stockItemCode(item.id)}`;
    const cost = Number(item.unitCost);
    lines.push(blank("stock", id, String(item.name || item.id), String(item.unit || ""), Number.isFinite(cost) && cost > 0 ? cost : null, fromMilli(stock.get(id) || 0)));
  }
  for (const party of debt.parties) lines.push(blank("debt", party.partyId, party.name, "₩", null, parties.get(party.partyId) || 0));

  const saved = (await db.prepare(
    `SELECT domain, ref_id, counted_milli, note, actor, created_at FROM v2_period_counts
     WHERE tenant_id = ? AND branch_id = ? AND count_date = ? ORDER BY created_at`,
  ).bind(scope.tenantId, scope.branchId, date).all<{ domain: CountDomain; ref_id: string; counted_milli: number; note: string; actor: string; created_at: string }>()).results;
  const latest = new Map(saved.map((row) => [`${row.domain}|${row.ref_id}`, row]));
  for (const line of lines) {
    const row = latest.get(`${line.domain}|${line.refId}`);
    if (!row) continue;
    line.counted = fromMilli(Number(row.counted_milli));
    line.difference = fromMilli(Number(row.counted_milli) - toMilli(line.system));
    line.differenceWon = line.domain === "stock" ? (line.unitCost ? Math.round(line.difference * line.unitCost) : null) : line.difference;
    line.note = row.note; line.countedBy = row.actor; line.countedAt = row.created_at;
  }
  const sum = (domain: CountDomain) => lines.filter((line) => line.domain === domain).reduce((total, line) => total + (line.differenceWon || 0), 0);
  const totals = { money: sum("money"), stock: sum("stock"), debt: sum("debt"), counted: lines.filter((line) => line.counted != null).length, total: lines.length };
  return { date, lines, totals };
}

function blank(domain: CountDomain, refId: string, name: string, unit: string, unitCost: number | null, system: number): CountLine {
  return { domain, refId, name, unit, unitCost, system, counted: null, difference: null, differenceWon: null, note: "", countedBy: null, countedAt: null };
}

export interface CountInput { domain: CountDomain; refId: string; counted: number; note?: string }

/** Sanoqni saqlash. Pul va qarz — butun won; ombor — 0,001 aniqlikda. Tizim qoldig'i shu paytdagi holatdan olinadi. */
export async function saveCounts(
  db: D1Like, scope: LedgerScope, state: Row, today: string,
  input: { date: string; operationId: string; actor: string; counts: CountInput[] }, now = new Date(),
): Promise<{ saved: number; sheet: CountSheet }> {
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(String(input.operationId || ""))) throw new LedgerError("Yozuv raqami noto'g'ri.");
  if (!String(input.actor || "").trim()) throw new LedgerError("Kim sanagani ko'rsatilishi shart.");
  if (!Array.isArray(input.counts) || !input.counts.length) throw new LedgerError("Hech narsa kiritilmagan.");
  if (input.counts.length > 1000) throw new LedgerError("Juda ko'p qator.");
  const sheet = await countSheet(db, scope, state, today, input.date);
  const byKey = new Map(sheet.lines.map((line) => [`${line.domain}|${line.refId}`, line]));
  const statements = [];
  for (const count of input.counts) {
    const line = byKey.get(`${count.domain}|${count.refId}`);
    if (!line) throw new LedgerError("Sanoq qatori topilmadi — sahifani yangilang.");
    const value = Number(count.counted);
    if (!Number.isFinite(value) || Math.abs(value) > 1e11) throw new LedgerError(`${line.name}: son noto'g'ri.`);
    if (line.domain !== "stock" && !Number.isSafeInteger(value)) throw new LedgerError(`${line.name}: butun won kiriting.`);
    if (line.domain !== "debt" && value < 0) throw new LedgerError(`${line.name}: manfiy bo'lishi mumkin emas.`);
    const note = String(count.note || "").trim().slice(0, 200);
    statements.push(db.prepare(
      `INSERT INTO v2_period_counts (id, tenant_id, branch_id, operation_id, count_date, domain, ref_id, name, unit, system_milli, counted_milli, unit_cost, note, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, branch_id, operation_id, domain, ref_id) DO NOTHING`,
    ).bind(crypto.randomUUID(), scope.tenantId, scope.branchId, input.operationId, input.date, line.domain, line.refId, line.name, line.unit,
      toMilli(line.system), toMilli(value), line.unitCost, note, String(input.actor).trim().slice(0, 80), now.toISOString()));
  }
  for (let index = 0; index < statements.length; index += 90) await db.batch(statements.slice(index, index + 90));
  return { saved: statements.length, sheet: await countSheet(db, scope, state, today, input.date) };
}
