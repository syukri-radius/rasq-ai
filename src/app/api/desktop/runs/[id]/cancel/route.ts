import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { desktopAgents, runs, runSteps } from "@/db/schema";
import { fail, ok, type Params } from "@/lib/api";
import { authorize } from "@/lib/agentAuth";
import { notifyWebhooks, runCompletedData, loadRunForEvent } from "@/lib/webhooks";
import { projectAllowed, projectDeny, runProjectId } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "desktop:attend");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const db = await getDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (run) {
    const pid = await runProjectId(db, id);
    if (pid && !projectAllowed(auth.actor, pid)) return projectDeny();
  }
  if (!run || run.executor !== "robotjs-desktop") return fail("Desktop run not found", 404);
  if (!["pending", "running"].includes(run.status)) return ok({ cancelled: false, status: run.status });
  const queued = run.desktopSessionState === "queued";
  await db.update(runs).set({ desktopCancelRequested: true, ...(queued ? { status: "error", error: "Cancelled before desktop agent preflight.", desktopSessionState: "terminal", finishedAt: new Date(), summary: { error: 1 } } : {}) }).where(eq(runs.id, id));
  if (queued) {
    await db.update(runSteps).set({ status: "skipped", message: "Not executed: run cancelled before desktop preflight." }).where(and(eq(runSteps.runId, id), inArray(runSteps.status, ["pending", "running"])));
    if (run.desktopAgentId) await db.update(desktopAgents).set({ currentRunId: null, availability: "idle" }).where(eq(desktopAgents.id, run.desktopAgentId));
    try {
      const finished = await loadRunForEvent(db, id);
      if (finished) notifyWebhooks(db, "desktop.run.completed", runCompletedData(finished));
    } catch (e) {
      console.warn("desktop.run.completed webhook notification failed:", e instanceof Error ? e.message : e);
    }
  }
  return ok({ cancelled: true, acknowledged: queued });
}