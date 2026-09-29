import {
  calculatePayroll,
  calculateWorkdayPayEntries,
  workShiftMinutes,
  workShiftCalendarDate,
  type AttendanceDay,
  type PayrollAdjustment,
  type PayrollPayment,
  type PayrollSummary,
  type StaffMember,
  type WorkShift,
} from "./payroll.ts";
import { seoulClock } from "./business-time.ts";

type Cell = string | number;
export type PayrollReportRow = Record<string, Cell>;

export type PayrollReport = {
  summaryRows: PayrollReportRow[];
  dailyPayRows: PayrollReportRow[];
  shiftRows: PayrollReportRow[];
  dayRows: PayrollReportRow[];
  adjustmentRows: PayrollReportRow[];
  paymentRows: PayrollReportRow[];
  googleSheetsRows: PayrollReportRow[];
};

type PayrollReportInput = {
  staff: StaffMember[];
  workShifts: WorkShift[];
  payrollAdjustments: PayrollAdjustment[];
  attendanceDays: AttendanceDay[];
  payrollPayments: PayrollPayment[];
  accounts?: Array<{ id: string; name: string }>;
  month: string;
  now?: Date;
};

const hours = (minutes: number) => Math.round(Math.max(0, minutes) / 6) / 10;
const monthDate = (value: string, month: string) => value.startsWith(`${month}-`);

const attendanceStatus = (status: AttendanceDay["status"]) => (
  status === "off" ? "Dam olish" : status === "sick" ? "Kasal" : "Kelmadi"
);

