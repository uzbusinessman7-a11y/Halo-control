/**
 * HALO V2 — maosh ko'prigi: eski staff / workShifts / attendanceDays / payrollAdjustments /
 * payrollPayments → maosh daftari.
 *
 * Har bir yozuvning manbasi (source_key) bor: ish kuni, haq to'lanadigan dam kuni, bonus/ushlanma/avans,
 * to'lov yoki oy yaxlitlashi. Eski tizimda yozuv o'zgarsa — eski versiya teskari yozuv bilan yopiladi
 * va yangi versiya qo'shiladi (tarix saqlanadi). Bekor qilingan/o'chirilgan yozuv — teskari yozuv.
 * Natija har bir xodim va oy uchun eski calculatePayroll() qoldig'i bilan wonma-won solishtiriladi.
 */
import {
  calculatePayroll, calculateWorkdayPayEntries, conflictingWorkShiftIds, normalizeAttendanceDays, normalizePayrollAdjustments,
  normalizePayrollPayments, normalizeStaff, normalizeWorkShifts, staffHourlyRate, workShiftCalendarDate,
  type WorkShift,
} from "../lib/payroll";
import { assertScope, isIsoDate, LedgerError, type LedgerScope } from "./ledger";
import {
  employeeStatement, ensurePayrollSchema, hoursText, listEmployees, monthBalances, payMoveStatement, validatePayMove,
  type PayMoveInput, type PayMoveKind,
} from "./payroll-ledger";
import type { D1Like, D1StatementLike } from "../lib/full-migration";

type Row = Record<string, unknown>;

function hash36(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(36);
}

export function employeeCode(oldId: string): string {
  const clean = oldId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "xodim";
  return `x-${clean}-${hash36(oldId, 2166136261).slice(0, 5)}`;
}

/** Manba kaliti + versiya → barqaror amal raqami (uzun/g'alati ID'lar ham xavfsiz). */
export function payOperationId(sourceKey: string, version: number): string {
  return `bridge:w:${hash36(sourceKey, 2166136261)}${hash36(sourceKey, 374761393)}:${version}`;
}

interface Desired { employeeId: string; month: string; sourceKey: string; date: string; kind: PayMoveKind; amount: number; minutes: number; memo: string }

export interface PayMonthComparison {
  month: string; oldRemaining: number; ledgerRemaining: number; difference: number;
  earned: number; bonus: number; deduction: number; advance: number; paid: number; workedDays: number; workedMinutes: number;
}
export interface PayEmployeeRow { employeeId: string; oldId: string; name: string; active: boolean; months: PayMonthComparison[] }
export interface PayrollBridgeReport {
  posted: number; alreadyPosted: number; reversed: number; corrected: number;
  invalid: string[]; employees: PayEmployeeRow[]; mismatched: number;
  /** O'tgan oylarda to'lanmay qolgan maosh. */
  unpaidPast: Array<{ employeeId: string; name: string; month: string; amount: number }>;
  /** Ortiqcha to'langan oylar. */
  overpaid: Array<{ employeeId: string; name: string; month: string; amount: number }>;
  /** Pul hisobidan chiqmagan (faqat maoshdan ayirilgan) avans yozuvlari. */
  advancesWithoutCash: number;
}

const LEAVE_LABEL: Record<string, string> = { off: "Dam olish kuni (haq to'lanadi)", sick: "Kasal (haq to'lanadi)", absent: "Kelmagan (haq to'lanadi)" };
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

function canonical(shifts: WorkShift[]): WorkShift[] {
  return shifts.flatMap((shift) => {
    const date = workShiftCalendarDate(shift);
    return date ? [date === shift.date ? shift : { ...shift, date }] : [];
  });
}

