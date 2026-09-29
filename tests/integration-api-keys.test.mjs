import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import {
  ApiKeyLimitError,
  MAX_ACTIVE_API_KEYS,
  authenticateApiKey,
  createApiKey,
  ensureIntegrationTables,
  listApiKeys,
  revokeApiKey,
} from "../app/lib/integration-store.ts";

// Execute the production queries against SQLite, using the D1 response shape.
const database = new DatabaseSync(":memory:");
globalThis.__HALO_CONTROL_DB__ = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return database.prepare(sql).get(...values) ?? null; },
      async all() { return { results: database.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(database.prepare(sql).run(...values).changes) } }; },
    };
  },
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  },
};
await ensureIntegrationTables();
beforeEach(() => database.exec("DELETE FROM integration_api_keys"));
after(() => { database.close(); delete globalThis.__HALO_CONTROL_DB__; });

function seedKeys(count, branchId = "main") {
  const insert = database.prepare(`INSERT INTO integration_api_keys
    (id, branch_id, name, key_prefix, key_hash, permissions, active, created_at)
    VALUES (?, ?, 'Existing connection', 'hidden', ?, '["health:read"]', 1, '2026-09-01')`);
  for (let index = 0; index < count; index++) insert.run(`${branchId}-${index}`, branchId, `${branchId}-hash-${index}`);
}

test("an owner with ten active keys can create an eleventh without changing existing keys", async () => {
  seedKeys(10);
  const before = await listApiKeys();
  const created = await createApiKey("New report", ["health:read"], "main");
  const after = await listApiKeys();
  assert.equal(after.filter((key) => key.active).length, 11);
  assert.deepEqual(after.filter((key) => key.id !== created.id), before);
  const stored = database.prepare("SELECT key_hash, permissions FROM integration_api_keys WHERE id = ?").get(created.id);
  assert.match(stored.key_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.key_hash, created.key);
  const request = new Request("https://example.test/api/pos/v1/health", { headers: { Authorization: `Bearer ${created.key}` } });
  assert.equal((await authenticateApiKey(request, "health:read"))?.id, created.id);
  assert.equal(await authenticateApiKey(request, "sales:write"), null);
});

test("concurrent creation cannot exceed the per-branch limit", async () => {
  assert.equal(MAX_ACTIVE_API_KEYS, 50);
  seedKeys(MAX_ACTIVE_API_KEYS - 1);
  const results = await Promise.allSettled([
    createApiKey("Report A", ["reports:read"]),
    createApiKey("Report B", ["reports:read"]),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const failed = results.find((result) => result.status === "rejected");
  assert.ok(failed.reason instanceof ApiKeyLimitError);
  assert.equal((await listApiKeys()).filter((key) => key.active).length, MAX_ACTIVE_API_KEYS);
  const otherBranch = await createApiKey("Branch report", ["reports:read"], "second");
  assert.equal(otherBranch.branchId, "second");
});

test("revoking a selected key frees one slot only in its own branch", async () => {
  seedKeys(MAX_ACTIVE_API_KEYS);
  assert.equal(await revokeApiKey("main-0", "second"), false);
  await assert.rejects(createApiKey("Report", ["reports:read"]), ApiKeyLimitError);
  assert.equal(await revokeApiKey("main-0", "main"), true);
  await createApiKey("Replacement", ["reports:read"]);
  const keys = await listApiKeys();
  assert.equal(keys.filter((key) => key.active).length, MAX_ACTIVE_API_KEYS);
  assert.equal(keys.find((key) => key.id === "main-0").active, false);
});
