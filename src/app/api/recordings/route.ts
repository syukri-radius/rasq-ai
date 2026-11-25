import { desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db";
import { recordings } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { DATA_DIR } from "@/lib/runner";
import { authorize } from "@/lib/agentAuth";
import { projectAllowed, projectDeny, filterProjects } from "@/lib/projectAccess";
import { contentLengthExceeds } from "@/lib/api";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.RASQ_MAX_UPLOAD_MB ?? 100) || 100) * 1024 * 1024;

export async function GET(req: Request) {
  const auth = await authorize(req, "screens:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const pid = new URL(req.url).searchParams.get("projectId");
  if (pid) {
    if (!projectAllowed(auth.actor, pid)) return projectDeny();
    return ok(await db.select().from(recordings).where(eq(recordings.projectId, pid)).orderBy(desc(recordings.createdAt)));
  }
  return ok(filterProjects(auth.actor, await db.select().from(recordings).orderBy(desc(recordings.createdAt))));
}

export async function POST(req: Request) {
  const auth = await authorize(req, "screens:write");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  if (contentLengthExceeds(req, MAX_UPLOAD_BYTES)) return fail(`Recording too large (${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB max)`, 413, "payload_too_large");
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  if (!(file instanceof File) || !projectId) return fail("file and projectId are required");
  if (!projectAllowed(auth.actor, projectId)) return projectDeny();
  if (file.size > MAX_UPLOAD_BYTES) return fail(`Recording too large (${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB max)`, 413, "payload_too_large");
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