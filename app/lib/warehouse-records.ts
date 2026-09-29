import { applyVegetablePurchaseAccounting } from './vegetable-expenses.ts';
import { editUnifiedIntake, cancelUnifiedIntake, planIntakeLine } from './unified-intake.ts';
import { saveInventoryMovement } from './inventory-operations.ts';
import { archiveStockMovement } from './inventory-deletions.ts';
import { rebalanceSuppliers } from './supplier-transactions.ts';
import { receiptCostsForInventory } from './stock-movements.ts';
import { isAccountingMonthClosed } from './month-end.ts';
import { createDeletedItem } from './deleted-items.ts';
import { parseSupplierDeliveryLines } from './supplier-deliveries.ts';

type Row = Record<string, any>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
export class WarehouseRecordError extends Error { status:number; constructor(message: string, status = 400) { super(message); this.status=status; } }
export type WarehouseDocument = { id: string; kind: 'intake'|'movement'|'delivery'|'linked'; date: string; supplierId: string; source: string; target: string; amount: number; paid: number; lines: Row[]; record: Row; movements: Row[]; payments: Row[]; fingerprint: string };
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export const warehouseFingerprint = (value: unknown) => JSON.stringify(canonical(value));

/** Read-only projection. Loading this list never changes historical data. */
export function warehouseDocuments(state: Row): WarehouseDocument[] {
 const movements=rows(state.stockMovements), transactions=rows(state.transactions), inventory=rows(state.inventory);
 const documents: WarehouseDocument[]=[]; const used=new Set<string>();
 const add=(d: Omit<WarehouseDocument,'fingerprint'>)=>{d.movements.forEach(m=>used.add(m.id));documents.push({...d,fingerprint:warehouseFingerprint([d.record,d.movements,d.payments])});};
 for(const tx of transactions.filter(t=>t.type==='purchase'&&Array.isArray(t.intakeLines))) {
  const payment=transactions.filter(t=>t.intakeId===tx.id&&t.type==='payment');
  add({id:tx.id,kind:'intake',date:tx.date,supplierId:tx.supplierId,source:'Xarid / kirim',target:'intake',amount:Number(tx.amount),paid:payment.reduce((n,p)=>n+Number(p.amount),0),lines:tx.intakeLines,record:tx,movements:movements.filter(m=>m.intakeId===tx.id),payments:payment});
 }
 for(const d of rows(state.supplierDeliveries).filter(d=>d.status==='approved')) {
  const ms=movements.filter(m=>m.referenceId===d.id&&m.type==='receipt'); if(!ms.length)continue;
  const tx=transactions.find(t=>t.id===`delivery-purchase:${d.id}`);
  const payments=transactions.filter(t=>t.id===d.paymentTransactionId);
  add({id:d.id,kind:tx||d.supplierAccounting==='separate'?'delivery':'linked',date:d.date,supplierId:d.supplierId,source:'Xodim kirimi',target:'suppliers',amount:Number(d.totalAmount),paid:payments.reduce((n,p)=>n+Number(p.amount),0),lines:rows(d.lines).map(l=>({...l,unit:l.unit||inventory.find(i=>i.id===l.inventoryId)?.unit||'birlik',amount:l.totalAmount})),record:{...d,purchaseTransaction:tx},movements:ms,payments});
 }
 for(const m of movements.filter(m=>m.type==='receipt'&&!used.has(m.id))) {
  const item=inventory.find(i=>i.id===m.inventoryId);
  const mezana=Boolean(m.mezanaEntryId)||String(m.referenceId||'').startsWith('mezana');
  const order=rows(state.purchaseOrders).find(o=>o.id===m.referenceId);
  const quantity=Number(m.purchaseQuantity ?? m.quantity);
  const amount=Number(m.purchaseAmount ?? quantity*Number(m.unitCost||0));
  add({id:m.id,kind:m.referenceId?'linked':'movement',date:m.date,supplierId:m.supplierId||'',source:mezana?'MEZANA':order?'Xarid buyurtmasi':m.referenceId?'Bog‘langan kirim':'Oddiy ombor kirimi',target:mezana?'mezana':order?'control':'suppliers',amount:Math.round(amount),paid:0,lines:[{name:item?.name||m.inventoryId,inventoryId:m.inventoryId,quantity,unit:m.purchaseUnit||item?.unit||'birlik',amount:Math.round(amount)}],record:m,movements:[m],payments:[]});
 }
 return documents.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}

