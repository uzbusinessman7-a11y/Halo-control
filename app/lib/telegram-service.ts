import { calculateAccountBalances } from "./account-balances";
import { auditBusinessState } from "./business-audit";
import { isExpenseOnlyInventory } from "./vegetable-expenses";
import { dispatchBusinessTrendNotification } from "./business-trend-notifications";
import { isAdminRequest } from "./integration-store";
import { calculateDailyReport } from "./daily-report";
import { formatExpenseEffectWon } from "./money-format";
import { readHaloStateWithRecurringExpenses } from "./recurring-expense-store";
import { HaloStateConflictError, mutateHaloState } from "./halo-store";
import {
  buildMezanaDebtTelegramMessage,
  isMezanaSupplierName,
  mezanaBorrowedQuantityBalance,
  mezanaDebtBalance,
  mezanaTelegramDestination,
  normalizeMezanaDebtEntries,
  normalizeMezanaSettings,
  type MezanaDebtEntry,
} from "./mezana-debts";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_CONTROL_BUCKET__: R2Bucket | undefined;
}

export type TelegramSettings = {
  botToken: string;
  chatId: string;
  botName: string;
  enabled: boolean;
  reportTime: string;
  lastSentDate: string;
  lastSentAt: string;
};

type StateShape = {
  inventory?: Array<{
    id?: string;
    name?: string;
    unit?: string;
    stock?: number;
    minStock?: number;
    expenseOnly?: boolean;
    unitCost?: number;
    supplierId?: string;
  }>;
  recipes?: Array<{
    id?: string;
    name?: string;
    ingredients?: Array<{ inventoryId?: string; quantity?: number }>;
  }>;
  suppliers?: Array<{
    id?: string;
    name?: string;
    phone?: string;
    balance?: number;
    telegramChatId?: string;
    autoOrder?: boolean;
  }>;
  sales?: Array<{
    recipeId?: string;
    quantity?: number;
    totalRevenue?: number;
    totalCost?: number;
    date?: string;
    accountId?: string;
    stockUsage?: Array<{ inventoryId?: string; quantity?: number }>;
  }>;
  accounts?: Array<{ id?: string; name?: string; type?: string; openingBalance?: number }>;
  financialEntries?: Array<{
    type?: "income" | "expense" | "transfer";
    amount?: number;
    date?: string;
    accountId?: string;
    toAccountId?: string;
    affectsProfit?: boolean;
  }>;
  dailyCloses?: Array<{ date?: string; difference?: number }>;
  fixedExpenses?: Array<{ active?: boolean; nextDue?: string }>;
  costRules?: { cardCommissionPct?: number; deliveryCommissionPct?: number; taxPct?: number };
  mezanaSettings?: {
    telegramChatId?: string;
    telegramChatName?: string;
    telegramThreadId?: number;
    purchasedTelegramChatId?: string;
    purchasedTelegramChatName?: string;
    purchasedTelegramThreadId?: number;
  };
  mezanaEntries?: MezanaDebtEntry[];
  staff?: unknown;
  workShifts?: unknown;
  payrollAdjustments?: unknown;
  attendanceDays?: unknown;
};

