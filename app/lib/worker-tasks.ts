import {
  buildKitchenRulesTelegramMessage,
  MAX_KITCHEN_RULE_MESSAGES_PER_SHIFT,
  normalizeKitchenRuleReminderHours,
  normalizeKitchenRules,
} from "./kitchen-rules";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

const CHANNELS_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_channels (
  worker_id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL DEFAULT '',
  telegram_chat_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const TASKS_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  telegram_status TEXT NOT NULL DEFAULT 'pending',
  telegram_sent_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT 'Rahbar',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT NOT NULL DEFAULT '',
  cancel_reason TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT NOT NULL DEFAULT ''
)`;

const TELEGRAM_LINKS_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_telegram_links (
  worker_id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const TELEGRAM_SYNC_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_telegram_sync (
  id TEXT PRIMARY KEY NOT NULL,
  next_update_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const TELEGRAM_SETTINGS_SQL = `CREATE TABLE IF NOT EXISTS telegram_settings (
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

const TASK_MIGRATIONS_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_task_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

const KITCHEN_RULE_REMINDERS_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_rule_reminders (
  branch_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (branch_id, worker_id, shift_id)
)`;

export type WorkerAssignedTask = {
  id: string;
  branchId: string;
  workerId: string;
  workerName: string;
  title: string;
  description: string;
  priority: "normal" | "important" | "urgent";
  dueAt: string;
  status: "new" | "started" | "done" | "cancelled";
  telegramStatus: "sent" | "not-linked" | "not-configured" | "failed" | "pending";
  telegramSentAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  cancelReason: string;
  cancelledAt: string;
};

function d1() {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Database unavailable");
  return globalThis.__HALO_CONTROL_DB__;
}

function safeBranchId(value: string) {
  const branchId = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)) throw new Error("Noto‘g‘ri filial.");
  return branchId;
}

function cleanText(value: string, max: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function taskFromRow(row: {
  id: string;
  branch_id: string;
  worker_id: string;
  worker_name?: string;
  title: string;
  description: string;
  priority: string;
  due_at: string;
  status: string;
  telegram_status: string;
  telegram_sent_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string;
  cancel_reason?: string;
  cancelled_at?: string;
}): WorkerAssignedTask {
  return {
    id: row.id,
    branchId: row.branch_id,
    workerId: row.worker_id,
    workerName: row.worker_name || "",
    title: row.title,
    description: row.description || "",
    priority: row.priority as WorkerAssignedTask["priority"],
    dueAt: row.due_at || "",
    status: row.status as WorkerAssignedTask["status"],
    telegramStatus: row.telegram_status as WorkerAssignedTask["telegramStatus"],
    telegramSentAt: row.telegram_sent_at || "",
    createdBy: row.created_by || "Rahbar",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || "",
    cancelReason: row.cancel_reason || "",
    cancelledAt: row.cancelled_at || "",
  };
}

// An unresolved Promise cannot safely cross Cloudflare request contexts.
let workerTaskTablesReady = false;

async function initializeWorkerTaskTables() {
  const database = d1();
  await database.batch([
    database.prepare(CHANNELS_SQL),
    database.prepare(TASKS_SQL),
    database.prepare(TELEGRAM_LINKS_SQL),
    database.prepare(TELEGRAM_SYNC_SQL),
    database.prepare(TELEGRAM_SETTINGS_SQL),
    database.prepare(TASK_MIGRATIONS_SQL),
    database.prepare(KITCHEN_RULE_REMINDERS_SQL),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS halo_worker_tasks_branch_worker ON halo_worker_tasks (branch_id, worker_id, status)",
    ),
  ]);
  const taskColumns = await database.prepare("PRAGMA table_info(halo_worker_tasks)").all<{ name: string }>();
  const taskColumnNames = new Set((taskColumns.results || []).map((column) => column.name));
  if (!taskColumnNames.has("cancel_reason")) {
    await database.prepare("ALTER TABLE halo_worker_tasks ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT ''").run();
  }
  if (!taskColumnNames.has("cancelled_at")) {
    await database.prepare("ALTER TABLE halo_worker_tasks ADD COLUMN cancelled_at TEXT NOT NULL DEFAULT ''").run();
  }
  const clearOldMessages = await d1().prepare(
    "INSERT OR IGNORE INTO halo_worker_task_migrations (id) VALUES (?)",
  ).bind("clear-old-worker-messages-2026-08-13-v1").run();
  if (clearOldMessages.meta.changes) {
    try {
      await d1().prepare("DELETE FROM halo_worker_tasks").run();
    } catch (error) {
      await d1().prepare("DELETE FROM halo_worker_task_migrations WHERE id = ?")
        .bind("clear-old-worker-messages-2026-08-13-v1")
        .run();
      throw error;
    }
  }
}

export async function ensureWorkerTaskTables() {
  if (workerTaskTablesReady) return;
  await initializeWorkerTaskTables();
  workerTaskTablesReady = true;
}

async function workerRow(workerId: string, branchId: string) {
  return d1().prepare(
    `SELECT u.id, u.name, u.active, c.telegram_chat_id, c.telegram_chat_name
      FROM halo_worker_users u
      LEFT JOIN halo_worker_channels c ON c.worker_id = u.id
      WHERE u.id = ? AND u.branch_id = ?`,
  ).bind(workerId, safeBranchId(branchId)).first<{
    id: string;
    name: string;
    active: number;
    telegram_chat_id: string | null;
    telegram_chat_name: string | null;
  }>();
}

export async function listAdminWorkerTasks(branchId: string) {
  await ensureWorkerTaskTables();
  const rows = await d1().prepare(
    `SELECT t.*, u.name AS worker_name
      FROM halo_worker_tasks t
      JOIN halo_worker_users u ON u.id = t.worker_id
      WHERE t.branch_id = ?
      ORDER BY CASE t.status WHEN 'new' THEN 0 WHEN 'started' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
        t.created_at DESC
      LIMIT 500`,
  ).bind(safeBranchId(branchId)).all<Parameters<typeof taskFromRow>[0]>();
  return (rows.results || []).map(taskFromRow);
}

export async function listWorkerTasks(workerId: string, branchId: string) {
  await ensureWorkerTaskTables();
  const rows = await d1().prepare(
    `SELECT t.*, u.name AS worker_name
      FROM halo_worker_tasks t
      JOIN halo_worker_users u ON u.id = t.worker_id
      WHERE t.branch_id = ? AND t.worker_id = ? AND t.status != 'cancelled'
      ORDER BY CASE t.status WHEN 'new' THEN 0 WHEN 'started' THEN 1 ELSE 2 END,
        t.created_at DESC
      LIMIT 200`,
  ).bind(safeBranchId(branchId), workerId).all<Parameters<typeof taskFromRow>[0]>();
  return (rows.results || []).map(taskFromRow);
}

async function telegramSettings() {
  await ensureWorkerTaskTables();
  return d1().prepare(
    "SELECT bot_token, bot_name FROM telegram_settings WHERE id = 'main'",
  ).first<{ bot_token: string; bot_name: string }>();
}

async function telegramCall<T>(token: string, method: string, payload?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const value = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !value.ok) throw new Error(value.description || "Telegram bilan aloqa bo‘lmadi.");
  return value.result;
}

export async function maybeSendWorkerKitchenRules(input: {
  workerId: string;
  branchId: string;
  workerName: string;
  shiftId: string;
  rules: unknown;
  reminderHours: unknown;
  force?: boolean;
  now?: Date;
}) {
  await ensureWorkerTaskTables();
  const branchId = safeBranchId(input.branchId);
  const shiftId = input.shiftId.trim().slice(0, 120);
  if (!shiftId) return { sent: false, reason: "Smena topilmadi." };
  const rules = normalizeKitchenRules(input.rules);
  if (!rules.length) return { sent: false, reason: "Oshxona qoidalari kiritilmagan." };

  const [worker, settings, reminder] = await Promise.all([
    workerRow(input.workerId, branchId),
    telegramSettings(),
    d1().prepare(
      `SELECT sent_count, last_sent_at FROM halo_worker_rule_reminders
        WHERE branch_id = ? AND worker_id = ? AND shift_id = ?`,
    ).bind(branchId, input.workerId, shiftId).first<{ sent_count: number; last_sent_at: string }>(),
  ]);
  if (!settings?.bot_token) return { sent: false, reason: "Telegram bot hali ulanmagan." };
  if (!worker?.telegram_chat_id) return { sent: false, reason: "Xodimning Telegrami ulanmagan." };

  const now = input.now || new Date();
  const sentCount = Number(reminder?.sent_count || 0);
  if (sentCount >= MAX_KITCHEN_RULE_MESSAGES_PER_SHIFT) {
    return { sent: false, reason: "Smena uchun eslatma limiti tugagan." };
  }
  if (input.force && sentCount > 0) return { sent: false, reason: "Boshlanish xabari oldin yuborilgan." };
  const lastSentMs = Date.parse(reminder?.last_sent_at || "");
  const intervalMs = normalizeKitchenRuleReminderHours(input.reminderHours) * 60 * 60_000;
  if (!input.force && Number.isFinite(lastSentMs) && now.getTime() - lastSentMs < intervalMs) {
    return { sent: false, reason: "Keyingi eslatma vaqti kelmagan." };
  }

  const repeat = sentCount > 0;
  const sentAt = now.toISOString();
  const previousSentAt = reminder?.last_sent_at || "";
  const claim = reminder
    ? await d1().prepare(
        `UPDATE halo_worker_rule_reminders
          SET sent_count = sent_count + 1, last_sent_at = ?
          WHERE branch_id = ? AND worker_id = ? AND shift_id = ?
            AND sent_count = ? AND last_sent_at = ?`,
      ).bind(sentAt, branchId, input.workerId, shiftId, sentCount, previousSentAt).run()
    : await d1().prepare(
        `INSERT OR IGNORE INTO halo_worker_rule_reminders
          (branch_id, worker_id, shift_id, sent_count, last_sent_at)
          VALUES (?, ?, ?, 1, ?)`,
      ).bind(branchId, input.workerId, shiftId, sentAt).run();
  if (!claim.meta.changes) return { sent: false, reason: "Eslatmani boshqa so‘rov yubormoqda." };

  try {
    await telegramCall(settings.bot_token, "sendMessage", {
      chat_id: worker.telegram_chat_id,
      text: buildKitchenRulesTelegramMessage(input.workerName || worker.name, rules, repeat),
      disable_web_page_preview: true,
    });
  } catch (error) {
    if (reminder) {
      await d1().prepare(
        `UPDATE halo_worker_rule_reminders
          SET sent_count = ?, last_sent_at = ?
          WHERE branch_id = ? AND worker_id = ? AND shift_id = ?
            AND sent_count = ? AND last_sent_at = ?`,
      ).bind(
        sentCount,
        previousSentAt,
        branchId,
        input.workerId,
        shiftId,
        sentCount + 1,
        sentAt,
      ).run();
    } else {
      await d1().prepare(
        `DELETE FROM halo_worker_rule_reminders
          WHERE branch_id = ? AND worker_id = ? AND shift_id = ?
            AND sent_count = 1 AND last_sent_at = ?`,
      ).bind(branchId, input.workerId, shiftId, sentAt).run();
    }
    throw error;
  }
  return { sent: true, sentAt, repeat };
}

function taskMessage(task: WorkerAssignedTask, workerName: string, branchName: string, workerUrl: string) {
  const priority = task.priority === "urgent"
    ? "🔴 Shoshilinch"
    : task.priority === "important"
      ? "🟡 Muhim"
      : "🟢 Oddiy";
  return [
    "📋 HALO | YANGI VAZIFA",
    "",
    `👤 Xodim: ${workerName}`,
    `🏪 Filial: ${branchName}`,
    `⚡ Muhimlik: ${priority}`,
    task.dueAt ? `⏰ Muddat: ${task.dueAt.replace("T", " ")}` : "⏰ Muddat: belgilanmagan",
    "",
    `✅ ${task.title}`,
    task.description || "Qo‘shimcha izoh yo‘q.",
    "",
    `Vazifani ko‘rish: ${workerUrl}`,
  ].join("\n");
}

export async function sendWorkerTask(
  taskId: string,
  branchName: string,
  workerUrl: string,
) {
  await ensureWorkerTaskTables();
  const row = await d1().prepare(
    `SELECT t.*, u.name AS worker_name, c.telegram_chat_id
      FROM halo_worker_tasks t
      JOIN halo_worker_users u ON u.id = t.worker_id
      LEFT JOIN halo_worker_channels c ON c.worker_id = t.worker_id
      WHERE t.id = ?`,
  ).bind(taskId).first<Parameters<typeof taskFromRow>[0] & { telegram_chat_id: string | null }>();
  if (!row) throw new Error("Vazifa topilmadi.");
  const settings = await telegramSettings();
  if (!settings?.bot_token) {
    await d1().prepare(
      "UPDATE halo_worker_tasks SET telegram_status = 'not-configured', updated_at = ? WHERE id = ?",
    ).bind(new Date().toISOString(), taskId).run();
    return { sent: false, reason: "Telegram bot hali ulanmagan." };
  }
  if (!row.telegram_chat_id) {
    await d1().prepare(
      "UPDATE halo_worker_tasks SET telegram_status = 'not-linked', updated_at = ? WHERE id = ?",
    ).bind(new Date().toISOString(), taskId).run();
    return { sent: false, reason: "Xodimning Telegrami ulanmagan." };
  }
  try {
    const task = taskFromRow(row);
    await telegramCall(settings.bot_token, "sendMessage", {
      chat_id: row.telegram_chat_id,
      text: taskMessage(task, row.worker_name || "Xodim", branchName, workerUrl),
      disable_web_page_preview: true,
    });
    const sentAt = new Date().toISOString();
    await d1().prepare(
      "UPDATE halo_worker_tasks SET telegram_status = 'sent', telegram_sent_at = ?, updated_at = ? WHERE id = ?",
    ).bind(sentAt, sentAt, taskId).run();
    return { sent: true, sentAt };
  } catch (error) {
    await d1().prepare(
      "UPDATE halo_worker_tasks SET telegram_status = 'failed', updated_at = ? WHERE id = ?",
    ).bind(new Date().toISOString(), taskId).run();
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "Telegram xabari yuborilmadi.",
    };
  }
}

export async function createWorkerTask(input: {
  branchId: string;
  workerId: string;
  title: string;
  description: string;
  priority: string;
  dueAt: string;
  createdBy: string;
}) {
  await ensureWorkerTaskTables();
  const branchId = safeBranchId(input.branchId);
  const worker = await workerRow(input.workerId, branchId);
  if (!worker?.active) throw new Error("Faol xodimni tanlang.");
  const title = cleanText(input.title, 120);
  if (title.length < 2) throw new Error("Vazifa nomini kiriting.");
  const description = cleanText(input.description, 1_000);
  const priority = ["normal", "important", "urgent"].includes(input.priority)
    ? input.priority
    : "normal";
  const dueAt = input.dueAt.trim().slice(0, 19);
  const createdAt = new Date().toISOString();
  const taskId = crypto.randomUUID();
  await d1().prepare(
    `INSERT INTO halo_worker_tasks
      (id, branch_id, worker_id, title, description, priority, due_at, status,
        telegram_status, telegram_sent_at, created_by, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'pending', '', ?, ?, ?, '')`,
  ).bind(
    taskId,
    branchId,
    input.workerId,
    title,
    description,
    priority,
    dueAt,
    cleanText(input.createdBy || "Rahbar", 80) || "Rahbar",
    createdAt,
    createdAt,
  ).run();
  return taskId;
}

export async function createWorkerTasks(input: {
  branchId: string;
  workerIds: string[];
  title: string;
  description: string;
  priority: string;
  dueAt: string;
  createdBy: string;
}) {
  await ensureWorkerTaskTables();
  const branchId = safeBranchId(input.branchId);
  const workerIds = [...new Set(input.workerIds.map((value) => value.trim()).filter(Boolean))].slice(0, 50);
  if (!workerIds.length) throw new Error("Kamida bitta faol hodimni tanlang.");
  if (workerIds.some((workerId) => workerId.length > 80)) throw new Error("Hodim tanlovini tekshiring.");
  const placeholders = workerIds.map(() => "?").join(", ");
  const workers = await d1().prepare(
    `SELECT id FROM halo_worker_users
      WHERE branch_id = ? AND active = 1 AND id IN (${placeholders})`,
  ).bind(branchId, ...workerIds).all<{ id: string }>();
  const activeIds = new Set((workers.results || []).map((worker) => worker.id));
  if (activeIds.size !== workerIds.length) throw new Error("Tanlangan hodimlardan biri faol emas.");

  const title = cleanText(input.title, 120);
  if (title.length < 2) throw new Error("Vazifa nomini kiriting.");
  const description = cleanText(input.description, 1_000);
  const priority = ["normal", "important", "urgent"].includes(input.priority)
    ? input.priority
    : "normal";
  const dueAt = input.dueAt.trim().slice(0, 19);
  const createdBy = cleanText(input.createdBy || "Rahbar", 80) || "Rahbar";
  const createdAt = new Date().toISOString();
  const taskIds = workerIds.map((workerId) => ({ workerId, taskId: crypto.randomUUID() }));
  await d1().batch(taskIds.map(({ workerId, taskId }) => d1().prepare(
    `INSERT INTO halo_worker_tasks
      (id, branch_id, worker_id, title, description, priority, due_at, status,
        telegram_status, telegram_sent_at, created_by, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'pending', '', ?, ?, ?, '')`,
  ).bind(
    taskId,
    branchId,
    workerId,
    title,
    description,
    priority,
    dueAt,
    createdBy,
    createdAt,
    createdAt,
  )));
  return taskIds;
}

export async function setWorkerTaskStatus(
  taskId: string,
  workerId: string,
  branchId: string,
  status: string,
) {
  await ensureWorkerTaskTables();
  if (!["started", "done"].includes(status)) throw new Error("Noto‘g‘ri vazifa holati.");
  const now = new Date().toISOString();
  const allowedPrevious = status === "started" ? "status = 'new'" : "status IN ('new', 'started')";
  const result = await d1().prepare(
    `UPDATE halo_worker_tasks
      SET status = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND worker_id = ? AND branch_id = ? AND ${allowedPrevious}`,
  ).bind(
    status,
    status === "done" ? now : "",
    now,
    taskId,
    workerId,
    safeBranchId(branchId),
  ).run();
  if (!result.meta.changes) throw new Error("Vazifa topilmadi.");
}

export async function cancelWorkerTask(taskId: string, branchId: string, reason: string) {
  await ensureWorkerTaskTables();
  const cleanReason = cleanText(reason, 500);
  if (!cleanReason) throw new Error("Bekor qilish sababini yozing.");
  const now = new Date().toISOString();
  const result = await d1().prepare(
    `UPDATE halo_worker_tasks SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?, updated_at = ?
      WHERE id = ? AND branch_id = ? AND status != 'done'`,
  ).bind(cleanReason, now, now, taskId, safeBranchId(branchId)).run();
  if (!result.meta.changes) throw new Error("Vazifani bekor qilib bo‘lmadi.");
}

export async function clearWorkerTaskHistory(branchId: string) {
  await ensureWorkerTaskTables();
  const result = await d1().prepare(
    `DELETE FROM halo_worker_tasks
      WHERE branch_id = ? AND status = 'done'`,
  ).bind(safeBranchId(branchId)).run();
  return Number(result.meta.changes || 0);
}

export async function setWorkerTelegram(
  workerId: string,
  branchId: string,
  chatId: string,
  chatName: string,
) {
  await ensureWorkerTaskTables();
  const worker = await workerRow(workerId, branchId);
  if (!worker) throw new Error("Xodim topilmadi.");
  const safeChatId = chatId.trim();
  if (!/^-?\d{4,20}$/.test(safeChatId)) throw new Error("Telegram Chat ID noto‘g‘ri.");
  await d1().prepare(
    `INSERT INTO halo_worker_channels
      (worker_id, branch_id, telegram_chat_id, telegram_chat_name, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(worker_id) DO UPDATE SET
        branch_id = excluded.branch_id,
        telegram_chat_id = excluded.telegram_chat_id,
        telegram_chat_name = excluded.telegram_chat_name,
        updated_at = excluded.updated_at`,
  ).bind(
    workerId,
    safeBranchId(branchId),
    safeChatId,
    cleanText(chatName, 80),
    new Date().toISOString(),
  ).run();
}

function randomPairCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getWorkerTelegramStatus(workerId: string, branchId: string) {
  await ensureWorkerTaskTables();
  const worker = await workerRow(workerId, branchId);
  if (!worker) throw new Error("Xodim topilmadi.");
  return {
    linked: Boolean(worker.telegram_chat_id),
    chatName: worker.telegram_chat_name || "",
  };
}

export async function createWorkerTelegramLink(workerId: string, branchId: string) {
  await ensureWorkerTaskTables();
  const worker = await workerRow(workerId, branchId);
  if (!worker?.active) throw new Error("Faol xodim topilmadi.");
  const settings = await telegramSettings();
  if (!settings?.bot_token) throw new Error("Avval HALO Telegram botini ulang.");
  const bot = await telegramCall<{ username?: string; first_name?: string }>(settings.bot_token, "getMe");
  if (!bot?.username) throw new Error("HALO bot username’i topilmadi.");
  const code = randomPairCode();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  await d1().prepare(
    `INSERT INTO halo_worker_telegram_links
      (worker_id, branch_id, code, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(worker_id) DO UPDATE SET
        branch_id = excluded.branch_id,
        code = excluded.code,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at`,
  ).bind(
    workerId,
    safeBranchId(branchId),
    code,
    expiresAt,
    new Date().toISOString(),
  ).run();
  return {
    url: `https://t.me/${bot.username}?start=halo_worker_${code}`,
    botName: `@${bot.username}`,
    expiresAt,
  };
}

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number; first_name?: string; username?: string; title?: string };
  };
};

