import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { readDeductionRules } from "../../../core/deductions";
import { PRICE_CALC_JS, PRICE_STEPS } from "../../../core/price-calc";
import { shell } from "../../../core/ui-shell";

/**
 * HALO V2 — narx va foiz kalkulyatori: tannarxdan narx (30/35/40% va boshqa), ustama, foiz qo'shish/ayirish,
 * ichidagi foizni ajratish, ikki son orasidagi foiz. Formula app/core/price-calc.ts (menyu bilan bir xil).
 */
declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
const PAGE_PATH = "/api/v2/kalkulyator";

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = await listHaloBranches();
  let deduction = { taxPct: 0, cardPct: 0 };
  try {
    const rules = readDeductionRules((await readHaloState(branches[0]?.id || "main")).state as Record<string, unknown>);
    deduction = { taxPct: rules.taxPct, cardPct: rules.cardPct };
  } catch { /* foizlar sozlanmagan bo'lsa 0 */ }
  return new Response(page(deduction), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function page(deduction: { taxPct: number; cardPct: number }): string {
  return shell({
    title: "Narx kalkulyatori", active: "menyu", heading: "Narx va foiz kalkulyatori",
    subtitle: "Tannarxdan sotuv narxini topish, foiz qo‘shish va ayirish",
    body: `<section class="card"><div class="row" id="tabs" style="gap:8px"></div></section><div id="pane" style="display:grid;gap:16px"></div>`,
    script: `
var DED=${JSON.stringify(deduction)},STEPS=${JSON.stringify(PRICE_STEPS)},TAB='cost',S={cost:'',pcts:'30, 35, 40',step:100,ded:false,x:'',p:'',a:'',b:''};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return n==null?'—':pcFmt(Math.round(n),0)+' ₩'}
var TABS={cost:'🧮 Tannarx → narx',pct:'％ Foiz qo‘shish / ayirish',two:'↔ Ikki son'};
function tabs(){document.getElementById('tabs').innerHTML=Object.keys(TABS).map(function(k){return '<button class="'+(TAB===k?'':'ghost')+'" data-t="'+k+'" style="min-height:40px;padding:8px 12px">'+TABS[k]+'</button>'}).join('');
  document.querySelectorAll('[data-t]').forEach(function(b){b.addEventListener('click',function(){TAB=b.dataset.t;render()})})}
function render(){tabs();var pane=document.getElementById('pane');
  if(TAB==='cost')pane.innerHTML='<section class="card"><label class="field"><span>Tannarx (₩)</span><input class="money" id="cost" inputmode="numeric" placeholder="5,000" value="'+esc(S.cost)+'"></label>'
    +'<label class="field"><span>Tannarx sotuv narxining necha foizi bo‘lsin (bir nechta bo‘lsa vergul bilan; o‘nlik uchun nuqta: 32.5)</span><input id="pcts" inputmode="decimal" value="'+esc(S.pcts)+'"></label>'
    +'<div class="row" style="gap:8px;margin-bottom:10px">'+STEPS.map(function(o){return '<button class="'+(S.step===o.step?'':'ghost')+'" data-s="'+o.step+'" style="min-height:36px;padding:4px 12px">'+o.label+'</button>'}).join('')+'</div>'
    +'<label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="ded" style="width:18px;height:18px;min-height:auto"'+(S.ded?' checked':'')+'> Soliq ('+DED.taxPct+'%) va karta ('+DED.cardPct+'%) ushlanmasidan keyin (POS savdo)</label></section>'
    +'<section class="card"><h2>Natija</h2><div id="out"></div></section>';
  if(TAB==='pct')pane.innerHTML='<section class="card"><div class="row"><label class="field" style="flex:2"><span>Son yoki summa</span><input class="money" id="x" inputmode="numeric" placeholder="5,000" value="'+esc(S.x)+'"></label><label class="field" style="flex:1"><span>Foiz (%)</span><input id="p" inputmode="decimal" placeholder="30" value="'+esc(S.p)+'" style="font-size:24px;font-weight:800;text-align:right"></label></div></section><section class="card"><h2>Natija</h2><div id="out"></div></section>';
  if(TAB==='two')pane.innerHTML='<section class="card"><div class="row"><label class="field" style="flex:1"><span>A (masalan tannarx yoki eski narx)</span><input class="money" id="a" inputmode="numeric" value="'+esc(S.a)+'"></label><label class="field" style="flex:1"><span>B (masalan sotuv yoki yangi narx)</span><input class="money" id="b" inputmode="numeric" value="'+esc(S.b)+'"></label></div></section><section class="card"><h2>Natija</h2><div id="out"></div></section>';
  ['cost','x','a','b'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',function(){var v=pcNum(el.value);el.value=v?v.toLocaleString('en-US'):'';S[id]=el.value;calc()})});
  ['pcts','p'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('input',function(){S[id]=el.value;calc()})});
  document.querySelectorAll('[data-s]').forEach(function(b){b.addEventListener('click',function(){S.step=Number(b.dataset.s);render()})});
  var d=document.getElementById('ded');if(d)d.addEventListener('change',function(){S.ded=d.checked;calc()});
  calc();
}
function row(label,value,hint){return '<div class="list-row"><div><b>'+label+'</b>'+(hint?'<br><small style="color:var(--muted)">'+hint+'</small>':'')+'</div><b style="font-size:20px;font-variant-numeric:tabular-nums">'+value+'</b></div>'}
function calc(){var out=document.getElementById('out');if(!out)return;
  if(TAB==='cost'){var cost=pcNum(S.cost),ded=S.ded?Math.round((DED.taxPct+DED.cardPct)*100)/100:0;
    if(!(cost>0)){out.innerHTML='<p class="hint">Tannarxni yozing.</p>';return}
    var list=String(S.pcts).split(/[,;\\s\\/]+/).map(function(v){return Number(v)}).filter(function(p){return p>0&&p<100});if(!list.length)list=[30,35,40];
    out.innerHTML='<table><tr><th>Tannarx foizi</th><th class="n">Sotuv narxi</th><th class="n">Foyda</th></tr>'+list.map(function(p){var r=pcPriceForCost(cost,p,ded,S.step);
      return '<tr><td><b>'+pcFmt(p,2)+'%</b><br><small style="color:var(--muted)">aniq '+pcFmt(r.exact,0)+' ₩ · haqiqiy '+pcFmt(r.realPct,1)+'%'+(ded?' · qo‘lga tegadi '+won(r.net):'')+'</small></td><td class="n" style="white-space:nowrap"><b style="font-size:18px">'+won(r.price)+'</b></td><td class="n" style="white-space:nowrap">'+won(r.profit)+'</td></tr>'}).join('')+'</table>'
      +'<p class="hint" style="margin-top:12px">Formula: narx = tannarx × 100 ÷ foiz'+(ded?' ÷ (1 − '+pcFmt(ded,2)+'%)':'')+'. Masalan '+won(cost)+' × 100 ÷ '+pcFmt(list[0],2)+' = '+pcFmt(pcPriceForCost(cost,list[0],0,1).exact,2)+' ₩.</p>'
      +'<h3 style="font-size:15px;margin:16px 0 4px">Ustama bilan (tannarx + foiz)</h3>'+list.map(function(p){var m=pcMarkup(cost,p,S.step);return row(won(cost)+' + '+pcFmt(p,2)+'%',won(m.price),'foyda '+won(m.profit)+' · tannarx narxning '+pcFmt(m.realPct,1)+'%')}).join('');
    return}
  if(TAB==='pct'){var x=pcNum(S.x),p=pcP(S.p);if(!(x>0)||!(p>0)){out.innerHTML='<p class="hint">Son va foizni yozing.</p>';return}var ins=pcInside(x,p);
    out.innerHTML=row(pcFmt(x)+' + '+pcFmt(p)+'%',pcFmt(pcAdd(x,p)),'foiz qo‘shildi')+row(pcFmt(x)+' − '+pcFmt(p)+'%',pcFmt(pcSub(x,p)),'foiz ayirildi (chegirma)')+row(pcFmt(x)+' ning '+pcFmt(p)+'%',pcFmt(pcPart(x,p)),'foizning o‘zi')
      +row(pcFmt(p)+'% ichida bo‘lsa — asosiy summa',pcFmt(ins.base),'masalan soliq ichida: '+pcFmt(x)+' = '+pcFmt(ins.base)+' + '+pcFmt(ins.part));return}
  var a=pcNum(S.a),b=pcNum(S.b);if(!(a>0)||!(b>0)){out.innerHTML='<p class="hint">Ikkala sonni yozing.</p>';return}
  out.innerHTML=row('A — B ning necha foizi',pcFmt(pcRatio(a,b))+'%','masalan tannarx sotuv narxining '+pcFmt(pcRatio(a,b),1)+'%')+row('B — A ning necha foizi',pcFmt(pcRatio(b,a))+'%')+row('A dan B ga o‘zgarish',(pcChange(a,b)>0?'+':'')+pcFmt(pcChange(a,b))+'%','narx '+(b>a?'oshdi':'kamaydi')+': '+pcFmt(Math.abs(b-a)))+row('Farq',pcFmt(b-a));
}
render();
${PRICE_CALC_JS}`,
  });
}
