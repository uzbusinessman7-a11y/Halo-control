/**
 * HALO V2 — qat'iy ish vaqti.
 *
 * Rahbar har bir xodimga ish boshlanish (ixtiyoriy: tugash) vaqtini belgilaydi. Xodim erta kelib «ISHNI BOSHLADIM»ni
 * bossa ham, haq belgilangan vaqtdan hisoblanadi. Kelgan va ketgan asl vaqt tarixda o'zgarmay qoladi.
 *
 * Qayerda saqlanadi: xodim yozuvidagi mavjud `scheduledStartTime` / `scheduledEndTime` maydonlarida (eski tizim
 * hisob-kitobi shularni biladi — yangi jadval ham, ikkinchi hisob ham yo'q). Tugmani bosgan paytda oyna smenaga
 * yozib qo'yiladi (`payWindowStartAtShift` / `payWindowEndAtShift`), shuning uchun:
 *  - keyin vaqtni o'zgartirish oldingi kunlarga ta'sir qilmaydi;
 *  - qoidadan oldingi va rahbar qo'lda kiritgan smenalarda oyna yo'q — ular to'liq hisoblanadi.
 *
 * Tugash vaqti yozilmagan bo'lsa, u «boshlanish + 18 soat» sifatida saqlanadi: smena 18 soatdan uzun bo'lmaydi,
 * demak oxiridan hech narsa kesilmaydi (eski tizim esa ikkala vaqtni ham talab qiladi).
 */
import { normalizeStaff, shiftRange, staffPayWindowForInstant, type StaffMember } from "../lib/payroll";

type Row = Record<string, unknown>;
export class WorkHoursError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OPEN_MINUTES = 18 * 60;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);

/** «Tugashi yozilmagan» belgisi: boshlanishdan 18 soat keyin. */
export function openEndFor(start: string): string {
  const [hour, minute] = start.split(":").map(Number);
  const total = (hour * 60 + minute + OPEN_MINUTES) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
export const isOpenEnd = (start: string, end: string) => Boolean(start && end && end === openEndFor(start));

/** Rahbar ko'radigan ko'rinish: boshlanish va (yozilgan bo'lsa) tugash. Qoida yo'q bo'lsa — ikkalasi ham bo'sh. */
export function workHoursOf(member: Pick<StaffMember, "scheduledStartTime" | "scheduledEndTime">) {
  const start = member.scheduledStartTime || "";
  return { start, end: start && !isOpenEnd(start, member.scheduledEndTime) ? member.scheduledEndTime : "" };
}

export function workHoursList(state: Row) {
  return normalizeStaff(state.staff).filter((member) => member.active)
    .map((member) => ({ id: member.id, name: member.name, ...workHoursOf(member), hasAccount: Boolean(member.workerId) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Bir nechta xodimning ish vaqtini birdaniga saqlaydi. Hammasi saqlanadi yoki hech biri: bitta qator xato bo'lsa,
 * kimniki ekanini aytadi. Smenalarga tegmaydi — yangi vaqt keyingi «ISHNI BOSHLADIM»dan ishlaydi.
 */
export function saveWorkHours(state: Row, body: Row) {
  const items = rows(body.items);
  if (!items.length) throw new WorkHoursError("Saqlaydigan narsa yo'q.");
  if (items.length > 300) throw new WorkHoursError("Ro'yxat juda uzun.");
  const known = new Map(normalizeStaff(state.staff).map((member) => [member.id, member]));
  const wanted = new Map<string, { start: string; end: string }>();
  for (const item of items) {
    const id = String(item.id ?? "").trim();
    const member = known.get(id);
    if (!member) throw new WorkHoursError("Xodim topilmadi. Sahifani yangilang.", 404);
    const start = String(item.start ?? "").trim();
    const end = String(item.end ?? "").trim();
    if (!start && !end) { wanted.set(id, { start: "", end: "" }); continue; }
    if (!start) throw new WorkHoursError(`${member.name}: avval ish boshlanish vaqtini yozing.`);
    if (!TIME.test(start) || (end && !TIME.test(end))) throw new WorkHoursError(`${member.name}: vaqtni 11:00 ko'rinishida yozing.`);
    if (end === start) throw new WorkHoursError(`${member.name}: boshlanish va tugash vaqti bir xil bo'lmaydi.`);
    const storedEnd = end || openEndFor(start);
    if (!shiftRange("2026-01-01", start, storedEnd)) throw new WorkHoursError(`${member.name}: ish vaqti 18 soatdan uzun bo'lmaydi.`);
    wanted.set(id, { start, end: storedEnd });
  }
  let changed = 0;
  const now = new Date().toISOString();
  const staff = rows(state.staff).map((row) => {
    const id = String(row.id ?? "").trim();
    const want = wanted.get(id);
    const current = known.get(id);
    if (!want || !current) return row;
    if (current.scheduledStartTime === want.start && current.scheduledEndTime === want.end) return row;
    changed += 1;
    return { ...row, scheduledStartTime: want.start, scheduledEndTime: want.end, updatedAt: now };
  });
  return { state: changed ? { ...state, staff } : state, result: { changed } };
}

/**
 * «ISHNI BOSHLADIM» bosilgan paytda smenaga yoziladigan hisob oynasi (yoki null — hech narsa kesilmaydi).
 * Tugash vaqti yozilmagan bo'lsa, faqat erta kelgan vaqt kesiladi: vaqtida yoki kech kelgan xodimga oyna yozilmaydi.
 */
export function clockInPayWindow(member: StaffMember, now: Date): { start: string; end: string } | null {
  const window = staffPayWindowForInstant(member, now);
  if (!window) return null;
  if (isOpenEnd(member.scheduledStartTime, member.scheduledEndTime) && now.getTime() >= Date.parse(window.start)) return null;
  return window;
}

/**
 * Smenadagi hisob oynasi ko'rinishi: haq qaysi vaqtdan (va qaysi vaqtgacha) yuradi.
 * `until` bo'sh — oxiridan cheklov yo'q (oyna to'liq 18 soat).
 */
export function shiftPayWindow(shift: Row | null | undefined): { from: string; until: string } | null {
  if (!shift) return null;
  const start = Date.parse(String(shift.payWindowStartAtShift || ""));
  const end = Date.parse(String(shift.payWindowEndAtShift || ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > OPEN_MINUTES * 60_000) return null;
  return { from: new Date(start).toISOString(), until: end - start === OPEN_MINUTES * 60_000 ? "" : new Date(end).toISOString() };
}
