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
