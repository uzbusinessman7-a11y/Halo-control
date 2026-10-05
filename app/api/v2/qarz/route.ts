import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { editSupplierBalance, SupplierBalanceEditError } from "../../../lib/supplier-balance-edit";
import { isAccountingMonthClosed } from "../../../lib/month-end";
import { LedgerError } from "../../../core/ledger";
import { runDebtBridge } from "../../../core/debt-bridge";
import { statement, statementText } from "../../../core/debts";
import type { D1Like } from "../../../lib/full-migration";
import { VegetableExpenseError } from "../../../lib/vegetable-expenses";
import { assertV2DayOpen, ClosedDayError } from "../../../core/closed-days";
import {
  applySupplierIntake, intakeInventoryChoices, listSupplierProducts, rememberIntakePrices, removeSupplierProduct, saveSupplierProduct, SupplierIntakeError,
} from "../../../core/supplier-intake";
import { SUPPLIER_INTAKE_SCRIPT, SUPPLIER_INTAKE_STYLE } from "../../../core/supplier-intake-ui";
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
    type Row = Record<string, unknown>;
    const list = (value: unknown) => (Array.isArray(value) ? value as Row[] : []);
    if (body.action === "records") {
      // Yetkazib beruvchining asl yozuvlari (bekor qilish uchun) va ma'lumoti.
      const { state } = await readHaloState(branchId);
      const supplier = list((state as Row).suppliers).find((entry) => entry.id === body.supplierId);
      if (!supplier) return json({ error: "Yetkazib beruvchi topilmadi." }, 404);
      const records = list((state as Row).transactions).filter((tx) => tx.supplierId === supplier.id)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 100)
        .map((tx) => ({ id: String(tx.id), type: String(tx.type), amount: Number(tx.amount) || 0, date: String(tx.date), note: String(tx.note || tx.description || ""), closed: isAccountingMonthClosed((state as Row).monthlyCloses, String(tx.date)) }));
      return json({ ok: true, supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone || "", bankAccount: supplier.bankAccount || "", balance: Number(supplier.balance) || 0 }, records });
    }
    if (body.action === "editBalance") {
      const reason = String(body.reason || "").trim();
      await mutateHaloState((cur) => {
        const st = cur as Row;
        if (isAccountingMonthClosed(st.monthlyCloses, today)) throw new SupplierBalanceEditError("Bu oy yopilgan.");
        const supplier = list(st.suppliers).find((entry) => entry.id === body.supplierId);
        const out = editSupplierBalance(st, { supplierId: body.supplierId, balance: Number(body.balance), reason, id: `v2edit-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, expectedBalance: supplier?.balance, expectedOpeningBalance: Number(supplier?.openingBalance || 0) });
        return { state: out.state as Row, result: null };
      }, 5, branchId, "Rahbar", `Qarz qoldig‘i tuzatildi · Sabab: ${reason.slice(0, 80)}`, "Qarzlar (yangi)");
      return json({ ok: true });
    }
    // Yetkazib beruvchi profili: mahsulotlar ro'yxati va «Yangi kirim» (ombor + qarz + to'lov bitta saqlashda).
    const moneyAccounts = (st: Row) => list(st.accounts).filter((account) => (account.type === "cash" || account.type === "bank") && account.active !== false)
      .map((account) => ({ id: String(account.id), name: String(account.name || account.id), type: String(account.type) }));
    const profile = async (st: Row, supplierId: string) => {
      const choices = intakeInventoryChoices(st, today);
      const byId = new Map(choices.inventory.map((item) => [item.id, item]));
      const products = (await listSupplierProducts(database(), branchId, supplierId)).map((product) => {
        const item = product.inventoryId ? byId.get(product.inventoryId) : undefined;
        return { ...product, name: item ? item.name : product.name, vegetable: Boolean(item?.vegetable), missing: Boolean(product.inventoryId) && !item };
      });
      return { products, inventory: choices.inventory, inventoryCategories: choices.categories, accounts: moneyAccounts(st), today };
    };
    if (body.action === "profile" || body.action === "saveProduct" || body.action === "removeProduct") {
      const supplierId = String(body.supplierId || "");
      const { state } = await readHaloState(branchId);
      if (!list((state as Row).suppliers).some((entry) => entry.id === supplierId)) return json({ error: "Yetkazib beruvchi topilmadi." }, 404);
      if (body.action === "saveProduct") await saveSupplierProduct(database(), branchId, supplierId, (body.product && typeof body.product === "object" ? body.product : {}) as Row, state as Row, today);
      if (body.action === "removeProduct") await removeSupplierProduct(database(), branchId, supplierId, String(body.id || ""));
      return json({ ok: true, ...(await profile(state as Row, supplierId)) });
    }
    if (body.action === "intake") {
      const supplierId = String(body.supplierId || "");
      const date = String(body.date || "");
      // Pul chiqadigan bo'lsa — kassada yopilgan kunga yozilmaydi (yopilgan kun qoldig'i o'zgarmasligi kerak).
      if (Number(body.paidAmount) > 0) await assertV2DayOpen(branchId, date);
      const products = await listSupplierProducts(database(), branchId, supplierId);
      const mutation = await mutateHaloState((cur) => applySupplierIntake(cur as Row, { ...body, supplierId }, products, today), 5, branchId, "Rahbar",
        `Yangi kirim (yetkazib beruvchi) · ₩${(Array.isArray(body.lines) ? body.lines as Row[] : []).reduce((sum, line) => sum + (Number(line?.amount) || 0), 0).toLocaleString("en-US")}`, "Qarzlar (yangi)", true);
      const result = mutation.result;
      let remembered = true;
      try { await rememberIntakePrices(database(), branchId, result); } catch { remembered = false; }
      return json({ ok: true, result, remembered, ...(await profile(mutation.state as Row, supplierId)) });
    }
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
    if (error instanceof SupplierIntakeError) return json({ error: error.message, code: error.code || undefined, details: error.details }, error.status);
    if (error instanceof ClosedDayError) return json({ error: error.message }, 409);
    if (error instanceof VegetableExpenseError) return json({ error: error.message }, 400);
    if (error instanceof SupplierBalanceEditError) return json({ error: error.message }, 409);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Yetkazib beruvchilar", active: "qarz", heading: "Yetkazib beruvchilar",
    subtitle: "Mahsulot kirimi, qarz, to‘lov va solishtirish akti",
    headerRight: '<select id="branch"></select>',
    body: `<section class="card noprint"><div class="row"><button id="addSup">+ Yangi yetkazib beruvchi</button><a href="/api/v2/mezana" style="text-decoration:none"><button class="ghost" type="button">🤝 MEZANA hisobi ›</button></a></div><div id="supForm"></div></section>
<section class="card noprint" id="listCard"><h2>Yetkazib beruvchilarga qarz</h2><div id="list"><p class="hint">Yuklanmoqda…</p></div></section>
<section class="card" id="stCard" hidden></section>${SUPPLIER_INTAKE_STYLE}`,
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
      +'<div class="row noprint" style="margin:14px 0 4px"><button id="addIn">📦 Yangi kirim</button><button class="ghost" id="prods">🗂 Mahsulotlari</button></div><p class="hint noprint" style="margin:0">Mahsulot kelgan bo‘lsa — «Yangi kirim»: omborga ham, qarzga ham o‘zi yozadi. «+ Xarid» — faqat mahsulotsiz qarz uchun.</p>'
      +'<div class="row noprint" style="margin:14px 0 6px"><button id="addPur">+ Xarid (qarz oshadi)</button><button class="ghost" id="addPay">+ To‘lov qildim</button></div><div id="entry" class="noprint" style="margin-bottom:12px"></div>'
      +'<div class="row noprint"><button id="copy">📋 Nusxa olish (xabar uchun)</button><button class="ghost" id="print">🖨 Chop etish / PDF</button></div><div id="cmsg" class="noprint"></div>'
      +'<div class="row noprint" style="margin-top:10px"><button class="ghost" id="recs">🧾 Yozuvlar / bekor qilish</button><button class="ghost" id="bal">⚖️ Qoldiqni tuzatish</button><button class="ghost" id="edit">✏️ Ma’lumotlari</button></div><div id="fix" class="noprint"></div>';
    document.getElementById('stGo').addEventListener('click',function(){openStatement(partyId,document.getElementById('stFrom').value,document.getElementById('stTo').value)});
    document.getElementById('print').addEventListener('click',function(){window.print()});
    document.getElementById('addIn').addEventListener('click',function(){openIntake(partyId)});
    document.getElementById('prods').addEventListener('click',function(){openProducts(partyId)});
    if(FLASH){document.getElementById('entry').innerHTML=FLASH;FLASH=''}
    document.getElementById('addPur').addEventListener('click',function(){entryForm(partyId,'purchase')});
    document.getElementById('addPay').addEventListener('click',function(){entryForm(partyId,'payment')});
    document.getElementById('recs').addEventListener('click',function(){fixRecords(partyId,from,to)});
    document.getElementById('bal').addEventListener('click',function(){fixBalance(partyId,from,to)});
    document.getElementById('edit').addEventListener('click',function(){fixInfo(partyId)});
    document.getElementById('copy').addEventListener('click',function(){
      var done=function(){document.getElementById('cmsg').innerHTML='<div class="msg ok" style="margin-top:10px">✓ Nusxa olindi — Telegram yoki KakaoTalk’ga joylang</div>'};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(res.text).then(done,function(){prompt('Matnni nusxalang:',res.text)})}else{prompt('Matnni nusxalang:',res.text)}
    });
  });
}
var TXK={purchase:'Xarid',payment:'To‘lov'};
function fixRecords(partyId,from,to){var p=PARTIES[partyId],box=document.getElementById('fix');if(!p)return;box.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'records',branchId:sel.value,supplierId:p.oldId}).then(function(r){if(!r.ok){box.innerHTML='<div class="msg bad">'+esc(r.error)+'</div>';return}
    box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:10px"><h2>Yozuvlar — '+esc(r.supplier.name)+'</h2><p class="hint">Xato yozuvni olib tashlasangiz, qarz, ombor va pul qanday o‘zgarishi oldin ko‘rsatiladi. Asl yozuv tarixda qoladi.</p>'
      +(r.records.length?r.records.map(function(x){return '<div class="list-row"><div><b>'+esc(TXK[x.type]||x.type)+' · '+won(x.amount)+'</b><br><small style="color:var(--muted)">'+esc(x.date)+(x.note?' · '+esc(x.note):'')+(x.closed?' · oy yopilgan':'')+'</small></div>'+(x.closed?'':'<button class="ghost" data-cx="'+esc(x.id)+'" style="min-height:32px;padding:2px 10px">Olib tashlash</button>')+'</div>'}).join(''):'<p class="hint">Yozuv yo‘q.</p>')+'</div>';
    box.querySelectorAll('[data-cx]').forEach(function(b){b.addEventListener('click',function(){var x=r.records.find(function(y){return y.id===b.dataset.cx});
      haloRemove({kind:'transaction',id:b.dataset.cx,branch:sel.value,label:r.supplier.name+' · '+(x?(TXK[x.type]||x.type)+' '+won(x.amount)+' · '+x.date:''),done:function(){load();setTimeout(function(){openStatement(partyId,from,to)},400)}})})});
  })}
function fixBalance(partyId,from,to){var p=PARTIES[partyId],box=document.getElementById('fix');if(!p)return;
  box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:10px"><h2>Qoldiqni tuzatish</h2><p class="hint">Yetkazib beruvchi bilan kelishilgan haqiqiy qarzni yozing. Farq sababi bilan tarixda saqlanadi.</p>'
    +'<label class="field"><span>To‘g‘ri qarz (₩)</span><input class="money" id="bAmt" inputmode="numeric" placeholder="0"></label><label class="field"><span>Sabab</span><input id="bWhy" maxlength="200" placeholder="Masalan: akt bo‘yicha kelishildi"></label><button id="bSave">Saqlash</button></div>';
  var a=document.getElementById('bAmt');a.addEventListener('input',function(){var d=a.value.replace(/[^0-9]/g,'');a.value=d?Number(d).toLocaleString('en-US'):''});
  document.getElementById('bSave').addEventListener('click',function(){var why=document.getElementById('bWhy').value.trim(),amt=Number(a.value.replace(/[^0-9]/g,''));if(!why){alert('Sababini yozing.');return}if(!confirm('Qarz '+won(amt)+' qilib belgilansinmi?'))return;
    api({action:'editBalance',branchId:sel.value,supplierId:p.oldId,balance:amt,reason:why}).then(function(x){if(!x.ok){alert(x.error||'Bo‘lmadi');return}load();setTimeout(function(){openStatement(partyId,from,to)},400)})})}
function fixInfo(partyId){var p=PARTIES[partyId],box=document.getElementById('fix');if(!p)return;box.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'records',branchId:sel.value,supplierId:p.oldId}).then(function(r){if(!r.ok){box.innerHTML='<div class="msg bad">'+esc(r.error)+'</div>';return}var s2=r.supplier;
    box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:10px"><h2>Ma’lumotlari</h2><label class="field"><span>Nomi</span><input id="iN" maxlength="100" value="'+esc(s2.name)+'"></label><label class="field"><span>Telefon</span><input id="iP" maxlength="60" value="'+esc(s2.phone)+'"></label><label class="field"><span>Hisob raqami</span><input id="iB" maxlength="120" value="'+esc(s2.bankAccount)+'"></label><button id="iS">Saqlash</button></div>';
    document.getElementById('iS').addEventListener('click',function(){fetch('/api/supplier-records?branch='+encodeURIComponent(sel.value),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveSupplier',branchId:sel.value,supplier:{id:s2.id,name:document.getElementById('iN').value,phone:document.getElementById('iP').value,bankAccount:document.getElementById('iB').value}})}).then(function(x){return x.json()}).then(function(x){if(x.error){alert(x.error);return}box.innerHTML='<div class="msg ok">✓ Saqlandi</div>';load()})})})}
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

document.getElementById('addSup').addEventListener('click',function(){
  var box=document.getElementById('supForm'),id='sup-'+(crypto.randomUUID?crypto.randomUUID():String(Date.now()));
  box.innerHTML='<div style="margin-top:12px"><label class="field"><span>Nomi</span><input id="sName" maxlength="100" placeholder="Masalan: Nodir aka (go‘sht)"></label>'
    +'<label class="field"><span>Telefon (ixtiyoriy)</span><input id="sPhone" maxlength="60" inputmode="tel"></label>'
    +'<label class="field"><span>Bank hisob raqami (ixtiyoriy)</span><input id="sBank" maxlength="120"></label>'
    +'<div class="row"><button id="sSave">Saqlash</button><button class="ghost" id="sCancel">Bekor</button></div><div id="sMsg"></div></div>';
  document.getElementById('sCancel').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('sSave').addEventListener('click',function(){
    var name=document.getElementById('sName').value.trim(),msg=document.getElementById('sMsg');
    if(name.length<2){msg.innerHTML='<div class="msg bad">Nomini yozing.</div>';return}
    var exists=Object.keys(PARTIES).some(function(k){return PARTIES[k].name.toLowerCase()===name.toLowerCase()});
    if(exists&&!confirm('Shu nomli yetkazib beruvchi bor. Baribir yangisini qo‘shasizmi?'))return;
    var btn=this;btn.disabled=true;
    fetch('/api/supplier-records?branch='+encodeURIComponent(sel.value),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveSupplier',supplier:{id:id,name:name,phone:document.getElementById('sPhone').value,bankAccount:document.getElementById('sBank').value}})})
    .then(function(r){return r.json()}).catch(function(){return {error:'Internet aloqasini tekshiring.'}}).then(function(x){btn.disabled=false;
      if(!x.ok){msg.innerHTML='<div class="msg bad">'+esc(x.error||'Saqlanmadi.')+'</div>';return}
      box.innerHTML='<div class="msg ok" style="margin-top:12px">✓ '+esc(name)+' qo‘shildi. Endi uni bosib xarid yoki to‘lov kiritasiz.</div>';load()});
  });
});
${SUPPLIER_INTAKE_SCRIPT}`,
  });
}
