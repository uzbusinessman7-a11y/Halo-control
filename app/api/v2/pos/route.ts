import { isAdminRequest } from "../../../lib/integration-store";
import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { applyPosOrder, buildPosTerminalView, cancelPosOrder, PosTerminalError, type PosOrderInput } from "../../../lib/pos-terminal";
import { applyWorkerConsumption, compatibleInventoryInputUnits, deleteWorkerConsumption, inventoryQuantityFromInput, WorkerConsumptionError } from "../../../lib/worker-consumptions";
import { DELIVERY_PLATFORMS } from "../../../lib/delivery-sales";
import { seoulBusinessDate } from "../../../lib/business-time";
import { readDeductionRules } from "../../../core/deductions";
import { posDayReport } from "../../../core/pos-report";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — do'kon kassasi oynasi (alohida havola: /pos).
 *  - POS apparati savdosi: karta yoki naqd (soliq avtomatik; karta — komissiya ham);
 *  - Delivery: har platforma o'z narxi bilan, ushlanma va soliq avtomatik;
 *  - Oshxonada yeyilgan ovqat va chiqit (isrof / buzilgan) — alohida hisob;
 *  - Bugungi hisobot. Xodim faqat o'z filialida va bugun uchun yozadi; bekor qilish — faqat rahbar.
 * Hamma yozuv mavjud, sinovdan o'tgan eski hisob funksiyalari orqali (ombor, tannarx, snapshot).
 */
const PAGE_PATH = "/api/v2/pos";
const POS_ACTOR_ID = "pos-terminal";
const WASTE_REASONS = ["Isrof / buzilgan", "Muddati o‘tgan", "Tushib ketdi / to‘kildi", "Boshqa"];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Row = Record<string, unknown>;
class PosPageError extends Error { constructor(message: string, public status = 400) { super(message); } }

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

async function who(request: Request) {
  if (await isAdminRequest(request)) return { owner: true as const, name: "Rahbar", branchId: "" };
  const worker = await authenticateWorkerRequest(request);
  if (worker) return { owner: false as const, name: String(worker.name || "Xodim"), branchId: String(worker.branchId) };
  return null;
}

