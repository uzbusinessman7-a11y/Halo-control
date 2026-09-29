type DailyCloseAccount = {
  id?: unknown;
  name?: unknown;
  active?: unknown;
};

export type DailyCloseValidationInput = {
  date?: unknown;
  today?: unknown;
  accounts?: unknown;
  actualByAccount?: unknown;
  expectedByAccount?: unknown;
  dailyCloses?: unknown;
  monthlyCloses?: unknown;
  note?: unknown;
};

export type ValidDailyCloseInput = {
  ok: true;
  actualByAccount: Record<string, number>;
  totalExpected: number;
  totalActual: number;
  difference: number;
  note: string;
  date: string;
};

export type InvalidDailyCloseInput = {
  ok: false;
  error: string;
};

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const validIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const records = (value: unknown): Array<Record<string, unknown>> => (
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => (
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
    ))
    : []
);

const accountLabel = (account: DailyCloseAccount) => {
  const name = typeof account.name === "string" ? account.name.trim() : "";
  const id = typeof account.id === "string" ? account.id.trim() : "";
  return name || id || "Pul hisobi";
};

export function validateDailyCloseInput(
  input: DailyCloseValidationInput,
): ValidDailyCloseInput | InvalidDailyCloseInput {
  const date = input.date;
  const today = input.today;
  if (!validIsoDate(date)) {
    return { ok: false, error: "Kunni yopish sanasini YYYY-MM-DD formatida kiriting." };
  }
  if (!validIsoDate(today)) {
    return { ok: false, error: "Bugungi hisob sanasi noto‘g‘ri." };
  }
  if (date > today) {
    return { ok: false, error: "Kelajakdagi kunni yopib bo‘lmaydi." };
  }

  const month = date.slice(0, 7);
  if (records(input.monthlyCloses).some((entry) => entry.month === month)) {
    return { ok: false, error: `${month} oyi yopilgan. Bu oy uchun kun yakunini o‘zgartirib bo‘lmaydi.` };
  }
  if (records(input.dailyCloses).some((entry) => entry.date === date)) {
    return { ok: false, error: "Bu sana uchun kun yopish yozuvi allaqachon bor." };
  }

  if (!Array.isArray(input.accounts)) {
    return { ok: false, error: "Pul hisoblarini tekshiring." };
  }
  const activeAccounts = input.accounts.filter((entry): entry is DailyCloseAccount => (
    Boolean(entry)
    && typeof entry === "object"
    && !Array.isArray(entry)
    && (entry as DailyCloseAccount).active !== false
  ));
  if (!activeAccounts.length) {
    return { ok: false, error: "Faol pul hisobi topilmadi." };
  }
  const accountIds = activeAccounts.map((account) => (
    typeof account.id === "string" ? account.id.trim() : ""
  ));
  if (accountIds.some((id) => !id) || new Set(accountIds).size !== accountIds.length) {
    return { ok: false, error: "Pul hisoblari takrorlangan yoki ID raqami noto‘g‘ri." };
  }

  if (!input.actualByAccount || typeof input.actualByAccount !== "object" || Array.isArray(input.actualByAccount)) {
    return { ok: false, error: "Har bir hisobning haqiqiy summasini kiriting." };
  }
  if (!input.expectedByAccount || typeof input.expectedByAccount !== "object" || Array.isArray(input.expectedByAccount)) {
    return { ok: false, error: "Dastur bo‘yicha hisob qoldiqlarini tekshiring." };
  }
  const actualSource = input.actualByAccount as Record<string, unknown>;
  const expectedSource = input.expectedByAccount as Record<string, unknown>;
  const actualByAccount: Record<string, number> = {};
  let totalExpected = 0;
  let totalActual = 0;
  let accountDifference = false;

  for (const account of activeAccounts) {
    const accountId = String(account.id).trim();
    const label = accountLabel(account);
    if (!own(actualSource, accountId)) {
      return { ok: false, error: `“${label}” uchun haqiqiy summani kiriting.` };
    }
    const actual = actualSource[accountId];
    if (typeof actual !== "number" || !Number.isFinite(actual) || actual < 0) {
      return { ok: false, error: `“${label}” haqiqiy summasi 0 yoki undan katta son bo‘lsin.` };
    }
    if (!own(expectedSource, accountId)) {
      return { ok: false, error: `“${label}” dastur bo‘yicha qoldig‘i topilmadi.` };
    }
    const expected = expectedSource[accountId];
    if (typeof expected !== "number" || !Number.isFinite(expected)) {
      return { ok: false, error: `“${label}” dastur bo‘yicha qoldig‘i noto‘g‘ri.` };
    }
    if (actual !== expected) accountDifference = true;
    actualByAccount[accountId] = actual;
    totalActual += actual;
    totalExpected += expected;
  }

  const difference = totalActual - totalExpected;
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (accountDifference && !note) {
    return { ok: false, error: "Hisobda farq bor. Farq sababini yozing." };
  }

  return {
    ok: true,
    actualByAccount,
    totalExpected,
    totalActual,
    difference,
    note,
    date,
  };
}
