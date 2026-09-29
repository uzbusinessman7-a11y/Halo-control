import {
  authenticateApiKey,
  writeIntegrationLog,
} from "../../../../lib/integration-store";
import { readHaloState } from "../../../../lib/halo-store";
import { seoulBusinessDate } from "../../../../lib/business-time";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const deliveryPlatforms = new Set(["coupang", "baemin", "yogiyo"]);

function deliveryMetadata(sale: Record<string, unknown>) {
  const metadata: Record<string, string | number> = {};
  const platform = typeof sale.deliveryPlatform === "string" ? sale.deliveryPlatform.trim() : "";
  if (deliveryPlatforms.has(platform)) metadata.deliveryPlatform = platform;

  for (const key of ["deliveryOrderNumber", "deliveryBatchId"] as const) {
    const value = typeof sale[key] === "string" || typeof sale[key] === "number"
      ? String(sale[key]).trim()
      : "";
    if (value) metadata[key] = value;
  }

  const soldAt = typeof sale.soldAt === "string" ? sale.soldAt.trim() : "";
  if (soldAt && Number.isFinite(Date.parse(soldAt))) metadata.soldAt = soldAt;

  const commissionPercent = sale.deliveryCommissionPct === "" || sale.deliveryCommissionPct === null || sale.deliveryCommissionPct === undefined
    ? Number.NaN
    : Number(sale.deliveryCommissionPct);
  if (Number.isFinite(commissionPercent)) {
    metadata.deliveryCommissionPct = Math.min(100, Math.max(0, commissionPercent));
  }

  const commissionAmount = sale.deliveryCommissionAmount === "" || sale.deliveryCommissionAmount === null || sale.deliveryCommissionAmount === undefined
    ? Number.NaN
    : Number(sale.deliveryCommissionAmount);
  if (Number.isFinite(commissionAmount)) {
    metadata.deliveryCommissionAmount = Math.max(0, commissionAmount);
  }
  return metadata;
}

export async function GET(request: Request) {
  const key = await authenticateApiKey(request, "sales:read");
  const endpoint = "/api/integrations/v1/sales";
  if (!key) {
    await writeIntegrationLog({ endpoint, method: "GET", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const today = seoulBusinessDate();
    const from = url.searchParams.get("from") || today;
    const to = url.searchParams.get("to") || from;
    if (!validDate(from) || !validDate(to) || from > to) {
      return Response.json({ ok: false, error: "from va to YYYY-MM-DD formatida bo‘lsin." }, { status: 400 });
    }
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
    const offset = Math.min(100_000, Math.max(0, Number(url.searchParams.get("offset") || 0)));
    const current = await readHaloState(key.branchId);
    const recipes = new Map((Array.isArray(current.state.recipes) ? current.state.recipes : []).map((value) => {
      const recipe = value as Record<string, unknown>;
      return [String(recipe.id || ""), String(recipe.name || "")];
    }));
    const accountTypes = new Map((Array.isArray(current.state.accounts) ? current.state.accounts : []).map((value) => {
      const account = value as Record<string, unknown>;
      return [String(account.id || ""), String(account.type || "")];
    }));
    const allSales = (Array.isArray(current.state.sales) ? current.state.sales : [])
      .map((value) => value as Record<string, unknown>)
      .filter((sale) => String(sale.date || "") >= from && String(sale.date || "") <= to)
      .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")) || String(right.id || "").localeCompare(String(left.id || "")));
    const sales = allSales.slice(offset, offset + limit).map((sale) => ({
      id: String(sale.id || ""),
      date: String(sale.date || ""),
      recipeId: String(sale.recipeId || ""),
      productName: recipes.get(String(sale.recipeId || "")) || "O‘chirilgan taom",
      quantity: Number(sale.quantity || 0),
      unitPrice: Number(sale.unitPrice || 0),
      totalRevenue: Number(sale.totalRevenue || 0),
      totalCost: Number(sale.totalCost || 0),
      accountId: String(sale.accountId || "account-card"),
      source: String(sale.source || "manual"),
      reportingMode: ["cash", "bank"].includes(accountTypes.get(String(sale.accountId || "")) || "")
        ? "inventory_only"
        : "financial_sale",
      externalId: String(sale.externalId || ""),
      ...deliveryMetadata(sale),
    }));
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 200, message: `${sales.length} ta savdo yozuvi` });
    return Response.json({
      ok: true,
      branchId: key.branchId,
      from,
      to,
      total: allSales.length,
      offset,
      limit,
      nextOffset: offset + sales.length < allSales.length ? offset + sales.length : null,
      sales,
      updatedAt: current.updatedAt,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 500, message: "Savdo ma’lumoti ochilmadi" });
    return Response.json({ ok: false, error: "Savdo ma’lumoti ochilmadi." }, { status: 500 });
  }
}
