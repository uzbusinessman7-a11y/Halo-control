import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { makeReport, controlAlertLines } = await import('../app/lib/telegram-service.ts');

const sale = (id, date) => ({ id, date, recipeId: 'r', quantity: 1, totalRevenue: 7000, totalCost: 2100, accountId: 'cash' });
const base = () => ({ accounts: [{ id: 'cash', name: 'Kassa' }], sales: [], financialEntries: [], inventory: [], recipes: [], suppliers: [], transactions: [], dailyCloses: [], stockMovements: [], fixedExpenses: [] });

test('hisobot kuni yopilmagan bo‘lsa — hisobot boshida qizil ogohlantirish', () => {
  const lines = controlAlertLines({ ...base(), sales: [sale('a', '2026-09-28')] }, '2026-09-28');
  assert.equal(lines[0], '🚦 DIQQAT');
  assert.match(lines[1], /^🔴 Kassa sanab yopilmagan kunlar.*2026-09-28/);
});

test('kassa kamomadi va ombor kamomadi ko‘rinadi', () => {
  const state = { ...base(),
    sales: [sale('a', '2026-09-28')],
    dailyCloses: [{ id: 'c', date: '2026-09-28', difference: -3000, note: 'sanoq' }],
    inventory: [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 100, unitCost: 15 }],
    stockMovements: [{ id: 'm', inventoryId: 'g', type: 'adjustment', quantity: -400, unitCost: 15, date: '2026-09-28', referenceId: 'inventory-count:x' }] };
  const text = controlAlertLines(state, '2026-09-28').join('\n');
  assert.match(text, /🔴 Kassa farqi \(30 kun\): kam 3,000 ₩/);
  assert.match(text, /🟡 Ombor sanog‘ida kamomad \(30 kun\): 6,000 ₩ — Go‘sht · −400 g · 6,000 ₩/);
  assert.doesNotMatch(text, /yopilmagan kunlar/);
});

test('hammasi joyida bo‘lsa — bitta yashil qator', () => {
  const state = { ...base(), sales: [sale('a', '2026-09-28')], dailyCloses: [{ id: 'c', date: '2026-09-28', difference: 0 }] };
  assert.deepEqual(controlAlertLines(state, '2026-09-28'), ['🟢 Kritik farq yo‘q — kassa, ombor va qarzlar tekshirildi.']);
});

test('ogohlantirish to‘liq hisobotning boshida turadi — uzun xabar kesilsa ham yo‘qolmaydi', () => {
  const { text } = makeReport({ ...base(), sales: [sale('a', '2026-09-28')] }, '2026-09-28');
  const alert = text.indexOf('🚦 DIQQAT');
  assert.ok(alert > 0 && alert < text.indexOf('💰 MOLIYA'));
});
