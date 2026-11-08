import { fail } from "@/lib/api";
import { loadCases } from "@/lib/cases";

export const dynamic = "force-dynamic";

const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const pid = u.searchParams.get("projectId");
  if (!pid) return fail("projectId required");
  const { cases } = await loadCases(pid);
  if (u.searchParams.get("format") === "csv") {
    const head = ["caseKey", "title", "category", "priority", "requirements", "preconditions", "testData", "steps", "expected", "assumptions", "provenance"];
    const rows = cases.map((c) => [c.caseKey, c.title, c.category, c.priority, c.requirementKeys.join(" "), c.preconditions.join(" | "), JSON.stringify(c.testData), c.steps.map((s) => `${s.order}. ${s.action} ${s.target}${s.data ? ` [${s.data}]` : ""}${s.expected ? ` => ${s.expected}` : ""}`).join(" | "), c.expected, c.assumptions.join(" | "), c.provenance].map(q).join(","));
    return new Response([head.join(","), ...rows].join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="rasq-ai-test-cases.csv"' } });
  }
  return new Response(JSON.stringify({ generator: "RASQ-Ai", testCases: cases.map(({ id, projectId, createdAt, ...c }) => { void id; void projectId; void createdAt; return c; }) }, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="rasq-ai-test-cases.json"' } });
}
