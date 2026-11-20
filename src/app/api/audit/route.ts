import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { requireOperator } from "@/lib/agentAuth";
import { maybeRunRetentionSweep } from "@/lib/retention";

export const dynamic = "force-dynamic";

const MAX_PAGE = 1000;
const MAX_CSV_ROWS = 10_000;

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * Operator-only audit trail query/export.
 *
 * Query params: actorType, actorId, status, action (substring, case-insensitive), from, to (ISO 8601),
 * limit (1–1000, default 100), offset (default 0), format (json | csv).
 * CSV is capped at 10,000 rows; `x-total-count` and `x-returned-count` headers report the outcome.
 * External agent keys can never read this endpoint.
 */
export async function GET(req: Request) {
  const auth = await requireOperator(req, "audit log access");
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const p = (k: string) => url.searchParams.get(k)?.trim() ?? "";
  const actorType = p("actorType");
  const actorId = p("actorId");
  const status = p("status");
  const action = p("action");
  const format = p("format") || "json";
  if (format !== "json" && format !== "csv") return fail("format must be json or csv.", 400, "validation_failed");
  const limit = Math.min(MAX_PAGE, Math.max(1, Number(p("limit") || 100) || 100));
  const offset = Math.max(0, Number(p("offset") || 0) || 0);
  const parseTime = (v: string) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const from = p("from") ? parseTime(p("from")) : null;
  const to = p("to") ? parseTime(p("to")) : null;
  if (p("from") && !from) return fail("from must be an ISO 8601 date-time.", 400, "validation_failed");
  if (p("to") && !to) return fail("to must be an ISO 8601 date-time.", 400, "validation_failed");

  const conds: SQL[] = [];
  if (actorType) conds.push(eq(auditLog.actorType, actorType));
  if (actorId) conds.push(eq(auditLog.actorId, actorId));
  if (status) conds.push(eq(auditLog.status, status));
  if (action) conds.push(sql`instr(lower(${auditLog.action}), lower(${action})) > 0`);
  if (from) conds.push(gte(auditLog.createdAt, from));
  if (to) conds.push(lte(auditLog.createdAt, to));
  const where = conds.length ? and(...conds) : undefined;

  const db = await getDb();
  await maybeRunRetentionSweep(db);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(auditLog).where(where);

  if (format === "csv") {
    const rows = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(MAX_CSV_ROWS).offset(0);
    const head = ["id", "created_at", "actor_type", "actor_id", "actor_name", "action", "status", "detail", "ip"];
    const lines = [head.join(",")];
    for (const r of rows) lines.push([r.id, r.createdAt.toISOString(), r.actorType, r.actorId ?? "", r.actorName, r.action, r.status, r.detail, r.ip].map(csvCell).join(","));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new Response(lines.join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rasq-ai-audit-${stamp}.csv"`,
        "x-total-count": String(total),
        "x-returned-count": String(rows.length),
        "cache-control": "no-store",
      },
    });
  }

  const rows = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset);
  return ok({ rows, total, limit, offset });
}
