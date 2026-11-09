import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runSteps, runs } from "@/db/schema";
import { fail, ok, type Params } from "@/lib/api";
import { failStaleDesktopRuns } from "@/lib/desktopService";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  await failStaleDesktopRuns(db);
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return fail("Not found", 404);
  const steps = await db.select().from(runSteps).where(eq(runSteps.runId, id)).orderBy(asc(runSteps.position));
  return ok({ run, steps });
}
