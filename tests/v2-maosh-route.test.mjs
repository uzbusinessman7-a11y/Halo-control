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

test('ishlagan kunlar: rahbar bir nechta kunni birdaniga kiritadi — hammasi yoki hech biri; ikki marta yozilmaydi', async () => {
  const call = async (body) => { const r = await POST(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ branchId: 'main', ...body }) })); return { status: r.status, body: await r.json() }; };
  const seoul = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
  const day = (n) => seoul(new Date(Date.now() - n * 86_400_000));
  const state = () => JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  const created = await call({ action: 'saveStaff', operationId: crypto.randomUUID(), name: 'Vali', payType: 'hourly', hourlyRate: 10000, workDays: 26, dailyHours: 8, overtimeAfterHours: 12, overtimeMultiplier: 1 });
  const vali = created.body.staff.find((m) => m.name === 'Vali');
  const mine = () => state().workShifts.filter((shift) => shift.staffId === vali.id && shift.status !== 'void');

  const op = crypto.randomUUID();
  const body = { action: 'shifts', operationId: op, staffId: vali.id, dates: [day(0), day(2), day(1), day(1)], from: '10:00', to: '20:00', breakMinutes: 60, note: 'daftardan' };
  const saved = await call(body);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(mine().map((shift) => shift.date).sort(), [day(2), day(1), day(0)], 'takror sana bir marta');
  for (const shift of mine()) {
    assert.deepEqual([(Date.parse(shift.clockOut) - Date.parse(shift.clockIn)) / 3_600_000, shift.breakMinutes, shift.hourlyRateAtShift, shift.source, shift.status, shift.note], [10, 60, 10000, 'owner', 'closed', 'daftardan']);
    assert.equal(new Date(shift.clockIn).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }), '10:00', 'vaqt Seul bo‘yicha');
  }
  // Hisob varaqasi: har kun 9 soat × 10 000 ₩.
  const month = day(0).slice(0, 7);
  const inMonth = mine().filter((shift) => shift.date.startsWith(month)).length;
  const list = (await call({ month })).body;
  const current = list.employees.find((e) => e.name === 'Vali').current;
  assert.deepEqual([current.workedDays, current.earned], [inMonth, inMonth * 90000]);
  assert.equal(list.checks.mismatched, 0);

  // Tugma ikki marta bosilsa — ikkinchisi yozilmaydi.
  assert.equal((await call(body)).status, 200);
  assert.equal(mine().length, 3);
  // Bitta kun xato bo'lsa — hech biri yozilmaydi va qaysi kunligi aytiladi.
  const clash = await call({ ...body, operationId: crypto.randomUUID(), dates: [day(3), day(0)] });
  assert.equal(clash.status, 409);
  assert.match(clash.body.error, new RegExp(`^${day(0)}: Bu vaqtda xodimning boshqa smenasi bor`), 'shu kunga shu vaqtda ikkinchi marta yozilmaydi');
  assert.equal(mine().length, 3, 'day(3) ham yozilmadi');
  // Dam/kasal/kelmadi deb belgilangan kun — ishlagan kun bo'lmaydi.
  assert.equal((await call({ action: 'dayStatus', operationId: crypto.randomUUID(), staffId: vali.id, date: day(3), status: 'sick', payMode: 'unpaid' })).status, 200);
  const sick = await call({ ...body, operationId: crypto.randomUUID(), dates: [day(4), day(3)] });
  assert.equal(sick.status, 409);
  assert.match(sick.body.error, new RegExp(`^${day(3)}: bu kun «kasal» deb belgilangan`));
  assert.equal(mine().length, 3);
  // Noto'g'ri so'rovlar.
  const tomorrow = seoul(new Date(Date.now() + 86_400_000));
  const future = await call({ ...body, operationId: crypto.randomUUID(), dates: [day(4), tomorrow] });
  assert.equal(future.status, 400);
  assert.match(future.body.error, new RegExp(`^${tomorrow}: Sanani tekshiring`));
  assert.equal((await call({ ...body, operationId: crypto.randomUUID(), dates: [] })).status, 400);
  assert.equal((await call({ ...body, operationId: crypto.randomUUID(), dates: Array.from({ length: 32 }, (_, i) => day(40 + i)) })).status, 400);
  assert.equal((await call({ ...body, operationId: crypto.randomUUID(), dates: ['2026-13-45x'] })).status, 400);
  assert.equal((await call({ ...body, operationId: crypto.randomUUID(), staffId: 'yoq', dates: [day(4)] })).status, 400);
  assert.equal((await call({ ...body, operationId: crypto.randomUUID(), dates: [day(4)], from: '10:00', to: '09:00' })).status, 400, '23 soatlik smena bo‘lmaydi');
  assert.equal(mine().length, 3);
  // Tungi smena (ertasi kuni tugaydi) ketma-ket kunlarda ustma-ust tushmaydi.
  const night = await call({ ...body, operationId: crypto.randomUUID(), dates: [day(5), day(4)], from: '22:00', to: '06:00', breakMinutes: 0, note: '' });
  assert.equal(night.status, 200, JSON.stringify(night.body));
  assert.equal(mine().length, 5);
  assert.equal(mine().find((shift) => shift.date === day(5)).note, "Rahbar qo'lda kiritdi");
  // Kiritilgan kun oddiy smena: avvalgidek tuzatiladi va bekor qilinadi.
  const one = mine().find((shift) => shift.date === day(5));
  assert.equal((await call({ action: 'voidShift', id: one.id, reason: 'xato kun' })).status, 200);
  assert.equal(mine().length, 4);
  const again = await call({ ...body, operationId: crypto.randomUUID(), dates: [day(5)], from: '10:00', to: '18:00', breakMinutes: 0 });
  assert.equal(again.status, 200, 'bekor qilingan kun qayta kiritiladi');
  assert.equal(mine().length, 5);
  // Bir kunda ikki smena (masalan, kunduzi va kechqurun) — vaqti ustma-ust tushmasa shu oynadan kiritiladi.
  // (Alohida «＋ Smena» tugmasi yo'q: smena kiritishning bitta yo'li — «Ishlagan kunlar».)
  const second = await call({ ...body, operationId: crypto.randomUUID(), dates: [day(5)], from: '19:00', to: '22:00', breakMinutes: 0 });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(mine().filter((shift) => shift.date === day(5)).length, 2);
  const overlap = await call({ ...body, operationId: crypto.randomUUID(), dates: [day(5)], from: '17:00', to: '20:00', breakMinutes: 0 });
  assert.equal(overlap.status, 409);
  assert.match(overlap.body.error, /ustma-ust/);
  assert.equal(mine().length, 6);
  const html = await (await GET(new Request(url, { headers: owner }))).text();
  assert.doesNotMatch(html, /data-act="shift"/, '«＋ Smena» tugmasi yo‘q — bitta yo‘l');
  assert.match(html, /data-act="days"/);
});
