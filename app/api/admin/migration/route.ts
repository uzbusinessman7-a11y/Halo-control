import { isAdminRequest } from "../../../lib/integration-store";
import { exportDatabase, importDatabase, MigrationError, REPLACE_CONFIRMATION, type D1Like } from "../../../lib/full-migration";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/admin/migration";

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
    const body = await request.json() as { dump?: unknown; dryRun?: unknown; replaceExisting?: unknown };
    const report = await importDatabase(database(), body.dump, {
      ownerEmail: owner,
      dryRun: body.dryRun === true,
      replaceExisting: String(body.replaceExisting || ""),
    });
    return Response.json({ ok: report.ok, report }, { status: report.ok ? 200 : 500 });
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
<section><h2>1. To'liq ma'lumotni yuklab olish</h2>
<p>Barcha filiallar, savdo, ombor, qarzlar, maosh, xodim loginlari va sozlamalar bitta faylga yig'iladi. Har bir jadval uchun nazorat yig'indisi yoziladi.</p>
<p><b>Diqqat:</b> faylda Telegram bot tokeni va xodimlar ma'lumoti bor — uni hech kimga yubormang.</p>
<a class="btn" href="${PAGE_PATH}?download=1">↓ Faylni yuklab olish</a></section>
${isNewSite ? `<section><h2>2. Yangi saytga yuklash</h2>
<p>Avval <b>Tekshirish</b> — hech narsa yozilmaydi, faqat fayl butunligi va mosligi tekshiriladi. Keyin <b>Ko'chirish</b>. Ko'chirish bitta tranzaksiyada bajariladi: yo hammasi, yo hech narsa.</p>
<input type="file" id="file" accept="application/json,.json">
<label><input type="checkbox" id="replace"> Yangi saytda allaqachon kiritilgan ma'lumot bo'lsa ham ustidan yozish (odatda kerak emas)</label>
<div class="row"><button id="check" class="secondary" disabled>Tekshirish</button><button id="run" disabled>Ko'chirish</button></div>
<div id="out"></div></section>` : ""}
</main>
${isNewSite ? `<script>
const file=document.getElementById('file'),check=document.getElementById('check'),run=document.getElementById('run'),out=document.getElementById('out'),replace=document.getElementById('replace');
let dump=null,checked=false;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=(cls,html)=>{out.innerHTML='<div class="msg '+cls+'">'+html+'</div>'};
file.addEventListener('change',async()=>{checked=false;run.disabled=true;dump=null;out.innerHTML='';
  try{dump=JSON.parse(await file.files[0].text());check.disabled=false;show('','Fayl o\\'qildi. Endi "Tekshirish" ni bosing.');}
  catch{check.disabled=true;show('bad','Fayl o\\'qilmadi — bu JSON fayl emas.');}});
async function send(dryRun){
  const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dump,dryRun,replaceExisting:replace.checked?'${REPLACE_CONFIRMATION}':''})});
  return r.json().catch(()=>({ok:false,error:'Server javobi o\\'qilmadi.'}));}
function table(report,dry){return '<table><tr><th>Jadval</th><th>Faylda</th>'+(dry?'':'<th>Bazada</th><th>Holat</th>')+'</tr>'+report.tables.map(t=>'<tr><td>'+esc(t.table)+'</td><td class="n">'+t.fileRows+'</td>'+(dry?'':'<td class="n">'+t.databaseRows+'</td><td class="'+(t.ok?'ok':'bad')+'">'+(t.ok?'✓ mos':'✗ farq')+'</td>')+'</tr>').join('')+'</table>';}
check.addEventListener('click',async()=>{check.disabled=true;show('','Tekshirilmoqda…');
  const res=await send(true);check.disabled=false;
  if(!res.ok){show('bad',esc(res.error||'Xato'));return;}
  checked=true;run.disabled=false;
  show('ok','✓ Fayl butun va mos. Manba: '+esc(res.report.source)+'<br>Yuklab olingan: '+esc(res.report.exportedAt)+table(res.report,true));});
run.addEventListener('click',async()=>{if(!checked)return;
  if(!confirm('Ma\\'lumotlar yangi saytga ko\\'chirilsinmi? Eski saytga tegilmaydi.'))return;
  run.disabled=true;check.disabled=true;show('','Ko\\'chirilmoqda… sahifani yopmang.');
  const res=await send(false);
  if(!res.ok||!res.report){show('bad',esc(res.error||'Xato')+(res.report?table(res.report,false):''));check.disabled=false;return;}
  show('ok','✓ Ko\\'chirish tugadi. Barcha jadvallar fayl bilan wonma-won mos.'+(res.report.telegramPaused?'<br>Telegram avtomatik hisoboti yangi saytda vaqtincha to\\'xtatildi (eski sayt yuborishda davom etadi).':'')+table(res.report,false)+'<p style="margin-top:12px"><a class="btn" href="/">Boshqaruv paneliga o\\'tish</a></p>');});
</script>` : ""}
</body></html>`;
}
