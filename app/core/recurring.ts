/**
 * HALO V2 — har oy avtomatik xarajatlar (ijara, internet, sug'urta...).
 *
 * Eski tizimda bu xarajatlar faqat eski sahifa brauzerda ochilganda yozilardi. V2 da server o'zi yozadi:
 * rahbar Bosh / Kassa / Kiritish sahifasini ochganda va har kungi avtomatik ishda. Bir oyga bitta yozuv
 * (takrorlanmaydi, eski tizimning materializeRecurringExpenses qoidasi bilan bir xil).
 */
import {
  canAutomateRecurringExpenseCategory, materializeRecurringExpenses, recurringExpenseTemplateIdentity, validRecurringExpenseMetadata,
  type RecurringExpenseTemplate, type RecurringFinancialEntry,
} from "../lib/recurring-expenses";
import { mutateHaloState, readHaloState } from "../lib/halo-store";
import { v2ClosedThrough } from "./closed-days";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export class RecurringError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const addDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const dayOf = (month: string, day: number) => `${month}-${String(Math.min(day, daysIn(Number(month.slice(0, 4)), Number(month.slice(5, 7))))).padStart(2, "0")}`;
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** Muddati kelgan oylik xarajatlarni yozadi. Yopilgan kunga tushsa — birinchi ochiq kunga. */
export function materializeRecurring(state: Row, today: string, closedThrough = "") {
  const result = materializeRecurringExpenses({
    fixedExpenses: rows(state.fixedExpenses) as unknown as RecurringExpenseTemplate[],
    financialEntries: rows(state.financialEntries) as unknown as RecurringFinancialEntry[],
    throughDate: today,
  });
  if (!result.changed) return { state, created: [] as Row[] };
  const moved = new Map<string, string>();
  if (closedThrough) {
    for (const entry of result.createdEntries) if (entry.date <= closedThrough) moved.set(entry.id, addDay(closedThrough));
  }
  const financialEntries = (result.financialEntries as unknown as Row[]).map((entry) => (moved.has(String(entry.id)) ? { ...entry, date: moved.get(String(entry.id)) } : entry));
  return {
    state: { ...state, fixedExpenses: result.fixedExpenses, financialEntries },
    created: result.createdEntries.map((entry) => ({ ...entry, date: moved.get(entry.id) || entry.date })) as unknown as Row[],
  };
}

/** Sahifa ochilganda: yoziladigan narsa bo'lsa yozadi (bo'lmasa hech narsa o'zgarmaydi). Xato sahifani to'xtatmaydi. */
export async function ensureRecurring(branchId: string, today: string): Promise<number> {
  try {
    const { state } = await readHaloState(branchId);
    if (!materializeRecurring(state as Row, today).created.length) return 0;
    const closed = await v2ClosedThrough(branchId).catch(() => "");
    const mutation = await mutateHaloState((current) => {
      const out = materializeRecurring(current as Row, today, closed);
      return { state: out.state as typeof current, result: out.created.length };
    }, 3, branchId, "Tizim", "Oylik avtomatik xarajat yozildi", "Xarajatlar");
    return mutation.result;
  } catch {
    return 0;
  }
}

