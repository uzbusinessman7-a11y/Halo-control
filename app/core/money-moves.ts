/**
 * HALO V2 — pul harakati: kassadan bankka (inkassatsiya) va teskari o'tkazma, boshqa kirim,
 * egasi pul kiritishi / qarz olish (foydaga ta'sir qilmaydi). Filial holatiga eski format bilan yoziladi,
 * ko'prik pul jurnaliga o'tkazadi. Takroriy so'rov ikkinchi marta yozmaydi.
 */
import { isAccountingMonthClosed } from "../lib/month-end";

type Row = Record<string, unknown>;
export class MoneyMoveError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);
export const INCOME_KINDS: Record<string, { label: string; affectsProfit: boolean }> = {
  other: { label: "Boshqa daromad", affectsProfit: true },
  owner: { label: "Egasi pul kiritdi", affectsProfit: false },
  loan: { label: "Qarz olindi", affectsProfit: false },
};

export function moneyAccounts(state: Row) {
  return rows(state.accounts).filter((account) => account.active !== false && typeof account.id === "string")
    .map((account) => ({ id: String(account.id), name: String(account.name || account.id), type: String(account.type || "") }));
}

export function addMoneyMove(state: Row, body: Row, today: string, closedThrough: string) {
  const operationId = clean(body.operationId, 36);
  if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new MoneyMoveError("Oynani yangilang.");
  const kind = clean(body.kind, 20);
  const id = `v2-${kind === "transfer" ? "transfer" : "income"}:${operationId}`;
  const entries = rows(state.financialEntries);
  const existing = entries.find((entry) => entry.id === id);
  if (existing) return { state, result: { entry: existing, alreadySaved: true } };
  const amount = Number(body.amount);
  const date = clean(body.date, 10);
  const note = clean(body.note, 300);
  const accounts = moneyAccounts(state);
  const from = accounts.find((account) => account.id === clean(body.accountId, 100));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000_000) throw new MoneyMoveError("Summani tekshiring.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new MoneyMoveError("Sanani tekshiring (kelajak bo'lmasin).");
  if (closedThrough && date <= closedThrough) throw new MoneyMoveError(`${closedThrough} gacha kunlar yopilgan. Bugungi sana bilan kiriting.`, 409);
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new MoneyMoveError(`${date.slice(0, 7)} oyi yopilgan.`, 409);
  if (!from) throw new MoneyMoveError("Hisobni tanlang.");
  let entry: Row;
  if (kind === "transfer") {
    const to = accounts.find((account) => account.id === clean(body.toAccountId, 100));
    if (!to || to.id === from.id) throw new MoneyMoveError("Qayerga o'tkazilganini tanlang (boshqa hisob).");
    entry = { id, type: "transfer", accountId: from.id, toAccountId: to.id, amount, date, category: "O'tkazma", note: note || `${from.name} → ${to.name}`, createdByName: "Rahbar", createdAt: new Date().toISOString() };
  } else {
    const income = INCOME_KINDS[clean(body.incomeKind, 20)];
    if (!income) throw new MoneyMoveError("Kirim turini tanlang.");
    if (!note && clean(body.incomeKind, 20) === "other") throw new MoneyMoveError("Kirim nimadan kelganini yozing.");
    entry = { id, type: "income", accountId: from.id, amount, date, category: income.label, note, affectsProfit: income.affectsProfit, createdByName: "Rahbar", createdAt: new Date().toISOString() };
  }
  return { state: { ...state, financialEntries: [entry, ...entries] }, result: { entry, alreadySaved: false } };
}
