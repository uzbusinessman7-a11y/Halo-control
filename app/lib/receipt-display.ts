type Row = Record<string, any>;
const finite = (v: unknown) => v !== null && v !== undefined && Number.isFinite(Number(v));
/** Read-only purchase view; an expense-only receipt intentionally has physical quantity 0. */
export function receiptDisplay(movement: Row, item: Row = {}) {
  const quantity = Number(movement.purchaseQuantity ?? movement.quantity ?? 0);
  const unit = String(movement.purchaseUnit || item.unit || movement.unit || 'birlik');
  const baseQuantity = Number(movement.purchaseBaseQuantity ?? movement.quantity ?? 0);
  const amount = finite(movement.purchaseAmount) ? Number(movement.purchaseAmount)
    : finite(movement.unitCost) ? baseQuantity * Number(movement.unitCost) : null;
  return { quantity, unit, amount, unitCost: amount !== null && quantity > 0 ? amount / quantity : null };
}
export function receiptTotalRows(movements: Row[], inventory: Row[]) {
  const grouped = new Map<string, Row>();
  for (const movement of movements) {
    const item = inventory.find(i => i.id === movement.inventoryId) || {};
    const display = receiptDisplay(movement, item);
    // Packages never mix with grams; comparable mass/volume units normalize to the inventory unit.
    const scales: Record<string, [string, number]> = { g: ['mass',1], kg:['mass',1000], ml:['volume',1], litr:['volume',1000] };
    const from = scales[display.unit], to = scales[item.unit];
    const convert = from && to && from[0] === to[0];
    const unit = convert ? item.unit : display.unit;
    const quantity = convert ? display.quantity * from[1] / to[1] : display.quantity;
    const key = `${movement.inventoryId}:${unit}`;
    const row = grouped.get(key) || { key, inventoryId: movement.inventoryId, name:item.name || movement.productName || 'Mahsulot', unit, quantity:0, amount:0, receiptCount:0, lastDate:movement.date, missingAmount:false };
    row.quantity += quantity; row.amount += display.amount ?? 0;
    row.missingAmount ||= display.amount === null;
    row.receiptCount++; if (movement.date > row.lastDate) row.lastDate = movement.date;
    grouped.set(key, row);
  }
  return [...grouped.values()].sort((a,b)=>String(b.lastDate).localeCompare(a.lastDate)||String(a.name).localeCompare(b.name,'uz'));
}
