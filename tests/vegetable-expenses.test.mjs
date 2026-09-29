import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateVegetableExpenses, configureExpenseOnly, applyVegetablePurchaseAccounting, preserveVegetableFields, vegetableReport, vegetablePeriodTotals, weeklyVegetableMessage, periodBounds, expenseOnlyOnDate } from '../app/lib/vegetable-expenses.ts';
import { applyUnifiedIntake, cancelUnifiedIntake } from '../app/lib/unified-intake.ts';
import { applySaleInventoryAccounting } from '../app/lib/inventory-accounting.ts';
import { isExpenseOnlyInventory } from '../app/lib/vegetable-expenses.ts';
import { calculateDailyReport } from '../app/lib/daily-report.ts';
import { calculateRecipeCost } from '../app/lib/recipe-costing.ts';
import { prepareBatchSales } from '../app/lib/batch-sales.ts';
import { applyPosOrder, deletePosRecord } from '../app/lib/pos-terminal.ts';
import { buildGoogleSheetsExport } from '../app/lib/google-sheets-export.ts';

const when = '2026-09-25T09:53:00.000Z';
const item = (id, name, stock, unitCost, unit='g') => ({ id, name, stock, unitCost, unit, minStock:0, packageName:'quti',unitsPerPackage:1,packageCost:unitCost,categoryId:'inventory-other' });
const original = () => ({ inventory:[item('c','KARAM',-500,2), item('m',"QO'Y GO'SHT",1000,20), item('b','NON',10,500,'dona')],
  recipes:[{id:'r',name:'Taom',salePrice:10000,ingredients:[{inventoryId:'c',quantity:100,unit:'g'},{inventoryId:'m',quantity:50,unit:'g'},{inventoryId:'b',quantity:1,unit:'dona'}]}],
  suppliers:[{id:'nodir',name:'Nodir aka',openingBalance:948000,balance:948000}], transactions:[],sales:[],stockMovements:[],financialEntries:[],deletedItems:[],posOrders:[],
  accounts:[{id:'cash',type:'cash',name:'Naqd'},{id:'card',type:'card',name:'Karta'}],costRules:{taxPct:0,cardCommissionPct:0},staff:[],monthlyCloses:[],inventoryAccountingVersion:1 });
const fresh = () => migrateVegetableExpenses(original(),when);
const body = (overrides={}) => ({ operationId:'aaaaaaaa-bbbb-cccc-dddd-000000000001',supplierName:'Nodir aka',date:'2026-09-25',paidAmount:0,accountId:'cash',vegetableOnly:true,lines:[{name:'KARAM',quantity:2,unit:'kg',amount:6000}],...overrides });
const purchase = (state, input=body()) => applyVegetablePurchaseAccounting(state,applyUnifiedIntake(state,input).state,'Rahbar',when);

