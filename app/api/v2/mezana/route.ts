import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import {
  mezanaBorrowedQuantityBalance, mezanaDebtActionLabel, mezanaDebtBalance, normalizeMezanaDebtEntries, validMezanaDebtEntry,
  type MezanaDebtAction, type MezanaDebtEntry,
} from "../../../lib/mezana-debts";
import { mezanaCatalogItemForAction, normalizeMezanaCatalog } from "../../../lib/mezana-catalog";
import { MezanaPostingError } from "../../../lib/mezana-posting";
import { isAccountingMonthClosed } from "../../../lib/month-end";
import { assertV2DayOpen, ClosedDayError } from "../../../core/closed-days";
import { shell } from "../../../core/ui-shell";

/**
 * HALO V2 — MEZANA: qo'shni do'kondan olib turilgan mahsulot, qaytarilgani, qarzga sotib olingani va to'lov.
 * Qoidalar eski tizim bilan bir xil (mezana-debts / mezana-posting). Yangi: to'lov qaysi hisobdan berilganini
 * tanlash mumkin — shunda kassa/bank qoldig'i to'g'ri bo'ladi (foydaga ta'sir qilmaydi, xarid allaqachon xarajat).
 */
declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
type Row = Record<string, unknown>;
const PAGE_PATH = "/api/v2/mezana";
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);
class MezanaError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  return new Response(page(branches), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export function mezanaView(state: Row, today: string) {
  const entries = normalizeMezanaDebtEntries(state.mezanaEntries);
  const accounts = new Map(rows(state.accounts).map((account) => [String(account.id), String(account.name || account.id)]));
  const paidFrom = new Map(rows(state.financialEntries).filter((entry) => entry.mezanaEntryId && entry.category === "MEZANA to‘lovi")
    .map((entry) => [String(entry.mezanaEntryId), accounts.get(String(entry.accountId)) || ""]));
  const names = [...new Set(entries.filter((entry) => entry.action === "borrowed").map((entry) => entry.productName))];
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  return {
    debt: Math.max(0, mezanaDebtBalance(entries)),
    borrowed: names.map((name) => ({ name, quantity: mezanaBorrowedQuantityBalance(entries, name) })).filter((item) => item.quantity > 0).sort((a, b) => a.name.localeCompare(b.name)),
    catalog: normalizeMezanaCatalog(state.mezanaCatalog).filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, mode: item.mode, price: item.price })),
    entries: entries.filter((entry) => entry.date >= since).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 150)
      .map((entry) => ({ id: entry.id, action: entry.action, name: entry.productName, amount: entry.amount, quantity: entry.quantity || entry.itemCount || 0, date: entry.date, note: entry.note, by: entry.createdByName, paidFrom: paidFrom.get(entry.id) || "" })),
    accounts: rows(state.accounts).filter((account) => (account.type === "cash" || account.type === "bank") && account.active !== false).map((account) => ({ id: String(account.id), name: String(account.name || account.id) })),
  };
}

