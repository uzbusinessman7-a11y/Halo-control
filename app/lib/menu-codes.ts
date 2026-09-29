export type CodedRecipe = {
  id: string;
  posCode?: string;
  posAliases?: string[];
};

export function normalizeMenuCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleUpperCase("en-US")
    .replace(/\s+/g, "")
    .slice(0, 100);
}

export function nextMenuCode(recipes: Array<Pick<CodedRecipe, "posCode">>) {
  const used = new Set(recipes.map((recipe) => normalizeMenuCode(recipe.posCode)).filter(Boolean));
  let number = 1;
  while (used.has(`M${String(number).padStart(4, "0")}`)) number += 1;
  return `M${String(number).padStart(4, "0")}`;
}

export function ensureMenuCodes<T extends CodedRecipe>(recipes: T[]): T[] {
  const used = new Set<string>();
  let nextNumber = 1;
  const takeGenerated = () => {
    let code = `M${String(nextNumber).padStart(4, "0")}`;
    while (used.has(code)) {
      nextNumber += 1;
      code = `M${String(nextNumber).padStart(4, "0")}`;
    }
    used.add(code);
    nextNumber += 1;
    return code;
  };

  return recipes.map((recipe) => {
    const requested = normalizeMenuCode(recipe.posCode);
    const posCode = requested && !used.has(requested) ? requested : takeGenerated();
    used.add(posCode);
    const posAliases = [...new Set((Array.isArray(recipe.posAliases) ? recipe.posAliases : [])
      .map(normalizeMenuCode)
      .filter((code) => code && code !== posCode))];
    return { ...recipe, posCode, posAliases };
  });
}

export function recipeHasMenuCode(recipe: Pick<CodedRecipe, "posCode" | "posAliases">, value: unknown) {
  const code = normalizeMenuCode(value);
  if (!code) return false;
  return normalizeMenuCode(recipe.posCode) === code
    || (Array.isArray(recipe.posAliases) && recipe.posAliases.some((alias) => normalizeMenuCode(alias) === code));
}

export function preferredMenuCode(recipe: Pick<CodedRecipe, "posCode" | "posAliases">) {
  const primary = normalizeMenuCode(recipe.posCode);
  const aliases = (Array.isArray(recipe.posAliases) ? recipe.posAliases : [])
    .map(normalizeMenuCode)
    .filter(Boolean);
  return /^M\d{4}$/.test(primary) && aliases.length ? aliases.at(-1)! : primary || aliases.at(-1) || "";
}

export function allMenuCodes(recipe: Pick<CodedRecipe, "posCode" | "posAliases">) {
  const preferred = preferredMenuCode(recipe);
  return [...new Set([
    preferred,
    normalizeMenuCode(recipe.posCode),
    ...(Array.isArray(recipe.posAliases) ? recipe.posAliases.map(normalizeMenuCode) : []),
  ].filter(Boolean))];
}

export function promoteLearnedMenuCodes<T extends CodedRecipe>(
  recipes: T[],
  learned: Array<{ recipeId: string; code: unknown }>,
) {
  const learnedByRecipe = new Map<string, string[]>();
  const ownerByCode = new Map<string, string>();
  learned.forEach(({ recipeId, code: rawCode }) => {
    const code = normalizeMenuCode(rawCode);
    if (!recipeId || !code) return;
    ownerByCode.set(code, recipeId);
    const codes = learnedByRecipe.get(recipeId) || [];
    if (!codes.includes(code)) codes.push(code);
    learnedByRecipe.set(recipeId, codes);
  });
  return recipes.map((recipe) => {
    const learnedCodes = learnedByRecipe.get(recipe.id) || [];
    const currentPrimary = normalizeMenuCode(recipe.posCode);
    const nextPrimary = learnedCodes.at(-1) || currentPrimary;
    const aliases = new Set([
      ...(Array.isArray(recipe.posAliases) ? recipe.posAliases : []),
      ...(currentPrimary && currentPrimary !== nextPrimary ? [currentPrimary] : []),
      ...learnedCodes.slice(0, -1),
    ].map(normalizeMenuCode).filter(Boolean));
    aliases.delete(nextPrimary);
    ownerByCode.forEach((ownerId, code) => {
      if (ownerId !== recipe.id) aliases.delete(code);
    });
    return { ...recipe, posCode: nextPrimary, posAliases: [...aliases] };
  });
}
