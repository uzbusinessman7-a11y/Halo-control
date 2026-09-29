/**
 * HALO V2 — pul jurnalining saqlash qatlami (Cloudflare D1 / SQLite).
 *
 * Himoya bazaning o'zida:
 * - v2_ledger_entries, v2_ledger_lines, v2_cash_counts, v2_day_closes jadvallarida
 *   UPDATE va DELETE triggerlar bilan TAQIQLANGAN. Kodda xato bo'lsa ham,
 *   kimdir bazaga to'g'ridan-to'g'ri kirsa ham yozuv o'zgarmaydi.
 * - Yozuv va uning qatorlari bitta tranzaksiyada (batch) yoziladi: yarim yozuv bo'lmaydi.
 * - Yopilgan kunga yangi yozuv kiritilmaydi (tuzatish — keyingi sanada teskari yozuv).
 * - Har bir jadvalda tenant_id: bir bazada ko'p biznes, bir-birini ko'rmaydi.
 */
import {
  assertScope, isIsoDate, LedgerError, reversalOf, reviewClose, settlementEntry, sumByAccount, validateCashCount, validateEntry, varianceEntry,
  type SettlementInput,
  ACCOUNT_KINDS, type AccountKind, type CashCountInput, type CashCountReceipt, type CloseReview, type EntryInput,
  type LedgerAccount, type LedgerEntry, type LedgerScope, type LineInput,
} from "./ledger";
import type { D1Like } from "../lib/full-migration";

const APPEND_ONLY_TABLES = ["v2_ledger_entries", "v2_ledger_lines", "v2_cash_counts", "v2_day_closes"] as const;

export const LEDGER_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS v2_ledger_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('asset','liability','equity','income','expense')),
    is_cash INTEGER NOT NULL DEFAULT 0 CHECK (is_cash IN (0,1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS v2_ledger_entries (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    date TEXT NOT NULL,
    kind TEXT NOT NULL,
    memo TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL,
    reverses_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, operation_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS v2_ledger_one_reversal ON v2_ledger_entries (reverses_id) WHERE reverses_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS v2_ledger_entries_date ON v2_ledger_entries (tenant_id, branch_id, date)`,
  `CREATE TABLE IF NOT EXISTS v2_ledger_lines (
    id TEXT PRIMARY KEY NOT NULL,
    entry_id TEXT NOT NULL REFERENCES v2_ledger_entries (id),
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES v2_ledger_accounts (id),
    amount INTEGER NOT NULL CHECK (amount <> 0 AND amount = CAST(amount AS INTEGER))
  )`,
  `CREATE INDEX IF NOT EXISTS v2_ledger_lines_entry ON v2_ledger_lines (entry_id)`,
  `CREATE INDEX IF NOT EXISTS v2_ledger_lines_account ON v2_ledger_lines (tenant_id, branch_id, account_id)`,
  `CREATE TABLE IF NOT EXISTS v2_cash_counts (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    date TEXT NOT NULL,
    actor TEXT NOT NULL,
    counts_json TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, operation_id)
  )`,
  `CREATE TABLE IF NOT EXISTS v2_day_closes (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    date TEXT NOT NULL,
    count_id TEXT NOT NULL REFERENCES v2_cash_counts (id),
    review_json TEXT NOT NULL,
    variance_total INTEGER NOT NULL,
    variance_entry_id TEXT,
    reviewer TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    closed_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, date)
  )`,
  // Hisobning turi, kodi va egasi o'zgarmaydi (faqat nomi va faolligi).
  `CREATE TRIGGER IF NOT EXISTS v2_ledger_accounts_fixed BEFORE UPDATE OF id, tenant_id, branch_id, code, kind, is_cash ON v2_ledger_accounts
    BEGIN SELECT RAISE(ABORT, 'HALO: hisob turi va kodi o''zgartirilmaydi'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_ledger_accounts_no_delete BEFORE DELETE ON v2_ledger_accounts
    BEGIN SELECT RAISE(ABORT, 'HALO: hisob o''chirilmaydi, faqat yopiladi'); END`,
  ...APPEND_ONLY_TABLES.flatMap((table) => [
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'HALO: jurnal yozuvi o''zgartirilmaydi — teskari yozuv kiriting'); END`,
    `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'HALO: jurnal yozuvi o''chirilmaydi — teskari yozuv kiriting'); END`,
  ]),
];

export async function ensureLedgerSchema(db: D1Like): Promise<void> {
  await db.batch(LEDGER_SCHEMA.map((sql) => db.prepare(sql)));
}

