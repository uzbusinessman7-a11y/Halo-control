import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { normalizeStaff } from "../../../lib/payroll";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — sozlamalar: xodim akkauntlari (login/PIN, xodimga bog'lash), Telegram bot va filiallar.
 * Akkaunt, Telegram va filial amallari mavjud tekshirilgan API'lar orqali; bu yerda faqat
 * "akkauntni xodimga bog'lash" server tomonda (bitta akkaunt — bitta xodim).
 */
const PAGE_PATH = "/api/v2/sozlamalar";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Row = Record<string, unknown>;
class LinkError extends Error {}

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  return new Response(page(branches), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function linkWorker(state: Row, body: Row) {
  const staff = Array.isArray(state.staff) ? state.staff as Row[] : [];
  const staffId = String(body.staffId || "");
  const workerId = String(body.workerId || "");
  if (!/^[a-f0-9-]{36}$/.test(workerId)) throw new LinkError("Akkauntni tanlang.");
  if (staffId && !staff.some((member) => member.id === staffId)) throw new LinkError("Xodim topilmadi.");
  const next = staff.map((member) => {
    if (member.workerId === workerId && member.id !== staffId) return { ...member, workerId: "" };
    if (member.id === staffId) return { ...member, workerId };
    return member;
  });
  return { state: { ...state, staff: next }, result: { linked: Boolean(staffId) } };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Row;
    const branchId = String(body.branchId || "main");
    let state: Row;
    if (body.action === "link") {
      state = (await mutateHaloState((cur) => linkWorker(cur as Row, body), 5, branchId, "Rahbar", "Xodim akkaunti xodimga bog‘landi", "Sozlamalar (yangi)")).state as Row;
    } else {
      state = (await readHaloState(branchId)).state as Row;
    }
    const staff = normalizeStaff(state.staff).filter((member) => member.active).map((member) => ({ id: member.id, name: member.name, workerId: member.workerId }));
    return json({ ok: true, staff });
  } catch (error) {
    if (error instanceof LinkError) return json({ error: error.message }, 400);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Sozlamalar", active: "bosh", heading: "Sozlamalar",
    subtitle: "Xodim akkauntlari, Telegram bot va filiallar",
    headerRight: '<select id="branch"></select>',
    body: `<section class="card"><h2>Xodim akkauntlari</h2><p class="hint">Xodim telefonidan <b>/api/v2/xodim</b> sahifasiga login va PIN bilan kiradi: ish boshlash/tugatish, kassa sanog‘i, kirim. Har bir akkauntni xodimga bog‘lang — smena maoshga shu orqali tushadi.</p><div id="acc"></div>
<div class="row" style="margin-top:12px"><button id="accNew">+ Yangi akkaunt</button></div><div id="accForm"></div></section>
<section class="card"><h2>Telegram bot</h2><div id="tg"></div></section>
<section class="card"><h2>Filiallar</h2><div id="br"></div><div class="row" style="margin-top:12px"><button class="ghost" id="brNew">+ Yangi filial</button></div><div id="brForm"></div></section>`,
    script: `
var BRANCHES=${boot},STAFF=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function req(url,method,body){return fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:'Internet aloqasini tekshiring.'}}})}
var sel=document.getElementById('branch');sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function msg(el,ok,text){el.innerHTML='<div class="msg '+(ok?'ok':'bad')+'" style="margin-top:10px">'+esc(text)+'</div>'}
/* --- Akkauntlar --- */
function loadAccounts(){
  var box=document.getElementById('acc');box.innerHTML=haloLoading(3);
  Promise.all([req('/api/worker-auth?admin=1&branch='+encodeURIComponent(sel.value),'GET'),req(location.pathname,'POST',{branchId:sel.value})]).then(function(r){
    if(!r[0].body.accounts){box.innerHTML='<div class="msg bad">'+esc(r[0].body.error||'Ochilmadi.')+'</div>';return}
    STAFF=r[1].body.staff||[];var accs=r[0].body.accounts;
    box.innerHTML=accs.length?accs.map(function(a){var linked=STAFF.find(function(m){return m.workerId===a.id});
      return '<div class="item"><b>'+esc(a.name)+' <span style="color:var(--muted);font-weight:600">@'+esc(a.username)+'</span>'+(a.active?'':'<span class="tag warn">to‘xtatilgan</span>')+(linked?'':'<span class="tag bad">xodimga bog‘lanmagan</span>')+'</b><span class="v"></span>'
        +'<small><select data-link="'+esc(a.id)+'" style="min-height:36px;padding:4px 8px;margin:6px 0"><option value="">— xodimga bog‘lash —</option>'+STAFF.map(function(m){return '<option value="'+esc(m.id)+'"'+(linked&&linked.id===m.id?' selected':'')+'>'+esc(m.name)+'</option>'}).join('')+'</select><br>'
        +'<button class="ghost" data-pin="'+esc(a.id)+'" style="min-height:34px;padding:4px 10px">PIN yangilash</button> <button class="ghost" data-act="'+esc(a.id)+'" data-on="'+(a.active?'0':'1')+'" style="min-height:34px;padding:4px 10px">'+(a.active?'To‘xtatish':'Faollashtirish')+'</button>'
        +(a.lastLoginAt?' · oxirgi kirish '+esc(String(a.lastLoginAt).slice(0,16).replace('T',' ')):'')+'</small></div>'}).join(''):'<p class="hint">Hali akkaunt yo‘q.</p>';
    box.querySelectorAll('[data-link]').forEach(function(s){s.addEventListener('change',function(){req(location.pathname,'POST',{action:'link',branchId:sel.value,workerId:s.dataset.link,staffId:s.value}).then(function(x){if(!x.body.ok)alert(x.body.error);loadAccounts()})})});
    box.querySelectorAll('[data-pin]').forEach(function(b){b.addEventListener('click',function(){var pin=prompt('Yangi PIN (4–8 raqam):');if(!pin)return;req('/api/worker-auth','POST',{action:'reset-pin',workerId:b.dataset.pin,pin:pin}).then(function(x){alert(x.body.ok?'✓ PIN yangilandi':x.body.error)})})});
    box.querySelectorAll('[data-act]').forEach(function(b){b.addEventListener('click',function(){if(!confirm(b.dataset.on==='1'?'Akkaunt faollashtirilsinmi?':'Akkaunt to‘xtatilsinmi? Xodim kira olmay qoladi.'))return;req('/api/worker-auth','POST',{action:'status',workerId:b.dataset.act,active:b.dataset.on==='1'}).then(function(x){if(!x.body.ok)alert(x.body.error);loadAccounts()})})});
  });
}
document.getElementById('accNew').addEventListener('click',function(){
  var box=document.getElementById('accForm');
  box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:12px"><label class="field"><span>Xodim ismi</span><input id="aN" maxlength="60"></label><label class="field"><span>Login (lotin harf/raqam)</span><input id="aU" maxlength="32" autocapitalize="off" autocomplete="off"></label><label class="field"><span>PIN (4–8 raqam)</span><input id="aP" inputmode="numeric" maxlength="8" autocomplete="off"></label><div class="row"><button id="aS">Yaratish</button><button class="ghost" id="aC">Bekor</button></div><div id="aM"></div></div>';
  document.getElementById('aC').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('aS').addEventListener('click',function(){var btn=this;btn.disabled=true;
    req('/api/worker-auth','POST',{action:'create',branchId:sel.value,name:document.getElementById('aN').value,username:document.getElementById('aU').value.trim().toLowerCase(),pin:document.getElementById('aP').value}).then(function(x){btn.disabled=false;
      if(!x.body.ok){msg(document.getElementById('aM'),false,x.body.error||'Yaratilmadi.');return}box.innerHTML='';loadAccounts()})});
});
/* --- Telegram --- */
function loadTelegram(){
  var box=document.getElementById('tg');
  req('/api/telegram?branch='+encodeURIComponent(sel.value),'GET').then(function(x){var t=x.body||{};
    box.innerHTML='<p class="hint">'+(t.configured?'✓ Ulangan: '+esc(t.botName||'bot')+' · chat '+esc(t.chatId)+(t.enabled?' · kunlik hisobot yoqilgan ('+esc(t.reportTime)+')':' · kunlik hisobot o‘chirilgan'):'Bot ulanmagan.')+'</p>'
      +'<label class="field"><span>Bot token '+(t.tokenSaved?'(saqlangan — o‘zgartirish uchun yangisini yozing)':'(BotFather beradi)')+'</span><input id="tT" autocomplete="off" placeholder="'+(t.tokenSaved?'••••••••':'123456:ABC…')+'"></label>'
      +'<div class="row"><label class="field" style="flex:2"><span>Chat ID</span><input id="tC" value="'+esc(t.chatId||'')+'"></label><button class="ghost" id="tD" style="align-self:flex-end;margin-bottom:12px">Topish</button></div>'
      +'<div class="row"><label class="field" style="flex:1"><span>Hisobot vaqti</span><input type="time" id="tR" value="'+esc(t.reportTime||'00:10')+'"></label><label class="row" style="flex:1;gap:8px"><input type="checkbox" id="tE" style="width:18px;height:18px;min-height:auto"'+(t.enabled?' checked':'')+'> Har kuni avtomatik</label></div>'
      +'<div class="row"><button id="tS">Saqlash</button><button class="ghost" id="tX">Sinov xabari</button></div><div id="tM"></div>'
      +'<p class="hint" style="margin-top:10px">Eslatma: to‘liq o‘tishgacha bu sayt avtomatik hisobot yubormaydi (eski saytdan keladi).</p>';
    document.getElementById('tD').addEventListener('click',function(){req('/api/telegram','POST',{action:'discover',branchId:sel.value,botToken:document.getElementById('tT').value.trim()||undefined}).then(function(r){if(r.body.ok){document.getElementById('tC').value=r.body.chatId;msg(document.getElementById('tM'),true,'Topildi: '+r.body.chatName)}else msg(document.getElementById('tM'),false,r.body.error)})});
    document.getElementById('tS').addEventListener('click',function(){req('/api/telegram','POST',{action:'save',branchId:sel.value,botToken:document.getElementById('tT').value.trim()||undefined,chatId:document.getElementById('tC').value.trim(),reportTime:document.getElementById('tR').value,enabled:document.getElementById('tE').checked}).then(function(r){if(r.body.ok){loadTelegram()}else msg(document.getElementById('tM'),false,r.body.error)})});
    document.getElementById('tX').addEventListener('click',function(){req('/api/telegram','POST',{action:'test',branchId:sel.value}).then(function(r){msg(document.getElementById('tM'),r.body.ok,r.body.ok?r.body.message:r.body.error)})});
  });
}
/* --- Filiallar --- */
function loadBranches(){
  req('/api/branches','GET').then(function(x){var list=(x.body&&x.body.branches)||BRANCHES;
    document.getElementById('br').innerHTML=list.map(function(b){return '<div class="list-row"><div><b>'+esc(b.name)+'</b>'+(b.address?'<br><small style="color:var(--muted)">'+esc(b.address)+'</small>':'')+'</div><button class="ghost" data-rn="'+esc(b.id)+'" style="min-height:34px;padding:4px 10px">Nomini o‘zgartirish</button></div>'}).join('');
    document.querySelectorAll('[data-rn]').forEach(function(b){b.addEventListener('click',function(){var n=prompt('Yangi nom:');if(!n)return;req('/api/branches','PATCH',{branchId:b.dataset.rn,name:n}).then(function(r){if(r.body.error)alert(r.body.error);location.reload()})})});
  });
}
document.getElementById('brNew').addEventListener('click',function(){var n=prompt('Yangi filial nomi:');if(!n)return;var a=prompt('Manzil (ixtiyoriy):')||'';req('/api/branches','POST',{name:n,address:a}).then(function(r){if(r.body.error)alert(r.body.error);else location.reload()})});
function loadAll(){loadAccounts();loadTelegram();loadBranches()}
sel.addEventListener('change',loadAll);loadAll();
`,
  });
}
