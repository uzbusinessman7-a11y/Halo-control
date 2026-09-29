"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeletedItem } from "./lib/deleted-items";
import type { AttendanceDay, PayrollAdjustment, PayrollPayment, StaffMember, WorkShift } from "./lib/payroll";
import { dateIsInRange, dateRangeForPreset, dateRangeLabel, type DateRange, type DateRangePreset } from "./lib/date-range";
import { seoulCalendarDate } from "./lib/business-time";

type Branch = {
  id: string; name: string; active: boolean; updatedAt?: string;
  archivedReason?: string; archivedAt?: string; archivedBy?: string;
};
type Backup = { id: string; actor: string; action: string; section: string; createdAt: string };
type RestoreResult = { ok: boolean; message: string };
type FinancialEntry = {
  id: string; category: string; amount: number; date: string; reversedEntryId?: string; payrollPaymentId?: string;
  cancellationReason?: string; cancelledAt?: string; cancelledBy?: string;
};
type Supplier = { id: string; name: string };
type PurchaseOrder = {
  id: string; supplierId: string; status: "ordered" | "received" | "paid" | "cancelled"; date: string; total: number;
  cancelReason?: string; cancelledAt?: string; cancelledBy?: string;
};
type WorkerTask = {
  id: string; workerName: string; title: string; status: "new" | "started" | "done" | "cancelled";
  cancelReason: string; cancelledAt: string; updatedAt: string;
};
type CancellationRow = {
  id: string; section: string; type: string; label: string; reason: string; actor: string; at: string;
  amount?: number; restored?: boolean;
};

const kindLabel: Record<DeletedItem["kind"], string> = {
  inventory: "Ombor mahsuloti",
  recipe: "Taom / retsept",
  productCategory: "Kategoriya",
  fixedExpense: "Doimiy xarajat",
  dailyClose: "Kun yopish",
  supplier: "Yetkazib beruvchi",
  transaction: "Oldi-berdi yozuvi",
  stockMovement: "Ombor harakati",
  sale: "Savdo",
  mezanaEntry: "MEZANA yozuvi",
};
const legacyReason = "Sabab eski yozuvda ko‘rsatilmagan.";
const won = (value: number) => `₩${Math.round(value || 0).toLocaleString("en-US")}`;
const archiveDatePresets: Array<{ id: DateRangePreset; label: string }> = [
  { id: "today", label: "Bugun" }, { id: "7d", label: "7 kun" }, { id: "30d", label: "30 kun" },
  { id: "month", label: "Shu oy" }, { id: "all", label: "Barchasi" },
];
const cancellationSectionIcon = (value: string) => {
  if (/moliya|to‘lov/i.test(value)) return "₩";
  if (/ombor|taom|savdo/i.test(value)) return "▦";
  if (/maosh|davomat|xodim/i.test(value)) return "◷";
  if (/buyurtma/i.test(value)) return "⇄";
  if (/filial/i.test(value)) return "⌂";
  return "!";
};
const formatTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString("uz-UZ", { timeZone: "Asia/Seoul" }) : value || "Vaqt ko‘rsatilmagan";
};

