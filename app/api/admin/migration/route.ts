import { isAdminRequest } from "../../../lib/integration-store";
import { BASE_RESET_CONFIRMATION, exportDatabase, importBranchExports, importDatabase, MigrationError, REPLACE_CONFIRMATION, resetBranchesToBase, type D1Like } from "../../../lib/full-migration";
import { nextMonthStart } from "../../../lib/base-reset";
import { isParallelMode } from "../../../lib/cutover";
import { ensureHaloState } from "../../../lib/halo-store";
import { clearPeriodCounts, resetV2Journals } from "../../../core/v2-reset";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/admin/migration";
const OLD_SITE = "https://halo-control.uzbusinessman7.chatgpt.site/";

function database(): D1Like {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
}

const selfHosted = () => globalThis.__HALO_SELF_HOSTED__ === true;

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!await isAdminRequest(request)) {
    if (url.searchParams.get("download")) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  if (url.searchParams.get("download") === "1") {
    try {
      const dump = await exportDatabase(database(), url.origin);
      const name = `halo-toliq-kochirish-${dump.exportedAt.slice(0, 10)}.json`;
      return new Response(JSON.stringify(dump), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Eksport tayyorlanmadi." }, { status: 500 });
    }
  }
  return new Response(page(selfHosted()), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  if (!selfHosted()) {
    return Response.json({ error: "Import faqat yangi (o'z Cloudflare) saytda ishlaydi. Eski saytga hech narsa yozilmaydi." }, { status: 403 });
  }
  const owner = String(request.headers.get("oai-authenticated-user-email") || "");
  try {
    const body = await request.json() as { action?: unknown; dump?: unknown; files?: unknown; dryRun?: unknown; replaceExisting?: unknown; resetJournals?: unknown; baseOnly?: unknown; startDate?: unknown; confirm?: unknown };
    const afterImport = async (ok: boolean) => (ok && body.dryRun !== true && body.resetJournals === true ? resetV2Journals(database()) : []);
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate || "")) ? String(body.startDate) : nextMonthStart();
    const baseOnly = body.baseOnly === true || body.action === "baseReset";
    if (baseOnly && !await isParallelMode()) {
      throw new MigrationError("To'liq o'tishdan keyin noldan boshlab bo'lmaydi (ish ma'lumoti himoyalangan).");
    }
    const afterBase = async (ok: boolean) => {
      if (!ok || body.dryRun === true) return { journalsReset: [] as string[], periodCountsCleared: 0 };
      return { journalsReset: await resetV2Journals(database()), periodCountsCleared: await clearPeriodCounts(database()) };
    };
    if (body.action === "baseReset") {
      // Fayl kerak emas: yangi saytdagi mavjud ma'lumotdan faqat baza qoladi.
      await ensureHaloState();
      const branchReport = await resetBranchesToBase(database(), { dryRun: body.dryRun === true, confirm: String(body.confirm || ""), startDate });
      const extra = await afterBase(branchReport.ok);
      return Response.json({ ok: branchReport.ok, branchReport, ...extra }, { status: branchReport.ok ? 200 : 500 });
    }
    if (body.files !== undefined) {
      // ChatGPT'siz yo'l: filial zaxira fayllari ("To'liq ma'lumotni yuklash").
      await ensureHaloState();
      const branchReport = await importBranchExports(database(), body.files, {
        dryRun: body.dryRun === true,
        replaceExisting: String(body.replaceExisting || ""),
        baseOnly: baseOnly ? startDate : undefined,
      });
      if (baseOnly) {
        const extra = await afterBase(branchReport.ok);
        return Response.json({ ok: branchReport.ok, branchReport, ...extra }, { status: branchReport.ok ? 200 : 500 });
      }
      const journalsReset = await afterImport(branchReport.ok);
      return Response.json({ ok: branchReport.ok, branchReport, journalsReset }, { status: branchReport.ok ? 200 : 500 });
    }
    const report = await importDatabase(database(), body.dump, {
      ownerEmail: owner,
      dryRun: body.dryRun === true,
      replaceExisting: String(body.replaceExisting || ""),
    });
    const journalsReset = await afterImport(report.ok);
    return Response.json({ ok: report.ok, report, journalsReset }, { status: report.ok ? 200 : 500 });
  } catch (error) {
    const message = error instanceof MigrationError || error instanceof SyntaxError
      ? error.message
      : "Import bajarilmadi. Hech narsa o'zgarmagan bo'lishi mumkin — sahifani yangilab, sinov rejimidan qayta boshlang.";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

function page(isNewSite: boolean): string {
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>HALO Control — ko'chirish</title>
<style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--text:#16181d;--muted:#5d6470;--line:#d7dbe2;--accent:#0f766e;--ok:#067647;--bad:#b42318;--warn:#b54708}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--text:#eef0f3;--muted:#a3a9b4;--line:#2c313a;--accent:#2dd4bf;--ok:#32d583;--bad:#f97066;--warn:#fdb022}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{max-width:720px;margin:24px auto;display:grid;gap:16px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
h1{margin:0;font-size:22px}h2{margin:0 0 8px;font-size:17px}p{margin:0 0 12px;color:var(--muted)}
.badge{display:inline-block;padding:3px 10px;border-radius:99px;font-size:13px;font-weight:700;border:1px solid var(--line)}
button,.btn{display:inline-block;padding:11px 16px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none}
button:disabled{opacity:.5;cursor:not-allowed}button.secondary{background:transparent;color:var(--text);border:1px solid var(--line)}
input[type=file]{margin:8px 0 12px;max-width:100%}label{display:flex;gap:8px;align-items:flex-start;margin:8px 0;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px}th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line)}td.n{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:var(--ok);font-weight:700}.bad{color:var(--bad);font-weight:700}.msg{padding:10px 12px;border-radius:10px;border:1px solid var(--line);margin-top:12px;white-space:pre-wrap}
.msg.bad{border-color:var(--bad)}.msg.ok{border-color:var(--ok)}.row{display:flex;gap:10px;flex-wrap:wrap}
</style></head><body><main>
<section><h1>Tizimni ko'chirish</h1>
<p>${isNewSite ? "Bu — <b>yangi sayt</b> (o'z Cloudflare akkauntingiz)." : "Bu — <b>eski sayt</b>. Bu yerda faqat yuklab olish mumkin, hech narsa o'zgartirilmaydi."}</p>
<span class="badge">${isNewSite ? "YANGI SAYT" : "ESKI SAYT"}</span></section>
${isNewSite ? `<section><h2>1. Noldan boshlash — faqat baza qoladi</h2>
<p><b>Qoladi:</b> ombor mahsulotlari (nomi, birligi, qadog'i, oxirgi narxi), menyu va retseptlar, yetkazuvchilar (ism, telefon), xodimlar va ish haqi stavkasi, kassa/bank nomlari, doimiy xarajat shablonlari, kategoriyalar, komissiya/soliq sozlamalari.</p>
<p><b>Nolga tushadi:</b> ombor qoldig'i, yetkazuvchi qarzlari, kassa/bank boshlang'ich qoldig'i.<br><b>O'chadi (faqat yangi saytda):</b> savdo, xarajat, kirim-chiqim, qarz yozuvlari, smena va maosh, yopilgan kunlar. Eski saytdagi tarix o'zgarmaydi.</p>
<label style="align-items:center">Yangi hisob boshlanadigan kun: <input type="date" id="start" value="${nextMonthStart()}" style="padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text)"></label>
<div class="row" style="margin:6px 0 10px"><label style="margin:0"><input type="radio" name="src" value="here" checked> Yangi saytdagi hozirgi ma'lumotdan (fayl kerak emas)</label><label style="margin:0"><input type="radio" name="src" value="files"> Eski saytdan olingan fayldan</label></div>
<div id="filesBox" hidden>
<ol style="margin:0 0 8px;padding-left:20px;color:var(--muted)">
<li><a href="${OLD_SITE}" target="_blank" rel="noopener">Eski saytni</a> oching → <b>“API va ulanishlar”</b> → <b>“↓ To'liq ma'lumotni yuklash”</b>.</li>
<li>Tepada filialni almashtiring va ikkinchi filial uchun ham bosing.</li>
<li>Ikkala faylni shu yerda <b>birga</b> tanlang.</li></ol>
<input type="file" id="bfile" accept="application/json,.json" multiple></div>
<label><input type="checkbox" id="agree"> Tushundim: yangi saytdagi savdo, xarajat, maosh va qarz tarixi o'chadi, qoldiqlar nol bo'ladi (avvalgi holat zaxiraga saqlanadi)</label>
<div class="row"><button id="bcheck" class="secondary">Tekshirish</button><button id="brun" disabled>Noldan boshlash</button></div>
<div id="bout"></div></section>
<details><summary style="cursor:pointer;color:var(--muted);padding:4px 2px">Boshqa usul: tarix bilan to'liq ko'chirish</summary>
<section style="margin-top:12px"><h2>Tarix bilan to'liq ko'chirish</h2>
<p>Eski saytdagi <b>"To'liq ma'lumotni yuklash"</b> fayllari (har bir filial uchun bittadan) yoki to'liq ko'chirish fayli. Savdo, qarz va qoldiqlar ham o'tadi.</p>
<p>Avval <b>Tekshirish</b> — hech narsa yozilmaydi. Keyin <b>Ko'chirish</b>. Ko'chirish bitta tranzaksiyada bajariladi: yo hammasi, yo hech narsa.</p>
<input type="file" id="file" accept="application/json,.json" multiple>
<label><input type="checkbox" id="replace"> Yangi saytdagi ma'lumot ustidan yozish (yakuniy ko'chirishda <b>belgilang</b>)</label>
<label><input type="checkbox" id="resetJ" checked> Yangi tizim jurnallarini toza boshlash — sinov paytidagi yozuvlar o'chadi, jurnallar ko'chirilgan ma'lumotdan qaytadan quriladi (oy yakuni sanog'i saqlanadi)</label>
<div class="row"><button id="check" class="secondary" disabled>Tekshirish</button><button id="run" disabled>Ko'chirish</button></div>
<div id="out"></div></section></details>` : ""}
<section><h2>${isNewSite ? "Shu saytning zaxira nusxasi (ixtiyoriy)" : "1. To'liq ma'lumotni yuklab olish"}</h2>
<p>Barcha filiallar, savdo, ombor, qarzlar, maosh, xodim loginlari va sozlamalar bitta faylga yig'iladi. Har bir jadval uchun nazorat yig'indisi yoziladi.</p>
<p><b>Diqqat:</b> faylda Telegram bot tokeni va xodimlar ma'lumoti bor — uni hech kimga yubormang.</p>
<a class="btn${isNewSite ? " secondary" : ""}" href="${PAGE_PATH}?download=1">↓ Faylni yuklab olish</a></section>
</main>
${isNewSite ? `<script>
const file=document.getElementById('file'),check=document.getElementById('check'),run=document.getElementById('run'),out=document.getElementById('out'),replace=document.getElementById('replace');
let dump=null,files=null,checked=false;
const won=n=>Number(n||0).toLocaleString('en-US')+' ₩';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=(cls,html)=>{out.innerHTML='<div class="msg '+cls+'">'+html+'</div>'};

const bout=document.getElementById('bout'),bcheck=document.getElementById('bcheck'),brun=document.getElementById('brun'),agree=document.getElementById('agree'),bfile=document.getElementById('bfile'),filesBox=document.getElementById('filesBox'),start=document.getElementById('start');
let bfiles=null,bchecked=false;
const bshow=(cls,html)=>{bout.innerHTML='<div class="msg '+cls+'">'+html+'</div>'};
const src=()=>document.querySelector('input[name=src]:checked').value;
const bsync=()=>{brun.disabled=!(bchecked&&agree.checked);};
const breset=()=>{bchecked=false;bsync();bout.innerHTML='';};
document.querySelectorAll('input[name=src]').forEach(r=>r.addEventListener('change',()=>{filesBox.hidden=src()!=='files';breset();}));
start.addEventListener('change',breset);agree.addEventListener('change',bsync);
bfile.addEventListener('change',async()=>{breset();bfiles=null;
  try{const parsed=[];for(const f of bfile.files)parsed.push(JSON.parse(await f.text()));if(!parsed.length)throw 0;bfiles=parsed;bshow('',parsed.length+' ta fayl o\\'qildi. Endi "Tekshirish" ni bosing.');}
  catch{bshow('bad','Fayl o\\'qilmadi — bu JSON fayl emas.');}});
const LABELS={sales:'savdo',financialEntries:'xarajat/pul yozuvi',transactions:'yetkazuvchi yozuvi',stockMovements:'ombor harakati',workShifts:'smena',payrollPayments:'maosh to\\'lovi',payrollAdjustments:'bonus/ushlanma',attendanceDays:'davomat',dailyCloses:'yopilgan kun',monthlyCloses:'yopilgan oy',mezanaEntries:'MEZANA yozuvi',supplierDeliveries:'yetkazib berish',purchaseOrders:'buyurtma',workerConsumptions:'xodim ovqati',posOrders:'POS buyurtma',deletedItems:'arxiv',auditLog:'audit',operationChecklistDays:'checklist kuni'};
function baseTable(r){return '<table><tr><th>Filial</th><th>Mahsulot</th><th>Retsept</th><th>Yetkazuvchi</th><th>Xodim</th>'+(r.dryRun?'':'<th>Holat</th>')+'</tr>'+r.branches.map(b=>{const k=b.base.kept;return '<tr><td>'+esc(b.branchId)+'</td><td class="n">'+(k.inventory||0)+'</td><td class="n">'+(k.recipes||0)+'</td><td class="n">'+(k.suppliers||0)+'</td><td class="n">'+(k.staff||0)+'</td>'+(r.dryRun?'':'<td class="'+(b.ok?'ok':'bad')+'">'+(b.ok?'✓':'✗')+'</td>')+'</tr>';}).join('')+'</table>'+
  r.branches.map(b=>{const z=b.base.zeroed,c=b.base.cleared;const gone=Object.keys(c).map(k=>(LABELS[k]||k)+': '+c[k]).join(', ');const unk=Object.keys(b.base.unknownCleared||{});
    return '<p style="margin:10px 0 0"><b>'+esc(b.branchId)+'</b> — nolga: '+z.stockItems+' ta mahsulot qoldig\\'i, yetkazuvchi qarzi '+won(z.supplierDebt)+(z.accountOpening?', kassa boshlang\\'ich '+won(z.accountOpening):'')+'.<br>O\\'chadi: '+(gone||'tarix yo\\'q')+(unk.length?' · boshqa: '+esc(unk.join(', ')):'')+'</p>';}).join('');}
async function bsend(dryRun){
  const payload=src()==='files'?{files:bfiles,baseOnly:true,replaceExisting:'${REPLACE_CONFIRMATION}'}:{action:'baseReset',confirm:'${BASE_RESET_CONFIRMATION}'};
  const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign(payload,{dryRun,startDate:start.value}))});
  return r.json().catch(()=>({ok:false,error:'Server javobi o\\'qilmadi.'}));}
bcheck.addEventListener('click',async()=>{if(src()==='files'&&!bfiles){bshow('bad','Avval faylni tanlang.');return;}
  bcheck.disabled=true;bshow('','Tekshirilmoqda… (hech narsa yozilmaydi)');const res=await bsend(true);bcheck.disabled=false;
  if(!res.ok){bshow('bad',esc(res.error||'Xato'));return;}
  bchecked=true;bsync();bshow('ok','✓ Tekshirildi. Shu holatda boshlanadi ('+esc(start.value)+' dan):'+baseTable(res.branchReport)+(agree.checked?'':'<p style="margin-top:10px">Davom etish uchun "Tushundim" belgisini qo\\'ying.</p>'));});
brun.addEventListener('click',async()=>{if(!bchecked||!agree.checked)return;
  if(!confirm('Yangi saytda hamma narsa noldan boshlansinmi? Eski saytga tegilmaydi.'))return;
  brun.disabled=true;bcheck.disabled=true;bshow('','Bajarilmoqda… sahifani yopmang.');const res=await bsend(false);bcheck.disabled=false;
  if(!res.ok){bshow('bad',esc(res.error||'Xato')+(res.branchReport?baseTable(res.branchReport):''));return;}
  bshow('ok','✓ Tayyor. Baza saqlandi, qoldiq va tarix nol.'+baseTable(res.branchReport)+'<p style="margin-top:12px"><b>Keyingi qadamlar:</b> '+esc(start.value)+' kuni Ombor → sanoq orqali boshlang\\'ich qoldiqni kiriting; kassa qoldig\\'ini Kassa → kirim (boshlang\\'ich) bilan kiriting.</p><p><a class="btn" href="/api/v2/bosh">Yangi tizimni ochish</a></p>');});
file.addEventListener('change',async()=>{checked=false;run.disabled=true;dump=null;files=null;out.innerHTML='';
  try{const parsed=[];for(const f of file.files)parsed.push(JSON.parse(await f.text()));
    if(!parsed.length)throw 0;
    if(parsed.length===1&&parsed[0].format==='halo-control-full-migration'){dump=parsed[0];}
    else{files=parsed;}
    check.disabled=false;show('',(dump?'To\\'liq ko\\'chirish fayli':parsed.length+' ta filial fayli')+' o\\'qildi. Endi "Tekshirish" ni bosing.');}
  catch{check.disabled=true;show('bad','Fayl o\\'qilmadi — bu JSON fayl emas.');}});
async function send(dryRun){
  const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign(dump?{dump}:{files},{dryRun,replaceExisting:replace.checked?'${REPLACE_CONFIRMATION}':'',resetJournals:document.getElementById('resetJ').checked}))});
  return r.json().catch(()=>({ok:false,error:'Server javobi o\\'qilmadi.'}));}
function branchTable(r){return '<table><tr><th>Filial</th><th>Savdolar</th><th>Savdo summasi</th><th>Ombor</th><th>Yetkazuvchi qarzi</th>'+(r.dryRun?'':'<th>Holat</th>')+'</tr>'+r.branches.map(b=>'<tr><td>'+esc(b.branchId)+'</td><td class="n">'+b.summary.sales+'</td><td class="n">'+won(b.summary.salesRevenue)+'</td><td class="n">'+b.summary.inventoryItems+'</td><td class="n">'+won(b.summary.supplierBalance)+'</td>'+(r.dryRun?'':'<td class="'+(b.ok?'ok':'bad')+'">'+(b.ok?'✓ mos':'✗ farq')+'</td>')+'</tr>').join('')+'</table>';}
function table(report,dry){return '<table><tr><th>Jadval</th><th>Faylda</th>'+(dry?'':'<th>Bazada</th><th>Holat</th>')+'</tr>'+report.tables.map(t=>'<tr><td>'+esc(t.table)+'</td><td class="n">'+t.fileRows+'</td>'+(dry?'':'<td class="n">'+t.databaseRows+'</td><td class="'+(t.ok?'ok':'bad')+'">'+(t.ok?'✓ mos':'✗ farq')+'</td>')+'</tr>').join('')+'</table>';}
check.addEventListener('click',async()=>{check.disabled=true;show('','Tekshirilmoqda…');
  const res=await send(true);check.disabled=false;
  if(!res.ok){show('bad',esc(res.error||'Xato'));return;}
  checked=true;run.disabled=false;
  if(res.branchReport){show('ok','✓ Fayllar butun. Ko\\'chirilgandan keyin shu raqamlarni eski saytdagi raqamlar bilan solishtiring:'+branchTable(res.branchReport));return;}
  show('ok','✓ Fayl butun va mos. Manba: '+esc(res.report.source)+'<br>Yuklab olingan: '+esc(res.report.exportedAt)+table(res.report,true));});
run.addEventListener('click',async()=>{if(!checked)return;
  if(!confirm('Ma\\'lumotlar yangi saytga ko\\'chirilsinmi? Eski saytga tegilmaydi.'))return;
  run.disabled=true;check.disabled=true;show('','Ko\\'chirilmoqda… sahifani yopmang.');
  const res=await send(false);
  if(res.branchReport&&res.ok){show('ok','✓ Ko\\'chirish tugadi. Har bir filial ma\\'lumoti fayl bilan baytma-bayt mos.<br>Endi xodim loginlari va Telegram botni yangi saytda qayta sozlang.'+branchTable(res.branchReport)+'<p style="margin-top:12px"><a class="btn" href="/api/v2/bosh">Yangi tizimni ochish</a></p>');return;}
  if(!res.ok||!res.report){show('bad',esc(res.error||'Xato')+(res.report?table(res.report,false):'')+(res.branchReport?branchTable(res.branchReport):''));check.disabled=false;return;}
  show('ok','✓ Ko\\'chirish tugadi. Barcha jadvallar fayl bilan wonma-won mos.'+(res.report.telegramPaused?'<br>Telegram avtomatik hisoboti yangi saytda vaqtincha to\\'xtatildi (eski sayt yuborishda davom etadi).':'')+table(res.report,false)+'<p style="margin-top:12px"><a class="btn" href="/api/v2/bosh">Yangi tizimni ochish</a></p>');});
</script>` : ""}
</body></html>`;
}
