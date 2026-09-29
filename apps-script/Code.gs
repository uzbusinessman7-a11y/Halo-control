const HALO_CONFIG = Object.freeze({
  scriptVersion: "3.4",
  exportVersion: "3.1",
  endpoint: "https://halo-control.uzbusinessman7.chatgpt.site/api/integrations/v1/google-sheets",
  apiKey: "XXXX",
  branchId: "main",
  days: 365,
  timezone: "Asia/Seoul"
});

const HALO_REPORT_SHEETS = [
  "HALO HISOBOT",
  "HALO KUNLIK",
  "HALO SAVDO",
  "HALO DELIVERY",
  "HALO PUL HARAKATI",
  "HALO OMBOR",
  "HALO CHIQIM",
  "HALO YETKAZUVCHILAR",
  "HALO XODIMLAR",
  "HALO SABZAVOT SARFI"
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("HALO CONTROL")
    .addItem("Hisobotni ochish", "HALO_OPEN_REPORT")
    .addItem("Sana oralig‘ini tanlash", "HALO_OPEN_DATE_RANGE")
    .addItem("Hozir yangilash", "HALO_SYNC")
    .addItem("Grafiklarni yangilash", "HALO_REFRESH_CHARTS")
    .addSeparator()
    .addItem("1 daqiqalik avtomatik yangilashni yoqish", "HALO_SETUP")
    .addToUi();
}

function HALO_OPEN_REPORT() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName("HALO HISOBOT");
  if (!sheet) {
    HALO_SYNC();
    sheet = book.getSheetByName("HALO HISOBOT");
  }
  if (!sheet) throw new Error("HALO HISOBOT oynasi yaratilmadi.");
  haloEnsureDateRange_(sheet);
  sheet.activate();
  book.toast("B2 va B3 kataklaridan sana tanlang. Bitta kun uchun ikkala sanani ham bir xil qo‘ying.", "HALO HISOBOT", 9);
}

function HALO_OPEN_DATE_RANGE() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName("HALO HISOBOT");
  if (!sheet) {
    HALO_SYNC();
    sheet = book.getSheetByName("HALO HISOBOT");
  }
  if (!sheet) throw new Error("HALO HISOBOT oynasi yaratilmadi.");
  haloEnsureDateRange_(sheet);
  sheet.activate();
  book.setActiveRange(sheet.getRange("B2:B3"));
  book.toast("Sariq B2 va B3 kataklaridan sanani tanlang.", "SANA ORALIG‘I", 7);
}

function HALO_SETUP() {
  const book = SpreadsheetApp.getActive();
  book.setSpreadsheetTimeZone(HALO_CONFIG.timezone);
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) { return ["HALO_SYNC", "HALO_DATE_EDIT"].indexOf(trigger.getHandlerFunction()) >= 0; })
    .forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  HALO_SYNC({ haloSetup: true });
  ScriptApp.newTrigger("HALO_SYNC").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("HALO_DATE_EDIT").forSpreadsheet(book).onEdit().create();
  const handlers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
  if (handlers.indexOf("HALO_SYNC") < 0 || handlers.indexOf("HALO_DATE_EDIT") < 0) {
    haloTrySyncStatus_("XATO", "Avtomatik yangilash vazifasi yaratilmadi");
    throw new Error("Avtomatik yangilash vazifasi yaratilmadi. HALO_SETUP’ni qayta ishga tushiring.");
  }
  haloTrySyncStatus_("ISHLAYAPTI", "HALO’dagi yangi ma’lumotlar 1 daqiqa ichida avtomatik tushadi");
  const report = book.getSheetByName("HALO HISOBOT");
  if (report) report.activate();
  book.toast("Tayyor: 10 ta aniq hisobot oynasi avtomatik yangilanadi", "HALO ULANDI", 9);
}

function HALO_SYNC(event) {
  const silent = Boolean(event && (event.triggerUid || event.haloSetup));
  try {
    const selected = haloSelectedRange_();
    haloFetchAndWrite_(selected.from, selected.to, silent);
    if (!silent) haloTrySyncStatus_("ISHLAYAPTI", "Oxirgi tekshiruv muvaffaqiyatli. HALO o‘zgarsa avtomatik yangilanadi");
  } catch (error) {
    haloTrySyncStatus_("XATO", error && error.message ? error.message : String(error || "Noma’lum xato"));
    throw error;
  }
}

