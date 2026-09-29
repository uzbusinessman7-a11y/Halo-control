import { businessTrendMessage } from './business-trends.ts';
import { seoulClock, seoulCalendarDate, previousSeoulDate } from './business-time.ts';
import { mutateHaloState, readHaloState } from './halo-store.ts';

type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];

/** Only already configured report recipients or the linked owner of this branch. */
async function configuredRecipient(branchId: string) {
  try {
    const report = await globalThis.__HALO_CONTROL_DB__?.prepare('SELECT bot_token, chat_id FROM telegram_settings WHERE id = ? AND enabled = 1')
      .bind('main').first<{ bot_token: string; chat_id: string }>();
    if (report?.bot_token && report.chat_id) return report;
  } catch { /* An enabled branch owner assistant can supply the recipient. */ }
  try {
    const owner = await globalThis.__HALO_CONTROL_DB__?.prepare('SELECT bot_token, owner_id FROM halo_assistant_config WHERE id = ? AND enabled = 1 AND branch_id = ?')
      .bind('main', branchId).first<{ bot_token: string; owner_id: string }>();
    return owner?.bot_token && owner.owner_id ? { bot_token: owner.bot_token, chat_id: owner.owner_id } : null;
  } catch { return null; }
}

export function businessTrendNotificationDue(state: Row, now = new Date()) {
  if (seoulClock(now) < '09:00') return false;
  const id = `business-trend-day:${previousSeoulDate(seoulCalendarDate(now))}`;
  return !rows(state.businessTrendNotifications).some(n => n.id === id && n.status === 'sent');
}

/** Triggered by an authenticated scheduled sync or the owner's existing browser check.
 * No historical business rows are written; only the delivery claim is persisted. */
export async function dispatchBusinessTrendNotification(branchId = 'main', now = new Date()) {
  if (seoulClock(now) < '09:00') return { status: 'not_due' };
  const { state } = await readHaloState(branchId);
  if (!businessTrendNotificationDue(state, now)) return { status: 'already_sent' };
  const settings = await configuredRecipient(branchId);
  if (!settings) return { status: 'telegram_not_connected' };
  const job = businessTrendMessage(state, now);
  const claimId = crypto.randomUUID();
  const claim = await mutateHaloState(current => {
    const notices = rows(current.businessTrendNotifications), old = notices.find(n => n.id === job.id);
    if (old?.status === 'sent' || old?.status === 'sending' && now.getTime() - Date.parse(old.at) < 120_000) return { state: current, result: false };
    return { state: { ...current, businessTrendNotifications: [...notices.filter(n => n.id !== job.id), { id: job.id, claimId, status: 'sending', at: now.toISOString() }] }, result: true };
  }, 5, branchId, 'Tizim', 'Savdo va sarf tahlili tayyorlandi', 'Hisobotlar');
  if (!claim.result) return { status: 'already_claimed' };
  // Recompute from the accepted revision if a purchase arrived during the claim.
  const message = businessTrendMessage(claim.state, now);
  let status = 'failed';
  try {
    const result = await fetch(`https://api.telegram.org/bot${settings.bot_token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.chat_id, text: `${message.text}\nFilial: ${branchId}` }), signal: AbortSignal.timeout(5000),
    });
    if (result.ok && (await result.json() as { ok?: boolean }).ok) status = 'sent';
  } catch { /* The next authorized check retries a failed delivery. */ }
  await mutateHaloState(current => ({ state: { ...current, businessTrendNotifications: rows(current.businessTrendNotifications)
    .map(n => n.id === job.id && n.claimId === claimId ? { ...n, status, at: now.toISOString() } : n) }, result: true }),
  5, branchId, 'Tizim', status === 'sent' ? 'Savdo va sarf tahlili yuborildi' : 'Tahlilni yuborish qayta tekshiriladi', 'Hisobotlar');
  return { status };
}
