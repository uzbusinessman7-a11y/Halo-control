import { mutateHaloState, readHaloState } from './halo-store.ts';
import { inventoryNotificationJobs } from './inventory-notification-jobs.ts';
type Row = Record<string, any>;
const rows = (v: unknown): Row[] => Array.isArray(v) ? v : [];
export async function inventoryTelegramStatus(branchId = 'main') {
  try {
    const value = await globalThis.__HALO_CONTROL_DB__?.prepare('SELECT bot_token, chat_id FROM telegram_settings WHERE id = ? AND enabled = 1').bind('main').first<{ bot_token: string; chat_id: string }>();
    if (value?.bot_token && value.chat_id) return value;
  } catch { /* An assistant bot can be used when the separate report bot is absent. */ }
  try {
    const assistant = await globalThis.__HALO_CONTROL_DB__?.prepare('SELECT bot_token, owner_id FROM halo_assistant_config WHERE id = ? AND enabled = 1 AND branch_id = ?').bind('main', branchId).first<{ bot_token: string; owner_id: string }>();
    return assistant?.bot_token && assistant.owner_id ? { bot_token: assistant.bot_token, chat_id: assistant.owner_id } : null;
  } catch { return null; }
}
export async function dispatchInventoryNotifications(branchId = 'main', now = new Date()) {
  const settings = await inventoryTelegramStatus(branchId);
  if (!settings) return { configured: false, sent: 0, failed: 0 };
  const { state } = await readHaloState(branchId);
  const jobs = inventoryNotificationJobs(state, now).slice(0, 3);
  let sent = 0, failed = 0;
  for (const job of jobs) {
    const claimId = crypto.randomUUID();
    const claim = await mutateHaloState(current => {
      const notices = rows(current.inventoryNotifications);
      const existing = notices.find(n => n.id === job.id);
      if (existing?.status === 'sent' || (existing?.status === 'sending' && now.getTime() - Date.parse(existing.at) < 120_000)) return { state: current, result: false };
      return { state: { ...current, inventoryNotifications: [{ id: job.id, kind: job.kind, status: 'sending', at: now.toISOString(), claimId }, ...notices.filter(n => n.id !== job.id)] }, result: true };
    }, 5, branchId, 'Tizim', 'Sanoq Telegram xabari tayyorlandi', 'Ombor');
    if (!claim.result) continue;
    let error = '';
    try {
      const response = await fetch(`https://api.telegram.org/bot${settings.bot_token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: settings.chat_id, text: `${job.text}\nFilial: ${branchId}` }), signal: AbortSignal.timeout(5_000) });
      const result = await response.json() as { ok?: boolean };
      if (!response.ok || !result.ok) throw new Error('Telegram xabarni qabul qilmadi.');
      sent++;
    } catch { failed++; error = 'Xabar yuborilmadi. Ulanishni tekshiring; keyingi tekshiruvda qayta uriniladi.'; }
    await mutateHaloState(current => {
      const notices = rows(current.inventoryNotifications);
      if (!notices.some(n => n.id === job.id && n.claimId === claimId)) return { state: current, result: false };
      const at = new Date().toISOString();
      const members = !error ? (job.memberIds || []).map(id => ({ id, kind: 'reminder', status: 'sent', at })) : [];
      const memberIds = new Set(members.map(n => n.id));
      return { state: { ...current, inventoryNotifications: [...members, ...notices.filter(n => !memberIds.has(n.id)).map(n => n.id === job.id ? { ...n, status: error ? 'failed' : 'sent', error, at } : n)] }, result: true };
    }, 5, branchId, 'Tizim', error ? 'Sanoq xabari yuborilmadi' : 'Sanoq xabari Telegramga yuborildi', 'Ombor');
  }
  return { configured: true, sent, failed };
}
