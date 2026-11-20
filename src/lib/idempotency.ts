import { createHash } from "node:crypto";
import { lt, eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { fail } from "@/lib/api";
import type { Actor } from "@/lib/agentAuth";

/**
 * Idempotency-Key support for mutating routes (`POST /api/runs`, `POST /api/tests`, `POST /api/workflows`).
 *
 * Semantics:
 * - No header → passthrough context (store is a no-op); browser UI unchanged.
 * - First request with a key → executes; the 2xx response body/status is stored for 24h.
 * - Replay with the same key and same body → stored response is returned with `idempotent-replay: true`.
 * - Same key, different body (or different endpoint) → 409 `idempotency_conflict`.
 * - Error responses are not stored, so retries after transient failures re-execute.
 *
 * Usage in a route handler:
 *   const idem = await beginIdempotency(req, actor, "POST /api/tests", b);
 *   if (idem instanceof NextResponse) return idem; // replay or conflict
 *   ... on success: const payload = {…}; await idem.store(201, payload); return ok(payload, 201);
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^[A-Za-z0-9_\-:.]{8,255}$/;

function actorFingerprint(actor: Actor): string {
  return actor.kind === "agent" ? `agent:${actor.id}` : "operator";
}

/** Deterministic JSON stringify (sorted object keys) so body hashing is stable across clients. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export type IdempotencyContext = {
  /** Persist a successful response for future replays. Call only on 2xx outcomes you want replayed. */
  store: (status: number, payload: unknown) => Promise<void>;
};

export async function beginIdempotency(req: Request, actor: Actor, endpoint: string, parsedBody: unknown): Promise<IdempotencyContext | NextResponse> {
  const key = req.headers.get("idempotency-key");
  if (key === null) return { store: async () => {} }; // passthrough (UI)
  if (!KEY_RE.test(key)) return fail("Idempotency-Key must be 8–255 chars of [A-Za-z0-9_-:.].", 400, "invalid_idempotency_key");

  const db = await getDb();
  const actorFp = actorFingerprint(actor);
  const bodyHash = createHash("sha256").update(stableStringify(parsedBody ?? null)).digest("hex");

  // Opportunistic 24h purge.
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, new Date(Date.now() - TTL_MS)));

  const [existing] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.actor, actorFp), eq(idempotencyKeys.key, key))).limit(1);
  if (existing) {
    if (existing.endpoint !== endpoint || existing.bodyHash !== bodyHash) {
      return fail("Idempotency-Key was already used with a different request body.", 409, "idempotency_conflict");
    }
    return NextResponse.json(JSON.parse(existing.response), { status: existing.status, headers: { "idempotent-replay": "true" } });
  }
  return {
    store: async (status, payload) => {
      try {
        await db.insert(idempotencyKeys).values({ actor: actorFp, key, endpoint, bodyHash, status, response: JSON.stringify(payload ?? null), createdAt: new Date() }).onConflictDoNothing();
      } catch (e) {
        console.warn("idempotency store failed:", e instanceof Error ? e.message : e);
      }
    },
  };
}
