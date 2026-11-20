# RASQ-Ai — trustworthy visual test automation

Zero-DOM optical automation: client perception supplies geometry, an optional multimodal model supplies semantics, Playwright supplies execution evidence.

**Stack:** Next.js (App Router) · Drizzle ORM + libsql/SQLite (`data/rasq.db`) · Playwright · `@xyflow/react` (ReactFlow, the engine behind koolii/react-workflow-editor) · zod.

**Version:** 1.3.0 — set in `package.json`, shown in the sidebar and returned by `/api/health`.

## Flow
1. **Record & Scan** – full-screen recorder (start / pause / stop / cancel), screenshot/video upload, or server-side URL capture. Perception pipeline: luminance → Sobel → density grid → connected components → merged candidate regions → geometric labels + dHash template hash. Frames are grouped per page/window. Saved recording/screen scans can be reopened, edited, and updated in place while preserving unchanged control IDs.
2. **SRS Documents** – PDF/MD/TXT; exact requirement IDs, acceptance criteria and ambiguity flags.
3. **Test Scenarios** – traceable (many-to-many) positive/negative/boundary/security/accessibility/performance/resilience cases from an SRS, or positive P2 visual-interaction cases from selected saved scans. Uses P0–P3 priorities and synthetic data; visual-only cases never invent requirement links. CSV/JSON export.
4. **Workflows & Runs** – convert filtered Test Scenarios directly into downloadable n8n-compatible JSON and a saved runnable workflow, or build on the ReactFlow canvas. Playwright executes visual-anchor actions with live per-node status and step screenshots. The Web Control Plane can also compile a `rasq-desktop.v1` bundle and inspectable RobotJS script for an enrolled attended desktop agent. Dry-run mode validates without executing.
5. **Reports** – built only from recorded data, with Playwright, real attended RobotJS, dry-run, and mock-simulation outcomes distinguished.

## Appearance
Glass UI with four themes, chosen in the sidebar or under **AI Models & Policy → Appearance** and remembered per browser:

- **Dark purple** (default) and **Light purple**.
- **Custom colors** – pick an accent and a background; text, borders and fills are derived from them.
- **Random high contrast** – a shuffled palette; **Shuffle colors** rolls another.

Text colours are computed rather than hand-picked (`src/lib/theme.ts`): on the surfaces the UI composes, every theme keeps text at WCAG AA (at least 4.5:1) and the random theme at AAA (at least 7:1). When a custom pair leaves too little contrast, the backdrop glow and tints fade and text moves toward pure black or white, so it never becomes unreadable. Status colours (passed, failed, warning, needs-review) use the same hues in every theme and never follow the accent; on a mid-tone custom background, status text fades toward black or white to stay readable. `/demo-target` is deliberately left unthemed because it is a recorded visual test target.

## AI models
Every feature (visual scan, document analysis, test scenarios, workflow creation, reports) has its own model selector (Local engine or any configured provider/model). The server-side protocol gateway supports OpenAI-compatible, Anthropic, Gemini, and generic REST/JSON APIs. Generic providers can map methods, headers, request JSON, multimodal content, and response paths through the canonical `rasq-ai.v1` envelope; see [AI API JSON Integration](./AI_API_JSON_INTEGRATION.md).

