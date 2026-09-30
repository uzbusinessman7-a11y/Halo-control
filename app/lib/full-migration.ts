/**
 * HALO Control — to'liq ko'chirish (eski baza → yangi baza).
 *
 * Eksport: bazadagi barcha jadvallar (tuzilma + yozuvlar) bitta JSON'ga.
 *   Har bir jadval uchun yozuvlar soni va SHA-256 nazorat yig'indisi yoziladi.
 * Import: faqat yangi saytda. Fayl yaxlitligi tekshiriladi, keyin asosiy
 *   jadvallar BITTA tranzaksiyada (D1 batch — yo hammasi, yo hech narsa)
 *   yoziladi. Oxirida har bir jadval qayta o'qilib, fayl bilan solishtiriladi.
 *
 * Himoyalar:
 * - Ishlatilgan (savdo/ombor bor) bazaga maxsus tasdiqsiz yozilmaydi.
 * - Fayldagi rahbar emaili kirgan rahbar emailiga mos kelmasa — to'xtaydi
 *   (aks holda rahbar o'z tizimidan qulflanib qolardi).
 * - Xodim sessiyalari ko'chirilmaydi (xodimlar yangi saytda qayta kiradi).
 * - Parallel sinov paytida Telegram ikki marta yubormasligi uchun yangi
 *   saytda avtomatik hisobot to'xtatiladi (eski sayt yuborishda davom etadi).
 */

import { toBaseState, type BaseResetReport } from "./base-reset.ts";

type Row = Record<string, unknown>;
type Value = string | number | null;

