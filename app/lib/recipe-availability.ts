type LinkedIngredient = {
  inventoryId?: unknown;
  name?: unknown;
};

export function missingRecipeIngredient(
  recipe: unknown,
  inventory: Array<{ id?: unknown }>,
) {
  const inventoryIds = new Set(inventory.map((item) => String(item.id || "")).filter(Boolean));
  const source = recipe && typeof recipe === "object" ? recipe as { ingredients?: unknown } : {};
  const ingredients = Array.isArray(source.ingredients)
    ? source.ingredients as LinkedIngredient[]
    : [];
  return ingredients.find((ingredient) => {
    const inventoryId = String(ingredient.inventoryId || "");
    return Boolean(inventoryId) && !inventoryIds.has(inventoryId);
  });
}

export function recipeIsSellable(
  recipe: unknown,
  inventory: Array<{ id?: unknown }>,
) {
  return !missingRecipeIngredient(recipe, inventory);
}
