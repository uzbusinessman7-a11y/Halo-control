import { isAdminRequest } from "../../../lib/integration-store";
import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { addMoneyMove, moneyAccounts, MoneyMoveError } from "../../../core/money-moves";
import { LedgerError } from "../../../core/ledger";
import { ownerClose, ownerReview, ownerSettle, ownerSummary, staffCount, staffView } from "../../../core/kassa-service";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";
import { ensureRecurring } from "../../../core/recurring";

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
    if (user.role !== "staff") await ensureRecurring(branchId, today);
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
    if (action === "accounts") return json({ ok: true, today, accounts: moneyAccounts(data) });
    if (action === "move") {
      await ownerSummary(db, scope, data, today);
      const closed = await db.prepare("SELECT MAX(date) AS d FROM v2_day_closes WHERE tenant_id = ? AND branch_id = ?").bind(scope.tenantId, scope.branchId).first<{ d: string | null }>();
      const mutation = await mutateHaloState((state) => addMoneyMove(state as Record<string, unknown>, body, today, String(closed?.d || "")), 5, branchId, user.name,
        body.kind === "transfer" ? "Pul o‘tkazmasi" : "Pul kirimi", "Kassa (yangi)");
      return json({ ok: true, ...mutation.result });
    }
    return json({ error: "Noma'lum amal." }, 400);
  } catch (error) {
    if (error instanceof MoneyMoveError) return json({ error: error.message }, error.status);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    if (error instanceof LedgerError) return json({ error: error.message }, 400);
    if (error instanceof Error && /filial/i.test(error.message)) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi. Qayta urinib ko'ring." }, 500);
  }
}

