"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  calculatePayroll,
  calculateWorkdayPayEntries,
  freezeWorkShiftRates,
  formatMinutes,
  normalizeAttendanceDays,
  normalizePayrollAdjustments,
  normalizePayrollPayments,
  normalizeStaff,
  normalizeWorkShifts,
  shiftRange,
  staffHourlyRate,
  workShiftMinutes,
  type AttendanceDay,
  type PayrollAdjustment,
  type PayrollPayment,
  type StaffMember,
  type WorkShift,
} from "../lib/payroll";
import { seoulCalendarDate, seoulClock } from "../lib/business-time";
import { encodeHaloHeader } from "../lib/halo-header";
import { buildPayrollReport, type PayrollReport } from "../lib/payroll-report";
import {
  safeFilePart,
  safeSpreadsheetRows,
  spreadsheetRowsToCsv,
  type SpreadsheetRow,
} from "../lib/spreadsheet-export";
import {
  DEFAULT_KITCHEN_RULE_REMINDER_HOURS,
  DEFAULT_KITCHEN_RULES,
  KITCHEN_RULE_REMINDER_OPTIONS,
  normalizeKitchenRuleReminderHours,
  normalizeKitchenRules,
} from "../lib/kitchen-rules";

type Branch = { id: string; name: string; active: boolean };
type PayrollState = {
  accounts: Array<{ id: string; name: string }>;
  staff: StaffMember[];
  workShifts: WorkShift[];
  payrollAdjustments: PayrollAdjustment[];
  attendanceDays: AttendanceDay[];
  payrollPayments: PayrollPayment[];
  kitchenRules: string[];
  kitchenRuleReminderHours: number;
  updatedAt: string;
};

