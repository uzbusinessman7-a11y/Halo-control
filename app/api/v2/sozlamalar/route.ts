import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { normalizeStaff } from "../../../lib/payroll";
import { createWorkerAccount, deleteWorkerAccount, listWorkerAccounts } from "../../../lib/worker-auth";
import { menuAccessIds, setMenuAccess, StaffMenuError } from "../../../core/menu-staff";
import type { D1Like } from "../../../lib/full-migration";
import { deleteStaffMember, saveStaffMember, StaffError } from "../../../core/staff";
import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

/**
 * HALO V2 — sozlamalar: xodim akkauntlari (login/PIN, xodimga bog'lash), Telegram bot va filiallar.
 * Akkaunt, Telegram va filial amallari mavjud tekshirilgan API'lar orqali; bu yerda faqat
 * "akkauntni xodimga bog'lash" server tomonda (bitta akkaunt — bitta xodim).
 */
const PAGE_PATH = "/api/v2/sozlamalar";
const menuDb = (): D1Like => {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Baza ulanmagan.");
  return globalThis.__HALO_CONTROL_DB__ as unknown as D1Like;
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Row = Record<string, unknown>;
class LinkError extends Error {}
class AccountError extends Error {}

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  // Bitta sahifa, ikki bo'lim: Xodimlar → Akkauntlar (?b=akkaunt) va Sozlash → Filiallar (?b=filial).
  const section = new URL(request.url).searchParams.get("b") === "filial" ? "filial" : "akkaunt";
  return new Response(page(branches, section), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
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
    let created: { workerId: string; staffName: string } | null = null;
    if (body.action === "createAccount") {
      // Bir oynada: login + PIN va qaysi xodimga tegishli (bor xodim yoki Maosh'ga yangi xodim). Avval hammasi
      // tekshiriladi, keyin akkaunt ochiladi; xodimga bog'lab bo'lmasa — akkaunt qaytarib o'chiriladi (yarim ish qolmaydi).
      const current = (await readHaloState(branchId)).state as Row;
      const staffNow = normalizeStaff(current.staff);
      const staffId = String(body.staffId || "");
      const fresh = staffId === "" || staffId === "new";
      const newStaff = (st: Row) => saveStaffMember(st, {
        name: body.name, payType: body.payType === "monthly" ? "monthly" : "hourly",
        hourlyRate: body.payType === "monthly" ? 0 : Number(body.rate || 0), monthlySalary: body.payType === "monthly" ? Number(body.rate || 0) : 0,
        operationId: crypto.randomUUID(),
      });
      if (fresh) newStaff(current);
      else {
        const member = staffNow.find((item) => item.id === staffId && item.active);
        if (!member) throw new AccountError("Xodim topilmadi. Sahifani yangilang.");
        if (member.workerId) throw new AccountError(`${member.name} boshqa akkauntga bog‘langan. Ro‘yxatdan boshqasini tanlang.`);
      }
      let workerId = "";
      try {
        workerId = await createWorkerAccount(branchId, String(body.name || ""), String(body.username || ""), String(body.pin || ""));
      } catch (error) {
        throw new AccountError(error instanceof Error ? error.message : "Akkaunt ochilmadi.");
      }
      try {
        const out = await mutateHaloState((cur) => {
          let st = cur as Row;
          let target = staffId;
          if (fresh) {
            const saved = newStaff(st);
            target = String((saved.result.member as Row).id);
            // Belgi: bu profil akkaunt bilan birga ochildi — akkaunt xato bo'lib o'chirilsa, yozuvsiz profil ham o'chadi.
            st = { ...(saved.state as Row), staff: (((saved.state as Row).staff as Row[]) || []).map((member) => (member.id === target ? { ...member, createdWithAccount: workerId } : member)) };
          }
          const linked = linkWorker(st, { workerId, staffId: target });
          return { state: linked.state, result: { name: String(normalizeStaff(linked.state.staff).find((item) => item.id === target)?.name || "") } };
        }, 5, branchId, "Rahbar", fresh ? `Yangi xodim va akkaunt: ${String(body.name || "").slice(0, 60)}` : "Xodim akkaunti ochildi va bog‘landi", "Sozlamalar (yangi)");
        state = out.state as Row;
        created = { workerId, staffName: out.result.name };
      } catch (error) {
        await deleteWorkerAccount(workerId).catch(() => undefined);
        throw error;
      }
    } else if (body.action === "deleteAccount") {
      const workerId = String(body.workerId || "");
      if (!/^[a-f0-9-]{36}$/.test(workerId)) throw new AccountError("Akkauntni tanlang.");
      try { await deleteWorkerAccount(workerId); } catch (error) { throw new AccountError(error instanceof Error ? error.message : "O‘chirilmadi."); }
      // Bog'lanish uziladi. Profil akkaunt bilan birga (shu oynada) ochilgan va hech qanday yozuvi bo'lmasa — u ham o'chadi;
      // aks holda profil va uning yozuvlari qoladi.
      const current = (await readHaloState(branchId)).state as Row;
      state = normalizeStaff(current.staff).some((member) => member.workerId === workerId)
        ? (await mutateHaloState((cur) => {
          const unlinked = linkWorker(cur as Row, { workerId, staffId: "" }).state as Row;
          const own = ((unlinked.staff as Row[]) || []).find((member) => member.createdWithAccount === workerId);
          if (!own) return { state: unlinked, result: null };
          try { return { state: deleteStaffMember(unlinked, { id: own.id }).state as Row, result: null }; } catch { return { state: unlinked, result: null }; }
        }, 5, branchId, "Rahbar", "Xodim akkaunti o‘chirildi", "Sozlamalar (yangi)")).state as Row
        : current;
    } else if (body.action === "menuAccess") {
      // Xodim ilovasida «🍽 Menyu»: Monitor menyuni to'liq boshqarish ruxsati (narx o'zgarsa — kassada ham).
      const workerId = String(body.workerId || "");
      if (!(await listWorkerAccounts(branchId)).some((account) => account.id === workerId)) throw new AccountError("Akkaunt topilmadi. Sahifani yangilang.");
      await setMenuAccess(menuDb(), branchId, workerId, body.allowed === true);
      state = (await readHaloState(branchId)).state as Row;
    } else if (body.action === "link") {
      state = (await mutateHaloState((cur) => linkWorker(cur as Row, body), 5, branchId, "Rahbar", "Xodim akkaunti xodimga bog‘landi", "Sozlamalar (yangi)")).state as Row;
    } else {
      state = (await readHaloState(branchId)).state as Row;
    }
    const staff = normalizeStaff(state.staff).filter((member) => member.active).map((member) => ({ id: member.id, name: member.name, workerId: member.workerId }));
    const menuAccess = await menuAccessIds(menuDb(), branchId).catch(() => [] as string[]);
    return json({ ok: true, staff, menuAccess, ...(created ? { created } : {}) });
  } catch (error) {
    if (error instanceof LinkError || error instanceof AccountError || error instanceof StaffError || error instanceof StaffMenuError) return json({ error: error.message }, 400);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>, section: "akkaunt" | "filial" = "akkaunt"): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  const filial = section === "filial";
  return shell({
    title: filial ? "Filiallar" : "Akkauntlar", active: filial ? "filiallar" : "akkauntlar", heading: filial ? "Filiallar" : "Akkauntlar",
    subtitle: filial ? "Filial qo‘shish, nomi va manzili" : "Xodimlar telefondan kiradigan login va PIN",
    headerRight: `<select id="branch"${filial ? " hidden" : ""}></select>`,
    body: `<section class="card"${filial ? " hidden" : ""}><h2>Xodim akkauntlari</h2><p class="hint">Xodim telefonidan <b>/xodim</b> sahifasiga login va PIN bilan kiradi: ish boshlash/tugatish, vazifalar, POS hisobot, mahsulot kirimi, xarajat, minus tavar, kassa sanog‘i. Har bir akkauntni xodimga bog‘lang — smena maoshga shu orqali tushadi. Kirim va xarajat — faqat belgilangan xodimga. Ruxsat o‘zgarsa, xodim qayta kiradi.</p><div id="acc"></div>
<div class="row" style="margin-top:12px"><button id="accNew">+ Yangi akkaunt</button></div><div id="accForm"></div></section>
<section class="card"${filial ? "" : " hidden"}><h2>Filiallar</h2><div id="br"></div><div class="row" style="margin-top:12px"><button class="ghost" id="brNew">+ Yangi filial</button></div><div id="brForm"></div></section>`,
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
    STAFF=r[1].body.staff||[];var MENUOK=r[1].body.menuAccess||[];var accs=r[0].body.accounts;
    box.innerHTML=accs.length?accs.map(function(a){var linked=STAFF.find(function(m){return m.workerId===a.id});
      return '<div class="item"><b>'+esc(a.name)+' <span style="color:var(--muted);font-weight:600">@'+esc(a.username)+'</span>'+(a.active?'':'<span class="tag warn">to‘xtatilgan</span>')+(linked?'':'<span class="tag bad">xodimga bog‘lanmagan</span>')+'</b><span class="v"></span>'
        +'<small><select data-link="'+esc(a.id)+'" style="min-height:36px;padding:4px 8px;margin:6px 0"><option value="">— xodimga bog‘lash —</option>'+STAFF.map(function(m){return '<option value="'+esc(m.id)+'"'+(linked&&linked.id===m.id?' selected':'')+'>'+esc(m.name)+'</option>'}).join('')+'</select><br>'
        +'<label class="row" style="gap:6px;margin:4px 0"><input type="checkbox" data-perm="supplier-delivery" data-w="'+esc(a.id)+'"'+(a.canSupplierDelivery?' checked':'')+' style="width:18px;height:18px;min-height:auto"> Mahsulot kirimi kiritishi mumkin</label>'
        +'<label class="row" style="gap:6px;margin:4px 0 8px"><input type="checkbox" data-perm="warehouse-receipt" data-w="'+esc(a.id)+'"'+(a.canWarehouseReceipt?' checked':'')+' style="width:18px;height:18px;min-height:auto"> Xarajat kiritishi mumkin</label>'
        +'<label class="row" style="gap:6px;margin:4px 0 8px"><input type="checkbox" data-mperm="'+esc(a.id)+'"'+(MENUOK.indexOf(a.id)>=0?' checked':'')+' style="width:18px;height:18px;min-height:auto"> Menyu va narxni o‘zgartirishi mumkin</label>'
        +'<button class="ghost" data-pin="'+esc(a.id)+'" style="min-height:34px;padding:4px 10px">PIN yangilash</button> <button class="ghost" data-act="'+esc(a.id)+'" data-on="'+(a.active?'0':'1')+'" style="min-height:34px;padding:4px 10px">'+(a.active?'To‘xtatish':'Faollashtirish')+'</button> <button class="ghost" data-del="'+esc(a.id)+'" data-name="'+esc(a.name)+'" style="min-height:34px;padding:4px 10px;color:var(--bad)">🗑 O‘chirish</button>'
        +(a.lastLoginAt?' · oxirgi kirish '+esc(String(a.lastLoginAt).slice(0,16).replace('T',' ')):'')+'</small></div>'}).join(''):'<p class="hint">Hali akkaunt yo‘q.</p>';
    box.querySelectorAll('[data-link]').forEach(function(s){s.addEventListener('change',function(){req(location.pathname,'POST',{action:'link',branchId:sel.value,workerId:s.dataset.link,staffId:s.value}).then(function(x){if(!x.body.ok)alert(x.body.error);loadAccounts()})})});
    box.querySelectorAll('[data-perm]').forEach(function(c){c.addEventListener('change',function(){c.disabled=true;req('/api/worker-auth','POST',{action:c.dataset.perm,workerId:c.dataset.w,allowed:c.checked}).then(function(x){c.disabled=false;if(!x.body.ok){alert(x.body.error||'Saqlanmadi.');c.checked=!c.checked}})})});
    box.querySelectorAll('[data-mperm]').forEach(function(c){c.addEventListener('change',function(){c.disabled=true;req(location.pathname,'POST',{action:'menuAccess',branchId:sel.value,workerId:c.dataset.mperm,allowed:c.checked}).then(function(x){c.disabled=false;if(!x.body.ok){alert(x.body.error||'Saqlanmadi.');c.checked=!c.checked}})})});
    box.querySelectorAll('[data-pin]').forEach(function(b){b.addEventListener('click',function(){var pin=prompt('Yangi PIN (4–8 raqam):');if(!pin)return;req('/api/worker-auth','POST',{action:'reset-pin',workerId:b.dataset.pin,pin:pin}).then(function(x){alert(x.body.ok?'✓ PIN yangilandi':x.body.error)})})});
    box.querySelectorAll('[data-act]').forEach(function(b){b.addEventListener('click',function(){if(!confirm(b.dataset.on==='1'?'Akkaunt faollashtirilsinmi?':'Akkaunt to‘xtatilsinmi? Xodim kira olmay qoladi.'))return;req('/api/worker-auth','POST',{action:'status',workerId:b.dataset.act,active:b.dataset.on==='1'}).then(function(x){if(!x.body.ok)alert(x.body.error);loadAccounts()})})});
    /* Xato ochilgan akkauntni o'chirish: login bo'shaydi, xodimning yozuvlari o'chmaydi. */
    box.querySelectorAll('[data-del]').forEach(function(b){b.addEventListener('click',function(){if(!confirm('«'+b.dataset.name+'» akkaunti o‘chirilsinmi? Login bo‘shaydi. Xodimning ish kunlari va boshqa yozuvlari o‘chmaydi (akkaunt bilan birga ochilgan, hali yozuvi yo‘q xodim profili ham olib tashlanadi).'))return;b.disabled=true;
      req(location.pathname,'POST',{action:'deleteAccount',branchId:sel.value,workerId:b.dataset.del}).then(function(x){b.disabled=false;if(!x.body.ok){alert(x.body.error||'O‘chirilmadi.');return}loadAccounts()})})});
  });
}
/* Ismdan login: lotin harf va raqam (O‘tkir → otkir, Жасур → jasur). Xodim keyin o'zgartirishi mumkin. */
function loginFrom(name){var m={'а':'a','б':'b','в':'v','г':'g','ғ':'g','д':'d','е':'e','ё':'yo','ж':'j','з':'z','и':'i','й':'y','к':'k','қ':'q','л':'l','м':'m','н':'n','о':'o','ў':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'x','ҳ':'h','ц':'s','ч':'ch','ш':'sh','щ':'sh','ъ':'','ы':'i','ь':'','э':'e','ю':'yu','я':'ya'};
  return String(name||'').toLowerCase().split('').map(function(c){return m[c]!==undefined?m[c]:c}).join('').replace(/[^a-z0-9]/g,'').slice(0,32)}
