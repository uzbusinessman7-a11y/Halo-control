import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { LedgerError } from "../../../core/ledger";
import { runDebtBridge } from "../../../core/debt-bridge";
import { statement, statementText } from "../../../core/debts";
import type { D1Like } from "../../../lib/full-migration";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/qarz";
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
    const { state } = await readHaloState(branchId);
    const bridge = await runDebtBridge(database(), scope, state as Record<string, unknown>, today);
    if (body.action === "statement") {
      const st = await statement(database(), scope, String(body.partyId || ""), String(body.from || `${today.slice(0, 8)}01`), String(body.to || today));
      return json({ ok: true, statement: st, text: statementText(st) });
    }
    return json({ ok: true, today, bridge });
  } catch (error) {
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>HALO Qarzlar</title>
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
.party{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:12px 0;border-top:1px solid var(--line);cursor:pointer}.party:first-of-type{border-top:0}
.party b{font-size:16px}.party .v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}.party small{grid-column:1/-1;color:var(--muted);font-size:13px}
.tag{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:6px}.tag.bad{background:var(--bad-soft);color:var(--bad)}.tag.warn{background:var(--warn-soft);color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:left}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.msg{padding:12px;border-radius:12px}.msg.bad{background:var(--bad-soft);color:var(--bad)}.msg.ok{background:var(--ok-soft);color:var(--ok)}
@media print{body{background:#fff;color:#000;padding:0}header,#listCard,.noprint{display:none!important}.card{border:0;padding:0}}
</style></head><body><main>
<header><div><h1>Qarzlar</h1><small>Yangi daftar · sinov</small></div><select id="branch"></select></header>
<section class="card" id="listCard"><h2>Yetkazib beruvchilarga qarz</h2><div id="list"><p class="hint">Yuklanmoqda…</p></div></section>
<section class="card" id="stCard" hidden></section>
</main>
<script>
var BRANCHES=${boot},TODAY='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');
var KIND={opening:'Boshlang‘ich qarz',purchase:'Xarid',payment:'To‘lov',adjustment:'Tuzatish',reversal:'Bekor qilindi'};
function load(){
  document.getElementById('stCard').hidden=true;
  api({branchId:sel.value}).then(function(res){
    var box=document.getElementById('list');
    if(!res.ok){box.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    TODAY=res.today;var b=res.bridge;
    var warn=[];if(b.changed.length)warn.push(b.changed.length+' ta eski yozuv keyin o‘zgartirilgan');if(b.invalid.length)warn.push(b.invalid.length+' ta yozuv noto‘g‘ri');
    box.innerHTML='<div class="total">'+won(b.totalDebt)+'</div><p class="hint">Jami qarz · '+b.parties.length+' ta yetkazib beruvchi</p>'
      +(warn.length?'<div class="msg bad">⚠ '+warn.map(esc).join(' · ')+'</div>':'')
      +b.parties.map(function(p){var late=p.ageDays!=null&&p.ageDays>30;
        return '<div class="party" data-id="'+esc(p.partyId)+'"><b>'+esc(p.name)+(p.difference?'<span class="tag bad">tarix bilan farq '+won(p.difference)+'</span>':'')+(late?'<span class="tag warn">'+p.ageDays+' kun</span>':'')+'</b><span class="v">'+won(p.ledgerBalance)+(p.ledgerBalance<0?' (avans)':'')+'</span>'
          +'<small>'+(p.oldestUnpaidDate?'Eng eski to‘lanmagan xarid: '+esc(p.oldestUnpaidDate)+' ('+p.ageDays+' kun)':p.ledgerBalance>0?'':'Qarz yo‘q')+(p.difference?' · eski tizimda '+won(p.oldBalance)+' saqlangan':'')+' · Akt uchun bosing ›</small></div>'}).join('');
    box.querySelectorAll('.party').forEach(function(el){el.addEventListener('click',function(){openStatement(el.dataset.id)})});
  });
}
function openStatement(partyId,from,to){
  var card=document.getElementById('stCard');card.hidden=false;card.innerHTML='<p class="hint">Yuklanmoqda…</p>';card.scrollIntoView({behavior:'smooth'});
  from=from||TODAY.slice(0,8)+'01';to=to||TODAY;
  api({action:'statement',branchId:sel.value,partyId:partyId,from:from,to:to}).then(function(res){
    if(!res.ok){card.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    var s=res.statement;
    card.innerHTML='<h2>Solishtirish akti</h2><div class="row noprint" style="margin-bottom:10px"><input type="date" id="stFrom" value="'+esc(s.from)+'"> — <input type="date" id="stTo" value="'+esc(s.to)+'"><button class="ghost" id="stGo">Yangilash</button></div>'
      +'<h3 style="margin:6px 0">'+esc(s.party.name)+'</h3><p class="hint">Davr: '+esc(s.from)+' — '+esc(s.to)+'</p>'
      +'<table><tr><th>Sana</th><th>Yozuv</th><th class="n">Summa</th><th class="n">Qarz</th></tr>'
      +'<tr><td colspan="3"><b>Davr boshidagi qarz</b></td><td class="n"><b>'+won(s.opening)+'</b></td></tr>'
      +s.lines.map(function(l){return '<tr><td>'+esc(l.date)+'</td><td>'+esc(KIND[l.kind]||l.kind)+(l.memo?'<br><small style="color:var(--muted)">'+esc(l.memo)+'</small>':'')+'</td><td class="n">'+(l.amount>0?'+':'−')+won(Math.abs(l.amount))+'</td><td class="n">'+won(l.balance)+'</td></tr>'}).join('')
      +'<tr><td colspan="3"><b>'+esc(s.to)+' holatiga qarz</b></td><td class="n"><b>'+won(s.closing)+'</b></td></tr></table>'
      +'<p class="hint" style="margin-top:10px">Jami xarid: '+won(s.purchases)+' · Jami to‘lov: '+won(s.payments)+'</p>'
      +'<div class="row noprint"><button id="copy">📋 Nusxa olish (xabar uchun)</button><button class="ghost" id="print">🖨 Chop etish / PDF</button></div><div id="cmsg" class="noprint"></div>';
    document.getElementById('stGo').addEventListener('click',function(){openStatement(partyId,document.getElementById('stFrom').value,document.getElementById('stTo').value)});
    document.getElementById('print').addEventListener('click',function(){window.print()});
    document.getElementById('copy').addEventListener('click',function(){
      var done=function(){document.getElementById('cmsg').innerHTML='<div class="msg ok" style="margin-top:10px">✓ Nusxa olindi — Telegram yoki KakaoTalk’ga joylang</div>'};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(res.text).then(done,function(){prompt('Matnni nusxalang:',res.text)})}else{prompt('Matnni nusxalang:',res.text)}
    });
  });
}
sel.addEventListener('change',load);load();
</script></body></html>`;
}
