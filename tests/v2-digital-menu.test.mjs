import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const dm = await import('../app/core/digital-menu.ts');
const { tvPage, TV_VERSION } = await import('../app/core/tv-page.ts');
const tvRoute = await import('../app/api/v2/tv/route.ts');
const monitorRoute = await import('../app/api/v2/monitor/route.ts');

const recipes = [
  { id: 'r-kc', name: 'Kebab chicken', price: 8200, categoryId: 'recipe-kebab' },
  { id: 'r-kl', name: 'Kebab lamb', price: 9100, categoryId: 'recipe-kebab' },
  { id: 'r-cheese', name: 'Cheese pizza', price: 12500, categoryId: 'recipe-pizza' },
  { id: 'r-cheese2', name: 'Cheese pizza small', price: 9900, categoryId: 'recipe-pizza' },
  { id: 'r-hunter', name: 'Hunter’s pizza', price: 14900, categoryId: 'recipe-pizza' },
];

test('boshlang‘ich menyu: 18 taom, 3 ekran, hamma variant narxli; buzuq ma’lumot xato bermaydi', () => {
  const seed = dm.seedDm();
  assert.equal(seed.items.length, 18);
  assert.deepEqual(seed.screens.map((s) => s.id), ['kebab', 'chicken', 'pitsa']);
  assert.deepEqual(['kebab', 'chicken', 'pitsa'].map((id) => seed.items.filter((i) => i.screen === id).length), [6, 5, 7]);
  assert.ok(seed.items.every((item) => item.variants.length >= 1 && item.variants.every((v) => v.price > 0 && !v.recipeId)));
  const kebab = seed.items.find((item) => item.name === 'KEBAB');
  assert.deepEqual(kebab.variants.map((v) => [v.label, v.price]), [['Chicken', 7900], ['Lamb', 8900], ['Mix', 8900], ['Lamb cheese', 9900]]);
  assert.equal(seed.setOffer.price, 3900);
  assert.equal(seed.promotion.visible, false);
  // har qanday axlat kirsa ham to'g'ri shakl qaytadi
  const junk = dm.normalizeDm({ screens: 'x', items: [null, 5, { id: 'bad id!', name: 'A' }, { id: 'ok', name: '  Lavash  ', screen: 'yo‘q', variants: [{ id: 'v', label: 'a', price: '12900.4' }, { id: 'v', price: 1 }] }], promotion: { imageUrl: 'javascript:alert(1)', startsAt: 'kecha' } });
  assert.equal(junk.screens.length, 1);
  assert.deepEqual(junk.items.map((i) => [i.id, i.name, i.screen, i.variants.length, i.variants[0].price]), [['ok', 'Lavash', junk.screens[0].id, 1, 12900]]);
  assert.equal(junk.promotion.imageUrl, '');
  assert.equal(junk.promotion.startsAt, '');
});

