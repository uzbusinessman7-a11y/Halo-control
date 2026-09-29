import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { applyWarehouseIntake } from '../app/lib/warehouse-intake.ts';
import { applyVegetablePurchaseAccounting } from '../app/lib/vegetable-expenses.ts';
import { warehouseDocuments, applyWarehouseRecord } from '../app/lib/warehouse-records.ts';
import { intakeFormProblems } from '../app/lib/intake-form.ts';

const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const base=()=>({vegetableExpenseVersion:1,vegetableExpenseStartedAt:'2026-09-01T00:00:00Z',vegetablePurchases:[],inventory:[{id:'sauce',name:'SOUS',unit:'g',stock:-4000,unitCost:4,packageName:'banka',expenseOnly:true},{id:'flour',name:'UN',unit:'g',stock:1000,unitCost:2,unitsPerPackage:1000}],suppliers:[{id:'n',name:'Nodir aka',balance:198000,openingBalance:0}],transactions:[{id:'original-198000',type:'purchase',supplierId:'n',date:'2026-09-27',amount:198000,note:'SOUS'}],financialEntries:[],stockMovements:[],accounts:[{id:'cash',name:'Kassa'}],sales:[],recipes:[],deletedItems:[],auditLog:[{id:'keep'}]});
const input=()=>({inventoryOnly:true,operationId:id,date:'2026-09-27',lines:[{inventoryId:'sauce',name:'SOUS',quantity:3,unit:'banka',amount:198000}]});
const receive=(s,b)=>applyVegetablePurchaseAccounting(s,applyWarehouseIntake(s,b).state);

