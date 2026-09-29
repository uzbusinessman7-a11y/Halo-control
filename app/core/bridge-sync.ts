/**
 * HALO V2 — ko'prikni ishga tushirish va solishtirish.
 *
 * 1. Eski tizim hisoblarini jurnalda yaratadi (bor bo'lsa tegmaydi).
 * 2. Yangi eski yozuvlarni jurnalga yozadi; oldin yozilganlarini o'tkazib yuboradi.
 * 3. Eski tizimda keyinchalik bekor qilingan yozuvlar jurnaldan O'CHIRILMAYDI —
 *    teskari yozuv qo'shiladi (tarix saqlanadi).
 * 4. Eski yozuv summasi o'zgartirilgan bo'lsa — jim o'tib ketmaydi, "o'zgargan" deb ko'rsatiladi.
 * 5. Oxirida har bir pul hisobi eski tizim hisobi bilan wonma-won solishtiriladi.
 */
import { calculateAccountBalances } from "../lib/account-balances";
import type { D1Like, D1StatementLike } from "../lib/full-migration";
import { buildBridgePlan, BRIDGE_ACCOUNTS } from "./bridge";
import { assertScope, LedgerError, validateEntry, type EntryInput, type LedgerScope } from "./ledger";
import { createAccount, ensureLedgerSchema, listAccounts, rawBalances } from "./ledger-store";

type Row = Record<string, unknown>;
const CHUNK_STATEMENTS = 90;

export interface BridgeComparison { oldId: string; name: string; oldBalance: number; ledgerBalance: number; difference: number }
export interface BridgeReport {
  posted: number;
  alreadyPosted: number;
  reversed: number;
  changed: string[];
  /** Avtomatik tuzatilgan (eski versiya teskari yozilib, yangisi qo'shilgan) yozuvlar soni. */
  corrected: number;
  /** Yopilgan kunga tegishli bo'lgani uchun tuzatilmagan o'zgarishlar. */
  blocked: string[];
  invalid: string[];
  unmatched: string[];
  zeroAmount: number;
  comparison: BridgeComparison[];
  ok: boolean;
  ledgerBalanced: boolean;
}

