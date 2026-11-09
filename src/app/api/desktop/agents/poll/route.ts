import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { desktopAgents, runs } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { authenticateDesktopAgent } from "@/lib/desktopAuth";
import { DesktopAgentPollSchema, DESKTOP_LIMITS, DESKTOP_PROTOCOL_VERSION, type DesktopAssignment } from "@/lib/desktopContract";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const db = await getDb();
  const agent = await authenticateDesktopAgent(req, db);
  if (!agent) return fail("Invalid or revoked desktop device credential", 401);
  try {
    const input = DesktopAgentPollSchema.parse(await body(req));
    if (agent.protocolVersion !== DESKTOP_PROTOCOL_VERSION) return fail("Desktop protocol version mismatch; upgrade the agent.", 426);
    if (input.currentRunId && agent.currentRunId && input.currentRunId !== agent.currentRunId) return fail("Agent current run does not match control-plane assignment.", 409);
    await db.update(desktopAgents).set({ agentVersion: input.agentVersion, capabilities: input.capabilities, displays: input.displays, permissions: input.permissions, lastHeartbeatAt: new Date(), availability: input.currentRunId ? "busy" : "idle", currentRunId: input.currentRunId }).where(eq(desktopAgents.id, agent.id));
    const [run] = await db.select().from(runs).where(and(eq(runs.executor, "robotjs-desktop"), eq(runs.desktopAgentId, agent.id), inArray(runs.status, ["pending", "running"]))).orderBy(desc(runs.startedAt)).limit(1);
    const assignment: DesktopAssignment | null = run ? {
      runId: run.id,
      mode: run.mode === "dry-run" ? "dry-run" : "attended",
      state: run.desktopSessionState,
      nextSequence: run.desktopLastEventSeq + 1,
      confirmed: Boolean(run.desktopConfirmedAt),
      cancelRequested: run.desktopCancelRequested,
    } : null;
    return ok({ pollAfterMs: DESKTOP_LIMITS.pollMs, assignment, serverTime: new Date().toISOString() });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid desktop poll");
  }
}
