import assert from "node:assert/strict";
import test from "node:test";

import { calculateDailyReport } from "../app/lib/daily-report.ts";
import { closeBusinessMonth } from "../app/lib/month-end.ts";
import {
  calculatePayroll,
  calculatePayrollForDate,
  normalizeStaff,
} from "../app/lib/payroll.ts";

const member = (overrides = {}) => normalizeStaff([{
  id: "worker-1",
  name: "Xodim",
  payType: "hourly",
  hourlyRate: 10_000,
  monthlySalary: 0,
  workDays: 26,
  dailyHours: 8,
  overtimeAfterHours: 8,
  overtimeMultiplier: 1,
  active: true,
  ...overrides,
}])[0];

const shift = (id, date, clockIn, clockOut, hourlyRateAtShift = 10_000) => ({
  id,
  staffId: "worker-1",
  date,
  clockIn,
  clockOut,
  breakMinutes: 0,
  hourlyRateAtShift,
  overtimeAfterHoursAtShift: 8,
  overtimeMultiplierAtShift: 1,
  note: "",
  source: "owner",
  status: "closed",
  createdAt: clockIn,
  updatedAt: clockOut,
});

const adjustment = (id, date, type, amount, voided = false) => ({
  id,
  staffId: "worker-1",
  date,
  type,
  amount,
  note: "",
  voided,
});

test("daily payroll keeps deductions signed while advances stay outside payroll expense", () => {
  const staffMember = member();
  const workShifts = [shift(
    "shift-1",
    "2026-08-01",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T08:00:00.000Z",
  )];
  const payrollAdjustments = [
    adjustment("deduction", "2026-08-02", "deduction", 30_000),
    adjustment("advance", "2026-08-03", "advance", 20_000),
    adjustment("voided", "2026-08-04", "deduction", 99_000, true),
  ];

  assert.equal(calculatePayrollForDate(staffMember, workShifts, payrollAdjustments, [], "2026-08-01"), 80_000);
  assert.equal(calculatePayrollForDate(staffMember, workShifts, payrollAdjustments, [], "2026-08-02"), -30_000);
  assert.equal(calculatePayrollForDate(staffMember, workShifts, payrollAdjustments, [], "2026-08-03"), 0);
  assert.equal(calculatePayrollForDate(staffMember, workShifts, payrollAdjustments, [], "2026-08-04"), 0);

  const state = { staff: [staffMember], workShifts, payrollAdjustments, attendanceDays: [] };
  assert.equal(calculateDailyReport(state, "2026-08-01").payroll, 80_000);
  const deductionDay = calculateDailyReport(state, "2026-08-02");
  assert.equal(deductionDay.payroll, -30_000);
  assert.equal(deductionDay.totalExpenses, -30_000);
  assert.equal(deductionDay.netProfit, 30_000);
  assert.equal(
    calculateDailyReport(state, "2026-08-01").payroll
      + calculateDailyReport(state, "2026-08-02").payroll,
    Math.round(calculatePayroll(staffMember, workShifts, payrollAdjustments, "2026-08").grossPay),
  );
});

test("daily payroll cumulative rounding reconciles exactly to the monthly result", () => {
  const staffMember = member({ hourlyRate: 1 });
  const workShifts = [
    shift("fraction-1", "2026-08-01", "2026-08-01T00:00:00.000Z", "2026-08-01T00:30:00.000Z", 1),
    shift("fraction-2", "2026-08-02", "2026-08-02T00:00:00.000Z", "2026-08-02T00:30:00.000Z", 1),
    shift("fraction-3", "2026-08-03", "2026-08-03T00:00:00.000Z", "2026-08-03T00:30:00.000Z", 1),
  ];
  const daily = ["2026-08-01", "2026-08-02", "2026-08-03"].map((date) => (
    calculatePayrollForDate(staffMember, workShifts, [], [], date)
  ));
  assert.deepEqual(daily, [1, 0, 1]);
  assert.equal(
    daily.reduce((sum, amount) => sum + amount, 0),
    Math.round(calculatePayroll(staffMember, workShifts, [], "2026-08").grossPay),
  );
});

test("month close stores the same payroll expense used by daily profit", () => {
  const staffMember = member();
  const workShifts = [shift(
    "shift-close",
    "2026-08-01",
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T08:00:00.000Z",
  )];
  const payrollAdjustments = [adjustment("deduction-close", "2026-08-02", "deduction", 30_000)];
  const closed = closeBusinessMonth({
    inventory: [],
    stockMovements: [],
    staff: [staffMember],
    workShifts,
    payrollAdjustments,
    attendanceDays: [],
    payrollPayments: [],
    sales: [{ id: "sale-1", date: "2026-08-01", quantity: 1, totalRevenue: 100_000, totalCost: 0, accountId: "cash" }],
    financialEntries: [],
    workerConsumptions: [],
    accounts: [{ id: "cash", type: "cash" }],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
    monthlyCloses: [],
  }, "2026-08", "Rahbar", "2026-09-01T00:00:00.000Z");

  assert.equal(closed.record.payrollGross, 50_000);
  assert.equal(closed.record.payrollExpense, 50_000);
  assert.equal(closed.record.operatingExpenseTotal, 50_000);
  assert.equal(closed.record.netProfit, 50_000);
});
