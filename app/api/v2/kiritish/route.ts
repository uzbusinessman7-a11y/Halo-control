import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { costRuleCoversCategory } from "../../../lib/daily-report";
import { isAccountingMonthClosed } from "../../../lib/month-end";
import { expenseOnlyOnDate } from "../../../lib/vegetable-expenses";
import { DELIVERY_PLATFORMS } from "../../../lib/delivery-sales";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — kiritish oynasi: savdo (naqd, hisob-raqam, delivery), ombor kirimi, sabzavot va sous.
 * O'zi hech narsa yozmaydi: eski tizimning tekshirilgan API'lari (/api/pos-terminal, /api/intake)
 * orqali saqlaydi — takror yozuv, yopilgan oy va boshqa himoyalar o'sha yerda ishlaydi.
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

/** Ombor mahsulotlari ro'yxati (kirim oynasi uchun). */
function inventoryChoices(state: Row, today: string) {
  const items = Array.isArray(state.inventory) ? state.inventory as Row[] : [];
  return items
    .filter((item) => typeof item.id === "string" && item.id && item.catalogArchived !== true)
    .map((item) => ({
      id: String(item.id), name: String(item.name || item.id), unit: String(item.unit || "dona"),
      packageName: String(item.packageName || ""), unitsPerPackage: Number(item.unitsPerPackage) || 0,
      unitCost: Number(item.unitCost) || 0, vegetable: expenseOnlyOnDate(item as never, today),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

const EXPENSE_CATEGORIES = [
  // Eski tizim ro'yxati bilan bir xil (hisobotlar mos bo'lishi uchun). Karta/delivery komissiyasi avtomatik,
  // mahsulot xaridi esa yetkazib beruvchi orqali kiritiladi — shu sabab bu yerda yo'q.
  "Ijara", "Elektr / gaz / suv", "Wi-Fi / telefon", "POS abonent to‘lovi", "Reklama", "Ta’mirlash", "Soliq", "Sug‘urta",
  "Do‘kon / omborsiz mahsulot", "Boshqa",
];
class EntryError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "") { super(message); }
}
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

function moneyAccounts(state: Row) {
  return (Array.isArray(state.accounts) ? state.accounts as Row[] : [])
    .filter((account) => (account.type === "cash" || account.type === "bank") && account.active !== false)
    .map((account) => ({ id: String(account.id), name: String(account.name || account.id), type: String(account.type) }));
}

function monthExpenses(state: Row, today: string) {
  const month = today.slice(0, 7);
  const accounts = new Map(moneyAccounts(state).map((account) => [account.id, account.name]));
  return (Array.isArray(state.financialEntries) ? state.financialEntries as Row[] : [])
    .filter((entry) => entry.type === "expense" && String(entry.date || "").startsWith(month) && !entry.voided && !entry.cancelledAt && !entry.reversalOf)
    .map((entry) => ({ id: String(entry.id), date: String(entry.date), category: String(entry.category || "Boshqa"), amount: Number(entry.amount) || 0, note: String(entry.note || ""), account: accounts.get(String(entry.accountId)) || "", recurring: Boolean(entry.recurringExpenseId) }))
    .sort((left, right) => right.date.localeCompare(left.date));
}

/** Xarajat yozuvi (eski tizim formatida, serverda tekshirib). Takroriy so'rov ikkinchi marta yozilmaydi. */
function addExpense(state: Row, body: Row, today: string) {
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
  if (costRuleCoversCategory(category, state.costRules as never)) throw new EntryError("Bu xarajat avtomatik hisoblanadi — qayta kiritmang.");
  const reason = clean(body.duplicateReason, 200);
  const twin = entries.find((entry) => entry.type === "expense" && entry.date === date && Number(entry.amount) === amount && entry.category === category && !entry.voided && !entry.cancelledAt);
  if (twin && reason.length < 3) throw new EntryError("Shu kuni aynan shu turdagi va shu summadagi xarajat bor. Bu boshqa xarajat bo‘lsa, sababini yozing.", 409, "DUPLICATE");
  const entry = {
    id, type: "expense", category, amount, date, accountId,
    note: [name, note].filter(Boolean).join(" · "), affectsProfit: true,
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
    if (body.action === "expense") {
      const mutation = await mutateHaloState((state) => addExpense(state, body, today), 5, branchId, "Rahbar",
        `Xarajat: ${clean(body.name, 60)} · ₩${Number(body.amount || 0).toLocaleString("en-US")}`, "Kiritish (yangi)");
      return json({ ok: true, today, ...mutation.result, expenses: monthExpenses(mutation.state, today) });
    }
    const { state } = await readHaloState(branchId);
    return json({
      ok: true, today, inventory: inventoryChoices(state as Row, today), platforms: DELIVERY_PLATFORMS,
      accounts: moneyAccounts(state as Row), categories: EXPENSE_CATEGORIES, expenses: monthExpenses(state as Row, today),
    });
  } catch (error) {
    if (error instanceof EntryError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Kiritish", active: "kiritish", heading: "Kiritish",
    subtitle: "Savdo, xarajat, ombor kirimi, sabzavot va sous, yeyilgan ovqat",
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
.line{display:grid;grid-template-columns:1fr;gap:8px;padding:12px 0;border-top:1px solid var(--line)}
.line .row>*{flex:1 1 110px}
.sticky-total{position:sticky;bottom:calc(76px + env(safe-area-inset-bottom));z-index:3}
@media (min-width:900px){.sticky-total{bottom:12px}}
#pane{padding-bottom:110px}
</style>`,
    script: `
var BRANCHES=${boot},TAB='sale',DATA=null,MENU=null,CART={},PAY='cash',LINES=[],OP='',VEG=false;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)})}
function digits(v){return Number(String(v||'').replace(/[^0-9]/g,''))||0}
function dec(v){var n=Number(String(v||'').replace(',','.').replace(/[^0-9.]/g,''));return isFinite(n)?n:0}
function post(url,body){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
var sel=document.getElementById('branch'),dt=document.getElementById('date');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var TABS={sale:'🧾 Savdo',expense:'💸 Xarajat',stock:'📦 Ombor kirimi',veg:'🥬 Sabzavot va sous',meal:'🍽 Yeyilgan / isrof'};
function tabs(){document.getElementById('tabs').innerHTML=Object.keys(TABS).map(function(k){return '<button class="'+(k===TAB?'':'ghost')+'" data-t="'+k+'">'+TABS[k]+'</button>'}).join('');
  document.querySelectorAll('[data-t]').forEach(function(b){b.addEventListener('click',function(){TAB=b.dataset.t;OP=uuid();render()})})}
function load(){
  document.getElementById('pane').innerHTML='<section class="card">'+haloLoading(4)+'</section>';
  Promise.all([post(location.pathname,{branchId:sel.value}),fetch('/api/pos-terminal?branch='+encodeURIComponent(sel.value)).then(function(r){return r.json()}).catch(function(){return {error:'Menyu ochilmadi.'}})]).then(function(res){
    if(!res[0].body.ok){document.getElementById('pane').innerHTML='<div class="msg bad">'+esc(res[0].body.error)+'</div>';return}
    DATA=res[0].body;MENU=res[1];if(!dt.value){dt.value=DATA.today}dt.max=DATA.today;CART={};LINES=[];OP=uuid();render();
  });
}
function render(){tabs();if(TAB==='sale')renderSale();else if(TAB==='expense')renderExpense();else if(TAB==='meal')renderMeal();else renderLines(TAB==='veg')}

/* ---------- Savdo ---------- */
function price(item){if(PAY==='delivery'){var pl=document.getElementById('plat');var p=pl?pl.value:(DATA.platforms[0]||{}).id;return Number((item.deliveryPrices||{})[p]||0)}return Number(item.salePrice||0)}
function renderSale(){
  var pane=document.getElementById('pane');
  if(MENU&&MENU.error){pane.innerHTML='<div class="msg bad">'+esc(MENU.error)+'</div>';return}
  var cats=(MENU.productCategories||[]).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
  var items=MENU.catalog||[];
  var groups=cats.map(function(c){return {name:c.name,items:items.filter(function(i){return i.categoryId===c.id})}}).filter(function(g){return g.items.length});
  var rest=items.filter(function(i){return !cats.some(function(c){return c.id===i.categoryId})});if(rest.length)groups.push({name:groups.length?'Boshqa':'Menyu',items:rest});
  pane.innerHTML='<section class="card"><h2>To‘lov turi</h2><div class="pay">'
    +[['cash','💵 Naqd'],['bank','🏦 Hisob-raqam'],['delivery','🛵 Delivery']].map(function(p){return '<button class="'+(PAY===p[0]?'':'ghost')+'" data-pay="'+p[0]+'">'+p[1]+'</button>'}).join('')+'</div>'
    +(PAY==='delivery'?'<div class="row" style="margin-top:12px"><select id="plat" style="flex:1">'+DATA.platforms.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>'}).join('')+'</select><input id="ordNo" maxlength="64" placeholder="Buyurtma raqami (ixtiyoriy)" style="flex:1"></div><p class="hint" style="margin:8px 0 0">Delivery narxi va platforma ushlanmalari avtomatik hisoblanadi.</p>':'')
    +'</section>'
    +groups.map(function(g){return '<section class="card"><h2>'+esc(g.name)+'</h2><div class="menu-grid">'+g.items.map(function(i){var q=CART[i.id]||0,p=price(i);
      return '<button class="dish'+(q?' on':'')+'" data-add="'+esc(i.id)+'"'+(p?'':' style="opacity:.45"')+'>'+(q?'<span class="q">'+q+'</span>':'')+'<b>'+esc(i.name)+'</b><small>'+(p?won(p):'narx yo‘q')+'</small></button>'}).join('')+'</div></section>'}).join('')
    +'<section class="card sticky-total" id="cart"></section>'
    +'<section class="card"><h2>Bugungi savdolar</h2><div id="recent"></div></section>';
  document.querySelectorAll('[data-pay]').forEach(function(b){b.addEventListener('click',function(){PAY=b.dataset.pay;OP=uuid();renderSale()})});
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
    +'<div class="row" style="justify-content:space-between;margin-top:10px"><span class="big">'+won(total)+'</span><button id="saveSale">Saqlash</button></div><div id="sMsg"></div>';
  box.querySelectorAll('[data-m]').forEach(function(b){b.addEventListener('click',function(){CART[b.dataset.m]=Math.max(0,(CART[b.dataset.m]||0)-1);syncDishes();drawCart()})});
  box.querySelectorAll('[data-p]').forEach(function(b){b.addEventListener('click',function(){CART[b.dataset.p]=(CART[b.dataset.p]||0)+1;syncDishes();drawCart()})});
  document.getElementById('saveSale').addEventListener('click',function(){saveSale(total)});
}
function syncDishes(){var items=MENU.catalog||[];document.querySelectorAll('[data-add]').forEach(function(el){renderDish(el,items.find(function(i){return i.id===el.dataset.add}))})}
function saveSale(total){
  var btn=document.getElementById('saveSale'),msg=document.getElementById('sMsg');
  var label={cash:'Naqd',bank:'Hisob-raqam',delivery:'Delivery'}[PAY];
  if(!confirm(label+' savdo: '+won(total)+' · '+dt.value+'. Saqlansinmi?'))return;
  var body={operationId:OP.replace(/-/g,''),date:dt.value,mode:'sale',paymentType:PAY,branchId:sel.value,items:Object.keys(CART).filter(function(k){return CART[k]>0}).map(function(k){return {recipeId:k,quantity:CART[k]}})};
  if(PAY==='delivery'){body.deliveryPlatform=document.getElementById('plat').value;body.deliveryOrderNumber=document.getElementById('ordNo').value.trim()}
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
  var L={cash:'Naqd',bank:'Hisob-raqam',card:'Karta',delivery:'Delivery'};
  box.innerHTML=list.length?list.map(function(o){return '<div class="list-row"><div><b>'+esc(L[o.paymentType]||o.paymentType||'Savdo')+(o.deliveryPlatform?' · '+esc(o.deliveryPlatform):'')+'</b><br><small style="color:var(--muted)">'+(o.items||[]).map(function(i){return esc(i.name||'')+' ×'+i.quantity}).join(', ')+'</small></div><b>'+won(o.total)+'</b></div>'}).join('')
    +'<p class="hint" style="margin-top:10px">Jami: '+won(list.reduce(function(s,o){return s+Number(o.total||0)},0))+' · Xato bo‘lsa, <a href="/?eski=1">eski oynada</a> tahrirlanadi.</p>':'<p class="hint">Bu sanada kiritilgan savdo yo‘q.</p>';
}

/* ---------- Ombor kirimi / sabzavot ---------- */
function units(item,veg){var u=[item.unit];if(item.unit==='g')u.push('kg');if(item.unit==='ml')u.push('litr');if(item.unit==='kg')u.push('g');if(item.unit==='litr')u.push('ml');if(item.packageName&&item.unitsPerPackage>1)u.push(item.packageName);else if(veg)u.push('qadoq');if(veg&&u.indexOf('dona')<0)u.push('dona');return u.filter(function(x,i,a){return x&&a.indexOf(x)===i})}
function renderLines(veg){
  if(VEG!==veg){LINES=[];VEG=veg}
  if(!LINES.length)LINES=[{id:'',q:'',u:'',a:''}];
  var pool=DATA.inventory.filter(function(i){return veg?i.vegetable:!i.vegetable});
  var pane=document.getElementById('pane');
  pane.innerHTML='<section class="card"><h2>'+(veg?'Sabzavot va sous xaridi':'Omborga mahsulot kiritish')+'</h2><p class="hint">'+(veg?'Pomidor, karam, sous kabi — tortilmaydigan, xarajat sifatida hisoblanadigan mahsulotlar. Qancha olganingiz va qancha to‘laganingizni yozing.':'Nima keldi, qancha va jami necha pulga. Qarz yoki to‘lov alohida — Qarz bo‘limida.')+'</p>'
    +(pool.length?'':'<div class="msg warn">'+(veg?'Sabzavot va sous deb belgilangan mahsulot yo‘q. Eski oynada “Sabzavot va sous” bo‘limida belgilang.':'Ombor mahsuloti yo‘q.')+'</div>')
    +LINES.map(function(l,idx){var it=pool.find(function(i){return i.id===l.id});var us=it?units(it,veg):[];
      return '<div class="line"><select data-i="'+idx+'" data-f="id"><option value="">— mahsulot tanlang —</option>'+pool.map(function(i){return '<option value="'+esc(i.id)+'"'+(i.id===l.id?' selected':'')+'>'+esc(i.name)+'</option>'}).join('')+'</select>'
        +'<div class="row"><input data-i="'+idx+'" data-f="q" inputmode="decimal" placeholder="Miqdor" value="'+esc(l.q)+'"><select data-i="'+idx+'" data-f="u">'+us.map(function(u){return '<option'+(u===l.u?' selected':'')+'>'+esc(u)+'</option>'}).join('')+'</select><input data-i="'+idx+'" data-f="a" inputmode="numeric" placeholder="Jami narx ₩" value="'+esc(l.a)+'"></div>'
        +(it&&it.unitCost&&!veg?'<small style="color:var(--muted)">Oxirgi narx: '+won(Math.round(it.unitCost*(it.unit==='g'||it.unit==='ml'?1000:1)))+' / '+(it.unit==='g'?'kg':it.unit==='ml'?'litr':esc(it.unit))+'</small>':'')
        +(LINES.length>1?'<button class="ghost" data-del="'+idx+'" style="justify-self:start;min-height:34px;padding:4px 10px">Olib tashlash</button>':'')+'</div>'}).join('')
    +'<div class="row" style="margin-top:10px"><button class="ghost" id="addLine">+ Yana mahsulot</button></div></section>'
    +'<section class="card sticky-total"><div class="row" style="justify-content:space-between"><span class="big" id="lTotal">0 ₩</span><button id="saveLines">Saqlash</button></div><div id="lMsg"></div></section>';
  pane.querySelectorAll('[data-f]').forEach(function(el){el.addEventListener(el.tagName==='SELECT'?'change':'input',function(){var l=LINES[Number(el.dataset.i)],f=el.dataset.f;
    if(f==='a'){var d=digits(el.value);el.value=d?d.toLocaleString('en-US'):''}
    l[f]=el.value;if(f==='id'){var it=pool.find(function(i){return i.id===l.id});l.u=it?units(it,veg)[it.unit==='g'?1:0]||it.unit:'';renderLines(veg);return}lTotal()})});
  pane.querySelectorAll('[data-del]').forEach(function(b){b.addEventListener('click',function(){LINES.splice(Number(b.dataset.del),1);renderLines(veg)})});
  document.getElementById('addLine').addEventListener('click',function(){LINES.push({id:'',q:'',u:'',a:''});renderLines(veg)});
  document.getElementById('saveLines').addEventListener('click',function(){saveLines(veg)});
  lTotal();
}
function lTotal(){var t=LINES.reduce(function(s,l){return s+digits(l.a)},0);var el=document.getElementById('lTotal');if(el)el.textContent=won(t)}
function saveLines(veg,reason){
  var msg=document.getElementById('lMsg'),btn=document.getElementById('saveLines');
  var lines=LINES.filter(function(l){return l.id});
  if(!lines.length){msg.innerHTML='<div class="msg bad">Mahsulot tanlang.</div>';return}
  if(lines.some(function(l){return !(dec(l.q)>0)||!(digits(l.a)>0)})){msg.innerHTML='<div class="msg bad">Har bir qatorda miqdor va jami narxni yozing.</div>';return}
  var total=lines.reduce(function(s,l){return s+digits(l.a)},0);
  if(!reason&&!confirm(lines.length+' ta mahsulot · jami '+won(total)+' · '+dt.value+'. Saqlansinmi?'))return;
  btn.disabled=true;
  post('/api/intake?branch='+encodeURIComponent(sel.value),{inventoryOnly:true,vegetableOnly:veg,operationId:OP,date:dt.value,duplicateReason:reason||undefined,lines:lines.map(function(l){return {inventoryId:l.id,quantity:dec(l.q),unit:l.u,amount:digits(l.a)}})}).then(function(x){btn.disabled=false;
    if(x.body.ok){LINES=[];OP=uuid();renderLines(veg);document.getElementById('lMsg').innerHTML='<div class="msg ok">✓ Saqlandi'+(x.body.alreadySaved?' (oldin saqlangan edi)':'')+' · '+won(total)+'</div>';return}
    if(x.body.code==='SIMILAR_PURCHASE'&&!reason){var why=prompt((x.body.error||'Shunga o‘xshash kirim bor.')+' Bu alohida xarid bo‘lsa, sababini yozing (kamida 5 harf):');if(why&&why.trim().length>=5)saveLines(veg,why.trim());return}
    msg.innerHTML='<div class="msg bad">'+esc(x.body.error||'Saqlanmadi.')+'</div>';
  });
}

/* ---------- Xarajat ---------- */
var EXP={cat:'',acc:''};
function renderExpense(){
  var pane=document.getElementById('pane'),d=DATA;
  if(!EXP.acc&&d.accounts.length)EXP.acc=d.accounts[0].id;
  var byCat={};d.expenses.forEach(function(e){byCat[e.category]=(byCat[e.category]||0)+e.amount});
  var total=d.expenses.reduce(function(s,e){return s+e.amount},0);
  pane.innerHTML='<section class="card"><h2>Xarajat kiritish</h2>'
    +'<p class="hint">Ijara, svet, gaz, reklama, ta’mir… Mahsulot xaridi bu yerda emas — u “Ombor kirimi” va “Qarz” orqali.</p>'
    +'<div class="row" style="gap:8px;margin-bottom:12px">'+d.categories.map(function(c){return '<button class="'+(EXP.cat===c?'':'ghost')+'" data-cat="'+esc(c)+'" style="min-height:40px;padding:8px 12px">'+esc(c)+'</button>'}).join('')+'</div>'
    +'<label class="field"><span>Nima uchun</span><input id="xName" maxlength="140" placeholder="Masalan: oktabr ijarasi"></label>'
    +'<label class="field"><span>Summa</span><input class="money" id="xAmt" inputmode="numeric" placeholder="0"></label>'
    +'<label class="field"><span>Qaysi hisobdan to‘landi</span><select id="xAcc">'+d.accounts.map(function(a){return '<option value="'+esc(a.id)+'"'+(a.id===EXP.acc?' selected':'')+'>'+esc(a.name)+'</option>'}).join('')+'</select></label>'
    +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="xNote" maxlength="300"></label>'
    +'<button class="block" id="xSave">Saqlash</button><div id="xMsg"></div></section>'
    +'<section class="card"><h2>Shu oy xarajatlari · '+won(total)+'</h2>'
    +(Object.keys(byCat).length?'<div class="grid" style="margin-bottom:12px">'+Object.keys(byCat).sort(function(a,b){return byCat[b]-byCat[a]}).map(function(c){return '<div class="kpi"><small>'+esc(c)+'</small><b>'+won(byCat[c])+'</b></div>'}).join('')+'</div>':'')
    +(d.expenses.length?d.expenses.slice(0,60).map(function(e){return '<div class="list-row"><div><b>'+esc(e.category)+'</b>'+(e.recurring?' <span class="tag warn">avtomatik</span>':'')+'<br><small style="color:var(--muted)">'+esc(e.date)+(e.account?' · '+esc(e.account):'')+(e.note?' · '+esc(e.note):'')+'</small></div><b>'+won(e.amount)+'</b></div>'}).join(''):'<p class="hint">Bu oyda xarajat yo‘q.</p>')+'</section>';
  pane.querySelectorAll('[data-cat]').forEach(function(b){b.addEventListener('click',function(){EXP.cat=b.dataset.cat;var keep={n:document.getElementById('xName').value,a:document.getElementById('xAmt').value,o:document.getElementById('xNote').value};renderExpense();document.getElementById('xName').value=keep.n;document.getElementById('xAmt').value=keep.a;document.getElementById('xNote').value=keep.o})});
  var amt=document.getElementById('xAmt');amt.addEventListener('input',function(){var v=digits(amt.value);amt.value=v?v.toLocaleString('en-US'):''});
  document.getElementById('xAcc').addEventListener('change',function(){EXP.acc=this.value});
  document.getElementById('xSave').addEventListener('click',function(){saveExpense()});
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
sel.addEventListener('change',load);dt.addEventListener('change',function(){OP=uuid();if(TAB==='sale')drawRecent()});load();
`,
  });
}
