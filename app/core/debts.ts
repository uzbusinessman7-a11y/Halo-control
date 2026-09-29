/**
 * HALO V2 — qarz daftari (yetkazib beruvchilar).
 *
 * Ishora: + = biz qarzdor bo'ldik (xarid, ochilish), − = qarz kamaydi (to'lov).
 * Qoldiq saqlanmaydi — har doim yozuvlardan hisoblanadi. Yozuvlar o'zgartirilmaydi va
 * o'chirilmaydi (bazada taqiqlangan). Ochilish qoldig'i o'zgarsa — farqi tuzatish yozuvi
 * sifatida qo'shiladi (eski qiymat va sabab tarixda qoladi).
 */
import { assertScope, isIsoDate, isWholeWon, LedgerError, type LedgerScope } from "./ledger";
import type { D1Like, D1StatementLike } from "../lib/full-migration";

export type DebtMoveKind = "opening" | "purchase" | "payment" | "adjustment" | "reversal";
const KINDS: readonly DebtMoveKind[] = ["opening", "purchase", "payment", "adjustment", "reversal"];

export interface Party { id: string; code: string; name: string }
export interface DebtMoveInput {
  operationId: string; partyId: string; date: string; kind: DebtMoveKind; amount: number;
  memo?: string; actor: string; reversesId?: string;
}

