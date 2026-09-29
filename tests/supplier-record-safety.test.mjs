import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { confirmSupplierDuplicate, verifySupplierWrite } from '../app/lib/supplier-record-safety.ts';

const purchase = () => ({ id: 'sauce-198000', supplierId: 'nodir', type: 'purchase', amount: 198000, date: '2026-09-27', note: 'SOUS' });

test('supplier duplicate guard requires confirmation for same date, supplier, type and amount', () => {
  const original = purchase(), state = { transactions: [original] }, next = { ...original, id: 'second' };
  assert.throws(() => confirmSupplierDuplicate(state, next), (e) => e.code === 'SIMILAR_SUPPLIER_TRANSACTION' && e.duplicate.id === original.id);
  assert.throws(() => confirmSupplierDuplicate(state, { ...next, note: 'boshqa matn' }, 'ha'), /tasdiqlang/);
  const accepted = confirmSupplierDuplicate(state, next, 'Ikkinchi alohida yetkazma, yana sous keldi');
  assert.equal(accepted.duplicateOf, original.id);
  assert.ok(accepted.duplicateConfirmedAt);
  for (const diff of [{ supplierId: 'other' }, { date: '2026-09-23' }, { amount: 198001 }, { type: 'payment' }]) assert.deepEqual(confirmSupplierDuplicate(state, { ...next, ...diff }), {});
  assert.throws(() => confirmSupplierDuplicate(state, { ...next, date: '2026-09-26' }), /2026-09-27/);
  assert.deepEqual(state.transactions, [original]);
});

test('supplier retries are idempotent, changed request IDs and stale edits are rejected', () => {
  const original = { ...purchase(), supplierLedgerOnly: true, recordedAt: '2026-09-27T01:00:00Z' }, state = { transactions: [original] };
  assert.equal(verifySupplierWrite(state, purchase(), {}).alreadySaved, true);
  assert.throws(() => verifySupplierWrite(state, { ...purchase(), amount: 199000 }, {}), /ID/);
  assert.throws(() => verifySupplierWrite(state, { ...purchase(), amount: 199000 }, { edit: true, expectedTransaction: purchase() }), /boshqa qurilmada/);
  assert.equal(verifySupplierWrite(state, { ...purchase(), amount: 199000 }, { edit: true, expectedTransaction: structuredClone(original) }).alreadySaved, false);
  const linked = { ...original, intakeId: 'legacy-intake', intakeLines: [{ name: 'SOUS' }] };
  assert.throws(() => verifySupplierWrite({ transactions: [linked] }, { ...purchase(), amount: 199000 }, { edit: true, expectedTransaction: linked }), /Ombor kirimlari/);
  assert.throws(() => verifySupplierWrite({ transactions: [], deletedItems: [{ record: original }] }, purchase(), {}), /bekor/);
});

