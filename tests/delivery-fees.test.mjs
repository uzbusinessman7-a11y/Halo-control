import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateDeliveryAmount,
  allocateDeliveryFeeBreakdown,
  calculateDeliveryFeeBreakdown,
  deliveryFeeRuleForPlatform,
  deliveryFeeRuleForOrder,
  deliveryOrderAdjustmentsForEdit,
  deliveryCommissionAmount,
  validDeliveryOrderAdjustments,
  deliveryMenuPrice,
  normalizeDeliveryPlatformPrices,
  calculateDeliveryManualFees,
  emptyDeliveryManualFees,
  deliveryManualFeesFromRule,
  deliveryAutomaticManualFees,
  deliveryCombinedPercent,
  deliveryManualFeesForEdit,
  validDeliveryManualFees,
  groupDeliveryOrders,
  deliveryWonFeesForEdit,
} from "../app/lib/delivery-sales.ts";

test("simple saved rule automatically subtracts one percent, delivery and discount", () => {
  const rule = {
    combinedPct: 16, brokeragePct: 0, paymentPct: 0, deliveryFeeWon: 3400,
    vatPct: 0, couponPct: 0, instantDiscountWon: 1000, advertisingPct: 0,
  };
  assert.equal(deliveryCombinedPercent(rule), 16);
  const inputs = deliveryAutomaticManualFees(rule);
  assert.deepEqual(calculateDeliveryManualFees(26_000, inputs), {
    brokerage: 4160, payment: 0, delivery: 3400, vat: 0, coupon: 0,
    instantDiscount: 1000, advertising: 0, total: 8560,
  });
  assert.equal(26_000 - calculateDeliveryManualFees(26_000, inputs).total, 17_440);
});

test("Coupang defaults keep percent and won deductions separate", () => {
  assert.deepEqual(deliveryFeeRuleForPlatform({}, "coupang"), {
    brokeragePct: 7.8,
    paymentPct: 3,
    deliveryFeeWon: 3400,
    vatPct: 10,
    couponPct: 0,
    instantDiscountWon: 0,
    advertisingPct: 0,
  });
});

test("Coupang settlement screenshot is reproduced exactly", () => {
  const rule = deliveryFeeRuleForPlatform({
    deliveryPlatformRules: {
      coupang: {
        brokeragePct: 7.8,
        paymentPct: 3,
        deliveryFeeWon: 3400,
        vatPct: 10,
        couponPct: 745 / 18400 * 100,
        instantDiscountWon: 1000,
        advertisingPct: 0,
      },
    },
  }, "coupang");
  assert.deepEqual(calculateDeliveryFeeBreakdown(18400, rule), {
    brokerage: 1435,
    payment: 500,
    delivery: 3400,
    vat: 534,
    coupon: 745,
    instantDiscount: 1000,
    advertising: 0,
    total: 7614,
  });
});

test("fixed order deductions are allocated once across all menu rows", () => {
  const allocated = allocateDeliveryAmount([14900, 3500], 3400);
  assert.equal(allocated.length, 2);
  assert.equal(allocated.reduce((sum, value) => sum + value, 0), 3400);
});

test("an empty delivery draft has no fixed deductions", () => {
  const rule = deliveryFeeRuleForPlatform({}, "coupang");
  assert.equal(calculateDeliveryFeeBreakdown(0, rule).total, 0);
});

test("each delivery platform can keep a different menu price", () => {
  const recipe = {
    salePrice: 13_900,
    deliveryPrices: { coupang: 15_400, baemin: 14_900 },
  };
  assert.equal(deliveryMenuPrice(recipe, "coupang"), 15_400);
  assert.equal(deliveryMenuPrice(recipe, "baemin"), 14_900);
  assert.equal(deliveryMenuPrice(recipe, "yogiyo"), 13_900);
});

