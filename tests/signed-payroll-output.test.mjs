import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildGoogleSheetsExport } from "../app/lib/google-sheets-export.ts";
import { formatExpenseEffectWon } from "../app/lib/money-format.ts";

test("expense-effect money formatting never renders a double minus", () => {
  assert.equal(formatExpenseEffectWon(12_345.6), "−₩12,346");
  assert.equal(formatExpenseEffectWon(-12_345.6), "＋₩12,346");
  assert.equal(formatExpenseEffectWon(0), "₩0");
  assert.equal(formatExpenseEffectWon(Number.NaN), "₩0");
  assert.doesNotMatch(formatExpenseEffectWon(-12_345), /−₩-/);
});

test("Google Sheets keeps a negative daily payroll contra-expense", () => {
  const state = {
    accounts: [],
    inventory: [],
    recipes: [],
    suppliers: [],
    transactions: [],
    sales: [],
    financialEntries: [],
    workerConsumptions: [],
    stockMovements: [],
    dailyCloses: [],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
    staff: [{
      id: "worker-1",
      name: "Xodim",
      payType: "hourly",
      hourlyRate: 10_000,
      monthlySalary: 0,
      workDays: 26,
      dailyHours: 8,
      overtimeAfterHours: 8,
      overtimeMultiplier: 1,
      workerId: "",
      active: true,
    }],
    workShifts: [],
    payrollAdjustments: [{
      id: "deduction-1",
      staffId: "worker-1",
      date: "2026-08-02",
      type: "deduction",
      amount: 30_000,
      note: "Tuzatish",
      voided: false,
    }],
    attendanceDays: [],
    payrollPayments: [],
  };

  const exported = buildGoogleSheetsExport(state, "2026-08-02", "2026-08-02");
  const sheets = new Map(exported.sheets.map((sheet) => [sheet.name, sheet]));
  const money = sheets.get("HALO PUL HARAKATI");
  const payrollRow = money.rows.find((row) => row[2] === "Kunlik ish haqi");
  assert.ok(payrollRow, "signed payroll must remain visible in the money-detail sheet");
  assert.equal(payrollRow[1], "Xarajat");
  assert.equal(payrollRow[4], -30_000);

  const daily = sheets.get("HALO KUNLIK");
  const dailyRow = Object.fromEntries(daily.headers.map((header, index) => [header, daily.rows[0][index]]));
  assert.equal(dailyRow["Jami xarajat (₩)"], -30_000);
  assert.equal(dailyRow["Sof foyda (₩)"], 30_000);
});

test("both Telegram report paths use signed expense-effect formatting", () => {
  const apiSource = readFileSync(new URL("../app/lib/telegram-service.ts", import.meta.url), "utf8");
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(apiSource, /Jami xarajat: \$\{formatExpenseEffectWon\(daily\.totalExpenses\)\}/);
  assert.match(apiSource, /Maosh: \$\{formatExpenseEffectWon\(daily\.payroll\)\}/);
  assert.match(pageSource, /Jami xarajat: \$\{formatExpenseEffectWon\(todayTotalExpenses\)\}/);
  assert.match(pageSource, /Maosh: \$\{formatExpenseEffectWon\(todayPayroll\)\}/);
  assert.doesNotMatch(apiSource, /−\$\{won\(daily\.(?:totalExpenses|payroll)\)\}/);
  assert.doesNotMatch(pageSource, /−\$\{won\(today(?:TotalExpenses|Payroll)\)\}/);
});
