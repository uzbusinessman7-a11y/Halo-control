import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('Sheets add-on changes only its tab, retains existing triggers and refuses invalid payloads', () => {
  const tabs = new Map(), writes = [], triggers = ['HALO_AUTO_SYNC'];
  const properties = new Map();
  let fetchCount = 0, unlocked = 0;
  const oldReport = { getRange(cell) { return { getValue() { return cell === 'B2' ? '2026-09-01' : '2026-09-30'; } }; } };
  tabs.set('HALO HISOBOT', oldReport);
  tabs.set('HALO SAVDO', Object.freeze({ old: 'preserved' }));
  const originalSales = tabs.get('HALO SAVDO');
  let payload = { ok: true, branchId: 'main', from: '2026-09-01', to: '2026-09-30', updatedAt: 'v1', sheets: [
    { name: 'HALO SABZAVOT SARFI', headers: ['Sana', 'Mahsulot', 'Miqdor', 'Summa (₩)', 'Yetkazib beruvchi'], rows: [['2026-09-25', 'KARAM', '2 kg', 6000, 'Nodir aka']] },
  ] };
  const book = { getSheetByName: name => tabs.get(name), toast() {}, insertSheet(name) {
    assert.equal(name, 'HALO SABZAVOT SARFI');
    const chain = { setValues(values) { writes.push(structuredClone(values)); return this; }, setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; }, setNumberFormat() { return this; } };
    const sheet = { getDataRange: () => ({ clearContent() { writes.push('clear'); } }), getRange: () => chain, setFrozenRows() {}, autoResizeColumns() {} };
    tabs.set(name, sheet); return sheet;
  } };
  const sandbox = {
    HALO_CONFIG: { endpoint: 'https://local-test.invalid/export', apiKey: 'local-fake-key', branchId: 'main', days: 30 },
    SpreadsheetApp: { getActive: () => book },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() { unlocked++; } }) },
    PropertiesService: { getDocumentProperties: () => ({ getProperty: key => properties.get(key), setProperties(values) { Object.entries(values).forEach(([k, v]) => properties.set(k, v)); } }) },
    Utilities: { formatDate: date => date.toISOString().slice(0, 10) },
    UrlFetchApp: { fetch(url, options) { fetchCount++; assert.equal(options.headers.Authorization, 'Bearer local-fake-key'); assert.ok(url.includes('from=2026-09-01')); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(payload) }; } },
    ScriptApp: { getProjectTriggers: () => triggers.map(name => ({ getHandlerFunction: () => name })), newTrigger(name) { return { timeBased() { return this; }, everyMinutes(value) { assert.equal(value, 1); return this; }, create() { triggers.push(name); } }; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../public/HALO_SABZAVOT_Code.gs', import.meta.url), 'utf8'), sandbox);
  sandbox.HALO_SABZAVOT_SETUP();
  assert.deepEqual(writes.at(-1), [payload.sheets[0].headers, ...payload.sheets[0].rows]);
  const firstWrites = writes.length;
  payload = { ...payload, unchanged: true };
  sandbox.HALO_SABZAVOT_SETUP();
  assert.equal(writes.length, firstWrites);
  assert.deepEqual(triggers, ['HALO_AUTO_SYNC', 'HALO_SABZAVOT_SYNC']);
  payload = { ...payload, unchanged: false, branchId: 'other' };
  assert.throws(() => sandbox.HALO_SABZAVOT_SYNC(), /Filial/);
  payload = { ...payload, branchId: 'main', sheets: [{ ...payload.sheets[0], rows: [['bad']] }] };
  assert.throws(() => sandbox.HALO_SABZAVOT_SYNC(), /ustunlari/);
  assert.equal(writes.length, firstWrites);
  assert.equal(tabs.get('HALO HISOBOT'), oldReport);
  assert.equal(tabs.get('HALO SAVDO'), originalSales);
  assert.equal(fetchCount, 4); assert.equal(unlocked, 4);
});
