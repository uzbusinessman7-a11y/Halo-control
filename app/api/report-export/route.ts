import { isAdminRequest } from '../../lib/integration-store';
import { readHaloState } from '../../lib/halo-store';
import { activeBranch } from '../../lib/assistant-store';
import { buildReportExport, validateExport } from '../../lib/report-export';
export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({error:'Kirish taqiqlangan.'},{status:401});
  const q=new URL(request.url).searchParams;
  const kind=q.get('kind')||'suppliers',from=q.get('from')||'',to=q.get('to')||'',branch=q.get('branch')||'main';
  try { validateExport(kind,from,to); } catch(e) {return Response.json({error:(e as Error).message},{status:400});}
  try {
    await activeBranch(branch);
    const current=await readHaloState(branch);
    const file=buildReportExport(current.state,kind,branch,from,to);
    return new Response(file.content,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${file.filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  } catch {return Response.json({error:'Hisobot yuklanmadi. Filialni tekshirib qayta urinib ko‘ring.'},{status:503});}
}
