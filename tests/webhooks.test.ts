import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { before, test } from "node:test";
import { eq } from "drizzle-orm";

// Point the app at an isolated database BEFORE any module reads RASQ_DB_URL.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rasq-webhook-test-"));
process.env.RASQ_DB_URL = `file:${path.join(dir, "test.db")}`;

type DbMod = typeof import("../src/db");
type Webhooks = typeof import("../src/lib/webhooks");
let getDb: DbMod["getDb"];
let schema: typeof import("../src/db/schema");
let hooks: Webhooks;
let agentAuth: typeof import("../src/lib/agentAuth");

before(async () => {
  ({ getDb, schema } = await import("../src/db"));
  hooks = await import("../src/lib/webhooks");
  agentAuth = await import("../src/lib/agentAuth");
});

const jsonReq = (url: string, data: unknown, method = "POST", headers: Record<string, string> = {}) =>
  new Request(url, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });

async function makeReceiver(respond: (req: http.IncomingMessage, body: string) => { status: number; body?: string }) {
  const hits: { headers: http.IncomingMessage["headers"]; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      hits.push({ headers: req.headers, body });
      const { status, body: respBody } = respond(req, body);
      res.writeHead(status, { "content-type": "application/json" }).end(respBody ?? "{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/hook`, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("migration 0005 creates webhooks and webhook_deliveries", async () => {
  const db = await getDb();
  await db.select().from(schema.webhooks);
  await db.select().from(schema.webhookDeliveries);
});

test("secret, event id and envelope shapes", () => {
  assert.match(hooks.generateWebhookSecret(), /^whsec_[A-Za-z0-9_-]{30,}$/);
  const event = hooks.buildEvent("run.completed", { runId: "r1" });
  assert.match(event.id, /^evt_[0-9a-f-]{36}$/);
  assert.equal(event.type, "run.completed");
  assert.equal(event.data.runId, "r1");
  assert.ok(!Number.isNaN(Date.parse(event.createdAt)));
});

test("signWebhook / verifyWebhookSignature round-trip and rejection cases", () => {
  const secret = hooks.generateWebhookSecret();
  const ts = Math.floor(Date.now() / 1000);
  const rawBody = JSON.stringify({ id: "evt_x", type: "webhook.test" });
  const signature = hooks.signWebhook(secret, ts, rawBody);
  assert.match(signature, /^v1=[0-9a-f]{64}$/);
  assert.equal(hooks.verifyWebhookSignature({ secret, timestampSeconds: ts, rawBody, signature }), true);
  assert.equal(hooks.verifyWebhookSignature({ secret, timestampSeconds: ts, rawBody: rawBody + " ", signature }), false); // tampered body
  assert.equal(hooks.verifyWebhookSignature({ secret: hooks.generateWebhookSecret(), timestampSeconds: ts, rawBody, signature }), false); // wrong secret
  assert.equal(hooks.verifyWebhookSignature({ secret, timestampSeconds: ts - 1000, rawBody, signature, toleranceSeconds: 300 }), false); // stale
  assert.equal(createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex"), signature.slice(3)); // matches documented scheme
});

test("deliverWebhook signs the request, records the attempt and updates the endpoint", async () => {
  const db = await getDb();
  const receiver = await makeReceiver(() => ({ status: 200 }));
  {
    const secret = hooks.generateWebhookSecret();
    const [row] = await db.insert(schema.webhooks).values({ name: "test-ok", url: receiver.url, secret, events: ["webhook.test"] }).returning();
    const event = hooks.buildEvent("webhook.test", { hello: "world" });
    const result = await hooks.deliverWebhook(db, row, event, 1);
    assert.equal(result.ok, true);
    assert.equal(result.httpStatus, 200);
    assert.equal(receiver.hits.length, 1);
    const hit = receiver.hits[0];
    const ts = Number(hit.headers["x-rasq-webhook-timestamp"]);
    assert.ok(Number.isFinite(ts));
    assert.equal(hit.headers["x-rasq-webhook-id"], event.id);
    assert.ok(hooks.verifyWebhookSignature({ secret, timestampSeconds: ts, rawBody: hit.body, signature: String(hit.headers["x-rasq-signature"]) }));
    const deliveries = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, row.id));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].status, "ok");
    assert.equal(deliveries[0].attempt, 1);
    const [updated] = await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, row.id));
    assert.equal(updated.lastStatus, "ok");
    assert.ok(updated.lastDeliveryAt);
  }
  await receiver.close();
});

