import { applyInventoryCatalogVisibility } from "./inventory-catalog-archive.ts";
import { applyVegetablePurchaseAccounting, migrateVegetableExpenses, preserveVegetableFields } from './vegetable-expenses.ts';
type JsonRecord = Record<string, unknown>;
import { assertIntakePreserved } from "./unified-intake.ts";
import { syncMezanaPosting } from "./mezana-posting.ts";
import { applySaleInventoryAccounting } from "./inventory-accounting.ts";

import { DEFAULT_PRODUCT_CATEGORIES } from "./product-categories";
import { seoulCalendarDate } from "./business-time";
import { reconcileArchivedState } from "./warehouse-consistency.ts";
import {
  DEFAULT_KITCHEN_RULE_REMINDER_HOURS,
  DEFAULT_KITCHEN_RULES,
  normalizeKitchenRuleReminderHours,
  normalizeKitchenRules,
} from "./kitchen-rules";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

export class HaloStateConflictError extends Error {
  constructor() {
    super("HALO ma’lumotlari boshqa qurilmada yangilangan.");
    this.name = "HaloStateConflictError";
  }
}

const STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const BRANCH_TABLE_SQL = `CREATE TABLE IF NOT EXISTS halo_branches (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  archived_reason TEXT NOT NULL DEFAULT '',
  archived_at TEXT NOT NULL DEFAULT '',
  archived_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const MIGRATION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS halo_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const BACKUP_TABLE_SQL = `CREATE TABLE IF NOT EXISTS halo_state_backups (
  id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  payload TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'Rahbar',
  action TEXT NOT NULL DEFAULT 'Ma’lumot yangilandi',
  section TEXT NOT NULL DEFAULT 'Tizim',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const DEFAULT_HALO_STATE = {
  productCategories: DEFAULT_PRODUCT_CATEGORIES,
  accounts: [
    { id: "account-cash", name: "Naqd kassa", type: "cash", openingBalance: 0 },
    { id: "account-bank", name: "Bank", type: "bank", openingBalance: 0 },
    { id: "account-card", name: "Karta / POS", type: "card", openingBalance: 0 },
    { id: "account-delivery", name: "Yetkazib berish", type: "delivery", openingBalance: 0 },
  ],
  inventory: [],
  recipes: [],
  suppliers: [],
  transactions: [],
  supplierDeliveries: [],
  mezanaCatalog: [],
  mezanaEntries: [],
  mezanaSettings: {
    telegramChatId: "",
    telegramChatName: "",
    telegramThreadId: 0,
    purchasedTelegramChatId: "",
    purchasedTelegramChatName: "",
    purchasedTelegramThreadId: 0,
  },
  workerConsumptions: [],
  posOrders: [],
  sales: [],
  stockMovements: [],
  financialEntries: [],
  dailyCloses: [],
  fixedExpenses: [],
  purchaseOrders: [],
  staff: [],
  workShifts: [],
  payrollAdjustments: [],
  attendanceDays: [],
  payrollPayments: [],
  monthlyCloses: [],
  operationChecklistDays: [],
  kitchenRules: [...DEFAULT_KITCHEN_RULES],
  kitchenRuleReminderHours: DEFAULT_KITCHEN_RULE_REMINDER_HOURS,
  deletedItems: [],
  auditLog: [],
  costRules: {
    cardCommissionPct: 0,
    deliveryCommissionPct: 0,
    taxPct: 0,
  },
} satisfies JsonRecord;

export const EMPTY_BRANCH_STATE = {
  productCategories: DEFAULT_PRODUCT_CATEGORIES,
  accounts: DEFAULT_HALO_STATE.accounts,
  inventory: [],
  recipes: [],
  suppliers: [],
  transactions: [],
  supplierDeliveries: [],
  mezanaCatalog: [],
  mezanaEntries: [],
  mezanaSettings: {
    telegramChatId: "",
    telegramChatName: "",
    telegramThreadId: 0,
    purchasedTelegramChatId: "",
    purchasedTelegramChatName: "",
    purchasedTelegramThreadId: 0,
  },
  workerConsumptions: [],
  posOrders: [],
  sales: [],
  stockMovements: [],
  financialEntries: [],
  dailyCloses: [],
  fixedExpenses: [],
  purchaseOrders: [],
  staff: [],
  workShifts: [],
  payrollAdjustments: [],
  attendanceDays: [],
  payrollPayments: [],
  monthlyCloses: [],
  operationChecklistDays: [],
  kitchenRules: [...DEFAULT_KITCHEN_RULES],
  kitchenRuleReminderHours: DEFAULT_KITCHEN_RULE_REMINDER_HOURS,
  deletedItems: [],
  auditLog: [],
  costRules: DEFAULT_HALO_STATE.costRules,
} satisfies JsonRecord;

const REQUIRED_ARRAYS = [
  "productCategories",
  "inventory",
  "recipes",
  "suppliers",
  "transactions",
  "supplierDeliveries",
  "mezanaCatalog",
  "mezanaEntries",
  "workerConsumptions",
  "posOrders",
  "sales",
  "stockMovements",
  "financialEntries",
  "dailyCloses",
  "fixedExpenses",
  "purchaseOrders",
  "staff",
  "workShifts",
  "payrollAdjustments",
  "attendanceDays",
  "payrollPayments",
  "monthlyCloses",
  "operationChecklistDays",
  "deletedItems",
  "auditLog",
] as const;

function d1() {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Database unavailable");
  return globalThis.__HALO_CONTROL_DB__;
}

function revision() {
  return `${new Date().toISOString()}-${crypto.randomUUID()}`;
}

function safeBranchId(value: string) {
  const branchId = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)) {
    throw new Error("Noto‘g‘ri filial.");
  }
  return branchId;
}

