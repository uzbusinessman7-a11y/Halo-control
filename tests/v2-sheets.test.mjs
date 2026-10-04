import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const payroll = await import('../app/lib/payroll.ts');
const daily = await import('../app/lib/daily-report.ts');
const sheets = await import('../app/lib/google-sheets-export.ts');

const TODAY = '2026-10-05';
const day = (k) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - k * 864e5).toISOString().slice(0, 10);
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** Turli holatlar aralashgan filial: ziddiyatli smenalar, xodim telefonidan kiritilgan smena, teskari yozuvlar, bekor qilingan savdo. */
function branch(seed, days, staffCount) {
  const r = rng(seed), int = (n) => Math.floor(r() * n), pick = (list) => list[int(list.length)], chance = (p) => r() < p;
  const staff = Array.from({ length: staffCount }, (_, i) => ({ id: i === 3 ? 'st0' : `st${i}`, name: `Xodim ${i}`, payType: i % 3 === 2 ? 'monthly' : 'hourly', hourlyRate: 9000 + i * 700, monthlySalary: 2400000, workDays: 26, dailyHours: 9, overtimeAfterHours: 8, overtimeMultiplier: pick([1, 1.5]), active: i !== 1 }));
  const state = {
    accounts: [{ id: 'cash', name: 'Naqd', type: 'cash' }, { id: 'card', name: 'Karta', type: 'card' }, { id: 'bank', name: 'Bank', type: 'bank' }, { id: 'del', name: 'Delivery', type: 'delivery' }],
    costRules: { cardCommissionPct: 1.5, deliveryCommissionPct: 12, taxPct: 10 },
    inventory: Array.from({ length: 6 }, (_, i) => ({ id: `inv${i}`, name: `Mahsulot ${i}`, unit: i % 2 ? 'g' : 'dona', stock: 500 + i, unitCost: 10 + i * 3.5, minStock: 50 })),
    recipes: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `Taom ${i}`, salePrice: 7000 + i * 500, posCode: String(100 + i), ingredients: [{ inventoryId: `inv${i}`, quantity: 120 }] })),
    suppliers: [{ id: 's0', name: 'Nodir aka', openingBalance: 0, balance: 0 }, { id: 'sm', name: 'MEZANA', openingBalance: 0, balance: 0 }],
    staff, sales: [], financialEntries: [], stockMovements: [], workerConsumptions: [], posOrders: [], workShifts: [], payrollAdjustments: [], attendanceDays: [], payrollPayments: [], transactions: [], dailyCloses: [], deletedItems: [], productCategories: [],
    vegetableExpenseVersion: 1, vegetablePurchases: [],
  };
  for (let k = 0; k < days; k++) {
    const date = day(k);
    for (let i = 0; i < 6; i++) {
      const quantity = pick([1, 2, 0.5]);
      const sale = { id: `sale-${k}-${i}`, recipeId: `r${int(6)}`, quantity, totalRevenue: (7000 + int(40) * 100) * quantity + (chance(0.1) ? 0.4 : 0), totalCost: int(3000) + (chance(0.2) ? 0.6 : 0), date, accountId: pick(['card', 'cash', 'bank', 'del', '']), soldAt: `${date}T05:10:00.000Z` };
      if (chance(0.2)) sale.expenseOnlyCost = int(600);
      if (chance(0.2)) { sale.deliveryPlatform = pick(['coupang', 'baemin', 'yogiyo']); sale.deliveryOrderNumber = `o${int(30)}`; sale.deliveryCommissionPct = pick([9.8, 12]); }
      if (chance(0.05)) sale.voided = true;
      if (chance(0.05)) { sale.posOrderId = `po-${k}-${i}`; state.posOrders.push({ id: sale.posOrderId, status: 'cancelled' }); }
      state.sales.push(sale);
    }
    for (let i = 0; i < 3; i++) {
      const id = `fe-${k}-${i}`;
      const entry = { id, type: pick(['expense', 'expense', 'income', 'transfer']), category: pick(['Boshqa', 'Ijara', 'Soliq', 'Mahsulot xaridi']), amount: 2000 + int(300) * 100, date, accountId: 'cash', note: 'izoh' };
      if (chance(0.3)) entry.affectsProfit = false;
      if (chance(0.1)) entry.fixedExpenseId = 'fx1';
      state.financialEntries.push(entry);
      // Teskari yozuv keyingi kunda: ikkala kunda ham hisobotga kirmasligi kerak.
      if (chance(0.15)) state.financialEntries.push({ ...entry, id: `${id}-rev`, reversedEntryId: id, date: day(Math.max(0, k - 1)) });
    }
    if (chance(0.5)) {
      const id = `wc-${k}`;
      state.workerConsumptions.push({ id, date, kind: pick(['meal', 'waste', 'inventory_only']), quantity: 2, totalCost: 1500 + int(30) * 100, unit: 'dona', label: 'Chiqim', note: '', createdAt: `${date}T03:00:00.000Z`, items: [] });
      state.stockMovements.push({ id: `mv-${id}`, inventoryId: 'inv1', type: 'waste', quantity: -20, date, referenceId: id, unitCost: 12 });
    }
    if (chance(0.4)) state.stockMovements.push({ id: `mv-${k}`, inventoryId: `inv${int(6)}`, type: 'waste', quantity: -(1 + int(40)), date, unitCost: chance(0.5) ? 7.25 : undefined, note: 'buzildi' });
    for (const [index, member] of staff.entries()) {
      if (chance(0.2)) continue;
      const worker = chance(0.5);
      const clockIn = new Date(Date.parse(`${date}T00:00:00Z`) + (int(5) - (worker && chance(0.3) ? 9 : 0)) * 36e5 + int(50) * 6e4).toISOString();
      const clockOut = new Date(Date.parse(clockIn) + (5 + int(9)) * 36e5 + int(55) * 6e4).toISOString();
      const shift = { id: `ws-${k}-${index}`, staffId: member.id, date: worker && chance(0.4) ? day(k + 1) : date, clockIn, clockOut: chance(0.04) ? '' : clockOut, breakMinutes: chance(0.3) ? 30 : 0, source: worker ? 'worker' : 'owner', status: chance(0.05) ? 'void' : 'closed', hourlyRateAtShift: chance(0.6) ? 9500 + int(20) * 100 : 0 };
      state.workShifts.push(shift);
      if (chance(0.07)) state.workShifts.push({ ...shift, id: `${shift.id}-zid`, clockIn: new Date(Date.parse(clockIn) + 36e5).toISOString() });
      if (chance(0.1)) state.payrollAdjustments.push({ id: `pa-${k}-${index}`, staffId: member.id, date, type: pick(['advance', 'bonus', 'deduction']), amount: 10000 + int(50) * 1000 + (chance(0.2) ? 0.5 : 0), voided: chance(0.1) });
      if (chance(0.05)) state.attendanceDays.push({ id: `ad-${k}-${index}`, staffId: member.id, date: day(k + 1), status: pick(['off', 'sick']), payMode: pick(['unpaid', 'planned']), plannedMinutesAtDay: 480, hourlyRateAtDay: 10000 });
    }
    if (chance(0.4)) state.transactions.push({ id: `tx-${k}`, supplierId: 's0', type: pick(['purchase', 'payment']), amount: 20000 + int(100) * 100, date });
  }
  return state;
}