function HALO_REFRESH_CHARTS() {
  const book = SpreadsheetApp.getActive();
  haloBuildAnalysisCharts_(book);
  book.toast("Grafiklar yangilandi.", "HALO HISOBOT", 5);
}

function HALO_DATE_EDIT(event) {
  if (!event || !event.range || event.range.getSheet().getName() !== "HALO HISOBOT") return;
  const range = event.range;
  const firstRow = range.getRow();
  const lastRow = firstRow + range.getNumRows() - 1;
  const firstColumn = range.getColumn();
  const lastColumn = firstColumn + range.getNumColumns() - 1;
  const editsB2 = firstRow <= 2 && lastRow >= 2 && firstColumn <= 2 && lastColumn >= 2;
  const editsB3 = firstRow <= 3 && lastRow >= 3 && firstColumn <= 2 && lastColumn >= 2;
  if (!editsB2 && !editsB3) return;
  try {
    const selected = haloSelectedRange_();
    haloFetchAndWrite_(selected.from, selected.to, false);
    haloTrySyncStatus_("ISHLAYAPTI", selected.from + " — " + selected.to + " hisoboti yangilandi");
  } catch (error) {
    SpreadsheetApp.getActive().toast(error && error.message ? error.message : String(error), "SANA XATO", 8);
  }
}

function haloTrySyncStatus_(status, detail) {
  try {
    haloSyncStatus_(status, detail);
  } catch (error) {
    console.log("HALO holat oynasi vaqtincha yangilanmadi: " + String(error));
  }
}

function haloSyncStatus_(status, detail) {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName("HALO ULANISH");
  if (!sheet) sheet = book.insertSheet("HALO ULANISH", 0);
  const handlers = ScriptApp.getProjectTriggers().map(function(trigger) { return trigger.getHandlerFunction(); });
  const automatic = handlers.indexOf("HALO_SYNC") >= 0;
  const checkedAt = Utilities.formatDate(new Date(), HALO_CONFIG.timezone, "yyyy-MM-dd HH:mm:ss");
  sheet.getRange("A1:B6").setValues([
    ["HALO → GOOGLE SHEETS", "AVTOMATIK ALOQA"],
    ["Holat", status],
    ["Oxirgi tekshiruv", checkedAt],
    ["1 daqiqalik yangilash", automatic ? "YOQILGAN" : "HALO_SETUP KUTILMOQDA"],
    ["Izoh", detail],
    ["Kod versiyasi", HALO_CONFIG.scriptVersion]
  ]);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 190);
  sheet.setColumnWidth(2, 430);
  sheet.getRange("A1:B1").setBackground("#15181b").setFontColor("#f4b41b").setFontWeight("bold");
  sheet.getRange("A2:A6").setBackground("#eef3ef").setFontWeight("bold");
  sheet.getRange("B2").setBackground(status === "ISHLAYAPTI" ? "#d9ead3" : status === "XATO" ? "#f4cccc" : "#fff2cc")
    .setFontColor(status === "ISHLAYAPTI" ? "#1b5e20" : status === "XATO" ? "#9c0006" : "#7f6000")
    .setFontWeight("bold");
  sheet.setTabColor(status === "ISHLAYAPTI" ? "#34a853" : status === "XATO" ? "#d93025" : "#f4b41b");
}