function page(user: { role: "owner" | "staff"; name: string; branches: Array<{ id: string; name: string }> } | null): string {
  const boot = JSON.stringify(user).replace(/</g, "\\u003c");
  return shell({
    title: "Kassa", active: user?.role === "owner" ? "kassa" : null, back: user?.role === "owner" ? "/api/v2/bosh" : "/api/v2/xodim",
    body: `<div id="app" style="display:grid;gap:16px"></div>`,
    script: `
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
  app.innerHTML='<div class="page-head"><div><h1>Kassa</h1></div></div><section class="card"><h2>Kirish</h2><p class="hint">Davom etish uchun tizimga kiring.</p><div class="row"><a href="/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}">Rahbar sifatida kirish</a> · <a href="/xodim">Xodim sifatida kirish</a></div></section>';
} else if(USER.role==='staff'){ staffScreen(); } else { ownerScreen(); }

function countForm(target, onDone){
  target.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'staff-view',branchId:branch()}).then(function(res){
    if(!res.ok){target.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    if(!res.cashAccounts.length){target.innerHTML='<div class="msg bad">Sanaladigan kassa sozlanmagan.</div>';return}
    var op=uid('count');
    target.innerHTML='<p class="hint">'+esc(res.date)+' · Pulni sanab, aniq summani yozing. Dastur hisobi bu yerda ko‘rsatilmaydi.</p>'
      +res.cashAccounts.map(function(a){return '<label class="field"><span>'+esc(a.name)+'</span><input class="money" inputmode="numeric" autocomplete="off" data-id="'+esc(a.id)+'" placeholder="0"></label>'}).join('')
      +'<button class="block" id="send">Yuborish</button><div id="cmsg"></div>';
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
  app.innerHTML='<div class="page-head"><div><h1>Kassani sanash</h1><p>'+esc(USER.name)+'</p></div></div><section class="card" id="count"></section>';
  countForm(document.getElementById('count'));
}

function ownerScreen(){
  var opts=USER.branches.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');
  app.innerHTML='<div class="page-head"><div><h1>Kassa</h1><p>Pul qayerda, kunlarni yopish va karta puli</p></div><select id="branch">'+opts+'</select></div>'
    +'<div id="alerts"></div>'
    +'<section class="card"><h2>Pul qayerda</h2><div class="grid" id="balances"></div></section>'
    +'<section class="card"><h2>Karta va delivery — hali tushmagan pul</h2><div class="grid" id="recv"></div><div class="row" style="margin-top:12px"><button class="ghost" id="openSettle">+ Pul bankka tushdi</button></div><div id="settle" hidden></div></section>'
    +'<section class="card"><h2>Kunlar</h2><div id="days"></div><div id="review"></div></section>'
    +'<section class="card"><h2>Pul harakati</h2><p class="hint">Kassadagi pulni bankka topshirish, bankdan naqd olish, boshqa kirim yoki o‘z pulingizni kiritish.</p><div class="row"><button class="ghost" data-mv="transfer">⇄ O‘tkazma</button><button class="ghost" data-mv="income">＋ Kirim</button></div><div id="moveBox"></div></section>'
    +'<section class="card"><h2>Kassani o‘zim sanayman</h2><div class="row"><button class="ghost" id="openCount">Sanashni boshlash</button></div><div id="ownCount"></div></section>';
  haloBranch(document.getElementById('branch'));document.getElementById('branch').addEventListener('change',load);
  document.getElementById('openCount').addEventListener('click',function(){countForm(document.getElementById('ownCount'),load)});
  document.getElementById('openSettle').addEventListener('click',function(){var s=document.getElementById('settle');s.hidden=!s.hidden});
  document.querySelectorAll('[data-mv]').forEach(function(b){b.addEventListener('click',function(){moveForm(b.dataset.mv)})});
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
      +'<button class="block" id="doClose">Kunni yopish</button><div id="closeMsg"></div>';
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
    +'<label class="field"><span>Qo‘shimcha ushlanma (faqat farq bo‘lsa)</span><input class="money" id="sFee" inputmode="numeric" placeholder="0"><small class="hint">Karta komissiyasi va delivery ushlanmasi savdoda avtomatik ayirilgan. Bu yerga faqat kutilgandan ortiq ushlangan summani yozing.</small></label>'
    +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="sMemo" maxlength="120"></label>'
    +'<button class="block" id="doSettle">Saqlash</button><div id="sMsg"></div></div>';
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

function moveForm(kind){
  var box=document.getElementById('moveBox');box.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'accounts',branchId:branch()}).then(function(res){
    if(!res.ok){box.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    var acc=res.accounts,op=uid('m').replace(/^m-/,'');
    if(!/^[a-f0-9-]{36}$/.test(op))op=(crypto.randomUUID?crypto.randomUUID():op);
    var opts=function(sel){return acc.map(function(a,i){return '<option value="'+esc(a.id)+'"'+(i===sel?' selected':'')+'>'+esc(a.name)+'</option>'}).join('')};
    var cash=acc.findIndex(function(a){return a.type==='cash'}),bank=acc.findIndex(function(a){return a.type==='bank'});
    box.innerHTML='<div style="margin-top:12px">'+(kind==='transfer'
      ?'<label class="field"><span>Qayerdan</span><select id="mFrom">'+opts(cash<0?0:cash)+'</select></label><label class="field"><span>Qayerga</span><select id="mTo">'+opts(bank<0?1:bank)+'</select></label>'
      :'<label class="field"><span>Kirim turi</span><select id="mKind"><option value="other">Boshqa daromad (foydaga qo‘shiladi)</option><option value="owner">Egasi pul kiritdi (foydaga ta’sir qilmaydi)</option><option value="loan">Qarz olindi (foydaga ta’sir qilmaydi)</option></select></label><label class="field"><span>Qaysi hisobga</span><select id="mFrom">'+opts(cash<0?0:cash)+'</select></label>')
      +'<label class="field"><span>Summa</span><input class="money" id="mAmt" inputmode="numeric" placeholder="0"></label>'
      +'<label class="field"><span>Sana</span><input type="date" id="mDate" value="'+esc(res.today)+'" max="'+esc(res.today)+'"></label>'
      +'<label class="field"><span>Izoh'+(kind==='transfer'?' (ixtiyoriy)':'')+'</span><input id="mNote" maxlength="200"></label>'
      +'<button class="block" id="mSave">Saqlash</button><div id="mMsg"></div></div>';
    moneyInput(document.getElementById('mAmt'));
    document.getElementById('mSave').addEventListener('click',function(){
      var amount=parseWon(document.getElementById('mAmt').value)||0,msg=document.getElementById('mMsg');
      if(!amount){msg.innerHTML='<div class="msg bad">Summani yozing.</div>';return}
      var body={action:'move',kind:kind,branchId:branch(),operationId:op,accountId:document.getElementById('mFrom').value,amount:amount,date:document.getElementById('mDate').value,note:document.getElementById('mNote').value};
      if(kind==='transfer')body.toAccountId=document.getElementById('mTo').value;else body.incomeKind=document.getElementById('mKind').value;
      if(!confirm((kind==='transfer'?'O‘tkazma':'Kirim')+': '+won(amount)+'. Saqlansinmi?'))return;
      this.disabled=true;var btn=this;
      api(body).then(function(x){btn.disabled=false;
        if(!x.ok){msg.innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}
        box.innerHTML='<div class="msg ok" style="margin-top:12px">✓ Saqlandi'+(x.alreadySaved?' (oldin saqlangan edi)':'')+'</div>';load();
      });
    });
  });
}
`,
  });
}
