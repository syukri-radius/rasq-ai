import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

// Point the app at an isolated database BEFORE any module reads RASQ_DB_URL.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasq-agent-test-"));
process.env.RASQ_DB_URL = `file:${path.join(dir, "test.db")}`;

type AgentAuth = typeof import("../src/lib/agentAuth");
type Idempotency = typeof import("../src/lib/idempotency");
type DbMod = typeof import("../src/db");
let agentAuth: AgentAuth;
let idempotency: Idempotency;
let getDb: DbMod["getDb"];

before(async () => {
  ({ getDb } = await import("../src/db"));
  agentAuth = await import("../src/lib/agentAuth");
  idempotency = await import("../src/lib/idempotency");
});

const req = (method: string, pathName: string, headers: Record<string, string> = {}) =>
  new Request(`http://test.local${pathName}`, { method, headers });
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

async function mint(name: string, scopes: string[], extra: Partial<typeof schema.apiKeys.$inferInsert> = {}) {
  const { key, keyPrefix, keyHash } = agentAuth.generateApiKey();
  const db = await getDb();
  const [row] = await db.insert(schema.apiKeys).values({ name, keyHash, keyPrefix, scopes, ...extra }).returning();
  return { key, row };
}

async function expectDenied(p: Promise<{ actor: { kind: string } } | { response: Response }>, status: number) {
  const r = await p;
  if (!("response" in r)) assert.fail(`expected a ${status} response, got actor ${r.actor.kind}`);
  assert.equal(r.response.status, status);
}

test("agent surface migration creates key, audit and idempotency tables", async () => {
  const db = await getDb();
  await db.select().from(schema.apiKeys);
  await db.select().from(schema.auditLog);
  await db.select().from(schema.idempotencyKeys);
});

test("generateApiKey produces rasq_ keys whose sha256 hashes verify", () => {
  const { key, keyPrefix, keyHash } = agentAuth.generateApiKey();
  assert.match(key, /^rasq_[A-Za-z0-9_-]{20,}$/);
  assert.equal(agentAuth.hashApiKey(key), keyHash);
  assert.ok(key.startsWith(keyPrefix.slice(0, -1)));
  assert.ok(agentAuth.RECOMMENDED_AGENT_SCOPES.every((s) => (agentAuth.API_KEY_SCOPES as readonly string[]).includes(s)));
  assert.ok(!agentAuth.RECOMMENDED_AGENT_SCOPES.some((s) => s.startsWith("delete:") || s.includes("playwright") || s.includes("confirm") || s.includes("load") || s.includes("attend")));
});

test("operator (no Authorization header) passes scope checks and is audited on mutation", async () => {
  const res = await agentAuth.authorize(req("GET", "/api/projects"), "projects:read");
  assert.ok("actor" in res);
  assert.equal(res.actor.kind, "operator");
  const mut = await agentAuth.authorize(req("POST", "/api/tests"), "tests:generate");
  assert.ok("actor" in mut);
  const db = await getDb();
  const rows = await db.select().from(schema.auditLog);
  assert.ok(rows.some((r) => r.action === "POST /api/tests" && r.status === "ok" && r.actorType === "operator"));
});

test("agent with the scope is accepted; without it gets 403 and a denied audit row", async () => {
  const { key, row } = await mint("reader", ["tests:read"]);
  const okRes = await agentAuth.authorize(req("GET", "/api/tests", bearer(key)), "tests:read");
  assert.ok("actor" in okRes && okRes.actor.kind === "agent" && okRes.actor.id === row.id);
  const denied = await agentAuth.authorize(req("POST", "/api/tests", bearer(key)), "tests:generate");
  assert.ok("response" in denied);
  assert.equal(denied.response.status, 403);
  const body = (await denied.response.json()) as { code: string };
  assert.equal(body.code, "insufficient_scope");
  const db = await getDb();
  const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.actorId, row.id));
  assert.ok(rows.some((r) => r.status === "denied" && r.detail.includes("tests:generate")));
});

