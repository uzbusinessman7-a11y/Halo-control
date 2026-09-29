/**
 * HALO V2 — ombor jurnali (gramm/dona harakatlari).
 *
 * Qoidalar (pul jurnali bilan bir xil ruh):
 * - Qoldiq saqlanmaydi — har doim harakatlar yig'indisidan hisoblanadi.
 * - Miqdor milli-birlikda butun son: 200.5 g → 200 500. Kasr xatosi bo'lmaydi.
 * - Harakat o'zgartirilmaydi va o'chirilmaydi (bazada taqiqlangan); xato — teskari harakat.
 * - Savdo harakatida "nazariy" miqdor (retsept bo'yicha) alohida saqlanadi — AvT uchun.
 */
import { assertScope, isIsoDate, LedgerError, type LedgerScope } from "./ledger";
import type { D1Like, D1StatementLike } from "../lib/full-migration";

export type StockMoveKind = "receipt" | "sale" | "waste" | "count" | "adjustment" | "reversal";
const KINDS: readonly StockMoveKind[] = ["receipt", "sale", "waste", "count", "adjustment", "reversal"];
const MILLI = 1000;
const MAX_MILLI = 1e15;

/** 200.5 → 200500. Har bir miqdor BIR MARTA yaxlitlanadi. */
export const toMilli = (quantity: unknown): number => (Number.isFinite(Number(quantity)) ? Math.round(Number(quantity) * MILLI) : 0);
export const fromMilli = (milli: number): number => milli / MILLI;

export interface StockItem { id: string; code: string; name: string; unit: string }

export interface StockMoveInput {
  operationId: string;
  itemId: string;
  date: string;
  kind: StockMoveKind;
  /** Omborga ta'siri, milli-birlikda (+ kirdi, − chiqdi). */
  quantityMilli: number;
  /** Savdoda retsept bo'yicha kutilgan sarf (musbat), milli-birlikda. */
  theoreticalMilli?: number;
  /** 1 birlik (g/dona) narxi, won — qiymat hisoblash uchun. */
  unitCost?: number;
  memo?: string;
  actor: string;
  reversesId?: string;
}

export function validateMove(move: StockMoveInput, items: ReadonlyMap<string, StockItem>): StockMoveInput {
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(String(move.operationId || ""))) throw new LedgerError("Harakat raqami noto'g'ri.");
  if (!items.has(move.itemId)) throw new LedgerError("Mahsulot topilmadi.");
  if (!isIsoDate(move.date)) throw new LedgerError("Sana noto'g'ri.");
  if (!KINDS.includes(move.kind)) throw new LedgerError("Harakat turi noto'g'ri.");
  const quantity = move.quantityMilli;
  const theoretical = move.theoreticalMilli ?? 0;
  if (!Number.isSafeInteger(quantity) || Math.abs(quantity) > MAX_MILLI) throw new LedgerError("Miqdor noto'g'ri.");
  if (!Number.isSafeInteger(theoretical) || theoretical < 0 || theoretical > MAX_MILLI) throw new LedgerError("Nazariy miqdor noto'g'ri.");
  if (quantity === 0 && theoretical === 0 && move.kind !== "reversal") throw new LedgerError("Harakat miqdori 0 bo'lmasin.");
  if (move.unitCost !== undefined && (!Number.isFinite(move.unitCost) || move.unitCost < 0)) throw new LedgerError("Narx noto'g'ri.");
  if (!String(move.actor || "").trim()) throw new LedgerError("Kim kiritgani ko'rsatilishi shart.");
  if (move.kind === "reversal" && !move.reversesId) throw new LedgerError("Teskari harakat qaysi harakatni bekor qilishini ko'rsatishi kerak.");
  return { ...move, theoreticalMilli: theoretical, memo: String(move.memo || "").slice(0, 300), actor: String(move.actor).trim().slice(0, 80) };
}

