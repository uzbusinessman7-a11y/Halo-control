/**
 * HALO V2 — ko'prik: eski tizim (app_state) → yangi pul jurnali.
 *
 * Eski tizimning kassa qoldig'i qoidasini (app/lib/account-balances.ts) aynan takrorlaydi:
 *  - hisob ochilish qoldig'i;
 *  - bekor qilinmagan savdolar (hisob ko'rsatilmagan bo'lsa — "account-card");
 *  - faol moliyaviy yozuvlar: kirim (+), chiqim (−), o'tkazma; naqdsiz (nonCash) yozuvlar kirmaydi;
 *  - har bir summa bir marta butun wonga yaxlitlanadi (Math.round), keyin qo'shiladi.
 * Hisobi topilmagan yozuv jurnalga kiritilmaydi va alohida ko'rsatiladi (eskisida ham shunday).
 *
 * Har bir eski yozuv o'z noyob amal raqamini oladi ("bridge:..."), shuning uchun ko'prikni
 * istalgancha qayta ishga tushirish mumkin — takror yozuv bo'lmaydi.
 * Sof funksiyalar: bazaga bog'liq emas.
 */
import { selectActiveFinancialEntries } from "../lib/daily-report";
import type { AccountInput } from "./ledger-store";
import type { EntryInput } from "./ledger";
import { saleDeductions } from "./deductions";
import { COURIER_CATEGORY } from "./courier";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value)
  ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
const won = (value: unknown) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);

/** Pul bo'lmagan tomonlar uchun hisoblar (kod → ta'rif). */
export const BRIDGE_ACCOUNTS: AccountInput[] = [
  { code: "savdo", name: "Savdo tushumi", kind: "income" },
  { code: "boshqa-kirim", name: "Boshqa kirim", kind: "income" },
  { code: "xarajat", name: "Xarajatlar", kind: "expense" },
  { code: "hisob-yopilishi", name: "Xarid va qarz to'lovlari (foydaga ta'sirsiz)", kind: "liability" },
  { code: "kapital-qarz", name: "Qarz yoki egasi pulini kiritish (foydaga ta'sirsiz)", kind: "equity" },
  { code: "kassa-farqi", name: "Kassa farqi (kamomad / ortiqcha)", kind: "expense" },
  { code: "komissiya", name: "Karta va delivery komissiyasi", kind: "expense" },
  { code: "soliq", name: "Soliq (POS savdosidan avtomatik)", kind: "expense" },
  { code: "soliq-zaxira", name: "To'lanadigan soliq zaxirasi", kind: "liability" },
  { code: "ochilish", name: "Ochilish qoldig'i", kind: "equity" },
  { code: "kuryer-puli", name: "Kuryer puli (yetkazish haqi, kuryerga beriladi)", kind: "liability" },
];

