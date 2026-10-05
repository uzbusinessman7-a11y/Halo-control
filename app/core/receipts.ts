/**
 * HALO V2 — kirimlar tartibi ("bitta yo'l" qoidasi).
 *
 * Mahsulot kelganda rahbar uni faqat «Yangi kirim» orqali kiritadi (ombor + qarz + to'lov bitta saqlashda).
 * Lekin omborga puli yozilmagan kirim ham tushishi mumkin: xodim «Mahsulot kirimi» orqali qabul qilgan yoki
 * oldin eski «Ombor kirimi» orqali kiritilgan. Bunday kirimlar shu yerda topiladi ("to'lovi yozilmagan") va
 * rahbar har birini bir marta yopadi: qarzga yoki to'landi. Mahsulot ikkinchi marta omborga kirmaydi —
 * faqat pul tomoni yoziladi.
 *
 * Bu modul hech narsani o'zi o'zgartirmaydi: ro'yxatlar — faqat o'qish; yozuv eski tizimning tekshirilgan
 * dvigateli (/api/supplier-records) orqali bajariladi.
 */
import type { D1Like } from "../lib/full-migration";
import { isAccountingMonthClosed } from "../lib/month-end";
import { warehouseDocuments } from "../lib/warehouse-records";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((entry): entry is Row => Boolean(entry) && typeof entry === "object") : []);
const text = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export class ReceiptError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "") { super(message); }
}

/** Yetkazib beruvchisiz (bozor, do'kon — naqd) xarid uchun doimiy hisob: har doim darhol to'lanadi, qarzi 0. */
export const MARKET_SUPPLIER_ID = "v2-bozor";
export const MARKET_SUPPLIER_NAME = "Bozor / naqd xarid";

export function ensureMarketSupplier(state: Row): { state: Row; created: boolean } {
  const suppliers = rows(state.suppliers);
  if (suppliers.some((supplier) => supplier.id === MARKET_SUPPLIER_ID)) return { state, created: false };
  const market = { id: MARKET_SUPPLIER_ID, name: MARKET_SUPPLIER_NAME, phone: "", bankAccount: "", telegramChatId: "", autoOrder: false, balance: 0 };
  return { state: { ...state, suppliers: [...suppliers, market] }, created: true };
}

/* ---------- Shu oy kirimlari (tarix; xato bo'lsa olib tashlash uchun) ---------- */

const SOURCE_LABEL: Record<string, string> = {
  "Xarid / kirim": "Yangi kirim", "Xodim kirimi": "Xodim qabul qilgan", "Oddiy ombor kirimi": "Ombor kirimi",
};

/**
 * `money` — to'lovsiz kiritilgan kirimning pul tomoni holati: "pending" (hali yozilmagan), "settled" (shu sahifadan
 * yozilgan), "" — tegishli emas («Yangi kirim», MEZANA, "yozuv kerak emas" deb belgilangan…).
 */
export function monthReceipts(state: Row, month: string, dismissed: ReadonlySet<string> = new Set()) {
  const suppliers = new Map(rows(state.suppliers).map((supplier) => [String(supplier.id), String(supplier.name || "")]));
  const transactionIds = new Set(rows(state.transactions).map((tx) => String(tx.id)));
  const vegMovements = new Set(rows(state.vegetablePurchases).filter((purchase) => !purchase.cancelledAt).map((purchase) => String(purchase.movementId)));
  return warehouseDocuments(state).filter((doc) => String(doc.date).startsWith(month)).slice(0, 150).map((doc) => {
    const amount = Math.round(Number(doc.amount) || 0);
    const first = (doc.movements[0] || {}) as Row;
    const separate = first.supplierAccounting === "separate" && !first.intakeId && !first.mezanaEntryId;
    const key = String(first.warehouseOperationId || first.id || doc.id);
    const settled = separate && transactionIds.has(receiptTransactionId(key));
    return {
      id: doc.id, date: doc.date, source: SOURCE_LABEL[doc.source] || doc.source, amount, paid: Math.round(Number(doc.paid) || 0),
      supplier: suppliers.get(String(doc.supplierId || "")) || "",
      money: settled ? "settled" : separate && amount > 0 && !dismissed.has(key) ? "pending" : "",
      veg: doc.movements.some((movement) => vegMovements.has(String(movement.id))),
      lines: doc.lines.map((line) => `${String(line.name || "")} ${Number(line.quantity) || 0} ${String(line.unit || "")}`.trim()).join(", ").slice(0, 200),
    };
  });
}

