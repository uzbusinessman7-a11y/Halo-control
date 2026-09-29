import {
  normalizeProductCode,
  normalizeProductKey,
  type PosColumnMapping,
  type PosRawRow,
  type PosTable,
} from "./pos-import.ts";
import { recipeHasMenuCode } from "./lib/menu-codes.ts";

export type OcrRecipe = {
  id: string;
  name: string;
  posCode?: string;
  posAliases?: string[];
  salePrice: number;
};

export type OcrParseResult = {
  table: PosTable;
  date: string;
  receiptId: string;
  matchedRows: number;
  receiptQuantity: number;
  receiptTotal: number;
  parsedQuantity: number;
  parsedTotal: number;
  okposColumnsVerified?: boolean;
};

export type OkposColumnOcrEvidence = {
  codesText: string;
  rowsText: string;
  amountsText: string;
  footerText: string;
};

export type OcrReviewIssue = {
  id: string;
  rowNumber: number | null;
  product: string;
  fields: Array<"quantity" | "total">;
  alternate?: { quantity?: number; total?: number };
  reason: string;
  blocking?: boolean;
};

export type OcrNumericReconciliation = {
  parsed: OcrParseResult;
  verified: boolean;
  issues: OcrReviewIssue[];
  numericPairCount: number;
  message: string;
};

export function canApplyOcrAlternative(issue: OcrReviewIssue) {
  if (!issue.alternate || !issue.fields.length) return false;
  return issue.fields.every((field) => field === "quantity"
    ? issue.alternate?.quantity != null
    : issue.alternate?.total != null);
}

export const photoPosMapping: PosColumnMapping = {
  product: "Taom nomi",
  productCode: "Mahsulot kodi",
  quantity: "Soni",
  total: "Savdo summasi",
  discount: "Chegirma",
  date: "Sana",
  externalId: "Chek raqami",
};

export const photoPosCodeQuantityMapping: PosColumnMapping = {
  product: "",
  productCode: photoPosMapping.productCode,
  quantity: photoPosMapping.quantity,
  total: "",
  discount: "",
  date: "",
  externalId: "",
};

