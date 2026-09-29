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
function drawSheets(){var box=document.getElementById('gs'),s=SNAP.settings||{},sheetKeys=(SNAP.keys||[]).filter(function(k){return k.active&&/Google Sheets/i.test(k.name)});
  box.innerHTML='<div class="msg '+(sheetKeys.length?'ok':'warn')+'">'+(sheetKeys.length?'✓ Google Sheets kaliti bor'+(sheetKeys[0].lastUsedAt?' · oxirgi ulanish: '+esc(String(sheetKeys[0].lastUsedAt).slice(0,16).replace('T',' ')):' · hali ulanmagan'):'Google Sheets ulanmagan')+'</div>'
    +'<ol class="hint" style="padding-left:18px;margin-top:12px"><li>Pastdagi tugmani bosing — tayyor skript chiqadi.</li><li>Google Sheets → Kengaytmalar → Apps Script → hamma matnni o‘chirib, skriptni joylang → Saqlash.</li><li>Jadvalni yangilang: tepada “HALO” menyusi chiqadi → “1 daqiqalik avtomatik yangilashni yoqish” (ruxsat bering). Shundan keyin jadval o‘zi yangilanib turadi.</li></ol>'
    +'<button id="gsGo">'+(sheetKeys.length?'Yangi skript olish (eski kalit o‘chiriladi)':'Google Sheets’ni ulash')+'</button><div id="gsOut"></div>';
  document.getElementById('gsGo').addEventListener('click',function(){
    if(sheetKeys.length&&!confirm('Eski Google Sheets kaliti o‘chiriladi va yangisi beriladi. Davom etasizmi?'))return;
    var btn=this;btn.disabled=true;
    var revoke=Promise.all(sheetKeys.map(function(k){return req('/api/admin/integrations','POST',{action:'revoke-key',keyId:k.id,branchId:sel.value})}));
    revoke.then(function(){return req('/api/admin/integrations','POST',{action:'setup-google-sheets',branchId:sel.value})}).then(function(r){btn.disabled=false;
      var out=document.getElementById('gsOut');if(!r.body.ok){note(out,false,r.body.error||'Bo‘lmadi.');return}
      SNAP=r.body;var script=r.body.googleSheetsScript||'';
      out.innerHTML='<div class="msg ok" style="margin-top:12px">✓ Tayyor. Skriptni nusxalab Apps Script’ga joylang. Bu oyna yopilgach kalit qayta ko‘rinmaydi.</div><pre style="max-height:220px;overflow:auto;margin-top:10px">'+esc(script.slice(0,1500))+(script.length>1500?'\\n…':'')+'</pre><button id="gsCopy">📋 Skriptni nusxalash</button><div id="gsM"></div>';
      document.getElementById('gsCopy').addEventListener('click',function(){copy(script,document.getElementById('gsM'))});drawKeys()});
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
