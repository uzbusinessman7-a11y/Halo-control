import { isAdminRequest } from "../../lib/integration-store";
import { HaloStateConflictError, mutateHaloState } from "../../lib/halo-store";
import { isAccountingMonthClosed } from "../../lib/month-end";
import { rebalanceSuppliers } from "../../lib/supplier-transactions";
import { validStockDocument } from "../../lib/stock-documents";
import { receiptCostsForInventory } from "../../lib/stock-movements";
import { validSupplierDelivery, type SupplierDelivery } from "../../lib/supplier-deliveries";

import { editSupplierBalance, SupplierBalanceEditError } from "../../lib/supplier-balance-edit";
import { confirmSupplierDuplicate, sameSupplierTransaction, SupplierRecordSafetyError, verifySupplierWrite } from "../../lib/supplier-record-safety";
import { cancelSupplierTransaction } from "../../lib/supplier-cancellation";
import { seoulCalendarDate } from "../../lib/business-time";

type Row = Record<string, unknown>;

class SupplierRecordError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "SupplierRecordError";
  }
}

const rows = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is Row => (
  Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
)) : [];
const clean = (value: unknown, max: number) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
const safeId = (value: unknown, label: string) => {
  const id = clean(value, 100);
  if (!id || !/^[a-zA-Z0-9:_-]+$/.test(id)) throw new SupplierRecordError(`${label} noto‘g‘ri.`);
  return id;
};
const safeDate = (value: unknown) => {
  const date = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date || date > seoulCalendarDate()) throw new SupplierRecordError("Sanani tekshiring.");
  return date;
};
const safeAmount = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000_000) {
    throw new SupplierRecordError("Summani tekshiring.");
  }
  return amount;
};

function supplierName(state: Row, supplierId: string) {
  return clean(rows(state.suppliers).find((entry) => entry.id === supplierId)?.name, 100) || "Yetkazib beruvchi";
}

function linkedPayment(state: Row, transaction: Row) {
  const financialEntries = rows(state.financialEntries);
  const direct = financialEntries.filter((entry) => entry.transactionId === transaction.id);
  if (direct.length > 1) throw new SupplierRecordError("Bu to‘lovga bir nechta pul yozuvi bog‘langan. Tarixni tekshiring.", 409);
  if (direct.length === 1) return direct[0];
  if (transaction.type !== "payment") return undefined;
  const name = supplierName(state, String(transaction.supplierId || ""));
  const legacy = financialEntries.filter((entry) => (
    !entry.transactionId
    && entry.type === "expense"
    && entry.category === "Mahsulot xaridi"
    && entry.date === transaction.date
    && Number(entry.amount) === Number(transaction.amount)
    && String(entry.note || "").includes(name)
  ));
  if (legacy.length > 1) throw new SupplierRecordError("Bir xil eski to‘lovlar topildi. Noto‘g‘ri pul yozuvini o‘zgartirmaslik uchun tarixni tekshiring.", 409);
  return legacy[0];
}

function ensureOpenMonth(state: Row, date: string) {
  if (isAccountingMonthClosed(state.monthlyCloses, date)) {
    throw new SupplierRecordError(`${date.slice(0, 7)} oyi yopilgan. Yozuvni ochiq oyga kiriting.`, 409);
  }
}