export default function ArchiveCenter({
  initialBranchId, deletedItems, financialEntries, suppliers, purchaseOrders, staff, workShifts,
  payrollAdjustments, attendanceDays, payrollPayments, onRestoreDeleted,
}: {
  initialBranchId: string;
  deletedItems: DeletedItem[];
  financialEntries: FinancialEntry[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  staff: StaffMember[];
  workShifts: WorkShift[];
  payrollAdjustments: PayrollAdjustment[];
  attendanceDays: AttendanceDay[];
  payrollPayments: PayrollPayment[];
  onRestoreDeleted: (item: DeletedItem) => Promise<RestoreResult>;
}) {
  const [view, setView] = useState<"cancelled" | "deleted" | "backups">("cancelled");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [workerTasks, setWorkerTasks] = useState<WorkerTask[]>([]);
  const [section, setSection] = useState("all");
  const [query, setQuery] = useState("");
  const [archiveRange, setArchiveRange] = useState<DateRange>(() => dateRangeForPreset(seoulCalendarDate(), "all"));
  const [deletedLimit, setDeletedLimit] = useState(100);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  const loadBranches = useCallback(async () => {
    const response = await fetch("/api/branches?includeArchived=1", { cache: "no-store" });
    const result = await response.json() as { branches?: Branch[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Filiallar ochilmadi.");
    setBranches(result.branches || []);
  }, []);
  const loadBackups = useCallback(async (selectedBranchId: string) => {
    const response = await fetch(`/api/backups?branch=${encodeURIComponent(selectedBranchId)}`, { cache: "no-store" });
    const result = await response.json() as { backups?: Backup[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Tizim zaxiralari ochilmadi.");
    setBackups(result.backups || []);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/branches?includeArchived=1", { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { branches?: Branch[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Filiallar ochilmadi.");
      return result.branches || [];
    }).then((rows) => { if (active) setBranches(rows); }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : "Filiallar ochilmadi.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (view !== "backups") return;
    let active = true;
    fetch(`/api/backups?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { backups?: Backup[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Tizim zaxiralari ochilmadi.");
      return result.backups || [];
    }).then((rows) => { if (active) setBackups(rows); }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : "Tizim zaxiralari ochilmadi.");
    });
    return () => { active = false; };
  }, [branchId, view]);

  useEffect(() => {
    if (view !== "cancelled") return;
    let active = true;
    fetch(`/api/worker-tasks?admin=1&branch=${encodeURIComponent(initialBranchId)}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { tasks?: WorkerTask[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Bekor qilingan vazifalar ochilmadi.");
      return result.tasks || [];
    }).then((rows) => { if (active) setWorkerTasks(rows); }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : "Bekor qilingan vazifalar ochilmadi.");
    });
    return () => { active = false; };
  }, [initialBranchId, view]);

  const staffName = useCallback((staffId: string) => staff.find((member) => member.id === staffId)?.name || "Noma’lum xodim", [staff]);
  const supplierName = useCallback((supplierId: string) => suppliers.find((supplier) => supplier.id === supplierId)?.name || "Noma’lum yetkazuvchi", [suppliers]);
  const cancellations = useMemo<CancellationRow[]>(() => {
    const rows: CancellationRow[] = deletedItems.map((item) => ({
      id: `deleted:${item.id}`, section: item.section, type: kindLabel[item.kind], label: item.label,
      reason: item.reason?.trim() || legacyReason, actor: item.deletedBy || "Rahbar", at: item.deletedAt,
      restored: Boolean(item.restoredAt),
    }));
    branches.filter((branch) => branch.archivedReason).forEach((branch) => rows.push({
      id: `branch:${branch.id}`, section: "Filiallar", type: "Filial faoliyati", label: branch.name,
      reason: branch.archivedReason?.trim() || legacyReason, actor: branch.archivedBy || "Rahbar",
      at: branch.archivedAt || branch.updatedAt || "", restored: branch.active,
    }));
    financialEntries.filter((entry) => entry.reversedEntryId && !entry.payrollPaymentId).forEach((entry) => rows.push({
      id: `finance:${entry.id}`, section: "Moliya", type: "Pul harakati", label: entry.category || "Moliyaviy yozuv",
      reason: entry.cancellationReason?.trim() || legacyReason, actor: entry.cancelledBy || "Rahbar",
      at: entry.cancelledAt || entry.date, amount: entry.amount,
    }));
    purchaseOrders.filter((order) => order.status === "cancelled").forEach((order) => rows.push({
      id: `purchase:${order.id}`, section: "Buyurtmalar", type: "Xarid buyurtmasi",
      label: `${supplierName(order.supplierId)} · ${order.date}`, reason: order.cancelReason?.trim() || legacyReason,
      actor: order.cancelledBy || "Rahbar", at: order.cancelledAt || order.date, amount: order.total,
    }));
    staff.filter((member) => member.cancellationReason).forEach((member) => rows.push({
      id: `staff:${member.id}`, section: "Maosh va davomat", type: "Xodim faoliyati", label: member.name,
      reason: member.cancellationReason?.trim() || legacyReason, actor: member.cancelledBy || "Rahbar",
      at: member.cancelledAt || "", restored: member.active,
    }));
    workShifts.filter((shift) => shift.status === "void").forEach((shift) => rows.push({
      id: `shift:${shift.id}`, section: "Maosh va davomat", type: "Ish smenasi", label: `${staffName(shift.staffId)} · ${shift.date}`,
      reason: shift.voidReason?.trim() || legacyReason, actor: shift.voidedBy || "Rahbar", at: shift.voidedAt || shift.updatedAt || shift.date,
    }));
    payrollAdjustments.filter((entry) => entry.voided).forEach((entry) => rows.push({
      id: `adjustment:${entry.id}`, section: "Maosh va davomat",
      type: entry.type === "advance" ? "Avans" : entry.type === "bonus" ? "Bonus" : "Ushlanma",
      label: `${staffName(entry.staffId)} · ${entry.date}`, reason: entry.voidReason?.trim() || legacyReason,
      actor: entry.voidedBy || "Rahbar", at: entry.voidedAt || entry.date, amount: entry.amount,
    }));
    attendanceDays.filter((entry) => entry.voided).forEach((entry) => rows.push({
      id: `attendance:${entry.id}`, section: "Maosh va davomat", type: "Davomat holati", label: `${staffName(entry.staffId)} · ${entry.date}`,
      reason: entry.voidReason?.trim() || legacyReason, actor: entry.voidedBy || "Rahbar", at: entry.voidedAt || entry.updatedAt || entry.date,
    }));
    payrollPayments.filter((entry) => entry.voided).forEach((entry) => rows.push({
      id: `payroll:${entry.id}`, section: "Maosh va davomat", type: entry.kind === "advance" ? "Avans to‘lovi" : "Maosh to‘lovi",
      label: `${staffName(entry.staffId)} · ${entry.month}`, reason: entry.voidReason?.trim() || legacyReason,
      actor: entry.voidedBy || "Rahbar", at: entry.voidedAt || entry.updatedAt || entry.date, amount: entry.amount,
    }));
    workerTasks.filter((task) => task.status === "cancelled").forEach((task) => rows.push({
      id: `task:${task.id}`, section: "Xodim vazifalari", type: "Vazifa", label: `${task.workerName || "Xodim"} · ${task.title}`,
      reason: task.cancelReason?.trim() || legacyReason, actor: "Rahbar", at: task.cancelledAt || task.updatedAt,
    }));
    return rows.sort((left, right) => (Date.parse(right.at) || 0) - (Date.parse(left.at) || 0));
  }, [attendanceDays, branches, deletedItems, financialEntries, payrollAdjustments, payrollPayments, purchaseOrders, staff, staffName, supplierName, workShifts, workerTasks]);

  const datedCancellations = useMemo(() => cancellations.filter((item) => dateIsInRange(item.at, archiveRange)), [archiveRange, cancellations]);
  const cancellationSections = useMemo(() => [...new Set(cancellations.map((item) => item.section))], [cancellations]);
  const cancellationSectionCounts = useMemo(() => cancellationSections.map((value) => ({
    value,
    count: datedCancellations.filter((item) => item.section === value).length,
  })), [cancellationSections, datedCancellations]);
  const itemSections = useMemo(() => [...new Set(deletedItems.map((item) => item.section))], [deletedItems]);
  const backupSections = useMemo(() => [...new Set(backups.map((backup) => backup.section || "Tizim"))], [backups]);
  const normalizedQuery = query.trim().toLocaleLowerCase("uz");
  const filteredCancellations = datedCancellations.filter((item) => (
    (section === "all" || item.section === section)
    && (!normalizedQuery || `${item.label} ${item.reason} ${item.type} ${item.actor}`.toLocaleLowerCase("uz").includes(normalizedQuery))
  ));
  const datedDeleted = useMemo(() => deletedItems.filter((item) => dateIsInRange(item.deletedAt, archiveRange)), [archiveRange, deletedItems]);
  const filteredDeleted = (section === "all" ? datedDeleted : datedDeleted.filter((item) => item.section === section));
  const visibleDeleted = filteredDeleted.slice(0, deletedLimit);
  const datedBackups = useMemo(() => backups.filter((backup) => dateIsInRange(backup.createdAt, archiveRange)), [archiveRange, backups]);
  const visibleBackups = section === "all" ? datedBackups : datedBackups.filter((backup) => (backup.section || "Tizim") === section);
  const activeDeletedCount = deletedItems.filter((item) => !item.restoredAt).length;
  const reasonsRecorded = datedCancellations.filter((item) => item.reason !== legacyReason).length;
  const selectedBranch = branches.find((branch) => branch.id === branchId);

  const createSnapshot = async () => {
    setBusy("snapshot"); setNotice("");
    try {
      const response = await fetch("/api/backups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "snapshot", branchId, label: "Rahbar hozirgi holatni arxivga saqladi", section: "Qo‘lda saqlangan" }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Arxivga saqlanmadi.");
      await loadBackups(branchId); setNotice("✓ Hozirgi holat tizim zaxirasiga saqlandi.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Arxivga saqlanmadi."); }
    finally { setBusy(""); }
  };
  const restoreDeleted = async (item: DeletedItem) => {
    if (item.restoredAt) return;
    if (!window.confirm(`“${item.label}” qayta tiklansinmi?\n\nFaqat shu yozuv tiklanadi. Keyin kiritilgan savdo va boshqa ma’lumotlar o‘zgarmaydi.`)) return;
    setBusy(item.id); setNotice("");
    try { const result = await onRestoreDeleted(item); setNotice(result.message); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Tiklab bo‘lmadi."); }
    finally { setBusy(""); }
  };
  const restoreBackup = async (backup: Backup) => {
    if (!selectedBranch?.active) { setNotice("Avval o‘chirilgan filialni qayta faollashtiring."); return; }
    if (!window.confirm(`“${backup.action}” butun filial holatiga qaytarilsinmi?\n\nBu amal shu zaxiradan keyingi barcha bo‘limlarni orqaga qaytaradi. Hozirgi holat ham avval zaxiralanadi.`)) return;
    setBusy(backup.id); setNotice("");
    try {
      const response = await fetch("/api/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId, backupId: backup.id }) });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Qaytarib bo‘lmadi.");
      setNotice("✓ Butun filial holati tiklandi. Sahifa yangilanmoqda…"); window.setTimeout(() => window.location.reload(), 500);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Qaytarib bo‘lmadi."); setBusy(""); }
  };
  const restoreBranch = async () => {
    if (!selectedBranch || selectedBranch.active) return;
    if (!window.confirm(`“${selectedBranch.name}” filialini arxivdan qaytarasizmi?`)) return;
    setBusy("branch"); setNotice("");
    try {
      const response = await fetch("/api/branches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", branchId }) });
      const result = await response.json() as { branch?: Branch; error?: string };
      if (!response.ok || !result.branch) throw new Error(result.error || "Filial qaytarilmadi.");
      await loadBranches(); setNotice("✓ Filial qayta faollashtirildi.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Filial qaytarilmadi."); }
    finally { setBusy(""); }
  };

  return <div className="page archive-page">
    <section className="archive-hero">
      <div className="archive-mark">!</div><div><span>FAQAT BEKOR QILINGANLAR UCHUN ALOHIDA OYNA</span><h2>Bekor va o‘chirilgan yozuvlar boshqa bo‘limlardan chiqariladi.</h2><p>Ular savdo, xarajat, pul hisobi va ombor qoldig‘iga qo‘shilmaydi. Nima bekor qilingani, sababi, kim va qachon bekor qilgani faqat shu oynada saqlanadi.</p></div>
      {view === "backups" && <button onClick={() => void createSnapshot()} disabled={busy === "snapshot"}>{busy === "snapshot" ? "Saqlanmoqda…" : "＋ Hozirgi holatni saqlash"}</button>}
    </section>
    <div className="archive-view-tabs" role="tablist" aria-label="Boshqaruv tarixi turi">
      <button className={view === "cancelled" ? "active" : ""} onClick={() => { setView("cancelled"); setSection("all"); }}>Bekor qilinganlar <b>{cancellations.length}</b></button>
      <button className={view === "deleted" ? "active" : ""} onClick={() => { setView("deleted"); setSection("all"); }}>Savat / tiklash <b>{activeDeletedCount}</b></button>
      <button className={view === "backups" ? "active" : ""} onClick={() => { setView("backups"); setSection("all"); }}>Tizim zaxiralari</button>
    </div>
    {notice && <p className={`archive-notice ${notice.startsWith("✓") ? "success" : ""}`}>{notice}</p>}
    <section className="archive-date-filter" aria-label="Bekor qilingan ma’lumotlarni sana bo‘yicha tahlil qilish">
      <div><span>ALOHIDA SANA TAHLILI</span><strong>{dateRangeLabel(archiveRange)}</strong><small>Tanlangan sana faqat bekor qilinganlar bo‘limiga ta’sir qiladi.</small></div>
      <div className="archive-date-presets">{archiveDatePresets.map((preset) => <button type="button" className={archiveRange.preset === preset.id ? "active" : ""} key={preset.id} onClick={() => setArchiveRange(dateRangeForPreset(seoulCalendarDate(), preset.id))}>{preset.label}</button>)}</div>
      <label><span>Boshlanish</span><input type="date" value={archiveRange.start} disabled={archiveRange.preset === "all"} onChange={(event) => { const start = event.target.value; setArchiveRange({ start, end: archiveRange.end && archiveRange.end >= start ? archiveRange.end : start, preset: "custom" }); }} /></label>
      <label><span>Tugash</span><input type="date" value={archiveRange.end} disabled={archiveRange.preset === "all"} onChange={(event) => { const end = event.target.value; setArchiveRange({ start: archiveRange.start && archiveRange.start <= end ? archiveRange.start : end, end, preset: "custom" }); }} /></label>
    </section>

    {view === "cancelled" && <>
      <section className="cancellation-stats"><article><span>Jami bekor qilish</span><strong>{datedCancellations.length}</strong><small>Tanlangan sana oralig‘i</small></article><article><span>Sababi yozilgan</span><strong>{reasonsRecorded}</strong><small>Yangi bekor qilishlarda majburiy</small></article><article className="warning"><span>Eski sababsiz yozuv</span><strong>{datedCancellations.length - reasonsRecorded}</strong><small>Eski versiyadan qolgan tarix</small></article></section>
      <section className="cancellation-category-card">
        <div><span>QAYERDAN BEKOR QILINGAN?</span><h3>Bo‘limni tanlang</h3><p>Har bir kategoriya o‘z manbasidagi bekor qilingan harakatlarni ko‘rsatadi.</p></div>
        <div className="cancellation-category-grid">
          <button type="button" className={section === "all" ? "active" : ""} aria-pressed={section === "all"} onClick={() => setSection("all")}><i>∑</i><span><strong>Barcha kategoriyalar</strong><small>Hamma manbalar</small></span><b>{datedCancellations.length}</b></button>
          {cancellationSectionCounts.map((item) => <button type="button" className={section === item.value ? "active" : ""} aria-pressed={section === item.value} onClick={() => setSection(item.value)} key={item.value}><i>{cancellationSectionIcon(item.value)}</i><span><strong>{item.value}</strong><small>Shu bo‘limdan bekor qilingan</small></span><b>{item.count}</b></button>)}
        </div>
      </section>
      <section className="archive-toolbar cancellation-toolbar">
        <label><span>QIDIRISH</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nomi, sabab yoki xodim…" /></label>
        <label><span>QAYSI BO‘LIMDAN</span><select value={section} onChange={(event) => setSection(event.target.value)}><option value="all">Barcha bo‘limlar</option>{cancellationSections.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <div className="archive-branch-state active"><i /><span><b>O‘chmaydigan nazorat tarixi</b><small>Bekor qilingan vazifalar tozalashda ham saqlanadi</small></span></div>
      </section>
      <section className="archive-list-card cancellation-card"><div className="archive-list-head"><div><span>SABAB · KIM · VAQT</span><h3>{filteredCancellations.length} ta bekor qilingan amal</h3></div><p>Eng yangi amal tepada. “Tiklangan” yozuv ham nazorat tarixida qoladi.</p></div>
        <div className="cancellation-list">{filteredCancellations.map((item) => <article className={item.restored ? "restored" : ""} key={item.id}><div className="cancellation-type"><small>{item.section}</small><strong>{item.type}</strong></div><div className="cancellation-copy"><span><strong>{item.label}</strong>{item.amount !== undefined && <b>{won(item.amount)}</b>}</span><p><i>Sabab</i>{item.reason}</p><small>{item.actor} · {formatTime(item.at)}</small></div><b className={item.restored ? "restored" : "cancelled"}>{item.restored ? "TIKLANGAN" : "BEKOR"}</b></article>)}{!filteredCancellations.length && <div className="archive-empty"><i>✓</i><span><strong>Bekor qilingan amal topilmadi.</strong><small>Yangi bekor qilishlar sababi bilan shu yerda ko‘rinadi.</small></span></div>}</div>
      </section>
    </>}

    {view === "deleted" && <>
      <section className="archive-toolbar compact"><label><span>QAYSI BO‘LIMDAN</span><select value={section} onChange={(event) => setSection(event.target.value)}><option value="all">Barcha bo‘limlar</option>{itemSections.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><div className="archive-branch-state active"><i /><span><b>Joriy filial savati</b><small>{activeDeletedCount} ta yozuv hisobdan chiqarilgan</small></span></div></section>
      <section className="archive-list-card"><div className="archive-list-head"><div><span>O‘CHIRISH VA TIKLASH TARIXI</span><h3>{filteredDeleted.length} ta amal</h3></div><p>“Tiklash” faqat tanlangan yozuvni qaytaradi. Tiklangan amal ham tarixda qoladi.</p></div><div className="archive-list">
        {visibleDeleted.map((item) => <article className={item.restoredAt ? "restored" : ""} key={item.id}><div className="archive-source"><small>{kindLabel[item.kind]}</small><strong>{item.section}</strong></div><div className="archive-copy"><strong>{item.label}</strong><span><b>Sabab:</b> {item.reason || legacyReason}</span><span>{item.deletedBy} · {formatTime(item.deletedAt)}</span>{item.restoredAt && <em>✓ Tiklangan · {formatTime(item.restoredAt)}</em>}</div>{item.restoredAt ? <b className="archive-restored-badge">Tiklangan</b> : <button disabled={busy === item.id} onClick={() => void restoreDeleted(item)}>{busy === item.id ? "Tiklanmoqda…" : "↶ Tiklash"}</button>}</article>)}
        {!visibleDeleted.length && <div className="archive-empty"><i>✓</i><span><strong>Savat bo‘sh.</strong><small>O‘chirilgan yozuvlar shu yerda paydo bo‘ladi va bir bosishda tiklanadi.</small></span></div>}
      </div>{filteredDeleted.length > deletedLimit && <button type="button" className="stock-history-more" onClick={() => setDeletedLimit((current) => current + 100)}>Yana 100 ta tarixni ko‘rsatish</button>}</section>
    </>}

    {view === "backups" && <>
      <div className="archive-backup-warning"><b>Diqqat: bu favqulodda zaxira.</b><span>Bu yerdagi qaytarish bitta yozuvni emas, tanlangan filialning butun eski holatini tiklaydi.</span></div>
      <section className="archive-toolbar"><label><span>FILIAL</span><select value={branchId} onChange={(event) => { setBranchId(event.target.value); setSection("all"); }}>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}{branch.active ? "" : " · O‘CHIRILGAN"}</option>)}</select></label><label><span>QAYSI BO‘LIMDAN</span><select value={section} onChange={(event) => setSection(event.target.value)}><option value="all">Barcha bo‘limlar</option>{backupSections.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><div className={`archive-branch-state ${selectedBranch?.active ? "active" : "deleted"}`}><i /><span><b>{selectedBranch?.active ? "Faol filial" : "O‘chirilgan filial"}</b><small>{selectedBranch?.active ? "Ma’lumotlar ishlatilmoqda" : "Barcha ma’lumot arxivda turibdi"}</small></span>{!selectedBranch?.active && <button onClick={() => void restoreBranch()} disabled={busy === "branch"}>Filialni qaytarish</button>}</div></section>
      <section className="archive-list-card"><div className="archive-list-head"><div><span>BUTUN TIZIM ZAXIRALARI</span><h3>{visibleBackups.length} ta zaxira holati</h3></div><p>Oddiy mahsulot yoki yozuv uchun yuqoridagi “Savat / tiklash” bo‘limidan foydalaning.</p></div><div className="archive-list">
        {visibleBackups.map((backup) => <article key={backup.id}><div className="archive-source"><small>QAYSI BO‘LIMDAN</small><strong>{backup.section || "Tizim"}</strong></div><div className="archive-copy"><strong>{backup.action}</strong><span>{backup.actor || "Tizim"} · {formatTime(backup.createdAt)}</span></div><button disabled={busy === backup.id || !selectedBranch?.active} onClick={() => void restoreBackup(backup)}>{busy === backup.id ? "Qaytarilmoqda…" : "Butun holatni qaytarish"}</button></article>)}
        {!visibleBackups.length && <div className="archive-empty"><i>✓</i><span><strong>Tizim zaxirasi hali yo‘q.</strong><small>Birinchi o‘zgarishdan keyin avtomatik paydo bo‘ladi.</small></span></div>}
      </div></section>
    </>}
  </div>;
}
