import { shell } from "../../../core/ui-shell";
import { authenticateWorkerRequest } from "../../../lib/worker-auth";
import { readHaloState } from "../../../lib/halo-store";
import { expenseOnlyOnDate } from "../../../lib/vegetable-expenses";
import { costRuleCoversCategory } from "../../../lib/daily-report";
import { seoulBusinessDate } from "../../../lib/business-time";
import { categoryIdOf, categoryList } from "../../../core/categories";
import { mezanaBorrowedQuantityBalance, normalizeMezanaDebtEntries, normalizeMezanaSettings } from "../../../lib/mezana-debts";
import { normalizeMezanaCatalog } from "../../../lib/mezana-catalog";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
  var __HALO_CONTROL_BUCKET__: R2Bucket | undefined;
}

/**
 * HALO V2 — xodim dasturi (telefon). Eski xodim dasturidagi hamma narsa, qulayroq:
 *  - kirish (filial, login, PIN), 4 til;
 *  - davomat: ISHNI BOSHLADIM / TUGATDIM, shu oy kun/soat/summa va har kun;
 *  - rahbardan vazifalar: boshladim / bajarildi;
 *  - amallar: HALO HISOB (savdo, delivery, oshxona, chiqit), POS hisobot (Excel), mahsulot kirimi,
 *    xarajat, MEZANA (olib turildi / qaytarildi / qarzga olindi — Telegram guruhga boradi), minus tavar, kassani sanash.
 * Yozuvlar mavjud tekshirilgan API'lar orqali: /api/worker-auth, /api/attendance, /api/worker-tasks,
 * /api/v2/pos-excel, /api/worker-deliveries, /api/worker-expenses, /api/worker-mezana, /api/v2/pos, /api/v2/kassa.
 */
