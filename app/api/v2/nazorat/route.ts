import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, mutateHaloState, readHaloState } from "../../../lib/halo-store";
import { normalizeOperationChecklistDays, operationChecklistView } from "../../../lib/operations";
import {
  KITCHEN_RULE_REMINDER_OPTIONS, MAX_KITCHEN_RULE_LENGTH, MAX_KITCHEN_RULES, normalizeKitchenRuleReminderHours, normalizeKitchenRules,
  validKitchenRuleReminderHours, validKitchenRules,
} from "../../../lib/kitchen-rules";
import { v2ClosedThrough } from "../../../core/closed-days";
import { shell } from "../../../core/ui-shell";

/**
 * HALO V2 — kunlik nazorat: ochilish/yopilish tekshiruv ro'yxati (xodim smenada belgilaydi, rahbar ko'radi)
 * va oshxona qoidalari (xodim ishni boshlaganda va smena davomida Telegramga eslatiladi).
 * Belgilash /api/operations orqali (eski tizim qoidasi). "Kassa yopildi" bandi V2 kassa yopilishidan olinadi.
 */
declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
type Row = Record<string, unknown>;
const PAGE_PATH = "/api/v2/nazorat";
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  return new Response(page(branches), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** V2 da kassa yopilgan kun uchun "Kassa yopildi" bandi bajarilgan deb ko'rsatiladi. */
function checklist(state: Row, date: string, closedThrough: string) {
  const view = operationChecklistView(state.operationChecklistDays, date, state.dailyCloses);
  const closed = Boolean(closedThrough) && date <= closedThrough;
  const phases = view.phases.map((phase) => {
    const items = phase.items.map((item) => (item.id === "closing-cash" && !item.completed && closed
      ? { ...item, completed: true, completion: { itemId: item.id, completedAt: "", completedBy: "Kassa yopilgan (V2)", completedByWorkerId: "" } }
      : item));
    return { phase: phase.phase, title: phase.title, subtitle: phase.subtitle, total: items.length, completed: items.filter((item) => item.completed).length,
      items: items.map((item) => ({ id: item.id, title: item.title, detail: item.detail, completed: item.completed, by: String(item.completion?.completedBy || ""), at: String(item.completion?.completedAt || ""), derived: item.id === "closing-cash" })) };
  });
  return { date, phases, completed: phases.reduce((sum, phase) => sum + phase.completed, 0), total: phases.reduce((sum, phase) => sum + phase.total, 0) };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Row;
    const branchId = String(body.branchId || "main");
    const today = seoulToday();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : today;
    if (body.action === "saveRules") {
      const rules = normalizeKitchenRules((Array.isArray(body.rules) ? body.rules : []).map((rule) => String(rule ?? "").trim()).filter(Boolean));
      const hours = Number(body.hours);
      if (!validKitchenRules(rules)) return json({ error: `Qoidalar 1–${MAX_KITCHEN_RULES} ta, har biri ${MAX_KITCHEN_RULE_LENGTH} belgigacha bo‘lsin.` }, 400);
      if (!validKitchenRuleReminderHours(hours)) return json({ error: "Eslatma oralig‘ini tanlang." }, 400);
      await mutateHaloState((state) => ({ state: { ...state, kitchenRules: rules, kitchenRuleReminderHours: hours }, result: null }), 5, branchId, "Rahbar", "Oshxona qoidalari yangilandi", "Kunlik nazorat");
    }
    const { state } = await readHaloState(branchId);
    const closedThrough = await v2ClosedThrough(branchId);
    const days = normalizeOperationChecklistDays((state as Row).operationChecklistDays);
    const history = [...new Set([date, ...days.map((day) => day.date)])].filter((day) => day <= today).sort().reverse().slice(0, 14)
      .map((day) => { const view = checklist(state as Row, day, closedThrough); return { date: day, completed: view.completed, total: view.total }; });
    return json({
      ok: true, today, checklist: checklist(state as Row, date, closedThrough), history,
      rules: normalizeKitchenRules((state as Row).kitchenRules), hours: normalizeKitchenRuleReminderHours((state as Row).kitchenRuleReminderHours),
      hourOptions: KITCHEN_RULE_REMINDER_OPTIONS, maxRules: MAX_KITCHEN_RULES,
    });
  } catch (error) {
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Kunlik nazorat", active: "nazorat", heading: "Kunlik nazorat",
    subtitle: "Ochilish va yopilish tekshiruvi, oshxona qoidalari",
    headerRight: '<div class="row"><input type="date" id="date"><select id="branch"></select></div>',
    body: `<section class="card"><h2 id="sum">Tekshiruv</h2><p class="hint">Xodimlar ilovasida smena davomida belgilaydi. Siz ham shu yerda belgilashingiz yoki belgini olib tashlashingiz mumkin.</p><div id="phases"></div></section>
<section class="card"><h2>Oxirgi kunlar</h2><div id="hist"></div></section>
<section class="card fold"><details><summary><span><b>🍳 Oshxona qoidalari</b><small>Xodimlarga eslatiladigan qoidalar — sozlash</small></span></summary><p class="hint">Xodim ishni boshlaganda va smena davomida belgilangan oraliqda Telegram guruhiga eslatiladi.</p><div id="rules"></div></details></section>`,
    script: `
var BRANCHES=${boot},D=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function api(b){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
var sel=document.getElementById('branch'),dt=document.getElementById('date');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function hm(iso){if(!iso)return '';try{return new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}}
function load(extra){if(!extra)document.getElementById('phases').innerHTML=haloLoading(4);
  var b={branchId:sel.value,date:dt.value||undefined};for(var k in (extra||{}))b[k]=extra[k];
  return api(b).then(function(x){if(!x.ok){if(!extra)document.getElementById('phases').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return x}D=x;if(!dt.value)dt.value=x.today;dt.max=x.today;draw();return x})}
function draw(){var c=D.checklist;
  document.getElementById('sum').textContent='Tekshiruv · '+c.date+' · '+c.completed+'/'+c.total;
  document.getElementById('phases').innerHTML=c.phases.map(function(p){return '<h3 style="font-size:15px;margin:14px 0 4px">'+esc(p.title)+' · '+p.completed+'/'+p.total+'</h3><p class="hint" style="margin:0 0 4px">'+esc(p.subtitle)+'</p>'
    +p.items.map(function(i){return '<label class="list-row" style="cursor:'+(i.derived?'default':'pointer')+'"><div style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" data-i="'+esc(i.id)+'" style="width:22px;height:22px;min-height:auto;margin-top:2px"'+(i.completed?' checked':'')+(i.derived?' disabled':'')+'><div><b>'+esc(i.title)+'</b><br><small style="color:var(--muted)">'+esc(i.detail)+'</small>'+(i.completed?'<br><small style="color:var(--ok)">✓ '+esc(i.by)+(i.at?' · '+hm(i.at):'')+'</small>':'')+(i.derived&&!i.completed?'<br><small style="color:var(--muted)">Kassa bo‘limida kun yopilganda o‘zi belgilanadi</small>':'')+'</div></div><span></span></label>'}).join('')}).join('');
  document.querySelectorAll('[data-i]').forEach(function(cb){cb.addEventListener('change',function(){cb.disabled=true;
    fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({branchId:sel.value,date:c.date,itemId:cb.dataset.i,completed:cb.checked})}).then(function(r){return r.json()}).then(function(x){if(x.error){alert(x.error)}load()}).catch(function(){alert('Internet aloqasini tekshiring.');load()})})});
  document.getElementById('hist').innerHTML=D.history.map(function(h){var full=h.completed===h.total;return '<div class="day" style="cursor:pointer" data-d="'+esc(h.date)+'"><span>'+esc(h.date)+'</span><span class="badge '+(full?'ok':h.completed?'warn':'bad')+'">'+h.completed+'/'+h.total+'</span></div>'}).join('');
  document.querySelectorAll('[data-d]').forEach(function(el){el.addEventListener('click',function(){dt.value=el.dataset.d;load();window.scrollTo({top:0,behavior:'smooth'})})});
  drawRules();
}
function drawRules(){var box=document.getElementById('rules');
  box.innerHTML='<div id="rl">'+D.rules.map(function(r,i){return '<div class="row" style="margin-bottom:8px;flex-wrap:nowrap"><input data-r="'+i+'" maxlength="240" value="'+esc(r)+'" style="flex:1;min-width:0"><button class="ghost" data-x="'+i+'" style="min-height:44px;padding:4px 12px">✕</button></div>'}).join('')+'</div>'
    +(D.rules.length<D.maxRules?'<button class="ghost" id="rAdd" style="margin-bottom:12px">+ Qoida qo‘shish</button>':'')
    +'<label class="field"><span>Smena davomida eslatma</span><select id="rH">'+D.hourOptions.map(function(h){return '<option value="'+h+'"'+(h===D.hours?' selected':'')+'>har '+h+' soatda</option>'}).join('')+'</select></label><button class="block" id="rS">Qoidalarni saqlash</button><div id="rMsg"></div>';
  var collect=function(){return [].map.call(box.querySelectorAll('[data-r]'),function(i){return i.value})};
  box.querySelectorAll('[data-x]').forEach(function(b){b.addEventListener('click',function(){var r=collect();r.splice(Number(b.dataset.x),1);D.rules=r;drawRules()})});
  var add=document.getElementById('rAdd');if(add)add.addEventListener('click',function(){D.rules=collect().concat(['']);drawRules();var l=box.querySelectorAll('[data-r]');l[l.length-1].focus()});
  document.getElementById('rS').addEventListener('click',function(){var btn=this;btn.disabled=true;
    load({action:'saveRules',rules:collect(),hours:Number(document.getElementById('rH').value)}).then(function(x){btn.disabled=false;if(x&&x.ok)document.getElementById('rMsg').innerHTML='<div class="msg ok">✓ Saqlandi</div>';else if(x)document.getElementById('rMsg').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>'})});
}
sel.addEventListener('change',function(){load()});dt.addEventListener('change',function(){load()});load();
`,
  });
}
