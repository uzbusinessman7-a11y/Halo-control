import { purchaseReserveReport } from './purchase-reserve.ts';
import { seoulCalendarDate, seoulClock } from './business-time.ts';
import { inventoryTelegramStatus } from './inventory-notifications.ts';
import { mutateHaloState, readHaloState } from './halo-store.ts';
type Row = Record<string, any>;
const rows=(v:unknown):Row[]=>Array.isArray(v)?v:[];
export function purchaseReserveJobs(state: Row, now = new Date()) {
  if(seoulClock(now)<'09:00' || seoulClock(now)>='21:00') return [];
  const sent = new Set(rows(state.purchaseReserveNotifications).filter(n=>n.status==='sent').map(n=>n.id));
  const report = purchaseReserveReport(state,now);
  return report.products.filter(p=>p.reminder).map(p=>({
    id:`reserve:${seoulCalendarDate(now)}:${p.key}:${p.sourceId}`,
    text:`HALO · Zaxirani tekshiring\n${p.name} · ${p.unit}\n${p.empty?'Siz kiritgan oxirgi qoldiq: 0.':`Taxminiy qoldiq: ${Number(p.estimatedRemaining).toLocaleString('en-US',{maximumFractionDigits:2})} ${p.unit}\nTaxminan ${Number(p.daysLeft).toFixed(1)} kunlik.`}\n${p.basis==='measured'?'Qoldiq qaydlari va xaridlarga asoslangan.':'Xaridlar oralig‘iga asoslangan taxmin; haqiqiy qoldiq tasdiqlanmagan.'}\nZaxirani ko‘rib, yangi xarid yoki qolgan miqdorni kiriting. ${p.salesAdjusted?'Faqat tanlangan menyular soniga moslashtirilgan prognoz.':'Savdoga moslashish uchun qoldiq qaydlari yetarli emas.'} Haqiqiy qoldiq avtomatik o‘zgarmaydi.`
  })).filter(job=>!sent.has(job.id));
}
export async function dispatchPurchaseReserveNotifications(branchId = 'main', now = new Date()) {
  const {state}=await readHaloState(branchId);
  const jobs=purchaseReserveJobs(state,now).slice(0,3);
  if(!jobs.length)return {status:'not_due',sent:0};
  const settings=await inventoryTelegramStatus(branchId);
  if(!settings)return {status:'telegram_not_connected',sent:0};
  let sent=0;
  for(const job of jobs){
    const claimId=crypto.randomUUID();
    const claimed=await mutateHaloState(current=>{
      // Re-evaluate after races with new purchases, counts or a disabled reminder.
      if(!purchaseReserveJobs(current,now).some(j=>j.id===job.id))return {state:current,result:false};
      const notices=rows(current.purchaseReserveNotifications), old=notices.find(n=>n.id===job.id);
      if(old?.status==='sending' && now.getTime()-Date.parse(old.at)<120000)return {state:current,result:false};
      return {state:{...current,purchaseReserveNotifications:[...notices.filter(n=>n.id!==job.id),{id:job.id,claimId,status:'sending',at:now.toISOString()}]},result:true};
    },5,branchId,'Tizim','Zaxira eslatmasi tayyorlandi','Sabzavot va sous');
    if(!claimed.result)continue;
    let status='failed';
    try{
      const response=await fetch(`https://api.telegram.org/bot${settings.bot_token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:settings.chat_id,text:`${job.text}\nFilial: ${branchId}`}),signal:AbortSignal.timeout(5000)});
      if(response.ok && (await response.json() as {ok?:boolean}).ok){status='sent';sent++;}
    }catch{/* Next authenticated scheduled sync retries without changing the stock. */}
    await mutateHaloState(current=>({state:{...current,purchaseReserveNotifications:rows(current.purchaseReserveNotifications).map(n=>n.id===job.id&&n.claimId===claimId?{...n,status,at:now.toISOString()}:n)},result:true}),5,branchId,'Tizim',status==='sent'?'Zaxira eslatmasi yuborildi':'Zaxira eslatmasi qayta yuboriladi','Sabzavot va sous');
  }
  return {status:'processed',sent};
}
