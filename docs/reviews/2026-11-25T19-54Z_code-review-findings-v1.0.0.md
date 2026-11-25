# RASQ-Ai — Repository Review Findings

**Document version:** 1.0.0
**Date:** 2026-11-25 (UTC)
**Branch:** `arena/a88c4210-rasq-ai`
**Base commit:** `365c12bfdc9376293175ee3ee221d274b449125f`
**Reviewer:** Arena.ai Agent Mode
**Scope:** static review of the full repository plus verification runs (`npm test`, `npm run typecheck`, `npm run lint`). No source files were modified.

### Verification baseline (as of 2026-11-25T19:54Z)
- `npm test` → **63/63 pass**
- `npm run typecheck` → **clean**
- `npm run lint` → **0 errors, 8 warnings** (unused `eslint-disable react-hooks/set-state-in-effect` directives)
- `npm run build` → not run in this review
- `npm ci` used to install dependencies for verification only

### Conventions
Findings are ordered by value (highest first), not by category. Each item names the file(s) and why it matters. Categories: integration potential, bugs, risky code, missing tests, documentation gaps, developer experience.

---

## Highest-value improvements (ranked)

### 1. Provider config enables arbitrary server-secret exfiltration by agents — security (critical)
**Path:** `src/app/api/providers/route.ts` (`clean()` / `validateEndpoint()`), `src/lib/ai.ts` (`keyConfigured()`), `src/lib/aiProtocols.ts` (`renderHeaders()`)
**What:** `providers:write` only validates that `apiKeyEnv` looks like an env-var *name* (regex `^[A-Z][A-Z0-9_]{1,63}$`) — any name passes, e.g. `AWS_SECRET_ACCESS_KEY` or `OPENAI_API_KEY` — and `baseUrl` may be any http(s) URL. Header templates are required to reference `{{apiKey}}` for auth-like headers, so an agent holding `providers:write` + `ai:scan` (both grantable, non-execution scopes) can register a provider pointing at its own server and have the next scan POST the named server secret there. The existing checks stop raw credentials in the DB but not env-name abuse.
**Why it matters:** It converts a scoped machine credential into arbitrary server-environment disclosure — the highest-impact attack in the repo's trust model.
**Fix sketch:** server-side allowlist of `apiKeyEnv` (operator-configured set or documented provider presets), optionally block private/loopback `baseUrl` unless explicitly enabled, plus a regression test.

### 2. SSRF guard on Playwright targets/capture is nearly empty — security (high)
**Path:** `src/lib/runner.ts` (`assertSafeUrl()`), `src/app/api/capture/route.ts`
**What:** Only `169.254.*` and `metadata.google` are blocked. Loopback, RFC-1918, `0.0.0.0`, and IPv6 `::1`/`fe80::` are all reachable, and `capture:run` / `runs:start:playwright` are agent-reachable scopes. Any internal HTTP endpoint becomes screenshot-exfiltratable into the agent transcript. The capture route also clamps width/height only from above (`Math.min`) — `0`/negative yields a 502 from Playwright instead of a 400.
**Why it matters:** Browser execution is the riskiest primitive in the product; the target validator is the only egress gate and it is bypassable.
**Fix sketch:** resolve the hostname and reject private/loopback/link-local/reserved ranges unless the operator explicitly allows them (loopback is legitimately needed for `/demo-target`, so make it an explicit allowlist, not a default), add lower clamps on viewport dimensions, add a test matrix.

### 3. Webhook registration contradicts docs and allows internal targets — security (medium)
**Path:** `src/app/api/webhooks/route.ts` (`validateUrl()`), `src/lib/webhooks.ts` (`deliverWebhook()`)
**What:** README says deliveries go to "HTTPS receivers", but the code accepts `http://` and never blocks loopback/private/link-local hosts. An operator-registered endpoint named e.g. "Slack" can be a ping into `http://169.254.169.254/`. Operator-only, hence below #1/#2.
**Why it matters:** The one role with no other network-egress gate gets an unrestricted, signed, retrying outbound HTTP client pointed anywhere — including link-local metadata services.
**Fix sketch:** require `https` by default (opt-in `http` for localhost/dev), block non-public ranges, update the README claim, add a test.

