"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { seoulOperationDate } from "../lib/business-time";
import { HALO_LIVE_SYNC_INTERVAL_MS, rolloverSelectedDate } from "../lib/live-state";
import type {
  OperationAlert,
  OperationChecklistView,
  OperationPhase,
} from "../lib/operations";

type Branch = { id: string; name: string; active: boolean };
type OperationsPayload = {
  role: "owner";
  date: string;
  checklist: OperationChecklistView;
  alerts: OperationAlert[];
  history: OperationChecklistView[];
  updatedAt: string;
};

const emptyChecklist = (date: string): OperationChecklistView => ({
  date,
  completed: 0,
  total: 12,
  percent: 0,
  updatedAt: "",
  phases: [],
});

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function displayTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("uz-UZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

export default function OperationsClient() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("main");
  const [date, setDate] = useState(() => seoulOperationDate());
  const [payload, setPayload] = useState<OperationsPayload>({
    role: "owner",
    date,
    checklist: emptyChecklist(date),
    alerts: [],
    history: [],
    updatedAt: "",
  });
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (nextBranch = branchId, nextDate = date, quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setNotice("");
    }
    try {
      const [branchResponse, operationsResponse] = await Promise.all([
        branches.length ? Promise.resolve(null) : fetch("/api/branches", { cache: "no-store" }),
        fetch(`/api/operations?branch=${encodeURIComponent(nextBranch)}&date=${encodeURIComponent(nextDate)}`, { cache: "no-store" }),
      ]);
      if (branchResponse) {
        const branchValue = await branchResponse.json() as { branches?: Branch[]; error?: string };
        if (!branchResponse.ok) throw new Error(branchValue.error || "Filiallar ochilmadi.");
        setBranches((branchValue.branches || []).filter((branch) => branch.active));
      }
      const value = await operationsResponse.json() as OperationsPayload & { error?: string };
      if (!operationsResponse.ok) throw new Error(value.error || "Kunlik nazorat ochilmadi.");
      setPayload(value);
    } catch (error) {
      if (!quiet) setNotice(error instanceof Error ? error.message : "Kunlik nazorat ochilmadi.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [branchId, branches.length, date]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(
      () => void load(branchId, date, true),
      HALO_LIVE_SYNC_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [branchId, date, load]);

  useEffect(() => {
    let previousDate = seoulOperationDate();
    const refreshDate = () => {
      const nextDate = seoulOperationDate();
      setDate((current) => rolloverSelectedDate(current, previousDate, nextDate));
      previousDate = nextDate;
    };
    const interval = window.setInterval(refreshDate, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const changeBranch = (next: string) => {
    setBranchId(next);
    void load(next, date);
  };

  const changeDate = (next: string) => {
    if (!next) return;
    setDate(next);
    void load(branchId, next);
  };

  const toggle = async (itemId: string, completed: boolean) => {
    setBusyItem(itemId);
    setNotice("");
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, date, itemId, completed }),
      });
      const value = await response.json() as OperationsPayload & { error?: string };
      if (!response.ok) throw new Error(value.error || "Belgi saqlanmadi.");
      setPayload(value);
      setNotice(completed ? "✓ Bajarildi deb saqlandi." : "✓ Belgi olib tashlandi.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Belgi saqlanmadi.");
    } finally {
      setBusyItem("");
    }
  };

  const criticalCount = payload.alerts.filter((alert) => alert.severity === "critical").length;
  const phaseById = useMemo(() => new Map(payload.checklist.phases.map((phase) => [phase.phase, phase])), [payload.checklist.phases]);

  const renderPhase = (phaseId: OperationPhase) => {
    const phase = phaseById.get(phaseId);
    if (!phase) return null;
    const percent = phase.total ? Math.round((phase.completed / phase.total) * 100) : 0;
    return <section className={`operations-checklist-card ${phaseId}`} id={phaseId}>
      <div className="operations-phase-head">
        <div><span>{phaseId === "opening" ? "12:00 GACHA TAYYOR" : "KUN OXIRIDA"}</span><h2>{phase.title}</h2><p>{phase.subtitle}</p></div>
        <div className="operations-ring" style={{ "--progress": `${percent * 3.6}deg` } as React.CSSProperties}><strong>{phase.completed}/{phase.total}</strong><small>{percent}%</small></div>
      </div>
      <div className="operations-items">
        {phase.items.map((item, index) => <article className={item.completed ? "done" : ""} key={item.id}>
          <button type="button" aria-pressed={item.completed} disabled={busyItem === item.id} onClick={() => void toggle(item.id, !item.completed)}>
            <i>{busyItem === item.id ? "…" : item.completed ? "✓" : String(index + 1).padStart(2, "0")}</i>
            <span><strong>{item.title}</strong><small>{item.detail}</small>{item.completion && <em>{item.completion.completedBy} · {displayTime(item.completion.completedAt)}</em>}</span>
            <b>{item.completed ? "BAJARILDI" : "BELGILASH"}</b>
          </button>
        </article>)}
      </div>
    </section>;
  };

  return <main className="operations-shell">
    <header className="operations-topbar">
      <div><span>HALO CONTROL</span><h1>KUNLIK NAZORAT MARKAZI</h1></div>
      <div className="operations-top-actions">
        <label><span>FILIAL</span><select value={branchId} onChange={(event) => changeBranch(event.target.value)}>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
        <label><span>ISH KUNI</span><input type="date" value={date} onChange={(event) => changeDate(event.target.value)} /></label>
        <button type="button" onClick={() => void load()} disabled={loading}>↻ YANGILASH</button>
        <Link className="muted" href="/">BOSH SAHIFA</Link>
        <Link href="/xodim">XODIM OYNASI</Link>
      </div>
    </header>

    {notice && <p className={notice.startsWith("✓") ? "operations-notice success" : "operations-notice"}>{notice}</p>}

    <section className="operations-hero">
      <div><span>BUGUNGI HOLAT · {displayDate(payload.checklist.date)}</span><h2>{payload.checklist.percent === 100 ? "HAMMA NAZORAT BAJARILDI" : "NAZORAT DAVOM ETMOQDA"}</h2><p>Har bir bandni bajargan hodim va aniq vaqti avtomatik tarixda qoladi.</p></div>
      <div className="operations-total"><strong>{payload.checklist.percent}%</strong><span>{payload.checklist.completed}/{payload.checklist.total} BAND</span></div>
    </section>

    <section className={`operations-alert-center${criticalCount ? " has-critical" : ""}`}>
      <div className="operations-alert-head"><span><i>{criticalCount ? "!" : "✓"}</i><span><small>QIZIL ALERT MARKAZI</small><strong>{payload.alerts.length ? `${payload.alerts.length} TA E’TIBOR TALAB QILADI` : "HOZIRCHA HAMMASI JOYIDA"}</strong></span></span><b>{criticalCount} QIZIL</b></div>
      <div className="operations-alert-list">
        {payload.alerts.length ? payload.alerts.map((alert) => <a className={alert.severity} href={alert.href} key={alert.id}><i>{alert.severity === "critical" ? "!" : "●"}</i><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><b>OCHISH →</b></a>) : <div className="operations-all-clear"><i>✓</i><span><strong>Jiddiy muammo topilmadi</strong><small>Tizim davomat, ombor, qarz va kassani tekshirdi.</small></span></div>}
      </div>
    </section>

    <div className="operations-grid">{renderPhase("opening")}{renderPhase("closing")}</div>

    <section className="operations-history">
      <div className="operations-history-head"><div><span>SO‘NGGI YOZUVLAR</span><h2>NAZORAT TARIXI</h2></div><b>ISM + VAQT SAQLANADI</b></div>
      <div className="operations-history-list">
        {payload.history.length ? payload.history.map((entry) => <button type="button" className={entry.date === date ? "active" : ""} onClick={() => changeDate(entry.date)} key={entry.date}><span><strong>{displayDate(entry.date)}</strong><small>{entry.completed === entry.total ? "To‘liq bajarilgan" : "Tugallanmagan"}</small></span><b>{entry.completed}/{entry.total}</b><i style={{ "--width": `${entry.percent}%` } as React.CSSProperties} /></button>) : <p>Hali nazorat tarixi yo‘q. Birinchi belgini qo‘ying.</p>}
      </div>
    </section>
  </main>;
}
