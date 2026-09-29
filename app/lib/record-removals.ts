import { applyWarehouseRecord, warehouseDocuments, warehouseFingerprint } from './warehouse-records.ts';
import { cancelSupplierTransaction } from './supplier-cancellation.ts';
import { supplierSourceDocument } from './supplier-source.ts';
import { rebalanceSuppliers } from './supplier-transactions.ts';
import { archiveStockMovement } from './inventory-deletions.ts';
import { createDeletedItem } from './deleted-items.ts';
import { isAccountingMonthClosed } from './month-end.ts';
import { applyVegetablePurchaseAccounting } from './vegetable-expenses.ts';
import { syncMezanaPosting } from './mezana-posting.ts';
import { applySaleInventoryAccounting } from './inventory-accounting.ts';
import { calculateAccountBalances } from './account-balances.ts';
import { selectActiveFinancialEntries } from './daily-report.ts';
import { receiptCostsForInventory, bypassRemovedReceiptCost } from './stock-movements.ts';
import { hasNegativeMezanaBorrowedQuantity, mezanaDebtBalance } from './mezana-debts.ts';

type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
export type RemovalTarget = { kind: 'warehouse'|'vegetable'|'transaction'|'finance'|'mezana'|'reserveCount'|'stockMovement'|'sale'|'purchaseOrder'; id: string; label?: string };
export class RecordRemovalError extends Error { status = 409; }
const fail = (message: string): never => { throw new RecordRemovalError(message); };
const find = (state: Row, key: string, id: string): Row => {
  const matches = rows(state[key]).filter(r => r.id === id);
  if (matches.length !== 1) return fail('Yozuv topilmadi yoki oldin olib tashlangan. Ro‘yxatni yangilang.');
  return matches[0];
};
const openMonth = (state: Row, date: string) => {
  if (isAccountingMonthClosed(state.monthlyCloses, date)) fail('Bu oy yopilgan. Avval oy hisobotini qayta oching; yopilgan hisob o‘zgartirilmadi.');
};
const archive = (state: Row, kind: Parameters<typeof createDeletedItem>[0]['kind'], record: Row, reason: string, now: string, related?: Row) =>
  [createDeletedItem({ kind, entityId: record.id, label: String(record.name || record.note || record.productName || record.id).slice(0,180), section: 'Olib tashlanganlar', record, reason, now: new Date(now), related }), ...rows(state.deletedItems)];

/** A server-issued snapshot guards all dependencies, not just the clicked row. */
export async function removalFingerprint(state: Row) {
  const bytes = new TextEncoder().encode(warehouseFingerprint(state));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
}

function removePayment(state: Row, tx: Row, reason: string, now: string): Row {
  openMonth(state, tx.date);
  const supplier = find(state, 'suppliers', tx.supplierId);
  if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0) fail('To‘lov summasi noto‘g‘ri. Hech narsa o‘zgarmadi.');
  let finances = rows(state.financialEntries).filter(e => e.transactionId === tx.id);
  if (!finances.length) finances = rows(state.financialEntries).filter(e => !e.transactionId && e.type === 'expense' && e.category === 'Mahsulot xaridi' && e.date === tx.date && e.amount === tx.amount && String(e.note || '').includes(supplier.name));
  if (finances.length > 1 || finances.some(e => e.amount !== tx.amount || e.reversedEntryId || e.cancelledAt) || rows(state.financialEntries).some(e => finances.some(f => f.id === e.reversedEntryId))) fail('To‘lovning pul yozuvi bir xil emas. Bog‘lanishni tekshiring; hech narsa o‘zgarmadi.');
  finances.forEach(e => openMonth(state, e.date));
  const suppliers = rebalanceSuppliers(rows(state.suppliers) as any, tx as any, null);
  if (!suppliers) fail('Yetkazib beruvchi qarzi hisoblanmadi.');
  return { ...state, suppliers,
    transactions: rows(state.transactions).filter(t => t.id !== tx.id).map(t => t.id === tx.intakeId ? { ...t, intakePaidAmount: rows(state.transactions).filter(p => p.id !== tx.id && p.intakeId === t.id && p.type === 'payment').reduce((n,p)=>n+p.amount,0) } : t),
    financialEntries: rows(state.financialEntries).filter(e => !finances.some(f => f.id === e.id)),
    supplierDeliveries: rows(state.supplierDeliveries).map(d => d.paymentTransactionId === tx.id ? { ...d, paymentTransactionId: '', paymentStatus: 'unpaid', paidAmount: 0 } : d),
    purchaseOrders: rows(state.purchaseOrders).map(o => tx.id === `purchase-order-payment:${o.id}` ? { ...o, status: o.status === 'cancelled' ? 'cancelled' : 'received', paidAt: '', accountId: '' } : o),
    deletedItems: archive(state, 'transaction', tx, reason, now, { financialEntry: finances[0], paymentOnly: true }) };
}

