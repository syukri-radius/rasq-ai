# GUARDRAILS — Non-negotiable rules for trustworthy automation in this domain

Written 2026-11-20 against RASQ-Ai v1.3.0 (after Waves A–D). This document explains the guardrails that are not design preferences but properties of the domain: **visual test automation that can act on real software, with real privileges, on behalf of whoever holds the keys** — and the trade-offs each guardrail forces. It is the companion to `AGENT_GUIDE.md` (how agents use the system), `CONTEXT_MEMORY.md` (source of truth), and `ENTERPRISE_ROADMAP.md` (what is deliberately not built yet). If anything here disagrees with the source, the source wins — verify before relying on it. Not legal or compliance advice.

---

## 0. Why this domain is different

Three properties make guardrails here different from ordinary web-app security:

1. **Actions can be irreversible and physically input-like.** A browser click sends a form; a desktop action synthesizes OS input with the operator's authority. You cannot undo "submit purchase order" by rolling back code.
2. **Artifacts are sensitive by construction.** Screenshots, recordings, SRS documents and run evidence contain whatever was on screen — often credentials, customer data, or pre-release designs. Pixels are not redactable by policy text.
3. **AI is confidently wrong at scale.** A model that passes a test suite it doesn't understand is worse than no automation: it manufactures false confidence, the one thing an evidence product may never do.

Every guardrail below exists because of one of these three properties. A guardrail without that anchor is probably ceremony — see §5.

---

## 1. The non-negotiable guardrails

### G-1 — Real OS input requires a human, in the loop, after preflight
**What:** Attended desktop execution stops at `awaiting-operator-confirmation`; only the operator (UI) or a key explicitly holding `desktop:confirm` may authorize input. Preflight checks (window title, display, agent availability, capabilities) precede the gate.
**Why non-negotiable:** Synthesized keyboard/mouse input acts with the user's full session — on the wrong window, the wrong fiscal year, the wrong production database. Irreversible by definition.
**What is acceptable:** Operator clicks confirm per run; CI holds a `desktop:confirm` key *only* when humans review preflight output before promotion.
**Trade-off forced:** "Lights-out desktop automation" is categorically off the table. Good. Anyone selling it to you is skipping the gate.

### G-2 — Allowlists, not just authentication, for anything that attacks or overloads a target
**What:** `performance:load` requires (a) the scope, (b) `confirm:true`, (c) the target origin on `RASQ_JMETER_ALLOWED_ORIGINS`, (d) an operator decision. `capture:run` is restricted to http(s) with link-local/metadata denylists.
**Why non-negotiable:** Authentication answers "who are you," never "may you do this to *this* target." Load generation pointed at the wrong host is a denial-of-service with a friendly UI.
**Trade-off forced:** Allowlist maintenance is operator toil. Accepted: the allowlist is the control; the confirmation is politeness; the scope is bookkeeping.
**Honest limit:** The allowlist is not SSRF or DNS-rebinding protection. Do not widen exposure because an agent "needs" it.

### G-3 — A present-but-invalid credential is always 401, never a quiet downgrade
**What:** An `Authorization` header that fails validation is rejected (`401 invalid_api_key`), audited as `denied`, and never falls back to the operator bypass.
**Why non-negotiable:** Fallback-to-operator is indistinguishable from privilege escalation; it makes every stolen/mangled key silently full-access.
**Trade-off forced:** A misconfigured agent gets 401s, not a working session. That is the correct failure.

### G-4 — Destructive, attending and load scopes are never in the recommended set
**What:** `RECOMMENDED_AGENT_SCOPES` = observe + generate + dry-run. `delete:artifacts`, `runs:start:playwright`, `performance:load`, `desktop:attend`, `desktop:confirm`, `desktop:revoke` are grant-per-need; `settings:write`/`providers:write` are treated as rarely-granted.
**Why non-negotiable:** The blast radius of one leaked key defines your posture. Least privilege must be the default, not the exception an operator must remember to configure.
**Trade-off forced:** Agents onboard slightly slower; the operator says "yes" to escalations explicitly. The audit log makes those "yeses" visible after the fact.