function haloFetchAndWrite_(from, to, silent) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    if (!silent) SpreadsheetApp.getActive().toast("Boshqa yangilash davom etmoqda. Bir ozdan keyin qayta urinib ko‘ring.", "HALO CONTROL", 6);
    return;
  }
  try {
    const properties = PropertiesService.getDocumentProperties();
    const rangeKey = from + "|" + to;
    const previousRange = properties.getProperty("HALO_LAST_RANGE") || "";
    const previousVersion = properties.getProperty("HALO_LAST_STATE_VERSION") || "";
    const previousExportVersion = properties.getProperty("HALO_LAST_EXPORT_VERSION") || "";
    let url = HALO_CONFIG.endpoint + "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
    if (previousRange === rangeKey && previousVersion) {
      url += "&if_updated_at=" + encodeURIComponent(previousVersion);
      url += "&if_export_version=" + encodeURIComponent(previousExportVersion);
    }
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + HALO_CONFIG.apiKey },
      muteHttpExceptions: true
    });
    const payload = JSON.parse(response.getContentText() || "{}");
    if (response.getResponseCode() === 401) {
      throw new Error("HALO ulanish kaliti bekor bo‘lgan. HALO Control ichidan yangi kod yarating, Code.gs kodini to‘liq almashtiring va HALO_SETUP’ni ishga tushiring.");
    }
    if (response.getResponseCode() !== 200 || !payload.ok) throw new Error(payload.error || "HALO Control ma’lumoti olinmadi");
    if (payload.branchId !== HALO_CONFIG.branchId) throw new Error("Filial mos kelmadi. Google Sheets kodi shu filial uchun qayta yaratilishi kerak.");
    if (payload.from !== from || payload.to !== to) throw new Error("So‘ralgan sana bilan kelgan hisobot sanasi mos kelmadi. Eski hisobot saqlandi.");
    if (payload.exportVersion !== HALO_CONFIG.exportVersion) throw new Error("HALO va Google Sheets hisobot versiyasi mos kelmadi. HALO Control ichidan yangi Code.gs kodini oling.");
    if (payload.unchanged === true) {
      if (!silent) SpreadsheetApp.getActive().toast(from + " — " + to + " ma’lumoti o‘zgarmagan", "HALO CONTROL", 5);
      return;
    }
    if (!Array.isArray(payload.sheets) || !payload.sheets.every(haloValidSource_)) {
      throw new Error("HALO Control hisobotining qator yoki ustunlari mos kelmadi. Eski hisobot saqlandi.");
    }
    const sources = HALO_REPORT_SHEETS.map(function(name) {
      return payload.sheets.find(function(source) { return source.name === name; });
    });
    if (sources.some(function(source) { return !source; })) {
      throw new Error(HALO_REPORT_SHEETS.length + " ta majburiy hisobotdan biri kelmadi. Eski hisobot saqlandi.");
    }
    const book = SpreadsheetApp.getActive();
    sources.forEach(function(source) { haloWriteSheet_(book, source); });
    // Existing tabs are retained; the vegetable tab is additive.
    haloOrderSheets_(book);
    SpreadsheetApp.flush();
    properties.setProperties({
      HALO_LAST_SYNC: payload.generatedAt || new Date().toISOString(),
      HALO_LAST_STATE_VERSION: payload.updatedAt || "",
      HALO_LAST_EXPORT_VERSION: payload.exportVersion || "",
      HALO_LAST_RANGE: rangeKey,
      HALO_BRANCH_ID: payload.branchId,
      HALO_SCRIPT_VERSION: HALO_CONFIG.scriptVersion
    });
    if (!silent) book.toast(from + " — " + to + " bo‘yicha " + HALO_REPORT_SHEETS.length + " ta hisobot yangilandi", "HALO CONTROL", 7);
  } finally {
    lock.releaseLock();
  }
}

function haloValidSource_(source) {
  return source
    && typeof source.name === "string"
    && Array.isArray(source.headers)
    && source.headers.length > 0
    && Array.isArray(source.rows)
    && source.rows.every(function(row) { return Array.isArray(row) && row.length === source.headers.length; });
}

function haloRemoveLegacySheets_(book) {
  [
    "HALO DASHBOARD", "HALO KUNLIK TAHLIL", "HALO SANA TAHLILI", "HALO KUNLIK HISOBOT",
    "HALO KUNLIK SAVDO", "HALO XARAJATLAR", "HALO BOSHQA KIRIMLAR", "HALO CHICKEN MOYI",
    "HALO OMBOR CHIQIMI", "HALO MAHSULOT TAHLILI", "HALO MAHSULOTLAR",
    "HALO YETKAZUVCHI TAHLILI", "HALO OLDI-BERDI", "HALO NAKLADNOYLAR", "HALO QARZ TO‘LOVLARI"
  ].forEach(function(name) {
    const sheet = book.getSheetByName(name);
    if (sheet && book.getSheets().length > 1) book.deleteSheet(sheet);
  });
}

function haloOrderSheets_(book) {
  const connection = book.getSheetByName("HALO ULANISH");
  if (connection) {
    book.setActiveSheet(connection);
    book.moveActiveSheet(1);
  }
  HALO_REPORT_SHEETS.forEach(function(name, index) {
    const sheet = book.getSheetByName(name);
    if (!sheet) return;
    book.setActiveSheet(sheet);
    book.moveActiveSheet(index + 2);
  });
  const report = book.getSheetByName("HALO HISOBOT");
  if (report) report.activate();
}

