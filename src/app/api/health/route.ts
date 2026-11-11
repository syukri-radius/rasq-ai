import { getDb } from "@/db";
import { APP_VERSION } from "@/lib/version";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.run(sql`select 1`);
    return Response.json({ ok: true, engine: "libsql/sqlite", app: "RASQ-Ai", version: APP_VERSION });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
