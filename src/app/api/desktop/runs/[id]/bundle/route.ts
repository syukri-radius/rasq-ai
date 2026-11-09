import { createHash } from "node:crypto";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { runs } from "@/db/schema";
import { fail, type Params } from "@/lib/api";
import { authenticateDesktopAgent } from "@/lib/desktopAuth";
import { desktopBundlePath } from "@/lib/desktopService";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const agent = await authenticateDesktopAgent(req, db);
  if (!agent) return fail("Invalid or revoked desktop device credential", 401);
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run || run.desktopAgentId !== agent.id || run.executor !== "robotjs-desktop") return fail("Desktop run is not assigned to this agent", 404);
  if (run.desktopCancelRequested) return fail("Desktop run was cancelled before bundle retrieval.", 409);
  try {
    const bytes = await fs.promises.readFile(desktopBundlePath(id));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== run.desktopBundleSha256) return fail("Desktop bundle integrity mismatch; execution is blocked.", 409);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/zip", "x-rasq-bundle-sha256": actual, "cache-control": "no-store" } });
  } catch {
    return fail("Desktop bundle is unavailable", 404);
  }
}
