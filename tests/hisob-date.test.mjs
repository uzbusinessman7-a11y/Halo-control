import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPosOrder, editPosRecord } from '../app/lib/pos-terminal.ts';
const actor = { id:'pos-terminal', name:'Hisob' }, now = '2026-09-25T15:05:00Z'; // Sep 26 Seoul
const seed = () => ({ inventory:[{id:'bread',name:'Non',unit:'dona',stock:20,unitCost:500}], recipes:[{id:'r',name:'Lavash',salePrice:10000,deliveryPrices:{coupang:13900},ingredients:[{inventoryId:'bread',quantity:1}]}], accounts:[{id:'cash',type:'cash'},{id:'delivery',type:'delivery'}], sales:[],posOrders:[],stockMovements:[],workerConsumptions:[],monthlyCloses:[] });
const input = {operationId:'dated-hisob-sale-001',date:'2026-09-24',mode:'sale',paymentType:'cash',items:[{recipeId:'r',quantity:1}]};

test('selected date reaches sale, order, movement and survives owner correction; creation time stays real', () => {
  const result = applyPosOrder(seed(),input,actor,now);
  for (const entry of [result.state.sales[0],result.result.order,...result.state.stockMovements]) assert.equal(entry.date,input.date);
  assert.equal(result.result.order.createdAt,now);
  assert.equal(result.state.inventory[0].stock,19);
  assert.equal(applyPosOrder(result.state,input,actor,now).result.alreadySaved,true);
  assert.throws(()=>applyPosOrder(result.state,{...input,date:'2026-09-25'},actor,now),/boshqa sana/);
  const edited = editPosRecord(result.state,{...input,recordType:'sale',recordId:result.result.order.id,items:[{recipeId:'r',quantity:2}]},actor,now);
  assert.equal(edited.result.order.date,input.date);
  assert.equal(edited.state.sales[0].date,input.date);
  assert.equal(edited.state.inventory[0].stock,18);
  assert.equal(applyPosOrder(seed(),{...input,date:undefined},actor,now).result.order.date,'2026-09-26');
  for (const date of ['2026-02-30','2026-09-27','', 'not-date']) assert.throws(()=>applyPosOrder(seed(),{...input,date},actor,now),/Sanani/);
});

test('delivery duplicate check uses chosen day, and kitchen entry keeps its chosen date after edits', () => {
  const delivery={...input,paymentType:'delivery',deliveryPlatform:'coupang',deliveryOrderNumber:'ORDER1',expectedTotal:13900};
  const first=applyPosOrder(seed(),delivery,actor,now);
  assert.equal(first.state.sales[0].soldAt,input.date);
  assert.throws(()=>applyPosOrder(first.state,{...delivery,operationId:'dated-hisob-sale-002'},actor,now),/oldin kiritilgan/);
  assert.equal(applyPosOrder(first.state,{...delivery,operationId:'dated-hisob-sale-003',date:'2026-09-25'},actor,now).result.order.date,'2026-09-25');
  const meal=applyPosOrder(seed(),{...input,mode:'inventory_only'},actor,now);
  assert.equal(meal.result.inventoryOutflow.date,input.date);
  const edit=editPosRecord(meal.state,{...input,recordType:'inventory_only',recordId:meal.result.inventoryOutflow.id,items:[{recipeId:'r',quantity:2}]},actor,now);
  assert.equal(edit.result.inventoryOutflow.date,input.date);
  assert.equal(edit.state.sales.length,0);
});
