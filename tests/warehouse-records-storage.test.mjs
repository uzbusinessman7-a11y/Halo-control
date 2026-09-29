import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { warehouseDocuments } from '../app/lib/warehouse-records.ts';
import { applyUnifiedIntake } from '../app/lib/unified-intake.ts';
import { applyVegetablePurchaseAccounting } from '../app/lib/vegetable-expenses.ts';
test('owner endpoint atomically edits receipt, preserves original history, rejects employees and repeated/stale writes', async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){let values=[];return{bind(...v){values=v;return this;},async first(column){const r=sqlite.prepare(sql).get(...values);return column?r?.[column]??null:r??null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}};},async batch(q){const out=[];for(const s of q)out.push(await s.run());return out;},async exec(s){sqlite.exec(s);return{count:1,duration:0};}};
 const {default:worker}=await import('../dist/server/index.js');
 const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
 const call=(path,body,headers={})=>worker.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
 const owner={'oai-authenticated-user-email':'owner@warehouse-test.invalid'};
 const read=()=>JSON.parse(sqlite.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
 try {
  await call('/api/worker-auth?bootstrap=1');
  await call('/api/state',undefined,owner);
  const initial=read();
  const s={...initial,inventoryAccountingVersion:1,vegetableExpenseVersion:1,vegetablePurchases:[],inventory:[{id:'b',name:'BAGET NON',unit:'dona',stock:8,minStock:1,unitCost:500,packageCost:500,unitsPerPackage:1,packageName:'dona',categoryId:'inventory-other'}],suppliers:[{id:'s',name:'Nodir',openingBalance:948000,balance:948000}],transactions:[],stockMovements:[],sales:[],recipes:[],financialEntries:[],warehouseRevisions:[],auditLog:Array.from({length:120},(_,i)=>({id:`old-${i}`,actor:'Rahbar',action:'old-history',createdAt:'2026-09-01T00:00:00.000Z'})),customData:{mustStay:'unchanged'}};
  sqlite.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(s),'warehouse-test-start','main');
  const intake={action:'create',operationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',supplierName:'Nodir',date:'2026-09-26',accountId:initial.accounts[0].id,paidAmount:2000,lines:[{name:'BAGET NON',quantity:10,unit:'dona',amount:5000}]};
  // Legacy linked receipts are historical fixtures, not newly accepted API writes.
  let response=await call('/api/intake',intake,owner);assert.equal(response.status,400);assert.equal((await response.json()).code,'INTAKE_FORM_OUTDATED');assert.deepEqual(read(),s);
  const historical=applyVegetablePurchaseAccounting(s,applyUnifiedIntake(s,intake).state,'Rahbar','2026-09-26T10:00:00Z');
  sqlite.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(historical),'legacy-receipt-fixture','main');
  response=await call('/api/intake',intake,owner);assert.equal(response.status,200);assert.equal((await response.json()).alreadySaved,true);assert.deepEqual(read(),historical);
  const original=read(),doc=warehouseDocuments(original)[0];
  const body={action:'edit',operationId:'warehouse-edit-0001',id:doc.id,expected:doc.fingerprint,date:doc.date,supplierId:doc.supplierId,supplierName:'Nodir',paidAmount:2000,accountId:intake.accountId,lines:[{name:'BAGET NON',quantity:12,unit:'dona',amount:6000}],reason:'Chekdagi 12 dona bilan tuzatish'};
  assert.equal((await call('/api/warehouse-records',body)).status,401);
  assert.equal((await call('/api/warehouse-records',body,{'oai-authenticated-user-email':'employee@warehouse-test.invalid'})).status,401);
  response=await call('/api/warehouse-records',body,owner);assert.equal(response.status,200,await response.clone().text());
  let n=read();assert.equal(n.inventory[0].stock,20);assert.equal(n.suppliers[0].balance,952000);assert.equal(n.transactions.length,2);assert.equal(n.warehouseRevisions.length,1);assert.deepEqual(n.warehouseRevisions[0].before.record,doc.record);assert.deepEqual(n.customData,s.customData);assert.equal(n.auditLog.length,121);assert.deepEqual(n.auditLog.slice(1),s.auditLog);
  const saved=structuredClone(n);
  response=await call('/api/warehouse-records',body,owner);assert.equal(response.status,200);assert.equal((await response.json()).alreadySaved,true);assert.deepEqual(read(),saved);
  assert.equal((await call('/api/warehouse-records',{...body,operationId:'stale-operation-001'},owner)).status,409);assert.deepEqual(read(),saved);
  const backups=sqlite.prepare('SELECT COUNT(*) as n FROM halo_state_backups').get().n;assert.ok(backups>=1);
  const latest=warehouseDocuments(n)[0];
  response=await call('/api/warehouse-records',{action:'cancel',operationId:'warehouse-cancel-001',id:latest.id,expected:latest.fingerprint,reason:'Butun kirim noto‘g‘ri kiritilgan'},owner);assert.equal(response.status,200,await response.clone().text());
  n=read();assert.equal(n.inventory[0].stock,8);assert.equal(n.suppliers[0].balance,948000);assert.equal(n.warehouseRevisions.length,2);assert.equal(n.deletedItems.filter(d=>d.record.intakeLines).length,1);assert.equal(n.warehouseRevisions[0].before.amount,6000);assert.deepEqual(n.customData,s.customData);
 } finally {sqlite.close();delete globalThis.__HALO_CONTROL_DB__;}
});
