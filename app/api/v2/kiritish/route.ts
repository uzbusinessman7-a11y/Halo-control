import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { costRuleCoversCategory } from "../../../lib/daily-report";
import { isAccountingMonthClosed } from "../../../lib/month-end";
import { DELIVERY_PLATFORMS } from "../../../lib/delivery-sales";
import { readDeductionRules } from "../../../core/deductions";
import { selectActiveFinancialEntries } from "../../../lib/daily-report";
import { CHICKEN_OIL_CAN_LITERS, isOilLedgerEntry } from "../../../lib/oil-accounting";
import { assertV2DayOpen, ClosedDayError } from "../../../core/closed-days";
import { ensureRecurring, RecurringError, recurringList, saveRecurring, stopRecurring } from "../../../core/recurring";
import { COURIER_CATEGORY } from "../../../core/courier";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — kiritish oynasi: savdo (naqd, hisob-raqam, delivery), POS hisobot, xarajat, yeyilgan / isrof.
 * Savdo eski tizimning tekshirilgan API'si (/api/pos-terminal) orqali saqlanadi — takror yozuv, yopilgan oy va
 * boshqa himoyalar o'sha yerda ishlaydi.
 * Mahsulot kirimi bu yerda EMAS: u faqat «Xarid → Yangi kirim» orqali kiritiladi (ombor + qarz + to'lov birga).
 * Shu sahifadagi «Mahsulot kirimi» tugmasi o'sha oynaga olib boradi — ikkinchi yo'l yo'q.
 */
const PAGE_PATH = "/api/v2/kiritish";
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Row = Record<string, unknown>;

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  return new Response(page(branches), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export const EXPENSE_CATEGORIES = [
  // Eski tizim ro'yxati bilan bir xil (hisobotlar mos bo'lishi uchun). Karta/delivery komissiyasi avtomatik,
  // mahsulot xaridi esa yetkazib beruvchi orqali kiritiladi — shu sabab bu yerda yo'q.
  "Ijara", "Elektr / gaz / suv", "Wi-Fi / telefon", "POS abonent to‘lovi", "Reklama", "Ta’mirlash", "Soliq", "Sug‘urta",
  "Do‘kon / omborsiz mahsulot", "Boshqa",
  // Telegram do'kon: mijozdan olingan yetkazish haqini kuryerga berish (foydaga ta'sir qilmaydi — bu pul bizniki emas edi).
  COURIER_CATEGORY,
];
export class EntryError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "") { super(message); }
}
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export function moneyAccounts(state: Row) {
  return (Array.isArray(state.accounts) ? state.accounts as Row[] : [])
    .filter((account) => (account.type === "cash" || account.type === "bank") && account.active !== false)
    .map((account) => ({ id: String(account.id), name: String(account.name || account.id), type: String(account.type) }));
}