/* ---------- To'lovi yozilmagan kirimlar ---------- */

export interface PendingReceipt {
  key: string; date: string; amount: number; lines: string; count: number;
  /** Kim kiritgan (xodim ismi yoki "Rahbar"). */
  by: string; supplierId: string; supplierName: string; veg: boolean;
}

/** Necha kun orqaga qaraladi: undan eski kirimlar ro'yxatga chiqmaydi (oy yakunida allaqachon solishtirilgan). */
export const PENDING_DAYS = 60;
const DAY_MS = 86_400_000;

/** Shu kirimning qarz yozuvi raqami — bitta kirimga faqat bitta yozuv (qayta bosilsa ikkinchisi yaratilmaydi). */
export const receiptTransactionId = (key: string) => `v2-receipt:${key.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 80)}`;

export function pendingReceipts(state: Row, today: string, dismissed: ReadonlySet<string> = new Set()): PendingReceipt[] {
  const inventory = new Map(rows(state.inventory).map((item) => [String(item.id), item]));
  const suppliers = new Map(rows(state.suppliers).map((supplier) => [String(supplier.id), String(supplier.name || "")]));
  const deliveries = new Map(rows(state.supplierDeliveries).map((delivery) => [String(delivery.id), delivery]));
  const transactionIds = new Set(rows(state.transactions).map((tx) => String(tx.id)));
  const vegMovements = new Set(rows(state.vegetablePurchases).filter((purchase) => !purchase.cancelledAt).map((purchase) => String(purchase.movementId)));
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - PENDING_DAYS * DAY_MS).toISOString().slice(0, 10);

  const groups = new Map<string, Row[]>();
  for (const move of rows(state.stockMovements)) {
    // Faqat "pul tomoni alohida" deb yozilgan ombor kirimlari. «Yangi kirim», MEZANA va buyurtma kirimlari — o'z hisobida.
    if (move.type !== "receipt" || move.supplierAccounting !== "separate") continue;
    if (move.intakeId || move.mezanaEntryId || String(move.referenceId || "").startsWith("mezana")) continue;
    const date = String(move.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < since || date > today) continue;
    const key = String(move.warehouseOperationId || move.id || "");
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), move]);
  }

  const out: PendingReceipt[] = [];
  for (const [key, moves] of groups) {
    if (dismissed.has(key) || transactionIds.has(receiptTransactionId(key))) continue;
    const first = moves[0];
    const date = String(first.date);
    if (isAccountingMonthClosed(state.monthlyCloses as never, date)) continue;
    const delivery = deliveries.get(String(first.referenceId || ""));
    // Eski tartibda tasdiqlangan xodim kirimi: qarzi o'sha paytda yozilgan.
    if (delivery && (transactionIds.has(`delivery-purchase:${String(delivery.id)}`) || delivery.paymentTransactionId)) continue;
    const amount = moves.reduce((sum, move) => sum + Math.round(Number(move.purchaseAmount ?? (Number(move.quantity) || 0) * (Number(move.unitCost) || 0)) || 0), 0);
    if (!(amount > 0)) continue;
    const supplierId = String(delivery?.supplierId || first.supplierId || "");
    out.push({
      key, date, amount, count: moves.length,
      lines: moves.map((move) => {
        const item = inventory.get(String(move.inventoryId));
        return `${String(item?.name || move.inventoryId || "")} ${Number(move.purchaseQuantity ?? move.quantity) || 0} ${String(move.purchaseUnit || item?.unit || "")}`.trim();
      }).join(", ").slice(0, 160),
      by: text(delivery?.createdByName || first.recordedBy, 60),
      supplierId: suppliers.has(supplierId) ? supplierId : "", supplierName: suppliers.get(supplierId) || "",
      veg: moves.some((move) => vegMovements.has(String(move.id)) || move.expenseOnlyAtMovement === true),
    });
  }
  return out.sort((left, right) => right.date.localeCompare(left.date) || left.key.localeCompare(right.key));
}

