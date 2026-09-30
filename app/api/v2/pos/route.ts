import { isAdminRequest } from "../../../lib/integration-store";
import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { applyPosOrder, buildPosTerminalView, cancelPosOrder, PosTerminalError, removeSalesById, type PosOrderInput } from "../../../lib/pos-terminal";
import { applyWorkerConsumption, compatibleInventoryInputUnits, deleteWorkerConsumption, inventoryQuantityFromInput, WorkerConsumptionError } from "../../../lib/worker-consumptions";
import { DELIVERY_PLATFORMS } from "../../../lib/delivery-sales";
import { seoulBusinessDate } from "../../../lib/business-time";
import { readDeductionRules } from "../../../core/deductions";
import { posDayReport } from "../../../core/pos-report";
import { shell } from "../../../core/ui-shell";
import { assertV2DayOpen, ClosedDayError } from "../../../core/closed-days";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — HALO HISOB oynasi (alohida havola: /pos). Eski tizimdagi kabi, lekin qulayroq:
 *  - 💵 Naqd / hisob-raqam savdosi — soliqsiz (HALO hisob);
 *  - 🛵 Delivery — har platforma o'z narxi bilan, ushlanma va soliq avtomatik;
 *  - 🍽 Oshxonada yeyilgan ovqat va 🗑 chiqit — alohida hisob;
 *  - 📊 Bugun — rahbarga hamma raqamlar, bekor qilish.
 * POS apparati savdosi (karta) bu oynaga kiritilmaydi.
 * Kirish: rahbar, xodim (login+PIN) yoki eski /hisob kabi loginsiz — faqat asosiy filial, faqat kiritish.
 */
const PAGE_PATH = "/api/v2/pos";
const POS_ACTOR_ID = "pos-terminal";
const WASTE_REASONS = ["Isrof / buzilgan", "Muddati o‘tgan", "Tushib ketdi / to‘kildi", "Boshqa"];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Row = Record<string, unknown>;
class PosPageError extends Error { constructor(message: string, public status = 400) { super(message); } }

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

