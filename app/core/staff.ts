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
  if (breakMinutes >= hours * 60) throw new StaffError("Tanaffus smenadan uzun bo'lmaydi.");
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

/** Orqa sana bilan kiritilgan to'lov uchun: o'sha kunning Seul vaqti bilan tushi. */
const paidAtFor = (date: string) => seoulLocalDateTimeToIso(`${date}T12:00`) || `${date}T03:00:00.000Z`;

/** Oldin V2 da orqa sana bilan yozilgan to'lovlarning paidAt maydonini tuzatadi (eski tizim tekshiruvidan o'tishi uchun). */
export function repairPaymentPaidAt(state: Row): Row {
  let changed = false;
  const payrollPayments = rows(state.payrollPayments).map((payment) => {
    const date = String(payment.date || "");
    const paidAt = String(payment.paidAt || "");
    if (!String(payment.id || "").startsWith("v2-pay:") || !paidAt || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return payment;
    const ms = Date.parse(paidAt);
    const day = Number.isFinite(ms) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)) : "";
    if (day === date) return payment;
    changed = true;
    return { ...payment, paidAt: paidAtFor(date) };
  });
  return changed ? { ...state, payrollPayments } : state;
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
  // paidAt sanasi (Seul) to'lov sanasiga teng bo'lishi shart — eski tizim tekshiruvi shuni talab qiladi.
  const paidAt = date === today ? now : paidAtFor(date);
  const payment = { id: paymentId, staffId: member.id, month, date, kind, amount, accountId: String(account.id), financialEntryId: financeId, note, voided: false, reversalEntryId: "", paidAt, createdAt: now, updatedAt: now };
  const finance = { id: financeId, type: "expense", category: "Maosh to‘lovi", amount, date, accountId: String(account.id), note: `${member.name} · ${month} · ${label}${note ? ` · ${note}` : ""}`, affectsProfit: false, payrollPaymentId: paymentId };
  return {
    state: { ...state, payrollPayments: [payment, ...payments], financialEntries: [finance, ...rows(state.financialEntries)] },
    result: { payment, alreadySaved: false },
  };
}

/* ---------------- Tuzatishlar: hech narsa o'chirilmaydi — sababi bilan bekor qilinadi, tarixda qoladi ---------------- */

const reasonOf = (body: Row) => {
  const reason = clean(body.reason, 300);
  if (reason.length < 3) throw new StaffError("Sababini yozing (kamida 3 belgi).");
  return reason;
};
const openMonth = (state: Row, date: string) => {
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new StaffError(`${date.slice(0, 7)} oyi yopilgan.`, 409);
};
const findOne = (list: Row[], id: string, what: string) => {
  const found = list.filter((row) => row.id === id);
  if (found.length !== 1) throw new StaffError(`${what} topilmadi. Sahifani yangilang.`, 404);
  return found[0];
};

