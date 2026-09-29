import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { runDebtBridge } = await import('../app/core/debt-bridge.ts');
const { statement, statementText } = await import('../app/core/debts.ts');
const { auditSupplierBalances } = await import('../app/lib/supplier-transactions.ts');

function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => sqlite.prepare(query).run(...params),
    _exec: () => sqlite.prepare(query).run(...params),
  });
  return { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
}
const scope = { tenantId: 'halo', branchId: 'main' };
const today = '2026-09-30';
const state = () => ({
  suppliers: [
    { id: 'nodir', name: 'Nodir aka', openingBalance: 150000, balance: 150000 + 198000 + 250000 - 300000 },
    { id: 'coupang', name: 'Coupang', openingBalance: 0, balance: 12000 },
    { id: 'mz', name: 'MEZANA', openingBalance: 0, balance: 5000 },
  ],
  transactions: [
    { id: 't1', supplierId: 'nodir', type: 'purchase', amount: 198000, date: '2026-09-05', note: 'Sous 30 kg' },
    { id: 't2', supplierId: 'nodir', type: 'purchase', amount: 250000, date: '2026-09-20' },
    { id: 't3', supplierId: 'nodir', type: 'payment', amount: 300000, date: '2026-09-25' },
    { id: 't4', supplierId: 'coupang', type: 'purchase', amount: 10000, date: '2026-09-10' },
  ],
});
async function db() { const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON'); return { sqlite, db: d1(sqlite) }; }

test('har bir yetkazuvchi qoldig‘i eski tizim bilan solishtiriladi; farq va MEZANA to‘g‘ri ajratiladi', async () => {
  const { db: database } = await db();
  const s = state();
  const report = await runDebtBridge(database, scope, s, today);
  const byName = new Map(report.parties.map((p) => [p.name, p]));
  assert.equal(byName.get('Nodir aka').ledgerBalance, 298000);
  assert.equal(byName.get('Nodir aka').difference, 0);
  assert.equal(byName.get('Coupang').difference, -2000, 'saqlangan 12 000, tarix bo‘yicha 10 000');
  assert.equal(byName.has('MEZANA'), false);
  assert.equal(report.mismatched, 1);
  const old = auditSupplierBalances(s.suppliers, s.transactions);
  assert.equal(old.find((a) => a.supplierId === 'coupang').difference !== 0, true, 'eski audit ham shu farqni ko‘radi');
  assert.equal(byName.get('Nodir aka').oldestUnpaidDate, '2026-09-05', 'FIFO: 300 000 to‘lov 150 000 boshlang‘ich + 150 000 ni yopdi');
});

test('solishtirish akti: davr boshidagi qarz, har bir qator, yakuniy qarz va yuborish matni', async () => {
  const { db: database } = await db();
  const report = await runDebtBridge(database, scope, state(), today);
  const nodir = report.parties.find((p) => p.name === 'Nodir aka');
  const st = await statement(database, scope, nodir.partyId, '2026-09-10', '2026-09-30');
  assert.equal(st.opening, 348000);
  assert.deepEqual(st.lines.map((l) => [l.date, l.amount, l.balance]), [['2026-09-20', 250000, 598000], ['2026-09-25', -300000, 298000]]);
  assert.equal(st.closing, 298000);
  const text = statementText(st);
  assert.match(text, /Nodir aka bilan solishtirish akti/);
  assert.match(text, /30\.09\.2026 holatiga qarz: 298,000 ₩/);
  assert.match(text, /\+ 20\.09\.2026 Xarid: 250,000 ₩/);
  assert.match(text, /− 25\.09\.2026 To'lov: 300,000 ₩/);
});

test('ochilish qoldig‘i keyin tuzatilsa — eski qiymat saqlanadi, farqi sababi bilan tuzatish yozuvi', async () => {
  const { db: database, sqlite } = await db();
  const s = state();
  await runDebtBridge(database, scope, s, today);
  s.suppliers[0].openingBalance = 120000;
  s.suppliers[0].balance -= 30000;
  s.suppliers[0].balanceEdits = [{ reason: 'Nodir aka daftari bilan solishtirildi' }];
  const report = await runDebtBridge(database, scope, s, today);
  assert.equal(report.parties.find((p) => p.name === 'Nodir aka').difference, 0);
  const adj = sqlite.prepare("SELECT amount, memo FROM v2_party_moves WHERE kind = 'adjustment'").get();
  assert.equal(adj.amount, -30000);
  assert.match(adj.memo, /150,000 → 120,000 ₩ · Nodir aka daftari bilan solishtirildi/);
  assert.equal((await runDebtBridge(database, scope, s, today)).posted, 0, 'qayta — takror yo‘q');
});

test('o‘chirilgan to‘lov teskari yoziladi; o‘zgartirilgan jim o‘tmaydi; baza yozuvni himoya qiladi', async () => {
  const { db: database, sqlite } = await db();
  const s = state();
  await runDebtBridge(database, scope, s, today);
  s.transactions = s.transactions.filter((t) => t.id !== 't3');
  s.transactions[0].amount = 199000;
  const report = await runDebtBridge(database, scope, s, today);
  assert.deepEqual(report.changed, ['qarz:t1']);
  assert.equal(report.corrected, 1);
  assert.equal(report.reversed, 2, 'o‘chirilgan to‘lov + o‘zgartirilgan xaridning eski versiyasi');
  assert.throws(() => sqlite.exec('UPDATE v2_party_moves SET amount = 1'), /o'zgartirilmaydi/);
  assert.throws(() => sqlite.exec('DELETE FROM v2_party_moves'), /o'chirilmaydi/);
});
