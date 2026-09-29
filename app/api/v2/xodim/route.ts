import { shell } from "../../../core/ui-shell";

declare global {
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

/**
 * HALO V2 — xodim ilovasi (telefon): kirish (login + PIN), ISHNI BOSHLADIM / TUGATDIM,
 * shu oy ishlagan kun/soat va hisoblangan pul, kassani ko'r sanash. 4 til: o'zbek, rus, ingliz, koreys.
 * Hamma amal mavjud tekshirilgan API'lar orqali (/api/worker-auth, /api/attendance, /api/v2/kassa).
 */
export async function GET() {
  if (globalThis.__HALO_SELF_HOSTED__ !== true) return new Response("V2 faqat yangi saytda.", { status: 403 });
  return new Response(shell({
    title: "Xodim", active: null,
    body: `<div id="app" style="display:grid;gap:16px"><section class="card"><div class="skeleton"></div></section></div>
<style>.huge{width:100%;min-height:120px;font-size:24px;font-weight:900;letter-spacing:.02em;border-radius:22px}.huge.out{background:#dc2626;color:#fff}.lang{display:flex;gap:6px;justify-content:flex-end}.lang button{min-height:34px;padding:4px 10px;font-size:13px}.pin{font-size:28px;letter-spacing:.3em;text-align:center;font-weight:800}</style>`,
    script: `
var T={
 uz:{hello:'Salom',login:'Kirish',branch:'Filial',user:'Login',pin:'PIN',start:'ISHNI BOSHLADIM',finish:'ISHNI TUGATDIM',working:'Ishdasiz',since:'dan beri',month:'Bu oy',days:'kun',hours:'soat',earned:'Hisoblangan',count:'💵 Kassani sanash',logout:'Chiqish',notLinked:'Rahbar akkauntingizni xodim profiliga bog‘lamagan. Rahbarga ayting.',sureOut:'Ishni tugatasizmi?',today:'Bugun',off:'Bugun sizga dam belgilangan',err:'Xatolik. Qayta urinib ko‘ring.',net:'Internet aloqasini tekshiring.'},
 ru:{hello:'Привет',login:'Войти',branch:'Филиал',user:'Логин',pin:'PIN',start:'НАЧАЛ РАБОТУ',finish:'ЗАКОНЧИЛ РАБОТУ',working:'Вы на работе',since:'с',month:'Этот месяц',days:'дн.',hours:'ч',earned:'Начислено',count:'💵 Пересчёт кассы',logout:'Выйти',notLinked:'Руководитель не привязал ваш аккаунт к профилю сотрудника.',sureOut:'Закончить работу?',today:'Сегодня',off:'Сегодня у вас выходной',err:'Ошибка. Попробуйте ещё раз.',net:'Проверьте интернет.'},
 en:{hello:'Hi',login:'Log in',branch:'Branch',user:'Login',pin:'PIN',start:'STARTED WORK',finish:'FINISHED WORK',working:'You are at work',since:'since',month:'This month',days:'days',hours:'h',earned:'Earned',count:'💵 Count the cash',logout:'Log out',notLinked:'The manager has not linked your account to a staff profile.',sureOut:'Finish work?',today:'Today',off:'Today is your day off',err:'Error. Please try again.',net:'Check your internet.'},
 ko:{hello:'안녕하세요',login:'로그인',branch:'지점',user:'아이디',pin:'PIN',start:'업무 시작',finish:'업무 종료',working:'근무 중',since:'부터',month:'이번 달',days:'일',hours:'시간',earned:'누적 급여',count:'💵 현금 세기',logout:'로그아웃',notLinked:'관리자가 계정을 직원 프로필에 연결하지 않았습니다.',sureOut:'업무를 종료할까요?',today:'오늘',off:'오늘은 휴무입니다',err:'오류가 발생했습니다.',net:'인터넷을 확인하세요.'}};
var L='uz';try{L=localStorage.getItem('halo-lang')||'uz'}catch(e){}if(!T[L])L='uz';
function t(k){return T[L][k]||T.uz[k]}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function hm(iso){var d=new Date(iso);return isNaN(d)?'':d.toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})}
function won(n){n=Number(n||0);return Math.abs(n).toLocaleString('en-US')+' ₩'}
function req(url,method,body){return fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'}).then(function(r){return r.json().then(function(j){return {status:r.status,body:j}})}).catch(function(){return {status:0,body:{error:t('net')}}})}
var app=document.getElementById('app'),SESSION=null,TIMER=null;
function langBar(){return '<div class="lang">'+['uz','ru','en','ko'].map(function(k){return '<button class="'+(k===L?'':'ghost')+'" data-l="'+k+'">'+k.toUpperCase()+'</button>'}).join('')+'</div>'}
function bindLang(){app.querySelectorAll('[data-l]').forEach(function(b){b.addEventListener('click',function(){L=b.dataset.l;try{localStorage.setItem('halo-lang',L)}catch(e){}start()})})}
function start(){req('/api/worker-auth','GET').then(function(r){SESSION=r.body;if(r.body.authenticated)home();else loginForm(r.body.branches||[])})}
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
    req('/api/worker-auth','POST',{action:'login',branchId:bid,username:document.getElementById('u').value.trim().toLowerCase(),pin:document.getElementById('p').value}).then(function(r){btn.disabled=false;
      if(!r.body.ok){document.getElementById('m').innerHTML='<div class="msg bad">'+esc(r.body.error||t('err'))+'</div>';return}start()})});
}
function home(){
  app.innerHTML=langBar()+'<section class="card">'+haloLoading(3)+'</section>';bindLang();
  req('/api/attendance','GET').then(function(r){
    var a=r.body;clearInterval(TIMER);
    if(r.status===401){loginForm(SESSION.branches||[]);return}
    var head='<div class="page-head"><div><h1>'+t('hello')+', '+esc(SESSION.userName||'')+'</h1><p>'+esc(a.businessDate||'')+'</p></div></div>';
    if(!a.linked){app.innerHTML=langBar()+head+'<div class="msg warn">'+t('notLinked')+'</div>'+tail();bindLang();bindTail();return}
    var open=a.openShift,e=a.earnings||{};
    app.innerHTML=langBar()+head
      +'<section class="card">'+(a.todayStatus?'<div class="msg warn">'+t('off')+'</div>':'')
      +(open?'<p style="text-align:center;margin:0 0 12px"><b>'+t('working')+'</b> · <span id="el"></span></p><button class="huge out" id="act">'+t('finish')+'</button>':'<button class="huge" id="act">'+t('start')+'</button>')
      +'<div id="m"></div></section>'
      +'<section class="card"><h2>'+t('month')+'</h2><div class="grid"><div class="kpi"><small>'+t('days')+'</small><b>'+(e.workedDays||0)+'</b></div><div class="kpi"><small>'+t('hours')+'</small><b>'+Math.floor((e.workedMinutes||0)/60)+':'+String((e.workedMinutes||0)%60).padStart(2,'0')+'</b></div><div class="kpi"><small>'+t('earned')+'</small><b>'+won(e.totalEarned)+'</b></div></div>'
      +((e.days||[]).slice(0,10).map(function(d){return '<div class="list-row"><span>'+esc(d.date.slice(5))+' · '+hm(d.clockIn)+'–'+(d.clockOut?hm(d.clockOut):'…')+'</span><b>'+(d.amount?won(d.amount):'')+'</b></div>'}).join(''))+'</section>'
      +tail();
    bindLang();bindTail();
    if(open){var tick=function(){var ms=Date.now()-Date.parse(open.clockIn),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000);var el=document.getElementById('el');if(el)el.textContent=h+':'+String(m).padStart(2,'0')};tick();TIMER=setInterval(tick,30000)}
    document.getElementById('act').addEventListener('click',function(){
      if(open&&!confirm(t('sureOut')))return;var btn=this;btn.disabled=true;
      req('/api/attendance','POST',{action:open?'clock-out':'clock-in'}).then(function(x){btn.disabled=false;if(x.status>=400){document.getElementById('m').innerHTML='<div class="msg bad">'+esc(x.body.error||t('err'))+'</div>';return}home()});
    });
  });
}
function tail(){return '<section class="card"><a href="/api/v2/kassa" style="text-decoration:none"><button class="ghost block">'+t('count')+'</button></a><div style="margin-top:10px"><button class="ghost block" id="out">'+t('logout')+'</button></div></section>'}
function bindTail(){var o=document.getElementById('out');if(o)o.addEventListener('click',function(){req('/api/worker-auth','POST',{action:'logout'}).then(function(){start()})})}
start();
`,
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
