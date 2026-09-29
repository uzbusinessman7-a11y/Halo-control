type UnknownRecord = Record<string, unknown>;

export type InventoryPackaging = {
  packageName: string;
  unitsPerPackage: number;
  packageCost: number;
  gramsPerUnit: number;
  unitCost: number;
};

const finiteNonNegative = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

export function calculatePackagedInventory(
  packageCount: unknown,
  unitsPerPackage: unknown,
  packageCost: unknown,
) {
  const packages = finiteNonNegative(packageCount);
  const units = Number(unitsPerPackage);
  const cost = finiteNonNegative(packageCost);
  if (!Number.isFinite(units) || units <= 0) return { stock: 0, unitCost: 0 };
  const stock = packages * units;
  const unitCost = cost / units;
  return {
    stock: Number.isFinite(stock) ? stock : 0,
    unitCost: Number.isFinite(unitCost) ? unitCost : 0,
  };
}

export function normalizeInventoryPackaging(value: UnknownRecord): InventoryPackaging {
  const fallbackUnitCost = finiteNonNegative(value.unitCost);
  const rawUnits = Number(value.unitsPerPackage);
  const unitsPerPackage = Number.isFinite(rawUnits) && rawUnits > 0 ? rawUnits : 1;
  const rawPackageCost = Number(value.packageCost);
  const packageCost = Number.isFinite(rawPackageCost) && rawPackageCost >= 0
    ? rawPackageCost
    : fallbackUnitCost * unitsPerPackage;
  const packageName = typeof value.packageName === "string" && value.packageName.trim()
    ? value.packageName.trim().slice(0, 30)
    : "birlik";
  const gramsPerUnit = finiteNonNegative(value.gramsPerUnit);
  const unitCost = packageCost / unitsPerPackage;
  return {
    packageName,
    unitsPerPackage,
    packageCost,
    gramsPerUnit,
    unitCost: Number.isFinite(unitCost) ? unitCost : fallbackUnitCost,
  };
}

export function validInventoryPackaging(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const item = entry as UnknownRecord;
    const hasPackaging = item.packageName !== undefined
      || item.unitsPerPackage !== undefined
      || item.packageCost !== undefined
      || item.gramsPerUnit !== undefined;
    if (!hasPackaging) return true;
    if (
      typeof item.packageName !== "string"
      || !item.packageName.trim()
      || item.packageName.trim().length > 30
      || typeof item.unitsPerPackage !== "number"
      || !Number.isFinite(item.unitsPerPackage)
      || item.unitsPerPackage <= 0
      || item.unitsPerPackage > 1_000_000_000
      || typeof item.packageCost !== "number"
      || !Number.isFinite(item.packageCost)
      || item.packageCost < 0
      || item.packageCost > 1_000_000_000_000
      || typeof item.unitCost !== "number"
      || !Number.isFinite(item.unitCost)
      || item.unitCost < 0
      || (item.gramsPerUnit !== undefined && (
        typeof item.gramsPerUnit !== "number"
        || !Number.isFinite(item.gramsPerUnit)
        || item.gramsPerUnit < 0
        || item.gramsPerUnit > 1_000_000_000
      ))
    ) return false;
    const expectedUnitCost = item.packageCost / item.unitsPerPackage;
    const tolerance = Math.max(0.000001, Math.abs(expectedUnitCost) * 1e-9);
    return Math.abs(item.unitCost - expectedUnitCost) <= tolerance;
  });
}
