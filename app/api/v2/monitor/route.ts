import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { categoryIdOf, categoryList } from "../../../core/categories";
import {
  adminView, deleteItem, deleteScreen, DigitalMenuError, importImage, linkMany, linkVariant, moveItem, pruneMedia, putMedia, readDm, recipePrices, saveItem, saveScreen,
  saveSettings, toggleItem, tvMemoClear, writeDm, type DmConfig, type RecipePrice,
} from "../../../core/digital-menu";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";

/**
 * HALO V2 — «Monitor menyu»: televizordagi reklama menyuni boshqarish (faqat rahbar).
 * Taom, variant (TYPE / SIZE / narx), rasm, "sotildi"/yashirish, SET MENU, kun aksiyasi va ekran vaqtlari.
 * Narx menyudagi taomga bog'lansa — o'sha yerdan olinadi. Bu sahifa savdo, ombor, kassa va retseptlarga yozmaydi.
 * Ekranning ko'rinishi bu yerda o'zgartirilmaydi — u eski monitor menyusidagi bilan bir xil (app/core/tv-page.ts).
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
    else if (body.action === "linkMany") next = linkMany(current.config, body, recipes);
    else if (body.action === "saveSettings") next = saveSettings(current.config, body);
    else if (body.action === "saveScreen") { const out = saveScreen(current.config, body); next = out.config; extra.screenId = out.id; }
    else if (body.action === "deleteScreen") next = deleteScreen(current.config, body.id);
    // Eski saytdagi bitta rasmni o'qib, HALO Control bazasiga o'zgarishsiz saqlaydi (eski saytga yozilmaydi).
    else if (body.action === "importImage") next = await importImage(db, branchId, current.config, body);
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
<section class="card"><details id="setBox"><summary style="font-size:15px;font-weight:700;color:var(--text)">⚙️ Ekran sozlamalari: vaqtlar, kun aksiyasi, SET MENU, yozuvlar</summary><div id="settings" style="margin-top:14px"></div></details></section>`,
    script: `
var BRANCHES=${boot},MENU=null,RECIPES=[],CATS=[],SCR='',F=null,ST=null,IMPMSG='',LINKOPEN=false,LINKMSG='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return Number(n||0).toLocaleString('en-US')+' ₩'}
function money(v){return Number(String(v==null?'':v).replace(/[^0-9]/g,''))||0}
function byId(id){return document.getElementById(id)}
var sel=byId('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function post(b){b.branchId=sel.value;return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
function take(b){MENU=b.menu;RECIPES=b.recipes||RECIPES;CATS=b.categories||CATS;if(!MENU.screens.some(function(s){return s.id===SCR}))SCR=MENU.screens[0].id;draw()}
function load(){post({action:'load'}).then(function(x){if(!x.body.ok){byId('list').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}F=null;ST=null;IMPMSG='';LINKMSG='';LINKOPEN=false;byId('form').innerHTML='';take(x.body)})}
function tvUrl(id){return location.origin+'/menu?screen='+encodeURIComponent(id)+(sel.value!=='main'?'&branch='+encodeURIComponent(sel.value):'')}
function recipe(id){return RECIPES.find(function(r){return r.id===id})}
function thumb(src,name,size){return '<span style="position:relative;display:inline-grid;place-items:center;width:'+size+'px;height:'+size+'px;border-radius:50%;overflow:hidden;background:var(--card-2);border:1px solid var(--line);vertical-align:middle;flex:0 0 auto;font-weight:800;color:var(--muted)">'+esc(String(name||'?').trim().charAt(0))+(src?'<img src="'+esc(src)+'" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">':'')+'</span>'}
function act(body,after){post(body).then(function(x){if(!x.body.ok){alert(x.body.error||'Bo‘lmadi.');draw();return}take(x.body);if(after)after(x.body)})}
function vname(v){return [v.label,v.size].filter(function(t){return t}).join(' ')||'Narx'}

/* ---------- bog'lanmagan narxlar: menyudagi mos taomlar ---------- */
function linkRows(){var out=[];MENU.items.forEach(function(it){it.variants.forEach(function(v){if(v.linked||!v.suggestion)return;var r=recipe(v.suggestion);if(!r)return;out.push({item:it,v:v,r:r,same:r.price===v.shownPrice})})});return out}
function linkBox(){
  if(!MENU.unlinked)return '<div class="msg ok" style="margin-top:10px">✓ Hamma narx HALO Control menyusidan olinmoqda</div>';
  var rows=linkRows(),rest=MENU.unlinked-rows.length;
  var h='<div class="msg warn" style="margin-top:10px"><b>'+MENU.unlinked+'</b> ta narx menyudagi taomga bog‘lanmagan — ekranda shu yerda yozilgan narx ko‘rinadi. Bog‘lasangiz, narx HALO Control menyusidan olinadi va u yerda o‘zgarsa ekranda ham o‘zi o‘zgaradi.';
  if(rows.length&&!LINKOPEN)h+='<div style="margin-top:8px"><button id="lkOpen">Menyudan mos taomlarni ko‘rish ('+rows.length+' ta)</button></div>';
  if(rows.length&&LINKOPEN){
    h+='<div style="margin-top:10px">'+rows.map(function(x,i){return '<label class="row" style="gap:8px;align-items:flex-start;margin-bottom:8px"><input type="checkbox" data-lk="'+i+'" style="width:18px;height:18px;min-height:auto;margin-top:2px"'+(x.same?' checked':'')+'><span><b style="color:var(--text)">'+esc(x.item.name)+' · '+esc(vname(x.v))+'</b> → '+esc(x.r.name)+' — '+won(x.r.price)+(x.same?'':' <span style="color:var(--bad)">(ekranda hozir '+won(x.v.shownPrice)+' — bog‘lansa '+won(x.r.price)+' bo‘ladi)</span>')+'</span></label>'}).join('')
      +'<p class="hint" style="margin:4px 0 8px">Narxi bir xil bo‘lganlari belgilab qo‘yildi. Narxi farq qiladiganlarini o‘zingiz tekshirib belgilang.</p><div class="row"><button id="lkDo">Belgilanganlarni bog‘lash</button><button class="ghost" id="lkClose">Yopish</button></div></div>';
  }
  if(rest>0)h+='<p class="hint" style="margin:8px 0 0">'+rest+' ta narxga menyuda aniq mos taom topilmadi — taomni «Tahrirlash» orqali o‘zingiz bog‘lang.</p>';
  return h+'</div>'+LINKMSG;
}
function bindLink(){
  var o=byId('lkOpen');if(o)o.addEventListener('click',function(){LINKOPEN=true;LINKMSG='';draw()});
  var c=byId('lkClose');if(c)c.addEventListener('click',function(){LINKOPEN=false;draw()});
  var d=byId('lkDo');if(d)d.addEventListener('click',function(){var rows=linkRows(),links=[];document.querySelectorAll('[data-lk]').forEach(function(e){if(e.checked){var x=rows[Number(e.dataset.lk)];links.push({itemId:x.item.id,variantId:x.v.id,recipeId:x.r.id})}});
    if(!links.length){alert('Hech narsa belgilanmagan.');return}d.disabled=true;
    post({action:'linkMany',links:links}).then(function(x){if(!x.body.ok){alert(x.body.error||'Bo‘lmadi.');d.disabled=false;return}LINKOPEN=false;LINKMSG='<div class="msg ok" style="margin-top:10px">✓ '+links.length+' ta narx menyuga bog‘landi</div>';take(x.body)})});
}

