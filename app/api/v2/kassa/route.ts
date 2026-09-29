import { isAdminRequest } from "../../../lib/integration-store";
import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { LedgerError } from "../../../core/ledger";
import { ownerClose, ownerReview, ownerSettle, ownerSummary, staffCount, staffView } from "../../../core/kassa-service";
import type { D1Like } from "../../../lib/full-migration";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/kassa";
const TENANT_ID = "halo";
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function database(): D1Like {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
}

type Who = { role: "owner"; name: string } | { role: "staff"; name: string; branchId: string } | null;

async function who(request: Request): Promise<Who> {
  if (await isAdminRequest(request)) return { role: "owner", name: "Rahbar" };
  const worker = await authenticateWorkerRequest(request);
  if (worker) return { role: "staff", name: worker.name, branchId: worker.branchId };
  return null;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  const user = await who(request);
  const branches = user?.role === "owner" ? (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name })) : [];
  return new Response(page(user ? { role: user.role, name: user.name, branches } : null), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  const user = await who(request);
  if (!user) return json({ error: "Avval tizimga kiring." }, 401);
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "So'rov noto'g'ri." }, 400);
  }
  const action = String(body.action || "");
  const branchId = user.role === "staff" ? user.branchId : String(body.branchId || "main");
  const scope = { tenantId: TENANT_ID, branchId };
  const today = seoulToday();
  try {
    const { state } = await readHaloState(branchId);
    const db = database();
    const data = state as Record<string, unknown>;
    if (action === "staff-view") return json({ ok: true, ...(await staffView(db, scope, data, today)) });
    if (action === "count") {
      const receipt = await staffCount(db, scope, data, today, {
        operationId: String(body.operationId || ""), actor: user.name, counts: body.counts as Record<string, number>,
      });
      return json({ ok: true, receipt });
    }
    if (user.role !== "owner") return json({ error: "Bu amal faqat rahbar uchun." }, 403);
    if (action === "summary") return json({ ok: true, summary: await ownerSummary(db, scope, data, today) });
    if (action === "review") return json({ ok: true, review: await ownerReview(db, scope, data, today, String(body.date || "")) });
    if (action === "close") {
      return json({ ok: true, result: await ownerClose(db, scope, data, today, {
        date: String(body.date || ""), note: String(body.note || ""), reviewer: user.name, operationId: String(body.operationId || ""),
      }) });
    }
    if (action === "settle") {
      return json({ ok: true, result: await ownerSettle(db, scope, data, today, {
        operationId: String(body.operationId || ""), date: String(body.date || ""), actor: user.name,
        fromAccountId: String(body.fromAccountId || ""), toAccountId: String(body.toAccountId || ""),
        received: Number(body.received), fee: Number(body.fee), memo: String(body.memo || ""),
      }) });
    }
    return json({ error: "Noma'lum amal." }, 400);
  } catch (error) {
    if (error instanceof LedgerError) return json({ error: error.message }, 400);
    if (error instanceof Error && /filial/i.test(error.message)) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi. Qayta urinib ko'ring." }, 500);
  }
}

