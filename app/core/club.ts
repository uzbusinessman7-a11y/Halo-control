/**
 * HALO V2 — HALO CLUB (Telegram orqali sotuv sayti) bilan ulanish.
 *
 * Qoidalar:
 *  - Do'kon HALO Control'ga faqat ikki manzil orqali murojaat qiladi (sinxron va buyurtma hodisasi). Kaliti alohida:
 *    bazada faqat xeshi turadi va u boshqa hech narsaga ruxsat bermaydi.
 *  - Mijozning ismi, telefoni va manzili HALO Control'ga kelmaydi — faqat buyurtma tarkibi va summalar.
 *  - Savdo faqat buyurtma TOPSHIRILGANDA yoziladi va bir buyurtma bir marta (qayta yuborilsa — "oldin saqlangan").
 *  - To'lov: naqd → naqd kassa, bank o'tkazmasi → hisob-raqam (ikkalasi HALO hisob — qo'lda kiritilgandagidek soliqsiz).
 *    Karta yozilmaydi: u OKPOS apparatidan o'tadi va POS hisobotidan keladi (aks holda ikki marta sanaladi).
 *  - Tushum = mijoz haqiqatda to'lagan pul: aksiya chegirmasi va ishlatilgan cashback savdodan ayriladi va
 *    qatorlarga 1 wongacha aniq taqsimlanadi.
 *  - Yetkazish haqi daromad emas: "Kuryer puli" bo'lib alohida kirim yoziladi (foydaga ta'sir qilmaydi).
 *  - Ombor har taom retsepti bo'yicha kamayadi — HALO hisob oynasidagi savdo bilan bir xil yo'l (applyPosOrder).
 *  - Bog'lanmagan mahsulot, yopilgan kun yoki o'chirilgan yozish — buyurtma "kutmoqda" bo'lib turadi, yo'qolmaydi.
 */
import type { D1Like } from "../lib/full-migration";
import { applyPosOrder, cancelPosOrder, PosTerminalError } from "../lib/pos-terminal";
import { isExpenseOnlyInventory } from "../lib/vegetable-expenses";
import { seoulBusinessDate } from "../lib/business-time";
import { COURIER_CATEGORY } from "./courier";

type Row = Record<string, unknown>;
export class ClubError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export const CLUB_ACTOR = { id: "halo-club", name: "Telegram do‘kon" } as const;
export { COURIER_CATEGORY };
export const CLUB_STATUSES = ["new", "accepted", "preparing", "ready", "completed", "cancelled"] as const;
export type ClubStatus = typeof CLUB_STATUSES[number];
const RANK: Record<ClubStatus, number> = { new: 0, accepted: 1, preparing: 2, ready: 3, completed: 4, cancelled: 4 };
const FULFILLMENTS = ["PICKUP", "DELIVERY", "DINE_IN"] as const;
const PAYMENTS = ["CASH", "CARD", "BANK_TRANSFER", "CASHBACK"] as const;

const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
const text = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max);
/** Do'kondagi mahsulot belgisi: do'kon rahbari o'zi yozadi (masalan "lavash-katta"), shuning uchun faqat uzunligi va boshqaruv belgilari tekshiriladi. */
const externalId = (value: unknown) => {
  const id = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return id && id.length <= 120 && !/[\u0000-\u001f\u007f]/.test(id) ? id : "";
};
const won = (value: unknown, label: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 100_000_000) throw new ClubError(`${label}: summa noto‘g‘ri.`, 422);
  return n;
};
const iso = (value: unknown) => {
  const s = String(value || "");
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : "";
};

export interface ClubOrderItem {
  productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number;
  addons: Array<{ id: string; name: string; price: number }>;
}
export interface ClubOrder {
  id: string; number: string; status: ClubStatus; fulfillment: typeof FULFILLMENTS[number]; paymentMethod: typeof PAYMENTS[number]; paymentStatus: string;
  subtotal: number; promotionDiscount: number; cashbackUsed: number; deliveryFee: number; total: number;
  promotionName: string; arrivalMinutes: number; createdAt: string; completedAt: string; items: ClubOrderItem[];
}