export interface D1Like {
  prepare(query: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all<T = Row>(): Promise<{ results: T[] }>;
  first<T = Row>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export const MIGRATION_FORMAT = "halo-control-full-migration";
export const MIGRATION_VERSION = 1;
/** Ko'chirilmaydi: vaqtinchalik sessiyalar va platformaning ichki jadvallari. */
export const SKIPPED_TABLES = new Set(["halo_worker_sessions", "d1_migrations", "__drizzle_migrations", "sqlite_sequence"]);
/** Tarix jadvallari katta bo'lishi mumkin: asosiy tranzaksiyadan keyin bo'laklab yoziladi. */
export const HISTORY_TABLES = new Set(["halo_state_backups", "integration_logs"]);
const BUSINESS_KEYS = ["sales", "financialEntries", "inventory", "recipes", "suppliers", "transactions", "stockMovements"];
export const REPLACE_CONFIRMATION = "HA_ALMASHTIR";
const PAGE_SIZE = 200;
const HISTORY_CHUNK = 25;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export interface TableDump {
  sql: string;
  indexes: string[];
  columns: string[];
  rows: Value[][];
  count: number;
  sha256: string;
}
export interface MigrationDump {
  format: string;
  version: number;
  exportedAt: string;
  source: string;
  tables: Record<string, TableDump>;
}

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const quote = (name: string) => {
  if (!SAFE_NAME.test(name)) throw new MigrationError(`Jadval yoki ustun nomi noto'g'ri: ${name}`);
  return `"${name}"`;
};

function normalizeValue(value: unknown): Value {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new MigrationError("Jadvalda qo'llab-quvvatlanmaydigan qiymat turi (BLOB) bor — ko'chirish to'xtatildi.");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Tartibga bog'liq bo'lmagan nazorat yig'indisi: qatorlar kanonik tartiblanadi. */
export async function checksumRows(columns: string[], rows: Value[][]): Promise<string> {
  const lines = rows.map((row) => JSON.stringify(row)).sort();
  return sha256(`${JSON.stringify(columns)}\n${lines.join("\n")}`);
}

async function tableColumns(db: D1Like, table: string): Promise<string[]> {
  const info = await db.prepare(`PRAGMA table_info(${quote(table)})`).all<{ name: string }>();
  return info.results.map((column) => String(column.name));
}

async function readRows(db: D1Like, table: string, columns: string[]): Promise<Value[][]> {
  const rows: Value[][] = [];
  const select = columns.map(quote).join(", ");
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await db.prepare(`SELECT ${select} FROM ${quote(table)} ORDER BY rowid LIMIT ? OFFSET ?`).bind(PAGE_SIZE, offset).all<Row>();
    for (const row of page.results) rows.push(columns.map((column) => normalizeValue(row[column])));
    if (page.results.length < PAGE_SIZE) break;
  }
  return rows;
}

async function listTables(db: D1Like) {
  const tables = await db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).all<{ name: string; sql: string }>();
  const indexes = await db.prepare(
    "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
  ).all<{ tbl_name: string; sql: string }>();
  return {
    tables: tables.results.filter((table) => SAFE_NAME.test(table.name) && !SKIPPED_TABLES.has(table.name)),
    indexes: indexes.results,
  };
}

export async function exportDatabase(db: D1Like, source: string, now = new Date()): Promise<MigrationDump> {
  const { tables, indexes } = await listTables(db);
  const dump: MigrationDump = { format: MIGRATION_FORMAT, version: MIGRATION_VERSION, exportedAt: now.toISOString(), source, tables: {} };
  for (const table of tables) {
    const columns = await tableColumns(db, table.name);
    const rows = await readRows(db, table.name, columns);
    dump.tables[table.name] = {
      sql: table.sql,
      indexes: indexes.filter((index) => index.tbl_name === table.name).map((index) => index.sql),
      columns,
      rows,
      count: rows.length,
      sha256: await checksumRows(columns, rows),
    };
  }
  return dump;
}

function ifNotExists(sql: string, kind: "TABLE" | "INDEX"): string {
  const pattern = kind === "TABLE"
    ? /^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i
    : /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?/i;
  if (!pattern.test(sql)) throw new MigrationError(`Kutilmagan tuzilma buyrug'i: ${sql.slice(0, 60)}`);
  return kind === "TABLE"
    ? sql.replace(pattern, "CREATE TABLE IF NOT EXISTS ")
    : sql.replace(pattern, (_match, unique) => `CREATE ${unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS `);
}

/** Fayl buzilmaganini va o'zgartirilmaganini tekshiradi. */
export async function validateDump(input: unknown): Promise<MigrationDump> {
  const dump = input as MigrationDump;
  if (!dump || typeof dump !== "object" || dump.format !== MIGRATION_FORMAT) {
    throw new MigrationError("Bu HALO Control to'liq ko'chirish fayli emas.");
  }
  if (dump.version !== MIGRATION_VERSION) throw new MigrationError(`Fayl versiyasi mos emas (${String(dump.version)}).`);
  if (!dump.tables || typeof dump.tables !== "object" || !dump.tables.app_state) {
    throw new MigrationError("Faylda asosiy ma'lumot (app_state) yo'q.");
  }
  for (const [name, table] of Object.entries(dump.tables)) {
    quote(name);
    if (SKIPPED_TABLES.has(name)) throw new MigrationError(`Faylda ko'chirilmaydigan jadval bor: ${name}`);
    if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || typeof table.sql !== "string") {
      throw new MigrationError(`${name} jadvali buzilgan.`);
    }
    table.columns.forEach(quote);
    if (table.rows.length !== table.count) throw new MigrationError(`${name}: yozuvlar soni mos emas (${table.rows.length} ≠ ${table.count}).`);
    for (const row of table.rows) {
      if (!Array.isArray(row) || row.length !== table.columns.length) throw new MigrationError(`${name}: qator ustunlar soniga mos emas.`);
      row.forEach(normalizeValue);
    }
    if (await checksumRows(table.columns, table.rows) !== table.sha256) {
      throw new MigrationError(`${name}: nazorat yig'indisi mos emas — fayl buzilgan yoki o'zgartirilgan.`);
    }
    ifNotExists(table.sql, "TABLE");
    (table.indexes || []).forEach((index) => ifNotExists(index, "INDEX"));
  }
  return dump;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain || ""}`;
}

export function dumpOwnerEmail(dump: MigrationDump): string {
  const table = dump.tables.integration_settings;
  if (!table) return "";
  const idIndex = table.columns.indexOf("id");
  const emailIndex = table.columns.indexOf("owner_email");
  if (idIndex < 0 || emailIndex < 0) return "";
  const row = table.rows.find((candidate) => candidate[idIndex] === "main");
  return String(row?.[emailIndex] || "").trim().toLowerCase();
}

/** Yangi bazada biznes ma'lumoti bormi (savdo, ombor, xarajat...)? */
export async function targetHasBusinessData(db: D1Like): Promise<boolean> {
  let rows: Array<{ payload: string }> = [];
  try {
    rows = (await db.prepare("SELECT payload FROM app_state").all<{ payload: string }>()).results;
  } catch {
    return false;
  }
  return rows.some((row) => {
    try {
      const payload = JSON.parse(row.payload) as Row;
      return BUSINESS_KEYS.some((key) => Array.isArray(payload[key]) && (payload[key] as unknown[]).length > 0);
    } catch {
      return true;
    }
  });
}

export interface TableReport { table: string; fileRows: number; databaseRows: number; ok: boolean }
export interface ImportReport {
  dryRun: boolean;
  source: string;
  exportedAt: string;
  tables: TableReport[];
  ok: boolean;
  telegramPaused: number;
}

function insertStatements(db: D1Like, name: string, table: TableDump): D1StatementLike[] {
  const columns = table.columns.map(quote).join(", ");
  const marks = table.columns.map(() => "?").join(", ");
  const insert = `INSERT INTO ${quote(name)} (${columns}) VALUES (${marks})`;
  return table.rows.map((row) => db.prepare(insert).bind(...row));
}

export async function importDatabase(
  db: D1Like,
  input: unknown,
  options: { ownerEmail: string; dryRun?: boolean; replaceExisting?: string; pauseTelegram?: boolean },
): Promise<ImportReport> {
  const dump = await validateDump(input);
  const owner = options.ownerEmail.trim().toLowerCase();
  const dumpOwner = dumpOwnerEmail(dump);
  if (dumpOwner && dumpOwner !== owner) {
    throw new MigrationError(`Fayldagi rahbar emaili (${maskEmail(dumpOwner)}) siz kirgan email bilan mos emas. Cloudflare'dagi HALO_OWNER_EMAIL'ni eski tizimdagi email bilan bir xil qiling, aks holda import qilingandan keyin tizimga kira olmaysiz.`);
  }
  if (await targetHasBusinessData(db) && options.replaceExisting !== REPLACE_CONFIRMATION) {
    throw new MigrationError(`Yangi bazada allaqachon savdo/ombor ma'lumoti bor. Ustidan yozish uchun alohida tasdiq ("${REPLACE_CONFIRMATION}") kerak.`);
  }

  const names = Object.keys(dump.tables).sort();

  // Oldindan tekshiruv: yangi bazadagi mavjud jadvalda fayldagi ustun yetishmasa, hech narsa yozilmaydi.
  for (const name of names) {
    const existing = await tableColumns(db, name);
    if (!existing.length) continue;
    const missing = dump.tables[name].columns.filter((column) => !existing.includes(column));
    if (missing.length) {
      throw new MigrationError(`Yangi bazadagi ${name} jadvalida ustun yetishmaydi: ${missing.join(", ")}. Hech narsa yozilmadi.`);
    }
  }

  const coreNames = names.filter((name) => !HISTORY_TABLES.has(name));
  const historyNames = names.filter((name) => HISTORY_TABLES.has(name));

  if (options.dryRun) {
    return {
      dryRun: true, source: dump.source, exportedAt: dump.exportedAt, ok: true, telegramPaused: 0,
      tables: names.map((name) => ({ table: name, fileRows: dump.tables[name].count, databaseRows: 0, ok: true })),
    };
  }

  // 1) Tuzilma: jadval va indekslar (mavjud bo'lsa tegilmaydi).
  const schema: D1StatementLike[] = [];
  for (const name of names) {
    schema.push(db.prepare(ifNotExists(dump.tables[name].sql, "TABLE")));
    for (const index of dump.tables[name].indexes || []) schema.push(db.prepare(ifNotExists(index, "INDEX")));
  }
  await db.batch(schema);

  // 2) Asosiy ma'lumotlar: bitta tranzaksiya — yo hammasi, yo hech narsa.
  const core: D1StatementLike[] = [];
  for (const name of coreNames) {
    core.push(db.prepare(`DELETE FROM ${quote(name)}`));
    core.push(...insertStatements(db, name, dump.tables[name]));
  }
  await db.batch(core);

  // 3) Tarix jadvallari: bo'laklab (katta bo'lishi mumkin).
  for (const name of historyNames) {
    await db.batch([db.prepare(`DELETE FROM ${quote(name)}`)]);
    const inserts = insertStatements(db, name, dump.tables[name]);
    for (let index = 0; index < inserts.length; index += HISTORY_CHUNK) {
      await db.batch(inserts.slice(index, index + HISTORY_CHUNK));
    }
  }

  // 4) Tekshiruv: har bir jadval qayta o'qiladi va fayl bilan solishtiriladi.
  const tables: TableReport[] = [];
  for (const name of names) {
    const expected = dump.tables[name];
    const rows = await readRows(db, name, expected.columns);
    const same = rows.length === expected.count && await checksumRows(expected.columns, rows) === expected.sha256;
    tables.push({ table: name, fileRows: expected.count, databaseRows: rows.length, ok: same });
  }
  const ok = tables.every((table) => table.ok);

  // 5) Parallel sinovda Telegram ikki marta yubormasin.
  let telegramPaused = 0;
  if (ok && options.pauseTelegram !== false && dump.tables.telegram_settings) {
    const before = await db.prepare("SELECT COUNT(*) AS n FROM telegram_settings WHERE enabled = 1").first<{ n: number }>();
    telegramPaused = Number(before?.n || 0);
    if (telegramPaused) await db.prepare("UPDATE telegram_settings SET enabled = 0 WHERE enabled = 1").run();
  }

  return { dryRun: false, source: dump.source, exportedAt: dump.exportedAt, tables, ok, telegramPaused };
}

