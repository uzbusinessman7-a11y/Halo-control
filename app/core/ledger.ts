/**
 * HALO V2 — pul jurnali (ikki tomonlama buxgalteriya yadrosi).
 *
 * Asosiy qoidalar:
 * 1. Har bir yozuv kamida ikki qatordan iborat, qatorlar yig'indisi DOIM 0.
 *    Musbat = debet (hisobga kirdi), manfiy = kredit (hisobdan chiqdi).
 *    Masalan, 7 000₩ naqd savdo:  Kassa +7 000 · Savdo −7 000.
 * 2. Summalar faqat butun won. Kasr yoki 0 qator yo'q.
 * 3. Yozuv hech qachon o'zgartirilmaydi va o'chirilmaydi. Xato — teskari yozuv
 *    bilan tuzatiladi (asl yozuv va sababi tarixda qoladi).
 * 4. Qoldiq hech qayerda saqlanmaydi — har doim qatorlardan hisoblanadi.
 *    Shuning uchun uni "qo'lda to'g'rilab qo'yish" imkonsiz.
 *
 * Bu fayl bazaga bog'liq emas (sof funksiyalar) — to'liq sinovdan o'tkaziladi.
 */

export type AccountKind = "asset" | "liability" | "equity" | "income" | "expense";

export interface LedgerScope { tenantId: string; branchId: string }

export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  kind: AccountKind;
  /** Kun oxirida sanaladigan pul (kassa, bank). */
  isCash: boolean;
  active: boolean;
}

export interface LineInput { accountId: string; amount: number }

export type EntryKind = "opening" | "sale" | "expense" | "income" | "transfer" | "cash_variance" | "reversal" | "adjustment";

export interface EntryInput {
  operationId: string;
  date: string;
  kind: EntryKind;
  memo: string;
  actor: string;
  lines: LineInput[];
  reversesId?: string;
}

export interface LedgerEntry extends EntryInput { id: string; createdAt: string }

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export const ACCOUNT_KINDS: readonly AccountKind[] = ["asset", "liability", "equity", "income", "expense"];
const ENTRY_KINDS: readonly EntryKind[] = ["opening", "sale", "expense", "income", "transfer", "cash_variance", "reversal", "adjustment"];
/** Bir yozuvdagi eng katta summa: 100 mlrd won (xato kiritishdan himoya). */
export const MAX_AMOUNT = 100_000_000_000;
const OPERATION_ID = /^[A-Za-z0-9:_-]{8,120}$/;
const SCOPE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function assertScope(scope: LedgerScope): LedgerScope {
  if (!SCOPE_ID.test(String(scope?.tenantId || "")) || !SCOPE_ID.test(String(scope?.branchId || ""))) {
    throw new LedgerError("Biznes yoki filial identifikatori noto'g'ri.");
  }
  return scope;
}

export function isWholeWon(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_AMOUNT;
}

/** Yozuvni saqlashdan oldingi to'liq tekshiruv. Xato bo'lsa — aniq o'zbekcha sabab. */
export function validateEntry(input: EntryInput, accounts: ReadonlyMap<string, LedgerAccount>): EntryInput {
  if (!input || typeof input !== "object") throw new LedgerError("Yozuv bo'sh.");
  if (!OPERATION_ID.test(String(input.operationId || ""))) throw new LedgerError("Amal raqami noto'g'ri.");
  if (!isIsoDate(input.date)) throw new LedgerError("Sana YYYY-MM-DD ko'rinishida bo'lsin.");
  if (!ENTRY_KINDS.includes(input.kind)) throw new LedgerError("Yozuv turi noto'g'ri.");
  const memo = String(input.memo ?? "").trim();
  if (memo.length > 300) throw new LedgerError("Izoh 300 belgidan oshmasin.");
  const actor = String(input.actor ?? "").trim();
  if (!actor || actor.length > 80) throw new LedgerError("Kim kiritgani ko'rsatilishi shart.");
  if (!Array.isArray(input.lines) || input.lines.length < 2) throw new LedgerError("Yozuvda kamida ikki tomon bo'lishi kerak (qayerdan → qayerga).");
  if (input.lines.length > 50) throw new LedgerError("Bitta yozuvda 50 tadan ortiq qator bo'lmaydi.");
  let sum = 0;
  const lines: LineInput[] = [];
  for (const line of input.lines) {
    const account = accounts.get(String(line?.accountId || ""));
    if (!account) throw new LedgerError(`Hisob topilmadi: ${String(line?.accountId || "").slice(0, 40)}`);
    if (!account.active) throw new LedgerError(`"${account.name}" hisobi yopilgan.`);
    if (!isWholeWon(line.amount) || line.amount === 0) throw new LedgerError(`"${account.name}": summa butun won va 0 dan farqli bo'lsin.`);
    sum += line.amount;
    lines.push({ accountId: account.id, amount: line.amount });
  }
  if (sum !== 0) {
    throw new LedgerError(`Yozuv muvozanatda emas: ${sum > 0 ? "+" : ""}${sum.toLocaleString("en-US")} ₩ ortiqcha. Har bir won qayerdan kelib, qayerga ketgani yozilishi kerak.`);
  }
  if (input.kind === "reversal" && !input.reversesId) throw new LedgerError("Teskari yozuv qaysi yozuvni bekor qilishini ko'rsatishi kerak.");
  return { ...input, memo, actor, lines };
}

