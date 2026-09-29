import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const {
  ensureLedgerSchema, ensureStandardAccounts, accountByCode, postEntry, reverseEntry, rawBalances,
  submitBlindCount, reviewDay, closeDay, verifyLedger, createAccount, listAccounts,
} = await import('../app/core/ledger-store.ts');
const { validateEntry, LedgerError } = await import('../app/core/ledger.ts');

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
let seq = 0;
const op = (name = 'op') => `${name}-${String(++seq).padStart(6, '0')}`;

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = d1(sqlite);
  await ensureLedgerSchema(db);
  const accounts = await ensureStandardAccounts(db, scope);
  const id = (code) => accountByCode(accounts, code).id;
  return { sqlite, db, id };
}
const sale = (id, amount, date = '2026-10-01', to = 'kassa') => ({ operationId: op('sale'), date, kind: 'sale', memo: 'Shaurma', actor: 'Ali', lines: [{ accountId: id(to), amount }, { accountId: id('savdo'), amount: -amount }] });

test('ochilish qoldig‘i va savdo: kassa qoldig‘i jurnaldan hisoblanadi', async () => {
  const { db, id } = await setup();
  await postEntry(db, scope, { operationId: op('open'), date: '2026-10-01', kind: 'opening', memo: '30.09 sanoq', actor: 'Otabek', lines: [{ accountId: id('kassa'), amount: 150000 }, { accountId: id('ochilish'), amount: -150000 }] });
  await postEntry(db, scope, sale(id, 7000));
  await postEntry(db, scope, sale(id, 9000, '2026-10-01', 'bank'));
  const balances = await rawBalances(db, scope);
  assert.equal(balances.get(id('kassa')), 157000);
  assert.equal(balances.get(id('bank')), 9000);
  assert.equal(balances.get(id('savdo')), -16000);
  assert.deepEqual(await verifyLedger(db, scope), { ok: true, unbalancedEntries: [], grandTotal: 0 });
});

test('muvozanatsiz, kasr yoki bir tomonli yozuv rad etiladi', async () => {
  const { db, id } = await setup();
  await assert.rejects(postEntry(db, scope, { ...sale(id, 7000), lines: [{ accountId: id('kassa'), amount: 7000 }, { accountId: id('savdo'), amount: -6999 }] }), /muvozanatda emas: \+1 ₩/);
  await assert.rejects(postEntry(db, scope, { ...sale(id, 7000), lines: [{ accountId: id('kassa'), amount: 7000.5 }, { accountId: id('savdo'), amount: -7000.5 }] }), /butun won/);
  await assert.rejects(postEntry(db, scope, { ...sale(id, 7000), lines: [{ accountId: id('kassa'), amount: 7000 }] }), /kamida ikki tomon/);
  await assert.rejects(postEntry(db, scope, { ...sale(id, 7000), lines: [{ accountId: 'begona', amount: 7000 }, { accountId: id('savdo'), amount: -7000 }] }), /Hisob topilmadi/);
  assert.equal((await rawBalances(db, scope)).size, 0, 'hech narsa yozilmadi');
});