export async function runBridge(db: D1Like, scope: LedgerScope, state: Row, today: string, now = new Date()): Promise<BridgeReport> {
  assertScope(scope);
  await ensureLedgerSchema(db);
  const plan = buildBridgePlan(state, today);

  // 1) Hisoblar.
  let accounts = await listAccounts(db, scope);
  const existingCodes = new Set([...accounts.values()].map((account) => account.code));
  for (const account of [...BRIDGE_ACCOUNTS, ...plan.moneyAccounts]) {
    if (!existingCodes.has(account.code)) await createAccount(db, scope, account, now);
  }
  accounts = await listAccounts(db, scope);
  const idByCode = new Map([...accounts.values()].map((account) => [account.code, account.id]));

  // 2) Jurnaldagi mavjud ko'prik yozuvlari (bitta so'rov).
  const existingRows = await db.prepare(
    `SELECT e.id AS id, e.operation_id AS operation_id, e.date AS date, l.account_id AS account_id, l.amount AS amount
     FROM v2_ledger_entries e JOIN v2_ledger_lines l ON l.entry_id = e.id
     WHERE e.tenant_id = ? AND e.branch_id = ? AND e.operation_id LIKE 'bridge:%'`,
  ).bind(scope.tenantId, scope.branchId).all<{ id: string; operation_id: string; date: string; account_id: string; amount: number }>();
  const existing = new Map<string, { id: string; date: string; key: string[] }>();
  for (const row of existingRows.results) {
    const item = existing.get(row.operation_id) || { id: row.id, date: row.date, key: [] };
    item.key.push(`${row.account_id}:${Number(row.amount)}`);
    existing.set(row.operation_id, item);
  }
  const reversedIds = new Set((await db.prepare(
    "SELECT reverses_id FROM v2_ledger_entries WHERE tenant_id = ? AND branch_id = ? AND reverses_id IS NOT NULL",
  ).bind(scope.tenantId, scope.branchId).all<{ reverses_id: string }>()).results.map((row) => row.reverses_id));

  // Har bir eski yozuvning versiyalari: asl amal raqami, keyin ":ver1", ":ver2"... Amaldagisi — bekor qilinmagan oxirgisi.
  const versions = new Map<string, number>();
  const live = new Map<string, { id: string; date: string; key: string[]; version: number }>();
  for (const [operationId, item] of existing) {
    if (operationId.startsWith("bridge:rev:")) continue;
    const match = operationId.match(/^(.*):ver(\d+)$/);
    const base = match ? match[1] : operationId;
    const version = match ? Number(match[2]) : 0;
    versions.set(base, Math.max(versions.get(base) ?? -1, version));
    if (reversedIds.has(item.id)) continue;
    const current = live.get(base);
    if (!current || current.version < version) live.set(base, { ...item, version });
  }

  const closedRow = await db.prepare("SELECT MAX(date) AS date FROM v2_day_closes WHERE tenant_id = ? AND branch_id = ?")
    .bind(scope.tenantId, scope.branchId).first<{ date: string | null }>();
  const closedThrough = String(closedRow?.date || "");
  const isClosed = (date: string) => Boolean(closedThrough) && date <= closedThrough;

  // 3) Yangi yozuvlar va eski tizimda keyin o'zgartirilganlarni tuzatish (eski versiya teskari yoziladi, yangisi qo'shiladi).
  const toPost: EntryInput[] = [];
  const changed: string[] = [];
  const blocked: string[] = [];
  const invalid: string[] = [];
  let alreadyPosted = 0;
  let corrected = 0;
  const wanted = new Set<string>();
  const reversalOfLive = (item: { id: string; key: string[] }, memo: string): EntryInput => ({
    operationId: `bridge:rev:${item.id}`.slice(0, 120), date: today, kind: "reversal", actor: "Ko'prik", memo, reversesId: item.id,
    lines: item.key.map((pair) => { const at = pair.lastIndexOf(":"); return { accountId: pair.slice(0, at), amount: -Number(pair.slice(at + 1)) }; }),
  });
  for (const bridgeEntry of plan.entries) {
    wanted.add(bridgeEntry.operationId);
    const nextVersion = (versions.get(bridgeEntry.operationId) ?? -1) + 1;
    const entry: EntryInput = {
      operationId: nextVersion ? `${bridgeEntry.operationId}:ver${nextVersion}` : bridgeEntry.operationId,
      date: bridgeEntry.date, kind: bridgeEntry.kind, memo: bridgeEntry.memo, actor: bridgeEntry.actor,
      lines: bridgeEntry.lines.map((line) => ({ accountId: idByCode.get(line.code) || `yo'q:${line.code}`, amount: line.amount })),
    };
    const previous = live.get(bridgeEntry.operationId);
    if (previous) {
      const key = entry.lines.map((line) => `${line.accountId}:${line.amount}`).sort().join("|");
      if (previous.key.slice().sort().join("|") === key && previous.date === entry.date) { alreadyPosted += 1; continue; }
      changed.push(bridgeEntry.source);
      if (isClosed(previous.date) || isClosed(entry.date) || isClosed(today)) {
        blocked.push(`${bridgeEntry.source}: yopilgan kunga tegishli — avtomatik tuzatilmadi`);
        continue;
      }
      try {
        const valid = validateEntry(entry, accounts);
        toPost.push(reversalOfLive(previous, "Eski tizimda o'zgartirildi — eski versiya bekor qilindi"), valid);
        corrected += 1;
      } catch (error) {
        invalid.push(`${bridgeEntry.source}: ${error instanceof LedgerError ? error.message : "noto'g'ri yozuv"}`);
      }
      continue;
    }
    if (isClosed(entry.date)) {
      invalid.push(`${bridgeEntry.source}: ${entry.date} kuni V2 da yopilgan — eski tizimda keyin kiritilgan yozuv`);
      continue;
    }
    try {
      toPost.push(validateEntry(entry, accounts));
    } catch (error) {
      invalid.push(`${bridgeEntry.source}: ${error instanceof LedgerError ? error.message : "noto'g'ri yozuv"}`);
    }
  }

  // 4) Eski tizimda bekor qilingan yozuvlar → teskari yozuv (o'chirilmaydi).
  for (const [base, item] of live) {
    if (wanted.has(base)) continue;
    toPost.push(reversalOfLive(item, "Bekor qilindi: eski tizimda bu yozuv bekor qilingan yoki o'chirilgan"));
  }
  const reversed = toPost.filter((entry) => entry.kind === "reversal").length;

  // 5) Yozish: to'plamlar bilan; bitta yozuv hech qachon ikki to'plamga bo'linmaydi.
  let chunk: D1StatementLike[] = [];
  const flush = async () => { if (chunk.length) { await db.batch(chunk); chunk = []; } };
  for (const entry of toPost) {
    const id = crypto.randomUUID();
    const statements = [
      db.prepare(
        "INSERT INTO v2_ledger_entries (id, tenant_id, branch_id, operation_id, date, kind, memo, actor, reverses_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, scope.tenantId, scope.branchId, entry.operationId, entry.date, entry.kind, entry.memo, entry.actor, entry.reversesId ?? null, now.toISOString()),
      ...entry.lines.map((line, index) => db.prepare(
        "INSERT INTO v2_ledger_lines (id, entry_id, tenant_id, branch_id, account_id, amount) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(`${id}:${String(index).padStart(2, "0")}`, id, scope.tenantId, scope.branchId, line.accountId, line.amount)),
    ];
    if (chunk.length + statements.length > CHUNK_STATEMENTS) await flush();
    chunk.push(...statements);
  }
  await flush();

  // 6) Solishtirish: eski tizim qoldig'i va jurnal qoldig'i, har bir pul hisobi bo'yicha.
  const oldBalances = calculateAccountBalances(state, "9999-12-31").balances;
  const ledger = await rawBalances(db, scope);
  const comparison = plan.moneyAccounts.map((account) => {
    const oldBalance = oldBalances.get(account.oldId) || 0;
    const ledgerBalance = ledger.get(idByCode.get(account.code)!) || 0;
    return { oldId: account.oldId, name: account.name, oldBalance, ledgerBalance, difference: ledgerBalance - oldBalance };
  });
  const grand = [...ledger.values()].reduce((sum, value) => sum + value, 0);
  return {
    posted: toPost.length - reversed, alreadyPosted, reversed, corrected, changed, blocked, invalid, unmatched: plan.unmatched, zeroAmount: plan.zeroAmount,
    comparison, ok: comparison.every((row) => row.difference === 0) && !blocked.length && !invalid.length, ledgerBalanced: grand === 0,
  };
}
