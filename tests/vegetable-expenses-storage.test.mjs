import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildGoogleSheetsExport } from '../app/lib/google-sheets-export.ts';

test('built app: authorized purchase + sale, preserved history, owner settings, worker restrictions and scheduled Telegram deduplication', async()=>{
  // Entirely local database, local gateway identity and mocked Telegram. No production credentials or requests.
  const sqlite = new DatabaseSync(':memory:');
  const db = { prepare(sql) { let values=[];return { bind(...v){values=v;return this;},async first(column){const r=sqlite.prepare(sql).get(...values);return column?(r?.[column]??null):(r??null);},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}};}};},async batch(q){const results=[];for(const s of q)results.push(await s.run());return results;},async exec(s){sqlite.exec(s);return {count:1,duration:0};} };
  const {default:worker}=await import('../dist/server/index.js');
  const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}};
  const call=(path,body,headers={})=>worker.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
  const owner={'oai-authenticated-user-email':'owner@halo-local-test.invalid'};
  const read=()=>JSON.parse(sqlite.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
  const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
  const RealDate=globalThis.Date, nativeFetch=globalThis.fetch;
  let clock='2026-09-25T10:00:00.000Z';
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return RealDate.parse(clock);}};
  const sent=[];
  const mockTelegram=async(url,options)=>{assert.equal(String(url),'https://api.telegram.org/botlocal-vegetable-test-token/sendMessage');sent.push(JSON.parse(options.body));return Response.json({ok:true,result:{message_id:sent.length}});};
  try {
    for(const body of [undefined,{action:'configure',inventoryId:'c',enabled:true},{action:'norm',normPct:7},{action:'notify'}]) assert.equal((await call('/api/vegetable-expenses',body)).status,401);
    assert.equal((await call('/api/worker-auth?bootstrap=1')).status,200);
    const start=read(), original={...start,vegetableExpenseVersion:undefined,inventoryAccountingVersion:1,
      inventory:[{id:'c',name:'KARAM',unit:'g',stock:-500,minStock:10,unitCost:2,packageName:'kalla',unitsPerPackage:1,packageCost:2,categoryId:'inventory-other'},{id:'m',name:"QO'Y GO'SHT",unit:'g',stock:1000,minStock:100,unitCost:20,unitsPerPackage:1000,packageCost:20000,packageName:'kg',categoryId:'inventory-other'},{id:'b',name:'NON',unit:'dona',stock:10,minStock:1,unitCost:500,unitsPerPackage:1,packageCost:500,packageName:'dona',categoryId:'inventory-other'}],
      recipes:[{id:'r',name:'Taom',salePrice:10000,categoryId:'recipe-other',ingredients:[{id:'ic',inventoryId:'c',quantity:100,unit:'g',name:'KARAM'},{id:'im',inventoryId:'m',quantity:50,unit:'g',name:"QO'Y GO'SHT"},{id:'ib',inventoryId:'b',quantity:1,unit:'dona',name:'NON'}]}],
      suppliers:[{id:'nodir',name:'Nodir aka',openingBalance:948000,balance:948000}],transactions:[],sales:[{id:'old-sale',date:'2026-09-01',quantity:1,totalRevenue:5000,totalCost:1000}],stockMovements:[{id:'old-move',inventoryId:'c',type:'sale',quantity:-50,date:'2026-09-01'}],financialEntries:[],deletedItems:[],posOrders:[],costRules:{taxPct:0,cardCommissionPct:0,deliveryCommissionPct:0},customData:{keep:'unchanged'}};
    sqlite.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(original),'test-start','main');
    let response=await call('/api/vegetable-expenses?period=day&date=2026-09-25',undefined,owner);assert.equal(response.status,200,await response.clone().text());
    const initial=read();assert.deepEqual(initial.sales,original.sales);assert.deepEqual(initial.stockMovements,original.stockMovements);assert.deepEqual(initial.suppliers,original.suppliers);assert.deepEqual(initial.customData,original.customData);assert.equal(initial.inventory[0].stock,-500);assert.equal(initial.inventory[0].expenseOnly,true);assert.equal(initial.inventory.filter(i=>i.name==='상추').length,1);
    assert.equal((await call('/api/vegetable-expenses?date=2026-02-30',undefined,owner)).status,400);
    const purchase={inventoryOnly:true,operationId:'aaaaaaaa-bbbb-cccc-dddd-000000000099',vegetableOnly:true,date:'2026-09-25',lines:[{name:'KARAM',quantity:2,unit:'kg',amount:6000}]};
    response=await call('/api/intake',purchase,owner);assert.equal(response.status,200,await response.clone().text());
    response=await call('/api/intake',purchase,owner);assert.equal(response.status,200);assert.equal((await response.json()).alreadySaved,true);
    const bought=read();assert.equal(bought.vegetablePurchases.length,1);assert.equal(bought.financialEntries.filter(e=>e.category==='Sabzavot va sous').length,1);assert.equal(bought.suppliers[0].balance,948000);assert.deepEqual(bought.transactions,original.transactions);assert.equal(bought.inventory[0].stock,-500);assert.equal(bought.inventory[0].unitCost,3);
    response=await call('/api/pos-terminal',{operationId:'vegetable-local-sale-1',branchId:'main',paymentType:'cash',items:[{recipeId:'r',quantity:1}]},owner);assert.equal(response.status,200,await response.clone().text());
    const sold=read(), sale=sold.sales.find(s=>s.id!=='old-sale');assert.equal(sale.totalCost,1800);assert.equal(sale.expenseOnlyCost,300);assert.equal(sold.inventory[0].stock,-500);assert.equal(sold.inventory[1].stock,950);assert.equal(sold.inventory[2].stock,9);assert.deepEqual(sold.sales.find(s=>s.id==='old-sale'),original.sales[0]);assert.deepEqual(sold.stockMovements.find(m=>m.id==='old-move'),original.stockMovements[0]);
    response=await call('/api/vegetable-expenses?period=day&date=2026-09-25',undefined,owner);const report=(await response.json()).report;assert.equal(report.expense,6000);assert.equal(report.revenue,10000);assert.equal(report.ratio,60);assert.equal(report.purchases[0].recordedBy,'Rahbar');
    sqlite.prepare('INSERT INTO halo_worker_users (id,branch_id,name,username,pin_hash) VALUES (?,?,?,?,?)').run('worker-test','main','Ali','ali',await sha('main:ali:1234'));
    response=await call('/api/worker-auth',{action:'login',branchId:'main',username:'ali',pin:'1234'});assert.equal(response.status,200);const cookie={Cookie:response.headers.get('set-cookie').split(';')[0]};
    assert.equal((await call('/api/vegetable-expenses',{action:'configure',inventoryId:'c',enabled:false},cookie)).status,401);
    response=await call('/api/inventory-accounting?portal=worker&branch=other',undefined,cookie);assert.equal(response.status,200);const countView=await response.json();assert.equal(countView.inventory.some(i=>i.id==='c'),false);assert.equal(countView.inventory.some(i=>i.id==='m'),true);
    assert.equal((await call('/api/inventory-accounting?portal=worker',{action:'count',operationId:'forbidden-veg-count',counts:[{inventoryId:'c',actualStock:100}]},cookie)).status,400);
    assert.equal((await call('/api/vegetable-expenses',{action:'norm',normPct:''},owner)).status,400);
    assert.equal((await call('/api/vegetable-expenses',{action:'norm',normPct:7},owner)).status,200);
    response=await call('/api/vegetable-expenses',{action:'configure',inventoryId:'c',enabled:false},owner);assert.equal(response.status,200);assert.equal(read().inventory[0].expenseOnly,false);assert.equal(read().vegetablePurchases.length,1);assert.equal(read().stockMovements.find(m=>m.id==='old-move').quantity,-50);
    // The existing authenticated Sheets timer is the scheduler. Before 09:00 no message; after, one daily combined digest to the configured owner.
    const token='halo_live_local_vegetable_test_0123456789';
    sqlite.prepare('UPDATE integration_settings SET enabled=1 WHERE id=?').run('main');
    sqlite.prepare('INSERT INTO integration_api_keys (id,branch_id,name,key_prefix,key_hash,permissions,active,last_used_at,created_at,revoked_at) VALUES (?,?,?,?,?,?,1,?,?,?)').run('sheets-test','main','Test Sheets','halo_live_local',await sha(token),'["reports:read"]','','2026-09-25T00:00:00Z','');
    sqlite.exec('CREATE TABLE IF NOT EXISTS telegram_settings (id TEXT PRIMARY KEY, bot_token TEXT, chat_id TEXT, enabled INTEGER DEFAULT 1)');
    sqlite.prepare('INSERT OR REPLACE INTO telegram_settings (id,bot_token,chat_id) VALUES (?,?,?)').run('main','local-vegetable-test-token','local-test-owner');
    // vinext installs its fetch wrapper on the first request, so stub after bootstrap.
    globalThis.fetch=mockTelegram;
    buildGoogleSheetsExport(read(),'2026-09-01','2026-09-30');
    clock='2026-09-27T23:59:00Z';
    response=await call('/api/integrations/v1/google-sheets?from=2026-09-01&to=2026-09-30',undefined,{Authorization:`Bearer ${token}`});assert.equal(response.status,200,await response.clone().text());assert.equal(sent.length,0);
    clock='2026-09-28T00:00:00Z';
    response=await call('/api/integrations/v1/google-sheets?from=2026-09-01&to=2026-09-30',undefined,{Authorization:`Bearer ${token}`});assert.equal(response.status,200,await response.clone().text());const exported=await response.json();
    assert.equal(sent.length,1);assert.equal(sent[0].chat_id,'local-test-owner');assert.match(sent[0].text,/6,000₩/);assert.match(sent[0].text,/10,000₩/);assert.match(sent[0].text,/60\.00%/);assert.match(sent[0].text,/KARAM/);
    response=await call(`/api/integrations/v1/google-sheets?from=2026-09-01&to=2026-09-30&if_updated_at=${encodeURIComponent(exported.updatedAt)}&if_export_version=3.1`,undefined,{Authorization:`Bearer ${token}`});assert.equal(response.status,200);assert.equal(sent.length,1);assert.equal((await response.json()).unchanged,true);
    const tab=exported.sheets.find(s=>s.name==='HALO SABZAVOT SARFI');assert.deepEqual(tab.rows,[['2026-09-25','KARAM','2 kg',6000,'']]);
    assert.ok(sqlite.prepare('SELECT COUNT(*) AS n FROM halo_state_backups').get().n>0);
    assert.equal(read().businessTrendNotifications.filter(n=>n.status==='sent').length,1);assert.deepEqual(read().vegetableNotifications,initial.vegetableNotifications);
  } finally { globalThis.Date=RealDate;globalThis.fetch=nativeFetch;sqlite.close();delete globalThis.__HALO_CONTROL_DB__; }
});
