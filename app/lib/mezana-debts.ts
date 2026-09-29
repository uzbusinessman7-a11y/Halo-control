import { validStockDocument, type StockDocument } from "./stock-documents.ts";

export type MezanaDebtAction = "borrowed" | "returned" | "purchased" | "paid";

export type MezanaDebtEntry = {
  posting?: import("./mezana-posting.ts").MezanaPosting;
  id: string;
  action: MezanaDebtAction;
  productName: string;
  amount: number;
  quantity?: number;
  catalogItemId?: string;
  unitPrice?: number;
  itemCount?: number;
  productImage?: StockDocument;
  date: string;
  note: string;
  documents: StockDocument[];
  createdByWorkerId: string;
  createdByName: string;
  createdAt: string;
};

export type MezanaSettings = {
  /** OLIB TURILDI + QAYTARIB QO‘YILDI destination (legacy field names). */
  telegramChatId: string;
  telegramChatName: string;
  telegramThreadId: number;
  /** SOTIB OLINDI destination. It is intentionally separate. */
  purchasedTelegramChatId: string;
  purchasedTelegramChatName: string;
  purchasedTelegramThreadId: number;
};

export type MezanaTelegramDestination = {
  chatId: string;
  chatName: string;
  threadId: number;
};

const won = (value: number) => `₩${Math.round(value || 0).toLocaleString("en-US")}`;

export function isMezanaSupplierName(value: unknown) {
  const name = String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  return name === "MEZANA" || name.startsWith("MEZANA ");
}

export function normalizeMezanaSettings(value: unknown): MezanaSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      telegramChatId: "",
      telegramChatName: "",
      telegramThreadId: 0,
      purchasedTelegramChatId: "",
      purchasedTelegramChatName: "",
      purchasedTelegramThreadId: 0,
    };
  }
  const settings = value as Record<string, unknown>;
  const telegramThreadId = Number(settings.telegramThreadId || 0);
  const purchasedTelegramThreadId = Number(settings.purchasedTelegramThreadId || 0);
  return {
    telegramChatId: String(settings.telegramChatId || "").trim().slice(0, 80),
    telegramChatName: String(settings.telegramChatName || "").trim().slice(0, 120),
    telegramThreadId: Number.isSafeInteger(telegramThreadId) && telegramThreadId > 0 ? telegramThreadId : 0,
    purchasedTelegramChatId: String(settings.purchasedTelegramChatId || "").trim().slice(0, 80),
    purchasedTelegramChatName: String(settings.purchasedTelegramChatName || "").trim().slice(0, 120),
    purchasedTelegramThreadId: Number.isSafeInteger(purchasedTelegramThreadId) && purchasedTelegramThreadId > 0
      ? purchasedTelegramThreadId
      : 0,
  };
}

export function mezanaTelegramDestination(
  settings: MezanaSettings,
  action: MezanaDebtAction,
): MezanaTelegramDestination {
  if (action === "purchased" || action === "paid") {
    return {
      chatId: settings.purchasedTelegramChatId,
      chatName: settings.purchasedTelegramChatName,
      threadId: settings.purchasedTelegramThreadId,
    };
  }
  return {
    chatId: settings.telegramChatId,
    chatName: settings.telegramChatName,
    threadId: settings.telegramThreadId,
  };
}

export function validMezanaDebtEntry(value: unknown): value is MezanaDebtEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const currentQuantityEntry = (entry.action === "borrowed" || entry.action === "returned")
    && Number(entry.amount) === 0
    && Number.isSafeInteger(entry.quantity)
    && Number(entry.quantity) > 0
    && Number(entry.quantity) <= 1_000_000;
  const legacyMoneyEntry = (entry.action === "borrowed" || entry.action === "returned")
    && entry.quantity === undefined
    && Number.isSafeInteger(entry.amount)
    && Number(entry.amount) > 0
    && Number(entry.amount) <= 100_000_000_000;
  const purchasedEntry = entry.action === "purchased"
    && entry.quantity === undefined
    && Number.isSafeInteger(entry.amount)
    && Number(entry.amount) > 0
    && Number(entry.amount) <= 100_000_000_000;
  const paidEntry = entry.action === "paid"
    && entry.quantity === undefined
    && Number.isSafeInteger(entry.amount)
    && Number(entry.amount) > 0
    && Number(entry.amount) <= 100_000_000_000;
  const optionalCatalogFields = (entry.catalogItemId === undefined
      || (typeof entry.catalogItemId === "string" && entry.catalogItemId.startsWith("mezana-product:") && entry.catalogItemId.length <= 100))
    && (entry.unitPrice === undefined || (Number.isSafeInteger(entry.unitPrice) && Number(entry.unitPrice) >= 0 && Number(entry.unitPrice) <= 100_000_000_000))
    && (entry.itemCount === undefined || (Number.isSafeInteger(entry.itemCount) && Number(entry.itemCount) > 0 && Number(entry.itemCount) <= 1_000_000))
    && (entry.productImage === undefined || validStockDocument(entry.productImage));
  return typeof entry.id === "string" && entry.id.length >= 20 && entry.id.length <= 100
    && (entry.action === "borrowed" || entry.action === "returned" || entry.action === "purchased" || entry.action === "paid")
    && typeof entry.productName === "string" && entry.productName.trim().length > 0 && entry.productName.length <= 140
    && (purchasedEntry || paidEntry || currentQuantityEntry || legacyMoneyEntry)
    && optionalCatalogFields
    && typeof entry.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    && typeof entry.note === "string" && entry.note.length <= 300
    && Array.isArray(entry.documents) && entry.documents.length <= 2
    && entry.documents.every(validStockDocument)
    && typeof entry.createdByWorkerId === "string" && entry.createdByWorkerId.length > 0
    && typeof entry.createdByName === "string" && entry.createdByName.trim().length > 0
    && typeof entry.createdAt === "string" && Number.isFinite(Date.parse(entry.createdAt));
}

