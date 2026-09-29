import { supplierSourceDocument } from "./supplier-source.ts";
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((v) => v && typeof v === 'object' && !Array.isArray(v)) : [];
const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');

export class SupplierRecordSafetyError extends Error {
  status = 409;
  readonly code: string;
  readonly duplicate?: Row;
  constructor(message: string, code = 'SUPPLIER_RECORD_CONFLICT', duplicate?: Row) {
    super(message);
    this.name = 'SupplierRecordSafetyError';
    this.code = code;
    this.duplicate = duplicate;
  }
}

export function stableSupplierRecord(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSupplierRecord).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableSupplierRecord(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

// Compare submitted business fields, not server-added audit metadata.
export function sameSupplierTransaction(left: Row, right: Row) {
  return ['id', 'supplierId', 'type', 'date'].every((key) => left[key] === right[key])
    && Number(left.amount) === Number(right.amount)
    && clean(left.note) === clean(right.note)
    && (left.type !== 'payment' || left.accountId === right.accountId)
    && stableSupplierRecord(left.document ?? null) === stableSupplierRecord(right.document ?? null);
}

export function confirmSupplierDuplicate(state: Row, transaction: Row, reasonValue: unknown) {
  const duplicate = rows(state.transactions).find((entry) => entry.id !== transaction.id
    && entry.supplierId === transaction.supplierId && entry.type === transaction.type
    && Number(entry.amount) === Number(transaction.amount)
    && (entry.date === transaction.date || (transaction.type === 'purchase' && Math.abs(Date.parse(String(entry.date)) - Date.parse(String(transaction.date))) <= 3 * 86_400_000)));
  if (!duplicate) return {};
  const reason = clean(reasonValue).slice(0, 300);
  if (reason.length < 5) {
    throw new SupplierRecordSafetyError(
      `${duplicate.date} kuni shu yetkazib beruvchi uchun ${Number(transaction.amount).toLocaleString('en-US')}₩ ${transaction.type === 'purchase' ? 'xarid' : 'to‘lov'} allaqachon bor. Bu boshqa xarid yoki to‘lov bo‘lsa, sababini yozib tasdiqlang.`,
      'SIMILAR_SUPPLIER_TRANSACTION',
      { id: duplicate.id, supplierId: duplicate.supplierId, date: duplicate.date, amount: duplicate.amount, type: duplicate.type },
    );
  }
  return { duplicateOf: duplicate.id, duplicateReason: reason, duplicateConfirmedAt: new Date().toISOString() };
}

export function verifySupplierWrite(state: Row, transaction: Row, body: Row) {
  const original = rows(state.transactions).find((entry) => entry.id === transaction.id);
  if (original) {
    if (sameSupplierTransaction(original, transaction)) return { original, alreadySaved: true, duplicateMetadata: {} };
    if (body.edit !== true) throw new SupplierRecordSafetyError('Bu amal ID raqami boshqa ma’lumot bilan oldin saqlangan. Tarixni yangilang; qayta qarz yozilmadi.');
    if (stableSupplierRecord(body.expectedTransaction) !== stableSupplierRecord(original)) {
      throw new SupplierRecordSafetyError('Bu yozuv boshqa qurilmada o‘zgargan. Tarixni yangilang va qayta tekshiring.');
    }
    if (supplierSourceDocument(state, original) || String(original.id).startsWith('delivery-purchase:')) {
      throw new SupplierRecordSafetyError('Bu eski yozuv ombor kirimiga bog‘langan. Uni “Ombor kirimlari” oynasidan tahrirlang.');
    }
  } else {
    if (body.edit === true) throw new SupplierRecordSafetyError('Tahrirlanayotgan yozuv topilmadi. Sahifani yangilang.');
    if (rows(state.deletedItems).some((entry) => entry.id === transaction.id || (entry.record && typeof entry.record === 'object' && (entry.record as Row).id === transaction.id))) {
      throw new SupplierRecordSafetyError('Bu yozuv bekor qilingan. Eski so‘rov qayta qarz yaratmaydi.');
    }
  }
  return { original, alreadySaved: false, duplicateMetadata: confirmSupplierDuplicate(state, transaction, body.duplicateReason) };
}
