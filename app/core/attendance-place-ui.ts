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
  box.innerHTML='<div class="card"><h2>📍 Oshxona joyi</h2>'
    +'<p class="hint">Yoqilsa, xodim «ISHNI BOSHLADIM / TUGATDIM»ni faqat oshxona yaqinida bosa oladi. Xodimning joylashuvi saqlanmaydi — faqat necha metr uzoqda bo‘lgani yoziladi. Har filial uchun alohida.</p>'
    +state
    +'<button class="block" id="plHere" style="margin-top:12px">📍 Hozir turgan joyim — oshxona</button><p class="hint" style="margin:6px 0 12px">Oshxonada turib bosing. Telefon joylashuvga ruxsat so‘raydi.</p><div id="plGeo"></div>'
    +'<label class="field" style="margin-bottom:6px"><span>Yoki manzil / joy nomi bo‘yicha topish</span><input id="plQ" maxlength="120" placeholder="Masalan: 인천 남동구 구월로 123" enterkeyhint="search"></label>'
    +'<div class="row" style="margin-bottom:6px"><button class="ghost" id="plFind">🔎 Topish</button><small class="hint" id="plKeyState" style="flex:1 1 160px;margin:0"></small></div>'
    +'<p class="hint" style="margin:0 0 12px">Manzilni koreyscha yozing (Kakao Map’dagi «주소»ni nusxalab qo‘ysangiz bo‘ladi) yoki do‘kon nomini yozing.</p>'
    +'<div id="plKeyBox"></div><div id="plRes" style="margin-bottom:12px"></div>'
    +'<label class="field"><span>Koordinata (kenglik, uzunlik)</span><input id="plLL" value="'+esc(ll)+'" placeholder="37.456300, 126.705200" inputmode="decimal"></label>'
    +'<p class="hint" style="margin:-6px 0 12px">Xaritadan nusxalab qo‘yish ham mumkin.'+(p.hasPoint?' <a href="https://map.kakao.com/link/map/Oshxona,'+p.lat+','+p.lng+'" target="_blank" rel="noopener">Kakao xaritada ko‘rish ↗</a> · <a href="https://www.google.com/maps?q='+p.lat+','+p.lng+'" target="_blank" rel="noopener">Google ↗</a>':'')+'</p>'
    +'<label class="field"><span>Necha metr ichida bosa oladi</span><input id="plR" inputmode="numeric" value="'+p.radius+'"></label>'
    +'<label class="row" style="gap:8px;margin-bottom:12px;flex-wrap:nowrap"><input type="checkbox" id="plOn"'+(p.enabled||!p.hasPoint?' checked':'')+' style="width:20px;height:20px;min-height:auto;flex:0 0 auto"> <span>Cheklov yoqilgan</span></label>'
    +'<div class="row"><button id="plSave">Saqlash</button><button class="ghost" id="plClose"'+(window.JOY?' hidden':'')+'>Yopish</button></div><div id="plMsg">'+(note||'')+'</div>'
    +'<h3 style="font-size:15px;margin:18px 0 4px">Oxirgi urinishlar</h3>'
    +(r.log.length?r.log.map(function(x){return '<div class="list-row"><div style="min-width:0"><b style="font-size:15px">'+esc(x.staffName)+' · '+esc(ACT[x.action]||x.action)+'</b>'+(x.ok?'':'<span class="tag bad">rad etildi</span>')+'<br><small style="color:var(--muted)">'+esc(when(x.at))+(x.ok?'':' · '+esc(WHY[x.reason]||x.reason))+(x.accuracy!=null?' · GPS ±'+x.accuracy+' m':'')+'</small></div><b style="white-space:nowrap">'+esc(dist(x.distance))+'</b></div>'}).join('')
      :'<p class="hint">Hali yo‘q. Cheklov yoqilgach, har bosilgan «Keldim / Ketdim» shu yerda ko‘rinadi.</p>')
    +'</div>';
  document.getElementById('plClose').addEventListener('click',function(){box.innerHTML=''});
  /* Manzil bo'yicha qidirish (Kakao). Kalit bir marta kiritiladi va sahifaga qaytarilmaydi. */
  var GEO=r.geo||{hasKey:false};
  function keyState(){document.getElementById('plKeyState').innerHTML=GEO.hasKey?'Kakao kaliti kiritilgan ✓ · <a href="#" id="plKeyChange">almashtirish</a>':GEO.viaShop?'Telegram do‘kon orqali qidiriladi ✓ — kalit kerak emas':'Kakao kaliti hali kiritilmagan';
    var ch=document.getElementById('plKeyChange');if(ch)ch.addEventListener('click',function(e){e.preventDefault();keyForm('')})}
  function keyForm(why){
    var kb=document.getElementById('plKeyBox');
    kb.innerHTML='<div class="card" style="margin:0 0 12px"><h2 style="font-size:17px">Kakao kaliti (bir marta)</h2>'+(why?'<div class="msg warn">'+esc(why)+'</div>':'')
      +'<p class="hint">Koreya manzilini binogacha aniq topish uchun kerak. Telegram do‘koningizda manzil uchun ishlatilgan o‘sha kalit: <b>developers.kakao.com</b> → 내 애플리케이션 → ilovangiz → 앱 키 → <b>REST API 키</b>. Kalit shu saytda saqlanadi va qayta ko‘rsatilmaydi.</p>'
      +'<label class="field"><span>REST API 키</span><input id="plKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="90"></label>'
      +'<div class="row"><button id="plKeySave">Kalitni saqlash</button><button class="ghost" id="plKeyNo">Bekor</button>'+(GEO.hasKey?'<button class="ghost" id="plKeyDel">Kalitni o‘chirish</button>':'')+'</div><div id="plKeyMsg"></div></div>';
    document.getElementById('plKeyNo').addEventListener('click',function(){kb.innerHTML=''});
    var del=document.getElementById('plKeyDel');if(del)del.addEventListener('click',function(){if(!confirm('Kakao kaliti o‘chirilsinmi? Manzil bo‘yicha qidirish ishlamay qoladi; saqlangan joy o‘zgarmaydi.'))return;
      api({action:'removeGeoKey',branchId:sel.value}).then(function(x){if(x.ok){GEO=x.geo;kb.innerHTML='';keyState()}})});
    document.getElementById('plKeySave').addEventListener('click',function(){var btn=this,km=document.getElementById('plKeyMsg'),v=document.getElementById('plKey').value.trim();
      if(!v){km.innerHTML='<div class="msg bad" style="margin-top:10px">Kalitni qo‘ying.</div>';return}
      btn.disabled=true;km.innerHTML='<div class="msg warn" style="margin-top:10px">Kakao’da tekshirilmoqda…</div>';
      api({action:'saveGeoKey',branchId:sel.value,key:v}).then(function(x){btn.disabled=false;
        if(!x.ok){km.innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(x.error||'Saqlanmadi.')+'</div>';return}
        GEO=x.geo;kb.innerHTML='<div class="msg ok" style="margin-bottom:12px">✓ Kalit saqlandi. Endi manzilni yozib «Topish»ni bosing.</div>';keyState();
        if(document.getElementById('plQ').value.trim())find()})});
    kb.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function find(){
    var q=document.getElementById('plQ').value.trim(),res=document.getElementById('plRes'),btn=document.getElementById('plFind');
    if(q.length<2){res.innerHTML='<div class="msg bad">Manzil yoki joy nomini yozing.</div>';return}
    if(!GEO.hasKey&&!GEO.viaShop){keyForm('Avval Kakao kalitini kiriting — keyin qidiruv ishlaydi.');return}
    btn.disabled=true;res.innerHTML='<p class="hint">Qidirilmoqda…</p>';
    api({action:'geocode',branchId:sel.value,query:q}).then(function(x){btn.disabled=false;
      if(!x.ok){if(x.code==='NO_KEY'||(x.code==='BAD_KEY'&&GEO.hasKey)){GEO={hasKey:x.code!=='NO_KEY',viaShop:false};keyState();res.innerHTML='';keyForm(x.error);return}res.innerHTML='<div class="msg bad">'+esc(x.error||'Topilmadi.')+'</div>';return}
      var list=x.results||[];
      if(!list.length){res.innerHTML='<div class="msg warn">Hech narsa topilmadi. Manzilni koreyscha, Kakao Map’dagidek yozib ko‘ring yoki do‘kon nomini yozing.</div>';return}
      res.innerHTML='<p class="hint" style="margin:0 0 4px">'+list.length+' ta joy topildi — o‘zingiznikini tanlang:</p>'+list.map(function(g,i){
        return '<div class="list-row"><div style="min-width:0"><b style="font-size:15px">'+esc(g.label)+'</b><br><small style="color:var(--muted)">'+(g.address&&g.address!==g.label?esc(g.address)+' · ':'')+'<a href="https://map.kakao.com/link/map/'+encodeURIComponent(g.label)+','+g.lat+','+g.lng+'" target="_blank" rel="noopener">xaritada ko‘rish ↗</a></small></div><button data-pick="'+i+'" style="min-height:38px;padding:4px 12px;white-space:nowrap">Shu joy</button></div>'}).join('');
      res.querySelectorAll('[data-pick]').forEach(function(b){b.addEventListener('click',function(){var g=list[Number(b.dataset.pick)];
        document.getElementById('plLL').value=g.lat.toFixed(6)+', '+g.lng.toFixed(6);
        res.innerHTML='<div class="msg ok">✓ Tanlandi: '+esc(g.label)+'. <a href="https://map.kakao.com/link/map/'+encodeURIComponent(g.label)+','+g.lat+','+g.lng+'" target="_blank" rel="noopener">Xaritada tekshiring ↗</a>, keyin pastdagi «Saqlash»ni bosing.</div>';
        document.getElementById('plSave').scrollIntoView({behavior:'smooth',block:'center'})})});
    });
  }
  keyState();
  document.getElementById('plFind').addEventListener('click',find);
  document.getElementById('plQ').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();find()}});
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
