/**
 * Yagona butun won qoidasi (1₩ nazorati).
 *
 * Retsept tannarxi kasr bo'lishi mumkin (masalan 1 234,6₩) va savdoda shunday
 * saqlanadi. Saqlangan qiymat o'zgartirilmaydi. Lekin har qanday jami
 * hisoblanganda har bir yozuv avval BIR MARTA butun wonga yaxlitlanadi, keyin
 * qo'shiladi. Kunlik hisobot (daily-report.ts) aynan shu qoidadan foydalanadi,
 * shuning uchun bosh sahifa, tarix, eksport va hisobot bir xil summani ko'rsatadi.
 */
type Row = Record<string, unknown>;

export function wholeWon(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

export function sumWholeWon<T = Row>(rows: readonly T[], pick: (row: T) => unknown): number {
  return rows.reduce((sum, row) => sum + wholeWon(pick(row)), 0);
}
