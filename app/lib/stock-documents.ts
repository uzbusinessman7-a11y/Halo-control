export const STOCK_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

export const STOCK_DOCUMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type StockDocument = {
  key: string;
  fileName: string;
  contentType: typeof STOCK_DOCUMENT_TYPES[number];
  size: number;
  uploadedAt: string;
};

export function safeStockDocumentKey(value: unknown): value is string {
  return typeof value === "string"
    && /^stock-documents\/[a-z0-9][a-z0-9_-]{0,79}\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(value);
}

export function validStockDocument(value: unknown): value is StockDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return safeStockDocumentKey(document.key)
    && typeof document.fileName === "string"
    && document.fileName.trim().length > 0
    && document.fileName.length <= 180
    && typeof document.contentType === "string"
    && STOCK_DOCUMENT_TYPES.includes(document.contentType as StockDocument["contentType"])
    && Number.isInteger(document.size)
    && Number(document.size) > 0
    && Number(document.size) <= STOCK_DOCUMENT_MAX_BYTES
    && typeof document.uploadedAt === "string"
    && Number.isFinite(Date.parse(document.uploadedAt));
}

export function validStockDocuments(value: unknown) {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const document = (entry as Record<string, unknown>).document;
    return document === undefined || document === null || validStockDocument(document);
  });
}
