/**
 * HALO monitor menyusi — televizor ekrani sahifasi (parolsiz, faqat o'qiydi).
 *
 * Shriftlar saytning o'zida turadi (public/fonts, SIL OFL litsenziyasi): Big Shoulders Display va Onest —
 * ekran tashqi saytga bog'liq emas.
 *
 * Dizayn g'oyasi: "har taomning o'z halosi bor". Chap tomonda bitta taom navbat bilan katta ko'rsatiladi —
 * dumaloq rasm atrofida oltin halqa (halo). O'ng tomonda shu ekranning hamma taomi tartibli narx ro'yxatida;
 * hozir ko'rsatilayotgan taom ro'yxatda oltin belgi bilan ajraladi. Rang: qora fon, sut rang matn, oltin.
 *
 * Sahna 1920×1080 qilib chizilgan va har qanday televizor o'lchamiga butunligicha moslab kattalashtiriladi.
 * Ma'lumot har 30 soniyada yangilanadi; internet uzilsa oxirgi menyu ekranda qoladi.
 * Skript ichida teskari chiziq ishlatilmaydi (TypeScript matni ichida buzilmasin).
 */
export const TV_VERSION = "tv-1";

const CSS = `
@font-face{font-family:"HALO Display";src:url(/fonts/halo-tv-display.woff) format("woff");font-weight:100 900;font-display:swap}
@font-face{font-family:"HALO Text";src:url(/fonts/halo-tv-text.woff) format("woff");font-weight:100 900;font-display:swap}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#0a0908;cursor:none}
body{color:#fbf3e0;font-family:"HALO Text",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
#stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:50% 50%;padding:40px 60px 36px;display:grid;grid-template-rows:140px 1fr 100px;row-gap:24px;
  background:radial-gradient(720px 560px at 19% 50%,rgba(212,168,75,.13),transparent 72%),#0a0908}
.d{font-family:"HALO Display","Arial Narrow",Impact,sans-serif;font-weight:900;letter-spacing:.01em;line-height:.92}

.top{display:grid;grid-template-columns:auto 1fr auto;align-items:center;column-gap:44px;border-bottom:1px solid rgba(240,213,138,.2);padding-bottom:18px}
.brand{display:grid;row-gap:6px}
.mark{position:relative;font-size:96px;color:#d4a84b;width:max-content}
.mark i{position:absolute;right:-6px;top:-9px;width:64px;height:19px;border:5px solid #f0d58a;border-radius:50%;transform:rotate(-9deg)}
.slogan{font-size:20px;color:#a99f8b;letter-spacing:.04em;white-space:nowrap}
.title{font-size:124px;text-transform:uppercase;color:#fbf3e0;padding-left:44px;border-left:1px solid rgba(240,213,138,.2);white-space:nowrap;overflow:hidden}
.info{display:grid;row-gap:8px;justify-items:end;text-align:right}
.info .hours{font-size:23px;color:#a99f8b}
.info .phone{font-size:50px;color:#f0d58a;font-weight:800}

.mid{display:grid;grid-template-columns:620px 1fr;column-gap:56px;min-height:0}

.spot{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;min-height:0;transition:opacity .5s ease}
.who{display:grid;justify-items:center;row-gap:12px;margin-top:20px;max-width:620px}
.spot.out{opacity:0}
.halo{position:relative;width:392px;height:392px;flex:0 0 auto}
.halo svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.halo .ring{fill:none;stroke:rgba(240,213,138,.34);stroke-width:2}
.halo .arc{fill:none;stroke:#f0d58a;stroke-width:6;stroke-linecap:round;stroke-dasharray:150 1100;transform-origin:196px 196px;animation:orbit 26s linear infinite}
.halo .draw{fill:none;stroke:#d4a84b;stroke-width:2;stroke-dasharray:1220;stroke-dashoffset:1220;transform:rotate(-90deg);transform-origin:196px 196px}
.spot.in .halo .draw{animation:draw 1.1s ease-out forwards}
.dish{position:absolute;left:26px;top:26px;width:340px;height:340px;border-radius:50%;overflow:hidden;background:#14110d;display:grid;place-items:center}
.dish b{font-family:"HALO Display","Arial Narrow",Impact,sans-serif;font-weight:900;font-size:190px;color:rgba(240,213,138,.22);line-height:1}
.dish img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.chip{position:absolute;right:8px;top:30px;background:#d4a84b;color:#0a0908;font-weight:700;font-size:20px;padding:7px 16px;border-radius:99px;transform:rotate(9deg)}
.chip.hot{background:#e4572e;color:#fbf3e0}
.spot h2{font-size:88px;color:#fbf3e0;white-space:nowrap;max-width:620px;text-transform:uppercase}
.spot .eyebrow{font-size:22px;color:#f0d58a;font-weight:500}
.spot .desc{font-size:21px;line-height:1.35;color:#a99f8b;max-width:560px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rail{display:flex;justify-content:center;align-items:flex-end;margin-top:auto}
.rail .cell{padding:0 22px;border-left:1px solid rgba(240,213,138,.2);text-align:center}
.rail .cell:first-child{border-left:0}
.lab{display:block;font-size:17px;color:#a99f8b;text-transform:lowercase;white-space:nowrap}
.lab::first-letter{text-transform:uppercase}
.rail .p{font-size:58px;color:#f0d58a;white-space:nowrap}
.rail .p small{font-weight:800;font-size:26px;color:#a99f8b;margin-left:6px}
.rail .old{font-size:34px;color:#a99f8b;text-decoration:line-through;text-decoration-thickness:3px}

.ledger{position:relative;min-height:0}
.rows{position:absolute;inset:0;display:grid}
.row{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:22px;padding:0 6px 0 26px;border-bottom:1px solid rgba(240,213,138,.14);min-height:0;transition:opacity .4s}
.row:last-child{border-bottom:0}
.row::before{content:"";position:absolute;left:0;top:22%;bottom:22%;width:6px;border-radius:3px;background:#d4a84b;transform:scaleY(0);transition:transform .45s ease}
.row.on::before{transform:scaleY(1)}
.thumb{position:relative;border-radius:50%;overflow:hidden;background:#14110d;display:grid;place-items:center;box-shadow:0 0 0 2px rgba(240,213,138,.22);transition:box-shadow .45s}
.row.on .thumb{box-shadow:0 0 0 3px #d4a84b,0 0 0 9px rgba(212,168,75,.16)}
.thumb b{font-family:"HALO Display","Arial Narrow",Impact,sans-serif;font-weight:900;color:rgba(240,213,138,.3);line-height:1}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.what{min-width:0}
.what h3{display:flex;align-items:center;min-width:0;color:#fbf3e0;text-transform:uppercase;transition:color .45s}
.what h3 span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row.on .what h3{color:#f0d58a}
.what h3 em{font-family:"HALO Text",system-ui,sans-serif;font-style:normal;font-weight:700;font-size:15px;letter-spacing:0;color:#0a0908;background:#d4a84b;border-radius:99px;padding:3px 10px;margin-left:12px;flex:0 0 auto;line-height:1.3;text-transform:none}
.what p{color:#a99f8b;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;margin-top:5px}
.prices{display:flex;align-items:flex-end;justify-content:flex-end}
.prices .cell{flex:0 0 auto;width:var(--cw,150px);text-align:right;padding-left:12px}
.prices .lab{overflow:hidden;text-overflow:ellipsis}
.prices .p{color:#fbf3e0;white-space:nowrap}
.row.on .prices .p{color:#f0d58a}
.row.sold .thumb,.row.sold .what{opacity:.38}
.stamp{font-size:34px;color:#e4572e;border:3px solid #e4572e;border-radius:10px;padding:6px 16px 3px;transform:rotate(-4deg);white-space:nowrap}
.empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;row-gap:12px;color:#a99f8b;font-size:24px}
.empty b{font-size:64px;color:#fbf3e0}

.base{display:grid;grid-template-columns:auto 1fr auto;align-items:center;column-gap:36px;border-top:1px solid rgba(240,213,138,.2);padding-top:20px}
.set{display:flex;align-items:center;background:#d4a84b;color:#0a0908;border-radius:16px;padding:0 30px 0 26px;height:76px}
.set .pic{width:56px;height:56px;border-radius:50%;overflow:hidden;background:#0a0908;margin:0 18px 0 -12px;position:relative;flex:0 0 auto}
.set .pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.set .name{font-size:46px;white-space:nowrap}
.set .about{font-size:21px;font-weight:500;margin:0 26px;padding-left:26px;border-left:2px solid rgba(10,9,8,.3);white-space:nowrap}
.set .p{font-size:50px;white-space:nowrap}
.set .p small{font-weight:800;font-size:26px;margin-left:5px}
.dots{display:flex;justify-content:center}
.dots i{width:12px;height:12px;border-radius:50%;background:rgba(240,213,138,.25);margin:0 6px}
.dots i.on{background:#d4a84b}
.say{position:relative;height:76px;min-width:520px}
.say>div{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;text-align:right;transition:opacity .7s ease}
.say .motto{font-size:23px;letter-spacing:.24em;color:#d4a84b;white-space:nowrap}
.say .thanks{opacity:0}
.say .thanks b{font-size:27px;font-weight:700;color:#fbf3e0}
.say .thanks span{font-size:18px;color:#a99f8b;margin-top:4px;max-width:860px}
.say.thank .motto{opacity:0}
.say.thank .thanks{opacity:1}
#lost{position:absolute;right:22px;bottom:14px;width:10px;height:10px;border-radius:50%;background:#e4572e;display:none}
#lost.on{display:block}
@keyframes orbit{to{transform:rotate(360deg)}}
@keyframes draw{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.halo .arc{animation:none}.spot.in .halo .draw{animation:none;stroke-dashoffset:0}.spot,.row,.row::before,.say>div{transition:none}}
`;