### 4. CSV formula injection in test-case export — security (medium)
**Path:** `src/app/api/tests/export/route.ts` (`q()`), compare `src/app/api/audit/route.ts` (`csvCell()`)
**What:** The test-case CSV exporter wraps values in quotes but does not neutralize spreadsheet formulas. The audit CSV correctly prefixes values starting with `= + - @ \t` with a single quote — this exporter doesn't. Test titles/preconditions/steps are generated from **untrusted SRS documents**, so a crafted requirement (`=cmd|'/c calc'!A1` in a field) lands in an analyst's spreadsheet.
**Why it matters:** Data flows from untrusted input to an office-suites formula interpreter; the codebase already knows how to fix it (audit route does).
**Fix sketch:** extract one shared CSV helper (formula-injection guard + quoting) used by both routes; add a regression test with a hostile requirement.

### 5. Unbounded request bodies — reliability/security (medium)
**Path:** `src/lib/api.ts` (`body()` — bare `req.json()`), `src/app/api/recordings/route.ts` (upload buffered fully into memory + disk, no size cap), `src/app/api/screens/route.ts` (unbounded base64 `imageDataUrl`, unbounded `controls[]`, unvalidated `width`/`height`), `src/app/api/ai/scan/route.ts` (unbounded `imageDataUrl` / `candidates[]` — sliced to 120 only after full parse)
**What:** The requirements route caps uploads at 15 MB — the pattern exists but was never shared. A single oversized POST can exhaust memory/disk on the single-operator host.
**Why it matters:** Every mutating route depends on `body()`; one global guard fixes most of the surface.
**Fix sketch:** one `bodySizeLimit`/byte-cap helper (or Next config + early `content-length` check) applied before parsing; clamp geometry and array sizes; reject before base64 decode.

### 6. Idempotency coverage is thin for agent mutations — correctness/integration (medium)
**Path:** `src/lib/idempotency.ts`; used only by `src/app/api/runs/route.ts` (`POST /api/runs`), `src/app/api/tests/route.ts` (`POST /api/tests`), `src/app/api/workflows/route.ts` (`POST /api/workflows`)
**What:** Nothing prevents an agent from double-starting a JMeter load (`/api/performance/runs`), double-confirming a desktop run (`/api/desktop/runs/[id]/confirm` — guarded only by state checks), or double-creating recordings/screens/reports/webhooks (`POST /api/recordings`, `/api/screens`, `/api/reports`, `/api/webhooks`).
**Why it matters:** For a machine-facing API, duplicate execution is the main cost of retried HTTP calls. `beginIdempotency()` already implements the semantics (2xx replay, body-drift 409, opportunistic 24h purge) — extending it is mechanical.
**Fix sketch:** apply the same `beginIdempotency()` wrapper to `POST /api/performance/runs`, `/api/desktop/runs/[id]/confirm`, and other mutating agent-reachable routes; document which routes are idempotent in `AGENT_GUIDE.md`.

### 7. No CI + toolchain drift — developer experience (medium)
**Path:** (none — missing `.github/` entirely), `eslint.config.mjs`, `package.json`
**What:** No GitHub Actions workflow; lint/typecheck/tests are manual. `eslint-config-next@15.5.29` paired with `next@16.4.5` (Next 15 config with Next 16 runtime). 8 unused `eslint-disable react-hooks/set-state-in-effect` directives (`src/app/(app)/reports/page.tsx:49`, `requirements/page.tsx:27`, `scan/page.tsx:79`, `settings/page.tsx:24`, `tests/page.tsx:47`, `workflows/page.tsx:68`, `src/components/ModelPicker.tsx:16`, `src/components/ui.tsx:34`) — direct evidence the misaligned config no longer fires the rule it suppresses. `desktop-agent/test/runner.test.ts` (7 tests) is wired to no root script and no CI.
**Why it matters:** Every quality gate in this repo is opt-in and manually remembered; regressions land silently. The lint warnings signal configuration that no longer matches reality.
**Fix sketch:** one GitHub Actions workflow (`npm ci` + lint + typecheck + `npm test` + desktop-agent tests + `next build`); bump `eslint-config-next` to ^16; delete the 8 stale directives.

