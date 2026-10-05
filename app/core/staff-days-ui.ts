/**
 * Maosh sahifasi uchun: «Ishlagan kunlar» oynasi — rahbar oy taqvimidan kunlarni belgilab, bir xil vaqt bilan
 * birdaniga kiritadi (brauzer skripti). Sahifadagi mavjud yordamchilardan foydalanadi: esc, api, sel, MONTH, hm, digits,
 * uuid, load, openSlip, STAFF, DAYST.
 * Diqqat: bu matn ichida teskari tirnoq va dollar-qavs ishlatilmaydi (sahifa skriptiga qo'shiladi).
 */
export const STAFF_DAYS_STYLE = String.raw`<style>
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;margin:8px 0 12px}
.cal .wd{text-align:center;font-size:12px;font-weight:700;color:var(--muted);padding:2px 0}
.cal button{min-width:0;width:100%;min-height:54px;padding:4px 0;overflow:hidden;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;line-height:1.1}
.cal button b{font-size:16px}
.cal button small{font-size:10.5px;font-weight:700;color:var(--muted);white-space:nowrap;letter-spacing:-.02em}
.cal button.has small{color:var(--ok)}
.cal button.st small{color:var(--warn)}
</style>`;

export const STAFF_DAYS_SCRIPT = String.raw`
/* ---------- Ishlagan kunlar: rahbar bir nechta kunni birdaniga kiritadi ---------- */
var NOTE='';
function daysForm(staffId,employeeId,name){
  var box=document.getElementById('actBox');box.innerHTML='<p class="hint">Yuklanmoqda…</p>';
  api({action:'records',branchId:sel.value,staffId:staffId,month:MONTH}).then(function(r){
    if(!r.ok){box.innerHTML='<div class="msg bad">'+esc(r.error)+'</div>';return}
    var R=r.records,today=r.today,op=uuid(),picked={},y=Number(MONTH.slice(0,4)),m=Number(MONTH.slice(5,7));
    var count=new Date(Date.UTC(y,m,0)).getUTCDate(),lead=(new Date(Date.UTC(y,m-1,1)).getUTCDay()+6)%7;
    var shiftOf={},statusOf={};
    R.shifts.forEach(function(x){if(x.status!=='void'&&!shiftOf[x.date])shiftOf[x.date]=x});
    R.days.forEach(function(x){if(!x.voided)statusOf[x.date]=x});
    var last=R.shifts.filter(function(x){return x.status==='closed'&&x.clockOut})[0];
    var from=last?hm(last.clockIn):'10:00',to=last?hm(last.clockOut):'20:00',brk=last?last.breakMinutes:0;
    var SHORT={off:'dam',sick:'kasal',absent:'yo‘q'};
    var iso=function(d){return MONTH+'-'+(d<10?'0':'')+d};
    var free=function(d){var k=iso(d);return k<=today&&!shiftOf[k]&&!statusOf[k]};
    function cell(d){
      var k=iso(d),s=shiftOf[k],st=statusOf[k],on=picked[k];
      if(s&&!s.clockOut)return '<button class="ghost has" disabled title="'+hm(s.clockIn)+' — ishda"><b>'+d+'</b><small>ishda</small></button>';
      if(s)return '<button class="'+(on?'':'ghost has')+'" data-day="'+d+'" aria-pressed="'+(on?'true':'false')+'" title="'+hm(s.clockIn)+'–'+hm(s.clockOut)+' — shu kunga yana smena"><b>'+d+'</b><small'+(on?' style="color:inherit"':'')+'>'+(on?'yana':hm(s.clockIn).slice(0,2)+'–'+hm(s.clockOut).slice(0,2))+'</small></button>';
      if(st)return '<button class="ghost st" disabled><b>'+d+'</b><small>'+esc(SHORT[st.status]||st.status)+'</small></button>';
      if(k>today)return '<button class="ghost" disabled><b>'+d+'</b><small>&nbsp;</small></button>';
      return '<button class="'+(on?'':'ghost')+'" data-day="'+d+'" aria-pressed="'+(on?'true':'false')+'"><b>'+d+'</b><small'+(on?' style="color:inherit"':'')+'>'+(on?'✓':'&nbsp;')+'</small></button>';
    }
    function minutes(){var a=document.getElementById('dFrom').value,b=document.getElementById('dTo').value;if(!/^\d\d:\d\d$/.test(a)||!/^\d\d:\d\d$/.test(b))return 0;
      var t=(Number(b.slice(0,2))*60+Number(b.slice(3)))-(Number(a.slice(0,2))*60+Number(a.slice(3)));if(t<=0)t+=1440;return Math.max(0,t-digits(document.getElementById('dBreak').value))}
    function summary(){var n=Object.keys(picked).length,el=document.getElementById('dSum'),mn=minutes();
      el.textContent=n?n+' kun belgilandi · har biri '+hours(mn)+' · jami '+hours(mn*n):'Ishlagan kunlarni bosib belgilang.'}
    function draw(){
      var cells='';for(var i=0;i<lead;i++)cells+='<span></span>';for(var d=1;d<=count;d++)cells+=cell(d);
      document.getElementById('dCal').innerHTML=['Du','Se','Cho','Pa','Ju','Sha','Ya'].map(function(w){return '<span class="wd">'+w+'</span>'}).join('')+cells;
      document.querySelectorAll('[data-day]').forEach(function(b){b.addEventListener('click',function(){var k=iso(Number(b.dataset.day));if(picked[k])delete picked[k];else picked[k]=1;draw()})});
      summary();
    }
    box.innerHTML='<div class="card" style="background:var(--card-2);margin-top:12px"><h2>'+esc(name)+' — ishlagan kunlar · '+esc(MONTH)+'</h2>'
      +'<p class="hint">Xodim telefondan belgilamagan kunlarni shu yerda o‘zingiz kiritasiz: kunlarni bosing, vaqtni yozing, saqlang. Bitta kun ham, bir nechta kun ham shu yerdan. Yashil soatli kunda smena bor — shu kunga yana bitta smena kerak bo‘lsa, ustiga bosing (vaqti ustma-ust tushmasin).</p>'
      +'<div class="cal" id="dCal"></div>'
      +'<div class="row" style="margin-bottom:12px"><button class="ghost" id="dAll" style="min-height:38px;padding:4px 12px">Bo‘sh kunlarning hammasi</button><button class="ghost" id="dNone" style="min-height:38px;padding:4px 12px">Tozalash</button></div>'
      +'<div class="row"><label class="field" style="flex:1"><span>Boshladi</span><input type="time" id="dFrom" value="'+esc(from)+'"></label><label class="field" style="flex:1"><span>Tugatdi</span><input type="time" id="dTo" value="'+esc(to)+'"></label><label class="field" style="flex:1"><span>Tanaffus (daq)</span><input id="dBreak" inputmode="numeric" value="'+esc(brk)+'"></label></div>'
      +'<label class="field"><span>Izoh (ixtiyoriy)</span><input id="dNote" maxlength="200" placeholder="Masalan: daftardan ko‘chirildi"></label>'
      +'<p class="hint" id="dSum" style="margin:0 0 12px"></p>'
      +'<button class="block" id="dSave">Saqlash</button><div id="dMsg"></div></div>';
    draw();
    ['dFrom','dTo','dBreak'].forEach(function(id){document.getElementById(id).addEventListener('input',summary)});
    document.getElementById('dAll').addEventListener('click',function(){for(var d=1;d<=count;d++)if(free(d))picked[iso(d)]=1;draw()});
    document.getElementById('dNone').addEventListener('click',function(){picked={};draw()});
    document.getElementById('dSave').addEventListener('click',function(){
      var msg=document.getElementById('dMsg'),dates=Object.keys(picked).sort(),btn=this,f=document.getElementById('dFrom').value,t=document.getElementById('dTo').value;
      if(!dates.length){msg.innerHTML='<div class="msg bad" style="margin-top:10px">Kamida bitta kunni belgilang.</div>';return}
      if(!f||!t){msg.innerHTML='<div class="msg bad" style="margin-top:10px">Boshlanish va tugash vaqtini yozing.</div>';return}
      if(!confirm(name+' — '+dates.length+' kun ('+dates.map(function(k){return Number(k.slice(8))}).join(', ')+'), '+f+'–'+t+', har biri '+hours(minutes())+'. Saqlansinmi?'))return;
      btn.disabled=true;
      api({action:'shifts',branchId:sel.value,operationId:op,staffId:staffId,dates:dates,from:f,to:t,breakMinutes:digits(document.getElementById('dBreak').value),note:document.getElementById('dNote').value}).then(function(x){
        btn.disabled=false;
        if(!x.ok){msg.innerHTML='<div class="msg bad" style="margin-top:10px">'+esc(x.error||'Saqlanmadi.')+' Hech narsa yozilmadi.</div>';return}
        STAFF=x.staff;NOTE='<div class="msg ok" style="margin-top:12px">✓ '+dates.length+' kun kiritildi. Xato bo‘lsa — «Yozuvlar / tuzatish»dan tuzatasiz.</div>';
        load();setTimeout(function(){openSlip(employeeId)},700)});
    });
    box.scrollIntoView({behavior:'smooth',block:'start'});
  });
}
`;