test("invalid platform prices are removed before saving", () => {
  assert.deepEqual(normalizeDeliveryPlatformPrices({ coupang: 15_400, baemin: -1, other: 99_000 }), { coupang: 15_400 });
});

test("15900 won screenshot: no promotion yields the actual settlement and margin", () => {
  const rule = { ...deliveryFeeRuleForPlatform({}, "coupang"), couponPct: 5, instantDiscountWon: 1000 };
  const fees = calculateDeliveryFeeBreakdown(15900, rule, { couponWon: 0, instantDiscountWon: 0 });
  assert.deepEqual(fees, { brokerage: 1240, payment: 477, delivery: 3400, vat: 512, coupon: 0, instantDiscount: 0, advertising: 0, total: 5629 });
  assert.equal(15900 - fees.total, 10271);
  assert.equal(15900 - fees.total - 5334, 4937);
  assert.equal(((15900 - fees.total - 5334) / 15900 * 100).toFixed(2), "31.05");
  const discounted = calculateDeliveryFeeBreakdown(15900, rule, { couponWon: 0, instantDiscountWon: 1000 });
  assert.equal(discounted.total, 6596);
  assert.equal(discounted.total - fees.total, 967);
});

test("all supplied promotion examples reproduce settlement in whole won", () => {
  const rule = deliveryFeeRuleForPlatform({}, "coupang");
  for (const [revenue, couponWon, settlement] of [
    [18400, 745, 10786], [26900, 0, 18997], [22800, 695, 14713],
    [18300, 0, 11419], [19300, 940, 11391], [20300, 990, 12225], [18800, 695, 11188],
  ]) {
    const fees = calculateDeliveryFeeBreakdown(revenue, rule, { couponWon, instantDiscountWon: 1000 });
    assert.equal(revenue - fees.total, settlement, `Revenue ${revenue}`);
  }
});

test("every row total equals its fee lines and the whole order stays exact", () => {
  const fees = calculateDeliveryFeeBreakdown(18400, deliveryFeeRuleForPlatform({}, "coupang"), { couponWon: 745, instantDiscountWon: 1000 });
  const allocated = allocateDeliveryFeeBreakdown([14900, 3500, 0], fees);
  for (const row of allocated) {
    assert.equal(row.total, Object.entries(row).filter(([key]) => key !== "total").reduce((sum, [, amount]) => sum + amount, 0));
  }
  for (const key of Object.keys(fees)) assert.equal(allocated.reduce((sum, row) => sum + row[key], 0), fees[key]);
  assert.equal(allocated[2].total, 0);
  const savedRows = JSON.parse(JSON.stringify(allocated.map((row) => ({ deliveryCommissionAmount: row.total }))));
  assert.equal(savedRows.reduce((sum, sale) => sum + deliveryCommissionAmount(sale, 99), 0), fees.total);
});

test("editing uses saved tariffs despite later settings changes", () => {
  const savedRule = { ...deliveryFeeRuleForPlatform({}, "coupang"), instantDiscountWon: 1000 };
  const sale = { deliveryPlatform: "coupang", deliveryFeeRule: savedRule };
  const currentSettings = { deliveryPlatformRules: { coupang: { ...savedRule, brokeragePct: 9.9, deliveryFeeWon: 5000 } } };
  assert.deepEqual(deliveryFeeRuleForOrder(currentSettings, "coupang", sale), savedRule);
  assert.equal(deliveryFeeRuleForOrder(currentSettings, "baemin", sale).deliveryFeeWon, 0);
  const oldFlatSale = { deliveryPlatform: "coupang", deliveryCommissionPct: 12 };
  const oldRule = deliveryFeeRuleForOrder(currentSettings, "coupang", oldFlatSale);
  assert.equal(calculateDeliveryFeeBreakdown(15000, oldRule).total, 1800);
});