### 8. Package identity and metadata drift — developer experience (low/medium)
**Path:** `package.json`, `package-lock.json`, `src/lib/version.ts`, `src/mcp/server.ts`
**What:** Package name still `nextjs-postgresql-template`; no `description`/`repository`/`engines`/`license`; Next 16's minimum Node is undeclared. Unused `pg` (8.20.0) and `@types/pg` remain though the repo is libsql-only. `APP_VERSION` is duplicated: `src/lib/version.ts` (used by health/webhooks) and the MCP `McpServer` constructor hardcodes `"1.3.0"` in `src/mcp/server.ts`; `tests/version.test.ts` guards only two of three copies. `experimental.serverActions` is configured though no server actions exist. No `.env.example` exists; ~15 `RASQ_*` variables (`RASQ_DB_URL`, `RASQ_AGENT_RATE_LIMIT`, `RASQ_AGENT_DAILY_MUTATIONS`, `RASQ_AUDIT_RETENTION_DAYS`, `RASQ_WEBHOOK_DELIVERY_RETENTION_DAYS`, `RASQ_IDEMPOTENCY_RETENTION_HOURS`, `RASQ_JMETER_ALLOWED_ORIGINS`, `RASQ_AI_URL`, `RASQ_API_KEY`, provider key env names…) are discoverable only via docs/source.
**Why it matters:** Onboarding, reproducible installs, and version bumps all depend on metadata that currently lies or is absent; drift has already happened once (MCP version copy).
**Fix sketch:** rename package, add metadata + `engines`, drop `pg`, single source of truth for version (import `APP_VERSION` in MCP or from `package.json`), add `.env.example`, add `db:generate` / `desktop:test` scripts.

### 9. Mutation budget is consumed before the scope check — correctness (low/medium)
**Path:** `src/lib/agentAuth.ts` (`authorize()`)
**What:** On a mutating agent call, `consumeAgentMutationBudget()` runs **before** `actor.scopes.includes(scope)` is checked. A key holding no relevant scope still burns its 1-minute and daily mutation counters, then gets a 403. It also means a caller can deliberately drain its own budget with unauthorized requests.
**Why it matters:** Counter rows (`usage_counters`) are a scarce governance budget and an audit-relevant record; they should reflect authorized work only.
**Fix sketch:** reorder to authenticate → scope check (403) → consume budget → audit. Keep the fail-closed 503 behavior unchanged.

### 10. In-process delivery/runs are lossy on restart — integration potential (medium)
**Path:** `src/lib/webhooks.ts` (`notifyWebhooks()` fire-and-forget; `deliverWithRetry()` uses in-memory `setTimeout` at 0s/+2s/+10s), `src/lib/runner.ts` (`void executeRun(...)`; `failStaleRuns()` only invoked from `/api/runs` handlers)
**What:** Documented as best-effort single-operator behavior, but the integration consequence is real: a restart drops pending retries and any in-flight webhook; receivers can lose `run.completed` permanently with no resend path (deliveries *are* logged in `webhook_deliveries`, but there is no "resend failed delivery" endpoint/CLI).
**Why it matters:** Webhooks + n8n are the repo's main external-integration story; losing terminal events silently defeats receiver automation.
**Fix sketch (rising cost):** (a) a resend/list tool for failed deliveries (operator CLI or endpoint); (b) a small outbox table replayed on boot; (c) the roadmap's durable queue. Note (a) is a small, self-contained addition that reuses `deliverWebhook()` unchanged.

---

## Missing tests (highest-risk first)

