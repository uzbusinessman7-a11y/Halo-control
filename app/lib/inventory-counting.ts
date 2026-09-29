import { configureExpenseOnly, isExpenseOnlyInventory } from "./vegetable-expenses.ts";
import { inventoryActivityTotals, type InventoryCount } from './inventory-accounting.ts';
import { isAccountingMonthClosed } from './month-end.ts';
type Row = Record<string, any>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
export class InventoryCountingError extends Error { status = 400; }
export function configureInventoryAccounting(state: Row, input: Row, now = new Date().toISOString()) {
  const inventory = rows(state.inventory);
  const item = inventory.find(i => i.id === input.inventoryId);
  if (!item) throw new InventoryCountingError('Mahsulot topilmadi.');
  if (typeof input.expenseOnly !== 'boolean') throw new InventoryCountingError('Oddiy yoki Omborsiz (xarajat) usulini tanlang.');
  const packageName = String(input.packageName || item.packageName || 'dona').trim().slice(0, 30);
  const factor = Number(input.unitsPerPackage ?? item.unitsPerPackage ?? 1);
  if (!packageName || !Number.isFinite(factor) || factor <= 0 || factor > 1e9) throw new InventoryCountingError('1 xarid birligidagi miqdorni kiriting.');
  const updated = { ...item, packageName, unitsPerPackage: factor, packageCost: factor * Number(item.unitCost || 0) };
  const next = { ...state, inventory: inventory.map(i => i.id === item.id ? updated : i) };
  return { state: configureExpenseOnly(next, item.id, input.expenseOnly, now), result: { inventoryId: item.id } };
}
export function saveAccountingCount(state: Row, input: Row, actor: { id: string; name: string }, now = new Date().toISOString()) {
  const operationId = String(input.operationId || '');
  if (!/^[\w-]{8,100}$/.test(operationId)) throw new InventoryCountingError('Sanoq raqamini tekshiring.');
  const existing = rows(state.inventoryCounts).filter(c => c.operationId === operationId);
  if (existing.length) return { state, result: { countIds: existing.map(c => c.id), alreadySaved: true, changed: 0, adjustments: [] } };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  if (input.date && input.date !== date) throw new InventoryCountingError('Tezkor sanoq hozirgi qoldiqni o‘lchaydi. Sana bugungi kun bo‘lishi kerak.');
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new InventoryCountingError('Bu oy yopilgan. Sanoq uchun ochiq oy kerak.');
  const entries = rows(input.counts);
  if (!entries.length || entries.length > 300) throw new InventoryCountingError('Kamida bitta mahsulotni sanang.');
  const inventory = rows(state.inventory);
  const byId = new Map(inventory.map(i => [i.id, i]));
  const seen = new Set<string>();
  const counts = entries.map(entry => {
    const item = byId.get(entry.inventoryId);
    if (!item || seen.has(item.id)) throw new InventoryCountingError('Sanoq mahsuloti noto‘g‘ri yoki takrorlangan.');
    seen.add(item.id);
    const factor = Number(item.unitsPerPackage || 1);
    const packaged = entry.packageCount !== undefined;
    if (packaged && entry.expectedUnitsPerPackage !== undefined && Number(entry.expectedUnitsPerPackage) !== factor) throw new InventoryCountingError(`${item.name}: xarid birligi o‘zgargan. Yangilang va qayta tekshiring.`);
    if (isExpenseOnlyInventory(item)) throw new InventoryCountingError('Omborsiz mahsulot sanalmaydi. Xaridini Sabzavot va sous sarfiga kiriting.');
    const raw = packaged ? entry.packageCount : entry.actualStock;
    const value = Number(raw);
    if (raw == null || typeof raw === 'boolean' || String(raw).trim() === '' || !Number.isFinite(value) || value < 0 || value > 1e9 || (packaged && !Number.isInteger(value * 4))) throw new InventoryCountingError(`${item.name}: qoldiqni tekshiring.`);
    const actualStock = packaged ? value * factor : value;
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(actualStock) || actualStock > 1e12) throw new InventoryCountingError(`${item.name}: xarid birligi miqdorini tekshiring.`);
    const count: InventoryCount & { operationId: string } = { id: `count-${operationId}-${item.id}`, operationId, inventoryId: item.id, name: item.name, unit: item.unit, actualStock, ...(packaged ? { packageCount: value } : {}), date, countedAt: now, countedBy: actor.name, actorId: actor.id, packageName: item.packageName || 'birlik', unitsPerPackage: factor, ...inventoryActivityTotals(state, item.id) };
    return count;
  });
  const countById = new Map(counts.map(c => [c.inventoryId, c]));
  const adjustments = counts.map(c => ({ id: `movement-${c.id}`, inventoryId: c.inventoryId, type: 'adjustment', quantity: c.actualStock - Number(byId.get(c.inventoryId)!.stock || 0), unitCost: Number(byId.get(c.inventoryId)!.unitCost || 0), date, recordedAt: now, note: `Sanoq · ${actor.name}`, referenceId: `inventory-count:${operationId}` }));
  return { state: { ...state, inventory: inventory.map(i => countById.has(i.id) ? { ...i, stock: countById.get(i.id)!.actualStock } : i), inventoryCounts: [...counts, ...rows(state.inventoryCounts)], stockMovements: [...adjustments, ...rows(state.stockMovements)] }, result: { countIds: counts.map(c => c.id), alreadySaved: false, changed: adjustments.filter(m => Math.abs(m.quantity) > .000001).length, adjustments: adjustments.map(m => ({ inventoryId: m.inventoryId, quantity: m.quantity })) } };
}
