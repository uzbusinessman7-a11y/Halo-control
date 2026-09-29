declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

export const API_PERMISSIONS = [
  "health:read",
  "products:read",
  "inventory:read",
  "sales:read",
  "reports:read",
  "export:read",
  "sales:write",
  "refunds:write",
] as const;

export type ApiPermission = typeof API_PERMISSIONS[number];
const DEFAULT_API_PERMISSIONS: ApiPermission[] = API_PERMISSIONS.filter((permission) => permission !== "export:read");

export const MAX_ACTIVE_API_KEYS = 50;

export class ApiKeyLimitError extends Error {
  constructor() {
    super(`Bu filialda ${MAX_ACTIVE_API_KEYS} ta faol API kaliti bor. Pastdagi ro‘yxatdan ishlatilmaydigan kalitni bekor qiling, keyin yangisini yarating.`);
    this.name = "ApiKeyLimitError";
  }
}

type ApiKeyRow = {
  id: string;
  branch_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  permissions: string;
  active: number;
  last_used_at: string;
  created_at: string;
  revoked_at: string;
};

export type AuthenticatedApiKey = {
  id: string;
  branchId: string;
  name: string;
  prefix: string;
  permissions: ApiPermission[];
};

const API_KEYS_SQL = `CREATE TABLE IF NOT EXISTS integration_api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'main',
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  revoked_at TEXT NOT NULL DEFAULT ''
)`;
const SETTINGS_SQL = `CREATE TABLE IF NOT EXISTS integration_settings (
  id TEXT PRIMARY KEY NOT NULL,
  provider_name TEXT NOT NULL DEFAULT '',
  store_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  owner_email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
)`;
const MAPPINGS_SQL = `CREATE TABLE IF NOT EXISTS pos_product_mappings (
  id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'main',
  external_code TEXT NOT NULL DEFAULT '',
  external_name TEXT NOT NULL DEFAULT '',
  normalized_name TEXT NOT NULL DEFAULT '',
  recipe_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
const LOGS_SQL = `CREATE TABLE IF NOT EXISTS integration_logs (
  id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'main',
  key_id TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
)`;
const INTEGRATION_SCHEMA_MARKERS_SQL = `CREATE TABLE IF NOT EXISTS integration_schema_markers (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const INTEGRATION_SCHEMA_MARKER = "integration-runtime-schema-2026-09-speed-v1";

function d1() {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Database unavailable");
  return globalThis.__HALO_CONTROL_DB__;
}

function now() {
  return new Date().toISOString();
}

export function normalizeIntegrationBranchId(value: unknown) {
  const branchId = String(value || "main").trim();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId) ? branchId : "main";
}

function toBase64Url(bytes: Uint8Array) {
  let source = "";
  bytes.forEach((byte) => {
    source += String.fromCharCode(byte);
  });
  return btoa(source).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parsePermissions(value: string): ApiPermission[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((permission): permission is ApiPermission => API_PERMISSIONS.includes(permission))
      : [];
  } catch {
    return [];
  }
}

export function normalizeExternalName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./()[\]{}'"’`]+/g, "")
    .replace(/[^a-z0-9가-힣а-яё]+/gi, "");
}

// An unresolved Promise cannot safely cross Cloudflare request contexts.
let integrationTablesReady = false;

async function initializeIntegrationTables() {
  const database = d1();
  await database.batch([
    database.prepare(API_KEYS_SQL),
    database.prepare(SETTINGS_SQL),
    database.prepare(MAPPINGS_SQL),
    database.prepare(LOGS_SQL),
    database.prepare(INTEGRATION_SCHEMA_MARKERS_SQL),
    database.prepare("CREATE INDEX IF NOT EXISTS integration_logs_created_idx ON integration_logs (created_at DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS integration_logs_branch_created_idx ON integration_logs (branch_id, created_at DESC)"),
    database.prepare("CREATE INDEX IF NOT EXISTS pos_product_mappings_code_idx ON pos_product_mappings (external_code)"),
    database.prepare("CREATE INDEX IF NOT EXISTS pos_product_mappings_name_idx ON pos_product_mappings (normalized_name)"),
    database.prepare("CREATE INDEX IF NOT EXISTS pos_product_mappings_branch_idx ON pos_product_mappings (branch_id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS integration_api_keys_branch_idx ON integration_api_keys (branch_id)"),
  ]);
  await database.prepare(
    "INSERT OR IGNORE INTO integration_settings (id, provider_name, store_id, enabled, owner_email, updated_at) VALUES (?, '', '', 0, '', ?)",
  ).bind("main", now()).run();
  // Bump the marker whenever the integration schema changes.
  await database.prepare("INSERT OR IGNORE INTO integration_schema_markers (id) VALUES (?)")
    .bind(INTEGRATION_SCHEMA_MARKER)
    .run();
}

