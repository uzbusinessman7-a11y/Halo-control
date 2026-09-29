import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySalesBonus,summarizeSalesChannels } from '../app/lib/sales-bonus.ts';
import { calculateDailyReport } from '../app/lib/daily-report.ts';
const date='2026-09-23';
const accounts=['cash','card','delivery','bank'].map(type=>({id:type,type}));
const sale=(accountId,totalRevenue,extra={})=>({date,accountId,totalRevenue,source:'manual',...extra});
const range={start:date,end:date};

test('cash POS delivery and bank form an exact partition regardless of tax mode',()=>{
  const state={accounts,sales:[sale('cash',300000),sale('card',400000),sale('delivery',200000),sale('bank',100000)]};
  const {totals}=summarizeSalesChannels(state,range);
  assert.deepEqual(totals,{cash:300000,pos:400000,delivery:200000,bank:100000,total:1000000,excess:200000,bonus:20000});
  assert.equal(totals.total,totals.cash+totals.pos+totals.delivery+totals.bank);
});
test('bonus is ten percent of only the amount above the daily 800000 threshold',()=>{
  for(const revenue of [0,782500,799999,800000])assert.equal(dailySalesBonus(revenue).bonus,0);
  assert.deepEqual(dailySalesBonus(900000),{excess:100000,bonus:10000});
  assert.equal(dailySalesBonus(800010).bonus,1);
});
test('date ranges add daily bonuses without applying the threshold only once',()=>{
  const state={accounts,sales:[sale('card',900000),sale('cash',700000,{date:'2026-09-24'})]};
  const {totals}=summarizeSalesChannels(state,{start:date,end:'2026-09-24'});
  assert.equal(totals.total,1600000);
  assert.equal(totals.bonus,10000);
});
test('cancelled sales, other dates and deposits are excluded',()=>{
  const state={accounts,sales:[sale('card',900000),sale('card',100000,{status:'cancelled'}),sale('cash',100000,{cancelledAt:'now'}),sale('cash',100000,{voided:true}),sale('cash',100000,{date:'2026-09-22'})],financialEntries:[{date,type:'income',amount:999999}]};
  assert.equal(summarizeSalesChannels(state,range).totals.total,900000);
});
test('delivery source and frozen payment type prevent reclassification or double counting',()=>{
  const state={accounts,sales:[sale('bank',200000,{source:'delivery',deliveryCommissionAmount:70000}),sale('bank',700000,{accountTypeAtSale:'card'})]};
  const {totals}=summarizeSalesChannels(state,range);
  assert.equal(totals.delivery,200000);
  assert.equal(totals.pos,700000);
  assert.equal(totals.bank,0);
  assert.equal(totals.total,900000);
  assert.equal(totals.bonus,10000,'bonus uses sales before platform deductions');
});
test('channel correction leaves tax and profit formulas intact and empty days remain zero',()=>{
  const state={accounts,sales:[sale('cash',100000)],costRules:{taxPct:10}};
  const report=calculateDailyReport(state,date);
  assert.equal(report.cashSales,100000);
  assert.equal(report.tax,10000);
  assert.equal(report.netProfit,90000);
  const empty=summarizeSalesChannels({accounts,sales:[]},range);
  assert.equal(empty.days.length,1);
  assert.equal(empty.totals.total,0);
  assert.equal(empty.totals.bonus,0);
});
