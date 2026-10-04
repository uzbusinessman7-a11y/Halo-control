import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const dm = await import('../app/core/digital-menu.ts');
const { DIGITAL_MENU_SEED, DM_LEGACY_LABELS, DM_OLD_ORIGIN } = await import('../app/core/digital-menu-seed.ts');
const { tvPage, tvRender, tvRevision, tvLook, TV_VERSION } = await import('../app/core/tv-page.ts');
const { TV_CSS_SAYQAL } = await import('../app/core/tv-css-sayqal.ts');
const { TV_CSS } = await import('../app/core/tv-css.ts');
const tvRoute = await import('../app/api/v2/tv/route.ts');
const monitorRoute = await import('../app/api/v2/monitor/route.ts');
const sha = (value) => createHash('sha256').update(value).digest('hex');

const recipes = [
  { id: 'r-kc', name: 'Kebab chicken', price: 8200, categoryId: 'recipe-kebab' },
  { id: 'r-kl', name: 'Kebab lamb', price: 9100, categoryId: 'recipe-kebab' },
  { id: 'r-cheese', name: 'Cheese pizza', price: 12500, categoryId: 'recipe-pizza' },
  { id: 'r-cheese2', name: 'Cheese pizza small', price: 9900, categoryId: 'recipe-pizza' },
  { id: 'r-hunter', name: 'Hunter’s pizza', price: 14900, categoryId: 'recipe-pizza' },
  { id: 'r-fried', name: 'Fried chicken suyaksiz 450g', price: 11900, categoryId: 'recipe-chicken' },
  { id: 'r-sweet', name: 'Sweet chili suyaksiz 450g', price: 13900, categoryId: 'recipe-chicken' },
];

test('boshlang‘ich menyu: 18 taom, 3 ekran, eski ekrandagi asl TYPE/SIZE matnlari; buzuq ma’lumot xato bermaydi', () => {
  const seed = dm.seedDm();
  assert.equal(seed.items.length, 18);
  assert.deepEqual(seed.screens.map((s) => s.id), ['kebab', 'chicken', 'pitsa']);
  assert.deepEqual(['kebab', 'chicken', 'pitsa'].map((id) => seed.items.filter((i) => i.screen === id).length), [6, 5, 7]);
  assert.ok(seed.items.every((item) => item.variants.length >= 1 && item.variants.every((v) => v.price > 0 && !v.recipeId && v.active)));
  // eski sayt ID'lari saqlangan
  assert.equal(seed.items.find((i) => i.name === 'TANDIR LAVASH').id, 'item-1786163282248-7aaatn');
  const kebab = seed.items.find((item) => item.name === 'KEBAB');
  assert.deepEqual(kebab.variants.map((v) => [v.label, v.size, v.price]), [['Kebab', 'Chicken', 7900], ['Kebab', 'Lamb', 8900], ['Kebab', 'Mix', 8900], ['Kebab Lamb', 'Cheese', 9900]]);
  assert.deepEqual(seed.items.find((i) => i.name === 'FRIED CHICKEN').variants.map((v) => [v.label, v.size]), [['Suyaksiz', '450 gram'], ['Suyaksiz', '800 gram'], ['Suyakli', '1kg']]);
  // ekran sozlamalari eski saytdagidek: 8 ta/sahifa, har taom 8 s, umumiy 15 s, sahifa 5 s, kun aksiyasi o'chiq
  assert.deepEqual(seed.screens.map((s) => [s.itemsPerPage, s.spotlightSeconds, s.overviewSeconds, s.pageSeconds, s.offerEnabled, s.offerLabel]), Array(3).fill([8, 8, 15, 5, false, 'KUN AKSIYASI']));
  assert.equal(seed.setOffer.price, 3900);
  assert.equal(seed.promotion.visible, false);
  // har qanday axlat kirsa ham to'g'ri shakl qaytadi
  const junk = dm.normalizeDm({ screens: 'x', items: [null, 5, { id: 'bad id!', name: 'A' }, { id: 'ok', name: '  Lavash  ', screen: 'yo‘q', variants: [{ id: 'v', label: 'a', size: 'b', price: '12900.4' }, { id: 'v', price: 1 }] }], promotion: { imageUrl: 'javascript:alert(1)', startsAt: 'kecha' } });
  assert.equal(junk.screens.length, 1);
  assert.deepEqual(junk.items.map((i) => [i.id, i.name, i.screen, i.variants.length, i.variants[0].price]), [['ok', 'Lavash', junk.screens[0].id, 1, 12900]]);
  assert.equal(junk.promotion.imageUrl, '');
  assert.equal(junk.promotion.startsAt, '');
});

test('avval saqlangan (eski shakldagi) yozuv yo‘qolmaydi: variant TYPE/SIZE ga ajraladi, ekran sozlamalari to‘ldiriladi', () => {
  // 2026-10-05 gacha: variantda bitta yozuv, ekranda dizayn tanlovi bor edi, sahifa oralig'i va zaxira rasm yo'q edi.
  const old = {
    ...DIGITAL_MENU_SEED,
    screens: DIGITAL_MENU_SEED.screens.map((s) => ({ id: s.id, title: s.title, itemsPerPage: 10, spotlightSeconds: 8, overviewSeconds: 15, design: 'kino' })),
    items: DIGITAL_MENU_SEED.items.map((item) => ({ ...item, imageId: item.name === 'KEBAB' ? 'img-yuklangan' : '', imageUrl: item.name === 'KEBAB' ? '' : item.imageUrl, variants: item.variants.map((v) => ({ id: v.id, label: DM_LEGACY_LABELS[v.id], recipeId: v.id.endsWith('8qai7e-v1') ? 'r-kc' : '', price: v.price })) })),
  };
  old.items.find((i) => i.name === 'HOT DOG').variants[0].label = 'Oddiy';
  old.items.push({ id: 'item-yangi', name: 'Yangi taom', screen: 'kebab', variants: [{ id: 'var-1', label: 'Katta', price: 9000 }] });
  const now = dm.normalizeDm(old);
  const seed = dm.seedDm();
  const pick = (config, name) => config.items.find((i) => i.name === name);
  // o'zgartirilmagan variantlar — eski ekrandagi asl matn
  assert.deepEqual(pick(now, 'TANDIR LAVASH').variants, pick(seed, 'TANDIR LAVASH').variants);
  assert.deepEqual(pick(now, 'FRIED CHICKEN').variants, pick(seed, 'FRIED CHICKEN').variants);
  // bog'lash, yuklangan rasm va narx saqlanadi
  assert.deepEqual([pick(now, 'KEBAB').variants[0].recipeId, pick(now, 'KEBAB').imageId, pick(now, 'KEBAB').imageUrl], ['r-kc', 'img-yuklangan', '']);
  // rahbar o'zgartirgan yoki o'zi qo'shgan yozuv: SIZE ustuniga o'tadi, TYPE — taom nomi
  assert.deepEqual([pick(now, 'HOT DOG').variants[0].label, pick(now, 'HOT DOG').variants[0].size], ['HOT DOG', 'Oddiy']);
  assert.deepEqual(pick(now, 'Yangi taom').variants.map((v) => [v.label, v.size, v.price, v.active]), [['Yangi taom', 'Katta', 9000, true]]);
  // ekran: 8 tadan oshmaydi, sahifa oralig'i 5 s, zaxira rasm eski saytdagi
  assert.deepEqual(now.screens.map((s) => [s.itemsPerPage, s.pageSeconds, s.imageUrl]), seed.screens.map((s) => [8, 5, s.imageUrl]));
  assert.equal(now.screens[0].imageUrl, `${DM_OLD_ORIGIN}/images/kebab-tv.jpg`);
  assert.equal('design' in now.screens[0], false);
  // ikkinchi marta o'tkazilsa o'zgarmaydi
  assert.deepEqual(dm.normalizeDm(now), now);
});