/** Eski hisob ID → yangi hisob kodi (barqaror, takrorlanmaydi). */
export function moneyAccountCode(oldId: string): string {
  const clean = oldId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "hisob";
  let hash = 0;
  for (const char of oldId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `pul-${clean}-${hash.toString(36).slice(0, 5)}`;
}

/** Eski yozuv ID'sidan barqaror amal raqami. */
export function bridgeOperationId(kind: string, oldId: string): string {
  const safe = /^[A-Za-z0-9:_-]{1,90}$/.test(oldId)
    ? oldId
    : `h${[...new TextEncoder().encode(oldId)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 88)}`;
  return `bridge:${kind}:${safe}`;
}

export interface BridgeEntry extends Omit<EntryInput, "lines"> {
  /** Qatorlar hisob KODLARI bilan (saqlashda ID ga aylantiriladi). */
  lines: Array<{ code: string; amount: number }>;
  source: string;
}

export interface BridgePlan {
  moneyAccounts: Array<AccountInput & { oldId: string }>;
  entries: BridgeEntry[];
  unmatched: string[];
  /** Summasi 0 bo'lgani uchun jurnalga kirmaydigan yozuvlar (pulga ta'siri yo'q). */
  zeroAmount: number;
  /** Avtomatik ushlanmalar (karta/delivery komissiyasi) — eski hisob ID → kutilayotgan pulni kamaytirgan summa.
   *  Eski tizim qoldig'i bilan solishtirishda hisobga olinadi. */
  feeByOldAccount: Map<string, number>;
}

export function buildBridgePlan(state: Row, today: string): BridgePlan {
  const accounts = rows(state.accounts).filter((account) => typeof account.id === "string" && account.id);
  const codeByOldId = new Map(accounts.map((account) => [String(account.id), moneyAccountCode(String(account.id))]));
  const moneyAccounts = accounts.map((account) => ({
    oldId: String(account.id),
    code: codeByOldId.get(String(account.id))!,
    name: String(account.name || account.id).slice(0, 60),
    kind: "asset" as const,
    isCash: account.type === "cash",
  }));

  const entries: BridgeEntry[] = [];
  const unmatched: string[] = [];
  let zeroAmount = 0;
  const dates: string[] = [];

  const accountTypeById = new Map(accounts.map((account) => [String(account.id), String(account.type || "")]));
  const feeByOldAccount = new Map<string, number>();
  const sales = rows(state.sales).filter((sale) => !sale.cancelledAt && !sale.voided && !["cancelled", "voided"].includes(String(sale.status)));
  for (const sale of sales) {
    const oldAccountId = String(sale.accountId ?? "account-card");
    const accountCode = codeByOldId.get(oldAccountId);
    if (!accountCode) { unmatched.push(`savdo:${String(sale.id || "?")}`); continue; }
    const amount = won(sale.totalRevenue);
    if (!amount) { zeroAmount += 1; continue; }
    const date = String(sale.date || "");
    dates.push(date);
    const label = `${String(sale.recipeId || sale.name || "").slice(0, 60)} · ${won(sale.quantity)} ta`;
    entries.push({
      operationId: bridgeOperationId("s", String(sale.id)), date, kind: "sale", actor: "Ko'prik",
      memo: `Savdo · ${label}`.slice(0, 300),
      lines: [{ code: accountCode, amount }, { code: "savdo", amount: -amount }], source: `savdo:${String(sale.id)}`,
    });
    // Avtomatik ushlanmalar — alohida yozuvlar (savdo yozuvi o'zgarmaydi).
    const cut = saleDeductions(sale, state, accountTypeById);
    const fee = cut.card + cut.delivery;
    if (fee > 0) {
      feeByOldAccount.set(oldAccountId, (feeByOldAccount.get(oldAccountId) || 0) + fee);
      entries.push({
        operationId: bridgeOperationId("k", String(sale.id)), date, kind: "expense", actor: "Ko'prik",
        memo: `${cut.card ? "Karta komissiyasi" : "Delivery ushlanmasi"} (avtomatik) · ${label}`.slice(0, 300),
        lines: [{ code: "komissiya", amount: fee }, { code: accountCode, amount: -fee }], source: `komissiya:${String(sale.id)}`,
      });
    }
    if (cut.tax > 0) {
      entries.push({
        operationId: bridgeOperationId("t", String(sale.id)), date, kind: "expense", actor: "Ko'prik",
        memo: `Soliq zaxirasi (avtomatik) · ${label}`.slice(0, 300),
        lines: [{ code: "soliq", amount: cut.tax }, { code: "soliq-zaxira", amount: -cut.tax }], source: `soliq:${String(sale.id)}`,
      });
    }
  }

  for (const entry of selectActiveFinancialEntries(rows(state.financialEntries) as Array<Row & { id?: string }>)) {
    if (entry.nonCash === true || !["income", "expense", "transfer"].includes(String(entry.type))) continue;
    const from = codeByOldId.get(String(entry.accountId));
    const to = entry.type === "transfer" ? codeByOldId.get(String(entry.toAccountId)) : undefined;
    if (!from || (entry.type === "transfer" && !to)) { unmatched.push(`pul:${String(entry.id || "?")}`); continue; }
    const amount = won(entry.amount);
    if (!amount) { zeroAmount += 1; continue; }
    const date = String(entry.date || "");
    dates.push(date);
    const settles = entry.affectsProfit === false;
    // Soliqni to'lash: avtomatik zaxiradan yopiladi (foydaga ikkinchi marta tushmaydi).
    const paysTaxReserve = entry.type === "expense" && settles && String(entry.category || "") === "Soliq";
    // Kuryer puli: mijozdan olingani ham, kuryerga berilgani ham bitta hisobda — qoldig'i hali berilmagan pulni ko'rsatadi.
    const courier = settles && String(entry.category || "") === COURIER_CATEGORY;
    const other = courier ? "kuryer-puli" : entry.type === "income" ? (settles ? "kapital-qarz" : "boshqa-kirim") : paysTaxReserve ? "soliq-zaxira" : settles ? "hisob-yopilishi" : "xarajat";
    const lines = entry.type === "transfer"
      ? [{ code: to!, amount }, { code: from, amount: -amount }]
      : entry.type === "income"
        ? [{ code: from, amount }, { code: other, amount: -amount }]
        : [{ code: other, amount }, { code: from, amount: -amount }];
    entries.push({
      operationId: bridgeOperationId("f", String(entry.id)), date,
      kind: entry.type === "transfer" ? "transfer" : entry.type === "income" ? "income" : "expense",
      actor: "Ko'prik", memo: `${String(entry.category || "")} · ${String(entry.note || "")}`.slice(0, 300),
      lines, source: `pul:${String(entry.id)}`,
    });
  }

  const firstDate = dates.filter(Boolean).sort()[0] || today;
  for (const account of accounts) {
    const amount = won(account.openingBalance);
    if (!amount) continue;
    entries.unshift({
      operationId: bridgeOperationId("o", String(account.id)), date: firstDate, kind: "opening", actor: "Ko'prik",
      memo: `Ochilish qoldig'i · ${String(account.name || account.id)}`.slice(0, 300),
      lines: [{ code: codeByOldId.get(String(account.id))!, amount }, { code: "ochilish", amount: -amount }], source: `ochilish:${String(account.id)}`,
    });
  }
  return { moneyAccounts, entries, unmatched, zeroAmount, feeByOldAccount };
}
