import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const { GET, POST } = await import('../app/api/v2/maosh/route.ts');
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
const url = 'https://halo.example.workers.dev/api/v2/maosh';
const owner = { 'oai-authenticated-user-email': 'owner@example.com', 'content-type': 'application/json' };
const sqlite = new DatabaseSync(':memory:');
globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
globalThis.__HALO_SELF_HOSTED__ = true;

test('faqat rahbar; xodimlar ro‘yxati, nazorat va hisob varaqasi', async () => {
  assert.equal((await GET(new Request(url))).status, 303);
  assert.equal((await POST(new Request(url, { method: 'POST', body: '{}' }))).status, 401);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const payload = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  payload.staff = [{ id: 'a', name: 'Aziz', payType: 'hourly', hourlyRate: 10000, dailyHours: 8, overtimeAfterHours: 8, overtimeMultiplier: 1 }];
  payload.workShifts = [{ id: 's', staffId: 'a', date: '2026-09-01', clockIn: '2026-09-01T01:00:00.000Z', clockOut: '2026-09-01T09:00:00.000Z', hourlyRateAtShift: 10000, source: 'owner', status: 'closed' }];
  payload.payrollAdjustments = [{ id: 'j', staffId: 'a', date: '2026-09-02', type: 'advance', amount: 20000, note: '', voided: false }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(payload));
  const list = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', month: '2026-09' }) }))).json();
  assert.equal(list.ok, true);
  assert.equal(list.employees[0].current.ledgerRemaining, 60000);
  assert.equal(list.checks.mismatched, 0);
  assert.equal(list.checks.advancesWithoutCash, 1);
  const slip = await (await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', month: '2026-09', action: 'payslip', employeeId: list.employees[0].employeeId }) }))).json();
  assert.equal(slip.payslip.remaining, 60000);
  assert.match(slip.text, /To'lanishi kerak: 60,000 ₩/);
});