function editDelivery(state: Row, doc: WarehouseDocument, input: Row, cancel: boolean) {
 const original=doc.record, oldTx=original.purchaseTransaction, separate=original.supplierAccounting==='separate';
 const d={...original}; delete d.purchaseTransaction;
 const lines=cancel?[]:parseSupplierDeliveryLines(rows(input.lines).map((l,i)=>({...l,id:l.id||`line-${i+1}`,totalAmount:Number(l.amount),quantity:Number(l.quantity),packageSize:l.packageSize||l.unit||''})));
 if(!lines)throw new WarehouseRecordError('Mahsulot miqdori va jami summasini tekshiring.');
 if(lines.some(l=>!Number.isSafeInteger(l.totalAmount)))throw new WarehouseRecordError('Summani butun vonda kiriting.');
 const supplierId=cancel?d.supplierId:String(input.supplierId||'');
 if((supplierId||!separate)&&!rows(state.suppliers).some(s=>s.id===supplierId))throw new WarehouseRecordError('Yetkazib beruvchini tanlang.');
 if(!cancel&&supplierId!==d.supplierId&&doc.payments.length)throw new WarehouseRecordError('Bu kirimda to‘lov bor. Yetkazuvchini almashtirishdan oldin to‘lovni o‘z bo‘limida tekshiring.');
 const affected=new Set([...doc.movements.map(m=>m.inventoryId),...lines.map(l=>l.inventoryId)]);
 if([...affected].some(id=>!rows(state.inventory).some(i=>i.id===id)))throw new WarehouseRecordError('Mahsulot omborda topilmadi. Avval uni tiklang.');
 const date=cancel?d.date:String(input.date);
 const newMovements=lines.map(l=>{
  const old=doc.movements.find(m=>m.inventoryId===l.inventoryId);
  const product=rows(state.inventory).find(i=>i.id===l.inventoryId)!;
  if(l.unit && l.unit!==(old?.purchaseUnit||product.unit))throw new WarehouseRecordError('Mahsulotning saqlangan birligini o‘zgartirmang.');
  const planned=separate?planIntakeLine(rows(state.inventory),{...l,amount:l.totalAmount},date,old?old.expenseOnlyAtMovement===true:undefined):null;
  const baseQuantity=planned?planned.stockQuantity:l.quantity;
  return {...old,id:old?.id||`delivery-receipt:${d.id}:${l.inventoryId}`,inventoryId:l.inventoryId,type:'receipt',quantity:baseQuantity,date,note:d.note||'Xodim kirimi',referenceId:d.id,supplierId,unitCost:baseQuantity?l.totalAmount/baseQuantity:Number(old?.unitCost||product.unitCost||0),previousUnitCost:old?.previousUnitCost??Number(product.unitCost||0),...((old?.expenseOnlyAtMovement||separate)?{purchaseBaseQuantity:baseQuantity,purchaseQuantity:l.quantity,purchaseUnit:l.unit||product.unit,purchaseAmount:l.totalAmount}:{}),...(separate?{supplierAccounting:'separate'}:{}),...(d.document?{document:d.document}:{})};
 });
 const inventory=rows(state.inventory).map(item=>{
  if(!affected.has(item.id))return item;
  const oldQty=doc.movements.filter(m=>m.inventoryId===item.id).reduce((s,m)=>s+Number(m.quantity),0);
  const newQty=newMovements.filter(m=>m.inventoryId===item.id).reduce((s,m)=>s+Number(m.quantity),0);
  const stock=Number(item.stock)-oldQty+newQty;
  if(stock<-.000001&&stock<Number(item.stock)-.000001)throw new WarehouseRecordError(`«${item.name}» qoldig‘i yetmaydi. Sarflangan miqdorni tekshiring.`);
  return {...item,stock};
 });
 const amount=lines.reduce((s,l)=>s+l.totalAmount,0);
 const tx=cancel||separate?null:{...oldTx,supplierId,date,amount};
 // Recorded payments remain real payments, never silently refunded by cancelling goods.
 const suppliers=separate?rows(state.suppliers):rebalanceSuppliers(rows(state.suppliers) as any,oldTx,tx as any);
 if(!suppliers)throw new WarehouseRecordError('Qarz hisobi yangilanmadi.');
 const replacements=new Map(newMovements.map(m=>[m.id,m]));
 const ms=[...newMovements.filter(m=>!doc.movements.some(o=>o.id===m.id)),...rows(state.stockMovements).flatMap(m=>doc.movements.some(o=>o.id===m.id)?replacements.has(m.id)?[replacements.get(m.id)!]:[]:[m])];
 const fallback=Object.fromEntries(doc.movements.map(m=>[m.inventoryId,Number(m.previousUnitCost||0)]));
 const updated={...d,supplierId,date,lines,totalAmount:amount};
 const archives=cancel?(separate?doc.movements.map(m=>createDeletedItem({kind:'stockMovement',entityId:m.id,label:'Xodim kirimi',section:'Ombor',record:m,related:{delivery:d,warehouseDocumentId:doc.id},reason:input.reason})):[createDeletedItem({kind:'transaction',entityId:oldTx.id,label:'Xodim kirimi',section:'Ombor',record:oldTx,related:{movements:doc.movements,delivery:d,warehouseDocumentId:doc.id},reason:input.reason})]):[];
 return {state:{...state,inventory:receiptCostsForInventory(inventory as any,ms as any,fallback,affected),suppliers,stockMovements:ms,transactions:separate?rows(state.transactions):rows(state.transactions).flatMap(t=>t.id===oldTx.id?tx?[tx]:[]:[t]),supplierDeliveries:rows(state.supplierDeliveries).flatMap(row=>row.id===d.id?cancel?[]:[updated]:[row]),deletedItems:[...archives,...rows(state.deletedItems)]},result:{alreadySaved:false}};
}

