/**
 * HALO V2 — omborni nolga tushirish (boshlang'ich sanoq oldidan).
 *
 * Rahbar menyu va retseptlarni tayyorlab bo'lgach, bitta buyruq bilan hamma mahsulot qoldig'ini 0 qiladi,
 * keyin omborni sanab ishni boshlaydi. Bu buyruq FAQAT qoldiqqa tegadi:
 *  - o'zgarmaydi: mahsulot narxi (unitCost), qadoq, minimum, kategoriya, retseptlar, menyu, savdo, kassa,
 *    qarz, maosh, eski harakatlar va sanoqlar tarixi;
 *  - yoziladi: har mahsulotga bitta "nolga tushirish" tuzatish harakati (qoldiq hujjatsiz o'zgarmasin —
 *    jurnal yig'indisi ham 0 bo'ladi) va kim/qachon bosgani.
 *
 * Nolga tushirilgandan keyingi BIRINCHI sanoq — boshlang'ich qoldiq: u "ortiqcha" ham, "kamomad" ham emas,
 * oziq-ovqat tannarxi va yo'qotish hisobotiga kirmaydi. Keyingi sanoqlar odatdagidek farqni ko'rsatadi.
 */
import { isAccountingMonthClosed } from "../lib/month-end";
import { isExpenseOnlyInventory } from "../lib/vegetable-expenses";
import { fromMilli, toMilli } from "./stock";

type Row = Record<string, unknown>;
const isRow = (row: unknown): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row);
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter(isRow) : []);
/** Ro'yxatni aynan o'zidek (hech narsani tashlamasdan) olish — boshqa yozuvlar o'zgarmasin. */
const raw = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export class StockResetError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Tasdiqlash uchun yoziladigan so'z. */
export const STOCK_ZERO_WORD = "NOL";
const ZERO_NOTE = "Ombor nolga tushirildi — boshlang‘ich sanoq oldidan";
const expenseOnly = (item: Row) => isExpenseOnlyInventory(item as never);
const stockOf = (item: Row) => (Number.isFinite(Number(item.stock)) ? Number(item.stock) : 0);
const costOf = (item: Row) => (Number.isFinite(Number(item.unitCost)) && Number(item.unitCost) > 0 ? Number(item.unitCost) : 0);

/** Har mahsulot bo'yicha harakatlar yig'indisi (milli-birlikda — ombor jurnali bilan bir xil yaxlitlash). */
function ledgerMilli(state: Row): Map<string, number> {
  const sum = new Map<string, number>();
  for (const move of rows(state.stockMovements)) {
    const id = String(move.inventoryId || "");
    if (id) sum.set(id, (sum.get(id) || 0) + toMilli(move.quantity));
  }
  return sum;
}

export interface StockZeroPreview {
  /** Qoldig'i 0 bo'lmagan mahsulotlar soni (shular nolga tushadi). */
  items: number;
  /** Shulardan qoldig'i manfiy bo'lganlari. */
  negative: number;
  /** Jami mahsulot turlari. */
  total: number;
  /** Hozirgi ombor qiymati, won (musbat qoldiq × narx). */
  value: number;
  /** Boshlang'ich sanoqni kutayotgan mahsulotlar. */
  pending: number;
  last: { at: string; date: string; items: number; value: number } | null;
}

export function stockZeroPreview(state: Row): StockZeroPreview {
  const inventory = rows(state.inventory).filter((item) => typeof item.id === "string" && item.id);
  const ledger = ledgerMilli(state);
  const live = inventory.filter((item) => stockOf(item) !== 0 || (ledger.get(String(item.id)) || 0) !== 0);
  const last = rows(state.stockZeroResets)[0];
  return {
    items: live.length,
    negative: live.filter((item) => stockOf(item) < 0).length,
    total: inventory.length,
    value: Math.round(inventory.reduce((sum, item) => sum + (expenseOnly(item) ? 0 : Math.max(0, stockOf(item)) * costOf(item)), 0)),
    pending: inventory.filter((item) => item.openingCountPending === true && item.catalogArchived !== true).length,
    last: last ? { at: String(last.at || ""), date: String(last.date || ""), items: Number(last.items) || 0, value: Number(last.value) || 0 } : null,
  };
}