test('KO‘RINISH ESKI SAYTDAGI BILAN AYNAN BIR XIL: CSS va har uch ekran HTML’i harfma-harf teng', () => {
  // Quyidagi belgilar 2026-10-05 da ishlab turgan eski saytdan (halo-digital-menu…chatgpt.site) olingan SHA-256:
  // sahifadagi <style> matni, #stage ichidagi HTML, <header> va <footer>. Shu test o'tsa — ekran piksel darajasida bir xil chiziladi.
  assert.equal(TV_CSS.length, 16173);
  assert.equal(sha(TV_CSS), 'dd53192bfb191b9ab25054be7ce5ebbaf82a169e5160bfa57d820bb07135398c', 'CSS eski saytdagidan farq qiladi');
  const live = {
    kebab: { stage: '99005426772d315a803382c58f62940d68c10cd8146fd6769792a87887ea9bf0', header: '194b4fdb6d50e4c47d2a6b3684e20f741d6fa06ce4c7e75998c146a8d9bc8161', fallback: '/images/kebab-tv.jpg', grid: 'cols-3 rows-2' },
    chicken: { stage: '90894c0176b143bf8cff1ab691a7562176ca874bcf88519e29bfeea0f50f2713', header: 'c024e56efe69f9fe3eaffb27b9347785034c1f54f72511d2cc61e8b95cbad262', fallback: '/images/chicken-tv.jpg', grid: 'cols-3 rows-2' },
    // pitsa: eski ma'lumotda "VEGETABLE " oxirida bo'sh joy bor edi; belgi shu bo'sh joysiz HTML'dan olingan (ekranda farqi yo'q)
    pitsa: { stage: '848700446afface50516b65066a6bbc2cdd0aedf5943e64a2f20db297d5dad3f', header: 'e0001353ac261bfc3a184bf665bc1890c44059f4c81ea3534a38998639c90b25', fallback: '/images/pitsa-upload-tv.jpg', grid: 'cols-4 rows-2' },
  };
  for (const [id, want] of Object.entries(live)) {
    const view = dm.tvView(dm.seedDm(), [], id);
    // Farq faqat manzillarda: eski saytda rasm /api/tv-image orqali, sarlavha kichik harfda ("kebab MENYU" — CSS katta harf qiladi).
    view.screen.title = id;
    assert.equal(view.screen.fallbackImage, DM_OLD_ORIGIN + want.fallback);
    view.screen.fallbackImage = want.fallback;
    for (const item of view.items) item.image = `/api/tv-image?tv=2&source=${encodeURIComponent(item.image.replace(DM_OLD_ORIGIN, ''))}`;
    view.setOffer.image = '/images/set-menu-tv.jpg?v=815cola1';
    const out = tvRender(view);
    assert.equal(sha(out.stage), want.stage, `${id}: taomlar HTML’i eski saytdagidan farq qiladi`);
    assert.ok(out.stage.startsWith(`<section class="menu-page ${want.grid} active" data-title="${id} MENYU">`));
    assert.equal(sha(`<footer class="${out.footerClass}">${out.footer}</footer>`), '680e8f1e19a5758ad1753a4b199314a07cf546944e3f697513f036488eed4d85', `${id}: SET MENU tasmasi farq qiladi`);
    const header = tvPage({ screen: id, branch: 'main' }).match(/<header>[\s\S]*?<\/header>/)[0]
      .replace('<span></span>', `<span>${out.brand.slogan}</span>`).replace('<div class="screen-name"></div>', `<div class="screen-name">${out.cfg.title}</div>`).replace('autofocus ', 'autofocus="" ');
    assert.equal(sha(header), want.header, `${id}: sarlavha farq qiladi`);
    assert.equal(out.bodyClass, 'has-set-offer');
    // vaqtlar eski skriptdagi bilan bir xil: har taom 8 s, navbat 7 qadam (eng ko'p taomli ekran — pitsa), umumiy 15 s, sahifa 5 s
    assert.deepEqual([out.cfg.motionMs, out.cfg.slots, out.cfg.overviewMs, out.cfg.pageMs], [8000, 7, 15000, 5000]);
  }
});

