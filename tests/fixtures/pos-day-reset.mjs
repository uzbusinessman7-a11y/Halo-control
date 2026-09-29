export const date = '2026-09-23';
export function fixture() {
  const sale = { id: 'import-1', recipeId: 'r', date, source: 'pos', externalId: `okpos-daily-product:${date}:00001`,
    taxTreatment: 'automatic', accountId: 'account-card', quantity: 4, unitPrice: 200000, totalRevenue: 800000, totalCost: 12000,
    stockUsage: [{ inventoryId: 'bread', quantity: 4, deductedQuantity: 4 }, { inventoryId: 'sauce', quantity: 200, deductedQuantity: 0 }] };
  return {
    inventory: [{ id: 'bread', name: 'NON', unit: 'dona', stock: 6, minStock: 0, unitCost: 1000, supplierId: '', categoryId: 'inventory-other' },
      { id: 'sauce', name: 'SOUS', unit: 'g', stock: 1000, minStock: 0, unitCost: 2, supplierId: '', categoryId: 'inventory-other', expenseOnly: true }],
    recipes: [{ id: 'r', name: 'Lavash', categoryId: 'recipe-other', salePrice: 200000, ingredients: [{ inventoryId: 'bread', quantity: 999, unit: 'dona', unitCost: 1000 }] }],
    accounts: [{ id: 'account-card', name: 'POS', type: 'card', openingBalance: 0 }, { id: 'cash', name: 'Naqd', type: 'cash', openingBalance: 0 }, { id: 'delivery', name: 'Delivery', type: 'delivery', openingBalance: 0 }],
    sales: [sale, { ...sale, id: 'cash-1', source: 'pos', externalId: 'pos-order:cash-1', accountId: 'cash', taxTreatment: 'accountant_managed', totalRevenue: 150000, stockUsage: [] },
      { ...sale, id: 'delivery-1', source: 'delivery', externalId: 'delivery-1', accountId: 'delivery', taxTreatment: 'accountant_managed', totalRevenue: 50000, stockUsage: [] },
      { ...sale, id: 'manual-1', source: 'manual', externalId: '', totalRevenue: 10000, stockUsage: [] },
      { ...sale, id: 'other-date', date: '2026-09-22', externalId: 'other-date', stockUsage: [] }],
    stockMovements: [{ id: 'm1', inventoryId: 'bread', referenceId: sale.id, type: 'sale', quantity: -4, date, note: 'POS' },
      { id: 'm2', inventoryId: 'sauce', referenceId: sale.id, type: 'sale', quantity: 0, theoreticalQuantity: 200, expenseOnlyAtMovement: true, date, note: 'POS' },
      { id: 'receipt', inventoryId: 'bread', type: 'receipt', quantity: 10, date: '2026-09-22', note: 'Xarid' }],
    dailyCloses: [{ id: 'before', date: '2026-09-22' }, { id: 'selected', date, actualTotal: 1234 }, { id: 'later', date: '2026-09-24' }],
    monthlyCloses: [], deletedItems: [], costRules: { cardCommissionPct: 1.6, taxPct: 10, deliveryCommissionPct: 0 },
    financialEntries: [], transactions: [], posOrders: [], payrollPayments: [], customData: { keep: 'untouched' },
  };
}
