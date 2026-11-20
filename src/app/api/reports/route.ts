import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { controls, performancePlans, performanceRuns, projects, reports, runs, screens, workflows } from "@/db/schema";
import { buildSystem, callModel, errMsg, parseJson, provenanceOf, resolveRoute, untrusted } from "@/lib/ai";
import { body, fail, ok } from "@/lib/api";
import { loadCases } from "@/lib/cases";
import { AiReportSchema } from "@/lib/schemas";
import { authorize } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = await authorize(req, "reports:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const pid = new URL(req.url).searchParams.get("projectId");
  const rows = pid ? await db.select().from(reports).where(eq(reports.projectId, pid)).orderBy(desc(reports.createdAt)) : await db.select().from(reports).orderBy(desc(reports.createdAt));
  return ok(rows);
}

const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
const table = (o: Record<string, number>) => (Object.keys(o).length ? Object.entries(o).map(([k, v]) => `| ${k} | ${v} |`).join("\n") : "| (none) | 0 |");
const cell = (s: string) => s.replace(/\|/g, "/").replace(/[\r\n]+/g, " ");

export async function POST(req: Request) {
  const auth = await authorize(req, "reports:generate");
  if ("response" in auth) return auth.response;
  try {
    const db = await getDb();
    const b = await body<{ projectId: string }>(req);
    const [proj] = await db.select().from(projects).where(eq(projects.id, b.projectId ?? ""));
    if (!proj) return fail("Project not found", 404);
    const { cases, reqs } = await loadCases(proj.id);
    const scr = await db.select().from(screens).where(eq(screens.projectId, proj.id));
    const ctl = scr.length ? await db.select().from(controls).where(inArray(controls.screenId, scr.map((s) => s.id))) : [];
    const wfs = await db.select().from(workflows).where(eq(workflows.projectId, proj.id));
    const rs = wfs.length ? await db.select().from(runs).where(inArray(runs.workflowId, wfs.map((w) => w.id))).orderBy(desc(runs.startedAt)) : [];
    const perfPlans = await db.select().from(performancePlans).where(eq(performancePlans.projectId, proj.id));
    const perfRuns = perfPlans.length ? await db.select().from(performanceRuns).where(inArray(performanceRuns.planId, perfPlans.map((p) => p.id))).orderBy(desc(performanceRuns.startedAt)) : [];

    const covered = new Set(cases.flatMap((c) => c.requirementKeys));
    const uncovered = reqs.filter((r) => !covered.has(r.reqKey)).map((r) => r.reqKey);
    const ambiguous = reqs.filter((r) => r.ambiguity);
    const stats = {
      project: proj.name,
      surface: proj.surface,
      requirements: reqs.length,
      requirementsWithTests: reqs.length - uncovered.length,
      uncoveredRequirementIds: uncovered,
      ambiguousRequirementIds: ambiguous.map((r) => r.reqKey),
      testCases: cases.length,
      byCategory: tally(cases.map((c) => c.category)),
      byPriority: tally(cases.map((c) => c.priority)),
      screens: scr.length,
      controlsByType: tally(ctl.map((c) => c.type)),
      lowConfidenceControls: ctl.filter((c) => c.confidence < 0.5).length,
      workflows: wfs.length,
      playwrightRuns: rs.filter((r) => r.executor === "playwright" && r.mode === "playwright").length,
      desktopAttendedRuns: rs.filter((r) => r.executor === "robotjs-desktop" && r.mode === "attended" && r.desktopDriver === "robotjs").length,
      executedRuns: rs.filter((r) => (r.executor === "playwright" && r.mode === "playwright") || (r.executor === "robotjs-desktop" && r.mode === "attended" && r.desktopDriver === "robotjs")).length,
      simulatedDesktopRuns: rs.filter((r) => r.executor === "robotjs-desktop" && r.desktopDriver === "mock").length,
      dryRuns: rs.filter((r) => r.mode === "dry-run").length,
      jmeterRuns: perfRuns.filter((r) => r.summary && r.status !== "running").length,
      latestJmeterStatuses: perfRuns.slice(0, 5).map((r) => ({ status: r.status, sampleCount: r.summary?.count ?? 0 })),
      latestRunStatuses: rs.slice(0, 5).map((r) => ({ executor: r.executor, driver: r.desktopDriver || null, mode: r.mode, status: r.status, summary: r.summary })),
    };

    const route = await resolveRoute(db, "report_generation");
    let ai: { executiveSummary: string; risks: string[]; recommendations: string[] } | null = null;
    if (!route.local) {
      const system = await buildSystem(db, `TASK: report generation. Output schema: {"executiveSummary":string,"risks":string[],"recommendations":string[]}. Use ONLY the supplied facts. executedRuns counts only Playwright/real RobotJS; jmeterRuns counts recorded HTTP load tests separately. If both are 0 state clearly that no test has been executed. Never conflate JMeter samples with browser/desktop outcomes. Do not claim pass rates that are not in the data.`);
      ai = AiReportSchema.parse(parseJson(await callModel(route, { system, user: untrusted("project statistics", JSON.stringify(stats)) })));
    }
    const prov = provenanceOf(route);
    const md = [
      `# RASQ-Ai Test Automation Report — ${proj.name}`,
      `_Generated ${new Date().toISOString()} · surface: ${proj.surface} · provenance: ${route.local ? "rasq-local-rules-v1 (no AI used)" : prov}_`,
      "",
      "## Evidence statement",
      stats.executedRuns === 0
        ? `**No Playwright or real RobotJS desktop execution has been recorded for this project.** ${stats.jmeterRuns ? `${stats.jmeterRuns} JMeter run(s) contain observed HTTP samples, shown separately below.` : "Generated artifacts and simulations are not observed application test results."}`
        : `${stats.executedRuns} real execution run(s) are recorded: ${stats.playwrightRuns} Playwright and ${stats.desktopAttendedRuns} attended RobotJS desktop. Only recorded run data is reported; nothing is inferred.`,
      ...(stats.simulatedDesktopRuns ? [`${stats.simulatedDesktopRuns} mock desktop run(s) are simulations and are not counted as real execution evidence.`] : []),
      ...(ai ? ["", `## Executive summary (AI-authored by ${prov} from the statistics in this report)`, ai.executiveSummary] : []),
      "",
      "## Traceability",
      `- Requirements: **${stats.requirements}**; with ≥1 test case: **${stats.requirementsWithTests}** (${stats.requirements ? Math.round((stats.requirementsWithTests / stats.requirements) * 100) : 0}%)`,
      `- Uncovered: ${uncovered.join(", ") || "none"}`,
      `- Ambiguous requirements: ${ambiguous.map((r) => `${r.reqKey} (${r.ambiguity})`).join("; ") || "none"}`,
      "",
      "| Requirement | Test cases |",
      "|---|---|",
      ...reqs.map((r) => `| ${r.reqKey} | ${cases.filter((c) => c.requirementKeys.includes(r.reqKey)).map((c) => c.caseKey).join(", ") || "—"} |`),
      "",
      "## Test design",
      `Total cases: **${cases.length}**`,
      "",
      "| Category | Count |",
      "|---|---|",
      table(stats.byCategory),
      "",
      "| Priority | Count |",
      "|---|---|",
      table(stats.byPriority),
      "",
      "## Visual evidence",
      `Screens/page groups: ${stats.screens}; controls: ${ctl.length} (${stats.lowConfidenceControls} below 0.5 confidence).`,
      "",
      "| Control type | Count |",
      "|---|---|",
      table(stats.controlsByType),
      "",
      "## Execution",
      rs.length ? "| Run | Executor | Driver | Mode | Status | Summary |\n|---|---|---|---|---|---|\n" + rs.slice(0, 10).map((r) => `| ${r.startedAt.toISOString()} | ${r.executor} | ${r.desktopDriver || "—"} | ${r.mode} | ${r.status} | ${Object.entries(r.summary).map(([k, v]) => `${k}:${v}`).join(" ")} |`).join("\n") : "No Playwright or desktop runs recorded.",
      "",
      "## JSON REST load testing (JMeter CLI)",
      perfRuns.length ? "| Started | Plan | Status | Samples | p95 ms | Errors | Throughput req/s |\n|---|---|---|---:|---:|---:|---:|\n" + perfRuns.slice(0, 10).map((r) => `| ${r.startedAt.toISOString()} | ${cell(perfPlans.find((p) => p.id === r.planId)?.config.name ?? "Deleted plan")} | ${r.status} | ${r.summary?.count ?? "—"} | ${r.summary?.p95Ms ?? "—"} | ${r.summary ? `${r.summary.errors} (${r.summary.errorPercent.toFixed(2)}%)` : "—"} | ${r.summary?.throughputRps.toFixed(2) ?? "—"} |`).join("\n") : "No JMeter runs recorded; saved plans are not execution evidence.",
      ...perfRuns.slice(0, 10).flatMap((r) => r.summary ? [`Run ${r.id}: ${r.summary.decisions.map((d) => `${d.metric} ${d.status} — ${cell(d.message)}`).join("; ")}. ${r.summary.notes.map((n) => `Needs review: ${cell(n)}`).join(" ")}`] : [`Run ${r.id}: ${r.status} (${cell(r.error || "no observed samples")}).`]),
      "Lab HTTP samples only. Implicit defaults are p95 ≤ 1,000 ms and error rate ≤ 1%; missing throughput/ambiguous thresholds are needs-review. Confidence bounds assume independent samples and do not substitute for field evidence.",
      ...(ai ? ["", "## Risks (AI-authored)", ...ai.risks.map((x) => `- ${x}`), "", "## Recommendations (AI-authored)", ...ai.recommendations.map((x) => `- ${x}`)] : []),
      "",
      "---",
      "_Selectors are visual anchors (region + template hash) unless a DOM selector was explicitly supplied. Model credentials and private context are never included in reports._",
    ].join("\n");
    const [row] = await db.insert(reports).values({ projectId: proj.id, title: `Report ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, markdown: md, provenance: route.local ? "rasq-local-rules-v1" : prov }).returning();
    return ok(row, 201);
  } catch (e) {
    return fail(errMsg(e), 502);
  }
}

export async function DELETE(req: Request) {
  const auth = await authorize(req, "delete:artifacts");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id required");
  await db.delete(reports).where(eq(reports.id, id));
  return ok();
}
