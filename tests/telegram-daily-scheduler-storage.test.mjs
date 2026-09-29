import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('closed-browser Sheets timer: catch-up, race safety, permissions, uncertain delivery and unchanged business history', async () => {
  const sql=new DatabaseSync(':memory:');
  const db={prepare(query){let values=[];return{bind(...v){values=v;return this;},async first(column){const r=sql.prepare(query).get(...values);return column?r?.[column]??null:r??null;},async all(){return{results:sql.prepare(query).all(...values)};},async run(){return{meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(q){const out=[];for(const s of q)out.push(await s.run());return out;},async exec(s){sql.exec(s);return{count:1,duration:0};}};
  const {default:worker}=await import('../dist/server/index.js');
  const env={DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}},owner={'oai-authenticated-user-email':'owner@scheduler-test.invalid'};
  const call=(path,body,headers={})=>worker.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(){},passThroughOnException(){}});
  const sha=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
  const RealDate=globalThis.Date,nativeFetch=globalThis.fetch;
  let clock='2026-09-27T15:00:00Z';
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return RealDate.parse(clock);}};
  const sent=[]; let behavior='success';
  try {
    await call('/api/worker-auth?bootstrap=1',undefined,owner);
    sql.exec(readFileSync(new URL('../drizzle/0013_cool_surge.sql',import.meta.url),'utf8'));
    // Initialize existing Telegram settings without sending anything.
    assert.equal((await call('/api/telegram',undefined,owner)).status,200);
    sql.prepare("INSERT INTO telegram_settings (id,bot_token,chat_id,bot_name,enabled,report_time) VALUES ('main','test-scheduler','owner-chat','test',1,'23:59')").run();
    const base=JSON.parse(sql.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload);
    const state={...base,vegetableExpenseVersion:1,inventory:[{id:'bread',name:'Non',stock:0,minStock:10,unit:'dona',unitCost:100,supplierId:'n'}],suppliers:[{id:'n',name:'Nodir',balance:198000,autoOrder:true,telegramChatId:'supplier-must-not-receive'}],sales:[{id:'s',date:'2026-09-27',recipeId:'r',quantity:1,totalRevenue:100000,totalCost:1000,accountId:'cash'}],recipes:[{id:'r',name:'Taom',ingredients:[{inventoryId:'bread',quantity:1}]}],accounts:[{id:'cash',name:'Kassa',openingBalance:0}],financialEntries:[{id:'noncash',date:'2026-09-27',type:'expense',amount:198000,nonCash:true,accountId:'',category:'Sabzavot va sous'}],transactions:[],stockMovements:[],fixedExpenses:[],workShifts:[],staff:[],vegetablePurchases:[],monthlyCloses:[]};
    sql.prepare("UPDATE app_state SET payload=?,updated_at='scheduler-seed' WHERE id='main'").run(JSON.stringify(state));
    sql.prepare("UPDATE integration_settings SET enabled=1 WHERE id='main'").run();
    const token='halo_live_scheduler_local_test';
    sql.prepare("INSERT INTO integration_api_keys (id,branch_id,name,key_prefix,key_hash,permissions,active,created_at) VALUES ('scheduler-key','main','test','halo_live',?,'[\"reports:read\"]',1,?)").run(await sha(token),clock);
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),'https://api.telegram.org/bottest-scheduler/sendMessage');
      const message=JSON.parse(options.body);assert.equal(message.chat_id,'owner-chat');sent.push(message);
      if(behavior==='timeout')throw new DOMException('mock timeout','TimeoutError');
      if(behavior==='reject')return Response.json({ok:false},{status:403});
      return Response.json({ok:true,result:{message_id:sent.length}});
    };
    const headers={Authorization:`Bearer ${token}`};
    const exportPath='/api/integrations/v1/google-sheets?from=2026-09-01&to=2026-09-30';
    assert.equal((await call(exportPath)).status,401);assert.equal(sent.length,0);
    let response=await call(exportPath,undefined,headers);assert.equal(response.status,200,await response.clone().text());const exported=await response.json();
    assert.equal(sent.length,1);assert.match(sent[0].text,/27\.09\.2026/);assert.match(sent[0].text,/Jami pul: ₩100,000/);assert.ok(sent[0].text.length<=4096);
    const unchanged=`${exportPath}&if_updated_at=${encodeURIComponent(exported.updatedAt)}&if_export_version=${exported.exportVersion}`;
    response=await call(unchanged,undefined,headers);assert.equal((await response.json()).unchanged,true);assert.equal(sent.length,1);
    clock='2026-09-28T15:00:00Z';
    await Promise.all([call(exportPath,undefined,headers),call('/api/telegram',{action:'auto'},owner),call(exportPath,undefined,headers)]);
    assert.equal(sent.length,2);assert.equal(sql.prepare("SELECT status FROM telegram_daily_deliveries WHERE report_date='2026-09-28'").get().status,'sent');
    // Legacy checkpoint survives deployment and prevents resending.
    clock='2026-09-29T15:00:00Z';sql.prepare("UPDATE telegram_branch_status SET last_sent_date='2026-09-29' WHERE branch_id='main'").run();
    await call(exportPath,undefined,headers);assert.equal(sent.length,2);
    clock='2026-09-30T15:00:00Z';behavior='timeout';await call(exportPath,undefined,headers);await call(exportPath,undefined,headers);
    assert.equal(sent.length,3);assert.equal(sql.prepare("SELECT status FROM telegram_daily_deliveries WHERE report_date='2026-09-30'").get().status,'uncertain');
    response=await call('/api/telegram',undefined,owner);assert.match((await response.json()).deliveryStatus.last_error,/tekshiring/);
    clock='2026-10-01T15:00:00Z';behavior='reject';await call(exportPath,undefined,headers);assert.equal(sql.prepare("SELECT status FROM telegram_daily_deliveries WHERE report_date='2026-10-01'").get().status,'failed');
    const beforeDisabled=sent.length;
    clock='2026-10-02T15:00:00Z';sql.prepare("UPDATE telegram_settings SET enabled=0 WHERE id='main'").run();await call(exportPath,undefined,headers);assert.equal(sent.length,beforeDisabled);
    sql.prepare("UPDATE telegram_settings SET enabled=1 WHERE id='main'").run();sql.prepare("UPDATE integration_api_keys SET active=0 WHERE id='scheduler-key'").run();
    assert.equal((await call(exportPath,undefined,headers)).status,401);assert.equal(sent.length,beforeDisabled);
    const after=JSON.parse(sql.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload);
    for(const key of ['sales','financialEntries','inventory','transactions','stockMovements','suppliers','staff','fixedExpenses'])assert.deepEqual(after[key],state[key],key);
  } finally {globalThis.Date=RealDate;globalThis.fetch=nativeFetch;sql.close();delete globalThis.__HALO_CONTROL_DB__;}
});
