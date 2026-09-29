import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

test('catalog archive endpoint preserves finance and receipts, supports restore and safely rejects new intake until restored', async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){let values=[];return{bind(...v){values=v;return this;},async first(column){const r=sqlite.prepare(sql).get(...values);return column?r?.[column]??null:r??null;},async all(){return{results:sqlite.prepare(sql).all(...values)};},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}};},async batch(q){const out=[];for(const s of q)out.push(await s.run());return out;},async exec(s){sqlite.exec(s);return{count:1,duration:0};}};
 const {default:worker}=await import('../dist/server/index.js');
 const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
 const call=(path,body,headers={})=>worker.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
 const owner={'oai-authenticated-user-email':'owner@warehouse-test.invalid'};
 const read=()=>JSON.parse(sqlite.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
 try {
  await call('/api/worker-auth?bootstrap=1');await call('/api/state',undefined,owner);
  const initial=read();
  const s={...initial,inventoryAccountingVersion:1,vegetableExpenseVersion:1,vegetablePurchases:[],inventory:[{id:'b',name:'BAGET NON',unit:'dona',stock:8,minStock:1,unitCost:500,packageCost:5000,unitsPerPackage:10,packageName:'dona',categoryId:'inventory-other'}],suppliers:[{id:'s',name:'Nodir',openingBalance:948000,balance:948000}],transactions:[],stockMovements:[],sales:[],recipes:[],financialEntries:[],inventoryCatalogArchives:[],warehouseRevisions:[],auditLog:Array.from({length:120},(_,i)=>({id:`old-${i}`,actor:'Rahbar',action:'old-history',createdAt:'2026-09-01T00:00:00.000Z'})),customData:{mustStay:'unchanged'}};
  sqlite.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(s),'catalog-test-start','main');
  const intake={inventoryOnly:true,operationId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',date:'2026-09-27',lines:[{name:'BAGET NON',quantity:3,unit:'dona',amount:6000}]};
  let response=await call('/api/intake',intake,owner);assert.equal(response.status,200,await response.clone().text());
  const before=read();assert.equal(before.inventory[0].stock,11);assert.equal(before.suppliers[0].balance,948000);assert.deepEqual(before.transactions,s.transactions);assert.deepEqual(before.financialEntries,s.financialEntries);
  const archive=(headers=owner)=>worker.fetch(new Request('http://localhost/api/inventory-records',{method:'DELETE',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({kind:'inventory',id:'b',reason:'Keraksiz mahsulot'})}),env,{waitUntil(){},passThroughOnException(){}});
  assert.equal((await archive({})).status,401);
  response=await archive();assert.equal(response.status,200,await response.clone().text());
  const saved=read();assert.equal(saved.inventory[0].catalogArchived,true);
  assert.equal(saved.inventory[0].stock,11);assert.equal(saved.inventoryCatalogArchives.length,1);
  for(const key of ['transactions','stockMovements','suppliers','sales','financialEntries','recipes','customData'])assert.deepEqual(saved[key],before[key],key);
  assert.deepEqual(saved.auditLog.slice(1),before.auditLog);
  response=await archive();assert.equal(response.status,200);assert.deepEqual(read(),saved);
  response=await call('/api/inventory-accounting',undefined,owner);assert.equal(response.status,200);assert.equal((await response.json()).inventory.some(i=>i.id==='b'),false);
  response=await call('/api/intake',{...intake,operationId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'},owner);assert.equal(response.status,400);assert.match((await response.json()).error,/tiklang/);assert.deepEqual(read(),saved);
  assert.equal((await call('/api/inventory-records',{action:'restoreProduct',id:'b'})).status,401);
  response=await call('/api/inventory-records',{action:'restoreProduct',id:'b'},owner);assert.equal(response.status,200,await response.clone().text());
  const restored=read();assert.deepEqual(restored.inventory,before.inventory);assert.ok(restored.inventoryCatalogArchives[0].restoredAt);
  assert.deepEqual(restored.transactions,before.transactions);assert.deepEqual(restored.suppliers,before.suppliers);assert.equal(restored.auditLog.length,123);
  response=await call('/api/inventory-accounting',undefined,owner);assert.equal(response.status,200);assert.equal((await response.json()).inventory.some(i=>i.id==='b'),true);
  response=await call('/api/intake',{...intake,operationId:'cccccccc-cccc-cccc-cccc-cccccccccccc',duplicateReason:'Alohida ikkinchi xarid'},owner);assert.equal(response.status,200,await response.clone().text());
  assert.equal(read().inventory[0].stock,14);assert.equal(read().suppliers[0].balance,948000);assert.deepEqual(read().transactions,s.transactions);assert.deepEqual(read().financialEntries,s.financialEntries);
 } finally {sqlite.close();delete globalThis.__HALO_CONTROL_DB__;}
});
