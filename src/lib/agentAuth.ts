import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, type Db } from "@/db";
import { apiKeys } from "@/db/schema";
import { fail } from "@/lib/api";
import { recordAudit, clientIp } from "@/lib/audit";
import { consumeAgentMutationBudget } from "@/lib/rateLimit";

/**
 * External agent (machine) access for RASQ-Ai.
 *
 * Threat model (read AGENT_GUIDE.md before changing anything here):
 * - The browser UI remains a single-operator surface with no login; it only ever runs on a trusted host.
 * - External agents MUST authenticate with `Authorization: Bearer rasq_…` API keys managed by the operator.
 * - Keys are stored as SHA-256 hashes only; the plaintext is returned exactly once at creation.
 * - A request that carries an invalid/expired/revoked credential is rejected with 401 — it is never
 *   silently downgraded to the operator role.
 * - Authorization is scope-based; destructive, attending, and load-generating scopes are never
 *   granted by the recommended starter set.
 */

export const API_KEY_SCOPES = [
  // Read
  "projects:read",
  "screens:read",
  "requirements:read",
  "tests:read",
  "workflows:read",
  "runs:read",
  "reports:read",
  "performance:read",
  "settings:read",
  "desktop:read",
  // Generate / write (non-destructive)
  "projects:write",
  "screens:write",
  "requirements:write",
  "tests:generate",
  "workflows:write",
  "reports:generate",
  "settings:write",
  "providers:write",
  "ai:scan",
  "capture:run",
  "performance:plan",
  // Execution — explicitly separated, never in the recommended set
  "runs:start:dry-run",
  "runs:start:playwright",
  "performance:load",
  "desktop:attend",
  "desktop:confirm",
  "desktop:revoke",
  // Deletion — explicitly separated, never in the recommended set
  "delete:artifacts",
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Safe default grant for a new external agent: observe, generate, and dry-run — nothing destructive or inputs-affecting. */
export const RECOMMENDED_AGENT_SCOPES: ApiKeyScope[] = [
  "projects:read",
  "screens:read",
  "requirements:read",
  "tests:read",
  "tests:generate",
  "workflows:read",
  "workflows:write",
  "runs:read",
  "runs:start:dry-run",
  "reports:read",
];

export type Actor =
  | { kind: "operator" }
  | { kind: "agent"; id: string; name: string; keyPrefix: string; scopes: string[]; projectIds: string[]; dailyMutationLimit: number | null };

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Generate a new plaintext key. Only `keyHash` (and a display prefix) may be persisted. */
export function generateApiKey() {
  const key = `rasq_${randomBytes(30).toString("base64url")}`;
  return { key, keyPrefix: `${key.slice(0, 10)}…`, keyHash: hashApiKey(key) };
}

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

const RASQ_KEY_RE = /^rasq_[A-Za-z0-9_-]{20,300}$/;

export function bearerToken(req: Request): string {
  const match = /^Bearer ([A-Za-z0-9_-]{8,400})$/.exec(req.headers.get("authorization") ?? "");
  return match?.[1] ?? "";
}

/**
 * Resolve the caller.
 * Returns `{ actor }` on success, or `{ response }` with a ready 401 when credentials are present but unusable.
 * No Authorization header means the single-operator browser session (unchanged behavior).
 */
export async function resolveActor(req: Request, existingDb?: Db): Promise<{ actor: Actor } | { response: NextResponse }> {
  const header = req.headers.get("authorization");
  if (!header) return { actor: { kind: "operator" } };
  const token = bearerToken(req);
  if (!token || !RASQ_KEY_RE.test(token)) {
    await recordAudit({ actorType: "unauthenticated", action: actionLabel(req), status: "denied", detail: "unsupported or malformed credential", ip: clientIp(req) });
    return { response: fail("Invalid or expired API key.", 401, "invalid_api_key") };
  }
  const db = existingDb ?? (await getDb());
  const hash = hashApiKey(token);
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
  const valid = row && !row.revokedAt && (!row.expiresAt || row.expiresAt.getTime() > Date.now());
  if (!valid) {
    await recordAudit({ actorType: "unauthenticated", action: actionLabel(req), status: "denied", detail: "unknown, revoked or expired key", ip: clientIp(req) });
    return { response: fail("Invalid or expired API key.", 401, "invalid_api_key") };
  }
  // Best-effort last-used stamp, throttled to avoid a write on every request.
  try {
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
    }
  } catch {
    /* non-fatal */
  }
  return { actor: { kind: "agent", id: row.id, name: row.name, keyPrefix: row.keyPrefix, scopes: row.scopes, projectIds: Array.isArray(row.projectIds) ? row.projectIds : [], dailyMutationLimit: row.dailyMutationLimit ?? null } };
}

