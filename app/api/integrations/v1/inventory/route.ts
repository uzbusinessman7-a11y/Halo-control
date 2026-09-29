import { isExpenseOnlyInventory } from "../../../../lib/vegetable-expenses";
import {
  authenticateApiKey,
  writeIntegrationLog,
} from "../../../../lib/integration-store";
import { readHaloState } from "../../../../lib/halo-store";
import {
  inferLegacyCategoryId,
  normalizeProductCategories,
  validCategoryId,
} from "../../../../lib/product-categories";

export async function GET(request: Request) {
  const key = await authenticateApiKey(request, "inventory:read");
  const endpoint = "/api/integrations/v1/inventory";
  if (!key) {
    await writeIntegrationLog({ endpoint, method: "GET", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const current = await readHaloState(key.branchId);
    const categories = normalizeProductCategories(current.state.productCategories);
    const items = (Array.isArray(current.state.inventory) ? current.state.inventory : []).filter((item: any) => !isExpenseOnlyInventory(item)).map((value) => {
      const item = value as Record<string, unknown>;
      const categoryId = validCategoryId(
        categories,
        "inventory",
        String(item.categoryId || inferLegacyCategoryId("inventory", String(item.name || ""))),
      );
      const stock = Number(item.stock || 0);
      const unitCost = Number(item.unitCost || 0);
      const minStock = Number(item.minStock || 0);
      return {
        id: String(item.id || ""),
        name: String(item.name || ""),
        unit: String(item.unit || ""),
        stock,
        minStock,
        unitCost,
        stockValue: stock * unitCost,
        lowStock: stock <= minStock,
        supplierId: String(item.supplierId || ""),
        categoryId,
        categoryName: categories.find((category) => category.kind === "inventory" && category.id === categoryId)?.name || "Boshqa xomashyo",
      };
    });
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 200, message: `${items.length} ta ombor mahsuloti` });
    return Response.json({ ok: true, branchId: key.branchId, items, updatedAt: current.updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 500, message: "Ombor ma’lumoti ochilmadi" });
    return Response.json({ ok: false, error: "Ombor ma’lumoti ochilmadi." }, { status: 500 });
  }
}