test('built supplier API: ledger-only debt, paid purchases, duplicate confirmation and safe edits', async () => {
  const sql = new DatabaseSync(':memory:');
  const db = { prepare(query) { let values = []; return { bind(...v) { values = v; return this; }, async first(column) { const r = sql.prepare(query).get(...values); return column ? r?.[column] ?? null : r ?? null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } }; } }; }, async batch(q) { const out = []; for (const s of q) out.push(await s.run()); return out; }, async exec(s) { sql.exec(s); return { count: 1, duration: 0 }; } };
  const { default: worker } = await import('../dist/server/index.js');
  const env = { DB: db, ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
  const call = (body, owner = true) => worker.fetch(new Request(`http://localhost${body ? '/api/supplier-records' : '/api/worker-auth?bootstrap=1'}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(owner ? { 'oai-authenticated-user-email': 'owner@supplier-local-test.invalid' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil() {}, passThroughOnException() {} });
  const read = () => JSON.parse(sql.prepare('SELECT payload FROM app_state WHERE id=?').get('main').payload);
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-09-27T08:00:00Z'])); } static now() { return RealDate.parse('2026-09-27T08:00:00Z'); } };
  try {
    await call();
    const seed = { ...read(), suppliers: [{ id: 'nodir', name: 'Nodir aka', openingBalance: 0, balance: 0 }], accounts: [{ id: 'cash', name: 'Kassa' }], transactions: [], financialEntries: [], inventory: [{ id: 'sauce', name: 'SOUS', unit: 'g', stock: 4000, unitCost: 49.5 }], stockMovements: [], vegetablePurchases: [], vegetableExpenseVersion: 1, vegetableExpenseStartedAt: '2026-09-01T00:00:00Z', deletedItems: [], monthlyCloses: [] };
    sql.prepare('UPDATE app_state SET payload=?,updated_at=? WHERE id=?').run(JSON.stringify(seed), 'seed', 'main');
    const save = { action: 'saveTransaction', transaction: purchase() };
    assert.equal((await call(save, false)).status, 401);
    let r = await call(save); assert.equal(r.status, 200, await r.clone().text());
    assert.equal(read().suppliers[0].balance, 198000); assert.equal(read().financialEntries.length, 0); assert.equal(read().inventory[0].stock, 4000);
    r = await call(save); assert.equal((await r.json()).alreadySaved, true); assert.equal(read().transactions.length, 1);
    r = await call({ ...save, transaction: { ...purchase(), amount: 198001 } }); assert.equal(r.status, 409); assert.equal(read().suppliers[0].balance, 198000);
    const repeated = { ...save, transaction: { ...purchase(), id: 'second-sauce' } };
    r = await call(repeated); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'SIMILAR_SUPPLIER_TRANSACTION'); assert.equal(read().transactions.length, 1);
    r = await call({ ...repeated, duplicateReason: 'Ikkinchi alohida yetkazma' }); assert.equal(r.status, 200, await r.clone().text()); assert.equal(read().suppliers[0].balance, 396000);
    const stored = read().transactions.find((t) => t.id === 'second-sauce');
    assert.equal(stored.duplicateOf, 'sauce-198000');
    r = await call({ ...repeated, transaction: { ...repeated.transaction, amount: 100000 }, edit: true, expectedTransaction: stored }); assert.equal(r.status, 200, await r.clone().text()); assert.equal(read().suppliers[0].balance, 298000);
    r = await call({ ...repeated, transaction: { ...repeated.transaction, amount: 90000 }, edit: true, expectedTransaction: stored }); assert.equal(r.status, 409); assert.equal(read().suppliers[0].balance, 298000);
    for (const diff of [{ amount: 198000.00001 }, { date: '2026-02-30' }, { date: '2026-09-28' }]) {
      r = await call({ ...save, transaction: { ...purchase(), id: 'invalid', ...diff } }); assert.equal(r.status, 400);
    }
    const paid = { action: 'savePurchaseAndPayment', accountId: 'cash', transaction: { ...purchase(), id: 'cash-purchase', amount: 50000, note: 'Naqd xarid' } };
    r = await call(paid); assert.equal(r.status, 200, await r.clone().text()); assert.equal(read().suppliers[0].balance, 298000);
    assert.equal(read().financialEntries.length, 1); assert.equal(read().financialEntries[0].amount, 50000); assert.equal(read().financialEntries[0].affectsProfit, false); assert.equal(read().inventory[0].stock, 4000);
    r = await call(paid); assert.equal((await r.json()).alreadySaved, true); assert.equal(read().financialEntries.length, 1);
    r = await call({ ...paid, transaction: { ...paid.transaction, amount: 50001 } }); assert.equal(r.status, 409); assert.equal(read().financialEntries[0].amount, 50000);
    const full = { action: 'payFullDebt', operationId: 'full-pay-1', supplierId: 'nodir', accountId: 'cash', date: '2026-09-27' };
    r = await call(full); assert.equal(r.status, 200, await r.clone().text()); assert.equal(read().suppliers[0].balance, 0);
    r = await call(full); assert.equal((await r.json()).alreadySaved, true);
    assert.equal(read().financialEntries.reduce((n, e) => n + e.amount, 0), 348000);
    assert.ok(read().financialEntries.every((e) => e.affectsProfit === false));
    assert.deepEqual(read().stockMovements, []); assert.deepEqual(read().vegetablePurchases, []);
  } finally { globalThis.Date = RealDate; sql.close(); delete globalThis.__HALO_CONTROL_DB__; }
});