test("editing restores order promotions once, including explicit zero", () => {
  const rule = { ...deliveryFeeRuleForPlatform({}, "coupang"), couponPct: 5, instantDiscountWon: 1000 };
  const zero = { couponWon: 0, instantDiscountWon: 0 };
  assert.deepEqual(deliveryOrderAdjustmentsForEdit([{ totalRevenue: 15900, deliveryOrderAdjustments: zero }], rule), { ...zero, deliveryFeeWon: 3400 });
  const adjustments = { couponWon: 745, instantDiscountWon: 1000 };
  const rows = allocateDeliveryFeeBreakdown([14900, 3500], calculateDeliveryFeeBreakdown(18400, rule, adjustments))
    .map((deliveryFeeBreakdown, index) => ({ totalRevenue: [14900, 3500][index], deliveryFeeBreakdown }));
  assert.deepEqual(deliveryOrderAdjustmentsForEdit(rows, rule), { ...adjustments, deliveryFeeWon: 3400 });
  assert.deepEqual(deliveryOrderAdjustmentsForEdit(rows.map((row) => ({ ...row, deliveryOrderAdjustments: adjustments })), rule), { ...adjustments, deliveryFeeWon: 3400 });
});

test("invalid and oversized promotions cannot be saved", () => {
  for (const amount of [-1, 0.5, NaN, Infinity, 16000]) {
    assert.equal(validDeliveryOrderAdjustments({ couponWon: amount, instantDiscountWon: 0 }, 15900), false);
  }
  assert.equal(validDeliveryOrderAdjustments({ couponWon: 10000, instantDiscountWon: 6000 }, 15900), false);
  assert.equal(validDeliveryOrderAdjustments({ couponWon: 745, instantDiscountWon: 1000 }, 18400), true);
  assert.equal(validDeliveryOrderAdjustments({ couponWon: 0, instantDiscountWon: 0 }, 15900), true);
});

test("actual delivery fee changes VAT and settlement and honors explicit zero", () => {
  const rule = deliveryFeeRuleForPlatform({}, "coupang");
  const actual = calculateDeliveryFeeBreakdown(15900, rule, { couponWon: 0, instantDiscountWon: 0, deliveryFeeWon: 2400 });
  assert.equal(actual.delivery, 2400);
  assert.equal(actual.vat, 412);
  assert.equal(actual.total, 4529);
  assert.equal(15900 - actual.total, 11371);
  const free = calculateDeliveryFeeBreakdown(15900, rule, { couponWon: 0, instantDiscountWon: 0, deliveryFeeWon: 0 });
  assert.equal(free.delivery, 0);
  assert.equal(free.vat, 172);
  const defaultFees = calculateDeliveryFeeBreakdown(15900, rule, { couponWon: 0, instantDiscountWon: 0 });
  assert.equal(defaultFees.delivery, 3400);
  assert.equal(rule.deliveryFeeWon, 3400);
});

test("delivery override survives order row allocation and historical editing", () => {
  const rule = deliveryFeeRuleForPlatform({}, "coupang");
  const adjustments = { couponWon: 745, instantDiscountWon: 1000, deliveryFeeWon: 2400 };
  const fees = calculateDeliveryFeeBreakdown(18400, rule, adjustments);
  const revenues = [14900, 3500];
  const rows = allocateDeliveryFeeBreakdown(revenues, fees).map((deliveryFeeBreakdown, index) => ({ totalRevenue: revenues[index], deliveryFeeBreakdown, deliveryOrderAdjustments: adjustments }));
  assert.equal(rows.reduce((sum, sale) => sum + sale.deliveryFeeBreakdown.delivery, 0), 2400);
  const changedRule = { ...rule, deliveryFeeWon: 5000 };
  assert.deepEqual(deliveryOrderAdjustmentsForEdit(JSON.parse(JSON.stringify(rows)), changedRule), adjustments);
  const olderRows = rows.map(({ deliveryOrderAdjustments, ...row }) => row);
  assert.deepEqual(deliveryOrderAdjustmentsForEdit(olderRows, changedRule), adjustments);
  const zeroOverride = [{ totalRevenue: 15900, deliveryOrderAdjustments: { couponWon: 0, instantDiscountWon: 0, deliveryFeeWon: 0 } }];
  assert.equal(deliveryOrderAdjustmentsForEdit(zeroOverride, changedRule).deliveryFeeWon, 0);
});

