import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { usageCounters } from "@/db/schema";

/**
 * Database-backed fixed-window rate limiting and per-key daily mutation budgets.
 *
 * Replaces the pre-1.3.0 in-process limiter: counters live in `usage_counters` so they
 * survive restarts and are shared by every code path in this single-node deployment.
 * This is NOT a distributed limiter (one SQLite file); multi-instance deployments must
 * move this behind an external store — see GUARDRAILS.md.
 *
 * Fail-closed policy: if the counter cannot be read/written, the caller (authorize())
 * denies the mutation with 503 instead of letting an unmeasured agent run free.
 */

const DEFAULT_PER_MINUTE = Number(process.env.RASQ_AGENT_RATE_LIMIT ?? 120) || 120;
const DEFAULT_PER_DAY = Number(process.env.RASQ_AGENT_DAILY_MUTATIONS ?? 0) || 0; // 0 = unlimited

export function agentBudgets(): { perMinute: number; perDay: number } {
  return { perMinute: Math.max(1, DEFAULT_PER_MINUTE), perDay: Math.max(0, DEFAULT_PER_DAY) };
}

/** Per-key day budget: explicit key limit wins, else the server-wide default, else unlimited (0). */
export function dailyBudgetFor(keyLimit: number | null | undefined): number {
  if (keyLimit !== null && keyLimit !== undefined) return Math.max(0, keyLimit);
  return agentBudgets().perDay;
}

export type AgentBudgetResult = { ok: true; minuteCount: number; dayCount: number | null } | { ok: false; reason: "minute" | "day" };

async function bump(db: Db, keyId: string, period: "minute" | "day", bucket: string): Promise<number> {
  const [row] = await db
    .insert(usageCounters)
    .values({ keyId, period, bucket, count: 1 })
    .onConflictDoUpdate({ target: [usageCounters.keyId, usageCounters.period, usageCounters.bucket], set: { count: sql`${usageCounters.count} + 1` } })
    .returning({ count: usageCounters.count });
  return row.count;
}

/** Atomically increment this key's minute (and optionally day) counter; report whether the call fits the budget. */
export async function consumeAgentMutationBudget(db: Db, keyId: string, opts: { perMinute?: number; dailyMutationLimit?: number | null } = {}): Promise<AgentBudgetResult> {
  const perMinute = Math.max(1, opts.perMinute ?? agentBudgets().perMinute);
  const perDay = dailyBudgetFor(opts.dailyMutationLimit);
  const now = Date.now();
  const minuteBucket = String(Math.floor(now / 60_000));
  const minuteCount = await bump(db, keyId, "minute", minuteBucket);
  if (minuteCount > perMinute) return { ok: false, reason: "minute" };
  if (perDay > 0) {
    const dayBucket = new Date(now).toISOString().slice(0, 10); // UTC day
    const dayCount = await bump(db, keyId, "day", dayBucket);
    if (dayCount > perDay) return { ok: false, reason: "day" };
    return { ok: true, minuteCount, dayCount };
  }
  return { ok: true, minuteCount, dayCount: null };
}

/** Delete expired counter rows. Minute buckets: older than 2 days. Day buckets: older than 400 days. */
export async function pruneUsageCounters(db: Db, now = Date.now()): Promise<number> {
  const minuteCut = String(Math.floor((now - 2 * 24 * 60 * 60 * 1000) / 60_000));
  const dayCut = new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rowsAffected = (r: unknown) => (r as { rowsAffected?: number })?.rowsAffected ?? 0;
  const a = await db.delete(usageCounters).where(and(eq(usageCounters.period, "minute"), lt(usageCounters.bucket, minuteCut)));
  const b = await db.delete(usageCounters).where(and(eq(usageCounters.period, "day"), lt(usageCounters.bucket, dayCut)));
  return rowsAffected(a) + rowsAffected(b);
}
