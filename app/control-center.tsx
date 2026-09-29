"use client";
import InventoryAccountingPanel from "./inventory-accounting-panel";
import { wholeWon } from "./lib/sale-cost";

import { useEffect, useMemo, useRef, useState } from "react";
import { categoriesForKind, type ProductCategory } from "./lib/product-categories";
import {
  calculatePayroll,
  calculateWorkdayPayEntries,
  freezeWorkShiftRates,
  formatMinutes,
  shiftRange,
  staffPayWindowForInstant,
  staffHourlyRate,
  workShiftMinutes,
  type PayrollAdjustment,
  type AttendanceDay,
  type PayrollPayment,
  type StaffMember,
  type WorkShift,
} from "./lib/payroll";
import {
  seoulBusinessDate,
  seoulCalendarDate,
  seoulClock,
  seoulDateTimeLocal,
  seoulLocalDateTimeToIso,
} from "./lib/business-time";
import { buildPayrollReport } from "./lib/payroll-report";
import { calculateDailyReport, costRuleCoversCategory, selectActiveFinancialEntries } from "./lib/daily-report";
import { safeFilePart } from "./lib/spreadsheet-export";
import { createZipArchive } from "./lib/zip-export";
import type { DeletedItem } from "./lib/deleted-items";
import { rolloverFormDate } from "./lib/live-state";
import {
  closeBusinessMonth,
  nextAccountingMonth,
  normalizeMonthlyCloses,
  type MonthlyCloseRecord,
} from "./lib/month-end";

type Inventory = {
  id: string;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  unitCost: number;
  packageName: string;
  unitsPerPackage: number;
  packageCost: number;
  gramsPerUnit: number;
  supplierId: string;
  categoryId: string;
};
type Supplier = { id: string; name: string; balance: number; bankAccount?: string };
type Account = { id: string; name: string; type: string; openingBalance: number };
type Sale = {
  id: string;
  date: string;
  totalRevenue: number;
  totalCost: number;
  accountId?: string;
  status?: string;
  cancelledAt?: string;
  voided?: boolean;
};
type StockMovement = {
  id: string;
  inventoryId: string;
  type: "receipt" | "waste" | "sale" | "adjustment";
  quantity: number;
  date: string;
  note: string;
  referenceId?: string;
  document?: {
    key: string;
    fileName: string;
    contentType: string;
    size: number;
    uploadedAt: string;
  };
};
type FinancialEntry = {
  id: string;
  type: "income" | "expense" | "transfer";
  category: string;
  amount: number;
  date: string;
  accountId: string;
  toAccountId?: string;
  note: string;
  affectsProfit: boolean;
  payrollPaymentId?: string;
  reversedEntryId?: string;
  fixedExpenseId?: string;
  fixedExpenseDueDate?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  transactionId?: string;
};
type Transaction = {
  id: string;
  supplierId: string;
  type: "purchase" | "payment";
  amount: number;
  date: string;
  note: string;
  accountId?: string;
};
export type PurchaseOrder = {
  id: string;
  supplierId: string;
  status: "ordered" | "received" | "paid" | "cancelled";
  date: string;
  items: Array<{ inventoryId: string; quantity: number; unitCost: number }>;
  total: number;
  receivedAt?: string;
  paidAt?: string;
  accountId?: string;
  cancelReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
};
export type CostRules = {
  cardCommissionPct: number;
  deliveryCommissionPct: number;
  taxPct: number;
  deliveryPlatformRules?: Partial<Record<"coupang" | "baemin" | "yogiyo", {
    combinedPct?: number;
    brokeragePct: number;
    paymentPct: number;
    deliveryFeeWon: number;
    vatPct: number;
    couponPct: number;
    instantDiscountWon: number;
    advertisingPct: number;
  }>>;
};
export type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  createdAt: string;
};
export type ControlState = {
  productCategories: ProductCategory[];
  inventory: Inventory[];
  suppliers: Supplier[];
  accounts: Account[];
  sales: Sale[];
  stockMovements: StockMovement[];
  transactions: Transaction[];
  financialEntries: FinancialEntry[];
  purchaseOrders: PurchaseOrder[];
  staff: StaffMember[];
  workShifts: WorkShift[];
  payrollAdjustments: PayrollAdjustment[];
  attendanceDays: AttendanceDay[];
  payrollPayments: PayrollPayment[];
  monthlyCloses: MonthlyCloseRecord[];
  deletedItems?: DeletedItem[];
  costRules: CostRules;
  auditLog: AuditEntry[];
  updatedAt?: string;
  [key: string]: unknown;
};
type Backup = {
  id: string;
  actor: string;
  action: string;
  createdAt: string;
};
type ApiExportPayload = {
  product: string;
  format: string;
  apiVersion: string;
  exportedAt: string;
  branchId: string;
  updatedAt: string;
  sections: string[];
  state: Record<string, unknown>;
  error?: string;
};
type WorkerAccount = {
  id: string;
  branchId: string;
  name: string;
  username: string;
  active: boolean;
  canWarehouseReceipt: boolean;
  canSupplierDelivery: boolean;
  failedAttempts: number;
  lockedUntil: string;
  lastLoginAt: string;
  createdAt: string;
  telegramChatId: string;
  telegramChatName: string;
};
type AssignedTask = {
  id: string;
  branchId: string;
  workerId: string;
  workerName: string;
  title: string;
  description: string;
  priority: "normal" | "important" | "urgent";
  dueAt: string;
  status: "new" | "started" | "done" | "cancelled";
  telegramStatus: "sent" | "not-linked" | "not-configured" | "failed" | "pending";
  telegramSentAt: string;
  createdAt: string;
  completedAt: string;
  cancelReason: string;
  cancelledAt: string;
};

