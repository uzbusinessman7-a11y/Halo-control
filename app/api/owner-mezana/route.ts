import { MezanaPostingError } from "../../lib/mezana-posting";
import {
  buildMezanaDebtTelegramMessage,
  mezanaBorrowedQuantityBalance,
  mezanaDebtActionLabel,
  mezanaDebtBalance,
  mezanaTelegramDestination,
  normalizeMezanaDebtEntries,
  normalizeMezanaSettings,
  validMezanaDebtEntry,
  type MezanaDebtAction,
  type MezanaDebtEntry,
} from "../../lib/mezana-debts";
import { mezanaCatalogItemForAction, normalizeMezanaCatalog } from "../../lib/mezana-catalog";
import { HaloStateConflictError, mutateHaloState, readHaloState, replaceHaloState } from "../../lib/halo-store";
import { isAccountingMonthClosed } from "../../lib/month-end";
import { isAdminRequest } from "../../lib/integration-store";
import {
  STOCK_DOCUMENT_MAX_BYTES,
  STOCK_DOCUMENT_TYPES,
  type StockDocument,
} from "../../lib/stock-documents";
import {
  claimMezanaTelegramDelivery,
  finishMezanaTelegramDelivery,
} from "../../lib/mezana-telegram-delivery";

const MAX_REQUEST_BYTES = STOCK_DOCUMENT_MAX_BYTES * 2 + 512 * 1024;
const extensions: Record<StockDocument["contentType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

declare global {
  var __HALO_CONTROL_BUCKET__: R2Bucket | undefined;
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

const cleanText = (value: unknown, max: number) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
const safeFileName = (value: unknown) => cleanText(value, 180).replace(/[\r\n"]/g, "") || "mezana-chek";

class MezanaRecordError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "MezanaRecordError";
  }
}

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

async function sendMezanaTelegram(chatId: string, threadId: number, caption: string, files: File[]) {
  if (!chatId) return { sent: false, reason: "MEZANA Telegram guruhi alohida ulanmagan." };
  const token = await telegramBotToken();
  if (!token) return { sent: false, reason: "HALO Telegram boti ulanmagan." };
  try {
    if (!files.length) {
      const response = await telegramFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: caption,
          ...(threadId > 0 ? { message_thread_id: threadId } : {}),
        }),
      });
      const result = await response.json() as { ok?: boolean; description?: string };
      return response.ok && result.ok
        ? { sent: true, reason: "" }
        : { sent: false, reason: result.description || "Telegramga yuborilmadi." };
    }
    const payload = new FormData();
    payload.set("chat_id", chatId);
    if (threadId > 0) payload.set("message_thread_id", String(threadId));
    let endpoint = "sendPhoto";
    if (files.length === 1) {
      payload.set("caption", caption);
      payload.set("photo", files[0], safeFileName(files[0].name));
    } else {
      endpoint = "sendMediaGroup";
      payload.set("media", JSON.stringify(files.map((_file, index) => ({
        type: "photo",
        media: `attach://photo${index}`,
        ...(index === 0 ? { caption } : {}),
      }))));
      files.forEach((file, index) => payload.set(`photo${index}`, file, safeFileName(file.name)));
    }
    const response = await telegramFetch(`https://api.telegram.org/bot${token}/${endpoint}`, { method: "POST", body: payload });
    const result = await response.json() as { ok?: boolean; description?: string };
    return response.ok && result.ok
      ? { sent: true, reason: "" }
      : { sent: false, reason: result.description || "Telegramga yuborilmadi." };
  } catch {
    return { sent: false, reason: "Telegramga yuborilmadi." };
  }
}

async function storedMezanaFiles(entry: MezanaDebtEntry, storage: R2Bucket | undefined) {
  if (!storage || !entry.documents.length) return [];
  const files = await Promise.all(entry.documents.map(async (document) => {
    const object = await storage.get(document.key);
    if (!object) return null;
    return new File([await object.arrayBuffer()], document.fileName, { type: document.contentType });
  }));
  return files.filter((file): file is File => Boolean(file));
}

