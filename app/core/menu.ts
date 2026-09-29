/**
 * HALO V2 — menyu tahlili (menu engineering, Kasavana–Smith usuli).
 *
 * Har bir taom uchun: menyu narxi, retsept tannarxi, food cost %, bir donadan foyda,
 * davr ichida nechta sotilgan va jami qancha foyda keltirgan. Taomlar 4 guruhga bo'linadi:
 *  - Yulduz: ko'p sotiladi va foydasi yuqori — saqlang, sifatini tushirmang;
 *  - Ishchi ot: ko'p sotiladi, foydasi past — tannarxni kamaytiring yoki narxni ozgina oshiring;
 *  - Jumboq: foydasi yuqori, kam sotiladi — ko'proq ko'rsating, tavsiya qildiring;
 *  - Zaif: kam sotiladi va foydasi past — o'zgartiring yoki menyudan olib tashlang.
 * Hisob faqat o'qiydi, hech narsa yozmaydi.
 */
import { calculateRecipeMarginAudit, type RecipeCostInventory } from "../lib/recipe-costing";

type Row = Record<string, unknown>;
export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export interface MenuItemRow {
  id: string; name: string; price: number; cost: number | null; costPercent: number | null; unitMargin: number | null;
  sold: number; revenue: number; avgPrice: number | null; actualCost: number; contribution: number | null;
  status: string; cls: MenuClass | null; flags: string[];
}
export interface MenuReport {
  from: string; to: string; days: number;
  items: MenuItemRow[];
  totals: { sold: number; revenue: number; contribution: number; avgMargin: number | null; popularityThreshold: number | null };
  counts: Record<MenuClass, number>;
  incomplete: number;
}

const DAY = 86_400_000;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);

export function menuReport(state: Row, today: string, days = 30): MenuReport {
  const span = Math.min(365, Math.max(1, Math.round(days)));
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (span - 1) * DAY).toISOString().slice(0, 10);
  const inventory = rows(state.inventory) as unknown as RecipeCostInventory[];
  const sold = new Map<string, { qty: number; revenue: number; cost: number }>();
  for (const sale of rows(state.sales)) {
    const date = String(sale.date || "");
    if (date < from || date > today) continue;
    const id = String(sale.recipeId || "");
    if (!id) continue;
    const item = sold.get(id) || { qty: 0, revenue: 0, cost: 0 };
    item.qty += Number(sale.quantity) || 0;
    item.revenue += Number(sale.totalRevenue) || 0;
    item.cost += Number(sale.totalCost) || 0;
    sold.set(id, item);
  }

  const items: MenuItemRow[] = rows(state.recipes).filter((recipe) => typeof recipe.id === "string" && recipe.id).map((recipe) => {
    const audit = calculateRecipeMarginAudit(recipe as never, inventory);
    const s = sold.get(String(recipe.id)) || { qty: 0, revenue: 0, cost: 0 };
    const price = Math.round(audit.salePrice);
    const cost = audit.complete ? Math.round(audit.totalCost) : null;
    const unitMargin = cost != null ? price - cost : null;
    const qty = Math.round(s.qty * 1000) / 1000;
    const avgPrice = qty > 0 ? Math.round(s.revenue / qty) : null;
    const flags: string[] = [];
    if (!audit.complete) flags.push(String(audit.status).toLowerCase());
    const costPercent = cost != null && price > 0 ? Math.round((cost / price) * 1000) / 10 : null;
    if (costPercent != null && costPercent > 35) flags.push(`food cost ${costPercent}% — 35% dan yuqori`);
    if (unitMargin != null && unitMargin <= 0) flags.push("zarariga sotilmoqda");
    if (avgPrice != null && price > 0 && Math.abs(avgPrice - price) / price > 0.1) flags.push(`o'rtacha sotuv narxi ${avgPrice.toLocaleString("en-US")} ₩ (menyuda ${price.toLocaleString("en-US")} ₩)`);
    if (qty === 0) flags.push("bu davrda sotilmagan");
    return {
      id: String(recipe.id), name: String(recipe.name || recipe.id), price, cost, costPercent, unitMargin,
      sold: qty, revenue: Math.round(s.revenue), avgPrice, actualCost: Math.round(s.cost),
      contribution: unitMargin != null ? Math.round(unitMargin * qty) : null, status: String(audit.status), cls: null, flags,
    };
  });

  // Tasniflash: faqat tannarxi to'liq va shu davrda menyuda bo'lgan (sotilgan yoki sotilmagan) taomlar.
  const ranked = items.filter((item) => item.unitMargin != null);
  const totalQty = ranked.reduce((sum, item) => sum + item.sold, 0);
  const totalContribution = ranked.reduce((sum, item) => sum + (item.contribution || 0), 0);
  const avgMargin = totalQty > 0 ? totalContribution / totalQty : null;
  const popularityThreshold = ranked.length ? (totalQty / ranked.length) * 0.7 : null;
  const counts: Record<MenuClass, number> = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
  if (avgMargin != null && popularityThreshold != null) {
    for (const item of ranked) {
      const popular = item.sold >= popularityThreshold;
      const profitable = (item.unitMargin || 0) >= avgMargin;
      item.cls = popular ? (profitable ? "star" : "plowhorse") : (profitable ? "puzzle" : "dog");
      counts[item.cls] += 1;
    }
  }
  items.sort((left, right) => (right.contribution ?? -Infinity) - (left.contribution ?? -Infinity) || right.sold - left.sold);
  return {
    from, to: today, days: span, items,
    totals: {
      sold: Math.round(items.reduce((sum, item) => sum + item.sold, 0) * 1000) / 1000,
      revenue: items.reduce((sum, item) => sum + item.revenue, 0),
      contribution: totalContribution,
      avgMargin: avgMargin == null ? null : Math.round(avgMargin),
      popularityThreshold: popularityThreshold == null ? null : Math.round(popularityThreshold * 10) / 10,
    },
    counts,
    incomplete: items.filter((item) => item.unitMargin == null).length,
  };
}
