import { desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import { recordings } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { DATA_DIR } from "@/lib/runner";
import { authorize } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorize(req, "screens:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const pid = new URL(req.url).searchParams.get("projectId");
  return ok(pid ? await db.select().from(recordings).where(eq(recordings.projectId, pid)).orderBy(desc(recordings.createdAt)) : await db.select().from(recordings).orderBy(desc(recordings.createdAt)));
}

export async function POST(req: Request) {
  const auth = await authorize(req, "screens:write");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  if (!(file instanceof File) || !projectId) return fail("file and projectId are required");
  const buf = Buffer.from(await file.arrayBuffer());
  const dir = path.join(DATA_DIR, "recordings");
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${file.type.includes("mp4") ? "mp4" : "webm"}`;
  fs.writeFileSync(path.join(dir, name), buf);
  const [row] = await db
    .insert(recordings)
    .values({ projectId, name: String(form.get("name") || `Recording ${new Date().toISOString().slice(0, 19)}`), mimeType: file.type || "video/webm", durationMs: Number(form.get("durationMs") ?? 0) || 0, sizeBytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), filePath: name })
    .returning();
  return ok(row, 201);
}
