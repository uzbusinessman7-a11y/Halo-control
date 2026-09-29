import { isAdminRequest } from "../../lib/integration-store";
import { authenticateWorkerRequest } from "../../lib/worker-auth";
import {
  cancelWorkerTask,
  clearWorkerTaskHistory,
  completeWorkerTelegramLink,
  createWorkerTask,
  createWorkerTasks,
  createWorkerTelegramLink,
  getWorkerTelegramStatus,
  listAdminWorkerTasks,
  listWorkerTasks,
  sendWorkerTask,
  setWorkerTaskStatus,
  setWorkerTelegram,
} from "../../lib/worker-tasks";

function branchName(value: unknown) {
  return String(value || "HALO filial").trim().slice(0, 80) || "HALO filial";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("admin") === "1") {
      if (!await isAdminRequest(request)) {
        return Response.json({ error: "Faqat rahbar ko‘ra oladi." }, { status: 401 });
      }
      return Response.json(
        { tasks: await listAdminWorkerTasks(url.searchParams.get("branch") || "main") },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    return Response.json(
      {
        tasks: await listWorkerTasks(session.userId, session.branchId),
        telegram: await getWorkerTelegramStatus(session.userId, session.branchId),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Vazifalar ochilmadi." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "worker-telegram-link" || action === "worker-telegram-check") {
      const session = await authenticateWorkerRequest(request);
      if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
      return Response.json({
        ok: true,
        ...(action === "worker-telegram-link"
          ? await createWorkerTelegramLink(session.userId, session.branchId)
          : await completeWorkerTelegramLink(session.userId, session.branchId)),
      });
    }
    if (!await isAdminRequest(request)) {
      return Response.json({ error: "Faqat rahbar vazifa yubora oladi." }, { status: 401 });
    }
    const branchId = String(body.branchId || "main");
    if (action === "create-bulk") {
      const tasks = await createWorkerTasks({
        branchId,
        workerIds: Array.isArray(body.workerIds) ? body.workerIds.map(String) : [],
        title: String(body.title || ""),
        description: String(body.description || ""),
        priority: String(body.priority || "normal"),
        dueAt: String(body.dueAt || ""),
        createdBy: "Rahbar",
      });
      const telegramResults = await Promise.all(tasks.map(async ({ workerId, taskId }) => ({
        workerId,
        taskId,
        ...(await sendWorkerTask(
          taskId,
          branchName(body.branchName),
          `${new URL(request.url).origin}/xodim`,
        )),
      })));
      return Response.json({
        ok: true,
        created: tasks.length,
        telegram: {
          sent: telegramResults.filter((entry) => entry.sent).length,
          failed: telegramResults.filter((entry) => !entry.sent).length,
        },
      });
    }
    if (action === "create") {
      const taskId = await createWorkerTask({
        branchId,
        workerId: String(body.workerId || ""),
        title: String(body.title || ""),
        description: String(body.description || ""),
        priority: String(body.priority || "normal"),
        dueAt: String(body.dueAt || ""),
        createdBy: "Rahbar",
      });
      const telegram = await sendWorkerTask(
        taskId,
        branchName(body.branchName),
        `${new URL(request.url).origin}/xodim`,
      );
      return Response.json({ ok: true, taskId, telegram });
    }
    if (action === "resend") {
      const telegram = await sendWorkerTask(
        String(body.taskId || ""),
        branchName(body.branchName),
        `${new URL(request.url).origin}/xodim`,
      );
      return Response.json({ ok: true, telegram });
    }
    if (action === "cancel") {
      await cancelWorkerTask(String(body.taskId || ""), branchId, String(body.reason || ""));
      return Response.json({ ok: true });
    }
    if (action === "clear-history") {
      return Response.json({ ok: true, removed: await clearWorkerTaskHistory(branchId) });
    }
    if (action === "create-telegram-link") {
      return Response.json({
        ok: true,
        ...(await createWorkerTelegramLink(String(body.workerId || ""), branchId)),
      });
    }
    if (action === "check-telegram-link") {
      return Response.json({
        ok: true,
        ...(await completeWorkerTelegramLink(String(body.workerId || ""), branchId)),
      });
    }
    if (action === "set-telegram") {
      await setWorkerTelegram(
        String(body.workerId || ""),
        branchId,
        String(body.chatId || ""),
        String(body.chatName || "Qo‘lda kiritilgan"),
      );
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Amal tanlanmagan." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Vazifa yuborilmadi." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await authenticateWorkerRequest(request);
    if (!session) return Response.json({ error: "PIN bilan kiring." }, { status: 401 });
    const body = await request.json() as { taskId?: unknown; status?: unknown };
    await setWorkerTaskStatus(
      String(body.taskId || ""),
      session.userId,
      session.branchId,
      String(body.status || ""),
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Vazifa yangilanmadi." },
      { status: 400 },
    );
  }
}
