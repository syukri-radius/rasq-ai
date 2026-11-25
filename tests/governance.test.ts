import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { eq } from "drizzle-orm";

// Point the app at an isolated database BEFORE any module reads RASQ_DB_URL.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasq-gov-test-"));
process.env.RASQ_DB_URL = `file:${path.join(dir, "test.db")}`;
process.env.RASQ_AGENT_DAILY_MUTATIONS = "0"; // server-wide default stays unlimited; per-key budgets are exercised explicitly

type AgentAuth = typeof import("../src/lib/agentAuth");
type DbMod = typeof import("../src/db");
let agentAuth: AgentAuth;
let getDb: DbMod["getDb"];
let schema: typeof import("../src/db/schema");

before(async () => {
  ({ getDb, schema } = await import("../src/db"));
  agentAuth = await import("../src/lib/agentAuth");
});

const req = (method: string, pathName: string, headers: Record<string, string> = {}) =>
  new Request(`http://test.local${pathName}`, { method, headers });
const jsonReq = (url: string, data: unknown, method = "POST", headers: Record<string, string> = {}) =>
  new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

async function mint(name: string, scopes: string[], extra: Partial<typeof schema.apiKeys.$inferInsert> = {}) {
  const { key, keyPrefix, keyHash } = agentAuth.generateApiKey();
  const db = await getDb();
  const [row] = await db.insert(schema.apiKeys).values({ name, keyHash, keyPrefix, scopes, ...extra }).returning();
  return { key, row };
}

async function makeProject(name: string) {
  const db = await getDb();
  const [p] = await db.insert(schema.projects).values({ name, surface: "web", targetUrl: "http://127.0.0.1/demo-target" }).returning();
  return p;
}

test("migration 0006 adds api_keys columns and usage_counters", async () => {
  const db = await getDb();
  await db.select({ projectIds: schema.apiKeys.projectIds, dailyMutationLimit: schema.apiKeys.dailyMutationLimit }).from(schema.apiKeys);
  await db.select().from(schema.usageCounters);
});

test("project-partitioned key is filtered on project list and 404s on foreign artifacts", async () => {
  const projA = await makeProject("Gov Allowed");
  const projB = await makeProject("Gov Foreign");
  const { key } = await mint("partition-agent", ["projects:read", "tests:read", "projects:write"], { projectIds: [projA.id] });

  const listRes = await import("../src/app/api/projects/route");
  const list = await (await listRes.GET(req("GET", "/api/projects", bearer(key)))).json();
  assert.ok(list.some((p: { id: string }) => p.id === projA.id));
  assert.ok(!list.some((p: { id: string }) => p.id === projB.id));

  // Foreign project artifacts answer 404 (indistinguishable from missing), even with the read scope.
  const testsRoute = await import("../src/app/api/tests/route");
  const foreign = await testsRoute.GET(req("GET", `/api/tests?projectId=${projB.id}`, bearer(key)));
  assert.equal(foreign.status, 404);
  const allowed = await testsRoute.GET(req("GET", `/api/tests?projectId=${projA.id}`, bearer(key)));
  assert.equal(allowed.status, 200);

  // Partitioned keys may not provision new projects.
  const deniedCreate = await listRes.POST(jsonReq("http://test.local/api/projects", { name: "sneaky" }, "POST", bearer(key)));
  assert.equal(deniedCreate.status, 403);
  assert.equal((await deniedCreate.json()).code, "scoped_key");

  // Unpartitioned keys see both projects (backward compatible default).
  const { key: allKey } = await mint("unpartitioned-agent", ["projects:read"]);
  const allList = await (await listRes.GET(req("GET", "/api/projects", bearer(allKey)))).json();
  assert.ok(allList.some((p: { id: string }) => p.id === projA.id));
  assert.ok(allList.some((p: { id: string }) => p.id === projB.id));
});

test("workflow-level partition guards foreign reads and deletes", async () => {
  const db = await getDb();
  const projA = await makeProject("Gov WF A");
  const projB = await makeProject("Gov WF B");
  const [wfB] = await db.insert(schema.workflows).values({ projectId: projB.id, name: "foreign-wf", n8n: { nodes: [], connections: {} } as never }).returning();
  const { key } = await mint("partition-wf-agent", ["workflows:read", "workflows:write", "delete:artifacts"], { projectIds: [projA.id] });
  const wfRoute = await import("../src/app/api/workflows/[id]/route");
  const res = await wfRoute.GET(req("GET", `http://test.local/api/workflows/${wfB.id}`, bearer(key)), { params: Promise.resolve({ id: wfB.id }) });
  assert.equal(res.status, 404);
  const del = await wfRoute.DELETE(req("DELETE", `http://test.local/api/workflows/${wfB.id}`, bearer(key)), { params: Promise.resolve({ id: wfB.id }) });
  assert.equal(del.status, 404);
  const stillThere = await db.select().from(schema.workflows).where(eq(schema.workflows.id, wfB.id));
  assert.equal(stillThere.length, 1);
});

