import { isAdminRequest } from "../../../lib/integration-store";
import { HaloStateConflictError, listHaloBranches, readHaloState } from "../../../lib/halo-store";
import { readSettings as readTelegramSettings, telegramCall } from "../../../lib/telegram-service";
import { isParallelMode } from "../../../lib/cutover";
import { ClosedDayError } from "../../../core/closed-days";
import {
  ClubError, clubPosOrderId, createClubKey, listClubOrders, listClubProducts, PosTerminalError, readClubSettings, recipeInfos, revokeClubKey, saveClubGroup,
  saveClubLinks, saveClubSwitches, suggestRecipe,
} from "../../../core/club";
import { cancelClubOrderSale, clubDb, writeClubSale, writeWaitingClubSales } from "../../../core/club-service";
import { shell } from "../../../core/ui-shell";

/**
 * HALO V2 — «Telegram do'kon» sahifasi: HALO CLUB (Telegram orqali sotuv sayti) bilan ulanishni boshqarish.
 * Kalit yaratish (bir marta ko'rsatiladi), uchta kalit-tugma (savdoga yozish, narx, tugagan mahsulot),
 * do'kon mahsulotlarini HALO Control taomlariga bog'lash, buyurtmalar guruhi va kelgan buyurtmalar ro'yxati.
 * Hammasi faqat rahbar uchun; kalitning o'zi bazada saqlanmaydi (faqat xeshi).
 */
declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}
type Row = Record<string, unknown>;
const PAGE_PATH = "/api/v2/club";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const clean = (value: unknown, max: number) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object") : []);

