import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runs, workflows } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { startRun } from "@/lib/runner";
import { failStaleDesktopRuns } from "@/lib/desktopService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await getDb();
  await failStaleDesktopRuns(db);
  const wid = new URL(req.url).searchParams.get("workflowId");
  return ok(wid ? await db.select().from(runs).where(eq(runs.workflowId, wid)).orderBy(desc(runs.startedAt)).limit(20) : await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(50));
}

export async function POST(req: Request) {
  try {
    const db = await getDb();
    const b = await body<{ workflowId: string; mode?: "playwright" | "dry-run"; targetUrl?: string }>(req);
    if (!b.workflowId) return fail("workflowId required");
    const [w] = await db.select().from(workflows).where(eq(workflows.id, b.workflowId));
    if (!w) return fail("Workflow not found", 404);
    const open = (w.n8n.nodes as { type: string; parameters: { url?: string } }[]).find((n) => n.type === "rasq-ai.openTarget");
    const id = await startRun(b.workflowId, b.mode === "dry-run" ? "dry-run" : "playwright", b.targetUrl || open?.parameters.url || "");
    return ok({ id }, 202);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Run failed to start");
  }
}
