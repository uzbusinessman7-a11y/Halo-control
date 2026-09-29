import { listHaloBranches } from "./halo-store";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

const USERS_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_users (
  id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  can_warehouse_receipt INTEGER NOT NULL DEFAULT 0,
  can_supplier_delivery INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT NOT NULL DEFAULT '',
  last_login_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(branch_id, username)
)`;
const SESSIONS_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const CHANNELS_SQL = `CREATE TABLE IF NOT EXISTS halo_worker_channels (
  worker_id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL DEFAULT '',
  telegram_chat_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const COOKIE_NAME = "halo_worker_session";
const SESSION_DAYS = 30;

export type WorkerAccount = {
  id: string;
  branchId: string;
  name: string;
  username: string;
  active: boolean;
  canWarehouseReceipt: boolean;
  canSupplierDelivery: boolean;
  failedAttempts: number;
  lockedUntil: string;
  lastLoginAt: string;
  createdAt: string;
  telegramChatId: string;
  telegramChatName: string;
};

function d1() {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Database unavailable");
  return globalThis.__HALO_CONTROL_DB__;
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeBranchId(value: string) {
  const branchId = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)) throw new Error("Noto‘g‘ri filial.");
  return branchId;
}

function cleanName(value: string) {
  const name = value.trim().replace(/\s+/g, " ").slice(0, 60);
  if (name.length < 2) throw new Error("Xodim ismini kiriting.");
  return name;
}

function cleanUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error("Login 3–32 ta lotin harfi yoki raqamdan iborat bo‘lsin.");
  }
  return username;
}

function cleanPin(value: string) {
  const pin = value.trim();
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN 4–8 ta raqam bo‘lishi kerak.");
  return pin;
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseSessionCookie(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  const raw = cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) || "";
  const separator = raw.indexOf(".");
  if (separator < 1) return null;
  const sessionId = raw.slice(0, separator);
  const token = raw.slice(separator + 1);
  if (!/^[a-f0-9-]{20,80}$/.test(sessionId) || token.length < 40) return null;
  return { sessionId, token };
}

// An unresolved Promise cannot safely cross Cloudflare request contexts.
let workerAccessReady = false;

async function initializeWorkerAccess() {
  const database = d1();
  await database.batch([
    database.prepare(USERS_SQL),
    database.prepare(SESSIONS_SQL),
    database.prepare(CHANNELS_SQL),
    database.prepare("CREATE INDEX IF NOT EXISTS halo_worker_sessions_expires_idx ON halo_worker_sessions (expires_at)"),
  ]);
}

export async function ensureWorkerAccess() {
  if (workerAccessReady) return;
  await initializeWorkerAccess();
  workerAccessReady = true;
}

function accountFromRow(row: {
  id: string;
  branch_id: string;
  name: string;
  username: string;
  active: number;
  can_warehouse_receipt: number;
  can_supplier_delivery: number;
  failed_attempts: number;
  locked_until: string;
  last_login_at: string;
  created_at: string;
  telegram_chat_id?: string | null;
  telegram_chat_name?: string | null;
}): WorkerAccount {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    username: row.username,
    active: Boolean(row.active),
    canWarehouseReceipt: Boolean(row.can_warehouse_receipt),
    canSupplierDelivery: Boolean(row.can_supplier_delivery),
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until || "",
    lastLoginAt: row.last_login_at || "",
    createdAt: row.created_at,
    telegramChatId: row.telegram_chat_id || "",
    telegramChatName: row.telegram_chat_name || "",
  };
}

export async function listWorkerBranches() {
  const [branches] = await Promise.all([listHaloBranches(), ensureWorkerAccess()]);
  const configured = await d1().prepare(
    "SELECT DISTINCT branch_id FROM halo_worker_users WHERE active = 1",
  ).all<{ branch_id: string }>();
  const configuredIds = new Set((configured.results || []).map((row) => row.branch_id));
  return branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    configured: configuredIds.has(branch.id),
  }));
}

export async function listWorkerAccounts(branchId: string) {
  await ensureWorkerAccess();
  const safeId = safeBranchId(branchId);
  const rows = await d1().prepare(
    `SELECT u.id, u.branch_id, u.name, u.username, u.active, u.can_warehouse_receipt, u.can_supplier_delivery,
      u.failed_attempts, u.locked_until,
      u.last_login_at, u.created_at, c.telegram_chat_id, c.telegram_chat_name
      FROM halo_worker_users u
      LEFT JOIN halo_worker_channels c ON c.worker_id = u.id
      WHERE u.branch_id = ? ORDER BY u.active DESC, u.name ASC`,
  ).bind(safeId).all<{
    id: string;
    branch_id: string;
    name: string;
    username: string;
    active: number;
    can_warehouse_receipt: number;
    can_supplier_delivery: number;
    failed_attempts: number;
    locked_until: string;
    last_login_at: string;
    created_at: string;
    telegram_chat_id: string | null;
    telegram_chat_name: string | null;
  }>();
  return (rows.results || []).map(accountFromRow);
}

