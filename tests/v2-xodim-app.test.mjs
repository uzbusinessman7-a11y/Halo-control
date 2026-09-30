import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const { GET } = await import('../app/api/v2/xodim/route.ts');

test('xodim ilovasi: sahifa ochiladi (kirishsiz), skript to‘g‘ri, 4 til', async () => {
  globalThis.__HALO_SELF_HOSTED__ = true;
  const res = await GET();
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  for (const word of ['ISHNI BOSHLADIM', 'НАЧАЛ РАБОТУ', 'STARTED WORK', '업무 시작']) assert.match(html, new RegExp(word));
  assert.doesNotMatch(html, /class="bottom"/, 'rahbar menyusi xodimga ko‘rinmaydi');
});

test('xodim ilovasi: ma’lumot — mahsulot birliklari, yetkazuvchilar, hisoblar, ruxsatlar; amallar ko‘rinadi', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { POST } = await import('../app/api/v2/xodim/route.ts');
  const sqlite = new DatabaseSync(':memory:');
  const make = (query, params = []) => ({ bind: (...v) => make(query, v), all: async () => ({ results: sqlite.prepare(query).all(...params) }), first: async () => sqlite.prepare(query).get(...params) ?? null, run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(query).run(...params) });
  globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  globalThis.__HALO_SELF_HOSTED__ = true;
  const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
  const { readHaloState } = await import('../app/lib/halo-store.ts');
  await readHaloState('main');
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  p.inventory = [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 0, unitCost: 20, packageName: 'quti', unitsPerPackage: 10000 }];
  p.suppliers = [{ id: 's1', name: 'Nodir aka' }, { id: 's2', name: 'MEZANA' }];
  p.costRules = { ...p.costRules, taxPct: 10 };
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  assert.equal((await POST(new Request('https://x.example/api/v2/xodim', { method: 'POST', body: '{}' }))).status, 401);
  await createWorkerAccount('main', 'Ali', 'ali', '1234');
  const cookie = (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0];
  const d = await (await POST(new Request('https://x.example/api/v2/xodim', { method: 'POST', headers: { cookie }, body: '{}' }))).json();
  assert.equal(d.ok, true);
  assert.deepEqual(d.inventory[0], { id: 'g', name: 'Go‘sht', unit: 'g', packageName: 'quti', unitsPerPackage: 10000, vegetable: false });
  assert.deepEqual(d.suppliers.map((s) => s.name), ['Nodir aka'], 'MEZANA alohida bo‘limda');
  assert.ok(d.updatedAt);
  assert.ok(!d.expenseCategories.includes('Soliq'), 'avtomatik soliq bo‘lsa, soliq xarajati xodimga ko‘rinmaydi');
  assert.ok(d.expenseCategories.includes('Mahsulot xaridi'));
  const html = await (await GET()).text();
  for (const word of ['POS hisobot', 'Mahsulot kirimi', 'Minus tavar', 'Rahbardan vazifalar', '/api/v2/pos-excel', '/api/worker-deliveries', '/api/worker-expenses']) assert.match(html, new RegExp(word));
});
