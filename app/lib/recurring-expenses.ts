export type RecurringExpenseTemplate = {
  id: string;
  name: string;
  category: string;
  amount: number;
  accountId: string;
  frequency: "daily" | "weekly" | "monthly";
  nextDue: string;
  active: boolean;
  lastPaidDate?: string;
  automatic?: boolean;
  billingDay?: number;
};

export type RecurringFinancialEntry = {
  id: string;
  type: "income" | "expense" | "transfer";
  category: string;
  amount: number;
  date: string;
  accountId: string;
  toAccountId?: string;
  note: string;
  affectsProfit: boolean;
  reversedEntryId?: string;
  transactionId?: string;
  payrollPaymentId?: string;
  fixedExpenseId?: string;
  fixedExpenseDueDate?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
};

type DateParts = { year: number; month: number; day: number };

const dateParts = (value: string): DateParts | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
};

const daysInMonth = (year: number, month: number) => (
  new Date(Date.UTC(year, month, 0)).getUTCDate()
);

const formatDate = ({ year, month, day }: DateParts) => (
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
);

export const recurringExpenseEntryId = (templateId: string, dueDate: string) => (
  `fixed-expense:${templateId}:${dueDate}`
);

const normalizedIdentityPart = (value: unknown) => String(value ?? "")
  .trim()
  .toLocaleLowerCase("uz-UZ")
  .replace(/\s+/g, " ");

export const recurringExpenseTemplateIdentity = (
  template: Pick<RecurringExpenseTemplate, "name" | "category" | "accountId">,
) => [
  normalizedIdentityPart(template.name),
  normalizedIdentityPart(template.category),
  normalizedIdentityPart(template.accountId),
].join("|");

