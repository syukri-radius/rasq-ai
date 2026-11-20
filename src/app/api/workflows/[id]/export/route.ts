import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { workflows } from "@/db/schema";
import type { Params } from "@/lib/api";
import { authorize } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";

/** Downloads the workflow in n8n-compatible JSON. */
export async function GET(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "workflows:read");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const db = await getDb();
  const [w] = await db.select().from(workflows).where(eq(workflows.id, id));
  if (!w) return new Response("Not found", { status: 404 });
  const file = w.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "workflow";
  return new Response(JSON.stringify(w.n8n, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${file}.n8n.json"` } });
}
