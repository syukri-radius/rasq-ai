import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "../src/db/schema";
import { analyze, checkTarget, criteriaFromRequirements, parseJtl, PerformancePlanSchema, renderJmx, type RequirementEvidence } from "../src/lib/performance";
import { cancelPerformanceRun, runJmeter } from "../src/lib/performanceRunner";

const plan = PerformancePlanSchema.parse({ name: "Synthetic", method: "POST", url: "http://127.0.0.1:8123/api/items", jsonBody: '{"item":"<safe>"}', threads: 2, rampUpSeconds: 2, durationSeconds: 5, thinkTimeMs: 400, requirementIds: [] });
const req = (id: string, text: string): RequirementEvidence => ({ id, docId: `doc-${id}`, docName: `SRS ${id}`, reqKey: `REQ-${id}`, text, acceptance: [] });

test("restricted plan rejects unsafe data and target, renders only known JMeter elements", () => {
  assert.equal(checkTarget(plan.url, ["http://127.0.0.1:8123"]).origin, "http://127.0.0.1:8123");
  for (const url of ["http://127.0.0.1:9999/api", "http://user:pass@127.0.0.1:8123/api", "http://127.0.0.1:8123/api?token=x", "file:///tmp/x"]) assert.throws(() => checkTarget(url, ["http://127.0.0.1:8123"]));
  assert.equal(PerformancePlanSchema.safeParse({ ...plan, jsonBody: '{"authorization":"secret"}' }).success, false);
  assert.equal(PerformancePlanSchema.safeParse({ ...plan, threads: 100 }).success, false);
  const jmx = renderJmx(plan);
  assert.match(jmx, /&lt;safe&gt;/);
  assert.match(jmx, /ConstantTimer.delay">400/);
  assert.match(jmx, /HTTPSampler.follow_redirects">false/);
  assert.doesNotMatch(jmx, /JSR223|BeanShell|ResultCollector|CookieManager/);
});

test("multiple documents retain provenance, conflicts and missing thresholds need review", () => {
  const a = req("1", "p95 latency <= 800 ms; error rate <= 0.5%; throughput >= 10 rps");
  const b = req("2", "p95 latency <= 900 ms");
  const { criteria, notes } = criteriaFromRequirements([a, b]);
  assert.equal(criteria.some((c) => c.metric === "p95Ms"), false);
  assert.match(notes.join(" "), /Conflicting p95Ms/);
  assert.equal(criteria.find((c) => c.metric === "errorPercent")?.source.includes("SRS 1"), true);
  const samples = Array.from({ length: 200 }, (_, i) => ({ timeStamp: i * 100, elapsed: 100, success: true }));
  assert.equal(analyze(samples, plan, [a, b]).status, "needs-review");
  const implicit = analyze(samples, plan, []);
  assert.equal(implicit.status, "needs-review");
  assert.deepEqual(implicit.summary.criteria.filter((c) => c.implicit).map((c) => c.limit), [1000, 1]);
  assert.match(implicit.summary.notes.join(" "), /No throughput SLA/);
  assert.equal(analyze([{ timeStamp: 0, elapsed: 1500, success: false }], plan, [a]).status, "failed");
  assert.equal(analyze([{ timeStamp: 0, elapsed: 100, success: true }], plan, [req("3", "p95 latency <= 800 ms; error rate <= 1%")]).status, "needs-review"); // insufficient confidence
});

test("JTL validates recorded samples and migration works on a fresh database", async () => {
  assert.deepEqual(parseJtl("timeStamp,elapsed,success\n1000,25,true\n1025,50,false\n"), [{ timeStamp: 1000, elapsed: 25, success: true }, { timeStamp: 1025, elapsed: 50, success: false }]);
  assert.throws(() => parseJtl("elapsed,success\n25,true"), /required CSV/);
  assert.throws(() => parseJtl("timeStamp,elapsed,success\n1000,NaN,true"), /Malformed/);
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [project] = await db.insert(schema.projects).values({ name: "Synthetic" }).returning();
  const [scenario] = await db.insert(schema.testCases).values({ projectId: project.id, caseKey: "TC-PERF", title: "Synthetic REST", category: "performance", priority: "P2", expected: "p95 <= 1000ms", provenance: "local" }).returning();
  const [saved] = await db.insert(schema.performancePlans).values({ projectId: project.id, caseId: scenario.id, config: plan }).returning();
  await db.insert(schema.performanceRuns).values({ planId: saved.id, status: "needs-review" });
  assert.equal((await db.select().from(schema.performanceRuns)).length, 1);
});

test("CLI fixture runs non-GUI, reads bounded JTL and cleans temporary files", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rasq-jmeter-test-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const binary = path.join(tmp, "jmeter-fixture");
  fs.writeFileSync(binary, '#!/bin/sh\n[ "$1" = "-n" ] || exit 2\n[ "$2" = "-t" ] || exit 3\n[ "$4" = "-l" ] || exit 4\nprintf "timeStamp,elapsed,success\\n1000,25,true\\n" > "$5"\n');
  fs.chmodSync(binary, 0o700);
  const old = process.env.RASQ_JMETER_ALLOWED_ORIGINS;
  process.env.RASQ_JMETER_ALLOWED_ORIGINS = "http://127.0.0.1:8123";
  t.after(() => { if (old === undefined) delete process.env.RASQ_JMETER_ALLOWED_ORIGINS; else process.env.RASQ_JMETER_ALLOWED_ORIGINS = old; });
  const id = crypto.randomUUID();
  assert.equal((await runJmeter(id, plan, binary)).length, 1);
  assert.equal(fs.existsSync(path.join(process.cwd(), "data/jmeter", id)), false);
});

test("CLI failure and cancellation are bounded, with no false performance result", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rasq-jmeter-error-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const old = process.env.RASQ_JMETER_ALLOWED_ORIGINS;
  process.env.RASQ_JMETER_ALLOWED_ORIGINS = "http://127.0.0.1:8123";
  t.after(() => { if (old === undefined) delete process.env.RASQ_JMETER_ALLOWED_ORIGINS; else process.env.RASQ_JMETER_ALLOWED_ORIGINS = old; });
  const bad = path.join(tmp, "bad");
  fs.writeFileSync(bad, "#!/bin/sh\nexit 7\n", { mode: 0o700 });
  await assert.rejects(() => runJmeter(crypto.randomUUID(), plan, bad), /exited with code 7/);
  const sleeper = path.join(tmp, "sleep");
  fs.writeFileSync(sleeper, "#!/bin/sh\nsleep 30\n", { mode: 0o700 });
  const id = crypto.randomUUID();
  const running = runJmeter(id, plan, sleeper);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(cancelPerformanceRun(id), true);
  await assert.rejects(running, /cancelled or timed out/);
  assert.equal(fs.existsSync(path.join(process.cwd(), "data/jmeter", id)), false);
});