async function syncWorkerTelegramUpdates(token: string) {
  const state = await d1().prepare(
    "SELECT next_update_id FROM halo_worker_telegram_sync WHERE id = 'main'",
  ).first<{ next_update_id: number }>();
  let offset = Number(state?.next_update_id || 0);
  const now = new Date().toISOString();

  for (let page = 0; page < 5; page += 1) {
    const updates = await telegramCall<TelegramUpdate[]>(token, "getUpdates", {
      offset,
      limit: 100,
      timeout: 0,
      allowed_updates: ["message"],
    });
    if (!updates?.length) break;

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      const text = update.message?.text?.trim() || "";
      const match = text.match(/^\/start(?:@\w+)?\s+halo_worker_([a-f0-9]{24})$/i);
      const chat = update.message?.chat;
      if (!match || !chat?.id) continue;

      const link = await d1().prepare(
        `SELECT l.worker_id, l.branch_id
          FROM halo_worker_telegram_links l
          JOIN halo_worker_users u ON u.id = l.worker_id AND u.branch_id = l.branch_id
          WHERE l.code = ? AND l.expires_at > ? AND u.active = 1`,
      ).bind(match[1].toLowerCase(), now).first<{ worker_id: string; branch_id: string }>();
      if (!link) continue;

      const chatName = chat.title || chat.first_name || chat.username || "Telegram chat";
      await setWorkerTelegram(link.worker_id, link.branch_id, String(chat.id), chatName);
      await d1().prepare(
        "DELETE FROM halo_worker_telegram_links WHERE worker_id = ? AND code = ?",
      ).bind(link.worker_id, match[1].toLowerCase()).run();
      await telegramCall(token, "sendMessage", {
        chat_id: String(chat.id),
        text: "✅ HALO Control: xodim akkauntingiz Telegramga muvaffaqiyatli ulandi.",
      }).catch(() => undefined);
    }

    if (updates.length < 100) break;
  }

  await d1().prepare(
    `INSERT INTO halo_worker_telegram_sync (id, next_update_id, updated_at)
      VALUES ('main', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        next_update_id = excluded.next_update_id,
        updated_at = excluded.updated_at`,
  ).bind(offset, new Date().toISOString()).run();
}

