/**
 * HALO monitor menyusi — televizor ekrani sahifasi (parolsiz, faqat o'qiydi).
 *
 * Bu YANGI DIZAYN EMAS. Ko'rinish eski digital menyu saytidagi (halo-digital-menu…chatgpt.site) bilan aynan bir xil:
 *  - CSS so'zma-so'z o'sha (app/core/tv-css.ts);
 *  - HTML tuzilishi o'sha (sarlavha, kartalar, TYPE/SIZE/PRICE jadvali, SET MENU tasmasi) — harfma-harf;
 *  - tartib o'sha: har taom navbat bilan katta ko'rsatiladi, hammasi o'tgach umumiy ko'rinish; uchala ekran
 *    server soati bo'yicha bir vaqtda almashadi (eng ko'p taomli ekran navbat uzunligini belgilaydi).
 * tests/v2-digital-menu.test.mjs shu sahifa eski saytdagi HTML bilan bir xil chiqishini tekshiradi.
 *
 * Farqi faqat ma'lumot manbasida: nom, variant va narx HALO Control'dan keladi.
 *  - Sahifa har 15 soniyada /api/v2/tv?data=1 dan so'raydi; menyu o'zgarmagan bo'lsa ekran qayta chizilmaydi.
 *  - Oxirgi muvaffaqiyatli menyu televizor xotirasida (localStorage) turadi: internet yoki baza vaqtincha ishlamasa,
 *    ekranda oxirgi menyu qoladi; aloqa qaytsa o'zi yangilanadi.
 *  - Sahifa hech narsa yozmaydi va hech qanday parol/kalit saqlamaydi.
 *
 * Skript eski televizor brauzerlari uchun (ES5: var, XMLHttpRequest) va ichida teskari chiziq ishlatilmaydi
 * (TypeScript matni ichida buzilmasin).
 */
import type { TvItem, TvView } from "./digital-menu";
import { TV_CSS } from "./tv-css";
import { TV_CSS_SAYQAL } from "./tv-css-sayqal";

export const TV_VERSION = "tv-3";

export interface TvPayload {
  title: string; bodyClass: string; brand: { mark: string; name: string; slogan: string };
  stage: string; footerClass: string; footer: string;
  cfg: { title: string; motionMs: number; overviewMs: number; pageMs: number; slots: number; offerIntervalMs: number; offerDurationMs: number; offerLabel: string };
}

