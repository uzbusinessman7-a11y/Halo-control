import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { addMezanaEntry, mezanaView } = await import('../app/api/v2/mezana/route.ts');
const { syncMezanaPosting } = await import('../app/lib/mezana-posting.ts');
const { applyRecordRemoval, removalFingerprint } = await import('../app/lib/record-removals.ts');
const { calculateAccountBalances } = await import('../app/lib/account-balances.ts');

const op = () => crypto.randomUUID();
const base = () => ({
  accounts: [{ id: 'cash', name: 'Kassa', type: 'cash', openingBalance: 100000 }],
  inventory: [], stockMovements: [], financialEntries: [], mezanaEntries: [], monthlyCloses: [], sales: [], transactions: [], suppliers: [],
  mezanaCatalog: [{ id: 'mezana-product:non', name: 'Non', mode: 'purchased', price: 1500, active: true, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }, { id: 'mezana-product:kola', name: 'Kola', mode: 'borrowed', price: 1000, active: true, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }],
});
// mutateHaloState kabi: har yozuvdan keyin MEZANA sinxronlanadi.
const apply = (s, body) => { const out = addMezanaEntry(s, body, '2026-09-29'); return syncMezanaPosting(s, out.state); };

test('olib turish, qaytarish, qarzga olish va hisobdan to‘lov — kassa to‘g‘ri kamayadi, foyda o‘zgarmaydi', async () => {
  let s = apply(base(), { action: 'borrowed', operationId: op(), catalogItemId: 'mezana-product:kola', quantity: 5, date: '2026-09-28' });
  assert.throws(() => apply(s, { action: 'returned', operationId: op(), productName: 'Kola', catalogItemId: 'mezana-product:kola', quantity: 6, date: '2026-09-28' }), /faqat 5/);
  s = apply(s, { action: 'returned', operationId: op(), catalogItemId: 'mezana-product:kola', quantity: 2, date: '2026-09-28' });
  s = apply(s, { action: 'purchased', operationId: op(), catalogItemId: 'mezana-product:non', itemCount: 20, date: '2026-09-28' });
  let v = mezanaView(s, '2026-09-29');
  assert.equal(v.debt, 30000);
  assert.deepEqual(v.borrowed, [{ name: 'Kola', quantity: 3 }]);
  assert.throws(() => apply(s, { action: 'paid', operationId: op(), amount: 40000, accountId: 'cash', date: '2026-09-29' }), /oshmasin/);
  s = apply(s, { action: 'paid', operationId: op(), amount: 30000, accountId: 'cash', date: '2026-09-29' });
  v = mezanaView(s, '2026-09-29');
  assert.equal(v.debt, 0);
  assert.equal(v.entries[0].paidFrom, 'Kassa');
  assert.equal(calculateAccountBalances(s, '2026-09-30').balances.get('cash'), 70000);
  // To'lovni olib tashlash: pul qaytadi, qarz qayta paydo bo'ladi.
  const paid = v.entries[0].id;
  const out = await applyRecordRemoval(s, { kind: 'mezana', id: paid, reason: 'xato to‘lov', operationId: 'v2rm-mezana001', expected: await removalFingerprint(s) });
  const after = syncMezanaPosting(s, out.state);
  assert.equal(mezanaView(after, '2026-09-29').debt, 30000);
  assert.equal(calculateAccountBalances(after, '2026-09-30').balances.get('cash'), 100000);
});

test('hisobsiz to‘lov (eski tartib) ham mumkin; takroriy so‘rov ikkinchi marta yozilmaydi', () => {
  let s = apply(base(), { action: 'purchased', operationId: op(), productName: 'Muz', amount: 5000, date: '2026-09-28' });
  const id = op();
  s = apply(s, { action: 'paid', operationId: id, amount: 5000, accountId: '', date: '2026-09-28' });
  const again = addMezanaEntry(s, { action: 'paid', operationId: id, amount: 5000, date: '2026-09-28' }, '2026-09-29');
  assert.equal(again.result.alreadySaved, true);
  assert.equal(s.financialEntries.filter((e) => e.category === 'MEZANA to‘lovi').length, 0);
});
