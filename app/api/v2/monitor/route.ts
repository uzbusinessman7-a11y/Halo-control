import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { categoryIdOf, categoryList } from "../../../core/categories";
import {
  adminView, deleteItem, deleteScreen, DigitalMenuError, linkVariant, moveItem, pruneMedia, putMedia, readDm, recipePrices, saveItem, saveScreen,
  saveSettings, toggleItem, tvMemoClear, writeDm, type DmConfig, type RecipePrice,
} from "../../../core/digital-menu";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";

/**
 * HALO V2 — «Monitor menyu»: televizordagi reklama menyuni boshqarish (faqat rahbar).
 * Taom, variant va narx, rasm, "sotildi"/yashirish, SET MENU, aksiya va ekran sozlamalari.
 * Narx menyudagi taomga bog'lansa — o'sha yerdan olinadi. Bu sahifa savdo, ombor, kassa va retseptlarga yozmaydi.
 */
declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
const PAGE_PATH = "/api/v2/monitor";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const database = () => {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
};

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
    const db = database();
    // Menyudagi taomlar faqat O'QILADI (nomi va sotuv narxi) — biznes ma'lumotiga hech narsa yozilmaydi.
    const { state } = await readHaloState(branchId);
    const recipes: RecipePrice[] = recipePrices((state as Record<string, unknown>).recipes)
      .map((recipe) => ({ ...recipe, categoryId: categoryIdOf(state as Record<string, unknown>, "recipe", { categoryId: recipe.categoryId }) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const categories = categoryList(state as Record<string, unknown>, "recipe").map((category) => ({ id: category.id, name: category.name }));
    const reply = (config: DmConfig, extra: Record<string, unknown> = {}) => json({ ok: true, menu: adminView(config, recipes), recipes, categories, ...extra });
    const current = await readDm(db, branchId);

    if (body.action === "load") return reply(current.config, { saved: current.saved });
    if (body.action === "upload") {
      const imageId = await putMedia(db, branchId, body.mime, body.data);
      return json({ ok: true, imageId, url: `/api/v2/tv?media=${imageId}` });
    }
    let next: DmConfig;
    const extra: Record<string, unknown> = {};
    if (body.action === "saveItem") {
      const out = saveItem(current.config, body, recipes);
      next = out.config; extra.id = out.id; extra.created = out.created;
    } else if (body.action === "deleteItem") next = deleteItem(current.config, body.id);
    else if (body.action === "toggle") next = toggleItem(current.config, body.id, body.field, body.value);
    else if (body.action === "move") next = moveItem(current.config, body.id, body.direction);
    else if (body.action === "link") next = linkVariant(current.config, body, recipes);
    else if (body.action === "saveSettings") next = saveSettings(current.config, body);
    else if (body.action === "saveScreen") { const out = saveScreen(current.config, body); next = out.config; extra.screenId = out.id; }
    else if (body.action === "deleteScreen") next = deleteScreen(current.config, body.id);
    else return json({ error: "Noma’lum amal." }, 400);
    await writeDm(db, branchId, next);
    tvMemoClear();
    await pruneMedia(db, branchId, next).catch(() => 0);
    return reply(next, { ...extra, saved: true });
  } catch (error) {
    if (error instanceof DigitalMenuError) return json({ error: error.message }, error.status);
    if (error instanceof Error && /filial/i.test(error.message)) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Monitor menyu", active: "menyu", heading: "Monitor menyu",
    subtitle: "Televizordagi reklama menyu: taomlar, narxlar, rasmlar",
    headerRight: '<select id="branch"></select>',
    body: `<section class="card"><div class="row" id="scr"></div><div id="scrInfo" style="margin-top:12px"></div></section>
<div id="form"></div>
<section class="card" id="list"><p class="hint">Yuklanmoqda…</p></section>
<section class="card"><details id="setBox"><summary style="font-size:15px;font-weight:700;color:var(--text)">⚙️ Ekran sozlamalari: yozuvlar, SET MENU, aksiya</summary><div id="settings" style="margin-top:14px"></div></details></section>`,
    script: `
var BRANCHES=${boot},MENU=null,RECIPES=[],CATS=[],SCR='',F=null,ST=null;
var DESIGNS=[['navbat','Navbat — taomlar bittalab katta, oxirida umumiy (tavsiya)'],['kino','Kino — katta surat va ro‘yxat'],['vitrina','Vitrina — hamma taom surati yonma-yon'],['yorliq','Qora yorliq — rasmsiz ro‘yxat'],['halqa','Halqa — dumaloq surat va ro‘yxat']];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return Number(n||0).toLocaleString('en-US')+' ₩'}
function money(v){return Number(String(v==null?'':v).replace(/[^0-9]/g,''))||0}
function byId(id){return document.getElementById(id)}
var sel=byId('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function post(b){b.branchId=sel.value;return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
function take(b){MENU=b.menu;RECIPES=b.recipes||RECIPES;CATS=b.categories||CATS;if(!MENU.screens.some(function(s){return s.id===SCR}))SCR=MENU.screens[0].id;draw()}
function load(){post({action:'load'}).then(function(x){if(!x.body.ok){byId('list').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}F=null;ST=null;byId('form').innerHTML='';take(x.body)})}
function tvUrl(id){return location.origin+'/tv/'+id+(sel.value!=='main'?'?b='+encodeURIComponent(sel.value):'')}
function recipe(id){return RECIPES.find(function(r){return r.id===id})}
function thumb(src,name,size){return '<span style="position:relative;display:inline-grid;place-items:center;width:'+size+'px;height:'+size+'px;border-radius:50%;overflow:hidden;background:var(--card-2);border:1px solid var(--line);vertical-align:middle;flex:0 0 auto;font-weight:800;color:var(--muted)">'+esc(String(name||'?').trim().charAt(0))+(src?'<img src="'+esc(src)+'" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">':'')+'</span>'}
function act(body,after){post(body).then(function(x){if(!x.body.ok){alert(x.body.error||'Bo‘lmadi.');draw();return}take(x.body);if(after)after(x.body)})}

function draw(){
  byId('scr').innerHTML=MENU.screens.map(function(s){var n=MENU.items.filter(function(i){return i.screen===s.id}).length;return '<button class="'+(s.id===SCR?'':'ghost')+'" data-s="'+esc(s.id)+'">📺 '+esc(s.title)+' · '+n+'</button>'}).join('')+'<button class="ghost" id="scrNew">+ Ekran</button>';
  document.querySelectorAll('[data-s]').forEach(function(b){b.addEventListener('click',function(){SCR=b.dataset.s;draw()})});
  byId('scrNew').addEventListener('click',function(){var t=prompt('Yangi ekran nomi (masalan Combo):');if(!t)return;act({action:'saveScreen',title:t},function(b){SCR=b.screenId;draw()})});
  var url=tvUrl(SCR),scNow=MENU.screens.find(function(x){return x.id===SCR});
  byId('scrInfo').innerHTML='<label class="field"><span>Bu ekranning ko‘rinishi</span><select id="dSel">'+DESIGNS.map(function(d){return '<option value="'+d[0]+'"'+(scNow.design===d[0]?' selected':'')+'>'+d[1]+'</option>'}).join('')+'</select></label>'
    +'<div class="row" style="gap:8px;margin-bottom:14px"><span style="font-size:14px;color:var(--muted)">Avval sinab ko‘rish:</span>'+DESIGNS.map(function(d){return '<button class="ghost" data-prev="'+d[0]+'" style="min-height:36px;padding:4px 12px">'+d[1].split(' — ')[0]+'</button>'}).join('')+'</div><div id="dMsg"></div>'
    +'<div class="row"><button id="open">Ekranni ochish</button><button class="ghost" id="copy">Havolani nusxalash</button></div>'
    +'<p class="hint" style="margin:10px 0 0">Televizor brauzerida shu manzilni oching: <b style="color:var(--text);word-break:break-all">'+esc(url)+'</b><br>Parol so‘ralmaydi. Bu yerda o‘zgartirganingiz ekranda 30 soniya ichida o‘zi yangilanadi.</p>'
    +(MENU.unlinked?'<div class="msg warn" style="margin-top:10px"><b>'+MENU.unlinked+'</b> ta narx menyudagi taomga bog‘lanmagan — ekranda shu yerda yozilgan narx ko‘rinadi. Bog‘lasangiz, narx menyudan olinadi va u yerda o‘zgarsa ekranda ham o‘zgaradi.</div>':'<div class="msg ok" style="margin-top:10px">✓ Hamma narx menyudan olinmoqda</div>')
    +'<div id="copyMsg"></div>';
  byId('open').addEventListener('click',function(){window.open(url,'_blank','noopener')});
  byId('dSel').addEventListener('change',function(){var d=this.value;post({action:'saveScreen',id:SCR,title:scNow.title,design:d}).then(function(x){if(!x.body.ok){byId('dMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}take(x.body);byId('dMsg').innerHTML='<div class="msg ok" style="margin-bottom:10px">✓ Ko‘rinish o‘zgardi. Televizorda 30 soniya ichida almashadi.</div>'})});
  document.querySelectorAll('[data-prev]').forEach(function(b){b.addEventListener('click',function(){window.open(url+(url.indexOf('?')<0?'?':'&')+'d='+b.dataset.prev,'_blank','noopener')})});
  byId('copy').addEventListener('click',function(){var ok=function(){byId('copyMsg').innerHTML='<div class="msg ok">✓ Nusxa olindi</div>'};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(url).then(ok,function(){prompt('Nusxalang:',url)});else prompt('Nusxalang:',url)});
  var items=MENU.items.filter(function(i){return i.screen===SCR});
  byId('list').innerHTML='<div class="row" style="justify-content:space-between;margin-bottom:6px"><h2 style="margin:0">Taomlar</h2><button id="iNew">+ Yangi taom</button></div>'
    +(items.length?items.map(function(it,ix){
      return '<div class="item"><b style="display:flex;align-items:center;gap:10px">'+thumb(it.image,it.name,44)+'<span>'+esc(it.name)+(it.badge?'<span class="tag ok">'+esc(it.badge)+'</span>':'')+(it.visible?'':'<span class="tag warn">yashirin</span>')+(it.soldOut?'<span class="tag bad">sotildi</span>':'')+'</span></b>'
        +'<span class="v" style="white-space:nowrap"><button class="ghost" data-up="'+esc(it.id)+'" style="min-height:34px;padding:2px 10px"'+(ix===0?' disabled':'')+' aria-label="Yuqoriga">↑</button> <button class="ghost" data-down="'+esc(it.id)+'" style="min-height:34px;padding:2px 10px"'+(ix===items.length-1?' disabled':'')+' aria-label="Pastga">↓</button></span>'
        +'<small>'+it.variants.map(function(v){return esc(v.label||'Narx')+' <b style="font-size:13px;color:var(--text)">'+won(v.shownPrice)+'</b>'+(v.linked?' <span style="color:var(--ok)">✓</span>':' <span style="color:var(--warn)">qo‘lda</span>')}).join(' · ')+'</small>'
        +'<div class="row" style="grid-column:1/-1;margin-top:8px;gap:8px"><button class="ghost" data-sold="'+esc(it.id)+'" style="min-height:36px;padding:4px 12px">'+(it.soldOut?'Sotuvga qaytarish':'Sotildi deb belgilash')+'</button><button class="ghost" data-vis="'+esc(it.id)+'" style="min-height:36px;padding:4px 12px">'+(it.visible?'Yashirish':'Ko‘rsatish')+'</button><button class="ghost" data-edit="'+esc(it.id)+'" style="min-height:36px;padding:4px 12px">✏️ Tahrirlash</button></div></div>'}).join('')
      :'<p class="hint">Bu ekranda hali taom yo‘q. «+ Yangi taom» ni bosing.</p>');
  byId('iNew').addEventListener('click',function(){openForm(null)});
  var find=function(id){return MENU.items.find(function(i){return i.id===id})};
  document.querySelectorAll('[data-up]').forEach(function(b){b.addEventListener('click',function(){act({action:'move',id:b.dataset.up,direction:-1})})});
  document.querySelectorAll('[data-down]').forEach(function(b){b.addEventListener('click',function(){act({action:'move',id:b.dataset.down,direction:1})})});
  document.querySelectorAll('[data-sold]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;act({action:'toggle',id:b.dataset.sold,field:'soldOut',value:!find(b.dataset.sold).soldOut})})});
  document.querySelectorAll('[data-vis]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;act({action:'toggle',id:b.dataset.vis,field:'visible',value:!find(b.dataset.vis).visible})})});
  document.querySelectorAll('[data-edit]').forEach(function(b){b.addEventListener('click',function(){openForm(find(b.dataset.edit))})});
  drawSettings();
}

/* ---------- rasm: brauzerda kichraytiriladi, keyin yuklanadi ---------- */
function pickImage(done,msg){var inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.addEventListener('change',function(){var f=inp.files&&inp.files[0];if(!f)return;msg.innerHTML='<p class="hint">Rasm tayyorlanmoqda…</p>';
    var img=new Image(),src=URL.createObjectURL(f);
    img.onerror=function(){URL.revokeObjectURL(src);msg.innerHTML='<div class="msg bad">Bu rasm ochilmadi. JPG yoki PNG rasm tanlang.</div>'};
    img.onload=function(){var s=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*s)),h=Math.max(1,Math.round(img.naturalHeight*s));
      var c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.drawImage(img,0,0,w,h);URL.revokeObjectURL(src);
      var type='image/webp',q=0.86,out=c.toDataURL(type,q);
      if(out.indexOf('data:image/webp')!==0){type='image/jpeg';x.globalCompositeOperation='destination-over';x.fillStyle='#0a0908';x.fillRect(0,0,w,h);out=c.toDataURL(type,q)}
      while(out.length*0.75>820000&&q>0.4){q-=0.12;out=c.toDataURL(type,q)}
      post({action:'upload',mime:type,data:out.slice(out.indexOf(',')+1)}).then(function(r){if(!r.body.ok){msg.innerHTML='<div class="msg bad">'+esc(r.body.error||'Rasm yuklanmadi.')+'</div>';return}msg.innerHTML='<div class="msg ok">✓ Rasm yuklandi. «Saqlash»ni bosing.</div>';done(r.body.imageId,r.body.url)})};
    img.src=src});
  inp.click()}

/* ---------- taom formasi ---------- */
function openForm(it){
  F=it?{id:it.id,name:it.name,description:it.description,screen:it.screen,badge:it.badge,visible:it.visible,soldOut:it.soldOut,soldOutText:it.soldOutText,image:it.image,imageId:undefined,
      variants:it.variants.map(function(v){return {id:v.id,label:v.label,recipeId:v.missing?'':v.recipeId,price:v.price||v.shownPrice,suggestion:v.suggestion}})}
    :{id:'',name:'',description:'',screen:SCR,badge:'',visible:true,soldOut:false,soldOutText:'SOTILDI',image:'',imageId:undefined,variants:[{id:'',label:'',recipeId:'',price:0,suggestion:''}]};
  drawForm();byId('form').scrollIntoView({behavior:'smooth',block:'start'})}
function recipeOptions(chosen){var out='<option value="">— narxni o‘zim yozaman —</option>',used={};
  CATS.forEach(function(c){var list=RECIPES.filter(function(r){return r.categoryId===c.id});if(!list.length)return;
    out+='<optgroup label="'+esc(c.name)+'">'+list.map(function(r){used[r.id]=1;return '<option value="'+esc(r.id)+'"'+(r.id===chosen?' selected':'')+'>'+esc(r.name)+' — '+won(r.price)+'</option>'}).join('')+'</optgroup>'});
  var rest=RECIPES.filter(function(r){return !used[r.id]});
  if(rest.length)out+='<optgroup label="Boshqa">'+rest.map(function(r){return '<option value="'+esc(r.id)+'"'+(r.id===chosen?' selected':'')+'>'+esc(r.name)+' — '+won(r.price)+'</option>'}).join('')+'</optgroup>';
  return out}
function drawForm(){var box=byId('form');
  box.innerHTML='<section class="card" style="background:var(--card-2)"><h2>'+(F.id?'Tahrirlash — '+esc(F.name):'Yangi taom')+'</h2>'
    +'<div class="row" style="margin-bottom:12px">'+thumb(F.image,F.name,84)+'<button class="ghost" id="fPic">'+(F.image?'Rasmni almashtirish':'Rasm tanlash')+'</button>'+(F.image?'<button class="ghost" id="fPicDel">Rasmni olib tashlash</button>':'')+'</div><div id="fPicMsg"></div>'
    +'<label class="field"><span>Taom nomi</span><input id="fName" maxlength="60" value="'+esc(F.name)+'"></label>'
    +'<label class="field"><span>Tarkibi yoki qisqa tavsif (ixtiyoriy)</span><input id="fDesc" maxlength="160" value="'+esc(F.description)+'" placeholder="Meat · Cabbage · Tomato"></label>'
    +'<div class="row"><label class="field" style="flex:1"><span>Qaysi ekranda</span><select id="fScr">'+MENU.screens.map(function(s){return '<option value="'+esc(s.id)+'"'+(s.id===F.screen?' selected':'')+'>'+esc(s.title)+'</option>'}).join('')+'</select></label>'
    +'<label class="field" style="flex:1"><span>Belgi (ixtiyoriy)</span><input id="fBadge" maxlength="16" value="'+esc(F.badge)+'" placeholder="NEW, HIT"></label></div>'
    +'<h3 style="font-size:15px;margin:6px 0 4px">Narxlar</h3><p class="hint">Bir nechta turi bo‘lsa (chicken, lamb yoki 450 g, 800 g) — har biriga alohida qator. Menyudagi taomni tanlasangiz, narx o‘sha yerdan olinadi.</p>'
    +F.variants.map(function(v,i){var r=recipe(v.recipeId),sug=!v.recipeId&&v.suggestion?recipe(v.suggestion):null;
      return '<div style="border-top:1px solid var(--line);padding:10px 0"><div class="row" style="align-items:flex-end"><label class="field" style="flex:1 1 140px;margin:0"><span>Turi</span><input data-vl="'+i+'" maxlength="40" value="'+esc(v.label)+'" placeholder="Chicken, 450 gram"></label>'
        +'<label class="field" style="flex:2 1 220px;margin:0"><span>Menyudagi taom</span><select data-vr="'+i+'">'+recipeOptions(v.recipeId)+'</select></label>'
        +'<label class="field" style="flex:1 1 120px;margin:0"><span>Narxi (₩)</span><input data-vp="'+i+'" inputmode="numeric" value="'+(r?r.price.toLocaleString('en-US'):(v.price?Number(v.price).toLocaleString('en-US'):''))+'"'+(r?' disabled':'')+' style="text-align:right;font-weight:700"></label>'
        +(F.variants.length>1?'<button class="ghost" data-vx="'+i+'" aria-label="Qatorni olib tashlash" style="min-height:44px">✕</button>':'')+'</div>'
        +(r?'<p class="hint" style="margin:6px 0 0">Narx menyudan olinadi'+(v.price&&v.price!==r.price?' · ekranda oldin '+won(v.price)+' edi':'')+'</p>':'')
        +(sug?'<p class="hint" style="margin:6px 0 0">Menyuda o‘xshashi bor: <b style="color:var(--text)">'+esc(sug.name)+' — '+won(sug.price)+'</b> <button class="ghost" data-vs="'+i+'" style="min-height:32px;padding:2px 10px">Shunga bog‘lash</button></p>':'')+'</div>'}).join('')
    +'<button class="ghost" id="fAdd" style="margin:4px 0 14px">+ Yana bir tur</button>'
    +'<label class="row" style="gap:8px;margin-bottom:10px"><input type="checkbox" id="fVis" style="width:18px;height:18px;min-height:auto"'+(F.visible?' checked':'')+'> Ekranda ko‘rinsin</label>'
    +'<div class="row" style="margin-bottom:14px"><label class="row" style="gap:8px"><input type="checkbox" id="fSold" style="width:18px;height:18px;min-height:auto"'+(F.soldOut?' checked':'')+'> Hozir tugagan — ekranda</label><input id="fSoldT" maxlength="20" value="'+esc(F.soldOutText)+'" style="width:140px" aria-label="Tugaganda ko‘rinadigan yozuv"><span>deb chiqadi</span></div>'
    +'<div class="row"><button id="fSave">Saqlash</button><button class="ghost" id="fCancel">Bekor</button>'+(F.id?'<button class="ghost" id="fDel" style="color:var(--bad)">Monitor menyusidan o‘chirish</button>':'')+'</div><div id="fMsg"></div></section>';
  var keep=function(){F.name=byId('fName').value;F.description=byId('fDesc').value;F.screen=byId('fScr').value;F.badge=byId('fBadge').value;F.visible=byId('fVis').checked;F.soldOut=byId('fSold').checked;F.soldOutText=byId('fSoldT').value;
    box.querySelectorAll('[data-vl]').forEach(function(e){F.variants[Number(e.dataset.vl)].label=e.value});
    box.querySelectorAll('[data-vp]').forEach(function(e){if(!e.disabled)F.variants[Number(e.dataset.vp)].price=money(e.value)})};
  box.querySelectorAll('[data-vp]').forEach(function(e){e.addEventListener('input',function(){var n=money(e.value);e.value=n?n.toLocaleString('en-US'):''})});
  box.querySelectorAll('[data-vr]').forEach(function(e){e.addEventListener('change',function(){keep();F.variants[Number(e.dataset.vr)].recipeId=e.value;drawForm()})});
  box.querySelectorAll('[data-vs]').forEach(function(e){e.addEventListener('click',function(){keep();var v=F.variants[Number(e.dataset.vs)];v.recipeId=v.suggestion;drawForm()})});
  box.querySelectorAll('[data-vx]').forEach(function(e){e.addEventListener('click',function(){keep();F.variants.splice(Number(e.dataset.vx),1);drawForm()})});
  byId('fAdd').addEventListener('click',function(){keep();if(F.variants.length>=6){byId('fMsg').innerHTML='<div class="msg bad">Bitta taomda 6 tadan ko‘p tur bo‘lmaydi.</div>';return}F.variants.push({id:'',label:'',recipeId:'',price:0,suggestion:''});drawForm()});
  byId('fPic').addEventListener('click',function(){keep();pickImage(function(id,url){F.imageId=id;F.image=url;drawForm();byId('fPicMsg').innerHTML='<div class="msg ok">✓ Rasm yuklandi. «Saqlash»ni bosing.</div>'},byId('fPicMsg'))});
  var pd=byId('fPicDel');if(pd)pd.addEventListener('click',function(){keep();F.imageId='';F.image='';drawForm()});
  byId('fCancel').addEventListener('click',function(){F=null;box.innerHTML=''});
  var del=byId('fDel');if(del)del.addEventListener('click',function(){if(!confirm(F.name+' monitor menyusidan o‘chirilsinmi? HALO Control menyusidagi taomga tegilmaydi.'))return;post({action:'deleteItem',id:F.id}).then(function(x){if(!x.body.ok){byId('fMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}F=null;box.innerHTML='<div class="msg ok" style="margin-bottom:10px">✓ O‘chirildi</div>';take(x.body)})});
  byId('fSave').addEventListener('click',function(){keep();var btn=this;btn.disabled=true;
    var body={action:'saveItem',id:F.id,name:F.name,description:F.description,screen:F.screen,badge:F.badge,visible:F.visible,soldOut:F.soldOut,soldOutText:F.soldOutText,
      variants:F.variants.map(function(v){return {id:v.id,label:v.label,recipeId:v.recipeId,price:v.price}})};
    if(F.imageId!==undefined)body.imageId=F.imageId;
    post(body).then(function(x){btn.disabled=false;if(!x.body.ok){byId('fMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}
      SCR=F.screen;F=null;box.innerHTML='<div class="msg ok" style="margin-bottom:10px">✓ Saqlandi. Ekranda 30 soniya ichida ko‘rinadi.</div>';take(x.body)})});
}

/* ---------- sozlamalar ---------- */
function drawSettings(){var box=byId('settings');if(!MENU)return;
  if(!ST)ST={setImage:MENU.setOffer.image,setImageId:undefined,promoImage:MENU.promotion.image,promoImageId:undefined};
  var r=MENU.restaurant,s=MENU.setOffer,p=MENU.promotion,t=MENU.thanks,sc=MENU.screens.find(function(x){return x.id===SCR});
  var inp=function(id,label,value,extra){return '<label class="field" style="flex:1 1 200px"><span>'+label+'</span><input id="'+id+'" value="'+esc(value)+'"'+(extra||'')+'></label>'};
  var chk=function(id,label,on){return '<label class="row" style="gap:8px;margin-bottom:10px"><input type="checkbox" id="'+id+'" style="width:18px;height:18px;min-height:auto"'+(on?' checked':'')+'> '+label+'</label>'};
  var num=' inputmode="numeric" style="text-align:right"';
  box.innerHTML='<h3 style="font-size:15px;margin:0 0 8px">«'+esc(sc.title)+'» ekrani</h3><div class="row">'+inp('xTitle','Ekran nomi',sc.title,' maxlength="24"')+inp('xPer','Bir sahifada nechta taom (3–10)',sc.itemsPerPage,num)+inp('xSpot','Har bir taom necha soniya turadi',sc.spotlightSeconds,num)+inp('xOver','Umumiy menyu necha soniya turadi (Navbat)',sc.overviewSeconds,num)+'</div>'
    +'<div class="row" style="margin-bottom:18px"><button id="xSave">Ekranni saqlash</button><button class="ghost" id="xDel" style="color:var(--bad)">Ekranni o‘chirish</button></div><div id="xMsg"></div>'
    +'<h3 style="font-size:15px;margin:0 0 8px">Tepadagi va pastdagi yozuvlar</h3><div class="row">'+inp('rName','Nomi',r.name,' maxlength="24"')+inp('rSlogan','Shior',r.slogan,' maxlength="80"')+'</div><div class="row">'+inp('rHours','Ish vaqti',r.hours,' maxlength="60"')+inp('rPhone','Telefon',r.phone,' maxlength="30"')+'</div>'+inp('rFooter','Pastdagi yozuv',r.footer,' maxlength="80"')
    +'<h3 style="font-size:15px;margin:14px 0 8px">SET MENU (pastda, chapda)</h3>'+chk('sVis','Ekranda ko‘rinsin',s.visible)+'<div class="row">'+inp('sTitle','Sarlavha',s.title,' maxlength="40"')+inp('sDesc','Tarkibi',s.description,' maxlength="120"')+inp('sPrice','Narxi (₩)',s.price?s.price.toLocaleString('en-US'):'',num)+'</div>'
    +'<div class="row" style="margin-bottom:6px">'+thumb(ST.setImage,s.title,56)+'<button class="ghost" id="sPic">Rasm tanlash</button>'+(ST.setImage?'<button class="ghost" id="sPicDel">Rasmni olib tashlash</button>':'')+'</div><div id="sPicMsg"></div>'
    +'<h3 style="font-size:15px;margin:14px 0 8px">Aksiya (katta ko‘rinish o‘rnida vaqti-vaqti bilan chiqadi)</h3>'+chk('pVis','Aksiya yoqilgan',p.visible)
    +'<div class="row">'+inp('pEye','Ustki yozuv',p.eyebrow,' maxlength="40"')+inp('pTitle','Sarlavha',p.title,' maxlength="40"')+inp('pBadge','Belgi',p.badge,' maxlength="12"')+'</div>'+inp('pDesc','Tarkibi',p.description,' maxlength="120"')
    +'<div class="row">'+inp('pPrice','Aksiya narxi (₩)',p.price?p.price.toLocaleString('en-US'):'',num)+inp('pOld','Eski narxi (₩)',p.oldPrice?p.oldPrice.toLocaleString('en-US'):'',num)+'</div>'
    +'<div class="row">'+inp('pFrom','Qachondan (bo‘sh — hozirdan)',p.startsAt,' type="datetime-local"')+inp('pTo','Qachongacha (bo‘sh — cheklanmagan)',p.endsAt,' type="datetime-local"')+'</div>'
    +'<div class="row">'+inp('pInt','Har necha soniyada chiqadi',p.intervalSeconds,num)+inp('pDur','Necha soniya turadi',p.durationSeconds,num)+'</div>'
    +'<div class="row" style="margin-bottom:6px">'+thumb(ST.promoImage,p.title,56)+'<button class="ghost" id="pPic">Rasm tanlash</button>'+(ST.promoImage?'<button class="ghost" id="pPicDel">Rasmni olib tashlash</button>':'')+'</div><div id="pPicMsg"></div>'
    +'<h3 style="font-size:15px;margin:14px 0 8px">Rahmat yozuvi (pastda, o‘ngda almashib turadi)</h3>'+chk('tVis','Ko‘rinsin',t.visible)+'<div class="row">'+inp('tTitle','Sarlavha',t.title,' maxlength="60"')+inp('tMsg','Matn',t.message,' maxlength="160"')+'</div>'
    +'<div class="row">'+inp('tInt','Har necha soniyada chiqadi',t.intervalSeconds,num)+inp('tDur','Necha soniya turadi',t.durationSeconds,num)+'</div>'
    +'<button id="gSave">Sozlamalarni saqlash</button><div id="gMsg"></div>';
  ['sPrice','pPrice','pOld'].forEach(function(id){var e=byId(id);e.addEventListener('input',function(){var n=money(e.value);e.value=n?n.toLocaleString('en-US'):''})});
  var v=function(id){return byId(id).value};
  byId('xSave').addEventListener('click',function(){post({action:'saveScreen',id:SCR,title:v('xTitle'),itemsPerPage:money(v('xPer')),spotlightSeconds:money(v('xSpot')),overviewSeconds:money(v('xOver'))}).then(function(x){if(!x.body.ok){byId('xMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}take(x.body);byId('xMsg').innerHTML='<div class="msg ok">✓ Saqlandi</div>'})});
  byId('xDel').addEventListener('click',function(){if(!confirm('«'+sc.title+'» ekrani o‘chirilsinmi?'))return;post({action:'deleteScreen',id:SCR}).then(function(x){if(!x.body.ok){byId('xMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}take(x.body)})});
  byId('sPic').addEventListener('click',function(){pickImage(function(id,url){ST.setImageId=id;ST.setImage=url;byId('sPicMsg').innerHTML='<div class="msg ok">✓ Rasm yuklandi. «Sozlamalarni saqlash»ni bosing.</div>'},byId('sPicMsg'))});
  byId('pPic').addEventListener('click',function(){pickImage(function(id,url){ST.promoImageId=id;ST.promoImage=url;byId('pPicMsg').innerHTML='<div class="msg ok">✓ Rasm yuklandi. «Sozlamalarni saqlash»ni bosing.</div>'},byId('pPicMsg'))});
  var sd=byId('sPicDel');if(sd)sd.addEventListener('click',function(){ST.setImageId='';ST.setImage='';byId('sPicMsg').innerHTML='<div class="msg warn">Rasm olib tashlanadi. «Sozlamalarni saqlash»ni bosing.</div>'});
  var pdel=byId('pPicDel');if(pdel)pdel.addEventListener('click',function(){ST.promoImageId='';ST.promoImage='';byId('pPicMsg').innerHTML='<div class="msg warn">Rasm olib tashlanadi. «Sozlamalarni saqlash»ni bosing.</div>'});
  byId('gSave').addEventListener('click',function(){var btn=this;btn.disabled=true;
    var set={visible:byId('sVis').checked,title:v('sTitle'),description:v('sDesc'),price:money(v('sPrice'))};if(ST.setImageId!==undefined)set.imageId=ST.setImageId;
    var promo={visible:byId('pVis').checked,eyebrow:v('pEye'),title:v('pTitle'),badge:v('pBadge'),description:v('pDesc'),price:money(v('pPrice')),oldPrice:money(v('pOld')),startsAt:v('pFrom'),endsAt:v('pTo'),intervalSeconds:money(v('pInt')),durationSeconds:money(v('pDur'))};if(ST.promoImageId!==undefined)promo.imageId=ST.promoImageId;
    post({action:'saveSettings',restaurant:{name:v('rName'),slogan:v('rSlogan'),hours:v('rHours'),phone:v('rPhone'),footer:v('rFooter')},setOffer:set,promotion:promo,
      thanks:{visible:byId('tVis').checked,title:v('tTitle'),message:v('tMsg'),intervalSeconds:money(v('tInt')),durationSeconds:money(v('tDur'))}}).then(function(x){btn.disabled=false;
      if(!x.body.ok){byId('gMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}ST=null;take(x.body);byId('gMsg').innerHTML='<div class="msg ok">✓ Saqlandi. Ekranda 30 soniya ichida ko‘rinadi.</div>'})});
}
sel.addEventListener('change',load);load();
`,
  });
}