test("per-key daily mutation budget is enforced with daily_budget_exceeded", async () => {
  const { key, row } = await mint("budget-agent", ["projects:write"], { dailyMutationLimit: 2 });
  const auth = () => agentAuth.authorize(jsonReq("http://test.local/api/projects", { name: `b-${Date.now()}-${Math.random()}` }, "POST", bearer(key)), "projects:write");
  const first = await auth();
  assert.ok(!("response" in first) || first.response.status !== 429);
  await agentAuth.authorize(jsonReq("http://test.local/api/projects", { name: `b2-${Date.now()}` }, "POST", bearer(key)), "projects:write");
  const third = await agentAuth.authorize(jsonReq("http://test.local/api/projects", { name: `b3-${Date.now()}` }, "POST", bearer(key)), "projects:write");
  if (!("response" in third)) assert.fail("expected a 429 response once the per-key daily budget is exhausted");
  assert.equal(third.response.status, 429);
  assert.equal((await third.response.json()).code, "daily_budget_exceeded");
  assert.equal(row.dailyMutationLimit, 2);
});

test("usage counters are persisted per key and GC'd by retention", async () => {
  const db = await getDb();
  const { row } = await mint("gc-agent", ["projects:write"], { dailyMutationLimit: 100 });
  const { consumeAgentMutationBudget, pruneUsageCounters } = await import("../src/lib/rateLimit");
  await consumeAgentMutationBudget(db, row.id);
  const before = await db.select().from(schema.usageCounters).where(eq(schema.usageCounters.keyId, row.id));
  assert.ok(before.length >= 1);
  // Simulate stale minute buckets (>2 days old) and stale day buckets (>400 days).
  await db.insert(schema.usageCounters).values({ keyId: row.id, period: "minute", bucket: "1000", count: 5 });
  await db.insert(schema.usageCounters).values({ keyId: row.id, period: "day", bucket: "2020-01-01", count: 5 });
  const pruned = await pruneUsageCounters(db);
  assert.ok(pruned >= 2);
  const after = await db.select().from(schema.usageCounters).where(eq(schema.usageCounters.keyId, row.id));
  assert.ok(!after.some((r) => r.bucket === "1000" || r.bucket === "2020-01-01"));
});

test("audit query API is operator-only, filters, and CSV-escapes formula cells", async () => {
  const audit = await import("../src/lib/audit");
  await audit.recordAudit({ actorType: "agent", actorId: "audit-target-key", actorName: "audit-target", action: "POST /api/tests", status: "ok", detail: "=cmd|'/c calc'!A0 formula-attempt", ip: "203.0.113.9" });
  const route = await import("../src/app/api/audit/route");

  // Agent with every read scope still cannot read the audit log.
  const { key } = await mint("audit-agent", ["projects:read", "runs:read"]);
  const denied = await route.GET(req("GET", "http://test.local/api/audit", bearer(key)));
  assert.equal(denied.status, 403);

  // Operator JSON query with filters.
  const filtered = await route.GET(req("GET", "http://test.local/api/audit?actorId=audit-target-key&status=ok"));
  assert.equal(filtered.status, 200);
  const json = await filtered.json();
  assert.ok(json.total >= 1);
  assert.ok(json.rows.every((r: { actorId: string }) => r.actorId === "audit-target-key"));

  // CSV export prefixes formula-leading cells with a quote and reports counts.
  const csv = await route.GET(req("GET", "http://test.local/api/audit?actorId=audit-target-key&format=csv"));
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  assert.equal(csv.headers.get("x-returned-count"), "1");
  const body = await csv.text();
  assert.match(body, /"'=cmd/); // leading ' neutralizes the spreadsheet formula
});

test("retention sweep deletes only rows past their windows", async () => {
  const db = await getDb();
  const retention = await import("../src/lib/retention");
  const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  await db.insert(schema.auditLog).values({ actorType: "agent", actorId: "old-row", actorName: "old", action: "POST /api/tests", status: "ok", createdAt: old });
  const [fresh] = await db.insert(schema.auditLog).values({ actorType: "agent", actorId: "fresh-row", actorName: "fresh", action: "POST /api/tests", status: "ok" }).returning();
  await db.insert(schema.idempotencyKeys).values({ actor: "old-actor", key: "old-key", endpoint: "POST /api/tests", bodyHash: "x", status: 200, response: "{}", createdAt: old });
  const [hook] = await db.insert(schema.webhooks).values({ name: "retention-hook", url: "http://127.0.0.1:1/hook", secret: "whsec_retentiontestsecretvalue000000000000", events: ["webhook.test"] }).returning();
  await db.insert(schema.webhookDeliveries).values({ webhookId: hook.id, eventType: "webhook.test", status: "ok", createdAt: old });
  const result = await retention.runRetentionSweep(db);
  assert.ok(result.auditDeleted >= 1);
  assert.ok(result.idempotencyDeleted >= 1);
  assert.ok(result.deliveriesDeleted >= 1);
  const freshLeft = await db.select().from(schema.auditLog).where(eq(schema.auditLog.actorId, "fresh-row"));
  assert.equal(freshLeft.length, 1);
  void fresh;
});

test("agent-keys API accepts partition and budget, and surfaces them in list", async () => {
  const route = await import("../src/app/api/agent-keys/route");
  const proj = await makeProject("Gov KeyProject");
  const created = await route.POST(jsonReq("http://test.local/api/agent-keys", { name: "partitioned-key", scopes: ["projects:read"], projectIds: [proj.id], dailyMutationLimit: 42 }));
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.deepEqual(body.projectIds, [proj.id]);
  assert.equal(body.dailyMutationLimit, 42);
  const list = await (await route.GET(req("GET", "http://test.local/api/agent-keys"))).json();
  const listed = list.find((k: { id: string }) => k.id === body.id);
  assert.ok(listed);
  assert.deepEqual(listed.projectIds, [proj.id]);
  assert.equal(listed.dailyMutationLimit, 42);
});
