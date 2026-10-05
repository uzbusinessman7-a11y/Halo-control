import { isAdminRequest } from "../../../lib/integration-store";
import { listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { ensureWorkerAccess } from "../../../lib/worker-auth";
import { readSettings } from "../../../lib/telegram-service";
import { completeCutover, cutoverStatus, revertCutover } from "../../../lib/cutover";
import { ensurePeriodCountSchema } from "../../../core/period-count";
import type { D1Like } from "../../../lib/full-migration";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/kochish";
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
  return new Response(page(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function status() {
  const db = database();
  await ensureWorkerAccess();
  await ensurePeriodCountSchema(db);
  const staff = new Map((await db.prepare("SELECT branch_id, COUNT(*) AS n FROM halo_worker_users WHERE active = 1 GROUP BY branch_id")
    .all<{ branch_id: string; n: number }>()).results.map((row) => [row.branch_id, Number(row.n)]));
  const counts = new Map((await db.prepare(
    `SELECT branch_id, MAX(count_date) AS d, COUNT(DISTINCT domain || ref_id) AS n FROM v2_period_counts
     WHERE count_date = (SELECT MAX(count_date) FROM v2_period_counts c WHERE c.branch_id = v2_period_counts.branch_id) GROUP BY branch_id`,
  ).all<{ branch_id: string; d: string; n: number }>()).results.map((row) => [row.branch_id, { date: row.d, lines: Number(row.n) }]));
  const branches = [];
  for (const branch of await listHaloBranches()) {
    const { updatedAt } = await readHaloState(branch.id);
    branches.push({ id: branch.id, name: branch.name, dataUpdatedAt: updatedAt || null, staff: staff.get(branch.id) || 0, count: counts.get(branch.id) || null });
  }
  const telegram = await readSettings();
  return {
    branches,
    telegram: { bot: Boolean(telegram.botToken), chat: Boolean(telegram.chatId), enabled: telegram.enabled, botName: telegram.botName || "", reportTime: telegram.reportTime || "" },
    cutover: await cutoverStatus(),
  };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    body.confirm = String(body.confirm || "").trim().toUpperCase();
    if (body.action === "complete") {
      if (body.confirm !== "KOCHISH") return json({ error: "Tasdiqlash uchun KOCHISH so'zini yozing." }, 400);
      await completeCutover("Rahbar");
    } else if (body.action === "revert") {
      if (body.confirm !== "QAYTARISH") return json({ error: "Tasdiqlash uchun QAYTARISH so'zini yozing." }, 400);
      await revertCutover();
    }
    return json({ ok: true, ...(await status()) });
  } catch (error) {
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(): string {
  return shell({
    title: "To‘liq o‘tish", active: "kochish", heading: "To‘liq o‘tish",
    subtitle: "Eski saytdan butunlay shu saytga o'tish uchun tekshiruv ro'yxati",
    body: `<div id="body" style="display:grid;gap:16px"><section class="card"><div class="skeleton"></div><div class="skeleton" style="margin-top:12px"></div></section></div>`,
    script: `
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
function step(ok,title,detail,link){return '<div class="list-row"><div><b>'+(ok===true?'✅ ':ok===false?'⬜ ':'👉 ')+esc(title)+'</b><br><small style="color:var(--muted)">'+detail+'</small></div>'+(link?'<a href="'+link+'" style="white-space:nowrap;font-weight:700">Ochish ›</a>':'<span></span>')+'</div>'}
function fmt(iso){if(!iso)return 'noma’lum';var d=new Date(iso);return isNaN(d)?esc(iso):d.toLocaleString('uz-UZ',{timeZone:'Asia/Seoul'})}
function render(res){
  var body=document.getElementById('body');
  if(!res.ok){body.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
  var c=res.cutover,t=res.telegram;
  var html='<section class="card"><h2>Hozirgi holat</h2>'+(c.completed
    ?'<div class="msg ok">✓ To‘liq o‘tish '+fmt(c.completedAt)+' da yakunlangan. Kunlik Telegram hisobotlar endi shu saytdan boradi.</div>'
    :'<div class="msg warn">Parallel rejim: siz eski saytda ishlayapsiz, bu sayt nusxa bilan sinovda. Bu sayt avtomatik Telegram hisobot yubormaydi.</div>')+'</section>';
  html+='<section class="card"><h2>1. Oxirgi ma’lumotlarni ko‘chirish</h2><p class="hint">O‘tish kuni kechqurun eski saytdan eksport qilib, shu saytga “HA_ALMASHTIR” bilan import qilinadi. Shundan keyin eski saytga hech narsa kiritilmaydi.</p>'
    +res.branches.map(function(b){return step(null,b.name,'Bu saytdagi ma’lumot oxirgi marta yangilangan: '+fmt(b.dataUpdatedAt))}).join('')
    +step(null,'Ko‘chirish sahifasi','Eksport va import shu yerda','/api/admin/migration')+'</section>';
  html+='<section class="card"><h2>2. Oy yakuni sanog‘i (boshlang‘ich qoldiq)</h2>'
    +res.branches.map(function(b){return step(Boolean(b.count),b.name,b.count?esc(b.count.date)+' sanasi · '+b.count.lines+' ta qator sanalgan':'Hali sanalmagan','/api/v2/sanoq')}).join('')+'</section>';
  html+='<section class="card"><h2>3. Xodimlar akkaunti</h2>'
    +res.branches.map(function(b){return step(b.staff>0,b.name,b.staff?b.staff+' ta faol xodim akkaunti. Xodimlar eski login va PIN bilan kiradi: /xodim':'Faol xodim akkaunti yo‘q')}).join('')+'</section>';
  html+='<section class="card"><h2>4. Telegram bot</h2>'
    +step(t.bot&&t.chat,'Hisobot boti',t.bot&&t.chat?'Ulangan'+(t.botName?' · @'+esc(t.botName):'')+(t.reportTime?' · hisobot vaqti '+esc(t.reportTime):'')+(t.enabled?'':' · avtomatik hisobot o‘chirilgan'):'Bot yoki chat ulanmagan')
    +step(null,'Eski saytda Telegram hisobotni o‘chirish','O‘tish kuni eski saytning Telegram bo‘limida avtomatik hisobotni o‘chiring — aks holda ikki marta keladi')+'</section>';
  html+='<section class="card"><h2>5. Google Sheets</h2>'+step(null,'Apps Script manzili va API kalit','O‘tish kuni Code.gs dagi sayt manzilini yangi saytga almashtiring va yangi API kalit yarating')+'</section>';
  html+='<section class="card"><h2>'+(c.completed?'Favqulodda: parallel rejimga qaytish':'6. O‘tishni yakunlash')+'</h2>'
    +(c.completed
      ?'<p class="hint">Faqat jiddiy muammo bo‘lsa: bu sayt yana avtomatik hisobot yubormaydi.</p><input id="cf" placeholder="QAYTARISH" style="width:100%;margin-bottom:10px"><button class="ghost block" id="go">Parallel rejimga qaytarish</button>'
      :'<p class="hint">Yuqoridagilar tayyor bo‘lgach bosiladi. Shundan keyin bu sayt asosiy bo‘ladi va har kuni Telegram hisobot yuboradi. Tasdiqlash uchun <b>KOCHISH</b> deb yozing.</p><input id="cf" placeholder="KOCHISH" style="width:100%;margin-bottom:10px"><button class="block" id="go">To‘liq o‘tishni yakunlash</button>')
    +'<div id="msg"></div></section>';
  body.innerHTML=html;
  document.getElementById('go').addEventListener('click',function(){
    var btn=this,cf=document.getElementById('cf').value.trim().toUpperCase();btn.disabled=true;
    api({action:c.completed?'revert':'complete',confirm:cf}).then(function(x){btn.disabled=false;
      if(!x.ok){document.getElementById('msg').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}
      render(x);
    });
  });
}
api({}).then(render);
`,
  });
}