function saveSupplier(state: Row, body: Row) {
  const input = body.supplier;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SupplierRecordError("Yetkazib beruvchi ma’lumotini tekshiring.");
  const supplier = input as Row;
  const id = safeId(supplier.id, "Yetkazib beruvchi ID");
  const name = clean(supplier.name, 100);
  if (!name) throw new SupplierRecordError("Yetkazib beruvchi nomini kiriting.");
  const current = rows(state.suppliers);
  const existing = current.find((entry) => entry.id === id);
  const next = {
    ...(existing || {}),
    id,
    name,
    phone: clean(supplier.phone, 60),
    bankAccount: clean(supplier.bankAccount, 120),
    telegramChatId: clean(supplier.telegramChatId ?? existing?.telegramChatId, 100),
    autoOrder: Boolean(supplier.autoOrder ?? existing?.autoOrder),
    balance: Number(existing?.balance || 0),
  };
  if (!next.telegramChatId) next.autoOrder = false;
  return {
    state: { ...state, suppliers: existing ? current.map((entry) => entry.id === id ? next : entry) : [next, ...current] },
    result: { supplier: next, alreadySaved: Boolean(existing && JSON.stringify(existing) === JSON.stringify(next)) },
  };
}

function saveTransaction(state: Row, body: Row) {
  const input = body.transaction;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SupplierRecordError("Oldi-berdi ma’lumotini tekshiring.");
  const value = input as Row;
  const id = safeId(value.id, "Oldi-berdi ID");
  const supplierId = safeId(value.supplierId, "Yetkazib beruvchi");
  const type = clean(value.type, 20);
  if (type !== "purchase" && type !== "payment") throw new SupplierRecordError("Harakat turini tekshiring.");
  const amount = safeAmount(value.amount);
  const date = safeDate(value.date);
  const suppliers = rows(state.suppliers) as Array<Row & { id: string; balance: number }>;
  if (!suppliers.some((entry) => entry.id === supplierId)) throw new SupplierRecordError("Yetkazib beruvchi topilmadi. Sahifani yangilang.", 409);
  const transactions = rows(state.transactions);
  const document = type === "purchase" && value.document && validStockDocument(value.document) ? value.document : undefined;
  if (type === "purchase" && value.document && !document) throw new SupplierRecordError("Nakladnoy rasmini tekshiring.");
  const submitted = {
    id,
    supplierId,
    type,
    amount,
    date,
    note: clean(value.note, 200),
    ...(type === "payment" ? { accountId: safeId(value.accountId, "To‘lov hisobi") } : {}),
    ...(document ? { document } : {}),
  };
  const safety = verifySupplierWrite(state, submitted, body);
  const original = safety.original;
  if (safety.alreadySaved) return { state, result: { transaction: original!, alreadySaved: true } };
  if (original && original.type !== type) throw new SupplierRecordError("Kirim turini to‘lovga yoki to‘lovni kirimga aylantirib bo‘lmaydi.", 409);
  ensureOpenMonth(state, date);
  if (original && original.date !== date) ensureOpenMonth(state, String(original.date || ""));
  const transaction = {
    ...(original || {}), ...submitted,
    ...(!original ? { supplierLedgerOnly: true, recordedAt: new Date().toISOString() } : {}),
    ...safety.duplicateMetadata,
  };
  if (!document) delete (transaction as Row).document;
  const accounts = rows(state.accounts);
  if (type === "payment" && !accounts.some((entry) => entry.id === transaction.accountId)) {
    throw new SupplierRecordError("To‘lov hisobi topilmadi.");
  }
  const nextSuppliers = rebalanceSuppliers(suppliers, original ? original as never : null, transaction as never);
  if (!nextSuppliers) throw new SupplierRecordError("Yetkazib beruvchi balansi hisoblanmadi.", 409);
  if (nextSuppliers.some((supplier) => (supplier.id === supplierId || supplier.id === original?.supplierId) && !Number.isSafeInteger(Number(supplier.balance)))) throw new SupplierRecordError("Qarz qoldig‘i butun von bilan mos kelmadi. Tarixni tekshiring; hech narsa saqlanmadi.", 409);
  const previousPayment = original ? linkedPayment(state, original) : undefined;
  // A purchase is only a supplier-ledger entry. Do not rewrite its historical
  // warehouse expense or post another profit expense here.
  let financialEntries = rows(state.financialEntries);
  if (type === "payment") {
    financialEntries = financialEntries.filter((entry) => entry.transactionId !== id && entry.id !== previousPayment?.id);
    const entry = {
      id: String(previousPayment?.id || `supplier-payment:${id}`),
      type: "expense",
      category: "Mahsulot xaridi",
      amount,
      date,
      accountId: transaction.accountId,
      note: `${supplierName(state, supplierId)} · yetkazuvchiga to‘lov`,
      affectsProfit: false,
      transactionId: id,
    };
    financialEntries = [entry, ...financialEntries];
  }
  return {
    state: {
      ...state,
      suppliers: nextSuppliers,
      transactions: original ? transactions.map((entry) => entry.id === id ? transaction : entry) : [transaction, ...transactions],
      financialEntries,
    },
    result: { transaction, alreadySaved: false },
  };
}

