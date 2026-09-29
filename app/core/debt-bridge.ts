/**
 * HALO V2 — qarz ko'prigi: eski suppliers + transactions → qarz daftari.
 * Eski qoida: qarz = ochilish qoldig'i + xaridlar − to'lovlar (MEZANA alohida, bu yerda emas).
 * Har bir yetkazib beruvchining SAQLANGAN qoldig'i daftar qoldig'i bilan solishtiriladi.
 */
import { isMezanaSupplierName } from "../lib/mezana-debts";
import { bridgeOperationId } from "./bridge";
import { assertScope, isIsoDate, LedgerError, type LedgerScope } from "./ledger";
import {
  debtMoveStatement, ensureDebtSchema, partyStatement, listParties, oldestUnpaidAll, partyBalances, validateDebtMove, type DebtMoveInput,
} from "./debts";
import type { D1Like, D1StatementLike } from "../lib/full-migration";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value)
  ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];

export function partyCode(oldId: string): string {
  const clean = oldId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "yetkazuvchi";
  let hash = 0;
  for (const char of oldId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `y-${clean}-${hash.toString(36).slice(0, 5)}`;
}

export interface PartyComparison { partyId: string; oldId: string; name: string; oldBalance: number; ledgerBalance: number; difference: number; oldestUnpaidDate: string | null; ageDays: number | null }
export interface DebtBridgeReport { posted: number; alreadyPosted: number; reversed: number; corrected: number; changed: string[]; invalid: string[]; parties: PartyComparison[]; totalDebt: number; mismatched: number }

export async function runDebtBridge(db: D1Like, scope: LedgerScope, state: Row, today: string, now = new Date()): Promise<DebtBridgeReport> {
  assertScope(scope);
  if (!isIsoDate(today)) throw new LedgerError("Sana noto'g'ri.");
  await ensureDebtSchema(db);
  const suppliers = rows(state.suppliers).filter((supplier) => typeof supplier.id === "string" && supplier.id && !isMezanaSupplierName(supplier.name));
  const idByOld = new Map(suppliers.map((supplier) => [String(supplier.id), `${scope.tenantId}:${scope.branchId}:${partyCode(String(supplier.id))}`]));
  const before = await listParties(db, scope);
  const missing = suppliers.filter((supplier) => !before.has(idByOld.get(String(supplier.id))!));
  for (let index = 0; index < missing.length; index += 90) {
    await db.batch(missing.slice(index, index + 90).map((supplier) => partyStatement(db, scope, partyCode(String(supplier.id)), String(supplier.name || supplier.id), now)));
  }
  const parties = missing.length ? await listParties(db, scope) : before;

  const existing = new Map((await db.prepare(
    "SELECT id, operation_id, party_id, date, kind, amount FROM v2_party_moves WHERE tenant_id = ? AND branch_id = ? AND operation_id LIKE 'bridge:%'",
  ).bind(scope.tenantId, scope.branchId).all<{ id: string; operation_id: string; party_id: string; date: string; kind: string; amount: number }>()).results.map((row) => [row.operation_id, row]));
  const reversedIds = new Set((await db.prepare("SELECT reverses_id FROM v2_party_moves WHERE tenant_id = ? AND branch_id = ? AND reverses_id IS NOT NULL")
    .bind(scope.tenantId, scope.branchId).all<{ reverses_id: string }>()).results.map((row) => row.reverses_id));

  // Versiyalar: asl amal raqami, keyin ":ver1"... Amaldagisi — bekor qilinmagan oxirgisi.
  const versions = new Map<string, number>();
  const live = new Map<string, { id: string; party_id: string; date: string; amount: number; version: number }>();
  for (const [operationId, row] of existing) {
    if (!operationId.startsWith("bridge:q:")) continue;
    const match = operationId.match(/^(.*):ver(\d+)$/);
    const base = match ? match[1] : operationId;
    const version = match ? Number(match[2]) : 0;
    versions.set(base, Math.max(versions.get(base) ?? -1, version));
    if (reversedIds.has(row.id)) continue;
    const current = live.get(base);
    if (!current || current.version < version) live.set(base, { ...row, version });
  }
  const reversalOf = (row: { id: string; party_id: string; amount: number }, memo: string): DebtMoveInput => ({
    operationId: `bridge:qrev:${row.id}`.slice(0, 120), partyId: row.party_id, date: today, kind: "reversal", amount: -Number(row.amount), actor: "Ko'prik", reversesId: row.id, memo,
  });

  const toPost: DebtMoveInput[] = [];
  const changed: string[] = [];
  const invalid: string[] = [];
  const wanted = new Set<string>();
  let alreadyPosted = 0;
  let corrected = 0;
  const transactions = rows(state.transactions);
  const firstDate = new Map<string, string>();
  for (const tx of transactions) {
    const partyId = idByOld.get(String(tx.supplierId));
    if (!partyId) continue;
    const date = String(tx.date || "");
    if (isIsoDate(date) && (!firstDate.has(partyId) || date < firstDate.get(partyId)!)) firstDate.set(partyId, date);
    const source = `qarz:${String(tx.id || "?")}`;
    const amount = Number(tx.amount);
    if ((tx.type !== "purchase" && tx.type !== "payment") || !Number.isSafeInteger(amount) || amount <= 0) { invalid.push(`${source}: turi yoki summasi noto'g'ri`); continue; }
    const signed = tx.type === "purchase" ? amount : -amount;
    const baseId = bridgeOperationId("q", String(tx.id));
    wanted.add(baseId);
    const previous = live.get(baseId);
    if (previous && previous.party_id === partyId && Number(previous.amount) === signed && previous.date === date) { alreadyPosted += 1; continue; }
    const nextVersion = (versions.get(baseId) ?? -1) + 1;
    try {
      const move = validateDebtMove({ operationId: nextVersion ? `${baseId}:ver${nextVersion}` : baseId, partyId, date, kind: tx.type as "purchase" | "payment", amount: signed, memo: String(tx.note || tx.description || "").slice(0, 200), actor: "Ko'prik" }, parties);
      if (previous) {
        changed.push(source);
        toPost.push(reversalOf(previous, `Eski tizimda o'zgartirildi: ${Math.abs(Number(previous.amount)).toLocaleString("en-US")} → ${amount.toLocaleString("en-US")} ₩`));
        corrected += 1;
      }
      toPost.push(move);
    } catch (error) {
      if (previous) changed.push(source);
      invalid.push(`${source}: ${error instanceof LedgerError ? error.message : "noto'g'ri"}`);
    }
  }

  // Ochilish qoldig'i: birinchi marta — "opening"; keyin o'zgarsa — farqi "adjustment" (sababi bilan).
  const openingSoFar = new Map<string, { total: number; count: number }>();
  for (const [operationId, row] of existing) {
    if (!operationId.startsWith("bridge:po:") && !operationId.startsWith("bridge:pa:")) continue;
    const item = openingSoFar.get(row.party_id) || { total: 0, count: 0 };
    item.total += Number(row.amount); item.count += 1;
    openingSoFar.set(row.party_id, item);
  }
  for (const supplier of suppliers) {
    const partyId = idByOld.get(String(supplier.id))!;
    const target = Number(supplier.openingBalance ?? 0);
    if (!Number.isSafeInteger(target)) { invalid.push(`ochilish:${String(supplier.id)}: butun won emas`); continue; }
    const so = openingSoFar.get(partyId) || { total: 0, count: 0 };
    const delta = target - so.total;
    if (!delta) continue;
    const edits = rows(supplier.balanceEdits);
    const reason = String(edits[0]?.reason || "").slice(0, 150);
    toPost.push({
      operationId: so.count === 0 ? `bridge:po:${partyCodeTail(partyId)}` : `bridge:pa:${partyCodeTail(partyId)}:${so.count}`,
      partyId, date: so.count === 0 ? (firstDate.get(partyId) || today) : today,
      kind: so.count === 0 ? "opening" : "adjustment", amount: delta, actor: "Ko'prik",
      memo: so.count === 0 ? "Boshlang'ich qarz (eski tizimdan)" : `Boshlang'ich qarz tuzatildi: ${so.total.toLocaleString("en-US")} → ${target.toLocaleString("en-US")} ₩${reason ? ` · ${reason}` : ""}`,
    });
  }

  // Eski tizimda o'chirilgan xarid/to'lov → teskari yozuv.
  for (const [base, row] of live) {
    if (wanted.has(base)) continue;
    toPost.push(reversalOf(row, "Bekor qilindi: eski tizimda o'chirilgan"));
  }

  const valid: DebtMoveInput[] = [];
  for (const move of toPost) {
    try { valid.push(validateDebtMove(move, parties)); } catch (error) { invalid.push(`${move.operationId}: ${error instanceof LedgerError ? error.message : "noto'g'ri"}`); }
  }
  toPost.length = 0;
  toPost.push(...valid);

  let chunk: D1StatementLike[] = [];
  for (const move of toPost) {
    chunk.push(debtMoveStatement(db, scope, move, now));
    if (chunk.length >= 90) { await db.batch(chunk); chunk = []; }
  }
  if (chunk.length) await db.batch(chunk);

  const balances = await partyBalances(db, scope);
  const oldestByParty = await oldestUnpaidAll(db, scope);
  const dayMs = 86_400_000;
  const partyRows: PartyComparison[] = [];
  for (const supplier of suppliers) {
    const partyId = idByOld.get(String(supplier.id))!;
    const ledgerBalance = balances.get(partyId) || 0;
    const oldBalance = Number(supplier.balance) || 0;
    const oldest = ledgerBalance > 0 ? oldestByParty.get(partyId) ?? null : null;
    partyRows.push({
      partyId, oldId: String(supplier.id), name: String(supplier.name || supplier.id), oldBalance, ledgerBalance, difference: ledgerBalance - oldBalance,
      oldestUnpaidDate: oldest, ageDays: oldest ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / dayMs) : null,
    });
  }
  partyRows.sort((left, right) => right.ledgerBalance - left.ledgerBalance);
  const reversed = toPost.filter((move) => move.kind === "reversal").length;
  return {
    posted: toPost.length - reversed, alreadyPosted, reversed, corrected, changed, invalid, parties: partyRows,
    totalDebt: partyRows.reduce((sum, row) => sum + Math.max(0, row.ledgerBalance), 0),
    mismatched: partyRows.filter((row) => row.difference !== 0).length,
  };
}

function partyCodeTail(partyId: string) {
  return partyId.split(":").pop()!;
}