/* ---------- eski saytdagi rasmlarni ko'chirish ---------- */
function importBox(){
  var n=MENU.imports.length;
  if(!n)return IMPMSG;
  return '<div class="msg warn" style="margin-top:10px"><b>'+n+' ta rasm hali eski saytda turibdi.</b> Ekranda ko‘rinyapti, lekin eski sayt o‘chirilsa yo‘qoladi. Ko‘chirsangiz, rasmlar HALO Control’da saqlanadi — sifati o‘zgarmaydi, eski saytga tegilmaydi.<div style="margin-top:8px"><button id="imp">Rasmlarni HALO Control’ga ko‘chirish</button></div><div id="impMsg"></div></div>'+IMPMSG;
}
function bindImport(){
  var b=byId('imp');if(!b)return;
  b.addEventListener('click',function(){var list=MENU.imports.slice(),done=0,bad=[],last=null;b.disabled=true;
    var step=function(i){
      if(i>=list.length){
        IMPMSG=(done?'<div class="msg ok" style="margin-top:10px">✓ '+done+' ta rasm HALO Control’ga ko‘chirildi</div>':'')+(bad.length?'<div class="msg bad" style="margin-top:10px">'+bad.length+' ta rasm ko‘chmadi: '+esc(bad[0].why)+' Birozdan keyin qayta bosing yoki rasmni «Tahrirlash» orqali o‘zingiz yuklang.</div>':'');
        if(last)take(last);else draw();return}
      byId('impMsg').innerHTML='<p class="hint" style="margin:8px 0 0">Ko‘chirilmoqda: '+(i+1)+' / '+list.length+' — '+esc(list[i].name)+'</p>';
      post({action:'importImage',kind:list[i].kind,id:list[i].id}).then(function(x){if(x.body.ok){done+=1;last=x.body}else bad.push({name:list[i].name,why:x.body.error||'Xatolik.'});step(i+1)})};
    step(0)});
}

