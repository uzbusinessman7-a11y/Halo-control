import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/admin/migration/route.ts');

function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; },
    _exec: () => sqlite.prepare(query).run(...params),
  });
  return {
    prepare: (query) => make(query),
    exec: async (sql) => sqlite.exec(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try { const out = statements.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}

const OWNER = 'owner@example.com';

// Ilova integratsiya jadvallarini bir marta yaratadi va buni xotirada eslab qoladi.
// Shuning uchun ularning haqiqiy tuzilmasini bir marta olib, har bir sinov bazasiga qo'yamiz.
const template = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = null;
async function integrationSchema() {
  if (!integrationSchema.sql) {
    globalThis.__HALO_CONTROL_DB__ = d1(template);
    await GET(new Request('https://x.example/api/admin/migration', { headers: { 'oai-authenticated-user-email': OWNER } }));
    integrationSchema.sql = template.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all().map((r) => r.sql);
    integrationSchema.owner = template.prepare("SELECT * FROM integration_settings WHERE id = 'main'").get();
  }
  return integrationSchema;
}
function withIntegration(db, schema) {
  for (const sql of schema.sql) db.exec(sql);
  const cols = Object.keys(schema.owner);
  db.prepare(`INSERT INTO integration_settings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => schema.owner[c]));
  return db;
}
const schema = await integrationSchema();
const site = 'https://halo.example.workers.dev/api/admin/migration';
const asOwner = { 'oai-authenticated-user-email': OWNER };

function oldSite() {
  const db = new DatabaseSync(':memory:');
  withIntegration(db, schema);
  db.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  db.prepare('INSERT INTO app_state (id, payload) VALUES (?, ?)').run('main', JSON.stringify({ sales: [{ id: 's', totalRevenue: 7000, totalCost: 2100.5 }] }));
  return db;
}
function newSite() {
  return withIntegration(new DatabaseSync(':memory:'), schema);
}
function use(db, selfHosted) {
  globalThis.__HALO_CONTROL_DB__ = d1(db);
  globalThis.__HALO_SELF_HOSTED__ = selfHosted;
}

// Rahbar emaili ilovaning o'zi tomonidan birinchi rahbar so'rovida yoziladi (haqiqiy oqim).
test('begona odam faylni yuklab ololmaydi, sahifadan kirishga yo‘naltiriladi', async () => {
  use(oldSite(), false);
  assert.equal((await GET(new Request(`${site}?download=1`))).status, 401);
  const page = await GET(new Request(site));
  assert.equal(page.status, 303);
  assert.match(page.headers.get('location'), /^\/signin-with-chatgpt\?return_to=/);
  assert.equal((await POST(new Request(site, { method: 'POST', body: '{}' }))).status, 401);
});

test('eski sayt: yuklab olish ishlaydi, import esa taqiqlangan (eski bazaga yozilmaydi)', async () => {
  const oldDb = oldSite();
  use(oldDb, false);
  const response = await GET(new Request(`${site}?download=1`, { headers: asOwner }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /halo-toliq-kochirish-\d{4}-\d{2}-\d{2}\.json/);
  const dump = await response.json();
  assert.equal(dump.tables.app_state.count, 1);
  const refused = await POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ dump }) }));
  assert.equal(refused.status, 403);
  const html = await (await GET(new Request(site, { headers: asOwner }))).text();
  assert.match(html, /ESKI SAYT/);
  assert.doesNotMatch(html, /<script>/);
});

test('yangi sayt: tekshirish → ko‘chirish → wonma-won mos', async () => {
  use(oldSite(), false);
  const dump = await (await GET(new Request(`${site}?download=1`, { headers: asOwner }))).json();
  const target = newSite();
  use(target, true);
  const dry = await (await POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ dump, dryRun: true }) }))).json();
  assert.equal(dry.ok, true); assert.equal(dry.report.dryRun, true);
  const done = await (await POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ dump }) }))).json();
  assert.equal(done.ok, true);
  assert.ok(done.report.tables.every((t) => t.ok));
  assert.equal(JSON.parse(target.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload).sales[0].totalCost, 2100.5);
});

test('buzilgan fayl tushunarli xato bilan rad etiladi', async () => {
  use(newSite(), true);
  const bad = await POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ dump: { format: 'x' } }) }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /ko'chirish fayli emas/);
  const notJson = await POST(new Request(site, { method: 'POST', headers: asOwner, body: '{buzuq' }));
  assert.equal(notJson.status, 400);
});

test('yangi sayt sahifasidagi skript sintaktik jihatdan to‘g‘ri', async () => {
  use(newSite(), true);
  const html = await (await GET(new Request(site, { headers: asOwner }))).text();
  assert.match(html, /YANGI SAYT/);
  assert.match(html, /API va ulanishlar/);
  assert.match(html, /halo-control.uzbusinessman7.chatgpt.site/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /HA_ALMASHTIR/);
});

test('yangi sayt: eski saytdagi "To‘liq ma’lumotni yuklash" fayllari orqali ko‘chirish', async () => {
  const target = newSite();
  use(target, true);
  const files = [{ format: 'halo-control-api-export', branchId: 'main', exportedAt: '2026-09-29T06:00:00Z', updatedAt: 'rev-1', state: { sales: [{ id: 's', totalRevenue: 7000, totalCost: 2100.5 }] } }];
  const dry = await (await POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ files, dryRun: true }) }))).json();
  assert.equal(dry.ok, true);
  assert.equal(dry.branchReport.branches[0].summary.salesRevenue, 7000);
  const done = await (await POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ files }) }))).json();
  assert.equal(done.ok, true);
  assert.equal(target.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload, JSON.stringify(files[0].state));
});

function stateTables(db) {
  db.exec("CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  db.exec("CREATE TABLE IF NOT EXISTS halo_state_backups (id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, revision TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT, action TEXT, section TEXT, created_at TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS halo_branches (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1)");
  return db;
}

test('noldan boshlash: yangi saytdagi ma’lumotdan (fayl yo‘q) — tekshirish, tasdiq, zaxira', async () => {
  const target = stateTables(newSite());
  use(target, true);
  const state = { inventory: [{ id: 'i1', name: 'Tovuq', stock: 9, unitCost: 8000 }], recipes: [{ id: 'r', name: 'Kabob', ingredients: [] }], suppliers: [{ id: 'p', name: 'Ali', balance: 50000 }], sales: [{ id: 's', totalRevenue: 7000 }] };
  target.exec("CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  target.prepare("INSERT INTO app_state (id, payload, updated_at) VALUES ('main', ?, 'rev-0') ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at").run(JSON.stringify(state));
  target.exec("CREATE TABLE v2_period_counts (id TEXT PRIMARY KEY)"); target.exec("INSERT INTO v2_period_counts VALUES ('x')");
  const post = (body) => POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ action: 'baseReset', startDate: '2026-10-01', ...body }) }));
  const dry = await (await post({ dryRun: true })).json();
  assert.equal(dry.ok, true);
  assert.equal(dry.branchReport.branches[0].base.cleared.sales, 1);
  assert.equal(JSON.parse(target.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload).sales.length, 1, 'tekshirish hech narsa yozmaydi');
  const noConfirm = await post({});
  assert.equal(noConfirm.status, 400);
  const done = await (await post({ confirm: 'NOLDAN_BOSHLA' })).json();
  assert.equal(done.ok, true);
  assert.equal(done.periodCountsCleared, 1);
  const after = JSON.parse(target.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload);
  assert.equal(after.inventory[0].name, 'Tovuq'); assert.equal(after.inventory[0].stock, 0); assert.equal(after.inventory[0].unitCost, 8000);
  assert.equal(after.suppliers[0].balance, 0); assert.deepEqual(after.sales, []);
  const backup = target.prepare("SELECT payload FROM halo_state_backups WHERE branch_id='main' AND action LIKE 'Noldan%'").get();
  assert.equal(JSON.parse(backup.payload).sales.length, 1, 'avvalgi holat zaxirada');
});

test('noldan boshlash: eski sayt fayllaridan faqat baza olinadi', async () => {
  const target = stateTables(newSite());
  use(target, true);
  const files = [{ format: 'halo-control-api-export', branchId: 'main', exportedAt: '2026-09-30T06:00:00Z', updatedAt: 'rev-1', state: { inventory: [{ id: 'i', name: 'Non', stock: 40 }], sales: [{ id: 's', totalRevenue: 7000 }] } }];
  const done = await (await POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ files, baseOnly: true, replaceExisting: 'HA_ALMASHTIR', startDate: '2026-10-01' }) }))).json();
  assert.equal(done.ok, true);
  const after = JSON.parse(target.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload);
  assert.equal(after.inventory[0].stock, 0); assert.deepEqual(after.sales, []);
});

test('to‘liq o‘tishdan keyin noldan boshlash taqiqlangan', async () => {
  const target = newSite();
  use(target, true);
  target.exec("CREATE TABLE IF NOT EXISTS halo_cutover (id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, completed_by TEXT NOT NULL DEFAULT '')");
  target.exec("INSERT INTO halo_cutover (id, completed_at) VALUES ('main', '2026-10-01')");
  const res = await POST(new Request(site, { method: 'POST', headers: asOwner, body: JSON.stringify({ action: 'baseReset', dryRun: true }) }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /noldan boshlab bo'lmaydi/);
});
