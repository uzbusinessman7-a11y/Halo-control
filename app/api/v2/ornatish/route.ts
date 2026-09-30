import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * Ilovani o'rnatish yo'riqnomasi (PWA): iPhone/iPad, Mac, Windows, Android.
 * Uchta ilova: rahbar (HALO), xodim (HALO Xodim), do'kon oynasi (HALO HISOB).
 * Kirishsiz ochiladi — faqat yo'riqnoma va havolalar.
 */
export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  const origin = new URL(request.url).origin;
  const app = new URL(request.url).searchParams.get("app");
  const kind = app === "xodim" || app === "hisob" ? app : "owner";
  return new Response(shell({
    title: "Ilovani o‘rnatish", active: null, app: kind, back: "history",
    heading: "Ilovani o‘rnatish",
    subtitle: "HALO telefon va kompyuterda alohida ilova bo‘lib ochiladi — App Store kerak emas",
    body: `<section class="card"><h2>Qaysi ilova?</h2><div id="apps" style="display:grid;gap:10px"></div></section>
<section class="card" id="how"></section>
<section class="card"><h2>Boshqa qurilmalar</h2><div id="others"></div></section>
<style>.appc{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:16px;padding:12px;background:var(--card-2)}.appc img{width:52px;height:52px;border-radius:12px}.appc.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent) inset}.appc div{flex:1;min-width:0}.appc small{color:var(--muted)}.steps{margin:0;padding-left:22px;display:grid;gap:8px}.steps li{line-height:1.5}.kbd{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:0 6px;font-weight:700;background:var(--card-2)}</style>`,
    script: `
var ORIGIN=${JSON.stringify(origin)},KIND=${JSON.stringify(kind)};
var APPS={owner:{name:'HALO',who:'Rahbar uchun — hamma bo‘limlar',path:'/api/v2/bosh',icon:'/icons/halo-192.png'},xodim:{name:'HALO Xodim',who:'Xodim telefoni — davomat, vazifalar, POS, kirim',path:'/api/v2/xodim',icon:'/icons/halo-xodim-192.png'},hisob:{name:'HALO HISOB',who:'Do‘kondagi planshet — savdo, delivery, chiqit',path:'/api/v2/pos',icon:'/icons/halo-192.png'}};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
var ua=navigator.userAgent||'',P=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1)?'ios':/Android/.test(ua)?'android':/Macintosh/.test(ua)?'mac':/Windows/.test(ua)?'windows':'other';
var edgeChrome=/Edg\\//.test(ua)?'Edge':/Chrome\\//.test(ua)?'Chrome':'';
var SAFARI=/Safari\\//.test(ua)&&!/Chrome|CriOS|FxiOS|Edg/.test(ua);
var HOW={
 ios:{t:'iPhone / iPad',s:['Sahifani <b>Safari</b>da oching (boshqa brauzerda bu tugma bo‘lmaydi).','Pastdagi <b>Ulashish</b> tugmasini bosing <span class="kbd">⬆︎</span>.','<b>“Bosh ekranga qo‘shish”</b> (Add to Home Screen) ni tanlang.','Nomini tekshiring va <b>Qo‘shish</b>ni bosing — bosh ekranda HALO belgisi paydo bo‘ladi.']},
 mac:{t:'Mac',s:['<b>Safari</b>: menyuda <b>Fayl → Dock’ga qo‘shish</b> (File → Add to Dock).','<b>Chrome</b> yoki <b>Edge</b>: manzil qatorining o‘ng tomonidagi <span class="kbd">⊕ O‘rnatish</span> belgisini yoki pastdagi tugmani bosing.','Ilova Dock va Launchpad’da alohida oynada ochiladi.']},
 windows:{t:'Windows',s:['<b>Edge</b> yoki <b>Chrome</b>da oching.','Pastdagi <b>“O‘rnatish”</b> tugmasini bosing yoki manzil qatoridagi <span class="kbd">⊕</span> belgisini bosing (Edge: <b>⋯ → Ilovalar → Ushbu saytni ilova sifatida o‘rnatish</b>).','Ilova Start menyusi va vazifalar panelida paydo bo‘ladi, alohida oynada ochiladi.']},
 android:{t:'Android',s:['<b>Chrome</b>da oching.','Pastdagi <b>“O‘rnatish”</b> tugmasini yoki <b>⋮ → Ilovani o‘rnatish</b> ni bosing.','Bosh ekranda HALO belgisi paydo bo‘ladi.']},
 other:{t:'Kompyuter',s:['Chrome yoki Edge’da oching va manzil qatoridagi <span class="kbd">⊕ O‘rnatish</span> belgisini bosing.']}};
function drawApps(){document.getElementById('apps').innerHTML=Object.keys(APPS).map(function(k){var a=APPS[k];
  return '<div class="appc'+(k===KIND?' on':'')+'"><img src="'+a.icon+'" alt=""><div><b>'+esc(a.name)+'</b><br><small>'+esc(a.who)+'</small></div>'+(k===KIND?'<span class="tag ok">tanlangan</span>':'<a href="?app='+k+'"><button class="ghost" style="min-height:38px;padding:4px 12px">Tanlash</button></a>')+'</div>'}).join('')}
function drawHow(){var h=HOW[P],a=APPS[KIND],url=ORIGIN+a.path;
  var box=document.getElementById('how');
  box.innerHTML='<h2>'+esc(h.t)+' · '+esc(a.name)+'</h2>'
    +'<p class="hint" style="margin-top:0">O‘rnatiladigan sahifa: <a href="'+a.path+'"><b>'+esc(url.replace(/^https?:\\/\\//,''))+'</b></a></p>'
    +(window.haloStandalone()?'<div class="msg ok">✓ Siz allaqachon ilova ichidasiz.</div>':'')
    +'<ol class="steps">'+h.s.map(function(x){return '<li>'+x+'</li>'}).join('')+'</ol>'
    +'<div class="row" style="margin-top:14px;gap:8px"><a href="'+a.path+'" style="flex:1"><button class="block">Sahifani ochish</button></a><button id="inst" style="flex:1"'+(window.haloInstall?'':' hidden')+'>📲 O‘rnatish</button><button class="ghost" id="copy">Havolani nusxalash</button></div>'
    +(P==='ios'&&!SAFARI?'<div class="msg warn" style="margin-top:10px">iPhone’da o‘rnatish faqat Safari’da ishlaydi. Havolani nusxalab, Safari’da oching.</div>':'')
    +(KIND!=='owner'?'<p class="hint" style="margin:10px 0 0">Muhim: “Sahifani ochish”ni bosib, <b>o‘sha sahifada</b> o‘rnating — shunda '+esc(a.name)+' alohida ilova bo‘ladi.</p>':'');
  var inst=document.getElementById('inst');inst.addEventListener('click',function(){window.haloDoInstall()});
  document.getElementById('copy').addEventListener('click',function(){var b=this;(navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject()).then(function(){b.textContent='✓ Nusxalandi'},function(){prompt('Havola:',url)})});
  document.getElementById('others').innerHTML=Object.keys(HOW).filter(function(k){return k!==P&&k!=='other'}).map(function(k){return '<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">'+esc(HOW[k].t)+'</summary><ol class="steps" style="margin-top:8px">'+HOW[k].s.map(function(x){return '<li>'+x+'</li>'}).join('')+'</ol></details>'}).join('');
}
document.addEventListener('halo-installable',function(){var b=document.getElementById('inst');if(b)b.hidden=false});
drawApps();drawHow();
`,
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