1. **`src/lib/aiProtocols.ts`** — template rendering (`renderTemplate` depth/type rules, `{{model}}` endpoint handling, `readResponsePath`, `renderHeaders`/`authorization`-must-use-`{{apiKey}}` rules). The most complex security surface in the AI path; only `tests/opencodeGo.test.ts` covers Go routing. Zero direct tests.
2. **`src/lib/runner.ts`** — `assertSafeUrl` (finding #2), anchor scale/clamping math, `anchorThreshold` comparison, dry-run path: untested.
3. **`src/app/api/tests/export/route.ts`** — CSV escaping and the formula-injection guard (finding #4): untested.
4. **`src/mcp/server.ts`** — URL construction, key regex gate, 16 KB body truncation: untested; hardcoded version already drifted (finding #8).
5. **Desktop-agent suite** — `desktop-agent/test/runner.test.ts` exists but is not in any root script or CI (finding #7).
6. **OpenAPI contract drift** — `src/lib/openapi.ts` is hand-maintained (`GET /api/openapi.json`); no test asserts the spec enumerates every real route. A route-vs-spec consistency test would keep the public contract honest cheaply.
7. Less critical: `src/lib/performanceRunner.ts` size-limit abort and cancel propagation; `src/lib/retention.ts` bucket boundary math.

## Documentation gaps

- **No `SECURITY.md`** — no disclosure policy, supported versions, or pointer to the agent-surface threat model in `AGENT_GUIDE.md`. Unusual for a repo advertising a machine API.
- **No `CHANGELOG.md`** despite a tagged governance milestone (1.3.0) and migration-history in `drizzle/`.
- **No `.env.example`** (finding #8).
- **`CONTEXT_MEMORY.md`** is self-described as point-in-time and tells readers to "verify against the current source"; either add a CI freshness check or trim it to decisions unlikely to rot.
- **Doc/code mismatches to reconcile:** webhooks "HTTPS receivers" vs `http://` accepted (README vs `webhooks/route.ts`, finding #3); README's audit-CSV formula-safety claim holds, but the test-case CSV export is not covered by that guarantee (finding #4); `DESKTOP_AGENT.md`/README note real-input has not been validated — keep those caveats next to any future docs for packaging.

## Integration potential worth building on

- **Extend idempotency (#6)** — highest value-to-effort ratio for the machine surface.
- **Webhook resend/outbox (#10)** — and consider `run.started` / `run.failed` event types (only terminal `*.completed` exist today).
- **MCP adapter** (`src/mcp/server.ts`) — clean thin proxy over HTTP; adding `rasqai_get_run`-style polling is easy, but mutating tools will hit the idempotency/retry questions first. Solve #6 before expanding MCP.
- **Generic-JSON provider contract** (`AI_API_JSON_INTEGRATION.md`) — a genuinely good integration seam; it needs the env-name allowlist (#1) and unit tests (missing-tests #1) before being recommended to third parties.

## Suggested order of action

1. Security/correctness: **#1 → #2 → #4 → #5**
2. Lock in gains: **#7** (CI)
3. Integration reliability: **#6** then **#10**
4. Hygiene/docs: **#8**, **#9**, missing tests #1–#4, documentation gaps

## What is already in good shape (do not regress)

- Agent auth model (`src/lib/agentAuth.ts`): 401 on invalid credentials with no operator fallback, scope-checked mutations, audited denials, fail-closed (503) rate limiter, DB-backed fixed-window budgets (`src/lib/rateLimit.ts`).
- Append-only audit log with CSV export guarded against formula injection and `x-total-count`/`x-returned-count` headers (`src/app/api/audit/route.ts`).
- Tenant-partition 404s (anti-enumeration) in `src/lib/projectAccess.ts`.
- Idempotency semantics with body-drift detection (`src/lib/idempotency.ts`).
- JMeter plan restrictions (origin allowlist, no credentials/query, bounded duration, 5 MB JTL cap) (`src/lib/performanceRunner.ts`) — keep `RASQ_JMETER_ALLOWED_ORIGINS` explicit.
- No `eval`/`new Function`/string `exec` of user input anywhere except the fixed PowerShell adapter in `desktop-agent/src/windowsTarget.ts` (env-var parameterized, not string-interpolated).

## Notes & limitations of this review

- `npm run build` was not executed; Next build-time behavior (route-rule linting, serverExternalPackages) was reviewed statically only.
- Runtime smoke tests (actual Playwright runs, JMeter CLI, desktop agent on Windows x64) were out of scope; README explicitly states JMeter CLI and real desktop execution are unvalidated.
- No files other than this document were created or modified; the working tree is otherwise clean relative to `365c12b`.
