import { isAdminRequest } from '../../lib/integration-store';
import { AssistantError } from '../../lib/assistant-engine';
import { activeBranch, assistantDb, decideCommand, getAssistantConfig, getJob, hashSecret, prepareCommand, publicJob, telegramApi } from '../../lib/assistant-store';
const ORIGIN='https://halo-control.uzbusinessman7.chatgpt.site';
const WEBHOOK=`${ORIGIN}/api/assistant/telegram`;
export async function GET(request:Request){
 if(!await isAdminRequest(request))return Response.json({error:'Kirish taqiqlangan.'},{status:401});
 try{
  const c=await getAssistantConfig();const branch=new URL(request.url).searchParams.get('branch')||'main';await activeBranch(branch);
  const actor=`web:${request.headers.get('oai-authenticated-user-email')!.toLowerCase()}`;
  const recent=await assistantDb().prepare('SELECT * FROM halo_assistant_jobs WHERE actor=? AND branch_id=? ORDER BY created_at DESC LIMIT 10').bind(actor,branch).all<any>();
  return Response.json({ok:true,aiReady:Boolean(globalThis.__HALO_ASSISTANT_AI__?.key),telegram:c?{botName:c.bot_name,branchId:c.branch_id,enabled:Boolean(c.enabled),ownerId:c.owner_id,candidateId:c.candidate_id,candidateName:c.candidate_name}:null,history:(recent.results||[]).map(publicJob)});
 }catch{return Response.json({error:'Yordamchi ma’lumotlari yuklanmadi.'},{status:503});}
}
export async function POST(request:Request){
 if(!await isAdminRequest(request))return Response.json({error:'Kirish taqiqlangan.'},{status:401});
 if(Number(request.headers.get('content-length')||0)>20000)return Response.json({error:'So‘rov juda katta.'},{status:413});
 try{
  const raw=await request.text();if(raw.length>20000)throw new AssistantError('So‘rov juda katta.');const b=JSON.parse(raw);
  const branch=String(b.branchId||'main');await activeBranch(branch);
  const actor=`web:${request.headers.get('oai-authenticated-user-email')!.toLowerCase()}`;
  if(b.action==='ask'){
   if(!/^[a-f0-9-]{36}$/.test(String(b.requestId)))throw new AssistantError('Buyruq raqami noto‘g‘ri.');
   const job=await prepareCommand(branch,actor,'web',`web:${branch}:${b.requestId}`,String(b.text||''),String(b.previousId||''));return Response.json({ok:true,job:publicJob(job)});
  }
  if(b.action==='confirm'||b.action==='cancel')return Response.json({ok:true,job:publicJob(await decideCommand(String(b.id),actor,branch,'web',b.action==='confirm'))});
  if(b.action==='job'){
   const job=await getJob(String(b.id));if(!job||job.actor!==actor||job.branch_id!==branch)throw new AssistantError('Buyruq topilmadi.');return Response.json({ok:true,job:publicJob(job)});
  }
  const db=assistantDb();const c=await getAssistantConfig();
  if(b.action==='setup'){
   const token=String(b.botToken||'').trim();if(!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token))throw new AssistantError('BotFather bergan bot tokenini tekshiring.');
   if(c&&c.bot_token!==token)throw new AssistantError('Avval hozirgi yordamchi botni uzing.');
   const oldTable=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_settings'").first();
   const old=oldTable?await db.prepare('SELECT bot_token FROM telegram_settings WHERE id=?').bind('main').first<{bot_token:string}>():null;
   if(old?.bot_token?.split(':')[0]===token.split(':')[0])throw new AssistantError('Bu hisobotlar botining tokeni. Yordamchi uchun BotFather orqali alohida bot yarating.');
   const me=await telegramApi(token,'getMe',{});const hook=await telegramApi(token,'getWebhookInfo',{});
   if(hook.url&&hook.url!==WEBHOOK)throw new AssistantError('Bu bot boshqa tizimga ulangan. Yordamchi uchun yangi bot yarating.');
   const generation=crypto.randomUUID(),secret=crypto.randomUUID()+crypto.randomUUID();
   await db.prepare("INSERT INTO halo_assistant_config (id,branch_id,bot_token,bot_name,secret,generation) VALUES ('main',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET branch_id=excluded.branch_id,bot_token=excluded.bot_token,bot_name=excluded.bot_name,secret=excluded.secret,generation=excluded.generation,owner_id='',candidate_id='',candidate_name='',pair_hash='',pair_expires=0,enabled=0").bind(branch,token,me.username,secret,generation).run();
   await telegramApi(token,'setWebhook',{url:WEBHOOK,secret_token:secret,allowed_updates:['message','callback_query'],max_connections:1});
   return Response.json({ok:true,message:'Bot tayyor. Endi Telegram akkauntingizni bog‘lang.'});
  }
  if(!c)throw new AssistantError('Avval yordamchi botni sozlang.');
  if(b.action==='retryWebhook'){
   const hook=await telegramApi(c.bot_token,'getWebhookInfo',{});
   if(hook.url&&hook.url!==WEBHOOK)throw new AssistantError('Bot boshqa tizimga ulangan. Avval o‘sha ulanishni tekshiring.');
   await telegramApi(c.bot_token,'setWebhook',{url:WEBHOOK,secret_token:c.secret,allowed_updates:['message','callback_query'],max_connections:1});
   return Response.json({ok:true,message:'Bot ulanishi tiklandi.'});
  }
  if(b.action==='pair'){
   const code=crypto.randomUUID().replace(/-/g,'');
   await db.prepare("UPDATE halo_assistant_config SET pair_hash=?,pair_expires=?,candidate_id='',candidate_name='',owner_id='',enabled=0,generation=? WHERE id='main'").bind(await hashSecret(code),Date.now()+600000,crypto.randomUUID()).run();
   return Response.json({ok:true,link:`https://t.me/${c.bot_name}?start=${code}`,message:'Havolani o‘z Telegram akkauntingizda ochib Start bosing. Keyin shu yerga qaytib akkauntni tasdiqlang. Havola 10 daqiqa amal qiladi.'});
  }
  if(b.action==='activate'){
   if(!c.candidate_id||b.candidateId!==c.candidate_id||c.pair_expires<Date.now())throw new AssistantError('Telegram akkauntingizni qayta bog‘lang.');
   const result=await db.prepare("UPDATE halo_assistant_config SET owner_id=candidate_id,enabled=1,pair_hash='',pair_expires=0,candidate_id='',candidate_name='' WHERE id='main' AND candidate_id=? AND generation=?").bind(c.candidate_id,c.generation).run();
   if(!result.meta.changes)throw new AssistantError('Ulanish o‘zgargan. Yangilang.');return Response.json({ok:true,message:'Telegram akkauntingiz tasdiqlandi. Botga buyruq yuborishingiz mumkin.'});
  }
  if(b.action==='disconnect'){
   await db.prepare("UPDATE halo_assistant_config SET enabled=0,owner_id='',pair_hash='',candidate_id='',generation=? WHERE id='main'").bind(crypto.randomUUID()).run();
   await telegramApi(c.bot_token,'deleteWebhook',{drop_pending_updates:false});
   await db.prepare("DELETE FROM halo_assistant_config WHERE id='main'").run();
   return Response.json({ok:true,message:'Yordamchi bot uzildi. Hisob yozuvlari saqlandi.'});
  }
  throw new AssistantError('Amal topilmadi.');
 }catch(e){return Response.json({error:e instanceof AssistantError?e.message:'Yordamchi amalni yakunlay olmadi. Sozlamani tekshirib qayta urinib ko‘ring.'},{status:e instanceof AssistantError?400:503});}
}
