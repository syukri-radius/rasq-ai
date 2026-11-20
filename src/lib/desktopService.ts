import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { controls, desktopAgents, desktopEvents, runs, runSteps, screens, workflows } from "@/db/schema";
import { compileDesktopWorkflow, type DesktopCompilation } from "./desktopCompiler";
import { createDesktopBundle, type VerifiedDesktopBundle } from "./desktopBundle";
import {
  DesktopCompleteEventSchema,
  DesktopEventSchema,
  DesktopSessionEventSchema,
  DesktopStepEventSchema,
  DESKTOP_LIMITS,
  type DesktopEvent,
  type DesktopTarget,
} from "./desktopContract";
import { DATA_DIR } from "./runner";
import type { RunStatus } from "./types";
import { notifyWebhooks, runCompletedData, loadRunForEvent } from "./webhooks";

export const desktopBundlePath = (runId: string) => path.join(DATA_DIR, "desktop", "bundles", `${runId}.zip`);

export async function compileStoredWorkflow(db: Db, workflowId: string, target?: Partial<DesktopTarget>): Promise<{ compilation: DesktopCompilation; bundle: VerifiedDesktopBundle | null }> {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (!workflow) throw new Error("Workflow not found");
  const projectScreens = await db.select().from(screens).where(eq(screens.projectId, workflow.projectId));
  const projectControls = projectScreens.length ? await db.select().from(controls).where(inArray(controls.screenId, projectScreens.map((s) => s.id))) : [];
  const compilation = await compileDesktopWorkflow({
    workflow: { id: workflow.id, projectId: workflow.projectId, version: workflow.version, provenance: workflow.provenance, n8n: workflow.n8n as never },
    screens: projectScreens,
    controls: projectControls,
    target,
    readImage: async (screen) => {
      if (path.basename(screen.imagePath) !== screen.imagePath) throw new Error("Unsafe saved screen path");
      return fs.promises.readFile(path.join(DATA_DIR, "screens", screen.imagePath));
    },
  });
  return { compilation, bundle: compilation.diagnostics.some((d) => d.severity === "error") ? null : createDesktopBundle(compilation) };
}

export function publicDesktopAgent<T extends { tokenHash: string; lastHeartbeatAt: Date; revokedAt: Date | null }>(agent: T) {
  const { tokenHash: _secret, ...safe } = agent;
  return { ...safe, online: !agent.revokedAt && Date.now() - agent.lastHeartbeatAt.getTime() <= DESKTOP_LIMITS.staleAfterMs };
}

export async function failStaleDesktopRuns(db: Db): Promise<void> {
  const active = await db.select().from(runs).where(and(eq(runs.executor, "robotjs-desktop"), inArray(runs.status, ["pending", "running"])));
  for (const run of active) {
    if (!run.desktopAgentId) continue;
    const [agent] = await db.select().from(desktopAgents).where(eq(desktopAgents.id, run.desktopAgentId));
    const stale = !agent || agent.revokedAt || Date.now() - agent.lastHeartbeatAt.getTime() > DESKTOP_LIMITS.staleAfterMs;
    if (!stale) continue;
    const message = agent?.revokedAt ? "Desktop agent was revoked; the run cannot continue." : "Desktop agent heartbeat expired; remaining input and application state are unknown.";
    await db.update(runs).set({ status: "error", error: message, desktopSessionState: "terminal", finishedAt: new Date(), summary: { error: 1 } }).where(and(eq(runs.id, run.id), inArray(runs.status, ["pending", "running"])));
    await db.update(runSteps).set({ status: "skipped", message: "Not executed after the desktop agent became unavailable." }).where(and(eq(runSteps.runId, run.id), inArray(runSteps.status, ["pending", "running"])));
    if (agent) await db.update(desktopAgents).set({ availability: "idle", currentRunId: null }).where(eq(desktopAgents.id, agent.id));
    try {
      const finished = await loadRunForEvent(db, run.id);
      if (finished) notifyWebhooks(db, "desktop.run.completed", runCompletedData(finished));
    } catch (e) {
      console.warn("desktop.run.completed webhook notification failed:", e instanceof Error ? e.message : e);
    }
  }
}