const WORKER_EXPENSE_CATEGORIES = ["Mahsulot xaridi", "Do‘kon / omborsiz mahsulot", "Elektr / gaz / suv", "Wi-Fi / telefon", "Ta’mirlash", "Reklama", "Ijara", "POS abonent to‘lovi", "Sug‘urta", "Soliq", "Boshqa"];
type Row = Record<string, unknown>;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** MEZANA oynasi: rahbar belgilagan mahsulotlar, hozir olib turilgan soni, xodimning o'z oxirgi yozuvlari. */
export function mezanaForWorker(state: Row, workerId: string) {
  const entries = normalizeMezanaDebtEntries(state.mezanaEntries);
  const settings = normalizeMezanaSettings(state.mezanaSettings);
  return {
    catalog: normalizeMezanaCatalog(state.mezanaCatalog).filter((item) => item.active)
      .map((item) => ({
        id: item.id, name: item.name, mode: item.mode, price: item.price,
        borrowed: item.mode === "borrowed" ? Math.max(0, mezanaBorrowedQuantityBalance(entries, item.name)) : 0,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    // Rasm faqat rasm ombori (R2) ulangan bo'lsa qabul qilinadi.
    photos: Boolean(globalThis.__HALO_CONTROL_BUCKET__),
    group: { borrowed: Boolean(settings.telegramChatId), purchased: Boolean(settings.purchasedTelegramChatId) },
    mine: entries.filter((entry) => entry.createdByWorkerId === workerId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8)
      .map((entry) => ({ id: entry.id, action: entry.action, name: entry.productName, quantity: entry.quantity || entry.itemCount || 0, amount: entry.amount, date: entry.date })),
  };
}

/** Xodim ilovasi uchun ma'lumot: mahsulotlar (birliklari bilan), yetkazuvchilar, hisoblar, xarajat turlari. */
export async function POST(request: Request) {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return json({ error: "Faqat yangi saytda." }, 403);
  const session = await authenticateWorkerRequest(request);
  if (!session) return json({ error: "PIN bilan kiring.", login: true }, 401);
  const current = await readHaloState(session.branchId);
  const state = current.state as Row;
  const today = seoulBusinessDate(new Date());
  const inventory = (Array.isArray(state.inventory) ? state.inventory as Row[] : [])
    .filter((item) => typeof item.id === "string" && item.id && item.catalogArchived !== true)
    .map((item) => ({
      id: String(item.id), name: String(item.name || item.id), unit: String(item.unit || "dona"),
      packageName: String(item.packageName || ""), unitsPerPackage: Number(item.unitsPerPackage) || 0,
      vegetable: expenseOnlyOnDate(item as never, today), categoryId: categoryIdOf(state, "inventory", item),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const accounts = (Array.isArray(state.accounts) ? state.accounts as Row[] : [])
    .filter((account) => ["cash", "bank", "card"].includes(String(account.type)))
    .map((account) => ({ id: String(account.id), name: String(account.name || account.id), type: String(account.type) }));
  const suppliers = (Array.isArray(state.suppliers) ? state.suppliers as Row[] : [])
    .filter((supplier) => supplier.id && supplier.name && !/mezana/i.test(String(supplier.name)))
    .map((supplier) => ({ id: String(supplier.id), name: String(supplier.name) }));
  return json({
    ok: true, today, updatedAt: current.updatedAt,
    canReceive: Boolean(session.canSupplierDelivery), canExpense: Boolean(session.canWarehouseReceipt),
    mezana: session.canWarehouseReceipt ? mezanaForWorker(state, session.userId) : null,
    inventory, accounts, suppliers,
    categories: categoryList(state, "inventory").map((category) => ({ id: category.id, name: category.name })),
    expenseCategories: WORKER_EXPENSE_CATEGORIES.filter((category) => !costRuleCoversCategory(category, state.costRules as never)),
  });
}

export async function GET() {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  return new Response(shell({
    title: "Xodim", active: null, app: "xodim", back: false,
    body: `<div id="app" style="display:grid;gap:16px"><section class="card"><div class="skeleton"></div></section></div>
<style>
.huge{width:100%;min-height:110px;font-size:24px;font-weight:900;letter-spacing:.02em;border-radius:22px}.huge.out{background:#dc2626;color:#fff}
.lang{display:flex;gap:6px;justify-content:flex-end}.lang button{min-height:34px;padding:4px 10px;font-size:13px}
.pin{font-size:28px;letter-spacing:.3em;text-align:center;font-weight:800}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.tiles>*{min-width:0}
.tile{min-height:96px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;text-align:left;background:var(--card-2);color:var(--text);border:1px solid var(--line);text-decoration:none;border-radius:16px;padding:14px}
.tile .i{font-size:26px}.tile b{font-size:16px}.tile small{color:var(--muted);font-weight:600;font-size:12px;line-height:1.3}
.tile.locked{opacity:.5}
.task{border:1px solid var(--line);border-radius:14px;padding:12px;margin-top:10px;background:var(--card-2)}
.task .pr{font-size:11px;font-weight:900;padding:2px 8px;border-radius:99px;border:1px solid var(--line)}
.task .pr.urgent{background:#dc2626;color:#fff;border:0}.task .pr.important{background:var(--accent);color:var(--accent-ink);border:0}
.back{min-height:40px;padding:6px 14px}
#app>*{min-width:0;max-width:100%}input[type=file]{width:100%;max-width:100%}
.filebtn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:64px;border:2px dashed var(--accent);border-radius:16px;font-weight:800;cursor:pointer;color:var(--text)}
.pick{max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:12px}
.pick button{display:flex;justify-content:space-between;width:100%;min-height:46px;border-radius:0;background:transparent;color:var(--text);border-bottom:1px solid var(--line);text-align:left;font-weight:700}
.line{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}
.st{font-size:12px;font-weight:800;padding:2px 8px;border-radius:99px;white-space:nowrap}
.st.new{background:var(--ok-soft);color:var(--ok)}.st.saved{background:var(--card-2);color:var(--muted)}.st.changed{background:var(--warn-soft);color:var(--warn)}.st.unmatched,.st.duplicate{background:var(--bad-soft);color:var(--bad)}
.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#16a34a;color:#fff;padding:14px 20px;border-radius:14px;font-weight:800;z-index:50;max-width:90vw;text-align:center}.toast.bad{background:#dc2626}
</style>`,
    script: `
var T={
 uz:{check:'Nazorat ro‘yxati',install:'Telefonga ilova qilib o‘rnatish',hello:'Salom',login:'Kirish',branch:'Filial',user:'Login',pin:'PIN',start:'ISHNI BOSHLADIM',finish:'ISHNI TUGATDIM',working:'Ishdasiz',month:'Mening hisobim — bu oy',days:'kun',hours:'soat',earned:'Hisoblangan',logout:'Chiqish',notLinked:'Rahbar akkauntingizni xodim profiliga bog‘lamagan. Davomat uchun rahbarga ayting.',sureOut:'Ishni tugatasizmi?',off:'Bugun sizga dam belgilangan',err:'Xatolik. Qayta urinib ko‘ring.',net:'Internet aloqasini tekshiring.',back:'← Orqaga',
  actions:'Nima kiritmoqchisiz?',tasks:'Rahbardan vazifalar',noTasks:'Yangi vazifa yo‘q',taskStart:'Boshladim',taskDone:'✓ Bajarildi',due:'Muddat',
  aHisob:'HALO HISOB',aHisobD:'Naqd, hisob-raqam, delivery, oshxona',aPos:'POS hisobot',aPosD:'Kunlik POS Excel faylini yuklash',aIn:'Mahsulot kirimi',aInD:'Miqdor va narx · qarz yozilmaydi',aExp:'Xarajat',aExpD:'Bugungi xarajatni yozish',aMez:'MEZANA',aMezD:'Olib turildi, qaytarildi, qarzga olindi',aWaste:'Minus tavar',aWasteD:'Buzilgan yoki yo‘qolgan mahsulot',aCount:'Kassani sanash',aCountD:'Kun oxiri, summa ko‘rinmaydi',locked:'Rahbar ruxsat bermagan',allDays:'Hamma kunlar',
  locHint:'Bu tugma faqat oshxonada ishlaydi',locWait:'Joylashuv aniqlanmoqda…',locDenied:'Joylashuvga ruxsat bering: telefon sozlamalarida brauzer (ilova) uchun «Joylashuv»ni yoqing va qayta bosing.',locFail:'Joylashuv aniqlanmadi. GPS yoqilganini tekshiring va qayta bosing.',locNone:'Bu telefon joylashuvni bera olmaydi. Rahbarga ayting.',locWeak:'Joylashuv aniq emas (±{a} m). GPS’ni yoqing, bir oz kuting va qayta bosing.',locFar:'Siz oshxonadan {d} uzoqdasiz. Bu tugma faqat oshxonadan {r} metr ichida ishlaydi.'},
 ru:{install:'Установить как приложение',hello:'Привет',login:'Войти',branch:'Филиал',user:'Логин',pin:'PIN',start:'НАЧАЛ РАБОТУ',finish:'ЗАКОНЧИЛ РАБОТУ',working:'Вы на работе',month:'Мой учёт — этот месяц',days:'дн.',hours:'ч',earned:'Начислено',logout:'Выйти',notLinked:'Руководитель не привязал ваш аккаунт к профилю сотрудника.',sureOut:'Закончить работу?',off:'Сегодня у вас выходной',err:'Ошибка. Попробуйте ещё раз.',net:'Проверьте интернет.',back:'← Назад',
  actions:'Что вводим?',tasks:'Задачи от руководителя',noTasks:'Новых задач нет',taskStart:'Начал',taskDone:'✓ Готово',due:'Срок',
  aHisob:'HALO HISOB',aHisobD:'Наличные, счёт, доставка, кухня',aPos:'POS отчёт',aPosD:'Загрузить дневной Excel с POS',aIn:'Приход товара',aInD:'Количество и цена',aExp:'Расход',aExpD:'Внести расход',aMez:'MEZANA',aMezD:'Взяли, вернули, купили в долг',aWaste:'Списание',aWasteD:'Испорченный или потерянный товар',aCount:'Пересчёт кассы',aCountD:'В конце дня',locked:'Нет разрешения',allDays:'Все дни',
  locHint:'Кнопка работает только на кухне',locWait:'Определяем местоположение…',locDenied:'Разрешите доступ к геолокации: в настройках телефона включите «Местоположение» для браузера (приложения) и нажмите снова.',locFail:'Местоположение не определено. Проверьте, включён ли GPS, и нажмите снова.',locNone:'Этот телефон не может определить местоположение. Сообщите руководителю.',locWeak:'Местоположение неточное (±{a} м). Включите GPS, подождите немного и нажмите снова.',locFar:'Вы в {d} от кухни. Кнопка работает только в пределах {r} м от кухни.'},
 en:{install:'Install as an app',hello:'Hi',login:'Log in',branch:'Branch',user:'Login',pin:'PIN',start:'STARTED WORK',finish:'FINISHED WORK',working:'You are at work',month:'My account — this month',days:'days',hours:'h',earned:'Earned',logout:'Log out',notLinked:'The manager has not linked your account to a staff profile.',sureOut:'Finish work?',off:'Today is your day off',err:'Error. Please try again.',net:'Check your internet.',back:'← Back',
  actions:'What do you want to enter?',tasks:'Tasks from the manager',noTasks:'No new tasks',taskStart:'Started',taskDone:'✓ Done',due:'Due',
  aHisob:'HALO HISOB',aHisobD:'Cash, transfer, delivery, kitchen',aPos:'POS report',aPosD:'Upload the daily POS Excel',aIn:'Goods receipt',aInD:'Quantity and price',aExp:'Expense',aExpD:'Enter an expense',aMez:'MEZANA',aMezD:'Borrowed, returned, bought on credit',aWaste:'Stock deduction',aWasteD:'Damaged or missing product',aCount:'Count the cash',aCountD:'End of day',locked:'Not permitted',allDays:'All days',
  locHint:'This button works only at the kitchen',locWait:'Getting your location…',locDenied:'Allow location access: turn on Location for the browser (app) in your phone settings and press again.',locFail:'Could not get your location. Check that GPS is on and press again.',locNone:'This phone cannot provide a location. Tell the manager.',locWeak:'Location is not accurate (±{a} m). Turn on GPS, wait a moment and press again.',locFar:'You are {d} from the kitchen. This button works only within {r} m of the kitchen.'},
 ko:{install:'앱으로 설치',hello:'안녕하세요',login:'로그인',branch:'지점',user:'아이디',pin:'PIN',start:'업무 시작',finish:'업무 종료',working:'근무 중',month:'내 근무 — 이번 달',days:'일',hours:'시간',earned:'누적 급여',logout:'로그아웃',notLinked:'관리자가 계정을 직원 프로필에 연결하지 않았습니다.',sureOut:'업무를 종료할까요?',off:'오늘은 휴무입니다',err:'오류가 발생했습니다.',net:'인터넷을 확인하세요.',back:'← 뒤로',
  actions:'무엇을 입력할까요?',tasks:'관리자 업무',noTasks:'새 업무 없음',taskStart:'시작',taskDone:'✓ 완료',due:'마감',
  aHisob:'HALO HISOB',aHisobD:'현금, 계좌, 배달, 주방',aPos:'POS 보고서',aPosD:'일일 POS 엑셀 업로드',aIn:'상품 입고',aInD:'수량과 금액',aExp:'지출',aExpD:'지출 입력',aMez:'MEZANA',aMezD:'빌림, 반납, 외상 구매',aWaste:'재고 차감',aWasteD:'파손 또는 분실',aCount:'현금 세기',aCountD:'마감 시',locked:'권한 없음',allDays:'전체',
  locHint:'이 버튼은 주방에서만 작동합니다',locWait:'위치 확인 중…',locDenied:'위치 권한을 허용해 주세요: 휴대폰 설정에서 브라우저(앱)의 위치를 켜고 다시 누르세요.',locFail:'위치를 확인하지 못했습니다. GPS가 켜져 있는지 확인하고 다시 누르세요.',locNone:'이 휴대폰은 위치를 제공할 수 없습니다. 관리자에게 알려 주세요.',locWeak:'위치가 정확하지 않습니다 (±{a} m). GPS를 켜고 잠시 후 다시 누르세요.',locFar:'주방에서 {d} 떨어져 있습니다. 이 버튼은 주방에서 {r} m 이내에서만 작동합니다.'}};
var L='uz';try{L=localStorage.getItem('halo-lang')||'uz'}catch(e){}if(!T[L])L='uz';
function t(k){return T[L][k]||T.uz[k]||k}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function hm(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}
function won(n){n=Number(n||0);return Math.round(Math.abs(n)).toLocaleString('en-US')+' ₩'}
function uuid(){return crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g,function(){return (Math.random()*16|0).toString(16)})}
function req(url,method,body){return fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:t('net')}}})}
function form(url,fd){return fetch(url,{method:'POST',body:fd,credentials:'same-origin'}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:t('net')}}})}
function locate(){return new Promise(function(done){
  if(!navigator.geolocation){done({error:'locNone'});return}
  // Ruxsat so'rovi javobsiz qolsa ham tugma osilib qolmasin: 30 soniyadan keyin xabar chiqadi.
  var over=false,guard=setTimeout(function(){if(!over){over=true;done({error:'locDenied'})}},30000);
  var end=function(v){if(over)return;over=true;clearTimeout(guard);done(v)};
  navigator.geolocation.getCurrentPosition(function(p){end({location:{lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}})},function(e){end({error:e&&e.code===1?'locDenied':'locFail'})},{enableHighAccuracy:true,timeout:20000,maximumAge:0})})}
function locMsg(b){var far=function(m){return m>=1000?(m/1000).toFixed(1)+' km':m+' m'};
  if(b.code==='TOO_FAR')return t('locFar').replace('{d}',far(Number(b.distance)||0)).replace('{r}',b.radius);
  if(b.code==='LOCATION_WEAK')return t('locWeak').replace('{a}',b.accuracy);
  if(b.code==='LOCATION_REQUIRED')return t('locDenied');
  return b.error||t('err')}
function toast(text,bad){var x=document.createElement('div');x.className='toast'+(bad?' bad':'');x.textContent=text;document.body.appendChild(x);setTimeout(function(){x.remove()},bad?4500:2200)}
var app=document.getElementById('app'),SESSION=null,TIMER=null,DATA=null;
function langBar(){return '<div class="lang">'+['uz','ru','en','ko'].map(function(k){return '<button class="'+(k===L?'':'ghost')+'" data-l="'+k+'">'+k.toUpperCase()+'</button>'}).join('')+'</div>'}
function bindLang(){app.querySelectorAll('[data-l]').forEach(function(b){b.addEventListener('click',function(){L=b.dataset.l;try{localStorage.setItem('halo-lang',L)}catch(e){}start()})})}
function start(){clearInterval(TIMER);req('/api/worker-auth','GET').then(function(r){SESSION=r.body;if(r.body.authenticated)home();else loginForm(r.body.branches||[])})}
function loginForm(branches){
  var saved='';try{saved=localStorage.getItem('halo-branch')||''}catch(e){}
  app.innerHTML=langBar()+'<section class="card"><h1 style="margin:0 0 14px;font-size:26px">HALO</h1>'
    +(branches.length>1?'<label class="field"><span>'+t('branch')+'</span><select id="b">'+branches.map(function(b){return '<option value="'+esc(b.id)+'"'+(b.id===saved?' selected':'')+'>'+esc(b.name)+'</option>'}).join('')+'</select></label>':'')
    +'<label class="field"><span>'+t('user')+'</span><input id="u" autocapitalize="off" autocomplete="username"></label>'
    +'<label class="field"><span>'+t('pin')+'</span><input id="p" class="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password"></label>'
    +'<button class="block" id="go">'+t('login')+'</button><div id="m"></div></section>';
  bindLang();
  document.getElementById('go').addEventListener('click',function(){var btn=this;btn.disabled=true;
    var bid=document.getElementById('b')?document.getElementById('b').value:((branches[0]||{}).id||'main');
    try{localStorage.setItem('halo-branch',bid)}catch(e){}
    req('/api/worker-auth','POST',{action:'login',branchId:bid,username:document.getElementById('u').value.trim().toLowerCase(),pin:document.getElementById('p').value}).then(function(r){btn.disabled=false;
      if(!r.body.ok){document.getElementById('m').innerHTML='<div class="msg bad">'+esc(r.body.error||t('err'))+'</div>';return}start()})});
}
function tile(id,icon,title,desc,href,locked){var inner='<span class="i">'+icon+'</span><b>'+title+'</b><small>'+(locked?t('locked'):desc)+'</small>';
  return href&&!locked?'<a class="tile" href="'+href+'">'+inner+'</a>':'<button class="tile'+(locked?' locked':'')+'" data-act="'+id+'"'+(locked?' disabled':'')+'>'+inner+'</button>'}
/* Ochilish/yopilish nazorati — smenada belgilanadi (/api/operations, faqat bugun). */
function loadChecklist(){var box=document.getElementById('chk');if(!box)return;
  req('/api/operations?scope=worker','GET').then(function(r){if(r.status>=400||!r.body.checklist){box.remove();return}var c=r.body.checklist;
    box.innerHTML='<h2>✅ '+t('check')+' · '+c.completed+'/'+c.total+'</h2>'+c.phases.map(function(p){return '<p class="hint" style="margin:10px 0 4px"><b>'+esc(p.title)+'</b> · '+p.completed+'/'+p.total+'</p>'
      +p.items.map(function(i){var mine=!i.completion||!i.completion.completedByWorkerId||i.completion.completedByWorkerId===SESSION.userId;var dis=i.id==='closing-cash'||(i.completed&&!mine);
        return '<label class="list-row" style="cursor:pointer"><div style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" data-ck="'+esc(i.id)+'" style="width:24px;height:24px;min-height:auto;margin-top:2px"'+(i.completed?' checked':'')+(dis?' disabled':'')+'><div><b>'+esc(i.title)+'</b><br><small style="color:var(--muted)">'+esc(i.detail)+'</small>'+(i.completed&&i.completion?'<br><small style="color:var(--ok)">✓ '+esc(i.completion.completedBy)+'</small>':'')+'</div></div><span></span></label>'}).join('')}).join('');
    box.querySelectorAll('[data-ck]').forEach(function(cb){cb.addEventListener('change',function(){cb.disabled=true;
      req('/api/operations','POST',{scope:'worker',date:c.date,itemId:cb.dataset.ck,completed:cb.checked}).then(function(x){if(x.status>=400)toast(x.body.error||t('err'),true);loadChecklist()})})});
  })}
function home(){
  clearInterval(TIMER);app.innerHTML=langBar()+'<section class="card">'+haloLoading(3)+'</section>';bindLang();
  Promise.all([req('/api/attendance','GET'),req('/api/worker-tasks','GET')]).then(function(res){
    var r=res[0],a=r.body;
    if(r.status===401){loginForm(SESSION.branches||[]);return}
    var tasks=((res[1].body||{}).tasks||[]).filter(function(x){return x.status==='new'||x.status==='started'});
    var head='<div class="page-head"><div><h1>'+t('hello')+', '+esc(SESSION.userName||'')+'</h1><p>'+esc(a.businessDate||'')+'</p></div></div>';
    var att='';
    if(!a.linked)att='<div class="msg warn">'+t('notLinked')+'</div>';
    else{var open=a.openShift;att='<section class="card">'+(a.todayStatus?'<div class="msg warn">'+t('off')+'</div>':'')
      +(open?'<p style="text-align:center;margin:0 0 12px"><b>'+t('working')+'</b> · <span id="el"></span></p><button class="huge out" id="att">'+t('finish')+'</button>':'<button class="huge" id="att">'+t('start')+'</button>')+(a.place&&a.place.required?'<p class="hint" style="text-align:center;margin:10px 0 0">📍 '+t('locHint')+'</p>':'')+'<div id="am"></div></section>'}
    var tk='<section class="card"><h2>'+t('tasks')+(tasks.length?' · '+tasks.length:'')+'</h2>'+(tasks.length?tasks.map(function(x){
      return '<div class="task"><div class="row" style="justify-content:space-between;gap:8px"><b>'+esc(x.title)+'</b><span class="pr '+esc(x.priority)+'">'+esc(x.priority==='urgent'?'!!':x.priority==='important'?'!':'·')+'</span></div>'
        +(x.description?'<p style="margin:6px 0;color:var(--muted)">'+esc(x.description)+'</p>':'')+(x.dueAt?'<small>'+t('due')+': '+esc(String(x.dueAt).slice(0,16).replace('T',' '))+'</small>':'')
        +'<div class="row" style="margin-top:8px">'+(x.status==='new'?'<button class="ghost" data-ts="'+esc(x.id)+'" data-to="started">'+t('taskStart')+'</button>':'')+'<button data-ts="'+esc(x.id)+'" data-to="done" style="flex:1">'+t('taskDone')+'</button></div></div>'}).join(''):'<p class="hint" style="margin:0">'+t('noTasks')+'</p>')+'</section>';
    var acts='<section class="card"><h2>'+t('actions')+'</h2><div class="tiles">'
      +tile('hisob','🧾',t('aHisob'),t('aHisobD'),'/pos')
      +tile('pos','📊',t('aPos'),t('aPosD'))
      +tile('in','📦',t('aIn'),t('aInD'),null,!SESSION.canSupplierDelivery)
      +tile('exp','💸',t('aExp'),t('aExpD'),null,!SESSION.canWarehouseReceipt)
      +tile('mez','🤝',t('aMez'),t('aMezD'),null,!SESSION.canWarehouseReceipt)
      +tile('waste','🗑',t('aWaste'),t('aWasteD'),'/api/v2/pos#chiqit')
      +tile('count','💵',t('aCount'),t('aCountD'),'/api/v2/kassa')+'</div></section>';
    var e=a.earnings||{},days=(e.days||[]);
    var acc=a.linked?'<section class="card"><h2>'+t('month')+'</h2><div class="grid"><div class="kpi"><small>'+t('days')+'</small><b>'+(e.workedDays||0)+'</b></div><div class="kpi"><small>'+t('hours')+'</small><b>'+Math.floor((e.workedMinutes||0)/60)+':'+String((e.workedMinutes||0)%60).padStart(2,'0')+'</b></div><div class="kpi"><small>'+t('earned')+'</small><b>'+won(e.totalEarned)+'</b></div></div>'
      +'<div id="dl">'+days.slice(0,7).map(dayRow).join('')+'</div>'+(days.length>7?'<button class="ghost block" id="more" style="margin-top:8px">'+t('allDays')+' ('+days.length+')</button>':'')+'</section>':'';
    var chk=a.linked&&a.openShift?'<section class="card" id="chk"><h2>✅ '+t('check')+'</h2>'+haloLoading(2)+'</section>':'';
    app.innerHTML=langBar()+head+att+chk+tk+acts+acc+(window.haloStandalone()?'':'<a href="/api/v2/ornatish?app=xodim"><button class="ghost block">📲 '+t('install')+'</button></a>')+'<button class="ghost block" id="out">'+t('logout')+'</button>';
    bindLang();
    document.getElementById('out').addEventListener('click',function(){req('/api/worker-auth','POST',{action:'logout'}).then(start)});
    var more=document.getElementById('more');if(more)more.addEventListener('click',function(){document.getElementById('dl').innerHTML=days.map(dayRow).join('');more.remove()});
    app.querySelectorAll('[data-ts]').forEach(function(b){b.addEventListener('click',function(){b.disabled=true;req('/api/worker-tasks','PATCH',{taskId:b.dataset.ts,status:b.dataset.to}).then(function(x){if(x.status>=400){toast(x.body.error||t('err'),true);b.disabled=false;return}toast('✓');home()})})});
    app.querySelectorAll('[data-act]').forEach(function(b){b.addEventListener('click',function(){if(b.dataset.act==='pos')posScreen();else if(b.dataset.act==='in')intakeScreen();else if(b.dataset.act==='exp')expenseScreen();else if(b.dataset.act==='mez')mezanaScreen()})});
    if(chk)loadChecklist();
    if(a.linked){var open2=a.openShift;
      if(open2){var tick=function(){var ms=Date.now()-Date.parse(open2.clockIn),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000);var el=document.getElementById('el');if(el)el.textContent=h+':'+String(m).padStart(2,'0')};tick();TIMER=setInterval(tick,30000)}
      document.getElementById('att').addEventListener('click',function(){if(open2&&!confirm(t('sureOut')))return;var btn=this,am=document.getElementById('am');btn.disabled=true;
        // Joy cheklovi yoqilgan bo'lsa, avval telefon joylashuvi olinadi (server masofani o'zi tekshiradi).
        var send=function(loc,retried){req('/api/attendance','POST',{action:open2?'clock-out':'clock-in',location:loc||undefined}).then(function(x){
          if(x.status>=400&&x.body.code==='LOCATION_REQUIRED'&&!loc&&!retried){withLoc(true);return}
          btn.disabled=false;if(x.status>=400){am.innerHTML='<div class="msg bad">'+esc(locMsg(x.body))+'</div>';return}home()})};
        var withLoc=function(retried){am.innerHTML='<div class="msg warn">📍 '+t('locWait')+'</div>';locate().then(function(g){if(g.error){btn.disabled=false;am.innerHTML='<div class="msg bad">'+esc(t(g.error))+'</div>';return}am.innerHTML='';send(g.location,retried)})};
        if(a.place&&a.place.required)withLoc(false);else send(null,false)})}
  });
}
function dayRow(d){return '<div class="list-row"><span>'+esc(String(d.date).slice(5))+' · '+hm(d.clockIn)+'–'+(d.clockOut?hm(d.clockOut):'…')+'</span><b>'+(d.amount?won(d.amount):'')+'</b></div>'}
function screen(title,body){clearInterval(TIMER);app.innerHTML='<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><button class="ghost back" id="bk">'+t('back')+'</button></div><h1 style="margin:4px 0 0;font-size:24px">'+title+'</h1>'+body;
  document.getElementById('bk').addEventListener('click',home);bindLang()}
function loadData(){return req('/api/v2/xodim','POST',{}).then(function(r){if(r.status===401){start();return null}DATA=r.body;return DATA})}
/* ---------- POS hisobot (Excel) ---------- */
function posScreen(){
  var P={file:null,links:{},preview:null,accounts:[],account:''};
  screen('📊 '+t('aPos'),'<section class="card"><p class="hint" style="margin-top:0">POS apparatidan kunlik “상품별 매출” (taomlar bo‘yicha savdo) hisobotini Excel yoki CSV qilib oling va shu yerga yuklang. Fayl tekshiriladi, taomlar menyuga bog‘lanadi, ombor avtomatik kamayadi, soliq va karta komissiyasi o‘zi hisoblanadi.</p>'
    +'<label class="filebtn"><span>📂</span><span id="pfn">Faylni tanlash (.xlsx, .xls, .csv)</span><input type="file" id="pf" accept=".xlsx,.xls,.csv" hidden></label></section><div id="pv"></div>');
  document.getElementById('pf').addEventListener('change',function(){P.file=this.files[0]||null;P.links={};if(P.file){document.getElementById('pfn').textContent=P.file.name;preview()}});
  function fd(action){var f=new FormData();f.set('file',P.file);f.set('action',action);f.set('links',JSON.stringify(P.links));if(P.account)f.set('accountId',P.account);return f}
  function preview(){var box=document.getElementById('pv');box.innerHTML='<section class="card">'+haloLoading(3)+'</section>';
    form('/api/v2/pos-excel',fd('preview')).then(function(r){if(r.body.error){box.innerHTML='<div class="msg bad">'+esc(r.body.error)+'</div>';return}
      P.preview=r.body.preview;P.accounts=r.body.accounts||P.accounts;if(!P.account){var card=P.accounts.find(function(a){return a.type==='card'});P.account=(card||P.accounts[0]||{}).id||''}draw()})}
  function draw(){var p=P.preview,box=document.getElementById('pv');
    var label={new:'yangi',saved:'oldin saqlangan',changed:'yangilanadi',unmatched:'bog‘lang',duplicate:'takror'};
    box.innerHTML='<section class="card"><h2>'+esc(p.date)+' · '+won(p.totals.revenue)+'</h2><p class="hint" style="margin:0">'+p.totals.quantity+' ta taom · '+p.products.length+' xil'+(p.counts.saved?' · '+p.counts.saved+' xil oldin saqlangan':'')+'</p>'
      +(p.errors.length?'<div class="msg bad" style="margin-top:10px">'+p.errors.map(esc).join('<br>')+'</div>':'')
      +(p.manualPos&&p.manualPos.count?'<div class="msg warn" style="margin-top:10px">⚠ Bu kunga POS savdosi qo‘lda ham kiritilgan. Tasdiqlashdan oldin rahbarga ayting — ikki marta hisoblanmasin.</div>':'')+'</section>'
      +'<section class="card"><h2>Taomlar</h2>'+p.products.map(function(x){
        return '<div class="line"><div style="min-width:0"><b>'+esc(x.recipeName||x.product)+'</b><br><small style="color:var(--muted)">'+esc(x.productCode?x.productCode+' · ':'')+esc(x.product)+' · '+x.quantity+' ta · '+won(x.revenue)+'</small>'
          +(x.status==='unmatched'?'<select data-link="'+esc(x.key)+'" style="margin-top:6px;width:100%"><option value="">— menyudagi taomni tanlang —</option>'+p.recipes.map(function(rc){return '<option value="'+esc(rc.id)+'"'+(P.links[x.key]===rc.id?' selected':'')+'>'+esc(rc.name)+'</option>'}).join('')+'</select>':'')
          +'</div><span class="st '+x.status+'">'+label[x.status]+'</span></div>'}).join('')+'</section>'
      +(p.ready?'<section class="card"><label class="field"><span>Pul qayerga tushgan?</span><select id="pa">'+P.accounts.map(function(a){return '<option value="'+esc(a.id)+'"'+(a.id===P.account?' selected':'')+'>'+esc(a.name)+(a.type==='card'?' (karta)':' (naqd)')+'</option>'}).join('')+'</select></label>'
        +'<button class="block" id="ap">✓ Tasdiqlash — '+won(p.totals.newRevenue)+' ('+p.totals.newQuantity+' ta)</button></section>'
        :(p.counts.unmatched?'<div class="msg warn">Qizil belgilangan taomlarni menyudagi taomga bog‘lang — keyingi safar o‘zi taniladi.</div>':(!p.errors.length?'<div class="msg">Bu hisobot oldin to‘liq yuklangan — yangi savdo yo‘q.</div>':'')));
    box.querySelectorAll('[data-link]').forEach(function(s){s.addEventListener('change',function(){if(s.value)P.links[s.dataset.link]=s.value;else delete P.links[s.dataset.link];preview()})});
    var pa=document.getElementById('pa');if(pa)pa.addEventListener('change',function(){P.account=pa.value});
    var ap=document.getElementById('ap');if(ap)ap.addEventListener('click',function(){if(!confirm('POS savdosi saqlansinmi? Ombor kamayadi.'))return;ap.disabled=true;
      form('/api/v2/pos-excel',fd('apply')).then(function(r){ap.disabled=false;if(r.body.error){toast(r.body.error,true);return}
        var s=r.body.applied;toast('✓ '+s.saved+' qator saqlandi · '+won(s.revenue));P.preview=r.body.preview;draw()})});
  }
}
/* ---------- Mahsulot kirimi ---------- */
function units(item){var u=[item.unit];if(item.unit==='g')u.push('kg');if(item.unit==='ml')u.push('litr');if(item.unit==='kg')u.push('g');if(item.unit==='litr')u.push('ml');if(item.packageName&&item.unitsPerPackage>1)u.push(item.packageName);else if(item.vegetable)u.push('qadoq');if(item.vegetable&&u.indexOf('dona')<0)u.push('dona');return u.filter(function(x,i,a){return x&&a.indexOf(x)===i})}
function intakeScreen(){
  var I={veg:false,lines:[],op:uuid(),q:'',cat:''};
  screen('📦 '+t('aIn'),'<div id="ib"><section class="card">'+haloLoading(3)+'</section></div>');
  loadData().then(function(d){if(!d)return;draw()});
  function draw(){var d=DATA,box=document.getElementById('ib');
    var list=d.inventory.filter(function(i){return i.vegetable===I.veg&&!I.lines.some(function(l){return l.inventoryId===i.id})&&(!I.q||i.name.toLowerCase().indexOf(I.q.toLowerCase())>=0)});
    var cats=(d.categories||[]).filter(function(c){return list.some(function(i){return i.categoryId===c.id})});
    if(I.cat&&!cats.some(function(c){return c.id===I.cat}))I.cat='';
    if(I.cat)list=list.filter(function(i){return i.categoryId===I.cat});
    box.innerHTML='<section class="card"><div class="seg" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="'+(I.veg?'ghost':'')+'" data-veg="0">📦 Ombor</button><button class="'+(I.veg?'':'ghost')+'" data-veg="1">🥬 Sabzavot va sous</button></div>'
      +'<input id="iq" placeholder="🔍 Mahsulot qidirish" value="'+esc(I.q)+'" style="margin-top:12px">'+(cats.length>1?'<div class="chips" style="margin-top:8px"><button class="'+(I.cat?'ghost':'')+'" data-ic="">Hammasi</button>'+cats.map(function(c){return '<button class="'+(I.cat===c.id?'':'ghost')+'" data-ic="'+esc(c.id)+'">'+esc(c.name)+'</button>'}).join('')+'</div>':'')+'<div class="pick" style="margin-top:8px">'+(list.map(function(i){return '<button data-add="'+esc(i.id)+'"><span>'+esc(i.name)+'</span><small style="color:var(--muted)">'+esc(i.unit)+' +</small></button>'}).join('')||'<p class="hint" style="padding:10px">Topilmadi</p>')+'</div></section>'
      +(I.lines.length?'<section class="card"><h2>Kirim</h2>'+I.lines.map(function(l,idx){var it=d.inventory.find(function(i){return i.id===l.inventoryId});
        return '<div style="border-bottom:1px solid var(--line);padding:10px 0"><div class="row" style="justify-content:space-between"><b>'+esc(it.name)+'</b><button class="ghost" data-rm="'+idx+'" style="min-height:32px;padding:2px 10px">✕</button></div>'
          +'<div class="row" style="gap:8px;margin-top:6px"><input data-q="'+idx+'" inputmode="decimal" placeholder="Miqdor" value="'+esc(l.quantity)+'" style="flex:1;min-width:0"><select data-u="'+idx+'" style="flex:1;min-width:0">'+units(it).map(function(u){return '<option'+(u===l.unit?' selected':'')+'>'+esc(u)+'</option>'}).join('')+'</select><input data-a="'+idx+'" inputmode="numeric" placeholder="Jami ₩" value="'+esc(l.amount)+'" style="flex:1.2;min-width:0"></div></div>'}).join('')
        +'<label class="field" style="margin-top:12px"><span>Yetkazib beruvchi (ixtiyoriy)</span><select id="isup"><option value="">—</option>'+d.suppliers.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>'}).join('')+'</select></label>'
        +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="inote" maxlength="200"></label>'
        +'<div class="row" style="justify-content:space-between"><b>Jami: <span id="itot">'+won(total())+'</span></b></div><button class="block" id="isave" style="margin-top:10px">✓ Kirimni saqlash</button><p class="hint" style="margin:8px 0 0">Faqat kirim — qarz va to‘lov rahbar tomonidan yoziladi.</p></section>':'');
    box.querySelectorAll('[data-veg]').forEach(function(b){b.addEventListener('click',function(){I.veg=b.dataset.veg==='1';draw()})});
    var q=document.getElementById('iq');q.addEventListener('input',function(){I.q=q.value;var p=q.selectionStart;draw();var n=document.getElementById('iq');n.focus();try{n.setSelectionRange(p,p)}catch(e){}});
    box.querySelectorAll('[data-ic]').forEach(function(b){b.addEventListener('click',function(){I.cat=b.dataset.ic;draw()})});
    box.querySelectorAll('[data-add]').forEach(function(b){b.addEventListener('click',function(){var it=d.inventory.find(function(i){return i.id===b.dataset.add});I.lines.push({inventoryId:it.id,quantity:'',unit:units(it)[0],amount:''});I.q='';draw()})});
    box.querySelectorAll('[data-rm]').forEach(function(b){b.addEventListener('click',function(){I.lines.splice(Number(b.dataset.rm),1);draw()})});
    box.querySelectorAll('[data-q]').forEach(function(x){x.addEventListener('input',function(){I.lines[x.dataset.q].quantity=x.value})});
    box.querySelectorAll('[data-u]').forEach(function(x){x.addEventListener('change',function(){I.lines[x.dataset.u].unit=x.value})});
    box.querySelectorAll('[data-a]').forEach(function(x){x.addEventListener('input',function(){I.lines[x.dataset.a].amount=x.value.replace(/[^0-9]/g,'');var tt=document.getElementById('itot');if(tt)tt.textContent=won(total())})});
    var sv=document.getElementById('isave');if(sv)sv.addEventListener('click',function(){save(sv,'')});
  }
  function total(){return I.lines.reduce(function(s,l){return s+(Number(l.amount)||0)},0)}
  function save(btn,dup){
    var d=DATA,lines=I.lines.map(function(l){var it=d.inventory.find(function(i){return i.id===l.inventoryId});return {inventoryId:l.inventoryId,name:it.name,unit:l.unit,quantity:Number(String(l.quantity).replace(',','.')),totalAmount:Number(l.amount)}});
    if(lines.some(function(l){return !(l.quantity>0)||!(l.totalAmount>0)})){toast('Har qatorga miqdor va jami narxni yozing.',true);return}
    var f=new FormData();f.set('inventoryOnly','true');f.set('operationId',I.op);f.set('date',d.today);f.set('lines',JSON.stringify(lines));f.set('updatedAt',d.updatedAt);
    f.set('supplierId',document.getElementById('isup').value);f.set('note',document.getElementById('inote').value);if(dup)f.set('duplicateReason',dup);
    btn.disabled=true;form('/api/worker-deliveries',f).then(function(r){btn.disabled=false;
      if(r.status===409&&/oldin saqlangan|Shunday kirim|takror/i.test(r.body.error||'')&&!dup){var why=prompt((r.body.error||'')+'\\n\\nBu boshqa kirim bo‘lsa, sababini yozing (kamida 5 belgi):');if(why&&why.trim().length>=5)save(btn,why.trim());return}
      if(r.status===409&&/yangilangan|qayta oching/i.test(r.body.error||'')){loadData().then(function(){save(btn,dup)});return}
      if(r.body.error){toast(r.body.error,true);return}
      toast('✓ Kirim saqlandi');I={veg:I.veg,lines:[],op:uuid(),q:''};loadData().then(draw)});
  }
}
/* ---------- Xarajat ---------- */
function expenseScreen(){
  screen('💸 '+t('aExp'),'<div id="eb"><section class="card">'+haloLoading(3)+'</section></div>');
  var op=uuid();
  loadData().then(function(d){if(!d)return;var box=document.getElementById('eb');
    box.innerHTML='<section class="card"><label class="field"><span>Xarajat turi</span><select id="ec">'+d.expenseCategories.map(function(c){return '<option>'+esc(c)+'</option>'}).join('')+'</select></label>'
      +'<label class="field"><span>Nima uchun?</span><input id="en" maxlength="140" placeholder="masalan: gaz balloni"></label>'
      +'<label class="field"><span>Summa (₩)</span><input id="ea" inputmode="numeric" placeholder="0" style="font-size:22px;font-weight:800"></label>'
      +'<label class="field"><span>Qayerdan to‘landi?</span><select id="eacc">'+d.accounts.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>'}).join('')+'</select></label>'
      +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="eno" maxlength="200"></label><button class="block" id="es">✓ Xarajatni saqlash</button></section>';
    var amt=document.getElementById('ea');amt.addEventListener('input',function(){var n=amt.value.replace(/[^0-9]/g,'');amt.value=n?Number(n).toLocaleString('en-US'):''});
    document.getElementById('es').addEventListener('click',function(){var btn=this,amount=Number(amt.value.replace(/[^0-9]/g,''));
      if(!document.getElementById('en').value.trim()||!amount){toast('Nima uchun va summani yozing.',true);return}
      btn.disabled=true;var send=function(){return req('/api/worker-expenses','POST',{operationId:op,category:document.getElementById('ec').value,itemName:document.getElementById('en').value.trim(),amount:amount,accountId:document.getElementById('eacc').value,note:document.getElementById('eno').value,date:DATA.today,updatedAt:DATA.updatedAt})};
      send().then(function(r){if(r.status===409){return loadData().then(send)}return r}).then(function(r){btn.disabled=false;if(r.body.error){toast(r.body.error,true);return}toast('✓ Xarajat saqlandi');home()})});
  });
}
/* ---------- MEZANA: olib turildi / qaytarildi / qarzga olindi ---------- */
/* Telefon rasmi katta bo'ladi: yuborishdan oldin 1600 pikselgacha kichraytiriladi (bo'lmasa asl fayl ketadi). */
function shrinkPhoto(file,done){if(!file||!window.URL||!document.createElement('canvas').getContext){done(file);return}
  var img=new Image(),url=URL.createObjectURL(file);
  img.onload=function(){URL.revokeObjectURL(url);var k=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
    try{c.getContext('2d').drawImage(img,0,0,c.width,c.height);c.toBlob(function(b){done(b?new File([b],'mezana.jpg',{type:'image/jpeg'}):file)},'image/jpeg',0.85)}catch(e){done(file)}};
  img.onerror=function(){URL.revokeObjectURL(url);done(file)};img.src=url}
function mezanaScreen(){
  var M={act:'borrowed',op:uuid(),msg:''},AL={borrowed:'📥 Olib turildi',returned:'📤 Qaytarildi',purchased:'🛒 Qarzga olindi'};
  screen('🤝 MEZANA','<div id="mb" style="display:grid;gap:16px"><section class="card">'+haloLoading(3)+'</section></div>');
  loadData().then(function(d){if(d)draw()});
  function draw(){var z=DATA.mezana,box=document.getElementById('mb');if(!box)return;
    if(!z){box.innerHTML='<div class="msg warn">'+t('locked')+'</div>';return}
    var list=z.catalog.filter(function(c){return M.act==='purchased'?c.mode==='purchased':M.act==='returned'?(c.mode==='borrowed'&&c.borrowed>0):c.mode==='borrowed'});
    var ready=M.act==='purchased'?z.group.purchased:z.group.borrowed;
    box.innerHTML='<section class="card"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'+Object.keys(AL).map(function(a){return '<button class="'+(M.act===a?'':'ghost')+'" data-ma="'+a+'" style="padding:8px 6px;font-size:14px">'+AL[a]+'</button>'}).join('')+'</div>'
      +(list.length?'<label class="field" style="margin-top:14px"><span>Mahsulot</span><select id="mzP">'+list.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.name)+(M.act==='purchased'?' · '+won(c.price):M.act==='returned'?' (olingan: '+c.borrowed+')':c.borrowed?' (hozir: '+c.borrowed+')':'')+'</option>'}).join('')+'</select></label>'
        +'<label class="field"><span>Soni</span><input id="mzQ" inputmode="numeric" placeholder="1" style="font-size:22px;font-weight:800"></label>'
        +(M.act==='purchased'?'<p class="hint" id="mzSum"></p><label class="field"><span>Izoh (ixtiyoriy)</span><input id="mzN" maxlength="300"></label>':'')
        +(z.photos?'<label class="filebtn"><span>📷</span><span id="mzFn">Rasm (ixtiyoriy)</span><input type="file" id="mzF" accept="image/*" hidden></label>':'')
        +'<button class="block" id="mzGo" style="margin-top:12px">✓ Saqlash</button>'
        :'<p class="hint" style="margin:14px 0 0">'+(M.act==='returned'?'Qaytariladigan olib turilgan mahsulot yo‘q.':'Rahbar bu amal uchun MEZANA mahsulotlarini hali belgilamagan.')+'</p>')
      +(ready?'':'<p class="hint" style="margin:10px 0 0">Telegram guruhi ulanmagan: yozuv saqlanadi, lekin guruhga bormaydi. Rahbarga ayting.</p>')
      +'<div id="mzMsg">'+M.msg+'</div></section>'
      +(z.mine.length?'<section class="card"><h2>Oxirgi yozuvlarim</h2>'+z.mine.map(function(e){return '<div class="list-row"><div style="min-width:0"><b>'+(AL[e.action]||'💸 To‘lov')+' · '+esc(e.name)+'</b><br><small style="color:var(--muted)">'+esc(e.date)+'</small></div><b>'+(e.action==='purchased'?won(e.amount):e.quantity+' ta')+'</b></div>'}).join('')+'</section>':'');
    box.querySelectorAll('[data-ma]').forEach(function(b){b.addEventListener('click',function(){M.act=b.dataset.ma;M.msg='';draw()})});
    var q=document.getElementById('mzQ'),p=document.getElementById('mzP'),sum=document.getElementById('mzSum');
    var total=function(){if(!sum)return;var c=z.catalog.find(function(x){return x.id===p.value}),n=Number(String(q.value).replace(/[^0-9]/g,''))||0;sum.textContent=c&&n?'Jami: '+won(c.price*n)+' (1 dona '+won(c.price)+')':''};
    if(q){q.addEventListener('input',function(){q.value=q.value.replace(/[^0-9]/g,'');total()});p.addEventListener('change',total)}
    var f=document.getElementById('mzF');if(f)f.addEventListener('change',function(){document.getElementById('mzFn').textContent=f.files[0]?'✓ '+f.files[0].name:'Rasm (ixtiyoriy)'});
    var go=document.getElementById('mzGo');if(go)go.addEventListener('click',function(){var n=Number(q.value)||0,c=z.catalog.find(function(x){return x.id===p.value});
      if(!c||!(n>0)){toast('Mahsulot va sonini yozing.',true);return}
      if(M.act==='returned'&&n>c.borrowed){toast(c.name+'dan faqat '+c.borrowed+' ta olib turilgan.',true);return}
      if(!confirm(AL[M.act]+' · '+c.name+' · '+n+' ta'+(M.act==='purchased'?' · '+won(c.price*n):'')+'. Saqlansinmi?'))return;
      go.disabled=true;shrinkPhoto(f&&f.files[0],function(photo){
        var fd=new FormData();fd.set('operationId',M.op);fd.set('action',M.act);fd.set('catalogItemId',c.id);fd.set('date',DATA.today);
        if(M.act==='purchased'){fd.set('itemCount',String(n));var nt=document.getElementById('mzN');fd.set('note',nt?nt.value:'')}else fd.set('quantity',String(n));
        if(photo)fd.set('fileTop',photo,photo.name||'mezana.jpg');
        form('/api/worker-mezana',fd).then(function(r){go.disabled=false;
          if(r.body.error){toast(r.body.error,true);return}
          var tg=r.body.telegram||{};M.op=uuid();
          M.msg=tg.sent?'<div class="msg ok" style="margin-top:12px">✓ Saqlandi va Telegram guruhga yuborildi</div>':'<div class="msg warn" style="margin-top:12px">✓ Saqlandi. Telegram guruhga yuborilmadi: '+esc(tg.reason||'sabab noma’lum')+'</div>';
          toast('✓ '+AL[M.act]+' · '+c.name);loadData().then(function(d){if(d)draw()})})})});
  }
}
start();
`,
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
