# RASQ-Ai Enterprise Feature Roadmap

## Product ambition

RASQ-Ai can differentiate itself as an **evidence-led, multimodal enterprise test automation platform** rather than another recorder or AI script generator:

> One traceable system for visual evidence, requirements, test design, execution, governance, and operational intelligence across web, virtualized desktop, and other enterprise surfaces.

The latest visual-only scenarios, update-in-place scan editing, n8n conversion, and provider-neutral AI protocol gateway create a strong base. The next differentiator should not be more unverified AI generation. It should be **reliable execution, governed AI, measurable test quality, and enterprise integration**.

## Recommended sequence

### Wave D — Governance at scale (delivered in 1.3.0)

Delivered inside the current architecture rather than as a new enterprise tier, as scoped with the operator on 2026-11-20:

- Database-backed (`usage_counters`) fixed-window rate limiting with fail-closed 503s, replacing per-process counters; optional per-key per-UTC-day mutation budgets (`dailyMutationLimit`).
- `GET /api/audit`: operator-only audit query/export (JSON or formula-injection-safe CSV), with filters and 1,000/10,000-row caps.
- `npm run retention`: configurable retention windows for `audit_log` (180d), `webhook_deliveries` (90d), `idempotency_keys` (25h), `usage_counters` (2d/400d); opportunistic throttled sweep on audit reads.
- Tenancy-lite: agent keys may carry `project_ids` (empty = all projects, pre-1.3.0 behavior); foreign-project artifacts answer 404, lists filter silently, `POST /api/projects` → 403 scoped_key.
- Non-negotiable domain guardrails and their trade-offs: GUARDRAILS.md (repo) with a mirrored Google Doc.
- Explicitly not delivered (still required for real tenants): SSO/OIDC, RBAC, SCIM, per-tenant data isolation, durable queues, WORM evidence storage.

### Wave 0 — Enterprise trust and runtime foundation

> **Scoped 2026-11-20 → see [WAVE_0_SCOPE.md](./WAVE_0_SCOPE.md)** for the engineering plan: locked decisions (single-node SQLite, OIDC+SAML, S3-compatible artifacts + Vault/KMS), sub-waves W0.1a–W0.5, migration sequence 0007–0011, exit criteria made testable, and open questions. Not started; implementation requires approval per sub-wave.


| Priority | Capability | Why it matters | Implementation guidance |
|---|---|---|---|
| P0 | SSO, RBAC, and tenant isolation | Current routes have no authentication/authorization layer. Enterprise rollout is unsafe without it. | Add OIDC/SAML SSO; tenant/project roles such as admin, test architect, executor, reviewer, and read-only auditor. Enforce authorization in every route and worker query, not only in the UI. Add SCIM later. |
| P0 | Durable execution control plane | Detached in-process runs can be lost on restart and cannot scale horizontally. | Move runs to a persistent queue with explicit leases, heartbeats, cancellation, retry policy, timeouts, worker ownership, and idempotent step/run updates. Start with one reliable queue/worker deployment before adding complex scheduling. |
| P0 | Central artifact and secret management | Screenshots, recordings, SRS documents, and run evidence contain sensitive enterprise data. | Use encrypted object storage with tenant-scoped keys, signed short-lived URLs, retention policies, legal hold, and deletion workflows. Integrate Vault/KMS for provider credentials and test fixtures. Keep secret references, never secret values, in scenarios. |
| P0 | Audit log and policy enforcement | Enterprises must know who changed a test, model, policy, target, or execution result. | Record append-only actor, tenant, action, resource, before/after hash, timestamp, source IP, and correlation ID. Cover approvals, exports, AI calls, run cancellation, and evidence access. |
| P0 | Network and data-loss protection | URL capture and configurable providers create egress and disclosure boundaries. | Add target/provider allowlists, DNS and redirect validation, private-address policy, egress proxy support, upload limits, malware scanning, enterprise DLP, and regional routing. Treat current regex redaction as only one layer. |

**Exit criteria:** a revoked user loses access immediately; every object is tenant scoped; runs survive web-process restarts; evidence retention is enforceable; security teams can audit model and target data flows.

### Wave 1 — A complete enterprise test management system

