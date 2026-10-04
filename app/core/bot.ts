/**
 * HALO V2 — Telegram yordamchi botining tugmali qismi. AI (OpenAI kaliti) kerak emas.
 *
 * Ma'lumot:  📊 Bugun · 💰 Kassa · 🤝 MEZANA · Eksport (fayl)  (Qarzlar, Ombor — eski yordamchi orqali, o'zgarmagan).
 * Kiritma:   ➕ Xarajat · ➕ MEZANA · ➕ Qarz to‘lovi — har biri bosqichma-bosqich so'raladi va oxirida
 *            to'liq ko'rsatiladi; «Tasdiqlash» bosilmaguncha hisobga hech narsa yozilmaydi.
 *
 * Qoidalar sahifalardagi bilan bir xil, chunki o'sha funksiyalar chaqiriladi:
 *  - xarajat      → Kiritish sahifasidagi addExpense (takror, yopilgan oy/kun, avtomatik turlar);
 *  - MEZANA       → MEZANA sahifasidagi addMezanaEntry, keyin Telegram guruhga yuboriladi;
 *  - qarz to'lovi → eski yordamchining tekshirilgan rejasi (buildAssistantPlan + decideCommand).
 * Har kiritmaning amal raqami — suhbat yozuvining ID'si: tugma ikki marta bosilsa ham bir marta yoziladi.
 *
 * Suhbat holati halo_assistant_jobs jadvalida (status = 'draft') turadi; 15 daqiqa javob bo'lmasa eskiradi.
 * Bot faqat rahbar bog'lagan shaxsiy chatda ishlaydi — bu tekshiruv webhook'da (app/api/assistant/telegram).
 */
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../lib/halo-store";
import { AssistantError, buildAssistantPlan, stateFingerprint } from "../lib/assistant-engine";
import { assistantDb, getAssistantConfig, type AssistantConfig, type AssistantJob } from "../lib/assistant-store";
import { MezanaPostingError } from "../lib/mezana-posting";
import { mezanaDebtActionLabel, type MezanaDebtAction } from "../lib/mezana-debts";
import { buildReportExport, exportKinds } from "../lib/report-export";
import type { D1Like } from "../lib/full-migration";
import { addExpense, EntryError, EXPENSE_CATEGORIES, moneyAccounts } from "../api/v2/kiritish/route";
import { addMezanaEntry, MezanaError, mezanaView } from "../api/v2/mezana/route";
import { assertV2DayOpen, ClosedDayError, TENANT_ID } from "./closed-days";
import { homeReport, todayText } from "./home";
import { ownerSummary } from "./kassa-service";
import { deliverMezanaEntry } from "./mezana-notify";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_ASSISTANT_AI__: { key: string; model: string } | undefined;
}

type Row = Record<string, unknown>;
type Api = (method: string, body: Record<string, unknown>) => Promise<unknown>;
export type BotContext = { config: AssistantConfig; chat: string; actor: string; text: string; update: Row; api: Api };
type Option = { id: string; label: string; n?: number };
type Draft = {
  kind: "expense" | "mezana" | "payment" | "branch" | "export";
  step: string;
  /** Matn kutilayotgan maydon ("" — tugma kutilmoqda). */
  await: "" | "amount" | "name" | "product" | "quantity";
  date: string;
  options?: Option[];
  category?: string; amount?: number; name?: string;
  accountId?: string; accountName?: string;
  action?: MezanaDebtAction; catalogItemId?: string; productName?: string; unitPrice?: number; quantity?: number; available?: number; debt?: number;
  supplierId?: string; supplierName?: string;
  duplicate?: boolean;
  exportKind?: string;
};
type Button = { text: string; callback_data: string };

