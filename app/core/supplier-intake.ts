/**
 * HALO V2 — yetkazib beruvchi profili: mahsulotlar ro'yxati (nomi, o'lchovi, oxirgi narxi) va «Yangi kirim».
 *
 * Bitta saqlash = bitta hujjat: ombor kirimi + yetkazib beruvchiga qarz + (bo'lsa) to'lov. Shu sabab bir yuk ikki joyga
 * kiritilmaydi va summa doim bir xil chiqadi.
 *
 * Yozish eski tizimning tekshirilgan «Xarid / kirim» hujjati (applyUnifiedIntake) orqali bajariladi — bekor qilish,
 * solishtirish akti, ombor hujjatlari va hisobotlar uni allaqachon taniydi. Xarajat ikki marta yozilmaydi:
 *  - ombor mahsuloti — xarajat emas (sotilganda retsept bo'yicha xarajatga aylanadi);
 *  - omborsiz mahsulot (sabzavot/sous yoki qo'lda "omborsiz" deb belgilangan) — olingan kuni bir marta xarajat;
 *  - to'lov — foydaga ta'sir qilmaydi (affectsProfit=false), faqat qarz va kassa o'zgaradi.
 *
 * Mahsulotlar ro'yxati alohida jadvalda (v2_supplier_products) — eski saytdan ma'lumot ko'chirilganda tegilmaydi.
 */
import { applyUnifiedIntake, IntakeError, planIntakeLine } from "../lib/unified-intake";
import { expenseOnlyOnDate } from "../lib/vegetable-expenses";
import { isMezanaSupplierName } from "../lib/mezana-debts";
import { mezanaNameKey } from "../lib/mezana-posting";
import type { D1Like } from "../lib/full-migration";
import { CatalogError, saveProduct as saveInventoryProduct } from "./catalog";
import { categoryIdOf, categoryList } from "./categories";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const money = (value: number) => `₩${Math.round(value).toLocaleString("en-US")}`;
const UUID = /^[a-f0-9-]{36}$/;
/** Narx oxirgisidan shuncha foizdan ko'p farq qilsa, saqlashdan oldin tasdiq so'raladi (xato terishdan himoya). */
export const PRICE_JUMP_PCT = 30;
const DAY_MS = 86_400_000;

export class SupplierIntakeError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "", readonly details: unknown = undefined) { super(message); }
}

/* ---------- Mahsulotlar ro'yxati (profil) ---------- */

export interface SupplierProduct {
  id: string; name: string;
  /** Ombor mahsuloti; bo'sh — omborsiz xarajat (omborda yuritilmaydi). */
  inventoryId: string;
  /** Xarid birligi: kg, litr, dona, quti… */
  unit: string;
  /** 1 xarid birligi narxi (₩) — oxirgi kirim bo'yicha. 0 — hali noma'lum. */
  price: number;
  updatedAt: string;
}
type ProductDbRow = { id: string; name: string; inventory_id: string; unit: string; price: number; updated_at: string };

const SCHEMA = `CREATE TABLE IF NOT EXISTS v2_supplier_products (
  branch_id TEXT NOT NULL, supplier_id TEXT NOT NULL, id TEXT NOT NULL,
  name TEXT NOT NULL, inventory_id TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT 'dona', price REAL NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (branch_id, supplier_id, id)
)`;
const schemaReady = new WeakSet<object>();
export async function ensureSupplierProductSchema(db: D1Like) {
  if (schemaReady.has(db)) return;
  await db.prepare(SCHEMA).run();
  schemaReady.add(db);
}
const roundPrice = (value: number) => Math.round(value * 10_000) / 10_000;
const toProduct = (row: ProductDbRow): SupplierProduct => ({ id: row.id, name: row.name, inventoryId: row.inventory_id, unit: row.unit, price: Number(row.price) || 0, updatedAt: row.updated_at });

