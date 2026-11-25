import { NextResponse } from "next/server";
import { beginIdempotency } from "@/lib/idempotency";
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
import { contentLengthExceeds } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Screenshots can be large; cap the JSON envelope at 40 MB (base64 included). */
const MAX_BODY_BYTES = 40 * 1024 * 1024;
const MAX_IMAGE_CHARS = 30 * 1024 * 1024;

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
  if (contentLengthExceeds(req, MAX_BODY_BYTES)) return fail("Screen payload too large (40 MB max)", 413, "payload_too_large");
  const b = await body<{ projectId: string; recordingId?: string | null; name: string; groupKey?: string; source?: string; width: number; height: number; imageDataUrl: string; frameCount?: number; timestampMs?: number; aiModel?: string | null; controls: InControl[] }>(req, MAX_BODY_BYTES);
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(b.imageDataUrl ?? "");
  if (!b.projectId || !m || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return fail("projectId, width, height and a PNG/JPEG/WebP imageDataUrl are required");
  if (m[2].length > MAX_IMAGE_CHARS) return fail("Screen image too large (30 MB of base64 max)", 413, "payload_too_large");
  if (b.width < 1 || b.height < 1 || b.width > 16384 || b.height > 16384) return fail("width/height out of range (1–16384)", 400, "validation_failed");
  if (!projectAllowed(auth.actor, b.projectId)) return projectDeny();
  const idem = await beginIdempotency(req, auth.actor, "POST /api/screens", b);
  if (idem instanceof NextResponse) return idem;
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
  const payload = { ...s, controls: savedControls, controlCount: valid.length };
  await idem.store(201, payload);
  return ok(payload, 201);
}