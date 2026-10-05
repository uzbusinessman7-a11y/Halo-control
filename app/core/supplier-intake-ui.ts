/**
 * Qarzlar sahifasi uchun: «Yangi kirim» oynasi va yetkazib beruvchining mahsulotlar ro'yxati (brauzer skripti).
 * Sahifadagi mavjud yordamchilardan foydalanadi: esc, won, api, sel, PARTIES, TODAY, load, openStatement.
 * Diqqat: bu matn ichida teskari tirnoq va dollar-qavs ishlatilmaydi (sahifa skriptiga qo'shiladi).
 */
export const SUPPLIER_INTAKE_STYLE = String.raw`<style>
.nk-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:6px}
.nk-chips button{display:block;text-align:left;min-height:56px;padding:8px 12px;line-height:1.25}
.nk-chips button b{display:block;font-size:15px;overflow-wrap:anywhere}
.nk-chips button small{display:block;color:var(--muted);font-size:13px;font-weight:500}
.nk-line{padding:12px 0;border-top:1px solid var(--line)}
.nk-line .row{flex-wrap:nowrap}
.nk-line input{min-width:0}
.nk-pay{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.nk-pay button{padding-left:4px;padding-right:4px;white-space:nowrap;font-size:15px}
.nk-list{display:flex;justify-content:space-between;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line)}
.nk-list>div:first-child{flex:1 1 150px;min-width:0}
.nk-list b{overflow-wrap:anywhere}
</style>`;