export function buildPayrollReport({
  staff,
  workShifts,
  payrollAdjustments,
  attendanceDays,
  payrollPayments,
  accounts = [],
  month,
  now = new Date(),
}: PayrollReportInput): PayrollReport {
  const canonicalWorkShifts = workShifts.flatMap((shift) => {
    const date = workShiftCalendarDate(shift);
    return date ? [{ ...shift, date }] : [];
  });
  const monthShifts = canonicalWorkShifts.filter((shift) => shift.status !== "void" && monthDate(shift.date, month));
  const monthDays = attendanceDays.filter((day) => !day.voided && monthDate(day.date, month));
  const monthAdjustments = payrollAdjustments.filter((entry) => !entry.voided && monthDate(entry.date, month));
  const monthPayments = payrollPayments.filter((payment) => payment.month === month);
  const recordedStaffIds = new Set([
    ...monthShifts.map((entry) => entry.staffId),
    ...monthDays.map((entry) => entry.staffId),
    ...monthAdjustments.map((entry) => entry.staffId),
    ...monthPayments.map((entry) => entry.staffId),
  ]);
  const reportStaff = staff
    .filter((member) => member.active || recordedStaffIds.has(member.id))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, "uz"));
  const memberById = new Map(reportStaff.map((member) => [member.id, member]));
  const summaryByStaffId = new Map<string, PayrollSummary>(reportStaff.map((member) => [
    member.id,
    calculatePayroll(member, canonicalWorkShifts, payrollAdjustments, month, {
      attendanceDays,
      payments: payrollPayments,
      now,
    }),
  ]));
  const dailyPayEntriesByStaffId = new Map(reportStaff.map((member) => [
    member.id,
    calculateWorkdayPayEntries(member, monthShifts, now, canonicalWorkShifts),
  ]));
  const dayMinutes = new Map<string, number>();
  const payableDayMinutes = new Map<string, number>();
  for (const [staffId, days] of dailyPayEntriesByStaffId) {
    for (const day of days) {
      const key = `${staffId}:${day.date}`;
      dayMinutes.set(key, day.recordedMinutes);
      payableDayMinutes.set(key, day.payableMinutes);
    }
  }

  const summaryRows = reportStaff.map((member) => {
    const summary = summaryByStaffId.get(member.id)!;
    return {
      "Hisobot oyi": month,
      Xodim: member.name,
      Holat: member.active ? "Faol" : "Arxiv",
      "Hisob turi": member.payType === "monthly" ? "Oylik" : "Soatbay",
      "Reja ish kuni": member.workDays,
      "Reja kunlik soat": member.dailyHours,
      "Ish kuni": summary.workedDays,
      "Dam kuni": summary.offDays,
      "Kasal kuni": summary.sickDays,
      "Kelmagan kuni": summary.absentDays,
      "Ishlangan soat": hours(summary.workedMinutes),
      "Maoshga hisoblangan ish soati": hours(summary.payableWorkedMinutes),
      "Oddiy soat": hours(summary.regularMinutes),
      "Qo‘shimcha soat": hours(summary.overtimeMinutes),
      "Holat uchun soat": hours(summary.paidStatusMinutes),
      "Jami hisoblangan soat": hours(summary.payableWorkedMinutes + summary.paidStatusMinutes),
      "Oddiy ish puli": Math.round(summary.regularPay),
      "Qo‘shimcha ish puli": Math.round(summary.overtimePay),
      "Holat uchun pul": Math.round(summary.paidStatusPay),
      "Asosiy hisob": Math.round(summary.basePay),
      Bonus: Math.round(summary.bonus),
      "Eski avans": Math.round(summary.advance),
      Ushlanma: Math.round(summary.deduction),
      "Hisoblangan maosh": Math.round(summary.grossPay),
      "To‘langan": Math.round(summary.paymentAmount),
      "Qoldiq to‘lov": Math.round(summary.remaining),
    };
  });

  const dailyPayRow = (member: StaffMember, day: ReturnType<typeof calculateWorkdayPayEntries>[number]) => {
    const firstShift = day.shifts[0];
    const lastShift = day.shifts[day.shifts.length - 1];
    const pending = day.open || day.conflict;
    return {
      "Hisobot oyi": month,
      Xodim: member.name,
      Sana: day.date,
      "Smenalar soni": day.shifts.length,
      Keldi: firstShift ? seoulClock(new Date(firstShift.clockIn)) : "",
      Ketdi: day.open ? "Hozir ishda" : lastShift?.clockOut ? seoulClock(new Date(lastShift.clockOut)) : "",
      "Haqiqiy soat": hours(day.conflict ? day.recordedMinutes : day.workedMinutes),
      "Hisoblangan soat": hours(day.payableMinutes),
      "Oddiy soat": hours(day.regularMinutes),
      "Qo‘shimcha soat": hours(day.overtimeMinutes),
      "Oddiy ish puli": pending ? "" : day.roundedRegularPay,
      "Qo‘shimcha ish puli": pending ? "" : day.roundedOvertimePay,
      "Kunlik qo‘shilgan pul": pending ? "" : day.roundedTotalPay,
      Holat: day.conflict
        ? "Smenalar ustma-ust — tuzatilmaguncha hisoblanmadi"
        : day.open ? "Hozir ishda — summa yakuniy emas" : "Yakunlangan",
    };
  };

  const dailyPayRows = reportStaff.flatMap((member) => (
    (dailyPayEntriesByStaffId.get(member.id) || []).map((day) => dailyPayRow(member, day))
  ));

  const shiftRows = monthShifts
    .filter((shift) => memberById.has(shift.staffId))
    .slice()
    .sort((left, right) => {
      const leftName = memberById.get(left.staffId)?.name || "";
      const rightName = memberById.get(right.staffId)?.name || "";
      return leftName.localeCompare(rightName, "uz")
        || left.date.localeCompare(right.date)
        || left.clockIn.localeCompare(right.clockIn);
    })
    .map((shift) => {
      const summary = summaryByStaffId.get(shift.staffId)!;
      return {
        "Hisobot oyi": month,
        Xodim: memberById.get(shift.staffId)!.name,
        Sana: shift.date,
        Keldi: seoulClock(new Date(shift.clockIn)),
        Ketdi: shift.clockOut ? seoulClock(new Date(shift.clockOut)) : "Hozir ishda",
        "Tanaffus (daqiqa)": shift.breakMinutes,
        "Smena soati": hours(workShiftMinutes(shift, now)),
        "Kun haqiqiy soat": hours(dayMinutes.get(`${shift.staffId}:${shift.date}`) || 0),
        "Kun jami soat": hours(payableDayMinutes.get(`${shift.staffId}:${shift.date}`) || 0),
        "Kun hisoblangan soat": hours(payableDayMinutes.get(`${shift.staffId}:${shift.date}`) || 0),
        "Oy haqiqiy soat": hours(summary.workedMinutes),
        "Oy jami soat": hours(summary.payableWorkedMinutes),
        Manba: shift.source === "worker" ? "Xodim ISHNI BOSHLADIM / ISHNI TUGATDIM" : "Rahbar",
        Izoh: shift.note,
      };
    });

  const dayRows = monthDays
    .filter((day) => memberById.has(day.staffId))
    .slice()
    .sort((left, right) => (
      (memberById.get(left.staffId)?.name || "").localeCompare(memberById.get(right.staffId)?.name || "", "uz")
      || left.date.localeCompare(right.date)
    ))
    .map((day) => ({
      "Hisobot oyi": month,
      Xodim: memberById.get(day.staffId)!.name,
      Sana: day.date,
      Holat: attendanceStatus(day.status),
      "Maoshga ta’siri": day.payMode === "planned" ? "Reja soati hisoblandi" : "Haqsiz",
      "Hisoblangan soat": day.payMode === "planned" ? hours(day.plannedMinutesAtDay) : 0,
      Izoh: day.note,
    }));

  const adjustmentRows = monthAdjustments
    .filter((entry) => memberById.has(entry.staffId))
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((entry) => ({
      "Hisobot oyi": month,
      Xodim: memberById.get(entry.staffId)!.name,
      Sana: entry.date,
      Turi: entry.type === "bonus" ? "Bonus" : entry.type === "advance" ? "Eski avans" : "Ushlanma",
      Summa: Math.round(entry.amount),
      Izoh: entry.note,
    }));

  const paymentRows = monthPayments
    .filter((payment) => memberById.has(payment.staffId))
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((payment) => ({
      "Hisobot oyi": month,
      Xodim: memberById.get(payment.staffId)!.name,
      Sana: payment.date,
      "Berilgan vaqt": payment.paidAt ? seoulClock(new Date(payment.paidAt)) : "Oldin yozilmagan",
      Turi: payment.kind === "advance" ? "Avans to‘lovi" : "Oylik to‘lovi",
      Summa: Math.round(payment.amount),
      Hisob: accounts.find((account) => account.id === payment.accountId)?.name || payment.accountId || "Noma’lum",
      Holat: payment.voided ? "Bekor qilingan" : "Amalda",
      Izoh: payment.note,
    }));

  const googleSheetsRows = reportStaff.flatMap((member) => {
    const summary = summaryByStaffId.get(member.id)!;
    const shared = {
      "Hisobot oyi": month,
      Xodim: member.name,
    };
    const monthlyTotals = {
      "Oy haqiqiy soat": hours(summary.workedMinutes),
      "Oy jami soat": hours(summary.payableWorkedMinutes),
      "Ish kunlari": summary.workedDays,
      "Dam kunlari": summary.offDays,
      "Kasal kunlari": summary.sickDays,
      "Kelmagan kunlari": summary.absentDays,
      "Hisoblangan maosh": Math.round(summary.grossPay),
      "To‘langan": Math.round(summary.paymentAmount),
      "Qoldiq to‘lov": Math.round(summary.remaining),
    };
    const memberShiftRows = monthShifts
      .filter((shift) => shift.staffId === member.id)
      .sort((left, right) => left.clockIn.localeCompare(right.clockIn))
      .map((shift) => ({
        ...shared,
        "Yozuv turi": "Ish vaqti",
        Sana: shift.date,
        Holat: shift.status === "open" ? "Hozir ishda" : "Ishladi",
        Keldi: seoulClock(new Date(shift.clockIn)),
        Ketdi: shift.clockOut ? seoulClock(new Date(shift.clockOut)) : "",
        "Smena soati": hours(workShiftMinutes(shift, now)),
        "Kun haqiqiy soat": hours(dayMinutes.get(`${shift.staffId}:${shift.date}`) || 0),
        "Kun jami soat": hours(payableDayMinutes.get(`${shift.staffId}:${shift.date}`) || 0),
        Manba: shift.source === "worker" ? "Xodim ISHNI BOSHLADIM / ISHNI TUGATDIM" : "Rahbar",
        Izoh: shift.note,
      }));
    const memberDailyPayRows = (dailyPayEntriesByStaffId.get(member.id) || []).map((day) => ({
      ...shared,
      "Yozuv turi": "Kunlik ish haqi",
      Sana: day.date,
      Holat: day.conflict
        ? "Smenalar ustma-ust — tuzatilmaguncha hisoblanmadi"
        : day.open ? "Hozir ishda — summa yakuniy emas" : "Yakunlangan",
      Keldi: day.shifts[0] ? seoulClock(new Date(day.shifts[0].clockIn)) : "",
      Ketdi: day.open ? "" : day.shifts.at(-1)?.clockOut ? seoulClock(new Date(day.shifts.at(-1)!.clockOut)) : "",
      "Haqiqiy soat": hours(day.conflict ? day.recordedMinutes : day.workedMinutes),
      "Hisoblangan soat": hours(day.payableMinutes),
      "Oddiy soat": hours(day.regularMinutes),
      "Qo‘shimcha soat": hours(day.overtimeMinutes),
      "Oddiy ish puli": day.open || day.conflict ? "" : day.roundedRegularPay,
      "Qo‘shimcha ish puli": day.open || day.conflict ? "" : day.roundedOvertimePay,
      "Kunlik qo‘shilgan pul": day.open || day.conflict ? "" : day.roundedTotalPay,
      Manba: day.shifts.some((shift) => shift.source === "worker")
        ? "Xodim ISHNI BOSHLADIM / ISHNI TUGATDIM"
        : "Rahbar",
      Izoh: day.conflict
        ? "Ustma-ust smenalardan bittasini tahrirlang yoki bekor qiling"
        : day.shifts.length > 1 ? `${day.shifts.length} ta smena bir kun bo‘yicha jamlandi` : "Kunlik hisob",
    }));
    const memberDayRows = monthDays
      .filter((day) => day.staffId === member.id)
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((day) => ({
        ...shared,
        "Yozuv turi": "Kun holati",
        Sana: day.date,
        Holat: attendanceStatus(day.status),
        Keldi: "",
        Ketdi: "",
        "Smena soati": 0,
        "Kun jami soat": 0,
        "Hisoblangan soat": day.payMode === "planned" ? hours(day.plannedMinutesAtDay) : 0,
        "Maoshga ta’siri": day.payMode === "planned" ? "Reja soati hisoblandi" : "Haqsiz",
        Manba: "Rahbar",
        Izoh: day.note,
      }));
    return [
      ...memberDailyPayRows,
      ...memberShiftRows,
      ...memberDayRows,
      {
        ...shared,
        ...monthlyTotals,
        "Yozuv turi": "Oylik xulosa",
        Sana: "",
        Holat: member.active ? "Faol" : "Arxiv",
        Keldi: "",
        Ketdi: "",
        "Smena soati": "",
        "Kun jami soat": "",
        "Hisoblangan soat": hours(summary.payableWorkedMinutes + summary.paidStatusMinutes),
        "Maoshga ta’siri": "Oylik yakuniy hisob",
        Manba: "HALO Control",
        Izoh: "Tanlangan oy yakuni",
      },
    ];
  });

  return { summaryRows, dailyPayRows, shiftRows, dayRows, adjustmentRows, paymentRows, googleSheetsRows };
}