const escText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (value: string) => escText(value).replace(/"/g, "&quot;");
const won = (amount: number) => `₩${Math.round(amount).toLocaleString("en-US")}`;
/** onerror ichidagi manzil: faqat qo'shtirnoqsiz, teskari chiziqsiz manzil (o'zimizning rasm yoki eski saytdagi rasm). */
const jsSafeUrl = (url: string) => (/^[A-Za-z0-9:/?&=%._~+-]+$/.test(url) ? url : "");

/** Eski ekran to'ri: 1–2 taom bir qatorda, 3–4 → 2×2, 5–6 → 3×2, 7–8 → 4×2. */
function grid(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  return { cols: 4, rows: 2 };
}

/**
 * Ko'rinish: "" — asl (eski saytdagi bilan aynan bir xil, odatiy); "premium" — o'sha ko'rinishning sayqallangan varianti
 * (joylashuv, ranglar va jadval o'sha; farqlari tv-css-sayqal.ts boshida yozilgan). Faqat manzilda &look=premium bo'lsa ishlaydi.
 */
export const LOOK_SAYQAL = "premium";
export const tvLook = (value: string | null | undefined) => (value === LOOK_SAYQAL ? LOOK_SAYQAL : "");

/** Sayqallangan variantda yozuvlar bir xil ko'rinishda: "chicken", "CHICKEN", "Chicken" → "Chicken" (ma'lumotning o'zi o'zgarmaydi). */
const sentence = (value: string) => { const text = value.toLowerCase(); return text.charAt(0).toUpperCase() + text.slice(1); };
/** Rahbar hali to'ldirmagan namuna tavsif ("Taom haqida qisqa ma'lumot") — sayqallangan variantda ekranga chiqarilmaydi. */
const isPlaceholder = (value: string) => value.toLowerCase().replace(/[‘’`ʻʼ']/g, "").replace(/\s+/g, " ").trim() === "taom haqida qisqa malumot";

function variantTable(item: TvItem, sayqal = false): string {
  const cell = (value: string) => escText(sayqal ? sentence(value) : value);
  return `<div class="variant-table"><div class="variant-head"><span>TYPE</span><span>SIZE</span><span>PRICE</span></div>${item.variants.map((variant) =>
    `<div class="variant-row"><span>${cell(variant.label)}</span><span>${cell(variant.size)}</span><strong class="variant-price"><em>${won(variant.price)}</em></strong></div>`).join("")}</div>`;
}

/**
 * Umumiy ko'rinishdagi narx. Asl ko'rinishda — faqat birinchi narx. Sayqallangan variantda 2–4 ta narxi bor taomda
 * hammasi kichik ro'yxat bo'lib chiqadi (SIZE + narx); undan ko'p bo'lsa birinchi narx va "~" (bundan boshlab).
 */
function priceBlock(item: TvItem, sayqal: boolean): string {
  const single = `<strong>${item.price > 0 ? won(item.price) : ""}</strong>`;
  if (!sayqal || item.variants.length < 2) return `<div class="price">${single}</div>`;
  if (item.variants.length > 4) return `<div class="price"><strong class="from">${won(item.price)}</strong></div>`;
  return `<div class="price list">${item.variants.map((variant) => `<div class="mini"><span>${escText(sentence(variant.size || variant.label))}</span><b>${won(variant.price)}</b></div>`).join("")}</div>`;
}

function image(src: string, fallback: string, lazy: boolean): string {
  const backup = jsSafeUrl(fallback);
  const first = src || backup;
  if (!first) return "";
  const onerror = src && backup ? ` onerror="this.onerror=null;this.src='${escAttr(backup)}'"` : "";
  return `<img ${lazy ? "data-src" : "src"}="${escAttr(first)}"${onerror} alt="" decoding="async">`;
}

function card(item: TvItem, fallback: string, lazy: boolean, sayqal = false): string {
  const about = sayqal && isPlaceholder(item.description) ? "" : item.description;
  const badge = item.badge ? `<b class="badge">${escText(item.badge)}</b>` : "";
  const sold = item.soldOut ? `<b class="soldout">${escText(item.soldOutText)}</b>` : "";
  return `<article class="menu-card">
        <div class="card-inner">
          <div class="photo">${image(item.image, fallback, lazy)}${badge}${sold}</div>
          <div class="copy">
            <div class="item-text"><h2>${escText(item.name)}</h2><p>${escText(about)}</p>${variantTable(item, sayqal)}</div>
            ${priceBlock(item, sayqal)}
          </div>
        </div>
      </article>`;
}

/** «Kun aksiyasi» sahifasi: eski CSS'dagi .daily-offer-page (katta rasm + nom, tarkib, narxlar jadvali). */
function offerPage(view: TvView, sayqal = false): string {
  if (!view.offer) return "";
  const item = view.offer.item;
  const about = sayqal && isPlaceholder(item.description) ? "" : item.description;
  return `<section id="daily-offer" class="daily-offer-page"><div class="combo-card"><div class="combo-photo">${image(item.image, view.screen.fallbackImage, false)}<b>${escText(view.offer.label)}</b></div>`
    + `<div class="combo-copy"><h2>${escText(item.name)}</h2><p>${escText(about)}</p>${variantTable(item, sayqal)}</div></div></section>`;
}

function stage(view: TvView, title: string, sayqal = false): string {
  const per = Math.max(1, view.screen.itemsPerPage);
  const pages: TvItem[][] = [];
  for (let index = 0; index < view.items.length; index += per) pages.push(view.items.slice(index, index + per));
  if (!pages.length) return `<div class="empty">Menyu tayyorlanmoqda</div>${offerPage(view, sayqal)}`;
  return pages.map((items, page) => {
    const shape = grid(items.length);
    // Faqat birinchi sahifa rasmlari darhol yuklanadi; qolganlari sahifa ochilganda (eski saytdagidek).
    // Sayqallangan variant: sahifada ko'p narxli taom bo'lsa, yozuvlarga ko'proq joy beriladi ("many").
    const many = sayqal && items.some((item) => item.variants.length >= 2) ? " many" : "";
    return `<section class="menu-page cols-${shape.cols} rows-${shape.rows}${many}${page === 0 ? " active" : ""}" data-title="${escAttr(title)}">${items.map((item) => card(item, view.screen.fallbackImage, page > 0, sayqal)).join("")}</section>`;
  }).join("") + offerPage(view, sayqal);
}

function footer(view: TvView): { footerClass: string; footer: string } {
  const set = view.setOffer;
  if (!set) {
    const r = view.restaurant;
    return { footerClass: "", footer: `<span>${escText(r.hours)}</span><strong>${escText(r.footer)}</strong><span>${escText(r.phone)}</span>` };
  }
  const src = jsSafeUrl(set.image);
  const photo = src ? `<img class="set-photo" src="${escAttr(src)}" onerror="this.onerror=null;this.src='${escAttr(src)}'" alt="">` : "";
  return {
    footerClass: "set-strip",
    footer: `<div class="set-media">${photo}<b class="set-title">${escText(set.title)}</b></div><div class="set-copy"><strong class="set-price">${won(set.price)}</strong><span>${escText(set.description)}</span></div><span class="set-hours">${escText(view.restaurant.hours)}</span>`,
  };
}

/** Ekran ma'lumotidan tayyor HTML bo'laklari (eski sayt serverda chizgani kabi) va vaqt sozlamalari. */
export function tvRender(view: TvView, look = ""): TvPayload {
  const sayqal = look === LOOK_SAYQAL;
  const title = `${view.screen.title} MENYU`;
  return {
    title: `${view.restaurant.name} — ${view.screen.title}`,
    bodyClass: view.setOffer ? "has-set-offer" : "",
    brand: { mark: view.restaurant.name.trim().charAt(0).toUpperCase() || "H", name: view.restaurant.name, slogan: view.restaurant.slogan },
    stage: stage(view, title, sayqal),
    ...footer(view),
    cfg: {
      title, motionMs: view.screen.spotlightSeconds * 1000, overviewMs: view.screen.overviewSeconds * 1000, pageMs: view.screen.pageSeconds * 1000, slots: view.slots,
      offerIntervalMs: (view.offer?.intervalSeconds ?? 30) * 1000, offerDurationMs: (view.offer?.durationSeconds ?? 10) * 1000, offerLabel: view.offer?.label ?? "",
    },
  };
}

/** Menyu nusxasi belgisi: ekranda ko'rinadigan biror narsa o'zgarsa — belgi o'zgaradi (ekran shunga qarab yangilanadi). */
export function tvRevision(payload: TvPayload): string {
  const source = JSON.stringify(payload);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b + code, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

const SCRIPT = `
(function(){
  var CFG=__BOOT__;
  var KEY='halo-tv:'+CFG.b+':'+CFG.screen+(CFG.look?':'+CFG.look:'');
  var currentRevision='';
  var T={title:'',motionMs:8000,overviewMs:15000,pageMs:5000,slots:1,offerIntervalMs:30000,offerDurationMs:10000,offerLabel:''};
  var activePage=0;
  var stage=document.getElementById('stage');
  var footer=document.querySelector('footer');
  var menuPages=[];
  var dailyOffer=null;
  var fullscreenButton=document.getElementById('fullscreen-button');
  var screenName=document.querySelector('.screen-name');
  var brandMark=document.querySelector('.mark');
  var brandName=document.querySelector('.brand strong');
  var brandSlogan=document.querySelector('.brand span');
  var syncServerTime=(new Date()).getTime();
  var syncClientTime=syncServerTime;
  var itemFocusTimer=0;
  var dailyOfferTimer=0;
  var retryTimer=0;
  var itemFocusActive=false;
  var dailyOfferActive=false;
  function synchronizedNow(){return syncServerTime+((new Date()).getTime()-syncClientTime);}
  function remoteControl(event){
    var code=event.keyCode||event.which||0;
    var key=event.key||'';
    if(key==='Enter'||key===' '||code===13||code===23||code===32||code===66){
      if(event.preventDefault)event.preventDefault();
      goFull();
    }
  }
  function showPage(index){
    if(!menuPages.length)return;
    if(dailyOffer)dailyOffer.classList.remove('active');
    document.body.classList.remove('offer-open');
    document.body.classList.remove('item-focus-open');
    itemFocusActive=false;
    dailyOfferActive=false;
    for(var i=0;i<menuPages.length;i+=1){
      var active=i===index;
      if(active)menuPages[i].classList.add('active');else menuPages[i].classList.remove('active');
      if(active){
        if(screenName&&menuPages[i].getAttribute('data-title'))screenName.textContent=menuPages[i].getAttribute('data-title');
        var images=menuPages[i].querySelectorAll('img[data-src]');
        for(var j=0;j<images.length;j+=1){images[j].setAttribute('src',images[j].getAttribute('data-src'));images[j].removeAttribute('data-src');}
      }
    }
  }
  function hideDailyOffer(){
    if(!dailyOfferActive)return;
    dailyOfferActive=false;
    if(dailyOffer)dailyOffer.classList.remove('active');
    document.body.classList.remove('offer-open');
    syncDisplay();
  }
  function showDailyOffer(){
    if(!dailyOffer||dailyOfferActive)return;
    if(itemFocusTimer){clearTimeout(itemFocusTimer);itemFocusTimer=0;}
    for(var i=0;i<menuPages.length;i+=1)menuPages[i].classList.remove('active');
    var moving=document.querySelectorAll('.menu-card.item-focus-active');
    for(var j=0;j<moving.length;j+=1)moving[j].classList.remove('item-focus-active');
    document.body.classList.remove('item-focus-open');
    itemFocusActive=false;
    dailyOffer.classList.add('active');
    document.body.classList.add('offer-open');
    if(screenName)screenName.textContent=T.offerLabel;
    dailyOfferActive=true;
  }
  function clearItemFocus(){
    var cards=document.querySelectorAll('.menu-card.item-focus-active');
    for(var i=0;i<cards.length;i+=1)cards[i].classList.remove('item-focus-active');
    document.body.classList.remove('item-focus-open');
    itemFocusActive=false;
  }
  function showOverview(){
    clearItemFocus();
    var pageIndex=0;
    if(menuPages.length>1&&T.pageMs>0)pageIndex=Math.floor(synchronizedNow()/T.pageMs)%menuPages.length;
    activePage=pageIndex;
    showPage(activePage);
  }
  function showSynchronizedItem(slot){
    clearItemFocus();
    if(T.motionMs<=0||dailyOfferActive)return;
    var allCards=document.querySelectorAll('.menu-page .menu-card');
    if(!allCards.length)return;
    // Bir ekranda taom boshqasidan kam bo'lishi mumkin. O'z navbatini boshidan takrorlaydi —
    // shunda har ekran har qadamda almashadi va uchala ekran umumiy ko'rinishga birga yetadi.
    var wanted=slot%allCards.length;
    var target=null;
    var targetPage=0;
    var seen=0;
    for(var i=0;i<menuPages.length;i+=1){
      var pageCards=menuPages[i].querySelectorAll('.menu-card');
      if(wanted<seen+pageCards.length){target=pageCards[wanted-seen];targetPage=i;break;}
      seen+=pageCards.length;
    }
    if(!target)return;
    activePage=targetPage;
    showPage(activePage);
    target.classList.add('item-focus-active');
    document.body.classList.add('item-focus-open');
    itemFocusActive=true;
    var itemTitle=target.querySelector('h2');
    if(screenName&&itemTitle)screenName.textContent=itemTitle.textContent||T.title;
  }
  function syncDisplay(){
    if(itemFocusTimer){clearTimeout(itemFocusTimer);itemFocusTimer=0;}
    if(dailyOfferActive)return;
    if(T.motionMs<=0){
      showOverview();
      if(menuPages.length>1&&T.pageMs>0){
        var pagePosition=synchronizedNow()%T.pageMs;
        itemFocusTimer=setTimeout(syncDisplay,Math.max(250,T.pageMs-pagePosition+60));
      }
      return;
    }
    var itemWindow=T.slots*T.motionMs;
    var cycleMs=itemWindow+T.overviewMs;
    var position=synchronizedNow()%cycleMs;
    var delay=0;
    if(position<itemWindow){
      var slot=Math.floor(position/T.motionMs);
      showSynchronizedItem(slot);
      delay=T.motionMs-(position%T.motionMs);
    }else{
      showOverview();
      delay=cycleMs-position;
      // Taomlar bir sahifaga sig'masa — umumiy ko'rinish ichida sahifalar belgilangan oraliqda almashadi.
      if(menuPages.length>1&&T.pageMs>0){
        var pageLeft=T.pageMs-(synchronizedNow()%T.pageMs);
        if(pageLeft<delay)delay=pageLeft;
      }
    }
    itemFocusTimer=setTimeout(syncDisplay,Math.max(250,Math.round(delay)+60));
  }
  function syncDailyOffer(){
    if(dailyOfferTimer){clearTimeout(dailyOfferTimer);dailyOfferTimer=0;}
    if(!dailyOffer)return;
    var intervalMs=T.offerIntervalMs;
    var durationMs=T.offerDurationMs;
    var position=synchronizedNow()%intervalMs;
    var delay=0;
    if(position<durationMs){
      showDailyOffer();
      delay=durationMs-position;
    }else{
      if(dailyOfferActive)hideDailyOffer();
      delay=intervalMs-position;
    }
    dailyOfferTimer=setTimeout(syncDailyOffer,Math.max(250,Math.round(delay)+60));
  }
  // Yangi menyuni ekranga qo'yish: faqat menyu haqiqatan o'zgarganda chaqiriladi.
  function applyMenu(menu){
    if(itemFocusTimer){clearTimeout(itemFocusTimer);itemFocusTimer=0;}
    if(dailyOfferTimer){clearTimeout(dailyOfferTimer);dailyOfferTimer=0;}
    itemFocusActive=false;
    dailyOfferActive=false;
    document.title=menu.title;
    document.body.className=menu.bodyClass;
    if(brandMark)brandMark.textContent=menu.brand.mark;
    if(brandName)brandName.textContent=menu.brand.name;
    if(brandSlogan)brandSlogan.textContent=menu.brand.slogan;
    if(screenName)screenName.textContent=menu.cfg.title;
    stage.innerHTML=menu.stage;
    stage.setAttribute('data-signature',menu.revision);
    footer.className=menu.footerClass;
    footer.innerHTML=menu.footer;
    T=menu.cfg;
    currentRevision=menu.revision;
    menuPages=document.querySelectorAll('.menu-page');
    dailyOffer=document.getElementById('daily-offer');
    syncDisplay();
    if(dailyOffer)syncDailyOffer();
  }
  function validMenu(menu){
    return !!menu&&typeof menu.stage==='string'&&typeof menu.footer==='string'&&!!menu.cfg&&!!menu.brand&&typeof menu.revision==='string'&&menu.revision!=='';
  }
  // Sahifa kodi yangilangan bo'lsa bir marta qayta ochiladi (10 daqiqada ko'pi bilan bir marta — ekran miltillab qolmasin).
  function reloadOnce(){
    try{
      var now=(new Date()).getTime();
      var last=Number(sessionStorage.getItem('halo-tv-reload')||0);
      if(now-last<600000)return;
      sessionStorage.setItem('halo-tv-reload',String(now));
    }catch(error){}
    location.reload();
  }
  function retrySoon(){
    // Hali hech qanday menyu yo'q (birinchi ochilish va javob kelmadi) — 15 soniya kutmasdan qayta so'raydi.
    if(currentRevision||retryTimer)return;
    if(!stage.innerHTML)stage.innerHTML='<div class="empty">Menyu yuklanmoqda…</div>';
    retryTimer=setTimeout(function(){retryTimer=0;checkForMenuUpdate();},3000);
  }
  function checkForMenuUpdate(){
    try{
      var request=new XMLHttpRequest();
      var requestStarted=(new Date()).getTime();
      request.open('GET',CFG.api+'?data=1&screen='+encodeURIComponent(CFG.screen)+'&b='+encodeURIComponent(CFG.b)+(CFG.look?'&look='+encodeURIComponent(CFG.look):'')+'&rev='+encodeURIComponent(currentRevision),true);
      request.onreadystatechange=function(){
        if(request.readyState!==4)return;
        // Javob kelmasa (internet yoki baza vaqtincha ishlamayapti) — ekrandagi oxirgi menyu o'z holicha qoladi.
        if(request.status!==200){retrySoon();return;}
        try{
          var result=JSON.parse(request.responseText);
          if(!result||!result.ok){retrySoon();return;}
          if(result.v&&result.v!==CFG.v){reloadOnce();return;}
          if(result.serverTime){
            var received=(new Date()).getTime();
            syncServerTime=Number(result.serverTime)+Math.max(0,(received-requestStarted)/2);
            syncClientTime=received;
          }
          if(result.revision!==currentRevision&&validMenu(result)){
            applyMenu(result);
            try{localStorage.setItem(KEY,request.responseText);}catch(error){}
          }else{
            // Menyu o'zgarmagan: ekran qayta chizilmaydi, faqat soat tenglashtiriladi.
            syncDisplay();
            if(dailyOffer)syncDailyOffer();
          }
        }catch(error){retrySoon();}
      };
      request.send();
    }catch(error){retrySoon();}
  }
  // Oxirgi muvaffaqiyatli menyu: internet bo'lmasa ham ekran bo'sh qolmaydi.
  try{
    var saved=localStorage.getItem(KEY);
    if(saved){
      var lastMenu=JSON.parse(saved);
      if(lastMenu&&lastMenu.v===CFG.v&&validMenu(lastMenu))applyMenu(lastMenu);
    }
  }catch(error){}
  checkForMenuUpdate();
  if(fullscreenButton){try{fullscreenButton.focus();}catch(error){}}
  setInterval(checkForMenuUpdate,15000);
  document.addEventListener('keydown',remoteControl);
})();
function goFull(){var e=document.documentElement;var f=e.requestFullscreen||e.webkitRequestFullscreen||e.webkitRequestFullScreen||e.mozRequestFullScreen||e.msRequestFullscreen;if(f){try{f.call(e);}catch(x){}}}
`;

/** Ekran sahifasi. Bazadan hech narsa o'qimaydi — menyu keyin /api/v2/tv?data=1 dan olinadi (baza vaqtincha ishlamasa ham sahifa ochiladi). */
export function tvPage(input: { screen: string; branch: string; look?: string }): string {
  const look = tvLook(input.look);
  // Asl ko'rinishda sahifa matni o'zgarmaydi: "look" va qo'shimcha CSS faqat sayqallangan variantda qo'shiladi.
  const config: Record<string, string> = { api: "/api/v2/tv", screen: input.screen, b: input.branch, v: TV_VERSION };
  if (look) config.look = look;
  const boot = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>HALO — ${escText(input.screen)}</title>
<style>${TV_CSS}</style>${look ? `<style>${TV_CSS_SAYQAL}</style>` : ""}</head>
<body>
<header><div class="brand"><div class="mark">H</div><div><strong>HALO</strong><span></span></div></div><div class="screen-name"></div><button id="fullscreen-button" class="fullscreen" type="button" autofocus tabindex="0" onclick="goFull()">⛶ TO‘LIQ EKRAN</button></header>
<main id="stage"></main>
<footer></footer>
<script>${SCRIPT.replace("__BOOT__", () => boot)}</script>
</body></html>`;
}
