export type SpreadsheetValue = string | number | boolean | Date | null | undefined;

export type PosColumnMapping = {
  product: string;
  productCode: string;
  quantity: string;
  total: string;
  discount: string;
  date: string;
  externalId: string;
};

export type PosRawRow = {
  rowNumber: number;
  values: Record<string, SpreadsheetValue>;
};

export type PosTable = {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: PosRawRow[];
  headerRowNumber: number;
  detectionScore: number;
  truncated: boolean;
  reportDate?: string;
  reportDateIssue?: string;
  reportFormat?: "okpos-daily-product" | "okpos-code-quantity";
  reportSummary?: {
    quantity: number;
    totalRevenue: number;
  };
};

export type ParsedPosRow = {
  rowNumber: number;
  product: string;
  productCode: string;
  mappingKey: string;
  productKey: string;
  quantity: number;
  totalRevenue: number;
  // Actual POS money is authoritative; menu pricing is only an estimate.
  revenueSource?: "pos_actual" | "menu_estimate";
  referenceRevenue?: number;
  discount: number;
  date: string;
  externalId: string;
};

const aliases: Record<keyof PosColumnMapping, string[]> = {
  product: [
    "상품명", "메뉴명", "품목명", "제품명", "상품", "메뉴",
    "product", "productname", "item", "itemname", "menu", "menuname",
    "mahsulot", "mahsulotnomi", "taom", "taomnomi",
  ],
  productCode: [
    "상품코드", "메뉴코드", "품목코드", "제품코드", "포스코드", "바코드",
    "productcode", "itemcode", "menucode", "poscode", "sku", "plu", "barcode",
    "mahsulotkodi", "taomkodi", "menyukodi", "kod",
  ],
  quantity: [
    "판매수량", "수량", "주문수량", "qty", "quantity", "soldqty", "count",
    "soni", "miqdor",
  ],
  total: [
    "판매금액", "매출액", "실매출", "순매출", "결제금액", "총액", "합계",
    "amount", "total", "totalamount", "revenue", "sales", "jami", "savdo", "summa",
  ],
  discount: [
    "할인금액", "할인", "discount", "discountamount", "chegirma",
  ],
  date: [
    "판매일자", "판매일", "영업일", "거래일", "일자", "날짜",
    "date", "salesdate", "orderdate", "sana",
  ],
  externalId: [
    "주문번호", "영수증번호", "거래번호", "승인번호", "orderid", "ordernumber",
    "receipt", "receiptno", "transactionid", "buyurtmaid", "chek", "chekraqami", "chekno", "id",
  ],
};

const pad = (value: number) => String(value).padStart(2, "0");