export function recurringList(state: Row) {
  const accounts = new Map(rows(state.accounts).map((account) => [String(account.id), String(account.name || account.id)]));
  return rows(state.fixedExpenses)
    .filter((entry) => entry.automatic === true && entry.frequency === "monthly")
    .map((entry) => ({
      id: String(entry.id), name: String(entry.name || ""), category: String(entry.category || ""), amount: Number(entry.amount) || 0,
      accountId: String(entry.accountId || ""), account: accounts.get(String(entry.accountId)) || "", billingDay: Number(entry.billingDay) || Number(String(entry.nextDue || "").slice(8, 10)) || 1,
      nextDue: String(entry.nextDue || ""), lastPaidDate: String(entry.lastPaidDate || ""), active: entry.active === true,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** Yangi yoki tahrirlangan oylik xarajat. O'zgarish faqat keyingi oylarga ta'sir qiladi; yozilgan oylar o'zgarmaydi. */
export function saveRecurring(state: Row, body: Row, today: string) {
  const templates = rows(state.fixedExpenses);
  const id = clean(body.id, 100);
  const current = id ? templates.find((entry) => entry.id === id) : undefined;
  if (id && !current) throw new RecurringError("Xarajat topilmadi. Sahifani yangilang.", 404);
  const name = clean(body.name, 80);
  const category = clean(body.category, 60);
  const amount = Number(body.amount);
  const billingDay = Number(body.billingDay);
  const account = rows(state.accounts).find((entry) => entry.id === clean(body.accountId, 100) && (entry.type === "cash" || entry.type === "bank") && entry.active !== false);
  if (name.length < 2) throw new RecurringError("Nomini yozing (masalan: Ijara).");
  if (!category || !canAutomateRecurringExpenseCategory(category)) throw new RecurringError("Bu turdagi xarajat avtomatik bo‘lmaydi (mahsulot xaridi va maosh alohida kiritiladi).");
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw new RecurringError("Summani yozing.");
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) throw new RecurringError("Har oyning nechanchi kuni to‘lanishini tanlang (1–31).");
  if (!account) throw new RecurringError("Pul qaysi hisobdan chiqishini tanlang.");
  const month = today.slice(0, 7);
  let nextDue: string;
  if (current) {
    const baseMonth = String(current.nextDue || today).slice(0, 7);
    nextDue = dayOf(baseMonth, billingDay);
    if (current.lastPaidDate && nextDue <= String(current.lastPaidDate)) nextDue = dayOf(nextMonth(baseMonth), billingDay);
    if (current.active !== true && nextDue < today) {
      // To'xtatilgan xarajat qayta yoqilsa — o'tgan oylar uchun yozilmaydi, shu kundan boshlab.
      nextDue = dayOf(month, billingDay) >= today ? dayOf(month, billingDay) : dayOf(nextMonth(month), billingDay);
    }
  } else {
    const startMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(clean(body.startMonth, 7)) ? clean(body.startMonth, 7) : month;
    if (startMonth < month) throw new RecurringError("O‘tgan oylar uchun Xarajat bo‘limida alohida kiriting.");
    nextDue = dayOf(startMonth, billingDay);
    if (nextDue < today && startMonth === month && body.includeThisMonth !== true) nextDue = dayOf(nextMonth(month), billingDay);
  }
  // Shu nom/tur/hisob bilan bu oyga allaqachon yozilgan bo'lsa (masalan, to'xtatilgan eski shablondan) —
  // ikkinchi marta yozilmasin: keyingi oydan boshlanadi (eski tizim tekshiruvi ham shuni talab qiladi).
  const identity = recurringExpenseTemplateIdentity({ name, category, accountId: String(account.id) });
  const identityOf = new Map(templates.map((entry) => [String(entry.id), recurringExpenseTemplateIdentity({ name: String(entry.name || ""), category: String(entry.category || ""), accountId: String(entry.accountId || "") })]));
  const entries = rows(state.financialEntries);
  const reversed = new Set(entries.map((entry) => String(entry.reversedEntryId || "")).filter(Boolean));
  const usedMonths = new Set(entries.filter((entry) => entry.fixedExpenseId && !entry.reversedEntryId && !reversed.has(String(entry.id)) && identityOf.get(String(entry.fixedExpenseId)) === identity)
    .map((entry) => String(entry.fixedExpenseDueDate || entry.date || "").slice(0, 7)));
  for (let guard = 0; usedMonths.has(nextDue.slice(0, 7)) && guard < 24; guard += 1) nextDue = dayOf(nextMonth(nextDue.slice(0, 7)), billingDay);
  const saved: Row = {
    ...(current || {}),
    id: current ? String(current.id) : `v2-fixed-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    name, category, amount, accountId: String(account.id), frequency: "monthly", automatic: true, billingDay, nextDue, active: true,
  };
  const next = current ? templates.map((entry) => (entry.id === current.id ? saved : entry)) : [...templates, saved];
  if (!validRecurringExpenseMetadata(next, rows(state.financialEntries))) throw new RecurringError("Shu nom, tur va hisob bilan faol oylik xarajat bor.", 409);
  return { state: { ...state, fixedExpenses: next }, result: { template: saved } };
}

export function stopRecurring(state: Row, body: Row) {
  const templates = rows(state.fixedExpenses);
  const current = templates.find((entry) => entry.id === clean(body.id, 100));
  if (!current) throw new RecurringError("Xarajat topilmadi.", 404);
  if (current.active !== true) return { state, result: { alreadySaved: true } };
  return { state: { ...state, fixedExpenses: templates.map((entry) => (entry.id === current.id ? { ...entry, active: false } : entry)) }, result: { alreadySaved: false } };
}