export async function GET(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  if (!await isAdminRequest(request)) {
    return new Response(null, { status: 303, headers: { Location: `/signin-with-chatgpt?return_to=${encodeURIComponent(PAGE_PATH)}` } });
  }
  const branches = (await listHaloBranches()).map((branch) => ({ id: branch.id, name: branch.name }));
  return new Response(page(branches), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Sahifa uchun to'liq ko'rinish (kalit va token hech qachon qaytmaydi). */
export async function clubView(branchId: string, origin: string) {
  const db = clubDb();
  const [settings, products, orders, { state }, telegram, parallel] = await Promise.all([
    readClubSettings(db, branchId), listClubProducts(db, branchId), listClubOrders(db, branchId, 60), readHaloState(branchId), readTelegramSettings(), isParallelMode(),
  ]);
  const recipes = recipeInfos(state as Row);
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const saved = new Set(rows((state as Row).posOrders).map((entry) => String(entry.id)));
  return {
    origin, parallel, botReady: Boolean(telegram.botToken), botName: telegram.botName || "",
    settings: {
      keyPrefix: settings.keyPrefix, keyCreatedAt: settings.keyCreatedAt, salesEnabled: settings.salesEnabled, priceSync: settings.priceSync, stockSync: settings.stockSync,
      notifyEnabled: settings.notifyEnabled, groupChatId: settings.groupChatId, groupChatName: settings.groupChatName, groupThreadId: settings.groupThreadId,
      lastSyncAt: settings.lastSyncAt, lastOrderAt: settings.lastOrderAt,
    },
    recipes: recipes.map((recipe) => ({ id: recipe.id, name: recipe.name, price: recipe.price, portions: recipe.portions, lacking: recipe.lacking })),
    products: products.map((product) => {
      const recipe = product.recipeId ? recipeById.get(product.recipeId) : undefined;
      return {
        kind: product.kind, id: product.id, name: product.name, category: product.category, price: product.price, active: product.active,
        recipeId: recipe ? product.recipeId : "", lost: Boolean(product.recipeId && !recipe), stockFollow: product.stockFollow,
        suggest: recipe ? "" : suggestRecipe(product.name, recipes),
      };
    }),
    orders: orders.map((row) => ({
      id: row.orderId, number: row.number, status: row.status, fulfillment: row.fulfillment, paymentMethod: row.paymentMethod, total: row.total,
      items: row.order ? row.order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ").slice(0, 200) : "",
      saleState: row.saleState, saleNote: row.saleNote, saleDate: row.saleDate, receivedAt: row.receivedAt, notified: Boolean(row.notifiedNew), notifyError: row.notifyError,
      missing: row.saleState === "saved" && !saved.has(clubPosOrderId(row.orderId)),
    })),
  };
}

export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "V2 faqat yangi saytda." }, 403);
  if (!await isAdminRequest(request)) return json({ error: "Faqat rahbar uchun." }, 401);
  try {
    const body = await request.json() as Row;
    const branchId = clean(body.branchId || "main", 80);
    if (!(await listHaloBranches()).some((branch) => branch.id === branchId)) throw new ClubError("Filial topilmadi.", 404);
    const db = clubDb();
    const origin = new URL(request.url).origin;
    const action = clean(body.action, 30);
    const extra: Row = {};
    if (action === "key") {
      extra.key = await createClubKey(db, branchId);
    } else if (action === "revoke") {
      await revokeClubKey(db, branchId);
    } else if (action === "switch") {
      await saveClubSwitches(db, branchId, { salesEnabled: body.salesEnabled, priceSync: body.priceSync, stockSync: body.stockSync, notifyEnabled: body.notifyEnabled });
    } else if (action === "links") {
      const { state } = await readHaloState(branchId);
      await saveClubLinks(db, branchId, body.links, state as Row);
    } else if (action === "writeWaiting") {
      extra.written = await writeWaitingClubSales(branchId);
    } else if (action === "rewrite") {
      extra.outcome = await writeClubSale(branchId, clean(body.orderId, 80), { force: true, useToday: body.useToday === true });
    } else if (action === "cancelSale") {
      await cancelClubOrderSale(branchId, clean(body.orderId, 80));
    } else if (action === "discoverGroup") {
      const token = (await readTelegramSettings()).botToken;
      if (!token) throw new ClubError("Avval HALO Telegram botini ulang (Ulanishlar → Telegram hisobot).");
      const updates = await telegramCall<Array<{ message?: { text?: string; message_thread_id?: number; chat?: { id?: number; type?: string; title?: string } } }>>(token, "getUpdates");
      const message = [...(updates || [])].reverse().find((update) => {
        const chat = update.message?.chat;
        return Boolean(chat?.id && (chat.type === "group" || chat.type === "supergroup") && /^\/buyurtma(?:@[a-z0-9_]+)?(?:\s|$)/i.test(String(update.message?.text || "").trim()));
      })?.message;
      if (!message?.chat?.id) throw new ClubError("Kerakli Telegram guruhida /buyurtma deb yozing, keyin shu tugmani yana bosing.");
      const thread = Number.isSafeInteger(message.message_thread_id) && Number(message.message_thread_id) > 0 ? Number(message.message_thread_id) : 0;
      await saveClubGroup(db, branchId, String(message.chat.id), message.chat.title || "Buyurtmalar guruhi", thread);
      try {
        await telegramCall(token, "sendMessage", { chat_id: String(message.chat.id), ...(thread ? { message_thread_id: thread } : {}), text: "✅ HALO Control · Telegram buyurtmalar guruhi ulandi." });
      } catch (error) {
        extra.warning = `Guruh saqlandi, lekin tasdiq xabari yuborilmadi. ${error instanceof Error && error.name !== "TimeoutError" ? error.message : "Telegram javobi kechikdi."}`;
      }
    } else if (action === "saveGroup") {
      const chatId = clean(body.chatId, 30);
      if (chatId && !/^-[1-9]\d{0,19}$/.test(chatId)) throw new ClubError("Guruh Chat ID raqamini tekshiring: u minus bilan boshlanadi.");
      await saveClubGroup(db, branchId, chatId, chatId ? "Buyurtmalar guruhi" : "", 0);
    } else if (action === "testGroup") {
      const settings = await readClubSettings(db, branchId);
      const token = (await readTelegramSettings()).botToken;
      if (!token) throw new ClubError("HALO Telegram boti ulanmagan.");
      if (!settings.groupChatId) throw new ClubError("Avval guruhni ulang.");
      try {
        await telegramCall(token, "sendMessage", {
          chat_id: settings.groupChatId, ...(settings.groupThreadId > 0 ? { message_thread_id: settings.groupThreadId } : {}),
          text: "✅ HALO Control · Telegram do‘kon sinov xabari. Yangi buyurtmalar shu yerga keladi.",
        });
      } catch (error) {
        throw new ClubError(`Yuborilmadi: ${error instanceof Error && error.name !== "TimeoutError" ? error.message : "Telegram javobi kechikdi."}`);
      }
    } else if (action && action !== "load") {
      throw new ClubError("Amal noto‘g‘ri.");
    }
    return json({ ok: true, ...extra, ...(await clubView(branchId, origin)) });
  } catch (error) {
    if (error instanceof ClubError || error instanceof PosTerminalError) return json({ error: error.message }, (error as { status?: number }).status || 400);
    if (error instanceof ClosedDayError) return json({ error: error.message }, 409);
    if (error instanceof HaloStateConflictError) return json({ error: "Ma’lumot boshqa joyda yangilandi. Qayta urinib ko‘ring." }, 409);
    return json({ error: error instanceof Error && /filial|oy/i.test(error.message) ? error.message : "Xatolik yuz berdi." }, 500);
  }
}