export function repairWorkerAttendanceCalendarDates(value: unknown) {
  if (!Array.isArray(value)) return { workShifts: [] as unknown[], changed: 0 };
  let changed = 0;
  const workShifts = value.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const shift = entry as Record<string, unknown>;
    if (shift.source !== "worker") return entry;
    const clockInMs = Date.parse(String(shift.clockIn || ""));
    if (!Number.isFinite(clockInMs)) return entry;
    const calendarDate = seoulCalendarDate(new Date(clockInMs));
    if (shift.date === calendarDate) return entry;
    changed += 1;
    return { ...shift, date: calendarDate };
  });
  return { workShifts, changed };
}

export function normalizeHaloState(value: JsonRecord) {
  const normalized: JsonRecord = { ...applyInventoryCatalogVisibility(value) };
  delete normalized.updatedAt;
  REQUIRED_ARRAYS.forEach((key) => {
    normalized[key] = Array.isArray(value[key]) ? value[key] : [];
  });
  normalized.inventory = applyInventoryCatalogVisibility(normalized).inventory;
  normalized.workShifts = repairWorkerAttendanceCalendarDates(normalized.workShifts).workShifts;
  normalized.inventoryCounts = Array.isArray(value.inventoryCounts) ? value.inventoryCounts : [];
  normalized.accounts = Array.isArray(value.accounts) && value.accounts.length
    ? value.accounts
    : DEFAULT_HALO_STATE.accounts;
  normalized.costRules = value.costRules && typeof value.costRules === "object"
    ? value.costRules
    : DEFAULT_HALO_STATE.costRules;
  normalized.kitchenRules = normalizeKitchenRules(value.kitchenRules);
  normalized.kitchenRuleReminderHours = normalizeKitchenRuleReminderHours(value.kitchenRuleReminderHours);
  normalized.mezanaSettings = value.mezanaSettings && typeof value.mezanaSettings === "object" && !Array.isArray(value.mezanaSettings)
    ? value.mezanaSettings
    : DEFAULT_HALO_STATE.mezanaSettings;
  const archived = reconcileArchivedState(normalized).state as JsonRecord;
  return archived;
}

// Never cache an unresolved Promise here: Cloudflare request contexts can be
// canceled independently. Every initializer is idempotent, and readiness is
// remembered only after the current request completes it successfully.
let haloStateReady = false;
const HALO_SCHEMA_MARKER = "halo-runtime-schema-2026-09-supplier-opening-balance-v2";

