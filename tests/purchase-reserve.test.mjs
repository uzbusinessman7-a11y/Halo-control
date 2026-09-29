import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseReserveReport,reserveUnit,reservePurchaseMetadata,saveReserveCount,saveReserveRecipes} from '../app/lib/purchase-reserve.ts';
import {preserveVegetableFields} from '../app/lib/vegetable-expenses.ts';
import {reserveDemand} from '../app/lib/reserve-demand.ts';
const at=d=>`2026-09-${String(d).padStart(2,'0')}T00:00:00+09:00`;
const purchase=(id,d,quantity,amount,rest,unit='dona')=>({id,inventoryId:'c',date:at(d).slice(0,10),purchasedAt:at(d),quantity,amount,unit,...(rest===undefined?{}:{remainingBeforePurchase:rest})});
const state=(purchases=[],extra={})=>({inventory:[{id:'c',name:'KARAM',expenseOnly:true,stock:999,unit:'g'}],vegetablePurchases:purchases,sales:[],...extra});
const product=(s,d)=>purchaseReserveReport(s,new Date(at(d))).products[0];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('4 cabbages/4 days then 3: cadence forecast, cost and price separate, source immutable',()=>{
 const s=state([purchase('a',1,4,15000),purchase('b',5,3,13000)]), before=structuredClone(s), p=product(s,5);
 close(p.rate,1);close(p.daysLeft,3);close(p.lastCycle.dailyAmount,3750);close(p.priceChangePct,15.55555555555555);close(p.estimatedDailyCost,13000/3);
 close(product(s,6).daysLeft,2);assert.equal(p.balanceBasis,'last_purchase');assert.equal(p.salesAdjusted,false);assert.deepEqual(s,before);
});
test('carryover is not silently discarded; confirmed intervals beat purchase cadence',()=>{
 const s=state([purchase('a',1,4,15000,0),purchase('b',5,3,13000,2)]),p=product(s,5);
 close(p.rate,.5);close(p.estimatedRemaining,5);close(p.daysLeft,10);assert.equal(p.basis,'measured');
 const unknown=state([purchase('a',1,4,15000),purchase('b',5,3,13000,2)]);close(product(unknown,5).estimatedRemaining,5);
});
test('count anchors, intervening receipts, zero use, impossible negative use and sparse history',()=>{
 const s=state([purchase('a',1,4,15000,0),purchase('b',3,2,9000)],{purchaseReserveCounts:[{inventoryId:'c',unit:'dona',quantity:1,countedAt:at(5),id:'n'}]});
 close(product(s,5).rate,1.25);close(product(s,5).estimatedRemaining,1);
 assert.equal(product(state([purchase('a',1,4,15000)]),5).daysLeft,null);
 const zero=state([purchase('a',1,4,15000,0)],{purchaseReserveCounts:[{inventoryId:'c',unit:'dona',quantity:4,countedAt:at(5),id:'n'}]});
 assert.equal(product(zero,5).rate,0);assert.equal(product(zero,5).daysLeft,null);
 zero.purchaseReserveCounts[0].quantity=9;assert.equal(product(zero,5).inconsistent,true);
});
test('grams and liters normalized, dimensions separated, simultaneous receipts aggregated',()=>{
 const s=state([purchase('a',1,1,10000,undefined,'kg'),purchase('a2',1,500,5000,undefined,'g'),purchase('b',4,500,7000,undefined,'g'),purchase('c',1,1,2000,undefined,'litr'),purchase('d',4,500,2000,undefined,'ml'),purchase('e',4,2,5000)]);
 const r=purchaseReserveReport(s,new Date(at(4)));assert.equal(r.products.length,3);
 close(r.products.find(p=>p.unit==='g').rate,500);close(r.products.find(p=>p.unit==='litr').rate,1/3);assert.ok(r.products.every(p=>p.mixedUnits));
 assert.deepEqual(reserveUnit('kalla'),{unit:'dona',factor:1});assert.deepEqual(reserveUnit('quti'),{unit:'quti',factor:1});
});
test('cancelled receipts excluded, Seoul windows, disabled warnings and old payload fields protected',()=>{
 const s=state([purchase('a',1,4,15000),{...purchase('b',5,3,13000),cancelledAt:at(5)}]);assert.equal(product(s,5).samples,0);
 const r=purchaseReserveReport(state([purchase('a',1,4,15000),purchase('b',5,3,13000)]),new Date('2026-09-04T15:00:00Z'));
 assert.equal(r.windows[0].amount,13000);assert.equal(r.products[0].windows[1].quantity,3);
 const current={...s,vegetableExpenseVersion:1,purchaseReserveCounts:[{id:'keep'}],purchaseReserveSettings:{leadDays:2},purchaseReserveNotifications:[{id:'sent'}]};
 const next=preserveVegetableFields(current,{inventory:current.inventory});for(const k of ['purchaseReserveCounts','purchaseReserveSettings','purchaseReserveNotifications'])assert.deepEqual(next[k],current[k]);
 assert.equal(product(state([purchase('a',1,4,15000),purchase('b',5,3,13000)],{purchaseReserveSettings:{enabled:false}}),9).reminder,false);
});
test('validated metadata and count idempotency do not mutate stock, finance or history',()=>{
 const now=at(25),s=state(), input={inventoryId:'c',operationId:'aaaaaaaa-bbbb-cccc-dddd-000000000001',unit:'kg',quantity:2,countedAt:at(24)};
 const saved=saveReserveCount(s,input,'Rahbar',now);assert.equal(saved.state.purchaseReserveCounts[0].quantity,2000);assert.equal(saved.state.inventory[0].stock,999);assert.equal(s.purchaseReserveCounts,undefined);
 assert.equal(saveReserveCount(saved.state,input,'Rahbar',now).result.alreadySaved,true);
 assert.throws(()=>saveReserveCount(saved.state,{...input,quantity:3},'Rahbar',now));
 for(const quantity of ['',null,true,-1,'oops'])assert.throws(()=>saveReserveCount(s,{...input,quantity},'Rahbar',now));
 assert.throws(()=>reservePurchaseMetadata({purchasedAt:at(26)},'2026-09-26',now));
 assert.throws(()=>reservePurchaseMetadata({purchasedAt:at(24)},'2026-09-23',now));
 assert.equal(reservePurchaseMetadata({remainingBeforePurchase:0},'2026-09-25',now).remainingBeforePurchase,0);
});
test('selected menu portions calibrate use; busy and quiet days change runout without stock writes',()=>{
 const sales=Array.from({length:9},(_,i)=>({id:`s${i}`,recipeId:'lavash',quantity:30,date:`2026-09-${String(i+1).padStart(2,'0')}`,totalRevenue:300000}));
 const s=state([purchase('a',1,4,15000,0),purchase('b',6,4,15000,0)],{sales,purchaseReserveSettings:{recipeIdsByInventory:{c:['lavash']}}});
 const base=product(s,10);assert.equal(base.salesAdjusted,true);close(base.baseRate,.8);close(base.rate,.8);close(base.daysLeft,1);
 const busy=structuredClone(s);busy.sales[8].quantity=200;const high=product(busy,10);assert.ok(high.rate>base.rate);assert.ok(high.estimatedRemaining<base.estimatedRemaining);assert.ok(high.daysLeft<base.daysLeft);
 const calm=structuredClone(s);calm.sales[8].quantity=1;const low=product(calm,10);assert.ok(low.rate<base.rate);assert.ok(low.daysLeft>base.daysLeft);
 assert.equal(s.inventory[0].stock,999);assert.equal(busy.inventory[0].stock,999);
 const noCounts=state(s.vegetablePurchases.map(({remainingBeforePurchase,...p})=>p),{sales:busy.sales,purchaseReserveSettings:s.purchaseReserveSettings});assert.equal(product(noCounts,10).salesAdjusted,false);
 const drinks=structuredClone(s);drinks.sales.push({recipeId:'cola',date:'2026-09-09',quantity:100000,totalRevenue:99999999});drinks.sales[0].totalRevenue=99999999;assert.deepEqual(product(drinks,10),base);
 const none=structuredClone(s);none.purchaseReserveSettings.recipeIdsByInventory.c=[];assert.equal(product(none,10).salesAdjusted,false);
});
test('portion windows exclude today for forecast and exclude cancelled, unrelated and future sales',()=>{
 const s={sales:[{recipeId:'lavash',quantity:10,date:'2026-09-06'},{recipeId:'lavash',quantity:50,date:'2026-09-07'},{recipeId:'lavash',quantity:30,date:'2026-09-08'},{recipeId:'lavash',quantity:200,date:'2026-09-09'},{recipeId:'lavash',quantity:1,date:'2026-09-10'},{recipeId:'lavash',quantity:999,date:'2026-09-11'},{recipeId:'lavash',quantity:999,date:'2026-09-09',voided:true},{recipeId:'lavash',quantity:999,date:'2026-09-09',posOrderId:'cancel'},{recipeId:'cola',quantity:999,date:'2026-09-09'}],posOrders:[{id:'cancel',status:'cancelled'}]};
 const d=reserveDemand(s,new Date('2026-09-10T12:00:00+09:00'),['lavash']);
 assert.equal(d.windows[0].amount,200);assert.equal(d.todayPortions,1);assert.ok(d.expectedDaily<200);assert.ok(d.expectedDaily>30);assert.equal(d.windows[2].recordedDays,4);
 assert.equal(reserveDemand(s,new Date(at(10)),[]).expectedDaily,null);
});
test('recipe mappings saved per ingredient, duplicate IDs normalize, invalid products fail, recipes unchanged',()=>{
 const s=state([],{recipes:[{id:'lavash',name:'Lavash',ingredients:[{inventoryId:'c',quantity:30}]},{id:'burger',name:'Burger'}]});
 const result=saveReserveRecipes(s,{inventoryId:'c',recipeIds:['lavash','lavash','burger']}).state;
 assert.deepEqual(result.purchaseReserveSettings.recipeIdsByInventory.c,['lavash','burger']);assert.deepEqual(result.recipes,s.recipes);assert.deepEqual(result.inventory,s.inventory);
 assert.throws(()=>saveReserveRecipes(s,{inventoryId:'c',recipeIds:['invalid']}));assert.throws(()=>saveReserveRecipes(s,{inventoryId:'invalid',recipeIds:[]}));
 assert.deepEqual(saveReserveRecipes(result,{inventoryId:'c',recipeIds:[]}).state.purchaseReserveSettings.recipeIdsByInventory.c,[]);
});
