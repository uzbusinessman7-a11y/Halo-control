import { seoulCalendarDate } from './business-time.ts';
import { rebalanceSuppliers } from './supplier-transactions.ts';

type Row = Record<string, any>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const nameKey = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const VEGETABLE_CATEGORY = 'Sabzavot va sous';
export const EXPENSE_ONLY_NAMES = ['KARAM', '상추', 'POMIDOR', "SHO'R BODRING", "QO'ZIQORIN", 'SOUS', 'TANHO KETCHUP SLADKI', 'TANHO KETCHUP SPICY', 'TANHO SWEET CHILI', 'MAXEV KETCHUP', 'MAXEV SPICY', 'MAXEV MAYONES', 'Tuz 꽃소금'];
export type ExpenseOnlyFields = { expenseOnly?: boolean; expenseOnlyHistory?: Array<{ enabled: boolean; at: string; by: string }> };
export const isExpenseOnlyInventory = (item: ExpenseOnlyFields | null | undefined) => item?.expenseOnly === true;
/** Entry date, rather than today's flag, determines the new policy. Existing rows use their own snapshots. */
export function expenseOnlyOnDate(item: ExpenseOnlyFields | undefined, date: string, now = new Date().toISOString()) {
  const history = item?.expenseOnlyHistory || [];
  if (!history.length) return item?.expenseOnly === true;
  const eligible = history.filter(h => h.at <= now && seoulCalendarDate(new Date(h.at)) <= date);
  return eligible.length ? eligible[eligible.length - 1].enabled : false;
}
export class VegetableExpenseError extends Error { status = 400; }

/** Additive, once per branch. No historical sale, stock movement, balance or cost is rewritten. */
export function migrateVegetableExpenses<T extends Row>(state: T, now = new Date().toISOString()): T {
  if (state.vegetableExpenseVersion === 1) return state;
  const names = new Set(EXPENSE_ONLY_NAMES.map(nameKey));
  const inventory = rows(state.inventory).map(item => names.has(nameKey(item.name))
    ? { ...item, expenseOnly: true, expenseOnlyHistory: [{ enabled: true, at: now, by: 'Rahbar topshirig‘i' }] } : item);
  if (!inventory.some(item => nameKey(item.name) === nameKey('상추'))) inventory.push({
    id: 'inventory-sangchu-expense-v1', name: '상추', unit: 'g', stock: 0, minStock: 0, unitCost: 0,
    packageName: 'quti', unitsPerPackage: 1, packageCost: 0, gramsPerUnit: 0, supplierId: '', categoryId: '',
    expenseOnly: true, expenseOnlyHistory: [{ enabled: true, at: now, by: 'Rahbar topshirig‘i' }],
  });
  return { ...state, inventory, vegetableExpenseVersion: 1, vegetableExpenseStartedAt: now,
    vegetableExpenseSettings: { normPct: 6 }, vegetablePurchases: [], vegetableNotifications: [] };
}

export function configureExpenseOnly(state: Row, inventoryId: string, enabled: boolean, now = new Date().toISOString()) {
  if (!rows(state.inventory).some(i => i.id === inventoryId)) throw new VegetableExpenseError('Mahsulot topilmadi.');
  return { ...state, inventory: rows(state.inventory).map(item => item.id !== inventoryId || item.expenseOnly === enabled ? item : {
    ...item, expenseOnly: enabled, expenseOnlyHistory: [...rows(item.expenseOnlyHistory), { enabled, at: now, by: 'Rahbar' }],
  }) };
}

/** Server-owned fields survive old clients; settings are changed only through the owner endpoint. */
export function preserveVegetableFields(current: Row, next: Row) {
  if (current.vegetableExpenseVersion !== 1) return next;
  const old = new Map(rows(current.inventory).map(i => [i.id, i]));
  return { ...next,
    ...Object.fromEntries(['vegetableExpenseVersion', 'vegetableExpenseStartedAt', 'vegetableExpenseSettings', 'vegetablePurchases', 'vegetableNotifications', 'purchaseReserveCounts', 'purchaseReserveSettings', 'purchaseReserveNotifications', 'businessTrendNotifications'].map(k => [k, current[k]])),
    inventory: rows(next.inventory).map(i => old.has(i.id) ? { ...i, expenseOnly: old.get(i.id)!.expenseOnly, expenseOnlyHistory: old.get(i.id)!.expenseOnlyHistory } : i),
  };
}

