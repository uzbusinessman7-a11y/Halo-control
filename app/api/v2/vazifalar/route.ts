import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches } from "../../../lib/halo-store";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — xodimlarga vazifa (rahbar). Vazifa xodim ilovasida (/xodim) chiqadi va Telegram ulangan
 * bo'lsa xabar yuboriladi; xodim "Boshladim" / "Bajarildi" bosadi — rahbar shu yerda ko'radi.
 * Yozuv mavjud /api/worker-tasks orqali (create-bulk, cancel, resend).
 */
const PAGE_PATH = "/api/v2/vazifalar";

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return new Response(shell({
    title: "Vazifalar", active: "vazifalar", heading: "Vazifalar",
    subtitle: "Vazifa yuboring — xodim ilovasida chiqadi, bajarilganini shu yerda ko‘rasiz",
    headerRight: '<select id="branch"></select>',
    // Tartib: 1) nechta vazifa ochiq, 2) «Yangi vazifa» tugmasi (forma bosilganda ochiladi), 3) vazifalar ro'yxati.
    body: `<section class="card"><div id="sum"><p class="hint" style="margin:0">Yuklanmoqda…</p></div>
<button class="block" id="newBtn" style="margin-top:14px">＋ Yangi vazifa</button>
<div id="newForm" hidden style="margin-top:16px"><h2>Yangi vazifa</h2>
<label class="field"><span>Nima qilish kerak?</span><input id="tt" maxlength="120" placeholder="masalan: muzlatkichni tozalash"></label>
<label class="field"><span>Batafsil (ixtiyoriy)</span><textarea id="td" maxlength="600" rows="3" style="width:100%"></textarea></label>
<div class="row" style="gap:10px"><label class="field" style="flex:1"><span>Muhimligi</span><select id="tp"><option value="normal">Oddiy</option><option value="important">Muhim</option><option value="urgent">Shoshilinch</option></select></label>
<label class="field" style="flex:1"><span>Muddat (ixtiyoriy)</span><input type="datetime-local" id="tdue"></label></div>
<div class="field"><span>Kimga?</span><div id="who" style="display:grid;gap:6px;margin-top:6px"></div></div>
<div class="row"><button id="send" style="flex:1">Yuborish</button><button class="ghost" id="newX">Bekor</button></div></div><div id="msg"></div></section>
<section class="card"><h2>Vazifalar</h2><div id="list"></div></section><style>.tag.ok{background:var(--ok-soft);color:var(--ok)}</style>`,
    script: `
var BRANCHES=${boot};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function req(url,method,body){return fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function bname(){var b=BRANCHES.find(function(x){return x.id===sel.value});return b?b.name:''}
var ST={new:['Yangi','warn'],started:['Boshlangan','warn'],done:['✓ Bajarildi','ok'],cancelled:['Bekor qilingan','bad']};
var PR={normal:'',important:'<span class="tag warn">muhim</span>',urgent:'<span class="tag bad">shoshilinch</span>'};
function load(){
  document.getElementById('list').innerHTML=haloLoading(3);
  Promise.all([req('/api/worker-auth?admin=1&branch='+encodeURIComponent(sel.value),'GET'),req('/api/worker-tasks?admin=1&branch='+encodeURIComponent(sel.value),'GET')]).then(function(r){
    var accs=(r[0].body.accounts||[]).filter(function(a){return a.active});
    document.getElementById('who').innerHTML=accs.length?'<label class="row" style="gap:8px"><input type="checkbox" id="all" style="width:18px;height:18px;min-height:auto"> <b>Hammasi</b></label>'+accs.map(function(a){return '<label class="row" style="gap:8px"><input type="checkbox" class="w" value="'+esc(a.id)+'" style="width:18px;height:18px;min-height:auto"> '+esc(a.name)+(a.telegramChatId?' <small style="color:var(--muted)">✈ Telegram</small>':'')+'</label>'}).join(''):'<p class="hint">Bu filialda xodim akkaunti yo‘q. Sozlamalar’da yarating.</p>';
    var all=document.getElementById('all');if(all)all.addEventListener('change',function(){document.querySelectorAll('.w').forEach(function(c){c.checked=all.checked})});
    var tasks=r[1].body.tasks||[];
    var open=tasks.filter(function(t){return t.status==='new'||t.status==='started'}),done=tasks.filter(function(t){return t.status==='done'}).length;
    document.getElementById('sum').innerHTML='<div class="total">'+open.length+' ta</div><p class="hint" style="margin:0">Bajarilmagan vazifa'+(open.length?' · yangi '+open.filter(function(t){return t.status==='new'}).length+' · boshlangan '+open.filter(function(t){return t.status==='started'}).length:'')+(done?' · bajarilgan '+done:'')+'</p>';
    document.getElementById('list').innerHTML=tasks.length?tasks.map(function(t){var st=ST[t.status]||[t.status,''];
      return '<div class="item" style="display:block"><div class="row" style="justify-content:space-between;gap:8px"><b>'+esc(t.title)+' '+(PR[t.priority]||'')+'</b><span class="tag '+st[1]+'">'+st[0]+'</span></div>'
        +(t.description?'<p style="margin:6px 0;color:var(--muted)">'+esc(t.description)+'</p>':'')
        +'<small style="color:var(--muted)">'+esc(t.workerName||'')+' · '+esc(String(t.createdAt||'').slice(0,16).replace('T',' '))+(t.dueAt?' · muddat '+esc(String(t.dueAt).slice(0,16).replace('T',' ')):'')+(t.completedAt?' · bajarildi '+esc(String(t.completedAt).slice(0,16).replace('T',' ')):'')+'</small>'
        +(t.status==='new'||t.status==='started'?'<div class="row" style="margin-top:8px"><button class="ghost" data-resend="'+esc(t.id)+'" style="min-height:34px;padding:4px 10px">Qayta eslatish</button><button class="ghost" data-cancel="'+esc(t.id)+'" style="min-height:34px;padding:4px 10px">Bekor qilish</button></div>':'')+'</div>'}).join(''):'<p class="hint">Hali vazifa yo‘q.</p>';
    document.querySelectorAll('[data-resend]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;req('/api/worker-tasks','POST',{action:'resend',taskId:b.dataset.resend,branchId:sel.value,branchName:bname()}).then(function(x){b.disabled=false;alert(x.body.ok?'✓ Eslatma yuborildi':(x.body.error||'Yuborilmadi'))})})});
    document.querySelectorAll('[data-cancel]').forEach(function(b){b.addEventListener('click',function(){var why=prompt('Bekor qilish sababi:');if(why===null)return;req('/api/worker-tasks','POST',{action:'cancel',taskId:b.dataset.cancel,branchId:sel.value,reason:why}).then(function(x){if(!x.body.ok)alert(x.body.error||'Bo‘lmadi');load()})})});
  });
}
document.getElementById('send').addEventListener('click',function(){var btn=this,ids=[].map.call(document.querySelectorAll('.w:checked'),function(c){return c.value}),m=document.getElementById('msg');
  if(!document.getElementById('tt').value.trim()){m.innerHTML='<div class="msg bad">Vazifani yozing.</div>';return}
  if(!ids.length){m.innerHTML='<div class="msg bad">Kimga yuborishni tanlang.</div>';return}
  var due=document.getElementById('tdue').value;
  btn.disabled=true;req('/api/worker-tasks','POST',{action:'create-bulk',branchId:sel.value,branchName:bname(),workerIds:ids,title:document.getElementById('tt').value.trim(),description:document.getElementById('td').value.trim(),priority:document.getElementById('tp').value,dueAt:due||''}).then(function(x){btn.disabled=false;
    if(!x.body.ok){m.innerHTML='<div class="msg bad">'+esc(x.body.error||'Yuborilmadi.')+'</div>';return}
    m.innerHTML='<div class="msg ok" style="margin-top:12px">✓ '+x.body.created+' ta xodimga yuborildi'+(x.body.telegram&&x.body.telegram.sent?' · Telegram: '+x.body.telegram.sent:'')+'</div>';
    document.getElementById('tt').value='';document.getElementById('td').value='';document.getElementById('tdue').value='';showForm(false);load()});
});
function showForm(on){document.getElementById('newForm').hidden=!on;document.getElementById('newBtn').hidden=on;if(on){document.getElementById('msg').innerHTML='';document.getElementById('tt').focus()}}
document.getElementById('newBtn').addEventListener('click',function(){showForm(true)});
document.getElementById('newX').addEventListener('click',function(){showForm(false)});
sel.addEventListener('change',load);load();
`,
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
