/**
 * HALO V2 — maosh daftari (har bir xodim, har bir oy).
 *
 * Ishora: + = biz xodimga qarzdor bo'ldik (ishlagani, to'lanadigan dam olish, bonus),
 *         − = qarzimiz kamaydi (ushlanma, avans, to'lov).
 * Oy bo'yicha qoldiq = shu oy yozuvlari yig'indisi = "qancha to'lash qoldi".
 * Qoldiq saqlanmaydi, yozuvlar o'zgartirilmaydi/o'chirilmaydi (bazada taqiqlangan):
 * xato — teskari yozuv bilan, yangi to'g'ri yozuv esa yangi versiya sifatida kiritiladi.
 */
import { assertScope, isIsoDate, isWholeWon, LedgerError, type LedgerScope } from "./ledger";
import type { D1Like, D1StatementLike } from "../lib/full-migration";

export type PayMoveKind = "earned" | "paid_leave" | "rounding" | "bonus" | "deduction" | "advance" | "payment" | "reversal";
const KINDS: readonly PayMoveKind[] = ["earned", "paid_leave", "rounding", "bonus", "deduction", "advance", "payment", "reversal"];
const POSITIVE: readonly PayMoveKind[] = ["earned", "paid_leave", "bonus"];
const NEGATIVE: readonly PayMoveKind[] = ["deduction", "advance", "payment"];

export interface Employee { id: string; code: string; name: string }
export interface PayMoveInput {
  operationId: string; employeeId: string; month: string; sourceKey: string; date: string; kind: PayMoveKind;
  amount: number; minutes?: number; memo?: string; actor: string; reversesId?: string;
}

