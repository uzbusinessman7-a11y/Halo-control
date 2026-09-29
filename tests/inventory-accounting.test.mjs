import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { applySaleInventoryAccounting, inventoryActivityTotals, inventoryCountVariance, inventoryVarianceReports, inventoryCountView } from '../app/lib/inventory-accounting.ts';
import { configureInventoryAccounting, saveAccountingCount, InventoryCountingError } from '../app/lib/inventory-counting.ts';
import { inventoryNotificationJobs } from '../app/lib/inventory-notification-jobs.ts';
import { calculateRecipeCost } from '../app/lib/recipe-costing.ts';
import { prepareBatchSales } from '../app/lib/batch-sales.ts';
import { applyPosOrder, deletePosRecord } from '../app/lib/pos-terminal.ts';
import { closeBusinessMonth } from '../app/lib/month-end.ts';
const when='2026-09-25T02:00:00.000Z', later='2026-09-26T02:00:00.000Z';
const retired={hisobGuruhi:'C',hisobUsuli:'davriy',countEveryDays:3,varianceLimitPct:10,purchaseConversionRequired:true};
const actor={id:'worker-1',name:'Ali'};
const item=(id,stock=1000,expenseOnly=false)=>({id,name:id,unit:id==='bread'?'dona':'g',stock,minStock:0,unitCost:2,unitsPerPackage:1000,packageName:'quti',packageCost:2000,...retired,...(expenseOnly?{expenseOnly:true}:{})});
const base=()=>({inventory:[item('KARAM',1000,true),item('UN'),item('bread',10)],sales:[],stockMovements:[],inventoryCounts:[],monthlyCloses:[],accounts:[{id:'cash',type:'cash'},{id:'card',type:'card'}],recipes:[],posOrders:[]});
const count=(state,id,counts,now=when)=>saveAccountingCount(state,{operationId:id,counts},actor,now).state;
const sale=(state,id='sale-001',quantities={KARAM:100,UN:50,bread:1})=>({...state,inventory:state.inventory.map(i=>({...i,stock:i.stock-(quantities[i.id]||0)})),sales:[{id,date:'2026-09-25',quantity:1,totalRevenue:10000,totalCost:999,stockUsage:Object.entries(quantities).map(([inventoryId,quantity])=>({inventoryId,quantity,unitCostAtSale:2,totalCostAtSale:2*quantity}))},...state.sales],stockMovements:[...Object.entries(quantities).map(([inventoryId,quantity])=>({id:`${id}-${inventoryId}`,referenceId:id,inventoryId,type:'sale',quantity:-quantity,date:'2026-09-25'})),...state.stockMovements]});

