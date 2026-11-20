import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { workflows } from "@/db/schema";
import { body, fail, ok, type Params } from "@/lib/api";
import { validateN8n } from "@/lib/n8n";
import { authorize } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "workflows:read");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const db = await getDb();
  const [w] = await db.select().from(workflows).where(eq(workflows.id, id));
  return w ? ok(w) : fail("Not found", 404);
}

export async function PUT(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "workflows:write");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const db = await getDb();
    const b = await body<{ name?: string; n8n: unknown }>(req);
    const wf = validateN8n(b.n8n);
    const [cur] = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!cur) return fail("Not found", 404);
    const name = b.name?.trim() || wf.name;
    await db.update(workflows).set({ name, n8n: { ...wf, name } as never, version: cur.version + 1, updatedAt: new Date() }).where(eq(workflows.id, id));
    return ok({ version: cur.version + 1 });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid workflow");
  }
}

export async function DELETE(req: Request, { params }: Params<"id">) {
  const auth = await authorize(req, "delete:artifacts");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const db = await getDb();
  await db.delete(workflows).where(eq(workflows.id, id));
  return ok();
}
