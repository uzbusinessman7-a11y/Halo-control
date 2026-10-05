import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { addAdjustment, addShift, addShifts, editShift, repairPaymentPaidAt, payStaff, saveStaffMember, setDayStatus, StaffError, staffList, staffRecords, voidAdjustment, voidDayStatus, voidPayment, voidShift } from "../../../core/staff";
import { LedgerError } from "../../../core/ledger";
import { runPayrollBridge } from "../../../core/payroll-bridge";
import { isMonth, payslip, payslipText } from "../../../core/payroll-ledger";
import type { D1Like } from "../../../lib/full-migration";
import { STAFF_DAYS_SCRIPT, STAFF_DAYS_STYLE } from "../../../core/staff-days-ui";
import { listAttendanceAttempts, PlaceError, readAttendancePlace, saveAttendancePlace } from "../../../core/attendance-place";
import { ATTENDANCE_PLACE_SCRIPT } from "../../../core/attendance-place-ui";
import { GeocodeError, geocodeStatus, removeKakaoKey, saveKakaoKey, searchPlace } from "../../../core/geocode";
import { shell } from "../../../core/ui-shell";
import { assertV2DayOpen, ClosedDayError } from "../../../core/closed-days";

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

const PAGE_PATH = "/api/v2/maosh";
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
  // Xodimlar → «Keldim / ketdim joyi» shu sahifaning alohida ko'rinishi (?b=joy).
  const joy = new URL(request.url).searchParams.get("b") === "joy";
  return new Response(page(branches, joy), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const branchId = String(body.branchId || "main");
    const scope = { tenantId: TENANT_ID, branchId };
    const today = seoulToday();
    const month = isMonth(body.month) ? body.month : today.slice(0, 7);
    const accountsOf = (st: Record<string, unknown>) => (Array.isArray(st.accounts) ? st.accounts as Array<Record<string, unknown>> : [])
      .filter((a) => (a.type === "cash" || a.type === "bank") && a.active !== false).map((a) => ({ id: String(a.id), name: String(a.name || a.id) }));
    const mutations: Record<string, [(st: Record<string, unknown>) => { state: Record<string, unknown>; result: unknown }, string]> = {
      saveStaff: [(st) => saveStaffMember(st, body), "Xodim ma’lumoti saqlandi"],
      shift: [(st) => addShift(st, body, today), "Smena qo‘lda kiritildi"],
      shifts: [(st) => addShifts(st, body, today), `Ishlagan kunlar qo‘lda kiritildi · ${Array.isArray(body.dates) ? body.dates.length : 0} kun`],
      adjust: [(st) => addAdjustment(st, body, today), body.type === "bonus" ? "Bonus yozildi" : "Ushlanma yozildi"],
      pay: [(st) => payStaff(st, body, today), body.kind === "advance" ? "Avans berildi" : "Oylik to‘landi"],
      editShift: [(st) => editShift(st, body), `Smena vaqti tuzatildi · Sabab: ${String(body.reason || "").slice(0, 80)}`],
      voidShift: [(st) => voidShift(st, body), `Smena bekor qilindi · Sabab: ${String(body.reason || "").slice(0, 80)}`],
      dayStatus: [(st) => setDayStatus(st, body, today), "Kun holati saqlandi"],
      voidDay: [(st) => voidDayStatus(st, body), `Kun holati bekor qilindi · Sabab: ${String(body.reason || "").slice(0, 80)}`],
      voidAdj: [(st) => voidAdjustment(st, body), `Bonus/ushlanma bekor qilindi · Sabab: ${String(body.reason || "").slice(0, 80)}`],
      voidPay: [(st) => voidPayment(st, body, today), `Maosh to‘lovi bekor qilindi · Sabab: ${String(body.reason || "").slice(0, 80)}`],
    };
    const action = String(body.action || "");
    if (action === "pay") await assertV2DayOpen(branchId, String(body.date || today));
    if (action === "voidPay") await assertV2DayOpen(branchId, today);
    if (action === "place" || action === "savePlace") {
      // Keldim / ketdim joyi: filial bo'yicha nuqta, masofa va oxirgi urinishlar (xodim koordinatasi saqlanmaydi).
      const place = action === "savePlace" ? await saveAttendancePlace(database(), branchId, body) : await readAttendancePlace(database(), branchId);
      return json({ ok: true, place, log: await listAttendanceAttempts(database(), branchId, 30), geo: await geocodeStatus(database()) });
    }
    // Manzil bo'yicha qidirish (Kakao). Kalit javobda qaytarilmaydi; qidiruv hech narsa saqlamaydi.
    if (action === "geocode") return json({ ok: true, results: await searchPlace(database(), body.query) });
    if (action === "saveGeoKey") return json({ ok: true, geo: await saveKakaoKey(database(), body.key) });
    if (action === "removeGeoKey") return json({ ok: true, geo: await removeKakaoKey(database()) });
    if (action === "records") {
      const st = (await readHaloState(branchId)).state as Record<string, unknown>;
      return json({ ok: true, today, records: staffRecords(st, String(body.staffId || ""), month) });
    }
    if (action === "staff" || mutations[action]) {
      let st: Record<string, unknown>;
      if (mutations[action]) {
        const [fn, label] = mutations[action];
        st = (await mutateHaloState((cur) => fn(repairPaymentPaidAt(cur as Record<string, unknown>)), 5, branchId, "Rahbar", label, "Maosh (yangi)")).state as Record<string, unknown>;
      } else st = (await readHaloState(branchId)).state as Record<string, unknown>;
      return json({ ok: true, today, staff: staffList(st), accounts: accountsOf(st) });
    }
    const { state } = await readHaloState(branchId);
    const bridge = await runPayrollBridge(database(), scope, state as Record<string, unknown>, today);
    if (body.action === "payslip") {
      const slip = await payslip(database(), scope, String(body.employeeId || ""), month);
      return json({ ok: true, payslip: slip, text: payslipText(slip) });
    }
    const employees = bridge.employees.map((employee) => {
      const current = employee.months.find((item) => item.month === month) || null;
      return { employeeId: employee.employeeId, oldId: employee.oldId, name: employee.name, active: employee.active, current };
    }).filter((employee) => employee.active || employee.current);
    return json({
      ok: true, today, month, employees,
      totals: employees.reduce((sum, employee) => ({
        earned: sum.earned + (employee.current?.earned || 0) + (employee.current?.bonus || 0) - (employee.current?.deduction || 0),
        remaining: sum.remaining + (employee.current?.ledgerRemaining || 0),
      }), { earned: 0, remaining: 0 }),
      checks: {
        mismatched: bridge.mismatched, corrected: bridge.corrected, reversed: bridge.reversed, invalid: bridge.invalid,
        unpaidPast: bridge.unpaidPast, overpaid: bridge.overpaid, advancesWithoutCash: bridge.advancesWithoutCash,
      },
    });
  } catch (error) {
    if (error instanceof StaffError) return json({ error: error.message }, error.status);
    if (error instanceof PlaceError) return json({ error: error.message }, error.status);
    if (error instanceof GeocodeError) return json({ error: error.message, code: error.code || undefined }, error.status);
    if (error instanceof ClosedDayError) return json({ error: error.message }, 409);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    if (error instanceof LedgerError || (error instanceof Error && /filial/i.test(error.message))) return json({ error: error.message }, 400);
    return json({ error: "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>, joy = false): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: joy ? "Keldim / ketdim joyi" : "Maosh", active: joy ? "joy" : "maosh", heading: joy ? "Keldim / ketdim joyi" : "Maosh",
    subtitle: joy ? "Xodim «ISHNI BOSHLADIM / TUGATDIM»ni faqat oshxona yaqinida bosa oladi" : "Har bir xodim uchun oylik hisob varaqasi",
    headerRight: `<div class="row"><input type="month" id="month"${joy ? " hidden" : ""}><select id="branch"></select></div>`,
    // Tartib: 1) to'lash qolgan summa, 2) nazorat, 3) xodimlar ro'yxati (bosilsa — varaqa), 4) sozlash — pastda.
    body: `<section class="card noprint" id="sumCard"${joy ? " hidden" : ""}><div id="sum"><p class="hint" style="margin:0">Yuklanmoqda…</p></div></section>
<section class="card noprint" id="checkCard"${joy ? " hidden" : ""}><h2>Nazorat</h2><div id="checks"><p class="hint">Yuklanmoqda…</p></div></section>
<section class="card noprint" id="listCard"${joy ? " hidden" : ""}><h2>Xodimlar</h2><div id="list"></div></section>
<section class="card" id="slipCard" hidden></section>
<section class="noprint"><div class="row"${joy ? " hidden" : ""}><button class="ghost" id="manage">👥 Xodimlar ro‘yxati va stavkalar</button></div><div id="staffBox"></div></section>${STAFF_DAYS_STYLE}`,
    script: `
var BRANCHES=${boot},MONTH='',OLD={},STAFF=null,ACC=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function hours(m){m=Number(m||0);return Math.floor(m/60)+' soat'+(m%60?' '+(m%60)+' daq':'')}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch'),mon=document.getElementById('month');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
var KIND={earned:'Ish kuni',paid_leave:'Haq to‘lanadigan dam',rounding:'Yaxlitlash',bonus:'Bonus',deduction:'Ushlanma',advance:'Avans',payment:'To‘lov'};
function load(){
  document.getElementById('slipCard').hidden=true;
  api({branchId:sel.value,month:mon.value||undefined}).then(function(res){
    var list=document.getElementById('list'),checks=document.getElementById('checks');
    if(!res.ok){checks.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';list.innerHTML='';document.getElementById('sum').innerHTML='';return}
    MONTH=res.month;mon.value=res.month;OLD={};res.employees.forEach(function(e){OLD[e.employeeId]=e.oldId});var c=res.checks,out=[];
    if(c.mismatched)out.push('<div class="msg bad">⚠ '+c.mismatched+' ta oyda eski tizim bilan farq bor</div>');
    if(c.invalid.length)out.push('<div class="msg bad">⚠ '+c.invalid.length+' ta yozuv kiritilmadi: '+c.invalid.slice(0,3).map(esc).join(' · ')+'</div>');
    if(c.unpaidPast.length)out.push('<div class="msg warn">O‘tgan oylardan to‘lanmagan: '+c.unpaidPast.map(function(u){return esc(u.name)+' ('+esc(u.month)+') '+won(u.amount)}).join(' · ')+'</div>');
    if(c.overpaid.length)out.push('<div class="msg warn">Ortiqcha to‘langan: '+c.overpaid.map(function(u){return esc(u.name)+' ('+esc(u.month)+') '+won(u.amount)}).join(' · ')+'</div>');
    if(c.advancesWithoutCash)out.push('<div class="msg warn">'+c.advancesWithoutCash+' ta avans faqat maoshdan ayirilgan — kassa/bank hisobidan chiqmagan. Pul qayerdan berilgani yozilmagan.</div>');
    if(c.corrected)out.push('<div class="msg warn">'+c.corrected+' ta yozuv eski tizimda keyin o‘zgartirilgan — tarixi saqlandi</div>');
    if(!out.length)out.push('<div class="msg ok">✓ Hammasi eski tizim bilan wonma-won mos, muammo yo‘q</div>');
    checks.innerHTML=out.join('');
    document.getElementById('sum').innerHTML='<div class="total">'+won(res.totals.remaining)+'</div><p class="hint" style="margin:0">'+esc(res.month)+' uchun to‘lash qolgan · jami hisoblangan '+won(res.totals.earned)+'</p>';
    list.innerHTML=(res.employees.length?'':'<p class="hint">Xodim yo‘q. Pastdagi «Xodimlar ro‘yxati va stavkalar» orqali qo‘shing.</p>')
      +res.employees.map(function(e){var m=e.current;
        return '<div class="emp" data-id="'+esc(e.employeeId)+'"><b>'+esc(e.name)+(e.active?'':'<span class="tag warn">ishdan ketgan</span>')+(m&&m.difference?'<span class="tag bad">farq '+won(m.difference)+'</span>':'')+'</b><span class="v">'+won(m?m.ledgerRemaining:0)+'</span>'
          +'<small>'+(m?m.workedDays+' kun · '+hours(m.workedMinutes)+' · hisoblandi '+won(m.earned+m.bonus-m.deduction)+(m.advance+m.paid?' · berildi '+won(m.advance+m.paid):''):'Bu oyda yozuv yo‘q')+' · Varaqa ›</small></div>'}).join('');
    list.querySelectorAll('.emp').forEach(function(el){el.addEventListener('click',function(){openSlip(el.dataset.id)})});
  });
}
function openSlip(id){
  var card=document.getElementById('slipCard');card.hidden=false;card.innerHTML='<p class="hint">Yuklanmoqda…</p>';card.scrollIntoView({behavior:'smooth'});
  api({action:'payslip',branchId:sel.value,employeeId:id,month:MONTH}).then(function(res){
    if(!res.ok){card.innerHTML='<div class="msg bad">'+esc(res.error)+'</div>';return}
    var p=res.payslip;
    card.innerHTML='<h2>Hisob varaqasi</h2><h3 style="margin:6px 0">'+esc(p.employee.name)+' · '+esc(p.month)+'</h3>'
      +'<p class="hint">'+p.workedDays+' kun ishladi · '+hours(p.workedMinutes)+(p.paidLeaveDays?' · haq to‘lanadigan dam: '+p.paidLeaveDays+' kun':'')+'</p>'
      +'<table><tr><th>Sana</th><th>Yozuv</th><th class="n">Summa</th></tr>'
      +p.lines.map(function(l){return '<tr><td>'+esc(l.date.slice(5))+'</td><td>'+esc(KIND[l.kind]||l.kind)+(l.memo?'<br><small style="color:var(--muted)">'+esc(l.memo)+'</small>':'')+'</td><td class="n">'+(l.amount>0?'+':'−')+won(Math.abs(l.amount))+'</td></tr>'}).join('')
      +'<tr class="sum"><td colspan="2">Hisoblandi (bonus va ushlanma bilan)</td><td class="n">'+won(p.gross)+'</td></tr>'
      +'<tr class="sum"><td colspan="2">Berildi (avans + to‘lov)</td><td class="n">'+won(p.advance+p.paid)+'</td></tr>'
      +'<tr class="sum"><td colspan="2">'+(p.remaining>=0?'To‘lanishi kerak':'Ortiqcha to‘langan')+'</td><td class="n">'+won(Math.abs(p.remaining))+'</td></tr></table>'
      +(p.earlierMonths?'<p class="hint" style="margin-top:10px">Oldingi oylardan '+(p.earlierMonths>0?'to‘lanmagan: ':'ortiqcha to‘langan: ')+won(Math.abs(p.earlierMonths))+'</p>':'')
      +(p.corrections.length?'<details class="noprint" style="margin-top:10px"><summary>'+p.corrections.length+' ta tuzatish tarixi</summary>'+p.corrections.map(function(c){return '<div class="hint">'+esc(c.date)+' · '+won(c.amount)+' · '+esc(c.memo)+'</div>'}).join('')+'</details>':'')
      +'<div class="row noprint" style="margin-top:14px"><button data-act="days">🗓 Ishlagan kunlar</button><button class="ghost" data-act="adjust">± Bonus / ushlanma</button><button class="ghost" data-act="pay">💸 To‘lash</button><button class="ghost" data-act="day">📅 Dam / kasal / kelmadi</button><button class="ghost" data-act="recs">🧾 Yozuvlar / tuzatish</button></div><div id="actBox" class="noprint"></div>'
      +'<div class="row noprint" style="margin-top:12px"><button id="copy">📋 Xodimga yuborish uchun nusxa</button><button class="ghost" id="print">🖨 Chop etish / PDF</button></div><div id="cmsg" class="noprint"></div>';
    document.getElementById('print').addEventListener('click',function(){window.print()});
    card.querySelectorAll('[data-act]').forEach(function(b){b.addEventListener('click',function(){if(b.dataset.act==='recs')recordsBox(OLD[id],id,p.employee.name);else if(b.dataset.act==='days')daysForm(OLD[id],id,p.employee.name);else actionForm(b.dataset.act,OLD[id],id,p.employee.name)})});
    if(NOTE){document.getElementById('actBox').innerHTML=NOTE;NOTE=''}
    document.getElementById('copy').addEventListener('click',function(){
      var done=function(){document.getElementById('cmsg').innerHTML='<div class="msg ok" style="margin-top:10px">✓ Nusxa olindi — Telegram yoki KakaoTalk’ga joylang</div>'};
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(res.text).then(done,function(){prompt('Matnni nusxalang:',res.text)})}else{prompt('Matnni nusxalang:',res.text)}
    });
  });
}

function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){var r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16)})}
function digits(v){return Number(String(v||'').replace(/[^0-9]/g,''))||0}
function moneyField(id){var el=document.getElementById(id);el.addEventListener('input',function(){var v=digits(el.value);el.value=v?v.toLocaleString('en-US'):''})}
function ensureStaff(cb){if(STAFF)return cb();api({action:'staff',branchId:sel.value}).then(function(r){if(r.ok){STAFF=r.staff;ACC=r.accounts}cb()})}
function actionForm(kind,staffId,employeeId,name){
  var box=document.getElementById('actBox'),op=uuid(),today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
  ensureStaff(function(){
    var html='<div class="card" style="background:var(--card-2);margin-top:12px"><h2>'+esc(name)+' — '+(kind==='adjust'?'bonus yoki ushlanma':kind==='day'?'kun holati':'to‘lash')+'</h2>';
    if(kind==='day')html+='<label class="field"><span>Sana</span><input type="date" id="aDate" value="'+today+'" max="'+today+'"></label><div class="row" style="margin-bottom:12px"><button data-st="off">Dam olish</button><button class="ghost" data-st="sick">Kasal</button><button class="ghost" data-st="absent">Kelmadi</button></div><label class="field"><span>Haq to‘lanadimi?</span><select id="aPm"><option value="unpaid">Yo‘q — to‘lanmaydi</option><option value="planned">Ha — reja bo‘yicha kunlik haq</option></select></label><label class="field"><span>Izoh</span><input id="aNote" maxlength="300"></label>';
    if(kind==='adjust')html+='<div class="row" style="margin-bottom:12px"><button data-t="bonus">+ Bonus</button><button class="ghost" data-t="deduction">− Ushlanma</button></div><label class="field"><span>Summa</span><input class="money" id="aAmt" inputmode="numeric" placeholder="0"></label><label class="field"><span>Sana</span><input type="date" id="aDate" value="'+today+'" max="'+today+'"></label><label class="field"><span>Sababi (xodim varaqada ko‘radi)</span><input id="aNote" maxlength="300"></label><p class="hint">Avans bu yerda emas — “To‘lash” orqali, kassadan chiqqan pul sifatida.</p>';
    if(kind==='pay')html+='<div class="row" style="margin-bottom:12px"><button data-k="advance">Avans</button><button class="ghost" data-k="salary">Oylik</button></div><label class="field"><span>Summa</span><input class="money" id="aAmt" inputmode="numeric" placeholder="0"></label><label class="field"><span>Qaysi hisobdan berildi</span><select id="aAcc">'+ACC.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>'}).join('')+'</select></label><label class="field"><span>Qaysi oy uchun</span><input type="month" id="aMonth" value="'+esc(MONTH)+'"></label><label class="field"><span>Berilgan sana</span><input type="date" id="aDate" value="'+today+'" max="'+today+'"></label><label class="field"><span>Izoh (ixtiyoriy)</span><input id="aNote" maxlength="200"></label>';
    html+='<button class="block" id="aSave">Saqlash</button><div id="aMsg"></div></div>';
    box.innerHTML=html;
    var type='bonus',pk='advance',st='off';
    box.querySelectorAll('[data-st]').forEach(function(b){b.addEventListener('click',function(){st=b.dataset.st;box.querySelectorAll('[data-st]').forEach(function(x){x.className=x===b?'':'ghost'})})});
    box.querySelectorAll('[data-t]').forEach(function(b){b.addEventListener('click',function(){type=b.dataset.t;box.querySelectorAll('[data-t]').forEach(function(x){x.className=x===b?'':'ghost'})})});
    box.querySelectorAll('[data-k]').forEach(function(b){b.addEventListener('click',function(){pk=b.dataset.k;box.querySelectorAll('[data-k]').forEach(function(x){x.className=x===b?'':'ghost'})})});
    if(document.getElementById('aAmt'))moneyField('aAmt');
    document.getElementById('aSave').addEventListener('click',function(){
      var body={branchId:sel.value,operationId:op,staffId:staffId,date:document.getElementById('aDate').value,note:(document.getElementById('aNote')||{}).value||''};
      if(kind==='adjust'){body.action='adjust';body.type=type;body.amount=digits(document.getElementById('aAmt').value)}
      if(kind==='pay'){body.action='pay';body.kind=pk;body.amount=digits(document.getElementById('aAmt').value);body.accountId=document.getElementById('aAcc').value;body.month=document.getElementById('aMonth').value}
      if(kind==='day'){body.action='dayStatus';body.status=st;body.payMode=document.getElementById('aPm').value}
      if(kind!=='day'&&!body.amount){document.getElementById('aMsg').innerHTML='<div class="msg bad">Summani yozing.</div>';return}
      if(kind==='pay'&&!confirm(name+' uchun '+won(body.amount)+' '+(pk==='advance'?'avans':'oylik')+' berilsinmi?'))return;
      var btn=this;btn.disabled=true;
      api(body).then(function(x){btn.disabled=false;
        if(!x.ok){document.getElementById('aMsg').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}
        STAFF=x.staff;load();setTimeout(function(){openSlip(employeeId)},700)});
    });
  });
}
function hm(iso){if(!iso)return '—';try{return new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}catch(e){return '—'}}
var DAYST={off:'Dam olish',sick:'Kasal',absent:'Kelmadi'},PAYK={advance:'Avans',salary:'Oylik'};
function recordsBox(staffId,employeeId,name){
  var box=document.getElementById('actBox');box.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'records',branchId:sel.value,staffId:staffId,month:MONTH}).then(function(r){
    if(!r.ok){box.innerHTML='<div class="msg bad">'+esc(r.error)+'</div>';return}var R=r.records;
    var btn=function(a,id,t){return '<button class="ghost" data-fx="'+a+'" data-id="'+esc(id)+'" style="min-height:34px;padding:2px 9px;font-size:13.5px">'+t+'</button>'};
    var off=function(x){return x?' <span class="tag bad">bekor</span>':''};
    box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:12px"><h2>'+esc(name)+' — '+esc(MONTH)+' yozuvlari</h2><p class="hint">Hech narsa o‘chirilmaydi: sababi bilan bekor qilinadi yoki tuzatiladi, varaqa qayta hisoblanadi.</p>'
      +'<h3 style="font-size:15px;margin:12px 0 4px">Smenalar</h3>'+(R.shifts.length?R.shifts.map(function(x){var v=x.status==='void';return '<div class="list-row"><div style="min-width:0"><b style="font-size:15px">'+esc(x.date.slice(5))+' <span style="white-space:nowrap">'+hm(x.clockIn)+'–'+(x.clockOut?hm(x.clockOut):'<span class="tag warn">ishda</span>')+'</span></b>'+off(v)+'<br><small style="color:var(--muted)">'+(x.breakMinutes?'tanaffus '+x.breakMinutes+' daq · ':'')+esc(x.source==='owner'?'rahbar kiritgan':'xodim belgilagan')+(v&&x.voidReason?' · '+esc(x.voidReason):'')+'</small></div><div class="row" style="gap:6px;flex-wrap:nowrap">'+(v?'':btn('editShift',x.id,'✏️')+btn('voidShift',x.id,'Bekor'))+'</div></div>'}).join(''):'<p class="hint">Yo‘q</p>')
      +'<h3 style="font-size:15px;margin:12px 0 4px">Dam / kasal / kelmadi</h3>'+(R.days.length?R.days.map(function(x){return '<div class="list-row"><div><b>'+esc(x.date.slice(5))+' · '+esc(DAYST[x.status]||x.status)+'</b>'+off(x.voided)+'<br><small style="color:var(--muted)">'+(x.payMode==='planned'?'haq to‘lanadi':'haq to‘lanmaydi')+(x.note?' · '+esc(x.note):'')+'</small></div>'+(x.voided?'<span></span>':btn('voidDay',x.id,'Bekor'))+'</div>'}).join(''):'<p class="hint">Yo‘q</p>')
      +'<h3 style="font-size:15px;margin:12px 0 4px">Bonus va ushlanma</h3>'+(R.adjustments.length?R.adjustments.map(function(x){return '<div class="list-row"><div><b>'+esc(x.date.slice(5))+' · '+(x.type==='bonus'?'Bonus':x.type==='advance'?'Avans (eski)':'Ushlanma')+' '+won(x.amount)+'</b>'+off(x.voided)+'<br><small style="color:var(--muted)">'+esc(x.note)+'</small></div>'+(x.voided?'<span></span>':btn('voidAdj',x.id,'Bekor'))+'</div>'}).join(''):'<p class="hint">Yo‘q</p>')
      +'<h3 style="font-size:15px;margin:12px 0 4px">To‘lovlar</h3>'+(R.payments.length?R.payments.map(function(x){return '<div class="list-row"><div><b>'+esc(x.date.slice(5))+' · '+esc(PAYK[x.kind]||x.kind)+' '+won(x.amount)+'</b>'+off(x.voided)+'<br><small style="color:var(--muted)">'+esc(x.month)+' uchun'+(x.account?' · '+esc(x.account):'')+(x.note?' · '+esc(x.note):'')+'</small></div>'+(x.voided?'<span></span>':btn('voidPay',x.id,'Bekor'))+'</div>'}).join(''):'<p class="hint">Yo‘q</p>')
      +'<div id="fxBox"></div></div>';
    box.querySelectorAll('[data-fx]').forEach(function(b){b.addEventListener('click',function(){
      var a=b.dataset.fx,id=b.dataset.id,done=function(x){if(!x.ok){alert(x.error||'Bo‘lmadi.');return}STAFF=x.staff;load();setTimeout(function(){openSlip(employeeId);setTimeout(function(){recordsBox(staffId,employeeId,name)},600)},700)};
      if(a==='editShift'){var s2=R.shifts.find(function(x){return x.id===id});var fb=document.getElementById('fxBox');
        fb.innerHTML='<div class="card" style="margin-top:12px"><h2>Smenani tuzatish · '+esc(s2.date)+'</h2><div class="row"><label class="field" style="flex:1"><span>Keldi</span><input type="time" id="eFrom" value="'+hm(s2.clockIn)+'"></label><label class="field" style="flex:1"><span>Ketdi</span><input type="time" id="eTo" value="'+(s2.clockOut?hm(s2.clockOut):'')+'"></label><label class="field" style="flex:1"><span>Tanaffus (daq)</span><input id="eBr" inputmode="numeric" value="'+s2.breakMinutes+'"></label></div><label class="field"><span>Sabab</span><input id="eWhy" maxlength="300" placeholder="Masalan: ketishni belgilashni unutgan"></label><button class="block" id="eSave">Saqlash</button></div>';
        fb.scrollIntoView({behavior:'smooth',block:'center'});
        document.getElementById('eSave').addEventListener('click',function(){var why=document.getElementById('eWhy').value.trim();if(why.length<3){alert('Sababini yozing.');return}this.disabled=true;
          api({action:'editShift',branchId:sel.value,id:id,from:document.getElementById('eFrom').value,to:document.getElementById('eTo').value,breakMinutes:digits(document.getElementById('eBr').value),reason:why}).then(done)});return}
      var why=prompt(a==='voidPay'?'To‘lov bekor qilinadi, pul hisobga qaytadi (bugungi sana bilan). Sababi:':'Bekor qilish sababi:');if(!why||why.trim().length<3)return;b.disabled=true;
      api({action:a,branchId:sel.value,id:id,reason:why.trim()}).then(function(x){b.disabled=false;done(x)})})});
  });
}
document.getElementById('manage').addEventListener('click',function(){STAFF=null;ensureStaff(drawStaff)});
function drawStaff(){
  var box=document.getElementById('staffBox');if(!STAFF){box.innerHTML='<div class="msg bad">Ochilmadi.</div>';return}
  box.innerHTML='<div style="margin-top:12px"><button id="sNew">+ Yangi xodim</button><div id="sForm"></div>'
    +STAFF.map(function(m){return '<div class="item" data-s="'+esc(m.id)+'" style="cursor:pointer"><b>'+esc(m.name)+(m.active?'':'<span class="tag warn">ishdan ketgan</span>')+(m.hasAccount?'':'<span class="tag warn">akkaunt yo‘q</span>')+'</b><span class="v">'+(m.payType==='hourly'?won(m.hourlyRate)+' / soat':won(m.monthlySalary)+' / oy')+'</span><small>'+(m.payType==='monthly'?m.workDays+' kun × '+m.dailyHours+' soat · soatiga ≈ '+won(m.effectiveHourlyRate)+' · ':'')+m.overtimeAfterHours+' soatdan keyin ×'+m.overtimeMultiplier+' · Tahrirlash ›</small></div>'}).join('')+'</div>';
  document.getElementById('sNew').addEventListener('click',function(){staffForm(null)});
  box.querySelectorAll('[data-s]').forEach(function(el){el.addEventListener('click',function(){staffForm(STAFF.find(function(m){return m.id===el.dataset.s}))})});
}
function staffForm(m){
  var box=document.getElementById('sForm'),op=uuid(),monthly=m&&m.payType==='monthly';
  box.innerHTML='<div class="card" style="background:var(--card-2);margin:12px 0"><h2>'+(m?'Tahrirlash — '+esc(m.name):'Yangi xodim')+'</h2>'
    +'<label class="field"><span>Ismi</span><input id="fN" maxlength="60" value="'+esc(m?m.name:'')+'"></label>'
    +'<div class="row" style="margin-bottom:12px"><button class="'+(monthly?'ghost':'')+'" data-pt="hourly">Soatbay</button><button class="'+(monthly?'':'ghost')+'" data-pt="monthly">Oylik</button></div>'
    +'<label class="field"><span id="fRL">'+(monthly?'Oylik maosh':'Soatlik stavka')+'</span><input class="money" id="fR" inputmode="numeric" value="'+esc(m?(monthly?m.monthlySalary:m.hourlyRate).toLocaleString('en-US'):'')+'"></label>'
    +'<div class="row"><label class="field" style="flex:1"><span>Oyda ish kuni</span><input id="fD" inputmode="numeric" value="'+esc(m?m.workDays:26)+'"></label><label class="field" style="flex:1"><span>Kunlik soat</span><input id="fH" inputmode="decimal" value="'+esc(m?m.dailyHours:8)+'"></label></div>'
    +'<div class="row"><label class="field" style="flex:1"><span>Necha soatdan keyin ortiqcha</span><input id="fO" inputmode="decimal" value="'+esc(m?m.overtimeAfterHours:8)+'"></label><label class="field" style="flex:1"><span>Ortiqcha soat koeffitsienti</span><input id="fM" inputmode="decimal" value="'+esc(m?m.overtimeMultiplier:1)+'"></label></div>'
    +(m?'<label class="row" style="gap:8px;margin-bottom:12px"><input type="checkbox" id="fA" style="width:18px;height:18px;min-height:auto"'+(m.active?' checked':'')+'> Ishlayapti (belgini olib tashlasangiz — ishdan ketgan)</label>':'')
    +'<div class="row"><button id="fS">Saqlash</button><button class="ghost" id="fC">Bekor</button></div><div id="fMsg"></div></div>';
  var pt=monthly?'monthly':'hourly';moneyField('fR');
  box.querySelectorAll('[data-pt]').forEach(function(b){b.addEventListener('click',function(){pt=b.dataset.pt;box.querySelectorAll('[data-pt]').forEach(function(x){x.className=x===b?'':'ghost'});document.getElementById('fRL').textContent=pt==='monthly'?'Oylik maosh':'Soatlik stavka'})});
  document.getElementById('fC').addEventListener('click',function(){box.innerHTML=''});
  document.getElementById('fS').addEventListener('click',function(){
    var r=digits(document.getElementById('fR').value),n=function(i){return Number(String(document.getElementById(i).value).replace(',','.'))};
    var body={action:'saveStaff',branchId:sel.value,id:m?m.id:'',operationId:op,name:document.getElementById('fN').value,payType:pt,hourlyRate:pt==='hourly'?r:0,monthlySalary:pt==='monthly'?r:0,workDays:n('fD'),dailyHours:n('fH'),overtimeAfterHours:n('fO'),overtimeMultiplier:n('fM'),active:m?document.getElementById('fA').checked:true};
    var btn=this;btn.disabled=true;
    api(body).then(function(x){btn.disabled=false;if(!x.ok){document.getElementById('fMsg').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}STAFF=x.staff;drawStaff();load()});
  });
}
sel.addEventListener('change',function(){STAFF=null;ACC=null;load()});mon.addEventListener('change',load);load();
${STAFF_DAYS_SCRIPT}${ATTENDANCE_PLACE_SCRIPT}
var JOY=${joy ? "true" : "false"};if(JOY){placeBox('');sel.addEventListener('change',function(){placeBox('')})}
`,
  });
}