// ---------------------------------------------------------------------------
// ChatGPT'siz yo'l: eski saytdagi "To'liq ma'lumotni yuklash" tugmasi fayli.
// Har bir filial uchun bitta fayl (format: halo-control-api-export).
// Faqat biznes ma'lumotlari (app_state) ko'chadi; xodim loginlari, Telegram va
// zaxira tarixi yangi saytda qayta sozlanadi.
// Ma'lumot fayldagidek yoziladi — hech qanday hisob-kitob qayta qo'llanmaydi.
// ---------------------------------------------------------------------------

export const BRANCH_EXPORT_FORMATS = new Set(["halo-control-api-export", "halo-control-portable-export"]);
const BRANCH_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export interface BranchExport {
  format: string;
  branchId: string;
  exportedAt: string;
  updatedAt: string;
  state: Row;
}

export interface BranchSummary {
  sales: number;
  salesRevenue: number;
  financialEntries: number;
  inventoryItems: number;
  suppliers: number;
  supplierBalance: number;
  recipes: number;
}

export interface BranchReport {
  branchId: string;
  exportedAt: string;
  replaced: boolean;
  summary: BranchSummary;
  ok: boolean;
  /** Faqat "noldan boshlash" rejimida: nima saqlandi, nima nolga tushdi. */
  base?: BaseResetReport;
}

