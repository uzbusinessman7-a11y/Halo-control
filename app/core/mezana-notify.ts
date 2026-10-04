/**
 * MEZANA yozuvini Telegram guruhga yuborish (matn ko'rinishida) — server ichidan chaqiriladigan joylar uchun
 * (masalan, Telegram yordamchi boti orqali kiritilgan yozuv). Qoidalar rahbar va xodim sahifalaridagi bilan bir xil:
 *  - bir yozuv guruhga bir marta boradi (mezana_telegram_deliveries belgisi);
 *  - guruh: olib turildi/qaytarildi — bitta, sotib olindi/to'lov — boshqa yo'nalish (Ulanishlar → MEZANA guruhi);
 *  - xabarni hisobot boti yuboradi. Yuborilmasa sababi saqlanadi va keyin qayta yuborish mumkin.
 * Rasmli yozuvlar (xodim ilovasidan) o'z yo'lida yuboriladi; bu funksiya rasm biriktirmaydi.
 */
import { readHaloState } from "../lib/halo-store";
import {
  buildMezanaDebtTelegramMessage, mezanaBorrowedQuantityBalance, mezanaDebtBalance, mezanaTelegramDestination,
  normalizeMezanaDebtEntries, normalizeMezanaSettings,
} from "../lib/mezana-debts";
import { claimMezanaTelegramDelivery, finishMezanaTelegramDelivery } from "../lib/mezana-telegram-delivery";
import { readSettings } from "../lib/telegram-service";

export async function deliverMezanaEntry(branchId: string, entryId: string): Promise<{ sent: boolean; reason: string }> {
  const { state } = await readHaloState(branchId);
  const entries = normalizeMezanaDebtEntries(state.mezanaEntries);
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) return { sent: false, reason: "MEZANA yozuvi topilmadi." };
  const claim = await claimMezanaTelegramDelivery(branchId, entry.id);
  if (!claim.claimed) return { sent: claim.sent, reason: claim.reason };
  const destination = mezanaTelegramDestination(normalizeMezanaSettings(state.mezanaSettings), entry.action);
  let result = { sent: false, reason: "" };
  if (!destination.chatId) {
    result = { sent: false, reason: "MEZANA Telegram guruhi alohida ulanmagan." };
  } else {
    const token = (await readSettings()).botToken;
    if (!token) {
      result = { sent: false, reason: "HALO Telegram boti ulanmagan." };
    } else {
      try {
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: destination.chatId,
            ...(destination.threadId > 0 ? { message_thread_id: destination.threadId } : {}),
            text: buildMezanaDebtTelegramMessage({
              action: entry.action,
              date: entry.date,
              workerName: entry.createdByName,
              productName: entry.productName,
              amount: entry.amount,
              ...(entry.action === "purchased" || entry.action === "paid" ? {} : { quantity: entry.quantity }),
              currentBalance: Math.max(0, mezanaDebtBalance(entries)),
              currentBorrowedQuantity: Math.max(0, mezanaBorrowedQuantityBalance(entries, entry.productName)),
              note: entry.note,
            }),
          }),
          signal: AbortSignal.timeout(12_000),
        });
        const body = await response.json() as { ok?: boolean; description?: string };
        result = response.ok && body.ok ? { sent: true, reason: "" } : { sent: false, reason: body.description || "Telegramga yuborilmadi." };
      } catch {
        result = { sent: false, reason: "Telegramga yuborilmadi." };
      }
    }
  }
  await finishMezanaTelegramDelivery(branchId, entry.id, result);
  return result;
}
