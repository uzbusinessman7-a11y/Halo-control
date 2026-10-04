import { IntakeError } from './unified-intake.ts';
import { applyWarehouseIntake } from './warehouse-intake.ts';
import { mezanaNameKey } from './mezana-posting.ts';
import { rebalanceSuppliers, auditSupplierBalances } from './supplier-transactions.ts';
import { isAccountingMonthClosed } from './month-end.ts';
import { supplierProducts } from './supplier-products.ts';
import { supplierLedger } from './supplier-ledger.ts';
import { calculateDailyReport, createDailyPayrollSource } from './daily-report.ts';

type Row = Record<string, any>;
export const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
export const won = (v: number) => `₩${Math.round(v).toLocaleString('en-US')}`;
export const koreaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
export class AssistantError extends Error {}
export function validDate(v: unknown): string {
 const date=String(v||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) throw new AssistantError('Sanani YYYY-MM-DD shaklida aniqlashtiring.');
 return date;
}
function exact(list:Row[],name:unknown,label:string){
 const found=list.filter(r=>mezanaNameKey(r.name)===mezanaNameKey(name));
 if(found.length!==1) throw new AssistantError(`${label} «${String(name||'')}» aniq topilmadi. Tizimdagi to‘liq nomini yozing.`);
 return found[0];
}
function amount(v:unknown){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<=0||v>1e11)throw new AssistantError('Summani butun vonda yozing.');return v;}
export function buildAssistantPlan(state:Row,intent:Row,id:string){
 const date=validDate(intent.date);
 if(isAccountingMonthClosed(state.monthlyCloses,date))throw new AssistantError('Bu oy yopilgan. Ochiq oy sanasini ko‘rsating.');
 if(intent.kind==='purchase'){
  const body={inventoryOnly:true,operationId:id,date,lines:rows(intent.lines)};
  const result=applyWarehouseIntake(structuredClone(state),body).result;
  return {kind:'warehousePurchase',body,summary:[`Ombor kirimi · ${date}`,...body.lines.map((l:Row)=>`${l.name}: ${l.quantity} ${l.unit} · ${won(Number(l.amount))}`),`Jami: ${won(result.amount || 0)}`,'Faqat mahsulot kirimi. Qarz va to‘lov yaratilmaydi; ularni yetkazib beruvchilar bo‘limida kiriting.'].join('\n')};
 }
 if(intent.kind==='payment'){
  const supplier=exact(rows(state.suppliers),intent.supplierName,'Yetkazuvchi');
  if(/mezana/i.test(supplier.name))throw new AssistantError('MEZANA to‘lovini alohida MEZANA oynasida kiriting.');
  const audit=auditSupplierBalances(state.suppliers,state.transactions).find(a=>a.supplierId===supplier.id);
  if(!audit?.valid||audit.difference!==0)throw new AssistantError('Yetkazuvchi qarzi va tarixi mos emas. Avval moliya tekshiruvini ko‘ring; qarz taxmin bilan o‘zgartirilmaydi.');
  const account=exact(rows(state.accounts),intent.accountName,'To‘lov hisobi');const sum=amount(intent.amount);
  if(sum>Number(supplier.balance))throw new AssistantError(`To‘lov qarzdan katta. Joriy qarz: ${won(Number(supplier.balance))}. Avansni yetkazuvchi oynasida kiriting.`);
  return {kind:'payment',body:{id:`assistant-payment:${id}`,supplierId:supplier.id,accountId:account.id,amount:sum,date},summary:`Qarz to‘lovi · ${date}\n${supplier.name}: ${won(sum)}\nHisob: ${account.name}\nQarz: ${won(supplier.balance)} → ${won(supplier.balance-sum)}\nFoydadan qayta xarajat ayrilmaydi.`};
 }
 throw new AssistantError('Bu amal hozir yordamchida yo‘q. Xarid, yetkazuvchiga qarz to‘lovi, hisobot, qarzlar yoki ombor haqida yozing.');
}
export async function stateFingerprint(state:Row){
 const bytes=new TextEncoder().encode(JSON.stringify(['inventory','suppliers','transactions','accounts','monthlyCloses','financialEntries'].map(k=>[k,state[k]||[]])));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function executeAssistantPlan(state:Row,plan:Row,id:string,fingerprint:string){
 if(rows(state.assistantReceipts).some(r=>r.id===id))return {state,result:{message:'Bu amal oldin saqlangan. Ikkinchi marta yozilmadi.'}};
 if(await stateFingerprint(state)!==fingerprint)throw new AssistantError('Hisoblar yangilangan. Eski tasdiq saqlanmadi — buyruqni qayta yuboring va yangi natijani tekshiring.');
 if(isAccountingMonthClosed(state.monthlyCloses,plan.body.date))throw new AssistantError('Bu oy yopilgan.');
 let next:Row;
 if(plan.kind==='warehousePurchase') next=applyWarehouseIntake(state,plan.body).state;
 else if(plan.kind==='purchase') throw new AssistantError('Kirim tartibi yangilandi. Buyruqni qayta yuboring: ombor kirimi qarz va to‘lovni endi avtomatik yaratmaydi.');
 else if(plan.kind==='payment'){
  const tx={...plan.body,type:'payment',note:'HALO yordamchi · rahbar tasdiqlagan to‘lov'};
  if(rows(state.transactions).some(r=>r.id===tx.id))throw new AssistantError('To‘lov raqami oldin ishlatilgan.');
  const suppliers=rebalanceSuppliers(rows(state.suppliers) as any,null,tx as any);
  if(!suppliers)throw new AssistantError('Yetkazuvchi topilmadi.');
  next={...state,suppliers,transactions:[tx,...rows(state.transactions)],financialEntries:[{id:`supplier-payment:${tx.id}`,transactionId:tx.id,type:'expense',category:'Mahsulot xaridi',amount:tx.amount,date:tx.date,accountId:tx.accountId,affectsProfit:false,note:tx.note},...rows(state.financialEntries)]};
 }else throw new AssistantError('Amal qo‘llab-quvvatlanmaydi.');
 next.assistantReceipts=[...rows(state.assistantReceipts),{id,createdAt:new Date().toISOString(),kind:plan.kind}];
 return {state:next,result:{message:`Saqlandi.\n${plan.summary}`}};
}
export function assistantReport(state:Row,intent:Row){
 if(intent.kind==='report'){
  const date=validDate(intent.date);const end=validDate(intent.dateTo||date);
  const days=(Date.parse(end)-Date.parse(date))/86400000+1;
  if(days<1||days>366)throw new AssistantError('Hisobot davri 1–366 kun bo‘lsin. Boshlanish va tugash sanasini yozing.');
  const r={revenue:0,cost:0,totalExpenses:0,netProfit:0};
  // Ko'p kunlik hisobot: ish haqi har kun uchun qaytadan emas, xodim-oy bo'yicha bir marta hisoblanadi (natija o'sha).
  const payroll=createDailyPayrollSource(state);
  for(let i=0;i<days;i++){const daily=calculateDailyReport(state,new Date(Date.parse(date)+i*86400000).toISOString().slice(0,10),payroll);for(const key of ['revenue','cost','totalExpenses','netProfit'] as const)r[key]+=daily[key];}
  return `${date}${end!==date?' — '+end:''} · tizimga kiritilgan ma’lumotlar\nSavdo: ${won(r.revenue)}\nTannarx: ${won(r.cost)}\nXarajat va ushlanmalar: ${won(r.totalExpenses)}\nHisoblangan foyda: ${won(r.netProfit)}\nBu bank qoldig‘i emas. Kiritilmagan savdo va xarajatlar hisobga olinmagan.`;
 }
 if(intent.kind==='supplier_products'){
  const query=mezanaNameKey(intent.query||intent.supplierName);
  const matches=rows(state.suppliers).filter(s=>intent.supplierId?s.id===intent.supplierId:query&&mezanaNameKey(s.name)===query);
  if(matches.length!==1)throw new AssistantError('Yetkazuvchi aniq topilmadi. To‘liq nomini yozing.');
  const from=intent.date?validDate(intent.date):'',to=intent.dateTo?validDate(intent.dateTo):from;
  if(from&&to&&from>to)throw new AssistantError('Boshlanish sanasi tugash sanasidan oldin bo‘lsin.');
  const list=supplierProducts(state,matches[0].id,from,to);
  if(!list.length)return `${matches[0].name} bo‘yicha ${from?'shu davrda':'bazada'} mahsulot tafsiloti topilmadi. Faqat summa bilan yozilgan xariddan mahsulot nomini aniqlab bo‘lmaydi. Yetkazuvchi → Kimdan nima olingan bo‘limini tekshiring.`;
  const shown=list.slice(0,100);
  return [`${matches[0].name} · olingan mahsulotlar`,from?`${from} — ${to}`:'Barcha sanalar',...shown.map((l,i)=>`${i+1}. ${l.date} · ${l.name} · ${l.quantity} ${l.unit}${l.amount===null?' · narx kiritilmagan':' · '+won(l.amount)}`),`Jami ${list.length} ta mahsulot qatori.${list.length>100?' Oxirgi 100 tasi ko‘rsatildi; qolganlari Yetkazib beruvchilar oynasida.':''}`,'Bu kirim ro‘yxati; hozirgi qarz yoki ombor qoldig‘i emas.'].join('\n');
 }
 if(intent.kind==='help')return 'HALO yordamchi bilan oddiy matnda yozing: “Bugungi hisobot”, “Shu oy hisobot”, “Nodir aka qarzi qancha?”, “Nodir akadan nima olingan?”, “Un qancha qoldi?”.\nOmbor kirimi: mahsulot, miqdor/birlik va jami narx. Masalan: “Omborga 2 kg un, jami 8000 von”. Qarz va to‘lov ombor kirimidan yaratilmaydi; yetkazib beruvchilar bo‘limida alohida yuritiladi.\nQarz to‘lovi: “Nodir akaga 10000 von Kassa hisobidan to‘ladim”. Avval natijani tekshirib Tasdiqlash bosing. Aniqlashtiruvchi savolga shu suhbatda javob bering.\nTuzatish: bog‘langan kirimni Xarid / kirim tarixidan bekor qilish; joriy qarzni Yetkazib beruvchilar oynasida sabab bilan tahrirlash. Hisobotni yuklab olish — Eksport bo‘limida, Telegramda /export. Hozir yordamchi matnli xarid va qarz to‘lovini saqlaydi; rasm/ovoz/fayldan kirim hali ulanmagan.';
 if(intent.kind==='ledger'){
  const query=mezanaNameKey(intent.query||intent.supplierName);
  const matches=rows(state.suppliers).filter(s=>query&&mezanaNameKey(s.name).includes(query)&&!/mezana/i.test(s.name));
  if(matches.length!==1)throw new AssistantError('Qaysi yetkazib beruvchi? Uning aniq nomini yozing.');
  const supplier=matches[0], ledger=supplierLedger(supplier,rows(state.transactions),rows(state.stockMovements),rows(state.inventory));
  const entries=ledger.entries.slice(-25);
  return [`${supplier.name} · oldi-berdi`,`Boshlang‘ich qoldiq: ${won(ledger.opening)}`,...entries.map(e=>`${e.date} · ${e.kind==='purchase'?'Xarid':e.kind==='payment'?'To‘lov':'Qoldiq tuzatishi'} ${won(e.amount)} · qoldiq ${won(e.balance)}${e.items.length?' · '+e.items.join(', '):e.note?' · '+e.note:''}`),`Hisoblangan joriy qoldiq: ${won(ledger.balance)}`,ledger.difference||ledger.incomplete?`Tarix bilan ko‘rsatilgan qoldiqni tekshiring. Farq: ${won(ledger.difference)}. Hech narsa o‘zgartirilmadi.`:'Manfiy qoldiq — avans. Qoldiq sana tartibida qayta hisoblangan.',ledger.entries.length>25?'Oxirgi 25 yozuv ko‘rsatildi. To‘liq tarix: Yetkazib beruvchilar → To‘liq oldi-berdi yoki Eksport.':''].filter(Boolean).join('\n');
 }
 if(intent.kind==='debts'){
  const all=rows(state.suppliers).filter(s=>!/mezana/i.test(s.name));
  const list=intent.query?all.filter(s=>mezanaNameKey(s.name).includes(mezanaNameKey(intent.query))):all;
  if(!list.length)return 'Yetkazuvchi topilmadi.';
  const audits=auditSupplierBalances(state.suppliers,state.transactions);
  return ['Yetkazuvchilar · joriy hisob',...list.map(s=>{const a=audits.find(a=>a.supplierId===s.id);return `${s.name}: ${Number(s.balance)<0?'avans ':''}${won(Math.abs(Number(s.balance)))}${!a?.valid||a.difference?' · tarix bilan farq bor':''}`;}),'MEZANA alohida hisobda.'].join('\n');
 }
 if(intent.kind==='stock'){
  const list=rows(state.inventory).filter(i=>!intent.query||mezanaNameKey(i.name).includes(mezanaNameKey(intent.query)));
  return list.length?['Ombor · joriy qoldiq',...list.map(i=>`${i.name}: ${i.stock} ${i.unit}${Number(i.stock)<=Number(i.minStock)?' · kam qolgan':''}`)].join('\n'):'Mahsulot topilmadi.';
 }
 return '';
}