async function initializeHaloState() {
  const database = d1();
  await database.batch([
    database.prepare(STATE_TABLE_SQL),
    database.prepare(BRANCH_TABLE_SQL),
    database.prepare(MIGRATION_TABLE_SQL),
    database.prepare(BACKUP_TABLE_SQL),
  ]);
  const sectionColumn = await d1().prepare(
    "SELECT name FROM pragma_table_info('halo_state_backups') WHERE name = 'section'",
  ).first<{ name: string }>();
  if (!sectionColumn) {
    await d1().prepare(
      "ALTER TABLE halo_state_backups ADD COLUMN section TEXT NOT NULL DEFAULT 'Oldingi yozuv'",
    ).run();
  }
  const branchColumns = await d1().prepare("PRAGMA table_info(halo_branches)").all<{ name: string }>();
  const branchColumnNames = new Set((branchColumns.results || []).map((column) => column.name));
  if (!branchColumnNames.has("archived_reason")) {
    await d1().prepare("ALTER TABLE halo_branches ADD COLUMN archived_reason TEXT NOT NULL DEFAULT ''").run();
  }
  if (!branchColumnNames.has("archived_at")) {
    await d1().prepare("ALTER TABLE halo_branches ADD COLUMN archived_at TEXT NOT NULL DEFAULT ''").run();
  }
  if (!branchColumnNames.has("archived_by")) {
    await d1().prepare("ALTER TABLE halo_branches ADD COLUMN archived_by TEXT NOT NULL DEFAULT ''").run();
  }
  await d1().prepare(
    "INSERT OR IGNORE INTO halo_branches (id, name, address, active) VALUES (?, ?, ?, 1)",
  )
    .bind("main", "HALO Asosiy filial", "")
    .run();
  const firstRevision = revision();
  await d1().prepare("INSERT OR IGNORE INTO app_state (id, payload, updated_at) VALUES (?, ?, ?)")
    .bind("main", JSON.stringify(EMPTY_BRANCH_STATE), firstRevision)
    .run();
  // Historical one-off repairs/resets are retired. Missing migration metadata
  // must never reset or reconcile business records on application startup.
  // Keep the marker names for older database tooling; schema setup is additive.
  for (const migrationId of [
    "clear-demo-data-v1",
    "reset-main-work-history-2026-08-12-v1",
    "reset-main-inventory-count-2026-08-20-v1",
    "worker-attendance-calendar-date-2026-08-15-v1",
    "reconcile-deleted-warehouse-2026-08-21-v1",
    "recover-supplier-invoices-after-payment-2026-08-21-v1",
    "reconcile-supplier-ledger-balances-2026-09-19-v1",
    "restore-supplier-opening-balances-2026-09-19-v2",
  ]) {
    await database.prepare("INSERT OR IGNORE INTO halo_migrations (id) VALUES (?)")
      .bind(migrationId).run();
  }
  // A cold Cloudflare isolate should not repeat every historical migration.
  // Bump this marker whenever initializeHaloState gains a new schema/data migration.
  await d1().prepare("INSERT OR IGNORE INTO halo_migrations (id) VALUES (?)")
    .bind(HALO_SCHEMA_MARKER)
    .run();
}

export async function ensureHaloState() {
  if (haloStateReady) return;
  try {
    const marker = await d1().prepare("SELECT id FROM halo_migrations WHERE id = ?")
      .bind(HALO_SCHEMA_MARKER)
      .first<{ id: string }>();
    if (marker?.id === HALO_SCHEMA_MARKER) {
      haloStateReady = true;
      return;
    }
  } catch {
    // Fresh databases do not have halo_migrations yet; initialize below.
  }
  await initializeHaloState();
  haloStateReady = true;
}

export async function listHaloBranches(includeArchived = false) {
  await ensureHaloState();
  const rows = await d1().prepare(
    `SELECT id, name, address, active, created_at, updated_at, archived_reason, archived_at, archived_by
      FROM halo_branches ${includeArchived ? "" : "WHERE active = 1"}
      ORDER BY active DESC, created_at ASC`,
  ).all<{
    id: string;
    name: string;
    address: string;
    active: number;
    created_at: string;
    updated_at: string;
    archived_reason: string;
    archived_at: string;
    archived_by: string;
  }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedReason: row.archived_reason || "",
    archivedAt: row.archived_at || "",
    archivedBy: row.archived_by || "",
  }));
}