const statusRank: RunStatus[] = ["error", "failed", "needs-review", "warning", "passed", "skipped"];

export async function applyDesktopEvents(db: Db, agentId: string, runId: string, input: unknown[]): Promise<{ accepted: number; nextSequence: number }> {
  if (input.length > DESKTOP_LIMITS.eventBatch) throw new Error("Desktop event batch exceeds 100 events.");
  const events = input.map((e) => DesktopEventSchema.parse(e));
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run || run.executor !== "robotjs-desktop" || run.desktopAgentId !== agentId) throw new Error("Desktop run is not assigned to this agent.");
  const fresh = events.filter((e) => e.seq > run.desktopLastEventSeq);
  if (!fresh.length) return { accepted: 0, nextSequence: run.desktopLastEventSeq + 1 };
  if (!["pending", "running"].includes(run.status)) throw new Error("Desktop run is terminal; new events are immutable.");
  let expected = run.desktopLastEventSeq + 1;
  for (const event of fresh) {
    if (event.seq !== expected) throw new Error(`Desktop event sequence gap: expected ${expected}, received ${event.seq}.`);
    expected += 1;
  }
  for (const event of fresh) await applyDesktopEvent(db, agentId, runId, event);
  return { accepted: fresh.length, nextSequence: expected };
}

async function applyDesktopEvent(db: Db, agentId: string, runId: string, event: DesktopEvent): Promise<void> {
  // Validate payloads and references before advancing the durable sequence.
  const session = event.type === "session" ? DesktopSessionEventSchema.parse(event.payload) : null;
  const stepPayload = event.type === "step" ? DesktopStepEventSchema.parse(event.payload) : null;
  const complete = event.type === "complete" ? DesktopCompleteEventSchema.parse(event.payload) : null;
  const step = stepPayload
    ? (await db.select().from(runSteps).where(and(eq(runSteps.runId, runId), eq(runSteps.nodeId, stepPayload.nodeId))))[0]
    : undefined;
  if (stepPayload && !step) throw new Error(`Desktop event references unknown run step "${stepPayload.nodeId}".`);

  await db.insert(desktopEvents).values({ runId, agentId, seq: event.seq, type: event.type, payload: event.payload as Record<string, unknown> });
  await db.update(runs).set({ desktopLastEventSeq: event.seq }).where(eq(runs.id, runId));
  if (session) {
    const [current] = await db.select().from(runs).where(eq(runs.id, runId));
    await db.update(runs).set({ desktopSessionState: session.state, status: session.state === "terminal" ? current.status : "running", error: session.state === "terminal" ? current.error : null }).where(eq(runs.id, runId));
    return;
  }
  if (stepPayload && step) {
    await db.update(runSteps).set({ status: stepPayload.status, message: stepPayload.message.slice(0, 1000), durationMs: stepPayload.durationMs, evidence: { ...step.evidence, ...stepPayload.evidence } }).where(eq(runSteps.id, step.id));
    return;
  }
  if (!complete) throw new Error("Unsupported desktop event.");
  const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId));
  const summary: Record<string, number> = {};
  for (const row of steps) summary[row.status] = (summary[row.status] ?? 0) + 1;
  const unfinished = steps.some((s) => s.status === "pending" || s.status === "running");
  const derived = statusRank.find((s) => steps.some((row) => row.status === s));
  const status = complete.status === "error" || unfinished ? "error" : derived ?? complete.status;
  const message = unfinished && complete.status !== "error" ? "Agent completed without terminal evidence for every step." : complete.message;
  await db.update(runs).set({ status, error: status === "error" ? message : null, summary, desktopSessionState: "terminal", finishedAt: new Date() }).where(eq(runs.id, runId));
  await db.update(desktopAgents).set({ availability: "idle", currentRunId: null }).where(eq(desktopAgents.id, agentId));
  try {
    const finished = await loadRunForEvent(db, runId);
    if (finished) notifyWebhooks(db, "desktop.run.completed", runCompletedData(finished));
  } catch (e) {
    console.warn("desktop.run.completed webhook notification failed:", e instanceof Error ? e.message : e);
  }
}
