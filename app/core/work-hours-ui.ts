/**
 * Maosh sahifasi uchun: «Qat'iy ish vaqti» oynasi — rahbar har bir xodimga ish boshlanish (ixtiyoriy: tugash) vaqtini
 * belgilaydi (brauzer skripti). Sahifadagi mavjud yordamchilardan foydalanadi: esc, api, sel.
 * Diqqat: bu matn ichida teskari tirnoq va dollar-qavs ishlatilmaydi (sahifa skriptiga qo'shiladi).
 */
export const WORK_HOURS_STYLE = String.raw`<style>
.wh-item{padding:14px 0;border-bottom:1px solid var(--line)}
.wh-list .wh-item:first-child{padding-top:0}
.wh-list .wh-item:last-child{border-bottom:0;padding-bottom:0}
.wh-name{display:flex;align-items:center;flex-wrap:wrap;gap:4px 0;margin-bottom:8px;font-size:16.5px}
.wh-row{display:flex;gap:8px;align-items:flex-end;flex-wrap:nowrap}
.wh-row .field{flex:1 1 0;min-width:0;margin:0}
.wh-row input[type=time]{width:100%;min-width:0}
.wh-name .wh-x{margin-left:auto;min-height:36px;padding:2px 12px;font-size:13.5px}
.wh-say{display:block;margin:8px 0 0;font-size:13.5px;color:var(--muted)}
.wh-rules{margin:0;padding-left:20px;color:var(--muted);font-size:14.5px;line-height:1.5}
.wh-rules li{margin:0 0 6px}
</style>`;