/** Hisob tabiatiga ko'ra "odatiy" ishora: aktiv va xarajat — debet (+), qolganlari — kredit (−). */
export function naturalSign(kind: AccountKind): 1 | -1 {
  return kind === "asset" || kind === "expense" ? 1 : -1;
}

/** Qatorlardan qoldiq: hisob bo'yicha debet−kredit yig'indisi. */
export function sumByAccount(lines: Iterable<LineInput>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.accountId, (totals.get(line.accountId) || 0) + line.amount);
  return totals;
}

/** Odam tushunadigan qoldiq: kassa +50 000 — kassada 50 000 bor; savdo −7 000 → 7 000 savdo. */
export function displayBalance(account: LedgerAccount, raw: number): number {
  return raw * naturalSign(account.kind);
}

/** Xatoni tuzatish: asl yozuvning har bir qatori teskari ishora bilan. */
export function reversalOf(entry: LedgerEntry, input: { operationId: string; date: string; actor: string; reason: string }): EntryInput {
  const reason = String(input.reason || "").trim();
  if (!reason) throw new LedgerError("Bekor qilish sababini yozing.");
  if (entry.kind === "reversal") throw new LedgerError("Teskari yozuvni yana bekor qilib bo'lmaydi — kerak bo'lsa, yangi to'g'ri yozuv kiriting.");
  return {
    operationId: input.operationId,
    date: input.date,
    kind: "reversal",
    memo: `Bekor qilindi: ${reason}`.slice(0, 300),
    actor: input.actor,
    reversesId: entry.id,
    lines: entry.lines.map((line) => ({ accountId: line.accountId, amount: -line.amount })),
  };
}

// --------------------------------------------------------------------------
// Ko'r kassa sanog'i
// --------------------------------------------------------------------------

export interface CashCountInput {
  operationId: string;
  date: string;
  actor: string;
  /** Hisob → sanalgan summa (won). */
  counts: Record<string, number>;
}

/** Xodimga qaytariladigan javob: kutilgan summa YO'Q (ko'r sanoq). */
export interface CashCountReceipt {
  date: string;
  submittedAt: string;
  accounts: number;
  message: string;
}

export function validateCashCount(input: CashCountInput, accounts: ReadonlyMap<string, LedgerAccount>): CashCountInput {
  if (!OPERATION_ID.test(String(input?.operationId || ""))) throw new LedgerError("Sanoq raqami noto'g'ri.");
  if (!isIsoDate(input.date)) throw new LedgerError("Sanoq sanasi noto'g'ri.");
  const actor = String(input.actor ?? "").trim();
  if (!actor || actor.length > 80) throw new LedgerError("Kim sanagani ko'rsatilishi shart.");
  const cashAccounts = [...accounts.values()].filter((account) => account.isCash && account.active);
  if (!cashAccounts.length) throw new LedgerError("Sanaladigan pul hisobi (kassa) sozlanmagan.");
  const source = input.counts && typeof input.counts === "object" && !Array.isArray(input.counts) ? input.counts : {};
  const counts: Record<string, number> = {};
  for (const account of cashAccounts) {
    const value = (source as Record<string, unknown>)[account.id];
    if (!isWholeWon(value) || value < 0) throw new LedgerError(`"${account.name}" uchun sanalgan summani butun wonda kiriting (0 yoki undan katta).`);
    counts[account.id] = value;
  }
  for (const key of Object.keys(source)) {
    if (!(key in counts)) throw new LedgerError("Sanoqda noma'lum hisob bor.");
  }
  return { ...input, actor, counts };
}

export interface CloseReviewLine { accountId: string; name: string; expected: number; counted: number; variance: number }
export interface CloseReview { date: string; lines: CloseReviewLine[]; totalExpected: number; totalCounted: number; totalVariance: number }

