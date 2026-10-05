import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { applyDeductionRules, DeductionError, exampleDeductions, readDeductionRules, type DeductionRulesInput } from "../../../core/deductions";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — soliq va komissiyalar: bir marta kiritiladi, har savdodan avtomatik ushlanadi.
 * Foiz o'zgartirilsa — faqat YANGI savdolarga ta'sir qiladi (eski savdolarda o'sha paytdagi foiz saqlangan).
 */
const PAGE_PATH = "/api/v2/ushlanmalar";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Row = Record<string, unknown>;

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
    const body = await request.json() as Row;
    const branchId = String(body.branchId || "main");
    if (body.action === "save") {
      const input = body.rules as DeductionRulesInput;
      if (!input || typeof input !== "object") throw new DeductionError("Foizlarni yozing.");
      const targets = body.allBranches === true ? (await listHaloBranches()).map((branch) => branch.id) : [branchId];
      // Avval har bir filialning o'z holati bilan tekshiramiz — bittasida xato bo'lsa, hech biriga yozilmaydi.
      for (const target of targets) applyDeductionRules((await readHaloState(target)).state as Row, input);
      for (const target of targets) {
        await mutateHaloState((state) => ({ state: applyDeductionRules(state as Row, input), result: null }), 5, target, "Rahbar",
          "Soliq va komissiya foizlari yangilandi", "Soliq va komissiyalar (yangi)");
      }
    }
    const { state } = await readHaloState(branchId);
    const rules = readDeductionRules(state as Row);
    return json({ ok: true, rules, example: exampleDeductions(rules), saved: body.action === "save" });
  } catch (error) {
    if (error instanceof DeductionError) return json({ error: error.message }, 400);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Soliq va komissiyalar", active: "ushlanmalar", heading: "Soliq va komissiyalar",
    subtitle: "Bir marta kiriting — har savdodan avtomatik ushlanadi",
    headerRight: '<select id="branch"></select>',
    body: `<div id="form">${"<section class=\"card\"><div class=\"skeleton\" style=\"height:120px\"></div></section>"}</div>`,
    script: `
var BRANCHES=${boot};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){return Number(n||0).toLocaleString('en-US')+' ₩'}
function req(body){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json()}).catch(function(){return {error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function pctField(id,label,value,hint){return '<label class="field"><span>'+label+'</span><div class="row" style="gap:8px;align-items:center;flex-wrap:nowrap"><input id="'+id+'" inputmode="decimal" value="'+esc(value||'')+'" placeholder="0" style="max-width:120px"><b>%</b></div>'+(hint?'<small class="hint">'+hint+'</small>':'')+'</label>'}
function render(x,note){
  var box=document.getElementById('form');
  if(x.error){box.innerHTML='<section class="card"><div class="msg bad">'+esc(x.error)+'</div></section>';return}
  var r=x.rules,e=x.example;
  box.innerHTML='<section class="card"><h2>🧾 POS apparati va soliq</h2>'
    +pctField('tax','Soliq',r.taxPct,'POS apparati savdosidan (karta va naqd) va delivery savdosidan: savdo × foiz. HALO hisob (naqd pul va hisob-raqamga o‘tkazma) — soliqsiz. Soliq zaxiraga yig‘iladi; to‘laganda Kiritish → Xarajat → “Soliq” deb kiriting — zaxiradan yopiladi.')
    +pctField('card','Karta to‘lov kompaniyasi komissiyasi',r.cardPct,'Karta puli hisobingizga shu foiz ayirilib tushadi. Kassa bo‘limida “kutilayotgan pul” sof summa bilan ko‘rinadi.')
    +'</section>'
    +'<section class="card"><h2>🛵 Delivery platformalari</h2><p class="hint">Har bir buyurtmadan: foiz (vositachilik + to‘lov + reklama + QQS birga) va qat’iy summa (masalan, yetkazish haqi).</p>'
    +r.platforms.map(function(p){return '<div class="item" style="display:block"><b>'+esc(p.label)+'</b><div class="row" style="gap:10px;margin-top:8px;flex-wrap:wrap"><label class="field" style="flex:1;min-width:130px"><span>Ushlanma, %</span><input data-pct="'+esc(p.id)+'" inputmode="decimal" value="'+esc(p.pct||'')+'" placeholder="0"></label><label class="field" style="flex:1;min-width:130px"><span>Har buyurtmadan, ₩</span><input data-fee="'+esc(p.id)+'" inputmode="numeric" value="'+esc(p.feeWon||'')+'" placeholder="0"></label></div></div>'}).join('')
    +'</section>'
    +'<section class="card"><h2>Misol: '+won(e.amount)+' savdo</h2>'
    +'<div class="list-row"><span>💳 POS karta: komissiya '+won(e.card.commission)+' · soliq '+won(e.card.tax)+'</span><b>sof '+won(e.card.net)+'</b></div>'
    +'<div class="list-row"><span>💵 POS naqd: soliq '+won(e.posCash.tax)+'</span><b>sof '+won(e.posCash.net)+'</b></div>'
    +e.delivery.map(function(d){return '<div class="list-row"><span>🛵 '+esc(d.label)+': ushlanma '+won(d.fee)+' · soliq '+won(d.tax)+'</span><b>sof '+won(d.net)+'</b></div>'}).join('')
    +'<div class="list-row"><span>🏦 HALO hisob (naqd / hisob-raqam)</span><b>sof '+won(e.amount)+'</b></div>'
    +'<p class="hint" style="margin-top:8px">Delivery qat’iy summasi bitta buyurtmaga bir marta olinadi.</p></section>'
    +'<section class="card">'+(BRANCHES.length>1?'<label class="row" style="gap:8px;margin-bottom:12px"><input type="checkbox" id="all" checked style="width:18px;height:18px;min-height:auto"> Hamma filiallarga bir xil qo‘llash</label>':'')
    +'<button class="block" id="save">Saqlash</button><p class="hint" style="margin-top:8px">Yangi foiz faqat bundan keyingi savdolarga qo‘llanadi — eski savdolar o‘zgarmaydi.</p><div id="msg">'+(note||'')+'</div></section>';
  document.getElementById('save').addEventListener('click',save);
}
function save(){
  var btn=document.getElementById('save');btn.disabled=true;
  var rules={taxPct:document.getElementById('tax').value,cardPct:document.getElementById('card').value,platforms:[].map.call(document.querySelectorAll('[data-pct]'),function(i){return {id:i.dataset.pct,pct:i.value,feeWon:document.querySelector('[data-fee="'+i.dataset.pct+'"]').value}})};
  var all=document.getElementById('all');
  req({action:'save',branchId:sel.value,allBranches:!!(all&&all.checked),rules:rules}).then(function(x){btn.disabled=false;
    if(x.error){document.getElementById('msg').innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(x.error)+'</div>';return}
    render(x,'<div class="msg ok" style="margin-top:10px">✓ Saqlandi. Endi har savdodan avtomatik ushlanadi.</div>')});
}
function load(){document.getElementById('form').innerHTML=haloLoading(3);req({branchId:sel.value}).then(function(x){render(x)})}
sel.addEventListener('change',load);load();
`,
  });
}