test('ekran ma’lumoti: bog‘langan narx menyudan, bog‘lanmagani qo‘lda; yashirin taom va ichki ma’lumot chiqmaydi', () => {
  let config = dm.seedDm();
  const kebab = config.items.find((item) => item.name === 'KEBAB');
  config = dm.linkVariant(config, { itemId: kebab.id, variantId: kebab.variants[0].id, recipeId: 'r-kc' }, recipes);
  config = dm.toggleItem(config, config.items.find((i) => i.name === 'HOT DOG').id, 'visible', false);
  config = dm.toggleItem(config, config.items.find((i) => i.name === 'HAGGI').id, 'soldOut', true);
  const view = dm.tvView(config, recipes, 'kebab');
  assert.equal(view.screen.title, 'Kebab');
  assert.equal(view.items.some((i) => i.name === 'HOT DOG'), false, 'yashirin taom ekranda yo‘q');
  assert.equal(view.items.find((i) => i.name === 'HAGGI').soldOut, true);
  assert.deepEqual(view.items.find((i) => i.name === 'KEBAB').variants.slice(0, 2), [{ label: 'Chicken', price: 8200 }, { label: 'Lamb', price: 8900 }]);
  // menyuda narx o'zgarsa — ekranda ham
  const dearer = recipes.map((r) => (r.id === 'r-kc' ? { ...r, price: 8500 } : r));
  assert.equal(dm.tvView(config, dearer, 'kebab').items.find((i) => i.name === 'KEBAB').variants[0].price, 8500);
  // bog'langan taom menyudan olib tashlansa — oxirgi qo'lda narx ko'rinadi (ekran bo'sh qolmaydi)
  assert.equal(dm.tvView(config, recipes.filter((r) => r.id !== 'r-kc'), 'kebab').items.find((i) => i.name === 'KEBAB').variants[0].price, 7900);
  // ochiq javobda faqat ko'rinadigan maydonlar
  assert.deepEqual(Object.keys(view).sort(), ['items', 'promotion', 'restaurant', 'screen', 'screens', 'setOffer', 'thanks']);
  assert.deepEqual(Object.keys(view.items[0]).sort(), ['badge', 'description', 'id', 'image', 'name', 'soldOut', 'soldOutText', 'variants']);
  assert.equal(JSON.stringify(view).includes('recipeId'), false);
  assert.equal(view.promotion, null, 'o‘chirilgan aksiya chiqmaydi');
  assert.equal(dm.tvView(config, recipes, 'yo-q').screen.id, 'kebab', 'noma’lum ekran — birinchisi');
  // uzilganda ekrandagi narx o'zgarmaydi
  const cut = dm.linkVariant(config, { itemId: kebab.id, variantId: kebab.variants[0].id, recipeId: '' }, recipes);
  assert.deepEqual([cut.items.find((i) => i.id === kebab.id).variants[0].recipeId, cut.items.find((i) => i.id === kebab.id).variants[0].price], ['', 8200]);
});

test('bog‘lash taklifi: faqat bitta aniq mos kelganda; noaniq bo‘lsa taklif yo‘q', () => {
  assert.equal(dm.suggestRecipe('KEBAB', 'Chicken', recipes, 4), 'r-kc');
  assert.equal(dm.suggestRecipe('KEBAB', 'Mix', recipes, 4), '', 'menyuda yo‘q');
  assert.equal(dm.suggestRecipe('HUNTER’S PIZZA', 'Medium', recipes, 1), 'r-hunter', 'bitta variantli taom — nomi bo‘yicha');
  assert.equal(dm.suggestRecipe('KEBAB', '', recipes, 1), '', 'ikkita taomga mos — taklif berilmaydi');
  assert.equal(dm.suggestRecipe('CHEESE', 'Medium', recipes, 1), '', 'Cheese pizza va Cheese pizza small — noaniq');
  const view = dm.adminView(dm.seedDm(), recipes);
  assert.equal(view.unlinked, view.items.reduce((n, i) => n + i.variants.length, 0));
  assert.equal(view.items.find((i) => i.name === 'KEBAB').variants[0].suggestion, 'r-kc');
});