type AccountRow = { id: string; code: string; name: string; kind: AccountKind; is_cash: number; active: number };
const toAccount = (row: AccountRow): LedgerAccount => ({
  id: row.id, code: row.code, name: row.name, kind: row.kind, isCash: row.is_cash === 1, active: row.active === 1,
});

export async function listAccounts(db: D1Like, scope: LedgerScope): Promise<Map<string, LedgerAccount>> {
  assertScope(scope);
  const result = await db.prepare(
    "SELECT id, code, name, kind, is_cash, active FROM v2_ledger_accounts WHERE tenant_id = ? AND branch_id = ? ORDER BY code",
  ).bind(scope.tenantId, scope.branchId).all<AccountRow>();
  return new Map(result.results.map((row) => [row.id, toAccount(row)]));
}

export interface AccountInput { code: string; name: string; kind: AccountKind; isCash?: boolean }

export async function createAccount(db: D1Like, scope: LedgerScope, input: AccountInput, now = new Date()): Promise<LedgerAccount> {
  assertScope(scope);
  const code = String(input.code || "").trim();
  const name = String(input.name || "").trim();
  if (!/^[a-z0-9_-]{2,40}$/.test(code)) throw new LedgerError("Hisob kodi: kichik lotin harf, raqam, '-' yoki '_' (2–40 belgi).");
  if (!name || name.length > 60) throw new LedgerError("Hisob nomini kiriting (60 belgigacha).");
  if (!ACCOUNT_KINDS.includes(input.kind)) throw new LedgerError("Hisob turi noto'g'ri.");
  if (input.isCash && input.kind !== "asset") throw new LedgerError("Faqat aktiv (pul) hisobi sanaladigan bo'lishi mumkin.");
  const id = `${scope.tenantId}:${scope.branchId}:${code}`;
  try {
    await db.prepare(
      "INSERT INTO v2_ledger_accounts (id, tenant_id, branch_id, code, name, kind, is_cash, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
    ).bind(id, scope.tenantId, scope.branchId, code, name, input.kind, input.isCash ? 1 : 0, now.toISOString()).run();
  } catch {
    throw new LedgerError(`"${code}" kodli hisob allaqachon bor.`);
  }
  return { id, code, name, kind: input.kind, isCash: Boolean(input.isCash), active: true };
}

/** Restoran uchun boshlang'ich hisoblar rejasi. Takror chaqirilsa, bor hisoblarga tegmaydi. */
export const STANDARD_ACCOUNTS: AccountInput[] = [
  { code: "kassa", name: "Kassa (naqd)", kind: "asset", isCash: true },
  { code: "bank", name: "Bank / karta", kind: "asset", isCash: true },
  { code: "savdo", name: "Savdo tushumi", kind: "income" },
  { code: "xarajat", name: "Boshqa xarajatlar", kind: "expense" },
  { code: "kassa-farqi", name: "Kassa farqi (kamomad / ortiqcha)", kind: "expense" },
  { code: "komissiya", name: "Karta va delivery komissiyasi", kind: "expense" },
  { code: "ochilish", name: "Ochilish qoldig'i (egasi kapitali)", kind: "equity" },
];

export async function ensureStandardAccounts(db: D1Like, scope: LedgerScope): Promise<Map<string, LedgerAccount>> {
  const existing = await listAccounts(db, scope);
  const codes = new Set([...existing.values()].map((account) => account.code));
  for (const account of STANDARD_ACCOUNTS) {
    if (!codes.has(account.code)) await createAccount(db, scope, account);
  }
  return listAccounts(db, scope);
}

export function accountByCode(accounts: ReadonlyMap<string, LedgerAccount>, code: string): LedgerAccount {
  const account = [...accounts.values()].find((candidate) => candidate.code === code);
  if (!account) throw new LedgerError(`"${code}" hisobi sozlanmagan.`);
  return account;
}

async function lastClosedDate(db: D1Like, scope: LedgerScope): Promise<string> {
  const row = await db.prepare("SELECT MAX(date) AS date FROM v2_day_closes WHERE tenant_id = ? AND branch_id = ?")
    .bind(scope.tenantId, scope.branchId).first<{ date: string | null }>();
  return String(row?.date || "");
}

