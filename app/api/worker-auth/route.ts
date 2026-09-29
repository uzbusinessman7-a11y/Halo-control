import { isAdminRequest } from "../../lib/integration-store";
import { ensureHaloState, readHaloState } from "../../lib/halo-store";
import { buildWorkerStateView } from "../../lib/worker-state-view";
import {
  authenticateWorkerRequest,
  clearWorkerCookie,
  createWorkerAccount,
  ensureWorkerAccess,
  listWorkerAccounts,
  listWorkerBranches,
  loginWorker,
  logoutWorker,
  resetWorkerPin,
  setWorkerActive,
  setWorkerSupplierDelivery,
  setWorkerWarehouseReceipt,
} from "../../lib/worker-auth";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("admin") === "1") {
      if (!await isAdminRequest(request)) {
        return Response.json({ error: "Faqat rahbar ko‘ra oladi." }, { status: 401 });
      }
      return Response.json({
        accounts: await listWorkerAccounts(url.searchParams.get("branch") || "main"),
      });
    }
    // Finish each schema initializer once in this request before starting the
    // parallel session/branch reads. This avoids duplicate cold-start D1 work.
    await Promise.all([ensureHaloState(), ensureWorkerAccess()]);
    const sessionPromise = authenticateWorkerRequest(request);
    const branchesPromise = listWorkerBranches();
    const session = await sessionPromise;
    const [branches, state] = await Promise.all([
      branchesPromise,
      url.searchParams.get("bootstrap") === "1" && session
        ? readHaloState(session.branchId).then((current) => (
          buildWorkerStateView(current.state, session.userId, current.updatedAt)
        ))
        : Promise.resolve(undefined),
    ]);
    return Response.json({
      branches,
      authenticated: Boolean(session),
      branchId: session?.branchId || "",
      userId: session?.userId || "",
      userName: session?.name || "",
      username: session?.username || "",
      canWarehouseReceipt: Boolean(session?.canWarehouseReceipt),
      canSupplierDelivery: Boolean(session?.canSupplierDelivery),
      ...(state ? { state } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Xodim tizimiga vaqtincha ulanib bo‘lmadi.", retryable: true },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  let requestedAction = "";
  try {
    const body = await request.json() as {
      action?: unknown;
      branchId?: unknown;
      workerId?: unknown;
      name?: unknown;
      username?: unknown;
      pin?: unknown;
      active?: unknown;
      allowed?: unknown;
    };
    const action = String(body.action || "");
    requestedAction = action;
    if (["create", "status", "reset-pin", "warehouse-receipt", "supplier-delivery"].includes(action)) {
      if (!await isAdminRequest(request)) {
        return Response.json({ error: "Faqat rahbar xodim akkauntini boshqaradi." }, { status: 401 });
      }
      if (action === "create") {
        await createWorkerAccount(
          String(body.branchId || ""),
          String(body.name || ""),
          String(body.username || ""),
          String(body.pin || ""),
        );
      } else if (action === "status") {
        await setWorkerActive(String(body.workerId || ""), Boolean(body.active));
      } else if (action === "reset-pin") {
        await resetWorkerPin(String(body.workerId || ""), String(body.pin || ""));
      } else if (action === "warehouse-receipt") {
        await setWorkerWarehouseReceipt(String(body.workerId || ""), Boolean(body.allowed));
      } else {
        await setWorkerSupplierDelivery(String(body.workerId || ""), Boolean(body.allowed));
      }
      return Response.json({ ok: true });
    }
    if (action === "login") {
      const result = await loginWorker(
        String(body.branchId || ""),
        String(body.username || ""),
        String(body.pin || ""),
      );
      const current = await readHaloState(result.branchId);
      return Response.json(
        {
          ok: true,
          branchId: result.branchId,
          userId: result.userId,
          userName: result.name,
          username: result.username,
          canWarehouseReceipt: result.canWarehouseReceipt,
          canSupplierDelivery: result.canSupplierDelivery,
          state: buildWorkerStateView(current.state, result.userId, current.updatedAt),
        },
        { headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" } },
      );
    }
    if (action === "logout") {
      await logoutWorker(request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": clearWorkerCookie } });
    }
    return Response.json({ error: "Amal tanlanmagan." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kirish amalga oshmadi.";
    if (requestedAction !== "login") {
      return Response.json({ error: message }, { status: 400 });
    }
    const locked = message.includes("15 daqiqa") || message.startsWith("5 marta xato");
    const invalidLogin = message.startsWith("Login yoki PIN noto‘g‘ri");
    const invalidInput = message.startsWith("Noto‘g‘ri filial")
      || message.startsWith("Login 3–32")
      || message.startsWith("PIN 4–8");
    const status = locked ? 429 : invalidLogin ? 401 : invalidInput ? 400 : 503;
    return Response.json(
      { error: status === 503 ? "Xodim tizimiga vaqtincha ulanib bo‘lmadi." : message, retryable: status === 503 },
      { status },
    );
  }
}
