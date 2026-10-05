/**
 * Maosh sahifasi uchun: «Keldim / ketdim joyi» oynasi — rahbar oshxona nuqtasini va masofani belgilaydi,
 * oxirgi urinishlarni ko'radi (brauzer skripti). Sahifadagi mavjud yordamchilardan foydalanadi: esc, api, sel, hm, digits.
 * Diqqat: bu matn ichida teskari tirnoq va dollar-qavs ishlatilmaydi (sahifa skriptiga qo'shiladi).
 */
export const ATTENDANCE_PLACE_SCRIPT = String.raw`
/* ---------- Keldim / ketdim joyi (oshxona) ---------- */
function placeBox(note){
  var box=document.getElementById('staffBox');box.innerHTML='<p class="hint" style="margin-top:12px">Yuklanmoqda…</p>';
  api({action:'place',branchId:sel.value}).then(function(r){drawPlace(r,note)});
}
function drawPlace(r,note){
  var box=document.getElementById('staffBox');
  if(!r.ok){box.innerHTML='<div class="msg bad" style="margin-top:12px">'+esc(r.error||'Ochilmadi.')+'</div>';return}
  var p=r.place,ll=p.hasPoint?p.lat.toFixed(6)+', '+p.lng.toFixed(6):'';
  var state=p.enabled?'<div class="msg ok">✓ Yoqilgan — xodim faqat shu nuqtadan '+p.radius+' metr ichida bosa oladi</div>'
    :p.hasPoint?'<div class="msg warn">O‘chirilgan — xodim istalgan joydan bosa oladi</div>'
    :'<div class="msg warn">Oshxona joyi hali belgilanmagan — xodim istalgan joydan bosa oladi</div>';
  var ACT={'clock-in':'Keldim','clock-out':'Ketdim'},WHY={TOO_FAR:'uzoqda',LOCATION_WEAK:'GPS aniq emas',LOCATION_REQUIRED:'joylashuv berilmadi'};
  var when=function(iso){try{return new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Seoul',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
  var dist=function(m){return m==null?'':m>=1000?(m/1000).toFixed(1)+' km':m+' m'};
  box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:12px"><h2>📍 Keldim / ketdim joyi</h2>'
    +'<p class="hint">Yoqilsa, xodim «ISHNI BOSHLADIM / TUGATDIM»ni faqat oshxona yaqinida bosa oladi. Xodimning joylashuvi saqlanmaydi — faqat necha metr uzoqda bo‘lgani yoziladi. Har filial uchun alohida.</p>'
    +state
    +'<button class="block" id="plHere" style="margin-top:12px">📍 Hozir turgan joyim — oshxona</button><p class="hint" style="margin:6px 0 12px">Oshxonada turib bosing. Telefon joylashuvga ruxsat so‘raydi.</p><div id="plGeo"></div>'
    +'<label class="field"><span>Koordinata (kenglik, uzunlik)</span><input id="plLL" value="'+esc(ll)+'" placeholder="37.456300, 126.705200" inputmode="decimal"></label>'
    +'<p class="hint" style="margin:-6px 0 12px">Xaritadan nusxalab qo‘yish ham mumkin.'+(p.hasPoint?' <a href="https://map.kakao.com/link/map/Oshxona,'+p.lat+','+p.lng+'" target="_blank" rel="noopener">Kakao xaritada ko‘rish ↗</a> · <a href="https://www.google.com/maps?q='+p.lat+','+p.lng+'" target="_blank" rel="noopener">Google ↗</a>':'')+'</p>'
    +'<label class="field"><span>Necha metr ichida bosa oladi</span><input id="plR" inputmode="numeric" value="'+p.radius+'"></label>'
    +'<label class="row" style="gap:8px;margin-bottom:12px;flex-wrap:nowrap"><input type="checkbox" id="plOn"'+(p.enabled||!p.hasPoint?' checked':'')+' style="width:20px;height:20px;min-height:auto;flex:0 0 auto"> <span>Cheklov yoqilgan</span></label>'
    +'<div class="row"><button id="plSave">Saqlash</button><button class="ghost" id="plClose">Yopish</button></div><div id="plMsg">'+(note||'')+'</div>'
    +'<h3 style="font-size:15px;margin:18px 0 4px">Oxirgi urinishlar</h3>'
    +(r.log.length?r.log.map(function(x){return '<div class="list-row"><div style="min-width:0"><b style="font-size:15px">'+esc(x.staffName)+' · '+esc(ACT[x.action]||x.action)+'</b>'+(x.ok?'':'<span class="tag bad">rad etildi</span>')+'<br><small style="color:var(--muted)">'+esc(when(x.at))+(x.ok?'':' · '+esc(WHY[x.reason]||x.reason))+(x.accuracy!=null?' · GPS ±'+x.accuracy+' m':'')+'</small></div><b style="white-space:nowrap">'+esc(dist(x.distance))+'</b></div>'}).join('')
      :'<p class="hint">Hali yo‘q. Cheklov yoqilgach, har bosilgan «Keldim / Ketdim» shu yerda ko‘rinadi.</p>')
    +'</div>';
  document.getElementById('plClose').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('plHere').addEventListener('click',function(){
    var g=document.getElementById('plGeo'),btn=this;
    if(!navigator.geolocation){g.innerHTML='<div class="msg bad">Bu qurilma joylashuvni bera olmaydi. Koordinatani xaritadan kiriting.</div>';return}
    btn.disabled=true;g.innerHTML='<div class="msg warn">Joylashuv aniqlanmoqda…</div>';
    var over=false,guard=setTimeout(function(){if(over)return;over=true;btn.disabled=false;g.innerHTML='<div class="msg bad">Joylashuvga ruxsat berilmadi. Telefon sozlamalarida brauzer uchun joylashuvni yoqing yoki koordinatani xaritadan kiriting.</div>'},30000);
    navigator.geolocation.getCurrentPosition(function(pos){if(over)return;over=true;clearTimeout(guard);btn.disabled=false;var a=Math.round(pos.coords.accuracy);
      document.getElementById('plLL').value=pos.coords.latitude.toFixed(6)+', '+pos.coords.longitude.toFixed(6);
      g.innerHTML=a>50?'<div class="msg warn">Joylashuv olindi, lekin aniqligi past (±'+a+' m). Ochiqroq joyda qayta bosing yoki koordinatani xaritadan tekshiring. Keyin «Saqlash»ni bosing.</div>'
        :'<div class="msg ok">✓ Joylashuv olindi (±'+a+' m). Endi «Saqlash»ni bosing.</div>'},
      function(e){if(over)return;over=true;clearTimeout(guard);btn.disabled=false;g.innerHTML='<div class="msg bad">'+(e&&e.code===1?'Joylashuvga ruxsat berilmadi. Telefon sozlamalarida brauzer uchun joylashuvni yoqing.':'Joylashuv aniqlanmadi. GPS yoqilganini tekshiring yoki koordinatani xaritadan kiriting.')+'</div>'},
      {enableHighAccuracy:true,timeout:20000,maximumAge:0});
  });
  document.getElementById('plSave').addEventListener('click',function(){
    var msg=document.getElementById('plMsg'),raw=document.getElementById('plLL').value.trim(),on=document.getElementById('plOn').checked,btn=this;
    var m=raw.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if(raw&&!m){msg.innerHTML='<div class="msg bad" style="margin-top:10px">Koordinatani shunday yozing: 37.456300, 126.705200</div>';return}
    if(!raw&&on){msg.innerHTML='<div class="msg bad" style="margin-top:10px">Avval oshxona joyini belgilang.</div>';return}
    var body={action:'savePlace',branchId:sel.value,radius:digits(document.getElementById('plR').value),enabled:on};
    if(m){body.lat=Number(m[1]);body.lng=Number(m[2])}
    if(!confirm(on?'Cheklov yoqilsinmi? Xodimlar «Keldim / Ketdim»ni faqat shu nuqtadan '+body.radius+' metr ichida bosa oladi.':'Cheklov o‘chirilsinmi? Xodimlar istalgan joydan bosa oladi.'))return;
    btn.disabled=true;
    api(body).then(function(x){btn.disabled=false;if(!x.ok){msg.innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(x.error||'Saqlanmadi.')+'</div>';return}drawPlace(x,'<div class="msg ok" style="margin-top:10px">✓ Saqlandi</div>')});
  });
}
`;
