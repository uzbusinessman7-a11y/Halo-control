/**
 * HALO SABZAVOT SARFI — mavjud Google Sheets hisobiga qo‘shimcha.
 * 1. Eski Code.gs ni O‘CHIRMANG.
 * 2. Apps Script ichida + → Script → HALO_SABZAVOT nomli yangi fayl yarating.
 * 3. Shu kodni joylang, saqlang, HALO_SABZAVOT_SETUP funksiyasini bir marta ishga tushiring.
 * Mavjud HALO_CONFIG kalitidan foydalanadi; eski varaqlarni o‘zgartirmaydi.
 * exportVersion 3.1 saqlandi. Kalitingizni chatga yubormang.
 */
function HALO_SABZAVOT_SETUP() {
  if (typeof HALO_CONFIG === 'undefined' || !HALO_CONFIG.endpoint || !HALO_CONFIG.apiKey) {
    throw new Error('Avval HALO Control → API va ulanishlar → Google Sheets orqali asosiy kodni o‘rnating.');
  }
  HALO_SABZAVOT_SYNC();
  var exists = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'HALO_SABZAVOT_SYNC'; });
  if (!exists) ScriptApp.newTrigger('HALO_SABZAVOT_SYNC').timeBased().everyMinutes(1).create();
  SpreadsheetApp.getActive().toast('Sabzavot varag‘i ulandi. Savdo va sarf tahlili har kuni 09:00 dan keyingi avtomatik tekshiruvda Telegramga yuboriladi.', 'HALO', 10);
}

function HALO_SABZAVOT_SYNC() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return;
  try {
    var book = SpreadsheetApp.getActive();
    var range = HALO_SABZAVOT_RANGE_(book);
    var props = PropertiesService.getDocumentProperties();
    var rangeKey = range.from + '|' + range.to;
    var url = HALO_CONFIG.endpoint + '?from=' + encodeURIComponent(range.from) + '&to=' + encodeURIComponent(range.to);
    var tabName = 'HALO SABZAVOT SARFI';
    var sheet = book.getSheetByName(tabName);
    if (sheet && props.getProperty('HALO_VEG_RANGE') === rangeKey && props.getProperty('HALO_VEG_REVISION')) {
      url += '&if_updated_at=' + encodeURIComponent(props.getProperty('HALO_VEG_REVISION')) + '&if_export_version=3.1';
    }
    var response = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: 'Bearer ' + HALO_CONFIG.apiKey }, muteHttpExceptions: true });
    var payload = JSON.parse(response.getContentText() || '{}');
    if (response.getResponseCode() !== 200 || !payload.ok) throw new Error(payload.error || 'HALO hisoboti olinmadi.');
    if (payload.branchId !== HALO_CONFIG.branchId || payload.from !== range.from || payload.to !== range.to) throw new Error('Filial yoki sana mos emas. Hech qaysi varaq o‘zgarmadi.');
    if (payload.unchanged === true) return;
    var source = (payload.sheets || []).filter(function(s) { return s.name === tabName; })[0];
    var headers = ['Sana', 'Mahsulot', 'Miqdor', 'Summa (₩)', 'Yetkazib beruvchi'];
    if (!source || JSON.stringify(source.headers) !== JSON.stringify(headers) || !Array.isArray(source.rows) || !source.rows.every(function(r) { return Array.isArray(r) && r.length === 5; })) throw new Error('Sabzavot ustunlari mos emas. Eski varaq saqlandi.');
    if (!sheet) sheet = book.insertSheet(tabName);
    var values = [headers].concat(source.rows);
    // All checks happen before touching this one tab. No other sheet is written, moved or deleted.
    sheet.getDataRange().clearContent();
    sheet.getRange(1, 1, values.length, 5).setValues(values);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 5).setBackground('#20392d').setFontColor('#ffffff').setFontWeight('bold');
    if (source.rows.length) sheet.getRange(2, 4, source.rows.length, 1).setNumberFormat('#,##0');
    sheet.autoResizeColumns(1, 5);
    props.setProperties({ HALO_VEG_RANGE: rangeKey, HALO_VEG_REVISION: payload.updatedAt || '' });
  } finally { lock.releaseLock(); }
}

// Read the existing report's date cells without invoking helpers that initialize
// or rewrite that report. This add-on only writes HALO SABZAVOT SARFI.
function HALO_SABZAVOT_RANGE_(book) {
  var days = Number(HALO_CONFIG.days) || 30;
  var fallback = {
    from: Utilities.formatDate(new Date(Date.now() - (days - 1) * 86400000), 'Asia/Seoul', 'yyyy-MM-dd'),
    to: Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')
  };
  var report = book.getSheetByName('HALO HISOBOT');
  if (!report) return fallback;
  function iso(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
    return String(value || '').trim();
  }
  var from = iso(report.getRange('B2').getValue()), to = iso(report.getRange('B3').getValue());
  if (!from && !to) return fallback;
  function valid(value) {
    var date = new Date(value + 'T00:00:00Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  var span = (new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000 + 1;
  if (!valid(from) || !valid(to) || span < 1 || span > 366) throw new Error('HALO HISOBOT B2–B3 sanalarini tekshiring (1–366 kun).');
  return { from: from, to: to };
}