export async function createWorkerAccount(branchId: string, name: string, username: string, pin: string) {
  await ensureWorkerAccess();
  const safeId = safeBranchId(branchId);
  const branches = await listHaloBranches();
  if (!branches.some((branch) => branch.id === safeId)) throw new Error("Faol filial topilmadi.");
  const safeName = cleanName(name);
  const safeUsername = cleanUsername(username);
  const safePin = cleanPin(pin);
  const workerId = crypto.randomUUID();
  try {
    await d1().prepare(
      `INSERT INTO halo_worker_users
        (id, branch_id, name, username, pin_hash, active, failed_attempts, locked_until,
        last_login_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 0, '', '', ?, ?)`,
    ).bind(
      workerId,
      safeId,
      safeName,
      safeUsername,
      await hash(`${safeId}:${safeUsername}:${safePin}`),
      new Date().toISOString(),
      new Date().toISOString(),
    ).run();
  } catch {
    throw new Error("Bu login shu filialda band. Boshqa login tanlang.");
  }
  return workerId;
}

export async function setWorkerActive(workerId: string, active: boolean) {
  await ensureWorkerAccess();
  const worker = await d1().prepare(
    "SELECT branch_id, name FROM halo_worker_users WHERE id = ?",
  ).bind(workerId).first<{ branch_id: string; name: string }>();
  if (!worker) throw new Error("Xodim akkaunti topilmadi.");
  const result = await d1().prepare(
    "UPDATE halo_worker_users SET active = ?, failed_attempts = 0, locked_until = '', updated_at = ? WHERE id = ?",
  ).bind(active ? 1 : 0, new Date().toISOString(), workerId).run();
  if (!result.meta.changes) throw new Error("Xodim akkaunti topilmadi.");
  if (!active) await d1().prepare("DELETE FROM halo_worker_sessions WHERE user_id = ?").bind(workerId).run();
}

export async function setWorkerWarehouseReceipt(workerId: string, allowed: boolean) {
  await ensureWorkerAccess();
  const result = await d1().prepare(
    "UPDATE halo_worker_users SET can_warehouse_receipt = ?, updated_at = ? WHERE id = ?",
  ).bind(allowed ? 1 : 0, new Date().toISOString(), workerId).run();
  if (!result.meta.changes) throw new Error("Xodim akkaunti topilmadi.");
  await d1().prepare("DELETE FROM halo_worker_sessions WHERE user_id = ?").bind(workerId).run();
}

export async function setWorkerSupplierDelivery(workerId: string, allowed: boolean) {
  await ensureWorkerAccess();
  const result = await d1().prepare(
    "UPDATE halo_worker_users SET can_supplier_delivery = ?, updated_at = ? WHERE id = ?",
  ).bind(allowed ? 1 : 0, new Date().toISOString(), workerId).run();
  if (!result.meta.changes) throw new Error("Xodim akkaunti topilmadi.");
  await d1().prepare("DELETE FROM halo_worker_sessions WHERE user_id = ?").bind(workerId).run();
}

export async function resetWorkerPin(workerId: string, pin: string) {
  await ensureWorkerAccess();
  const safePin = cleanPin(pin);
  const row = await d1().prepare(
    "SELECT branch_id, username, name FROM halo_worker_users WHERE id = ?",
  ).bind(workerId).first<{ branch_id: string; username: string; name: string }>();
  if (!row) throw new Error("Xodim akkaunti topilmadi.");
  await d1().prepare(
    `UPDATE halo_worker_users SET pin_hash = ?, failed_attempts = 0, locked_until = '',
      updated_at = ? WHERE id = ?`,
  ).bind(
    await hash(`${row.branch_id}:${row.username}:${safePin}`),
    new Date().toISOString(),
    workerId,
  ).run();
  await d1().prepare("DELETE FROM halo_worker_sessions WHERE user_id = ?").bind(workerId).run();
}