function page(branches: Array<{ id: string; name: string }>): string {
  const boot = JSON.stringify(branches).replace(/</g, "\\u003c");
  return shell({
    title: "Telegram do‘kon", active: "bosh", heading: "Telegram do‘kon",
    subtitle: "HALO CLUB: buyurtma → savdo, narx va tugagan mahsulot, guruhga xabar",
    headerRight: '<div class="row"><select id="branch"></select></div>',
    body: `<div id="warn"></div>
<section class="card"><h2>1. Ulanish</h2><div id="conn"></div></section>
<section class="card"><h2>2. Nima ishlasin</h2><div id="sw"></div></section>
<section class="card"><h2>3. Buyurtmalar guruhi</h2><div id="grp"></div></section>
<section class="card"><h2>4. Mahsulotlarni bog‘lash</h2><div id="prod"></div></section>
<section class="card"><h2>Kelgan buyurtmalar</h2><div id="ord"></div></section>
<style>
.sw{display:grid;grid-template-columns:1fr auto;gap:4px 14px;align-items:center;padding:14px 0;border-top:1px solid var(--line)}
.sw:first-child{border-top:0}.sw small{color:var(--muted);font-size:13.5px;grid-column:1}
.sw button{min-width:104px}
.lk{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.3fr);gap:6px 12px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}
.lk:first-of-type{border-top:0}.lk small{color:var(--muted);font-size:13px}
.lk select{width:100%}
@media (max-width:640px){.lk{grid-template-columns:1fr}}
.keybox{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;width:100%;min-height:70px;word-break:break-all}
.ordr{padding:12px 0;border-top:1px solid var(--line)}.ordr:first-child{border-top:0}
.ordr small{color:var(--muted);font-size:13px;display:block;margin-top:2px}
</style>`,
    script: `
var BRANCHES=${boot},D=null,KEY='',FLASH='';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function won(n){n=Number(n||0);return (n<0?'−':'')+Math.abs(n).toLocaleString('en-US')+' ₩'}
function kst(iso){if(!iso)return '';var d=new Date(iso);if(isNaN(d))return String(iso);return d.toLocaleString('en-GB',{timeZone:'Asia/Seoul',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(',','')}
function byId(i){return document.getElementById(i)}
var sel=byId('branch');
sel.innerHTML=BRANCHES.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>'}).join('');haloBranch(sel);
function api(b){b.branchId=sel.value;return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json()}).catch(function(){return {ok:false,error:'Internet aloqasini tekshiring.'}})}
function act(b,box,okText){var m=byId(box);if(m)m.innerHTML='<p class="hint">Bajarilmoqda…</p>';return api(b).then(function(x){if(!x.ok){if(m)m.innerHTML='<div class="msg bad">'+esc(x.error||'Bajarilmadi.')+'</div>';return null}
  if(x.key)KEY=x.key;D=x;FLASH=okText?(typeof okText==='function'?okText(x):okText):'';draw();var m2=byId(box);if(m2&&(FLASH||x.warning))m2.innerHTML=(FLASH?'<div class="msg ok">'+esc(FLASH)+'</div>':'')+(x.warning?'<div class="msg warn">'+esc(x.warning)+'</div>':'');return x})}
function load(){['conn','sw','grp','prod','ord'].forEach(function(i){byId(i).innerHTML=haloLoading(2)});KEY='';api({action:'load'}).then(function(x){if(!x.ok){byId('conn').innerHTML='<div class="msg bad">'+esc(x.error)+'</div>';return}D=x;draw()})}
function draw(){drawWarn();drawConn();drawSwitches();drawGroup();drawProducts();drawOrders()}
function drawWarn(){
  byId('warn').innerHTML=D.parallel?'<div class="msg warn" style="margin-bottom:16px"><b>Sayt hali sinov (parallel) rejimida.</b> Eski saytdan ma’lumot qayta ko‘chirilsa, bu yerga yozilgan Telegram savdolari o‘chadi — pastdagi «Qayta yozish» bilan tiklanadi. Eski saytga Telegram savdolarini qo‘lda kiritayotgan bo‘lsangiz, ular ko‘chirilganda bu yerdagisi bilan ikki marta sanaladi.</div>':'';
}
function drawConn(){
  var s=D.settings,h='';
  if(KEY){
    h+='<div class="msg ok">Kalit yaratildi. U faqat <b>hozir</b> ko‘rinadi — nusxalab, Hatchable’ga o‘zingiz kiriting.</div>'
      +'<label class="field"><span>HALO_CONTROL_API_KEY</span><textarea class="keybox" id="kTxt" readonly>'+esc(KEY)+'</textarea></label>'
      +'<div class="row" style="margin-bottom:12px"><button id="kCopy">Kalitni nusxalash</button></div>';
  }
  h+='<label class="field"><span>HALO_CONTROL_URL (sayt manzili)</span><input id="kUrl" readonly value="'+esc(D.origin)+'"></label>';
  if(s.keyPrefix){
    h+='<p class="hint">Kalit: <b>'+esc(s.keyPrefix)+'</b> · yaratilgan '+esc(kst(s.keyCreatedAt))+'</p>'
      +'<p class="hint">'+(s.lastSyncAt?'✓ Do‘kon oxirgi marta <b>'+esc(kst(s.lastSyncAt))+'</b> da ulandi (menyu sinxroni).':'Do‘kon hali ulanmagan — kalit va manzil Hatchable’ga kiritilgach, bir necha daqiqada shu yerda vaqt paydo bo‘ladi.')
      +(s.lastOrderAt?' Oxirgi buyurtma hodisasi: <b>'+esc(kst(s.lastOrderAt))+'</b>.':'')+'</p>'
      +'<div class="row"><button class="ghost" id="kNew">Yangi kalit (eskisi o‘chadi)</button><button class="ghost" id="kOff">Uzish</button></div>';
  }else{
    h+='<ol class="hint" style="padding-left:20px;line-height:1.7"><li>«Kalit yaratish»ni bosing.</li><li>Hatchable → loyiha → <b>Setup</b> sahifasida <b>HALO_CONTROL_URL</b> va <b>HALO_CONTROL_API_KEY</b> maydonlariga shu ikki qiymatni kiriting.</li><li>Bir necha daqiqadan keyin bu sahifani yangilang — «do‘kon ulandi» yozuvi chiqadi.</li></ol>'
      +'<button id="kNew">Kalit yaratish</button>';
  }
  h+='<div id="kMsg"></div>';
  byId('conn').innerHTML=h;
  var n=byId('kNew');if(n)n.addEventListener('click',function(){if(s.keyPrefix&&!confirm('Yangi kalit yaratilsa, eskisi shu zahoti ishlamay qoladi va do‘konga yangisini kiritish kerak bo‘ladi. Davom etilsinmi?'))return;act({action:'key'},'kMsg')});
  var o=byId('kOff');if(o)o.addEventListener('click',function(){if(!confirm('Do‘kon HALO Control’ga ulana olmay qoladi (buyurtmalar do‘konning o‘zida navbatda turadi). Uzilsinmi?'))return;KEY='';act({action:'revoke'},'kMsg','Uzildi.')});
  var c=byId('kCopy');if(c)c.addEventListener('click',function(){var t=byId('kTxt');t.select();var done=function(){c.textContent='✓ Nusxalandi'};if(navigator.clipboard)navigator.clipboard.writeText(KEY).then(done,function(){document.execCommand('copy');done()});else{document.execCommand('copy');done()}});
}
function drawSwitches(){
  var s=D.settings,wait=D.orders.filter(function(o){return o.status==='completed'&&o.saleState==='waiting'}).length;
  var unlinked=D.products.filter(function(p){return p.kind==='product'&&p.active&&!p.recipeId}).length;
  var list=[
    ['salesEnabled','Buyurtma → savdo','Topshirilgan buyurtma savdoga yoziladi, ombor retsept bo‘yicha kamayadi. Naqd → naqd kassa, bank o‘tkazmasi → hisob-raqam. Karta yozilmaydi (OKPOS hisobotidan keladi). Yetkazish haqi daromadga qo‘shilmaydi — «Kuryer puli» bo‘lib turadi.'+(s.salesEnabled?'':' <b>Yoqilgach, Telegram buyurtmalarini qo‘lda kiritmang — ikki marta sanaladi.</b>')],
    ['priceSync','Narx HALO Control’dan','Bog‘langan mahsulotning do‘kondagi narxi HALO Control’dagi sotuv narxiga tenglashtiriladi. Yoqishdan oldin pastdagi jadvalda ikki narxni solishtiring.'],
    ['stockSync','Tugagan mahsulot yopilsin','Omborda bir portsiyaga yetmaydigan taom do‘konda «Tugadi» bo‘lib ko‘rinadi va buyurtma qilib bo‘lmaydi. Ombor qoldig‘i noto‘g‘ri bo‘lsa, taom bekorga yopilishi mumkin — pastdagi jadvalda holatni ko‘ring.'],
    ['notifyEnabled','Yangi buyurtma guruhga','Yangi va bekor qilingan buyurtma haqida Telegram guruhga xabar boradi (mijozning ismi, telefoni va manzilisiz).']
  ];
  byId('sw').innerHTML=list.map(function(x){var on=!!s[x[0]];return '<div class="sw"><b>'+x[1]+(on?' <span class="tag ok">yoqilgan</span>':' <span class="tag warn">o‘chirilgan</span>')+'</b><button class="'+(on?'ghost':'')+'" data-sw="'+x[0]+'" data-on="'+(on?'1':'0')+'">'+(on?'O‘chirish':'Yoqish')+'</button><small>'+x[2]+'</small></div>'}).join('')
    +(unlinked&&s.salesEnabled?'<div class="msg warn">'+unlinked+' ta mahsulot hali bog‘lanmagan — ular qatnashgan buyurtma «kutmoqda» bo‘lib turadi.</div>':'')
    +(wait?'<div class="row" style="margin-top:8px"><button id="wAll">Kutayotgan '+wait+' ta buyurtmani yozish</button></div>':'')+'<div id="swMsg"></div>';
  document.querySelectorAll('[data-sw]').forEach(function(b){b.addEventListener('click',function(){var on=b.dataset.on!=='1';
    if(b.dataset.sw==='salesEnabled'&&on&&!confirm('Yoqilgach, topshirilgan Telegram buyurtmalari (naqd va bank o‘tkazmasi) savdoga o‘zi yoziladi. Ularni HALO HISOB oynasida qo‘lda kiritish to‘xtatilishi kerak. Yoqilsinmi?'))return;
    if(b.dataset.sw==='priceSync'&&on&&!confirm('Bog‘langan mahsulotlarning do‘kondagi narxi HALO Control narxiga o‘zgaradi. Yoqilsinmi?'))return;
    var body={action:'switch'};body[b.dataset.sw]=on;act(body,'swMsg','Saqlandi.')})});
  var w=byId('wAll');if(w)w.addEventListener('click',function(){if(!confirm('Kutayotgan buyurtmalar savdoga yoziladi (naqd va bank o‘tkazmasi; ombor ham kamayadi). Agar ularni allaqachon qo‘lda kiritgan bo‘lsangiz — yozmang, aks holda ikki marta sanaladi. Davom etilsinmi?'))return;act({action:'writeWaiting'},'swMsg',function(x){var r=x.written||{};return 'Yozildi: '+(r.saved||0)+' ta'+(r.skipped?' · o‘tkazib yuborildi: '+r.skipped:'')+(r.waiting?' · hali kutmoqda: '+r.waiting:'')})});
}
function drawGroup(){
  var s=D.settings,h='';
  if(!D.botReady)h='<div class="msg warn">Avval HALO Telegram botini ulang: <a href="/api/v2/ulanishlar">Ulanishlar → Telegram hisobot ›</a></div>';
  else if(s.groupChatId){
    h='<p>✓ <b>'+esc(s.groupChatName||'Guruh')+'</b>'+(s.groupThreadId?' · mavzu #'+s.groupThreadId:'')+' <small style="color:var(--muted)">('+esc(s.groupChatId)+')</small></p>'
      +'<div class="row"><button id="gTest">Sinov xabari</button><button class="ghost" id="gFind">Almashtirish</button><button class="ghost" id="gOff">Uzish</button></div>';
  }else{
    h='<ol class="hint" style="padding-left:20px;line-height:1.7"><li><b>@'+esc(D.botName||'HALO bot')+'</b> botini buyurtmalar guruhiga qo‘shing.</li><li>Guruhda <b>/buyurtma</b> deb yozing.</li><li>«Guruhni topish»ni bosing.</li></ol><button id="gFind">Guruhni topish</button>';
  }
  h+='<div id="gMsg"></div>';
  byId('grp').innerHTML=h;
  var f=byId('gFind');if(f)f.addEventListener('click',function(){act({action:'discoverGroup'},'gMsg','Guruh ulandi.')});
  var t=byId('gTest');if(t)t.addEventListener('click',function(){act({action:'testGroup'},'gMsg','Sinov xabari yuborildi — guruhni tekshiring.')});
  var o=byId('gOff');if(o)o.addEventListener('click',function(){if(confirm('Guruh uzilsinmi? Buyurtmalar haqida xabar bormaydi.'))act({action:'saveGroup',chatId:''},'gMsg','Uzildi.')});
}
function stockText(r){if(!r)return '';if(r.portions===null)return 'omborga bog‘lanmagan';if(r.portions<1)return 'TUGAGAN'+(r.lacking?' ('+r.lacking+')':'');return r.portions+' portsiyaga yetadi'}
function drawProducts(){
  var box=byId('prod');
  if(!D.products.length){box.innerHTML='<p class="hint">Do‘kon mahsulotlari hali kelmagan. Do‘kon ulangach (1-qadam) ro‘yxat shu yerda paydo bo‘ladi.</p>';return}
  var rec={};D.recipes.forEach(function(r){rec[r.id]=r});
  var opts=function(cur){return '<option value="">— bog‘lanmagan —</option>'+D.recipes.map(function(r){return '<option value="'+esc(r.id)+'"'+(r.id===cur?' selected':'')+'>'+esc(r.name)+(r.price?' · '+won(r.price):'')+'</option>'}).join('')};
  var sug=D.products.filter(function(p){return !p.recipeId&&p.suggest}).length;
  var row=function(p){var r=rec[p.recipeId],diff=r&&r.price&&r.price!==p.price;
    return '<div class="lk" data-k="'+p.kind+'" data-id="'+esc(p.id)+'"><div><b>'+esc(p.name)+'</b>'+(p.active?'':' <span class="tag warn">do‘konda o‘chirilgan</span>')+(p.lost?' <span class="tag bad">taom o‘chirilgan</span>':'')
      +'<small style="display:block">'+(p.kind==='addon'?'Qo‘shimcha':esc(p.category||'Taom'))+' · do‘konda '+won(p.price)+'</small></div>'
      +'<div><select data-rec>'+opts(p.recipeId)+'</select><small style="display:block" data-info>'+(r?'HALO narxi '+(r.price?won(r.price):'yo‘q')+(diff?' <b style="color:var(--warn)">(farq '+won(r.price-p.price)+')</b>':'')+(p.kind==='product'?' · '+esc(stockText(r)):''):(p.suggest&&rec[p.suggest]?'Taklif: '+esc(rec[p.suggest].name):p.kind==='addon'?'Bog‘lanmasa — narxi taomga qo‘shiladi, ombor kamaymaydi':'Bog‘lanmaguncha savdoga yozilmaydi'))+'</small></div></div>'};
  var prods=D.products.filter(function(p){return p.kind==='product'}),adds=D.products.filter(function(p){return p.kind==='addon'});
  box.innerHTML='<p class="hint">Chapda — do‘kondagi mahsulot, o‘ngda — HALO Control’dagi taom (retsept). Bog‘langan taomning ombori va narxi shu yerdan olinadi.</p>'
    +(sug?'<div class="row" style="margin-bottom:6px"><button class="ghost" id="pSug">Nomi mos '+sug+' tasini tanlash</button></div>':'')
    +prods.map(row).join('')+(adds.length?'<h3 style="margin:18px 0 0">Qo‘shimchalar</h3>'+adds.map(row).join(''):'')
    +'<div class="row" style="margin-top:14px"><button id="pSave">Bog‘lashni saqlash</button></div><div id="pMsg"></div>';
  var s=byId('pSug');if(s)s.addEventListener('click',function(){D.products.forEach(function(p){if(p.recipeId||!p.suggest)return;var el=[].filter.call(box.querySelectorAll('.lk'),function(e){return e.dataset.k===p.kind&&e.dataset.id===p.id})[0];if(el)el.querySelector('[data-rec]').value=p.suggest});byId('pMsg').innerHTML='<div class="msg warn">Tanlandi. Tekshirib, «Bog‘lashni saqlash»ni bosing.</div>'});
  byId('pSave').addEventListener('click',function(){var links=[].map.call(box.querySelectorAll('.lk'),function(e){return {kind:e.dataset.k,id:e.dataset.id,recipeId:e.querySelector('[data-rec]').value}});act({action:'links',links:links},'pMsg','Bog‘lash saqlandi.')});
}
var ST={new:'yangi',accepted:'qabul qilindi',preparing:'tayyorlanmoqda',ready:'tayyor',completed:'topshirildi',cancelled:'bekor qilindi'};
var PAY={CASH:'naqd',CARD:'karta',BANK_TRANSFER:'bank o‘tkazmasi',CASHBACK:'cashback'};
var FUL={PICKUP:'olib ketish',DELIVERY:'yetkazib berish',DINE_IN:'zalda'};
function drawOrders(){
  var box=byId('ord');
  if(!D.orders.length){box.innerHTML='<p class="hint">Hali buyurtma kelmagan.</p>';return}
  box.innerHTML=D.orders.map(function(o){
    var tag='',btn='';
    if(o.status==='completed'){
      if(o.missing){tag='<span class="tag bad">savdo yozuvi yo‘q</span>';btn='<button class="ghost" data-rw="'+esc(o.id)+'">Qayta yozish</button>'}
      else if(o.saleState==='saved'){tag='<span class="tag ok">savdoga yozildi</span>';btn='<button class="ghost" data-cx="'+esc(o.id)+'">Savdoni bekor qilish</button>'}
      else if(o.saleState==='skipped')tag='<span class="tag warn">yozilmaydi</span>';
      else if(o.saleState==='cancelled')tag='<span class="tag warn">rahbar bekor qilgan</span>';
      else{tag='<span class="tag warn">kutmoqda</span>';btn='<button class="ghost" data-rw="'+esc(o.id)+'">Yozish</button>'+(/yopilgan/.test(o.saleNote||'')?'<button class="ghost" data-rw="'+esc(o.id)+'" data-today="1">Bugungi sana bilan yozish</button>':'')}
    }
    return '<div class="ordr"><b>#'+esc(o.number)+'</b> · '+esc(ST[o.status]||o.status)+' · '+won(o.total)+' '+tag
      +'<small>'+esc(kst(o.receivedAt))+' · '+esc(FUL[o.fulfillment]||o.fulfillment)+' · '+esc(PAY[o.paymentMethod]||o.paymentMethod)+(o.notified?' · 📨 guruhda':'')+(o.notifyError?' · guruhga bormadi: '+esc(o.notifyError):'')+'</small>'
      +(o.items?'<small>'+esc(o.items)+'</small>':'')+(o.saleNote?'<small>'+esc(o.saleNote)+(o.saleDate?' · '+esc(o.saleDate):'')+'</small>':'')
      +(btn?'<div class="row" style="margin-top:8px">'+btn+'</div>':'')+'</div>'}).join('')+'<div id="oMsg"></div>';
  box.querySelectorAll('[data-rw]').forEach(function(b){b.addEventListener('click',function(){act({action:'rewrite',orderId:b.dataset.rw,useToday:b.dataset.today==='1'},'oMsg',function(x){var o=x.outcome||{};return o.state==='saved'?'Savdoga yozildi.':(o.note||'Yozilmadi.')})})});
  box.querySelectorAll('[data-cx]').forEach(function(b){b.addEventListener('click',function(){if(confirm('Bu buyurtmaning savdosi bekor qilinadi: ombor qaytadi, kuryer puli kirimi ham olib tashlanadi. Davom etilsinmi?'))act({action:'cancelSale',orderId:b.dataset.cx},'oMsg','Savdo bekor qilindi.')})});
}
sel.addEventListener('change',load);load();
`,
  });
}