const SCRIPT = `
var stage=document.getElementById('stage'),DATA=null,RAW='',tick=0,active=0,spotAt=0,promoOn=false,promoAt=0,promoEnd=0,thanksOn=false,thanksAt=0,thanksEnd=0,lastLoad=0;
var KEY='halo-tv:'+CFG.b+':'+CFG.screen;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return Number(n||0).toLocaleString('en-US')}
function fitStage(){var s=Math.min(window.innerWidth/1920,window.innerHeight/1080);stage.style.transform='translate(-50%,-50%) scale('+s+')'}
window.addEventListener('resize',fitStage);fitStage();
function pic(src){return src?'<img src="'+esc(src)+'" alt="" onerror="this.remove()">':''}
function letter(name){return '<b>'+esc(String(name||'H').trim().charAt(0).toUpperCase())+'</b>'}
function shrink(el,max,min){var size=max;el.style.fontSize=size+'px';while(el.scrollWidth>el.clientWidth+1&&size>min){size-=4;el.style.fontSize=size+'px'}}
function liveItems(){return DATA?DATA.items.filter(function(i){return !i.soldOut}):[]}
function promoNow(){var p=DATA&&DATA.promotion;if(!p)return null;var d=new Date(),z=function(n){return (n<10?'0':'')+n};
  var now=d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes());
  if(p.startsAt&&now<p.startsAt)return null;if(p.endsAt&&now>p.endsAt)return null;return p}

function drawTop(){var r=DATA.restaurant;
  document.getElementById('mark').firstChild.nodeValue=r.name;
  document.getElementById('slogan').textContent=r.slogan;
  var t=document.getElementById('title');t.textContent=DATA.screen.title;shrink(t,124,64);
  document.getElementById('hours').textContent=r.hours;document.getElementById('phone').textContent=r.phone;
  document.title=r.name+' — '+DATA.screen.title}

function drawRows(){var box=document.getElementById('ledger'),items=DATA.items;
  if(!items.length){box.innerHTML='<div class="empty"><b class="d">'+esc(DATA.screen.title)+'</b><span>Bu ekranga hali taom qo‘shilmagan.</span><span>HALO Control → Monitor menyu sahifasida qo‘shing.</span></div>';document.getElementById('dots').innerHTML='';return}
  var per=DATA.screen.itemsPerPage,live=liveItems(),cur=live.length?items.indexOf(live[active%live.length]):0,page=Math.floor(Math.max(0,cur)/per),pages=Math.ceil(items.length/per);
  var list=items.slice(page*per,page*per+per),n=Math.max(list.length,pages>1?per:5),h=Math.floor(676/n);
  var most=1;list.forEach(function(it){if(!it.soldOut&&it.variants.length>most)most=it.variants.length});
  var cw=Math.min(210,Math.floor(600/most)),big=most<=2?8:0;
  var th=Math.min(h-20,92),name=h>=108?52:h>=92?46:40,desc=h>=92?18:16,clamp=h>=120?2:1,price=(h>=108?46:h>=92?42:36)+big;
  box.innerHTML='<div class="rows" style="--cw:'+cw+'px;grid-template-rows:repeat('+n+',1fr)">'+list.map(function(it){
    var on=live.length&&it===live[active%live.length]&&!promoOn;
    return '<div class="row'+(on?' on':'')+(it.soldOut?' sold':'')+'" data-id="'+esc(it.id)+'">'
      +'<div class="thumb" style="width:'+th+'px;height:'+th+'px"><b style="font-size:'+Math.round(th*0.56)+'px">'+esc(it.name.trim().charAt(0))+'</b>'+pic(it.image)+'</div>'
      +'<div class="what"><h3 class="d" style="font-size:'+name+'px"><span>'+esc(it.name)+'</span>'+(it.badge&&!it.soldOut?'<em>'+esc(it.badge)+'</em>':'')+'</h3>'
      +(it.description?'<p style="font-size:'+desc+'px;-webkit-line-clamp:'+clamp+'">'+esc(it.description)+'</p>':'')+'</div>'
      +(it.soldOut?'<div class="stamp d">'+esc(it.soldOutText)+'</div>'
        :'<div class="prices">'+it.variants.map(function(v){return '<div class="cell">'+(it.variants.length>1||v.label?'<span class="lab">'+esc(v.label)+'</span>':'')+'<div class="p d" style="font-size:'+price+'px">'+won(v.price)+'</div></div>'}).join('')+'</div>')
      +'</div>'}).join('')+'</div>';
  box.querySelectorAll('.what h3').forEach(function(h3){var sp=h3.firstChild,size=name;while(sp.scrollWidth>sp.clientWidth+1&&size>34){size-=2;h3.style.fontSize=size+'px'}});
  var dots=document.getElementById('dots'),html='';if(pages>1)for(var i=0;i<pages;i++)html+='<i class="'+(i===page?'on':'')+'"></i>';dots.innerHTML=html}

function spotHtml(o){return '<div class="halo"><svg viewBox="0 0 392 392"><circle class="ring" cx="196" cy="196" r="194"/><circle class="draw" cx="196" cy="196" r="194"/><circle class="arc" cx="196" cy="196" r="194"/></svg>'
    +'<div class="dish">'+letter(o.name)+pic(o.image)+'</div>'+(o.badge?'<span class="chip'+(o.hot?' hot':'')+'">'+esc(o.badge)+'</span>':'')+'</div>'
    +'<div class="who">'+(o.eyebrow?'<div class="eyebrow">'+esc(o.eyebrow)+'</div>':'')
    +'<h2 class="d" id="spotName">'+esc(o.name)+'</h2>'
    +(o.description?'<p class="desc">'+esc(o.description)+'</p>':'')+'</div>'
    +'<div class="rail">'+o.cells.map(function(c){return '<div class="cell">'+(c.label?'<span class="lab">'+esc(c.label)+'</span>':'')+(c.old?'<div class="old d">'+won(c.old)+'</div>':'')+'<div class="p d">'+won(c.price)+(o.cells.length<3?'<small>₩</small>':'')+'</div></div>'}).join('')+'</div>'}
function drawSpot(){var box=document.getElementById('spot'),live=liveItems(),p=promoOn?promoNow():null,o=null;
  if(p)o={name:p.title,description:p.description,image:p.image,badge:p.badge,hot:true,eyebrow:p.eyebrow,cells:[{label:'',price:p.price,old:p.oldPrice>p.price?p.oldPrice:0}]};
  else if(live.length){var it=live[active%live.length];o={name:it.name,description:it.description,image:it.image,badge:it.badge,cells:it.variants.map(function(v){return {label:it.variants.length>1||v.label?v.label:'',price:v.price}})}}
  if(!o){box.innerHTML='';return}
  box.className='spot out';
  setTimeout(function(){box.innerHTML=spotHtml(o);var n=document.getElementById('spotName');if(n)shrink(n,88,48);
    var rail=box.querySelector('.rail');if(rail&&o.cells.length>3){rail.querySelectorAll('.p').forEach(function(e){e.style.fontSize='46px'});rail.querySelectorAll('.cell').forEach(function(e){e.style.padding='0 14px'})}
    box.className='spot in'},DATA.first?0:480);DATA.first=false}

function drawBase(){var s=DATA.setOffer,box=document.getElementById('set');
  if(s){box.style.display='';box.innerHTML=(s.image?'<div class="pic"><img src="'+esc(s.image)+'" alt="" onerror="this.parentNode.remove()"></div>':'')+'<div class="name d">'+esc(s.title)+'</div>'+(s.description?'<div class="about">'+esc(s.description)+'</div>':'<div style="width:24px"></div>')+(s.price?'<div class="p d">'+won(s.price)+'<small>₩</small></div>':'')}
  else{box.style.display='none';box.innerHTML=''}
  document.getElementById('motto').textContent=DATA.restaurant.footer;
  var t=DATA.thanks;document.getElementById('thanks').innerHTML=t?'<b>'+esc(t.title)+'</b><span>'+esc(t.message)+'</span>':'';
  if(!t){thanksOn=false;document.getElementById('say').className='say'}}

function render(first){DATA.first=first;var live=liveItems();if(active>=live.length)active=0;drawTop();drawRows();drawSpot();drawBase()}
function apply(d,raw){if(raw===RAW)return;var first=!DATA;RAW=raw;DATA=d;if(first){spotAt=tick;promoEnd=tick;thanksEnd=tick}render(true)}
function mark(){var live=liveItems(),cur=live.length?live[active%live.length]:null;
  var shown=document.querySelector('.row[data-id="'+(cur?cur.id:'')+'"]');
  if(!shown){drawRows();return}
  document.querySelectorAll('.row').forEach(function(r){r.classList.toggle('on',!promoOn&&cur&&r.getAttribute('data-id')===cur.id)})}
function load(){lastLoad=tick;
  fetch('/api/v2/tv?data=1&screen='+encodeURIComponent(CFG.screen)+'&b='+encodeURIComponent(CFG.b),{cache:'no-store'}).then(function(r){return r.text()}).then(function(raw){
    var d=JSON.parse(raw);if(!d.ok)throw new Error('no');
    if(d.v!==CFG.v){location.reload();return}
    document.getElementById('lost').className='';try{localStorage.setItem(KEY,raw)}catch(e){}
    apply(d,raw)}).catch(function(){document.getElementById('lost').className='on'})}
try{var saved=localStorage.getItem(KEY);if(saved){var old=JSON.parse(saved);if(old&&old.ok)apply(old,saved)}}catch(e){}
load();
setInterval(function(){tick+=1;
  if(tick-lastLoad>=30)load();
  if(tick>21600&&navigator.onLine){location.reload();return}
  if(!DATA)return;
  var p=promoNow(),live=liveItems();
  if(promoOn){if(!p||tick-promoAt>=p.durationSeconds){promoOn=false;promoEnd=tick;spotAt=tick;drawSpot();mark()}}
  else if(p&&tick-promoEnd>=p.intervalSeconds){promoOn=true;promoAt=tick;drawSpot();mark()}
  else if(live.length>1&&tick-spotAt>=DATA.screen.spotlightSeconds){active=(active+1)%live.length;spotAt=tick;drawSpot();mark()}
  var t=DATA.thanks,say=document.getElementById('say');
  if(t){if(thanksOn){if(tick-thanksAt>=t.durationSeconds){thanksOn=false;thanksEnd=tick;say.className='say'}}
    else if(tick-thanksEnd>=t.intervalSeconds){thanksOn=true;thanksAt=tick;say.className='say thank'}}
},1000);
document.addEventListener('click',function(){var el=document.documentElement;if(!document.fullscreenElement&&el.requestFullscreen)el.requestFullscreen().catch(function(){})});
try{if(navigator.wakeLock)navigator.wakeLock.request('screen').catch(function(){})}catch(e){}
`;

