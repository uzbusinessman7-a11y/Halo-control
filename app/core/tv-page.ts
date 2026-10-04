/**
 * HALO monitor menyusi — televizor ekrani sahifasi (parolsiz, faqat o'qiydi).
 *
 * Ranglar eski monitor menyusidagidek: qora fon, limon-sariq narx va belgilar, taom nomlari och ko'k.
 * Shriftlar saytning o'zida turadi (public/fonts, SIL OFL litsenziyasi) — ekran tashqi saytga bog'liq emas.
 *
 * Besh xil ko'rinish (har ekranga alohida tanlanadi — «Monitor menyu» → ekran sozlamalari; sinash: /tv/kebab?d=kino):
 *  - navbat  — taomlar bittalab katta ko'rsatiladi (kino ko'rinishi), hammasi o'tgach umumiy menyu (vitrina);
 *  - kino    — chapda bitta taomning katta surati va narxlari, o'ngda hamma taom ro'yxati;
 *  - vitrina — hamma taom surati yonma-yon, nom va narxlar surat ustida;
 *  - yorliq  — rasmsiz klassik menyu: ramka, nuqtali chiziqlar bilan narxlar;
 *  - halqa   — dumaloq rasm atrofida halqa + narx ro'yxati.
 *
 * Sahna 1920×1080 qilib chizilgan va har qanday televizor o'lchamiga butunligicha moslab kattalashtiriladi.
 * Ma'lumot har 30 soniyada yangilanadi; internet uzilsa oxirgi menyu ekranda qoladi.
 * Skript ichida teskari chiziq ishlatilmaydi (TypeScript matni ichida buzilmasin).
 */
export const TV_VERSION = "tv-2";

