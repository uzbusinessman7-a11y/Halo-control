/**
 * Formats an amount by its effect on profit: a positive expense is money out,
 * while a negative expense is a contra-expense that adds back to profit.
 */
export function formatExpenseEffectWon(value: unknown): string {
  const parsed = Number(value);
  const rounded = Number.isFinite(parsed) ? Math.round(parsed) : 0;
  if (rounded === 0) return "₩0";
  const sign = rounded > 0 ? "−" : "＋";
  return `${sign}₩${Math.abs(rounded).toLocaleString("en-US")}`;
}