const emptyState: PayrollState = {
  accounts: [],
  staff: [],
  workShifts: [],
  payrollAdjustments: [],
  attendanceDays: [],
  payrollPayments: [],
  kitchenRules: [...DEFAULT_KITCHEN_RULES],
  kitchenRuleReminderHours: DEFAULT_KITCHEN_RULE_REMINDER_HOURS,
  updatedAt: "",
};
const won = (value: number) => `₩${Math.round(value || 0).toLocaleString("en-US")}`;
const askCancellationReason = (label: string) => {
  const value = window.prompt(`“${label}” nima uchun bekor qilinmoqda?\n\nSabab alohida “Bekor qilinganlar” bo‘limida saqlanadi.`);
  if (value === null) return null;
  const reason = value.trim();
  if (!reason) {
    window.alert("Bekor qilish sababini yozish majburiy.");
    return null;
  }
  return reason.slice(0, 500);
};
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const today = seoulCalendarDate;
function normalizePayrollState(value: unknown): PayrollState {
  const state = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    accounts: Array.isArray(state.accounts) ? state.accounts.flatMap((entry) => (
      entry && typeof entry === "object" && "id" in entry && "name" in entry
        ? [{ id: String(entry.id || ""), name: String(entry.name || "") }]
        : []
    )) : [],
    staff: normalizeStaff(state.staff),
    workShifts: normalizeWorkShifts(state.workShifts),
    payrollAdjustments: normalizePayrollAdjustments(state.payrollAdjustments),
    attendanceDays: normalizeAttendanceDays(state.attendanceDays),
    payrollPayments: normalizePayrollPayments(state.payrollPayments),
    kitchenRules: normalizeKitchenRules(state.kitchenRules),
    kitchenRuleReminderHours: normalizeKitchenRuleReminderHours(state.kitchenRuleReminderHours),
    updatedAt: String(state.updatedAt || ""),
  };
}
function downloadBrowserFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function DavomatClient() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("main");
  const [data, setData] = useState<PayrollState>(emptyState);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [editingShiftId, setEditingShiftId] = useState("");
  const [form, setForm] = useState({ date: today(), clockIn: "12:00", clockOut: "00:00" });
  const [dayForm, setDayForm] = useState({
    date: today(),
    status: "off" as AttendanceDay["status"],
    payMode: "unpaid" as AttendanceDay["payMode"],
    note: "",
  });
  const [kitchenRulesDraft, setKitchenRulesDraft] = useState(DEFAULT_KITCHEN_RULES.join("\n"));
  const [kitchenRuleReminderHours, setKitchenRuleReminderHours] = useState(DEFAULT_KITCHEN_RULE_REMINDER_HOURS);
  const [salaryForm, setSalaryForm] = useState({ payType: "monthly" as StaffMember["payType"], monthlySalary: 0, hourlyRate: 0, workDays: 26, dailyHours: 12 });
  const [status, setStatus] = useState("Ma’lumotlar ochilmoqda…");
  const [busy, setBusy] = useState("");
  const [loadingBranch, setLoadingBranch] = useState(false);
  const [loadedBranchId, setLoadedBranchId] = useState("");
  const branchRef = useRef("main");
  const loadedBranchRef = useRef("");
  const revisionRef = useRef("");
  const saveInFlightRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const loadRequestRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const selectedStaffIdRef = useRef("");
  const shiftFormDirtyRef = useRef(false);
  const salaryFormDirtyRef = useRef(false);
  const dayFormDirtyRef = useRef(false);
  const kitchenRulesDirtyRef = useRef(false);

  const load = async (nextBranch = branchId) => {
    const requestId = ++loadRequestRef.current;
    loadInFlightRef.current = true;
    setLoadingBranch(true);
    setStatus("Ma’lumotlar ochilmoqda…");
    try {
      const response = await fetch(`/api/state?branch=${encodeURIComponent(nextBranch)}`, { cache: "no-store" });
      const value = await response.json() as Partial<PayrollState> & { error?: string };
      if (!response.ok || !value.updatedAt) throw new Error(value.error || "Ma’lumotlar ochilmadi.");
      if (requestId !== loadRequestRef.current || nextBranch !== branchRef.current) return false;
      const normalized = normalizePayrollState(value);
      loadedBranchRef.current = nextBranch;
      setLoadedBranchId(nextBranch);
      revisionRef.current = normalized.updatedAt;
      setData(normalized);
      setKitchenRulesDraft(normalized.kitchenRules.join("\n"));
      setKitchenRuleReminderHours(normalized.kitchenRuleReminderHours);
      const chosen = normalized.staff.find((member) => member.id === selectedStaffIdRef.current)
        || normalized.staff.find((member) => member.active)
        || normalized.staff[0];
      selectedStaffIdRef.current = chosen?.id || "";
      setSelectedStaffId(chosen?.id || "");
      setEditingShiftId("");
      shiftFormDirtyRef.current = false;
      salaryFormDirtyRef.current = false;
      dayFormDirtyRef.current = false;
      kitchenRulesDirtyRef.current = false;
      if (chosen) setSalaryForm({ payType: chosen.payType, monthlySalary: chosen.monthlySalary, hourlyRate: chosen.hourlyRate, workDays: chosen.workDays, dailyHours: chosen.dailyHours });
      setStatus("✓ Ma’lumotlar yangilandi");
      return true;
    } catch (error) {
      if (requestId === loadRequestRef.current && nextBranch === branchRef.current) {
        setStatus(error instanceof Error ? error.message : "Ma’lumotlar ochilmadi.");
        const loadedBranch = loadedBranchRef.current;
        if (loadedBranch && loadedBranch !== nextBranch) {
          branchRef.current = loadedBranch;
          setBranchId(loadedBranch);
          window.localStorage.setItem("halo-active-branch", loadedBranch);
        } else if (!loadedBranch) {
          revisionRef.current = "";
          setData(emptyState);
        }
      }
      return false;
    } finally {
      if (requestId === loadRequestRef.current) {
        loadInFlightRef.current = false;
        setLoadingBranch(false);
      }
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/branches", { cache: "no-store" });
        const value = await response.json() as { branches?: Branch[]; error?: string };
        if (!response.ok || !value.branches?.length) throw new Error(value.error || "Filiallar ochilmadi.");
        const saved = window.localStorage.getItem("halo-active-branch") || "main";
        const selected = value.branches.some((branch) => branch.id === saved) ? saved : value.branches[0].id;
        if (!active) return;
        setBranches(value.branches);
        setBranchId(selected);
        branchRef.current = selected;
        await load(selected);
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : "Ma’lumotlar ochilmadi.");
      }
    })();
    return () => { active = false; };
  // Initial owner-authorized load runs once; later branch changes call load directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    const refreshWorkerAttendance = async () => {
      if (
        !revisionRef.current
        || loadedBranchRef.current !== branchRef.current
        || saveInFlightRef.current
        || loadInFlightRef.current
        || pollInFlightRef.current
      ) return;
      const currentBranch = branchRef.current;
      pollInFlightRef.current = true;
      try {
        const revisionResponse = await fetch(
          `/api/state?branch=${encodeURIComponent(currentBranch)}&revision=1`,
          { cache: "no-store" },
        );
        const revisionValue = await revisionResponse.json() as { updatedAt?: string };
        if (
          !revisionResponse.ok
          || !revisionValue.updatedAt
          || revisionValue.updatedAt === revisionRef.current
          || currentBranch !== branchRef.current
          || saveInFlightRef.current
        ) return;
        if (shiftFormDirtyRef.current || salaryFormDirtyRef.current || dayFormDirtyRef.current || kitchenRulesDirtyRef.current) {
          setStatus("Yangi davomat ma’lumoti bor. Avval shaklni saqlang yoki xodim kartasini qayta bosib bekor qiling.");
          return;
        }
        const response = await fetch(`/api/state?branch=${encodeURIComponent(currentBranch)}`, { cache: "no-store" });
        const value = await response.json() as Partial<PayrollState> & { error?: string };
        if (
          !response.ok
          || !value.updatedAt
          || currentBranch !== branchRef.current
          || saveInFlightRef.current
          || shiftFormDirtyRef.current
          || salaryFormDirtyRef.current
          || dayFormDirtyRef.current
          || kitchenRulesDirtyRef.current
        ) return;
        const normalized = normalizePayrollState(value);
        if (!active || normalized.updatedAt === revisionRef.current) return;
        revisionRef.current = normalized.updatedAt;
        setData(normalized);
        setKitchenRulesDraft(normalized.kitchenRules.join("\n"));
        setKitchenRuleReminderHours(normalized.kitchenRuleReminderHours);
        const selected = normalized.staff.find((member) => member.id === selectedStaffIdRef.current);
        if (selected) setSalaryForm({ payType: selected.payType, monthlySalary: selected.monthlySalary, hourlyRate: selected.hourlyRate, workDays: selected.workDays, dailyHours: selected.dailyHours });
        setStatus("✓ Xodim davomat va kunlik ish haqi yangilandi");
      } catch {
        // Keyingi 20 soniyalik tekshiruv avtomatik qayta urinadi.
      } finally {
        pollInFlightRef.current = false;
      }
    };
    const interval = window.setInterval(() => void refreshWorkerAttendance(), 20_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const selectedMember = data.staff.find((member) => member.id === selectedStaffId) || null;
  const chooseStaff = (member: StaffMember) => {
    selectedStaffIdRef.current = member.id;
    setSelectedStaffId(member.id);
    setEditingShiftId("");
    shiftFormDirtyRef.current = false;
    salaryFormDirtyRef.current = false;
    dayFormDirtyRef.current = false;
    setForm({ date: today(), clockIn: "12:00", clockOut: "00:00" });
    setDayForm((current) => ({ ...current, date: today(), note: "" }));
    setSalaryForm({
      payType: member.payType,
      monthlySalary: member.monthlySalary,
      hourlyRate: member.hourlyRate,
      workDays: member.workDays,
      dailyHours: member.dailyHours,
    });
  };

  const persist = async (patch: Partial<PayrollState>, action: string) => {
    if (loadInFlightRef.current || loadedBranchRef.current !== branchRef.current) {
      setStatus("Filial ma’lumoti ochilmoqda. Bir oz kutib qayta bosing.");
      return false;
    }
    const operationBranch = loadedBranchRef.current;
    saveInFlightRef.current = true;
    setBusy(action);
    setStatus("Saqlanmoqda…");
    try {
      const response = await fetch(`/api/state?branch=${encodeURIComponent(operationBranch)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Halo-Actor": "Rahbar",
          "X-Halo-Action": encodeHaloHeader(action),
          "X-Halo-Section": encodeHaloHeader("Hodimlar: ish vaqti va maosh"),
        },
        body: JSON.stringify({ ...patch, updatedAt: data.updatedAt }),
      });
      const result = await response.json() as { ok?: boolean; updatedAt?: string; error?: string };
      if (!response.ok || !result.updatedAt) throw new Error(result.error || "Saqlanmadi.");
      if (operationBranch !== branchRef.current) return true;
      revisionRef.current = result.updatedAt;
      setData((current) => ({ ...current, ...patch, updatedAt: result.updatedAt! }));
      setStatus("✓ Saqlandi");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Saqlanmadi.");
      if (
        operationBranch === branchRef.current
        && error instanceof Error
        && /boshqa qurilmada|eskirgan/i.test(error.message)
      ) await load(operationBranch);
      return false;
    } finally {
      saveInFlightRef.current = false;
      setBusy("");
    }
  };

  const saveShift = async () => {
    if (!selectedMember) return;
    const range = shiftRange(form.date, form.clockIn, form.clockOut);
    if (!range) { setStatus("Sana, Keldi va Ketdi vaqtini tekshiring."); return; }
    const overlap = data.workShifts.some((shift) => {
      if (shift.id === editingShiftId || shift.staffId !== selectedMember.id || shift.status === "void") return false;
      const start = Date.parse(shift.clockIn);
      const end = shift.status === "open" ? start + 18 * 60 * 60_000 : Date.parse(shift.clockOut);
      return Date.parse(range.clockIn) < end && Date.parse(range.clockOut) > start;
    });
    if (overlap) { setStatus("Bu vaqtda hodimning boshqa ish yozuvi bor."); return; }
    const existing = data.workShifts.find((shift) => shift.id === editingShiftId);
    const now = new Date().toISOString();
    const shift: WorkShift = {
      id: existing?.id || uid("shift"),
      staffId: selectedMember.id,
      // Qo‘lda tanlangan sana business-day chegarasidan qat’i nazar o‘sha
      // kalendar sanasida qoladi (masalan, 3-sana 2-sana bo‘lib ketmaydi).
      date: seoulCalendarDate(new Date(range.clockIn)),
      clockIn: range.clockIn,
      clockOut: range.clockOut,
      breakMinutes: 0,
      hourlyRateAtShift: existing?.hourlyRateAtShift || staffHourlyRate(selectedMember),
      overtimeAfterHoursAtShift: existing?.overtimeAfterHoursAtShift || selectedMember.overtimeAfterHours || selectedMember.dailyHours,
      overtimeMultiplierAtShift: existing?.overtimeMultiplierAtShift || selectedMember.overtimeMultiplier || 1,
      note: existing?.note || "Rahbar qo‘lda kiritdi",
      source: existing?.source || "owner",
      status: "closed",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const next = existing ? data.workShifts.map((entry) => entry.id === existing.id ? shift : entry) : [shift, ...data.workShifts];
    if (await persist({ workShifts: next }, `${existing ? "Ish vaqti tahrirlandi" : "Ish vaqti qo‘shildi"} · ${selectedMember.name}`)) {
      setEditingShiftId("");
      shiftFormDirtyRef.current = false;
      setForm({ date: today(), clockIn: "12:00", clockOut: "00:00" });
    }
  };

  const saveKitchenRules = async () => {
    const rules = normalizeKitchenRules(kitchenRulesDraft.split("\n"));
    if (!rules.length) {
      setStatus("Kamida bitta oshxona qoidasini yozing.");
      return;
    }
    if (await persist({
      kitchenRules: rules,
      kitchenRuleReminderHours,
    }, "Oshxona qoidalari va Telegram eslatmasi yangilandi")) {
      kitchenRulesDirtyRef.current = false;
      setKitchenRulesDraft(rules.join("\n"));
    }
  };

  const editShift = (shift: WorkShift) => {
    const member = data.staff.find((entry) => entry.id === shift.staffId);
    if (member) chooseStaff(member);
    setEditingShiftId(shift.id);
    shiftFormDirtyRef.current = true;
    setForm({
      date: seoulCalendarDate(new Date(shift.clockIn)),
      clockIn: seoulClock(new Date(shift.clockIn)),
      clockOut: shift.clockOut ? seoulClock(new Date(shift.clockOut)) : "",
    });
    setStatus(shift.status === "open" ? "Hodim hozir ishda. Ketdi vaqtini kiriting va saqlang." : "Vaqtni o‘zgartirib saqlang.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const voidShift = async (shift: WorkShift) => {
    if (!window.confirm("Bu ish vaqti bekor qilinsinmi?")) return;
    await persist({ workShifts: data.workShifts.map((entry) => entry.id === shift.id ? { ...entry, status: "void" as const, updatedAt: new Date().toISOString() } : entry) }, "Ish vaqti bekor qilindi");
  };

  const saveAttendanceDay = async () => {
    if (!selectedMember || !/^\d{4}-\d{2}-\d{2}$/.test(dayForm.date)) {
      setStatus("Hodim va sanani tekshiring.");
      return;
    }
    if (data.workShifts.some((shift) => shift.staffId === selectedMember.id && shift.date === dayForm.date && shift.status !== "void")) {
      setStatus("Bu sanada ish vaqti bor. Avval ish vaqtini bekor qiling.");
      return;
    }
    const existing = data.attendanceDays.find((day) => day.staffId === selectedMember.id && day.date === dayForm.date && !day.voided);
    const now = new Date().toISOString();
    const day: AttendanceDay = {
      id: existing?.id || `${selectedMember.id}:${dayForm.date}`,
      staffId: selectedMember.id,
      date: dayForm.date,
      status: dayForm.status,
      payMode: dayForm.payMode,
      plannedMinutesAtDay: dayForm.payMode === "planned" ? Math.round(selectedMember.dailyHours * 60) : 0,
      hourlyRateAtDay: dayForm.payMode === "planned" ? staffHourlyRate(selectedMember) : 0,
      note: dayForm.note.trim(),
      voided: false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const next = existing
      ? data.attendanceDays.map((entry) => entry.id === existing.id ? day : entry)
      : [day, ...data.attendanceDays];
    if (await persist({ attendanceDays: next }, `Kun holati saqlandi · ${selectedMember.name}`)) {
      dayFormDirtyRef.current = false;
      setDayForm((current) => ({ ...current, date: today(), note: "" }));
    }
  };

  const voidAttendanceDay = async (day: AttendanceDay) => {
    if (!window.confirm("Bu kun holati bekor qilinsinmi?")) return;
    const reason = askCancellationReason(`${selectedMember?.name || "Xodim"} · ${day.date} kun holati`);
    if (!reason) return;
    const voidedAt = new Date().toISOString();
    await persist({
      attendanceDays: data.attendanceDays.map((entry) => entry.id === day.id
        ? { ...entry, voided: true, updatedAt: voidedAt, voidedAt, voidedBy: "Rahbar", voidReason: reason }
        : entry),
    }, `Kun holati bekor qilindi · Sabab: ${reason}`);
  };

  const saveSalary = async () => {
    if (!selectedMember) return;
    const valid = salaryForm.payType === "monthly" ? salaryForm.monthlySalary > 0 : salaryForm.hourlyRate > 0;
    if (!valid || salaryForm.workDays < 1 || salaryForm.dailyHours <= 0) { setStatus("Maosh va ish rejasini tekshiring."); return; }
    const nextMember: StaffMember = {
      ...selectedMember,
      payType: salaryForm.payType,
      monthlySalary: salaryForm.payType === "monthly" ? salaryForm.monthlySalary : 0,
      hourlyRate: salaryForm.payType === "hourly" ? salaryForm.hourlyRate : 0,
      workDays: salaryForm.workDays,
      dailyHours: salaryForm.dailyHours,
      overtimeAfterHours: salaryForm.dailyHours,
    };
    if (await persist({
      staff: data.staff.map((member) => member.id === nextMember.id ? nextMember : member),
      // Eski smenalarda stavka yozilmagan bo‘lsa, maosh sozlamasini
      // o‘zgartirishdan oldin o‘sha davrdagi stavkani muzlatib qo‘yamiz.
      workShifts: freezeWorkShiftRates(selectedMember, data.workShifts),
    }, `Maosh rejasi yangilandi · ${selectedMember.name}`)) salaryFormDirtyRef.current = false;
  };

  const branchName = branches.find((branch) => branch.id === branchId)?.name || branchId;
  const monthlyReport = (staffId?: string) => buildPayrollReport({
    staff: staffId ? data.staff.filter((member) => member.id === staffId) : data.staff,
    workShifts: data.workShifts,
    payrollAdjustments: data.payrollAdjustments,
    attendanceDays: data.attendanceDays,
    payrollPayments: data.payrollPayments,
    accounts: data.accounts,
    month,
  });
  const withBranch = (rows: SpreadsheetRow[]) => rows.map((row) => ({ Filial: branchName, ...row }));

  const downloadReportExcel = async (report: PayrollReport, filename: string) => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const appendSheet = (rows: SpreadsheetRow[], name: string) => {
      const safeRows = safeSpreadsheetRows(rows);
      const sheet = XLSX.utils.json_to_sheet(safeRows);
      const columns = Object.keys(safeRows[0] || {});
      sheet["!cols"] = columns.map((column) => ({
        wch: Math.min(36, Math.max(column.length + 2, ...safeRows.map((row) => String(row[column] ?? "").length + 2))),
      }));
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };

    appendSheet(withBranch(report.summaryRows), "Oylik_xulosa");
    appendSheet(withBranch(report.dailyPayRows), "Kunlik_ish_haqi");
    appendSheet(withBranch(report.shiftRows), "Ish_vaqti");
    appendSheet(withBranch(report.dayRows), "Kun_holati");
    appendSheet(withBranch(report.adjustmentRows), "Bonus_ushlanma");
    appendSheet(withBranch(report.paymentRows), "Oylik_tolovlari");
    XLSX.writeFile(workbook, filename);
  };

  const googleSheetsRows = (report: PayrollReport): SpreadsheetRow[] => [
    ...report.googleSheetsRows,
    ...report.adjustmentRows.map((row) => ({ "Yozuv turi": "Bonus / ushlanma", ...row })),
    ...report.paymentRows.map((row) => ({ "Yozuv turi": "Oylik to‘lovi", ...row })),
  ];

  const exportAttendanceExcel = async () => {
    setBusy("export-excel");
    setStatus("Excel tayyorlanmoqda…");
    try {
      const report = monthlyReport();
      if (!report.summaryRows.length) {
        setStatus("Tanlangan oy uchun xodim ma’lumoti yo‘q.");
        return;
      }
      await downloadReportExcel(report, `HALO-Davomat-${safeFilePart(branchName)}-${month}.xlsx`);
      setStatus("✓ Excel hisobot yuklandi");
    } catch {
      setStatus("Excel hisobot tayyorlanmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy("");
    }
  };

  const exportAttendanceCsv = () => {
    const report = monthlyReport();
    const rows = googleSheetsRows(report);
    if (!rows.length) {
      setStatus("Bu oyda Google Sheets uchun yuklanadigan ma’lumot yo‘q.");
      return;
    }
    const csv = spreadsheetRowsToCsv(withBranch(rows));
    downloadBrowserFile(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `HALO-Google-Sheets-${safeFilePart(branchName)}-${month}.csv`,
    );
    setStatus("✓ Google Sheets uchun CSV yuklandi");
  };

  const exportStaffExcel = async (member: StaffMember) => {
    const action = `staff-excel-${member.id}`;
    setBusy(action);
    setStatus(`${member.name} uchun ${month} hisoboti tayyorlanmoqda…`);
    try {
      const report = monthlyReport(member.id);
      if (!report.summaryRows.length) throw new Error("Xodim hisoboti topilmadi.");
      await downloadReportExcel(
        report,
        `HALO-${safeFilePart(branchName)}-${safeFilePart(member.name)}-${month}.xlsx`,
      );
      setStatus(`✓ ${member.name} — ${month} alohida Excel hisoboti yuklandi`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Xodim hisoboti tayyorlanmadi.");
    } finally {
      setBusy("");
    }
  };

  const exportStaffCsv = (member: StaffMember) => {
    const report = monthlyReport(member.id);
    const rows = googleSheetsRows(report);
    if (!rows.length) {
      setStatus(`${member.name} uchun hisobot topilmadi.`);
      return;
    }
    const csv = spreadsheetRowsToCsv(withBranch(rows));
    downloadBrowserFile(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `HALO-Google-Sheets-${safeFilePart(branchName)}-${safeFilePart(member.name)}-${month}.csv`,
    );
    setStatus(`✓ ${member.name} — ${month} alohida Google Sheets hisoboti yuklandi`);
  };

  const summaries = useMemo(() => data.staff.filter((member) => member.active).map((member) => ({
    member,
    summary: calculatePayroll(member, data.workShifts, data.payrollAdjustments, month, { attendanceDays: data.attendanceDays, payments: data.payrollPayments }),
  })), [data, month]);
  const selectedSummary = summaries.find((entry) => entry.member.id === selectedStaffId)?.summary;
  const selectedShifts = data.workShifts.filter((shift) => shift.staffId === selectedStaffId && shift.status !== "void" && shift.date.startsWith(`${month}-`)).sort((a, b) => b.clockIn.localeCompare(a.clockIn));
  const selectedWorkdays = selectedMember
    ? calculateWorkdayPayEntries(selectedMember, selectedShifts, new Date(), data.workShifts).sort((left, right) => right.date.localeCompare(left.date))
    : [];
  const selectedDays = data.attendanceDays.filter((day) => day.staffId === selectedStaffId && !day.voided && day.date.startsWith(`${month}-`)).sort((a, b) => b.date.localeCompare(a.date));
  const branchReady = !loadingBranch && loadedBranchId === branchId;

  return <main className={`attendance-shell${branchReady ? "" : " branch-loading"}`} aria-busy={!branchReady}>
    <header className="attendance-topbar">
      <div><span>HALO CONTROL</span><h1>Hodimlar · ish vaqti va maosh</h1></div>
      <div className="attendance-top-actions">
        <label><span>Filial</span><select value={branchId} disabled={Boolean(busy) || loadingBranch} onChange={(event) => { const next = event.target.value; setBranchId(next); branchRef.current = next; window.localStorage.setItem("halo-active-branch", next); void load(next); }}>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
        <label><span>Hisobot oyi</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <a href="/xodim" target="_blank" rel="noreferrer">Xodim ISHNI BOSHLADIM / ISHNI TUGATDIM ↗</a>
        <Link className="muted" href="/">Asosiy boshqaruv</Link>
      </div>
    </header>

    <p className={`attendance-status${status.startsWith("✓") ? " success" : ""}`}>{status}</p>

    <section className="attendance-rules-editor">
      <div className="attendance-rules-copy">
        <span>OSHXONA QONUN-QOIDALARI</span>
        <h2>Xodim salomi va Telegram eslatmasi</h2>
        <p>Har bir qoidani yangi qatordan yozing. Xodim “ISHNI BOSHLADIM”ni bosganda qoidalar Telegramga darhol, ochiq smena davomida esa tanlangan oraliqda yana yuboriladi.</p>
        <small>Telegram xabari kelishi uchun xodim o‘z akkauntida HALO botini bir marta ulagan bo‘lishi kerak.</small>
      </div>
      <div className="attendance-rules-form">
        <label className="wide"><span>Qoidalar</span><textarea rows={7} maxLength={3200} value={kitchenRulesDraft} onChange={(event) => { kitchenRulesDirtyRef.current = true; setKitchenRulesDraft(event.target.value); }} /></label>
        <label><span>Qayta eslatish</span><select value={kitchenRuleReminderHours} onChange={(event) => { kitchenRulesDirtyRef.current = true; setKitchenRuleReminderHours(normalizeKitchenRuleReminderHours(event.target.value)); }}>{KITCHEN_RULE_REMINDER_OPTIONS.map((hours) => <option value={hours} key={hours}>Har {hours} soatda</option>)}</select></label>
        <button type="button" disabled={Boolean(busy) || !branchReady} onClick={() => void saveKitchenRules()}>{busy ? "Saqlanmoqda…" : "Qoidalarni saqlash"}</button>
      </div>
    </section>

    <section className="attendance-export-bar">
      <div><span>HISOBOTNI YUKLAB OLISH</span><strong>{branchName} · {month}</strong><small>Barcha xodimlarning ish, dam olish va maosh ma’lumotlari.</small></div>
      <div>
        <button disabled={Boolean(busy) || !branchReady} onClick={() => void exportAttendanceExcel()}>{busy === "export-excel" ? "Tayyorlanmoqda…" : "↓ Excel (.xlsx)"}</button>
        <button className="sheets" disabled={Boolean(busy) || !branchReady} onClick={exportAttendanceCsv}>▦ Google Sheets (.csv)</button>
      </div>
    </section>

    <section className="attendance-overview">
      {summaries.map(({ member, summary }) => <article className={selectedStaffId === member.id ? "active" : ""} key={member.id}>
        <button className="attendance-person-select" type="button" onClick={() => chooseStaff(member)}>
          <span><i>{member.name.slice(0, 1).toUpperCase()}</i><b>{member.name}</b></span>
          <strong>{formatMinutes(summary.payableWorkedMinutes)}</strong>
          <small>Haqiqiy {formatMinutes(summary.workedMinutes)} · {summary.workedDays} kun · {won(summary.grossPay)}</small>
        </button>
        <div className="attendance-person-exports">
          <button type="button" disabled={Boolean(busy) || !branchReady} onClick={() => void exportStaffExcel(member)}>{busy === `staff-excel-${member.id}` ? "Tayyor…" : "↓ Excel"}</button>
          <button className="sheets" type="button" disabled={Boolean(busy) || !branchReady} onClick={() => exportStaffCsv(member)}>▦ Sheets</button>
        </div>
      </article>)}
      {!summaries.length && <p>Hali hodim qo‘shilmagan.</p>}
    </section>

    {selectedMember && <>
      <section className="attendance-metrics">
        <article><span>Ishlagan kunlari</span><strong>{selectedSummary?.workedDays || 0} kun</strong></article>
        <article><span>Dam olgan kunlari</span><strong>{selectedSummary?.offDays || 0} kun</strong></article>
        <article><span>Jami ish vaqti</span><strong>{formatMinutes(selectedSummary?.workedMinutes || 0)}</strong></article>
        <article className="payable-time"><span>Maoshga hisoblangan vaqt</span><strong>{formatMinutes(selectedSummary?.payableWorkedMinutes || 0)}</strong></article>
        <article><span>Qo‘shimcha soat</span><strong>{formatMinutes(selectedSummary?.overtimeMinutes || 0)}</strong></article>
        <article className="accent"><span>Hisoblangan maosh</span><strong>{won(selectedSummary?.grossPay || 0)}</strong></article>
      </section>
      <p className="attendance-rounding-rule"><b>Maosh vaqtini yaxlitlash:</b> 0–27 daqiqa hisoblanmaydi · 28–57 daqiqa = 30 daqiqa · 58–60 daqiqa = keyingi to‘liq soat.</p>

      <section className="attendance-workspace">
        <article className="attendance-card">
          <div className="attendance-card-title"><span>1</span><div><h2>{editingShiftId ? "Ish vaqtini tahrirlash" : "Ish vaqtini qo‘lda kiritish"}</h2><p>{selectedMember.name} · faqat Keldi va Ketdi vaqtini yozing.</p></div></div>
          <div className="attendance-time-form">
            <label><span>Sana</span><input type="date" value={form.date} onChange={(event) => { shiftFormDirtyRef.current = true; setForm({ ...form, date: event.target.value }); }} /></label>
            <label><span>Keldi</span><input type="time" value={form.clockIn} onChange={(event) => { shiftFormDirtyRef.current = true; setForm({ ...form, clockIn: event.target.value }); }} /></label>
            <label><span>Ketdi</span><input type="time" value={form.clockOut} onChange={(event) => { shiftFormDirtyRef.current = true; setForm({ ...form, clockOut: event.target.value }); }} /></label>
            <div className="attendance-form-total"><span>Jami</span><strong>{formatMinutes(Math.max(0, shiftRange(form.date, form.clockIn, form.clockOut)?.elapsedMinutes || 0))}</strong></div>
            <button disabled={Boolean(busy)} onClick={() => void saveShift()}>{busy ? "Saqlanmoqda…" : editingShiftId ? "O‘zgarishni saqlash" : "Ish vaqtini qo‘shish"}</button>
            {editingShiftId && <button className="cancel" onClick={() => { setEditingShiftId(""); shiftFormDirtyRef.current = false; setForm({ date: today(), clockIn: "12:00", clockOut: "00:00" }); }}>Bekor qilish</button>}
          </div>
        </article>

        <article className="attendance-card">
          <div className="attendance-card-title"><span>2</span><div><h2>Maosh sozlamasi</h2><p>Oylik yoki soatbay stavkani shu yerda o‘zgartiring.</p></div></div>
          <div className="attendance-salary-form">
            <label><span>Hisob turi</span><select value={salaryForm.payType} onChange={(event) => { salaryFormDirtyRef.current = true; setSalaryForm({ ...salaryForm, payType: event.target.value as StaffMember["payType"] }); }}><option value="monthly">Oylik</option><option value="hourly">Soatbay</option></select></label>
            {salaryForm.payType === "monthly" ? <label><span>Oylik maosh</span><input type="number" value={salaryForm.monthlySalary || ""} onChange={(event) => { salaryFormDirtyRef.current = true; setSalaryForm({ ...salaryForm, monthlySalary: Number(event.target.value) }); }} /></label> : <label><span>1 soat narxi</span><input type="number" value={salaryForm.hourlyRate || ""} onChange={(event) => { salaryFormDirtyRef.current = true; setSalaryForm({ ...salaryForm, hourlyRate: Number(event.target.value) }); }} /></label>}
            <label><span>Reja ish kuni</span><input type="number" min="1" max="31" value={salaryForm.workDays} onChange={(event) => { salaryFormDirtyRef.current = true; setSalaryForm({ ...salaryForm, workDays: Number(event.target.value) }); }} /></label>
            <label><span>Kunlik reja soati</span><input type="number" min="0.5" max="18" step="0.5" value={salaryForm.dailyHours} onChange={(event) => { salaryFormDirtyRef.current = true; setSalaryForm({ ...salaryForm, dailyHours: Number(event.target.value) }); }} /></label>
            <button disabled={Boolean(busy)} onClick={() => void saveSalary()}>Maosh sozlamasini saqlash</button>
          </div>
        </article>
      </section>

      <section className="attendance-card attendance-day-card">
        <div className="attendance-card-title"><span>3</span><div><h2>Dam olish yoki kelmagan kunni kiritish</h2><p>Sana, holat va sababini yozing. Bu yozuv oylik tarixida saqlanadi.</p></div></div>
        <div className="attendance-day-form">
          <label><span>Sana</span><input type="date" value={dayForm.date} onChange={(event) => { dayFormDirtyRef.current = true; setDayForm({ ...dayForm, date: event.target.value }); }} /></label>
          <label><span>Kun holati</span><select value={dayForm.status} onChange={(event) => { dayFormDirtyRef.current = true; setDayForm({ ...dayForm, status: event.target.value as AttendanceDay["status"] }); }}><option value="off">Dam olish</option><option value="absent">Kelmadi</option><option value="sick">Kasal</option></select></label>
          <label><span>Maoshga ta’siri</span><select value={dayForm.payMode} onChange={(event) => { dayFormDirtyRef.current = true; setDayForm({ ...dayForm, payMode: event.target.value as AttendanceDay["payMode"] }); }}><option value="unpaid">Haqsiz — 0 soat</option><option value="planned">Reja soati hisoblanadi</option></select></label>
          <label className="wide"><span>Sababi / izoh</span><input maxLength={300} value={dayForm.note} onChange={(event) => { dayFormDirtyRef.current = true; setDayForm({ ...dayForm, note: event.target.value }); }} placeholder="Masalan: haftalik dam, oilaviy sabab, shifokor..." /></label>
          <button disabled={Boolean(busy)} onClick={() => void saveAttendanceDay()}>{busy ? "Saqlanmoqda…" : "Kun holatini saqlash"}</button>
        </div>
      </section>

      <section className="attendance-history attendance-daily-pay">
        <div className="attendance-history-head"><div><span>4 · KUNMA-KUN ISH HAQI</span><h2>{selectedMember.name} — har bir kun qo‘shilgan pul</h2></div><b>{won(selectedWorkdays.filter((day) => !day.open && !day.conflict).reduce((sum, day) => sum + day.roundedTotalPay, 0))}</b></div>
        <p className="attendance-daily-pay-note">Bir kunda bir nechta smena bo‘lsa ham vaqt bir marta jamlanib, HALO yaxlitlash qoidasi bo‘yicha hisoblanadi.</p>
        <div className="attendance-history-table">
          <div className="attendance-history-labels attendance-daily-pay-grid"><b>Sana</b><b>Haqiqiy vaqt</b><b>Hisoblangan</b><b>Oddiy ish puli</b><b>Qo‘shimcha ish soati puli</b><b>Kunlik qo‘shildi</b></div>
          {selectedWorkdays.map((day) => <div className={`attendance-history-row attendance-daily-pay-grid daily-pay${day.conflict ? " conflict" : day.open ? " open" : ""}`} key={`${selectedMember.id}:${day.date}`}>
            <b>{day.date}</b>
            <span><small className="attendance-mobile-label">Haqiqiy vaqt</small>{formatMinutes(day.conflict ? day.recordedMinutes : day.workedMinutes)}</span>
            <span><small className="attendance-mobile-label">Hisoblangan vaqt</small>{formatMinutes(day.payableMinutes)}</span>
            <span><small className="attendance-mobile-label">Oddiy ish puli</small>{day.open || day.conflict ? "—" : won(day.roundedRegularPay)}</span>
            <span><small className="attendance-mobile-label">Qo‘shimcha ish soati puli</small>{day.open || day.conflict ? "—" : won(day.roundedOvertimePay)}</span>
            <strong><small className="attendance-mobile-label">Kunlik qo‘shildi</small>{day.conflict ? "SMENALAR USTMA-UST — TUZATING" : day.open ? "ISHNI TUGATGACH HISOBLANADI" : `+${won(day.roundedTotalPay)}`}</strong>
          </div>)}
          {!selectedWorkdays.length && <p className="attendance-empty">Bu oyda hisoblangan ish haqi yo‘q.</p>}
        </div>
      </section>

      <section className="attendance-history">
        <div className="attendance-history-head"><div><span>5 · ISH VA DAM OLISH TARIXI</span><h2>{selectedMember.name} — {month}</h2></div><b>{selectedShifts.length + selectedDays.length} ta yozuv</b></div>
        <div className="attendance-history-table">
          <div className="attendance-history-labels"><b>Sana</b><b>Keldi</b><b>Ketdi</b><b>Jami</b><b>Kim kiritdi</b><b>Amal</b></div>
          {selectedShifts.map((shift) => <div className={`attendance-history-row${shift.status === "open" ? " open" : ""}`} key={shift.id}>
            <b>{shift.date}</b>
            <span>{new Date(shift.clockIn).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })}</span>
            <span>{shift.clockOut ? new Date(shift.clockOut).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }) : "HOZIR ISHDA"}</span>
            <strong>{formatMinutes(workShiftMinutes(shift))}</strong>
            <em>{shift.source === "worker" ? "Xodim ISHNI BOSHLADIM / ISHNI TUGATDIM" : "Rahbar qo‘lda kiritdi"}</em>
            <div><button onClick={() => editShift(shift)}>Tahrirlash</button><button className="danger" onClick={() => void voidShift(shift)}>Olib tashlash</button></div>
          </div>)}
          {selectedDays.map((day) => <div className="attendance-history-row day" key={day.id}>
            <b>{day.date}</b>
            <span className="attendance-day-label">{day.status === "off" ? "DAM OLISH" : day.status === "sick" ? "KASAL" : "KELMADI"}</span>
            <span>—</span>
            <strong>{day.payMode === "planned" ? formatMinutes(day.plannedMinutesAtDay) : "0 soat"}</strong>
            <em>{day.note || "Sabab yozilmagan"}</em>
            <div><button className="danger" onClick={() => void voidAttendanceDay(day)}>Olib tashlash</button></div>
          </div>)}
          {!selectedShifts.length && !selectedDays.length && <p className="attendance-empty">Bu oyda ish yoki dam olish yozuvi yo‘q.</p>}
        </div>
      </section>
    </>}
  </main>;
}
