import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { runBridge } = await import('../app/core/bridge-sync.ts');
const { buildBridgePlan, moneyAccountCode, bridgeOperationId } = await import('../app/core/bridge.ts');
const { verifyLedger, rawBalances, listAccounts, submitBlindCount, closeDay, ensureLedgerSchema } = await import('../app/core/ledger-store.ts');
const { calculateAccountBalances } = await import('../app/lib/account-balances.ts');

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
      try { const out = statements.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}

const scope = { tenantId: 'halo', branchId: 'main' };
const today = '2026-09-29';

/** Haqiqiyga yaqin eski holat: bir necha hisob, savdolar, xarajatlar, o'tkazma, bekor qilinganlar. */
function oldState() {
  const sales = [];
  for (let i = 0; i < 400; i += 1) {
    sales.push({ id: `sale-${i}`, date: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, recipeId: 'shaurma', quantity: 1 + (i % 3),
      totalRevenue: 7000 + (i % 5) * 1000, totalCost: 2100.5, accountId: i % 3 === 0 ? 'account-cash' : i % 3 === 1 ? 'account-card' : undefined });
  }
  sales.push({ id: 'sale-cancelled', date: '2026-09-10', totalRevenue: 50000, accountId: 'account-cash', cancelledAt: '2026-09-10T12:00:00Z' });
  sales.push({ id: 'sale-voided', date: '2026-09-10', totalRevenue: 50000, accountId: 'account-cash', status: 'voided' });
  sales.push({ id: 'sale-zero', date: '2026-09-11', totalRevenue: 0, accountId: 'account-cash' });
  sales.push({ id: 'sale-fraction', date: '2026-09-12', totalRevenue: 7000.4, accountId: 'account-cash' });
  sales.push({ id: 'sale-lost', date: '2026-09-12', totalRevenue: 3000, accountId: 'yoq-hisob' });
  return {
    accounts: [
      { id: 'account-cash', name: 'Naqd kassa', type: 'cash', openingBalance: 250000 },
      { id: 'account-card', name: 'Karta / POS', type: 'card', openingBalance: 0 },
      { id: 'account-bank', name: 'Bank', type: 'bank', openingBalance: 1000000.6 },
    ],
    sales,
    financialEntries: [
      { id: 'e-rent', date: '2026-09-05', type: 'expense', amount: 800000, accountId: 'account-bank', category: 'Ijara' },
      { id: 'e-supplier', date: '2026-09-06', type: 'expense', amount: 198000, accountId: 'account-cash', affectsProfit: false, category: 'Mahsulot xaridi' },
      { id: 'e-sauce', date: '2026-09-06', type: 'expense', amount: 55000, accountId: '', nonCash: true, affectsProfit: true },
      { id: 'e-owner', date: '2026-09-07', type: 'income', amount: 300000, accountId: 'account-cash', affectsProfit: false, category: 'Egasi pul kiritdi' },
      { id: 'e-tip', date: '2026-09-08', type: 'income', amount: 12000, accountId: 'account-cash', category: 'Boshqa kirim' },
      { id: 'e-move', date: '2026-09-09', type: 'transfer', amount: 400000, accountId: 'account-cash', toAccountId: 'account-bank' },
      { id: 'e-wrong', date: '2026-09-09', type: 'expense', amount: 90000, accountId: 'account-cash' },
      { id: 'e-wrong-fix', date: '2026-09-09', type: 'expense', amount: -90000, accountId: 'account-cash', reversedEntryId: 'e-wrong' },
      { id: 'e-cancel', date: '2026-09-09', type: 'expense', amount: 5000, accountId: 'account-cash', cancelledAt: 'x' },
      { id: 'e-badtransfer', date: '2026-09-09', type: 'transfer', amount: 500, accountId: 'account-cash', toAccountId: 'yoq' },
    ],
  };
}

async function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  return { sqlite, db: d1(sqlite) };
}

test('ko‘prik: har bir pul hisobi eski tizim bilan wonma-won mos, jurnal muvozanatda', async () => {
  const { db: database } = await db();
  const state = oldState();
  const report = await runBridge(database, scope, state, today);
  assert.equal(report.ok, true, JSON.stringify(report.comparison));
  assert.equal(report.ledgerBalanced, true);
  const old = calculateAccountBalances(state, '9999-12-31');
  for (const row of report.comparison) {
    assert.equal(row.ledgerBalance, old.balances.get(row.oldId), row.name);
    assert.equal(row.difference, 0);
  }
  assert.deepEqual(report.unmatched.sort(), ['pul:e-badtransfer', 'savdo:sale-lost']);
  assert.deepEqual([...old.unmatched].sort(), ['e-badtransfer', 'sale-lost'], 'eski tizim ham xuddi shularni topolmaydi');
  assert.equal(report.zeroAmount, 1);
  assert.equal((await verifyLedger(database, scope)).ok, true);
});

