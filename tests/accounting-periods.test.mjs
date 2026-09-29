import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  closeBusinessMonth,
  isAccountingMonthClosed,
  MonthEndError,
} from "../app/lib/month-end.ts";
import {
  posBusinessDate,
} from "../app/lib/business-time.ts";
import { calculateDailyReport } from "../app/lib/daily-report.ts";
import { buildGoogleSheetsExport } from "../app/lib/google-sheets-export.ts";
import {
  preserveTrustedSaleFinancialRateSnapshots,
  reconcileSaleFinancialRateSnapshots,
  snapshotSaleFinancialRates,
} from "../app/lib/sale-financial-snapshots.ts";

const closedMonth = (month) => ({
  id: `monthly-close:${month}`,
  month,
  closedAt: `${month}-28T00:00:00.000Z`,
  closedBy: "Rahbar",
  inventoryItems: [],
  inventoryValue: 0,
  payrollItems: [],
  payrollGross: 0,
  payrollPaid: 0,
  payrollRemaining: 0,
});

const emptyMonthEndState = () => ({
  inventory: [],
  stockMovements: [],
  staff: [],
  workShifts: [],
  payrollAdjustments: [],
  attendanceDays: [],
  payrollPayments: [],
  monthlyCloses: [],
  sales: [],
  financialEntries: [],
});

test("POS accounting date changes at Seoul midnight, not noon", () => {
  assert.equal(posBusinessDate("2026-08-31T02:59:59.000Z"), "2026-08-31",
    "11:59 in Seoul remains on the same accounting date");
  assert.equal(posBusinessDate("2026-08-31T15:00:00.000Z"), "2026-09-01",
    "00:00 in Seoul starts the next accounting date");
  assert.equal(posBusinessDate("2026-09-01"), "2026-09-01");
});

