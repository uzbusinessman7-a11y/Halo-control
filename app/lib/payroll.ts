import { previousSeoulDate, seoulCalendarDate } from "./business-time.ts";

export type PayType = "monthly" | "hourly";

export type StaffMember = {
  id: string;
  name: string;
  monthlySalary: number;
  hourlyRate: number;
  payType: PayType;
  workDays: number;
  dailyHours: number;
  overtimeAfterHours: number;
  overtimeMultiplier: number;
  scheduledStartTime: string;
  scheduledEndTime: string;
  workerId: string;
  active: boolean;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
};

export type WorkShift = {
  id: string;
  staffId: string;
  date: string;
  clockIn: string;
  clockOut: string;
  breakMinutes: number;
  hourlyRateAtShift?: number;
  overtimeAfterHoursAtShift?: number;
  overtimeMultiplierAtShift?: number;
  payWindowStartAtShift?: string;
  payWindowEndAtShift?: string;
  note: string;
  source: "owner" | "worker";
  status: "open" | "closed" | "void";
  createdAt: string;
  updatedAt: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
};

export type WorkerAttendanceShift = Pick<WorkShift, "id" | "date" | "clockIn" | "clockOut" | "status">;

export type WorkerEarningDay = {
  date: string;
  clockIn: string;
  clockOut: string;
  workedMinutes: number;
  payableMinutes: number;
  amount: number;
  status: "closed" | "open" | "conflict";
};

export type WorkerMonthlyEarnings = {
  month: string;
  workedDays: number;
  workedMinutes: number;
  totalEarned: number;
  days: WorkerEarningDay[];
};

export function toWorkerAttendanceShift(shift: WorkShift | null): WorkerAttendanceShift | null {
  if (!shift) return null;
  return {
    id: shift.id,
    date: shift.date,
    clockIn: shift.clockIn,
    clockOut: shift.clockOut,
    status: shift.status,
  };
}

export type PayrollAdjustment = {
  id: string;
  staffId: string;
  date: string;
  type: "advance" | "bonus" | "deduction";
  amount: number;
  note: string;
  voided: boolean;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
};

export type AttendanceDay = {
  id: string;
  staffId: string;
  date: string;
  status: "off" | "absent" | "sick";
  payMode: "unpaid" | "planned";
  plannedMinutesAtDay: number;
  hourlyRateAtDay: number;
  note: string;
  voided: boolean;
  createdAt: string;
  updatedAt: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
};

export type PayrollPayment = {
  id: string;
  staffId: string;
  month: string;
  date: string;
  kind: "advance" | "salary";
  amount: number;
  accountId: string;
  financialEntryId: string;
  note: string;
  voided: boolean;
  reversalEntryId: string;
  paidAt: string;
  createdAt: string;
  updatedAt: string;
  voidReason?: string;
  voidedAt?: string;
  voidedBy?: string;
};

export type PayrollSummary = {
  workedMinutes: number;
  payableWorkedMinutes: number;
  workedDays: number;
  plannedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  paidStatusMinutes: number;
  effectiveHourlyRate: number;
  regularPay: number;
  overtimePay: number;
  paidStatusPay: number;
  basePay: number;
  bonus: number;
  advance: number;
  deduction: number;
  grossPay: number;
  paymentAmount: number;
  remaining: number;
  offDays: number;
  absentDays: number;
  sickDays: number;
  payable: number;
};

export type WorkdayPay = {
  workedMinutes: number;
  payableMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  regularPay: number;
  overtimePay: number;
  totalPay: number;
};

export type DatedWorkdayPay = WorkdayPay & {
  date: string;
  shifts: WorkShift[];
  open: boolean;
  conflict: boolean;
  conflictingShiftIds: string[];
  recordedMinutes: number;
  roundedRegularPay: number;
  roundedOvertimePay: number;
  roundedTotalPay: number;
};

const finiteNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const cleanDate = (value: unknown) => {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
};

const cleanTime = (value: unknown) => {
  const time = String(value || "").trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "";
};

const validOptionalCancellation = (record: Record<string, unknown>, reasonKey = "voidReason") => {
  const reason = record[reasonKey];
  const at = record.voidedAt ?? record.cancelledAt;
  const by = record.voidedBy ?? record.cancelledBy;
  if (reason === undefined && at === undefined && by === undefined) return true;
  if (typeof at !== "string") return false;
  const parsedAt = new Date(at);
  return typeof reason === "string" && Boolean(reason.trim()) && reason.length <= 500
    && Number.isFinite(parsedAt.getTime()) && parsedAt.toISOString() === at
    && typeof by === "string" && Boolean(by.trim()) && by.length <= 50;
};

export function normalizeStaff(value: unknown): StaffMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const member = entry as Record<string, unknown>;
    const id = String(member.id || "").trim();
    const name = String(member.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (!id || !name) return [];
    const payType: PayType = member.payType === "hourly" ? "hourly" : "monthly";
    const scheduledStartTime = cleanTime(member.scheduledStartTime);
    const scheduledEndTime = cleanTime(member.scheduledEndTime);
    const hasValidSchedule = Boolean(scheduledStartTime && scheduledEndTime && shiftRange("2026-01-01", scheduledStartTime, scheduledEndTime));
    return [{
      id,
      name,
      payType,
      monthlySalary: Math.max(0, finiteNumber(member.monthlySalary)),
      hourlyRate: Math.max(0, finiteNumber(member.hourlyRate)),
      workDays: Math.min(31, Math.max(1, finiteNumber(member.workDays, 26))),
      dailyHours: Math.min(18, Math.max(0.5, finiteNumber(member.dailyHours, 12))),
      overtimeAfterHours: Math.min(18, Math.max(0.5, finiteNumber(member.overtimeAfterHours, finiteNumber(member.dailyHours, 12)))),
      overtimeMultiplier: Math.min(5, Math.max(1, finiteNumber(member.overtimeMultiplier, 1))),
      scheduledStartTime: hasValidSchedule ? scheduledStartTime : "",
      scheduledEndTime: hasValidSchedule ? scheduledEndTime : "",
      workerId: String(member.workerId || "").trim().slice(0, 80),
      active: member.active !== false,
      cancellationReason: String(member.cancellationReason || "").trim().slice(0, 500) || undefined,
      cancelledAt: String(member.cancelledAt || "").trim() || undefined,
      cancelledBy: String(member.cancelledBy || "").trim().slice(0, 50) || undefined,
    }];
  });
}