export const PAYROLL_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS v2_employees (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
    code TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS v2_pay_moves (
    id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
    employee_id TEXT NOT NULL REFERENCES v2_employees (id), month TEXT NOT NULL,
    source_key TEXT NOT NULL, operation_id TEXT NOT NULL, date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('earned','paid_leave','rounding','bonus','deduction','advance','payment','reversal')),
    amount INTEGER NOT NULL CHECK (amount <> 0 AND amount = CAST(amount AS INTEGER)),
    minutes INTEGER NOT NULL DEFAULT 0, memo TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL,
    reverses_id TEXT, created_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, operation_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS v2_pay_one_reversal ON v2_pay_moves (reverses_id) WHERE reverses_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS v2_pay_moves_month ON v2_pay_moves (tenant_id, branch_id, employee_id, month)`,
  `CREATE TRIGGER IF NOT EXISTS v2_employees_no_delete BEFORE DELETE ON v2_employees
    BEGIN SELECT RAISE(ABORT, 'HALO: xodim o''chirilmaydi'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_employees_fixed BEFORE UPDATE OF id, tenant_id, branch_id, code ON v2_employees
    BEGIN SELECT RAISE(ABORT, 'HALO: xodim kodi o''zgartirilmaydi'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_pay_moves_no_update BEFORE UPDATE ON v2_pay_moves
    BEGIN SELECT RAISE(ABORT, 'HALO: maosh yozuvi o''zgartirilmaydi — teskari yozuv kiriting'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_pay_moves_no_delete BEFORE DELETE ON v2_pay_moves
    BEGIN SELECT RAISE(ABORT, 'HALO: maosh yozuvi o''chirilmaydi — teskari yozuv kiriting'); END`,
];

export async function ensurePayrollSchema(db: D1Like) {
  await db.batch(PAYROLL_SCHEMA.map((sql) => db.prepare(sql)));
}

export const isMonth = (value: unknown): value is string => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function validatePayMove(move: PayMoveInput, employees: ReadonlyMap<string, Employee>): PayMoveInput {
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(String(move.operationId || ""))) throw new LedgerError("Yozuv raqami noto'g'ri.");
  if (!employees.has(move.employeeId)) throw new LedgerError("Xodim topilmadi.");
  if (!isMonth(move.month)) throw new LedgerError("Oy noto'g'ri.");
  if (!isIsoDate(move.date)) throw new LedgerError("Sana noto'g'ri.");
  if (!KINDS.includes(move.kind)) throw new LedgerError("Yozuv turi noto'g'ri.");
  if (!isWholeWon(move.amount) || move.amount === 0) throw new LedgerError("Summa butun won va 0 dan farqli bo'lsin.");
  if (POSITIVE.includes(move.kind) && move.amount < 0) throw new LedgerError("Hisoblangan summa musbat bo'lsin.");
  if (NEGATIVE.includes(move.kind) && move.amount > 0) throw new LedgerError("Ushlanma, avans va to'lov qoldiqni kamaytiradi (manfiy summa).");
  const minutes = Number(move.minutes ?? 0);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 60 * 24 * 31) throw new LedgerError("Daqiqa noto'g'ri.");
  if (!String(move.sourceKey || "").trim()) throw new LedgerError("Manba ko'rsatilishi shart.");
  if (!String(move.actor || "").trim()) throw new LedgerError("Kim kiritgani ko'rsatilishi shart.");
  return {
    ...move, minutes, sourceKey: String(move.sourceKey).slice(0, 200),
    memo: String(move.memo || "").slice(0, 300), actor: String(move.actor).trim().slice(0, 80),
  };
}

export async function listEmployees(db: D1Like, scope: LedgerScope): Promise<Map<string, Employee>> {
  assertScope(scope);
  const result = await db.prepare("SELECT id, code, name FROM v2_employees WHERE tenant_id = ? AND branch_id = ? ORDER BY name")
    .bind(scope.tenantId, scope.branchId).all<Employee>();
  return new Map(result.results.map((row) => [row.id, row]));
}

export async function ensureEmployee(db: D1Like, scope: LedgerScope, code: string, name: string, now = new Date()): Promise<string> {
  assertScope(scope);
  if (!/^[a-z0-9_-]{2,60}$/.test(code)) throw new LedgerError("Xodim kodi noto'g'ri.");
  const id = `${scope.tenantId}:${scope.branchId}:${code}`;
  await db.prepare("INSERT OR IGNORE INTO v2_employees (id, tenant_id, branch_id, code, name, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, scope.tenantId, scope.branchId, code, String(name || code).slice(0, 80), now.toISOString()).run();
  return id;
}

export function payMoveStatement(db: D1Like, scope: LedgerScope, move: PayMoveInput, now: Date): D1StatementLike {
  return db.prepare(
    `INSERT INTO v2_pay_moves (id, tenant_id, branch_id, employee_id, month, source_key, operation_id, date, kind, amount, minutes, memo, actor, reverses_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), scope.tenantId, scope.branchId, move.employeeId, move.month, move.sourceKey, move.operationId,
    move.date, move.kind, move.amount, move.minutes ?? 0, move.memo ?? "", move.actor, move.reversesId ?? null, now.toISOString());
}

/** Har bir xodim va oy uchun qoldiq (to'lash qolgan summa). */
export async function monthBalances(db: D1Like, scope: LedgerScope): Promise<Map<string, number>> {
  assertScope(scope);
  const result = await db.prepare(
    "SELECT employee_id, month, SUM(amount) AS total FROM v2_pay_moves WHERE tenant_id = ? AND branch_id = ? GROUP BY employee_id, month",
  ).bind(scope.tenantId, scope.branchId).all<{ employee_id: string; month: string; total: number }>();
  return new Map(result.results.map((row) => [`${row.employee_id}|${row.month}`, Number(row.total)]));
}

export interface PayslipLine { date: string; kind: PayMoveKind; amount: number; minutes: number; memo: string }
export interface Payslip {
  employee: Employee; month: string;
  workedDays: number; workedMinutes: number; paidLeaveDays: number;
  earned: number; bonus: number; deduction: number; gross: number; advance: number; paid: number; remaining: number;
  /** Oldingi oylardan to'lanmay qolgan (manfiy — ortiqcha to'langan). */
  earlierMonths: number;
  lines: PayslipLine[];
  corrections: Array<{ date: string; amount: number; memo: string }>;
}

/** Oylik hisob varaqasi: faqat amaldagi yozuvlar; bekor qilingan/tuzatilganlar alohida ro'yxatda. */
export async function payslip(db: D1Like, scope: LedgerScope, employeeId: string, month: string): Promise<Payslip> {
  assertScope(scope);
  if (!isMonth(month)) throw new LedgerError("Oy noto'g'ri.");
  const employee = (await listEmployees(db, scope)).get(employeeId);
  if (!employee) throw new LedgerError("Xodim topilmadi.");
  const rows = (await db.prepare(
    "SELECT id, date, kind, amount, minutes, memo, reverses_id FROM v2_pay_moves WHERE tenant_id = ? AND branch_id = ? AND employee_id = ? AND month = ? ORDER BY date, created_at",
  ).bind(scope.tenantId, scope.branchId, employeeId, month).all<{ id: string; date: string; kind: PayMoveKind; amount: number; minutes: number; memo: string; reverses_id: string | null }>()).results;
  const reversed = new Set(rows.map((row) => row.reverses_id).filter(Boolean));
  const live = rows.filter((row) => row.kind !== "reversal" && !reversed.has(row.id));
  const earlier = await db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM v2_pay_moves WHERE tenant_id = ? AND branch_id = ? AND employee_id = ? AND month < ?",
  ).bind(scope.tenantId, scope.branchId, employeeId, month).first<{ total: number }>();
  const sum = (...kinds: PayMoveKind[]) => live.filter((row) => kinds.includes(row.kind)).reduce((total, row) => total + Number(row.amount), 0);
  const earned = sum("earned", "paid_leave", "rounding");
  const bonus = sum("bonus");
  const deduction = -sum("deduction");
  const advance = -sum("advance");
  const paid = -sum("payment");
  const gross = earned + bonus - deduction;
  return {
    employee, month,
    workedDays: new Set(live.filter((row) => row.kind === "earned" && Number(row.minutes) > 0).map((row) => row.date)).size,
    workedMinutes: live.filter((row) => row.kind === "earned").reduce((total, row) => total + Number(row.minutes), 0),
    paidLeaveDays: live.filter((row) => row.kind === "paid_leave").length,
    earned, bonus, deduction, gross, advance, paid,
    remaining: rows.reduce((total, row) => total + Number(row.amount), 0),
    earlierMonths: Number(earlier?.total || 0),
    lines: live.map((row) => ({ date: row.date, kind: row.kind, amount: Number(row.amount), minutes: Number(row.minutes), memo: row.memo })),
    corrections: rows.filter((row) => row.kind === "reversal").map((row) => ({ date: row.date, amount: Number(row.amount), memo: row.memo })),
  };
}

const w = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")} ₩`;
export const hoursText = (minutes: number) => `${Math.floor(minutes / 60)} soat${minutes % 60 ? ` ${minutes % 60} daqiqa` : ""}`;
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
export const monthName = (month: string) => `${month.slice(0, 4)}-yil ${MONTHS[Number(month.slice(5, 7)) - 1] || month}`;

/** Xodimga yuborish uchun hisob varaqasi matni (Telegram / KakaoTalk). */
export function payslipText(p: Payslip, businessName = "HALO"): string {
  const lines = [
    `${businessName} — hisob varaqasi`,
    `${p.employee.name} · ${monthName(p.month)}`,
    "",
    `Ishlagan: ${p.workedDays} kun, ${hoursText(p.workedMinutes)}${p.paidLeaveDays ? ` · haq to'lanadigan dam: ${p.paidLeaveDays} kun` : ""}`,
    `Hisoblandi: ${w(p.earned)}`,
  ];
  if (p.bonus) lines.push(`+ Bonus: ${w(p.bonus)}`);
  if (p.deduction) lines.push(`− Ushlanma: ${w(p.deduction)}`);
  lines.push(`Jami: ${w(p.gross)}`);
  if (p.advance) lines.push(`− Avans: ${w(p.advance)}`);
  if (p.paid) lines.push(`− To'langan: ${w(p.paid)}`);
  lines.push("", p.remaining >= 0 ? `To'lanishi kerak: ${w(p.remaining)}` : `Ortiqcha to'langan: ${w(-p.remaining)}`);
  const notes = p.lines.filter((line) => (line.kind === "bonus" || line.kind === "deduction") && line.memo);
  if (notes.length) lines.push("", ...notes.map((line) => `${line.kind === "bonus" ? "Bonus" : "Ushlanma"} (${line.date.slice(8, 10)}.${line.date.slice(5, 7)}): ${line.memo.slice(0, 80)}`));
  lines.push("", "Savol bo'lsa, rahbarga yozing.");
  return lines.join("\n");
}