test('retired fields have no executable consumers or UI references',()=>{
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):/\.tsx?$/.test(e.name)?[`${dir}/${e.name}`]:[]);
 for(const file of walk('app')) assert.doesNotMatch(readFileSync(file,'utf8'),/hisobGuruhi|hisobUsuli|countEveryDays|varianceLimitPct|purchaseConversionRequired/,file);
});
test('only expenseOnly skips deduction; all former A/B/C values are inert and retained',()=>{
 for(const group of ['A','B','C']){
  const start=base();start.inventory[0].stock=0;start.inventory[1].hisobGuruhi=group;const before=structuredClone(start);
  const out=applySaleInventoryAccounting(start,sale(start),when);
  assert.deepEqual(start,before);assert.deepEqual(out.inventory.map(i=>i.stock),[0,950,9]);
  for(const key of Object.keys(retired))assert.equal(out.inventory[1][key],start.inventory[1][key]);
  assert.equal(out.stockMovements[0].quantity,0);assert.equal(out.stockMovements[0].theoreticalQuantity,100);
  assert.equal(out.sales[0].stockUsage[0].totalCostAtSale,200);assert.equal(out.sales[0].stockUsage[0].deductedQuantity,0);
  assert.equal(out.sales[0].stockUsage[1].deductedQuantity,50);
  assert.deepEqual(applySaleInventoryAccounting(start,out,when),out);
  assert.deepEqual(applySaleInventoryAccounting(out,out,later),out);
 }
});
test('omitted old metadata survives a client edit without writing defaults to new products',()=>{
 const start=base(), next={...start,inventory:start.inventory.map(({hisobGuruhi,hisobUsuli,countEveryDays,varianceLimitPct,purchaseConversionRequired,...i})=>i)};
 const out=applySaleInventoryAccounting(start,next,when);assert.deepEqual(out.inventory,start.inventory);
 const fresh=applySaleInventoryAccounting({inventory:[]},{inventory:[{id:'new',stock:3}]},when);assert.deepEqual(fresh.inventory,[{id:'new',stock:3}]);
});
test('cancelling sales uses saved physical movement, regardless of a later mode change',()=>{
 const start=base(),sold=applySaleInventoryAccounting(start,sale(start),when);
 const changed={...sold,inventory:sold.inventory.map(i=>({...i,expenseOnly:!i.expenseOnly}))};
 const out=applySaleInventoryAccounting(changed,{...changed,inventory:changed.inventory.map(i=>({...i,stock:9999})),sales:[],stockMovements:[]},later);
 assert.deepEqual(out.inventory.map(i=>i.stock),[1000,1000,10]);assert.equal(inventoryActivityTotals(out,'KARAM').theoreticalTotal,0);
});
test('unrelated writes preserve historical sales, zero movements and count metadata exactly',()=>{
 const start={...base(),stockMovements:[{id:'old',inventoryId:'UN',type:'sale',quantity:0,theoreticalQuantity:100,hisobUsuliAtMovement:'davriy'}],sales:[{id:'legacy',stockUsage:[{inventoryId:'UN',quantity:100,hisobUsuliAtSale:'davriy'}]}],inventoryCounts:[{id:'old-count',group:'C',varianceLimitPct:10}]};
 const out=applySaleInventoryAccounting(start,{...start,note:'unrelated'},later);
 assert.deepEqual(out.stockMovements,start.stockMovements);assert.deepEqual(out.sales,start.sales);assert.deepEqual(out.inventoryCounts,start.inventoryCounts);assert.deepEqual(out.inventory,start.inventory);
});
test('restoring old deducted and nondeducted sales uses historical quantities, not legacy flags',()=>{
 for(const quantity of [-75,0]){
  const start=base(), movement={id:'old-m',inventoryId:'UN',type:'sale',referenceId:'restored',quantity,theoreticalQuantity:75,hisobUsuliAtMovement:quantity?'davriy':'aniq'};
  start.deletedItems=[{related:{movements:[movement]}}];
  const out=applySaleInventoryAccounting(start,{...start,sales:[{id:'restored',stockUsage:[{inventoryId:'UN',quantity:75,unitCostAtSale:2}]}],stockMovements:[movement]},later);
  assert.equal(out.inventory[1].stock,1000+quantity);assert.equal(out.stockMovements[0].quantity,quantity);assert.equal(out.sales[0].stockUsage[0].deductedQuantity,-quantity||0);
 }
});
test('editing quantity keeps the saved physical policy even when the mode changes',()=>{
 const start=base(),sold=applySaleInventoryAccounting(start,sale(start,'old',{UN:100}),when);
 const changed={...sold,inventory:sold.inventory.map(i=>({...i,expenseOnly:true}))};
 const out=applySaleInventoryAccounting(changed,{...changed,sales:changed.sales.map(s=>({...s,stockUsage:s.stockUsage.map(u=>({...u,quantity:200}))})),stockMovements:changed.stockMovements.map(m=>({...m,quantity:0,theoreticalQuantity:200}))},later);
 assert.equal(out.inventory[1].stock,800);assert.equal(out.stockMovements[0].quantity,-200);assert.equal(out.sales[0].stockUsage[0].deductedQuantity,200);
});
test('recipe cost and batch shortages use only expenseOnly, not former C group',()=>{
 const inventory=base().inventory;
 const ingredients=[{inventoryId:'KARAM',quantity:100,lineCost:9999},{inventoryId:'UN',quantity:50,lineCost:150}];
 assert.equal(calculateRecipeCost(ingredients,inventory),350);inventory[0].unitCost=3;assert.equal(calculateRecipeCost(ingredients,inventory),450);
 inventory.forEach(i=>i.stock=0);
 const r={id:'r',name:'Taom',salePrice:10000,ingredients:[ingredients[0]]};
 assert.equal(prepareBatchSales({recipes:[r],inventory,quantities:{r:5}}).shortageCount,0);
 assert.equal(prepareBatchSales({recipes:[{...r,ingredients}],inventory,quantities:{r:5}}).shortageCount,1);
});
test('POS card/cash sale and cancellation retain expenseOnly cost and enforce ordinary shortage',()=>{
 const start=base();start.inventory[0].stock=0;start.recipes=[{id:'r',name:'Taom',salePrice:10000,ingredients:[{inventoryId:'KARAM',quantity:100,lineCost:9999}]}];
 for(const paymentType of ['card','cash']){
  const out=applyPosOrder(start,{operationId:`terminal-${paymentType}-001`,paymentType,items:[{recipeId:'r',quantity:2}]},{id:'pos-terminal',name:'Rahbar'},when);
  assert.equal(out.state.inventory[0].stock,0);assert.equal(out.state.sales[0].totalCost,400);assert.equal((out.result.order.stockShortages||[]).length,0);
  if(paymentType==='cash') assert.equal(deletePosRecord(out.state,'sale',out.result.order.id).state.inventory[0].stock,0);
 }
 start.inventory[0].expenseOnly=false;
 assert.throws(()=>applyPosOrder(start,{operationId:'terminal-ordinary-001',paymentType:'card',items:[{recipeId:'r',quantity:2}]},{id:'pos-terminal',name:'Rahbar'},when),/yetmaydi|yetarli|yetish|qoldiq/i);
});
test('ordinary counts save zero, actor and units without legacy conversion requirement; retries are idempotent',()=>{
 const start=base();const first=count(start,'count-zero-0001',[{inventoryId:'UN',actualStock:0},{inventoryId:'bread',actualStock:10}]);
 assert.equal(first.inventory[1].stock,0);assert.equal(first.inventoryCounts.length,2);assert.equal(first.inventoryCounts[0].countedBy,'Ali');assert.equal(first.inventoryCounts[0].date,'2026-09-25');
 assert.deepEqual(count(first,'count-zero-0001',[{inventoryId:'UN',actualStock:99}]),first);
 const second=count(first,'count-pack-0001',[{inventoryId:'UN',packageCount:1.25,expectedUnitsPerPackage:1000}],later);assert.equal(second.inventory[1].stock,1250);
 for(const key of Object.keys(retired))assert.equal(second.inventory[1][key],start.inventory[1][key]);
 assert.equal('group' in second.inventoryCounts[0],false);assert.equal('varianceLimitPct' in second.inventoryCounts[0],false);
});
test('count rejects expenseOnly, invalid values, stale packaging and closed month',()=>{
 for(const value of [-1,null,'',false,Infinity]) assert.throws(()=>count(base(),'count-invalid',[{inventoryId:'UN',actualStock:value}]),InventoryCountingError);
 for(const inventoryId of ['KARAM','foreign'])assert.throws(()=>count(base(),'count-invalid',[{inventoryId,actualStock:1}]),InventoryCountingError);
 assert.throws(()=>count(base(),'count-stale-001',[{inventoryId:'UN',packageCount:1,expectedUnitsPerPackage:2}]),InventoryCountingError);
 const start=base();start.monthlyCloses=[{id:'monthly-close:2026-09',month:'2026-09',closedAt:later,closedBy:'Rahbar',inventoryItems:[],inventoryValue:0,payrollItems:[],payrollGross:0,payrollPaid:0,payrollRemaining:0}];assert.throws(()=>count(start,'count-closed-01',[{inventoryId:'UN',actualStock:1}]),InventoryCountingError);
});
test('owner mode change retains ledger/counts/legacy metadata and can switch back',()=>{
 const start=base();start.inventoryCounts=[{id:'historic',group:'C',varianceLimitPct:10}];
 const out=configureInventoryAccounting(start,{inventoryId:'UN',expenseOnly:true},when).state;
 assert.equal(out.inventory[1].expenseOnly,true);assert.equal(out.inventory[1].stock,1000);assert.deepEqual(out.inventoryCounts,start.inventoryCounts);
 for(const key of Object.keys(retired))assert.equal(out.inventory[1][key],start.inventory[1][key]);
 const back=configureInventoryAccounting(out,{inventoryId:'UN',expenseOnly:false},later).state;assert.equal(back.inventory[1].expenseOnly,false);assert.equal(back.inventory[1].expenseOnlyHistory.length,2);
 assert.throws(()=>configureInventoryAccounting(start,{inventoryId:'UN',hisobGuruhi:'A'}),InventoryCountingError);
});
test('count comparisons preserve historical totals but ignore all former warning thresholds',()=>{
 let start=count(base(),'count-opening',[{inventoryId:'UN',actualStock:1000}]);
 const next=sale(start,'interval',{UN:800});next.stockMovements.unshift({id:'receipt',inventoryId:'UN',type:'receipt',quantity:1000});
 start=applySaleInventoryAccounting(start,next,when);start=count(start,'count-closing',[{inventoryId:'UN',actualStock:1000}],later);
 const report=inventoryVarianceReports(start)[0];assert.equal(report.actual,1000);assert.equal(report.theoretical,800);assert.equal(report.percent,25);
 const low=inventoryCountVariance({...report.start,varianceLimitPct:0},{...report.end,varianceLimitPct:0});const high=inventoryCountVariance({...report.start,varianceLimitPct:100},{...report.end,varianceLimitPct:100});
 assert.equal(low.percent,high.percent);assert.equal('alert' in low,false);
 assert.equal(inventoryCountVariance(report.start,{...report.end,theoreticalTotal:report.start.theoreticalTotal}).percent,null);
 const view=inventoryCountView({...report.end,group:'C',varianceLimitPct:10});assert.equal('group' in view,false);assert.equal('varianceLimitPct' in view,false);
 assert.deepEqual(inventoryNotificationJobs(start,new Date('2030-01-01')),[]);
});
test('month close and whole-product restoration preserve existing inventory and history',()=>{
 const start={...base(),staff:[],workShifts:[],payrollAdjustments:[],attendanceDays:[],payrollPayments:[],financialEntries:[]};start.inventoryCounts=[{id:'evidence'}];
 const out=closeBusinessMonth(start,'2026-09','Rahbar','2026-10-01T00:00:00Z',{},[]).state;assert.deepEqual(out.inventory,start.inventory);assert.deepEqual(out.inventoryCounts,start.inventoryCounts);
 const restored=applySaleInventoryAccounting({inventory:[],sales:[],stockMovements:[],deletedItems:[]},{inventory:[item('UN',750)],stockMovements:[{id:'historical',inventoryId:'UN',quantity:-250,type:'sale'}]},when);assert.equal(restored.inventory[0].stock,750);
});
