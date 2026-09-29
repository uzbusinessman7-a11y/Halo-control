import { dispatchPurchaseReserveNotifications } from './purchase-reserve-notifications.ts';
import { dispatchBusinessTrendNotification } from './business-trend-notifications.ts';
import { seoulCalendarDate, seoulClock } from './business-time.ts';
import { mutateHaloState, readHaloState } from './halo-store.ts';
import { periodBounds } from './vegetable-expenses.ts';

type Row = Record<string, any>;
export function vegetableNotificationDue(state: Row, now = new Date()) {
  const today = seoulCalendarDate(now), monday = periodBounds(today, 'week').start;
  if (today === monday && seoulClock(now) < '09:00') return false;
  const start = String(state.vegetableExpenseStartedAt || '');
  return Boolean(start && seoulCalendarDate(new Date(start)) < monday);
}
/** Existing authenticated scheduled sync. The daily digest includes the prior
 * complete week and replaces the separate Monday digest; its history is retained. */
export async function dispatchVegetableNotification(branchId = 'main', now = new Date(), scheduler = false) {
  let { state } = await readHaloState(branchId);
  if (scheduler && String((state.vegetableExpenseSettings as Row)?.schedulerSeenAt || '').slice(0, 10) !== seoulCalendarDate(now)) {
    const touch = await mutateHaloState(current => ({ state: { ...current, vegetableExpenseSettings: { ...(current.vegetableExpenseSettings as Row), schedulerSeenAt: `${seoulCalendarDate(now)} ${seoulClock(now)}` } }, result: true }), 5, branchId, 'Tizim', 'Sabzavot hisoboti jadvali tekshirildi', 'Sabzavot va sous');
    state = touch.state;
  }
  await dispatchPurchaseReserveNotifications(branchId, now);
  return dispatchBusinessTrendNotification(branchId, now);
}
