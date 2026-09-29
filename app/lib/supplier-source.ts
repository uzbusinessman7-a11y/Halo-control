type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
/** Resolve a ledger entry to its original document; never infer links from amount alone. */
export function supplierSourceDocument(state: Row, transaction: Row): string | null {
  if (transaction.vegetableMovementId) return String(transaction.vegetableMovementId);
  const vegetable = rows(state.vegetablePurchases).find(p => p.transactionId === transaction.id && !p.cancelledAt);
  if (vegetable) return String(vegetable.movementId || vegetable.id);
  if (Array.isArray(transaction.intakeLines)) return String(transaction.id);
  if (transaction.intakeId) return String(transaction.intakeId);
  const delivery = rows(state.supplierDeliveries).find(d => d.paymentTransactionId === transaction.id || `delivery-purchase:${d.id}` === transaction.id);
  if (delivery) return String(delivery.id);
  const movement = rows(state.stockMovements).find(m => m.intakeId === transaction.id || m.transactionId === transaction.id || m.referenceId === transaction.id);
  return movement ? String(movement.intakeId || movement.id) : null;
}
