import { isExpenseOnlyInventory } from "./vegetable-expenses.ts";
import { auditSupplierBalances } from "./supplier-transactions.ts";
import { calculateRecipeMarginAudit } from "./recipe-costing.ts";
import { selectActiveFinancialEntries } from "./daily-report.ts";
import { deliveryCommissionAmount } from "./delivery-sales.ts";
import { calculateAccountBalances } from "./account-balances.ts";

type Row = Record<string, unknown>;
type State = { accounts?: unknown; sales?: unknown; inventory?: unknown; recipes?: unknown; suppliers?: unknown; transactions?: unknown; financialEntries?: unknown; costRules?: { deliveryCommissionPct?: number } };
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

/** Read-only diagnostics. Never manufacture missing money or repair old records. */
export function auditBusinessState(state: State) {
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
  return { issues, errorCount: issues.filter((issue) => issue.severity === "error").length,
    reviewCount: issues.filter((issue) => issue.severity === "review").length,
    checked: { sales: sales.length, inventory: inventory.length, suppliers: audits.length } };
}