async function readEntry(db: D1Like, scope: LedgerScope, where: "id" | "operation_id", value: string): Promise<LedgerEntry | null> {
  const row = await db.prepare(
    `SELECT id, operation_id, date, kind, memo, actor, reverses_id, created_at FROM v2_ledger_entries WHERE tenant_id = ? AND branch_id = ? AND ${where} = ?`,
  ).bind(scope.tenantId, scope.branchId, value).first<{ id: string; operation_id: string; date: string; kind: LedgerEntry["kind"]; memo: string; actor: string; reverses_id: string | null; created_at: string }>();
  if (!row) return null;
  const lines = await db.prepare("SELECT account_id, amount FROM v2_ledger_lines WHERE entry_id = ? ORDER BY id")
    .bind(row.id).all<{ account_id: string; amount: number }>();
  return {
    id: row.id, operationId: row.operation_id, date: row.date, kind: row.kind, memo: row.memo, actor: row.actor,
    ...(row.reverses_id ? { reversesId: row.reverses_id } : {}), createdAt: row.created_at,
    lines: lines.results.map((line) => ({ accountId: line.account_id, amount: Number(line.amount) })),
  };
}

const sameLines = (left: LineInput[], right: LineInput[]) => {
  const key = (lines: LineInput[]) => lines.map((line) => `${line.accountId}:${line.amount}`).sort().join("|");
  return key(left) === key(right);
};

/**
 * Yozuvni saqlaydi. Xuddi shu amal raqami bilan qayta yuborilsa (internet uzilib, qayta bosilsa),
 * ikkinchi marta yozilmaydi — oldingi yozuv qaytariladi.
 */