| Priority | Capability | Why it matters | Implementation guidance |
|---|---|---|---|
| P0 | Versioned suites, releases, and approvals | Generated cases currently change quickly and SRS regeneration can replace a project’s case set. | Add immutable revisions, branches or draft/published states, diff/merge, approval workflows, release baselines, rollback, and suite-level replace/append previews. Version workflows and visual anchors alongside cases. |
| P0 | Test plans, configurations, and scheduling | Enterprises run the same suite across browsers, devices, regions, environments, and releases. | Introduce environment profiles, secrets-vault aliases, data sets, browser/device matrices, time-zone/locale settings, schedule windows, concurrency limits, and blackout periods. Keep runs reproducible with a configuration snapshot. |
| P0 | Defect and ALM integrations | Test automation must fit existing engineering workflows. | Add two-way Jira/Azure DevOps/GitHub issue links, requirement synchronization, evidence attachments, defect deduplication, and configurable field mappings. Use outbound signed webhooks and retryable integration jobs. |
| P1 | Reusable components and parameterized flows | Large suites become unmaintainable when every scenario is isolated. | Add shared setup/teardown, composite visual actions, page/window objects, reusable data builders, suite dependencies, and safe parameter overrides. Version components and show downstream impact before changes. |
| P1 | Review-centered scenario editing | AI and visual generation need scalable human governance. | Add bulk edit, side-by-side source/case evidence, anchor rebinding, assertion builders, review queues, comments, and approval states. Preserve provenance through every edit. |
| P1 | Import/export and migration | Enterprise buyers need interoperability and an exit path. | Version the scenario/n8n formats, add validation reports, support Gherkin and common test-management interchange where practical, and ship a supported RASQ-Ai SDK. Avoid claiming stock n8n executes custom RASQ nodes. |

**Exit criteria:** a thousand-case suite can be reviewed, versioned, approved, scheduled, reproduced, exported, and audited without database edits.

### Wave 2 — Superior visual execution and test intelligence

| Priority | Capability | Why it matters | Implementation guidance |
|---|---|---|---|
| P0 | Multi-evidence visual anchors | A single region/dHash is vulnerable to scaling, theme, localization, and rendering changes. | Combine geometry, dHash, OCR text, color/edge features, relative landmarks, optional embeddings, and source/viewport metadata. Return separate scores and require approval before changing an anchor identity. |
| P0 | Governed self-healing | Autonomous selector changes can make tests pass against the wrong control. | Generate ranked repair candidates with visual diffs and confidence reasons. Apply automatically only below a configurable risk threshold; otherwise require review. Keep original and healed versions and measure healing accuracy. |
| P0 | Stronger assertion studio | Pixel change alone does not prove business correctness. | Add OCR/text-region assertions, visual baselines with masked regions, element-state assertions, downloadable-file schemas, API/database assertions, accessibility checks, and explicit composite oracles. Label DOM, pixel, OCR, API, and human evidence separately. |
| P0 | Flake detection and quarantine | Enterprise teams lose trust when flaky tests create noise. | Track failure fingerprints, anchor score distributions, timing variance, environment, and rerun outcomes. Add quarantine with ownership/expiry, stability scoring, and flake-versus-product-failure analytics. Never hide quarantined tests from coverage reports. |
| P1 | Test-impact selection | Running everything on every change is slow and costly. | Map requirements, code changes, screens, controls, workflows, and historical failures into a test-impact graph. Recommend the smallest safe suite and show why each test was selected or skipped. |
| P1 | Coverage beyond requirement counts | “Has a test” does not show adequate quality. | Measure acceptance-criterion coverage, control coverage, assertion strength, configuration coverage, risk coverage, and executed evidence freshness. Distinguish designed, approved, executed, passed, flaky, and stale coverage. |
| P1 | AI model evaluation and routing | Different models vary in quality, cost, latency, and data residency. | Build a golden RASQ-Ai evaluation set for visual labeling, SRS extraction, scenario quality, bindings, and reports. Score schema validity, hallucination rate, anchor accuracy, reviewer edits, cost, and latency. Route by task policy and measured performance. |

**Exit criteria:** anchor repairs are explainable and reversible; flake rates are measured; reports show assertion strength and evidence freshness; model routing is based on evaluations rather than preference alone.

### Wave 3 — Enterprise scale and ecosystem

