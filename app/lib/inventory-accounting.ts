import { expenseOnlyOnDate, type ExpenseOnlyFields } from './vegetable-expenses.ts';
type Row = Record<string, any>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const savedCost = (value: unknown) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
export type InventoryAccountingFields = ExpenseOnlyFields;

/** Only the expense-only flag controls new movements. Saved physical quantities
 * remain authoritative when editing, cancelling or restoring historical sales. */
export function applySaleInventoryAccounting<T extends Row>(current: T, next: T, now = new Date().toISOString()): T {
  const oldMovements = rows(current.stockMovements);
  const oldById = new Map(oldMovements.map(m => [m.id, m]));
  const oldSales = new Map(rows(current.sales).map(s => [s.id, s]));
  const inventory = new Map(rows(current.inventory).map(i => [i.id, i]));
  const previousInventoryIds = new Set(inventory.keys());
  rows(next.inventory).forEach(i => { if (!inventory.has(i.id)) inventory.set(i.id, i); });
  // Restoring a saved sale uses its historical physical movement, even after a mode change.
  const archivedMovements = new Map(rows(current.deletedItems).flatMap(entry => rows(entry.stockMovements || entry.movements || entry.related?.stockMovements || entry.related?.movements || entry.relatedRecords?.stockMovements)).map(m => [m.id, m]));
  const touched = new Set<string>();
  const movements: Row[] = rows(next.stockMovements).map(m => {
    const old = oldById.get(m.id);
    const changed = !old || old.quantity !== m.quantity || old.inventoryId !== m.inventoryId || old.theoreticalQuantity !== m.theoreticalQuantity;
    if (!changed) return m;
    const item = inventory.get(m.inventoryId);
    const stamped: Row = { ...m, recordedAt: m.recordedAt || now };
    if (m.type !== 'sale') return stamped;
    touched.add(m.inventoryId);
    const theoreticalQuantity = number(m.quantity) !== 0 ? -number(m.quantity) : number(m.theoreticalQuantity);
    const snapshot = old || archivedMovements.get(m.id);
    const expenseOnly = snapshot ? snapshot.expenseOnlyAtMovement === true : expenseOnlyOnDate(item, String(m.date), now);
    const noDeduction = snapshot ? number(snapshot.quantity) === 0 && number(snapshot.theoreticalQuantity) !== 0 : expenseOnly;
    if (old && old.inventoryId !== m.inventoryId) touched.add(old.inventoryId);
    return { ...snapshot, ...stamped, quantity: noDeduction ? 0 : -theoreticalQuantity, theoreticalQuantity, expenseOnlyAtMovement: expenseOnly };
  });
  const newIds = new Set(movements.map(m => m.id));
  oldMovements.forEach(m => { if (m.type === 'sale' && !newIds.has(m.id)) touched.add(m.inventoryId); });
  const total = (list: Row[], id: string) => list.reduce((sum, m) => sum + (m.inventoryId === id ? number(m.quantity) : 0), 0);
  const sales = rows(next.sales).map(s => {
    const prior = oldSales.get(s.id);
    if (prior && JSON.stringify(prior.stockUsage) === JSON.stringify(s.stockUsage)) return s;
    const stockUsage = rows(s.stockUsage).map(u => {
      const item = inventory.get(u.inventoryId);
      const priorUsage = rows(prior?.stockUsage).find(old => old.inventoryId === u.inventoryId);
      const linked = movements.filter(m => m.type === 'sale' && m.referenceId === s.id && m.inventoryId === u.inventoryId);
      const expenseOnly = linked.length ? linked.every(m => m.expenseOnlyAtMovement === true) : priorUsage ? priorUsage.expenseOnlyAtSale === true : typeof u.expenseOnlyAtSale === 'boolean' ? u.expenseOnlyAtSale : expenseOnlyOnDate(item, String(s.date), now);
      const deductedQuantity = linked.length ? -linked.reduce((sum, m) => sum + number(m.quantity), 0) : priorUsage?.deductedQuantity === 0 || expenseOnly ? 0 : number(u.quantity);
      // Saved sale prices, including zero, are historical facts. Restoring an
      // old sale after a purchase-price change must not change its profit.
      const hasSnapshot = Boolean(priorUsage) || typeof u.expenseOnlyAtSale === 'boolean';
      const unitCostAtSale = expenseOnly && !hasSnapshot ? number(item?.unitCost)
        : savedCost(u.unitCostAtSale) ? Number(u.unitCostAtSale)
        : savedCost(priorUsage?.unitCostAtSale) ? Number(priorUsage!.unitCostAtSale)
        : expenseOnly ? number(item?.unitCost) : 0;
      const totalCostAtSale = (!expenseOnly || hasSnapshot) && savedCost(u.totalCostAtSale) ? Number(u.totalCostAtSale)
        : unitCostAtSale * number(u.quantity);
      return { ...priorUsage, ...u, expenseOnlyAtSale: expenseOnly, deductedQuantity: deductedQuantity || 0, ...(expenseOnly ? { unitCostAtSale, totalCostAtSale } : {}) };
    });
    const expenseOnlyCost = stockUsage.filter(u => u.expenseOnlyAtSale).reduce((sum, u) => sum + number(u.totalCostAtSale), 0);
    return { ...s, recordedAt: s.recordedAt || now, stockUsage, ...(expenseOnlyCost || prior?.expenseOnlyCost !== undefined ? { expenseOnlyCost: Math.min(number(s.totalCost), expenseOnlyCost) } : {}) };
  });
  return { ...next, sales, stockMovements: movements, inventory: rows(next.inventory).map(item => ({ ...inventory.get(item.id), ...item })).map(item => touched.has(item.id) && previousInventoryIds.has(item.id)
    ? { ...item, stock: number(inventory.get(item.id)!.stock) + total(movements, item.id) - total(oldMovements, item.id) } : item) };
}

