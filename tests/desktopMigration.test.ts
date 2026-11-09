import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { applyDesktopEvents, failStaleDesktopRuns } from "../src/lib/desktopService";

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), "rasq-desktop-test-")); }
function database(file: string) { return drizzle(createClient({ url: `file:${file}` }), { schema }); }
function legacyMigrations(dir: string) {
  const target = path.join(dir, "legacy-drizzle");
  fs.mkdirSync(path.join(target, "meta"), { recursive: true });
  for (const name of ["0000_init.sql", "0001_ai_provider_protocol_config.sql", "meta/0000_snapshot.json", "meta/0001_snapshot.json"]) fs.copyFileSync(path.join(process.cwd(), "drizzle", name), path.join(target, name));
  const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 2);
  fs.writeFileSync(path.join(target, "meta", "_journal.json"), JSON.stringify(journal));
  return target;
}

async function migratedDb(dir: string, legacy = false) {
  const file = path.join(dir, "test.db");
  const db = database(file);
  if (legacy) await migrate(db, { migrationsFolder: legacyMigrations(dir) });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

async function baseRows(db: Awaited<ReturnType<typeof migratedDb>>) {
  const [project] = await db.insert(schema.projects).values({ name: "Migration fixture" }).returning();
  const [workflow] = await db.insert(schema.workflows).values({ projectId: project.id, name: "Fixture", n8n: { nodes: [], connections: {} } }).returning();
  return { project, workflow };
}

test("fresh and pre-0002 databases migrate with compatible defaults", async (t) => {
  for (const legacy of [false, true]) {
    const dir = temp();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const db = await migratedDb(dir, legacy);
    const { workflow } = await baseRows(db);
    const [run] = await db.insert(schema.runs).values({ workflowId: workflow.id }).returning();
    assert.equal(run.executor, "playwright");
    assert.deepEqual(run.desktopTarget, {});
    assert.equal(run.desktopLastEventSeq, 0);
    const agents = await db.select().from(schema.desktopAgents);
    assert.deepEqual(agents, []);
  }
});

test("desktop events are monotonic, idempotent, and grounded in run steps", async (t) => {
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = await migratedDb(dir);
  const { workflow } = await baseRows(db);
  const [agent] = await db.insert(schema.desktopAgents).values({ name: "Agent", tokenHash: "a".repeat(64), os: "linux", arch: "x64", agentVersion: "0.1.0", protocolVersion: "1", capabilities: { driver: "mock", supportsInput: true, actions: ["click"], platformNotes: [] }, permissions: { screenCapture: "granted", accessibility: "not-required", interactiveSession: "confirmed" }, lastHeartbeatAt: new Date() }).returning();
  const [run] = await db.insert(schema.runs).values({ workflowId: workflow.id, executor: "robotjs-desktop", desktopAgentId: agent.id, status: "running", desktopSessionState: "preflight" }).returning();
  await db.insert(schema.runSteps).values({ runId: run.id, position: 0, nodeId: "node-1", nodeName: "Click", nodeType: "rasq-ai.action" });
  await assert.rejects(() => applyDesktopEvents(db, agent.id, run.id, [{ seq: 2, type: "session", payload: { state: "running", message: "Gap" } }]), /sequence gap/);
  await assert.rejects(() => applyDesktopEvents(db, agent.id, run.id, [{ seq: 1, type: "step", payload: { nodeId: "unknown", status: "passed", message: "Bad", durationMs: 0, evidence: {} } }]), /unknown run step/);
  assert.equal((await db.select().from(schema.runs).where(eq(schema.runs.id, run.id)))[0].desktopLastEventSeq, 0);
  const events = [
    { seq: 1, type: "session", payload: { state: "running", message: "Running" } },
    { seq: 2, type: "step", payload: { nodeId: "node-1", status: "passed", message: "Observed click", durationMs: 10, evidence: { matchCount: 1 } } },
    { seq: 3, type: "complete", payload: { status: "passed", message: "Done", summary: { passed: 999 } } },
  ];
  assert.deepEqual(await applyDesktopEvents(db, agent.id, run.id, events), { accepted: 3, nextSequence: 4 });
  assert.deepEqual(await applyDesktopEvents(db, agent.id, run.id, events), { accepted: 0, nextSequence: 4 });
  const [saved] = await db.select().from(schema.runs).where(eq(schema.runs.id, run.id));
  assert.equal(saved.status, "passed");
  assert.equal(saved.desktopSessionState, "terminal");
  assert.deepEqual(saved.summary, { passed: 1 });
  assert.equal(saved.desktopLastEventSeq, 3);
  await assert.rejects(() => applyDesktopEvents(db, agent.id, run.id, [{ seq: 4, type: "session", payload: { state: "running", message: "Rewrite history" } }]), /terminal/);
  assert.equal((await db.select().from(schema.runs).where(eq(schema.runs.id, run.id)))[0].status, "passed");
});

test("stale or revoked agents fail active runs without inventing remaining evidence", async (t) => {
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = await migratedDb(dir);
  const { workflow } = await baseRows(db);
  const [agent] = await db.insert(schema.desktopAgents).values({ name: "Offline", tokenHash: "b".repeat(64), os: "win32", arch: "x64", agentVersion: "0.1.0", protocolVersion: "1", capabilities: { driver: "robotjs", supportsInput: true, actions: ["click"], platformNotes: [] }, permissions: { screenCapture: "unknown", accessibility: "unknown", interactiveSession: "unknown" }, lastHeartbeatAt: new Date(Date.now() - 60_000) }).returning();
  const [run] = await db.insert(schema.runs).values({ workflowId: workflow.id, executor: "robotjs-desktop", desktopAgentId: agent.id, status: "running", desktopSessionState: "running" }).returning();
  await db.insert(schema.runSteps).values({ runId: run.id, position: 0, nodeId: "node-1", nodeName: "Click", nodeType: "rasq-ai.action" });
  await failStaleDesktopRuns(db);
  const [saved] = await db.select().from(schema.runs).where(eq(schema.runs.id, run.id));
  const [step] = await db.select().from(schema.runSteps).where(eq(schema.runSteps.runId, run.id));
  assert.equal(saved.status, "error");
  assert.equal(saved.desktopSessionState, "terminal");
  assert.equal(step.status, "skipped");
});
