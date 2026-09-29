type JsonRecord = Record<string, unknown>;

export type DuplicateSensitiveState = Record<string, unknown>;

export type DuplicateEntryWarning = {
  collection: string;
  section: string;
  summary: string;
  existingId: string;
  incomingId: string;
};

type DuplicateRule = {
  collection: string;
  section: string;
  fingerprints: (record: JsonRecord) => string[];
  summary: (record: JsonRecord) => string;
};

const records = (value: unknown): JsonRecord[] => (
  Array.isArray(value)
    ? value.filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : []
);

const text = (value: unknown) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("uz-UZ");
const shownText = (value: unknown) => String(value || "").trim().replace(/\s+/g, " ");
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(Math.round(parsed * 1_000_000) / 1_000_000) : "";
};
const key = (...parts: unknown[]) => parts.map((part) => (
  typeof part === "number" ? number(part) : text(part)
)).join("|");
const idOf = (record: JsonRecord) => shownText(record.id);
const money = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.round(parsed).toLocaleString("en-US")} ₩` : "";
};
const quantity = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("uz-UZ") : "";
};
const datePart = (record: JsonRecord) => shownText(record.date || record.month || record.nextDue);
const compactSummary = (label: string, record: JsonRecord, value?: unknown) => (
  [label, datePart(record), value === undefined ? "" : money(value)].filter(Boolean).join(" · ")
);

const lineSignature = (value: unknown) => records(value)
  .map((line) => key(
    line.inventoryId || line.recipeId || line.productCode || line.name,
    line.quantity,
    line.totalAmount || line.total || line.unitCost || line.unitPrice,
  ))
  .sort()
  .join(";");

const saleItemsSignature = (record: JsonRecord) => (
  lineSignature(record.items) || key(record.recipeId, record.quantity, record.totalRevenue || record.total)
);

const isCancelled = (record: JsonRecord) => (
  record.voided === true
  || record.active === false
  || ["cancelled", "void"].includes(text(record.status))
  || Boolean(record.cancelledAt || record.voidedAt)
);

const duplicateRules: DuplicateRule[] = [
  {
    collection: "productCategories",
    section: "Kategoriya",
    fingerprints: (record) => [key(record.kind, record.name)],
    summary: (record) => shownText(record.name) || "Kategoriya",
  },
  {
    collection: "inventory",
    section: "Ombor mahsuloti",
    fingerprints: (record) => [key(record.name)],
    summary: (record) => shownText(record.name) || "Ombor mahsuloti",
  },
  {
    collection: "recipes",
    section: "Taom",
    fingerprints: (record) => [
      key("name", record.name),
      ...(text(record.posCode) ? [key("code", record.posCode)] : []),
    ],
    summary: (record) => shownText(record.name) || shownText(record.posCode) || "Taom",
  },
  {
    collection: "suppliers",
    section: "Yetkazib beruvchi",
    fingerprints: (record) => [key(record.name)],
    summary: (record) => shownText(record.name) || "Yetkazib beruvchi",
  },
  {
    collection: "accounts",
    section: "Pul hisobi",
    fingerprints: (record) => [key(record.type, record.name)],
    summary: (record) => shownText(record.name) || "Pul hisobi",
  },
  {
    collection: "transactions",
    section: "Yetkazuvchi oldi-berdisi",
    fingerprints: (record) => [key(record.supplierId, record.type, record.amount, record.date, record.accountId)],
    summary: (record) => compactSummary(
      text(record.type) === "payment" ? "Yetkazuvchiga to‘lov" : "Yetkazuvchidan xarid",
      record,
      record.amount,
    ),
  },
  {
    collection: "supplierDeliveries",
    section: "Yetkazma / nakladnoy",
    fingerprints: (record) => [key(record.supplierId, record.date, record.totalAmount, lineSignature(record.lines))],
    summary: (record) => compactSummary("Yetkazma", record, record.totalAmount),
  },
  {
    collection: "workerConsumptions",
    section: "Ombor chiqimi",
    fingerprints: (record) => [key(
      record.kind,
      record.date,
      record.reason,
      record.recipeId || record.inventoryId || record.label,
      record.quantity,
      lineSignature(record.items),
    )],
    summary: (record) => [
      shownText(record.label) || shownText(record.reason) || "Ombor chiqimi",
      datePart(record),
      quantity(record.quantity) ? `${quantity(record.quantity)} ${shownText(record.unit)}`.trim() : "",
    ].filter(Boolean).join(" · "),
  },
  {
    collection: "posOrders",
    section: "POS savdo",
    fingerprints: (record) => [key(record.date, record.paymentType, record.total, saleItemsSignature(record))],
    summary: (record) => compactSummary("POS savdo", record, record.total),
  },
  {
    collection: "sales",
    section: "Savdo",
    fingerprints: (record) => text(record.deliveryPlatform)
      ? [key(
        "delivery",
        record.deliveryPlatform,
        record.deliveryOrderNumber || record.soldAt || record.deliveryBatchId,
        record.recipeId,
        record.quantity,
        record.totalRevenue,
      )]
      : [
        ...(text(record.externalId) ? [key("external", record.externalId)] : []),
        key("sale", record.date, record.recipeId, record.quantity, record.totalRevenue, record.accountId, record.taxTreatment),
      ],
    summary: (record) => compactSummary("Savdo", record, record.totalRevenue),
  },
  {
    collection: "stockMovements",
    section: "Ombor harakati",
    fingerprints: (record) => [
      text(record.referenceId)
        ? key("reference", record.referenceId, record.inventoryId, record.type)
        : key("manual", record.date, record.inventoryId, record.type, record.quantity, record.unitCost, record.supplierId),
    ],
    summary: (record) => [
      "Ombor harakati",
      datePart(record),
      quantity(record.quantity),
    ].filter(Boolean).join(" · "),
  },
  {
    collection: "financialEntries",
    section: "Pul harakati",
    fingerprints: (record) => [key(
      record.type,
      record.category,
      record.amount,
      record.date,
      record.accountId,
      record.toAccountId,
      record.oilFlowType,
      record.oilCanCount,
    )],
    summary: (record) => compactSummary(shownText(record.category) || "Pul harakati", record, record.amount),
  },
  {
    collection: "dailyCloses",
    section: "Kun yopilishi",
    fingerprints: (record) => [key(record.date)],
    summary: (record) => `Kun yopilishi · ${datePart(record)}`,
  },
  {
    collection: "fixedExpenses",
    section: "Doimiy xarajat",
    fingerprints: (record) => [key(
      record.name,
      record.category,
      record.amount,
      record.accountId,
      record.frequency,
      record.nextDue,
    )],
    summary: (record) => compactSummary(shownText(record.name) || "Doimiy xarajat", record, record.amount),
  },
  {
    collection: "purchaseOrders",
    section: "Buyurtma",
    fingerprints: (record) => [key(record.supplierId, record.date, record.total, lineSignature(record.items))],
    summary: (record) => compactSummary("Yetkazuvchiga buyurtma", record, record.total),
  },
  {
    collection: "staff",
    section: "Xodim",
    fingerprints: (record) => [key(record.name, record.workerId)],
    summary: (record) => shownText(record.name) || "Xodim",
  },
  {
    collection: "workShifts",
    section: "Davomat",
    fingerprints: (record) => [key(record.staffId, record.date, record.clockIn, record.clockOut)],
    summary: (record) => `Davomat · ${datePart(record)}`,
  },
  {
    collection: "payrollAdjustments",
    section: "Oylik tuzatishi",
    fingerprints: (record) => [key(record.staffId, record.date, record.type, record.amount, record.note)],
    summary: (record) => compactSummary("Oylik tuzatishi", record, record.amount),
  },
  {
    collection: "attendanceDays",
    section: "Davomat kuni",
    fingerprints: (record) => [key(record.staffId, record.date, record.status, record.payMode)],
    summary: (record) => `Davomat kuni · ${datePart(record)}`,
  },
  {
    collection: "payrollPayments",
    section: "Oylik / avans to‘lovi",
    fingerprints: (record) => [key(record.staffId, record.month, record.date, record.kind, record.amount, record.accountId)],
    summary: (record) => compactSummary("Oylik / avans", record, record.amount),
  },
  {
    collection: "monthlyCloses",
    section: "Oy yakuni",
    fingerprints: (record) => [key(record.month)],
    summary: (record) => `Oy yakuni · ${shownText(record.month)}`,
  },
];

function activeRecords(state: DuplicateSensitiveState, collection: string) {
  const source = records(state[collection]);
  if (collection !== "financialEntries") return source.filter((record) => !isCancelled(record));
  const reversedIds = new Set(source.map((record) => shownText(record.reversedEntryId)).filter(Boolean));
  return source.filter((record) => (
    !isCancelled(record)
    && !record.reversedEntryId
    && !reversedIds.has(idOf(record))
  ));
}

export function findPotentialDuplicateEntries(
  before: DuplicateSensitiveState,
  after: DuplicateSensitiveState,
): DuplicateEntryWarning[] {
  const warnings: DuplicateEntryWarning[] = [];
  for (const rule of duplicateRules) {
    const beforeAll = records(before[rule.collection]);
    const beforeIds = new Set(beforeAll.map(idOf).filter(Boolean));
    const known = new Map<string, JsonRecord>();
    activeRecords(before, rule.collection).forEach((record) => {
      rule.fingerprints(record).filter(Boolean).forEach((fingerprint) => known.set(fingerprint, record));
    });
    for (const incoming of activeRecords(after, rule.collection)) {
      const incomingId = idOf(incoming);
      if (!incomingId || beforeIds.has(incomingId)) continue;
      const fingerprints = rule.fingerprints(incoming).filter(Boolean);
      const matchedFingerprint = fingerprints.find((fingerprint) => known.has(fingerprint));
      if (matchedFingerprint) {
        warnings.push({
          collection: rule.collection,
          section: rule.section,
          summary: rule.summary(incoming),
          existingId: idOf(known.get(matchedFingerprint) || {}),
          incomingId,
        });
      } else {
        fingerprints.forEach((fingerprint) => known.set(fingerprint, incoming));
      }
    }
  }
  return warnings;
}

export function duplicateEntryConfirmationMessage(warnings: DuplicateEntryWarning[]) {
  if (!warnings.length) return "";
  const lines = warnings.slice(0, 5).map((warning) => `• ${warning.section}: ${warning.summary}`);
  const remainder = warnings.length > lines.length ? `\n• yana ${warnings.length - lines.length} ta o‘xshash yozuv` : "";
  return [
    "TAKRORIY MA’LUMOT EHTIMOLI",
    "",
    ...lines,
    remainder,
    "",
    "Bu ma’lumot avval ham kiritilganga o‘xshaydi. Hisob va ombor ikki marta o‘zgarmasligi uchun tekshiring.",
    "",
    "OK — baribir bir marta saqlash",
    "Bekor qilish — saqlamaslik",
  ].filter((line, index, all) => line || (index > 0 && all[index - 1])).join("\n");
}