const SETTINGS_SQL = `CREATE TABLE IF NOT EXISTS telegram_settings (
  id TEXT PRIMARY KEY NOT NULL,
  bot_token TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  bot_name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  report_time TEXT NOT NULL DEFAULT '00:10',
  last_sent_date TEXT NOT NULL DEFAULT '',
  last_sent_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const STATE_SQL = `CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const BRANCH_STATUS_SQL = `CREATE TABLE IF NOT EXISTS telegram_branch_status (
  branch_id TEXT PRIMARY KEY NOT NULL,
  last_sent_date TEXT NOT NULL DEFAULT '',
  last_sent_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const emptySettings: TelegramSettings = {
  botToken: "",
  chatId: "",
  botName: "",
  enabled: false,
  reportTime: "00:10",
  lastSentDate: "",
  lastSentAt: "",
};

function db() {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Database unavailable");
  return globalThis.__HALO_CONTROL_DB__;
}

// An unresolved Promise cannot safely cross Cloudflare request contexts.
let telegramTablesReady = false;

async function initializeTables() {
  const database = db();
  await database.batch([
    database.prepare(SETTINGS_SQL),
    database.prepare(STATE_SQL),
    database.prepare(BRANCH_STATUS_SQL),
  ]);
}

async function ensureTables() {
  if (telegramTablesReady) return;
  await initializeTables();
  telegramTablesReady = true;
}

export async function readSettings(): Promise<TelegramSettings> {
  await ensureTables();
  const row = await db().prepare(`SELECT bot_token, chat_id, bot_name, enabled, report_time,
      last_sent_date, last_sent_at FROM telegram_settings WHERE id = ?`)
    .bind("main")
    .first<{
      bot_token: string;
      chat_id: string;
      bot_name: string;
      enabled: number;
      report_time: string;
      last_sent_date: string;
      last_sent_at: string;
    }>();
  if (!row) return emptySettings;
  return {
    botToken: row.bot_token,
    chatId: row.chat_id,
    botName: row.bot_name,
    enabled: Boolean(row.enabled),
    reportTime: row.report_time || "00:10",
    lastSentDate: row.last_sent_date || "",
    lastSentAt: row.last_sent_at || "",
  };
}

export async function writeSettings(settings: TelegramSettings) {
  await ensureTables();
  await db().prepare(`INSERT INTO telegram_settings
      (id, bot_token, chat_id, bot_name, enabled, report_time, last_sent_date, last_sent_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        bot_token = excluded.bot_token,
        chat_id = excluded.chat_id,
        bot_name = excluded.bot_name,
        enabled = excluded.enabled,
        report_time = excluded.report_time,
        last_sent_date = excluded.last_sent_date,
        last_sent_at = excluded.last_sent_at,
        updated_at = CURRENT_TIMESTAMP`)
    .bind(
      "main",
      settings.botToken,
      settings.chatId,
      settings.botName,
      settings.enabled ? 1 : 0,
      settings.reportTime,
      settings.lastSentDate,
      settings.lastSentAt,
    )
    .run();
}

export function koreaClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
  };
}

const won = (value: number) => `₩${Math.round(value).toLocaleString("en-US")}`;
const displayDate = (value: string) => {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
};
export const previousDate = (value: string) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};
const daysBetween = (newer: string, older: string) => Math.floor(
  (new Date(`${newer}T12:00:00Z`).getTime() - new Date(`${older}T12:00:00Z`).getTime()) / 86_400_000,
);

export function scheduledReportDate(date: string, time: string, reportTime: string) {
  const dueDate = time < reportTime ? previousDate(date) : date;
  return reportTime < "12:00" ? previousDate(dueDate) : dueDate;
}

export async function readBranchStatus(branchId: string) {
  await ensureTables();
  const row = await db().prepare(
    "SELECT last_sent_date, last_sent_at FROM telegram_branch_status WHERE branch_id = ?",
  )
    .bind(branchId)
    .first<{ last_sent_date: string; last_sent_at: string }>();
  return {
    lastSentDate: row?.last_sent_date || "",
    lastSentAt: row?.last_sent_at || "",
  };
}

export async function writeBranchStatus(branchId: string, lastSentDate: string, lastSentAt: string) {
  await ensureTables();
  await db().prepare(`INSERT INTO telegram_branch_status (branch_id, last_sent_date, last_sent_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(branch_id) DO UPDATE SET
        last_sent_date = excluded.last_sent_date,
        last_sent_at = excluded.last_sent_at,
        updated_at = CURRENT_TIMESTAMP`)
    .bind(branchId, lastSentDate, lastSentAt)
    .run();
}

export async function readState(branchId: string): Promise<StateShape> {
  const current = await readHaloStateWithRecurringExpenses(branchId);
  return current.state as StateShape;
}

function buildOrderPlan(state: StateShape, reportDate: string) {
  const inventory = (Array.isArray(state.inventory) ? state.inventory : []).filter(item => !isExpenseOnlyInventory(item));
  const recipes = Array.isArray(state.recipes) ? state.recipes : [];
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  const sales = Array.isArray(state.sales) ? state.sales : [];
  const recentSales = sales.filter((sale) => {
    const age = daysBetween(reportDate, String(sale.date || ""));
    return age >= 0 && age < 7;
  });
  const usage = new Map<string, number>();
  recentSales.forEach((sale) => {
    const recipe = recipes.find((entry) => entry.id === sale.recipeId);
    const stockUsage = Array.isArray(sale.stockUsage)
      ? sale.stockUsage
      : (recipe?.ingredients || []).filter((ingredient) => Boolean(ingredient.inventoryId)).map((ingredient) => ({
          inventoryId: ingredient.inventoryId,
          quantity: Number(ingredient.quantity || 0) * Number(sale.quantity || 0),
        }));
    stockUsage.forEach((item) => {
      if (!item.inventoryId) return;
      usage.set(item.inventoryId, (usage.get(item.inventoryId) || 0) + Number(item.quantity || 0));
    });
  });

  const items = inventory.map((item) => {
    const dailyUsage = (usage.get(String(item.id || "")) || 0) / 7;
    const stock = Number(item.stock || 0);
    const minimum = Number(item.minStock || 0);
    const daysLeft = dailyUsage > 0 ? stock / dailyUsage : null;
    const target = Math.max(minimum * 2, Math.ceil(dailyUsage * 7));
    const shouldBuy = stock <= minimum || (daysLeft !== null && daysLeft <= 3);
    return {
      id: String(item.id || ""),
      name: item.name || "Noma’lum mahsulot",
      unit: item.unit || "dona",
      supplierId: String(item.supplierId || ""),
      buyQuantity: shouldBuy ? Math.max(0, target - stock) : 0,
      daysLeft,
    };
  }).filter((item) => item.buyQuantity > 0);

  const groups = suppliers.filter((supplier) => !isMezanaSupplierName(supplier.name)).map((supplier) => ({
    supplier,
    items: items.filter((item) => item.supplierId && item.supplierId === supplier.id),
  })).filter((group) => group.items.length);
  const unassigned = items.filter((item) => !suppliers.some((supplier) => supplier.id === item.supplierId));
  return { items, groups, unassigned };
}

function makeSupplierOrderMessage(
  supplierName: string,
  reportDate: string,
  items: Array<{ name: string; unit: string; buyQuantity: number }>,
) {
  return [
    "🛒 HALO | BUYURTMA",
    `📅 ${displayDate(reportDate)}`,
    `🏪 Yetkazib beruvchi: ${supplierName}`,
    "",
    ...items.map((item) => `• ${item.name}: ${Math.ceil(item.buyQuantity).toLocaleString("en-US")} ${item.unit}`),
    "",
    "Iltimos, buyurtmani qabul qilganingizni tasdiqlang.",
  ].join("\n");
}

/** Kunlik hisobot boshidagi "DIQQAT" bloki: faqat istisnolar (istisno bo'yicha boshqarish). */
export function controlAlertLines(state: StateShape, reportDate: string): string[] {
  const [year, month, day] = reportDate.split("-").map(Number);
  // Hisobot kuni ham tekshirilsin: "bugun" sifatida keyingi kun beriladi.
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const audit = auditBusinessState(state as Parameters<typeof auditBusinessState>[0], { today: nextDay });
  const shown = audit.issues
    .filter((issue) => issue.severity === "error" || issue.code === "stock_count_shortage")
    .slice(0, 5)
    .map((issue) => `${issue.severity === "error" ? "🔴" : "🟡"} ${issue.title}${issue.examples[0] ? ` — ${issue.examples[0]}` : ""}`);
  return shown.length
    ? ["🚦 DIQQAT", ...shown, ...(audit.issues.length > shown.length ? [`… yana ${audit.issues.length - shown.length} ta tekshiruv — HALO Control’da.`] : [])]
    : ["🟢 Kritik farq yo‘q — kassa, ombor va qarzlar tekshirildi."];
}

export function makeReport(state: StateShape, reportDate: string) {
  const inventory = (Array.isArray(state.inventory) ? state.inventory : []).filter(item => !isExpenseOnlyInventory(item));
  const recipes = Array.isArray(state.recipes) ? state.recipes : [];
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  const sales = Array.isArray(state.sales) ? state.sales : [];
  const accounts = Array.isArray(state.accounts) ? state.accounts : [];
  const closes = Array.isArray(state.dailyCloses) ? state.dailyCloses : [];
  const fixedExpenses = Array.isArray(state.fixedExpenses) ? state.fixedExpenses : [];
  const daySales = sales.filter((sale) => sale.date === reportDate);
  const daily = calculateDailyReport(state, reportDate);
  const { revenue, cost, netProfit, margin, itemCount } = daily;
  const inventoryValue = inventory.reduce(
    (sum, item) => sum + Number(item.stock || 0) * Number(item.unitCost || 0),
    0,
  );
  const debt = suppliers
    .filter((supplier) => !isMezanaSupplierName(supplier.name))
    .reduce((sum, supplier) => sum + Math.max(0, Number(supplier.balance || 0)), 0);
  const lowStock = inventory.filter((item) => Number(item.stock || 0) <= Number(item.minStock || 0));
  const dueExpenses = fixedExpenses.filter((expense) => expense.active && String(expense.nextDue || "") <= reportDate);
  const orderPlan = buildOrderPlan(state, reportDate);

  const recipeTotals = new Map<string, number>();
  daySales.forEach((sale) => {
    if (!sale.recipeId) return;
    recipeTotals.set(sale.recipeId, (recipeTotals.get(sale.recipeId) || 0) + Number(sale.quantity || 0));
  });
  const top = [...recipeTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const topName = top
    ? recipes.find((recipe) => recipe.id === top[0])?.name || "Noma’lum taom"
    : "Savdo kiritilmagan";

  const balanceProjection = calculateAccountBalances(state, reportDate);
  const accountLines = accounts.map(account => ({ name: account.name || "Hisob", balance: balanceProjection.balances.get(String(account.id)) || 0 }));
  const accountTotal = accountLines.reduce((sum, account) => sum + account.balance, 0);
  const close = closes.find((entry) => entry.date === reportDate);

  const text = [
    "📊 HALO | KUNLIK HISOBOT",
    `📅 ${displayDate(reportDate)}`,
    "🕛 Hisob oralig‘i: 00:00–23:59",
    "",
    ...controlAlertLines(state, reportDate),
    "",
    "💰 MOLIYA",
    `Savdo: ${won(revenue)}`,
    `Tannarx: −${won(cost)}`,
    `Jami xarajat: ${formatExpenseEffectWon(daily.totalExpenses)}`,
    `  Qo‘lda kiritilgan: ${formatExpenseEffectWon(daily.enteredExpenses)}`,
    `  Oylik avtomatik: ${formatExpenseEffectWon(daily.recurringExpenses)}`,
    `  Maosh: ${formatExpenseEffectWon(daily.payroll)}`,
    `  Taxminiy soliq zaxirasi va komissiya: ${formatExpenseEffectWon(daily.tax + daily.cardCommission + daily.deliveryCommission)}`,
    `Hisobiy foyda: ${won(netProfit)}`,
    `Sof marja: ${margin.toFixed(1)}%`,
    "",
    "🧾 SAVDO",
    `Jami haqiqiy savdo: ${itemCount.toLocaleString("en-US")} ta`,
    `Nosavdo ombor chiqimi: ${daily.inventoryOnlyItemCount.toLocaleString("en-US")} porsiya · tannarx ${won(daily.inventoryOnlyCost)}`,
    `TOP taom: ${topName}${top ? ` — ${top[1].toLocaleString("en-US")} ta` : ""}`,
    "",
    "🏦 HISOBLAR",
    ...accountLines.map((account) => `${account.name}: ${won(account.balance)}`),
    `Jami pul${balanceProjection.unmatched.length ? " (to‘liq emas)" : ""}: ${won(accountTotal)}`,
    ...(balanceProjection.unmatched.length ? [`⚠️ ${balanceProjection.unmatched.length} ta yozuvning pul hisobi topilmadi; hisobotni tekshiring.`] : []),
    "",
    "📦 NAZORAT",
    `Ombor qiymati: ${won(inventoryValue)}`,
    `Kam qolgan mahsulot: ${lowStock.length} ta`,
    `Yetkazib beruvchi qarzi: ${won(debt)}`,
    `Muddati kelgan xarajat: ${dueExpenses.length} ta`,
    "",
    "🛒 XARID TAVSIYASI",
    ...(orderPlan.items.length ? orderPlan.groups.flatMap((group) => [
      `${group.supplier.name || "Yetkazib beruvchi"}:`,
      ...group.items.map((item) => `• ${item.name}: ${Math.ceil(item.buyQuantity).toLocaleString("en-US")} ${item.unit}`),
    ]) : ["Bugun buyurtma kerak emas."]),
    ...(orderPlan.unassigned.length ? [
      "Yetkazib beruvchisi belgilanmagan:",
      ...orderPlan.unassigned.map((item) => `• ${item.name}: ${Math.ceil(item.buyQuantity).toLocaleString("en-US")} ${item.unit}`),
    ] : []),
    `Alohida buyurtma yuborish mumkin: ${orderPlan.groups.filter((group) => group.supplier.autoOrder && group.supplier.telegramChatId).length} ta`,
    "",
    close
      ? `✅ Kun yopildi · kassa farqi: ${won(Number(close.difference || 0))}`
      : "⚠️ Kun hali yopilmagan",
  ].join("\n");
  return { text: text.length > 3800 ? text.slice(0, 3740) + "\n…To‘liq tafsilotlar HALO Control’da." : text, orderPlan };
}

export async function telegramCall<T>(botToken: string, method: string, payload?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json() as { ok?: boolean; description?: string; result?: T };
  if (!response.ok || !result.ok) throw new Error(result.description || "Telegram bilan ulanish amalga oshmadi.");
  return result.result;
}

export async function saveMezanaDestination(
  branchId: string,
  destination: "borrowed" | "purchased",
  chatId: string,
  chatName = "",
  threadId = 0,
) {
  return mutateHaloState((state) => {
    const current = normalizeMezanaSettings(state.mezanaSettings);
    const mezanaSettings = normalizeMezanaSettings({
      ...current,
      ...(destination === "purchased" ? {
        purchasedTelegramChatId: chatId,
        purchasedTelegramChatName: chatName,
        purchasedTelegramThreadId: threadId,
      } : {
        telegramChatId: chatId,
        telegramChatName: chatName,
        telegramThreadId: threadId,
      }),
    });
    return { state: { ...state, mezanaSettings }, result: mezanaSettings };
  }, 5, branchId, "Rahbar", "MEZANA Telegram guruhi yangilandi", "MEZANA");
}

async function sendTelegramPhotos(
  botToken: string,
  chatId: string,
  threadId: number,
  caption: string,
  files: Array<{ blob: Blob; fileName: string }>,
) {
  const payload = new FormData();
  payload.set("chat_id", chatId);
  if (threadId > 0) payload.set("message_thread_id", String(threadId));
  let endpoint = "sendPhoto";
  if (files.length === 1) {
    payload.set("caption", caption);
    payload.set("photo", files[0].blob, files[0].fileName);
  } else {
    endpoint = "sendMediaGroup";
    payload.set("media", JSON.stringify(files.map((_file, index) => ({
      type: "photo",
      media: `attach://photo${index}`,
      ...(index === 0 ? { caption } : {}),
    }))));
    files.forEach((file, index) => payload.set(`photo${index}`, file.blob, file.fileName));
  }
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
    method: "POST",
    body: payload,
  });
  const result = await response.json() as { ok?: boolean; description?: string };
  if (!response.ok || !result.ok) throw new Error(result.description || "MEZANA guruhiga yuborilmadi.");
}

