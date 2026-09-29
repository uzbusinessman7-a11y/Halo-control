import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const appState = sqliteTable("app_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const haloBranches = sqliteTable("halo_branches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const haloMigrations = sqliteTable("halo_migrations", {
  id: text("id").primaryKey(),
  appliedAt: text("applied_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const haloStateBackups = sqliteTable("halo_state_backups", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull(),
  revision: text("revision").notNull(),
  payload: text("payload").notNull(),
  actor: text("actor").notNull().default("Rahbar"),
  action: text("action").notNull().default("Ma’lumot yangilandi"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const haloWorkerAccess = sqliteTable("halo_worker_access", {
  branchId: text("branch_id").primaryKey(),
  pinHash: text("pin_hash").notNull(),
  sessionHash: text("session_hash").notNull().default(""),
  sessionExpiresAt: text("session_expires_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const haloWorkerUsers = sqliteTable(
  "halo_worker_users",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id").notNull(),
    name: text("name").notNull(),
    username: text("username").notNull(),
    pinHash: text("pin_hash").notNull(),
    active: integer("active").notNull().default(1),
    canWarehouseReceipt: integer("can_warehouse_receipt").notNull().default(0),
    canSupplierDelivery: integer("can_supplier_delivery").notNull().default(0),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: text("locked_until").notNull().default(""),
    lastLoginAt: text("last_login_at").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("halo_worker_branch_username").on(table.branchId, table.username)],
);

export const haloWorkerSessions = sqliteTable("halo_worker_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text("last_used_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const telegramBranchStatus = sqliteTable("telegram_branch_status", {
  branchId: text("branch_id").primaryKey(),
  lastSentDate: text("last_sent_date").notNull().default(""),
  lastSentAt: text("last_sent_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const telegramDailyDeliveries = sqliteTable("telegram_daily_deliveries", {
  branchId: text("branch_id").notNull(),
  reportDate: text("report_date").notNull(),
  status: text("status").notNull(),
  claimId: text("claim_id").notNull(),
  claimedAt: text("claimed_at").notNull(),
  sentAt: text("sent_at").notNull().default(""),
  lastError: text("last_error").notNull().default(""),
}, (table) => [uniqueIndex("telegram_daily_branch_date").on(table.branchId, table.reportDate)]);

export const mezanaTelegramDeliveries = sqliteTable(
  "mezana_telegram_deliveries",
  {
    id: text("id").primaryKey(),
    branchId: text("branch_id").notNull(),
    entryId: text("entry_id").notNull(),
    status: text("status").notNull().default("sending"),
    lastError: text("last_error").notNull().default(""),
    sentAt: text("sent_at").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("mezana_telegram_branch_entry").on(table.branchId, table.entryId)],
);

export const integrationApiKeys = sqliteTable("integration_api_keys", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().default("main"),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  permissions: text("permissions").notNull(),
  active: integer("active").notNull().default(1),
  lastUsedAt: text("last_used_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at").notNull().default(""),
});

export const integrationSettings = sqliteTable("integration_settings", {
  id: text("id").primaryKey(),
  providerName: text("provider_name").notNull().default(""),
  storeId: text("store_id").notNull().default(""),
  enabled: integer("enabled").notNull().default(0),
  ownerEmail: text("owner_email").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const posProductMappings = sqliteTable("pos_product_mappings", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().default("main"),
  externalCode: text("external_code").notNull().default(""),
  externalName: text("external_name").notNull().default(""),
  normalizedName: text("normalized_name").notNull().default(""),
  recipeId: text("recipe_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const integrationLogs = sqliteTable("integration_logs", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().default("main"),
  keyId: text("key_id").notNull().default(""),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),
  status: integer("status").notNull(),
  externalId: text("external_id").notNull().default(""),
  message: text("message").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const haloAssistantConfig = sqliteTable('halo_assistant_config', {
 id:text('id').primaryKey(), branchId:text('branch_id').notNull(), botToken:text('bot_token').notNull(), botName:text('bot_name').notNull(), secret:text('secret').notNull(), generation:text('generation').notNull(),
 pairHash:text('pair_hash').notNull().default(''), pairExpires:integer('pair_expires').notNull().default(0), candidateId:text('candidate_id').notNull().default(''), candidateName:text('candidate_name').notNull().default(''), ownerId:text('owner_id').notNull().default(''), enabled:integer('enabled').notNull().default(0),
});
export const haloAssistantJobs = sqliteTable('halo_assistant_jobs', {
 id:text('id').primaryKey(), sourceKey:text('source_key').notNull().unique(), branchId:text('branch_id').notNull(), actor:text('actor').notNull(), generation:text('generation').notNull(), input:text('input').notNull(), status:text('status').notNull(), payload:text('payload').notNull().default(''), response:text('response').notNull().default(''), createdAt:integer('created_at').notNull(), updatedAt:integer('updated_at').notNull(), sent:integer('sent').notNull().default(0),
}, (table) => [index('halo_assistant_actor_created').on(table.actor, table.createdAt)]);
