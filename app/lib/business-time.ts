const SEOUL_TIME_ZONE = "Asia/Seoul";

// Building a formatter costs far more than using it, and these options never change:
// one instance serves every call (payroll alone asks for the Seoul date of each shift).
let seoulFormatter: Intl.DateTimeFormat | undefined;

function parts(date = new Date()) {
  seoulFormatter ||= new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = seoulFormatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => (
    values.find((entry) => entry.type === type)?.value || ""
  );
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    time: `${value("hour")}:${value("minute")}`,
  };
}

export function seoulCalendarDate(date = new Date()) {
  return parts(date).date;
}

export function previousSeoulDate(value: string) {
  const date = new Date(`${value}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() - 1);
  return seoulCalendarDate(date);
}

export function seoulBusinessDate(date = new Date()) {
  return seoulCalendarDate(date);
}

export function posBusinessDate(value: unknown) {
  const source = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return source;
  if (source) {
    const parsed = new Date(source);
    if (!Number.isNaN(parsed.getTime())) return seoulBusinessDate(parsed);
  }
  return seoulBusinessDate();
}

// Opening/closing control follows HALO's 12:00–00:00 operating shift. Keep it
// separate from accounting: every financial and stock record rolls over at
// 00:00, while a closing checklist completed after midnight still belongs to
// the shift that started on the previous calendar day.
export function seoulOperationDate(date = new Date()) {
  const current = parts(date);
  return current.hour < 12 ? previousSeoulDate(current.date) : current.date;
}

export function seoulClock(date = new Date()) {
  return parts(date).time;
}

export function seoulDateTimeLocal(date = new Date()) {
  const current = parts(date);
  return `${current.date}T${current.time}`;
}

export function seoulLocalDateTimeToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return "";
  const parsed = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(parsed.getTime()) || seoulDateTimeLocal(parsed) !== value) return "";
  return parsed.toISOString();
}
