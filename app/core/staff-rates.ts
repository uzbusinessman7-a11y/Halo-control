/**
 * HALO V2 — xodim stavkasi sanadan boshlab: «oyning o'rtasidan oylik oshsa — faqat o'sha kundan hisoblansin».
 *
 * Har bir ish kunida (smena) stavka yozilib qo'yiladi (`hourlyRateAtShift` va ortiqcha soat qoidasi). Rahbar stavkani,
 * oylikni yoki ish rejasini o'zgartirganda «qachondan» sanasini tanlaydi:
 *  - shu sanadan (va keyingi) ish kunlari va pullik dam kunlari yangi shart bilan qayta hisoblanadi;
 *  - undan oldingi kunlar eski shartda qoladi; stavkasi yozilmagan eski smenalar avvalgi shartda «muzlatiladi»
 *    (keyin hech qachon orqaga qarab o'zgarmasin);
 *  - o'zgarish tarixi xodim yozuvida (`rateHistory`): keyin kiritiladigan oldingi sanali kun ham o'z sanasidagi
 *    stavkani oladi (masalan, 20-da 10-sanadagi unutilgan ish kuni kiritilsa — 10-sanadagi stavka).
 * Yopilgan oydagi sanadan boshlab bo'lmaydi.
 */
import { normalizeStaff, staffHourlyRate, type StaffMember } from "../lib/payroll";
import { isAccountingMonthClosed } from "../lib/month-end";

type Row = Record<string, unknown>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);

export interface RateTerms {
  payType: "monthly" | "hourly"; hourlyRate: number; monthlySalary: number;
  workDays: number; dailyHours: number; overtimeAfterHours: number; overtimeMultiplier: number;
}
export interface RateChange { from: string; at: string; prev: RateTerms; next: RateTerms }

export const termsOf = (member: StaffMember): RateTerms => ({
  payType: member.payType, hourlyRate: member.hourlyRate, monthlySalary: member.monthlySalary,
  workDays: member.workDays, dailyHours: member.dailyHours, overtimeAfterHours: member.overtimeAfterHours, overtimeMultiplier: member.overtimeMultiplier,
});
export const sameTerms = (left: RateTerms, right: RateTerms) => (Object.keys(left) as Array<keyof RateTerms>).every((key) => left[key] === right[key]);

function cleanTerms(value: unknown): RateTerms | null {
  if (!value || typeof value !== "object") return null;
  const [member] = normalizeStaff([{ id: "x", name: "xx", ...(value as Row) }]);
  return member ? termsOf(member) : null;
}

/** Xodim yozuvidagi stavka tarixi (eskisidan yangisiga). */
export function rateHistory(row: Row | undefined | null): RateChange[] {
  return rows(row?.rateHistory).flatMap((entry) => {
    const from = String(entry.from || "");
    const prev = cleanTerms(entry.prev);
    const next = cleanTerms(entry.next);
    return DATE.test(from) && prev && next ? [{ from, at: String(entry.at || ""), prev, next }] : [];
  }).sort((left, right) => left.from.localeCompare(right.from) || left.at.localeCompare(right.at));
}

/** O'sha kundagi shart bilan xodim (stavka tarixiga qarab). */
export function memberOn(row: Row | undefined | null, date: string): StaffMember | null {
  if (!row) return null;
  const [member] = normalizeStaff([row]);
  if (!member) return null;
  const history = rateHistory(row);
  let terms = termsOf(member);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].from > date) terms = history[index].prev;
    else break;
  }
  return { ...member, ...terms };
}

/**
 * Yangi shartni `from` sanasidan qo'llaydi. `before` — o'zgarishdan oldingi xodim yozuvi (xom), `after` — yangisi (tekshirilgan).
 * Qaytaradi: yangi workShifts / attendanceDays va nechta kun qayta hisoblangani.
 */
