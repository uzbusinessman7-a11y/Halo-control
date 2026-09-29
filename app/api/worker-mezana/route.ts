import { MezanaPostingError } from "../../lib/mezana-posting";
import {
  buildMezanaDebtTelegramMessage,
  hasNegativeMezanaBorrowedQuantity,
  mezanaBorrowedQuantityBalance,
  mezanaDebtActionLabel,
  mezanaDebtBalance,
  mezanaDebtEntryValue,
  mezanaTelegramDestination,
  normalizeMezanaDebtEntries,
  normalizeMezanaSettings,
  validMezanaDebtEntry,
  type MezanaDebtAction,
  type MezanaDebtEntry,
} from "../../lib/mezana-debts";
import { mezanaCatalogItemForAction, normalizeMezanaCatalog } from "../../lib/mezana-catalog";
import {
  HaloStateConflictError,
  mutateHaloState,
  readHaloState,
  replaceHaloState,
} from "../../lib/halo-store";
import { isAccountingMonthClosed } from "../../lib/month-end";
import {
  createDeletedItem,
  normalizeDeletedItems,
  prependDeletedItem,
} from "../../lib/deleted-items";
import {
  STOCK_DOCUMENT_MAX_BYTES,
  STOCK_DOCUMENT_TYPES,
  type StockDocument,
} from "../../lib/stock-documents";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import { buildWorkerStateView } from "../../lib/worker-state-view";
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

const cleanText = (value: unknown, max: number) => String(value || "")
  .trim()
  .replace(/\s+/g, " ")
  .slice(0, max);

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
    const response = await telegramFetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: "POST",
      body: payload,
    });
    const result = await response.json() as { ok?: boolean; description?: string };
    return response.ok && result.ok
      ? { sent: true, reason: "" }
      : { sent: false, reason: result.description || "Telegramga yuborilmadi." };
  } catch {
    return { sent: false, reason: "Telegramga yuborilmadi." };
  }
}

