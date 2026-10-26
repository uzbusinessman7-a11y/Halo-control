import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* A4 menyu: «Monitor menyu» bazasidan chop etiladigan sahifa (har ekran — bitta A4). */
const { a4Page, a4Sheets, variantText, isPlaceholderText } = await import('../app/core/menu-a4.ts');
const { tvView, normalizeDm } = await import('../app/core/digital-menu.ts');
const { DIGITAL_MENU_SEED } = await import('../app/core/digital-menu-seed.ts');

const config = normalizeDm(JSON.parse(JSON.stringify(DIGITAL_MENU_SEED)));
const views = config.screens.map((screen) => tvView(config, [], screen.id));

test('TYPE / SIZE: taom nomini takrorlamaydi, boshqacha bo‘lsa ikkalasi', () => {
  assert.equal(variantText('TANDIR LAVASH', { label: 'Tandir Lavash Chicken', size: 'cheese' }), 'cheese');
  assert.equal(variantText('FRIED CHICKEN', { label: 'Suyaksiz', size: '450 gram' }), 'Suyaksiz · 450 gram');
  assert.equal(variantText('Chicken wings', { label: 'Wings', size: '4pcs' }), '4pcs');
  assert.equal(variantText('HUNTER’S PIZZA', { label: 'Hunter’s pizza', size: 'Medium' }), 'Medium');
  assert.equal(variantText('X', { label: 'Katta', size: '' }), 'Katta');
  assert.ok(isPlaceholderText('Taom haqida qisqa ma’lumot'));
});

test('sahifalar: har ekran bitta A4, to‘r ustunlari va SET MENU joyi', () => {
  const sheets = a4Sheets(views);
  assert.deepEqual(sheets.map((s) => [s.screenId, s.hero.name, s.grid.length, s.cols, s.rows, s.setInGrid, `${s.page}/${s.pages}`]), [
    ['kebab', 'TANDIR LAVASH', 5, 3, 2, true, '1/3'],
    ['chicken', 'FRIED CHICKEN', 4, 2, 2, false, '2/3'],
    ['pitsa', 'CHEESE', 6, 3, 2, false, '3/3'],
  ]);
  assert.deepEqual(a4Sheets(views, 'chicken').map((s) => s.screenId), ['chicken']);
  // 9 tadan ko'p taom — keyingi sahifa
  const many = { ...views[0], items: Array.from({ length: 11 }, (_, i) => ({ ...views[0].items[0], id: `x${i}`, name: `T${i}` })) };
  assert.deepEqual(a4Sheets([many]).map((s) => [s.hero.name, s.grid.length]), [['T0', 8], ['T9', 1]]);
});

test('sahifa: hamma taom va narx bazadagidek, namuna tavsif va SOTILDI chiqmaydi, yozuvlar xavfsiz', () => {
  const html = a4Page(views, { today: '2026-10-26' });
  for (const view of views) for (const item of view.items) {
    assert.ok(html.includes(`>${item.name.replace(/&/g, '&amp;')}<`), item.name);
    for (const v of item.variants) assert.ok(html.includes(`₩${v.price.toLocaleString('en-US')}`), `${item.name} ${v.price}`);
  }
  assert.ok(!html.includes('Taom haqida qisqa'));
  assert.ok(!/SOTILDI|SOLD OUT/.test(html));
  assert.match(html, /@page\{size:A4;margin:0\}/);
  assert.match(html, /26\.10\.2026/);
  const evil = JSON.parse(JSON.stringify(views));
  evil[0].items[0].name = '<script>alert(1)</script>';
  assert.ok(!a4Page(evil).includes('<script>alert(1)'));
});

test('manzil va tugma: /api/v2/tv?a4=1 faqat o‘qiydi; Monitor menyuda «A4 menyu» tugmasi', () => {
  const route = readFileSync(new URL('../app/api/v2/tv/route.ts', import.meta.url), 'utf8');
  assert.match(route, /searchParams\.get\("a4"\) === "1"/);
  assert.doesNotMatch(route.slice(route.indexOf('get("a4")'), route.indexOf('if (!wantsData && !wantsMenu)')), /writeDm|putMedia|mutate/);
  const monitor = readFileSync(new URL('../app/api/v2/monitor/route.ts', import.meta.url), 'utf8');
  assert.match(monitor, /🖨 A4 menyu \(PDF\)/);
  assert.match(monitor, /\/api\/v2\/tv\?a4=1/);
});
