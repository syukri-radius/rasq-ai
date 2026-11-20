# WAVE_0_SCOPE — Enterprise trust and runtime foundation

**Status:** Scope only. Nothing in this document is implemented. Approval required per sub-wave before any code is written.
**Written:** 2026-11-20, branch `arena/6b788413-rasq-ai`, against `main@fbca0511` (v1.3.0, Waves A–D merged).
**Decisions locked by the operator (2026-11-20):** deliverable = this plan + Google Doc mirror · deployment target = **single-node self-hosted (keep SQLite)** · identity = **OIDC and SAML both in Wave 0** · artifacts/secrets = **S3-compatible object storage + Vault/KMS integration**.
**Companion documents:** `ENTERPRISE_ROADMAP.md` (Wave 0 entry points here and the exit criteria restated below), `GUARDRAILS.md` (change-control rules for safety posture), `CONTEXT_MEMORY.md`, `AGENT_GUIDE.md`.

---

## 1. Executive summary

Wave 0 makes RASQ-Ai safe to deploy inside an enterprise perimeter for **real users**, not just a single operator. Today the app has *no browser authentication at all* — anyone who reaches the port acts as the operator — runs execute inside the request-serving process and are lost or wedged on restart, artifacts sit on a plain local filesystem next to `.env`, provider/webhook material is only as safe as env vars and host file permissions, and the audit trail is mutation-scoped with no correlation IDs and no before/after fingerprints.

Wave 0 replaces each of those with an honest, single-node answer:

1. **W0.1 — Identity, tenancy and RBAC.** Browser SSO (OIDC Authorization Code + PKCE, **and** SAML 2.0 SP-initiated), server-side sessions with immediate revocation, five roles mapped from IdP groups, row-level tenant scoping on SQLite reusing the Wave D guard pattern, and an authorization sweep across **all 39 API route files** enforced by a CI completeness test.
2. **W0.2 — Durable execution control plane.** SQLite-backed lease/heartbeat queue on the existing `runs`/`run_steps` tables (no new broker to operate): lease owner + expiry, heartbeats, bounded retries with backoff, timeout reaping, cooperative cancellation preserved, idempotent step updates, crash recovery on boot. Runs survive restarts.
3. **W0.3 — Central artifact and secret management.** S3-compatible object storage (MinIO for dev), `artifacts` ledger table (tenant/project scoping, sha256, retention until, legal hold), signed short-lived download URLs, authenticated delete/hold API, `data/` migration script, Vault/KMS-backed secret *references* (`env:`, `vault:`, `kms:`), envelope encryption at rest for webhook HMAC secrets and any settings that hold values, migration of `ai_providers.api_key_env` to resolved-at-use references.
4. **W0.4 — Audit coverage, correlation and network/DLP boundaries.** `x-correlation-id` propagated end-to-end (HTTP → DB → AI calls → webhooks → evidence); `audit_log` extended (tenant, resource, before/after hashes, correlation); new audited flows (approvals, exports, evidence reads, AI calls, retention ops); DNS + redirect revalidation for capture/JMeter targets; egress proxy support; upload limits with an optional malware-scan hook; AI provider region/residency routing policy; secrets never logged or audited.

**Honest scale:** this is not a "two-week hardening pass." It is the largest wave to date — see §8 estimates and §9 risks. The recommended build order is W0.1 → W0.2 → W0.3 → W0.4, with W0.1 split into three shippable increments. **Increment W0.1a (OIDC + sessions + tenant default + route authz sweep for existing behavior) is the only piece recommended for immediate implementation.**

**Non-goals (explicit):** multi-instance/HA/distributed rate limiting, Postgres migration, SCIM, per-tenant compute isolation, durable outbox + at-least-once delivery broker, inline malware blocking, full DLP/pixel redaction, public status/metrics endpoints, re-dispatch of interrupted runs (GUARDRAILS G-11 stays absolute).

---

## 2. Baseline: what Wave 0 starts from (verified against the repo)