document.getElementById('accNew').addEventListener('click',function(){
  var box=document.getElementById('accForm'),free=STAFF.filter(function(m){return !m.workerId}),touched=false,pt='hourly';
  box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:12px"><h2>Yangi akkaunt</h2>'
    +'<label class="field"><span>Xodim ismi</span><input id="aN" maxlength="60" placeholder="Masalan: O‘tkir"></label>'
    +'<label class="field"><span>Qaysi xodim? (davomat va maosh shunga yoziladi)</span><select id="aW">'+free.map(function(m){return '<option value="'+esc(m.id)+'">'+esc(m.name)+' — Maosh’dagi xodim</option>'}).join('')+'<option value="new">＋ Yangi xodim (Maosh’ga ham qo‘shiladi)</option></select></label>'
    +'<div id="aNew"><div class="row" style="margin-bottom:10px"><button type="button" data-apt="hourly">Soatbay</button><button type="button" class="ghost" data-apt="monthly">Oylik</button></div>'
    +'<label class="field"><span id="aRL">Soatlik stavka (₩)</span><input id="aR" inputmode="numeric" placeholder="masalan: 11,000"></label></div>'
    +'<label class="field"><span>Login — xodim telefonda shu bilan kiradi</span><input id="aU" maxlength="32" autocapitalize="off" autocomplete="off" spellcheck="false"></label>'
    +'<p class="hint" id="aUh" style="margin:-6px 0 12px">Ismdan o‘zi yoziladi. Faqat lotin harf va raqam, kamida 3 ta.</p>'
    +'<label class="field"><span>PIN (4–8 raqam)</span><input id="aP" inputmode="numeric" maxlength="8" autocomplete="off"></label>'
    +'<div class="row"><button id="aS">Yaratish</button><button class="ghost" id="aC">Bekor</button></div><div id="aM"></div></div>';
  var nm=document.getElementById('aN'),w=document.getElementById('aW'),u=document.getElementById('aU'),uh=document.getElementById('aUh'),rate=document.getElementById('aR');
  w.value='new';
  var sync=function(){document.getElementById('aNew').hidden=w.value!=='new'};
  var checkU=function(){var v=u.value.trim().toLowerCase(),okU=/^[a-z0-9][a-z0-9._-]{2,31}$/.test(v);
    uh.style.color=!v||okU?'':'var(--bad)';uh.textContent=!v||okU?'Ismdan o‘zi yoziladi. Faqat lotin harf va raqam, kamida 3 ta.':'Login yaroqsiz: faqat lotin harf va raqam (o‘, g‘, ’, bo‘sh joy va kirill harf bo‘lmaydi), kamida 3 ta.'};
  nm.addEventListener('input',function(){var v=nm.value.trim().toLowerCase(),same=free.find(function(m){return m.name.toLowerCase()===v});
    if(same)w.value=same.id;else if(w.value!=='new'&&!free.some(function(m){return m.id===w.value&&m.name.toLowerCase()===v}))w.value='new';
    if(!touched){u.value=loginFrom(nm.value);checkU()}sync()});
  w.addEventListener('change',function(){var m=free.find(function(x){return x.id===w.value});if(m){nm.value=m.name;if(!touched){u.value=loginFrom(m.name);checkU()}}sync()});
  u.addEventListener('input',function(){touched=true;checkU()});
  rate.addEventListener('input',function(){var n=rate.value.replace(/[^0-9]/g,'');rate.value=n?Number(n).toLocaleString('en-US'):''});
  box.querySelectorAll('[data-apt]').forEach(function(b){b.addEventListener('click',function(){pt=b.dataset.apt;box.querySelectorAll('[data-apt]').forEach(function(x){x.className=x===b?'':'ghost'});document.getElementById('aRL').textContent=pt==='monthly'?'Oylik maosh (₩)':'Soatlik stavka (₩)'})});
  sync();
  document.getElementById('aC').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('aS').addEventListener('click',function(){var btn=this,login=u.value.trim().toLowerCase();btn.disabled=true;
    req(location.pathname,'POST',{action:'createAccount',branchId:sel.value,name:nm.value,username:login,pin:document.getElementById('aP').value,staffId:w.value,payType:pt,rate:Number(rate.value.replace(/[^0-9]/g,''))||0}).then(function(x){btn.disabled=false;
      if(!x.body.ok){msg(document.getElementById('aM'),false,x.body.error||'Yaratilmadi.');return}
      box.innerHTML='<div class="msg ok" style="margin-top:12px">✓ Akkaunt ochildi va «'+esc(x.body.created.staffName)+'»ga bog‘landi. Xodim telefonda «HALO Xodim» ilovasiga <b>'+esc(login)+'</b> logini va PIN bilan kiradi.</div>';
      loadAccounts()})});
});
/* --- Filiallar --- */
function loadBranches(){
  req('/api/branches','GET').then(function(x){var list=(x.body&&x.body.branches)||BRANCHES;
    document.getElementById('br').innerHTML=list.map(function(b){return '<div class="list-row"><div><b>'+esc(b.name)+'</b>'+(b.address?'<br><small style="color:var(--muted)">'+esc(b.address)+'</small>':'')+'</div><button class="ghost" data-rn="'+esc(b.id)+'" style="min-height:34px;padding:4px 10px">Nomini o‘zgartirish</button></div>'}).join('');
    document.querySelectorAll('[data-rn]').forEach(function(b){b.addEventListener('click',function(){var n=prompt('Yangi nom:');if(!n)return;req('/api/branches','PATCH',{branchId:b.dataset.rn,name:n}).then(function(r){if(r.body.error)alert(r.body.error);location.reload()})})});
  });
}
document.getElementById('brNew').addEventListener('click',function(){var n=prompt('Yangi filial nomi:');if(!n)return;var a=prompt('Manzil (ixtiyoriy):')||'';req('/api/branches','POST',{name:n,address:a}).then(function(r){if(r.body.error)alert(r.body.error);else location.reload()})});
function loadAll(){loadAccounts();loadBranches()}
sel.addEventListener('change',loadAll);loadAll();
`,
  });
}