test('198000 sauce already recorded as supplier debt is received without another debt or payment',()=>{
 const s=base(),original=structuredClone(s),next=receive(s,input());
 assert.deepEqual(s,original);
 assert.equal(next.suppliers[0].balance,198000);assert.deepEqual(next.transactions,s.transactions);
 assert.deepEqual(next.accounts,s.accounts);assert.deepEqual(next.auditLog,s.auditLog);
 assert.equal(next.inventory[0].stock,-4000);assert.equal(next.inventory[0].unitCost,4);
 assert.equal(next.vegetablePurchases.length,1);assert.equal(next.vegetablePurchases[0].quantity,3);
 assert.equal(next.financialEntries.length,1);assert.equal(next.financialEntries[0].amount,198000);
 assert.equal(next.financialEntries[0].nonCash,true);assert.equal(next.vegetablePurchases[0].transactionId,'');
 assert.deepEqual(receive(next,input()),next);
 assert.throws(()=>receive(next,{...input(),operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}),e=>e.code==='SIMILAR_PURCHASE');
 assert.equal(receive(next,{...input(),operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',duplicateReason:'Boshqa kirim: yana 3 banka keldi'}).suppliers[0].balance,198000);
});

test('simple warehouse intake validates the goods without requiring supplier or payment fields',()=>{
 assert.deepEqual(intakeFormProblems({inventoryOnly:true,supplier:'',date:'2026-09-27',paid:'',total:198000,accountId:'',accounts:[],plans:[{line:{destination:'vegetableExpense'},error:''}],lines:[{name:'SOUS'}],similar:false,duplicateReason:''}),[]);
 assert.throws(()=>applyWarehouseIntake(base(),{...input(),lines:[{name:'Missing',quantity:1,unit:'dona',amount:1000}]}),/omborda yo‘q/);
 assert.throws(()=>applyWarehouseIntake({...base(),monthlyCloses:[{id:'monthly-close:2026-09',month:'2026-09',closedAt:'2026-09-27T00:00:00Z',inventoryItems:[],payrollItems:[]}]},input()),/yopilgan/);
 assert.throws(()=>applyWarehouseIntake(base(),{...input(),date:'2026-02-30'}),/sanasi/);
});

test('kilogram receipts, edits and cancellation alter only stock and price; sauce edits never invent supplier debt',()=>{
 const s=base();
 const b={...input(),lines:[{inventoryId:'flour',name:'UN',quantity:2,unit:'kg',amount:8000}]};
 let next=receive(s,b);assert.equal(next.inventory[1].stock,3000);assert.equal(next.inventory[1].unitCost,4);
 let doc=warehouseDocuments(next).find(d=>d.record.warehouseOperationId);
 next=applyWarehouseRecord(next,{operationId:'edit-flour-1',id:doc.id,expected:doc.fingerprint,action:'edit',date:doc.date,supplierId:'',lines:[{...doc.lines[0],quantity:3,amount:12000}],reason:'Miqdor 3 kg ekan'}).state;
 assert.equal(next.inventory[1].stock,4000);assert.equal(next.inventory[1].unitCost,4);
 assert.deepEqual(next.transactions,s.transactions);assert.deepEqual(next.suppliers,s.suppliers);
 doc=warehouseDocuments(next).find(d=>d.id===doc.id);
 next=applyWarehouseRecord(next,{operationId:'cancel-flour-1',id:doc.id,expected:doc.fingerprint,action:'cancel',reason:'Takror kirim'}).state;
 assert.equal(next.inventory[1].stock,1000);assert.deepEqual(next.transactions,s.transactions);
 assert.throws(()=>receive(next,b),/bekor/);
 let veg=receive(s,input());doc=warehouseDocuments(veg)[0];
 veg=applyWarehouseRecord(veg,{operationId:'edit-sauce-1',id:doc.id,expected:doc.fingerprint,action:'edit',date:doc.date,supplierId:'',lines:[{...doc.lines[0],quantity:2,amount:132000}],reason:'Ikki banka kelgan'}).state;
 assert.equal(veg.inventory[0].stock,-4000);assert.equal(veg.financialEntries.find(e=>!e.cancelledAt).amount,132000);
 assert.deepEqual(veg.transactions,s.transactions);assert.deepEqual(veg.suppliers,s.suppliers);
 doc=warehouseDocuments(veg)[0];
 veg=applyWarehouseRecord(veg,{operationId:'cancel-sauce-1',id:doc.id,expected:doc.fingerprint,action:'cancel',reason:'Takror kirim'}).state;
 assert.equal(veg.inventory[0].stock,-4000);assert.equal(veg.financialEntries.filter(e=>!e.cancelledAt).length,0);
 assert.deepEqual(veg.transactions,s.transactions);assert.deepEqual(veg.suppliers,s.suppliers);
 assert.equal(veg.warehouseRevisions.length,2);
});

test('built API: warehouse receipt, supplier debt and payment stay separate and are each recorded once',async()=>{
 const sql=new DatabaseSync(':memory:');
 const db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(column){const r=sql.prepare(query).get(...values);return column?r?.[column]??null:r??null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(q){const out=[];for(const s of q)out.push(await s.run());return out;},async exec(s){sql.exec(s);return {count:1,duration:0};}};
 const {default:worker}=await import('../dist/server/index.js');const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
 const call=(path,body,owner=true)=>worker.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-email':'owner@separate-local-test.invalid'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
 const read=()=>JSON.parse(sql.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
 const RealDate=globalThis.Date;globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-09-27T08:00:00Z']));}static now(){return RealDate.parse('2026-09-27T08:00:00Z');}};
 try {
  await call('/api/worker-auth?bootstrap=1');const original=read();
  const seed={...original,...base(),transactions:[],suppliers:[{id:'n',name:'Nodir aka',openingBalance:0,balance:0}],vegetableNotifications:[],vegetableExpenseSettings:{normPct:6},posOrders:[]};
  sql.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(seed),'seed','main');
  assert.equal((await call('/api/intake',input(),false)).status,401);
  let r=await call('/api/intake',input());assert.equal(r.status,200,await r.clone().text());
  assert.equal(read().suppliers[0].balance,0);assert.equal(read().transactions.length,0);assert.equal(read().vegetablePurchases.length,1);
  r=await call('/api/intake',input());assert.equal((await r.json()).alreadySaved,true);assert.equal(read().vegetablePurchases.length,1);
  const purchase={action:'saveTransaction',transaction:{id:'owner-sauce-198000',supplierId:'n',type:'purchase',amount:198000,date:'2026-09-27',note:'SOUS'}};
  r=await call('/api/supplier-records',purchase);assert.equal(r.status,200,await r.clone().text());
  assert.equal(read().suppliers[0].balance,198000);const receipts=read().stockMovements;
  r=await call('/api/supplier-records',purchase);assert.equal(r.status,200);assert.equal(read().suppliers[0].balance,198000);
  r=await call('/api/supplier-records',{action:'saveTransaction',transaction:{id:'owner-sauce-payment',supplierId:'n',type:'payment',amount:198000,date:'2026-09-27',accountId:'cash'}});
  assert.equal(r.status,200,await r.clone().text());assert.equal(read().suppliers[0].balance,0);
  assert.deepEqual(read().stockMovements,receipts);assert.equal(read().vegetablePurchases.length,1);
  assert.equal(read().financialEntries.filter(e=>e.affectsProfit===true).reduce((n,e)=>n+e.amount,0),198000);
  assert.equal(read().financialEntries.filter(e=>e.nonCash!==true).reduce((n,e)=>n+e.amount,0),198000);
 }finally{globalThis.Date=RealDate;sql.close();delete globalThis.__HALO_CONTROL_DB__;}
});