export type InventoryCount = { id: string; inventoryId: string; name: string; unit: string; date: string; countedAt: string; countedBy: string; actorId: string; actualStock: number; packageCount?: number; unitsPerPackage: number; packageName: string; receiptsTotal: number; theoreticalTotal: number; movementAdjustmentTotal: number; notification?: { status: string; at?: string; error?: string } };
export function inventoryActivityTotals(state: Row, inventoryId: string) {
  return rows(state.stockMovements).filter(m => m.inventoryId === inventoryId).reduce<{ receiptsTotal: number; theoreticalTotal: number; movementAdjustmentTotal: number }>((t, m) => {
    if (m.type === 'receipt') t.receiptsTotal += number(m.quantity);
    if (m.type === 'sale' || m.theoreticalQuantity !== undefined) t.theoreticalTotal += m.theoreticalQuantity !== undefined ? number(m.theoreticalQuantity) : -number(m.quantity);
    if (m.type !== 'sale' && m.type !== 'receipt' && !String(m.referenceId || '').startsWith('inventory-count:')) t.movementAdjustmentTotal += number(m.quantity);
    return t;
  }, { receiptsTotal: 0, theoreticalTotal: 0, movementAdjustmentTotal: 0 });
}
export function inventoryCountVariance(start: InventoryCount, end: InventoryCount) {
  const receipts = end.receiptsTotal - start.receiptsTotal;
  const actual = start.actualStock + receipts - end.actualStock;
  const theoretical = end.theoreticalTotal - start.theoreticalTotal;
  const difference = actual - theoretical;
  const percent = theoretical > 0 ? difference / theoretical * 100 : null;
  const invalid = actual < -0.000001 || theoretical < -0.000001 || start.unit !== end.unit;
  return { start, end, receipts, actual, theoretical, difference, percent, invalid, otherMovements: end.movementAdjustmentTotal - start.movementAdjustmentTotal };
}
export function inventoryVarianceReports(state: Row) {
  const byItem = new Map<string, InventoryCount[]>();
  rows(state.inventoryCounts).forEach(c => byItem.set(c.inventoryId, [...(byItem.get(c.inventoryId) || []), c as InventoryCount]));
  return [...byItem.values()].flatMap(counts => {
    const ordered = counts.sort((a, b) => a.countedAt.localeCompare(b.countedAt) || a.id.localeCompare(b.id));
    return ordered.slice(1).map((end, index) => inventoryCountVariance(ordered[index], end));
  }).sort((a, b) => b.end.countedAt.localeCompare(a.end.countedAt));
}

/** Public count view deliberately contains only current fields. Raw saved counts
 * (including retired metadata) stay unchanged in storage. */
export function inventoryCountView(count: Row): InventoryCount {
  const fields = ['id', 'inventoryId', 'name', 'unit', 'date', 'countedAt', 'countedBy', 'actorId', 'actualStock', 'packageCount', 'unitsPerPackage', 'packageName', 'receiptsTotal', 'theoreticalTotal', 'movementAdjustmentTotal'];
  return Object.fromEntries(fields.filter(key => key in count).map(key => [key, count[key]])) as InventoryCount;
}
