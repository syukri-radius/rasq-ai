import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runs, workflows } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { startRun, failStaleRuns } from "@/lib/runner";
import { failStaleDesktopRuns } from "@/lib/desktopService";
import { authorize } from "@/lib/agentAuth";
import { beginIdempotency } from "@/lib/idempotency";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorize(req, "runs:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  await failStaleDesktopRuns(db);
  await failStaleRuns(db);
  const wid = new URL(req.url).searchParams.get("workflowId");
  return ok(wid ? await db.select().from(runs).where(eq(runs.workflowId, wid)).orderBy(desc(runs.startedAt)).limit(20) : await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(50));
}

export async function POST(req: Request) {
  try {
    const db = await getDb();
    await failStaleRuns(db);
    const b = await body<{ workflowId: string; mode?: "playwright" | "dry-run"; targetUrl?: string }>(req);
    if (!b.workflowId) return fail("workflowId required");
    const mode = b.mode === "dry-run" ? "dry-run" : "playwright";
    // Execution scope is mode-aware: dry-run validates only, playwright drives a real browser.
    const auth = await authorize(req, mode === "dry-run" ? "runs:start:dry-run" : "runs:start:playwright");
    if ("response" in auth) return auth.response;
    const idem = await beginIdempotency(req, auth.actor, "POST /api/runs", b);
    if (idem instanceof NextResponse) return idem;
    const [w] = await db.select().from(workflows).where(eq(workflows.id, b.workflowId));
    if (!w) return fail("Workflow not found", 404);
    const open = (w.n8n.nodes as { type: string; parameters: { url?: string } }[]).find((n) => n.type === "rasq-ai.openTarget");
    const id = await startRun(b.workflowId, mode, b.targetUrl || open?.parameters.url || "");
    const payload = { id };
    await idem.store(202, payload);
    return ok(payload, 202);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Run failed to start");
  }
}
