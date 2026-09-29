import { validStockDocument, type StockDocument } from "./stock-documents.ts";

export const MAX_SUPPLIER_DELIVERY_LINES = 50;

export type SupplierDeliveryLine = {
  id: string;
  inventoryId: string;
  name: string;
  packageSize: string;
  unit?: string;
  quantity: number;
  totalAmount: number;
};

export type SupplierDelivery = {
  id: string;
  supplierId: string;
  supplierAccounting?: "separate";
  operationId?: string;
  date: string;
  note: string;
  lines: SupplierDeliveryLine[];
  totalAmount: number;
  document?: StockDocument;
  createdByWorkerId: string;
  createdByName: string;
  createdAt: string;
  status: "submitted" | "approved";
  approvedAt?: string;
  settlementMode?: "debt" | "paid";
  paymentAccountId?: string;
  paymentTransactionId?: string;
};

const finitePositive = (value: unknown, max: number) => (
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max
);

export function parseSupplierDeliveryLines(value: unknown): SupplierDeliveryLine[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_SUPPLIER_DELIVERY_LINES) return null;
  const lines = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const inventoryId = String(row.inventoryId || "").trim().slice(0, 100);
    const name = String(row.name || "").trim().replace(/\s+/g, " ").slice(0, 100);
    const packageSize = String(row.packageSize || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const unit = String(row.unit || "").trim().replace(/\s+/g, " ").slice(0, 20);
    const quantity = Number(row.quantity);
    const totalAmount = Number(row.totalAmount);
    if (!inventoryId || !name || !finitePositive(quantity, 100_000) || !finitePositive(totalAmount, 100_000_000_000)) return null;
    return {
      id: String(row.id || `line-${index + 1}`).trim().slice(0, 100) || `line-${index + 1}`,
      inventoryId,
      name,
      packageSize,
      ...(unit ? { unit } : {}),
      quantity,
      totalAmount,
    } satisfies SupplierDeliveryLine;
  });
  if (!lines.every(Boolean)) return null;
  const parsed = lines as SupplierDeliveryLine[];
  if (new Set(parsed.map((line) => line.inventoryId)).size !== parsed.length) return null;
  return parsed;
}

export function supplierDeliveryTotal(lines: SupplierDeliveryLine[]) {
  return lines.reduce((sum, line) => sum + Number(line.totalAmount || 0), 0);
}

export function validSupplierDelivery(value: unknown): value is SupplierDelivery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const delivery = value as Record<string, unknown>;
  const lines = parseSupplierDeliveryLines(delivery.lines);
  const total = Number(delivery.totalAmount);
  return typeof delivery.id === "string" && delivery.id.length > 0 && delivery.id.length <= 100
    && typeof delivery.supplierId === "string" && (delivery.supplierId.length > 0 || delivery.supplierAccounting === "separate") && delivery.supplierId.length <= 100
    && (delivery.supplierAccounting === undefined || delivery.supplierAccounting === "separate")
    && (delivery.operationId === undefined || (typeof delivery.operationId === "string" && /^[a-f0-9-]{36}$/.test(delivery.operationId)))
    && (delivery.supplierAccounting !== "separate" || (delivery.settlementMode === undefined && delivery.paymentAccountId === undefined && delivery.paymentTransactionId === undefined))
    && typeof delivery.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(delivery.date)
    && typeof delivery.note === "string" && delivery.note.length <= 300
    && Boolean(lines)
    && Number.isFinite(total) && total > 0 && Math.abs(total - supplierDeliveryTotal(lines || [])) < 0.001
    && (delivery.document === undefined || validStockDocument(delivery.document))
    && typeof delivery.createdByWorkerId === "string" && delivery.createdByWorkerId.length > 0 && delivery.createdByWorkerId.length <= 100
    && typeof delivery.createdByName === "string" && delivery.createdByName.length > 0 && delivery.createdByName.length <= 100
    && typeof delivery.createdAt === "string" && Number.isFinite(Date.parse(delivery.createdAt))
    && ["submitted", "approved"].includes(String(delivery.status))
    && (delivery.approvedAt === undefined || (typeof delivery.approvedAt === "string" && Number.isFinite(Date.parse(delivery.approvedAt))))
    && (delivery.settlementMode === undefined || ["debt", "paid"].includes(String(delivery.settlementMode)))
    && (delivery.paymentAccountId === undefined || (typeof delivery.paymentAccountId === "string" && delivery.paymentAccountId.length > 0 && delivery.paymentAccountId.length <= 100))
    && (delivery.paymentTransactionId === undefined || (typeof delivery.paymentTransactionId === "string" && delivery.paymentTransactionId.length > 0 && delivery.paymentTransactionId.length <= 100))
    && (delivery.settlementMode !== "paid" || (typeof delivery.paymentAccountId === "string" && typeof delivery.paymentTransactionId === "string"));
}

export function validSupplierDeliveries(value: unknown) {
  return Array.isArray(value) && value.every(validSupplierDelivery);
}
