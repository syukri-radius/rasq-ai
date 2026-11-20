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

- No webhooks/SSE — poll `GET /api/runs/{id}` (≥900 ms interval) or `GET /api/performance/runs?id=`. Event push is a planned (Wave C) integration surface.
- No `/api/v1` namespace — paths are `/api/...` with additive-only changes inside `openapi.info.version` 1.x.
- No multi-tenancy, no per-project key partitioning; a key can act on every project unless the operator names it down.
- In-process runners are not a durable queue; a server restart can strand a run (desktop runs are marked stale automatically).
- Rate limiting is per process, not distributed.

## 10. Decision record (why it is built this way)

- **Why API keys and not full SSO/RBAC now?** SSO/tenant isolation is Wave 0 of `ENTERPRISE_ROADMAP.md`. Keys deliver scoped, auditable machine access with minimal surface change and no UI rewrite; browser UI stays single-operator and documented as such.
- **Why scopes on existing routes instead of a new `/api/v1` facade?** One handler per operation, no drift; the OpenAPI document is the contract, versioned via `info.version`. A parallel facade would fork behavior.
- **Why fail closed on bad `Authorization` headers instead of ignoring them?** Silent downgrade to operator (the pre-1.1.0 status quo) is the worst of both worlds.
- **Why not MCP yet?** MCP is the right next integration (Wave C) but wraps exactly this scope/audit/idempotency layer; building the layer first means the MCP server is a thin adapter, not a second security boundary.
- **Trade-offs accepted:** additive-only API stability over deep versioning; operator-bypass auth for the UI over breaking the app; best-effort in-memory rate limiting over a distributed limiter; hand-maintained OpenAPI over codegen drift (enforced by review, not tooling).