type User = { role: "owner" | "worker" | "public"; name: string; branchId: string };
async function who(request: Request): Promise<User> {
  if (await isAdminRequest(request)) return { role: "owner", name: "Rahbar", branchId: "" };
  const worker = await authenticateWorkerRequest(request);
  if (worker) return { role: "worker", name: String(worker.name || "Xodim"), branchId: String(worker.branchId) };
  // Eski HALO HISOB kabi: do'kondagi planshetdan loginsiz — faqat asosiy filial, faqat kiritish.
  return { role: "public", name: "HALO HISOB", branchId: "main" };
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

function view(state: Row, date: string, role: User["role"]) {
  const terminal = buildPosTerminalView(state);
  const report = posDayReport(state, date);
  const rules = readDeductionRules(state);
  return {
    catalog: terminal.catalog,
    categories: terminal.productCategories,
    inventory: inventoryChoices(state),
    rules: { taxPct: rules.taxPct, platforms: rules.platforms },
    // Summalar va tannarx — faqat rahbarga; xodim bugungi yozuvlar ro'yxatini ko'radi; loginsiz — hech narsa.
    report: role === "owner" ? report
      : role === "worker" ? { date: report.date, entries: report.entries.map((entry) => ({ ...entry, cost: undefined, amount: 0 })) }
        : { date: report.date, entries: [] },
  };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  try {
    const user = await who(request);
    const body = await request.json() as Row;
    const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
    const allowed = user.role === "owner" ? branches : branches.filter((branch) => branch.id === user.branchId);
    const branchId = user.role === "owner" ? clean(body.branchId, 80) || allowed[0]?.id || "main" : user.branchId;
    if (!allowed.some((branch) => branch.id === branchId)) throw new PosPageError("Filial topilmadi.", 404);
    const today = seoulBusinessDate(new Date());
    // Xodim va do'kon planshetida sana har doim — bugun (tunda ochiq qolgan sahifa ham yangi kunga yozadi).
    const date = user.role === "owner" ? clean(body.date, 10) || today : today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new PosPageError("Sanani tekshiring.");
    const actor = { id: POS_ACTOR_ID, name: user.name };
    const action = String(body.action || "load");
    const createdAt = new Date().toISOString();
    let saved: unknown = null;

    if (action === "sale") {
      await assertV2DayOpen(branchId, date);
      const paymentType = String(body.paymentType || "");
      if (!["cash", "bank", "delivery"].includes(paymentType)) throw new PosPageError("Naqd, hisob-raqam yoki delivery savdosini tanlang.");
      const input: PosOrderInput = {
        operationId: clean(body.operationId, 100), date, mode: "sale", paymentType: paymentType as PosOrderInput["paymentType"],
        deliveryPlatform: paymentType === "delivery" ? body.deliveryPlatform as PosOrderInput["deliveryPlatform"] : undefined,
        deliveryOrderNumber: paymentType === "delivery" ? clean(body.deliveryOrderNumber, 64) : undefined,
        expectedTotal: body.expectedTotal === undefined ? undefined : Number(body.expectedTotal),
        items: Array.isArray(body.items) ? body.items as PosOrderInput["items"] : [],
        note: clean(body.note, 240),
      };
      const label = paymentType === "delivery" ? `Delivery · ${String(body.deliveryPlatform)}` : paymentType === "bank" ? "hisob-raqam" : "naqd";
      const mutation = await mutateHaloState((state) => applyPosOrder(state as Row, input, actor, createdAt), 5, branchId, user.name,
        `HALO HISOB: ${label} savdo`, "HALO HISOB (yangi)");
      saved = { kind: "sale", alreadySaved: mutation.result.alreadySaved, orderNumber: (mutation.result.order as Row | undefined)?.orderNumber };
    } else if (action === "meal" || (action === "waste" && body.mode === "dish")) {
      const kitchen = action === "meal";
      const input: PosOrderInput = {
        operationId: clean(body.operationId, 100), date, mode: "inventory_only",
        inventoryReason: kitchen ? "Oshxonada yeyilgan ovqat" : "Isrof / buzilgan",
        items: Array.isArray(body.items) ? body.items as PosOrderInput["items"] : [], note: clean(body.note, 240),
      };
      const mutation = await mutateHaloState((state) => applyPosOrder(state as Row, input, actor, createdAt), 5, branchId, user.name,
        kitchen ? "HALO HISOB: oshxonada yeyilgan ovqat" : "HALO HISOB: chiqit (taom)", "HALO HISOB (yangi)");
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
      }, 5, branchId, user.name, "HALO HISOB: chiqit (mahsulot)", "HALO HISOB (yangi)");
      saved = { kind: "waste", alreadySaved: mutation.result.alreadySaved };
    } else if (action === "cancel") {
      if (user.role !== "owner") throw new PosPageError("Bekor qilishni faqat rahbar qiladi.", 403);
      const id = clean(body.id, 160);
      await mutateHaloState((state) => {
        if (id.startsWith("pos-order:")) return { state: cancelPosOrder(state as Row, id).state, result: null };
        if (id.startsWith("pos-import:")) {
          // Butun POS hisobot yuklashini bekor qilish: savdolar olib tashlanadi, ombor qaytadi.
          const batch = id.slice("pos-import:".length);
          const ids = new Set((Array.isArray((state as Row).sales) ? (state as Row).sales as Row[] : [])
            .filter((sale) => sale.posImport && (sale.posImport as Row).batch === batch).map((sale) => String(sale.id)));
          if (!ids.size) throw new PosPageError("POS hisobot topilmadi.", 404);
          return { state: removeSalesById(state as Row, ids), result: null };
        }
        // Rahbar istalgan oshxona/chiqit yozuvini bekor qiladi (eski xodim dasturida kiritilganini ham).
        const entry = (Array.isArray((state as Row).workerConsumptions) ? (state as Row).workerConsumptions as Row[] : []).find((item) => item.id === id);
        return { state: deleteWorkerConsumption(state as Row, id, { id: String(entry?.workerId || actor.id), name: actor.name }).state, result: null };
      }, 5, branchId, user.name, "HALO HISOB: yozuv bekor qilindi", "HALO HISOB (yangi)");
      saved = { kind: "cancel" };
    } else if (action !== "load") {
      throw new PosPageError("Amal noto‘g‘ri.");
    }

    const { state } = await readHaloState(branchId);
    return json({
      ok: true, saved, role: user.role, name: user.name, today, date, branchId, branches: allowed,
      platforms: DELIVERY_PLATFORMS, wasteReasons: WASTE_REASONS, ...view(state as Row, date, user.role),
    });
  } catch (error) {
    if (error instanceof PosPageError || error instanceof PosTerminalError || error instanceof WorkerConsumptionError) {
      return json({ error: error.message }, (error as { status?: number }).status || 400);
    }
    if (error instanceof ClosedDayError) return json({ error: error.message }, 409);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial|oy/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(): string {
  return shell({
    title: "HALO HISOB", active: null, app: "hisob", back: "history",
    body: `<div id="app"><section class="card"><div class="skeleton"></div></section></div>
<style>
#app{min-width:0;max-width:100%;display:grid;gap:14px}
.head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.head>*{min-width:0}
.modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}
.modes button{min-height:74px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 4px;font-size:15px;line-height:1.15}
.modes button small{font-weight:600;font-size:11px;opacity:.8}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:8px}.seg3{grid-template-columns:repeat(3,1fr)}.seg>*{min-width:0}
.seg button{min-height:54px;font-size:16px}
.work{display:grid;gap:14px;min-width:0}
@media (min-width:900px){.work{grid-template-columns:minmax(0,1fr) 340px;align-items:start}.side-cart{position:sticky;top:78px}}
.menu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px}.menu-grid>*{min-width:0}
.dish{position:relative;min-height:84px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;text-align:left;padding:12px;background:var(--card-2);color:var(--text);border:1px solid var(--line)}
.dish.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent) inset}.dish b{font-size:15px;line-height:1.25}.dish small{color:var(--muted);font-weight:700}
.dish .q{position:absolute;top:8px;right:8px;background:var(--accent);color:var(--accent-ink);border-radius:99px;min-width:26px;height:26px;display:grid;place-items:center;font-weight:900;font-size:14px}
.dish[disabled]{opacity:.4}
.cart{border-color:var(--accent)}
@media (max-width:899px){.side-cart{position:sticky;bottom:10px;z-index:5}.cart{padding:12px 14px;box-shadow:0 -6px 24px rgba(0,0,0,.35)}.cart .lines{display:none;max-height:34vh;overflow:auto}.cart.open .lines{display:block}.cart h2{display:none}.menu-col{padding-bottom:8px}}
@media (min-width:900px){.cart .toggle{display:none}}
.cart-line{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}
.cart-line .qb{display:flex;gap:6px;align-items:center}.cart-line .qb button{min-height:36px;min-width:36px;padding:0}
.big{font-size:26px;font-weight:900}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.kpis>*{min-width:0}
.kpi{background:var(--card-2);border:1px solid var(--line);border-radius:14px;padding:12px}.kpi small{display:block;color:var(--muted);font-weight:700}.kpi b{font-size:19px}.kpi i{display:block;font-style:normal;color:var(--muted);font-size:12px;margin-top:4px}
.entry{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.entry small{color:var(--muted)}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#16a34a;color:#fff;padding:14px 20px;border-radius:14px;font-weight:800;z-index:50;box-shadow:0 8px 30px rgba(0,0,0,.35);max-width:90vw;text-align:center}
.toast.bad{background:#dc2626}
@media (max-width:420px){.modes button{min-height:62px;font-size:14px}.modes button small{display:none}}
</style>`,
    script: `
var S={mode:'sale',pay:'cash',plat:null,cart:{},op:uid(),data:null,wmode:'product',q:''};
if(location.hash==='#chiqit')S.mode='waste';else if(location.hash==='#delivery')S.mode='delivery';else if(location.hash==='#oshxona')S.mode='meal';
var app=document.getElementById('app');
function uid(){return (crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2)).replace(/-/g,'')}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return Math.round(Number(n||0)).toLocaleString('en-US')+' ₩'}
function hm(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}
function post(body){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){j._status=r.status;return j})}).catch(function(){return {error:'Internet aloqasini tekshiring.'}})}
function toast(text,bad){var t=document.createElement('div');t.className='toast'+(bad?' bad':'');t.textContent=text;document.body.appendChild(t);setTimeout(function(){t.remove()},bad?4200:2000)}
var savedBranch='';try{savedBranch=localStorage.getItem('halo-pos-branch')||''}catch(e){}
function load(){var d=S.data;return post({action:'load',branchId:d?d.branchId:savedBranch,date:S.picked||''}).then(function(x){
  if(x.error){app.innerHTML='<section class="card"><div class="msg bad">'+esc(x.error)+'</div></section>';return}
  S.data=x;try{localStorage.setItem('halo-pos-branch',x.branchId)}catch(e){}if(!S.plat)S.plat=(x.platforms[0]||{}).id;render()})}
function loginForm(){
  fetch('/api/worker-auth',{credentials:'same-origin'}).then(function(r){return r.json()}).catch(function(){return {}}).then(function(a){var br=a.branches||[];
    app.innerHTML='<section class="card" style="max-width:420px;margin:20px auto;width:100%"><h1 style="margin:0 0 6px">Xodim kirishi</h1><p class="hint">Boshqa filial yoki bugungi yozuvlarni ko‘rish uchun. Rahbar — <a href="/signin-with-chatgpt?return_to=/api/v2/pos">rahbar kirishi</a>.</p>'
      +(br.length>1?'<label class="field"><span>Filial</span><select id="lb">'+br.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('')+'</select></label>':'')
      +'<label class="field"><span>Login</span><input id="lu" autocapitalize="off" autocomplete="username"></label><label class="field"><span>PIN</span><input id="lp" type="password" inputmode="numeric" autocomplete="current-password"></label><div class="row"><button class="ghost" id="lx">Orqaga</button><button id="lg" style="flex:1">Kirish</button></div><div id="lm"></div></section>';
    document.getElementById('lx').addEventListener('click',render);
    document.getElementById('lg').addEventListener('click',function(){var b=document.getElementById('lb');
      fetch('/api/worker-auth',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'login',branchId:b?b.value:(br[0]||{}).id||'main',username:document.getElementById('lu').value.trim().toLowerCase(),pin:document.getElementById('lp').value})}).then(function(r){return r.json()}).then(function(j){if(j.ok){S.data=null;load()}else document.getElementById('lm').innerHTML='<div class="msg bad">'+esc(j.error||'Kirilmadi.')+'</div>'})});
  });
}
var MODES=[['sale','💵','Naqd / hisob','soliqsiz'],['delivery','🛵','Delivery','alohida narx'],['meal','🍽','Oshxonada yeyilgan','daromadsiz'],['waste','🗑','Chiqit','isrof, buzilgan']];
function render(){
  var d=S.data,modes=MODES.concat(d.role==='public'?[]:[['report','📊','Bugun','yozuvlar']]);
  app.innerHTML='<div class="head"><div><b style="font-size:21px">HALO HISOB</b><br><small style="color:var(--muted)">'+esc(d.role==='public'?'Do‘kon oynasi':d.name+(d.role==='owner'?' · rahbar':''))+'</small></div><div class="row" style="gap:8px">'
    +(d.branches.length>1?'<select id="br">'+d.branches.map(function(b){return '<option value="'+esc(b.id)+'"'+(b.id===d.branchId?' selected':'')+'>'+esc(b.name)+'</option>'}).join('')+'</select>':'<b>'+esc((d.branches[0]||{}).name||'')+'</b>')
    +(d.role==='owner'?'<input type="date" id="dt" value="'+esc(d.date)+'" max="'+esc(d.today)+'">':'')
    +(d.role==='public'?'<button class="ghost" id="login" style="min-height:40px;padding:6px 12px">Kirish</button>':'')+(window.haloStandalone()?'':'<a href="/api/v2/ornatish?app=hisob" title="Ilova qilib o‘rnatish"><button class="ghost" style="min-height:40px;padding:6px 12px">📲</button></a>')+'</div></div>'
    +(d.date!==d.today?'<div class="msg">'+esc(d.date)+' sanasiga yozilmoqda.</div>':'')
    +'<div class="modes">'+modes.map(function(m){return '<button class="'+(S.mode===m[0]?'':'ghost')+'" data-mode="'+m[0]+'"><span style="font-size:20px">'+m[1]+'</span><b>'+m[2]+'</b><small>'+m[3]+'</small></button>'}).join('')+'</div><div id="pane"></div>';
  var br=document.getElementById('br');if(br)br.addEventListener('change',function(){S.cart={};d.branchId=br.value;load()});
  var dt=document.getElementById('dt');if(dt)dt.addEventListener('change',function(){S.picked=dt.value===d.today?'':dt.value;load()});
  var lg=document.getElementById('login');if(lg)lg.addEventListener('click',loginForm);
  app.querySelectorAll('[data-mode]').forEach(function(b){b.addEventListener('click',function(){S.mode=b.dataset.mode;S.cart={};S.op=uid();S.q='';render()})});
  if(S.mode==='report')renderReport();else if(S.mode==='waste')renderWaste();else renderMenu(document.getElementById('pane'));
}
function price(item){if(S.mode==='delivery')return Number((item.deliveryPrices||{})[S.plat]||0);if(S.mode==='sale')return Number(item.salePrice||0);return 0}
function groups(){var d=S.data,t=S.q.trim().toLowerCase(),cats=(d.categories||[]).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
  var list=d.catalog.filter(function(i){return !t||i.name.toLowerCase().indexOf(t)>=0||String(i.posCode||'').toLowerCase().indexOf(t)>=0});
  var g=cats.map(function(c){return {name:c.name,items:list.filter(function(i){return i.categoryId===c.id})}}).filter(function(x){return x.items.length});
  var rest=list.filter(function(i){return !cats.some(function(c){return c.id===i.categoryId})});if(rest.length)g.push({name:g.length?'Boshqa':'Menyu',items:rest});return g}
function topBox(){var d=S.data;
  if(S.mode==='sale')return '<section class="card"><div class="seg"><button class="'+(S.pay==='cash'?'':'ghost')+'" data-pay="cash">💵 Naqd</button><button class="'+(S.pay==='bank'?'':'ghost')+'" data-pay="bank">🏦 Hisob-raqamga</button></div><p class="hint" style="margin:10px 0 0">Oddiy narx · soliq ushlanmaydi.</p></section>';
  if(S.mode==='delivery'){var pr=d.rules.platforms.find(function(p){return p.id===S.plat})||{pct:0,feeWon:0};
    return '<section class="card"><div class="seg seg3">'+d.platforms.map(function(p){return '<button class="'+(S.plat===p.id?'':'ghost')+'" data-plat="'+esc(p.id)+'">'+esc(p.shortLabel||p.label)+'</button>'}).join('')+'</div>'
      +'<label class="field" style="margin:12px 0 0"><span>Buyurtma raqami (ixtiyoriy)</span><input id="ordNo" maxlength="64" placeholder="masalan, B2K9"></label>'
      +'<p class="hint" style="margin:8px 0 0">Shu platformaning delivery narxi. Ushlanma '+pr.pct+'%'+(pr.feeWon?' + '+won(pr.feeWon):'')+' va soliq '+d.rules.taxPct+'% avtomatik.</p></section>'}
  if(S.mode==='meal')return '<section class="card"><p class="hint" style="margin:0">Xodimlar oshxonada yegan taomni tanlang. Pul tushumi yo‘q — retsept bo‘yicha ombordan ayiriladi va alohida hisoblanadi.</p></section>';
  return '';
}
function renderMenu(pane){
  var d=S.data;
  var menu=groups().map(function(g){return '<section class="card"><h2>'+esc(g.name)+'</h2><div class="menu-grid">'+g.items.map(function(i){var p=price(i),dis=(S.mode==='sale'||S.mode==='delivery')&&!p,q=S.cart[i.id]||0;
    return '<button class="dish'+(q?' on':'')+'" data-add="'+esc(i.id)+'"'+(dis?' disabled':'')+'>'+(q?'<span class="q">'+q+'</span>':'')+'<b>'+esc(i.name)+'</b><small>'+(S.mode==='sale'||S.mode==='delivery'?(p?won(p):'narx yo‘q'):'porsiya')+'</small></button>'}).join('')+'</div></section>'}).join('')||'<section class="card"><p class="hint">Topilmadi.</p></section>';
  pane.innerHTML=topBox()+'<div class="work"><div class="menu-col" style="display:grid;gap:14px;min-width:0"><input id="search" placeholder="🔍 Taom qidirish" value="'+esc(S.q)+'">'+menu+'</div><div class="side-cart"><section class="card cart" id="cart"></section></div></div>';
  pane.querySelectorAll('[data-pay]').forEach(function(b){b.addEventListener('click',function(){S.pay=b.dataset.pay;S.op=uid();renderMenu(pane)})});
  pane.querySelectorAll('[data-plat]').forEach(function(b){b.addEventListener('click',function(){S.plat=b.dataset.plat;S.cart={};S.op=uid();renderMenu(pane)})});
  var se=document.getElementById('search');se.addEventListener('input',function(){S.q=se.value;var pos=se.selectionStart;renderMenu(pane);var n=document.getElementById('search');n.focus();try{n.setSelectionRange(pos,pos)}catch(e){}});
  pane.querySelectorAll('[data-add]').forEach(function(b){b.addEventListener('click',function(){S.cart[b.dataset.add]=(S.cart[b.dataset.add]||0)+1;paintDish(b);drawCart()})});
  drawCart();
}
function paintDish(el){var q=S.cart[el.dataset.add]||0;el.classList.toggle('on',q>0);var s=el.querySelector('.q');if(q){if(!s){s=document.createElement('span');s.className='q';el.prepend(s)}s.textContent=q}else if(s)s.remove()}
function cartItems(){var d=S.data;return Object.keys(S.cart).filter(function(k){return S.cart[k]>0}).map(function(k){var it=d.catalog.find(function(i){return i.id===k})||{name:'?'};return {id:k,name:it.name,q:S.cart[k],p:price(it)}})}
function drawCart(){
  var box=document.getElementById('cart');if(!box)return;var items=cartItems(),d=S.data;
  if(!items.length){box.innerHTML='<h2 style="margin-bottom:6px">Savat</h2><p class="hint" style="margin:0">Taomni bosing — savatga qo‘shiladi.</p>';return}
  var total=items.reduce(function(s,i){return s+i.p*i.q},0),info='';
  if(S.mode==='delivery'){var pr=d.rules.platforms.find(function(p){return p.id===S.plat})||{pct:0,feeWon:0};var fee=Math.min(total,Math.round(total*pr.pct/100)+pr.feeWon),tx=Math.round(total*d.rules.taxPct/100);info='ushlanma '+won(fee)+' · soliq '+won(tx)+' · sof '+won(total-fee-tx)}
  var label=S.mode==='sale'?(S.pay==='cash'?'💵 Naqd savdoni saqlash':'🏦 Hisob-raqam savdosini saqlash'):S.mode==='delivery'?'🛵 Delivery saqlash':S.mode==='meal'?'🍽 Yeyilgan deb saqlash':'🗑 Chiqit deb saqlash';
  var count=items.reduce(function(s,i){return s+i.q},0);box.classList.toggle('open',!!S.open);
  box.innerHTML='<h2 style="margin-bottom:6px">Savat</h2><div class="lines">'+items.map(function(i){return '<div class="cart-line"><span><b>'+esc(i.name)+'</b>'+(i.p?'<br><small style="color:var(--muted)">'+won(i.p)+' × '+i.q+'</small>':'')+'</span><span class="qb"><button class="ghost" data-dec="'+esc(i.id)+'">−</button><b>'+i.q+'</b><button class="ghost" data-inc="'+esc(i.id)+'">+</button></span></div>'}).join('')+'</div>'
    +'<div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:8px"><div>'+(total?'<span class="big">'+won(total)+'</span>':'<b class="big">'+count+' porsiya</b>')+(info?'<br><small style="color:var(--muted)">'+info+'</small>':'')+'</div><button class="ghost toggle" id="tog" style="min-height:40px;padding:6px 12px">'+(S.open?'Yopish ▾':count+' ta ▴')+'</button></div>'
    +'<div class="row" style="margin-top:10px"><button class="ghost" id="clr">Tozalash</button><button id="save" style="flex:1">'+label+'</button></div>';
  document.getElementById('tog').addEventListener('click',function(){S.open=!S.open;drawCart()});
  box.querySelectorAll('[data-inc]').forEach(function(b){b.addEventListener('click',function(){S.cart[b.dataset.inc]++;refreshDish(b.dataset.inc);drawCart()})});
  box.querySelectorAll('[data-dec]').forEach(function(b){b.addEventListener('click',function(){S.cart[b.dataset.dec]--;if(S.cart[b.dataset.dec]<=0)delete S.cart[b.dataset.dec];refreshDish(b.dataset.dec);drawCart()})});
  document.getElementById('clr').addEventListener('click',function(){S.cart={};S.op=uid();document.querySelectorAll('.dish.on').forEach(paintDishClear);drawCart()});
  document.getElementById('save').addEventListener('click',function(){saveCart(total)});
}
function paintDishClear(el){el.classList.remove('on');var s=el.querySelector('.q');if(s)s.remove()}
function refreshDish(id){var el=document.querySelector('[data-add="'+id+'"]');if(el)paintDish(el)}
function saveCart(total){
  var btn=document.getElementById('save');btn.disabled=true;var items=cartItems().map(function(i){return {recipeId:i.id,quantity:i.q}});
  var body={branchId:S.data.branchId,date:S.picked||'',operationId:S.op,items:items};
  if(S.mode==='sale'){body.action='sale';body.paymentType=S.pay}
  else if(S.mode==='delivery'){body.action='sale';body.paymentType='delivery';body.deliveryPlatform=S.plat;body.expectedTotal=total;var o=document.getElementById('ordNo');body.deliveryOrderNumber=o?o.value.trim():''}
  else if(S.mode==='meal')body.action='meal';
  else {body.action='waste';body.mode='dish'}
  post(body).then(function(x){btn.disabled=false;
    if(x.error){toast(x.error,true);return}
    S.data=x;S.cart={};S.open=false;S.op=uid();toast(x.saved&&x.saved.alreadySaved?'Oldin saqlangan — takror yozilmadi':'✓ Saqlandi'+(x.saved&&x.saved.orderNumber?' · #'+x.saved.orderNumber:''));render()});
}
function renderWaste(){
  var d=S.data,pane=document.getElementById('pane');
  pane.innerHTML='<section class="card"><div class="seg"><button class="'+(S.wmode==='product'?'':'ghost')+'" data-wm="product">🥩 Mahsulot</button><button class="'+(S.wmode==='dish'?'':'ghost')+'" data-wm="dish">🍔 Tayyor taom</button></div><p class="hint" style="margin:10px 0 0">Buzilgan, muddati o‘tgan yoki tashlangan narsa. Ombordan ayiriladi va chiqit sifatida alohida hisoblanadi.</p></section><div id="wbox"></div>';
  pane.querySelectorAll('[data-wm]').forEach(function(b){b.addEventListener('click',function(){S.wmode=b.dataset.wm;S.cart={};S.op=uid();renderWaste()})});
  var box=document.getElementById('wbox');
  if(S.wmode==='dish'){renderMenu(box);return}
  box.innerHTML='<section class="card"><label class="field"><span>Mahsulot</span><input id="wq" placeholder="🔍 Qidirish"></label><select id="wi" size="6" style="width:100%;min-height:170px"></select>'
    +'<div class="row" style="gap:10px;margin-top:12px"><label class="field" style="flex:1"><span>Miqdor</span><input id="wn" inputmode="decimal" placeholder="0"></label><label class="field" style="flex:1"><span>Birlik</span><select id="wu"></select></label></div>'
    +'<label class="field"><span>Sabab</span><select id="wr">'+d.wasteReasons.map(function(r){return '<option>'+esc(r)+'</option>'}).join('')+'</select></label>'
    +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="wno" maxlength="200"></label><button class="block" id="wsave">🗑 Chiqit deb saqlash</button></section>';
  var q=document.getElementById('wq'),sel=document.getElementById('wi'),unit=document.getElementById('wu');
  function fill(){var t=q.value.trim().toLowerCase();sel.innerHTML=d.inventory.filter(function(i){return !t||i.name.toLowerCase().indexOf(t)>=0}).map(function(i){return '<option value="'+esc(i.id)+'">'+esc(i.name)+' ('+esc(i.unit)+')</option>'}).join('')}
  function units(){var it=d.inventory.find(function(i){return i.id===sel.value});unit.innerHTML=(it?it.units:[]).map(function(u){return '<option>'+esc(u)+'</option>'}).join('')}
  q.addEventListener('input',function(){fill();units()});sel.addEventListener('change',units);fill();
  document.getElementById('wsave').addEventListener('click',function(){var btn=this;if(!sel.value){toast('Mahsulotni tanlang.',true);return}
    btn.disabled=true;post({action:'waste',mode:'product',branchId:d.branchId,date:S.picked||'',operationId:S.op,inventoryId:sel.value,quantity:Number(String(document.getElementById('wn').value).replace(',','.')),unit:unit.value,reason:document.getElementById('wr').value,note:document.getElementById('wno').value}).then(function(x){btn.disabled=false;
      if(x.error){toast(x.error,true);return}S.data=x;S.op=uid();toast('✓ Chiqit saqlandi');render()})});
}
function kpi(t,v,s){return '<div class="kpi"><small>'+t+'</small><b>'+v+'</b>'+(s?'<i>'+s+'</i>':'')+'</div>'}
function renderReport(){
  var d=S.data,r=d.report,pane=document.getElementById('pane'),h='';
  if(d.role==='owner'){
    var cash=0,bank=0;r.entries.forEach(function(e){if(e.kind==='sale'&&e.channel==='halo'){if(e.payment==='bank')bank+=e.amount;else cash+=e.amount}});
    var tax=r.pos.total.tax+r.delivery.total.tax+r.halo.tax,com=r.pos.total.commission+r.delivery.total.commission,sales=r.pos.total.gross+r.delivery.total.gross+r.halo.gross;
    h+='<section class="card"><h2>'+esc(r.date)+'</h2><div class="kpis">'+kpi('💵 Naqd',won(cash))+kpi('🏦 Hisob-raqam',won(bank))+kpi('🛵 Delivery',won(r.delivery.total.gross),'ushlanma '+won(r.delivery.total.commission)+' · soliq '+won(r.delivery.total.tax))+kpi('Jami savdo',won(sales),'sof '+won(sales-tax-com))+'</div></section>'
      +'<section class="card"><h2>🛵 Platformalar</h2><div class="kpis">'+r.delivery.platforms.map(function(p){return kpi(esc(p.label),won(p.gross),p.orders+' ta · sof '+won(p.net))}).join('')+'</div></section>'
      +'<section class="card"><h2>Nosavdo chiqim (tannarx)</h2><div class="kpis">'+kpi('🍽 Oshxonada yeyilgan',won(r.meals.cost),r.meals.count+' ta yozuv')+kpi('🗑 Chiqit',won(r.waste.cost),r.waste.count+' ta yozuv')+'</div></section>'
      +(r.pos.total.gross?'<section class="card"><h2>POS apparati (hisobotdan)</h2><div class="kpis">'+kpi('POS savdo',won(r.pos.total.gross),'soliq '+won(r.pos.total.tax)+' · komissiya '+won(r.pos.total.commission))+'</div></section>':'');
  }
  h+='<section class="card"><h2>Bugungi yozuvlar</h2>'+(r.entries.length?r.entries.map(function(e){
    var title=e.kind==='sale'?(e.channel==='delivery'?'🛵 '+esc((d.platforms.find(function(p){return p.id===e.platform})||{}).shortLabel||'Delivery'):e.channel==='pos'?(e.payment==='import'?'📊 POS hisobot':'POS'):(e.payment==='bank'?'🏦 Hisob-raqam':'💵 Naqd')):(e.kind==='meal'?'🍽 Oshxona':'🗑 Chiqit');
    return '<div class="entry"><div><b>'+title+'</b> <small>'+hm(e.time)+(e.worker?' · '+esc(e.worker):'')+(e.orderNumber?' · #'+esc(e.orderNumber):'')+'</small><br><small>'+esc(e.summary)+'</small></div><div style="text-align:right">'+(e.amount?'<b>'+won(e.amount)+'</b>':(e.cost!=null?'<small>tannarx '+won(e.cost)+'</small>':''))
      +(d.role==='owner'?'<br><button class="ghost" data-cancel="'+esc(e.id)+'" style="min-height:30px;padding:2px 10px;margin-top:6px">Bekor qilish</button>':'')+'</div></div>'}).join(''):'<p class="hint">Hali yozuv yo‘q.</p>')+'</section>';
  pane.innerHTML=h;
  pane.querySelectorAll('[data-cancel]').forEach(function(b){b.addEventListener('click',function(){if(!confirm('Bu yozuv bekor qilinsinmi? Ombor qoldig‘i qaytariladi.'))return;b.disabled=true;
    post({action:'cancel',branchId:d.branchId,date:S.picked||'',id:b.dataset.cancel}).then(function(x){if(x.error){toast(x.error,true);b.disabled=false;return}S.data=x;toast('✓ Bekor qilindi');render()})})});
}
load();
`,
  });
}
