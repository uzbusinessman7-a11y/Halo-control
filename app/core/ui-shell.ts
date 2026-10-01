/**
 * HALO V2 — yagona dizayn: ranglar, shriftlar, tugmalar va ilova qobig'i
 * (kompyuterda chap menyu, telefonda pastki menyu). Hamma V2 sahifalari shu yerdan quriladi.
 */

export type NavKey = "bosh" | "kiritish" | "kassa" | "ombor" | "menyu" | "qarz" | "maosh";

const NAV: Array<{ key: NavKey; label: string; icon: string }> = [
  { key: "bosh", label: "Bosh", icon: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>' },
  { key: "kiritish", label: "Kiritish", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>' },
  { key: "kassa", label: "Kassa", icon: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="12" cy="14.5" r="2"/>' },
  { key: "ombor", label: "Ombor", icon: '<path d="M3 8 12 3l9 5v11H3z"/><path d="M7 19v-7h10v7"/><path d="M7 15h10"/>' },
  { key: "menyu", label: "Menyu", icon: '<path d="M7 3v8a2 2 0 0 0 2 2v8"/><path d="M5 3v5a2 2 0 0 0 4 0V3"/><path d="M17 21V3c-2.2 1.2-3.5 3.6-3.5 7v3H17"/>' },
  { key: "qarz", label: "Qarz", icon: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h5"/>' },
  { key: "maosh", label: "Maosh", icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.4 3.6 5.2"/>' },
];

export const DESIGN_CSS = `
:root{color-scheme:dark;--bg:#0b0b0c;--card:#141416;--card-2:#1b1b1e;--text:#f4f4f5;--muted:#9a9aa2;--line:#27272b;
--accent:#d4a84b;--accent-ink:#111111;--accent-soft:#2c2414;--ok:#4ade80;--ok-soft:#0d2a18;--bad:#f87171;--bad-soft:#3a1111;--warn:#fbbf24;--warn-soft:#33260a;
--bar:#3a3a40;--shadow:none;--radius:16px}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--text);font:16px/1.5 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent)}
.app{min-height:100vh}
.side{display:none}
.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top-in{max-width:980px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit}
.logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#e7c77a,#b8862b);color:var(--accent-ink);display:grid;place-items:center;font-weight:900;font-size:18px;letter-spacing:-.04em;box-shadow:inset 0 -3px 0 rgba(0,0,0,.12)}
.brand b{font-size:17px;letter-spacing:.08em}.brand small{display:block;font-size:11px;color:var(--muted);letter-spacing:.02em;margin-top:-2px}
.content{max-width:980px;margin:0 auto;padding:18px 16px calc(96px + env(safe-area-inset-bottom));display:grid;gap:16px}
.page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.backrow{margin-bottom:-6px}.backbtn{min-height:40px;padding:6px 14px 6px 10px;font-size:15px;border-radius:12px}
.page-head h1{font-size:26px;line-height:1.15;margin:0;letter-spacing:-.02em}.page-head p{margin:4px 0 0;color:var(--muted);font-size:14px}
.bottom{position:fixed;left:0;right:0;bottom:0;z-index:6;background:var(--card);border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(7,1fr);padding:6px 0 calc(6px + env(safe-area-inset-bottom))}
.nav-a{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;border-radius:12px;color:var(--muted);text-decoration:none;font-size:10.5px;font-weight:600;letter-spacing:-.01em}
.nav-a svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.nav-a.on{color:var(--accent)}.nav-a.on svg{stroke-width:2.2}
@media (min-width:900px){
 .app{display:grid;grid-template-columns:232px 1fr}.app.solo{display:block}
 .side{display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh;padding:20px 14px;border-right:1px solid var(--line);background:var(--card)}
 .side .brand{padding:4px 8px 18px}
 .side .nav-a{flex-direction:row;gap:12px;font-size:15px;padding:11px 12px}
 .side .nav-a.on{background:var(--accent-soft);color:var(--accent)}
 .side-foot{margin-top:auto;font-size:12px;color:var(--muted);padding:8px}

 .bottom,.top{display:none}
 .content{padding:28px 28px 40px}
}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow)}
.card h2{font-size:13px;margin:0 0 12px;color:var(--muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.card h3{font-size:18px;margin:4px 0}
.hint{font-size:14px;color:var(--muted);margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.grid>*{min-width:0}
.kpi,.tile{background:var(--card-2);border:1px solid var(--line);border-radius:14px;padding:14px}
.kpi small,.tile span{display:block;color:var(--muted);font-size:13px;font-weight:600}
.kpi b,.tile b{display:block;font-size:22px;white-space:nowrap;letter-spacing:-.01em;font-variant-numeric:tabular-nums;margin-top:4px}
.kpi .hint,.tile small{display:block;font-size:12.5px;color:var(--muted);margin:6px 0 0}
.tile.bad{border-color:color-mix(in srgb,var(--bad) 40%,transparent);background:var(--bad-soft)}.tile.bad b{color:var(--bad)}
.tile.warn{border-color:color-mix(in srgb,var(--warn) 40%,transparent);background:var(--warn-soft)}
.big{font-size:34px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.total{font-size:30px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.total.bad{color:var(--bad)}.total.ok{color:var(--ok)}
.up{color:var(--ok);font-weight:700;font-size:14px}.down{color:var(--bad);font-weight:700;font-size:14px}
label.field{display:block;margin:0 0 12px}label.field span{display:block;font-size:14px;font-weight:600;margin-bottom:6px}
input,select,textarea{font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:inherit;min-height:44px}
label.field input,label.field select,label.field textarea{width:100%}
input.money{width:100%;font-size:28px;font-weight:800;text-align:right;font-variant-numeric:tabular-nums;padding:14px}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:12px 16px;min-height:46px;background:var(--accent);color:var(--accent-ink);cursor:pointer;transition:transform .06s,filter .15s}
button:hover{filter:brightness(1.05)}button:active{transform:scale(.98)}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
button.block{width:100%}
button:disabled{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.badge{display:inline-block;font-size:12.5px;font-weight:700;padding:3px 10px;border-radius:99px;white-space:nowrap}
.badge.ok{background:var(--ok-soft);color:var(--ok)}.badge.bad{background:var(--bad-soft);color:var(--bad)}.badge.warn{background:var(--warn-soft);color:var(--warn)}
.tag{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px;margin-left:6px;vertical-align:middle}.tag.bad{background:var(--bad-soft);color:var(--bad)}.tag.warn{background:var(--warn-soft);color:var(--warn)}.tag.ok{background:var(--ok-soft);color:var(--ok)}
.list-row,.emp,.party,.item,.day{display:grid;grid-template-columns:1fr auto;gap:2px 12px;align-items:center;padding:14px 4px;border-top:1px solid var(--line)}
.list-row:first-of-type,.emp:first-of-type,.party:first-of-type,.item:first-of-type,.day:first-of-type{border-top:0}
.emp,.party{cursor:pointer;border-radius:10px}.emp:hover,.party:hover{background:var(--card-2)}
.emp b,.party b,.item b{font-size:16px}.emp .v,.party .v,.item .v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
.emp small,.party small,.item small{grid-column:1/-1;color:var(--muted);font-size:13px}
.day{display:flex;justify-content:space-between}
.v.bad{color:var(--bad)}.v.warn{color:var(--warn)}.v.ok{color:var(--ok)}
.bar{grid-column:1/-1;height:6px;border-radius:3px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;background:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{padding:10px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-size:12.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.sum td{font-weight:800;border-bottom:0}
.msg{padding:12px 14px;border-radius:12px;margin:8px 0 0;font-size:15px}.msg:first-child{margin-top:0}
.msg.ok{background:var(--ok-soft);color:var(--ok)}.msg.bad{background:var(--bad-soft);color:var(--bad)}.msg.warn{background:var(--warn-soft);color:var(--warn)}
.alert{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;border-radius:12px;margin-top:8px;text-decoration:none;font-weight:600}
.alert:first-of-type{margin-top:0}.alert.bad{background:var(--bad-soft);color:var(--bad)}.alert.warn{background:var(--warn-soft);color:var(--warn)}.alert span:last-child{white-space:nowrap}
.gauge{height:12px;border-radius:6px;background:var(--line);overflow:hidden;margin:10px 0 4px;position:relative}.gauge i{display:block;height:100%;border-radius:6px}
.gauge::after{content:"";position:absolute;left:62%;top:-2px;bottom:-2px;width:2px;background:var(--text);opacity:.45}
.bars{display:flex;align-items:flex-end;gap:5px;height:160px;padding-top:18px;position:relative;border-bottom:1px solid var(--line)}
.bars .b{flex:1;min-width:0;background:var(--accent);opacity:.5;border-radius:6px 6px 2px 2px;position:relative}.bars .b.last{opacity:1}
.bars .max{position:absolute;top:0;left:0;font-size:11px;color:var(--muted)}
.bar-labels{display:flex;gap:5px;margin-top:6px}.bar-labels span{flex:1;text-align:center;font-size:11px;color:var(--muted)}
pre{white-space:pre-wrap;font:14px/1.55 ui-monospace,Menlo,monospace;background:var(--card-2);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 12px}
.done{text-align:center;padding:28px 8px}.done b{display:block;font-size:52px;color:var(--ok)}
.skeleton{height:18px;border-radius:8px;background:linear-gradient(90deg,var(--line),var(--card-2),var(--line));background-size:200% 100%;animation:sk 1.2s infinite}
@keyframes sk{to{background-position:-200% 0}}
details summary{cursor:pointer;color:var(--muted);font-size:14px}
[hidden]{display:none!important}
.sheet-bg{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;padding:0}
.sheet{background:var(--card);border:1px solid var(--line);border-radius:18px 18px 0 0;width:min(560px,100%);max-height:88dvh;overflow-y:auto;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}
.sheet h3{margin:0 0 6px;font-size:19px}.sheet .fx{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:8px 0;border-top:1px solid var(--line);font-size:14px}.sheet .fx b{font-variant-numeric:tabular-nums;text-align:right}
@media (min-width:640px){.sheet-bg{align-items:center}.sheet{border-radius:18px}}
.more-btn{position:fixed;z-index:20;top:calc(10px + env(safe-area-inset-top));right:14px;width:44px;height:44px;min-height:44px;padding:0;border-radius:12px;background:var(--card);color:var(--text);border:1px solid var(--line);font-size:24px;line-height:1;font-weight:900}
.more-panel{position:fixed;z-index:30;top:calc(62px + env(safe-area-inset-top));right:14px;width:min(340px,calc(100vw - 28px));max-height:calc(100dvh - 160px);overflow-y:auto;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:8px;box-shadow:0 20px 50px rgba(0,0,0,.5)}
.more-head{display:flex;justify-content:space-between;align-items:center;padding:4px 8px 8px}.more-head button{min-height:34px;padding:4px 10px}
.more-item{display:flex;gap:12px;align-items:center;padding:11px 10px;border-radius:12px;color:var(--text);text-decoration:none}
.more-item:hover{background:var(--card-2)}.more-item .ico{width:28px;text-align:center;font-size:18px}.more-item small{display:block;color:var(--muted);font-size:12.5px;font-weight:500}
@media (min-width:900px){.more-btn{top:24px;right:28px}.more-panel{top:76px;right:28px}.page-head{padding-right:60px}}

.page-head>*{min-width:0;max-width:100%}.page-head .row>*{flex:1 1 140px;min-width:0}select,input{max-width:100%}.content{min-width:0;overflow-x:clip}
.card h2{text-transform:none;letter-spacing:-.01em;font-size:17px;color:var(--text);font-weight:700}
.kpi,.tile{background:var(--card)}
.alert{background:var(--card-2)!important;color:var(--text)!important;font-weight:600;border:1px solid var(--line)}
.alert::before{content:"";flex:0 0 8px;height:8px;border-radius:50%;background:var(--warn);margin-right:-2px}
.alert.bad::before{background:var(--bad)}.alert span:first-child{flex:1}.alert .go{color:var(--muted)}
.bars .b{background:var(--bar);opacity:1}.bars .b.last{background:var(--accent)}
.side .nav-a.on{background:var(--accent-soft);color:var(--accent)}

@media (max-width:600px){td.n,th.n{white-space:normal}th,td{padding:8px 4px;font-size:14px}.grid{grid-template-columns:1fr 1fr;gap:10px}.kpi,.tile{padding:12px}.kpi b,.tile b{font-size:clamp(14px,4.4vw,18px)}.big,.total{font-size:28px}.alert .go{display:none}.alert::after{content:'›';font-size:22px;line-height:1}}
@media print{.side,.top,.bottom,.noprint{display:none!important}.app{display:block}body{background:#fff;color:#000}:root{--text:#000;--muted:#444;--line:#ccc;--card:#fff;--card-2:#fff}.card{border:0;box-shadow:none;padding:0}.content{padding:0}}
`;

/** Sahifalar uchun umumiy yordamchi: tanlangan filialni eslab qoladi (sahifadan sahifaga). */
const COMMON_SCRIPT = `
function haloBranch(sel){try{var v=localStorage.getItem('halo-branch');if(v&&[].some.call(sel.options,function(o){return o.value===v}))sel.value=v}catch(e){}
sel.addEventListener('change',function(){try{localStorage.setItem('halo-branch',sel.value)}catch(e){}})}
/* Xato yozuvni olib tashlash (eski tizimning xavfsiz dvigateli: /api/record-removals).
   Avval ta'sirini ko'rsatadi (ombor, qarz, pul qanday o'zgaradi), sababini so'raydi, keyin bajaradi. Tarixda qoladi. */
function haloRemove(o){var bg=document.createElement('div');bg.className='sheet-bg';var nf=function(v){return Number(v||0).toLocaleString('en-US')};
var e=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var close=function(){bg.remove()};bg.addEventListener('click',function(ev){if(ev.target===bg)close()});
bg.innerHTML='<div class="sheet" role="dialog" aria-modal="true"><h3>Olib tashlash</h3><p class="hint">'+e(o.label||'')+'</p><div id="rmBody">'+haloLoading(3)+'</div></div>';document.body.appendChild(bg);
var url='/api/record-removals?branch='+encodeURIComponent(o.branch||'main'),body=bg.querySelector('#rmBody');
var call=function(d){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).catch(function(){return {ok:false,j:{error:'Internet yo‘q. Qayta urinib ko‘ring.'}}})};
call({action:'preview',kind:o.kind,id:o.id}).then(function(p){
 if(!p.ok){body.innerHTML='<div class="msg bad">'+e(p.j.error||'Bo‘lmadi.')+'</div><button class="ghost block" style="margin-top:12px" id="rmX">Yopish</button>';bg.querySelector('#rmX').onclick=close;return}
 var fx=(p.j.effects||[]).map(function(c){return '<div class="fx"><span>'+e(c.label)+'</span><b>'+nf(c.before)+' → '+nf(c.after)+(c.unit&&c.unit!=='₩'?' '+e(c.unit):' ₩')+'</b></div>'}).join('');
 body.innerHTML='<div class="msg warn">'+e(p.j.description||'')+'</div>'+(fx?'<p class="hint" style="margin:12px 0 4px">Nima o‘zgaradi:</p>'+fx:'')
  +'<label class="field" style="margin-top:14px"><span>Sabab (majburiy)</span><input id="rmWhy" maxlength="300" placeholder="Masalan: ikki marta kiritilgan"></label>'
  +'<div class="row"><button class="ghost" id="rmNo" style="flex:1">Bekor</button><button id="rmGo" style="flex:1;background:var(--bad);color:#fff">Olib tashlash</button></div><div id="rmMsg"></div>';
 bg.querySelector('#rmNo').onclick=close;var why=bg.querySelector('#rmWhy');why.focus();
 bg.querySelector('#rmGo').onclick=function(){var b=this,r=why.value.trim();if(r.length<3){bg.querySelector('#rmMsg').innerHTML='<div class="msg bad">Sababini yozing (kamida 3 belgi).</div>';return}b.disabled=true;
  var op='v2rm-'+(crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):String(Date.now())+Math.random().toString(16).slice(2)).slice(0,30);
  call({action:'remove',kind:o.kind,id:o.id,label:o.label||'',reason:r,operationId:op,expected:p.j.expected}).then(function(x){
   if(!x.ok||!x.j.ok){b.disabled=false;bg.querySelector('#rmMsg').innerHTML='<div class="msg bad">'+e(x.j.error||'Bo‘lmadi.')+'</div>';return}
   close();if(o.done)o.done(x.j)})}
})}
function haloLoading(n){var s='';for(var i=0;i<(n||3);i++)s+='<div class="skeleton" style="margin:10px 0;width:'+(90-i*15)+'%"></div>';return s}
`;

/** "⋯" menyu: kam ishlatiladigan bo'limlar — ulanishlar, sozlamalar, nazorat va chiqish. */
const MORE_MENU = [
  ["/pos", "🧾", "HALO HISOB oynasi", "Naqd, hisob-raqam, delivery, oshxona, chiqit"],
  ["/api/v2/mezana", "🤝", "MEZANA", "Olib turish, qaytarish, qarz va to‘lov"],
  ["/api/v2/vazifalar", "✅", "Xodim vazifalari", "Vazifa yuborish va bajarilishi"],
  ["/api/v2/nazorat", "☑️", "Kunlik nazorat", "Ochilish/yopilish tekshiruvi, oshxona qoidalari"],
  ["/api/v2/eksport", "📥", "Hisobot va zaxira", "Excel uchun yuklab olish, nusxa, qaytarish"],
  ["/api/v2/ornatish", "📲", "Ilovani o‘rnatish", "iPhone, Mac, Windows, Android"],
  ["/api/v2/kalkulyator", "🧮", "Narx kalkulyatori", "Tannarxdan narx: 30/35/40%, foiz qo‘shish/ayirish"],
  ["/api/v2/ushlanmalar", "％", "Soliq va komissiyalar", "Har savdodan avtomatik ushlanadi"],
  ["/api/v2/ulanishlar", "🔌", "Ulanishlar", "Telegram, Google Sheets, API"],
  ["/api/v2/sozlamalar", "⚙️", "Sozlamalar", "Xodim akkauntlari, filiallar"],
  ["/api/v2/sanoq", "▤", "Oy yakuni sanog‘i", "Pul, ombor, qarz"],
  ["/api/v2/tarix", "↺", "O‘zgarishlar tarixi", "Nima o‘chirildi, o‘zgartirildi"],
  ["/api/v2/kochish", "🚀", "To‘liq o‘tish", "Tekshiruv ro‘yxati"],
  ["/api/v2/xodim", "👷", "Xodim ilovasi", "Xodimlar telefoni uchun"],
  ["/api/admin/migration", "⇪", "Ma’lumot ko‘chirish", "Eski saytdan yakuniy ko‘chirish"],
  ["/?eski=1", "🗂", "Eski ko‘rinish (zaxira)", "Hamma eski oynalar"],
  ["/signout-with-chatgpt", "⎋", "Chiqish", ""],
].map(([href, icon, label, hint]) => `<a class="more-item" href="${href}"><span class="ico">${icon}</span><span><b>${label}</b>${hint ? `<small>${hint}</small>` : ""}</span></a>`).join("");
const MORE_UI = `<button class="more-btn" id="moreBtn" aria-label="Yana" aria-expanded="false">⋯</button>
<div class="more-panel" id="morePanel" hidden><div class="more-head"><b>Yana</b><button class="ghost" id="moreClose" aria-label="Yopish">✕</button></div>${MORE_MENU}</div>`;
const MORE_SCRIPT = `(function(){var b=document.getElementById('moreBtn'),p=document.getElementById('morePanel');if(!b)return;
function set(o){p.hidden=!o;b.setAttribute('aria-expanded',o?'true':'false')}
b.addEventListener('click',function(e){e.stopPropagation();set(p.hidden)});document.getElementById('moreClose').addEventListener('click',function(){set(false)});
document.addEventListener('click',function(e){if(!p.hidden&&!p.contains(e.target)&&e.target!==b)set(false)});document.addEventListener('keydown',function(e){if(e.key==='Escape')set(false)})})();
`;

function navLinks(active: NavKey | null, cls: string) {
  return NAV.map((item) => `<a class="nav-a ${cls}${item.key === active ? " on" : ""}" href="/api/v2/${item.key}"${item.key === active ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><span>${item.label}</span></a>`).join("");
}

const BRAND = '<a class="brand" href="/api/v2/bosh"><span class="logo">H</span><span><b>HALO</b><small>Control</small></span></a>';

export interface ShellInput {
  title: string;
  /** Qaysi menyu bandi yoqilgan; null — menyusiz (masalan, xodim ekrani). */
  active: NavKey | null;
  heading?: string;
  subtitle?: string;
  /** Sarlavha o'ng tomonidagi element (masalan, filial tanlash). */
  headerRight?: string;
  body: string;
  script: string;
  /** Qaysi ilova sifatida o'rnatiladi (telefon/kompyuter): rahbar, xodim yoki do'kon oynasi. */
  app?: "owner" | "xodim" | "hisob";
  /** "Orqaga" tugmasi: tarix bo'lmasa qayerga qaytadi (standart — bosh sahifa); "history" — faqat tarix bo'lsa ko'rinadi; false — yo'q. */
  back?: string | "history" | false;
}

const APPS = {
  owner: { manifest: "/manifest.webmanifest", icon: "/icons/halo-180.png", title: "HALO" },
  xodim: { manifest: "/xodim-manifest.webmanifest", icon: "/icons/halo-xodim-180.png", title: "HALO Xodim" },
  hisob: { manifest: "/halo-hisob-manifest.webmanifest", icon: "/icons/halo-180.png", title: "HALO HISOB" },
} as const;

/** Ilova o'rnatish: service worker (Windows/Android/Chrome/Edge talabi) va o'rnatish taklifini ushlab qolish. */
const BACK_SCRIPT = `function haloCanBack(){try{return document.referrer&&new URL(document.referrer).origin===location.origin&&new URL(document.referrer).href!==location.href&&history.length>1}catch(e){return false}}
function haloBack(fb){if(haloCanBack())history.back();else if(fb)location.href=fb}
(function(){var b=document.getElementById('haloBack');if(!b)return;var fb=b.getAttribute('data-fallback');if(fb==='history'&&!haloCanBack()){b.parentNode.removeChild(b);return}
b.addEventListener('click',function(){haloBack(fb==='history'?'':fb)})})();
`;

const INSTALL_SCRIPT = `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}
window.haloInstall=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.haloInstall=e;document.dispatchEvent(new Event('halo-installable'))});
window.haloStandalone=function(){return (window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true};
window.haloDoInstall=function(){if(!window.haloInstall){location.href='/api/v2/ornatish';return}window.haloInstall.prompt();window.haloInstall.userChoice.then(function(){window.haloInstall=null;var b=document.getElementById('haloInstallPill');if(b)b.remove()})};
document.addEventListener('halo-installable',function(){try{if(localStorage.getItem('halo-install-hide')==='1')return}catch(e){}if(document.getElementById('haloInstallPill')||window.haloStandalone())return;
 var d=document.createElement('div');d.id='haloInstallPill';d.style.cssText='position:fixed;right:14px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:40;display:flex;gap:4px;align-items:center;background:var(--accent);color:var(--accent-ink);border-radius:99px;padding:4px 6px 4px 14px;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,.35)';
 d.innerHTML='<span style="cursor:pointer" id="haloInstallGo">📲 Ilova qilib o‘rnatish</span><button aria-label="Yopish" id="haloInstallX" style="min-height:30px;padding:0 10px;background:transparent;color:inherit">✕</button>';
 document.body.appendChild(d);document.getElementById('haloInstallGo').addEventListener('click',window.haloDoInstall);
 document.getElementById('haloInstallX').addEventListener('click',function(){try{localStorage.setItem('halo-install-hide','1')}catch(e){}d.remove()})});
`;

export function shell(input: ShellInput): string {
  const withNav = input.active !== null;
  const head = input.heading
    ? `<div class="page-head"><div><h1>${input.heading}</h1>${input.subtitle ? `<p>${input.subtitle}</p>` : ""}</div>${input.headerRight || ""}</div>`
    : "";
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<meta name="theme-color" content="#0b0b0c">
<link rel="manifest" href="${APPS[input.app || "owner"].manifest}">
<link rel="apple-touch-icon" href="${APPS[input.app || "owner"].icon}">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${APPS[input.app || "owner"].title}">
<title>${input.title} · HALO</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23d4a84b'/%3E%3Ctext x='16' y='23' font-family='Arial' font-weight='900' font-size='20' text-anchor='middle' fill='%23111'%3EH%3C/text%3E%3C/svg%3E">
<style>${DESIGN_CSS}</style></head><body>
<div class="app${withNav ? "" : " solo"}">
${withNav ? `<aside class="side">${BRAND}${navLinks(input.active, "")}<div class="side-foot">Yangi tizim · sinov rejimi</div></aside>` : ""}
<div>
<div class="top"><div class="top-in">${BRAND}</div></div>
<main class="content">${input.back === false ? "" : `<div class="backrow"><button class="ghost backbtn" id="haloBack" type="button" data-fallback="${input.back || "/api/v2/bosh"}">‹ Orqaga</button></div>`}${head}${input.body}</main>
</div>
</div>
${withNav ? `<nav class="bottom">${navLinks(input.active, "")}</nav>${MORE_UI}` : ""}
<script>${INSTALL_SCRIPT}${BACK_SCRIPT}${COMMON_SCRIPT}${withNav ? MORE_SCRIPT : ""}${input.script}</script>
</body></html>`;
}
