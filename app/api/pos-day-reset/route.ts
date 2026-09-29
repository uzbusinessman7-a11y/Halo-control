import { isAdminRequest } from '../../lib/integration-store';
import { HaloStateConflictError, mutateHaloState, readHaloState } from '../../lib/halo-store';
import { cancelPosDayImport, previewPosDayReset, PosDayResetError } from '../../lib/pos-day-reset';

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: 'Faqat rahbar bekor qila oladi.' }, { status: 401 });
  try {
    const branch = new URL(request.url).searchParams.get('branch') || 'main';
    const body = await request.json();
    if (body.action === 'preview') {
      const current = await readHaloState(branch);
      return Response.json(await previewPosDayReset(current.state, String(body.date || '')), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action !== 'cancel') throw new PosDayResetError('Amal noto‘g‘ri.', 400);
    const input = { date: String(body.date || ''), token: String(body.token || ''), operationId: String(body.operationId || '') };
    const mutation = await mutateHaloState(state => cancelPosDayImport(state, input), 5, branch, 'Rahbar',
      `${input.date} POS importi bekor qilindi · ombor va hisob qaytarildi`, 'POS savdo');
    return Response.json({ ok: true, ...mutation.result, updatedAt: mutation.updatedAt });
  } catch (error) {
    const status = error instanceof PosDayResetError ? error.status : error instanceof HaloStateConflictError ? 409 : 500;
    return Response.json({ error: status === 500 ? 'Amal natijasi tasdiqlanmadi. Shu tugmani qayta bosing; amal ikki marta bajarilmaydi.' : (error as Error).message }, { status });
  }
}