export async function postEntry(db: D1Like, scope: LedgerScope, input: EntryInput, now = new Date()): Promise<{ entry: LedgerEntry; alreadySaved: boolean }> {
  assertScope(scope);
  const accounts = await listAccounts(db, scope);
  const entry = validateEntry(input, accounts);
  const previous = await readEntry(db, scope, "operation_id", entry.operationId);
  if (previous) {
    if (previous.date !== entry.date || previous.kind !== entry.kind || !sameLines(previous.lines, entry.lines)) {
      throw new LedgerError("Bu amal raqami bilan boshqa yozuv allaqachon saqlangan.");
    }
    return { entry: previous, alreadySaved: true };
  }
  const closed = await lastClosedDate(db, scope);
  // Kunni yopish = kassani solishtirish. Yopilgan kunga naqd kassaga tegadigan yozuv, savdo
  // va kassa farqi kiritilmaydi. Kassaga tegmaydigan harakat (karta puli bankka tushishi)
  // yopilgan kunda ham yozilishi mumkin — sanalgan kassa o'zgarmaydi.
  const touchesCash = entry.lines.some((line) => accounts.get(line.accountId)?.isCash);
  const lockedKind = entry.kind === "sale" || entry.kind === "cash_variance" || entry.kind === "opening";
  if (closed && entry.date <= closed && (touchesCash || lockedKind)) {
    throw new LedgerError(`${closed} gacha bo'lgan kunlar yopilgan. Tuzatishni bugungi sana bilan kiriting.`);
  }
  if (entry.reversesId) {
    const original = await readEntry(db, scope, "id", entry.reversesId);
    if (!original) throw new LedgerError("Bekor qilinayotgan yozuv topilmadi.");
  }
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const statements = [
    db.prepare(
      "INSERT INTO v2_ledger_entries (id, tenant_id, branch_id, operation_id, date, kind, memo, actor, reverses_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, scope.tenantId, scope.branchId, entry.operationId, entry.date, entry.kind, entry.memo, entry.actor, entry.reversesId ?? null, createdAt),
    ...entry.lines.map((line, index) => db.prepare(
      "INSERT INTO v2_ledger_lines (id, entry_id, tenant_id, branch_id, account_id, amount) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(`${id}:${String(index).padStart(2, "0")}`, id, scope.tenantId, scope.branchId, line.accountId, line.amount)),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (String((error as Error)?.message || "").includes("UNIQUE")) {
      throw new LedgerError("Bu yozuv allaqachon bekor qilingan yoki shu amal boshqa joyda saqlangan.");
    }
    throw error;
  }
  return { entry: { ...entry, id, createdAt }, alreadySaved: false };
}

export async function reverseEntry(
  db: D1Like, scope: LedgerScope, entryId: string,
  input: { operationId: string; date: string; actor: string; reason: string }, now = new Date(),
) {
  const original = await readEntry(db, scope, "id", entryId);
  if (!original) throw new LedgerError("Yozuv topilmadi.");
  return postEntry(db, scope, reversalOf(original, input), now);
}

/** Qoldiqlar (xom: debet − kredit) — ko'rsatilgan sanagacha, shu kun ham kiradi. */
export async function rawBalances(db: D1Like, scope: LedgerScope, through?: string): Promise<Map<string, number>> {
  assertScope(scope);
  if (through !== undefined && !isIsoDate(through)) throw new LedgerError("Sana noto'g'ri.");
  const result = await db.prepare(
    `SELECT l.account_id AS account_id, SUM(l.amount) AS total FROM v2_ledger_lines l
     JOIN v2_ledger_entries e ON e.id = l.entry_id
     WHERE l.tenant_id = ? AND l.branch_id = ? ${through ? "AND e.date <= ?" : ""}
     GROUP BY l.account_id`,
  ).bind(...(through ? [scope.tenantId, scope.branchId, through] : [scope.tenantId, scope.branchId])).all<{ account_id: string; total: number }>();
  return new Map(result.results.map((row) => [row.account_id, Number(row.total)]));
}

// --------------------------------------------------------------------------
// Ko'r kassa sanog'i va kunni yopish
// --------------------------------------------------------------------------

/** Xodim sanog'i. Javobda kutilgan summa YO'Q — xodim raqamni "moslashtira" olmaydi. */
export async function submitBlindCount(db: D1Like, scope: LedgerScope, input: CashCountInput, now = new Date()): Promise<CashCountReceipt> {
  assertScope(scope);
  const accounts = await listAccounts(db, scope);
  const count = validateCashCount(input, accounts);
  const closed = await lastClosedDate(db, scope);
  if (closed && count.date <= closed) throw new LedgerError(`${count.date} kuni allaqachon yopilgan.`);
  const existing = await db.prepare("SELECT submitted_at FROM v2_cash_counts WHERE tenant_id = ? AND branch_id = ? AND operation_id = ?")
    .bind(scope.tenantId, scope.branchId, count.operationId).first<{ submitted_at: string }>();
  const submittedAt = existing?.submitted_at || now.toISOString();
  if (!existing) {
    await db.prepare(
      "INSERT INTO v2_cash_counts (id, tenant_id, branch_id, operation_id, date, actor, counts_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), scope.tenantId, scope.branchId, count.operationId, count.date, count.actor, JSON.stringify(count.counts), submittedAt).run();
  }
  return {
    date: count.date,
    submittedAt,
    accounts: Object.keys(count.counts).length,
    message: "Sanoq qabul qilindi. Natijani rahbar ko'radi.",
  };
}

async function latestCount(db: D1Like, scope: LedgerScope, date: string) {
  return db.prepare(
    "SELECT id, actor, counts_json, submitted_at FROM v2_cash_counts WHERE tenant_id = ? AND branch_id = ? AND date = ? ORDER BY submitted_at DESC, rowid DESC LIMIT 1",
  ).bind(scope.tenantId, scope.branchId, date).first<{ id: string; actor: string; counts_json: string; submitted_at: string }>();
}

/** Rahbar ko'rinishi: kutilgan, sanalgan va farq. Hech narsa yozmaydi. */
export async function reviewDay(db: D1Like, scope: LedgerScope, date: string): Promise<CloseReview & { countedBy: string; countedAt: string }> {
  assertScope(scope);
  if (!isIsoDate(date)) throw new LedgerError("Sana noto'g'ri.");
  const count = await latestCount(db, scope, date);
  if (!count) throw new LedgerError(`${date} uchun kassa hali sanalmagan.`);
  const accounts = await listAccounts(db, scope);
  const review = reviewClose(date, accounts, await rawBalances(db, scope, date), JSON.parse(count.counts_json) as Record<string, number>);
  return { ...review, countedBy: count.actor, countedAt: count.submitted_at };
}

/**
 * Kunni yopish (faqat rahbar): farq bo'lsa sababi majburiy, farq "Kassa farqi" hisobiga yoziladi,
 * kun qulflanadi — shu kunga boshqa yozuv kiritilmaydi.
 */
export async function closeDay(
  db: D1Like, scope: LedgerScope,
  input: { date: string; reviewer: string; note: string; operationId: string }, now = new Date(),
) {
  assertScope(scope);
  const already = await db.prepare("SELECT id, variance_total FROM v2_day_closes WHERE tenant_id = ? AND branch_id = ? AND date = ?")
    .bind(scope.tenantId, scope.branchId, input.date).first<{ id: string; variance_total: number }>();
  if (already) return { closeId: already.id, varianceTotal: Number(already.variance_total), alreadyClosed: true };
  const reviewer = String(input.reviewer || "").trim();
  if (!reviewer) throw new LedgerError("Kim yopgani ko'rsatilishi shart.");
  const closed = await lastClosedDate(db, scope);
  if (closed && input.date < closed) throw new LedgerError("Oldingi kunni keyingi kun yopilgandan keyin yopib bo'lmaydi.");
  const review = await reviewDay(db, scope, input.date);
  const count = await latestCount(db, scope, input.date);
  const accounts = await listAccounts(db, scope);
  const variance = varianceEntry(review, accountByCode(accounts, "kassa-farqi").id, { operationId: `close-variance:${input.operationId}`, actor: reviewer, note: input.note });
  let varianceEntryId: string | null = null;
  if (variance) varianceEntryId = (await postEntry(db, scope, variance, now)).entry.id;
  const closeId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO v2_day_closes (id, tenant_id, branch_id, date, count_id, review_json, variance_total, variance_entry_id, reviewer, note, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(closeId, scope.tenantId, scope.branchId, input.date, count!.id, JSON.stringify(review), review.totalVariance, varianceEntryId, reviewer, String(input.note || "").trim(), now.toISOString()).run();
  return { closeId, varianceTotal: review.totalVariance, alreadyClosed: false, varianceEntryId };
}

/** Butun jurnal sog'lig'i: har bir yozuv va umumiy yig'indi 0 bo'lishi shart. */
export async function verifyLedger(db: D1Like, scope: LedgerScope) {
  assertScope(scope);
  const unbalanced = await db.prepare(
    `SELECT e.id AS id, COALESCE(SUM(l.amount), 0) AS total, COUNT(l.id) AS lines FROM v2_ledger_entries e
     LEFT JOIN v2_ledger_lines l ON l.entry_id = e.id
     WHERE e.tenant_id = ? AND e.branch_id = ? GROUP BY e.id HAVING total <> 0 OR lines < 2`,
  ).bind(scope.tenantId, scope.branchId).all<{ id: string; total: number; lines: number }>();
  const grand = await db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM v2_ledger_lines WHERE tenant_id = ? AND branch_id = ?")
    .bind(scope.tenantId, scope.branchId).first<{ total: number }>();
  return { ok: unbalanced.results.length === 0 && Number(grand?.total || 0) === 0, unbalancedEntries: unbalanced.results.map((row) => row.id), grandTotal: Number(grand?.total || 0) };
}

// --------------------------------------------------------------------------
// Karta / delivery: bankka tushgan pulni kiritish va kutilayotgan pul hisoboti
// --------------------------------------------------------------------------

export async function recordSettlement(db: D1Like, scope: LedgerScope, input: Omit<SettlementInput, "feeAccountId">, now = new Date()) {
  const accounts = await listAccounts(db, scope);
  const entry = settlementEntry({ ...input, feeAccountId: accountByCode(accounts, "komissiya").id }, accounts);
  return postEntry(db, scope, entry, now);
}

export interface ReceivableRow { accountId: string; name: string; outstanding: number; oldestUnsettledDate: string | null; ageDays: number | null }

/**
 * Har bir olinadigan pul hisobi bo'yicha: hali bankka tushmagan summa va eng eski tushmagan
 * savdo sanasi (FIFO: tushgan pul avval eng eski savdolarni yopadi).
 */
export async function receivablesReport(db: D1Like, scope: LedgerScope, accountIds: string[], today: string): Promise<ReceivableRow[]> {
  assertScope(scope);
  if (!isIsoDate(today)) throw new LedgerError("Sana noto'g'ri.");
  const accounts = await listAccounts(db, scope);
  const dayMs = 86_400_000;
  const report: ReceivableRow[] = [];
  for (const accountId of accountIds) {
    const account = accounts.get(accountId);
    if (!account) continue;
    const result = await db.prepare(
      `SELECT e.date AS date, l.amount AS amount FROM v2_ledger_lines l JOIN v2_ledger_entries e ON e.id = l.entry_id
       WHERE l.tenant_id = ? AND l.branch_id = ? AND l.account_id = ? ORDER BY e.date, e.created_at, l.id`,
    ).bind(scope.tenantId, scope.branchId, accountId).all<{ date: string; amount: number }>();
    const debits: Array<{ date: string; left: number }> = [];
    let credits = 0;
    for (const row of result.results) {
      const amount = Number(row.amount);
      if (amount > 0) debits.push({ date: row.date, left: amount });
      else credits += -amount;
    }
    for (const debit of debits) {
      const used = Math.min(debit.left, credits);
      debit.left -= used;
      credits -= used;
    }
    const open = debits.filter((debit) => debit.left > 0);
    const outstanding = open.reduce((sum, debit) => sum + debit.left, 0) - credits;
    const oldest = open[0]?.date ?? null;
    report.push({
      accountId, name: account.name, outstanding,
      oldestUnsettledDate: oldest,
      ageDays: oldest ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / dayMs) : null,
    });
  }
  return report;
}