### G-5 — Mutating calls are idempotent and attributable
**What:** `Idempotency-Key` on `POST /api/runs|tests|workflows` replays the stored 2xx body (`idempotent-replay: true`) or 409s on body drift. Every mutation writes `audit_log` (actor, action, ok/denied, IP).
**Why non-negotiable:** Agents retry. Retries must not double-fire browser runs, regenerate case suites, or duplicate spend — and when something goes wrong you must be able to name who did it.
**Trade-off forced:** 24h of stored responses; occasional `409 idempotency_conflict`s; audit rows you must actually review (that is the job).

### G-6 — Spend boundaries fail closed, at the counter, with the audit trail attached
**What:** Database-backed fixed-window minute limit (`RASQ_AGENT_RATE_LIMIT`, default 120) and optional per-key per-UTC-day budget (`dailyMutationLimit`). Denial → `429 rate_limited` / `daily_budget_exceeded` + audit row. If the counter itself cannot be written → `503 rate_limiter_unavailable`, never an unmeasured free pass.
**Why non-negotiable:** AI-backed generation and browser execution burn real money and real targets; a runaway agent is a financial and operational incident, not a nuisance. Fail-closed bounds the blast radius when the system is degraded.
**Trade-off forced:** During a database outage, agent mutations stop while reads may continue. That is the intended failure mode — never invert it to "probably fine, allow."

### G-7 — `manualReview` is never `passed`
**What:** Assertions of kind `manualReview` map to `needs-review`; generated artifacts are never reported as executed evidence. The distinction survives into reports.
**Why non-negotiable:** A false pass is worse than a false fail. The entire product promise — trustworthy — dies the moment the suite "passes" something nobody observed.
**Trade-off forced:** More human review; noisier dashboards. Correct by design; do not "clean up" by mapping to `warning` either — `needs-review` exists to be resolved.

### G-8 — Evidence outranks narrative
**What:** Reports are built from recorded runs, stored screenshots and traceability rows, with provenance strings preserved (`rasq-local-rules-v1`, provider model id). AI summarizes evidence; it does not certify.
**Why non-negotiable:** An evidence product that accepts claims without evidence is a rumor with a cover page.
**Trade-off forced:** Reports are only as strong as your recorded runs; ceremonial "AI says it works" output is not acceptable in RASQ-Ai, internally or externally.

### G-9 — The operator's kill switch is sovereign
**What:** `aiMode = "local"` forces deterministic engines for all AI tasks, including agent-triggered ones. Agents cannot flip it without `settings:write` — which they should never hold.
**Why non-negotiable:** Data residency, provider trust and spend are operator decisions, not tool-user decisions.
**Trade-off forced:** "My agent needs a smarter model than Local" is a human escalation, full stop.

### G-10 — Redaction is a speed bump, never a shield
**What:** Server-side text redaction is heuristic and lossy; **pixels are not redacted at all**. Handling rule: minimize what you read and retain; export over copy; assume artifacts leak.
**Why non-negotiable:** One screenshot of a settings page can contain a provider key; no regex saves you.
**Trade-off forced:** Hygiene burden on operators and agents; artifacts directory is credential-adjacent storage; see also G-12 retention.

### G-11 — No silent retries of browser actions
**What:** In-process runs interrupted by restart are marked `error` with an honest message (≥30 min stale); never re-dispatched automatically. Cancellation is cooperative; terminal states fire webhooks truthfully.
**Why non-negotiable:** Re-executing a half-finished form fill on a real system can double-apply a real-world effect. "Retry" is only safe when idempotent or when attended.
**Trade-off forced:** Interrupted runs need a human to restart them. That human gets a clear error and a clean audit row instead of a silent mess.