| Area | Current state (source) | Gap vs. exit criteria |
|---|---|---|
| Browser auth | None. Missing `Authorization` header = implicit single-operator bypass (`src/lib/agentAuth.ts` `authorize()` / `requireOperator`). API keys are the only principal type; browser UI is anonymous. | No identity, no roles, no revocation, no tenant boundary. **The single largest gap.** |
| Agent auth | SHA-256-hashed keys, scopes, optional `project_ids` partition (tenancy-lite), per-key daily budget (Wave D). Device tokens for desktop agents (`src/lib/desktopAuth.ts`). | Agents coexist fine, but machine credentials must become tenant-scoped too (keys gain `tenant_id`). |
| Runs | In-process async execution from `src/lib/runner.ts`; `pending/running → error` on restart (stale ≥30 min, G-11). No lease, no heartbeat, no retry policy, no queue, no worker identity. | Runs do not survive restarts; no horizontal story; step updates not provably idempotent under retry. |
| Database | SQLite (libSQL) via Drizzle, migrations `0000–0006`, hand-written with meta snapshots. WAL not explicitly forced; `busy_timeout` not explicitly set. | Queue on SQLite needs WAL + busy_timeout discipline; documented contention ceiling (single writer). |
| Artifacts | Local `data/runs/<id>/*.jpg`, `data/recordings`, etc. (`DATA_DIR` in `runner.ts`). Served by authenticated routes, but no signed URLs, no retention ledger, no legal hold, no encryption at rest guarantee. | Anyone who reads the volume reads everything; retention is filesystem-GC only. |
| Secrets | Provider keys **never** stored — only `apiKeyEnv` (name of env var). Webhook HMAC secrets stored plaintext-equivalent (shown once). Vault/KMS absent. | Env-var-name indirection is fine for dev, not for KMS-audited production; webhook secrets move to envelope encryption in W0.3. |
| Audit | `audit_log` (Wave D): actor type/id/name, action, ok/denied, IP, ts; retention-bound; operator-only CSV export. No `tenant_id`, no `resource_*`, no before/after hash, no correlation ID. Reads not audited; AI calls not audited. | Roadmap requires approvals, exports, AI calls, evidence access covered; no correlation means cross-request tracing impossible. |
| Network | Capture/JMeter: protocol + host-class allowlists (JMeter: env origin allowlist). No DNS validation, no redirect re-resolution, no egress proxy, no residency routing. Webhook delivery is caller-configured URL. | A capture target that DNS-rebinds after validation, or an AI provider in the wrong region, is undetected. |
| Desktop agents | Enrollment + device tokens, desktop bundles with sha256 verification (`desktop/runs/[id]/bundle`), attended confirmation gate (G-1). | Unchanged by Wave 0; device tokens stay tenant-reachable (agents enrolled per tenant in W0.1). |

---

## 3. Locked decisions and what they imply

| Decision | Implication chosen here | What it rules out |
|---|---|---|
| Single-node self-hosted, keep SQLite | Tenant isolation = **row-level** `tenant_id` on every table, enforced in application code + CI tests; queue = SQLite tables; sessions = DB rows; backups = file/`.backup`; one writer via WAL. | No Postgres migration, no outbox broker, no multi-instance scheduler, no per-tenant DB. Horizontal scale stays Wave 3. |
| OIDC **and** SAML in Wave 0 | Two browser sign-in paths behind one internal `Identity` abstraction; IdP group→role mapping; authorization-by-role. See W0.1 §5.1. In-app SAML via `node-saml` with strict profile **or** Keycloak-as-broker fallback (open question Q2). | LDAP/Kerberos direct bindings, SCIM, custom per-IdP plugins, SAML SLO (single logout) — SLO documented as unsupported in v1 of Wave 0; operator signs out locally. |
| S3-compatible object storage + Vault/KMS | `@aws-sdk/client-s3` against MinIO/AWS/GCS-compat; SSE-KMS or bucket-default encryption; secrets resolved at use-time from `env:`/`vault:`/`kms:` references with audit on (re)resolution failure; webhook HMAC secrets envelope-encrypted (KMS data key) in DB. | Storing plaintext signing secrets in DB when KMS configured; scenario files carrying raw keys (references only); browser-side decryption. |

---

## 4. Exit criteria (roadmap-derived, made testable)

From `ENTERPRISE_ROADMAP.md`, sharpened so each is falsifiable:

| # | Exit criterion | Verification (owner: implementation) |
|---|---|---|
| E1 | A revoked user loses access **immediately** | Security test: `DELETE /api/sessions/current` / admin revoke → next authenticated request (same cookie, same session row) returns 401 within one HTTP roundtrip (server-side session lookup — no JWT-only caching). |
| E2 | Every object is tenant scoped | Test matrix: create tenant A + tenant B; seed every table via factories; assert every read/write route returns foreign-tenant data never / 404/403; CI `tenant-scope.test.ts` fails if any project-aware query lacks a `tenant_id` predicate or guard. |
| E3 | Runs survive web-process restarts | Kill `node server` mid-run in the e2e harness; boot again; run status transitions via lease expiry to `error` (with reason) or resumes per lease ownership — never stuck in `running` > lease timeout + grace; `run_steps` applied idempotently on retry. |
| E4 | Evidence retention is enforceable | `npm run retention` + legal-hold flag: rows with `legal_hold=1` are never deleted; deleting without hold writes `audit_log` rows; MinIO lifecycle + DB ledger agree within one sweep. |
| E5 | Security teams can audit model and target data flows | For any AI call and any run start: `audit_log` rows carry `correlation_id`, `tenant_id`, `resource_type/id`, hashes; CSV export answers "who/what/when/where" without DB access. |

---

## 5. Sub-wave decomposition

Dependency order: **W0.1 → W0.2 → W0.3 → W0.4**. W0.1 lands first because every artifact, run and audit row written before tenancy exists becomes a backfill liability — and because W0.2/W0.3 both need `tenant_id` on the tables they extend.

### W0.1 — Identity, tenancy and RBAC  (P0, size: L; split into shippable increments a/b/c)

**Data model (migration `0007_identity_tenancy.sql`):**

- `tenants(id, name, slug unique, created_at, settings json)` — migration backfills one `default` tenant and assigns every existing `projects.tenant_id` to it.
- `users(id, tenant_id, subject unique(issuer, subject), email, display_name, status, created_at, last_login_at)` — unique on `(issuer, subject)` pair (store issuer as column; OIDC + SAML may both map to the same person).
- `tenant_memberships(user_id, tenant_id, role, pk(user_id, tenant_id))`; `role ∈ {admin, architect, executor, reviewer, auditor}`.
- `idp_group_role_mappings(tenant_id, group_claim, role)` — operator-managed via UI; evaluated in IdP group order; no match ⇒ login rejected (fail-closed) unless tenant has `default_role` set deliberately.
- `sessions(id, user_id, tenant_id, token_hash unique, created_at, idle_expires_at, absolute_expires_at, ip, user_agent)` — opaque 256-bit cookie value, SHA-256 at rest, `httpOnly; Secure; SameSite=Lax`, idle 30 min + absolute 12 h (env-tunable).
- `api_keys.tenant_id` added; device tokens (`desktop_agents`) gain `tenant_id`; `settings` gain tenant scoping **except** `aiMode` which stays deployment-global (documented exception).
- All project-aware tables gain `tenant_id` (via `projects` join where absent — prefer denormalized `tenant_id` on `projects` + join everywhere else; do **not** duplicate onto child tables yet).

**W0.1a — OIDC sign-in (increment 1):** Authorization Code + PKCE; issuer allowlist from env (`RASQ_OIDC_ISSUER`); client ID/secret from env or `vault:`/`kms:` ref; discovery document cached with 5-min TTL; ID-token validation (iss, aud, exp, nonce); group claim mapping; `/api/auth/sso/callback`, `/login` page (button; falls back to a plain "sign in" form if IdP is down — shows break-glass link when configured); session cookie; `/api/auth/logout` destroys session row.

**W0.1b — RBAC enforcement sweep (increment 2):** roles map onto the existing scope vocabulary as named bundles (single source of truth; agents unchanged):

| Role | Scope bundle | Intent |
|---|---|---|
| `admin` | all scopes incl. `settings:write`, `providers:write`, `webhooks:write`, `agent-keys:write`, `delete:artifacts` | Tenant operator |
| `architect` | observe + generate + `workflows:write` + `requirements:write` + test/req/workflow exports | Builds suites |
| `executor` | observe + `runs:start:dry-run` + `desktop:attend` (confirm still always human) | Runs, no builds |
| `reviewer` | observe + `runs:cancel`? no → read + approve/reject review actions (new `review:write` scope introduced here) | Gate reviews |
| `auditor` | observe (read-only) + `audit:read` + exports of reports | Evidence consumer |

Enforcement: every route file gains an explicit `authorizeHumanOrAgent` gate (agents keep using `authorize()`); unauthenticated browser requests to the UI redirect to `/login`; unauthenticated API → 401 with `code: unauthenticated`. **CI completeness test** imports all 39 route modules and asserts each exports an annotated auth contract — a route added without the gate fails the build. This is the same defense-in-depth posture as Wave D's partition tests.