export function applyRateChange(state: Row, before: Row, after: StaffMember, fromInput: unknown, today: string, now: string) {
  const previous = memberOn(before, today);
  if (!previous) throw new RateError("Xodim topilmadi.");
  if (sameTerms(termsOf(previous), termsOf(after))) return null;
  const from = String(fromInput || "").trim() || today;
  if (!DATE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) throw new RateError("Yangi stavka qachondan boshlanishini tekshiring.");
  const history = rateHistory(before);
  const last = history[history.length - 1];
  if (last && from < last.from) throw new RateError(`Oxirgi o‘zgarish ${last.from} dan. Yangi stavka undan oldin boshlanmaydi.`);
  if (isAccountingMonthClosed(state.monthlyCloses, from)) throw new RateError(`${from.slice(0, 7)} oyi yopilgan — yangi stavkani ochiq oydagi kundan boshlang.`, 409);

  const rate = staffHourlyRate(after);
  const overtimeAfter = after.overtimeAfterHours || after.dailyHours;
  const multiplier = after.overtimeMultiplier || 1;
  let shiftsChanged = 0;
  const workShifts = rows(state.workShifts).map((shift) => {
    if (shift.staffId !== after.id || shift.status === "void") return shift;
    const date = String(shift.date || "");
    if (date >= from) {
      if (Number(shift.hourlyRateAtShift) === rate && Number(shift.overtimeAfterHoursAtShift) === overtimeAfter && Number(shift.overtimeMultiplierAtShift) === multiplier) return shift;
      if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new RateError(`${date.slice(0, 7)} oyi yopilgan — o‘sha oydagi ish kunlarini qayta hisoblab bo‘lmaydi.`, 409);
      shiftsChanged += 1;
      return { ...shift, hourlyRateAtShift: rate, overtimeAfterHoursAtShift: overtimeAfter, overtimeMultiplierAtShift: multiplier, updatedAt: now };
    }
    // Oldingi kun: stavkasi yozilmagan eski smena avvalgi shartda muzlatiladi (orqaga qarab o'zgarmasin).
    const missing = !(Number(shift.hourlyRateAtShift) > 0) || !(Number(shift.overtimeAfterHoursAtShift) > 0) || !(Number(shift.overtimeMultiplierAtShift) >= 1);
    if (!missing) return shift;
    const old = memberOn(before, date) || previous;
    return {
      ...shift,
      hourlyRateAtShift: Number(shift.hourlyRateAtShift) > 0 ? shift.hourlyRateAtShift : staffHourlyRate(old),
      overtimeAfterHoursAtShift: Number(shift.overtimeAfterHoursAtShift) > 0 ? shift.overtimeAfterHoursAtShift : old.overtimeAfterHours || old.dailyHours,
      overtimeMultiplierAtShift: Number(shift.overtimeMultiplierAtShift) >= 1 ? shift.overtimeMultiplierAtShift : old.overtimeMultiplier || 1,
    };
  });
  let daysChanged = 0;
  const attendanceDays = rows(state.attendanceDays).map((day) => {
    if (day.staffId !== after.id || day.voided === true || day.payMode !== "planned" || String(day.date || "") < from) return day;
    const plannedMinutesAtDay = Math.min(1_080, Math.round(after.dailyHours * 60));
    if (Number(day.hourlyRateAtDay) === rate && Number(day.plannedMinutesAtDay) === plannedMinutesAtDay) return day;
    if (isAccountingMonthClosed(state.monthlyCloses, String(day.date))) throw new RateError(`${String(day.date).slice(0, 7)} oyi yopilgan.`, 409);
    daysChanged += 1;
    return { ...day, hourlyRateAtDay: rate, plannedMinutesAtDay, updatedAt: now };
  });
  const entry: RateChange = { from, at: now, prev: termsOf(previous), next: termsOf(after) };
  return { workShifts, attendanceDays, rateHistory: [...history, entry].slice(-50), from, shiftsChanged, daysChanged };
}

export class RateError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Ro'yxat uchun: «15.10 dan: 2,600,000 → 3,000,000 ₩ / oy». */
export function rateHistoryView(row: Row) {
  const label = (terms: RateTerms) => terms.payType === "monthly" ? `${terms.monthlySalary.toLocaleString("en-US")} ₩ / oy` : `${terms.hourlyRate.toLocaleString("en-US")} ₩ / soat`;
  return rateHistory(row).slice(-6).reverse().map((entry) => ({ from: entry.from, before: label(entry.prev), after: label(entry.next) }));
}