test("deliverWebhook records receiver failures without throwing", async () => {
  const db = await getDb();
  const receiver = await makeReceiver(() => ({ status: 500, body: '{"error":"boom"}' }));
  const secret = hooks.generateWebhookSecret();
  const [row] = await db.insert(schema.webhooks).values({ name: "test-fail", url: receiver.url, secret, events: ["webhook.test"] }).returning();
  const result = await hooks.deliverWebhook(db, row, hooks.buildEvent("webhook.test", {}), 2);
  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 500);
  const deliveries = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, row.id));
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "failed");
  assert.equal(deliveries[0].attempt, 2);
  assert.match(deliveries[0].error, /500/);
  const [updated] = await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, row.id));
  assert.equal(updated.lastStatus, "failed");
  await receiver.close();
});

test("notifyWebhooks fans out only to enabled endpoints subscribed to the event", async () => {
  const db = await getDb();
  const receiver = await makeReceiver(() => ({ status: 200 }));
  const secret = hooks.generateWebhookSecret();
  const [subscribed] = await db.insert(schema.webhooks).values({ name: "test-fanout-a", url: receiver.url, secret, events: ["run.completed"] }).returning();
  const [other] = await db.insert(schema.webhooks).values({ name: "test-fanout-b", url: receiver.url, secret, events: ["performance.run.completed"], enabled: true }).returning();
  hooks.notifyWebhooks(db, "run.completed", { runId: "r-fanout", status: "passed" });
  let rows: (typeof schema.webhookDeliveries.$inferSelect)[] = [];
  for (let i = 0; i < 40 && !rows.some((r) => r.webhookId === subscribed.id); i++) {
    await delay(100);
    rows = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, subscribed.id));
  }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventType, "run.completed");
  const otherRows = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, other.id));
  assert.equal(otherRows.length, 0);
  await receiver.close();
});

test("webhook API is operator-only and the secret is returned exactly once", async () => {
  const routes = await import("../src/app/api/webhooks/route");
  const secret = hooks.generateWebhookSecret();
  void secret;
  const agent = await agentAuth.generateApiKey();
  const db = await getDb();
  await db.insert(schema.apiKeys).values({ name: "webhook-agent", keyHash: agent.keyHash, keyPrefix: agent.keyPrefix, scopes: ["projects:read"] });
  const denied = await routes.POST(jsonReq("http://test.local/api/webhooks", { name: "n", url: "https://example.com/hook", events: ["run.completed"] }, "POST", { authorization: `Bearer ${agent.key}` }));
  assert.equal(denied.status, 403);
  const created = await routes.POST(jsonReq("http://test.local/api/webhooks", { name: "op-created", url: "https://example.com/hook", events: ["run.completed", "webhook.test"] }));
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.secret, /^whsec_/);
  assert.equal(body.events.length, 2);
  const list = await (await routes.GET(new Request("http://test.local/api/webhooks"))).json();
  const listed = list.find((w: { id: string }) => w.id === body.id);
  assert.ok(listed);
  assert.equal("secret" in listed, false);
  const remaining = await routes.DELETE(new Request(`http://test.local/api/webhooks?id=${body.id}`, { method: "DELETE" }));
  assert.equal(remaining.status, 200);
});

test("test-ping route delivers a signed webhook.test and reports the receiver outcome", async () => {
  const receiver = await makeReceiver(() => ({ status: 200 }));
  const db = await getDb();
  const secret = hooks.generateWebhookSecret();
  const [row] = await db.insert(schema.webhooks).values({ name: "test-ping", url: receiver.url, secret, events: ["webhook.test"] }).returning();
  const route = await import("../src/app/api/webhooks/[id]/test/route");
  const res = await route.POST(new Request(`http://test.local/api/webhooks/${row.id}/test`, { method: "POST" }), { params: Promise.resolve({ id: row.id }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.delivered, true);
  assert.equal(receiver.hits.length, 1);
  assert.equal(JSON.parse(receiver.hits[0].body).type, "webhook.test");
  await receiver.close();
});
