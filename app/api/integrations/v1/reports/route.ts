import {
  authenticateApiKey,
  writeIntegrationLog,
} from "../../../../lib/integration-store";
import { readHaloState } from "../../../../lib/halo-store";
import { calculateDailyReport } from "../../../../lib/daily-report";
import { seoulBusinessDate } from "../../../../lib/business-time";

const monthDates = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
};

export async function GET(request: Request) {
  const key = await authenticateApiKey(request, "reports:read");
  const endpoint = "/api/integrations/v1/reports";
  if (!key) {
    await writeIntegrationLog({ endpoint, method: "GET", status: 401, message: "Noto‘g‘ri API kaliti" });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || "";
    const month = url.searchParams.get("month") || (date ? "" : seoulBusinessDate().slice(0, 7));
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ ok: false, error: "date YYYY-MM-DD formatida bo‘lsin." }, { status: 400 });
    }
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ ok: false, error: "month YYYY-MM formatida bo‘lsin." }, { status: 400 });
    }
    const current = await readHaloState(key.branchId);
    if (date) {
      const report = calculateDailyReport(current.state, date);
      await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 200, message: `${date} hisoboti` });
      return Response.json({ ok: true, branchId: key.branchId, date, report, updatedAt: current.updatedAt }, { headers: { "Cache-Control": "no-store" } });
    }
    const rows = monthDates(month).map((rowDate) => ({ date: rowDate, ...calculateDailyReport(current.state, rowDate) }));
    const numericKeys = ["revenue", "cost", "grossProfit", "manualExpenses", "recurringExpenses", "enteredExpenses", "otherIncome", "cardCommission", "deliveryCommission", "tax", "cardSales", "deliverySales", "cashSales", "bankSales", "taxableSales", "accountantManagedSales", "taxExemptSales", "inventoryOnlyCost", "inventoryOnlyItemCount", "payroll", "automaticExpenses", "totalExpenses", "netProfit", "itemCount"] as const;
    const totals = Object.fromEntries(numericKeys.map((name) => [name, rows.reduce((sum, row) => sum + Number(row[name] || 0), 0)]));
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 200, message: `${month} hisoboti` });
    return Response.json({ ok: true, branchId: key.branchId, month, totals, rows, updatedAt: current.updatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    await writeIntegrationLog({ branchId: key.branchId, keyId: key.id, endpoint, method: "GET", status: 500, message: "Hisobot ochilmadi" });
    return Response.json({ ok: false, error: "Hisobot ochilmadi." }, { status: 500 });
  }
}