export function normalizeWorkShifts(value: unknown): WorkShift[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const shift = entry as Record<string, unknown>;
    const id = String(shift.id || "").trim();
    const staffId = String(shift.staffId || "").trim();
    const clockIn = String(shift.clockIn || "");
    const clockOut = String(shift.clockOut || "");
    const clockInMs = Date.parse(clockIn);
    const source = shift.source === "worker" ? "worker" : "owner";
    const storedDate = cleanDate(shift.date);
    if (!id || !staffId || !Number.isFinite(clockInMs) || (!storedDate && source !== "worker")) return [];
    const date = source === "worker" ? seoulCalendarDate(new Date(clockInMs)) : storedDate;
    const status = shift.status === "void"
      ? "void"
      : clockOut && Number.isFinite(Date.parse(clockOut))
        ? "closed"
        : "open";
    const payWindowStartAtShift = String(shift.payWindowStartAtShift || "");
    const payWindowEndAtShift = String(shift.payWindowEndAtShift || "");
    const payWindowStartMs = Date.parse(payWindowStartAtShift);
    const payWindowEndMs = Date.parse(payWindowEndAtShift);
    const hasPayWindow = Number.isFinite(payWindowStartMs)
      && Number.isFinite(payWindowEndMs)
      && payWindowEndMs > payWindowStartMs
      && payWindowEndMs - payWindowStartMs <= 18 * 60 * 60_000;
    return [{
      id,
      staffId,
      date,
      clockIn,
      clockOut: status === "closed" ? clockOut : "",
      breakMinutes: Math.min(1_080, Math.max(0, finiteNumber(shift.breakMinutes))),
      hourlyRateAtShift: Math.max(0, finiteNumber(shift.hourlyRateAtShift)),
      overtimeAfterHoursAtShift: Number(shift.overtimeAfterHoursAtShift) > 0
        ? Math.min(18, Math.max(0.5, finiteNumber(shift.overtimeAfterHoursAtShift)))
        : 0,
      overtimeMultiplierAtShift: Number(shift.overtimeMultiplierAtShift) >= 1
        ? Math.min(5, finiteNumber(shift.overtimeMultiplierAtShift, 1))
        : 0,
      payWindowStartAtShift: hasPayWindow ? new Date(payWindowStartMs).toISOString() : undefined,
      payWindowEndAtShift: hasPayWindow ? new Date(payWindowEndMs).toISOString() : undefined,
      note: String(shift.note || "").trim().slice(0, 300),
      source,
      status,
      createdAt: String(shift.createdAt || clockIn),
      updatedAt: String(shift.updatedAt || shift.createdAt || clockIn),
      voidReason: String(shift.voidReason || "").trim().slice(0, 500) || undefined,
      voidedAt: String(shift.voidedAt || "").trim() || undefined,
      voidedBy: String(shift.voidedBy || "").trim().slice(0, 50) || undefined,
    }];
  });
}

// Attendance belongs to the Seoul calendar date on which the shift started.
// Older worker rows used HALO's noon sales boundary and can therefore carry
// the previous date before 12:00; clockIn is the authoritative timestamp.
export function workShiftCalendarDate(
  shift: Pick<WorkShift, "date" | "clockIn" | "source">,
): string {
  const storedDate = cleanDate(shift.date);
  const clockInMs = Date.parse(shift.clockIn);
  if (shift.source === "worker" && Number.isFinite(clockInMs)) {
    return seoulCalendarDate(new Date(clockInMs));
  }
  return storedDate;
}

function canonicalWorkShifts(shifts: WorkShift[]): WorkShift[] {
  return shifts.flatMap((shift) => {
    const date = workShiftCalendarDate(shift);
    if (!date) return [];
    return [date === shift.date ? shift : { ...shift, date }];
  });
}

export function conflictingWorkShiftIds(shifts: WorkShift[]): string[] {
  const intervals = canonicalWorkShifts(shifts)
    .filter((shift) => shift.status !== "void")
    .flatMap((shift) => {
      const start = Date.parse(shift.clockIn);
      const closedEnd = Date.parse(shift.clockOut);
      const end = shift.status === "open"
        ? start + 18 * 60 * 60_000
        : closedEnd;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      return [{ id: shift.id, staffId: shift.staffId, start, end }];
    })
    .sort((left, right) => left.staffId.localeCompare(right.staffId) || left.start - right.start || left.end - right.end);
  const conflicts = new Set<string>();
  for (let leftIndex = 0; leftIndex < intervals.length; leftIndex += 1) {
    const left = intervals[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < intervals.length; rightIndex += 1) {
      const right = intervals[rightIndex];
      if (right.staffId !== left.staffId) break;
      if (right.start >= left.end) break;
      if (left.start < right.end && right.start < left.end) {
        conflicts.add(left.id);
        conflicts.add(right.id);
      }
    }
  }
  return [...conflicts];
}

export function normalizePayrollAdjustments(value: unknown): PayrollAdjustment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const adjustment = entry as Record<string, unknown>;
    const id = String(adjustment.id || "").trim();
    const staffId = String(adjustment.staffId || "").trim();
    const date = cleanDate(adjustment.date);
    const type = adjustment.type;
    const amount = finiteNumber(adjustment.amount);
    if (!id || !staffId || !date || !["advance", "bonus", "deduction"].includes(String(type)) || amount <= 0) return [];
    return [{
      id,
      staffId,
      date,
      type: type as PayrollAdjustment["type"],
      amount,
      note: String(adjustment.note || "").trim().slice(0, 300),
      voided: adjustment.voided === true,
      voidReason: String(adjustment.voidReason || "").trim().slice(0, 500) || undefined,
      voidedAt: String(adjustment.voidedAt || "").trim() || undefined,
      voidedBy: String(adjustment.voidedBy || "").trim().slice(0, 50) || undefined,
    }];
  });
}

