/**
 * HALO V2 — xodimlar: ro'yxat, ish haqi sharti, qo'lda smena, bonus/ushlanma va to'lov (avans/oylik).
 *
 * Shaffoflik qoidasi: AVANS faqat pul hisobidan chiqqan to'lov sifatida yoziladi (kassa yoki bank).
 * Eski tizimda avansni "maoshdan ayirish" yozuvi sifatida kassaga tegmasdan kiritish mumkin edi —
 * bu pul qayerdan berilganini yashiradi. Bu yerda bunday yo'l yo'q.
 */
import { conflictingWorkShiftIds, normalizeStaff, normalizeWorkShifts, staffHourlyRate } from "../lib/payroll";
import { isAccountingMonthClosed } from "../lib/month-end";
import { seoulLocalDateTimeToIso } from "../lib/business-time";

type Row = Record<string, unknown>;
export class StaffError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const opId = (body: Row) => {
  const op = clean(body.operationId, 36);
  if (!/^[a-f0-9-]{36}$/.test(op)) throw new StaffError("Oynani yangilang.");
  return op;
};

export function staffList(state: Row) {
  return normalizeStaff(state.staff).map((member) => ({
    id: member.id, name: member.name, payType: member.payType, hourlyRate: member.hourlyRate, monthlySalary: member.monthlySalary,
    workDays: member.workDays, dailyHours: member.dailyHours, overtimeAfterHours: member.overtimeAfterHours, overtimeMultiplier: member.overtimeMultiplier,
    active: member.active, effectiveHourlyRate: Math.round(staffHourlyRate(member)), hasAccount: Boolean(member.workerId),
  })).sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name));
}

export function saveStaffMember(state: Row, body: Row) {
  const staff = rows(state.staff);
  let id = clean(body.id, 100);
  if (!id) {
    id = `staff-${opId(body).slice(0, 13)}`;
    const again = staff.find((member) => member.id === id);
    if (again) return { state, result: { member: again, created: false } };
  }
  const current = staff.find((member) => member.id === id);
  if (clean(body.id, 100) && !current) throw new StaffError("Xodim topilmadi.", 404);
  const name = clean(body.name, 60);
  if (name.length < 2) throw new StaffError("Ismini yozing.");
  if (staff.some((member) => member.id !== id && member.active !== false && String(member.name).toLowerCase() === name.toLowerCase())) throw new StaffError(`«${name}» ismli faol xodim bor.`, 409);
  const payType = body.payType === "monthly" ? "monthly" : "hourly";
  const hourlyRate = Number(body.hourlyRate || 0);
  const monthlySalary = Number(body.monthlySalary || 0);
  if (payType === "hourly" && (!Number.isSafeInteger(hourlyRate) || hourlyRate <= 0 || hourlyRate > 1_000_000)) throw new StaffError("Soatlik stavkani yozing.");
  if (payType === "monthly" && (!Number.isSafeInteger(monthlySalary) || monthlySalary <= 0 || monthlySalary > 100_000_000)) throw new StaffError("Oylik maoshni yozing.");
  const draft = {
    ...(current || {}), id, name, payType, hourlyRate: payType === "hourly" ? hourlyRate : 0, monthlySalary: payType === "monthly" ? monthlySalary : 0,
    workDays: Number(body.workDays || current?.workDays || 26), dailyHours: Number(body.dailyHours || current?.dailyHours || 8),
    overtimeAfterHours: Number(body.overtimeAfterHours || current?.overtimeAfterHours || body.dailyHours || 8),
    overtimeMultiplier: Number(body.overtimeMultiplier || current?.overtimeMultiplier || 1),
    active: body.active !== false, workerId: String(current?.workerId || ""),
  };
  const [member] = normalizeStaff([draft]);
  if (!member) throw new StaffError("Xodim ma'lumotini tekshiring.");
  const saved = { ...draft, ...member, updatedAt: new Date().toISOString() };
  return {
    state: { ...state, staff: current ? staff.map((entry) => (entry.id === id ? saved : entry)) : [...staff, saved] },
    result: { member: saved, created: !current },
  };
}