export async function createHaloBranch(name: string, address = "") {
  await ensureHaloState();
  const branches = await listHaloBranches();
  if (branches.length >= 20) throw new Error("Filiallar soni 20 tadan oshmasligi kerak.");
  const branchId = `branch-${crypto.randomUUID().slice(0, 12)}`;
  const cleanName = name.trim().slice(0, 60);
  const cleanAddress = address.trim().slice(0, 180);
  if (cleanName.length < 2) throw new Error("Filial nomini kiriting.");
  await d1().prepare(
    "INSERT INTO halo_branches (id, name, address, active) VALUES (?, ?, ?, 1)",
  )
    .bind(branchId, cleanName, cleanAddress)
    .run();
  await d1().prepare("INSERT INTO app_state (id, payload, updated_at) VALUES (?, ?, ?)")
    .bind(branchId, JSON.stringify(EMPTY_BRANCH_STATE), revision())
    .run();
  return {
    id: branchId,
    name: cleanName,
    address: cleanAddress,
    active: true,
  };
}

export async function renameHaloBranch(branchId: string, name: string) {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const cleanName = name.trim().slice(0, 60);
  if (cleanName.length < 2) throw new Error("Filial nomini kiriting.");
  const updatedAt = new Date().toISOString();
  const result = await d1().prepare(
    "UPDATE halo_branches SET name = ?, updated_at = ? WHERE id = ? AND active = 1",
  )
    .bind(cleanName, updatedAt, safeId)
    .run();
  if (!result.meta.changes) throw new Error("Filial topilmadi.");
  return { id: safeId, name: cleanName, updatedAt };
}

export async function archiveHaloBranch(branchId: string, reason: string) {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const cleanReason = reason.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!cleanReason) throw new Error("Filialni o‘chirish sababini yozing.");
  if (safeId === "main") throw new Error("Asosiy filialni o‘chirib bo‘lmaydi.");
  const active = await d1().prepare(
    "SELECT COUNT(*) AS total FROM halo_branches WHERE active = 1",
  ).first<{ total: number }>();
  if (Number(active?.total || 0) <= 1) {
    throw new Error("Kamida bitta faol filial qolishi kerak.");
  }
  const target = await d1().prepare(
    "SELECT id FROM halo_branches WHERE id = ? AND active = 1",
  ).bind(safeId).first<{ id: string }>();
  if (!target) throw new Error("Filial topilmadi yoki oldin o‘chirilgan.");
  await createHaloBackup(safeId, "Rahbar", "Filial o‘chirishdan oldingi holat", "Filiallar");
  const archivedAt = new Date().toISOString();
  const result = await d1().prepare(
    "UPDATE halo_branches SET active = 0, archived_reason = ?, archived_at = ?, archived_by = 'Rahbar', updated_at = ? WHERE id = ? AND active = 1",
  ).bind(cleanReason, archivedAt, archivedAt, safeId).run();
  if (!result.meta.changes) throw new Error("Filial topilmadi yoki oldin o‘chirilgan.");
  return { id: safeId, archived: true };
}

export async function restoreHaloBranch(branchId: string) {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const result = await d1().prepare(
    "UPDATE halo_branches SET active = 1, updated_at = ? WHERE id = ? AND active = 0",
  ).bind(new Date().toISOString(), safeId).run();
  if (!result.meta.changes) throw new Error("Arxivlangan filial topilmadi.");
  await createHaloBackup(safeId, "Rahbar", "Filial arxivdan qaytarildi", "Filiallar");
  return { id: safeId, active: true };
}

export async function readHaloState(branchId = "main") {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const row = await d1().prepare("SELECT payload, updated_at FROM app_state WHERE id = ?")
    .bind(safeId)
    .first<{ payload: string; updated_at: string }>();
  if (!row) throw new Error("Filial ma’lumotlari topilmadi.");
  const parsed = JSON.parse(row.payload) as JsonRecord;
  if (parsed.vegetableExpenseVersion !== 1) {
    const migrated = migrateVegetableExpenses(parsed);
    try {
      const updatedAt = await replaceHaloState(migrated, row.updated_at, safeId, 'Rahbar', 'Omborsiz xarajat hisobi qo‘shildi; eski ma’lumotlar saqlandi', 'Ombor');
      return { state: normalizeHaloState(migrated), updatedAt };
    } catch (error) {
      if (error instanceof HaloStateConflictError) return readHaloState(safeId);
      throw error;
    }
  }
  return {
    state: normalizeHaloState(parsed),
    updatedAt: row.updated_at,
  };
}

