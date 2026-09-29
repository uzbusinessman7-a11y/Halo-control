import { isExpenseOnlyInventory } from "./vegetable-expenses.ts";
import { auditSupplierBalances } from "./supplier-transactions.ts";
import { calculateRecipeMarginAudit } from "./recipe-costing.ts";
import { selectActiveFinancialEntries } from "./daily-report.ts";
import { deliveryCommissionAmount } from "./delivery-sales.ts";
import { calculateAccountBalances } from "./account-balances.ts";

type Row = Record<string, unknown>;
type State = { accounts?: unknown; sales?: unknown; inventory?: unknown; recipes?: unknown; suppliers?: unknown; transactions?: unknown; financialEntries?: unknown; dailyCloses?: unknown; monthlyCloses?: unknown; stockMovements?: unknown; costRules?: { deliveryCommissionPct?: number } };
export type BusinessIssue = {
  code: string;
  severity: "error" | "review";
  title: string;
  count: number;
  detail: string;
  examples: string[];
  tab: "sales" | "recipes" | "inventory" | "suppliers" | "finance" | "deliverysales";
};
const rows = (value: unknown): Row[] => Array.isArray(value)
  ? value.filter((row): row is Row => !!row && typeof row === "object" && !Array.isArray(row)) : [];
const active = (row: Row) => !row.cancelledAt && row.voided !== true && row.status !== "cancelled";
const wonText = (value: number) => `${Math.round(value).toLocaleString("en-US")} ₩`;
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/** YYYY-MM-DD dan n kun oldingi sana. */
const daysBefore = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
};
/** Yopilmagan kunlar shu muddat ichida tekshiriladi (bugun hisobga olinmaydi). */
export const UNCLOSED_LOOKBACK_DAYS = 14;
/** Kassa va ombor farqlari yig'indisi shu muddat uchun ko'rsatiladi. */
export const VARIANCE_LOOKBACK_DAYS = 30;