const DRAFT_MINUTES = 15;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : []);
const won = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(Math.round(value)).toLocaleString("en-US")} ₩`;
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export const BOT_BUTTONS = {
  today: "📊 Bugun", cash: "💰 Kassa", debts: "Qarzlar", stock: "Ombor", mezana: "🤝 MEZANA", export: "Eksport",
  expense: "➕ Xarajat", addMezana: "➕ MEZANA", payment: "➕ Qarz to‘lovi", branch: "🏪 Filial",
} as const;
const MEZANA_ACTIONS: Array<{ id: MezanaDebtAction; label: string }> = [
  { id: "borrowed", label: "📥 Olib turildi" }, { id: "returned", label: "📤 Qaytarildi" },
  { id: "purchased", label: "🛒 Qarzga olindi" }, { id: "paid", label: "💸 To‘lov" },
];

export function botKeyboard(branchCount: number) {
  const b = BOT_BUTTONS;
  return {
    keyboard: [
      [{ text: b.today }, { text: b.cash }, { text: b.debts }],
      [{ text: b.stock }, { text: b.mezana }, { text: b.export }],
      [{ text: b.expense }, { text: b.addMezana }, { text: b.payment }],
      ...(branchCount > 1 ? [[{ text: b.branch }]] : []),
    ],
    resize_keyboard: true,
  };
}

/**
 * "45000", "45 000", "45,000", "45.000", "45 ming", "45k", "1.5 mln", "45000 gaz balloni" → butun won va qolgan matn.
 * Shubhali yozuv (masalan "45.5" yoki "1.250 ming") o'qilmaydi — bot qaytadan so'raydi. O'qilgan summa
 * baribir tasdiqlash oynasida ko'rsatiladi.
 */
export function parseAmount(text: string): { amount: number; rest: string } | null {
  const source = String(text || "").trim();
  const grouped = source.match(/^\d{1,3}(?:[ .,]\d{3})+(?!\d)/)?.[0];
  const decimal = grouped ? undefined : source.match(/^\d+[.,]\d+(?=\s*(?:ming|mln|k)(?![\p{L}\d]))/iu)?.[0];
  const number = grouped || decimal || source.match(/^\d+/)?.[0];
  if (!number) return null;
  let rest = source.slice(number.length);
  const suffix = rest.match(/^\s*(ming|mln|k)(?![\p{L}\d])/iu);
  if (suffix) rest = rest.slice(suffix[0].length);
  const currency = rest.match(/^\s*(?:won|von|₩)(?![\p{L}\d])/iu);
  if (currency) rest = rest.slice(currency[0].length);
  // Summadan keyin darhol harf, raqam yoki tinish belgisi kelsa (45.5, 45000abc) — bu aniq summa emas.
  if (rest && !/^\s/.test(rest)) return null;
  let amount: number;
  if (suffix) {
    // "1.250 ming" — ming ajratuvchisimi yoki kasrmi, aniq emas.
    if (grouped && /[.,]/.test(grouped)) return null;
    const exact = Number(number.replace(/\s/g, "").replace(",", ".")) * (suffix[1].toLowerCase() === "mln" ? 1_000_000 : 1_000);
    amount = Math.round(exact);
    if (Math.abs(exact - amount) > 0.000_001) return null;
  } else {
    amount = Number(number.replace(/[^\d]/g, ""));
  }
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000_000) return null;
  return { amount, rest: rest.trim().replace(/\s+/g, " ").slice(0, 140) };
}

/** "5", "5 ta", "12 dona" → 5, 12. */
export function parseQuantity(text: string): number | null {
  const match = String(text || "").trim().match(/^(\d{1,7})\s*(?:ta|dona|x)?$/iu);
  if (!match) return null;
  const quantity = Number(match[1]);
  return quantity > 0 && quantity <= 1_000_000 ? quantity : null;
}

function isCommand(text: string) {
  // Izoh "ombor uchun qulf" kabi boshlanishi mumkin: bir so'zli buyruqlar faqat o'zi yozilganda buyruq hisoblanadi.
  return text.startsWith("/") || Object.values(BOT_BUTTONS).includes(text as never)
    || /^(hisobot|bugun|qarzlar|ombor|yordam|help)$/i.test(text) || /^(eksport|export|xarajat)(?:\s|$)/i.test(text);
}

/* ---------- suhbat yozuvlari ---------- */
async function createDraft(ctx: BotContext, draft: Draft, input: string): Promise<{ id: string; draft: Draft }> {
  const db = assistantDb();
  const now = Date.now();
  const key = `tgv:${ctx.config.generation}:${Number(ctx.update.update_id)}`;
  await db.prepare("UPDATE halo_assistant_jobs SET status='cancelled',response='Yangi amal boshlandi.',updated_at=? WHERE actor=? AND status='draft' AND source_key<>?")
    .bind(now, ctx.actor, key).run();
  const id = crypto.randomUUID();
  const inserted = await db.prepare(
    "INSERT OR IGNORE INTO halo_assistant_jobs (id,source_key,branch_id,actor,generation,input,status,payload,response,created_at,updated_at,sent) VALUES (?,?,?,?,?,?,'draft',?,'',?,?,1)",
  ).bind(id, key, ctx.config.branch_id, ctx.actor, ctx.config.generation, input.slice(0, 500), JSON.stringify(draft), now, now).run();
  if (inserted.meta.changes) return { id, draft };
  // Telegram shu xabarni qayta yuborgan: avval yaratilgan yozuv ishlatiladi.
  const existing = await db.prepare("SELECT * FROM halo_assistant_jobs WHERE source_key=?").bind(key).first<AssistantJob>();
  if (!existing) throw new AssistantError("Amal boshlanmadi. Qayta urinib ko‘ring.");
  return { id: existing.id, draft: parseDraft(existing) || draft };
}

function parseDraft(job: AssistantJob | null): Draft | null {
  if (!job || job.status !== "draft") return null;
  try {
    const draft = JSON.parse(job.payload) as Draft;
    return draft && typeof draft === "object" && typeof draft.kind === "string" ? draft : null;
  } catch {
    return null;
  }
}

async function saveDraft(id: string, draft: Draft) {
  const result = await assistantDb().prepare("UPDATE halo_assistant_jobs SET payload=?,updated_at=? WHERE id=? AND status='draft'")
    .bind(JSON.stringify(draft), Date.now(), id).run();
  if (!result.meta.changes) throw new AssistantError("Bu amal eskirgan yoki yakunlangan. Qaytadan boshlang.");
}

async function closeDraft(id: string, status: "done" | "cancelled" | "error", response: string) {
  await assistantDb().prepare("UPDATE halo_assistant_jobs SET status=?,response=?,updated_at=? WHERE id=? AND status='draft'")
    .bind(status, response.slice(0, 3500), Date.now(), id).run();
}

async function loadDraft(ctx: BotContext, id: string): Promise<Draft | null> {
  const job = await assistantDb().prepare("SELECT * FROM halo_assistant_jobs WHERE id=?").bind(id).first<AssistantJob>();
  if (!job || job.actor !== ctx.actor || job.branch_id !== ctx.config.branch_id || job.generation !== ctx.config.generation) return null;
  if (job.updated_at < Date.now() - DRAFT_MINUTES * 60_000) return null;
  return parseDraft(job);
}

async function waitingDraft(ctx: BotContext): Promise<{ id: string; draft: Draft } | null> {
  const job = await assistantDb().prepare(
    "SELECT * FROM halo_assistant_jobs WHERE actor=? AND branch_id=? AND generation=? AND status='draft' AND updated_at>? ORDER BY updated_at DESC LIMIT 1",
  ).bind(ctx.actor, ctx.config.branch_id, ctx.config.generation, Date.now() - DRAFT_MINUTES * 60_000).first<AssistantJob>();
  const draft = parseDraft(job);
  return job && draft ? { id: job.id, draft } : null;
}

/* ---------- ko'rinish ---------- */
const code = (id: string, value: string) => `v:${id}:${value}`;
function optionButtons(id: string, options: Option[], columns: number): Button[][] {
  const out: Button[][] = [];
  options.forEach((option, index) => {
    const button = { text: option.label.slice(0, 60), callback_data: code(id, `c${index}`) };
    if (index % columns === 0) out.push([button]);
    else out[out.length - 1].push(button);
  });
  return out;
}
const cancelRow = (id: string): Button[] => [{ text: "✖ Bekor qilish", callback_data: code(id, "no") }];
const confirmRows = (id: string): Button[][] => [[{ text: "✅ Tasdiqlash", callback_data: code(id, "ok") }, { text: "✖ Bekor qilish", callback_data: code(id, "no") }]];

async function show(ctx: BotContext, text: string, buttons: Button[][], messageId?: number) {
  const body = { chat_id: ctx.chat, text, reply_markup: { inline_keyboard: buttons } };
  if (messageId) {
    try {
      await ctx.api("editMessageText", { ...body, message_id: messageId });
      return;
    } catch { /* eski xabarni o'zgartirib bo'lmasa, yangi xabar yuboriladi */ }
  }
  await ctx.api("sendMessage", body);
}

function branchLine(branchName: string) {
  return branchName ? `🏪 ${branchName}\n` : "";
}

function expenseSummary(draft: Draft, branchName: string) {
  return [
    `💸 Xarajat · ${draft.date}`,
    branchLine(branchName).trim(),
    `Turi: ${draft.category}`,
    `Nima uchun: ${draft.name}`,
    `Summa: ${won(draft.amount || 0)}`,
    `Hisob: ${draft.accountName}`,
  ].filter(Boolean).join("\n");
}

function mezanaSummary(draft: Draft, branchName: string) {
  const action = draft.action as MezanaDebtAction;
  const label = MEZANA_ACTIONS.find((item) => item.id === action)?.label || mezanaDebtActionLabel(action);
  return [
    `🤝 MEZANA · ${label} · ${draft.date}`,
    branchLine(branchName).trim(),
    action === "paid" ? "" : `Mahsulot: ${draft.productName}`,
    action === "borrowed" || action === "returned" ? `Soni: ${draft.quantity} ta` : "",
    action === "purchased" && draft.quantity ? `Soni: ${draft.quantity} ta` : "",
    action === "purchased" || action === "paid" ? `Summa: ${won(draft.amount || 0)}` : "",
    action === "paid" ? `Hisob: ${draft.accountName || "hisobga yozilmaydi"}` : "",
  ].filter(Boolean).join("\n");
}

/* ---------- ma'lumot ---------- */
async function branchName(branchId: string) {
  const branches = await listHaloBranches();
  return { name: branches.find((branch) => branch.id === branchId)?.name || branchId, count: branches.length, branches };
}

async function todayInfo(ctx: BotContext) {
  const { state } = await readHaloState(ctx.config.branch_id);
  const report = await homeReport(globalThis.__HALO_CONTROL_DB__ as unknown as D1Like, { tenantId: TENANT_ID, branchId: ctx.config.branch_id }, state as Row, seoulToday());
  return todayText(report, (await branchName(ctx.config.branch_id)).name);
}

async function cashInfo(ctx: BotContext) {
  const today = seoulToday();
  const { state } = await readHaloState(ctx.config.branch_id);
  const summary = await ownerSummary(globalThis.__HALO_CONTROL_DB__ as unknown as D1Like, { tenantId: TENANT_ID, branchId: ctx.config.branch_id }, state as Row, today);
  const money = summary.balances.filter((item) => item.role === "cash" || item.role === "bank");
  const waiting = summary.receivables.filter((item) => item.outstanding > 0);
  const unclosed = summary.days.filter((day) => !day.closed && day.date < today).map((day) => day.date);
  return [
    `💰 Kassa · ${(await branchName(ctx.config.branch_id)).name} — ${dm(today)}`,
    "",
    ...money.map((item) => `${item.name}: ${won(item.balance)}`),
    `Jami: ${won(money.reduce((sum, item) => sum + item.balance, 0))}`,
    ...(waiting.length ? ["", "Kutilmoqda (hali bankka tushmagan):", ...waiting.map((item) => `${item.name}: ${won(item.outstanding)}${item.ageDays != null ? ` · eng eskisi ${item.ageDays} kun` : ""}`)] : []),
    "",
    unclosed.length ? `⚠️ ${unclosed.length} ta kun yopilmagan (oxirgisi ${unclosed[0]})` : "✅ Hamma o'tgan kunlar yopilgan",
    ...(summary.bridge.ok ? [] : ["🔴 Pul hisoblari eski yozuvlar bilan mos emas — Kassa sahifasini tekshiring"]),
  ].join("\n");
}

async function mezanaInfo(ctx: BotContext) {
  const today = seoulToday();
  const { state } = await readHaloState(ctx.config.branch_id);
  const view = mezanaView(state as Row, today);
  const labels = new Map(MEZANA_ACTIONS.map((item) => [item.id, item.label]));
  return [
    `🤝 MEZANA · ${(await branchName(ctx.config.branch_id)).name}`,
    "",
    `Qarz: ${won(view.debt)}`,
    view.borrowed.length ? `Olib turilgan (qaytarilmagan): ${view.borrowed.map((item) => `${item.name} ${item.quantity} ta`).join(", ")}` : "Olib turilgan mahsulot yo‘q",
    ...(view.entries.length ? ["", "Oxirgi yozuvlar:", ...view.entries.slice(0, 6).map((entry) => (
      `${dm(entry.date)} · ${labels.get(entry.action) || entry.action}${entry.action === "paid" ? "" : ` · ${entry.name}`} · ${entry.action === "purchased" || entry.action === "paid" ? won(entry.amount) : `${entry.quantity} ta`} · ${entry.by}`
    ))] : []),
  ].join("\n");
}

function helpText(aiReady: boolean) {
  return [
    "HALO yordamchi — pastdagi tugmalar bilan ishlaydi.",
    "",
    "Ma’lumot: 📊 Bugun · 💰 Kassa · Qarzlar · Ombor · 🤝 MEZANA · Eksport",
    "Kiritma: ➕ Xarajat · ➕ MEZANA · ➕ Qarz to‘lovi",
    "",
    "Har bir kiritma saqlashdan oldin to‘liq ko‘rsatiladi. «Tasdiqlash» bosilmaguncha hisobga hech narsa yozilmaydi. To‘xtatish uchun «bekor» deb yozing.",
    "Tez yo‘l: «xarajat 45000 gaz balloni» deb yozsangiz, faqat turi va hisobini tanlaysiz.",
    aiReady ? "Erkin matn ham ishlaydi: «Omborga 2 kg un, jami 8000 von»." : "",
  ].filter(Boolean).join("\n");
}

/* ---------- kiritmalar: boshlash ---------- */
async function startExpense(ctx: BotContext, prefill?: { amount: number; rest: string }) {
  const draft: Draft = {
    kind: "expense", step: "category", await: "", date: seoulToday(),
    options: EXPENSE_CATEGORIES.map((category) => ({ id: category, label: category })),
    ...(prefill ? { amount: prefill.amount, name: prefill.rest || undefined } : {}),
  };
  const created = await createDraft(ctx, draft, ctx.text);
  await show(ctx, `💸 Xarajat${prefill ? ` · ${won(prefill.amount)}${prefill.rest ? ` · ${prefill.rest}` : ""}` : ""}\nTurini tanlang:`, [...optionButtons(created.id, draft.options!, 2), cancelRow(created.id)]);
}

async function startMezana(ctx: BotContext) {
  const draft: Draft = { kind: "mezana", step: "action", await: "", date: seoulToday(), options: MEZANA_ACTIONS.map((item) => ({ id: item.id, label: item.label })) };
  const created = await createDraft(ctx, draft, ctx.text);
  await show(ctx, "🤝 MEZANA yozuvi\nAmalni tanlang:", [...optionButtons(created.id, draft.options!, 2), cancelRow(created.id)]);
}

async function startPayment(ctx: BotContext) {
  const { state } = await readHaloState(ctx.config.branch_id);
  const suppliers = rows((state as Row).suppliers)
    .filter((supplier) => supplier.id && supplier.name && !/mezana/i.test(String(supplier.name)) && Number(supplier.balance) > 0)
    .sort((left, right) => Number(right.balance) - Number(left.balance)).slice(0, 24);
  if (!suppliers.length) {
    await ctx.api("sendMessage", { chat_id: ctx.chat, text: "Yetkazib beruvchilarga qarz yo‘q.\nMEZANA to‘lovi: «➕ MEZANA» → «💸 To‘lov»." });
    return;
  }
  const draft: Draft = {
    kind: "payment", step: "supplier", await: "", date: seoulToday(),
    options: suppliers.map((supplier) => ({ id: String(supplier.id), label: `${String(supplier.name)} · ${won(Number(supplier.balance))}`, n: Math.round(Number(supplier.balance)) })),
  };
  const created = await createDraft(ctx, draft, ctx.text);
  await show(ctx, "💳 Qarz to‘lovi\nKimga to‘ladingiz?", [...optionButtons(created.id, draft.options!, 1), cancelRow(created.id)]);
}

async function startExport(ctx: BotContext) {
  const draft: Draft = { kind: "export", step: "kind", await: "", date: seoulToday(), options: Object.entries(exportKinds).map(([id, label]) => ({ id, label })) };
  const created = await createDraft(ctx, draft, ctx.text);
  await show(ctx, "📁 Eksport (Excel / CSV)\nQaysi hisobot kerak? Fayl shu chatga keladi.", [...optionButtons(created.id, draft.options!, 1), cancelRow(created.id)]);
}

/** Hisobot faylini shu chatga yuboradi (eski yordamchidagi «/export» bilan bir xil fayl). */
async function sendExport(ctx: BotContext, kind: string, from: string, to: string) {
  const { state } = await readHaloState(ctx.config.branch_id);
  const file = buildReportExport(state as Row, kind, ctx.config.branch_id, from, to);
  // Fayl tayyorlanayotganda ruxsat bekor qilingan bo'lsa, yuborilmaydi.
  const latest = await getAssistantConfig();
  if (!latest?.enabled || latest.owner_id !== ctx.chat || latest.generation !== ctx.config.generation || latest.branch_id !== ctx.config.branch_id) return;
  const form = new FormData();
  form.set("chat_id", ctx.chat);
  form.set("caption", `${exportKinds[kind as keyof typeof exportKinds]} · ${file.count} ta yozuv${from ? ` · ${from} — ${to}` : ""}. Excel / CSV.`);
  form.set("document", new Blob([file.content], { type: "text/csv;charset=utf-8" }), file.filename);
  const reply = await fetch(`https://api.telegram.org/bot${ctx.config.bot_token}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(25_000) });
  const result = await reply.json() as { ok?: boolean };
  if (!reply.ok || !result.ok) throw new AssistantError("Fayl yuborilmadi. Qayta urinib ko‘ring.");
}