function removeOrder(state: Row, order: Row, reason: string, now: string): Row {
  if (order.status === 'cancelled') fail('Buyurtma oldin olib tashlangan.');
  openMonth(state, order.date || String(order.createdAt).slice(0,10));
  const movements = rows(state.stockMovements).filter(m => m.referenceId === order.id);
  movements.forEach(m => openMonth(state, m.date));
  const tx = rows(state.transactions).find(t => t.id === `purchase-order-purchase:${order.id}`);
  if (tx) openMonth(state, tx.date);
  if (['received','paid'].includes(order.status) && (!tx || !movements.length)) fail('Buyurtmaning kirimi yoki qarz bog‘lanishi topilmadi. Asl hujjatni tekshiring.');
  const affected = new Set(movements.map(m => m.inventoryId));
  let remaining = rows(state.stockMovements).filter(m => m.referenceId !== order.id);
  for (const m of movements) remaining = bypassRemovedReceiptCost(remaining as any, m as any);
  const inventory:Row[] = rows(state.inventory).map(i => ({ ...i, stock: Number(i.stock) - movements.filter(m => m.inventoryId === i.id).reduce((n,m)=>n+Number(m.quantity),0) }));
  for (const m of movements) if (!inventory.some(i => i.id === m.inventoryId)) fail('Bog‘langan ombor mahsulotini avval tiklang.');
  for (const i of inventory) if (affected.has(i.id) && i.stock < -0.000001 && i.stock < Number(find(state,'inventory',i.id).stock)) fail('Bu kirim sarflangan. Qoldiq kirimni qaytarishga yetmaydi.');
  return { ...state, inventory: receiptCostsForInventory(inventory as any,remaining as any,Object.fromEntries(movements.map(m=>[m.inventoryId,m.previousUnitCost])),affected),
    stockMovements: remaining, transactions: rows(state.transactions).filter(t=>t.id!==tx?.id),
    suppliers: tx ? rebalanceSuppliers(rows(state.suppliers) as any,tx as any,null) : state.suppliers,
    purchaseOrders: rows(state.purchaseOrders).map(o=>o.id===order.id?{...o,status:'cancelled',cancelReason:reason,cancelledAt:now,cancelledBy:'Rahbar'}:o),
    deletedItems: tx ? archive(state,'transaction',tx,reason,now,{movements,purchaseOrder:order}) : state.deletedItems };
}

function removeSale(state: Row, sale: Row, reason: string, now: string): Row {
  const order = rows(state.posOrders).find(o => o.id === sale.posOrderId || rows(o.items).some(i=>i.saleId===sale.id));
  const selected = rows(state.sales).filter(s => order ? s.posOrderId===order.id || rows(order.items).some(i=>i.saleId===s.id) : sale.deliveryBatchId ? s.deliveryBatchId===sale.deliveryBatchId : s.id===sale.id);
  const ids = new Set(selected.map(s=>s.id));
  selected.forEach(s=>openMonth(state,s.date));
  if (rows(state.posRefunds).some(r=>r.orderId===order?.id || ids.has(r.saleId))) fail('Bu savdoda qaytaruv bor. Avval qaytaruv yozuvini tekshiring.');
  const movements = rows(state.stockMovements).filter(m=>ids.has(m.referenceId));
  const restore = new Map<string,number>();
  for (const s of selected) {
    const ms = movements.filter(m=>m.referenceId===s.id);
    if (ms.length) ms.forEach(m=>restore.set(m.inventoryId,(restore.get(m.inventoryId)||0)-Number(m.quantity)));
    else {
      if (!Array.isArray(s.stockUsage)) fail('Bu eski savdoning ombor sarfi saqlanmagan. Hozirgi retseptdan taxmin qilib qaytarib bo‘lmaydi.');
      s.stockUsage.forEach((u:Row)=>restore.set(u.inventoryId,(restore.get(u.inventoryId)||0)+Number(u.deductedQuantity ?? (u.expenseOnlyAtSale?0:u.quantity))));
    }
  }
  for (const id of restore.keys()) find(state,'inventory',id);
  let deletedItems = rows(state.deletedItems);
  for (const s of selected) deletedItems = archive({...state,deletedItems},'sale',s,reason,now,{movements:movements.filter(m=>m.referenceId===s.id),posOrder:order});
  return {...state, sales:rows(state.sales).filter(s=>!ids.has(s.id)), stockMovements:rows(state.stockMovements).filter(m=>!ids.has(m.referenceId)),
    inventory:rows(state.inventory).map(i=>({...i,stock:Number(i.stock)+(restore.get(i.id)||0)})),
    posOrders:rows(state.posOrders).filter(o=>o.id!==order?.id), deletedItems};
}

