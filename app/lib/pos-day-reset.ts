import { createDeletedItem, normalizeDeletedItems, validDeletedItems } from './deleted-items.ts';
import { saleAccountType } from './sale-financial-snapshots.ts';
import { isAutomaticTaxSale } from './sale-tax.ts';
import { calculateDailyReport } from './daily-report.ts';
import { dailySalesBonus } from './sales-bonus.ts';
import { seoulCalendarDate } from './business-time.ts';

type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
export class PosDayResetError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
function checkDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date || date > seoulCalendarDate()) {
    throw new PosDayResetError('To‘g‘ri, kelajakda bo‘lmagan sanani tanlang.', 400);
  }
}

/** This operation replaces imports only. HISOB orders and other channels are never targets. */
export function posDayImportedSales(state: Row, date: string) {
  const accounts = new Map(rows(state.accounts).map(a => [a.id, a.type]));
  const orderSales = new Set(rows(state.posOrders).flatMap(o => rows(o.items).map(i => i.saleId)));
  return rows(state.sales).filter(s => s.date === date && ['pos', 'photo'].includes(s.source)
    && !orderSales.has(s.id) && !String(s.id).startsWith('pos-terminal-sale:')
    && !String(s.externalId || '').startsWith('pos-order:')
    && saleAccountType(s, accounts.get(s.accountId || 'account-card')) === 'card'
    && isAutomaticTaxSale(s, 'card'));
}

