import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { apiKeys } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";
import { requireOperator, generateApiKey, isApiKeyScope, RECOMMENDED_AGENT_SCOPES, API_KEY_SCOPES } from "@/lib/agentAuth";
import { recordAudit, clientIp } from "@/lib/audit";

export const dynamic = "force-dynamic";

const CreateKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.string()).min(1).max(API_KEY_SCOPES.length),
    /** Days until the key expires; omit for a non-expiring key. */
    ttlDays: z.number().int().min(1).max(3650).optional(),
    /** Restrict the key to these project ids; omit/empty = all projects. */
    projectIds: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
    /** Max mutating calls per UTC day; omit/null = the server default (RASQ_AGENT_DAILY_MUTATIONS, 0 = unlimited). */
    dailyMutationLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  })
  .strict();

/** List API-key metadata (never hashes or plaintext). Operator only. */
export async function GET(req: Request) {
  const auth = await requireOperator(req, "API key management");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const rows = await db.select({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, scopes: apiKeys.scopes, projectIds: apiKeys.projectIds, dailyMutationLimit: apiKeys.dailyMutationLimit, lastUsedAt: apiKeys.lastUsedAt, expiresAt: apiKeys.expiresAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt }).from(apiKeys).orderBy(desc(apiKeys.createdAt));
  return ok(rows.map((r) => ({ ...r, status: r.revokedAt ? "revoked" : r.expiresAt && r.expiresAt.getTime() <= Date.now() ? "expired" : "active" })));
}

/** Mint a new API key. The plaintext is returned exactly once and is never stored. Operator only. */
export async function POST(req: Request) {
  const auth = await requireOperator(req, "API key management");
  if ("response" in auth) return auth.response;
  const parsed = CreateKeySchema.safeParse(await body(req));
  if (!parsed.success) return fail(`Invalid request: ${parsed.error.issues[0]?.message ?? "bad payload"}`, 400, "validation_failed");
  const scopes = [...new Set(parsed.data.scopes)];
  const unknown = scopes.filter((s) => !isApiKeyScope(s));
  if (unknown.length) return fail(`Unknown scopes: ${unknown.join(", ")}. Valid scopes: ${API_KEY_SCOPES.join(", ")}`, 400, "unknown_scope");
  const { key, keyPrefix, keyHash } = generateApiKey();
  const db = await getDb();
  const [row] = await db
    .insert(apiKeys)
    .values({ name: parsed.data.name, keyHash, keyPrefix, scopes, projectIds: parsed.data.projectIds ?? [], dailyMutationLimit: parsed.data.dailyMutationLimit ?? null, expiresAt: parsed.data.ttlDays ? new Date(Date.now() + parsed.data.ttlDays * 24 * 60 * 60 * 1000) : null })
    .returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, scopes: apiKeys.scopes, projectIds: apiKeys.projectIds, dailyMutationLimit: apiKeys.dailyMutationLimit, expiresAt: apiKeys.expiresAt, createdAt: apiKeys.createdAt });
  await recordAudit({ actorType: "operator", action: "POST /api/agent-keys", status: "ok", detail: `created key "${row.name}" (${row.id}) with scopes: ${scopes.join(",")}${row.projectIds.length ? `; partitioned to ${row.projectIds.length} project(s)` : ""}${row.dailyMutationLimit ? `; daily budget ${row.dailyMutationLimit}` : ""}`, ip: clientIp(req) });
  return ok({ ...row, key, recommended: RECOMMENDED_AGENT_SCOPES, warning: "Store this key now. It is shown once and cannot be recovered." }, 201);
}

/** Revoke an API key by id. Idempotent for already-revoked keys. Operator only. */
export async function DELETE(req: Request) {
  const auth = await requireOperator(req, "API key management");
  if ("response" in auth) return auth.response;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return fail("id required", 400, "id_required");
  const db = await getDb();
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id)).returning({ id: apiKeys.id, name: apiKeys.name });
  if (!row) return fail("Key not found", 404, "not_found");
  await recordAudit({ actorType: "operator", action: "DELETE /api/agent-keys", status: "ok", detail: `revoked key "${row.name}" (${row.id})`, ip: clientIp(req) });
  return ok({ revoked: true });
}