function payFullDebt(state: Row, body: Row) {
  const supplierId = safeId(body.supplierId, "Yetkazib beruvchi");
  const accountId = safeId(body.accountId, "To‘lov hisobi");
  const operationId = safeId(body.operationId, "Amal ID");
  const transactionId = `supplier-full-payment:${operationId}`;
  const existing = rows(state.transactions).find((entry) => entry.id === transactionId);
  if (existing) {
    if (existing.supplierId !== supplierId || existing.accountId !== accountId || existing.date !== safeDate(body.date)) throw new SupplierRecordSafetyError("Bu to‘lov amali boshqa ma’lumot bilan oldin saqlangan.");
    return { state, result: { transaction: existing, alreadySaved: true } };
  }
  const supplier = rows(state.suppliers).find((entry) => entry.id === supplierId);
  if (!supplier) throw new SupplierRecordError("Yetkazib beruvchi topilmadi.", 409);
  const amount = Number(supplier.balance || 0);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new SupplierRecordError("Bu yetkazib beruvchi bo‘yicha ochiq qarz yo‘q.", 409);
  return saveTransaction(state, {
    duplicateReason: body.duplicateReason,
    transaction: {
      id: transactionId,
      supplierId,
      type: "payment",
      amount,
      date: safeDate(body.date),
      note: "Qarz to‘liq to‘landi",
      accountId,
    },
  });
}

function savePurchaseAndPayment(state: Row, body: Row) {
  const input = body.transaction;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SupplierRecordError("Mahsulot kirimi ma’lumotini tekshiring.");
  }
  const purchase = input as Row;
  const purchaseId = safeId(purchase.id, "Kirim ID");
  if (clean(purchase.type, 20) !== "purchase") throw new SupplierRecordError("Faqat mahsulot kirimini darhol to‘lash mumkin.");
  const paymentId = `paid:${purchaseId}`;
  const transactions = rows(state.transactions);
  const existingPurchase = transactions.find((entry) => entry.id === purchaseId);
  const existingPayment = transactions.find((entry) => entry.id === paymentId);
  if (existingPurchase && existingPayment) {
    if (!sameSupplierTransaction(existingPurchase, purchase)
      || existingPayment.accountId !== body.accountId || Number(existingPayment.amount) !== Number(purchase.amount)
      || existingPayment.supplierId !== purchase.supplierId || existingPayment.date !== purchase.date) {
      throw new SupplierRecordSafetyError("Bu kirim amali boshqa ma’lumot bilan oldin saqlangan. Qayta qarz yoki to‘lov yaratilmadi.");
    }
    return { state, result: { transaction: existingPurchase, payment: existingPayment, alreadySaved: true } };
  }
  if (existingPurchase || existingPayment) {
    throw new SupplierRecordError("Bu kirim qisman saqlangan. Takror hisoblanmadi; tarixni tekshiring.", 409);
  }
  const purchased = saveTransaction(state, { transaction: purchase, duplicateReason: body.duplicateReason });
  const paid = saveTransaction(purchased.state, {
    duplicateReason: body.duplicateReason,
    transaction: {
      id: paymentId,
      supplierId: purchase.supplierId,
      type: "payment",
      amount: purchase.amount,
      date: purchase.date,
      note: `${clean(purchase.note, 150) || "Mahsulot olindi"} · darhol to‘landi`,
      accountId: body.accountId,
    },
  });
  return {
    state: paid.state,
    result: { transaction: purchased.result.transaction, payment: paid.result.transaction, alreadySaved: false },
  };
}

