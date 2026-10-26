/**
 * HALO V2 — A4 menyu (chop etish va PDF uchun).
 *
 * - Ma'lumot «Monitor menyu» bazasidan (v2_digital_menu) olinadi — televizordagi bilan aynan bir xil: taom, tavsif,
 *   rasm, variant va narx. Narx HALO Control menyusiga bog'langan bo'lsa, o'sha taomning hozirgi sotuv narxi.
 * - Har bir ekran (Kebab, Chicken, Pitsa …) — bitta A4 sahifa: tepada brend va bo'lim nomi, birinchi taom katta
 *   ko'rinishda, qolganlari ikki ustunda, pastda SET MENU va aloqa. Taom ko'p bo'lsa (9 tadan ortiq) — keyingi sahifa.
 * - Hech narsa yozmaydi. Tannarx, retsept va ichki ma'lumot chiqmaydi (tvView faqat ko'rinadigan narsani beradi).
 * - «SOTILDI» belgisi chop etilmaydi: qog'oz menyu uzoq turadi, taom tugashi esa vaqtincha.
 */
import type { TvItem, TvView } from "./digital-menu";

const esc = (value: string) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const won = (amount: number) => `₩${Math.round(amount).toLocaleString("en-US")}`;
const norm = (value: string) => String(value || "").toLowerCase().replace(/[‘’`ʻʼ']/g, "").replace(/\s+/g, " ").trim();
/** Rahbar hali to'ldirmagan namuna tavsif — menyuga chiqmaydi. */
export const isPlaceholderText = (value: string) => norm(value) === "taom haqida qisqa malumot";

/** Brend yozuvlari (bazada yo'q, rahbarning A4 menyusidagi bilan bir xil). */
const TAGLINE = "Halollikdan boshlanadigan maza";
const HALAL = "100% HALAL";
const HANDLE = "@HALO_FASTFOOD1";
/** Bitta sahifada: 1 ta katta + 8 tagacha (4 qator × 2). */
const PER_SHEET = 9;

/**
 * Jadvaldagi «TYPE / SIZE» yozuvi. Variant nomi taom nomini takrorlasa («Tandir lavash» → chicken) — faqat o'lcham;
 * boshqacha bo'lsa («Suyaksiz» → 450 gram) — ikkalasi ham. Ma'lumotning o'zi o'zgarmaydi.
 */
export function variantText(itemName: string, variant: { label: string; size: string }): string {
  const name = norm(itemName);
  const label = norm(variant.label);
  const size = String(variant.size || "").trim();
  if (!size) return String(variant.label || "").trim() || "—";
  const repeats = !label || label === name || label.startsWith(name) || name.includes(label);
  return repeats ? size : `${String(variant.label).trim()} · ${size}`;
}

export interface A4Sheet {
  screenId: string; title: string; names: string[];
  hero: TvItem | null; grid: TvItem[];
  /** SET MENU kartasi to'rning bo'sh katagiga qo'yiladimi (aks holda pastki qatorda). */
  setInGrid: boolean;
  /** To'r: 5 va undan ko'p taomda 3 ustun (rasm kesilib ketmasin), aks holda 2 ustun. */
  cols: number; rows: number; page: number; pages: number;
}

/** Ekranlardan A4 sahifalar ro'yxati (taomi yo'q ekran chiqmaydi). `only` — faqat bitta ekran. */
export function a4Sheets(views: TvView[], only = ""): A4Sheet[] {
  const chosen = only && views.some((view) => view.screen.id === only) ? views.filter((view) => view.screen.id === only) : views;
  const sheets: A4Sheet[] = [];
  for (const view of chosen) {
    const items = view.items.filter((item) => item.variants.length > 0);
    for (let start = 0; start < items.length; start += PER_SHEET) {
      const chunk = items.slice(start, start + PER_SHEET);
      const grid = chunk.slice(1);
      const cols = grid.length >= 5 ? 3 : 2;
      const setInGrid = Boolean(view.setOffer) && grid.length % cols !== 0;
      const rows = Math.ceil((grid.length + (setInGrid ? 1 : 0)) / cols);
      sheets.push({
        screenId: view.screen.id, title: view.screen.title, names: items.map((item) => item.name),
        hero: chunk[0] || null, grid, setInGrid, cols, rows, page: 0, pages: 0,
      });
    }
  }
  return sheets.map((sheet, index) => ({ ...sheet, page: index + 1, pages: sheets.length }));
}

function photo(src: string, fallback: string, badge: string, alt: string): string {
  const first = src || fallback;
  const backup = src && fallback && fallback !== src ? fallback : "";
  const onerror = backup ? ` onerror="this.onerror=function(){this.remove()};this.src=this.dataset.b"` : ` onerror="this.remove()"`;
  const img = first ? `<img src="${esc(first)}"${backup ? ` data-b="${esc(backup)}"` : ""}${onerror} alt="${esc(alt)}">` : "";
  return `<div class="ph">${img}<span class="ph-x">${esc(alt.charAt(0) || "H")}</span>${badge ? `<b class="badge">${esc(badge)}</b>` : ""}</div>`;
}

function table(item: TvItem): string {
  return `<table class="pt"><thead><tr><th>TYPE / SIZE</th><th>PRICE</th></tr></thead><tbody>${item.variants.map((variant) =>
    `<tr><td>${esc(variantText(item.name, variant))}</td><td>${won(variant.price)}</td></tr>`).join("")}</tbody></table>`;
}

function about(item: TvItem): string {
  return item.description && !isPlaceholderText(item.description) ? `<p class="ds">${esc(item.description)}</p>` : "";
}

function heroCard(item: TvItem, fallback: string): string {
  return `<article class="hero">${photo(item.image, fallback, item.badge, item.name)}<div class="hx"><h2>${esc(item.name)}</h2>${about(item)}${table(item)}</div></article>`;
}

function card(item: TvItem, fallback: string): string {
  return `<article class="card">${photo(item.image, fallback, item.badge, item.name)}<div class="tx"><h3>${esc(item.name)}</h3>${about(item)}${table(item)}</div></article>`;
}

type SetOffer = NonNullable<TvView["setOffer"]>;
function setCard(set: SetOffer): string {
  return `<article class="card set">${photo(set.image, "", "", set.title)}<div class="tx"><span class="eyebrow">${esc(set.title)}</span><h3>${esc(set.description)}</h3><strong class="big">${won(set.price)}</strong></div></article>`;
}

function foot(view: TvView, sheet: A4Sheet): string {
  const r = view.restaurant;
  const set = view.setOffer && !sheet.setInGrid
    ? `<div class="setbar">${photo(view.setOffer.image, "", "", view.setOffer.title)}<div><span class="eyebrow">${esc(view.setOffer.title)}</span><span class="sd">${esc(view.setOffer.description)}</span><strong>${won(view.setOffer.price)}</strong></div></div>`
    : "";
  const contact = set
    ? `<div class="ct"><b>${esc(HANDLE)}</b><span>${esc(r.phone)}</span><span>${esc(r.footer)}</span></div>`
    : `<span class="fm">${esc(r.footer)}</span><div class="ct"><b>${esc(HANDLE)}</b><span>${esc(r.phone)}</span></div>`;
  return `<footer class="ft${set ? " with-set" : ""}">${set}${contact}</footer>`;
}

function sheetHtml(view: TvView, sheet: A4Sheet): string {
  const r = view.restaurant;
  const mark = (r.name.trim().charAt(0) || "H").toUpperCase();
  const cells = sheet.grid.map((item) => card(item, view.screen.fallbackImage)).join("") + (sheet.setInGrid && view.setOffer ? setCard(view.setOffer) : "");
  return `<div class="wrap"><section class="sheet" data-screen="${esc(sheet.screenId)}">
<header class="top"><div class="brand"><span class="mark">${esc(mark)}</span><div><b class="bn">${esc(r.name)}</b><span class="sl">${esc(r.slogan)}</span><span class="tg">${esc(TAGLINE)}</span></div></div>
<div class="cat"><h1>${esc(sheet.title)}</h1><span class="hl">${esc(HALAL)} · ${sheet.page}/${sheet.pages}</span><span class="nm">${esc(sheet.names.join(" · "))}</span></div></header>
${sheet.hero ? heroCard(sheet.hero, view.screen.fallbackImage) : ""}
${cells ? `<div class="grid c${sheet.cols}" style="grid-template-columns:repeat(${sheet.cols},minmax(0,1fr));grid-template-rows:repeat(${Math.max(1, sheet.rows)},minmax(0,1fr))">${cells}</div>` : `<div class="grid empty"></div>`}
${foot(view, sheet)}
</section></div>`;
}

export function a4Page(views: TvView[], options: { only?: string; branch?: string; today?: string } = {}): string {
  const only = views.some((view) => view.screen.id === options.only) ? String(options.only) : "";
  options = { ...options, only };
  const sheets = a4Sheets(views, only);
  const byScreen = new Map(views.map((view) => [view.screen.id, view]));
  const name = views[0]?.restaurant.name || "HALO";
  const q = (screen: string) => `/api/v2/tv?a4=1${screen ? `&amp;screen=${encodeURIComponent(screen)}` : ""}${options.branch && options.branch !== "main" ? `&amp;b=${encodeURIComponent(options.branch)}` : ""}`;
  const chips = [`<a class="chip${options.only ? "" : " on"}" href="${q("")}">Hammasi</a>`, ...views.filter((view) => view.items.length)
    .map((view) => `<a class="chip${options.only === view.screen.id ? " on" : ""}" href="${q(view.screen.id)}">${esc(view.screen.title)}</a>`)].join("");
  const date = options.today ? options.today.split("-").reverse().join(".") : "";
  const body = sheets.length
    ? sheets.map((sheet) => sheetHtml(byScreen.get(sheet.screenId)!, sheet)).join("\n")
    : `<p class="none">Menyuda taom yo‘q. «Monitor menyu» bo‘limida taom qo‘shing.</p>`;
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} — A4 menyu</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&amp;display=swap" rel="stylesheet">
<style>${A4_CSS}</style></head><body>
<div class="bar"><div class="bar-in"><b>${esc(name)} · A4 menyu</b><div class="chips">${chips}</div><div class="acts"><button id="pdf" type="button" data-file="${esc(`${name}_menyu${options.only ? `_${options.only}` : ""}${options.today ? `_${options.today}` : ""}.pdf`)}"${sheets.length ? "" : " disabled"}>📄 PDF yuklab olish</button><button id="print" class="ghost" type="button">🖨 Chop etish</button></div></div>
<p class="note">Narx va rasmlar «Monitor menyu»dan${date ? ` · ${esc(date)}` : ""}. «PDF yuklab olish» — A4 fayl telefoningizga tushadi: undan chop etasiz yoki yuborasiz.</p><div id="pdfOut" class="note"></div></div>
<main>${body}</main>
<script>${A4_SCRIPT}${A4_PDF_SCRIPT}</script></body></html>`;
}

const A4_CSS = String.raw`
:root{--bg:#0b0b0d;--card:#151518;--card2:#1b1b1f;--line:rgba(255,255,255,.075);--text:#f5f2ea;--muted:#9b978d;--gold:#f6b82f;--gold2:#ffd36b;--k:1}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#232327}
body{font-family:Montserrat,"Segoe UI",Arial,sans-serif;color:var(--text);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;z-index:5;background:#111114ee;backdrop-filter:blur(8px);border-bottom:1px solid #ffffff14;padding:10px 12px 8px}
.bar-in{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;max-width:820px;margin:0 auto}
.bar b{font-size:14px;letter-spacing:.02em}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{color:var(--text);text-decoration:none;font-size:12px;font-weight:600;border:1px solid #ffffff24;border-radius:999px;padding:5px 11px}
.chip.on{background:var(--gold);border-color:var(--gold);color:#141414}
.acts{display:flex;gap:6px}
#pdf,#print{font:inherit;font-weight:800;font-size:13px;background:var(--gold);color:#141414;border:0;border-radius:10px;padding:9px 14px;cursor:pointer}
#print.ghost{background:transparent;color:var(--text);border:1px solid #ffffff30}
#pdf[disabled],#print[disabled]{opacity:.6}
#pdfOut:empty{display:none}
#pdfOut{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--text);font-size:12px}
#pdfOut .chip{cursor:pointer;font:inherit;font-weight:700}
#pdfOut .bad{color:#ff8a7a}
.note{max-width:820px;margin:6px auto 0;color:var(--muted);font-size:11px;line-height:1.4}
main{padding:14px 12px 30px}
.none{color:var(--muted);text-align:center;padding:40px 0}
.wrap{width:calc(210mm * var(--k));height:calc(297mm * var(--k));margin:0 auto 16px;box-shadow:0 10px 40px #0008}
.sheet{width:210mm;height:297mm;transform:scale(var(--k));transform-origin:0 0;overflow:hidden;position:relative;background:var(--bg);
  background-image:radial-gradient(120mm 80mm at 100% 0,#f6b82f14,transparent 70%),radial-gradient(100mm 90mm at 0 100%,#ffffff08,transparent 70%);
  padding:9mm 9mm 8mm;display:flex;flex-direction:column;gap:3.4mm}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:6mm;padding-bottom:3mm;border-bottom:.3mm solid var(--line)}
.brand{display:flex;gap:3mm;align-items:center}
.mark{width:12.5mm;height:12.5mm;border-radius:50%;background:linear-gradient(145deg,var(--gold2),var(--gold));color:#1a1405;display:grid;place-items:center;font-weight:900;font-size:7mm;box-shadow:0 0 0 .6mm #f6b82f33}
.brand .bn{display:block;font-size:9.6mm;line-height:.95;font-weight:900;letter-spacing:.04em}
.brand .sl{display:block;font-size:2.5mm;letter-spacing:.14em;color:var(--muted);font-weight:600;margin-top:1mm;text-transform:uppercase}
.brand .tg{display:block;font-size:2.6mm;color:var(--gold);font-weight:600;margin-top:.6mm}
.cat{text-align:right;min-width:0}
.cat h1{font-size:10.5mm;line-height:.95;font-weight:900;letter-spacing:.03em;text-transform:uppercase}
.cat .hl{display:block;margin-top:1.2mm;font-size:2.8mm;font-weight:800;letter-spacing:.12em;color:var(--gold)}
.cat .nm{display:block;margin-top:.8mm;font-size:2.3mm;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;max-width:110mm;margin-left:auto}
.ph{position:relative;overflow:hidden;background:linear-gradient(145deg,#24242a,#121215)}
.ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}
.ph::after{content:"";position:absolute;inset:0;z-index:2;background:linear-gradient(180deg,transparent 55%,#0000004d)}
.ph-x{position:absolute;inset:0;display:grid;place-items:center;font-size:14mm;font-weight:900;color:#ffffff12}
.badge{position:absolute;z-index:3;left:2.6mm;top:2.6mm;background:var(--gold);color:#17120a;font-size:2.4mm;font-weight:900;letter-spacing:.08em;border-radius:99mm;padding:.8mm 2.4mm}
.hero{display:grid;grid-template-columns:48% 1fr;height:66mm;flex:none;background:var(--card);border:.3mm solid var(--line);border-radius:4mm;overflow:hidden}
.hero .ph{height:100%;border-right:.6mm solid var(--gold)}
.hx{padding:5mm 6.5mm;display:flex;flex-direction:column;justify-content:center;gap:4mm;min-width:0}
.hx h2{font-size:7.4mm;line-height:1;font-weight:900;letter-spacing:.02em;text-transform:uppercase}
.hx .ds{margin-top:-2mm;font-size:2.8mm;color:var(--muted);line-height:1.35}
.hx .pt{margin-top:0;font-size:3.3mm}
.hx .pt td{padding:1.25mm 0}
.grid{flex:1;min-height:0;display:grid;gap:3.4mm}
.card{background:var(--card);border:.3mm solid var(--line);border-radius:4mm;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.card .ph{flex:1 1 auto;min-height:12mm}
.tx{padding:3mm 4mm 3.4mm;flex:none;min-width:0}
.tx h3{font-size:4.5mm;line-height:1.05;font-weight:900;letter-spacing:.02em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tx .ds{margin-top:.8mm;font-size:2.35mm;line-height:1.35;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pt{width:100%;border-collapse:collapse;margin-top:2.2mm;font-size:2.95mm}
.pt th{font-size:2.15mm;letter-spacing:.12em;color:var(--muted);font-weight:700;text-align:left;padding:.9mm 0;border-bottom:.3mm solid var(--line);background:linear-gradient(90deg,#ffffff07,transparent)}
.pt th:last-child,.pt td:last-child{text-align:right}
.pt td{padding:.85mm 0;border-bottom:.2mm solid #ffffff0d;text-transform:uppercase;letter-spacing:.03em;font-weight:600;color:#dcd8cf}
.pt tr:last-child td{border-bottom:0}
.pt td:last-child{color:var(--gold);font-weight:800;letter-spacing:0;white-space:nowrap;padding-left:2mm}
.grid.c3 .tx{padding:2.8mm 3.4mm 3mm}
.grid.c3 .tx h3{font-size:4.2mm}
.eyebrow{display:block;font-size:2.4mm;font-weight:800;letter-spacing:.16em;color:var(--gold);text-transform:uppercase}
.card.set h3{margin-top:.8mm;white-space:normal;text-transform:none;font-weight:700;font-size:3.6mm}
.card.set .big{display:block;margin-top:1.6mm;font-size:7mm;font-weight:900;color:var(--gold)}
.ft{flex:none;display:flex;justify-content:space-between;align-items:center;gap:4mm;background:var(--card);border:.3mm solid var(--line);border-radius:4mm;padding:2.6mm 5mm;min-height:10mm}
.ft.with-set{justify-content:space-between;padding:0 5mm 0 0;height:21mm;overflow:hidden}
.setbar{display:flex;align-items:center;gap:4mm;height:100%}
.setbar .ph{width:30mm;height:100%}
.setbar .sd{display:block;font-size:2.8mm;color:#dcd8cf;margin-top:.6mm}
.setbar strong{display:block;font-size:6mm;font-weight:900;color:var(--gold);margin-top:.4mm}
.ct{text-align:right;display:flex;flex-direction:column;gap:.5mm}
.ft:not(.with-set) .ct{flex-direction:row;gap:5mm;align-items:center}
.fm{font-size:2.7mm;font-weight:800;letter-spacing:.16em;color:var(--gold)}
.ct b{font-size:3.1mm;font-weight:800;letter-spacing:.04em}
.ct span{font-size:2.5mm;color:var(--muted);letter-spacing:.06em}
@page{size:A4;margin:0}
@media print{
  html,body{background:var(--bg)}
  .bar{display:none}
  main{padding:0}
  .wrap{width:auto;height:auto;margin:0;box-shadow:none;break-after:page;page-break-after:always}
  .wrap:last-child{break-after:auto;page-break-after:auto}
  .sheet{transform:none}
}
`;

const A4_SCRIPT = String.raw`
(function(){
  var root=document.documentElement;
  function fit(){var w=Math.min(window.innerWidth,root.clientWidth)-24;var k=Math.min(1,Math.max(.2,w/793.7));root.style.setProperty('--k',String(k))}
  fit();window.addEventListener('resize',fit);
  // Bir sahifadagi kartalarning yozuv qismi bir xil balandlikda — rasmlar ham bir xil o'lchamda, qatorlar tekis.
  function even(){[].slice.call(document.querySelectorAll('.sheet')).forEach(function(sheet){
    var list=[].slice.call(sheet.querySelectorAll('.grid .tx'));list.forEach(function(t){t.style.height=''});
    var max=0;list.forEach(function(t){max=Math.max(max,t.offsetHeight)});list.forEach(function(t){t.style.height=max+'px'})})}
  even();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(even);window.addEventListener('load',even);
  var b=document.getElementById('print');if(!b)return;
  b.addEventListener('click',function(){
    var wait=[].slice.call(document.images).filter(function(i){return !i.complete}).map(function(i){return new Promise(function(done){i.addEventListener('load',done,{once:true});i.addEventListener('error',done,{once:true})})});
    if(document.fonts&&document.fonts.ready)wait.push(document.fonts.ready);
    b.disabled=true;b.textContent='Rasmlar yuklanmoqda…';
    Promise.all(wait).then(function(){b.disabled=false;b.textContent='🖨 Chop etish';window.print()});
  });
})();
`;

/**
 * «📄 PDF yuklab olish»: har A4 sahifa brauzerning o'zida 300 dpi rasmga chiziladi (sahifadagi joylashuv aynan
 * o'sha: har harf, rasm va karta brauzer qo'ygan joyda) va JPEG sahifalardan haqiqiy A4 PDF fayl yig'iladi.
 * Hech qanday tashqi kutubxona yo'q; serverga hech narsa yuborilmaydi.
 */
const A4_PDF_SCRIPT = String.raw`
(function(){
  var btn=document.getElementById('pdf'),out=document.getElementById('pdfOut');if(!btn||!out)return;
  var W=2480,H=3508;
  function px(v){return parseFloat(v)||0}
  function clear(c){return !c||c==='transparent'||/rgba\([^)]*,\s*0\)$/.test(c)}
  function rr(ctx,x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2));ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}
  function glow(ctx,cx,cy,rx,ry,color){ctx.save();ctx.translate(cx,cy);ctx.scale(1,ry/rx);var g=ctx.createRadialGradient(0,0,0,0,0,rx);g.addColorStop(0,color);g.addColorStop(0.7,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(-rx,-rx,2*rx,2*rx);ctx.restore()}
  function cover(ctx,im,x,y,w,h){var nw=im.naturalWidth,nh=im.naturalHeight;if(!nw||!nh)return;var s=Math.max(w/nw,h/nh),sw=w/s,sh=h/s;ctx.drawImage(im,(nw-sw)/2,(nh-sh)/2,sw,sh,x,y,w,h)}
  function side(ctx,cs,S,x,y,w,h,u){var lw=px(cs['border'+S+'Width'])*u,col=cs['border'+S+'Color'];if(!(lw>0)||cs['border'+S+'Style']==='none'||clear(col))return;ctx.fillStyle=col;
    if(S==='Bottom')ctx.fillRect(x,y+h-lw,w,lw);else if(S==='Top')ctx.fillRect(x,y,w,lw);else if(S==='Right')ctx.fillRect(x+w-lw,y,lw,h);else ctx.fillRect(x,y,lw,h)}
  // Rasm o'z sahifamizdan blob sifatida olinadi — kanvas «iflos» bo'lmaydi (PDF saqlanadi).
  function load(src){return fetch(src,{credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error('img');return r.blob()}).then(function(b){return new Promise(function(ok){var i=new Image();i.onload=function(){ok(i)};i.onerror=function(){ok(null)};i.src=URL.createObjectURL(b)})}).catch(function(){return null})}
  function paint(sheet,ctx,imgs){
    var R=sheet.getBoundingClientRect(),f=W/R.width,u=W/sheet.offsetWidth;
    var X=function(v){return (v-R.left)*f},Y=function(v){return (v-R.top)*f},mm=W/210;
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#0b0b0d';ctx.fillRect(0,0,W,H);
    glow(ctx,W,0,120*mm,80*mm,'rgba(246,184,47,0.078)');glow(ctx,0,H,100*mm,90*mm,'rgba(255,255,255,0.03)');
    var els=sheet.querySelectorAll('*');
    for(var i=0;i<els.length;i++){
      var el=els[i],cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden')continue;
      var b=el.getBoundingClientRect();if(!b.width||!b.height)continue;
      var x=X(b.left),y=Y(b.top),w=b.width*f,h=b.height*f,rad=px(cs.borderTopLeftRadius)*u;
      ctx.save();
      var c=el.parentNode&&el.parentNode.closest?el.parentNode.closest('.hero,.card,.ft'):null;
      if(c&&sheet.contains(c)){var cb=c.getBoundingClientRect();rr(ctx,X(cb.left),Y(cb.top),cb.width*f,cb.height*f,px(getComputedStyle(c).borderTopLeftRadius)*u);ctx.clip()}
      if(el.tagName==='IMG'){var im=imgs[el.getAttribute('src')];if(im){cover(ctx,im,x,y,w,h);var g=ctx.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(0.55,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,0.3)');ctx.fillStyle=g;ctx.fillRect(x,y,w,h)}}
      else{
        if(el.classList.contains('mark')){var gm=ctx.createLinearGradient(x,y,x+w,y+h);gm.addColorStop(0,'#ffd36b');gm.addColorStop(1,'#f6b82f');ctx.beginPath();ctx.arc(x+w/2,y+h/2,w/2+0.6*mm,0,7);ctx.fillStyle='rgba(246,184,47,0.2)';ctx.fill();ctx.beginPath();ctx.arc(x+w/2,y+h/2,w/2,0,7);ctx.fillStyle=gm;ctx.fill()}
        else if(el.classList.contains('ph')){var gp=ctx.createLinearGradient(x,y,x+w,y+h);gp.addColorStop(0,'#24242a');gp.addColorStop(1,'#121215');ctx.fillStyle=gp;ctx.fillRect(x,y,w,h)}
        else if(el.tagName==='TH'){var gt=ctx.createLinearGradient(x,0,x+w,0);gt.addColorStop(0,'rgba(255,255,255,0.027)');gt.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gt;ctx.fillRect(x,y,w,h)}
        else if(!clear(cs.backgroundColor)){rr(ctx,x,y,w,h,rad);ctx.fillStyle=cs.backgroundColor;ctx.fill()}
        var bw=px(cs.borderTopWidth);
        if(bw>0&&cs.borderTopStyle!=='none'&&cs.borderTopWidth===cs.borderRightWidth&&cs.borderTopWidth===cs.borderBottomWidth&&cs.borderTopWidth===cs.borderLeftWidth){var lw=bw*u;rr(ctx,x+lw/2,y+lw/2,w-lw,h-lw,Math.max(0,rad-lw/2));ctx.lineWidth=lw;ctx.strokeStyle=cs.borderTopColor;ctx.stroke()}
        else{side(ctx,cs,'Bottom',x,y,w,h,u);side(ctx,cs,'Right',x,y,w,h,u);side(ctx,cs,'Top',x,y,w,h,u);side(ctx,cs,'Left',x,y,w,h,u)}
      }
      ctx.restore();
    }
    // Yozuvlar: har harf brauzer joylashtirgan aynan o'sha nuqtada (shrift, harf oralig'i va qator bir xil).
    var tw=document.createTreeWalker(sheet,NodeFilter.SHOW_TEXT,null),n,range=document.createRange();
    while((n=tw.nextNode())){
      var s=n.nodeValue;if(!s||!s.trim())continue;
      var el2=n.parentNode,cs2=getComputedStyle(el2);
      if(el2.classList.contains('ph-x')&&el2.parentNode.querySelector('img'))continue;
      var size=px(cs2.fontSize)*u;ctx.font=cs2.fontStyle+' '+cs2.fontWeight+' '+size+'px '+cs2.fontFamily;ctx.fillStyle=cs2.color;ctx.textBaseline='alphabetic';
      var mt=ctx.measureText('Hg'),desc=typeof mt.fontBoundingBoxDescent==='number'?mt.fontBoundingBoxDescent:size*0.24;
      var up=cs2.textTransform==='uppercase';
      ctx.save();
      var box=null,p=el2;while(p&&p!==sheet){if(getComputedStyle(p).overflow!=='visible'){box=p.getBoundingClientRect();break}p=p.parentNode}
      if(box){ctx.beginPath();ctx.rect(X(box.left),Y(box.top),box.width*f,box.height*f);ctx.clip()}
      for(var k=0;k<s.length;k++){
        var code=s.charCodeAt(k),len=code>=0xD800&&code<=0xDBFF?2:1,ch=s.substr(k,len);
        if(/\s/.test(ch)){continue}
        range.setStart(n,k);range.setEnd(n,k+len);k+=len-1;
        var rs=range.getClientRects(),r=rs[0];if(!r||!r.width)continue;
        ctx.fillText(up?ch.toUpperCase():ch,X(r.left),Y(r.bottom)-desc);
      }
      ctx.restore();
    }
  }
  // Oddiy PDF: har sahifa — bitta JPEG (A4, 595.28 × 841.89 pt).
  function makePdf(pages){
    var enc=new TextEncoder(),parts=[],len=0,offs=[];
    function put(x){var b=typeof x==='string'?enc.encode(x):x;parts.push(b);len+=b.length}
    put('%PDF-1.4\n');put(new Uint8Array([37,226,227,207,211,10]));
    var n=pages.length,kids=[];for(var i=0;i<n;i++)kids.push((3+i*3)+' 0 R');
    offs[1]=len;put('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    offs[2]=len;put('2 0 obj\n<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+n+' >>\nendobj\n');
    for(var j=0;j<n;j++){var pg=3+j*3,ct=pg+1,im=pg+2,content='q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
      offs[pg]=len;put(pg+' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 '+im+' 0 R >> >> /Contents '+ct+' 0 R >>\nendobj\n');
      offs[ct]=len;put(ct+' 0 obj\n<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream\nendobj\n');
      offs[im]=len;put(im+' 0 obj\n<< /Type /XObject /Subtype /Image /Width '+W+' /Height '+H+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+pages[j].length+' >>\nstream\n');put(pages[j]);put('\nendstream\nendobj\n')}
    var count=3+n*3,xref=len,t='xref\n0 '+count+'\n0000000000 65535 f \n';
    for(var o=1;o<count;o++)t+=('0000000000'+offs[o]).slice(-10)+' 00000 n \n';
    put(t+'trailer\n<< /Size '+count+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
    return new Blob(parts,{type:'application/pdf'});
  }
  var label=btn.textContent,lastUrl='';
  btn.addEventListener('click',function(){
    if(btn.disabled)return;btn.disabled=true;out.innerHTML='';
    var sheets=[].slice.call(document.querySelectorAll('.sheet')),srcs={},imgs={};
    sheets.forEach(function(sh){[].slice.call(sh.querySelectorAll('img')).forEach(function(i){srcs[i.getAttribute('src')]=1})});
    var say=function(t){btn.textContent=t};say('Tayyorlanmoqda…');
    Promise.all(Object.keys(srcs).map(function(src){return load(src).then(function(im){imgs[src]=im})}))
      .then(function(){return document.fonts&&document.fonts.ready?document.fonts.ready:null})
      .then(function(){
        var canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;var ctx=canvas.getContext('2d'),pages=[];
        function step(k){if(k>=sheets.length)return Promise.resolve(pages);say('Sahifa '+(k+1)+'/'+sheets.length+'…');
          return new Promise(function(res){setTimeout(res,30)}).then(function(){paint(sheets[k],ctx,imgs);
            return new Promise(function(res,rej){canvas.toBlob(function(bl){bl?res(bl):rej(new Error('jpeg'))},'image/jpeg',0.9)})})
            .then(function(bl){return bl.arrayBuffer()}).then(function(buf){pages.push(new Uint8Array(buf));return step(k+1)})}
        return step(0);
      })
      .then(function(pages){
        var blob=makePdf(pages),name=btn.getAttribute('data-file')||'HALO_menyu.pdf';window.HALO_PDF=blob;
        if(lastUrl)URL.revokeObjectURL(lastUrl);lastUrl=URL.createObjectURL(blob);
        var file=null;try{file=new File([blob],name,{type:'application/pdf'})}catch(e){}
        var share=file&&navigator.canShare&&navigator.canShare({files:[file]});
        out.innerHTML='<span>✓ PDF tayyor · '+pages.length+' sahifa · '+(blob.size/1048576).toFixed(1)+' MB</span><a class="chip on" id="pdfDl" href="'+lastUrl+'" download="'+name+'">⬇️ Yuklab olish</a>'+(share?'<button class="chip" id="pdfShare" type="button">📤 Ulashish / Chop etish</button>':'');
        var sb=document.getElementById('pdfShare');if(sb)sb.addEventListener('click',function(){navigator.share({files:[file],title:name}).catch(function(){})});
        try{document.getElementById('pdfDl').click()}catch(e){}
      })
      .catch(function(){out.innerHTML='<span class="bad">PDF tayyorlanmadi. Sahifani yangilab, qayta urinib ko‘ring.</span>'})
      .then(function(){btn.disabled=false;say(label)});
  });
})();
`;