test('ekran ma’lumoti: bog‘langan narx menyudan, bog‘lanmagani qo‘lda; yashirin taom/variant va ichki ma’lumot chiqmaydi', () => {
  let config = dm.seedDm();
  const kebab = config.items.find((item) => item.name === 'KEBAB');
  config = dm.linkVariant(config, { itemId: kebab.id, variantId: kebab.variants[0].id, recipeId: 'r-kc' }, recipes);
  config = dm.toggleItem(config, config.items.find((i) => i.name === 'HOT DOG').id, 'visible', false);
  config = dm.toggleItem(config, config.items.find((i) => i.name === 'HAGGI').id, 'soldOut', true);
  const view = dm.tvView(config, recipes, 'kebab');
  assert.equal(view.screen.title, 'Kebab');
  assert.equal(view.items.some((i) => i.name === 'HOT DOG'), false, 'yashirin taom ekranda yo‘q');
  assert.equal(view.items.find((i) => i.name === 'HAGGI').soldOut, true);
  const shown = view.items.find((i) => i.name === 'KEBAB');
  assert.deepEqual(shown.variants.slice(0, 2), [{ label: 'Kebab', size: 'Chicken', price: 8200 }, { label: 'Kebab', size: 'Lamb', price: 8900 }]);
  assert.equal(shown.price, 8200, 'umumiy ko‘rinishdagi narx — birinchi variantniki');
  // HTML'da ham: sotildi yozuvi, yangi narx, TYPE/SIZE/PRICE qatori
  const html = tvRender(view).stage;
  assert.match(html, /<b class="badge">NEW<\/b><b class="soldout">SOTILDI<\/b>/);
  assert.match(html, /<div class="variant-row"><span>Kebab<\/span><span>Chicken<\/span><strong class="variant-price"><em>₩8,200<\/em><\/strong><\/div>/);
  assert.match(html, /<div class="price"><strong>₩8,200<\/strong><\/div>/);
  assert.equal(html.includes('HOT DOG'), false);
  // menyuda narx o'zgarsa — ekranda ham, va nusxa belgisi o'zgaradi (ekran shunga qarab yangilanadi)
  const dearer = recipes.map((r) => (r.id === 'r-kc' ? { ...r, price: 8500 } : r));
  assert.equal(dm.tvView(config, dearer, 'kebab').items.find((i) => i.name === 'KEBAB').variants[0].price, 8500);
  assert.notEqual(tvRevision(tvRender(dm.tvView(config, dearer, 'kebab'))), tvRevision(tvRender(view)));
  assert.equal(tvRevision(tvRender(dm.tvView(config, recipes, 'kebab'))), tvRevision(tvRender(view)), 'o‘zgarmagan menyu — belgi bir xil');
  // bog'langan taom menyudan olib tashlansa — oxirgi qo'lda narx ko'rinadi (ekran bo'sh qolmaydi)
  assert.equal(dm.tvView(config, recipes.filter((r) => r.id !== 'r-kc'), 'kebab').items.find((i) => i.name === 'KEBAB').variants[0].price, 7900);
  // yashirilgan variant ekranga chiqmaydi; birinchi ko'rinadigan variant narxi umumiy narx bo'ladi
  const hidden = dm.saveItem(config, { id: kebab.id, name: kebab.name, screen: 'kebab', variants: kebab.variants.map((v, i) => ({ ...v, active: i !== 0 })) }, recipes).config;
  const afterHide = dm.tvView(hidden, recipes, 'kebab').items.find((i) => i.id === kebab.id);
  assert.deepEqual([afterHide.variants.length, afterHide.variants[0].size, afterHide.price], [3, 'Lamb', 8900]);
  assert.throws(() => dm.saveItem(config, { id: kebab.id, name: kebab.name, screen: 'kebab', variants: kebab.variants.map((v) => ({ ...v, active: false })) }, recipes), /Kamida bitta variant/);
  // ochiq javobda faqat ko'rinadigan maydonlar
  assert.deepEqual(Object.keys(view).sort(), ['items', 'offer', 'restaurant', 'screen', 'screens', 'setOffer', 'slots']);
  assert.deepEqual(Object.keys(view.items[0]).sort(), ['badge', 'description', 'id', 'image', 'name', 'price', 'soldOut', 'soldOutText', 'variants']);
  assert.equal(JSON.stringify(view).includes('recipeId'), false);
  assert.equal(view.offer, null, 'o‘chiq kun aksiyasi chiqmaydi');
  assert.equal(view.slots, 7, 'navbat uzunligi — eng ko‘p taomli ekran (pitsa: 7)');
  assert.equal(dm.tvView(config, recipes, 'yo-q').screen.id, 'kebab', 'noma’lum ekran — birinchisi');
  // uzilganda ekrandagi narx o'zgarmaydi
  const cut = dm.linkVariant(config, { itemId: kebab.id, variantId: kebab.variants[0].id, recipeId: '' }, recipes);
  assert.deepEqual([cut.items.find((i) => i.id === kebab.id).variants[0].recipeId, cut.items.find((i) => i.id === kebab.id).variants[0].price], ['', 8200]);
});

test('sahifalar va to‘r: 8 tadan ortiq taom keyingi sahifaga; kun aksiyasi; SET o‘chiq bo‘lsa oddiy pastki qator; matn HTML’ni buzmaydi', () => {
  let config = dm.seedDm();
  for (let n = 1; n <= 5; n += 1) config = dm.saveItem(config, { name: `Qo‘shimcha <${n}>`, screen: 'kebab', variants: [{ label: 'A&B', size: '"x"', price: 1000 * n }] }, recipes).config;
  const view = dm.tvView(config, recipes, 'kebab');
  assert.equal(view.items.length, 11);
  assert.equal(view.slots, 11);
  const out = tvRender(view);
  const pages = out.stage.match(/<section class="menu-page[^>]*>/g);
  assert.deepEqual(pages, ['<section class="menu-page cols-4 rows-2 active" data-title="Kebab MENYU">', '<section class="menu-page cols-2 rows-2" data-title="Kebab MENYU">']);
  // ikkinchi sahifa rasmlari keyin yuklanadi (data-src); rasmi yo'q taomda zaxira rasm
  const second = out.stage.slice(out.stage.indexOf(pages[1]));
  assert.equal(/<img src=/.test(second), false);
  assert.match(second, /<img data-src="https:\/\/halo-digital-menu[^"]+\/images\/kebab-tv\.jpg" alt="" decoding="async">/);
  assert.match(second, /<h2>Qo‘shimcha &lt;3&gt;<\/h2>/);
  assert.match(second, /<span>A&amp;B<\/span><span>"x"<\/span>/);
  assert.equal(/<(?!\/?(section|article|div|img|b|h2|p|span|strong|em)\b)/.test(out.stage), false, 'kutilmagan teg yo‘q');
  // to'r: 1 → 1×1, 2 → 2×1, 3–4 → 2×2, 5–6 → 3×2, 7–8 → 4×2
  const shape = (count) => tvRender({ ...view, items: view.items.slice(0, count) }).stage.match(/cols-\d rows-\d/)[0];
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(shape), ['cols-1 rows-1', 'cols-2 rows-1', 'cols-2 rows-2', 'cols-2 rows-2', 'cols-3 rows-2', 'cols-3 rows-2', 'cols-4 rows-2', 'cols-4 rows-2']);
  assert.match(tvRender({ ...view, items: [] }).stage, /^<div class="empty">/);
  // kun aksiyasi
  const haggi = config.items.find((i) => i.name === 'HAGGI');
  assert.throws(() => dm.saveScreen(config, { id: 'kebab', title: 'Kebab', offerEnabled: true }), /taomni tanlang/);
  assert.throws(() => dm.saveScreen(config, { id: 'kebab', title: 'Kebab', offerEnabled: true, offerItemId: haggi.id, offerIntervalSeconds: 10, offerDurationSeconds: 10 }), /qisqa/);
  const withOffer = dm.saveScreen(config, { id: 'kebab', title: 'Kebab', offerEnabled: true, offerItemId: haggi.id }).config;
  const offered = tvRender(dm.tvView(withOffer, recipes, 'kebab'));
  assert.match(offered.stage, /<section id="daily-offer" class="daily-offer-page"><div class="combo-card"><div class="combo-photo"><img src="[^"]+"[^>]*><b>KUN AKSIYASI<\/b><\/div><div class="combo-copy"><h2>HAGGI<\/h2>/);
  assert.deepEqual([offered.cfg.offerLabel, offered.cfg.offerIntervalMs, offered.cfg.offerDurationMs], ['KUN AKSIYASI', 30000, 10000]);
  assert.equal(tvRender(dm.tvView(withOffer, recipes, 'chicken')).stage.includes('daily-offer'), false, 'boshqa ekranda chiqmaydi');
  assert.equal(tvRender(dm.tvView(dm.toggleItem(withOffer, haggi.id, 'visible', false), recipes, 'kebab')).stage.includes('daily-offer'), false, 'yashirin taom aksiyada chiqmaydi');
  // SET MENU o'chiq
  const plain = tvRender(dm.tvView(dm.saveSettings(config, { setOffer: { visible: false } }), recipes, 'kebab'));
  assert.deepEqual([plain.bodyClass, plain.footerClass], ['', '']);
  assert.equal(plain.footer, '<span>Har kuni · 11:00—11:00</span><strong>HALOL · YANGI · MAZALI</strong><span>010-2133-4994</span>');
});

