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
