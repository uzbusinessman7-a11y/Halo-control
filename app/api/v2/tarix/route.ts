import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { LedgerError } from "../../../core/ledger";
import { runBridge } from "../../../core/bridge-sync";
import { runStockBridge } from "../../../core/stock-bridge";
import { runDebtBridge } from "../../../core/debt-bridge";
import { runPayrollBridge } from "../../../core/payroll-bridge";
import { historyReport } from "../../../core/history";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/tarix";
const TENANT_ID = "halo";
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function database(): D1Like {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
}

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  return new Response(page(branches), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const branchId = String(body.branchId || "main");
    const scope = { tenantId: TENANT_ID, branchId };
    const today = seoulToday();
    const { state } = await readHaloState(branchId);
    const data = state as Record<string, unknown>;
    const db = database();
    await runBridge(db, scope, data, today);
    await runStockBridge(db, scope, data, today);
    await runDebtBridge(db, scope, data, today);
    await runPayrollBridge(db, scope, data, today);
    return json({ ok: true, items: await historyReport(db, scope) });
  } catch (error) {
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "O'zgarishlar tarixi", active: "bosh", heading: "O'zgarishlar tarixi",
    subtitle: "Har bir o'chirilgan, keyin o'zgartirilgan yoki tuzatilgan yozuv — hech narsa yashirin qolmaydi",
    headerRight: '<select id="branch"></select>',
    body: `<section class="card"><div class="row" id="chips"></div></section><section class="card"><div id="list">${'<div class="skeleton" style="margin:10px 0"></div>'.repeat(4)}</div></section>`,
    script: `
var BRANCHES=${boot},ITEMS=[],AREA='all';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){if(n==null)return '';n=Number(n);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var AREAS={all:'Hammasi',pul:'💵 Pul',kassa:'🧮 Kassa',ombor:'📦 Ombor',qarz:'🧾 Qarz',maosh:'👥 Maosh'};
function when(iso){var d=new Date(iso);return isNaN(d)?esc(iso):d.toLocaleString('uz-UZ',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
function render(){
  document.getElementById('chips').innerHTML=Object.keys(AREAS).map(function(k){var n=k==='all'?ITEMS.length:ITEMS.filter(function(i){return i.area===k}).length;
    return '<button class="'+(k===AREA?'':'ghost')+'" data-a="'+k+'">'+AREAS[k]+' <span style="opacity:.7">'+n+'</span></button>'}).join('');
  document.querySelectorAll('[data-a]').forEach(function(b){b.addEventListener('click',function(){AREA=b.dataset.a;render()})});
  var list=ITEMS.filter(function(i){return AREA==='all'||i.area===AREA});
  document.getElementById('list').innerHTML=list.length?list.map(function(i){
    return '<div class="item"><b><span class="badge '+(i.severity==='bad'?'bad':i.severity==='warn'?'warn':'ok')+'" style="margin-right:8px">'+esc(AREAS[i.area]||i.area)+'</span>'+esc(i.what)+'</b><span class="v">'+won(i.amount)+'</span>'
      +'<small>'+when(i.at)+(i.originalDate?' · asl sana: '+esc(i.originalDate):'')+(i.detail?' · '+esc(i.detail):'')+'</small></div>'}).join('')
    :'<div class="msg ok">✓ Hech qanday o‘chirish yoki o‘zgartirish yo‘q</div>';
}
function load(){document.getElementById('list').innerHTML=haloLoading(4);
  api({branchId:sel.value}).then(function(res){if(!res.ok){document.getElementById('list').innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}ITEMS=res.items;render()})}
sel.addEventListener('change',load);load();
`,
  });
}
