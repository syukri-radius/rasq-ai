import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { reports } from "@/db/schema";
import type { Params } from "@/lib/api";
import { authorize } from "@/lib/agentAuth";
import { projectAllowed, projectDeny } from "@/lib/projectAccess";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "reports:read");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const db = await getDb();
  const [r] = await db.select().from(reports).where(eq(reports.id, id));
  if (!r) return new Response("Not found", { status: 404 });
  if (!projectAllowed(auth.actor, r.projectId)) return projectDeny();
  return new Response(r.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="rasq-ai-report.md"' } });
}
