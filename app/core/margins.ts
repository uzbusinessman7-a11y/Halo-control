/**
 * HALO V2 — «Marja»: har bir taom bitta oynada — sotuv narxi, tannarx va qancha qoladi.
 *
 * - Tannarx «Menyu»dagi retseptdan, ombordagi oxirgi narxlar bilan (recipeViews — o'sha hisob, boshqa formula yo'q).
 * - Marja = narx − tannarx; foiz — narxga nisbatan. Daraja: tannarx ≤ 30% — yaxshi, 30–35% — o'rtacha, > 35% — past
 *   (Menyu sahifasidagi «tannarxi yuqori» chegarasi bilan bir xil).
 * - «Sof»: karta bilan to'langanda soliq va karta foizi ayrilgandan keyin (Ushlanmalar sozlamasidagi foizlar).
 *   Delivery: platforma narxidan platforma foizi va soliq ayriladi (har buyurtmadagi qat'iy summa — buyurtmaga, taomga emas).
 * - Faqat o'qiydi, hech narsa yozmaydi.
 */
import { recipeViews, TARGET_FOOD_COST } from "./recipes";
import { readDeductionRules } from "./deductions";
import { categoryList } from "./categories";
import { DELIVERY_PLATFORMS } from "../lib/delivery-sales";

type Row = Record<string, unknown>;
export const MID_FOOD_COST = 35;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

export interface MarginRow {
  id: string; name: string; categoryId: string; categoryName: string;
  salePrice: number; cost: number | null; margin: number | null; marginPct: number | null; foodCostPct: number | null;
  level: "good" | "mid" | "low" | "none"; status: string; suggestedPrice: number | null;
  net: { amount: number; pct: number | null } | null;
  delivery: Array<{ id: string; label: string; price: number; feePct: number; left: number; leftPct: number | null }>;
}

export function marginReport(state: Row) {
  const rules = readDeductionRules(state);
  const categories = categoryList(state, "recipe");
  const catName = new Map(categories.map((category) => [category.id, category.name]));
  const platformPct = new Map(rules.platforms.map((platform) => [platform.id, platform.pct]));
  const cut = (price: number, percent: number) => Math.round((price * percent) / 100);
  const rows: MarginRow[] = recipeViews(state).map((recipe) => {
    const ready = recipe.cost != null && recipe.salePrice > 0;
    const foodCostPct = ready ? recipe.foodCostPercent : null;
    const level: MarginRow["level"] = !ready || foodCostPct == null ? "none" : foodCostPct <= TARGET_FOOD_COST * 100 ? "good" : foodCostPct <= MID_FOOD_COST ? "mid" : "low";
    const netAmount = ready ? recipe.salePrice - (recipe.cost as number) - cut(recipe.salePrice, rules.taxPct + rules.cardPct) : 0;
    return {
      id: recipe.id, name: recipe.name, categoryId: recipe.categoryId, categoryName: catName.get(recipe.categoryId) || "",
      salePrice: recipe.salePrice, cost: recipe.cost, margin: ready ? recipe.salePrice - (recipe.cost as number) : null,
      marginPct: ready ? pct(recipe.salePrice - (recipe.cost as number), recipe.salePrice) : null, foodCostPct,
      level, status: recipe.status, suggestedPrice: recipe.suggestedPrice,
      net: ready ? { amount: netAmount, pct: pct(netAmount, recipe.salePrice) } : null,
      delivery: recipe.cost == null ? [] : DELIVERY_PLATFORMS.flatMap((platform) => {
        const price = Math.round(Number(recipe.deliveryPrices[platform.id]) || 0);
        if (!(price > 0)) return [];
        const feePct = platformPct.get(platform.id) || 0;
        const left = price - (recipe.cost as number) - cut(price, feePct + rules.taxPct);
        return [{ id: platform.id, label: platform.shortLabel, price, feePct, left, leftPct: pct(left, price) }];
      }),
    };
  });
  const ready = rows.filter((row) => row.level !== "none");
  const avg = (list: MarginRow[], pick: (row: MarginRow) => number | null) => {
    const values = list.map(pick).filter((value): value is number => typeof value === "number");
    return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null;
  };
  return {
    rows,
    categories: categories.filter((category) => rows.some((row) => row.categoryId === category.id)).map((category) => ({ id: category.id, name: category.name })),
    summary: {
      count: rows.length, ready: ready.length, incomplete: rows.length - ready.length,
      good: ready.filter((row) => row.level === "good").length, mid: ready.filter((row) => row.level === "mid").length, low: ready.filter((row) => row.level === "low").length,
      avgMarginPct: avg(ready, (row) => row.marginPct), avgNetPct: avg(ready, (row) => row.net?.pct ?? null),
    },
    rules: { taxPct: rules.taxPct, cardPct: rules.cardPct, targetFoodCost: TARGET_FOOD_COST * 100, midFoodCost: MID_FOOD_COST },
  };
}
