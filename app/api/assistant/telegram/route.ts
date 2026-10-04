import { readHaloState } from '../../../lib/halo-store';
import { buildReportExport, exportKinds, validateExport } from '../../../lib/report-export';
import { AssistantError } from '../../../lib/assistant-engine';
import { assistantDb, decideCommand, getAssistantConfig, hashSecret, prepareCommand, telegramApi } from '../../../lib/assistant-store';
import { handleBotUpdate } from '../../../core/bot';
declare global { var __HALO_SELF_HOSTED__: boolean | undefined; }
export async function POST(request:Request){
 try{
  const c=await getAssistantConfig();const secret=request.headers.get('x-telegram-bot-api-secret-token')||'';
  if(!c||!secret||await hashSecret(secret)!==await hashSecret(c.secret))return new Response('Forbidden',{status:403});
  if(Number(request.headers.get('content-length')||0)>100000)return new Response('Too large',{status:413});
  const raw=await request.text();if(raw.length>100000)return new Response('Too large',{status:413});const u=JSON.parse(raw);
  if(!Number.isSafeInteger(u.update_id))return new Response('Bad update',{status:400});
  const m=u.message||u.callback_query?.message;const from=u.callback_query?.from||u.message?.from;
  if(!m||m.chat?.type!=='private'||from?.is_bot||!Number.isSafeInteger(from?.id)||String(m.chat.id)!==String(from.id))return Response.json({ok:true});
  const chat=String(from.id);const text=String(m.text||'').trim();const db=assistantDb();
  const send=(text:string,extra:Record<string,unknown>={})=>telegramApi(c.bot_token,'sendMessage',{chat_id:chat,text,...extra});
  // Yo'riqnoma matnida ulash oynasining joyi: yangi saytda «Ulanishlar → Yordamchi bot», eski sahifada «HALO yordamchi».
  const where=globalThis.__HALO_SELF_HOSTED__===true?'HALO Control → ⋯ → Ulanishlar → Yordamchi bot':'HALO Control → HALO yordamchi';
  const pairCommand=text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([a-f0-9]{32})$/i);
  if(u.message&&pairCommand){
   const hash=await hashSecret(pairCommand[1].toLowerCase());
   if(c.pair_hash===hash&&c.pair_expires>Date.now()){
    const claimed=await db.prepare("UPDATE halo_assistant_config SET candidate_id=?,candidate_name=?,pair_hash='' WHERE id='main' AND pair_hash=? AND pair_expires>?").bind(chat,[from.first_name,from.last_name,from.username?`@${from.username}`:''].filter(Boolean).join(' ').slice(0,150),hash,Date.now()).run();
    if(claimed.meta.changes)await send(where+' oynasiga qaytib, akkauntingizni tasdiqlang. Hozircha hisoblar ochilmagan.');
   }else{await send('Bu bog‘lash havolasi eskirgan yoki yangisi yaratilgan. '+where+' oynasida «O‘z Telegramimni bog‘lash»ni bosing va eng oxirgi havolani oching yoki shu yerda ko‘rsatilgan /start buyrug‘ini to‘liq yuboring.');}
   return Response.json({ok:true});
  }
  if(u.message&&!c.enabled&&/^\/start(?:@[A-Za-z0-9_]+)?$/i.test(text)){await send('Akkaunt hali bog‘lanmagan. '+where+' → «O‘z Telegramimni bog‘lash»ni bosing. Chiqqan Telegram havolasini oching yoki bog‘lash buyrug‘ini to‘liq nusxalab shu botga yuboring. Keyin HALO’da akkauntingizni tasdiqlang.');return Response.json({ok:true});}
  if(!c.enabled||c.owner_id!==chat)return Response.json({ok:true});
  const actor=`tg:${chat}`;
  // Yangi sayt: tugmali ma'lumot va kiritmalar (AI kerak emas) — app/core/bot.ts. U javob bermagan buyruqlar
  // (Qarzlar, Ombor, Eksport, erkin matn, eski Tasdiqlash/Bekor tugmalari) pastdagi avvalgi yo'ldan o'tadi.
  if(globalThis.__HALO_SELF_HOSTED__===true&&await handleBotUpdate({config:c,chat,actor,text,update:u,api:(method,body)=>telegramApi(c.bot_token,method,body)}))return Response.json({ok:true});
  if(u.message && /^(?:eksport|export|\/export)(?:\s|$)/i.test(text)) {
   const parts=text.split(/\s+/);const aliases:Record<string,string>={qarzlar:'suppliers',tolovlar:'transactions',ombor:'inventory',kirimlar:'movements',savdo:'sales',xarajatlar:'expenses'};const kind=aliases[String(parts[1]||'').toLowerCase()]||parts[1];
   if(!kind){await send('Qaysi hisobot kerak? Tugmani bosing. Sana bilan olish: /export savdo 2026-09-01 2026-09-30. Sana yozilmasa barcha yozuvlar olinadi. Qarz va ombor qoldig‘i har doim hozirgi holatni ko‘rsatadi.',{reply_markup:{keyboard:Object.keys(aliases).map(k=>[{text:'Eksport '+k}]),resize_keyboard:true}});return Response.json({ok:true});}
   try {
    if(parts.length>4)throw new Error('Buyruq: /export turi YYYY-MM-DD YYYY-MM-DD');
    validateExport(kind,parts[2]||'',parts[3]||'');
    const current=await readHaloState(c.branch_id);
    const file=buildReportExport(current.state,kind,c.branch_id,parts[2]||'',parts[3]||'');
    const latest=await getAssistantConfig();
    if(!latest?.enabled||latest.owner_id!==chat||latest.generation!==c.generation||latest.branch_id!==c.branch_id)return Response.json({ok:true});
    const form=new FormData();form.set('chat_id',chat);form.set('caption',exportKinds[kind]+' · '+file.count+' ta yozuv. Excel / CSV.');form.set('document',new Blob([file.content],{type:'text/csv;charset=utf-8'}),file.filename);
    const reply=await fetch(`https://api.telegram.org/bot${c.bot_token}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(25000)});
    const result=await reply.json() as {ok?:boolean};if(!reply.ok||!result.ok)throw new Error('Fayl yuborilmadi. Qayta urinib ko‘ring.');
   } catch(e) {await send(e instanceof Error && /^(Hisobot|Sana|Boshlanish|Buyruq|Fayl)/.test(e.message)?e.message:'Hisobot tayyorlanmadi. Keyinroq qayta urinib ko‘ring.');}
   return Response.json({ok:true});
  }

  if(u.callback_query){
   const data=String(u.callback_query.data||'');if(!/^(ok|no):[a-f0-9-]{36}$/.test(data))return Response.json({ok:true});
   try{await telegramApi(c.bot_token,'answerCallbackQuery',{callback_query_id:u.callback_query.id});}catch{/* expired callback acknowledgement must not lose the operation */}
   try{
    const job=await decideCommand(data.slice(3),actor,c.branch_id,c.generation,data.startsWith('ok:'));
    await telegramApi(c.bot_token,'editMessageText',{chat_id:chat,message_id:m.message_id,text:job.response,reply_markup:{inline_keyboard:[]}});
   }catch(e){if(e instanceof AssistantError)await send(e.message);else throw e;}
   return Response.json({ok:true});
  }
  if(!u.message)return Response.json({ok:true});
  if(text==='/start'||text==='/help'){
   await send('HALO yordamchi. Matn bilan yozing:\n• Bugungi hisobot\n• Nodir aka qarzi qancha?\n• Un qancha qoldi?\n• Bugun Coupangdan 2 kg un, jami 8000 von oldim. Hammasini Kassa hisobidan to‘ladim.\n\nXarid va qarz to‘lovi avval tekshirish uchun ko‘rsatiladi. Saqlash uchun Tasdiqlash bosing. Chek rasmi va ovoz hozircha qabul qilinmaydi.',{reply_markup:{keyboard:[[{text:'Hisobot'},{text:'Qarzlar'},{text:'Ombor'}],[{text:'Eksport'}]],resize_keyboard:true}});return Response.json({ok:true});
  }
  if(!text){await send('Hozir buyruqni matn bilan yozing. Rasm, ovoz va Excel bu yordamchida hali ulanmagan.');return Response.json({ok:true});}
  const job=await prepareCommand(c.branch_id,actor,c.generation,`tg:${c.generation}:${u.update_id}`,text);
  if(!job.sent){
   const chunks=job.response.match(/[\s\S]{1,3500}/g)||['Javob tayyorlanmadi.'];
   for(let i=0;i<chunks.length;i++)await send(chunks[i],job.status==='ready'&&i===chunks.length-1?{reply_markup:{inline_keyboard:[[{text:'Tasdiqlash',callback_data:`ok:${job.id}`},{text:'Bekor qilish',callback_data:`no:${job.id}`}]]}}:{});
   await db.prepare('UPDATE halo_assistant_jobs SET sent=1 WHERE id=?').bind(job.id).run();
  }
  return Response.json({ok:true});
 }catch{return new Response('Retry later',{status:503});}
}
