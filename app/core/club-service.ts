/**
 * HALO CLUB ulanishi — bazaga yozadigan qism: hodisani qabul qilish, savdoni filial holatiga yozish,
 * guruhga xabar. Hisob-kitob qoidalari app/core/club.ts da (sof funksiyalar).
 */
import { HaloStateConflictError, mutateHaloState, readHaloState } from "../lib/halo-store";
import { readSettings as readTelegramSettings, telegramCall } from "../lib/telegram-service";
import { seoulBusinessDate } from "../lib/business-time";
import type { D1Like } from "../lib/full-migration";
import { assertV2DayOpen, ClosedDayError } from "./closed-days";
import {
  applyClubOrder, cancelClubSale, claimClubNotice, CLUB_ACTOR, ClubError, clubOrderMessage, clubPosOrderId, clubSalePlan, finishClubNotice, linkMap,
  listClubProducts, listWaitingClubOrders, normalizeClubOrder, PosTerminalError, readClubOrder, readClubSettings, recordClubOrder, setClubSaleState,
  type ClubOrderRow,
} from "./club";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
}
type Row = Record<string, unknown>;
export const clubDb = (): D1Like => {
  if (!globalThis.__HALO_CONTROL_DB__) throw new ClubError("Baza ulanmagan.", 500);
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
};
const money = (value: number) => `₩${Math.round(value).toLocaleString("en-US")}`;

export interface ClubSaleOutcome { state: string; note: string; date: string; alreadySaved: boolean }

/**
 * Topshirilgan buyurtmani savdoga yozadi. `force` — rahbar "Qayta yozish"ni bosgan (savdo yozuvi yo'q bo'lsa qayta yozadi);
 * `useToday` — yopilgan kun o'rniga bugungi sana bilan yozish (faqat rahbar tanlasa).
 */
export async function writeClubSale(branchId: string, orderId: string, options: { force?: boolean; useToday?: boolean } = {}): Promise<ClubSaleOutcome> {
  const db = clubDb();
  const row = await readClubOrder(db, branchId, orderId);
  if (!row || !row.order) throw new ClubError("Buyurtma topilmadi.", 404);
  const done = (state: string, note: string, date = ""): ClubSaleOutcome => ({ state, note, date, alreadySaved: false });
  if (row.status !== "completed") return done(row.saleState, "Buyurtma hali topshirilmagan.");
  if (row.saleState === "cancelled") return done("cancelled", row.saleNote, row.saleDate);
  if (row.saleState === "skipped" && !options.force) return done("skipped", row.saleNote, row.saleDate);
  if (row.saleState === "saved" && !options.force) return { state: "saved", note: row.saleNote, date: row.saleDate, alreadySaved: true };
  const order = row.order;
  const save = async (state: string, note: string, date = "") => { await setClubSaleState(db, branchId, orderId, state, note, date); return done(state, note, date); };
  const settings = await readClubSettings(db, branchId);
  if (!settings.salesEnabled) return save("waiting", "Savdoga yozish o‘chirilgan. Yoqilgach «Kutayotganlarni yozish»ni bosing.");
  const links = linkMap(await listClubProducts(db, branchId));
  const plan = clubSalePlan(order, links);
  if (plan.skip) return save("skipped", plan.skip);
  if (plan.wait) return save("waiting", plan.wait);
  const createdAt = new Date().toISOString();
  const completedDate = seoulBusinessDate(new Date(order.completedAt || createdAt));
  const date = options.useToday ? seoulBusinessDate(new Date(createdAt)) : completedDate;
  try {
    await assertV2DayOpen(branchId, date);
  } catch (error) {
    if (error instanceof ClosedDayError) return save("waiting", `${date} kuni kassada yopilgan. «Bugungi sana bilan yozish»ni tanlang.`, date);
    throw error;
  }
  try {
    const mutation = await mutateHaloState((state) => applyClubOrder(state as Row, order, links, createdAt, options.useToday ? date : ""), 5, branchId, CLUB_ACTOR.name,
      `Telegram buyurtma #${order.number}: ${money(plan.foodRevenue)} savdo`, "Telegram do‘kon");
    const result = mutation.result;
    const account = plan.paymentType === "bank" ? "Hisob-raqam" : "Naqd kassa";
    const note = [`${account} · ${money(result.revenue)}`,
      result.courier ? `kuryer puli ${money(result.courier)}` : "",
      result.courierShortfall ? `cashback yetkazish haqining ${money(result.courierShortfall)} qismini qopladi` : "",
      options.useToday && date !== completedDate ? `asl sana ${completedDate}` : ""].filter(Boolean).join(" · ");
    await setClubSaleState(db, branchId, orderId, "saved", note, result.date);
    return { state: "saved", note, date: result.date, alreadySaved: result.alreadySaved };
  } catch (error) {
    if (error instanceof PosTerminalError) return save("waiting", error.message, date);
    if (error instanceof HaloStateConflictError) throw new ClubError("HALO Control band. Birozdan keyin qayta yuboriladi.", 503);
    throw error;
  }
}

