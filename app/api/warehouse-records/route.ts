import { isAdminRequest } from '../../lib/integration-store';
import { HaloStateConflictError, mutateHaloState } from '../../lib/halo-store';
import { applyWarehouseRecord, WarehouseRecordError } from '../../lib/warehouse-records';
import { IntakeError } from '../../lib/unified-intake';
import { InventoryOperationError } from '../../lib/inventory-operations';
import { WarehouseDeletionError } from '../../lib/inventory-deletions';
import { VegetableExpenseError } from '../../lib/vegetable-expenses';
export async function POST(request: Request) {
 if(!await isAdminRequest(request)) return Response.json({error:'Kirish taqiqlangan.'},{status:401});
 try {
  const branch=new URL(request.url).searchParams.get('branch')||'main';
  const input=await request.json();
  const result=await mutateHaloState((state)=>applyWarehouseRecord(state,input),5,branch,'Rahbar',`Kirim ${input.action==='cancel'?'bekor qilindi':'tahrirlandi'} · ${String(input.reason||'').slice(0,300)}`,'Ombor',true);
  return Response.json({ok:true,updatedAt:result.updatedAt,...result.result});
 } catch(error) {
  if(error instanceof HaloStateConflictError)return Response.json({error:'Ma’lumot yangilandi. Qayta tekshiring.'},{status:409});
  if(error instanceof WarehouseRecordError||error instanceof InventoryOperationError||error instanceof WarehouseDeletionError||error instanceof VegetableExpenseError)return Response.json({error:error.message},{status:error.status});
  if(error instanceof IntakeError)return Response.json({error:error.message},{status:400});
  return Response.json({error:'Amal saqlanmadi. Hech bir qism alohida saqlanmaydi; yangilab qayta urinib ko‘ring.'},{status:500});
 }
}