async function startBranch(ctx: BotContext) {
  const { branches } = await branchName(ctx.config.branch_id);
  const draft: Draft = { kind: "branch", step: "branch", await: "", date: seoulToday(), options: branches.map((branch) => ({ id: branch.id, label: `${branch.id === ctx.config.branch_id ? "✓ " : ""}${branch.name}` })) };
  const created = await createDraft(ctx, draft, ctx.text);
  await show(ctx, "🏪 Qaysi filial bo‘yicha ishlaymiz?", [...optionButtons(created.id, draft.options!, 1), cancelRow(created.id)]);
}

/* ---------- kiritmalar: keyingi qadam ---------- */
async function accountOptions(ctx: BotContext, withNone: boolean): Promise<Option[]> {
  const { state } = await readHaloState(ctx.config.branch_id);
  const accounts = moneyAccounts(state as Row).map((account) => ({ id: account.id, label: account.name }));
  return withNone ? [...accounts, { id: "", label: "Hisobga yozilmasin" }] : accounts;
}

/** Qoralama to'lgach: tasdiqlash oynasi (xarajat, MEZANA) yoki tayyor reja (qarz to'lovi). */
async function advance(ctx: BotContext, id: string, draft: Draft, messageId?: number) {
  const name = (await branchName(ctx.config.branch_id)).name;
  if (draft.kind === "expense") {
    if (!draft.category) return;
    if (!draft.amount) {
      draft.step = "amount"; draft.await = "amount"; draft.options = undefined;
      await saveDraft(id, draft);
      await show(ctx, `💸 Xarajat · ${draft.category}\nSummani yozing (masalan: 45000). Izoh bilan birga ham bo‘ladi: 45000 gaz balloni`, [cancelRow(id)], messageId);
      return;
    }
    if (!draft.name) {
      draft.step = "name"; draft.await = "name"; draft.options = undefined;
      await saveDraft(id, draft);
      await show(ctx, `💸 Xarajat · ${draft.category} · ${won(draft.amount)}\nNima uchun to‘landi? Qisqa yozing (masalan: gaz balloni).`, [cancelRow(id)], messageId);
      return;
    }
    if (draft.accountId === undefined) {
      draft.step = "account"; draft.await = ""; draft.options = await accountOptions(ctx, false);
      if (!draft.options.length) throw new AssistantError("Kassa yoki bank hisobi topilmadi. Avval Sozlamalarda hisob oching.");
      await saveDraft(id, draft);
      await show(ctx, `💸 Xarajat · ${draft.category} · ${won(draft.amount)}\nQaysi hisobdan to‘landi?`, [...optionButtons(id, draft.options, 2), cancelRow(id)], messageId);
      return;
    }
    draft.step = "confirm"; draft.await = ""; draft.options = undefined;
    await saveDraft(id, draft);
    await show(ctx, `${expenseSummary(draft, name)}\n\nTekshiring. «Tasdiqlash» bosilmaguncha hisobga yozilmaydi.`, confirmRows(id), messageId);
    return;
  }
  if (draft.kind === "mezana") {
    const action = draft.action as MezanaDebtAction;
    if (action === "paid") {
      if (!draft.amount) {
        draft.step = "amount"; draft.await = "amount"; draft.options = draft.debt ? [{ id: "full", label: `To‘liq: ${won(draft.debt)}`, n: draft.debt }] : undefined;
        await saveDraft(id, draft);
        await show(ctx, `🤝 MEZANA · 💸 To‘lov\nSummani yozing (qarz: ${won(draft.debt || 0)}).`, [...(draft.options ? optionButtons(id, draft.options, 1) : []), cancelRow(id)], messageId);
        return;
      }
      if (draft.accountId === undefined) {
        draft.step = "account"; draft.await = ""; draft.options = await accountOptions(ctx, true);
        await saveDraft(id, draft);
        await show(ctx, `🤝 MEZANA · 💸 To‘lov · ${won(draft.amount)}\nQaysi hisobdan to‘landi?`, [...optionButtons(id, draft.options, 2), cancelRow(id)], messageId);
        return;
      }
    } else {
      if (!draft.productName) return;
      if (!draft.quantity) {
        const quick = [1, 2, 3, 5, 10, 20].filter((n) => action !== "returned" || n <= (draft.available || 0));
        draft.step = "quantity"; draft.await = "quantity"; draft.options = quick.map((n) => ({ id: String(n), label: String(n), n }));
        await saveDraft(id, draft);
        await show(ctx, `🤝 MEZANA · ${draft.productName}${action === "returned" ? ` (olingan: ${draft.available || 0})` : ""}\nSonini tanlang yoki yozing:`, [...optionButtons(id, draft.options, 6), cancelRow(id)], messageId);
        return;
      }
      if (action === "purchased" && draft.catalogItemId) draft.amount = (draft.unitPrice || 0) * draft.quantity;
      if (action === "purchased" && !draft.amount) {
        draft.step = "amount"; draft.await = "amount"; draft.options = undefined;
        await saveDraft(id, draft);
        await show(ctx, `🤝 MEZANA · 🛒 ${draft.productName} · ${draft.quantity} ta\nJami summani yozing (masalan: 9000).`, [cancelRow(id)], messageId);
        return;
      }
    }
    draft.step = "confirm"; draft.await = ""; draft.options = undefined;
    await saveDraft(id, draft);
    await show(ctx, `${mezanaSummary(draft, name)}\n\nTekshiring. Tasdiqlansa hisobga yoziladi va MEZANA guruhiga yuboriladi.`, confirmRows(id), messageId);
    return;
  }
  if (draft.kind === "payment") {
    if (!draft.supplierId) return;
    if (!draft.amount) {
      draft.step = "amount"; draft.await = "amount"; draft.options = draft.debt ? [{ id: "full", label: `To‘liq: ${won(draft.debt)}`, n: draft.debt }] : undefined;
      await saveDraft(id, draft);
      await show(ctx, `💳 ${draft.supplierName}\nTo‘langan summani yozing (qarz: ${won(draft.debt || 0)}).`, [...(draft.options ? optionButtons(id, draft.options, 1) : []), cancelRow(id)], messageId);
      return;
    }
    if (draft.accountId === undefined) {
      draft.step = "account"; draft.await = ""; draft.options = await accountOptions(ctx, false);
      if (!draft.options.length) throw new AssistantError("Kassa yoki bank hisobi topilmadi.");
      await saveDraft(id, draft);
      await show(ctx, `💳 ${draft.supplierName} · ${won(draft.amount)}\nQaysi hisobdan to‘landi?`, [...optionButtons(id, draft.options, 2), cancelRow(id)], messageId);
      return;
    }
    // Tayyor reja: tasdiqlash va saqlash eski yordamchining tekshirilgan yo'li orqali (ok:/no: tugmalari).
    const { state } = await readHaloState(ctx.config.branch_id);
    const plan = buildAssistantPlan(state as Row, { kind: "payment", supplierName: draft.supplierName, accountName: draft.accountName, amount: draft.amount, date: seoulToday() }, id);
    const response = `${plan.summary}\n\nTekshiring. «Tasdiqlash» bosilmaguncha hisobga yozilmaydi. Tasdiq 15 daqiqa amal qiladi.`;
    const now = Date.now();
    const ready = await assistantDb().prepare("UPDATE halo_assistant_jobs SET status='ready',payload=?,response=?,created_at=?,updated_at=? WHERE id=? AND status='draft'")
      .bind(JSON.stringify({ plan, fingerprint: await stateFingerprint(state as Row) }), response, now, now, id).run();
    if (!ready.meta.changes) throw new AssistantError("Bu amal eskirgan yoki yakunlangan. Qaytadan boshlang.");
    await show(ctx, `${branchLine(name)}${response}`, [[{ text: "Tasdiqlash", callback_data: `ok:${id}` }, { text: "Bekor qilish", callback_data: `no:${id}` }]], messageId);
  }
}