test('ish haqi: oy bo‘yicha bir marta taqsimlash har kun uchun alohida hisob bilan wonma-won bir xil', () => {
  for (const seed of [11, 12, 13]) {
    const state = branch(seed, 45, 5);
    const staff = payroll.normalizeStaff(state.staff);
    const shifts = payroll.normalizeWorkShifts(state.workShifts);
    const adjustments = payroll.normalizePayrollAdjustments(state.payrollAdjustments);
    const attendance = payroll.normalizeAttendanceDays(state.attendanceDays);
    const allocate = payroll.createPayrollDateAllocator(shifts, adjustments, attendance);
    let nonZero = 0;
    // bir xil id'li ikki xodim (st0) ham o'z stavkasi bilan alohida hisoblanadi
    assert.equal(staff.filter((member) => member.id === 'st0').length, 2);
    for (const member of staff) for (const date of [...Array.from({ length: 52 }, (_, k) => day(k - 2)), '2026-02-30', 'xato', '']) {
      const expected = payroll.calculatePayrollForDate(member, shifts, adjustments, attendance, date);
      assert.equal(allocate(member, date), expected, `${seed} ${member.name} ${date}`);
      assert.equal(allocate(member, date), expected, 'ikkinchi so‘rov ham o‘sha javob');
      if (expected) nonZero++;
    }
    assert.ok(nonZero > 40, 'sinov bo‘sh ma’lumotda o‘tmasin');
  }
});

