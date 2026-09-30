/**
 * HALO V2 — POS apparati kunlik hisobotini (Excel/CSV) yuklash. Karta va POS orqali naqd savdo shu yo'l bilan kiradi.
 *
 * Eski tizimdagi tekshirilgan qismlar qayta ishlatiladi:
 *  - fayl tahlili: app/pos-import.ts (OKPOS kunlik hisobot, ustunlarni avtomatik aniqlash, jami qatorni solishtirish);
 *  - takrorlanishni aniqlash: app/lib/pos-reconciliation.ts (har qatorning tashqi ID si);
 *  - tannarx, ombor va soliq: pos-terminal bilan bir xil (retsept tannarxi, ombor harakati, savdo paytidagi foizlar).
 * Farqi: hammasi SERVERDA — fayl serverda o'qiladi, taom retseptga serverda bog'lanadi, savdo serverda yoziladi.
 * Yangi bog'langan POS kodi retseptga "qo'shimcha kod" sifatida saqlanadi — keyingi safar o'zi taniladi.
 * Bir kunning hisobotini qayta yuklash (kun oxirida yangilangan fayl) — o'zgargan qatorlar eskisi o'rniga yoziladi.
 */
import { autoDetectPosColumns, extractPosTable, normalizeProductKey, parsePosRows, type ParsedPosRow, type PosTable, type SpreadsheetValue } from "../pos-import";
import { reconcilePosImport } from "../lib/pos-reconciliation";
import { recipeHasMenuCode } from "../lib/menu-codes";
import { calculateRecipeCostBreakdown } from "../lib/recipe-costing";
import { snapshotSaleFinancialRates } from "../lib/sale-financial-snapshots";
import { applySaleInventoryAccounting } from "../lib/inventory-accounting";
import { isAccountingMonthClosed } from "../lib/month-end";
import { removeSalesById } from "../lib/pos-terminal";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
const money = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; };

export class PosExcelError extends Error { constructor(message: string, public status = 400) { super(message); } }

export const MAX_POS_FILE_BYTES = 15 * 1024 * 1024;

export interface PosFileTable { table: PosTable; fileName: string }

/** Varaqlardan eng mos savdo jadvalini tanlaydi (sof funksiya — sinovda ham ishlatiladi). */
export function readPosSheets(sheets: Array<{ name: string; matrix: SpreadsheetValue[][] }>, fileName: string): PosFileTable {
  const tables = sheets.slice(0, 10).map((sheet) => extractPosTable(sheet.matrix, fileName, sheet.name))
    .filter((table) => table.headers.length && table.rows.length)
    .sort((left, right) => right.detectionScore - left.detectionScore || right.rows.length - left.rows.length);
  if (!tables[0]) throw new PosExcelError("Faylda savdo jadvali topilmadi.");
  return { table: tables[0], fileName };
}

/** CSV: vergul, nuqta-vergul yoki tab; qo'shtirnoqli maydonlar. */
export function parseCsv(text: string): SpreadsheetValue[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] || "";
  const delimiter = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) out.push(row);
      row = [];
      if (out.length > 25_002) break;
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) out.push(row);
  return out;
}

function decodeText(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* koreys POS CSV ko'pincha EUC-KR */ }
  try { return new TextDecoder("euc-kr").decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

/** Faylni o'qiydi: eng mos varaq va sarlavha qatori avtomatik topiladi. */
export async function readPosFile(data: ArrayBuffer | Uint8Array, fileName: string): Promise<PosFileTable> {
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) throw new PosExcelError("Faqat .xlsx, .xls yoki .csv fayl yuklang.");
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_POS_FILE_BYTES) throw new PosExcelError("Fayl 15 MB dan katta.");
  if (/\.csv$/i.test(fileName)) return readPosSheets([{ name: "CSV", matrix: parseCsv(decodeText(bytes)) }], fileName);
  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true, sheetRows: 25_002 });
    return readPosSheets(workbook.SheetNames.map((name) => ({
      name, matrix: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false }) as SpreadsheetValue[][],
    })), fileName);
  } catch (error) {
    if (error instanceof PosExcelError) throw error;
    throw new PosExcelError("Fayl ochilmadi. POS hisobotining .xlsx, .xls yoki .csv faylini tanlang.");
  }
}