/** Changes one source document; linked projections are never independently deleted. */
function removeRaw(state: Row, target: RemovalTarget, reason: string, operationId: string, now: string, depth=0): { state:Row; description:string } {
  if (depth>6) return fail('Manba bog‘lanishi takrorlangan. Hech narsa o‘zgarmadi.');
  const go=(kind:RemovalTarget['kind'],id:string)=>removeRaw(state,{kind,id},reason,operationId,now,depth+1);
  if(target.kind==='vegetable') { const p=find(state,'vegetablePurchases',target.id); if(p.cancelledAt)fail('Xarid oldin olib tashlangan.');return go('warehouse',p.movementId); }
  if(target.kind==='warehouse') {
    const d=warehouseDocuments(state).find(d=>d.id===target.id||d.movements.some(m=>m.id===target.id));
    if(!d)return fail('Kirim topilmadi yoki oldin olib tashlangan.');
    if(d.kind==='linked') {
      const m=d.movements[0];
      if(m?.mezanaEntryId || rows(state.mezanaEntries).some(e=>e.id===m?.referenceId))return go('mezana',m.mezanaEntryId||m.referenceId);
      if(rows(state.purchaseOrders).some(o=>o.id===m?.referenceId))return go('purchaseOrder',m.referenceId);
      // Legacy explicit supplier receipt: remove exactly linked rows and the purchase together.
      const tx=rows(state.transactions).find(t=>t.id===(m?.transactionId||m?.referenceId));
      if(tx?.type==='purchase'&&!tx.intakeLines) {
        const ms=rows(state.stockMovements).filter(v=>v.transactionId===tx.id||v.referenceId===tx.id);
        let next=state;
        for(const receipt of ms) { const cleared={...receipt};delete cleared.referenceId;delete cleared.transactionId;
          next=archiveStockMovement({...next,stockMovements:rows(next.stockMovements).map(v=>v.id===receipt.id?cleared:v)},receipt.id,reason).state;
          next={...next,deletedItems:rows(next.deletedItems).map(a=>a.kind==='stockMovement'&&a.entityId===receipt.id?{...a,record:receipt}:a)};
        }
        next=cancelSupplierTransaction(next,{id:tx.id,operationId,reason,expectedTransaction:tx,expectedBalance:find(next,'suppliers',tx.supplierId).balance},new Date(now)).state;
        return {state:next,description:'Kirim va unga bog‘langan xarid qarzi birga olib tashlanadi.'};
      }
      return fail('Bu eski kirimning manba hujjati to‘liq topilmadi. Bog‘lanish aniqlanmaguncha hisob o‘zgartirilmaydi.');
    }
    return {state:applyWarehouseRecord(state,{id:d.id,expected:d.fingerprint,action:'cancel',operationId,reason},now).state,
      description:d.kind==='intake'?'Butun kirim hujjati va shu hujjat bilan kiritilgan to‘lovlar olib tashlanadi.':d.kind==='delivery'?'Kirim va bog‘langan qarz olib tashlanadi. Alohida to‘langan pul yetkazuvchidagi avans bo‘lib qoladi.':'Kirim va unga bog‘langan sarf hisobdan chiqariladi. Alohida qarz yozuvi o‘zgarmaydi.'};
  }
  if(target.kind==='transaction') {
    const tx=find(state,'transactions',target.id);
    if(tx.type==='payment')return {state:removePayment(state,tx,reason,now),description:'Faqat to‘lov olib tashlanadi: qarz qayta oshadi, bog‘langan pul chiqimi bekor bo‘ladi. Mahsulot kirimi saqlanadi.'};
    const order=rows(state.purchaseOrders).find(o=>tx.id===`purchase-order-purchase:${o.id}`);if(order)return go('purchaseOrder',order.id);
    const source=supplierSourceDocument(state,tx);if(source)return go('warehouse',source);
    return {state:cancelSupplierTransaction(state,{id:tx.id,operationId,reason,expectedTransaction:tx,expectedBalance:find(state,'suppliers',tx.supplierId).balance},new Date(now)).state,description:'Tanlangan qarz yozuvi olib tashlanadi. Omborga alohida kiritilgan mahsulot o‘zgarmaydi.'};
  }
  if(target.kind==='finance') {
    const e=find(state,'financialEntries',target.id);
    if(e.cancelledAt||e.reversedEntryId||rows(state.financialEntries).some(r=>r.reversedEntryId===e.id))return fail('Yozuv oldin olib tashlangan.');
    if(e.transactionId)return go('transaction',e.transactionId);
    const p=rows(state.vegetablePurchases).find(p=>p.expenseId===e.id);if(p)return go('vegetable',p.id);
    if(e.mezanaEntryId)return go('mezana',e.mezanaEntryId);
    if(e.intakeId)return go('warehouse',e.intakeId);
    openMonth(state,e.date);
    const reversalId=`record-reversal:${operationId}`;
    const reversal={...e,id:reversalId,type:e.type==='transfer'?'transfer':e.type==='expense'?'income':'expense',accountId:e.type==='transfer'?e.toAccountId:e.accountId,toAccountId:e.type==='transfer'?e.accountId:undefined,reversedEntryId:e.id,cancellationReason:reason,cancelledAt:now,cancelledBy:'Rahbar',fixedExpenseId:undefined,fixedExpenseDueDate:undefined,oilFlowType:undefined,oilCanCount:undefined,oilLiters:undefined,oilUnitAmount:undefined,note:`BEKOR QILINDI · ${e.note||e.category}`};
    let next:Row={...state,financialEntries:[reversal,...rows(state.financialEntries)]};
    if(e.payrollPaymentId){const payment=find(state,'payrollPayments',e.payrollPaymentId);if(payment.voided||payment.financialEntryId!==e.id||payment.amount!==e.amount)fail('Maosh to‘lovi bog‘lanishini tekshiring.');next={...next,payrollPayments:rows(state.payrollPayments).map(p=>p.id===payment.id?{...p,voided:true,reversalEntryId:reversalId,updatedAt:now,voidReason:reason,voidedAt:now,voidedBy:'Rahbar'}:p)};}
    return {state:next,description:e.payrollPaymentId?'Maosh to‘lovi bekor qilinadi: pul qaytadi va xodimga to‘lanmagan qoldiq qayta oshadi.':'Pul yozuvining ta’siri bekor qilinadi. Asl yozuv va sababi tarixda qoladi.'};
  }
  if(target.kind==='mezana') {
    const e=find(state,'mezanaEntries',target.id);openMonth(state,e.date);
    const entries=rows(state.mezanaEntries).filter(r=>r.id!==e.id);
    if(hasNegativeMezanaBorrowedQuantity(entries as any)||mezanaDebtBalance(entries as any)<0)fail('Bu yozuvga qaytarish yoki to‘lov bog‘langan. Avval o‘sha yozuvni tekshiring.');
    return {state:{...state,mezanaEntries:entries,deletedItems:archive(state,'mezanaEntry',e,reason,now)},description:'MEZANA yozuvi va unga bog‘langan ombor yoki xarajat ta’siri birga bekor qilinadi.'};
  }
  if(target.kind==='reserveCount') {const c=find(state,'purchaseReserveCounts',target.id);if(c.cancelledAt)fail('Sanoq oldin olib tashlangan.');return {state:{...state,purchaseReserveCounts:rows(state.purchaseReserveCounts).map(r=>r.id===c.id?{...r,cancelledAt:now,cancelledBy:'Rahbar',cancellationReason:reason}:r)},description:'Noto‘g‘ri sanoq prognozdan chiqariladi va taxmin qayta hisoblanadi. Pul hisobi o‘zgarmaydi.'};}
  if(target.kind==='purchaseOrder')return {state:removeOrder(state,find(state,'purchaseOrders',target.id),reason,now),description:'Buyurtma, kirim va xarid qarzi bekor qilinadi. Haqiqiy to‘lov saqlanib, avans sifatida qoladi.'};
  if(target.kind==='stockMovement') {const m=find(state,'stockMovements',target.id);if(m.type==='receipt')return go('warehouse',m.id);if(m.type==='sale')return go('sale',m.referenceId);if(m.mezanaEntryId)return go('mezana',m.mezanaEntryId);return {state:archiveStockMovement(state,m.id,reason).state,description:'Ombor harakati teskari hisoblanadi. Asl yozuv tarixda qoladi.'};}
  if(target.kind==='sale')return {state:removeSale(state,find(state,'sales',target.id),reason,now),description:'Buyurtmaning savdosi, tannarxi va ushlanmalari hisobdan chiqariladi. Faqat haqiqatan ayirilgan mahsulot omborga qaytadi.'};
  return fail('Yozuv turini tekshiring.');
}

