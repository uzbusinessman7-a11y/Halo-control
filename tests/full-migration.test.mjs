import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  exportDatabase, importDatabase, validateDump, targetHasBusinessData, REPLACE_CONFIRMATION, MigrationError,
} from '../app/lib/full-migration.ts';

/** node:sqlite ustida D1 bilan bir xil interfeys (batch = tranzaksiya). */
function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => sqlite.prepare(query).run(...params),
    _exec: () => sqlite.prepare(query).run(...params),
  });
  return {
    prepare: (query) => make(query),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try { const out = statements.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

const OWNER = 'uzbusinessman7@gmail.com';
const sale = (id, total, cost) => ({ id, date: '2026-09-28', recipeId: 'shaurma', quantity: 1, totalRevenue: total, totalCost: cost, accountId: 'cash' });

function oldDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_state (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE halo_branches (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE halo_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_settings (id TEXT PRIMARY KEY NOT NULL, owner_email TEXT NOT NULL DEFAULT '');
    CREATE TABLE telegram_settings (id TEXT PRIMARY KEY NOT NULL, bot_token TEXT NOT NULL, chat_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE halo_worker_users (id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, name TEXT NOT NULL, pin_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX halo_worker_users_branch ON halo_worker_users (branch_id);
    CREATE TABLE halo_worker_sessions (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL);
    CREATE TABLE halo_state_backups (id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, payload TEXT NOT NULL);
  `);
  const main = { sales: [sale('s1', 7000, 2100.5), sale('s2', 7000, 2100.5)], inventory: [{ id: 'goosht', stock: 4200.25, unit: 'g' }], suppliers: [{ id: 'nodir', balance: 198000 }] };
  const branch2 = { sales: [sale('b1', 9000, 3000)], inventory: [], suppliers: [] };
  const insert = (sql, ...v) => db.prepare(sql).run(...v);
  insert('INSERT INTO app_state (id, payload, updated_at) VALUES (?, ?, ?)', 'main', JSON.stringify(main), '2026-09-28T10:00:00Z');
  insert('INSERT INTO app_state (id, payload, updated_at) VALUES (?, ?, ?)', 'filial-2', JSON.stringify(branch2), '2026-09-28T11:00:00Z');
  insert('INSERT INTO halo_branches (id, name) VALUES (?, ?)', 'main', 'HALO 1');
  insert('INSERT INTO halo_branches (id, name) VALUES (?, ?)', 'filial-2', 'HALO 2');
  insert('INSERT INTO halo_migrations (id) VALUES (?)', 'halo-schema-v7');
  insert('INSERT INTO integration_settings (id, owner_email) VALUES (?, ?)', 'main', OWNER);
  insert('INSERT INTO telegram_settings (id, bot_token, chat_id, enabled) VALUES (?, ?, ?, ?)', 'main', 'TOKEN', '-100', 1);
  insert('INSERT INTO halo_worker_users (id, branch_id, name, pin_hash) VALUES (?, ?, ?, ?)', 'w1', 'main', "Ali", 'hash1');
  insert('INSERT INTO halo_worker_sessions (id, user_id) VALUES (?, ?)', 'sess', 'w1');
  for (let i = 0; i < 60; i += 1) insert('INSERT INTO halo_state_backups (id, branch_id, payload) VALUES (?, ?, ?)', `b${i}`, 'main', JSON.stringify({ n: i }));
  return db;
}

/** Yangi sayt: migratsiyalar qo'llangan, rahbar bir marta kirgan (bo'sh standart holat). */
function newDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_state (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integration_settings (id TEXT PRIMARY KEY NOT NULL, owner_email TEXT NOT NULL DEFAULT '');
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
  `);
  db.prepare('INSERT INTO app_state (id, payload) VALUES (?, ?)').run('main', JSON.stringify({ sales: [], inventory: [], suppliers: [] }));
  db.prepare('INSERT INTO integration_settings (id, owner_email) VALUES (?, ?)').run('main', OWNER);
  db.prepare('INSERT INTO d1_migrations (id, name) VALUES (?, ?)').run(1, '0000_fine_lord_tyger.sql');
  return db;
}

const sum = (db, sql) => db.prepare(sql).get();

test('to‘liq ko‘chirish: har bir jadval, har bir won va gramm aynan ko‘chadi', async () => {
  const oldDb = oldDatabase();
  const dump = await exportDatabase(d1(oldDb), 'https://halo-control.uzbusinessman7.chatgpt.site');
  assert.equal(dump.tables.halo_worker_sessions, undefined, 'sessiyalar ko‘chirilmaydi');
  assert.equal(dump.tables.app_state.count, 2);
  assert.equal(dump.tables.halo_state_backups.count, 60);

  const newDb = newDatabase();
  const report = await importDatabase(d1(newDb), JSON.parse(JSON.stringify(dump)), { ownerEmail: OWNER });
  assert.equal(report.ok, true, JSON.stringify(report.tables));
  assert.ok(report.tables.every((t) => t.ok && t.fileRows === t.databaseRows));

  for (const id of ['main', 'filial-2']) {
    const before = sum(oldDb, `SELECT payload, updated_at FROM app_state WHERE id = '${id}'`);
    const after = sum(newDb, `SELECT payload, updated_at FROM app_state WHERE id = '${id}'`);
    assert.equal(after.payload, before.payload, `${id} ma'lumoti baytma-bayt bir xil`);
    assert.equal(after.updated_at, before.updated_at);
  }
  const payload = JSON.parse(sum(newDb, "SELECT payload FROM app_state WHERE id = 'main'").payload);
  assert.equal(payload.sales.reduce((s, x) => s + x.totalCost, 0), 4201);
  assert.equal(payload.inventory[0].stock, 4200.25);
  assert.equal(payload.suppliers[0].balance, 198000);
  assert.equal(sum(newDb, 'SELECT COUNT(*) AS n FROM halo_worker_users').n, 1);
  assert.equal(sum(newDb, "SELECT name FROM sqlite_master WHERE name = 'halo_worker_users_branch'").name, 'halo_worker_users_branch');
  assert.equal(sum(newDb, 'SELECT COUNT(*) AS n FROM d1_migrations').n, 1, 'platforma migratsiya jadvaliga tegilmaydi');
});

test('Telegram yangi saytda to‘xtatiladi — ikki marta xabar kelmaydi; eski bazaga tegilmaydi', async () => {
  const oldDb = oldDatabase();
  const oldCopy = JSON.stringify(oldDb.prepare('SELECT * FROM app_state ORDER BY id').all());
  const dump = await exportDatabase(d1(oldDb), 'old');
  const newDb = newDatabase();
  const report = await importDatabase(d1(newDb), dump, { ownerEmail: OWNER });
  assert.equal(report.telegramPaused, 1);
  assert.equal(sum(newDb, 'SELECT enabled FROM telegram_settings').enabled, 0);
  assert.equal(sum(oldDb, 'SELECT enabled FROM telegram_settings').enabled, 1, 'eski sayt yuborishda davom etadi');
  assert.equal(JSON.stringify(oldDb.prepare('SELECT * FROM app_state ORDER BY id').all()), oldCopy, 'eksport eski bazani o‘zgartirmaydi');
});

test('fayldagi 1 won o‘zgarsa ham import rad etiladi', async () => {
  const dump = await exportDatabase(d1(oldDatabase()), 'old');
  const payload = JSON.parse(dump.tables.app_state.rows[0][1]);
  payload.suppliers[0].balance = 197999;
  dump.tables.app_state.rows[0][1] = JSON.stringify(payload);
  const newDb = newDatabase();
  await assert.rejects(importDatabase(d1(newDb), dump, { ownerEmail: OWNER }), /nazorat yig'indisi mos emas/);
  assert.equal(await targetHasBusinessData(d1(newDb)), false, 'hech narsa yozilmadi');
});

test('boshqa rahbar emaili bilan import qilinmaydi (qulflanib qolmaslik uchun)', async () => {
  const dump = await exportDatabase(d1(oldDatabase()), 'old');
  await assert.rejects(importDatabase(d1(newDatabase()), dump, { ownerEmail: 'boshqa@example.com' }), /rahbar emaili \(uz\*\*\*@gmail\.com\)/);
});

test('ishlatilgan bazaga tasdiqsiz yozilmaydi; tasdiq bilan almashtiriladi', async () => {
  const dump = await exportDatabase(d1(oldDatabase()), 'old');
  const used = newDatabase();
  used.prepare('UPDATE app_state SET payload = ? WHERE id = ?').run(JSON.stringify({ sales: [sale('yangi', 1000, 300)] }), 'main');
  await assert.rejects(importDatabase(d1(used), dump, { ownerEmail: OWNER }), new RegExp(REPLACE_CONFIRMATION));
  assert.equal(JSON.parse(sum(used, "SELECT payload FROM app_state WHERE id='main'").payload).sales[0].id, 'yangi');
  const report = await importDatabase(d1(used), dump, { ownerEmail: OWNER, replaceExisting: REPLACE_CONFIRMATION });
  assert.equal(report.ok, true);
});

test('sinov rejimi (dryRun) hech narsa yozmaydi', async () => {
  const dump = await exportDatabase(d1(oldDatabase()), 'old');
  const newDb = newDatabase();
  const report = await importDatabase(d1(newDb), dump, { ownerEmail: OWNER, dryRun: true });
  assert.equal(report.dryRun, true);
  assert.equal(report.tables.find((t) => t.table === 'app_state').fileRows, 2);
  assert.equal(sum(newDb, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'halo_branches'").n, 0);
});

test('yangi bazada ustun yetishmasa, oldindan to‘xtaydi va hech narsa yozilmaydi', async () => {
  const dump = await exportDatabase(d1(oldDatabase()), 'old');
  const newDb = newDatabase();
  newDb.exec('CREATE TABLE halo_branches (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL)');
  await assert.rejects(importDatabase(d1(newDb), dump, { ownerEmail: OWNER }), /ustun yetishmaydi: active/);
  assert.equal(await targetHasBusinessData(d1(newDb)), false);
});

test('asosiy yozish yarim yo‘lda xato bersa — hammasi bekor (atomar)', async () => {
  const dump = await exportDatabase(d1(oldDatabase()), 'old');
  const newDb = newDatabase();
  newDb.exec("CREATE TABLE halo_worker_users (id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, name TEXT NOT NULL, pin_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, CHECK (name <> 'Ali'))");
  await assert.rejects(importDatabase(d1(newDb), dump, { ownerEmail: OWNER }));
  assert.equal(await targetHasBusinessData(d1(newDb)), false, 'app_state eski (bo‘sh) holatida qoldi');
  assert.equal(sum(newDb, 'SELECT COUNT(*) AS n FROM halo_worker_users').n, 0);
});

test('noto‘g‘ri yoki xavfli fayl rad etiladi', async () => {
  await assert.rejects(validateDump({ format: 'boshqa' }), MigrationError);
  const dump = await exportDatabase(d1(oldDatabase()), 'old');
  const evil = structuredClone(dump);
  evil.tables['x"; DROP TABLE app_state; --'] = evil.tables.halo_branches;
  await assert.rejects(validateDump(evil), /nomi noto'g'ri/);
  const evilSql = structuredClone(dump);
  evilSql.tables.halo_branches.sql = 'DROP TABLE app_state';
  await assert.rejects(validateDump(evilSql), /Kutilmagan tuzilma/);
  const sessions = structuredClone(dump);
  sessions.tables.halo_worker_sessions = dump.tables.halo_branches;
  await assert.rejects(validateDump(sessions), /ko'chirilmaydigan/);
});

// ---- ChatGPT'siz yo'l: filial zaxira fayllari ----
import { importBranchExports, summarizeState } from '../app/lib/full-migration.ts';

function freshSite() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE app_state (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE halo_branches (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE halo_state_backups (id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, revision TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL DEFAULT 'Rahbar', action TEXT NOT NULL DEFAULT '', section TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  db.prepare('INSERT INTO app_state (id, payload, updated_at) VALUES (?, ?, ?)').run('main', JSON.stringify({ sales: [], inventory: [] }), 'rev-empty');
  db.prepare('INSERT INTO halo_branches (id, name) VALUES (?, ?)').run('main', 'HALO');
  return db;
}
const branchFile = (branchId, state) => ({ product: 'HALO Control', format: 'halo-control-api-export', apiVersion: '1.0', exportedAt: '2026-09-29T06:00:00.000Z', branchId, updatedAt: `rev-${branchId}`, sections: Object.keys(state).sort(), state });
const mainState = { sales: [sale('s1', 7000, 2100.5), sale('s2', 7000, 2100.5)], inventory: [{ id: 'goosht', stock: 4200.25 }], suppliers: [{ id: 'nodir', balance: 198000 }], recipes: [{ id: 'shaurma' }], financialEntries: [{ id: 'e1', amount: 50000 }], vegetableExpenseVersion: 1 };

test('filial fayllari: ma’lumot baytma-bayt yoziladi, hisob-kitob qayta qo‘llanmaydi', async () => {
  const db = freshSite();
  const files = [branchFile('main', mainState), branchFile('filial-2', { sales: [sale('b1', 9000, 3000)] })];
  const report = await importBranchExports(d1(db), files);
  assert.equal(report.ok, true);
  assert.equal(db.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload, JSON.stringify(mainState));
  assert.equal(db.prepare("SELECT updated_at FROM app_state WHERE id='main'").get().updated_at, 'rev-main');
  assert.equal(db.prepare("SELECT name FROM halo_branches WHERE id='filial-2'").get().name, 'Filial filial-2');
  assert.equal(db.prepare("SELECT name FROM halo_branches WHERE id='main'").get().name, 'HALO', 'mavjud filial nomi saqlanadi');
  assert.deepEqual(report.branches[0].summary, { sales: 2, salesRevenue: 14000, financialEntries: 1, inventoryItems: 1, suppliers: 1, supplierBalance: 198000, recipes: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM halo_state_backups WHERE branch_id='main'").get().n, 1, 'avvalgi bo‘sh holat ham tarixda');
});

test('filial fayllari: tekshiruv rejimi yozmaydi, band filialga tasdiqsiz yozilmaydi', async () => {
  const db = freshSite();
  const dry = await importBranchExports(d1(db), [branchFile('main', mainState)], { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload).sales.length, 0);
  await importBranchExports(d1(db), [branchFile('main', mainState)]);
  await assert.rejects(importBranchExports(d1(db), [branchFile('main', { sales: [] })]), /HA_ALMASHTIR/);
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload).sales.length, 2);
});

test('filial fayllari: noto‘g‘ri, takroriy yoki xavfli fayl rad etiladi, hech narsa yozilmaydi', async () => {
  const db = freshSite();
  await assert.rejects(importBranchExports(d1(db), []), /Kamida bitta/);
  await assert.rejects(importBranchExports(d1(db), [{ format: 'boshqa' }]), /filial zaxirasi emas/);
  await assert.rejects(importBranchExports(d1(db), [branchFile('main', mainState), branchFile('main', mainState)]), /ikkita fayl/);
  await assert.rejects(importBranchExports(d1(db), [branchFile("x'; DROP TABLE app_state;--", mainState)]), /Filial nomi noto'g'ri/);
  await assert.rejects(importBranchExports(d1(db), [{ ...branchFile('main', mainState), state: [] }]), /state/);
  assert.equal(JSON.parse(db.prepare("SELECT payload FROM app_state WHERE id='main'").get().payload).sales.length, 0);
});

test('jami ko‘rsatkichlar buzilgan qiymatlarda ham ishlaydi', () => {
  assert.deepEqual(summarizeState({ sales: [{ totalRevenue: 'abc' }, { totalRevenue: 1000.4 }], suppliers: 'x' }), { sales: 2, salesRevenue: 1000, financialEntries: 0, inventoryItems: 0, suppliers: 0, supplierBalance: 0, recipes: 0 });
});