export const SUPPLIER_INTAKE_SCRIPT = String.raw`
/* ---------- Yangi kirim: mahsulot + qarz + to'lov bitta saqlashda ---------- */
var PROFILE=null,IN=null,FLASH='';
function uuid4(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)})}
function digits(v){return Number(String(v||'').replace(/[^0-9]/g,''))||0}
function dec(v){var n=Number(String(v||'').replace(',','.').replace(/[^0-9.]/g,''));return isFinite(n)?n:0}
function fmt(n){return n?Number(n).toLocaleString('en-US'):''}
function unitsOf(item){var u=[item.unit];if(item.unit==='g')u.push('kg');if(item.unit==='ml')u.push('litr');if(item.unit==='kg')u.push('g');if(item.unit==='litr')u.push('ml');if(item.packageName&&item.unitsPerPackage>1)u.push(item.packageName);else if(item.vegetable)u.push('qadoq');if(item.vegetable&&u.indexOf('dona')<0)u.push('dona');return u.filter(function(x,i,a){return x&&a.indexOf(x)===i})}
function priceText(x){return x.price>0?won(Math.round(x.price))+' / '+esc(x.unit):'narx hali yo‘q'}
function kindTag(x){return x.mode==='expense'||(x.inventoryId===''&&!x.mode)?'<span class="tag warn">omborsiz xarajat</span>':x.mode==='new'?'<span class="tag ok">yangi ombor mahsuloti</span>':x.vegetable?'<span class="tag warn">sabzavot / sous</span>':''}
function nameKey(s){return String(s||'').trim().toLowerCase().replace(/[‘’ʻʼ']/g,'').replace(/\s+/g,' ')}

function openIntake(partyId){
  var p=PARTIES[partyId],box=document.getElementById('entry');if(!p)return;
  box.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'profile',branchId:sel.value,supplierId:p.oldId}).then(function(r){
    if(!r.ok){box.innerHTML='<div class="msg bad">'+esc(r.error||'Ochilmadi.')+'</div>';return}
    PROFILE=r;IN={partyId:partyId,lines:[],pay:'debt',acc:(r.accounts[0]||{}).id||'',part:'',op:uuid4(),date:r.today};
    drawIntake();box.scrollIntoView({behavior:'smooth',block:'start'});
  });
}
function lineHtml(l,idx){
  return '<div class="nk-line"><div class="row" style="justify-content:space-between"><span style="min-width:0"><b>'+esc(l.name)+'</b>'+kindTag(l)+(l.remember?'<span class="tag ok">ro‘yxatga saqlanadi</span>':'')+'</span><button class="ghost" data-del="'+idx+'" aria-label="Qatorni olib tashlash" style="min-height:34px;padding:2px 12px">✕</button></div>'
    +'<div class="row" style="margin-top:8px"><input data-q="'+idx+'" inputmode="decimal" placeholder="Miqdor" value="'+esc(l.q)+'" style="flex:1 1 80px"><span style="flex:0 0 auto;color:var(--muted)">'+esc(l.unitLabel)+'</span><input data-a="'+idx+'" inputmode="numeric" placeholder="Jami narx ₩" value="'+esc(l.a)+'" style="flex:2 1 120px;text-align:right"></div>'
    +'<small class="hint" data-hint="'+idx+'" style="display:block;margin-top:6px"></small></div>';
}
function lineHint(idx){
  var l=IN.lines[idx],el=document.querySelector('[data-hint="'+idx+'"]');if(!el)return;var q=dec(l.q),a=digits(l.a);
  if(!(q>0)||!a){el.innerHTML=l.price>0?'Oxirgi narx: '+won(Math.round(l.price))+' / '+esc(l.unitLabel):'';return}
  var now=a/q,t='1 '+esc(l.unitLabel)+' = '+won(Math.round(now));
  if(l.price>0&&Math.round(now)!==Math.round(l.price)){var far=Math.abs(now-l.price)*100>l.price*30;t+=' · oldin '+won(Math.round(l.price))+(far?' <b style="color:var(--bad)">— farq katta, tekshiring</b>':'')}
  el.innerHTML=t;
}
function intakeTotal(){
  var t=IN.lines.reduce(function(s,l){return s+digits(l.a)},0),el=document.getElementById('nTotal'),d=document.getElementById('nDebt');
  var paid=IN.pay==='debt'?0:IN.pay==='paid'?t:Math.min(t,digits(IN.part));
  if(el)el.textContent=won(t);
  if(d)d.textContent=!t?'':IN.pay==='debt'?'Hammasi qarzga yoziladi':IN.pay==='paid'?'To‘liq to‘landi — qarz oshmaydi':'To‘landi '+won(paid)+' · qarzga '+won(t-paid);
  return {total:t,paid:paid};
}
function drawIntake(){
  var p=PARTIES[IN.partyId],box=document.getElementById('entry'),pr=PROFILE.products,used={};
  IN.lines.forEach(function(l){if(l.productId)used[l.productId]=1});
  box.innerHTML='<div class="card" style="background:var(--card-2)"><h2>📦 Yangi kirim — '+esc(p.name)+'</h2>'
    +'<p class="hint">Bitta saqlash omborga kirimni, qarzni va to‘lovni birga yozadi. Shu yukni «Ombor kirimi»ga yoki «+ Xarid»ga qayta kiritmang.</p>'
    +'<label class="field"><span>Sana</span><input type="date" id="nDate" value="'+esc(IN.date)+'" max="'+esc(PROFILE.today)+'"></label>'
    +(pr.length?'<p class="hint" style="margin:0 0 6px">Ro‘yxatdan bosing:</p><div class="nk-chips">'+pr.map(function(x){return '<button class="ghost" data-chip="'+esc(x.id)+'"'+(used[x.id]||x.missing?' disabled':'')+'><b>'+esc(x.name)+'</b><small>'+(x.missing?'omborda topilmadi':priceText(x))+'</small></button>'}).join('')+'</div>'
      :'<div class="msg warn">Bu yetkazib beruvchida saqlangan mahsulot hali yo‘q. Pastdagi tugma bilan qo‘shing — «Ro‘yxatga saqlansin» belgilansa, keyingi safar bir bosishda chiqadi.</div>')
    +'<div id="nLines">'+IN.lines.map(lineHtml).join('')+'</div>'
    +'<div class="row" style="margin-top:10px"><button class="ghost" id="nManual">+ Ro‘yxatda yo‘q mahsulot</button></div><div id="nManualBox"></div>'
    +'<h3 style="margin:18px 0 8px">To‘lov</h3><div class="nk-pay">'+[['debt','Qarzga'],['paid','To‘landi'],['part','Bir qismi']].map(function(x){return '<button class="'+(IN.pay===x[0]?'':'ghost')+'" data-pay="'+x[0]+'">'+x[1]+'</button>'}).join('')+'</div>'
    +(IN.pay==='part'?'<label class="field" style="margin-top:10px"><span>Qancha to‘landi (₩)</span><input id="nPart" inputmode="numeric" value="'+esc(IN.part)+'" placeholder="0" style="width:100%;text-align:right"></label>':'')
    +(IN.pay!=='debt'?(PROFILE.accounts.length?'<label class="field" style="margin-top:10px"><span>Qaysi hisobdan to‘landi</span><select id="nAcc">'+PROFILE.accounts.map(function(a){return '<option value="'+esc(a.id)+'"'+(a.id===IN.acc?' selected':'')+'>'+esc(a.name)+'</option>'}).join('')+'</select></label>':'<div class="msg bad" style="margin-top:10px">Kassa yoki bank hisobi topilmadi.</div>'):'')
    +'<div class="row" style="justify-content:space-between;margin-top:14px"><div><div class="total" id="nTotal">0 ₩</div><small class="hint" id="nDebt"></small></div><div class="row"><button id="nSave">Saqlash</button><button class="ghost" id="nCancel">Bekor</button></div></div><div id="nMsg"></div></div>';
  document.getElementById('nDate').addEventListener('change',function(){IN.date=this.value});
  box.querySelectorAll('[data-chip]').forEach(function(b){b.addEventListener('click',function(){addSaved(b.dataset.chip)})});
  box.querySelectorAll('[data-q]').forEach(function(el){el.addEventListener('input',function(){var i=Number(el.dataset.q),l=IN.lines[i];l.q=el.value;
    if(l.auto&&l.price>0){l.a=fmt(Math.round(dec(l.q)*l.price));var a=box.querySelector('[data-a="'+i+'"]');if(a)a.value=l.a}lineHint(i);intakeTotal()})});
  box.querySelectorAll('[data-a]').forEach(function(el){el.addEventListener('input',function(){var i=Number(el.dataset.a),l=IN.lines[i];el.value=fmt(digits(el.value));l.a=el.value;l.auto=false;lineHint(i);intakeTotal()})});
  box.querySelectorAll('[data-del]').forEach(function(b){b.addEventListener('click',function(){IN.lines.splice(Number(b.dataset.del),1);drawIntake()})});
  box.querySelectorAll('[data-pay]').forEach(function(b){b.addEventListener('click',function(){IN.pay=b.dataset.pay;drawIntake()})});
  var part=document.getElementById('nPart');if(part)part.addEventListener('input',function(){part.value=fmt(digits(part.value));IN.part=part.value;intakeTotal()});
  var acc=document.getElementById('nAcc');if(acc)acc.addEventListener('change',function(){IN.acc=acc.value});
  document.getElementById('nManual').addEventListener('click',function(){productForm('line')});
  document.getElementById('nCancel').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('nSave').addEventListener('click',function(){saveIntake()});
  IN.lines.forEach(function(l,i){lineHint(i)});intakeTotal();
}
function focusLast(){var all=document.querySelectorAll('[data-q]');if(all.length)all[all.length-1].focus()}
function addSaved(id){
  var x=PROFILE.products.filter(function(y){return y.id===id})[0];if(!x||x.missing)return;
  if(IN.lines.some(function(l){return l.productId===id}))return;
  IN.lines.push({productId:id,inventoryId:x.inventoryId,mode:x.inventoryId?'stock':'expense',name:x.name,unitLabel:x.unit,price:x.price,vegetable:x.vegetable,remember:false,q:'',a:'',auto:true});
  drawIntake();focusLast();
}
/* Mahsulot tanlash oynasi. target: 'line' — kirim qatoriga; 'list' — faqat ro'yxatga (narxi bilan). */
function productForm(target){
  var box=document.getElementById(target==='line'?'nManualBox':'pForm'),M={sel:'',mode:target==='list'?'expense':'',name:'',unit:'',newUnit:'kg',free:'dona',rem:true,price:''};
  function keep(){var n=document.getElementById('mName');if(n)M.name=n.value;var f=document.getElementById('mFree');if(f)M.free=f.value;var pz=document.getElementById('mPrice');if(pz)M.price=pz.value;var r=document.getElementById('mRem');if(r)M.rem=r.checked}
  function draw(){
    var item=PROFILE.inventory.filter(function(i){return i.id===M.sel})[0],cats=PROFILE.inventoryCategories||[];
    var rest=PROFILE.inventory.filter(function(i){return !cats.some(function(c){return c.id===i.categoryId})});
    var opt=function(i){return '<option value="'+esc(i.id)+'"'+(i.id===M.sel?' selected':'')+'>'+esc(i.name)+'</option>'};
    var h='<div class="card" style="margin-top:10px"><label class="field"><span>Mahsulot</span><select id="mSel"><option value="">— ombordan tanlang —</option>'
      +cats.map(function(c){var items=PROFILE.inventory.filter(function(i){return i.categoryId===c.id});return items.length?'<optgroup label="'+esc(c.name)+'">'+items.map(opt).join('')+'</optgroup>':''}).join('')
      +(rest.length?'<optgroup label="Boshqa">'+rest.map(opt).join('')+'</optgroup>':'')
      +'<option value="__new"'+(M.sel==='__new'?' selected':'')+'>✍️ Omborda yo‘q — nomini yozaman</option></select></label>';
    var unitShown='';
    if(item){var us=unitsOf(item);if(us.indexOf(M.unit)<0)M.unit=us[item.unit==='g'||item.unit==='ml'?1:0]||us[0];unitShown=M.unit;
      h+='<label class="field"><span>Qanday o‘lchovda olinadi</span><select id="mUnit">'+us.map(function(u){return '<option'+(u===M.unit?' selected':'')+'>'+esc(u)+'</option>'}).join('')+'</select></label>'
        +(item.vegetable?'<p class="hint">Sabzavot / sous: omborda sanalmaydi, olingan kuni xarajat bo‘ladi.</p>':'');}
    if(M.sel==='__new'){
      h+='<label class="field"><span>Nomi</span><input id="mName" maxlength="100" value="'+esc(M.name)+'" placeholder="Masalan: Kolbasa"></label>';
      if(target==='line')h+='<div class="nk-pay" style="grid-template-columns:1fr 1fr"><button class="'+(M.mode==='new'?'':'ghost')+'" data-mm="new">📦 Omborga qo‘shilsin</button><button class="'+(M.mode==='expense'?'':'ghost')+'" data-mm="expense">🧾 Omborsiz xarajat</button></div>';
      else h+='<p class="hint">Bu yerda faqat omborsiz (xarajat) mahsulot oldindan saqlanadi. Omborda sanaladigan yangi mahsulotni birinchi kirimda «Ro‘yxatda yo‘q mahsulot» orqali qo‘shing — u omborda ham, shu ro‘yxatda ham yaratiladi.</p>';
      if(M.mode==='new'){unitShown=M.newUnit;h+='<p class="hint" style="margin-top:8px">Omborda sanaladi, sotilganda xarajat bo‘ladi — go‘sht, kolbasa, pishloq, ichimlik.</p><label class="field"><span>O‘lchovi</span><select id="mNewUnit">'+['kg','litr','dona'].map(function(u){return '<option'+(u===M.newUnit?' selected':'')+'>'+u+'</option>'}).join('')+'</select></label>'}
      if(M.mode==='expense'){unitShown=M.free||'dona';h+='<p class="hint" style="margin-top:8px">Omborda yuritilmaydi, olingan kuni xarajat bo‘ladi — salfetka, paket, yuvish vositasi.</p><label class="field"><span>O‘lchovi</span><input id="mFree" maxlength="30" value="'+esc(M.free)+'" placeholder="dona, quti, paket…"></label>'}
    }
    if(target==='list'&&(item||M.sel==='__new'))h+='<label class="field"><span>1 '+esc(unitShown||'birlik')+' narxi (₩) — ixtiyoriy</span><input id="mPrice" inputmode="numeric" value="'+esc(M.price)+'" placeholder="0" style="width:100%;text-align:right"></label>';
    if(target==='line'&&(item||M.sel==='__new'))h+='<label class="row" style="gap:8px;margin:4px 0 12px;flex-wrap:nowrap"><input type="checkbox" id="mRem"'+(M.rem?' checked':'')+' style="width:20px;height:20px;min-height:auto;flex:0 0 auto"> <span>Ro‘yxatga saqlansin — keyingi safar bir bosishda</span></label>';
    h+='<div class="row"><button id="mAdd">'+(target==='line'?'Qo‘shish':'Saqlash')+'</button><button class="ghost" id="mCancel">Bekor</button></div><div id="mMsg"></div></div>';
    box.innerHTML=h;
    document.getElementById('mSel').addEventListener('change',function(){keep();M.sel=this.value;M.unit='';draw()});
    var mu=document.getElementById('mUnit');if(mu)mu.addEventListener('change',function(){keep();M.unit=mu.value;draw()});
    var nu=document.getElementById('mNewUnit');if(nu)nu.addEventListener('change',function(){keep();M.newUnit=nu.value;draw()});
    var mp=document.getElementById('mPrice');if(mp)mp.addEventListener('input',function(){mp.value=fmt(digits(mp.value))});
    box.querySelectorAll('[data-mm]').forEach(function(b){b.addEventListener('click',function(){keep();M.mode=b.dataset.mm;draw()})});
    document.getElementById('mCancel').addEventListener('click',function(){box.innerHTML=''});
    document.getElementById('mAdd').addEventListener('click',function(){keep();submit(item)});
  }
  function fail(t){document.getElementById('mMsg').innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(t)+'</div>'}
  function submit(item){
    var name=M.name.trim(),free=(M.free||'').trim()||'dona';
    if(!item&&M.sel!=='__new'){fail('Mahsulotni tanlang.');return}
    if(!item){
      if(name.length<2){fail('Mahsulot nomini yozing.');return}
      if(PROFILE.inventory.some(function(i){return nameKey(i.name)===nameKey(name)})){fail('«'+name+'» omborda bor — uni yuqoridagi ro‘yxatdan tanlang.');return}
      if(!M.mode){fail('Tanlang: omborga qo‘shilsinmi yoki omborsiz xarajatmi.');return}
    }
    if(target==='list'){
      var btn=document.getElementById('mAdd');btn.disabled=true;
      api({action:'saveProduct',branchId:sel.value,supplierId:PARTIES[PRODUCTS_PARTY].oldId,product:item?{id:uuid4(),inventoryId:item.id,unit:M.unit,price:digits(M.price)}:{id:uuid4(),name:name,unit:free,price:digits(M.price)}}).then(function(r){
        btn.disabled=false;if(!r.ok){fail(r.error||'Saqlanmadi.');return}PROFILE=r;drawProducts('<div class="msg ok" style="margin-top:10px">✓ Ro‘yxatga qo‘shildi</div>')});
      return;
    }
    if(item){
      var saved=PROFILE.products.filter(function(x){return x.inventoryId===item.id&&String(x.unit).toLowerCase()===String(M.unit).toLowerCase()&&!x.missing})[0];
      if(IN.lines.some(function(l){return l.inventoryId===item.id})){fail('Bu mahsulot qatorda bor — miqdorini o‘sha yerda yozing.');return}
      if(saved){addSaved(saved.id);return}
      IN.lines.push({inventoryId:item.id,mode:'stock',name:item.name,unit:M.unit,unitLabel:M.unit,price:0,vegetable:item.vegetable,remember:M.rem,q:'',a:'',auto:true});
    }else{
      if(IN.lines.some(function(l){return nameKey(l.name)===nameKey(name)})){fail('Bu mahsulot qatorda bor.');return}
      if(M.mode==='new')IN.lines.push({inventoryId:'',mode:'new',name:name,newUnit:M.newUnit,newItemOp:uuid4(),unitLabel:M.newUnit,price:0,remember:M.rem,q:'',a:'',auto:true});
      else IN.lines.push({inventoryId:'',mode:'expense',name:name,unit:free,unitLabel:free,price:0,remember:M.rem,q:'',a:'',auto:true});
    }
    drawIntake();focusLast();
  }
  draw();box.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function saveIntake(extra){
  var msg=document.getElementById('nMsg'),btn=document.getElementById('nSave'),p=PARTIES[IN.partyId];
  var bad=function(t){msg.innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(t)+'</div>'};
  if(!IN.lines.length){bad('Kamida bitta mahsulot qo‘shing.');return}
  if(IN.lines.some(function(l){return !(dec(l.q)>0)||!(digits(l.a)>0)})){bad('Har bir qatorda miqdor va jami narxni yozing.');return}
  var sums=intakeTotal();
  if(IN.pay==='part'&&!(sums.paid>0&&sums.paid<sums.total)){bad('To‘langan qismni yozing (jamidan kam). Hammasi to‘langan bo‘lsa «To‘landi»ni tanlang.');return}
  if(IN.pay!=='debt'&&!IN.acc){bad('Pul qaysi hisobdan to‘langanini tanlang.');return}
  var accName=(PROFILE.accounts.filter(function(a){return a.id===IN.acc})[0]||{}).name||'';
  var how=IN.pay==='debt'?'qarzga':IN.pay==='paid'?'to‘landi ('+accName+')':'to‘landi '+won(sums.paid)+' ('+accName+'), qarzga '+won(sums.total-sums.paid);
  if(!extra&&!confirm(p.name+' · '+IN.lines.length+' ta mahsulot · jami '+won(sums.total)+' · '+how+' · '+IN.date+'. Saqlansinmi?'))return;
  var body={action:'intake',branchId:sel.value,supplierId:p.oldId,operationId:IN.op,date:IN.date,paidAmount:sums.paid,accountId:sums.paid>0?IN.acc:'',
    lines:IN.lines.map(function(l){var base={quantity:dec(l.q),amount:digits(l.a)};
      if(l.productId){base.productId=l.productId;return base}
      base.remember=!!l.remember;
      if(l.mode==='new'){base.mode='new';base.name=l.name;base.newUnit=l.newUnit;base.newItemOp=l.newItemOp}
      else if(l.mode==='expense'){base.mode='expense';base.name=l.name;base.unit=l.unit}
      else{base.inventoryId=l.inventoryId;base.unit=l.unit}
      return base})};
  extra=extra||{};if(extra.duplicateReason)body.duplicateReason=extra.duplicateReason;if(extra.priceConfirmed)body.priceConfirmed=true;
  btn.disabled=true;msg.innerHTML='';
  api(body).then(function(r){
    btn.disabled=false;
    if(r.ok){
      var res=r.result,toStock=res.lines.filter(function(l){return l.destination==='stock'}).length,toCost=res.lines.length-toStock;
      FLASH='<div class="msg ok">✓ '+(res.alreadySaved?'Oldin saqlangan edi':'Saqlandi')+' · jami '+won(res.total)+(toStock?' · omborga '+toStock+' ta mahsulot':'')+(toCost?' · xarajatga '+toCost+' ta':'')+(res.paid?' · to‘landi '+won(res.paid):'')+(res.debt?' · qarz +'+won(res.debt):'')+(res.createdInventory&&res.createdInventory.length?' · omborda yangi: '+esc(res.createdInventory.join(', ')):'')+'</div>';
      var party=IN.partyId;IN=null;load();setTimeout(function(){openStatement(party)},500);return;
    }
    if(r.code==='SIMILAR_PURCHASE'&&!extra.duplicateReason){var why=prompt((r.error||'Shunga o‘xshash kirim bor.')+'\n\nBu haqiqatan boshqa yuk bo‘lsa, sababini yozing (kamida 5 harf):');
      if(why&&why.trim().length>=5){extra.duplicateReason=why.trim();saveIntake(extra)}return}
    if(r.code==='PRICE_JUMP'&&!extra.priceConfirmed){if(confirm((r.error||'Narx keskin o‘zgargan.')+'\n\nNarx to‘g‘rimi?')){extra.priceConfirmed=true;saveIntake(extra)}return}
    bad(r.error||'Saqlanmadi.');
  });
}

/* ---------- Yetkazib beruvchining mahsulotlar ro'yxati ---------- */
var PRODUCTS_PARTY='';
function openProducts(partyId){
  var p=PARTIES[partyId],box=document.getElementById('fix');if(!p)return;PRODUCTS_PARTY=partyId;box.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'profile',branchId:sel.value,supplierId:p.oldId}).then(function(r){if(!r.ok){box.innerHTML='<div class="msg bad">'+esc(r.error||'Ochilmadi.')+'</div>';return}PROFILE=r;drawProducts('');box.scrollIntoView({behavior:'smooth',block:'nearest'})});
}
function drawProducts(note){
  var p=PARTIES[PRODUCTS_PARTY],box=document.getElementById('fix'),list=PROFILE.products;
  box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:10px"><h2>🗂 Mahsulotlari — '+esc(p.name)+'</h2><p class="hint">Shu yetkazib beruvchidan olinadigan mahsulotlar. Narx har kirimda o‘zi yangilanadi; oldindan yozib qo‘yish ham mumkin.</p>'
    +(list.length?list.map(function(x){return '<div class="nk-list"><div><b>'+esc(x.name)+'</b>'+kindTag({inventoryId:x.inventoryId,vegetable:x.vegetable})+(x.missing?'<span class="tag bad">omborda topilmadi</span>':'')+'<br><small style="color:var(--muted)">'+priceText(x)+'</small></div>'
        +'<div class="row" style="flex-wrap:nowrap"><button class="ghost" data-pp="'+esc(x.id)+'" style="min-height:34px;padding:2px 10px">Narx</button><button class="ghost" data-pr="'+esc(x.id)+'" style="min-height:34px;padding:2px 10px">Olib tashlash</button></div></div>'}).join(''):'<p class="hint">Hali yo‘q.</p>')
    +'<button class="ghost block" id="pAdd" style="margin-top:10px">+ Mahsulot qo‘shish</button><div id="pForm"></div><div id="pMsg">'+(note||'')+'</div></div>';
  var find=function(id){return list.filter(function(x){return x.id===id})[0]};
  var done=function(r,ok){if(!r.ok){document.getElementById('pMsg').innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(r.error||'Bo‘lmadi.')+'</div>';return}PROFILE=r;drawProducts('<div class="msg ok" style="margin-top:10px">✓ '+ok+'</div>')};
  box.querySelectorAll('[data-pp]').forEach(function(b){b.addEventListener('click',function(){var x=find(b.dataset.pp);if(!x)return;
    var v=prompt('«'+x.name+'» — 1 '+x.unit+' narxi (₩):',x.price>0?String(Math.round(x.price)):'');if(v===null)return;
    api({action:'saveProduct',branchId:sel.value,supplierId:p.oldId,product:{id:x.id,inventoryId:x.inventoryId,name:x.name,unit:x.unit,price:digits(v)}}).then(function(r){done(r,'Narx saqlandi')})})});
  box.querySelectorAll('[data-pr]').forEach(function(b){b.addEventListener('click',function(){var x=find(b.dataset.pr);if(!x)return;
    if(!confirm('«'+x.name+'» ro‘yxatdan olib tashlansinmi? Kiritilgan kirimlar o‘zgarmaydi.'))return;
    api({action:'removeProduct',branchId:sel.value,supplierId:p.oldId,id:x.id}).then(function(r){done(r,'Ro‘yxatdan olib tashlandi')})})});
  document.getElementById('pAdd').addEventListener('click',function(){productForm('list')});
}
`;
