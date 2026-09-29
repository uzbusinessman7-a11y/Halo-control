import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssistantPlan,executeAssistantPlan,stateFingerprint,assistantReport,validDate} from '../app/lib/assistant-engine.ts';
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const base=()=>({inventory:[{id:'flour',name:'Un',unit:'g',stock:1000,unitCost:2,unitsPerPackage:1000}],suppliers:[{id:'nodir',name:'Nodir aka',balance:158500,openingBalance:158500}],accounts:[{id:'cash',name:'Kassa'}],transactions:[],financialEntries:[],stockMovements:[],sales:[]});
const purchase=()=>({kind:'purchase',date:'2026-09-24',supplierName:'Coupang',accountName:'Kassa',paidAmount:5000,lines:[{name:'Un',quantity:2,unit:'kg',amount:8000}]});
test('purchase proposal never mutates state; confirmation posts all effects once',async()=>{
 const s=base(),original=structuredClone(s),plan=buildAssistantPlan(s,purchase(),id);assert.deepEqual(s,original);assert.match(plan.summary,/Ombor/);assert.match(plan.summary,/Qarz va to‘lov yaratilmaydi/);
 const fingerprint=await stateFingerprint(s),r=await executeAssistantPlan(s,plan,id,fingerprint);
 assert.equal(r.state.inventory[0].stock,3000);assert.deepEqual(r.state.suppliers,original.suppliers);assert.deepEqual(r.state.transactions,original.transactions);
 assert.deepEqual(r.state.financialEntries,original.financialEntries);
 assert.deepEqual((await executeAssistantPlan(r.state,plan,id,fingerprint)).state,r.state);
 // Even if an owner subsequently removes the purchase, replay cannot recreate it.
 const removed={...r.state,transactions:[]};assert.deepEqual((await executeAssistantPlan(removed,plan,id,fingerprint)).state,removed);
});
test('Nodir 158500 payment clears debt and cash leaves once without second profit expense',async()=>{
 const s=base();const plan=buildAssistantPlan(s,{kind:'payment',supplierName:'Nodir aka',accountName:'Kassa',amount:158500,date:'2026-09-24'},id);
 const r=await executeAssistantPlan(s,plan,id,await stateFingerprint(s));assert.equal(r.state.suppliers[0].balance,0);assert.equal(r.state.transactions[0].amount,158500);assert.equal(r.state.financialEntries[0].affectsProfit,false);assert.equal(r.state.financialEntries[0].amount,158500);
 assert.deepEqual((await executeAssistantPlan(r.state,plan,id,'old')).state,r.state);
});
test('changed balance or catalog invalidates preview instead of silently adjusting it',async()=>{
 const s=base();const plan=buildAssistantPlan(s,purchase(),id);const fingerprint=await stateFingerprint(s);s.inventory.push({id:'napkin',name:'Salfetka',unit:'dona',stock:0});
 await assert.rejects(executeAssistantPlan(s,plan,id,fingerprint),/yangilangan/);
});
test('warehouse purchase needs no payment; unknown products, overpayment, ledger mismatch and impossible dates fail',()=>{
 assert.doesNotThrow(()=>buildAssistantPlan(base(),{...purchase(),paidAmount:null,supplierName:null,accountName:null},id));
 assert.throws(()=>buildAssistantPlan(base(),{...purchase(),lines:[{name:'Unknown',quantity:1,unit:'dona',amount:1000}]},id),/omborda yo‘q/);
 const payment={kind:'payment',supplierName:'Nodir aka',accountName:'Kassa',amount:160000,date:'2026-09-24'};
 assert.throws(()=>buildAssistantPlan(base(),payment,id),/katta/);
 const s=base();s.suppliers[0].balance=160000;assert.throws(()=>buildAssistantPlan(s,{...payment,amount:1},id),/mos emas/);
 assert.throws(()=>validDate('2026-02-30'),/Sanani/);
});
test('reports use exact stored data and distinguish debt from advance',()=>{
 const s=base();s.suppliers.push({id:'a',name:'Daiso',openingBalance:-100,balance:-100});
 const result=assistantReport(s,{kind:'debts'});assert.match(result,/158,500/);assert.match(result,/avans ₩100/);
 assert.match(assistantReport(s,{kind:'stock',query:'un'}),/1000 g/);
 assert.match(assistantReport(s,{kind:'report',date:'2026-09-24'}),/Savdo: ₩0/);
});