test('bog‘lash taklifi: faqat taom nomi, TYPE va SIZE dagi hamma so‘z mos kelganda; noaniq bo‘lsa taklif yo‘q', () => {
  assert.equal(dm.suggestRecipe('KEBAB', 'Kebab', 'Chicken', recipes, 4), 'r-kc');
  assert.equal(dm.suggestRecipe('KEBAB', 'Kebab', 'Mix', recipes, 4), '', 'menyuda yo‘q');
  assert.equal(dm.suggestRecipe('KEBAB', 'Kebab Lamb', 'Cheese', recipes, 4), '', '«Kebab lamb» — cheese emas, boshqa taom');
  assert.equal(dm.suggestRecipe('HAGGI', 'Haggi', 'Chicken', recipes, 3), '', '«Kebab chicken» boshqa taomga taklif qilinmaydi');
  assert.equal(dm.suggestRecipe('HUNTER’S PIZZA', 'Hunter’s pizza', 'Medium', recipes, 1), 'r-hunter', 'bitta variantli taom — o‘lchamsiz, nomi bo‘yicha');
  assert.equal(dm.suggestRecipe('KEBAB', '', '', recipes, 1), '', 'ikkita taomga teng mos — taklif berilmaydi');
  assert.equal(dm.suggestRecipe('CHEESE', 'Cheese', 'Medium', recipes, 1), 'r-cheese', '«Cheese pizza» — bitta ortiqcha so‘z; «Cheese pizza small» uzoqroq');
  assert.equal(dm.suggestRecipe('CHEESE', 'Cheese', 'Medium', recipes.filter((r) => r.id !== 'r-cheese'), 1), '', 'ikki va undan ko‘p ortiqcha so‘zli nom taklif qilinmaydi');
  // tovuq: taom nomi ham mos kelishi shart; "450 gram" va "450g" bir xil
  assert.equal(dm.suggestRecipe('FRIED CHICKEN', 'Suyaksiz', '450 gram', recipes, 3), 'r-fried');
  assert.equal(dm.suggestRecipe('SWEET CHILI', 'Suyaksiz', '450 gram', recipes, 3), 'r-sweet');
  assert.equal(dm.suggestRecipe('SNOW', 'suyaksiz', '450 gram', recipes, 3), '', 'menyuda yo‘q — boshqa taomga bog‘lanmaydi');
  // menyuda faqat bitta "suyaksiz 450g" bo'lsa ham, u boshqa taomlarga taklif qilinmaydi (noto'g'ri narx chiqib ketmasin)
  const onlyFried = recipes.filter((r) => r.id !== 'r-sweet');
  assert.equal(dm.suggestRecipe('SWEET CHILI', 'Suyaksiz', '450 gram', onlyFried, 3), '');
  assert.equal(dm.suggestRecipe('SPICY', 'Suyaksiz', '450 gram', onlyFried, 3), '');
  const all = dm.adminView(dm.seedDm(), onlyFried).items.flatMap((i) => i.variants.filter((v) => v.suggestion).map((v) => `${i.name}/${v.label}/${v.size}→${v.suggestion}`));
  assert.deepEqual(all, ['CHEESE/Cheese/Medium→r-cheese', 'HUNTER’S PIZZA/Hunter’s pizza/Medium→r-hunter', 'KEBAB/Kebab/Chicken→r-kc', 'KEBAB/Kebab/Lamb→r-kl', 'FRIED CHICKEN/Suyaksiz/450 gram→r-fried']);
  // allaqachon bog'langan taom boshqa qatorga taklif qilinmaydi
  const kb = dm.seedDm().items.find((i) => i.name === 'KEBAB');
  const used = dm.linkVariant(dm.seedDm(), { itemId: kb.id, variantId: kb.variants[2].id, recipeId: 'r-kc' }, recipes);
  assert.equal(dm.adminView(used, recipes).items.find((i) => i.id === kb.id).variants[0].suggestion, '');
  const view = dm.adminView(dm.seedDm(), recipes);
  assert.equal(view.unlinked, 42);
  assert.equal(view.items.find((i) => i.name === 'KEBAB').variants[0].suggestion, 'r-kc');
  // bir yo'la bog'lash: hammasi yoki hech biri
  const kebab = dm.seedDm().items.find((i) => i.name === 'KEBAB');
  const links = [{ itemId: kebab.id, variantId: kebab.variants[0].id, recipeId: 'r-kc' }, { itemId: kebab.id, variantId: kebab.variants[1].id, recipeId: 'r-kl' }];
  const many = dm.linkMany(dm.seedDm(), { links }, recipes);
  assert.deepEqual(many.items.find((i) => i.id === kebab.id).variants.map((v) => v.recipeId), ['r-kc', 'r-kl', '', '']);
  assert.equal(dm.adminView(many, recipes).unlinked, 40);
  assert.throws(() => dm.linkMany(dm.seedDm(), { links: [links[0], { ...links[1], recipeId: 'yo-q' }] }, recipes), /topilmadi/);
  assert.throws(() => dm.linkMany(dm.seedDm(), { links: [] }, recipes), /tanlanmagan/);
});

