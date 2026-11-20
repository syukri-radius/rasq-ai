import { desc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb } from "@/db";
import { requirementDocs, requirements } from "@/db/schema";
import { buildSystem, callModel, errMsg, parseJson, provenanceOf, redact, resolveRoute, untrusted } from "@/lib/ai";
import { fail, ok } from "@/lib/api";
import { AiRequirementsSchema } from "@/lib/schemas";
import { classify, parseRequirements, type ParsedReq } from "@/lib/srs";
import { authorize } from "@/lib/agentAuth";
import { projectAllowed, projectDeny, docProjectId } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = await authorize(req, "requirements:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const pid = new URL(req.url).searchParams.get("projectId");
  if (pid && !projectAllowed(auth.actor, pid)) return projectDeny();
  const docs = pid ? await db.select().from(requirementDocs).where(eq(requirementDocs.projectId, pid)).orderBy(desc(requirementDocs.createdAt)) : [];
  const reqs = docs.length ? await db.select().from(requirements).where(inArray(requirements.docId, docs.map((d) => d.id))) : [];
  return ok({ docs: docs.map((d) => ({ ...d, text: undefined, chars: d.text.length })), requirements: reqs });
}

async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    const { extractText: ex, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await ex(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  return await file.text();
}

export async function POST(req: Request) {
  const auth = await authorize(req, "requirements:write");
  if ("response" in auth) return auth.response;
  try {
    const db = await getDb();
    const form = await req.formData();
    const projectId = String(form.get("projectId") ?? "");
    if (!projectId) return fail("projectId required");
    if (!projectAllowed(auth.actor, projectId)) return projectDeny();
    const file = form.get("file");
    let text = String(form.get("text") ?? "");
    let name = String(form.get("name") ?? "Pasted SRS");
    let mimeType = "text/plain";
    if (file instanceof File && file.size > 0) {
      if (file.size > 15 * 1024 * 1024) return fail("File too large (15 MB max)", 413);
      text = await extractText(file);
      name = file.name;
      mimeType = file.type || "text/plain";
    }
    text = text.replace(/\u0000/g, "").trim();
    if (text.length < 10) return fail("No readable text found in the document.");

    const parsed = new Map<string, ParsedReq>(parseRequirements(text).map((r) => [r.reqKey, r]));
    let model: string | null = null;
    const route = await resolveRoute(db, "document_analysis");
    if (!route.local) {
      const system = await buildSystem(
        db,
        `TASK: document analysis. Extract requirements. Output schema: {"requirements":[{"id":string,"text":string,"acceptance":string[],"category":"functional|security|privacy|accessibility|performance|resilience","ambiguity":string|null}]}.
Requirement IDs must be copied EXACTLY as written in the document; never invent IDs. Put explicit acceptance criteria in "acceptance". Set "ambiguity" when wording is vague/unmeasurable; otherwise null.`,
      );
      const raw = await callModel(route, { system, user: untrusted("SRS document", redact(text).text.slice(0, 60_000)) });
      model = provenanceOf(route);
      const ai = AiRequirementsSchema.parse(parseJson(raw));
      for (const r of ai.requirements) {
        if (!text.includes(r.id)) continue; // reject IDs that are not literally in the source
        const cur = parsed.get(r.id);
        parsed.set(r.id, {
          reqKey: r.id,
          text: cur?.text ?? r.text,
          acceptance: r.acceptance.length ? r.acceptance : cur?.acceptance ?? [],
          category: r.category || cur?.category || classify(r.text),
          ambiguity: r.ambiguity ?? cur?.ambiguity ?? null,
        });
      }
    }
    const list = [...parsed.values()];
    if (list.length === 0) return fail("No requirement IDs (e.g. REQ-001, FR-1.2) were found. Prefix each requirement with an ID so traceability can be preserved.");
    const [doc] = await db.insert(requirementDocs).values({ projectId, name, mimeType, sha256: createHash("sha256").update(text).digest("hex"), text, analysisModel: model }).returning();
    await db.insert(requirements).values(list.map((r) => ({ docId: doc.id, reqKey: r.reqKey, text: r.text, acceptance: r.acceptance, category: r.category, ambiguity: r.ambiguity })));
    return ok({ docId: doc.id, count: list.length, model: model ?? "local-parser" }, 201);
  } catch (e) {
    return fail(errMsg(e), 502);
  }
}

export async function DELETE(req: Request) {
  const auth = await authorize(req, "delete:artifacts");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const id = new URL(req.url).searchParams.get("docId");
  if (!id) return fail("docId required");
  const pid = await docProjectId(db, id);
  if (!pid || !projectAllowed(auth.actor, pid)) return projectDeny();
  await db.delete(requirementDocs).where(eq(requirementDocs.id, id));
  return ok();
}