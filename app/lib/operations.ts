import { seoulClock, seoulOperationDate } from "./business-time.ts";
import { normalizeWorkShifts } from "./payroll.ts";
import { isMezanaSupplierName } from "./mezana-debts.ts";

export type OperationPhase = "opening" | "closing";
export type OperationSeverity = "critical" | "warning" | "info";

export type OperationChecklistItem = {
  id: string;
  phase: OperationPhase;
  title: string;
  detail: string;
};

export type OperationCompletion = {
  itemId: string;
  phase: OperationPhase;
  completedBy: string;
  completedByWorkerId: string;
  completedAt: string;
};

export type OperationChecklistDay = {
  id: string;
  date: string;
  completions: OperationCompletion[];
  updatedAt: string;
};

export type OperationChecklistViewItem = OperationChecklistItem & {
  completed: boolean;
  completion: OperationCompletion | null;
};

export type OperationChecklistPhaseView = {
  phase: OperationPhase;
  title: string;
  subtitle: string;
  completed: number;
  total: number;
  items: OperationChecklistViewItem[];
};

export type OperationChecklistView = {
  date: string;
  completed: number;
  total: number;
  percent: number;
  phases: OperationChecklistPhaseView[];
  updatedAt: string;
};

export type OperationAlert = {
  id: string;
  severity: OperationSeverity;
  title: string;
  detail: string;
  href: string;
};

export const OPERATION_CHECKLIST_ITEMS: OperationChecklistItem[] = [
  {
    id: "opening-hygiene",
    phase: "opening",
    title: "Oshxona, qo‘l va forma tozaligi",
    detail: "Ish joyi, xodim formasi va qo‘l gigiyenasi tekshirildi.",
  },
  {
    id: "opening-cold-storage",
    phase: "opening",
    title: "Muzlatkich va muzxona",
    detail: "Harorat, eshiklar va mahsulot saqlanish holati tekshirildi.",
  },
  {
    id: "opening-equipment",
    phase: "opening",
    title: "Gaz, elektr va uskunalar",
    detail: "Gaz, elektr, fryer, kebab va boshqa uskunalar ishga tayyor.",
  },
  {
    id: "opening-stock",
    phase: "opening",
    title: "Mahsulot va qadoqlar tayyor",
    detail: "Muhim mahsulotlar, souslar va qadoqlar yetarli.",
  },
  {
    id: "opening-pos",
    phase: "opening",
    title: "Kassa va POS tayyor",
    detail: "Naqd kassa, terminal va POS tizimi tekshirildi.",
  },
  {
    id: "opening-guest-area",
    phase: "opening",
    title: "Mijoz va kuryer hududi",
    detail: "Kirish, kutish va topshirish joyi toza va tartibli.",
  },
  {
    id: "closing-sales",
    phase: "closing",
    title: "Savdo va xarajatlar kiritildi",
    detail: "POS savdosi, tushum va kunlik xarajatlar tizimga kiritildi.",
  },
  {
    id: "closing-waste",
    phase: "closing",
    title: "Chiqindi va kamomad kiritildi",
    detail: "Buzilgan, yo‘qolgan yoki kam chiqqan mahsulotlar qayd qilindi.",
  },
  {
    id: "closing-low-stock",
    phase: "closing",
    title: "Kam qolgan mahsulotlar qayd qilindi",
    detail: "Ertangi xarid uchun kam qolgan mahsulotlar tekshirildi.",
  },
  {
    id: "closing-cleaning",
    phase: "closing",
    title: "Oshxona va uskunalar tozalandi",
    detail: "Ish stollari, pol, fryer va boshqa uskunalar tozalandi.",
  },
  {
    id: "closing-safety",
    phase: "closing",
    title: "Gaz, elektr va sovutkich xavfsiz",
    detail: "Keraksiz gaz/elektr o‘chirildi, sovutkich eshiklari yopiq.",
  },
  {
    id: "closing-cash",
    phase: "closing",
    title: "Kassa sanaldi va kun yopildi",
    detail: "Kassa qoldig‘i tekshirildi va kunlik yopilish bajarildi.",
  },
];

const ITEM_BY_ID = new Map(OPERATION_CHECKLIST_ITEMS.map((item) => [item.id, item]));
const DAILY_CLOSE_ITEM_ID = "closing-cash";

