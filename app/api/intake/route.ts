import { VegetableExpenseError } from '../../lib/vegetable-expenses';
import { isAdminRequest } from '../../lib/integration-store';
import { mutateHaloState } from '../../lib/halo-store';
import { applyUnifiedIntake, cancelUnifiedIntake, IntakeError } from '../../lib/unified-intake';
import { applyWarehouseIntake } from '../../lib/warehouse-intake';
export async function POST(request: Request) {
 if(!await isAdminRequest(request)) return Response.json({error:'Kirish taqiqlangan.'},{status:401});
 try {
  const branchId=new URL(request.url).searchParams.get('branch')||'main';
  const body=await request.json();
  const result=await mutateHaloState<Record<string, unknown>>((state)=>{
   if(body.action==='cancel')return cancelUnifiedIntake(state,body);
   if(body.inventoryOnly===true)return applyWarehouseIntake(state,body);
   // A retry of an already saved legacy receipt is harmless. A cached old
   // form must reload instead of creating another stock-and-debt document.
   if(Array.isArray(state.transactions)&&state.transactions.some((t:any)=>t.id===`intake:${body.operationId}`))return applyUnifiedIntake(state,body);
   throw new IntakeError('Kirim tartibi yangilandi. Sahifani yangilang: mahsulot omborga, qarz va to‘lov yetkazib beruvchilar bo‘limiga kiritiladi.','INTAKE_FORM_OUTDATED');
  },7,branchId,'Rahbar',body.action==='cancel'?'Xarid / kirim bekor qilindi':'Ombor kirimi saqlandi; qarz va to‘lov alohida','Xarid / kirim',true);
  return Response.json({ok:true,...result.result,updatedAt:result.updatedAt});
 }catch(error){return Response.json({error:(error instanceof IntakeError || error instanceof VegetableExpenseError)?error.message:'Kirim saqlanmadi. Yangilab, qayta urinib ko‘ring.',...(error instanceof IntakeError && error.code ? {code:error.code} : {})},{status:(error instanceof IntakeError || error instanceof VegetableExpenseError)?400:500});}
}
