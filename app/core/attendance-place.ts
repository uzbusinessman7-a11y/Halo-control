/**
 * HALO V2 — davomat joyi: xodim «ISHNI BOSHLADIM / TUGATDIM»ni faqat oshxona yaqinida bosa oladi.
 *
 * Rahbar har filial uchun nuqta (kenglik, uzunlik) va masofani (odatda 100 m) belgilaydi. Xodim tugmani bosganda
 * telefoni joylashuvni yuboradi; server masofani hisoblaydi. Uzoqda bo'lsa yoki joylashuv berilmasa — yozilmaydi.
 *
 * Maxfiylik: xodimning koordinatasi SAQLANMAYDI — jurnalga faqat necha metr uzoqda bo'lgani va GPS aniqligi yoziladi.
 * Cheklov: telefon yuborgan joylashuvga ishoniladi (soxta GPS ilovasidan to'liq himoya emas) — shu sabab har urinish
 * jurnalda ko'rinadi. Sozlama va jurnal alohida jadvallarda — eski saytdan ma'lumot ko'chirilganda tegilmaydi.
 */
import type { D1Like } from "../lib/full-migration";

type Row = Record<string, unknown>;
export const DEFAULT_RADIUS_M = 100;
export const MIN_RADIUS_M = 30;
export const MAX_RADIUS_M = 1000;
/** GPS aniqligi bundan yomon bo'lsa (metr), joylashuv qabul qilinmaydi — qayta urinish so'raladi. */
export const MAX_ACCURACY_M = 100;
const LOG_KEEP = 300;

export class PlaceError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "", readonly details: Record<string, number> = {}) { super(message); }
}

export interface AttendancePlace {
  /** Cheklov yoqilganmi (nuqta belgilanmagan bo'lsa yoqib bo'lmaydi). */
  enabled: boolean;
  hasPoint: boolean; lat: number; lng: number; radius: number; setAt: string;
}
const OFF: AttendancePlace = { enabled: false, hasPoint: false, lat: 0, lng: 0, radius: DEFAULT_RADIUS_M, setAt: "" };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS v2_attendance_place (
    branch_id TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL,
    radius_m INTEGER NOT NULL DEFAULT 100, set_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS v2_attendance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id TEXT NOT NULL, staff_name TEXT NOT NULL, action TEXT NOT NULL,
    ok INTEGER NOT NULL, distance_m INTEGER, accuracy_m INTEGER, reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS v2_attendance_log_recent ON v2_attendance_log (branch_id, id)",
];
const schemaReady = new WeakSet<object>();
async function ensureSchema(db: D1Like) {
  if (schemaReady.has(db)) return;
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  schemaReady.add(db);
}

type PlaceRow = { enabled: number; lat: number | null; lng: number | null; radius_m: number; set_at: string };
export async function readAttendancePlace(db: D1Like, branchId: string): Promise<AttendancePlace> {
  await ensureSchema(db);
  const row = await db.prepare("SELECT enabled, lat, lng, radius_m, set_at FROM v2_attendance_place WHERE branch_id = ?").bind(branchId).first<PlaceRow>();
  if (!row) return { ...OFF };
  const hasPoint = validPoint(row.lat, row.lng);
  return {
    enabled: Boolean(row.enabled) && hasPoint, hasPoint, lat: hasPoint ? Number(row.lat) : 0, lng: hasPoint ? Number(row.lng) : 0,
    radius: clampRadius(row.radius_m), setAt: row.set_at || "",
  };
}

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
function validPoint(lat: unknown, lng: unknown) {
  return finite(lat) && finite(lng) && Math.abs(lat as number) <= 90 && Math.abs(lng as number) <= 180 && !((lat as number) === 0 && (lng as number) === 0);
}
const clampRadius = (value: unknown) => {
  const radius = Math.round(Number(value));
  return Number.isFinite(radius) ? Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, radius)) : DEFAULT_RADIUS_M;
};

/** Rahbar nuqtani, masofani va yoqilgan/o'chirilganini saqlaydi. */
export async function saveAttendancePlace(db: D1Like, branchId: string, input: Row, now = new Date().toISOString()): Promise<AttendancePlace> {
  await ensureSchema(db);
  const current = await readAttendancePlace(db, branchId);
  const given = input.lat !== undefined || input.lng !== undefined;
  const lat = given ? Number(input.lat) : current.lat;
  const lng = given ? Number(input.lng) : current.lng;
  if (given && !validPoint(lat, lng)) throw new PlaceError("Koordinatani tekshiring: kenglik va uzunlik, masalan 37.456300, 126.705200.");
  const hasPoint = given ? true : current.hasPoint;
  const rawRadius = input.radius === undefined || input.radius === "" ? current.radius : Number(input.radius);
  if (!Number.isFinite(rawRadius) || rawRadius < MIN_RADIUS_M || rawRadius > MAX_RADIUS_M) throw new PlaceError(`Masofa ${MIN_RADIUS_M} dan ${MAX_RADIUS_M} metrgacha bo‘lsin.`);
  const enabled = input.enabled === undefined ? current.enabled : input.enabled === true;
  if (enabled && !hasPoint) throw new PlaceError("Avval oshxona joyini belgilang — keyin yoqiladi.");
  const moved = given && (!current.hasPoint || lat !== current.lat || lng !== current.lng);
  await db.prepare(
    `INSERT INTO v2_attendance_place (branch_id, enabled, lat, lng, radius_m, set_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(branch_id) DO UPDATE SET enabled = excluded.enabled, lat = excluded.lat, lng = excluded.lng, radius_m = excluded.radius_m, set_at = excluded.set_at, updated_at = excluded.updated_at`,
  ).bind(branchId, enabled ? 1 : 0, hasPoint ? lat : null, hasPoint ? lng : null, Math.round(rawRadius), moved ? now : current.setAt, now).run();
  return readAttendancePlace(db, branchId);
}