/** Read-only diagnostics. Never manufacture missing money or repair old records. */
export function auditBusinessState(state: State, options: { today?: string } = {}) {
  const inventory = rows(state.inventory);
  const recipes = rows(state.recipes);
  const sales = rows(state.sales).filter(active);
  const issues: BusinessIssue[] = [];
  const add = (code: string, severity: BusinessIssue["severity"], title: string, affected: Row[], detail: string, tab: BusinessIssue["tab"]) => {
    if (affected.length) issues.push({ code, severity, title, count: affected.length, detail, tab,
      examples: affected.slice(0, 5).map((row) => String(row.name || row.date && `${row.date} · ${row.id}` || row.id || "Yozuv")) });
  };
  const audits = auditSupplierBalances(state.suppliers, state.transactions);
  if (Array.isArray(state.accounts)) {
    const unmatched = new Set(calculateAccountBalances(state, '9999-12-31').unmatched);
    add('missing_money_account', 'error', 'Pul hisobi topilmagan yozuvlar',
      [...sales, ...rows(state.financialEntries)].filter(row => unmatched.has(String(row.id))),
      'Kassa yoki bank hisobi topilmagan. Jami pul to‘liq bo‘lmasligi mumkin; hisobni tekshiring.', 'finance');
  }
  const supplierById = new Map(rows(state.suppliers).map((row) => [String(row.id), row]));
  add("supplier_balance", "error", "Qarz tarixi va qoldig‘i mos emas",
    audits.filter((row) => !row.valid || row.difference !== 0).map((row) => ({ ...row, name: supplierById.get(row.supplierId)?.name })),
    "Boshlang‘ich qarz + xarid − to‘lov saqlangan qoldiqqa teng bo‘lishi kerak. Eski qarzni hujjatsiz o‘zgartirmang.", "suppliers");
  const seen = new Map<string, Row>();
  const duplicates: Row[] = [];
  for (const sale of sales) {
    const key = String(sale.externalId || "");
    if (!key) continue;
    if (seen.has(key)) duplicates.push(sale);
    else seen.set(key, sale);
  }
  add("duplicate_sales", "error", "Bir manba bilan takror savdo", duplicates,
    "Buyurtma yoki POS qatori takrorlangan. Asl fayl bilan solishtirib, ortiqcha yozuvni tarix orqali bekor qiling.", "sales");
  add("invalid_sales_money", "error", "Savdo summasi noto‘g‘ri", sales.filter((sale) => !Number.isSafeInteger(sale.totalRevenue) || Number(sale.totalRevenue) < 0),
    "Tushum manfiy yoki kasr von bo‘lmasligi kerak. Tannarxning gramm hisobidagi kasrlari esa xato emas.", "sales");
  add("negative_stock", "review", "Omborda manfiy qoldiq", inventory.filter((item) => !isExpenseOnlyInventory(item) && Number(item.stock) < 0),
    "Haqiqiy mahsulotni sanang, kirim va retsept sarfini tekshiring. Tizim qoldiqni o‘zicha nolga tenglashtirmaydi.", "inventory");
  const costingInventory = inventory.map((item) => ({ ...item, id: String(item.id), unitCost: Number(item.unitCost) }));
  add("incomplete_recipes", "review", "Taom tannarxi to‘liq emas", recipes.filter((recipe) => !calculateRecipeMarginAudit({
    salePrice: Number(recipe.salePrice),
    ingredients: rows(recipe.ingredients).map((item) => ({ ...item, quantity: Number(item.quantity) })),
    extraCosts: rows(recipe.extraCosts).map((item) => ({ amount: Number(item.amount) })),
  }, costingInventory).complete), "Narx, tarkib va xarid tannarxini to‘ldiring. Yetishmagan tannarx bilan foyda ishonchli emas.", "recipes");
  add("sales_without_cost", "review", "Tannarxsiz savdo yozuvlari", sales.filter((sale) => Number(sale.quantity) > 0 && !(Number(sale.totalCost) > 0)),
    "Bu yozuvlarda tannarx yo‘q yoki 0. Retseptni bugun to‘ldirish eski savdo tannarxini avtomatik o‘zgartirmaydi; o‘sha kungi ma’lumot bilan tekshiring.", "sales");
  add("estimated_pos_revenue", "review", "POS tushumi manbasi tekshirilmagan", sales.filter((sale) => ["pos", "photo"].includes(String(sale.source)) && sale.revenueSource !== "pos_actual"),
    "Bu eski yoki menyu narxidan hisoblangan yozuvlar. POS haqiqiy summasi bo‘lgan faylni yuklab solishtiring; farqli eski yozuv avtomatik almashtirilmaydi.", "sales");
  add("possible_double_cost", "review", "Retseptda takror xarajat xavfi", recipes.filter((recipe) => rows(recipe.extraCosts)
    .some((entry) => Number(entry.amount) > 0 && /mehnat|maosh|ish haqi|komiss|ijara|gaz|salary|labor|rent|commission/i.test(String(entry.name || "")))),
    "Maosh, ijara, gaz yoki komissiya retseptga ham yozilgan. Boshqa xarajatda hisoblangan bo‘lsa, retseptdan takror qismini ajrating.", "recipes");
  const entries = selectActiveFinancialEntries(rows(state.financialEntries));
  add("capital_as_profit", "review", "Qarz yoki sarmoya foydaga qo‘shilgan", entries.filter((entry) => entry.type === "income"
    && entry.affectsProfit !== false && /qarz|sarmoya|kapital|loan|capital/i.test(String(entry.category || ""))),
    "Qarz olish va egadan kelgan sarmoya savdo foydasi emas. Pul harakati va foydaga ta’sir belgisini tekshiring.", "finance");
  const deliveryOrders = new Map<string, { id: string; date: unknown; contribution: number; complete: boolean }>();
  for (const sale of sales) {
    if (sale.source !== "delivery") continue;
    const id = String(sale.deliveryBatchId || sale.id);
    const order = deliveryOrders.get(id) || { id, date: sale.date, contribution: 0, complete: true };
    order.complete &&= Number(sale.totalCost) > 0 && Number.isFinite(Number(sale.totalRevenue));
    order.contribution += Number(sale.totalRevenue) - Number(sale.totalCost) - deliveryCommissionAmount(sale, state.costRules?.deliveryCommissionPct);
    deliveryOrders.set(id, order);
  }
  add("delivery_loss", "review", "Delivery buyurtmasida bevosita zarar", [...deliveryOrders.values()].filter((order) => order.complete && order.contribution < 0),
    "Savdodan tannarx va platforma ushlanmalari ayrilganda zarar qolgan. Narx, kupon, reklama va chegirmani tekshiring. Ijara va maosh bundan tashqari.", "deliverysales");
  const paymentMoney = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.transactionId || entry.nonCash || entry.type !== "expense") continue;
    const id = String(entry.transactionId);
    paymentMoney.set(id, (paymentMoney.get(id) || 0) + Number(entry.amount));
  }
  const payments = rows(state.transactions).filter((entry) => entry.type === "payment");
  add("payment_cash_mismatch", "error", "Qarz to‘lovi va pul chiqimi farq qiladi", payments.filter((payment) => paymentMoney.has(String(payment.id)) && paymentMoney.get(String(payment.id)) !== Number(payment.amount)),
    "Yetkazuvchiga to‘lov bilan unga bog‘langan kassa/bank chiqimi bir xil bo‘lishi kerak.", "suppliers");
  add("payment_cash_unlinked", "review", "Pul chiqimiga bog‘lanmagan to‘lov", payments.filter((payment) => !paymentMoney.has(String(payment.id))),
    "Eski to‘lovning qaysi hisobdan chiqqanini tekshiring. Pulni qayta chiqarib yozishdan oldin kassa tarixini solishtiring.", "finance");
  // --- "1 won / 1 gramm" nazorati: istisnolar rahbarga ko'rinsin -------------------
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(options.today || "")) ? String(options.today) : seoulToday();
  const closes = rows(state.dailyCloses);
  const closedDates = new Set(closes.map((close) => String(close.date || "")));
  // Yopilgan oy yakunlangan: undagi kunlar endi "yopilmagan kun" deb ko'rsatilmaydi.
  const closedMonths = new Set(rows(state.monthlyCloses).map((close) => String(close.month || "")));

  // 1) Savdo yoki pul harakati bo'lgan, lekin kassasi sanab yopilmagan kunlar.
  const unclosedFrom = daysBefore(today, UNCLOSED_LOOKBACK_DAYS);
  const activityDates = new Set<string>();
  for (const row of [...sales, ...entries]) {
    const date = String(row.date || "");
    if (date >= unclosedFrom && date < today && !closedDates.has(date) && !closedMonths.has(date.slice(0, 7))) activityDates.add(date);
  }
  // Kun yopish ma'lumoti umuman berilmagan bo'lsa (masalan, qisman holat), xulosa chiqarilmaydi.
  if (Array.isArray(state.dailyCloses)) add("unclosed_days", "error", `Kassa sanab yopilmagan kunlar (so‘nggi ${UNCLOSED_LOOKBACK_DAYS} kun)`,
    [...activityDates].sort().reverse().map((date) => ({ name: `${date} · savdo bor, kun yopilmagan` })),
    "Kun yopilmasa, kassadagi haqiqiy pul dastur hisobi bilan solishtirilmaydi va farq sezilmay qoladi. Har kuni kechqurun kassani sanab, kunni yoping.", "finance");

  // 2) Kassa farqlari: kam va ortiqcha alohida yig'iladi (bir-birini yopib qo'ymasin).
  const varianceFrom = daysBefore(today, VARIANCE_LOOKBACK_DAYS);
  const cashDifferences = closes
    .filter((close) => String(close.date || "") >= varianceFrom && Number(close.difference) !== 0 && Number.isFinite(Number(close.difference)))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
  const shortage = cashDifferences.reduce((sum, close) => sum + Math.min(0, Number(close.difference)), 0);
  const surplus = cashDifferences.reduce((sum, close) => sum + Math.max(0, Number(close.difference)), 0);
  add("cash_difference", shortage < 0 ? "error" : "review",
    `Kassa farqi (${VARIANCE_LOOKBACK_DAYS} kun): kam ${wonText(-shortage)} · ortiqcha ${wonText(surplus)}`,
    cashDifferences.map((close) => ({ name: `${close.date} · ${Number(close.difference) > 0 ? "+" : "−"}${wonText(Math.abs(Number(close.difference)))}${close.note ? ` · ${String(close.note).slice(0, 60)}` : ""}` })),
    "Kam va ortiqcha pul alohida ko‘rsatiladi: biri ikkinchisini yopib qo‘ymaydi. Takrorlanayotgan kamomad smena yoki kassa jarayonini tekshirishni talab qiladi.", "finance");

  // 3) Ombor sanog'ida chiqqan kamomad: mahsulot bo'yicha gramm va won.
  const itemById = new Map(inventory.map((item) => [String(item.id), item]));
  const shortages = new Map<string, { quantity: number; value: number }>();
  for (const movement of rows(state.stockMovements)) {
    if (!active(movement) || movement.type !== "adjustment" || !String(movement.referenceId || "").startsWith("inventory-count:")) continue;
    if (String(movement.date || "") < varianceFrom || Number(movement.quantity) >= 0) continue;
    const id = String(movement.inventoryId);
    const current = shortages.get(id) || { quantity: 0, value: 0 };
    current.quantity += Number(movement.quantity);
    current.value += Math.abs(Number(movement.quantity)) * Math.max(0, Number(movement.unitCost) || 0);
    shortages.set(id, current);
  }
  const shortageRows = [...shortages.entries()]
    .map(([id, total]) => ({ id, ...total, value: Math.round(total.value) }))
    .sort((left, right) => right.value - left.value);
  const shortageValue = shortageRows.reduce((sum, row) => sum + row.value, 0);
  add("stock_count_shortage", "review", `Ombor sanog‘ida kamomad (${VARIANCE_LOOKBACK_DAYS} kun): ${wonText(shortageValue)}`,
    shortageRows.map((row) => {
      const item = itemById.get(row.id);
      const quantity = Math.round(Math.abs(row.quantity) * 100) / 100;
      return { name: `${String(item?.name || row.id)} · −${quantity.toLocaleString("en-US")} ${String(item?.unit || "")} · ${wonText(row.value)}`.replace("  ", " ") };
    }),
    "Sanoqda dastur ko‘rsatganidan kam chiqqan mahsulot. Sababi: retsept me’yoridan ortiq sarf, hisobga olinmagan chiqit yoki yo‘qotish. Eng qimmatidan boshlab tekshiring.", "inventory");

  return { issues, errorCount: issues.filter((issue) => issue.severity === "error").length,
    reviewCount: issues.filter((issue) => issue.severity === "review").length,
    checked: { sales: sales.length, inventory: inventory.length, suppliers: audits.length } };
}
