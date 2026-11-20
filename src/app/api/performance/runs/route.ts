import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { performancePlans, performanceRuns, requirementDocs, requirements } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { redact } from "@/lib/ai";
import { analyze, checkTarget, PerformancePlanSchema, type PerformancePlan, type RequirementEvidence } from "@/lib/performance";
import { allowedOrigins, cancelPerformanceRun, runJmeter } from "@/lib/performanceRunner";
import { authorize } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function executeRun(db: Db, id: string, projectId: string, plan: PerformancePlan) {
  try {
    const docs = await db.select().from(requirementDocs).where(eq(requirementDocs.projectId, projectId));
    const selected = docs.length ? await db.select().from(requirements).where(inArray(requirements.docId, docs.map((d) => d.id))) : [];
    const wanted = new Set(plan.requirementIds);
    const reqs: RequirementEvidence[] = selected.filter((r) => wanted.has(r.id)).map((r) => ({ ...r, docName: docs.find((d) => d.id === r.docId)!.name }));
    const samples = await runJmeter(id, plan);
    const result = analyze(samples, plan, reqs);
    if (reqs.length !== wanted.size) {
      result.summary.notes.push("One or more selected source requirements were deleted before execution; needs review.");
      if (result.status === "passed") result.status = "needs-review";
    }
    await db.update(performanceRuns).set({ status: result.status, summary: result.summary, completedAt: new Date() }).where(eq(performanceRuns.id, id));
  } catch (e) {
    // Never persist CLI output, response bodies or user-controlled target details.
    const error = e instanceof Error && /already active|cancelled or timed out|not installed|no samples|exceeds 5 MB|lacks required CSV fields|Malformed JMeter sample|exceeds the sample limit|exited with code/.test(e.message) ? e.message : "JMeter execution or result analysis failed.";
    await db.update(performanceRuns).set({ status: "error", error, completedAt: new Date() }).where(eq(performanceRuns.id, id));
  }
}

export async function POST(req: Request) {
  const auth = await authorize(req, "performance:load");
  if ("response" in auth) return auth.response;
  const b = await body<{ planId: string; confirm: boolean }>(req);
  if (b.confirm !== true || !b.planId) return fail("Explicit confirmation and planId required before generating load.");
  const db = await getDb();
  const [saved] = await db.select().from(performancePlans).where(eq(performancePlans.id, b.planId));
  if (!saved) return fail("Plan not found", 404);
  if (!saved.caseId) return fail("Linked scenario was deleted; relink the plan before running.", 409);
  const parsed = PerformancePlanSchema.safeParse(saved.config);
  if (!parsed.success) return fail("Stored plan is invalid; edit it before running.");
  const plan = parsed.data;
  if (redact(plan.jsonBody).redactions > 0) return fail("Potential sensitive data in stored JSON body; edit the plan.");
  try { checkTarget(plan.url, allowedOrigins()); } catch { return fail("Target is not on the JMeter origin allowlist."); }
  const [run] = await db.insert(performanceRuns).values({ planId: saved.id }).returning();
  void executeRun(db, run.id, saved.projectId, plan);
  return ok({ id: run.id, status: "running" }, 202);
}

export async function GET(req: Request) {
  const auth = await authorize(req, "performance:read");
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id required");
  const db = await getDb();
  await db.update(performanceRuns).set({ status: "error", error: "Run interrupted or exceeded the server deadline.", completedAt: new Date() }).where(and(eq(performanceRuns.id, id), eq(performanceRuns.status, "running"), lt(performanceRuns.startedAt, new Date(Date.now() - 120_000))));
  const [run] = await db.select().from(performanceRuns).where(eq(performanceRuns.id, id));
  return run ? ok(run) : fail("Run not found", 404);
}

export async function DELETE(req: Request) {
  const auth = await authorize(req, "performance:load");
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id required");
  const db = await getDb();
  const [run] = await db.select().from(performanceRuns).where(eq(performanceRuns.id, id));
  if (!run || run.status !== "running") return fail("Active run not found", 404);
  if (!cancelPerformanceRun(id)) return fail("Run is not active in this server process.", 409);
  return ok({ cancelled: true });
}
