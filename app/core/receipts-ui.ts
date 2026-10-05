/**
 * Yetkazib beruvchilar sahifasi uchun (brauzer skripti):
 *  - «Yangi kirim» — avval "kimdan keldi" tanlanadi (yetkazib beruvchi yoki Bozor / naqd);
 *  - «To'lovi yozilmagan kirimlar» — omborga kirgan, lekin puli yozilmagan kirimni qarzga yoki to'landi deb yopish;
 *  - «Shu oy kirimlari» — tarix va xato kirimni olib tashlash.
 * Sahifadagi mavjud yordamchilardan foydalanadi: esc, won, api, sel, PARTIES, ACCOUNTS, load, openStatement, openIntake, haloRemove.
 * Diqqat: bu matn ichida teskari tirnoq va dollar-qavs ishlatilmaydi (sahifa skriptiga qo'shiladi).
 */
export const RECEIPTS_SCRIPT = String.raw`
var MARKET='',PEND=[],HIST=[],AFTER=null,PSHOW=5,PFLASH='';
function isMarket(partyId){var p=PARTIES[partyId];return !!p&&!!MARKET&&p.oldId===MARKET}
function partyOfSupplier(id){for(var k in PARTIES){if(PARTIES[k].oldId===id)return k}return ''}
function realParties(){return Object.keys(PARTIES).filter(function(k){return !isMarket(k)})}

/* ---------- Yangi kirim: kimdan keldi ---------- */
function startIntake(partyId){document.getElementById('pick').innerHTML='';AFTER=function(){openIntake(partyId)};openStatement(partyId)}
function startMarket(){
  var msg=document.getElementById('pkMsg');if(msg)msg.innerHTML='<p class="hint">Ochilmoqda…</p>';
  api({action:'market',branchId:sel.value}).then(function(r){
    if(!r.ok){if(msg)msg.innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(r.error||'Ochilmadi.')+'</div>';return}
    MARKET=r.supplierId;
    load(function(){var k=partyOfSupplier(MARKET);if(k)startIntake(k)});
  });
}
function pickSupplier(){
  var box=document.getElementById('pick'),keys=realParties();
  box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:12px"><h2>Mahsulot kimdan keldi?</h2>'
    +'<div class="nk-chips">'+keys.map(function(k){var p=PARTIES[k];return '<button class="ghost" data-pk="'+esc(k)+'"><b>'+esc(p.name)+'</b><small>'+(p.ledgerBalance>0?'qarz '+won(p.ledgerBalance):'qarz yo‘q')+'</small></button>'}).join('')
    +'<button class="ghost" data-pk="__market"><b>🛒 Bozor / naqd</b><small>yetkazib beruvchisiz</small></button></div>'
    +'<div class="row"><button class="ghost" id="pkNew">+ Yangi yetkazib beruvchi</button><button class="ghost" id="pkX">Bekor</button></div><div id="pkMsg"></div></div>';
  box.querySelectorAll('[data-pk]').forEach(function(b){b.addEventListener('click',function(){if(b.dataset.pk==='__market')startMarket();else startIntake(b.dataset.pk)})});
  document.getElementById('pkX').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('pkNew').addEventListener('click',function(){box.innerHTML='';document.getElementById('addSup').click();document.getElementById('supForm').scrollIntoView({behavior:'smooth',block:'center'})});
  box.scrollIntoView({behavior:'smooth',block:'nearest'});
}

/* ---------- To'lovi yozilmagan kirimlar ---------- */
function drawPending(){
  var card=document.getElementById('pendCard');
  if(!PEND.length){card.hidden=!PFLASH;card.innerHTML=PFLASH;PFLASH='';return}
  card.hidden=false;
  var total=PEND.reduce(function(s,r){return s+r.amount},0),list=PEND.slice(0,PSHOW);
  card.innerHTML='<h2>⏳ To‘lovi yozilmagan kirimlar ('+PEND.length+')</h2>'
    +'<p class="hint">Omborga kirgan, lekin kimdan olingani va puli hali yozilmagan (xodim qabul qilgan yoki oldin to‘lovsiz kiritilgan). Har birini bir marta yozing: qarzga yoki to‘landi. Jami '+won(total)+'.</p>'
    +list.map(function(r){return '<div class="list-row" style="align-items:flex-start"><div style="min-width:0"><b style="overflow-wrap:anywhere">'+esc(r.lines)+'</b><br><small style="color:var(--muted)">'+esc(r.date)+(r.by?' · '+esc(r.by):'')+(r.supplierName?' · '+esc(r.supplierName):'')+(r.veg?' · sabzavot / sous':'')+'</small></div>'
      +'<div style="text-align:right"><b>'+won(r.amount)+'</b><br><button data-ps="'+esc(r.key)+'" style="min-height:36px;padding:2px 14px;margin-top:4px">Yozish</button></div><div data-pf="'+esc(r.key)+'" style="grid-column:1/-1"></div></div>'}).join('')
    +(PEND.length>PSHOW?'<button class="ghost block" id="pMore" style="margin-top:10px">Yana '+(PEND.length-PSHOW)+' tasini ko‘rsatish</button>':'')
    +(PEND.length>5?'<button class="ghost block" id="pAll" style="margin-top:10px">Bularning puli oldin yozilgan — ro‘yxatni tozalash</button>':'')
    +'<div id="pMsg">'+PFLASH+'</div>';
  PFLASH='';
  card.querySelectorAll('[data-ps]').forEach(function(b){b.addEventListener('click',function(){settleForm(b.dataset.ps)})});
  var more=document.getElementById('pMore');if(more)more.addEventListener('click',function(){PSHOW=PEND.length;drawPending()});
  var all=document.getElementById('pAll');if(all)all.addEventListener('click',function(){
    if(!confirm(PEND.length+' ta kirim ro‘yxatdan olinadi: ularga qarz yoki to‘lov yozilmaydi. Ombor o‘zgarmaydi. Puli haqiqatan oldin yozilganmi?'))return;
    all.disabled=true;api({action:'dismiss',branchId:sel.value,all:true,note:'Puli oldin yozilgan (hammasi)'}).then(function(r){
      if(!r.ok){all.disabled=false;document.getElementById('pMsg').innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(r.error||'Bo‘lmadi.')+'</div>';return}
      PFLASH='<div class="msg ok">✓ Ro‘yxat tozalandi ('+r.count+' ta). Yangi kirimlar yana shu yerda chiqadi.</div>';load()})});
}
function settleForm(key){
  var r=PEND.filter(function(x){return x.key===key})[0],box=null;
  document.querySelectorAll('[data-pf]').forEach(function(el){if(el.dataset.pf===key)box=el;else el.innerHTML=''});
  if(!r||!box)return;
  var S={sup:r.supplierId||'',pay:'debt',acc:(ACCOUNTS[0]||{}).id||''};
  function draw(note){
    var market=S.sup===MARKET;if(market)S.pay='paid';
    box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:10px">'
      +'<label class="field"><span>Kimdan olingan</span><select id="sSup"><option value="">— tanlang —</option>'
      +realParties().map(function(k){var p=PARTIES[k];return '<option value="'+esc(p.oldId)+'"'+(p.oldId===S.sup?' selected':'')+'>'+esc(p.name)+'</option>'}).join('')
      +'<option value="'+esc(MARKET)+'"'+(market?' selected':'')+'>🛒 Bozor / naqd (yetkazib beruvchisiz)</option></select></label>'
      +'<div class="nk-pay" style="grid-template-columns:1fr 1fr"><button class="'+(S.pay==='debt'?'':'ghost')+'" data-sp="debt"'+(market?' disabled':'')+'>Qarzga</button><button class="'+(S.pay==='paid'?'':'ghost')+'" data-sp="paid">To‘landi</button></div>'
      +(S.pay==='paid'?(ACCOUNTS.length?'<label class="field" style="margin-top:10px"><span>Qaysi hisobdan to‘landi</span><select id="sAcc">'+ACCOUNTS.map(function(a){return '<option value="'+esc(a.id)+'"'+(a.id===S.acc?' selected':'')+'>'+esc(a.name)+'</option>'}).join('')+'</select></label>':'<div class="msg bad" style="margin-top:10px">Kassa yoki bank hisobi topilmadi.</div>'):'')
      +'<p class="hint" style="margin:10px 0">'+won(r.amount)+' · '+esc(r.date)+' — '+(S.pay==='paid'?'pul tanlangan hisobdan chiqadi, qarz oshmaydi.':'yetkazib beruvchiga qarz shuncha oshadi.')+' Mahsulot omborga qayta kirmaydi.</p>'
      +'<div class="row"><button id="sSave">Saqlash</button><button class="ghost" id="sCancel">Bekor</button></div>'
      +'<button class="ghost block" id="sSkip" style="margin-top:10px">Yozuv kerak emas (puli oldin yozilgan)</button><div id="sMsg">'+(note||'')+'</div></div>';
    document.getElementById('sSup').addEventListener('change',function(){S.sup=this.value;draw()});
    box.querySelectorAll('[data-sp]').forEach(function(b){b.addEventListener('click',function(){S.pay=b.dataset.sp;draw()})});
    var acc=document.getElementById('sAcc');if(acc)acc.addEventListener('change',function(){S.acc=acc.value});
    document.getElementById('sCancel').addEventListener('click',function(){box.innerHTML=''});
    document.getElementById('sSave').addEventListener('click',function(){save('')});
    document.getElementById('sSkip').addEventListener('click',function(){
      if(!confirm('Bu kirimga qarz ham, to‘lov ham yozilmaydi. Ombor o‘zgarmaydi. Ro‘yxatdan olinsinmi?'))return;
      api({action:'dismiss',branchId:sel.value,keys:[key],note:'Yozuv kerak emas'}).then(function(x){
        if(!x.ok){bad(x.error||'Bo‘lmadi.');return}PFLASH='<div class="msg ok" style="margin-top:10px">✓ Ro‘yxatdan olindi.</div>';load()})});
  }
  function bad(t){var m=document.getElementById('sMsg');if(m)m.innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(t)+'</div>'}
  function save(reason){
    if(!S.sup){bad('Kimdan olinganini tanlang.');return}
    if(S.pay==='paid'&&!S.acc){bad('Pul qaysi hisobdan to‘langanini tanlang.');return}
    var name=S.sup===MARKET?'Bozor / naqd':((PARTIES[partyOfSupplier(S.sup)]||{}).name||'');
    var accName=(ACCOUNTS.filter(function(a){return a.id===S.acc})[0]||{}).name||'';
    if(!reason&&!confirm(name+' · '+won(r.amount)+' · '+r.date+' · '+(S.pay==='paid'?'to‘landi ('+accName+')':'qarzga')+'. Saqlansinmi?'))return;
    var btn=document.getElementById('sSave');btn.disabled=true;
    api({action:'settle',branchId:sel.value,key:key,supplierId:S.sup,pay:S.pay,accountId:S.pay==='paid'?S.acc:'',duplicateReason:reason||undefined}).then(function(x){
      btn.disabled=false;
      if(x.ok){PFLASH='<div class="msg ok" style="margin-top:10px">✓ Yozildi: '+esc(x.supplierName||name)+' · '+won(x.amount)+(x.paid?' · to‘landi':' · qarzga')+'</div>';load();return}
      if(x.code==='DUPLICATE'&&!reason){var why=prompt((x.error||'Shunday yozuv bor.')+'\n\nO‘sha yozuv shu kirimniki bo‘lsa — «Bekor» bosing va «Yozuv kerak emas»ni tanlang. Boshqa xarid bo‘lsa, sababini yozing:');if(why&&why.trim())save(why.trim());return}
      bad(x.error||'Saqlanmadi.');
    });
  }
  draw();box.scrollIntoView({behavior:'smooth',block:'nearest'});
}

/* ---------- Shu oy kirimlari (tarix) ---------- */
function drawHistory(){
  var card=document.getElementById('histCard'),open=!!(card.querySelector('details')||{}).open;
  var total=HIST.reduce(function(s,r){return s+r.amount},0);
  card.innerHTML='<details'+(open?' open':'')+'><summary><span><b>🧾 Shu oy kirimlari</b><small>'+HIST.length+' ta · '+won(total)+'</small></span></summary>'
    +'<p class="hint">Shu oyda omborga kirgan hamma mahsulot. Xato kiritilgan bo‘lsa «Olib tashlash» — ombor, qarz va pul qanday o‘zgarishini oldin ko‘rsatadi.</p>'
    +(HIST.length?HIST.slice(0,80).map(function(r){return '<div class="list-row"><div style="min-width:0"><b style="overflow-wrap:anywhere">'+esc(r.lines||r.source)+'</b><br><small style="color:var(--muted)">'+esc(r.date)+' · '+esc(r.source)+(r.supplier?' · '+esc(r.supplier):'')+(r.veg?' · sabzavot / sous':'')+'</small>'+(r.money==='pending'?' <span class="tag warn" style="margin-left:0">to‘lovi yozilmagan</span>':r.money==='settled'?' <span class="tag ok" style="margin-left:0">puli yozilgan</span>':'')+'</div>'
      +'<div style="text-align:right"><b>'+won(r.amount)+'</b><br><button class="ghost" data-hr="'+esc(r.id)+'" style="min-height:30px;padding:2px 10px;margin-top:4px">Olib tashlash</button></div></div>'}).join(''):'<p class="hint">Bu oyda kirim yo‘q.</p>')
    +'</details>';
  card.querySelectorAll('[data-hr]').forEach(function(b){b.addEventListener('click',function(){var r=HIST.filter(function(x){return x.id===b.dataset.hr})[0];
    haloRemove({kind:'warehouse',id:b.dataset.hr,branch:sel.value,label:r?(r.lines||r.source)+' · '+won(r.amount)+' · '+r.date:'',done:function(){
      /* Puli alohida yozilgan kirim olib tashlansa, o'sha qarz / to'lov yozuvi o'zi o'chmaydi — rahbarga aytiladi. */
      if(r&&r.money==='settled')PFLASH='<div class="msg warn">Kirim olib tashlandi. Uning qarz / to‘lov yozuvi qoldi — yetkazib beruvchini bosib, «Yozuvlar / bekor qilish»dan uni ham olib tashlang.</div>';
      load()}})})});
}
`;
