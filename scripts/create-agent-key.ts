/**
 * Bootstrap an external-agent API key from the shell (headless / CI environments).
 *
 *   npx tsx scripts/create-agent-key.ts --name "nightly-ci" --scopes "projects:read,tests:generate,runs:start:dry-run"
 *   npx tsx scripts/create-agent-key.ts --name "auditor" --preset
 *   npx tsx scripts/create-agent-key.ts --name "temp" --ttl-days 30
 *
 * The plaintext key is printed once. Store it in your secret manager; it cannot be recovered.
 */
import { API_KEY_SCOPES, RECOMMENDED_AGENT_SCOPES, generateApiKey, isApiKeyScope } from "../src/lib/agentAuth";

async function main() {
  const { getDb } = await import("../src/db");
  const { apiKeys } = await import("../src/db/schema");

  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const name = arg("name");
  if (!name) {
    console.error("Usage: tsx scripts/create-agent-key.ts --name <label> [--scopes a,b,c] [--preset] [--ttl-days N]");
    process.exit(2);
  }
  const preset = args.includes("--preset");
  const rawScopes = arg("scopes");
  const scopes = preset ? RECOMMENDED_AGENT_SCOPES : (rawScopes?.split(",").map((s) => s.trim()).filter(Boolean) ?? RECOMMENDED_AGENT_SCOPES);
  const unknown = scopes.filter((s) => !isApiKeyScope(s));
  if (unknown.length) {
    console.error(`Unknown scopes: ${unknown.join(", ")}\nValid scopes:\n  ${API_KEY_SCOPES.join("\n  ")}`);
    process.exit(2);
  }
  const ttlDays = arg("ttl-days") ? Number(arg("ttl-days")) : undefined;
  if (ttlDays !== undefined && (!Number.isFinite(ttlDays) || ttlDays < 1)) {
    console.error("--ttl-days must be a positive number");
    process.exit(2);
  }

  const { key, keyPrefix, keyHash } = generateApiKey();
  const db = await getDb();
  const [row] = await db
    .insert(apiKeys)
    .values({ name, keyHash, keyPrefix, scopes, expiresAt: ttlDays ? new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000) : null })
    .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });

  console.log(`Created API key "${name}" (id ${row.id})`);
  console.log(`Scopes: ${scopes.join(", ")}`);
  console.log(`Expires: ${ttlDays ? `in ${ttlDays} days` : "never"}`);
  console.log("");
  console.log(key);
  console.log("\nStore this key now — it is shown once and cannot be recovered.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
