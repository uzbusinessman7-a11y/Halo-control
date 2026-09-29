import assert from "node:assert/strict";
import test from "node:test";
import { validateDailyCloseInput } from "../app/lib/daily-close.ts";

const accounts = [
  { id: "cash", name: "Naqd kassa" },
  { id: "bank", name: "Bank" },
  { id: "old", name: "Eski hisob", active: false },
];

const validInput = (overrides = {}) => ({
  date: "2026-09-06",
  today: "2026-09-06",
  accounts,
  actualByAccount: { cash: 10_000, bank: 0 },
  expectedByAccount: { cash: 9_500, bank: 500 },
  dailyCloses: [],
  monthlyCloses: [],
  note: "  Kassa sanovida farq  ",
  ...overrides,
});

test("daily close accepts an explicit zero and returns one reconciled result", () => {
  const result = validateDailyCloseInput(validInput());
  assert.deepEqual(result, {
    ok: true,
    actualByAccount: { cash: 10_000, bank: 0 },
    totalExpected: 10_000,
    totalActual: 10_000,
    difference: 0,
    note: "Kassa sanovida farq",
    date: "2026-09-06",
  });
  assert.equal("old" in result.actualByAccount, false, "inactive accounts are not part of the close");
});

test("daily close requires an explicit value for every active account", () => {
  const missing = validateDailyCloseInput(validInput({
    actualByAccount: { cash: 10_000 },
  }));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Bank.*haqiqiy summani kiriting/);

  for (const invalid of ["0", Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const result = validateDailyCloseInput(validInput({
      actualByAccount: { cash: 10_000, bank: invalid },
    }));
    assert.equal(result.ok, false);
    assert.match(result.error, /Bank.*0 yoki undan katta son/);
  }
});

test("daily close rejects missing or non-finite expected balances", () => {
  const missing = validateDailyCloseInput(validInput({
    expectedByAccount: { cash: 9_500 },
  }));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Bank.*qoldig‘i topilmadi/);

  const invalid = validateDailyCloseInput(validInput({
    expectedByAccount: { cash: 9_500, bank: Number.NaN },
  }));
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Bank.*qoldig‘i noto‘g‘ri/);
});

test("daily close rejects malformed, impossible, and future dates", () => {
  for (const date of ["06.09.2026", "2026-9-06", "2026-02-30"]) {
    const result = validateDailyCloseInput(validInput({ date }));
    assert.equal(result.ok, false);
    assert.match(result.error, /YYYY-MM-DD/);
  }
  const future = validateDailyCloseInput(validInput({ date: "2026-09-07" }));
  assert.equal(future.ok, false);
  assert.match(future.error, /Kelajakdagi/);
});

test("daily close cannot change a closed month or duplicate a closed day", () => {
  const closedMonth = validateDailyCloseInput(validInput({
    monthlyCloses: [{ month: "2026-09" }],
  }));
  assert.equal(closedMonth.ok, false);
  assert.match(closedMonth.error, /2026-09 oyi yopilgan/);

  const duplicateDay = validateDailyCloseInput(validInput({
    dailyCloses: [{ date: "2026-09-06" }],
  }));
  assert.equal(duplicateDay.ok, false);
  assert.match(duplicateDay.error, /allaqachon bor/);
});

test("daily close requires a reason only when the balances differ", () => {
  const missingReason = validateDailyCloseInput(validInput({
    actualByAccount: { cash: 9_000, bank: 0 },
    note: "   ",
  }));
  assert.equal(missingReason.ok, false);
  assert.match(missingReason.error, /Farq sababini yozing/);

  const explained = validateDailyCloseInput(validInput({
    actualByAccount: { cash: 9_000, bank: 0 },
    note: "  Kassada ₩1,000 kam  ",
  }));
  assert.equal(explained.ok, true);
  assert.equal(explained.totalExpected, 10_000);
  assert.equal(explained.totalActual, 9_000);
  assert.equal(explained.difference, -1_000);
  assert.equal(explained.note, "Kassada ₩1,000 kam");

  const exactWithoutNote = validateDailyCloseInput(validInput({ note: "", actualByAccount: { cash: 9_500, bank: 500 } }));
  assert.equal(exactWithoutNote.ok, true);
});