/** One receipt -> one accrued expense. Payments remain in the existing supplier ledger. */
export function applyVegetablePurchaseAccounting<T extends Row>(current: T, next: T, actor = 'Rahbar', now = new Date().toISOString()): T {
  if (current.vegetableExpenseVersion !== 1) return next;
  const oldMovements = new Map(rows(current.stockMovements).map(m => [m.id, m]));
  const itemById = new Map(rows(next.inventory).map(i => [i.id, i]));
  const purchases = new Map(rows(current.vegetablePurchases).map(p => [p.movementId, p]));
  const entries = new Map(rows(next.financialEntries).map(e => [e.id, e]));
  let transactions = rows(next.transactions);
  let suppliers = rows(next.suppliers);
  const stockCorrection = new Map<string, number>();
  const seen = new Set<string>();
  const deletedItems = rows(next.deletedItems).slice();
  const ownedExpenses = new Set([...purchases.values()].map(p => p.expenseId));
  if (rows(next.financialEntries).some(e => ownedExpenses.has(e.reversedEntryId))) throw new VegetableExpenseError('Sabzavot xarajatini alohida bekor qilmang. Bog‘langan xaridni Xarid / kirim tarixidan boshqaring.');
  const movements = rows(next.stockMovements).map(m => {
    const old = oldMovements.get(m.id);
    const previousPurchase = purchases.get(m.id);
    if (m.type !== 'receipt') return m;
    // Legacy receipts, including edited/restored ones, never acquire a new expense.
    const restoredLegacy = !old && rows(current.deletedItems).some(d => d.entityId === m.id || rows(d.stockMovements || d.linkedSnapshot?.stockMovements).some(x => x.id === m.id));
    const item = itemById.get(m.inventoryId);
    const applies = previousPurchase || (old ? old.expenseOnlyAtMovement === true : !restoredLegacy && expenseOnlyOnDate(item, String(m.date), now));
    if (!applies) return m;
    if (m.mezanaEntryId) {
      const entry = rows(next.mezanaEntries).find(e => e.id === m.mezanaEntryId);
      if (entry?.action !== 'purchased') return m; // Borrowing is not a purchase.
    }
    seen.add(m.id);
    const unchanged = old && JSON.stringify(old) === JSON.stringify(m) && previousPurchase && !previousPurchase.cancelledAt;
    if (unchanged) {
      if (previousPurchase.transactionId === `vegetable-purchase:${m.id}` && JSON.stringify(rows(current.transactions).find(t => t.id === previousPurchase.transactionId)) !== JSON.stringify(transactions.find(t => t.id === previousPurchase.transactionId))) throw new VegetableExpenseError('Bu qarz sabzavot xaridiga bog‘langan. Xarid yozuvini boshqaring; to‘lovni alohida kiriting.');
      const savedEntry = rows(current.financialEntries).find(e => e.id === previousPurchase.expenseId);
      if (savedEntry) entries.set(savedEntry.id, savedEntry);
      return m;
    }
    const delivery = rows(next.supplierDeliveries).find(d => d.id === m.referenceId);
    const intake = transactions.find(t => t.id === m.intakeId || t.id === m.referenceId);
    const intakeLine = rows(intake?.intakeLines).find(l => l.inventoryId === m.inventoryId);
    const deliveryLine = rows(delivery?.lines).find(l => l.inventoryId === m.inventoryId);
    const quantity = num(m.purchaseQuantity ?? intakeLine?.quantity ?? deliveryLine?.quantity ?? m.quantity);
    const unit = String(m.purchaseUnit || intakeLine?.unit || deliveryLine?.unit || item?.unit || 'birlik');
    const amount = Math.round(num(m.purchaseAmount ?? intakeLine?.amount ?? deliveryLine?.totalAmount ?? (num(m.quantity) * num(m.unitCost))));
    if (!(quantity > 0) || !(amount > 0)) throw new VegetableExpenseError('Omborsiz xarid uchun miqdor va jami summani kiriting. Sabzavot va sous sarfi → Xarid kiritish.');
    const supplierId = String(m.supplierId || delivery?.supplierId || intake?.supplierId || '');
    const supplierName = String(suppliers.find(s => s.id === supplierId)?.name || (m.mezanaEntryId ? 'MEZANA' : ''));
    const separateAccounting = (old || m).supplierAccounting === 'separate';
    if (!supplierName && !separateAccounting) throw new VegetableExpenseError('Sabzavot va sous xaridida yetkazib beruvchini tanlang.');
    const expenseId = `vegetable-expense:${m.id}`;
    let transactionId = previousPurchase?.transactionId || (!separateAccounting ? intake?.id || (delivery ? `delivery-purchase:${delivery.id}` : '') : '') || '';
    // Preserve legacy linked postings; separate receipts never create debt.
    if (!transactionId && !m.mezanaEntryId && !separateAccounting) {
      transactionId = `vegetable-purchase:${m.id}`;
      const prior = transactions.find(t => t.id === transactionId);
      const tx = { id: transactionId, type: 'purchase' as const, supplierId, amount, date: m.date, note: `${VEGETABLE_CATEGORY} · ${item?.name}`, vegetableMovementId: m.id };
      suppliers = rebalanceSuppliers(suppliers as any, (prior || null) as any, tx)!;
      transactions = [tx, ...transactions.filter(t => t.id !== transactionId)];
    } else if (transactionId === `vegetable-purchase:${m.id}`) {
      const prior = transactions.find(t => t.id === transactionId);
      const tx = { ...prior, id: transactionId, supplierId, type: 'purchase' as const, amount, date: m.date, vegetableMovementId: m.id };
      suppliers = rebalanceSuppliers(suppliers as any, (prior || null) as any, tx)!;
      transactions = [tx, ...transactions.filter(t => t.id !== transactionId)];
    }
    const record = { id: `vegetable:${m.id}`, movementId: m.id, inventoryId: m.inventoryId, name: String(item?.name || previousPurchase?.name || ''),
      quantity, unit, amount, date: m.date, supplierId, supplierName, recordedBy: previousPurchase?.recordedBy || delivery?.createdByName || actor,
      recordedAt: previousPurchase?.recordedAt || now, expenseId, transactionId, intakeId: m.intakeId || '',
      ...(m.purchasedAt ? { purchasedAt: m.purchasedAt } : {}), ...(m.remainingBeforePurchase !== undefined ? { remainingBeforePurchase: m.remainingBeforePurchase } : {}),
      ...(previousPurchase ? { updatedAt: now } : {}) };
    purchases.set(m.id, record);
    entries.set(expenseId, { id: expenseId, date: m.date, type: 'expense', category: VEGETABLE_CATEGORY, amount,
      accountId: '', nonCash: true, affectsProfit: true, vegetablePurchaseId: record.id,
      note: `${supplierName} · ${record.name} · ${quantity} ${unit}`, ...(m.intakeId ? { intakeId: m.intakeId } : {}) });
    stockCorrection.set(m.inventoryId, (stockCorrection.get(m.inventoryId) || 0) - num(m.quantity));
    return { ...m, quantity: 0, purchaseBaseQuantity: m.purchaseBaseQuantity ?? m.quantity, purchaseQuantity: quantity, purchaseUnit: unit, purchaseAmount: amount,
      expenseOnlyAtMovement: true, recordedAt: m.recordedAt || now, recordedBy: record.recordedBy };
  });
  // Preserve the cancelled purchase audit row. Existing archive rules govern the source receipt.
  for (const [movementId, p] of purchases) {
    if (seen.has(movementId) || p.cancelledAt) continue;
    purchases.set(movementId, { ...p, cancelledAt: now });
    const saved = entries.get(p.expenseId) || rows(current.financialEntries).find(e => e.id === p.expenseId);
    if (saved) entries.set(p.expenseId, { ...saved, cancelledAt: now });
    if (p.transactionId === `vegetable-purchase:${movementId}`) {
      const tx = transactions.find(t => t.id === p.transactionId);
      if (tx) { deletedItems.push({ id: `archive:${tx.id}`, kind: 'transaction', entityId: tx.id, label: tx.note || VEGETABLE_CATEGORY, section: VEGETABLE_CATEGORY, deletedAt: now, deletedBy: actor, reason: 'Bog‘langan xarid bekor qilindi', record: tx }); suppliers = rebalanceSuppliers(suppliers as any, tx as any, null)!; transactions = transactions.filter(t => t.id !== tx.id); }
    }
  }
  return { ...next, inventory: rows(next.inventory).map(i => stockCorrection.has(i.id) ? { ...i, stock: num(i.stock) + stockCorrection.get(i.id)! } : i),
    stockMovements: movements, vegetablePurchases: [...purchases.values()], financialEntries: [...entries.values()], transactions, suppliers, deletedItems };
}

