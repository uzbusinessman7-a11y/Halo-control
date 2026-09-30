/**
 * "Noldan boshlash": faqat bazaviy ma'lumot qoladi, hisob-kitob nol holatda.
 *
 * Saqlanadi (baza): kategoriyalar, hisoblar (kassa/bank nomlari), ombor mahsulotlari
 *   (nomi, birligi, qadoq, oxirgi narxi, min. qoldiq), retseptlar/menyu, yetkazuvchilar
 *   (ism, telefon, hisob raqami), MEZANA katalogi, doimiy xarajat shablonlari, xodimlar
 *   (ish haqi stavkasi), oshxona qoidalari, komissiya/soliq sozlamalari.
 * Nolga tushadi: ombor qoldig'i, hisoblarning boshlang'ich qoldig'i, yetkazuvchi qarzi.
 * O'chadi (tarix): savdo, xarajat, kirim-chiqim, qarz yozuvlari, smenalar, maosh,
 *   yopilgan kun/oylar, MEZANA yozuvlari, arxiv va audit.
 *
 * Oxirgi narx (unitCost) atayin saqlanadi: qoldiq 0 bo'lgani uchun ombor qiymati baribir 0,
 * lekin 1-kuni sanalgan boshlang'ich qoldiq va retsept tannarxi to'g'ri narx bilan hisoblanadi.
 * Birinchi kirimda narx yangi xarid narxiga almashadi (qoldiq 0 — o'rtacha faqat yangi narx).
 */

type Row = Record<string, unknown>;

/** Tarix: bo'sh ro'yxatga aylanadi. */
export const HISTORY_KEYS = [
  "transactions", "supplierDeliveries", "mezanaEntries", "workerConsumptions", "posOrders", "sales",
  "stockMovements", "financialEntries", "dailyCloses", "purchaseOrders", "workShifts", "payrollAdjustments",
  "attendanceDays", "payrollPayments", "monthlyCloses", "operationChecklistDays", "deletedItems", "auditLog",
] as const;

/** Baza: saqlanadi (ba'zilarida qoldiq/qarz maydonlari nolga tushadi). */
export const BASE_KEYS = [
  "productCategories", "accounts", "inventory", "recipes", "suppliers", "mezanaCatalog", "mezanaSettings",
  "fixedExpenses", "staff", "kitchenRules", "kitchenRuleReminderHours", "costRules",
] as const;

const INVENTORY_HISTORY_FIELDS = [
  "lastCountedAt", "lastCountedBy", "lastCount", "lastCountDate", "countedAt", "countedBy", "countDate",
  "lastMovementAt", "lastIntakeAt", "lastIntakeDate", "stockUpdatedAt",
];

export type BaseResetReport = {
  kept: Record<string, number>;
  cleared: Record<string, number>;
  unknownKept: string[];
  unknownCleared: Record<string, number>;
  zeroed: { stockItems: number; stockUnits: number; supplierDebt: number; supplierCount: number; accountOpening: number };
  startDate: string;
};

const list = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((v): v is Row => Boolean(v) && typeof v === "object" && !Array.isArray(v)) : []);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);

/** Sana YYYY-MM-DD bo'yicha oldinga surish (UTC hisobida, vaqt zonasi siljimaydi). */
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonthsClamped(date: string, months: number, day: number) {
  const [y, m] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(Math.max(1, day), last));
  return first.toISOString().slice(0, 10);
}

/** Doimiy xarajatning keyingi sanasi boshlanish kunidan oldin bo'lsa — oldinga suriladi (eski oylar uchun avtomatik xarajat yozilmasin). */
export function rollFixedExpense(entry: Row, startDate: string): Row {
  const next: Row = { ...entry };
  delete next.lastPaidDate;
  let due = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.nextDue || "")) ? String(entry.nextDue) : startDate;
  const frequency = String(entry.frequency || "monthly");
  const day = num(entry.billingDay) || Number(due.slice(8, 10)) || 1;
  let guard = 0;
  while (due < startDate && guard++ < 2000) {
    if (frequency === "daily") due = addDays(due, 1);
    else if (frequency === "weekly") due = addDays(due, 7);
    else due = addMonthsClamped(due, 1, day);
  }
  next.nextDue = due;
  return next;
}

export function toBaseState(state: Row, startDate: string): { state: Row; report: BaseResetReport } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Boshlanish sanasi noto'g'ri.");
  const known = new Set<string>([...HISTORY_KEYS, ...BASE_KEYS]);
  const out: Row = {};
  const report: BaseResetReport = {
    kept: {}, cleared: {}, unknownKept: [], unknownCleared: {},
    zeroed: { stockItems: 0, stockUnits: 0, supplierDebt: 0, supplierCount: 0, accountOpening: 0 },
    startDate,
  };

  for (const key of HISTORY_KEYS) {
    const count = Array.isArray(state[key]) ? (state[key] as unknown[]).length : 0;
    if (count) report.cleared[key] = count;
    out[key] = [];
  }

  for (const key of BASE_KEYS) {
    if (!(key in state)) continue;
    const value = state[key];
    if (key === "inventory") {
      out.inventory = list(value).map((item) => {
        const next: Row = { ...item };
        for (const field of INVENTORY_HISTORY_FIELDS) delete next[field];
        if (num(item.stock) !== 0) report.zeroed.stockItems++;
        report.zeroed.stockUnits += Math.abs(num(item.stock));
        next.stock = 0;
        return next;
      });
    } else if (key === "suppliers") {
      out.suppliers = list(value).map((supplier) => {
        const debt = num(supplier.balance);
        if (debt !== 0) report.zeroed.supplierCount++;
        report.zeroed.supplierDebt += debt;
        const next: Row = { ...supplier, balance: 0, openingBalance: 0 };
        delete next.balanceEdits;
        return next;
      });
    } else if (key === "accounts") {
      out.accounts = list(value).map((account) => {
        report.zeroed.accountOpening += num(account.openingBalance);
        return { ...account, openingBalance: 0 };
      });
    } else if (key === "recipes") {
      // Saqlangan eski tannarx (lineCost) olib tashlanadi — tannarx joriy narxdan jonli hisoblanadi.
      out.recipes = list(value).map((recipe) => ({
        ...recipe,
        ingredients: list(recipe.ingredients).map((line) => {
          const next: Row = { ...line };
          delete next.lineCost;
          return next;
        }),
      }));
    } else if (key === "fixedExpenses") {
      out.fixedExpenses = list(value).map((entry) => rollFixedExpense(entry, startDate));
    } else {
      out[key] = value;
    }
    const size = Array.isArray(out[key]) ? (out[key] as unknown[]).length : 1;
    report.kept[key] = size;
  }

  for (const [key, value] of Object.entries(state)) {
    if (known.has(key)) continue;
    if (Array.isArray(value)) {
      // Noma'lum ro'yxat — tarix deb hisoblanadi (nol holat talabi).
      out[key] = [];
      if (value.length) report.unknownCleared[key] = value.length;
    } else {
      out[key] = value;
      report.unknownKept.push(key);
    }
  }
  report.zeroed.stockUnits = Math.round(report.zeroed.stockUnits * 1000) / 1000;
  return { state: out, report };
}

/** Seul vaqti bo'yicha keyingi oyning 1-kuni. */
export function nextMonthStart(now = new Date()): string {
  const seoul = new Date(now.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(seoul.getUTCFullYear(), seoul.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}