function monthExpenses(state: Row, today: string) {
  const month = today.slice(0, 7);
  const accounts = new Map(moneyAccounts(state).map((account) => [account.id, account.name]));
  // Bekor qilingan xarajat va uning teskari yozuvi ro'yxatda ko'rinmaydi (eski tizim qoidasi).
  return selectActiveFinancialEntries(Array.isArray(state.financialEntries) ? state.financialEntries as Array<Row & { id?: string }> : [])
    .filter((entry) => entry.type === "expense" && String(entry.date || "").startsWith(month) && !entry.voided && !entry.cancelledAt)
    .map((entry) => ({ id: String(entry.id), date: String(entry.date), category: String(entry.category || "Boshqa"), amount: Number(entry.amount) || 0, note: String(entry.note || ""), account: accounts.get(String(entry.accountId)) || "", recurring: Boolean(entry.recurringExpenseId || entry.fixedExpenseId), payroll: Boolean(entry.payrollPaymentId), by: String(entry.createdByName || "") }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

/** Shu oy chicken moyi: xarid (xarajat) va ishlatilgan moy sotuvi (daromad). */
function monthOil(state: Row, today: string) {
  const month = today.slice(0, 7);
  const accounts = new Map(moneyAccounts(state).map((account) => [account.id, account.name]));
  const entries = selectActiveFinancialEntries(Array.isArray(state.financialEntries) ? state.financialEntries as Array<Row & { id?: string }> : [])
    .filter((entry) => isOilLedgerEntry(entry as never) && String(entry.date || "").startsWith(month) && !entry.cancelledAt)
    .map((entry) => ({ id: String(entry.id), date: String(entry.date), type: String(entry.oilFlowType), cans: Number(entry.oilCanCount) || 0, amount: Number(entry.amount) || 0, account: accounts.get(String(entry.accountId)) || "", note: String(entry.note || "") }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const sum = (type: string, key: "cans" | "amount") => entries.filter((entry) => entry.type === type).reduce((total, entry) => total + entry[key], 0);
  return { canLiters: CHICKEN_OIL_CAN_LITERS, entries, bought: { cans: sum("purchase", "cans"), amount: sum("purchase", "amount") }, sold: { cans: sum("resale", "cans"), amount: sum("resale", "amount") } };
}

/** Xarajat yozuvi (eski tizim formatida, serverda tekshirib). Takroriy so'rov ikkinchi marta yozilmaydi. */
export function addExpense(state: Row, body: Row, today: string) {
  const operationId = clean(body.operationId, 36);
  if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new EntryError("Oynani yangilang.");
  const id = `v2-expense:${operationId}`;
  const entries = Array.isArray(state.financialEntries) ? state.financialEntries as Row[] : [];
  const existing = entries.find((entry) => entry.id === id);
  if (existing) return { state, result: { entry: existing, alreadySaved: true } };
  const category = clean(body.category, 80);
  const name = clean(body.name, 140);
  const note = clean(body.note, 300);
  const date = clean(body.date, 10);
  const amount = Number(body.amount);
  const accountId = clean(body.accountId, 100);
  if (!EXPENSE_CATEGORIES.includes(category)) throw new EntryError("Xarajat turini tanlang.");
  if (!name) throw new EntryError("Nima uchun to‘langanini yozing.");
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000_000) throw new EntryError("Summani tekshiring.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new EntryError("Sanani tekshiring (kelajak bo‘lmasin).");
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new EntryError(`${date.slice(0, 7)} oyi yopilgan. Ochiq oy sanasini tanlang.`, 409);
  if (!moneyAccounts(state).some((account) => account.id === accountId)) throw new EntryError("Pul qaysi hisobdan chiqqanini tanlang.");
  // Soliq POS savdosidan avtomatik zaxiraga yig'iladi: to'langan soliq zaxirani yopadi, foydaga qayta tushmaydi.
  const paysTaxReserve = category === "Soliq" && costRuleCoversCategory(category, state.costRules as never);
  if (!paysTaxReserve && costRuleCoversCategory(category, state.costRules as never)) throw new EntryError("Bu xarajat avtomatik hisoblanadi — qayta kiritmang.");
  const reason = clean(body.duplicateReason, 200);
  const twin = entries.find((entry) => entry.type === "expense" && entry.date === date && Number(entry.amount) === amount && entry.category === category && !entry.voided && !entry.cancelledAt);
  if (twin && reason.length < 3) throw new EntryError("Shu kuni aynan shu turdagi va shu summadagi xarajat bor. Bu boshqa xarajat bo‘lsa, sababini yozing.", 409, "DUPLICATE");
  const entry = {
    id, type: "expense", category, amount, date, accountId,
    note: [paysTaxReserve ? "Soliq to‘lovi (avtomatik zaxiradan)" : "", name, note].filter(Boolean).join(" · "), affectsProfit: !paysTaxReserve && category !== COURIER_CATEGORY,
    createdByName: "Rahbar", createdAt: new Date().toISOString(),
    ...(twin ? { duplicateOf: twin.id, duplicateReason: reason } : {}),
  };
  return { state: { ...state, financialEntries: [entry, ...entries] }, result: { entry, alreadySaved: false } };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Row;
    const today = seoulToday();
    const branchId = String(body.branchId || "main");
    if (body.action === "saveRecurring" || body.action === "stopRecurring") {
      const mutation = await mutateHaloState((state) => { const out = body.action === "saveRecurring" ? saveRecurring(state, body, today) : stopRecurring(state, body); return { state: out.state as Row, result: null }; }, 5, branchId, "Rahbar",
        body.action === "saveRecurring" ? `Oylik avtomatik xarajat saqlandi: ${clean(body.name, 60)}` : "Oylik avtomatik xarajat to‘xtatildi", "Kiritish (yangi)");
      await ensureRecurring(branchId, today);
      const { state } = await readHaloState(branchId);
      return json({ ok: true, today, recurring: recurringList(state as Row), expenses: monthExpenses(state as Row, today), saved: mutation.result });
    }
    if (body.action === "expense") {
      await assertV2DayOpen(branchId, clean(body.date, 10));
      const mutation = await mutateHaloState((state) => addExpense(state, body, today), 5, branchId, "Rahbar",
        `Xarajat: ${clean(body.name, 60)} · ₩${Number(body.amount || 0).toLocaleString("en-US")}`, "Kiritish (yangi)");
      return json({ ok: true, today, ...mutation.result, expenses: monthExpenses(mutation.state, today) });
    }
    await ensureRecurring(branchId, today);
    const { state } = await readHaloState(branchId);
    return json({
      recurring: recurringList(state as Row),
      ok: true, today, platforms: DELIVERY_PLATFORMS, rules: readDeductionRules(state as Row),
      accounts: moneyAccounts(state as Row), categories: EXPENSE_CATEGORIES, expenses: monthExpenses(state as Row, today), oil: monthOil(state as Row, today),
      posImportDates: [...new Set((Array.isArray((state as Row).sales) ? (state as Row).sales as Row[] : []).filter((sale) => sale.posImport && !sale.cancelledAt && !sale.voided).map((sale) => String(sale.date)))].slice(-120),
    });
  } catch (error) {
    if (error instanceof EntryError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof RecurringError) return json({ error: error.message }, error.status);
    if (error instanceof ClosedDayError) return json({ error: error.message }, 409);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Kiritish", active: "kiritish", heading: "Kiritish",
    subtitle: "Savdo, POS hisobot, xarajat, yeyilgan ovqat",
    headerRight: '<div class="row"><input type="date" id="date"><select id="branch"></select></div>',
    body: `<section class="card"><div class="row" id="tabs"></div></section><div id="pane" style="display:grid;gap:16px"></div>
<style>
.menu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.dish{background:var(--card-2);border:1px solid var(--line);border-radius:14px;padding:12px;cursor:pointer;user-select:none;position:relative;text-align:left;color:inherit;font:inherit;min-height:74px}
.dish b{display:block;font-size:15px;line-height:1.25}.dish small{color:var(--muted);font-size:13px}
.dish.on{border-color:var(--accent);background:var(--accent-soft)}
.dish .q{position:absolute;top:8px;right:8px;background:var(--accent);color:var(--accent-ink);border-radius:99px;font-weight:800;font-size:13px;min-width:24px;height:24px;display:grid;place-items:center;padding:0 6px}
.cart-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line)}
.stepper{display:flex;align-items:center;gap:6px}.stepper button{min-height:36px;width:36px;padding:0;border-radius:10px}
.pay{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.sticky-total{position:sticky;bottom:calc(76px + env(safe-area-inset-bottom));z-index:3}
@media (min-width:900px){.sticky-total{bottom:12px}}
#pane{padding-bottom:110px}
</style>`,
    script: `
var BRANCHES=${boot},TAB='sale',DATA=null,MENU=null,CART={},PAY='cash',OP='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)})}
function digits(v){return Number(String(v||'').replace(/[^0-9]/g,''))||0}
function post(url,body){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
var sel=document.getElementById('branch'),dt=document.getElementById('date');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var TABS={sale:'🧾 Savdo',pos:'📊 POS hisobot',expense:'💸 Xarajat',meal:'🍽 Yeyilgan / isrof'};
/* Mahsulot kirimi — alohida yo'l emas: «Xarid» bo'limidagi yagona «Yangi kirim» oynasiga olib boradi. */
function tabs(){document.getElementById('tabs').innerHTML=Object.keys(TABS).map(function(k){return '<button class="'+(k===TAB?'':'ghost')+'" data-t="'+k+'">'+TABS[k]+'</button>'}).join('')
    +'<a href="/api/v2/qarz?kirim=1" style="text-decoration:none"><button class="ghost" type="button">📦 Mahsulot kirimi ›</button></a>';
  document.querySelectorAll('[data-t]').forEach(function(b){b.addEventListener('click',function(){TAB=b.dataset.t;OP=uuid();render()})})}
function load(){
  document.getElementById('pane').innerHTML='<section class="card">'+haloLoading(4)+'</section>';
  Promise.all([post(location.pathname,{branchId:sel.value}),fetch('/api/pos-terminal?branch='+encodeURIComponent(sel.value)).then(function(r){return r.json()}).catch(function(){return {error:'Menyu ochilmadi.'}})]).then(function(res){
    if(!res[0].body.ok){document.getElementById('pane').innerHTML='<div class="msg bad">'+esc(res[0].body.error)+'</div>';return}
    DATA=res[0].body;MENU=res[1];if(!dt.value){dt.value=DATA.today}dt.max=DATA.today;CART={};OP=uuid();render();
  });
}
function render(){tabs();if(TAB==='pos')renderPosImport();else if(TAB==='expense')renderExpense();else if(TAB==='meal')renderMeal();else renderSale()}

/* ---------- Savdo ---------- */
function price(item){if(PAY==='delivery'){var pl=document.getElementById('plat');var p=pl?pl.value:(DATA.platforms[0]||{}).id;return Number((item.deliveryPrices||{})[p]||0)}return Number(item.salePrice||0)}
function renderSale(){
  var pane=document.getElementById('pane');
  if(MENU&&MENU.error){pane.innerHTML='<div class="msg bad">'+esc(MENU.error)+'</div>';return}
  var cats=(MENU.productCategories||[]).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
  var items=MENU.catalog||[];
  var groups=cats.map(function(c){return {name:c.name,items:items.filter(function(i){return i.categoryId===c.id})}}).filter(function(g){return g.items.length});
  var rest=items.filter(function(i){return !cats.some(function(c){return c.id===i.categoryId})});if(rest.length)groups.push({name:groups.length?'Boshqa':'Menyu',items:rest});
  if(['cash','bank','delivery','pcard','pcash'].indexOf(PAY)<0)PAY='cash';
  var posDay=(DATA.posImportDates||[]).indexOf(dt.value||DATA.today)>=0;
  pane.innerHTML='<section class="card"><h2>To‘lov turi</h2><p class="hint" style="margin:0 0 6px"><b>HALO hisob</b> — soliqsiz (xodimlar <a href="/pos">HALO HISOB</a> oynasida kiritadi):</p><div class="pay">'
    +[['cash','💵 Naqd'],['bank','🏦 Hisob-raqam'],['delivery','🛵 Delivery']].map(function(p){return '<button class="'+(PAY===p[0]?'':'ghost')+'" data-pay="'+p[0]+'">'+p[1]+'</button>'}).join('')+'</div>'
    +'<p class="hint" style="margin:12px 0 6px"><b>POS apparati</b> — soliq (kartada komissiya ham) avtomatik. Excel hisobot yuklamasangiz, shu yerda qo‘lda:</p><div class="pay" style="grid-template-columns:1fr 1fr">'
    +[['pcard','💳 POS karta'],['pcash','🧾 POS naqd']].map(function(p){return '<button class="'+(PAY===p[0]?'':'ghost')+'" data-pay="'+p[0]+'">'+p[1]+'</button>'}).join('')+'</div>'
    +((PAY==='pcard'||PAY==='pcash')&&posDay?'<div class="msg warn" style="margin-top:10px">Bu kun uchun POS Excel hisoboti yuklangan. Qo‘lda ham kiritsangiz savdo ikki marta hisoblanadi.</div>':'')
    +(PAY==='delivery'?'<div class="row" style="margin-top:12px"><select id="plat" style="flex:1">'+DATA.platforms.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>'}).join('')+'</select><input id="ordNo" maxlength="64" placeholder="Buyurtma raqami (ixtiyoriy)" style="flex:1"></div><label class="field" style="margin:10px 0 0"><span>Platforma ushlagan summa (ixtiyoriy, ₩)</span><input id="dFee" inputmode="numeric" placeholder="Bo‘sh qoldirsangiz — sozlamadagi foiz bo‘yicha"></label><p class="hint" style="margin:6px 0 0">Ilovadagi hisob-kitobda boshqa summa ko‘rinsa, shu yerga yozing — faqat shu buyurtma uchun.</p>':'')
    +'</section>'
    +groups.map(function(g){return '<section class="card"><h2>'+esc(g.name)+'</h2><div class="menu-grid">'+g.items.map(function(i){var q=CART[i.id]||0,p=price(i);
      return '<button class="dish'+(q?' on':'')+'" data-add="'+esc(i.id)+'"'+(p?'':' style="opacity:.45"')+'>'+(q?'<span class="q">'+q+'</span>':'')+'<b>'+esc(i.name)+'</b><small>'+(p?won(p):'narx yo‘q')+'</small></button>'}).join('')+'</div></section>'}).join('')
    +'<section class="card sticky-total" id="cart"></section>'
    +'<section class="card"><h2>Bugungi savdolar</h2><div id="recent"></div></section>';
  document.querySelectorAll('[data-pay]').forEach(function(b){b.addEventListener('click',function(){PAY=b.dataset.pay;OP=uuid();renderSale()})});
  var df=document.getElementById('dFee');if(df)df.addEventListener('input',function(){var v=digits(df.value);df.value=v?v.toLocaleString('en-US'):'';drawCart()});
  var pl=document.getElementById('plat');if(pl){pl.addEventListener('change',function(){drawCart();document.querySelectorAll('.dish').forEach(function(el){var it=items.find(function(i){return i.id===el.dataset.add});el.querySelector('small').textContent=price(it)?won(price(it)):'narx yo‘q'})})}
  document.querySelectorAll('[data-add]').forEach(function(b){b.addEventListener('click',function(){var it=items.find(function(i){return i.id===b.dataset.add});if(!price(it))return;CART[it.id]=(CART[it.id]||0)+1;renderDish(b,it);drawCart()})});
  drawCart();drawRecent();
}
function renderDish(el,it){var q=CART[it.id]||0;el.classList.toggle('on',q>0);var s=el.querySelector('.q');if(q){if(!s){s=document.createElement('span');s.className='q';el.prepend(s)}s.textContent=q}else if(s)s.remove()}
function drawCart(){
  var box=document.getElementById('cart');if(!box)return;var items=MENU.catalog||[];
  var ids=Object.keys(CART).filter(function(k){return CART[k]>0});
  var total=ids.reduce(function(s,k){var it=items.find(function(i){return i.id===k});return s+price(it)*CART[k]},0);
  if(!ids.length){box.innerHTML='<p class="hint" style="margin:0">Taomni bosing — savatga qo‘shiladi.</p>';return}
  box.innerHTML='<h2>Savat</h2>'+ids.map(function(k){var it=items.find(function(i){return i.id===k});
    return '<div class="cart-row"><span>'+esc(it.name)+'<br><small style="color:var(--muted)">'+won(price(it))+' × '+CART[k]+'</small></span><div class="stepper"><button class="ghost" data-m="'+esc(k)+'">−</button><b>'+CART[k]+'</b><button class="ghost" data-p="'+esc(k)+'">+</button></div></div>'}).join('')
    +'<div class="row" style="justify-content:space-between;margin-top:10px"><span class="big">'+won(total)+'</span><button id="saveSale">Saqlash</button></div>'+cutLine(total)+'<div id="sMsg"></div>';
  box.querySelectorAll('[data-m]').forEach(function(b){b.addEventListener('click',function(){CART[b.dataset.m]=Math.max(0,(CART[b.dataset.m]||0)-1);syncDishes();drawCart()})});
  box.querySelectorAll('[data-p]').forEach(function(b){b.addEventListener('click',function(){CART[b.dataset.p]=(CART[b.dataset.p]||0)+1;syncDishes();drawCart()})});
  document.getElementById('saveSale').addEventListener('click',function(){saveSale(total)});
}
/* Ushlanmalar oldindan ko'rinsin: soliq, karta komissiyasi, delivery ushlanmasi va qo'lga tegadigan summa. */
function cutLine(total){var r=DATA.rules||{},tax=0,fee=0;
  if(PAY==='pcard'||PAY==='pcash'||PAY==='delivery')tax=Math.round(total*(r.taxPct||0)/100);
  if(PAY==='pcard')fee=Math.round(total*(r.cardPct||0)/100);
  if(PAY==='delivery'){var el=document.getElementById('dFee'),pid=(document.getElementById('plat')||{}).value,pf=(r.platforms||[]).find(function(x){return x.id===pid})||{pct:0,feeWon:0};fee=el&&digits(el.value)?digits(el.value):Math.min(total,Math.round(total*pf.pct/100)+pf.feeWon)}
  if(!tax&&!fee)return '<p class="hint" style="margin:6px 0 0">Soliqsiz · to‘liq '+won(total)+'</p>';
  return '<p class="hint" style="margin:6px 0 0">'+(fee?(PAY==='pcard'?'Karta komissiyasi':'Platforma')+' −'+won(fee)+' · ':'')+'Soliq −'+won(tax)+' · <b style="color:var(--text)">Sof '+won(total-fee-tax)+'</b></p>'}
function syncDishes(){var items=MENU.catalog||[];document.querySelectorAll('[data-add]').forEach(function(el){renderDish(el,items.find(function(i){return i.id===el.dataset.add}))})}
function saveSale(total){
  var btn=document.getElementById('saveSale'),msg=document.getElementById('sMsg');
  var label={cash:'Naqd',bank:'Hisob-raqam',delivery:'Delivery',pcard:'POS karta',pcash:'POS naqd'}[PAY];
  if(!confirm(label+' savdo: '+won(total)+' · '+dt.value+'. Saqlansinmi?'))return;
  var body={operationId:OP.replace(/-/g,''),date:dt.value,mode:'sale',paymentType:PAY==='pcard'?'card':PAY==='pcash'?'cash':PAY,branchId:sel.value,items:Object.keys(CART).filter(function(k){return CART[k]>0}).map(function(k){return {recipeId:k,quantity:CART[k]}})};
  if(PAY==='pcard'||PAY==='pcash')body.salesChannel='pos';
  if(PAY==='delivery'){body.deliveryPlatform=document.getElementById('plat').value;body.deliveryOrderNumber=document.getElementById('ordNo').value.trim();var fv=digits(document.getElementById('dFee').value);if(fv)body.deliveryFeeOverrideWon=fv}
  btn.disabled=true;
  post('/api/pos-terminal',body).then(function(x){btn.disabled=false;
    if(!x.body.ok){msg.innerHTML='<div class="msg bad">'+esc(x.body.error||'Saqlanmadi.')+'</div>';return}
    MENU.orders=x.body.orders||MENU.orders;CART={};OP=uuid();renderSale();
    document.getElementById('cart').insertAdjacentHTML('afterbegin','<div class="msg ok" style="margin-bottom:10px">✓ '+label+' savdo saqlandi'+(x.body.alreadySaved?' (oldin saqlangan edi)':'')+'</div>');
  });
}
function drawRecent(){
  var box=document.getElementById('recent'),day=dt.value||DATA.today;
  var list=(MENU.orders||[]).filter(function(o){return o.date===day});
  var L={cash:'Naqd',bank:'Hisob-raqam',card:'POS karta',delivery:'Delivery'};
  var name=function(o){return o.paymentType==='cash'&&o.salesChannel==='pos'?'POS naqd':(L[o.paymentType]||o.paymentType||'Savdo')};
  box.innerHTML=list.length?list.map(function(o){var sid=((o.items||[])[0]||{}).saleId||'';return '<div class="list-row"><div><b>'+esc(name(o))+(o.deliveryPlatform?' · '+esc(o.deliveryPlatform):'')+'</b><br><small style="color:var(--muted)">'+(o.items||[]).map(function(i){return esc(i.name||'')+' ×'+i.quantity}).join(', ')+(o.workerName?' · '+esc(o.workerName):'')+'</small></div><div style="text-align:right"><b>'+won(o.total)+'</b>'+(sid?'<br><button class="ghost" data-so="'+esc(sid)+'" data-sl="'+esc(name(o)+' · '+won(o.total))+'" style="min-height:30px;padding:2px 10px;margin-top:4px">Olib tashlash</button>':'')+'</div></div>'}).join('')
    +'<p class="hint" style="margin-top:10px">Jami: '+won(list.reduce(function(s,o){return s+Number(o.total||0)},0))+'</p>':'<p class="hint">Bu sanada kiritilgan savdo yo‘q.</p>';
  box.querySelectorAll('[data-so]').forEach(function(b){b.addEventListener('click',function(){haloRemove({kind:'sale',id:b.dataset.so,branch:sel.value,label:b.dataset.sl+' · '+day,done:function(){load()}})})});
}

/* ---------- Xarajat ---------- */
var EXP={cat:'',acc:''},FOLD={rec:false,oil:false};
function renderExpense(){
  var pane=document.getElementById('pane'),d=DATA;
  if(!EXP.acc&&d.accounts.length)EXP.acc=d.accounts[0].id;
  var byCat={};d.expenses.forEach(function(e){byCat[e.category]=(byCat[e.category]||0)+e.amount});
  var total=d.expenses.reduce(function(s,e){return s+e.amount},0);
  pane.innerHTML='<section class="card"><h2>Xarajat kiritish</h2>'
    +'<p class="hint">Ijara, svet, gaz, reklama, ta’mir… Mahsulot xaridi bu yerda emas — <a href="/api/v2/qarz?kirim=1">Xarid → Yangi kirim</a> orqali.</p>'
    +'<div class="row" style="gap:8px;margin-bottom:12px">'+d.categories.map(function(c){return '<button class="'+(EXP.cat===c?'':'ghost')+'" data-cat="'+esc(c)+'" style="min-height:40px;padding:8px 12px">'+esc(c)+'</button>'}).join('')+'</div>'
    +'<label class="field"><span>Nima uchun</span><input id="xName" maxlength="140" placeholder="Masalan: oktabr ijarasi"></label>'
    +'<label class="field"><span>Summa</span><input class="money" id="xAmt" inputmode="numeric" placeholder="0"></label>'
    +'<label class="field"><span>Qaysi hisobdan to‘landi</span><select id="xAcc">'+d.accounts.map(function(a){return '<option value="'+esc(a.id)+'"'+(a.id===EXP.acc?' selected':'')+'>'+esc(a.name)+'</option>'}).join('')+'</select></label>'
    +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="xNote" maxlength="300"></label>'
    +'<button class="block" id="xSave">Saqlash</button><div id="xMsg"></div></section>'
    +recurringCard(d)+oilCard(d)
    +'<section class="card"><h2>Shu oy xarajatlari · '+won(total)+'</h2>'
    +(Object.keys(byCat).length?'<div class="grid" style="margin-bottom:12px">'+Object.keys(byCat).sort(function(a,b){return byCat[b]-byCat[a]}).map(function(c){return '<div class="kpi"><small>'+esc(c)+'</small><b>'+won(byCat[c])+'</b></div>'}).join('')+'</div>':'')
    +(d.expenses.length?d.expenses.slice(0,60).map(function(e){return '<div class="list-row"><div><b>'+esc(e.category)+'</b>'+(e.recurring?' <span class="tag warn">avtomatik</span>':'')+'<br><small style="color:var(--muted)">'+esc(e.date)+(e.account?' · '+esc(e.account):'')+(e.note?' · '+esc(e.note):'')+(e.by?' · '+esc(e.by):'')+'</small></div><div style="text-align:right"><b>'+won(e.amount)+'</b>'+'<br><button class="ghost" data-xc="'+esc(e.id)+'" style="min-height:30px;padding:2px 10px;margin-top:4px">Olib tashlash</button></div></div>'}).join(''):'<p class="hint">Bu oyda xarajat yo‘q.</p>')+'</section>';
  pane.querySelectorAll('[data-cat]').forEach(function(b){b.addEventListener('click',function(){EXP.cat=b.dataset.cat;var keep={n:document.getElementById('xName').value,a:document.getElementById('xAmt').value,o:document.getElementById('xNote').value};renderExpense();document.getElementById('xName').value=keep.n;document.getElementById('xAmt').value=keep.a;document.getElementById('xNote').value=keep.o})});
  var amt=document.getElementById('xAmt');amt.addEventListener('input',function(){var v=digits(amt.value);amt.value=v?v.toLocaleString('en-US'):''});
  document.getElementById('xAcc').addEventListener('change',function(){EXP.acc=this.value});
  document.getElementById('xSave').addEventListener('click',function(){saveExpense()});
  document.getElementById('reNew').addEventListener('click',function(){recurringForm(null)});
  pane.querySelectorAll('details[data-fold]').forEach(function(el){el.addEventListener('toggle',function(){FOLD[el.dataset.fold]=el.open})});
  bindOil();
  pane.querySelectorAll('[data-re]').forEach(function(b){b.addEventListener('click',function(){recurringForm((DATA.recurring||[]).find(function(r){return r.id===b.dataset.re}))})});
  pane.querySelectorAll('[data-xc]').forEach(function(b){b.addEventListener('click',function(){var e=d.expenses.find(function(x){return x.id===b.dataset.xc});
    haloRemove({kind:'finance',id:b.dataset.xc,branch:sel.value,label:e?e.category+' · '+won(e.amount)+' · '+e.date:'',done:function(){load()}})})});
}
/* ---------- Chicken moyi ---------- */
var OILT='purchase';
function oilCard(d){var o=d.oil||{entries:[],bought:{cans:0,amount:0},sold:{cans:0,amount:0},canLiters:18};
  return '<section class="card fold"><details data-fold="oil"'+(FOLD.oil?' open':'')+'><summary><span><b>🛢 Chicken moyi</b><small>Shu oy: olindi '+o.bought.cans+' kanistr · '+won(o.bought.amount)+(o.sold.cans?' · sotildi '+o.sold.cans+' kanistr':'')+'</small></span></summary><div class="grid" style="margin-bottom:12px"><div class="kpi"><small>Sotib olindi</small><b>'+o.bought.cans+' kanistr</b><span class="hint">'+won(o.bought.amount)+'</span></div><div class="kpi"><small>Ishlatilgani sotildi</small><b>'+o.sold.cans+' kanistr</b><span class="hint">'+won(o.sold.amount)+'</span></div></div>'
    +'<div class="pay" style="grid-template-columns:1fr 1fr;margin-bottom:12px"><button class="'+(OILT==='purchase'?'':'ghost')+'" data-oil="purchase">Yangi moy xaridi</button><button class="'+(OILT==='resale'?'':'ghost')+'" data-oil="resale">Ishlatilganini sotish</button></div>'
    +'<div class="row"><label class="field" style="flex:1"><span>Kanistr soni ('+o.canLiters+' L)</span><input id="oC" inputmode="numeric" placeholder="1"></label><label class="field" style="flex:1"><span>1 kanistr narxi (₩)</span><input id="oP" inputmode="numeric" placeholder="0"></label></div>'
    +'<label class="field"><span>'+(OILT==='purchase'?'Qaysi hisobdan to‘landi':'Pul qaysi hisobga tushdi')+'</span><select id="oA">'+d.accounts.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>'}).join('')+'</select></label>'
    +'<div class="row" style="justify-content:space-between"><b id="oT">0 ₩</b><button id="oS">Saqlash</button></div><div id="oMsg"></div>'
    +(o.entries.length?'<div style="margin-top:12px">'+o.entries.map(function(e){return '<div class="list-row"><div><b>'+(e.type==='purchase'?'Xarid':'Sotuv')+' · '+e.cans+' kanistr</b><br><small style="color:var(--muted)">'+esc(e.date)+(e.account?' · '+esc(e.account):'')+'</small></div><div style="text-align:right"><b>'+won(e.amount)+'</b><br><button class="ghost" data-orm="'+esc(e.id)+'" style="min-height:30px;padding:2px 10px;margin-top:4px">Olib tashlash</button></div></div>'}).join('')+'</div>':'')+'</details></section>'}
function bindOil(){var c=document.getElementById('oC'),pr=document.getElementById('oP');if(!c)return;
  var tot=function(){var n=digits(c.value)*digits(pr.value);document.getElementById('oT').textContent=won(n);return n};
  pr.addEventListener('input',function(){var v=digits(pr.value);pr.value=v?v.toLocaleString('en-US'):'';tot()});c.addEventListener('input',tot);
  document.querySelectorAll('[data-oil]').forEach(function(b){b.addEventListener('click',function(){OILT=b.dataset.oil;renderExpense()})});
  document.getElementById('oS').addEventListener('click',function(){var n=tot(),btn=this,msg=document.getElementById('oMsg');if(!digits(c.value)||!digits(pr.value)){msg.innerHTML='<div class="msg bad">Kanistr soni va narxini yozing.</div>';return}
    if(!confirm((OILT==='purchase'?'Moy xaridi':'Ishlatilgan moy sotuvi')+': '+digits(c.value)+' kanistr · '+won(n)+' · '+dt.value+'. Saqlansinmi?'))return;btn.disabled=true;
    post('/api/oil-records?branch='+encodeURIComponent(sel.value),{operationId:uuid(),flowType:OILT,accountId:document.getElementById('oA').value,date:dt.value,note:'',canCount:digits(c.value),unitAmount:digits(pr.value)}).then(function(x){btn.disabled=false;
      if(x.body.error||x.body.ok===false){msg.innerHTML='<div class="msg bad">'+esc(x.body.error||'Saqlanmadi.')+'</div>';return}
      post(location.pathname,{branchId:sel.value}).then(function(y){if(y.body.ok){DATA.oil=y.body.oil;DATA.expenses=y.body.expenses;renderExpense();document.getElementById('oMsg').innerHTML='<div class="msg ok">✓ Saqlandi</div>'}})})});
  document.querySelectorAll('[data-orm]').forEach(function(b){b.addEventListener('click',function(){haloRemove({kind:'finance',id:b.dataset.orm,branch:sel.value,label:'Chicken moyi · '+b.closest('.list-row').querySelector('b').textContent,done:function(){load()}})})});
}

/* ---------- Har oy avtomatik xarajatlar ---------- */
var REC=null;
function recurringCard(d){var list=d.recurring||[],act=list.filter(function(r){return r.active});
  return '<section class="card fold"><details data-fold="rec"'+(FOLD.rec?' open':'')+'><summary><span><b>🔁 Har oy avtomatik xarajatlar</b><small>'+(act.length?act.length+' ta · har oy '+won(act.reduce(function(s2,r){return s2+r.amount},0)):'Hali yo‘q — ijara, internet kabi to‘lovlar uchun')+'</small></span></summary><p class="hint">Ijara, internet, sug‘urta kabi har oy bir xil to‘lovlar. Belgilangan kuni o‘zi yoziladi — har oy qo‘lda kiritish shart emas.</p>'
    +(list.length?list.map(function(r){return '<div class="list-row"><div style="min-width:0"><b>'+esc(r.name)+'</b>'+(r.active?'':' <span class="tag warn">to‘xtatilgan</span>')+'<br><small style="color:var(--muted)">'+esc(r.category)+' · har oy '+r.billingDay+'-kuni · '+esc(r.account)+(r.active&&r.nextDue?' · keyingisi '+esc(r.nextDue):'')+'</small></div><div style="text-align:right"><b>'+won(r.amount)+'</b><br><button class="ghost" data-re="'+esc(r.id)+'" style="min-height:30px;padding:2px 10px;margin-top:4px">'+(r.active?'Tahrir':'Qayta yoqish')+'</button></div></div>'}).join(''):'<p class="hint">Hali yo‘q.</p>')
    +'<button class="ghost block" id="reNew" style="margin-top:10px">+ Oylik xarajat qo‘shish</button><div id="reForm"></div></details></section>'}
function recurringForm(r){var d=DATA,box=document.getElementById('reForm'),cats=d.categories.filter(function(c){return c!=='Soliq'});
  var day=r?r.billingDay:Number((d.today||'').slice(8,10))||1;
  box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:12px"><h2>'+(r?'Tahrirlash — '+esc(r.name):'Yangi oylik xarajat')+'</h2>'
    +'<label class="field"><span>Nomi</span><input id="rN" maxlength="80" value="'+esc(r?r.name:'')+'" placeholder="Masalan: Do‘kon ijarasi"></label>'
    +'<label class="field"><span>Turi</span><select id="rC">'+cats.map(function(c){return '<option'+(r&&r.category===c?' selected':'')+'>'+esc(c)+'</option>'}).join('')+'</select></label>'
    +'<label class="field"><span>Har oy summasi</span><input class="money" id="rA" inputmode="numeric" value="'+(r?r.amount.toLocaleString('en-US'):'')+'" placeholder="0"></label>'
    +'<div class="row"><label class="field" style="flex:1"><span>Har oyning nechanchi kuni</span><input id="rD" inputmode="numeric" value="'+day+'"></label><label class="field" style="flex:1"><span>Qaysi hisobdan</span><select id="rAc">'+d.accounts.map(function(a){return '<option value="'+esc(a.id)+'"'+(r&&r.accountId===a.id?' selected':'')+'>'+esc(a.name)+'</option>'}).join('')+'</select></label></div>'
    +(r?'':'<label class="row" style="gap:8px;margin-bottom:12px"><input type="checkbox" id="rThis" style="width:18px;height:18px;min-height:auto"> Shu oy uchun ham yozilsin (kuni o‘tgan bo‘lsa ham)</label>')
    +'<p class="hint">O‘zgartirish faqat keyingi oylarga ta’sir qiladi. Yozilgan oylar o‘zgarmaydi — xato bo‘lsa, pastdagi ro‘yxatdan “Olib tashlash”.</p>'
    +'<div class="row"><button id="rS" style="flex:1">Saqlash</button>'+(r&&r.active?'<button class="ghost" id="rStop" style="flex:1">To‘xtatish</button>':'')+'</div><div id="rMsg"></div></div>';
  var a=document.getElementById('rA');a.addEventListener('input',function(){var v=digits(a.value);a.value=v?v.toLocaleString('en-US'):''});
  box.scrollIntoView({behavior:'smooth',block:'center'});
  var done=function(x){if(!x.body.ok){document.getElementById('rMsg').innerHTML='<div class="msg bad">'+esc(x.body.error||'Saqlanmadi.')+'</div>';return}DATA.recurring=x.body.recurring;DATA.expenses=x.body.expenses;renderExpense();document.getElementById('xMsg').innerHTML='<div class="msg ok">✓ Oylik xarajat saqlandi</div>'};
  document.getElementById('rS').addEventListener('click',function(){var b=this;b.disabled=true;
    post(location.pathname,{action:'saveRecurring',branchId:sel.value,id:r?r.id:'',name:document.getElementById('rN').value,category:document.getElementById('rC').value,amount:digits(a.value),billingDay:Number(document.getElementById('rD').value),accountId:document.getElementById('rAc').value,includeThisMonth:!r&&document.getElementById('rThis').checked}).then(function(x){b.disabled=false;done(x)})});
  var st=document.getElementById('rStop');if(st)st.addEventListener('click',function(){if(!confirm(r.name+' endi har oy yozilmasin?'))return;st.disabled=true;post(location.pathname,{action:'stopRecurring',branchId:sel.value,id:r.id}).then(done)});
}
function saveExpense(reason){
  var msg=document.getElementById('xMsg'),btn=document.getElementById('xSave');
  var body={action:'expense',branchId:sel.value,operationId:OP,category:EXP.cat,name:document.getElementById('xName').value,amount:digits(document.getElementById('xAmt').value),accountId:document.getElementById('xAcc').value,date:dt.value,note:document.getElementById('xNote').value,duplicateReason:reason||undefined};
  if(!body.category){msg.innerHTML='<div class="msg bad">Xarajat turini tanlang.</div>';return}
  if(!body.name.trim()||!body.amount){msg.innerHTML='<div class="msg bad">Nima uchunligi va summani yozing.</div>';return}
  if(!reason&&!confirm(body.category+' · '+won(body.amount)+' · '+body.date+'. Saqlansinmi?'))return;
  btn.disabled=true;
  post(location.pathname,body).then(function(x){btn.disabled=false;
    if(x.body.ok){DATA.expenses=x.body.expenses;OP=uuid();EXP.cat='';renderExpense();document.getElementById('xMsg').innerHTML='<div class="msg ok">✓ Xarajat saqlandi'+(x.body.alreadySaved?' (oldin saqlangan edi)':'')+'</div>';return}
    if(x.body.code==='DUPLICATE'&&!reason){var why=prompt(x.body.error);if(why&&why.trim().length>=3)saveExpense(why.trim());return}
    msg.innerHTML='<div class="msg bad">'+esc(x.body.error||'Saqlanmadi.')+'</div>'});
}

/* ---------- Yeyilgan / isrof ---------- */
var MEAL={},MEAL_REASON='Xodim ovqati';
/* --- POS apparati hisoboti (Excel/CSV) --- */
var PI={file:null,links:{},preview:null,accounts:[],account:''};
function renderPosImport(){
  var pane=document.getElementById('pane');
  pane.innerHTML='<section class="card"><h2>POS apparati hisoboti</h2><p class="hint">POS’dan kunlik “상품별 매출” hisobotini (Excel yoki CSV) yuklang. Karta va POS orqali naqd savdo shu yo‘l bilan kiradi: ombor kamayadi, soliq va karta komissiyasi avtomatik. Bir kunning yangilangan hisobotini qayta yuklasangiz, faqat o‘zgargan qatorlar yangilanadi.</p>'
    +'<label style="display:flex;align-items:center;justify-content:center;gap:8px;min-height:64px;border:2px dashed var(--accent);border-radius:16px;font-weight:800;cursor:pointer"><span>📂</span><span id="pfn">'+(PI.file?esc(PI.file.name):'Faylni tanlash (.xlsx, .xls, .csv)')+'</span><input type="file" id="pf" accept=".xlsx,.xls,.csv" hidden></label></section><div id="pv"></div>';
  document.getElementById('pf').addEventListener('change',function(){PI.file=this.files[0]||null;PI.links={};PI.preview=null;if(PI.file){document.getElementById('pfn').textContent=PI.file.name;posPreview()}});
  if(PI.preview)posDraw();
}
function posForm(action){var f=new FormData();f.set('file',PI.file);f.set('action',action);f.set('branchId',sel.value);f.set('links',JSON.stringify(PI.links));if(PI.account)f.set('accountId',PI.account);return f}
function posPost(action){return fetch('/api/v2/pos-excel',{method:'POST',body:posForm(action)}).then(function(r){return r.json()}).catch(function(){return {error:'Internet aloqasini tekshiring.'}})}
function posPreview(){var box=document.getElementById('pv');box.innerHTML='<section class="card">'+haloLoading(3)+'</section>';
  posPost('preview').then(function(x){if(x.error){box.innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}
    PI.preview=x.preview;PI.accounts=x.accounts||PI.accounts;if(!PI.account){var c=PI.accounts.find(function(a){return a.type==='card'});PI.account=(c||PI.accounts[0]||{}).id||''}posDraw()})}
function posDraw(){var p=PI.preview,box=document.getElementById('pv');if(!box)return;
  var label={new:'yangi',saved:'oldin saqlangan',changed:'yangilanadi',unmatched:'bog‘lang',duplicate:'takror'},cls={new:'ok',saved:'',changed:'warn',unmatched:'bad',duplicate:'bad'};
  box.innerHTML='<section class="card"><h2>'+esc(p.date)+' · '+won(p.totals.revenue)+'</h2><p class="hint" style="margin:0">'+p.totals.quantity+' ta taom · '+p.products.length+' xil'+(p.counts.saved?' · '+p.counts.saved+' xil oldin saqlangan':'')+(p.counts.changed?' · '+p.counts.changed+' xil yangilanadi':'')+'</p>'
    +(p.errors.length?'<div class="msg bad" style="margin-top:10px">'+p.errors.map(esc).join('<br>')+'</div>':'')
    +(p.manualPos&&p.manualPos.count?'<div class="msg warn" style="margin-top:10px">Bu kunga POS savdosi qo‘lda ham kiritilgan ('+won(p.manualPos.revenue)+'). Excel’ni tasdiqlasangiz ikki marta hisoblanadi — avval Savdo bo‘limidagi qo‘lda kiritilganlarini olib tashlang.</div>':'')+'</section>'
    +'<section class="card"><h2>Taomlar</h2>'+p.products.map(function(x){
      return '<div class="list-row" style="align-items:flex-start"><div style="min-width:0;flex:1"><b>'+esc(x.recipeName||x.product)+'</b><br><small style="color:var(--muted)">'+esc(x.productCode?x.productCode+' · ':'')+esc(x.product)+' · '+x.quantity+' ta · '+won(x.revenue)+'</small>'
        +(x.status==='unmatched'?'<select data-link="'+esc(x.key)+'" style="margin-top:6px;width:100%"><option value="">— menyudagi taomni tanlang —</option>'+p.recipes.map(function(rc){return '<option value="'+esc(rc.id)+'"'+(PI.links[x.key]===rc.id?' selected':'')+'>'+esc(rc.name)+'</option>'}).join('')+'</select>':'')
        +'</div><span class="tag '+cls[x.status]+'">'+label[x.status]+'</span></div>'}).join('')+'</section>'
    +(p.ready?'<section class="card"><label class="field"><span>Pul qayerga tushgan?</span><select id="pa">'+PI.accounts.map(function(a){return '<option value="'+esc(a.id)+'"'+(a.id===PI.account?' selected':'')+'>'+esc(a.name)+'</option>'}).join('')+'</select></label><button class="block" id="ap">✓ Tasdiqlash — '+won(p.totals.newRevenue)+' ('+p.totals.newQuantity+' ta)</button></section>'
      :(p.counts.unmatched?'<div class="msg warn">Belgilangan taomlarni menyudagi taomga bog‘lang — keyingi safar o‘zi taniladi.</div>':(!p.errors.length?'<div class="msg">Bu hisobot oldin to‘liq yuklangan — yangi savdo yo‘q.</div>':'')));
  box.querySelectorAll('[data-link]').forEach(function(s2){s2.addEventListener('change',function(){if(s2.value)PI.links[s2.dataset.link]=s2.value;else delete PI.links[s2.dataset.link];posPreview()})});
  var pa=document.getElementById('pa');if(pa)pa.addEventListener('change',function(){PI.account=pa.value});
  var ap=document.getElementById('ap');if(ap)ap.addEventListener('click',function(){if(!confirm('POS savdosi saqlansinmi? Ombor kamayadi.'))return;ap.disabled=true;
    posPost('apply').then(function(x){ap.disabled=false;if(x.error){alert(x.error);return}PI.preview=x.preview;posDraw();
      box.insertAdjacentHTML('afterbegin','<div class="msg ok">✓ '+x.applied.saved+' qator saqlandi · '+won(x.applied.revenue)+(x.applied.replaced?' · '+x.applied.replaced+' ta yangilandi':'')+'</div>')})});
}
function renderMeal(){
  var pane=document.getElementById('pane'),items=(MENU&&MENU.catalog)||[];
  var reasons=['Xodim ovqati','Isrof / buzildi','Mehmonga tekin','Ta’m ko‘rish / sinov'];
  var ids=Object.keys(MEAL).filter(function(k){return MEAL[k]>0});
  pane.innerHTML='<section class="card"><h2>Pulsiz chiqqan taom</h2><p class="hint">Sotilmagan, lekin ombordan chiqqan taomlar. Retsept bo‘yicha mahsulot ombordan ayiriladi — “kamomad” bo‘lib ko‘rinmaydi.</p>'
    +'<div class="row" style="gap:8px">'+reasons.map(function(r){return '<button class="'+(MEAL_REASON===r?'':'ghost')+'" data-r="'+esc(r)+'" style="min-height:40px;padding:8px 12px">'+esc(r)+'</button>'}).join('')+'</div></section>'
    +'<section class="card"><h2>Taomni tanlang</h2><div class="menu-grid">'+items.map(function(i){var q=MEAL[i.id]||0;return '<button class="dish'+(q?' on':'')+'" data-meal="'+esc(i.id)+'">'+(q?'<span class="q">'+q+'</span>':'')+'<b>'+esc(i.name)+'</b></button>'}).join('')+'</div></section>'
    +'<section class="card sticky-total">'+(ids.length?'<h2>'+esc(MEAL_REASON)+'</h2>'+ids.map(function(k){var it=items.find(function(i){return i.id===k});return '<div class="cart-row"><span>'+esc(it?it.name:k)+'</span><div class="stepper"><button class="ghost" data-mm="'+esc(k)+'">−</button><b>'+MEAL[k]+'</b><button class="ghost" data-mp="'+esc(k)+'">+</button></div></div>'}).join('')+'<button class="block" id="mSave" style="margin-top:10px">Saqlash</button>':'<p class="hint" style="margin:0">Taomni bosing.</p>')+'<div id="mMsg"></div></section>';
  pane.querySelectorAll('[data-r]').forEach(function(b){b.addEventListener('click',function(){MEAL_REASON=b.dataset.r;renderMeal()})});
  pane.querySelectorAll('[data-meal]').forEach(function(b){b.addEventListener('click',function(){MEAL[b.dataset.meal]=(MEAL[b.dataset.meal]||0)+1;renderMeal()})});
  pane.querySelectorAll('[data-mm]').forEach(function(b){b.addEventListener('click',function(){MEAL[b.dataset.mm]=Math.max(0,(MEAL[b.dataset.mm]||0)-1);renderMeal()})});
  pane.querySelectorAll('[data-mp]').forEach(function(b){b.addEventListener('click',function(){MEAL[b.dataset.mp]=(MEAL[b.dataset.mp]||0)+1;renderMeal()})});
  var sv=document.getElementById('mSave');if(sv)sv.addEventListener('click',function(){
    var btn=this,n=ids.reduce(function(s,k){return s+MEAL[k]},0);if(!confirm(MEAL_REASON+': '+n+' ta taom · '+dt.value+'. Saqlansinmi?'))return;btn.disabled=true;
    post('/api/pos-terminal',{operationId:OP.replace(/-/g,''),date:dt.value,mode:'inventory_only',inventoryReason:MEAL_REASON,branchId:sel.value,items:ids.map(function(k){return {recipeId:k,quantity:MEAL[k]}})}).then(function(x){btn.disabled=false;
      if(!x.body.ok){document.getElementById('mMsg').innerHTML='<div class="msg bad">'+esc(x.body.error||'Saqlanmadi.')+'</div>';return}
      MEAL={};OP=uuid();renderMeal();document.getElementById('mMsg').innerHTML='<div class="msg ok">✓ Saqlandi — ombordan ayirildi</div>'});
  });
}
sel.addEventListener('change',load);dt.addEventListener('change',function(){OP=uuid();if(TAB==='sale')renderSale()});load();
`,
  });
}