export async function runPayrollBridge(db: D1Like, scope: LedgerScope, state: Row, today: string, now = new Date()): Promise<PayrollBridgeReport> {
  assertScope(scope);
  if (!isIsoDate(today)) throw new LedgerError("Sana noto'g'ri.");
  await ensurePayrollSchema(db);
  const currentMonth = today.slice(0, 7);
  const staff = normalizeStaff(state.staff);
  const shifts = normalizeWorkShifts(state.workShifts);
  const adjustments = normalizePayrollAdjustments(state.payrollAdjustments);
  const attendance = normalizeAttendanceDays(state.attendanceDays);
  const payments = normalizePayrollPayments(state.payrollPayments);

  const idByOld = new Map(staff.map((member) => [member.id, `${scope.tenantId}:${scope.branchId}:${employeeCode(member.id)}`]));
  const before = await listEmployees(db, scope);
  const missing = staff.filter((member) => !before.has(idByOld.get(member.id)!));
  for (let index = 0; index < missing.length; index += 90) {
    await db.batch(missing.slice(index, index + 90).map((member) => employeeStatement(db, scope, employeeCode(member.id), member.name, now)));
  }
  const employees = missing.length ? await listEmployees(db, scope) : before;

  const invalid: string[] = [];
  const desired = new Map<string, Desired>();
  const oldRemaining = new Map<string, number>();
  const monthsOf = new Map<string, Set<string>>();
  const want = (item: Desired) => {
    if (item.amount === 0) return;
    if (!Number.isSafeInteger(item.amount)) { invalid.push(`${item.sourceKey}: butun won emas (${item.amount})`); return; }
    desired.set(item.sourceKey, item);
  };
  const addMonth = (staffId: string, month: string) => {
    if (month > currentMonth) return;
    const set = monthsOf.get(staffId) || new Set<string>();
    set.add(month);
    monthsOf.set(staffId, set);
  };
  const known = new Set(staff.map((member) => member.id));
  for (const shift of canonical(shifts)) if (known.has(shift.staffId)) addMonth(shift.staffId, shift.date.slice(0, 7));
  for (const day of attendance) if (known.has(day.staffId)) addMonth(day.staffId, day.date.slice(0, 7));
  for (const entry of adjustments) {
    if (!known.has(entry.staffId)) { if (!entry.voided) invalid.push(`maosh:${entry.id}: xodim topilmadi`); continue; }
    addMonth(entry.staffId, entry.date.slice(0, 7));
  }
  for (const payment of payments) {
    if (!known.has(payment.staffId)) { if (!payment.voided) invalid.push(`tolov:${payment.id}: xodim topilmadi`); continue; }
    addMonth(payment.staffId, payment.month);
  }

  let advancesWithoutCash = 0;
  for (const member of staff) {
    const employeeId = idByOld.get(member.id)!;
    const memberShifts = canonical(shifts).filter((shift) => shift.staffId === member.id && shift.status !== "void");
    const conflictIds = new Set(conflictingWorkShiftIds(memberShifts));
    const conflictDates = new Set(memberShifts.filter((shift) => conflictIds.has(shift.id)).map((shift) => shift.date));
    for (const month of [...(monthsOf.get(member.id) || [])].sort()) {
      const summary = calculatePayroll(member, shifts, adjustments, month, { attendanceDays: attendance, payments, now });
      oldRemaining.set(`${employeeId}|${month}`, Math.round(summary.remaining));

      // 1) Ish kunlari — xuddi eski hisob-kitob kabi (ochiq smena va ustma-ust smena kunlari hisobga olinmaydi).
      const memberMonthShifts = memberShifts.filter((shift) => shift.date.startsWith(`${month}-`));
      const openDates = new Set(memberMonthShifts.filter((shift) => shift.status === "open").map((shift) => shift.date));
      const monthShifts = memberMonthShifts.filter((shift) => shift.status === "closed" && !openDates.has(shift.date) && !conflictDates.has(shift.date));
      let dayTotal = 0;
      for (const entry of calculateWorkdayPayEntries(member, monthShifts, now, memberShifts)) {
        if (entry.open || entry.conflict || !entry.roundedTotalPay) continue;
        dayTotal += entry.roundedTotalPay;
        const overtime = entry.overtimeMinutes > 0 ? ` · ortiqcha ${hoursText(Math.round(entry.overtimeMinutes))}` : "";
        want({
          employeeId, month, sourceKey: `d:${member.id}:${entry.date}`, date: entry.date, kind: "earned",
          amount: entry.roundedTotalPay, minutes: Math.round(entry.payableMinutes), memo: `Ish: ${hoursText(Math.round(entry.payableMinutes))}${overtime}`,
        });
      }

      // 2) Haq to'lanadigan dam/kasal kunlari.
      const occupied = new Set(memberMonthShifts.map((shift) => shift.date));
      for (const day of attendance) {
        if (day.staffId !== member.id || day.voided || !day.date.startsWith(`${month}-`) || occupied.has(day.date) || day.payMode !== "planned") continue;
        const minutes = day.plannedMinutesAtDay > 0 ? day.plannedMinutesAtDay : Math.round(member.dailyHours * 60);
        const rate = day.hourlyRateAtDay > 0 ? day.hourlyRateAtDay : staffHourlyRate(member);
        const amount = Math.round(minutes / 60 * rate);
        dayTotal += amount;
        want({ employeeId, month, sourceKey: `l:${day.id}`, date: day.date, kind: "paid_leave", amount, minutes: 0, memo: `${LEAVE_LABEL[day.status] || "Dam"} · ${hoursText(minutes)}` });
      }

      // 3) Yaxlitlash: oy bo'yicha hisoblangan summa eski tizimdagi bilan wonma-won teng bo'lishi uchun.
      want({
        employeeId, month, sourceKey: `r:${member.id}:${month}`, date: monthEnd(month), kind: "rounding",
        amount: Math.round(summary.basePay) - dayTotal, minutes: 0, memo: "Oy bo'yicha yaxlitlash",
      });
    }
  }

  // 4) Bonus, ushlanma, avans (eski maosh tuzatishlari). Bekor qilingani kiritilmaydi.
  for (const entry of adjustments) {
    const employeeId = idByOld.get(entry.staffId);
    if (!employeeId || entry.voided || entry.date.slice(0, 7) > currentMonth) continue;
    if (entry.type === "advance") advancesWithoutCash += 1;
    const sign = entry.type === "bonus" ? 1 : -1;
    want({
      employeeId, month: entry.date.slice(0, 7), sourceKey: `j:${entry.id}`, date: entry.date, kind: entry.type, amount: sign * entry.amount, minutes: 0,
      memo: entry.type === "advance" ? `Avans (pul hisobidan chiqmagan)${entry.note ? ` · ${entry.note}` : ""}` : entry.note,
    });
  }

  // 5) To'lovlar (pul hisobidan chiqqan avans va oylik).
  for (const payment of payments) {
    const employeeId = idByOld.get(payment.staffId);
    if (!employeeId || payment.voided || payment.month > currentMonth) continue;
    want({
      employeeId, month: payment.month, sourceKey: `p:${payment.id}`, date: payment.date, kind: "payment", amount: -payment.amount, minutes: 0,
      memo: `${payment.kind === "advance" ? "Avans to'lovi" : "Oylik to'lovi"}${payment.note ? ` · ${payment.note}` : ""}`,
    });
  }

  // Daftardagi amaldagi (bekor qilinmagan) versiyalar.
  const bridgeRows = (await db.prepare(
    "SELECT id, employee_id, month, source_key, date, kind, amount, minutes, reverses_id FROM v2_pay_moves WHERE tenant_id = ? AND branch_id = ? AND operation_id LIKE 'bridge:%'",
  ).bind(scope.tenantId, scope.branchId).all<{ id: string; employee_id: string; month: string; source_key: string; date: string; kind: PayMoveKind; amount: number; minutes: number; reverses_id: string | null }>()).results;
  const reversedIds = new Set(bridgeRows.map((row) => row.reverses_id).filter(Boolean));
  const versions = new Map<string, number>();
  const live = new Map<string, (typeof bridgeRows)[number]>();
  for (const row of bridgeRows) {
    if (row.kind === "reversal") continue;
    versions.set(row.source_key, (versions.get(row.source_key) || 0) + 1);
    if (!reversedIds.has(row.id)) live.set(row.source_key, row);
  }

  const toPost: PayMoveInput[] = [];
  let alreadyPosted = 0;
  let corrected = 0;
  for (const key of new Set([...desired.keys(), ...live.keys()])) {
    const target = desired.get(key);
    const have = live.get(key);
    const same = target && have && have.employee_id === target.employeeId && have.month === target.month && have.kind === target.kind
      && Number(have.amount) === target.amount && have.date === target.date && Number(have.minutes) === target.minutes;
    if (same) { alreadyPosted += 1; continue; }
    if (have) {
      toPost.push({
        operationId: `bridge:wrev:${have.id}`.slice(0, 120), employeeId: have.employee_id, month: have.month, sourceKey: key, date: today,
        kind: "reversal", amount: -Number(have.amount), minutes: 0, actor: "Ko'prik", reversesId: have.id,
        memo: target ? `Eski tizimda o'zgartirildi: ${Number(have.amount).toLocaleString("en-US")} → ${target.amount.toLocaleString("en-US")} ₩` : "Bekor qilindi: eski tizimda o'chirilgan yoki bekor qilingan",
      });
      if (target) corrected += 1;
    }
    if (target) toPost.push({ ...target, operationId: payOperationId(key, versions.get(key) || 0), actor: "Ko'prik" });
  }

  const valid: PayMoveInput[] = [];
  for (const move of toPost) {
    try { valid.push(validatePayMove(move, employees)); } catch (error) { invalid.push(`${move.sourceKey}: ${error instanceof LedgerError ? error.message : "noto'g'ri"}`); }
  }
  let chunk: D1StatementLike[] = [];
  for (const move of valid) {
    chunk.push(payMoveStatement(db, scope, move, now));
    if (chunk.length >= 90) { await db.batch(chunk); chunk = []; }
  }
  if (chunk.length) await db.batch(chunk);

  // Solishtirish: har bir xodim va oy.
  const balances = await monthBalances(db, scope);
  const liveRows = (await db.prepare(
    "SELECT id, employee_id, month, kind, amount, minutes, date, reverses_id FROM v2_pay_moves WHERE tenant_id = ? AND branch_id = ?",
  ).bind(scope.tenantId, scope.branchId).all<{ id: string; employee_id: string; month: string; kind: PayMoveKind; amount: number; minutes: number; date: string; reverses_id: string | null }>()).results;
  const dead = new Set(liveRows.map((row) => row.reverses_id).filter(Boolean));
  const totals = new Map<string, PayMonthComparison>();
  for (const row of liveRows) {
    if (row.kind === "reversal" || dead.has(row.id)) continue;
    const key = `${row.employee_id}|${row.month}`;
    const item = totals.get(key) || { month: row.month, oldRemaining: 0, ledgerRemaining: 0, difference: 0, earned: 0, bonus: 0, deduction: 0, advance: 0, paid: 0, workedDays: 0, workedMinutes: 0 };
    const amount = Number(row.amount);
    if (row.kind === "earned" || row.kind === "paid_leave" || row.kind === "rounding") item.earned += amount;
    if (row.kind === "bonus") item.bonus += amount;
    if (row.kind === "deduction") item.deduction -= amount;
    if (row.kind === "advance") item.advance -= amount;
    if (row.kind === "payment") item.paid -= amount;
    if (row.kind === "earned" && Number(row.minutes) > 0) { item.workedDays += 1; item.workedMinutes += Number(row.minutes); }
    totals.set(key, item);
  }
  const rowsOut: PayEmployeeRow[] = [];
  const unpaidPast: PayrollBridgeReport["unpaidPast"] = [];
  const overpaid: PayrollBridgeReport["overpaid"] = [];
  for (const member of staff) {
    const employeeId = idByOld.get(member.id)!;
    const months = new Set<string>([...(monthsOf.get(member.id) || [])]);
    for (const key of balances.keys()) if (key.startsWith(`${employeeId}|`)) months.add(key.slice(employeeId.length + 1));
    const list = [...months].sort().reverse().map((month) => {
      const key = `${employeeId}|${month}`;
      const base = totals.get(key) || { month, oldRemaining: 0, ledgerRemaining: 0, difference: 0, earned: 0, bonus: 0, deduction: 0, advance: 0, paid: 0, workedDays: 0, workedMinutes: 0 };
      const ledgerRemaining = balances.get(key) || 0;
      const old = oldRemaining.get(key) || 0;
      if (month < currentMonth && ledgerRemaining > 0) unpaidPast.push({ employeeId, name: member.name, month, amount: ledgerRemaining });
      if (ledgerRemaining < 0) overpaid.push({ employeeId, name: member.name, month, amount: -ledgerRemaining });
      return { ...base, month, oldRemaining: old, ledgerRemaining, difference: ledgerRemaining - old };
    });
    rowsOut.push({ employeeId, oldId: member.id, name: member.name, active: member.active, months: list });
  }
  rowsOut.sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name));
  const reversed = valid.filter((move) => move.kind === "reversal").length;
  return {
    posted: valid.length - reversed, alreadyPosted, reversed, corrected, invalid, employees: rowsOut,
    mismatched: rowsOut.reduce((count, row) => count + row.months.filter((month) => month.difference !== 0).length, 0),
    unpaidPast, overpaid, advancesWithoutCash,
  };
}