export const DEBT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS v2_parties (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
    code TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS v2_party_moves (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
    party_id TEXT NOT NULL REFERENCES v2_parties (id), operation_id TEXT NOT NULL,
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('opening','purchase','payment','adjustment','reversal')),
    amount INTEGER NOT NULL CHECK (amount <> 0 AND amount = CAST(amount AS INTEGER)),
    memo TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, reverses_id TEXT, created_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, operation_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS v2_party_one_reversal ON v2_party_moves (reverses_id) WHERE reverses_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS v2_party_moves_party ON v2_party_moves (tenant_id, branch_id, party_id, date)`,
  `CREATE TRIGGER IF NOT EXISTS v2_parties_no_delete BEFORE DELETE ON v2_parties
    BEGIN SELECT RAISE(ABORT, 'HALO: yetkazib beruvchi o''chirilmaydi'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_parties_fixed BEFORE UPDATE OF id, tenant_id, branch_id, code ON v2_parties
    BEGIN SELECT RAISE(ABORT, 'HALO: yetkazib beruvchi kodi o''zgartirilmaydi'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_party_moves_no_update BEFORE UPDATE ON v2_party_moves
    BEGIN SELECT RAISE(ABORT, 'HALO: qarz yozuvi o''zgartirilmaydi — teskari yozuv kiriting'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_party_moves_no_delete BEFORE DELETE ON v2_party_moves
    BEGIN SELECT RAISE(ABORT, 'HALO: qarz yozuvi o''chirilmaydi — teskari yozuv kiriting'); END`,
];

export async function ensureDebtSchema(db: D1Like) {
  await db.batch(DEBT_SCHEMA.map((sql) => db.prepare(sql)));
}

export function validateDebtMove(move: DebtMoveInput, parties: ReadonlyMap<string, Party>): DebtMoveInput {
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(String(move.operationId || ""))) throw new LedgerError("Yozuv raqami noto'g'ri.");
  if (!parties.has(move.partyId)) throw new LedgerError("Yetkazib beruvchi topilmadi.");
  if (!isIsoDate(move.date)) throw new LedgerError("Sana noto'g'ri.");
  if (!KINDS.includes(move.kind)) throw new LedgerError("Yozuv turi noto'g'ri.");
  if (!isWholeWon(move.amount) || move.amount === 0) throw new LedgerError("Summa butun won va 0 dan farqli bo'lsin.");
  if (move.kind === "purchase" && move.amount < 0) throw new LedgerError("Xarid qarzni oshiradi (musbat summa).");
  if (move.kind === "payment" && move.amount > 0) throw new LedgerError("To'lov qarzni kamaytiradi (manfiy summa).");
  if (!String(move.actor || "").trim()) throw new LedgerError("Kim kiritgani ko'rsatilishi shart.");
  return { ...move, memo: String(move.memo || "").slice(0, 300), actor: String(move.actor).trim().slice(0, 80) };
}

export async function listParties(db: D1Like, scope: LedgerScope): Promise<Map<string, Party>> {
  assertScope(scope);
  const result = await db.prepare("SELECT id, code, name FROM v2_parties WHERE tenant_id = ? AND branch_id = ? ORDER BY name")
    .bind(scope.tenantId, scope.branchId).all<Party>();
  return new Map(result.results.map((row) => [row.id, row]));
}

export function partyStatement(db: D1Like, scope: LedgerScope, code: string, name: string, now = new Date()): D1StatementLike {
  assertScope(scope);
  if (!/^[a-z0-9_-]{2,60}$/.test(code)) throw new LedgerError("Yetkazib beruvchi kodi noto'g'ri.");
  return db.prepare("INSERT OR IGNORE INTO v2_parties (id, tenant_id, branch_id, code, name, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(`${scope.tenantId}:${scope.branchId}:${code}`, scope.tenantId, scope.branchId, code, String(name || code).slice(0, 80), now.toISOString());
}

export async function ensureParty(db: D1Like, scope: LedgerScope, code: string, name: string, now = new Date()): Promise<string> {
  await partyStatement(db, scope, code, name, now).run();
  return `${scope.tenantId}:${scope.branchId}:${code}`;
}

export function debtMoveStatement(db: D1Like, scope: LedgerScope, move: DebtMoveInput, now: Date): D1StatementLike {
  return db.prepare(
    `INSERT INTO v2_party_moves (id, tenant_id, branch_id, party_id, operation_id, date, kind, amount, memo, actor, reverses_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), scope.tenantId, scope.branchId, move.partyId, move.operationId, move.date, move.kind,
    move.amount, move.memo ?? "", move.actor, move.reversesId ?? null, now.toISOString());
}

export async function partyBalances(db: D1Like, scope: LedgerScope, through?: string): Promise<Map<string, number>> {
  assertScope(scope);
  const result = await db.prepare(
    `SELECT party_id, SUM(amount) AS total FROM v2_party_moves WHERE tenant_id = ? AND branch_id = ? ${through ? "AND date <= ?" : ""} GROUP BY party_id`,
  ).bind(...(through ? [scope.tenantId, scope.branchId, through] : [scope.tenantId, scope.branchId])).all<{ party_id: string; total: number }>();
  return new Map(result.results.map((row) => [row.party_id, Number(row.total)]));
}

/** Eng eski to'lanmagan xarid sanasi (FIFO: to'lov avval eng eski qarzni yopadi). */
export async function oldestUnpaid(db: D1Like, scope: LedgerScope, partyId: string): Promise<string | null> {
  const result = await db.prepare(
    "SELECT date, amount FROM v2_party_moves WHERE tenant_id = ? AND branch_id = ? AND party_id = ? ORDER BY date, created_at",
  ).bind(scope.tenantId, scope.branchId, partyId).all<{ date: string; amount: number }>();
  const debts: Array<{ date: string; left: number }> = [];
  let credit = 0;
  for (const row of result.results) {
    const amount = Number(row.amount);
    if (amount > 0) debts.push({ date: row.date, left: amount }); else credit += -amount;
  }
  for (const debt of debts) { const used = Math.min(debt.left, credit); debt.left -= used; credit -= used; }
  return debts.find((debt) => debt.left > 0)?.date ?? null;
}

/** Hamma yetkazib beruvchi uchun eng eski to'lanmagan xarid sanasi — bitta so'rov bilan. */
export async function oldestUnpaidAll(db: D1Like, scope: LedgerScope): Promise<Map<string, string>> {
  const result = await db.prepare(
    "SELECT party_id, date, amount FROM v2_party_moves WHERE tenant_id = ? AND branch_id = ? ORDER BY party_id, date, created_at",
  ).bind(scope.tenantId, scope.branchId).all<{ party_id: string; date: string; amount: number }>();
  const byParty = new Map<string, Array<{ date: string; amount: number }>>();
  for (const row of result.results) {
    const list = byParty.get(row.party_id) || [];
    list.push({ date: row.date, amount: Number(row.amount) });
    byParty.set(row.party_id, list);
  }
  const out = new Map<string, string>();
  for (const [partyId, moves] of byParty) {
    const debts: Array<{ date: string; left: number }> = [];
    let credit = 0;
    for (const move of moves) { if (move.amount > 0) debts.push({ date: move.date, left: move.amount }); else credit += -move.amount; }
    for (const debt of debts) { const used = Math.min(debt.left, credit); debt.left -= used; credit -= used; }
    const oldest = debts.find((debt) => debt.left > 0)?.date;
    if (oldest) out.set(partyId, oldest);
  }
  return out;
}

export interface StatementLine { date: string; kind: DebtMoveKind; amount: number; balance: number; memo: string }
export interface Statement { party: Party; from: string; to: string; opening: number; lines: StatementLine[]; closing: number; purchases: number; payments: number }

/** Solishtirish akti: davr boshidagi qarz, davrdagi har bir yozuv va yakuniy qarz. */
export async function statement(db: D1Like, scope: LedgerScope, partyId: string, from: string, to: string): Promise<Statement> {
  assertScope(scope);
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new LedgerError("Davr noto'g'ri.");
  const party = (await listParties(db, scope)).get(partyId);
  if (!party) throw new LedgerError("Yetkazib beruvchi topilmadi.");
  const before = await db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM v2_party_moves WHERE tenant_id = ? AND branch_id = ? AND party_id = ? AND date < ?")
    .bind(scope.tenantId, scope.branchId, partyId, from).first<{ total: number }>();
  const rows = await db.prepare(
    "SELECT date, kind, amount, memo FROM v2_party_moves WHERE tenant_id = ? AND branch_id = ? AND party_id = ? AND date >= ? AND date <= ? ORDER BY date, created_at",
  ).bind(scope.tenantId, scope.branchId, partyId, from, to).all<{ date: string; kind: DebtMoveKind; amount: number; memo: string }>();
  let balance = Number(before?.total || 0);
  const opening = balance;
  let purchases = 0;
  let payments = 0;
  const lines = rows.results.map((row) => {
    const amount = Number(row.amount);
    balance += amount;
    if (amount > 0) purchases += amount; else payments += -amount;
    return { date: row.date, kind: row.kind, amount, balance, memo: row.memo };
  });
  return { party, from, to, opening, lines, closing: balance, purchases, payments };
}

const KIND_LABEL: Record<DebtMoveKind, string> = { opening: "Boshlang'ich qarz", purchase: "Xarid", payment: "To'lov", adjustment: "Tuzatish", reversal: "Bekor qilindi" };
const d = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const w = (n: number) => `${Math.abs(n).toLocaleString("en-US")} ₩`;

/** Yetkazib beruvchiga yuborish uchun matn (Telegram / KakaoTalk). */
export function statementText(s: Statement, businessName = "HALO"): string {
  return [
    `${businessName} — ${s.party.name} bilan solishtirish akti`,
    `Davr: ${d(s.from)} – ${d(s.to)}`,
    "",
    `Davr boshidagi qarz: ${w(s.opening)}${s.opening < 0 ? " (avans)" : ""}`,
    ...s.lines.map((line) => `${line.amount > 0 ? "+" : "−"} ${d(line.date)} ${KIND_LABEL[line.kind]}: ${w(line.amount)}${line.memo ? ` · ${line.memo.slice(0, 60)}` : ""}`),
    "",
    `Jami xarid: ${w(s.purchases)} · Jami to'lov: ${w(s.payments)}`,
    `${d(s.to)} holatiga qarz: ${w(s.closing)}${s.closing < 0 ? " (avans)" : ""}`,
    "",
    "Iltimos, raqamlarni tasdiqlang yoki farq bo'lsa yozing.",
  ].join("\n");
}