export const STOCK_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS v2_stock_items (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (tenant_id, branch_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS v2_stock_moves (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    item_id TEXT NOT NULL REFERENCES v2_stock_items (id),
    operation_id TEXT NOT NULL,
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('receipt','sale','waste','count','adjustment','reversal')),
    quantity_milli INTEGER NOT NULL CHECK (quantity_milli = CAST(quantity_milli AS INTEGER)),
    theoretical_milli INTEGER NOT NULL DEFAULT 0 CHECK (theoretical_milli >= 0 AND theoretical_milli = CAST(theoretical_milli AS INTEGER)),
    unit_cost REAL,
    memo TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL,
    reverses_id TEXT,
    created_at TEXT NOT NULL,
    CHECK (quantity_milli <> 0 OR theoretical_milli <> 0 OR kind = 'reversal'),
    UNIQUE (tenant_id, branch_id, operation_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS v2_stock_one_reversal ON v2_stock_moves (reverses_id) WHERE reverses_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS v2_stock_moves_item ON v2_stock_moves (tenant_id, branch_id, item_id, date)`,
  `CREATE TRIGGER IF NOT EXISTS v2_stock_items_fixed BEFORE UPDATE OF id, tenant_id, branch_id, code, unit ON v2_stock_items
    BEGIN SELECT RAISE(ABORT, 'HALO: mahsulot kodi va birligi o''zgartirilmaydi'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_stock_items_no_delete BEFORE DELETE ON v2_stock_items
    BEGIN SELECT RAISE(ABORT, 'HALO: mahsulot o''chirilmaydi'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_stock_moves_no_update BEFORE UPDATE ON v2_stock_moves
    BEGIN SELECT RAISE(ABORT, 'HALO: ombor harakati o''zgartirilmaydi — teskari harakat kiriting'); END`,
  `CREATE TRIGGER IF NOT EXISTS v2_stock_moves_no_delete BEFORE DELETE ON v2_stock_moves
    BEGIN SELECT RAISE(ABORT, 'HALO: ombor harakati o''chirilmaydi — teskari harakat kiriting'); END`,
];

export async function ensureStockSchema(db: D1Like) {
  await db.batch(STOCK_SCHEMA.map((sql) => db.prepare(sql)));
}

export async function listStockItems(db: D1Like, scope: LedgerScope): Promise<Map<string, StockItem>> {
  assertScope(scope);
  const result = await db.prepare("SELECT id, code, name, unit FROM v2_stock_items WHERE tenant_id = ? AND branch_id = ?")
    .bind(scope.tenantId, scope.branchId).all<StockItem>();
  return new Map(result.results.map((row) => [row.id, row]));
}

export function stockItemStatement(db: D1Like, scope: LedgerScope, input: { code: string; name: string; unit: string }, now = new Date()): D1StatementLike {
  assertScope(scope);
  if (!/^[a-z0-9_-]{2,60}$/.test(input.code)) throw new LedgerError("Mahsulot kodi noto'g'ri.");
  const id = `${scope.tenantId}:${scope.branchId}:${input.code}`;
  return db.prepare("INSERT OR IGNORE INTO v2_stock_items (id, tenant_id, branch_id, code, name, unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, scope.tenantId, scope.branchId, input.code, String(input.name || input.code).slice(0, 80), String(input.unit || "birlik").slice(0, 20), now.toISOString());
}

export async function ensureStockItem(db: D1Like, scope: LedgerScope, input: { code: string; name: string; unit: string }, now = new Date()): Promise<StockItem> {
  await stockItemStatement(db, scope, input, now).run();
  return { id: `${scope.tenantId}:${scope.branchId}:${input.code}`, code: input.code, name: input.name, unit: input.unit };
}

export function moveStatement(db: D1Like, scope: LedgerScope, move: StockMoveInput, now: Date): D1StatementLike {
  return db.prepare(
    `INSERT INTO v2_stock_moves (id, tenant_id, branch_id, item_id, operation_id, date, kind, quantity_milli, theoretical_milli, unit_cost, memo, actor, reverses_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), scope.tenantId, scope.branchId, move.itemId, move.operationId, move.date, move.kind,
    move.quantityMilli, move.theoreticalMilli ?? 0, move.unitCost ?? null, move.memo ?? "", move.actor, move.reversesId ?? null, now.toISOString());
}

/** Qoldiqlar (milli-birlik), mahsulot bo'yicha. */
export async function stockBalances(db: D1Like, scope: LedgerScope, through?: string): Promise<Map<string, number>> {
  assertScope(scope);
  const result = await db.prepare(
    `SELECT item_id, SUM(quantity_milli) AS total FROM v2_stock_moves WHERE tenant_id = ? AND branch_id = ? ${through ? "AND date <= ?" : ""} GROUP BY item_id`,
  ).bind(...(through ? [scope.tenantId, scope.branchId, through] : [scope.tenantId, scope.branchId])).all<{ item_id: string; total: number }>();
  return new Map(result.results.map((row) => [row.item_id, Number(row.total)]));
}

export interface AvtRow {
  itemId: string;
  name: string;
  unit: string;
  receipts: number;
  theoretical: number;
  recordedWaste: number;
  countVariance: number;
  varianceValue: number;
  variancePercent: number | null;
}

/**
 * Nazariy va haqiqiy sarf (AvT) — davr uchun, mahsulot bo'yicha.
 *  - nazariy: savdolar retsepti bo'yicha ketishi kerak bo'lgan miqdor;
 *  - qayd etilgan chiqit: chiqit/xodim ovqati sifatida yozilgan;
 *  - sanoq farqi: sanoqda chiqqan tushuntirilmagan farq (manfiy = kamomad);
 *  - qiymat: sanoq farqi × oxirgi ma'lum narx, won.
 * Eng katta yo'qotish birinchi.
 */
export async function avtReport(db: D1Like, scope: LedgerScope, from: string, to: string): Promise<AvtRow[]> {
  assertScope(scope);
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new LedgerError("Davr noto'g'ri.");
  const items = await listStockItems(db, scope);
  const result = await db.prepare(
    `SELECT item_id, kind, quantity_milli, theoretical_milli, unit_cost FROM v2_stock_moves
     WHERE tenant_id = ? AND branch_id = ? AND date >= ? AND date <= ? AND kind <> 'reversal'
       AND id NOT IN (SELECT reverses_id FROM v2_stock_moves WHERE tenant_id = ? AND branch_id = ? AND reverses_id IS NOT NULL)
     ORDER BY date, created_at`,
  ).bind(scope.tenantId, scope.branchId, from, to, scope.tenantId, scope.branchId).all<{ item_id: string; kind: StockMoveKind; quantity_milli: number; theoretical_milli: number; unit_cost: number | null }>();
  const rows = new Map<string, { receipts: number; theoretical: number; waste: number; variance: number; cost: number }>();
  for (const move of result.results) {
    const row = rows.get(move.item_id) || { receipts: 0, theoretical: 0, waste: 0, variance: 0, cost: 0 };
    const quantity = Number(move.quantity_milli);
    if (move.kind === "receipt") row.receipts += quantity;
    if (move.kind === "sale") row.theoretical += Number(move.theoretical_milli) || -quantity;
    if (move.kind === "waste") row.waste += -quantity;
    if (move.kind === "count") row.variance += quantity;
    if (move.unit_cost !== null && Number.isFinite(Number(move.unit_cost)) && Number(move.unit_cost) > 0) row.cost = Number(move.unit_cost);
    rows.set(move.item_id, row);
  }
  return [...rows.entries()]
    .filter(([, row]) => row.receipts || row.theoretical || row.waste || row.variance)
    .map(([itemId, row]) => {
      const item = items.get(itemId);
      return {
        itemId, name: item?.name || itemId, unit: item?.unit || "",
        receipts: fromMilli(row.receipts), theoretical: fromMilli(row.theoretical), recordedWaste: fromMilli(row.waste),
        countVariance: fromMilli(row.variance),
        varianceValue: Math.round(fromMilli(row.variance) * row.cost),
        variancePercent: row.theoretical > 0 ? Math.round((row.variance / row.theoretical) * 1000) / 10 : null,
      };
    })
    .sort((left, right) => left.varianceValue - right.varianceValue);
}