/* ---------- saqlash ---------- */
async function saveExpense(ctx: BotContext, id: string, draft: Draft) {
  await assertV2DayOpen(ctx.config.branch_id, draft.date);
  const today = seoulToday();
  const name = (await branchName(ctx.config.branch_id)).name;
  const mutation = await mutateHaloState((state) => addExpense(state as Row, {
    operationId: id, category: draft.category, name: draft.name, note: "Telegram bot", date: draft.date, amount: draft.amount, accountId: draft.accountId,
    ...(draft.duplicate ? { duplicateReason: "Telegram botda alohida xarajat deb tasdiqlandi" } : {}),
  }, today), 5, ctx.config.branch_id, "Rahbar · Telegram bot", `Xarajat: ${String(draft.name).slice(0, 60)} · ₩${Number(draft.amount || 0).toLocaleString("en-US")}`, "Telegram bot");
  return `✅ Saqlandi${mutation.result.alreadySaved ? " (oldin yozilgan, ikkinchi marta yozilmadi)" : ""}\n${expenseSummary(draft, name)}`;
}

async function saveMezana(ctx: BotContext, id: string, draft: Draft) {
  const action = draft.action as MezanaDebtAction;
  if (action === "paid" && draft.accountId) await assertV2DayOpen(ctx.config.branch_id, draft.date);
  const today = seoulToday();
  const name = (await branchName(ctx.config.branch_id)).name;
  const mutation = await mutateHaloState((state) => {
    const out = addMezanaEntry(state as Row, {
      action, operationId: id, date: draft.date, catalogItemId: draft.catalogItemId || "", productName: draft.productName || "",
      quantity: draft.quantity, itemCount: draft.quantity, amount: draft.amount, accountId: draft.accountId || "", note: "",
    }, today);
    return { state: out.state as Row, result: out.result };
  }, 5, ctx.config.branch_id, "Rahbar · Telegram bot", `MEZANA · ${action} · ${String(draft.productName || "to‘lov").slice(0, 60)}`, "MEZANA");
  // Yozuv shu yerda saqlab bo'lindi: guruhga yuborishdagi nosozlik uni bekor qilmaydi (MEZANA sahifasidan qayta yuborish mumkin).
  let delivered = { sent: false, reason: "Telegramga yuborilmadi." };
  try { delivered = await deliverMezanaEntry(ctx.config.branch_id, mutation.result.entryId); } catch { /* sabab yuqoridagi matnda */ }
  const view = mezanaView(mutation.state as Row, today);
  return [
    `✅ Saqlandi${mutation.result.alreadySaved ? " (oldin yozilgan, ikkinchi marta yozilmadi)" : ""}`,
    mezanaSummary(draft, name),
    "",
    action === "purchased" || action === "paid" ? `MEZANA qarzi: ${won(view.debt)}` : `Hozir olib turilgan: ${view.borrowed.find((item) => item.name === draft.productName)?.quantity || 0} ta`,
    delivered.sent ? "📨 MEZANA guruhiga yuborildi" : `⚠️ Guruhga yuborilmadi: ${delivered.reason}`,
  ].join("\n");
}

