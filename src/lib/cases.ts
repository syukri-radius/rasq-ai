import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { requirementDocs, requirements, testCases, testTraceability } from "@/db/schema";

export async function loadCases(projectId: string) {
  const db = await getDb();
  const cases = await db.select().from(testCases).where(eq(testCases.projectId, projectId));
  const docs = await db.select().from(requirementDocs).where(eq(requirementDocs.projectId, projectId));
  const reqs = docs.length ? await db.select().from(requirements).where(inArray(requirements.docId, docs.map((d) => d.id))) : [];
  const tr = cases.length ? await db.select().from(testTraceability).where(inArray(testTraceability.testCaseId, cases.map((c) => c.id))) : [];
  const keyById = new Map(reqs.map((r) => [r.id, r.reqKey]));
  return {
    reqs,
    cases: cases
      .map((c) => ({ ...c, requirementKeys: tr.filter((t) => t.testCaseId === c.id).map((t) => keyById.get(t.requirementId) ?? "?") }))
      .sort((a, b) => a.caseKey.localeCompare(b.caseKey)),
  };
}
