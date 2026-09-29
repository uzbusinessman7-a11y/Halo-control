type Row = Record<string, any>;

/** One selected product, one receipt, no supplier debt or payment. */
export function vegetablePurchaseBody(purchase: Row, data: Row, operationId: string, duplicateReason = '') {
  const item = data.inventory.find((i: Row) => i.id === purchase.inventoryId);
  if (!item) throw new Error('Mahsulotni tanlang.');
  if (item.catalogArchived) throw new Error('Bu mahsulot ro‘yxatdan olib tashlangan. Faol mahsulotni tanlang.');
  const quantity = Number(purchase.quantity), amount = Number(purchase.amount);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Miqdorni yozing. Masalan: 2 yoki 0.5.');
  if (!String(purchase.unit).trim()) throw new Error('Birlikni tanlang.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Jami narxni butun vonda yozing. Masalan: 15000.');
  if (!purchase.date || !purchase.time) throw new Error('Xarid sanasi va vaqtini tekshiring.');
  if (purchase.remainingStatus === 'known' && (purchase.remaining === '' || !Number.isFinite(Number(purchase.remaining)) || Number(purchase.remaining) < 0)) throw new Error('Oldingi qoldiqni yozing yoki “Bilmayman”ni tanlang.');
  return {
    operationId, inventoryOnly: true, vegetableOnly: true, date: purchase.date, ...(duplicateReason ? {duplicateReason} : {}),
    lines: [{inventoryId: item.id, name: item.name, quantity, unit: purchase.unit, amount,
      purchasedAt: `${purchase.date}T${purchase.time}:00+09:00`,
      ...(purchase.remainingStatus === 'empty' ? {remainingBeforePurchase: 0} : purchase.remainingStatus === 'known' ? {remainingBeforePurchase: Number(purchase.remaining)} : {}),
    }],
  };
}
