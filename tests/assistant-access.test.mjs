import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// The app bundler resolves extensionless TypeScript imports; match that only
// for these server-route tests without running any external API.
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}}});
const {POST:webhook}=await import('../app/api/assistant/telegram/route.ts');
const {POST:ownerApi}=await import('../app/api/assistant/route.ts');
const {decideCommand}=await import('../app/lib/assistant-store.ts');
const config={secret:'test-secret',owner_id:'123',enabled:1,generation:'generation',branch_id:'main'};
let writes=0,sends=0;
const realFetch=globalThis.fetch;
globalThis.fetch=async()=>{sends++;throw new Error('External fetch forbidden in access test');};
test.after(()=>{globalThis.fetch=realFetch;});
function stub(row){writes=0;sends=0;globalThis.__HALO_CONTROL_DB__={prepare(){return {bind(){return this;},async first(){return row;},async run(){writes++;return {meta:{changes:1}};}};}};}
const request=(update,secret='test-secret')=>new Request('https://halo.test/api/assistant/telegram',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(update)});
const message=(from=123,type='private')=>({update_id:5,message:{message_id:7,from:{id:from},chat:{id:from,type},text:'Hisobot'}});
test('webhook rejects forged secret before processing a command',async()=>{stub(config);assert.equal((await webhook(request(message(),'wrong'))).status,403);assert.equal(writes,0);assert.equal(sends,0);});
test('outsiders, groups, disabled and unconfirmed accounts cannot read or write',async()=>{
 for(const [c,u] of [[config,message(999)],[config,message(123,'group')],[{...config,enabled:0},message()],[{...config,owner_id:'',candidate_id:'123'},message()]]){stub(c);assert.equal((await webhook(request(u))).status,200);assert.equal(writes,0);assert.equal(sends,0);}
});
test('anonymous website cannot ask, configure, or confirm',async()=>{for(const action of ['ask','setup','activate','confirm']){stub(config);const r=await ownerApi(new Request('https://halo.test/api/assistant',{method:'POST',body:JSON.stringify({action})}));assert.equal(r.status,401);assert.equal(writes,0);}});
test('confirmation is bound to actor, branch and bot generation',async()=>{
 const job={id:'test',actor:'tg:123',branch_id:'main',generation:'generation',status:'ready'};
 for(const args of [['test','tg:999','main','generation',true],['test','tg:123','other','generation',true],['test','tg:123','main','old-generation',true]]){stub(job);await assert.rejects(decideCommand(...args),/ruxsat/);assert.equal(writes,0);}
});
test('pairing accepts a copied command but grants no account access before owner confirmation',async()=>{
 const {hashSecret}=await import('../app/lib/assistant-store.ts');
 const code='a'.repeat(32);
 stub({...config,enabled:0,owner_id:'',pair_hash:await hashSecret(code),pair_expires:Date.now()+60000});
 globalThis.fetch=async()=>{sends++;return Response.json({ok:true,result:{}});};
 const update=message();update.message.text=' /start@HaloBot   '+code+'\n';
 assert.equal((await webhook(request(update))).status,200);
 assert.equal(writes,1);assert.equal(sends,1);
});
test('expired pairing and plain start explain next step without changing account access',async()=>{
 for(const text of ['/start','/start '+'b'.repeat(32)]){
  stub({...config,enabled:0,owner_id:'',pair_hash:'expired',pair_expires:0});
  globalThis.fetch=async()=>{sends++;return Response.json({ok:true,result:{}});};
  const update=message();update.message.text=text;
  assert.equal((await webhook(request(update))).status,200);
  assert.equal(writes,0);assert.equal(sends,1);
 }
});
test('export and balance-edit routes require owner access',async()=>{
 const {GET:download}=await import('../app/api/report-export/route.ts');
 const {POST:edit}=await import('../app/api/supplier-records/route.ts');
 stub(config);
 assert.equal((await download(new Request('https://halo.test/api/report-export?kind=suppliers'))).status,401);
 assert.equal((await edit(new Request('https://halo.test/api/supplier-records',{method:'POST',body:JSON.stringify({action:'editBalance'})}))).status,401);
 assert.equal(writes,0);
 for(const who of [999]) {stub(config);const u=message(who);u.message.text='Eksport qarzlar';assert.equal((await webhook(request(u))).status,200);assert.equal(sends,0);}
});