async function storedMezanaFiles(entry: MezanaDebtEntry, storage: R2Bucket | undefined) {
  const documents = [entry.productImage, ...entry.documents].filter((document): document is StockDocument => Boolean(document));
  if (!storage || !documents.length) return [];
  const files = await Promise.all(documents.map(async (document) => {
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

const entryValue = mezanaDebtEntryValue;

async function sendMezanaText(chatId: string, threadId: number, text: string) {
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

async function sendMezanaTextToActions(
  settings: ReturnType<typeof normalizeMezanaSettings>,
  actions: MezanaDebtAction[],
  text: string,
) {
  const destinations = actions
    .map((action) => mezanaTelegramDestination(settings, action))
    .filter((destination, index, list) => list.findIndex((candidate) => (
      candidate.chatId === destination.chatId && candidate.threadId === destination.threadId
    )) === index);
  const results = await Promise.all(destinations.map((destination) => (
    sendMezanaText(destination.chatId, destination.threadId, text)
  )));
  return {
    sent: results.length > 0 && results.every((result) => result.sent),
    reason: results.filter((result) => !result.sent).map((result) => result.reason).filter(Boolean).join(" "),
  };
}

export async function POST(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
  if (!session.canWarehouseReceipt) {
    return Response.json({ error: "Rahbar bu akkauntga MEZANA yozuvini kiritish ruxsatini bermagan." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Ikki rasmning har biri 8 MB dan oshmasin." }, { status: 413 });
  }
  const storage = globalThis.__HALO_CONTROL_BUCKET__;
  const uploadedKeys: string[] = [];
  let stateSaved = false;
  try {
    const form = await request.formData();
    const operationId = cleanText(form.get("operationId"), 36);
    const action = cleanText(form.get("action"), 20) as MezanaDebtAction;
    const catalogItemId = cleanText(form.get("catalogItemId"), 100);
    const note = action === "purchased" ? cleanText(form.get("note"), 300) : "";
    const date = cleanText(form.get("date"), 10);
    const quantity = Number(form.get("quantity"));
    const itemCount = Number(form.get("itemCount"));
    const top = form.get("fileTop");
    const bottom = form.get("fileBottom");
    const files = [top, bottom].filter((file): file is File => file instanceof File && file.size > 0);
    if (!/^[a-f0-9-]{36}$/.test(operationId) || (action !== "borrowed" && action !== "returned" && action !== "purchased")
      || !catalogItemId.startsWith("mezana-product:") || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || (action === "purchased" && (!Number.isSafeInteger(itemCount) || itemCount <= 0 || itemCount > 1_000_000))
      || (action !== "purchased" && (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000))) {
      return Response.json({ error: "Rahbar belgilagan mahsulotni va sonini tanlang." }, { status: 400 });
    }
    if (files.length > 2 || files.some((file) => !STOCK_DOCUMENT_TYPES.includes(file.type as StockDocument["contentType"]))) {
      return Response.json({ error: "Faqat JPG, PNG yoki WebP rasm yuklang." }, { status: 415 });
    }
    if (files.some((file) => file.size > STOCK_DOCUMENT_MAX_BYTES)) {
      return Response.json({ error: "Har bir rasm 8 MB dan oshmasin." }, { status: 413 });
    }
    if (files.length && !storage) return Response.json({ error: "Rasm ombori ulanmagan." }, { status: 503 });

    const current = await readHaloState(session.branchId);
    const catalog = normalizeMezanaCatalog(current.state.mezanaCatalog);
    const catalogItem = mezanaCatalogItemForAction(catalog, catalogItemId, action);
    if (!catalogItem) {
      return Response.json({ error: "Bu mahsulot ushbu amal uchun rahbar tomonidan belgilanmagan." }, { status: 400 });
    }
    const productName = catalogItem.name;
    const unitPrice = catalogItem.price;
    const amount = action === "purchased" ? unitPrice * itemCount : 0;
    if (!Number.isSafeInteger(amount) || amount > 100_000_000_000) {
      return Response.json({ error: "Mahsulot summasi juda katta." }, { status: 400 });
    }
    const entries = normalizeMezanaDebtEntries(current.state.mezanaEntries);
    const entryId = `mezana:${operationId}`;
    const existingEntry = entries.find((entry) => entry.id === entryId);
    if (existingEntry) {
      const settings = normalizeMezanaSettings(current.state.mezanaSettings);
      const balance = Math.max(0, mezanaDebtBalance(entries));
      const telegramFiles = files.length ? files : await storedMezanaFiles(existingEntry, storage);
      const telegram = await deliverMezanaTelegramOnce({
        branchId: session.branchId,
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
      const key = `stock-documents/${session.branchId}/${crypto.randomUUID()}.${extensions[contentType]}`;
      uploadedKeys.push(key);
      return {
        key,
        fileName: safeFileName(file.name),
        contentType,
        size: file.size,
        uploadedAt: createdAt,
      };
    });
    const entry: MezanaDebtEntry = {
      id: entryId,
      action,
      productName,
      amount,
      catalogItemId: catalogItem.id,
      unitPrice,
      ...(catalogItem.image ? { productImage: catalogItem.image } : {}),
      ...(action === "purchased" ? { itemCount } : {}),
      ...(action === "purchased" ? {} : { quantity }),
      date,
      note,
      documents,
      createdByWorkerId: session.userId,
      createdByName: session.name.slice(0, 100),
      createdAt,
    };
    if (!validMezanaDebtEntry(entry)) {
      return Response.json({ error: "MEZANA yozuvini tekshiring." }, { status: 400 });
    }
    if (storage) {
      await Promise.all(documents.map(async (document, index) => storage.put(
        document.key,
        await files[index].arrayBuffer(),
        {
          httpMetadata: { contentType: document.contentType },
          customMetadata: { fileName: document.fileName, uploadedAt: createdAt },
        },
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
      const nextEntries = [entry, ...latestEntries];
      return {
        state: { ...state, mezanaEntries: [entry, ...rawEntries] },
        result: { entry, entries: nextEntries, settings: normalizeMezanaSettings(state.mezanaSettings), alreadySaved: false },
      };
    }, 5, session.branchId, session.name, `MEZANA · ${mezanaDebtActionLabel(action)} · ${productName} · ${action === "purchased" ? `₩${amount.toLocaleString("en-US")}` : `${quantity} ta`}`, "MEZANA");
    stateSaved = true;
    const savedEntry = normalizeMezanaDebtEntries(mutation.state.mezanaEntries).find((row) => row.id === mutation.result.entry.id) || mutation.result.entry;
    const nextEntries = mutation.result.entries;
    if (mutation.result.alreadySaved && storage && uploadedKeys.length) {
      await Promise.all(uploadedKeys.map((key) => storage.delete(key).catch(() => undefined)));
      uploadedKeys.length = 0;
    }
    const settings = mutation.result.settings;
    const balance = Math.max(0, mezanaDebtBalance(nextEntries));
    const telegramFiles = await storedMezanaFiles(savedEntry, storage);
    const telegram = await deliverMezanaTelegramOnce({
      branchId: session.branchId,
      entry: savedEntry,
      balance,
      borrowedQuantity: Math.max(0, mezanaBorrowedQuantityBalance(nextEntries, savedEntry.productName)),
      settings,
      files: telegramFiles,
    });
    return Response.json({
      ok: true,
      entry: savedEntry,
      balance,
      updatedAt: mutation.updatedAt,
      telegram,
    });
  } catch (error) {
    if (!stateSaved && storage) await Promise.all(uploadedKeys.map((key) => storage.delete(key).catch(() => undefined)));
    if (error instanceof MezanaPostingError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof MezanaRecordError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof HaloStateConflictError) {
      return Response.json({ error: "Ma’lumot yangilangan. Sahifani qayta oching." }, { status: 409 });
    }
    return Response.json({ error: "MEZANA yozuvini saqlab bo‘lmadi." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
  if (!session.canWarehouseReceipt) return Response.json({ error: "MEZANA ruxsati berilmagan." }, { status: 403 });
  try {
    const body = await request.json() as { entryId?: string };
    const entryId = cleanText(body.entryId, 100);
    if (!entryId.startsWith("mezana:")) {
      return Response.json({ error: "MEZANA yozuvini tanlang." }, { status: 400 });
    }
    const current = await readHaloState(session.branchId);
    const entries = normalizeMezanaDebtEntries(current.state.mezanaEntries);
    const entry = entries.find((item) => item.id === entryId && item.createdByWorkerId === session.userId);
    if (!entry) {
      return Response.json({ error: "Faqat o‘zingiz kiritgan MEZANA yozuvini yubora olasiz." }, { status: 404 });
    }
    const settings = normalizeMezanaSettings(current.state.mezanaSettings);
    const files = await storedMezanaFiles(entry, globalThis.__HALO_CONTROL_BUCKET__);
    const telegram = await deliverMezanaTelegramOnce({
      branchId: session.branchId,
      entry,
      balance: Math.max(0, mezanaDebtBalance(entries)),
      borrowedQuantity: Math.max(0, mezanaBorrowedQuantityBalance(entries, entry.productName)),
      settings,
      files,
    });
    return Response.json({ ok: true, telegram });
  } catch {
    return Response.json({ error: "MEZANA yozuvini Telegramga yuborib bo‘lmadi." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
  if (!session.canWarehouseReceipt) return Response.json({ error: "MEZANA ruxsati berilmagan." }, { status: 403 });
  try {
    const body = await request.json() as {
      entryId?: string;
      action?: MezanaDebtAction;
      productName?: string;
      quantity?: number;
      amount?: number;
      date?: string;
      note?: string;
      updatedAt?: string;
    };
    const entryId = cleanText(body.entryId, 100);
    const action = cleanText(body.action, 20) as MezanaDebtAction;
    const productName = cleanText(body.productName, 140);
    const amount = action === "purchased" ? Number(body.amount) : 0;
    const quantity = Number(body.quantity);
    if (!entryId.startsWith("mezana:") || (action !== "borrowed" && action !== "returned" && action !== "purchased") || !productName
      || (action === "purchased" && (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000_000))
      || (action !== "purchased" && (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000))) {
      return Response.json({ error: action === "purchased" ? "Mahsulot nomi va summani tekshiring." : "Mahsulot nomi va sonini tekshiring." }, { status: 400 });
    }
    const current = await readHaloState(session.branchId);
    if (!body.updatedAt || body.updatedAt !== current.updatedAt) {
      return Response.json({ error: "Ma’lumot yangilangan. Sahifani qayta oching." }, { status: 409 });
    }
    const entries = normalizeMezanaDebtEntries(current.state.mezanaEntries);
    const previous = entries.find((entry) => entry.id === entryId && entry.createdByWorkerId === session.userId);
    if (!previous) return Response.json({ error: "Faqat o‘zingiz kiritgan MEZANA yozuvini tahrirlay olasiz." }, { status: 404 });
    if (isAccountingMonthClosed(current.state.monthlyCloses, previous.date)) {
      return Response.json({ error: "Yopilgan oydagi MEZANA yozuvini tahrirlab bo‘lmaydi." }, { status: 409 });
    }
    const edited: MezanaDebtEntry = {
      ...previous,
      action,
      productName,
      amount,
      ...(action === "purchased" ? { quantity: undefined } : { quantity }),
      date: action === "purchased" && /^\d{4}-\d{2}-\d{2}$/.test(cleanText(body.date, 10)) ? cleanText(body.date, 10) : previous.date,
      note: action === "purchased" ? cleanText(body.note, 300) : "",
    };
    if (!validMezanaDebtEntry(edited)) return Response.json({ error: "MEZANA yozuvini tekshiring." }, { status: 400 });
    if (isAccountingMonthClosed(current.state.monthlyCloses, edited.date)) {
      return Response.json({ error: "MEZANA yozuvini yopilgan oyga ko‘chirib bo‘lmaydi." }, { status: 409 });
    }
    const nextEntries = entries.map((entry) => entry.id === entryId ? edited : entry);
    if (hasNegativeMezanaBorrowedQuantity(nextEntries)) {
      return Response.json({ error: "Bu o‘zgarish olib turilgan mahsulot sonini minusga tushiradi." }, { status: 400 });
    }
    const balance = mezanaDebtBalance(nextEntries);
    if (balance < 0) return Response.json({ error: "Bu o‘zgarish MEZANA qarzini minusga tushiradi." }, { status: 400 });
    const nextState = { ...current.state, mezanaEntries: nextEntries };
    const revision = await replaceHaloState(
      nextState,
      current.updatedAt,
      session.branchId,
      session.name,
      `MEZANA yozuvi tahrirlandi · ${productName} · ${entryValue(edited)}`,
      "MEZANA",
    );
    const settings = normalizeMezanaSettings(current.state.mezanaSettings);
    const targetActions = previous.action === edited.action ? [edited.action] : [previous.action, edited.action];
    const telegram = await sendMezanaTextToActions(settings, targetActions, [
      "✏️ MEZANA YOZUVI TAHRIRLANDI",
      `👤 O‘zgartirgan: ${session.name}`,
      `OLDIN: ${mezanaDebtActionLabel(previous.action)} · ${previous.productName} · ${entryValue(previous)}`,
      `HOZIR: ${mezanaDebtActionLabel(edited.action)} · ${edited.productName} · ${entryValue(edited)}`,
      previous.action !== edited.action
        ? "↔️ Yozuv boshqa MEZANA hisobiga ko‘chirildi."
        : edited.action === "purchased"
          ? `💳 MEZANA qolgan qarzi: ₩${Math.max(0, balance).toLocaleString("en-US")}`
          : `📊 Hozir olib turilgan: ${Math.max(0, mezanaBorrowedQuantityBalance(nextEntries, edited.productName))} ta`,
    ].join("\n"));
    return Response.json({ ok: true, updatedAt: revision, state: buildWorkerStateView(nextState, session.userId, revision), telegram });
  } catch (error) {
    if (error instanceof MezanaPostingError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof HaloStateConflictError) return Response.json({ error: "Ma’lumot yangilangan. Qayta urinib ko‘ring." }, { status: 409 });
    return Response.json({ error: "MEZANA yozuvini tahrirlab bo‘lmadi." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await authenticateWorkerRequest(request);
  if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
  if (!session.canWarehouseReceipt) return Response.json({ error: "MEZANA ruxsati berilmagan." }, { status: 403 });
  try {
    const body = await request.json() as { entryId?: string; reason?: string; updatedAt?: string };
    const entryId = cleanText(body.entryId, 100);
    const reason = cleanText(body.reason, 500);
    if (!entryId.startsWith("mezana:") || !reason) return Response.json({ error: "O‘chirish sababini kiriting." }, { status: 400 });
    const current = await readHaloState(session.branchId);
    if (!body.updatedAt || body.updatedAt !== current.updatedAt) {
      return Response.json({ error: "Ma’lumot yangilangan. Sahifani qayta oching." }, { status: 409 });
    }
    const entries = normalizeMezanaDebtEntries(current.state.mezanaEntries);
    const entry = entries.find((item) => item.id === entryId && item.createdByWorkerId === session.userId);
    if (!entry) return Response.json({ error: "Faqat o‘zingiz kiritgan MEZANA yozuvini o‘chira olasiz." }, { status: 404 });
    if (isAccountingMonthClosed(current.state.monthlyCloses, entry.date)) {
      return Response.json({ error: "Yopilgan oydagi MEZANA yozuvini o‘chirib bo‘lmaydi." }, { status: 409 });
    }
    const nextEntries = entries.filter((item) => item.id !== entryId);
    if (hasNegativeMezanaBorrowedQuantity(nextEntries)) {
      return Response.json({ error: "Bu yozuvni o‘chirish olib turilgan mahsulot sonini minusga tushiradi." }, { status: 400 });
    }
    const balance = mezanaDebtBalance(nextEntries);
    if (balance < 0) return Response.json({ error: "Bu yozuvni o‘chirish MEZANA qarzini minusga tushiradi." }, { status: 400 });
    const deleted = {
      ...createDeletedItem({
        kind: "mezanaEntry",
        entityId: entry.id,
        label: `${entry.productName} · ${entryValue(entry)}`,
        section: "MEZANA",
        record: entry as unknown as Record<string, unknown>,
        reason,
      }),
      deletedBy: session.name.slice(0, 50),
    };
    const nextState = {
      ...current.state,
      mezanaEntries: nextEntries,
      deletedItems: prependDeletedItem(normalizeDeletedItems(current.state.deletedItems), deleted),
    };
    const revision = await replaceHaloState(
      nextState,
      current.updatedAt,
      session.branchId,
      session.name,
      `MEZANA yozuvi o‘chirildi · ${entry.productName} · Sabab: ${reason}`,
      "MEZANA",
    );
    const settings = normalizeMezanaSettings(current.state.mezanaSettings);
    const destination = mezanaTelegramDestination(settings, entry.action);
    const telegram = await sendMezanaText(destination.chatId, destination.threadId, [
      "🗑 MEZANA YOZUVI O‘CHIRILDI",
      `👤 O‘chirgan: ${session.name}`,
      `📦 ${mezanaDebtActionLabel(entry.action)} · ${entry.productName}`,
      entry.quantity ? `🔢 Soni: ${entry.quantity}` : `💵 Summa: ${entryValue(entry)}`,
      `⚠️ Sabab: ${reason}`,
      entry.action === "purchased" || entry.action === "paid"
        ? `💳 MEZANA qolgan qarzi: ₩${Math.max(0, balance).toLocaleString("en-US")}`
        : `📊 Hozir olib turilgan: ${Math.max(0, mezanaBorrowedQuantityBalance(nextEntries, entry.productName))} ta`,
    ].join("\n"));
    return Response.json({ ok: true, updatedAt: revision, state: buildWorkerStateView(nextState, session.userId, revision), telegram });
  } catch (error) {
    if (error instanceof MezanaPostingError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof HaloStateConflictError) return Response.json({ error: "Ma’lumot yangilangan. Qayta urinib ko‘ring." }, { status: 409 });
    return Response.json({ error: "MEZANA yozuvini o‘chirib bo‘lmadi." }, { status: 500 });
  }
}
