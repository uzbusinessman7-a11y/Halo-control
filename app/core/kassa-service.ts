/**
 * HALO V2 — kassa xizmati: ekranlar uchun yagona kirish nuqtasi.
 *
 * Har bir chaqiruvda eski tizim bilan ko'prik yangilanadi (takror yozmaydi),
 * shuning uchun V2 ekranlari doim eng so'nggi savdo va xarajatlarni ko'radi.
 *
 * Rollar:
 *  - Xodim: faqat o'z filialida bugungi kassani ko'r sanaydi. Hech qanday summa ko'rmaydi.
 *  - Rahbar: holat, kunni yopish, karta/delivery puli tushishi.
 */
import { buildBridgePlan, moneyAccountCode } from "./bridge";
import { runBridge, type BridgeReport } from "./bridge-sync";
import { displayBalance, LedgerError, type LedgerAccount, type LedgerScope } from "./ledger";
import {
  closeDay, listAccounts, rawBalances, receivablesReport, recordSettlement, reviewDay, submitBlindCount,
} from "./ledger-store";
import type { D1Like } from "../lib/full-migration";

type Row = Record<string, unknown>;
export type AccountRole = "cash" | "bank" | "receivable" | "other";

export interface MoneyAccountView { id: string; name: string; role: AccountRole }

/** Eski tizim hisob turidan V2 dagi vazifasi. */
export function roleOfOldType(type: unknown): AccountRole {
  if (type === "cash") return "cash";
  if (type === "bank") return "bank";
  if (type === "card" || type === "delivery") return "receivable";
  return "other";
}

async function syncAndMap(db: D1Like, scope: LedgerScope, state: Row, today: string) {
  const bridge = await runBridge(db, scope, state, today);
  const accounts = await listAccounts(db, scope);
  const byCode = new Map([...accounts.values()].map((account) => [account.code, account]));
  const money: Array<MoneyAccountView & { account: LedgerAccount }> = [];
  for (const old of (Array.isArray(state.accounts) ? state.accounts : []) as Row[]) {
    const account = byCode.get(moneyAccountCode(String(old.id)));
    if (account) money.push({ id: account.id, name: account.name, role: roleOfOldType(old.type), account });
  }
  return { bridge, accounts, money };
}

/** Xodim ko'radigan narsa: faqat sanaladigan kassalar nomi (summasiz). */
export async function staffView(db: D1Like, scope: LedgerScope, state: Row, today: string) {
  const { money } = await syncAndMap(db, scope, state, today);
  return { date: today, cashAccounts: money.filter((item) => item.role === "cash").map(({ id, name }) => ({ id, name })) };
}

export async function staffCount(db: D1Like, scope: LedgerScope, state: Row, today: string, input: { operationId: string; actor: string; counts: Record<string, number> }) {
  await syncAndMap(db, scope, state, today);
  return submitBlindCount(db, scope, { operationId: input.operationId, date: today, actor: input.actor, counts: input.counts });
}

export interface OwnerSummary {
  date: string;
  balances: Array<MoneyAccountView & { balance: number }>;
  receivables: Awaited<ReturnType<typeof receivablesReport>>;
  days: Array<{ date: string; counted: boolean; closed: boolean; variance: number | null; countedBy: string | null }>;
  bridge: Pick<BridgeReport, "ok" | "posted" | "changed" | "invalid" | "unmatched">;
}

/** Rahbar bosh ekrani: pul qayerda, nima kutilmoqda, qaysi kunlar yopilmagan. */
export async function ownerSummary(db: D1Like, scope: LedgerScope, state: Row, today: string, lookbackDays = 14): Promise<OwnerSummary> {
  const { bridge, money } = await syncAndMap(db, scope, state, today);
  const raw = await rawBalances(db, scope);
  const balances = money.map(({ id, name, role, account }) => ({ id, name, role, balance: displayBalance(account, raw.get(id) || 0) }));
  const receivables = await receivablesReport(db, scope, money.filter((item) => item.role === "receivable").map((item) => item.id), today);

  const from = new Date(Date.parse(`${today}T00:00:00Z`) - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const activity = await db.prepare(
    "SELECT DISTINCT date FROM v2_ledger_entries WHERE tenant_id = ? AND branch_id = ? AND date >= ? AND date <= ? AND kind IN ('sale','expense','income','transfer')",
  ).bind(scope.tenantId, scope.branchId, from, today).all<{ date: string }>();
  const counts = await db.prepare(
    "SELECT date, actor FROM v2_cash_counts WHERE tenant_id = ? AND branch_id = ? AND date >= ? ORDER BY submitted_at",
  ).bind(scope.tenantId, scope.branchId, from).all<{ date: string; actor: string }>();
  const closes = await db.prepare(
    "SELECT date, variance_total FROM v2_day_closes WHERE tenant_id = ? AND branch_id = ? AND date >= ?",
  ).bind(scope.tenantId, scope.branchId, from).all<{ date: string; variance_total: number }>();
  const countedBy = new Map(counts.results.map((row) => [row.date, row.actor]));
  const closedVariance = new Map(closes.results.map((row) => [row.date, Number(row.variance_total)]));
  const dates = new Set([...activity.results.map((row) => row.date), ...countedBy.keys(), ...closedVariance.keys()]);
  const days = [...dates].sort().reverse().map((date) => ({
    date,
    counted: countedBy.has(date),
    closed: closedVariance.has(date),
    variance: closedVariance.has(date) ? closedVariance.get(date)! : null,
    countedBy: countedBy.get(date) ?? null,
  }));
  return { date: today, balances, receivables, days, bridge: { ok: bridge.ok, posted: bridge.posted, changed: bridge.changed, invalid: bridge.invalid, unmatched: bridge.unmatched } };
}

export async function ownerReview(db: D1Like, scope: LedgerScope, state: Row, today: string, date: string) {
  await syncAndMap(db, scope, state, today);
  return reviewDay(db, scope, date);
}

export async function ownerClose(db: D1Like, scope: LedgerScope, state: Row, today: string, input: { date: string; note: string; reviewer: string; operationId: string }) {
  if (input.date > today) throw new LedgerError("Kelajakdagi kunni yopib bo'lmaydi.");
  await syncAndMap(db, scope, state, today);
  return closeDay(db, scope, input);
}

export async function ownerSettle(
  db: D1Like, scope: LedgerScope, state: Row, today: string,
  input: { operationId: string; date: string; actor: string; fromAccountId: string; toAccountId: string; received: number; fee: number; memo?: string },
) {
  if (input.date > today) throw new LedgerError("Kelajakdagi sana kiritilmaydi.");
  const { money } = await syncAndMap(db, scope, state, today);
  const from = money.find((item) => item.id === input.fromAccountId);
  const to = money.find((item) => item.id === input.toAccountId);
  if (!from || from.role !== "receivable") throw new LedgerError("Pul qayerdan tushganini tanlang (karta yoki delivery).");
  if (!to || (to.role !== "bank" && to.role !== "cash")) throw new LedgerError("Pul qaysi hisobga tushganini tanlang (bank yoki kassa).");
  return recordSettlement(db, scope, input);
}

/** Sinov va hisobotlar uchun: reja nechta yozuvni ko'prikdan o'tkazishi kerakligi. */
export function plannedBridgeEntries(state: Row, today: string) {
  return buildBridgePlan(state, today).entries.length;
}