export interface BranchImportReport { dryRun: boolean; ok: boolean; branches: BranchReport[] }

export function isBranchExport(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && BRANCH_EXPORT_FORMATS.has(String((value as Row).format)));
}

const list = (value: unknown): Row[] => (Array.isArray(value) ? value as Row[] : []);
const money = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Eski va yangi saytda solishtirish uchun asosiy jami ko'rsatkichlar. */
export function summarizeState(state: Row): BranchSummary {
  const sales = list(state.sales);
  const suppliers = list(state.suppliers);
  return {
    sales: sales.length,
    salesRevenue: sales.reduce((sum, sale) => sum + Math.round(money(sale.totalRevenue)), 0),
    financialEntries: list(state.financialEntries).length,
    inventoryItems: list(state.inventory).length,
    suppliers: suppliers.length,
    supplierBalance: suppliers.reduce((sum, supplier) => sum + Math.round(money(supplier.balance)), 0),
    recipes: list(state.recipes).length,
  };
}

export function validateBranchExports(inputs: unknown): BranchExport[] {
  if (!Array.isArray(inputs) || !inputs.length) throw new MigrationError("Kamida bitta filial fayli tanlang.");
  const seen = new Set<string>();
  return inputs.map((input) => {
    if (!isBranchExport(input)) throw new MigrationError("Fayllardan biri HALO Control filial zaxirasi emas.");
    const file = input as BranchExport;
    const branchId = String(file.branchId || "");
    if (!BRANCH_ID.test(branchId)) throw new MigrationError(`Filial nomi noto'g'ri: ${branchId.slice(0, 40)}`);
    if (seen.has(branchId)) throw new MigrationError(`"${branchId}" filiali uchun ikkita fayl tanlangan.`);
    seen.add(branchId);
    if (!file.state || typeof file.state !== "object" || Array.isArray(file.state)) {
      throw new MigrationError(`${branchId}: faylda ma'lumot (state) yo'q yoki buzilgan.`);
    }
    if (!file.updatedAt || typeof file.updatedAt !== "string") throw new MigrationError(`${branchId}: fayl versiyasi (updatedAt) yo'q.`);
    return { format: file.format, branchId, exportedAt: String(file.exportedAt || ""), updatedAt: file.updatedAt, state: file.state };
  });
}