function cleanDate(value: unknown) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function safeText(value: unknown, max: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function isDerivedOperationChecklistItem(itemId: unknown) {
  return String(itemId || "") === DAILY_CLOSE_ITEM_ID;
}

export function dailyCloseHref(date: string) {
  const safeDate = cleanDate(date) || seoulOperationDate();
  return `/?tab=finance&date=${encodeURIComponent(safeDate)}#daily-close`;
}

function dailyCloseCompletion(value: unknown, date: string): OperationCompletion | null {
  if (!Array.isArray(value)) return null;
  const close = value.find((entry) => (
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && cleanDate((entry as Record<string, unknown>).date) === date
  ));
  if (!close || typeof close !== "object" || Array.isArray(close)) return null;
  const closedAt = safeText((close as Record<string, unknown>).closedAt, 40);
  if (!Number.isFinite(Date.parse(closedAt))) return null;
  return {
    itemId: DAILY_CLOSE_ITEM_ID,
    phase: "closing",
    completedBy: safeText((close as Record<string, unknown>).closedBy, 60) || "HALO Control",
    completedByWorkerId: "",
    completedAt: closedAt,
  };
}

export function normalizeOperationChecklistDays(value: unknown): OperationChecklistDay[] {
  if (!Array.isArray(value)) return [];
  const seenDates = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const day = entry as Record<string, unknown>;
    const date = cleanDate(day.date);
    if (!date || seenDates.has(date)) return [];
    seenDates.add(date);
    const seenItems = new Set<string>();
    const completions = (Array.isArray(day.completions) ? day.completions : []).flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const completion = raw as Record<string, unknown>;
      const itemId = safeText(completion.itemId, 60);
      const item = ITEM_BY_ID.get(itemId);
      const completedAt = safeText(completion.completedAt, 40);
      if (!item || seenItems.has(itemId) || !Number.isFinite(Date.parse(completedAt))) return [];
      seenItems.add(itemId);
      return [{
        itemId,
        phase: item.phase,
        completedBy: safeText(completion.completedBy, 60) || "Rahbar",
        completedByWorkerId: safeText(completion.completedByWorkerId, 80),
        completedAt,
      } satisfies OperationCompletion];
    });
    return [{
      id: safeText(day.id, 100) || `operations-${date}`,
      date,
      completions,
      updatedAt: safeText(day.updatedAt, 40) || completions.at(-1)?.completedAt || "",
    }];
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 400);
}

export function validOperationChecklistDays(value: unknown) {
  if (!Array.isArray(value) || value.length > 400) return false;
  return normalizeOperationChecklistDays(value).length === value.length;
}

export function operationChecklistView(
  value: unknown,
  date: string,
  dailyCloses: unknown = [],
): OperationChecklistView {
  const safeDate = cleanDate(date) || seoulOperationDate();
  const day = normalizeOperationChecklistDays(value).find((entry) => entry.date === safeDate);
  const completionById = new Map((day?.completions || []).map((entry) => [entry.itemId, entry]));
  const closeCompletion = dailyCloseCompletion(dailyCloses, safeDate);
  const phases: OperationChecklistPhaseView[] = (["opening", "closing"] as const).map((phase) => {
    const items = OPERATION_CHECKLIST_ITEMS.filter((item) => item.phase === phase).map((item) => {
      const completion = isDerivedOperationChecklistItem(item.id)
        ? closeCompletion
        : completionById.get(item.id) || null;
      return {
        ...item,
        completed: Boolean(completion),
        completion,
      };
    });
    return {
      phase,
      title: phase === "opening" ? "OCHILISH NAZORATI" : "YOPILISH NAZORATI",
      subtitle: phase === "opening" ? "Smena boshlanishidan oldin" : "Do‘kon yopilishidan oldin",
      completed: items.filter((item) => item.completed).length,
      total: items.length,
      items,
    };
  });
  const completed = phases.reduce((sum, phase) => sum + phase.completed, 0);
  const total = phases.reduce((sum, phase) => sum + phase.total, 0);
  return {
    date: safeDate,
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    phases,
    updatedAt: [day?.updatedAt || "", closeCompletion?.completedAt || ""].sort().at(-1) || "",
  };
}