export function removalEffects(before:Row,after:Row) {
  const changes:Row[]=[];
  for(const item of rows(before.inventory)){const next=rows(after.inventory).find(i=>i.id===item.id);if(next&&Number(next.stock)!==Number(item.stock))changes.push({label:`Ombor · ${item.name}`,before:Number(item.stock),after:Number(next.stock),unit:item.unit});}
  for(const s of rows(before.suppliers)){const n=rows(after.suppliers).find(r=>r.id===s.id);if(n&&n.balance!==s.balance)changes.push({label:`Qarz · ${s.name}`,before:s.balance,after:n.balance,unit:'₩'});}
  const a=calculateAccountBalances(before,'9999-12-31'),b=calculateAccountBalances(after,'9999-12-31');
  for(const [id,value]of a.balances)if(b.balances.get(id)!==value)changes.push({label:`Pul · ${rows(before.accounts).find(a=>a.id===id)?.name||id}`,before:value,after:b.balances.get(id),unit:'₩'});
  const totals=(s:Row)=>({sales:rows(s.sales).reduce((n,r)=>n+Number(r.totalRevenue),0),expense:selectActiveFinancialEntries(rows(s.financialEntries)).filter(e=>e.affectsProfit&&e.type==='expense').reduce((n,e)=>n+Number(e.amount),0)});
  const x=totals(before),y=totals(after);
  if(x.sales!==y.sales)changes.push({label:'Jami savdo',before:x.sales,after:y.sales,unit:'₩'});
  if(x.expense!==y.expense)changes.push({label:'Hisobiy xarajat',before:x.expense,after:y.expense,unit:'₩'});
  return changes;
}

