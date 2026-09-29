import { reserveDemand } from './reserve-demand.ts';
import { isExpenseOnlyInventory, VegetableExpenseError } from './vegetable-expenses.ts';
import { seoulCalendarDate } from './business-time.ts';
type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
const DAY = 86400000;
export const RESERVE_WINDOWS = [1, 3, 7, 15, 30] as const;
const changePct = (current: number, previous: number) => previous > 0 ? (current - previous) / previous * 100 : current === 0 ? 0 : null;
export function reserveUnit(input: unknown) {
  const u = String(input || '').trim().toLowerCase();
  if (['g', 'gr', 'gram', 'gramm'].includes(u)) return { unit: 'g', factor: 1 };
  if (u === 'kg') return { unit: 'g', factor: 1000 };
  if (u === 'ml') return { unit: 'litr', factor: .001 };
  if (['l', 'litr', 'liter'].includes(u)) return { unit: 'litr', factor: 1 };
  if (['dona', 'kalla'].includes(u)) return { unit: 'dona', factor: 1 };
  return { unit: u, factor: 1 }; // A box is never guessed to equal grams or pieces.
}
function validTime(value: unknown, now: string) {
  const at = String(value || now);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at)) || Date.parse(at) > Date.parse(now) + 60000) throw new VegetableExpenseError('Sana va vaqtni tekshiring. Kelajakdagi vaqt kiritilmaydi.');
  const date=at.slice(0,10);
  if(new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date)throw new VegetableExpenseError('Sana noto‘g‘ri.');
  return new Date(at).toISOString();
}
export function reservePurchaseMetadata(line: Row, date: string, now = new Date().toISOString()) {
  const result: Row = {};
  if (line.purchasedAt) {
    result.purchasedAt = validTime(line.purchasedAt, now);
    if (seoulCalendarDate(new Date(result.purchasedAt)) !== date) throw new VegetableExpenseError('Xarid sanasi va vaqti mos emas.');
  }
  if (line.remainingBeforePurchase !== undefined && line.remainingBeforePurchase !== null && line.remainingBeforePurchase !== '') {
    const n = Number(line.remainingBeforePurchase);
    if (typeof line.remainingBeforePurchase === 'boolean' || !Number.isFinite(n) || n < 0 || n > 1e9) throw new VegetableExpenseError('Xariddan oldingi qoldiqni tekshiring.');
    result.remainingBeforePurchase = n;
  }
  return result;
}
export function saveReserveCount(state: Row, input: Row, actor: string, now = new Date().toISOString()) {
  const item = rows(state.inventory).find(i => i.id === input.inventoryId && isExpenseOnlyInventory(i));
  if (!item) throw new VegetableExpenseError('Alohida zaxira mahsulotini tanlang.');
  const operationId = String(input.operationId || '');
  if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new VegetableExpenseError('Amal raqami noto‘g‘ri. Sahifani yangilang.');
  const value = Number(input.quantity), unit = reserveUnit(input.unit);
  if (input.quantity == null || typeof input.quantity === 'boolean' || String(input.quantity).trim() === '' || !Number.isFinite(value) || value < 0 || value > 1e9 || !unit.unit || unit.unit.length > 30) throw new VegetableExpenseError('Qoldiq va birligini tekshiring.');
  const at = validTime(input.countedAt, now), id = `reserve-count:${operationId}`;
  const count = { id, inventoryId: item.id, quantity: value * unit.factor, unit: unit.unit, countedAt: at, recordedAt: now, recordedBy: actor };
  const old = rows(state.purchaseReserveCounts).find(c => c.id === id);
  if (old) {
    if (old.inventoryId !== count.inventoryId || old.quantity !== count.quantity || old.unit !== count.unit || (input.countedAt && old.countedAt !== count.countedAt)) throw new VegetableExpenseError('Bu amal oldin boshqa qiymat bilan saqlangan. Yangilang.');
    return { state, result: { alreadySaved: true } };
  }
  return { state: { ...state, purchaseReserveCounts: [...rows(state.purchaseReserveCounts), count] }, result: { alreadySaved: false } };
}

/** Confirmed counts calibrate consumption. Selected menu quantities adjust an estimate only;
 * no stock transaction or recipe quantity is changed by this report. */