export async function readHaloRevision(branchId = "main") {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const row = await d1().prepare("SELECT updated_at FROM app_state WHERE id = ?")
    .bind(safeId)
    .first<{ updated_at: string }>();
  if (!row) throw new Error("Filial ma’lumotlari topilmadi.");
  return row.updated_at;
}

export async function replaceHaloState(
  value: JsonRecord,
  expectedRevision: string,
  branchId = "main",
  actor = "Rahbar",
  action = "Ma’lumot yangilandi",
  section = "Tizim",
) {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const current = await d1().prepare("SELECT payload, updated_at FROM app_state WHERE id = ?")
    .bind(safeId)
    .first<{ payload: string; updated_at: string }>();
  if (!current || current.updated_at !== expectedRevision) throw new HaloStateConflictError();
  const backupId = crypto.randomUUID();
  const cleanActor = actor.trim().slice(0, 50) || "Rahbar";
  const cleanAction = action.trim().slice(0, 160) || "Ma’lumot yangilandi";
  const cleanSection = section.trim().slice(0, 80) || "Tizim";
  await d1().prepare(
    `INSERT INTO halo_state_backups
      (id, branch_id, revision, payload, actor, action, section, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(backupId, safeId, current.updated_at, current.payload, cleanActor, cleanAction, cleanSection, new Date().toISOString())
    .run();
  const currentState = normalizeHaloState(JSON.parse(current.payload) as JsonRecord);
  assertIntakePreserved(currentState, normalizeHaloState(value));
  const normalized = normalizeHaloState(applySaleInventoryAccounting(currentState, applyVegetablePurchaseAccounting(currentState, syncMezanaPosting(currentState, normalizeHaloState(preserveVegetableFields(currentState, { ...value, inventoryCounts: currentState.inventoryCounts || [], inventoryAccountingVersion: value.inventoryAccountingVersion || currentState.inventoryAccountingVersion, assistantReceipts: currentState.assistantReceipts || [], warehouseRevisions: currentState.warehouseRevisions || [], recordRemovals: currentState.recordRemovals || [], inventoryCatalogArchives: currentState.inventoryCatalogArchives || [] }))), cleanActor)));
  normalized.auditLog = [
    {
      id: backupId,
      actor: cleanActor,
      action: cleanAction,
      createdAt: new Date().toISOString(),
    },
    ...((Array.isArray(currentState.auditLog) ? currentState.auditLog : []) as unknown[]),
  ];
  const nextRevision = revision();
  const result = await d1().prepare(
    "UPDATE app_state SET payload = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
  )
    .bind(JSON.stringify(normalized), nextRevision, safeId, expectedRevision)
    .run();
  if (!result.meta.changes) {
    await d1().prepare("DELETE FROM halo_state_backups WHERE id = ?").bind(backupId).run();
    throw new HaloStateConflictError();
  }
  await d1().prepare(
    `DELETE FROM halo_state_backups WHERE branch_id = ? AND id NOT IN (
      SELECT id FROM halo_state_backups WHERE branch_id = ? ORDER BY created_at DESC LIMIT 100
    )`,
  ).bind(safeId, safeId).run();
  return nextRevision;
}

export async function listHaloBackups(branchId = "main") {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const rows = await d1().prepare(
    `SELECT id, revision, actor, action, section, created_at
      FROM halo_state_backups WHERE branch_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(safeId).all<{
    id: string;
    revision: string;
    actor: string;
    action: string;
    section: string;
    created_at: string;
  }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    revision: row.revision,
    actor: row.actor,
    action: row.action,
    section: row.section || "Oldingi yozuv",
    createdAt: row.created_at,
  }));
}

