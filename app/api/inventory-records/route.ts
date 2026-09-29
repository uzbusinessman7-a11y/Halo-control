import { setInventoryCatalogArchived, InventoryCatalogError } from "../../lib/inventory-catalog-archive";
import { VegetableExpenseError } from '../../lib/vegetable-expenses';
import { saveAccountingCount, InventoryCountingError } from "../../lib/inventory-counting";
import {
  archiveStockMovement,
  WarehouseDeletionError,
} from "../../lib/inventory-deletions";
import { HaloStateConflictError, mutateHaloState } from "../../lib/halo-store";
import { isAdminRequest } from "../../lib/integration-store";
import {
  InventoryOperationError,
  saveInventoryMovement,
} from "../../lib/inventory-operations";

type InventoryDeletionResult = {
  kind: "inventory" | "stockMovement";
  id: string;
  label: string;
  alreadyDeleted: boolean;
  detachedMovementCount: number;
};

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  return Response.json({ error: "Faqat o‘chirish amali mavjud." }, { status: 405 });
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const branchId = new URL(request.url).searchParams.get("branch") || "main";
    const body = await request.json() as {
      action?: unknown;
      movement?: unknown;
      originalId?: unknown;
      counts?: unknown;
      date?: unknown;
      operationId?: unknown;
      label?: unknown;
      id?: unknown;
    };
    const action = String(body.action || "");
    if (!["saveMovement", "saveCount", "restoreProduct"].includes(action)) {
      return Response.json({ error: "Ombor amalini tekshiring." }, { status: 400 });
    }
    const movement = body.movement && typeof body.movement === "object"
      ? body.movement as Record<string, unknown>
      : {};
    const label = String(body.label || movement.inventoryId || "").trim().slice(0, 100);
    const mutation = await mutateHaloState<Record<string, unknown>>(
      (state) => action === "restoreProduct" ? setInventoryCatalogArchived(state, String(body.id || ""), false) : action === "saveMovement"
        ? saveInventoryMovement(state, { movement: body.movement, originalId: body.originalId })
        : saveAccountingCount(state, { counts: body.counts, date: body.date, operationId: body.operationId }, { id: "owner", name: "Rahbar" }),
      5,
      branchId,
      "Rahbar",
      action === "restoreProduct" ? "Ombor mahsuloti faol ro‘yxatga tiklandi" : action === "saveMovement" ? `Ombor harakati saqlandi · ${label}` : "Ombor sanog‘i saqlandi",
      "Ombor",
    );
    return Response.json({ ok: true, updatedAt: mutation.updatedAt, ...mutation.result });
  } catch (error) {
    if (error instanceof InventoryCatalogError || error instanceof VegetableExpenseError || error instanceof InventoryOperationError || error instanceof InventoryCountingError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof HaloStateConflictError) {
      return Response.json({ error: "Ma’lumot boshqa qurilmada yangilandi. Qayta urinib ko‘ring." }, { status: 409 });
    }
    return Response.json({ error: "Ombor amali saqlanmadi. Qayta urinib ko‘ring." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!await isAdminRequest(request)) {
    return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  }
  try {
    const branchId = new URL(request.url).searchParams.get("branch") || "main";
    const body = await request.json() as { kind?: unknown; id?: unknown; reason?: unknown };
    const kind = String(body.kind || "");
    const entityId = String(body.id || "").trim();
    const reason = String(body.reason || "");
    if (!entityId || !["inventory", "stockMovement"].includes(kind)) {
      return Response.json({ error: "O‘chiriladigan Ombor yozuvini tekshiring." }, { status: 400 });
    }
    const mutation = await mutateHaloState<InventoryDeletionResult>(
      (state) => kind === "inventory"
        ? setInventoryCatalogArchived(state, entityId, true, reason)
        : archiveStockMovement(state, entityId, reason),
      5,
      branchId,
      "Rahbar",
      kind === "inventory" ? "Ombor mahsuloti faol ro‘yxatdan olib tashlandi; hisob tarixi saqlandi" : "Ombor harakati savatga ko‘chirildi",
      "Ombor",
    );
    return Response.json({ ok: true, updatedAt: mutation.updatedAt, ...mutation.result });
  } catch (error) {
    if (error instanceof InventoryCatalogError || error instanceof WarehouseDeletionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof HaloStateConflictError) {
      return Response.json({ error: "Ma’lumot boshqa qurilmada yangilandi. Qayta urinib ko‘ring." }, { status: 409 });
    }
    return Response.json({ error: "Ombor yozuvi o‘chirilmadi. Qayta urinib ko‘ring." }, { status: 500 });
  }
}
