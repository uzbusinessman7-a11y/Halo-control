export const DEFAULT_KITCHEN_RULES = [
  "Ish boshlaganda “ISHNI BOSHLADIM”, tugatganda “ISHNI TUGATDIM” tugmasini bosing.",
  "Ish joyi, qo‘l va ish formasini doimo toza saqlang.",
  "Faqat tasdiqlangan HALO retsepti va porsiya o‘lchamiga amal qiling.",
  "Halol mahsulotlarni aralashtirmang; shubhali mahsulotni ishlatmay, rahbarga ayting.",
  "Buzilgan, yo‘qolgan yoki kamaygan mahsulotni darhol tizimga kiriting.",
  "Smena oxirida ish joyini tozalab, chiqindi va kamomadni qayd eting.",
] as const;

export const DEFAULT_KITCHEN_RULE_REMINDER_HOURS = 3;
export const KITCHEN_RULE_REMINDER_OPTIONS = [2, 3, 4] as const;
export const MAX_KITCHEN_RULES = 12;
export const MAX_KITCHEN_RULE_LENGTH = 240;
export const MAX_KITCHEN_RULE_MESSAGES_PER_SHIFT = 6;

function cleanRule(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_KITCHEN_RULE_LENGTH);
}

export function normalizeKitchenRules(value: unknown) {
  if (!Array.isArray(value)) return [...DEFAULT_KITCHEN_RULES];
  const unique = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== "string") return;
    const rule = cleanRule(entry);
    if (rule) unique.add(rule);
  });
  return [...unique].slice(0, MAX_KITCHEN_RULES);
}

export function validKitchenRules(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_KITCHEN_RULES) return false;
  return value.every((entry) => (
    typeof entry === "string"
    && entry === cleanRule(entry)
    && entry.length > 0
    && entry.length <= MAX_KITCHEN_RULE_LENGTH
  ));
}

export function normalizeKitchenRuleReminderHours(value: unknown) {
  const hours = Number(value);
  return KITCHEN_RULE_REMINDER_OPTIONS.includes(hours as (typeof KITCHEN_RULE_REMINDER_OPTIONS)[number])
    ? hours
    : DEFAULT_KITCHEN_RULE_REMINDER_HOURS;
}

export function validKitchenRuleReminderHours(value: unknown) {
  return KITCHEN_RULE_REMINDER_OPTIONS.includes(Number(value) as (typeof KITCHEN_RULE_REMINDER_OPTIONS)[number]);
}

export function buildKitchenRulesTelegramMessage(
  workerName: string,
  rules: unknown,
  repeat = false,
) {
  const safeName = workerName.trim().replace(/\s+/g, " ").slice(0, 80) || "Xodim";
  const normalizedRules = normalizeKitchenRules(rules);
  return [
    repeat ? "🔔 HALO | OSHXONA QOIDALARI ESLATMASI" : `👋 Salom, ${safeName}!`,
    repeat ? `👤 ${safeName}, smenangiz davom etmoqda.` : "✅ Ish boshlaganingiz qayd etildi.",
    "",
    "🍳 OSHXONA QONUN-QOIDALARI",
    ...normalizedRules.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    "Tozalik, aniqlik va halollik — HALO standarti.",
  ].join("\n");
}