/** Do'kondan kelgan buyurtmani tekshiradi: hisob-kitob 1 wongacha to'g'ri bo'lmasa qabul qilinmaydi. */
export function normalizeClubOrder(input: unknown): ClubOrder {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Row : {};
  const id = String(source.id || "").trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new ClubError("Buyurtma raqami (id) noto‘g‘ri.", 422);
  const status = String(source.status || "").toLowerCase() as ClubStatus;
  if (!CLUB_STATUSES.includes(status)) throw new ClubError("Buyurtma holati noto‘g‘ri.", 422);
  const fulfillment = String(source.fulfillment || "") as ClubOrder["fulfillment"];
  if (!FULFILLMENTS.includes(fulfillment)) throw new ClubError("Buyurtma turi noto‘g‘ri.", 422);
  const paymentMethod = String(source.paymentMethod || "") as ClubOrder["paymentMethod"];
  if (!PAYMENTS.includes(paymentMethod)) throw new ClubError("To‘lov turi noto‘g‘ri.", 422);
  const list = Array.isArray(source.items) ? source.items as unknown[] : [];
  if (!list.length || list.length > 60) throw new ClubError("Buyurtmada 1 dan 60 gacha qator bo‘lsin.", 422);
  const items = list.map((raw, index) => {
    const line = raw && typeof raw === "object" ? raw as Row : {};
    const label = `${index + 1}-qator`;
    const productId = externalId(line.productId);
    if (!productId) throw new ClubError(`${label}: mahsulot belgisi noto‘g‘ri.`, 422);
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new ClubError(`${label}: soni noto‘g‘ri.`, 422);
    const unitPrice = won(line.unitPrice, label);
    const lineTotal = won(line.lineTotal, label);
    if (lineTotal !== unitPrice * quantity) throw new ClubError(`${label}: narx × son jami bilan mos emas.`, 422);
    const addonList = Array.isArray(line.addons) ? line.addons as unknown[] : [];
    if (addonList.length > 20) throw new ClubError(`${label}: qo‘shimchalar juda ko‘p.`, 422);
    const addons = addonList.map((rawAddon) => {
      const addon = rawAddon && typeof rawAddon === "object" ? rawAddon as Row : {};
      const addonId = externalId(addon.id);
      if (!addonId) throw new ClubError(`${label}: qo‘shimcha belgisi noto‘g‘ri.`, 422);
      return { id: addonId, name: text(addon.name, 120) || "Qo‘shimcha", price: won(addon.price, label) };
    });
    if (addons.reduce((sum, addon) => sum + addon.price, 0) > unitPrice) throw new ClubError(`${label}: qo‘shimchalar narxi taom narxidan katta.`, 422);
    return { productId, name: text(line.name, 120) || "Taom", quantity, unitPrice, lineTotal, addons };
  });
  const subtotal = won(source.subtotal, "Jami");
  const promotionDiscount = won(source.promotionDiscount, "Aksiya chegirmasi");
  const cashbackUsed = won(source.cashbackUsed, "Cashback");
  const deliveryFee = won(source.deliveryFee, "Yetkazish haqi");
  const total = won(source.total, "To‘lanadigan summa");
  if (items.reduce((sum, item) => sum + item.lineTotal, 0) !== subtotal) throw new ClubError("Qatorlar yig‘indisi buyurtma summasiga teng emas.", 422);
  if (promotionDiscount > subtotal) throw new ClubError("Aksiya chegirmasi buyurtma summasidan katta.", 422);
  if (cashbackUsed > subtotal - promotionDiscount + deliveryFee) throw new ClubError("Cashback to‘lanadigan summadan katta.", 422);
  if (total !== subtotal - promotionDiscount + deliveryFee - cashbackUsed) throw new ClubError("To‘lanadigan summa hisobi mos emas (jami − chegirma + yetkazish − cashback).", 422);
  if (fulfillment !== "DELIVERY" && deliveryFee) throw new ClubError("Yetkazish haqi faqat yetkazib berishda bo‘ladi.", 422);
  return {
    id, number: text(source.number, 24).toUpperCase() || id.replace(/-/g, "").slice(0, 6).toUpperCase(), status, fulfillment, paymentMethod,
    paymentStatus: text(source.paymentStatus, 24).toUpperCase(), subtotal, promotionDiscount, cashbackUsed, deliveryFee, total,
    promotionName: text(source.promotionName, 80), arrivalMinutes: Math.min(600, Math.max(0, Math.round(Number(source.arrivalMinutes) || 0))),
    createdAt: iso(source.createdAt), completedAt: iso(source.completedAt), items,
  };
}

/** Summani og'irliklarga mutanosib va 1 wongacha ANIQ taqsimlash (yig'indi doim "total" ga teng). */
export function allocateExact(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (weight * total) / sum);
  const floors = exact.map((value) => Math.floor(value));
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const entry of order) { if (rest <= 0) break; floors[entry.index] += 1; rest -= 1; }
  return floors;
}

export const clubOperationId = (orderId: string) => `club-${orderId}`;
export const clubPosOrderId = (orderId: string) => `pos-order:${clubOperationId(orderId)}`;
export const clubCourierEntryId = (orderId: string) => `club-courier:${orderId}`;
export const linkKey = (kind: "product" | "addon", id: string) => `${kind}:${id}`;

export interface ClubSalePlan {
  /** Yozilmaydi (masalan karta) — sababi. */
  skip: string;
  /** Hozircha yozib bo'lmaydi (bog'lanmagan mahsulot) — sababi. */
  wait: string;
  paymentType: "cash" | "bank";
  items: Array<{ recipeId: string; quantity: number }>;
  grossByRecipe: Map<string, number>;
  /** Savdo tushumi: mijoz ovqat uchun haqiqatda to'lagan pul. */
  foodRevenue: number;
  /** Mijoz to'lagan yetkazish haqi (kuryer puli). */
  courier: number;
  /** Cashback yetkazish haqining shu qismini qoplagan (mijoz to'lamagan, kuryerga esa to'liq beriladi). */
  courierShortfall: number;
}

