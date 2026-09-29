import { isAdminRequest } from "../../lib/integration-store";
import { HaloStateConflictError } from "../../lib/halo-store";
import { dispatchBusinessTrendNotification } from "../../lib/business-trend-notifications";
import { dispatchScheduledDailyReport, scheduledDeliveryStatus } from "../../lib/telegram-scheduler";
import { readSettings, writeSettings, koreaClock, previousDate, readBranchStatus, readState, telegramCall, saveMezanaDestination, resendLatestMezanaEntry, sendSupplierOrders, sendReport, publicSettings, emptySettings, type TelegramSettings } from "../../lib/telegram-service";

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const branchId = new URL(request.url).searchParams.get("branch") || "main";
    const [settings, status] = await Promise.all([readSettings(), readBranchStatus(branchId)]);
    return Response.json({ ...publicSettings(settings, status), deliveryStatus: await scheduledDeliveryStatus(branchId) });
  } catch {
    return Response.json({ ...publicSettings(emptySettings), error: "Telegram sozlamalari ochilmadi." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const body = await request.json() as {
      action?: "discover" | "discover-mezana" | "save-mezana" | "mezana-resend-latest" | "save" | "test" | "send" | "orders" | "auto";
      botToken?: string;
      chatId?: string;
      enabled?: boolean;
      reportTime?: string;
      reportDate?: string;
      branchId?: string;
      mezanaDestination?: "borrowed" | "purchased";
    };
    const current = await readSettings();
    const branchId = String(body.branchId || "main").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)) {
      return Response.json({ error: "Noto‘g‘ri filial." }, { status: 400 });
    }
    const token = String(body.botToken || current.botToken || "").trim();

    if (body.action === "discover") {
      if (!token) return Response.json({ error: "Bot tokenini kiriting." }, { status: 400 });
      const updates = await telegramCall<Array<{
        message?: { chat?: { id?: number; first_name?: string; username?: string; title?: string } };
      }>>(token, "getUpdates");
      const chat = [...(updates || [])].reverse().find((update) => update.message?.chat?.id)?.message?.chat;
      if (!chat?.id) {
        return Response.json({ error: "Botga avval “Salom” deb yozing, keyin yana bosing." }, { status: 400 });
      }
      return Response.json({
        ok: true,
        chatId: String(chat.id),
        chatName: chat.title || chat.first_name || chat.username || "Telegram chat",
      });
    }

    if (body.action === "discover-mezana") {
      if (!token) return Response.json({ error: "Avval HALO Telegram botini ulang." }, { status: 400 });
      const destination = body.mezanaDestination === "purchased" ? "purchased" : "borrowed";
      const command = destination === "purchased" ? "/mezana_sotib" : "/mezana_olib";
      const updates = await telegramCall<Array<{
        message?: {
          text?: string;
          message_thread_id?: number;
          chat?: { id?: number; type?: string; first_name?: string; username?: string; title?: string };
        };
      }>>(token, "getUpdates");
      const message = [...(updates || [])].reverse().find((update) => {
        const message = update.message;
        const messageText = String(message?.text || "").trim();
        const commandMatches = destination === "purchased"
          ? /^\/mezana_sotib(?:@[a-z0-9_]+)?(?:\s|$)/i.test(messageText)
          : /^\/(?:mezana_olib|mezana)(?:@[a-z0-9_]+)?(?:\s|$)/i.test(messageText);
        return Boolean(
          message?.chat?.id
          && (message.chat.type === "group" || message.chat.type === "supergroup")
          && commandMatches,
        );
      })?.message;
      const chat = message?.chat;
      if (!chat?.id) {
        return Response.json({ error: `Kerakli Telegram guruhi yoki ochiq mavzusida ${command} deb yozing, keyin shu tugmani yana bosing.` }, { status: 400 });
      }
      const telegramThreadId = Number.isSafeInteger(message?.message_thread_id) && Number(message?.message_thread_id) > 0
        ? Number(message?.message_thread_id)
        : 0;
      const chatName = chat.title || (destination === "purchased" ? "SOTIB OLINDI guruhi" : "OLIB TURILDI guruhi");
      // Persist before notifying Telegram. A notification failure cannot undo the link.
      const mutation = await saveMezanaDestination(branchId, destination, String(chat.id), chatName, telegramThreadId);
      let warning = "";
      try {
        await telegramCall(token, "sendMessage", {
          chat_id: String(chat.id),
          ...(telegramThreadId ? { message_thread_id: telegramThreadId } : {}),
          text: destination === "purchased"
            ? "✅ HALO Control · SOTIB OLINDI guruhi/mavzusi ulandi."
            : "✅ HALO Control · OLIB TURILDI va QAYTARILDI guruhi/mavzusi ulandi.",
        });
      } catch (error) {
        warning = "Guruh saqlandi, lekin Telegram tasdiq xabari yuborilmadi. "
          + (error instanceof Error && error.name !== "TimeoutError" ? error.message : "Telegram javobi kechikdi.");
      }
      return Response.json({
        ok: true,
        chatId: String(chat.id),
        chatName,
        telegramThreadId,
        mezanaDestination: destination,
        mezanaSettings: mutation.result,
        updatedAt: mutation.updatedAt,
        warning,
        message: "MEZANA guruhi yoki mavzusi saqlandi.",
      });
    }

    if (body.action === "save-mezana") {
      if (body.mezanaDestination !== "borrowed" && body.mezanaDestination !== "purchased") {
        return Response.json({ error: "MEZANA yo‘nalishini tanlang." }, { status: 400 });
      }
      const chatId = String(body.chatId ?? "").trim();
      if (chatId && !/^-[1-9]\d{0,19}$/.test(chatId)) {
        return Response.json({ error: "Guruh Chat ID raqamini tekshiring: u minus bilan boshlanadi." }, { status: 400 });
      }
      const mutation = await saveMezanaDestination(branchId, body.mezanaDestination, chatId);
      return Response.json({ ok: true, mezanaSettings: mutation.result, updatedAt: mutation.updatedAt });
    }

    if (body.action === "mezana-resend-latest") {
      const state = await readState(branchId);
      const entry = await resendLatestMezanaEntry(current, state);
      return Response.json({
        ok: true,
        message: `Oxirgi MEZANA yozuvi guruhga yuborildi: ${entry.productName}.`,
      });
    }

    if (body.action === "save") {
      if (!token) return Response.json({ error: "Bot tokenini kiriting." }, { status: 400 });
      const chatId = String(body.chatId || current.chatId || "").trim();
      if (!chatId) return Response.json({ error: "Chat ID topilmadi." }, { status: 400 });
      const reportTime = String(body.reportTime || current.reportTime || "00:10");
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reportTime)) {
        return Response.json({ error: "Hisobot vaqtini to‘g‘ri tanlang." }, { status: 400 });
      }
      const bot = await telegramCall<{ first_name?: string; username?: string }>(token, "getMe");
      const next: TelegramSettings = {
        ...current,
        botToken: token,
        chatId,
        botName: bot?.username ? `@${bot.username}` : bot?.first_name || "HALO Bot",
        enabled: Boolean(body.enabled),
        reportTime,
      };
      await writeSettings(next);
      return Response.json({ ok: true, ...publicSettings(next, await readBranchStatus(branchId)) });
    }

    if (body.action === "test") {
      if (!current.botToken || !current.chatId) {
        return Response.json({ error: "Avval botni saqlang." }, { status: 400 });
      }
      await telegramCall(current.botToken, "sendMessage", {
        chat_id: current.chatId,
        text: "✅ HALO Control Telegram bot muvaffaqiyatli ulandi.",
      });
      return Response.json({ ok: true, message: "Sinov xabari Telegramga yuborildi." });
    }

    if (body.action === "send") {
      const now = koreaClock();
      const reportDate = String(body.reportDate || (now.time < "12:00" ? previousDate(now.date) : now.date));
      const result = await sendReport(current, reportDate, branchId);
      return Response.json({ ok: true, message: "Hisobot Telegramga yuborildi.", reportDate, ...result });
    }

    if (body.action === "orders") {
      if (!current.botToken) return Response.json({ error: "Avval Telegram botni ulang." }, { status: 400 });
      const now = koreaClock();
      const reportDate = String(body.reportDate || (now.time < "12:00" ? previousDate(now.date) : now.date));
      const state = await readState(branchId);
      const result = await sendSupplierOrders(current, state, reportDate);
      return Response.json({
        ok: true,
        message: result.itemCount
          ? `${result.sent} ta yetkazib beruvchiga buyurtma yuborildi.`
          : "Ombor yetarli, buyurtma yuborilmadi.",
        reportDate,
        orderSent: result.sent,
        orderSkipped: result.skipped,
        orderFailed: result.failed,
      });
    }

    if (body.action === "auto") {
      // Owner-authenticated existing minute check; report failures must not block
      // the ordinary daily report. Closed-browser delivery uses the Sheets timer.
      try { await dispatchBusinessTrendNotification(branchId); } catch { /* Next owner check retries. */ }
      const result = await dispatchScheduledDailyReport(branchId);
      return Response.json(result);
    }

    return Response.json({ error: "Amal tanlanmagan." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error && error.name === "TimeoutError"
        ? "Telegram javobi kechikdi. Shu oynada qayta urinib ko‘ring."
        : error instanceof Error ? error.message : "Telegram amali bajarilmadi." },
      { status: error instanceof HaloStateConflictError ? 409 : 500 },
    );
  }
}
