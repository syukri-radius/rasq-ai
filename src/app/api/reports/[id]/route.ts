import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { reports } from "@/db/schema";
import type { Params } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: Params<"id">) {
  const { id } = await params;
  const db = await getDb();
  const [r] = await db.select().from(reports).where(eq(reports.id, id));
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(r.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="rasq-ai-report.md"' } });
}