/** Ikki nuqta orasidagi masofa, metr (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Xodim yuborgan joylashuvni tekshiradi. Cheklov o'chiq bo'lsa null qaytaradi (tekshirilmaydi).
 * Ruxsat bo'lsa — masofa va aniqlik (metr); aks holda PlaceError (kod: LOCATION_REQUIRED / LOCATION_WEAK / TOO_FAR).
 */
export function checkAttendanceLocation(place: AttendancePlace, location: unknown): { distance: number; accuracy: number } | null {
  if (!place.enabled) return null;
  const source = location && typeof location === "object" ? location as Row : null;
  const lat = source ? Number(source.lat) : NaN;
  const lng = source ? Number(source.lng) : NaN;
  const accuracy = source ? Number(source.accuracy) : NaN;
  if (!source || !validPoint(lat, lng) || !Number.isFinite(accuracy) || accuracy < 0) {
    throw new PlaceError("Bu tugma faqat oshxonada ishlaydi. Telefonda joylashuvga (GPS) ruxsat bering va qayta bosing.", 400, "LOCATION_REQUIRED", { radius: place.radius });
  }
  const roundedAccuracy = Math.round(accuracy);
  if (accuracy > Math.max(MAX_ACCURACY_M, place.radius)) {
    throw new PlaceError(`Joylashuv aniq emas (±${roundedAccuracy} m). GPS’ni yoqing, bir oz kuting va qayta bosing.`, 400, "LOCATION_WEAK", { accuracy: roundedAccuracy, radius: place.radius });
  }
  const distance = Math.round(distanceMeters(place, { lat, lng }));
  if (distance > place.radius) {
    throw new PlaceError(`Siz oshxonadan ${distance.toLocaleString("en-US")} metr uzoqdasiz. Bu tugma faqat oshxonadan ${place.radius} metr ichida ishlaydi.`, 403, "TOO_FAR", { distance, accuracy: roundedAccuracy, radius: place.radius });
  }
  return { distance, accuracy: roundedAccuracy };
}

export interface AttendanceAttempt { staffName: string; action: string; ok: boolean; distance: number | null; accuracy: number | null; reason: string; at: string }

/** Urinishni jurnalga yozadi (koordinatasiz). Jurnal yozilmasa ham davomatning o'ziga ta'sir qilmaydi. */
export async function logAttendanceAttempt(db: D1Like, branchId: string, entry: Omit<AttendanceAttempt, "at">, now = new Date().toISOString()) {
  try {
    await ensureSchema(db);
    await db.batch([
      db.prepare("INSERT INTO v2_attendance_log (branch_id, staff_name, action, ok, distance_m, accuracy_m, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(branchId, String(entry.staffName || "").slice(0, 60), entry.action === "clock-out" ? "clock-out" : "clock-in", entry.ok ? 1 : 0, entry.distance, entry.accuracy, String(entry.reason || "").slice(0, 40), now),
      db.prepare(`DELETE FROM v2_attendance_log WHERE branch_id = ? AND id <= COALESCE((SELECT id FROM v2_attendance_log WHERE branch_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${LOG_KEEP}), 0)`).bind(branchId, branchId),
    ]);
  } catch {
    // Jurnal — yordamchi ma'lumot: xatosi xodimning davomatini to'xtatmasin.
  }
}

export async function listAttendanceAttempts(db: D1Like, branchId: string, limit = 30): Promise<AttendanceAttempt[]> {
  await ensureSchema(db);
  const result = await db.prepare("SELECT staff_name, action, ok, distance_m, accuracy_m, reason, at FROM v2_attendance_log WHERE branch_id = ? ORDER BY id DESC LIMIT ?")
    .bind(branchId, Math.min(100, Math.max(1, limit))).all<{ staff_name: string; action: string; ok: number; distance_m: number | null; accuracy_m: number | null; reason: string; at: string }>();
  return result.results.map((row) => ({ staffName: row.staff_name, action: row.action, ok: Boolean(row.ok), distance: row.distance_m, accuracy: row.accuracy_m, reason: row.reason, at: row.at }));
}
