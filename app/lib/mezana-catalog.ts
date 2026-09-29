import { validStockDocument, type StockDocument } from "./stock-documents.ts";

export type MezanaCatalogMode = "borrowed" | "purchased";

export type MezanaCatalogItem = {
  id: string;
  name: string;
  mode: MezanaCatalogMode;
  price: number;
  inventoryId?: string;
  inventoryUnitsPerItem?: number;
  image?: StockDocument;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export function validMezanaCatalogItem(value: unknown): value is MezanaCatalogItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.startsWith("mezana-product:") && item.id.length <= 100
    && typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 140
    && (item.mode === "borrowed" || item.mode === "purchased")
    && Number.isSafeInteger(item.price) && Number(item.price) > 0 && Number(item.price) <= 100_000_000_000
    && (item.image === undefined || validStockDocument(item.image))
    && (item.inventoryId === undefined || (typeof item.inventoryId === "string" && item.inventoryId.length <= 100))
    && (item.inventoryUnitsPerItem === undefined || (Number.isFinite(item.inventoryUnitsPerItem) && Number(item.inventoryUnitsPerItem) > 0 && Number(item.inventoryUnitsPerItem) <= 1_000_000_000))
    && typeof item.active === "boolean"
    && typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt))
    && typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt));
}

export function normalizeMezanaCatalog(value: unknown): MezanaCatalogItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    if (!validMezanaCatalogItem(raw) || seen.has(raw.id)) return [];
    seen.add(raw.id);
    return [{ ...raw, name: raw.name.trim().replace(/\s+/g, " ") }];
  });
}

export function mezanaCatalogItemForAction(
  catalog: MezanaCatalogItem[],
  itemId: string,
  action: "borrowed" | "returned" | "purchased",
) {
  const item = catalog.find((candidate) => candidate.id === itemId && candidate.active);
  if (!item) return null;
  if (action === "purchased" && item.mode !== "purchased") return null;
  if ((action === "borrowed" || action === "returned") && item.mode !== "borrowed") return null;
  return item;
}