/** The store runs these same posting functions exactly once when committing. */
export function projectRemoval(state:Row,target:RemovalTarget,reason:string,operationId:string,now=new Date().toISOString()) {
  const raw=removeRaw(state,target,reason,operationId,now);
  const projected=applySaleInventoryAccounting(state,applyVegetablePurchaseAccounting(state,syncMezanaPosting(state,raw.state),'Rahbar',now),now);
  return {...raw,projected,effects:removalEffects(state,projected)};
}
export async function applyRecordRemoval(state:Row,input:Row,now=new Date().toISOString()) {
  const reason=String(input.reason||'').trim(),operationId=String(input.operationId||'');
  if(reason.length<3||reason.length>300||!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId))fail('Olib tashlash sababini yozing (3–300 belgi).');
  const request=warehouseFingerprint({kind:input.kind,id:input.id,reason,expected:input.expected});
  const old=rows(state.recordRemovals).find(r=>r.operationId===operationId);
  if(old){if(old.request!==request)fail('Bu amal boshqa yozuv bilan saqlangan. Oynani qayta oching.');return {state,result:{alreadySaved:true,effects:old.effects}};}
  if(input.expected!==await removalFingerprint(state))fail('Hisob boshqa oynada yangilandi. Olib tashlashdan oldin yangi natijani tekshiring.');
  const result=projectRemoval(state,input as RemovalTarget,reason,operationId,now);
  const changedKeys=['transactions','stockMovements','financialEntries','sales','mezanaEntries','purchaseReserveCounts','purchaseOrders','payrollPayments','posOrders'];
  const originals=Object.fromEntries(changedKeys.map(key=>[key,rows(state[key]).filter(r=>warehouseFingerprint(r)!==warehouseFingerprint(rows(result.projected[key]).find(n=>n.id===r.id)))]).filter(([,v])=>(v as Row[]).length));
  const log={id:`record-removal:${operationId}`,operationId,request,target:{kind:input.kind,id:input.id},label:String(input.label||input.id).slice(0,180),reason,at:now,by:'Rahbar',effects:result.effects,originals};
  const beforeArchives=new Set(rows(state.deletedItems).map(a=>a.id));
  const deletedItems=rows(result.state.deletedItems).map(a=>beforeArchives.has(a.id)?a:{...a,related:{...a.related,removalOperationId:operationId}});
  return {state:{...result.state,deletedItems,recordRemovals:[log,...rows(state.recordRemovals)]},result:{alreadySaved:false,effects:result.effects}};
}