/** Qoidaga ko'ra rad etilgan holatlar (rahbarga aynan shu matn ko'rsatiladi). Boshqa xatolar — nosozlik. */
function friendly(error: unknown): string | null {
  if (error instanceof EntryError || error instanceof MezanaError || error instanceof ClosedDayError || error instanceof MezanaPostingError || error instanceof AssistantError) return error.message;
  return null;
}

/* ---------- tugma bosilishi ---------- */
async function onChoice(ctx: BotContext, id: string, value: string, messageId: number) {
  const draft = await loadDraft(ctx, id);
  if (!draft) {
    await show(ctx, "Bu amal eskirgan yoki yakunlangan. Kerak bo‘lsa pastdagi tugma bilan qaytadan boshlang.", [], messageId);
    return;
  }
  if (value === "no") {
    await closeDraft(id, "cancelled", "Bekor qilindi. Hisobga yozilmadi.");
    await show(ctx, "Bekor qilindi. Hisobga hech narsa yozilmadi.", [], messageId);
    return;
  }
  if (value === "ok" || value === "dup") {
    if (draft.step !== "confirm") return;
    if (value === "dup") draft.duplicate = true;
    let saved = "";
    try {
      saved = draft.kind === "expense" ? await saveExpense(ctx, id, draft) : await saveMezana(ctx, id, draft);
    } catch (error) {
      if (error instanceof EntryError && error.code === "DUPLICATE" && draft.kind === "expense") {
        await show(ctx, `${expenseSummary(draft, "")}\n\n⚠️ ${error.message.replace(" Bu boshqa xarajat bo‘lsa, sababini yozing.", "")}\nBu haqiqatan alohida xarajatmi?`,
          [[{ text: "Ha, bu boshqa xarajat", callback_data: code(id, "dup") }, { text: "✖ Bekor qilish", callback_data: code(id, "no") }]], messageId);
        return;
      }
      const message = friendly(error);
      if (!message) {
        // Nosozlik (aloqa, baza band): yozuv saqlangani noma'lum. Qoralama ochiq qoladi — qayta bosish xavfsiz,
        // chunki amal raqami o'sha: saqlangan bo'lsa ikkinchi marta yozilmaydi.
        const summary = draft.kind === "expense" ? expenseSummary(draft, "") : mezanaSummary(draft, "");
        await show(ctx, `${summary}\n\n⚠️ ${error instanceof HaloStateConflictError ? "Ma’lumot shu paytda boshqa joyda yangilandi." : "Javob kelmadi."} «Tasdiqlash»ni yana bir marta bosing — yozuv ikki marta yozilmaydi.`, confirmRows(id), messageId);
        if (!(error instanceof HaloStateConflictError)) console.error("halo_bot_save_error", error instanceof Error ? error.name : "error");
        return;
      }
      await closeDraft(id, "error", message);
      await show(ctx, `❌ Saqlanmadi: ${message}`, [], messageId);
      return;
    }
    // Shu yerdan boshlab yozuv saqlangan: javobni yetkazishdagi nosozlik "saqlanmadi" deb ko'rsatilmasin.
    await closeDraft(id, "done", saved);
    try { await show(ctx, saved, [], messageId); } catch { /* Telegram javob bermadi; yozuv saytda ko'rinadi */ }
    return;
  }
  const picked = /^c(\d{1,2})$/.test(value) ? (draft.options || [])[Number(value.slice(1))] : undefined;
  if (!picked) return;

  if (draft.kind === "export") {
    if (draft.step === "kind") {
      draft.exportKind = picked.id;
      // Qarz va ombor qoldig'i — doim hozirgi holat; qolganlari uchun davr so'raladi.
      if (picked.id !== "suppliers" && picked.id !== "inventory") {
        const today = seoulToday(), monthStart = `${today.slice(0, 7)}-01`;
        const lastEnd = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        draft.step = "period";
        draft.options = [
          { id: `${monthStart}|${today}`, label: `Shu oy (${dm(monthStart)} — ${dm(today)})` },
          { id: `${lastEnd.slice(0, 7)}-01|${lastEnd}`, label: `O‘tgan oy (${lastEnd.slice(0, 7)})` },
          { id: "|", label: "Hamma yozuvlar" },
        ];
        await saveDraft(id, draft);
        await show(ctx, `📁 ${picked.label}\nQaysi davr?`, [...optionButtons(id, draft.options, 1), cancelRow(id)], messageId);
        return;
      }
    }
    const [from = "", to = ""] = draft.step === "period" ? picked.id.split("|") : [];
    const kind = String(draft.exportKind || "");
    await closeDraft(id, "done", `Eksport: ${kind}`);
    await show(ctx, `📁 ${exportKinds[kind as keyof typeof exportKinds] || kind} — fayl tayyorlanmoqda…`, [], messageId);
    await sendExport(ctx, kind, from, to);
    return;
  }
  if (draft.kind === "branch") {
    const { branches } = await branchName(ctx.config.branch_id);
    const branch = branches.find((item) => item.id === picked.id);
    if (!branch) throw new AssistantError("Filial topilmadi.");
    await assistantDb().prepare("UPDATE halo_assistant_config SET branch_id=? WHERE id='main' AND generation=? AND enabled=1").bind(branch.id, ctx.config.generation).run();
    await closeDraft(id, "done", `Filial: ${branch.name}`);
    await show(ctx, `🏪 Filial: ${branch.name}\nEndi hamma ma’lumot va kiritma shu filial bo‘yicha.`, [], messageId);
    return;
  }
  if (draft.kind === "expense") {
    if (draft.step === "category") draft.category = picked.id;
    else if (draft.step === "account") { draft.accountId = picked.id; draft.accountName = picked.label; }
    else return;
  } else if (draft.kind === "mezana") {
    if (draft.step === "action") {
      const action = picked.id as MezanaDebtAction;
      const { state } = await readHaloState(ctx.config.branch_id);
      const view = mezanaView(state as Row, seoulToday());
      draft.action = action;
      if (action === "paid") {
        draft.debt = view.debt;
        if (!(view.debt > 0)) throw new AssistantError("MEZANA’ga qarz yo‘q — to‘lov kiritib bo‘lmaydi.");
      } else {
        const options: Option[] = action === "returned"
          ? view.borrowed.map((item) => ({ id: view.catalog.find((entry) => entry.mode === "borrowed" && entry.name === item.name)?.id || "", label: `${item.name} (olingan: ${item.quantity})`, n: item.quantity }))
          : view.catalog.filter((item) => item.mode === (action === "purchased" ? "purchased" : "borrowed"))
            .map((item) => ({ id: item.id, label: action === "purchased" ? `${item.name} · ${won(item.price)}` : item.name, n: item.price }));
        if (action === "returned" && !options.length) throw new AssistantError("Qaytariladigan olib turilgan mahsulot yo‘q.");
        // Nom tugmada qisqarishi mumkin, shuning uchun to'liq nom alohida saqlanadi.
        const names = action === "returned" ? view.borrowed.map((item) => item.name) : view.catalog.filter((item) => item.mode === (action === "purchased" ? "purchased" : "borrowed")).map((item) => item.name);
        draft.options = [...options.slice(0, 30).map((option, index) => ({ ...option, id: `${option.id}\u0000${names[index]}` })), ...(action === "returned" ? [] : [{ id: "\u0000", label: "✏️ Boshqa (nomini yozaman)" }])];
        draft.step = "product"; draft.await = "";
        await saveDraft(id, draft);
        await show(ctx, `🤝 MEZANA · ${picked.label}\nMahsulotni tanlang:`, [...optionButtons(id, draft.options, 2), cancelRow(id)], messageId);
        return;
      }
    } else if (draft.step === "product") {
      const [catalogItemId, fullName] = picked.id.split("\u0000");
      if (!fullName) {
        draft.step = "productName"; draft.await = "product"; draft.options = undefined;
        await saveDraft(id, draft);
        await show(ctx, "🤝 MEZANA\nMahsulot nomini yozing:", [cancelRow(id)], messageId);
        return;
      }
      draft.catalogItemId = catalogItemId; draft.productName = fullName;
      if (draft.action === "returned") draft.available = picked.n || 0;
      if (draft.action === "purchased") draft.unitPrice = picked.n || 0;
    } else if (draft.step === "quantity") {
      draft.quantity = picked.n;
    } else if (draft.step === "amount") {
      draft.amount = picked.n;
    } else if (draft.step === "account") {
      draft.accountId = picked.id; draft.accountName = picked.id ? picked.label : "";
    } else return;
  } else if (draft.kind === "payment") {
    if (draft.step === "supplier") {
      const { state } = await readHaloState(ctx.config.branch_id);
      const supplier = rows((state as Row).suppliers).find((item) => item.id === picked.id);
      if (!supplier) throw new AssistantError("Yetkazib beruvchi topilmadi.");
      draft.supplierId = picked.id; draft.supplierName = String(supplier.name); draft.debt = Math.round(Number(supplier.balance) || 0);
      if (!(draft.debt > 0)) throw new AssistantError(`${draft.supplierName}ga qarz yo‘q.`);
    }
    else if (draft.step === "amount") draft.amount = picked.n;
    else if (draft.step === "account") { draft.accountId = picked.id; draft.accountName = picked.label; }
    else return;
  }
  await advance(ctx, id, draft, messageId);
}

