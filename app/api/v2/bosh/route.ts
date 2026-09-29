import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { readSettings, telegramCall } from "../../../lib/telegram-service";
import { LedgerError } from "../../../core/ledger";
import { flashText, homeReport } from "../../../core/home";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/bosh";
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
    const branch = (await listHaloBranches()).find((item) => item.id === branchId);
    if (!branch) return json({ error: "Filial topilmadi." }, 400);
    if (body.action === "compare") {
      const rows = [];
      for (const item of await listHaloBranches()) {
        const { state: branchState } = await readHaloState(item.id);
        const r = await homeReport(database(), { tenantId: TENANT_ID, branchId: item.id }, branchState as Record<string, unknown>, seoulToday());
        rows.push({
          id: item.id, name: item.name, yesterday: r.sales.yesterday, monthToDate: r.sales.monthToDate, primePercent: r.prime.primePercent,
          cash: r.money.cash, bad: r.alerts.filter((alert) => alert.level === "bad").length, warn: r.alerts.filter((alert) => alert.level === "warn").length,
        });
      }
      return json({ ok: true, branches: rows });
    }
    const { state } = await readHaloState(branchId);
    const report = await homeReport(database(), { tenantId: TENANT_ID, branchId }, state as Record<string, unknown>, seoulToday());
    const text = flashText(report, `HALO ${branch.name}`);
    if (body.action === "telegram") {
      const settings = await readSettings();
      if (!settings.botToken || !settings.chatId) return json({ error: "Yangi saytda Telegram bot hali ulanmagan. Matnni nusxa olib yuboring." }, 400);
      try {
        await telegramCall(settings.botToken, "sendMessage", { chat_id: settings.chatId, text, disable_web_page_preview: true });
      } catch {
        return json({ error: "Telegramga yuborib bo'lmadi. Bot sozlamasini tekshiring." }, 502);
      }
      return json({ ok: true, sent: true });
    }
    return json({ ok: true, report, text });
  } catch (error) {
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Bosh sahifa", active: "bosh", heading: "Bugun HALO'da", subtitle: '<span id="sub">Yuklanmoqda…</span>',
    headerRight: '<select id="branch"></select>',
    body: `<div id="body" style="display:grid;gap:16px"><section class="card"><div class="skeleton" style="width:60%"></div><div class="skeleton" style="margin-top:12px;width:85%"></div><div class="skeleton" style="margin-top:12px;width:40%"></div></section></div>`,
    script: `
var BRANCHES=${boot};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function short(n){n=Number(n||0);var a=Math.abs(n);return (n<0?'−':'')+(a>=1e6?(a/1e6).toFixed(a>=1e7?0:1)+'M':a>=1e3?Math.round(a/1e3)+'k':String(a))}
function chg(a,b){if(!(b>0))return '';var p=Math.round((a-b)/b*100);return ' <span class="'+(p>=0?'up':'down')+'">'+(p>=0?'▲':'▼')+Math.abs(p)+'%</span>'}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
if(BRANCHES.length<2)sel.hidden=true;
function kpi(label,value,hint){return '<div class="kpi"><small>'+label+'</small><b>'+value+'</b>'+(hint?'<div class="hint">'+hint+'</div>':'')+'</div>'}
function chart(days){
  var max=Math.max.apply(null,days.map(function(d){return d.amount}).concat([1]));
  return '<div class="bars" role="img" aria-label="So‘nggi 14 kun savdosi"><span class="max">'+short(max)+'</span>'
    +days.map(function(d,i){return '<div class="b'+(i===days.length-1?' last':'')+'" style="height:'+Math.max(2,Math.round(d.amount/max*100))+'%" title="'+esc(d.date)+': '+won(d.amount)+'"></div>'}).join('')
    +'</div><div class="bar-labels">'+days.map(function(d,i){return '<span>'+(i%2===1||i===days.length-1?d.date.slice(8,10):'')+'</span>'}).join('')+'</div>';
}
function load(){
  var body=document.getElementById('body');
  api({branchId:sel.value}).then(function(res){
    if(!res.ok){body.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    var r=res.report,p=r.prime,s=r.sales,pp=p.primePercent,color=pp==null?'var(--line)':pp<=62?'var(--ok)':pp<=68?'var(--warn)':'var(--bad)';
    var bad=r.alerts.filter(function(a){return a.level==='bad'}).length;
    document.getElementById('sub').textContent=r.today+' · '+(r.alerts.length?(bad?bad+' ta jiddiy, ':'')+r.alerts.length+' ta diqqat talab qiladi':'hammasi joyida ✓');
    body.innerHTML=
      '<section class="card"><h2>Diqqat talab qiladi</h2>'+(r.alerts.length?r.alerts.map(function(a){return '<a class="alert '+a.level+'" href="/api/v2/'+a.page+'"><span>'+esc(a.text)+'</span><span class="go">Ochish ›</span></a>'}).join(''):'<div class="msg ok">✓ Hammasi joyida — muammo topilmadi</div>')+'</section>'
      +'<a class="alert" href="/api/v2/sanoq" style="text-decoration:none"><span>📋 Oy yakuni sanog‘i — pul, ombor va qarzlarni sanash</span><span class="go">Ochish ›</span></a>'
      +'<a class="alert" href="/api/v2/tarix" style="text-decoration:none;margin-top:-8px"><span>🕘 O‘zgarishlar tarixi — nima o‘chirildi va o‘zgartirildi</span><span class="go">Ochish ›</span></a>'
      +'<a class="alert" href="/api/v2/kochish" style="text-decoration:none;margin-top:-8px"><span>🚀 Yangi tizimga to‘liq o‘tish — tekshiruv ro‘yxati</span><span class="go">Ochish ›</span></a>'
      +'<section class="card"><h2>Savdo</h2><div class="grid">'
      +kpi('Bugun',won(s.today),'kun hali tugamagan')
      +kpi('Kecha',won(s.yesterday)+chg(s.yesterday,s.weekAgo),'o‘tgan hafta shu kun: '+won(s.weekAgo))
      +kpi('Oy boshidan',won(s.monthToDate)+chg(s.monthToDate,s.lastMonthSamePeriod),'o‘tgan oy shu davr: '+won(s.lastMonthSamePeriod))
      +'</div><div style="margin-top:14px">'+chart(s.days)+'</div></section>'
      +'<section class="card"><h2>Prime cost · oy boshidan</h2><div class="row" style="justify-content:space-between;align-items:baseline"><span class="big" style="color:'+(pp==null?'inherit':color)+'">'+(pp==null?'—':pp+'%')+'</span><span class="hint" style="margin:0">Maqsad: 62% dan past</span></div>'
      +'<div class="gauge"><i style="width:'+Math.min(100,pp||0)+'%;background:'+color+'"></i></div>'
      +'<p class="hint">Oziq-ovqat tannarxi + ish haqi, savdoga nisbatan. Restoranning eng muhim ko‘rsatkichi.</p>'
      +'<div class="grid">'
      +kpi('Oziq-ovqat'+(p.foodPercent!=null?' · '+p.foodPercent+'%':''),won(p.food),'retsept '+won(p.theoreticalFood)+' · chiqit '+won(p.waste)+' · kamomad '+won(p.countLoss))
      +kpi('Ish haqi'+(p.laborPercent!=null?' · '+p.laborPercent+'%':''),won(p.labor),'hisoblangan maosh, bonus bilan')
      +kpi('Boshqa xarajatlar',won(r.expenses.monthToDate),'xarajat, komissiya, kassa farqi')
      +'</div></section>'
      +'<section class="card"><h2>Pul va majburiyatlar</h2><div class="grid">'
      +kpi('Kassa (naqd)',won(r.money.cash))+kpi('Bank',won(r.money.bank))
      +kpi('Karta/delivery kutilmoqda',won(r.money.receivable),r.money.oldestReceivableDays!=null?'eng eskisi '+r.money.oldestReceivableDays+' kun':'hammasi tushgan')
      +kpi('Yetkazuvchilarga qarz',won(r.debts.total),r.debts.overdueCount?'30+ kun: '+won(r.debts.overdue):'muddati o‘tgani yo‘q')
      +kpi('Maosh · shu oy qoldi',won(r.payroll.thisMonthToPay),r.payroll.unpaidPast?'o‘tgan oylardan: '+won(r.payroll.unpaidPast):'o‘tgan oylar to‘langan')
      +'</div></section>'
      +(BRANCHES.length>1?'<section class="card"><h2>Filiallar solishtiruvi</h2><div id="cmp"><button class="ghost" id="cmpGo">Ikkala filialni solishtirish</button></div></section>':'')
      +'<section class="card"><h2>Kunlik Telegram hisobot</h2><pre id="flash">'+esc(res.text)+'</pre><div class="row"><button id="tg">✈️ Telegramga yuborish</button><button class="ghost" id="copy">📋 Nusxa</button></div><div id="tmsg"></div></section>';
    document.getElementById('copy').addEventListener('click',function(){
      var done=function(){document.getElementById('tmsg').innerHTML='<div class="msg ok">✓ Nusxa olindi</div>'};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(res.text).then(done,function(){prompt('Matnni nusxalang:',res.text)})}else{prompt('Matnni nusxalang:',res.text)}
    });
    document.getElementById('tg').addEventListener('click',function(){
      var btn=this;btn.disabled=true;
      api({branchId:sel.value,action:'telegram'}).then(function(x){btn.disabled=false;
        document.getElementById('tmsg').innerHTML=x.ok?'<div class="msg ok">✓ Telegramga yuborildi</div>':'<div class="msg bad">'+esc(x.error)+'</div>'});
    });
    var cg=document.getElementById('cmpGo');if(cg)cg.addEventListener('click',compare);
  });
}
function compare(){
  var box=document.getElementById('cmp');box.innerHTML=haloLoading(2);
  api({action:'compare'}).then(function(res){
    if(!res.ok){box.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    box.innerHTML='<table><tr><th>Filial</th><th class="n">Kecha</th><th class="n">Oy boshidan</th><th class="n">Prime cost</th><th class="n">Diqqat</th></tr>'
      +res.branches.map(function(b){return '<tr><td><b>'+esc(b.name)+'</b></td><td class="n">'+won(b.yesterday)+'</td><td class="n">'+won(b.monthToDate)+'</td><td class="n">'+(b.primePercent==null?'—':b.primePercent+'%')+'</td><td class="n">'+(b.bad?'<span class="badge bad">'+b.bad+'</span> ':'')+(b.warn?'<span class="badge warn">'+b.warn+'</span>':'')+(!b.bad&&!b.warn?'<span class="badge ok">✓</span>':'')+'</td></tr>'}).join('')+'</table>';
  });
}
sel.addEventListener('change',load);load();
`,
  });
}