test("invalid, revoked and expired keys get 401, never operator fallback", async () => {
  await expectDenied(agentAuth.authorize(req("GET", "/api/projects", bearer("rasq_not-a-real-key-1234567890")), "projects:read"), 401);
  await expectDenied(agentAuth.authorize(req("GET", "/api/projects", { authorization: "Bearer sk-unrelated-format" }), "projects:read"), 401);
  const { key } = await mint("revoked", ["runs:read"], { revokedAt: new Date() });
  await expectDenied(agentAuth.authorize(req("GET", "/api/runs", bearer(key)), "runs:read"), 401);
  const { key: expiredKey } = await mint("expired", ["runs:read"], { expiresAt: new Date(Date.now() - 1000) });
  await expectDenied(agentAuth.authorize(req("GET", "/api/runs", bearer(expiredKey)), "runs:read"), 401);
});

test("mutating agent calls record an ok audit row with the key identity", async () => {
  const { key, row } = await mint("writer", ["workflows:write"]);
  const res = await agentAuth.authorize(req("POST", "/api/workflows", bearer(key)), "workflows:write");
  assert.ok("actor" in res);
  const db = await getDb();
  const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.actorId, row.id));
  assert.ok(rows.some((r) => r.status === "ok" && r.action === "POST /api/workflows"));
});

test("requireOperator rejects valid agents and accepts the operator path", async () => {
  const { key } = await mint("not-an-owner", ["settings:write"]);
  const denied = await agentAuth.requireOperator(req("POST", "/api/agent-keys", bearer(key)));
  assert.ok("response" in denied);
  assert.equal(denied.response.status, 403);
  const operator = await agentAuth.requireOperator(req("GET", "/api/agent-keys"));
  assert.ok("actor" in operator && operator.actor.kind === "operator");
});

test("Idempotency-Key replays 2xx responses and rejects body drift", async () => {
  const actor = { kind: "operator" } as const;
  const key = `test-${Date.now().toString(36)}-0001`;
  const body = { b: 2, a: 1 };
  const ctx = await idempotency.beginIdempotency(req("POST", "/api/tests", { "idempotency-key": key }), actor, "POST /api/tests", body);
  if (ctx instanceof Response) assert.fail("expected an idempotency context, got a replay response");
  await ctx.store(201, { count: 7 });
  const replay = await idempotency.beginIdempotency(req("POST", "/api/tests", { "idempotency-key": key }), actor, "POST /api/tests", { a: 1, b: 2 });
  assert.ok(replay instanceof Response);
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("idempotent-replay"), "true");
  assert.deepEqual(await replay.json(), { count: 7 });
  const conflict = await idempotency.beginIdempotency(req("POST", "/api/tests", { "idempotency-key": key }), actor, "POST /api/tests", { a: 1 });
  assert.ok(conflict instanceof Response);
  assert.equal(conflict.status, 409);
  assert.equal(((await conflict.json()) as { code: string }).code, "idempotency_conflict");
  const otherEndpoint = await idempotency.beginIdempotency(req("POST", "/api/runs", { "idempotency-key": key }), actor, "POST /api/runs", body);
  assert.ok(otherEndpoint instanceof Response && otherEndpoint.status === 409);
  const noHeader = await idempotency.beginIdempotency(req("POST", "/api/tests"), actor, "POST /api/tests", {});
  if (noHeader instanceof Response) assert.fail("expected passthrough context");
  await noHeader.store(201, { ok: true }); // no-op, must not throw
  const badKey = await idempotency.beginIdempotency(req("POST", "/api/tests", { "idempotency-key": "short" }), actor, "POST /api/tests", {});
  assert.ok(badKey instanceof Response && badKey.status === 400);
});

test("DB-backed agent rate limiter allows a full minute window then blocks, per key id", async () => {
  const db = await getDb();
  const { consumeAgentMutationBudget } = await import("../src/lib/rateLimit");
  const { keyHash, keyPrefix } = agentAuth.generateApiKey();
  const [row] = await db.insert(schema.apiKeys).values({ name: "ratelimit-agent", keyHash, keyPrefix, scopes: [] }).returning();
  for (let i = 0; i < 120; i++) {
    const r = await consumeAgentMutationBudget(db, row.id);
    assert.equal(r.ok, true, `call ${i} should be allowed`);
  }
  const blocked = await consumeAgentMutationBudget(db, row.id);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, "minute");
});