test('kunlik hisobot: tayyor ish haqi manbasi bilan ham, usiz ham har bir raqam bir xil', () => {
  const state = branch(21, 40, 4);
  const frozen = JSON.stringify(state);
  const source = daily.createDailyPayrollSource(state);
  let payrollDays = 0;
  for (let k = -2; k < 45; k++) {
    const expected = daily.calculateDailyReport(state, day(k));
    assert.deepEqual(daily.calculateDailyReport(state, day(k), source), expected, day(k));
    if (expected.payroll) payrollDays++;
  }
  assert.ok(payrollDays > 20);
  assert.equal(JSON.stringify(state), frozen, 'hisobot ma’lumotni o‘zgartirmaydi');
});

test('Google Sheets eksporti: kunlik qatorlar to‘liq ma’lumot bo‘yicha alohida hisoblangan kunlik hisobot bilan bir xil', () => {
  const state = branch(31, 50, 4);
  const frozen = JSON.stringify(state);
  const from = day(59), to = TODAY;
  const exported = sheets.buildGoogleSheetsExport(state, from, to);
  assert.equal(JSON.stringify(state), frozen);
  assert.deepEqual(exported.sheets.map((sheet) => sheet.name), ['HALO HISOBOT', 'HALO KUNLIK', 'HALO SAVDO', 'HALO DELIVERY', 'HALO PUL HARAKATI', 'HALO OMBOR', 'HALO CHIQIM', 'HALO YETKAZUVCHILAR', 'HALO XODIMLAR', 'HALO SABZAVOT SARFI']);
  const kunlik = exported.sheets.find((sheet) => sheet.name === 'HALO KUNLIK');
  assert.equal(kunlik.rows.length, 60);
  // Eksport ishlatadigan qoidalar bilan bir xil "faol" ro'yxat: bekor qilingan POS buyurtma va savdolar kirmaydi.
  const cancelled = new Set(state.posOrders.filter((order) => order.status === 'cancelled').map((order) => order.id));
  const reference = { ...state, sales: state.sales.filter((sale) => !cancelled.has(sale.posOrderId) && sale.voided !== true), workerConsumptions: state.workerConsumptions };
  const totals = { revenue: 0, expenses: 0, net: 0 };
  for (const row of kunlik.rows) {
    const report = daily.calculateDailyReport(reference, row[0]);
    assert.deepEqual(row.slice(1, 10), [report.revenue, report.taxableSales, report.cashSales, report.bankSales, report.cost, report.grossProfit, report.otherIncome, report.totalExpenses, report.netProfit], row[0]);
    assert.equal(row[12], report.itemCount);
    totals.revenue += report.revenue; totals.expenses += report.totalExpenses; totals.net += report.netProfit;
  }
  assert.ok(totals.revenue > 1_000_000);
  const summary = new Map(exported.sheets[0].rows.map((row) => [row[0], row[1]]));
  assert.equal(summary.get('Jami savdo (₩)'), totals.revenue);
  assert.equal(summary.get('Jami xarajat (₩)'), totals.expenses);
  assert.equal(summary.get('Sof foyda (₩)'), totals.net);
  // Oylik maosh qatorlari: xodimning faqat o'z smenalari berilsa ham o'sha natija.
  const staff = payroll.normalizeStaff(state.staff), shifts = payroll.normalizeWorkShifts(state.workShifts);
  const xodimlar = exported.sheets.find((sheet) => sheet.name === 'HALO XODIMLAR');
  const october = xodimlar.rows.filter((row) => row[0] === '2026-10');
  assert.equal(october.length, staff.filter((member) => member.active || shifts.some((shift) => shift.staffId === member.id)).length);
  for (const row of october) {
    const member = staff.find((item) => item.name === row[1]);
    const expected = payroll.calculatePayroll(member, shifts, payroll.normalizePayrollAdjustments(state.payrollAdjustments), '2026-10', { attendanceDays: payroll.normalizeAttendanceDays(state.attendanceDays), payments: [] });
    assert.equal(row[8], Math.round(expected.grossPay), row[1]);
    assert.equal(row[3], expected.workedDays);
  }
});