function payloadHasBusinessData(payload: string | undefined): boolean {
  if (!payload) return false;
  try {
    const state = JSON.parse(payload) as Row;
    return BUSINESS_KEYS.some((key) => Array.isArray(state[key]) && (state[key] as unknown[]).length > 0);
  } catch {
    return true;
  }
}

export async function importBranchExports(
  db: D1Like,
  inputs: unknown,
  options: { dryRun?: boolean; replaceExisting?: string; now?: Date; baseOnly?: string } = {},
): Promise<BranchImportReport> {
  const baseReports = new Map<string, BaseResetReport>();
  const files = validateBranchExports(inputs).map((file) => {
    if (!options.baseOnly) return file;
    // Noldan boshlash: fayldan faqat bazaviy ma'lumot olinadi, qoldiq/qarz/tarix nol.
    const { state, report } = toBaseState(file.state as Row, options.baseOnly);
    baseReports.set(file.branchId, report);
    return { ...file, state, updatedAt: `${(options.now || new Date()).toISOString()}-${crypto.randomUUID()}` };
  });
  const existing = new Map<string, { payload: string; updated_at: string }>();
  for (const file of files) {
    const row = await db.prepare("SELECT payload, updated_at FROM app_state WHERE id = ?").bind(file.branchId).first<{ payload: string; updated_at: string }>();
    if (row) existing.set(file.branchId, row);
  }
  const busy = files.filter((file) => payloadHasBusinessData(existing.get(file.branchId)?.payload));
  if (busy.length && options.replaceExisting !== REPLACE_CONFIRMATION) {
    throw new MigrationError(`Yangi saytda "${busy.map((file) => file.branchId).join(", ")}" filialida allaqachon savdo/ombor ma'lumoti bor. Ustidan yozish uchun alohida tasdiq ("${REPLACE_CONFIRMATION}") kerak.`);
  }

  const reports = (ok: boolean): BranchReport[] => files.map((file) => ({
    branchId: file.branchId, exportedAt: file.exportedAt, replaced: existing.has(file.branchId),
    summary: summarizeState(file.state), ok, base: baseReports.get(file.branchId),
  }));
  if (options.dryRun) return { dryRun: true, ok: true, branches: reports(true) };

  const now = (options.now || new Date()).toISOString();
  const statements: D1StatementLike[] = [];
  for (const file of files) {
    const previous = existing.get(file.branchId);
    if (previous) {
      // Yangi saytdagi avvalgi holat ham izsiz yo'qolmaydi: zaxira tarixiga yoziladi.
      statements.push(db.prepare(
        "INSERT INTO halo_state_backups (id, branch_id, revision, payload, actor, action, section, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), file.branchId, previous.updated_at, previous.payload, "Ko'chirish", "Eski saytdan ko'chirishdan oldingi holat", "Tizim", now));
    }
    statements.push(db.prepare(
      "INSERT INTO app_state (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    ).bind(file.branchId, JSON.stringify(file.state), file.updatedAt));
    statements.push(db.prepare(
      "INSERT OR IGNORE INTO halo_branches (id, name, address, active) VALUES (?, ?, '', 1)",
    ).bind(file.branchId, file.branchId === "main" ? "Asosiy filial" : `Filial ${file.branchId}`));
  }
  await db.batch(statements);

  const branches: BranchReport[] = [];
  for (const file of files) {
    const row = await db.prepare("SELECT payload, updated_at FROM app_state WHERE id = ?").bind(file.branchId).first<{ payload: string; updated_at: string }>();
    const ok = Boolean(row && row.payload === JSON.stringify(file.state) && row.updated_at === file.updatedAt);
    branches.push({
      branchId: file.branchId, exportedAt: file.exportedAt, replaced: existing.has(file.branchId),
      summary: row ? summarizeState(JSON.parse(row.payload) as Row) : summarizeState({}), ok,
      base: baseReports.get(file.branchId),
    });
  }
  return { dryRun: false, ok: branches.every((branch) => branch.ok), branches };
}

/**
 * Yangi saytdagi mavjud ma'lumotni joyida "noldan boshlash" holatiga keltirish (fayl kerak emas).
 * Har bir filialning avvalgi holati halo_state_backups'ga saqlanadi; hammasi bitta batch'da.
 */
export async function resetBranchesToBase(
  db: D1Like,
  options: { dryRun?: boolean; confirm?: string; startDate: string; now?: Date },
): Promise<BranchImportReport> {
  const rows = (await db.prepare("SELECT id, payload, updated_at FROM app_state ORDER BY id").all<{ id: string; payload: string; updated_at: string }>()).results;
  if (!rows.length) throw new MigrationError("Yangi saytda hali filial ma'lumoti yo'q — avval fayl orqali ko'chiring.");
  const now = (options.now || new Date()).toISOString();
  const planned = rows.map((row) => {
    let parsed: Row;
    try { parsed = JSON.parse(row.payload) as Row; } catch { throw new MigrationError(`${row.id}: saqlangan ma'lumot buzilgan.`); }
    const { state, report } = toBaseState(parsed, options.startDate);
    return { row, state, report, updatedAt: `${now}-${crypto.randomUUID()}` };
  });
  const branchReports = (ok: boolean): BranchReport[] => planned.map((p) => ({
    branchId: p.row.id, exportedAt: "", replaced: true, summary: summarizeState(p.state), ok, base: p.report,
  }));
  if (options.dryRun) return { dryRun: true, ok: true, branches: branchReports(true) };
  if (options.confirm !== BASE_RESET_CONFIRMATION) {
    throw new MigrationError(`Tasdiq uchun "${BASE_RESET_CONFIRMATION}" deb yozing.`);
  }
  const statements: D1StatementLike[] = [];
  for (const p of planned) {
    statements.push(db.prepare(
      "INSERT INTO halo_state_backups (id, branch_id, revision, payload, actor, action, section, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), p.row.id, p.row.updated_at, p.row.payload, "Ko'chirish", "Noldan boshlashdan oldingi holat", "Tizim", now));
    // Shu orada boshqa joydan yozilgan bo'lsa (masalan, do'kon planshetidan savdo) — ustidan yozilmaydi; tekshiruv "farq" deydi.
    statements.push(db.prepare("UPDATE app_state SET payload = ?, updated_at = ? WHERE id = ? AND updated_at = ?").bind(JSON.stringify(p.state), p.updatedAt, p.row.id, p.row.updated_at));
  }
  await db.batch(statements);
  const branches: BranchReport[] = [];
  for (const p of planned) {
    const row = await db.prepare("SELECT payload, updated_at FROM app_state WHERE id = ?").bind(p.row.id).first<{ payload: string; updated_at: string }>();
    const ok = Boolean(row && row.payload === JSON.stringify(p.state) && row.updated_at === p.updatedAt);
    branches.push({ branchId: p.row.id, exportedAt: "", replaced: true, summary: summarizeState(p.state), ok, base: p.report });
  }
  return { dryRun: false, ok: branches.every((b) => b.ok), branches };
}

export const BASE_RESET_CONFIRMATION = "NOLDAN_BOSHLA";
