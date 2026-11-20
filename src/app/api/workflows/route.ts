import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { controls, projects, screens, workflows } from "@/db/schema";
import { buildSystem, callModel, errMsg, parseJson, provenanceOf, resolveRoute, untrusted } from "@/lib/ai";
import { body, fail, ok } from "@/lib/api";
import { loadCases } from "@/lib/cases";
import { buildWorkflow, NT, validateN8n, type Binding, type ControlRef } from "@/lib/n8n";
import { AiBindingsSchema } from "@/lib/schemas";
import { authorize } from "@/lib/agentAuth";
import { beginIdempotency } from "@/lib/idempotency";
import { NextResponse } from "next/server";
import { projectAllowed, projectDeny, filterProjects } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = await authorize(req, "workflows:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const pid = new URL(req.url).searchParams.get("projectId");
  if (pid && !projectAllowed(auth.actor, pid)) return projectDeny();
  const rows = filterProjects(auth.actor, pid ? await db.select().from(workflows).where(eq(workflows.projectId, pid)).orderBy(desc(workflows.updatedAt)) : await db.select().from(workflows).orderBy(desc(workflows.updatedAt)));
  return ok(rows.map((w) => ({ id: w.id, projectId: w.projectId, name: w.name, version: w.version, provenance: w.provenance, nodes: (w.n8n.nodes as unknown[] | undefined)?.length ?? 0, updatedAt: w.updatedAt })));
}

export async function POST(req: Request) {
  const auth = await authorize(req, "workflows:write");
  if ("response" in auth) return auth.response;
  try {
    const db = await getDb();
    const b = await body<{ projectId: string; mode: "generate" | "import" | "blank"; name?: string; caseIds?: string[]; n8n?: unknown }>(req);
    if (!b.projectId) return fail("projectId required");
    if (!projectAllowed(auth.actor, b.projectId)) return projectDeny();
    const idem = await beginIdempotency(req, auth.actor, "POST /api/workflows", b);
    if (idem instanceof NextResponse) return idem;
    const [proj] = await db.select().from(projects).where(eq(projects.id, b.projectId));
    if (!proj) return fail("Project not found", 404);

    if (b.mode === "import") {
      const wf = validateN8n(b.n8n);
      const [row] = await db.insert(workflows).values({ projectId: b.projectId, name: b.name || wf.name, n8n: wf as never, provenance: "imported" }).returning();
      const payload = { id: row.id };
      await idem.store(201, payload);
      return ok(payload, 201);
    }
    if (b.mode === "blank") {
      const wf = buildWorkflow({ name: b.name || "New workflow", targetUrl: proj.targetUrl, cases: [], controls: new Map(), provenance: "manual" });
      const [row] = await db.insert(workflows).values({ projectId: b.projectId, name: wf.name, n8n: wf as never, provenance: "manual" }).returning();
      const payload = { id: row.id };
      await idem.store(201, payload);
      return ok(payload, 201);
    }

    const { cases } = await loadCases(b.projectId);
    const sel = cases.filter((c) => !b.caseIds?.length || b.caseIds.includes(c.id));
    if (!sel.length) return fail("Generate test cases first.");
    const scr = await db.select().from(screens).where(eq(screens.projectId, b.projectId));
    const ctl = scr.length ? await db.select().from(controls).where(inArray(controls.screenId, scr.map((s) => s.id))) : [];
    const sizeOf = new Map(scr.map((s) => [s.id, s]));
    const refs = new Map<string, ControlRef>(ctl.map((c) => [c.id, { id: c.id, type: c.type, label: c.label, x: c.x, y: c.y, w: c.w, h: c.h, locatorHash: c.locatorHash, screenW: sizeOf.get(c.screenId)!.width, screenH: sizeOf.get(c.screenId)!.height }]));
    const caseRefs = sel.map((c) => ({ caseKey: c.caseKey, title: c.title.replace(/^[A-Z0-9-]+ – /, ""), priority: c.priority, category: c.category, requirementIds: c.requirementKeys, steps: c.steps }));

    const route = await resolveRoute(db, "workflow_creation");
    const bindings = new Map<string, Binding>();
    let notes = "";
    if (!route.local) {
      const open = caseRefs.flatMap((c) => c.steps.filter((s) => s.action !== "navigate" && s.action !== "wait" && (s.action === "assert" || !s.controlId)).map((s) => ({ caseKey: c.caseKey, order: s.order, action: s.action, target: s.target, expected: s.expected })));
      if (open.length) {
        const system = await buildSystem(
          db,
          `TASK: workflow creation. Bind open test steps to visual anchors and choose assertion kinds. Output schema: {"bindings":[{"caseKey":string,"order":int,"controlId":string|null,"assertKind":"manualReview|screenshotChanged|urlContains|textVisible"|null,"assertValue":string|null}],"notes":string}.
controlId must be one of the supplied control ids, else null. Use assertKind textVisible/urlContains ONLY with a value copied from the step's expected text; otherwise screenshotChanged for observable transitions or manualReview. Never invent selectors.`,
        );
        const user = `Open steps:\n${untrusted("steps", JSON.stringify(open.slice(0, 300)))}\n\nVisual controls:\n${JSON.stringify([...refs.values()].slice(0, 200).map((c) => ({ id: c.id, type: c.type, label: c.label })))}`;
        const parsed = AiBindingsSchema.parse(parseJson(await callModel(route, { system, user })));
        notes = parsed.notes;
        for (const bd of parsed.bindings) {
          const v: Binding = {};
          if (bd.controlId && refs.has(bd.controlId)) v.controlId = bd.controlId;
          if (bd.assertKind) {
            v.assertKind = bd.assertKind;
            v.assertValue = bd.assertValue ?? "";
          }
          bindings.set(`${bd.caseKey}:${bd.order}`, v);
        }
      }
    }
    const prov = provenanceOf(route);
    const wf = buildWorkflow({ name: b.name || `${proj.name} – automation`, targetUrl: proj.targetUrl, cases: caseRefs, controls: refs, bindings, provenance: route.local ? "rasq-local-rules-v1" : prov });
    const unresolved = wf.nodes.filter((n) => n.type === NT.action && n.parameters.anchorStatus === "unresolved").length;
    const [row] = await db.insert(workflows).values({ projectId: b.projectId, name: wf.name, n8n: wf as never, provenance: route.local ? "rasq-local-rules-v1" : prov }).returning();
    const payload = { id: row.id, nodes: wf.nodes.length, unresolvedAnchors: unresolved, notes };
    await idem.store(201, payload);
    return ok(payload, 201);
  } catch (e) {
    return fail(errMsg(e), 502);
  }
}
