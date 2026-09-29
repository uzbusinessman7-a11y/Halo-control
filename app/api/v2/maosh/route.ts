import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { LedgerError } from "../../../core/ledger";
import { runPayrollBridge } from "../../../core/payroll-bridge";
import { isMonth, payslip, payslipText } from "../../../core/payroll-ledger";
import type { D1Like } from "../../../lib/full-migration";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/maosh";
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
    const month = isMonth(body.month) ? body.month : today.slice(0, 7);
    const { state } = await readHaloState(branchId);
    const bridge = await runPayrollBridge(database(), scope, state as Record<string, unknown>, today);
    if (body.action === "payslip") {
      const slip = await payslip(database(), scope, String(body.employeeId || ""), month);
      return json({ ok: true, payslip: slip, text: payslipText(slip) });
    }
    const employees = bridge.employees.map((employee) => {
      const current = employee.months.find((item) => item.month === month) || null;
      return { employeeId: employee.employeeId, name: employee.name, active: employee.active, current };
    }).filter((employee) => employee.active || employee.current);
    return json({
      ok: true, today, month, employees,
      totals: employees.reduce((sum, employee) => ({
        earned: sum.earned + (employee.current?.earned || 0) + (employee.current?.bonus || 0) - (employee.current?.deduction || 0),
        remaining: sum.remaining + (employee.current?.ledgerRemaining || 0),
      }), { earned: 0, remaining: 0 }),
      checks: {
        mismatched: bridge.mismatched, corrected: bridge.corrected, reversed: bridge.reversed, invalid: bridge.invalid,
        unpaidPast: bridge.unpaidPast, overpaid: bridge.overpaid, advancesWithoutCash: bridge.advancesWithoutCash,
      },
    });
  } catch (error) {
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>HALO Maosh</title>
<style>
:root{color-scheme:light dark;--bg:#f3f4f6;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#0f766e;--ok:#047857;--ok-soft:#d1fae5;--bad:#b91c1c;--bad-soft:#fee2e2;--warn:#b45309;--warn-soft:#fef3c7}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--card:#16191e;--text:#f3f4f6;--muted:#9ca3af;--line:#262a31;--accent:#2dd4bf;--ok:#34d399;--ok-soft:#064e3b;--bad:#f87171;--bad-soft:#450a0a;--warn:#fbbf24;--warn-soft:#451a03}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px 16px calc(24px + env(safe-area-inset-bottom))}
main{max-width:720px;margin:0 auto;display:grid;gap:14px}
header{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}header h1{font-size:20px;margin:0}header small{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.card h2{font-size:15px;margin:0 0 6px;color:var(--muted);font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.hint{font-size:14px;color:var(--muted);margin:0 0 12px}
select,input{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:10px 14px;background:var(--accent);color:#fff;cursor:pointer}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.total{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}
.emp{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:12px 0;border-top:1px solid var(--line);cursor:pointer}.emp:first-of-type{border-top:0}
.emp b{font-size:16px}.emp .v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}.emp small{grid-column:1/-1;color:var(--muted);font-size:13px}
.tag{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:6px}.tag.bad{background:var(--bad-soft);color:var(--bad)}.tag.warn{background:var(--warn-soft);color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:left}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.sum td{font-weight:800;border-bottom:0}
.msg{padding:12px;border-radius:12px;margin-bottom:8px}.msg.bad{background:var(--bad-soft);color:var(--bad)}.msg.ok{background:var(--ok-soft);color:var(--ok)}.msg.warn{background:var(--warn-soft);color:var(--warn)}
@media print{body{background:#fff;color:#000;padding:0}header,#listCard,#checkCard,.noprint{display:none!important}.card{border:0;padding:0}}
</style></head><body><main>
<header><div><h1>Maosh</h1><small>Yangi daftar · sinov</small></div><div class="row"><input type="month" id="month"><select id="branch"></select></div></header>
<section class="card" id="checkCard"><h2>Nazorat</h2><div id="checks"><p class="hint">Yuklanmoqda…</p></div></section>
<section class="card" id="listCard"><h2>Xodimlar</h2><div id="list"></div></section>
<section class="card" id="slipCard" hidden></section>
</main>
<script>
var BRANCHES=${boot},MONTH='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function hours(m){m=Number(m||0);return Math.floor(m/60)+' soat'+(m%60?' '+(m%60)+' daq':'')}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch'),mon=document.getElementById('month');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');
var KIND={earned:'Ish kuni',paid_leave:'Haq to‘lanadigan dam',rounding:'Yaxlitlash',bonus:'Bonus',deduction:'Ushlanma',advance:'Avans',payment:'To‘lov'};
function load(){
  document.getElementById('slipCard').hidden=true;
  api({branchId:sel.value,month:mon.value||undefined}).then(function(res){
    var list=document.getElementById('list'),checks=document.getElementById('checks');
    if(!res.ok){checks.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';list.innerHTML='';return}
    MONTH=res.month;mon.value=res.month;var c=res.checks,out=[];
    if(c.mismatched)out.push('<div class="msg bad">⚠ '+c.mismatched+' ta oyda eski tizim bilan farq bor</div>');
    if(c.invalid.length)out.push('<div class="msg bad">⚠ '+c.invalid.length+' ta yozuv kiritilmadi: '+c.invalid.slice(0,3).map(esc).join(' · ')+'</div>');
    if(c.unpaidPast.length)out.push('<div class="msg warn">O‘tgan oylardan to‘lanmagan: '+c.unpaidPast.map(function(u){return esc(u.name)+' ('+esc(u.month)+') '+won(u.amount)}).join(' · ')+'</div>');
    if(c.overpaid.length)out.push('<div class="msg warn">Ortiqcha to‘langan: '+c.overpaid.map(function(u){return esc(u.name)+' ('+esc(u.month)+') '+won(u.amount)}).join(' · ')+'</div>');
    if(c.advancesWithoutCash)out.push('<div class="msg warn">'+c.advancesWithoutCash+' ta avans faqat maoshdan ayirilgan — kassa/bank hisobidan chiqmagan. Pul qayerdan berilgani yozilmagan.</div>');
    if(c.corrected)out.push('<div class="msg warn">'+c.corrected+' ta yozuv eski tizimda keyin o‘zgartirilgan — tarixi saqlandi</div>');
    if(!out.length)out.push('<div class="msg ok">✓ Hammasi eski tizim bilan wonma-won mos, muammo yo‘q</div>');
    checks.innerHTML=out.join('');
    list.innerHTML='<div class="total">'+won(res.totals.remaining)+'</div><p class="hint">'+esc(res.month)+' uchun to‘lash qolgan · jami hisoblangan '+won(res.totals.earned)+'</p>'
      +res.employees.map(function(e){var m=e.current;
        return '<div class="emp" data-id="'+esc(e.employeeId)+'"><b>'+esc(e.name)+(e.active?'':'<span class="tag warn">ishdan ketgan</span>')+(m&&m.difference?'<span class="tag bad">farq '+won(m.difference)+'</span>':'')+'</b><span class="v">'+won(m?m.ledgerRemaining:0)+'</span>'
          +'<small>'+(m?m.workedDays+' kun · '+hours(m.workedMinutes)+' · hisoblandi '+won(m.earned+m.bonus-m.deduction)+(m.advance+m.paid?' · berildi '+won(m.advance+m.paid):''):'Bu oyda yozuv yo‘q')+' · Varaqa ›</small></div>'}).join('');
    list.querySelectorAll('.emp').forEach(function(el){el.addEventListener('click',function(){openSlip(el.dataset.id)})});
  });
}
function openSlip(id){
  var card=document.getElementById('slipCard');card.hidden=false;card.innerHTML='<p class="hint">Yuklanmoqda…</p>';card.scrollIntoView({behavior:'smooth'});
  api({action:'payslip',branchId:sel.value,employeeId:id,month:MONTH}).then(function(res){
    if(!res.ok){card.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    var p=res.payslip;
    card.innerHTML='<h2>Hisob varaqasi</h2><h3 style="margin:6px 0">'+esc(p.employee.name)+' · '+esc(p.month)+'</h3>'
      +'<p class="hint">'+p.workedDays+' kun ishladi · '+hours(p.workedMinutes)+(p.paidLeaveDays?' · haq to‘lanadigan dam: '+p.paidLeaveDays+' kun':'')+'</p>'
      +'<table><tr><th>Sana</th><th>Yozuv</th><th class="n">Summa</th></tr>'
      +p.lines.map(function(l){return '<tr><td>'+esc(l.date.slice(5))+'</td><td>'+esc(KIND[l.kind]||l.kind)+(l.memo?'<br><small style="color:var(--muted)">'+esc(l.memo)+'</small>':'')+'</td><td class="n">'+(l.amount>0?'+':'−')+won(Math.abs(l.amount))+'</td></tr>'}).join('')
      +'<tr class="sum"><td colspan="2">Hisoblandi (bonus va ushlanma bilan)</td><td class="n">'+won(p.gross)+'</td></tr>'
      +'<tr class="sum"><td colspan="2">Berildi (avans + to‘lov)</td><td class="n">'+won(p.advance+p.paid)+'</td></tr>'
      +'<tr class="sum"><td colspan="2">'+(p.remaining>=0?'To‘lanishi kerak':'Ortiqcha to‘langan')+'</td><td class="n">'+won(Math.abs(p.remaining))+'</td></tr></table>'
      +(p.earlierMonths?'<p class="hint" style="margin-top:10px">Oldingi oylardan '+(p.earlierMonths>0?'to‘lanmagan: ':'ortiqcha to‘langan: ')+won(Math.abs(p.earlierMonths))+'</p>':'')
      +(p.corrections.length?'<details class="noprint" style="margin-top:10px"><summary>'+p.corrections.length+' ta tuzatish tarixi</summary>'+p.corrections.map(function(c){return '<div class="hint">'+esc(c.date)+' · '+won(c.amount)+' · '+esc(c.memo)+'</div>'}).join('')+'</details>':'')
      +'<div class="row noprint" style="margin-top:12px"><button id="copy">📋 Xodimga yuborish uchun nusxa</button><button class="ghost" id="print">🖨 Chop etish / PDF</button></div><div id="cmsg" class="noprint"></div>';
    document.getElementById('print').addEventListener('click',function(){window.print()});
    document.getElementById('copy').addEventListener('click',function(){
      var done=function(){document.getElementById('cmsg').innerHTML='<div class="msg ok" style="margin-top:10px">✓ Nusxa olindi — Telegram yoki KakaoTalk’ga joylang</div>'};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(res.text).then(done,function(){prompt('Matnni nusxalang:',res.text)})}else{prompt('Matnni nusxalang:',res.text)}
    });
  });
}
sel.addEventListener('change',load);mon.addEventListener('change',load);load();
</script></body></html>`;
}
