export function resetInventoryForFreshCount(value: unknown) {
  if (!Array.isArray(value)) return [] as unknown[];
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return {
      ...(entry as Record<string, unknown>),
      stock: 0,
      minStock: 0,
      unitCost: 0,
      packageCost: 0,
      gramsPerUnit: 0,
      // Packaging validation requires a positive conversion value. Keeping 1
      // makes every saved product immediately editable while every count and
      // price field starts from zero.
      unitsPerPackage: 1,
    };
  });
}
