import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
test('authenticated employee can enter delivery at server prices, cannot edit prices or other branch',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(query){let values=[];return{bind(...v){values=v;return this;},async first(column){const r=sqlite.prepare(query).get(...values);return column?r?.[column]??null:r??null;},async all(){return{results:sqlite.prepare(query).all(...values)};},async run(){return{meta:{changes:Number(sqlite.prepare(query).run(...values).changes)}};}};},async batch(q){const out=[];for(const s of q)out.push(await s.run());return out;},async exec(s){sqlite.exec(s);return{count:1,duration:0};}};
 const {default:worker}=await import('../dist/server/index.js');const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
 const call=(path,body,headers={},method=body?'POST':'GET')=>worker.fetch(new Request(`http://localhost${path}`,{method,headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
 const read=()=>JSON.parse(sqlite.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
 try {
  await call('/api/worker-auth?bootstrap=1');const initial=read();
  const state={...initial,inventory:[{id:'i',name:'NON',unit:'dona',stock:10,unitCost:500}],recipes:[{id:'r',name:'Lavash',categoryId:'recipe-other',salePrice:10000,deliveryPrices:{coupang:13900},ingredients:[{inventoryId:'i',quantity:1}]}],sales:[],posOrders:[],stockMovements:[],accounts:[{id:'delivery',type:'delivery'},{id:'cash',type:'cash'}]};
  sqlite.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(state),'local-start','main');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('main:ali:1234'))),b=>b.toString(16).padStart(2,'0')).join('');
  sqlite.prepare('INSERT INTO halo_worker_users (id,branch_id,name,username,pin_hash) VALUES (?,?,?,?,?)').run('test-worker','main','Ali','ali',hash);
  let response=await call('/api/worker-auth',{action:'login',branchId:'main',username:'ali',pin:'1234'});assert.equal(response.status,200);const auth={Cookie:response.headers.get('set-cookie').split(';')[0]};
  response=await call('/api/pos-terminal',undefined,auth);assert.equal(response.status,200);assert.equal((await response.json()).catalog[0].deliveryPrices.coupang,13900);
  const body={operationId:'employee-delivery-0001',branchId:'main',mode:'sale',paymentType:'delivery',deliveryPlatform:'coupang',deliveryOrderNumber:'EMP001',expectedTotal:13900,items:[{recipeId:'r',quantity:1,unitPrice:1}],deliveryFeesWon:{delivery:3400}};
  assert.equal((await call('/api/pos-terminal',body)).status,401);
  assert.equal((await call('/api/pos-terminal',{...body,branchId:'other'},auth)).status,403);
  response=await call('/api/pos-terminal',body,auth);assert.equal(response.status,200,await response.clone().text());let value=await response.json();assert.equal(value.order.total,13900);assert.equal(value.order.workerName,'Ali');assert.equal(value.orders[0].editable,false);
  response=await call('/api/pos-terminal',body,auth);assert.equal((await response.json()).alreadySaved,true);assert.equal(read().sales.length,1);assert.equal(read().inventory[0].stock,9);assert.equal(read().sales[0].deliveryCommissionAmount,5391);assert.equal(read().sales[0].taxPctAtSale,0);
  assert.equal((await call('/api/pos-terminal',{...body,operationId:'employee-delivery-0002'},auth)).status,409);
  assert.equal((await call('/api/pos-terminal',body,auth,'PUT')).status,403);
 } finally {sqlite.close();delete globalThis.__HALO_CONTROL_DB__;}
});
