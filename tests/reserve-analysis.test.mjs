import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseReserveReport, RESERVE_WINDOWS } from '../app/lib/purchase-reserve.ts';
import { reserveDemand } from '../app/lib/reserve-demand.ts';
const now=new Date('2026-09-27T12:00:00+09:00');
const buy=(id,date,quantity,amount,extra={})=>({id,inventoryId:'s',date,unit:'kg',quantity,amount,...extra});
const seed=(purchases=[],extra={})=>({inventory:[{id:'s',name:'SOUS',expenseOnly:true,stock:123,unit:'g'}],vegetablePurchases:purchases,sales:[],...extra});

test('3/7/15/30 analysis compares equal complete periods and keeps today separate',()=>{
 const state=seed([buy('previous','2026-09-23',2,10000),buy('current','2026-09-26',4,40000),buy('today','2026-09-27',9,900000)]);
 const original=structuredClone(state),report=purchaseReserveReport(state,now),product=report.products[0];
 assert.deepEqual(RESERVE_WINDOWS,[1,3,7,15,30]);
 const w=product.windows.find(w=>w.days===3),p=w.closedPeriod;
 assert.equal(p.start,'2026-09-24');assert.equal(p.end,'2026-09-26');
 assert.equal(p.quantity,4000);assert.equal(p.amount,40000);assert.equal(p.previousQuantity,2000);assert.equal(p.previousAmount,10000);
 assert.equal(p.quantityChangePct,100);assert.equal(p.amountChangePct,300);
 assert.equal(w.amount,940000);assert.ok(product.demand.windows.some(w=>w.days===15));
 assert.deepEqual(state,original);
});

test('zero baseline and recently started records never invent an infinite comparison percentage',()=>{
 const purchases=[buy('current','2026-09-26',4,40000)];
 let p=purchaseReserveReport(seed(purchases),now).products[0].windows.find(w=>w.days===3).closedPeriod;
 assert.equal(p.previousAmount,0);assert.equal(p.amountChangePct,null);assert.equal(p.quantityChangePct,null);
 p=purchaseReserveReport(seed(purchases,{vegetableExpenseStartedAt:'2026-09-24T00:00:00+09:00'}),now).products[0].windows.find(w=>w.days===3).closedPeriod;
 assert.equal(p.comparable,false);assert.equal(p.amountChangePct,null);
});

test('archiving or switching a product mode does not erase its historical spending totals',()=>{
 const state=seed([buy('old','2026-09-26',4,40000)],{inventory:[{id:'s',name:'SOUS',expenseOnly:true,catalogArchived:true}]});
 let report=purchaseReserveReport(state,now);
 assert.equal(report.products.length,0);assert.equal(report.windows.find(w=>w.days===3).amount,40000);
 state.inventory[0]={id:'s',name:'SOUS',expenseOnly:false};report=purchaseReserveReport(state,now);
 assert.equal(report.products.length,0);assert.equal(report.windows.find(w=>w.days===3).amount,40000);
});

test('existing recipe links work automatically, explicit empty selection stays empty, repeated sale IDs count once',()=>{
 const state=seed([],{recipes:[{id:'lavash',name:'Lavash',ingredients:[{inventoryId:'s',quantity:10}]},{id:'cola',name:'Cola',ingredients:[]}],sales:[{id:'a',recipeId:'lavash',quantity:2,date:'2026-09-26'},{id:'a',recipeId:'lavash',quantity:2,date:'2026-09-26'},{id:'b',recipeId:'lavash',quantity:2,date:'2026-09-26'},{id:'drink',recipeId:'cola',quantity:2000,date:'2026-09-26'}]});
 const report=purchaseReserveReport(state,now);assert.deepEqual(report.products[0].recipeIds,['lavash']);
 assert.equal(reserveDemand(state,now,['lavash']).windows[0].amount,4);
 state.purchaseReserveSettings={recipeIdsByInventory:{s:[]}};
 assert.deepEqual(purchaseReserveReport(state,now).products[0].recipeIds,[]);
});

test('30-day confirmed history remains the fallback after adding a 15-day window',()=>{
 const state=seed([buy('a','2026-09-01',4,40000,{remainingBeforePurchase:0}),buy('b','2026-09-05',4,40000,{remainingBeforePurchase:0})]);
 const p=purchaseReserveReport(state,now).products[0];
 assert.equal(p.modelDays,30);assert.equal(p.baseRate,1000);assert.equal(p.estimateMode,'measured_time');assert.equal(p.confirmedIntervals,1);
 assert.equal(p.estimatedRemaining,0);assert.equal(state.inventory[0].stock,123);
});