export function applyWarehouseRecord(state: Row, input: Row, now = new Date().toISOString()) {
 const operationId=String(input.operationId||'');
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId))throw new WarehouseRecordError('Amal raqamini tekshiring.');
 const request=warehouseFingerprint(input);
 const revisions=rows(state.warehouseRevisions);
 const prior=revisions.find(r=>r.operationId===operationId);
 if(prior){if(prior.request!==request)throw new WarehouseRecordError('Oldingi amal saqlangan. Oynani qayta oching.',409);return {state,result:{alreadySaved:true}};}
 if(!['edit','cancel'].includes(input.action))throw new WarehouseRecordError('Amalni tanlang.');
 const reason=String(input.reason||'').trim();if(reason.length<3||reason.length>300)throw new WarehouseRecordError('Tahrirlash yoki bekor qilish sababini yozing (3–300 belgi).');
 const doc=warehouseDocuments(state).find(d=>d.id===input.id);
 if(!doc)throw new WarehouseRecordError('Kirim topilmadi yoki bekor qilingan. Ro‘yxatni yangilang.',409);
 if(doc.fingerprint!==input.expected)throw new WarehouseRecordError('Bu kirim boshqa oynada o‘zgargan. Yangilab, qayta tekshiring.',409);
 if(doc.kind==='linked')throw new WarehouseRecordError('Bu kirimni manba hujjatidan boshqaring.',409);
 const date=input.action==='cancel'?doc.date:String(input.date||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new WarehouseRecordError('Sanani tekshiring.');
 if(isAccountingMonthClosed(state.monthlyCloses,doc.date)||isAccountingMonthClosed(state.monthlyCloses,date))throw new WarehouseRecordError('Bu oy yopilgan. Yopilgan hisobot o‘zgartirilmaydi.',409);
 let result: {state:Row;result:Row};
 if(doc.kind==='intake')result=input.action==='cancel'?cancelUnifiedIntake(state,{...input,reason}):editUnifiedIntake(state,{...input,reason});
 else if(doc.kind==='delivery')result=editDelivery(state,doc,{...input,reason},input.action==='cancel');
 else if(input.action==='cancel') result=archiveStockMovement(state,doc.id,reason);
 else {
  if(rows(input.lines).length!==1)throw new WarehouseRecordError('Oddiy kirimda bitta mahsulotni kiriting.');
  const line=input.lines[0];const q=Number(line.quantity),amount=Number(line.amount);
  if(!Number.isFinite(q)||q<=0||!Number.isSafeInteger(amount)||amount<=0)throw new WarehouseRecordError('Miqdor va summani tekshiring.');
  if(doc.record.expenseOnlyAtMovement && (line.inventoryId!==doc.record.inventoryId || line.unit!==doc.lines[0].unit))throw new WarehouseRecordError('Omborsiz xaridning mahsuloti va birligi saqlanadi; miqdor va summasini tuzating.');
  const item=rows(state.inventory).find(i=>i.id===line.inventoryId);
  if(!item)throw new WarehouseRecordError('Mahsulot topilmadi.');
  let factor=1;
  if(doc.record.supplierAccounting==='separate'){
   const planned=planIntakeLine(rows(state.inventory),line,date,doc.record.expenseOnlyAtMovement===true);
   factor=planned.stockQuantity/q;
  } else if(doc.record.expenseOnlyAtMovement){
   factor=line.unit===item.unit?1:((line.unit==='kg'&&item.unit==='g')||(line.unit==='litr'&&item.unit==='ml'))?1000:((line.unit==='g'&&item.unit==='kg')||(line.unit==='ml'&&item.unit==='litr'))?.001:Number(doc.record.purchaseBaseQuantity||0)/Number(doc.record.purchaseQuantity||1);
  } else if(line.unit!==item.unit)throw new WarehouseRecordError('Ombor mahsulotining birligini tekshiring.');
  const baseQuantity=factor>0?q*factor:0;
  result=saveInventoryMovement(state,{originalId:doc.id,movement:{...doc.record,inventoryId:line.inventoryId,quantity:baseQuantity||q,date,supplierId:input.supplierId,unitCost:baseQuantity?amount/baseQuantity:Number(doc.record.unitCost||item.unitCost),note:input.note||doc.record.note}});
  if(doc.record.expenseOnlyAtMovement || doc.record.supplierAccounting==='separate'){ result.state.stockMovements=rows(result.state.stockMovements).map(m=>m.id===doc.id?{...doc.record,...m,purchaseBaseQuantity:baseQuantity,purchaseQuantity:q,purchaseUnit:line.unit,purchaseAmount:amount}:m); }
 }
 // Complete the existing linked expense/debt posting before recording the final version.
 result.state=applyVegetablePurchaseAccounting(state,result.state,'Rahbar',now);
 for(const item of rows(result.state.inventory)) {
  const old=rows(state.inventory).find(i=>i.id===item.id);
  if(old && Number(item.stock)<-0.000001 && Number(item.stock)<Number(old.stock)-0.000001)throw new WarehouseRecordError(`«${item.name}» sarflangan; bu o‘zgarish uchun qoldiq yetmaydi.`);
 }
 const financialBefore=rows(state.financialEntries).filter(e=>e.intakeId===doc.id||doc.payments.some(p=>p.id===e.transactionId)||doc.movements.some(m=>e.id===`vegetable-expense:${m.id}`));
 const after=warehouseDocuments(result.state).find(d=>d.id===doc.id);
 const revision={id:`warehouse-revision:${operationId}`,operationId,request,documentId:doc.id,kind:doc.kind,action:input.action,reason,at:now,actor:'Rahbar',before:doc,financialBefore,after:after||null};
 return {state:{...result.state,warehouseRevisions:[revision,...revisions]},result:{...result.result,alreadySaved:false}};
}
