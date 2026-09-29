import { readSettings, readBranchStatus, writeBranchStatus, koreaClock, scheduledReportDate, makeReport } from './telegram-service';

function database() {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error('Database unavailable');
  return globalThis.__HALO_CONTROL_DB__;
}

export async function scheduledDeliveryStatus(branchId: string) {
  return database().prepare('SELECT report_date, status, sent_at, last_error FROM telegram_daily_deliveries WHERE branch_id = ? ORDER BY report_date DESC LIMIT 1').bind(branchId).first();
}

/** Shared by owner refresh and the authenticated Sheets minute trigger. Never changes business records. */
export async function dispatchScheduledDailyReport(branchId: string, now = new Date()) {
  const settings = await readSettings();
  if (!settings.enabled || !settings.botToken || !settings.chatId) return { ok: true, skipped: 'disabled' };
  const db = database();
  const branch = await db.prepare('SELECT name FROM halo_branches WHERE id = ? AND active = 1').bind(branchId).first<{ name: string }>();
  if (!branch) return { ok: true, skipped: 'inactive-branch' };
  const clock = koreaClock(now);
  const reportDate = scheduledReportDate(clock.date, clock.time, settings.reportTime);
  const previous = await readBranchStatus(branchId);
  // Also respect the legacy main-branch checkpoint on upgrade.
  if (previous.lastSentDate >= reportDate || (branchId === 'main' && settings.lastSentDate >= reportDate)) return { ok: true, skipped: 'already-sent', reportDate };
  const claimId = crypto.randomUUID(), claimedAt = now.toISOString();
  const claim = await db.prepare(`INSERT INTO telegram_daily_deliveries
    (branch_id, report_date, status, claim_id, claimed_at, sent_at, last_error)
    VALUES (?, ?, 'sending', ?, ?, '', '') ON CONFLICT(branch_id, report_date) DO NOTHING`)
    .bind(branchId, reportDate, claimId, claimedAt).run();
  if (!claim.meta.changes) return { ok: true, skipped: 'delivery-recorded', reportDate };
  let attempted = false;
  let confirmed = false;
  try {
    const stored = await db.prepare('SELECT payload FROM app_state WHERE id = ?').bind(branchId).first<{ payload: string }>();
    if (!stored) throw new Error('Filial ma’lumotlari topilmadi');
    const { text } = makeReport(JSON.parse(stored.payload), reportDate);
    attempted = true;
    const response = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: settings.chatId, text: `🏪 ${branch.name.slice(0, 120)}\n${text}`, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { ok?: boolean };
    if (!response.ok || !result.ok) {
      await db.prepare("UPDATE telegram_daily_deliveries SET status='failed', last_error=? WHERE claim_id=?")
        .bind('Telegram xabarni qabul qilmadi. Bot sozlamalarini tekshiring va hisobotni qo‘lda yuboring.', claimId).run();
      return { ok: false, reportDate, error: 'Telegram hisobotni qabul qilmadi.' };
    }
    confirmed = true;
    const sentAt = now.toISOString();
    await db.prepare("UPDATE telegram_daily_deliveries SET status='sent', sent_at=?, last_error='' WHERE claim_id=?").bind(sentAt, claimId).run();
    await writeBranchStatus(branchId, reportDate, sentAt);
    return { ok: true, automatic: true, reportDate, sentAt, message: 'Kunlik hisobot rahbarga yuborildi.' };
  } catch {
    // Telegram offers no idempotency key. A network timeout must not trigger a duplicate send.
    const status = confirmed ? 'sent' : attempted ? 'uncertain' : 'failed';
    const error = confirmed ? 'Xabar yuborildi, oxirgi yuborish belgisi yangilanmadi.' : attempted
      ? 'Telegram javobi tasdiqlanmadi. Qayta yuborishdan oldin botdagi xabarni tekshiring.'
      : 'Hisobot tayyorlanmadi. Bot sozlamalarini tekshiring.';
    await db.prepare('UPDATE telegram_daily_deliveries SET status=?, last_error=? WHERE claim_id=?').bind(status, error, claimId).run();
    return { ok: confirmed, reportDate, error };
  }
}