test('taom saqlash: tekshiruvlar, rasm, tartib, ekranlar, sozlamalar', () => {
  const seed = dm.seedDm();
  const v = [{ label: '', price: 12000 }];
  assert.throws(() => dm.saveItem(seed, { name: 'A', screen: 'kebab', variants: v }, recipes), /nomini/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'yo-q', variants: v }, recipes), /ekranda/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'kebab', variants: [] }, recipes), /bitta narx/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'kebab', variants: [{ label: '', price: 0 }] }, recipes), /narxini/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'kebab', variants: [{ label: 'a', price: 1 }, { label: '', price: 2 }] }, recipes), /2-variant/);
  assert.throws(() => dm.saveItem(seed, { name: 'Yangi', screen: 'kebab', variants: [{ label: '', recipeId: 'yo‘q' }] }, recipes), /menyuda topilmadi/);
  assert.throws(() => dm.saveItem(seed, { id: 'yo-q', name: 'Yangi', screen: 'kebab', variants: v }, recipes), /topilmadi/);
  const made = dm.saveItem(seed, { name: '  Yangi   taom ', screen: 'pitsa', badge: 'HIT', variants: [{ label: '', recipeId: 'r-cheese' }] }, recipes);
  assert.equal(made.created, true);
  const item = made.config.items.at(-1);
  assert.deepEqual([item.name, item.screen, item.badge, item.variants[0].recipeId, item.visible], ['Yangi taom', 'pitsa', 'HIT', 'r-cheese', true]);
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
  assert.throws(() => dm.saveScreen(combo.config, { title: 'Combo' }), /bor/);
  assert.equal(dm.deleteScreen(combo.config, 'combo').screens.length, 3);
  assert.equal(dm.saveScreen(seed, { id: 'kebab', title: 'Kebablar', itemsPerPage: 99, spotlightSeconds: 1 }).config.screens[0].itemsPerPage, 10);
  // ko'rinish: odatda "navbat"; faqat yuborilgan sozlama o'zgaradi
  assert.deepEqual([seed.screens[0].design, seed.screens[0].overviewSeconds, combo.config.screens.at(-1).design], ['navbat', 15, 'navbat']);
  const kino = dm.saveScreen(dm.saveScreen(seed, { id: 'kebab', title: 'Kebab', itemsPerPage: 5 }).config, { id: 'kebab', title: 'Kebab', design: 'kino' }).config.screens[0];
  assert.deepEqual([kino.design, kino.itemsPerPage, kino.spotlightSeconds, kino.overviewSeconds], ['kino', 5, 8, 15]);
  assert.throws(() => dm.saveScreen(seed, { id: 'kebab', title: 'Kebab', design: 'boshqa' }), /Ko‘rinishni/);
  assert.equal(dm.normalizeDm({ screens: [{ id: 'a', title: 'A', design: 'eski' }] }).screens[0].design, 'navbat');
  assert.deepEqual(Object.keys(dm.tvView(seed, recipes, 'kebab').screen).sort(), ['design', 'id', 'itemsPerPage', 'overviewSeconds', 'spotlightSeconds', 'title']);
  // sozlamalar: faqat yuborilgan qism o'zgaradi
  const set = dm.saveSettings(seed, { restaurant: { hours: 'Har kuni 11—02' }, setOffer: { price: 4500, imageId: 'img-set' }, promotion: { visible: true, startsAt: '2026-10-05T10:00', endsAt: '2026-10-06T10:00' } });
  assert.deepEqual([set.restaurant.hours, set.restaurant.phone, set.setOffer.price, set.setOffer.imageId, set.setOffer.imageUrl, set.promotion.visible], ['Har kuni 11—02', seed.restaurant.phone, 4500, 'img-set', '', true]);
  assert.deepEqual(set.items, seed.items);
  assert.throws(() => dm.saveSettings(seed, { promotion: { startsAt: '2026-10-06T10:00', endsAt: '2026-10-05T10:00' } }), /tugash/);
  assert.equal(dm.deleteItem(seed, kebab.id).items.length, 17);
});

