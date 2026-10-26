import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* «Marja»: hamma taom bitta oynada — narx, tannarx, qancha qoladi; sof (soliq + karta) va delivery. */
const { marginReport } = await import('../app/core/margins.ts');

const state = {
  inventory: [
    { id: 'g', name: 'Go‘sht', unit: 'g', unitCost: 18, stock: 1000 },
    { id: 'l', name: 'Lavash', unit: 'dona', unitCost: 350, stock: 100 },
  ],
  recipes: [
    { id: 'a', name: 'Tandir lavash', salePrice: 12900, ingredients: [{ inventoryId: 'g', quantity: 180 }, { inventoryId: 'l', quantity: 1 }], deliveryPrices: { coupang: 14900 } },
    { id: 'b', name: 'Kebab lamb', salePrice: 8900, ingredients: [{ inventoryId: 'g', quantity: 230 }, { inventoryId: 'l', quantity: 1 }] },
    { id: 'c', name: 'Donar', salePrice: 9000, ingredients: [{ inventoryId: 'g', quantity: 150 }, { inventoryId: 'l', quantity: 1 }] },
    { id: 'd', name: 'Salat', salePrice: 7000, ingredients: [] },
    { id: 'e', name: 'Eski', salePrice: 5000, ingredients: [], archived: true },
  ],
  costRules: { taxPct: 3, cardCommissionPct: 1.5 },
};

test('har taom: narx − tannarx, foiz va daraja (30% gacha yaxshi, 30–35 o‘rtacha, 35 dan yuqori past)', () => {
  const report = marginReport(state);
  const by = Object.fromEntries(report.rows.map((row) => [row.name, row]));
  assert.equal(report.rows.length, 4, 'arxivdagi taom chiqmaydi');
  assert.deepEqual([by['Tandir lavash'].cost, by['Tandir lavash'].margin, by['Tandir lavash'].marginPct, by['Tandir lavash'].level], [3590, 9310, 72.2, 'good']);
  assert.deepEqual([by['Kebab lamb'].cost, by['Kebab lamb'].margin, by['Kebab lamb'].marginPct, by['Kebab lamb'].level], [4490, 4410, 49.6, 'low']);
  assert.equal(by['Donar'].level, 'mid'); // 3050 / 9000 = 33.9%
  assert.equal(by['Salat'].level, 'none'); assert.equal(by['Salat'].margin, null); assert.equal(by['Salat'].status, 'Retsept kiritilmagan');
  assert.deepEqual(report.summary, { count: 4, ready: 3, incomplete: 1, good: 1, mid: 1, low: 1, avgMarginPct: 62.6, avgNetPct: 58.1 });
});

test('sof: karta bilan to‘lansa soliq va karta foizi ayriladi; delivery — platforma foizi va soliq', () => {
  const report = marginReport(state);
  const t = report.rows.find((row) => row.name === 'Tandir lavash');
  assert.deepEqual(t.net, { amount: 12900 - 3590 - Math.round(12900 * 0.045), pct: 67.7 });
  assert.equal(t.delivery.length, 1);
  const c = t.delivery[0];
  assert.equal(c.label, 'Coupang'); assert.equal(c.price, 14900);
  assert.equal(c.left, 14900 - 3590 - Math.round(14900 * (c.feePct + 3) / 100));
  assert.deepEqual(report.rules, { taxPct: 3, cardPct: 1.5, targetFoodCost: 30, midFoodCost: 35 });
});

test('sahifa: Ombor bo‘limida «Marja» tugmasi; faqat rahbar; faqat o‘qiydi', () => {
  const shell = readFileSync(new URL('../app/core/ui-shell.ts', import.meta.url), 'utf8');
  assert.match(shell, /\{ key: "marja", href: "\/api\/v2\/marja", label: "Marja" \}/);
  const route = readFileSync(new URL('../app/api/v2/marja/route.ts', import.meta.url), 'utf8');
  assert.match(route, /isAdminRequest/);
  assert.doesNotMatch(route, /mutateHaloState|writeDm/);
});