/** Rahbar qo'lda smena kiritadi (xodim telefondan belgilamagan kun uchun). */
export function addShift(state: Row, body: Row, today: string) {
  const op = opId(body);
  const id = `v2-shift:${op}`;
  const shifts = rows(state.workShifts);
  if (shifts.some((shift) => shift.id === id)) return { state, result: { alreadySaved: true } };
  const member = normalizeStaff(state.staff).find((entry) => entry.id === clean(body.staffId, 100));
  if (!member || !member.active) throw new StaffError("Xodimni tanlang.");
  const date = clean(body.date, 10);
  const from = clean(body.from, 5);
  const to = clean(body.to, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new StaffError("Sanani tekshiring.");
  if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) throw new StaffError("Boshlanish va tugash vaqtini yozing.");
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new StaffError(`${date.slice(0, 7)} oyi yopilgan.`, 409);
  const clockIn = seoulLocalDateTimeToIso(`${date}T${from}`);
  let clockOut = seoulLocalDateTimeToIso(`${date}T${to}`);
  if (!clockIn || !clockOut) throw new StaffError("Vaqtni tekshiring.");
  if (Date.parse(clockOut) <= Date.parse(clockIn)) clockOut = new Date(Date.parse(clockOut) + 86_400_000).toISOString();
  const hours = (Date.parse(clockOut) - Date.parse(clockIn)) / 3_600_000;
  if (hours > 18) throw new StaffError("Smena 18 soatdan uzun bo'lmaydi.");
  const breakMinutes = Math.max(0, Math.min(240, Math.round(Number(body.breakMinutes || 0))));
  const shift = {
    id, staffId: member.id, date, clockIn, clockOut, breakMinutes,
    hourlyRateAtShift: Math.round(staffHourlyRate(member)), overtimeAfterHoursAtShift: member.overtimeAfterHours, overtimeMultiplierAtShift: member.overtimeMultiplier,
    note: clean(body.note, 200) || "Rahbar qo'lda kiritdi", source: "owner", status: "closed",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const next = [shift, ...shifts];
  const conflicts = new Set(conflictingWorkShiftIds(normalizeWorkShifts(next).filter((entry) => entry.staffId === member.id)));
  if (conflicts.has(id)) throw new StaffError("Bu vaqtda xodimning boshqa smenasi bor — ustma-ust tushadi.", 409);
  return { state: { ...state, workShifts: next }, result: { shift, alreadySaved: false } };
}

/** Bonus yoki ushlanma (pulsiz, faqat maosh hisobiga). Sababi majburiy. */
export function addAdjustment(state: Row, body: Row, today: string) {
  const op = opId(body);
  const id = `v2-adj:${op}`;
  const list = rows(state.payrollAdjustments);
  if (list.some((entry) => entry.id === id)) return { state, result: { alreadySaved: true } };
  const member = normalizeStaff(state.staff).find((entry) => entry.id === clean(body.staffId, 100));
  if (!member) throw new StaffError("Xodimni tanlang.");
  const type = clean(body.type, 20);
  if (type !== "bonus" && type !== "deduction") throw new StaffError("Bonus yoki ushlanmani tanlang. Avans — “To'lash” orqali, pul hisobidan.");
  const amount = Number(body.amount);
  const date = clean(body.date, 10);
  const note = clean(body.note, 300);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000) throw new StaffError("Summani tekshiring.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new StaffError("Sanani tekshiring.");
  if (note.length < 3) throw new StaffError("Sababini yozing — xodim hisob varaqasida ko'radi.");
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new StaffError(`${date.slice(0, 7)} oyi yopilgan.`, 409);
  const entry = { id, staffId: member.id, date, type, amount, note, voided: false, createdAt: new Date().toISOString(), createdBy: "Rahbar" };
  return { state: { ...state, payrollAdjustments: [entry, ...list] }, result: { entry, alreadySaved: false } };
}

/** Avans yoki oylik to'lovi — pul hisobidan chiqim bilan birga (bitta amalda). */
export function payStaff(state: Row, body: Row, today: string) {
  const op = opId(body);
  const paymentId = `v2-pay:${op}`;
  const financeId = `v2-payfin:${op}`;
  const payments = rows(state.payrollPayments);
  if (payments.some((entry) => entry.id === paymentId)) return { state, result: { alreadySaved: true } };
  const member = normalizeStaff(state.staff).find((entry) => entry.id === clean(body.staffId, 100));
  if (!member) throw new StaffError("Xodimni tanlang.");
  const kind = body.kind === "salary" ? "salary" : body.kind === "advance" ? "advance" : "";
  if (!kind) throw new StaffError("Avans yoki oylikni tanlang.");
  const amount = Number(body.amount);
  const date = clean(body.date, 10);
  const month = clean(body.month, 7);
  const account = rows(state.accounts).find((entry) => entry.id === clean(body.accountId, 100) && (entry.type === "cash" || entry.type === "bank"));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000) throw new StaffError("Summani tekshiring.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new StaffError("Sanani tekshiring.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new StaffError("Qaysi oy uchunligini tanlang.");
  if (!account) throw new StaffError("Pul qaysi hisobdan berilganini tanlang.");
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new StaffError(`${date.slice(0, 7)} oyi yopilgan.`, 409);
  const label = kind === "advance" ? "avans" : "oylik";
  const note = clean(body.note, 200);
  const now = new Date().toISOString();
  const payment = { id: paymentId, staffId: member.id, month, date, kind, amount, accountId: String(account.id), financialEntryId: financeId, note, voided: false, reversalEntryId: "", paidAt: now, createdAt: now, updatedAt: now };
  const finance = { id: financeId, type: "expense", category: "Maosh to‘lovi", amount, date, accountId: String(account.id), note: `${member.name} · ${month} · ${label}${note ? ` · ${note}` : ""}`, affectsProfit: false, payrollPaymentId: paymentId };
  return {
    state: { ...state, payrollPayments: [payment, ...payments], financialEntries: [finance, ...rows(state.financialEntries)] },
    result: { payment, alreadySaved: false },
  };
}