export async function createHaloBackup(
  branchId = "main",
  actor = "Rahbar",
  action = "Qo‘lda arxivlandi",
  section = "Arxiv",
) {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const current = await d1().prepare(
    "SELECT payload, updated_at FROM app_state WHERE id = ?",
  ).bind(safeId).first<{ payload: string; updated_at: string }>();
  if (!current) throw new Error("Filial ma’lumotlari topilmadi.");
  const backupId = crypto.randomUUID();
  await d1().prepare(
    `INSERT INTO halo_state_backups
      (id, branch_id, revision, payload, actor, action, section, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    backupId,
    safeId,
    current.updated_at,
    current.payload,
    actor.trim().slice(0, 50) || "Rahbar",
    action.trim().slice(0, 160) || "Qo‘lda arxivlandi",
    section.trim().slice(0, 80) || "Arxiv",
    new Date().toISOString(),
  ).run();
  return { id: backupId };
}

export async function restoreHaloBackup(branchId: string, backupId: string) {
  await ensureHaloState();
  const safeId = safeBranchId(branchId);
  const backup = await d1().prepare(
    "SELECT payload FROM halo_state_backups WHERE id = ? AND branch_id = ?",
  ).bind(backupId, safeId).first<{ payload: string }>();
  if (!backup?.payload) throw new Error("Zaxira nusxa topilmadi.");
  const current = await readHaloState(safeId);
  const updatedAt = await replaceHaloState(
    JSON.parse(backup.payload) as JsonRecord,
    current.updatedAt,
    safeId,
    "Rahbar",
    "Zaxira nusxadan qaytarildi",
    "Arxiv",
  );
  return { updatedAt };
}

export async function mutateHaloState<T>(
  mutator: (state: JsonRecord) => { state: JsonRecord; result: T } | Promise<{ state: JsonRecord; result: T }>,
  attempts = 5,
  branchId = "main",
  actor = "Tizim",
  action = "Avtomatik o‘zgarish",
  section = "Integratsiya",
  allowIntakeMutation = false,
) {
  const safeId = safeBranchId(branchId);
  const cleanActor = actor.trim().slice(0, 50) || "Tizim";
  const cleanAction = action.trim().slice(0, 160) || "Avtomatik o‘zgarish";
  const cleanSection = section.trim().slice(0, 80) || "Integratsiya";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = await readHaloState(safeId);
    const mutation = await mutator(structuredClone(current.state));
    if (!allowIntakeMutation) mutation.state.assistantReceipts = current.state.assistantReceipts || [];
    if (!allowIntakeMutation) assertIntakePreserved(current.state, normalizeHaloState(mutation.state));
    const normalized = normalizeHaloState(applySaleInventoryAccounting(current.state, applyVegetablePurchaseAccounting(current.state, syncMezanaPosting(current.state, normalizeHaloState(mutation.state)), cleanActor)));
    if (JSON.stringify(normalized) === JSON.stringify(current.state)) {
      const latest = await readHaloState(safeId);
      if (latest.updatedAt === current.updatedAt) {
        return { ...mutation, state: normalized, updatedAt: current.updatedAt };
      }
      continue;
    }
    const backupId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await d1().prepare(
      `INSERT INTO halo_state_backups
        (id, branch_id, revision, payload, actor, action, section, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      backupId,
      safeId,
      current.updatedAt,
      JSON.stringify(current.state),
      cleanActor,
      cleanAction,
      cleanSection,
      createdAt,
    ).run();
    normalized.auditLog = [
      { id: backupId, actor: cleanActor, action: cleanAction, createdAt },
      ...((Array.isArray(current.state.auditLog) ? current.state.auditLog : []) as unknown[]),
    ];
    const nextRevision = revision();
    const update = await d1().prepare(
      "UPDATE app_state SET payload = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
    )
      .bind(JSON.stringify(normalized), nextRevision, safeId, current.updatedAt)
      .run();
    if (update.meta.changes) {
      await d1().prepare(
        `DELETE FROM halo_state_backups WHERE branch_id = ? AND id NOT IN (
          SELECT id FROM halo_state_backups WHERE branch_id = ? ORDER BY created_at DESC LIMIT 100
        )`,
      ).bind(safeId, safeId).run();
      return { ...mutation, state: normalized, updatedAt: nextRevision };
    }
    await d1().prepare("DELETE FROM halo_state_backups WHERE id = ?").bind(backupId).run();
  }
  throw new HaloStateConflictError();
}