export async function resendLatestMezanaEntry(settings: TelegramSettings, state: StateShape) {
  if (!settings.botToken) throw new Error("Avval HALO Telegram botini ulang.");
  const mezanaSettings = normalizeMezanaSettings(state.mezanaSettings);
  const entries = normalizeMezanaDebtEntries(state.mezanaEntries)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const entry = entries[0];
  if (!entry) throw new Error("Qayta yuboriladigan MEZANA yozuvi topilmadi.");
  const destination = mezanaTelegramDestination(mezanaSettings, entry.action);
  if (!destination.chatId) throw new Error("Avval bu amal uchun MEZANA Telegram guruhini ulang.");
  const message = buildMezanaDebtTelegramMessage({
    action: entry.action,
    date: entry.date,
    workerName: entry.createdByName,
    productName: entry.productName,
    amount: entry.amount,
    quantity: entry.quantity,
    currentBalance: Math.max(0, mezanaDebtBalance(entries)),
    currentBorrowedQuantity: Math.max(0, mezanaBorrowedQuantityBalance(entries, entry.productName)),
    note: entry.note,
  });
  if (!entry.documents.length) {
    await telegramCall(settings.botToken, "sendMessage", {
      chat_id: destination.chatId,
      text: message,
      ...(destination.threadId > 0 ? { message_thread_id: destination.threadId } : {}),
    });
    return entry;
  }
  const storage = globalThis.__HALO_CONTROL_BUCKET__;
  if (!storage) throw new Error("MEZANA rasmlari ombori ulanmagan.");
  const objects = await Promise.all(entry.documents.map((document) => storage.get(document.key)));
  if (objects.some((object) => !object)) throw new Error("MEZANA yozuvining rasmi topilmadi.");
  const files = await Promise.all(objects.map(async (object, index) => ({
    blob: new Blob([await object!.arrayBuffer()], { type: entry.documents[index].contentType }),
    fileName: entry.documents[index].fileName,
  })));
  await sendTelegramPhotos(
    settings.botToken,
    destination.chatId,
    destination.threadId,
    message,
    files,
  );
  return entry;
}

