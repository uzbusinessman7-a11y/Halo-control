import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { planIntakeLine, applyUnifiedIntake } from '../app/lib/unified-intake.ts';
import { vegetablePurchaseBody } from '../app/lib/vegetable-purchase-form.ts';
import { applyVegetablePurchaseAccounting } from '../app/lib/vegetable-expenses.ts';

const item = () => ({id:'sauce',name:'SOUS',unit:'g',stock:4000,unitCost:4,packageName:'banka',expenseOnly:true});
const draft = () => ({inventoryId:'sauce',quantity:'0.5',unit:'banka',amount:'5000',supplier:'Nodir aka',date:'2026-09-27',time:'10:00',paymentMode:'debt',paid:'',remainingStatus:'unknown',remaining:''});
const data = () => ({inventory:[item()],accounts:[{id:'cash',name:'Kassa'}]});
const operation = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

test('a selected sauce keeps its exact identity even when an old product has the same name', () => {
  const inventory = [{...item(),id:'old-sauce',catalogArchived:true},item()];
  const body = vegetablePurchaseBody(draft(),{...data(),inventory},operation);
  assert.equal(body.lines[0].inventoryId,'sauce');
  const plan = planIntakeLine(inventory,body.lines[0],body.date);
  assert.equal(plan.inventoryId,'sauce');
  assert.equal(plan.destination,'vegetableExpense');
  assert.throws(()=>planIntakeLine(inventory,{...body.lines[0],inventoryId:''}),/takrorlangan/);
  assert.throws(()=>planIntakeLine(inventory,{...body.lines[0],inventoryId:'missing'}),/topilmadi/);
});

test('half a jar without a gram conversion is valid, while ordinary stock still requires one', () => {
  const line = vegetablePurchaseBody(draft(),data(),operation).lines[0];
  for (const unitsPerPackage of [undefined,0,1,NaN]) {
    const planned = planIntakeLine([{...item(),unitsPerPackage}],line);
    assert.equal(planned.stockQuantity,0);
    assert.equal(planned.quantity,0.5);
    assert.equal(planned.amount,5000);
  }
  assert.equal(planIntakeLine([{...item(),unit:'dona'}],{...line,unit:'dona'}).quantity,0.5);
  assert.throws(()=>planIntakeLine([{...item(),expenseOnly:false}],line),/qadoq/);
  assert.throws(()=>planIntakeLine([{...item(),unit:'dona',expenseOnly:false}],{...line,unit:'dona'}),/qadoq/);
  assert.equal(planIntakeLine([{...item(),packageName:'kg'}],{...line,unit:'kg'}).stockQuantity,500);
});

