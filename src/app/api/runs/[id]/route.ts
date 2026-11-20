import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runSteps, runs } from "@/db/schema";
import { fail, ok, type Params } from "@/lib/api";
import { failStaleDesktopRuns } from "@/lib/desktopService";
import { authorize } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "runs:read");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const db = await getDb();
  await failStaleDesktopRuns(db);
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return fail("Not found", 404);
  const steps = await db.select().from(runSteps).where(eq(runSteps.runId, id)).orderBy(asc(runSteps.position));
  return ok({ run, steps });
}