test('Google Sheets eksporti bir yillik katta ma’lumotda ham tez: ish haqi har kun uchun qaytadan hisoblanmaydi', () => {
  // Avval shu hajmda bitta so'rov 10 soniyadan ortiq protsessor vaqti olar edi va Cloudflare uni to'xtatar edi.
  const state = branch(41, 200, 8);
  const started = process.cpuUsage();
  const exported = sheets.buildGoogleSheetsExport(state, day(364), TODAY);
  const used = process.cpuUsage(started);
  assert.equal(exported.sheets.find((sheet) => sheet.name === 'HALO KUNLIK').rows.length, 365);
  assert.ok((used.user + used.system) / 1000 < 4000, `eksport juda sekin: ${Math.round((used.user + used.system) / 1000)} ms`);
});

/* ---------- so'rov manzili va tekshiruv ---------- */
const sqlite = new DatabaseSync(':memory:');
const stmt = (q, p = []) => ({ bind: (...v) => stmt(q, v), all: async () => ({ results: sqlite.prepare(q).all(...p) }), first: async () => sqlite.prepare(q).get(...p) ?? null, run: async () => { const r = sqlite.prepare(q).run(...p); return { meta: { changes: Number(r.changes) } }; }, _exec: () => sqlite.prepare(q).run(...p) });
const queries = [];
globalThis.__HALO_CONTROL_DB__ = { prepare: (q) => { queries.push(q); return stmt(q); }, batch: async (list) => { sqlite.exec('BEGIN'); try { const out = list.map((s) => s._exec()); sqlite.exec('COMMIT'); return out; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
const owner = { 'oai-authenticated-user-email': 'rahbar@example.com', 'content-type': 'application/json' };
const admin = await import('../app/api/admin/integrations/route.ts');
const sheetsRoute = await import('../app/api/integrations/v1/google-sheets/route.ts');
const store = await import('../app/lib/halo-store.ts');
const post = async (body) => (await admin.POST(new Request('https://halo.example/api/admin/integrations', { method: 'POST', headers: owner, body: JSON.stringify(body) }))).json();
const sheetGet = (key, query = '') => sheetsRoute.GET(new Request(`https://halo.example/api/integrations/v1/google-sheets${query}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }));
const saveState = async (patch) => { const current = await store.readHaloState('main'); return store.replaceHaloState({ ...current.state, ...patch }, current.updatedAt, 'main', 'Sinov', 'sinov', 'Sinov'); };

test('ulash: skript shu sayt manziliga yoziladi; tekshiruv tugmasi sayt tomonini sinaydi; xato sababi yashirilmaydi', async () => {
  globalThis.__HALO_SELF_HOSTED__ = true;
  const setup = await post({ action: 'setup-google-sheets', branchId: 'main' });
  assert.equal(setup.ok, true);
  assert.match(setup.googleSheetsScript, /endpoint: "https:\/\/halo\.example\/api\/integrations\/v1\/google-sheets"/);
  assert.match(setup.googleSheetsScript, /scriptVersion: "3\.5"/);
  const key = setup.createdKey.key;
  const small = branch(51, 12, 3);
  await saveState(small);

  const check = await post({ action: 'check-google-sheets', branchId: 'main' });
  assert.equal(check.check.ok, true);
  assert.equal(check.check.sheets.length, 10);
  assert.equal(check.check.sheets.find((sheet) => sheet.name === 'HALO KUNLIK').rows, 365);

  assert.equal((await sheetGet('')).status, 401);
  const first = await sheetGet(key, `?from=${day(30)}&to=${TODAY}`);
  assert.equal(first.status, 200);
  const payload = await first.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.sheets.length, 10);

  // O'zgarmagan bo'lsa: butun baza o'qilmaydi (app_state.payload so'ralmaydi), javob o'sha shaklda.
  queries.length = 0;
  const same = await (await sheetGet(key, `?from=${day(30)}&to=${TODAY}&if_updated_at=${encodeURIComponent(payload.updatedAt)}&if_export_version=${payload.exportVersion}`)).json();
  assert.deepEqual(same, { ok: true, unchanged: true, branchId: 'main', updatedAt: payload.updatedAt, exportVersion: payload.exportVersion, from: day(30), to: TODAY });
  assert.ok(!queries.some((q) => /SELECT payload/.test(q)), 'o‘zgarmagan holatda baza to‘liq o‘qilmasin');
  // Eski versiya belgisi yoki boshqa holat — to'liq hisobot qaytadi.
  assert.equal((await (await sheetGet(key, `?from=${day(30)}&to=${TODAY}&if_updated_at=${encodeURIComponent(payload.updatedAt)}&if_export_version=2.9`)).json()).unchanged, undefined);

  // Noto'g'ri yozuv: hisobot rad etiladi va sababi jadvalga ham, tekshiruvga ham, jurnalga ham yoziladi.
  await saveState({ transactions: [...small.transactions, { id: 'buzuq', supplierId: 's0', type: 'purchase', amount: 100.5, date: TODAY }] });
  const broken = await sheetGet(key, `?from=${day(30)}&to=${TODAY}`);
  assert.equal(broken.status, 500);
  const reason = (await broken.json()).error;
  assert.match(reason, /^Google Sheets hisoboti ochilmadi\. Sabab: Yetkazib beruvchi oldi-berdisining \d+-yozuvini tekshiring\.$/);
  const failed = await post({ action: 'check-google-sheets', branchId: 'main' });
  assert.equal(failed.check.ok, false);
  assert.match(failed.check.error, /oldi-berdisining \d+-yozuvini tekshiring/);
  assert.ok(failed.logs.some((log) => log.status === 500 && /oldi-berdisining/.test(log.message)));
  await saveState({ transactions: small.transactions });
  assert.equal((await sheetGet(key, `?from=${day(30)}&to=${TODAY}`)).status, 200);
});

test('o‘z hostingda jadval so‘rovi avtomatik xabarlarni ishga tushirmaydi (ularni cron yuboradi); eski platformada avvalgidek', async () => {
  const setup = await post({ action: 'setup-google-sheets', branchId: 'main' });
  const key = setup.createdKey.key;
  const seen = async () => String((((await store.readHaloState('main')).state.vegetableExpenseSettings) || {}).schedulerSeenAt || '');
  await saveState({ vegetableExpenseSettings: {} });
  globalThis.__HALO_SELF_HOSTED__ = true;
  assert.equal((await sheetGet(key)).status, 200);
  assert.equal(await seen(), '', 'o‘z hostingda jadval so‘rovi holatni o‘zgartirmaydi');
  globalThis.__HALO_SELF_HOSTED__ = undefined;
  assert.equal((await sheetGet(key)).status, 200);
  assert.notEqual(await seen(), '', 'eski platformada jadval so‘rovi kunlik tekshiruvni belgilaydi');
  globalThis.__HALO_SELF_HOSTED__ = true;
});

/* ---------- skriptning o'zi (Apps Script muhitini soddalashtirilgan nusxasida) ---------- */
function appsScript(script, respond) {
  const book = { sheets: new Map(), toasts: [] };
  const cell = (sheet) => new Proxy({}, { get: (_, name) => name === 'getValue' ? () => '' : name === 'getValues' ? () => [[]] : name === 'setValues' ? (values) => { sheet.writes.push(values); return cell(sheet); } : () => cell(sheet) });
  const makeSheet = (name) => {
    const sheet = { name, writes: [] };
    return new Proxy(sheet, { get: (target, prop) => prop in target ? target[prop] : prop === 'getName' ? () => name : prop === 'getFilter' ? () => null : prop === 'getCharts' ? () => [] : prop === 'getLastRow' || prop === 'getLastColumn' ? () => 1 : prop === 'getRange' || prop === 'getDataRange' ? () => cell(sheet) : () => undefined });
  };
  const spreadsheet = new Proxy(book, { get: (target, prop) => prop in target ? target[prop]
    : prop === 'getSheetByName' ? (name) => target.sheets.get(name) || null
    : prop === 'insertSheet' ? (name) => { const sheet = makeSheet(name); target.sheets.set(name, sheet); return sheet; }
    : prop === 'getSheets' ? () => [...target.sheets.values()]
    : prop === 'toast' ? (text, title) => { target.toasts.push(`${title}: ${text}`); }
    : () => undefined });
  const triggers = [];
  const builder = (handler) => { const self = { timeBased: () => self, everyMinutes: () => self, forSpreadsheet: () => self, onEdit: () => self, create: () => { triggers.push({ getHandlerFunction: () => handler }); } }; return self; };
  const properties = new Map();
  const context = {
    console, Date, JSON, Math, String, Number, Boolean, Array, Object, Error, isNaN,
    SpreadsheetApp: { getActive: () => spreadsheet, getUi: () => ({ createMenu: () => new Proxy({}, { get: () => () => undefined }) }), flush: () => undefined, newDataValidation: () => new Proxy({}, { get: (_, name, self) => () => self }) },
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: (trigger) => { triggers.splice(triggers.indexOf(trigger), 1); }, newTrigger: builder },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    PropertiesService: { getDocumentProperties: () => ({ getProperty: (name) => properties.get(name) || null, setProperties: (values) => { for (const [name, value] of Object.entries(values)) properties.set(name, String(value)); } }) },
    Utilities: { formatDate: (date, zone, format) => { const iso = new Date(date.getTime() + 9 * 36e5).toISOString(); return format === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' '); } },
    UrlFetchApp: { fetch: (url, options) => { const answer = respond(url, options); if (answer instanceof Error) throw answer; return { getResponseCode: () => answer.status, getContentText: () => answer.body }; } },
  };
  vm.createContext(context);
  vm.runInContext(`${script}\nthis.HALO_SETUP = HALO_SETUP; this.HALO_SYNC = HALO_SYNC;`, context);
  const status = () => { const writes = book.sheets.get('HALO ULANISH')?.writes || []; const last = writes.at(-1) || []; return { holat: last[1]?.[1], izoh: last[4]?.[1] }; };
  return { context, book, triggers, properties, status };
}

test('skript: sayt javobini qabul qiladi va 10 ta oynani yozadi; sayt javob bermasa tushunarli xabar beradi', async () => {
  const setup = await post({ action: 'setup-google-sheets', branchId: 'main' });
  const script = setup.googleSheetsScript, key = setup.createdKey.key;
  const calls = [];
  // Haqiqiy manzil javobi oldindan olinadi (Apps Script so'rovi sinxron).
  const live = async (url) => { const response = await sheetsRoute.GET(new Request(url, { headers: { Authorization: `Bearer ${key}` } })); return { status: response.status, body: await response.text() }; };
  const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * 864e5).toISOString().slice(0, 10);
  const answer = await live(`https://halo.example/api/integrations/v1/google-sheets?from=${from}&to=${today}`);
  assert.equal(answer.status, 200);

  const ok = appsScript(script, (url, options) => { calls.push({ url, options }); return answer; });
  ok.context.HALO_SETUP();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://halo.example/api/integrations/v1/google-sheets?from=${from}&to=${today}`);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${key}`);
  assert.deepEqual([...ok.book.sheets.keys()].sort(), ['HALO CHIQIM', 'HALO DELIVERY', 'HALO HISOBOT', 'HALO KUNLIK', 'HALO OMBOR', 'HALO PUL HARAKATI', 'HALO SABZAVOT SARFI', 'HALO SAVDO', 'HALO ULANISH', 'HALO XODIMLAR', 'HALO YETKAZUVCHILAR']);
  assert.equal(ok.book.sheets.get('HALO KUNLIK').writes[0].length, 366, 'sarlavha + 365 kun');
  assert.deepEqual(ok.triggers.map((trigger) => trigger.getHandlerFunction()).sort(), ['HALO_DATE_EDIT', 'HALO_SYNC']);
  assert.equal(ok.status().holat, 'ISHLAYAPTI');
  assert.equal(ok.properties.get('HALO_LAST_RANGE'), `${from}|${today}`);

  // Cloudflare xato sahifasi (JSON emas): tushunarsiz "Unexpected token <" o'rniga aniq xabar.
  const down = appsScript(script, () => ({ status: 503, body: '<!DOCTYPE html><html><title>Worker exceeded resource limits</title></html>' }));
  assert.throws(() => down.context.HALO_SYNC(), /HALO Control javob bermadi \(HTTP 503\)/);
  assert.equal(down.status().holat, 'XATO');
  assert.match(down.status().izoh, /HTTP 503/);
  assert.equal(down.book.sheets.has('HALO KUNLIK'), false, 'xato javobda jadvalga hech narsa yozilmaydi');
  // Sayt rad etgan hisobot: sayt bergan sabab ko'rinadi.
  const refused = appsScript(script, () => ({ status: 500, body: JSON.stringify({ ok: false, error: 'Google Sheets hisoboti ochilmadi. Sabab: Yetkazib beruvchi oldi-berdisining 3-yozuvini tekshiring.' }) }));
  assert.throws(() => refused.context.HALO_SYNC(), /Sabab: Yetkazib beruvchi oldi-berdisining 3-yozuvini tekshiring\./);
  // Kalit bekor qilingan va tarmoq xatosi.
  assert.throws(() => appsScript(script, () => ({ status: 401, body: 'Unauthorized' })).context.HALO_SYNC(), /ulanish kaliti bekor bo‘lgan/);
  assert.throws(() => appsScript(script, () => new Error('DNS error')).context.HALO_SYNC(), /saytiga ulanib bo‘lmadi[\s\S]*DNS error/);
});