**W0.1c — SAML sign-in (increment 3):** SP-initiated SSO; metadata import (URL or XML paste) per tenant; `node-saml` with strict signature validation (`wantAssertionsSigned`, `wantAuthnResponseSigned`, no external entity), redirect binding for AuthnRequest, POST/ACS binding for response; NameID → subject (+ email attr), configurable attribute mapping; same group→role mapping table; SAML tracer logging behind `RASQ_SAML_DEBUG=1` (never logs assertions). SLO unsupported in v1 (documented); signing cert rotation = re-import metadata.

**Browser UI:** login page, session-aware header (user, tenant switcher if member of >1 tenant, role badge), admin pages (users, memberships, group mappings) under `/admin` gated to `admin`. API keys page unchanged but extended with tenant column.

**Break-glass:** env `RASQ_BREAKGLASS_ADMINS=email1,email2` — local accounts (email + passphrase, scrypt) that exist **only** when SSO is unreachable or misconfigured; every break-glass login is audited at `status=denied|ok` with `detail: break-glass`; UI shows a banner while break-glass mode is active. Disabled by default (`RASQ_BREAKGLASS=0`).

**Tenancy enforcement:** extend `src/lib/projectAccess.ts` with `projectAllowedInTenant(actor, projectId, tenantId)` — Wave D's 404 semantics stay; the browser path gets the same guard via `currentTenant(session)`. Foreign-tenant access answers 404; lists filter silently. **No row-level ORM magic** — explicit guard calls, same pattern reviewers already know.

**Exit of W0.1:** E1, E2 (partial: browser paths) verified; logout works; session idle/absolute expiry tested; break-glass audited.

### W0.2 — Durable execution control plane  (P0, size: M–L)

**Keep SQLite; add queue semantics, not a broker.** Migration `0008_run_leases.sql`:

- `runs` gains: `lease_owner text null`, `lease_expires_at integer null`, `attempt integer default 0`, `max_attempts integer default 2`, `worker_id text null`, `started_by tenant/user/task null`, `correlation_id text not null default ''`, plus `retry_after integer null`.
- No new service process required by default: a `rasq-worker` section inside the web process polls every 500 ms (`RASQ_WORKER_MODE=inline|standalone`; `standalone` runs `npm run worker` separately for blast-radius isolation — both supported, same lease protocol).
- **Lease protocol:** claim = `UPDATE runs SET lease_owner=?, lease_expires_at=now+30s, attempt=attempt+1 WHERE id=? AND (lease_expires_at IS NULL OR lease_expires_at < now+0) AND status IN ('pending','queued')` — atomic compare-and-set; heartbeat every 10 s extends lease; step writes are `INSERT ... ON CONFLICT(pk) DO NOTHING`/`UPDATE ... WHERE run_id=? AND position=?` idempotent replays; terminal transition writes `finished_at` once (guard by `WHERE finished_at IS NULL`).
- **Reaper:** boot-time + 60 s interval: runs whose lease expired >90 s ago → `status=error`, `error='Lease expired (worker lost)'`, audit row `run.reaper`, webhook `run.failed` fired (G-11: never silently re-run; human restarts).
- **Retry policy:** only `dry-run`-safe transient infra failures (browser launch crash, driver disconnect) may auto-retry, `max_attempts=2`, exponential backoff 2s/8s, and only if zero steps reached `passed` (no side effects applied). Real-browser and attended runs **never** auto-retry (G-11). Retries are audited.
- **Timeouts:** per-run `timeout_ms` (default 15 min; env `RASQ_RUN_TIMEOUT_MS`) — reaper marks `error` with reason; heartbeat stops → lease expiry is the backstop.
- **Cancellation:** existing `desktop_cancel_requested` cooperative flag extends to all runs (`cancel_requested`); cancel sets a flag, worker polls it between steps, terminal state `cancelled`, webhook fires.
- **Stale detection (G-11 preserved):** existing ≥30-min stale → error stays as a UX affordance; the lease reaper is the enforcement.

**Exit of W0.2:** E3 verified by chaos test (kill -9 mid-run; assert reaper transition, no `running` orphans, evidence of a single truthful terminal state); lease CAS race test (two claimed workers → one wins); retry only for infra-before-side-effects.

### W0.3 — Central artifact and secret management  (P0, size: L)

**Storage (migration `0009_artifacts.sql`):**