async function deliverMezanaTelegramOnce(input: {
  branchId: string;
  entry: MezanaDebtEntry;
  balance: number;
  borrowedQuantity: number;
  settings: ReturnType<typeof normalizeMezanaSettings>;
  files: File[];
}) {
  const claim = await claimMezanaTelegramDelivery(input.branchId, input.entry.id);
  if (!claim.claimed) return { sent: claim.sent, reason: claim.reason };
  const destination = mezanaTelegramDestination(input.settings, input.entry.action);
  const result = await sendMezanaTelegram(
    destination.chatId,
    destination.threadId,
    buildMezanaDebtTelegramMessage({
      action: input.entry.action,
      date: input.entry.date,
      workerName: input.entry.createdByName,
      productName: input.entry.productName,
      amount: input.entry.amount,
      ...(input.entry.action === "purchased" || input.entry.action === "paid" ? {} : { quantity: input.entry.quantity }),
      currentBalance: input.balance,
      currentBorrowedQuantity: input.borrowedQuantity,
      note: input.entry.note,
    }),
    input.files,
  );
  await finishMezanaTelegramDelivery(input.branchId, input.entry.id, result);
  return result;
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Ikki rasmning har biri 8 MB dan oshmasin." }, { status: 413 });
  }
  const storage = globalThis.__HALO_CONTROL_BUCKET__;
  const uploadedKeys: string[] = [];
  let stateSaved = false;
  try {
    const form = await request.formData();
    const branchId = cleanText(form.get("branchId") || "main", 80);
    const operationId = cleanText(form.get("operationId"), 36);
    const action = cleanText(form.get("action"), 20) as MezanaDebtAction;
    let productName = cleanText(form.get("productName"), 140);
    const catalogItemId = cleanText(form.get("catalogItemId"), 100);
    const note = action === "purchased" || action === "paid" ? cleanText(form.get("note"), 300) : "";
    const date = cleanText(form.get("date"), 10);
    const submittedAmount = Number(form.get("amount"));
    const quantity = Number(form.get("quantity"));
    const itemCount = Number(form.get("itemCount"));
    let amount = action === "purchased" || action === "paid" ? submittedAmount : 0;
    const top = form.get("fileTop");
    const bottom = form.get("fileBottom");
    const files = [top, bottom].filter((file): file is File => file instanceof File && file.size > 0);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId)
      || !/^[a-f0-9-]{36}$/.test(operationId)
      || !["borrowed", "returned", "purchased", "paid"].includes(action)
      || !productName || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || (catalogItemId && !catalogItemId.startsWith("mezana-product:"))
      || (action === "purchased" && catalogItemId && (!Number.isSafeInteger(itemCount) || itemCount <= 0 || itemCount > 1_000_000))
      || ((action === "purchased" || action === "paid") && (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000_000))
      || ((action === "borrowed" || action === "returned") && (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000))) {
      return Response.json({ error: action === "purchased" || action === "paid" ? "Mahsulot nomi va summani tekshiring." : "Mahsulot nomi va sonini tekshiring." }, { status: 400 });
    }
    if (files.length > 2 || files.some((file) => !STOCK_DOCUMENT_TYPES.includes(file.type as StockDocument["contentType"]))) {
      return Response.json({ error: "Faqat JPG, PNG yoki WebP rasm yuklang." }, { status: 415 });
    }
    if (files.some((file) => file.size > STOCK_DOCUMENT_MAX_BYTES)) {
      return Response.json({ error: "Har bir rasm 8 MB dan oshmasin." }, { status: 413 });
    }
    if (files.length && !storage) return Response.json({ error: "Rasm ombori ulanmagan." }, { status: 503 });

    const current = await readHaloState(branchId);
    const catalogItem = action === "paid"
      ? null
      : mezanaCatalogItemForAction(normalizeMezanaCatalog(current.state.mezanaCatalog), catalogItemId, action);
    if (catalogItemId && !catalogItem) {
      return Response.json({ error: "Bu mahsulot ushbu amal uchun rahbar ro‘yxatida yo‘q." }, { status: 400 });
    }
    if (catalogItem) {
      productName = catalogItem.name;
      amount = action === "purchased" ? catalogItem.price * itemCount : 0;
      if (!Number.isSafeInteger(amount) || amount > 100_000_000_000) {
        return Response.json({ error: "Mahsulot summasi juda katta." }, { status: 400 });
      }
    }
    const entries = normalizeMezanaDebtEntries(current.state.mezanaEntries);
    const entryId = `mezana:${operationId}`;
    const existingEntry = entries.find((entry) => entry.id === entryId);
    if (existingEntry) {
      const settings = normalizeMezanaSettings(current.state.mezanaSettings);
      const balance = Math.max(0, mezanaDebtBalance(entries));
      const telegramFiles = files.length ? files : await storedMezanaFiles(existingEntry, storage);
      const telegram = await deliverMezanaTelegramOnce({
        branchId,
        entry: existingEntry,
        balance,
        borrowedQuantity: Math.max(0, mezanaBorrowedQuantityBalance(entries, existingEntry.productName)),
        settings,
        files: telegramFiles,
      });
      return Response.json({
        ok: true,
        entry: existingEntry,
        balance,
        updatedAt: current.updatedAt,
        telegram,
      });
    }
    const createdAt = new Date().toISOString();
    const documents: StockDocument[] = files.map((file) => {
      const contentType = file.type as StockDocument["contentType"];
      const key = `stock-documents/${branchId}/${crypto.randomUUID()}.${extensions[contentType]}`;
      uploadedKeys.push(key);
      return { key, fileName: safeFileName(file.name), contentType, size: file.size, uploadedAt: createdAt };
    });
    const entry: MezanaDebtEntry = {
      id: entryId,
      action,
      productName,
      amount,
      ...(catalogItem ? { catalogItemId: catalogItem.id, unitPrice: catalogItem.price } : {}),
      ...(catalogItem?.image ? { productImage: catalogItem.image } : {}),
      ...(action === "purchased" && catalogItem ? { itemCount } : {}),
      ...(action === "purchased" || action === "paid" ? {} : { quantity }),
      date,
      note,
      documents,
      createdByWorkerId: "owner",
      createdByName: "Rahbar",
      createdAt,
    };
    if (!validMezanaDebtEntry(entry)) return Response.json({ error: "MEZANA yozuvini tekshiring." }, { status: 400 });
    if (storage) {
      await Promise.all(documents.map(async (document, index) => storage.put(
        document.key,
        await files[index].arrayBuffer(),
        { httpMetadata: { contentType: document.contentType }, customMetadata: { fileName: document.fileName, uploadedAt: createdAt } },
      )));
    }
    const mutation = await mutateHaloState((state) => {
      const rawEntries = Array.isArray(state.mezanaEntries) ? state.mezanaEntries : [];
      const latestEntries = normalizeMezanaDebtEntries(rawEntries);
      const alreadySaved = latestEntries.find((item) => item.id === entryId);
      if (alreadySaved) {
        return { state, result: { entry: alreadySaved, entries: latestEntries, settings: normalizeMezanaSettings(state.mezanaSettings), alreadySaved: true } };
      }
      if (isAccountingMonthClosed(state.monthlyCloses, date)) {
        throw new MezanaRecordError(`${date.slice(0, 7)} oyi yopilgan. MEZANA yozuvini ochiq oyga kiriting.`, 409);
      }
      if (action === "returned") {
        const available = Math.max(0, mezanaBorrowedQuantityBalance(latestEntries, productName));
        if (quantity > available) {
          throw new MezanaRecordError(`${productName}dan faqat ${available} ta olib turilgan. Qaytariladigan son bundan oshmasin.`);
        }
      }
      if (action === "paid") {
        const availableDebt = Math.max(0, mezanaDebtBalance(latestEntries));
        if (amount > availableDebt) {
          throw new MezanaRecordError(`MEZANA qarzi faqat ₩${availableDebt.toLocaleString("en-US")}. To‘lov bundan oshmasin.`);
        }
      }
      const nextEntries = [entry, ...latestEntries];
      return {
        state: { ...state, mezanaEntries: [entry, ...rawEntries] },
        result: { entry, entries: nextEntries, settings: normalizeMezanaSettings(state.mezanaSettings), alreadySaved: false },
      };
    }, 5, branchId, "Rahbar", `MEZANA · ${mezanaDebtActionLabel(action)} · ${productName} · ${action === "purchased" || action === "paid" ? `₩${amount.toLocaleString("en-US")}` : `${quantity} ta`}`, "MEZANA");
    stateSaved = true;
    const savedEntry = normalizeMezanaDebtEntries(mutation.state.mezanaEntries).find((row) => row.id === mutation.result.entry.id) || mutation.result.entry;
    const nextEntries = mutation.result.entries;
    if (mutation.result.alreadySaved && storage && uploadedKeys.length) {
      await Promise.all(uploadedKeys.map((key) => storage.delete(key).catch(() => undefined)));
      uploadedKeys.length = 0;
    }
    const settings = mutation.result.settings;
    const balance = Math.max(0, mezanaDebtBalance(nextEntries));
    const telegramFiles = mutation.result.alreadySaved
      ? await storedMezanaFiles(savedEntry, storage)
      : files;
    const telegram = await deliverMezanaTelegramOnce({
      branchId,
      entry: savedEntry,
      balance,
      borrowedQuantity: Math.max(0, mezanaBorrowedQuantityBalance(nextEntries, savedEntry.productName)),
      settings,
      files: telegramFiles,
    });
    return Response.json({ ok: true, entry: savedEntry, balance, updatedAt: mutation.updatedAt, telegram });
  } catch (error) {
    if (!stateSaved && storage) await Promise.all(uploadedKeys.map((key) => storage.delete(key).catch(() => undefined)));
    if (error instanceof MezanaPostingError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof MezanaRecordError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof HaloStateConflictError) {
      return Response.json({ error: "Ma’lumot yangilangan. Sahifani yangilab, qayta urinib ko‘ring." }, { status: 409 });
    }
    return Response.json({ error: "MEZANA yozuvini saqlab bo‘lmadi." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  try {
    const body = await request.json() as { branchId?: unknown; entryId?: unknown };
    const branchId = cleanText(body.branchId || "main", 80);
    const entryId = cleanText(body.entryId, 100);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(branchId) || !entryId.startsWith("mezana:")) {
      return Response.json({ error: "MEZANA yozuvi topilmadi." }, { status: 400 });
    }
    const current = await readHaloState(branchId);
    const entries = normalizeMezanaDebtEntries(current.state.mezanaEntries);
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) return Response.json({ error: "MEZANA yozuvi topilmadi." }, { status: 404 });
    const settings = normalizeMezanaSettings(current.state.mezanaSettings);
    const balance = Math.max(0, mezanaDebtBalance(entries));
    const files = await storedMezanaFiles(entry, globalThis.__HALO_CONTROL_BUCKET__);
    const telegram = await deliverMezanaTelegramOnce({
      branchId,
      entry,
      balance,
      borrowedQuantity: Math.max(0, mezanaBorrowedQuantityBalance(entries, entry.productName)),
      settings,
      files,
    });
    return Response.json({ ok: true, entry, balance, updatedAt: current.updatedAt, telegram });
  } catch {
    return Response.json({ error: "MEZANA yozuvini Telegramga yuborib bo‘lmadi." }, { status: 500 });
  }
}
