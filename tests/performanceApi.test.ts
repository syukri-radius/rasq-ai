import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { eq } from "drizzle-orm";

const jsonRequest = (url: string, data: unknown, method = "POST") => new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

test("create, update, approve, poll, analyze and report restricted REST plan", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rasq-performance-api-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const prev = { db: process.env.RASQ_DB_URL, allow: process.env.RASQ_JMETER_ALLOWED_ORIGINS, path: process.env.PATH };
  process.env.RASQ_DB_URL = `file:${path.join(tmp, "test.db")}`;
  process.env.RASQ_JMETER_ALLOWED_ORIGINS = "http://127.0.0.1:8123";
  process.env.PATH = `${tmp}:${prev.path}`;
  t.after(() => {
    if (prev.db === undefined) delete process.env.RASQ_DB_URL; else process.env.RASQ_DB_URL = prev.db;
    if (prev.allow === undefined) delete process.env.RASQ_JMETER_ALLOWED_ORIGINS; else process.env.RASQ_JMETER_ALLOWED_ORIGINS = prev.allow;
    process.env.PATH = prev.path;
  });
  fs.writeFileSync(path.join(tmp, "jmeter"), '#!/bin/sh\n[ "$1" = "-n" ] || exit 2\nprintf "timeStamp,elapsed,success\\n" > "$5"\ni=0\nwhile [ "$i" -lt 200 ]; do printf "%s,100,true\\n" "$((1000+i*100))" >> "$5"; i=$((i+1)); done\n', { mode: 0o700 });
  const { getDb } = await import("../src/db/index");
  const schema = await import("../src/db/schema");
  const plans = await import("../src/app/api/performance/route");
  const runs = await import("../src/app/api/performance/runs/route");
  const report = await import("../src/app/api/reports/route");
  const db = await getDb();
  const [project] = await db.select().from(schema.projects).limit(1);
  const [scenario] = await db.insert(schema.testCases).values({ projectId: project.id, caseKey: "TC-REST", title: "Synthetic API", category: "performance", priority: "P2", expected: "REST SLA", provenance: "local" }).returning();
  const [doc] = await db.insert(schema.requirementDocs).values({ projectId: project.id, name: "REST-SLA.txt", text: "REQ-API-1: p95 latency <= 1000 ms" }).returning();
  const [requirement] = await db.insert(schema.requirements).values({ docId: doc.id, reqKey: "REQ-API-1", text: "p95 latency <= 1000 ms", category: "performance" }).returning();
  const config = { name: "Mock REST load", method: "GET", url: "http://127.0.0.1:8123/api", jsonBody: "", threads: 1, rampUpSeconds: 1, durationSeconds: 5, thinkTimeMs: 400, requirementIds: [requirement.id] };
  const denied = await plans.POST(jsonRequest("http://localhost/api/performance", { projectId: project.id, caseId: scenario.id, plan: { ...config, url: "http://example.com/api" } }));
  assert.equal(denied.status, 400);
  const created = await plans.POST(jsonRequest("http://localhost/api/performance", { projectId: project.id, caseId: scenario.id, plan: config }));
  assert.equal(created.status, 201);
  const saved = await created.json();
  const updated = await plans.PUT(jsonRequest("http://localhost/api/performance", { id: saved.id, plan: { ...config, name: "Updated REST load" } }, "PUT"));
  assert.equal(updated.status, 200);
  const notApproved = await runs.POST(jsonRequest("http://localhost/api/performance/runs", { planId: saved.id }));
  assert.equal(notApproved.status, 400);
  const started = await runs.POST(jsonRequest("http://localhost/api/performance/runs", { planId: saved.id, confirm: true }));
  assert.equal(started.status, 202);
  const { id } = await started.json();
  let recorded;
  for (let i = 0; i < 30; i++) {
    recorded = await (await runs.GET(new Request(`http://localhost/api/performance/runs?id=${id}`))).json();
    if (recorded.status !== "running") break;
    await delay(50);
  }
  assert.equal(recorded.status, "needs-review");
  assert.equal(recorded.summary.count, 200);
  assert.match(recorded.summary.notes.join(" "), /No throughput SLA/);
  assert.equal(recorded.summary.requirementSnapshot[0].docName, doc.name);
  const [stored] = await db.select().from(schema.performancePlans).where(eq(schema.performancePlans.id, saved.id));
  assert.equal(stored.config.name, "Updated REST load");
  const generated = await report.POST(jsonRequest("http://localhost/api/reports", { projectId: project.id }));
  assert.equal(generated.status, 201);
  const markdown = (await generated.json()).markdown as string;
  assert.match(markdown, /## JSON REST load testing \(JMeter CLI\)/);
  assert.match(markdown, /Needs review: No throughput SLA/);
  await db.delete(schema.testCases).where(eq(schema.testCases.id, scenario.id));
  const [orphan] = await db.select().from(schema.performancePlans).where(eq(schema.performancePlans.id, saved.id));
  assert.equal(orphan.caseId, null);
  assert.equal((await db.select().from(schema.performanceRuns)).length, 1); // observed history survives regeneration
  assert.equal((await runs.POST(jsonRequest("http://localhost/api/performance/runs", { planId: saved.id, confirm: true }))).status, 409);
});
