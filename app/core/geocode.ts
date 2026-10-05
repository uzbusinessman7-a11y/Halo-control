/**
 * HALO V2 — manzil → koordinata (Kakao Local API). «Keldim / ketdim joyi»ni manzil yoki joy nomi bo'yicha topish uchun.
 *
 * Kalit (Kakao REST API kaliti) rahbar tomonidan sahifada bir marta kiritiladi va bazada saqlanadi (Telegram bot
 * tokenlari kabi). Javoblarda HECH QACHON qaytarilmaydi — faqat "kiritilgan / kiritilmagan". Repo'da kalit yo'q.
 * Qidiruv hech narsa saqlamaydi: natija rahbarga ko'rsatiladi, tanlagan nuqtasini o'zi tasdiqlab saqlaydi.
 */
import type { D1Like } from "../lib/full-migration";

type Row = Record<string, unknown>;
export class GeocodeError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "") { super(message); }
}
export interface GeoResult { label: string; address: string; lat: number; lng: number }

const SCHEMA = "CREATE TABLE IF NOT EXISTS v2_geocode (id TEXT PRIMARY KEY NOT NULL, kakao_key TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)";
const schemaReady = new WeakSet<object>();
async function ensureSchema(db: D1Like) {
  if (schemaReady.has(db)) return;
  await db.prepare(SCHEMA).run();
  schemaReady.add(db);
}
async function readKey(db: D1Like): Promise<{ key: string; savedAt: string }> {
  await ensureSchema(db);
  const row = await db.prepare("SELECT kakao_key, updated_at FROM v2_geocode WHERE id = 'main'").first<{ kakao_key: string; updated_at: string }>();
  return { key: String(row?.kakao_key || ""), savedAt: row?.kakao_key ? String(row.updated_at || "") : "" };
}

/** Sahifa uchun holat — kalitning o'zi qaytarilmaydi. */
export async function geocodeStatus(db: D1Like): Promise<{ hasKey: boolean; savedAt: string }> {
  const { key, savedAt } = await readKey(db);
  return { hasKey: Boolean(key), savedAt };
}

async function kakao(key: string, kind: "address" | "keyword", query: string): Promise<Row[]> {
  let response: Response;
  try {
    response = await fetch(`https://dapi.kakao.com/v2/local/search/${kind}.json?size=5&query=${encodeURIComponent(query)}`, {
      headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new GeocodeError("Kakao bilan bog‘lanib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.", 502, "NETWORK");
  }
  if (response.ok) {
    const body = await response.json().catch(() => null) as { documents?: unknown } | null;
    return Array.isArray(body?.documents) ? body.documents.filter((doc): doc is Row => Boolean(doc) && typeof doc === "object") : [];
  }
  const detail = String(((await response.json().catch(() => null)) as { message?: unknown } | null)?.message || "").slice(0, 160);
  if (response.status === 401) throw new GeocodeError("Kakao kalitni qabul qilmadi. «REST API 키» to‘g‘ri nusxalanganini tekshiring.", 400, "BAD_KEY");
  if (response.status === 403 && /OPEN_MAP_AND_LOCAL/i.test(detail)) {
    throw new GeocodeError("Bu Kakao ilovasida xarita xizmati yoqilmagan. Kakao Developers → ilovangiz → 카카오맵 → 사용 설정: ON qiling, keyin qayta urinib ko‘ring.", 400, "MAP_DISABLED");
  }
  if (response.status === 403 && /ip/i.test(detail)) {
    throw new GeocodeError("Kakao ilovasida «허용 IP» cheklovi bor — shu sababli sayt so‘rovi rad etildi. Kakao Developers → ilova → 앱 키 → IP cheklovini olib tashlang.", 400, "IP_BLOCKED");
  }
  if (response.status === 429) throw new GeocodeError("Kakao bugungi so‘rovlar chegarasiga yetdi. Ertaga qayta urinib ko‘ring yoki «Hozir turgan joyim» tugmasidan foydalaning.", 429, "QUOTA");
  throw new GeocodeError(`Kakao javob bermadi (HTTP ${response.status})${detail ? `: ${detail}` : ""}.`, 502, "KAKAO");
}

const text = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
function toResult(doc: Row, kind: "address" | "keyword"): GeoResult | null {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  if (kind === "keyword") {
    const address = text(doc.road_address_name, 160) || text(doc.address_name, 160);
    return { label: text(doc.place_name, 120) || address, address, lat, lng };
  }
  const road = doc.road_address && typeof doc.road_address === "object" ? doc.road_address as Row : null;
  const address = text(road?.address_name, 160) || text(doc.address_name, 160);
  const building = text(road?.building_name, 80);
  return { label: building ? `${address} (${building})` : address, address: text(doc.address_name, 160), lat, lng };
}

/** Kalitni tekshirib saqlaydi: Kakao qabul qilmagan kalit saqlanmaydi. */
export async function saveKakaoKey(db: D1Like, input: unknown, now = new Date().toISOString()) {
  const key = String(input ?? "").trim().replace(/^KakaoAK\s+/i, "");
  if (!/^[A-Za-z0-9]{20,80}$/.test(key)) throw new GeocodeError("Kalitni tekshiring: Kakao Developers → ilova → 앱 키 → «REST API 키» (harf va raqamlardan iborat uzun qator).");
  await kakao(key, "address", "서울특별시 중구 세종대로 110");
  await ensureSchema(db);
  await db.prepare("INSERT INTO v2_geocode (id, kakao_key, updated_at) VALUES ('main', ?, ?) ON CONFLICT(id) DO UPDATE SET kakao_key = excluded.kakao_key, updated_at = excluded.updated_at").bind(key, now).run();
  return geocodeStatus(db);
}
export async function removeKakaoKey(db: D1Like, now = new Date().toISOString()) {
  await ensureSchema(db);
  await db.prepare("UPDATE v2_geocode SET kakao_key = '', updated_at = ? WHERE id = 'main'").bind(now).run();
  return geocodeStatus(db);
}

/** Manzil yoki joy nomi bo'yicha qidiradi: avval aniq manzillar, keyin joy nomlari. Hech narsa saqlamaydi. */
export async function searchPlace(db: D1Like, input: unknown): Promise<GeoResult[]> {
  const query = text(input, 120);
  if (query.length < 2) throw new GeocodeError("Manzil yoki joy nomini yozing.");
  const { key } = await readKey(db);
  if (!key) throw new GeocodeError("Avval Kakao kalitini kiriting.", 400, "NO_KEY");
  const [addresses, places] = await Promise.all([kakao(key, "address", query), kakao(key, "keyword", query)]);
  const seen = new Set<string>();
  const results: GeoResult[] = [];
  for (const result of [...addresses.map((doc) => toResult(doc, "address")), ...places.map((doc) => toResult(doc, "keyword"))]) {
    if (!result) continue;
    const spot = `${result.lat.toFixed(5)},${result.lng.toFixed(5)}`;
    if (seen.has(spot)) continue;
    seen.add(spot);
    results.push(result);
    if (results.length >= 6) break;
  }
  return results;
}
