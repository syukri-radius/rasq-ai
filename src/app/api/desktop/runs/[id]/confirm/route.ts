import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runs } from "@/db/schema";
import { fail, ok, type Params } from "@/lib/api";
import { authorize } from "@/lib/agentAuth";
import { projectAllowed, projectDeny, runProjectId } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "desktop:confirm");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const db = await getDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run || run.executor !== "robotjs-desktop") return fail("Desktop run not found", 404);
  const pid = await runProjectId(db, id);
  if (pid && !projectAllowed(auth.actor, pid)) return projectDeny();
  if (run.desktopSessionState !== "awaiting-operator-confirmation" || run.status !== "running") return fail("Desktop run is not awaiting operator confirmation.", 409);
  if (run.desktopCancelRequested) return fail("Desktop run has been cancelled.", 409);
  await db.update(runs).set({ desktopConfirmedAt: new Date() }).where(eq(runs.id, id));
  return ok({ confirmed: true });
}