export function tvPage(input: { screen: string; branch: string }): string {
  const cfg = JSON.stringify({ screen: input.screen, b: input.branch, v: TV_VERSION }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<meta name="theme-color" content="#0a0908"><title>HALO — menyu</title>
<link rel="preload" href="/fonts/halo-tv-display.woff" as="font" type="font/woff" crossorigin><link rel="preload" href="/fonts/halo-tv-text.woff" as="font" type="font/woff" crossorigin>
<style>${CSS}</style></head><body>
<div id="stage">
<header class="top"><div class="brand"><div class="mark d" id="mark">HALO<i></i></div><div class="slogan" id="slogan"></div></div>
<h1 class="title d" id="title"></h1>
<div class="info"><span class="hours" id="hours"></span><span class="phone d" id="phone"></span></div></header>
<main class="mid"><section class="spot" id="spot"></section><section class="ledger" id="ledger"></section></main>
<footer class="base"><div class="set" id="set" style="display:none"></div><div class="dots" id="dots"></div>
<div class="say" id="say"><div class="motto" id="motto"></div><div class="thanks" id="thanks"></div></div></footer>
<div id="lost" title="Internet yo‘q — oxirgi menyu ko‘rsatilmoqda"></div>
</div>
<script>var CFG=${cfg};${SCRIPT}</script></body></html>`;
}
