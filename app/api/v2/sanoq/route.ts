import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { closeMonth, monthCloseStatus, MonthEndError } from "../../../core/month-close";
import { LedgerError } from "../../../core/ledger";
import { countSheet, saveCounts, type CountInput } from "../../../core/period-count";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/sanoq";
const TENANT_ID = "halo";
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function database(): D1Like {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
}

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
    const scope = { tenantId: TENANT_ID, branchId };
    const today = seoulToday();
    const date = String(body.date || today);
    const { state } = await readHaloState(branchId);
    const data = state as Record<string, unknown>;
    if (body.action === "monthStatus") return json({ ok: true, status: monthCloseStatus(data, today) });
    if (body.action === "closeMonth") {
      const month = String(body.month || "");
      if (!monthCloseStatus(data, today).options.some((option) => option.month === month && option.canClose)) return json({ error: "Bu oyni hozir yopib bo‘lmaydi." }, 409);
      const mutation = await mutateHaloState((current) => closeMonth(current as Record<string, unknown>, month), 3, branchId, "Rahbar", `Oy yakunlandi · ${month}`, "Oy yakuni");
      const { state: after } = await readHaloState(branchId);
      return json({ ok: true, result: mutation.result, status: monthCloseStatus(after as Record<string, unknown>, today) });
    }
    if (body.action === "save") {
      const result = await saveCounts(database(), scope, data, today, {
        date, operationId: String(body.operationId || ""), actor: "Rahbar", counts: (Array.isArray(body.counts) ? body.counts : []) as CountInput[],
      });
      return json({ ok: true, today, ...result });
    }
    return json({ ok: true, today, sheet: await countSheet(database(), scope, data, today, date) });
  } catch (error) {
    if (error instanceof MonthEndError) return json({ error: error.message }, 409);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Oy yakuni sanog‘i", active: "sanoq", heading: "Oy yakuni sanog‘i",
    subtitle: "Pul, ombor va qarzlarni haqiqatda sanang — bu yangi oyning tasdiqlangan boshlanishi bo'ladi",
    headerRight: '<div class="row"><input type="date" id="date"><select id="branch"></select></div>',
    body: `<section class="card"><div class="row" style="justify-content:space-between"><div id="progress" class="hint" style="margin:0">Yuklanmoqda…</div>
<label class="row" style="gap:8px;font-size:14px;color:var(--muted)"><input type="checkbox" id="showSys" style="min-height:auto;width:18px;height:18px"> Tizim qoldig'ini ko'rsatish</label></div>
<div class="row" style="margin-top:12px" id="tabs"></div></section>
<section class="card"><div id="tools"></div><div id="lines"></div>
<div class="row" style="margin-top:16px"><button id="save" class="block">Kiritilganlarni saqlash</button></div><div id="msg"></div></section>
<section class="card"><h2>Natija: farqlar</h2><div id="result"><p class="hint">Saqlangandan keyin tizim bilan farq shu yerda chiqadi.</p></div></section>
<section class="card" id="oy"><h2>🔒 Oyni yopish</h2><p class="hint">Oy hisoboti (savdo, xarajat, foyda, maosh, ombor qiymati) muzlatiladi — keyin o‘sha oyga yozuv qo‘shilmaydi va o‘zgarmaydi. Ombor qoldig‘i keyingi oyga o‘tadi. Oyning oxirgi kuni, ish tugagach va sanoqdan keyin yoping.</p><div id="mc"><p class="hint">Yuklanmoqda…</p></div></section>`,
    script: `
var BRANCHES=${boot},SHEET=null,TAB='money',OP='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function qty(n,u){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:3})+' '+esc(u)}
function uid(){return 'sanoq-'+(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2))}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch'),dt=document.getElementById('date'),show=document.getElementById('showSys');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var DRAFT={};
function key(l){return l.domain+'|'+l.refId}
var TABS={money:'💵 Pul',stock:'📦 Ombor',debt:'🧾 Qarzlar'};
function load(){
  document.getElementById('lines').innerHTML=haloLoading(4);
  api({branchId:sel.value,date:dt.value||undefined}).then(function(res){
    if(!res.ok){document.getElementById('lines').innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    SHEET=res.sheet;dt.value=SHEET.date;dt.max=res.today;OP=uid();DRAFT={};render();
  });
}
function render(){
  var s=SHEET,t=s.totals;
  document.getElementById('progress').innerHTML='<b style="color:var(--text)">'+t.counted+' / '+t.total+'</b> ta qator sanalgan · '+esc(s.date);
  document.getElementById('tabs').innerHTML=Object.keys(TABS).map(function(k){var all=s.lines.filter(function(l){return l.domain===k}),done=all.filter(function(l){return l.counted!=null}).length;
    return '<button class="'+(k===TAB?'':'ghost')+'" data-tab="'+k+'">'+TABS[k]+' <span style="opacity:.7;font-weight:600">'+done+'/'+all.length+'</span></button>'}).join('');
  document.querySelectorAll('[data-tab]').forEach(function(b){b.addEventListener('click',function(){TAB=b.dataset.tab;render()})});
  document.getElementById('tools').innerHTML=TAB==='stock'?'<input id="q" placeholder="🔍 Mahsulot qidirish" style="width:100%;margin-bottom:10px">':'';
  var q=document.getElementById('q');if(q)q.addEventListener('input',function(){drawLines(q.value)});
  drawLines('');drawResult();
}
function drawLines(filter){
  var f=String(filter||'').toLowerCase(),lines=SHEET.lines.filter(function(l){return l.domain===TAB&&(!f||l.name.toLowerCase().indexOf(f)>=0)});
  var hint={money:'Har bir kassadagi naqd pulni sanang; bank — bank ilovasidagi qoldiq; karta/delivery — hali tushmagan summa.',stock:'Har bir mahsulotni tortib/sanab, haqiqiy miqdorni yozing.',debt:'Har bir yetkazib beruvchi bilan solishtirilgan (akt bo‘yicha) qarz summasini yozing.'}[TAB];
  document.getElementById('lines').innerHTML='<p class="hint">'+hint+'</p>'+(lines.length?lines.map(function(l){var k=key(l),d=DRAFT[k]||{};
    return '<div class="list-row" style="grid-template-columns:1fr minmax(120px,170px)"><div><b>'+esc(l.name)+'</b>'
      +(l.counted!=null?'<br><small style="color:var(--muted)">Sanalgan: '+(l.domain==='stock'?qty(l.counted,l.unit):won(l.counted))+(l.difference?' · <span style="color:var(--'+(l.difference<0?'bad':'warn')+')">farq '+(l.domain==='stock'?qty(l.difference,l.unit):won(l.difference))+'</span>':' · ✓')+'</small>':'')
      +(show.checked?'<br><small style="color:var(--muted)">Tizimda: '+(l.domain==='stock'?qty(l.system,l.unit):won(l.system))+'</small>':'')+'</div>'
      +'<input inputmode="decimal" data-k="'+esc(k)+'" placeholder="'+(l.domain==='stock'?esc(l.unit):'₩')+'" value="'+esc(d.v||'')+'" style="text-align:right;font-weight:700;width:100%"></div>'}).join(''):'<p class="hint">Bu bo‘limda qator yo‘q.</p>');
  document.querySelectorAll('#lines input[data-k]').forEach(function(i){i.addEventListener('input',function(){var v=i.value.replace(/[^0-9.\\-]/g,'');DRAFT[i.dataset.k]={v:v};})});
}
function drawResult(){
  var diff=SHEET.lines.filter(function(l){return l.difference});
  var t=SHEET.totals;
  document.getElementById('result').innerHTML=(t.counted?'<div class="grid">'
    +'<div class="kpi"><small>Pul farqi</small><b style="color:var(--'+(t.money<0?'bad':t.money>0?'warn':'ok')+')">'+won(t.money)+'</b></div>'
    +'<div class="kpi"><small>Ombor farqi (qiymat)</small><b style="color:var(--'+(t.stock<0?'bad':t.stock>0?'warn':'ok')+')">'+won(t.stock)+'</b></div>'
    +'<div class="kpi"><small>Qarz farqi</small><b style="color:var(--'+(t.debt?'warn':'ok')+')">'+won(t.debt)+'</b></div></div>':'<p class="hint">Hali hech narsa sanalmagan.</p>')
    +(diff.length?'<table style="margin-top:12px"><tr><th>Nima</th><th class="n">Tizimda</th><th class="n">Sanaldi</th><th class="n">Farq</th></tr>'+diff.map(function(l){var st=l.domain==='stock';
      return '<tr><td>'+esc(l.name)+'</td><td class="n">'+(st?qty(l.system,l.unit):won(l.system))+'</td><td class="n">'+(st?qty(l.counted,l.unit):won(l.counted))+'</td><td class="n" style="color:var(--'+(l.difference<0?'bad':'warn')+')">'+(st?qty(l.difference,l.unit)+(l.differenceWon!=null?'<br><small>'+won(l.differenceWon)+'</small>':''):won(l.difference))+'</td></tr>'}).join('')+'</table>':(t.counted?'<div class="msg ok" style="margin-top:12px">✓ Sanalganlarning hammasi tizim bilan mos</div>':''));
}
document.getElementById('save').addEventListener('click',function(){
  var counts=[],msg=document.getElementById('msg');
  Object.keys(DRAFT).forEach(function(k){var v=DRAFT[k].v;if(v===''||v==null)return;var p=k.split('|');counts.push({domain:p[0],refId:p.slice(1).join('|'),counted:Number(v)})});
  if(!counts.length){msg.innerHTML='<div class="msg bad">Hech narsa kiritilmagan.</div>';return}
  if(counts.some(function(c){return !isFinite(c.counted)})){msg.innerHTML='<div class="msg bad">Son noto‘g‘ri yozilgan.</div>';return}
  if(!confirm(counts.length+' ta qator saqlansinmi? Saqlangan sanoqni o‘zgartirib bo‘lmaydi (kerak bo‘lsa qayta sanaysiz).'))return;
  var btn=this;btn.disabled=true;
  api({action:'save',branchId:sel.value,date:dt.value,operationId:OP,counts:counts}).then(function(res){btn.disabled=false;
    if(!res.ok){msg.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    SHEET=res.sheet;OP=uid();DRAFT={};msg.innerHTML='<div class="msg ok">✓ '+res.saved+' ta qator saqlandi</div>';render();
  });
});
show.addEventListener('change',function(){drawLines((document.getElementById('q')||{}).value)});
function drawMonth(st){var box=document.getElementById('mc');
  var L=st.last?'<div class="grid" style="margin-bottom:12px"><div class="kpi"><small>'+esc(st.last.month)+' savdo</small><b>'+won(st.last.revenue)+'</b></div><div class="kpi"><small>Xarajat</small><b>'+won(st.last.expenses)+'</b></div><div class="kpi"><small>Sof foyda</small><b>'+won(st.last.netProfit)+'</b></div><div class="kpi"><small>Maosh (hisoblangan)</small><b>'+won(st.last.payrollGross)+'</b></div></div><p class="hint">Oxirgi yopilgan oy: '+esc(st.last.month)+' · ombor qiymati '+won(st.last.inventoryValue)+'</p>':'';
  box.innerHTML=L+st.options.map(function(o){return '<div class="list-row"><div><b>'+esc(o.month)+'</b>'+(o.closed?' <span class="tag ok">yopilgan</span>':'')+(o.reason&&!o.closed?'<br><small style="color:var(--muted)">'+esc(o.reason)+'</small>':'')+'</div>'+(o.canClose?'<button data-close="'+esc(o.month)+'">Oyni yopish</button>':'<span></span>')+'</div>'}).join('');
  box.querySelectorAll('[data-close]').forEach(function(b){b.addEventListener('click',function(){var m=b.dataset.close;
    if(!confirm(m+' oyini yopasizmi?\\n\\n• Oy savdosi, xarajati, foydasi va maoshi muzlatiladi\\n• Ombor qoldig‘i keyingi oyga o‘tadi\\n• Yopilgan oyga keyin yozuv qo‘shib yoki o‘zgartirib bo‘lmaydi'))return;b.disabled=true;
    api({action:'closeMonth',branchId:sel.value,month:m}).then(function(x){if(!x.ok){b.disabled=false;alert(x.error||'Bo‘lmadi.');return}drawMonth(x.status);box.insertAdjacentHTML('afterbegin','<div class="msg ok" style="margin-bottom:10px">✓ '+esc(m)+' yopildi. Sof foyda: '+won(x.result.netProfit)+'</div>')})})});
}
function loadMonth(){api({action:'monthStatus',branchId:sel.value}).then(function(x){if(x.ok)drawMonth(x.status);else document.getElementById('mc').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>'})}
sel.addEventListener('change',function(){load();loadMonth()});dt.addEventListener('change',load);load();loadMonth();
`,
  });
}
