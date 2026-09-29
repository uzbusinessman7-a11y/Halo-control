import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRecordRemoval,projectRemoval,removalFingerprint} from '../app/lib/record-removals.ts';
import {applyWarehouseIntake} from '../app/lib/warehouse-intake.ts';
import {applyUnifiedIntake} from '../app/lib/unified-intake.ts';
import {applyVegetablePurchaseAccounting,vegetablePeriodTotals} from '../app/lib/vegetable-expenses.ts';
import {applySaleInventoryAccounting} from '../app/lib/inventory-accounting.ts';
import {syncMezanaPosting} from '../app/lib/mezana-posting.ts';
import {selectActiveFinancialEntries} from '../app/lib/daily-report.ts';
import {calculateAccountBalances} from '../app/lib/account-balances.ts';
import {purchaseReserveReport} from '../app/lib/purchase-reserve.ts';
import {validDeletedItems} from '../app/lib/deleted-items.ts';
const now='2026-09-27T09:00:00.000Z';
const base=()=>({inventory:[{id:'sauce',name:'SOUS',unit:'g',stock:0,unitCost:6.6,expenseOnly:true},{id:'meat',name:'Go‘sht',unit:'g',stock:10000,unitCost:10}],suppliers:[{id:'nodir',name:'Nodir',balance:0,openingBalance:0}],accounts:[{id:'cash',name:'Kassa',type:'cash',openingBalance:1000000}],sales:[],recipes:[],transactions:[],stockMovements:[],financialEntries:[],deletedItems:[],vegetableExpenseVersion:1,vegetablePurchases:[],mezanaEntries:[],auditLog:[{id:'old-audit'}]});
const post=(old,next)=>applySaleInventoryAccounting(old,applyVegetablePurchaseAccounting(old,syncMezanaPosting(old,next),'Rahbar',now),now);
const remove=async(s,kind,id,operationId='removal-test-00001')=>{
 const input={kind,id,operationId,reason:'Ikki marta kiritilgan',expected:await removalFingerprint(s)};
 const result=await applyRecordRemoval(s,input,now);return {state:post(s,result.state),input};
};
const receipt=()=>{let s=base();s=post(s,applyWarehouseIntake(s,{operationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',inventoryOnly:true,date:'2026-09-27',lines:[{inventoryId:'sauce',name:'SOUS',quantity:30,unit:'kg',amount:198000}]}).state);return s;};
test('sauce receipt preview is read only; cancellation removes purchase expense but not separately entered debt',async()=>{
 const s=receipt();s.suppliers[0].balance=198000;s.transactions=[{id:'separate-debt',supplierId:'nodir',type:'purchase',amount:198000,date:'2026-09-27'}];const copy=structuredClone(s);
 const p=s.vegetablePurchases[0];const preview=projectRemoval(s,{kind:'vegetable',id:p.id},'Sinov','preview-test',now);assert.deepEqual(s,copy);assert.equal(preview.projected.vegetablePurchases[0].cancelledAt,now);
 const {state:n}=await remove(s,'vegetable',p.id);assert.equal(n.inventory[0].stock,0);assert.equal(n.suppliers[0].balance,198000);assert.deepEqual(n.transactions,s.transactions);assert.equal(vegetablePeriodTotals(n,'2026-09-27','2026-09-27').expense,0);assert.equal(n.recordRemovals.length,1);assert.ok(validDeletedItems(n.deletedItems));assert.deepEqual(n.auditLog,s.auditLog);
});
test('old generated sauce debt and expense both reverse once from the expense row',async()=>{
 let s=base();const n={...s,inventory:s.inventory.map(i=>i.id==='sauce'?{...i,stock:30000}:i),stockMovements:[{id:'legacy-receipt',inventoryId:'sauce',type:'receipt',quantity:30000,purchaseQuantity:30,purchaseUnit:'kg',purchaseAmount:198000,unitCost:6.6,supplierId:'nodir',date:'2026-09-27'}]};s=post(s,n);assert.equal(s.suppliers[0].balance,198000);
 const {state:after}=await remove(s,'finance',s.vegetablePurchases[0].expenseId);assert.equal(after.suppliers[0].balance,0);assert.equal(after.transactions.length,0);assert.equal(selectActiveFinancialEntries(after.financialEntries).length,0);assert.equal(after.inventory[0].stock,0);
});
test('standalone duplicate supplier debt cancellation cannot remove the real receipt',async()=>{
 const s=receipt();s.suppliers[0].balance=396000;s.transactions=[{id:'original',supplierId:'nodir',type:'purchase',amount:198000,date:'2026-09-27'},{id:'duplicate',supplierId:'nodir',type:'purchase',amount:198000,date:'2026-09-27'}];
 const {state:n}=await remove(s,'transaction','duplicate');assert.equal(n.suppliers[0].balance,198000);assert.deepEqual(n.stockMovements,s.stockMovements);assert.deepEqual(n.vegetablePurchases,s.vegetablePurchases);
});
test('manual receipt reverses exactly physical stock and latest cost; consumed receipt fails atomically',async()=>{
 const s=base();s.stockMovements=[{id:'meat-receipt',inventoryId:'meat',type:'receipt',quantity:5000,unitCost:12,previousUnitCost:10,date:'2026-09-27'}];s.inventory[1].stock=15000;s.inventory[1].unitCost=12;
 const {state:n}=await remove(s,'warehouse','meat-receipt');assert.equal(n.inventory[1].stock,10000);assert.equal(n.inventory[1].unitCost,10);s.inventory[1].stock=1000;const copy=structuredClone(s);await assert.rejects(()=>remove(s,'warehouse','meat-receipt'),/minus|yetmaydi|qoldiq/);assert.deepEqual(s,copy);
});
test('intake payment alone restores cash and debt without removing any product',async()=>{
 const s=applyUnifiedIntake(base(),{operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',date:'2026-09-27',supplierName:'Nodir',paidAmount:10000,accountId:'cash',lines:[{name:'Go‘sht',quantity:2,unit:'kg',amount:20000}]}).state;
 const payment=s.transactions.find(t=>t.type==='payment'),cash=s.financialEntries.find(e=>e.transactionId===payment.id);
 const {state:n}=await remove(s,'finance',cash.id);assert.equal(n.suppliers[0].balance,20000);assert.equal(n.inventory[1].stock,12000);assert.equal(n.transactions[0].intakePaidAmount,0);assert.equal(calculateAccountBalances(n,'2026-09-27').total,1000000);assert.equal(n.stockMovements.length,1);assert.equal(n.deletedItems[0].record.id,payment.id);
});
test('whole legacy intake reverses included purchase and included payment atomically',async()=>{
 const s=applyUnifiedIntake(base(),{operationId:'cccccccc-cccc-cccc-cccc-cccccccccccc',date:'2026-09-27',supplierName:'Nodir',paidAmount:10000,accountId:'cash',lines:[{name:'Go‘sht',quantity:2,unit:'kg',amount:20000}]}).state;
 const {state:n}=await remove(s,'transaction',s.transactions.find(t=>t.type==='purchase').id);assert.equal(n.suppliers[0].balance,0);assert.equal(n.inventory[1].stock,10000);assert.equal(n.transactions.length,0);assert.equal(calculateAccountBalances(n,'2026-09-27').total,1000000);
});
test('retry after lost response does not reverse again; stale and changed retries are blocked',async()=>{
 const s=receipt();const {state:n,input}=await remove(s,'vegetable',s.vegetablePurchases[0].id);
 const retry=await applyRecordRemoval(n,input,now);assert.equal(retry.result.alreadySaved,true);assert.deepEqual(retry.state,n);
 await assert.rejects(()=>applyRecordRemoval(n,{...input,reason:'Boshqa sabab'},now),/boshqa yozuv/);
 await assert.rejects(()=>applyRecordRemoval({...s,suppliers:[{...s.suppliers[0],balance:1}]},input,now),/boshqa oynada/);
 await assert.rejects(()=>applyRecordRemoval(base(),input,now),/boshqa oynada/);
});
test('closed month rejects cancellation without any partial effects',async()=>{
 const s=receipt();s.monthlyCloses=[{id:'monthly-close:2026-09',month:'2026-09',closedAt:now,closedBy:'Rahbar',inventoryItems:[],inventoryValue:0,payrollItems:[],payrollGross:0,payrollPaid:0,payrollRemaining:0}];const old=structuredClone(s);await assert.rejects(()=>remove(s,'warehouse',s.stockMovements[0].id),/oy yopilgan/);assert.deepEqual(s,old);
});
test('expense and transfer reversal preserve original rows, restore correct cash accounts and profit',async()=>{
 let s=base();s.financialEntries=[{id:'expense',type:'expense',category:'Ijara',amount:10000,date:'2026-09-27',accountId:'cash',affectsProfit:true}];let n=(await remove(s,'finance','expense')).state;assert.equal(calculateAccountBalances(n,'2026-09-27').total,1000000);assert.equal(selectActiveFinancialEntries(n.financialEntries).length,0);assert.deepEqual(n.financialEntries[1],s.financialEntries[0]);
 s=base();s.accounts.push({id:'bank',name:'Bank',openingBalance:0});s.financialEntries=[{id:'transfer',type:'transfer',category:'Pul o‘tkazish',amount:10000,date:'2026-09-27',accountId:'cash',toAccountId:'bank'}];n=(await remove(s,'finance','transfer')).state;assert.equal(calculateAccountBalances(n,'2026-09-27').balances.get('cash'),1000000);assert.equal(calculateAccountBalances(n,'2026-09-27').balances.get('bank'),0);
});
test('payroll cancellation voids payment and cash posting as one operation',async()=>{
 const s=base();s.payrollPayments=[{id:'pay',staffId:'staff',financialEntryId:'fin-pay',amount:20000,accountId:'cash',month:'2026-09'}];s.financialEntries=[{id:'fin-pay',payrollPaymentId:'pay',type:'expense',date:'2026-09-27',amount:20000,accountId:'cash',affectsProfit:false}];const {state:n}=await remove(s,'finance','fin-pay');assert.equal(n.payrollPayments[0].voided,true);assert.equal(calculateAccountBalances(n,'2026-09-27').total,1000000);assert.equal(selectActiveFinancialEntries(n.financialEntries).length,0);
});
test('delivery removes whole batch and restores physical stock only, never theoretical sauce',async()=>{
 const s=base();s.inventory[1].stock=9000;s.sales=[{id:'s1',recipeId:'kebab',date:'2026-09-27',totalRevenue:20000,totalCost:4000,quantity:1,accountId:'cash',deliveryBatchId:'order',stockUsage:[]},{id:'s2',recipeId:'suv',date:'2026-09-27',totalRevenue:2000,totalCost:1000,quantity:1,accountId:'cash',deliveryBatchId:'order',stockUsage:[]}];
 s.stockMovements=[{id:'out1',inventoryId:'meat',quantity:-1000,type:'sale',date:'2026-09-27',referenceId:'s1'},{id:'out2',inventoryId:'sauce',quantity:0,theoreticalQuantity:100,type:'sale',expenseOnlyAtMovement:true,date:'2026-09-27',referenceId:'s1'}];
 const {state:n}=await remove(s,'sale','s1');assert.equal(n.sales.length,0);assert.equal(n.inventory[1].stock,10000);assert.equal(n.inventory[0].stock,0);assert.equal(n.deletedItems.filter(a=>a.kind==='sale').length,2);assert.equal(calculateAccountBalances(n,'2026-09-27').total,1000000);
});
test('reserve count is retained but excluded from subsequent reserve estimates',async()=>{
 const s=receipt();s.purchaseReserveCounts=[{id:'c1',inventoryId:'sauce',unit:'g',quantity:0,countedAt:now,recordedAt:now,recordedBy:'Rahbar'}];assert.equal(purchaseReserveReport(s,new Date(now)).products[0].empty,true);
 const {state:n}=await remove(s,'reserveCount','c1');assert.equal(n.purchaseReserveCounts.length,1);assert.equal(n.purchaseReserveCounts[0].cancelledAt,now);assert.equal(purchaseReserveReport(n,new Date(now)).products[0].lastConfirmed,null);assert.deepEqual(n.transactions,s.transactions);
});
test('MEZANA receipt removes its own physical posting exactly once and keeps history',async()=>{
 let s=base();s.inventory[1].stock=11000;s.mezanaEntries=[{id:'mezana:one',action:'borrowed',productName:'Go‘sht',amount:0,quantity:1,date:'2026-09-27',documents:[],posting:{kind:'stock',inventoryId:'meat',unitsPerItem:1000,quantity:1000,unit:'g'}}];s.stockMovements=[{id:'mezana-effect:mezana:one',inventoryId:'meat',type:'receipt',quantity:1000,date:'2026-09-27',mezanaEntryId:'mezana:one',referenceId:'mezana:one'}];const {state:n}=await remove(s,'warehouse',s.stockMovements[0].id);assert.equal(n.inventory[1].stock,10000);assert.equal(n.mezanaEntries.length,0);assert.ok(validDeletedItems(n.deletedItems));
});
test('received purchase-order cancellation preserves real payment as supplier advance',async()=>{
 const s=base();s.inventory[1].stock=12000;s.suppliers[0].balance=0;s.purchaseOrders=[{id:'po',date:'2026-09-27',status:'paid',supplierId:'nodir',total:20000}];s.transactions=[{id:'purchase-order-purchase:po',type:'purchase',supplierId:'nodir',date:'2026-09-27',amount:20000},{id:'purchase-order-payment:po',type:'payment',supplierId:'nodir',date:'2026-09-27',amount:20000}];s.stockMovements=[{id:'purchase-order-receipt:po:0',inventoryId:'meat',quantity:2000,type:'receipt',date:'2026-09-27',referenceId:'po'}];s.financialEntries=[{id:'paid',type:'expense',date:'2026-09-27',accountId:'cash',transactionId:'purchase-order-payment:po',amount:20000,affectsProfit:false}];
 const {state:n}=await remove(s,'warehouse',s.stockMovements[0].id);assert.equal(n.purchaseOrders[0].status,'cancelled');assert.equal(n.inventory[1].stock,10000);assert.equal(n.suppliers[0].balance,-20000);assert.deepEqual(n.financialEntries,s.financialEntries);assert.equal(n.transactions[0].type,'payment');
});