/* ---------- matnli javob (summa, nom, son) ---------- */
async function onText(ctx: BotContext, id: string, draft: Draft, text: string) {
  if (draft.await === "amount") {
    const parsed = parseAmount(text);
    if (!parsed) { await ctx.api("sendMessage", { chat_id: ctx.chat, text: "Summani butun vonda, faqat raqam bilan yozing. Masalan: 45000 yoki 45 ming. To‘xtatish: «bekor»." }); return; }
    if ((draft.kind === "payment" || (draft.kind === "mezana" && draft.action === "paid")) && draft.debt && parsed.amount > draft.debt) {
      await ctx.api("sendMessage", { chat_id: ctx.chat, text: `To‘lov qarzdan katta bo‘lmasin. Qarz: ${won(draft.debt)}.` }); return;
    }
    draft.amount = parsed.amount;
    if (draft.kind === "expense" && parsed.rest && !draft.name) draft.name = parsed.rest;
  } else if (draft.await === "name") {
    const name = text.replace(/\s+/g, " ").slice(0, 140);
    if (name.length < 2) { await ctx.api("sendMessage", { chat_id: ctx.chat, text: "Nima uchun to‘langanini qisqa yozing (masalan: gaz balloni)." }); return; }
    draft.name = name;
  } else if (draft.await === "product") {
    const name = text.replace(/\s+/g, " ").slice(0, 140);
    if (name.length < 2) { await ctx.api("sendMessage", { chat_id: ctx.chat, text: "Mahsulot nomini yozing (masalan: Lavash)." }); return; }
    draft.productName = name; draft.catalogItemId = "";
  } else if (draft.await === "quantity") {
    const quantity = parseQuantity(text);
    if (!quantity) { await ctx.api("sendMessage", { chat_id: ctx.chat, text: "Sonini butun raqam bilan yozing (masalan: 5)." }); return; }
    if (draft.action === "returned" && quantity > (draft.available || 0)) { await ctx.api("sendMessage", { chat_id: ctx.chat, text: `${draft.productName}dan faqat ${draft.available || 0} ta olib turilgan.` }); return; }
    draft.quantity = quantity;
  } else return;
  await advance(ctx, id, draft);
}

