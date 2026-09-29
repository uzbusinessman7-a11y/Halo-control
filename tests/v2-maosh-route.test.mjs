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

test('xodim qo‘shish, qo‘lda smena, bonus va avans (kassadan) — hisob varaqasiga tushadi', async () => {
  const call = async (body) => { const r = await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: r.status, body: await r.json() }; };
  const payload = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  payload.accounts = [{ id: 'cash', name: 'Naqd', type: 'cash', openingBalance: 0 }];
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(payload));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const month = today.slice(0, 7);
  const created = await call({ action: 'saveStaff', operationId: crypto.randomUUID(), name: 'Lola', payType: 'hourly', hourlyRate: 11000, workDays: 26, dailyHours: 8, overtimeAfterHours: 8, overtimeMultiplier: 1 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const lola = created.body.staff.find((m) => m.name === 'Lola');
  assert.equal((await call({ action: 'saveStaff', operationId: crypto.randomUUID(), name: 'lola', payType: 'hourly', hourlyRate: 1 })).status, 409, 'bir xil ism');
  const shift = await call({ action: 'shift', operationId: crypto.randomUUID(), staffId: lola.id, date: today, from: '10:00', to: '18:00' });
  assert.equal(shift.status, 200, JSON.stringify(shift.body));
  assert.equal((await call({ action: 'shift', operationId: crypto.randomUUID(), staffId: lola.id, date: today, from: '12:00', to: '14:00' })).status, 409, 'ustma-ust smena');
  assert.equal((await call({ action: 'adjust', operationId: crypto.randomUUID(), staffId: lola.id, type: 'advance', amount: 1000, date: today, note: 'avans' })).status, 400, 'pulsiz avans yo‘q');
  assert.equal((await call({ action: 'adjust', operationId: crypto.randomUUID(), staffId: lola.id, type: 'bonus', amount: 12000, date: today, note: 'Yaxshi ish' })).status, 200);
  assert.equal((await call({ action: 'pay', operationId: crypto.randomUUID(), staffId: lola.id, kind: 'advance', amount: 50000, accountId: 'cash', month, date: today })).status, 200);
  const list = await call({ month });
  const emp = list.body.employees.find((e) => e.name === 'Lola');
  assert.equal(emp.current.earned, 88000, '8 soat × 11 000');
  assert.equal(emp.current.bonus, 12000);
  assert.equal(emp.current.paid, 50000);
  assert.equal(emp.current.ledgerRemaining, 88000 + 12000 - 50000);
  assert.equal(emp.current.difference, 0, 'eski hisob bilan mos');
  const st = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  assert.ok(st.financialEntries.some((f) => f.category === 'Maosh to‘lovi' && f.amount === 50000 && f.accountId === 'cash'), 'avans kassadan chiqim bo‘lib yozildi');
});