test('bazaning o‘zi yozuvni o‘zgartirish va o‘chirishni rad etadi (kod chetlab o‘tilsa ham)', async () => {
  const { sqlite, db, id } = await setup();
  await postEntry(db, scope, sale(id, 7000));
  assert.throws(() => sqlite.exec('UPDATE v2_ledger_lines SET amount = 1'), /o'zgartirilmaydi/);
  assert.throws(() => sqlite.exec('DELETE FROM v2_ledger_lines'), /o'chirilmaydi/);
  assert.throws(() => sqlite.exec('DELETE FROM v2_ledger_entries'), /o'chirilmaydi/);
  assert.throws(() => sqlite.exec("UPDATE v2_ledger_entries SET memo = 'x'"), /o'zgartirilmaydi/);
  assert.throws(() => sqlite.exec('DELETE FROM v2_ledger_accounts'), /o'chirilmaydi/);
  assert.throws(() => sqlite.exec("UPDATE v2_ledger_accounts SET kind = 'income'"), /o'zgartirilmaydi/);
  assert.throws(() => sqlite.exec(`INSERT INTO v2_ledger_lines (id, entry_id, tenant_id, branch_id, account_id, amount) VALUES ('x', (SELECT id FROM v2_ledger_entries), 'halo', 'main', '${id('kassa')}', 0.5)`), /CHECK/);
  assert.equal((await rawBalances(db, scope)).get(id('kassa')), 7000);
});

test('xato faqat teskari yozuv bilan tuzatiladi; asl yozuv tarixda qoladi; ikki marta bekor qilinmaydi', async () => {
  const { sqlite, db, id } = await setup();
  const { entry } = await postEntry(db, scope, sale(id, 70000));
  await reverseEntry(db, scope, entry.id, { operationId: op('rev'), date: '2026-10-01', actor: 'Otabek', reason: '7 000 o‘rniga 70 000 yozilgan' });
  await postEntry(db, scope, sale(id, 7000));
  assert.equal((await rawBalances(db, scope)).get(id('kassa')), 7000);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v2_ledger_entries').get().n, 3);
  await assert.rejects(reverseEntry(db, scope, entry.id, { operationId: op('rev'), date: '2026-10-01', actor: 'Otabek', reason: 'yana' }), /allaqachon bekor qilingan/);
  await assert.rejects(reverseEntry(db, scope, entry.id, { operationId: op('rev'), date: '2026-10-01', actor: 'Otabek', reason: '' }), /sababini/);
});

test('internet uzilib qayta yuborilsa — ikki marta yozilmaydi', async () => {
  const { db, id } = await setup();
  const input = sale(id, 7000);
  const first = await postEntry(db, scope, input);
  const second = await postEntry(db, scope, input);
  assert.equal(second.alreadySaved, true);
  assert.equal(second.entry.id, first.entry.id);
  assert.equal((await rawBalances(db, scope)).get(id('kassa')), 7000);
  await assert.rejects(postEntry(db, scope, { ...input, lines: [{ accountId: id('kassa'), amount: 8000 }, { accountId: id('savdo'), amount: -8000 }] }), /boshqa yozuv allaqachon/);
});

test('ko‘r sanoq: xodim kutilgan summani ko‘rmaydi; kamomad Kassa farqi hisobiga yoziladi va kun qulflanadi', async () => {
  const { db, id } = await setup();
  await postEntry(db, scope, { operationId: op('open'), date: '2026-10-01', kind: 'opening', memo: '', actor: 'Otabek', lines: [{ accountId: id('kassa'), amount: 100000 }, { accountId: id('ochilish'), amount: -100000 }] });
  await postEntry(db, scope, sale(id, 7000));
  await postEntry(db, scope, sale(id, 9000, '2026-10-01', 'bank'));

  const receipt = await submitBlindCount(db, scope, { operationId: op('count'), date: '2026-10-01', actor: 'Ali', counts: { [id('kassa')]: 102000, [id('bank')]: 9000 } });
  assert.deepEqual(Object.keys(receipt).sort(), ['accounts', 'date', 'message', 'submittedAt']);
  assert.ok(!JSON.stringify(receipt).includes('107000'), 'kutilgan summa xodimga ko‘rsatilmaydi');

  const review = await reviewDay(db, scope, '2026-10-01');
  assert.equal(review.totalExpected, 116000);
  assert.equal(review.totalCounted, 111000);
  assert.equal(review.totalVariance, -5000);
  assert.equal(review.countedBy, 'Ali');

  await assert.rejects(closeDay(db, scope, { date: '2026-10-01', reviewer: 'Otabek', note: '', operationId: op('close') }), /farq sababini/);
  const closed = await closeDay(db, scope, { date: '2026-10-01', reviewer: 'Otabek', note: 'Qaytim xato berilgan', operationId: op('close') });
  assert.equal(closed.varianceTotal, -5000);
  const balances = await rawBalances(db, scope);
  assert.equal(balances.get(id('kassa')), 102000, 'jurnaldagi kassa = haqiqiy sanalgan pul');
  assert.equal(balances.get(id('kassa-farqi')), 5000, 'kamomad xarajat sifatida ko‘rinadi');
  assert.equal((await verifyLedger(db, scope)).ok, true);

  await assert.rejects(postEntry(db, scope, sale(id, 1000, '2026-10-01')), /yopilgan/);
  await assert.rejects(submitBlindCount(db, scope, { operationId: op('count'), date: '2026-10-01', actor: 'Ali', counts: { [id('kassa')]: 1, [id('bank')]: 0 } }), /yopilgan/);
  assert.equal((await closeDay(db, scope, { date: '2026-10-01', reviewer: 'Otabek', note: 'x', operationId: op('close') })).alreadyClosed, true);
  await postEntry(db, scope, sale(id, 1000, '2026-10-02'));
});

test('farq bo‘lmasa — farq yozuvi yaratilmaydi; ikki hisob o‘rtasidagi adashish ham to‘g‘ri tuzatiladi', async () => {
  const { db, id } = await setup();
  await postEntry(db, scope, sale(id, 7000));
  await submitBlindCount(db, scope, { operationId: op('count'), date: '2026-10-01', actor: 'Ali', counts: { [id('kassa')]: 7000, [id('bank')]: 0 } });
  const exact = await closeDay(db, scope, { date: '2026-10-01', reviewer: 'Otabek', note: '', operationId: op('close') });
  assert.equal(exact.varianceTotal, 0);
  assert.equal(exact.varianceEntryId, null);

  await postEntry(db, scope, sale(id, 5000, '2026-10-02'));
  await submitBlindCount(db, scope, { operationId: op('count'), date: '2026-10-02', actor: 'Ali', counts: { [id('kassa')]: 7000, [id('bank')]: 5000 } });
  const swapped = await closeDay(db, scope, { date: '2026-10-02', reviewer: 'Otabek', note: 'karta savdosi naqd deb kiritilgan', operationId: op('close') });
  assert.equal(swapped.varianceTotal, 0);
  const balances = await rawBalances(db, scope);
  assert.equal(balances.get(id('kassa')), 7000);
  assert.equal(balances.get(id('bank')), 5000);
  assert.equal(balances.get(id('kassa-farqi')) ?? 0, 0);
});

test('sanoqda barcha kassalar majburiy, manfiy yoki kasr summa rad etiladi', async () => {
  const { db, id } = await setup();
  await assert.rejects(submitBlindCount(db, scope, { operationId: op('count'), date: '2026-10-01', actor: 'Ali', counts: { [id('kassa')]: 1000 } }), /Bank/);
  await assert.rejects(submitBlindCount(db, scope, { operationId: op('count'), date: '2026-10-01', actor: 'Ali', counts: { [id('kassa')]: -1, [id('bank')]: 0 } }), /butun wonda/);
  await assert.rejects(submitBlindCount(db, scope, { operationId: op('count'), date: '2026-10-01', actor: 'Ali', counts: { [id('kassa')]: 10.5, [id('bank')]: 0 } }), /butun wonda/);
  await assert.rejects(reviewDay(db, scope, '2026-10-01'), /hali sanalmagan/);
});

test('ikki biznes bir bazada — bir-birining hisobini ko‘rmaydi va ishlata olmaydi', async () => {
  const { db, id } = await setup();
  const other = { tenantId: 'boshqa-kafe', branchId: 'main' };
  const otherAccounts = await ensureStandardAccounts(db, other);
  await postEntry(db, scope, sale(id, 7000));
  assert.equal((await rawBalances(db, other)).size, 0);
  await assert.rejects(postEntry(db, other, sale(id, 7000)), /Hisob topilmadi/);
  assert.equal((await listAccounts(db, other)).size, otherAccounts.size);
  await assert.rejects(ensureStandardAccounts(db, { tenantId: "X'; DROP", branchId: 'main' }), /identifikatori noto'g'ri/);
});

test('hisob qoidalari: sanaladigan hisob faqat aktiv; takror kod yo‘q', async () => {
  const { db } = await setup();
  await assert.rejects(createAccount(db, scope, { code: 'soliq', name: 'Soliq', kind: 'liability', isCash: true }), /aktiv/);
  await assert.rejects(createAccount(db, scope, { code: 'kassa', name: 'Kassa 2', kind: 'asset' }), /allaqachon bor/);
  assert.equal((await createAccount(db, scope, { code: 'kassa-2', name: 'Ikkinchi kassa', kind: 'asset', isCash: true })).isCash, true);
});

test('sof tekshiruv: noma’lum yozuv turi va izohsiz muallif rad etiladi', () => {
  const accounts = new Map([['a', { id: 'a', code: 'a', name: 'A', kind: 'asset', isCash: false, active: true }], ['b', { id: 'b', code: 'b', name: 'B', kind: 'income', isCash: false, active: true }]]);
  const base = { operationId: 'op-00000001', date: '2026-10-01', kind: 'sale', memo: '', actor: 'Ali', lines: [{ accountId: 'a', amount: 1 }, { accountId: 'b', amount: -1 }] };
  assert.doesNotThrow(() => validateEntry(base, accounts));
  assert.throws(() => validateEntry({ ...base, kind: 'hack' }, accounts), LedgerError);
  assert.throws(() => validateEntry({ ...base, actor: ' ' }, accounts), /Kim kiritgani/);
  assert.throws(() => validateEntry({ ...base, date: '2026-02-30' }, accounts), /Sana/);
});