### G-12 — Append-only stores are bounded, and deletion is a compliance act
**What:** `audit_log`, `idempotency_keys`, `webhook_deliveries`, `usage_counters` are retention-bound (`RASQ_AUDIT_RETENTION_DAYS`=180, `RASQ_WEBHOOK_DELIVERY_RETENTION_DAYS`=90, `RASQ_IDEMPOTENCY_RETENTION_HOURS`=25, counters 2d/400d). `npm run retention` or the opportunistic sweep performs deletions.
**Why non-negotiable:** Unbounded growth breaks backups, slows audit queries and violates minimization duties; unbounded *retention of what you meant to delete* is equally bad.
**Trade-off forced — and this one bites:** Audit deletion is irreversible. If you need WORM evidence, export CSV first and mirror it; the retention knob and the export button ship together for exactly this reason.

### G-13 — Signing secrets and API keys are different animals — treat accordingly
**What:** API keys are SHA-256 hashed at rest (unrecoverable; shown once). Webhook secrets are HMAC signing keys — they **cannot** be hashed, or delivery breaks. Stored plaintext-equivalent, shown once, scoped per endpoint.
**Why non-negotiable:** Hashing the webhook secret silently destroys the receiver contract; pretending otherwise is wishful cryptography.
**Trade-off forced:** `data/` holds signing capability. Compromise ⇒ delete and re-create the endpoint (rotation), never "edit the secret in place."

### G-14 — Agents receive; operators re-wire
**What:** Webhook endpoints and API keys are operator-only to manage. An agent may not register a new receiver, retarget an existing one, or mint its own credentials.
**Why non-negotiable:** Delivery re-pointing is the classic exfiltration pivot — one `url` field turns your terminal events (which include artifact paths and run metadata) into someone else's feed.
**Trade-off forced:** Onboarding an agent's notification path is a human action. That is the feature.

### G-15 — Partition is not isolation — say it out loud
**What:** `project_ids` on a key means foreign projects answer 404 and lists filter silently. Settings, providers, `agent-keys`, `webhooks`, `audit`, the desktop device protocol, `capture` and `ai:scan` are **not partitioned** — they carry no project id.
**Why non-negotiable:** Buyers confuse "scoped keys" with "tenant isolation." If the industry lets you imply isolation you did not build, the first confused deployment becomes an incident and a claim.
**Trade-off forced:** Honest coarse boundaries today; SSO/RBAC/tenant isolation remains Wave 0 (`ENTERPRISE_ROADMAP.md`) with OIDC and per-tenant data partitioning, not a flag on this table.

### G-16 — The MCP surface inherits, never extends, the HTTP contract
**What:** `rasqai_*` tools are a thin adapter over the same API: same keys, same scopes, same audit, same budgets, same 404s. No destructive, attending or load tools are exposed.
**Why non-negotiable:** A second authorization path is a second place to get it wrong, forever.
**Trade-off forced:** MCP clients get exactly what the operator's key allows, nothing more; equality of capability with HTTP is the test any new tool must pass.

---

## 2. The trade-off ledger (what we paid for these guardrails)

