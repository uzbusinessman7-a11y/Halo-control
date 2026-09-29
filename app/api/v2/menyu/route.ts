import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { menuReport } from "../../../core/menu";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/menyu";
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
    const { state } = await readHaloState(String(body.branchId || "main"));
    return json({ ok: true, report: menuReport(state as Record<string, unknown>, seoulToday(), Number(body.days) || 30) });
  } catch (error) {
    if (error instanceof Error && /filial/i.test(error.message)) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Menyu", active: "menyu", heading: "Menyu tahlili",
    subtitle: "Qaysi taom pul topib beryapti, qaysi biri yo'q",
    headerRight: '<div class="row"><select id="days"><option value="7">7 kun</option><option value="30" selected>30 kun</option><option value="90">90 kun</option></select><select id="branch"></select></div>',
    body: `<div id="body" style="display:grid;gap:16px"><section class="card"><div class="skeleton"></div><div class="skeleton" style="margin-top:12px"></div></section></div>`,
    script: `
var BRANCHES=${boot};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){if(n==null)return '—';n=Number(n);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch'),days=document.getElementById('days');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var CLS={star:['⭐ Yulduz','Ko‘p sotiladi, foydasi yuqori. Saqlang, sifat va porsiyani o‘zgartirmang.','ok'],
  plowhorse:['🐎 Ishchi ot','Ko‘p sotiladi, lekin foydasi past. Tannarxni kamaytiring yoki narxni ozgina oshiring.','warn'],
  puzzle:['🧩 Jumboq','Foydasi yuqori, lekin kam sotiladi. Menyuda ko‘zga tashlang, kassir tavsiya qilsin.','warn'],
  dog:['⚠️ Zaif','Kam sotiladi va foydasi past. Retseptni o‘zgartiring yoki menyudan olib tashlang.','bad']};
var FILTER='all',R=null;
function load(){
  var body=document.getElementById('body');body.innerHTML='<section class="card">'+haloLoading(4)+'</section>';
  api({branchId:sel.value,days:Number(days.value)}).then(function(res){
    if(!res.ok){body.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    R=res.report;render();
  });
}
function render(){
  var r=R,body=document.getElementById('body');
  var list=r.items.filter(function(i){return FILTER==='all'?true:FILTER==='flag'?i.flags.length:i.cls===FILTER});
  body.innerHTML='<section class="card"><h2>'+esc(r.from)+' — '+esc(r.to)+'</h2><div class="grid">'
    +'<div class="kpi"><small>Sotilgan taomlar</small><b>'+r.totals.sold.toLocaleString('en-US')+' ta</b></div>'
    +'<div class="kpi"><small>Savdo (taomlar bo‘yicha)</small><b>'+won(r.totals.revenue)+'</b></div>'
    +'<div class="kpi"><small>Retsept bo‘yicha foyda</small><b>'+won(r.totals.contribution)+'</b><div class="hint">o‘rtacha '+won(r.totals.avgMargin)+' / dona</div></div>'
    +'</div></section>'
    +'<section class="card"><h2>Guruhlar</h2><div class="grid">'+['star','plowhorse','puzzle','dog'].map(function(k){
      return '<div class="kpi" data-f="'+k+'" style="cursor:pointer'+(FILTER===k?';border-color:var(--accent)':'')+'"><small>'+CLS[k][0]+'</small><b>'+r.counts[k]+' ta</b><div class="hint">'+CLS[k][1]+'</div></div>'}).join('')
    +'</div><div class="row" style="margin-top:12px"><button class="'+(FILTER==='all'?'':'ghost')+'" data-f="all">Hammasi</button><button class="'+(FILTER==='flag'?'':'ghost')+'" data-f="flag">⚠ Muammolilar</button></div>'
    +(r.incomplete?'<div class="msg warn" style="margin-top:12px">'+r.incomplete+' ta taomning retsepti yoki tannarxi to‘liq emas — ular guruhlanmadi. Retseptni to‘ldiring.</div>':'')
    +'</section>'
    +'<section class="card"><h2>Taomlar · foyda bo‘yicha</h2>'+(list.length?list.map(function(i){var c=i.cls?CLS[i.cls]:null;
      return '<div class="item"><b>'+esc(i.name)+(c?'<span class="tag '+c[2]+'">'+c[0]+'</span>':'')+'</b><span class="v">'+won(i.contribution)+'</span>'
        +'<small>'+i.sold.toLocaleString('en-US')+' ta sotildi · narx '+won(i.price)+' · tannarx '+won(i.cost)+(i.costPercent!=null?' ('+i.costPercent+'%)':'')+' · donasidan foyda '+won(i.unitMargin)
        +(i.flags.length?'<br><span style="color:var(--warn)">⚠ '+i.flags.map(esc).join(' · ')+'</span>':'')+'</small></div>'}).join(''):'<p class="hint">Bu guruhda taom yo‘q.</p>')+'</section>';
  body.querySelectorAll('[data-f]').forEach(function(el){el.addEventListener('click',function(){FILTER=el.dataset.f;render()})});
}
sel.addEventListener('change',load);days.addEventListener('change',load);load();
`,
  });
}
