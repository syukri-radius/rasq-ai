import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiProviders, modelRoutes } from "@/db/schema";
import { body, fail, ok } from "@/lib/api";

type P = { id?: string; name?: string; kind?: string; baseUrl?: string; apiKeyEnv?: string; models?: string[]; enabled?: boolean };

function clean(b: P) {
  const apiKeyEnv = (b.apiKeyEnv ?? "").trim();
  if (apiKeyEnv && !/^[A-Z][A-Z0-9_]{1,63}$/.test(apiKeyEnv)) throw new Error("apiKeyEnv must be an environment variable NAME (e.g. OPENAI_API_KEY), never the key itself.");
  const kind = b.kind ?? "openai";
  if (!["openai", "anthropic", "gemini"].includes(kind)) throw new Error("kind must be openai, anthropic or gemini");
  if (b.baseUrl && !/^https?:\/\//.test(b.baseUrl)) throw new Error("baseUrl must be http(s)");
  return { name: (b.name ?? "").trim(), kind, baseUrl: (b.baseUrl ?? "").trim(), apiKeyEnv, models: (b.models ?? []).map((m) => m.trim()).filter(Boolean), enabled: b.enabled ?? true };
}

export async function POST(req: Request) {
  try {
    const db = await getDb();
    const v = clean(await body<P>(req));
    if (!v.name) return fail("Name is required");
    const [row] = await db.insert(aiProviders).values(v).returning();
    return ok(row, 201);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid provider");
  }
}

export async function PATCH(req: Request) {
  try {
    const db = await getDb();
    const b = await body<P>(req);
    if (!b.id) return fail("id required");
    await db.update(aiProviders).set(clean(b)).where(eq(aiProviders.id, b.id));
    return ok();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid provider");
  }
}

export async function DELETE(req: Request) {
  const db = await getDb();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id required");
  await db.update(modelRoutes).set({ providerId: null, model: "" }).where(eq(modelRoutes.providerId, id));
  await db.delete(aiProviders).where(eq(aiProviders.id, id));
  return ok();
}