/** Faqat rahbar ko'radi: kutilgan va sanalgan summa, farq (sanalgan − kutilgan). */
export function reviewClose(
  date: string,
  accounts: ReadonlyMap<string, LedgerAccount>,
  rawBalances: ReadonlyMap<string, number>,
  counts: Record<string, number>,
): CloseReview {
  const lines = [...accounts.values()]
    .filter((account) => account.isCash && account.active)
    .map((account) => {
      const expected = displayBalance(account, rawBalances.get(account.id) || 0);
      const counted = counts[account.id] ?? 0;
      return { accountId: account.id, name: account.name, expected, counted, variance: counted - expected };
    });
  return {
    date,
    lines,
    totalExpected: lines.reduce((sum, line) => sum + line.expected, 0),
    totalCounted: lines.reduce((sum, line) => sum + line.counted, 0),
    totalVariance: lines.reduce((sum, line) => sum + line.variance, 0),
  };
}

/**
 * Kassa farqi yozuvi: jurnaldagi kassa qoldig'ini sanalgan haqiqiy pulga tenglaydi.
 * Kamomad: Kassa −5 000 · Kassa farqi (xarajat) +5 000. Ortiqcha — aksincha.
 * Farq bo'lmasa — yozuv kerak emas (null).
 */
export function varianceEntry(
  review: CloseReview,
  varianceAccountId: string,
  input: { operationId: string; actor: string; note: string },
): EntryInput | null {
  const lines: LineInput[] = review.lines.filter((line) => line.variance !== 0).map((line) => ({ accountId: line.accountId, amount: line.variance }));
  if (!lines.length) return null;
  const note = String(input.note || "").trim();
  if (!note) throw new LedgerError("Kassada farq bor. Kunni yopishdan oldin farq sababini yozing.");
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  if (total !== 0) lines.push({ accountId: varianceAccountId, amount: -total });
  return {
    operationId: input.operationId,
    date: review.date,
    kind: "cash_variance",
    memo: `Kassa farqi ${total > 0 ? "+" : "−"}${Math.abs(total).toLocaleString("en-US")} ₩ · ${note}`.slice(0, 300),
    actor: input.actor,
    lines,
  };
}

// --------------------------------------------------------------------------
// Karta / delivery pulining bankka tushishi (olinadigan pul → bank)
// --------------------------------------------------------------------------

export interface SettlementInput {
  operationId: string;
  date: string;
  actor: string;
  /** Olinadigan pul hisobi (karta kompaniyasi yoki delivery platforma). */
  fromAccountId: string;
  /** Pul tushgan hisob (bank). */
  toAccountId: string;
  /** Bankka haqiqatda tushgan summa. */
  received: number;
  /** Ushlab qolingan komissiya (0 bo'lishi mumkin). */
  fee: number;
  feeAccountId: string;
  memo?: string;
}

/**
 * Bank +tushgan · Komissiya +ushlangan · Olinadigan pul −(tushgan + ushlangan).
 * Shunday qilib karta/delivery puli bankka qancha yetib kelgani va komissiya won'igacha ko'rinadi.
 */
export function settlementEntry(input: SettlementInput, accounts: ReadonlyMap<string, LedgerAccount>): EntryInput {
  const from = accounts.get(input.fromAccountId);
  const to = accounts.get(input.toAccountId);
  if (!from || !to) throw new LedgerError("Olinadigan pul yoki bank hisobi topilmadi.");
  if (from.id === to.id) throw new LedgerError("Pul o'sha hisobning o'ziga tushmaydi.");
  if (from.kind !== "asset" || to.kind !== "asset") throw new LedgerError("Ikkala hisob ham pul (aktiv) hisobi bo'lishi kerak.");
  if (!isWholeWon(input.received) || input.received < 0) throw new LedgerError("Tushgan summani butun wonda kiriting.");
  if (!isWholeWon(input.fee) || input.fee < 0) throw new LedgerError("Komissiyani butun wonda kiriting (bo'lmasa 0).");
  const total = input.received + input.fee;
  if (total <= 0) throw new LedgerError("Tushgan summa yoki komissiya 0 dan katta bo'lishi kerak.");
  const lines: LineInput[] = [{ accountId: from.id, amount: -total }];
  if (input.received) lines.push({ accountId: to.id, amount: input.received });
  if (input.fee) lines.push({ accountId: input.feeAccountId, amount: input.fee });
  const memo = `${from.name} → ${to.name}: ${input.received.toLocaleString("en-US")} ₩ tushdi${input.fee ? `, komissiya ${input.fee.toLocaleString("en-US")} ₩` : ""}${input.memo ? ` · ${String(input.memo).trim()}` : ""}`;
  return { operationId: input.operationId, date: input.date, kind: "transfer", memo: memo.slice(0, 300), actor: input.actor, lines };
}
