import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/* Xodim «🍽 Menyu»: rahbar ruxsat bergan xodim taom nomi va rasmini o'zgartiradi; rahbar jurnalda ko'radi va qaytaradi. */
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
const route = await import('../app/api/v2/menyu-xodim/route.ts');
const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const { ensureHaloState } = await import('../app/lib/halo-store.ts');
const base = 'https://halo.example.workers.dev';
const png = readFileSync(new URL('../public/icons/halo-192.png', import.meta.url)).toString('base64');
const call = (cookie, body) => route.POST(new Request(base + '/api/v2/menyu-xodim', { method: 'POST', headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) }));

test('ruxsat: kirmagan — 401, ruxsatsiz — 403 (narx/menyu o‘zgarmaydi), ruxsat bilan — nom o‘zgaradi', async () => {
  await ensureHaloState();
  assert.equal((await call('', { action: 'list' })).status, 401);
  const wid = await createWorkerAccount('main', 'Aziz', 'aziz', '1234');
  const cookie = (await loginWorker('main', 'aziz', '1234')).cookie.split(';')[0];
  assert.deepEqual(await (await call(cookie, { action: 'access' })).json(), { ok: true, allowed: false });
  const before = (await dm.readDm(db, 'main')).config;
  const target = before.items.find((item) => item.name === 'HALO LAVASH');
  const denied = await call(cookie, { action: 'rename', id: target.id, name: 'Boshqa nom' });
  assert.equal(denied.status, 403);
  assert.equal((await dm.readDm(db, 'main')).config.items.find((i) => i.id === target.id).name, 'HALO LAVASH');

  await staff.setMenuAccess(db, 'main', wid, true);
  assert.deepEqual(await staff.menuAccessIds(db, 'main'), [wid]);
  const ok = await call(cookie, { action: 'rename', id: target.id, name: '  HALO   LAVASH XL ' });
  assert.equal(ok.status, 200);
  const after = (await dm.readDm(db, 'main')).config;
  const changed = after.items.find((i) => i.id === target.id);
  assert.equal(changed.name, 'HALO LAVASH XL');
  assert.deepEqual(changed.variants, target.variants, 'narx va variantlar tegilmadi');
  assert.deepEqual(after.items.filter((i) => i.id !== target.id), before.items.filter((i) => i.id !== target.id), 'boshqa taomlar tegilmadi');
  const same = await (await call(cookie, { action: 'rename', id: target.id, name: 'HALO LAVASH XL' })).json();
  assert.equal(same.changed, false, 'o‘sha nom — jurnalga yozilmaydi');
  assert.equal((await (await call(cookie, { action: 'rename', id: target.id, name: 'X' })).json()).error, 'Taom nomini yozing (kamida 2 harf).');
  const log = await staff.listMenuLog(db, 'main', after);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].actorName, log[0].field, log[0].before, log[0].after, log[0].current], ['Aziz', 'name', 'HALO LAVASH', 'HALO LAVASH XL', true]);
});

test('rasm: yuklash + qo‘yish bitta amal; rahbar qaytaradi, eski rasm o‘chirilmaydi', async () => {
  const cookie = (await loginWorker('main', 'aziz', '1234')).cookie.split(';')[0];
  const cfg0 = (await dm.readDm(db, 'main')).config;
  const target = cfg0.items.find((item) => item.name === 'KEBAB');
  // eski rasm bazada (ko'chirilgan) bo'lsin
  const oldId = await dm.putMedia(db, 'main', 'image/png', png, new Date(Date.now() - 7_200_000));
  await dm.writeDm(db, 'main', { ...cfg0, items: cfg0.items.map((i) => i.id === target.id ? { ...i, imageId: oldId, imageUrl: '' } : i) });
  const res = await (await call(cookie, { action: 'photo', id: target.id, mime: 'image/png', data: png })).json();
  assert.equal(res.ok, true);
  const cfg1 = (await dm.readDm(db, 'main')).config;
  const newId = cfg1.items.find((i) => i.id === target.id).imageId;
  assert.notEqual(newId, oldId);
  // rahbar boshqa narsani saqlasa ham (Monitor menyu tozalashi) — jurnaldagi eski rasm qoladi
  await dm.pruneMedia(db, 'main', cfg1, new Date(), await staff.loggedMediaIds(db, 'main'));
  assert.ok(await dm.getMedia(db, oldId), 'eski rasm saqlanib qoldi');
  const entry = (await staff.listMenuLog(db, 'main', cfg1)).find((x) => x.field === 'image');
  assert.equal(entry.beforeImage, `/api/v2/tv?media=${oldId}`);
  const reverted = await staff.revertMenuLog(db, 'main', entry.id);
  assert.equal(reverted.items.find((i) => i.id === target.id).imageId, oldId);
  await assert.rejects(staff.revertMenuLog(db, 'main', entry.id), /oldin qaytarilgan/);
  // noto'g'ri fayl — hech narsa o'zgarmaydi
  const bad = await call(cookie, { action: 'photo', id: target.id, mime: 'image/gif', data: png });
  assert.equal(bad.status, 400);
  assert.equal((await dm.readDm(db, 'main')).config.items.find((i) => i.id === target.id).imageId, oldId);
});