export const WORK_HOURS_SCRIPT = String.raw`
/* ---------- Qat'iy ish vaqti ---------- */
function hoursBox(note){
  var box=document.getElementById('staffBox');box.innerHTML='<p class="hint" style="margin-top:12px">Yuklanmoqda…</p>';
  api({action:'hours',branchId:sel.value}).then(function(r){drawHours(r,note)});
}
function whSay(s,e){
  if(!s&&!e)return 'Qoida yo‘q — bosgan vaqtidan hisoblanadi.';
  if(!s)return 'Avval boshlanish vaqtini yozing.';
  if(!e)return s+' dan oldin kelsa ham, hisob '+s+' dan boshlanadi.';
  return 'Hisob faqat '+s+'–'+e+' ichida yuradi: erta kelsa '+s+' dan, '+e+' dan keyin qolsa — hisoblanmaydi.';
}
function drawHours(r,note){
  var box=document.getElementById('staffBox');
  if(!r.ok){box.innerHTML='<div class="msg bad" style="margin-top:12px">'+esc(r.error||'Ochilmadi.')+'</div>';return}
  var list=r.hours,on=list.filter(function(m){return m.start}).length;
  var row=function(m){
    return '<div class="wh-item" data-wh="'+esc(m.id)+'"><div class="wh-name"><b>'+esc(m.name)+'</b><span class="tag" data-tag></span>'+(m.hasAccount?'':'<span class="tag warn">akkaunt yo‘q</span>')+'<button class="ghost wh-x" data-x aria-label="'+esc(m.name)+' — vaqtni tozalash">Tozalash</button></div>'
      +'<div class="wh-row"><label class="field"><span>Ish boshlanishi</span><input type="time" data-s value="'+esc(m.start)+'"></label>'
      +'<label class="field"><span>Tugashi (ixtiyoriy)</span><input type="time" data-e value="'+esc(m.end)+'"></label>'
      +'</div>'
      +'<small class="wh-say" data-say></small></div>';
  };
  box.innerHTML='<section class="card" id="whSum"><div class="total">'+on+' / '+list.length+'</div><p class="hint" style="margin:0">xodimda qat’iy ish vaqti bor. Xodim erta kelib «ISHNI BOSHLADIM»ni bossa ham, hisob belgilangan vaqtdan boshlanadi.</p></section>'
    +(list.length
      ?'<section class="card" id="whAllCard"><h2>Hammaga bir xil vaqt</h2><div class="wh-row"><label class="field"><span>Ish boshlanishi</span><input type="time" id="whAllS"></label><label class="field"><span>Tugashi (ixtiyoriy)</span><input type="time" id="whAllE"></label></div>'
        +'<button class="ghost block" id="whAll" style="margin-top:12px">Hammaga qo‘yish</button><p class="hint" style="margin:8px 0 0">Pastdagi ro‘yxatni to‘ldiradi — keyin «Saqlash»ni bosing.</p></section>'
        +'<section class="card" id="whList"><h2>Xodimlar</h2><div class="wh-list">'+list.map(row).join('')+'</div>'
        +'<button class="block" id="whSave" style="margin-top:14px">Saqlash</button><div id="whMsg">'+(note||'')+'</div></section>'
      :'<section class="card"><p class="hint" style="margin:0">Xodim yo‘q. Avval Maosh → «Xodimlar ro‘yxati va stavkalar» orqali qo‘shing.</p></section>')
    +'<section class="card fold"><details><summary><span><b>Qoidalar</b><small>Qachon qanday hisoblanadi</small></span></summary><ul class="wh-rules">'
    +'<li><b>Erta kelsa</b> — hisob belgilangan boshlanish vaqtidan.</li>'
    +'<li><b>Kech kelsa</b> — bosgan vaqtidan.</li>'
    +'<li><b>Tugash vaqti yozilsa</b> — undan keyingi vaqt hisoblanmaydi. Bo‘sh qolsa — ketgan vaqtigacha hisoblanadi.</li>'
    +'<li>Kelgan va ketgan <b>asl vaqt</b> o‘chmaydi — yozuvlarda ko‘rinib turadi.</li>'
    +'<li>Yangi vaqt <b>keyingi «ISHNI BOSHLADIM»dan</b> ishlaydi. Oldingi kunlar o‘zgarmaydi.</li>'
    +'<li>Rahbar qo‘lda kiritgan kunlar («Ishlagan kunlar») to‘liq hisoblanadi.</li>'
    +'<li><b>Bir kunlik istisno</b> (xodimni o‘zingiz erta chaqirgan bo‘lsangiz): Maosh → xodim → «Yozuvlar / tuzatish» → smena ✏️ → «Bu smenada qat’iy vaqt qo‘llanmasin».</li>'
    +'</ul></details></section>';
  var items=box.querySelectorAll('[data-wh]');
  var paint=function(el){var s=el.querySelector('[data-s]').value,e=el.querySelector('[data-e]').value,tag=el.querySelector('[data-tag]');
    el.querySelector('[data-say]').textContent=whSay(s,e);tag.textContent=s?'qat’iy':'erkin';tag.className='tag'+(s?' ok':'');el.querySelector('[data-x]').hidden=!s&&!e};
  items.forEach(function(el){paint(el);
    el.querySelector('[data-s]').addEventListener('input',function(){paint(el)});
    el.querySelector('[data-e]').addEventListener('input',function(){paint(el)});
    el.querySelector('[data-x]').addEventListener('click',function(){el.querySelector('[data-s]').value='';el.querySelector('[data-e]').value='';paint(el)})});
  if(!list.length)return;
  var msg=document.getElementById('whMsg');
  document.getElementById('whAll').addEventListener('click',function(){
    var s=document.getElementById('whAllS').value,e=document.getElementById('whAllE').value;
    if(!s){msg.innerHTML='<div class="msg bad">Avval «Ish boshlanishi» vaqtini yozing.</div>';document.getElementById('whAllS').focus();return}
    items.forEach(function(el){el.querySelector('[data-s]').value=s;el.querySelector('[data-e]').value=e;paint(el)});
    msg.innerHTML='<div class="msg warn">Ro‘yxat to‘ldirildi — hali saqlanmagan. «Saqlash»ni bosing.</div>';
    document.getElementById('whSave').scrollIntoView({behavior:'smooth',block:'center'});
  });
  document.getElementById('whSave').addEventListener('click',function(){
    var btn=this,out=[];
    items.forEach(function(el){out.push({id:el.dataset.wh,start:el.querySelector('[data-s]').value,end:el.querySelector('[data-e]').value})});
    btn.disabled=true;
    api({action:'saveHours',branchId:sel.value,items:out}).then(function(x){btn.disabled=false;
      if(!x.ok){msg.innerHTML='<div class="msg bad">'+esc(x.error||'Saqlanmadi.')+'</div>';return}
      drawHours(x,'<div class="msg ok">✓ Saqlandi'+(x.changed?' — '+x.changed+' xodimda o‘zgardi. Keyingi «ISHNI BOSHLADIM»dan ishlaydi.':' — o‘zgarish yo‘q.')+'</div>')});
  });
}
`;
