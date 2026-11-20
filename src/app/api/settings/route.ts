import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiProviders, modelRoutes, policies, settings } from "@/db/schema";
import { getSetting, keyConfigured } from "@/lib/ai";
import { body, fail, ok } from "@/lib/api";
import { TASKS } from "@/lib/types";
import { authorize } from "@/lib/agentAuth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorize(req, "settings:read");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const providers = (await db.select().from(aiProviders)).map((p) => ({ ...p, keyConfigured: keyConfigured(p) }));
  const routes = await db.select().from(modelRoutes);
  const pol = await db.select().from(policies);
  return ok({ aiMode: await getSetting(db, "aiMode", "ai"), providers, routes, policies: pol });
}

export async function PUT(req: Request) {
  const auth = await authorize(req, "settings:write");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const b = await body<{
    aiMode?: string;
    route?: { task: string; providerId: string | null; model: string };
    policy?: { id: string; content: string; enabled: boolean };
  }>(req);
  if (b.aiMode) {
    if (b.aiMode !== "ai" && b.aiMode !== "local") return fail("aiMode must be 'ai' or 'local'");
    await db.insert(settings).values({ key: "aiMode", value: b.aiMode }).onConflictDoUpdate({ target: settings.key, set: { value: b.aiMode } });
  }
  if (b.route) {
    if (!(TASKS as readonly string[]).includes(b.route.task)) return fail("Unknown task");
    await db
      .insert(modelRoutes)
      .values({ task: b.route.task, providerId: b.route.providerId, model: b.route.model })
      .onConflictDoUpdate({ target: modelRoutes.task, set: { providerId: b.route.providerId, model: b.route.model } });
  }
  if (b.policy) await db.update(policies).set({ content: b.policy.content, enabled: b.policy.enabled }).where(eq(policies.id, b.policy.id));
  return ok();
}
