import { seoulCalendarDate } from './business-time.ts';
type Row=Record<string,any>;
const DAY=86400000;
/** Selected menu portions are a demand proxy, never an inventory transaction. Date-only sales
 * are distributed across the calendar day for interval calibration. */
export function reserveDemand(state:Row, now:Date, recipeIds:string[] = []) {
 const selected=new Set(recipeIds);
 const todayStart=Date.parse(`${seoulCalendarDate(now)}T00:00:00+09:00`);
 const cancelled=new Set((state.posOrders||[]).filter((o:Row)=>o.status==='cancelled').map((o:Row)=>o.id));
 const daily=new Map<number,number>();
 const seen=new Set<string>();
 for(const s of state.sales||[]) {
  if(!selected.has(s.recipeId)||s.voided||s.cancelledAt||s.status==='cancelled'||cancelled.has(s.posOrderId))continue;
  if(s.id && seen.has(String(s.id)))continue;
  const raw=String(s.date||s.soldAt||''), date=raw.length===10?raw:Number.isFinite(Date.parse(raw))?seoulCalendarDate(new Date(raw)):'';
  const at=Date.parse(`${date}T00:00:00+09:00`), amount=Number(s.quantity);
  if(!Number.isFinite(at)||at>todayStart||!Number.isFinite(amount)||amount<0)continue;
  if(s.id)seen.add(String(s.id));
  daily.set(at,(daily.get(at)||0)+amount);
 }
 const sorted=[...daily].sort((a,b)=>a[0]-b[0]);
 const first=sorted[0]?.[0]??todayStart;
 const portionsBetween=(start:number,end:number)=>sorted.reduce((sum,[at,amount])=>{
  const dayEnd=at===todayStart?Math.max(at+1,now.getTime()):at+DAY;
  return sum+amount*Math.max(0,Math.min(end,dayEnd)-Math.max(start,at))/(dayEnd-at);
 },0);
 const salesDaysBetween=(start:number,end:number)=>sorted.filter(([at,amount])=>amount>0 && at<end && at+DAY>start).length;
 const windows=[1,3,7,15,30].map(days=>{
  const start=todayStart-days*DAY, availableDays=Math.max(0,(todayStart-Math.max(start,first))/DAY);
  const amount=portionsBetween(start,todayStart);
  return {days,amount,availableDays,average:availableDays?amount/availableDays:null,recordedDays:salesDaysBetween(start,todayStart)};
 });
 // Yesterday 20%, previous 3 days 50%, previous 7 days 30%.
 // Today is incomplete; use it for balance estimates, not next-day projection.
 const active=windows.slice(0,3).map((w,i)=>({...w,weight:[.2,.5,.3][i]})).filter(w=>w.average!==null);
 const expectedDaily=active.length?active.reduce((sum,w)=>sum+w.average!*w.weight,0)/active.reduce((sum,w)=>sum+w.weight,0):null;
 return {windows,expectedDaily,portionsBetween,salesDaysBetween,todayPortions:daily.get(todayStart)||0};
}
