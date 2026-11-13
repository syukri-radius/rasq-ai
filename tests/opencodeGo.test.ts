import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { seed } from "../src/db/seed";
import { callModel, parseJson, provenanceOf, resolveRoute } from "../src/lib/ai";
import { OPENCODE_GO } from "../src/lib/opencodeGo";

test("Go is seeded but Local remains the default, including when AI is disabled", async (t) => {
  const previousKey = process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_API_KEY;
  t.after(() => { if (previousKey === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = previousKey; });
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrate(db, { migrationsFolder: `${process.cwd()}/drizzle` });
  await seed(db);
  const [provider] = await db.select().from(schema.aiProviders).where(eq(schema.aiProviders.name, OPENCODE_GO.name));
  assert.equal(provider.baseUrl, OPENCODE_GO.baseUrl);
  assert.equal(provider.apiKeyEnv, "OPENCODE_API_KEY");
  assert.equal(provider.kind, "openai");
  assert.deepEqual(await resolveRoute(db, "document_analysis"), { local: true, reason: "Local deterministic engine selected; no data leaves this server." });
  await db.update(schema.modelRoutes).set({ providerId: provider.id, model: OPENCODE_GO.models[0] }).where(eq(schema.modelRoutes.task, "document_analysis"));
  await assert.rejects(() => resolveRoute(db, "document_analysis"), /OPENCODE_API_KEY/);
  await db.update(schema.settings).set({ value: "local" }).where(eq(schema.settings.key, "aiMode"));
  assert.equal((await resolveRoute(db, "document_analysis")).local, true);
});

test("Go chat-completions request uses server key and shared JSON output path", async (t) => {
  const key = "mock-go-secret";
  let requests = 0;
  const sessionIds: string[] = [];
  const server = createServer(async (req, res) => {
    requests++;
    assert.equal(req.url, "/inference/go/openai/v1/chat/completions");
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    if (requests <= 2) {
      const session = req.headers["x-opencode-session"];
      if (typeof session !== "string") throw new Error("Missing Go session header");
      assert.match(session, /^ses_[0-9a-f-]{36}$/);
      assert.equal(req.headers["user-agent"], "rasq-ai/1.0");
      sessionIds.push(session);
    } else {
      assert.equal(req.headers["x-opencode-session"], undefined);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(payload.model, OPENCODE_GO.models[0]);
    assert.deepEqual(payload.response_format, { type: "json_object" });
    assert.equal(payload.messages[0].content, "system rules");
    assert.deepEqual(payload.messages[1].content, [{ type: "text", text: "untrusted sample" }]);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: '{"result":"ok"}' } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  const previousKey = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = key;
  t.after(() => { if (previousKey === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = previousKey; });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    assert.equal(input, `${OPENCODE_GO.baseUrl}/chat/completions`);
    return realFetch(`http://127.0.0.1:${address.port}/inference/go/openai/v1/chat/completions`, init);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const route = { local: false as const, model: OPENCODE_GO.models[0], provider: {
    ...OPENCODE_GO, id: "mock", enabled: true, config: { headers: { "X-OpenCode-Session": "stale", "User-Agent": "other-client" } }, createdAt: new Date(),
  } };
  assert.equal(provenanceOf(route), `OpenCode Go:${OPENCODE_GO.models[0]}`);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(parseJson(await callModel(route, { system: "system rules", user: "untrusted sample" })), { result: "ok" });
  }
  assert.equal(sessionIds[0], sessionIds[1]);
  // A similarly named provider on another host must not receive the Go-only header.
  globalThis.fetch = realFetch;
  assert.deepEqual(parseJson(await callModel({ ...route, provider: { ...route.provider, config: {}, baseUrl: `http://127.0.0.1:${address.port}/inference/go/openai/v1` } }, { system: "system rules", user: "untrusted sample" })), { result: "ok" });
  assert.equal(requests, 3);
});
