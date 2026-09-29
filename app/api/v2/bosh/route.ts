import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { readSettings, telegramCall } from "../../../lib/telegram-service";
import { LedgerError } from "../../../core/ledger";
import { flashText, homeReport } from "../../../core/home";
import type { D1Like } from "../../../lib/full-migration";

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
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>HALO Bosh sahifa</title>
<style>
:root{color-scheme:light dark;--bg:#f3f4f6;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#0f766e;--ok:#047857;--ok-soft:#d1fae5;--bad:#b91c1c;--bad-soft:#fee2e2;--warn:#b45309;--warn-soft:#fef3c7}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--card:#16191e;--text:#f3f4f6;--muted:#9ca3af;--line:#262a31;--accent:#2dd4bf;--ok:#34d399;--ok-soft:#064e3b;--bad:#f87171;--bad-soft:#450a0a;--warn:#fbbf24;--warn-soft:#451a03}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px 16px calc(24px + env(safe-area-inset-bottom))}
main{max-width:760px;margin:0 auto;display:grid;gap:14px}
header{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}header h1{font-size:20px;margin:0}header small{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.card h2{font-size:15px;margin:0 0 8px;color:var(--muted);font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.hint{font-size:13px;color:var(--muted);margin:2px 0 0}
select{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:10px 14px;background:var(--accent);color:#fff;cursor:pointer}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.kpi small{display:block;color:var(--muted);font-size:13px}.kpi b{display:block;font-size:22px;font-variant-numeric:tabular-nums;margin-top:2px}
.up{color:var(--ok)}.down{color:var(--bad)}
.gauge{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin:8px 0 4px;position:relative}.gauge i{display:block;height:100%}
.gauge::after{content:"";position:absolute;left:62%;top:0;bottom:0;width:2px;background:var(--text);opacity:.5}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.alert{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;margin-top:8px;text-decoration:none}
.alert.bad{background:var(--bad-soft);color:var(--bad)}.alert.warn{background:var(--warn-soft);color:var(--warn)}.alert span:last-child{white-space:nowrap;font-weight:700}
.msg{padding:12px;border-radius:12px}.msg.ok{background:var(--ok-soft);color:var(--ok)}.msg.bad{background:var(--bad-soft);color:var(--bad)}
nav{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}nav a{display:block;text-align:center;padding:12px 6px;border-radius:12px;background:var(--card);border:1px solid var(--line);color:inherit;text-decoration:none;font-weight:700}
pre{white-space:pre-wrap;font:14px/1.5 ui-monospace,Menlo,monospace;background:var(--bg);border-radius:10px;padding:12px;margin:0 0 10px}
</style></head><body><main>
<header><div><h1>HALO — bosh sahifa</h1><small id="sub">Yangi tizim · sinov</small></div><select id="branch"></select></header>
<nav><a href="/api/v2/kassa">💵 Kassa</a><a href="/api/v2/ombor">📦 Ombor</a><a href="/api/v2/qarz">🧾 Qarz</a><a href="/api/v2/maosh">👥 Maosh</a></nav>
<div id="body"><p class="hint">Yuklanmoqda… (hamma bo'limlar eski tizim bilan yangilanmoqda)</p></div>
</main>
<script>
var BRANCHES=${boot};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function chg(a,b){if(!(b>0))return '';var p=Math.round((a-b)/b*100);return ' <span class="'+(p>=0?'up':'down')+'">'+(p>=0?'▲':'▼')+Math.abs(p)+'%</span>'}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');
function kpi(label,value,hint){return '<div class="kpi"><small>'+label+'</small><b>'+value+'</b>'+(hint?'<div class="hint">'+hint+'</div>':'')+'</div>'}
function load(){
  var body=document.getElementById('body');body.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({branchId:sel.value}).then(function(res){
    if(!res.ok){body.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    var r=res.report,p=r.prime,s=r.sales;
    var pp=p.primePercent,color=pp==null?'var(--line)':pp<=62?'var(--ok)':pp<=68?'var(--warn)':'var(--bad)';
    body.innerHTML=
      '<section class="card"><h2>Diqqat talab qiladi</h2>'+(r.alerts.length?r.alerts.map(function(a){return '<a class="alert '+a.level+'" href="/api/v2/'+a.page+'"><span>'+(a.level==='bad'?'🔴 ':'🟡 ')+esc(a.text)+'</span><span>Ochish ›</span></a>'}).join(''):'<div class="msg ok">✓ Hammasi joyida — muammo topilmadi</div>')+'</section>'
      +'<section class="card"><h2>Savdo</h2><div class="grid">'
      +kpi('Bugun',won(s.today))
      +kpi('Kecha',won(s.yesterday)+chg(s.yesterday,s.weekAgo),'o‘tgan hafta shu kun: '+won(s.weekAgo))
      +kpi('Oy boshidan',won(s.monthToDate)+chg(s.monthToDate,s.lastMonthSamePeriod),'o‘tgan oy shu davr: '+won(s.lastMonthSamePeriod))
      +'</div></section>'
      +'<section class="card"><h2>Prime cost (oy boshidan)</h2><div class="row" style="justify-content:space-between"><b style="font-size:30px">'+(pp==null?'—':pp+'%')+'</b><span class="hint">Maqsad: 60–62% dan past</span></div>'
      +'<div class="gauge"><i style="width:'+Math.min(100,pp||0)+'%;background:'+color+'"></i></div>'
      +'<div class="grid" style="margin-top:10px">'
      +kpi('Oziq-ovqat',won(p.food)+(p.foodPercent!=null?' · '+p.foodPercent+'%':''),'retsept '+won(p.theoreticalFood)+' + chiqit '+won(p.waste)+' + kamomad '+won(p.countLoss))
      +kpi('Ish haqi',won(p.labor)+(p.laborPercent!=null?' · '+p.laborPercent+'%':''),'hisoblangan maosh, bonus bilan')
      +kpi('Boshqa xarajatlar',won(r.expenses.monthToDate),'xarajat, komissiya, kassa farqi')
      +'</div></section>'
      +'<section class="card"><h2>Pul va majburiyatlar</h2><div class="grid">'
      +kpi('Kassa (naqd)',won(r.money.cash))+kpi('Bank',won(r.money.bank))
      +kpi('Kutilayotgan karta/delivery',won(r.money.receivable),r.money.oldestReceivableDays!=null?'eng eskisi '+r.money.oldestReceivableDays+' kun':'')
      +kpi('Yetkazuvchilarga qarz',won(r.debts.total),r.debts.overdueCount?'30+ kun: '+won(r.debts.overdue):'muddati o‘tgani yo‘q')
      +kpi('Maosh (shu oy qoldi)',won(r.payroll.thisMonthToPay),r.payroll.unpaidPast?'o‘tgan oylardan: '+won(r.payroll.unpaidPast):'')
      +'</div></section>'
      +'<section class="card"><h2>Kunlik Telegram hisobot</h2><pre id="flash">'+esc(res.text)+'</pre><div class="row"><button id="tg">✈️ Telegramga yuborish</button><button class="ghost" id="copy">📋 Nusxa</button></div><div id="tmsg" style="margin-top:8px"></div></section>';
    document.getElementById('copy').addEventListener('click',function(){
      var done=function(){document.getElementById('tmsg').innerHTML='<div class="msg ok">✓ Nusxa olindi</div>'};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(res.text).then(done,function(){prompt('Matnni nusxalang:',res.text)})}else{prompt('Matnni nusxalang:',res.text)}
    });
    document.getElementById('tg').addEventListener('click',function(){
      var btn=this;btn.disabled=true;
      api({branchId:sel.value,action:'telegram'}).then(function(x){btn.disabled=false;
        document.getElementById('tmsg').innerHTML=x.ok?'<div class="msg ok">✓ Telegramga yuborildi</div>':'<div class="msg bad">'+esc(x.error)+'</div>'});
    });
  });
}
sel.addEventListener('change',load);load();
</script></body></html>`;
}
