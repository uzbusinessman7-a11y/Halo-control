import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as mezana from "../app/lib/mezana-debts.ts";

// Exercise the extracted service with the same route, DB and Telegram mocks.
const source = readFileSync(new URL("../app/lib/telegram-service.ts", import.meta.url), "utf8") + "\n" +
  readFileSync(new URL("../app/api/telegram/route.ts", import.meta.url), "utf8").replace(/^import .*from "..\/..\/lib\/telegram-service";$/m, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ authorized = true, notificationFails = false, saveFails = false, updates } = {}) {
  let state = {
    mezanaSettings: mezana.normalizeMezanaSettings(null),
    mezanaEntries: [{ legacy: "keep this record" }],
    transactions: [{ id: "unrelated", amount: -10 }],
  };
  const calls = [];
  class HaloStateConflictError extends Error {}
  const exports = {};
  const database = {
    batch: async () => [],
    prepare: () => ({ bind() { return this; }, first: async () => ({ bot_token: "test-only", chat_id: "-99" }) }),
  };
  runInNewContext(compiled, {
    exports, Response, Request, URL, AbortSignal, Error, __HALO_CONTROL_DB__: database,
    require(name) {
      if (name.endsWith("/integration-store")) return { isAdminRequest: async () => authorized };
      if (name.endsWith("/mezana-debts")) return mezana;
      if (name.endsWith("/halo-store")) return {
        HaloStateConflictError,
        mutateHaloState: async (mutator, attempts, branchId) => {
          calls.push({ method: "save", branchId, attempts });
          if (saveFails) throw new HaloStateConflictError("Concurrent update");
          const mutation = await mutator(structuredClone(state));
          state = mutation.state;
          return { ...mutation, updatedAt: "revision-2" };
        },
      };
      return {};
    },
    fetch: async (url, options) => {
      const method = url.split("/").at(-1);
      calls.push({ method, body: options.body && JSON.parse(options.body) });
      assert.ok(options.signal, "Telegram requests must be bounded");
      if (method === "getUpdates") return Response.json({ ok: true, result: updates ?? [
        { message: { text: "/mezana_olib@halo_bot", chat: { id: -1001, type: "supergroup", title: "Borrowed" }, message_thread_id: 7 } },
        { message: { text: "/mezana_sotib", chat: { id: -1002, type: "supergroup", title: "Purchased" }, message_thread_id: 11 } },
      ] });
      assert.equal(method, "sendMessage");
      assert.ok(state.mezanaSettings.telegramChatId || state.mezanaSettings.purchasedTelegramChatId,
        "the destination must be saved before Telegram gets a connected message");
      return notificationFails
        ? Response.json({ ok: false, description: "Not enough rights to send messages" }, { status: 403 })
        : Response.json({ ok: true, result: {} });
    },
  });
  return {
    state: () => JSON.parse(JSON.stringify(state)), calls,
    async post(body) {
      const response = await exports.POST(new Request("https://example.test/api/telegram", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId: "second-branch", ...body }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test("both MEZANA destinations persist separately with their topics and preserve accounting rows", async () => {
  const app = setup();
  const before = app.state();
  for (const destination of ["borrowed", "purchased"]) {
    const response = await app.post({ action: "discover-mezana", mezanaDestination: destination });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.updatedAt, "revision-2");
  }
  assert.deepEqual(app.state().mezanaSettings, {
    telegramChatId: "-1001", telegramChatName: "Borrowed", telegramThreadId: 7,
    purchasedTelegramChatId: "-1002", purchasedTelegramChatName: "Purchased", purchasedTelegramThreadId: 11,
  });
  assert.deepEqual(app.state().transactions, before.transactions);
  assert.deepEqual(app.state().mezanaEntries, before.mezanaEntries);
  assert.deepEqual(app.calls.filter((call) => call.method === "save").map((call) => call.branchId), ["second-branch", "second-branch"]);
  assert.deepEqual(app.calls.filter((call) => call.method === "sendMessage").map((call) => call.body.message_thread_id), [7, 11]);
});

test("Telegram notification failure keeps the confirmed link and returns a warning", async () => {
  const app = setup({ notificationFails: true });
  const response = await app.post({ action: "discover-mezana", mezanaDestination: "purchased" });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.match(response.body.warning, /Guruh saqlandi/);
  assert.equal(app.state().mezanaSettings.purchasedTelegramChatId, "-1002");
});

test("a failed database save cannot send a false connected notification", async () => {
  const app = setup({ saveFails: true });
  const response = await app.post({ action: "discover-mezana", mezanaDestination: "borrowed" });
  assert.equal(response.status, 409);
  assert.equal(app.calls.some((call) => call.method === "sendMessage"), false);
  assert.equal(app.state().mezanaSettings.telegramChatId, "");
});

test("manual group edits update only that destination and can unlink it", async () => {
  const app = setup();
  await app.post({ action: "discover-mezana", mezanaDestination: "borrowed" });
  await app.post({ action: "save-mezana", mezanaDestination: "purchased", chatId: "-1003" });
  assert.equal(app.state().mezanaSettings.telegramThreadId, 7);
  assert.equal(app.state().mezanaSettings.purchasedTelegramChatId, "-1003");
  const cleared = await app.post({ action: "save-mezana", mezanaDestination: "purchased", chatId: "" });
  assert.equal(cleared.body.ok, true);
  assert.equal(app.state().mezanaSettings.purchasedTelegramChatId, "");
  assert.equal(app.state().mezanaSettings.telegramChatId, "-1001");
  assert.equal((await app.post({ action: "save-mezana", mezanaDestination: "borrowed", chatId: "123" })).status, 400);
});

test("unauthorized or unmatched discovery never changes a destination", async () => {
  const denied = setup({ authorized: false });
  assert.equal((await denied.post({ action: "discover-mezana" })).status, 401);
  assert.equal(denied.calls.length, 0);
  const missing = setup({ updates: [] });
  assert.equal((await missing.post({ action: "discover-mezana" })).status, 400);
  assert.equal(missing.calls.some((call) => call.method === "save"), false);
});
