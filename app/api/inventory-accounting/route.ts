import { isExpenseOnlyInventory } from "../../lib/vegetable-expenses";
import { isAdminRequest } from '../../lib/integration-store';
import { authenticateWorkerRequest } from '../../lib/worker-auth';
import { HaloStateConflictError, mutateHaloState, readHaloState } from '../../lib/halo-store';
import { configureInventoryAccounting, saveAccountingCount, InventoryCountingError } from '../../lib/inventory-counting';
import { inventoryVarianceReports, inventoryCountView } from '../../lib/inventory-accounting';
type Row = Record<string, any>;
async function access(request: Request) {
  const workerPortal = new URL(request.url).searchParams.get('portal') === 'worker';
  if (!workerPortal && await isAdminRequest(request)) return { owner: true, id: 'owner', name: 'Rahbar', branch: new URL(request.url).searchParams.get('branch') || 'main' };
  const worker = await authenticateWorkerRequest(request);
  return worker ? { owner: false, id: worker.userId, name: worker.name, branch: worker.branchId } : null;
}
export async function GET(request: Request) {
  const actor = await access(request);
  if (!actor) return Response.json({ error: 'Avval tizimga kiring.' }, { status: 401 });
  try {
    const { state } = await readHaloState(actor.branch);
    const inventory = (state.inventory as Row[]).filter(item => !item.catalogArchived && (actor.owner || !isExpenseOnlyInventory(item))).map(({ id, name, unit, stock, packageName, unitsPerPackage, expenseOnly, supplierId, unitCost }) => ({ id, name, unit, stock, packageName, unitsPerPackage, expenseOnly: expenseOnly === true, ...(actor.owner ? { supplierId, unitCost } : {}) }));
    const counts = (Array.isArray(state.inventoryCounts) ? state.inventoryCounts as Row[] : []).map(inventoryCountView);
    return Response.json({ inventory, suppliers: actor.owner ? (Array.isArray(state.suppliers) ? state.suppliers as Row[] : []).map(s => ({ id: s.id, name: s.name })) : [], counts, reports: inventoryVarianceReports({ ...state, inventoryCounts: counts }), owner: actor.owner }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: 'Ombor hisobini yuklab bo‘lmadi.' }, { status: 500 }); }
}
export async function POST(request: Request) {
  const actor = await access(request);
  if (!actor) return Response.json({ error: 'Avval tizimga kiring.' }, { status: 401 });
  try {
    const body = await request.json() as Row;
    if (body.action === 'notify') return Response.json({ ok: true, sent: 0, failed: 0 });
    if (!['configure', 'count'].includes(body.action)) return Response.json({ error: 'Amal noto‘g‘ri.' }, { status: 400 });
    if (body.action === 'configure' && !actor.owner) return Response.json({ error: 'Hisoblash usulini faqat rahbar o‘zgartiradi.' }, { status: 403 });
    const mutation = await mutateHaloState<unknown>(state => body.action === 'configure'
      ? configureInventoryAccounting(state, body)
      : saveAccountingCount(state, body, { id: actor.id, name: actor.name }), 5, actor.branch, actor.name, body.action === 'count' ? 'Ombor sanog‘i saqlandi' : 'Ombor hisoblash usuli yangilandi', 'Ombor');
    return Response.json({ ok: true, result: mutation.result });
  } catch (error) {
    return Response.json({ error: error instanceof InventoryCountingError ? error.message : error instanceof HaloStateConflictError ? 'Boshqa qurilmada o‘zgarish bor. Qayta urinib ko‘ring.' : 'Sanoq saqlanmadi.' }, { status: error instanceof InventoryCountingError ? 400 : error instanceof HaloStateConflictError ? 409 : 500 });
  }
}
