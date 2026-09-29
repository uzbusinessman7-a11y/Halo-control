import { isAdminRequest } from "../../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../../lib/halo-store";
import { runBridge } from "../../../../core/bridge-sync";
import { LedgerError } from "../../../../core/ledger";
import type { D1Like } from "../../../../lib/full-migration";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/admin/v2/bridge";
/** HALO — birinchi biznes. Keyingi bizneslar o'z tenant ID'sini oladi. */
const TENANT_ID = "halo";

const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function database(): D1Like {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
}

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = await listHaloBranches();
  return new Response(page(branches.map((branch) => ({ id: branch.id, name: branch.name })), globalThis.__HALO_SELF_HOSTED__ === true), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return Response.json({ error: "V2 faqat yangi saytda sinovdan o'tkaziladi." }, { status: 403 });
  try {
    const body = await request.json() as { branchId?: unknown };
    const branchId = String(body.branchId || "main");
    const { state } = await readHaloState(branchId);
    const report = await runBridge(database(), { tenantId: TENANT_ID, branchId }, state as Record<string, unknown>, seoulToday());
    return Response.json({ ok: report.ok, report });
  } catch (error) {
    const message = error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message)) ? error.message : "Ko'prik bajarilmadi.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function page(branches: Array<{ id: string; name: string }>, selfHosted: boolean): string {
  const options = branches.map((branch) => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`).join("");
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>HALO V2 — pul jurnali</title>
<style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--text:#16181d;--muted:#5d6470;--line:#d7dbe2;--accent:#0f766e;--ok:#067647;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--text:#eef0f3;--muted:#a3a9b4;--line:#2c313a;--accent:#2dd4bf;--ok:#32d583;--bad:#f97066}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{max-width:760px;margin:24px auto;display:grid;gap:16px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
h1{margin:0 0 4px;font-size:22px}h2{margin:0 0 8px;font-size:17px}p{margin:0 0 12px;color:var(--muted)}
select,button{font:inherit;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit}
button{background:var(--accent);color:#fff;border:0;font-weight:700;cursor:pointer}button:disabled{opacity:.5}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.big{font-size:28px;font-weight:800;margin:4px 0}.ok{color:var(--ok)}.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:10px}
.stat{border:1px solid var(--line);border-radius:10px;padding:10px}.stat b{display:block;font-size:20px}.stat span{font-size:13px;color:var(--muted)}
ul{margin:8px 0 0;padding-left:18px;font-size:14px}
</style></head><body><main>
<section><h1>Yangi pul jurnali — sinov</h1>
<p>Eski tizimdagi savdo va pul yozuvlari yangi ikki tomonlama jurnalga o'tkaziladi va har bir hisob <b>wonma-won</b> solishtiriladi. Eski ma'lumotlar o'zgarmaydi. Qayta bosish xavfsiz — hech narsa takror yozilmaydi.</p>
${selfHosted ? `<div class="row"><select id="branch">${options}</select><button id="run">Ishga tushirish va solishtirish</button></div>` : `<p class="bad">Bu sahifa faqat yangi saytda ishlaydi.</p>`}
</section>
<section id="out" hidden></section>
</main>
${selfHosted ? `<script>
const out=document.getElementById('out'),run=document.getElementById('run'),branch=document.getElementById('branch');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won=n=>(n<0?'−':'')+Math.abs(Number(n||0)).toLocaleString('en-US')+' ₩';
const list=(title,items)=>items.length?'<h2>'+title+' ('+items.length+')</h2><ul>'+items.slice(0,20).map(i=>'<li>'+esc(i)+'</li>').join('')+(items.length>20?'<li>… yana '+(items.length-20)+' ta</li>':'')+'</ul>':'';
run.addEventListener('click',async()=>{run.disabled=true;out.hidden=false;out.innerHTML='<p>Ishlanmoqda… katta tarixda bir necha soniya ketishi mumkin.</p>';
  let res;try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({branchId:branch.value})});res=await r.json();}catch{res={ok:false,error:'Server javob bermadi.'}}
  run.disabled=false;
  if(!res.report){out.innerHTML='<p class="bad">'+esc(res.error||'Xato')+'</p>';return;}
  const r=res.report;
  out.innerHTML='<div class="big '+(r.ok?'ok':'bad')+'">'+(r.ok?'✓ Hammasi wonma-won mos':'✗ Farq topildi')+'</div>'
   +'<p>'+(r.ledgerBalanced?'Jurnal muvozanatda: barcha yozuvlar yig‘indisi 0 ₩.':'<span class="bad">Jurnal muvozanatda emas!</span>')+'</p>'
   +'<div class="stats"><div class="stat"><b>'+r.posted+'</b><span>yangi yozildi</span></div><div class="stat"><b>'+r.alreadyPosted+'</b><span>oldin yozilgan</span></div><div class="stat"><b>'+r.reversed+'</b><span>teskari yozuv</span></div><div class="stat"><b>'+r.unmatched.length+'</b><span>hisobi topilmagan</span></div></div>'
   +'<table><tr><th>Pul hisobi</th><th class="n">Eski tizim</th><th class="n">Yangi jurnal</th><th class="n">Farq</th></tr>'
   +r.comparison.map(c=>'<tr><td>'+esc(c.name)+'</td><td class="n">'+won(c.oldBalance)+'</td><td class="n">'+won(c.ledgerBalance)+'</td><td class="n '+(c.difference?'bad':'ok')+'">'+(c.difference?won(c.difference):'✓ 0')+'</td></tr>').join('')+'</table>'
   +list('Keyin o‘zgartirilgan eski yozuvlar',r.changed)+list('Yozilmagan yozuvlar',r.invalid)+list('Pul hisobi topilmagan (eski tizimda ham hisobga kirmaydi)',r.unmatched);
});
</script>` : ""}
</body></html>`;
}