export async function loginWorker(branchId: string, username: string, pin: string) {
  await ensureWorkerAccess();
  const safeId = safeBranchId(branchId);
  const safeUsername = cleanUsername(username);
  const safePin = cleanPin(pin);
  const row = await d1().prepare(
    `SELECT u.id, u.branch_id, u.name, u.username, u.pin_hash, u.active, u.can_warehouse_receipt, u.can_supplier_delivery,
      u.failed_attempts, u.locked_until
      FROM halo_worker_users u
      JOIN halo_branches b ON b.id = u.branch_id AND b.active = 1
      WHERE u.branch_id = ? AND u.username = ?`,
  ).bind(safeId, safeUsername).first<{
    id: string;
    branch_id: string;
    name: string;
    username: string;
    pin_hash: string;
    active: number;
    can_warehouse_receipt: number;
    can_supplier_delivery: number;
    failed_attempts: number;
    locked_until: string;
  }>();
  const now = new Date();
  if (!row || !row.active) throw new Error("Login yoki PIN noto‘g‘ri.");
  if (row.locked_until && row.locked_until > now.toISOString()) {
    throw new Error("Ko‘p xato urinish bo‘ldi. 15 daqiqadan keyin qayta kiring.");
  }
  const valid = row.pin_hash === await hash(`${safeId}:${safeUsername}:${safePin}`);
  if (!valid) {
    const attempts = (row.failed_attempts || 0) + 1;
    const lockedUntil = attempts >= 5 ? new Date(now.getTime() + 15 * 60_000).toISOString() : "";
    await d1().prepare(
      "UPDATE halo_worker_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?",
    ).bind(attempts >= 5 ? 0 : attempts, lockedUntil, now.toISOString(), row.id).run();
    throw new Error(lockedUntil
      ? "5 marta xato kiritildi. Akkaunt 15 daqiqaga bloklandi."
      : `Login yoki PIN noto‘g‘ri. ${5 - attempts} ta urinish qoldi.`);
  }
  const sessionId = crypto.randomUUID();
  const token = randomToken();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  const database = d1();
  const nowIso = now.toISOString();
  await database.batch([
    database.prepare(
      `INSERT INTO halo_worker_sessions
        (id, user_id, token_hash, expires_at, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(sessionId, row.id, await hash(token), expires.toISOString(), nowIso, nowIso),
    database.prepare(
      "UPDATE halo_worker_users SET failed_attempts = 0, locked_until = '', last_login_at = ?, updated_at = ? WHERE id = ?",
    ).bind(nowIso, nowIso, row.id),
    database.prepare("DELETE FROM halo_worker_sessions WHERE expires_at <= ?").bind(nowIso),
  ]);
  return {
    branchId: safeId,
    userId: row.id,
    name: row.name,
    username: row.username,
    canWarehouseReceipt: Boolean(row.can_warehouse_receipt),
    canSupplierDelivery: Boolean(row.can_supplier_delivery),
    cookie: `${COOKIE_NAME}=${sessionId}.${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}`,
  };
}

export async function authenticateWorkerRequest(request: Request) {
  const parsed = parseSessionCookie(request);
  if (!parsed) return null;
  await ensureWorkerAccess();
  const row = await d1().prepare(
    `SELECT s.token_hash, s.expires_at, u.id AS user_id, u.branch_id, u.name, u.username,
      u.active, u.can_warehouse_receipt, u.can_supplier_delivery
      FROM halo_worker_sessions s
      JOIN halo_worker_users u ON u.id = s.user_id
      JOIN halo_branches b ON b.id = u.branch_id AND b.active = 1
      WHERE s.id = ?`,
  ).bind(parsed.sessionId).first<{
    token_hash: string;
    expires_at: string;
    user_id: string;
    branch_id: string;
    name: string;
    username: string;
    active: number;
    can_warehouse_receipt: number;
    can_supplier_delivery: number;
  }>();
  if (!row?.active || row.expires_at <= new Date().toISOString()) return null;
  if (row.token_hash !== await hash(parsed.token)) return null;
  return {
    userId: row.user_id,
    branchId: row.branch_id,
    name: row.name,
    username: row.username,
    canWarehouseReceipt: Boolean(row.can_warehouse_receipt),
    canSupplierDelivery: Boolean(row.can_supplier_delivery),
    sessionId: parsed.sessionId,
  };
}

export async function logoutWorker(request: Request) {
  const parsed = parseSessionCookie(request);
  if (!parsed) return;
  await ensureWorkerAccess();
  await d1().prepare("DELETE FROM halo_worker_sessions WHERE id = ?").bind(parsed.sessionId).run();
}

export const clearWorkerCookie = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
