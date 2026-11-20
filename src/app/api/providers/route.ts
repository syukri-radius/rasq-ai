import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiProviders, modelRoutes } from "@/db/schema";
import { AI_PROTOCOLS, ProviderConfigSchema } from "@/lib/aiContract";
import { body, fail, ok } from "@/lib/api";
import { authorize } from "@/lib/agentAuth";

type P = { id?: string; name?: string; kind?: string; baseUrl?: string; apiKeyEnv?: string; models?: string[]; enabled?: boolean; config?: unknown };

function validateEndpoint(value: string): void {
  if (!value) return;
  if (!/^https?:\/\//.test(value)) throw new Error("baseUrl must be an HTTP(S) URL or generic JSON endpoint.");
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Provider URLs must not contain credentials. Use apiKeyEnv and {{apiKey}} header templates.");
}

function clean(b: P) {
  const apiKeyEnv = (b.apiKeyEnv ?? "").trim();
  if (apiKeyEnv && !/^[A-Z][A-Z0-9_]{1,63}$/.test(apiKeyEnv)) throw new Error("apiKeyEnv must be an environment variable NAME (e.g. OPENAI_API_KEY), never the key itself.");
  const kind = b.kind ?? "openai";
  if (!(AI_PROTOCOLS as readonly string[]).includes(kind)) throw new Error(`kind must be ${AI_PROTOCOLS.join(", ")}`);
  const baseUrl = (b.baseUrl ?? "").trim();
  validateEndpoint(baseUrl);
  if (kind === "json" && !baseUrl) throw new Error("Generic JSON providers require a full endpoint URL. {{model}} is supported in the path or query.");
  const config = ProviderConfigSchema.parse(b.config ?? {});
  const serialized = JSON.stringify(config);
  if (serialized.includes("{{apiKey}}") && !apiKeyEnv) throw new Error("Configure apiKeyEnv when a provider template uses {{apiKey}}.");
  if (JSON.stringify(config.requestTemplate ?? {}).includes("{{apiKey}}")) throw new Error("API keys are allowed only in header templates, never in the JSON request body.");
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    if (["authorization", "proxy-authorization", "x-api-key", "api-key", "x-goog-api-key"].includes(name.toLowerCase()) && !value.includes("{{apiKey}}")) {
      throw new Error(`Authentication header "${name}" must reference {{apiKey}}; raw credentials are not stored.`);
    }
  }
  return {
    name: (b.name ?? "").trim(),
    kind,
    baseUrl,
    apiKeyEnv,
    models: (b.models ?? []).map((m) => m.trim()).filter(Boolean),
    enabled: b.enabled ?? true,
    config,
  };
}

export async function POST(req: Request) {
  const auth = await authorize(req, "providers:write");
  if ("response" in auth) return auth.response;
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
  const auth = await authorize(req, "providers:write");
  if ("response" in auth) return auth.response;
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
  const auth = await authorize(req, "providers:write");
  if ("response" in auth) return auth.response;
  const db = await getDb();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail("id required");
  await db.update(modelRoutes).set({ providerId: null, model: "" }).where(eq(modelRoutes.providerId, id));
  await db.delete(aiProviders).where(eq(aiProviders.id, id));
  return ok();
}