const CSS = `
@font-face{font-family:"HALO Display";src:url(/fonts/halo-tv-display.woff) format("woff");font-weight:100 900;font-display:swap}
@font-face{font-family:"HALO Text";src:url(/fonts/halo-tv-text.woff) format("woff");font-weight:100 900;font-display:swap}
@font-face{font-family:"HALO Wide";src:url(/fonts/halo-tv-wide.woff) format("woff");font-weight:200 900;font-display:swap}
@font-face{font-family:"HALO Serif";src:url(/fonts/halo-tv-serif.woff) format("woff");font-weight:100 900;font-display:swap}
:root{--bg:#0a0a0a;--panel:#141414;--acc:#fde047;--name:#bae6fd;--text:#ffffff;--soft:#d4d4d4;--muted:#a3a3a3;--hot:#ef4444;--line:rgba(253,224,71,.22);--thin:rgba(253,224,71,.14)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg);cursor:none}
body{color:var(--text);font-family:"HALO Text",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
#stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:50% 50%;overflow:hidden;background:var(--bg)}
#views{position:absolute;inset:0;transition:opacity .4s ease}
#views.out{opacity:0}
.view{position:absolute;inset:0}
.d{font-family:"HALO Display","Arial Narrow",Impact,sans-serif;font-weight:900;letter-spacing:.01em;line-height:.92}
.w{font-family:"HALO Wide","Arial Black",sans-serif;font-weight:800;line-height:1}
.f{font-family:"HALO Serif",Georgia,serif}
.mark{position:relative;color:var(--acc);width:max-content;white-space:nowrap}
.mark i{position:absolute;right:-.06em;top:-.09em;width:.67em;height:.2em;border:.052em solid var(--acc);border-radius:50%;transform:rotate(-9deg)}
.mark.w i{right:-.16em;top:-.24em;width:.92em;height:.28em;border-width:.08em}
.lab{display:block;color:var(--muted);text-transform:lowercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lab::first-letter{text-transform:uppercase}
.stamp{font-size:34px;color:var(--hot);border:3px solid var(--hot);border-radius:10px;padding:6px 16px 3px;transform:rotate(-4deg);white-space:nowrap}
.dots{display:flex;justify-content:center}
.dots i{width:12px;height:12px;border-radius:50%;background:rgba(253,224,71,.25);margin:0 6px}
.dots i.on{background:var(--acc)}
.say{position:relative;height:76px;min-width:520px}
.say>div{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;text-align:right;transition:opacity .7s ease}
.say .motto{font-size:23px;letter-spacing:.24em;color:var(--acc);white-space:nowrap}
.say .thanks{opacity:0}
.say .thanks b{font-size:27px;font-weight:700;color:var(--text)}
.say .thanks span{font-size:18px;color:var(--muted);margin-top:4px;max-width:860px}
.say.thank .motto{opacity:0}
.say.thank .thanks{opacity:1}
.set .pic{display:none}
.empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;row-gap:12px;color:var(--muted);font-size:24px}
.empty b{font-size:64px;color:var(--text);text-transform:uppercase}
#lost{position:absolute;right:22px;bottom:14px;width:10px;height:10px;border-radius:50%;background:var(--hot);display:none;z-index:6}
#lost.on{display:block}

/* ---------- halqa ---------- */
.va{padding:40px 60px 36px;display:grid;grid-template-rows:140px 1fr 100px;row-gap:24px;background:radial-gradient(720px 560px at 19% 50%,rgba(253,224,71,.09),transparent 72%)}
.top{display:grid;grid-template-columns:auto 1fr auto;align-items:center;column-gap:44px;border-bottom:1px solid var(--line);padding-bottom:18px}
.brand{display:grid;row-gap:6px}
.va .mark{font-size:96px}
.slogan{font-size:20px;color:var(--muted);letter-spacing:.04em;white-space:nowrap}
.title{font-size:124px;text-transform:uppercase;color:var(--text);padding-left:44px;border-left:1px solid var(--line);white-space:nowrap;overflow:hidden}
.info{display:grid;row-gap:8px;justify-items:end;text-align:right}
.info .hours{font-size:23px;color:var(--muted)}
.info .phone{font-size:50px;color:var(--acc);font-weight:800}
.mid{display:grid;grid-template-columns:620px 1fr;column-gap:56px;min-height:0}
.spot{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;min-height:0;transition:opacity .5s ease}
.spot.out{opacity:0}
.who{display:grid;justify-items:center;row-gap:12px;margin-top:20px;max-width:620px}
.halo{position:relative;width:392px;height:392px;flex:0 0 auto}
.halo svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.halo .ring{fill:none;stroke:rgba(253,224,71,.34);stroke-width:2}
.halo .arc{fill:none;stroke:var(--acc);stroke-width:6;stroke-linecap:round;stroke-dasharray:150 1100;transform-origin:196px 196px;animation:orbit 26s linear infinite}
.halo .draw{fill:none;stroke:var(--acc);stroke-width:2;stroke-dasharray:1220;stroke-dashoffset:1220;transform:rotate(-90deg);transform-origin:196px 196px}
.spot.in .halo .draw{animation:draw 1.1s ease-out forwards}
.dish{position:absolute;left:26px;top:26px;width:340px;height:340px;border-radius:50%;overflow:hidden;background:var(--panel);display:grid;place-items:center}
.dish b{font-size:190px;color:rgba(253,224,71,.2);line-height:1}
.dish img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.chip{position:absolute;right:8px;top:30px;background:var(--acc);color:#0a0a0a;font-weight:700;font-size:20px;padding:7px 16px;border-radius:99px;transform:rotate(9deg)}
.chip.hot{background:var(--hot);color:#fff}
.spot h2{font-size:88px;color:var(--name);white-space:nowrap;max-width:620px;text-transform:uppercase}
.spot .desc{font-size:21px;line-height:1.35;color:var(--muted);max-width:560px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rail{display:flex;justify-content:center;align-items:flex-end;margin-top:auto}
.rail .cell{padding:0 22px;border-left:1px solid var(--line);text-align:center}
.rail .cell:first-child{border-left:0}
.rail .lab{font-size:17px}
.rail .p{font-size:58px;color:var(--acc);white-space:nowrap}
.rail .p small{font-weight:800;font-size:26px;color:var(--muted);margin-left:6px}
.ledger{position:relative;min-height:0}
.rows{position:absolute;inset:0;display:grid}
.row{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:22px;padding:0 6px 0 26px;border-bottom:1px solid var(--thin);min-height:0}
.row:last-child{border-bottom:0}
.row::before{content:"";position:absolute;left:0;top:22%;bottom:22%;width:6px;border-radius:3px;background:var(--acc);transform:scaleY(0);transition:transform .45s ease}
.row.on::before{transform:scaleY(1)}
.thumb{position:relative;border-radius:50%;overflow:hidden;background:var(--panel);display:grid;place-items:center;box-shadow:0 0 0 2px rgba(253,224,71,.22);transition:box-shadow .45s}
.row.on .thumb{box-shadow:0 0 0 3px var(--acc),0 0 0 9px rgba(253,224,71,.16)}
.thumb b{color:rgba(253,224,71,.3);line-height:1}
.thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.what{min-width:0}
.what h3{display:flex;align-items:center;min-width:0;color:var(--name);text-transform:uppercase;transition:color .45s}
.what h3 span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.on .what h3{color:var(--acc)}
.what h3 em{font-family:"HALO Text",system-ui,sans-serif;font-style:normal;font-weight:700;font-size:15px;letter-spacing:0;color:#0a0a0a;background:var(--acc);border-radius:99px;padding:3px 10px;margin-left:12px;flex:0 0 auto;line-height:1.3;text-transform:none}
.what p{color:var(--muted);line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;margin-top:5px}
.prices{display:flex;align-items:flex-end;justify-content:flex-end}
.prices .cell{flex:0 0 auto;width:var(--cw,150px);text-align:right;padding-left:12px}
.prices .lab{font-size:16px}
.prices .p{color:var(--text);white-space:nowrap}
.on .prices .p{color:var(--acc)}
.sold .thumb,.sold .what{opacity:.38}
.base{display:grid;grid-template-columns:auto 1fr auto;align-items:center;column-gap:36px;border-top:1px solid var(--line);padding-top:20px}
.va .set{display:flex;align-items:center;background:var(--acc);color:#0a0a0a;border-radius:16px;padding:0 30px 0 26px;height:76px}
.va .set .pic{display:block;width:56px;height:56px;border-radius:50%;overflow:hidden;background:#0a0a0a;margin:0 18px 0 -12px;position:relative;flex:0 0 auto}
.va .set .pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.va .set .nm,.va .set .pp{font-family:"HALO Display","Arial Narrow",Impact,sans-serif;font-weight:900;white-space:nowrap}
.va .set .nm{font-size:46px}
.va .set .ab{font-size:21px;font-weight:500;margin:0 26px;padding-left:26px;border-left:2px solid rgba(10,10,10,.3);white-space:nowrap}
.va .set .pp{font-size:48px}

/* ---------- kino ---------- */
.vk{display:grid;grid-template-columns:860px 1fr}
.k-hero{position:relative;overflow:hidden;background:var(--bg);display:grid;grid-template-rows:660px minmax(0,1fr)}
.k-hero .ph{position:relative;overflow:hidden;display:grid;place-items:center;background:var(--panel);transition:opacity .45s ease}
.k-hero .ph b{font-size:420px;color:rgba(253,224,71,.1)}
.k-hero .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.k-hero.in .ph img{animation:zoom 14s ease-out forwards}
.k-hero .shade{position:absolute;left:0;right:0;top:0;height:661px;background:linear-gradient(180deg,rgba(10,10,10,.6) 0,transparent 22%,transparent 74%,#0a0a0a 100%);pointer-events:none}
.k-hero .mark{position:absolute;left:56px;top:44px;font-size:72px}
.k-hero .tag{position:absolute;right:44px;top:56px;background:var(--acc);color:#0a0a0a;font-weight:700;font-size:22px;padding:7px 18px;transition:opacity .45s ease}
.k-hero .cap{position:relative;padding:0 56px 46px;display:flex;flex-direction:column;justify-content:flex-end;min-height:0;transition:opacity .45s ease}
.k-hero.out .cap,.k-hero.out .ph,.k-hero.out .tag{opacity:0}
.k-hero h2{font-size:128px;color:var(--name);text-transform:uppercase}
.k-hero .desc{font-size:22px;line-height:1.35;color:var(--soft);margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.k-hero .krail{display:flex;margin-top:20px;border-top:2px solid var(--acc);padding-top:14px}
.k-hero .krail .cell{flex:1;min-width:0}
.k-hero .krail .lab{font-size:19px;color:var(--soft)}
.k-hero .krail .p{font-size:62px;color:var(--acc);white-space:nowrap}
.k-hero .krail .p small{font-weight:800;font-size:28px;margin-left:8px}
.k-hero .bar{position:absolute;left:0;bottom:0;height:8px;width:0;background:var(--acc)}
.k-hero.in .bar{animation-name:grow;animation-timing-function:linear;animation-fill-mode:forwards}
.k-side{position:relative;padding:44px 60px 34px 64px;display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-width:0}
.k-head{display:flex;align-items:flex-end;justify-content:space-between;column-gap:24px;padding-bottom:20px;border-bottom:1px solid var(--line)}
.k-head h1{font-size:130px;text-transform:uppercase;white-space:nowrap;overflow:hidden;min-width:0}
.k-head p{flex:0 0 auto;text-align:right;font-size:21px;color:var(--muted);line-height:1.5}
.k-head p b{display:block;font-size:44px;color:var(--acc);line-height:1}
.k-list{position:relative;display:grid;min-height:0}
.k-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:18px;border-bottom:1px solid var(--thin);min-height:0}
.k-row:last-child{border-bottom:0}
.k-row .what p{font-size:17px;white-space:nowrap;text-overflow:ellipsis;display:block}
.k-row .prices .lab{font-size:15px}
.k-foot{display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:center;column-gap:20px;border-top:1px solid var(--line);padding-top:20px}
.vk .set{border:2px solid var(--acc);color:var(--acc);padding:8px 22px;display:flex;align-items:baseline;gap:16px;white-space:nowrap}
.vk .set .nm,.vk .set .pp{font-family:"HALO Display","Arial Narrow",Impact,sans-serif;font-weight:900;font-size:38px;line-height:1}
.vk .set .ab{font-size:18px;color:var(--text)}
.vk .say{min-width:0;height:66px}
.vk .say .motto{font-size:19px;letter-spacing:.2em}
.vk .say .thanks b{font-size:21px}
.vk .say .thanks span{font-size:15px;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* ---------- vitrina ---------- */
.vv{display:grid;grid-template-rows:112px minmax(0,1fr) 92px}
.v-top{display:flex;align-items:center;justify-content:space-between;padding:0 48px;column-gap:30px}
.v-top .l{display:flex;align-items:center;gap:26px;min-width:0}
.vv .mark{font-size:50px}
.v-top .scr{font-size:50px;padding-left:26px;border-left:2px solid rgba(253,224,71,.35);text-transform:uppercase;white-space:nowrap}
.v-top .r{flex:0 0 auto;font-size:20px;color:var(--muted);text-align:right;white-space:nowrap}
.v-top .r b{font-size:30px;color:var(--acc);margin-left:22px}
.v-grid{position:relative;display:grid;grid-template-rows:repeat(2,minmax(0,1fr));gap:6px;padding:0 6px;min-height:0}
.v-tile{position:relative;overflow:hidden;background:var(--panel)}
.v-tile .ph{position:absolute;inset:0;display:grid;place-items:center}
.v-tile .ph b{font-size:240px;color:rgba(253,224,71,.1)}
.v-tile .ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.v-tile .shade{position:absolute;inset:0;background:linear-gradient(180deg,transparent 28%,rgba(10,10,10,.95) 80%)}
.v-tile .tag{position:absolute;left:22px;top:20px;background:var(--acc);color:#0a0a0a;font-weight:700;font-size:16px;padding:5px 12px}
.v-tile .cap{position:absolute;left:26px;right:26px;bottom:22px}
.v-tile h3{display:flex;font-size:42px;letter-spacing:-.02em;color:var(--name);text-transform:uppercase}
.v-tile h3 span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v-tile p{font-size:16px;color:var(--soft);margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v-tile .pr{display:flex;margin-top:14px;padding-top:12px;border-top:1px solid rgba(253,224,71,.4)}
.v-tile .pr div{flex:1;min-width:0}
.v-tile .pr .lab{font-size:14px;color:var(--soft)}
.v-tile .pr b{font-size:27px;color:var(--acc);letter-spacing:-.02em;white-space:nowrap}
.c4 .v-tile h3{font-size:32px}
.c4 .v-tile .pr b{font-size:20px}
.c4 .v-tile .pr .lab{font-size:12px}
.c4 .v-tile .cap{left:18px;right:18px}
.v-tile.on{outline:5px solid var(--acc);outline-offset:-5px}
.v-tile.sold .ph,.v-tile.sold .cap{opacity:.35}
.v-tile .stamp{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%) rotate(-4deg);font-size:46px;z-index:2}
.v-tile.fill{display:grid;place-content:center;justify-items:center;row-gap:16px;border:1px solid var(--thin)}
.v-tile.fill .mark{font-size:64px}
.v-tile.fill span{font-size:18px;color:var(--muted);letter-spacing:.04em}
.v-foot{display:grid;grid-template-columns:auto 1fr auto;align-items:center;column-gap:24px;padding:0 48px}
.vv .set{display:flex;align-items:center;gap:22px;background:var(--acc);color:#0a0a0a;padding:0 28px;height:60px;white-space:nowrap}
.vv .set .nm,.vv .set .pp{font-family:"HALO Wide","Arial Black",sans-serif;font-weight:800;font-size:26px}
.vv .set .ab{font-size:19px;font-weight:500}
.vv .say{height:70px}
.vv .say .motto{font-size:19px;letter-spacing:.26em}
.vv .say .thanks b{font-size:23px}
.vv .say .thanks span{font-size:16px}

/* ---------- yorliq ---------- */
.vy{background:radial-gradient(900px 620px at 50% 46%,#171717,#0a0a0a 75%)}
.y-frame{position:absolute;inset:26px;border:2px solid var(--acc)}
.y-frame2{position:absolute;inset:36px;border:1px solid rgba(253,224,71,.5)}
.y-in{position:absolute;inset:60px 96px 54px;display:grid;grid-template-rows:auto minmax(0,1fr) auto}
.y-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding-bottom:20px}
.y-top .l{font-size:21px;color:var(--muted)}
.y-top .r{text-align:right}
.y-top .r b{font-weight:500;font-size:38px;color:var(--acc)}
.y-crest{text-align:center}
.y-crest .ring{width:62px;height:17px;border:3px solid var(--acc);border-radius:50%;margin:0 auto 4px}
.y-crest h1{font-weight:700;font-size:84px;letter-spacing:.3em;margin-right:-.3em;color:var(--acc);line-height:1}
.y-crest p{display:flex;align-items:center;justify-content:center;gap:18px;font-size:26px;letter-spacing:.42em;margin:10px -.42em 0 0;color:var(--text);text-transform:uppercase}
.y-crest p i{width:90px;height:1px;background:var(--acc)}
.y-cols{display:grid;grid-template-columns:1fr 1fr;column-gap:110px;position:relative;border-top:1px solid rgba(253,224,71,.45);border-bottom:1px solid rgba(253,224,71,.45);padding:8px 0;min-height:0}
.y-cols .mid{position:absolute;left:50%;top:34px;bottom:34px;width:1px;background:rgba(253,224,71,.45)}
.y-cols .gem{position:absolute;left:50%;top:50%;width:16px;height:16px;background:#0f0f0f;border:1px solid var(--acc);transform:translate(-50%,-50%) rotate(45deg)}
.y-col{display:grid;min-height:0;min-width:0}
.y-it{display:flex;flex-direction:column;justify-content:center;border-top:1px solid var(--thin);min-height:0;min-width:0}
.y-it:first-child{border-top:0}
.y-it h3{display:flex;align-items:center;font-weight:700;font-size:50px;letter-spacing:.02em;line-height:1.05;color:var(--name);transition:color .45s}
.y-it h3 span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:capitalize}
.y-it.on h3{color:var(--acc)}
.y-it h3 em{font-family:"HALO Text",system-ui,sans-serif;font-style:normal;font-weight:700;font-size:14px;letter-spacing:.1em;color:#0a0a0a;background:var(--acc);padding:3px 9px;margin-left:14px;flex:0 0 auto}
.y-it .about{font-size:18px;color:var(--muted);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.y-it .pr{display:grid;grid-template-columns:1fr 1fr;column-gap:44px;row-gap:2px;margin-top:10px}
.y-it .pr.one{grid-template-columns:1fr}
.y-it .pr div{display:flex;align-items:baseline;min-width:0}
.y-it .pr .lab{font-size:19px;color:var(--soft);flex:0 1 auto}
.y-it .pr u{flex:1;min-width:20px;border-bottom:2px dotted rgba(253,224,71,.5);margin:0 10px;text-decoration:none;transform:translateY(-5px)}
.y-it .pr b{font-weight:500;font-size:36px;color:var(--acc);font-variant-numeric:lining-nums tabular-nums;white-space:nowrap}
.r4 .y-it h3{font-size:40px}
.r4 .y-it .about{font-size:16px;margin-top:4px}
.r4 .y-it .pr{margin-top:6px}
.r4 .y-it .pr b{font-size:29px}
.r4 .y-it .pr .lab{font-size:17px}
.y-it.sold h3,.y-it.sold .about{opacity:.38}
.y-sold{font-size:24px;letter-spacing:.2em;color:var(--hot);margin-top:10px}
.y-foot{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;column-gap:24px;padding-top:18px}
.vy .say{min-width:0;height:62px}
.vy .say>div{align-items:flex-start;text-align:left}
.vy .say .motto{font-size:18px;letter-spacing:.3em}
.vy .say .thanks b{font-size:21px}
.vy .say .thanks span{font-size:15px;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vy .set{border:1px solid var(--acc);padding:9px 34px;display:flex;align-items:baseline;gap:20px;white-space:nowrap}
.vy .set .nm,.vy .set .pp{font-family:"HALO Serif",Georgia,serif;font-weight:700;font-size:30px;letter-spacing:.12em;color:var(--acc)}
.vy .set .ab{font-family:"HALO Serif",Georgia,serif;font-size:21px;color:var(--text)}
.y-right{display:flex;flex-direction:column;align-items:flex-end;row-gap:8px;font-size:18px;letter-spacing:.3em;color:var(--acc);text-transform:uppercase;white-space:nowrap}

/* ---------- aksiya (hamma ko'rinish ustida) ---------- */
#promo{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.88);opacity:0;pointer-events:none;transition:opacity .5s ease;z-index:5}
#promo.on{opacity:1}
.pbox{position:relative;display:grid;grid-template-columns:520px minmax(0,1fr);column-gap:64px;align-items:center;width:1480px;padding:56px;background:var(--panel);border:3px solid var(--acc)}
.pph{position:relative;width:520px;height:520px;overflow:hidden;background:var(--bg);display:grid;place-items:center}
.pph b{font-size:300px;color:rgba(253,224,71,.2)}
.pph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ptx{min-width:0}
.ptx .eyebrow{font-size:28px;color:var(--acc);font-weight:500}
.ptx h2{font-size:150px;color:var(--name);text-transform:uppercase;white-space:nowrap;overflow:hidden;margin-top:10px}
.ptx p{font-size:28px;color:var(--soft);margin-top:14px;line-height:1.35}
.pprice{display:flex;align-items:baseline;gap:28px;margin-top:30px}
.pprice .old{font-size:60px;color:var(--muted);text-decoration:line-through;text-decoration-thickness:4px}
.pprice b{font-size:130px;color:var(--acc);white-space:nowrap}
#promo .chip{right:-20px;top:-24px;font-size:34px;padding:10px 26px}

@keyframes orbit{to{transform:rotate(360deg)}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes grow{to{width:100%}}
@keyframes zoom{from{transform:scale(1)}to{transform:scale(1.07)}}
@media (prefers-reduced-motion:reduce){.halo .arc,.k-hero.in .ph img{animation:none}.spot.in .halo .draw{animation:none;stroke-dashoffset:0}#views,.spot,.row::before,.say>div,.k-hero .cap,.k-hero .ph{transition:none}}
`;

