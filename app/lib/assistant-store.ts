import { listHaloBranches, mutateHaloState, readHaloState } from './halo-store';
import { understandCommand } from './assistant-ai';
import { AssistantError, assistantReport, buildAssistantPlan, executeAssistantPlan, stateFingerprint } from './assistant-engine';
import { conversationContext } from './assistant-context';
import { IntakeError } from './unified-intake';

export const assistantDb=()=>{const db=globalThis.__HALO_CONTROL_DB__;if(!db)throw new Error('Database unavailable');return db;};
export type AssistantConfig={id:string;branch_id:string;bot_token:string;bot_name:string;secret:string;generation:string;pair_hash:string;pair_expires:number;candidate_id:string;candidate_name:string;owner_id:string;enabled:number};
export type AssistantJob={id:string;source_key:string;branch_id:string;actor:string;generation:string;input:string;status:string;payload:string;response:string;created_at:number;updated_at:number;sent:number};
export const getAssistantConfig=()=>assistantDb().prepare('SELECT * FROM halo_assistant_config WHERE id = ?').bind('main').first<AssistantConfig>();
export const getJob=(id:string)=>assistantDb().prepare('SELECT * FROM halo_assistant_jobs WHERE id = ?').bind(id).first<AssistantJob>();
export const publicJob=(job:AssistantJob)=>({id:job.id,status:job.status,text:job.response,createdAt:job.created_at});
export async function activeBranch(id:string){if(!(await listHaloBranches()).some(b=>b.id===id))throw new AssistantError('Faol filial topilmadi.');}
export async function hashSecret(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function telegramApi(token:string,method:string,body:unknown){
 const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const data=await r.json() as any;if(!r.ok||!data.ok)throw new AssistantError('Telegram ulanishi bajarilmadi. Bot sozlamasini tekshiring.');return data.result;
}
export async function prepareCommand(branch:string,actor:string,generation:string,key:string,input:string,previousId?:string){
 await activeBranch(branch);
 if(!input.trim()||input.length>5000)throw new AssistantError('1–5000 belgili buyruq yozing.');
 const db=assistantDb();const now=Date.now();
 let job=await db.prepare('SELECT * FROM halo_assistant_jobs WHERE source_key = ?').bind(key).first<AssistantJob>();
 if(job&&(job.actor!==actor||job.branch_id!==branch||job.generation!==generation||job.input!==input))throw new AssistantError('Buyruq raqami mos emas. Yangidan yuboring.');
 if(job&&job.status!=='processing')return job;
 if(job&&job.updated_at>now-60000)throw new AssistantError('Buyruq hali tayyorlanmoqda. Bir ozdan qayta tekshiring.');
 if(!job){
  const recent=await db.prepare('SELECT COUNT(*) AS n FROM halo_assistant_jobs WHERE actor = ? AND created_at > ?').bind(actor,now-600000).first<{n:number}>();
  if((recent?.n||0)>=30)throw new AssistantError('10 daqiqada 30 ta buyruq chegarasi. Bir ozdan qayta urinib ko‘ring.');
  const id=crypto.randomUUID();
  const inserted=await db.prepare('INSERT OR IGNORE INTO halo_assistant_jobs (id,source_key,branch_id,actor,generation,input,status,created_at,updated_at) VALUES (?,?,?,?,?,?,\'processing\',?,?)').bind(id,key,branch,actor,generation,input,now,now).run();
  if(!inserted.meta.changes)throw new AssistantError('Bu buyruq tayyorlanmoqda. Bir ozdan qayta tekshiring.');
  job=(await getJob(id))!;
 }else{
  const claimed=await db.prepare("UPDATE halo_assistant_jobs SET updated_at = ? WHERE id = ? AND status = 'processing' AND updated_at = ?").bind(now,job.id,job.updated_at).run();
  if(!claimed.meta.changes)throw new AssistantError('Buyruq boshqa so‘rovda tayyorlanmoqda.');
 }
 let status='read',payload='',response='';
 try{
  const current=await readHaloState(branch);
  const recent=await db.prepare('SELECT * FROM halo_assistant_jobs WHERE actor=? AND branch_id=? AND generation=? AND created_at>? AND id<>? ORDER BY created_at DESC LIMIT 6').bind(actor,branch,generation,now-1800000,job.id).all<AssistantJob>();
  const history=conversationContext(recent.results||[],{actor,branch,generation,now,currentId:job.id});
  const intent=await understandCommand(input,current.state,JSON.stringify(history));
  response=assistantReport(current.state,intent);
  if(!response){
   const plan=buildAssistantPlan(current.state,intent,job.id);
   if(plan.summary.length>3200)throw new AssistantError('Bu kirim uzun. 15 tagacha mahsulotdan iborat qismlarga ajrating.');
   payload=JSON.stringify({plan,fingerprint:await stateFingerprint(current.state)});
   response=plan.summary+'\n\nTekshiring. «Tasdiqlash» bosilmaguncha hisobga yozilmaydi. Tasdiq 15 daqiqa amal qiladi.';status='ready';
  }
 }catch(e){status='error';response=e instanceof AssistantError||e instanceof IntakeError?e.message:'Buyruq tayyorlanmadi. Hech narsa saqlanmadi. Qayta urinib ko‘ring.';}
 await db.prepare("UPDATE halo_assistant_jobs SET status=?,payload=?,response=?,updated_at=? WHERE id=? AND status='processing' AND updated_at=?").bind(status,payload,response,Date.now(),job.id,now).run();
 return (await getJob(job.id))!;
}
export async function decideCommand(id:string,actor:string,branch:string,generation:string,confirm:boolean){
 const db=assistantDb();let job=await getJob(id);const now=Date.now();
 if(!job||job.actor!==actor||job.branch_id!==branch||job.generation!==generation)throw new AssistantError('Bu buyruqqa ruxsat yo‘q.');
 if(['done','cancelled'].includes(job.status))return job;
 await activeBranch(branch);
 if(actor.startsWith('tg:')){const config=await getAssistantConfig();if(!config?.enabled||config.generation!==generation||`tg:${config.owner_id}`!==actor)throw new AssistantError('Telegram ruxsati bekor qilingan.');}
 if(!confirm){
  await db.prepare("UPDATE halo_assistant_jobs SET status='cancelled',response='Bekor qilindi. Hisobga yozilmadi.',updated_at=? WHERE id=? AND status='ready'").bind(now,id).run();
  job=(await getJob(id))!;if(job.status!=='cancelled')throw new AssistantError('Amal bajarilmoqda yoki yakunlangan. Tarixni tekshiring.');return job;
 }
 if(job.status==='ready'&&job.created_at<now-900000)throw new AssistantError('Tasdiq muddati tugagan. Buyruqni qayta yuboring.');
 if(job.status!=='ready'&&!(job.status==='executing'&&job.updated_at<now-60000))throw new AssistantError('Bu buyruq bajarilmoqda yoki tasdiqlashga tayyor emas. Tarixni tekshiring.');
 const claimed=await db.prepare('UPDATE halo_assistant_jobs SET status=\'executing\',updated_at=? WHERE id=? AND status=? AND updated_at=?').bind(now,id,job.status,job.updated_at).run();
 if(!claimed.meta.changes)throw new AssistantError('Bu amal boshqa so‘rovda bajarilmoqda.');
 try{
  const {plan,fingerprint}=JSON.parse(job.payload);
  const result=await mutateHaloState(async state=>executeAssistantPlan(state,plan,id,fingerprint),7,branch,'Rahbar · HALO yordamchi',plan.kind==='warehousePurchase'?'Tasdiqlangan ombor kirimi':'Tasdiqlangan qarz to‘lovi','HALO yordamchi',true);
  await db.prepare("UPDATE halo_assistant_jobs SET status='done',response=?,updated_at=? WHERE id=? AND status='executing'").bind(result.result.message,Date.now(),id).run();
 }catch(e){
  // A transport failure may happen after the atomic state commit. Retrying the
  // same immutable plan uses its durable receipt and never pays twice.
  if(e instanceof AssistantError||e instanceof IntakeError){await db.prepare("UPDATE halo_assistant_jobs SET status='error',response=?,updated_at=? WHERE id=? AND status='executing'").bind(e.message,Date.now(),id).run();}
  else throw new AssistantError('Natijani tekshirish tugamadi. 1 daqiqadan so‘ng shu tasdiqni qayta bosing; yangi buyruq yubormang.');
 }
 return (await getJob(id))!;
}
