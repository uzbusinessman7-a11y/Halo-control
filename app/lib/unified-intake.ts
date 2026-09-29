import { reservePurchaseMetadata } from './purchase-reserve.ts';
import { expenseOnlyOnDate } from './vegetable-expenses.ts';
import { seoulCalendarDate } from './business-time.ts';
import { receiptCostsForInventory, bypassRemovedReceiptCost } from './stock-movements.ts';
import { mezanaNameKey } from './mezana-posting.ts';
import { rebalanceSuppliers } from './supplier-transactions.ts';
import { isAccountingMonthClosed } from './month-end.ts';
type Row = Record<string, any>;
const list = (value: unknown): Row[] => Array.isArray(value) ? value : [];
export class IntakeError extends Error {
  code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}
function intakeItem(inventory: Row[], line: Row) {
  if (line.inventoryId) {
    const item = inventory.find(item => item.id === line.inventoryId);
    if (!item) throw new IntakeError('Tanlangan mahsulot topilmadi. Ro‘yxatni yangilang.');
    return item;
  }
  const matches = inventory.filter(item => mezanaNameKey(item.name) === mezanaNameKey(line.name));
  if (matches.length > 1) throw new IntakeError(`«${String(line.name || '').trim()}» nomi omborda takrorlangan. Mahsulotni ro‘yxatdan tanlang.`);
  return matches[0];
}
export function planIntakeLine(inventory: Row[], line: Row, date = seoulCalendarDate(), expenseOverride?: boolean) {
  const item = intakeItem(inventory, line);
  const name = String(item?.name || line.name || '').trim();
  const unitLabel = String(line.unit || 'dona').trim();
  if (!unitLabel || unitLabel.length > 30) throw new IntakeError('Xarid birligini tekshiring.');
  const count = Number(line.quantity);
  const amount = Number(line.amount);
  if (!name || name.length > 100 || !Number.isFinite(count) || count <= 0 || count > 1e9 || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1e11) throw new IntakeError('Mahsulot nomi, miqdori va shu qatorning jami summasini tekshiring.');
  const vegetableExpense = Boolean(item && (expenseOverride ?? expenseOnlyOnDate(item, date)));
  let factor = 1;
  if (item) {
    const unit = unitLabel.toLocaleLowerCase();
    // A base unit always means one base unit, even if a legacy package has
    // the same name. "qadoq" explicitly selects the configured package.
    if (unit === String(item.unit).toLocaleLowerCase()) factor = 1;
    else if (vegetableExpense && unit === 'kg' && item.unit === 'g') factor = 1000;
    else if (vegetableExpense && unit === 'litr' && item.unit === 'ml') factor = 1000;
    else if (unit === 'qadoq' || unit === String(item.packageName || '').trim().toLocaleLowerCase()) {
      const packageSize = Number(item.unitsPerPackage);
      // A reserve purchase does not need a gram conversion. Unknown package
      // sizes must preserve the previous recipe cost, never invent one gram.
      factor = vegetableExpense && (!Number.isFinite(packageSize) || packageSize <= 1) ? 0 : packageSize;
    }
    else if ((unit === 'kg' && item.unit === 'g') || (unit === 'litr' && item.unit === 'ml')) factor = 1000;
    else if ((unit === 'g' && item.unit === 'kg') || (unit === 'ml' && item.unit === 'litr')) factor = .001;
    else if (vegetableExpense) factor = 0;
    else throw new IntakeError(`«${name}» uchun ${unit} va ${item.unit} mos emas. Ombordagi birlik yoki qadoqni tanlang.`);
    if (!Number.isFinite(factor) || (!vegetableExpense && (factor <= 0 || (item.unit === 'dona' && !Number.isSafeInteger(count * factor))))) throw new IntakeError(`«${name}» qadoq miqdorini tekshiring.`);
  }
  return { ...(vegetableExpense ? reservePurchaseMetadata(line, date) : {}), name, quantity: count, unit: String(line.unit || 'dona'), amount, inventoryId: item?.id || '', stockQuantity: item ? count * factor : 0, destination: vegetableExpense ? 'vegetableExpense' : item ? 'stock' : 'expense' };
}
/** Compare actual quantities; legacy supplier records have only a total.
 * A total match is a warning requiring an explicit separate-purchase reason,
 * never proof that the existing record should be removed or merged. */