/**
 * Repairs the only safe legacy inconsistency without changing the user's action:
 * a purchased row must never inherit a borrowed/returned quantity after editing.
 * Historical money-based borrowed/returned rows remain readable and auditable.
 */
export function normalizeMezanaDebtEntry(value: unknown): MezanaDebtEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as MezanaDebtEntry;
  const normalized = entry.action === "purchased" || entry.action === "paid"
    ? { ...entry, quantity: undefined }
    : entry;
  return validMezanaDebtEntry(normalized) ? normalized : null;
}

export function normalizeMezanaDebtEntries(value: unknown): MezanaDebtEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    const entry = normalizeMezanaDebtEntry(raw);
    if (!entry || seen.has(entry.id)) return [];
    seen.add(entry.id);
    return [entry];
  });
}

export function mezanaDebtEntryValue(entry: Pick<MezanaDebtEntry, "action" | "amount" | "quantity">) {
  if (entry.action === "purchased" || entry.action === "paid") return won(entry.amount);
  if (entry.quantity) return `${entry.quantity} ta`;
  return won(entry.amount);
}

export function mezanaDebtBalance(entries: Array<Pick<MezanaDebtEntry, "action" | "amount">>) {
  return entries.reduce((balance, entry) => (
    balance + (entry.action === "paid" || entry.action === "returned" ? -Number(entry.amount || 0) : Number(entry.amount || 0))
  ), 0);
}

const mezanaProductKey = (value: unknown) => String(value || "")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("uz-UZ");

export function mezanaBorrowedQuantityBalance(
  entries: Array<Pick<MezanaDebtEntry, "action" | "productName" | "quantity">>,
  productName?: string,
) {
  const selectedKey = productName === undefined ? "" : mezanaProductKey(productName);
  return entries.reduce((balance, entry) => {
    if (entry.action !== "borrowed" && entry.action !== "returned") return balance;
    if (selectedKey && mezanaProductKey(entry.productName) !== selectedKey) return balance;
    const quantity = Number(entry.quantity || 0);
    return balance + (entry.action === "returned" ? -quantity : quantity);
  }, 0);
}

export function hasNegativeMezanaBorrowedQuantity(
  entries: Array<Pick<MezanaDebtEntry, "action" | "productName" | "quantity">>,
) {
  const balances = new Map<string, number>();
  for (const entry of entries) {
    if (entry.action !== "borrowed" && entry.action !== "returned") continue;
    const key = mezanaProductKey(entry.productName);
    const quantity = Number(entry.quantity || 0);
    balances.set(key, (balances.get(key) || 0) + (entry.action === "returned" ? -quantity : quantity));
  }
  return [...balances.values()].some((balance) => balance < 0);
}

export function mezanaDebtActionLabel(action: MezanaDebtAction) {
  if (action === "returned") return "QAYTARIB QO‘YILDI";
  if (action === "purchased") return "SOTIB OLINDI";
  if (action === "paid") return "TO‘LIQ TO‘LANDI";
  return "OLIB TURILDI";
}

export function buildMezanaDebtTelegramMessage(value: {
  action: MezanaDebtAction;
  date: string;
  workerName: string;
  productName: string;
  amount: number;
  quantity?: number;
  currentBalance: number;
  currentBorrowedQuantity?: number;
  note?: string;
}) {
  const [year = "", month = "", day = ""] = value.date.split("-");
  return [
    `🏪 MEZANA · ${mezanaDebtActionLabel(value.action)}`,
    `📅 ${day}.${month}.${year}`,
    `👤 Kiritgan hodim: ${value.workerName}`,
    `📦 ${value.productName}`,
    value.quantity
      ? value.action === "returned"
        ? `➖ Qaytarildi: ${value.quantity} ta`
        : `➕ Olib turildi: ${value.quantity} ta`
      : "",
    (value.action === "purchased" || value.action === "paid") && value.amount > 0
      ? `${value.action === "paid" ? "✅ To‘landi" : "💵 Summa"}: ${won(value.amount)}`
      : "",
    value.note ? `📝 ${value.note}` : "",
    "",
    value.action === "purchased" || value.action === "paid"
      ? `💳 MEZANA qolgan qarzi: ${won(Math.max(0, value.currentBalance))}`
      : `📊 Hozir olib turilgan: ${Math.max(0, Number(value.currentBorrowedQuantity || 0))} ta`,
  ].filter(Boolean).join("\n");
}