/** Kutayotgan hamma buyurtmani yozib chiqadi (rahbar bog'lashni tugatgach yoki yozishni yoqqach). */
export async function writeWaitingClubSales(branchId: string): Promise<{ saved: number; waiting: number; skipped: number }> {
  const out = { saved: 0, waiting: 0, skipped: 0 };
  for (const row of await listWaitingClubOrders(clubDb(), branchId)) {
    const outcome = await writeClubSale(branchId, row.orderId);
    if (outcome.state === "saved") out.saved += 1; else if (outcome.state === "skipped") out.skipped += 1; else out.waiting += 1;
  }
  return out;
}

/** Rahbar: yozilgan Telegram savdosini bekor qilish (ombor qaytadi, kuryer puli kirimi olib tashlanadi). */
export async function cancelClubOrderSale(branchId: string, orderId: string): Promise<void> {
  const db = clubDb();
  const row = await readClubOrder(db, branchId, orderId);
  if (!row) throw new ClubError("Buyurtma topilmadi.", 404);
  const { state } = await readHaloState(branchId);
  const exists = (Array.isArray((state as Row).posOrders) ? (state as Row).posOrders as Row[] : []).some((entry) => entry.id === clubPosOrderId(orderId));
  if (exists) {
    const date = row.saleDate || seoulBusinessDate();
    await assertV2DayOpen(branchId, date);
    await mutateHaloState((current) => ({ state: cancelClubSale(current as Row, orderId), result: null }), 5, branchId, "Rahbar",
      `Telegram buyurtma #${row.number} savdosi bekor qilindi`, "Telegram do‘kon");
  }
  await setClubSaleState(db, branchId, orderId, "cancelled", "Rahbar bekor qildi.", row.saleDate);
}

/** Guruhga xabar (bir buyurtma — bir marta). Yuborilmasa sababi saqlanadi, buyurtmaning o'ziga ta'sir qilmaydi. */
export async function notifyClubOrder(branchId: string, row: ClubOrderRow, kind: "new" | "cancel"): Promise<{ sent: boolean; reason: string }> {
  if (!row.order) return { sent: false, reason: "Buyurtma o‘qilmadi." };
  const db = clubDb();
  const settings = await readClubSettings(db, branchId);
  if (!settings.notifyEnabled || !settings.groupChatId) return { sent: false, reason: "Buyurtmalar guruhi ulanmagan." };
  const token = (await readTelegramSettings()).botToken;
  if (!token) return { sent: false, reason: "HALO Telegram boti ulanmagan." };
  if (!await claimClubNotice(db, branchId, row.orderId, kind)) return { sent: true, reason: "" };
  try {
    await telegramCall(token, "sendMessage", {
      chat_id: settings.groupChatId, ...(settings.groupThreadId > 0 ? { message_thread_id: settings.groupThreadId } : {}),
      text: clubOrderMessage(row.order, kind),
    });
    await finishClubNotice(db, branchId, row.orderId, kind, "");
    return { sent: true, reason: "" };
  } catch (error) {
    const reason = error instanceof Error && error.name !== "TimeoutError" ? error.message : "Telegram javobi kechikdi.";
    await finishClubNotice(db, branchId, row.orderId, kind, reason);
    return { sent: false, reason };
  }
}

/** Do'kondan kelgan hodisa: buyurtma yoziladi, kerak bo'lsa guruhga xabar boradi, topshirilgan bo'lsa savdoga yoziladi. */
export async function handleClubOrderEvent(branchId: string, body: unknown) {
  const source = body && typeof body === "object" ? body as Row : {};
  const order = normalizeClubOrder(source.order);
  const row = await recordClubOrder(clubDb(), branchId, order);
  let notice = { sent: false, reason: "" };
  if (order.status === "new" && row.status === "new") notice = await notifyClubOrder(branchId, row, "new");
  if (order.status === "cancelled" && row.status === "cancelled" && row.notifiedNew) notice = await notifyClubOrder(branchId, row, "cancel");
  let sale: ClubSaleOutcome = { state: row.saleState, note: row.saleNote, date: row.saleDate, alreadySaved: false };
  if (order.status === "completed" && row.status === "completed") sale = await writeClubSale(branchId, order.id);
  return { order: { id: row.orderId, number: row.number, status: row.status }, sale, notified: notice.sent, noticeReason: notice.reason };
}