export function normalizeAttendanceDays(value: unknown): AttendanceDay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const day = entry as Record<string, unknown>;
    const id = String(day.id || "").trim();
    const staffId = String(day.staffId || "").trim();
    const date = cleanDate(day.date);
    const status = String(day.status || "");
    if (!id || !staffId || !date || !["off", "absent", "sick"].includes(status)) return [];
    return [{
      id,
      staffId,
      date,
      status: status as AttendanceDay["status"],
      payMode: day.payMode === "planned" ? "planned" : "unpaid",
      plannedMinutesAtDay: Math.min(1_080, Math.max(0, finiteNumber(day.plannedMinutesAtDay))),
      hourlyRateAtDay: Math.max(0, finiteNumber(day.hourlyRateAtDay)),
      note: String(day.note || "").trim().slice(0, 300),
      voided: day.voided === true,
      createdAt: String(day.createdAt || ""),
      updatedAt: String(day.updatedAt || day.createdAt || ""),
      voidReason: String(day.voidReason || "").trim().slice(0, 500) || undefined,
      voidedAt: String(day.voidedAt || "").trim() || undefined,
      voidedBy: String(day.voidedBy || "").trim().slice(0, 50) || undefined,
    }];
  });
}

export function normalizePayrollPayments(value: unknown): PayrollPayment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const payment = entry as Record<string, unknown>;
    const id = String(payment.id || "").trim();
    const staffId = String(payment.staffId || "").trim();
    const month = String(payment.month || "");
    const date = cleanDate(payment.date);
    const amount = finiteNumber(payment.amount);
    if (
      !id || !staffId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !date || amount <= 0
      || !["advance", "salary"].includes(String(payment.kind || ""))
    ) return [];
    return [{
      id,
      staffId,
      month,
      date,
      kind: payment.kind as PayrollPayment["kind"],
      amount,
      accountId: String(payment.accountId || "").trim(),
      financialEntryId: String(payment.financialEntryId || "").trim(),
      note: String(payment.note || "").trim().slice(0, 300),
      voided: payment.voided === true,
      reversalEntryId: String(payment.reversalEntryId || "").trim(),
      paidAt: (() => {
        const value = String(payment.paidAt || "");
        const instant = Date.parse(value);
        return value && Number.isFinite(instant) && seoulCalendarDate(new Date(instant)) === date
          ? new Date(instant).toISOString()
          : "";
      })(),
      createdAt: String(payment.createdAt || ""),
      updatedAt: String(payment.updatedAt || payment.createdAt || ""),
      voidReason: String(payment.voidReason || "").trim().slice(0, 500) || undefined,
      voidedAt: String(payment.voidedAt || "").trim() || undefined,
      voidedBy: String(payment.voidedBy || "").trim().slice(0, 50) || undefined,
    }];
  });
}

export function workShiftMinutes(shift: WorkShift, now = new Date()): number {
  if (shift.status === "void") return 0;
  const start = Date.parse(shift.clockIn);
  const end = shift.clockOut ? Date.parse(shift.clockOut) : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const actualElapsed = Math.floor((end - start) / 60_000);
  if (shift.status !== "open" && actualElapsed > 18 * 60) return 0;
  const windowStart = Date.parse(String(shift.payWindowStartAtShift || ""));
  const windowEnd = Date.parse(String(shift.payWindowEndAtShift || ""));
  const cappedStart = Number.isFinite(windowStart) && Number.isFinite(windowEnd) ? Math.max(start, windowStart) : start;
  const cappedEnd = Number.isFinite(windowStart) && Number.isFinite(windowEnd) ? Math.min(end, windowEnd) : end;
  const elapsed = Math.max(0, Math.floor((cappedEnd - cappedStart) / 60_000));
  const payableElapsed = shift.status === "open" ? Math.min(elapsed, 18 * 60) : elapsed;
  if (shift.breakMinutes >= payableElapsed) return 0;
  return Math.max(0, payableElapsed - shift.breakMinutes);
}

export function staffPayWindowForInstant(member: StaffMember, instant: Date) {
  if (!member.scheduledStartTime || !member.scheduledEndTime || !Number.isFinite(instant.getTime())) return null;
  const currentDate = seoulCalendarDate(instant);
  const previousDate = previousSeoulDate(currentDate);
  const current = shiftRange(currentDate, member.scheduledStartTime, member.scheduledEndTime);
  const previous = shiftRange(previousDate, member.scheduledStartTime, member.scheduledEndTime);
  const instantMs = instant.getTime();
  const selected = previous
    && instantMs >= Date.parse(previous.clockIn)
    && instantMs < Date.parse(previous.clockOut)
      ? previous
      : current;
  return selected ? { start: selected.clockIn, end: selected.clockOut } : null;
}

// HALO payroll rule: daily time is paid in half-hour steps. Minutes 0–27 are
// dropped, 28–57 become 30 minutes, and 58–59 become the next full hour.
export function roundPayrollMinutes(minutes: number): number {
  const safeMinutes = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  const wholeHours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (remainder <= 27) return wholeHours * 60;
  if (remainder <= 57) return wholeHours * 60 + 30;
  return (wholeHours + 1) * 60;
}

export function staffHourlyRate(member: StaffMember): number {
  if (member.payType === "hourly") return Math.max(0, member.hourlyRate);
  const plannedHours = member.workDays * member.dailyHours;
  return plannedHours > 0 ? Math.max(0, member.monthlySalary) / plannedHours : 0;
}

export function freezeWorkShiftRates(member: StaffMember, shifts: WorkShift[]): WorkShift[] {
  return shifts.map((shift) => {
    if (shift.staffId !== member.id) return shift;
    // Hisob oynasi (qat'iy ish vaqti) faqat smena ochilgan paytda yoziladi. Bu yerda u qo'shilmaydi: aks holda
    // ish vaqti keyin belgilangan xodimning oldingi kunlari orqaga qarab kesilib qolardi.
    return (
    (
      !(Number(shift.hourlyRateAtShift) > 0)
      || !(Number(shift.overtimeAfterHoursAtShift) > 0)
      || !(Number(shift.overtimeMultiplierAtShift) >= 1)
    )
      ? {
          ...shift,
          hourlyRateAtShift: Number(shift.hourlyRateAtShift) > 0
            ? shift.hourlyRateAtShift
            : staffHourlyRate(member),
          overtimeAfterHoursAtShift: Number(shift.overtimeAfterHoursAtShift) > 0
            ? shift.overtimeAfterHoursAtShift
            : member.overtimeAfterHours || member.dailyHours,
          overtimeMultiplierAtShift: Number(shift.overtimeMultiplierAtShift) >= 1
            ? shift.overtimeMultiplierAtShift
            : member.overtimeMultiplier || 1,
        }
      : shift
    );
  });
}