function validYmd(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function canonicalYmd(value: string) {
  const match = value.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return validYmd(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : "";
}

export function detectPosReportDate(matrix: SpreadsheetValue[][], headerIndex = matrix.length) {
  const metadata = matrix.slice(0, Math.max(0, headerIndex));
  for (const row of metadata) {
    for (const cell of row) {
      const source = String(cell ?? "").trim();
      if (!/(?:조회일자|조회일|영업일자|판매일자|report\s*date|sales\s*date|hisobot\s*sanasi)/i.test(source)) continue;
      const date = canonicalYmd(source);
      if (date) return date;
    }
  }
  return "";
}

export function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./()[\]{}'"’`]+/g, "");
}

export function normalizeProductKey(value: unknown) {
  return normalizeHeader(value).replace(/[^a-z0-9가-힣]+/g, "");
}

export function normalizeProductCode(value: unknown) {
  return String(value ?? "").trim().toLocaleUpperCase("en-US").replace(/\s+/g, "");
}

function headerMatches(header: string, field: keyof PosColumnMapping) {
  const normalized = normalizeHeader(header);
  if (field === "total" && /discount|chegirma|할인/.test(normalized)) return false;
  if (field === "product" && aliases.productCode.some((alias) => {
    const normalizedAlias = normalizeHeader(alias);
    return normalized === normalizedAlias || (normalizedAlias.length >= 4 && normalized.includes(normalizedAlias));
  })) return false;
  return aliases[field].some((alias) => {
    const normalizedAlias = normalizeHeader(alias);
    return normalized === normalizedAlias || (normalizedAlias.length >= 4 && normalized.includes(normalizedAlias));
  });
}

function rowDetectionScore(row: SpreadsheetValue[]) {
  const fields = (Object.keys(aliases) as Array<keyof PosColumnMapping>);
  return fields.filter((field) => row.some((cell) => headerMatches(String(cell ?? ""), field))).length;
}

function uniqueHeaders(row: SpreadsheetValue[]) {
  const seen = new Map<string, number>();
  return row.map((cell, index) => {
    const base = String(cell ?? "").trim() || `Ustun ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

export function extractPosTable(
  matrix: SpreadsheetValue[][],
  fileName: string,
  sheetName: string,
  maxRows = 25_000,
): PosTable {
  const candidates = matrix.slice(0, 20);
  let headerIndex = candidates.findIndex((row) => row.some((cell) => String(cell ?? "").trim()));
  let bestScore = -1;

  candidates.forEach((row, index) => {
    const score = rowDetectionScore(row);
    if (score > bestScore) {
      bestScore = score;
      headerIndex = index;
    }
  });
  if (headerIndex < 0) headerIndex = 0;

  const headers = uniqueHeaders(matrix[headerIndex] ?? []);
  const sourceRows = matrix.slice(headerIndex + 1);
  const rows = sourceRows.slice(0, maxRows).map((row, index) => ({
    rowNumber: headerIndex + index + 2,
    values: Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex]])),
  })).filter((row) => Object.values(row.values).some((cell) => String(cell ?? "").trim()));

  const normalizedHeaders = headers.map(normalizeHeader);
  const titleText = matrix.slice(0, headerIndex).flat().map((cell) => String(cell ?? "")).join(" ");
  const metadataDates = [...titleText.matchAll(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g)].map((match) => canonicalYmd(match[0]));
  const reportDateIssue = metadataDates.some((date) => !date) ? "Fayl sarlavhasidagi sana noto‘g‘ri. Asl hisobot sanasini tekshiring."
    : new Set(metadataDates).size > 1 ? "Fayl bir nechta kunning jami savdosini jamlagan. Har bir kun uchun alohida hisobot yuklang." : undefined;
  const reportFormat = /당일매출종합현황/.test(titleText)
    && /상품별\s*매출현황/.test(titleText)
    && ["상품코드", "상품명", "수량", "실매출"].every((header) => normalizedHeaders.includes(header))
    ? "okpos-daily-product" as const
    : undefined;
  const quantityIndex = headers.findIndex((header) => headerMatches(header, "quantity"));
  const netIndex = headers.findIndex((header) => /실매출|순매출|^net/i.test(normalizeHeader(header)));
  const totalIndex = netIndex >= 0 ? netIndex : headers.findIndex((header) => headerMatches(header, "total"));
  const summaryRow = reportFormat
    ? sourceRows.find((row) => /^(?:합계|총계|총합계)$/.test(normalizeHeader(row.find((cell) => String(cell ?? "").trim()) ?? "")))
    : undefined;
  const reportSummary = summaryRow && quantityIndex >= 0 && totalIndex >= 0
    ? {
        quantity: parseNumber(summaryRow[quantityIndex]),
        totalRevenue: parseNumber(summaryRow[totalIndex]),
      }
    : undefined;

  return {
    fileName,
    sheetName,
    headers,
    rows,
    headerRowNumber: headerIndex + 1,
    detectionScore: Math.max(0, bestScore),
    truncated: sourceRows.length > maxRows,
    reportDate: detectPosReportDate(matrix, headerIndex) || undefined,
    reportDateIssue,
    reportFormat,
    reportSummary,
  };
}

export function autoDetectPosColumns(headers: string[]): PosColumnMapping {
  const find = (field: keyof PosColumnMapping) => headers.find((header) => headerMatches(header, field)) ?? "";
  return {
    product: "",
    productCode: find("productCode"),
    quantity: find("quantity"),
    total: headers.find((header) => /실매출|순매출|^net/i.test(normalizeHeader(header))) || find("total"),
    discount: find("discount"),
    date: find("date"),
    externalId: find("externalId"),
  };
}

export function parseNumber(value: SpreadsheetValue) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean" || value == null) return 0;
  const source = String(value).trim();
  const negative = /^\(.*\)$/.test(source) || source.startsWith("-");
  const parsed = Number(source.replace(/[₩원,\s()]/g, "").replace(/[^\d.+-]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -Math.abs(parsed) : parsed;
}

export function parseDate(value: SpreadsheetValue, fallback: string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 20_000 && value < 80_000) {
    const excelDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86_400_000);
    return excelDate.toISOString().slice(0, 10);
  }

  const source = String(value ?? "").trim();
  if (!source) return fallback;
  const ymd = source.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (ymd) return canonicalYmd(source) || fallback;
  const mdy = source.match(/^(\d{1,2})\D+(\d{1,2})\D+(\d{4})$/);
  if (mdy) return validYmd(Number(mdy[3]), Number(mdy[1]), Number(mdy[2])) ? `${mdy[3]}-${pad(Number(mdy[1]))}-${pad(Number(mdy[2]))}` : fallback;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime())
    ? fallback
    : `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

export function parsePosRows(table: PosTable, mapping: PosColumnMapping, fallbackDate: string) {
  let ignored = 0;
  let summaryRows = 0;
  const errors: string[] = table.truncated ? ["Fayl juda katta: barcha qatorlar o‘qilmadi. Import uchun faylni kunlar bo‘yicha ajrating."] : [];
  if (table.reportDateIssue) errors.push(table.reportDateIssue);
  const rows: ParsedPosRow[] = [];
  const totalIsAlreadyNet = /실매출|순매출|net/i.test(mapping.total);
  const defaultDate = table.reportDate || fallbackDate;
  const productCodeHeader = mapping.productCode
    || (table.reportFormat === "okpos-daily-product"
      ? table.headers.find((header) => normalizeHeader(header) === "상품코드") ?? ""
      : "");
  const codeQuantityOnly = Boolean(productCodeHeader && mapping.quantity)
    && !mapping.product && !mapping.total && !mapping.discount && !mapping.date && !mapping.externalId;
  const referenceTotalHeader = table.reportFormat === "okpos-daily-product"
    ? table.headers.find((header) => normalizeHeader(header) === "실매출")
    : undefined;

  table.rows.forEach((row) => {
    const rawProduct = mapping.product ? String(row.values[mapping.product] ?? "").trim() : "";
    const productCode = productCodeHeader ? String(row.values[productCodeHeader] ?? "").trim() : "";
    if (table.reportFormat === "okpos-daily-product" && !productCode
      && Object.values(row.values).some((cell) => /^(?:합계|총계|소계|총합계)$/.test(normalizeHeader(cell)))) {
      summaryRows += 1;
      return;
    }
    const product = codeQuantityOnly
      ? (productCode ? `Kod ${productCode}` : "")
      : rawProduct || (productCode ? `Kod ${productCode}` : "");
    const quantityValue = mapping.quantity ? parseNumber(row.values[mapping.quantity]) : 0;
    const summaryLabel = /^(?:합계|총계|소계|총합계|total|grandtotal|jami)$/i.test(normalizeHeader(product));
    if (product && !summaryLabel && (quantityValue < 0 || !Number.isSafeInteger(quantityValue))) {
      errors.push(`${row.rowNumber}-qator: qaytarish yoki noto‘g‘ri miqdor. Qaytarishni asl savdoga bog‘lab kiriting.`);
      return;
    }
    const quantity = quantityValue;
    if (!product || summaryLabel || quantity <= 0) {
      ignored += 1;
      return;
    }
    const revenueHeader = referenceTotalHeader || mapping.total;
    const rawValue = revenueHeader ? row.values[revenueHeader] : undefined;
    const validMoneyCell = typeof rawValue === "number" ? Number.isFinite(rawValue)
      : typeof rawValue === "string" && /^[\s₩원,()+\-\d.]+$/.test(rawValue) && /\d/.test(rawValue);
    const rawGross = revenueHeader ? parseNumber(rawValue) : 0;
    if (revenueHeader && (!validMoneyCell || !Number.isSafeInteger(rawGross) || rawGross < 0)) {
      errors.push(`${row.rowNumber}-qator: savdo summasi bo‘sh yoki noto‘g‘ri. Manfiy summani savdo sifatida kiritib bo‘lmaydi.`);
      return;
    }
    const gross = rawGross;
    const discount = mapping.discount ? Math.abs(parseNumber(row.values[mapping.discount])) : 0;
    const totalRevenue = referenceTotalHeader || totalIsAlreadyNet ? gross : gross - discount;
    if (!Number.isSafeInteger(totalRevenue) || totalRevenue < 0) {
      errors.push(`${row.rowNumber}-qator: chegirma yoki yakuniy summa noto‘g‘ri.`);
      return;
    }
    const date = codeQuantityOnly ? defaultDate : mapping.date ? parseDate(row.values[mapping.date], "") : defaultDate;
    if (!date || canonicalYmd(date) !== date) {
      errors.push(`${row.rowNumber}-qator: savdo sanasi bo‘sh yoki noto‘g‘ri.`);
      return;
    }
    const sourceId = codeQuantityOnly ? "" : mapping.externalId ? String(row.values[mapping.externalId] ?? "").trim() : "";
    const productKey = normalizeProductKey(rawProduct || product);
    const normalizedCode = normalizeProductCode(productCode);
    const mappingKey = normalizedCode ? `code:${normalizedCode}` : `name:${productKey}`;
    const productIdentity = normalizedCode || productKey;
    const externalId = table.reportFormat === "okpos-daily-product"
      ? `okpos-daily-product:${date}:${productIdentity}`
      : sourceId
      ? `${sourceId}:${row.rowNumber}:${productIdentity}`
      : `${table.fileName}:${date}:${row.rowNumber}:${productIdentity}`;
    rows.push({
      rowNumber: row.rowNumber,
      product,
      productCode,
      mappingKey,
      productKey,
      quantity,
      totalRevenue,
      revenueSource: revenueHeader ? "pos_actual" : "menu_estimate",
      ...(referenceTotalHeader ? { referenceRevenue: parseNumber(row.values[referenceTotalHeader]) } : {}),
      discount,
      date,
      externalId,
    });
  });

  const parsedQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const parsedRevenue = rows.reduce((sum, row) => sum + row.totalRevenue, 0);
  const summary = table.reportSummary
    ? {
        ...table.reportSummary,
        parsedQuantity,
        parsedRevenue,
        matches: table.reportSummary.quantity === parsedQuantity
          && !errors.length
          && (!rows.every((row) => row.revenueSource === "pos_actual") || table.reportSummary.totalRevenue === parsedRevenue),
      }
    : undefined;

  return { rows, ignored, summaryRows, summary, errors };
}
