import test from 'node:test';
import assert from 'node:assert/strict';
import { editSupplierBalance } from '../app/lib/supplier-balance-edit.ts';
const state = { suppliers: [{id:'nodir',name:'Nodir',balance:789500}], transactions:[{id:'p',supplierId:'nodir',type:'purchase',amount:948000},{id:'t',supplierId:'nodir',type:'payment',amount:158500}], inventory:[{id:'x',quantity:10}], financialEntries:[{id:'cash',amount:158500}] };
const input = {id:'edit-1',supplierId:'nodir',balance:948000,reason:'Qoldiq solishtirildi',expectedBalance:789500,expectedOpeningBalance:0};
test('reconciles to 948000 without deleting payment or changing cash/stock',()=>{
 const {state:n}=editSupplierBalance(state,input);
 assert.equal(n.suppliers[0].balance,948000);assert.equal(n.suppliers[0].openingBalance,158500);
 assert.equal(n.transactions,state.transactions); assert.equal(n.inventory,state.inventory);assert.equal(n.financialEntries,state.financialEntries);
 assert.equal(n.suppliers[0].openingBalance+948000-158500,948000);
 assert.equal(n.suppliers[0].balanceEdits[0].difference,158500);
 assert.equal(state.suppliers[0].balance,789500);
});
test('retries are idempotent and conflicting stale updates are rejected',()=>{
 const {state:n}=editSupplierBalance(state,input);
 assert.equal(editSupplierBalance(n,input).result.alreadySaved,true);
 assert.throws(()=>editSupplierBalance(n,{...input,id:'other'}),/boshqa joyda/);
 assert.throws(()=>editSupplierBalance(n,{...input,balance:123}),/boshqa ma’lumot/);
});
test('supports zero and prepayments; rejects invalid amounts and missing reasons',()=>{
 for(const amount of [0,-100]) assert.equal(editSupplierBalance(state,{...input,balance:amount}).state.suppliers[0].balance,amount);
 for(const amount of ['',null,1.5,NaN,Infinity,100_000_000_001]) assert.throws(()=>editSupplierBalance(state,{...input,balance:amount}));
 assert.throws(()=>editSupplierBalance(state,{...input,reason:' '}));
 assert.throws(()=>editSupplierBalance({...state,transactions:[{supplierId:'nodir',type:'purchase',amount:1.5}]},input));
});
