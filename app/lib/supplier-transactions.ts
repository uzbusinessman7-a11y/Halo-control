export type SupplierTransactionValue = {
  supplierId: string;
  type: "purchase" | "payment";
  amount: number;
};

export type SupplierLedgerTransaction = SupplierTransactionValue & {
  id: string;
  date: string;
  intakeId?: string;
};

export type SupplierPurchaseSettlement = {
  paidAmount: number;
  remainingAmount: number;
  status: "paid" | "partial" | "unpaid";
};
type SettlementSupplier = { id: string; openingBalance?: number; balanceEdits?: Array<{ at: string; openingBalance: number; previousOpeningBalance: number }> };

export type SupplierBalanceAudit = {
  supplierId: string;
  openingBalance: number;
  storedBalance: number;
  ledgerBalance: number;
  difference: number;
  valid: boolean;
  issue: string;
};

type SupplierBalanceRow = { id: string; name?: string; balance: number; openingBalance?: number; [key: string]: unknown };
type SupplierLedgerRow = { supplierId: string; type: "purchase" | "payment"; amount: number; [key: string]: unknown };

const isMezanaSupplier = (value: unknown) => /mezana/i.test(String(value || "").replace(/[’'`]/g, "").trim());

function supplierLedgerNet(transactions: SupplierLedgerRow[], supplierId: string) {
  const rows = transactions.filter((entry) => String(entry.supplierId || "") === supplierId);
  const invalidRow = rows.find((entry) => (
    (entry.type !== "purchase" && entry.type !== "payment")
    || !Number.isSafeInteger(Number(entry.amount))
    || Number(entry.amount) <= 0
  ));
  return {
    invalidRow,
    net: invalidRow ? 0 : rows.reduce((sum, entry) => (
      sum + (entry.type === "purchase" ? Number(entry.amount) : -Number(entry.amount))
    ), 0),
  };
}

/**
 * Supplier debt has one source of truth: active purchase/payment history.
 * A difference of even one won is intentionally reported.
 */
export function auditSupplierBalances(
  suppliersValue: unknown,
  transactionsValue: unknown,
): SupplierBalanceAudit[] {
  const suppliers = Array.isArray(suppliersValue)
    ? suppliersValue.filter((entry): entry is SupplierBalanceRow => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
  const transactions = Array.isArray(transactionsValue)
    ? transactionsValue.filter((entry): entry is SupplierLedgerRow => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
  const duplicateIds = new Set<string>();
  const seen = new Set<string>();
  suppliers.forEach((supplier) => {
    if (seen.has(String(supplier.id || ""))) duplicateIds.add(String(supplier.id || ""));
    seen.add(String(supplier.id || ""));
  });

  return suppliers.filter((supplier) => !isMezanaSupplier(supplier.name)).map((supplier) => {
    const supplierId = String(supplier.id || "");
    const { invalidRow, net } = supplierLedgerNet(transactions, supplierId);
    const openingBalance = Number(supplier.openingBalance ?? 0);
    const storedBalance = Number(supplier.balance);
    const ledgerBalance = invalidRow ? 0 : openingBalance + net;
    const valid = Boolean(supplierId)
      && !duplicateIds.has(supplierId)
      && Number.isSafeInteger(openingBalance)
      && Number.isSafeInteger(storedBalance)
      && !invalidRow;
    const issue = !supplierId
      ? "Yetkazib beruvchi ID raqami yo‘q."
      : duplicateIds.has(supplierId)
        ? "Yetkazib beruvchi ikki marta saqlangan."
        : !Number.isSafeInteger(openingBalance)
          ? "Boshlang‘ich qarz butun von emas."
        : !Number.isSafeInteger(storedBalance)
          ? "Saqlangan qarz butun von emas."
          : invalidRow
            ? "Kirim yoki to‘lov summasi noto‘g‘ri."
            : "";
    return {
      supplierId,
      openingBalance,
      storedBalance,
      ledgerBalance,
      difference: valid ? storedBalance - ledgerBalance : 0,
      valid,
      issue,
    };
  });
}

/**
 * Restores a pre-ledger supplier balance as an explicit opening balance.
 * Later purchases, edits and payments remain authoritative and are applied on top.
 */
export function restoreSupplierOpeningBalances<T extends Record<string, unknown>>(
  currentState: T,
  beforeReconciliationState: Record<string, unknown>,
) {
  const currentSuppliers = Array.isArray(currentState.suppliers) ? currentState.suppliers as SupplierBalanceRow[] : [];
  const previousSuppliers = Array.isArray(beforeReconciliationState.suppliers) ? beforeReconciliationState.suppliers as SupplierBalanceRow[] : [];
  const currentTransactions = Array.isArray(currentState.transactions) ? currentState.transactions as SupplierLedgerRow[] : [];
  const previousTransactions = Array.isArray(beforeReconciliationState.transactions) ? beforeReconciliationState.transactions as SupplierLedgerRow[] : [];
  const previousById = new Map(previousSuppliers.map((supplier) => [String(supplier.id || ""), supplier]));
  let restoredCount = 0;
  let restoredWon = 0;
  const suppliers = currentSuppliers.map((supplier) => {
    if (isMezanaSupplier(supplier.name)) return supplier;
    const supplierId = String(supplier.id || "");
    const previous = previousById.get(supplierId);
    if (!previous) return supplier;
    const previousLedger = supplierLedgerNet(previousTransactions, supplierId);
    const currentLedger = supplierLedgerNet(currentTransactions, supplierId);
    const previousBalance = Number(previous.balance);
    const savedOpening = Number(previous.openingBalance);
    const openingBalance = Number.isSafeInteger(savedOpening)
      ? savedOpening
      : previousBalance - previousLedger.net;
    const expectedBalance = openingBalance + currentLedger.net;
    if (previousLedger.invalidRow || currentLedger.invalidRow
      || !Number.isSafeInteger(previousBalance)
      || !Number.isSafeInteger(openingBalance)
      || !Number.isSafeInteger(expectedBalance)) return supplier;
    if (Number(supplier.openingBalance ?? 0) === openingBalance && Number(supplier.balance) === expectedBalance) return supplier;
    restoredCount += 1;
    restoredWon += Math.abs(expectedBalance - Number(supplier.balance || 0));
    return { ...supplier, openingBalance, balance: expectedBalance };
  });
  return {
    state: (restoredCount ? { ...currentState, suppliers } : currentState) as T,
    changed: restoredCount > 0,
    restoredCount,
    restoredWon,
  };
}

export function reconcileSupplierBalances<T extends Record<string, unknown>>(state: T) {
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers as SupplierBalanceRow[] : [];
  const audits = auditSupplierBalances(suppliers, state.transactions);
  const auditById = new Map(audits.map((audit) => [audit.supplierId, audit]));
  let repairedCount = 0;
  let repairedWon = 0;
  const nextSuppliers = suppliers.map((supplier) => {
    const audit = auditById.get(String(supplier.id || ""));
    if (!audit?.valid || audit.difference === 0) return supplier;
    repairedCount += 1;
    repairedWon += Math.abs(audit.difference);
    return { ...supplier, balance: audit.ledgerBalance };
  });
  return {
    state: (repairedCount ? { ...state, suppliers: nextSuppliers } : state) as T,
    changed: repairedCount > 0,
    repairedCount,
    repairedWon,
    invalidCount: audits.filter((audit) => !audit.valid).length,
  };
}

export function supplierTransactionEffect(value: SupplierTransactionValue) {
  const amount = Number(value.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return value.type === "purchase" ? amount : -amount;
}

export function rebalanceSuppliers<T extends { id: string; balance: number }>(
  suppliers: T[],
  previous: SupplierTransactionValue | null,
  next: SupplierTransactionValue | null,
): T[] | null {
  const supplierIds = new Set(suppliers.map((supplier) => supplier.id));
  if (!previous && !next) return null;
  if ((next && !supplierIds.has(next.supplierId)) || (previous && !supplierIds.has(previous.supplierId))) return null;
  if (next && !supplierTransactionEffect(next)) return null;

  const changes = new Map<string, number>();
  if (previous) {
    const previousEffect = supplierTransactionEffect(previous);
    if (!previousEffect) return null;
    changes.set(previous.supplierId, (changes.get(previous.supplierId) || 0) - previousEffect);
  }
  if (next) changes.set(next.supplierId, (changes.get(next.supplierId) || 0) + supplierTransactionEffect(next));

  if (suppliers.some((supplier) => !Number.isFinite(Number(supplier.balance) + (changes.get(supplier.id) || 0)))) return null;
  return suppliers.map((supplier) => ({
    ...supplier,
    balance: Number(supplier.balance) + (changes.get(supplier.id) || 0),
  }));
}

export function supplierPurchaseSettlements(
  transactions: SupplierLedgerTransaction[],
  throughDate?: string,
  suppliers: SettlementSupplier[] = [],
) {
  const result: Record<string, SupplierPurchaseSettlement> = {};
  const bySupplier = new Map<string, Array<SupplierLedgerTransaction & { sourceIndex: number }>>();
  transactions.forEach((transaction, sourceIndex) => {
    if (throughDate && transaction.date > throughDate) return;
    const rows = bySupplier.get(transaction.supplierId) || [];
    rows.push({ ...transaction, sourceIndex });
    bySupplier.set(transaction.supplierId, rows);
    if (transaction.type === "purchase") {
      const amount = Math.max(0, Number(transaction.amount) || 0);
      result[transaction.id] = {
        paidAmount: 0,
        remainingAmount: amount,
        status: "unpaid",
      };
    }
  });

  const openings = new Map(suppliers.map((supplier) => {
    let opening = Number(supplier.openingBalance || 0);
    for (const edit of supplier.balanceEdits || []) {
      const at = new Date(edit.at);
      if (!throughDate || !Number.isFinite(at.getTime())
        || !Number.isFinite(edit.openingBalance) || !Number.isFinite(edit.previousOpeningBalance)) continue;
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
      if (date > throughDate) opening -= edit.openingBalance - edit.previousOpeningBalance;
    }
    return [supplier.id, opening];
  }));
  bySupplier.forEach((rows, supplierId) => {
    const ordered = rows.sort((left, right) => (
      left.date.localeCompare(right.date)
      // Stored ledger rows are newest first. For the same date, the higher
      // original index is older and must be settled first.
      || right.sourceIndex - left.sourceIndex
    ));
    const opening = openings.get(supplierId) || 0;
    // Opening debt predates every imported invoice. A payment cannot settle
    // a newer invoice while that older obligation remains unpaid.
    let openingDebt = Math.max(0, opening);
    let advanceCredit = Math.max(0, -opening);
    const openPurchases: Array<{ id: string; remaining: number }> = [];
    const purchasesById = new Map(rows.filter((row) => row.type === "purchase").map((row) => [row.id, row]));
    ordered.forEach((transaction) => {
      const amount = Math.max(0, Number(transaction.amount) || 0);
      if (!amount) return;
      if (transaction.type === "purchase") {
        const reserved = result[transaction.id].paidAmount;
        const applied = Math.min(amount - reserved, advanceCredit);
        const remaining = Math.max(0, amount - reserved - applied);
        advanceCredit = Math.max(0, advanceCredit - applied);
        result[transaction.id] = {
          paidAmount: reserved + applied,
          remainingAmount: remaining,
          status: remaining <= 0.000001 ? "paid" : reserved + applied > 0 ? "partial" : "unpaid",
        };
        if (remaining > 0.000001) openPurchases.push({ id: transaction.id, remaining });
        return;
      }
      let payment = amount;
      // A receipt's explicitly linked payment settles that receipt. Only an
      // unallocated payment follows oldest-debt-first, including opening debt.
      const targetId = transaction.intakeId || (transaction.id.startsWith("paid:") ? transaction.id.slice(5) : "");
      if (purchasesById.has(targetId)) {
        const target = result[targetId];
        const applied = Math.min(payment, target.remainingAmount);
        target.paidAmount += applied;
        target.remainingAmount -= applied;
        target.status = target.remainingAmount === 0 ? "paid" : "partial";
        payment -= applied;
        const open = openPurchases.find((purchase) => purchase.id === targetId);
        if (open) open.remaining = target.remainingAmount;
      }
      const openingPayment = Math.min(payment, openingDebt);
      openingDebt -= openingPayment;
      payment -= openingPayment;
      while (payment > 0 && openPurchases.length) {
        const purchase = openPurchases[0];
        const applied = Math.min(payment, purchase.remaining);
        purchase.remaining -= applied;
        payment -= applied;
        const settlement = result[purchase.id];
        if (settlement) {
          settlement.paidAmount += applied;
          settlement.remainingAmount = Math.max(0, purchase.remaining);
          settlement.status = purchase.remaining <= 0.000001 ? "paid" : "partial";
        }
        if (purchase.remaining <= 0.000001) {
          openPurchases.shift();
        }
      }
      advanceCredit += payment;
    });
  });

  return result;
}

export function supplierPurchaseStatuses(transactions: SupplierLedgerTransaction[], suppliers: SettlementSupplier[] = []) {
  return Object.fromEntries(Object.entries(supplierPurchaseSettlements(transactions, undefined, suppliers)).map(([id, settlement]) => [
    id,
    settlement.status === "paid" ? "paid" : "unpaid",
  ])) as Record<string, "paid" | "unpaid">;
}
