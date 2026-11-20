# RASQ-Ai — External Agent Guide

How an external AI agent (CI bot, Claude/ChatGPT-style tool user, n8n flow outside this app, a QA orchestrator) can safely **use** a running RASQ-Ai instance. This is distinct from `MASTER_PROMPT.md` / `CONTEXT_MEMORY.md`, which are for agents that edit the source code.

> **Threat model in one paragraph.** The RASQ-Ai browser UI remains a single-operator surface with no login; deploy the app only behind trusted access. External agents never rely on that bypass: they authenticate with scoped API keys. A presented-but-invalid credential is always rejected (`401`), never downgraded to operator. Keys are SHA-256 hashed at rest, shown once in plaintext, revocable, optionally expiring, scope-limited, rate-limited (best-effort, per process), and every mutating call is written to the append-only `audit_log` table.

---

## 1. Provision a key (operator does this, not the agent)

**Shell / headless:**

```bash
npm run agent:key -- --name "nightly-ci" --preset            # recommended safe set
npm run agent:key -- --name "auditor" --scopes "projects:read,runs:read,reports:read"
npm run agent:key -- --name "temp" --scopes "tests:generate" --ttl-days 30
```

**HTTP (operator browser session):**

```bash
curl -X POST http://localhost:3000/api/agent-keys \
  -H 'content-type: application/json' \
  -d '{"name":"nightly-ci","scopes":["projects:read","tests:generate","runs:start:dry-run"]}'
```

The response contains `key` (plaintext, once) plus metadata. Store it in your secret manager. List with `GET /api/agent-keys` (hashes never returned); revoke with `DELETE /api/agent-keys?id=<id>`. Agents cannot mint, list, or revoke keys (`403 operator_only`).

## 2. Authenticate

```
Authorization: Bearer rasq_<random>
```

- No `Authorization` header → treated as the local single-operator session (browser UI). Agents must not depend on this.
- Malformed/unknown/revoked/expired key → `401 invalid_api_key`.
- Valid key without the route's scope → `403 insufficient_scope` (machine-readable `code`).
- Mutations over the per-process budget (default 120/min, `RASQ_AGENT_RATE_LIMIT`) → `429 rate_limited`.
- Every mutating call writes `audit_log`: actor type/id/name, `METHOD /path`, ok/denied, client IP.

## 3. Discover the API

- **OpenAPI 3.1** at `GET /api/openapi.json` (public). Each operation carries `x-rasq-scope`.
- **Error envelope**: `{ "error": string, "code"?: string }`. `code` is stable for machines; `error` is human-readable.
- **`Idempotency-Key`** header is honored on `POST /api/runs`, `POST /api/tests`, `POST /api/workflows` (agent or operator). Replay rules in §6.
- **Webhooks** — terminal events can be pushed to your receiver; see §10. **MCP** — the same surface is available as MCP stdio tools; see §11.

## 4. Scope catalog

| Scope | Grants | Risk |
|---|---|---|
| `projects:read` … `desktop:read` (all `:read`) | GET listings/downloads | Low; still exposes artifact content — grant per need |
| `projects:write` | Create projects | Low |
| `screens:write` | Upload recordings/screens | Low–medium (storage) |
| `requirements:write` | Upload SRS docs | Low |
| `tests:generate` | **`POST /api/tests` — SRS generation REPLACES the project's case set unless `replace:false`** | Medium — pass `replace:false` to append safely |
| `workflows:write` | Create/save/import workflows | Low–medium |
| `reports:generate` | Generate reports (may call an AI provider) | Low–medium (spend) |
| `settings:write`, `providers:write` | Change AI routing, kill switch, providers | High — gates all AI behavior; rarely grant |
| `ai:scan`, `capture:run` | AI image enrichment; server-side browser capture | Medium |
| `performance:plan` | Create/edit/delete JMeter plans | Medium |
| `runs:start:dry-run` | Start structure-validating runs | Low |
| `runs:start:playwright` | **Execute against a live target in a browser** | High — real actions on the target |
| `performance:load` | JMeter load generation | High — authorization + allowlist required |
| `desktop:attend` | Compile/reserve attended desktop sessions | High |
| `desktop:confirm` | **Authorize real OS input after preflight** | Highest — keep operator-confirmed, or out of agent hands |
| `desktop:revoke` | Revoke agents, kill their runs | Medium |
| `delete:artifacts` | Every DELETE route (screens, recordings, cases, workflows, reports, requirement docs) | High |

**Recommended starter grant** (what `--preset` / `RECOMMENDED_AGENT_SCOPES` issues): `projects:read, screens:read, requirements:read, tests:read, tests:generate, workflows:read, workflows:write, runs:read, runs:start:dry-run, reports:read` — observe, generate, dry-run. Nothing destructive, nothing that drives a browser or OS input, nothing that generates load.