function haloSelectedRange_() {
  const now = new Date();
  const start = new Date(now.getTime() - (HALO_CONFIG.days - 1) * 86400000);
  const fallback = {
    from: Utilities.formatDate(start, HALO_CONFIG.timezone, "yyyy-MM-dd"),
    to: Utilities.formatDate(now, HALO_CONFIG.timezone, "yyyy-MM-dd")
  };
  const sheet = SpreadsheetApp.getActive().getSheetByName("HALO HISOBOT");
  if (!sheet) return fallback;
  haloEnsureDateRange_(sheet, fallback);
  const from = haloIsoDate_(sheet.getRange("B2").getValue());
  const to = haloIsoDate_(sheet.getRange("B3").getValue());
  if (!from || !to) throw new Error("Boshlanish va tugash sanalarini to‘g‘ri kiriting.");
  const fromTime = new Date(from + "T00:00:00Z").getTime();
  const toTime = new Date(to + "T00:00:00Z").getTime();
  const rangeDays = Math.floor((toTime - fromTime) / 86400000) + 1;
  if (rangeDays < 1 || rangeDays > 366) throw new Error("Sana oralig‘i 1 kundan 366 kungacha bo‘lishi kerak.");
  return { from: from, to: to };
}

function haloEnsureDateRange_(sheet, fallback) {
  const now = new Date();
  const start = new Date(now.getTime() - (HALO_CONFIG.days - 1) * 86400000);
  const safeFallback = fallback || {
    from: Utilities.formatDate(start, HALO_CONFIG.timezone, "yyyy-MM-dd"),
    to: Utilities.formatDate(now, HALO_CONFIG.timezone, "yyyy-MM-dd")
  };
  const fromValue = sheet.getRange("B2").getValue();
  const toValue = sheet.getRange("B3").getValue();
  const currentFrom = haloIsoDate_(fromValue);
  const currentTo = haloIsoDate_(toValue);
  const labelsPresent = String(sheet.getRange("A2").getValue() || "") === "Boshlanish sanasi"
    && String(sheet.getRange("A3").getValue() || "") === "Tugash sanasi";
  if (!labelsPresent || !(fromValue instanceof Date) || !(toValue instanceof Date) || !currentFrom || !currentTo) {
    sheet.getRange("A2:B3").setValues([
      ["Boshlanish sanasi", new Date((currentFrom || safeFallback.from) + "T00:00:00Z")],
      ["Tugash sanasi", new Date((currentTo || safeFallback.to) + "T00:00:00Z")]
    ]);
  }
  ["B2", "B3"].forEach(function(address) {
    sheet.getRange(address)
      .setNumberFormat("yyyy-mm-dd")
      .setBackground("#fff3c4")
      .setFontColor("#15181b")
      .setFontWeight("bold")
      .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  });
  sheet.getRange("A2:A3").setBackground("#fff8df").setFontWeight("bold");
  sheet.getRange("B2").setNote("Boshlanish sanasi. Bitta kun uchun B2 va B3 sanasini bir xil tanlang.");
  sheet.getRange("B3").setNote("Tugash sanasi. Sana o‘zgarsa hisobot avtomatik yangilanadi.");
}

function haloIsoDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, HALO_CONFIG.timezone, "yyyy-MM-dd");
  const source = String(value || "").trim().replace(/[.\/]/g, "-");
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? source : "";
}

