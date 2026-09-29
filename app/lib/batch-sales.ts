import { isExpenseOnlyInventory } from './vegetable-expenses.ts';
import { type InventoryAccountingFields } from './inventory-accounting.ts';
export type BatchSaleRecipe = {
  id: string;
  name: string;
  salePrice: number;
  ingredients: Array<{
    inventoryId?: string;
    quantity: number;
    unitCost?: number;
    lineCost?: number;
  }>;
};

export type BatchSaleInventory = InventoryAccountingFields & {
  id: string;
  name: string;
  unit: string;
  stock: number;
  unitCost: number;
};

export type PreparedBatchSale<TRecipe extends BatchSaleRecipe = BatchSaleRecipe> = {
  recipe: TRecipe;
  quantity: number;
  requirements: Map<string, number>;
};

export function prepareBatchSales<TRecipe extends BatchSaleRecipe>({
  recipes,
  inventory,
  quantities,
}: {
  recipes: TRecipe[];
  inventory: BatchSaleInventory[];
  quantities: Record<string, number>;
}) {
  const selected: PreparedBatchSale<TRecipe>[] = [];
  for (const recipe of recipes) {
    const raw = Number(quantities[recipe.id] || 0);
    if (!Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
      return { ok: false as const, error: `“${recipe.name}” sonini butun va musbat kiriting.` };
    }
    if (raw === 0) continue;
    const requirements = new Map<string, number>();
    recipe.ingredients.forEach((ingredient) => {
      if (!ingredient.inventoryId || !inventory.some((item) => item.id === ingredient.inventoryId)) return;
      requirements.set(
        ingredient.inventoryId,
        (requirements.get(ingredient.inventoryId) || 0) + Number(ingredient.quantity || 0) * raw,
      );
    });
    selected.push({ recipe, quantity: raw, requirements });
  }
  if (!selected.length) return { ok: false as const, error: "Kamida bitta taomning sotilgan sonini kiriting." };

  const totalRequirements = new Map<string, number>();
  selected.forEach((entry) => entry.requirements.forEach((quantity, inventoryId) => {
    totalRequirements.set(inventoryId, (totalRequirements.get(inventoryId) || 0) + quantity);
  }));
  const shortageCount = inventory.filter((item) => !isExpenseOnlyInventory(item) && item.stock + 0.000001 < (totalRequirements.get(item.id) || 0)).length;
  return { ok: true as const, selected, totalRequirements, shortageCount };
}