function approveDelivery(state: Row, body: Row) {
  const deliveryId = safeId(body.deliveryId, "Yetkazma ID");
  const deliveries = rows(state.supplierDeliveries);
  const delivery = deliveries.find((entry) => entry.id === deliveryId);
  if (!delivery || !validSupplierDelivery(delivery)) throw new SupplierRecordError("Xodim yetkazmasi topilmadi yoki ma’lumoti buzilgan.", 409);
  if (delivery.status === "approved") return { state, result: { delivery, alreadySaved: true } };
  ensureOpenMonth(state, delivery.date);
  const typedDelivery = delivery as SupplierDelivery;
  const suppliers = rows(state.suppliers) as Array<Row & { id: string; balance: number }>;
  if (!suppliers.some((entry) => entry.id === typedDelivery.supplierId)) throw new SupplierRecordError("Yetkazib beruvchi topilmadi.", 409);
  const inventory = rows(state.inventory) as Array<Row & { id: string; stock: number; unitCost: number; packageCost: number; unitsPerPackage: number }>;
  const missing = typedDelivery.lines.find((line) => !inventory.some((item) => item.id === line.inventoryId));
  if (missing) throw new SupplierRecordError(`“${missing.name}” Ombor bazasida topilmadi.`, 409);
  const transactionId = `delivery-purchase:${typedDelivery.id}`;
  const movementIds = new Set(typedDelivery.lines.map((line) => `delivery-receipt:${typedDelivery.id}:${line.inventoryId}`));
  const transactions = rows(state.transactions);
  const stockMovements = rows(state.stockMovements).map((entry) => ({ ...entry, id: String(entry.id), inventoryId: String(entry.inventoryId), type: String(entry.type), date: String(entry.date) }));
  if (transactions.some((entry) => entry.id === transactionId) || stockMovements.some((entry) => movementIds.has(String(entry.id || "")))) {
    throw new SupplierRecordError("Bu yetkazma qisman oldin qo‘shilgan. Takror hisoblanmadi; tarixni tekshiring.", 409);
  }
  const transaction = {
    id: transactionId,
    supplierId: typedDelivery.supplierId,
    type: "purchase" as const,
    amount: typedDelivery.totalAmount,
    date: typedDelivery.date,
    note: `Xodim kiritgan nakladnoy · ${typedDelivery.createdByName}`,
    ...(typedDelivery.document ? { document: typedDelivery.document } : {}),
    ...confirmSupplierDuplicate(state, { id: transactionId, supplierId: typedDelivery.supplierId, type: "purchase", amount: typedDelivery.totalAmount, date: typedDelivery.date }, body.duplicateReason),
  };
  const nextSuppliers = rebalanceSuppliers(suppliers, null, transaction);
  if (!nextSuppliers) throw new SupplierRecordError("Yetkazuvchi qarzi hisoblanmadi.", 409);
  const newMovements = typedDelivery.lines.map((line) => {
    const item = inventory.find((entry) => entry.id === line.inventoryId)!;
    return {
      id: `delivery-receipt:${typedDelivery.id}:${line.inventoryId}`,
      inventoryId: line.inventoryId,
      type: "receipt",
      quantity: line.quantity,
      date: typedDelivery.date,
      note: `XODIM KIRIMI · ${supplierName(state, typedDelivery.supplierId)} · ${line.name}`,
      referenceId: typedDelivery.id,
      supplierId: typedDelivery.supplierId,
      unitCost: line.totalAmount / line.quantity,
      previousUnitCost: Number(item.unitCost || 0),
      ...(typedDelivery.document ? { document: typedDelivery.document } : {}),
    };
  });
  const affectedIds = new Set(typedDelivery.lines.map((line) => line.inventoryId));
  const inventoryWithStock = inventory.map((item) => {
    const line = typedDelivery.lines.find((entry) => entry.inventoryId === item.id);
    return line ? { ...item, stock: Number(item.stock || 0) + line.quantity, supplierId: typedDelivery.supplierId } : item;
  });
  const nextMovements = [...newMovements, ...stockMovements];
  const nextInventory = receiptCostsForInventory(inventoryWithStock, nextMovements, {}, affectedIds);
  const approvedAt = new Date().toISOString();
  const approved = { ...delivery, status: "approved", approvedAt };
  return {
    state: {
      ...state,
      inventory: nextInventory,
      stockMovements: nextMovements,
      suppliers: nextSuppliers,
      transactions: [transaction, ...transactions],
      supplierDeliveries: deliveries.map((entry) => entry.id === deliveryId ? approved : entry),
    },
    result: { delivery: approved, alreadySaved: false },
  };
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: "Kirish taqiqlangan." }, { status: 401 });
  try {
    const branchId = new URL(request.url).searchParams.get("branch") || "main";
    const body = await request.json() as Row;
    const action = clean(body.action, 30);
    const mutation = await mutateHaloState<ReturnType<typeof cancelSupplierTransaction | typeof editSupplierBalance | typeof saveSupplier | typeof saveTransaction | typeof savePurchaseAndPayment | typeof payFullDebt | typeof approveDelivery>["result"]>((state) => {
      if (action === "editBalance") {
        ensureOpenMonth(state, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }));
        return editSupplierBalance(state, body);
      }
      if (action === "cancelTransaction") return cancelSupplierTransaction(state, body);
      if (action === "saveSupplier") return saveSupplier(state, body);
      if (action === "saveTransaction") return saveTransaction(state, body);
      if (action === "savePurchaseAndPayment") return savePurchaseAndPayment(state, body);
      if (action === "payFullDebt") return payFullDebt(state, body);
      if (action === "approveDelivery") return approveDelivery(state, body);
      throw new SupplierRecordError("Noto‘g‘ri yetkazib beruvchi amali.");
    }, 7, branchId, "Rahbar", action === "cancelTransaction" ? "Yetkazib beruvchi yozuvi bekor qilindi. Asl yozuv, sabab va qarz o‘zgarishi tarixda saqlandi" : action === "editBalance" ? "Rahbar qarz qoldig‘ini tahrirladi. Sabab va summalar yetkazib beruvchi tarixida saqlandi" : action === "saveSupplier" ? "Yetkazib beruvchi ma’lumoti saqlandi" : action === "savePurchaseAndPayment" ? "Mahsulot kirimi va darhol to‘lov birga saqlandi" : action === "payFullDebt" ? "Yetkazib beruvchi qarzi to‘liq to‘landi" : action === "approveDelivery" ? "Xodim yetkazmasi ombor va qarzga qo‘shildi" : "Yetkazib beruvchi oldi-berdisi saqlandi", "Oldi-berdi");
    return Response.json({ ok: true, updatedAt: mutation.updatedAt, ...mutation.result });
  } catch (error) {
    if (error instanceof SupplierBalanceEditError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof SupplierRecordSafetyError) return Response.json({ error: error.message, code: error.code, ...(error.duplicate ? { duplicate: error.duplicate } : {}) }, { status: error.status });
    if (error instanceof SupplierRecordError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof HaloStateConflictError) return Response.json({ error: "Ma’lumot boshqa qurilmada yangilandi. Qayta urinib ko‘ring." }, { status: 409 });
    return Response.json({ error: "Yetkazib beruvchi yozuvi saqlanmadi. Qayta urinib ko‘ring." }, { status: 500 });
  }
}
