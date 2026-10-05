import { mutateHaloState, readHaloState } from "../../lib/halo-store";
import {
  normalizeStaff,
  normalizeAttendanceDays,
  normalizeWorkShifts,
  staffPayWindowForInstant,
  staffHourlyRate,
  toWorkerAttendanceShift,
  workerMonthlyEarnings,
  type WorkShift,
} from "../../lib/payroll";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { seoulCalendarDate } from "../../lib/business-time";
import { maybeSendWorkerKitchenRules } from "../../lib/worker-tasks";
import { isAccountingMonthClosed } from "../../lib/month-end";
import type { D1Like } from "../../lib/full-migration";
import { checkAttendanceLocation, logAttendanceAttempt, PlaceError, readAttendancePlace, type AttendancePlace } from "../../core/attendance-place";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
/** Davomat joyi (yangi saytda): xodim tugmani faqat oshxona yaqinida bosa oladi. Eski saytda — cheklov yo'q. */
const placeDb = (): D1Like | null => (globalThis.__HALO_SELF_HOSTED__ === true && globalThis.__HALO_CONTROL_DB__ ? globalThis.__HALO_CONTROL_DB__ as unknown as D1Like : null);
async function placeFor(branchId: string): Promise<AttendancePlace | null> {
  const db = placeDb();
  return db ? readAttendancePlace(db, branchId) : null;
}
const placeView = (place: AttendancePlace | null) => ({ required: Boolean(place?.enabled), radius: place?.radius ?? 0 });

class AttendanceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttendanceError";
    this.status = status;
  }
}

function requestedMonth(value: unknown, now = new Date()) {
  const month = String(value || "");
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : seoulCalendarDate(now).slice(0, 7);
}

function ownAttendance(state: Record<string, unknown>, workerId: string, month: string, now = new Date()) {
  const member = normalizeStaff(state.staff).find((entry) => entry.workerId === workerId && entry.active);
  if (!member) return { linked: false as const };
  const shifts = normalizeWorkShifts(state.workShifts).filter((shift) => (
    shift.staffId === member.id && shift.status !== "void"
  ));
  const openShift = shifts.find((shift) => shift.status === "open") || null;
  const businessDate = seoulCalendarDate(now);
  const todayStatus = normalizeAttendanceDays(state.attendanceDays).find((day) => (
    day.staffId === member.id && day.date === businessDate && !day.voided
  )) || null;
  return {
    linked: true as const,
    member: { id: member.id, name: member.name },
    businessDate,
    openShift: toWorkerAttendanceShift(openShift),
    todayStatus: todayStatus ? { status: todayStatus.status, note: todayStatus.note } : null,
    earnings: workerMonthlyEarnings(member, shifts, month, now),
  };
}

