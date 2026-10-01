import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { PRICE_CALC_JS } = await import('../app/core/price-calc.ts');
const C = new Function(PRICE_CALC_JS + '; return {pcNum,pcP,pcRoundUp,pcPriceForCost,pcMarkup,pcAdd,pcSub,pcPart,pcInside,pcRatio,pcChange};')();

test('tannarx 5000 → 30/35/40% narx (aniq va yuqoriga yaxlitlangan)', () => {
  assert.deepEqual([30, 35, 40].map((p) => C.pcPriceForCost(5000, p, 0, 1).price), [16667, 14286, 12500]);
  assert.deepEqual([30, 35, 40].map((p) => C.pcPriceForCost('5,000', p, 0, 100).price), [16700, 14300, 12500]);
  assert.deepEqual([30, 35, 40].map((p) => C.pcPriceForCost(5000, p, 0, 500).price), [17000, 14500, 12500]);
  const r = C.pcPriceForCost(5000, 30, 0, 100);
  assert.equal(r.exact, 16666.666667);
  assert.equal(r.profit, 11700);
  assert.equal(r.realPct, 29.9); // yaxlitlangach foiz maqsaddan oshmaydi
  assert.equal(C.pcPriceForCost(6000, 30, 0, 100).price, 20000); // aniq bo'linadigan son ortiqcha yaxlitlanmaydi
  assert.equal(C.pcPriceForCost(4700, '32,5', 0, 1).price, 14462);
});

test('soliq va komissiyadan keyin: sof pulga nisbatan foiz aniq saqlanadi', () => {
  const r = C.pcPriceForCost(5000, 30, 11.6, 100); // 10% soliq + 1.6% karta
  assert.equal(r.price, 18900);
  assert.ok(r.realPct <= 30);
  assert.equal(r.net, 16707.6);
});

test('ustama va oddiy foiz amallari', () => {
  assert.equal(C.pcMarkup(5000, 30, 1).price, 6500);
  assert.equal(C.pcAdd(5000, 30), 6500);
  assert.equal(C.pcSub(5000, 30), 3500);
  assert.equal(C.pcPart(5000, 30), 1500);
  assert.deepEqual(C.pcInside(11000, 10), { base: 10000, part: 1000 });
  assert.equal(C.pcRatio(5000, 16700), 29.94012);
  assert.equal(C.pcChange(5000, 6000), 20);
  assert.equal(C.pcPriceForCost(5000, 0, 0, 100), null);
  assert.equal(C.pcPriceForCost(5000, 100, 0, 100), null);
  assert.equal(C.pcPriceForCost(0, 30, 0, 100), null);
});
