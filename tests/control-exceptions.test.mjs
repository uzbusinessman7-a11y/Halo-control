import test from 'node:test';
import assert from 'node:assert/strict';
import { auditBusinessState } from '../app/lib/business-audit.ts';

const today = '2026-09-29';
const sale = (id, date) => ({ id, date, recipeId: 'r', quantity: 1, totalRevenue: 7000, totalCost: 2100, accountId: 'cash' });
const base = () => ({ accounts: [{ id: 'cash', name: 'Kassa' }], sales: [], financialEntries: [], inventory: [], recipes: [], suppliers: [], transactions: [] });
const issue = (audit, code) => audit.issues.find((item) => item.code === code);

test('savdo bo‘lgan, lekin yopilmagan kunlar ko‘rsatiladi; bugun va yopilgan kunlar emas', () => {
  const state = { ...base(),
    sales: [sale('a', '2026-09-27'), sale('b', '2026-09-28'), sale('c', today), sale('eski', '2026-09-01')],
    dailyCloses: [{ id: 'x', date: '2026-09-28', difference: 0 }] };
  const found = issue(auditBusinessState(state, { today }), 'unclosed_days');
  assert.equal(found.count, 1);
  assert.equal(found.severity, 'error');
  assert.match(found.examples[0], /^2026-09-27/);
});

test('hamma kun yopilgan bo‘lsa ogohlantirish yo‘q', () => {
  const state = { ...base(), sales: [sale('a', '2026-09-28')], dailyCloses: [{ id: 'x', date: '2026-09-28', difference: 0 }] };
  assert.equal(issue(auditBusinessState(state, { today }), 'unclosed_days'), undefined);
  assert.equal(issue(auditBusinessState(state, { today }), 'cash_difference'), undefined);
});

test('kassa kamomadi va ortiqchasi alohida — bir-birini yopib qo‘ymaydi', () => {
  const state = { ...base(), dailyCloses: [
    { id: '1', date: '2026-09-27', difference: -5000, note: 'qaytim xato' },
    { id: '2', date: '2026-09-28', difference: 5000 },
    { id: '3', date: '2026-09-26', difference: 0 },
    { id: '4', date: '2026-08-01', difference: -99000 },
  ] };
  const found = issue(auditBusinessState(state, { today }), 'cash_difference');
  assert.equal(found.severity, 'error');
  assert.equal(found.count, 2);
  assert.match(found.title, /kam 5,000 ₩ · ortiqcha 5,000 ₩/);
  assert.equal(found.examples[0], '2026-09-28 · +5,000 ₩');
  assert.equal(found.examples[1], '2026-09-27 · −5,000 ₩ · qaytim xato');
});

test('faqat ortiqcha pul bo‘lsa — xato emas, tekshirish', () => {
  const state = { ...base(), dailyCloses: [{ id: '1', date: '2026-09-27', difference: 1000 }] };
  assert.equal(issue(auditBusinessState(state, { today }), 'cash_difference').severity, 'review');
});

test('ombor sanog‘i kamomadi: mahsulot bo‘yicha gramm va won, eng qimmati birinchi', () => {
  const state = { ...base(),
    inventory: [{ id: 'goosht', name: 'Go‘sht', unit: 'g', stock: 1000, unitCost: 15 }, { id: 'non', name: 'Lavash', unit: 'dona', stock: 50, unitCost: 300 }],
    stockMovements: [
      { id: 'm1', inventoryId: 'goosht', type: 'adjustment', quantity: -800, unitCost: 15, date: '2026-09-20', referenceId: 'inventory-count:a' },
      { id: 'm2', inventoryId: 'goosht', type: 'adjustment', quantity: -200.5, unitCost: 15, date: '2026-09-27', referenceId: 'inventory-count:b' },
      { id: 'm3', inventoryId: 'non', type: 'adjustment', quantity: -3, unitCost: 300, date: '2026-09-27', referenceId: 'inventory-count:b' },
      { id: 'm4', inventoryId: 'non', type: 'adjustment', quantity: 2, unitCost: 300, date: '2026-09-28', referenceId: 'inventory-count:c' },
      { id: 'm5', inventoryId: 'goosht', type: 'adjustment', quantity: -5000, unitCost: 15, date: '2026-08-01', referenceId: 'inventory-count:old' },
      { id: 'm6', inventoryId: 'goosht', type: 'adjustment', quantity: -100, unitCost: 15, date: '2026-09-27', referenceId: 'inventory-count:d', cancelledAt: 'x' },
      { id: 'm7', inventoryId: 'goosht', type: 'sale', quantity: -120, unitCost: 15, date: '2026-09-27' },
    ] };
  const found = issue(auditBusinessState(state, { today }), 'stock_count_shortage');
  assert.equal(found.count, 2);
  assert.match(found.title, /15,908 ₩/);
  assert.equal(found.examples[0], 'Go‘sht · −1,000.5 g · 15,008 ₩');
  assert.equal(found.examples[1], 'Lavash · −3 dona · 900 ₩');
});

test('kun yopish ma’lumoti umuman berilmagan bo‘lsa, yopilmagan kun deb hisoblanmaydi', () => {
  const state = { ...base(), sales: [sale('a', '2026-09-27')] };
  assert.equal(issue(auditBusinessState(state, { today }), 'unclosed_days'), undefined);
  assert.equal(issue(auditBusinessState({ ...state, dailyCloses: [] }, { today }), 'unclosed_days').count, 1);
});

test('eski ma’lumot va sanasiz holatda ham audit yiqilmaydi', () => {
  const audit = auditBusinessState({ ...base(), dailyCloses: 'x', stockMovements: null });
  assert.ok(Array.isArray(audit.issues));
});

test('oy yopilgach, o‘sha oydagi yopilmagan kunlar endi ko‘rsatilmaydi', () => {
  const state = { ...base(), sales: [sale('a', '2026-09-27'), sale('b', '2026-10-02')], dailyCloses: [] };
  const before = issue(auditBusinessState(state, { today: '2026-10-05' }), 'unclosed_days');
  assert.equal(before.count, 2);
  const after = issue(auditBusinessState({ ...state, monthlyCloses: [{ month: '2026-09' }] }, { today: '2026-10-05' }), 'unclosed_days');
  assert.equal(after.count, 1);
  assert.match(after.examples[0], /^2026-10-02/);
});
