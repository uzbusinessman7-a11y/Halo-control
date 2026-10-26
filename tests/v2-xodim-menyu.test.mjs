import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/* Xodim menyuni to'liq boshqaradi (rahbar ruxsati bilan): Monitor menyu xodim ko'rinishida; har o'zgarish jurnalda, rahbar qaytaradi. */
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
const db = d1(sqlite);
globalThis.__HALO_CONTROL_DB__ = db;
globalThis.__HALO_SELF_HOSTED__ = true;
const staff = await import('../app/core/menu-staff.ts');
const dm = await import('../app/core/digital-menu.ts');
const monitor = await import('../app/api/v2/monitor/route.ts');
const access = await import('../app/api/v2/menyu-xodim/route.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const { ensureHaloState, mutateHaloState, readHaloState } = await import('../app/lib/halo-store.ts');
const base = 'https://halo.example.workers.dev';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const post = (headers, body) => monitor.POST(new Request(base + '/api/v2/monitor', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const png = readFileSync(new URL('../public/icons/halo-192.png', import.meta.url)).toString('base64');
let cookie = '';
let workerId = '';

test('ruxsat: ruxsatsiz xodim — 403 va sahifa xodim ilovasiga qaytaradi; ruxsat bilan — xodim ko‘rinishi (rahbar menyusisiz)', async () => {
  await ensureHaloState();
  await mutateHaloState((st) => ({ state: { ...st, recipes: [...(st.recipes || []), { id: 'r-tl', name: 'Tandir lavash', salePrice: 12900, ingredients: [], categoryId: '' }] }, result: null }), 5, 'main', 'Rahbar', 'test retsept', 'test');
  workerId = await createWorkerAccount('main', 'Aziz', 'aziz', '1234');
  cookie = (await loginWorker('main', 'aziz', '1234')).cookie.split(';')[0];
  const acc = (c) => access.POST(new Request(base + '/api/v2/menyu-xodim', { method: 'POST', headers: c ? { cookie: c } : {}, body: '{}' }));
  assert.equal((await acc('')).status, 401);
  assert.equal((await (await acc(cookie)).json()).allowed, false);
  assert.equal((await post({ cookie }, { action: 'load' })).status, 403);
  const page = await monitor.GET(new Request(base + '/api/v2/monitor', { headers: { cookie } }));
  assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/api/v2/xodim');

  await staff.setMenuAccess(db, 'main', workerId, true);
  assert.deepEqual(await (await acc(cookie)).json(), { ok: true, allowed: true, url: '/api/v2/monitor' });
  const html = await (await monitor.GET(new Request(base + '/api/v2/monitor', { headers: { cookie } }))).text();
  assert.match(html, /WORKER=true/);
  assert.doesNotMatch(html, /class="side"/, 'rahbar menyusi yo‘q');
  assert.match(html, /data-fallback="\/api\/v2\/xodim"/);
  const ownerHtml = await (await monitor.GET(new Request(base + '/api/v2/monitor', { headers: owner }))).text();
  assert.match(ownerHtml, /WORKER=false/);
});

test('xodim: taom tahrirlash, «Sotildi», yangi taom — saqlanadi va jurnalga yoziladi; boshqa filialga yozolmaydi; jurnal faqat rahbarga', async () => {
  const load = await (await post({ cookie }, { action: 'load', branchId: 'boshqa' })).json();
  assert.equal(load.ok, true); assert.deepEqual(load.staffLog, []);
  const kebab = load.menu.items.find((i) => i.name === 'KEBAB');
  const r1 = await (await post({ cookie }, { action: 'toggle', id: kebab.id, field: 'soldOut', value: true })).json();
  assert.equal(r1.ok, true);
  const form = { action: 'saveItem', name: 'NEW BURGER', description: 'Meat · Cheese', screen: 'kebab', badge: 'NEW', visible: true, soldOut: false, soldOutText: 'SOTILDI', variants: [{ label: 'Burger', size: 'Classic', price: 9900, active: true, recipeId: '' }] };
  const r2 = await (await post({ cookie }, form)).json();
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const cfg = (await dm.readDm(db, 'main')).config;
  assert.ok(cfg.items.find((i) => i.id === kebab.id).soldOut);
  assert.ok(cfg.items.some((i) => i.name === 'NEW BURGER'));
  const log = await (await post(owner, { action: 'load', branchId: 'main' })).json();
  const texts = log.staffLog.map((x) => `${x.actorName}: ${x.summary}`);
  assert.ok(texts.some((t) => /Aziz: KEBAB: «Sotildi» qo‘yildi/.test(t)), texts.join(' | '));
  assert.ok(texts.some((t) => /Yangi taom: NEW BURGER \(Burger Classic ₩9,900\)/.test(t)), texts.join(' | '));
});

test('narx: bog‘langan taom — kassadagi narx ham o‘zgaradi (tarixda xodim nomi), rahbar qaytaradi; bog‘lanmagan — ekrandagi narx', async () => {
  // Tandir lavash variantini menyudagi taomga bog'laymiz (rahbar).
  const before = (await dm.readDm(db, 'main')).config;
  const tl = before.items.find((i) => i.name === 'TANDIR LAVASH');
  await dm.writeDm(db, 'main', { ...before, items: before.items.map((i) => i.id === tl.id ? { ...i, variants: i.variants.map((v, k) => k === 0 ? { ...v, recipeId: 'r-tl' } : v) } : i) });
  const vid = tl.variants[0].id;
  const res = await (await post({ cookie }, { action: 'setPrice', itemId: tl.id, variantId: vid, price: '13,500' })).json();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.priceChanged, { kassa: true, before: 12900, after: 13500 });
  const state = (await readHaloState('main')).state;
  assert.equal(state.recipes.find((r) => r.id === 'r-tl').salePrice, 13500, 'kassadagi narx o‘zgardi');
  assert.match(state.auditLog[0].action, /Sotuv narxi o‘zgartirildi \(Monitor menyu\) · TANDIR LAVASH/);
  assert.equal(state.auditLog[0].actor, 'Aziz (xodim)');
  assert.equal((await post({ cookie }, { action: 'setPrice', itemId: tl.id, variantId: vid, price: '0' })).status, 400);

  const log = (await (await post(owner, { action: 'load', branchId: 'main' })).json()).staffLog;
  const entry = log.find((x) => x.field === 'price');
  assert.match(entry.summary, /Narx \(kassada ham\): Tandir lavash .*₩12,900 → ₩13,500/);
  assert.equal(entry.current, true);
  assert.equal((await post({ cookie }, { action: 'staffRevert', id: entry.id })).status, 403, 'xodim qaytara olmaydi');
  const back = await (await post(owner, { action: 'staffRevert', branchId: 'main', id: entry.id })).json();
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal((await readHaloState('main')).state.recipes.find((r) => r.id === 'r-tl').salePrice, 12900, 'rahbar qaytardi');

  // bog'lanmagan narx — faqat ekranda; rahbar qaytaradi
  const hd = (await dm.readDm(db, 'main')).config.items.find((i) => i.name === 'HOT DOG');
  const r2 = await (await post({ cookie }, { action: 'setPrice', itemId: hd.id, variantId: hd.variants[0].id, price: 9000 })).json();
  assert.deepEqual(r2.priceChanged, { kassa: false, before: 8500, after: 9000 });
  const e2 = (await (await post(owner, { action: 'load', branchId: 'main' })).json()).staffLog.find((x) => /HOT DOG: .*₩8,500 → ₩9,000/.test(x.summary));
  assert.ok(e2 && e2.current);
  await post(owner, { action: 'staffRevert', branchId: 'main', id: e2.id });
  assert.equal((await dm.readDm(db, 'main')).config.items.find((i) => i.id === hd.id).variants[0].price, 8500);
});

test('qaytarish: keyin yana o‘zgargan bo‘lsa — bo‘lmaydi; rasm jurnalda turguncha o‘chirilmaydi; rahbar bilan bir vaqtda yozish — 409', async () => {
  const cfg0 = (await dm.readDm(db, 'main')).config;
  const k = cfg0.items.find((i) => i.name === 'KEBAB');
  const oldId = await dm.putMedia(db, 'main', 'image/png', png, new Date(Date.now() - 7_200_000));
  await dm.writeDm(db, 'main', { ...cfg0, items: cfg0.items.map((i) => i.id === k.id ? { ...i, imageId: oldId, imageUrl: '' } : i) });
  const up = await (await post({ cookie }, { action: 'upload', mime: 'image/png', data: png })).json();
  const item = (await dm.readDm(db, 'main')).config.items.find((i) => i.id === k.id);
  const save = await (await post({ cookie }, { action: 'saveItem', id: item.id, name: item.name, description: item.description, screen: item.screen, badge: item.badge, visible: true, soldOut: item.soldOut, soldOutText: item.soldOutText, imageId: up.imageId, variants: item.variants })).json();
  assert.equal(save.ok, true, JSON.stringify(save));
  assert.ok(await dm.getMedia(db, oldId), 'eski rasm jurnal uchun saqlandi (tozalashdan keyin ham)');
  assert.ok((await staff.loggedMediaIds(db, 'main')).includes(oldId));
  const log = (await (await post(owner, { action: 'load', branchId: 'main' })).json()).staffLog;
  const photo = log.find((x) => /KEBAB: rasm almashtirildi/.test(x.summary));
  assert.ok(photo && photo.current, log.map((x) => x.summary).join(' | '));
  const older = log.find((x) => /«Sotildi» qo‘yildi/.test(x.summary));
  assert.equal(older.current, false);
  assert.equal((await post(owner, { action: 'staffRevert', branchId: 'main', id: older.id })).status, 409);
  await post(owner, { action: 'staffRevert', branchId: 'main', id: photo.id });
  assert.equal((await dm.readDm(db, 'main')).config.items.find((i) => i.id === k.id).imageId, oldId, 'eski rasm qaytdi');

  // Rahbar xodim o'qigan nusxadan keyin saqladi — xodimning yozuvi rad etiladi (ustma-ust yozmaydi).
  const current = await dm.readDm(db, 'main');
  await dm.writeDm(db, 'main', current.config, new Date(Date.now() + 1000));
  assert.equal(await staff.writeIf(db, 'main', current.config, current), false);
});

test('sahifalar: xodim ilovasida «🍽 Menyu» Monitor menyuni ochadi; Akkauntlarda ruxsat; tez narx tugmasi faqat xodimda', () => {
  const xodim = readFileSync(new URL('../app/api/v2/xodim/route.ts', import.meta.url), 'utf8');
  assert.match(xodim, /tile\('menu','🍽',t\('aMenu'\),t\('aMenuD'\),'\/api\/v2\/monitor',!menuOk\)/);
  assert.equal((xodim.match(/aMenu:'/g) || []).length, 4, '4 tilda');
  const soz = readFileSync(new URL('../app/api/v2/sozlamalar/route.ts', import.meta.url), 'utf8');
  assert.match(soz, /Menyu va narxni o‘zgartirishi mumkin/); assert.match(soz, /action === "menuAccess"/);
  const mon = readFileSync(new URL('../app/api/v2/monitor/route.ts', import.meta.url), 'utf8');
  assert.match(mon, /WORKER\?'<button class="ghost" data-pr=/);
});
