import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { ensureLedgerSchema, ensureStandardAccounts, createAccount, accountByCode, postEntry, rawBalances, recordSettlement, receivablesReport, verifyLedger } = await import('../app/core/ledger-store.ts');

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
let n = 0;
const op = (p) => `${p}-${String(++n).padStart(6, '0')}`;

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  const db = d1(sqlite);
  await ensureLedgerSchema(db);
  await ensureStandardAccounts(db, scope);
  await createAccount(db, scope, { code: 'karta', name: 'Karta / POS', kind: 'asset' });
  await createAccount(db, scope, { code: 'baemin', name: 'Baemin', kind: 'asset' });
  const { listAccounts } = await import('../app/core/ledger-store.ts');
  const accounts = await listAccounts(db, scope);
  const id = (code) => accountByCode(accounts, code).id;
  const sale = (to, amount, date) => postEntry(db, scope, { operationId: op('sale'), date, kind: 'sale', memo: '', actor: 'Ali', lines: [{ accountId: id(to), amount }, { accountId: id('savdo'), amount: -amount }] });
  return { db, id, sale };
}

test('karta puli bankka tushadi: bank + komissiya = kartadan chiqqan, won‘igacha', async () => {
  const { db, id, sale } = await setup();
  await sale('karta', 100000, '2026-10-01');
  await sale('karta', 50000, '2026-10-02');
  await recordSettlement(db, scope, { operationId: op('set'), date: '2026-10-03', actor: 'Otabek', fromAccountId: id('karta'), toAccountId: id('bank'), received: 97000, fee: 3000 });
  const b = await rawBalances(db, scope);
  assert.equal(b.get(id('bank')), 97000);
  assert.equal(b.get(id('komissiya')), 3000);
  assert.equal(b.get(id('karta')), 50000, '2-oktyabr savdosi hali tushmagan');
  assert.equal((await verifyLedger(db, scope)).ok, true);
  const [card] = await receivablesReport(db, scope, [id('karta')], '2026-10-05');
  assert.equal(card.outstanding, 50000);
  assert.equal(card.oldestUnsettledDate, '2026-10-02');
  assert.equal(card.ageDays, 3);
});

test('delivery platforma: bir nechta savdo bitta o‘tkazmada, qisman to‘lov ham hisobga olinadi', async () => {
  const { db, id, sale } = await setup();
  await sale('baemin', 20000, '2026-10-01');
  await sale('baemin', 30000, '2026-10-02');
  await sale('baemin', 10000, '2026-10-03');
  await recordSettlement(db, scope, { operationId: op('set'), date: '2026-10-08', actor: 'Otabek', fromAccountId: id('baemin'), toAccountId: id('bank'), received: 25000, fee: 5000 });
  const [row] = await receivablesReport(db, scope, [id('baemin')], '2026-10-08');
  assert.equal(row.outstanding, 30000);
  assert.equal(row.oldestUnsettledDate, '2026-10-02', '1-oktyabr to‘liq yopildi, 2-oktyabr qisman');
  assert.equal(row.ageDays, 6);
});

test('hammasi tushgan bo‘lsa — kutilayotgan pul 0, sana yo‘q', async () => {
  const { db, id, sale } = await setup();
  await sale('karta', 10000, '2026-10-01');
  await recordSettlement(db, scope, { operationId: op('set'), date: '2026-10-02', actor: 'Otabek', fromAccountId: id('karta'), toAccountId: id('bank'), received: 10000, fee: 0 });
  const [row] = await receivablesReport(db, scope, [id('karta')], '2026-10-02');
  assert.deepEqual([row.outstanding, row.oldestUnsettledDate, row.ageDays], [0, null, null]);
});

test('noto‘g‘ri kiritish rad etiladi', async () => {
  const { db, id } = await setup();
  const base = { operationId: op('set'), date: '2026-10-02', actor: 'Otabek', fromAccountId: id('karta'), toAccountId: id('bank'), received: 1000, fee: 0 };
  await assert.rejects(recordSettlement(db, scope, { ...base, toAccountId: id('karta') }), /o'ziga/);
  await assert.rejects(recordSettlement(db, scope, { ...base, received: -1 }), /butun wonda/);
  await assert.rejects(recordSettlement(db, scope, { ...base, fee: 1.5 }), /Komissiya/);
  await assert.rejects(recordSettlement(db, scope, { ...base, received: 0, fee: 0 }), /0 dan katta/);
  await assert.rejects(recordSettlement(db, scope, { ...base, toAccountId: id('savdo') }), /aktiv/);
});
