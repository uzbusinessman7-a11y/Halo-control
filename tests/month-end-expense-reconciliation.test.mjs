import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  closeBusinessMonth,
  normalizeMonthlyCloses,
} from "../app/lib/month-end.ts";
import {
  normalizeStaff,
  normalizeWorkShifts,
  shiftRange,
} from "../app/lib/payroll.ts";

const controlCenterSource = readFileSync(new URL("../app/control-center.tsx", import.meta.url), "utf8");

test("month-end expense details use the canonical covered-category rule and reconcile payroll", () => {
  const range = shiftRange("2026-08-10", "12:00", "00:00");
  assert.ok(range);
  const staff = normalizeStaff([{
    id: "staff-month-end-expense",
    name: "Ali",
    payType: "monthly",
    monthlySalary: 2_600_000,
    hourlyRate: 0,
    workDays: 26,
    dailyHours: 12,
    active: true,
  }]);
  const workShifts = normalizeWorkShifts([{
    id: "shift-month-end-expense",
    staffId: staff[0].id,
    date: "2026-08-10",
    clockIn: range.clockIn,
    clockOut: range.clockOut,
    breakMinutes: 0,
    source: "owner",
    status: "closed",
  }]);
  const state = {
    inventory: [],
    stockMovements: [],
    staff,
    workShifts,
    payrollAdjustments: [],
    attendanceDays: [],
    payrollPayments: [],
    monthlyCloses: [],
    accounts: [{ id: "card", type: "card" }],
    sales: [{
      id: "sale-card",
      date: "2026-08-10",
      quantity: 1,
      totalRevenue: 10_000,
      totalCost: 4_000,
      accountId: "card",
    }],
    financialEntries: [
      { id: "rent", type: "expense", category: "Ijara", amount: 1_000, date: "2026-08-10", accountId: "card", note: "", affectsProfit: true },
      { id: "saved-card-fee", type: "expense", category: "POS / karta komissiyasi", amount: 200, date: "2026-08-10", accountId: "card", note: "", affectsProfit: true },
      { id: "saved-tax", type: "expense", category: "Soliq", amount: 300, date: "2026-08-10", accountId: "card", note: "", affectsProfit: true },
      { id: "manual-delivery-fee", type: "expense", category: "Yetkazib berish komissiyasi", amount: 700, date: "2026-08-10", accountId: "card", note: "", affectsProfit: true },
    ],
    workerConsumptions: [{ id: "waste", date: "2026-08-10", kind: "waste", quantity: 1, totalCost: 500 }],
    costRules: { cardCommissionPct: 2, deliveryCommissionPct: 0, taxPct: 3 },
  };

  const { record } = closeBusinessMonth(
    state,
    "2026-08",
    "Rahbar",
    "2026-09-01T00:00:00.000Z",
  );

  assert.deepEqual(record.expenseItems?.map((entry) => entry.id).sort(), ["manual-delivery-fee", "rent"]);
  assert.equal(record.expenseTotal, 1_700);
  assert.equal(record.cardCommission, 200);
  assert.equal(record.tax, 300);
  assert.equal(record.inventoryOutflowCost, 500);
  assert.equal(record.payrollExpense, 100_000);
  assert.equal(record.payrollGross, 100_000);
  assert.equal(
    record.operatingExpenseTotal,
    record.expenseTotal
      + record.cardCommission
      + record.deliveryCommission
      + record.tax
      + record.inventoryOutflowCost
      + record.payrollExpense,
  );
  assert.equal(normalizeMonthlyCloses([record])[0].payrollExpense, 100_000);
});

test("month-end UI shows payroll inside the reconciled expense breakdown", () => {
  assert.match(controlCenterSource, /<span>Oylik<\/span>/);
  assert.match(controlCenterSource, /selectedMonthlyClose\.payrollExpense \?\? selectedMonthlyClose\.payrollGross/);
  assert.match(controlCenterSource, /<span>Jami xarajat<\/span>/);
  assert.match(controlCenterSource, /xarajatga kirmaydi, hisobiy foydaga qo‘shiladi/);
});