export async function GET(request: Request) {
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    const current = await readHaloState(session.branchId);
    const month = requestedMonth(new URL(request.url).searchParams.get("month"));
    const attendance = ownAttendance(current.state, session.userId, month);
    if (attendance.linked && attendance.openShift) {
      await maybeSendWorkerKitchenRules({
        workerId: session.userId,
        branchId: session.branchId,
        workerName: attendance.member.name,
        shiftId: attendance.openShift.id,
        rules: current.state.kitchenRules,
        reminderHours: current.state.kitchenRuleReminderHours,
      }).catch(() => undefined);
    }
    // Sozlama o'qilmasa sahifa baribir ochiladi — tugma bosilganda server yana tekshiradi.
    const place = await placeFor(session.branchId).catch(() => null);
    return Response.json({ ...attendance, place: placeView(place) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Davomat ochilmadi." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    const body = await request.json() as { action?: unknown; month?: unknown; location?: unknown };
    const action = String(body.action || "");
    const month = requestedMonth(body.month);
    if (action !== "clock-in" && action !== "clock-out") {
      return Response.json({ error: "Noto‘g‘ri amal." }, { status: 400 });
    }
    const now = new Date();
    // Joy cheklovi: uzoqda yoki joylashuvsiz bosilgan tugma yozilmaydi; urinish jurnalda qoladi (koordinatasiz).
    const place = await placeFor(session.branchId);
    let located: { distance: number; accuracy: number } | null = null;
    if (place?.enabled) {
      try {
        located = checkAttendanceLocation(place, body.location);
      } catch (error) {
        if (!(error instanceof PlaceError)) throw error;
        await logAttendanceAttempt(placeDb()!, session.branchId, {
          staffName: session.name, action, ok: false, distance: error.details.distance ?? null, accuracy: error.details.accuracy ?? null, reason: error.code,
        }, now.toISOString());
        return Response.json({ error: error.message, code: error.code, ...error.details }, { status: error.status });
      }
    }
    const mutation = await mutateHaloState((state) => {
      const staff = normalizeStaff(state.staff);
      const member = staff.find((entry) => entry.workerId === session.userId && entry.active);
      if (!member) throw new AttendanceError("Rahbar davomat profilingizni xodim akkauntiga bog‘lamagan.");
      const rawShifts = Array.isArray(state.workShifts) ? state.workShifts : [];
      const shifts = normalizeWorkShifts(rawShifts);
      const businessDate = seoulCalendarDate(now);
      const todayStatus = normalizeAttendanceDays(state.attendanceDays).find((day) => (
        day.staffId === member.id && day.date === businessDate && !day.voided
      ));
      const openShift = shifts.find((shift) => shift.staffId === member.id && shift.status === "open");
      if (action === "clock-in") {
        if (isAccountingMonthClosed(state.monthlyCloses, businessDate)) {
          throw new AttendanceError(`${businessDate.slice(0, 7)} oyi yopilgan. Yangi smenani ochiq oyda boshlang.`, 409);
        }
        if (todayStatus) {
          const label = todayStatus.status === "off" ? "Dam olish" : todayStatus.status === "sick" ? "Kasal" : "Kelmadi";
          throw new AttendanceError(`Rahbar bugunni “${label}” deb belgilagan. Holatni o‘zgartirish uchun rahbarga ayting.`);
        }
        if (openShift) return { state, result: { unchanged: true } };
        const nowMs = now.getTime();
        const latestAllowedEnd = nowMs + 18 * 60 * 60_000;
        const overlappingClosedShift = shifts.find((shift) => (
          shift.staffId === member.id
          && shift.status === "closed"
          && Date.parse(shift.clockIn) < latestAllowedEnd
          && Date.parse(shift.clockOut) > nowMs
        ));
        if (overlappingClosedShift) {
          throw new AttendanceError("Bu vaqt uchun smena rahbar tomonidan oldin kiritilgan. Rahbar bilan tekshiring.");
        }
        const shift: WorkShift = {
          id: crypto.randomUUID(),
          staffId: member.id,
          date: seoulCalendarDate(now),
          clockIn: now.toISOString(),
          clockOut: "",
          breakMinutes: 0,
          hourlyRateAtShift: staffHourlyRate(member),
          overtimeAfterHoursAtShift: member.overtimeAfterHours || member.dailyHours,
          overtimeMultiplierAtShift: member.overtimeMultiplier || 1,
          ...(() => {
            const window = staffPayWindowForInstant(member, now);
            return window ? { payWindowStartAtShift: window.start, payWindowEndAtShift: window.end } : {};
          })(),
          note: "Xodim ilovasidan boshlandi",
          source: "worker",
          status: "open",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        };
        return { state: { ...state, workShifts: [shift, ...rawShifts] }, result: { unchanged: false } };
      }
      if (!openShift) {
        const recentClosed = shifts.find((shift) => (
          shift.staffId === member.id
          && shift.status === "closed"
          && shift.source === "worker"
          && now.getTime() - Date.parse(shift.clockOut) >= 0
          && now.getTime() - Date.parse(shift.clockOut) <= 5 * 60_000
        ));
        if (recentClosed) return { state, result: { unchanged: true } };
        throw new AttendanceError("Ochiq smena topilmadi. Avval “ISHNI BOSHLADIM” tugmasini bosing.");
      }
      if (isAccountingMonthClosed(state.monthlyCloses, openShift.date)) {
        throw new AttendanceError(`${openShift.date.slice(0, 7)} oyi yopilgan. Smenani rahbar tekshirishi kerak.`, 409);
      }
      const elapsedMinutes = Math.floor((now.getTime() - Date.parse(openShift.clockIn)) / 60_000);
      if (elapsedMinutes <= 0) throw new AttendanceError("Ish vaqti hali boshlanmagan.");
      if (elapsedMinutes > 18 * 60) throw new AttendanceError("Smena 18 soatdan oshgan. Rahbar vaqtni to‘g‘rilashi kerak.");
      const overlappingClosedShift = shifts.find((shift) => (
        shift.id !== openShift.id
        && shift.staffId === member.id
        && shift.status === "closed"
        && Date.parse(openShift.clockIn) < Date.parse(shift.clockOut)
        && now.getTime() > Date.parse(shift.clockIn)
      ));
      if (overlappingClosedShift) {
        throw new AttendanceError("Bu vaqt ichida boshqa smena bor. Rahbar ish vaqtini to‘g‘rilashi kerak.");
      }
      const closed: WorkShift = {
        ...openShift,
        clockOut: now.toISOString(),
        status: "closed",
        updatedAt: now.toISOString(),
      };
      return {
        state: {
          ...state,
          workShifts: rawShifts.map((shift) => (
            shift && typeof shift === "object" && String((shift as Record<string, unknown>).id || "") === openShift.id
              ? closed
              : shift
          )),
        },
        result: { unchanged: false },
      };
    }, 5, session.branchId, session.name, action === "clock-in" ? "Ishni boshladi" : "Ishni tugatdi", "Davomat");
    if (located && !mutation.result.unchanged) {
      await logAttendanceAttempt(placeDb()!, session.branchId, { staffName: session.name, action, ok: true, distance: located.distance, accuracy: located.accuracy, reason: "" }, now.toISOString());
    }
    const current = await readHaloState(session.branchId);
    const attendance = ownAttendance(current.state, session.userId, month, now);
    const telegramRules = action === "clock-in" && !mutation.result.unchanged && attendance.linked && attendance.openShift
      ? await maybeSendWorkerKitchenRules({
          workerId: session.userId,
          branchId: session.branchId,
          workerName: attendance.member.name,
          shiftId: attendance.openShift.id,
          rules: current.state.kitchenRules,
          reminderHours: current.state.kitchenRuleReminderHours,
          force: true,
          now,
        }).catch(() => ({ sent: false }))
      : { sent: false };
    return Response.json({
      ok: true,
      updatedAt: mutation.updatedAt,
      ...mutation.result,
      ...attendance,
      place: placeView(place),
      telegramRules,
    });
  } catch (error) {
    if (error instanceof AttendanceError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Davomat saqlanmadi. Qayta urinib ko‘ring." }, { status: 500 });
  }
}