/** Buyurtma qanday yozilishi (sof hisob): qaysi hisob, qaysi taomlar, tushum va kuryer puli. */
export function clubSalePlan(order: ClubOrder, links: Map<string, string>): ClubSalePlan {
  const plan: ClubSalePlan = { skip: "", wait: "", paymentType: "cash", items: [], grossByRecipe: new Map(), foodRevenue: 0, courier: 0, courierShortfall: 0 };
  if (order.paymentMethod === "CARD") { plan.skip = "Karta to‘lovi — OKPOS hisobotidan keladi, bu yerdan yozilmaydi."; return plan; }
  plan.paymentType = order.paymentMethod === "BANK_TRANSFER" ? "bank" : "cash";
  const quantities = new Map<string, number>();
  for (const item of order.items) {
    const recipeId = links.get(linkKey("product", item.productId)) || "";
    if (!recipeId) { plan.wait = `“${item.name}” HALO Control taomiga bog‘lanmagan.`; return plan; }
    let base = item.unitPrice;
    for (const addon of item.addons) {
      const addonRecipe = links.get(linkKey("addon", addon.id)) || "";
      if (!addonRecipe) continue; // bog'lanmagan qo'shimcha narxi taomning o'zida qoladi (ombor kamaymaydi)
      base -= addon.price;
      quantities.set(addonRecipe, (quantities.get(addonRecipe) || 0) + item.quantity);
      plan.grossByRecipe.set(addonRecipe, (plan.grossByRecipe.get(addonRecipe) || 0) + addon.price * item.quantity);
    }
    quantities.set(recipeId, (quantities.get(recipeId) || 0) + item.quantity);
    plan.grossByRecipe.set(recipeId, (plan.grossByRecipe.get(recipeId) || 0) + base * item.quantity);
  }
  plan.items = [...quantities].map(([recipeId, quantity]) => ({ recipeId, quantity }));
  plan.foodRevenue = Math.max(0, order.subtotal - order.promotionDiscount - order.cashbackUsed);
  plan.courier = order.total - plan.foodRevenue;
  plan.courierShortfall = order.deliveryFee - plan.courier;
  return plan;
}

export interface ClubApplyResult { saved: boolean; alreadySaved: boolean; skip: string; wait: string; date: string; revenue: number; courier: number; courierShortfall: number }

/**
 * Topshirilgan buyurtmani filial holatiga yozadi: savdo qatorlari, ombor harakatlari, "Bugungi savdolar"dagi yozuv
 * va (bo'lsa) kuryer puli kirimi. Yozib bo'lmasa holat o'zgarmaydi va sababi qaytadi.
 */
export function applyClubOrder(state: Row, order: ClubOrder, links: Map<string, string>, createdAt: string, dateOverride = ""): { state: Row; result: ClubApplyResult } {
  const plan = clubSalePlan(order, links);
  const base: ClubApplyResult = { saved: false, alreadySaved: false, skip: plan.skip, wait: plan.wait, date: "", revenue: plan.foodRevenue, courier: plan.courier, courierShortfall: plan.courierShortfall };
  if (plan.skip || plan.wait) return { state, result: base };
  const date = dateOverride || seoulBusinessDate(new Date(order.completedAt || createdAt));
  base.date = date;
  const orderId = clubPosOrderId(order.id);
  if (rows(state.posOrders).some((entry) => entry.id === orderId)) return { state, result: { ...base, saved: true, alreadySaved: true } };
  const label = `Telegram #${order.number}`;
  const applied = applyPosOrder(state, {
    operationId: clubOperationId(order.id), date, mode: "sale", paymentType: plan.paymentType, salesChannel: "halo", items: plan.items,
    note: [label, order.fulfillment === "DELIVERY" ? "yetkazib berish" : order.fulfillment === "DINE_IN" ? "zalda" : "olib ketish",
      order.paymentMethod === "CASHBACK" ? "to‘liq cashback bilan" : ""].filter(Boolean).join(" · "),
  }, CLUB_ACTOR, createdAt, { ownerEntry: true });
  const posOrder = applied.result.order as Row;
  const lines = rows(posOrder.items);
  const gross = lines.map((line) => plan.grossByRecipe.get(String(line.recipeId)) || 0);
  const revenue = allocateExact(gross, plan.foodRevenue);
  const bySale = new Map(lines.map((line, index) => [String(line.saleId), { gross: gross[index], revenue: revenue[index], quantity: Number(line.quantity) || 1 }]));
  const next = applied.state;
  const sales = rows(next.sales).map((sale) => {
    const part = bySale.get(String(sale.id));
    if (!part) return sale;
    return {
      ...sale, unitPrice: part.revenue / part.quantity, totalRevenue: part.revenue, listRevenue: part.gross, discountAmount: part.gross - part.revenue,
      clubOrderId: order.id, clubOrderNumber: order.number,
    };
  });
  const posOrders = rows(next.posOrders).map((entry) => entry.id !== orderId ? entry : {
    ...entry, total: plan.foodRevenue,
    items: lines.map((line, index) => ({ ...line, unitPrice: revenue[index] / (Number(line.quantity) || 1), total: revenue[index] })),
    clubOrderId: order.id, clubOrderNumber: order.number, clubFulfillment: order.fulfillment, clubPaymentMethod: order.paymentMethod,
    clubListTotal: order.subtotal, clubDiscount: order.subtotal - plan.foodRevenue, clubCourier: plan.courier,
  });
  const financialEntries = rows(next.financialEntries);
  if (plan.courier > 0) {
    financialEntries.unshift({
      id: clubCourierEntryId(order.id), type: "income", category: COURIER_CATEGORY, amount: plan.courier, date, accountId: posOrder.accountId,
      note: `${label} · mijoz to‘lagan yetkazish haqi — kuryerga beriladi`, affectsProfit: false, clubOrderId: order.id,
      createdByName: CLUB_ACTOR.name, createdAt,
    });
  }
  return { state: { ...next, sales, posOrders, financialEntries }, result: { ...base, saved: true } };
}

/** Rahbar Telegram savdosini bekor qiladi: savdo va ombor qaytadi, kuryer puli kirimi ham olib tashlanadi. */
export function cancelClubSale(state: Row, clubOrderId: string): Row {
  const cancelled = cancelPosOrder(state, clubPosOrderId(clubOrderId)).state as Row;
  const entryId = clubCourierEntryId(clubOrderId);
  return { ...cancelled, financialEntries: rows(cancelled.financialEntries).filter((entry) => entry.id !== entryId) };
}