function resetPlan(state: Row, date: string) {
  checkDate(date);
  const closed = rows(state.monthlyCloses).find(c => String(c.month) >= date.slice(0, 7));
  if (closed) throw new PosDayResetError(`${closed.month} oyi yopilgan. Yopilgan oy hisobiga ta’sir qiladigan savdoni bekor qilib bo‘lmaydi.`);
  const sales = posDayImportedSales(state, date);
  const ids = new Set(sales.map(s => s.id));
  if (ids.size !== sales.length || sales.some(s => !s.id)
    || rows(state.sales).filter(s => ids.has(s.id)).length !== sales.length) throw new PosDayResetError('Savdo IDlari takrorlangan. Avval yozuvlarni tekshirish kerak.');
  const movements = rows(state.stockMovements).filter(m => ids.has(m.referenceId));
  const movementIds = new Set(movements.map(m => m.id));
  if (movementIds.size !== movements.length || rows(state.stockMovements).filter(m => movementIds.has(m.id)).length !== movements.length
    || movements.some(m => !m.id || m.type !== 'sale'
    || !Number.isFinite(Number(m.quantity)) || Number(m.quantity) > 0)) {
    throw new PosDayResetError('Savdoga bog‘langan ombor tarixi noto‘g‘ri. Hech narsa bekor qilinmadi.');
  }
  const inventory = new Map(rows(state.inventory).map(i => [i.id, i]));
  const restored = new Map<string, number>();
  for (const sale of sales) {
    if (!Number.isFinite(Number(sale.totalRevenue)) || !Number.isFinite(Number(sale.totalCost))) {
      throw new PosDayResetError('Savdo summasi yoki tannarxi buzilgan. Avval yozuvni tekshirish kerak.');
    }
    const linked = movements.filter(m => m.referenceId === sale.id);
    if (!linked.length && !Array.isArray(sale.stockUsage)) {
      throw new PosDayResetError('Eski savdoning ombor sarfi saqlanmagan. Taxmin bilan qoldiq qaytarilmadi.');
    }
    // A changed recipe must never decide how much old stock to return.
    for (const usage of rows(sale.stockUsage)) {
      if (!linked.some(m => m.inventoryId === usage.inventoryId)
        && Number(usage.deductedQuantity ?? usage.quantity) !== 0) {
        throw new PosDayResetError('Savdoning ayrim ombor harakatlari topilmadi. Hech narsa bekor qilinmadi.');
      }
    }
    for (const m of linked) {
      if (rows(state.inventory).filter(i => i.id === m.inventoryId).length !== 1 || !Number.isFinite(Number(inventory.get(m.inventoryId)?.stock))) {
        throw new PosDayResetError('Savdoga bog‘langan ombor mahsuloti topilmadi. Avval uni arxivdan tiklang.');
      }
      restored.set(m.inventoryId, (restored.get(m.inventoryId) || 0) - Number(m.quantity));
    }
  }
  // Daily closes contain cumulative account balances, so later snapshots also become stale.
  const closes = sales.length ? rows(state.dailyCloses).filter(c => String(c.date) >= date) : [];
  const stocks = [...restored].filter(([, quantity]) => quantity > 0).map(([inventoryId, quantity]) => ({
    inventoryId, name: String(inventory.get(inventoryId)!.name), unit: String(inventory.get(inventoryId)!.unit), quantity,
  }));
  return { sales, ids, movements, closes, stocks };
}
async function fingerprint(plan: ReturnType<typeof resetPlan>) {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const sorted = (list: Row[]) => [...list].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const payload = JSON.stringify(canonical([sorted(plan.sales), sorted(plan.movements), sorted(plan.closes)]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function previewPosDayReset(state: Row, date: string) {
  const plan = resetPlan(state, date);
  const before = calculateDailyReport(state, date);
  const after = calculateDailyReport({ ...state, sales: rows(state.sales).filter(s => !plan.ids.has(s.id)) }, date);
  return {
    date, token: await fingerprint(plan), count: plan.sales.length,
    revenue: plan.sales.reduce((sum, s) => sum + Number(s.totalRevenue), 0),
    quantity: plan.sales.reduce((sum, s) => sum + Number(s.quantity), 0), stocks: plan.stocks,
    reopenedDates: plan.closes.map(c => String(c.date)).sort(),
    effects: { revenue: before.revenue - after.revenue, cost: before.cost - after.cost,
      cardCommission: before.cardCommission - after.cardCommission, tax: before.tax - after.tax,
      bonusBefore: dailySalesBonus(before.revenue).bonus, bonusAfter: dailySalesBonus(after.revenue).bonus },
  };
}
export type PosDayResetPreview = Awaited<ReturnType<typeof previewPosDayReset>>;

export async function cancelPosDayImport(state: Row, input: { date: string; token: string; operationId: string }, now = new Date()) {
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(input.operationId)) throw new PosDayResetError('Amal raqami noto‘g‘ri.', 400);
  const archives = normalizeDeletedItems(state.deletedItems);
  const previous = archives.find(a => (a.related?.posDayCancellation as Row | undefined)?.operationId === input.operationId);
  if (previous) {
    const receipt = previous.related!.posDayCancellation as Row;
    if (receipt.date !== input.date || receipt.token !== input.token) throw new PosDayResetError('Bu amal raqami boshqa bekor qilish uchun ishlatilgan.');
    return { state, result: { ...receipt, alreadyCancelled: true } };
  }
  const preview = await previewPosDayReset(state, input.date);
  if (!preview.count) throw new PosDayResetError('Bu sanada bekor qilinadigan POS importi yo‘q.');
  if (preview.token !== input.token) throw new PosDayResetError('Savdo yoki kun yakuni o‘zgardi. Avval “Tekshirish”ni qayta bosing.');
  const plan = resetPlan(state, input.date);
  const receipt = { operationId: input.operationId, date: input.date, token: input.token, count: preview.count,
    revenue: preview.revenue, reopenedDates: preview.reopenedDates, cancelledAt: now.toISOString() };
  const reason = `${input.date} POS importi xato kiritilgan; qayta yuklash uchun bekor qilindi.`;
  const additions = [
    ...plan.sales.map(s => createDeletedItem({ kind: 'sale', entityId: s.id, record: s,
      label: `${rows(state.recipes).find(r => r.id === s.recipeId)?.name || s.recipeId} × ${s.quantity}`,
      section: 'POS kunini bekor qilish', reason, now,
      related: { movements: plan.movements.filter(m => m.referenceId === s.id), posDayCancellation: receipt } })),
    ...plan.closes.map(c => createDeletedItem({ kind: 'dailyClose', entityId: c.id, record: c,
      label: `${c.date} · POS tuzatishdan keyin qayta tekshirish`, section: 'Kun yakuni', reason, now,
      related: { posDayCancellation: receipt } })),
  ];
  if (!validDeletedItems([...additions, ...archives])) throw new PosDayResetError('Yozuvni arxivga to‘liq saqlab bo‘lmadi. Hech narsa bekor qilinmadi.');
  const closeIds = new Set(plan.closes.map(c => c.id));
  // mutateHaloState applies the movement delta to inventory in the SAME CAS write.
  // Do not also increment stock here: the historical movement is the source of truth.
  return { state: { ...state, sales: rows(state.sales).filter(s => !plan.ids.has(s.id)),
    stockMovements: rows(state.stockMovements).filter(m => !plan.ids.has(m.referenceId)),
    dailyCloses: rows(state.dailyCloses).filter(c => !closeIds.has(c.id)),
    deletedItems: [...additions, ...archives] }, result: { ...receipt, alreadyCancelled: false } };
}
