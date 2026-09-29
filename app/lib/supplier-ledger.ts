import { receiptDisplay } from "./receipt-display.ts";
type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
/** Reconstructed chronology; old transactions have dates but not reliable times. */
export function supplierLedger(supplier: Row, transactions: Row[], movements: Row[] = [], inventory: Row[] = []) {
  const edits = rows(supplier.balanceEdits);
  const validEdits = edits.filter(e => Number.isFinite(e.openingBalance) && Number.isFinite(e.previousOpeningBalance) && Number.isFinite(new Date(e.at).getTime()));
  const opening = Number(supplier.openingBalance || 0) - validEdits.reduce((n,e)=>n + e.openingBalance - e.previousOpeningBalance,0);
  const entries = transactions.filter(t=>t.supplierId===supplier.id && ['purchase','payment'].includes(t.type)).map(t=>({
    id:String(t.id),date:String(t.date),sort:String(t.date),kind:t.type as string,
    amount:Number(t.amount),delta:t.type==='purchase'?Number(t.amount):-Number(t.amount),note:String(t.note||''),
    items:rows(t.intakeLines).length ? rows(t.intakeLines).map(l=>`${l.name}: ${l.quantity} ${l.unit}`) : movements.filter(m=>(m.referenceId===t.id || m.intakeId===t.id || m.transactionId===t.id || m.id===t.vegetableMovementId) && m.type==='receipt').map(m=>{const i=inventory.find(i=>i.id===m.inventoryId);const d=receiptDisplay(m,i);return `${i?.name||'Mahsulot'}: ${d.quantity} ${d.unit}`;}),
  }));
  for(const e of validEdits) entries.push({id:String(e.id),date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.at)),sort:String(e.at),kind:'adjustment',amount:e.openingBalance-e.previousOpeningBalance,delta:e.openingBalance-e.previousOpeningBalance,note:String(e.reason||''),items:[]});
  entries.sort((a,b)=>a.date.localeCompare(b.date)||a.sort.localeCompare(b.sort)||(a.kind==='purchase'?-1:1)-(b.kind==='purchase'?-1:1)||a.id.localeCompare(b.id));
  let balance=opening;
  const ledger=entries.map(e=>({...e,balance:balance+=e.delta}));
  return {opening,entries:ledger,balance,difference:Number(supplier.balance)-balance,incomplete:validEdits.length!==edits.length};
}