test('taom saqlash: tekshiruvlar, rasm, tartib, ekranlar, sozlamalar', () => {
  const seed = dm.seedDm();
  const v = [{ label: '', size: '', price: 12000 }];
  assert.throws(() => dm.saveItem(seed, { name: 'A', screen: 'kebab', variants: v }, recipes), /nomini/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'yo-q', variants: v }, recipes), /ekranda/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'kebab', variants: [] }, recipes), /bitta narx/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'kebab', variants: [{ label: '', price: 0 }] }, recipes), /narxini/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'kebab', variants: [{ label: 'a', price: 1 }, { label: '', size: '', price: 2 }] }, recipes), /2-variant/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'kebab', variants: [{ label: '', recipeId: 'yo‘q' }] }, recipes), /menyuda topilmadi/);
  assert.throws(() => dm.saveItem(seed, { id: 'yo-q', name: 'Yangi', screen: 'kebab', variants: v }, recipes), /topilmadi/);
  const made = dm.saveItem(seed, { name: '  Yangi   taom ', screen: 'pitsa', badge: 'HIT', variants: [{ label: 'Yangi', size: 'Medium', recipeId: 'r-cheese' }] }, recipes);
  assert.equal(made.created, true);
  const item = made.config.items.at(-1);
  assert.deepEqual([item.name, item.screen, item.badge, item.variants[0].recipeId, item.variants[0].size, item.visible], ['Yangi taom', 'pitsa', 'HIT', 'r-cheese', 'Medium', true]);
  // rasm: yuborilmasa o'zgarmaydi; yangi rasm eski manzilni almashtiradi; bo'sh — olib tashlaydi
  const kebab = seed.items.find((i) => i.name === 'KEBAB');
  const body = { id: kebab.id, name: kebab.name, screen: 'kebab', variants: kebab.variants };
  assert.equal(dm.saveItem(seed, body, recipes).config.items.find((i) => i.id === kebab.id).imageUrl, kebab.imageUrl);
  const withPic = dm.saveItem(seed, { ...body, imageId: 'img-abc' }, recipes).config.items.find((i) => i.id === kebab.id);
  assert.deepEqual([withPic.imageId, withPic.imageUrl], ['img-abc', '']);
  const noPic = dm.saveItem(seed, { ...body, imageId: '' }, recipes).config.items.find((i) => i.id === kebab.id);
  assert.deepEqual([noPic.imageId, noPic.imageUrl], ['', '']);
  // tartib faqat o'z ekrani ichida
  const names = (config) => config.items.filter((i) => i.screen === 'kebab').map((i) => i.name);
  const moved = dm.moveItem(seed, kebab.id, -1);
  assert.deepEqual(names(moved).slice(0, 4), ['TANDIR LAVASH', 'HALO LAVASH', 'KEBAB', 'HAGGI']);
  assert.deepEqual(moved.items.filter((i) => i.screen !== 'kebab'), seed.items.filter((i) => i.screen !== 'kebab'));
  assert.equal(dm.moveItem(seed, seed.items.find((i) => i.name === 'TANDIR LAVASH').id, -1), seed, 'birinchisi yuqoriga chiqmaydi');
  // ekranlar
  assert.throws(() => dm.deleteScreen(seed, 'kebab'), /6 ta taom/);
  const combo = dm.saveScreen(seed, { title: 'Combo' });
  assert.equal(combo.id, 'combo');
  assert.deepEqual([combo.config.screens.at(-1).itemsPerPage, combo.config.screens.at(-1).spotlightSeconds, combo.config.screens.at(-1).pageSeconds, combo.config.screens.at(-1).offerEnabled], [8, 8, 5, false]);
  assert.throws(() => dm.saveScreen(combo.config, { title: 'Combo' }), /bor/);
  assert.equal(dm.deleteScreen(combo.config, 'combo').screens.length, 3);
  // faqat yuborilgan sozlama o'zgaradi; chegaralar: 1–8 taom, 0 soniya = faqat umumiy ko'rinish
  const edited = dm.saveScreen(seed, { id: 'kebab', title: 'Kebablar', itemsPerPage: 99, spotlightSeconds: 0 }).config.screens[0];
  assert.deepEqual([edited.title, edited.itemsPerPage, edited.spotlightSeconds, edited.overviewSeconds, edited.pageSeconds, edited.imageUrl], ['Kebablar', 8, 0, 15, 5, seed.screens[0].imageUrl]);
  assert.equal(tvRender(dm.tvView({ ...seed, screens: [edited, ...seed.screens.slice(1)] }, recipes, 'kebab')).cfg.motionMs, 0);
  // zaxira rasm: yangi rasm eski manzilni almashtiradi; bo'sh — olib tashlaydi
  const backup = dm.saveScreen(seed, { id: 'kebab', title: 'Kebab', imageId: 'img-zaxira' }).config.screens[0];
  assert.deepEqual([backup.imageId, backup.imageUrl], ['img-zaxira', '']);
  assert.deepEqual(Object.keys(dm.tvView(seed, recipes, 'kebab').screen).sort(), ['fallbackImage', 'id', 'itemsPerPage', 'overviewSeconds', 'pageSeconds', 'spotlightSeconds', 'title']);
  // sozlamalar: faqat yuborilgan qism o'zgaradi
  const set = dm.saveSettings(seed, { restaurant: { hours: 'Har kuni 11—02' }, setOffer: { price: 4500, imageId: 'img-set' } });
  assert.deepEqual([set.restaurant.hours, set.restaurant.phone, set.setOffer.price, set.setOffer.imageId, set.setOffer.imageUrl, set.promotion.visible], ['Har kuni 11—02', seed.restaurant.phone, 4500, 'img-set', '', false]);
  assert.deepEqual(set.items, seed.items);
  assert.deepEqual([set.promotion, set.thanks], [seed.promotion, seed.thanks], 'televizorda ko‘rinmaydigan eski ma’lumot ham saqlanadi');
  assert.equal(dm.deleteItem(seed, kebab.id).items.length, 17);
});