/* ---------- Menyu: narx va mavjudlik ---------- */

export interface RecipeInfo { id: string; name: string; price: number; categoryId: string; portions: number | null; lacking: string }

/** Har taom: sotuv narxi va ombordagi mahsulot necha portsiyaga yetishi (null — omborga bog'lanmagan, hisoblab bo'lmaydi). */
export function recipeInfos(state: Row): RecipeInfo[] {
  const inventory = new Map(rows(state.inventory).map((item) => [String(item.id || ""), item]));
  return rows(state.recipes).flatMap((recipe) => {
    const id = text(recipe.id, 100);
    const name = text(recipe.name, 120);
    if (!id || !name) return [];
    let portions: number | null = null;
    let lacking = "";
    for (const ingredient of rows(recipe.ingredients)) {
      const item = inventory.get(text(ingredient.inventoryId, 100));
      const perItem = Number(ingredient.quantity);
      if (!item || !Number.isFinite(perItem) || perItem <= 0 || isExpenseOnlyInventory(item as never)) continue;
      const possible = Math.max(0, Math.floor((Number(item.stock || 0) + 1e-6) / perItem));
      if (portions === null || possible < portions) { portions = possible; lacking = text(item.name, 120); }
    }
    return [{ id, name, price: Math.max(0, Math.round(Number(recipe.salePrice) || 0)), categoryId: text(recipe.categoryId, 100), portions, lacking: portions !== null && portions < 1 ? lacking : "" }];
  });
}

const normalName = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʻʼ'`]/g, "").replace(/[^a-z0-9Ѐ-ӿ가-힣]+/g, " ").trim();
/** Nomi aynan mos taomni taklif qiladi (faqat taklif — rahbar tasdiqlamaguncha bog'lanmaydi). */
export function suggestRecipe(name: string, recipes: RecipeInfo[]): string {
  const key = normalName(name);
  if (!key) return "";
  const matches = recipes.filter((recipe) => normalName(recipe.name) === key);
  return matches.length === 1 ? matches[0].id : "";
}