function haloWriteSheet_(book, source) {
  let sheet = book.getSheetByName(source.name);
  if (!sheet) sheet = book.insertSheet(source.name);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getDataRange().clearContent();
  const values = [source.headers].concat(source.rows || []);
  const codeColumn = source.headers.indexOf("Kod") + 1;
  if (codeColumn > 0) {
    sheet.getRange(1, codeColumn, Math.max(1, values.length), 1).setNumberFormat("@");
  }
  sheet.getRange(1, 1, values.length, source.headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.setTabColor(source.name === "HALO HISOBOT" ? "#f4b41b" : "#34a853");
  sheet.getRange(1, 1, 1, source.headers.length)
    .setBackground("#15181b").setFontColor("#f4b41b").setFontWeight("bold").setHorizontalAlignment("center");
  const summarySheet = source.name === "HALO HISOBOT";
  if (values.length > 1) {
    sheet.getRange(2, 1, values.length - 1, source.headers.length).setVerticalAlignment("middle");
    if (!summarySheet) sheet.getRange(1, 1, values.length, source.headers.length).createFilter();
  }
  source.headers.forEach(function(header, index) {
    const column = index + 1;
    const rows = Math.max(1, values.length - 1);
    if (header === "Kod") sheet.getRange(2, column, rows, 1).setNumberFormat("@");
    if (header.indexOf("(₩)") >= 0) sheet.getRange(2, column, rows, 1).setNumberFormat("#,##0");
    if (header.indexOf("%") >= 0 || header.indexOf("marjasi") >= 0) sheet.getRange(2, column, rows, 1).setNumberFormat("0.0%");
  });
  if (source.name === "HALO SAVDO") {
    const soldMarginColumn = source.headers.indexOf("Sotuv paytidagi marja %") + 1;
    const currentMarginColumn = source.headers.indexOf("HALO joriy retsept marjasi %") + 1;
    if (soldMarginColumn > 0) sheet.getRange(1, soldMarginColumn).setNote(
      "Tanlangan sanalardagi savdo summasi va aynan sotuv vaqtida saqlangan tannarxdan hisoblanadi."
    );
    if (currentMarginColumn > 0) sheet.getRange(1, currentMarginColumn).setNote(
      "HALO Control → Retsept va marja oynasidagi hozirgi menyu narxi va hozirgi saqlangan retsept tannarxidan hisoblanadi."
    );
  }
  sheet.setColumnWidths(1, source.headers.length, 140);
  if (summarySheet) haloStyleSummary_(sheet, values);
  if (source.name === "HALO YETKAZUVCHILAR") haloStyleSuppliers_(sheet, source, values);
  if (source.name === "HALO OMBOR") haloStyleInventory_(sheet, source, values);
  if (source.name === "HALO XODIMLAR") haloStylePayroll_(sheet, source, values);
}

function haloStyleSummary_(sheet, values) {
  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 190);
  const rowCount = Math.max(1, values.length - 1);
  const backgrounds = [];
  const colors = [];
  const weights = [];
  const formats = [];
  for (let index = 1; index < values.length; index += 1) {
    const label = String(values[index][0] || "");
    const section = label.indexOf("— ") === 0;
    const check = label === "Hisob tekshiruvi";
    const ok = String(values[index][1] || "") === "MOS ✓";
    backgrounds.push([section ? "#eef3ef" : null, section ? "#eef3ef" : check ? (ok ? "#d9ead3" : "#fff2cc") : null]);
    colors.push([section ? "#15181b" : null, section ? "#15181b" : check ? (ok ? "#1b5e20" : "#7f6000") : null]);
    weights.push([section ? "bold" : "normal", "bold"]);
    formats.push([label.indexOf("marjasi") >= 0 || label.indexOf("foizi") >= 0 ? "0.0%" : label.indexOf("(₩)") >= 0 ? "#,##0" : "@"]) ;
  }
  if (values.length > 1) {
    sheet.getRange(2, 1, rowCount, 2).setBackgrounds(backgrounds).setFontColors(colors).setFontWeights(weights);
    sheet.getRange(2, 2, rowCount, 1).setNumberFormats(formats);
  }
  haloEnsureDateRange_(sheet);
}

function haloStyleSuppliers_(sheet, source, values) {
  sheet.setFrozenColumns(1);
  sheet.setColumnWidth(1, 240);
  [
    { header: "QARZ (₩)", background: "#f4cccc", color: "#9c0006" },
    { header: "AVANS (₩)", background: "#fff2cc", color: "#7f6000" },
    { header: "TO‘LIQ TO‘LANDI (₩)", background: "#d9ead3", color: "#1b5e20" },
    { header: "VOZVRAT QILINDI (₩)", background: "#d9eaf7", color: "#174ea6" }
  ].forEach(function(status) {
    const index = source.headers.indexOf(status.header);
    if (index < 0 || values.length <= 1) return;
    const active = values.slice(1).map(function(row) { return Number(row[index] || 0) > 0; });
    sheet.getRange(2, index + 1, values.length - 1, 1)
      .setNumberFormat("#,##0")
      .setFontWeight("bold")
      .setBackgrounds(active.map(function(value) { return [value ? status.background : null]; }))
      .setFontColors(active.map(function(value) { return [value ? status.color : null]; }));
  });
}

