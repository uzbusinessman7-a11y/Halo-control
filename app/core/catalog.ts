/**
 * HALO V2 — ombor mahsulotlari katalogi: ro'yxat (qoldiq, minimum, qiymat) va mahsulot yaratish/tahrirlash.
 * Ma'lumot hozircha filial holatida (app_state) saqlanadi; bu yerda server tomonda qat'iy tekshiriladi.
 */
import { configureExpenseOnly, expenseOnlyOnDate } from "../lib/vegetable-expenses";
import { setInventoryCatalogArchived } from "../lib/inventory-catalog-archive";

type Row = Record<string, unknown>;
export const STOCK_UNITS = ["g", "ml", "dona", "kg", "litr"] as const;
export class CatalogError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const nameKey = (value: unknown) => clean(value, 100).toLocaleLowerCase().replace(/[‘’`ʻʼ']/g, "'");

export interface ProductRow {
  id: string; name: string; unit: string; stock: number; minStock: number; unitCost: number; value: number;
  packageName: string; unitsPerPackage: number; vegetable: boolean; low: boolean; lastReceipt: string | null; movements: number; supplierId: string;
}

export function productList(state: Row, today: string): ProductRow[] {
  const movements = rows(state.stockMovements);
  const lastReceipt = new Map<string, string>();
  const count = new Map<string, number>();
  for (const move of movements) {
    const id = String(move.inventoryId || "");
    count.set(id, (count.get(id) || 0) + 1);
    if (move.type === "receipt" && String(move.date || "") > (lastReceipt.get(id) || "")) lastReceipt.set(id, String(move.date));
  }
  return rows(state.inventory)
    .filter((item) => typeof item.id === "string" && item.id && item.catalogArchived !== true)
    .map((item) => {
      const stock = Number(item.stock) || 0;
      const minStock = Number(item.minStock) || 0;
      const unitCost = Number(item.unitCost) || 0;
      const vegetable = expenseOnlyOnDate(item as never, today);
      return {
        id: String(item.id), name: String(item.name || item.id), unit: String(item.unit || "dona"), stock, minStock, unitCost,
        value: vegetable ? 0 : Math.round(Math.max(0, stock) * unitCost),
        packageName: String(item.packageName || ""), unitsPerPackage: Number(item.unitsPerPackage) || 0,
        vegetable, low: !vegetable && minStock > 0 && stock <= minStock,
        lastReceipt: lastReceipt.get(String(item.id)) || null, movements: count.get(String(item.id)) || 0, supplierId: String(item.supplierId || ""),
      };
    })
    .sort((left, right) => Number(right.low) - Number(left.low) || left.name.localeCompare(right.name));
}

/** Mahsulot yaratish yoki tahrirlash. Harakati bor mahsulotning birligi o'zgartirilmaydi (tarix buziladi). */
export function saveProduct(state: Row, body: Row) {
  const inventory = rows(state.inventory);
  const id = clean(body.id, 100);
  if (!id) {
    // Takroriy so'rov (tarmoq uzilib qayta yuborilgan) — ikkinchi mahsulot yaratmaydi.
    const op = clean(body.operationId, 36);
    const again = /^[a-f0-9-]{36}$/.test(op) ? inventory.find((item) => item.id === `inv-${op.slice(0, 13)}`) : undefined;
    if (again) return { state, result: { product: again, created: false } };
  }
  const name = clean(body.name, 100);
  const unit = clean(body.unit, 10);
  const minStock = Number(body.minStock ?? 0);
  const packageName = clean(body.packageName, 30);
  const unitsPerPackage = Number(body.unitsPerPackage ?? 0);
  if (name.length < 2) throw new CatalogError("Mahsulot nomini yozing.");
  if (!(STOCK_UNITS as readonly string[]).includes(unit)) throw new CatalogError("Birlikni tanlang: g, ml, dona, kg yoki litr.");
  if (!Number.isFinite(minStock) || minStock < 0 || minStock > 1e9) throw new CatalogError("Minimum qoldiqni tekshiring.");
  if (packageName && (!Number.isFinite(unitsPerPackage) || unitsPerPackage <= 0 || unitsPerPackage > 1e7)) throw new CatalogError("Qadoqda nechta birlik borligini yozing.");
  const twin = inventory.find((item) => item.id !== id && item.catalogArchived !== true && nameKey(item.name) === nameKey(name));
  if (twin) throw new CatalogError(`«${String(twin.name)}» nomli mahsulot allaqachon bor.`, 409);
  const supplierId = clean(body.supplierId, 100);
  if (supplierId && !rows(state.suppliers).some((supplier) => supplier.id === supplierId)) throw new CatalogError("Yetkazib beruvchi topilmadi.");
  const fields = { name, minStock, packageName, unitsPerPackage: packageName ? unitsPerPackage : 0, ...(body.supplierId !== undefined ? { supplierId } : {}) };
  // Sabzavot/sous: sanalmaydi, xaridi xarajat bo'lib yoziladi. O'zgarish tarixi bilan (eski hisobotlar buzilmaydi).
  const withVeg = (next: Row, productId: string) => (body.vegetable === undefined ? next
    : configureExpenseOnly(next, productId, body.vegetable === true));
  if (id) {
    const current = inventory.find((item) => item.id === id);
    if (!current) throw new CatalogError("Mahsulot topilmadi. Sahifani yangilang.", 404);
    const used = rows(state.stockMovements).some((move) => move.inventoryId === id);
    if (current.unit !== unit && used) throw new CatalogError("Bu mahsulotning harakatlari bor — birligini o'zgartirib bo'lmaydi. Yangi mahsulot yarating.", 409);
    const updated = { ...current, ...fields, unit, updatedAt: new Date().toISOString() };
    return { state: withVeg({ ...state, inventory: inventory.map((item) => (item.id === id ? updated : item)) }, id), result: { product: updated, created: false } };
  }
  const operationId = clean(body.operationId, 36);
  if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new CatalogError("Oynani yangilang.");
  const newId = `inv-${operationId.slice(0, 13)}`;
  const existing = inventory.find((item) => item.id === newId);
  if (existing) return { state, result: { product: existing, created: false } };
  const product = { id: newId, ...fields, unit, stock: 0, unitCost: 0, packageCost: 0, gramsPerUnit: unit === "g" ? 1 : 0, supplierId: "", categoryId: "", createdAt: new Date().toISOString() };
  return { state: withVeg({ ...state, inventory: [product, ...inventory] }, newId), result: { product, created: true } };
}

/** Ro'yxatdan olib tashlangan (arxiv) mahsulotlar — tiklash uchun. */
export function archivedProducts(state: Row) {
  return rows(state.inventory).filter((item) => item.catalogArchived === true)
    .map((item) => ({ id: String(item.id), name: String(item.name || item.id), unit: String(item.unit || ""), stock: Number(item.stock) || 0, reason: String(item.catalogArchiveReason || ""), at: String(item.catalogArchivedAt || "") }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Mahsulotni ro'yxatdan olib tashlash yoki tiklash. Qoldiq, tarix va retseptlar o'zgarmaydi. */
export function archiveProduct(state: Row, body: Row, archived: boolean) {
  const id = clean(body.id, 100);
  if (archived) {
    const reason = clean(body.reason, 300);
    if (reason.length < 3) throw new CatalogError("Sababini yozing.");
    const used = rows(state.recipes).filter((recipe) => recipe.archived !== true && rows(recipe.ingredients).some((line) => line.inventoryId === id));
    if (used.length && body.force !== true) throw new CatalogError(`Bu mahsulot ${used.length} ta taom retseptida bor: ${used.slice(0, 3).map((r) => String(r.name)).join(", ")}. Avval retseptdan almashtiring.`, 409);
  }
  const out = setInventoryCatalogArchived(state, id, archived, clean(body.reason, 300));
  return { state: out.state as Row, result: { alreadySaved: out.result.alreadySaved } };
}