export type VegetablePeriod = 'day' | 'week' | 'month';
export function addDays(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function periodBounds(date: string, period: VegetablePeriod, offset = 0) {
  let start: string, end: string;
  if (period === 'month') { const d = new Date(`${date.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + offset); start = d.toISOString().slice(0, 10); d.setUTCMonth(d.getUTCMonth() + 1); end = addDays(d.toISOString().slice(0, 10), -1); }
  else if (period === 'week') { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); start = addDays(date, -(day + 6) % 7 + offset * 7); end = addDays(start, 6); }
  else { start = addDays(date, offset); end = start; }
  return { start, end };
}
const dateKey = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : Number.isFinite(Date.parse(String(v))) ? seoulCalendarDate(new Date(String(v))) : '';
export function vegetablePeriodTotals(state: Row, start: string, end: string) {
  const purchases = rows(state.vegetablePurchases).filter(p => !p.cancelledAt && p.date >= start && p.date <= end);
  const cancelled = new Set(rows(state.posOrders).filter(o => o.status === 'cancelled').map(o => o.id));
  const sales = rows(state.sales).filter(s => !s.voided && !s.cancelledAt && s.status !== 'cancelled' && !cancelled.has(s.posOrderId) && dateKey(s.date || s.soldAt) >= start && dateKey(s.date || s.soldAt) <= end);
  const expense = purchases.reduce((v, p) => v + num(p.amount), 0);
  const revenue = sales.reduce((v, s) => v + num(s.totalRevenue), 0);
  const byProduct = new Map<string, Row>();
  for (const p of purchases) { const r = byProduct.get(p.inventoryId) || { inventoryId: p.inventoryId, name: p.name, amount: 0, quantities: {} }; r.amount += num(p.amount); r.quantities[p.unit] = (r.quantities[p.unit] || 0) + num(p.quantity); byProduct.set(p.inventoryId, r); }
  return { start, end, expense, revenue, ratio: revenue > 0 ? expense / revenue * 100 : null,
    products: [...byProduct.values()].map(p => ({ inventoryId: String(p.inventoryId), name: String(p.name), amount: num(p.amount), quantities: p.quantities as Record<string, number>, share: expense ? p.amount / expense * 100 : 0 })).sort((a, b) => b.amount - a.amount),
    purchases: purchases.slice().sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt)) };
}
export function vegetableReport(state: Row, period: VegetablePeriod, date = seoulCalendarDate()) {
  const b = periodBounds(date, period), prev = periodBounds(date, period, -1), wb = periodBounds(date, 'week');
  const current = vegetablePeriodTotals(state, b.start, b.end), previous = vegetablePeriodTotals(state, prev.start, prev.end);
  const weekly = vegetablePeriodTotals(state, wb.start, wb.end);
  const normPct = num(state.vegetableExpenseSettings?.normPct ?? 6);
  const baselineStart = String(state.vegetableExpenseStartedAt || '');
  const comparable = !baselineStart || seoulCalendarDate(new Date(baselineStart)) <= prev.start;
  return { ...current, previous, period, date, normPct, weekly, alert: weekly.ratio !== null && weekly.ratio > normPct + 2,
    differencePoints: comparable && current.ratio !== null && previous.ratio !== null ? current.ratio - previous.ratio : null,
    partial: Boolean(baselineStart && seoulCalendarDate(new Date(baselineStart)) > b.start),
    history: Array.from({ length: period === 'day' ? 30 : 12 }, (_, i) => { const r = periodBounds(date, period, i - (period === 'day' ? 29 : 11)); const t = vegetablePeriodTotals(state, r.start, r.end); const unavailable = Boolean(baselineStart && r.end < seoulCalendarDate(new Date(baselineStart))); return { start: r.start, expense: t.expense, revenue: t.revenue, ratio: unavailable ? null : t.ratio }; }),
  };
}

export function weeklyVegetableMessage(state: Row, now = new Date()) {
  const previousWeek = periodBounds(seoulCalendarDate(now), 'week', -1);
  const r = vegetableReport(state, 'week', previousWeek.start);
  const won = (v: number) => `₩${Math.round(v).toLocaleString('en-US')}`;
  const difference = r.differencePoints === null ? 'solishtirish uchun ma’lumot yetarli emas' : `${r.differencePoints >= 0 ? '+' : ''}${r.differencePoints.toFixed(2)} foiz punkt`;
  return { id: `vegetable-week:${previousWeek.start}`, text: `HALO · Sabzavot va sous sarfi\n${r.start} — ${r.end} (Seoul)\nSarf: ${won(r.expense)}\nSavdo: ${won(r.revenue)}\nSarf / savdo: ${r.ratio === null ? 'savdo yo‘q' : `${r.ratio.toFixed(2)}%`}\nOldingi hafta: ${difference}\n${r.alert ? '🔴 ' : ''}Me’yor: ${r.normPct}% · ogohlantirish: >${r.normPct + 2}%\nEng ko‘p xarid:\n${r.products.slice(0, 3).map((p, i) => `${i + 1}. ${p.name}: ${won(p.amount)}`).join('\n') || 'Xarid yo‘q'}${r.partial ? '\nYangi hisob shu hafta ichida boshlangan; davr to‘liq emas.' : ''}` };
}

/** Owner-created catalogue item; no purchase, debt or physical movement yet. */
export function createVegetableProduct(state: Row, input: Row, now = new Date().toISOString()) {
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  const unit = String(input.unit || '');
  const operationId = String(input.operationId || '');
  if (!/^[a-f0-9-]{36}$/.test(operationId) || !nameKey(name) || name.length > 100 || !['dona','g','kg','ml','litr','quti','banka','paket'].includes(unit)) throw new VegetableExpenseError('Mahsulot nomi va birligini tekshiring.');
  const id = `vegetable-product:${operationId}`;
  const old = rows(state.inventory).find(i => i.id === id);
  if (old) {
    if (old.name !== name || old.packageName !== unit) throw new VegetableExpenseError('Bu amal oldin saqlangan. Oynani qayta oching.');
    return { state, result: { inventoryId: id, alreadySaved: true } };
  }
  if (rows(state.inventory).some(i => nameKey(i.name) === nameKey(name))) throw new VegetableExpenseError('Bu mahsulot allaqachon mavjud. Ro‘yxatdan tanlang yoki “Mahsulotlar va me’yor”dan belgilang.');
  const item = { id, name, unit: unit === 'kg' ? 'g' : unit === 'litr' ? 'ml' : unit,
    stock: 0, minStock: 0, unitCost: 0, packageName: unit, unitsPerPackage: ['kg','litr'].includes(unit) ? 1000 : 1,
    packageCost: 0, gramsPerUnit: 0, supplierId: '', categoryId: 'inventory-other', expenseOnly: true,
    expenseOnlyHistory: [{ enabled: true, at: now, by: 'Rahbar' }], createdAt: now };
  return { state: { ...state, inventory: [...rows(state.inventory), item] }, result: { inventoryId: id, alreadySaved: false } };
}
