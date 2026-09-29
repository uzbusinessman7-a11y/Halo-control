import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { LedgerError } from "../../../core/ledger";
import { runDebtBridge } from "../../../core/debt-bridge";
import { statement, statementText } from "../../../core/debts";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";

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
    const accounts = (Array.isArray((state as Record<string, unknown>).accounts) ? (state as Record<string, unknown>).accounts as Array<Record<string, unknown>> : [])
      .filter((account) => (account.type === "cash" || account.type === "bank") && account.active !== false)
      .map((account) => ({ id: String(account.id), name: String(account.name || account.id), type: String(account.type) }));
    return json({ ok: true, today, bridge, accounts });
  } catch (error) {
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Qarzlar", active: "qarz", heading: "Qarzlar",
    subtitle: "Yetkazib beruvchilar bilan hisob-kitob va solishtirish akti",
    headerRight: '<select id="branch"></select>',
    body: `<section class="card noprint" id="listCard"><h2>Yetkazib beruvchilarga qarz</h2><div id="list"><p class="hint">Yuklanmoqda…</p></div></section>
<section class="card" id="stCard" hidden></section>`,
    script: `
var BRANCHES=${boot},TODAY='',PARTIES={},ACCOUNTS=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var KIND={opening:'Boshlang‘ich qarz',purchase:'Xarid',payment:'To‘lov',adjustment:'Tuzatish',reversal:'Bekor qilindi'};
function load(){
  document.getElementById('stCard').hidden=true;
  api({branchId:sel.value}).then(function(res){
    var box=document.getElementById('list');
    if(!res.ok){box.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    TODAY=res.today;var b=res.bridge;PARTIES={};b.parties.forEach(function(p){PARTIES[p.partyId]=p});ACCOUNTS=res.accounts||[];
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
      +'<div class="row noprint" style="margin:14px 0 6px"><button id="addPur">+ Xarid (qarz oshadi)</button><button class="ghost" id="addPay">+ To‘lov qildim</button></div><div id="entry" class="noprint" style="margin-bottom:12px"></div>'
      +'<div class="row noprint"><button id="copy">📋 Nusxa olish (xabar uchun)</button><button class="ghost" id="print">🖨 Chop etish / PDF</button></div><div id="cmsg" class="noprint"></div>';
    document.getElementById('stGo').addEventListener('click',function(){openStatement(partyId,document.getElementById('stFrom').value,document.getElementById('stTo').value)});
    document.getElementById('print').addEventListener('click',function(){window.print()});
    document.getElementById('addPur').addEventListener('click',function(){entryForm(partyId,'purchase')});
    document.getElementById('addPay').addEventListener('click',function(){entryForm(partyId,'payment')});
    document.getElementById('copy').addEventListener('click',function(){
      var done=function(){document.getElementById('cmsg').innerHTML='<div class="msg ok" style="margin-top:10px">✓ Nusxa olindi — Telegram yoki KakaoTalk’ga joylang</div>'};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(res.text).then(done,function(){prompt('Matnni nusxalang:',res.text)})}else{prompt('Matnni nusxalang:',res.text)}
    });
  });
}
function uid(){return 'v2-'+(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2))}
function entryForm(partyId,type){
  var p=PARTIES[partyId],box=document.getElementById('entry');if(!p)return;
  var id=uid(),pay=type==='payment';
  if(pay&&!ACCOUNTS.length){box.innerHTML='<div class="msg bad">Kassa yoki bank hisobi topilmadi.</div>';return}
  box.innerHTML='<div class="card" style="background:var(--card-2)"><h2>'+(pay?'To‘lov — ':'Xarid — ')+esc(p.name)+'</h2>'
    +'<label class="field"><span>Summa</span><input class="money" id="eAmt" inputmode="numeric" placeholder="0"></label>'
    +'<label class="field"><span>Sana</span><input type="date" id="eDate" value="'+esc(TODAY)+'" max="'+esc(TODAY)+'"></label>'
    +(pay?'<label class="field"><span>Qaysi hisobdan to‘landi</span><select id="eAcc">'+ACCOUNTS.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>'}).join('')+'</select></label>':'')
    +'<label class="field"><span>Izoh '+(pay?'(ixtiyoriy)':'(nima olindi)')+'</span><input id="eNote" maxlength="200" placeholder="'+(pay?'':'Masalan: go‘sht 30 kg')+'"></label>'
    +'<div class="row"><button id="eSave">Saqlash</button><button class="ghost" id="eCancel">Bekor</button></div><div id="eMsg"></div></div>';
  var amt=document.getElementById('eAmt');amt.addEventListener('input',function(){var d=amt.value.replace(/[^0-9]/g,'');amt.value=d?Number(d).toLocaleString('en-US'):''});amt.focus();
  document.getElementById('eCancel').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('eSave').addEventListener('click',function(){
    var btn=this,msg=document.getElementById('eMsg'),amount=Number(amt.value.replace(/[^0-9]/g,''));
    if(!amount){msg.innerHTML='<div class="msg bad">Summani yozing.</div>';return}
    var tx={id:id,supplierId:p.oldId,type:type,amount:amount,date:document.getElementById('eDate').value,note:document.getElementById('eNote').value};
    if(pay)tx.accountId=document.getElementById('eAcc').value;
    if(!confirm((pay?'To‘lov':'Xarid')+': '+esc(p.name)+' · '+won(amount)+'. Saqlansinmi?'))return;
    var send=function(reason){btn.disabled=true;
      fetch('/api/supplier-records?branch='+encodeURIComponent(sel.value),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveTransaction',transaction:tx,duplicateReason:reason||undefined})})
      .then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})
      .then(function(x){btn.disabled=false;
        if(x.body&&x.body.ok){box.innerHTML='<div class="msg ok">✓ Saqlandi. Qarz yangilandi.</div>';load();setTimeout(function(){openStatement(partyId)},600);return}
        if(x.body&&x.body.duplicate&&!reason){var why=prompt((x.body.error||'Bir xil yozuv bor.')+'\\n\\nBu haqiqatan alohida '+(pay?'to‘lov':'xarid')+' bo‘lsa, sababini yozing:');if(why&&why.trim())send(why.trim());return}
        msg.innerHTML='<div class="msg bad">'+esc((x.body&&x.body.error)||'Saqlanmadi.')+'</div>'});
    };
    send();
  });
}
sel.addEventListener('change',load);load();
`,
  });
}
