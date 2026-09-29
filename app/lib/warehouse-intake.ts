import { IntakeError, planIntakeLine } from './unified-intake.ts';
import { isAccountingMonthClosed } from './month-end.ts';
import { receiptCostsForInventory } from './stock-movements.ts';
import { seoulCalendarDate } from './business-time.ts';

type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];

/** New warehouse receipts never create supplier purchases or cash payments.
 * Existing financial documents keep their original posting rules. */
export function applyWarehouseIntake(state: Row, body: Row) {
  const operationId = String(body.operationId || '');
  if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new IntakeError('Kirim raqami noto‘g‘ri. Oynani yangilang.');
  const groupId = `warehouse:${operationId}`;
  const requestKey = JSON.stringify([body.date, body.vegetableOnly === true, body.lines]);
  const movements = rows(state.stockMovements);
  const prior = movements.filter(m => m.warehouseOperationId === groupId);
  const removed = rows(state.deletedItems).some(d => d.record?.warehouseOperationId === groupId);
  if (removed) throw new IntakeError('Bu kirim bekor qilingan. Tarixni tekshiring; yangi kirimni alohida kiriting.');
  if (prior.length) {
    if (prior.some(m => m.warehouseRequestKey !== requestKey)) throw new IntakeError('Oldingi kirim saqlangan. Yangi kirim uchun oynani qayta oching.');
    return {state,result:{alreadySaved:true,id:groupId}};
  }
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date > seoulCalendarDate()) throw new IntakeError('Kirim sanasini tekshiring.');
  if (isAccountingMonthClosed(state.monthlyCloses,date)) throw new IntakeError('Bu oy yopilgan. Kirimni ochiq oyga kiriting.');
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 50) throw new IntakeError('1–50 ta mahsulot kiriting.');
  const inventory = rows(state.inventory);
  const lines = body.lines.map((line: Row) => {
    const planned = planIntakeLine(inventory,line,date);
    const item = inventory.find(i => i.id === planned.inventoryId);
    if (!item) throw new IntakeError(`«${planned.name}» omborda yo‘q. Avval mahsulotni yarating.`);
    if (item.catalogArchived) throw new IntakeError(`«${item.name}» ro‘yxatdan olib tashlangan. Avval tiklang.`);
    if (body.vegetableOnly === true && planned.destination !== 'vegetableExpense') throw new IntakeError('Tanlangan sana uchun mahsulot sabzavot va sous bo‘limida belgilanmagan.');
    return planned;
  });
  if (new Set(lines.map((l: Row) => l.inventoryId)).size !== lines.length) throw new IntakeError('Bir mahsulotni bitta qatorda yozing.');
  const total = lines.reduce((n: number,l: Row) => n + l.amount,0);
  if (!Number.isSafeInteger(total) || total > 1e11) throw new IntakeError('Jami narxni tekshiring.');
  const signature = (ls: Row[]) => JSON.stringify(ls.map(l => [l.inventoryId, Number(l.stockQuantity) > 0 ? Number(l.stockQuantity) : Number(l.quantity), Number(l.stockQuantity) > 0 ? '' : l.unit, Number(l.amount)]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const groups = new Map<string,Row[]>();
  for (const m of movements.filter(m => m.type === 'receipt' && Math.abs(Date.parse(m.date) - Date.parse(date)) <= 3 * 86_400_000)) {
    const key = m.warehouseOperationId || m.intakeId || m.referenceId || m.id;
    const item = inventory.find(i => i.id === m.inventoryId);
    const entry = {inventoryId:m.inventoryId,stockQuantity:m.purchaseBaseQuantity ?? m.quantity,quantity:m.purchaseQuantity ?? m.quantity,unit:m.purchaseUnit || item?.unit,amount:m.purchaseAmount ?? Math.round(Number(m.quantity) * Number(m.unitCost || 0))};
    groups.set(key,[...(groups.get(key)||[]),entry]);
  }
  const similar = [...groups].find(([,ls]) => signature(ls) === signature(lines));
  const reason = String(body.duplicateReason || '').trim();
  if (similar && (reason.length < 5 || reason.length > 300)) throw new IntakeError('Yaqin 3 kun ichida shu mahsulot, miqdor va narxda ombor kirimi bor. O‘sha mahsulot bo‘lsa, qayta saqlamang. Boshqa kirim bo‘lsa, tasdiqlang.', 'SIMILAR_PURCHASE');
  const now = new Date().toISOString();
  const additions = lines.map((l: Row,index: number) => ({
    id:`warehouse-stock:${operationId}:${index}`,warehouseOperationId:groupId,warehouseRequestKey:requestKey,
    supplierAccounting:'separate',type:'receipt',inventoryId:l.inventoryId,quantity:l.stockQuantity,date,
    purchaseQuantity:l.quantity,purchaseUnit:l.unit,purchaseAmount:l.amount,
    ...(l.stockQuantity > 0 ? {unitCost:l.amount/l.stockQuantity} : {}),
    previousUnitCost:Number(inventory.find(i => i.id === l.inventoryId)?.unitCost || 0),
    note:`Ombor kirimi · ${l.name}`,recordedAt:now,recordedBy:'Rahbar',
    ...(l.purchasedAt ? {purchasedAt:l.purchasedAt} : {}),
    ...(l.remainingBeforePurchase !== undefined ? {remainingBeforePurchase:l.remainingBeforePurchase} : {}),
    ...(similar ? {duplicateOf:similar[0],duplicateReason:reason} : {}),
  }));
  const stock = inventory.map(item => ({...item,stock:Number(item.stock) + additions.filter((m: Row) => m.inventoryId === item.id).reduce((n: number,m: Row) => n + m.quantity,0)}));
  const updated = receiptCostsForInventory(stock as any,[...additions,...movements] as any,{},new Set<string>(lines.map((l: Row) => l.inventoryId)));
  return {state:{...state,inventory:updated,stockMovements:[...additions,...movements]},result:{alreadySaved:false,id:groupId,amount:total}};
}
