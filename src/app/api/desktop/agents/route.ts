import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { desktopAgents } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { failStaleDesktopRuns, publicDesktopAgent } from "@/lib/desktopService";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  await failStaleDesktopRuns(db);
  const rows = await db.select().from(desktopAgents).orderBy(desc(desktopAgents.createdAt));
  return ok(rows.map(publicDesktopAgent));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return fail("Agent id required");
  const db = await getDb();
  const [agent] = await db.update(desktopAgents).set({ revokedAt: new Date(), availability: "revoked", currentRunId: null }).where(eq(desktopAgents.id, id)).returning();
  if (!agent) return fail("Agent not found", 404);
  await failStaleDesktopRuns(db);
  return ok({ revoked: true });
}
