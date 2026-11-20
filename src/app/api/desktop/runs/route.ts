import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { desktopAgents, runs, runSteps, workflows } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { DesktopTargetSchema, DESKTOP_LIMITS, DESKTOP_PROTOCOL_VERSION } from "@/lib/desktopContract";
import { compileStoredWorkflow, desktopBundlePath, failStaleDesktopRuns } from "@/lib/desktopService";
import type { N8nWorkflow } from "@/lib/n8n";
import { authorize } from "@/lib/agentAuth";
import { projectAllowed, projectDeny } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";
const CreateRunSchema = z.object({
  workflowId: z.string().uuid(),
  agentId: z.string().uuid(),
  mode: z.enum(["attended", "dry-run"]),
  target: DesktopTargetSchema,
}).strict();

export async function POST(req: Request) {
  const auth = await authorize(req, "desktop:attend");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  try {
    const input = CreateRunSchema.parse(await body(req));
    if (input.target.requireFocus && !input.target.windowTitle.trim()) return fail("An exact target window title is required when focus verification is enabled.");
    await failStaleDesktopRuns(db);
    const [agent] = await db.select().from(desktopAgents).where(eq(desktopAgents.id, input.agentId));
    if (!agent || agent.revokedAt) return fail("Select an enrolled, non-revoked desktop agent.", 404);
    if (agent.protocolVersion !== DESKTOP_PROTOCOL_VERSION) return fail("Desktop agent protocol is incompatible.", 409);
    if (Date.now() - agent.lastHeartbeatAt.getTime() > DESKTOP_LIMITS.staleAfterMs) return fail("Desktop agent is offline.", 409);
    if (agent.currentRunId || agent.availability !== "idle") return fail("Desktop agent is already assigned to a run.", 409);
    if (input.mode === "attended" && !agent.capabilities.supportsInput) return fail("This agent cannot dispatch real input on its current platform/driver.", 409);
    if (!agent.displays.some((d) => d.id === input.target.displayId)) return fail("The selected display is no longer reported by the agent; refresh capabilities.", 409);
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, input.workflowId));
    if (!workflow) return fail("Workflow not found", 404);
    if (!projectAllowed(auth.actor, workflow.projectId)) return projectDeny();
    const { compilation, bundle } = await compileStoredWorkflow(db, input.workflowId, input.target);
    const errors = compilation.diagnostics.filter((d) => d.severity === "error");
    if (!bundle || errors.length) return ok({ diagnostics: compilation.diagnostics, error: "Resolve blocking desktop compiler diagnostics before starting a run." }, 422);
    const [run] = await db.insert(runs).values({
      workflowId: workflow.id,
      mode: input.mode,
      status: "pending",
      targetUrl: "",
      executor: "robotjs-desktop",
      desktopAgentId: agent.id,
      desktopDriver: agent.capabilities.driver,
      desktopSessionState: "queued",
      desktopBundleSha256: bundle.sha256,
      desktopTarget: input.target,
    }).returning();
    const byId = new Map((workflow.n8n as N8nWorkflow).nodes.map((n) => [n.id, n.type]));
    await db.insert(runSteps).values(compilation.manifest.steps.map((step) => ({ runId: run.id, position: step.position, nodeId: step.nodeId, nodeName: step.nodeName, nodeType: byId.get(step.nodeId) ?? step.kind, status: "pending" })));
    const file = desktopBundlePath(run.id);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, bundle.bytes, { flag: "wx" });
    const reserved = await db.update(desktopAgents).set({ availability: "reserved", currentRunId: run.id }).where(and(eq(desktopAgents.id, agent.id), eq(desktopAgents.availability, "idle"), isNull(desktopAgents.currentRunId))).returning({ id: desktopAgents.id });
    if (!reserved.length) {
      await db.delete(runs).where(eq(runs.id, run.id));
      await fs.promises.rm(file, { force: true });
      return fail("Desktop agent was reserved by another run; retry after it becomes idle.", 409);
    }
    return ok({ id: run.id, diagnostics: compilation.diagnostics, bundleSha256: bundle.sha256 }, 202);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Desktop run could not be created");
  }
}