test('keyin yana o‘zgargan bo‘lsa — eski yozuvni qaytarib bo‘lmaydi; rahbar bilan bir vaqtda saqlash ustma-ust yozmaydi', async () => {
  const cfg = (await dm.readDm(db, 'main')).config;
  const item = cfg.items.find((i) => i.name === 'HAGGI');
  const actor = { id: 'w', name: 'Aziz' };
  await staff.saveStaffChange(db, 'main', actor, (c) => staff.renameItem(c, item.id, 'HAGGI 1'));
  await staff.saveStaffChange(db, 'main', actor, (c) => staff.renameItem(c, item.id, 'HAGGI 2'));
  const log = await staff.listMenuLog(db, 'main', (await dm.readDm(db, 'main')).config);
  const first = log.find((x) => x.after === 'HAGGI 1');
  assert.equal(first.current, false);
  await assert.rejects(staff.revertMenuLog(db, 'main', first.id), /keyin yana o‘zgartirilgan/);

  // Rahbar xodim saqlayotgan paytda boshqa taomni o'zgartirdi — ikkala o'zgarish ham qoladi.
  let raced = false;
  await staff.saveStaffChange(db, 'main', actor, (c) => {
    if (!raced) { raced = true; const owner = { ...c, items: c.items.map((i) => i.name === 'HOT DOG' ? { ...i, description: 'Rahbar yozdi' } : i) }; sqlite.prepare('UPDATE v2_digital_menu SET payload = ?, updated_at = ? WHERE branch_id = ?').run(JSON.stringify(owner), new Date(Date.now() + 5).toISOString(), 'main'); }
    return staff.renameItem(c, item.id, 'HAGGI 3');
  });
  const end = (await dm.readDm(db, 'main')).config;
  assert.equal(end.items.find((i) => i.id === item.id).name, 'HAGGI 3');
  assert.equal(end.items.find((i) => i.name === 'HOT DOG').description, 'Rahbar yozdi');
});

test('sahifalar: xodim ilovasida «🍽 Menyu», Akkauntlarda ruxsat, Monitor menyuda jurnal va qaytarish', () => {
  const xodim = readFileSync(new URL('../app/api/v2/xodim/route.ts', import.meta.url), 'utf8');
  assert.match(xodim, /tile\('menu','🍽',t\('aMenu'\),t\('aMenuD'\),null,!menuOk\)/);
  assert.equal((xodim.match(/aMenu:'/g) || []).length, 4, '4 tilda');
  assert.doesNotMatch(xodim.slice(xodim.indexOf('function menuScreen'), xodim.indexOf('function lowScreen')), /price|narx:/i);
  const soz = readFileSync(new URL('../app/api/v2/sozlamalar/route.ts', import.meta.url), 'utf8');
  assert.match(soz, /data-mperm/); assert.match(soz, /action === "menuAccess"/);
  const mon = readFileSync(new URL('../app/api/v2/monitor/route.ts', import.meta.url), 'utf8');
  assert.match(mon, /staffRevert/); assert.match(mon, /loggedMediaIds/);
});
