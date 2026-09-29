import {
  authenticateApiKey,
  listProductMappings,
  writeIntegrationLog,
} from "../../../../lib/integration-store";
import { readHaloState } from "../../../../lib/halo-store";
import {
  inferLegacyCategoryId,
  normalizeProductCategories,
  validCategoryId,
} from "../../../../lib/product-categories";
import { ensureMenuCodes } from "../../../../lib/menu-codes.ts";

export async function GET(request: Request) {
  const key = await authenticateApiKey(request, "products:read");
  if (!key) {
    await writeIntegrationLog({ endpoint: "/api/pos/v1/products", method: "GET", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const branchId = key.branchId;
    const [current, mappings] = await Promise.all([readHaloState(branchId), listProductMappings(branchId)]);
    const recipes = ensureMenuCodes((Array.isArray(current.state.recipes) ? current.state.recipes : []) as Array<{
      id: string;
      name?: string;
      posCode?: string;
      salePrice?: number;
      categoryId?: string;
      ingredients?: Array<{ inventoryId?: string }>;
    }>);
    const categories = normalizeProductCategories(current.state.productCategories);
    const products = recipes.map((recipe) => {
      const linked = mappings.filter((mapping) => mapping.recipeId === recipe.id);
      const categoryId = validCategoryId(
        categories,
        "recipe",
        recipe.categoryId || inferLegacyCategoryId("recipe", String(recipe.name || "")),
      );
      return {
        id: recipe.id,
        code: recipe.posCode || "",
        name: recipe.name,
        salePrice: Number(recipe.salePrice || 0),
        categoryId,
        categoryName: categories.find((category) => category.kind === "recipe" && category.id === categoryId)?.name || "Boshqa taom",
        externalProducts: linked.map((mapping) => ({
          code: mapping.externalCode,
          name: mapping.externalName,
        })),
      };
    });
    await writeIntegrationLog({ branchId, keyId: key.id, endpoint: "/api/pos/v1/products", method: "GET", status: 200, message: `${products.length} ta mahsulot` });
    return Response.json({ ok: true, branchId, products, updatedAt: current.updatedAt });
  } catch {
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint: "/api/pos/v1/products", method: "GET", status: 500, message: "Mahsulotlar ochilmadi" });
    return Response.json({ ok: false, error: "Mahsulotlar ochilmadi." }, { status: 500 });
  }
}
