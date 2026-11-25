/**
 * Provider credential policy: which environment variables may be named as `apiKeyEnv`
 * on an AI provider, and which provider base URLs are allowed.
 *
 * Threat model: `providers:write` is a grantable agent scope (non-execution, default-ish).
 * Without an allowlist, a holder of that scope can point a provider at a server they
 * control and register `RASQ_DB_URL` / `AWS_SECRET_ACCESS_KEY` / any server env var as
 * the credential — the next AI call would exfiltrate it. Raw values are never stored,
 * but env-var *names* are attacker-chosen, so names must be constrained too.
 *
 * Policy (checked at provider create/update time, before anything is persisted):
 *  - `apiKeyEnv` must be on the allowlist: a built-in set of well-known provider key
 *    names, plus anything in the operator's `RASQ_PROVIDER_KEY_ENVS` (comma-separated).
 *  - Infrastructure secrets are never allowed, even if the operator adds them:
 *    denylisted by exact name or pattern below.
 *  - A provider `baseUrl` pointing at a non-loopback non-public host is rejected by default.
 *    Loopback stays reachable for local model servers (Ollama etc.). Set
 *    RASQ_PROVIDERS_ALLOW_PRIVATE=1 to permit any private/LAN host (trusted single-operator
 *    setups), or =0 to block even loopback. It does NOT widen the env-name allowlist.
 */
import { blockedReason } from "@/lib/netGuard";

/** Well-known provider credential env names accepted out of the box. */
const DEFAULT_ALLOWED_ENVS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENCODE_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "XAI_API_KEY",
  "COHERE_API_KEY",
  "DEEPSEEK_API_KEY",
  "QWEN_API_KEY",
  "MOONSHOT_API_KEY",
  "PERPLEXITY_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OLLAMA_API_KEY",
]);

/** Never accepted as a provider credential, even via operator extension. */
const DENIED_EXACT = new Set([
  "RASQ_DB_URL",
  "RASQ_JMETER_ALLOWED_ORIGINS",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
  "MYSQL_URL",
  "MONGODB_URL",
  "REDIS_URL",
  "GITHUB_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_CLIENT_SECRET",
]);
const DENIED_PATTERNS: RegExp[] = [
  /^RASQ_/, // internal server configuration
  /^AWS_/,
  /^AZURE_/,
  /^GCP_/,
];

function operatorExtension(): Set<string> {
  const raw = process.env.RASQ_PROVIDER_KEY_ENVS ?? "";
  return new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
}

export function allowedEnvName(name: string): { ok: true } | { ok: false; reason: string } {
  const deny = (reason: string) => ({ ok: false as const, reason });
  if (DENIED_EXACT.has(name)) return deny(`"${name}" is an infrastructure secret and can never be used as a provider credential.`);
  for (const pattern of DENIED_PATTERNS) if (pattern.test(name)) return deny(`Env var names matching ${pattern} are not allowed as provider credentials.`);
  const allowed = new Set([...DEFAULT_ALLOWED_ENVS, ...operatorExtension()]);
  if (allowed.has(name)) return { ok: true };
  return deny(`"${name}" is not on the provider credential allowlist. Add it via RASQ_PROVIDER_KEY_ENVS if it is genuinely a model-provider key.`);
}

/** Validate a provider base URL host. `envFlag` is RASQ_PROVIDERS_ALLOW_PRIVATE. */
export function allowedBaseUrl(value: string, envFlag = process.env.RASQ_PROVIDERS_ALLOW_PRIVATE): { ok: true } | { ok: false; reason: string } {
  if (!value) return { ok: true }; // empty baseUrl = default endpoint for the kind
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "baseUrl must be a valid URL." };
  }
  const reason = blockedReason(url.hostname, [], envFlag);
  if (reason) {
    return { ok: false, reason: `Provider baseUrl points at a private/local host (${reason}). Set RASQ_PROVIDERS_ALLOW_PRIVATE=1 for trusted local model servers.` };
  }
  return { ok: true };
}
