import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import { screens } from "@/db/schema";
import { ok, type Params } from "@/lib/api";
import { DATA_DIR } from "@/lib/runner";

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
  return new Response(new Uint8Array(buf), { headers: { "content-type": s.imagePath.endsWith(".png") ? "image/png" : "image/jpeg", "cache-control": "private, max-age=300" } });
}