const SCRIPT = `
var stage=document.getElementById('stage'),views=document.getElementById('views'),DATA=null,RAW='',tick=0,active=0,stepAt=0,phase='single',phaseAt=0,ovPage=0,promoOn=false,promoAt=0,promoEnd=0,thanksOn=false,thanksAt=0,thanksEnd=0,lastLoad=0,shown='';
var KEY='halo-tv:'+CFG.b+':'+CFG.screen,DESIGNS=['navbat','kino','vitrina','yorliq','halqa'];
function byId(id){return document.getElementById(id)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return Number(n||0).toLocaleString('en-US')}
function fitStage(){var s=Math.min(window.innerWidth/1920,window.innerHeight/1080);stage.style.transform='translate(-50%,-50%) scale('+s+')'}
window.addEventListener('resize',fitStage);fitStage();
function pic(src){return src?'<img src="'+esc(src)+'" alt="" onerror="this.remove()">':''}
function first(name){return esc(String(name||'H').trim().charAt(0).toUpperCase())}
function shrink(el,max,min,step){var size=max;el.style.fontSize=size+'px';while(el.scrollWidth>el.clientWidth+1&&size>min){size-=step||4;el.style.fontSize=size+'px'}}
function fitNames(sel,min){views.querySelectorAll(sel).forEach(function(h3){var sp=h3.firstChild,size=parseInt(window.getComputedStyle(h3).fontSize,10)||40;while(sp.scrollWidth>sp.clientWidth+1&&size>min){size-=2;h3.style.fontSize=size+'px'}})}
function liveItems(){return DATA?DATA.items.filter(function(i){return !i.soldOut}):[]}
function cur(){var l=liveItems();return l.length?l[active%l.length]:null}
function promoNow(){var p=DATA&&DATA.promotion;if(!p)return null;var d=new Date(),z=function(n){return (n<10?'0':'')+n};
  var now=d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes());
  if(p.startsAt&&now<p.startsAt)return null;if(p.endsAt&&now>p.endsAt)return null;return p}
function design(){var d=CFG.d||(DATA&&DATA.screen.design)||'navbat';return DESIGNS.indexOf(d)<0?'navbat':d}
function view(){var d=design();if(d!=='navbat')return d;return phase==='overview'||!liveItems().length?'vitrina':'kino'}
function lab(v,many){return many||v.label?'<span class="lab">'+esc(v.label)+'</span>':''}
function setHtml(){var s=DATA.setOffer;if(!s)return '<div></div>';
  return '<div class="set">'+(s.image?'<span class="pic"><img src="'+esc(s.image)+'" alt="" onerror="this.parentNode.remove()"></span>':'')+'<b class="nm">'+esc(s.title)+'</b>'+(s.description?'<span class="ab">'+esc(s.description)+'</span>':'')+(s.price?'<b class="pp">'+won(s.price)+' ₩</b>':'')+'</div>'}
function sayHtml(){var t=DATA.thanks;return '<div class="say'+(thanksOn&&t?' thank':'')+'" id="say"><div class="motto">'+esc(DATA.restaurant.footer)+'</div><div class="thanks">'+(t?'<b>'+esc(t.title)+'</b><span>'+esc(t.message)+'</span>':'')+'</div></div>'}
function dotsInner(pages,page){var h='';if(pages>1)for(var i=0;i<pages;i++)h+='<i class="'+(i===page?'on':'')+'"></i>';return h}
function pageOf(per,forced){var items=DATA.items,c=cur(),i=c?items.indexOf(c):0,pages=Math.max(1,Math.ceil(items.length/per)),page=forced==null?Math.floor(Math.max(0,i)/per):Math.min(forced,pages-1);
  return {page:page,pages:pages,list:items.slice(page*per,page*per+per)}}
function emptyHtml(){return '<div class="empty"><b class="d">'+esc(DATA.screen.title)+'</b><span>Bu ekranga hali taom qo‘shilmagan.</span><span>HALO Control → Monitor menyu sahifasida qo‘shing.</span></div>'}
function priceCells(it,size){return it.variants.map(function(v){return '<div class="cell">'+lab(v,it.variants.length>1)+'<div class="p d" style="font-size:'+size+'px">'+won(v.price)+'</div></div>'}).join('')}

/* ---------- halqa ---------- */
function viewHalqa(){var r=DATA.restaurant;
  return '<div class="view va"><header class="top"><div class="brand"><div class="mark d">'+esc(r.name)+'<i></i></div><div class="slogan">'+esc(r.slogan)+'</div></div><h1 class="title d" id="title">'+esc(DATA.screen.title)+'</h1><div class="info"><span class="hours">'+esc(r.hours)+'</span><span class="phone d">'+esc(r.phone)+'</span></div></header>'
    +'<main class="mid"><section class="spot" id="spot"></section><section class="ledger" id="ledger"></section></main>'
    +'<footer class="base">'+setHtml()+'<div class="dots" id="dots"></div>'+sayHtml()+'</footer></div>'}
function halqaRows(){var box=byId('ledger'),items=DATA.items;if(!items.length){box.innerHTML=emptyHtml();return}
  var per=DATA.screen.itemsPerPage,pg=pageOf(per),list=pg.list,n=Math.max(list.length,pg.pages>1?per:5),h=Math.floor(box.clientHeight/n),c=cur(),most=1;
  list.forEach(function(it){if(!it.soldOut&&it.variants.length>most)most=it.variants.length});
  var cw=Math.min(210,Math.floor(600/most)),th=Math.min(h-20,92),name=h>=108?52:h>=92?46:40,desc=h>=92?18:16,clamp=h>=120?2:1,price=(h>=108?46:h>=92?42:36)+(most<=2?8:0);
  box.innerHTML='<div class="rows" style="--cw:'+cw+'px;grid-template-rows:repeat('+n+',1fr)">'+list.map(function(it){
    return '<div class="row'+(c&&it===c?' on':'')+(it.soldOut?' sold':'')+'" data-id="'+esc(it.id)+'">'
      +'<div class="thumb" style="width:'+th+'px;height:'+th+'px"><b class="d" style="font-size:'+Math.round(th*0.56)+'px">'+first(it.name)+'</b>'+pic(it.image)+'</div>'
      +'<div class="what"><h3 class="d" style="font-size:'+name+'px"><span>'+esc(it.name)+'</span>'+(it.badge&&!it.soldOut?'<em>'+esc(it.badge)+'</em>':'')+'</h3>'
      +(it.description?'<p style="font-size:'+desc+'px;-webkit-line-clamp:'+clamp+'">'+esc(it.description)+'</p>':'')+'</div>'
      +(it.soldOut?'<div class="stamp d">'+esc(it.soldOutText)+'</div>':'<div class="prices">'+priceCells(it,price)+'</div>')+'</div>'}).join('')+'</div>';
  fitNames('.row .what h3',34);byId('dots').innerHTML=dotsInner(pg.pages,pg.page)}
function halqaSpot(instant){var box=byId('spot'),it=cur();if(!box)return;if(!it){box.innerHTML='';return}
  var html='<div class="halo"><svg viewBox="0 0 392 392"><circle class="ring" cx="196" cy="196" r="194"/><circle class="draw" cx="196" cy="196" r="194"/><circle class="arc" cx="196" cy="196" r="194"/></svg>'
    +'<div class="dish"><b class="d">'+first(it.name)+'</b>'+pic(it.image)+'</div>'+(it.badge?'<span class="chip">'+esc(it.badge)+'</span>':'')+'</div>'
    +'<div class="who"><h2 class="d" id="spotName">'+esc(it.name)+'</h2>'+(it.description?'<p class="desc">'+esc(it.description)+'</p>':'')+'</div>'
    +'<div class="rail">'+it.variants.map(function(v){return '<div class="cell">'+lab(v,it.variants.length>1)+'<div class="p d"'+(it.variants.length>3?' style="font-size:46px"':'')+'>'+won(v.price)+(it.variants.length<3?'<small>₩</small>':'')+'</div></div>'}).join('')+'</div>';
  var put=function(){if(!document.body.contains(box))return;box.innerHTML=html;var n=byId('spotName');if(n)shrink(n,88,48);box.className='spot in'};
  if(instant)put();else{box.className='spot out';setTimeout(put,480)}}

/* ---------- kino ---------- */
function viewKino(){var r=DATA.restaurant;
  return '<div class="view vk"><section class="k-hero" id="kHero"></section><section class="k-side"><div class="k-head"><h1 class="d" id="title">'+esc(DATA.screen.title)+'</h1><p><span>'+esc(r.hours)+'</span><b class="d">'+esc(r.phone)+'</b></p></div>'
    +'<div class="k-list" id="kList"></div><div class="k-foot">'+setHtml()+'<div class="dots" id="dots"></div>'+sayHtml()+'</div></section></div>'}
function kinoList(){var box=byId('kList'),items=DATA.items;if(!items.length){box.innerHTML=emptyHtml();return}
  var per=DATA.screen.itemsPerPage,pg=pageOf(per),list=pg.list,n=Math.max(list.length,pg.pages>1?per:5),h=Math.floor(box.clientHeight/n),c=cur(),most=1;
  list.forEach(function(it){if(!it.soldOut&&it.variants.length>most)most=it.variants.length});
  var cw=Math.min(170,Math.floor(536/most)),name=h>=118?58:h>=100?50:42,price=(h>=118?44:h>=100?40:34)+(most<=2?8:0);
  box.style.gridTemplateRows='repeat('+n+',1fr)';box.style.setProperty('--cw',cw+'px');
  box.innerHTML=list.map(function(it){
    return '<div class="k-row'+(c&&it===c?' on':'')+(it.soldOut?' sold':'')+'" data-id="'+esc(it.id)+'"><div class="what"><h3 class="d" style="font-size:'+name+'px"><span>'+esc(it.name)+'</span></h3>'+(it.description&&h>=96?'<p>'+esc(it.description)+'</p>':'')+'</div>'
      +(it.soldOut?'<div class="stamp d">'+esc(it.soldOutText)+'</div>':'<div class="prices">'+priceCells(it,price)+'</div>')+'</div>'}).join('');
  fitNames('.k-row .what h3',32);byId('dots').innerHTML=dotsInner(pg.pages,pg.page)}
function kinoHero(instant){var box=byId('kHero'),it=cur(),r=DATA.restaurant;if(!box)return;
  var html='<div class="ph">'+(it?'<b class="d">'+first(it.name)+'</b>'+pic(it.image):'')+'</div><div class="shade"></div><div class="mark d">'+esc(r.name)+'<i></i></div>'
    +(it&&it.badge?'<span class="tag">'+esc(it.badge)+'</span>':'')
    +(it?'<div class="cap"><h2 class="d" id="kName">'+esc(it.name)+'</h2>'+(it.description?'<p class="desc">'+esc(it.description)+'</p>':'')
      +'<div class="krail">'+it.variants.map(function(v){return '<div class="cell">'+lab(v,it.variants.length>1)+'<div class="p d">'+won(v.price)+(it.variants.length<3?'<small>₩</small>':'')+'</div></div>'}).join('')+'</div></div>'
      +'<div class="bar" style="animation-duration:'+DATA.screen.spotlightSeconds+'s"></div>':'<div class="cap"><h2 class="d">'+esc(DATA.screen.title)+'</h2></div>');
  var put=function(){if(!document.body.contains(box))return;box.innerHTML=html;var n=byId('kName');
    if(n){var size=128;n.style.fontSize=size+'px';while((n.scrollWidth>n.clientWidth+1||n.offsetHeight>190)&&size>56){size-=4;n.style.fontSize=size+'px'}}
    box.className='k-hero in'};
  if(instant)put();else{box.className='k-hero out';setTimeout(put,450)}}

/* ---------- vitrina ---------- */
function viewVitrina(){var r=DATA.restaurant,items=DATA.items,per=items.length<=6?6:8,nav=design()==='navbat',pg=pageOf(per,nav?ovPage:null),cols=per===6?3:4,c=nav?null:cur();
  var cells=pg.list.map(function(it){
    return '<div class="v-tile'+(c&&it===c?' on':'')+(it.soldOut?' sold':'')+'" data-id="'+esc(it.id)+'"><div class="ph"><b class="w">'+first(it.name)+'</b>'+pic(it.image)+'</div><div class="shade"></div>'
      +(it.badge&&!it.soldOut?'<span class="tag">'+esc(it.badge)+'</span>':'')+(it.soldOut?'<div class="stamp d">'+esc(it.soldOutText)+'</div>':'')
      +'<div class="cap"><h3 class="w"><span>'+esc(it.name)+'</span></h3>'+(it.description?'<p>'+esc(it.description)+'</p>':'')
      +(it.soldOut?'':'<div class="pr">'+it.variants.map(function(v){return '<div>'+lab(v,it.variants.length>1)+'<b class="w">'+won(v.price)+'</b></div>'}).join('')+'</div>')+'</div></div>'}).join('');
  for(var k=pg.list.length;k<per;k++)cells+='<div class="v-tile fill"><div class="mark w">'+esc(r.name)+'<i></i></div><span>'+esc(r.slogan)+'</span></div>';
  return '<div class="view vv"><header class="v-top"><div class="l"><div class="mark w">'+esc(r.name)+'<i></i></div><div class="scr w" id="title">'+esc(DATA.screen.title)+'</div></div><div class="r"><span>'+esc(r.hours)+'</span><b class="w">'+esc(r.phone)+'</b></div></header>'
    +(items.length?'<main class="v-grid c'+cols+'" style="grid-template-columns:repeat('+cols+',minmax(0,1fr))">'+cells+'</main>':'<main class="v-grid">'+emptyHtml()+'</main>')
    +'<footer class="v-foot">'+setHtml()+'<div class="dots" id="dots">'+dotsInner(pg.pages,pg.page)+'</div>'+sayHtml()+'</footer></div>'}

/* ---------- yorliq ---------- */
function viewYorliq(){var r=DATA.restaurant,items=DATA.items,per=items.length<=6?6:8,pg=pageOf(per),rows=per/2,c=cur();
  var item=function(it){return '<div class="y-it'+(c&&it===c?' on':'')+(it.soldOut?' sold':'')+'" data-id="'+esc(it.id)+'"><h3 class="f"><span>'+esc(String(it.name).toLowerCase())+'</span>'+(it.badge&&!it.soldOut?'<em>'+esc(it.badge)+'</em>':'')+'</h3>'
    +(it.description?'<div class="about">'+esc(it.description)+'</div>':'')
    +(it.soldOut?'<div class="y-sold">'+esc(it.soldOutText)+'</div>':'<div class="pr'+(it.variants.length===1?' one':'')+'">'+it.variants.map(function(v){return '<div><span class="lab">'+esc(v.label)+'</span><u></u><b class="f">'+won(v.price)+'</b></div>'}).join('')+'</div>')+'</div>'};
  var col=function(list){return '<div class="y-col" style="grid-template-rows:repeat('+rows+',1fr)">'+list.map(item).join('')+'</div>'};
  return '<div class="view vy r'+rows+'"><div class="y-frame"></div><div class="y-frame2"></div><div class="y-in"><header class="y-top"><div class="l">'+esc(r.hours)+'</div>'
    +'<div class="y-crest"><div class="ring"></div><h1 class="f">'+esc(r.name)+'</h1><p><i></i><span id="title">'+esc(DATA.screen.title)+'</span><i></i></p></div><div class="r"><b class="f">'+esc(r.phone)+'</b></div></header>'
    +(items.length?'<main class="y-cols"><div class="mid"></div><div class="gem"></div>'+col(pg.list.slice(0,rows))+col(pg.list.slice(rows))+'</main>':'<main class="y-cols" style="position:relative">'+emptyHtml()+'</main>')
    +'<footer class="y-foot">'+sayHtml()+setHtml()+'<div class="y-right"><div class="dots" id="dots">'+dotsInner(pg.pages,pg.page)+'</div><span>'+esc(r.slogan)+'</span></div></footer></div></div>'}

/* ---------- umumiy boshqaruv ---------- */
var ready=false;
function start(){if(ready)return;ready=true;if(DATA)build(false)}
if(document.fonts&&document.fonts.load){Promise.all(['900 20px "HALO Display"','500 20px "HALO Text"','800 20px "HALO Wide"','700 20px "HALO Serif"'].map(function(f){return document.fonts.load(f)})).then(start,start);setTimeout(start,3000)}else start();
function build(fade){if(!DATA||!ready)return;var v=view(),html=v==='kino'?viewKino():v==='vitrina'?viewVitrina():v==='yorliq'?viewYorliq():viewHalqa();
  var put=function(){views.innerHTML=html;shown=v;var t=byId('title');
    if(v==='halqa'){shrink(t,124,64);halqaRows();halqaSpot(true)}
    else if(v==='kino'){shrink(t,130,64);kinoList();kinoHero(true)}
    else if(v==='vitrina'){fitNames('.v-tile h3',20)}
    else{fitNames('.y-it h3',26)}
    views.className='';document.title=DATA.restaurant.name+' — '+DATA.screen.title};
  if(fade&&shown&&shown!==v){views.className='out';setTimeout(put,420)}else put()}
function toggle(sel,id){views.querySelectorAll(sel).forEach(function(e){e.classList.toggle('on',e.getAttribute('data-id')===id)})}
function has(sel,id){return !!views.querySelector(sel+'[data-id="'+id+'"]')}
function mark(){var c=cur(),id=c?c.id:'';
  if(shown==='halqa'){halqaSpot(false);if(has('.row',id))toggle('.row',id);else halqaRows();return}
  if(shown==='kino'){kinoHero(false);if(has('.k-row',id))toggle('.k-row',id);else kinoList();return}
  if(shown==='vitrina'){if(design()==='navbat')return;if(has('.v-tile',id))toggle('.v-tile',id);else build(false);return}
  if(has('.y-it',id))toggle('.y-it',id);else build(false)}
function showPromo(p){var box=byId('promo');
  box.innerHTML='<div class="pbox"><div class="pph"><b class="d">'+first(p.title)+'</b>'+pic(p.image)+'</div><div class="ptx">'+(p.eyebrow?'<div class="eyebrow">'+esc(p.eyebrow)+'</div>':'')+'<h2 class="d" id="pName">'+esc(p.title)+'</h2>'+(p.description?'<p>'+esc(p.description)+'</p>':'')
    +'<div class="pprice">'+(p.oldPrice>p.price?'<span class="old d">'+won(p.oldPrice)+'</span>':'')+'<b class="d">'+won(p.price)+' ₩</b></div></div>'+(p.badge?'<span class="chip hot">'+esc(p.badge)+'</span>':'')+'</div>';
  box.className='on';var n=byId('pName');if(n)shrink(n,150,60,6)}
function apply(d,raw){if(raw===RAW)return;var firstTime=!DATA;RAW=raw;DATA=d;if(firstTime){stepAt=tick;phaseAt=tick;promoEnd=tick;thanksEnd=tick}
  if(active>=liveItems().length)active=0;if(!DATA.thanks)thanksOn=false;build(false)}
function advance(){var live=liveItems(),sec=DATA.screen.spotlightSeconds;
  if(design()==='navbat'){
    if(shown==='vitrina'){if(!live.length)return;
      if(tick-phaseAt>=DATA.screen.overviewSeconds){var per=DATA.items.length<=6?6:8,pages=Math.ceil(DATA.items.length/per);
        if(ovPage+1<pages){ovPage+=1;phaseAt=tick;build(true)}else{phase='single';active=0;stepAt=tick;build(true)}}
      return}
    if(tick-stepAt>=sec){if(active+1>=live.length){phase='overview';ovPage=0;phaseAt=tick;build(true)}else{active+=1;stepAt=tick;mark()}}
    return}
  if(live.length>1&&tick-stepAt>=sec){active=(active+1)%live.length;stepAt=tick;mark()}}
function load(){lastLoad=tick;
  fetch('/api/v2/tv?data=1&screen='+encodeURIComponent(CFG.screen)+'&b='+encodeURIComponent(CFG.b),{cache:'no-store'}).then(function(r){return r.text()}).then(function(raw){
    var d=JSON.parse(raw);if(!d.ok)throw new Error('no');
    if(d.v!==CFG.v){location.reload();return}
    byId('lost').className='';try{localStorage.setItem(KEY,raw)}catch(e){}
    apply(d,raw)}).catch(function(){byId('lost').className='on'})}
try{var saved=localStorage.getItem(KEY);if(saved){var old=JSON.parse(saved);if(old&&old.ok&&old.v===CFG.v)apply(old,saved)}}catch(e){}
load();
setInterval(function(){tick+=1;
  if(tick-lastLoad>=30)load();
  if(tick>21600&&navigator.onLine){location.reload();return}
  if(!DATA)return;
  var p=promoNow();
  if(promoOn){if(!p||tick-promoAt>=p.durationSeconds){promoOn=false;promoEnd=tick;byId('promo').className='';stepAt=tick;phaseAt=tick}}
  else if(p&&tick-promoEnd>=p.intervalSeconds){promoOn=true;promoAt=tick;showPromo(p)}
  else advance();
  var t=DATA.thanks,say=byId('say');
  if(t&&say){if(thanksOn){if(tick-thanksAt>=t.durationSeconds){thanksOn=false;thanksEnd=tick;say.className='say'}}
    else if(tick-thanksEnd>=t.intervalSeconds){thanksOn=true;thanksAt=tick;say.className='say thank'}}
},1000);
document.addEventListener('click',function(){var el=document.documentElement;if(!document.fullscreenElement&&el.requestFullscreen)el.requestFullscreen().catch(function(){})});
try{if(navigator.wakeLock)navigator.wakeLock.request('screen').catch(function(){})}catch(e){}
`;

export function tvPage(input: { screen: string; branch: string; design?: string }): string {
  const cfg = JSON.stringify({ screen: input.screen, b: input.branch, v: TV_VERSION, d: input.design || "" }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<meta name="theme-color" content="#0a0a0a"><title>HALO — menyu</title>
<link rel="preload" href="/fonts/halo-tv-display.woff" as="font" type="font/woff" crossorigin><link rel="preload" href="/fonts/halo-tv-text.woff" as="font" type="font/woff" crossorigin>
<style>${CSS}</style></head><body>
<div id="stage"><div id="views"></div><div id="promo"></div>
<div id="lost" title="Internet yo‘q — oxirgi menyu ko‘rsatilmoqda"></div>
</div>
<script>var CFG=${cfg};${SCRIPT}</script></body></html>`;
}
