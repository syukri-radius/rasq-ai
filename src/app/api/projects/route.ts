import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { SURFACES } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  return ok(await db.select().from(projects).orderBy(desc(projects.createdAt)));
}

export async function POST(req: Request) {
  const db = await getDb();
  const b = await body<{ name?: string; surface?: string; targetUrl?: string; description?: string }>(req);
  if (!b.name?.trim()) return fail("Name is required");
  const surface = (SURFACES as readonly string[]).includes(b.surface ?? "") ? b.surface! : "web";
  const [row] = await db.insert(projects).values({ name: b.name.trim(), surface, targetUrl: b.targetUrl ?? "", description: b.description ?? "" }).returning();
  return ok(row, 201);
}
