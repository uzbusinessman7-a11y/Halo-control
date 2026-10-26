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
<div class="bar"><div class="bar-in"><b>${esc(name)} · A4 menyu</b><div class="chips">${chips}</div><button id="print" type="button">🖨 Chop etish / PDF</button></div>
<p class="note">Narx va rasmlar «Monitor menyu»dan${date ? ` · ${esc(date)}` : ""}. Telefonda: «Chop etish» → oynani ikki barmoq bilan kattalashtiring → Ulashish → PDF saqlash.</p></div>
<main>${body}</main>
<script>${A4_SCRIPT}</script></body></html>`;
}

const A4_CSS = String.raw`
:root{--bg:#0b0b0d;--card:#151518;--card2:#1b1b1f;--line:rgba(255,255,255,.075);--text:#f5f2ea;--muted:#9b978d;--gold:#f6b82f;--gold2:#ffd36b;--k:1}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#232327}
body{font-family:Montserrat,"Segoe UI",Arial,sans-serif;color:var(--text);-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums}
.bar{position:sticky;top:0;z-index:5;background:#111114ee;backdrop-filter:blur(8px);border-bottom:1px solid #ffffff14;padding:10px 12px 8px}
.bar-in{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;max-width:820px;margin:0 auto}
.bar b{font-size:14px;letter-spacing:.02em}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{color:var(--text);text-decoration:none;font-size:12px;font-weight:600;border:1px solid #ffffff24;border-radius:999px;padding:5px 11px}
.chip.on{background:var(--gold);border-color:var(--gold);color:#141414}
#print{font:inherit;font-weight:800;font-size:13px;background:var(--gold);color:#141414;border:0;border-radius:10px;padding:9px 14px;cursor:pointer}
#print[disabled]{opacity:.6}
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
    Promise.all(wait).then(function(){b.disabled=false;b.textContent='🖨 Chop etish / PDF';window.print()});
  });
})();
`;
