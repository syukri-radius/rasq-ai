import { getDb } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditStatus = "ok" | "denied";

/**
 * Append-only audit trail for agent and operator mutations.
 * Best-effort by design: a failed audit write never breaks the request, it logs to stderr instead.
 * Detail is truncated and must never contain secrets.
 */
export async function recordAudit(opts: {
  actorType: "operator" | "agent" | "unauthenticated";
  actorId?: string | null;
  actorName?: string;
  action: string;
  status: AuditStatus;
  detail?: string;
  ip?: string;
}) {
  try {
    const db = await getDb();
    await db.insert(auditLog).values({
      actorType: opts.actorType,
      actorId: opts.actorId ?? null,
      actorName: (opts.actorName ?? "").slice(0, 200),
      action: opts.action.slice(0, 200),
      status: opts.status,
      detail: (opts.detail ?? "").slice(0, 500),
      ip: (opts.ip ?? "").slice(0, 100),
    });
  } catch (e) {
    console.warn("audit log write failed:", e instanceof Error ? e.message : e);
  }
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
}
