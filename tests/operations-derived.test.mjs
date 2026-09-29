import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyOperationCompletion,
  buildOperationAlerts,
  dailyCloseHref,
  isDerivedOperationChecklistItem,
  operationChecklistView,
} from "../app/lib/operations.ts";

const chosenDate = "2026-08-20";
const closedAt = "2026-08-20T15:15:00.000Z";

const closingCash = (view) => view.phases
  .flatMap((phase) => phase.items)
  .find((item) => item.id === "closing-cash");

test("closing-cash ignores manual completion and follows the real daily close", () => {
  const manuallyCompleted = applyOperationCompletion([], {
    date: chosenDate,
    itemId: "closing-cash",
    completed: true,
    actor: "Rahbar",
    now: new Date("2026-08-20T14:00:00.000Z"),
  });

  const withoutClose = operationChecklistView(manuallyCompleted, chosenDate, []);
  assert.equal(closingCash(withoutClose).completed, false);
  assert.equal(closingCash(withoutClose).completion, null);

  const withClose = operationChecklistView(manuallyCompleted, chosenDate, [{
    id: "close-real",
    date: chosenDate,
    closedAt,
  }]);
  assert.equal(closingCash(withClose).completed, true);
  assert.equal(closingCash(withClose).completion.completedBy, "HALO Control");
  assert.equal(closingCash(withClose).completion.completedAt, closedAt);
});

test("daily-close derivation is date-specific and leaves other checklist items manual", () => {
  const days = applyOperationCompletion([], {
    date: chosenDate,
    itemId: "closing-cleaning",
    completed: true,
    actor: "Xurshidbek",
    workerId: "worker-x",
    now: new Date("2026-08-20T14:30:00.000Z"),
  });
  const view = operationChecklistView(days, chosenDate, [
    { id: "wrong-day", date: "2026-08-19", closedAt },
  ]);
  const closing = view.phases.find((phase) => phase.phase === "closing");
  assert.equal(closing.items.find((item) => item.id === "closing-cleaning").completed, true);
  assert.equal(closingCash(view).completed, false);
});

test("cash difference alert and rejected derived item share the dated finance deep link", () => {
  const expected = "/?tab=finance&date=2026-08-20#daily-close";
  assert.equal(dailyCloseHref(chosenDate), expected);
  assert.equal(isDerivedOperationChecklistItem("closing-cash"), true);
  assert.equal(isDerivedOperationChecklistItem("closing-cleaning"), false);

  const alerts = buildOperationAlerts({
    operationChecklistDays: [],
    workShifts: [],
    inventory: [],
    suppliers: [],
    dailyCloses: [{ id: "close-real", date: chosenDate, closedAt, difference: 500 }],
  }, chosenDate, new Date("2026-08-20T13:00:00.000Z"));
  assert.equal(alerts.find((alert) => alert.id === "cash-difference")?.href, expected);

  const routeSource = readFileSync(new URL("../app/api/operations/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /if \(isDerivedOperationChecklistItem\(itemId\)\)/);
  assert.match(routeSource, /href: dailyCloseHref\(date\)/);
  assert.match(routeSource, /status: 409/);
  assert.match(routeSource, /isAccountingMonthClosed\(state\.monthlyCloses, date\)/);
  assert.match(routeSource, /status: error\.status/);
});
