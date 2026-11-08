import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import { recordings } from "@/db/schema";
import { ok, type Params } from "@/lib/api";
import { DATA_DIR } from "@/lib/runner";

export async function GET(_req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const [r] = await db.select().from(recordings).where(eq(recordings.id, id));
  if (!r) return new Response("Not found", { status: 404 });
  const buf = fs.readFileSync(path.join(DATA_DIR, "recordings", r.filePath));
  return new Response(new Uint8Array(buf), { headers: { "content-type": r.mimeType, "content-length": String(buf.length), "cache-control": "private, max-age=300" } });
}

export async function DELETE(_req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const [r] = await db.select().from(recordings).where(eq(recordings.id, id));
  if (r) {
    fs.rmSync(path.join(DATA_DIR, "recordings", r.filePath), { force: true });
    await db.delete(recordings).where(eq(recordings.id, id));
  }
  return ok();
}