export async function listSupplierProducts(db: D1Like, branchId: string, supplierId: string): Promise<SupplierProduct[]> {
  await ensureSupplierProductSchema(db);
  const result = await db.prepare("SELECT id, name, inventory_id, unit, price, updated_at FROM v2_supplier_products WHERE branch_id = ? AND supplier_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE, id")
    .bind(branchId, supplierId).all<ProductDbRow>();
  return result.results.map(toProduct);
}

const supplierOf = (state: Row, supplierId: string) => {
  const supplier = rows(state.suppliers).find((entry) => entry.id === supplierId);
  if (!supplier) throw new SupplierIntakeError("Yetkazib beruvchi topilmadi. Sahifani yangilang.", 404);
  if (isMezanaSupplierName(supplier.name)) throw new SupplierIntakeError("MEZANA uchun alohida «MEZANA hisobi» bo‘limidan foydalaning.");
  return supplier;
};
const activeInventory = (state: Row) => rows(state.inventory).filter((item) => typeof item.id === "string" && item.id && item.catalogArchived !== true);

/** Ombor mahsulotiga shu birlik mos keladimi (kg ↔ g, litr ↔ ml, qadoq). Mos kelmasa — tushunarli xato. */
function assertUnitFits(state: Row, inventoryId: string, unit: string, date: string) {
  try {
    planIntakeLine(rows(state.inventory) as never, { inventoryId, quantity: 1, unit, amount: 1 }, date);
  } catch (error) {
    throw new SupplierIntakeError(error instanceof Error ? error.message : "Birlikni tekshiring.");
  }
}

/** Profilga mahsulot qo'shish yoki tahrirlash (nomi, birligi, narxi). Kirim yozmaydi. */
export async function saveSupplierProduct(db: D1Like, branchId: string, supplierId: string, input: Row, state: Row, today: string, now = new Date().toISOString()): Promise<SupplierProduct> {
  supplierOf(state, supplierId);
  const id = clean(input.id, 80);
  if (!/^[a-z0-9:-]{8,80}$/.test(id)) throw new SupplierIntakeError("Oynani yangilang.");
  const inventoryId = clean(input.inventoryId, 100);
  const item = inventoryId ? activeInventory(state).find((entry) => entry.id === inventoryId) : undefined;
  if (inventoryId && !item) throw new SupplierIntakeError("Ombor mahsuloti topilmadi. Ro‘yxatni yangilang.");
  const name = item ? clean(item.name, 100) : clean(input.name, 100);
  if (name.length < 2) throw new SupplierIntakeError("Mahsulot nomini yozing.");
  if (!item && activeInventory(state).some((entry) => mezanaNameKey(String(entry.name)) === mezanaNameKey(name))) throw new SupplierIntakeError(`«${name}» omborda bor — uni ombor ro‘yxatidan tanlang.`);
  const unit = clean(input.unit, 30) || (item ? String(item.unit) : "dona");
  if (item) assertUnitFits(state, inventoryId, unit, today);
  const price = Number(input.price ?? 0);
  if (!Number.isFinite(price) || price < 0 || price > 1e9) throw new SupplierIntakeError("Narxni tekshiring.");
  const others = (await listSupplierProducts(db, branchId, supplierId)).filter((entry) => entry.id !== id);
  const twin = others.find((entry) => (inventoryId ? entry.inventoryId === inventoryId && entry.unit.toLocaleLowerCase() === unit.toLocaleLowerCase() : !entry.inventoryId && mezanaNameKey(entry.name) === mezanaNameKey(name)));
  if (twin) throw new SupplierIntakeError(`«${twin.name}» bu ro‘yxatda allaqachon bor.`, 409);
  await db.prepare(
    `INSERT INTO v2_supplier_products (branch_id, supplier_id, id, name, inventory_id, unit, price, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(branch_id, supplier_id, id) DO UPDATE SET name = excluded.name, inventory_id = excluded.inventory_id, unit = excluded.unit, price = excluded.price, archived = 0, updated_at = excluded.updated_at`,
  ).bind(branchId, supplierId, id, name, inventoryId, unit, roundPrice(price), now, now).run();
  return { id, name, inventoryId, unit, price: roundPrice(price), updatedAt: now };
}

