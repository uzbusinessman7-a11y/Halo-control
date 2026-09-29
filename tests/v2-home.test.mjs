import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { homeReport, flashText } = await import('../app/core/home.ts');
const { GET, POST } = await import('../app/api/v2/bosh/route.ts');

function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; },
    _exec: () => sqlite.prepare(query).run(...params),
  });
  return { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
}
const scope = { tenantId: 'halo', branchId: 'main' };
const today = '2026-09-29';
const state = () => ({
  accounts: [
    { id: 'cash', name: 'Naqd kassa', type: 'cash', openingBalance: 0 },
    { id: 'card', name: 'Karta / POS', type: 'card', openingBalance: 0 },
  ],
  sales: [
    { id: 's1', date: '2026-09-28', totalRevenue: 500000, accountId: 'card' },
    { id: 's2', date: '2026-09-21', totalRevenue: 400000, accountId: 'cash' },
    { id: 's3', date: '2026-09-10', totalRevenue: 100000, accountId: 'cash' },
    { id: 's4', date: '2026-08-10', totalRevenue: 800000, accountId: 'cash' },
  ],
  inventory: [{ id: 'goosht', name: 'Go‘sht', unit: 'g', stock: 4000, unitCost: 15 }],
  stockMovements: [
    { id: 'r1', inventoryId: 'goosht', type: 'receipt', quantity: 5000, unitCost: 15, date: '2026-08-20' },
    { id: 'x1', inventoryId: 'goosht', type: 'sale', quantity: -600, theoreticalQuantity: 600, date: '2026-09-10' },
    { id: 'w1', inventoryId: 'goosht', type: 'waste', quantity: -100, date: '2026-09-12' },
    { id: 'c1', inventoryId: 'goosht', type: 'adjustment', quantity: -300, date: '2026-09-20', referenceId: 'inventory-count:a' },
  ],
  suppliers: [{ id: 'n', name: 'Nodir aka', openingBalance: 0, balance: 200000 }],
  transactions: [{ id: 't1', supplierId: 'n', type: 'purchase', amount: 200000, date: '2026-08-01' }],
  staff: [{ id: 'a', name: 'Aziz', payType: 'hourly', hourlyRate: 10000, dailyHours: 8, overtimeAfterHours: 8, overtimeMultiplier: 1 }],
  workShifts: [{ id: 'sh', staffId: 'a', date: '2026-09-01', clockIn: '2026-09-01T01:00:00.000Z', clockOut: '2026-09-01T09:00:00.000Z', hourlyRateAtShift: 10000, source: 'owner', status: 'closed' }],
});

test('bosh ekran: savdo, prime cost, pul, qarz va ogohlantirishlar bitta hisobotda', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const db = d1(sqlite);
  const r = await homeReport(db, scope, state(), today, new Date('2026-09-29T03:00:00Z'));
  assert.equal(r.sales.yesterday, 500000);
  assert.equal(r.sales.weekAgo, 400000);
  assert.equal(r.sales.monthToDate, 1_000_000);
  assert.equal(r.sales.lastMonthSamePeriod, 800000);
  assert.equal(r.prime.theoreticalFood, 9000, '600 g × 15');
  assert.equal(r.prime.waste, 1500);
  assert.equal(r.prime.countLoss, 4500);
  assert.equal(r.prime.food, 15000);
  assert.equal(r.prime.labor, 80000);
  assert.equal(r.prime.primePercent, 9.5);
  assert.equal(r.money.receivable, 500000);
  assert.equal(r.debts.total, 200000);
  assert.equal(r.debts.overdueCount, 1);
  assert.ok(r.alerts.some((a) => a.page === 'ombor' && /kamomadi/.test(a.text)));
  assert.ok(r.alerts.some((a) => a.page === 'qarz' && /30 kundan/.test(a.text)));
  assert.equal(r.alerts[0].level, 'bad', 'qizillar birinchi');
  const text = flashText(r, 'HALO Test');
  assert.match(text, /HALO Test — 28\.09 hisobot/);
  assert.match(text, /Kecha savdo: 500,000 ₩ \(\+25%\)/);
  assert.match(text, /Prime cost: 9\.5%/);
  const again = await homeReport(db, scope, state(), today, new Date('2026-09-29T03:00:00Z'));
  assert.equal(again.sales.monthToDate, 1_000_000, 'qayta ochilganda ikki marta yozilmaydi');
});

test('sahifa: faqat rahbar, skript to‘g‘ri; Telegram ulanmagan bo‘lsa aniq xabar', async () => {
  const sqlite = new DatabaseSync(':memory:');
  globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
  globalThis.__HALO_SELF_HOSTED__ = true;
  const url = 'https://halo.example.workers.dev/api/v2/bosh';
  const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
  assert.equal((await GET(new Request(url))).status, 303);
  assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 401);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const res = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main' }) }))).json();
  assert.equal(res.ok, true);
  assert.match(res.text, /hisobot/);
  const tg = await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', action: 'telegram' }) }));
  assert.equal(tg.status, 400);
  assert.match((await tg.json()).error, /Telegram bot hali ulanmagan/);
});
