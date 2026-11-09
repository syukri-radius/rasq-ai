import { z } from "zod";
import { getDb } from "@/db";
import { body, fail, ok, type Params } from "@/lib/api";
import { authenticateDesktopAgent } from "@/lib/desktopAuth";
import { applyDesktopEvents } from "@/lib/desktopService";

export const dynamic = "force-dynamic";
const EventBatchSchema = z.object({ events: z.array(z.unknown()).min(1).max(100) }).strict();

export async function POST(req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const agent = await authenticateDesktopAgent(req, db);
  if (!agent) return fail("Invalid or revoked desktop device credential", 401);
  try {
    const input = EventBatchSchema.parse(await body(req));
    return ok(await applyDesktopEvents(db, agent.id, id, input.events));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Desktop events were rejected", 409);
  }
}
