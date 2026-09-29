import { mezanaNameKey } from './mezana-posting.ts';

type Item = { name: string; unit: string; packageName?: string; unitsPerPackage?: number };
export const findIntakeProduct = <T extends Item>(inventory: T[], name: string) =>
  inventory.find(item => mezanaNameKey(item.name) === mezanaNameKey(name));

export function intakeUnitOptions(item?: Item) {
  return [...new Set([item?.unit, item?.packageName, 'dona', 'g', 'kg', 'ml', 'litr', 'qadoq', 'quti', 'kalla', 'banka', 'paket'].filter(Boolean))] as string[];
}

export function intakeFormProblems(input: {
  inventoryOnly?: boolean;
  supplier: string; date: string; paid: string; total: number;
  accountId: string; accounts: { id: string }[];
  plans: { error: string; line: { destination: string } | null }[];
  lines: { name: string; expenseConfirmed?: boolean }[];
  similar: boolean; duplicateReason: string;
}) {
  const problems: string[] = [];
  if (!input.inventoryOnly && !input.supplier.trim()) problems.push('Kimdan olinganini yozing.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date) problems.push('Xarid sanasini kiriting.');
  input.plans.forEach((plan, index) => {
    if (plan.error) problems.push(`${index + 1}-mahsulot: ${plan.error}`);
    else if (plan.line?.destination === 'expense' && (input.inventoryOnly || !input.lines[index].expenseConfirmed)) problems.push(`«${input.lines[index].name}» omborda yo‘q. Avval mahsulot yarating.`);
  });
  const names = input.lines.map(line => mezanaNameKey(line.name)).filter(Boolean);
  if (new Set(names).size !== names.length) problems.push('Bir mahsulotni bitta qatorda jami miqdor va summa bilan kiriting.');
  if (!input.inventoryOnly) {
  if (input.paid === '') problems.push('«Hammasi to‘landi» yoki «Qarzga olindi»ni tanlang. Qisman to‘lovni qo‘lda yozishingiz mumkin.');
  else if (!Number.isSafeInteger(Number(input.paid)) || Number(input.paid) < 0 || Number(input.paid) > input.total) problems.push('To‘langan summa 0 va jami xarid oralig‘ida bo‘lsin.');
  if (Number(input.paid) > 0 && !input.accounts.some(account => account.id === input.accountId)) problems.push('To‘lov qaysi hisobdan qilinganini tanlang.');
  }
  if (input.similar && input.duplicateReason.trim().length < 5) problems.push('O‘xshash xarid oldin saqlangan. Bu boshqa xarid bo‘lsa, sababini yozing.');
  return problems;
}
