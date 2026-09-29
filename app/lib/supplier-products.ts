import { receiptDisplay } from "./receipt-display.ts";
type Row=Record<string,any>;
const rows=(v:unknown):Row[]=>Array.isArray(v)?v:[];
/** Read both unified intakes and older receipts, without counting linked stock twice. */
export function supplierProducts(state:Row,supplierId:string,from='',to=''){
 const within=(date:string)=>(!from||date>=from)&&(!to||date<=to);
 const purchases=rows(state.transactions).filter(t=>t.supplierId===supplierId&&t.type==='purchase');
 const unified=purchases.filter(t=>Array.isArray(t.intakeLines));
 const unifiedIds=new Set(unified.map(t=>t.id));
 const purchaseIds=new Set(purchases.map(t=>t.id));
 const result:Row[]=[];
 for(const tx of unified.filter(t=>within(t.date)))for(const l of tx.intakeLines)result.push({date:tx.date,name:l.name,quantity:Number(l.quantity),unit:l.unit,amount:Number(l.amount)});
 for(const m of rows(state.stockMovements)){
  if(m.type!=='receipt'||!within(m.date)||unifiedIds.has(m.intakeId)||unifiedIds.has(m.referenceId))continue;
  if(m.supplierId!==supplierId&&!purchaseIds.has(m.referenceId))continue;
  const item=rows(state.inventory).find(i=>i.id===m.inventoryId);
  result.push({date:m.date,name:item?.name||m.productName||'Nomi topilmagan mahsulot',...receiptDisplay(m,item)});
 }
 result.sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.name).localeCompare(String(b.name)));
 return result;
}
