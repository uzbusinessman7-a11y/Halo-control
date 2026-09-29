import { normalizeDeletedItems } from "../../lib/deleted-items";
import {
  mezanaDebtBalance,
  mezanaDebtActionLabel,
  mezanaDebtEntryValue,
  mezanaBorrowedQuantityBalance,
  mezanaTelegramDestination,
  normalizeMezanaDebtEntries,
  normalizeMezanaDebtEntry,
  normalizeMezanaSettings,
  type MezanaDebtEntry,
} from "../../lib/mezana-debts";
import { readHaloState } from "../../lib/halo-store";
import { isAdminRequest } from "../../lib/integration-store";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

type MezanaChangeEvent = "edited" | "deleted";

const cleanText = (value: unknown, max: number) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
const won = (value: number) => `₩${Math.round(value || 0).toLocaleString("en-US")}`;
const actionLabel = (entry: MezanaDebtEntry) => mezanaDebtActionLabel(entry.action);
const entryValue = mezanaDebtEntryValue;
const displayDate = (value: string) => {
  const [year = "", month = "", day = ""] = value.split("-");
  return `${day}.${month}.${year}`;
};

async function telegramBotToken() {
  try {
    const row = await globalThis.__HALO_CONTROL_DB__?.prepare(
      "SELECT bot_token FROM telegram_settings WHERE id = 'main'",
    ).first<{ bot_token: string }>();
    return row?.bot_token || "";
  } catch {
    return "";
  }
}

async function telegramFetch(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendMezanaChange(chatId: string, threadId: number, text: string) {
  if (!chatId) return { sent: false, reason: "MEZANA Telegram guruhi alohida ulanmagan." };
  const token = await telegramBotToken();
  if (!token) return { sent: false, reason: "HALO Telegram boti ulanmagan." };
  try {
    const response = await telegramFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(threadId > 0 ? { message_thread_id: threadId } : {}),
      }),
    });
    const result = await response.json() as { ok?: boolean; description?: string };
    return response.ok && result.ok
      ? { sent: true, reason: "" }
      : { sent: false, reason: result.description || "Telegramga yuborilmadi." };
  } catch {
    return { sent: false, reason: "Telegramga yuborilmadi." };
  }
}

async function sendMezanaChangeToActions(
  settings: ReturnType<typeof normalizeMezanaSettings>,
  actions: MezanaDebtEntry["action"][],
  text: string,
) {
  const destinations = actions
    .map((action) => mezanaTelegramDestination(settings, action))
    .filter((destination, index, list) => list.findIndex((candidate) => (
      candidate.chatId === destination.chatId && candidate.threadId === destination.threadId
    )) === index);
  const results = await Promise.all(destinations.map((destination) => (
    sendMezanaChange(destination.chatId, destination.threadId, text)
  )));
  return {
    sent: results.length > 0 && results.every((result) => result.sent),
    reason: results.filter((result) => !result.sent).map((result) => result.reason).filter(Boolean).join(" "),
  };
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  try {
    const body = await request.json() as {
      branchId?: string;
      event?: MezanaChangeEvent;
      entryId?: string;
      before?: unknown;
    };
    const branchId = cleanText(body.branchId || "main", 80);
    const event = cleanText(body.event, 20) as MezanaChangeEvent;
    const entryId = cleanText(body.entryId, 100);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)
      || !["edited", "deleted"].includes(event)
      || !entryId.startsWith("mezana:")) {
      return Response.json({ error: "MEZANA o‘zgarishi noto‘g‘ri." }, { status: 400 });
    }

    const current = await readHaloState(branchId);
    const entries = normalizeMezanaDebtEntries(current.state.mezanaEntries);
    const balance = Math.max(0, mezanaDebtBalance(entries));
    const settings = normalizeMezanaSettings(current.state.mezanaSettings);
    let message = "";
    let targetActions: MezanaDebtEntry["action"][] = ["borrowed"];

    if (event === "edited") {
      const edited = entries.find((entry) => entry.id === entryId);
      const before = normalizeMezanaDebtEntry(body.before);
      if (!edited || !before || before.id !== edited.id) {
        return Response.json({ error: "Tahrirlangan MEZANA yozuvi topilmadi." }, { status: 404 });
      }
      targetActions = before.action === edited.action ? [edited.action] : [before.action, edited.action];
      message = [
        "✏️ MEZANA YOZUVI TAHRIRLANDI",
        `👤 O‘zgartirgan: Rahbar`,
        "",
        `OLDIN: ${actionLabel(before)} · ${before.productName} · ${entryValue(before)} · ${displayDate(before.date)}`,
        `HOZIR: ${actionLabel(edited)} · ${edited.productName} · ${entryValue(edited)} · ${displayDate(edited.date)}`,
        edited.note ? `📝 ${edited.note}` : "",
        "",
        before.action !== edited.action
          ? "↔️ Yozuv boshqa MEZANA hisobiga ko‘chirildi."
          : edited.action === "purchased" || edited.action === "paid"
            ? `💳 MEZANA qolgan qarzi: ${won(balance)}`
            : `📊 Hozir olib turilgan: ${Math.max(0, mezanaBorrowedQuantityBalance(entries, edited.productName))} ta`,
      ].filter(Boolean).join("\n");
    } else {
      const deleted = normalizeDeletedItems(current.state.deletedItems)
        .find((item) => item.kind === "mezanaEntry" && item.entityId === entryId && !item.restoredAt);
      const normalizedDeleted = deleted ? normalizeMezanaDebtEntry(deleted.record) : null;
      if (!deleted || !normalizedDeleted) {
        return Response.json({ error: "O‘chirilgan MEZANA yozuvi topilmadi." }, { status: 404 });
      }
      const entry = normalizedDeleted;
      targetActions = [entry.action];
      message = [
        "🗑 MEZANA YOZUVI O‘CHIRILDI",
        `👤 O‘chirgan: Rahbar`,
        `📦 ${actionLabel(entry)} · ${entry.productName}`,
        entry.quantity ? `🔢 Soni: ${entry.quantity}` : `💵 Summa: ${won(entry.amount)}`,
        `📅 ${displayDate(entry.date)}`,
        deleted.reason ? `⚠️ Sabab: ${deleted.reason}` : "",
        "",
        entry.action === "purchased" || entry.action === "paid"
          ? `💳 MEZANA qolgan qarzi: ${won(balance)}`
          : `📊 Hozir olib turilgan: ${Math.max(0, mezanaBorrowedQuantityBalance(entries, entry.productName))} ta`,
      ].filter(Boolean).join("\n");
    }

    const telegram = await sendMezanaChangeToActions(settings, targetActions, message);
    return Response.json({ ok: true, telegram });
  } catch {
    return Response.json({ error: "MEZANA o‘zgarishini Telegramga yuborib bo‘lmadi." }, { status: 500 });
  }
}
