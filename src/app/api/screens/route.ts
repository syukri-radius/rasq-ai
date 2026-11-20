import { and, desc, eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import { controls, screens } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { normalizeControls, type InControl } from "@/lib/screens";
import { PERCEPTION_MODEL } from "@/lib/types";
import { DATA_DIR } from "@/lib/runner";
import { authorize } from "@/lib/agentAuth";
import { projectAllowed, projectDeny, filterProjects, recordingProjectId } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorize(req, "screens:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const u = new URL(req.url);
  const pid = u.searchParams.get("projectId");
  const recordingId = u.searchParams.get("recordingId");
  if (pid && !projectAllowed(auth.actor, pid)) return projectDeny();
  if (recordingId) {
    const recPid = await recordingProjectId(db, recordingId);
    if (recPid && !projectAllowed(auth.actor, recPid)) return projectDeny();
  }
  const filters = [pid ? eq(screens.projectId, pid) : null, recordingId ? eq(screens.recordingId, recordingId) : null].filter((x) => x !== null);
  const rows = filterProjects(auth.actor, filters.length
    ? await db.select().from(screens).where(and(...filters)).orderBy(desc(screens.createdAt))
    : await db.select().from(screens).orderBy(desc(screens.createdAt)));
  const ids = rows.map((r) => r.id);
  const cs = ids.length ? await db.select().from(controls).where(inArray(controls.screenId, ids)) : [];
  return ok(rows.map((s) => ({ ...s, controls: cs.filter((c) => c.screenId === s.id) })));
}

export async function POST(req: Request) {
  const auth = await authorize(req, "screens:write");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const b = await body<{ projectId: string; recordingId?: string | null; name: string; groupKey?: string; source?: string; width: number; height: number; imageDataUrl: string; frameCount?: number; timestampMs?: number; aiModel?: string | null; controls: InControl[] }>(req);
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(b.imageDataUrl ?? "");
  if (!b.projectId || !m || !b.width || !b.height) return fail("projectId, width, height and a PNG/JPEG/WebP imageDataUrl are required");
  if (!projectAllowed(auth.actor, b.projectId)) return projectDeny();
  const dir = path.join(DATA_DIR, "screens");
  fs.mkdirSync(dir, { recursive: true });
  const file = `${crypto.randomUUID()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], "base64"));
  const [s] = await db
    .insert(screens)
    .values({ projectId: b.projectId, recordingId: b.recordingId ?? null, name: b.name || "Untitled screen", groupKey: b.groupKey ?? "grp-1", source: b.source ?? "screenshot", width: b.width, height: b.height, imagePath: file, frameCount: b.frameCount ?? 1, timestampMs: b.timestampMs ?? 0, perceptionModel: PERCEPTION_MODEL, aiModel: b.aiModel ?? null })
    .returning();
  const valid = normalizeControls(b.controls);
  const savedControls = valid.length
    ? await db.insert(controls).values(valid.map((c) => ({ ...c, id: crypto.randomUUID(), screenId: s.id }))).returning()
    : [];
  return ok({ ...s, controls: savedControls, controlCount: valid.length }, 201);
}