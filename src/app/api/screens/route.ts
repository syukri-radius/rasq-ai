import { desc, eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import { controls, screens } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { CONTROL_TYPES, PERCEPTION_MODEL } from "@/lib/types";
import { DATA_DIR } from "@/lib/runner";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await getDb();
  const pid = new URL(req.url).searchParams.get("projectId");
  const rows = pid ? await db.select().from(screens).where(eq(screens.projectId, pid)).orderBy(desc(screens.createdAt)) : await db.select().from(screens).orderBy(desc(screens.createdAt));
  const ids = rows.map((r) => r.id);
  const cs = ids.length ? await db.select().from(controls).where(inArray(controls.screenId, ids)) : [];
  return ok(rows.map((s) => ({ ...s, controls: cs.filter((c) => c.screenId === s.id) })));
}

type InControl = { type: string; label: string; x: number; y: number; w: number; h: number; confidence: number; evidence: string; locatorHash: string; perceptionLabel: string; aiModel: string | null; source: string };

export async function POST(req: Request) {
  const db = await getDb();
  const b = await body<{ projectId: string; recordingId?: string | null; name: string; groupKey?: string; source?: string; width: number; height: number; imageDataUrl: string; frameCount?: number; timestampMs?: number; aiModel?: string | null; controls: InControl[] }>(req);
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(b.imageDataUrl ?? "");
  if (!b.projectId || !m || !b.width || !b.height) return fail("projectId, width, height and a PNG/JPEG/WebP imageDataUrl are required");
  const dir = path.join(DATA_DIR, "screens");
  fs.mkdirSync(dir, { recursive: true });
  const file = `${crypto.randomUUID()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], "base64"));
  const [s] = await db
    .insert(screens)
    .values({ projectId: b.projectId, recordingId: b.recordingId ?? null, name: b.name || "Untitled screen", groupKey: b.groupKey ?? "grp-1", source: b.source ?? "screenshot", width: b.width, height: b.height, imagePath: file, frameCount: b.frameCount ?? 1, timestampMs: b.timestampMs ?? 0, perceptionModel: PERCEPTION_MODEL, aiModel: b.aiModel ?? null })
    .returning();
  const valid = (b.controls ?? []).filter((c) => (CONTROL_TYPES as readonly string[]).includes(c.type) && c.w > 0 && c.h > 0);
  if (valid.length)
    await db.insert(controls).values(
      valid.map((c) => ({ screenId: s.id, type: c.type, label: (c.label ?? "").slice(0, 120), x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h), confidence: Math.max(0, Math.min(1, c.confidence)), evidence: (c.evidence ?? "").slice(0, 400), locatorHash: c.locatorHash ?? "", perceptionLabel: c.perceptionLabel ?? "", aiModel: c.aiModel, source: c.source ?? "perception" })),
    );
  return ok({ ...s, controlCount: valid.length }, 201);
}