/**
 * Fixed-window rate limiting is database-backed (usage_counters table) so it holds across
 * restarts and every code path in this single-node deployment. The per-minute budget defaults
 * to 120 (RASQ_AGENT_RATE_LIMIT); per-key daily mutation budgets default to the server-wide
 * RASQ_AGENT_DAILY_MUTATIONS (0 = unlimited) and may be overridden per key.
 * Fail-closed: if the counter cannot be written, the mutation is refused with 503.
 */

const actionLabel = (req: Request) => `${req.method} ${new URL(req.url).pathname}`;

/**
 * Authorize one route handler.
 * - operator: allowed (single-operator app), mutations are audited.
 * - agent:    requires `scope`; mutations are rate-limited and audited; denials are audited.
 * Usage: `const auth = await authorize(req, "tests:read"); if ("response" in auth) return auth.response;`
 */
export async function authorize(req: Request, scope: ApiKeyScope): Promise<{ actor: Actor } | { response: NextResponse }> {
  const resolved = await resolveActor(req);
  if ("response" in resolved) return resolved;
  const { actor } = resolved;
  const action = actionLabel(req);
  const mutation = req.method !== "GET" && req.method !== "HEAD";
  if (actor.kind === "agent") {
    // Scope check first: an unauthorized call must not burn the key's rate/daily budget.
    if (!actor.scopes.includes(scope)) {
      await recordAudit({ actorType: "agent", actorId: actor.id, actorName: actor.name, action, status: "denied", detail: `missing scope ${scope}`, ip: clientIp(req) });
      return { response: fail(`API key is missing the required scope: ${scope}`, 403, "insufficient_scope") };
    }
    if (mutation) {
      try {
        const budget = await consumeAgentMutationBudget(await getDb(), actor.id, { dailyMutationLimit: actor.dailyMutationLimit });
        if (!budget.ok) {
          const day = budget.reason === "day";
          await recordAudit({ actorType: "agent", actorId: actor.id, actorName: actor.name, action, status: "denied", detail: day ? "daily mutation budget exceeded" : "rate limit exceeded", ip: clientIp(req) });
          return { response: fail(day ? "Daily mutation budget exceeded. Ask the operator to raise it, or wait for the UTC day to roll over." : "Rate limit exceeded; slow down or contact the operator.", 429, day ? "daily_budget_exceeded" : "rate_limited") };
        }
      } catch (e) {
        console.warn("agent rate limiter unavailable:", e instanceof Error ? e.message : e);
        await recordAudit({ actorType: "agent", actorId: actor.id, actorName: actor.name, action, status: "denied", detail: "rate limiter unavailable (fail-closed)", ip: clientIp(req) });
        return { response: fail("Rate limiter unavailable; mutation refused (fail-closed). Retry later.", 503, "rate_limiter_unavailable") };
      }
    }
    if (mutation) await recordAudit({ actorType: "agent", actorId: actor.id, actorName: actor.name, action, status: "ok", detail: `scope ${scope}`, ip: clientIp(req) });
    return { actor };
  }
  if (mutation) await recordAudit({ actorType: "operator", actorName: "operator", action, status: "ok", ip: clientIp(req) });
  return { actor };
}

/** Operator-only guard for key/webhook management routes: agents (even valid ones) may not mint, list, revoke keys or manage webhook endpoints. */
export async function requireOperator(req: Request, subject = "this action"): Promise<{ actor: Actor } | { response: NextResponse }> {
  const header = req.headers.get("authorization");
  if (!header) return { actor: { kind: "operator" } };
  const resolved = await resolveActor(req);
  if ("response" in resolved) return resolved;
  await recordAudit({ actorType: "agent", actorId: resolved.actor.kind === "agent" ? resolved.actor.id : null, actorName: resolved.actor.kind === "agent" ? resolved.actor.name : "", action: actionLabel(req), status: "denied", detail: `agents may not perform ${subject}`, ip: clientIp(req) });
  return { response: fail(`Only the operator may perform ${subject}.`, 403, "operator_only") };
}

/** Constant-time equality for secrets of equal length; used by the CLI and tests. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
