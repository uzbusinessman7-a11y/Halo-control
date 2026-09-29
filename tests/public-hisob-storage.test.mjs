import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { seoulBusinessDate, previousSeoulDate } from '../app/lib/business-time.ts';

test('public HISOB loads menu and saves dated cash/delivery/meal; history and corrections remain protected',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(query){let values=[];return{bind(...v){values=v;return this;},async first(column){const r=sqlite.prepare(query).get(...values);return column?r?.[column]??null:r??null;},async all(){return{results:sqlite.prepare(query).all(...values)};},async run(){return{meta:{changes:Number(sqlite.prepare(query).run(...values).changes)}};}};},async batch(q){const out=[];for(const s of q)out.push(await s.run());return out;},async exec(s){sqlite.exec(s);return{count:1,duration:0};}};
 const {default:worker}=await import('../dist/server/index.js');const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
 const call=(path,body,method=body?'POST':'GET',headers={})=>worker.fetch(new Request(`http://localhost${path}`,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
 const read=()=>JSON.parse(sqlite.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
 try {
  await call('/api/worker-auth?bootstrap=1');const initial=read();
  const state={...initial,inventory:[{id:'bread',name:'NON',unit:'dona',stock:20,unitCost:500}],recipes:[{id:'r',name:'Lavash',categoryId:'recipe-other',salePrice:10000,deliveryPrices:{coupang:13900},ingredients:[{inventoryId:'bread',quantity:1}]}],sales:[],posOrders:[{id:'private-order',note:'PRIVATE_HISTORY',total:999999}],stockMovements:[],workerConsumptions:[],monthlyCloses:[],accounts:[{id:'delivery',type:'delivery'},{id:'cash',type:'cash'}]};
  sqlite.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(state),'local-public-start','main');
  let response=await call('/api/hisob');assert.equal(response.status,200,await response.clone().text());let value=await response.json();
  assert.equal(value.catalog[0].salePrice,10000);assert.equal(value.catalog[0].deliveryPrices.coupang,13900);assert.equal(value.publicEntry,true);
  assert.deepEqual(value.orders,[]);assert.deepEqual(value.inventoryOutflows,[]);assert.equal(JSON.stringify(value).includes('PRIVATE_HISTORY'),false);assert.equal(value.inventory,undefined);assert.equal(value.catalog[0].ingredients,undefined);
  assert.equal((await call('/api/hisob?revision=1')).status,200);
  assert.equal((await call('/api/hisob?branch=other')).status,403);
  const date=previousSeoulDate(seoulBusinessDate());
  const body={operationId:'public-hisob-cash-001',branchId:'main',mode:'sale',paymentType:'cash',date,items:[{recipeId:'r',quantity:1,unitPrice:1}]};
  response=await call('/api/hisob',body);assert.equal(response.status,200,await response.clone().text());value=await response.json();
  assert.equal(value.order.date,date);assert.equal(value.order.total,10000);assert.deepEqual(value.orders,[]);assert.equal(value.order.accountId,undefined);
  assert.equal(read().sales[0].date,date);assert.equal(read().stockMovements[0].date,date);assert.equal(read().inventory[0].stock,19);assert.equal(read().posOrders[0].workerName,'HALO HISOB · loginsiz');
  response=await call('/api/hisob',body);assert.equal((await response.json()).alreadySaved,true);assert.equal(read().sales.length,1);assert.equal(read().inventory[0].stock,19);
  response=await call('/api/hisob',{...body,operationId:'public-hisob-delivery-001',paymentType:'delivery',deliveryPlatform:'coupang',expectedTotal:13900});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).order.total,13900);assert.equal(read().sales[0].deliveryCommissionAmount,5391);assert.match(String(read().sales[0].deliveryOrderNumber),/^HALO-/);
  response=await call('/api/hisob',{...body,operationId:'public-hisob-meal-001',mode:'inventory_only'});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).inventoryOutflow.date,date);assert.equal(read().sales.length,2);assert.equal(read().inventory[0].stock,17);
  for(const method of ['PUT','DELETE'])assert.equal((await call('/api/hisob',{recordId:read().posOrders[0].id,recordType:'sale'},method)).status,401);
  assert.equal((await call('/api/pos-terminal')).status,401);
  assert.equal((await call('/api/hisob',{...body,branchId:'other'})).status,403);
  assert.equal((await call('/api/hisob',{...body,paymentType:'card',operationId:'public-card-001'})).status,400);
  // Existing signed-in worker retains the authenticated history view and branch rules.
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('main:ali:1234'))),b=>b.toString(16).padStart(2,'0')).join('');
  sqlite.prepare('INSERT INTO halo_worker_users (id,branch_id,name,username,pin_hash) VALUES (?,?,?,?,?)').run('test-worker','main','Ali','ali',hash);
  response=await call('/api/worker-auth',{action:'login',branchId:'main',username:'ali',pin:'1234'});const auth={Cookie:response.headers.get('set-cookie').split(';')[0]};
  response=await call('/api/hisob',undefined,'GET',auth);value=await response.json();assert.equal(value.workerName,'Ali');assert.equal(value.publicEntry,undefined);assert.ok(value.orders.length>0);assert.ok(value.orders.every(o=>o.editable===false));
 } finally {sqlite.close();delete globalThis.__HALO_CONTROL_DB__;}
});
