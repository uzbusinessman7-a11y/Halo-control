import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { isParallelMode, completeCutover } = await import('../app/lib/cutover.ts');
const { dispatchScheduledDailyReport } = await import('../app/lib/telegram-scheduler.ts');
function d1(sqlite) {
  const make = (query, params = []) => ({
    bind: (...values) => make(query, values),
    all: async () => ({ results: sqlite.prepare(query).all(...params) }),
    first: async () => sqlite.prepare(query).get(...params) ?? null,
    run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (q) => make(q) };
}

test('yangi saytda o‘tishgacha avtomatik Telegram hisobot yuborilmaydi; eski saytga ta’sir yo‘q', async () => {
  globalThis.__HALO_CONTROL_DB__ = d1(new DatabaseSync(':memory:'));
  globalThis.__HALO_SELF_HOSTED__ = false;
  assert.equal(await isParallelMode(), false);
  globalThis.__HALO_SELF_HOSTED__ = true;
  assert.equal(await isParallelMode(), true);
  assert.equal((await dispatchScheduledDailyReport('main')).skipped, 'parallel-mode');
  await completeCutover('Rahbar');
  assert.equal(await isParallelMode(), false);
});
