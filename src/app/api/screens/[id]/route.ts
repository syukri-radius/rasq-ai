import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import { controls, screens } from "@/db/schema";
import { body, fail, ok, type Params } from "@/lib/api";
import { normalizeControls, type InControl } from "@/lib/screens";
import { DATA_DIR } from "@/lib/runner";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const [existing] = await db.select().from(screens).where(eq(screens.id, id));
  if (!existing) return fail("Not found", 404);
  const b = await body<{ name?: string; groupKey?: string; frameCount?: number; timestampMs?: number; aiModel?: string | null; controls?: InControl[] }>(req);
  if (!Array.isArray(b.controls)) return fail("controls array is required");
  const valid = normalizeControls(b.controls);
  const prior = await db.select({ id: controls.id }).from(controls).where(eq(controls.screenId, id));
  const priorIds = new Set(prior.map((c) => c.id));
  const [updated] = await db
    .update(screens)
    .set({
      name: b.name?.trim() || existing.name,
      groupKey: b.groupKey?.trim() || existing.groupKey,
      frameCount: Number.isFinite(b.frameCount) ? Math.max(1, Math.round(b.frameCount!)) : existing.frameCount,
      timestampMs: Number.isFinite(b.timestampMs) ? Math.max(0, Math.round(b.timestampMs!)) : existing.timestampMs,
      aiModel: b.aiModel ?? null,
    })
    .where(eq(screens.id, id))
    .returning();
  await db.delete(controls).where(eq(controls.screenId, id));
  const savedControls = valid.length
    ? await db.insert(controls).values(valid.map((c) => ({ ...c, id: c.id && priorIds.has(c.id) ? c.id : crypto.randomUUID(), screenId: id }))).returning()
    : [];
  return ok({ ...updated, controls: savedControls, controlCount: valid.length });
}

export async function DELETE(_req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const [s] = await db.select().from(screens).where(eq(screens.id, id));
  if (s) {
    fs.rmSync(path.join(DATA_DIR, "screens", s.imagePath), { force: true });
    await db.delete(screens).where(eq(screens.id, id));
  }
  return ok();
}

export async function GET(_req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const [s] = await db.select().from(screens).where(eq(screens.id, id));
  if (!s) return new Response("Not found", { status: 404 });
  const buf = fs.readFileSync(path.join(DATA_DIR, "screens", s.imagePath));
  return new Response(new Uint8Array(buf), { headers: { "content-type": s.imagePath.endsWith(".png") ? "image/png" : s.imagePath.endsWith(".webp") ? "image/webp" : "image/jpeg", "cache-control": "private, max-age=300" } });
}
