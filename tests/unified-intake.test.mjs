import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUnifiedIntake,cancelUnifiedIntake,assertIntakePreserved,planIntakeLine,findSimilarIntake } from '../app/lib/unified-intake.ts';
const base=()=>({inventory:[{id:'flour',name:'Un',unit:'g',stock:1000,unitCost:2,unitsPerPackage:1000,packageName:'qop'}],suppliers:[],transactions:[],stockMovements:[],financialEntries:[],accounts:[{id:'cash',name:'Kassa'}],deletedItems:[]});
const input=()=>({operationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',supplierName:'Coupang',date:'2026-09-24',paidAmount:5000,accountId:'cash',lines:[{name:'Un',quantity:2,unit:'kg',amount:8000},{name:'Salfetka',quantity:1,unit:'dona',amount:2000,expenseConfirmed:true}]});
test('mixed purchase routes once to stock and expense, partial payment leaves exact debt',()=>{
 const s=applyUnifiedIntake(base(),input()).state;
 assert.equal(s.inventory[0].stock,3000);assert.equal(s.suppliers[0].balance,5000);
 assert.equal(s.transactions.length,2);assert.equal(s.financialEntries.filter(e=>e.affectsProfit).reduce((a,e)=>a+e.amount,0),2000);
 assert.equal(s.financialEntries.filter(e=>e.accountId==='cash').reduce((a,e)=>a+e.amount,0),5000);
 assert.equal(s.stockMovements.length,1);
 assert.deepEqual(applyUnifiedIntake(s,input()).state,s);
});
test('full payment leaves zero debt and no duplicate profit expense',()=>{
 const s=applyUnifiedIntake(base(),{...input(),paidAmount:10000}).state;
 assert.equal(s.suppliers[0].balance,0);assert.equal(s.financialEntries.filter(e=>e.affectsProfit).length,1);
});
test('debt-only purchase does not invent cash movement',()=>{
 const s=applyUnifiedIntake(base(),{...input(),paidAmount:0}).state;
 assert.equal(s.suppliers[0].balance,10000);assert.equal(s.financialEntries.some(e=>e.accountId),false);
});
test('cancel reverses stock, own payment and debt atomically, preserving audit',()=>{
 const s=applyUnifiedIntake(base(),input()).state;
 const c=cancelUnifiedIntake(s,{id:s.transactions[0].id,reason:'Noto‘g‘ri kiritilgan'}).state;
 assert.equal(c.inventory[0].stock,1000);assert.equal(c.suppliers[0].balance,0);assert.equal(c.transactions.length,0);assert.equal(c.financialEntries.length,0);assert.equal(c.deletedItems.length,2);
 assert.throws(()=>applyUnifiedIntake(c,input()),/bekor/);
});
test('unit mismatch, excessive payment, repeated invoice and separate mutation fail safely',()=>{
 assert.throws(()=>applyUnifiedIntake(base(),{...input(),paidAmount:10001}),/To‘langan/);
 assert.throws(()=>planIntakeLine(base().inventory,{name:'Un',quantity:1,unit:'dona',amount:1000}),/mos emas/);
 const s=applyUnifiedIntake(base(),{...input(),invoiceNumber:'123'}).state;
 assert.throws(()=>applyUnifiedIntake(s,{...input(),operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',invoiceNumber:'123'}),/oldin/);
 assert.throws(()=>assertIntakePreserved(s,{...s,stockMovements:[]}),/Bog‘langan/);
 assert.doesNotThrow(()=>assertIntakePreserved(s,structuredClone(s)));
});
test('missing payment never silently creates debt; duplicate receipt needs a reason',()=>{
 const b=input();delete b.paidAmount;
 assert.throws(()=>applyUnifiedIntake(base(),b),/To‘lovni belgilang/);
 const s=applyUnifiedIntake(base(),input()).state;
 const next={...input(),operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',lines:[...input().lines].reverse()};
 assert.throws(()=>applyUnifiedIntake(s,next),/oldin saqlangan/);
 const result=applyUnifiedIntake(s,{...next,duplicateReason:'Ikkinchi yetkazish'}).state;
 assert.equal(result.suppliers[0].balance,10000);
 assert.equal(result.transactions[0].duplicateOf,s.transactions[0].id);
 assert.equal(result.transactions[0].duplicateReason,'Ikkinchi yetkazish');
 const cancelled=cancelUnifiedIntake(s,{id:s.transactions[0].id,reason:'Xato kirim'}).state;
 assert.equal(cancelled.deletedItems[0].linkedSnapshot.stockMovements.length,1);
 assert.equal(cancelled.deletedItems[0].linkedSnapshot.financialEntries.length,2);
});

test('a purchase already entered in suppliers cannot silently be entered again through intake',()=>{
 const original={...base(),suppliers:[{id:'s',name:'Coupang',openingBalance:0,balance:5000}],transactions:[{id:'legacy-purchase',supplierId:'s',type:'purchase',amount:10000,date:'2026-09-24',note:'Un va salfetka'},{id:'legacy-payment',supplierId:'s',type:'payment',amount:5000,date:'2026-09-24'}]};
 const snapshot=structuredClone(original);
 assert.equal(findSimilarIntake(original.transactions,'s','2026-09-24',input().lines)?.id,'legacy-purchase');
 assert.throws(()=>applyUnifiedIntake(original,input()),e=>e.code==='SIMILAR_PURCHASE');
 assert.deepEqual(original,snapshot);
 assert.equal(findSimilarIntake(original.transactions,'s','2026-09-25',input().lines),undefined);
 assert.equal(findSimilarIntake(original.transactions,'different','2026-09-24',input().lines),undefined);
 assert.equal(findSimilarIntake(original.transactions,'s','2026-09-24',[]),undefined);
 assert.equal(findSimilarIntake(original.transactions.filter(t=>t.type==='payment'),'s','2026-09-24',[{name:'Un',amount:5000}]),undefined);
 const other=applyUnifiedIntake(original,{...input(),duplicateReason:'Bu shu kundagi ikkinchi alohida xarid'}).state;
 assert.equal(other.transactions[0].duplicateOf,'legacy-purchase');
 assert.equal(other.suppliers[0].balance,10000);
 assert.deepEqual(other.transactions.find(t=>t.id==='legacy-purchase'),snapshot.transactions[0]);
});
