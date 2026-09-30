import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const { readPosFile, readPosSheets, parseCsv, previewPosImport, applyPosImport, PosExcelError } = await import('../app/core/pos-excel.ts');
const { saleDeductions } = await import('../app/core/deductions.ts');
const route = await import('../app/api/v2/pos-excel/route.ts');

function okposMatrix(date, lines) {
  const total = lines.reduce((s, l) => s + l[2], 0), qty = lines.reduce((s, l) => s + l[1], 0);
  return [['당일매출종합현황'], ['상품별 매출현황'], [`조회일자 : ${date}`], ['상품코드', '상품명', '수량', '실매출'],
    ...lines.map((l) => [l[3], l[0], l[1], l[2]]), ['', '합계', qty, total]];
}
const okpos = (date, lines, name = 'pos.xlsx') => readPosSheets([{ name: 'Sheet1', matrix: okposMatrix(date, lines) }], name);
const okposCsv = (date, lines) => new TextEncoder().encode(okposMatrix(date, lines).map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n'));
const base = () => ({
  accounts: [{ id: 'card', name: 'Karta', type: 'card' }, { id: 'cash', name: 'Naqd', type: 'cash' }, { id: 'bank', name: 'Bank', type: 'bank' }],
  costRules: { taxPct: 10, cardCommissionPct: 2 },
  inventory: [{ id: 'g', name: 'Go‘sht', unit: 'g', stock: 5000, unitCost: 20 }],
  recipes: [
    { id: 'd', name: 'Donar', salePrice: 9000, posCode: 'A01', ingredients: [{ inventoryId: 'g', quantity: 100 }] },
    { id: 'k', name: 'Kabob', salePrice: 15000, ingredients: [{ inventoryId: 'g', quantity: 200 }] },
  ],
  sales: [], stockMovements: [], monthlyCloses: [],
});
const ctx = { accountId: 'card', actor: { id: 'w', name: 'Ali' }, createdAt: '2026-10-01T12:00:00Z', today: '2026-10-01' };

test('OKPOS kunlik hisobot: o‘qish, kod bo‘yicha bog‘lash, noma’lumni qo‘lda bog‘lash', async () => {
  const file = okpos('2026-10-01', [['Donar', 3, 27000, 'A01'], ['Kabob katta', 1, 15000, 'B07']]);
  const p = previewPosImport(base(), file, {}, '2026-10-01');
  assert.equal(p.date, '2026-10-01');
  assert.equal(p.totals.revenue, 42000);
  assert.equal(p.counts.unmatched, 1);
  assert.equal(p.ready, false);
  const p2 = previewPosImport(base(), file, { 'code:B07': 'k' }, '2026-10-01');
  assert.equal(p2.ready, true);
  assert.equal(p2.products.find((x) => x.productCode === 'B07').recipeName, 'Kabob');
  await assert.rejects(() => readPosFile(new Uint8Array([1, 2]), 'x.pdf'), PosExcelError);
  const fromCsv = await readPosFile(okposCsv('2026-10-01', [['Donar', 3, 27000, 'A01']]), 'pos.csv');
  assert.equal(previewPosImport(base(), fromCsv, {}, '2026-10-01').totals.revenue, 27000);
  assert.deepEqual(parseCsv('a;b\n"x;y";2\n'), [['a', 'b'], ['x;y', '2']]);
});

test('qo‘llash: POS savdo, soliq va karta komissiyasi, ombor, kod eslab qolinadi; qayta yuklash takror yozmaydi; yangilangan hisobot o‘rnini bosadi', () => {
  const file = okpos('2026-10-01', [['Donar', 3, 27000, 'A01'], ['Kabob katta', 1, 15000, 'B07']]);
  const r = applyPosImport(base(), file, { 'code:B07': 'k' }, ctx);
  const s = r.state;
  assert.deepEqual([r.result.saved, r.result.revenue], [2, 42000]);
  assert.equal(s.inventory[0].stock, 5000 - 300 - 200);
  const sale = s.sales.find((x) => x.recipeId === 'd');
  assert.equal(sale.salesChannel, 'pos');
  assert.equal(sale.taxPctAtSale, 10);
  const types = new Map(s.accounts.map((a) => [a.id, a.type]));
  assert.deepEqual(saleDeductions(sale, s, types), { card: 540, delivery: 0, tax: 2700, accountType: 'card' });
  assert.ok(s.recipes.find((x) => x.id === 'k').posAliases.includes('B07'), 'yangi kod retseptga saqlandi');
  // keyingi safar bog'lash shart emas, va takror yozilmaydi
  assert.equal(previewPosImport(s, file, {}, '2026-10-01').counts.unmatched, 0);
  assert.throws(() => applyPosImport(s, file, {}, ctx), /oldin to'liq yuklangan/);
  // kun oxirida yangilangan hisobot: Donar 5 ta
  const later = okpos('2026-10-01', [['Donar', 5, 45000, 'A01'], ['Kabob katta', 1, 15000, 'B07']], 'pos2.xlsx');
  const r2 = applyPosImport(s, later, {}, ctx);
  assert.deepEqual([r2.result.saved, r2.result.replaced, r2.result.skipped], [1, 1, 1]);
  assert.equal(r2.state.sales.filter((x) => x.recipeId === 'd').length, 1);
  assert.equal(r2.state.sales.find((x) => x.recipeId === 'd').quantity, 5);
  assert.equal(r2.state.inventory[0].stock, 5000 - 500 - 200);
  // naqd hisob ham mumkin, hisob-raqam — yo'q
  assert.throws(() => applyPosImport(base(), file, { 'code:B07': 'k' }, { ...ctx, accountId: 'bank' }), /karta yoki naqd/);
});

test('API: xodim o‘z filialiga yuklaydi (tekshirish → saqlash)', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const make = (query, params = []) => ({ bind: (...v) => make(query, v), all: async () => ({ results: sqlite.prepare(query).all(...params) }), first: async () => sqlite.prepare(query).get(...params) ?? null, run: async () => { const r = sqlite.prepare(query).run(...params); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(query).run(...params) });
  globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => make(q), batch: async (st) => { sqlite.exec('BEGIN'); try { const o = st.map((s) => s._exec()); sqlite.exec('COMMIT'); return o; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } } };
  globalThis.__HALO_SELF_HOSTED__ = true;
  const { createWorkerAccount, loginWorker } = await import('../app/lib/worker-auth.ts');
  const { readHaloState } = await import('../app/lib/halo-store.ts');
  await readHaloState('main');
  const p = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  Object.assign(p, base());
  sqlite.prepare("UPDATE app_state SET payload = ? WHERE id = 'main'").run(JSON.stringify(p));
  await createWorkerAccount('main', 'Ali', 'ali', '1234');
  const cookie = (await loginWorker('main', 'ali', '1234')).cookie.split(';')[0];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const send = async (fields, headers = { cookie }) => {
    const form = new FormData();
    form.set('file', new File([okposCsv(today, [['Donar', 2, 18000, 'A01']])], 'pos.csv'));
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    const r = await route.POST(new Request('https://x.example/api/v2/pos-excel', { method: 'POST', headers, body: form }));
    const j = await r.json(); j._status = r.status; return j;
  };
  assert.equal((await send({}, {}))._status, 401);
  const pre = await send({ action: 'preview' });
  assert.equal(pre.preview.ready, true, JSON.stringify(pre));
  assert.deepEqual(pre.accounts.map((a) => a.type).sort(), ['card', 'cash']);
  const done = await send({ action: 'apply', accountId: 'card' });
  assert.equal(done.ok, true, done.error);
  assert.equal(done.applied.revenue, 18000);
  assert.equal(done.preview.counts.saved, 1);
  const state = JSON.parse(sqlite.prepare("SELECT payload FROM app_state WHERE id = 'main'").get().payload);
  assert.equal(state.sales[0].createdByName, 'Ali');
});
