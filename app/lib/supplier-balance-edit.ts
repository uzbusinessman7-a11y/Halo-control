type Row = Record<string, any>;
export class SupplierBalanceEditError extends Error {}

/** Reconcile the opening component, never fabricate a purchase or payment. */
export function editSupplierBalance(state: Row, input: Row, now = new Date().toISOString()) {
  const suppliers: Row[] = state.suppliers || [];
  const matches = suppliers.filter(s => s.id === input.supplierId);
  if (matches.length !== 1) throw new SupplierBalanceEditError('Yetkazib beruvchi topilmadi yoki takrorlangan.');
  const supplier = matches[0];
  const target = input.balance;
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  if (typeof target !== 'number' || !Number.isSafeInteger(target) || Math.abs(target) > 100_000_000_000 || !reason) {
    throw new SupplierBalanceEditError('Qoldiqni butun vonda va tuzatish sababini kiriting.');
  }
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(input.id)) throw new SupplierBalanceEditError('Tuzatish ID noto‘g‘ri.');
  const history: Row[] = supplier.balanceEdits || [];
  const previous = history.find(e => e.id === input.id);
  if (previous) {
    if (previous.balance !== target || previous.reason !== reason) throw new SupplierBalanceEditError('Bu tuzatish oldin boshqa ma’lumot bilan saqlangan.');
    return { state, result: { alreadySaved: true } };
  }
  // Buzilgan (son bo'lmagan) qoldiq ham shu oynadan to'g'rilanadi: solishtirish NaN'ga chidamli.
  if (!Object.is(supplier.balance, input.expectedBalance) || !Object.is(Number(supplier.openingBalance || 0), input.expectedOpeningBalance)) {
    throw new SupplierBalanceEditError('Qarz boshqa joyda o‘zgargan. Sahifani yangilab, qoldiqni tekshiring.');
  }
  const transactions: Row[] = (state.transactions || []).filter((t: Row) => t.supplierId === supplier.id);
  let net = 0;
  for (const t of transactions) {
    if (!['purchase', 'payment'].includes(t.type) || !Number.isSafeInteger(t.amount) || t.amount <= 0) throw new SupplierBalanceEditError('Oldi-berdi tarixida noto‘g‘ri summa bor. Avval shu yozuvni tekshiring.');
    net += t.type === 'purchase' ? t.amount : -t.amount;
  }
  const openingBalance = target - net;
  // Eski qoldiq buzilgan bo'lsa (son emas) — tuzatishga ruxsat; tarixda 0 dan deb yoziladi va asl qiymat saqlanadi.
  const beforeBalance = Number.isSafeInteger(supplier.balance) ? supplier.balance : null;
  const beforeOpening = Number.isSafeInteger(Number(supplier.openingBalance || 0)) ? Number(supplier.openingBalance || 0) : null;
  if (![net, openingBalance].every(Number.isSafeInteger)) throw new SupplierBalanceEditError('Hisob summasi noto‘g‘ri.');
  const broken = beforeBalance === null || beforeOpening === null;
  const entry = { id: input.id, at: now, actor: 'Rahbar', reason, previousBalance: beforeBalance ?? 0, balance: target,
    previousOpeningBalance: beforeOpening ?? 0, openingBalance, difference: target - (beforeBalance ?? 0),
    ...(broken ? { repairedBrokenBalance: { balance: String(supplier.balance ?? ''), openingBalance: String(supplier.openingBalance ?? '') } } : {}) };
  const updated = { ...supplier, balance: target, openingBalance, balanceEdits: [entry, ...history] };
  return { state: { ...state, suppliers: suppliers.map(s => s.id === supplier.id ? updated : s) }, result: { alreadySaved: false, supplier: updated } };
}