/** Rahbar MEZANA yozuvi. To'lovda hisob tanlansa, pul chiqimi MEZANA yozuviga bog'lanadi (bekor qilinsa birga ketadi). */
export function addMezanaEntry(state: Row, body: Row, today: string) {
  const action = clean(body.action, 20) as MezanaDebtAction;
  if (!["borrowed", "returned", "purchased", "paid"].includes(action)) throw new MezanaError("Amalni tanlang.");
  const operationId = clean(body.operationId, 36);
  if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new MezanaError("Oynani yangilang.");
  const date = clean(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new MezanaError("Sanani tekshiring.");
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new MezanaError(`${date.slice(0, 7)} oyi yopilgan.`, 409);
  const entryId = `mezana:${operationId}`;
  const current = normalizeMezanaDebtEntries(state.mezanaEntries);
  if (current.some((entry) => entry.id === entryId)) return { state, result: { entryId, alreadySaved: true } };
  const catalogItemId = clean(body.catalogItemId, 100);
  const item = action === "paid" || !catalogItemId ? null : mezanaCatalogItemForAction(normalizeMezanaCatalog(state.mezanaCatalog), catalogItemId, action);
  if (catalogItemId && !item) throw new MezanaError("Bu mahsulot ushbu amal uchun MEZANA ro‘yxatida yo‘q.");
  const quantity = Number(body.quantity);
  const itemCount = Number(body.itemCount);
  let amount = Number(body.amount);
  let productName = item ? item.name : action === "paid" ? "MEZANA to‘lovi" : clean(body.productName, 140);
  if (!productName) throw new MezanaError("Mahsulotni tanlang yoki nomini yozing.");
  if (action === "borrowed" || action === "returned") {
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw new MezanaError("Sonini yozing.");
    amount = 0;
  }
  if (action === "purchased" && item) {
    if (!Number.isSafeInteger(itemCount) || itemCount <= 0 || itemCount > 1_000_000) throw new MezanaError("Sonini yozing.");
    amount = item.price * itemCount;
  }
  if ((action === "purchased" || action === "paid") && (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000_000)) throw new MezanaError("Summani yozing.");
  if (action === "returned" && quantity > Math.max(0, mezanaBorrowedQuantityBalance(current, productName))) {
    throw new MezanaError(`${productName}dan faqat ${Math.max(0, mezanaBorrowedQuantityBalance(current, productName))} ta olib turilgan.`);
  }
  if (action === "paid" && amount > Math.max(0, mezanaDebtBalance(current))) {
    throw new MezanaError(`MEZANA qarzi faqat ₩${Math.max(0, mezanaDebtBalance(current)).toLocaleString("en-US")}. To‘lov bundan oshmasin.`);
  }
  const accountId = action === "paid" ? clean(body.accountId, 100) : "";
  const account = accountId ? rows(state.accounts).find((entry) => entry.id === accountId && (entry.type === "cash" || entry.type === "bank")) : undefined;
  if (accountId && !account) throw new MezanaError("Pul hisobi topilmadi.");
  const note = action === "purchased" || action === "paid" ? clean(body.note, 300) : "";
  const entry: MezanaDebtEntry = {
    id: entryId, action, productName, amount,
    ...(item ? { catalogItemId: item.id, unitPrice: item.price } : {}),
    ...(action === "purchased" && item ? { itemCount } : {}),
    ...(action === "purchased" || action === "paid" ? {} : { quantity }),
    date, note, documents: [], createdByWorkerId: "owner", createdByName: "Rahbar", createdAt: new Date().toISOString(),
  };
  if (!validMezanaDebtEntry(entry)) throw new MezanaError("MEZANA yozuvini tekshiring.");
  const payment = account ? [{
    // Id MEZANA'ning o'z "effect" qoidasiga mos: yozuv o'chirilsa, bu pul chiqimi ham birga olib tashlanadi.
    id: `mezana-effect:${entryId}`, type: "expense", category: "MEZANA to‘lovi", amount, date, accountId: String(account.id),
    affectsProfit: false, mezanaEntryId: entryId, note: `MEZANA qarzi to‘landi${note ? ` · ${note}` : ""}`, createdAt: entry.createdAt,
  }] : [];
  return {
    state: { ...state, mezanaEntries: [entry, ...rows(state.mezanaEntries)], financialEntries: [...payment, ...rows(state.financialEntries)] },
    result: { entryId, alreadySaved: false, label: `${mezanaDebtActionLabel(action)} · ${productName}` },
  };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Row;
    const branchId = String(body.branchId || "main");
    const today = seoulToday();
    if (body.action === "add") {
      if (body.entryAction === "paid" && body.accountId) await assertV2DayOpen(branchId, clean(body.date, 10));
      const mutation = await mutateHaloState((state) => { const out = addMezanaEntry(state as Row, { ...body, action: body.entryAction }, today); return { state: out.state as Row, result: out.result.entryId }; }, 5, branchId, "Rahbar",
        `MEZANA · ${clean(body.entryAction, 20)} · ${clean(body.productName || body.catalogItemId, 60)}`, "MEZANA");
      return json({ ok: true, today, entryId: mutation.result, ...mezanaView(mutation.state as Row, today) });
    }
    const { state } = await readHaloState(branchId);
    return json({ ok: true, today, ...mezanaView(state as Row, today) });
  } catch (error) {
    if (error instanceof MezanaError) return json({ error: error.message }, error.status);
    if (error instanceof MezanaPostingError || error instanceof ClosedDayError) return json({ error: error.message }, 409);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "MEZANA", active: "qarz", heading: "MEZANA",
    subtitle: "Olib turilgan, qaytarilgan, qarzga olingan mahsulot va to‘lovlar",
    headerRight: '<div class="row"><input type="date" id="date"><select id="branch"></select></div>',
    back: "/api/v2/qarz",
    body: `<section class="card"><div class="grid" id="kpi"></div></section>
<section class="card"><h2>Yangi yozuv</h2><div class="row" id="acts" style="gap:8px;margin-bottom:12px"></div><div id="form"></div></section>
<section class="card"><h2>Oxirgi 90 kun</h2><div id="list"></div></section>`,
    script: `
var BRANCHES=${boot},D=null,ACT='borrowed',OP='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function digits(v){return Number(String(v||'').replace(/[^0-9]/g,''))||0}
function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)})}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch'),dt=document.getElementById('date');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var LABEL={borrowed:'📥 Olib turildi',returned:'📤 Qaytarildi',purchased:'🛒 Qarzga olindi',paid:'💸 To‘lov'};
function load(){document.getElementById('list').innerHTML=haloLoading(3);api({branchId:sel.value}).then(function(x){if(!x.ok){document.getElementById('list').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}D=x;if(!dt.value)dt.value=x.today;dt.max=x.today;OP=uuid();draw()})}
function draw(){
  document.getElementById('kpi').innerHTML='<div class="kpi"><small>MEZANA’ga qarz</small><b style="color:var(--'+(D.debt?'bad':'ok')+')">'+won(D.debt)+'</b></div><div class="kpi"><small>Olib turilgan (qaytarilmagan)</small><b>'+D.borrowed.reduce(function(s,b){return s+b.quantity},0)+' ta</b><span class="hint">'+(D.borrowed.map(function(b){return esc(b.name)+' '+b.quantity}).join(' · ')||'—')+'</span></div>';
  document.getElementById('acts').innerHTML=Object.keys(LABEL).map(function(a){return '<button class="'+(ACT===a?'':'ghost')+'" data-a="'+a+'" style="min-height:40px;padding:8px 12px">'+LABEL[a]+'</button>'}).join('');
  document.querySelectorAll('[data-a]').forEach(function(b){b.addEventListener('click',function(){ACT=b.dataset.a;OP=uuid();draw()})});
  drawForm();drawList();
}
function drawForm(){var box=document.getElementById('form'),mode=ACT==='purchased'?'purchased':'borrowed';
  var cat=D.catalog.filter(function(c){return c.mode===mode});var h='';
  if(ACT==='paid'){h='<label class="field"><span>To‘lov summasi (qarz: '+won(D.debt)+')</span><input class="money" id="mA" inputmode="numeric" placeholder="0"></label><label class="field"><span>Qaysi hisobdan to‘landi</span><select id="mAcc">'+D.accounts.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>'}).join('')+'<option value="">— Hisobga yozilmasin (boshqa joydan to‘langan)</option></select></label><p class="hint">Hisob tanlansa, pul chiqimi kassa/bankda ko‘rinadi (foydaga ta’sir qilmaydi — xaridi allaqachon xarajat).</p>'}
  else{
    if(ACT==='returned'){var avail=D.borrowed;h+='<label class="field"><span>Nima qaytarildi</span><select id="mP">'+(avail.length?avail.map(function(b){var c=D.catalog.find(function(x){return x.name===b.name&&x.mode==='borrowed'});return '<option value="'+esc(c?c.id:'')+'" data-n="'+esc(b.name)+'">'+esc(b.name)+' (olingan: '+b.quantity+')</option>'}).join(''):'<option value="">Qaytariladigan narsa yo‘q</option>')+'</select></label>'}
    else h+='<label class="field"><span>Mahsulot</span><select id="mP">'+(cat.length?cat.map(function(c){return '<option value="'+esc(c.id)+'" data-n="'+esc(c.name)+'">'+esc(c.name)+(c.price&&ACT==='purchased'?' · '+won(c.price):'')+'</option>'}).join(''):'')+'<option value="" data-n="">— Boshqa (nomini yozaman)</option></select></label><label class="field" id="mNw"><span>Nomi</span><input id="mN" maxlength="140"></label>';
    h+='<label class="field"><span>Soni</span><input id="mQ" inputmode="numeric" placeholder="1"></label>';
    if(ACT==='purchased')h+='<label class="field" id="mAw"><span>Summa (₩)</span><input class="money" id="mA" inputmode="numeric" placeholder="0"></label>';
  }
  if(ACT==='purchased'||ACT==='paid')h+='<label class="field"><span>Izoh (ixtiyoriy)</span><input id="mNote" maxlength="300"></label>';
  h+='<button class="block" id="mS">Saqlash</button><div id="mMsg"></div>';
  box.innerHTML=h;
  var a=document.getElementById('mA');if(a)a.addEventListener('input',function(){var v=digits(a.value);a.value=v?v.toLocaleString('en-US'):''});
  var p=document.getElementById('mP'),sync=function(){if(!p)return;var custom=!p.value;var nw=document.getElementById('mNw');if(nw)nw.hidden=!custom||ACT==='returned';var aw=document.getElementById('mAw');if(aw)aw.hidden=!custom};if(p){p.addEventListener('change',sync);sync()}
  document.getElementById('mS').addEventListener('click',save);
}
function save(){var msg=document.getElementById('mMsg'),btn=document.getElementById('mS'),p=document.getElementById('mP');
  var b={action:'add',entryAction:ACT,branchId:sel.value,operationId:OP,date:dt.value};
  if(ACT==='paid'){b.amount=digits(document.getElementById('mA').value);b.accountId=document.getElementById('mAcc').value}
  else{b.catalogItemId=p?p.value:'';b.productName=p&&p.value?(p.selectedOptions[0]||{}).dataset.n:(ACT==='returned'?((p&&p.selectedOptions[0])||{dataset:{}}).dataset.n:(document.getElementById('mN')||{}).value);
    var q=digits(document.getElementById('mQ').value);if(ACT==='purchased'){b.itemCount=q;if(!b.catalogItemId)b.amount=digits(document.getElementById('mA').value)}else b.quantity=q}
  var n=document.getElementById('mNote');if(n)b.note=n.value;
  if(!confirm(LABEL[ACT]+(b.productName?' · '+b.productName:'')+(b.amount?' · '+won(b.amount):'')+(b.quantity||b.itemCount?' · '+(b.quantity||b.itemCount)+' ta':'')+' · '+dt.value+'. Saqlansinmi?'))return;
  btn.disabled=true;
  api(b).then(function(x){btn.disabled=false;if(!x.ok){msg.innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}
    var id=x.entryId;D=x;OP=uuid();draw();document.getElementById('mMsg').innerHTML='<div class="msg ok">✓ Saqlandi</div>';
    fetch('/api/owner-mezana',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({branchId:sel.value,entryId:id})}).catch(function(){})});
}
function drawList(){var box=document.getElementById('list');
  box.innerHTML=D.entries.length?D.entries.map(function(e){var money=e.action==='purchased'||e.action==='paid';return '<div class="list-row"><div style="min-width:0"><b>'+LABEL[e.action]+(e.action==='paid'?'':' · '+esc(e.name))+'</b><br><small style="color:var(--muted)">'+esc(e.date)+' · '+esc(e.by)+(e.paidFrom?' · to‘landi: '+esc(e.paidFrom):'')+(e.note?' · '+esc(e.note):'')+'</small></div><div style="text-align:right"><b>'+(money?won(e.amount):e.quantity+' ta')+'</b><br><button class="ghost" data-rm="'+esc(e.id)+'" style="min-height:30px;padding:2px 10px;margin-top:4px">Olib tashlash</button></div></div>'}).join(''):'<p class="hint">Yozuv yo‘q.</p>';
  box.querySelectorAll('[data-rm]').forEach(function(b){b.addEventListener('click',function(){var e=D.entries.find(function(x){return x.id===b.dataset.rm});haloRemove({kind:'mezana',id:b.dataset.rm,branch:sel.value,label:LABEL[e.action]+' · '+e.name+' · '+e.date,done:function(){load()}})})});
}
sel.addEventListener('change',load);load();
`,
  });
}