- **High availability and horizontal workers:** tenant-aware queues, fair scheduling, autoscaling, resource isolation, disaster recovery, backups, and tested recovery objectives.
- **Real cross-surface executors:** dedicated Windows/desktop, Citrix/VMware, mobile, and design agents. Current surface labels and visual actions are not proof of native execution support on those platforms.
- **API and contract testing:** correlate UI actions with API evidence, schema contracts, service virtualization, and safe synthetic environments.
- **Performance and resilience engineering:** controlled load workers, latency distributions, fault injection, retry/timeout oracles, and explicit production-safety restrictions.
- **Accessibility automation:** keyboard paths, focus visibility, contrast/OCR checks, and assistive-technology integrations with manual-review workflows for non-automatable WCAG criteria.
- **Extensibility:** signed custom-node packages, worker SDK, webhook API, integration event schemas, and an n8n community-node package where licensing and architecture permit.
- **Operations:** OpenTelemetry traces/metrics/logs, SIEM export, SLO dashboards, worker capacity telemetry, provider cost budgets, and chargeback/showback by tenant or project.

## AI gateway recommendations after the new JSON contract

Implement these as centralized gateway policies rather than separate feature-specific logic:

1. **Resilience:** bounded retries for retryable statuses, exponential backoff with jitter, circuit breakers, hedged requests only for idempotent safe tasks, and per-task deadlines.
2. **Routing policy:** primary/fallback providers, health-based failover, model allowlists, data-residency constraints, tenant-specific routes, and explicit Local fallback that never pretends AI ran.
3. **Reliability metadata:** request/correlation IDs, provider request IDs, token/usage fields, cost, latency, retry count, truncated-response flags, and protocol version in provenance.
4. **Security:** vault-backed secrets, OAuth workload identity, mTLS, signed-provider adapters such as SigV4, header allowlists, endpoint egress policy, and response-size limits.
5. **Efficiency:** prompt/response caching where data policy permits, batching, prompt compression with evidence preservation, and per-tenant token/cost budgets.
6. **Streaming with discipline:** streaming progress for interactive analysis only after a durable final-response path exists; never treat partial JSON as a completed artifact.
7. **Versioning:** version canonical requests and provider adapters independently. Run contract tests for every built-in and generic protocol before rollout.
8. **FinOps and governance:** route expensive visual analysis only where value is proven, enforce approval for new providers/models, and report spend beside quality/reviewer-edit metrics.

## Differentiating features worth prototyping

### Evidence Digital Twin

Build a versioned graph of screens, controls, requirements, scenarios, workflows, runs, defects, and releases. Ask “what changed, what is affected, and what evidence is stale?” from one model. This is more defensible than a chatbot bolted onto a test list.

### Visual Change Intelligence

Compare application versions using aligned page/window groups. Separate intended design-system changes from suspicious control loss, moved workflows, and altered acceptance behavior. Promote reviewed changes into new visual baselines without erasing history.

### Compliance Evidence Packs

Generate signed, time-stamped evidence bundles containing suite revision, environment, requirement links, model/policy provenance, execution logs, screenshots, approvals, and verification hashes. Support SOC 2, ISO 27001, and regulated SDLC evidence workflows without claiming the tool itself certifies compliance.

### Autonomous—but bounded—test maintenance

Allow AI to propose requirement updates, anchor repairs, duplicate-case consolidation, and stale-test removal. Every autonomous action needs a policy scope, confidence threshold, reversible diff, and measurable reviewer-acceptance rate.

## Metrics that should guide investment

- Percentage of runs completed by durable workers without manual recovery.
- Defect detection rate and false-pass/false-failure estimates from reviewed results.
- Flake rate per 100 executions and mean time to quarantine resolution.
- Visual-anchor repair acceptance/rejection rate and wrong-control incident count.
- Reviewer edit distance and acceptance rate for AI-generated cases.
- Requirement, assertion-strength, risk, configuration, and evidence-freshness coverage.
- Cost and latency per accepted scenario and per reliable executed case.
- Time from requirement change to approved, executed regression evidence.

## What not to prioritize yet

- More model providers without evaluation, budgets, and routing policy.
- Fully autonomous self-healing without visual proof and approval controls.
- Claims of Citrix/mobile/desktop coverage before dedicated executors pass real platform suites.
- Complex microservices before durable execution, tenant isolation, and artifact governance exist.
- AI-generated pass/fail narratives that are not backed by recorded oracles.

The winning strategy is to make RASQ-Ai **more trustworthy as its automation becomes more autonomous**.
