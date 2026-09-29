import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
const { listHaloBranches } = await import('../app/lib/halo-store.ts');
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

test('ko‘chirilgan akkaunt bilan bir xil login: aniq xabar; eski PIN yangi saytda ishlaydi', async () => {
  const sqlite = new DatabaseSync(':memory:');
  globalThis.__HALO_CONTROL_DB__ = d1(sqlite);
  await listHaloBranches();
  await createWorkerAccount('main', 'Ali', 'ali', '1234');
  await assert.rejects(createWorkerAccount('main', 'Ali ikkinchi', 'ALI', '9999'), /“ali” logini bu filialda allaqachon Ali uchun ochilgan/);
  const login = await loginWorker('main', 'ali', '1234');
  assert.equal(login.name, 'Ali');
});