## 5. A safe end-to-end flow (curl)

```bash
KEY=rasq_...; H="Authorization: Bearer $KEY"; B=http://localhost:3000

curl -s $B/api/health                              # no auth needed
PROJ=$(curl -s -H "$H" $B/api/projects | jq -r '.[0].id')

# Generate cases — note replace:false to avoid wiping the SRS-derived suite
curl -s -X POST -H "$H" -H 'content-type: application/json' -H 'Idempotency-Key: nightly-2026-11-20-tests' \
  $B/api/tests -d "{\"projectId\":\"$PROJ\",\"docId\":\"$DOC_ID\",\"replace\":false}"

# Build a workflow from all cases, then dry-run it
curl -s -X POST -H "$H" -H 'content-type: application/json' -H 'Idempotency-Key: nightly-2026-11-20-wf' \
  $B/api/workflows -d "{\"projectId\":\"$PROJ\",\"mode\":\"generate\"}"
WF=<returned id>
curl -s -X POST -H "$H" -H 'content-type: application/json' -H 'Idempotency-Key: nightly-2026-11-20-run' \
  $B/api/runs -d "{\"workflowId\":\"$WF\",\"mode\":\"dry-run\"}"
RUN=<returned id>
curl -s -H "$H" $B/api/runs/$RUN                     # poll until status is terminal

# Report from recorded data only
curl -s -X POST -H "$H" -H 'content-type: application/json' -d "{\"projectId\":\"$PROJ\"}" $B/api/reports
```

## 6. Idempotency

On `POST /api/runs`, `POST /api/tests`, `POST /api/workflows`:

- Omit the header → behavior unchanged (fine for interactive use).
- Send `Idempotency-Key: <8–255 chars, [A-Za-z0-9_-:.]>` with mutations you might retry.
- Same key + identical body (order-independent JSON) → the stored response is returned with header `idempotent-replay: true`.
- Same key + different body → `409 idempotency_conflict`.
- Only 2xx responses are stored; errors are never replayed. Entries expire after 24h.

## 7. Error codes (machine-readable)

| HTTP | `code` | Meaning / correct agent reaction |
|---|---|---|
| 400 | `validation_failed`, `invalid_idempotency_key`, `unknown_scope`, `id_required` | Fix the request; do not retry unchanged |
| 401 | `invalid_api_key` | Key rejected; ask the operator — do not retry |
| 403 | `insufficient_scope`, `operator_only` | Needed scope not granted; ask the operator — do not retry |
| 404 | `not_found` | Artifact missing or wrong id |
| 409 | `idempotency_conflict` | Key reused with a different body; use a fresh key |
| 413 | — | Upload too large (SRS limit 15 MB) |
| 429 | `rate_limited` | Back off exponentially |
| 502 | — | Upstream AI/provider failure; retry with jitter, bounded |

## 8. Safety rules an agent must not violate

1. **Dry-run first.** Promote to `playwright` only when the operator said so. `manualReview` asserts are `needs-review`, never "passed".
2. **Desktop input is attended.** Flow: compile → run → preflight → state `awaiting-operator-confirmation` → **operator** confirms via the UI (or a key explicitly granted `desktop:confirm`). Never auto-confirm with a key that merely has `desktop:attend`; never synthesize confirmation text as "evidence".
3. **Load tests** only against targets on the server's `RASQ_JMETER_ALLOWED_ORIGINS` allowlist, with operator authorization. The allowlist is not SSRF/DNS-rebinding protection; do not expose the feature wider because an agent asked nicely.
4. **Do not delete.** `delete:artifacts` is unnecessary for CI triage; leave it ungranted.
5. **Stay in scope of data.** Artifacts can contain sensitive screens/documents; the server redacts text heuristically but not pixels. Treat everything you read as confidential and minimize retention.
6. **Attribution is automatic**: your mutations land in `audit_log` with your key id and name. Do not try to obscure that.
7. **Generated ≠ executed.** A workflow/case/report you create is a generated artifact; only recorded runs are execution evidence, and reports keep that distinction — preserve it in anything you summarize.
8. **`aiMode = "local"`** on the server forces the deterministic engine for all AI tasks, including ones you trigger; do not attempt to flip it without explicit operator instruction (`settings:write`).

## 9. What this does not (yet) give you

- Webhooks push **terminal events only** (no step-level streaming) and delivery is best-effort in-process: a receiver outage never blocks or fails the run, and retries stop after three attempts. There is no SSE stream.
- No `/api/v1` namespace — paths are `/api/...` with additive-only changes inside `openapi.info.version` 1.x.
- No multi-tenancy, no per-project key partitioning; a key can act on every project unless the operator names it down.
- In-process runners are not a durable queue; a server restart can strand a run. Stale desktop and Playwright runs (no progress ≥30 min) and stale performance runs (>120 s) are marked `error` automatically when a list/poll endpoint is next hit, and the terminal webhook fires for them.
- Rate limiting is per process, not distributed.