- New table `artifacts(id, tenant_id, project_id null, kind, s3_key, bytes, sha256, content_type, retention_until, legal_hold boolean default 0, created_at, created_by)`; existing file outputs move under key `tenants/<tid>/projects/<pid>/<kind>/<runId>/<filename>`.
- Write path: runner/screens/recordings code paths write through `src/lib/artifactStore.ts` (`put/get/signedUrl/delete`) — interface first, two impls: `LocalArtifactStore` (dev default; refuses to serve outside DATA_DIR; same behavior as today for existing folders) and `S3ArtifactStore` (SDK v3; bucket from env `RASQ_S3_BUCKET`, endpoint `RASQ_S3_ENDPOINT`, path-style for MinIO; **bucket must have public access blocked** — startup check fails fast otherwise).
- Download: `GET /api/artifacts/<id>/download` → 302 to a **60-second signed URL** (or streams through for LocalArtifactStore); direct bucket access never granted; HMAC comes from S3, not app tokens.
- **Retention & legal hold:** `retention_until = created_at + RASQ_ARTIFACT_RETENTION_DAYS` (default 365); `legal_hold=1` excludes from deletion; hold/release requires `admin` and writes audited rows with `before/after` hash of the hold row; `DELETE` is a two-phase (mark → sweep → audit) operation, never a raw bucket delete.
- **Migration:** `scripts/migrate-artifacts.mts --dry-run|--apply` — walks `data/`, streams into bucket, verifies sha256 round-trip, rewrites DB references, flips `ARTIFACT_BACKEND=s3`; refuse to delete `data/` until operator runs `--prune` post-verification (and never if `legal_hold` rows exist in the ledger).
- **Consistency:** artifact write is quiesced/verified with a `rasq-artifact sync` boot check (missing keys vs ledger → loud warning, exit non-zero in strict mode).

**Secrets (migration `0010_secret_refs.sql`):**

