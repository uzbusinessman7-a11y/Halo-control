import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { CatalogError, productList, saveProduct } from "../../../core/catalog";
import { InventoryCountingError, saveAccountingCount } from "../../../lib/inventory-counting";
import { LedgerError } from "../../../core/ledger";
import { runStockBridge } from "../../../core/stock-bridge";
import { avtReport } from "../../../core/stock";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/ombor";
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
    const today = seoulToday();
    if (body.action === "products") {
      const { state } = await readHaloState(branchId);
      return json({ ok: true, today, products: productList(state as Record<string, unknown>, today) });
    }
    if (body.action === "saveProduct") {
      const mutation = await mutateHaloState((state) => saveProduct(state as Record<string, unknown>, body), 5, branchId, "Rahbar",
        `Ombor mahsuloti saqlandi · ${String(body.name || "").slice(0, 60)}`, "Ombor (yangi)");
      return json({ ok: true, today, ...mutation.result, products: productList(mutation.state as Record<string, unknown>, today) });
    }
    if (body.action === "count") {
      const mutation = await mutateHaloState((state) => saveAccountingCount(state as Record<string, unknown>, { counts: body.counts, date: today, operationId: body.operationId }, { id: "owner", name: "Rahbar" }),
        5, branchId, "Rahbar", "Ombor sanog‘i saqlandi", "Ombor (yangi)");
      return json({ ok: true, today, ...mutation.result, products: productList(mutation.state as Record<string, unknown>, today) });
    }
    const to = String(body.to || today);
    const from = String(body.from || new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10));
    const scope = { tenantId: TENANT_ID, branchId };
    const { state } = await readHaloState(branchId);
    const bridge = await runStockBridge(database(), scope, state as Record<string, unknown>, today);
    const avt = await avtReport(database(), scope, from, to);
    return json({ ok: true, from, to, bridge, avt });
  } catch (error) {
    if (error instanceof CatalogError || error instanceof InventoryCountingError) return json({ error: error.message }, (error as { status?: number }).status || 400);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Ombor", active: "ombor", heading: "Ombor",
    subtitle: "Mahsulotlar, sanoq va yo‘qotish nazorati",
    headerRight: '<select id="branch"></select>',
    body: `<section class="card"><div class="row" id="otabs"><button data-o="list">📦 Mahsulotlar</button><button class="ghost" data-o="count">🔢 Sanash</button><button class="ghost" data-o="avt">📉 Yo‘qotish nazorati</button></div></section>
<div id="oList" style="display:grid;gap:16px"></div>
<div id="oCount" style="display:none;gap:16px"></div>
<div id="oAvt" style="display:none;gap:16px">
<section class="card"><h2>Nazariy va haqiqiy sarf</h2>
<p class="hint">Retsept bo'yicha qancha ketishi kerak edi va sanoqda qancha kam chiqdi. Eng katta yo'qotish — birinchi.</p>
<div class="row"><input type="date" id="from"> — <input type="date" id="to"><button id="go">Ko'rsatish</button></div>
<div id="avt" style="margin-top:12px"></div></section>
<section class="card"><h2>Hujjatsiz qoldiq o'zgarishlari</h2>
<p class="hint">Eski tizimdagi qoldiq harakatlar yig'indisiga teng emas — ya'ni qoldiq harakat yozilmasdan o'zgartirilgan.</p>
<div id="drift"></div></section></div>`,
    script: `
var BRANCHES=${boot};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function qty(n,u){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:3})+' '+esc(u)}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function load(){
  document.getElementById('avt').innerHTML='<p class="hint">Yuklanmoqda…</p>';
  fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({branchId:sel.value,from:document.getElementById('from').value||undefined,to:document.getElementById('to').value||undefined})})
  .then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}}).then(function(res){
    if(!res.ok){document.getElementById('avt').innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    document.getElementById('from').value=res.from;document.getElementById('to').value=res.to;
    var loss=res.avt.reduce(function(s,r){return s+Math.min(0,r.varianceValue)},0);
    var max=Math.max.apply(null,res.avt.map(function(r){return Math.abs(r.varianceValue)}).concat([1]));
    document.getElementById('avt').innerHTML='<div class="total '+(loss<0?'bad':'ok')+'">'+(loss<0?'Kamomad: '+won(loss):'Kamomad yo‘q ✓')+'</div>'
      +(res.avt.length?res.avt.map(function(r){var bad=r.countVariance<0,pct=r.variancePercent;
        return '<div class="item"><b>'+esc(r.name)+'</b><span class="v '+(bad?'bad':r.countVariance>0?'warn':'ok')+'">'+(r.countVariance?won(r.varianceValue):'✓')+'</span>'
          +(bad?'<div class="bar"><i style="width:'+Math.round(Math.abs(r.varianceValue)/max*100)+'%"></i></div>':'')
          +'<small>Nazariy (retsept): '+qty(r.theoretical,r.unit)+' · chiqit: '+qty(r.recordedWaste,r.unit)+' · sanoq farqi: '+qty(r.countVariance,r.unit)+(pct!=null?' ('+pct+'%)':'')+' · kirim: '+qty(r.receipts,r.unit)+'</small></div>'}).join(''):'<p class="hint">Bu davrda harakat yo‘q.</p>');
    var drift=res.bridge.items.filter(function(i){return i.difference!==0&&!i.expenseOnly});
    var warn=[];if(res.bridge.changed.length)warn.push(res.bridge.changed.length+' ta eski harakat keyin o‘zgartirilgan');if(res.bridge.invalid.length)warn.push(res.bridge.invalid.length+' ta harakat yozilmadi');if(res.bridge.unknownItem.length)warn.push(res.bridge.unknownItem.length+' ta harakatning mahsuloti topilmadi');
    document.getElementById('drift').innerHTML=(warn.length?'<div class="msg bad" style="margin-bottom:10px">⚠ '+warn.map(esc).join(' · ')+'</div>':'')
      +(drift.length?drift.map(function(i){return '<div class="item"><b>'+esc(i.name)+'</b><span class="v bad">'+qty(-i.difference,i.unit)+'</span><small>Eski tizim qoldig‘i: '+qty(i.oldStock,i.unit)+' · harakatlar bo‘yicha: '+qty(i.ledgerStock,i.unit)+'</small></div>'}).join(''):'<div class="msg ok">✓ Barcha mahsulot qoldig‘i harakatlar bilan mos</div>');
  });
}
document.getElementById('go').addEventListener('click',load);sel.addEventListener('change',load);load();
/* ---------- Mahsulotlar va sanoq ---------- */
var PRODUCTS=[],OTAB='list',Q='',CNT={},OPID='';
function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)})}
function post(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
function showTab(t){OTAB=t;document.querySelectorAll('[data-o]').forEach(function(b){b.className=b.dataset.o===t?'':'ghost'});
  document.getElementById('oList').style.display=t==='list'?'grid':'none';document.getElementById('oCount').style.display=t==='count'?'grid':'none';document.getElementById('oAvt').style.display=t==='avt'?'grid':'none';
  if(t==='list')drawList();if(t==='count'){OPID=uuid();CNT={};drawCount()}}
document.querySelectorAll('[data-o]').forEach(function(b){b.addEventListener('click',function(){showTab(b.dataset.o)})});
function loadProducts(){post({action:'products',branchId:sel.value}).then(function(x){if(!x.body.ok){document.getElementById('oList').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}PRODUCTS=x.body.products;if(OTAB==='list')drawList();if(OTAB==='count')drawCount()})}
function drawList(){
  var box=document.getElementById('oList'),stock=PRODUCTS.filter(function(p){return !p.vegetable});
  var low=stock.filter(function(p){return p.low}),value=stock.reduce(function(s,p){return s+p.value},0);
  var f=Q.toLowerCase(),list=PRODUCTS.filter(function(p){return !f||p.name.toLowerCase().indexOf(f)>=0});
  box.innerHTML='<section class="card"><div class="grid"><div class="kpi"><small>Ombordagi mahsulot qiymati</small><b>'+won(value)+'</b></div><div class="kpi"><small>Mahsulot turlari</small><b>'+stock.length+' ta</b></div><div class="kpi"><small>Kam qolgan</small><b style="color:var(--'+(low.length?'bad':'ok')+')">'+low.length+' ta</b></div></div></section>'
    +'<section class="card"><div class="row" style="margin-bottom:10px"><input id="pq" placeholder="🔍 Qidirish" value="'+esc(Q)+'" style="flex:1"><button id="pNew">+ Yangi mahsulot</button></div><div id="pForm"></div>'
    +(list.length?list.map(function(p){return '<div class="item" data-edit="'+esc(p.id)+'" style="cursor:pointer"><b>'+esc(p.name)+(p.low?'<span class="tag bad">kam qoldi</span>':'')+(p.vegetable?'<span class="tag warn">xarajat sifatida</span>':'')+'</b><span class="v'+(p.low?' bad':'')+'">'+(p.vegetable?'—':qty(p.stock,p.unit))+'</span>'
      +'<small>'+(p.vegetable?'Sanalmaydi, xaridi xarajatga yoziladi':'Minimum: '+qty(p.minStock,p.unit)+' · narx: '+(p.unitCost?won(Math.round(p.unitCost*(p.unit==='g'||p.unit==='ml'?1000:1)))+' / '+(p.unit==='g'?'kg':p.unit==='ml'?'litr':esc(p.unit)):'—')+' · qiymati '+won(p.value))+(p.lastReceipt?' · oxirgi kirim '+esc(p.lastReceipt):'')+'</small></div>'}).join(''):'<p class="hint">Mahsulot topilmadi.</p>')+'</section>';
  var pq=document.getElementById('pq');pq.addEventListener('input',function(){Q=pq.value;var pos=pq.selectionStart;drawList();var n=document.getElementById('pq');n.focus();n.setSelectionRange(pos,pos)});
  document.getElementById('pNew').addEventListener('click',function(){productForm(null)});
  box.querySelectorAll('[data-edit]').forEach(function(el){el.addEventListener('click',function(){productForm(PRODUCTS.find(function(p){return p.id===el.dataset.edit}))})});
}
function productForm(p){
  var box=document.getElementById('pForm'),op=uuid();
  var units=['g','ml','dona','kg','litr'];
  box.innerHTML='<div class="card" style="background:var(--card-2);margin-bottom:12px"><h2>'+(p?'Tahrirlash — '+esc(p.name):'Yangi mahsulot')+'</h2>'
    +'<label class="field"><span>Nomi</span><input id="fName" maxlength="100" value="'+esc(p?p.name:'')+'"></label>'
    +'<div class="row"><label class="field" style="flex:1"><span>Hisob birligi</span><select id="fUnit"'+(p&&p.movements?' disabled':'')+'>'+units.map(function(u){return '<option'+(p&&p.unit===u?' selected':'')+'>'+u+'</option>'}).join('')+'</select></label>'
    +'<label class="field" style="flex:1"><span>Minimum qoldiq</span><input id="fMin" inputmode="decimal" value="'+esc(p?p.minStock:'')+'" placeholder="0"></label></div>'
    +'<div class="row"><label class="field" style="flex:1"><span>Qadoq nomi (ixtiyoriy)</span><input id="fPack" maxlength="30" value="'+esc(p?p.packageName:'')+'" placeholder="quti, qop, banka…"></label>'
    +'<label class="field" style="flex:1"><span>Qadoqda nechta birlik</span><input id="fPer" inputmode="decimal" value="'+esc(p&&p.unitsPerPackage?p.unitsPerPackage:'')+'" placeholder="masalan 1000"></label></div>'
    +(p&&p.movements?'<p class="hint">Harakatlari bor — birlikni o‘zgartirib bo‘lmaydi.</p>':'')
    +'<div class="row"><button id="fSave">Saqlash</button><button class="ghost" id="fCancel">Bekor</button></div><div id="fMsg"></div></div>';
  box.scrollIntoView({behavior:'smooth',block:'start'});
  document.getElementById('fCancel').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('fSave').addEventListener('click',function(){
    var btn=this;btn.disabled=true;
    post({action:'saveProduct',branchId:sel.value,id:p?p.id:'',operationId:op,name:document.getElementById('fName').value,unit:document.getElementById('fUnit').value,minStock:Number(document.getElementById('fMin').value.replace(',','.')||0),packageName:document.getElementById('fPack').value,unitsPerPackage:Number(document.getElementById('fPer').value.replace(',','.')||0)}).then(function(x){btn.disabled=false;
      if(!x.body.ok){document.getElementById('fMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}
      PRODUCTS=x.body.products;drawList();document.getElementById('pForm').innerHTML='<div class="msg ok" style="margin-bottom:10px">✓ '+(x.body.created?'Mahsulot qo‘shildi':'Saqlandi')+'</div>'});
  });
}
function drawCount(){
  var box=document.getElementById('oCount'),list=PRODUCTS.filter(function(p){return !p.vegetable});
  var filled=Object.keys(CNT).filter(function(k){return CNT[k]!==''}).length;
  box.innerHTML='<section class="card"><h2>Bugungi sanoq</h2><p class="hint">Tortib yoki sanab, haqiqiy qoldiqni yozing. Hamma mahsulotni birdan sanash shart emas. Saqlangach, farq ombor tuzatishi bo‘lib yoziladi va “Yo‘qotish nazorati”da ko‘rinadi.</p>'
    +list.map(function(p){return '<div class="list-row" style="grid-template-columns:1fr minmax(110px,150px)"><div><b>'+esc(p.name)+'</b><br><small style="color:var(--muted)">'+esc(p.unit)+(p.packageName&&p.unitsPerPackage>1?' · 1 '+esc(p.packageName)+' = '+p.unitsPerPackage+' '+esc(p.unit):'')+'</small></div><input data-c="'+esc(p.id)+'" inputmode="decimal" placeholder="'+esc(p.unit)+'" value="'+esc(CNT[p.id]||'')+'" style="text-align:right;font-weight:700;width:100%"></div>'}).join('')
    +'</section><section class="card sticky-total" style="position:sticky;bottom:calc(76px + env(safe-area-inset-bottom))"><div class="row" style="justify-content:space-between"><span><b id="cN">'+filled+'</b> ta mahsulot sanaldi</span><button id="cSave">Sanoqni saqlash</button></div><div id="cMsg"></div></section>';
  box.querySelectorAll('[data-c]').forEach(function(i){i.addEventListener('input',function(){CNT[i.dataset.c]=i.value.replace(',','.').replace(/[^0-9.]/g,'');document.getElementById('cN').textContent=Object.keys(CNT).filter(function(k){return CNT[k]!==''}).length})});
  document.getElementById('cSave').addEventListener('click',function(){
    var counts=Object.keys(CNT).filter(function(k){return CNT[k]!==''}).map(function(k){return {inventoryId:k,actualStock:Number(CNT[k])}});
    var msg=document.getElementById('cMsg');if(!counts.length){msg.innerHTML='<div class="msg bad">Kamida bitta mahsulotni sanang.</div>';return}
    if(!confirm(counts.length+' ta mahsulot sanog‘i saqlansinmi? Qoldiq sanalgan miqdorga tenglashtiriladi.'))return;
    var btn=this;btn.disabled=true;
    post({action:'count',branchId:sel.value,operationId:OPID,counts:counts}).then(function(x){btn.disabled=false;
      if(!x.body.ok){msg.innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}
      var adj=(x.body.adjustments||[]).filter(function(a){return Math.abs(a.quantity)>0.000001});
      PRODUCTS=x.body.products;CNT={};OPID=uuid();drawCount();
      document.getElementById('cMsg').innerHTML='<div class="msg '+(adj.length?'warn':'ok')+'">'+(adj.length?'Saqlandi. Farq chiqqan mahsulotlar: '+adj.map(function(a){var p=PRODUCTS.find(function(q){return q.id===a.inventoryId});return esc(p?p.name:a.inventoryId)+' '+qty(a.quantity,p?p.unit:'')}).join(', '):'✓ Saqlandi — hamma qoldiq mos')+'</div>'});
  });
}
sel.addEventListener('change',loadProducts);loadProducts();

`,
  });
}
