import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { performancePlans, performanceRuns, projects, requirementDocs, requirements, testCases, testTraceability } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { redact } from "@/lib/ai";
import { checkTarget, PerformancePlanSchema } from "@/lib/performance";
import { allowedOrigins } from "@/lib/performanceRunner";
import { authorize } from "@/lib/agentAuth";
import { failStalePerformanceRuns } from "@/lib/performanceService";
import { projectAllowed, projectDeny, planProjectId } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorize(req, "performance:read");
  if ("response" in auth) return auth.response;
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return fail("projectId required");
  if (!projectAllowed(auth.actor, projectId)) return projectDeny();
  const db = await getDb();
  await failStalePerformanceRuns(db);
  const cases = await db.select({ id: testCases.id, caseKey: testCases.caseKey, title: testCases.title, category: testCases.category }).from(testCases).where(eq(testCases.projectId, projectId));
  const docs = await db.select({ id: requirementDocs.id, name: requirementDocs.name }).from(requirementDocs).where(eq(requirementDocs.projectId, projectId));
  const reqs = docs.length ? await db.select().from(requirements).where(inArray(requirements.docId, docs.map((d) => d.id))) : [];
  const links = cases.length ? await db.select().from(testTraceability).where(inArray(testTraceability.testCaseId, cases.map((c) => c.id))) : [];
  const plans = await db.select().from(performancePlans).where(eq(performancePlans.projectId, projectId));
  const runs = plans.length ? await db.select().from(performanceRuns).where(inArray(performanceRuns.planId, plans.map((p) => p.id))) : [];
  return ok({ cases: cases.map((c) => ({ ...c, requirementIds: links.filter((l) => l.testCaseId === c.id).map((l) => l.requirementId) })), docs, requirements: reqs.map((r) => ({ id: r.id, docId: r.docId, reqKey: r.reqKey, text: r.text, acceptance: r.acceptance })), plans, runs: runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()) });
}

async function validate(projectId: string, caseId: string, raw: unknown) {
  if (!projectId || !caseId) throw new Error("Project and test scenario are required.");
  const db = await getDb();
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  const [tc] = await db.select({ id: testCases.id, projectId: testCases.projectId }).from(testCases).where(eq(testCases.id, caseId));
  if (!project || !tc || tc.projectId !== projectId) throw new Error("Project and test scenario must match.");
  const plan = PerformancePlanSchema.parse(raw);
  if (redact(plan.jsonBody).redactions > 0) throw new Error("Potential sensitive data in JSON body; use synthetic fixtures only.");
  checkTarget(plan.url, allowedOrigins());
  const docs = await db.select({ id: requirementDocs.id }).from(requirementDocs).where(eq(requirementDocs.projectId, projectId));
  const reqs = docs.length ? await db.select({ id: requirements.id }).from(requirements).where(inArray(requirements.docId, docs.map((d) => d.id))) : [];
  const ids = new Set(reqs.map((r) => r.id));
  if (new Set(plan.requirementIds).size !== plan.requirementIds.length || plan.requirementIds.some((id) => !ids.has(id))) throw new Error("Requirement IDs must be unique and belong to the project.");
  return { db, plan };
}

export async function POST(req: Request) {
  const auth = await authorize(req, "performance:plan");
  if ("response" in auth) return auth.response;
  try {
    const b = await body<{ projectId: string; caseId: string; plan: unknown }>(req);
    if (b.projectId && !projectAllowed(auth.actor, b.projectId)) return projectDeny();
    const { db, plan } = await validate(b.projectId, b.caseId, b.plan);
    const [row] = await db.insert(performancePlans).values({ projectId: b.projectId, caseId: b.caseId, config: plan }).returning();
    return ok(row, 201);
  } catch (e) { return fail(e instanceof Error ? e.message : "Invalid plan"); }
}

export async function PUT(req: Request) {
  const auth = await authorize(req, "performance:plan");
  if ("response" in auth) return auth.response;
  try {
    const b = await body<{ id: string; caseId?: string; plan: unknown }>(req);
    const db = await getDb();
    const [existing] = await db.select().from(performancePlans).where(eq(performancePlans.id, b.id));
    if (!existing) return fail("Plan not found", 404);
    if (!projectAllowed(auth.actor, existing.projectId)) return projectDeny();
    const caseId = existing.caseId ?? b.caseId ?? "";
    const { plan } = await validate(existing.projectId, caseId, b.plan);
    const [row] = await db.update(performancePlans).set({ caseId, config: plan, updatedAt: new Date() }).where(eq(performancePlans.id, b.id)).returning();
    return ok(row);
  } catch (e) { return fail(e instanceof Error ? e.message : "Invalid plan"); }
}

export async function DELETE(req: Request) {
  const auth = await authorize(req, "performance:plan");
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id required");
  const db = await getDb();
  const pid = await planProjectId(db, id);
  if (!pid || !projectAllowed(auth.actor, pid)) return projectDeny();
  const [active] = await db.select({ id: performanceRuns.id }).from(performanceRuns).where(and(eq(performanceRuns.planId, id), eq(performanceRuns.status, "running"))).limit(1);
  if (active) return fail("Cancel the active run before deleting its plan.", 409);
  await db.delete(performancePlans).where(eq(performancePlans.id, id));
  return ok();
}
