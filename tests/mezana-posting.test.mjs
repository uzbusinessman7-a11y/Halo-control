import test from 'node:test';
import assert from 'node:assert/strict';
import { syncMezanaPosting } from '../app/lib/mezana-posting.ts';
const base=()=>({inventory:[{id:'i',name:'Sut',unit:'dona',stock:10}],stockMovements:[],financialEntries:[],mezanaEntries:[],mezanaCatalog:[]});
const entry=(patch={})=>({id:'m1',action:'purchased',productName:'Sut',itemCount:2,amount:6000,unitPrice:3000,date:'2026-09-24',...patch});
const add=(state,e)=>syncMezanaPosting(state,{...state,mezanaEntries:[e,...state.mezanaEntries]});
test('purchase matching inventory adds once, no duplicate expense, retry idempotent',()=>{
 const s=add(base(),entry()); assert.equal(s.inventory[0].stock,12); assert.equal(s.financialEntries.length,0); assert.equal(s.stockMovements.length,1);
 assert.deepEqual(syncMezanaPosting(s,structuredClone(s)),s);
});
test('unknown purchase becomes a noncash expense, borrowed item never becomes expense',()=>{
 const s=add(base(),entry({productName:'Salfetka'})); assert.equal(s.financialEntries[0].amount,6000); assert.equal(s.financialEntries[0].accountId,''); assert.equal(s.stockMovements.length,0);
 const b=add(base(),entry({action:'borrowed',quantity:2,amount:0,productName:'Salfetka'})); assert.equal(b.financialEntries.length,0);
});
test('exact normalized names only; duplicates and unknown conversions fail',()=>{
 assert.equal(add(base(),entry({productName:' SUT '})).inventory[0].stock,12);
 const s=base();s.inventory.push({...s.inventory[0],id:'i2'});assert.throws(()=>add(s,entry()),/bir nechta/);
 const g=base();g.inventory[0].unit='g';assert.throws(()=>add(g,entry()),/miqdorini/);
});
test('explicit pack conversion and borrowed return use saved conversion',()=>{
 const s=base();s.inventory[0].unit='g';s.inventory[0].stock=100;
 s.mezanaCatalog=[{id:'c',inventoryId:'i',inventoryUnitsPerItem:1000}];
 const b=add(s,entry({action:'borrowed',quantity:2,amount:0,catalogItemId:'c'}));assert.equal(b.inventory[0].stock,2100);
 b.mezanaCatalog[0].inventoryUnitsPerItem=500;
 const r=add(b,entry({id:'r',action:'returned',quantity:1,amount:0,catalogItemId:'c'}));assert.equal(r.inventory[0].stock,1100);
});
test('edit changes stock by delta; deletion reverses once; no reclassification after inventory changes',()=>{
 const s=add(base(),entry());
 const edited=syncMezanaPosting(s,{...s,mezanaEntries:[{...s.mezanaEntries[0],itemCount:3,amount:9000}]});assert.equal(edited.inventory[0].stock,13);
 const deleted=syncMezanaPosting(edited,{...edited,mezanaEntries:[]});assert.equal(deleted.inventory[0].stock,10);assert.equal(deleted.stockMovements.length,0);
 const e=add(base(),entry({productName:'Salfetka'})); e.inventory.push({id:'new',name:'Salfetka',stock:0,unit:'dona'});
 const edit=syncMezanaPosting(e,{...e,mezanaEntries:[{...e.mezanaEntries[0],amount:7000}]});assert.equal(edit.financialEntries[0].amount,7000);assert.equal(edit.stockMovements.length,0);
});
test('historical unlinked entries are not backfilled and legacy returns do not remove stock',()=>{
 const s=base();s.mezanaEntries=[entry({action:'borrowed',quantity:10,amount:0})];
 const noChange=syncMezanaPosting(s,structuredClone(s));assert.equal(noChange.stockMovements.length,0);
 const r=add(s,entry({id:'r',action:'returned',quantity:2,amount:0}));assert.equal(r.inventory[0].stock,10);
});
test('linked movements and expenses cannot be independently deleted or reversed',()=>{
 const s=add(base(),entry());assert.throws(()=>syncMezanaPosting(s,{...s,stockMovements:[]}),/MEZANA/);
 const e=add(base(),entry({productName:'Salfetka'}));assert.throws(()=>syncMezanaPosting(e,{...e,financialEntries:[]}),/MEZANA/);
 assert.throws(()=>syncMezanaPosting(e,{...e,financialEntries:[...e.financialEntries,{id:'reverse',reversedEntryId:e.financialEntries[0].id}]}),/MEZANA/);
});
test('restore linked archive reinstates its effect; insufficient stock blocks reversal',()=>{
 const s=add(base(),entry());const record=s.mezanaEntries[0];
 const d=syncMezanaPosting(s,{...s,mezanaEntries:[],deletedItems:[{kind:'mezanaEntry',entityId:'m1',record}]});
 const r=add(d,record);assert.equal(r.inventory[0].stock,12);
 s.inventory[0].stock=1;assert.throws(()=>syncMezanaPosting(s,{...s,mezanaEntries:[]}),/yetarli emas/);
});