function page(user: { role: "owner" | "staff"; name: string; branches: Array<{ id: string; name: string }> } | null): string {
  const boot = JSON.stringify(user).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>HALO Kassa</title>
<style>
:root{color-scheme:light dark;--bg:#f3f4f6;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#0f766e;--accent-soft:#ccfbf1;--ok:#047857;--ok-soft:#d1fae5;--bad:#b91c1c;--bad-soft:#fee2e2;--warn:#b45309;--warn-soft:#fef3c7}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--card:#16191e;--text:#f3f4f6;--muted:#9ca3af;--line:#262a31;--accent:#2dd4bf;--accent-soft:#134e4a;--ok:#34d399;--ok-soft:#064e3b;--bad:#f87171;--bad-soft:#450a0a;--warn:#fbbf24;--warn-soft:#451a03}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px 16px calc(24px + env(safe-area-inset-bottom))}
main{max-width:640px;margin:0 auto;display:grid;gap:14px}
header{display:flex;justify-content:space-between;align-items:center;gap:10px}header h1{font-size:20px;margin:0}header small{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.card h2{font-size:15px;margin:0 0 10px;color:var(--muted);font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.tile{border:1px solid var(--line);border-radius:12px;padding:12px}.tile span{display:block;font-size:13px;color:var(--muted)}.tile b{display:block;font-size:20px;font-variant-numeric:tabular-nums;margin-top:2px}
.tile.bad{border-color:var(--bad);background:var(--bad-soft)}.tile.bad b{color:var(--bad)}.tile.warn{border-color:var(--warn);background:var(--warn-soft)}
.tile small{display:block;font-size:12px;color:var(--muted);margin-top:4px}
label.field{display:block;margin:0 0 12px}label.field span{display:block;font-size:14px;font-weight:600;margin-bottom:6px}
input,select,textarea{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:12px;background:transparent;color:inherit}
input.money{font-size:26px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;padding:14px}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px}
button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:14px 16px;background:var(--accent);color:#fff;cursor:pointer;width:100%}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--line);width:auto;padding:10px 14px}
button:disabled{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.day{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--line)}.day:first-of-type{border-top:0}
.badge{font-size:13px;font-weight:700;padding:4px 10px;border-radius:99px;white-space:nowrap}
.badge.ok{background:var(--ok-soft);color:var(--ok)}.badge.bad{background:var(--bad-soft);color:var(--bad)}.badge.warn{background:var(--warn-soft);color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{padding:8px 4px;border-bottom:1px solid var(--line);text-align:left}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.msg{padding:12px;border-radius:12px;margin-top:10px}.msg.ok{background:var(--ok-soft);color:var(--ok)}.msg.bad{background:var(--bad-soft);color:var(--bad)}
.hint{font-size:14px;color:var(--muted);margin:0 0 12px}
.done{text-align:center;padding:28px 8px}.done b{display:block;font-size:48px;color:var(--ok)}
a{color:var(--accent)}
[hidden]{display:none!important}
</style></head><body><main id="app"></main>
<script>
var USER=${boot};
var app=document.getElementById('app');
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function uid(p){return p+'-'+(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2))}
function parseWon(v){var d=String(v||'').replace(/[^0-9]/g,'');return d===''?null:Number(d)}
function moneyInput(el){el.addEventListener('input',function(){var n=parseWon(el.value);el.value=n==null?'':n.toLocaleString('en-US')})}
function api(body){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
function branch(){var s=document.getElementById('branch');return s?s.value:undefined}

if(!USER){
  app.innerHTML='<header><h1>HALO Kassa</h1></header><section class="card"><h2>Kirish</h2><p class="hint">Davom etish uchun tizimga kiring.</p><div class="row"><a href="/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}">Rahbar sifatida kirish</a> · <a href="/xodim">Xodim sifatida kirish</a></div></section>';
} else if(USER.role==='staff'){ staffScreen(); } else { ownerScreen(); }

function countForm(target, onDone){
  target.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'staff-view',branchId:branch()}).then(function(res){
    if(!res.ok){target.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    if(!res.cashAccounts.length){target.innerHTML='<div class="msg bad">Sanaladigan kassa sozlanmagan.</div>';return}
    var op=uid('count');
    target.innerHTML='<p class="hint">'+esc(res.date)+' · Pulni sanab, aniq summani yozing. Dastur hisobi bu yerda ko‘rsatilmaydi.</p>'
      +res.cashAccounts.map(function(a){return '<label class="field"><span>'+esc(a.name)+'</span><input class="money" inputmode="numeric" autocomplete="off" data-id="'+esc(a.id)+'" placeholder="0"></label>'}).join('')
      +'<button id="send">Yuborish</button><div id="cmsg"></div>';
    var inputs=target.querySelectorAll('input.money');inputs.forEach(moneyInput);
    target.querySelector('#send').addEventListener('click',function(){
      var counts={},missing=false;inputs.forEach(function(i){var n=parseWon(i.value);if(n==null)missing=true;counts[i.dataset.id]=n});
      var msg=target.querySelector('#cmsg');
      if(missing){msg.innerHTML='<div class="msg bad">Har bir kassa uchun summani yozing (bo‘sh bo‘lsa 0).</div>';return}
      if(!confirm('Sanoq yuborilsinmi? Yuborilgandan keyin o‘zgartirib bo‘lmaydi.'))return;
      this.disabled=true;var btn=this;
      api({action:'count',branchId:branch(),operationId:op,counts:counts}).then(function(r){
        if(!r.ok){btn.disabled=false;msg.innerHTML='<div class="msg bad">'+esc(r.error)+'</div>';return}
        target.innerHTML='<div class="done"><b>✓</b><p>Sanoq qabul qilindi.<br>Natijani rahbar ko‘radi.</p></div>';
        if(onDone)onDone();
      });
    });
  });
}

function staffScreen(){
  app.innerHTML='<header><div><h1>Kassani sanash</h1><small>'+esc(USER.name)+'</small></div></header><section class="card" id="count"></section>';
  countForm(document.getElementById('count'));
}

function ownerScreen(){
  var opts=USER.branches.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');
  app.innerHTML='<header><div><a href="/api/v2/bosh" style="color:var(--muted);font-size:14px;text-decoration:none">← Bosh sahifa</a><br><h1>Kassa nazorati</h1><small>Yangi jurnal · sinov</small></div><select id="branch" style="width:auto">'+opts+'</select></header>'
    +'<div id="alerts"></div>'
    +'<section class="card"><h2>Pul qayerda</h2><div class="grid" id="balances"></div></section>'
    +'<section class="card"><h2>Karta va delivery — hali tushmagan pul</h2><div class="grid" id="recv"></div><div class="row" style="margin-top:12px"><button class="ghost" id="openSettle">+ Pul bankka tushdi</button></div><div id="settle" hidden></div></section>'
    +'<section class="card"><h2>Kunlar</h2><div id="days"></div><div id="review"></div></section>'
    +'<section class="card"><h2>Kassani o‘zim sanayman</h2><div class="row"><button class="ghost" id="openCount">Sanashni boshlash</button></div><div id="ownCount"></div></section>';
  document.getElementById('branch').addEventListener('change',load);
  document.getElementById('openCount').addEventListener('click',function(){countForm(document.getElementById('ownCount'),load)});
  document.getElementById('openSettle').addEventListener('click',function(){var s=document.getElementById('settle');s.hidden=!s.hidden});
  load();
}

var SUMMARY=null;
function load(){
  document.getElementById('balances').innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'summary',branchId:branch()}).then(function(res){
    if(!res.ok){document.getElementById('alerts').innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    SUMMARY=res.summary;var s=res.summary;
    var al=[];
    if(s.bridge.changed.length)al.push(s.bridge.changed.length+' ta eski yozuv summasi keyin o‘zgartirilgan');
    if(s.bridge.invalid.length)al.push(s.bridge.invalid.length+' ta eski yozuv jurnalga yozilmadi');
    document.getElementById('alerts').innerHTML=al.length?'<div class="msg bad">⚠ '+al.map(esc).join(' · ')+'</div>':'';
    var roles={cash:'Naqd — har kuni sanaladi',bank:'Bank',receivable:'Tushishi kutilmoqda',other:'Boshqa'};
    document.getElementById('balances').innerHTML=s.balances.map(function(b){var neg=b.balance<0&&b.role!=='other';
      return '<div class="tile'+(neg?' bad':'')+'"><span>'+esc(b.name)+'</span><b>'+won(b.balance)+'</b><small>'+(neg?'Minus bo‘lishi mumkin emas — yozilmagan kirim yoki o‘tkazma bor':esc(roles[b.role]))+'</small></div>'}).join('');
    document.getElementById('recv').innerHTML=s.receivables.length?s.receivables.map(function(r){var late=r.ageDays!=null&&r.ageDays>7;
      return '<div class="tile'+(late?' warn':'')+'"><span>'+esc(r.name)+'</span><b>'+won(r.outstanding)+'</b><small>'+(r.oldestUnsettledDate?'Eng eskisi '+r.ageDays+' kun oldin ('+esc(r.oldestUnsettledDate)+')':'Hammasi tushgan')+'</small></div>'}).join(''):'<p class="hint">Karta yoki delivery hisobi yo‘q.</p>';
    renderSettle();renderDays();
  });
}

function renderDays(){
  var s=SUMMARY,today=s.date;
  if(!s.days.length){document.getElementById('days').innerHTML='<p class="hint">So‘nggi 14 kunda harakat yo‘q.</p>';return}
  document.getElementById('days').innerHTML=s.days.map(function(d){var badge,action='';
    if(d.closed){badge=d.variance?'<span class="badge '+(d.variance<0?'bad':'warn')+'">Yopildi · farq '+won(d.variance)+'</span>':'<span class="badge ok">Yopildi ✓</span>'}
    else if(d.counted){badge='<span class="badge warn">Sanalgan · '+esc(d.countedBy||'')+'</span>';action='<button class="ghost" data-review="'+esc(d.date)+'">Ko‘rish va yopish</button>'}
    else{badge=d.date<today?'<span class="badge bad">Sanalmagan</span>':'<span class="badge warn">Bugun · hali sanalmagan</span>'}
    return '<div class="day"><div><b>'+esc(d.date)+'</b><br>'+badge+'</div>'+action+'</div>'}).join('');
  document.querySelectorAll('[data-review]').forEach(function(b){b.addEventListener('click',function(){review(b.dataset.review)})});
}

function review(date){
  var box=document.getElementById('review');box.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'review',branchId:branch(),date:date}).then(function(res){
    if(!res.ok){box.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    var r=res.review,op=uid('close');
    box.innerHTML='<h2 style="margin-top:16px">'+esc(date)+' · sanagan: '+esc(r.countedBy)+'</h2><table><tr><th>Kassa</th><th class="n">Dastur</th><th class="n">Sanaldi</th><th class="n">Farq</th></tr>'
      +r.lines.map(function(l){return '<tr><td>'+esc(l.name)+'</td><td class="n">'+won(l.expected)+'</td><td class="n">'+won(l.counted)+'</td><td class="n" style="color:var(--'+(l.variance<0?'bad':l.variance>0?'warn':'ok')+')">'+(l.variance?won(l.variance):'✓ 0')+'</td></tr>'}).join('')+'</table>'
      +(r.totalVariance?'<label class="field" style="margin-top:12px"><span>Farq sababi (majburiy)</span><textarea id="note" rows="2" placeholder="Masalan: qaytim xato berilgan"></textarea></label>':'<p class="hint" style="margin-top:12px">Farq yo‘q.</p>')
      +'<button id="doClose">Kunni yopish</button><div id="closeMsg"></div>';
    document.getElementById('doClose').addEventListener('click',function(){
      var noteEl=document.getElementById('note'),note=noteEl?noteEl.value.trim():'';
      if(r.totalVariance&&!note){document.getElementById('closeMsg').innerHTML='<div class="msg bad">Farq sababini yozing.</div>';return}
      if(!confirm(date+' kuni yopilsinmi? Yopilgan kunni o‘zgartirib bo‘lmaydi.'))return;
      this.disabled=true;var btn=this;
      api({action:'close',branchId:branch(),date:date,note:note,operationId:op}).then(function(x){
        if(!x.ok){btn.disabled=false;document.getElementById('closeMsg').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}
        box.innerHTML='<div class="msg ok">✓ '+esc(date)+' yopildi'+(x.result.varianceTotal?' · farq '+won(x.result.varianceTotal)+' Kassa farqi hisobiga yozildi':'')+'</div>';load();
      });
    });
  });
}

function renderSettle(){
  var s=SUMMARY,box=document.getElementById('settle');
  var from=s.balances.filter(function(b){return b.role==='receivable'}),to=s.balances.filter(function(b){return b.role==='bank'||b.role==='cash'});
  if(!from.length||!to.length){box.innerHTML='<p class="hint">Karta/delivery yoki bank hisobi sozlanmagan.</p>';return}
  var op=uid('settle');
  box.innerHTML='<div style="margin-top:12px"><label class="field"><span>Qayerdan</span><select id="sFrom">'+from.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('')+'</select></label>'
    +'<label class="field"><span>Qayerga tushdi</span><select id="sTo">'+to.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('')+'</select></label>'
    +'<label class="field"><span>Sana</span><input type="date" id="sDate" value="'+esc(s.date)+'" max="'+esc(s.date)+'"></label>'
    +'<label class="field"><span>Bankka tushgan summa</span><input class="money" id="sRecv" inputmode="numeric" placeholder="0"></label>'
    +'<label class="field"><span>Komissiya (ushlab qolingan)</span><input class="money" id="sFee" inputmode="numeric" placeholder="0"></label>'
    +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="sMemo" maxlength="120"></label>'
    +'<button id="doSettle">Saqlash</button><div id="sMsg"></div></div>';
  moneyInput(document.getElementById('sRecv'));moneyInput(document.getElementById('sFee'));
  document.getElementById('doSettle').addEventListener('click',function(){
    var recv=parseWon(document.getElementById('sRecv').value)||0,fee=parseWon(document.getElementById('sFee').value)||0,msg=document.getElementById('sMsg');
    if(!recv&&!fee){msg.innerHTML='<div class="msg bad">Summani yozing.</div>';return}
    if(!confirm('Tushdi: '+won(recv)+' · komissiya: '+won(fee)+'. Saqlansinmi?'))return;
    this.disabled=true;var btn=this;
    api({action:'settle',branchId:branch(),operationId:op,date:document.getElementById('sDate').value,fromAccountId:document.getElementById('sFrom').value,toAccountId:document.getElementById('sTo').value,received:recv,fee:fee,memo:document.getElementById('sMemo').value}).then(function(x){
      if(!x.ok){btn.disabled=false;msg.innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}
      msg.innerHTML='<div class="msg ok">✓ Saqlandi</div>';load();
    });
  });
}
</script></body></html>`;
}