export function purchaseReserveReport(state: Row, now = new Date()) {
  const nowMs = now.getTime(), today = seoulCalendarDate(now);
  const dayStart = Date.parse(`${today}T00:00:00+09:00`);
  const inventory = rows(state.inventory).filter(i => isExpenseOnlyInventory(i) && !i.catalogArchived);
  const counts = rows(state.purchaseReserveCounts).filter(c => !c.cancelledAt && Number.isFinite(Date.parse(c.countedAt)) && Date.parse(c.countedAt) <= nowMs && Number.isFinite(Number(c.quantity)) && Number(c.quantity) >= 0);
  const purchases: Row[] = rows(state.vegetablePurchases).filter(p => !p.cancelledAt && p.date <= today).map((p): Row => {
    const unit = reserveUnit(p.unit), at = Date.parse(p.purchasedAt || `${p.date}T00:00:00+09:00`);
    return { ...p, unit: unit.unit, quantity: Number(p.quantity) * unit.factor, originalQuantity: p.quantity, originalUnit: p.unit,
      remainingBeforePurchase: p.remainingBeforePurchase == null ? null : Number(p.remainingBeforePurchase) * unit.factor, at };
  }).filter(p => Number.isFinite(p.at) && p.at <= nowMs && p.quantity > 0 && p.amount > 0);
  const leadDays = Number(state.purchaseReserveSettings?.leadDays ?? 1);
  const enabled = state.purchaseReserveSettings?.enabled !== false;
  const products: Row[] = [];
  for (const item of inventory) {
    const savedRecipeIds = state.purchaseReserveSettings?.recipeIdsByInventory?.[item.id];
    // A saved empty list is intentional. Otherwise honour existing recipe links without
    // rewriting recipes or inventing gram-based stock movements for a difficult ingredient.
    const recipeIds: string[]=Array.isArray(savedRecipeIds)?savedRecipeIds:rows(state.recipes).filter(r => rows(r.ingredients).some(i => i.inventoryId === item.id)).map(r => r.id);
    const demand=reserveDemand(state,now,recipeIds);
    const own = purchases.filter(p => p.inventoryId === item.id);
    const unitKeys = new Set([...own.map(p => p.unit), ...counts.filter(c => c.inventoryId === item.id).map(c => c.unit)]);
    if (!unitKeys.size) unitKeys.add(reserveUnit(item.packageName || item.unit || 'dona').unit);
    for (const unit of unitKeys) {
      const bought = own.filter(p => p.unit === unit).sort((a,b) => a.at-b.at || String(a.id).localeCompare(String(b.id)));
      // Several receipts at the same timestamp form one replenishment, not zero-day cycles.
      const byTime = new Map<number, Row>();
      for (const p of bought) {
        const b = byTime.get(p.at) || { at: p.at, quantity: 0, amount: 0, ids: [], remaining: null };
        b.quantity += p.quantity; b.amount += p.amount; b.ids.push(p.id);
        if (p.remainingBeforePurchase !== null) b.remaining = p.remainingBeforePurchase;
        byTime.set(p.at,b);
      }
      const batches = [...byTime.values()].sort((a,b)=>a.at-b.at);
      const allAnchors = [...batches.filter(b => b.remaining !== null).map(b => ({ at:b.at, quantity:b.remaining+b.quantity, id:b.ids.join(','), kind:'purchase' })),
        ...counts.filter(c => c.inventoryId === item.id && c.unit === unit).map(c => ({at:Date.parse(c.countedAt),quantity:Number(c.quantity),id:c.id,kind:'count'}))].sort((a,b)=>a.at-b.at || Number(a.kind==='count')-Number(b.kind==='count') || String(a.id).localeCompare(String(b.id)));
      const anchors=[...new Map(allAnchors.map(a=>[a.at,a])).values()];
      const confirmed: Row[] = [];
      let inconsistent = false;
      for(let i=1;i<anchors.length;i++) {
        const a=anchors[i-1], b=anchors[i], elapsed=(b.at-a.at)/DAY;
        if(elapsed<=0) continue;
        const received=batches.filter(p=>p.at>a.at && p.at<=b.at).reduce((sum,p)=>sum+p.quantity,0);
        const used=a.quantity+received-b.quantity;
        if(used < -1e-6) {inconsistent=true;continue;}
        confirmed.push({start:a.at,end:b.at,days:elapsed,quantity:Math.max(0,used)});
      }
      const cadence=batches.slice(1).map((b,i)=>({start:batches[i].at,end:b.at,days:(b.at-batches[i].at)/DAY,quantity:batches[i].quantity,amount:batches[i].amount})).filter(c=>c.days>0);
      const windows=RESERVE_WINDOWS.map(days=>{
        const since=dayStart-(days-1)*DAY;
        const inWindow=bought.filter(p=>p.at>=since);
        // Compare completed, equally long periods. An unfinished today must never be
        // presented as a decline against a complete previous day/week/month.
        const completeStart=dayStart-days*DAY, previousStart=completeStart-days*DAY;
        const complete=bought.filter(p=>p.at>=completeStart && p.at<dayStart);
        const previous=bought.filter(p=>p.at>=previousStart && p.at<completeStart);
        const sum=(list:Row[],key:string)=>list.reduce((total,p)=>total+Number(p[key]),0);
        const quantity=sum(complete,'quantity'), amount=sum(complete,'amount'), previousQuantity=sum(previous,'quantity'), previousAmount=sum(previous,'amount');
        const baselineMs=Date.parse(state.vegetableExpenseStartedAt || '');
        const comparable=!Number.isFinite(baselineMs) || baselineMs<=previousStart;
        const closedPeriod={start:seoulCalendarDate(new Date(completeStart)),end:seoulCalendarDate(new Date(dayStart-DAY)),quantity,amount,previousQuantity,previousAmount,comparable,
          quantityChangePct:comparable?changePct(quantity,previousQuantity):null,amountChangePct:comparable?changePct(amount,previousAmount):null};
        const measured=confirmed.filter(c=>c.end>=since), intervals=measured.length?measured:cadence.filter(c=>c.end>=since);
        const observedDays=intervals.reduce((sum,c)=>sum+c.days,0);
        return {days,start:seoulCalendarDate(new Date(since)),purchaseCount:inWindow.length,quantity:inWindow.reduce((sum,p)=>sum+p.quantity,0),amount:inWindow.reduce((sum,p)=>sum+Number(p.amount),0),
          rate:observedDays?intervals.reduce((sum,c)=>sum+c.quantity,0)/observedDays:null,observedDays,samples:intervals.length,basis:measured.length?'measured':'cadence',closedPeriod};
      });
      // Use a recent complete 7-day view, falling back to 30 days when sparse.
      const recent=windows.find(w=>w.days===7)!, monthly=windows.find(w=>w.days===30)!;
      const model=recent.basis==='measured' && recent.samples>=2?recent:monthly.basis==='measured'?monthly:recent.samples>=2?recent:monthly;
      const baseRate=model.rate;
      const training=confirmed.filter(c=>c.end>=dayStart-29*DAY && c.days>=1);
      const trainingDays=training.reduce((sum,c)=>sum+c.days,0);
      const trainingPortions=training.reduce((sum,c)=>sum+demand.portionsBetween(c.start,c.end),0);
      const trainingSalesDays=training.reduce((sum,c)=>sum+demand.salesDaysBetween(c.start,c.end),0);
      const perPortion=trainingDays>=3 && trainingPortions>0 && trainingSalesDays>=2?training.reduce((sum,c)=>sum+c.quantity,0)/trainingPortions:null;
      const rawFactor=baseRate!==null && baseRate>0 && perPortion!==null && demand.expectedDaily!==null ? perPortion*demand.expectedDaily/baseRate : 1;
      const salesAdjusted=perPortion!==null && baseRate!==null && baseRate>0 && demand.expectedDaily!==null;
      const demandFactor=salesAdjusted?Math.max(0,Math.min(3,rawFactor)):1;
      const rate=baseRate===null?null:baseRate*demandFactor;
      const latest=batches.at(-1), anchor=anchors.at(-1);
      let estimatedRemaining: number|null=null, startingQuantity: number|null=null, anchorAt: number|null=null;
      if(anchor) {anchorAt=anchor.at;startingQuantity=anchor.quantity+batches.filter(p=>p.at>anchor.at).reduce((sum,p)=>sum+p.quantity,0);}
      else if(latest) {anchorAt=latest.at;startingQuantity=latest.quantity;}
      if(startingQuantity!==null && anchorAt!==null && rate!==null) estimatedRemaining=Math.max(0,startingQuantity-(salesAdjusted ? perPortion!*demand.portionsBetween(anchorAt,nowMs) : rate*(nowMs-anchorAt)/DAY));
      else if(anchor?.at===nowMs || (anchor?.quantity===0 && !batches.some(p=>p.at>anchor.at))) estimatedRemaining=anchor.quantity;
      const daysLeft=rate!==null && rate>0 && estimatedRemaining!==null?estimatedRemaining/rate:null;
      const latestUnitPrice=latest?latest.amount/latest.quantity:null;
      const previous=batches.at(-2), previousPrice=previous?previous.amount/previous.quantity:null;
      const priceChangePct=latestUnitPrice!==null && previousPrice?100*(latestUnitPrice-previousPrice)/previousPrice:null;
      const depletionAt=daysLeft===null?null:new Date(nowMs+daysLeft*DAY).toISOString();
      const lastCycle=cadence.at(-1);
      const empty=Boolean(anchor && anchor.quantity===0 && !batches.some(p=>p.at>anchor.at));
      products.push({key:`${item.id}:${unit}`,inventoryId:item.id,name:item.name,unit,mixedUnits:unitKeys.size>1,windows,rate,baseRate,salesAdjusted,demandFactor,perPortion,recipeIds,demand:{windows:demand.windows,expectedDaily:demand.expectedDaily,todayPortions:demand.todayPortions},basis:model.basis,samples:model.samples,observedDays:model.observedDays,modelDays:model.days,
        confidence:model.basis==='measured' && model.samples>=2?'medium':'low',inconsistent,estimatedRemaining,daysLeft,depletionAt,empty,
        estimateMode:salesAdjusted?'learned_menu':model.basis==='measured'?'measured_time':'purchase_cadence',
        confirmedIntervals:confirmed.length,confirmedUsed:confirmed.reduce((total,c)=>total+c.quantity,0),
        balanceBasis:anchor?'count':'last_purchase',lastConfirmed:anchor?{quantity:anchor.quantity,at:new Date(anchor.at).toISOString()}:null,
        latest:latest?{quantity:latest.quantity,amount:latest.amount,at:new Date(latest.at).toISOString(),unitPrice:latestUnitPrice}:null,
        latestBatchDays:rate!==null && rate>0 && latest?latest.quantity/rate:null,
        estimatedDailyCost:rate!==null && latestUnitPrice!==null?rate*latestUnitPrice:null,priceChangePct,
        lastCycle:lastCycle?{days:lastCycle.days,quantity:lastCycle.quantity,amount:lastCycle.amount,dailyAmount:lastCycle.amount/lastCycle.days}:null,
        reminder:enabled && (empty || (daysLeft!==null && daysLeft<=leadDays)),
        sourceId:latest?.ids.join(',')||anchor?.id||'none',
        history:bought.slice().reverse().map(p=>({id:p.id,date:p.date,purchasedAt:p.purchasedAt||null,quantity:p.originalQuantity,unit:p.originalUnit,amount:p.amount,supplierName:p.supplierName,recordedBy:p.recordedBy}))});
    }
  }
  // Historical spending must remain visible after a product is archived or its mode changes.
  return {asOf:now.toISOString(),leadDays,enabled,recipes:rows(state.recipes).map(r=>({id:r.id,name:r.name})),products,windows:RESERVE_WINDOWS.map(days=>({days,amount:purchases.filter(p=>p.at>=dayStart-(days-1)*DAY).reduce((sum,p)=>sum+Number(p.amount),0)}))};
}

export function saveReserveRecipes(state:Row,input:Row) {
 const item=rows(state.inventory).find(i=>i.id===input.inventoryId && isExpenseOnlyInventory(i));
 if(!item || !Array.isArray(input.recipeIds) || input.recipeIds.length>1000 || input.recipeIds.some((id:unknown)=>typeof id!=='string'||!rows(state.recipes).some(r=>r.id===id)))throw new VegetableExpenseError('Mahsulot va menyularni tekshiring.');
 return {state:{...state,purchaseReserveSettings:{...state.purchaseReserveSettings,recipeIdsByInventory:{...state.purchaseReserveSettings?.recipeIdsByInventory,[item.id]:[...new Set(input.recipeIds)]}}},result:{saved:true}};
}