function haloStyleInventory_(sheet, source, values) {
  const index = source.headers.indexOf("Holat");
  if (index < 0 || values.length <= 1) return;
  const statuses = values.slice(1).map(function(row) { return String(row[index] || ""); });
  sheet.getRange(2, index + 1, statuses.length, 1)
    .setFontWeight("bold")
    .setBackgrounds(statuses.map(function(status) { return [status === "TUGAGAN" ? "#f4cccc" : status === "KAM" ? "#fff2cc" : "#d9ead3"]; }))
    .setFontColors(statuses.map(function(status) { return [status === "TUGAGAN" ? "#9c0006" : status === "KAM" ? "#7f6000" : "#1b5e20"]; }));
}

function haloStylePayroll_(sheet, source, values) {
  const index = source.headers.indexOf("Qolgan (₩)");
  if (index < 0 || values.length <= 1) return;
  const remaining = values.slice(1).map(function(row) { return Number(row[index] || 0); });
  sheet.getRange(2, index + 1, remaining.length, 1)
    .setBackgrounds(remaining.map(function(value) { return [value > 0 ? "#fff2cc" : "#d9ead3"]; }))
    .setFontColors(remaining.map(function(value) { return [value > 0 ? "#7f6000" : "#1b5e20"]; }))
    .setFontWeight("bold");
}

function haloHeaderColumn_(sheet, header) {
  if (!sheet || sheet.getLastColumn() < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.indexOf(header) + 1;
}

function haloBuildAnalysisCharts_(book) {
  const analysis = book.getSheetByName("HALO HISOBOT");
  const daily = book.getSheetByName("HALO KUNLIK");
  const products = book.getSheetByName("HALO SAVDO");
  if (!analysis) return;
  analysis.getCharts().forEach(function(chart) { analysis.removeChart(chart); });
  if (daily && daily.getLastRow() > 2) {
    const lastRow = daily.getLastRow();
    const dateColumn = haloHeaderColumn_(daily, "Sana");
    const revenueColumn = haloHeaderColumn_(daily, "Jami savdo (₩)");
    const profitColumn = haloHeaderColumn_(daily, "Sof foyda (₩)");
    if (dateColumn && revenueColumn && profitColumn) {
      analysis.insertChart(analysis.newChart().asLineChart()
        .addRange(daily.getRange(1, dateColumn, lastRow, 1))
        .addRange(daily.getRange(1, revenueColumn, lastRow, 1))
        .addRange(daily.getRange(1, profitColumn, lastRow, 1))
        .setOption("title", "Kunlik savdo va sof foyda").setOption("legend", { position: "bottom" }).setPosition(2, 4, 0, 0).build());
    }
    const taxableColumn = haloHeaderColumn_(daily, "POS / kiosk (₩)");
    const cashColumn = haloHeaderColumn_(daily, "Naqd (₩)");
    const bankColumn = haloHeaderColumn_(daily, "Hisob-raqam (₩)");
    if (dateColumn && taxableColumn && cashColumn && bankColumn) {
      analysis.insertChart(analysis.newChart().asColumnChart()
        .addRange(daily.getRange(1, dateColumn, lastRow, 1))
        .addRange(daily.getRange(1, taxableColumn, lastRow, 1))
        .addRange(daily.getRange(1, cashColumn, lastRow, 1))
        .addRange(daily.getRange(1, bankColumn, lastRow, 1))
        .setOption("title", "POS va naqd / hisob-raqam savdosi").setOption("legend", { position: "bottom" }).setPosition(34, 4, 0, 0).build());
    }
  }
  if (products && products.getLastRow() > 1) {
    const rows = Math.min(10, products.getLastRow() - 1);
    const nameColumn = haloHeaderColumn_(products, "Mahsulot");
    const salesColumn = haloHeaderColumn_(products, "Sotuv summasi (₩)");
    if (nameColumn && salesColumn) {
      analysis.insertChart(analysis.newChart().asBarChart()
        .addRange(products.getRange(1, nameColumn, rows + 1, 1))
        .addRange(products.getRange(1, salesColumn, rows + 1, 1))
        .setOption("title", "TOP mahsulotlar savdosi").setOption("legend", { position: "none" }).setPosition(18, 4, 0, 0).build());
    }
  }
}