const recurringEntryMonth = (entry: RecurringFinancialEntry) => {
  const date = String(entry.fixedExpenseDueDate || entry.date || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : "";
};

export function repairRecurringExpenseDuplicates({
  fixedExpenses,
  financialEntries,
  repairedAt = new Date().toISOString(),
}: {
  fixedExpenses: RecurringExpenseTemplate[];
  financialEntries: RecurringFinancialEntry[];
  repairedAt?: string;
}) {
  const canonicalTemplateByIdentity = new Map<string, RecurringExpenseTemplate>();
  const canonicalTemplateId = new Map<string, string>();
  let stoppedTemplates = 0;
  const nextTemplates = fixedExpenses.map((template) => {
    const identity = recurringExpenseTemplateIdentity(template);
    const eligible = template.active
      && template.automatic === true
      && template.frequency === "monthly"
      && Boolean(template.id && template.name.trim() && template.category.trim() && template.accountId);
    if (!eligible) {
      if (template.id) canonicalTemplateId.set(template.id, template.id);
      return template;
    }
    const canonical = canonicalTemplateByIdentity.get(identity);
    if (!canonical) {
      canonicalTemplateByIdentity.set(identity, template);
      canonicalTemplateId.set(template.id, template.id);
      return template;
    }
    canonicalTemplateId.set(template.id, canonical.id);
    stoppedTemplates += 1;
    return { ...template, active: false, automatic: false };
  });

  const templateById = new Map(fixedExpenses.map((template) => [template.id, template]));
  const reversedIds = new Set(financialEntries.flatMap((entry) => (
    entry.reversedEntryId ? [entry.reversedEntryId] : []
  )));
  const activeRecurringEntries = financialEntries.flatMap((entry, index) => (
    entry.type === "expense"
      && entry.id
      && entry.fixedExpenseId
      && recurringEntryMonth(entry)
      && !entry.reversedEntryId
      && !reversedIds.has(entry.id)
      ? [{ entry, index }]
      : []
  ));
  const entriesByCycle = new Map<string, typeof activeRecurringEntries>();
  activeRecurringEntries.forEach((candidate) => {
    const template = templateById.get(candidate.entry.fixedExpenseId!);
    const identity = template
      ? recurringExpenseTemplateIdentity(template)
      : `id:${candidate.entry.fixedExpenseId}`;
    const key = `${identity}|${recurringEntryMonth(candidate.entry)}`;
    entriesByCycle.set(key, [...(entriesByCycle.get(key) || []), candidate]);
  });

  const duplicateEntries: RecurringFinancialEntry[] = [];
  entriesByCycle.forEach((candidates) => {
    if (candidates.length <= 1) return;
    const ranked = candidates.slice().sort((left, right) => {
      const leftCanonical = canonicalTemplateId.get(left.entry.fixedExpenseId!) || left.entry.fixedExpenseId!;
      const rightCanonical = canonicalTemplateId.get(right.entry.fixedExpenseId!) || right.entry.fixedExpenseId!;
      const leftIsCanonical = Number(left.entry.fixedExpenseId === leftCanonical);
      const rightIsCanonical = Number(right.entry.fixedExpenseId === rightCanonical);
      return rightIsCanonical - leftIsCanonical
        || String(right.entry.date).localeCompare(String(left.entry.date))
        || left.index - right.index;
    });
    ranked.slice(1).forEach(({ entry }) => {
      const reversalId = `fixed-expense-duplicate-reversal:${entry.id}`;
      if (financialEntries.some((candidate) => candidate.id === reversalId)) return;
      duplicateEntries.push({
        id: reversalId,
        type: "income",
        category: entry.category,
        amount: entry.amount,
        date: entry.date,
        accountId: entry.accountId,
        note: `BEKOR QILINDI · bir oyda takrorlangan avtomatik xarajat · ${entry.note || entry.category}`,
        affectsProfit: true,
        reversedEntryId: entry.id,
        cancellationReason: "Bir oyda takrorlangan avtomatik xarajat",
        cancelledAt: repairedAt,
        cancelledBy: "HALO Control",
      });
    });
  });

  return {
    fixedExpenses: nextTemplates,
    financialEntries: [...duplicateEntries, ...financialEntries],
    stoppedTemplates,
    reversedEntries: duplicateEntries.length,
    changed: stoppedTemplates > 0 || duplicateEntries.length > 0,
  };
}

export const canAutomateRecurringExpenseCategory = (category: string) => {
  const normalized = category.trim().toLowerCase();
  return normalized !== "mahsulot xaridi"
    && !normalized.includes("maosh")
    && !normalized.includes("avans");
};

export function nextRecurringExpenseDate(value: string, billingDay: number) {
  const current = dateParts(value);
  if (!current) return "";
  const anchor = Number.isInteger(billingDay) && billingDay >= 1 && billingDay <= 31
    ? billingDay
    : current.day;
  const nextMonth = current.month === 12 ? 1 : current.month + 1;
  const nextYear = current.month === 12 ? current.year + 1 : current.year;
  return formatDate({
    year: nextYear,
    month: nextMonth,
    day: Math.min(anchor, daysInMonth(nextYear, nextMonth)),
  });
}

export function nextRecurringExpenseDateAfter(value: string, billingDay: number, throughDate: string) {
  if (!dateParts(value) || !dateParts(throughDate)) return value;
  let nextDue = value;
  let guard = 0;
  while (nextDue <= throughDate && guard < 240) {
    const advanced = nextRecurringExpenseDate(nextDue, billingDay);
    if (!advanced || advanced <= nextDue) break;
    nextDue = advanced;
    guard += 1;
  }
  return nextDue;
}

export function materializeRecurringExpenses({
  fixedExpenses,
  financialEntries,
  throughDate,
}: {
  fixedExpenses: RecurringExpenseTemplate[];
  financialEntries: RecurringFinancialEntry[];
  throughDate: string;
}) {
  if (!dateParts(throughDate)) {
    return { fixedExpenses, financialEntries, createdEntries: [] as RecurringFinancialEntry[], changed: false };
  }

  const existingIds = new Set(financialEntries.map((entry) => entry.id));
  const existingCycles = new Set(financialEntries.flatMap((entry) => (
    entry.fixedExpenseId && entry.fixedExpenseDueDate
      ? [`${entry.fixedExpenseId}:${entry.fixedExpenseDueDate}`]
      : []
  )));
  const createdEntries: RecurringFinancialEntry[] = [];
  let templatesChanged = false;

  const nextTemplates = fixedExpenses.map((template) => {
    if (
      !template.active
      || template.automatic !== true
      || template.frequency !== "monthly"
      || !template.id
      || typeof template.name !== "string"
      || !template.name.trim()
      || typeof template.category !== "string"
      || !template.accountId
      || !Number.isFinite(template.amount)
      || template.amount <= 0
      || !canAutomateRecurringExpenseCategory(template.category)
    ) return template;
    const dueParts = dateParts(template.nextDue);
    if (!dueParts) return template;
    const billingDay = Number.isInteger(template.billingDay)
      && Number(template.billingDay) >= 1
      && Number(template.billingDay) <= 31
      ? Number(template.billingDay)
      : dueParts.day;
    let dueDate = template.nextDue;
    let lastCalculatedDate = template.lastPaidDate || "";
    let guard = 0;
    while (dueDate <= throughDate && guard < 240) {
      const entryId = recurringExpenseEntryId(template.id, dueDate);
      const cycleKey = `${template.id}:${dueDate}`;
      if (!existingIds.has(entryId) && !existingCycles.has(cycleKey)) {
        const entry: RecurringFinancialEntry = {
          id: entryId,
          type: "expense",
          category: template.category,
          amount: template.amount,
          date: dueDate,
          accountId: template.accountId,
          note: `Avtomatik oylik xarajat · ${template.name}`,
          affectsProfit: true,
          fixedExpenseId: template.id,
          fixedExpenseDueDate: dueDate,
        };
        createdEntries.push(entry);
        existingIds.add(entryId);
        existingCycles.add(cycleKey);
      }
      lastCalculatedDate = dueDate;
      const nextDue = nextRecurringExpenseDate(dueDate, billingDay);
      if (!nextDue || nextDue <= dueDate) break;
      dueDate = nextDue;
      guard += 1;
    }
    const nextTemplate = {
      ...template,
      billingDay,
      nextDue: dueDate,
      ...(lastCalculatedDate ? { lastPaidDate: lastCalculatedDate } : {}),
    };
    if (JSON.stringify(nextTemplate) !== JSON.stringify(template)) templatesChanged = true;
    return nextTemplate;
  });

  createdEntries.sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  return {
    fixedExpenses: nextTemplates,
    financialEntries: [...createdEntries, ...financialEntries],
    createdEntries,
    changed: templatesChanged || createdEntries.length > 0,
  };
}

export function validRecurringExpenseMetadata(fixedExpenses: unknown, financialEntries: unknown) {
  if (!Array.isArray(fixedExpenses) || !Array.isArray(financialEntries)) return false;
  const templateIds = new Set<string>();
  const templateIdentityById = new Map<string, string>();
  const activeMonthlyIdentities = new Set<string>();
  for (const raw of fixedExpenses) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const template = raw as Record<string, unknown>;
    const templateId = String(template.id || "").trim();
    if (!templateId || templateIds.has(templateId)) return false;
    templateIds.add(templateId);
    if (template.automatic !== undefined && typeof template.automatic !== "boolean") return false;
    if (template.billingDay !== undefined && (
      !Number.isInteger(template.billingDay) || Number(template.billingDay) < 1 || Number(template.billingDay) > 31
    )) return false;
    const identity = recurringExpenseTemplateIdentity({
      name: String(template.name || ""),
      category: String(template.category || ""),
      accountId: String(template.accountId || ""),
    });
    templateIdentityById.set(templateId, identity);
    if (template.active === true && template.automatic === true && template.frequency === "monthly") {
      if (activeMonthlyIdentities.has(identity)) return false;
      activeMonthlyIdentities.add(identity);
    }
  }
  const cycles = new Set<string>();
  const reversedEntryIds = new Set(financialEntries.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const reversedEntryId = (raw as Record<string, unknown>).reversedEntryId;
    return typeof reversedEntryId === "string" && reversedEntryId ? [reversedEntryId] : [];
  }));
  for (const raw of financialEntries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const entry = raw as Record<string, unknown>;
    if (entry.reversedEntryId !== undefined || reversedEntryIds.has(String(entry.id || ""))) continue;
    const templateId = entry.fixedExpenseId;
    const dueDate = entry.fixedExpenseDueDate;
    if (templateId === undefined && dueDate === undefined) continue;
    if (
      typeof templateId !== "string" || !templateId
      || typeof dueDate !== "string" || !dateParts(dueDate)
      || entry.type !== "expense"
    ) return false;
    const cycle = `${templateIdentityById.get(templateId) || `id:${templateId}`}:${dueDate.slice(0, 7)}`;
    if (cycles.has(cycle)) return false;
    cycles.add(cycle);
  }
  return true;
}
