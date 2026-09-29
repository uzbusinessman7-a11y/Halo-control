import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { LedgerError } from "../../../core/ledger";
import { runStockBridge } from "../../../core/stock-bridge";
import { avtReport } from "../../../core/stock";
import type { D1Like } from "../../../lib/full-migration";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/ombor";
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
    const body = await request.json() as { branchId?: unknown; from?: unknown; to?: unknown };
    const branchId = String(body.branchId || "main");
    const today = seoulToday();
    const to = String(body.to || today);
    const from = String(body.from || new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10));
    const scope = { tenantId: TENANT_ID, branchId };
    const { state } = await readHaloState(branchId);
    const bridge = await runStockBridge(database(), scope, state as Record<string, unknown>, today);
    const avt = await avtReport(database(), scope, from, to);
    return json({ ok: true, from, to, bridge, avt });
  } catch (error) {
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>HALO Ombor</title>
<style>
:root{color-scheme:light dark;--bg:#f3f4f6;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#0f766e;--ok:#047857;--ok-soft:#d1fae5;--bad:#b91c1c;--bad-soft:#fee2e2;--warn:#b45309;--warn-soft:#fef3c7}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--card:#16191e;--text:#f3f4f6;--muted:#9ca3af;--line:#262a31;--accent:#2dd4bf;--ok:#34d399;--ok-soft:#064e3b;--bad:#f87171;--bad-soft:#450a0a;--warn:#fbbf24;--warn-soft:#451a03}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px 16px calc(24px + env(safe-area-inset-bottom))}
main{max-width:720px;margin:0 auto;display:grid;gap:14px}
header{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}header h1{font-size:20px;margin:0}header small{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.card h2{font-size:15px;margin:0 0 6px;color:var(--muted);font-weight:600;letter-spacing:.02em;text-transform:uppercase}
.hint{font-size:14px;color:var(--muted);margin:0 0 12px}
select,input{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:10px 14px;background:var(--accent);color:#fff;cursor:pointer}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.total{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}.total.bad{color:var(--bad)}.total.ok{color:var(--ok)}
.item{display:grid;grid-template-columns:1fr auto;gap:4px 10px;padding:12px 0;border-top:1px solid var(--line)}.item:first-of-type{border-top:0}
.item b{font-size:16px}.item .v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums}.item small{grid-column:1/-1;color:var(--muted);font-size:13px}
.v.bad{color:var(--bad)}.v.warn{color:var(--warn)}.v.ok{color:var(--ok)}
.bar{grid-column:1/-1;height:6px;border-radius:3px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;background:var(--bad)}
.msg{padding:12px;border-radius:12px}.msg.bad{background:var(--bad-soft);color:var(--bad)}.msg.ok{background:var(--ok-soft);color:var(--ok)}
</style></head><body><main>
<header><div><h1>Ombor nazorati</h1><small>Yangi jurnal · sinov</small></div><select id="branch"></select></header>
<section class="card"><h2>Nazariy va haqiqiy sarf</h2>
<p class="hint">Retsept bo'yicha qancha ketishi kerak edi va sanoqda qancha kam chiqdi. Eng katta yo'qotish — birinchi.</p>
<div class="row"><input type="date" id="from"> — <input type="date" id="to"><button id="go">Ko'rsatish</button></div>
<div id="avt" style="margin-top:12px"></div></section>
<section class="card"><h2>Hujjatsiz qoldiq o'zgarishlari</h2>
<p class="hint">Eski tizimdagi qoldiq harakatlar yig'indisiga teng emas — ya'ni qoldiq harakat yozilmasdan o'zgartirilgan.</p>
<div id="drift"></div></section>
</main>
<script>
var BRANCHES=${boot};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function qty(n,u){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US',{maximumFractionDigits:3})+' '+esc(u)}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');
function load(){
  document.getElementById('avt').innerHTML='<p class="hint">Yuklanmoqda…</p>';
  fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({branchId:sel.value,from:document.getElementById('from').value||undefined,to:document.getElementById('to').value||undefined})})
  .then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}}).then(function(res){
    if(!res.ok){document.getElementById('avt').innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    document.getElementById('from').value=res.from;document.getElementById('to').value=res.to;
    var loss=res.avt.reduce(function(s,r){return s+Math.min(0,r.varianceValue)},0);
    var max=Math.max.apply(null,res.avt.map(function(r){return Math.abs(r.varianceValue)}).concat([1]));
    document.getElementById('avt').innerHTML='<div class="total '+(loss<0?'bad':'ok')+'">'+(loss<0?'Kamomad: '+won(loss):'Kamomad yo‘q ✓')+'</div>'
      +(res.avt.length?res.avt.map(function(r){var bad=r.countVariance<0,pct=r.variancePercent;
        return '<div class="item"><b>'+esc(r.name)+'</b><span class="v '+(bad?'bad':r.countVariance>0?'warn':'ok')+'">'+(r.countVariance?won(r.varianceValue):'✓')+'</span>'
          +(bad?'<div class="bar"><i style="width:'+Math.round(Math.abs(r.varianceValue)/max*100)+'%"></i></div>':'')
          +'<small>Nazariy (retsept): '+qty(r.theoretical,r.unit)+' · chiqit: '+qty(r.recordedWaste,r.unit)+' · sanoq farqi: '+qty(r.countVariance,r.unit)+(pct!=null?' ('+pct+'%)':'')+' · kirim: '+qty(r.receipts,r.unit)+'</small></div>'}).join(''):'<p class="hint">Bu davrda harakat yo‘q.</p>');
    var drift=res.bridge.items.filter(function(i){return i.difference!==0&&!i.expenseOnly});
    var warn=[];if(res.bridge.changed.length)warn.push(res.bridge.changed.length+' ta eski harakat keyin o‘zgartirilgan');if(res.bridge.invalid.length)warn.push(res.bridge.invalid.length+' ta harakat yozilmadi');if(res.bridge.unknownItem.length)warn.push(res.bridge.unknownItem.length+' ta harakatning mahsuloti topilmadi');
    document.getElementById('drift').innerHTML=(warn.length?'<div class="msg bad" style="margin-bottom:10px">⚠ '+warn.map(esc).join(' · ')+'</div>':'')
      +(drift.length?drift.map(function(i){return '<div class="item"><b>'+esc(i.name)+'</b><span class="v bad">'+qty(-i.difference,i.unit)+'</span><small>Eski tizim qoldig‘i: '+qty(i.oldStock,i.unit)+' · harakatlar bo‘yicha: '+qty(i.ledgerStock,i.unit)+'</small></div>'}).join(''):'<div class="msg ok">✓ Barcha mahsulot qoldig‘i harakatlar bilan mos</div>');
  });
}
document.getElementById('go').addEventListener('click',load);sel.addEventListener('change',load);load();
</script></body></html>`;
}
