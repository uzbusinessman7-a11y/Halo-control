export const HALO_LIVE_SYNC_INTERVAL_MS = 5_000;
export const HALO_STATE_SYNC_CHANNEL = "halo-control-state-sync-v1";

export type HaloStateSyncSignal = {
  branchId: string;
  updatedAt: string;
};

const validStateSyncSignal = (value: unknown): value is HaloStateSyncSignal => {
  if (!value || typeof value !== "object") return false;
  const signal = value as Partial<HaloStateSyncSignal>;
  return Boolean(String(signal.branchId || "").trim() && String(signal.updatedAt || "").trim());
};

export const announceHaloStateChange = (branchId: string, updatedAt: string) => {
  if (typeof window === "undefined" || !branchId.trim() || !updatedAt.trim()) return;
  const signal: HaloStateSyncSignal = { branchId: branchId.trim(), updatedAt: updatedAt.trim() };
  if ("BroadcastChannel" in window) {
    try {
      const channel = new BroadcastChannel(HALO_STATE_SYNC_CHANNEL);
      channel.postMessage(signal);
      channel.close();
      return;
    } catch {
      // Eski brauzerlarda localStorage orqali boshqa tabga xabar beriladi.
    }
  }
  try {
    window.localStorage.setItem(HALO_STATE_SYNC_CHANNEL, JSON.stringify(signal));
  } catch {
    // Jonli signal ishlamasa davriy tekshiruv baribir yangilaydi.
  }
};

export const subscribeHaloStateChanges = (listener: (signal: HaloStateSyncSignal) => void) => {
  if (typeof window === "undefined") return () => undefined;
  let channel: BroadcastChannel | null = null;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== HALO_STATE_SYNC_CHANNEL || !event.newValue) return;
    try {
      const signal = JSON.parse(event.newValue) as unknown;
      if (validStateSyncSignal(signal)) listener(signal);
    } catch {
      // Noto‘g‘ri eski signal e’tiborsiz qoldiriladi.
    }
  };
  if ("BroadcastChannel" in window) {
    try {
      channel = new BroadcastChannel(HALO_STATE_SYNC_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (validStateSyncSignal(event.data)) listener(event.data);
      };
    } catch {
      channel = null;
    }
  }
  if (!channel) window.addEventListener("storage", onStorage);
  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
};

export const stateRevisionChanged = (current: unknown, incoming: unknown) => {
  const nextRevision = String(incoming || "").trim();
  return Boolean(nextRevision && nextRevision !== String(current || "").trim());
};

export function rolloverFormDate<T extends { date: string }>(
  form: T,
  previousDate: string,
  nextDate: string,
): T {
  return previousDate !== nextDate && form.date === previousDate
    ? { ...form, date: nextDate }
    : form;
}

export const rolloverSelectedDate = (
  value: string,
  previousDate: string,
  nextDate: string,
) => previousDate !== nextDate && value === previousDate ? nextDate : value;