export function workShiftPay(member: StaffMember, shift: WorkShift, now = new Date()): number {
  return calculateWorkdayPay(member, [shift], now).totalPay;
}

export function calculateWorkdayPay(member: StaffMember, shifts: WorkShift[], now = new Date()): WorkdayPay {
  const ordered = shifts
    .filter((shift) => shift.status !== "void")
    .slice()
    .sort((left, right) => left.clockIn.localeCompare(right.clockIn));
  const segments = ordered.flatMap((shift) => {
    const minutes = workShiftMinutes(shift, now);
    if (!minutes) return [];
    return [{
      minutes,
      rate: Number(shift.hourlyRateAtShift) > 0
        ? Number(shift.hourlyRateAtShift)
        : staffHourlyRate(member),
      thresholdMinutes: Math.round((Number(shift.overtimeAfterHoursAtShift) > 0
        ? Number(shift.overtimeAfterHoursAtShift)
        : Number(member.overtimeAfterHours) > 0 ? member.overtimeAfterHours : member.dailyHours) * 60),
      multiplier: Number(shift.overtimeMultiplierAtShift) >= 1
        ? Number(shift.overtimeMultiplierAtShift)
        : Number(member.overtimeMultiplier) >= 1 ? member.overtimeMultiplier : 1,
    }];
  });
  const workedMinutes = segments.reduce((sum, segment) => sum + segment.minutes, 0);
  const payableMinutes = roundPayrollMinutes(workedMinutes);
  let allocatedMinutes = 0;
  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let regularPay = 0;
  let overtimePay = 0;
  for (const [index, segment] of segments.entries()) {
    const remaining = Math.max(0, payableMinutes - allocatedMinutes);
    const minutes = index === segments.length - 1 ? remaining : Math.min(segment.minutes, remaining);
    if (!minutes) continue;
    const regular = Math.min(minutes, Math.max(0, segment.thresholdMinutes - allocatedMinutes));
    const overtime = minutes - regular;
    allocatedMinutes += minutes;
    regularMinutes += regular;
    overtimeMinutes += overtime;
    regularPay += regular / 60 * segment.rate;
    overtimePay += overtime / 60 * segment.rate * segment.multiplier;
  }
  return {
    workedMinutes,
    payableMinutes,
    regularMinutes,
    overtimeMinutes,
    regularPay,
    overtimePay,
    totalPay: regularPay + overtimePay,
  };
}

export function calculateWorkdayPayEntries(
  member: StaffMember,
  shifts: WorkShift[],
  now = new Date(),
  conflictScope: WorkShift[] = shifts,
): DatedWorkdayPay[] {
  const memberShifts = canonicalWorkShifts(shifts).filter((shift) => (
    shift.staffId === member.id && shift.status !== "void"
  ));
  const conflictScopeShifts = canonicalWorkShifts(conflictScope).filter((shift) => (
    shift.staffId === member.id && shift.status !== "void"
  ));
  const conflictingIds = new Set(conflictingWorkShiftIds(conflictScopeShifts));
  const shiftsByDate = new Map<string, WorkShift[]>();
  memberShifts.forEach((shift) => {
    shiftsByDate.set(shift.date, [...(shiftsByDate.get(shift.date) || []), shift]);
  });
  let cumulativePay = 0;
  let allocatedRoundedPay = 0;
  return [...shiftsByDate.entries()]
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([date, dayShifts]) => {
      const orderedShifts = dayShifts.slice().sort((left, right) => left.clockIn.localeCompare(right.clockIn));
      const recordedMinutes = orderedShifts.reduce((sum, shift) => sum + workShiftMinutes(shift, now), 0);
      const open = orderedShifts.some((shift) => shift.status === "open");
      const conflictingShiftIds = orderedShifts.filter((shift) => conflictingIds.has(shift.id)).map((shift) => shift.id);
      const conflict = conflictingShiftIds.length > 0;
      const pay = conflict
        ? { workedMinutes: 0, payableMinutes: 0, regularMinutes: 0, overtimeMinutes: 0, regularPay: 0, overtimePay: 0, totalPay: 0 }
        : calculateWorkdayPay(member, orderedShifts, now);
      let roundedTotalPay = 0;
      if (!open && !conflict) {
        cumulativePay += pay.totalPay;
        const nextRoundedPay = Math.round(cumulativePay);
        roundedTotalPay = nextRoundedPay - allocatedRoundedPay;
        allocatedRoundedPay = nextRoundedPay;
      }
      const roundedOvertimePay = Math.min(roundedTotalPay, Math.max(0, Math.round(pay.overtimePay)));
      return {
        date,
        shifts: orderedShifts,
        open,
        conflict,
        conflictingShiftIds,
        recordedMinutes,
        roundedRegularPay: roundedTotalPay - roundedOvertimePay,
        roundedOvertimePay,
        roundedTotalPay,
        ...pay,
      };
    });
}

