import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {validSupplierDelivery} from '../app/lib/supplier-deliveries.ts';
import {warehouseDocuments} from '../app/lib/warehouse-records.ts';

// Exercise the deployed request handler with a real authenticated worker and an
// isolated database. This checks stock, debt, expenses and retry effects together.
test('worker goods receipts never create supplier debt or payments; retries and suspected duplicates are guarded',async()=>{
 const sql=new DatabaseSync(':memory:');
 const db={prepare(query){let values=[];return{bind(...v){values=v;return this;},async first(column){const r=sql.prepare(query).get(...values);return column?r?.[column]??null:r??null;},async all(){return{results:sql.prepare(query).all(...values)};},async run(){return{meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(q){const out=[];for(const s of q)out.push(await s.run());return out;},async exec(s){sql.exec(s);return{count:1,duration:0};}};
 const {default:worker}=await import('../dist/server/index.js');
 const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
 const call=(path,body,cookie='',owner=false)=>worker.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(owner?{'oai-authenticated-user-email':'owner@worker-local-test.invalid'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
 const read=()=>JSON.parse(sql.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
 const revision=()=>sql.prepare('SELECT updated_at FROM app_state WHERE id=?').get('main').updated_at;
 const id1='11111111-1111-1111-1111-111111111111',id2='22222222-2222-2222-2222-222222222222',id3='33333333-3333-3333-3333-333333333333';
 const form=(operationId=id1,changes={})=>{
  const f=new FormData(); const values={inventoryOnly:'true',operationId,date:'2026-09-27',updatedAt:revision(),lines:JSON.stringify([{id:'line-1',inventoryId:'bread',name:'NON',unit:'dona',quantity:2,totalAmount:1000}]),...changes};
  for(const[k,v]of Object.entries(values))f.set(k,v);return f;
 };
 const RealDate=globalThis.Date;
 globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-09-27T08:00:00Z']));}static now(){return RealDate.parse('2026-09-27T08:00:00Z');}};
 try{
  assert.equal((await call('/api/worker-auth?bootstrap=1')).status,200);
  const initial=read();
  const legacyDelivery={id:'legacy-delivery',supplierId:'nodir',date:'2026-09-01',note:'Old history',lines:[{id:'old-line',inventoryId:'bread',name:'NON',packageSize:'',quantity:1,totalAmount:500}],totalAmount:500,createdByWorkerId:'worker-old',createdByName:'Old worker',createdAt:'2026-09-01T00:00:00Z',status:'approved',settlementMode:'paid',paymentAccountId:'cash',paymentTransactionId:'old-payment'};
  const seed={...initial,vegetableExpenseVersion:1,vegetableExpenseStartedAt:'2026-09-01T00:00:00Z',vegetablePurchases:[],vegetableNotifications:[],inventory:[{id:'bread',name:'NON',unit:'dona',stock:10,unitCost:500},{id:'sauce',name:'SOUS',unit:'g',stock:-4000,unitCost:4,expenseOnly:true}],suppliers:[{id:'nodir',name:'Nodir aka',openingBalance:0,balance:198000}],transactions:[{id:'old-debt',supplierId:'nodir',type:'purchase',date:'2026-09-27',amount:198000,note:'SOUS'}],supplierDeliveries:[legacyDelivery],financialEntries:[],stockMovements:[],sales:[],posOrders:[],recipes:[],accounts:[{id:'cash',name:'Kassa',type:'cash',openingBalance:0}],monthlyCloses:[]};
  sql.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(seed),'worker-seed','main');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('main:ali:1234'))),b=>b.toString(16).padStart(2,'0')).join('');
  sql.prepare('INSERT INTO halo_worker_users (id,branch_id,name,username,pin_hash) VALUES (?,?,?,?,?)').run('worker-test','main','Ali','ali',hash);
  let r=await call('/api/worker-auth',{action:'login',branchId:'main',username:'ali',pin:'1234'});assert.equal(r.status,200,await r.clone().text());
  const cookie=r.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/worker-deliveries',form())).status,401);
  assert.equal((await call('/api/worker-deliveries',form(),cookie)).status,403);
  sql.prepare('UPDATE halo_worker_users SET can_supplier_delivery=1 WHERE id=?').run('worker-test');
  r=await call('/api/worker-deliveries',form(id1,{settlementMode:'paid',paymentAccountId:'cash'}),cookie);
  assert.equal(r.status,409);assert.equal((await r.json()).code,'FORM_VERSION_CHANGED');assert.equal(read().inventory[0].stock,10);
  r=await call('/api/worker-deliveries',form(id1,{updatedAt:'outdated'}),cookie);assert.equal(r.status,409);
  const originalReceipt=form();
  r=await call('/api/worker-deliveries',originalReceipt,cookie);assert.equal(r.status,200,await r.clone().text());
  const result=await r.json();assert.equal(result.delivery.supplierAccounting,'separate');assert.equal(result.delivery.supplierId,'');assert.ok(validSupplierDelivery(result.delivery));
  assert.equal(read().inventory[0].stock,12);assert.deepEqual(read().transactions,seed.transactions);assert.equal(read().suppliers[0].balance,198000);assert.equal(read().financialEntries.length,0);
  assert.equal(read().stockMovements[0].recordedBy,'Ali');assert.equal(read().stockMovements[0].supplierAccounting,'separate');
  assert.deepEqual(read().supplierDeliveries.find(d=>d.id===legacyDelivery.id),legacyDelivery);
  // Retry the same browser form, including its now-stale revision, without adding stock.
  r=await call('/api/worker-deliveries',originalReceipt,cookie);assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).alreadySaved,true);assert.equal(read().inventory[0].stock,12);
  r=await call('/api/worker-deliveries',form(id2),cookie);assert.equal(r.status,400);assert.equal((await r.json()).code,'SIMILAR_PURCHASE');assert.equal(read().inventory[0].stock,12);
  r=await call('/api/worker-deliveries',form(id2,{duplicateReason:'Ikkinchi yetkazma alohida keldi'}),cookie);assert.equal(r.status,200,await r.clone().text());assert.equal(read().inventory[0].stock,14);
  // Supplier debt was already recorded. Receiving sauce must not post it again.
  const sauceLines=JSON.stringify([{id:'sauce-line',inventoryId:'sauce',name:'SOUS',unit:'kg',quantity:4,totalAmount:198000}]);
  r=await call('/api/worker-deliveries',form(id3,{supplierId:'nodir',lines:sauceLines}),cookie);assert.equal(r.status,200,await r.clone().text());
  assert.equal(read().suppliers[0].balance,198000);assert.deepEqual(read().transactions,seed.transactions);assert.equal(read().inventory[1].stock,-4000);
  assert.equal(read().vegetablePurchases.length,1);assert.equal(read().vegetablePurchases[0].amount,198000);
  assert.equal(read().financialEntries.filter(e=>!e.nonCash).length,0);assert.equal(read().financialEntries.filter(e=>e.nonCash).reduce((n,e)=>n+e.amount,0),198000);
  r=await call('/api/worker-deliveries',form(id3,{supplierId:'nodir',lines:sauceLines}),cookie);assert.equal((await r.json()).alreadySaved,true);assert.equal(read().vegetablePurchases.length,1);
  assert.deepEqual(read().supplierDeliveries.find(d=>d.id===legacyDelivery.id),legacyDelivery);
  // Owner correction remains reversible without ever touching supplier balances.
  let doc=warehouseDocuments(read()).find(d=>d.id===`delivery-${id3}`);
  const edit={action:'edit',operationId:'worker-sauce-edit-1',id:doc.id,expected:doc.fingerprint,date:doc.date,supplierId:doc.supplierId,lines:[{...doc.lines[0],quantity:3,amount:148500}],reason:'Asl kirim 3 kg edi'};
  assert.equal((await call('/api/warehouse-records',edit,cookie)).status,401);
  r=await call('/api/warehouse-records',edit,'',true);assert.equal(r.status,200,await r.clone().text());
  assert.equal(read().inventory[1].stock,-4000);assert.equal(read().vegetablePurchases.find(p=>!p.cancelledAt).amount,148500);assert.deepEqual(read().transactions,seed.transactions);assert.equal(read().suppliers[0].balance,198000);
  doc=warehouseDocuments(read()).find(d=>d.id===`delivery-${id3}`);
  r=await call('/api/warehouse-records',{action:'cancel',operationId:'worker-sauce-cancel-1',id:doc.id,expected:doc.fingerprint,reason:'Takroriy jismoniy kirim'},'',true);assert.equal(r.status,200,await r.clone().text());
  assert.equal(read().inventory[1].stock,-4000);assert.equal(read().vegetablePurchases.filter(p=>!p.cancelledAt).length,0);assert.deepEqual(read().transactions,seed.transactions);assert.equal(read().suppliers[0].balance,198000);
  r=await call('/api/worker-deliveries',form(id3,{supplierId:'nodir',lines:sauceLines}),cookie);assert.equal(r.status,400);assert.match((await r.json()).error,/bekor/);
  assert.deepEqual(read().supplierDeliveries.find(d=>d.id===legacyDelivery.id),legacyDelivery);
 }finally{globalThis.Date=RealDate;sql.close();delete globalThis.__HALO_CONTROL_DB__;}
});
