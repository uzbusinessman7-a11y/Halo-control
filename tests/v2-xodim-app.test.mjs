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
