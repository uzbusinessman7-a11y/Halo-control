import { seoulCalendarDate } from "./business-time";
import { mutateHaloState, readHaloState } from "./halo-store";
import {
  materializeRecurringExpenses,
  repairRecurringExpenseDuplicates,
  type RecurringExpenseTemplate,
  type RecurringFinancialEntry,
} from "./recurring-expenses";

type JsonRecord = Record<string, unknown>;

const recurringView = (state: JsonRecord, throughDate: string) => {
  const repaired = repairRecurringExpenseDuplicates({
    fixedExpenses: Array.isArray(state.fixedExpenses)
    ? state.fixedExpenses as RecurringExpenseTemplate[]
    : [],
    financialEntries: Array.isArray(state.financialEntries)
    ? state.financialEntries as RecurringFinancialEntry[]
    : [],
  });
  const materialized = materializeRecurringExpenses({
    fixedExpenses: repaired.fixedExpenses,
    financialEntries: repaired.financialEntries,
    throughDate,
  });
  return {
    ...materialized,
    stoppedTemplates: repaired.stoppedTemplates,
    reversedEntries: repaired.reversedEntries,
    changed: repaired.changed || materialized.changed,
  };
};

export async function readHaloStateWithRecurringExpenses(
  branchId = "main",
  throughDate = seoulCalendarDate(),
) {
  const current = await readHaloState(branchId);
  const preview = recurringView(current.state, throughDate);
  if (!preview.changed) return current;

  const mutation = await mutateHaloState((state) => {
    const result = recurringView(state, throughDate);
    return {
      state: result.changed
        ? {
            ...state,
            fixedExpenses: result.fixedExpenses,
            financialEntries: result.financialEntries,
          }
        : state,
      result: {
        created: result.createdEntries.length,
        stoppedTemplates: result.stoppedTemplates,
        reversedEntries: result.reversedEntries,
      },
    };
  }, 5, branchId, "HALO Control", "Oylik avtomatik xarajatlar tekshirildi", "Xarajatlar");

  return { state: mutation.state, updatedAt: mutation.updatedAt };
}
