import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { SURFACES } from "@/lib/types";
import { authorize } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorize(req, "projects:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  if (auth.actor.kind === "agent" && auth.actor.projectIds.length) {
    const allowed = auth.actor.projectIds;
    return ok(rows.filter((r) => allowed.includes(r.id)));
  }
  return ok(rows);
}

export async function POST(req: Request) {
  const auth = await authorize(req, "projects:write");
  if ("response" in auth) return auth.response;
  if (auth.actor.kind === "agent" && auth.actor.projectIds.length) return fail("Project-scoped keys cannot create new projects. Ask the operator to provision one.", 403, "scoped_key");
  const db = await getDb();
  const b = await body<{ name?: string; surface?: string; targetUrl?: string; description?: string }>(req);
  if (!b.name?.trim()) return fail("Name is required");
  const surface = (SURFACES as readonly string[]).includes(b.surface ?? "") ? b.surface! : "web";
  const [row] = await db.insert(projects).values({ name: b.name.trim(), surface, targetUrl: b.targetUrl ?? "", description: b.description ?? "" }).returning();
  return ok(row, 201);
}
