import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireOperator } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";

const LIMIT = 100;

/**
 * Delivery history for webhook endpoints. `?webhookId=` scopes to one endpoint.
 * Secrets and signatures are never included. Operator only.
 */
export async function GET(req: Request) {
  const auth = await requireOperator(req, "webhook delivery history");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const webhookId = url.searchParams.get("webhookId");
  const db = await getDb();
  if (webhookId) {
    const [exists] = await db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.id, webhookId));
    if (!exists) return fail("Webhook not found", 404, "not_found");
    const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, webhookId)).orderBy(desc(webhookDeliveries.createdAt)).limit(LIMIT);
    return ok(rows);
  }
  const rows = await db.select().from(webhookDeliveries).orderBy(desc(webhookDeliveries.createdAt)).limit(LIMIT);
  const names = new Map((await db.select({ id: webhooks.id, name: webhooks.name }).from(webhooks).where(inArray(webhooks.id, [...new Set(rows.map((r) => r.webhookId))]))).map((w) => [w.id, w.name]));
  return ok(rows.map((r) => ({ ...r, webhookName: names.get(r.webhookId) ?? null })));
}