// OCR commonly inserts a space after a thousands separator ("27, 440").
// Keep plain spaces out of this global pattern: otherwise "6 27,440" can be
// mistaken for one amount instead of quantity 6 + amount 27,440.
const moneyPattern = /(?:₩\s*)?(\d{1,3}(?:(?:[,\.’'])\s*\d{3})+|\d{4,9})\s*(?:원)?/g;
const stopWords = [
  "합계", "총액", "총금액", "결제", "카드", "현금", "부가세", "과세", "면세", "할인",
  "거스름", "받은돈", "주문번호", "영수증", "승인번호", "판매일자", "조회일자", "상품명", "수량",
  "출력조건", "출력일시", "매장매출내역",
  "total", "subtotal", "discount", "payment", "cash", "card", "vat", "tax", "change",
  "receipt", "order", "date", "quantity", "amount", "jami", "chegirma", "tolov",
];

const pad = (value: number) => String(value).padStart(2, "0");

function toNumber(value: string) {
  const parsed = Number(value
    .replace(/[oO]/g, "0")
    .replace(/[iIl|]/g, "1")
    .replace(/[zZ]/g, "2")
    .replace(/\D/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

type StructuredSaleLine = {
  product: string;
  quantity: number;
  total: number;
  quantityDetected: boolean;
};

function structuredSaleLine(line: string): StructuredSaleLine | null {
  const source = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  // Prefer an amount with comma/dot separators, then a contiguous 4–9 digit
  // amount. A final "27 440" is accepted because OCR sometimes drops comma.
  const amountMatch = source.match(/([0-9oOiIl|]{1,3}(?:\s*[,\.’']\s*[0-9oOiIl|]{3})+|[0-9oOiIl|]{4,9}|[0-9oOiIl|]{2,3}\s+[0-9oOiIl|]{3})\s*(?:원)?\s*[)\]}|:;._-]*\s*$/i);
  if (!amountMatch || amountMatch.index == null) return null;
  const total = toNumber(amountMatch[1]);
  if (total < 1 || total > 999_999_999) return null;

  const beforeAmount = source.slice(0, amountMatch.index).replace(/[—–-]+\s*$/, "").trim();
  const quantityMatch = beforeAmount.match(/(?:^|\s)([0-9oOiIl|zZ]{1,3})(?:\s*[)\]}.,:=~—–\-«»‘’“”])*\s*$/i);
  const quantity = quantityMatch ? toNumber(quantityMatch[1]) : 1;
  const product = quantityMatch && quantityMatch.index != null
    ? beforeAmount.slice(0, quantityMatch.index).trim()
    : beforeAmount;
  if (!product || quantity < 1 || quantity > 999) return null;
  return { product, quantity, total, quantityDetected: Boolean(quantityMatch) };
}

export type OcrNumericPair = {
  quantity: number | null;
  total: number;
};

type CompleteOcrNumericPair = {
  quantity: number;
  total: number;
};

export function parseNumericOcrPairs(text: string): OcrNumericPair[] {
  return text.split(/\r?\n/).flatMap((rawLine) => {
    const source = rawLine.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!source) return [];
    const amountMatch = source.match(/([0-9oOiIl|]{1,3}(?:\s*[,.’']\s*[0-9oOiIl|]{3})+|[0-9oOiIl|]{4,9})\s*$/i);
    if (!amountMatch || amountMatch.index == null) return [];
    const total = toNumber(amountMatch[1]);
    if (total < 1_000 || total > 999_999_999) return [];
    const beforeAmount = source.slice(0, amountMatch.index).trim();
    const quantityMatch = beforeAmount.match(/(?:^|\s)([0-9oOiIl|zZ]{1,3})(?:\s*[)\]}.,:=~—–\-«»‘’“”])*\s*$/i);
    const quantity = quantityMatch ? toNumber(quantityMatch[1]) : null;
    if (quantity != null && (quantity < 1 || quantity > 999)) return [];
    return [{ quantity, total }];
  });
}

function withoutReceiptFooter(
  pairs: OcrNumericPair[],
  receiptQuantity: number,
  receiptTotal: number,
) {
  if (!receiptQuantity || !receiptTotal) return pairs;
  let footerIndex = -1;
  for (let index = pairs.length - 1; index >= Math.max(0, pairs.length - 3); index -= 1) {
    const pair = pairs[index];
    if (pair.quantity === receiptQuantity && pair.total === receiptTotal) {
      footerIndex = index;
      break;
    }
  }
  return footerIndex >= 0 ? pairs.filter((_, index) => index !== footerIndex) : pairs;
}

export function summarizeOcrRows(rows: PosRawRow[]) {
  return rows.reduce((summary, row) => ({
    quantity: summary.quantity + Number(row.values[photoPosMapping.quantity] ?? 0),
    total: summary.total + Number(row.values[photoPosMapping.total] ?? 0),
  }), { quantity: 0, total: 0 });
}

export function deletionMovesAwayFromReceipt(
  rows: PosRawRow[],
  rowNumber: number,
  receiptQuantity: number,
  receiptTotal: number,
) {
  if (receiptQuantity <= 0 || receiptTotal <= 0) return false;
  const before = summarizeOcrRows(rows);
  const after = summarizeOcrRows(rows.filter((row) => row.rowNumber !== rowNumber));
  return Math.abs(receiptQuantity - after.quantity) > Math.abs(receiptQuantity - before.quantity)
    && Math.abs(receiptTotal - after.total) > Math.abs(receiptTotal - before.total);
}

export function removedRowsFillReceiptGap<T extends { row: PosRawRow; index: number }>(
  rows: PosRawRow[],
  removedRows: T[],
  receiptQuantity: number,
  receiptTotal: number,
) {
  if (!removedRows.length || receiptQuantity <= 0 || receiptTotal <= 0) return [];
  const current = summarizeOcrRows(rows);
  const missingQuantity = receiptQuantity - current.quantity;
  const missingTotal = receiptTotal - current.total;
  if (missingQuantity <= 0 || missingTotal <= 0) return [];

  // A user normally removes only one or two rows by accident. Enumerating the
  // small undo stack gives an exact answer without guessing from prices.
  const candidates = removedRows.slice(-12);
  const matches: T[][] = [];
  const limit = 1 << candidates.length;
  for (let mask = 1; mask < limit; mask += 1) {
    const selected = candidates.filter((_, index) => (mask & (1 << index)) !== 0);
    const summary = summarizeOcrRows(selected.map((entry) => entry.row));
    if (summary.quantity === missingQuantity && summary.total === missingTotal) matches.push(selected);
    if (matches.length > 1) return [];
  }
  return matches[0]?.sort((left, right) => left.index - right.index) ?? [];
}

function completeNumericPairs(
  pairs: OcrNumericPair[],
  receiptQuantity: number,
): CompleteOcrNumericPair[] | null {
  const completed = pairs.map((pair) => ({ ...pair }));
  const missing = completed
    .map((pair, index) => pair.quantity == null ? index : -1)
    .filter((index) => index >= 0);
  if (missing.length === 1 && receiptQuantity > 0) {
    const known = completed.reduce((sum, pair) => sum + (pair.quantity ?? 0), 0);
    const residual = receiptQuantity - known;
    if (residual >= 1 && residual <= 999) completed[missing[0]].quantity = residual;
  }
  if (completed.some((pair) => pair.quantity == null)) return null;
  return completed.map((pair) => ({ quantity: pair.quantity ?? 0, total: pair.total }));
}

export function numericOcrRowCount(
  text: string,
  receiptQuantity = 0,
  receiptTotal = 0,
) {
  return withoutReceiptFooter(parseNumericOcrPairs(text), receiptQuantity, receiptTotal).length;
}

export function parseProductOcrLines(text: string) {
  return text.split(/\r?\n/).flatMap((rawLine) => {
    const line = rawLine.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!line || looksLikeSummary(line) || looksLikeReceiptMetadata(line)) return [];
    if (/^SBS(?:\s|$)/i.test(line) || /^B\s+H[iIl1](?:\s|$|[,0-9])/i.test(line)) return [];
    const structured = structuredSaleLine(line);
    const product = cleanOcrProductName(structured?.product ?? line)
      .replace(/^[^A-Z0-9가-힣]+|[^A-Z0-9가-힣]+$/gi, "")
      .trim();
    const key = normalizeProductKey(product);
    if (key.length < 3 || !/[A-Z가-힣]/i.test(product)) return [];
    if (/^(?:PRODUCT|PRODUCTNAME|MENU|NAME|QTY|QUANTITY|AMOUNT)$/i.test(key)) return [];
    if (/[@#$%^&]/.test(product)) return [];
    const words = product.replace(/[^A-Z0-9가-힣\s]/gi, " ").split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((word) => word.length <= 3) && key !== "SET") return [];
    return [product];
  });
}

export type OcrTsvLine = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerY: number;
  confidence: number;
};

type OcrTsvWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  confidence: number;
};

type OcrPhysicalRow = {
  words: OcrTsvWord[];
  centerY: number;
};

type OkposTableRow = {
  ordinal: number;
  code: string;
  product: string;
  quantity: number | null;
  total: number;
  sourceOrder: number;
};

type OcrColumnEvidence = {
  productTsv?: string;
  numericTsvs?: string[];
  recipes?: OcrRecipe[];
};

export function parseOcrTsvLines(tsv: string): OcrTsvLine[] {
  const groups = new Map<string, Array<{
    text: string;
    left: number;
    top: number;
    width: number;
    height: number;
    confidence: number;
  }>>();
  tsv.split(/\r?\n/).forEach((row) => {
    const columns = row.split("\t");
    if (columns.length < 12 || Number(columns[0]) !== 5) return;
    const text = columns.slice(11).join("\t").trim();
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const width = Number(columns[8]);
    const height = Number(columns[9]);
    const confidence = Number(columns[10]);
    if (!text || ![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    const key = columns.slice(1, 5).join(":");
    const current = groups.get(key) ?? [];
    current.push({ text, left, top, width, height, confidence: Number.isFinite(confidence) ? confidence : 0 });
    groups.set(key, current);
  });

  return [...groups.values()].map((words) => {
    const sorted = words.sort((left, right) => left.left - right.left);
    const top = Math.min(...sorted.map((word) => word.top));
    const bottom = Math.max(...sorted.map((word) => word.top + word.height));
    const left = Math.min(...sorted.map((word) => word.left));
    const right = Math.max(...sorted.map((word) => word.left + word.width));
    const confidentWords = sorted.filter((word) => word.confidence >= 0);
    return {
      text: sorted.map((word) => word.text).join(" ").replace(/\s+/g, " ").trim(),
      left,
      top,
      width: right - left,
      height: bottom - top,
      centerY: (top + bottom) / 2,
      confidence: confidentWords.length
        ? confidentWords.reduce((sum, word) => sum + word.confidence, 0) / confidentWords.length
        : 0,
    };
  }).filter((line) => line.text).sort((left, right) => left.centerY - right.centerY);
}

function parseOcrTsvWords(tsv: string) {
  const words: OcrTsvWord[] = [];
  let pageWidth = 0;
  tsv.split(/\r?\n/).forEach((row) => {
    const columns = row.split("\t");
    if (columns.length < 10) return;
    const level = Number(columns[0]);
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const width = Number(columns[8]);
    const height = Number(columns[9]);
    if (level === 1 && Number.isFinite(width) && width > 0) pageWidth = Math.max(pageWidth, width);
    if (level !== 5 || columns.length < 12) return;
    const text = columns.slice(11).join("\t").normalize("NFKC").trim();
    const confidence = Number(columns[10]);
    if (!text || ![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    words.push({
      text,
      left,
      top,
      width,
      height,
      centerX: left + width / 2,
      centerY: top + height / 2,
      confidence: Number.isFinite(confidence) ? confidence : 0,
    });
    pageWidth = Math.max(pageWidth, left + width);
  });
  return { words, pageWidth };
}

function physicalRowsFromTsv(tsv: string) {
  const { words, pageWidth } = parseOcrTsvWords(tsv);
  if (!words.length || pageWidth <= 0) return { rows: [] as OcrPhysicalRow[], pageWidth: 0 };
  const typicalHeight = median(words.map((word) => word.height).filter((height) => height > 0));
  const tolerance = Math.max(5, Math.min(28, typicalHeight * 0.72));
  const rows: OcrPhysicalRow[] = [];
  [...words].sort((left, right) => left.centerY - right.centerY || left.left - right.left).forEach((word) => {
    const current = rows[rows.length - 1];
    if (!current || Math.abs(current.centerY - word.centerY) > tolerance) {
      rows.push({ words: [word], centerY: word.centerY });
      return;
    }
    current.words.push(word);
    current.centerY = median(current.words.map((entry) => entry.centerY));
  });
  rows.forEach((row) => row.words.sort((left, right) => left.left - right.left));
  return { rows, pageWidth };
}

function normalizeOkposProductCode(value: string) {
  const digits = value.normalize("NFKC").toLocaleUpperCase("en-US")
    .replace(/[OQD]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 10) return "";
  return digits;
}

function okposZoneText(row: OcrPhysicalRow, pageWidth: number, from: number, to: number) {
  return row.words
    .filter((word) => word.centerX / pageWidth >= from && word.centerX / pageWidth < to)
    .map((word) => word.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOkposTableProduct(value: string) {
  return cleanOcrProductName(value)
    .replace(/^[^A-Z0-9가-힣]+|[^A-Z0-9가-힣]+$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function okposLastNumber(value: string) {
  const source = value.normalize("NFKC");
  const match = source.match(
    /([0-9OQDIL|ZSB]{1,3}(?:\s*[,.’']\s*[0-9OQDIL|ZSB]{3})+)\s*(?:원)?\s*[)\]}|:;._-]*\s*$/i,
  ) ?? source.match(
    /([0-9OQDIL|ZSB]{1,3}\s+[0-9OQDIL|ZSB]{3}|[0-9OQDIL|ZSB]{4,9})\s*(?:원)?\s*[)\]}|:;._-]*\s*$/i,
  );
  return match ? toNumber(match[1]) : 0;
}

function parseOkposPhysicalRow(
  row: OcrPhysicalRow,
  pageWidth: number,
  sourceOrder: number,
): OkposTableRow | null {
  const ordinal = toNumber(okposZoneText(row, pageWidth, 0, 0.075));
  const code = normalizeOkposProductCode(okposZoneText(row, pageWidth, 0.075, 0.305));
  const product = cleanOkposTableProduct(okposZoneText(row, pageWidth, 0.285, 0.635));
  const quantity = toNumber(okposZoneText(row, pageWidth, 0.605, 0.775));
  const total = okposLastNumber(okposZoneText(row, pageWidth, 0.735, 1.01));
  if (!code) return null;
  if (quantity > 999 || total < 1 || total > 999_999_999) return null;
  return {
    ordinal,
    code,
    product: /[A-Z가-힣]/i.test(product) ? product : `Kod ${code}`,
    quantity: quantity > 0 ? quantity : null,
    total,
    sourceOrder,
  };
}

function parseOkposTextRows(text: string) {
  const amountPattern = "([0-9OQDIL|ZSB]{1,3}(?:(?:\\s*[,.’']\\s*|\\s+)[0-9OQDIL|ZSB]{3})+|[0-9OQDIL|ZSB]{4,9})";
  const linePattern = new RegExp(
    `^\\s*([0-9OQDIL|ZSB]{1,3})[.)]?\\s+([0-9OQDIL|ZSB](?:\\s*[0-9OQDIL|ZSB]){1,9})\\s+([A-Z가-힣].*?)\\s+([0-9OQDIL|ZSB]{1,3})\\s+${amountPattern}\\s*(?:원)?\\s*$`,
    "i",
  );
  return text.split(/\r?\n/).flatMap((rawLine, sourceOrder) => {
    const line = rawLine.normalize("NFKC").replace(/\s+/g, " ").trim();
    const match = line.match(linePattern);
    if (!match) return [];
    const ordinal = toNumber(match[1]);
    const code = normalizeOkposProductCode(match[2]);
    const product = cleanOkposTableProduct(match[3]);
    const quantity = toNumber(match[4]);
    const total = toNumber(match[5]);
    if (!code || !product || quantity < 1 || quantity > 999 || total < 1) return [];
    return [{ ordinal, code, product, quantity, total, sourceOrder }];
  });
}

function okposPhysicalSummary(rows: OcrPhysicalRow[], pageWidth: number, parsedQuantity: number, parsedTotal: number) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const rowText = row.words.map((word) => word.text).join(" ");
    const quantity = toNumber(okposZoneText(row, pageWidth, 0.605, 0.775));
    const total = okposLastNumber(okposZoneText(row, pageWidth, 0.735, 1.01));
    const labelled = /(?:합계|총계|총합계|grand\s*total|total)/i.test(rowText);
    const exactUnlabelledFooter = quantity === parsedQuantity && total === parsedTotal;
    if ((labelled || exactUnlabelledFooter) && quantity > 0 && total > 0) return { quantity, total };
  }
  return { quantity: 0, total: 0 };
}

function okposCodesFromColumn(text: string) {
  const seen = new Set<string>();
  return text.split(/\r?\n/).flatMap((line) => {
    const tokens = line.normalize("NFKC").toLocaleUpperCase("en-US").match(/[0-9OQDIL|ZSB]{5,10}/g) ?? [];
    return tokens.flatMap((token) => {
      const code = normalizeOkposProductCode(token);
      if (!code || seen.has(code)) return [];
      seen.add(code);
      return [code];
    });
  });
}

function okposQuantitiesFromColumn(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const source = line.normalize("NFKC").replace(/\s+/g, "").trim();
    if (!/^[0-9OQDIL|ZSB]{1,3}$/i.test(source)) return [];
    const quantity = toNumber(source);
    return quantity >= 1 && quantity <= 999 ? [quantity] : [];
  });
}

/**
 * Strict landscape OKPOS import. Only the separately cropped 상품코드 and
 * 수량 columns participate; row numbers, names, revenue and footer values are
 * never used to detect or calculate sales rows.
 */
export function ocrOkposCodeQuantityColumns(
  codesText: string,
  quantitiesText: string,
  recipes: OcrRecipe[],
  fallbackDate: string,
  fileName: string,
): OcrParseResult | null {
  const codes = okposCodesFromColumn(codesText);
  let quantities = okposQuantitiesFromColumn(quantitiesText);
  if (quantities.length === codes.length + 1) {
    const printedTotal = quantities.at(-1) ?? 0;
    const rowQuantities = quantities.slice(0, -1);
    if (rowQuantities.reduce((sum, quantity) => sum + quantity, 0) === printedTotal) {
      quantities = rowQuantities;
    }
  }
  if (!codes.length || codes.length !== quantities.length) return null;

  const date = fallbackDate;
  const receiptId = `okpos-daily-product:${date}`;
  let matchedRows = 0;
  const rows = codes.map((code, index) => {
    const recipe = recipes.find((entry) => recipeHasMenuCode(entry, code));
    if (recipe) matchedRows += 1;
    return rowValues(
      index + 1,
      recipe?.name || `Kod ${code}`,
      quantities[index],
      0,
      date,
      receiptId,
      code,
    );
  });
  const parsedQuantity = quantities.reduce((sum, quantity) => sum + quantity, 0);

  return {
    table: {
      fileName,
      sheetName: "OKPOS 상품코드 + 수량",
      headers: Object.values(photoPosMapping),
      rows,
      headerRowNumber: 1,
      detectionScore: 10,
      truncated: false,
      reportDate: date,
      reportFormat: "okpos-code-quantity",
    },
    date,
    receiptId,
    matchedRows,
    receiptQuantity: parsedQuantity,
    receiptTotal: 0,
    parsedQuantity,
    parsedTotal: 0,
    okposColumnsVerified: true,
  };
}

function okposRowsFromColumn(text: string) {
  const rows = new Map<string, { product: string; quantity: number | null }>();
  let pendingCode = "";
  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!line) return;
    const codeToken = line.toLocaleUpperCase("en-US").match(/[0-9OQDIL|ZSB]{6,10}/i)?.[0] ?? "";
    const code = normalizeOkposProductCode(codeToken);
    if (code) {
      const afterCode = line.slice(Math.max(0, line.indexOf(codeToken) + codeToken.length)).trim();
      const quantityToken = afterCode.match(/(?:^|\s)([0-9OQDIL|ZSB]{1,3})\s*$/i)?.[1] ?? "";
      const quantity = quantityToken ? toNumber(quantityToken) : 0;
      const product = cleanOkposTableProduct(quantityToken
        ? afterCode.slice(0, Math.max(0, afterCode.lastIndexOf(quantityToken))).trim()
        : afterCode);
      rows.set(code, {
        product: /[A-Z가-힣]/i.test(product) ? product : "",
        quantity: quantity >= 1 && quantity <= 999 ? quantity : null,
      });
      pendingCode = !product || !quantity ? code : "";
      return;
    }
    if (!pendingCode || !/[A-Z가-힣]/i.test(line)) return;
    const current = rows.get(pendingCode);
    if (current) rows.set(pendingCode, { ...current, product: cleanOkposTableProduct(line) });
    pendingCode = "";
  });
  return rows;
}

function okposAmountsFromColumn(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const total = okposLastNumber(line);
    return total >= 1_000 && total <= 999_999_999 ? [total] : [];
  });
}

function verifiedOkposColumnRows(evidence?: OkposColumnOcrEvidence) {
  if (!evidence) return null;
  const codes = okposCodesFromColumn(evidence.codesText);
  const leftRows = okposRowsFromColumn(evidence.rowsText);
  const amounts = okposAmountsFromColumn(evidence.amountsText);
  let receiptQuantity = okposQuantitiesFromColumn(evidence.footerText).at(-1) ?? 0;
  const receiptTotal = okposAmountsFromColumn(evidence.footerText).at(-1) ?? 0;
  if (!receiptQuantity && receiptTotal) {
    const sameLineFooter = evidence.footerText.split(/\r?\n/).reverse().find((line) => {
      const pair = line.normalize("NFKC").match(
        /(?:^|\s)([0-9OQDIL|ZSB]{1,3})\s+([0-9OQDIL|ZSB]{1,3}(?:\s*[,.’']\s*[0-9OQDIL|ZSB]{3})+)\s*[)\]}|:;._-]*\s*$/i,
      );
      return pair && toNumber(pair[2]) === receiptTotal;
    });
    const pair = sameLineFooter?.normalize("NFKC").match(
      /(?:^|\s)([0-9OQDIL|ZSB]{1,3})\s+([0-9OQDIL|ZSB]{1,3}(?:\s*[,.’']\s*[0-9OQDIL|ZSB]{3})+)\s*[)\]}|:;._-]*\s*$/i,
    );
    receiptQuantity = pair ? toNumber(pair[1]) : 0;
  }
  if (codes.length < 1 || amounts.length < codes.length || receiptQuantity < 1 || receiptTotal < 1) return null;
  // The product-code crop and the wider row crop are independent reads. A
  // code missing from the latter must never be reconstructed from the footer:
  // it may be a different valid menu code and deduct the wrong recipe.
  if (!codes.every((code) => leftRows.has(code))) return null;

  const quantities = codes.map((code) => leftRows.get(code)?.quantity ?? null);
  const missingQuantityIndexes = quantities.flatMap((quantity, index) => quantity == null ? [index] : []);
  if (missingQuantityIndexes.length > 1) return null;
  const knownQuantity = quantities.reduce((sum: number, quantity) => sum + (quantity ?? 0), 0);
  if (!missingQuantityIndexes.length && knownQuantity !== receiptQuantity) return null;
  if (missingQuantityIndexes.length === 1) {
    const inferredQuantity = receiptQuantity - knownQuantity;
    if (inferredQuantity < 1 || inferredQuantity > 999) return null;
    quantities[missingQuantityIndexes[0]] = inferredQuantity;
  }

  for (let amountStart = 0; amountStart <= amounts.length - codes.length; amountStart += 1) {
    const amountWindow = amounts.slice(amountStart, amountStart + codes.length);
    if (amountWindow.reduce((sum, value) => sum + value, 0) !== receiptTotal) continue;
    return {
      rows: codes.map((code, index): OkposTableRow => ({
        ordinal: index + 1,
        code,
        product: leftRows.get(code)?.product || `Kod ${code}`,
        quantity: quantities[index],
        total: amountWindow[index],
        sourceOrder: index,
      })),
      summary: { quantity: receiptQuantity, total: receiptTotal },
    };
  }
  return null;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function productLinesFromTsv(tsv: string) {
  return parseOcrTsvLines(tsv).flatMap((line) => {
    const products = parseProductOcrLines(line.text);
    return products.length === 1 ? [{ ...line, product: products[0] }] : [];
  });
}

function numericLinesFromTsv(
  tsv: string,
  receiptQuantity: number,
  receiptTotal: number,
) {
  const lines = parseOcrTsvLines(tsv).flatMap((line) => {
    const pairs = parseNumericOcrPairs(line.text);
    return pairs.length === 1 ? [{ ...line, pair: pairs[0] }] : [];
  });
  let footerIndex = -1;
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - 3); index -= 1) {
    if (lines[index].pair.quantity === receiptQuantity && lines[index].pair.total === receiptTotal) {
      footerIndex = index;
      break;
    }
  }
  return footerIndex >= 0 ? lines.filter((_, index) => index !== footerIndex) : lines;
}

function alignTsvColumns(
  productTsv: string,
  numericTsv: string,
  selectedPairs: CompleteOcrNumericPair[],
  receiptQuantity: number,
  receiptTotal: number,
) {
  const productLines = productLinesFromTsv(productTsv);
  const numericLines = numericLinesFromTsv(numericTsv, receiptQuantity, receiptTotal);
  if (!productLines.length || numericLines.length !== selectedPairs.length) return null;
  const numericCompleted = completeNumericPairs(numericLines.map((line) => line.pair), receiptQuantity);
  if (!numericCompleted) return null;

  const gaps = numericLines.slice(1).map((line, index) => line.centerY - numericLines[index].centerY).filter((gap) => gap > 3);
  const rowPitch = median(gaps);
  const tolerance = Math.max(10, Math.min(34, rowPitch ? rowPitch * 0.46 : 22));
  const firstY = numericLines[0].centerY;
  const lastY = numericLines[numericLines.length - 1].centerY;
  const bodyProducts = productLines.filter((line) => (
    line.centerY >= firstY - tolerance && line.centerY <= lastY + tolerance
  ));
  if (bodyProducts.length !== numericLines.length) return null;

  const names: string[] = [];
  for (let index = 0; index < numericLines.length; index += 1) {
    const product = bodyProducts[index];
    const number = numericLines[index];
    if (!product || Math.abs(product.centerY - number.centerY) > tolerance) return null;
    names.push(product.product);
  }
  return names;
}

export function rebuildOcrRowsFromProductColumn(
  parsed: OcrParseResult,
  productText: string,
  numericTexts: string[],
  evidence: OcrColumnEvidence = {},
): { parsed: OcrParseResult; rebuilt: boolean; coordinateAligned: boolean; message: string } {
  const names = parseProductOcrLines(productText);
  const passPairs = numericTexts.map((text) => withoutReceiptFooter(
    parseNumericOcrPairs(text),
    parsed.receiptQuantity,
    parsed.receiptTotal,
  ));
  const counts = new Map<number, number>();
  passPairs.forEach((pairs) => {
    if (pairs.length) counts.set(pairs.length, (counts.get(pairs.length) ?? 0) + 1);
  });
  const targetCount = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0]?.[0] ?? 0;

  if (!targetCount) return { parsed, rebuilt: false, coordinateAligned: false, message: "Raqamlar qatori topilmadi." };
  if (names.length !== targetCount) {
    return {
      parsed,
      rebuilt: false,
      coordinateAligned: false,
      message: `Taomlar ustunida ${names.length} nom, raqamlar ustunida ${targetCount} qator topildi.`,
    };
  }

  const candidates = passPairs.flatMap((pairs, passIndex) => {
    if (pairs.length !== targetCount) return [];
    const completed = completeNumericPairs(pairs, parsed.receiptQuantity);
    if (!completed) return [];
    const quantity = completed.reduce((sum, pair) => sum + pair.quantity, 0);
    const total = completed.reduce((sum, pair) => sum + pair.total, 0);
    return [{ pairs: completed, passIndex, exact: quantity === parsed.receiptQuantity && total === parsed.receiptTotal }];
  }).sort((left, right) => Number(right.exact) - Number(left.exact));
  const selected = candidates[0];
  if (!selected) {
    return { parsed, rebuilt: false, coordinateAligned: false, message: "Raqamlar qatori to‘liq tiklanmadi." };
  }

  const coordinateNumericTsv = evidence.numericTsvs?.find(Boolean);
  const coordinateNames = evidence.productTsv && coordinateNumericTsv
    ? alignTsvColumns(
      evidence.productTsv,
      coordinateNumericTsv,
      selected.pairs,
      parsed.receiptQuantity,
      parsed.receiptTotal,
    )
    : null;
  const alignedProducts = (coordinateNames ?? names).map((sourceName) => {
    const identity = productIdentityFromOcr(sourceName, evidence.recipes || []);
    const recipe = evidence.recipes?.length ? identity.recipe || matchRecipe(identity.product, evidence.recipes) : null;
    return {
      name: recipe?.name || identity.product,
      code: identity.code || normalizeProductCode(recipe?.posCode),
    };
  });

  const rows = alignedProducts.map((product, index) => rowValues(
    index + 1,
    product.name,
    selected.pairs[index].quantity,
    selected.pairs[index].total,
    parsed.date,
    parsed.receiptId,
    product.code,
  ));
  const difference = targetCount - parsed.table.rows.length;
  return {
    parsed: {
      ...parsed,
      table: { ...parsed.table, rows },
      parsedQuantity: rows.reduce((sum, row) => sum + Number(row.values[photoPosMapping.quantity] ?? 0), 0),
      parsedTotal: rows.reduce((sum, row) => sum + Number(row.values[photoPosMapping.total] ?? 0), 0),
    },
    rebuilt: true,
    coordinateAligned: Boolean(coordinateNames),
    message: !coordinateNames && (evidence.productTsv || evidence.numericTsvs?.some(Boolean))
      ? "Taom nomi va raqam qatorlari suratdagi balandligi bo‘yicha bir-biriga mos kelmadi."
      : difference > 0
      ? `${difference} ta tushib qolgan qator avtomatik tiklandi.`
      : difference < 0
        ? `${Math.abs(difference)} ta ortiqcha OCR shovqin qatori olib tashlandi.`
        : "Barcha taom nomlari va raqamlari alohida tekshirildi.",
  };
}

function moneyCandidates(line: string) {
  return [...line.matchAll(moneyPattern)]
    .map((match) => toNumber(match[1]))
    .filter((value) => value >= 1_000 && value <= 999_999_999);
}

function extractQuantity(line: string) {
  const structured = structuredSaleLine(line);
  if (structured) return structured.quantity;
  const explicit = line.match(/(?:x|×)\s*(\d{1,3})\b/i)
    ?? line.match(/\b(?:qty|quantity|수량|soni)\s*[:=]?\s*(\d{1,3})\b/i)
    ?? line.match(/\b(\d{1,3})\s*개\b/i);
  if (explicit) return Math.max(1, Math.floor(Number(explicit[1])));

  const withoutMoney = line.replace(moneyPattern, " ");
  const standalone = [...withoutMoney.matchAll(/(?:^|\s)(\d{1,3})(?=\s|$)/g)].at(-1);
  return standalone ? Math.max(1, Math.floor(Number(standalone[1]))) : 1;
}

function levenshtein(left: string, right: string) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
    }
    for (let index = 0; index <= right.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
}

function similarity(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  return length ? 1 - levenshtein(left, right) / length : 0;
}

function productIdentityFromOcr(line: string, recipes: OcrRecipe[]) {
  const tokens = line.normalize("NFKC").split(/\s+/).filter(Boolean);
  for (const recipe of recipes) {
    const token = tokens.find((value) => recipeHasMenuCode(recipe, value.replace(/^[#([]+|[),:;]+$/g, "")));
    if (token) {
      const code = token.replace(/^[#([]+|[),:;]+$/g, "");
      return { code, product: recipe.name, recipe };
    }
  }
  const leading = line.normalize("NFKC").trim().match(/^([A-Z0-9][A-Z0-9._/-]{2,20})\s+(.+)$/i);
  if (leading && /\d/.test(leading[1]) && (/[A-Z가-힣]/i.test(leading[2]))) {
    const likelyCode = /^\d{4,}$/.test(leading[1]) || /[-_/]/.test(leading[1]) || /[A-Z].*\d|\d.*[A-Z]/i.test(leading[1]);
    if (likelyCode) return { code: leading[1], product: leading[2], recipe: null };
  }
  return { code: "", product: line, recipe: null };
}

function matchRecipe(line: string, recipes: OcrRecipe[]) {
  const identity = productIdentityFromOcr(line, recipes);
  if (identity.recipe) return identity.recipe;
  const textOnly = identity.product
    .replace(moneyPattern, " ")
    .replace(/(?:x|×)\s*\d+|\b\d+\s*(?:개|ea|pcs?|ta)\b/gi, " ");
  const lineKey = normalizeProductKey(textOnly);
  const candidates: Array<{ recipe: OcrRecipe; score: number }> = [];

  for (const recipe of recipes) {
    const recipeKey = normalizeProductKey(recipe.name);
    if (!recipeKey) continue;
    let score = 0;
    if (lineKey.includes(recipeKey)) {
      score = 1;
    } else if (recipeKey.includes(lineKey) && lineKey.length >= 5) {
      score = 0.88;
    } else {
      const words = textOnly.split(/\s+/).filter(Boolean);
      const windows = words.flatMap((_, start) => words
        .slice(start, Math.min(words.length, start + 4))
        .map((__, offset) => normalizeProductKey(words.slice(start, start + offset + 1).join(" "))));
      score = Math.max(similarity(lineKey, recipeKey), ...windows.map((window) => similarity(window, recipeKey)));
    }
    candidates.push({ recipe, score });
  }

  candidates.sort((left, right) => right.score - left.score);
  const match = candidates[0] ?? null;
  if (!match) return null;
  const runnerUp = candidates[1];
  const exact = normalizeProductKey(match.recipe.name) === lineKey;
  const threshold = normalizeProductKey(match.recipe.name).length < 5 ? 0.9 : 0.78;
  const uniqueEnough = !runnerUp || match.score - runnerUp.score >= 0.08;
  return exact || (match.score >= threshold && uniqueEnough) ? match.recipe : null;
}

function totalForLine(line: string, recipe: OcrRecipe | null, quantity: number) {
  const structured = structuredSaleLine(line);
  if (structured) return structured.total;
  const candidates = moneyCandidates(line);
  if (!candidates.length) return 0;
  if (!recipe?.salePrice) return candidates[candidates.length - 1];

  const expected = recipe.salePrice * quantity;
  const closest = [...candidates].sort((left, right) => Math.abs(left - expected) - Math.abs(right - expected))[0];
  if (
    quantity > 1
    && Math.abs(closest - recipe.salePrice) <= Math.max(300, recipe.salePrice * 0.12)
    && !candidates.some((value) => Math.abs(value - expected) <= Math.max(500, expected * 0.12))
  ) {
    return closest * quantity;
  }
  return closest;
}

function cleanFallbackProduct(line: string) {
  return line
    .replace(moneyPattern, " ")
    .replace(/(?:x|×)\s*\d+|\b(?:qty|quantity|수량|soni)\s*[:=]?\s*\d+/gi, " ")
    .replace(/\b\d+\s*(?:개|ea|pcs?|ta)\b/gi, " ")
    .replace(/[|:;#=*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOcrProductName(value: string) {
  return value
    // Common thermal-printer OCR substitutions found in OKPOS product names.
    .replace(/\b4[0O]{2}5\b/gi, "4PCS")
    .replace(/\bHAGG[!|1](?=\s|$)/gi, "HAGGI")
    .replace(/\b1[0O][9G]5[1I][!|]?(?=\s+(?:CHICKEN|LAMB|MIX)\b)/gi, "HAGGI")
    .replace(/\bPEPERON[!|](?=\s|$)/gi, "PEPERONI")
    .replace(/\bSNOU\b/gi, "SNOW")
    .replace(/\bHOTOOG\b/gi, "HOTDOG")
    .replace(/\bTANOIR\b/gi, "TANDIR")
    .replace(/[)\]}.,:=~—–\-«»‘’“”]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeReceiptMetadata(line: string) {
  const hasDateTime = /\b20\d{2}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}\b/.test(line)
    && /\b\d{1,2}\s*[:.]\s*\d{2}(?:\s*[:.]\s*\d{2})?\b/.test(line);
  return hasDateTime
    || /(?:조회일자?|조회일|출력|입시|printed?|print\s*time)/i.test(line) && /\b20\d{2}\b/.test(line);
}

function looksLikeSummary(line: string) {
  const normalized = normalizeProductKey(line);
  return stopWords.some((word) => normalized.includes(normalizeProductKey(word)));
}

function receiptSummary(lines: string[], parsedQuantity: number, parsedTotal: number) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const normalized = normalizeProductKey(line);
    if (!normalized.includes(normalizeProductKey("합계")) && !/\b(?:total|jami)\b/i.test(line)) continue;
    let combined = line;
    for (let nextIndex = index; nextIndex < Math.min(lines.length, index + 3); nextIndex += 1) {
      if (nextIndex > index) combined = `${combined} ${lines[nextIndex]}`;
      const structured = structuredSaleLine(combined);
      if (structured) return { quantity: structured.quantity, total: structured.total, lineIndex: index };
    }
  }
  // Korean may still be misread by the English pass (for example "합계" →
  // "Ba"). The final grand-total row is much larger than any product row.
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - 6); index -= 1) {
    const line = lines[index];
    const structured = structuredSaleLine(line);
    const numericOnly = line.match(/^([0-9oOiIl|]{1,3})\s+([0-9oOiIl|]{1,3}(?:\s*[,.]\s*[0-9oOiIl|]{3})+|[0-9oOiIl|]{4,9})$/i);
    const numericQuantity = numericOnly ? toNumber(numericOnly[1]) : 0;
    const numericTotal = numericOnly ? toNumber(numericOnly[2]) : 0;
    if (
      numericOnly
      && numericQuantity >= parsedQuantity * 0.5
      && numericTotal >= parsedTotal * 0.5
    ) return { quantity: numericQuantity, total: numericTotal, lineIndex: index };
    if (
      structured
      && normalizeProductKey(structured.product).length <= 3
      && structured.quantity >= parsedQuantity * 0.5
      && structured.total >= parsedTotal * 0.5
    ) return { quantity: structured.quantity, total: structured.total, lineIndex: index };
  }
  return { quantity: 0, total: 0, lineIndex: -1 };
}

function extractDate(text: string, fallbackDate: string) {
  // Printing time (출력일시) is often after midnight and is not the business
  // date. Only trust an explicitly labelled sales/business date.
  const labelledLine = text.match(/(?:조회일자?|조회일|영업일자?|판매일자?|거래일자?|매출일자?|business\s*date|sales\s*date)[^\n]*/i)?.[0] ?? "";
  const ymd = labelledLine.match(/(\d{4})\s*(?:년|[./-])\s*(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${pad(Number(ymd[2]))}-${pad(Number(ymd[3]))}`;

  const short = labelledLine.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (short) {
    const first = Number(short[1]);
    const second = Number(short[2]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return `${short[3]}-${pad(month)}-${pad(day)}`;
  }
  return fallbackDate;
}

function extractReceiptId(text: string, fileName: string) {
  const match = text.match(/(?:주문|영수증|거래|승인)\s*(?:번호)?\s*[:#-]?\s*([A-Z0-9-]{4,})/i)
    ?? text.match(/(?:receipt|order|transaction)\s*(?:no|number|id)?\s*[:#-]?\s*([A-Z0-9-]{4,})/i);
  return match?.[1] ?? `photo-${fileName.replace(/\W+/g, "-").slice(0, 48)}`;
}

function rowValues(
  rowNumber: number,
  product: string,
  quantity: number,
  total: number,
  date: string,
  receiptId: string,
  productCode = "",
): PosRawRow {
  return {
    rowNumber,
    values: {
      [photoPosMapping.product]: product,
      [photoPosMapping.productCode]: productCode,
      [photoPosMapping.quantity]: quantity,
      [photoPosMapping.total]: total,
      [photoPosMapping.discount]: 0,
      [photoPosMapping.date]: date,
      [photoPosMapping.externalId]: receiptId,
    },
  };
}

/**
 * Reads the landscape OKPOS daily product report shown as a five-column grid.
 * This is deliberately separate from the thermal-receipt parser: product
 * codes, names, quantities and revenue live in fixed physical columns, and
 * the printed footer must agree with the sum of every imported row.
 */
export function ocrOkposDailyProductTable(
  text: string,
  tsv: string,
  recipes: OcrRecipe[],
  fallbackDate: string,
  fileName: string,
  columnEvidence?: OkposColumnOcrEvidence,
): OcrParseResult | null {
  const physical = physicalRowsFromTsv(tsv);
  const physicalCandidates = physical.rows.flatMap((row, sourceOrder) => {
    const parsed = parseOkposPhysicalRow(row, physical.pageWidth, sourceOrder);
    return parsed ? [parsed] : [];
  });
  const textCandidates = parseOkposTextRows(text);
  const candidatesByCode = new Map<string, OkposTableRow>();
  [...physicalCandidates, ...textCandidates].forEach((candidate) => {
    const current = candidatesByCode.get(candidate.code);
    const candidateHasQuantity = candidate.quantity != null && candidate.quantity > 0;
    const currentHasQuantity = current?.quantity != null && current.quantity > 0;
    if (
      !current
      || (candidateHasQuantity && !currentHasQuantity)
      || (candidateHasQuantity === currentHasQuantity && candidate.product.length > current.product.length)
    ) candidatesByCode.set(candidate.code, candidate);
  });
  const detectedCandidates = [...candidatesByCode.values()].sort((left, right) => {
    if (left.ordinal > 0 && right.ordinal > 0 && left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
    return left.sourceOrder - right.sourceOrder;
  });
  const verifiedColumns = verifiedOkposColumnRows(columnEvidence);
  const verifiedColumnConflict = verifiedColumns?.rows.some((row) => {
    const independentRow = candidatesByCode.get(row.code);
    return Boolean(independentRow && (
      independentRow.total !== row.total
      || (independentRow.quantity != null && independentRow.quantity !== row.quantity)
    ));
  }) ?? false;
  let candidates = verifiedColumns
    ? verifiedColumns.rows.map((row) => {
        const matchingCandidate = candidatesByCode.get(row.code)
          ?? detectedCandidates.find((candidate) => candidate.ordinal === row.ordinal);
        return {
          ...row,
          product: matchingCandidate?.product
            || row.product,
        };
      })
    : detectedCandidates;

  const normalizedText = text.normalize("NFKC");
  const titleEvidence = /당일매출종합현황|상품별\s*매출현황/.test(normalizedText);
  const headerEvidence = ["상품코드", "상품명", "수량", "실매출"]
    .filter((header) => normalizedText.includes(header)).length;
  const dateEvidence = /조회일자?|조회일/.test(normalizedText);
  const candidateQuantity = candidates.reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  const candidateTotal = candidates.reduce((sum, row) => sum + row.total, 0);
  const physicalSummary = physical.pageWidth > 0
    ? okposPhysicalSummary(physical.rows, physical.pageWidth, candidateQuantity, candidateTotal)
    : { quantity: 0, total: 0 };
  const textSummary = receiptSummary(
    normalizedText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean),
    candidateQuantity,
    candidateTotal,
  );
  const summary = verifiedColumns?.summary
    ?? (physicalSummary.quantity > 0 && physicalSummary.total > 0
      ? physicalSummary
      : { quantity: textSummary.quantity, total: textSummary.total });
  const missingQuantityRows = candidates.filter((row) => row.quantity == null || row.quantity <= 0);
  if (missingQuantityRows.length === 1 && summary.total === candidateTotal && summary.quantity > candidateQuantity) {
    const inferredQuantity = summary.quantity - candidateQuantity;
    if (inferredQuantity >= 1 && inferredQuantity <= 999) {
      const missingCode = missingQuantityRows[0].code;
      candidates = candidates.map((row) => row.code === missingCode ? { ...row, quantity: inferredQuantity } : row);
    }
  }
  const completedQuantity = candidates.reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  const exactFooter = summary.quantity === completedQuantity && summary.total === candidateTotal;
  const formatDetected = titleEvidence
    || headerEvidence >= 3
    || (dateEvidence && candidates.length >= 5)
    || (candidates.length >= 10 && exactFooter);
  if (!formatDetected || !candidates.length) return null;

  let date = extractDate(normalizedText, fallbackDate);
  if (!/(?:조회일자?|조회일|영업일자?|판매일자?|거래일자?|매출일자?|business\s*date|sales\s*date)/i.test(normalizedText)) {
    const topDate = normalizedText.split(/\r?\n/).slice(0, 10).join(" ")
      .match(/\b(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\b/);
    if (topDate) date = `${topDate[1]}-${pad(Number(topDate[2]))}-${pad(Number(topDate[3]))}`;
  }
  const receiptId = `okpos-daily-product:${date}`;
  let matchedRows = 0;
  const rows = candidates.map((candidate, index) => {
    const cleanProduct = cleanOkposTableProduct(candidate.product);
    const recipe = recipes.find((entry) => recipeHasMenuCode(entry, candidate.code))
      ?? matchRecipe(cleanProduct, recipes);
    if (recipe) matchedRows += 1;
    const product = recipe?.name || cleanProduct;
    const productCode = candidate.code || normalizeProductCode(recipe?.posCode);
    return rowValues(index + 1, product, candidate.quantity ?? 0, candidate.total, date, receiptId, productCode);
  });
  const parsedQuantity = rows.reduce((sum, row) => sum + Number(row.values[photoPosMapping.quantity] ?? 0), 0);
  const parsedTotal = rows.reduce((sum, row) => sum + Number(row.values[photoPosMapping.total] ?? 0), 0);
  const reportSummary = summary.quantity > 0 && summary.total > 0
    ? { quantity: summary.quantity, totalRevenue: summary.total }
    : undefined;

  return {
    table: {
      fileName,
      sheetName: "OKPOS kunlik mahsulot hisoboti",
      headers: Object.values(photoPosMapping),
      rows,
      headerRowNumber: 1,
      detectionScore: 9,
      truncated: false,
      reportDate: date,
      reportFormat: "okpos-daily-product",
      reportSummary,
    },
    date,
    receiptId,
    matchedRows,
    receiptQuantity: summary.quantity,
    receiptTotal: summary.total,
    parsedQuantity,
    parsedTotal,
    okposColumnsVerified: columnEvidence ? Boolean(verifiedColumns && !verifiedColumnConflict) : undefined,
  };
}

export function ocrTextToPosTable(
  text: string,
  recipes: OcrRecipe[],
  fallbackDate: string,
  fileName: string,
  summaryText = "",
): OcrParseResult {
  const date = extractDate(text, fallbackDate);
  const receiptId = extractReceiptId(text, fileName);
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows: PosRawRow[] = [];
  const defaultedQuantityRows = new Set<number>();
  let matchedRows = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (looksLikeSummary(line) || looksLikeReceiptMetadata(line)) continue;
    let structured = structuredSaleLine(line);
    let sourceLine = line;
    let identity = productIdentityFromOcr(structured?.product ?? line, recipes);
    let productText = cleanOcrProductName(identity.product);
    let recipe = matchRecipe(productText, recipes);

    // SPARSE/AUTO OCR can split a physical receipt row into product, quantity,
    // and amount lines. Rejoin up to three adjacent fragments before giving up.
    if (!structured && recipe) {
      let combined = line;
      for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 4); nextIndex += 1) {
        if (looksLikeSummary(lines[nextIndex])) break;
        combined = `${combined} ${lines[nextIndex]}`;
        structured = structuredSaleLine(combined);
        if (structured) {
          sourceLine = combined;
          identity = productIdentityFromOcr(structured.product, recipes);
          productText = cleanOcrProductName(identity.product);
          recipe = matchRecipe(productText, recipes) ?? recipe;
          index = nextIndex;
          break;
        }
        if (matchRecipe(lines[nextIndex], recipes)) break;
      }
    }

    if (recipe) {
      const quantity = structured?.quantity ?? extractQuantity(sourceLine);
      const row = rowValues(index + 1, recipe.name, quantity, totalForLine(sourceLine, recipe, quantity), date, receiptId, identity.code || normalizeProductCode(recipe.posCode));
      rows.push(row);
      if (structured && !structured.quantityDetected) defaultedQuantityRows.add(row.rowNumber);
      matchedRows += 1;
      continue;
    }

    if (!structured && !moneyCandidates(line).length) continue;
    identity = productIdentityFromOcr(structured?.product ?? cleanFallbackProduct(line), recipes);
    const product = cleanOcrProductName(identity.product);
    if (normalizeProductKey(product).length < 3 || !/[a-zA-Z가-힣]/.test(product)) continue;
    if (/[@#$%^&]/.test(product)) continue;
    // Amount-only header noise such as "@ AA UWS 3,422" must not become a
    // sale. Keep a real long product name (for example PEPERONI MEDIUM) even
    // when its quantity digit is faint; the verified numeric pass fills it.
    if (structured && !structured.quantityDetected) {
      const words = product.replace(/[^a-zA-Z가-힣0-9\s]/g, " ").split(/\s+/).filter(Boolean);
      const looksLikeHeaderNoise = /[@#$%^&]/.test(product)
        || (words.length > 1 && words.every((word) => word.length <= 3));
      if (looksLikeHeaderNoise) continue;
    }
    const quantity = structured?.quantity ?? extractQuantity(line);
    const row = rowValues(index + 1, product, quantity, structured?.total ?? totalForLine(line, null, quantity), date, receiptId, identity.code);
    rows.push(row);
    if (structured && !structured.quantityDetected) defaultedQuantityRows.add(row.rowNumber);
  }

  const preliminaryQuantity = rows.reduce((sum, row) => sum + Number(row.values[photoPosMapping.quantity] ?? 0), 0);
  const preliminaryTotal = rows.reduce((sum, row) => sum + Number(row.values[photoPosMapping.total] ?? 0), 0);
  const summaryLines = summaryText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const summary = receiptSummary([...lines, ...summaryLines], preliminaryQuantity, preliminaryTotal);
  let accidentalSummaryRow = -1;
  if (rows.length > 1) {
    for (let index = rows.length - 1; index >= Math.max(0, rows.length - 2); index -= 1) {
      const row = rows[index];
      if (
        Number(row.values[photoPosMapping.quantity] ?? 0) === summary.quantity
        && Math.abs(Number(row.values[photoPosMapping.total] ?? 0) - summary.total) <= 100
        && normalizeProductKey(row.values[photoPosMapping.product]).length <= 6
      ) {
        accidentalSummaryRow = index;
        break;
      }
    }
  }
  if (accidentalSummaryRow >= 0) rows.splice(accidentalSummaryRow, 1);
  let parsedQuantity = rows.reduce((sum, row) => sum + Number(row.values[photoPosMapping.quantity] ?? 0), 0);
  const uncertainRows = rows.filter((row) => defaultedQuantityRows.has(row.rowNumber));
  if (summary.quantity > parsedQuantity && uncertainRows.length === 1) {
    const uncertainRow = uncertainRows[0];
    const currentQuantity = Number(uncertainRow.values[photoPosMapping.quantity] ?? 1);
    const correctedQuantity = currentQuantity + summary.quantity - parsedQuantity;
    if (correctedQuantity >= 2 && correctedQuantity <= 999) {
      uncertainRow.values[photoPosMapping.quantity] = correctedQuantity;
      parsedQuantity = summary.quantity;
    }
  }
  const parsedTotal = rows.reduce((sum, row) => sum + Number(row.values[photoPosMapping.total] ?? 0), 0);

  return {
    table: {
      fileName,
      sheetName: "Surat OCR",
      headers: Object.values(photoPosMapping),
      rows,
      headerRowNumber: 1,
      detectionScore: 6,
      truncated: false,
    },
    date,
    receiptId,
    matchedRows,
    receiptQuantity: summary.quantity,
    receiptTotal: summary.total,
    parsedQuantity,
    parsedTotal,
  };
}

function applyNumericPairs(parsed: OcrParseResult, pairs: CompleteOcrNumericPair[]) {
  const rows = parsed.table.rows.map((row, index) => ({
    ...row,
    values: {
      ...row.values,
      [photoPosMapping.quantity]: pairs[index].quantity,
      [photoPosMapping.total]: pairs[index].total,
    },
  }));
  return {
    ...parsed,
    table: { ...parsed.table, rows },
    parsedQuantity: pairs.reduce((sum, pair) => sum + pair.quantity, 0),
    parsedTotal: pairs.reduce((sum, pair) => sum + pair.total, 0),
  };
}

function trustedRowMajorityConsensus(
  parsed: OcrParseResult,
  passes: Array<CompleteOcrNumericPair[] | null>,
) {
  // These are deliberately different sources supplied in fixed order by the
  // photo flow: a narrow gamma-adjusted column, a 105-cutoff physical-row
  // read, a 90-cutoff physical-row read, and a targeted PSM6 confirmation of
  // every row where those first three differ. A disputed value is accepted
  // only with 3/4 support; without that independent targeted read this path
  // stays blocked. The final rows must still equal the printed grand total.
  if (
    parsed.receiptQuantity <= 0
    || parsed.receiptTotal <= 0
    || passes.length !== 4
    || passes.some((pass) => !pass || pass.length !== parsed.table.rows.length)
  ) return null;
  const completePasses = passes as CompleteOcrNumericPair[][];
  const selected: CompleteOcrNumericPair[] = [];
  for (let rowIndex = 0; rowIndex < parsed.table.rows.length; rowIndex += 1) {
    const counts = new Map<string, { count: number; pair: CompleteOcrNumericPair }>();
    completePasses.forEach((pass) => {
      const pair = pass[rowIndex];
      const key = `${pair.quantity}:${pair.total}`;
      const current = counts.get(key);
      counts.set(key, { count: (current?.count ?? 0) + 1, pair });
    });
    const ranked = [...counts.values()].sort((left, right) => right.count - left.count);
    if (!ranked[0] || ranked[0].count < 3 || ranked[0].count === ranked[1]?.count) return null;
    selected.push(ranked[0].pair);
  }
  const quantity = selected.reduce((sum, pair) => sum + pair.quantity, 0);
  const total = selected.reduce((sum, pair) => sum + pair.total, 0);
  return quantity === parsed.receiptQuantity && total === parsed.receiptTotal
    ? selected.map((pair) => ({ ...pair }))
    : null;
}

function exactNumericConsensus(
  parsed: OcrParseResult,
  passes: CompleteOcrNumericPair[][],
) {
  // Production supplies five differently segmented reads, including two tight
  // per-row rereads from native pixels. If they differ, use the printed footer only when it
  // leaves exactly one possible row-by-row solution. Multiple solutions are
  // never guessed.
  if (parsed.receiptQuantity <= 0 || parsed.receiptTotal <= 0 || passes.length < 4) return null;
  const candidates = parsed.table.rows.map((_, rowIndex) => {
    const unique = new Map<string, CompleteOcrNumericPair>();
    passes.forEach((pass) => {
      const pair = pass[rowIndex];
      if (pair) unique.set(`${pair.quantity}:${pair.total}`, pair);
    });
    return [...unique.values()];
  });
  if (candidates.some((values) => !values.length)) return null;
  const disputed = candidates.map((values, index) => values.length > 1 ? index : -1).filter((index) => index >= 0);
  if (disputed.length > 12) return null;
  const selected = candidates.map((values) => values[0]);
  const fixed = selected.reduce((summary, pair, index) => (
    candidates[index].length === 1
      ? { quantity: summary.quantity + pair.quantity, total: summary.total + pair.total }
      : summary
  ), { quantity: 0, total: 0 });
  const targetQuantity = parsed.receiptQuantity - fixed.quantity;
  const targetTotal = parsed.receiptTotal - fixed.total;
  if (targetQuantity < 0 || targetTotal < 0) return null;
  type DpState = { ways: 1 | 2; choices: number[] };
  let states = new Map<string, DpState>([["0:0", { ways: 1, choices: [] }]]);
  const MAX_STATES = 50_000;
  for (const rowIndex of disputed) {
    const next = new Map<string, DpState>();
    for (const [key, state] of states) {
      const [quantity, total] = key.split(":").map(Number);
      candidates[rowIndex].forEach((pair, candidateIndex) => {
        const nextQuantity = quantity + pair.quantity;
        const nextTotal = total + pair.total;
        if (nextQuantity > targetQuantity || nextTotal > targetTotal) return;
        const nextKey = `${nextQuantity}:${nextTotal}`;
        const existing = next.get(nextKey);
        if (!existing) {
          next.set(nextKey, { ways: state.ways, choices: [...state.choices, candidateIndex] });
        } else {
          existing.ways = 2;
        }
      });
    }
    if (!next.size || next.size > MAX_STATES) return null;
    states = next;
  }
  const exact = states.get(`${targetQuantity}:${targetTotal}`);
  if (!exact || exact.ways !== 1) return null;
  exact.choices.forEach((candidateIndex, depth) => {
    selected[disputed[depth]] = candidates[disputed[depth]][candidateIndex];
  });
  return selected.map((pair) => ({ ...pair }));
}

export function reconcileNumericOcrPasses(
  parsed: OcrParseResult,
  numericTexts: string[],
): OcrNumericReconciliation {
  const receiptAvailable = parsed.receiptQuantity > 0 && parsed.receiptTotal > 0;
  const originalRows = parsed.table.rows;
  const rawPasses = numericTexts.map((text) => withoutReceiptFooter(
    parseNumericOcrPairs(text),
    parsed.receiptQuantity,
    parsed.receiptTotal,
  ));
  const completedByIndex = rawPasses.map((pairs) => (
    pairs.length === originalRows.length
      ? completeNumericPairs(pairs, parsed.receiptQuantity)
      : null
  ));
  const completePasses = completedByIndex.filter((pass): pass is CompleteOcrNumericPair[] => Boolean(pass));
  const numericPairCount = Math.max(0, ...rawPasses.map((pairs) => pairs.length));

  // Pass indexes 2/3/4/5 are the independent gamma, medium-threshold,
  // strong-threshold, and targeted PSM6 confirmation reads. The fourth pass
  // exists only after every disputed physical row was successfully reread.
  const trustedMajority = trustedRowMajorityConsensus(parsed, [
    completedByIndex[2] ?? null,
    completedByIndex[3] ?? null,
    completedByIndex[4] ?? null,
    completedByIndex[5] ?? null,
  ]);
  if (receiptAvailable && trustedMajority) {
    const reconciled = applyNumericPairs(parsed, trustedMajority);
    return {
      parsed: reconciled,
      verified: true,
      issues: [],
      numericPairCount,
      message: "Har bir son va summa uch asosiy o‘qish, farqli qatorlarning alohida tasdig‘i va chek jami bilan tekshirildi.",
    };
  }

  if (!completePasses.length) {
    const counts = [...new Set(rawPasses.map((pairs) => pairs.length))].join(" / ") || "0";
    return {
      parsed,
      verified: false,
      issues: [{
        id: "numeric-row-count",
        rowNumber: null,
        product: "",
        fields: [],
        blocking: true,
        reason: `Raqamlar ustunida ${counts} qator, taomlar ro‘yxatida ${originalRows.length} qator topildi.`,
      }],
      numericPairCount,
      message: "Raqamlar qatori to‘liq mos kelmadi.",
    };
  }
  // A tight auxiliary reread may legitimately fail to segment one row. Four
  // complete independent layouts are sufficient evidence; incomplete retries
  // are ignored as candidates instead of making a correct receipt impossible
  // to verify.
  const enoughPassesComplete = completePasses.length >= 4;
  const consensus = enoughPassesComplete ? exactNumericConsensus(parsed, completePasses) : null;
  if (receiptAvailable && consensus) {
    const reconciled = applyNumericPairs(parsed, consensus);
    return {
      parsed: reconciled,
      verified: true,
      issues: [],
      numericPairCount,
      message: "Har bir son va summa ustun, alohida qator va chek jami bilan o‘zaro tekshirildi.",
    };
  }

  const preferred = completePasses
    .map((pairs) => ({
      pairs,
      exact: receiptAvailable
        && pairs.reduce((sum, pair) => sum + pair.quantity, 0) === parsed.receiptQuantity
        && pairs.reduce((sum, pair) => sum + pair.total, 0) === parsed.receiptTotal,
    }))
    .sort((left, right) => Number(right.exact) - Number(left.exact))[0]?.pairs ?? completePasses[0];
  const numericQuantity = preferred.reduce((sum, pair) => sum + pair.quantity, 0);
  const numericTotal = preferred.reduce((sum, pair) => sum + pair.total, 0);
  const issues: OcrReviewIssue[] = originalRows.flatMap((row, index) => {
    const pair = preferred[index];
    const currentQuantity = Number(row.values[photoPosMapping.quantity] ?? 0);
    const currentTotal = Number(row.values[photoPosMapping.total] ?? 0);
    const fields: OcrReviewIssue["fields"] = [];
    if (pair.quantity !== currentQuantity) fields.push("quantity");
    if (pair.total !== currentTotal) fields.push("total");
    if (!fields.length) return [];
    return [{
      id: `numeric-row-${row.rowNumber}`,
      rowNumber: row.rowNumber,
      product: String(row.values[photoPosMapping.product] ?? ""),
      fields,
      alternate: { quantity: pair.quantity, total: pair.total },
      reason: "Mustaqil OCR o‘qishlari bu qatorda bir xil natija bermadi.",
    } satisfies OcrReviewIssue];
  });
  // Keep one structural issue even when row-level alternatives are also shown.
  // Otherwise resolving only the visible preferred-vs-mixed differences could
  // accidentally hide a disagreement that exists solely between numeric passes.
  issues.push({
    id: enoughPassesComplete ? "numeric-pass-disagreement" : "numeric-pass-incomplete",
    rowNumber: null,
    product: "",
    fields: [],
    blocking: true,
    reason: !enoughPassesComplete
      ? "Mustaqil raqam tekshiruvlarining kamida bittasida qatorlar to‘liq o‘qilmadi."
      : receiptAvailable && numericQuantity === parsed.receiptQuantity && numericTotal === parsed.receiptTotal
        ? "Raqamlar jami mos, lekin mustaqil o‘qishlar ayrim qatorlarda bir xil natija bermadi."
        : receiptAvailable
          ? `Raqamlar yig‘indisi ${numericQuantity} dona / ₩${numericTotal.toLocaleString()} bo‘lib, chek jami bilan mos kelmadi.`
          : "Chekning yakuniy jami o‘qilmagani uchun raqamlar tekshirilmadi.",
  });

  return {
    parsed,
    verified: false,
    issues,
    numericPairCount,
    message: "Mustaqil o‘qishlar farq qilgan qatorlarni tekshiring.",
  };
}

export function reconcileNumericOcr(
  parsed: OcrParseResult,
  numericText: string,
) {
  return reconcileNumericOcrPasses(parsed, [numericText]);
}