OpenCode Go is seeded on fresh databases as an optional OpenAI-compatible provider. On existing databases, use the **OpenCode Go preset** on `/settings` and add it. Set `OPENCODE_API_KEY` on the server, then explicitly choose a Go model per task; the Local engine remains the default. The preset includes only [Go chat-completions models](https://opencode.ai/docs/console/go/#endpoints), not its Responses/Anthropic/Gemini models. Go requests include an opaque `ses_`-prefixed `x-opencode-session` header (stable within a server process) and a RASQ-Ai user agent. RASQ-Ai has no conversation ID, so the session is not conversation-scoped and changes after restart. Go is intended for coding-agent traffic; verify your usage and each model's image/JSON support before using it for visual scans. No live Go account has been validated here.

Providers store only the *name* of a server env var (`OPENAI_API_KEY`, `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, …). Secrets/PANs/emails are redacted before supported text calls; documents and images are wrapped as untrusted data. Images are not pixel-redacted.

## Database
`drizzle/` holds generated migrations (`npx drizzle-kit generate`); they are applied and seeded automatically on first request (`src/db/index.ts`, `src/db/seed.ts`). Override the location with `RASQ_DB_URL` (e.g. `file:./data/rasq.db` or a Turso URL).

## JSON REST performance testing (JMeter CLI)
On `/performance`, select a Test Scenario, choose applicable requirement IDs across one or more SRS documents, and create/update a restricted JSON REST load plan. Set `RASQ_JMETER_ALLOWED_ORIGINS` to an explicit comma-separated list of **exact origins** (for example `http://127.0.0.1:8123`) and install `jmeter` on the web server's PATH. No origin is allowed by default. Authorize every load target before running; the UI requests confirmation. Each plan has one independent HTTP JSON sampler (GET/POST/PUT/PATCH/DELETE), 1–10 users, 5–60 seconds, and at least 300 ms think time. No uploaded JMX, scripts, custom headers/auth, cookies, redirects, session correlation, or chained requests are supported. Do not use production credentials or customer data.

The server executes `jmeter -n` with bounded duration and temporary files in ignored `data/jmeter/`, then persists only a sample summary, decision and source-requirement snapshot. CLI output and JTL files are discarded. Exact p95/error/throughput phrases in selected requirements are interpreted conservatively; conflicting/ambiguous criteria need review. Otherwise the labelled implicit limits are **p95 ≤ 1,000 ms** and **error rate ≤ 1%**; absent throughput criteria need review. Wilson one-sided 95% bounds for p95-in-budget and error proportion assume independent samples. Reports separate JMeter HTTP evidence from Playwright/RobotJS runs. This is a single-server, in-process runner, not a durable queue or a general-purpose load generator. The origin allowlist is not a DNS-rebinding defense; expose this feature only in a trusted, single-operator environment. A real JMeter CLI has not been verified in this sandbox.

## Playwright
Install the browser once: `npx playwright install chromium` (Linux: add `--with-deps`). Try the built-in target at `/demo-target`.

`rasq-ai.*` nodes in exported workflows are executed by RASQ-Ai; stock n8n shows them as unknown nodes.

## Attended Desktop Agent

The isolated `desktop-agent/` Electron package executes web-compiled desktop manifests through a fixed RobotJS runner after no-input preflight and explicit operator confirmation. It includes revocable enrollment, strict visual anchors, browser/local emergency stop, live step evidence, and a safe mock driver. The real-input MVP targets Windows x64; real desktop execution and packaged-agent validation have not been performed in this environment. Browser-facing routes remain single-operator development APIs.

See [Desktop Agent](./DESKTOP_AGENT.md) for enrollment, supported actions/assertions, script export, packaging, safety controls, and platform limitations.

## External agents (API keys)

RASQ-Ai exposes a scoped, audited machine surface so external AI agents (CI, orchestrators, tool-calling models) can use a running instance without the single-operator browser session:

- **Keys**: SHA-256-hashed, plaintext shown once, revocable, optionally expiring. Mint via `npm run agent:key -- --name <label> --preset` or `POST /api/agent-keys` (operator only). List/revoke via `GET|DELETE /api/agent-keys`.
- **Scopes**: separate read/generate/execution (`runs:start:dry-run` vs `runs:start:playwright`, `performance:load`, `desktop:attend`, `desktop:confirm`, `desktop:revoke`) and `delete:artifacts`. The recommended starter set grants observe + generate + dry-run only. Execution and deletion scopes are never in it.
- **Fail closed**: a presented-but-invalid key gets `401 invalid_api_key` — never operator fallback. Missing scope → `403 insufficient_scope`. Mutations over a per-process budget (default 120/min, `RASQ_AGENT_RATE_LIMIT`) → `429 rate_limited`.
- **Idempotency**: `Idempotency-Key` on `POST /api/runs`, `POST /api/tests`, `POST /api/workflows` replays the stored 2xx response (`idempotent-replay: true`) or returns `409 idempotency_conflict`.
- **Attribution**: every mutating call is recorded in the append-only `audit_log` table (actor, action, ok/denied, IP). Provenance strings in artifacts are unchanged; the audit log is the agent attribution record.
- **Discovery**: OpenAPI 3.1 at `GET /api/openapi.json` (public) lists every operation and its `x-rasq-scope`. Agents start with [AGENT_GUIDE.md](./AGENT_GUIDE.md) and `GET /llms.txt`.
- **Webhooks**: terminal events (`run.completed`, `desktop.run.completed`, `performance.run.completed`) are pushed to operator-registered HTTPS receivers — signed `x-rasq-signature: v1=hex(HMAC-SHA256(secret, "<timestamp>.<rawBody>"))`, retried (0s/+2s/+10s), every attempt logged in `webhook_deliveries`. Manage via `POST|GET|PATCH|DELETE /api/webhooks` (operator only; secret shown once) and test with `POST /api/webhooks/{id}/test`. Best-effort in-process delivery; never blocks a run.
- **MCP**: `npm run mcp` (stdio) exposes a safe read/generate subset as MCP tools for tool-calling clients. It is a thin adapter over this same HTTP API (`RASQ_AI_URL`, `RASQ_API_KEY`) — no second auth path.
- **Tenancy-lite (1.3.0)**: mint partitioned keys with `--projects id1,id2` (foreign projects answer 404; lists filter silently) and per-key UTC-day mutation budgets with `--daily-budget N`.
- **Governance at scale (1.3.0)**: database-backed fixed-window rate limiting (survives restarts; fails closed with `503 rate_limiter_unavailable` rather than running unmeasured agents), `GET /api/audit` query + formula-injection-safe CSV export (operator only), and `npm run retention` (configurable windows for `audit_log` / `webhook_deliveries` / `idempotency_keys` / `usage_counters`).
- **Guardrails**: the non-negotiable domain guardrails and their trade-offs are analyzed in [GUARDRAILS.md](./GUARDRAILS.md).

The browser UI remains a single-operator surface without login; keep the deployment behind trusted access. See [AGENT_GUIDE.md](./AGENT_GUIDE.md) for the threat model, scope catalog, curl recipes, error codes and safety rules.

## Agent and design documentation

- [Master Prompt](./MASTER_PROMPT.md) — reusable instructions for AI coding, QA, security, and architecture tasks, including RASQ-Ai's non-negotiable evidence, privacy, visual-locator, and traceability rules.
- [Agent Guide](./AGENT_GUIDE.md) — how external AI agents use a running instance: API keys, scope catalog, idempotency, audit trail, error codes, safety rules, and decision record.
- [Guardrails](./GUARDRAILS.md) — the non-negotiable guardrails for trustworthy automation in this domain (attended control, allowlists, budgets, retention, evidence rules) and the trade-offs they force.
- [Context Memory](./CONTEXT_MEMORY.md) — a point-in-time architecture and behavior handoff covering routes, persistence, AI routing, perception, workflows, runs, reports, known constraints, and validation commands. Verify it against the current source and update it when architecture changes.
- [AI API JSON Integration](./AI_API_JSON_INTEGRATION.md) — canonical request/response contract, generic protocol templates, routing behavior, and security limits.
- [Enterprise Roadmap](./ENTERPRISE_ROADMAP.md) — prioritized recommendations for identity, durable execution, test governance, visual intelligence, AI routing, scale, and integrations.
- [Desktop Agent](./DESKTOP_AGENT.md) — attended RobotJS architecture, enrollment, compiler contract, execution, evidence, packaging, and validation boundaries.
- [Desktop Agent Master Prompt](./DESKTOP_AGENT_MASTER_PROMPT.md) — implementation requirements and acceptance criteria used for the attended desktop feature.