test('ekran sahifasi: eski televizor brauzeriga mos skript, tashqi saytga bog‘liq emas, parol/kalit yo‘q', () => {
  const html = tvPage({ screen: 'kebab', branch: 'main' });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /var CFG=\{"api":"\/api\/v2\/tv","screen":"kebab","b":"main","v":"tv-3"\}/);
  // eski brauzerlar tushunmaydigan yozuvlar yo'q
  assert.equal(/=>|\blet\s|\bconst\s|`|\bfetch\(|\basync\b|\bawait\b|\?\.|\?\?/.test(script), false, 'skript ES5 bo‘lishi kerak');
  assert.equal(script.includes('\\'), false);
  assert.equal(/https?:\/\//.test(html), false, 'tashqi sayt (shrift, skript) chaqirilmaydi');
  assert.equal(/password|token|secret|api[_-]?key|halo_api/i.test(html), false);
  // faqat o'qiydi: bitta GET so'rov, yozadigan so'rov yo'q
  assert.deepEqual(script.match(/request\.open\('[A-Z]+'/g), ["request.open('GET'"]);
  assert.equal(html.includes('<style>' + TV_CSS + '</style>'), true, 'sahifada eski CSS o‘zgarishsiz');
  assert.equal(tvPage({ screen: '</script><b>', branch: 'main' }).includes('</script><b>'), false, 'manzildagi matn sahifani buzmaydi');
});

test('sayqallangan variant (&look=premium): o‘sha ko‘rinish ustiga kichik qatlam; asl ko‘rinishga tegmaydi', () => {
  // faqat aniq "premium" so'ralganda ishlaydi; boshqa har qanday qiymat — asl ko'rinish
  assert.deepEqual([tvLook('premium'), tvLook('yangi'), tvLook(''), tvLook(null), tvLook('PREMIUM')], ['premium', '', '', '', '']);
  const view = (id) => dm.tvView(dm.seedDm(), [], id);
  assert.equal(tvRender(view('kebab'), 'boshqa').stage, tvRender(view('kebab')).stage);
  // sahifa: asl CSS o'zgarishsiz turadi, ustidan qo'shimcha qatlam; asl sahifada qatlam yo'q
  const page = tvPage({ screen: 'kebab', branch: 'main', look: 'premium' });
  assert.equal(page.includes('<style>' + TV_CSS + '</style><style>' + TV_CSS_SAYQAL + '</style>'), true);
  assert.equal(tvPage({ screen: 'kebab', branch: 'main' }).includes('halo-soft'), false);
  assert.equal(tvPage({ screen: 'kebab', branch: 'main', look: 'yangi' }), tvPage({ screen: 'kebab', branch: 'main' }));
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /var CFG=\{"api":"\/api\/v2\/tv","screen":"kebab","b":"main","v":"tv-3","look":"premium"\}/);
  assert.equal(/https?:\/\/|@font-face|@import|url\(/.test(page), false, 'tashqi sayt yoki shrift yuklanmaydi');
  assert.equal(TV_CSS_SAYQAL.includes('\\'), false);
  assert.equal((TV_CSS_SAYQAL.match(/{/g) || []).length, (TV_CSS_SAYQAL.match(/}/g) || []).length);
  // ranglar o'sha: qatlamda faqat asl CSS'da bor ranglar ishlatiladi
  for (const color of TV_CSS_SAYQAL.match(/#[0-9a-f]{3,6}/gi) || []) assert.equal(TV_CSS.includes(color), true, `yangi rang qo‘shilgan: ${color}`);
  // tuzilish o'sha: kartalar, rasm, TYPE/SIZE/PRICE jadvali; vaqtlar bir xil
  const asl = tvRender(view('kebab'));
  const out = tvRender(view('kebab'), 'premium');
  assert.deepEqual(out.cfg, asl.cfg);
  assert.deepEqual([out.bodyClass, out.footerClass, out.footer, out.title], [asl.bodyClass, asl.footerClass, asl.footer, asl.title]);
  const tags = (html) => html.replace(/<div class="price[^>]*>[\s\S]*?<\/div>\n/g, '').replace(/>[^<]*</g, '><').replace(' many', '');
  assert.equal(tags(out.stage), tags(asl.stage), 'narx blokidan tashqari HTML tuzilishi bir xil');
  // 1) umumiy ko'rinishda hamma narx
  assert.match(out.stage, /^<section class="menu-page cols-3 rows-2 many active"/);
  assert.match(out.stage, /<h2>KEBAB<\/h2>[\s\S]*?<div class="price list"><div class="mini"><span>Chicken<\/span><b>₩7,900<\/b><\/div><div class="mini"><span>Lamb<\/span><b>₩8,900<\/b><\/div><div class="mini"><span>Mix<\/span><b>₩8,900<\/b><\/div><div class="mini"><span>Cheese<\/span><b>₩9,900<\/b><\/div><\/div>/);
  assert.equal((out.stage.match(/class="mini"/g) || []).length, 21, 'kebab ekranidagi 21 ta narxning hammasi');
  assert.match(tvRender(view('chicken'), 'premium').stage, /<div class="mini"><span>450 gram<\/span><b>₩11,900<\/b><\/div><div class="mini"><span>800 gram<\/span><b>₩19,900<\/b><\/div><div class="mini"><span>1kg<\/span><b>₩19,900<\/b><\/div>/);
  // bitta narxli taomlar (pitsa): asl ko'rinishdagidek bitta katta narx
  const pitsa = tvRender(view('pitsa'), 'premium').stage;
  assert.match(pitsa, /^<section class="menu-page cols-4 rows-2 active"/);
  assert.equal(pitsa.includes('class="mini"'), false);
  assert.match(pitsa, /<div class="price"><strong>₩11,900<\/strong><\/div>/);
  // 2) jadvalda harflar bir xil; ma'lumotning o'zi o'zgarmaydi
  assert.match(out.stage, /<div class="variant-row"><span>Halo lavash<\/span><span>Chicken<\/span>/);
  assert.match(out.stage, /<div class="variant-row"><span>Tandir lavash chicken<\/span><span>Cheese<\/span>/);
  assert.match(asl.stage, /<div class="variant-row"><span>HALO LAVASH<\/span><span>CHICKEN<\/span>/);
  // 3) namuna tavsif ko'rsatilmaydi (asl ko'rinishda — eski saytdagidek turadi)
  assert.equal(asl.stage.includes('Taom haqida qisqa ma’lumot'), true);
  assert.equal(out.stage.includes('Taom haqida qisqa ma’lumot'), false);
  assert.match(out.stage, /<h2>HALO LAVASH<\/h2><p>Meat · Cabbage · Tomato · Cucumber · Sauce · Spices<\/p>/);
  // 5 va undan ko'p narx sig'maydi — birinchi narx va "~" belgisi
  let big = dm.seedDm();
  const kebab = big.items.find((i) => i.name === 'KEBAB');
  big = dm.saveItem(big, { id: kebab.id, name: kebab.name, screen: 'kebab', variants: [...kebab.variants, { label: 'Kebab', size: 'Big', price: 15000 }] }, recipes).config;
  assert.match(tvRender(dm.tvView(big, [], 'kebab'), 'premium').stage, /<h2>KEBAB<\/h2>[\s\S]*?<div class="price"><strong class="from">₩7,900<\/strong><\/div>/);
});

/* ---------- sayt orqali ---------- */
function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; },
    _exec: () => sqlite.prepare(query).run(...params),
  });
  return { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
}
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const monitor = (body, headers = owner) => monitorRoute.POST(new Request('https://halo.example.workers.dev/api/v2/monitor', { method: 'POST', headers, body: JSON.stringify({ branchId: 'main', ...body }) }));
const tv = (query) => tvRoute.GET(new Request(`https://halo.example.workers.dev/api/v2/tv${query}`));
const business = () => sqlite.prepare("SELECT payload, updated_at FROM app_state WHERE id = 'main'").get();
// 1×1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg' + 'A'.repeat(200) + '==';

test('sayt: boshqaruv faqat rahbarga; ekran parolsiz va faqat o‘qiydi; narx menyudan; biznes ma’lumoti o‘zgarmaydi', async () => {
  assert.equal((await monitorRoute.GET(new Request('https://halo.example.workers.dev/api/v2/monitor'))).status, 303);
  assert.equal((await monitor({ action: 'load' }, { 'content-type': 'application/json' })).status, 401);
  const page = await (await monitorRoute.GET(new Request('https://halo.example.workers.dev/api/v2/monitor', { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.equal(tvRoute.POST, undefined, 'ekran manzilida yozadigan amal yo‘q');

  const first = await (await monitor({ action: 'load' })).json();
  assert.equal(first.ok, true, JSON.stringify(first).slice(0, 300));
  assert.deepEqual([first.saved, first.menu.items.length, first.menu.imports.length], [false, 18, 18 + 1 + 3 + 1]);
  const state = JSON.parse(business().payload);
  state.recipes = [{ id: 'kc', name: 'Kebab chicken', salePrice: 8200, ingredients: [] }, { id: 'old', name: 'Eski taom', salePrice: 5000, archived: true, ingredients: [] }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(state));
  const before = business();

  // ekran: parolsiz sahifa (bazasiz ochiladi), menyu alohida so'raladi va keshlanmaydi
  const html = await tv('?screen=kebab');
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('cache-control'), 'no-store');
  assert.match(await html.text(), /<main id="stage"><\/main>/);
  dm.tvMemoClear();
  const res = await tv('?data=1&screen=kebab');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const data = await res.json();
  assert.deepEqual([data.ok, data.v, typeof data.serverTime, data.bodyClass, data.footerClass, data.cfg.slots], [true, TV_VERSION, 'number', 'has-set-offer', 'set-strip', 7]);
  assert.match(data.stage, /<h2>KEBAB<\/h2>.*<span>Kebab<\/span><span>Chicken<\/span><strong class="variant-price"><em>₩7,900<\/em>/);
  // ekrandagi nusxa hozirgisi bilan bir xil — menyu qayta yuborilmaydi (ekran qayta chizmaydi)
  const same = await (await tv(`?data=1&screen=kebab&rev=${data.revision}`)).json();
  assert.deepEqual(Object.keys(same).sort(), ['ok', 'revision', 'serverTime', 'v']);
  assert.equal(same.revision, data.revision);
  // oddiy JSON ko'rinishidagi menyu (o'qish uchun API); filial "branch" yoki "b" bilan
  const menu = await (await tv('?menu=1&screen=kebab&branch=main')).json();
  assert.deepEqual([menu.ok, menu.revision, menu.items.length, menu.items[3].name, menu.items[3].variants[0].price], [true, data.revision, 6, 'KEBAB', 7900]);
  assert.equal(JSON.stringify(menu).includes('recipeId'), false);
  assert.equal((await tv('?data=1&screen=kebab&b=yoq-filial')).status, 404);
  // sayqallangan variant alohida so'raladi; asl javob o'zgarmaydi
  const plus = await (await tv('?data=1&screen=kebab&look=premium')).json();
  assert.notEqual(plus.revision, data.revision);
  assert.match(plus.stage, /class="menu-page cols-3 rows-2 many active"/);
  assert.equal((await (await tv('?data=1&screen=kebab')).json()).revision, data.revision);
  assert.equal((await (await tv('?data=1&screen=kebab&look=nimadir')).json()).revision, data.revision);
  assert.match(await (await tv('?screen=kebab&look=premium')).text(), /"look":"premium"/);

  // rahbar: bog'lash, rasm, sotildi
  const loaded = await (await monitor({ action: 'load' })).json();
  assert.deepEqual(loaded.recipes.map((r) => r.id), ['kc'], 'arxivdagi taom taklif qilinmaydi');
  const kebab = loaded.menu.items.find((i) => i.name === 'KEBAB');
  assert.equal(kebab.variants[0].suggestion, 'kc');
  const linked = await (await monitor({ action: 'linkMany', links: [{ itemId: kebab.id, variantId: kebab.variants[0].id, recipeId: 'kc' }] })).json();
  assert.equal(linked.menu.items.find((i) => i.id === kebab.id).variants[0].shownPrice, 8200);
  assert.equal((await monitor({ action: 'upload', mime: 'image/svg+xml', data: PNG })).status, 400);
  assert.equal((await monitor({ action: 'upload', mime: 'image/png', data: 'bu base64 emas!' })).status, 400);
  const up = await (await monitor({ action: 'upload', mime: 'image/png', data: PNG })).json();
  assert.equal(up.ok, true, JSON.stringify(up));
  const saved = await (await monitor({ action: 'saveItem', id: kebab.id, name: kebab.name, screen: 'kebab', badge: kebab.badge, description: 'Meat · Sauce', imageId: up.imageId, variants: kebab.variants.map((v, i) => ({ id: v.id, label: v.label, size: v.size, recipeId: i === 0 ? 'kc' : '', price: v.price })) })).json();
  assert.equal(saved.ok, true, JSON.stringify(saved).slice(0, 300));
  const media = await tv(`?media=${up.imageId}`);
  assert.deepEqual([media.status, media.headers.get('content-type'), /immutable/.test(media.headers.get('cache-control'))], [200, 'image/png', true]);
  assert.equal((await media.arrayBuffer()).byteLength > 60, true);
  assert.equal((await tv('?media=img-yoq')).status, 404);
  await monitor({ action: 'toggle', id: kebab.id, field: 'soldOut', value: true });
  assert.equal((await monitor({ action: 'nimadir' })).status, 400);

  // ekranda darhol ko'rinadi (xotiradagi nusxa tozalanadi) va nusxa belgisi o'zgaradi
  const after = await (await tv(`?data=1&screen=kebab&rev=${data.revision}`)).json();
  assert.notEqual(after.revision, data.revision);
  assert.match(after.stage, new RegExp(`<img src="/api/v2/tv\\?media=${up.imageId}" onerror="[^"]+" alt="" decoding="async"><b class="badge">NEW</b><b class="soldout">SOTILDI</b>`));
  assert.match(after.stage, /<h2>KEBAB<\/h2><p>Meat · Sauce<\/p>.*?<span>Kebab<\/span><span>Chicken<\/span><strong class="variant-price"><em>₩8,200<\/em>/);

  // ZANJIR: HALO Control menyusida narx o'zgaradi → API javobi o'zgaradi → ekran yangi narxni oladi → asl narx qaytariladi
  const next = JSON.parse(business().payload);
  next.recipes[0].salePrice = 8700;
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(next));
  dm.tvMemoClear();
  const changed = await (await tv(`?data=1&screen=kebab&rev=${after.revision}`)).json();
  assert.notEqual(changed.revision, after.revision);
  assert.match(changed.stage, /<span>Kebab<\/span><span>Chicken<\/span><strong class="variant-price"><em>₩8,700<\/em>/);
  assert.match(changed.stage, /<h2>KEBAB<\/h2>[\s\S]*?<div class="price"><strong>₩8,700<\/strong><\/div>/);
  assert.equal((await (await tv('?menu=1&screen=kebab')).json()).items.find((i) => i.id === kebab.id).variants[0].price, 8700);
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(before.payload);
  dm.tvMemoClear();
  assert.equal((await (await tv(`?data=1&screen=kebab&rev=${changed.revision}`)).json()).revision, after.revision, 'asl narx qaytdi — ekran avvalgi holatiga qaytadi');

  // monitor menyusi biznes ma'lumotiga (savdo, ombor, kassa, retsept) hech narsa yozmagan
  assert.equal(business().payload, before.payload);
  assert.equal(business().updated_at, before.updated_at);

  // ishlatilmayotgan eski rasm tozalanadi, yangi yuklangani qoladi
  const orphan = await (await monitor({ action: 'upload', mime: 'image/png', data: PNG })).json();
  sqlite.prepare("UPDATE v2_digital_menu_media SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(orphan.imageId);
  const fresh = await (await monitor({ action: 'upload', mime: 'image/png', data: PNG })).json();
  await monitor({ action: 'toggle', id: kebab.id, field: 'soldOut', value: false });
  const left = sqlite.prepare('SELECT id FROM v2_digital_menu_media').all().map((r) => r.id).sort();
  assert.deepEqual(left, [up.imageId, fresh.imageId].sort());
});

test('rasmlarni eski saytdan ko‘chirish: o‘zgarishsiz saqlanadi, faqat eski saytdagi menyu rasmlari o‘qiladi, eski saytga yozilmaydi', async () => {
  const jpeg = new Uint8Array(40_000).map((_, index) => (index * 31 + 7) % 256);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push([String(url), init.method || 'GET']);
    if (String(url).endsWith('/images/chicken-tv.jpg')) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
    if (String(url).includes('2512c422')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const start = await (await monitor({ action: 'load' })).json();
    const targets = start.menu.imports;
    // KEBAB rasmi oldingi testda qo'lda yuklangan — ro'yxatda yo'q
    assert.equal(targets.some((t) => t.name === 'KEBAB'), false);
    assert.equal(targets.length, 22);
    assert.equal(JSON.stringify(targets).includes('http'), false, 'manzil mijozga berilmaydi va mijozdan olinmaydi');
    const tandir = targets.find((t) => t.name === 'TANDIR LAVASH');
    const done = await (await monitor({ action: 'importImage', kind: tandir.kind, id: tandir.id, url: 'https://yomon.example/x.jpg' })).json();
    assert.equal(done.ok, true, JSON.stringify(done).slice(0, 300));
    assert.deepEqual(calls.at(-1), [`${DM_OLD_ORIGIN}/api/media?key=menu%2F35091ba0-4ee6-46c0-b492-b113aa81338b.jpg`, 'GET']);
    const item = done.menu.items.find((i) => i.id === tandir.id);
    assert.match(item.imageId, /^img-/);
    assert.equal(item.imageUrl, '');
    assert.equal(done.menu.imports.length, 21);
    // bayt-ma-bayt bir xil (qayta siqilmagan)
    const stored = new Uint8Array(await (await tv(`?media=${item.imageId}`)).arrayBuffer());
    assert.deepEqual([stored.length, Buffer.from(stored).equals(Buffer.from(jpeg))], [40_000, true]);
    assert.match((await (await tv('?data=1&screen=kebab')).json()).stage, new RegExp(`<img src="/api/v2/tv\\?media=${item.imageId}"`));
    // ikkinchi marta ko'chirilmaydi; eski sayt xato bersa yoki rasm o'rniga boshqa narsa kelsa — menyu o'zgarmaydi
    assert.equal((await monitor({ action: 'importImage', kind: tandir.kind, id: tandir.id })).status, 404);
    assert.equal((await monitor({ action: 'importImage', kind: 'screen', id: 'chicken' })).status, 502);
    const fried = targets.find((t) => t.name === 'FRIED CHICKEN');
    assert.equal((await monitor({ action: 'importImage', kind: fried.kind, id: fried.id })).status, 502);
    assert.equal((await (await monitor({ action: 'load' })).json()).menu.imports.length, 21);
    // SET MENU va zaxira rasm ham ko'chadi
    const set = await (await monitor({ action: 'importImage', kind: 'set', id: 'set' })).json();
    assert.match(set.menu.setOffer.imageId, /^img-/);
    const scr = await (await monitor({ action: 'importImage', kind: 'screen', id: 'kebab' })).json();
    assert.match(scr.menu.screens[0].imageId, /^img-/);
    assert.match((await (await tv('?data=1&screen=kebab')).json()).footer, new RegExp(`<img class="set-photo" src="/api/v2/tv\\?media=${set.menu.setOffer.imageId}"`));
    // ko'chirilgan rasmlar tozalashda o'chib ketmaydi
    sqlite.prepare("UPDATE v2_digital_menu_media SET created_at = '2020-01-01T00:00:00.000Z'").run();
    await monitor({ action: 'toggle', id: tandir.id, field: 'soldOut', value: false });
    const kept = new Set(sqlite.prepare('SELECT id FROM v2_digital_menu_media').all().map((r) => r.id));
    assert.equal([item.imageId, set.menu.setOffer.imageId, scr.menu.screens[0].imageId].every((id) => kept.has(id)), true);
    // faqat eski saytning menyu rasmlari o'qilgan, faqat GET
    assert.equal(calls.every(([url, method]) => url.startsWith(`${DM_OLD_ORIGIN}/`) && method === 'GET'), true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
