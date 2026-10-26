import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { marginReport } from "../../../core/margins";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — «Marja» (faqat rahbar): hamma taom bitta oynada — narx, tannarx, qancha qoladi (₩ va %).
 * Bosilganda: soliq va karta foizidan keyingi sof qoldiq, delivery platformalaridagi qoldiq, tavsiya narx.
 * Faqat o'qiydi (hisob app/core/margins.ts da).
 */
const PAGE_PATH = "/api/v2/marja";
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
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const { state } = await readHaloState(String(body.branchId || "main"));
    return json({ ok: true, ...marginReport(state as Record<string, unknown>) });
  } catch (error) {
    if (error instanceof Error && /filial/i.test(error.message)) return json({ error: error.message }, 400);
    console.error("[v2/marja]", error);
    return json({ error: "Ochilmadi. Qayta urinib ko‘ring." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Marja", active: "marja", heading: "Marja",
    subtitle: "Har bir taom: narx, tannarx va qancha qoladi",
    headerRight: '<select id="branch"></select>',
    body: `<style>${MARJA_CSS}</style><div id="mj" style="display:grid;gap:16px"><section class="card">${"<div class=\"skeleton\"></div>".repeat(3)}</section></div>`,
    script: `var BRANCHES=${boot};` + MARJA_SCRIPT,
  });
}

const MARJA_CSS = String.raw`
.mj-k{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.mj-k .kpi{min-width:0}
.mj-k .kpi b{font-size:20px}
.mj-head,.mj-r{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}
.mj-head{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;padding:0 12px 6px;border-bottom:1px solid var(--line)}
.mj-head span{text-align:right}
.mj-r{width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:11px 12px;color:var(--text);font:inherit;font-weight:400;cursor:pointer;min-height:auto}
.mj-r b{display:block;font-size:15px;line-height:1.25}
.mj-r small{display:block;color:var(--muted);font-size:12px;margin-top:3px;line-height:1.35}
.mj-r .m{text-align:right;white-space:nowrap}
.mj-r .m b{font-size:15px}
.mj-r .m small{font-weight:800;font-size:13px}
.mj-r.good .m small{color:var(--ok)}.mj-r.mid .m small{color:var(--warn)}.mj-r.low .m small{color:var(--bad)}
.mj-r.good{box-shadow:inset 3px 0 0 var(--ok)}.mj-r.mid{box-shadow:inset 3px 0 0 var(--warn)}.mj-r.low{box-shadow:inset 3px 0 0 var(--bad)}.mj-r.none{opacity:.75}
.mj-d{background:var(--card-2);border-bottom:1px solid var(--line);padding:10px 12px 12px;font-size:13px;display:grid;gap:6px}
.mj-d .line{display:flex;justify-content:space-between;gap:10px}
.mj-d .line span:last-child{text-align:right;font-weight:700;white-space:nowrap}
.mj-tools{display:grid;gap:8px}
`;