export async function completeWorkerTelegramLink(workerId: string, branchId: string) {
  await ensureWorkerTaskTables();
  const worker = await workerRow(workerId, branchId);
  if (!worker?.active) throw new Error("Faol xodim topilmadi.");
  const link = await d1().prepare(
    "SELECT code, expires_at FROM halo_worker_telegram_links WHERE worker_id = ? AND branch_id = ?",
  ).bind(workerId, safeBranchId(branchId)).first<{ code: string; expires_at: string }>();
  if (!link || link.expires_at <= new Date().toISOString()) {
    throw new Error("Ulash havolasi eskirgan. Yangi havola oling.");
  }
  const settings = await telegramSettings();
  if (!settings?.bot_token) throw new Error("Avval HALO Telegram botini ulang.");
  await syncWorkerTelegramUpdates(settings.bot_token);
  const pending = await d1().prepare(
    "SELECT code FROM halo_worker_telegram_links WHERE worker_id = ? AND branch_id = ?",
  ).bind(workerId, safeBranchId(branchId)).first<{ code: string }>();
  if (pending) {
    throw new Error("Xodim havolani ochib START tugmasini bossin, keyin yana tekshiring.");
  }
  const linked = await workerRow(workerId, branchId);
  if (!linked?.telegram_chat_id) throw new Error("Telegram hali ulanmagan.");
  return {
    chatId: linked.telegram_chat_id,
    chatName: linked.telegram_chat_name || "Telegram chat",
  };
}