test("delivery fee accepts a nonnegative whole won amount even on a loss-making order", () => {
  for (const deliveryFeeWon of [-1, 0.5, NaN, Infinity]) {
    assert.equal(validDeliveryOrderAdjustments({ couponWon: 0, instantDiscountWon: 0, deliveryFeeWon }, 15900), false);
  }
  for (const deliveryFeeWon of [0, 2400, 3400, 20000]) {
    assert.equal(validDeliveryOrderAdjustments({ couponWon: 0, instantDiscountWon: 0, deliveryFeeWon }, 15900), true);
  }
});

test("manual won entries reproduce the exact statement independently of defaults", () => {
  const inputs = emptyDeliveryManualFees();
  const statement = { brokerage: 1240, payment: 477, delivery: 3400, vat: 512, coupon: 0, instantDiscount: 0, advertising: 0, total: 5629 };
  for (const key of Object.keys(inputs)) inputs[key].value = statement[key];
  assert.equal(validDeliveryManualFees(inputs, 15900), true);
  assert.deepEqual(calculateDeliveryManualFees(15900, inputs), statement);
  assert.equal(calculateDeliveryManualFees(20000, inputs).total, 5629);
  assert.equal(calculateDeliveryManualFees(15900, emptyDeliveryManualFees()).total, 0);
});

test("mixed percentage and exact fees use the displayed bases once", () => {
  const inputs = deliveryManualFeesFromRule(deliveryFeeRuleForPlatform({}, "coupang"));
  inputs.coupon = { unit: "won", value: 745 };
  inputs.instantDiscount = { unit: "won", value: 1000 };
  inputs.advertising = { unit: "percent", value: 2 };
  assert.deepEqual(calculateDeliveryManualFees(18400, inputs), {
    brokerage: 1435, payment: 500, delivery: 3400, vat: 534, coupon: 745, instantDiscount: 1000, advertising: 368, total: 7982,
  });
  inputs.brokerage = { unit: "won", value: 1200 };
  const revised = calculateDeliveryManualFees(18400, inputs);
  assert.equal(revised.brokerage, 1200);
  assert.equal(revised.vat, 510);
  inputs.vat = { unit: "won", value: 499 };
  assert.equal(calculateDeliveryManualFees(18400, inputs).vat, 499);
});

test("every manual fee supports percent or won and rejects invalid values", () => {
  for (const key of Object.keys(emptyDeliveryManualFees())) {
    for (const unit of ["percent", "won"]) {
      const inputs = emptyDeliveryManualFees();
      inputs[key] = { unit, value: 1 };
      assert.equal(validDeliveryManualFees(inputs, 10000), true);
      if (key !== "vat") assert.equal(calculateDeliveryManualFees(10000, inputs)[key], unit === "percent" ? 100 : 1);
    }
    for (const entry of [{unit:"percent",value:101},{unit:"won",value:-1},{unit:"won",value:0.5},{unit:"percent",value:NaN},{unit:"invalid",value:0}]) {
      const inputs = emptyDeliveryManualFees(); inputs[key] = entry;
      assert.equal(validDeliveryManualFees(inputs, 10000), false);
    }
  }
  const excessive = emptyDeliveryManualFees();
  excessive.coupon = { unit: "percent", value: 60 };
  excessive.instantDiscount = { unit: "percent", value: 50 };
  assert.equal(validDeliveryManualFees(excessive, 10000), false);
});