const MARJA_SCRIPT = String.raw`
var sel=document.getElementById('branch'),box=document.getElementById('mj'),D=null,SORT='low',CAT='',Q='',NET=false,OPEN='';
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return '₩'+Math.round(Number(n)||0).toLocaleString('en-US')}
function pc(n){return n==null?'—':String(n)+'%'}
function load(){box.innerHTML='<section class="card">'+haloLoading(4)+'</section>';
  fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({branchId:sel.value})}).then(function(r){return r.json()}).catch(function(){return {error:'Internet aloqasini tekshiring.'}})
    .then(function(r){if(!r.ok){box.innerHTML='<div class="msg bad">'+esc(r.error||'Ochilmadi.')+'</div>';return}D=r;draw()})}
sel.addEventListener('change',function(){try{localStorage.setItem('halo-branch',sel.value)}catch(e){}OPEN='';load()});
function val(r){return NET?(r.net?r.net.pct:null):r.marginPct}
function amount(r){return NET?(r.net?r.net.amount:null):r.margin}
function draw(){
  var s=D.summary,rules=D.rules;
  var list=D.rows.filter(function(r){return (!CAT||r.categoryId===CAT)&&(!Q||r.name.toLowerCase().indexOf(Q.toLowerCase())>=0)});
  var ready=list.filter(function(r){return r.level!=='none'}),rest=list.filter(function(r){return r.level==='none'});
  ready.sort(function(a,b){if(SORT==='name')return a.name.localeCompare(b.name);if(SORT==='profit')return (amount(b)||0)-(amount(a)||0);var d=(val(a)||0)-(val(b)||0);return SORT==='high'?-d:d});
  rest.sort(function(a,b){return a.name.localeCompare(b.name)});
  var chip=function(on,attr,v,t){return '<button class="'+(on?'':'ghost')+'" '+attr+'="'+esc(v)+'" style="min-height:34px;padding:4px 12px;white-space:nowrap">'+t+'</button>'};
  box.innerHTML='<section class="card"><div class="mj-k"><div class="kpi"><small>O‘rtacha'+(NET?' sof':'')+'</small><b>'+pc(NET?s.avgNetPct:s.avgMarginPct)+'</b></div>'
      +'<div class="kpi"><small>🔴 Past</small><b>'+s.low+'</b></div><div class="kpi"><small>Retseptsiz</small><b>'+s.incomplete+'</b></div></div>'
      +'<p class="hint" style="margin:10px 0 0">🟢 '+s.good+' ta — tannarx narxning '+rules.targetFoodCost+'% gacha · 🟡 '+s.mid+' ta — '+rules.targetFoodCost+'–'+rules.midFoodCost+'% · 🔴 '+s.low+' ta — '+rules.midFoodCost+'% dan yuqori. Tannarx — retsept va ombordagi oxirgi narxdan. Taomni bossangiz — batafsil.</p></section>'
    +'<section class="card" style="padding-bottom:6px"><div class="mj-tools"><input id="mq" placeholder="🔍 Taom qidirish" value="'+esc(Q)+'">'
      +'<div class="chips">'+chip(SORT==='low','data-s','low','Eng past marja')+chip(SORT==='high','data-s','high','Eng yuqori')+chip(SORT==='profit','data-s','profit','Ko‘p pul qoladigan')+chip(SORT==='name','data-s','name','Nomi')+'</div>'
      +(D.categories.length>1?'<div class="chips">'+chip(!CAT,'data-c','','Hammasi')+D.categories.map(function(c){return chip(CAT===c.id,'data-c',c.id,esc(c.name))}).join('')+'</div>':'')
      +'<label style="display:flex;gap:10px;align-items:center;margin:0 0 6px;cursor:pointer"><input type="checkbox" id="mnet"'+(NET?' checked':'')+' style="width:22px;height:22px;min-height:auto;flex:0 0 auto"><span>Sof marja <small style="color:var(--muted)">(soliq '+rules.taxPct+'% + karta '+rules.cardPct+'% ayrilgan)</small></span></label></div>'
      +'<div class="mj-head"><div>Taom · '+list.length+' ta</div><span>'+(NET?'Sof qoladi':'Marja')+'</span></div>'
      +ready.map(row).join('')+rest.map(row).join('')+(list.length?'':'<p class="hint" style="padding:12px 10px">Topilmadi.</p>')+'</section>';
  var q=document.getElementById('mq');q.addEventListener('input',function(){Q=q.value;var p=q.selectionStart;draw();var n=document.getElementById('mq');n.focus();try{n.setSelectionRange(p,p)}catch(e){}});
  box.querySelectorAll('[data-s]').forEach(function(b){b.addEventListener('click',function(){SORT=b.dataset.s;draw()})});
  box.querySelectorAll('[data-c]').forEach(function(b){b.addEventListener('click',function(){CAT=b.dataset.c;draw()})});
  document.getElementById('mnet').addEventListener('change',function(){NET=this.checked;draw()});
  box.querySelectorAll('[data-o]').forEach(function(b){b.addEventListener('click',function(){OPEN=OPEN===b.dataset.o?'':b.dataset.o;draw()})});
}
function row(r){
  var a=amount(r),v=val(r);
  var h='<button class="mj-r '+r.level+'" data-o="'+esc(r.id)+'" type="button"><div><b>'+esc(r.name)+'</b><small>'
      +(r.salePrice>0?won(r.salePrice)+' narx':'narx yo‘q')+' · '+(r.cost==null?'tannarx —':won(r.cost)+' tannarx')+(r.categoryName?' · '+esc(r.categoryName):'')
      +(r.level==='none'?'<br><span style="color:var(--warn)">'+esc(r.status)+'</span>':'')+'</small></div>'
    +'<div class="m">'+(a==null?'<b>—</b>':'<b>'+won(a)+'</b><small>'+pc(v)+'</small>')+'</div></button>';
  if(OPEN!==r.id)return h;
  var d='<div class="mj-d">';
  if(r.level==='none'){d+='<div>'+esc(r.status)+' — marjani hisoblash uchun «Menyu»da retsept va narxni to‘ldiring.</div>'}
  else{
    d+='<div class="line"><span>Tannarx narxning</span><span>'+pc(r.foodCostPct)+'</span></div>'
      +'<div class="line"><span>Marja (narx − tannarx)</span><span>'+won(r.margin)+' · '+pc(r.marginPct)+'</span></div>'
      +'<div class="line"><span>Sof: soliq '+D.rules.taxPct+'% + karta '+D.rules.cardPct+'% ayrilsa</span><span>'+won(r.net.amount)+' · '+pc(r.net.pct)+'</span></div>'
      +r.delivery.map(function(x){return '<div class="line"><span>'+esc(x.label)+' '+won(x.price)+' · platforma '+x.feePct+'% + soliq</span><span>'+won(x.left)+' · '+pc(x.leftPct)+'</span></div>'}).join('')
      +(r.level!=='good'&&r.suggestedPrice?'<div class="line"><span>Tannarx '+D.rules.targetFoodCost+'% bo‘lishi uchun narx</span><span>'+won(r.suggestedPrice)+'</span></div>':'');
  }
  return h+d+'<a href="/api/v2/menyu" class="hint" style="text-decoration:none">✏️ Retsept va narx — «Menyu» bo‘limida ›</a></div>';
}
load();
`;
