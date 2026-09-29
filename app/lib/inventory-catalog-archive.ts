type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
export class InventoryCatalogError extends Error { status:number; constructor(message:string,status=400){super(message);this.status=status;} }
/** Catalog visibility never removes stock, historical receipts or recipe references. */
export function applyInventoryCatalogVisibility<T extends Row>(state:T):T {
 const history=rows(state.inventoryCatalogArchives);
 if(!history.length)return state;
 const known=new Set(history.map(r=>r.inventoryId));
 const active=new Map(history.filter(r=>!r.restoredAt).map(r=>[r.inventoryId,r]));
 return {...state,inventory:rows(state.inventory).map(item=>{
  if(!known.has(item.id))return item;
  const record=active.get(item.id);
  const clean={...item};delete clean.catalogArchived;delete clean.catalogArchivedAt;delete clean.catalogArchiveReason;
  return record?{...clean,catalogArchived:true,catalogArchivedAt:record.archivedAt,catalogArchiveReason:record.reason}:clean;
 })};
}
export function setInventoryCatalogArchived(state:Row,id:string,archived:boolean,reasonValue='',now=new Date().toISOString()){
 const item=rows(state.inventory).find(i=>i.id===id);
 if(!item)throw new InventoryCatalogError('Mahsulot topilmadi. Ro‘yxatni yangilang.',404);
 const history=rows(state.inventoryCatalogArchives);
 const current=history.find(r=>r.inventoryId===id&&!r.restoredAt);
 if(Boolean(current)===archived)return{state,result:{kind:'inventory' as const,id,label:item.name,alreadyDeleted:archived,alreadySaved:true,detachedMovementCount:0}};
 const reason=String(reasonValue||'').trim().slice(0,500);
 if(archived&&!reason)throw new InventoryCatalogError('Olib tashlash sababini yozing.');
 const inventoryCatalogArchives=archived?[{id:`inventory-catalog:${crypto.randomUUID()}`,inventoryId:id,archivedAt:now,archivedBy:'Rahbar',reason,record:structuredClone(item)},...history]:history.map(r=>r===current?{...r,restoredAt:now,restoredBy:'Rahbar'}:r);
 return{state:applyInventoryCatalogVisibility({...state,inventoryCatalogArchives}),result:{kind:'inventory' as const,id,label:item.name,alreadyDeleted:false,alreadySaved:false,detachedMovementCount:0}};
}
