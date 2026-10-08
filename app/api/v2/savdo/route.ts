import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { salesDays, SalesDaysError } from "../../../core/sales-days";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — «Savdo kunlari»: tanlangan davrdagi har kun savdosi bitta oynada (eski tizimdagi «Barcha savdo»
 * o'rniga). Savdosi yo'q kunlar ham ko'rinadi — qaysi kunga POS kiritilmagani darrov bilinadi.
 * Faqat o'qiydi; kunni bosganda «Kiritish» o'sha sana bilan ochiladi.
 */
const PAGE_PATH = "/api/v2/savdo";
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  return new Response(page(branches), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const branchId = String(body.branchId || "main");
    if (!(await listHaloBranches()).some((branch) => branch.id === branchId)) return json({ error: "Filial topilmadi." }, 400);
    const { state } = await readHaloState(branchId);
    return json({ ok: true, ...salesDays(state as Record<string, unknown>, body.from, body.to, seoulToday()) });
  } catch (error) {
    if (error instanceof SalesDaysError) return json({ error: error.message }, error.status);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Savdo kunlari", active: "savdo", heading: "Savdo kunlari",
    subtitle: "Har kun savdosi bitta oynada — qaysi kunga POS kiritilmagani darrov ko‘rinadi",
    headerRight: '<div class="row"><select id="branch"></select></div>',
    // Tartib: 1) davr va jami, 2) diqqat — POS kiritilmagan kunlar, 3) kunma-kun ro'yxat, 4) izoh — pastda.
    body: `<div class="row sd-per" id="per"><button data-p="month">Bu oy</button><button class="ghost" data-p="last">O‘tgan oy</button><button class="ghost" data-p="d30">30 kun</button><button class="ghost" data-p="pick">Sana…</button></div>
<div class="row sd-pick" id="pick" hidden><label class="field"><span>Qaysi kundan</span><input type="date" id="from"></label><label class="field"><span>Qaysi kungacha</span><input type="date" id="to"></label><button id="go">Ko‘rsatish</button></div>
<section class="card" id="sum"><div class="skeleton"></div></section>
<section class="card" id="miss" hidden></section>
<section class="card" id="list"><h2>Kunma-kun</h2><div id="days"></div></section>
<section class="card fold"><details><summary><span><b>Qanday hisoblanadi</b><small>POS, HALO hisob, delivery, bonus</small></span></summary><ul class="sd-rules">
<li><b>POS apparati</b> — karta va POS naqd: Excel hisobot yoki «Kiritish → Savdo»da qo‘lda kiritilgani. «Excel» belgisi — o‘sha kunga POS hisobot fayli yuklangan.</li>
<li><b>HALO hisob</b> — naqd va hisob-raqam (soliqsiz), xodimlar HALO HISOB oynasida kiritadi.</li>
<li><b>Delivery</b> — Coupang, Baemin, Yogiyo.</li>
<li><b>Xodim bonusi</b> — eski tizimdagidek: kunlik savdoning 800 000 ₩ dan oshgan qismining 10%i. Maoshga o‘zi yozilmaydi.</li>
<li>Bugun «POS yo‘q» deb belgilanmaydi — kun hali tugamagan.</li>
<li>Bekor qilingan savdo hisobga kirmaydi.</li>
</ul></details></section>
<style>
.sd-per{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr);gap:8px;margin:0 0 12px}
.sd-per button{min-height:44px;padding:0 4px;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (min-width:700px){.sd-per{display:flex;flex-wrap:wrap}.sd-per button{flex:0 0 auto;padding:0 18px;font-size:15px}}
.sd-pick{align-items:flex-end;margin:0 0 12px}
.sd-pick .field{flex:1 1 140px;margin:0}
.sd-pick button{min-height:46px}
.sd-sub{margin:4px 0 14px}
.sd-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.sd-chip{display:inline-flex;align-items:baseline;gap:6px;padding:10px 12px;min-height:44px;box-sizing:border-box;border-radius:12px;background:var(--warn-soft);color:var(--warn);text-decoration:none;font-weight:800;font-variant-numeric:tabular-nums}
.sd-chip small{font-weight:600;opacity:.85}
.sd-row{display:grid;grid-template-columns:50px minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none}
.sd-row:first-child{border-top:0;padding-top:4px}
.sd-d b{display:block;font-size:16px;font-variant-numeric:tabular-nums}
.sd-d small{display:block;color:var(--muted);font-size:13px}
.sd-m .tag{margin:0 6px 0 0}
.sd-m small{display:block;color:var(--muted);font-size:13px;line-height:1.4;margin-top:4px}
.sd-t{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.sd-t small{display:block;font-weight:600;color:var(--muted);font-size:12px}
.sd-row.miss .sd-d b{color:var(--warn)}
.sd-row.none .sd-t{color:var(--muted)}
.sd-rules{margin:0;padding-left:20px;color:var(--muted);font-size:14.5px;line-height:1.5}
.sd-rules li{margin:0 0 6px}
</style>`,
    script: `
var BRANCHES=${boot},PER='month',TODAY='',FROM='',TO='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var WD=['Yak','Dush','Sesh','Chor','Pay','Jum','Shan'],MON=['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];
function dm(d){return d.slice(8)+'.'+d.slice(5,7)}
function nice(d){return Number(d.slice(8))+'-'+MON[Number(d.slice(5,7))-1]}
function span(a,b){return a===b?nice(a):(a.slice(0,7)===b.slice(0,7)?Number(a.slice(8))+'–'+nice(b):nice(a)+' – '+nice(b))}
function shift(d,n){var t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)}
function kpi(label,value,hint){return '<div class="kpi"><small>'+label+'</small><b>'+value+'</b>'+(hint?'<div class="hint">'+hint+'</div>':'')+'</div>'}
var sel=document.getElementById('branch');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function range(p){
  if(!TODAY)return {};
  if(p==='last'){var end=shift(TODAY.slice(0,8)+'01',-1);return {from:end.slice(0,8)+'01',to:end}}
  if(p==='d30')return {from:shift(TODAY,-29),to:TODAY};
  if(p==='pick')return {from:document.getElementById('from').value,to:document.getElementById('to').value};
  return {from:TODAY.slice(0,8)+'01',to:TODAY};
}
function load(){
  var r=range(PER);
  document.getElementById('sum').innerHTML=haloLoading(2);
  api({branchId:sel.value,from:r.from,to:r.to}).then(draw);
}
function draw(x){
  var sum=document.getElementById('sum'),miss=document.getElementById('miss'),box=document.getElementById('days');
  if(!x.ok){sum.innerHTML='<div class="msg bad">'+esc(x.error||'Ochilmadi.')+'</div>';miss.hidden=true;box.innerHTML='';return}
  TODAY=x.today;FROM=x.from;TO=x.to;
  var f=document.getElementById('from'),t=document.getElementById('to');f.max=t.max=TODAY;if(!f.value)f.value=FROM;if(!t.value)t.value=TO;
  var T=x.totals,n=x.days.length;
  sum.innerHTML='<div class="total">'+won(T.total)+'</div><p class="hint sd-sub">'+esc(span(FROM,TO))+' · '+n+' kundan '+x.enteredDays+' kunda savdo bor</p>'
    +'<div class="grid">'+kpi('POS apparati',won(T.pos),'karta '+won(T.posCard)+' · naqd '+won(T.posCash))+kpi('HALO hisob',won(T.halo),'naqd va hisob-raqam')
    +kpi('Delivery',won(T.delivery))+kpi('Xodim bonusi',won(T.bonus),'800 000 ₩ dan oshgani · 10%')+'</div>';
  var empty={};x.empty.forEach(function(d){empty[d]=1});
  miss.hidden=false;
  miss.innerHTML=x.missingPos.length
    ?'<h2>⚠ POS kiritilmagan: '+x.missingPos.length+' kun</h2><p class="hint" style="margin:0">Kunni bosing — o‘sha kun uchun POS hisobotini kiritish oynasi ochiladi.</p><div class="sd-chips">'
      +x.missingPos.map(function(d){var w=new Date(d+'T00:00:00Z').getUTCDay();return '<a class="sd-chip" href="/api/v2/kiritish?sana='+d+'&amp;t=pos">'+dm(d)+' <small>'+WD[w]+(empty[d]?' · bo‘sh':'')+'</small></a>'}).join('')+'</div>'
      +(x.empty.length?'<p class="hint" style="margin:10px 0 0">«bo‘sh» — u kuni umuman savdo yozilmagan. Dam olish kuni bo‘lsa, e’tibor bermang.</p>':'')
    :'<div class="msg ok">✓ Bu davrdagi hamma kunlarga POS savdosi kiritilgan</div>';
  box.innerHTML=x.days.map(function(d){
    var pos=d.pos.total>0,cls=d.total===0?' none':'',tag;
    if(pos)tag='<span class="tag ok">POS ✓'+(d.pos.excel?' Excel':'')+'</span>';
    else if(d.today)tag='<span class="tag">bugun</span>';
    else{tag='<span class="tag warn">POS yo‘q</span>';cls+=' miss'}
    var parts=[];if(pos)parts.push('POS '+won(d.pos.total));if(d.halo)parts.push('HALO '+won(d.halo));if(d.delivery)parts.push('Delivery '+won(d.delivery));
    var line=parts.length?parts.join(' · '):'Hech narsa kiritilmagan';
    return '<a class="sd-row'+cls+'" href="/api/v2/kiritish?sana='+d.date+'"><div class="sd-d"><b>'+dm(d.date)+'</b><small>'+WD[d.weekday]+'</small></div>'
      +'<div class="sd-m">'+tag+'<small>'+line+'</small></div>'
      +'<div class="sd-t">'+(d.total?won(d.total):'—')+(d.bonus?'<small>bonus '+won(d.bonus)+'</small>':'')+'</div></a>'}).join('');
}
document.querySelectorAll('[data-p]').forEach(function(b){b.addEventListener('click',function(){
  PER=b.dataset.p;document.querySelectorAll('[data-p]').forEach(function(x){x.className=x===b?'':'ghost'});
  document.getElementById('pick').hidden=PER!=='pick';if(PER!=='pick')load();
})});
document.getElementById('go').addEventListener('click',load);
sel.addEventListener('change',load);
load();
`,
  });
}
