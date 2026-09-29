import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

// Isolated local database and test user: these requests never reach the published site.
test('real endpoints retain legacy history and unlimited audit entries across counts, mode changes, retries and backup restoration', async()=>{
  const db=new DatabaseSync(':memory:');
  const adapter={
    prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(column){const result=db.prepare(sql).get(...values);return column?(result?.[column]??null):(result??null);},async all(){return {results:db.prepare(sql).all(...values)};},async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};}};},
    async batch(statements){const results=[];for(const statement of statements)results.push(await statement.run());return results;},
    async exec(sql){db.exec(sql);return {count:1,duration:0};}
  };
  const {default:worker}=await import('../dist/server/index.js');
  const env={DB:adapter,ASSETS:{fetch:async()=>new Response('',{status:404})}};
  const call=(path,body,cookie='',owner=false)=>worker.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(owner?{'oai-authenticated-user-email':'owner@halo-local-test.invalid'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
  try{
    const bootstrap=await call('/api/worker-auth?bootstrap=1');assert.equal(bootstrap.status,200,await bootstrap.text());
    const original=JSON.parse(db.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
    const fixture={...original,inventoryAccountingVersion:1,vegetableExpenseVersion:undefined,inventory:[{id:'cabbage',name:'UN',hisobUsuli:'davriy',hisobGuruhi:'C',countEveryDays:7,varianceLimitPct:10,purchaseConversionRequired:true,accountingStartedAt:new Date().toISOString(),unit:'g',stock:1000,minStock:100,unitCost:2,unitsPerPackage:1000,packageName:'kalla',packageCost:2000,supplierId:'',categoryId:'inventory-other'}],sales:[{id:'historic-sale',date:'2026-09-01',quantity:1,totalRevenue:10000,totalCost:100,stockUsage:[{inventoryId:'cabbage',quantity:50}]}],stockMovements:[{id:'historic-movement',inventoryId:'cabbage',type:'sale',quantity:-50,date:'2026-09-01'}],customData:{keep:'original'},auditLog:Array.from({length:150},(_,i)=>({id:`audit-old-${i}`,actor:'Rahbar',action:`Saved ${i}`,createdAt:'2026-09-01T00:00:00Z'})),inventoryNotifications:[{id:'historic-notice',status:'sent'}]};
    db.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(fixture),'fixture-revision','main');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('main:ali:1234'))),b=>b.toString(16).padStart(2,'0')).join('');
    db.prepare('INSERT INTO halo_worker_users (id,branch_id,name,username,pin_hash) VALUES (?,?,?,?,?)').run('worker-local','main','Ali','ali',hash);
    const login=await call('/api/worker-auth',{action:'login',branchId:'main',username:'ali',pin:'1234'});assert.equal(login.status,200,await login.text());
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const response=await call('/api/inventory-accounting?branch=another-branch&portal=worker',undefined,cookie);assert.equal(response.status,200);
    const view=await response.json();assert.equal(view.owner,false);for(const key of ['hisobUsuli','hisobGuruhi','countEveryDays','varianceLimitPct','purchaseConversionRequired']) assert.equal(key in view.inventory[0],false);assert.equal(view.inventory[0].stock,1000);assert.equal('unitCost' in view.inventory[0],false);
    const read=()=>JSON.parse(db.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
    const migrated=read();assert.deepEqual(migrated.sales,fixture.sales);assert.deepEqual(migrated.stockMovements,fixture.stockMovements);assert.deepEqual(migrated.customData,fixture.customData);assert.equal(migrated.inventory[0].unitCost,2);assert.deepEqual(migrated.inventory[0],fixture.inventory[0]);assert.ok(migrated.auditLog.length>=150);for(const entry of fixture.auditLog)assert.deepEqual(migrated.auditLog.find(e=>e.id===entry.id),entry);
    assert.equal(migrated.inventory.filter(i=>i.name==='상추').length,1);assert.equal(migrated.vegetableExpenseVersion,1);assert.equal(migrated.inventoryAccountingVersion,1);
    const config=await call('/api/inventory-accounting?portal=worker',{action:'configure',inventoryId:'cabbage',expenseOnly:true,unitsPerPackage:1000,packageName:'kalla'},cookie);assert.equal(config.status,403);
    const body={action:'count',operationId:'local-count-0001',counts:[{inventoryId:'cabbage',actualStock:750}]};
    const results=await Promise.all([call('/api/inventory-accounting?portal=worker',body,cookie),call('/api/inventory-accounting?portal=worker',body,cookie)]);
    for(const response of results) assert.equal(response.status,200,await response.text());
    const counted=read();assert.equal(counted.inventory[0].stock,750);assert.equal(counted.inventoryCounts.length,1);assert.equal(counted.inventoryCounts[0].countedBy,'Ali');assert.equal(counted.inventoryCounts[0].actorId,'worker-local');assert.equal(counted.stockMovements.filter(m=>m.referenceId==='inventory-count:local-count-0001').length,1);
    assert.deepEqual(counted.sales,fixture.sales);assert.deepEqual(counted.customData,fixture.customData);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM halo_state_backups').get().n>0,'previous state is backed up');
    // A local fake Telegram transport verifies the real dispatcher without sending a message.
    db.exec('CREATE TABLE IF NOT EXISTS telegram_settings (id TEXT PRIMARY KEY, bot_token TEXT, chat_id TEXT)');
    db.prepare('INSERT OR REPLACE INTO telegram_settings (id,bot_token,chat_id) VALUES (?,?,?)').run('main','local-test-token','local-test-owner');
    const withSale=read();
    withSale.stockMovements.unshift({id:'periodic-sale',inventoryId:'cabbage',type:'sale',quantity:0,theoreticalQuantity:400,hisobUsuliAtMovement:'davriy',date:withSale.inventoryCounts[0].date});
    db.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(withSale),'before-second-count','main');
    const nativeFetch=globalThis.fetch;const sends=[];
    globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://api.telegram.org/botlocal-test-token/sendMessage');sends.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:1}});};
    try{
      const second=await call('/api/inventory-accounting?portal=worker',{action:'count',operationId:'local-count-0002',counts:[{inventoryId:'cabbage',actualStock:250}]},cookie);
      assert.equal(second.status,200,await second.text());assert.equal(sends.length,0,'retired variance thresholds send no Telegram alerts');
      const retry=await call('/api/inventory-accounting?portal=worker',{action:'notify'},cookie);assert.equal(retry.status,200);assert.equal(sends.length,0,'retired reminder action remains inert');
      assert.deepEqual(read().inventoryNotifications,fixture.inventoryNotifications);
    }finally{globalThis.fetch=nativeFetch;}

    // Audit append paths: authenticated mutations and backup replacement retain
    // every existing entry even if the restored snapshot has a shorter journal.
    const afterCounts=read();assert.ok(afterCounts.auditLog.length>150);
    const snapshot=await call('/api/backups',{action:'snapshot',branchId:'main'},'',true);assert.equal(snapshot.status,200,await snapshot.clone().text());const savedBackup=(await snapshot.json()).backup;
    for(const expenseOnly of [true,false]){
      const config=await call('/api/inventory-accounting',{action:'configure',inventoryId:'cabbage',expenseOnly},'',true);assert.equal(config.status,200,await config.text());
      const product=read().inventory[0];assert.equal(product.expenseOnly,expenseOnly);for(const key of ['hisobUsuli','hisobGuruhi','countEveryDays','varianceLimitPct','purchaseConversionRequired'])assert.equal(product[key],fixture.inventory[0][key]);
    }
    const oldClient=await call('/api/inventory-accounting',{action:'configure',inventoryId:'cabbage',hisobGuruhi:'A'},'',true);assert.equal(oldClient.status,400);
    const beforeRestore=read();assert.ok(beforeRestore.auditLog.length>afterCounts.auditLog.length);
    const restored=await call('/api/backups',{branchId:'main',backupId:savedBackup.id},'',true);assert.equal(restored.status,200,await restored.text());
    const final=read();assert.equal(final.auditLog.length,beforeRestore.auditLog.length+1);assert.deepEqual(final.auditLog.slice(1),beforeRestore.auditLog);
    for(const entry of fixture.auditLog)assert.deepEqual(final.auditLog.find(e=>e.id===entry.id),entry);
    assert.deepEqual(final.customData,fixture.customData);assert.deepEqual(final.sales,fixture.sales);assert.deepEqual(final.stockMovements.find(m=>m.id==='historic-movement'),fixture.stockMovements[0]);
    const viewFinal=await (await call('/api/inventory-accounting',undefined,'',true)).json();
    assert.equal('varianceLimitPct' in viewFinal.counts[0],false);assert.equal('group' in viewFinal.counts[0],false);

  }finally{db.close();delete globalThis.__HALO_CONTROL_DB__;}
});