export async function sendSupplierOrders(settings: TelegramSettings, state: StateShape, reportDate: string) {
  if (!settings.botToken) throw new Error("Avval Telegram botni ulang.");
  const plan = buildOrderPlan(state, reportDate);
  let sent = 0;
  let failed = 0;
  for (const group of plan.groups) {
    if (!group.supplier.autoOrder || !group.supplier.telegramChatId) continue;
    try {
      await telegramCall(settings.botToken, "sendMessage", {
        chat_id: group.supplier.telegramChatId,
        text: makeSupplierOrderMessage(group.supplier.name || "Yetkazib beruvchi", reportDate, group.items),
        disable_web_page_preview: true,
      });
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  const ready = plan.groups.filter((group) => group.supplier.autoOrder && group.supplier.telegramChatId).length;
  return {
    sent,
    failed,
    skipped: Math.max(0, plan.groups.length - ready) + (plan.unassigned.length ? 1 : 0),
    itemCount: plan.items.length,
  };
}

export async function sendReport(
  settings: TelegramSettings,
  reportDate: string,
  branchId: string,
  sendOrders = false,
  markFinal = false,
) {
  if (!settings.botToken || !settings.chatId) throw new Error("Avval Telegram botni ulang.");
  const state = await readState(branchId);
  const { text } = makeReport(state, reportDate);
  await telegramCall(settings.botToken, "sendMessage", {
    chat_id: settings.chatId,
    text,
    disable_web_page_preview: true,
  });
  const orderResult = sendOrders
    ? await sendSupplierOrders(settings, state, reportDate)
    : { sent: 0, failed: 0, skipped: 0, itemCount: 0 };
  const sentAt = new Date().toISOString();
  const currentStatus = await readBranchStatus(branchId);
  await writeBranchStatus(
    branchId,
    markFinal ? reportDate : currentStatus.lastSentDate,
    sentAt,
  );
  return { text, sentAt, orderResult, final: markFinal };
}

export function publicSettings(settings: TelegramSettings, status?: { lastSentDate: string; lastSentAt: string }) {
  return {
    configured: Boolean(settings.botToken && settings.chatId),
    tokenSaved: Boolean(settings.botToken),
    chatId: settings.chatId,
    botName: settings.botName,
    enabled: settings.enabled,
    reportTime: settings.reportTime,
    lastSentDate: status?.lastSentDate || "",
    lastSentAt: status?.lastSentAt || "",
  };
}

