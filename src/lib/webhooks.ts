import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { runs, webhookDeliveries, webhooks } from "@/db/schema";
import { APP_VERSION } from "@/lib/version";

/**
 * Outbound webhooks for terminal run events (Wave C — interoperability).
 *
 * Design rules:
 * - Envelope and signature are Stripe-style and STABLE: receivers verify `x-rasq-signature`.
 * - Delivery is best-effort, in-process (like the rest of this single-operator app): it never
 *   blocks or fails the run that triggered it. Each attempt is recorded in `webhook_deliveries`.
 * - Secrets are generated per endpoint (`whsec_…`), shown once at creation, stored in the
 *   database so deliveries can be signed. Protect `data/` like any credential store.
 * - Only terminal events are emitted; there is no streaming firehose.
 */

export const WEBHOOK_EVENTS = ["run.completed", "desktop.run.completed", "performance.run.completed", "webhook.test"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
export const isWebhookEvent = (v: string): v is WebhookEventType => (WEBHOOK_EVENTS as readonly string[]).includes(v);

export type WebhookEvent = {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: Record<string, unknown>;
};

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function buildEvent(type: WebhookEventType, data: Record<string, unknown>): WebhookEvent {
  return { id: `evt_${randomUUID()}`, type, createdAt: new Date().toISOString(), data };
}

/** `v1=<hex>` over `${timestampSeconds}.${rawBody}` — the value carried in `x-rasq-signature`. */
export function signWebhook(secret: string, timestampSeconds: number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex")}`;
}

/** Receiver-side verification helper (also used by tests and the docs' examples). */
export function verifyWebhookSignature(opts: { secret: string; timestampSeconds: number; rawBody: string; signature: string; toleranceSeconds?: number; nowSeconds?: number }): boolean {
  const { secret, timestampSeconds, rawBody, signature, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000) } = opts;
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;
  const expected = signWebhook(secret, timestampSeconds, rawBody);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type DeliveryResult = { ok: boolean; httpStatus: number | null; error: string };

/** Single signed delivery attempt. Records the outcome; never throws. */
export async function deliverWebhook(db: Db, webhook: { id: string; url: string; secret: string }, event: WebhookEvent, attempt = 1): Promise<DeliveryResult> {
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signWebhook(webhook.secret, timestamp, rawBody);
  let result: DeliveryResult;
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `rasq-ai/${APP_VERSION} webhooks`,
        "x-rasq-webhook-id": event.id,
        "x-rasq-webhook-timestamp": String(timestamp),
        "x-rasq-signature": signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    result = res.ok
      ? { ok: true, httpStatus: res.status, error: "" }
      : { ok: false, httpStatus: res.status, error: `Receiver returned HTTP ${res.status}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result = { ok: false, httpStatus: null, error: message.split("\n")[0].slice(0, 300) };
  }
  try {
    await db.insert(webhookDeliveries).values({ webhookId: webhook.id, eventType: event.type, status: result.ok ? "ok" : "failed", httpStatus: result.httpStatus, error: result.error, attempt });
    await db.update(webhooks).set({ lastDeliveryAt: new Date(), lastStatus: result.ok ? "ok" : "failed" }).where(eq(webhooks.id, webhook.id));
  } catch (e) {
    console.warn("webhook delivery bookkeeping failed:", e instanceof Error ? e.message : e);
  }
  return result;
}

/** Fire-and-forget fan-out to enabled endpoints subscribed to `type`. Retries: immediate, +2s, +10s. */
export function notifyWebhooks(db: Db, type: WebhookEventType, data: Record<string, unknown>): void {
  void (async () => {
    try {
      const rows = await db.select().from(webhooks).where(eq(webhooks.enabled, true));
      const targets = rows.filter((w) => Array.isArray(w.events) && w.events.includes(type));
      if (!targets.length) return;
      const event = buildEvent(type, data);
      for (const target of targets) {
        void deliverWithRetry(db, target, event).catch((e) => console.warn("webhook delivery failed:", e instanceof Error ? e.message : e));
      }
    } catch (e) {
      console.warn("webhook fan-out failed:", e instanceof Error ? e.message : e);
    }
  })();
}

async function deliverWithRetry(db: Db, target: { id: string; url: string; secret: string }, event: WebhookEvent): Promise<void> {
  const backoffMs = [0, 2_000, 10_000];
  for (let attempt = 1; attempt <= backoffMs.length; attempt++) {
    const wait = attempt === 1 ? 0 : backoffMs[attempt - 1];
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const result = await deliverWebhook(db, target, event, attempt);
    if (result.ok) return;
  }
}

/** Payload builders keep one vocabulary across runner, desktop and performance completions. */
export function runCompletedData(run: {
  id: string;
  workflowId: string;
  mode: string;
  status: string;
  executor: string;
  desktopDriver: string | null;
  summary: Record<string, number> | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}): Record<string, unknown> {
  return {
    runId: run.id,
    workflowId: run.workflowId,
    mode: run.mode,
    status: run.status,
    executor: run.executor,
    driver: run.desktopDriver || null,
    summary: run.summary ?? {},
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export function performanceRunCompletedData(run: {
  id: string;
  planId: string;
  status: string;
  summary: unknown;
  error: string;
  startedAt: Date;
  completedAt: Date | null;
}): Record<string, unknown> {
  return {
    runId: run.id,
    planId: run.planId,
    status: run.status,
    summary: run.summary ?? null,
    error: run.error || null,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

/** Load a run with the fields the builders need (used by the runner's terminal path). */
export async function loadRunForEvent(db: Db, runId: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  return run ?? null;
}