export function findSimilarIntake(transactions: Row[], supplierId: string, date: string, lines: Row[]) {
  const signature = (items: Row[]) => JSON.stringify(items.map(l => [l.inventoryId || mezanaNameKey(l.name), l.inventoryId && l.stockQuantity ? Number(l.stockQuantity) : Number(l.quantity), l.inventoryId && l.stockQuantity ? '' : l.unit, Number(l.amount)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const key = signature(lines);
  const total = lines.reduce((sum, line) => sum + Number(line.amount), 0);
  if (!lines.length || !Number.isSafeInteger(total) || total <= 0) return undefined;
  return transactions.find(t => t.type === 'purchase' && t.supplierId === supplierId && t.date === date
    && (Array.isArray(t.intakeLines) ? signature(t.intakeLines) === key : Number(t.amount) === total));
}
export function applyUnifiedIntake(state: Row, body: Row, originalMovements?: Row[]) {
  const operationId = String(body.operationId || '');
  if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new IntakeError('Kirim raqami noto‘g‘ri. Oynani yangilang.');
  const id = `intake:${operationId}`;
  const transactions = list(state.transactions);
  const prior = transactions.find((row) => row.id === id);
  const requestKey = JSON.stringify([body.supplierName,body.date,body.invoiceNumber||'',Number(body.paidAmount||0),body.accountId,body.lines]);
  if (prior) { if (prior.intakeRequestKey && prior.intakeRequestKey !== requestKey) throw new IntakeError('Oldingi kirim saqlangan. Tarixni tekshiring va yangi kirim uchun oynani qayta oching.'); return { state, result: { alreadySaved: true, record: prior } }; }
  if (list(state.deletedItems).some((row) => row.entityId === id)) throw new IntakeError('Bu kirim bekor qilingan. Yangi kirim sifatida kiriting.');
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new IntakeError('Sanani tekshiring.');
  if (isAccountingMonthClosed(state.monthlyCloses, date)) throw new IntakeError('Bu oy yopilgan. Kirimni ochiq oyga kiriting.');
  const supplierName = String(body.supplierName || '').trim().replace(/\s+/g,' ');
  if (!supplierName || supplierName.length > 100) throw new IntakeError('Kimdan olinganini yozing.');
  if (/mezana/i.test(supplierName)) throw new IntakeError('MEZANA uchun shu oynadagi MEZANA tugmasidan foydalaning: uning alohida oldi-berdi hisobi saqlanadi.');
  const suppliers = list(state.suppliers);
  const candidates = suppliers.filter((row) => mezanaNameKey(row.name) === mezanaNameKey(supplierName));
  if (candidates.length > 1) throw new IntakeError('Bu nomli yetkazib beruvchi bir nechta. Avval nomlarini ajrating.');
  const supplier = candidates[0] || {id:`intake-supplier:${operationId}`,name:supplierName,phone:'',balance:0,openingBalance:0};
  const inventory = list(state.inventory);
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 50) throw new IntakeError('1–50 ta mahsulot kiriting.');
  const lines = body.lines.map((line: Row) => {
    const item = intakeItem(inventory, line);
    const old = originalMovements?.find(m=>m.inventoryId===item?.id);
    if(item?.catalogArchived && !old) throw new IntakeError(`«${item.name}» faol ro‘yxatdan olib tashlangan. Ombor → Olib tashlangan mahsulotlar orqali tiklang.`);
    const planned = planIntakeLine(inventory, line, date, old ? old.expenseOnlyAtMovement===true : undefined);
    if (planned.destination === "expense" && line.expenseConfirmed !== true) throw new IntakeError(`«${planned.name}» omborda topilmadi. Xomashyo bo‘lsa omborda yarating; xizmat yoki sarf materiali bo‘lsa xarajat ekanini belgilang.`);
    return planned;
  });
  if (body.vegetableOnly === true && lines.some((line: Row) => line.destination !== 'vegetableExpense')) throw new IntakeError('Tanlangan sana uchun mahsulot Omborsiz (xarajat) sifatida belgilanmagan. Sana yoki mahsulotni tekshiring.');
  if (new Set(lines.map((line: Row) => mezanaNameKey(line.name))).size !== lines.length) throw new IntakeError("Bir mahsulotni bitta qatorda jami miqdor va summa bilan kiriting.");
  const total = lines.reduce((sum: number,line: Row)=>sum+line.amount,0);
  if (!Number.isSafeInteger(total) || total > 1e11) throw new IntakeError('Jami summa juda katta.');
  if (body.paidAmount === undefined || body.paidAmount === null || body.paidAmount === '') throw new IntakeError('To‘lovni belgilang: hammasi to‘landi yoki qarzga olindi.');
  const paid = Number(body.paidAmount);
  if (!Number.isSafeInteger(paid) || paid < 0 || paid > total) throw new IntakeError('To‘langan summa 0 va jami xarid oralig‘ida bo‘lsin.');
  if (paid && !list(state.accounts).some((account)=>account.id===body.accountId)) throw new IntakeError('To‘lov hisobini tanlang.');
  const invoiceNumber = String(body.invoiceNumber || '').trim().slice(0,80);
  if (invoiceNumber && transactions.some((row)=>row.supplierId===supplier.id && row.intakeInvoiceNumber===invoiceNumber)) throw new IntakeError('Bu yetkazuvchining shu chek raqami oldin saqlangan. Tarixni tekshiring.');
  const similar = findSimilarIntake(transactions,supplier.id,date,lines);
  const duplicateReason = String(body.duplicateReason || '').trim();
  if (similar && (duplicateReason.length < 5 || duplicateReason.length > 300)) throw new IntakeError(`Bu yetkazib beruvchi uchun ${similar.date} sanasida ₩${Number(similar.amount).toLocaleString('en-US')} xarid oldin saqlangan. O‘sha xarid bo‘lsa, qayta saqlamang. Faqat boshqa xarid bo‘lsa, alohida ekanini tasdiqlang.`, 'SIMILAR_PURCHASE');
  const record = {duplicateOf:similar?.id || '',duplicateReason:similar ? duplicateReason : '',intakeRequestKey:requestKey,id,supplierId:supplier.id,type:'purchase' as const,amount:total,date,note:`Xarid / kirim · ${lines.map((line:Row)=>line.name).join(', ')}`,intakeLines:lines,intakePaidAmount:paid,intakeInvoiceNumber:invoiceNumber};
  const payment = {id:`intake-payment:${operationId}`,supplierId:supplier.id,type:'payment' as const,amount:paid,date,accountId:body.accountId,note:'Xarid / kirim bilan to‘landi',intakeId:id};
  let nextSuppliers = rebalanceSuppliers((candidates.length ? suppliers : [...suppliers,supplier]) as any,null,record)!;
  if (paid) nextSuppliers=rebalanceSuppliers(nextSuppliers,null,payment)!;
  const movements = lines.flatMap((line:Row,index:number)=>line.inventoryId ? [{id:`intake-stock:${operationId}:${index}`,inventoryId:line.inventoryId,type:'receipt',quantity:line.stockQuantity,date,note:`${supplierName} · ${line.name}`,referenceId:id,intakeId:id,supplierId:supplier.id,...(line.stockQuantity>0?{unitCost:line.amount/line.stockQuantity}:{}),...(line.destination==='vegetableExpense'?{purchaseQuantity:line.quantity,purchaseUnit:line.unit,purchaseAmount:line.amount,...(line.purchasedAt?{purchasedAt:line.purchasedAt}:{}),...(line.remainingBeforePurchase!==undefined?{remainingBeforePurchase:line.remainingBeforePurchase}:{})}:{}),previousUnitCost:Number(inventory.find(item=>item.id===line.inventoryId)?.unitCost||0)}] : []);
  const inventoryWithStock = inventory.map((item)=>({...item,stock:Number(item.stock)+movements.filter((row:Row)=>row.inventoryId===item.id).reduce((sum:number,row:Row)=>sum+row.quantity,0)}));
  const nextInventory = receiptCostsForInventory(inventoryWithStock as any, [...movements,...list(state.stockMovements)] as any, {}, new Set(lines.filter((line:Row)=>line.inventoryId).map((line:Row)=>line.inventoryId))) as Row[];
  const expenses = lines.flatMap((line:Row,index:number)=>line.destination==='expense' ? [{id:`intake-expense:${operationId}:${index}`,type:'expense',category:'Xarid / kirim',date,amount:line.amount,accountId:'',affectsProfit:true,nonCash:true,intakeId:id,note:`${supplierName} · ${line.name} · xarajat; to‘lov alohida hisoblangan`}] : []);
  if (paid) expenses.push({id:`intake-money:${operationId}`,type:'expense',category:'Mahsulot xaridi',date,amount:paid,accountId:body.accountId,affectsProfit:false,nonCash:false,intakeId:id,transactionId:payment.id,note:`${supplierName} · to‘lov, xarajat ikkinchi marta hisoblanmaydi`} as any);
  return {state:{...state,inventory:nextInventory,suppliers:nextSuppliers,transactions:[record,...(paid?[payment]:[]),...transactions],stockMovements:[...movements,...list(state.stockMovements)],financialEntries:[...expenses,...list(state.financialEntries)]},result:{alreadySaved:false,record}};
}
function reverseUnifiedIntake(state: Row, body: Row, editing = false) {
 const id=String(body.id||''); const transactions=list(state.transactions); const record=transactions.find(row=>row.id===id && row.intakeLines);
 if(!record) throw new IntakeError('Kirim topilmadi yoki oldin bekor qilingan.');
 const reason=String(body.reason||'').trim(); if(reason.length<3 || reason.length>300) throw new IntakeError('Bekor qilish sababini yozing.');
 if(isAccountingMonthClosed(state.monthlyCloses,record.date)) throw new IntakeError('Yopilgan oy kirimini bekor qilib bo‘lmaydi.');
 const movements=list(state.stockMovements).filter(row=>row.intakeId===id);
 const inventory:Row[]=list(state.inventory).map(item=>{const quantity=movements.filter(row=>row.inventoryId===item.id).reduce((sum,row)=>sum+row.quantity,0);if(!editing && quantity && Number(item.stock)<quantity) throw new IntakeError(`«${item.name}» ishlatilgan; ombor qoldig‘i kirimni qaytarishga yetmaydi.`);return {...item,stock:Number(item.stock)-quantity};});
 if(movements.some(row=>!inventory.some(item=>item.id===row.inventoryId))) throw new IntakeError('Ombor mahsulotini avval tiklang.');
 const removed=transactions.filter(row=>row.id===id||row.intakeId===id);let suppliers=list(state.suppliers);
 for(const tx of removed) suppliers=rebalanceSuppliers(suppliers as any,tx as any,null) as Row[];
 let remainingMovements=list(state.stockMovements).filter(row=>row.intakeId!==id);
 const fallback:Record<string,number>={};
 for(const movement of movements){fallback[movement.inventoryId]=movement.previousUnitCost;remainingMovements=bypassRemovedReceiptCost(remainingMovements as any,movement as any) as Row[];}
 const restoredInventory=receiptCostsForInventory(inventory as any,remainingMovements as any,fallback,new Set(movements.map(row=>row.inventoryId)));
 const now=new Date().toISOString();
 return {state:{...state,inventory:restoredInventory,suppliers,transactions:transactions.filter(row=>!removed.some(tx=>tx.id===row.id)),stockMovements:remainingMovements,financialEntries:list(state.financialEntries).filter(row=>row.intakeId!==id),deletedItems:[...removed.map(tx=>({id:`archive:${tx.id}`,kind:'transaction',entityId:tx.id,label:tx.note,section:'Xarid / kirim',deletedAt:now,deletedBy:'Rahbar',reason,record:tx,linkedSnapshot:tx.id===id?{stockMovements:movements,financialEntries:list(state.financialEntries).filter(row=>row.intakeId===id)}:undefined})),...list(state.deletedItems)]},result:{cancelled:true}};
}
export function assertIntakePreserved(previous:Row,next:Row){
 for(const key of ['transactions','stockMovements','financialEntries']){
  const prior=list(previous[key]).filter(row=>row.intakeId||row.intakeLines);const after=list(next[key]).filter(row=>row.intakeId||row.intakeLines);
  if(JSON.stringify(prior.slice().sort((a,b)=>a.id.localeCompare(b.id)))!==JSON.stringify(after.slice().sort((a,b)=>a.id.localeCompare(b.id)))) throw new IntakeError('Bog‘langan xaridni «Xarid / kirim» oynasidan bekor qiling. Alohida yozuv o‘zgartirilmaydi.');
 }
 const linked=list(previous.financialEntries).filter(row=>row.intakeId).map(row=>row.id);
 if(list(next.financialEntries).some(row=>linked.includes(row.reversedEntryId))) throw new IntakeError('Xarid to‘lovini kirim oynasidan bekor qiling.');
 for(const row of list(previous.stockMovements).filter(row=>row.intakeId))if(!list(next.inventory).some(item=>item.id===row.inventoryId))throw new IntakeError('Bu mahsulot faol xaridga bog‘langan. Kirim tarixini tekshiring.');
}


export function cancelUnifiedIntake(state: Row, body: Row) {
 return reverseUnifiedIntake(state, body);
}

/** A complete document is replaced atomically; callers save its previous version. */
export function editUnifiedIntake(state: Row, body: Row) {
 const record=list(state.transactions).find(row=>row.id===body.id && Array.isArray(row.intakeLines));
 if(!record) throw new IntakeError('Kirim topilmadi. Ro‘yxatni yangilang.');
 const supplier=list(state.suppliers).find(row=>row.id===record.supplierId);
 if(!supplier) throw new IntakeError('Yetkazib beruvchi topilmadi.');
 const oldMovements=list(state.stockMovements).filter(m=>m.intakeId===record.id);
 const reversed=reverseUnifiedIntake(state,{id:record.id,reason:body.reason},true).state;
 // Reversal is an in-memory step, not a cancellation or a separately saved state.
 reversed.deletedItems=state.deletedItems;
 const edited=applyUnifiedIntake(reversed,{...body,operationId:String(record.id).slice('intake:'.length),supplierName:body.supplierName||supplier.name},oldMovements);
 const newMovements=list(edited.state.stockMovements).filter(m=>m.intakeId===record.id);
 const affected=new Set([...oldMovements,...newMovements].map(m=>m.inventoryId));
 for(const item of list(edited.state.inventory).filter(i=>affected.has(i.id))) {
   const before=list(state.inventory).find(i=>i.id===item.id);
   if(Number(item.stock)<-0.000001 && Number(item.stock)<Number(before?.stock)-0.000001) throw new IntakeError(`«${item.name}» qoldig‘i kamaytirishga yetmaydi. Amaliy qoldiqni tekshiring.`);
 }
 // Unrelated movements and their original metadata remain byte-for-byte unchanged.
 const remapped=newMovements.map(m=>{
   const old=oldMovements.find(o=>o.inventoryId===m.inventoryId);
   return {...(old||{}),...m,id:old?.id||`${m.id}:edit:${body.operationId}`,...(old?.expenseOnlyAtMovement?{purchaseBaseQuantity:m.quantity}:{}),previousUnitCost:old?.previousUnitCost??m.previousUnitCost};
 });
 const replacements=new Map(remapped.map(m=>[m.id,m]));
 const preserved=list(state.stockMovements).flatMap(m=>{if(m.intakeId!==record.id)return [m];const replacement=replacements.get(m.id);replacements.delete(m.id);return replacement?[replacement]:[];});
 edited.state.stockMovements=[...replacements.values(),...preserved];
 edited.state.inventory=receiptCostsForInventory(edited.state.inventory as any,edited.state.stockMovements as any,{},affected);
 return edited;
}