const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const calendarDate = seoulCalendarDate;
const today = seoulBusinessDate;
const payrollToday = seoulCalendarDate;
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
const downloadBrowserFile = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
const initialTenDayRows = () => Array.from({ length: 10 }, (_, index) => ({
  id: `past-${index + 1}`,
  date: seoulCalendarDate(new Date(Date.now() - (10 - index) * 86_400_000)),
  clockIn: "12:00",
  clockOut: "00:00",
}));
export default function ControlCenter({
  data,
  branchId,
  branchName,
  onSave,
  onInventorySaved,
  onBeforeInventory,
  onRemoveRecord,
}: {
  data: ControlState;
  branchId: string;
  branchName: string;
  onSave: (next: ControlState, action: string) => Promise<boolean>;
  onInventorySaved?: () => void | Promise<void>;
  onBeforeInventory?: () => void | Promise<void>;
  onRemoveRecord: (kind:"purchaseOrder",id:string,label:string)=>void;
}) {
  const [actualStock, setActualStock] = useState<Record<string, string>>({});
  const [inventoryNotice, setInventoryNotice] = useState("");
  const [orderForm, setOrderForm] = useState({
    supplierId: "",
    inventoryId: "",
    quantity: 0,
    unitCost: 0,
    date: today(),
  });
  const [orderNotice, setOrderNotice] = useState("");
  const purchaseOrderActionsRef = useRef(new Set<string>());
  const [staffForm, setStaffForm] = useState({
    name: "",
    payType: "monthly" as StaffMember["payType"],
    monthlySalary: 0,
    hourlyRate: 0,
    workDays: 26,
    dailyHours: 12,
    overtimeAfterHours: 12,
    overtimeMultiplier: 1,
    scheduledStartTime: "",
    scheduledEndTime: "",
    workerId: "",
  });
  const [editingStaffId, setEditingStaffId] = useState("");
  const [editingShiftId, setEditingShiftId] = useState("");
  const [, setPayrollClock] = useState(() => Date.now());
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState(payrollToday().slice(0, 7));
  const [selectedMonthEndMonth, setSelectedMonthEndMonth] = useState(payrollToday().slice(0, 7));
  const [monthEndNotice, setMonthEndNotice] = useState("");
  const [monthEndResetStock, setMonthEndResetStock] = useState<Record<string, boolean>>({});
  const [shiftForm, setShiftForm] = useState({
    staffId: "",
    date: payrollToday(),
    clockIn: "12:00",
    clockOut: "00:00",
    breakMinutes: 0,
    hourlyRate: 0,
    note: "",
  });
  const [tenDayStaffId, setTenDayStaffId] = useState("");
  const [tenDayRows, setTenDayRows] = useState(initialTenDayRows);
  const [adjustmentForm, setAdjustmentForm] = useState({
    staffId: "",
    date: payrollToday(),
    type: "bonus" as PayrollAdjustment["type"],
    amount: 0,
    note: "",
  });
  const [payrollEntryMode, setPayrollEntryMode] = useState<"shift" | "day" | "adjustment">("shift");
  const [dayForm, setDayForm] = useState({
    draftId: "",
    staffId: "",
    date: payrollToday(),
    status: "off" as AttendanceDay["status"],
    payMode: "unpaid" as AttendanceDay["payMode"],
    note: "",
  });
  const [paymentStaffId, setPaymentStaffId] = useState("");
  const [paymentForm, setPaymentForm] = useState({
    draftId: "",
    financialEntryId: "",
    kind: "salary" as PayrollPayment["kind"],
    amount: 0,
    accountId: "",
    paidAtLocal: seoulDateTimeLocal(),
    note: "",
  });
  const [payrollNotice, setPayrollNotice] = useState("");
  const [rules, setRules] = useState<CostRules>(data.costRules);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [backupNotice, setBackupNotice] = useState("");
  const [dataExportNotice, setDataExportNotice] = useState("");
  const [workerAccounts, setWorkerAccounts] = useState<WorkerAccount[]>([]);
  const [workerForm, setWorkerForm] = useState({ name: "", username: "", pin: "" });
  const [workerNotice, setWorkerNotice] = useState("");
  const [workerTelegramLinks, setWorkerTelegramLinks] = useState<Record<string, string>>({});
  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  const [taskForm, setTaskForm] = useState({
    workerId: "",
    title: "",
    description: "",
    priority: "normal" as AssignedTask["priority"],
    dueAt: `${calendarDate()}T23:50`,
  });
  const [bulkTaskForm, setBulkTaskForm] = useState({
    workerIds: [] as string[],
    title: "",
    description: "",
    priority: "normal" as AssignedTask["priority"],
    dueAt: `${calendarDate()}T23:50`,
  });
  const [taskNotice, setTaskNotice] = useState("");
  const [auditActor, setAuditActor] = useState("");
  const [auditPage, setAuditPage] = useState(0);
  const [busy, setBusy] = useState("");

  const hasOpenShift = data.workShifts.some((shift) => shift.status === "open");
  useEffect(() => {
    if (!hasOpenShift) return;
    const interval = window.setInterval(() => setPayrollClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [hasOpenShift]);

  useEffect(() => {
    let previousDate = today();
    const refreshDate = () => {
      const nextDate = today();
      setOrderForm((current) => rolloverFormDate(current, previousDate, nextDate));
      previousDate = nextDate;
    };
    const interval = window.setInterval(refreshDate, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const refreshBackups = async () => {
    try {
      const response = await fetch(`/api/backups?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" });
      const value = await response.json() as { backups?: Backup[] };
      if (response.ok) setBackups(value.backups || []);
    } catch {
      setBackupNotice("Zaxira nusxalar ochilmadi.");
    }
  };

  useEffect(() => {
    let active = true;
    fetch(`/api/backups?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" })
      .then((response) => response.json().then((value: { backups?: Backup[] }) => ({ response, value })))
      .then(({ response, value }) => {
        if (active && response.ok) setBackups(value.backups || []);
      })
      .catch(() => {
        if (active) setBackupNotice("Zaxira nusxalar ochilmadi.");
      });
    return () => {
      active = false;
    };
  }, [branchId]);

  const refreshWorkerAccounts = async () => {
    try {
      const response = await fetch(
        `/api/worker-auth?admin=1&branch=${encodeURIComponent(branchId)}`,
        { cache: "no-store" },
      );
      const value = await response.json() as { accounts?: WorkerAccount[]; error?: string };
      if (!response.ok) throw new Error(value.error || "Akkauntlar ochilmadi.");
      setWorkerAccounts(value.accounts || []);
    } catch (error) {
      setWorkerNotice(error instanceof Error ? error.message : "Akkauntlar ochilmadi.");
    }
  };

  const refreshAssignedTasks = async () => {
    try {
      const response = await fetch(
        `/api/worker-tasks?admin=1&branch=${encodeURIComponent(branchId)}`,
        { cache: "no-store" },
      );
      const value = await response.json() as { tasks?: AssignedTask[]; error?: string };
      if (!response.ok) throw new Error(value.error || "Vazifalar ochilmadi.");
      setAssignedTasks(value.tasks || []);
    } catch (error) {
      setTaskNotice(error instanceof Error ? error.message : "Vazifalar ochilmadi.");
    }
  };

  useEffect(() => {
    let active = true;
    fetch(`/api/worker-auth?admin=1&branch=${encodeURIComponent(branchId)}`, { cache: "no-store" })
      .then((response) => response.json().then((value: { accounts?: WorkerAccount[] }) => ({ response, value })))
      .then(({ response, value }) => {
        if (active && response.ok) setWorkerAccounts(value.accounts || []);
      })
      .catch(() => {
        if (active) setWorkerNotice("Xodim akkauntlari ochilmadi.");
      });
    return () => {
      active = false;
    };
  }, [branchId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/worker-tasks?admin=1&branch=${encodeURIComponent(branchId)}`, { cache: "no-store" })
      .then((response) => response.json().then((value: { tasks?: AssignedTask[] }) => ({ response, value })))
      .then(({ response, value }) => {
        if (active && response.ok) setAssignedTasks(value.tasks || []);
      })
      .catch(() => {
        if (active) setTaskNotice("Vazifalar ochilmadi.");
      });
    return () => {
      active = false;
    };
  }, [branchId]);

  const stockDifferences = useMemo(() => data.inventory.map((item) => {
    const raw = actualStock[item.id];
    if (raw === undefined || raw === "") return null;
    const actual = Number(raw);
    if (!Number.isFinite(actual) || actual < 0) return null;
    return { item, actual, difference: actual - item.stock };
  }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry && entry.difference)), [actualStock, data.inventory]);

  const createOrder = async () => {
    const supplier = data.suppliers.find((entry) => entry.id === orderForm.supplierId);
    const inventory = data.inventory.find((entry) => entry.id === orderForm.inventoryId);
    if (!supplier || !inventory || orderForm.quantity <= 0 || orderForm.unitCost < 0) {
      setOrderNotice("Yetkazuvchi, mahsulot, miqdor va narxni kiriting.");
      return;
    }
    const order: PurchaseOrder = {
      id: id("order"),
      supplierId: supplier.id,
      status: "ordered",
      date: orderForm.date,
      items: [{ inventoryId: inventory.id, quantity: orderForm.quantity, unitCost: orderForm.unitCost }],
      total: Math.round(orderForm.quantity * orderForm.unitCost),
    };
    const saved = await onSave({
      ...data,
      purchaseOrders: [order, ...data.purchaseOrders],
    }, `Xarid buyurtmasi yaratildi · ${inventory.name}`);
    if (saved) {
      setOrderForm((current) => ({ ...current, inventoryId: "", quantity: 0, unitCost: 0 }));
      setOrderNotice("✓ Buyurtma yaratildi. Mahsulot kelganda “Qabul qilindi”ni bosing.");
    }
  };

  const receiveOrder = async (order: PurchaseOrder) => {
    if (order.status !== "ordered") return;
    if (!window.confirm("Mahsulotlar haqiqatan kelib tushdimi? Omborga qo‘shilsinmi?")) return;
    const actionKey = `receive:${order.id}`;
    if (purchaseOrderActionsRef.current.has(actionKey)) {
      setOrderNotice("Bu buyurtma qabul qilinmoqda. Takror bosish hisobga olinmadi.");
      return;
    }
    purchaseOrderActionsRef.current.add(actionKey);
    const supplier = data.suppliers.find((entry) => entry.id === order.supplierId);
    const transactionId = `purchase-order-purchase:${order.id}`;
    const movementIds = new Set(order.items.map((_, index) => `purchase-order-receipt:${order.id}:${index}`));
    try {
      if (!supplier) {
        setOrderNotice("Yetkazib beruvchi topilmadi. Buyurtma qabul qilinmadi.");
        return;
      }
      if (
        data.transactions.some((entry) => entry.id === transactionId)
        || data.stockMovements.some((entry) => movementIds.has(entry.id))
      ) {
        setOrderNotice("Bu buyurtma oldin qabul qilingan. Ombor va qarzga takror qo‘shilmadi.");
        return;
      }
      const missingItem = order.items.find((item) => !data.inventory.some((inventory) => inventory.id === item.inventoryId));
      if (missingItem) {
        setOrderNotice("Buyurtmadagi mahsulot omborda topilmadi. Qabul qilish bekor qilindi.");
        return;
      }
      const receivedDate = today();
      const movements: StockMovement[] = order.items.map((item, index) => ({
        id: `purchase-order-receipt:${order.id}:${index}`,
        inventoryId: item.inventoryId,
        type: "receipt",
        quantity: item.quantity,
        date: receivedDate,
        note: `Xarid qabul qilindi · ${supplier.name}`,
        referenceId: order.id,
      }));
      const saved = await onSave({
        ...data,
        inventory: data.inventory.map((inventory) => {
          const ordered = order.items.find((item) => item.inventoryId === inventory.id);
          return ordered
            ? {
              ...inventory,
              stock: inventory.stock + ordered.quantity,
              unitCost: ordered.unitCost || inventory.unitCost,
              packageCost: (ordered.unitCost || inventory.unitCost) * inventory.unitsPerPackage,
            }
            : inventory;
        }),
        stockMovements: [...movements, ...data.stockMovements],
        suppliers: data.suppliers.map((entry) => entry.id === order.supplierId
          ? { ...entry, balance: entry.balance + order.total }
          : entry),
        transactions: [{
          id: transactionId,
          supplierId: order.supplierId,
          type: "purchase",
          amount: order.total,
          date: receivedDate,
          note: `Buyurtma ${order.id.slice(-6)} qabul qilindi`,
        }, ...data.transactions],
        purchaseOrders: data.purchaseOrders.map((entry) => entry.id === order.id
          ? { ...entry, status: "received" as const, receivedAt: new Date().toISOString() }
          : entry),
      }, `Xarid qabul qilindi · ${supplier.name}`);
      setOrderNotice(saved
        ? `✓ ${supplier.name}: ombor kirimi va qarz bir marta saqlandi.`
        : "Buyurtma qabul qilinmadi. Qayta urinib ko‘ring.");
    } finally {
      purchaseOrderActionsRef.current.delete(actionKey);
    }
  };

  const payOrder = async (order: PurchaseOrder, accountId: string) => {
    if (order.status !== "received") return;
    if (!accountId || !window.confirm(`${won(order.total)} to‘lovni tasdiqlaysizmi?`)) return;
    const supplier = data.suppliers.find((entry) => entry.id === order.supplierId);
    const account = data.accounts.find((entry) => entry.id === accountId);
    const actionKey = `pay:${order.id}`;
    if (purchaseOrderActionsRef.current.has(actionKey)) {
      setOrderNotice("Bu to‘lov saqlanmoqda. Takror bosish hisobga olinmadi.");
      return;
    }
    purchaseOrderActionsRef.current.add(actionKey);
    const transactionId = `purchase-order-payment:${order.id}`;
    try {
      if (!supplier || !account) {
        setOrderNotice("Yetkazib beruvchi yoki to‘lov hisobi topilmadi.");
        return;
      }
      if (
        data.transactions.some((entry) => entry.id === transactionId)
        || data.financialEntries.some((entry) => entry.transactionId === transactionId)
      ) {
        setOrderNotice("Bu buyurtma to‘lovi oldin saqlangan. Takror pul chiqimi yaratilmadi.");
        return;
      }
      const paymentDate = today();
      const saved = await onSave({
        ...data,
        suppliers: data.suppliers.map((entry) => entry.id === order.supplierId
          ? { ...entry, balance: entry.balance - order.total }
          : entry),
        transactions: [{
          id: transactionId,
          supplierId: order.supplierId,
          type: "payment",
          amount: order.total,
          date: paymentDate,
          note: `Buyurtma ${order.id.slice(-6)} to‘landi`,
          accountId,
        }, ...data.transactions],
        financialEntries: [{
          id: `purchase-order-finance:${order.id}`,
          type: "expense",
          category: "Mahsulot xaridi",
          amount: order.total,
          date: paymentDate,
          accountId,
          note: `${supplier.name} · buyurtma to‘lovi`,
          affectsProfit: false,
          transactionId,
        }, ...data.financialEntries],
        purchaseOrders: data.purchaseOrders.map((entry) => entry.id === order.id
          ? { ...entry, status: "paid" as const, paidAt: new Date().toISOString(), accountId }
          : entry),
      }, `Xarid to‘landi · ${supplier.name}`);
      setOrderNotice(saved
        ? `✓ ${supplier.name}: ${won(order.total)} ${account.name} hisobidan to‘landi; qarz va pul chiqimi bog‘landi.`
        : "Buyurtma to‘lovi saqlanmadi. Qayta urinib ko‘ring.");
    } finally {
      purchaseOrderActionsRef.current.delete(actionKey);
    }
  };

  const cancelOrder = async (order: PurchaseOrder) => {
    if (!window.confirm("Bu buyurtma bekor qilinsinmi?")) return;
    const reason = askCancellationReason(`Xarid buyurtmasi · ${won(order.total)}`);
    if (!reason) return;
    const cancelledAt = new Date().toISOString();
    await onSave({
      ...data,
      purchaseOrders: data.purchaseOrders.map((entry) => entry.id === order.id
        ? { ...entry, status: "cancelled" as const, cancelReason: reason, cancelledAt, cancelledBy: "Rahbar" }
        : entry),
    }, `Xarid buyurtmasi bekor qilindi · Sabab: ${reason}`);
  };

  const resetStaffForm = () => {
    setEditingStaffId("");
    setStaffForm({
      name: "",
      payType: "monthly",
      monthlySalary: 0,
      hourlyRate: 0,
      workDays: 26,
      dailyHours: 12,
      overtimeAfterHours: 12,
      overtimeMultiplier: 1,
      scheduledStartTime: "",
      scheduledEndTime: "",
      workerId: "",
    });
  };

  const saveStaff = async () => {
    const name = staffForm.name.trim().replace(/\s+/g, " ");
    const salaryValid = staffForm.payType === "monthly"
      ? Number.isFinite(staffForm.monthlySalary) && staffForm.monthlySalary > 0
      : Number.isFinite(staffForm.hourlyRate) && staffForm.hourlyRate > 0;
    const duplicateWorker = staffForm.workerId && data.staff.some((member) => (
      member.id !== editingStaffId && member.workerId === staffForm.workerId
    ));
    const scheduleRange = staffForm.scheduledStartTime || staffForm.scheduledEndTime
      ? shiftRange("2026-01-01", staffForm.scheduledStartTime, staffForm.scheduledEndTime)
      : null;
    if (
      !name || !salaryValid || staffForm.workDays < 1 || staffForm.workDays > 31
      || staffForm.dailyHours <= 0 || staffForm.dailyHours > 18
      || staffForm.overtimeAfterHours < 0.5 || staffForm.overtimeAfterHours > 18
      || staffForm.overtimeMultiplier < 1 || staffForm.overtimeMultiplier > 5
      || (Boolean(staffForm.scheduledStartTime || staffForm.scheduledEndTime) && !scheduleRange)
    ) {
      setPayrollNotice("Xodim ismi, maosh turi, ish kuni va kunlik soatni tekshiring.");
      return;
    }
    if (duplicateWorker) {
      setPayrollNotice("Bu xodim akkaunti boshqa maosh yozuviga bog‘langan.");
      return;
    }
    const previousMember = data.staff.find((member) => member.id === editingStaffId);
    if (
      previousMember
      && previousMember.workerId !== staffForm.workerId
      && data.workShifts.some((shift) => shift.staffId === previousMember.id && shift.status === "open")
    ) {
      setPayrollNotice("Xodim hozir ishda. Login bog‘lanishini o‘zgartirishdan oldin smenani tugating.");
      return;
    }
    const nextMember: StaffMember = {
      id: editingStaffId || id("staff"),
      name,
      payType: staffForm.payType,
      monthlySalary: staffForm.payType === "monthly" ? staffForm.monthlySalary : 0,
      hourlyRate: staffForm.payType === "hourly" ? staffForm.hourlyRate : 0,
      workDays: staffForm.workDays,
      dailyHours: staffForm.dailyHours,
      overtimeAfterHours: staffForm.overtimeAfterHours,
      overtimeMultiplier: staffForm.overtimeMultiplier,
      scheduledStartTime: staffForm.scheduledStartTime,
      scheduledEndTime: staffForm.scheduledEndTime,
      workerId: staffForm.workerId,
      active: editingStaffId
        ? data.staff.find((member) => member.id === editingStaffId)?.active !== false
        : true,
    };
    setBusy("payroll-staff");
    try {
      const saved = await onSave({
        ...data,
        staff: editingStaffId
          ? data.staff.map((member) => member.id === editingStaffId ? nextMember : member)
          : [...data.staff, nextMember],
        // Freeze the rate used by legacy shifts before a profile edit can
        // retroactively change their payroll.
        workShifts: previousMember ? freezeWorkShiftRates(previousMember, data.workShifts) : data.workShifts,
      }, `${editingStaffId ? "Xodim maoshi yangilandi" : "Xodim maoshi qo‘shildi"} · ${name}`);
      if (saved) {
        resetStaffForm();
        setShiftForm((current) => current.staffId
          ? current
          : { ...current, staffId: nextMember.id, hourlyRate: staffHourlyRate(nextMember) });
        setAdjustmentForm((current) => ({ ...current, staffId: current.staffId || nextMember.id }));
        setDayForm((current) => ({ ...current, staffId: current.staffId || nextMember.id }));
        setPayrollNotice(`✓ ${name} maosh va ish rejasi saqlandi.`);
      } else {
        setPayrollNotice("Maosh ma’lumoti saqlanmadi. Yuqoridagi xabarni tekshirib, qayta urinib ko‘ring.");
      }
    } finally {
      setBusy("");
    }
  };

  const editStaff = (member: StaffMember) => {
    setEditingStaffId(member.id);
    setStaffForm({
      name: member.name,
      payType: member.payType,
      monthlySalary: member.monthlySalary,
      hourlyRate: member.hourlyRate,
      workDays: member.workDays,
      dailyHours: member.dailyHours,
      overtimeAfterHours: member.overtimeAfterHours || member.dailyHours,
      overtimeMultiplier: member.overtimeMultiplier || 1,
      scheduledStartTime: member.scheduledStartTime,
      scheduledEndTime: member.scheduledEndTime,
      workerId: member.workerId,
    });
    setPayrollNotice(`${member.name} ma’lumotini tahrirlayapsiz.`);
    window.requestAnimationFrame(() => document.getElementById("payroll-control")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const resetShiftForm = (staffId = "") => {
    const member = data.staff.find((entry) => entry.id === staffId);
    setEditingShiftId("");
    setShiftForm({
      staffId,
      date: payrollToday(),
      clockIn: "12:00",
      clockOut: "00:00",
      breakMinutes: 0,
      hourlyRate: member ? staffHourlyRate(member) : 0,
      note: "",
    });
  };

  const addWorkShift = async () => {
    const member = data.staff.find((entry) => entry.id === shiftForm.staffId);
    const range = shiftRange(shiftForm.date, shiftForm.clockIn, shiftForm.clockOut);
    if (
      !member
      || !range
      || !Number.isFinite(shiftForm.hourlyRate)
      || shiftForm.hourlyRate <= 0
    ) {
      setPayrollNotice("Xodim, sana va kelish-ketish vaqtini tekshiring.");
      return;
    }
    const overlaps = data.workShifts.some((shift) => {
      if (shift.id === editingShiftId || shift.staffId !== member.id || shift.status === "void") return false;
      const start = Date.parse(shift.clockIn);
      const end = shift.status === "open" ? start + 18 * 60 * 60_000 : Date.parse(shift.clockOut);
      return Date.parse(range.clockIn) < end && Date.parse(range.clockOut) > start;
    });
    if (overlaps) {
      setPayrollNotice("Bu vaqtda xodimning boshqa smenasi bor. Avval uni tekshiring.");
      return;
    }
    const existing = data.workShifts.find((shift) => shift.id === editingShiftId);
    const now = new Date().toISOString();
    const payWindow = staffPayWindowForInstant(member, new Date(range.clockIn));
    const shift: WorkShift = {
      id: existing?.id || id("shift"),
      staffId: member.id,
      // Rahbar tanlagan kalendar sanasini aynan saqlaymiz. Business-day
      // qoidasi 12:00 dan oldingi qo‘lda kiritilgan vaqtni kechagi kunga
      // surmasligi kerak.
      date: seoulCalendarDate(new Date(range.clockIn)),
      clockIn: range.clockIn,
      clockOut: range.clockOut,
      breakMinutes: 0,
      hourlyRateAtShift: shiftForm.hourlyRate,
      overtimeAfterHoursAtShift: Number(existing?.overtimeAfterHoursAtShift) > 0
        ? existing!.overtimeAfterHoursAtShift
        : member.overtimeAfterHours || member.dailyHours,
      overtimeMultiplierAtShift: Number(existing?.overtimeMultiplierAtShift) >= 1
        ? existing!.overtimeMultiplierAtShift
        : member.overtimeMultiplier || 1,
      payWindowStartAtShift: existing?.payWindowStartAtShift || payWindow?.start,
      payWindowEndAtShift: existing?.payWindowEndAtShift || payWindow?.end,
      note: shiftForm.note.trim(),
      source: "owner",
      status: "closed",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    setBusy("payroll-shift");
    try {
      const saved = await onSave({
        ...data,
        workShifts: existing
          ? data.workShifts.map((entry) => entry.id === existing.id ? shift : entry)
          : [shift, ...data.workShifts],
      }, `${existing ? "Ish vaqti tuzatildi" : "Ish vaqti qo‘shildi"} · ${member.name}`);
      if (saved) {
        resetShiftForm(member.id);
        setPayrollNotice(`✓ ${member.name}: ${formatMinutes(workShiftMinutes(shift))} saqlandi.`);
      } else {
        setPayrollNotice("Ish vaqti saqlanmadi. Yuqoridagi xabarni tekshirib, qayta urinib ko‘ring.");
      }
    } finally {
      setBusy("");
    }
  };

  const saveTenDayShifts = async () => {
    const member = data.staff.find((entry) => entry.id === tenDayStaffId);
    if (!member) {
      setPayrollNotice("10 kunlik vaqt uchun xodimni tanlang.");
      return;
    }
    const parsed = tenDayRows.map((row) => ({ row, range: shiftRange(row.date, row.clockIn, row.clockOut) }));
    if (parsed.some(({ range }) => !range)) {
      setPayrollNotice("10 kunlik ro‘yxatdagi sana, kelgan va ketgan vaqtlarini tekshiring.");
      return;
    }
    const ranges = parsed.map(({ row, range }) => ({ row, range: range! }));
    if (new Set(ranges.map(({ row }) => row.date)).size !== ranges.length) {
      setPayrollNotice("10 kunlik ro‘yxatda bir sana ikki marta kiritilgan.");
      return;
    }
    const conflicts = ranges.some(({ range }) => data.workShifts.some((shift) => {
      if (shift.staffId !== member.id || shift.status === "void") return false;
      const start = Date.parse(shift.clockIn);
      const end = shift.status === "open" ? start + 18 * 60 * 60_000 : Date.parse(shift.clockOut);
      return Date.parse(range.clockIn) < end && Date.parse(range.clockOut) > start;
    }));
    if (conflicts) {
      setPayrollNotice("Tanlangan 10 kun ichida oldin kiritilgan ish vaqti bor. Pastdagi kunlar tarixini tekshiring.");
      return;
    }
    const now = new Date().toISOString();
    const rate = staffHourlyRate(member);
    const shifts: WorkShift[] = ranges.map(({ range }, index) => {
      const payWindow = staffPayWindowForInstant(member, new Date(range.clockIn));
      return ({
      id: id(`shift10-${index + 1}`),
      staffId: member.id,
      date: seoulCalendarDate(new Date(range.clockIn)),
      clockIn: range.clockIn,
      clockOut: range.clockOut,
      breakMinutes: 0,
      hourlyRateAtShift: rate,
      overtimeAfterHoursAtShift: member.overtimeAfterHours || member.dailyHours,
      overtimeMultiplierAtShift: member.overtimeMultiplier || 1,
      payWindowStartAtShift: payWindow?.start,
      payWindowEndAtShift: payWindow?.end,
      note: "Oldingi 10 kunlik ish vaqti",
      source: "owner",
      status: "closed",
      createdAt: now,
      updatedAt: now,
      });
    });
    setBusy("payroll-ten-days");
    try {
      const saved = await onSave({ ...data, workShifts: [...shifts, ...data.workShifts] }, `10 kunlik ish vaqti qo‘shildi · ${member.name}`);
      setPayrollNotice(saved
        ? `✓ ${member.name}: 10 kun, jami ${formatMinutes(shifts.reduce((sum, shift) => sum + workShiftMinutes(shift), 0))} saqlandi.`
        : "10 kunlik ish vaqti saqlanmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy("");
    }
  };

  const editWorkShift = (shift: WorkShift) => {
    const member = data.staff.find((entry) => entry.id === shift.staffId);
    setEditingShiftId(shift.id);
    setShiftForm({
      staffId: shift.staffId,
      date: seoulCalendarDate(new Date(shift.clockIn)),
      clockIn: seoulClock(new Date(shift.clockIn)),
      clockOut: shift.clockOut ? seoulClock(new Date(shift.clockOut)) : "",
      breakMinutes: shift.breakMinutes,
      hourlyRate: Number(shift.hourlyRateAtShift) > 0
        ? Number(shift.hourlyRateAtShift)
        : member ? staffHourlyRate(member) : 0,
      note: shift.note,
    });
    setPayrollNotice(shift.status === "open"
      ? "Ochiq smenani tuzatish uchun ketish vaqtini kiriting. Saqlash smenani yakunlaydi."
      : "Smena vaqtini, stavkasini yoki tanaffusni tuzatib, o‘zgarishni saqlang.");
    window.requestAnimationFrame(() => document.getElementById("payroll-shift-form")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const addPayrollAdjustment = async () => {
    const member = data.staff.find((entry) => entry.id === adjustmentForm.staffId);
    if (!member || !/^\d{4}-\d{2}-\d{2}$/.test(adjustmentForm.date) || !Number.isFinite(adjustmentForm.amount) || adjustmentForm.amount <= 0) {
      setPayrollNotice("Xodim, sana va summani tekshiring.");
      return;
    }
    const adjustment: PayrollAdjustment = {
      id: id("payroll"),
      staffId: member.id,
      date: adjustmentForm.date,
      type: adjustmentForm.type,
      amount: adjustmentForm.amount,
      note: adjustmentForm.note.trim(),
      voided: false,
    };
    setBusy("payroll-adjustment");
    try {
      const saved = await onSave({ ...data, payrollAdjustments: [adjustment, ...data.payrollAdjustments] }, `${adjustmentForm.type === "bonus" ? "Bonus" : adjustmentForm.type === "advance" ? "Avans" : "Ushlanma"} qo‘shildi · ${member.name}`);
      if (saved) {
        setAdjustmentForm((current) => ({ ...current, amount: 0, note: "" }));
        setPayrollNotice(`✓ ${member.name} uchun ${won(adjustment.amount)} yozildi.`);
      } else {
        setPayrollNotice("Maosh yozuvi saqlanmadi. Yuqoridagi xabarni tekshirib, qayta urinib ko‘ring.");
      }
    } finally {
      setBusy("");
    }
  };

  const saveAttendanceDay = async () => {
    const member = data.staff.find((entry) => entry.id === dayForm.staffId);
    const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dayForm.date);
    if (!member || !dateValid) {
      setPayrollNotice("Xodim va sanani tanlang.");
      return;
    }
    if (data.workShifts.some((shift) => shift.staffId === member.id && shift.date === dayForm.date && shift.status !== "void")) {
      setPayrollNotice("Bu kunda ish vaqti bor. Avval ish vaqtini bekor qiling.");
      return;
    }
    const existing = data.attendanceDays.find((day) => (
      day.staffId === member.id && day.date === dayForm.date && !day.voided
    ));
    const now = new Date().toISOString();
    const day: AttendanceDay = {
      id: existing?.id || dayForm.draftId || id("day"),
      staffId: member.id,
      date: dayForm.date,
      status: dayForm.status,
      payMode: dayForm.payMode,
      plannedMinutesAtDay: dayForm.payMode === "planned" ? Math.round(member.dailyHours * 60) : 0,
      hourlyRateAtDay: dayForm.payMode === "planned" ? staffHourlyRate(member) : 0,
      note: dayForm.note.trim(),
      voided: false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (!existing && !dayForm.draftId) setDayForm((current) => ({ ...current, draftId: day.id }));
    setBusy("payroll-day");
    try {
      const saved = await onSave({
        ...data,
        attendanceDays: existing
          ? data.attendanceDays.map((entry) => entry.id === existing.id ? day : entry)
          : [day, ...data.attendanceDays],
      }, `Kun holati saqlandi · ${member.name}`);
      if (saved) {
        setDayForm((current) => ({ ...current, draftId: "", note: "" }));
        setPayrollNotice(`✓ ${member.name} · ${day.date} · ${day.status === "off" ? "Dam olish" : day.status === "sick" ? "Kasal" : "Kelmadi"} saqlandi.`);
      } else {
        setPayrollNotice("Kun holati saqlanmadi. Qayta urinib ko‘ring.");
      }
    } finally {
      setBusy("");
    }
  };

  const voidAttendanceDay = async (day: AttendanceDay) => {
    const member = data.staff.find((entry) => entry.id === day.staffId);
    if (!window.confirm(`${member?.name || "Xodim"} uchun ${day.date} kun holati bekor qilinsinmi?`)) return;
    const reason = askCancellationReason(`${member?.name || "Xodim"} · ${day.date} kun holati`);
    if (!reason) return;
    const voidedAt = new Date().toISOString();
    setBusy(`payroll-void-day-${day.id}`);
    try {
      const saved = await onSave({
        ...data,
        attendanceDays: data.attendanceDays.map((entry) => entry.id === day.id
          ? { ...entry, voided: true, updatedAt: voidedAt, voidedAt, voidedBy: "Rahbar", voidReason: reason }
          : entry),
      }, `Kun holati bekor qilindi · ${member?.name || "Xodim"} · Sabab: ${reason}`);
      setPayrollNotice(saved ? "✓ Kun holati bekor qilindi." : "Kun holatini bekor qilib bo‘lmadi.");
    } finally {
      setBusy("");
    }
  };

  const openPayrollPayment = (member: StaffMember, amount: number) => {
    setPaymentStaffId(member.id);
    setPaymentForm((current) => ({
      ...current,
      draftId: current.draftId || id("pay"),
      financialEntryId: current.financialEntryId || id("fin"),
      amount: Math.max(0, Math.round(amount)),
      accountId: current.accountId || data.accounts[0]?.id || "",
      paidAtLocal: seoulDateTimeLocal(),
    }));
    setPayrollNotice(`${member.name} uchun ${selectedPayrollMonth} oylik to‘lovini kiriting.`);
    window.requestAnimationFrame(() => document.getElementById(`payroll-payment-${member.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const savePayrollPayment = async () => {
    const member = data.staff.find((entry) => entry.id === paymentStaffId);
    const account = data.accounts.find((entry) => entry.id === paymentForm.accountId);
    const paidAt = seoulLocalDateTimeToIso(paymentForm.paidAtLocal);
    const paymentDate = paidAt ? seoulCalendarDate(new Date(paidAt)) : "";
    if (
      !member || !account || !paidAt || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
      || !Number.isFinite(paymentForm.amount) || paymentForm.amount <= 0
    ) {
      setPayrollNotice("Xodim, summa, berilgan sana-vaqt va to‘lov hisobini tekshiring.");
      return;
    }
    const kindLabel = paymentForm.kind === "advance" ? "avans" : "oylik";
    if (!window.confirm(`${member.name} uchun ${won(paymentForm.amount)} ${account.name} hisobidan ${kindLabel} to‘lansinmi?`)) return;
    const now = new Date().toISOString();
    const paymentId = paymentForm.draftId || id("pay");
    const financialEntryId = paymentForm.financialEntryId || id("fin");
    if (!paymentForm.draftId || !paymentForm.financialEntryId) {
      setPaymentForm((current) => ({ ...current, draftId: paymentId, financialEntryId }));
    }
    const payment: PayrollPayment = {
      id: paymentId,
      staffId: member.id,
      month: selectedPayrollMonth,
      date: paymentDate,
      kind: paymentForm.kind,
      amount: paymentForm.amount,
      accountId: account.id,
      financialEntryId,
      note: paymentForm.note.trim(),
      voided: false,
      reversalEntryId: "",
      paidAt,
      createdAt: now,
      updatedAt: now,
    };
    const finance: FinancialEntry = {
      id: financialEntryId,
      type: "expense",
      category: "Maosh to‘lovi",
      amount: payment.amount,
      date: payment.date,
      accountId: payment.accountId,
      note: `${member.name} · ${payment.month} · ${kindLabel}${payment.note ? ` · ${payment.note}` : ""}`,
      affectsProfit: false,
      payrollPaymentId: payment.id,
    };
    setBusy("payroll-payment");
    try {
      const saved = await onSave({
        ...data,
        payrollPayments: [payment, ...data.payrollPayments],
        financialEntries: [finance, ...data.financialEntries],
      }, `${paymentForm.kind === "advance" ? "Avans" : "Oylik"} to‘landi · ${member.name}`);
      if (saved) {
        setPaymentStaffId("");
        setPaymentForm((current) => ({ ...current, draftId: "", financialEntryId: "", amount: 0, paidAtLocal: seoulDateTimeLocal(), note: "" }));
        setPayrollNotice(`✓ To‘lov saqlandi: ${won(payment.amount)} · ${account.name}.`);
      } else {
        setPayrollNotice("To‘lov saqlanmadi. Qayta urinib ko‘ring.");
      }
    } finally {
      setBusy("");
    }
  };

  const voidPayrollPayment = async (payment: PayrollPayment) => {
    if (payment.voided) return;
    const member = data.staff.find((entry) => entry.id === payment.staffId);
    const original = data.financialEntries.find((entry) => entry.id === payment.financialEntryId);
    if (!original) {
      setPayrollNotice("To‘lovning pul yozuvi topilmadi. Bekor qilinganlar va pul tarixidan tekshiring.");
      return;
    }
    if (!window.confirm(`${member?.name || "Xodim"} uchun ${won(payment.amount)} to‘lov bekor qilinsinmi? Pul hisobga qaytariladi.`)) return;
    const reason = askCancellationReason(`${member?.name || "Xodim"} · ${won(payment.amount)} to‘lov`);
    if (!reason) return;
    const now = new Date().toISOString();
    // Stable operation id makes a retry idempotent even when the first response
    // is lost after the server has already committed the reversal.
    const reversalId = `fin-reversal-${payment.id}`;
    const reversal: FinancialEntry = {
      id: reversalId,
      type: "income",
      category: "Maosh to‘lovi bekori",
      amount: payment.amount,
      date: payrollToday(),
      accountId: payment.accountId,
      note: `${member?.name || "Xodim"} · ${payment.month} to‘lovi bekor qilindi`,
      affectsProfit: false,
      payrollPaymentId: payment.id,
      reversedEntryId: payment.financialEntryId,
      cancellationReason: reason,
      cancelledAt: now,
      cancelledBy: "Rahbar",
    };
    setBusy(`payroll-void-payment-${payment.id}`);
    try {
      const saved = await onSave({
        ...data,
        payrollPayments: data.payrollPayments.map((entry) => entry.id === payment.id
          ? { ...entry, voided: true, reversalEntryId: reversalId, updatedAt: now, voidReason: reason, voidedAt: now, voidedBy: "Rahbar" }
          : entry),
        financialEntries: [reversal, ...data.financialEntries],
      }, `Oylik to‘lovi bekor qilindi · ${member?.name || "Xodim"} · Sabab: ${reason}`);
      setPayrollNotice(saved ? "✓ To‘lov bekor qilindi va pul hisobga qaytarildi." : "To‘lovni bekor qilib bo‘lmadi.");
    } finally {
      setBusy("");
    }
  };

  const voidWorkShift = async (shift: WorkShift) => {
    const member = data.staff.find((entry) => entry.id === shift.staffId);
    if (!window.confirm(`${member?.name || "Xodim"} smenasi bekor qilinsinmi? Oldingi holat arxivda qoladi.`)) return;
    const reason = askCancellationReason(`${member?.name || "Xodim"} · ${shift.date} smena`);
    if (!reason) return;
    const voidedAt = new Date().toISOString();
    setBusy(`payroll-void-shift-${shift.id}`);
    try {
      const saved = await onSave({
        ...data,
        workShifts: data.workShifts.map((entry) => entry.id === shift.id
          ? { ...entry, status: "void" as const, updatedAt: voidedAt, voidReason: reason, voidedAt, voidedBy: "Rahbar" }
          : entry),
      }, `Ish vaqti bekor qilindi · ${member?.name || "Xodim"} · Sabab: ${reason}`);
      setPayrollNotice(saved ? "✓ Ish vaqti bekor qilindi." : "Ish vaqtini bekor qilib bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy("");
    }
  };

  const voidPayrollAdjustment = async (adjustment: PayrollAdjustment) => {
    const member = data.staff.find((entry) => entry.id === adjustment.staffId);
    if (!window.confirm(`${member?.name || "Xodim"} uchun ${won(adjustment.amount)} yozuvi bekor qilinsinmi?`)) return;
    const reason = askCancellationReason(`${member?.name || "Xodim"} · ${won(adjustment.amount)} maosh yozuvi`);
    if (!reason) return;
    const voidedAt = new Date().toISOString();
    setBusy(`payroll-void-adjustment-${adjustment.id}`);
    try {
      const saved = await onSave({
        ...data,
        payrollAdjustments: data.payrollAdjustments.map((entry) => entry.id === adjustment.id
          ? { ...entry, voided: true, voidReason: reason, voidedAt, voidedBy: "Rahbar" }
          : entry),
      }, `Maosh tuzatmasi bekor qilindi · ${member?.name || "Xodim"} · Sabab: ${reason}`);
      setPayrollNotice(saved ? "✓ Maosh yozuvi bekor qilindi." : "Maosh yozuvini bekor qilib bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy("");
    }
  };

  const saveRules = async () => {
    const cleanRules = {
      cardCommissionPct: Math.max(0, rules.cardCommissionPct || 0),
      deliveryCommissionPct: Math.max(0, rules.deliveryCommissionPct || 0),
      taxPct: data.costRules.taxPct,
      deliveryPlatformRules: rules.deliveryPlatformRules,
    };
    const fixedExpenses = Array.isArray(data.fixedExpenses)
      ? data.fixedExpenses as Array<{ name?: string; category?: string; active?: boolean; automatic?: boolean }>
      : [];
    const conflicting = fixedExpenses.find((expense) => (
      expense.active !== false
      && expense.automatic === true
      && costRuleCoversCategory(String(expense.category || ""), cleanRules)
    ));
    if (conflicting) {
      setBackupNotice(`“${conflicting.name || conflicting.category || "Doimiy xarajat"}” oylik xarajatlarda faol. Ikki marta hisoblanmasligi uchun avval uni to‘xtating.`);
      return;
    }
    const saved = await onSave({ ...data, costRules: cleanRules }, "Komissiya va soliq qoidalari yangilandi");
    if (saved) setBackupNotice("✓ Avtomatik hisoblash qoidalari saqlandi.");
  };

  const createWorker = async () => {
    if (!workerForm.name.trim() || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(workerForm.username.trim().toLowerCase())) {
      setWorkerNotice("Ism va kamida 3 belgili lotincha login kiriting.");
      return;
    }
    if (!/^\d{4,8}$/.test(workerForm.pin)) {
      setWorkerNotice("PIN 4–8 ta raqam bo‘lishi kerak.");
      return;
    }
    setBusy("worker-create");
    try {
      const response = await fetch("/api/worker-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          branchId,
          name: workerForm.name,
          username: workerForm.username,
          pin: workerForm.pin,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Akkaunt saqlanmadi");
      setWorkerForm({ name: "", username: "", pin: "" });
      setWorkerNotice("✓ Xodim akkaunti yaratildi.");
      await refreshWorkerAccounts();
    } catch (error) {
      setWorkerNotice(error instanceof Error ? error.message : "Akkaunt saqlanmadi.");
    } finally {
      setBusy("");
    }
  };

  const toggleWorker = async (account: WorkerAccount) => {
    const linkedMember = data.staff.find((member) => member.workerId === account.id);
    if (
      account.active
      && linkedMember
      && data.workShifts.some((shift) => shift.staffId === linkedMember.id && shift.status === "open")
    ) {
      setWorkerNotice(`${linkedMember.name} hozir ishda. Akkauntni to‘xtatishdan oldin smenani tugating.`);
      return;
    }
    setBusy(account.id);
    try {
      const response = await fetch("/api/worker-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", workerId: account.id, active: !account.active }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Holat o‘zgarmadi.");
      setWorkerNotice(account.active
        ? `✓ ${account.name} akkaunti to‘xtatildi.`
        : `✓ ${account.name} akkaunti faollashtirildi.`);
      await refreshWorkerAccounts();
    } catch (error) {
      setWorkerNotice(error instanceof Error ? error.message : "Holat o‘zgarmadi.");
    } finally {
      setBusy("");
    }
  };

  const changeWorkerPin = async (account: WorkerAccount) => {
    const pin = window.prompt(`${account.name} uchun yangi 4–8 raqamli PIN kiriting:`);
    if (pin === null) return;
    if (!/^\d{4,8}$/.test(pin)) {
      setWorkerNotice("PIN 4–8 ta raqam bo‘lishi kerak.");
      return;
    }
    setBusy(`pin-${account.id}`);
    try {
      const response = await fetch("/api/worker-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-pin", workerId: account.id, pin }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "PIN o‘zgarmadi.");
      setWorkerNotice(`✓ ${account.name} PIN’i yangilandi va eski kirishlari yopildi.`);
      await refreshWorkerAccounts();
    } catch (error) {
      setWorkerNotice(error instanceof Error ? error.message : "PIN o‘zgarmadi.");
    } finally {
      setBusy("");
    }
  };

  const toggleWorkerWarehouseReceipt = async (account: WorkerAccount) => {
    setBusy(`warehouse-${account.id}`);
    try {
      const response = await fetch("/api/worker-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "warehouse-receipt",
          workerId: account.id,
          allowed: !account.canWarehouseReceipt,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Kengaytirilgan kirim ruxsati o‘zgarmadi.");
      setWorkerNotice(account.canWarehouseReceipt
        ? `✓ ${account.name} uchun xarajat, moy va MEZANA kiritish ruxsati olib tashlandi. Akkauntdan qayta kiradi.`
        : `✓ ${account.name} endi xarajat, moy va MEZANA yozuvlarini kirita oladi. Akkauntdan qayta kiradi.`);
      await refreshWorkerAccounts();
    } catch (error) {
      setWorkerNotice(error instanceof Error ? error.message : "Kengaytirilgan kirim ruxsati o‘zgarmadi.");
    } finally {
      setBusy("");
    }
  };

  const toggleWorkerSupplierDelivery = async (account: WorkerAccount) => {
    setBusy(`supplier-delivery-${account.id}`);
    try {
      const response = await fetch("/api/worker-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "supplier-delivery",
          workerId: account.id,
          allowed: !account.canSupplierDelivery,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Yetkazuvchi kirimi ruxsati o‘zgarmadi.");
      setWorkerNotice(account.canSupplierDelivery
        ? `✓ ${account.name} uchun “Yetkazuvchi kirimi” yopildi. Akkauntdan qayta kiradi.`
        : `✓ ${account.name} uchun “Yetkazuvchi kirimi” ochildi. Akkauntdan qayta kiradi.`);
      await refreshWorkerAccounts();
    } catch (error) {
      setWorkerNotice(error instanceof Error ? error.message : "Yetkazuvchi kirimi ruxsati o‘zgarmadi.");
    } finally {
      setBusy("");
    }
  };

  const prepareWorkerTelegram = async (account: WorkerAccount) => {
    setBusy(`telegram-${account.id}`);
    setWorkerNotice("");
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-telegram-link", branchId, workerId: account.id }),
      });
      const result = await response.json() as { error?: string; url?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Ulash havolasi olinmadi.");
      setWorkerTelegramLinks((current) => ({ ...current, [account.id]: result.url! }));
      setWorkerNotice(`✓ ${account.name} uchun shaxsiy havola tayyor. Uni faqat shu xodimga yuboring.`);
    } catch (error) {
      setWorkerNotice(error instanceof Error ? error.message : "Ulash havolasi olinmadi.");
    } finally {
      setBusy("");
    }
  };

  const shareWorkerTelegramLink = async (account: WorkerAccount) => {
    const url = workerTelegramLinks[account.id];
    if (!url) return;
    const text = `${account.name}, HALO xodim akkauntingizni Telegramga ulash uchun shu havolani ochib START tugmasini bosing:`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "HALO Telegram ulash", text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setWorkerNotice(`✓ ${account.name} uchun havola nusxalandi.`);
      }
    } catch {
      setWorkerNotice("Havola yuborilmadi. “Nusxalash” tugmasidan foydalaning.");
    }
  };

  const copyWorkerTelegramLink = async (account: WorkerAccount) => {
    const url = workerTelegramLinks[account.id];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setWorkerNotice(`✓ ${account.name} uchun havola nusxalandi.`);
    } catch {
      setWorkerNotice("Havolani nusxalab bo‘lmadi. Matn ustiga bosib qo‘lda nusxalang.");
    }
  };

  const checkWorkerTelegram = async (account: WorkerAccount) => {
    setBusy(`telegram-check-${account.id}`);
    setWorkerNotice("");
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-telegram-link", branchId, workerId: account.id }),
      });
      const result = await response.json() as { error?: string; chatName?: string };
      if (!response.ok) throw new Error(result.error || "Telegram hali ulanmagan.");
      setWorkerTelegramLinks((current) => {
        const next = { ...current };
        delete next[account.id];
        return next;
      });
      setWorkerNotice(`✓ ${account.name} Telegrami alohida ulandi${result.chatName ? ` · ${result.chatName}` : ""}.`);
      await refreshWorkerAccounts();
    } catch (error) {
      setWorkerNotice(error instanceof Error ? error.message : "Telegram hali ulanmagan.");
    } finally {
      setBusy("");
    }
  };

  const createAssignedTask = async () => {
    if (!taskForm.workerId || !taskForm.title.trim()) {
      setTaskNotice("Xodim va vazifa nomini kiriting.");
      return;
    }
    setBusy("task-create");
    setTaskNotice("");
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          branchId,
          branchName,
          ...taskForm,
        }),
      });
      const result = await response.json() as {
        error?: string;
        telegram?: { sent?: boolean; reason?: string };
      };
      if (!response.ok) throw new Error(result.error || "Vazifa yuborilmadi.");
      setTaskForm((current) => ({ ...current, title: "", description: "" }));
      setTaskNotice(result.telegram?.sent
        ? "✓ Vazifa xodim akkaunti va Telegramiga yuborildi."
        : `✓ Vazifa akkauntga yuborildi. Telegram: ${result.telegram?.reason || "yuborilmadi"}`);
      await refreshAssignedTasks();
    } catch (error) {
      setTaskNotice(error instanceof Error ? error.message : "Vazifa yuborilmadi.");
    } finally {
      setBusy("");
    }
  };

  const createBulkAssignedTask = async () => {
    const activeWorkerIds = new Set(workerAccounts.filter((account) => account.active).map((account) => account.id));
    const workerIds = bulkTaskForm.workerIds.filter((workerId) => activeWorkerIds.has(workerId));
    if (!workerIds.length || !bulkTaskForm.title.trim()) {
      setTaskNotice("Kamida bitta hodim va vazifa nomini kiriting.");
      return;
    }
    setBusy("task-create-bulk");
    setTaskNotice("");
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-bulk",
          branchId,
          branchName,
          ...bulkTaskForm,
          workerIds,
        }),
      });
      const result = await response.json() as {
        error?: string;
        created?: number;
        telegram?: { sent?: number; failed?: number };
      };
      if (!response.ok) throw new Error(result.error || "Vazifa hodimlarga yuborilmadi.");
      setBulkTaskForm((current) => ({ ...current, workerIds: [], title: "", description: "" }));
      const telegramText = result.telegram?.failed
        ? ` Telegram: ${result.telegram.sent || 0} ta yuborildi, ${result.telegram.failed} ta ulanmagan.`
        : ` Telegramga ham ${result.telegram?.sent || 0} ta yuborildi.`;
      setTaskNotice(`✓ Bitta vazifa ${result.created || workerIds.length} ta hodim akkauntiga yuborildi.${telegramText}`);
      await refreshAssignedTasks();
    } catch (error) {
      setTaskNotice(error instanceof Error ? error.message : "Vazifa hodimlarga yuborilmadi.");
    } finally {
      setBusy("");
    }
  };

  const toggleBulkTaskWorker = (workerId: string) => {
    setBulkTaskForm((current) => ({
      ...current,
      workerIds: current.workerIds.includes(workerId)
        ? current.workerIds.filter((entry) => entry !== workerId)
        : [...current.workerIds, workerId],
    }));
  };

  const toggleAllBulkTaskWorkers = () => {
    const activeIds = workerAccounts.filter((account) => account.active).map((account) => account.id);
    const allSelected = activeIds.length > 0 && activeIds.every((workerId) => bulkTaskForm.workerIds.includes(workerId));
    setBulkTaskForm((current) => ({ ...current, workerIds: allSelected ? [] : activeIds }));
  };

  const deleteStaff = async (member: StaffMember) => {
    if (data.workShifts.some((shift) => shift.staffId === member.id && shift.status === "open")) {
      setPayrollNotice(`${member.name} hozir ishda. Avval xodim “Ishni tugatish”ni bossin yoki smenani bekor qiling.`);
      return;
    }
    if (!window.confirm(`“${member.name}” xodim hisobidan arxivlansinmi?\n\nIsh soati va eski maosh tarixi o‘chmaydi.`)) return;
    const reason = askCancellationReason(`${member.name} xodim hisobi`);
    if (!reason) return;
    const cancelledAt = new Date().toISOString();
    setBusy(`payroll-archive-${member.id}`);
    try {
      const saved = await onSave(
        { ...data, staff: data.staff.map((entry) => entry.id === member.id ? { ...entry, active: false, workerId: "", cancellationReason: reason, cancelledAt, cancelledBy: "Rahbar" } : entry) },
        `Xodim maosh yozuvi arxivlandi · ${member.name} · Sabab: ${reason}`,
      );
      setPayrollNotice(saved
        ? `✓ ${member.name} arxivlandi. Eski ish soati va maosh tarixi saqlandi.`
        : "Xodimni arxivlab bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy("");
    }
  };

  const toggleStaffActive = async (member: StaffMember) => {
    if (member.active && data.workShifts.some((shift) => shift.staffId === member.id && shift.status === "open")) {
      setPayrollNotice(`${member.name} hozir ishda. Avval smenani tugating.`);
      return;
    }
    const reason = member.active ? askCancellationReason(`${member.name} xodim faoliyati`) : null;
    if (member.active && !reason) return;
    const cancelledAt = member.active ? new Date().toISOString() : undefined;
    setBusy(`payroll-toggle-${member.id}`);
    try {
      const saved = await onSave({
        ...data,
        staff: data.staff.map((entry) => entry.id === member.id ? {
          ...entry,
          active: !entry.active,
          ...(member.active ? { cancellationReason: reason || undefined, cancelledAt, cancelledBy: "Rahbar" } : {}),
        } : entry),
      }, `${member.name} holati o‘zgartirildi${reason ? ` · Sabab: ${reason}` : ""}`);
      setPayrollNotice(saved
        ? `✓ ${member.name} ${member.active ? "to‘xtatildi" : "faollashtirildi"}.`
        : "Xodim holatini o‘zgartirib bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy("");
    }
  };

  const resendAssignedTask = async (task: AssignedTask) => {
    setBusy(`task-send-${task.id}`);
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", taskId: task.id, branchId, branchName }),
      });
      const result = await response.json() as {
        error?: string;
        telegram?: { sent?: boolean; reason?: string };
      };
      if (!response.ok) throw new Error(result.error || "Telegramga yuborilmadi.");
      setTaskNotice(result.telegram?.sent
        ? `✓ ${task.workerName}ga Telegram qayta yuborildi.`
        : result.telegram?.reason || "Telegramga yuborilmadi.");
      await refreshAssignedTasks();
    } catch (error) {
      setTaskNotice(error instanceof Error ? error.message : "Telegramga yuborilmadi.");
    } finally {
      setBusy("");
    }
  };

  const cancelAssignedTask = async (task: AssignedTask) => {
    if (!window.confirm(`“${task.title}” vazifasi bekor qilinsinmi?`)) return;
    const reason = askCancellationReason(task.title);
    if (!reason) return;
    setBusy(`task-cancel-${task.id}`);
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", taskId: task.id, branchId, reason }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Vazifa bekor qilinmadi.");
      setTaskNotice("✓ Vazifa bekor qilindi.");
      await refreshAssignedTasks();
    } catch (error) {
      setTaskNotice(error instanceof Error ? error.message : "Vazifa bekor qilinmadi.");
    } finally {
      setBusy("");
    }
  };

  const clearAssignedTaskHistory = async () => {
    const removable = assignedTasks.filter((entry) => entry.status === "done").length;
    if (!removable) {
      setTaskNotice("Tozalash uchun bajarilgan eski xabar yo‘q. Bekor qilinganlar tarixda saqlanadi.");
      return;
    }
    if (!window.confirm(`${removable} ta bajarilgan eski xabar butunlay o‘chirilsinmi? Bekor qilingan vazifalar saqlanadi.`)) return;
    setBusy("task-clear-history");
    try {
      const response = await fetch("/api/worker-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-history", branchId }),
      });
      const result = await response.json() as { error?: string; removed?: number };
      if (!response.ok) throw new Error(result.error || "Eski xabarlar o‘chirilmadi.");
      setTaskNotice(`✓ ${result.removed || 0} ta bajarilgan eski xabar o‘chirildi. Bekor qilinganlar saqlandi.`);
      await refreshAssignedTasks();
    } catch (error) {
      setTaskNotice(error instanceof Error ? error.message : "Eski xabarlar o‘chirilmadi.");
    } finally {
      setBusy("");
    }
  };

  const activePurchaseOrders = data.purchaseOrders.filter((order) => order.status !== "cancelled");
  const activeAssignedTasks = assignedTasks.filter((entry) => entry.status !== "cancelled");
  const visibleStaff = data.staff.filter((member) => member.active || !member.cancelledAt);
  const payrollSummaries = visibleStaff.map((member) => ({
    member,
    summary: calculatePayroll(member, data.workShifts, data.payrollAdjustments, selectedPayrollMonth, {
      attendanceDays: data.attendanceDays,
      payments: data.payrollPayments,
    }),
  }));
  const monthlyPayroll = payrollSummaries.reduce((sum, entry) => sum + Math.max(0, entry.summary.remaining), 0);
  const monthlyCloses = normalizeMonthlyCloses(data.monthlyCloses);
  const selectedMonthlyClose = monthlyCloses.find((entry) => entry.month === selectedMonthEndMonth);
  const selectedMonthPayrollItems = visibleStaff.map((member) => ({
    member,
    summary: calculatePayroll(member, data.workShifts, data.payrollAdjustments, selectedMonthEndMonth, {
      attendanceDays: data.attendanceDays,
      payments: data.payrollPayments,
    }),
  }));
  const selectedMonthPayrollGross = selectedMonthPayrollItems.reduce((sum, entry) => sum + Math.round(entry.summary.grossPay), 0);
  const selectedMonthPayrollPaid = selectedMonthPayrollItems.reduce((sum, entry) => sum + Math.round(entry.summary.paymentAmount + entry.summary.advance), 0);
  const selectedMonthPayrollRemaining = selectedMonthPayrollItems.reduce((sum, entry) => sum + Math.round(entry.summary.remaining), 0);
  const liveInventoryValue = data.inventory.reduce((sum, item) => sum + Math.max(0, Number(item.stock || 0)) * Math.max(0, Number(item.unitCost || 0)), 0);
  const selectedMonthExpenses = selectActiveFinancialEntries(data.financialEntries).filter((entry) => (
    entry.type === "expense"
    && entry.affectsProfit !== false
    && entry.date.startsWith(`${selectedMonthEndMonth}-`)
    && !costRuleCoversCategory(entry.category, data.costRules)
    && !entry.cancelledAt
  ));
  const selectedMonthAccounting = useMemo(() => {
    const [year, monthNumber] = selectedMonthEndMonth.split("-").map(Number);
    const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return Array.from({ length: dayCount }, (_, index) => (
      calculateDailyReport(data, `${selectedMonthEndMonth}-${String(index + 1).padStart(2, "0")}`)
    )).reduce((totals, report) => ({
      totalExpenses: totals.totalExpenses + report.totalExpenses,
      netProfit: totals.netProfit + report.netProfit,
      otherIncome: totals.otherIncome + report.otherIncome,
      cardCommission: totals.cardCommission + report.cardCommission,
      deliveryCommission: totals.deliveryCommission + report.deliveryCommission,
      tax: totals.tax + report.tax,
      inventoryOutflowCost: totals.inventoryOutflowCost + report.inventoryOnlyCost,
    }), {
      totalExpenses: 0,
      netProfit: 0,
      otherIncome: 0,
      cardCommission: 0,
      deliveryCommission: 0,
      tax: 0,
      inventoryOutflowCost: 0,
    });
  }, [data, selectedMonthEndMonth]);
  const displayedMonthNetProfit = selectedMonthlyClose
    ? (selectedMonthlyClose.netProfit ?? ((selectedMonthlyClose.salesProfit || 0) - (selectedMonthlyClose.expenseTotal || 0)))
    : selectedMonthAccounting.netProfit;
  const closedExpenseBreakdown = selectedMonthlyClose ? {
    manual: selectedMonthlyClose.expenseTotal || 0,
    commission: (selectedMonthlyClose.cardCommission || 0) + (selectedMonthlyClose.deliveryCommission || 0),
    tax: selectedMonthlyClose.tax || 0,
    payroll: selectedMonthlyClose.payrollExpense ?? selectedMonthlyClose.payrollGross ?? 0,
    inventoryOutflow: selectedMonthlyClose.inventoryOutflowCost || 0,
  } : undefined;
  const closedExpenseComponentsTotal = closedExpenseBreakdown
    ? Object.values(closedExpenseBreakdown).reduce((sum, amount) => sum + amount, 0)
    : 0;
  const closedExpenseTotal = selectedMonthlyClose
    ? (selectedMonthlyClose.operatingExpenseTotal ?? closedExpenseComponentsTotal)
    : 0;
  const closedExpenseReconciliation = closedExpenseTotal - closedExpenseComponentsTotal;
  const selectedMonthSales = data.sales.filter((entry) => (
    entry.date.startsWith(`${selectedMonthEndMonth}-`)
    && entry.status !== "cancelled"
    && !entry.cancelledAt
    && entry.voided !== true
  ));
  const selectedMonthSalesRevenue = selectedMonthSales.reduce((sum, entry) => sum + Math.max(0, Math.round(Number(entry.totalRevenue || 0))), 0);
  const selectedMonthSalesCost = selectedMonthSales.reduce((sum, entry) => sum + Math.max(0, Math.round(Number(entry.totalCost || 0))), 0);
  const resetInventoryItems = data.inventory.filter(() => false);
  const retainedInventoryItems = data.inventory.filter((item) => !monthEndResetStock[item.id]);
  const currentCalendarDate = payrollToday();
  const currentCalendarMonth = currentCalendarDate.slice(0, 7);
  const currentMonthLastDay = new Date(Date.UTC(
    Number(currentCalendarDate.slice(0, 4)),
    Number(currentCalendarDate.slice(5, 7)),
    0,
  )).getUTCDate();
  const selectedMonthFinished = selectedMonthEndMonth < currentCalendarMonth
    || (selectedMonthEndMonth === currentCalendarMonth && Number(currentCalendarDate.slice(8, 10)) === currentMonthLastDay);
  const todayReport = calculateDailyReport({ ...data, costRules: rules }, today());
  const dailyPayroll = todayReport.payroll;
  const automaticToday = todayReport.automaticExpenses;
  const auditActors = [...new Set(data.auditLog.map((entry) => entry.actor))].filter(Boolean);
  const filteredAudit = data.auditLog.filter((entry) => !auditActor || entry.actor === auditActor);
  const currentAuditPage = Math.min(auditPage, Math.max(0, Math.ceil(filteredAudit.length / 50) - 1));
  const visibleAudit = filteredAudit.slice(currentAuditPage * 50, (currentAuditPage + 1) * 50);
  const inventoryCategories = categoriesForKind(data.productCategories, "inventory");
  const inventoryCategoryName = (categoryId: string) => (
    inventoryCategories.find((category) => category.id === categoryId)?.name || "Boshqa xomashyo"
  );

  const closeSelectedMonth = async () => {
    if (selectedMonthlyClose) {
      setMonthEndNotice(`✓ ${selectedMonthEndMonth} allaqachon yakunlangan. Tarix o‘zgarmaydi.`);
      return;
    }
    if (!selectedMonthFinished) {
      setMonthEndNotice("Joriy oy hali tugamagan. Oyni faqat oxirgi kuni yoki keyingi oyda yakunlash mumkin.");
      return;
    }
    const confirmed = window.confirm(
      `${selectedMonthEndMonth} oyini yakunlaysizmi?\n\n`
      + `• Oy savdosi yopiladi: ${won(selectedMonthSalesRevenue)}\n`
      + `• Barcha oy xarajatlari yopiladi: ${won(selectedMonthAccounting.totalExpenses)}\n`
      + `• Hisobiy foyda saqlanadi: ${won(selectedMonthAccounting.netProfit)}\n`
      + `• Xodimlar hisoblangan oyligi saqlanadi: ${won(selectedMonthPayrollGross)}\n`
      + `• Barcha ombor qoldiqlari keyingi oyga o‘tadi\n`
      + `• Belgilanmagan ${retainedInventoryItems.length} ta mahsulot qoldig‘i saqlanadi\n`
      + `• Yangi oy savdo, xarajat va xodim hisobi 0 dan boshlanadi\n\n`
      + "Yopilgan oy tarixini keyin o‘zgartirib yoki o‘chirib bo‘lmaydi.",
    );
    if (!confirmed) return;
    setBusy("month-end");
    setMonthEndNotice("");
    try {
      const openingInventory = Object.fromEntries(data.inventory.map((item) => [item.id, item.stock]));
      const result = closeBusinessMonth(
        data,
        selectedMonthEndMonth,
        "Rahbar",
        new Date().toISOString(),
        openingInventory,
        resetInventoryItems.map((item) => item.id),
      );
      if (result.alreadyClosed) {
        setMonthEndNotice(`✓ ${selectedMonthEndMonth} allaqachon yakunlangan.`);
        return;
      }
      const saved = await onSave(
        result.state,
        `Oy yakunlandi · ${selectedMonthEndMonth} · ombor sanaldi · xarajat va maosh tarixi yopildi`,
      );
      if (!saved) throw new Error("Oy yakuni saqlanmadi. Ma’lumotni yangilab qayta urinib ko‘ring.");
      const nextMonth = nextAccountingMonth(selectedMonthEndMonth);
      setActualStock({});
      setMonthEndResetStock({});
      setSelectedPayrollMonth(nextMonth);
      setSelectedMonthEndMonth(nextMonth);
      setMonthEndNotice(`✓ ${result.record.month} yopildi. Ombor qoldiqlari keyingi oyga o‘tdi. Yangi oy savdo va xarajat hisobi alohida boshlanadi.`);
    } catch (error) {
      setMonthEndNotice(error instanceof Error ? error.message : "Oy yakunini saqlab bo‘lmadi.");
    } finally {
      setBusy("");
    }
  };

  const exportExcel = async () => {
    setBusy("excel");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const payrollReport = buildPayrollReport({
        staff: data.staff,
        workShifts: data.workShifts,
        payrollAdjustments: data.payrollAdjustments,
        attendanceDays: data.attendanceDays,
        payrollPayments: data.payrollPayments,
        accounts: data.accounts,
        month: selectedPayrollMonth,
      });
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.inventory.map((item) => ({
        Mahsulot: item.name,
        Kategoriya: inventoryCategoryName(item.categoryId),
        Qoldiq: item.stock,
        Birlik: item.unit,
        Qadoq: item.packageName,
        Qadoq_ichidagi_miqdor: item.unitsPerPackage,
        Qadoq_narxi: item.packageCost,
        Bir_dona_gramm: item.gramsPerUnit || "",
        Minimum: item.minStock,
        Tannarx: item.unitCost,
        Qiymat: item.stock * item.unitCost,
      }))), "Ombor");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.sales.map((sale) => {
        const account = data.accounts.find((entry) => entry.id === sale.accountId);
        const inventoryOnly = account?.type === "cash" || account?.type === "bank";
        return {
          Sana: sale.date,
          Turi: inventoryOnly ? "Faqat ombor nazorati" : "POS / moliyaviy savdo",
          Hisob: account?.name || sale.accountId || "Karta / POS",
          Menyu_qiymati: sale.totalRevenue,
          Moliyaviy_savdo: inventoryOnly ? 0 : sale.totalRevenue,
          Tannarx: inventoryOnly ? 0 : wholeWon(sale.totalCost),
          Foyda: inventoryOnly ? 0 : sale.totalRevenue - wholeWon(sale.totalCost),
        };
      })), "Savdo");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(selectActiveFinancialEntries(data.financialEntries).map((entry) => ({
        Sana: entry.date,
        Turi: entry.type,
        Kategoriya: entry.category,
        Summa: entry.amount,
        Hisob: data.accounts.find((account) => account.id === entry.accountId)?.name || entry.accountId,
        Manba: entry.fixedExpenseId ? "Avtomatik oylik" : entry.payrollPaymentId ? "Maosh / avans" : "Qo‘lda yoki xodim",
        Doimiy_xarajat_id: entry.fixedExpenseId || "",
        Hisob_davri: entry.fixedExpenseDueDate || "",
        Sof_foydaga_tasiri: entry.affectsProfit ? "Ha" : "Yo‘q",
        Izoh: entry.note,
      }))), "Xarajatlar");
      const fixedExpenses = Array.isArray(data.fixedExpenses) ? data.fixedExpenses as Array<{
        name?: string; category?: string; amount?: number; accountId?: string; frequency?: string;
        nextDue?: string; active?: boolean; automatic?: boolean; lastPaidDate?: string;
      }> : [];
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(fixedExpenses.map((entry) => ({
        Nomi: entry.name || "",
        Kategoriya: entry.category || "",
        Summa: Number(entry.amount || 0),
        Hisob: data.accounts.find((account) => account.id === entry.accountId)?.name || entry.accountId || "",
        Takrorlanishi: entry.frequency === "monthly" ? "Har oy" : entry.frequency === "weekly" ? "Har hafta" : "Har kuni",
        Avtomatik: entry.automatic ? "Ha" : "Yo‘q",
        Keyingi_hisob: entry.nextDue || "",
        Oxirgi_hisob: entry.lastPaidDate || "",
        Holat: entry.active ? "Faol" : "To‘xtatilgan",
      }))), "Doimiy_xarajatlar");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.suppliers.map((supplier) => ({
        Yetkazuvchi: supplier.name,
        Bank_hisob_raqami: supplier.bankAccount || "",
        Qarz: supplier.balance,
      }))), "Qarzlar");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payrollReport.summaryRows), "Xodimlar");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payrollReport.dailyPayRows), "Kunlik_ish_haqi");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payrollReport.shiftRows), "Ish_vaqti");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payrollReport.dayRows), "Kun_holati");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payrollReport.adjustmentRows), "Bonus_ushlanma");
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payrollReport.paymentRows), "Oylik_tolovlari");
      XLSX.writeFile(workbook, `HALO-${safeFilePart(branchName)}-hisobot-${selectedPayrollMonth}.xlsx`);
      setBackupNotice(`✓ Excel hisobot yuklandi. Xodimlar: ${selectedPayrollMonth}.`);
    } catch {
      setBackupNotice("Excel hisobotini yuklab bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy("");
    }
  };

  const loadApiExport = async () => {
    const response = await fetch(`/api/backups?branch=${encodeURIComponent(branchId)}&download=current`, { cache: "no-store" });
    const payload = await response.json() as ApiExportPayload;
    if (!response.ok) throw new Error(payload.error || "API ma’lumotlari yuklanmadi.");
    return payload;
  };

  const downloadApiJson = async () => {
    setBusy("api-json");
    setDataExportNotice("");
    try {
      const payload = await loadApiExport();
      downloadBrowserFile(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }),
        `HALO-${safeFilePart(branchName)}-API-${today()}.json`,
      );
      setDataExportNotice(`✓ API ma’lumotlari yuklandi: ${payload.sections.length} ta bo‘lim.`);
    } catch (error) {
      setDataExportNotice(error instanceof Error ? error.message : "API ma’lumotlari yuklanmadi.");
    } finally {
      setBusy("");
    }
  };

  const downloadZipBackup = async () => {
    setBusy("api-zip");
    setDataExportNotice("");
    try {
      const payload = await loadApiExport();
      const sectionFiles = Object.entries(payload.state)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value], index) => ({
          name: `malumotlar/${String(index + 1).padStart(2, "0")}-${safeFilePart(key, "bolim")}.json`,
          content: JSON.stringify(value, null, 2),
        }));
      const stockMovements = Array.isArray(payload.state.stockMovements)
        ? payload.state.stockMovements as StockMovement[]
        : [];
      const documentFiles: Array<{ name: string; content: Uint8Array }> = [];
      for (const movement of stockMovements) {
        if (!movement.document?.key) continue;
        const response = await fetch(`/api/stock-documents?key=${encodeURIComponent(movement.document.key)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Nakladnoy zaxiraga olinmadi: ${movement.document.fileName}`);
        const extension = movement.document.contentType === "image/png" ? "png" : movement.document.contentType === "image/webp" ? "webp" : "jpg";
        const baseName = movement.document.fileName.replace(/\.[^.]+$/, "");
        documentFiles.push({
          name: `nakladnoy/${safeFilePart(`${movement.date}-${movement.id}-${baseName}`, "nakladnoy")}.${extension}`,
          content: new Uint8Array(await response.arrayBuffer()),
        });
      }
      const manifest = {
        product: payload.product,
        apiVersion: payload.apiVersion,
        exportedAt: payload.exportedAt,
        branchId: payload.branchId,
        branchName,
        updatedAt: payload.updatedAt,
        totalSections: sectionFiles.length,
        totalDocuments: documentFiles.length,
        sections: Object.fromEntries(Object.entries(payload.state).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 1,
        ])),
      };
      const readme = [
        "HALO CONTROL — API VA ZIP ZAXIRA",
        "",
        `Filial: ${branchName} (${branchId})`,
        `Yuklangan vaqt: ${payload.exportedAt}`,
        "",
        "HALO-CONTROL-API.json — barcha ma’lumot bitta API faylida.",
        "manifest.json — bo‘limlar va yozuvlar soni.",
        "malumotlar/ — har bir bo‘lim alohida JSON faylida.",
        "nakladnoy/ — mahsulot kirimiga biriktirilgan barcha rasmlar.",
        "",
        "Bu fayllarni xavfsiz joyda saqlang. Ularda biznes ma’lumotlari bo‘lishi mumkin.",
      ].join("\r\n");
      const archive = createZipArchive([
        { name: "README.txt", content: readme },
        { name: "manifest.json", content: JSON.stringify(manifest, null, 2) },
        { name: "HALO-CONTROL-API.json", content: JSON.stringify(payload, null, 2) },
        ...sectionFiles,
        ...documentFiles,
      ]);
      const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
      downloadBrowserFile(
        new Blob([archiveBuffer], { type: "application/zip" }),
        `HALO-${safeFilePart(branchName)}-TO-LIQ-ZAXIRA-${today()}.zip`,
      );
      setDataExportNotice(`✓ ZIP zaxira yuklandi: ${sectionFiles.length} ta bo‘lim · ${documentFiles.length} ta nakladnoy.`);
    } catch (error) {
      setDataExportNotice(error instanceof Error ? error.message : "ZIP zaxira yuklanmadi.");
    } finally {
      setBusy("");
    }
  };

  const restoreBackup = async (backup: Backup) => {
    if (!window.confirm(`${new Date(backup.createdAt).toLocaleString("uz-UZ")} holatiga qaytarilsinmi? Hozirgi holat ham backup qilinadi.`)) return;
    setBusy(backup.id);
    try {
      const response = await fetch("/api/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, backupId: backup.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Qaytarib bo‘lmadi");
      window.location.reload();
    } catch (error) {
      setBackupNotice(error instanceof Error ? error.message : "Qaytarib bo‘lmadi.");
    } finally {
      setBusy("");
    }
  };

  const archivedName = (kind: DeletedItem["kind"], entityId: string) => String(
    data.deletedItems?.find((item) => item.kind === kind && item.entityId === entityId && !item.restoredAt)?.record.name
    || data.deletedItems?.find((item) => item.kind === kind && item.entityId === entityId)?.record.name
    || "",
  );
  const inventoryName = (inventoryId: string) => data.inventory.find((item) => item.id === inventoryId)?.name || archivedName("inventory", inventoryId) || "Mahsulot";
  const supplierName = (supplierId: string) => data.suppliers.find((supplier) => supplier.id === supplierId)?.name || archivedName("supplier", supplierId) || "Yetkazuvchi";
  const statusLabel = (status: PurchaseOrder["status"]) => ({
    ordered: "BUYURTMA BERILDI",
    received: "QABUL QILINDI",
    paid: "TO‘LANDI",
    cancelled: "BEKOR QILINDI",
  }[status]);

  return (
    <div className="page control-center">
      <section className="control-hero">
        <div><span>HALO NAZORAT MARKAZI</span><h2>{branchName}</h2><p>Ombor, xarid, ish haqi, komissiya, tarix va backup — bitta oynada.</p></div>
        <div><small>Bugungi avtomatik xarajat</small><strong>{won(automaticToday)}</strong><em>maosh + soliq + komissiya</em></div>
      </section>

      <nav className="management-shortcuts" aria-label="Boshqaruv bo‘limlari"><a href="#payroll-control"><strong>Ish vaqti va maosh</strong><small>Smena, bonus va to‘lov</small></a><a href="#worker-access"><strong>Xodimlar ruxsati</strong><small>Login va ochilgan bo‘limlar</small></a><a href="#worker-tasks"><strong>Vazifalar</strong><small>Topshiriq va bajarilish</small></a><a href="#oy-yakuni"><strong>Oy yakuni</strong><small>Yopilgan hisobotlar</small></a><a href="#management-audit"><strong>O‘zgarishlar tarixi</strong><small>Kim, qachon, nima o‘zgartirdi</small></a></nav>
      <section className="control-card month-end-card" id="oy-yakuni">
        <div className="control-head month-end-head">
          <div><span>OY YAKUNI · SAVDO + OMBOR + XARAJAT + OYLIK</span><h3>Oyni bir bosishda yopish va yangi hisobni ochish</h3></div>
          <label><span>Oy va yil</span><input type="month" value={selectedMonthEndMonth} max={currentCalendarMonth} onChange={(event) => { setSelectedMonthEndMonth(event.target.value || currentCalendarMonth); setMonthEndNotice(""); }} /></label>
          <b className={selectedMonthlyClose ? "closed" : "open"}>{selectedMonthlyClose ? "✓ YAKUNLANGAN" : "YOPILMAGAN"}</b>
        </div>
        <p className="month-end-explanation">Ombor qoldiqlari nol qilinmaydi va keyingi oyga o‘tadi. Oy yopilganda savdo, tannarx, barcha xarajat, hisobiy foyda, ombor va xodim hisobi muzlatilib tarixda qoladi; yangi oy hisobi alohida boshlanadi.</p>
        <div className="month-end-metrics">
          <article><span>Oy savdosi</span><strong className="positive">{won(selectedMonthlyClose ? (selectedMonthlyClose.salesRevenue || 0) : selectedMonthSalesRevenue)}</strong><small>{selectedMonthlyClose ? selectedMonthlyClose.salesCount === undefined ? "Eski yakunda savdo arxivi yo‘q" : `${selectedMonthlyClose.salesCount} ta yopilgan savdo` : `${selectedMonthSales.length} ta · tannarx ${won(selectedMonthSalesCost)}`}</small></article>
          <article><span>Ombor qiymati</span><strong>{won(selectedMonthlyClose?.inventoryValue ?? liveInventoryValue)}</strong><small>{selectedMonthlyClose ? `${selectedMonthlyClose.inventoryItems.length} ta tarixiy mahsulot` : `${data.inventory.length} ta qoldiq saqlanadi`}</small></article>
          <article><span>Oy xarajatlari</span><strong className="negative">{won(selectedMonthlyClose ? (selectedMonthlyClose.operatingExpenseTotal ?? selectedMonthlyClose.expenseTotal ?? 0) : selectedMonthAccounting.totalExpenses)}</strong><small>{selectedMonthlyClose ? selectedMonthlyClose.operatingExpenseTotal === undefined ? `${selectedMonthlyClose.expenseItems?.length || 0} ta eski xarajat yozuvi` : "Komissiya, soliq, oylik va chiqit bilan" : `${selectedMonthExpenses.length} ta yozuv + avtomatik hisob`}</small></article>
          <article><span>Hisobiy foyda</span><strong className={displayedMonthNetProfit >= 0 ? "positive" : "negative"}>{won(displayedMonthNetProfit)}</strong><small>{selectedMonthlyClose ? selectedMonthlyClose.netProfit === undefined ? "Eski yakun bo‘yicha taxmin" : "Yopilgan oyda saqlangan hisobiy natija" : "Tushum − kiritilgan tannarx va xarajat − reja zaxirasi"}</small></article>
          <article><span>Hisoblangan oylik</span><strong>{won(selectedMonthlyClose?.payrollGross ?? selectedMonthPayrollGross)}</strong><small>{selectedMonthlyClose ? `${selectedMonthlyClose.payrollItems.length} ta xodim` : `${selectedMonthPayrollItems.length} ta xodim · ${selectedMonthEndMonth}`}</small></article>
          <article><span>To‘langan</span><strong className="positive">{won(selectedMonthlyClose?.payrollPaid ?? selectedMonthPayrollPaid)}</strong><small>Avans va oylik to‘lovlari</small></article>
          <article><span>Qolgan oylik</span><strong className={(selectedMonthlyClose?.payrollRemaining ?? selectedMonthPayrollRemaining) > 0 ? "negative" : "positive"}>{won(selectedMonthlyClose?.payrollRemaining ?? selectedMonthPayrollRemaining)}</strong><small>Oy yopilganidagi qoldiq</small></article>
        </div>
        {selectedMonthlyClose ? <div className="month-end-history">
          <div className="month-end-closed-note"><span><b>{selectedMonthlyClose.month} tarixi saqlangan</b><small>{new Date(selectedMonthlyClose.closedAt).toLocaleString("uz-UZ", { timeZone: "Asia/Seoul" })} · {selectedMonthlyClose.closedBy}</small></span><strong>O‘ZGARMAYDI</strong></div>
          {selectedMonthlyClose.salesCount !== undefined && <details><summary>Savdo yakuni — {selectedMonthlyClose.salesCount} ta · {won(selectedMonthlyClose.salesRevenue || 0)}</summary><div className="month-end-sales-summary"><article><span>Savdo</span><strong>{won(selectedMonthlyClose.salesRevenue || 0)}</strong></article><article><span>Tannarx</span><strong>{won(selectedMonthlyClose.salesCost || 0)}</strong></article><article><span>Yalpi foyda</span><strong className="positive">{won(selectedMonthlyClose.salesProfit || 0)}</strong></article></div></details>}
          <details><summary>Ombor yakuni — {selectedMonthlyClose.inventoryItems.length} ta mahsulot</summary><div className="month-end-table"><div className="month-end-row inventory head"><span>Mahsulot</span><span>Oy yopilganda</span><span>Yangi oy</span><span>Holat</span><span>Qiymat</span></div>{selectedMonthlyClose.inventoryItems.map((item) => <div className="month-end-row inventory" key={item.inventoryId}><strong>{item.name}</strong><span>{(item.closingStock ?? item.stock).toLocaleString()} {item.unit}</span><span>{(item.openingStock ?? item.stock).toLocaleString()} {item.unit}</span><span className={item.resetForRecount ? "negative" : "positive"}>{item.resetForRecount ? "0 · QAYTA SANASH" : "SAQLANDI"}</span><strong>{won(item.value)}</strong></div>)}</div></details>
          <details><summary>Xarajatlar yakuni — {won(closedExpenseTotal)}</summary><div className="month-end-sales-summary"><article><span>Qo‘lda / davriy</span><strong>{won(closedExpenseBreakdown?.manual || 0)}</strong></article><article><span>Komissiya</span><strong>{won(closedExpenseBreakdown?.commission || 0)}</strong></article><article><span>Soliq</span><strong>{won(closedExpenseBreakdown?.tax || 0)}</strong></article><article><span>Oylik</span><strong>{won(closedExpenseBreakdown?.payroll || 0)}</strong></article><article><span>Yeyilgan / chiqit</span><strong>{won(closedExpenseBreakdown?.inventoryOutflow || 0)}</strong></article>{closedExpenseReconciliation !== 0 && <article><span>Arxiv hisob farqi</span><strong className={closedExpenseReconciliation > 0 ? "negative" : "positive"}>{won(closedExpenseReconciliation)}</strong></article>}<article><span>Jami xarajat</span><strong className="negative">{won(closedExpenseTotal)}</strong></article></div>{Boolean(selectedMonthlyClose.otherIncome) && <p className="control-notice">Boshqa kirim: <strong className="positive">{won(selectedMonthlyClose.otherIncome || 0)}</strong> · xarajatga kirmaydi, hisobiy foydaga qo‘shiladi.</p>}<div className="month-end-table"><div className="month-end-row expense head"><span>Sana</span><span>Kategoriya</span><span>Izoh</span><span>Summa</span></div>{selectedMonthlyClose.expenseItems?.length ? selectedMonthlyClose.expenseItems.map((item) => <div className="month-end-row expense" key={item.id}><span>{item.date}</span><strong>{item.category}</strong><span>{item.note || "—"}</span><strong className="negative">{won(item.amount)}</strong></div>) : <p className="control-empty">Bu yopilgan oyda qo‘lda kiritilgan xarajat yozuvi yo‘q.</p>}</div></details>
          <details><summary>Xodimlar oyligi — {selectedMonthlyClose.payrollItems.length} ta xodim</summary><div className="month-end-table payroll"><div className="month-end-row head"><span>Xodim</span><span>Ish kuni / soat</span><span>Hisoblangan</span><span>To‘langan / qolgan</span></div>{selectedMonthlyClose.payrollItems.map((item) => <div className="month-end-row" key={item.staffId}><strong>{item.name}</strong><span>{item.workedDays} kun · {formatMinutes(item.workedMinutes)}</span><span>{won(item.grossPay)}</span><strong>{won(item.paidAmount)} / {won(item.remaining)}</strong></div>)}</div></details>
        </div> : <div className="month-end-open-flow">
          <p className="month-end-count-head">Barcha ombor qoldiqlari saqlanadi. Haqiqiy miqdorni o‘zgartirish uchun Ombor → Sanoq oynasidan foydalaning.</p>
          <div className="month-end-ready"><span><b>2. Oyni bir bosishda yoping</b><small>{resetInventoryItems.length} ta ombor mahsuloti 0 qilinadi · {selectedMonthSales.length} ta savdo · {selectedMonthExpenses.length} ta xarajat · {selectedMonthPayrollItems.length} ta xodim</small></span><strong className="positive">✓ TAYYOR</strong></div>
          <button className="month-end-close-button" type="button" disabled={Boolean(busy) || !selectedMonthFinished} onClick={() => void closeSelectedMonth()}>{busy === "month-end" ? "Oy yakunlanmoqda…" : !selectedMonthFinished ? "Oy tugagach yakunlash mumkin" : `${selectedMonthEndMonth} oyini yopish va yangi hisobni ochish`}</button>
        </div>}
        {monthEndNotice && <p className={`control-notice${monthEndNotice.startsWith("✓") ? "" : " warning"}`} role={monthEndNotice.startsWith("✓") ? "status" : "alert"}>{monthEndNotice}</p>}
        {!!monthlyCloses.length && <div className="month-end-shortcuts"><span>Oldingi yakunlar:</span>{monthlyCloses.slice(0, 12).map((entry) => <button type="button" className={entry.month === selectedMonthEndMonth ? "active" : ""} key={entry.id} onClick={() => { setSelectedMonthEndMonth(entry.month); setMonthEndNotice(""); }}>{entry.month}</button>)}</div>}
      </section>

      <section className="control-grid">
        <InventoryAccountingPanel key={branchId} branchId={branchId} onSaved={onInventorySaved} onBefore={onBeforeInventory} />

        <article className="control-card order-create-card">
          <div className="control-head"><div><span>2 · XARID</span><h3>Yangi buyurtma</h3></div></div>
          <div className="control-form">
            <label><span>Yetkazib beruvchi</span><select value={orderForm.supplierId} onChange={(event) => setOrderForm({ ...orderForm, supplierId: event.target.value })}><option value="">Tanlang</option>{data.suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
            <label><span>Mahsulot</span><select value={orderForm.inventoryId} onChange={(event) => { const item = data.inventory.find((entry) => entry.id === event.target.value); setOrderForm({ ...orderForm, inventoryId: event.target.value, unitCost: item?.unitCost || 0 }); }}><option value="">Tanlang</option>{inventoryCategories.map((category) => <optgroup label={category.name} key={category.id}>{data.inventory.filter((item) => item.categoryId === category.id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</optgroup>)}</select></label>
            <label><span>Miqdor</span><input type="number" min="0" step="any" value={orderForm.quantity || ""} onChange={(event) => setOrderForm({ ...orderForm, quantity: Number(event.target.value) })} /></label>
            <label><span>Birlik tannarxi</span><input type="number" min="0" value={orderForm.unitCost || ""} onChange={(event) => setOrderForm({ ...orderForm, unitCost: Number(event.target.value) })} /></label>
            <label><span>Sana</span><input type="date" value={orderForm.date} onChange={(event) => setOrderForm({ ...orderForm, date: event.target.value })} /></label>
          </div>
          <div className="order-total"><span>Buyurtma summasi</span><strong>{won(orderForm.quantity * orderForm.unitCost)}</strong></div>
          {orderNotice && <p className="control-notice">{orderNotice}</p>}
          <button className="control-primary" onClick={() => void createOrder()}>Buyurtma yaratish</button>
        </article>
      </section>

      <section className="control-card">
        <div className="control-head"><div><span>BUYURTMA → QABUL → QARZ → TO‘LOV</span><h3>Xaridlar nazorati</h3></div><b>{activePurchaseOrders.filter((order) => order.status !== "paid").length} ta ochiq</b></div>
        <div className="order-list">
          {activePurchaseOrders.length ? activePurchaseOrders.map((order) => <div key={order.id} className={`order-row ${order.status}`}>
            <span><small>{order.date} · {supplierName(order.supplierId)}</small><strong>{order.items.map((item) => `${inventoryName(item.inventoryId)} × ${item.quantity.toLocaleString()}`).join(", ")}</strong></span>
            <b>{won(order.total)}</b><em>{statusLabel(order.status)}</em>
            <div>
              {order.status === "ordered" && <><button onClick={() => void receiveOrder(order)}>Qabul qilindi</button></>}
              <button type="button" className="danger" onClick={()=>onRemoveRecord("purchaseOrder",order.id,`Xarid buyurtmasi · ${won(order.total)}`)}>Olib tashlash</button>
              {order.status === "received" && <select defaultValue="" onChange={(event) => { if (event.target.value) void payOrder(order, event.target.value); }}><option value="">To‘lov hisobini tanlang</option>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select>}
            </div>
          </div>) : <p className="control-empty">Xarid buyurtmalari hali yo‘q.</p>}
        </div>
      </section>

      <section className="control-grid">
        <article className="control-card payroll-control-card" id="payroll-control">
          <div className="control-head payroll-head"><div><span>3 · ISH VAQTI + MAOSH</span><h3>Xodimlar nazorati</h3></div><label><span>Hisobot oyi</span><input type="month" value={selectedPayrollMonth} onChange={(event) => setSelectedPayrollMonth(event.target.value)} /></label><b>{won(monthlyPayroll)} to‘lanadi</b></div>

          <div className="payroll-setup">
            <div className="payroll-block-title"><span>1</span><div><b>{editingStaffId ? "Xodimni tahrirlash" : "Xodim va maosh rejasini qo‘shish"}</b><small>Oylik yoki soatbay hisob turini tanlang.</small></div></div>
            <div className="staff-add payroll-staff-form">
              <label><span>Xodim ismi</span><input maxLength={60} value={staffForm.name} onChange={(event) => setStaffForm({ ...staffForm, name: event.target.value })} placeholder="Masalan: Ali" /></label>
              <label><span>Hisob turi</span><select value={staffForm.payType} onChange={(event) => setStaffForm({ ...staffForm, payType: event.target.value as StaffMember["payType"] })}><option value="monthly">Oylik — ishlagan soatga mutanosib</option><option value="hourly">Soatbay</option></select></label>
              {staffForm.payType === "monthly"
                ? <label><span>Oylik maosh</span><input type="number" min="0" inputMode="numeric" value={staffForm.monthlySalary || ""} onChange={(event) => setStaffForm({ ...staffForm, monthlySalary: Number(event.target.value) })} placeholder="₩" /></label>
                : <label><span>1 soat narxi</span><input type="number" min="0" inputMode="numeric" value={staffForm.hourlyRate || ""} onChange={(event) => setStaffForm({ ...staffForm, hourlyRate: Number(event.target.value) })} placeholder="₩" /></label>}
              <label><span>Reja ish kuni</span><input type="number" min="1" max="31" value={staffForm.workDays || ""} onChange={(event) => setStaffForm({ ...staffForm, workDays: Number(event.target.value) })} /></label>
              <label><span>Kunlik reja soati</span><input type="number" min="0.5" max="18" step="0.5" value={staffForm.dailyHours || ""} onChange={(event) => setStaffForm({ ...staffForm, dailyHours: Number(event.target.value) })} /></label>
              <label><span>Hisob boshlanadigan vaqt</span><input type="time" value={staffForm.scheduledStartTime} onChange={(event) => setStaffForm({ ...staffForm, scheduledStartTime: event.target.value })} /><small>Oldin kelsa, ortiqcha vaqt hisoblanmaydi.</small></label>
              <label><span>Hisob tugaydigan vaqt</span><input type="time" value={staffForm.scheduledEndTime} onChange={(event) => setStaffForm({ ...staffForm, scheduledEndTime: event.target.value })} /><small>Kech ketsa, ortiqcha vaqt hisoblanmaydi.</small></label>
              <p className="payroll-schedule-help wide">Ikkala vaqtni kiriting. Masalan, 10:00–22:00 bo‘lsa, 09:30 kelish va 22:40 ketish tarixda ko‘rinadi, lekin maoshga faqat 10:00–22:00 olinadi.</p>
              <label><span>Xodim loginiga bog‘lash</span><select value={staffForm.workerId} onChange={(event) => setStaffForm({ ...staffForm, workerId: event.target.value })}><option value="">Faqat rahbar kiritadi</option>{workerAccounts.filter((account) => account.active && (!data.staff.some((member) => member.id !== editingStaffId && member.workerId === account.id))).map((account) => <option value={account.id} key={account.id}>{account.name} · @{account.username}</option>)}</select></label>
              <details className="payroll-overtime-settings wide">
                <summary>Qo‘shimcha ish sozlamasi</summary>
                <div>
                  <label><span>Qo‘shimcha ish qachondan?</span><input type="number" min="0.5" max="18" step="0.5" value={staffForm.overtimeAfterHours || ""} onChange={(event) => setStaffForm({ ...staffForm, overtimeAfterHours: Number(event.target.value) })} /><small>soatdan keyin</small></label>
                  <label><span>Qo‘shimcha ish koeffitsiyenti</span><input type="number" min="1" max="5" step="0.1" value={staffForm.overtimeMultiplier || ""} onChange={(event) => setStaffForm({ ...staffForm, overtimeMultiplier: Number(event.target.value) })} /><small>Masalan: 1.5 — qo‘shimcha soat 1.5 baravar.</small></label>
                </div>
              </details>
              <button disabled={Boolean(busy)} onClick={() => void saveStaff()}>{busy === "payroll-staff" ? "Saqlanmoqda…" : editingStaffId ? "O‘zgarishni saqlash" : "＋ Xodim qo‘shish"}</button>
              {editingStaffId && <button className="payroll-cancel" disabled={Boolean(busy)} type="button" onClick={resetStaffForm}>Bekor qilish</button>}
            </div>
            {!workerAccounts.length && <p className="payroll-login-help">Xodim o‘z telefonidan kelish-ketishni bosishi uchun avval pastdagi <a href="#worker-access">“Xodim akkauntlari”</a> bo‘limida login yarating. Hozir ham ish vaqtini rahbar qo‘lda kiritishi mumkin.</p>}
          </div>

          {payrollNotice && <p className={`control-notice${payrollNotice.startsWith("✓") ? "" : " warning"}`} role={payrollNotice.startsWith("✓") ? "status" : "alert"}>{payrollNotice}</p>}

          <div className="payroll-entry-tabs" role="tablist" aria-label="Ish va maosh yozuvi">
            <button className={payrollEntryMode === "shift" ? "active" : ""} type="button" onClick={() => setPayrollEntryMode("shift")}>Ish vaqti</button>
            <button className={payrollEntryMode === "day" ? "active" : ""} type="button" onClick={() => setPayrollEntryMode("day")}>Kun holati</button>
            <button className={payrollEntryMode === "adjustment" ? "active" : ""} type="button" onClick={() => setPayrollEntryMode("adjustment")}>Bonus / ushlanma</button>
          </div>

          <div className="payroll-entry-grid single">
            {payrollEntryMode === "shift" && <section id="payroll-shift-form">
              <div className="payroll-block-title"><span>2</span><div><b>{editingShiftId ? "Ish vaqtini tuzatish" : "Ish vaqtini kiritish"}</b><small>00:00 keyingi kun deb avtomatik hisoblanadi.</small></div></div>
              {!editingShiftId && <details className="ten-day-entry">
                <summary>＋ Oldingi 10 kunlik ish soatini birdan kiritish</summary>
                <p>Bir xodimni tanlang, har bir kun uchun kelgan va ketgan vaqtini yozing. Vaqtlar har xil bo‘lishi mumkin.</p>
                <label className="ten-day-worker"><span>Xodim</span><select value={tenDayStaffId} onChange={(event) => setTenDayStaffId(event.target.value)}><option value="">Tanlang</option>{data.staff.filter((member) => member.active).map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                <div className="ten-day-table">
                  <div className="ten-day-head"><b>Kun</b><b>Sana</b><b>Keldi</b><b>Ketdi</b><b>Jami</b></div>
                  {tenDayRows.map((row, index) => {
                    const range = shiftRange(row.date, row.clockIn, row.clockOut);
                    const minutes = range?.elapsedMinutes || 0;
                    return <div className="ten-day-row" key={row.id}>
                      <b>{index + 1}</b>
                      <input aria-label={`${index + 1}-kun sana`} type="date" value={row.date} onChange={(event) => setTenDayRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, date: event.target.value } : entry))} />
                      <input aria-label={`${index + 1}-kun keldi`} type="time" value={row.clockIn} onChange={(event) => setTenDayRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, clockIn: event.target.value } : entry))} />
                      <input aria-label={`${index + 1}-kun ketdi`} type="time" value={row.clockOut} onChange={(event) => setTenDayRows((current) => current.map((entry) => entry.id === row.id ? { ...entry, clockOut: event.target.value } : entry))} />
                      <strong>{formatMinutes(minutes)}</strong>
                    </div>;
                  })}
                </div>
                <button className="ten-day-save" disabled={Boolean(busy)} type="button" onClick={() => void saveTenDayShifts()}>{busy === "payroll-ten-days" ? "10 kun saqlanmoqda…" : "10 kunlik vaqtni saqlash"}</button>
              </details>}
              <div className="shift-entry-form">
                <label><span>Xodim</span><select value={shiftForm.staffId} onChange={(event) => { const staffId = event.target.value; const member = data.staff.find((entry) => entry.id === staffId); setShiftForm({ ...shiftForm, staffId, hourlyRate: member ? staffHourlyRate(member) : 0 }); }}><option value="">Tanlang</option>{data.staff.filter((member) => member.active || member.id === shiftForm.staffId).map((member) => <option value={member.id} key={member.id}>{member.name}{member.active ? "" : " · to‘xtagan"}</option>)}</select></label>
                <label><span>Kelgan sana (Seul)</span><input type="date" value={shiftForm.date} onChange={(event) => setShiftForm({ ...shiftForm, date: event.target.value })} /></label>
                <label><span>Keldi</span><input type="time" value={shiftForm.clockIn} onChange={(event) => setShiftForm({ ...shiftForm, clockIn: event.target.value })} /></label>
                <label><span>Ketdi</span><input type="time" value={shiftForm.clockOut} onChange={(event) => setShiftForm({ ...shiftForm, clockOut: event.target.value })} /></label>
                <label><span>Shu smena stavkasi</span><input type="number" min="0" inputMode="numeric" value={shiftForm.hourlyRate || ""} onChange={(event) => setShiftForm({ ...shiftForm, hourlyRate: Number(event.target.value) })} placeholder="₩ / soat" /></label>
                <label className="wide"><span>Izoh</span><input maxLength={300} value={shiftForm.note} onChange={(event) => setShiftForm({ ...shiftForm, note: event.target.value })} placeholder="Ixtiyoriy" /></label>
                <button disabled={Boolean(busy)} type="button" onClick={() => void addWorkShift()}>{busy === "payroll-shift" ? "Saqlanmoqda…" : editingShiftId ? "O‘zgarishni saqlash" : "Ish vaqtini saqlash"}</button>
                {editingShiftId && <button className="payroll-cancel" disabled={Boolean(busy)} type="button" onClick={() => resetShiftForm(shiftForm.staffId)}>Bekor qilish</button>}
              </div>
            </section>}

            {payrollEntryMode === "day" && <section>
              <div className="payroll-block-title"><span>3</span><div><b>Dam, kelmagan yoki kasal kunini belgilang</b><small>Bu holat ish vaqti bilan bir kunda bo‘la olmaydi.</small></div></div>
              <div className="day-status-form">
                <label><span>Xodim</span><select value={dayForm.staffId} onChange={(event) => setDayForm({ ...dayForm, staffId: event.target.value })}><option value="">Tanlang</option>{visibleStaff.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                <label><span>Sana</span><input type="date" value={dayForm.date} onChange={(event) => setDayForm({ ...dayForm, date: event.target.value })} /></label>
                <label><span>Kun holati</span><select value={dayForm.status} onChange={(event) => setDayForm({ ...dayForm, status: event.target.value as AttendanceDay["status"] })}><option value="off">Dam olish</option><option value="absent">Kelmadi</option><option value="sick">Kasal</option></select></label>
                <label><span>Maoshga ta’siri</span><select value={dayForm.payMode} onChange={(event) => setDayForm({ ...dayForm, payMode: event.target.value as AttendanceDay["payMode"] })}><option value="unpaid">Haqsiz — 0 soat</option><option value="planned">Reja soati hisoblanadi</option></select></label>
                <label className="wide"><span>Izoh</span><input maxLength={300} value={dayForm.note} onChange={(event) => setDayForm({ ...dayForm, note: event.target.value })} placeholder="Ixtiyoriy" /></label>
                <button disabled={Boolean(busy)} type="button" onClick={() => void saveAttendanceDay()}>{busy === "payroll-day" ? "Saqlanmoqda…" : "Kun holatini saqlash"}</button>
              </div>
            </section>}

            {payrollEntryMode === "adjustment" && <section>
              <div className="payroll-block-title"><span>4</span><div><b>Bonus yoki ushlanma</b><small>Avans endi xodim kartasidagi “Oylik to‘lash” orqali hisobdan chiqadi.</small></div></div>
              <div className="adjustment-entry-form">
                <label><span>Xodim</span><select value={adjustmentForm.staffId} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, staffId: event.target.value })}><option value="">Tanlang</option>{visibleStaff.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
                <label><span>Turi</span><select value={adjustmentForm.type === "advance" ? "bonus" : adjustmentForm.type} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, type: event.target.value as PayrollAdjustment["type"] })}><option value="bonus">Bonus</option><option value="deduction">Ushlanma</option></select></label>
                <label><span>Sana</span><input type="date" value={adjustmentForm.date} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, date: event.target.value })} /></label>
                <label><span>Summa</span><input type="number" min="0" inputMode="numeric" value={adjustmentForm.amount || ""} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, amount: Number(event.target.value) })} placeholder="₩" /></label>
                <label className="wide"><span>Sababi / izoh</span><input maxLength={300} value={adjustmentForm.note} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, note: event.target.value })} placeholder="Ixtiyoriy" /></label>
                <button disabled={Boolean(busy)} type="button" onClick={() => void addPayrollAdjustment()}>{busy === "payroll-adjustment" ? "Saqlanmoqda…" : "Yozuvni qo‘shish"}</button>
              </div>
            </section>}
          </div>

          <div className="payroll-summary-list">
            {payrollSummaries.length ? payrollSummaries.map(({ member, summary }) => {
              const memberShifts = data.workShifts.filter((shift) => shift.staffId === member.id && shift.date.startsWith(`${selectedPayrollMonth}-`) && shift.status !== "void").sort((left, right) => right.clockIn.localeCompare(left.clockIn));
              const memberWorkdays = calculateWorkdayPayEntries(member, memberShifts, new Date(), data.workShifts).sort((left, right) => right.date.localeCompare(left.date));
              const memberAdjustments = data.payrollAdjustments.filter((entry) => entry.staffId === member.id && entry.date.startsWith(`${selectedPayrollMonth}-`) && !entry.voided);
              const memberDays = data.attendanceDays.filter((day) => day.staffId === member.id && day.date.startsWith(`${selectedPayrollMonth}-`) && !day.voided);
              const memberPayments = data.payrollPayments.filter((payment) => payment.staffId === member.id && payment.month === selectedPayrollMonth && !payment.voided);
              return <article className={member.active ? "" : "inactive"} key={member.id}>
                <div className="payroll-person-head"><span><i>{member.name.slice(0, 1).toUpperCase()}</i><span><strong>{member.name}</strong><small>{member.payType === "monthly" ? `${won(member.monthlySalary)} / oy — ishlagan soatga mutanosib` : `${won(member.hourlyRate)} / soat`} · {member.workDays} kun × {member.dailyHours} soat · OT ×{member.overtimeMultiplier || 1}</small><small>{member.scheduledStartTime && member.scheduledEndTime ? `Hisob chegarasi: ${member.scheduledStartTime}–${member.scheduledEndTime}` : "Hisob chegarasi belgilanmagan"}</small><small className={member.workerId ? "payroll-linked" : ""}>{member.workerId ? `Login ulangan · @${workerAccounts.find((account) => account.id === member.workerId)?.username || "xodim"}` : "Faqat rahbar ish vaqtini kiritadi"}</small><small>{summary.workedDays} ish · {summary.offDays} dam · {summary.sickDays} kasal · {summary.absentDays} kelmadi</small></span></span><div><button className="payroll-pay-button" disabled={Boolean(busy)} type="button" onClick={() => openPayrollPayment(member, summary.remaining)}>Oylik to‘lash</button><button disabled={Boolean(busy)} type="button" onClick={() => editStaff(member)}>Tahrirlash</button><button disabled={Boolean(busy)} type="button" onClick={() => void toggleStaffActive(member)}>{member.active ? "To‘xtatish" : "Faollashtirish"}</button><button className="archive-delete" disabled={Boolean(busy)} type="button" onClick={() => void deleteStaff(member)}>Arxiv</button></div></div>
                <div className="payroll-metrics">
                  <p><span>Maoshga hisoblangan</span><strong>{formatMinutes(summary.payableWorkedMinutes)}</strong><small>Haqiqiy {formatMinutes(summary.workedMinutes)} · {summary.workedDays} kun</small></p>
                  <p><span>Qo‘shimcha ish</span><strong>{formatMinutes(summary.overtimeMinutes)}</strong><small>Qo‘shimcha hisob {won(summary.overtimePay)}</small></p>
                  <p><span>Hisoblangan</span><strong>{won(summary.grossPay)}</strong><small>Bonus +{won(summary.bonus)} · ushlanma −{won(summary.deduction)}</small></p>
                  <p className={summary.remaining < 0 ? "negative" : "payable"}><span>Qoldiq to‘lov</span><strong>{won(summary.remaining)}</strong><small>{summary.paymentAmount + summary.advance > 0 ? `To‘langan ${won(summary.paymentAmount + summary.advance)}` : "Hali to‘lov yozilmagan"}</small></p>
                </div>
                {paymentStaffId === member.id && <div className="payroll-payment-form" id={`payroll-payment-${member.id}`}>
                  <div className="payroll-block-title"><span>₩</span><div><b>Oylik to‘lovini yozish</b><small>{member.name} · {selectedPayrollMonth} · qoldiq {won(summary.remaining)}</small></div></div>
                  <label><span>To‘lov turi</span><select value={paymentForm.kind} onChange={(event) => setPaymentForm({ ...paymentForm, kind: event.target.value as PayrollPayment["kind"] })}><option value="advance">Avans</option><option value="salary">Oylik to‘lovi</option></select></label>
                  <label><span>Summa</span><input type="number" min="1" inputMode="numeric" value={paymentForm.amount || ""} onChange={(event) => setPaymentForm({ ...paymentForm, amount: Number(event.target.value) })} /></label>
                  <label><span>Qayerdan to‘landi?</span><select value={paymentForm.accountId} onChange={(event) => setPaymentForm({ ...paymentForm, accountId: event.target.value })}><option value="">Hisobni tanlang</option>{data.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                  <label><span>Berilgan sana va aniq vaqt (Seul)</span><input type="datetime-local" value={paymentForm.paidAtLocal} onChange={(event) => setPaymentForm({ ...paymentForm, paidAtLocal: event.target.value })} /></label>
                  <label className="wide"><span>Izoh</span><input maxLength={300} value={paymentForm.note} onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })} placeholder="Ixtiyoriy" /></label>
                  <button className="control-primary" disabled={Boolean(busy)} type="button" onClick={() => void savePayrollPayment()}>{busy === "payroll-payment" ? "Saqlanmoqda…" : "To‘lovni tasdiqlash"}</button>
                  <button className="payroll-cancel" disabled={Boolean(busy)} type="button" onClick={() => setPaymentStaffId("")}>Yopish</button>
                </div>}
                <details className="payroll-details"><summary>Kunlar va to‘lovlar ({memberShifts.length + memberAdjustments.length + memberDays.length + memberPayments.length})</summary><div>
                  {!!memberWorkdays.length && <div className="payroll-daily-pay-list">
                    <b className="payroll-daily-pay-title">KUNMA-KUN QO‘SHILGAN ISH HAQI</b>
                    {memberWorkdays.map((day) => <div className={`payroll-detail-row daily-pay${day.conflict ? " conflict" : day.open ? " open" : ""}`} key={`${member.id}:${day.date}`}><span><b>{day.date}</b><small>Haqiqiy {formatMinutes(day.conflict ? day.recordedMinutes : day.workedMinutes)} · hisoblangan {formatMinutes(day.payableMinutes)}{day.open ? " · hozir ishda" : ""}</small></span><strong>{day.conflict ? "SMENALAR USTMA-UST — TUZATING" : day.open ? "ISHNI TUGATGACH HISOBLANADI" : `+${won(day.roundedTotalPay)}`}</strong><em>{day.conflict ? "Bittasini tahrirlang yoki bekor qiling — hozircha hisoblanmadi" : day.open ? "Yakuniy summa hali qo‘shilmadi" : `Oddiy ${won(day.roundedRegularPay)} · qo‘shimcha ${won(day.roundedOvertimePay)}`}</em></div>)}
                  </div>}
                  {memberShifts.map((shift) => <div className="payroll-detail-row" key={shift.id}><span><b>{shift.date}</b><small>{new Date(shift.clockIn).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })} → {shift.clockOut ? new Date(shift.clockOut).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }) : "ISHDA"}</small></span><strong>{formatMinutes(workShiftMinutes(shift))}</strong><em>{shift.source === "worker" ? "Xodim kiritdi" : "Rahbar kiritdi"}</em><div className="payroll-detail-actions"><button disabled={Boolean(busy)} type="button" onClick={() => editWorkShift(shift)}>Tahrirlash</button><button disabled={Boolean(busy)} type="button" onClick={() => void voidWorkShift(shift)}>Olib tashlash</button></div></div>)}
                  {memberDays.map((day) => <div className="payroll-detail-row day" key={day.id}><span><b>{day.date} · {day.status === "off" ? "Dam olish" : day.status === "sick" ? "Kasal" : "Kelmadi"}</b><small>{day.note || "Izoh yo‘q"}</small></span><strong>{day.payMode === "planned" ? formatMinutes(day.plannedMinutesAtDay) : "Haqsiz"}</strong><em>Kun holati</em><button disabled={Boolean(busy)} type="button" onClick={() => void voidAttendanceDay(day)}>Bekor qilish</button></div>)}
                  {memberAdjustments.map((entry) => <div className="payroll-detail-row adjustment" key={entry.id}><span><b>{entry.date} · {entry.type === "bonus" ? "Bonus" : entry.type === "advance" ? "Avans" : "Ushlanma"}</b><small>{entry.note || "Izoh yo‘q"}</small></span><strong>{entry.type === "bonus" ? "+" : "−"}{won(entry.amount)}</strong><em>Maosh yozuvi</em><button disabled={Boolean(busy)} type="button" onClick={() => void voidPayrollAdjustment(entry)}>Bekor qilish</button></div>)}
                  {memberPayments.map((payment) => <div className={`payroll-detail-row payment${payment.voided ? " voided" : ""}`} key={payment.id}><span><b>{payment.date} · {payment.paidAt ? seoulClock(new Date(payment.paidAt)) : "aniq vaqt oldin yozilmagan"} · {payment.kind === "advance" ? "Avans to‘lovi" : "Oylik to‘lovi"}</b><small>{data.accounts.find((account) => account.id === payment.accountId)?.name || "Hisob"}{payment.note ? ` · ${payment.note}` : ""}</small></span><strong>−{won(payment.amount)}</strong><em>{payment.voided ? "Bekor qilingan" : "Pul chiqdi"}</em><button disabled={Boolean(busy) || payment.voided} type="button" onClick={() => void voidPayrollPayment(payment)}>{payment.voided ? "Bekor qilingan" : "Bekor qilish"}</button></div>)}
                  {!memberShifts.length && !memberAdjustments.length && !memberDays.length && !memberPayments.length && <p className="control-empty">Bu oy uchun ish vaqti yoki maosh yozuvi yo‘q.</p>}
                </div></details>
              </article>;
            }) : <p className="control-empty">Avval xodim va uning maosh rejasini qo‘shing.</p>}
          </div>
        </article>

        <article className="control-card automatic-rules-card">
          <div className="control-head"><div><span>4 · AVTOMATIK HISOB</span><h3>Soliq va komissiyalar</h3></div></div>
          <div className="rules-grid">
            <label><span>Karta komissiyasi (%)</span><input type="number" min="0" step="0.01" value={rules.cardCommissionPct || ""} onChange={(event) => setRules({ ...rules, cardCommissionPct: Number(event.target.value) })} /></label>
            <label><span>Yetkazib berish komissiyasi (%)</span><input type="number" min="0" step="0.01" value={rules.deliveryCommissionPct || ""} onChange={(event) => setRules({ ...rules, deliveryCommissionPct: Number(event.target.value) })} /></label>
          </div>
          <div className="rule-summary"><p><span>Soliq zaxirasi · taxmin</span><strong>{data.costRules.taxPct || 0}%</strong></p><p><span>Kunlik maosh hisoboti</span><strong>{won(dailyPayroll)}</strong></p><p><span>Bugungi jami avtomatik minus</span><strong>{won(automaticToday)}</strong></p></div>
          <button className="control-primary" onClick={() => void saveRules()}>Qoidalarni saqlash</button>
        </article>
      </section>

      <section className="control-card worker-access-card" id="worker-access">
        <div className="control-head"><div><span>5 · XODIM AKKAUNTLARI</span><h3>{branchName} xodimlari</h3></div><b>{workerAccounts.filter((account) => account.active).length} ta faol</b></div>
        <div className="worker-access-content">
          <div><p>Har bir xodim o‘z login va PIN’i bilan kiradi. Kim savdo, minus mahsulot yoki xarajat kiritgani tarixda ismi bilan ko‘rinadi.</p><small>Akkaunt to‘xtatilsa yoki PIN almashtirilsa, uning ochiq kirishlari avtomatik yopiladi.</small><a className="worker-app-link" href="/xodim#iphone-app" target="_blank" rel="noreferrer"> iPhone’ga HALO Xodim app o‘rnatish</a></div>
          <div className="worker-account-create">
            <label><span>Xodim ismi</span><input value={workerForm.name} onChange={(event) => setWorkerForm({ ...workerForm, name: event.target.value })} placeholder="Masalan: Ali" /></label>
            <label><span>Shaxsiy login</span><input value={workerForm.username} onChange={(event) => setWorkerForm({ ...workerForm, username: event.target.value.toLowerCase().replace(/\s/g, "") })} placeholder="ali01" /></label>
            <label><span>PIN kod</span><input type="password" inputMode="numeric" maxLength={8} value={workerForm.pin} onChange={(event) => setWorkerForm({ ...workerForm, pin: event.target.value.replace(/\D/g, "") })} placeholder="4–8 ta raqam" /></label>
            <button className="control-primary" disabled={busy === "worker-create"} onClick={() => void createWorker()}>{busy === "worker-create" ? "Yaratilmoqda…" : "＋ Akkaunt yaratish"}</button>
          </div>
        </div>
        {workerNotice && <p className="control-notice">{workerNotice}</p>}
        {workerAccounts.length > 0 && <p className="worker-telegram-guide"><b>✈ Telegram ulash:</b> pastdagi har bir xodim qatorida ko‘k tugma bor. Tugmani bosib, chiqqan shaxsiy havolani faqat o‘sha xodimga yuboring.</p>}
        <div className="worker-account-list">
          {workerAccounts.map((account) => <div className={account.active ? "" : "inactive"} key={account.id}>
            <span><i>{account.name.slice(0, 1).toUpperCase()}</i><span><strong>{account.name}</strong><small>@{account.username} · {account.lastLoginAt ? `oxirgi kirish ${new Date(account.lastLoginAt).toLocaleString("uz-UZ")}` : "hali kirmagan"}</small><small className={account.telegramChatId ? "telegram-linked" : ""}>{account.telegramChatId ? `Telegram ✓ ${account.telegramChatName || ""}` : "Telegram ulanmagan"}</small></span></span>
            <b>{account.active ? "FAOL" : "TO‘XTAGAN"}</b>
            <label className="worker-permission-toggle"><input type="checkbox" checked={Boolean(account.canWarehouseReceipt)} disabled={!account.active || busy === `warehouse-${account.id}`} onChange={() => void toggleWorkerWarehouseReceipt(account)} /><span><b>XARAJAT · MOY · MEZANA</b><small>{account.canWarehouseReceipt ? "Ruxsat berilgan" : "Ruxsat yo‘q"}</small></span></label>
            <label className="worker-permission-toggle"><input type="checkbox" checked={Boolean(account.canSupplierDelivery)} disabled={!account.active || busy === `supplier-delivery-${account.id}`} onChange={() => void toggleWorkerSupplierDelivery(account)} /><span><b>YETKAZUVCHI KIRIMI</b><small>{account.canSupplierDelivery ? "Xodim dasturida ochiq" : "Xodim dasturida yashirilgan"}</small></span></label>
            <button className={`worker-telegram-button${account.telegramChatId ? " telegram-ready" : ""}`} disabled={busy === `telegram-${account.id}`} onClick={() => void prepareWorkerTelegram(account)}>{busy === `telegram-${account.id}` ? "TAYYORLANMOQDA…" : account.telegramChatId ? "✈ QAYTA ULASH" : "✈ TELEGRAMGA ULASH"}</button>
            <button disabled={busy === `pin-${account.id}`} onClick={() => void changeWorkerPin(account)}>PIN yangilash</button>
            <button className={account.active ? "danger" : ""} disabled={busy === account.id} onClick={() => void toggleWorker(account)}>{account.active ? "To‘xtatish" : "Faollashtirish"}</button>
            {workerTelegramLinks[account.id] && <div className="worker-telegram-pair">
              <span><b>1. Havolani faqat {account.name}ga yuboring</b><input readOnly value={workerTelegramLinks[account.id]} onFocus={(event) => event.currentTarget.select()} /></span>
              <button onClick={() => void shareWorkerTelegramLink(account)}>↗ Xodimga yuborish</button>
              <button onClick={() => void copyWorkerTelegramLink(account)}>Nusxalash</button>
              <button className="check" disabled={busy === `telegram-check-${account.id}`} onClick={() => void checkWorkerTelegram(account)}>{busy === `telegram-check-${account.id}` ? "Tekshirilmoqda…" : "2. Ulanganini tekshirish"}</button>
            </div>}
          </div>)}
          {!workerAccounts.length && <p className="control-empty">Hali xodim akkaunti yaratilmagan.</p>}
        </div>
      </section>

      <section className="control-card worker-task-center" id="worker-tasks">
        <div className="control-head"><div><span>6 · HODIMLARGA VAZIFA</span><h3>Vazifa yuborish markazi</h3></div><div className="task-head-controls"><button type="button" disabled={busy === "task-clear-history"} onClick={() => void clearAssignedTaskHistory()}>{busy === "task-clear-history" ? "Tozalanmoqda…" : "Eski xabarlarni tozalash"}</button><b>{activeAssignedTasks.filter((entry) => entry.status === "new" || entry.status === "started").length} ta ochiq</b></div></div>
        <div className="task-send-windows">
          <article className="task-send-window individual">
            <div className="task-window-head"><i>1</i><span><small>ALOHIDA YUBORISH</small><strong>Bitta hodimga vazifa</strong><em>Faqat tanlangan hodim oladi</em></span></div>
            <div className="assigned-task-create">
              <label><span>Kimga?</span><select value={taskForm.workerId} onChange={(event) => setTaskForm({ ...taskForm, workerId: event.target.value })}><option value="">Hodimni tanlang</option>{workerAccounts.filter((account) => account.active).map((account) => <option value={account.id} key={account.id}>{account.name}{account.telegramChatId ? " · Telegram ✓" : ""}</option>)}</select></label>
              <label><span>Vazifa nomi</span><input maxLength={120} value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} placeholder="Masalan: Muzlatgichni tekshirish" /></label>
              <label><span>Muhimlik</span><select value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value as AssignedTask["priority"] })}><option value="normal">Oddiy</option><option value="important">Muhim</option><option value="urgent">Shoshilinch</option></select></label>
              <label><span>Muddat</span><input type="datetime-local" value={taskForm.dueAt} onChange={(event) => setTaskForm({ ...taskForm, dueAt: event.target.value })} /></label>
              <label className="task-description"><span>To‘liq izoh</span><textarea maxLength={1000} value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} placeholder="Nima qilish kerakligini tushunarli yozing" /></label>
              <button className="control-primary" disabled={busy === "task-create"} onClick={() => void createAssignedTask()}>{busy === "task-create" ? "Yuborilmoqda…" : "Bitta hodimga yuborish →"}</button>
            </div>
          </article>

          <article className="task-send-window bulk">
            <div className="task-window-head"><i>∞</i><span><small>BITTADA YUBORISH</small><strong>Bir nechta yoki barcha hodimga</strong><em>Har biri alohida bajaradi</em></span></div>
            <div className="bulk-task-recipients">
              <div><span>Kimlarga?</span><button type="button" onClick={toggleAllBulkTaskWorkers}>{workerAccounts.filter((account) => account.active).length > 0 && workerAccounts.filter((account) => account.active).every((account) => bulkTaskForm.workerIds.includes(account.id)) ? "Tanlovni tozalash" : "✓ Barchasini tanlash"}</button><b>{bulkTaskForm.workerIds.length} ta tanlandi</b></div>
              <div className="bulk-worker-picker">{workerAccounts.filter((account) => account.active).map((account) => <label className={bulkTaskForm.workerIds.includes(account.id) ? "selected" : ""} key={account.id}><input type="checkbox" checked={bulkTaskForm.workerIds.includes(account.id)} onChange={() => toggleBulkTaskWorker(account.id)} /><span><strong>{account.name}</strong><small>{account.telegramChatId ? "Telegram ✓" : "Faqat akkaunt"}</small></span></label>)}{!workerAccounts.some((account) => account.active) && <p>Faol hodim akkaunti yo‘q.</p>}</div>
            </div>
            <div className="bulk-task-create">
              <label className="title"><span>Vazifa nomi</span><input maxLength={120} value={bulkTaskForm.title} onChange={(event) => setBulkTaskForm({ ...bulkTaskForm, title: event.target.value })} placeholder="Masalan: Oshxonani umumiy tozalash" /></label>
              <label><span>Muhimlik</span><select value={bulkTaskForm.priority} onChange={(event) => setBulkTaskForm({ ...bulkTaskForm, priority: event.target.value as AssignedTask["priority"] })}><option value="normal">Oddiy</option><option value="important">Muhim</option><option value="urgent">Shoshilinch</option></select></label>
              <label><span>Muddat</span><input type="datetime-local" value={bulkTaskForm.dueAt} onChange={(event) => setBulkTaskForm({ ...bulkTaskForm, dueAt: event.target.value })} /></label>
              <label className="description"><span>To‘liq izoh</span><textarea maxLength={1000} value={bulkTaskForm.description} onChange={(event) => setBulkTaskForm({ ...bulkTaskForm, description: event.target.value })} placeholder="Hamma bajarishi kerak bo‘lgan vazifani tushunarli yozing" /></label>
              <button className="control-primary" disabled={busy === "task-create-bulk" || !bulkTaskForm.workerIds.length} onClick={() => void createBulkAssignedTask()}>{busy === "task-create-bulk" ? "Hodimlarga yuborilmoqda…" : `${bulkTaskForm.workerIds.length || 0} ta hodimga bittada yuborish →`}</button>
            </div>
          </article>
        </div>
        <p className="task-helper">Telegram uchun: akkaunt yonidagi “Telegram ulash”dan shaxsiy havola oling, xodimga yuboring va u START bosgach “Ulanganini tekshirish”ni bosing.</p>
        {taskNotice && <p className={`control-notice${taskNotice.startsWith("✓") ? "" : " warning"}`}>{taskNotice}</p>}
        <div className="assigned-task-list">
          {activeAssignedTasks.length ? activeAssignedTasks.map((entry) => <article className={`${entry.status} ${entry.priority}`} key={entry.id}>
            <div className="assigned-task-main">
              <span><b>{entry.workerName}</b><em>{entry.priority === "urgent" ? "SHOSHILINCH" : entry.priority === "important" ? "MUHIM" : "ODDIY"}</em></span>
              <h4>{entry.title}</h4>
              {entry.description && <p>{entry.description}</p>}
              <small>{entry.dueAt ? `Muddat: ${entry.dueAt.replace("T", " ")}` : "Muddat belgilanmagan"} · {new Date(entry.createdAt).toLocaleString("uz-UZ", {timeZone:"Asia/Seoul"})}</small>
            </div>
            <div className="assigned-task-state">
              <b>{entry.status === "new" ? "YANGI" : entry.status === "started" ? "BOSHLADI" : "BAJARILDI"}</b>
              <small className={entry.telegramStatus === "sent" ? "sent" : ""}>{entry.telegramStatus === "sent" ? "Telegram ✓" : "Telegram yuborilmadi"}</small>
            </div>
            <div className="assigned-task-actions">
              <button disabled={busy === `task-send-${entry.id}`} onClick={() => void resendAssignedTask(entry)}>Telegramga qayta</button>
              {(entry.status === "new" || entry.status === "started") && <button className="danger" disabled={busy === `task-cancel-${entry.id}`} onClick={() => void cancelAssignedTask(entry)}>Olib tashlash</button>}
            </div>
          </article>) : <p className="control-empty">Hali hech kimga shaxsiy vazifa yuborilmagan.</p>}
        </div>
      </section>

      <section className="control-card data-export-card">
        <div className="control-head"><div><span>8 · API VA ZIP YUKLASH</span><h3>HALO ma’lumotlarini oson yuklab oling</h3></div><b>FAQAT RAHBAR</b></div>
        <p className="data-export-intro">Tanlangan filialning ombori, savdosi, xarajatlari, retseptlari, xodimlari va maosh tarixini bitta tugma bilan olib qo‘ying.</p>
        <div className="data-export-grid">
          <article>
            <i>{"{ }"}</i>
            <span><small>API / JSON</small><h4>API ma’lumotlari</h4><p>Barcha bo‘limlar bitta tartibli JSON faylida. Tizimga ulash yoki ma’lumotni tekshirish uchun qulay.</p></span>
            <button type="button" disabled={Boolean(busy)} onClick={() => void downloadApiJson()}>{busy === "api-json" ? "Tayyorlanmoqda…" : "↓ API JSON yuklash"}</button>
          </article>
          <article className="zip">
            <i>ZIP</i>
            <span><small>TO‘LIQ ZAXIRA</small><h4>HALO Control ZIP</h4><p>Umumiy API fayli, manifest va har bir ma’lumot bo‘limi alohida JSON ko‘rinishida joylanadi.</p></span>
            <button type="button" disabled={Boolean(busy)} onClick={() => void downloadZipBackup()}>{busy === "api-zip" ? "Tayyorlanmoqda…" : "↓ To‘liq ZIP yuklash"}</button>
          </article>
        </div>
        {dataExportNotice && <p className="control-notice">{dataExportNotice}</p>}
        <small className="data-export-warning">🔒 Fayllarda biznes va xodim ma’lumotlari bor. Faqat o‘zingizda xavfsiz saqlang.</small>
      </section>

      <section className="control-grid" id="management-audit">
        <article className="control-card">
          <div className="control-head"><div><span>9 · TARIX</span><h3>Kim nima o‘zgartirdi?</h3></div><select value={auditActor} onChange={(event) => { setAuditActor(event.target.value); setAuditPage(0); }}><option value="">Barcha xodimlar</option>{auditActors.map((actor) => <option value={actor} key={actor}>{actor}</option>)}</select></div>
          <div className="audit-list">{visibleAudit.length ? visibleAudit.map((entry) => <div key={entry.id}><i>{entry.actor === "Rahbar" ? "R" : entry.actor.slice(0, 1).toUpperCase()}</i><span><strong>{entry.action}</strong><small>{entry.actor} · {new Date(entry.createdAt).toLocaleString("uz-UZ", {timeZone:"Asia/Seoul"})}</small></span></div>) : <p className="control-empty">Tanlangan xodim bo‘yicha yozuv topilmadi.</p>}</div>
          <div className="export-actions" aria-label="Jurnal sahifalari"><span>Jami {filteredAudit.length} yozuv · {currentAuditPage + 1}-sahifa</span><button type="button" disabled={currentAuditPage === 0} onClick={() => setAuditPage(currentAuditPage - 1)}>Oldingi</button><button type="button" disabled={(currentAuditPage + 1) * 50 >= filteredAudit.length} onClick={() => setAuditPage(currentAuditPage + 1)}>Keyingi</button></div>
        </article>

        <article className="control-card">
          <div className="control-head"><div><span>10 · BACKUP VA HISOBOT</span><h3>Avtomatik zaxiralar tarixi</h3></div><button onClick={() => void refreshBackups()}>Yangilash</button></div>
          <div className="export-actions"><button onClick={() => void exportExcel()} disabled={busy === "excel"}>↓ Excel</button><button onClick={() => window.print()}>▧ PDF / Chop etish</button></div>
          {backupNotice && <p className="control-notice">{backupNotice}</p>}
          <div className="backup-list">{backups.slice(0, 8).map((backup) => <div key={backup.id}><span><strong>{backup.action}</strong><small>{new Date(backup.createdAt).toLocaleString("uz-UZ")} · {backup.actor}</small></span><button disabled={busy === backup.id} onClick={() => void restoreBackup(backup)}>{busy === backup.id ? "Qaytarilmoqda…" : "Shu holatga qaytarish"}</button></div>)}</div>
        </article>
      </section>
    </div>
  );
}
