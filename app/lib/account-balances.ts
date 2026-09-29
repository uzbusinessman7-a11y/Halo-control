import { selectActiveFinancialEntries } from './daily-report.ts';
type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
const won = (v: unknown) => Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0;
/** Money only. Non-cash expense recognition remains in the profit report. */
export function calculateAccountBalances(state: Row, through: string) {
  const balances = new Map<string, number>(rows(state.accounts).map(a => [String(a.id), won(a.openingBalance)]));
  const unmatched: string[] = [];
  for (const sale of rows(state.sales)) {
    if (sale.date > through || sale.cancelledAt || sale.voided || ['cancelled', 'voided'].includes(sale.status)) continue;
    const accountId = sale.accountId ?? 'account-card';
    if (!balances.has(accountId)) { unmatched.push(String(sale.id || 'sale')); continue; }
    balances.set(accountId, balances.get(accountId)! + won(sale.totalRevenue));
  }
  for (const entry of selectActiveFinancialEntries(rows(state.financialEntries))) {
    if (entry.date > through || entry.nonCash === true) continue;
    if (!['income', 'expense', 'transfer'].includes(entry.type)) continue;
    if (!balances.has(entry.accountId) || (entry.type === 'transfer' && !balances.has(entry.toAccountId))) {
      unmatched.push(String(entry.id || 'entry')); continue;
    }
    const amount = won(entry.amount);
    balances.set(entry.accountId, balances.get(entry.accountId)! + (entry.type === 'income' ? amount : -amount));
    if (entry.type === 'transfer') balances.set(entry.toAccountId, balances.get(entry.toAccountId)! + amount);
  }
  return { balances, total: [...balances.values()].reduce((sum, n) => sum + n, 0), unmatched };
}
