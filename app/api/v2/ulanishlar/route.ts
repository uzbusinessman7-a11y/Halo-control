import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { mezanaDebtActionLabel, mezanaTelegramDestination, normalizeMezanaDebtEntries, normalizeMezanaSettings } from "../../../lib/mezana-debts";
import { readSettings, telegramCall } from "../../../lib/telegram-service";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

/**
 * HALO V2 — ulanishlar: Telegram bot (kunlik hisobot), MEZANA guruhi, yordamchi bot (ma'lumot va kiritma),
 * Google Sheets (avtomatik jadval), API kalitlar (boshqa dasturlar uchun). Hamma amal mavjud tekshirilgan
 * API'lar orqali: /api/telegram, /api/assistant, /api/admin/integrations. Kalit faqat bir marta ko'rsatiladi.
 */
const PAGE_PATH = "/api/v2/ulanishlar";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** MEZANA guruhi holati: qaysi guruh ulangan va oxirgi yozuvlar guruhga borganmi. Bot tokeni hech qachon qaytarilmaydi. */
async function mezanaStatus(branchId: string) {
  const [{ state }, telegram] = await Promise.all([readHaloState(branchId), readSettings()]);
  const settings = normalizeMezanaSettings(state.mezanaSettings);
  const entries = new Map(normalizeMezanaDebtEntries(state.mezanaEntries).map((entry) => [entry.id, entry]));
  let recent: Array<{ label: string; status: string; error: string; at: string }> = [];
  try {
    const rows = await globalThis.__HALO_CONTROL_DB__!.prepare(
      "SELECT entry_id, status, last_error, updated_at FROM mezana_telegram_deliveries WHERE branch_id = ? ORDER BY updated_at DESC LIMIT 5",
    ).bind(branchId).all<{ entry_id: string; status: string; last_error: string; updated_at: string }>();
    recent = (rows.results || []).map((row) => {
      const entry = entries.get(row.entry_id);
      return {
        label: entry ? `${mezanaDebtActionLabel(entry.action)} · ${entry.productName}` : "O‘chirilgan yozuv",
        status: row.status, error: row.last_error || "", at: row.updated_at,
      };
    });
  } catch { /* Jadval hali yaratilmagan bo'lsa ro'yxat bo'sh qoladi. */ }
  return {
    botReady: Boolean(telegram.botToken), botName: telegram.botName,
    borrowed: { chatId: settings.telegramChatId, chatName: settings.telegramChatName, threadId: settings.telegramThreadId },
    purchased: { chatId: settings.purchasedTelegramChatId, chatName: settings.purchasedTelegramChatName, threadId: settings.purchasedTelegramThreadId },
    recent,
  };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const branchId = String(body.branchId || "main");
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)) return json({ error: "Noto‘g‘ri filial." }, 400);
    if (body.action === "mezana") return json({ ok: true, ...(await mezanaStatus(branchId)) });
    if (body.action === "mezanaTest") {
      // Faqat sinov xabari: hisobga hech narsa yozilmaydi.
      const purchased = body.destination === "purchased";
      const [{ state }, telegram] = await Promise.all([readHaloState(branchId), readSettings()]);
      const target = mezanaTelegramDestination(normalizeMezanaSettings(state.mezanaSettings), purchased ? "purchased" : "borrowed");
      if (!telegram.botToken) return json({ error: "Avval yuqorida Telegram botni ulang." }, 400);
      if (!target.chatId) return json({ error: "Avval shu yo‘nalish uchun guruhni ulang." }, 400);
      try {
        await telegramCall(telegram.botToken, "sendMessage", {
          chat_id: target.chatId,
          ...(target.threadId > 0 ? { message_thread_id: target.threadId } : {}),
          text: `✅ HALO Control · MEZANA sinov xabari\n${purchased ? "SOTIB OLINDI va TO‘LOV" : "OLIB TURILDI va QAYTARILDI"} yozuvlari shu yerga keladi.`,
        });
      } catch (error) {
        const reason = error instanceof Error && error.name !== "TimeoutError" ? error.message : "Telegram javobi kechikdi.";
        return json({ error: `Guruhga yuborilmadi: ${reason} Bot guruhda borligini va yozish huquqini tekshiring.` }, 502);
      }
      return json({ ok: true, message: `Sinov xabari «${target.chatName || target.chatId}» guruhiga yuborildi.` });
    }
    return json({ error: "Noto‘g‘ri amal." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return new Response(shell({
    title: "Ulanishlar", active: "ulanishlar", heading: "Ulanishlar",
    subtitle: "Telegram bot, Google Sheets va boshqa dasturlar bilan bog'lanish",
    headerRight: '<select id="branch"></select>',
    body: `<section class="card"><h2>✈️ Telegram bot</h2><p class="hint">Har kuni belgilangan vaqtda kunlik hisobot va qisqa “flash” hisobot shu chatga keladi.</p><div id="tg"></div></section>
<section class="card"><h2>🤝 MEZANA guruhi</h2><p class="hint">MEZANA’dan olib turilgan, qaytarilgan, qarzga olingan mahsulot va to‘lovlar kiritilishi bilan shu Telegram guruhga yuboriladi.</p><div id="mz"></div></section>
<section class="card"><h2>🤖 Yordamchi bot</h2><p class="hint">Telegramdan ma’lumot olish va kiritma qilish: bugungi holat, kassa, qarzlar, ombor, MEZANA; xarajat, MEZANA yozuvi va qarz to‘lovi — har biri tasdiqlash bilan. Bot faqat siz bog‘lagan Telegram akkauntga javob beradi.</p><div id="as"></div></section>
<section class="card"><h2>📊 Google Sheets</h2><p class="hint">Savdo, xarajat va hisobotlar Google jadvalga o‘zi tushib turadi.</p><div id="gs"></div></section>
<section class="card"><h2>🔑 API kalitlar</h2><p class="hint">Boshqa dasturlar (POS, buxgalteriya) HALO ma’lumotini o‘qishi uchun. Kalit faqat yaratilganda bir marta ko‘rinadi.</p><div id="keys"></div></section>`,
    script: `
var BRANCHES=${boot},SNAP=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function req(url,method,body){return fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function note(el,ok,t){el.innerHTML='<div class="msg '+(ok?'ok':'bad')+'" style="margin-top:10px">'+esc(t)+'</div>'}
function copy(text,el){var done=function(){note(el,true,'✓ Nusxa olindi')};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(done,function(){prompt('Nusxalang:',text)});else prompt('Nusxalang:',text)}
/* Telegram */
function loadTelegram(){var box=document.getElementById('tg');
  req('/api/telegram?branch='+encodeURIComponent(sel.value),'GET').then(function(x){var t=x.body||{};
    box.innerHTML='<div class="msg '+(t.configured?'ok':'warn')+'">'+(t.configured?'✓ Ulangan: '+esc(t.botName||'bot')+(t.enabled?' · har kuni '+esc(t.reportTime):' · avtomatik hisobot o‘chiq')+(t.lastSentAt?' · oxirgi: '+esc(String(t.lastSentAt).slice(0,16).replace('T',' ')):''):'Bot ulanmagan')+'</div>'
      +'<details style="margin-top:12px"'+(t.configured?'':' open')+'><summary>Sozlash</summary><div style="margin-top:12px">'
      +'<ol class="hint" style="padding-left:18px"><li>Telegram’da @BotFather → /newbot → bot tokenini oling.</li><li>Botingizga “Salom” deb yozing.</li><li>Tokenni shu yerga qo‘yib “Chatni topish”ni bosing, keyin “Saqlash”.</li></ol>'
      +'<label class="field"><span>Bot token '+(t.tokenSaved?'(saqlangan — almashtirish uchun yangisini yozing)':'')+'</span><input id="tT" autocomplete="off" placeholder="'+(t.tokenSaved?'••••••••':'123456:ABC…')+'"></label>'
      +'<div class="row"><label class="field" style="flex:2"><span>Chat ID</span><input id="tC" value="'+esc(t.chatId||'')+'"></label><button class="ghost" id="tD" style="align-self:flex-end;margin-bottom:12px">Chatni topish</button></div>'
      +'<div class="row"><label class="field" style="flex:1"><span>Hisobot vaqti</span><input type="time" id="tR" value="'+esc(t.reportTime||'00:10')+'"></label><label class="row" style="flex:1;gap:8px"><input type="checkbox" id="tE" style="width:18px;height:18px;min-height:auto"'+(t.enabled?' checked':'')+'> Har kuni avtomatik</label></div>'
      +'<div class="row"><button id="tS">Saqlash</button><button class="ghost" id="tX">Sinov xabari</button><button class="ghost" id="tN">Hozir hisobot yuborish</button></div><div id="tM"></div>'
      +'<p class="hint" style="margin-top:10px">To‘liq o‘tishgacha bu sayt o‘zi avtomatik yubormaydi (eski saytdan keladi).</p></div></details>';
    var m=document.getElementById('tM');
    document.getElementById('tD').addEventListener('click',function(){req('/api/telegram','POST',{action:'discover',branchId:sel.value,botToken:document.getElementById('tT').value.trim()||undefined}).then(function(r){if(r.body.ok){document.getElementById('tC').value=r.body.chatId;note(m,true,'Topildi: '+r.body.chatName)}else note(m,false,r.body.error)})});
    document.getElementById('tS').addEventListener('click',function(){req('/api/telegram','POST',{action:'save',branchId:sel.value,botToken:document.getElementById('tT').value.trim()||undefined,chatId:document.getElementById('tC').value.trim(),reportTime:document.getElementById('tR').value,enabled:document.getElementById('tE').checked}).then(function(r){if(r.body.ok){loadTelegram();loadMezana()}else note(m,false,r.body.error)})});
    document.getElementById('tX').addEventListener('click',function(){req('/api/telegram','POST',{action:'test',branchId:sel.value}).then(function(r){note(m,r.body.ok,r.body.ok?r.body.message:r.body.error)})});
    document.getElementById('tN').addEventListener('click',function(){req('/api/v2/bosh','POST',{action:'telegram',branchId:sel.value}).then(function(r){note(m,r.body.ok,r.body.ok?'✓ Qisqa hisobot yuborildi':r.body.error)})});
  });
}
/* MEZANA guruhi: ulash mavjud /api/telegram amallari orqali (discover-mezana, save-mezana) */
var MZ_LABEL={borrowed:'📥 Olib turildi · 📤 Qaytarildi',purchased:'🛒 Qarzga olindi · 💸 To‘lov'};
function loadMezana(flash){var box=document.getElementById('mz');
  req('/api/v2/ulanishlar','POST',{action:'mezana',branchId:sel.value}).then(function(x){var m=x.body||{};
    if(!m.ok){box.innerHTML='<div class="msg bad">'+esc(m.error||'Yuklanmadi.')+'</div>';return}
    var none=!m.borrowed.chatId&&!m.purchased.chatId;
    var h=m.botReady?'':'<div class="msg warn">Avval yuqorida Telegram botni ulang — MEZANA xabarlarini o‘sha bot yuboradi.</div>';
    ['borrowed','purchased'].forEach(function(k){var d=m[k];
      h+='<div class="list-row"><div style="min-width:0"><b>'+MZ_LABEL[k]+'</b><br><small style="color:var(--'+(d.chatId?'ok':'muted')+')">'+(d.chatId?'✓ '+esc(d.chatName||'Guruh')+' · ID '+esc(d.chatId)+(d.threadId?' · mavzu '+esc(d.threadId):''):'Guruh ulanmagan — bu yozuvlar Telegramga bormaydi')+'</small></div>'
        +'<div class="row" style="justify-content:flex-end;gap:6px">'+(d.chatId?'<button class="ghost" data-mt="'+k+'" style="min-height:36px;padding:4px 12px">Sinov</button><button class="ghost" data-mx="'+k+'" style="min-height:36px;padding:4px 12px">Uzish</button>':'')
        +'<button data-mf="'+k+'" class="'+(d.chatId?'ghost':'')+'" style="min-height:36px;padding:4px 12px"'+(m.botReady?'':' disabled')+'>'+(d.chatId?'Almashtirish':'Guruhni topish')+'</button></div></div>'});
    h+='<div id="mzM">'+(flash||'')+'</div>'
      +'<details style="margin-top:12px"'+(none?' open':'')+'><summary>Qanday ulanadi</summary><ol class="hint" style="padding-left:18px;margin-top:10px;display:grid;gap:6px">'
      +'<li>Telegram guruhiga '+(m.botName?'<b>'+esc(m.botName)+'</b> ':'hisobot ')+'botini a’zo qilib qo‘shing.</li>'
      +'<li>O‘sha guruhda (mavzulari bo‘lsa — kerakli mavzuda) <b>/mezana_olib</b> deb yozing. Qarzga olish va to‘lov xabarlari uchun <b>/mezana_sotib</b> deb yozing — xohlasangiz o‘sha guruhning o‘zida.</li>'
      +'<li>Shu yerda mos qatordagi «Guruhni topish»ni bosing. Guruhga «ulandi» degan xabar keladi.</li></ol>'
      +'<label class="field"><span>Yoki guruhning Chat ID raqamini qo‘lda kiriting (minus bilan boshlanadi)</span><div class="row"><select id="mzK" style="flex:1"><option value="borrowed">Olib turildi / qaytarildi</option><option value="purchased">Qarzga olindi / to‘lov</option></select><input id="mzI" placeholder="-1001234567890" style="flex:1.4"><button class="ghost" id="mzS">Saqlash</button></div></label></details>'
      +(m.recent&&m.recent.length?'<details style="margin-top:10px"><summary>Guruhga oxirgi yuborilganlar</summary>'+m.recent.map(function(r){return '<div class="list-row"><div style="min-width:0"><b>'+(r.status==='sent'?'✓':r.status==='sending'?'…':'✗')+'</b> '+esc(r.label)+' <small style="color:var(--muted)">'+esc(kst(r.at))+'</small>'+(r.status==='failed'&&r.error?'<br><small style="color:var(--bad)">'+esc(r.error)+'</small>':'')+'</div><span></span></div>'}).join('')+'</details>':'');
    box.innerHTML=h;
    var msg=document.getElementById('mzM');
    box.querySelectorAll('[data-mf]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;
      req('/api/telegram','POST',{action:'discover-mezana',branchId:sel.value,mezanaDestination:b.dataset.mf}).then(function(r){b.disabled=false;
        if(!r.body.ok){note(msg,false,r.body.error||'Guruh topilmadi.');return}
        loadMezana('<div class="msg '+(r.body.warning?'warn':'ok')+'" style="margin-top:10px">✓ Ulandi: '+esc(r.body.chatName)+(r.body.warning?' — '+esc(r.body.warning):'')+'</div>')})})});
    box.querySelectorAll('[data-mt]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;
      req('/api/v2/ulanishlar','POST',{action:'mezanaTest',branchId:sel.value,destination:b.dataset.mt}).then(function(r){b.disabled=false;note(msg,Boolean(r.body.ok),r.body.ok?'✓ '+r.body.message:r.body.error||'Yuborilmadi.')})})});
    box.querySelectorAll('[data-mx]').forEach(function(b){b.addEventListener('click',function(){if(!confirm('Guruh uzilsinmi? Bu yozuvlar Telegramga yuborilmay qoladi.'))return;
      req('/api/telegram','POST',{action:'save-mezana',branchId:sel.value,mezanaDestination:b.dataset.mx,chatId:''}).then(function(r){if(!r.body.ok){note(msg,false,r.body.error||'Bo‘lmadi.');return}loadMezana('<div class="msg ok" style="margin-top:10px">Guruh uzildi.</div>')})})});
    document.getElementById('mzS').addEventListener('click',function(){var id=document.getElementById('mzI').value.trim();if(!id){note(msg,false,'Chat ID raqamini yozing.');return}
      req('/api/telegram','POST',{action:'save-mezana',branchId:sel.value,mezanaDestination:document.getElementById('mzK').value,chatId:id}).then(function(r){if(!r.body.ok){note(msg,false,r.body.error||'Saqlanmadi.');return}loadMezana('<div class="msg ok" style="margin-top:10px">✓ Saqlandi. «Sinov»ni bosib tekshiring.</div>')})});
  });
}
/* Yordamchi bot: mavjud /api/assistant amallari (setup, pair, activate, status, retryWebhook, disconnect). Token faqat serverga yuboriladi, qaytib ko'rsatilmaydi. */
var AS_LINK='',AS_TIMER=null;
function loadAssistant(flash){var box=document.getElementById('as');clearInterval(AS_TIMER);
  req('/api/assistant?branch='+encodeURIComponent(sel.value),'GET').then(function(x){var a=x.body||{};
    if(!a.ok){box.innerHTML='<div class="msg bad">'+esc(a.error||'Yuklanmadi.')+'</div>';return}
    var t=a.telegram,h='';
    if(!t){AS_LINK='';
      h='<div class="msg warn">Yordamchi bot ulanmagan</div>'
        +'<ol class="hint" style="padding-left:18px;margin-top:12px;display:grid;gap:6px"><li>Telegram’da <b>@BotFather</b> → /newbot → <b>yangi</b> bot yarating. Yuqoridagi hisobot botining tokeni bu yerga to‘g‘ri kelmaydi — yordamchiga alohida bot kerak.</li>'
        +'<li>BotFather bergan tokenni pastga kiriting va «Botni ulash»ni bosing.</li><li>Keyin o‘z Telegram akkauntingizni bog‘laysiz — bot faqat sizga javob beradi.</li></ol>'
        +'<label class="field"><span>Yordamchi bot tokeni</span><input id="asT" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="BotFather bergan token"></label>'
        +'<button id="asSetup">Botni ulash</button>';
    }else{
      var branch=(BRANCHES.filter(function(b){return b.id===t.branchId})[0]||{}).name||t.branchId;
      if(t.enabled)AS_LINK='';
      h='<div class="msg '+(t.enabled?'ok':'warn')+'">'+(t.enabled?'✓ Faol: @'+esc(t.botName)+' · filial: '+esc(branch):'@'+esc(t.botName)+' tayyor — endi o‘z Telegram akkauntingizni bog‘lang')+'</div><div id="asHook"></div>';
      if(t.candidateId)h+='<div class="msg warn" style="margin-top:10px">Ulanayotgan akkaunt: <b>'+esc(t.candidateName||'nomsiz')+'</b> · Telegram ID '+esc(t.candidateId)+'. Faqat o‘zingizniki bo‘lsa tasdiqlang.</div><div class="row" style="margin-top:8px"><button id="asAct">Bu mening akkauntim — tasdiqlash</button></div>';
      else if(AS_LINK&&!t.enabled){var cmd='/start '+AS_LINK.split('start=')[1];
        h+='<div class="msg" style="margin-top:10px;border:1px solid var(--line)">1. <a href="'+esc(AS_LINK)+'" target="_blank" rel="noreferrer"><b>Telegramni ochish</b></a> va <b>Start</b> bosing. Ochilmasa, quyidagi buyruqni nusxalab @'+esc(t.botName)+' botiga yuboring:'
          +'<div class="row" style="margin-top:8px"><input id="asCmd" readonly value="'+esc(cmd)+'" style="flex:1;min-width:0;font:13px ui-monospace,Menlo,monospace"><button class="ghost" id="asCopy">📋 Nusxa</button></div>'
          +'2. Shu oynaga qayting — akkauntingiz shu yerda ko‘rinadi, «tasdiqlash»ni bosasiz. Havola 10 daqiqa amal qiladi.</div>'}
      h+='<div class="row" style="margin-top:12px">'+(t.enabled?'':'<button id="asPair"'+(t.candidateId||AS_LINK?' class="ghost"':'')+'>'+(AS_LINK||t.candidateId?'Yangi havola olish':'O‘z Telegramimni bog‘lash')+'</button>')+'<button class="ghost" id="asFix">Bot ulanishini tiklash</button><button class="ghost" id="asOff">Uzish</button></div>';
      if(t.enabled)h+='<p class="hint" style="margin:12px 0 0">Telegramda botga <b>/start</b> yozing — tugmalar chiqadi.'+(BRANCHES.length>1?' Boshqa filialga o‘tish: botdagi «🏪 Filial» tugmasi.':'')+' '+(a.aiReady?'AI ulangan: erkin matn bilan ham yozish mumkin.':'Tugmalar AI’siz ishlaydi; erkin matnli buyruqlar uchun Cloudflare’da OPENAI_API_KEY kerak bo‘ladi (ixtiyoriy).')+'</p>';
    }
    box.innerHTML=h+'<div id="asM">'+(flash||'')+'</div>';
    var msg=document.getElementById('asM'),ok=function(text){return '<div class="msg ok" style="margin-top:10px">'+esc(text)+'</div>'};
    var act=function(body,after){return req('/api/assistant','POST',Object.assign({branchId:sel.value},body)).then(function(r){if(!r.body.ok){note(msg,false,r.body.error||'Bajarilmadi.');return null}if(after)after(r.body);return r.body})};
    var on=function(id,fn){var el=document.getElementById(id);if(el)el.addEventListener('click',function(){fn(el)})};
    on('asSetup',function(b){var tk=document.getElementById('asT').value.trim();if(!tk){note(msg,false,'Tokenni kiriting.');return}b.disabled=true;
      act({action:'setup',botToken:tk},function(r){loadAssistant(ok(r.message||'Bot tayyor.'))}).then(function(){b.disabled=false})});
    on('asPair',function(b){b.disabled=true;act({action:'pair'},function(r){AS_LINK=r.link||'';loadAssistant()}).then(function(){b.disabled=false})});
    on('asCopy',function(){var c=document.getElementById('asCmd');c.focus();c.select();var done=function(){note(msg,true,'✓ Nusxa olindi — Telegramdagi yordamchi botga yuboring.')};
      if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(c.value).then(done,function(){note(msg,false,'Matn belgilandi — Ctrl+C bosing.')});else{try{document.execCommand('copy');done()}catch(e){note(msg,false,'Matn belgilandi — Ctrl+C bosing.')}}});
    on('asAct',function(b){b.disabled=true;act({action:'activate',candidateId:t.candidateId},function(r){AS_LINK='';loadAssistant(ok(r.message||'Tasdiqlandi.'))}).then(function(){b.disabled=false})});
    on('asFix',function(b){b.disabled=true;act({action:'retryWebhook'},function(r){loadAssistant(ok(r.message||'Tiklandi.'))}).then(function(){b.disabled=false})});
    on('asOff',function(){if(!confirm('Yordamchi bot uzilsinmi? Hisob yozuvlari saqlanadi.'))return;act({action:'disconnect'},function(r){AS_LINK='';loadAssistant(ok(r.message||'Uzildi.'))})});
    if(t){req('/api/assistant','POST',{action:'status',branchId:sel.value}).then(function(r){var w=r.body&&r.body.webhook,el=document.getElementById('asHook');if(!w||!el)return;
        var warn=function(text){el.innerHTML='<div class="msg warn" style="margin-top:10px">'+text+'</div>'};
        if(!w.checked)warn('Telegram bu bot haqida javob bermadi — token bekor qilingan bo‘lishi mumkin. «Uzish»ni bosib, yangi token kiriting.');
        else if(w.elsewhere)warn('⚠ Bu bot <b>boshqa saytga</b> ulangan (eski sayt) — xabarlar bu yerga kelmaydi. Yangi sayt uchun BotFather’da yangi bot yarating: «Uzish»ni bosing (eski saytdagi bot ishlayveradi), keyin yangi tokenni kiriting.');
        else if(!w.here)warn('Bot ulanishi uzilgan — «Bot ulanishini tiklash»ni bosing.');
        else if(w.lastError)el.innerHTML='<p class="hint" style="margin:8px 0 0">Telegramning oxirgi xabari: '+esc(w.lastError)+(w.pending?' · navbatda '+esc(w.pending)+' ta':'')+'</p>'});
      // Bog'lash kutilayotganda sahifa o'zi tekshirib turadi.
      if(!t.enabled&&AS_LINK&&!t.candidateId)AS_TIMER=setInterval(function(){if(document.visibilityState!=='visible')return;
        req('/api/assistant?branch='+encodeURIComponent(sel.value),'GET').then(function(y){var n=y.body&&y.body.telegram;if(n&&(n.candidateId||n.enabled))loadAssistant()})},5000)}
  });
}
/* Google Sheets va API kalitlar */
function loadIntegrations(){
  req('/api/admin/integrations?branch='+encodeURIComponent(sel.value),'GET').then(function(x){SNAP=x.body||{};drawSheets();drawKeys()});
}
function kst(iso){var d=new Date(iso);if(isNaN(d))return String(iso||'');return d.toLocaleString('en-GB',{timeZone:'Asia/Seoul',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','')}
function drawSheets(){var box=document.getElementById('gs'),sheetKeys=(SNAP.keys||[]).filter(function(k){return k.active&&/Google Sheets/i.test(k.name)});
  var used=sheetKeys.filter(function(k){return k.lastUsedAt}).map(function(k){return k.lastUsedAt}).sort().pop();
  var tries=(SNAP.logs||[]).filter(function(l){return String(l.endpoint||'').indexOf('google-sheets')>=0}).slice(0,5);
  box.innerHTML='<div class="msg '+(used?'ok':'warn')+'">'+(used?'✓ Jadval ulangan · oxirgi so‘rov: '+esc(kst(used)):sheetKeys.length?'Skript olingan, lekin jadval hali bir marta ham so‘ramagan — pastdagi 4–6-qadamlarni bajaring.':'Google Sheets ulanmagan')+'</div>'
    +(tries.length?'<details style="margin-top:10px"'+(tries[0].status===200?'':' open')+'><summary>Jadvalning oxirgi so‘rovlari</summary>'+tries.map(function(l){return '<div class="list-row"><div style="min-width:0"><b>'+(l.status===200?'✓':'✗ '+esc(l.status))+'</b> <small style="color:var(--muted)">'+esc(kst(l.createdAt))+'</small><br><small>'+esc(l.message||'')+'</small></div><span></span></div>'}).join('')+'</details>':'')
    +'<ol class="hint" style="padding-left:18px;margin-top:12px;display:grid;gap:6px"><li><b>Kompyuterda</b> bajaring: telefondagi Google Sheets ilovasida «Apps Script» yo‘q.</li>'
    +'<li>Eski sayt uchun ulangan jadvalga tegmang — <b>yangi bo‘sh jadval</b> oching (eski saytning kunlik hisoboti o‘sha eski jadval orqali ishlaydi). Har filialga alohida jadval.</li>'
    +'<li>Pastdagi tugmani bosing — tayyor skript chiqadi. «Nusxalash» yoki «Faylni yuklash»ni bosing.</li>'
    +'<li>Yangi jadvalda: <b>Kengaytmalar (Extensions) → Apps Script</b> → u yerdagi hamma matnni o‘chirib, skriptni joylang → 💾 Saqlash.</li>'
    +'<li>Jadvalni yangilang (F5). Tepada <b>«HALO CONTROL»</b> menyusi chiqadi → «1 daqiqalik avtomatik yangilashni yoqish». Google ruxsat so‘raydi: akkauntni tanlang → «Advanced / Qo‘shimcha» → «Go to … (unsafe)» → «Allow / Ruxsat berish».</li>'
    +'<li>Ruxsat bergach, o‘sha menyudan <b>yana bir marta</b> «1 daqiqalik avtomatik yangilashni yoqish»ni bosing. «HALO ULANDI» yozuvi chiqsa — tayyor, jadval o‘zi yangilanib turadi.</li></ol>'
    +'<div class="row"><button id="gsGo">'+(sheetKeys.length?'Yangi skript olish (eski kalit o‘chiriladi)':'Google Sheets’ni ulash')+'</button><button class="ghost" id="gsCheck">🔎 Hisobotni tekshirish</button></div><div id="gsOut"></div>';
  document.getElementById('gsCheck').addEventListener('click',function(){var btn=this,out=document.getElementById('gsOut');btn.disabled=true;note(out,true,'Tekshirilmoqda…');
    req('/api/admin/integrations','POST',{action:'check-google-sheets',branchId:sel.value}).then(function(r){btn.disabled=false;var c=r.body.check;
      if(!c){note(out,false,r.body.error||'Tekshirib bo‘lmadi. Sahifani yangilab qayta urinib ko‘ring.');return}
      if(c.ok){var rows=(c.sheets||[]).reduce(function(s,x){return s+x.rows},0);note(out,true,'✓ Sayt tomoni ishlayapti: '+c.from+' — '+c.to+' hisoboti tayyorlandi ('+(c.sheets||[]).length+' ta oyna, '+rows.toLocaleString('en-US')+' qator). Jadval ulanmasa, yuqoridagi 4–6-qadamlarni tekshiring.')}
      else note(out,false,'✗ Hisobot tayyorlanmadi: '+c.error+' — jadval ham shu sababli ololmaydi. Avval shu yozuvni tuzating.')})});
  document.getElementById('gsGo').addEventListener('click',function(){
    if(sheetKeys.length&&!confirm('Eski Google Sheets kaliti o‘chiriladi va yangisi beriladi. Eski skript qo‘yilgan jadval (shu sayt uchun) ishlamay qoladi. Davom etasizmi?'))return;
    var btn=this;btn.disabled=true;
    var revoke=Promise.all(sheetKeys.map(function(k){return req('/api/admin/integrations','POST',{action:'revoke-key',keyId:k.id,branchId:sel.value})}));
    revoke.then(function(){return req('/api/admin/integrations','POST',{action:'setup-google-sheets',branchId:sel.value})}).then(function(r){btn.disabled=false;
      var out=document.getElementById('gsOut');if(!r.body.ok){note(out,false,r.body.error||'Bo‘lmadi.');return}
      SNAP=r.body;var script=r.body.googleSheetsScript||'';
      out.innerHTML='<div class="msg ok" style="margin-top:12px">✓ Skript tayyor ('+script.length.toLocaleString('en-US')+' belgi). To‘liq nusxalab Apps Script’ga joylang. Bu oyna yopilgach kalit qayta ko‘rinmaydi.</div>'
        +'<textarea id="gsTxt" readonly rows="6" spellcheck="false" style="width:100%;margin-top:10px;font:12px/1.4 ui-monospace,Menlo,monospace"></textarea>'
        +'<div class="row" style="margin-top:8px"><button id="gsCopy">📋 Skriptni nusxalash</button><button class="ghost" id="gsDl">↓ Faylni yuklash (Code.gs)</button></div><div id="gsM"></div>';
      var txt=document.getElementById('gsTxt');txt.value=script;txt.addEventListener('focus',function(){txt.select()});
      document.getElementById('gsCopy').addEventListener('click',function(){var m=document.getElementById('gsM'),ok=function(){note(m,true,'✓ Nusxa olindi — endi Apps Script’ga joylang (Ctrl+V).')},manual=function(){txt.focus();txt.select();var done=false;try{done=document.execCommand('copy')}catch(e){}if(done)ok();else note(m,false,'Matn belgilandi — Ctrl+C (Mac: ⌘C) bosing yoki «Faylni yuklash»dan foydalaning.')};
        if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(script).then(ok,manual);else manual()});
      document.getElementById('gsDl').addEventListener('click',function(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([script],{type:'text/plain;charset=utf-8'}));a.download='HALO-Code.gs';document.body.appendChild(a);a.click();a.remove();note(document.getElementById('gsM'),true,'✓ Fayl yuklandi. Uni matn muharririda ochib, hammasini nusxalang va Apps Script’ga joylang.')});
      drawKeys()});
  });
}
function drawKeys(){var box=document.getElementById('keys'),keys=(SNAP.keys||[]);
  box.innerHTML=(keys.length?keys.map(function(k){return '<div class="item"><b>'+esc(k.name)+(k.active?'':'<span class="tag warn">o‘chirilgan</span>')+'</b><span class="v"><code>'+esc(k.prefix||'')+'</code></span><small>'+esc((k.permissions||[]).join(', '))+(k.lastUsedAt?' · oxirgi ishlatilgan '+esc(String(k.lastUsedAt).slice(0,16).replace('T',' ')):' · ishlatilmagan')+(k.active?' · <a href="#" data-rv="'+esc(k.id)+'">o‘chirish</a>':'')+'</small></div>'}).join(''):'<p class="hint">Kalit yo‘q.</p>')
    +'<details style="margin-top:12px"><summary>Yangi kalit yaratish</summary><div style="margin-top:12px"><label class="field"><span>Nomi (kim uchun)</span><input id="kN" maxlength="60" placeholder="Masalan: Buxgalter"></label>'
    +'<div class="row" style="gap:10px;margin-bottom:12px">'+(SNAP.availablePermissions||[]).map(function(p){return '<label class="row" style="gap:6px"><input type="checkbox" data-perm="'+esc(p)+'" style="width:18px;height:18px;min-height:auto"'+(p==='reports:read'?' checked':'')+'> '+esc(p)+'</label>'}).join('')+'</div>'
    +'<button id="kGo">Yaratish</button><div id="kOut"></div></div></details>';
  box.querySelectorAll('[data-rv]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();if(!confirm('Kalit o‘chirilsinmi? U bilan ulangan dastur ishlamay qoladi.'))return;req('/api/admin/integrations','POST',{action:'revoke-key',keyId:a.dataset.rv,branchId:sel.value}).then(function(r){if(r.body.keys){SNAP=r.body;drawKeys();drawSheets()}})})});
  document.getElementById('kGo').addEventListener('click',function(){var perms=[].slice.call(box.querySelectorAll('[data-perm]:checked')).map(function(i){return i.dataset.perm});
    req('/api/admin/integrations','POST',{action:'generate-key',name:document.getElementById('kN').value,permissions:perms,branchId:sel.value}).then(function(r){var out=document.getElementById('kOut');
      if(!r.body.ok){note(out,false,r.body.error||'Bo‘lmadi.');return}SNAP=r.body;var key=r.body.createdKey&&r.body.createdKey.key;drawKeys();drawSheets();
      var o2=document.getElementById('kOut');o2.innerHTML='<div class="msg warn" style="margin-top:10px">Kalit (faqat hozir ko‘rinadi): <code>'+esc(key)+'</code></div><button class="ghost" id="kC">📋 Nusxa</button><div id="kM"></div>';document.getElementById('kC').addEventListener('click',function(){copy(key,document.getElementById('kM'))})});
  });
}
function loadAll(){loadTelegram();loadMezana();loadAssistant();loadIntegrations()}
sel.addEventListener('change',loadAll);loadAll();
`,
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
