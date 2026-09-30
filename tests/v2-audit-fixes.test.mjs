import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { runBridge } = await import('../app/core/bridge-sync.ts');
const { moneyAccountCode } = await import('../app/core/bridge.ts');
const { recordSettlement } = await import('../app/core/ledger-store.ts');
const { assertV2DayOpen, ClosedDayError } = await import('../app/core/closed-days.ts');

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  const make = (query, params = []) => ({ bind: (...v) => make(query, v), all: async () => ({ results: sqlite.prepare(query).all(...params) }), first: async () => sqlite.prepare(query).get(...params) ?? null, run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(query).run(...params) });
  const db = { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  globalThis.__HALO_CONTROL_DB__ = db; globalThis.__HALO_SELF_HOSTED__ = true;
  return { sqlite, db };
}
const scope = { tenantId: 'halo', branchId: 'main' };
const acc = (old) => `halo:main:${moneyAccountCode(old)}`;
const state = (sales) => ({
  accounts: [{ id: 'card', name: 'Karta', type: 'card', openingBalance: 0 }, { id: 'bank', name: 'Bank', type: 'bank', openingBalance: 0 }],
  costRules: { taxPct: 0, cardCommissionPct: 0 }, sales, financialEntries: [],
});

test('karta puli bankka tushgach ham eski tizim bilan solishtirish buzilmaydi', async () => {
  const { db } = setup();
  const s = state([{ id: 's1', date: '2026-10-01', totalRevenue: 10000, quantity: 1, accountId: 'card', taxPctAtSale: 0, cardCommissionPctAtSale: 0, accountTypeAtSale: 'card' }]);
  assert.equal((await runBridge(db, scope, s, '2026-10-02')).ok, true);
  await recordSettlement(db, scope, { operationId: 'settle-0000001', date: '2026-10-02', actor: 'Rahbar', fromAccountId: acc('card'), toAccountId: acc('bank'), received: 9800, fee: 200, memo: '' });
  const r = await runBridge(db, scope, s, '2026-10-02');
  assert.equal(r.ok, true, JSON.stringify(r.comparison));
});

test('bekor qilingan savdo o‘z kunidan chiqadi (bugungi savdoni kamaytirmaydi)', async () => {
  const { db, sqlite } = setup();
  const sale = { id: 's1', date: '2026-10-01', totalRevenue: 10000, quantity: 1, accountId: 'card', taxPctAtSale: 0, cardCommissionPctAtSale: 0, accountTypeAtSale: 'card' };
  await runBridge(db, scope, state([sale]), '2026-10-03');
  await runBridge(db, scope, state([]), '2026-10-03');
  const rev = sqlite.prepare("SELECT date FROM v2_ledger_entries WHERE kind = 'reversal'").get();
  assert.equal(rev.date, '2026-10-01');
});

test('yopilgan kunga pul yozuvi kiritilmaydi', async () => {
  const { db, sqlite } = setup();
  await runBridge(db, scope, state([]), '2026-10-03');
  sqlite.prepare("INSERT INTO v2_cash_counts (id, tenant_id, branch_id, operation_id, date, actor, counts_json, submitted_at) VALUES ('c1','halo','main','op-count-1','2026-10-02','Ali','{}','2026-10-02T10:00:00Z')").run();
  sqlite.prepare("INSERT INTO v2_day_closes (id, tenant_id, branch_id, date, count_id, review_json, variance_total, reviewer, note, closed_at) VALUES ('d1','halo','main','2026-10-02','c1','{}',0,'Rahbar','','2026-10-02T11:00:00Z')").run();
  await assert.rejects(() => assertV2DayOpen('main', '2026-10-01'), ClosedDayError);
  await assert.rejects(() => assertV2DayOpen('main', ['2026-10-03', '2026-10-02']), ClosedDayError);
  await assertV2DayOpen('main', '2026-10-03');
});