test('additive migration preserves every historical record, balances and cost; matches only the 13 requested names',()=>{
  const before=original();before.inventory.push(item('flour','UN',77,5),item('napkin','SALFETKA',900,1));before.sales=[{id:'historic',totalCost:100}];before.stockMovements=[{id:'historic-m',type:'sale',quantity:-100}];before.customData={preserve:true};
  const snapshot=structuredClone(before), next=migrateVegetableExpenses(before,when);
  assert.deepEqual(before,snapshot);
  for(const key of ['sales','stockMovements','transactions','suppliers','financialEntries','recipes','customData']) assert.deepEqual(next[key],before[key]);
  for(const previous of before.inventory) { const nextItem=next.inventory.find(i=>i.id===previous.id);for(const key of Object.keys(previous)) assert.deepEqual(nextItem[key],previous[key]); }
  assert.equal(next.inventory.find(i=>i.id==='c').expenseOnly,true);assert.equal(next.inventory.find(i=>i.id==='flour').expenseOnly,undefined);assert.equal(next.inventory.find(i=>i.id==='napkin').expenseOnly,undefined);
  assert.equal(next.inventory.filter(i=>i.name==='상추').length,1);assert.equal(next.inventory.find(i=>i.name==='상추').packageName,'quti');assert.equal(migrateVegetableExpenses(next,when),next);
});
test('one cabbage purchase: stock frozen, full expense once, latest gram cost and exact supplier debt',()=>{
  const start=fresh(), next=purchase(start);
  assert.equal(next.inventory.find(i=>i.id==='c').stock,-500);assert.equal(next.inventory.find(i=>i.id==='c').unitCost,3);
  assert.equal(next.vegetablePurchases.length,1);assert.equal(next.vegetablePurchases[0].quantity,2);assert.equal(next.vegetablePurchases[0].unit,'kg');assert.equal(next.vegetablePurchases[0].recordedBy,'Rahbar');
  const expense=next.financialEntries.filter(e=>e.category==='Sabzavot va sous');assert.equal(expense.length,1);assert.equal(expense[0].amount,6000);assert.equal(expense[0].nonCash,true);
  assert.equal(next.suppliers[0].balance,954000);assert.equal(next.transactions.filter(t=>t.type==='purchase').length,1);
  assert.equal(next.stockMovements[0].quantity,0);assert.equal(next.stockMovements[0].purchaseAmount,6000);
  const retry=purchase(next);assert.deepEqual(retry,next);assert.deepEqual(applyVegetablePurchaseAccounting(next,next,'Rahbar',when),next);
});
test('one mixed sale: cabbage is not deducted or shortage flagged; meat/bread and full recipe margin remain correct',()=>{
  const start=purchase(fresh());
  const recipeCost=calculateRecipeCost(start.recipes[0].ingredients,start.inventory);assert.equal(recipeCost,1800);
  const batch=prepareBatchSales({recipes:start.recipes,inventory:start.inventory,quantities:{r:1}});assert.equal(batch.ok,true);assert.equal(batch.shortageCount,0);
  const sold=applyPosOrder(start,{operationId:'veg-test-sale-1',paymentType:'cash',items:[{recipeId:'r',quantity:1}]},{id:'pos-terminal',name:'Rahbar'},when).state;
  assert.equal(sold.inventory.find(i=>i.id==='c').stock,-500);assert.equal(sold.inventory.find(i=>i.id==='m').stock,950);assert.equal(sold.inventory.find(i=>i.id==='b').stock,9);
  assert.equal(sold.sales[0].totalCost,1800);assert.equal(sold.sales[0].expenseOnlyCost,300);assert.equal(sold.sales[0].stockUsage.find(u=>u.inventoryId==='c').deductedQuantity,0);
  const daily=calculateDailyReport(sold,'2026-09-25');assert.equal(daily.revenue,10000);assert.equal(daily.cost,1500);assert.equal(daily.manualExpenses,6000);assert.equal(daily.netProfit,2500,'300 recipe estimate is not expensed for a second time');
  const report=vegetableReport(sold,'day','2026-09-25');assert.equal(report.expense,6000);assert.equal(report.revenue,10000);assert.equal(report.ratio,60);assert.equal(report.products[0].share,100);
});
test('paid and partly paid purchases change debt only by remaining amount; cash payment is not another profit expense',()=>{
  for(const paidAmount of [6000,2000]){const next=purchase(fresh(),body({paidAmount}));assert.equal(next.suppliers[0].balance,948000+6000-paidAmount);assert.equal(calculateDailyReport(next,'2026-09-25').manualExpenses,6000);assert.equal(next.financialEntries.filter(e=>e.affectsProfit===false)[0].amount,paidAmount);}
});
test('unweighed purchase in heads/boxes is accepted without guessing grams or erasing recipe price',()=>{
  const start=fresh(), next=purchase(start,body({lines:[{name:'KARAM',quantity:3,unit:'kalla',amount:9000}]}));
  assert.equal(next.inventory[0].stock,-500);assert.equal(next.inventory[0].unitCost,2);assert.equal(next.vegetablePurchases[0].quantity,3);assert.equal(next.vegetablePurchases[0].unit,'kalla');assert.equal(next.financialEntries[0].amount,9000);
});
test('rule starts on activation date, never backfills legacy receipts or changes them when toggled',()=>{
  const start=fresh();start.stockMovements=[{id:'old',inventoryId:'c',type:'receipt',quantity:1000,unitCost:2,date:'2026-09-24',supplierId:'nodir'}];
  const unchanged=applyVegetablePurchaseAccounting(start,start,'Rahbar',when);assert.deepEqual(unchanged.stockMovements,start.stockMovements);assert.equal(unchanged.vegetablePurchases.length,0);
  assert.equal(expenseOnlyOnDate(start.inventory[0],'2026-09-24',when),false);
  assert.throws(()=>purchase(start,body({date:'2026-09-24'})),/belgilanmagan/);
  const bought=purchase(start), disabled=configureExpenseOnly(bought,'c',false,'2026-09-26T01:00:00Z');assert.equal(isExpenseOnlyInventory(disabled.inventory[0]),false);
  assert.equal(vegetableReport(disabled,'day','2026-09-25').expense,6000);assert.deepEqual(disabled.stockMovements,bought.stockMovements);assert.deepEqual(disabled.vegetablePurchases,bought.vegetablePurchases);
  assert.equal(expenseOnlyOnDate(disabled.inventory[0],'2026-09-25','2026-09-26T02:00:00Z'),true);assert.equal(expenseOnlyOnDate(disabled.inventory[0],'2026-09-26','2026-09-26T02:00:00Z'),false);
  const stale=preserveVegetableFields(disabled,{...disabled,vegetablePurchases:[],inventory:disabled.inventory.map(({expenseOnly,expenseOnlyHistory,...i})=>i)});assert.deepEqual(stale.vegetablePurchases,bought.vegetablePurchases);assert.equal(stale.inventory[0].expenseOnly,false);
});
test('mixed invoice expenses only cabbage, preserves meat inventory and keeps a single supplier invoice',()=>{
 const start=fresh(), next=purchase(start,body({vegetableOnly:false,lines:[{name:'KARAM',quantity:2,unit:'kg',amount:6000},{name:"QO'Y GO'SHT",quantity:1,unit:'kg',amount:20000}]}));
 assert.equal(next.suppliers[0].balance,974000);assert.equal(next.vegetablePurchases.length,1);assert.equal(next.inventory.find(i=>i.id==='m').stock,2000);assert.equal(next.transactions.length,1);assert.equal(calculateDailyReport(next,'2026-09-25').manualExpenses,6000);
});
test('cancel purchase preserves audit and removes active expense without creating stock; restore is idempotent',()=>{
 const start=purchase(fresh());const raw=cancelUnifiedIntake(start,{id:start.transactions[0].id,reason:'Sinov xaridi bekor qilindi'}).state;
 const cancelled=applyVegetablePurchaseAccounting(start,raw,'Rahbar',when);
 assert.equal(cancelled.inventory[0].stock,-500);assert.equal(cancelled.suppliers[0].balance,948000);assert.equal(vegetableReport(cancelled,'day','2026-09-25').expense,0);assert.ok(cancelled.vegetablePurchases[0].cancelledAt);assert.equal(calculateDailyReport(cancelled,'2026-09-25').manualExpenses,0);
});
test('sale cancellation does not restore undeducted cabbage after its flag changes',()=>{
 const start=fresh();const result=applyPosOrder(start,{operationId:'veg-cancel-sale',paymentType:'cash',items:[{recipeId:'r',quantity:1}]},{id:'pos-terminal',name:'Rahbar'},when);
 const changed=configureExpenseOnly(result.state,'c',false,'2026-09-26T01:00:00Z');const cancelled=deletePosRecord(changed,'sale',result.result.order.id).state;
 assert.equal(cancelled.inventory[0].stock,-500);assert.equal(cancelled.inventory[1].stock,1000);assert.equal(cancelled.inventory[2].stock,10);
});
test('Seoul, Monday weeks, month/year boundary, null ratio, strict 2-point alert and comparable history',()=>{
 assert.deepEqual(periodBounds('2026-09-27','week'),{start:'2026-09-21',end:'2026-09-27'});assert.deepEqual(periodBounds('2026-09-28','week'),{start:'2026-09-28',end:'2026-10-04'});assert.deepEqual(periodBounds('2027-01-12','month',-1),{start:'2026-12-01',end:'2026-12-31'});
 const state=fresh();state.vegetableExpenseStartedAt='2026-09-01T00:00:00Z';state.sales=[{date:'2026-09-25',totalRevenue:100000},{date:'2026-09-18',totalRevenue:100000},{date:'2026-09-25',totalRevenue:900000,status:'cancelled'}];state.vegetablePurchases=[{id:'p',inventoryId:'c',name:'KARAM',amount:8000,quantity:2,unit:'kg',date:'2026-09-25',recordedAt:when},{id:'oldp',inventoryId:'c',name:'KARAM',amount:6800,quantity:2,unit:'kg',date:'2026-09-18',recordedAt:when}];
 let r=vegetableReport(state,'week','2026-09-25');assert.equal(r.alert,false);assert.ok(Math.abs(r.differencePoints-1.2)<.000001);assert.equal(r.history.length,12);
 state.vegetablePurchases[0].amount=8001;r=vegetableReport(state,'day','2026-09-25');assert.equal(r.alert,true);assert.equal(r.history.length,30);assert.equal(vegetableReport(state,'month','2026-09-25').history.length,12);
 assert.equal(vegetablePeriodTotals(state,'2026-09-24','2026-09-24').ratio,null);
 state.sales.push({date:'2026-09-27T15:00:00Z',totalRevenue:4000});assert.equal(vegetableReport(state,'day','2026-09-28').revenue,4000);
 const msg=weeklyVegetableMessage(state,new Date('2026-09-28T00:00:00Z'));assert.match(msg.text,/2026-09-21 — 2026-09-27/);assert.match(msg.text,/KARAM/);assert.match(msg.text,/foiz punkt/);
});
test('Google Sheets adds one safe new table and keeps all existing sheet headers',()=>{
 const start=fresh(), next=purchase(start);
 const before=buildGoogleSheetsExport(start,'2026-09-01','2026-09-30'), after=buildGoogleSheetsExport(next,'2026-09-01','2026-09-30');
 assert.equal(after.exportVersion,before.exportVersion);assert.equal(after.exportVersion,'3.1');
 for(const old of before.sheets) assert.deepEqual(after.sheets.find(s=>s.name===old.name).headers,old.headers);
 const sheet=after.sheets.find(s=>s.name==='HALO SABZAVOT SARFI');assert.deepEqual(sheet.headers,['Sana','Mahsulot','Miqdor','Summa (₩)','Yetkazib beruvchi']);assert.deepEqual(sheet.rows,[['2026-09-25','KARAM','2 kg',6000,'Nodir aka']]);
});