export function applyOperationCompletion(
  value: unknown,
  input: {
    date: string;
    itemId: string;
    completed: boolean;
    actor: string;
    workerId?: string;
    now?: Date;
  },
) {
  const date = cleanDate(input.date);
  const item = ITEM_BY_ID.get(input.itemId);
  if (!date || !item) throw new Error("Noto‘g‘ri nazorat bandi.");
  const days = normalizeOperationChecklistDays(value);
  const nowIso = (input.now || new Date()).toISOString();
  const existing = days.find((entry) => entry.date === date) || {
    id: `operations-${date}`,
    date,
    completions: [],
    updatedAt: nowIso,
  };
  const withoutItem = existing.completions.filter((entry) => entry.itemId !== item.id);
  const completions = input.completed
    ? [...withoutItem, {
      itemId: item.id,
      phase: item.phase,
      completedBy: safeText(input.actor, 60) || "Rahbar",
      completedByWorkerId: safeText(input.workerId, 80),
      completedAt: nowIso,
    } satisfies OperationCompletion]
    : withoutItem;
  const nextDay: OperationChecklistDay = { ...existing, completions, updatedAt: nowIso };
  return [nextDay, ...days.filter((entry) => entry.date !== date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 400);
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function buildOperationAlerts(
  state: Record<string, unknown>,
  date = seoulOperationDate(),
  now = new Date(),
): OperationAlert[] {
  const alerts: OperationAlert[] = [];
  const checklist = operationChecklistView(state.operationChecklistDays, date, state.dailyCloses);
  const clock = seoulClock(now);
  const isCurrentBusinessDay = date === seoulOperationDate(now);
  const opening = checklist.phases.find((phase) => phase.phase === "opening")!;
  const closing = checklist.phases.find((phase) => phase.phase === "closing")!;

  if (isCurrentBusinessDay && clock >= "12:30" && opening.completed < opening.total) {
    alerts.push({
      id: "opening-incomplete",
      severity: "critical",
      title: `Ochilish nazorati tugamagan: ${opening.completed}/${opening.total}`,
      detail: "Smena boshlangan. Qolgan ochilish bandlarini hozir tekshiring.",
      href: "#opening",
    });
  }
  if (isCurrentBusinessDay && clock >= "00:15" && clock < "12:00" && closing.completed < closing.total) {
    alerts.push({
      id: "closing-incomplete",
      severity: "critical",
      title: `Yopilish nazorati tugamagan: ${closing.completed}/${closing.total}`,
      detail: "Ish kuni yakunlangan. Qolgan yopilish bandlarini tekshiring.",
      href: "#closing",
    });
  }

  const longOpenShifts = normalizeWorkShifts(state.workShifts).filter((shift) => (
    shift.status === "open" && now.getTime() - Date.parse(shift.clockIn) > 13 * 60 * 60_000
  ));
  if (longOpenShifts.length) {
    alerts.push({
      id: "long-open-shifts",
      severity: "critical",
      title: `${longOpenShifts.length} ta smena 13 soatdan oshgan`,
      detail: "Hodim ishni tugatishni unutgan bo‘lishi mumkin. Davomatni tekshiring.",
      href: "/davomat",
    });
  }

  const lowStock = (Array.isArray(state.inventory) ? state.inventory : []).filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    const minimum = finiteNumber(item.minStock);
    return minimum > 0 && finiteNumber(item.stock) <= minimum;
  });
  if (lowStock.length) {
    const names = lowStock.slice(0, 3).map((entry) => safeText((entry as Record<string, unknown>).name, 40)).filter(Boolean);
    alerts.push({
      id: "low-stock",
      severity: "warning",
      title: `${lowStock.length} ta mahsulot kamaygan`,
      detail: names.length ? `${names.join(", ")}${lowStock.length > names.length ? " va boshqalar" : ""}.` : "Ombordagi minimal qoldiqni tekshiring.",
      href: "/?tab=inventory",
    });
  }

  const supplierDebt = (Array.isArray(state.suppliers) ? state.suppliers : []).reduce((sum, entry) => {
    if (!entry || typeof entry !== "object") return sum;
    const supplier = entry as Record<string, unknown>;
    if (isMezanaSupplierName(supplier.name)) return sum;
    return sum + Math.max(0, finiteNumber(supplier.balance));
  }, 0);
  if (supplierDebt > 0) {
    alerts.push({
      id: "supplier-debt",
      severity: "warning",
      title: "Yetkazib beruvchidan qarz bor",
      detail: `Jami qarz: ₩${Math.round(supplierDebt).toLocaleString("en-US")}.`,
      href: "/?tab=suppliers",
    });
  }

  const close = (Array.isArray(state.dailyCloses) ? state.dailyCloses : []).find((entry) => (
    entry && typeof entry === "object" && (entry as Record<string, unknown>).date === date
  )) as Record<string, unknown> | undefined;
  if (close && Math.abs(finiteNumber(close.difference)) >= 1) {
    alerts.push({
      id: "cash-difference",
      severity: "critical",
      title: "Kassa farqi aniqlandi",
      detail: `Kunlik yopilish farqi: ₩${Math.round(finiteNumber(close.difference)).toLocaleString("en-US")}.`,
      href: dailyCloseHref(date),
    });
  }

  return alerts;
}
