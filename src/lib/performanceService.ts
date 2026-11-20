import { and, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { performanceRuns } from "@/db/schema";
import { notifyWebhooks, performanceRunCompletedData } from "@/lib/webhooks";

/** Performance runs are in-process; a restart past the 120s deadline strands them. Mark them error honestly and notify webhooks. */
export async function failStalePerformanceRuns(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - 120_000);
  const stale = await db.select({ id: performanceRuns.id }).from(performanceRuns).where(and(eq(performanceRuns.status, "running"), lt(performanceRuns.startedAt, cutoff)));
  if (!stale.length) return 0;
  await db.update(performanceRuns).set({ status: "error", error: "Run interrupted or exceeded the server deadline.", completedAt: new Date() }).where(and(inArray(performanceRuns.id, stale.map((r) => r.id)), eq(performanceRuns.status, "running")));
  const rows = await db.select().from(performanceRuns).where(inArray(performanceRuns.id, stale.map((r) => r.id)));
  for (const row of rows) notifyWebhooks(db, "performance.run.completed", performanceRunCompletedData(row));
  return rows.length;
}

/** Notify webhooks for a performance run that just reached a terminal state. */
export async function notifyPerformanceRunCompleted(db: Db, id: string): Promise<void> {
  const [row] = await db.select().from(performanceRuns).where(eq(performanceRuns.id, id));
  if (!row) return;
  notifyWebhooks(db, "performance.run.completed", performanceRunCompletedData(row));
}
