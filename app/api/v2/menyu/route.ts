import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { RecipeError, recipeCategories, recipeChoices, recipeViews, saveRecipe, TARGET_FOOD_COST } from "../../../core/recipes";
import { DELIVERY_PLATFORMS } from "../../../lib/delivery-sales";
import { menuReport } from "../../../core/menu";
import { shell } from "../../../core/ui-shell";
import { PRICE_CALC_JS, PRICE_STEPS } from "../../../core/price-calc";
import { readDeductionRules } from "../../../core/deductions";
import { categoryList } from "../../../core/categories";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/menyu";
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

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
    const today = seoulToday();
    const recipesPayload = (state: Record<string, unknown>) => ({
      recipes: recipeViews(state), products: recipeChoices(state, today), categories: recipeCategories(state),
      platforms: DELIVERY_PLATFORMS, target: TARGET_FOOD_COST, inventoryCategories: categoryList(state, "inventory"),
      deduction: (() => { const rules = readDeductionRules(state); return { taxPct: rules.taxPct, cardPct: rules.cardPct }; })(),
    });
    if (body.action === "recipes") {
      const { state } = await readHaloState(branchId);
      return json({ ok: true, ...recipesPayload(state as Record<string, unknown>) });
    }
    if (body.action === "saveRecipe") {
      const mutation = await mutateHaloState((state) => saveRecipe(state as Record<string, unknown>, body), 5, branchId, "Rahbar",
        `Taom tannarxi saqlandi · ${String(body.name || "").slice(0, 60)}`, "Menyu (yangi)");
      return json({ ok: true, created: mutation.result.created, id: mutation.result.recipe.id, ...recipesPayload(mutation.state as Record<string, unknown>) });
    }
    const { state } = await readHaloState(branchId);
    return json({ ok: true, report: menuReport(state as Record<string, unknown>, today, Number(body.days) || 30) });
  } catch (error) {
    if (error instanceof RecipeError) return json({ error: error.message }, error.status);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    if (error instanceof Error && /filial/i.test(error.message)) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Menyu", active: "menyu", heading: "Menyu",
    subtitle: "Taom tannarxi, narxlar va qaysi taom pul topib beryapti",
    headerRight: '<div class="row"><select id="days"><option value="7">7 kun</option><option value="30" selected>30 kun</option><option value="90">90 kun</option></select><select id="branch"></select></div>',
    body: `<section class="card"><div class="row"><button data-m="rec">🍽 Taom tannarxi</button><button class="ghost" data-m="ana">📊 Tahlil</button></div></section>
<div id="rec" style="display:grid;gap:16px"></div>
<div id="body" style="display:none;gap:16px"><section class="card"><div class="skeleton"></div><div class="skeleton" style="margin-top:12px"></div></section></div>`,
    script: `
var BRANCHES=${boot};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){if(n==null)return '—';n=Number(n);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch'),days=document.getElementById('days');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var CLS={star:['⭐ Yulduz','Ko‘p sotiladi, foydasi yuqori. Saqlang, sifat va porsiyani o‘zgartirmang.','ok'],
  plowhorse:['🐎 Ishchi ot','Ko‘p sotiladi, lekin foydasi past. Tannarxni kamaytiring yoki narxni ozgina oshiring.','warn'],
  puzzle:['🧩 Jumboq','Foydasi yuqori, lekin kam sotiladi. Menyuda ko‘zga tashlang, kassir tavsiya qilsin.','warn'],
  dog:['⚠️ Zaif','Kam sotiladi va foydasi past. Retseptni o‘zgartiring yoki menyudan olib tashlang.','bad']};
var FILTER='all',R=null;
function load(){
  var body=document.getElementById('body');body.innerHTML='<section class="card">'+haloLoading(4)+'</section>';
  api({branchId:sel.value,days:Number(days.value)}).then(function(res){
    if(!res.ok){body.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    R=res.report;render();
  });
}
function render(){
  var r=R,body=document.getElementById('body');
  var list=r.items.filter(function(i){return FILTER==='all'?true:FILTER==='flag'?i.flags.length:i.cls===FILTER});
  body.innerHTML='<section class="card"><h2>'+esc(r.from)+' — '+esc(r.to)+'</h2><div class="grid">'
    +'<div class="kpi"><small>Sotilgan taomlar</small><b>'+r.totals.sold.toLocaleString('en-US')+' ta</b></div>'
    +'<div class="kpi"><small>Savdo (taomlar bo‘yicha)</small><b>'+won(r.totals.revenue)+'</b></div>'
    +'<div class="kpi"><small>Retsept bo‘yicha foyda</small><b>'+won(r.totals.contribution)+'</b><div class="hint">o‘rtacha '+won(r.totals.avgMargin)+' / dona</div></div>'
    +'</div></section>'
    +'<section class="card"><h2>Guruhlar</h2><div class="grid">'+['star','plowhorse','puzzle','dog'].map(function(k){
      return '<div class="kpi" data-f="'+k+'" style="cursor:pointer'+(FILTER===k?';border-color:var(--accent)':'')+'"><small>'+CLS[k][0]+'</small><b>'+r.counts[k]+' ta</b><div class="hint">'+CLS[k][1]+'</div></div>'}).join('')
    +'</div><div class="row" style="margin-top:12px"><button class="'+(FILTER==='all'?'':'ghost')+'" data-f="all">Hammasi</button><button class="'+(FILTER==='flag'?'':'ghost')+'" data-f="flag">⚠ Muammolilar</button></div>'
    +(r.incomplete?'<div class="msg warn" style="margin-top:12px">'+r.incomplete+' ta taomning retsepti yoki tannarxi to‘liq emas — ular guruhlanmadi. Retseptni to‘ldiring.</div>':'')
    +'</section>'
    +'<section class="card"><h2>Taomlar · foyda bo‘yicha</h2>'+(list.length?list.map(function(i){var c=i.cls?CLS[i.cls]:null;
      return '<div class="item"><b>'+esc(i.name)+(c?'<span class="tag '+c[2]+'">'+c[0]+'</span>':'')+'</b><span class="v">'+won(i.contribution)+'</span>'
        +'<small>'+i.sold.toLocaleString('en-US')+' ta sotildi · narx '+won(i.price)+' · tannarx '+won(i.cost)+(i.costPercent!=null?' ('+i.costPercent+'%)':'')+' · donasidan foyda '+won(i.unitMargin)
        +(i.flags.length?'<br><span style="color:var(--warn)">⚠ '+i.flags.map(esc).join(' · ')+'</span>':'')+'</small></div>'}).join(''):'<p class="hint">Bu guruhda taom yo‘q.</p>')+'</section>';
  body.querySelectorAll('[data-f]').forEach(function(el){el.addEventListener('click',function(){FILTER=el.dataset.f;render()})});
}
sel.addEventListener('change',load);days.addEventListener('change',load);load();
/* ---------- Taom tannarxi ---------- */
var RD=null,RQ='',EDIT=null;
function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)})}
function rpost(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
function num(v){var n=Number(String(v==null?'':v).replace(',','.').replace(/[^0-9.]/g,''));return isFinite(n)?n:0}
/* Pul maydonlari uchun: faqat raqamlar (minglik vergulini o'nlik nuqta deb o'qimaslik uchun). */
function money(v){return Number(String(v==null?'':v).replace(/[^0-9]/g,''))||0}
function pct(n){return n==null?'—':n+'%'}
function fcColor(n){return n==null?'var(--muted)':n<=30?'var(--ok)':n<=35?'var(--warn)':'var(--bad)'}
document.querySelectorAll('[data-m]').forEach(function(b){b.addEventListener('click',function(){var r=b.dataset.m==='rec';document.querySelectorAll('[data-m]').forEach(function(x){x.className=x===b?'':'ghost'});document.getElementById('rec').style.display=r?'grid':'none';document.getElementById('body').style.display=r?'none':'grid';document.getElementById('days').style.display=r?'none':''})});
document.getElementById('days').style.display='none';
function loadRecipes(){rpost({action:'recipes',branchId:sel.value}).then(function(x){if(!x.body.ok){document.getElementById('rec').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}RD=x.body;if(!EDIT)drawRecipes()})}
function drawRecipes(){
  var box=document.getElementById('rec'),f=RQ.toLowerCase();
  RD.categories.forEach(function(c){c.count=RD.recipes.filter(function(r){return r.categoryId===c.id}).length});
  if(RCAT&&!RD.categories.some(function(c){return c.id===RCAT}))RCAT='';
  var list=RD.recipes.filter(function(r){return (!f||r.name.toLowerCase().indexOf(f)>=0)&&(!RCAT||r.categoryId===RCAT)});
  var ready=RD.recipes.filter(function(r){return r.foodCostPercent!=null});
  var high=ready.filter(function(r){return r.foodCostPercent>35}),stale=RD.recipes.filter(function(r){return r.stale}),broken=RD.recipes.filter(function(r){return r.status!=='Tayyor'});
  var avg=ready.length?Math.round(ready.reduce(function(s,r){return s+r.foodCostPercent},0)/ready.length*10)/10:null;
  box.innerHTML='<section class="card"><div class="grid"><div class="kpi"><small>O‘rtacha food cost</small><b style="color:'+fcColor(avg)+'">'+pct(avg)+'</b><div class="hint">maqsad: '+Math.round(RD.target*100)+'% atrofida</div></div>'
    +'<div class="kpi"><small>35% dan yuqori</small><b style="color:var(--'+(high.length?'bad':'ok')+')">'+high.length+' ta</b></div>'
    +'<div class="kpi"><small>Tannarxi to‘liq emas</small><b style="color:var(--'+(broken.length?'warn':'ok')+')">'+broken.length+' ta</b></div></div>'
    +(stale.length?'<div class="msg warn" style="margin-top:12px">'+stale.length+' ta taomda eski narx “muzlatib” saqlangan — hisobotlarda foyda noto‘g‘ri chiqadi. Taomni ochib “Saqlash”ni bossangiz, hozirgi narxga o‘tadi.</div>':'')+'</section>'
    +'<section class="card"><div class="row" style="margin-bottom:10px"><input id="rq" placeholder="🔍 Taom qidirish" value="'+esc(RQ)+'" style="flex:1"><button id="rNew">+ Yangi taom</button><a href="/api/v2/kalkulyator" style="text-decoration:none"><button class="ghost" type="button">🧮 Kalkulyator</button></a></div>'
    +haloCatChips(RD.categories,RCAT,RD.recipes.length)
    +(RCAT&&rcatOf(RCAT).fallback&&list.length?'<p class="hint">Bu yerda kategoriyasi yo‘q taomlar. Har birining yonidan kategoriyasini tanlang yoki ⚙️ Kategoriyalar → avtomatik taqsimlash.</p>':'')
    +(list.length?(!RCAT&&!f?RD.categories.map(function(c){var items=list.filter(function(r){return r.categoryId===c.id});return items.length?'<div class="cat-head">'+esc(c.name)+' · '+items.length+'</div>'+items.map(function(r){return recRow(r,false)}).join(''):''}).join(''):list.map(function(r){return recRow(r,!RCAT)}).join('')):'<p class="hint">Taom topilmadi.</p>')+'</section>';
  box.querySelectorAll('[data-cat]').forEach(function(b){b.addEventListener('click',function(){RCAT=b.dataset.cat;drawRecipes()})});
  box.querySelectorAll('[data-catman]').forEach(function(b){b.addEventListener('click',function(){haloCategories({kind:'recipe',branch:sel.value,done:loadRecipes})})});
  box.querySelectorAll('[data-qc]').forEach(function(q2){q2.addEventListener('click',function(ev){ev.stopPropagation()});q2.addEventListener('change',function(){if(!q2.value)return;q2.disabled=true;
    fetch('/api/v2/kategoriya',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assign',kind:'recipe',branchId:sel.value,itemId:q2.dataset.qc,categoryId:q2.value})}).then(function(r){return r.json()}).then(function(x){if(!x.ok){alert(x.error||'Bo‘lmadi.');q2.disabled=false;return}loadRecipes()}).catch(function(){q2.disabled=false})})});
  var q=document.getElementById('rq');q.addEventListener('input',function(){RQ=q.value;var pos=q.selectionStart;drawRecipes();var n=document.getElementById('rq');n.focus();n.setSelectionRange(pos,pos)});
  document.getElementById('rNew').addEventListener('click',function(){openEditor(null)});
  box.querySelectorAll('[data-r]').forEach(function(el){el.addEventListener('click',function(){openEditor(RD.recipes.find(function(r){return r.id===el.dataset.r}))})});
}
var RCAT='';
function rcatOf(id){return RD.categories.find(function(c){return c.id===id})||{name:'',fallback:false}}
function recRow(r,showCat){var quick=rcatOf(r.categoryId).fallback&&RCAT===r.categoryId;
  return '<div class="item" data-r="'+esc(r.id)+'" style="cursor:pointer"><b>'+esc(r.name)+(r.stale?'<span class="tag warn">eski narx</span>':'')+(r.status!=='Tayyor'?'<span class="tag bad">'+esc(r.status)+'</span>':'')+'</b><span class="v" style="color:'+fcColor(r.foodCostPercent)+'">'+pct(r.foodCostPercent)+'</span>'
    +'<small>'+(showCat?esc(rcatOf(r.categoryId).name)+' · ':'')+'Narx '+won(r.salePrice)+' · tannarx '+(r.cost==null?'—':won(r.cost))+(r.margin!=null?' · foyda '+won(r.margin):'')+(r.stale?' · eski hisob: '+won(r.storedCost):'')+'</small>'
    +(quick?'<select data-qc="'+esc(r.id)+'" style="grid-column:1/-1;min-height:38px;margin-top:6px"><option value="">— kategoriyaga o‘tkazish —</option>'+RD.categories.filter(function(c){return !c.fallback}).map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'}).join('')+'</select>':'')+'</div>'}
function openEditor(r){
  EDIT={id:r?r.id:'',op:uuid(),name:r?r.name:'',categoryId:r?r.categoryId:(RCAT||''),salePrice:r?r.salePrice:'',
    delivery:r?Object.assign({},r.deliveryPrices):{},lines:r?r.lines.map(function(l){return {inventoryId:l.inventoryId,quantity:l.quantity,yieldPct:''}}):[{inventoryId:'',quantity:'',yieldPct:''}],
    extras:r?r.extraCosts.map(function(e){return {name:e.name,amount:e.amount}}):[]};
  drawEditor();window.scrollTo({top:0,behavior:'smooth'});
}
function editorCost(){
  var byId={};RD.products.forEach(function(p){byId[p.id]=p});var total=0,missing=false;
  EDIT.lines.forEach(function(l){var p=byId[l.inventoryId];if(!p){if(l.inventoryId||l.quantity)missing=true;return}var q=rawQty(l);if(!(p.unitCost>0))missing=true;total+=q*p.unitCost});
  EDIT.extras.forEach(function(e){total+=num(e.amount)});return {total:Math.round(total),missing:missing};
}
function rawQty(l){var q=num(l.quantity),y=num(l.yieldPct);return y>0&&y<100?Math.round(q/(y/100)*1000)/1000:q}
function drawEditor(){
  var box=document.getElementById('rec'),byId={};RD.products.forEach(function(p){byId[p.id]=p});
  var c=editorCost(),price=num(EDIT.salePrice),fc=price>0&&!c.missing?Math.round(c.total/price*1000)/10:null,sug=c.total>0?Math.ceil(c.total/RD.target/100)*100:null;
  box.innerHTML='<section class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">'+(EDIT.id?'Taomni tahrirlash':'Yangi taom')+'</h2><button class="ghost" id="eBack">← Ro‘yxat</button></div>'
    +'<label class="field" style="margin-top:12px"><span>Taom nomi</span><input id="eName" maxlength="120" value="'+esc(EDIT.name)+'"></label>'
    +(RD.categories.length?'<label class="field"><span>Kategoriya</span><select id="eCat">'+(EDIT.id?'':'<option value="">— avtomatik (nomiga qarab) —</option>')+RD.categories.map(function(k){return '<option value="'+esc(k.id)+'"'+(k.id===EDIT.categoryId?' selected':'')+'>'+esc(k.name)+'</option>'}).join('')+'</select></label>':'')
    +'</section>'
    +'<section class="card"><h2>Tarkibi (bir porsiya)</h2><p class="hint">Miqdorni ombor birligida yozing. Tozalashda chiqit bo‘lsa (go‘sht, piyoz…), “chiqish %”ni yozing — xom miqdor avtomatik hisoblanadi.</p>'
    +EDIT.lines.map(function(l,i){var p=byId[l.inventoryId],raw=rawQty(l);
      return '<div class="line" style="grid-template-columns:1fr"><select style="width:100%" data-li="'+i+'" data-lf="inventoryId"><option value="">— mahsulot —</option>'+(RD.inventoryCategories||[]).map(function(c){var items=RD.products.filter(function(x){return x.categoryId===c.id});return items.length?'<optgroup label="'+esc(c.name)+'">'+items.map(function(x){return '<option value="'+esc(x.id)+'"'+(x.id===l.inventoryId?' selected':'')+'>'+esc(x.name)+' ('+esc(x.unit)+')</option>'}).join('')+'</optgroup>':''}).join('')+'</select>'
        +'<div class="row"><label style="flex:1;min-width:0"><small style="color:var(--muted)">'+(num(l.yieldPct)?'Tayyor miqdor':'Miqdor')+(p?' ('+esc(p.unit)+')':'')+'</small><input data-li="'+i+'" data-lf="quantity" inputmode="decimal" value="'+esc(l.quantity)+'" style="width:100%"></label><label style="flex:1;min-width:0"><small style="color:var(--muted)">Chiqish % (ixtiyoriy)</small><input data-li="'+i+'" data-lf="yieldPct" inputmode="decimal" placeholder="masalan 80" value="'+esc(l.yieldPct)+'" style="width:100%"></label><button class="ghost" data-ld="'+i+'" style="flex:0 0 auto;min-height:40px;padding:6px 12px;align-self:flex-end">✕</button></div>'
        +(p?'<small style="color:'+(p.unitCost>0?'var(--muted)':'var(--bad)')+'">'+(raw!==num(l.quantity)?'Xom: '+raw+' '+esc(p.unit)+' · ':'')+(p.unitCost>0?'Narx: '+won(Math.round(raw*p.unitCost)):'Bu mahsulotning narxi yo‘q — avval kirim kiriting')+'</small>':'')+'</div>'}).join('')
    +'<button class="ghost" id="eAdd" style="margin-top:10px">+ Mahsulot qo‘shish</button></section>'
    +'<section class="card"><h2>Qo‘shimcha xarajat</h2><p class="hint">Qadoq, stakan, sous idishi, salfetka…</p>'
    +EDIT.extras.map(function(e,i){return '<div class="row" style="margin-bottom:8px"><input data-xi="'+i+'" data-xf="name" placeholder="Nomi" value="'+esc(e.name)+'" style="flex:2"><input data-xi="'+i+'" data-xf="amount" inputmode="numeric" placeholder="₩" value="'+esc(e.amount)+'" style="flex:1"><button class="ghost" data-xd="'+i+'" style="flex:0 0 auto;min-height:40px;padding:6px 12px">✕</button></div>'}).join('')
    +'<button class="ghost" id="eXadd">+ Qo‘shimcha xarajat</button></section>'
    +priceHelper(c)
    +'<section class="card"><h2>Narxlar</h2><label class="field"><span>Zalda / olib ketish narxi</span><input class="money" id="ePrice" inputmode="numeric" value="'+esc(EDIT.salePrice?Number(EDIT.salePrice).toLocaleString('en-US'):'')+'" placeholder="0"></label>'
    +'<div class="grid">'+RD.platforms.map(function(p){var v=EDIT.delivery[p.id];return '<label class="field" style="margin:0"><span>'+esc(p.shortLabel)+' narxi</span><input data-dp="'+esc(p.id)+'" inputmode="numeric" value="'+esc(v?Number(v).toLocaleString('en-US'):'')+'" placeholder="0"></label>'}).join('')+'</div></section>'
    +'<section class="card" style="position:sticky;bottom:calc(72px + env(safe-area-inset-bottom));z-index:3;padding:12px 14px"><div class="row" style="justify-content:space-between;align-items:center;gap:10px">'
    +'<div style="line-height:1.35"><b style="font-size:18px">'+(c.missing?'—':won(c.total))+'</b> <span style="color:'+fcColor(fc)+';font-weight:800">'+pct(fc)+'</span><br><small style="color:var(--muted)">Tavsiya narx ('+Math.round(RD.target*100)+'%): '+(sug&&!c.missing?won(sug):'—')+'</small></div>'
    +'<button id="eSave">Saqlash</button></div><div id="eMsg"></div></section>';
  box.querySelectorAll('[data-lf]').forEach(function(el){el.addEventListener(el.tagName==='SELECT'?'change':'input',function(){EDIT.lines[Number(el.dataset.li)][el.dataset.lf]=el.value;if(el.tagName==='SELECT')drawEditor();else refreshTotals()})});
  box.querySelectorAll('[data-ld]').forEach(function(b){b.addEventListener('click',function(){EDIT.lines.splice(Number(b.dataset.ld),1);drawEditor()})});
  box.querySelectorAll('[data-xf]').forEach(function(el){el.addEventListener('input',function(){EDIT.extras[Number(el.dataset.xi)][el.dataset.xf]=el.value;refreshTotals()})});
  box.querySelectorAll('[data-xd]').forEach(function(b){b.addEventListener('click',function(){EDIT.extras.splice(Number(b.dataset.xd),1);drawEditor()})});
  box.querySelectorAll('[data-dp]').forEach(function(el){el.addEventListener('input',function(){var v=money(el.value);EDIT.delivery[el.dataset.dp]=v;el.value=v?v.toLocaleString('en-US'):''})});
  document.getElementById('eAdd').addEventListener('click',function(){EDIT.lines.push({inventoryId:'',quantity:'',yieldPct:''});drawEditor()});
  document.getElementById('eXadd').addEventListener('click',function(){EDIT.extras.push({name:'',amount:''});drawEditor()});
  document.getElementById('eName').addEventListener('input',function(){EDIT.name=this.value});
  var cat=document.getElementById('eCat');if(cat)cat.addEventListener('change',function(){EDIT.categoryId=this.value});
  var pr=document.getElementById('ePrice');pr.addEventListener('input',function(){var v=money(pr.value);EDIT.salePrice=v;pr.value=v?v.toLocaleString('en-US'):'';refreshTotals()});
  document.getElementById('eBack').addEventListener('click',function(){EDIT=null;drawRecipes()});
  document.getElementById('eSave').addEventListener('click',saveEditor);
  bindPriceHelper();
}
/* ---------- Tannarxdan narx topish (30 / 35 / 40% va o'zingiz yozgan foiz) ---------- */
var PC={step:100,ded:false,custom:'',own:''};
function pcDeduct(){var d=RD.deduction||{taxPct:0,cardPct:0};return PC.ded?Math.round((d.taxPct+d.cardPct)*100)/100:0}
function priceHelper(c){
  if(c.missing||!(c.total>0))return '<section class="card"><h2>🧮 Tannarxdan narx topish</h2><p class="hint">Tarkibni to‘liq kiriting — tannarx chiqqach, 30%, 35%, 40% bo‘yicha narx shu yerda hisoblanadi.</p></section>';
  var ded=pcDeduct(),d=RD.deduction||{taxPct:0,cardPct:0},pcts=[30,35,40];var cp=pcP(PC.custom);if(cp>0&&cp<100&&pcts.indexOf(cp)<0)pcts.push(cp);
  return '<section class="card"><h2>🧮 Tannarxdan narx topish</h2><p class="hint">Tannarx <b style="color:var(--text)">'+won(c.total)+'</b> — sotuv narxining necha foizi bo‘lishini tanlang. Narx yuqoriga yaxlitlanadi.</p>'
    +'<div class="row" style="gap:8px;margin-bottom:10px">'+${JSON.stringify(PRICE_STEPS)}.map(function(o){return '<button class="'+(PC.step===o.step?'':'ghost')+'" data-pcs="'+o.step+'" style="min-height:36px;padding:4px 12px">'+o.label+'</button>'}).join('')+'</div>'
    +'<label class="row" style="gap:8px;margin-bottom:10px;font-size:14px"><input type="checkbox" id="pcDed" style="width:18px;height:18px;min-height:auto"'+(PC.ded?' checked':'')+'> Soliq ('+d.taxPct+'%) va karta ('+d.cardPct+'%) ushlanmasidan keyin hisoblash</label>'
    +'<table><tr><th>Tannarx foizi</th><th class="n">Narx</th><th class="n">Foyda</th><th></th></tr>'
    +pcts.map(function(p){var r=pcPriceForCost(c.total,p,ded,PC.step);if(!r)return '';return '<tr><td><b>'+pcFmt(p,2)+'%</b><br><small style="color:var(--muted)">aniq: '+pcFmt(r.exact,0)+' · haqiqiy '+pcFmt(r.realPct,1)+'%</small></td><td class="n" style="white-space:nowrap"><b>'+won(r.price)+'</b></td><td class="n" style="white-space:nowrap">'+won(r.profit)+'</td><td class="n"><button class="ghost" data-pcset="'+r.price+'" style="min-height:32px;padding:2px 10px">Narxga qo‘yish</button></td></tr>'}).join('')
    +(function(){var o=pcForPrice(c.total,PC.own,ded);if(!o)return '';return '<tr><td><b>O‘z narxim</b><br><small style="color:'+fcColor(o.realPct)+'">tannarx '+pcFmt(o.realPct,1)+'%</small></td><td class="n" style="white-space:nowrap"><b>'+won(o.price)+'</b></td><td class="n" style="white-space:nowrap">'+won(o.profit)+'</td><td class="n"><button class="ghost" data-pcset="'+o.price+'" style="min-height:32px;padding:2px 10px">Narxga qo‘yish</button></td></tr>'})()+'</table>'
    +'<label class="field" style="margin-top:10px"><span>Boshqa foiz</span><input id="pcCustom" inputmode="decimal" placeholder="masalan 33" value="'+esc(PC.custom)+'"></label>'
    +'<label class="field"><span>O‘z narxim (₩) — o‘zingiz yozing, tannarx foizi va foydani ko‘rsatadi</span><input id="pcOwn" inputmode="numeric" placeholder="masalan 15,900" value="'+esc(PC.own)+'"></label></section>'}
function pcRedraw(){var y=window.scrollY;drawEditor();window.scrollTo(0,y)}
function bindPriceHelper(){
  document.querySelectorAll('[data-pcs]').forEach(function(b){b.addEventListener('click',function(){PC.step=Number(b.dataset.pcs);pcRedraw()})});
  var dd=document.getElementById('pcDed');if(dd)dd.addEventListener('change',function(){PC.ded=dd.checked;pcRedraw()});
  var cu=document.getElementById('pcCustom');if(cu)cu.addEventListener('input',function(){PC.custom=cu.value;refreshTotals()});
  var ow=document.getElementById('pcOwn');if(ow)ow.addEventListener('input',function(){var v=pcNum(ow.value);ow.value=v?v.toLocaleString('en-US'):'';PC.own=ow.value;refreshTotals()});
  document.querySelectorAll('[data-pcset]').forEach(function(b){b.addEventListener('click',function(){EDIT.salePrice=Number(b.dataset.pcset);var y=window.scrollY;drawEditor();window.scrollTo(0,y);var pr=document.getElementById('ePrice');if(pr){pr.focus();pr.scrollIntoView({block:'center',behavior:'smooth'})}})});
}
${PRICE_CALC_JS}
var refreshTimer=null;
function refreshTotals(){clearTimeout(refreshTimer);refreshTimer=setTimeout(function(){var a=document.activeElement,k=a&&(a.dataset.lf?'[data-li="'+a.dataset.li+'"][data-lf="'+a.dataset.lf+'"]':a.dataset.xf?'[data-xi="'+a.dataset.xi+'"][data-xf="'+a.dataset.xf+'"]':a.id?'#'+a.id:null),pos=a&&a.selectionStart;var y=window.scrollY;drawEditor();window.scrollTo(0,y);if(k){var n=document.querySelector(k);if(n){n.focus();try{n.setSelectionRange(pos,pos)}catch(e){}}}},500)}
function saveEditor(){
  var msg=document.getElementById('eMsg'),btn=document.getElementById('eSave');
  var lines=EDIT.lines.filter(function(l){return l.inventoryId||l.quantity});
  if(lines.some(function(l){return !l.inventoryId||!(rawQty(l)>0)})){msg.innerHTML='<div class="msg bad">Har bir qatorda mahsulot va miqdorni yozing.</div>';return}
  btn.disabled=true;
  rpost({action:'saveRecipe',branchId:sel.value,id:EDIT.id,operationId:EDIT.op,name:EDIT.name,categoryId:EDIT.categoryId,salePrice:Math.round(num(EDIT.salePrice)),
    deliveryPrices:EDIT.delivery,ingredients:lines.map(function(l){return {inventoryId:l.inventoryId,quantity:rawQty(l)}}),extraCosts:EDIT.extras.filter(function(e){return e.name||num(e.amount)}).map(function(e){return {name:e.name,amount:Math.round(num(e.amount))}})}).then(function(x){btn.disabled=false;
    if(!x.body.ok){msg.innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}
    RD=x.body;var r=RD.recipes.find(function(q){return q.id===x.body.id});openEditor(r);document.getElementById('eMsg').innerHTML='<div class="msg ok">✓ Saqlandi — tannarx hozirgi narxlar bilan hisoblandi</div>'});
}
sel.addEventListener('change',function(){EDIT=null;loadRecipes()});loadRecipes();

`,
  });
}
