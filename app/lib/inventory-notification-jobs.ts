/** Retired group reminders and variance thresholds must never schedule new
 * messages. Previously saved notification history is retained in the state. */
export function inventoryNotificationJobs(_state: Record<string, any>, _now = new Date()): Array<{ id: string; text: string; kind: string; memberIds?: string[] }> {
  return [];
}
