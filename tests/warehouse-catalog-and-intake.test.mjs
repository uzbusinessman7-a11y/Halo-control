import test from 'node:test';
import assert from 'node:assert/strict';
import { setInventoryCatalogArchived, applyInventoryCatalogVisibility } from '../app/lib/inventory-catalog-archive.ts';
import { planIntakeLine, applyUnifiedIntake } from '../app/lib/unified-intake.ts';
import { intakeFormProblems, intakeUnitOptions, findIntakeProduct } from '../app/lib/intake-form.ts';
import { saveReserveCount, purchaseReserveReport } from '../app/lib/purchase-reserve.ts';
import { saveInventoryMovement } from '../app/lib/inventory-operations.ts';

const base=()=>({inventory:[{id:'i',name:'Non',unit:'dona',stock:4,unitCost:500,packageCost:5000,unitsPerPackage:10,packageName:'dona',supplierId:'s'}],suppliers:[{id:'s',name:'Nodir',balance:948000,openingBalance:948000}],accounts:[{id:'cash'}],transactions:[],financialEntries:[],stockMovements:[],recipes:[{id:'r',ingredients:[{inventoryId:'i',quantity:1}]}],sales:[{id:'sale',totalCost:500}],monthlyCloses:[{month:'2026-08',status:'closed'}],purchaseOrders:[{id:'p',inventoryId:'i'}],auditLog:[{id:'keep'}]});
const input=()=>({operationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',supplierName:'Nodir',date:'2026-09-27',paidAmount:2000,accountId:'cash',lines:[{name:'Non',quantity:3,unit:'dona',amount:6000}]});

test('base units never accidentally multiply by the identically named package',()=>{
 const item=base().inventory;
 assert.equal(planIntakeLine(item,input().lines[0]).stockQuantity,3);
 assert.equal(planIntakeLine(item,{...input().lines[0],unit:'qadoq'}).stockQuantity,30);
 const state=applyUnifiedIntake(base(),input()).state;
 assert.equal(state.inventory[0].stock,7);assert.equal(state.inventory[0].unitCost,2000);
 assert.equal(state.suppliers[0].balance,952000);
 assert.deepEqual(applyUnifiedIntake(state,input()).state,state);
});

test('grams, kilograms, millilitres and custom package units keep quantities and costs consistent',()=>{
 const i=[{id:'flour',name:'UN',unit:'g',unitsPerPackage:25000,packageName:'qop'}];
 assert.equal(planIntakeLine(i,{name:'Un',quantity:2,unit:'kg',amount:9000}).stockQuantity,2000);
 assert.equal(planIntakeLine(i,{name:'Un',quantity:2,unit:'QOP',amount:9000}).stockQuantity,50000);
 assert.ok(intakeUnitOptions(i[0]).includes('qop'));
 assert.equal(findIntakeProduct(i,' un ')?.id,'flour');
 assert.equal(planIntakeLine([{...i[0],unit:'ml'}],{name:'UN',quantity:1.5,unit:'litr',amount:12000}).stockQuantity,1500);
 assert.throws(()=>planIntakeLine(i,{name:'UN',quantity:2,unit:'dona',amount:9000}),/mos emas/);
});

test('catalog removal with linked purchases preserves all balances, receipts, recipes and historical data; restore is reversible',()=>{
 const original=applyUnifiedIntake(base(),input()).state;
 const archived=setInventoryCatalogArchived(original,'i',true,'Keraksiz mahsulot','2026-09-27T08:00:00.000Z').state;
 for(const key of ['suppliers','transactions','financialEntries','stockMovements','recipes','sales','monthlyCloses','purchaseOrders','auditLog']) assert.deepEqual(archived[key],original[key],key);
 assert.equal(archived.inventory[0].stock,original.inventory[0].stock);
 assert.equal(archived.inventory[0].unitCost,original.inventory[0].unitCost);
 assert.equal(archived.inventory[0].catalogArchived,true);
 assert.deepEqual(setInventoryCatalogArchived(archived,'i',true,'again').state,archived);
 assert.deepEqual(archived.inventoryCatalogArchives[0].record,original.inventory[0]);
 const stale={...archived,inventory:original.inventory};
 assert.equal(applyInventoryCatalogVisibility(stale).inventory[0].catalogArchived,true);
 assert.throws(()=>applyUnifiedIntake(archived,{...input(),operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}),/tiklang/);
 assert.throws(()=>saveInventoryMovement(archived,{movement:{id:'new',inventoryId:'i',type:'receipt',quantity:1,date:'2026-09-27'}}),/tiklang/);
 const restored=setInventoryCatalogArchived(archived,'i',false,'','2026-09-27T09:00:00.000Z').state;
 assert.deepEqual(restored.inventory,original.inventory);
 assert.equal(restored.inventoryCatalogArchives.length,1);assert.ok(restored.inventoryCatalogArchives[0].restoredAt);
 assert.deepEqual(setInventoryCatalogArchived(restored,'i',false).state,restored);
 const rearchived=setInventoryCatalogArchived(restored,'i',true,'Yana keraksiz').state;
 assert.equal(rearchived.inventoryCatalogArchives.length,2);assert.equal(rearchived.inventory[0].catalogArchived,true);
});

test('intake form explains missing data, does not invent payment, and rejects impossible dates and overpayments',()=>{
 const valid={supplier:'Nodir',date:'2026-09-27',paid:'0',total:6000,accountId:'cash',accounts:[{id:'cash'}],plans:[{line:{destination:'stock'},error:''}],lines:[{name:'Non'}],similar:false,duplicateReason:''};
 assert.deepEqual(intakeFormProblems(valid),[]);
 assert.match(intakeFormProblems({...valid,supplier:''})[0],/Kimdan/);
 assert.match(intakeFormProblems({...valid,paid:''})[0],/Hammasi/);
 assert.match(intakeFormProblems({...valid,paid:'6001'})[0],/summa/);
 assert.match(intakeFormProblems({...valid,date:'2026-02-30'})[0],/sanasi/);
 assert.match(intakeFormProblems({...valid,paid:'5000',accountId:''})[0],/hisobdan/);
 assert.match(intakeFormProblems({...valid,similar:true})[0],/oldin/);
});


test('existing cabbage can start a piece-based reserve count without a second purchase or financial entry',()=>{
 const state={...base(),inventory:[{...base().inventory[0],name:'KARAM',unit:'g',stock:3000,packageName:'kg',expenseOnly:true,expenseOnlyFrom:'2026-09-01'}],vegetablePurchases:[]};
 const now='2026-09-27T08:00:00.000Z';
 const next=saveReserveCount(state,{operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',inventoryId:'i',quantity:4,unit:'dona',countedAt:now},'Rahbar',now).state;
 for(const key of ['inventory','transactions','financialEntries','stockMovements','suppliers'])assert.deepEqual(next[key],state[key]);
 assert.equal(next.purchaseReserveCounts[0].quantity,4);assert.equal(next.purchaseReserveCounts[0].unit,'dona');
 const report=purchaseReserveReport(next,new Date(now));
 assert.equal(report.products[0].unit,'dona');assert.equal(report.products[0].estimatedRemaining,4);
});