export async function ensureIntegrationTables() {
  if (integrationTablesReady) return;
  try {
    const marker = await d1().prepare("SELECT id FROM integration_schema_markers WHERE id = ?")
      .bind(INTEGRATION_SCHEMA_MARKER)
      .first<{ id: string }>();
    if (marker?.id === INTEGRATION_SCHEMA_MARKER) {
      integrationTablesReady = true;
      return;
    }
  } catch {
    // Fresh/older databases are initialized below.
  }
  await initializeIntegrationTables();
  integrationTablesReady = true;
}

export async function listApiKeys(branchValue: unknown = "main") {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(branchValue);
  const rows = await d1().prepare(
    `SELECT id, branch_id, name, key_prefix, key_hash, permissions, active, last_used_at,
      created_at, revoked_at FROM integration_api_keys WHERE branch_id = ? ORDER BY created_at DESC`,
  ).bind(branchId).all<ApiKeyRow>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    prefix: row.key_prefix,
    permissions: parsePermissions(row.permissions),
    active: Boolean(row.active),
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

export async function createApiKey(name: string, requestedPermissions: unknown, branchValue: unknown = "main") {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(branchValue);
  const permissions = Array.isArray(requestedPermissions)
    ? requestedPermissions.filter((permission): permission is ApiPermission => (
        typeof permission === "string" && API_PERMISSIONS.includes(permission as ApiPermission)
      ))
    : [...DEFAULT_API_PERMISSIONS];
  if (!permissions.length) throw new Error("Kamida bitta API ruxsati kerak.");

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = `halo_live_${toBase64Url(bytes)}`;
  const keyHash = await sha256(token);
  const keyPrefix = `${token.slice(0, 18)}…`;
  const keyId = crypto.randomUUID();
  const createdAt = now();
  const inserted = await d1().prepare(
    `INSERT INTO integration_api_keys
      (id, branch_id, name, key_prefix, key_hash, permissions, active, last_used_at, created_at, revoked_at)
      SELECT ?, ?, ?, ?, ?, ?, 1, '', ?, ''
      WHERE (SELECT COUNT(*) FROM integration_api_keys WHERE branch_id = ? AND active = 1) < ?`,
  )
    .bind(keyId, branchId, name.trim().slice(0, 80), keyPrefix, keyHash, JSON.stringify(permissions), createdAt, branchId, MAX_ACTIVE_API_KEYS)
    .run();
  if (!inserted.meta.changes) throw new ApiKeyLimitError();
  return {
    id: keyId,
    branchId,
    key: token,
    prefix: keyPrefix,
    permissions,
    createdAt,
  };
}

export async function revokeApiKey(keyId: string, branchValue: unknown = "main") {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(branchValue);
  const result = await d1().prepare(
    "UPDATE integration_api_keys SET active = 0, revoked_at = ? WHERE id = ? AND branch_id = ? AND active = 1",
  ).bind(now(), keyId, branchId).run();
  return Boolean(result.meta.changes);
}

export async function authenticateApiKey(request: Request, permission: ApiPermission) {
  await ensureIntegrationTables();
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || request.headers.get("x-halo-api-key")?.trim() || "";
  if (!token.startsWith("halo_live_") || token.length < 30) return null;

  const keyHash = await sha256(token);
  const row = await d1().prepare(
    `SELECT id, branch_id, name, key_prefix, key_hash, permissions, active, last_used_at,
      created_at, revoked_at FROM integration_api_keys WHERE key_hash = ? AND active = 1`,
  ).bind(keyHash).first<ApiKeyRow>();
  if (!row) return null;
  const permissions = parsePermissions(row.permissions);
  if (!permissions.includes(permission)) return null;
  if (permission !== "health:read") {
    const settings = await d1().prepare("SELECT enabled FROM integration_settings WHERE id = ?")
      .bind(normalizeIntegrationBranchId(row.branch_id))
      .first<{ enabled: number }>();
    if (!settings?.enabled) return null;
  }
  await d1().prepare("UPDATE integration_api_keys SET last_used_at = ? WHERE id = ?")
    .bind(now(), row.id)
    .run();
  return {
    id: row.id,
    branchId: normalizeIntegrationBranchId(row.branch_id),
    name: row.name,
    prefix: row.key_prefix,
    permissions,
  } satisfies AuthenticatedApiKey;
}

export async function getIntegrationSettings(branchValue: unknown = "main") {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(branchValue);
  const row = await d1().prepare(
    "SELECT provider_name, store_id, enabled, updated_at FROM integration_settings WHERE id = ?",
  ).bind(branchId).first<{
    provider_name: string;
    store_id: string;
    enabled: number;
    updated_at: string;
  }>();
  return {
    providerName: row?.provider_name || "",
    storeId: row?.store_id || "",
    enabled: Boolean(row?.enabled),
    updatedAt: row?.updated_at || "",
  };
}

export async function saveIntegrationSettings(input: {
  branchId?: unknown;
  providerName?: unknown;
  storeId?: unknown;
  enabled?: unknown;
}) {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(input.branchId);
  const providerName = String(input.providerName || "").trim().slice(0, 100);
  const storeId = String(input.storeId || "").trim().slice(0, 100);
  const enabled = Boolean(input.enabled);
  const updatedAt = now();
  await d1().prepare(
    `INSERT INTO integration_settings (id, provider_name, store_id, enabled, owner_email, updated_at)
      VALUES (?, ?, ?, ?, '', ?)
      ON CONFLICT(id) DO UPDATE SET provider_name = excluded.provider_name,
      store_id = excluded.store_id, enabled = excluded.enabled, updated_at = excluded.updated_at`,
  ).bind(branchId, providerName, storeId, enabled ? 1 : 0, updatedAt).run();
  return { providerName, storeId, enabled, updatedAt };
}

export async function listProductMappings(branchValue: unknown = "main") {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(branchValue);
  const rows = await d1().prepare(
    `SELECT id, branch_id, external_code, external_name, normalized_name, recipe_id,
      created_at, updated_at FROM pos_product_mappings WHERE branch_id = ? ORDER BY updated_at DESC`,
  ).bind(branchId).all<{
    id: string;
    branch_id: string;
    external_code: string;
    external_name: string;
    normalized_name: string;
    recipe_id: string;
    created_at: string;
    updated_at: string;
  }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    externalCode: row.external_code,
    externalName: row.external_name,
    normalizedName: row.normalized_name,
    recipeId: row.recipe_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveProductMapping(input: {
  id?: unknown;
  branchId?: unknown;
  externalCode?: unknown;
  externalName?: unknown;
  recipeId?: unknown;
}) {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(input.branchId);
  const mappingId = String(input.id || crypto.randomUUID());
  const externalCode = String(input.externalCode || "").trim().slice(0, 100);
  const externalName = String(input.externalName || "").trim().slice(0, 150);
  const recipeId = String(input.recipeId || "").trim().slice(0, 100);
  if ((!externalCode && !externalName) || !recipeId) {
    throw new Error("POS kodi yoki nomi va HALO retsepti majburiy.");
  }
  const normalizedName = normalizeExternalName(externalName);
  const duplicate = await d1().prepare(
    `SELECT id FROM pos_product_mappings
      WHERE branch_id = ? AND id <> ? AND ((? <> '' AND external_code = ?) OR (? <> '' AND normalized_name = ?))
      LIMIT 1`,
  ).bind(branchId, mappingId, externalCode, externalCode, normalizedName, normalizedName).first<{ id: string }>();
  if (duplicate) {
    throw new Error("Bu POS kodi yoki nomi oldin boshqa retseptga bog‘langan.");
  }
  const timestamp = now();
  await d1().prepare(
    `INSERT INTO pos_product_mappings
      (id, branch_id, external_code, external_name, normalized_name, recipe_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET external_code = excluded.external_code,
      external_name = excluded.external_name, normalized_name = excluded.normalized_name,
      recipe_id = excluded.recipe_id, branch_id = excluded.branch_id, updated_at = excluded.updated_at`,
  ).bind(
    mappingId,
    branchId,
    externalCode,
    externalName,
    normalizedName,
    recipeId,
    timestamp,
    timestamp,
  ).run();
  return mappingId;
}

export async function deleteProductMapping(mappingId: string, branchValue: unknown = "main") {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(branchValue);
  const result = await d1().prepare("DELETE FROM pos_product_mappings WHERE id = ? AND branch_id = ?")
    .bind(mappingId, branchId)
    .run();
  return Boolean(result.meta.changes);
}

export async function writeIntegrationLog(input: {
  branchId?: string;
  keyId?: string;
  endpoint: string;
  method: string;
  status: number;
  externalId?: string;
  message?: string;
}) {
  try {
    await ensureIntegrationTables();
    await d1().prepare(
      `INSERT INTO integration_logs
        (id, branch_id, key_id, endpoint, method, status, external_id, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      normalizeIntegrationBranchId(input.branchId),
      input.keyId || "",
      input.endpoint.slice(0, 120),
      input.method.slice(0, 12),
      input.status,
      (input.externalId || "").slice(0, 160),
      (input.message || "").slice(0, 600),
      now(),
    ).run();
  } catch {
    // Logging must never break the POS request itself.
  }
}

export async function listIntegrationLogs(limit = 60, branchValue: unknown = "main") {
  await ensureIntegrationTables();
  const branchId = normalizeIntegrationBranchId(branchValue);
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows = await d1().prepare(
    `SELECT l.id, l.branch_id, l.key_id, l.endpoint, l.method, l.status, l.external_id,
      l.message, l.created_at, k.name AS key_name
      FROM integration_logs l
      LEFT JOIN integration_api_keys k ON k.id = l.key_id
      WHERE l.branch_id = ? ORDER BY l.created_at DESC LIMIT ?`,
  ).bind(branchId, safeLimit).all<{
    id: string;
    branch_id: string;
    key_id: string;
    endpoint: string;
    method: string;
    status: number;
    external_id: string;
    message: string;
    created_at: string;
    key_name: string | null;
  }>();
  return (rows.results || []).map((row) => ({
    id: row.id,
    branchId: row.branch_id,
    keyId: row.key_id,
    keyName: row.key_name || "Noma’lum kalit",
    endpoint: row.endpoint,
    method: row.method,
    status: row.status,
    externalId: row.external_id,
    message: row.message,
    createdAt: row.created_at,
  }));
}

export async function isAdminRequest(request: Request) {
  const email = String(request.headers.get("oai-authenticated-user-email") || "").trim().toLowerCase();
  if (!email) return false;
  await ensureIntegrationTables();
  const current = await d1().prepare("SELECT owner_email FROM integration_settings WHERE id = ?")
    .bind("main")
    .first<{ owner_email: string }>();
  const ownerEmail = String(current?.owner_email || "").trim().toLowerCase();
  if (ownerEmail) return ownerEmail === email;
  const claimed = await d1().prepare(
    "UPDATE integration_settings SET owner_email = ?, updated_at = ? WHERE id = ? AND owner_email = ''",
  ).bind(email, now(), "main").run();
  if (claimed.meta.changes) return true;
  const verified = await d1().prepare("SELECT owner_email FROM integration_settings WHERE id = ?")
    .bind("main")
    .first<{ owner_email: string }>();
  return String(verified?.owner_email || "").trim().toLowerCase() === email;
}
