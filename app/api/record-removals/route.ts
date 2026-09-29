import { isAdminRequest } from '../../lib/integration-store';
import { readHaloState, mutateHaloState, HaloStateConflictError } from '../../lib/halo-store';
import { applyRecordRemoval, projectRemoval, removalFingerprint, RecordRemovalError } from '../../lib/record-removals';

export async function GET(request:Request) {
  if(!await isAdminRequest(request))return Response.json({error:'Faqat rahbar uchun.'},{status:401});
  const {state}=await readHaloState(new URL(request.url).searchParams.get('branch')||'main');
  const history=Array.isArray(state.recordRemovals)?state.recordRemovals:[];
  return Response.json({history:history.map((r:any)=>({id:r.id,at:r.at,by:r.by,label:r.label,reason:r.reason,effects:r.effects}))},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: 'Olib tashlash faqat rahbar uchun.' }, { status: 401 });
  try {
    const branch = new URL(request.url).searchParams.get('branch') || 'main';
    const body = await request.json();
    if (body.action === 'preview') {
      const { state } = await readHaloState(branch);
      const result = projectRemoval(state,body,'Tekshirish uchun','preview-removal');
      return Response.json({ expected: await removalFingerprint(state), description: result.description, effects: result.effects }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action !== 'remove') return Response.json({ error: 'Amalni tekshiring.' }, { status: 400 });
    const mutation = await mutateHaloState(state=>applyRecordRemoval(state,body),5,branch,'Rahbar',`Olib tashlandi · ${String(body.label||body.id).slice(0,70)} · ${String(body.reason||'').slice(0,60)}`,'Olib tashlanganlar',true);
    return Response.json({ ok:true, ...mutation.result, updatedAt:mutation.updatedAt });
  } catch (error) {
    if (error instanceof HaloStateConflictError) return Response.json({error:'Ma’lumot yangilandi. Qayta tekshiring.'},{status:409});
    if (error instanceof Error && (error instanceof RecordRemovalError || error.constructor.name.endsWith('Error') && ['WarehouseRecordError','WarehouseDeletionError','IntakeError','VegetableExpenseError','MezanaPostingError','SupplierRecordSafetyError'].includes(error.constructor.name))) return Response.json({error:error.message},{status:409});
    return Response.json({error:'Olib tashlash saqlanmadi. Hisoblar qisman o‘zgartirilmaydi. Qayta urinib ko‘ring.'},{status:500});
  }
}
