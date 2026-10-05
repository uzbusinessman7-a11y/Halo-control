import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches } from "../../../lib/halo-store";
import { exportKinds } from "../../../lib/report-export";
import { shell } from "../../../core/ui-shell";

/**
 * HALO V2 — hisobotlarni yuklab olish (CSV, Excel ochadi) va zaxira nusxalar.
 * Ma'lumot eski tizimning tekshirilgan API'laridan olinadi: /api/report-export va /api/backups.
 * Har bir o'zgarishdan oldin tizim avtomatik nusxa saqlaydi (oxirgi 100 tasi) — xato bo'lsa, qaytarish mumkin.
 */
declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
const PAGE_PATH = "/api/v2/eksport";

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  return new Response(page(branches), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  const kinds = JSON.stringify(Object.entries(exportKinds).map(([id, label]) => ({ id, label }))).replace(/</g, "\\u003c");
  return shell({
    title: "Hisobot va zaxira", active: "eksport", heading: "Hisobot va zaxira",
    subtitle: "Excel uchun yuklab olish, to‘liq nusxa va avvalgi holatga qaytarish",
    headerRight: '<div class="row"><select id="branch"></select></div>',
    body: `<section class="card"><h2>📥 Hisobotlarni yuklab olish</h2><p class="hint">CSV fayl — Excel, Google Sheets yoki Numbers’da ochiladi. Buxgalterga yuborish mumkin.</p>
<div class="row"><label class="field" style="flex:1"><span>Dan</span><input type="date" id="from"></label><label class="field" style="flex:1"><span>Gacha</span><input type="date" id="to"></label></div>
<div class="row" style="gap:8px;margin-bottom:12px"><button class="ghost" data-p="month" style="min-height:38px;padding:6px 12px">Shu oy</button><button class="ghost" data-p="last" style="min-height:38px;padding:6px 12px">O‘tgan oy</button><button class="ghost" data-p="all" style="min-height:38px;padding:6px 12px">Hammasi</button></div>
<div id="kinds"></div></section>
<section class="card"><h2>💾 To‘liq nusxa</h2><p class="hint">Filialning barcha ma’lumoti bitta faylda (JSON). Oyiga bir marta yuklab, kompyuter yoki Google Drive’da saqlang.</p>
<div class="row"><button id="dl">⬇️ To‘liq nusxani yuklab olish</button><button class="ghost" id="snap">📌 Hozirgi holatni saqlab qo‘yish</button></div><div id="bMsg"></div></section>
<section class="card"><h2>↺ Avvalgi holatga qaytarish</h2><p class="hint">Tizim har o‘zgarishdan oldin nusxa saqlaydi (oxirgi 100 tasi). Katta xato bo‘lsa — o‘sha o‘zgarishdan oldingi holatga qaytaring. Qaytarishdan oldin hozirgi holat ham nusxaga olinadi, ya’ni bu amalni ham ortga qaytarish mumkin.</p><div id="bl"></div></section>`,
    script: `
var BRANCHES=${boot},KINDS=${kinds};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var sel=document.getElementById('branch'),from=document.getElementById('from'),to=document.getElementById('to');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
function period(p){var m=today.slice(0,7);if(p==='month'){from.value=m+'-01';to.value=today}else if(p==='last'){var d=new Date(m+'-01T00:00:00Z');d.setUTCDate(0);var lm=d.toISOString().slice(0,7);from.value=lm+'-01';to.value=d.toISOString().slice(0,10)}else{from.value='';to.value=''}drawKinds()}
function drawKinds(){document.getElementById('kinds').innerHTML=KINDS.map(function(k){var q='kind='+encodeURIComponent(k.id)+'&from='+encodeURIComponent(from.value)+'&to='+encodeURIComponent(to.value)+'&branch='+encodeURIComponent(sel.value);
  return '<div class="list-row"><b>'+esc(k.label)+'</b><a href="/api/report-export?'+q+'" download><button class="ghost" style="min-height:36px;padding:4px 12px">⬇️ CSV</button></a></div>'}).join('')}
document.querySelectorAll('[data-p]').forEach(function(b){b.addEventListener('click',function(){period(b.dataset.p)})});
from.addEventListener('change',drawKinds);to.addEventListener('change',drawKinds);
document.getElementById('dl').addEventListener('click',function(){var b=this;b.disabled=true;
  fetch('/api/backups?download=current&branch='+encodeURIComponent(sel.value)).then(function(r){if(!r.ok)throw new Error();return r.blob()}).then(function(blob){var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='HALO-'+sel.value+'-nusxa-'+today+'.json';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1000);b.disabled=false})
  .catch(function(){b.disabled=false;document.getElementById('bMsg').innerHTML='<div class="msg bad">Yuklab bo‘lmadi.</div>'})});
function api(body){return fetch('/api/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).catch(function(){return {error:'Internet aloqasini tekshiring.'}})}
document.getElementById('snap').addEventListener('click',function(){var b=this,label=prompt('Nusxa nomi (masalan: oktabr boshi):','Qo‘lda saqlangan nusxa');if(label===null)return;b.disabled=true;
  api({branchId:sel.value,action:'snapshot',label:label||'Qo‘lda saqlangan nusxa',section:'V2'}).then(function(x){b.disabled=false;document.getElementById('bMsg').innerHTML=x.ok?'<div class="msg ok">✓ Saqlandi</div>':'<div class="msg bad">'+esc(x.error||'Bo‘lmadi.')+'</div>';loadBackups()})});
function loadBackups(){var box=document.getElementById('bl');box.innerHTML=haloLoading(3);
  fetch('/api/backups?branch='+encodeURIComponent(sel.value)).then(function(r){return r.json()}).then(function(x){var list=x.backups||[];
    box.innerHTML=list.length?list.slice(0,60).map(function(b){var at=String(b.createdAt||b.created_at||'');return '<div class="list-row"><div style="min-width:0"><b>'+esc(b.action||'O‘zgarish')+'</b><br><small style="color:var(--muted)">'+esc(at.slice(0,16).replace('T',' '))+' · '+esc(b.actor||'')+(b.section?' · '+esc(b.section):'')+'</small></div><button class="ghost" data-r="'+esc(b.id)+'" data-l="'+esc(b.action||'')+'" style="min-height:32px;padding:2px 10px">Oldingi holat</button></div>'}).join(''):'<p class="hint">Nusxa yo‘q.</p>';
    box.querySelectorAll('[data-r]').forEach(function(btn){btn.addEventListener('click',function(){
      var w=prompt('DIQQAT: filial ma’lumoti “'+btn.dataset.l+'” o‘zgarishidan OLDINGI holatga qaytadi. Keyingi barcha yozuvlar (savdo, xarajat…) shu nusxada bo‘lmaydi.\\n\\nDavom etish uchun QAYTAR deb yozing:');
      if(w!=='QAYTAR')return;btn.disabled=true;
      api({branchId:sel.value,backupId:btn.dataset.r}).then(function(x){btn.disabled=false;if(!x.ok){alert(x.error||'Bo‘lmadi.');return}alert('✓ Qaytarildi. Hozirgi holat ham nusxaga olindi.');loadBackups()})})});
  }).catch(function(){box.innerHTML='<div class="msg bad">Ochilmadi.</div>'})}
sel.addEventListener('change',function(){drawKinds();loadBackups()});period('month');loadBackups();
`,
  });
}
