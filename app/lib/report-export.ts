import { receiptDisplay } from "./receipt-display.ts";
import { isExpenseOnlyInventory } from "./vegetable-expenses.ts";
type Row = Record<string, any>;
export const exportKinds = { suppliers: 'Yetkazib beruvchilar va qarzlar', transactions: 'Yetkazib beruvchilar oldi-berdisi', inventory: 'Ombor qoldig‘i', movements: 'Ombor harakatlari', sales: 'Savdo yozuvlari', expenses: 'Xarajat va pul harakatlari' } as const;
export type ExportKind = keyof typeof exportKinds;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
export function csvCell(value: unknown) {
  let s = value == null ? '' : String(value);
  // Excel must never execute supplier names or notes as formulas.
  if (typeof value !== 'number' && /^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function validateExport(kind: string, from = '', to = ''): asserts kind is ExportKind {
  if (!Object.hasOwn(exportKinds,kind)) throw new Error('Hisobot turini tanlang.');
  for (const d of [from,to]) if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10)!==d)) throw new Error('Sana YYYY-MM-DD shaklida bo‘lsin.');
  if (from && to && from > to) throw new Error('Boshlanish sanasi tugash sanasidan keyin bo‘lmasin.');
}
export function buildReportExport(state: Row, kind: string, branch: string, from = '', to = '', now = new Date().toISOString()) {
  validateExport(kind,from,to);
  const names = (key: string, id: unknown) => rows(state[key]).find(r=>r.id===id)?.name || String(id||'');
  const period = (key: string) => rows(state[key]).filter(r=>(!from||String(r.date)>=from)&&(!to||String(r.date)<=to));
  let header: string[] = [], data: unknown[][] = [];
  if(kind==='suppliers') {
    header=['Yetkazib beruvchi','Telefon','Bank hisobi','Qarz asosi / boshlang‘ich qoldiq (von)','Jami kirim (von)','Jami to‘lov (von)','Hozirgi qoldiq (von)','Holati'];
    data=rows(state.suppliers).filter(s=>!/mezana/i.test(s.name)).map(s=>{const tx=rows(state.transactions).filter(t=>t.supplierId===s.id);return [s.name,s.phone,s.bankAccount,s.openingBalance||0,tx.filter(t=>t.type==='purchase').reduce((n,t)=>n+Number(t.amount),0),tx.filter(t=>t.type==='payment').reduce((n,t)=>n+Number(t.amount),0),s.balance,s.balance>0?'Qarz':s.balance<0?'Oldindan to‘lov':'Qarz yo‘q'];});
  } else if(kind==='transactions') {
    header=['Sana','Yetkazib beruvchi','Harakat','Summa (von)','To‘lov hisobi','Izoh','Yozuv ID'];
    data=period('transactions').map(t=>[t.date,names('suppliers',t.supplierId),t.type==='purchase'?'Qarzga kirim':'Qarz to‘lovi',t.amount,names('accounts',t.accountId),t.note,t.id]);
    for(const s of rows(state.suppliers)) for(const e of rows(s.balanceEdits)) if((!from||e.at.slice(0,10)>=from)&&(!to||e.at.slice(0,10)<=to)) data.push([e.at,s.name,'Qoldiq tuzatishi (pul harakati emas)',e.difference,'',`${e.previousBalance} → ${e.balance} von. ${e.reason}`,e.id]);
    data.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  } else if(kind==='inventory') {
    header=['Mahsulot','Hozirgi miqdor','Birlik','Birlik tannarxi (von)','Qoldiq qiymati (von)','Minimal qoldiq'];
    data=rows(state.inventory).filter(i=>!isExpenseOnlyInventory(i)).map(i=>[i.name,i.stock,i.unit,i.unitCost,Number(i.stock)*Number(i.unitCost),i.minStock]);
  } else if(kind==='movements') {
    header=['Sana','Mahsulot','Harakat','Miqdor','Birlik','Birlik tannarxi (von)','Yetkazib beruvchi','Izoh','Yozuv ID'];
    const labels:Row={receipt:'Kirim',waste:'Chiqit',sale:'Savdo',adjustment:'Tuzatish'};
    data=period('stockMovements').map(m=>{const item=rows(state.inventory).find(i=>i.id===m.inventoryId);const d=m.type==='receipt'?receiptDisplay(m,item):{quantity:m.quantity,unit:item?.unit,unitCost:m.unitCost};return [m.date,names('inventory',m.inventoryId),labels[m.type]||m.type,d.quantity,d.unit,d.unitCost,names('suppliers',m.supplierId),m.note,m.id];});
  } else if(kind==='sales') {
    header=['Sana','Mahsulot','Miqdor','Birlik narxi (von)','Savdo summasi (von)','Tannarx (von)','Manba','Platforma','Buyurtma raqami','Yozuv ID'];
    data=period('sales').map(s=>[s.date,names('recipes',s.recipeId),s.quantity,s.unitPrice,s.totalRevenue,s.totalCost,s.source,s.deliveryPlatform,s.deliveryOrderNumber||s.deliveryBatchId,s.id]);
  } else {
    header=['Sana','Harakat','Kategoriya','Summa (von)','Hisob','Qabul qiluvchi hisob','Foydaga ta’sir','Naqd pulsiz','Holati','Izoh','Yozuv ID'];
    const labels:Row={expense:'Chiqim',income:'Kirim',transfer:'O‘tkazma'};
    data=period('financialEntries').map(e=>[e.date,labels[e.type]||e.type,e.category,e.amount,names('accounts',e.accountId),names('accounts',e.toAccountId),e.affectsProfit?'Ha':'Yo‘q',e.nonCash?'Ha':'Yo‘q',e.cancelledAt?'Bekor qilingan':'Faol',e.note,e.id]);
  }
  const snapshot=kind==='inventory'||kind==='suppliers';
  const note=kind==='sales'?'Har qator mahsulot savdosi. Sof foyda emas; platforma ushlanmalari bu summadan hali ayrilmagan.':kind==='expenses'?'Pul harakati foyda xarajati bilan bir xil emas. Bekor qilingan va foydaga ta’sir qilmaydigan yozuvlarni ajrating.':kind==='suppliers'?'Musbat qoldiq - qarz; manfiy qoldiq - avans. MEZANA alohida hisobda.':'Tizimda saqlangan yozuvlar. Qoldiq tuzatishi xarid yoki to‘lov hisoblanmaydi.';
  const lines:unknown[][]=[['HALO Control',exportKinds[kind]],['Filial',branch],['Tayyorlangan vaqt (UTC)',now],['Davr',snapshot?'Hozirgi qoldiq (sana filtri qo‘llanmaydi)':`${from||'Boshidan'} - ${to||'Hozirgacha'}`],['Izoh',note],['Yozuvlar soni',data.length],[],header,...data];
  return { filename:`HALO_${kind}_${now.slice(0,10)}.csv`, content:'\uFEFF'+lines.map(r=>r.map(csvCell).join(',')).join('\r\n'), count:data.length };
}