export interface PosPreviewProduct {
  key: string; product: string; productCode: string; quantity: number; revenue: number;
  recipeId: string; recipeName: string; status: "new" | "saved" | "changed" | "unmatched" | "duplicate";
}
export interface PosPreview {
  fileName: string; date: string; dates: string[];
  products: PosPreviewProduct[];
  totals: { rows: number; quantity: number; revenue: number; newRevenue: number; newQuantity: number };
  counts: { new: number; saved: number; changed: number; unmatched: number; duplicate: number };
  summary?: { quantity: number; totalRevenue: number; parsedQuantity: number; parsedRevenue: number; matches: boolean };
  errors: string[];
  ready: boolean;
  recipes: Array<{ id: string; name: string }>;
  /** Shu kunlarga qo'lda kiritilgan POS savdolari (ikki marta hisoblanmasligi uchun ogohlantirish). */
  manualPos: { count: number; revenue: number };
}

type Resolved = ParsedPosRow & { recipeId: string; menuRevenue: number };

function resolveRows(state: Row, parsed: ParsedPosRow[], links: Record<string, string>): Resolved[] {
  const recipes = rows(state.recipes);
  const byName = new Map(recipes.map((recipe) => [normalizeProductKey(recipe.name), recipe]));
  return parsed.map((row) => {
    const linked = links[row.mappingKey] && recipes.find((recipe) => recipe.id === links[row.mappingKey]);
    const byCode = row.productCode ? recipes.find((recipe) => recipeHasMenuCode(recipe as never, row.productCode)) : undefined;
    const recipe = linked || byCode || (row.productKey ? byName.get(row.productKey) : undefined);
    return { ...row, recipeId: recipe ? String(recipe.id) : "", menuRevenue: recipe ? money(recipe.salePrice) * row.quantity : 0 };
  });
}

function analyse(state: Row, file: PosFileTable, links: Record<string, string>, today: string) {
  const mapping = autoDetectPosColumns(file.table.headers);
  if (!mapping.quantity || (!mapping.productCode && !mapping.product)) {
    // Kod ustuni topilmasa — nom ustuni bilan ishlaymiz.
    const nameHeader = file.table.headers.find((header) => /상품명|메뉴명|품목명|product|item|menu|taom|mahsulot/i.test(header));
    if (nameHeader) mapping.product = nameHeader;
  }
  if (!mapping.quantity) throw new PosExcelError("Faylda “수량 / soni” ustuni topilmadi. POS'dan “상품별 매출” hisobotini yuklang.");
  if (!mapping.productCode && !mapping.product) throw new PosExcelError("Faylda taom kodi yoki nomi ustuni topilmadi.");
  const parsed = parsePosRows(file.table, mapping, today);
  const resolved = resolveRows(state, parsed.rows, links);
  const reconciled = reconcilePosImport(resolved, rows(state.sales) as never, { compareRevenue: true });
  return { parsed, reconciled };
}