export function workerMonthlyEarnings(
  member: StaffMember,
  shifts: WorkShift[],
  month: string,
  now = new Date(),
): WorkerMonthlyEarnings {
  const safeMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ? month
    : seoulCalendarDate(now).slice(0, 7);
  const memberMonthShifts = canonicalWorkShifts(shifts).filter((shift) => (
    shift.staffId === member.id && shift.status !== "void" && shift.date.startsWith(`${safeMonth}-`)
  ));
  const days = calculateWorkdayPayEntries(member, memberMonthShifts, now, memberMonthShifts)
    .map((entry): WorkerEarningDay => {
      const ordered = entry.shifts.slice().sort((left, right) => left.clockIn.localeCompare(right.clockIn));
      return {
        date: entry.date,
        clockIn: ordered[0]?.clockIn || "",
        clockOut: entry.open ? "" : ordered.at(-1)?.clockOut || "",
        workedMinutes: entry.recordedMinutes,
        payableMinutes: entry.payableMinutes,
        amount: entry.open || entry.conflict ? 0 : entry.roundedTotalPay,
        status: entry.conflict ? "conflict" : entry.open ? "open" : "closed",
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
  const closedDays = days.filter((day) => day.status === "closed" && day.workedMinutes > 0);
  return {
    month: safeMonth,
    workedDays: closedDays.length,
    workedMinutes: closedDays.reduce((sum, day) => sum + day.workedMinutes, 0),
    totalEarned: closedDays.reduce((sum, day) => sum + day.amount, 0),
    days,
  };
}

export function calculatePayroll(
  member: StaffMember,
  shifts: WorkShift[],
  adjustments: PayrollAdjustment[],
  month: string,
  options: { attendanceDays?: AttendanceDay[]; payments?: PayrollPayment[]; now?: Date } = {},
): PayrollSummary {
  const canonicalShifts = canonicalWorkShifts(shifts);
  const memberShifts = canonicalShifts.filter((shift) => shift.staffId === member.id && shift.status !== "void");
  const conflictingIds = new Set(conflictingWorkShiftIds(memberShifts));
  const conflictDates = new Set(memberShifts
    .filter((shift) => conflictingIds.has(shift.id))
    .map((shift) => shift.date));
  const memberMonthShifts = memberShifts.filter((shift) => (
    shift.staffId === member.id && shift.status !== "void" && shift.date.startsWith(`${month}-`)
  ));
  const openShiftDates = new Set(memberMonthShifts
    .filter((shift) => shift.status === "open")
    .map((shift) => shift.date));
  const monthShifts = memberMonthShifts.filter((shift) => (
    shift.status === "closed" && !openShiftDates.has(shift.date) && !conflictDates.has(shift.date)
  ));
  const occupiedShiftDates = new Set(memberMonthShifts.map((shift) => shift.date));
  const shiftPay = calculateWorkdayPayEntries(member, monthShifts, options.now, memberShifts);
  const workedMinutes = shiftPay.reduce((sum, entry) => sum + entry.workedMinutes, 0);
  const payableWorkedMinutes = shiftPay.reduce((sum, entry) => sum + entry.payableMinutes, 0);
  const workedDays = shiftPay.filter((entry) => entry.workedMinutes > 0).length;
  const plannedMinutes = Math.round(member.workDays * member.dailyHours * 60);
  const regularMinutes = shiftPay.reduce((sum, entry) => sum + entry.regularMinutes, 0);
  const overtimeMinutes = shiftPay.reduce((sum, entry) => sum + entry.overtimeMinutes, 0);
  const regularPay = shiftPay.reduce((sum, entry) => sum + entry.regularPay, 0);
  const overtimePay = shiftPay.reduce((sum, entry) => sum + entry.overtimePay, 0);
  const monthDays = (options.attendanceDays || []).filter((day) => (
    day.staffId === member.id && !day.voided && day.date.startsWith(`${month}-`) && !occupiedShiftDates.has(day.date)
  ));
  const paidDays = monthDays.filter((day) => day.payMode === "planned");
  const paidStatusMinutes = paidDays.reduce((sum, day) => (
    sum + (day.plannedMinutesAtDay > 0 ? day.plannedMinutesAtDay : Math.round(member.dailyHours * 60))
  ), 0);
  const paidStatusPay = paidDays.reduce((sum, day) => {
    const minutes = day.plannedMinutesAtDay > 0 ? day.plannedMinutesAtDay : Math.round(member.dailyHours * 60);
    const rate = day.hourlyRateAtDay > 0 ? day.hourlyRateAtDay : staffHourlyRate(member);
    return sum + minutes / 60 * rate;
  }, 0);
  const basePay = regularPay + overtimePay + paidStatusPay;
  const effectiveHourlyRate = payableWorkedMinutes > 0
    ? (regularPay + overtimePay) / (payableWorkedMinutes / 60)
    : staffHourlyRate(member);
  const monthAdjustments = adjustments.filter((entry) => (
    entry.staffId === member.id && !entry.voided && entry.date.startsWith(`${month}-`)
  ));
  const byType = (type: PayrollAdjustment["type"]) => monthAdjustments
    .filter((entry) => entry.type === type)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const bonus = byType("bonus");
  const advance = byType("advance");
  const deduction = byType("deduction");
  const paymentAmount = (options.payments || []).filter((payment) => (
    payment.staffId === member.id && payment.month === month && !payment.voided
  )).reduce((sum, payment) => sum + payment.amount, 0);
  const grossPay = basePay + bonus - deduction;
  const remaining = grossPay - advance - paymentAmount;
  return {
    workedMinutes,
    payableWorkedMinutes,
    workedDays,
    plannedMinutes,
    regularMinutes,
    overtimeMinutes,
    paidStatusMinutes,
    effectiveHourlyRate,
    regularPay,
    overtimePay,
    paidStatusPay,
    basePay,
    bonus,
    advance,
    deduction,
    grossPay,
    paymentAmount,
    remaining,
    offDays: monthDays.filter((day) => day.status === "off").length,
    absentDays: monthDays.filter((day) => day.status === "absent").length,
    sickDays: monthDays.filter((day) => day.status === "sick").length,
    payable: remaining,
  };
}

/**
 * One member's payroll for one month, split over that member's activity dates (date → won).
 * `canonicalShifts` may hold other members' rows as well: every step below filters by member.
 * The result does not depend on which day of the month is asked for, so a multi-day report
 * can compute it once per member and month (see createPayrollDateAllocator).
 */
function payrollMonthAllocations(
  member: StaffMember,
  canonicalShifts: WorkShift[],
  conflictingIds: Set<string>,
  adjustments: PayrollAdjustment[],
  attendanceDays: AttendanceDay[],
  month: string,
) {
  const allocations = new Map<string, number>();
  const memberMonthShifts = canonicalShifts.filter((shift) => (
    shift.staffId === member.id && shift.date.startsWith(`${month}-`)
  ));
  const memberMonthAdjustments = adjustments.filter((entry) => (
    entry.staffId === member.id && entry.date.startsWith(`${month}-`)
  ));
  const memberMonthAttendance = attendanceDays.filter((day) => (
    day.staffId === member.id && day.date.startsWith(`${month}-`)
  ));
  const activityDates = [...new Set([
    ...memberMonthShifts.map((shift) => shift.date),
    ...memberMonthAdjustments.map((entry) => entry.date),
    ...memberMonthAttendance.map((day) => day.date),
  ])].sort();
  if (!activityDates.length) return allocations;

  // Allocate every member's monthly gross pay across its activity dates with
  // cumulative rounding. This keeps daily reports additive: bonuses increase
  // payroll, deductions remain signed contra-expenses, advances do not affect
  // payroll expense, and the month's daily sum always equals the frozen monthly
  // payroll result down to the last won.
  let cumulativeGross = 0;
  let allocatedGross = 0;
  for (const activityDate of activityDates) {
    const dateHasConflict = memberMonthShifts.some((shift) => (
      shift.date === activityDate && conflictingIds.has(shift.id)
    ));
    const dailySummary = calculatePayroll(
      member,
      dateHasConflict ? [] : memberMonthShifts.filter((shift) => shift.date === activityDate),
      memberMonthAdjustments.filter((entry) => entry.date === activityDate),
      month,
      {
        attendanceDays: dateHasConflict
          ? []
          : memberMonthAttendance.filter((day) => day.date === activityDate),
        payments: [],
      },
    );
    cumulativeGross += dailySummary.grossPay;
    const nextAllocatedGross = Math.round(cumulativeGross);
    const dayGross = nextAllocatedGross - allocatedGross;
    allocatedGross = nextAllocatedGross;
    allocations.set(activityDate, dayGross);
  }
  const monthlyGross = Math.round(calculatePayroll(
    member,
    canonicalShifts,
    memberMonthAdjustments,
    month,
    { attendanceDays: memberMonthAttendance, payments: [] },
  ).grossPay);
  const reconciliationDate = activityDates.at(-1);
  if (reconciliationDate && allocatedGross !== monthlyGross) {
    allocations.set(
      reconciliationDate,
      (allocations.get(reconciliationDate) || 0) + monthlyGross - allocatedGross,
    );
  }
  return allocations;
}

export function calculatePayrollForDate(
  member: StaffMember,
  shifts: WorkShift[],
  adjustments: PayrollAdjustment[],
  attendanceDays: AttendanceDay[],
  date: string,
) {
  if (!cleanDate(date)) return 0;
  const canonicalShifts = canonicalWorkShifts(shifts);
  const conflictingIds = new Set(conflictingWorkShiftIds(canonicalShifts));
  return payrollMonthAllocations(
    member,
    canonicalShifts,
    conflictingIds,
    adjustments,
    attendanceDays,
    date.slice(0, 7),
  ).get(date) || 0;
}

/**
 * The same amounts as calculatePayrollForDate, for reports that ask about many dates over
 * the same payroll rows (a year of daily reports). Shift dates and overlaps are resolved
 * once, and each member's month is allocated once and then reused for every day of it.
 * The arrays must not change while the returned function is in use.
 */
export function createPayrollDateAllocator(
  shifts: WorkShift[],
  adjustments: PayrollAdjustment[],
  attendanceDays: AttendanceDay[],
) {
  const canonicalShifts = canonicalWorkShifts(shifts);
  const conflictingIds = new Set(conflictingWorkShiftIds(canonicalShifts));
  const shiftsByStaff = new Map<string, WorkShift[]>();
  for (const shift of canonicalShifts) {
    const list = shiftsByStaff.get(shift.staffId);
    if (list) list.push(shift);
    else shiftsByStaff.set(shift.staffId, [shift]);
  }
  // Keyed by the member object: two staff rows sharing an id are still paid by their own rates.
  const months = new WeakMap<StaffMember, Map<string, Map<string, number>>>();
  return (member: StaffMember, date: string) => {
    if (!cleanDate(date)) return 0;
    const month = date.slice(0, 7);
    let memberMonths = months.get(member);
    if (!memberMonths) {
      memberMonths = new Map();
      months.set(member, memberMonths);
    }
    let allocations = memberMonths.get(month);
    if (!allocations) {
      allocations = payrollMonthAllocations(
        member,
        shiftsByStaff.get(member.id) || [],
        conflictingIds,
        adjustments,
        attendanceDays,
        month,
      );
      memberMonths.set(month, allocations);
    }
    return allocations.get(date) || 0;
  };
}

export function validPayrollState(
  staffValue: unknown,
  shiftsValue: unknown,
  adjustmentsValue: unknown,
  attendanceDaysValue: unknown = [],
  payrollPaymentsValue: unknown = [],
) {
  if (
    !Array.isArray(staffValue) || !Array.isArray(shiftsValue) || !Array.isArray(adjustmentsValue)
    || !Array.isArray(attendanceDaysValue) || !Array.isArray(payrollPaymentsValue)
  ) return false;
  const staffIds = new Set<string>();
  const workerIds = new Set<string>();
  for (const entry of staffValue) {
    if (!entry || typeof entry !== "object") return false;
    const member = entry as Record<string, unknown>;
    const memberId = String(member.id || "").trim();
    const name = String(member.name || "").trim();
    const payType = member.payType === undefined ? "monthly" : member.payType;
    const monthlySalary = finiteNumber(member.monthlySalary);
    const hourlyRate = member.hourlyRate === undefined ? 0 : finiteNumber(member.hourlyRate, Number.NaN);
    const workDays = finiteNumber(member.workDays, Number.NaN);
    const dailyHours = member.dailyHours === undefined ? 12 : finiteNumber(member.dailyHours, Number.NaN);
    const overtimeAfterHours = member.overtimeAfterHours === undefined
      ? dailyHours
      : finiteNumber(member.overtimeAfterHours, Number.NaN);
    const overtimeMultiplier = member.overtimeMultiplier === undefined
      ? 1
      : finiteNumber(member.overtimeMultiplier, Number.NaN);
    const rawScheduledStartTime = member.scheduledStartTime === undefined ? "" : String(member.scheduledStartTime).trim();
    const rawScheduledEndTime = member.scheduledEndTime === undefined ? "" : String(member.scheduledEndTime).trim();
    const scheduledStartTime = cleanTime(rawScheduledStartTime);
    const scheduledEndTime = cleanTime(rawScheduledEndTime);
    const scheduleValid = (!rawScheduledStartTime && !rawScheduledEndTime)
      || Boolean(rawScheduledStartTime === scheduledStartTime
        && rawScheduledEndTime === scheduledEndTime
        && scheduledStartTime && scheduledEndTime
        && shiftRange("2026-01-01", scheduledStartTime, scheduledEndTime));
    const workerId = String(member.workerId || "").trim();
    if (
      !memberId || staffIds.has(memberId) || !name || name.length > 60
      || !["monthly", "hourly"].includes(String(payType))
      || !Number.isFinite(monthlySalary) || monthlySalary < 0
      || !Number.isFinite(hourlyRate) || hourlyRate < 0
      || !Number.isFinite(workDays) || workDays < 1 || workDays > 31
      || !Number.isFinite(dailyHours) || dailyHours < 0.5 || dailyHours > 18
      || !Number.isFinite(overtimeAfterHours) || overtimeAfterHours < 0.5 || overtimeAfterHours > 18
      || !Number.isFinite(overtimeMultiplier) || overtimeMultiplier < 1 || overtimeMultiplier > 5
      || !scheduleValid
      || (payType === "monthly" && monthlySalary <= 0)
      || (payType === "hourly" && hourlyRate <= 0)
      || (workerId && workerIds.has(workerId))
      || !validOptionalCancellation(member, "cancellationReason")
    ) return false;
    staffIds.add(memberId);
    if (workerId) workerIds.add(workerId);
  }

  const shiftIds = new Set<string>();
  const openStaff = new Set<string>();
  const intervals = new Map<string, Array<[number, number]>>();
  for (const entry of shiftsValue) {
    if (!entry || typeof entry !== "object") return false;
    const shift = entry as Record<string, unknown>;
    const shiftId = String(shift.id || "").trim();
    const staffId = String(shift.staffId || "").trim();
    const date = cleanDate(shift.date);
    const status = shift.status;
    const start = Date.parse(String(shift.clockIn || ""));
    const clockOut = String(shift.clockOut || "");
    const end = clockOut ? Date.parse(clockOut) : Number.NaN;
    const breakMinutes = finiteNumber(shift.breakMinutes, Number.NaN);
    const hourlyRateAtShift = shift.hourlyRateAtShift === undefined
      ? 0
      : finiteNumber(shift.hourlyRateAtShift, Number.NaN);
    const overtimeAfterHoursAtShift = shift.overtimeAfterHoursAtShift === undefined
      ? 0
      : finiteNumber(shift.overtimeAfterHoursAtShift, Number.NaN);
    const overtimeMultiplierAtShift = shift.overtimeMultiplierAtShift === undefined
      ? 0
      : finiteNumber(shift.overtimeMultiplierAtShift, Number.NaN);
    const payWindowStartAtShift = String(shift.payWindowStartAtShift || "");
    const payWindowEndAtShift = String(shift.payWindowEndAtShift || "");
    const payWindowStartMs = payWindowStartAtShift ? Date.parse(payWindowStartAtShift) : Number.NaN;
    const payWindowEndMs = payWindowEndAtShift ? Date.parse(payWindowEndAtShift) : Number.NaN;
    const payWindowValid = (!payWindowStartAtShift && !payWindowEndAtShift)
      || (Number.isFinite(payWindowStartMs) && Number.isFinite(payWindowEndMs)
        && payWindowEndMs > payWindowStartMs && payWindowEndMs - payWindowStartMs <= 18 * 60 * 60_000);
    const source = shift.source === "worker" ? "worker" : "owner";
    if (
      !shiftId || shiftIds.has(shiftId) || !staffIds.has(staffId) || !date
      || !Number.isFinite(start) || !Number.isFinite(breakMinutes) || breakMinutes < 0
      || (source === "worker" && date !== seoulCalendarDate(new Date(start)))
      || !["open", "closed", "void"].includes(String(status))
      || !Number.isFinite(hourlyRateAtShift) || hourlyRateAtShift < 0
      || !Number.isFinite(overtimeAfterHoursAtShift) || overtimeAfterHoursAtShift < 0 || overtimeAfterHoursAtShift > 18
      || !Number.isFinite(overtimeMultiplierAtShift)
      || (overtimeMultiplierAtShift !== 0 && (overtimeMultiplierAtShift < 1 || overtimeMultiplierAtShift > 5))
      || !payWindowValid
      || !validOptionalCancellation(shift)
    ) return false;
    shiftIds.add(shiftId);
    if (status === "void") continue;
    if (status === "open") {
      if (clockOut || openStaff.has(staffId)) return false;
      openStaff.add(staffId);
      const staffIntervals = intervals.get(staffId) || [];
      const latestAllowedEnd = start + 18 * 60 * 60_000;
      if (staffIntervals.some(([left, right]) => start < right && latestAllowedEnd > left)) return false;
      staffIntervals.push([start, latestAllowedEnd]);
      intervals.set(staffId, staffIntervals);
      continue;
    }
    const elapsed = (end - start) / 60_000;
    if (!Number.isFinite(end) || elapsed <= 0 || elapsed > 18 * 60 || breakMinutes >= elapsed) return false;
    const staffIntervals = intervals.get(staffId) || [];
    if (staffIntervals.some(([left, right]) => start < right && end > left)) return false;
    staffIntervals.push([start, end]);
    intervals.set(staffId, staffIntervals);
  }

  const adjustmentIds = new Set<string>();
  for (const entry of adjustmentsValue) {
    if (!entry || typeof entry !== "object") return false;
    const adjustment = entry as Record<string, unknown>;
    const adjustmentId = String(adjustment.id || "").trim();
    const amount = finiteNumber(adjustment.amount, Number.NaN);
    if (
      !adjustmentId || adjustmentIds.has(adjustmentId)
      || !staffIds.has(String(adjustment.staffId || ""))
      || !cleanDate(adjustment.date)
      || !["advance", "bonus", "deduction"].includes(String(adjustment.type || ""))
      || !Number.isFinite(amount) || amount <= 0
      || !validOptionalCancellation(adjustment)
    ) return false;
    adjustmentIds.add(adjustmentId);
  }

  const activeDayKeys = new Set<string>();
  const dayIds = new Set<string>();
  for (const entry of attendanceDaysValue) {
    if (!entry || typeof entry !== "object") return false;
    const day = entry as Record<string, unknown>;
    const dayId = String(day.id || "").trim();
    const staffId = String(day.staffId || "").trim();
    const date = cleanDate(day.date);
    const payMode = day.payMode === undefined ? "unpaid" : String(day.payMode);
    const plannedMinutes = day.plannedMinutesAtDay === undefined ? 0 : finiteNumber(day.plannedMinutesAtDay, Number.NaN);
    const hourlyRate = day.hourlyRateAtDay === undefined ? 0 : finiteNumber(day.hourlyRateAtDay, Number.NaN);
    if (
      !dayId || dayIds.has(dayId) || !staffIds.has(staffId) || !date
      || !["off", "absent", "sick"].includes(String(day.status || ""))
      || !["unpaid", "planned"].includes(payMode)
      || !Number.isFinite(plannedMinutes) || plannedMinutes < 0 || plannedMinutes > 1_080
      || !Number.isFinite(hourlyRate) || hourlyRate < 0
      || !validOptionalCancellation(day)
    ) return false;
    dayIds.add(dayId);
    if (day.voided === true) continue;
    const key = `${staffId}:${date}`;
    if (activeDayKeys.has(key)) return false;
    activeDayKeys.add(key);
    if (shiftsValue.some((shiftEntry) => {
      const shift = shiftEntry as Record<string, unknown>;
      return shift.status !== "void" && String(shift.staffId || "") === staffId && String(shift.date || "") === date;
    })) return false;
    if (payMode === "planned" && (plannedMinutes <= 0 || hourlyRate <= 0)) return false;
  }

  const paymentIds = new Set<string>();
  for (const entry of payrollPaymentsValue) {
    if (!entry || typeof entry !== "object") return false;
    const payment = entry as Record<string, unknown>;
    const paymentId = String(payment.id || "").trim();
    const amount = finiteNumber(payment.amount, Number.NaN);
    const paidAt = String(payment.paidAt || "");
    const paidAtMs = paidAt ? Date.parse(paidAt) : Number.NaN;
    if (
      !paymentId || paymentIds.has(paymentId) || !staffIds.has(String(payment.staffId || ""))
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(payment.month || "")) || !cleanDate(payment.date)
      || !["advance", "salary"].includes(String(payment.kind || ""))
      || !Number.isFinite(amount) || amount <= 0
      || !String(payment.accountId || "").trim() || !String(payment.financialEntryId || "").trim()
      || (paidAt && (!Number.isFinite(paidAtMs) || seoulCalendarDate(new Date(paidAtMs)) !== String(payment.date || "")))
      || !validOptionalCancellation(payment)
    ) return false;
    paymentIds.add(paymentId);
  }
  return true;
}

export function validPayrollFinanceLinks(
  paymentsValue: unknown,
  accountsValue: unknown,
  financialEntriesValue: unknown,
) {
  if (!Array.isArray(paymentsValue) || !Array.isArray(accountsValue) || !Array.isArray(financialEntriesValue)) return false;
  const accountIds = new Set(accountsValue.map((entry) => String((entry as Record<string, unknown>)?.id || "")).filter(Boolean));
  const entries = new Map(financialEntriesValue.map((entry) => {
    const value = entry as Record<string, unknown>;
    return [String(value?.id || ""), value] as const;
  }));
  const paymentIds = new Set(paymentsValue.map((entry) => String((entry as Record<string, unknown>)?.id || "")).filter(Boolean));
  const expectedEntryIds = new Map<string, Set<string>>();
  const paymentsValid = paymentsValue.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const payment = entry as Record<string, unknown>;
    const paymentId = String(payment.id || "");
    const financialEntryId = String(payment.financialEntryId || "");
    const accountId = String(payment.accountId || "");
    const finance = entries.get(financialEntryId);
    if (
      !paymentId || !accountIds.has(accountId) || !finance
      || finance.type !== "expense" || finance.category !== "Maosh to‘lovi"
      || finance.affectsProfit !== false || String(finance.accountId || "") !== accountId
      || String(finance.payrollPaymentId || "") !== paymentId
      || Number(finance.amount) !== Number(payment.amount)
      || String(finance.date || "") !== String(payment.date || "")
    ) return false;
    const expected = new Set([financialEntryId]);
    expectedEntryIds.set(paymentId, expected);
    if (payment.voided !== true) return !String(payment.reversalEntryId || "");
    const reversal = entries.get(String(payment.reversalEntryId || ""));
    expected.add(String(payment.reversalEntryId || ""));
    return Boolean(
      reversal && reversal.type === "income" && reversal.affectsProfit === false
      && String(reversal.accountId || "") === accountId
      && String(reversal.payrollPaymentId || "") === paymentId
      && String(reversal.reversedEntryId || "") === financialEntryId
      && Number(reversal.amount) === Number(payment.amount),
    );
  });
  if (!paymentsValid) return false;
  const linkedCounts = new Map<string, number>();
  const reverseValid = financialEntriesValue.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const finance = entry as Record<string, unknown>;
    const paymentId = String(finance.payrollPaymentId || "");
    if (!paymentId) return true;
    linkedCounts.set(paymentId, (linkedCounts.get(paymentId) || 0) + 1);
    return paymentIds.has(paymentId) && Boolean(expectedEntryIds.get(paymentId)?.has(String(finance.id || "")));
  });
  return reverseValid && [...expectedEntryIds].every(([paymentId, expected]) => linkedCounts.get(paymentId) === expected.size);
}

export function shiftRange(date: string, clockIn: string, clockOut: string) {
  if (!cleanDate(date) || !/^\d{2}:\d{2}$/.test(clockIn) || !/^\d{2}:\d{2}$/.test(clockOut) || clockIn === clockOut) return null;
  // Owner kiritadigan vaqtlar restoran joylashgan Seoul vaqtidir, qurilma vaqt zonasi emas.
  const start = new Date(`${date}T${clockIn}:00+09:00`);
  let end = new Date(`${date}T${clockOut}:00+09:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end <= start) end = new Date(end.getTime() + 86_400_000);
  const elapsedMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (elapsedMinutes <= 0 || elapsedMinutes > 18 * 60) return null;
  return { clockIn: start.toISOString(), clockOut: end.toISOString(), elapsedMinutes };
}

export function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${hours} soat ${rest.toString().padStart(2, "0")} daqiqa`;
}