/** Ro'yxatdan olib tashlash: kiritilgan kirimlarga ta'sir qilmaydi. */
export async function removeSupplierProduct(db: D1Like, branchId: string, supplierId: string, id: string, now = new Date().toISOString()) {
  await ensureSupplierProductSchema(db);
  await db.prepare("UPDATE v2_supplier_products SET archived = 1, updated_at = ? WHERE branch_id = ? AND supplier_id = ? AND id = ?").bind(now, branchId, supplierId, clean(id, 80)).run();
}

/** Kirim oynasi uchun: ombor mahsulotlari (birliklari bilan) va kategoriyalar. */
export function intakeInventoryChoices(state: Row, today: string) {
  return {
    categories: categoryList(state, "inventory"),
    inventory: activeInventory(state).map((item) => ({
      id: String(item.id), name: String(item.name || item.id), unit: String(item.unit || "dona"),
      packageName: String(item.packageName || ""), unitsPerPackage: Number(item.unitsPerPackage) || 0,
      vegetable: expenseOnlyOnDate(item as never, today), categoryId: categoryIdOf(state, "inventory", item),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

/* ---------- Yangi kirim ---------- */

export interface IntakeLineSummary {
  index: number; name: string; quantity: number; unit: string; amount: number;
  /** stock — omborga; vegetableExpense — sabzavot/sous (olingan kuni xarajat); expense — omborsiz xarajat. */
  destination: string;
  inventoryId: string; productId: string; remember: boolean; unitPrice: number;
}
export interface SupplierIntakeResult {
  alreadySaved: boolean; id: string; supplierId: string; supplierName: string; date: string;
  total: number; paid: number; debt: number; lines: IntakeLineSummary[]; createdInventory: string[];
}

/**
 * Sof funksiya: holatni o'zgartirib, yangi holatni qaytaradi (bazaga o'zi yozmaydi).
 * `products` — shu yetkazib beruvchining saqlangan ro'yxati (narxni solishtirish va ro'yxatdagi qatorni topish uchun).
 */
export function applySupplierIntake(state: Row, input: Row, products: SupplierProduct[], today: string): { state: Row; result: SupplierIntakeResult } {
  const operationId = clean(input.operationId, 36);
  if (!UUID.test(operationId)) throw new SupplierIntakeError("Oynani yangilang.");
  const supplier = supplierOf(state, clean(input.supplierId, 100));
  const supplierName = clean(supplier.name, 100);
  const date = clean(input.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new SupplierIntakeError("Sanani tekshiring (kelajak bo‘lmasin).");
  const rawLines = Array.isArray(input.lines) ? input.lines as unknown[] : [];
  if (!rawLines.length || rawLines.length > 50) throw new SupplierIntakeError("1–50 ta mahsulot kiriting.");
  const intakeId = `intake:${operationId}`;
  const retry = rows(state.transactions).some((tx) => tx.id === intakeId);

  let next = state;
  const createdInventory: string[] = [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const resolved = rawLines.map((raw, index) => {
    const line = raw && typeof raw === "object" ? raw as Row : {};
    const quantity = Number(line.quantity);
    const amount = Number(line.amount);
    const label = `${index + 1}-qator`;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) throw new SupplierIntakeError(`${label}: miqdorni yozing.`);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1e11) throw new SupplierIntakeError(`${label}: jami narxni yozing.`);
    const productId = clean(line.productId, 80);
    const saved = productId ? productById.get(productId) : undefined;
    if (productId && !saved) throw new SupplierIntakeError("Mahsulotlar ro‘yxati o‘zgargan. Oynani qayta oching.", 409);
    let inventoryId = saved ? saved.inventoryId : clean(line.inventoryId, 100);
    let name = saved ? saved.name : clean(line.name, 100);
    let unit = saved ? saved.unit : clean(line.unit, 30);
    const mode = saved ? (saved.inventoryId ? "stock" : "expense") : inventoryId ? "stock" : clean(line.mode, 10);
    if (mode === "new") {
      // Omborda yo'q — yangi ombor mahsuloti shu saqlashning o'zida yaratiladi (kg → g, litr → ml hisobida).
      const buyUnit = clean(line.newUnit, 10) || "dona";
      const base = buyUnit === "kg" ? "g" : buyUnit === "litr" ? "ml" : buyUnit;
      if (!["g", "ml", "dona"].includes(base)) throw new SupplierIntakeError(`${label}: o‘lchovni tanlang — kg, litr yoki dona.`);
      try {
        const made = saveInventoryProduct(next, { operationId: clean(line.newItemOp, 36), name, unit: base });
        next = made.state as Row;
        inventoryId = String((made.result.product as Row).id);
        if (made.result.created) createdInventory.push(name);
      } catch (error) {
        if (error instanceof CatalogError) throw new SupplierIntakeError(`${label}: ${error.message}`, error.status);
        throw error;
      }
      unit = buyUnit;
    } else if (mode === "stock") {
      const item = activeInventory(next).find((entry) => entry.id === inventoryId);
      if (!item) throw new SupplierIntakeError(`${label}: «${name || "mahsulot"}» omborda topilmadi yoki ro‘yxatdan olib tashlangan. Ro‘yxatni yangilang.`, 409);
      name = clean(item.name, 100);
      unit = unit || String(item.unit);
    } else if (mode === "expense") {
      if (name.length < 2) throw new SupplierIntakeError(`${label}: mahsulot nomini yozing.`);
      // Omborda bor narsani "omborsiz xarajat" deb yozib bo'lmaydi — aks holda xarajat ikki marta hisoblanadi.
      if (activeInventory(next).some((entry) => mezanaNameKey(String(entry.name)) === mezanaNameKey(name))) throw new SupplierIntakeError(`${label}: «${name}» omborda bor — uni ombor ro‘yxatidan tanlang.`);
      inventoryId = "";
      unit = unit || "dona";
    } else {
      throw new SupplierIntakeError(`${label}: mahsulot omborga kiradimi yoki omborsiz xarajatmi — tanlang.`);
    }
    return { index, productId, saved, inventoryId, name, unit, quantity, amount, remember: !saved && line.remember === true };
  });

  const inventory = rows(next.inventory);
  const planned = resolved.map((line) => {
    try {
      return { ...line, plan: planIntakeLine(inventory as never, { inventoryId: line.inventoryId || undefined, name: line.name, quantity: line.quantity, unit: line.unit, amount: line.amount }, date) };
    } catch (error) {
      throw new SupplierIntakeError(`${line.index + 1}-qator: ${error instanceof Error ? error.message : "tekshiring."}`);
    }
  });
  const total = planned.reduce((sum, line) => sum + line.amount, 0);
  const paid = input.paidAmount === undefined || input.paidAmount === null || input.paidAmount === "" ? NaN : Number(input.paidAmount);
  if (!Number.isSafeInteger(paid) || paid < 0 || paid > total) throw new SupplierIntakeError("To‘lovni belgilang: qarzga olindimi yoki to‘landimi (to‘langan summa jamidan oshmasin).");
  const accountId = clean(input.accountId, 100);
  if (paid > 0 && !rows(next.accounts).some((account) => account.id === accountId && (account.type === "cash" || account.type === "bank") && account.active !== false)) {
    throw new SupplierIntakeError("Pul qaysi hisobdan to‘langanini tanlang.");
  }
  const reason = clean(input.duplicateReason, 300);

  if (!retry) {
    // 1) Narx himoyasi: oxirgi narxdan keskin farq — avval tasdiq.
    const jumps = planned.flatMap((line) => {
      const item = line.inventoryId ? inventory.find((entry) => entry.id === line.inventoryId) : undefined;
      let reference = 0, current = 0, per = line.unit;
      if (line.saved && line.saved.price > 0) { reference = line.saved.price; current = line.amount / line.quantity; }
      else if (item && line.plan.destination === "stock" && Number(item.unitCost) > 0 && line.plan.stockQuantity > 0) { reference = Number(item.unitCost); current = line.amount / line.plan.stockQuantity; per = String(item.unit); }
      if (!(reference > 0) || Math.abs(current - reference) * 100 <= reference * PRICE_JUMP_PCT) return [];
      const scale = per === "g" || per === "ml" ? 1000 : 1;
      const shown = per === "g" ? "kg" : per === "ml" ? "litr" : per;
      return [{ index: line.index, name: line.name, unit: shown, before: Math.round(reference * scale), now: Math.round(current * scale) }];
    });
    if (jumps.length && input.priceConfirmed !== true) {
      throw new SupplierIntakeError(
        `Narx oxirgisidan ${PRICE_JUMP_PCT}% dan ko‘p farq qiladi: ${jumps.map((jump) => `${jump.name} — 1 ${jump.unit} ${money(jump.before)} edi, hozir ${money(jump.now)}`).join("; ")}. To‘g‘ri bo‘lsa tasdiqlang.`,
        409, "PRICE_JUMP", jumps);
    }
    // 2) Shu yuk «Ombor kirimi» (yoki boshqa alohida hujjat) orqali allaqachon kiritilgan bo'lishi mumkin — 3 kun ichida.
    //    Shu oynadan kiritilgan oldingi kirimlar bu yerda hisobga olinmaydi: har kuni bir xil yuk keladigan yetkazib
    //    beruvchi har safar so'roqqa tutilmasin (bir kunda ikki marta kiritish pastdagi eski qoida bilan ushlanadi).
    const signature = (list: Array<{ inventoryId: string; stockQuantity: number; quantity: number; unit: string; amount: number }>) => JSON.stringify(list
      .map((line) => [line.inventoryId, line.stockQuantity > 0 ? line.stockQuantity : line.quantity, line.stockQuantity > 0 ? "" : line.unit, line.amount])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
    const mine = planned.filter((line) => line.plan.inventoryId).map((line) => ({ inventoryId: line.plan.inventoryId, stockQuantity: Number(line.plan.stockQuantity) || 0, quantity: line.quantity, unit: line.unit, amount: line.amount }));
    if (mine.length && reason.length < 5) {
      const groups = new Map<string, { date: string; lines: typeof mine }>();
      for (const move of rows(state.stockMovements)) {
        if (move.type !== "receipt" || move.intakeId || !(Math.abs(Date.parse(String(move.date)) - Date.parse(date)) <= 3 * DAY_MS)) continue;
        const key = String(move.warehouseOperationId || move.intakeId || move.referenceId || move.id);
        const item = inventory.find((entry) => entry.id === move.inventoryId);
        const quantity = Number(move.purchaseQuantity ?? move.quantity) || 0;
        const group = groups.get(key) || { date: String(move.date), lines: [] };
        group.lines.push({
          inventoryId: String(move.inventoryId), stockQuantity: Number(move.purchaseBaseQuantity ?? move.quantity) || 0, quantity,
          unit: String(move.purchaseUnit || item?.unit || ""), amount: Number(move.purchaseAmount ?? Math.round((Number(move.quantity) || 0) * (Number(move.unitCost) || 0))),
        });
        groups.set(key, group);
      }
      const wanted = signature(mine);
      const twin = [...groups.values()].find((group) => signature(group.lines) === wanted);
      if (twin) {
        throw new SupplierIntakeError(
          `${twin.date} kuni aynan shu mahsulot, miqdor va narxda kirim allaqachon bor (Ombor kirimi yoki boshqa hujjat). O‘sha yuk bo‘lsa, qayta saqlamang — mahsulot va xarajat ikki marta hisoblanadi. Boshqa yuk bo‘lsa, sababini yozing.`,
          409, "SIMILAR_PURCHASE");
      }
    }
  }

  let applied: { state: Row; result: Row };
  try {
    applied = applyUnifiedIntake(next as never, {
      operationId, supplierName, date, paidAmount: paid, accountId: paid > 0 ? accountId : "", duplicateReason: reason || undefined,
      lines: planned.map((line) => ({
        ...(line.inventoryId ? { inventoryId: line.inventoryId } : { expenseConfirmed: true }),
        name: line.name, quantity: line.quantity, unit: line.unit, amount: line.amount,
      })),
    }) as { state: Row; result: Row };
  } catch (error) {
    if (error instanceof IntakeError) throw new SupplierIntakeError(error.message, error.code === "SIMILAR_PURCHASE" ? 409 : 400, error.code || "");
    throw error;
  }
  const record = (applied.result.record || {}) as Row;
  if (record.supplierId !== supplier.id) throw new SupplierIntakeError("Yetkazib beruvchi nomi takrorlangan. Avval nomlarini ajrating.", 409);
  return {
    state: applied.state,
    result: {
      alreadySaved: applied.result.alreadySaved === true, id: intakeId, supplierId: String(supplier.id), supplierName, date, total, paid, debt: total - paid, createdInventory,
      lines: planned.map((line) => ({
        index: line.index, name: line.plan.name, quantity: line.quantity, unit: line.unit, amount: line.amount, destination: line.plan.destination,
        inventoryId: line.plan.inventoryId, productId: line.productId, remember: line.remember, unitPrice: roundPrice(line.amount / line.quantity),
      })),
    },
  };
}

/**
 * Kirim saqlangach profil yangilanadi: ro'yxatdagi mahsulot narxi — shu kirimdagi narxga; «ro'yxatga saqlansin» deb
 * belgilangan yangi mahsulot — ro'yxatga. Kirimning o'ziga ta'sir qilmaydi (bajarilmasa ham kirim saqlangan bo'ladi).
 */
export async function rememberIntakePrices(db: D1Like, branchId: string, result: SupplierIntakeResult, now = new Date().toISOString()): Promise<number> {
  await ensureSupplierProductSchema(db);
  const existing = await listSupplierProducts(db, branchId, result.supplierId);
  const statements = [];
  for (const line of result.lines) {
    const twin = line.productId
      ? existing.find((entry) => entry.id === line.productId)
      : existing.find((entry) => (line.inventoryId ? entry.inventoryId === line.inventoryId && entry.unit.toLocaleLowerCase() === line.unit.toLocaleLowerCase() : !entry.inventoryId && mezanaNameKey(entry.name) === mezanaNameKey(line.name)));
    if (twin) {
      if (twin.price !== line.unitPrice) statements.push(db.prepare("UPDATE v2_supplier_products SET price = ?, updated_at = ? WHERE branch_id = ? AND supplier_id = ? AND id = ?").bind(line.unitPrice, now, branchId, result.supplierId, twin.id));
    } else if (line.remember) {
      statements.push(db.prepare(
        `INSERT INTO v2_supplier_products (branch_id, supplier_id, id, name, inventory_id, unit, price, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(branch_id, supplier_id, id) DO UPDATE SET price = excluded.price, archived = 0, updated_at = excluded.updated_at`,
      ).bind(branchId, result.supplierId, `${result.id.slice("intake:".length)}:${line.index}`, line.name, line.inventoryId, line.unit, line.unitPrice, now, now));
    }
  }
  for (let index = 0; index < statements.length; index += 40) await db.batch(statements.slice(index, index + 40));
  return statements.length;
}
