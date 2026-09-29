/**
 * HALO V2 — ombor ko'prigi: eski stockMovements → yangi ombor jurnali.
 *
 * Har bir mahsulot uchun eski tizimdagi SAQLANGAN qoldiq (inventory[].stock) bilan
 * jurnal qoldig'i (harakatlar yig'indisi) solishtiriladi. Farq bo'lsa — qoldiq
 * harakat yozilmasdan (hujjatsiz) o'zgartirilgan: aynan "1 gramm" teshigi.
 * Takror ishga tushirish xavfsiz; eski tizimda o'chirilgan harakat — teskari harakat.
 */
import { isExpenseOnlyInventory } from "../lib/vegetable-expenses";
import { assertScope, isIsoDate, LedgerError, type LedgerScope } from "./ledger";
import { bridgeOperationId } from "./bridge";
import {
  ensureStockItem, ensureStockSchema, fromMilli, listStockItems, moveStatement, stockBalances, toMilli, validateMove,
  type StockMoveInput, type StockMoveKind,
} from "./stock";
import type { D1Like, D1StatementLike } from "../lib/full-migration";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value)
  ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];

export function stockItemCode(oldId: string): string {
  const clean = oldId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mahsulot";
  let hash = 0;
  for (const char of oldId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `m-${clean}-${hash.toString(36).slice(0, 5)}`;
}

export function moveKindOf(movement: Row): StockMoveKind {
  if (movement.type === "receipt") return "receipt";
  if (movement.type === "sale") return "sale";
  if (movement.type === "waste") return "waste";
  if (String(movement.referenceId || "").startsWith("inventory-count:")) return "count";
  return "adjustment";
}

export interface StockComparison { name: string; unit: string; oldStock: number; ledgerStock: number; difference: number; expenseOnly: boolean }
export interface StockBridgeReport {
  posted: number; alreadyPosted: number; reversed: number;
  changed: string[]; invalid: string[]; unknownItem: string[];
  items: StockComparison[];
  /** Hujjatsiz qoldiq farqi bor oddiy (xarajat emas) mahsulotlar soni. */
  mismatched: number;
}

export async function runStockBridge(db: D1Like, scope: LedgerScope, state: Row, today: string, now = new Date()): Promise<StockBridgeReport> {
  assertScope(scope);
  if (!isIsoDate(today)) throw new LedgerError("Sana noto'g'ri.");
  await ensureStockSchema(db);
  const inventory = rows(state.inventory).filter((item) => typeof item.id === "string" && item.id);
  for (const item of inventory) {
    await ensureStockItem(db, scope, { code: stockItemCode(String(item.id)), name: String(item.name || item.id), unit: String(item.unit || "birlik") }, now);
  }
  const items = await listStockItems(db, scope);
  const idByOld = new Map(inventory.map((item) => [String(item.id), `${scope.tenantId}:${scope.branchId}:${stockItemCode(String(item.id))}`]));
  const costByOld = new Map(inventory.map((item) => [String(item.id), Number(item.unitCost)]));

  const existing = new Map((await db.prepare(
    "SELECT id, operation_id, item_id, date, quantity_milli, theoretical_milli FROM v2_stock_moves WHERE tenant_id = ? AND branch_id = ? AND operation_id LIKE 'bridge:%'",
  ).bind(scope.tenantId, scope.branchId).all<{ id: string; operation_id: string; item_id: string; date: string; quantity_milli: number; theoretical_milli: number }>())
    .results.map((row) => [row.operation_id, row]));
  const reversedIds = new Set((await db.prepare(
    "SELECT reverses_id FROM v2_stock_moves WHERE tenant_id = ? AND branch_id = ? AND reverses_id IS NOT NULL",
  ).bind(scope.tenantId, scope.branchId).all<{ reverses_id: string }>()).results.map((row) => row.reverses_id));

  const toPost: StockMoveInput[] = [];
  const changed: string[] = [];
  const invalid: string[] = [];
  const unknownItem: string[] = [];
  const wanted = new Set<string>();
  let alreadyPosted = 0;
  for (const movement of rows(state.stockMovements)) {
    const itemId = idByOld.get(String(movement.inventoryId));
    const source = `harakat:${String(movement.id || "?")}`;
    if (!itemId) { unknownItem.push(source); continue; }
    const kind = moveKindOf(movement);
    const quantityMilli = toMilli(movement.quantity);
    const theoreticalMilli = kind === "sale" ? Math.max(0, toMilli(movement.theoreticalQuantity ?? -Number(movement.quantity || 0))) : 0;
    if (!quantityMilli && !theoreticalMilli) continue;
    const operationId = bridgeOperationId("m", String(movement.id));
    wanted.add(operationId);
    const previous = existing.get(operationId);
    if (previous) {
      if (previous.item_id !== itemId || Number(previous.quantity_milli) !== quantityMilli || Number(previous.theoretical_milli) !== theoreticalMilli || previous.date !== String(movement.date)) changed.push(source);
      else alreadyPosted += 1;
      continue;
    }
    const unitCost = Number(movement.unitCost);
    try {
      toPost.push(validateMove({
        operationId, itemId, date: String(movement.date || ""), kind, quantityMilli, theoreticalMilli,
        unitCost: Number.isFinite(unitCost) && unitCost > 0 ? unitCost : (Number.isFinite(costByOld.get(String(movement.inventoryId))) ? costByOld.get(String(movement.inventoryId)) : undefined),
        memo: String(movement.note || "").slice(0, 200), actor: "Ko'prik",
      }, items));
    } catch (error) {
      invalid.push(`${source}: ${error instanceof LedgerError ? error.message : "noto'g'ri harakat"}`);
    }
  }
  for (const [operationId, row] of existing) {
    if (wanted.has(operationId) || reversedIds.has(row.id) || operationId.startsWith("bridge:mrev:")) continue;
    toPost.push({
      operationId: `bridge:mrev:${row.id}`.slice(0, 120), itemId: row.item_id, date: today, kind: "reversal",
      quantityMilli: -Number(row.quantity_milli), theoreticalMilli: 0, actor: "Ko'prik", reversesId: row.id,
      memo: "Bekor qilindi: eski tizimda bu harakat o'chirilgan",
    });
  }
  // Teskari harakat miqdorni qaytaradi; bekor qilingan harakat AvT hisobotidan butunlay chiqariladi.

  let chunk: D1StatementLike[] = [];
  for (const move of toPost) {
    chunk.push(moveStatement(db, scope, move, now));
    if (chunk.length >= 90) { await db.batch(chunk); chunk = []; }
  }
  if (chunk.length) await db.batch(chunk);

  const balances = await stockBalances(db, scope);
  const comparison = inventory.map((item) => {
    const ledgerMilli = balances.get(idByOld.get(String(item.id))!) || 0;
    const oldMilli = toMilli(item.stock);
    return {
      name: String(item.name || item.id), unit: String(item.unit || ""), oldStock: fromMilli(oldMilli), ledgerStock: fromMilli(ledgerMilli),
      difference: fromMilli(ledgerMilli - oldMilli), expenseOnly: isExpenseOnlyInventory(item),
    };
  }).sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));
  const reversed = toPost.filter((move) => move.kind === "reversal").length;
  return {
    posted: toPost.length - reversed, alreadyPosted, reversed, changed, invalid, unknownItem,
    items: comparison, mismatched: comparison.filter((row) => !row.expenseOnly && row.difference !== 0).length,
  };
}