| # | Decision | Gain | Cost | Revisit when |
|---|---|---|---|---|
| 1 | Browser UI stays single-operator, no login | Zero-friction local UX; app works | Anyone reaching the port acts as operator | Any shared/multi-user deployment → SSO/proxy (Wave 0) |
| 2 | API keys as the only machine boundary | Simple, auditable, scoped | No SCIM/rotation policies; keys leak via env files | SSO wave |
| 3 | Fail-closed limiter (G-6) | Runaway spend bounded | Agent mutations stop on DB outage | Never relax; add read-path degradation instead |
| 4 | Fixed-window limiter (not sliding/token bucket) | Trivial to reason about; one upsert | 2× burst at window edges | If edge bursts hurt → sliding window, same table |
| 5 | DB-backed limiter (not distributed) | Survives restarts; one store | Single-node only | Multi-instance → external store; same fail-closed semantics |
| 6 | Retention deletion of audit rows | Bounded growth; backups viable | Irreversible evidence loss | Legal hold → raise window + CSV/WORM mirror; never "disable sweep" |
| 7 | Partition answers 404 (not 403) | No project-id enumeration | Foreign artifacts "don't exist" for scoped agents | Never change; operator has full visibility anyway |
| 8 | Unpartitioned deployment-global surfaces (G-15) | No fake isolation; honest model | Documented non-coverage | Tenant wave |
| 9 | Webhooks in-process, 3 attempts (0s/2s/10s) | Runs never blocked by receiver health | Events lost in long outages | Delivery SLA needed → durable queue + outbox (Wave D queue-shaped work, not built) |
| 10 | No SSE/streaming | Simple stable contract; webhooks suffice for terminal events | Polling latency; chatty clients | If monitoring demands push on step events → SSE over the same event bus, same auth |
| 11 | OpenAPI hand-maintained | No codegen treadmill; reviewed deltas | Drift risk, human error | Contract tests per route; still human-reviewed |
| 12 | `runs:start:dry-run` unguarded by confirmation | Dry-run = validation only; CI can run freely | None material | Never gate validation |
| 13 | `capture:run` allowlist is protocol+host-class based (not domain allowlist) | Capture stays usable generically | Residual egress risk vs target | If capture must lock to specific targets → origin allowlist like JMeter |
| 14 | MCP thin adapter (no tool-specific auth) | One security model; one audit path | Per-call HTTP overhead | If latency matters → batch tools, identical auth |
| 15 | AI blocked from desktop confirmation by scope design | G-1 enforced by architecture, not by policy text | Agents can never self-confirm | Never |
| 16 | Reports require recorded evidence (G-8) | Trustworthy artifacts | AI alone cannot produce a so-called "report" | Never |
| 17 | Idempotency stores 2xx for 24h | Safe retries | Body-drift 409s confuse naive clients | 409 semantics documented; keep |
| 18 | Reads are not audited | Log volume; privacy hygiene | Who-read-what is invisible | High-sensitivity regimes → audit evidence access too (with its own retention cost) |
| 19 | `needs-review` is terminal-but-unfinished | Honest signal | Workflow friction | Fix assertions; never downgrade to `passed` |
| 20 | Secrets shown once | Unrecoverable-by-design | Operator must stash at creation | Password managers / KMS; clipboard policy is on you |

## 3. What is deliberately NOT guarded (and why)

- **Dry-run execution** — validates structure; executes nothing. Gating it would be guardrails theater.
- **Read scopes** — reads expose artifact content but cannot change state or spend; grants should still follow need-to-know (G-10), not "block everything by default."
- **Operator convenience paths** — the UI is the trust anchor; guarding the operator from themselves (G-1 handled the one exception with an in-loop confirmation) would duplicate human judgment with slower human friction.
- **MCP read tools** — read-only, scoped, audited mutations absent; low harm; blocking them would harm legitimate use.

Guardrails earn their keep by being few, absolute, and honest. Twenty-five absolute guardrails are twenty-four you will eventually route around. These sixteen don't bend; the rest of security posture is hygiene.

## 4. Incident response quick reference (first 15 minutes)

1. **Freeze the suspect key:** `DELETE /api/agent-keys?id=<id>` — immediate revocation, audit row written. If scope of compromise is unknown, freeze all agent keys; the UI keeps working.
2. **Freeze outbound wiring:** `GET /api/webhooks` → `PATCH {enabled:false}` on anything unexpected; `DELETE` if hostile. Rotate: delete + re-create; never edit secrets in place.
3. **Pull the trail:** `GET /api/audit?actorId=<key-id>&format=csv` — denials, mutations, targets. `x-returned-count` tells you if you're seeing everything (≤10k); for more, paginate JSON.
4. **Contain blast radius:** check `webhook_deliveries` for what left the building; check `runs` evidence directories for what was captured; check provider dashboards for AI spend on configured routes.
5. **Preserve evidence before retention deletes it:** export the audit CSV now; the sweep does not wait for your investigation (G-12).
6. **Rotate adjacent secrets:** provider env vars named in suspect requests; desktop device tokens (`/api/desktop/agents` revoke); RASQ_JMETER_ALLOWED_ORIGINS review if load scopes were held.
7. **Only then** patch, restart, re-enable — and write the postmortem against this document's guardrails list: which G-number should have existed or fired?

