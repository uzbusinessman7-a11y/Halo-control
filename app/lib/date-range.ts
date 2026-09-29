export type DateRangePreset = "today" | "7d" | "30d" | "month" | "custom" | "all";

export type DateRange = {
  start: string;
  end: string;
  preset: DateRangePreset;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function dateKey(value: unknown) {
  const raw = String(value || "").trim();
  const candidate = raw.slice(0, 10);
  return DATE_KEY.test(candidate) ? candidate : "";
}

function shiftDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

export function dateRangeForPreset(referenceDate: string, preset: DateRangePreset): DateRange {
  const reference = dateKey(referenceDate) || new Date().toISOString().slice(0, 10);
  if (preset === "all") return { start: "", end: "", preset };
  if (preset === "today") return { start: reference, end: reference, preset };
  if (preset === "7d") return { start: shiftDate(reference, -6), end: reference, preset };
  if (preset === "30d") return { start: shiftDate(reference, -29), end: reference, preset };
  if (preset === "month") return { start: `${reference.slice(0, 7)}-01`, end: reference, preset };
  return { start: reference, end: reference, preset: "custom" };
}

export function normalizeDateRange(range: Partial<DateRange>, referenceDate: string): DateRange {
  if (range.preset === "all") return { start: "", end: "", preset: "all" };
  const fallback = dateRangeForPreset(referenceDate, "month");
  let start = dateKey(range.start) || fallback.start;
  let end = dateKey(range.end) || fallback.end;
  if (start > end) [start, end] = [end, start];
  return {
    start,
    end,
    preset: range.preset === "today" || range.preset === "7d" || range.preset === "30d"
      || range.preset === "month" || range.preset === "custom" || range.preset === "all"
      ? range.preset
      : "custom",
  };
}

export function dateIsInRange(value: unknown, range: Pick<DateRange, "start" | "end">) {
  const key = dateKey(value);
  if (!key) return false;
  return (!range.start || key >= range.start) && (!range.end || key <= range.end);
}

export function filterDateRange<T>(records: readonly T[], range: Pick<DateRange, "start" | "end">, getDate: (record: T) => unknown) {
  return records.filter((record) => dateIsInRange(getDate(record), range));
}

export function dateRangeLabel(range: Pick<DateRange, "start" | "end">) {
  if (!range.start && !range.end) return "Barcha sanalar";
  if (range.start === range.end) return range.start;
  return `${range.start || "…"} — ${range.end || "…"}`;
}