export async function GET() {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  return new Response(page(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function inventoryChoices(state: Row) {
  return (Array.isArray(state.inventory) ? state.inventory as Row[] : [])
    .filter((item) => item && item.id && item.name && item.catalogArchived !== true)
    .map((item) => ({ id: String(item.id), name: String(item.name), unit: String(item.unit || "birlik"), units: compatibleInventoryInputUnits(String(item.unit || "")) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function view(state: Row, date: string, owner: boolean) {
  const terminal = buildPosTerminalView(state);
  const report = posDayReport(state, date);
  return {
    catalog: terminal.catalog,
    categories: terminal.productCategories,
    inventory: inventoryChoices(state),
    rules: readDeductionRules(state),
    report: owner ? report : { date: report.date, entries: report.entries.filter((entry) => entry.kind !== "sale" || entry.channel !== "halo").map((entry) => ({ ...entry, cost: undefined })) },
  };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  try {
    const user = await who(request);
    if (!user) return json({ error: "Avval kiring.", login: true }, 401);
    const body = await request.json() as Row;
    const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
    const allowed = user.owner ? branches : branches.filter((branch) => branch.id === user.branchId);
    const branchId = user.owner ? clean(body.branchId, 80) || allowed[0]?.id || "main" : user.branchId;
    if (!allowed.some((branch) => branch.id === branchId)) throw new PosPageError("Filial topilmadi.", 404);
    const today = seoulBusinessDate(new Date());
    const date = clean(body.date, 10) || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new PosPageError("Sanani tekshiring.");
    if (!user.owner && date !== today) throw new PosPageError("Xodim faqat bugungi kunga yozadi.", 403);
    const actor = { id: POS_ACTOR_ID, name: user.name };
    const action = String(body.action || "load");
    const createdAt = new Date().toISOString();
    let saved: unknown = null;

    if (action === "sale") {
      const paymentType = String(body.paymentType || "");
      if (!["card", "cash", "delivery"].includes(paymentType)) throw new PosPageError("To‘lov turini tanlang.");
      const input: PosOrderInput = {
        operationId: clean(body.operationId, 100), date, mode: "sale", paymentType: paymentType as PosOrderInput["paymentType"],
        salesChannel: paymentType === "delivery" ? undefined : "pos",
        deliveryPlatform: paymentType === "delivery" ? body.deliveryPlatform as PosOrderInput["deliveryPlatform"] : undefined,
        deliveryOrderNumber: paymentType === "delivery" ? clean(body.deliveryOrderNumber, 64) : undefined,
        expectedTotal: body.expectedTotal === undefined ? undefined : Number(body.expectedTotal),
        items: Array.isArray(body.items) ? body.items as PosOrderInput["items"] : [],
        note: clean(body.note, 240),
      };
      const label = paymentType === "delivery" ? `Delivery · ${String(body.deliveryPlatform)}` : paymentType === "card" ? "POS karta" : "POS naqd";
      // Savdo POS apparatida allaqachon bo'lgan: ombor yetmasa ham yoziladi (kamomad alohida qayd etiladi).
      const mutation = await mutateHaloState((state) => applyPosOrder(state as Row, input, actor, createdAt, { ownerEntry: true }), 5, branchId, user.name,
        `${label} savdo`, "POS oynasi (yangi)");
      saved = { kind: "sale", alreadySaved: mutation.result.alreadySaved, orderNumber: (mutation.result.order as Row | undefined)?.orderNumber };
    } else if (action === "meal" || (action === "waste" && body.mode === "dish")) {
      const kitchen = action === "meal";
      const input: PosOrderInput = {
        operationId: clean(body.operationId, 100), date, mode: "inventory_only",
        inventoryReason: kitchen ? "Oshxonada yeyilgan ovqat" : "Isrof / buzilgan",
        items: Array.isArray(body.items) ? body.items as PosOrderInput["items"] : [], note: clean(body.note, 240),
      };
      const mutation = await mutateHaloState((state) => applyPosOrder(state as Row, input, actor, createdAt), 5, branchId, user.name,
        kitchen ? "Oshxonada yeyilgan ovqat" : "Chiqit: taom", "POS oynasi (yangi)");
      saved = { kind: kitchen ? "meal" : "waste", alreadySaved: mutation.result.alreadySaved };
    } else if (action === "waste") {
      const reason = WASTE_REASONS.includes(String(body.reason)) ? String(body.reason) : WASTE_REASONS[0];
      const mutation = await mutateHaloState((state) => {
        const item = (Array.isArray((state as Row).inventory) ? (state as Row).inventory as Row[] : []).find((entry) => entry.id === body.inventoryId);
        if (!item) throw new PosPageError("Mahsulotni tanlang.");
        const quantity = inventoryQuantityFromInput(Number(body.quantity), clean(body.unit, 20), String(item.unit || ""));
        if (!(quantity > 0)) throw new PosPageError("Miqdorni to‘g‘ri yozing.");
        return applyWorkerConsumption(state as Row, {
          operationId: clean(body.operationId, 100), kind: "waste", inventoryId: String(item.id), quantity, date,
          reason, note: clean(body.note, 240),
        }, actor, createdAt);
      }, 5, branchId, user.name, "Chiqit: mahsulot", "POS oynasi (yangi)");
      saved = { kind: "waste", alreadySaved: mutation.result.alreadySaved };
    } else if (action === "cancel") {
      if (!user.owner) throw new PosPageError("Bekor qilishni faqat rahbar qiladi.", 403);
      const id = clean(body.id, 160);
      await mutateHaloState((state) => {
        if (id.startsWith("pos-order:")) {
          const removed = cancelPosOrder(state as Row, id);
          return { state: removed.state, result: null };
        }
        const removed = deleteWorkerConsumption(state as Row, id, actor);
        return { state: removed.state, result: null };
      }, 5, branchId, user.name, "POS oynasi: yozuv bekor qilindi", "POS oynasi (yangi)");
      saved = { kind: "cancel" };
    } else if (action !== "load") {
      throw new PosPageError("Amal noto‘g‘ri.");
    }

    const { state } = await readHaloState(branchId);
    return json({
      ok: true, saved, role: user.owner ? "owner" : "worker", name: user.name, today, date, branchId, branches: allowed,
      platforms: DELIVERY_PLATFORMS, wasteReasons: WASTE_REASONS, ...view(state as Row, date, user.owner),
    });
  } catch (error) {
    if (error instanceof PosPageError || error instanceof PosTerminalError || error instanceof WorkerConsumptionError) {
      return json({ error: error.message }, (error as { status?: number }).status || 400);
    }
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial|oy/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(): string {
  return shell({
    title: "Kassa oynasi", active: null,
    body: `<div id="app"><section class="card"><div class="skeleton"></div></section></div>
<style>
#app{min-width:0;max-width:100%;display:grid;gap:14px}#pane{display:grid;gap:14px;min-width:0}
.tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}
.tabs button{min-height:52px;padding:8px 6px;font-size:14px;line-height:1.2}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:8px}.seg3{grid-template-columns:repeat(3,1fr)}
.seg button{min-height:58px;font-size:16px}
.menu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}.menu-grid>*,.kpis>*,.seg>*{min-width:0}
.dish{position:relative;min-height:82px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;text-align:left;padding:12px;background:var(--card-2);color:var(--text);border:1px solid var(--line)}
.dish.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent) inset}.dish b{font-size:15px;line-height:1.25}.dish small{color:var(--muted);font-weight:700}
.dish .q{position:absolute;top:8px;right:8px;background:var(--accent);color:var(--accent-ink);border-radius:99px;min-width:26px;height:26px;display:grid;place-items:center;font-weight:900;font-size:14px}
.dish[disabled]{opacity:.4}
.cart{position:sticky;bottom:10px;z-index:5;border-color:var(--accent)}
.cart-line{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}
.cart-line .qb{display:flex;gap:6px;align-items:center}.cart-line .qb button{min-height:34px;min-width:34px;padding:0}
.tot{display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px}.tot .big{font-size:24px;font-weight:900}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.kpi{background:var(--card-2);border:1px solid var(--line);border-radius:14px;padding:12px}.kpi small{display:block;color:var(--muted);font-weight:700}.kpi b{font-size:19px}.kpi i{display:block;font-style:normal;color:var(--muted);font-size:12px;margin-top:4px}
.entry{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.entry small{color:var(--muted)}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#16a34a;color:#fff;padding:12px 18px;border-radius:14px;font-weight:800;z-index:50;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.toast.bad{background:#dc2626}
.who{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.who>*{min-width:0}
</style>`,
    script: `
var S={tab:'pos',pay:'card',plat:null,cart:{},op:uid(),data:null,wmode:'product'};
var app=document.getElementById('app');
function uid(){return (crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2)).replace(/-/g,'')}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return Math.round(Number(n||0)).toLocaleString('en-US')+' ₩'}
function hm(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}
function post(body){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){j._status=r.status;return j})}).catch(function(){return {error:'Internet aloqasini tekshiring.'}})}
function toast(text,bad){var t=document.createElement('div');t.className='toast'+(bad?' bad':'');t.textContent=text;document.body.appendChild(t);setTimeout(function(){t.remove()},bad?4200:2200)}
var savedBranch='';try{savedBranch=localStorage.getItem('halo-pos-branch')||''}catch(e){}
function load(extra){
  var d=S.data;return post(Object.assign({action:'load',branchId:d?d.branchId:savedBranch,date:d?d.date:''},extra||{})).then(function(x){
    if(x._status===401&&x.login){loginForm();return x}
    if(x.error){toast(x.error,true);return x}
    S.data=x;try{localStorage.setItem('halo-pos-branch',x.branchId)}catch(e){}
    if(!S.plat)S.plat=(x.platforms[0]||{}).id;render();return x});
}
function loginForm(){
  fetch('/api/worker-auth',{credentials:'same-origin'}).then(function(r){return r.json()}).catch(function(){return {}}).then(function(a){var br=a.branches||[];
    app.innerHTML='<section class="card" style="max-width:420px;margin:30px auto"><h1 style="margin:0 0 6px">HALO kassa</h1><p class="hint">Xodim logini va PIN bilan kiring. Rahbar — <a href="/signin-with-chatgpt?return_to=/api/v2/pos">rahbar kirishi</a>.</p>'
      +(br.length>1?'<label class="field"><span>Filial</span><select id="lb">'+br.map(function(b){return '<option value="'+esc(b.id)+'"'+(b.id===savedBranch?' selected':'')+'>'+esc(b.name)+'</option>'}).join('')+'</select></label>':'')
      +'<label class="field"><span>Login</span><input id="lu" autocapitalize="off" autocomplete="username"></label><label class="field"><span>PIN</span><input id="lp" type="password" inputmode="numeric" autocomplete="current-password"></label><button class="block" id="lg">Kirish</button><div id="lm"></div></section>';
    document.getElementById('lg').addEventListener('click',function(){var b=document.getElementById('lb');
      fetch('/api/worker-auth',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'login',branchId:b?b.value:(br[0]||{}).id||'main',username:document.getElementById('lu').value.trim().toLowerCase(),pin:document.getElementById('lp').value})}).then(function(r){return r.json()}).then(function(j){if(j.ok||j.authenticated){S.data=null;load()}else document.getElementById('lm').innerHTML='<div class="msg bad">'+esc(j.error||'Kirilmadi.')+'</div>'})});
  });
}
var TABS=[['pos','🧾 POS savdo'],['delivery','🛵 Delivery'],['meal','🍽 Oshxonada yeyilgan'],['waste','🗑 Chiqit'],['report','📊 Bugun']];
function render(){
  var d=S.data;
  app.innerHTML='<div class="who"><div><b style="font-size:20px">HALO kassa</b><br><small style="color:var(--muted)">'+esc(d.name)+(d.role==='owner'?' · rahbar':'')+'</small></div><div class="row" style="gap:8px">'
    +(d.branches.length>1?'<select id="br">'+d.branches.map(function(b){return '<option value="'+esc(b.id)+'"'+(b.id===d.branchId?' selected':'')+'>'+esc(b.name)+'</option>'}).join('')+'</select>':'<b>'+esc((d.branches[0]||{}).name||'')+'</b>')
    +(d.role==='owner'?'<input type="date" id="dt" value="'+esc(d.date)+'" max="'+esc(d.today)+'">':'')+'</div></div>'
    +(d.date!==d.today?'<div class="msg">'+esc(d.date)+' sanasiga yozilmoqda.</div>':'')
    +'<div class="tabs">'+TABS.map(function(t){return '<button class="'+(S.tab===t[0]?'':'ghost')+'" data-tab="'+t[0]+'">'+t[1]+'</button>'}).join('')+'</div><div id="pane"></div>';
  var br=document.getElementById('br');if(br)br.addEventListener('change',function(){S.cart={};d.branchId=br.value;load()});
  var dt=document.getElementById('dt');if(dt)dt.addEventListener('change',function(){d.date=dt.value;load()});
  app.querySelectorAll('[data-tab]').forEach(function(b){b.addEventListener('click',function(){S.tab=b.dataset.tab;S.cart={};S.op=uid();render()})});
  if(S.tab==='report')renderReport();else if(S.tab==='waste')renderWaste();else renderMenu();
}
function price(item){if(S.tab==='delivery')return Number((item.deliveryPrices||{})[S.plat]||0);if(S.tab==='meal'||S.tab==='waste')return 0;return Number(item.salePrice||0)}
function groups(){var d=S.data,cats=(d.categories||[]).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
  var g=cats.map(function(c){return {name:c.name,items:d.catalog.filter(function(i){return i.categoryId===c.id})}}).filter(function(x){return x.items.length});
  var rest=d.catalog.filter(function(i){return !cats.some(function(c){return c.id===i.categoryId})});if(rest.length)g.push({name:g.length?'Boshqa':'Menyu',items:rest});return g}
function renderMenu(){
  var d=S.data,pane=document.getElementById('pane'),h='';
  if(S.tab==='pos'){h+='<section class="card"><div class="seg"><button class="'+(S.pay==='card'?'':'ghost')+'" data-pay="card">💳 Karta</button><button class="'+(S.pay==='cash'?'':'ghost')+'" data-pay="cash">💵 Naqd (POS orqali)</button></div>'
    +'<p class="hint" style="margin:10px 0 0">Soliq '+d.rules.taxPct+'%'+(S.pay==='card'?' va karta komissiyasi '+d.rules.cardPct+'%':'')+' avtomatik ushlanadi.</p></section>'}
  if(S.tab==='delivery'){var pr=d.rules.platforms.find(function(p){return p.id===S.plat})||{pct:0,feeWon:0};
    h+='<section class="card"><div class="seg seg3">'+d.platforms.map(function(p){return '<button class="'+(S.plat===p.id?'':'ghost')+'" data-plat="'+esc(p.id)+'">'+esc(p.shortLabel||p.label)+'</button>'}).join('')+'</div>'
    +'<label class="field" style="margin-top:12px"><span>Buyurtma raqami (ixtiyoriy)</span><input id="ordNo" maxlength="64" placeholder="masalan, B2K9"></label>'
    +'<p class="hint" style="margin:0">Delivery narxi ishlatiladi. Ushlanma '+pr.pct+'%'+(pr.feeWon?' + '+won(pr.feeWon):'')+' va soliq '+d.rules.taxPct+'% avtomatik.</p></section>'}
  if(S.tab==='meal')h+='<section class="card"><p class="hint" style="margin:0">Xodimlar oshxonada yegan taomni tanlang. Ombordan retsept bo‘yicha ayiriladi va “oshxona ovqati” sifatida alohida hisoblanadi.</p></section>';
  h+=groups().map(function(g){return '<section class="card"><h2>'+esc(g.name)+'</h2><div class="menu-grid">'+g.items.map(function(i){var p=price(i),dis=(S.tab==='pos'||S.tab==='delivery')&&!p,q=S.cart[i.id]||0;
    return '<button class="dish'+(q?' on':'')+'" data-add="'+esc(i.id)+'"'+(dis?' disabled':'')+'>'+(q?'<span class="q">'+q+'</span>':'')+'<b>'+esc(i.name)+'</b><small>'+(S.tab==='meal'||S.tab==='waste'?'porsiya':(p?won(p):'narx yo‘q'))+'</small></button>'}).join('')+'</div></section>'}).join('')||'<section class="card"><p class="hint">Menyu bo‘sh. Rahbar Menyu bo‘limida taom qo‘shadi.</p></section>';
  h+='<section class="card cart" id="cart"></section>';
  pane.innerHTML=h;
  pane.querySelectorAll('[data-pay]').forEach(function(b){b.addEventListener('click',function(){S.pay=b.dataset.pay;S.op=uid();renderMenu()})});
  pane.querySelectorAll('[data-plat]').forEach(function(b){b.addEventListener('click',function(){S.plat=b.dataset.plat;S.cart={};S.op=uid();renderMenu()})});
  pane.querySelectorAll('[data-add]').forEach(function(b){b.addEventListener('click',function(){S.cart[b.dataset.add]=(S.cart[b.dataset.add]||0)+1;paintDish(b);drawCart()})});
  drawCart();
}
function paintDish(el){var q=S.cart[el.dataset.add]||0;el.classList.toggle('on',q>0);var s=el.querySelector('.q');if(q){if(!s){s=document.createElement('span');s.className='q';el.prepend(s)}s.textContent=q}else if(s)s.remove()}
function cartItems(){var d=S.data;return Object.keys(S.cart).filter(function(k){return S.cart[k]>0}).map(function(k){var it=d.catalog.find(function(i){return i.id===k})||{name:'?'};return {id:k,name:it.name,q:S.cart[k],p:price(it)}})}
function drawCart(){
  var box=document.getElementById('cart');if(!box)return;var items=cartItems(),d=S.data;
  if(!items.length){box.innerHTML='<p class="hint" style="margin:0">Taomni bosing — savatga qo‘shiladi.</p>';return}
  var total=items.reduce(function(s,i){return s+i.p*i.q},0),info='';
  if(S.tab==='pos'){var tax=Math.round(total*d.rules.taxPct/100),com=S.pay==='card'?Math.round(total*d.rules.cardPct/100):0;info='soliq '+won(tax)+(com?' · komissiya '+won(com):'')+' · sof '+won(total-tax-com)}
  if(S.tab==='delivery'){var pr=d.rules.platforms.find(function(p){return p.id===S.plat})||{pct:0,feeWon:0};var fee=Math.min(total,Math.round(total*pr.pct/100)+pr.feeWon),tx=Math.round(total*d.rules.taxPct/100);info='ushlanma '+won(fee)+' · soliq '+won(tx)+' · sof '+won(total-fee-tx)}
  var label=S.tab==='pos'?(S.pay==='card'?'💳 Karta savdosini saqlash':'💵 Naqd savdoni saqlash'):S.tab==='delivery'?'🛵 Delivery saqlash':S.tab==='meal'?'🍽 Yeyilgan deb saqlash':'🗑 Chiqit deb saqlash';
  box.innerHTML=items.map(function(i){return '<div class="cart-line"><span><b>'+esc(i.name)+'</b>'+(i.p?'<br><small style="color:var(--muted)">'+won(i.p)+' × '+i.q+'</small>':'')+'</span><span class="qb"><button class="ghost" data-dec="'+esc(i.id)+'">−</button><b>'+i.q+'</b><button class="ghost" data-inc="'+esc(i.id)+'">+</button></span></div>'}).join('')
    +'<div class="tot"><div>'+(total?'<span class="big">'+won(total)+'</span><br>':'<b>'+items.reduce(function(s,i){return s+i.q},0)+' porsiya</b><br>')+'<small style="color:var(--muted)">'+info+'</small></div></div>'
    +'<div class="row" style="margin-top:10px"><button class="ghost" id="clr">Tozalash</button><button id="save" style="flex:1">'+label+'</button></div>';
  box.querySelectorAll('[data-inc]').forEach(function(b){b.addEventListener('click',function(){S.cart[b.dataset.inc]++;refreshDish(b.dataset.inc);drawCart()})});
  box.querySelectorAll('[data-dec]').forEach(function(b){b.addEventListener('click',function(){S.cart[b.dataset.dec]--;if(S.cart[b.dataset.dec]<=0)delete S.cart[b.dataset.dec];refreshDish(b.dataset.dec);drawCart()})});
  document.getElementById('clr').addEventListener('click',function(){S.cart={};S.op=uid();renderMenu()});
  document.getElementById('save').addEventListener('click',function(){saveCart(total)});
}
function refreshDish(id){var el=document.querySelector('[data-add="'+id+'"]');if(el)paintDish(el)}
function saveCart(total){
  var btn=document.getElementById('save');btn.disabled=true;var items=cartItems().map(function(i){return {recipeId:i.id,quantity:i.q}});
  var body={branchId:S.data.branchId,date:S.data.date,operationId:S.op,items:items};
  if(S.tab==='pos'){body.action='sale';body.paymentType=S.pay}
  else if(S.tab==='delivery'){body.action='sale';body.paymentType='delivery';body.deliveryPlatform=S.plat;body.expectedTotal=total;var o=document.getElementById('ordNo');body.deliveryOrderNumber=o?o.value.trim():''}
  else if(S.tab==='meal')body.action='meal';
  else {body.action='waste';body.mode='dish'}
  post(body).then(function(x){btn.disabled=false;
    if(x.error){toast(x.error,true);return}
    S.data=x;S.cart={};S.op=uid();toast(x.saved&&x.saved.alreadySaved?'Oldin saqlangan — takror yozilmadi':'✓ Saqlandi'+(x.saved&&x.saved.orderNumber?' · #'+x.saved.orderNumber:''));render()});
}
function renderWaste(){
  var d=S.data,pane=document.getElementById('pane');
  pane.innerHTML='<section class="card"><div class="seg"><button class="'+(S.wmode==='product'?'':'ghost')+'" data-wm="product">🥩 Mahsulot</button><button class="'+(S.wmode==='dish'?'':'ghost')+'" data-wm="dish">🍔 Tayyor taom</button></div><p class="hint" style="margin:10px 0 0">Buzilgan, muddati o‘tgan yoki tashlab yuborilgan narsa. Ombordan ayiriladi va “chiqit” sifatida alohida hisoblanadi.</p></section><div id="wbox"></div>';
  pane.querySelectorAll('[data-wm]').forEach(function(b){b.addEventListener('click',function(){S.wmode=b.dataset.wm;S.cart={};S.op=uid();renderWaste()})});
  var box=document.getElementById('wbox');
  if(S.wmode==='dish'){box.innerHTML='';var keep=document.getElementById('pane');renderMenuInto(box);return}
  box.innerHTML='<section class="card"><label class="field"><span>Mahsulot</span><input id="wq" placeholder="🔍 Qidirish"></label><select id="wi" size="6" style="width:100%;min-height:160px"></select>'
    +'<div class="row" style="gap:10px;margin-top:12px"><label class="field" style="flex:1"><span>Miqdor</span><input id="wn" inputmode="decimal" placeholder="0"></label><label class="field" style="flex:1"><span>Birlik</span><select id="wu"></select></label></div>'
    +'<label class="field"><span>Sabab</span><select id="wr">'+d.wasteReasons.map(function(r){return '<option>'+esc(r)+'</option>'}).join('')+'</select></label>'
    +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="wno" maxlength="200"></label><button class="block" id="wsave">🗑 Chiqit deb saqlash</button></section>';
  var q=document.getElementById('wq'),sel=document.getElementById('wi'),unit=document.getElementById('wu');
  function fill(){var t=q.value.trim().toLowerCase();sel.innerHTML=d.inventory.filter(function(i){return !t||i.name.toLowerCase().indexOf(t)>=0}).map(function(i){return '<option value="'+esc(i.id)+'">'+esc(i.name)+' ('+esc(i.unit)+')</option>'}).join('')}
  function units(){var it=d.inventory.find(function(i){return i.id===sel.value});unit.innerHTML=(it?it.units:[]).map(function(u){return '<option>'+esc(u)+'</option>'}).join('')}
  q.addEventListener('input',function(){fill();units()});sel.addEventListener('change',units);fill();
  document.getElementById('wsave').addEventListener('click',function(){var btn=this;if(!sel.value){toast('Mahsulotni tanlang.',true);return}
    btn.disabled=true;post({action:'waste',mode:'product',branchId:d.branchId,date:d.date,operationId:S.op,inventoryId:sel.value,quantity:Number(String(document.getElementById('wn').value).replace(',','.')),unit:unit.value,reason:document.getElementById('wr').value,note:document.getElementById('wno').value}).then(function(x){btn.disabled=false;
      if(x.error){toast(x.error,true);return}S.data=x;S.op=uid();toast('✓ Chiqit saqlandi');render()})});
}
function renderMenuInto(box){
  var d=S.data;box.innerHTML=groups().map(function(g){return '<section class="card"><h2>'+esc(g.name)+'</h2><div class="menu-grid">'+g.items.map(function(i){var q=S.cart[i.id]||0;return '<button class="dish'+(q?' on':'')+'" data-add="'+esc(i.id)+'">'+(q?'<span class="q">'+q+'</span>':'')+'<b>'+esc(i.name)+'</b><small>porsiya</small></button>'}).join('')+'</div></section>'}).join('')+'<section class="card cart" id="cart"></section>';
  box.querySelectorAll('[data-add]').forEach(function(b){b.addEventListener('click',function(){S.cart[b.dataset.add]=(S.cart[b.dataset.add]||0)+1;paintDish(b);drawCart()})});drawCart();
}
function kpi(t,v,s){return '<div class="kpi"><small>'+t+'</small><b>'+v+'</b>'+(s?'<i>'+s+'</i>':'')+'</div>'}
function renderReport(){
  var d=S.data,r=d.report,pane=document.getElementById('pane'),h='';
  if(d.role==='owner'){
    var sales=r.pos.total.gross+r.delivery.total.gross+r.halo.gross,tax=r.pos.total.tax+r.delivery.total.tax+r.halo.tax,com=r.pos.total.commission+r.delivery.total.commission;
    h+='<section class="card"><h2>'+esc(r.date)+' — jami</h2><div class="kpis">'+kpi('Jami savdo',won(sales))+kpi('Soliq (avtomatik)',won(tax))+kpi('Komissiya va ushlanma',won(com))+kpi('Sof tushum',won(sales-tax-com))+'</div></section>'
      +'<section class="card"><h2>🧾 POS apparati</h2><div class="kpis">'+kpi('💳 Karta',won(r.pos.card.gross),r.pos.card.orders+' ta · sof '+won(r.pos.card.net))+kpi('💵 Naqd (POS)',won(r.pos.cash.gross),r.pos.cash.orders+' ta · sof '+won(r.pos.cash.net))+'</div></section>'
      +'<section class="card"><h2>🛵 Delivery</h2><div class="kpis">'+r.delivery.platforms.map(function(p){return kpi(esc(p.label),won(p.gross),p.orders+' ta · ushlanma '+won(p.commission)+' · sof '+won(p.net))}).join('')+'</div></section>'
      +'<section class="card"><h2>🏦 HALO hisob (soliqsiz)</h2><div class="kpis">'+kpi('Naqd va hisob-raqam',won(r.halo.gross),'Kiritish bo‘limidan')+'</div></section>'
      +'<section class="card"><h2>Nosavdo chiqim (tannarx)</h2><div class="kpis">'+kpi('🍽 Oshxonada yeyilgan',won(r.meals.cost),r.meals.count+' ta yozuv')+kpi('🗑 Chiqit',won(r.waste.cost),r.waste.count+' ta yozuv')+'</div></section>';
  }
  var icon={sale:'🧾',meal:'🍽',waste:'🗑'};
  h+='<section class="card"><h2>Yozuvlar</h2>'+(r.entries.length?r.entries.map(function(e){
    var title=e.kind==='sale'?(e.channel==='delivery'?'🛵 '+esc((d.platforms.find(function(p){return p.id===e.platform})||{}).shortLabel||'Delivery'):e.channel==='halo'?'🏦 HALO hisob':(e.payment==='card'?'💳 Karta':'💵 Naqd')):(e.kind==='meal'?'🍽 Oshxona':'🗑 Chiqit');
    return '<div class="entry"><div><b>'+title+'</b> <small>'+hm(e.time)+(e.worker?' · '+esc(e.worker):'')+(e.orderNumber?' · #'+esc(e.orderNumber):'')+'</small><br><small>'+esc(e.summary)+'</small></div><div style="text-align:right">'+(e.amount?'<b>'+won(e.amount)+'</b>':(e.cost!=null?'<small>tannarx '+won(e.cost)+'</small>':''))
      +(d.role==='owner'&&(e.kind!=='sale'||e.channel!=='halo')?'<br><button class="ghost" data-cancel="'+esc(e.id)+'" style="min-height:30px;padding:2px 10px;margin-top:6px">Bekor qilish</button>':'')+'</div></div>'}).join(''):'<p class="hint">Bugun hali yozuv yo‘q.</p>')+'</section>';
  pane.innerHTML=h;
  pane.querySelectorAll('[data-cancel]').forEach(function(b){b.addEventListener('click',function(){if(!confirm('Bu yozuv bekor qilinsinmi? Ombor qoldig‘i qaytariladi.'))return;b.disabled=true;
    post({action:'cancel',branchId:d.branchId,date:d.date,id:b.dataset.cancel}).then(function(x){if(x.error){toast(x.error,true);b.disabled=false;return}S.data=x;toast('✓ Bekor qilindi');render()})})});
}
load();
`,
  });
}