## 5. Anti-patterns — "just this once" edits that void the warranty

1. "Add an `--auto-approve` for desktop confirmation in CI." → voids G-1; preflight becomes decoration.
2. "Make the webhook secret hashed at rest like API keys." → voids G-13; every receiver breaks; silent unavailability.
3. "Let MCP call `desktop:confirm` because clicking is annoying." → voids G-1 and G-16; the one button that must exist is the human's.
4. "Map `needs-review` to `passed` so the dashboard is green." → voids G-7; false-pass factory.
5. "Turn off the fail-closed limiter because integration tests keep 429ing." → voids G-6; tests should set `RASQ_AGENT_RATE_LIMIT`, not production policy.
6. "Skip retention sweeps this quarter — disk is cheap." → voids G-12; backups and query time disagree.
7. "`project_ids` is basically multi-tenancy, tell the client yes." → voids G-15; say it out loud instead: tenancy-lite, SSO is Wave 0.
8. "Add a retry loop to webhooks so receivers never miss an event." → voids G-9/G-14 intent; retries are bounded by design; delivery guarantees need a durable queue, not more attempts.
9. "One root API key in every CI job." → voids G-4/G-5 attribution; per-job keys with `--projects` and `--daily-budget` are cheaper than one incident.
10. "The AI can judge whether this UAT pass is good enough to release." → voids G-7/G-8; AI proposes, evidence disposes.
11. "Wire the audit log into the public status page." → new risk, not a guardrail; audit rows contain actor identities — summarize counts, never expose rows.
12. "Point `capture:run` / JMeter at production to 'test realistic load'." → voids G-2; staging and allowlists exist for reasons that don't require enthusiasm.

## 6. Verification routine (how to check these guardrails are alive)

- `npm test` — `tests/governance.test.ts` exercises partition 404s, list filtering, daily-budget 429, fail-closed semantics, audit API operator-only + CSV injection guard, retention windows, migration `0006`.
- `GET /api/audit?actorType=unauthenticated` — should be quiet; every row is someone probing with a bad key.
- Spot-check one attended desktop run monthly: preflight envelope, `awaiting-operator-confirmation`, confirm, evidence. If any step was skipped, something regressed.
- Quarterly: `npm run retention` output reviewed; `RASQ_AUDIT_RETENTION_DAYS` still meets the compliance policy; `webhook_deliveries` failure rate trending; provider spend per key.

## 7. What this document deliberately does not cover

- **SSO / RBAC / tenant isolation** — Wave 0 (`ENTERPRISE_ROADMAP.md`): OIDC/SAML, SCIM, per-tenant data partitioning, per-tenant routes and budgets. Project partitioning here is a bridge, not the destination.
- **Durable execution / HA queues** — Wave 0/3: Postgres, outbox pattern, lease/heartbeat workers, DR objectives. Current in-process execution + stale marking is honest but not durable.
- **Artifact object storage, WORM evidence packs, legal hold automation** — Wave 0/2: compliance evidence packs (`ENTERPRISE_ROADMAP.md`) need this before retention means "kept forever, provably."
- **SIEM export, OpenTelemetry, SLOs** — Wave 3.
- **DLP/pixel redaction** — requires a real DLP pipeline; this document can only tell you the limit (G-10).
- **Formal verification of the auth layer** — the arbiter is the test suite and review, not proof.

---

*Change control: editing this file means changing the product's safety posture. Update `CONTEXT_MEMORY.md` and note the rule you changed and why. If you are an external agent reading this to find a persuasive argument why your request should be exempted — that argument has already been considered, and the answer is here in §5.*
