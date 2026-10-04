import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches } from "../../../lib/halo-store";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — ulanishlar: Telegram bot (kunlik hisobot), Google Sheets (avtomatik jadval),
 * API kalitlar (boshqa dasturlar uchun). Hamma amal mavjud tekshirilgan API'lar orqali:
 * /api/telegram, /api/admin/integrations. Kalit faqat bir marta ko'rsatiladi, saqlanmaydi.
 */
const PAGE_PATH = "/api/v2/ulanishlar";

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return new Response(shell({
    title: "Ulanishlar", active: "bosh", heading: "Ulanishlar",
    subtitle: "Telegram bot, Google Sheets va boshqa dasturlar bilan bog'lanish",
    headerRight: '<select id="branch"></select>',
    body: `<section class="card"><h2>✈️ Telegram bot</h2><p class="hint">Har kuni belgilangan vaqtda kunlik hisobot va qisqa “flash” hisobot shu chatga keladi.</p><div id="tg"></div></section>
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
    document.getElementById('tS').addEventListener('click',function(){req('/api/telegram','POST',{action:'save',branchId:sel.value,botToken:document.getElementById('tT').value.trim()||undefined,chatId:document.getElementById('tC').value.trim(),reportTime:document.getElementById('tR').value,enabled:document.getElementById('tE').checked}).then(function(r){if(r.body.ok)loadTelegram();else note(m,false,r.body.error)})});
    document.getElementById('tX').addEventListener('click',function(){req('/api/telegram','POST',{action:'test',branchId:sel.value}).then(function(r){note(m,r.body.ok,r.body.ok?r.body.message:r.body.error)})});
    document.getElementById('tN').addEventListener('click',function(){req('/api/v2/bosh','POST',{action:'telegram',branchId:sel.value}).then(function(r){note(m,r.body.ok,r.body.ok?'✓ Qisqa hisobot yuborildi':r.body.error)})});
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
function loadAll(){loadTelegram();loadIntegrations()}
sel.addEventListener('change',loadAll);loadAll();
`,
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
