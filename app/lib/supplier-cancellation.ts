import { supplierSourceDocument } from "./supplier-source.ts";
import { createDeletedItem } from './deleted-items.ts';
import { isAccountingMonthClosed } from './month-end.ts';
import { stableSupplierRecord, SupplierRecordSafetyError } from './supplier-record-safety.ts';

type Row = Record<string, any>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];

export function supplierCancellationBlock(state: Row, transaction: Row): string | null {
  const id = String(transaction.id || '');
  const linked = supplierSourceDocument(state, transaction) || transaction.intakeId || Array.isArray(transaction.intakeLines)
    || id.startsWith('delivery-purchase:')
    || rows(state.stockMovements).some(m => m.intakeId === id || m.transactionId === id)
    || rows(state.supplierDeliveries).some(d => d.paymentTransactionId === id);
  if (linked) return 'Bu asl yozuv ombor kirimiga bog‘langan. Takror kiritilgan alohida qarz yozuvini tanlang. Butun kirimni bekor qilish uchun Ombor → Tahrir va bekor qilish oynasidan foydalaning.';
  if (transaction.type === 'purchase' && rows(state.financialEntries).some(e => e.transactionId === id)) {
    return 'Bu xaridga pul yozuvi ham bog‘langan. Takror kiritilgan alohida qarz yozuvini tanlang.';
  }
  return null;
}

/** Cancel one selected ledger record, retaining its original payload for audit/restore. */
export function cancelSupplierTransaction(state: Row, input: Row, now = new Date()) {
  const fail = (message: string): never => { throw new SupplierRecordSafetyError(message); };
  const id = String(input.id || '');
  const operationId = String(input.operationId || '');
  const reason = String(input.reason || '').trim();
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(id) || !/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)) fail('Yozuv raqamini tekshiring.');
  if (reason.length < 3 || reason.length > 300) fail('Bekor qilish sababini yozing (3–300 belgi).');
  const archives = rows(state.deletedItems);
  const previous = archives.find(a => a.kind === 'transaction' && a.related?.supplierCancellation?.operationId === operationId);
  if (previous) {
    if (previous.entityId !== id || previous.reason !== reason
      || stableSupplierRecord(previous.record) !== stableSupplierRecord(input.expectedTransaction)
      || previous.related.supplierCancellation.previousBalance !== input.expectedBalance) fail('Bu amal boshqa ma’lumot bilan saqlangan. Oynani qayta oching.');
    if (previous.restoredAt) fail('Bu yozuv keyin tiklangan. Ro‘yxatdan qayta tanlang.');
    return { state, result: { alreadySaved: true, amount: previous.record.amount, balance: previous.related.supplierCancellation.balance } };
  }
  const matches = rows(state.transactions).filter(t => t.id === id);
  if (matches.length !== 1) fail('Yozuv topilmadi yoki oldin bekor qilingan. Ro‘yxatni yangilang.');
  const transaction = matches[0];
  if (stableSupplierRecord(transaction) !== stableSupplierRecord(input.expectedTransaction)) fail('Yozuv boshqa oynada o‘zgargan. Yangilab, qayta tanlang.');
  const blocked = supplierCancellationBlock(state, transaction);
  if (blocked) fail(blocked);
  if (isAccountingMonthClosed(state.monthlyCloses, transaction.date)) fail('Bu oy yopilgan. Avval oy hisobotini qayta oching.');
  const suppliers = rows(state.suppliers);
  const supplierMatches = suppliers.filter(s => s.id === transaction.supplierId);
  if (supplierMatches.length !== 1) fail('Yetkazib beruvchi topilmadi yoki takrorlangan.');
  const supplier = supplierMatches[0];
  if (supplier.balance !== input.expectedBalance) fail('Qarz boshqa oynada o‘zgargan. Yangi qoldiqni tekshirib, qayta tanlang.');
  if (!['purchase', 'payment'].includes(transaction.type) || !Number.isSafeInteger(transaction.amount) || transaction.amount <= 0
    || !Number.isSafeInteger(supplier.balance)) fail('Hisob summasini tekshiring; hech narsa bekor qilinmadi.');
  const balance = supplier.balance + (transaction.type === 'purchase' ? -transaction.amount : transaction.amount);
  if (!Number.isSafeInteger(balance)) fail('Qarz qoldig‘i hisoblanmadi.');
  const finances = rows(state.financialEntries);
  let payments = transaction.type === 'payment' ? finances.filter(e => e.transactionId === id) : [];
  if (transaction.type === 'payment' && !payments.length) payments = finances.filter(e => !e.transactionId && e.type === 'expense'
    && e.category === 'Mahsulot xaridi' && e.date === transaction.date && e.amount === transaction.amount
    && String(e.note || '').includes(supplier.name));
  if (payments.length > 1 || payments.some(e => e.reversedEntryId || e.amount !== transaction.amount)
    || finances.some(e => payments.some(p => e.reversedEntryId === p.id))) fail('Bog‘langan to‘lov yozuvlari bir xil emas. Tarixni tekshiring.');
  const financialEntry = payments[0];
  const archive = createDeletedItem({ kind: 'transaction', entityId: id, label: `${supplier.name} · ₩${transaction.amount.toLocaleString('en-US')}`,
    section: 'Oldi-berdi', record: transaction, reason, now,
    related: { ...(financialEntry ? { financialEntry } : {}), supplierCancellation: { operationId, previousBalance: supplier.balance, balance } } });
  return {
    state: { ...state, suppliers: suppliers.map(s => s.id === supplier.id ? { ...s, balance } : s),
      transactions: rows(state.transactions).filter(t => t.id !== id),
      financialEntries: financialEntry ? finances.filter(e => e.id !== financialEntry.id) : state.financialEntries,
      deletedItems: [archive, ...archives] },
    result: { alreadySaved: false, amount: transaction.amount, balance },
  };
}
