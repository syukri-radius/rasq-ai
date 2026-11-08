import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { controls, requirementDocs, requirements, screens, testCases, testTraceability } from "@/db/schema";
import { buildSystem, callModel, errMsg, parseJson, provenanceOf, redact, resolveRoute, untrusted } from "@/lib/ai";
import { body, fail, ok } from "@/lib/api";
import { AiTestCaseSchema, AiTestsSchema, AiVisualTestCaseSchema } from "@/lib/schemas";
import { loadCases } from "@/lib/cases";
import { designLocalCases, type BindableControl, type LocalCase } from "@/lib/srs";
import { designVisualCases, type VisualCaseControl } from "@/lib/visualCases";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const pid = new URL(req.url).searchParams.get("projectId");
  if (!pid) return fail("projectId required");
  return ok(await loadCases(pid));
}

export async function POST(req: Request) {
  try {
    const db = await getDb();
    const b = await body<{ projectId: string; docId?: string; source?: "requirements" | "visual"; screenIds?: string[]; replace?: boolean }>(req);
    const visual = b.source === "visual";
    if (!b.projectId) return fail("projectId required");
    if (!visual && !b.docId) return fail("docId required for requirement-driven generation");

    const reqs = visual ? [] : await db.select().from(requirements).where(eq(requirements.docId, b.docId!));
    if (!visual && !reqs.length) return fail("The selected document has no requirements.");
    const scr = await db.select().from(screens).where(eq(screens.projectId, b.projectId));
    const useScr = scr.filter((s) => !b.screenIds?.length || b.screenIds.includes(s.id));
    if (visual && !useScr.length) return fail("No saved visual scans were selected. Save a scan in Record & Visual Scan first.");
    const ctl = useScr.length ? await db.select().from(controls).where(inArray(controls.screenId, useScr.map((s) => s.id))) : [];
    if (visual && !ctl.length) return fail("The selected saved scans contain no controls. Edit and save at least one control first.");

    const bindable: BindableControl[] = ctl.map((c) => ({ id: c.id, type: c.type, label: c.label }));
    const screenName = new Map(useScr.map((s) => [s.id, s.name]));
    const visualControls: VisualCaseControl[] = ctl.map((c) => ({ id: c.id, type: c.type, label: c.label, confidence: c.confidence, screenName: screenName.get(c.screenId) ?? "Saved screen" }));
    const route = await resolveRoute(db, "test_scenarios");
    const prov = provenanceOf(route);
    const generated: LocalCase[] = [];
    const warnings: string[] = [];
    const ctlIds = new Set(bindable.map((c) => c.id));
    const known = new Set(reqs.map((r) => r.reqKey));

    const appendRaw = (raw: unknown, visualMode: boolean) => {
      const t = visualMode ? AiVisualTestCaseSchema.safeParse(raw) : AiTestCaseSchema.safeParse(raw);
      if (!t.success) {
        warnings.push("A malformed AI test case was dropped.");
        return;
      }
      const ids = visualMode ? [] : t.data.requirementIds.filter((x) => known.has(x));
      if (!visualMode && !ids.length) {
        warnings.push(`Dropped "${t.data.title}": it cites no known requirement ID.`);
        return;
      }
      if (visualMode) {
        const interactions = t.data.steps.filter((s) => !["navigate", "assert", "wait"].includes(s.action));
        if (!interactions.length || interactions.some((s) => !s.controlId || !ctlIds.has(s.controlId))) {
          warnings.push(`Dropped "${t.data.title}": every visual interaction must reference a supplied saved control.`);
          return;
        }
        if (t.data.steps[0]?.action !== "navigate" || t.data.steps.at(-1)?.action !== "assert") {
          warnings.push(`Dropped "${t.data.title}": visual cases must start with navigate and finish with assert.`);
          return;
        }
      }
      generated.push({
        ...t.data,
        requirementIds: ids,
        testData: Object.fromEntries(Object.entries(t.data.testData).map(([k, v]) => [k, redact(v).text])),
        steps: t.data.steps.map((s, n) => ({ ...s, order: n + 1, controlId: s.controlId && ctlIds.has(s.controlId) ? s.controlId : null, data: s.data ? redact(s.data).text : null })),
        provenance: prov,
      });
    };

    if (route.local) {
      if (visual) {
        generated.push(...designVisualCases(visualControls));
      } else {
        for (const r of reqs) generated.push(...designLocalCases({ reqKey: r.reqKey, text: r.text, acceptance: r.acceptance, category: r.category, ambiguity: r.ambiguity }, bindable));
      }
    } else if (visual) {
      for (let i = 0; i < visualControls.length; i += 50) {
        const batch = visualControls.slice(i, i + 50);
        const system = await buildSystem(
          db,
          `TASK: visual-only test design from saved Record & Visual Scan results. Output schema: {"testCases":[{"title":string,"category":"positive","priority":"P2","requirementIds":[],"preconditions":string[],"testData":{string:string},"steps":[{"order":int,"action":"navigate|click|type|select|check|uncheck|toggle|slider|upload|download|assert|wait","target":string,"controlId":string|null,"data":string|null,"expected":string|null}],"expected":string,"assumptions":string[]}]}.
Generate positive interaction/smoke cases only from the supplied saved controls. requirementIds MUST be [] because no SRS was supplied. controlId must be copied from a supplied control for every interaction step. Never infer business rules, negative/boundary behaviour, selectors or requirement IDs. Start with navigate and finish with assert. Limit assertions to observable interactions, pixel transitions, supplied text, or explicit manual review. Use synthetic data and vault placeholders for credentials.`,
        );
        const user = untrusted("saved visual controls", redact(JSON.stringify(batch)).text);
        const parsed = AiTestsSchema.parse(parseJson(await callModel(route, { system, user })));
        for (const raw of parsed.testCases) appendRaw(raw, true);
      }
    } else {
      for (let i = 0; i < reqs.length; i += 6) {
        const batch = reqs.slice(i, i + 6);
        const system = await buildSystem(
          db,
          `TASK: SRS test design. Output schema: {"testCases":[{"title":string,"category":"positive|negative|boundary|security|privacy|accessibility|performance|resilience","priority":"P0|P1|P2|P3","requirementIds":string[],"preconditions":string[],"testData":{string:string},"steps":[{"order":int,"action":"navigate|click|type|select|check|uncheck|toggle|slider|upload|download|assert|wait","target":string,"controlId":string|null,"data":string|null,"expected":string|null}],"expected":string,"assumptions":string[]}]}.
requirementIds must use the exact IDs supplied. controlId must be one of the supplied control ids or null (never invent). Last step must be an "assert" with a measurable "expected". Do not generate irrelevant variants.`,
        );
        const user = `Requirements:\n${untrusted("requirements", redact(JSON.stringify(batch.map((r) => ({ id: r.reqKey, text: r.text, acceptance: r.acceptance, ambiguity: r.ambiguity })))).text)}\n\nAvailable visual controls (ids are RASQ-Ai anchors):\n${JSON.stringify(bindable.slice(0, 150))}`;
        const parsed = AiTestsSchema.parse(parseJson(await callModel(route, { system, user })));
        for (const raw of parsed.testCases) appendRaw(raw, false);
      }
    }
    if (!generated.length) return fail(visual ? "No test cases could be generated from the saved visual controls." : "No test cases could be generated from the supplied requirements.");

    // Preserve the existing SRS regeneration contract; visual generation appends by default.
    const replace = b.replace ?? !visual;
    if (replace) await db.delete(testCases).where(eq(testCases.projectId, b.projectId));
    const existing = await db.select({ k: testCases.caseKey }).from(testCases).where(eq(testCases.projectId, b.projectId));
    // Appending after deletions must not reuse an existing human-visible case key.
    let n = existing.reduce((max, row) => {
      const match = /^TC-(\d+)$/.exec(row.k);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const idByKey = new Map(reqs.map((r) => [r.reqKey, r.id]));
    for (const c of generated) {
      n++;
      const [row] = await db
        .insert(testCases)
        .values({ projectId: b.projectId, caseKey: `TC-${String(n).padStart(3, "0")}`, title: c.title, category: c.category, priority: c.priority, preconditions: c.preconditions, testData: c.testData, steps: c.steps, expected: c.expected, assumptions: c.assumptions, provenance: c.provenance })
        .returning();
      const links = [...new Set(c.requirementIds)].map((k) => idByKey.get(k)).filter((x): x is string => !!x);
      if (links.length) await db.insert(testTraceability).values(links.map((requirementId) => ({ testCaseId: row.id, requirementId })));
    }
    return ok({ count: generated.length, model: prov, source: visual ? "visual" : "requirements", replaced: replace, warnings: [...new Set(warnings)] }, 201);
  } catch (e) {
    return fail(errMsg(e), 502);
  }
}

export async function DELETE(req: Request) {
  const db = await getDb();
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  const pid = u.searchParams.get("projectId");
  if (id) await db.delete(testCases).where(eq(testCases.id, id));
  else if (pid) await db.delete(testCases).where(eq(testCases.projectId, pid));
  else return fail("id or projectId required");
  return ok();
}
