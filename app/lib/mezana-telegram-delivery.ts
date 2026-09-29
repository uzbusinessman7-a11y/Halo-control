type DeliveryStatus = "sending" | "sent" | "failed";

type DeliveryRow = {
  status: DeliveryStatus;
  updated_at: string;
  sent_at: string;
  last_error: string;
};

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
}

const database = () => {
  if (!globalThis.__HALO_CONTROL_DB__) throw new Error("Database unavailable");
  return globalThis.__HALO_CONTROL_DB__;
};

const deliveryId = (branchId: string, entryId: string) => `${branchId}:${entryId}`;

export type MezanaTelegramClaim = {
  claimed: boolean;
  sent: boolean;
  reason: string;
};

export async function claimMezanaTelegramDelivery(
  branchId: string,
  entryId: string,
): Promise<MezanaTelegramClaim> {
  const db = database();
  const id = deliveryId(branchId, entryId);
  const now = new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - 30_000).toISOString();
  const current = await db.prepare(
    "SELECT status, updated_at, sent_at, last_error FROM mezana_telegram_deliveries WHERE id = ?",
  ).bind(id).first<DeliveryRow>();

  if (current?.status === "sent") {
    return { claimed: false, sent: true, reason: "Bu yozuv Telegramga avval yuborilgan." };
  }
  if (current?.status === "sending" && current.updated_at > staleIso) {
    return { claimed: false, sent: false, reason: "Telegramga yuborish davom etmoqda." };
  }

  if (!current) {
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO mezana_telegram_deliveries
        (id, branch_id, entry_id, status, last_error, sent_at, created_at, updated_at)
        VALUES (?, ?, ?, 'sending', '', '', ?, ?)`,
    ).bind(id, branchId, entryId, nowIso, nowIso).run();
    if (inserted.meta.changes) return { claimed: true, sent: false, reason: "" };
  }

  const claimed = await db.prepare(
    `UPDATE mezana_telegram_deliveries
      SET status = 'sending', last_error = '', updated_at = ?
      WHERE id = ? AND status != 'sent' AND (status != 'sending' OR updated_at <= ?)`,
  ).bind(nowIso, id, staleIso).run();
  if (claimed.meta.changes) return { claimed: true, sent: false, reason: "" };

  const latest = await db.prepare(
    "SELECT status, updated_at, sent_at, last_error FROM mezana_telegram_deliveries WHERE id = ?",
  ).bind(id).first<DeliveryRow>();
  if (latest?.status === "sent") {
    return { claimed: false, sent: true, reason: "Bu yozuv Telegramga avval yuborilgan." };
  }
  return { claimed: false, sent: false, reason: "Telegramga yuborish davom etmoqda." };
}

export async function finishMezanaTelegramDelivery(
  branchId: string,
  entryId: string,
  result: { sent: boolean; reason?: string },
) {
  const now = new Date().toISOString();
  await database().prepare(
    `UPDATE mezana_telegram_deliveries
      SET status = ?, last_error = ?, sent_at = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(
    result.sent ? "sent" : "failed",
    result.sent ? "" : String(result.reason || "Telegramga yuborilmadi.").slice(0, 500),
    result.sent ? now : "",
    now,
    deliveryId(branchId, entryId),
  ).run();
}