/** Hamma mahsulot qoldig'ini 0 qiladi. Narx, retsept, savdo, pul va boshqa ma'lumotga tegmaydi. */
export function resetStockToZero(state: Row, body: Row, today: string, now = new Date().toISOString()) {
  const operationId = String(body.operationId || "");
  if (!/^[\w-]{8,100}$/.test(operationId)) throw new StockResetError("Oynani yangilab, qayta urinib ko‘ring.");
  if (String(body.confirm ?? "").trim().toUpperCase() !== STOCK_ZERO_WORD) throw new StockResetError(`Tasdiqlash uchun ${STOCK_ZERO_WORD} deb yozing.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new StockResetError("Sana noto‘g‘ri.");
  const log = rows(state.stockZeroResets);
  const saved = log.find((entry) => entry.id === operationId);
  if (saved) return { state, result: { alreadySaved: true, items: Number(saved.items) || 0, value: Number(saved.value) || 0 } };
  if (isAccountingMonthClosed(state.monthlyCloses, today)) throw new StockResetError("Bu oy yopilgan. Omborni nolga tushirish uchun ochiq oy kerak.", 409);

  const ledger = ledgerMilli(state);
  const before = stockZeroPreview(state);
  const moves: Row[] = [];
  let items = 0;
  const inventory = raw(state.inventory).map((item) => {
    if (!isRow(item) || typeof item.id !== "string" || !item.id) return item;
    const sum = ledger.get(item.id) || 0;
    if (stockOf(item) !== 0 || sum !== 0) items += 1;
    if (sum !== 0) {
      moves.push({
        id: `stock-zero-${operationId}-${item.id}`, inventoryId: item.id, type: "adjustment", quantity: fromMilli(-sum), unitCost: Number(item.unitCost) || 0,
        date: today, recordedAt: now, note: ZERO_NOTE, referenceId: `stock-zero:${operationId}`,
      });
    }
    // Xarajat sifatida yuritiladigan (sanalmaydigan) mahsulot boshlang'ich sanoqni kutmaydi.
    return expenseOnly(item) ? { ...item, stock: 0 } : { ...item, stock: 0, openingCountPending: true };
  });
  const entry = { id: operationId, at: now, date: today, by: "Rahbar", items, value: before.value, movements: moves.length };
  return {
    state: { ...state, inventory, stockMovements: [...moves, ...raw(state.stockMovements)], stockZeroResets: [entry, ...log].slice(0, 50) },
    result: { alreadySaved: false, items, value: before.value },
  };
}

/**
 * Sanoq saqlangach chaqiriladi: nolga tushirilgandan keyin birinchi marta sanalgan mahsulotning sanoq harakati
 * "boshlang'ich qoldiq" deb belgilanadi (ortiqcha/kamomad hisobiga kirmaydi). Agar birinchi sanoq manfiy farq
 * bersa (nolga tushirilgandan keyin kirim bo'lgan-u, kam chiqqan) — bu haqiqiy kamomad, belgilanmaydi.
 */
export function applyOpeningCounts(before: Row, after: Row, operationId: string): { state: Row; opening: string[] } {
  const pending = new Set(rows(before.inventory).filter((item) => item.openingCountPending === true).map((item) => String(item.id)));
  if (!pending.size || before === after) return { state: after, opening: [] };
  const reference = `inventory-count:${operationId}`;
  const counted = new Set<string>();
  const opening: string[] = [];
  const stockMovements = raw(after.stockMovements).map((move) => {
    if (!isRow(move)) return move;
    const id = String(move.inventoryId || "");
    if (move.referenceId !== reference || !pending.has(id)) return move;
    counted.add(id);
    if (Number(move.quantity) < 0) return move;
    opening.push(id);
    return { ...move, openingBalance: true, note: `Boshlang‘ich qoldiq · ${String(move.note || "Sanoq")}`.slice(0, 200) };
  });
  if (!counted.size) return { state: after, opening: [] };
  const inventory = raw(after.inventory).map((item) => {
    if (!isRow(item) || !counted.has(String(item.id)) || item.openingCountPending !== true) return item;
    // Maydon o'chirilmaydi, false qilinadi: yozish quvuri eski va yangi mahsulot maydonlarini birlashtiradi.
    return { ...item, openingCountPending: false };
  });
  return { state: { ...after, inventory, stockMovements }, opening };
}