/* ---------- Saqlash ---------- */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS v2_club_settings (
    branch_id TEXT PRIMARY KEY NOT NULL,
    key_hash TEXT NOT NULL DEFAULT '', key_prefix TEXT NOT NULL DEFAULT '', key_created_at TEXT NOT NULL DEFAULT '',
    sales_enabled INTEGER NOT NULL DEFAULT 0, price_sync INTEGER NOT NULL DEFAULT 0, stock_sync INTEGER NOT NULL DEFAULT 0,
    notify_enabled INTEGER NOT NULL DEFAULT 1,
    group_chat_id TEXT NOT NULL DEFAULT '', group_chat_name TEXT NOT NULL DEFAULT '', group_thread_id INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT NOT NULL DEFAULT '', last_order_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS v2_club_products (
    branch_id TEXT NOT NULL, kind TEXT NOT NULL, external_id TEXT NOT NULL,
    name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    recipe_id TEXT NOT NULL DEFAULT '', stock_follow INTEGER NOT NULL DEFAULT 1,
    seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (branch_id, kind, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS v2_club_orders (
    branch_id TEXT NOT NULL, order_id TEXT NOT NULL, order_number TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, fulfillment TEXT NOT NULL DEFAULT '', payment_method TEXT NOT NULL DEFAULT '',
    total INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL,
    sale_state TEXT NOT NULL DEFAULT '', sale_note TEXT NOT NULL DEFAULT '', sale_date TEXT NOT NULL DEFAULT '',
    notified_new TEXT NOT NULL DEFAULT '', notified_cancel TEXT NOT NULL DEFAULT '', notify_error TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (branch_id, order_id)
  )`,
  "CREATE INDEX IF NOT EXISTS v2_club_orders_recent ON v2_club_orders (branch_id, received_at)",
  // Do'konning ochiq manzili (sinxronda o'zi bildiradi) — HALO Control do'konga murojaat qilishi uchun (manzil qidirish).
  "CREATE TABLE IF NOT EXISTS v2_club_shop (branch_id TEXT PRIMARY KEY NOT NULL, url TEXT NOT NULL DEFAULT '', seen_at TEXT NOT NULL)",
];
/** Do'kon manzili: faqat https://sayt-nomi (yo'l, port va IP manzilsiz) — boshqa narsa saqlanmaydi. */
export function cleanShopUrl(value: unknown): string {
  const url = String(value ?? "").trim().toLowerCase();
  const host = url.startsWith("https://") ? url.slice(8) : "";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) || /^\d+(\.\d+){3}$/.test(host) || host.length > 120) return "";
  if (/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) return "";
  return `https://${host}`;
}
/** Ulangan do'kon: kalit xeshi (imzo uchun) va manzili. Ulanmagan yoki manzil hali kelmagan bo'lsa — null. */
export async function clubShopLink(db: D1Like): Promise<{ keyHash: string; url: string } | null> {
  await ensureClubSchema(db);
  const row = await db.prepare(
    "SELECT s.key_hash AS key_hash, p.url AS url FROM v2_club_settings s JOIN v2_club_shop p ON p.branch_id = s.branch_id WHERE s.key_hash <> '' AND p.url <> '' ORDER BY p.seen_at DESC LIMIT 1",
  ).first<{ key_hash: string; url: string }>();
  const url = cleanShopUrl(row?.url);
  return row?.key_hash && url ? { keyHash: row.key_hash, url } : null;
}
// Jadvallar bir marta tekshiriladi (har so'rovda emas): do'kon boshqa mintaqadan chaqiradi, har bir baza so'rovi ~0,2 soniya turadi.
const schemaReady = new WeakSet<object>();
export async function ensureClubSchema(db: D1Like) {
  if (schemaReady.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}
/** batch() javobidagi SELECT qatorlari (null — javob kutilgan shaklda emas, alohida so'rov kerak). */
const batchRows = <T>(result: unknown): T[] | null => {
  const rows = (result as { results?: unknown } | null | undefined)?.results;
  return Array.isArray(rows) ? rows as T[] : null;
};

export interface ClubSettings {
  branchId: string; keyPrefix: string; keyCreatedAt: string; salesEnabled: boolean; priceSync: boolean; stockSync: boolean; notifyEnabled: boolean;
  groupChatId: string; groupChatName: string; groupThreadId: number; lastSyncAt: string; lastOrderAt: string;
}
type SettingsRow = {
  branch_id: string; key_hash: string; key_prefix: string; key_created_at: string; sales_enabled: number; price_sync: number; stock_sync: number;
  notify_enabled: number; group_chat_id: string; group_chat_name: string; group_thread_id: number; last_sync_at: string; last_order_at: string;
};
const toSettings = (branchId: string, row: SettingsRow | null): ClubSettings => ({
  branchId, keyPrefix: row?.key_prefix || "", keyCreatedAt: row?.key_created_at || "", salesEnabled: Boolean(row?.sales_enabled), priceSync: Boolean(row?.price_sync),
  stockSync: Boolean(row?.stock_sync), notifyEnabled: row ? Boolean(row.notify_enabled) : true, groupChatId: row?.group_chat_id || "", groupChatName: row?.group_chat_name || "",
  groupThreadId: Number(row?.group_thread_id || 0), lastSyncAt: row?.last_sync_at || "", lastOrderAt: row?.last_order_at || "",
});

export async function readClubSettings(db: D1Like, branchId: string): Promise<ClubSettings> {
  await ensureClubSchema(db);
  return toSettings(branchId, await db.prepare("SELECT * FROM v2_club_settings WHERE branch_id = ?").bind(branchId).first<SettingsRow>());
}
async function ensureSettingsRow(db: D1Like, branchId: string, now: string) {
  await ensureClubSchema(db);
  await db.prepare("INSERT OR IGNORE INTO v2_club_settings (branch_id, updated_at) VALUES (?, ?)").bind(branchId, now).run();
}
export async function saveClubSwitches(db: D1Like, branchId: string, patch: { salesEnabled?: unknown; priceSync?: unknown; stockSync?: unknown; notifyEnabled?: unknown }, now = new Date().toISOString()) {
  await ensureSettingsRow(db, branchId, now);
  const columns: Array<[string, unknown]> = [["sales_enabled", patch.salesEnabled], ["price_sync", patch.priceSync], ["stock_sync", patch.stockSync], ["notify_enabled", patch.notifyEnabled]];
  for (const [column, value] of columns) {
    if (typeof value !== "boolean") continue;
    await db.prepare(`UPDATE v2_club_settings SET ${column} = ?, updated_at = ? WHERE branch_id = ?`).bind(value ? 1 : 0, now, branchId).run();
  }
  return readClubSettings(db, branchId);
}
export async function saveClubGroup(db: D1Like, branchId: string, chatId: string, chatName: string, threadId: number, now = new Date().toISOString()) {
  await ensureSettingsRow(db, branchId, now);
  await db.prepare("UPDATE v2_club_settings SET group_chat_id = ?, group_chat_name = ?, group_thread_id = ?, updated_at = ? WHERE branch_id = ?")
    .bind(chatId, chatName.slice(0, 120), threadId > 0 ? Math.round(threadId) : 0, now, branchId).run();
  return readClubSettings(db, branchId);
}

const sha256 = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Yangi kalit: bir marta ko'rsatiladi, bazada faqat xeshi qoladi. Eskisi shu zahoti ishlamay qoladi. */
export async function createClubKey(db: D1Like, branchId: string, now = new Date().toISOString()) {
  await ensureSettingsRow(db, branchId, now);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const key = `halo_club_${base64Url(bytes)}`;
  await db.prepare("UPDATE v2_club_settings SET key_hash = ?, key_prefix = ?, key_created_at = ?, updated_at = ? WHERE branch_id = ?")
    .bind(await sha256(key), `${key.slice(0, 16)}…`, now, now, branchId).run();
  return key;
}
export async function revokeClubKey(db: D1Like, branchId: string, now = new Date().toISOString()) {
  await ensureSettingsRow(db, branchId, now);
  await db.prepare("UPDATE v2_club_settings SET key_hash = '', key_prefix = '', key_created_at = '', updated_at = ? WHERE branch_id = ?").bind(now, branchId).run();
}
/** So'rovdagi kalit qaysi filialniki (null — kalit noto'g'ri). Filial sozlamalari ham shu bitta so'rovda o'qiladi. */
export async function authenticateClub(db: D1Like, request: Request): Promise<ClubSettings | null> {
  const header = request.headers.get("authorization") || "";
  const key = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!/^halo_club_[A-Za-z0-9_-]{40,}$/.test(key)) return null;
  await ensureClubSchema(db);
  const row = await db.prepare("SELECT * FROM v2_club_settings WHERE key_hash = ? AND key_hash <> ''").bind(await sha256(key)).first<SettingsRow>();
  return row?.branch_id ? toSettings(row.branch_id, row) : null;
}

export interface ClubProduct { kind: "product" | "addon"; id: string; name: string; category: string; price: number; active: boolean; recipeId: string; stockFollow: boolean; seenAt: string }
type ProductRow = { kind: string; external_id: string; name: string; category: string; price: number; active: number; recipe_id: string; stock_follow: number; seen_at: string };

const PRODUCTS_SQL = "SELECT kind, external_id, name, category, price, active, recipe_id, stock_follow, seen_at FROM v2_club_products WHERE branch_id = ? ORDER BY kind DESC, category, name";
const toProduct = (row: ProductRow): ClubProduct => ({
  kind: row.kind === "addon" ? "addon" : "product", id: row.external_id, name: row.name, category: row.category, price: Number(row.price) || 0,
  active: Boolean(row.active), recipeId: row.recipe_id, stockFollow: Boolean(row.stock_follow), seenAt: row.seen_at,
});
export async function listClubProducts(db: D1Like, branchId: string): Promise<ClubProduct[]> {
  await ensureClubSchema(db);
  const result = await db.prepare(PRODUCTS_SQL).bind(branchId).all<ProductRow>();
  return result.results.map(toProduct);
}
export const linkMap = (products: ClubProduct[]) => new Map(products.filter((product) => product.recipeId).map((product) => [linkKey(product.kind, product.id), product.recipeId]));

function normalizeCatalog(input: unknown, kind: "product" | "addon") {
  const list = Array.isArray(input) ? input as unknown[] : [];
  if (list.length > 600) throw new ClubError("Mahsulotlar ro‘yxati juda uzun.", 422);
  const seen = new Set<string>();
  return list.flatMap((raw) => {
    const item = raw && typeof raw === "object" ? raw as Row : {};
    const id = externalId(item.id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const price = Number(item.price);
    return [{ kind, id, name: text(item.name, 120) || id, category: text(item.category, 60), price: Number.isSafeInteger(price) && price >= 0 ? price : 0, active: item.active !== false }];
  });
}

/**
 * Do'kon o'z mahsulotlari ro'yxatini yuboradi; javobda har biri uchun ko'rsatma oladi:
 * narx (yoqilgan va bog'langan bo'lsa — HALO Control'dagi sotuv narxi) va "tugadi" belgisi.
 * Bog'lash faqat HALO Control'da, rahbar tomonidan qilinadi — bu yerda saqlangan bog'lanishga tegilmaydi.
 * `settings` — kalit tekshirilganda o'qilgan sozlamalar (qayta o'qilmaydi). `loadState` faqat narx yoki "tugadi" yoqilgan
 * bo'lsa chaqiriladi: ikkalasi o'chiq bo'lsa filial holati kerak emas.
 */
export async function syncClubCatalog(db: D1Like, settings: ClubSettings, body: unknown, loadState: () => Promise<Row>, now = new Date().toISOString()) {
  const branchId = settings.branchId;
  const source = body && typeof body === "object" ? body as Row : {};
  const incoming = [...normalizeCatalog(source.products, "product"), ...normalizeCatalog(source.addons, "addon")];
  await ensureClubSchema(db);
  const upserts = incoming.map((item) => db.prepare(
    `INSERT INTO v2_club_products (branch_id, kind, external_id, name, category, price, active, seen_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(branch_id, kind, external_id) DO UPDATE SET name = excluded.name, category = excluded.category, price = excluded.price, active = excluded.active, seen_at = excluded.seen_at`,
  ).bind(branchId, item.kind, item.id, item.name, item.category, item.price, item.active ? 1 : 0, now, now));
  // Oxirgi to'plamga vaqt belgisi va ro'yxatni o'qish ham qo'shiladi — bitta baza so'rovi.
  const shopUrl = cleanShopUrl(source.shopUrl);
  const tail = [
    ...(shopUrl ? [db.prepare("INSERT INTO v2_club_shop (branch_id, url, seen_at) VALUES (?, ?, ?) ON CONFLICT(branch_id) DO UPDATE SET url = excluded.url, seen_at = excluded.seen_at").bind(branchId, shopUrl, now)] : []),
    db.prepare("INSERT OR IGNORE INTO v2_club_settings (branch_id, updated_at) VALUES (?, ?)").bind(branchId, now),
    db.prepare("UPDATE v2_club_settings SET last_sync_at = ? WHERE branch_id = ?").bind(now, branchId),
    db.prepare(PRODUCTS_SQL).bind(branchId),
  ];
  let last: unknown[] = [];
  for (let index = 0; index === 0 || index < upserts.length; index += 40) {
    const chunk = upserts.slice(index, index + 40);
    const final = index + 40 >= upserts.length;
    last = await db.batch(final ? [...chunk, ...tail] : chunk);
  }
  const rows = batchRows<ProductRow>(last[last.length - 1]);
  const products = rows ? rows.map(toProduct) : await listClubProducts(db, branchId);
  const stored = new Map(products.map((product) => [linkKey(product.kind, product.id), product]));
  const needState = settings.priceSync || settings.stockSync;
  const recipes = needState ? new Map(recipeInfos(await loadState()).map((recipe) => [recipe.id, recipe])) : null;
  const directive = (kind: "product" | "addon", id: string) => {
    const product = stored.get(linkKey(kind, id));
    const recipe = recipes && product?.recipeId ? recipes.get(product.recipeId) : undefined;
    return {
      id, linked: recipes ? Boolean(recipe) : Boolean(product?.recipeId),
      price: settings.priceSync && recipe && recipe.price > 0 ? recipe.price : null,
      soldOut: Boolean(settings.stockSync && recipe && product?.stockFollow && recipe.portions !== null && recipe.portions < 1),
    };
  };
  return {
    priceSync: settings.priceSync, stockSync: settings.stockSync,
    products: incoming.filter((item) => item.kind === "product").map((item) => directive("product", item.id)),
    addons: incoming.filter((item) => item.kind === "addon").map((item) => { const out = directive("addon", item.id); return { id: out.id, linked: out.linked, price: out.price }; }),
  };
}

/** Rahbar bog'lashni saqlaydi: recipeId bo'sh — bog'lanish olib tashlanadi. */
export async function saveClubLinks(db: D1Like, branchId: string, input: unknown, state: Row, now = new Date().toISOString()) {
  const list = Array.isArray(input) ? input as unknown[] : [];
  if (!list.length || list.length > 600) throw new ClubError("Bog‘lash ro‘yxati bo‘sh yoki juda uzun.");
  const recipeIds = new Set(recipeInfos(state).map((recipe) => recipe.id));
  await ensureClubSchema(db);
  const statements = list.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Row : {};
    const kind = item.kind === "addon" ? "addon" : "product";
    const id = externalId(item.id);
    const recipeId = String(item.recipeId || "");
    if (!id) throw new ClubError("Mahsulot belgisi noto‘g‘ri.");
    if (recipeId && !recipeIds.has(recipeId)) throw new ClubError("Tanlangan taom HALO Control menyusida topilmadi. Sahifani yangilang.");
    const follow = item.stockFollow === false ? 0 : 1;
    return db.prepare("UPDATE v2_club_products SET recipe_id = ?, stock_follow = ?, updated_at = ? WHERE branch_id = ? AND kind = ? AND external_id = ?")
      .bind(recipeId, follow, now, branchId, kind, id);
  });
  for (let index = 0; index < statements.length; index += 40) await db.batch(statements.slice(index, index + 40));
}

/* ---------- Buyurtmalar ---------- */

export interface ClubOrderRow {
  orderId: string; number: string; status: ClubStatus; fulfillment: string; paymentMethod: string; total: number; order: ClubOrder | null;
  saleState: string; saleNote: string; saleDate: string; notifiedNew: string; notifiedCancel: string; notifyError: string; receivedAt: string; updatedAt: string;
}
type OrderDbRow = {
  order_id: string; order_number: string; status: string; fulfillment: string; payment_method: string; total: number; payload: string;
  sale_state: string; sale_note: string; sale_date: string; notified_new: string; notified_cancel: string; notify_error: string; received_at: string; updated_at: string;
};
const toOrderRow = (row: OrderDbRow): ClubOrderRow => {
  let order: ClubOrder | null = null;
  try { order = normalizeClubOrder(JSON.parse(row.payload)); } catch { order = null; }
  return {
    orderId: row.order_id, number: row.order_number, status: row.status as ClubStatus, fulfillment: row.fulfillment, paymentMethod: row.payment_method, total: Number(row.total) || 0, order,
    saleState: row.sale_state, saleNote: row.sale_note, saleDate: row.sale_date, notifiedNew: row.notified_new, notifiedCancel: row.notified_cancel, notifyError: row.notify_error,
    receivedAt: row.received_at, updatedAt: row.updated_at,
  };
};
const ORDER_COLUMNS = "order_id, order_number, status, fulfillment, payment_method, total, payload, sale_state, sale_note, sale_date, notified_new, notified_cancel, notify_error, received_at, updated_at";

export async function readClubOrder(db: D1Like, branchId: string, orderId: string): Promise<ClubOrderRow | null> {
  await ensureClubSchema(db);
  const row = await db.prepare(`SELECT ${ORDER_COLUMNS} FROM v2_club_orders WHERE branch_id = ? AND order_id = ?`).bind(branchId, orderId).first<OrderDbRow>();
  return row ? toOrderRow(row) : null;
}
export async function listClubOrders(db: D1Like, branchId: string, limit = 60): Promise<ClubOrderRow[]> {
  await ensureClubSchema(db);
  const result = await db.prepare(`SELECT ${ORDER_COLUMNS} FROM v2_club_orders WHERE branch_id = ? ORDER BY received_at DESC LIMIT ?`).bind(branchId, Math.min(200, Math.max(1, limit))).all<OrderDbRow>();
  return result.results.map(toOrderRow);
}
export async function listWaitingClubOrders(db: D1Like, branchId: string): Promise<ClubOrderRow[]> {
  await ensureClubSchema(db);
  const result = await db.prepare(`SELECT ${ORDER_COLUMNS} FROM v2_club_orders WHERE branch_id = ? AND status = 'completed' AND sale_state = 'waiting' ORDER BY received_at LIMIT 200`).bind(branchId).all<OrderDbRow>();
  return result.results.map(toOrderRow);
}

const RANK_SQL = `CASE status ${CLUB_STATUSES.map((status) => `WHEN '${status}' THEN ${RANK[status]}`).join(" ")} ELSE 0 END`;
/**
 * Hodisani qabul qiladi: buyurtma yoziladi yoki holati yangilanadi (holat orqaga qaytmaydi, yopilgani o'zgarmaydi).
 * Hammasi bitta to'plamda (bitta baza so'rovi): yozish, shartli yangilash va natijani o'qish.
 */
export async function recordClubOrder(db: D1Like, branchId: string, order: ClubOrder, now = new Date().toISOString()): Promise<ClubOrderRow> {
  await ensureClubSchema(db);
  const payload = JSON.stringify(order);
  const results = await db.batch([
    db.prepare("INSERT OR IGNORE INTO v2_club_settings (branch_id, updated_at) VALUES (?, ?)").bind(branchId, now),
    db.prepare(
      `INSERT OR IGNORE INTO v2_club_orders (branch_id, order_id, order_number, status, fulfillment, payment_method, total, payload, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(branchId, order.id, order.number, order.status, order.fulfillment, order.paymentMethod, order.total, payload, now, now),
    db.prepare(
      `UPDATE v2_club_orders SET status = ?, order_number = ?, fulfillment = ?, payment_method = ?, total = ?, payload = ?, updated_at = ?
       WHERE branch_id = ? AND order_id = ? AND status NOT IN ('completed', 'cancelled') AND status <> ? AND ? >= ${RANK_SQL}`,
    ).bind(order.status, order.number, order.fulfillment, order.paymentMethod, order.total, payload, now, branchId, order.id, order.status, RANK[order.status]),
    db.prepare("UPDATE v2_club_settings SET last_order_at = ? WHERE branch_id = ?").bind(now, branchId),
    db.prepare(`SELECT ${ORDER_COLUMNS} FROM v2_club_orders WHERE branch_id = ? AND order_id = ?`).bind(branchId, order.id),
  ]);
  const rows = batchRows<OrderDbRow>(results[results.length - 1]);
  const current = rows ? (rows[0] ? toOrderRow(rows[0]) : null) : await readClubOrder(db, branchId, order.id);
  if (!current) throw new ClubError("Buyurtma saqlanmadi.", 500);
  return current;
}
export async function setClubSaleState(db: D1Like, branchId: string, orderId: string, saleState: string, note: string, date = "", now = new Date().toISOString()) {
  await db.prepare("UPDATE v2_club_orders SET sale_state = ?, sale_note = ?, sale_date = ?, updated_at = ? WHERE branch_id = ? AND order_id = ?")
    .bind(saleState, note.slice(0, 300), date, now, branchId, orderId).run();
}
/** Guruh xabarini bir marta yuborish uchun belgi: true — shu chaqiruv yuboradi. */
export async function claimClubNotice(db: D1Like, branchId: string, orderId: string, kind: "new" | "cancel", now = new Date().toISOString()): Promise<boolean> {
  const column = kind === "new" ? "notified_new" : "notified_cancel";
  const result = await db.prepare(`UPDATE v2_club_orders SET ${column} = ? WHERE branch_id = ? AND order_id = ? AND ${column} = ''`).bind(now, branchId, orderId).run() as { meta?: { changes?: number } };
  return Boolean(result?.meta?.changes);
}
export async function finishClubNotice(db: D1Like, branchId: string, orderId: string, kind: "new" | "cancel", error: string) {
  const column = kind === "new" ? "notified_new" : "notified_cancel";
  if (error) await db.prepare(`UPDATE v2_club_orders SET ${column} = '', notify_error = ? WHERE branch_id = ? AND order_id = ?`).bind(error.slice(0, 200), branchId, orderId).run();
  else await db.prepare("UPDATE v2_club_orders SET notify_error = '' WHERE branch_id = ? AND order_id = ?").bind(branchId, orderId).run();
}

const money = (value: number) => `₩${Math.round(value).toLocaleString("en-US")}`;
const FULFILLMENT_LABEL: Record<string, string> = { PICKUP: "🥡 Olib ketish", DELIVERY: "🛵 Yetkazib berish", DINE_IN: "🍽 Zalda" };
const PAYMENT_LABEL: Record<string, string> = { CASH: "💵 Naqd (do‘konda)", CARD: "💳 Karta (do‘konda)", BANK_TRANSFER: "🏦 Bank o‘tkazmasi", CASHBACK: "🎁 To‘liq cashback bilan" };

/** Guruhga boradigan xabar matni (mijoz ma'lumotisiz). */
export function clubOrderMessage(order: ClubOrder, kind: "new" | "cancel"): string {
  if (kind === "cancel") return `❌ Telegram buyurtma #${order.number} bekor qilindi · ${money(order.total)}`;
  const lines = [`🛎 Yangi Telegram buyurtma #${order.number}`,
    `${FULFILLMENT_LABEL[order.fulfillment] || order.fulfillment}${order.fulfillment === "DINE_IN" && order.arrivalMinutes ? ` · ${order.arrivalMinutes} daqiqada keladi` : ""}`,
    `${PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod}${order.paymentMethod === "BANK_TRANSFER" && order.paymentStatus !== "PAID" ? " — to‘lov hali tasdiqlanmagan" : ""}`, ""];
  for (const item of order.items) {
    lines.push(`• ${item.name} × ${item.quantity} — ${money(item.lineTotal)}`);
    if (item.addons.length) lines.push(`   + ${item.addons.map((addon) => addon.name).join(", ")}`);
  }
  lines.push("");
  if (order.promotionDiscount) lines.push(`Aksiya${order.promotionName ? ` (${order.promotionName})` : ""}: −${money(order.promotionDiscount)}`);
  if (order.cashbackUsed) lines.push(`Cashback: −${money(order.cashbackUsed)}`);
  if (order.deliveryFee) lines.push(`Yetkazish haqi: ${money(order.deliveryFee)}`);
  lines.push(`Jami: ${money(order.total)}`);
  return lines.join("\n");
}

export { PosTerminalError };