test('ekran sahifasi: skript to‘g‘ri, shriftlar saytning o‘zidan, tashqi manzilga bog‘liq emas', () => {
  const html = tvPage({ screen: 'kebab', branch: 'main' });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /var CFG=\{"screen":"kebab","b":"main","v":"tv-2","d":""\}/);
  assert.match(tvPage({ screen: 'kebab', branch: 'main', design: 'kino' }), /"d":"kino"/);
  assert.equal(/https?:\/\//.test(html.replace(/‘/g, '')), false, 'tashqi sayt (shrift, skript) chaqirilmaydi');
  assert.match(html, /\/fonts\/halo-tv-display\.woff/);
  assert.equal(tvPage({ screen: '</script><b>', branch: 'main' }).includes('</script><b>'), false, 'manzildagi matn sahifani buzmaydi');
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

test('sayt: boshqaruv faqat rahbarga; ekran parolsiz; narx menyudan; biznes ma’lumoti o‘zgarmaydi', async () => {
  assert.equal((await monitorRoute.GET(new Request('https://halo.example.workers.dev/api/v2/monitor'))).status, 303);
  assert.equal((await monitor({ action: 'load' }, { 'content-type': 'application/json' })).status, 401);
  const page = await (await monitorRoute.GET(new Request('https://halo.example.workers.dev/api/v2/monitor', { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]));

  const first = await (await monitor({ action: 'load' })).json();
  assert.equal(first.ok, true, JSON.stringify(first).slice(0, 300));
  assert.deepEqual([first.saved, first.menu.items.length], [false, 18]);
  const state = JSON.parse(business().payload);
  state.recipes = [{ id: 'kc', name: 'Kebab chicken', salePrice: 8200, ingredients: [] }, { id: 'old', name: 'Eski taom', salePrice: 5000, archived: true, ingredients: [] }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(state));
  const before = business();

  // ekran: parolsiz sahifa va ma'lumot
  const html = await tv('?screen=kebab');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /id="stage"/);
  dm.tvMemoClear();
  const data = await (await tv('?data=1&screen=kebab')).json();
  assert.deepEqual([data.ok, data.v, data.items.length, data.items[3].name, data.items[3].variants[0].price], [true, TV_VERSION, 6, 'KEBAB', 7900]);
  assert.equal((await tv('?data=1&screen=kebab&b=yoq-filial')).status, 404);

  // rahbar: bog'lash, rasm, sotildi
  const loaded = await (await monitor({ action: 'load' })).json();
  assert.deepEqual(loaded.recipes.map((r) => r.id), ['kc'], 'arxivdagi taom taklif qilinmaydi');
  const kebab = loaded.menu.items.find((i) => i.name === 'KEBAB');
  assert.equal(kebab.variants[0].suggestion, 'kc');
  const linked = await (await monitor({ action: 'link', itemId: kebab.id, variantId: kebab.variants[0].id, recipeId: 'kc' })).json();
  assert.equal(linked.menu.items.find((i) => i.id === kebab.id).variants[0].shownPrice, 8200);
  assert.equal((await monitor({ action: 'upload', mime: 'image/svg+xml', data: PNG })).status, 400);
  assert.equal((await monitor({ action: 'upload', mime: 'image/png', data: 'bu base64 emas!' })).status, 400);
  const up = await (await monitor({ action: 'upload', mime: 'image/png', data: PNG })).json();
  assert.equal(up.ok, true, JSON.stringify(up));
  const saved = await (await monitor({ action: 'saveItem', id: kebab.id, name: kebab.name, screen: 'kebab', description: 'Meat · Sauce', imageId: up.imageId, variants: kebab.variants.map((v, i) => ({ id: v.id, label: v.label, recipeId: i === 0 ? 'kc' : '', price: v.price })) })).json();
  assert.equal(saved.ok, true, JSON.stringify(saved).slice(0, 300));
  const media = await tv(`?media=${up.imageId}`);
  assert.deepEqual([media.status, media.headers.get('content-type'), /immutable/.test(media.headers.get('cache-control'))], [200, 'image/png', true]);
  assert.equal((await media.arrayBuffer()).byteLength > 60, true);
  assert.equal((await tv('?media=img-yoq')).status, 404);
  await monitor({ action: 'toggle', id: kebab.id, field: 'soldOut', value: true });
  assert.equal((await monitor({ action: 'nimadir' })).status, 400);

  // ekranda darhol ko'rinadi (xotiradagi nusxa tozalanadi)
  const after = await (await tv('?data=1&screen=kebab')).json();
  const shown = after.items.find((i) => i.id === kebab.id);
  assert.deepEqual([shown.soldOut, shown.variants[0].price, shown.image, shown.description], [true, 8200, `/api/v2/tv?media=${up.imageId}`, 'Meat · Sauce']);

  // menyuda narx o'zgarsa — ekranda ham
  const next = JSON.parse(business().payload);
  next.recipes[0].salePrice = 8700;
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(next));
  dm.tvMemoClear();
  assert.equal((await (await tv('?data=1&screen=kebab')).json()).items.find((i) => i.id === kebab.id).variants[0].price, 8700);
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(before.payload);

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