## 10. Webhooks (terminal events)

**Operator setup** (agents cannot manage webhooks; they are operator-only like key management):

```bash
curl -X POST http://localhost:3000/api/webhooks -H 'content-type: application/json'   -d '{"name":"ci-notify","url":"https://ci.example.com/hooks/rasq","events":["run.completed"]}'
```

The response returns `secret` (`whsec_…`) **once** — store it like a credential. Manage with `GET/PATCH/DELETE /api/webhooks` (`?id=` for delete), send a synthetic event with `POST /api/webhooks/{id}/test`, and inspect attempts with `GET /api/webhooks/deliveries`.

**Event envelope** (same for every type; `POST` with `content-type: application/json`):

```json
{ "id": "evt_<uuid>", "type": "run.completed", "createdAt": "2026-11-20T03:00:00.000Z",
  "data": { "runId": "…", "workflowId": "…", "mode": "playwright", "status": "passed",
            "executor": "playwright", "driver": null, "summary": { "passed": 12 }, "error": null,
            "startedAt": "…", "finishedAt": "…" } }
```

Event types: `run.completed` (Playwright/dry-run, incl. stale-run failure), `desktop.run.completed` (desktop executor), `performance.run.completed`, `webhook.test`.

**Verifying signatures** — every delivery carries:

- `x-rasq-webhook-timestamp: <unix seconds>`
- `x-rasq-signature: v1=<hex>` where `<hex> = HMAC_SHA256(secret, "<timestamp>.<rawBody>")`
- `x-rasq-webhook-id: <event id>`

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
const expected = "v1=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) reject();
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))) reject();
```

Delivery rules: best-effort, fire-and-forget; retries at 0s / +2s / +10s (same event id, `attempt` in the delivery log); every attempt is recorded in `webhook_deliveries` and `lastDeliveryAt`/`lastStatus` on the endpoint; 10s timeout; receivers should answer `2xx` quickly and process asynchronously. RASQ-Ai stores the signing secret (unlike API keys, it cannot be hashed — it is used to sign), so protect `data/` accordingly.

## 11. MCP (Model Context Protocol)

A stdio MCP server exposes the safe subset of this API as tools. It is a **thin adapter**: it holds no credentials of its own beyond the operator-issued key in its environment and forwards every call over HTTP, so scoping, audit and rate limiting are exactly the ones above. Exposed tools: `rasqai_health`, `rasqai_list_projects`, `rasqai_list_requirements`, `rasqai_list_screens`, `rasqai_list_test_cases`, `rasqai_list_workflows`, `rasqai_list_runs`, `rasqai_get_run`, `rasqai_list_reports`, `rasqai_generate_test_cases`, `rasqai_start_dry_run` (the last two take an optional `idempotency_key`). No destructive, attending, or load-generating tools are exposed.

```bash
RASQ_AI_URL=http://127.0.0.1:3000 RASQ_API_KEY=rasq_... npm run mcp
```

MCP client config (Claude Desktop and compatible):

```json
{ "mcpServers": { "rasq-ai": { "command": "npm", "args": ["run", "mcp", "--prefix", "/path/to/rasq-ai"],
    "env": { "RASQ_AI_URL": "http://127.0.0.1:3000", "RASQ_API_KEY": "rasq_..." } } } }
```

## 12. Decision record (why it is built this way)

- **Why API keys and not full SSO/RBAC now?** SSO/tenant isolation is Wave 0 of `ENTERPRISE_ROADMAP.md`. Keys deliver scoped, auditable machine access with minimal surface change and no UI rewrite; browser UI stays single-operator and documented as such.
- **Why scopes on existing routes instead of a new `/api/v1` facade?** One handler per operation, no drift; the OpenAPI document is the contract, versioned via `info.version`. A parallel facade would fork behavior.
- **Why fail closed on bad `Authorization` headers instead of ignoring them?** Silent downgrade to operator (the pre-1.1.0 status quo) is the worst of both worlds.
- **Why is MCP a thin stdio adapter over HTTP instead of a second auth path?** It wraps exactly this scope/audit/idempotency layer; building the layer first means the MCP server is a thin adapter, not a second security boundary.
- **Trade-offs accepted:** additive-only API stability over deep versioning; operator-bypass auth for the UI over breaking the app; best-effort in-memory rate limiting over a distributed limiter; hand-maintained OpenAPI over codegen drift (enforced by review, not tooling).
