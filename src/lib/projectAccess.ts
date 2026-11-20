import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { performancePlans, performanceRuns, reports, requirementDocs, runs, screens, recordings, workflows } from "@/db/schema";
import type { Actor } from "@/lib/agentAuth";
import { fail } from "@/lib/api";

/**
 * Tenancy-lite: project partitioning for external-agent API keys.
 *
 * - `api_keys.project_ids` empty (default) = the key may act on every project, preserving pre-1.3.0 behavior.
 * - A non-empty list restricts the key to those projects. Cross-project access answers 404
 *   (not 403) so partitions do not reveal which project ids exist — the standard anti-enumeration choice.
 * - List endpoints filter silently to the allowed set instead of leaking foreign rows.
 * - This is NOT tenant isolation: the operator sees everything, the browser UI is unchanged,
 *   and deployment-global surfaces (settings, providers, desktop device protocol, capture/ai-scan
 *   which carry no project id) are not partitioned. RBAC/SSO remain Wave 0 roadmap work.
 */

export const PROJECT_PARTITIONED_DETAIL = "project-scoped API key";

export function projectAllowed(actor: Actor, projectId: string): boolean {
  if (actor.kind === "operator") return true;
  const ids = actor.projectIds ?? [];
  return ids.length === 0 || ids.includes(projectId);
}

/** Keep only rows in the actor's partition (operator and unpartitioned keys see everything). */
export function filterProjects<T extends { projectId: string }>(actor: Actor, rows: T[]): T[] {
  if (actor.kind === "operator") return rows;
  const ids = actor.projectIds ?? [];
  return ids.length === 0 ? rows : rows.filter((r) => ids.includes(r.projectId));
}

/** 404 deny for partition violations. Deliberately indistinguishable from a missing artifact. */
export const projectDeny = () => fail("Artifact not found.", 404, "not_found");

/** Resolve the owning project id for project-bearing artifacts; null when the artifact does not exist. */
export const workflowProjectId = async (db: Db, workflowId: string) =>
  (await db.select({ projectId: workflows.projectId }).from(workflows).where(eq(workflows.id, workflowId)))[0]?.projectId ?? null;

export const runProjectId = async (db: Db, runId: string) =>
  (await db.select({ projectId: workflows.projectId }).from(runs).innerJoin(workflows, eq(workflows.id, runs.workflowId)).where(eq(runs.id, runId)))[0]?.projectId ?? null;

export const planProjectId = async (db: Db, planId: string) =>
  (await db.select({ projectId: performancePlans.projectId }).from(performancePlans).where(eq(performancePlans.id, planId)))[0]?.projectId ?? null;

export const performanceRunProjectId = async (db: Db, runId: string) =>
  (await db.select({ projectId: performancePlans.projectId }).from(performanceRuns).innerJoin(performancePlans, eq(performancePlans.id, performanceRuns.planId)).where(eq(performanceRuns.id, runId)))[0]?.projectId ?? null;

export const docProjectId = async (db: Db, docId: string) =>
  (await db.select({ projectId: requirementDocs.projectId }).from(requirementDocs).where(eq(requirementDocs.id, docId)))[0]?.projectId ?? null;

export const reportProjectId = async (db: Db, reportId: string) =>
  (await db.select({ projectId: reports.projectId }).from(reports).where(eq(reports.id, reportId)))[0]?.projectId ?? null;

export const screenProjectId = async (db: Db, screenId: string) =>
  (await db.select({ projectId: screens.projectId }).from(screens).where(eq(screens.id, screenId)))[0]?.projectId ?? null;

export const recordingProjectId = async (db: Db, recordingId: string) =>
  (await db.select({ projectId: recordings.projectId }).from(recordings).where(eq(recordings.id, recordingId)))[0]?.projectId ?? null;
