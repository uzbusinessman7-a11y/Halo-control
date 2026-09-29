type CatalogEntry = { id: string; name: string; posCode?: string; categoryId: string };
type CatalogCategory = { id: string; name: string; sortOrder?: number };

function searchText(value: string) {
  return value.normalize("NFKC").toLowerCase()
    .replace(/['‘’ʻʼ`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function filterPosCatalog<T extends CatalogEntry>(catalog: T[], categories: CatalogCategory[], query: string): T[] {
  const words = searchText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return catalog;
  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  return catalog.filter(item => {
    const text = searchText(`${item.name} ${item.posCode || ""} ${categoryNames.get(item.categoryId) || ""}`);
    return words.every(word => text.includes(word));
  });
}

// Legacy or unassigned categories must never hide an otherwise valid menu item.
export function groupPosCatalog<T extends CatalogEntry>(catalog: T[], categories: CatalogCategory[], query = "") {
  const remaining = new Set(catalog);
  const groups: Array<{ id: string; name: string; items: T[] }> = [];
  for (const category of [...categories].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))) {
    const items = catalog.filter(item => remaining.has(item) && item.categoryId === category.id);
    if (!items.length) continue;
    items.forEach(item => remaining.delete(item));
    groups.push({ id: category.id, name: category.name, items });
  }
  if (remaining.size) groups.push({ id: "__uncategorized_menu__", name: "Boshqa taomlar", items: [...remaining] });
  if (query.trim()) {
    const matches = new Set(filterPosCatalog(catalog, categories, query));
    for (const group of groups) group.items.sort((a, b) => Number(matches.has(b)) - Number(matches.has(a)));
    groups.sort((a, b) => Number(b.items.some(item => matches.has(item))) - Number(a.items.some(item => matches.has(item))));
  }
  return groups;
}