test('ko‘prik qayta ishga tushirilsa — hech narsa takror yozilmaydi', async () => {
  const { db: database, sqlite } = await db();
  const state = oldState();
  const first = await runBridge(database, scope, state, today);
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM v2_ledger_entries').get().n;
  const second = await runBridge(database, scope, state, today);
  assert.equal(second.posted, 0);
  assert.equal(second.alreadyPosted, first.posted);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v2_ledger_entries').get().n, count);
  assert.equal(second.ok, true);
});

test('eski tizimda bekor qilingan savdo jurnaldan o‘chirilmaydi — teskari yozuv qo‘shiladi', async () => {
  const { db: database, sqlite } = await db();
  const state = oldState();
  await runBridge(database, scope, state, today);
  state.sales[0].cancelledAt = '2026-09-29T10:00:00Z';
  const report = await runBridge(database, scope, state, today);
  assert.equal(report.reversed, 1);
  assert.equal(report.ok, true, 'qoldiq yana eski tizim bilan mos');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM v2_ledger_entries WHERE kind = 'reversal'").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM v2_ledger_entries WHERE operation_id = ?").get(bridgeOperationId('s', 'sale-0')).n, 1, 'asl yozuv tarixda qoldi');
  assert.equal((await runBridge(database, scope, state, today)).reversed, 0, 'ikkinchi marta teskari yozilmaydi');
});

test('eski yozuv summasi keyin o‘zgartirilsa — jim o‘tmaydi, “o‘zgargan” deb ko‘rsatiladi', async () => {
  const { db: database } = await db();
  const state = oldState();
  await runBridge(database, scope, state, today);
  state.sales[5].totalRevenue += 1;
  const report = await runBridge(database, scope, state, today);
  assert.equal(report.ok, false);
  assert.deepEqual(report.changed, ['savdo:sale-5']);
  assert.equal(report.comparison.reduce((sum, row) => sum + Math.abs(row.difference), 0), 1, 'aynan 1 won farq ko‘rinadi');
});

test('V2 da yopilgan kunga ko‘prik eski yozuv qo‘shmaydi', async () => {
  const { db: database } = await db();
  const state = { accounts: [{ id: 'account-cash', name: 'Kassa', type: 'cash', openingBalance: 0 }], sales: [{ id: 'a', date: '2026-09-01', totalRevenue: 1000, accountId: 'account-cash' }], financialEntries: [] };
  await runBridge(database, scope, state, today);
  const accounts = await listAccounts(database, scope);
  const cash = [...accounts.values()].find((a) => a.isCash);
  await submitBlindCount(database, scope, { operationId: 'count-000001', date: '2026-09-01', actor: 'Ali', counts: { [cash.id]: 1000 } });
  await closeDay(database, scope, { date: '2026-09-01', reviewer: 'Otabek', note: '', operationId: 'close-000001' });
  state.sales.push({ id: 'late', date: '2026-09-01', totalRevenue: 500, accountId: 'account-cash' });
  const report = await runBridge(database, scope, state, today);
  assert.equal(report.invalid.length, 1);
  assert.match(report.invalid[0], /yopilgan/);
  assert.equal((await rawBalances(database, scope)).get(cash.id), 1000);
});

test('hisob kodlari barqaror va xavfsiz; amal raqamlari g‘alati ID bilan ham ishlaydi', () => {
  assert.equal(moneyAccountCode('account-cash'), moneyAccountCode('account-cash'));
  assert.notEqual(moneyAccountCode('Kassa 1'), moneyAccountCode('kassa-1'));
  assert.match(moneyAccountCode("x'; DROP TABLE"), /^[a-z0-9_-]{2,40}$/);
  assert.match(bridgeOperationId('s', 'savdo №1 / o‘zbek'), /^bridge:s:h[0-9a-f]+$/);
  const plan = buildBridgePlan({ accounts: [], sales: [], financialEntries: [] }, today);
  assert.deepEqual(plan.entries, []);
});