/**
 * Yangi saytdagi bot yangilanishini qayta ishlaydi. true — javob berildi; false — eski yordamchiga
 * qoldiriladi (Qarzlar, Ombor, Eksport, erkin matn va uning Tasdiqlash/Bekor tugmalari).
 */
export async function handleBotUpdate(ctx: BotContext): Promise<boolean> {
  const callback = ctx.update.callback_query as Row | undefined;
  try {
    if (callback) {
      const match = String(callback.data || "").match(/^v:([a-f0-9-]{36}):([a-z0-9]{1,6})$/);
      if (!match) return false;
      try { await ctx.api("answerCallbackQuery", { callback_query_id: callback.id }); } catch { /* muddati o'tgan tugma javobi amalni to'xtatmasin */ }
      await onChoice(ctx, match[1], match[2], Number((callback.message as Row | undefined)?.message_id) || 0);
      return true;
    }
    if (!ctx.update.message) return false;
    const text = ctx.text;
    const b = BOT_BUTTONS;
    const say = (body: string, extra: Row = {}) => ctx.api("sendMessage", { chat_id: ctx.chat, text: body, ...extra });
    const waiting = text ? await waitingDraft(ctx) : null;
    if (/^\/?bekor$/i.test(text)) {
      if (waiting) await closeDraft(waiting.id, "cancelled", "Bekor qilindi. Hisobga yozilmadi.");
      await say(waiting ? "Bekor qilindi. Hisobga hech narsa yozilmadi." : "Bekor qilinadigan amal yo‘q.");
      return true;
    }
    if (waiting && waiting.draft.await && text && !isCommand(text)) {
      await onText(ctx, waiting.id, waiting.draft, text);
      return true;
    }
    // Boshqa buyruq keldi: kutib turgan qoralama jim yopiladi (hech narsa yozilmagan edi).
    if (waiting && text && isCommand(text)) await closeDraft(waiting.id, "cancelled", "Boshqa buyruq yuborildi.");

    if (/^\/(start|help)$/i.test(text) || /^yordam$/i.test(text)) {
      await say(helpText(Boolean(globalThis.__HALO_ASSISTANT_AI__?.key)), { reply_markup: botKeyboard((await branchName(ctx.config.branch_id)).count) });
      return true;
    }
    if (text === b.today) { await say(await todayInfo(ctx)); return true; }
    if (text === b.cash) { await say(await cashInfo(ctx)); return true; }
    if (text === b.mezana) { await say(await mezanaInfo(ctx)); return true; }
    if (text === b.branch) { await startBranch(ctx); return true; }
    if (text === b.export) { await startExport(ctx); return true; }
    if (text === b.expense) { await startExpense(ctx); return true; }
    if (text === b.addMezana) { await startMezana(ctx); return true; }
    if (text === b.payment) { await startPayment(ctx); return true; }
    const quick = text.match(/^\/?xarajat\s+(.+)$/i);
    if (quick) {
      const parsed = parseAmount(quick[1]);
      if (!parsed) { await say("Yozilishi: xarajat 45000 gaz balloni (avval summa, keyin nima uchun)."); return true; }
      await startExpense(ctx, parsed);
      return true;
    }
    return false;
  } catch (error) {
    const message = friendly(error) || (error instanceof HaloStateConflictError ? "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." : null);
    try {
      await ctx.api("sendMessage", { chat_id: ctx.chat, text: message ? `❌ ${message}` : "Xatolik yuz berdi. Bir ozdan keyin qayta urinib ko‘ring." });
    } catch { /* Telegram javob bermasa ham webhook qayta-qayta chaqirilmasin */ }
    if (!message) console.error("halo_bot_error", error instanceof Error ? error.name : "error");
    return true;
  }
}
