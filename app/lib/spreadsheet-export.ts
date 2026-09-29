export type SpreadsheetValue = string | number | boolean | null | undefined;
export type SpreadsheetRow = Record<string, SpreadsheetValue>;

const FORMULA_PREFIX = /^[=+@\-\t\r]/;

export function safeSpreadsheetValue(value: SpreadsheetValue): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return value;
  const clean = value.replace(/\0/g, "");
  return FORMULA_PREFIX.test(clean) ? `'${clean}` : clean;
}

export function safeSpreadsheetRows(rows: SpreadsheetRow[]) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, safeSpreadsheetValue(value)]),
  ));
}

function csvCell(value: SpreadsheetValue) {
  const safe = safeSpreadsheetValue(value);
  if (typeof safe === "number" || typeof safe === "boolean") return String(safe);
  return `"${safe.replace(/"/g, '""')}"`;
}

export function spreadsheetRowsToCsv(rows: SpreadsheetRow[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!columns.length) return "\uFEFF";
  const lines = [
    columns.map((column) => csvCell(column)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function safeFilePart(value: string, fallback = "hisobot") {
  const clean = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return clean || fallback;
}
