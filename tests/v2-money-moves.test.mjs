import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { addMoneyMove } = await import('../app/core/money-moves.ts');
const { buildBridgePlan } = await import('../app/core/bridge.ts');
const today = '2026-09-29';
const base = () => ({ accounts: [{ id: 'cash', name: 'Kassa', type: 'cash' }, { id: 'bank', name: 'Bank', type: 'bank' }], financialEntries: [] });

test('o‘tkazma va kirim: eski formatda yoziladi, ko‘prik to‘g‘ri tushunadi, takror yozilmaydi', () => {
  const op = crypto.randomUUID();
  const t = addMoneyMove(base(), { kind: 'transfer', operationId: op, accountId: 'cash', toAccountId: 'bank', amount: 300000, date: today }, today, '');
  assert.equal(t.state.financialEntries[0].type, 'transfer');
  assert.equal(addMoneyMove(t.state, { kind: 'transfer', operationId: op, accountId: 'cash', toAccountId: 'bank', amount: 300000, date: today }, today, '').result.alreadySaved, true);
  const i = addMoneyMove(t.state, { kind: 'income', incomeKind: 'owner', operationId: crypto.randomUUID(), accountId: 'cash', amount: 1000000, date: today }, today, '');
  assert.equal(i.state.financialEntries[0].affectsProfit, false, 'egasi puli foyda emas');
  const plan = buildBridgePlan(i.state, today);
  const codes = plan.entries.map((e) => e.lines.map((l) => l.code).sort().join(','));
  assert.ok(codes.some((c) => c.includes('kapital-qarz')), 'egasi puli kapital hisobiga');
  assert.equal(plan.unmatched.length, 0);
  assert.throws(() => addMoneyMove(base(), { kind: 'transfer', operationId: crypto.randomUUID(), accountId: 'cash', toAccountId: 'bank', amount: 1, date: '2026-09-28' }, today, '2026-09-28'), /yopilgan/);
  assert.throws(() => addMoneyMove(base(), { kind: 'income', incomeKind: 'other', operationId: crypto.randomUUID(), accountId: 'cash', amount: 1, date: today }, today, ''), /nimadan/);
  assert.throws(() => addMoneyMove(base(), { kind: 'transfer', operationId: crypto.randomUUID(), accountId: 'cash', toAccountId: 'bank', amount: 1, date: '2026-10-01' }, today, ''), /kelajak/);
});
