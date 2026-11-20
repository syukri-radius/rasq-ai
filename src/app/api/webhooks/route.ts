import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { webhooks } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { requireOperator } from "@/lib/agentAuth";
import { recordAudit, clientIp } from "@/lib/audit";
import { WEBHOOK_EVENTS, generateWebhookSecret, isWebhookEvent } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

const MAX_WEBHOOKS = 25;

const CreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: z.string().trim().min(1).max(2048),
    events: z.array(z.string()).min(1).max(WEBHOOK_EVENTS.length),
    enabled: z.boolean().optional().default(true),
  })
  .strict();
const PatchSchema = z.object({ id: z.string().uuid(), enabled: z.boolean() }).strict();

function validateUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("url must be a valid http(s) URL.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("url must use http(s).");
  if (url.username || url.password) throw new Error("url must not contain credentials; use your receiver's auth on its side.");
  return url.toString();
}

const mask = (w: typeof webhooks.$inferSelect) => ({
  id: w.id,
  name: w.name,
  url: w.url,
  events: w.events,
  enabled: w.enabled,
  lastDeliveryAt: w.lastDeliveryAt,
  lastStatus: w.lastStatus,
  createdAt: w.createdAt,
});

/** List webhook endpoints (secrets are never returned). Operator only. */
export async function GET(req: Request) {
  const auth = await requireOperator(req, "webhook management");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const rows = await db.select().from(webhooks).orderBy(desc(webhooks.createdAt));
  return ok(rows.map(mask));
}

/** Create a webhook. The signing secret is returned once and never listed back. Operator only. */
export async function POST(req: Request) {
  const auth = await requireOperator(req, "webhook management");
  if ("response" in auth) return auth.response;
  const parsed = CreateSchema.safeParse(await body(req));
  if (!parsed.success) return fail(`Invalid request: ${parsed.error.issues[0]?.message ?? "bad payload"}`, 400, "validation_failed");
  const events = [...new Set(parsed.data.events)];
  const unknown = events.filter((e) => !isWebhookEvent(e));
  if (unknown.length) return fail(`Unknown events: ${unknown.join(", ")}. Valid events: ${WEBHOOK_EVENTS.join(", ")}`, 400, "unknown_event");
  let url: string;
  try {
    url = validateUrl(parsed.data.url);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid url", 400, "invalid_url");
  }
  const db = await getDb();
  if ((await db.select({ id: webhooks.id }).from(webhooks)).length >= MAX_WEBHOOKS) return fail(`At most ${MAX_WEBHOOKS} webhooks are supported.`, 409, "limit_reached");
  const secret = generateWebhookSecret();
  const [row] = await db.insert(webhooks).values({ name: parsed.data.name, url, secret, events, enabled: parsed.data.enabled }).returning();
  await recordAudit({ actorType: "operator", action: "POST /api/webhooks", status: "ok", detail: `created webhook "${row.name}" (${row.id}) events: ${events.join(",")}`, ip: clientIp(req) });
  return ok({ ...mask(row), secret, warning: "Store this signing secret now — it is shown once. Deliveries are signed with HMAC-SHA256; see AGENT_GUIDE.md#webhooks." }, 201);
}

/** Enable/disable a webhook. Operator only. */
export async function PATCH(req: Request) {
  const auth = await requireOperator(req, "webhook management");
  if ("response" in auth) return auth.response;
  const parsed = PatchSchema.safeParse(await body(req));
  if (!parsed.success) return fail("Invalid request: expected { id: uuid, enabled: boolean }.", 400, "validation_failed");
  const db = await getDb();
  const [row] = await db.update(webhooks).set({ enabled: parsed.data.enabled }).where(eq(webhooks.id, parsed.data.id)).returning();
  if (!row) return fail("Webhook not found", 404, "not_found");
  await recordAudit({ actorType: "operator", action: "PATCH /api/webhooks", status: "ok", detail: `${parsed.data.enabled ? "enabled" : "disabled"} webhook "${row.name}" (${row.id})`, ip: clientIp(req) });
  return ok(mask(row));
}

/** Delete a webhook (deliveries are cascade-deleted). Operator only. */
export async function DELETE(req: Request) {
  const auth = await requireOperator(req, "webhook management");
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return fail("id required", 400, "id_required");
  const db = await getDb();
  const [row] = await db.delete(webhooks).where(eq(webhooks.id, id)).returning({ id: webhooks.id, name: webhooks.name });
  if (!row) return fail("Webhook not found", 404, "not_found");
  await recordAudit({ actorType: "operator", action: "DELETE /api/webhooks", status: "ok", detail: `deleted webhook "${row.name}" (${row.id})`, ip: clientIp(req) });
  return ok({ deleted: true });
}