test("POS closed-month guard returns conflict status", () => {
  const monthlyCloses = [closedMonth("2026-08")];
  assert.equal(isAccountingMonthClosed(monthlyCloses, "2026-08-31"), true);
  assert.equal(isAccountingMonthClosed(monthlyCloses, "2026-08"), true);
  assert.equal(isAccountingMonthClosed(monthlyCloses, "2026-09-01"), false);
  const source = readFileSync(new URL("../app/lib/pos-service.ts", import.meta.url), "utf8");
  assert.match(source, /throw new PosApiError\(\s*409,/);
  assert.match(source, /isAccountingMonthClosed\(monthlyCloses, date\)/);
});

test("POS import and refund both apply the closed-month guard", () => {
  const source = readFileSync(new URL("../app/lib/pos-service.ts", import.meta.url), "utf8");
  assert.match(source, /assertOpenPosAccountingMonth\(state\.monthlyCloses, date, "POS savdoni import qilish"\)/);
  assert.match(source, /String\(sale\.date \|\| ""\),\s*"POS savdoni qaytarish"/);
  assert.match(source, /assertOpenPosAccountingMonth\(state\.monthlyCloses, date, "POS savdoni qaytarish"\)/);
});

test("employee attendance cannot mutate a closed accounting month", () => {
  const source = readFileSync(new URL("../app/api/attendance/route.ts", import.meta.url), "utf8");
  assert.match(source, /isAccountingMonthClosed\(state\.monthlyCloses, businessDate\)/);
  assert.match(source, /isAccountingMonthClosed\(state\.monthlyCloses, openShift\.date\)/);
  assert.match(source, /status: error\.status/);
});

test("month end rejects every supported later-dated business activity", () => {
  const collections = [
    "sales",
    "stockMovements",
    "financialEntries",
    "transactions",
    "supplierDeliveries",
    "mezanaEntries",
    "workerConsumptions",
    "posOrders",
    "dailyCloses",
    "purchaseOrders",
    "workShifts",
    "payrollAdjustments",
    "attendanceDays",
    "payrollPayments",
    "operationChecklistDays",
  ];
  collections.forEach((collection) => {
    const state = emptyMonthEndState();
    state[collection] = [{ id: `${collection}-september`, date: "2026-09-01" }];
    assert.throws(
      () => closeBusinessMonth(state, "2026-08", "Rahbar", "2026-09-06T00:00:00.000Z"),
      (error) => error instanceof MonthEndError && /2026-09-01/.test(error.message),
      `${collection} must prevent a delayed August close`,
    );
  });

  const stateWithLaterClose = emptyMonthEndState();
  stateWithLaterClose.monthlyCloses = [closedMonth("2026-09")];
  assert.throws(
    () => closeBusinessMonth(stateWithLaterClose, "2026-08", "Rahbar", "2026-10-01T00:00:00.000Z"),
    MonthEndError,
  );
});

test("month end carries stock unchanged even when an old client requests a reset", () => {
  const state = {
    ...emptyMonthEndState(),
    inventory: [{ id: "meat", name: "Go‘sht", unit: "g", stock: 15_000, unitCost: 12 }],
  };
  const closed = closeBusinessMonth(
    state,
    "2026-08",
    "Rahbar",
    "2026-09-01T00:00:00.000Z",
    { meat: 0 },
    ["meat"],
  );
  assert.equal(closed.state.inventory[0].stock, 15_000);
  assert.equal(closed.state.stockMovements.length, 0);
  assert.deepEqual(closed.state.monthlyCloses[0].resetInventoryIds, []);
});

test("month end freezes the same complete financial result shown in daily reports", () => {
  const state = {
    ...emptyMonthEndState(),
    accounts: [{ id: "card", type: "card" }],
    sales: [
      { id: "sale-active", date: "2026-08-10", quantity: 1, totalRevenue: 10_000, totalCost: 4_000, accountId: "card" },
      { id: "sale-cancelled", date: "2026-08-10", quantity: 1, totalRevenue: 99_000, totalCost: 1, accountId: "card", status: "cancelled" },
    ],
    financialEntries: [{
      id: "rent",
      type: "expense",
      category: "Ijara",
      amount: 1_000,
      date: "2026-08-10",
      accountId: "card",
      note: "",
      affectsProfit: true,
    }],
    workerConsumptions: [{ id: "waste", date: "2026-08-10", kind: "waste", quantity: 1, totalCost: 500 }],
    costRules: { cardCommissionPct: 2, deliveryCommissionPct: 0, taxPct: 0 },
  };

  const closed = closeBusinessMonth(state, "2026-08", "Rahbar", "2026-09-01T00:00:00.000Z");

  assert.equal(closed.record.salesRevenue, 10_000);
  assert.equal(closed.record.salesCost, 4_000);
  assert.equal(closed.record.salesProfit, 6_000);
  assert.equal(closed.record.expenseTotal, 1_000, "manual expense detail stays available");
  assert.equal(closed.record.cardCommission, 200);
  assert.equal(closed.record.inventoryOutflowCost, 500);
  assert.equal(closed.record.operatingExpenseTotal, 1_700, "all operating expenses are frozen");
  assert.equal(closed.record.netProfit, 4_300);
});

test("new and edited sales receive trusted financial-rate snapshots", () => {
  const accounts = [{ id: "card", type: "card" }];
  const rules = { cardCommissionPct: 5, taxPct: 3 };
  const newSale = {
    id: "new-sale",
    date: "2026-09-01",
    totalRevenue: 10_000,
    accountId: "card",
    source: "pos",
    taxTreatment: "automatic",
    accountTypeAtSale: "bank",
    cardCommissionPctAtSale: 99,
    taxPctAtSale: 99,
  };
  const [savedNew] = reconcileSaleFinancialRateSnapshots([], [newSale], accounts, rules);
  assert.equal(savedNew.accountTypeAtSale, "card", "client-provided account classification is ignored");
  assert.equal(savedNew.cardCommissionPctAtSale, 5, "client-provided commission snapshot is ignored");
  assert.equal(savedNew.taxPctAtSale, 3, "client-provided tax snapshot is ignored");

  const trustedCurrent = snapshotSaleFinancialRates(newSale, "card", {
    cardCommissionPct: 2,
    taxPct: 1,
  });
  const unchangedOldClient = { ...trustedCurrent };
  delete unchangedOldClient.accountTypeAtSale;
  delete unchangedOldClient.cardCommissionPctAtSale;
  delete unchangedOldClient.taxPctAtSale;
  const [preserved] = reconcileSaleFinancialRateSnapshots(
    [trustedCurrent],
    [unchangedOldClient],
    accounts,
    rules,
  );
  assert.equal(preserved.accountTypeAtSale, "card", "an account edit cannot reclassify an old sale");
  assert.equal(preserved.cardCommissionPctAtSale, 2, "an old browser cannot erase the saved rate");
  assert.equal(preserved.taxPctAtSale, 1);

  const [edited] = reconcileSaleFinancialRateSnapshots(
    [trustedCurrent],
    [{ ...unchangedOldClient, totalRevenue: 20_000 }],
    accounts,
    rules,
  );
  assert.equal(edited.cardCommissionPctAtSale, 5, "money-bearing edits snapshot the current rate");
  assert.equal(edited.taxPctAtSale, 3);
});

test("a rules or account change backfills unchanged legacy sales from the old trusted configuration", () => {
  const legacySale = {
    id: "legacy-august-sale",
    date: "2026-08-10",
    totalRevenue: 100_000,
    accountId: "main-account",
    source: "pos",
    taxTreatment: "automatic",
  };
  const [backfilled] = reconcileSaleFinancialRateSnapshots(
    [legacySale],
    [legacySale],
    [{ id: "main-account", type: "card" }],
    { cardCommissionPct: 2, taxPct: 1 },
    [{ id: "main-account", type: "bank" }],
    { cardCommissionPct: 5, taxPct: 3 },
  );
  assert.equal(backfilled.accountTypeAtSale, "card");
  assert.equal(backfilled.cardCommissionPctAtSale, 2);
  assert.equal(backfilled.taxPctAtSale, 1);

  const currentWithSnapshots = snapshotSaleFinancialRates(legacySale, "card", {
    cardCommissionPct: 2,
    taxPct: 1,
  });
  const submittedByOldBrowser = { ...legacySale, cardCommissionPctAtSale: 99, taxPctAtSale: 99 };
  const [guarded] = preserveTrustedSaleFinancialRateSnapshots(
    [currentWithSnapshots],
    [submittedByOldBrowser],
  );
  assert.equal(guarded.accountTypeAtSale, "card");
  assert.equal(guarded.cardCommissionPctAtSale, 2);
  assert.equal(guarded.taxPctAtSale, 1);
});

test("owner state save keeps client and server financial snapshots in sync", () => {
  const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const stateRouteSource = readFileSync(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  assert.match(pageSource, /withClientSaleFinancialSnapshots\(/);
  assert.match(pageSource, /current\.costRules,[\s\S]*next\.costRules/);
  assert.match(
    pageSource,
    /localStateRef\.current\s*=\s*withClientSaleFinancialSnapshots\(\s*serverStateRef\.current,\s*reconcileArchivedState\(applyStatePatch\(localStateRef\.current, patch\)\)\.state,?\s*\)/,
    "queued local reapply must preserve server-owned sale snapshots until the canonical state reload",
  );
  const guardIndex = stateRouteSource.indexOf("const submittedSalesForClosedMonthGuard");
  const reconcileIndex = stateRouteSource.indexOf("body.sales = reconcileSaleFinancialRateSnapshots");
  assert.ok(guardIndex >= 0 && reconcileIndex > guardIndex,
    "closed sales are checked before server-owned legacy snapshots are backfilled");
});

test("daily, month-end, and Google Sheets keep the rate saved on each sale", () => {
  const sale = snapshotSaleFinancialRates({
    id: "historical-card-sale",
    recipeId: "recipe",
    date: "2026-08-10",
    quantity: 1,
    totalRevenue: 100_000,
    totalCost: 40_000,
    accountId: "card",
    source: "pos",
    taxTreatment: "automatic",
  }, "card", { cardCommissionPct: 2, taxPct: 1 });
  const state = {
    ...emptyMonthEndState(),
    accounts: [{ id: "card", name: "Karta", type: "card", openingBalance: 0 }],
    recipes: [{ id: "recipe", name: "Lavash", posCode: "000001", salePrice: 100_000, ingredients: [], extraCosts: [] }],
    suppliers: [],
    transactions: [],
    mezanaEntries: [],
    posOrders: [],
    dailyCloses: [],
    fixedExpenses: [],
    purchaseOrders: [],
    operationChecklistDays: [],
    sales: [sale],
    financialEntries: [
      { id: "covered-tax", date: "2026-08-10", type: "expense", category: "Soliq", amount: 777, affectsProfit: true },
      { id: "covered-card", date: "2026-08-10", type: "expense", category: "POS / karta komissiyasi", amount: 888, affectsProfit: true },
    ],
    workerConsumptions: [],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
  };

  const daily = calculateDailyReport(state, "2026-08-10");
  assert.equal(daily.cardCommission, 2_000);
  assert.equal(daily.tax, 1_000);
  assert.equal(daily.netProfit, 57_000);

  const accountTypeChanged = calculateDailyReport({
    ...state,
    accounts: [{ id: "card", name: "Renamed account", type: "bank", openingBalance: 0 }],
  }, "2026-08-10");
  assert.equal(accountTypeChanged.cardSales, 100_000, "the saved account type remains authoritative");
  assert.equal(accountTypeChanged.bankSales, 0);
  assert.equal(accountTypeChanged.cardCommission, 2_000);

  const closed = closeBusinessMonth(state, "2026-08", "Rahbar", "2026-09-01T00:00:00.000Z");
  assert.equal(closed.record.cardCommission, 2_000);
  assert.equal(closed.record.tax, 1_000);
  assert.equal(closed.record.expenseTotal, 0, "covered manual rows stay out of the frozen detail");
  assert.equal(closed.record.netProfit, 57_000);

  const exported = buildGoogleSheetsExport(state, "2026-08-10", "2026-08-10");
  const dailySheet = exported.sheets.find((sheet) => sheet.name === "HALO KUNLIK");
  const dailyRow = Object.fromEntries(dailySheet.headers.map((header, index) => [header, dailySheet.rows[0][index]]));
  assert.equal(dailyRow["Jami xarajat (₩)"], 3_000);
  assert.equal(dailyRow["Sof foyda (₩)"], 57_000);

  const legacy = calculateDailyReport({
    ...state,
    sales: [{ ...sale, cardCommissionPctAtSale: undefined, taxPctAtSale: undefined }],
    financialEntries: [],
    costRules: { cardCommissionPct: 5, deliveryCommissionPct: 0, taxPct: 3 },
  }, "2026-08-10");
  assert.equal(legacy.cardCommission, 5_000, "legacy rows still use the configured fallback");
  assert.equal(legacy.tax, 3_000);
});

test("saved automatic rates also keep manual duplicate filtering historical", () => {
  const sale = snapshotSaleFinancialRates({
    id: "sale-with-old-rules",
    date: "2026-08-10",
    quantity: 1,
    totalRevenue: 100_000,
    totalCost: 0,
    accountId: "card",
    source: "pos",
    taxTreatment: "automatic",
  }, "card", { cardCommissionPct: 2, taxPct: 1 });
  const state = {
    accounts: [{ id: "card", type: "card" }],
    sales: [sale],
    financialEntries: [
      { id: "manual-tax", date: "2026-08-10", type: "expense", category: "Soliq", amount: 777, affectsProfit: true },
      { id: "manual-card", date: "2026-08-10", type: "expense", category: "POS / karta komissiyasi", amount: 888, affectsProfit: true },
    ],
    workerConsumptions: [],
    staff: [],
    workShifts: [],
    payrollAdjustments: [],
    attendanceDays: [],
    costRules: { cardCommissionPct: 0, deliveryCommissionPct: 0, taxPct: 0 },
  };
  const report = calculateDailyReport(state, "2026-08-10");
  assert.equal(report.cardCommission, 2_000);
  assert.equal(report.tax, 1_000);
  assert.equal(report.manualExpenses, 0, "old automatic categories do not reappear when today's rules are zero");
  assert.equal(report.totalExpenses, 3_000);

  const zeroRateSale = snapshotSaleFinancialRates(sale, "card", { cardCommissionPct: 0, taxPct: 0 });
  const zeroRateReport = calculateDailyReport({
    ...state,
    sales: [zeroRateSale],
    costRules: { cardCommissionPct: 5, deliveryCommissionPct: 0, taxPct: 3 },
  }, "2026-08-10");
  assert.equal(zeroRateReport.cardCommission, 0);
  assert.equal(zeroRateReport.tax, 0);
  assert.equal(zeroRateReport.manualExpenses, 1_665,
    "a later automatic rule cannot hide manual expenses from a zero-rate historical sale");
});

test("POS-only tax and card fees exclude all delivery platforms even with legacy snapshots", () => {
  const deliverySales = ["coupang", "baemin", "yogiyo"].map((deliveryPlatform) => ({
    id: `delivery-${deliveryPlatform}`, source: "delivery", deliveryPlatform,
    date: "2026-08-10", quantity: 1, totalRevenue: 20000, totalCost: 0,
    accountId: "card", accountTypeAtSale: "card", taxTreatment: "automatic",
    taxPctAtSale: 10, cardCommissionPctAtSale: 1.6, deliveryCommissionAmount: 5000,
  }));
  const state = { ...emptyMonthEndState(),
    accounts: [{id:"card",type:"card"}],
    sales: [{id:"pos",source:"pos",date:"2026-08-10",quantity:1,totalRevenue:100000,totalCost:0,accountId:"card"}, ...deliverySales],
    financialEntries: [], costRules:{cardCommissionPct:1.6,taxPct:10,deliveryCommissionPct:0},
  };
  const report = calculateDailyReport(state,"2026-08-10");
  assert.equal(report.tax,10000);
  assert.equal(report.cardCommission,1600);
  assert.equal(report.deliveryCommission,15000);
  assert.equal(report.taxableSales,100000);
  assert.equal(report.accountantManagedSales,60000);
  assert.equal(report.taxExemptSales,0,"delivery restaurant VAT is accountant-managed, not exempt");
  assert.equal(report.netProfit,133400);
  for (const sale of deliverySales) {
    const fresh = snapshotSaleFinancialRates(sale,"card",state.costRules);
    assert.equal(fresh.accountTypeAtSale,"delivery");
    assert.equal(fresh.cardCommissionPctAtSale,0);
    assert.equal(fresh.taxPctAtSale,0);
  }
  const exported = buildGoogleSheetsExport(state,"2026-08-10","2026-08-10");
  assert.equal(exported.totals.tax,10000);
  assert.equal(exported.totals.cardCommission,1600);
  const closed = closeBusinessMonth(state,"2026-08","Rahbar","2026-09-01T00:00:00.000Z");
  assert.equal(closed.record.tax,10000);
  assert.equal(closed.record.cardCommission,1600);
});