- New table `secret_refs(id, tenant_id, name, ref_type(env|vault|kms|s3-kms), ref_value, purpose, created_at, last_resolved_at, last_status)` — **references only, never values**. Operator-managed UI under `/admin/secrets`.
- Reference grammar: `env:VAR_NAME` (dev default) · `vault:kv/<mount>/<path>#field` (Vault KV v2, token from `RASQ_VAULT_TOKEN` env; AppRole/JWT documented) · `kms:us-east-1:alias/rasq-tenant-<tid>` (AWS KMS: ciphertext stored in DB, decrypted at use-time) · `s3-kms` for bucket SSE.
- **Applied to:** AI provider keys (`ai_providers.api_key_env` becomes `api_key_ref` with backward-compatible read of the old column for one minor version, then migration completes); webhook HMAC secrets (**now stored envelope-encrypted** when `kms:` configured — closes the G-13 gap that the plaintext HMAC secret can't be hashed); settings values that contain secrets; desktop agent enrollment tokens stay env-only (deployment-global).
- **Envelope encryption:** data key encrypts value → data key wrapped by KMS master → wrapped key + ciphertext in DB. Key rotation = re-wrap job (`scripts/rewrap-secrets.mts`). Decryption cache in-process 60 s; every decrypt is counted; failures are fail-closed (provider call returns 503 `secret_unavailable`), audited with ref name (never value).
- **Scenarios/exports:** export paths (`tests/export`, `workflows/[id]/export`) pass through a leak-pattern scanner (generic API-key regexes + configured tenant patterns) and **refuse to export** matches, printing names of offending refs — closes "secrets exfiltrate into a pasted workflow."

**Exit of W0.3:** E4; MinIO round-trip migration rehearsed on a copy of production `data/`; download requires auth in both backends; webhook secrets verified unreadable in DB dumps (ciphertext only).

### W0.4 — Audit coverage, correlation and network/DLP boundaries  (P0, size: M)

**Correlation middleware:** `x-correlation-id` accepted if `^[A-Za-z0-9-]{8,64}$`, else generated (`crypto.randomUUID()`); attached to `req.ctx`, echoed on all responses, propagated into: `audit_log`, `runs.correlation_id`, AI gateway calls (as `x-correlation-id` header + in `ai_calls.correlation_id`), webhook deliveries (`webhook_deliveries.correlation_id`), artifact rows. One request → one id → every row greps together.

**Migration `0011_audit_network.sql`:**

- `audit_log` gains: `tenant_id`, `resource_type`, `resource_id`, `before_hash`, `after_hash` (sha256 of canonical JSON for the before/after object at mutation sites that opt in — starts with `projects`, `settings`, `agent-keys`, `webhooks`, `memberships`), `correlation_id`, plus index `(tenant_id, correlation_id)`.
- **New `ai_calls` table:** `id, tenant_id, correlation_id, task, provider_id, model, prompt_sha256, response_sha256, prompt_bytes, response_bytes, status, latency_ms, created_at` — **no prompt/response text** (privacy); enough to answer "who called which model, when, for what task, what it cost at ~bytes scale." Mutation-adjacent denials still logged to `audit_log`.
- **New audited actions** (denials + successes): user/membership/mapping changes, session revoke, artifact download/delete/hold, retention sweep, secret ref create/update/resolve-failure, AI call denial (`policy_region_denied`), webhook retarget (already audited — add resource hashes).

**Network egress (fetchers + capture + JMeter + webhooks + AI gateway):**

- `src/lib/netGuard.ts`: parse URL → resolve DNS (`dns.promises.lookup(hostname, {all:true})`) → block `private|loopback|link-local|CGNAT|documentation` ranges **after** resolution (and on every redirect hop — follow at most 3 redirects manually, revalidating each) → optional `RASQ_EGRESS_PROXY=http://…` honored by AI gateway + capture + JMeter clients.
- JMeter: extend existing origin allowlist to revalidate the **resolved IP at dispatch time**. Capture: same guard (replaces protocol+host-class check; old behavior kept behind `RASQ_EGRESS_GUARD=0` for dev only).
- Webhooks: DNS guard applies when `RASQ_EGRESS_GUARD=1` (default off for dev; on in `production`) — receivers on RFC1918 need a per-endpoint allowlist exception (operator-set, documented) since internal receivers are legitimate.
- **Uploads:** per-route byte caps (`requirements` docs 10 MB, recordings 50 MB, SRS 5 MB) with streaming abort; optional ClamAV hook (`RASQ_CLAMAV_HOST`) — on scan hit, quarantine flag on the artifact + audit + serve 403 (fail-closed on infected, fail-open-with-warning on scanner-unreachable per policy flag).
- **AI residency routing:** `ai_providers.region` (ISO 3166-1 alpha-2) + tenant policy `policies.kind='region_deny'` content `{"deny":["CN","RU"]}` style (or reuse `policies` table with kind `routing`) — router **refuses** or reroutes; denial audited with correlation id. `policies` table already exists — extend rather than invent.

**Exit of W0.4:** E5; simulated SRS "export" exfil test passes (blocked); DNS-rebinding test (mock resolver flips to 10.x) blocked; AI region-deny test; correlated trace demo: one `x-correlation-id` → audit rows + `ai_calls` + `webhook_deliveries`.

### W0.5 — Rollout, verification and docs  (part of each sub-wave's tail, not a phase)

- Per sub-wave: migration rehearsal on a **copy** of production `data/` + DB; feature flags (`RASQ_SSO_MODE=off|oidc|oidc+saml`, default `off` until W0.1a verified); flag documented in README + `.env.example`.
- Docs: `SSO_SETUP.md` (Okta/Entra/Google/Keycloak metadata + mapping recipes), `MIGRATING_TO_1.4.0.md`, updated `CONTEXT_MEMORY.md`, `ENTERPRISE_ROADMAP.md` (Wave 0 → delivered/pending), `AGENT_GUIDE.md` §SSO, `GUARDRAILS.md` → new **G-17** (SSO required in any shared deployment; browser UI without SSO is dev-only) — via change control in §5 of GUARDRAILS.
- Final demo pack: exit-criteria evidence for E1–E5 (test names + outputs).

---

## 6. Migration sequence (hand-written, meta snapshots, same convention as 0000–0006)

| # | File | Contents | Backfill | Rollback |
|---|---|---|---|---|
| 0007 | `0007_identity_tenancy.sql` | `tenants`, `users`, `tenant_memberships`, `idp_group_role_mappings`, `sessions`; `projects.tenant_id NOT NULL` (default tenant); `api_keys.tenant_id`; `desktop_agents.tenant_id` | Single `default` tenant; all existing projects/keys/agents → default; existing operator continues to work as implicit tenant admin **once** via break-glass (documented) | Drop tables; `projects.tenant_id` nullable again |
| 0008 | `0008_run_leases.sql` | `runs` ← `lease_owner, lease_expires_at, attempt, max_attempts, worker_id, correlation_id, cancel_requested, started_by`; index `(status, lease_expires_at)` | `correlation_id=''` for existing rows | Drop columns |
| 0009 | `0009_artifacts.sql` | `artifacts` ledger; `projects` unchanged; indexes `(tenant_id, project_id)`, `(legal_hold)` | Ledger empty until `migrate-artifacts.mts --apply` | Drop table; files untouched |
| 0010 | `0010_secret_refs.sql` | `secret_refs`; `ai_providers.api_key_ref text null` (legacy `api_key_env` kept, read-fallback one minor); `webhooks.secret_ciphertext`, `webhooks.secret_ref` nullable | Webhook secrets remain readable pre-rewrap; rotation job migrates | Drop columns (plaintext secret column retained until verified) |
| 0011 | `0011_audit_network.sql` | `audit_log` ← `tenant_id, resource_type, resource_id, before_hash, after_hash, correlation_id`; new `ai_calls`; index `(tenant_id, correlation_id)` | New columns nullable → backfill `correlation_id=''` | Drop columns/table |

All migrations are additive; destructive steps are separate, manual npm scripts (`retention`-style), never inside the migrator.

---

## 7. Authorization matrix outline (39 routes → completeness enforced in CI)

Route families × required role (agents keep existing scopes; `admin` ⊇ everything; UI redirects to `/login` when absent):

| Family | Routes (examples) | Min role | Notes |
|---|---|---|---|
| Identity/admin | `/admin/*`, `agent-keys`, `webhooks`, `retention` ops | `admin` | Break-glass logins audited |
| Audit read/export | `audit` | `admin` or `auditor` | Agents never |
| Build/generate | `tests`, `requirements`, `screens`, `workflows`, `ai/scan` | `architect` | Dry-run scopes still agent-legal |
| Execute | `runs` (start dry-run), `desktop/runs` (attend), `performance` | `executor` | `desktop:confirm` = human-in-loop always (G-1) |
| Approve/review | review actions, `reports` (accept) | `reviewer` | Review bypass = 403 + audit |
| Evidence read | shots, recordings, reports (download), `audit` export | `auditor`+ | Evidence reads now audited (W0.4) |
| Settings/providers | `settings`, `providers`, `capture` | `admin` | Residency policy enforced at call site |
| Project read | lists | any member | Tenant filter applied |
| Deployment-global read | `health`, `openapi.json` | public | Unchanged |

The CI test asserts each route module declares `export const authContract = { role: "…" }` (or agent scope); unannotated ⇒ build fails. The matrix above is the *starting* annotation, adjusted in review.

---

## 8. Sizing and sequencing (estimates, not commitments)

| Sub-wave | Estimate (1 senior + review) | Ships as |
|---|---|---|
| W0.1a OIDC + sessions + default tenant + authz middleware + CI completeness test | 1.5–2 weeks | v1.4.0-a |
| W0.1b RBAC bundles + admin UI + break-glass | 1–1.5 weeks | v1.4.0-b |
| W0.1c SAML | 1–2 weeks (most variance: attribute mapping, signature profile) | v1.4.0 |
| W0.2 Durable queue (SQLite leases) | 1.5–2 weeks + chaos harness | v1.4.0 |
| W0.3 S3 artifacts + migration + Vault/KMS refs + webhook envelope | 2–3 weeks (most variance: KMS/Vault wiring in customer env) | v1.4.0 |
| W0.4 Correlation + audit extension + netGuard + ai_calls + residency routing | 1.5–2 weeks | v1.4.0 |
| Verification, docs, rehearsal, demo pack | 1 week | v1.4.0 |
| **Total** | **~9–13 weeks** | |

Parallelism: W0.2 and W0.3 can interleave after W0.1a (separate tables); W0.4 depends on both for correlation fields. Critical path = W0.1 → W0.2 → E3.

Recommended immediate next step (not started): **W0.1a only**, on its own branch, behind `RASQ_SSO_MODE`.

---

## 9. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| SAML signature-wrapping / XML pitfalls | High | `node-saml` strict profile; pinned metadata with expiry alarm; assertions never logged; interop tested against Okta/Entra reference IdPs before merge |
| SQLite contention under queue + UI load | Medium | WAL, `busy_timeout=5000`, single-writer claim via CAS on indexed columns, lease writes batched, `PRAGMA optimize` on schedule |
| Backfill assigns everything to `default` tenant silently | Medium | Migration logs counts; post-migration verification script asserts row counts per table before/after |
| KMS/Vault misconfig bricks provider calls | High | `env:` references remain supported forever (dev); fail-closed per provider with `secret_unavailable`; resolve-dry-run command (`npm run secrets:check`) before cutover |
| Webhook secret rewrap loses signing capability | Medium | Dual-read during `0010` (old plaintext column retained until rewrap verified); rotation is operator-run, reversible until dropped |
| Session cookie theft | Medium | httpOnly + Secure + SameSite=Lax, 8h absolute + 30min idle, `__Host-` prefix when served over HTTPS, no session data in JWT (no client-side decrypt target) |
| Tenant guard forgotten in a new route | High | CI completeness test (§7) + Wave D-style partition tests parameterized per tenant; review checklist in PR template |
| data/ migration mid-flight loss | High | Two-phase (copy → verify sha256 → switch backend) with `--prune` gated behind explicit flag and legal-hold check; no auto-delete ever |
| Operator locks themselves out (IdP down + no break-glass) | Medium | Break-glass off-but-documented; boot flag `RASQ_SSO_MODE=off` restores v1.3.0 behavior in one restart (data intact: sessions dropped) |
| Cost: AI calls table growth | Low | `ai_calls` retention bound 90d default (`RASQ_AICALLS_RETENTION_DAYS`); hashes only, no content |

---

## 10. Non-goals (explicit, do not re-litigate inside Wave 0)

Postgres/MySQL migration; multi-instance scheduling; distributed rate limiting; SCIM user provisioning; per-tenant compute or network isolation; durable outbox/at-least-once delivery broker; SSE streaming; full DLP incl. pixel redaction; inline blocking malware scanning (hook is scan-and-quarantine); public status page; SLOs/OpenTelemetry (Wave 3); WORM evidence (Wave 0 provides ledger + hold; immutable object lock is Wave 3 with compliance pack); re-dispatch of interrupted runs (G-11).

---

## 11. Open questions for the operator (blocking nothing here; blocking W0.1a start)

1. **IdPs to certify against for W0.1c** — Okta, Entra ID, Google Workspace, Keycloak? (determines which metadata fixtures land in tests).
2. **In-app SAML via `node-saml` vs Keycloak broker** — Keycloak gives SAML (+OIDC) for free at the cost of running one more component; my default recommendation is in-app `node-saml` to keep the deployment single-process, with Keycloak documented as the escape hatch if signature interop burns time. Confirm preference.
3. **Single-tenant vs. multi-tenant first customer** — does the default deployment stay one logical tenant forever, or must the UI tenant switcher be ready for genuinely many tenants on day one of W0.1a?
4. **Retention default for artifacts** — 365 days arbitrary; compliance may demand 7 years (→ bucket object-lock, Wave 3) or 90 days. Confirm.
5. **Break-glass policy** — allowed at all in your environment, or forbidden by policy (SSO-only with documented recovery procedure)?
6. **`ai_calls` privacy review** — hash-only call ledger acceptable to your DPO/security team, or is even task+model+provider too much without consent?

---

## 12. Rollback plan (per sub-wave)

- **W0.1a:** set `RASQ_SSO_MODE=off` → redeploy → v1.3.0 behavior (implicit operator) restored; `sessions` table ignored; no data loss (sessions are ephemeral).
- **W0.1b/c:** same flag; role checks become no-ops in `off` mode (documented as emergency-only; audited).
- **W0.2:** `RASQ_WORKER_MODE=inline` (default) vs `standalone` is a config rollback; lease columns inert if reaper disabled (`RASQ_REAPER=0`) — runs behave like v1.3.0 stale-marked errors.
- **W0.3:** `ARTIFACT_BACKEND=local` → reads fall back to `data/`; ledger retained for audit; S3 objects untouched.
- **W0.4:** `RASQ_EGRESS_GUARD=0`; `ai_calls` writes disabled via `RASQ_AI_CALLS_LEDGER=0`; audit columns nullable so nothing breaks.
- Database: every migration additive; downgrades = previous app version + leave new tables/columns in place (inert).

---

## 13. Change control

This document is a scope contract. Editing it means changing Wave 0's safety posture — same rule as `GUARDRAILS.md` §7. Update `CONTEXT_MEMORY.md` and name the decision that changed. Implementation PRs reference this file section by section (W0.1a → §5/W0.1a, etc.). The Google Doc mirror is generated from this file and must be regenerated, not hand-edited, after any change.

*Source of truth: this file. Mirror: RASQ-Ai — Wave 0 Scope (Google Doc), 2026-11-20.*