/** Bir xodimning oy bo'yicha asl yozuvlari (tuzatish oynasi uchun). */
export function staffRecords(state: Row, staffId: string, month: string) {
  const inMonth = (date: unknown) => String(date || "").startsWith(month);
  const accounts = new Map(rows(state.accounts).map((account) => [String(account.id), String(account.name || account.id)]));
  return {
    shifts: rows(state.workShifts).filter((shift) => shift.staffId === staffId && inMonth(shift.date))
      .map((shift) => ({ id: String(shift.id), date: String(shift.date), clockIn: String(shift.clockIn || ""), clockOut: String(shift.clockOut || ""), breakMinutes: Number(shift.breakMinutes) || 0, status: String(shift.status || ""), note: String(shift.note || ""), voidReason: String(shift.voidReason || ""), source: String(shift.source || "") }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.clockIn.localeCompare(a.clockIn)),
    days: rows(state.attendanceDays).filter((day) => day.staffId === staffId && inMonth(day.date))
      .map((day) => ({ id: String(day.id), date: String(day.date), status: String(day.status), payMode: String(day.payMode || "unpaid"), note: String(day.note || ""), voided: day.voided === true, voidReason: String(day.voidReason || "") }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    adjustments: rows(state.payrollAdjustments).filter((entry) => entry.staffId === staffId && inMonth(entry.date))
      .map((entry) => ({ id: String(entry.id), date: String(entry.date), type: String(entry.type), amount: Number(entry.amount) || 0, note: String(entry.note || ""), voided: entry.voided === true, voidReason: String(entry.voidReason || "") }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    payments: rows(state.payrollPayments).filter((entry) => entry.staffId === staffId && (entry.month === month || inMonth(entry.date)))
      .map((entry) => ({ id: String(entry.id), date: String(entry.date), month: String(entry.month), kind: String(entry.kind), amount: Number(entry.amount) || 0, account: accounts.get(String(entry.accountId)) || "", note: String(entry.note || ""), voided: entry.voided === true, voidReason: String(entry.voidReason || "") }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/** Smena vaqtini tuzatish (xodim noto'g'ri belgilagan yoki ketishni unutgan). */
export function editShift(state: Row, body: Row) {
  const shifts = rows(state.workShifts);
  const shift = findOne(shifts, clean(body.id, 160), "Smena");
  if (shift.status === "void") throw new StaffError("Bu smena bekor qilingan.", 409);
  const date = String(shift.date || "");
  openMonth(state, date);
  const reason = reasonOf(body);
  const from = clean(body.from, 5);
  const to = clean(body.to, 5);
  if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) throw new StaffError("Kelgan va ketgan vaqtni yozing.");
  const clockIn = seoulLocalDateTimeToIso(`${date}T${from}`);
  let clockOut = seoulLocalDateTimeToIso(`${date}T${to}`);
  if (!clockIn || !clockOut) throw new StaffError("Vaqtni tekshiring.");
  if (Date.parse(clockOut) <= Date.parse(clockIn)) clockOut = new Date(Date.parse(clockOut) + 86_400_000).toISOString();
  if ((Date.parse(clockOut) - Date.parse(clockIn)) / 3_600_000 > 18) throw new StaffError("Smena 18 soatdan uzun bo'lmaydi.");
  if (Date.parse(clockOut) > Date.now() + 5 * 60_000) throw new StaffError("Ketgan vaqt hali kelmagan.");
  const breakMinutes = Math.max(0, Math.min(240, Math.round(Number(body.breakMinutes ?? shift.breakMinutes ?? 0))));
  if (breakMinutes * 60_000 >= Date.parse(clockOut) - Date.parse(clockIn)) throw new StaffError("Tanaffus smenadan uzun bo'lmaydi.");
  const now = new Date().toISOString();
  const edits = rows(shift.edits);
  const updated = {
    ...shift, clockIn, clockOut, breakMinutes, status: "closed", updatedAt: now,
    edits: [{ at: now, by: "Rahbar", reason, before: { clockIn: shift.clockIn, clockOut: shift.clockOut || "", breakMinutes: shift.breakMinutes || 0 } }, ...edits].slice(0, 20),
  };
  const next = shifts.map((entry) => (entry.id === shift.id ? updated : entry));
  const conflicts = new Set(conflictingWorkShiftIds(normalizeWorkShifts(next).filter((entry) => entry.staffId === shift.staffId)));
  if (conflicts.has(String(shift.id))) throw new StaffError("Bu vaqtda xodimning boshqa smenasi bor — ustma-ust tushadi.", 409);
  return { state: { ...state, workShifts: next }, result: { shift: updated } };
}

export function voidShift(state: Row, body: Row) {
  const shifts = rows(state.workShifts);
  const shift = findOne(shifts, clean(body.id, 160), "Smena");
  if (shift.status === "void") return { state, result: { alreadySaved: true } };
  openMonth(state, String(shift.date));
  const reason = reasonOf(body);
  const now = new Date().toISOString();
  return { state: { ...state, workShifts: shifts.map((entry) => (entry.id === shift.id ? { ...entry, status: "void", updatedAt: now, voidReason: reason, voidedAt: now, voidedBy: "Rahbar" } : entry)) }, result: { alreadySaved: false } };
}

/** Kun holati: dam olish / kasal / kelmadi. "planned" — reja bo'yicha haq to'lanadi (masalan, pullik dam olish). */
export function setDayStatus(state: Row, body: Row, today: string) {
  const member = normalizeStaff(state.staff).find((entry) => entry.id === clean(body.staffId, 100));
  if (!member) throw new StaffError("Xodimni tanlang.");
  const date = clean(body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw new StaffError("Sanani tekshiring.");
  openMonth(state, date);
  const status = clean(body.status, 10);
  if (!["off", "absent", "sick"].includes(status)) throw new StaffError("Holatni tanlang.");
  const payMode = body.payMode === "planned" ? "planned" : "unpaid";
  if (rows(state.workShifts).some((shift) => shift.staffId === member.id && shift.date === date && shift.status !== "void")) {
    throw new StaffError("Bu kunda ish vaqti bor. Avval smenani bekor qiling.", 409);
  }
  const days = rows(state.attendanceDays);
  const existing = days.find((day) => day.staffId === member.id && day.date === date && day.voided !== true);
  const now = new Date().toISOString();
  const base = `${member.id}:${date}`;
  let id = String(existing?.id || base);
  for (let n = 2; !existing && days.some((day) => day.id === id); n += 1) id = `${base}:${n}`;
  const plannedMinutes = Math.round(member.dailyHours * 60);
  const rate = staffHourlyRate(member);
  if (payMode === "planned" && (plannedMinutes <= 0 || rate <= 0)) throw new StaffError("Xodimning ish rejasi va stavkasini tekshiring.");
  const day = {
    id, staffId: member.id, date, status, payMode,
    plannedMinutesAtDay: payMode === "planned" ? Math.min(1_080, plannedMinutes) : 0, hourlyRateAtDay: payMode === "planned" ? rate : 0,
    note: clean(body.note, 300), voided: false, createdAt: String(existing?.createdAt || now), updatedAt: now,
  };
  return { state: { ...state, attendanceDays: existing ? days.map((entry) => (entry.id === existing.id ? day : entry)) : [day, ...days] }, result: { day } };
}

export function voidDayStatus(state: Row, body: Row) {
  const days = rows(state.attendanceDays);
  const day = findOne(days, clean(body.id, 160), "Kun holati");
  if (day.voided === true) return { state, result: { alreadySaved: true } };
  openMonth(state, String(day.date));
  const reason = reasonOf(body);
  const now = new Date().toISOString();
  return { state: { ...state, attendanceDays: days.map((entry) => (entry.id === day.id ? { ...entry, voided: true, updatedAt: now, voidedAt: now, voidedBy: "Rahbar", voidReason: reason } : entry)) }, result: { alreadySaved: false } };
}

export function voidAdjustment(state: Row, body: Row) {
  const list = rows(state.payrollAdjustments);
  const entry = findOne(list, clean(body.id, 160), "Yozuv");
  if (entry.voided === true) return { state, result: { alreadySaved: true } };
  openMonth(state, String(entry.date));
  const reason = reasonOf(body);
  const now = new Date().toISOString();
  return { state: { ...state, payrollAdjustments: list.map((row) => (row.id === entry.id ? { ...row, voided: true, voidReason: reason, voidedAt: now, voidedBy: "Rahbar" } : row)) }, result: { alreadySaved: false } };
}

/** To'lovni bekor qilish: pul hisobga qaytadi (bugungi sana bilan qarama-qarshi yozuv), xodim qoldig'i qayta oshadi. */
export function voidPayment(state: Row, body: Row, today: string) {
  const payments = rows(state.payrollPayments);
  const payment = findOne(payments, clean(body.id, 160), "To'lov");
  if (payment.voided === true) return { state, result: { alreadySaved: true } };
  openMonth(state, String(payment.date));
  openMonth(state, today);
  const reason = reasonOf(body);
  const finances = rows(state.financialEntries);
  const original = finances.find((entry) => entry.id === payment.financialEntryId);
  if (!original) throw new StaffError("To'lovning pul yozuvi topilmadi. Tarixni tekshiring.", 409);
  if (Number(original.amount) !== Number(payment.amount)) throw new StaffError("To'lov va pul yozuvi summasi bir xil emas.", 409);
  const reversalId = `fin-reversal-${String(payment.id)}`.slice(0, 160);
  if (finances.some((entry) => entry.id === reversalId || entry.reversedEntryId === original.id)) throw new StaffError("Bu to'lov allaqachon bekor qilingan.", 409);
  const member = normalizeStaff(state.staff).find((entry) => entry.id === payment.staffId);
  const now = new Date().toISOString();
  const reversal = {
    id: reversalId, type: "income", category: "Maosh to‘lovi bekori", amount: Number(payment.amount), date: today, accountId: payment.accountId,
    note: `${member?.name || "Xodim"} · ${String(payment.month)} to‘lovi bekor qilindi`, affectsProfit: false, payrollPaymentId: payment.id,
    reversedEntryId: original.id, cancellationReason: reason, cancelledAt: now, cancelledBy: "Rahbar",
  };
  return {
    state: {
      ...state,
      payrollPayments: payments.map((entry) => (entry.id === payment.id ? { ...entry, voided: true, reversalEntryId: reversalId, updatedAt: now, voidReason: reason, voidedAt: now, voidedBy: "Rahbar" } : entry)),
      financialEntries: [reversal, ...finances],
    },
    result: { alreadySaved: false },
  };
}
