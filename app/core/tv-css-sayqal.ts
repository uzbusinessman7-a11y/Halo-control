/**
 * HALO monitor menyusi — «sayqallangan variant» (ixtiyoriy: /menu?screen=kebab&look=premium).
 *
 * Bu YANGI DIZAYN EMAS. Asl CSS (tv-css.ts, eski saytdagi bilan so'zma-so'z) to'liq ishlaydi; shu fayl uning
 * USTIDAN qo'shiladigan kichik qatlam. Joylashuv, ranglar, kartalar va TYPE/SIZE/PRICE jadvali o'sha.
 * Manzilda &look=premium bo'lmasa bu fayl umuman ishlatilmaydi — asl ko'rinish o'zgarmaydi.
 *
 * Nima o'zgaradi va nega (televizorlar baland osilgan, mijoz uzoqdan o'qiydi):
 *  1. Yozuvlar kattaroq: umumiy ko'rinishda nom 24→34, narx 29→40; katta ko'rinishda nom 52→68,
 *     jadval yozuvi 20→28, narx 25→40 (1920×1080 dagi piksel). Matn sig'ishi uchun katta ko'rinishda
 *     rasm 68% → 64%, yozuvlar 32% → 36%.
 *  2. Umumiy ko'rinishda bitta narx o'rniga hamma narx (2–4 ta bo'lsa): rasm 70% → 60%, yozuv 30% → 40%.
 *  3. Taom almashganda keskin emas, yumshoq ochiladi (0,45 soniya).
 *  4. «SET MENU» yozuvi ekranning pastki chetidan 6 piksel ko'tarilgan; tarkibi va ish vaqti kattaroq.
 *  5. To'liq ekranda «TO'LIQ EKRAN» tugmasi ko'rinmaydi.
 * (Jadvaldagi harflarni bir xil qilish va namuna tavsifni yashirish — tv-page.ts da, HTML chizilayotganda.)
 *
 * O'lchamlar ekran eniga nisbatan (vw): 1920 da 1vw = 19,2 piksel — har qanday televizorda nisbat bir xil.
 */
export const TV_CSS_SAYQAL = `
/* tepa */
.screen-name{font-size:1.35vw}
.brand strong{font-size:1.56vw}
html:-webkit-full-screen .fullscreen{visibility:hidden}
html:fullscreen .fullscreen{visibility:hidden}

/* umumiy ko'rinish: nom va narx kattaroq */
.menu-page .copy h2{height:auto;max-height:2.4em;margin:0;font-size:1.77vw;line-height:1.2;white-space:normal}
.menu-page .price strong{font-size:2.08vw;letter-spacing:-.04em}
.menu-page .price strong.from:after{content:"~"}

/* umumiy ko'rinish: hamma narx (sahifada ko'p narxli taom bo'lsa) */
.menu-page.many .photo{height:60%}
.menu-page.many .copy{height:40%}
.menu-page.many .item-text,.menu-page.many .price{width:50%}
.menu-page.many .copy h2{max-height:3.6em}
.menu-page .price.list{align-items:stretch;justify-content:center}
.mini{display:flex;align-items:center;justify-content:space-between;height:25%;max-height:2.1vw}
.mini span{min-width:0;overflow:hidden;color:#f0f1f3;font-size:1.15vw;font-weight:800;white-space:nowrap;text-overflow:ellipsis}
.mini b{margin-left:.5vw;color:#ffb000;font-size:1.56vw;font-weight:900;letter-spacing:-.03em;white-space:nowrap}
/* 3–4 taomli sahifa (rasm yonida yozuv) — asl nisbatlar qoladi */
.menu-page.many.cols-2.rows-2 .photo,.menu-page.many.cols-2.rows-2 .copy{height:100%}
.menu-page.many.cols-2.rows-2 .item-text,.menu-page.many.cols-2.rows-2 .price{width:100%}

/* katta ko'rinish: rasm 64%, yozuvlar 36%; nom, tarkib va jadval kattaroq */
.menu-page .menu-card.item-focus-active .photo{flex:0 0 64%;width:64%;height:100%}
.menu-page .menu-card.item-focus-active .copy{flex:1 1 36%;width:36%;height:100%}
.menu-page .menu-card.item-focus-active .item-text{width:100%}
.menu-page .menu-card.item-focus-active .copy h2{height:auto;max-height:none;margin:0 0 .7vw;font-size:3.54vw;line-height:1.04;white-space:normal}
.menu-page .menu-card.item-focus-active .copy p{max-height:5.7vw;font-size:1.35vw;line-height:1.4}
.variant-head span:nth-child(1),.variant-row span:nth-child(1){width:40%}
.variant-head span:nth-child(2),.variant-row span:nth-child(2){width:25%}
.variant-head span:nth-child(3),.variant-row strong{width:35%}
.item-focus-active .variant-head,.daily-offer-page .variant-head{font-size:.8vw}
.item-focus-active .variant-row,.daily-offer-page .variant-row{min-height:3.3vw;margin-top:.4vw;padding:.5vw .7vw}
.item-focus-active .variant-row span,.daily-offer-page .variant-row span{font-size:1.46vw;line-height:1.15}
.item-focus-active .variant-row strong,.daily-offer-page .variant-row strong,.item-focus-active .variant-price em,.daily-offer-page .variant-price em{font-size:2.08vw}

/* taom almashganda yumshoq ochiladi */
.menu-card .card-inner{-webkit-animation:halo-soft-b .45s ease both;animation:halo-soft-b .45s ease both}
.menu-card.item-focus-active .card-inner{-webkit-animation-name:halo-soft-a;animation-name:halo-soft-a}
.daily-offer-page.active .combo-card{-webkit-animation:halo-soft-a .45s ease both;animation:halo-soft-a .45s ease both}
@-webkit-keyframes halo-soft-a{from{opacity:0}to{opacity:1}}
@keyframes halo-soft-a{from{opacity:0}to{opacity:1}}
@-webkit-keyframes halo-soft-b{from{opacity:0}to{opacity:1}}
@keyframes halo-soft-b{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.menu-card .card-inner,.daily-offer-page.active .combo-card{-webkit-animation:none;animation:none}}

/* SET MENU: yozuv pastki chetdan ko'tarilgan, tarkib va ish vaqti kattaroq */
footer.set-strip .set-media{height:106px}
footer.set-strip .set-photo{height:76px}
.set-copy>span{font-size:1.15vw}
.set-hours{font-size:1.25vw}
@media(max-width:1400px){footer.set-strip .set-media{height:92px}footer.set-strip .set-photo{height:64px}}
`;
