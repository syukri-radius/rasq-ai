import { lt } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, idempotencyKeys, webhookDeliveries } from "@/db/schema";
import { pruneUsageCounters } from "@/lib/rateLimit";

/**
 * Retention / garbage collection for append-only stores.
 *
 * Without this, `audit_log`, `idempotency_keys`, `webhook_deliveries` and `usage_counters`
 * grow without bound — a governance failure of its own (unbounded storage, broken backups,
 * slower audit queries). Retention is the operator's compliance dial:
 *
 *   RASQ_AUDIT_RETENTION_DAYS         (default 180) audit_log rows older than this are deleted
 *   RASQ_WEBHOOK_DELIVERY_RETENTION_DAYS (default 90) webhook_deliveries rows older than this
 *   RASQ_IDEMPOTENCY_RETENTION_HOURS  (default 25, just past the 24h replay window)
 *
 * IMPORTANT: deleting audit rows is irreversible. If your compliance regime requires WORM
 * storage for audit evidence, export via GET /api/audit?format=csv before the sweep runs,
 * and tune RASQ_AUDIT_RETENTION_DAYS accordingly — or set it very high and archive externally.
 */

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const auditRetentionDays = () => envInt("RASQ_AUDIT_RETENTION_DAYS", 180);
export const deliveryRetentionDays = () => envInt("RASQ_WEBHOOK_DELIVERY_RETENTION_DAYS", 90);
export const idempotencyRetentionHours = () => envInt("RASQ_IDEMPOTENCY_RETENTION_HOURS", 25);

export type RetentionResult = { auditDeleted: number; idempotencyDeleted: number; deliveriesDeleted: number; countersDeleted: number };

export async function runRetentionSweep(db: Db, now = Date.now()): Promise<RetentionResult> {
  const auditCut = new Date(now - auditRetentionDays() * 24 * 60 * 60 * 1000);
  const idemCut = new Date(now - idempotencyRetentionHours() * 60 * 60 * 1000);
  const deliveryCut = new Date(now - deliveryRetentionDays() * 24 * 60 * 60 * 1000);
  const rowsAffected = (r: unknown) => (r as { rowsAffected?: number })?.rowsAffected ?? 0;
  const [a, i, d, c] = await Promise.all([
    db.delete(auditLog).where(lt(auditLog.createdAt, auditCut)),
    db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, idemCut)),
    db.delete(webhookDeliveries).where(lt(webhookDeliveries.createdAt, deliveryCut)),
    pruneUsageCounters(db, now),
  ]);
  return { auditDeleted: rowsAffected(a), idempotencyDeleted: rowsAffected(i), deliveriesDeleted: rowsAffected(d), countersDeleted: c };
}

let lastSweep = 0;
/** Throttled, best-effort in-process sweep (at most once per 10 minutes). Never throws into the caller. */
export async function maybeRunRetentionSweep(db: Db): Promise<RetentionResult | null> {
  if (Date.now() - lastSweep < 10 * 60_000) return null;
  lastSweep = Date.now();
  try {
    return await runRetentionSweep(db);
  } catch (e) {
    console.warn("retention sweep failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
