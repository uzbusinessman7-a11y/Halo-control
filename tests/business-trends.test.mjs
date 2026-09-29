import test from 'node:test';
import assert from 'node:assert/strict';
import { salesPeriodTotals, salesTrendReport, rollingComparisonBounds, percentChange, businessTrendMessage } from '../app/lib/business-trends.ts';

const accounts = ['cash','card','delivery','bank'].map(type => ({ id:type, type }));
const sale = (id,date,accountId,totalRevenue,extra={}) => ({ id,date,accountId,totalRevenue,quantity:1,...extra });

test('trend revenue partitions canonical saved sales without adding order headers, deposits or payments', () => {
  const state={accounts,sales:[sale('cash','2026-09-26','cash',300000),sale('pos','2026-09-26','card',400000),
    sale('delivery','2026-09-26','bank',200000,{source:'delivery',deliveryCommissionAmount:90000}),sale('bank','2026-09-26','bank',100000),
    sale('void','2026-09-26','card',999999,{voided:true}),sale('cancel','2026-09-26','cash',999999,{status:'cancelled'}),
    sale('linkedcancel','2026-09-26','cash',999999,{posOrderId:'cancelled-order'})],
    posOrders:[{id:'cancelled-order',status:'cancelled',totalRevenue:999999},{id:'live',totalRevenue:1000000}],financialEntries:[{type:'income',amount:1000000}]};
  const before=structuredClone(state);
  assert.deepEqual(salesPeriodTotals(state,'2026-09-26','2026-09-26'),{revenue:1000000,cash:300000,pos:400000,delivery:200000,bank:100000,itemCount:4});
  assert.deepEqual(state,before,'analysis never mutates sales or balances');
});

test('UTC instants are mapped to Seoul calendar dates and dated records retain their saved day', () => {
  const state={accounts,sales:[sale('before','2026-09-25T14:59:59Z','cash',100),sale('after','2026-09-25T15:00:00Z','cash',200),sale('saved','2026-09-25','cash',300)]};
  assert.equal(salesPeriodTotals(state,'2026-09-25','2026-09-25').revenue,400);
  assert.equal(salesPeriodTotals(state,'2026-09-26','2026-09-26').revenue,200);
});

test('rolling periods are consecutive equal lengths and never overlap', () => {
  for(const days of [3,7,15,30]) {
    const {current,previous}=rollingComparisonBounds('2026-09-26',days);
    assert.equal((Date.parse(current.end)-Date.parse(current.start))/86400000+1,days);
    assert.equal((Date.parse(previous.end)-Date.parse(previous.start))/86400000+1,days);
    assert.equal(Date.parse(current.start)-Date.parse(previous.end),86400000);
  }
});

test('completed calendar weeks begin Monday; month comparisons cross a year and leap day correctly', () => {
  let report=salesTrendReport({sales:[]},'2026-09-26');
  assert.deepEqual({start:report.periods[1].current.start,end:report.periods[1].current.end},{start:'2026-09-14',end:'2026-09-20'});
  report=salesTrendReport({sales:[]},'2026-12-31');
  assert.equal(report.periods[2].current.start,'2026-12-01');assert.equal(report.periods[2].current.end,'2026-12-31');
  assert.equal(report.periods[2].previous.start,'2026-11-01');
  report=salesTrendReport({sales:[]},'2024-02-29');
  assert.equal(report.periods[2].current.end,'2024-02-29');
});

test('vegetable spend is purchase-only, cancelled receipts excluded, zero denominators never become Infinity', () => {
  const state={accounts,vegetableExpenseStartedAt:'2026-08-01T00:00:00Z',sales:[sale('new','2026-09-26','cash',200000),sale('old','2026-09-20','cash',100000)],
    vegetablePurchases:[{inventoryId:'c',name:'KARAM',date:'2026-09-26',recordedAt:'now',quantity:3,unit:'dona',amount:15000},
      {inventoryId:'c',name:'KARAM',date:'2026-09-20',recordedAt:'then',quantity:2,unit:'dona',amount:5000},
      {inventoryId:'c',name:'KARAM',date:'2026-09-26',recordedAt:'now',quantity:3,unit:'dona',amount:999999,cancelledAt:'now'}],
    transactions:[{type:'purchase',amount:15000}],financialEntries:[{category:'Sabzavot va sous',amount:15000}]};
  const window=salesTrendReport(state,'2026-09-26').windows.find(w=>w.days===3);
  assert.equal(window.current.vegetableSpend,15000);assert.equal(window.current.vegetableShare,7.5);
  assert.equal(window.changePct,null);assert.equal(window.vegetableShareChangePoints,null);
  assert.equal(percentChange(110,100),10);assert.equal(percentChange(0,100),-100);assert.equal(percentChange(0,0),0);assert.equal(percentChange(1,0),null);
  assert.doesNotMatch(JSON.stringify(salesTrendReport({},'2026-09-26')),/Infinity|NaN/);
});

test('partial vegetable activation does not invent a prior-period increase', () => {
  const report=salesTrendReport({vegetableExpenseStartedAt:'2026-09-25T00:00:00Z'},'2026-09-26');
  assert.equal(report.windows[0].vegetableComparable,false);
  assert.equal(report.windows[0].vegetablePartial,true);
  assert.equal(report.windows[0].vegetableChangePct,null);
});

test('daily digest reports yesterday in Seoul and fits one Telegram message', () => {
  const state={accounts,sales:[sale('yesterday','2026-09-26','cash',300000),sale('today','2026-09-27','cash',999999)],vegetablePurchases:[]};
  const message=businessTrendMessage(state,new Date('2026-09-27T00:00:00Z'));
  assert.equal(message.id,'business-trend-day:2026-09-26');assert.equal(message.reportDate,'2026-09-26');
  assert.match(message.text,/300,000₩/);assert.doesNotMatch(message.text,/999,999/);assert.ok(message.text.length<4096);
});