export function previewPosImport(state: Row, file: PosFileTable, links: Record<string, string>, today: string): PosPreview {
  const { parsed, reconciled } = analyse(state, file, links, today);
  const recipes = rows(state.recipes);
  const products = new Map<string, PosPreviewProduct>();
  for (const row of reconciled.rows) {
    const status: PosPreviewProduct["status"] = !row.recipeId ? "unmatched"
      : row.conflict === "changed" ? "changed" : row.conflict ? "duplicate" : row.status === "saved" ? "saved" : "new";
    const current = products.get(row.mappingKey);
    const recipe = recipes.find((entry) => entry.id === row.recipeId);
    const rank = { unmatched: 5, duplicate: 4, changed: 3, new: 2, saved: 1 };
    products.set(row.mappingKey, {
      key: row.mappingKey, product: row.product, productCode: row.productCode,
      quantity: (current?.quantity || 0) + row.quantity, revenue: (current?.revenue || 0) + row.importRevenue,
      recipeId: row.recipeId, recipeName: recipe ? String(recipe.name) : "",
      status: current && rank[current.status] > rank[status] ? current.status : status,
    });
  }
  const list = [...products.values()].sort((left, right) => (left.status === "unmatched" ? -1 : 0) - (right.status === "unmatched" ? -1 : 0) || right.revenue - left.revenue);
  const count = (status: PosPreviewProduct["status"]) => list.filter((item) => item.status === status).length;
  const dates = [...new Set(reconciled.rows.map((row) => row.date))].sort();
  const pending = reconciled.rows.filter((row) => row.recipeId && (row.status === "new" || row.conflict === "changed"));
  const errors = [...parsed.errors];
  if (parsed.summary && !parsed.summary.matches) errors.push("Faylning “합계 / jami” qatori taomlar yig'indisiga mos emas. Hisobotni POS'dan qayta oling.");
  if (reconciled.rows.some((row) => row.conflict === "file_duplicate" || row.conflict === "saved_duplicate")) errors.push("Faylda bir xil qator ikki marta bor. Asl hisobotni qayta yuklang.");
  if (!reconciled.rows.length) errors.push("Faylda savdo qatori topilmadi.");
  const unmatched = count("unmatched");
  const dateSet = new Set(dates);
  const manual = rows(state.sales).filter((sale) => dateSet.has(String(sale.date)) && sale.salesChannel === "pos" && !sale.posImport
    && String(sale.id || "").startsWith("pos-terminal-sale:") && !sale.cancelledAt && !sale.voided);
  return {
    manualPos: { count: manual.length, revenue: manual.reduce((sum, sale) => sum + money(sale.totalRevenue), 0) },
    fileName: file.fileName, date: dates[0] || today, dates, products: list,
    totals: {
      rows: reconciled.rows.length,
      quantity: reconciled.rows.reduce((sum, row) => sum + row.quantity, 0),
      revenue: reconciled.rows.reduce((sum, row) => sum + row.importRevenue, 0),
      newRevenue: pending.reduce((sum, row) => sum + row.importRevenue, 0),
      newQuantity: pending.reduce((sum, row) => sum + row.quantity, 0),
    },
    counts: { new: count("new"), saved: count("saved"), changed: count("changed"), unmatched, duplicate: count("duplicate") },
    summary: parsed.summary,
    errors,
    ready: !errors.length && !unmatched && pending.length > 0,
    recipes: recipes.filter((recipe) => recipe.id && recipe.name).map((recipe) => ({ id: String(recipe.id), name: String(recipe.name) })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Importni qo'llash. Yangi qatorlar yoziladi; o'zgargan qatorlar (shu kunning yangilangan hisoboti)
 * eskisi o'chirilib (ombor qaytib) yangisi yoziladi; oldin saqlangan bir xil qatorlar tegilmaydi.
 */
export function applyPosImport(
  state: Row, file: PosFileTable, links: Record<string, string>,
  input: { accountId: string; actor: { id: string; name: string }; createdAt: string; today: string },
): { state: Row; result: { saved: number; replaced: number; skipped: number; revenue: number; date: string } } {
  const { parsed, reconciled } = analyse(state, file, links, input.today);
  if (parsed.errors.length) throw new PosExcelError(parsed.errors[0]);
  if (parsed.summary && !parsed.summary.matches) throw new PosExcelError("Faylning jami qatori taomlar yig'indisiga mos emas.");
  if (reconciled.unmatchedRows.length) throw new PosExcelError("Avval hamma taomni retseptga bog'lang.");
  if (reconciled.rows.some((row) => row.conflict === "file_duplicate" || row.conflict === "saved_duplicate")) throw new PosExcelError("Faylda takror qatorlar bor.");
  const accounts = rows(state.accounts);
  const account = accounts.find((entry) => entry.id === input.accountId);
  if (!account || !["card", "cash"].includes(String(account.type))) throw new PosExcelError("Pul qayerga tushganini tanlang: karta yoki naqd.");
  const accountType = String(account.type);
  for (const row of reconciled.rows) {
    if (row.date > input.today) throw new PosExcelError(`${row.date} — kelajak sanasi.`);
    if (isAccountingMonthClosed(state.monthlyCloses, row.date)) throw new PosExcelError(`${row.date.slice(0, 7)} oyi yopilgan.`, 409);
  }

  // Yangi POS kodlari retseptga qo'shimcha kod sifatida saqlanadi.
  let recipes = rows(state.recipes);
  for (const [key, recipeId] of Object.entries(links)) {
    if (!key.startsWith("code:") || !recipeId) continue;
    const code = key.slice(5);
    recipes = recipes.map((recipe) => recipe.id !== recipeId || recipeHasMenuCode(recipe as never, code) ? recipe
      : { ...recipe, posAliases: [...(Array.isArray(recipe.posAliases) ? recipe.posAliases as string[] : []), code].slice(0, 30) });
  }

  // O'zgargan qatorlar: eski savdolar olib tashlanadi (ombor qaytadi).
  const changedIds = new Set(reconciled.rows.filter((row) => row.conflict === "changed").map((row) => row.externalId));
  let working: Row = { ...state, recipes };
  const oldSaleIds = new Set(rows(state.sales).filter((sale) => changedIds.has(String(sale.externalId || ""))).map((sale) => String(sale.id)));
  if (oldSaleIds.size) working = removeSalesById(working, oldSaleIds);

  const toSave = reconciled.rows.filter((row) => row.recipeId && (row.status === "new" || row.conflict === "changed"));
  if (!toSave.length) throw new PosExcelError("Yangi savdo yo'q — bu hisobot oldin to'liq yuklangan.", 409);
  const inventory = rows(working.inventory);
  const inventoryById = new Map(inventory.map((item) => [String(item.id), item]));
  const rules = working.costRules as Row | undefined;
  const taxPct = Math.min(100, Math.max(0, Number(rules?.taxPct) || 0));
  const deducted = new Map<string, number>();
  const sales: Row[] = [];
  const movements: Row[] = [];
  const batch = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  toSave.forEach((row, index) => {
    const recipe = recipes.find((entry) => entry.id === row.recipeId)!;
    const saleId = `pos-import-sale:${batch}:${index}`;
    const usage = new Map<string, number>();
    for (const ingredient of rows(recipe.ingredients)) {
      const inventoryId = String(ingredient.inventoryId || "");
      const required = Number(ingredient.quantity) * row.quantity;
      if (!inventoryById.has(inventoryId) || !Number.isFinite(required) || required <= 0) continue;
      usage.set(inventoryId, (usage.get(inventoryId) || 0) + required);
    }
    const stockUsage = [...usage].map(([inventoryId, quantity]) => {
      deducted.set(inventoryId, (deducted.get(inventoryId) || 0) + quantity);
      const unitCostAtSale = money(inventoryById.get(inventoryId)?.unitCost);
      return { inventoryId, quantity, unitCostAtSale, totalCostAtSale: quantity * unitCostAtSale };
    });
    const totalCost = calculateRecipeCostBreakdown(
      rows(recipe.ingredients).map((ingredient) => ({ inventoryId: String(ingredient.inventoryId || ""), quantity: Number(ingredient.quantity || 0), unitCost: money(ingredient.unitCost), lineCost: money(ingredient.lineCost) })),
      inventory.map((entry) => ({ ...entry, id: String(entry.id), unitCost: money(entry.unitCost) })) as never,
      rows(recipe.extraCosts).map((entry) => ({ amount: money(entry.amount) })),
    ).totalCost * row.quantity;
    const totalRevenue = Math.round(row.importRevenue);
    const sale = snapshotSaleFinancialRates({
      id: saleId, recipeId: row.recipeId, quantity: row.quantity,
      unitPrice: row.quantity ? totalRevenue / row.quantity : 0, totalRevenue, totalCost,
      revenueSource: row.revenueSource, date: row.date, source: "pos", salesChannel: "pos", taxTreatment: "automatic",
      externalId: row.externalId, accountId: String(account.id), stockUsage,
      posImport: { batch, fileName: file.fileName.slice(0, 120), rowNumber: row.rowNumber, productCode: row.productCode, product: row.product.slice(0, 120) },
      createdByName: input.actor.name.slice(0, 80), createdAt: input.createdAt,
    }, accountType, rules as never);
    sales.push({ ...sale, taxPctAtSale: taxPct });
    stockUsage.forEach((entry, movementIndex) => movements.push({
      id: `pos-import-movement:${batch}:${index}:${movementIndex}`, inventoryId: entry.inventoryId, type: "sale",
      quantity: -entry.quantity, date: row.date, note: `POS HISOBOT · ${String(recipe.name).slice(0, 80)} × ${row.quantity}`, referenceId: saleId,
    }));
  });

  const next = applySaleInventoryAccounting(working, {
    ...working,
    inventory: inventory.map((item) => { const minus = deducted.get(String(item.id)) || 0; return minus ? { ...item, stock: Number(item.stock || 0) - minus } : item; }),
    sales: [...sales, ...rows(working.sales)],
    stockMovements: [...movements, ...rows(working.stockMovements)],
  });
  return {
    state: next,
    result: {
      saved: toSave.length, replaced: oldSaleIds.size, skipped: reconciled.savedRows.length,
      revenue: sales.reduce((sum, sale) => sum + Number(sale.totalRevenue || 0), 0),
      date: toSave[0].date,
    },
  };
}
