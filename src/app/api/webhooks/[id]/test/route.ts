import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { webhooks } from "@/db/schema";
import { fail, ok, type Params } from "@/lib/api";
import { requireOperator } from "@/lib/agentAuth";
import { recordAudit, clientIp } from "@/lib/audit";
import { buildEvent, deliverWebhook } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/**
 * Send a synthetic `webhook.test` event to one endpoint, synchronously.
 * Returns the receiver's outcome and records the attempt like any real delivery. Operator only.
 */
export async function POST(req: Request, { params }: Params<"id">) {
  const auth = await requireOperator(req, "webhook test delivery");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const db = await getDb();
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, id));
  if (!row) return fail("Webhook not found", 404, "not_found");
  const event = buildEvent("webhook.test", { message: "RASQ-Ai test event", webhookId: row.id, webhookName: row.name });
  const result = await deliverWebhook(db, row, event, 1);
  await recordAudit({ actorType: "operator", action: "POST /api/webhooks/{id}/test", status: "ok", detail: `test event to webhook "${row.name}" (${row.id}): ${result.ok ? "ok" : `failed (${result.error})`}`, ip: clientIp(req) });
  return ok({ delivered: result.ok, httpStatus: result.httpStatus, error: result.error || null, eventId: event.id }, result.ok ? 200 : 502);
}