test('simple form sends product quantities only, even if an old draft still contains payment fields', () => {
  const body=vegetablePurchaseBody({...draft(),paymentMode:'full',paid:'5000'},data(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.equal(body.inventoryOnly,true);
  assert.equal(body.lines[0].amount,5000);
  for(const key of ['paidAmount','accountId','supplierName'])assert.equal(key in body,false);
  assert.doesNotThrow(()=>vegetablePurchaseBody({...draft(),paymentMode:'',supplier:''},data(),operation));
  assert.throws(()=>vegetablePurchaseBody({...draft(),remainingStatus:'known'},data(),operation),/qoldiq/);
});

test('selected archived product and historical expense-policy boundary remain protected', () => {
  const state={...data(),inventory:[{...item(),catalogArchived:true}],suppliers:[],transactions:[],stockMovements:[],financialEntries:[]};
  const body={...vegetablePurchaseBody(draft(),data(),operation),inventoryOnly:false,supplierName:'Nodir aka',paidAmount:0};
  assert.throws(()=>applyUnifiedIntake(state,body),/tiklang/);
  state.inventory=[{...item(),expenseOnlyHistory:[{enabled:true,at:'2026-09-27T00:00:00Z'}]}];
  assert.throws(()=>applyUnifiedIntake(state,{...body,date:'2026-09-26',lines:body.lines.map(l=>({...l,purchasedAt:'2026-09-26T10:00:00+09:00'}))}),/mos emas|belgilanmagan|qadoq/);
});

test('built API preserves and replays legacy sauce purchases, blocks old forms, and confirms new separate receipts without debt', async () => {
  const sql=new DatabaseSync(':memory:');
  const db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(column){const r=sql.prepare(query).get(...values);return column?r?.[column]??null:r??null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(q){const out=[];for(const s of q)out.push(await s.run());return out;},async exec(s){sql.exec(s);return {count:1,duration:0};}};
  const {default:worker}=await import('../dist/server/index.js');
  const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
  const call=(path,body,owner=true)=>worker.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-email':'owner@sauce-test.invalid'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
  const read=()=>JSON.parse(sql.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
  const RealDate=globalThis.Date;
  globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-09-27T08:00:00Z']));}static now(){return RealDate.parse('2026-09-27T08:00:00Z');}};
  try {
    await call('/api/worker-auth?bootstrap=1');
    const original=read();
    const seed={...original,vegetableExpenseVersion:1,vegetableExpenseStartedAt:'2026-09-01T00:00:00Z',vegetableExpenseSettings:{normPct:6},vegetablePurchases:[],vegetableNotifications:[],inventory:[{...item(),id:'old-sauce',catalogArchived:true},item()],suppliers:[{id:'n',name:'Nodir aka',openingBalance:948000,balance:948000}],transactions:[],financialEntries:[],stockMovements:[{id:'old-receipt',inventoryId:'sauce',type:'receipt',quantity:4000,unitCost:4,date:'2026-08-20'}],sales:[],recipes:[],posOrders:[],deletedItems:[]};
    sql.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(seed),'seed','main');
    const body={...vegetablePurchaseBody(draft(),data(),operation),inventoryOnly:false,supplierName:'Nodir aka',paidAmount:2000,accountId:''};
    body.accountId=seed.accounts[0].id;
    assert.equal((await call('/api/intake',body,false)).status,401);
    let response=await call('/api/intake',body);
    assert.equal(response.status,400);assert.equal((await response.json()).code,'INTAKE_FORM_OUTDATED');assert.deepEqual(read(),seed);
    // Import an already existing legacy receipt as fixture; the current API cannot create it.
    const historical=applyVegetablePurchaseAccounting(seed,applyUnifiedIntake(seed,body).state,'Rahbar','2026-09-27T08:00:00Z');
    sql.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(historical),'legacy-receipt-fixture','main');
    const saved=read();
    assert.equal(saved.suppliers[0].balance,951000);
    assert.equal(saved.vegetablePurchases.length,1);
    assert.equal(saved.vegetablePurchases[0].quantity,0.5);
    assert.equal(saved.vegetablePurchases[0].unit,'banka');
    assert.equal(saved.financialEntries.filter(e=>e.category==='Sabzavot va sous').reduce((sum,e)=>sum+e.amount,0),5000);
    for(const i of saved.inventory) {assert.equal(i.stock,4000);assert.equal(i.unitCost,4);}
    assert.deepEqual(saved.stockMovements.find(m=>m.id==='old-receipt'),seed.stockMovements[0]);
    for(const key of ['sales','recipes','posOrders','deletedItems']) assert.deepEqual(saved[key],seed[key]);
    response=await call('/api/intake',body);assert.equal((await response.json()).alreadySaved,true);
    assert.equal(read().vegetablePurchases.length,1);assert.equal(read().suppliers[0].balance,951000);
    const second=vegetablePurchaseBody(draft(),data(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    response=await call('/api/intake',second);assert.equal(response.status,400);assert.equal((await response.json()).code,'SIMILAR_PURCHASE');
    assert.equal(read().vegetablePurchases.length,1);
    response=await call('/api/intake',{...second,duplicateReason:'Rahbar tasdiqladi: shu kuni alohida xarid qildim.'});
    assert.equal(response.status,200,await response.clone().text());
    const confirmed=read();
    assert.equal(confirmed.vegetablePurchases.length,2);assert.equal(confirmed.suppliers[0].balance,951000);
    assert.deepEqual(confirmed.transactions,saved.transactions);assert.deepEqual(confirmed.suppliers,saved.suppliers);
    assert.equal(confirmed.stockMovements.find(m=>m.warehouseOperationId===`warehouse:${second.operationId}`).duplicateOf,`intake:${operation}`);
    for(const legacyEntry of saved.financialEntries)assert.deepEqual(confirmed.financialEntries.find(e=>e.id===legacyEntry.id),legacyEntry);
    assert.equal(confirmed.financialEntries.filter(e=>e.category==='Sabzavot va sous').reduce((sum,e)=>sum+e.amount,0),10000);
    assert.equal(confirmed.inventory.find(i=>i.id==='sauce').stock,4000);
    response=await call('/api/intake',second);assert.equal((await response.json()).alreadySaved,true);assert.deepEqual(read(),confirmed);
  } finally {globalThis.Date=RealDate;sql.close();delete globalThis.__HALO_CONTROL_DB__;}
});