function draw(){
  byId('scr').innerHTML=MENU.screens.map(function(s){var n=MENU.items.filter(function(i){return i.screen===s.id}).length;return '<button class="'+(s.id===SCR?'':'ghost')+'" data-s="'+esc(s.id)+'">📺 '+esc(s.title)+' · '+n+'</button>'}).join('')+'<button class="ghost" id="scrNew">+ Ekran</button>';
  document.querySelectorAll('[data-s]').forEach(function(b){b.addEventListener('click',function(){SCR=b.dataset.s;ST=null;draw()})});
  byId('scrNew').addEventListener('click',function(){var t=prompt('Yangi ekran nomi (masalan Combo):');if(!t)return;act({action:'saveScreen',title:t},function(b){SCR=b.screenId;ST=null;draw()})});
  var url=tvUrl(SCR);
  byId('scrInfo').innerHTML='<div class="row"><button id="open">Ekranni ochish</button><button class="ghost" id="copy">Havolani nusxalash</button></div>'
    +'<p class="hint" style="margin:10px 0 0">Televizor brauzerida shu manzilni oching: <b style="color:var(--text);word-break:break-all">'+esc(url)+'</b><br>Parol so‘ralmaydi. Ko‘rinishi eski monitor menyusidagi bilan bir xil. Bu yerda o‘zgartirganingiz ekranda 15 soniya ichida o‘zi yangilanadi.</p>'
    +'<div id="copyMsg"></div>'+importBox()+linkBox();
  byId('open').addEventListener('click',function(){window.open(url,'_blank','noopener')});
  byId('copy').addEventListener('click',function(){var ok=function(){byId('copyMsg').innerHTML='<div class="msg ok">✓ Nusxa olindi</div>'};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(url).then(ok,function(){prompt('Nusxalang:',url)});else prompt('Nusxalang:',url)});
  bindImport();bindLink();
  var items=MENU.items.filter(function(i){return i.screen===SCR});
  byId('list').innerHTML='<div class="row" style="justify-content:space-between;margin-bottom:6px"><h2 style="margin:0">Taomlar</h2><button id="iNew">+ Yangi taom</button></div>'
    +(items.length?items.map(function(it,ix){
      return '<div class="item"><b style="display:flex;align-items:center;gap:10px">'+thumb(it.image,it.name,44)+'<span>'+esc(it.name)+(it.badge?'<span class="tag ok">'+esc(it.badge)+'</span>':'')+(it.visible?'':'<span class="tag warn">yashirin</span>')+(it.soldOut?'<span class="tag bad">sotildi</span>':'')+'</span></b>'
        +'<span class="v" style="white-space:nowrap"><button class="ghost" data-up="'+esc(it.id)+'" style="min-height:34px;padding:2px 10px"'+(ix===0?' disabled':'')+' aria-label="Yuqoriga">↑</button> <button class="ghost" data-down="'+esc(it.id)+'" style="min-height:34px;padding:2px 10px"'+(ix===items.length-1?' disabled':'')+' aria-label="Pastga">↓</button></span>'
        +'<small>'+it.variants.map(function(v){return esc(vname(v))+' <b style="font-size:13px;color:var(--text)">'+won(v.shownPrice)+'</b>'+(v.active?'':' <span style="color:var(--warn)">yashirin</span>')+(v.linked?' <span style="color:var(--ok)">✓</span>':' <span style="color:var(--warn)">qo‘lda</span>')}).join(' · ')+'</small>'
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

/* ---------- rasm: brauzerda kichraytiriladi (JPG — eski televizor brauzerlari ham ochadi), keyin yuklanadi ---------- */
function pickImage(done,msg){var inp=document.createElement('input');inp.type='file';inp.accept='image/*';
  inp.addEventListener('change',function(){var f=inp.files&&inp.files[0];if(!f)return;msg.innerHTML='<p class="hint">Rasm tayyorlanmoqda…</p>';
    var img=new Image(),src=URL.createObjectURL(f);
    img.onerror=function(){URL.revokeObjectURL(src);msg.innerHTML='<div class="msg bad">Bu rasm ochilmadi. JPG yoki PNG rasm tanlang.</div>'};
    img.onload=function(){var s=Math.min(1,1280/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*s)),h=Math.max(1,Math.round(img.naturalHeight*s));
      var c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.fillStyle='#000';x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);URL.revokeObjectURL(src);
      var type='image/jpeg',q=0.9,out=c.toDataURL(type,q);
      while(out.length*0.75>820000&&q>0.4){q-=0.1;out=c.toDataURL(type,q)}
      post({action:'upload',mime:type,data:out.slice(out.indexOf(',')+1)}).then(function(r){if(!r.body.ok){msg.innerHTML='<div class="msg bad">'+esc(r.body.error||'Rasm yuklanmadi.')+'</div>';return}msg.innerHTML='<div class="msg ok">✓ Rasm yuklandi. «Saqlash»ni bosing.</div>';done(r.body.imageId,r.body.url)})};
    img.src=src});
  inp.click()}

/* ---------- taom formasi ---------- */
function openForm(it){
  F=it?{id:it.id,name:it.name,description:it.description,screen:it.screen,badge:it.badge,visible:it.visible,soldOut:it.soldOut,soldOutText:it.soldOutText,image:it.image,imageId:undefined,
      variants:it.variants.map(function(v){return {id:v.id,label:v.label,size:v.size,active:v.active,recipeId:v.missing?'':v.recipeId,price:v.price||v.shownPrice,suggestion:v.suggestion}})}
    :{id:'',name:'',description:'',screen:SCR,badge:'',visible:true,soldOut:false,soldOutText:'SOTILDI',image:'',imageId:undefined,variants:[{id:'',label:'',size:'',active:true,recipeId:'',price:0,suggestion:''}]};
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
    +'<h3 style="font-size:15px;margin:6px 0 4px">Narxlar</h3><p class="hint">Ekranda har qator shunday chiqadi: <b style="color:var(--text)">TYPE | SIZE | PRICE</b> — masalan «Tandir lavash | chicken | ₩12,900» yoki «Suyaksiz | 450 gram | ₩11,900». Menyudagi taomni tanlasangiz, narx o‘sha yerdan olinadi.</p>'
    +F.variants.map(function(v,i){var r=recipe(v.recipeId),sug=!v.recipeId&&v.suggestion?recipe(v.suggestion):null;
      return '<div style="border-top:1px solid var(--line);padding:10px 0"><div class="row" style="align-items:flex-end"><label class="field" style="flex:1 1 130px;margin:0"><span>Turi (TYPE)</span><input data-vl="'+i+'" maxlength="40" value="'+esc(v.label)+'" placeholder="Tandir lavash"></label>'
        +'<label class="field" style="flex:1 1 110px;margin:0"><span>O‘lchami (SIZE)</span><input data-vz="'+i+'" maxlength="40" value="'+esc(v.size)+'" placeholder="chicken, 450 gram"></label>'
        +'<label class="field" style="flex:2 1 220px;margin:0"><span>Menyudagi taom</span><select data-vr="'+i+'">'+recipeOptions(v.recipeId)+'</select></label>'
        +'<label class="field" style="flex:1 1 120px;margin:0"><span>Narxi (₩)</span><input data-vp="'+i+'" inputmode="numeric" value="'+(r?r.price.toLocaleString('en-US'):(v.price?Number(v.price).toLocaleString('en-US'):''))+'"'+(r?' disabled':'')+' style="text-align:right;font-weight:700"></label>'
        +(F.variants.length>1?'<button class="ghost" data-vx="'+i+'" aria-label="Qatorni olib tashlash" style="min-height:44px">✕</button>':'')+'</div>'
        +'<label class="row" style="gap:8px;margin:8px 0 0"><input type="checkbox" data-va="'+i+'" style="width:18px;height:18px;min-height:auto"'+(v.active?' checked':'')+'> Bu qator ekranda ko‘rinsin</label>'
        +(r?'<p class="hint" style="margin:6px 0 0">Narx menyudan olinadi'+(v.price&&v.price!==r.price?' · ekranda oldin '+won(v.price)+' edi':'')+'</p>':'')
        +(sug?'<p class="hint" style="margin:6px 0 0">Menyuda o‘xshashi bor: <b style="color:var(--text)">'+esc(sug.name)+' — '+won(sug.price)+'</b> <button class="ghost" data-vs="'+i+'" style="min-height:32px;padding:2px 10px">Shunga bog‘lash</button></p>':'')+'</div>'}).join('')
    +'<button class="ghost" id="fAdd" style="margin:4px 0 14px">+ Yana bir qator</button>'
    +'<label class="row" style="gap:8px;margin-bottom:10px"><input type="checkbox" id="fVis" style="width:18px;height:18px;min-height:auto"'+(F.visible?' checked':'')+'> Ekranda ko‘rinsin</label>'
    +'<div class="row" style="margin-bottom:14px"><label class="row" style="gap:8px"><input type="checkbox" id="fSold" style="width:18px;height:18px;min-height:auto"'+(F.soldOut?' checked':'')+'> Hozir tugagan — ekranda</label><input id="fSoldT" maxlength="20" value="'+esc(F.soldOutText)+'" style="width:140px" aria-label="Tugaganda ko‘rinadigan yozuv"><span>deb chiqadi</span></div>'
    +'<div class="row"><button id="fSave">Saqlash</button><button class="ghost" id="fCancel">Bekor</button>'+(F.id?'<button class="ghost" id="fDel" style="color:var(--bad)">Monitor menyusidan o‘chirish</button>':'')+'</div><div id="fMsg"></div></section>';
  var keep=function(){F.name=byId('fName').value;F.description=byId('fDesc').value;F.screen=byId('fScr').value;F.badge=byId('fBadge').value;F.visible=byId('fVis').checked;F.soldOut=byId('fSold').checked;F.soldOutText=byId('fSoldT').value;
    box.querySelectorAll('[data-vl]').forEach(function(e){F.variants[Number(e.dataset.vl)].label=e.value});
    box.querySelectorAll('[data-vz]').forEach(function(e){F.variants[Number(e.dataset.vz)].size=e.value});
    box.querySelectorAll('[data-va]').forEach(function(e){F.variants[Number(e.dataset.va)].active=e.checked});
    box.querySelectorAll('[data-vp]').forEach(function(e){if(!e.disabled)F.variants[Number(e.dataset.vp)].price=money(e.value)})};
  box.querySelectorAll('[data-vp]').forEach(function(e){e.addEventListener('input',function(){var n=money(e.value);e.value=n?n.toLocaleString('en-US'):''})});
  box.querySelectorAll('[data-vr]').forEach(function(e){e.addEventListener('change',function(){keep();F.variants[Number(e.dataset.vr)].recipeId=e.value;drawForm()})});
  box.querySelectorAll('[data-vs]').forEach(function(e){e.addEventListener('click',function(){keep();var v=F.variants[Number(e.dataset.vs)];v.recipeId=v.suggestion;drawForm()})});
  box.querySelectorAll('[data-vx]').forEach(function(e){e.addEventListener('click',function(){keep();F.variants.splice(Number(e.dataset.vx),1);drawForm()})});
  byId('fAdd').addEventListener('click',function(){keep();if(F.variants.length>=6){byId('fMsg').innerHTML='<div class="msg bad">Bitta taomda 6 tadan ko‘p qator bo‘lmaydi.</div>';return}F.variants.push({id:'',label:F.variants.length?F.variants[F.variants.length-1].label:'',size:'',active:true,recipeId:'',price:0,suggestion:''});drawForm()});
  byId('fPic').addEventListener('click',function(){keep();pickImage(function(id,url){F.imageId=id;F.image=url;drawForm();byId('fPicMsg').innerHTML='<div class="msg ok">✓ Rasm yuklandi. «Saqlash»ni bosing.</div>'},byId('fPicMsg'))});
  var pd=byId('fPicDel');if(pd)pd.addEventListener('click',function(){keep();F.imageId='';F.image='';drawForm()});
  byId('fCancel').addEventListener('click',function(){F=null;box.innerHTML=''});
  var del=byId('fDel');if(del)del.addEventListener('click',function(){if(!confirm(F.name+' monitor menyusidan o‘chirilsinmi? HALO Control menyusidagi taomga tegilmaydi.'))return;post({action:'deleteItem',id:F.id}).then(function(x){if(!x.body.ok){byId('fMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}F=null;box.innerHTML='<div class="msg ok" style="margin-bottom:10px">✓ O‘chirildi</div>';take(x.body)})});
  byId('fSave').addEventListener('click',function(){keep();var btn=this;btn.disabled=true;
    var body={action:'saveItem',id:F.id,name:F.name,description:F.description,screen:F.screen,badge:F.badge,visible:F.visible,soldOut:F.soldOut,soldOutText:F.soldOutText,
      variants:F.variants.map(function(v){return {id:v.id,label:v.label,size:v.size,active:v.active,recipeId:v.recipeId,price:v.price}})};
    if(F.imageId!==undefined)body.imageId=F.imageId;
    post(body).then(function(x){btn.disabled=false;if(!x.body.ok){byId('fMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}
      SCR=F.screen;F=null;box.innerHTML='<div class="msg ok" style="margin-bottom:10px">✓ Saqlandi. Ekranda 15 soniya ichida ko‘rinadi.</div>';take(x.body)})});
}

/* ---------- sozlamalar ---------- */
function drawSettings(){var box=byId('settings');if(!MENU)return;
  var r=MENU.restaurant,s=MENU.setOffer,sc=MENU.screens.find(function(x){return x.id===SCR});
  if(!ST)ST={setImage:s.image,setImageId:undefined,scrImage:sc.image,scrImageId:undefined};
  var inp=function(id,label,value,extra){return '<label class="field" style="flex:1 1 200px"><span>'+label+'</span><input id="'+id+'" value="'+esc(value)+'"'+(extra||'')+'></label>'};
  var chk=function(id,label,on){return '<label class="row" style="gap:8px;margin-bottom:10px"><input type="checkbox" id="'+id+'" style="width:18px;height:18px;min-height:auto"'+(on?' checked':'')+'> '+label+'</label>'};
  var num=' inputmode="numeric" style="text-align:right"';
  var offerItems=MENU.items.filter(function(i){return i.visible});
  box.innerHTML='<h3 style="font-size:15px;margin:0 0 8px">«'+esc(sc.title)+'» ekrani</h3><div class="row">'+inp('xTitle','Ekran nomi',sc.title,' maxlength="24"')+inp('xPer','Bir sahifada nechta taom (1–8)',sc.itemsPerPage,num)+'</div>'
    +'<div class="row">'+inp('xSpot','Har bir taom necha soniya katta turadi (0 — faqat umumiy)',sc.spotlightSeconds,num)+inp('xOver','Umumiy ko‘rinish necha soniya turadi',sc.overviewSeconds,num)+inp('xPage','Sahifa almashishi (soniya, taom ko‘p bo‘lsa)',sc.pageSeconds,num)+'</div>'
    +'<p class="hint" style="margin:0 0 12px">Uchala ekran bir vaqtda almashishi uchun bu vaqtlar hamma ekranda bir xil bo‘lsin.</p>'
    +'<h3 style="font-size:15px;margin:6px 0 8px">Kun aksiyasi (shu ekranda bitta taom vaqti-vaqti bilan katta chiqadi)</h3>'+chk('oOn','Yoqilgan',sc.offerEnabled)
    +'<div class="row"><label class="field" style="flex:2 1 220px"><span>Qaysi taom</span><select id="oItem"><option value="">— tanlang —</option>'+offerItems.map(function(i){return '<option value="'+esc(i.id)+'"'+(i.id===sc.offerItemId?' selected':'')+'>'+esc(i.name)+'</option>'}).join('')+'</select></label>'+inp('oLabel','Yozuv',sc.offerLabel,' maxlength="30"')+'</div>'
    +'<div class="row">'+inp('oInt','Har necha soniyada chiqadi',sc.offerIntervalSeconds,num)+inp('oDur','Necha soniya turadi',sc.offerDurationSeconds,num)+'</div>'
    +'<h3 style="font-size:15px;margin:6px 0 8px">Zaxira rasm (rasmi yo‘q yoki ochilmagan taom o‘rnida ko‘rinadi)</h3>'
    +'<div class="row" style="margin-bottom:6px">'+thumb(ST.scrImage,sc.title,56)+'<button class="ghost" id="xPic">Rasm tanlash</button>'+(ST.scrImage?'<button class="ghost" id="xPicDel">Rasmni olib tashlash</button>':'')+'</div><div id="xPicMsg"></div>'
    +'<div class="row" style="margin:10px 0 18px"><button id="xSave">Ekranni saqlash</button><button class="ghost" id="xDel" style="color:var(--bad)">Ekranni o‘chirish</button></div><div id="xMsg"></div>'
    +'<h3 style="font-size:15px;margin:0 0 8px">Yozuvlar (hamma ekranda)</h3><div class="row">'+inp('rName','Nomi (tepada, chapda)',r.name,' maxlength="24"')+inp('rSlogan','Shior (nom ostida)',r.slogan,' maxlength="80"')+'</div><div class="row">'+inp('rHours','Ish vaqti (pastda, o‘ngda)',r.hours,' maxlength="60"')+'</div>'
    +'<div class="row">'+inp('rFooter','Pastdagi yozuv (faqat SET MENU o‘chiq bo‘lsa)',r.footer,' maxlength="80"')+inp('rPhone','Telefon (faqat SET MENU o‘chiq bo‘lsa)',r.phone,' maxlength="30"')+'</div>'
    +'<h3 style="font-size:15px;margin:14px 0 8px">SET MENU (pastdagi tasma)</h3>'+chk('sVis','Ekranda ko‘rinsin',s.visible)+'<div class="row">'+inp('sTitle','Sarlavha',s.title,' maxlength="40"')+inp('sDesc','Tarkibi',s.description,' maxlength="120"')+inp('sPrice','Narxi (₩)',s.price?s.price.toLocaleString('en-US'):'',num)+'</div>'
    +'<div class="row" style="margin-bottom:10px">'+thumb(ST.setImage,s.title,56)+'<button class="ghost" id="sPic">Rasm tanlash</button>'+(ST.setImage?'<button class="ghost" id="sPicDel">Rasmni olib tashlash</button>':'')+'</div><div id="sPicMsg"></div>'
    +'<button id="gSave">Yozuvlar va SET MENU’ni saqlash</button><div id="gMsg"></div>';
  var e=byId('sPrice');e.addEventListener('input',function(){var n=money(e.value);e.value=n?n.toLocaleString('en-US'):''});
  var v=function(id){return byId(id).value};
  // Bo'sh qoldirilgan son yuborilmaydi — avvalgi qiymat saqlanadi (bo'sh maydon 0 bo'lib ketmasin).
  var n=function(id){var t=String(v(id)).trim();return t===''?undefined:money(t)};
  byId('xPic').addEventListener('click',function(){pickImage(function(id,url){ST.scrImageId=id;ST.scrImage=url;byId('xPicMsg').innerHTML='<div class="msg ok">✓ Rasm yuklandi. «Ekranni saqlash»ni bosing.</div>'},byId('xPicMsg'))});
  var xd=byId('xPicDel');if(xd)xd.addEventListener('click',function(){ST.scrImageId='';ST.scrImage='';byId('xPicMsg').innerHTML='<div class="msg warn">Rasm olib tashlanadi. «Ekranni saqlash»ni bosing.</div>'});
  byId('xSave').addEventListener('click',function(){
    var body={action:'saveScreen',id:SCR,title:v('xTitle'),itemsPerPage:n('xPer'),spotlightSeconds:n('xSpot'),overviewSeconds:n('xOver'),pageSeconds:n('xPage'),
      offerEnabled:byId('oOn').checked,offerItemId:v('oItem'),offerLabel:v('oLabel'),offerIntervalSeconds:n('oInt'),offerDurationSeconds:n('oDur')};
    if(ST.scrImageId!==undefined)body.imageId=ST.scrImageId;
    post(body).then(function(x){if(!x.body.ok){byId('xMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}ST=null;take(x.body);byId('xMsg').innerHTML='<div class="msg ok">✓ Saqlandi. Ekranda 15 soniya ichida ko‘rinadi.</div>'})});
  byId('xDel').addEventListener('click',function(){if(!confirm('«'+sc.title+'» ekrani o‘chirilsinmi?'))return;post({action:'deleteScreen',id:SCR}).then(function(x){if(!x.body.ok){byId('xMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}ST=null;take(x.body)})});
  byId('sPic').addEventListener('click',function(){pickImage(function(id,url){ST.setImageId=id;ST.setImage=url;byId('sPicMsg').innerHTML='<div class="msg ok">✓ Rasm yuklandi. «Yozuvlar va SET MENU’ni saqlash»ni bosing.</div>'},byId('sPicMsg'))});
  var sd=byId('sPicDel');if(sd)sd.addEventListener('click',function(){ST.setImageId='';ST.setImage='';byId('sPicMsg').innerHTML='<div class="msg warn">Rasm olib tashlanadi. «Yozuvlar va SET MENU’ni saqlash»ni bosing.</div>'});
  byId('gSave').addEventListener('click',function(){var btn=this;btn.disabled=true;
    var set={visible:byId('sVis').checked,title:v('sTitle'),description:v('sDesc'),price:money(v('sPrice'))};if(ST.setImageId!==undefined)set.imageId=ST.setImageId;
    post({action:'saveSettings',restaurant:{name:v('rName'),slogan:v('rSlogan'),hours:v('rHours'),phone:v('rPhone'),footer:v('rFooter')},setOffer:set}).then(function(x){btn.disabled=false;
      if(!x.body.ok){byId('gMsg').innerHTML='<div class="msg bad">'+esc(x.body.error)+'</div>';return}ST=null;take(x.body);byId('gMsg').innerHTML='<div class="msg ok">✓ Saqlandi. Ekranda 15 soniya ichida ko‘rinadi.</div>'})});
}
sel.addEventListener('change',load);load();
`,
  });
}