/**
 * Kirimning pul tomoni uchun yozuv (summa va sana kirimning o'zidan olinadi — brauzerdan emas).
 * Kirim ro'yxatda bo'lmasa (allaqachon yozilgan yoki olib tashlangan) — xato.
 */
export function receiptSettlement(state: Row, key: string, supplierId: string, today: string, dismissed: ReadonlySet<string> = new Set()) {
  const receipt = pendingReceipts(state, today, dismissed).find((entry) => entry.key === key);
  if (!receipt) throw new ReceiptError("Bu kirim ro‘yxatda yo‘q — puli allaqachon yozilgan yoki kirim olib tashlangan. Sahifani yangilang.", 409);
  const supplier = rows(state.suppliers).find((entry) => entry.id === supplierId);
  if (!supplier) throw new ReceiptError("Kimdan olinganini tanlang.");
  if (/mezana/i.test(String(supplier.name || ""))) throw new ReceiptError("MEZANA mahsuloti alohida MEZANA bo‘limida yuritiladi.");
  return {
    receipt, supplierName: String(supplier.name || ""),
    transaction: { id: receiptTransactionId(key), supplierId, type: "purchase" as const, amount: receipt.amount, date: receipt.date, note: `Kirim: ${receipt.lines}`.slice(0, 200) },
  };
}

/* ---------- "Yozuv kerak emas" belgilari (puli oldin yozilgan, sovg'a, boshlang'ich qoldiq…) ---------- */

const ready = new WeakSet<object>();
async function ensureReceiptSchema(db: D1Like) {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS v2_receipt_marks (
    branch_id TEXT NOT NULL, receipt_key TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
    PRIMARY KEY (branch_id, receipt_key))`).run();
  ready.add(db);
}

export async function listDismissedReceipts(db: D1Like, branchId: string): Promise<Set<string>> {
  await ensureReceiptSchema(db);
  const result = await db.prepare("SELECT receipt_key FROM v2_receipt_marks WHERE branch_id = ? AND status = 'skip'").bind(branchId).all<{ receipt_key: string }>();
  return new Set((result.results || []).map((row) => String(row.receipt_key)));
}

/** Faqat hozir ro'yxatda turgan kirimlar belgilanadi (begona kalit yozilmaydi). Nechtasi belgilangani qaytadi. */
export async function dismissReceipts(db: D1Like, branchId: string, keys: string[], pending: PendingReceipt[], note: string, now = new Date().toISOString()): Promise<number> {
  await ensureReceiptSchema(db);
  const allowed = new Set(pending.map((entry) => entry.key));
  const wanted = [...new Set(keys.map((key) => String(key)))].filter((key) => allowed.has(key)).slice(0, 500);
  if (!wanted.length) throw new ReceiptError("Kirim ro‘yxatda yo‘q. Sahifani yangilang.", 409);
  const statements = wanted.map((key) => db.prepare(
    `INSERT INTO v2_receipt_marks (branch_id, receipt_key, status, note, at) VALUES (?, ?, 'skip', ?, ?)
     ON CONFLICT(branch_id, receipt_key) DO UPDATE SET status = 'skip', note = excluded.note, at = excluded.at`,
  ).bind(branchId, key, text(note, 200), now));
  for (let index = 0; index < statements.length; index += 40) await db.batch(statements.slice(index, index + 40));
  return wanted.length;
}