test("manual inputs persist once per order and old statements reopen with exact amounts", () => {
  const inputs = deliveryManualFeesFromRule(deliveryFeeRuleForPlatform({}, "coupang"));
  const fees = calculateDeliveryManualFees(18400, inputs);
  const allocated = allocateDeliveryFeeBreakdown([14900,3500], fees);
  const sales = allocated.map((deliveryFeeBreakdown,index) => ({ totalRevenue:[14900,3500][index], deliveryFeeBreakdown, deliveryManualFees:inputs, deliveryCommissionAmount:deliveryFeeBreakdown.total }));
  const restored = deliveryManualFeesForEdit(JSON.parse(JSON.stringify(sales)), 99);
  assert.deepEqual(restored, inputs);
  restored.brokerage.value = 0;
  assert.equal(inputs.brokerage.value, 7.8);
  const legacy = sales.map(({deliveryManualFees,...sale}) => sale);
  assert.deepEqual(calculateDeliveryManualFees(18400, deliveryManualFeesForEdit(legacy,99)), fees);
  assert.equal(calculateDeliveryManualFees(18400, deliveryManualFeesForEdit([{totalRevenue:18400,deliveryCommissionAmount:7614}],99)).total, 7614);
});

test("won-only editing converts old percent entries without changing saved deductions", () => {
  const inputs = deliveryManualFeesFromRule(deliveryFeeRuleForPlatform({}, "coupang"));
  const fees = calculateDeliveryManualFees(15900, inputs);
  const sales = [{ totalRevenue:15900, deliveryManualFees:inputs, deliveryFeeBreakdown:fees }];
  const restored = deliveryWonFeesForEdit(sales);
  assert.ok(Object.values(restored).every((fee) => fee.unit === "won"));
  assert.deepEqual(calculateDeliveryManualFees(15900, restored), fees);
  assert.deepEqual(calculateDeliveryManualFees(20000, restored), fees, "won amounts stay explicit when order quantity changes");
  assert.deepEqual(calculateDeliveryManualFees(15900, deliveryWonFeesForEdit([{totalRevenue:15900,deliveryManualFees:inputs}])), fees);
  const rows = allocateDeliveryFeeBreakdown([10000,5900],fees).map((deliveryFeeBreakdown,index) => ({ totalRevenue:[10000,5900][index],deliveryManualFees:inputs,deliveryFeeBreakdown }));
  assert.deepEqual(deliveryWonFeesForEdit(rows), restored, "whole-order charges are restored once");
  assert.equal(inputs.brokerage.unit,"percent","saved history is not mutated");
});

test("blank deductions save as zero alongside entered amounts", () => {
  const fees = emptyDeliveryManualFees();
  for (const key of Object.keys(fees)) fees[key].value = "";
  assert.equal(validDeliveryManualFees(fees, 20000), true);
  assert.equal(calculateDeliveryManualFees(20000, fees).total, 0);
  fees.delivery.value = 3400;
  assert.equal(validDeliveryManualFees(fees, 20000), true);
  assert.equal(calculateDeliveryManualFees(20000, fees).total, 3400);
});
test("multi-item orders appear once without merging unrelated orders or changing totals", () => {
  const rows = [
    {id:"a",date:"2026-09-21",deliveryBatchId:"one",totalRevenue:10000},
    {id:"b",date:"2026-09-21",deliveryBatchId:"one",totalRevenue:5000},
    {id:"c",date:"2026-09-21",deliveryBatchId:"two",totalRevenue:9000},
    {id:"d",date:"2026-09-20",totalRevenue:4000},
    {id:"e",date:"2026-09-20",totalRevenue:3000},
  ];
  const groups = groupDeliveryOrders(rows);
  assert.equal(groups.length, 4);
  assert.equal(groups[0].length, 2);
  assert.equal(groups[0].reduce((sum,row)=>sum+row.totalRevenue,0), 15000);
  assert.equal(groups.flat().reduce((sum,row)=>sum+row.totalRevenue,0), 31000);
  assert.equal(rows.length, 5);
});
