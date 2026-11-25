# ADR-0001: Midscene.js for Vision-Based GUI Agent and Natural-Language E2E Testing in Scan

- **Status:** Proposed (analysis)
- **Date:** 2026-11-25
- **Owners:** RASQ-Ai architecture / scan workflow
- **Related areas:** `src/app/(app)/scan/page.tsx`, `src/app/api/ai/scan/route.ts`, `src/lib/perception.ts`, `src/lib/runner.ts`, `src/lib/ai.ts`, `src/lib/types.ts`, `src/db/schema.ts`, `docs/CONTEXT_MEMORY.md`

## Context

RASQ-Ai's Scan flow (`/scan`) is the entry point for visual evidence. Today it supports:

1. **Evidence acquisition** — full-screen recording, video/image upload, and server-side Playwright URL capture (`/api/capture`, `src/lib/runner.ts:captureScreenshot`).
2. **Client-side perception** — `src/lib/perception.ts` converts frames into candidate controls using luminance, Sobel edges, density-grid connected components, geometric classification, and `rq1` dHash region hashes. Frames are grouped into page/window groups by luminance signature.
3. **Optional AI enrichment** — `/api/ai/scan` sends the image plus perception candidates to the operator-selected multimodal model through RASQ's task routing (`visual_scan`). The route enforces schema (`AiScanSchema`), preserves candidate coordinates, bounds missed controls, redacts/wraps untrusted data through the shared AI layer, and records provenance (`provider:model`).
4. **Persistent visual anchors** — saved screens/controls in `screens`/`controls` store bbox, `locatorHash` (dHash), perception label, AI model, source, confidence, and evidence. These anchors are consumed downstream by SRS-traced test generation, visual-case generation, workflow compilation, Playwright execution, and desktop compilation.
5. **Execution today** — Playwright runner (`src/lib/runner.ts`) executes bound visual anchors with dHash similarity checks, fixed action/assert semantics, and evidence capture. It is deterministic at the action layer, not natural-language driven.

The requested capability is:

> Implement Midscene.js to provide better vision-based GUI Agent and a natural-language E2E testing framework in `/scan` page.

[Midscene.js](https://github.com/web-infra-dev/midscene) provides vision-based GUI automation: natural-language actions/assertions (`aiAct`, `aiAssert`, `aiTap`, `aiInput`, `aiQuery`, `aiWaitFor`, etc.), Playwright/Puppeteer/web/Android/iOS integrations, YAML-driven test flows (`@midscene/test`), execution reports/replay, and caching. It uses screenshot understanding rather than DOM selectors as its primary localization strategy.

## Problem Statement

We want two improvements in the Scan experience:

1. **Better vision-based GUI agent** — improve how users discover, inspect, and interact with UI controls during scan, especially for live web targets where current geometry-only perception and one-shot enrichment are limited.
2. **Natural-language E2E testing framework** — allow users to author and run natural-language tests from the scan context, with readable steps/assertions and actionable evidence.

The design must preserve RASQ-Ai's trust model: visual anchors are evidence, AI output is untrusted until validated, execution evidence is distinct from generation, provider credentials are env-only and allowlisted, targets pass SSRF guards, and downstream artifacts remain traceable.

## Decision Drivers

| Driver | Why it matters |
|---|---|
| **Trust & provenance** | RASQ stores control provenance (`perception`/`ai`, model, evidence, confidence) and distinguishes generation from execution. Midscene must not erase this. |
| **Governance & security** | RASQ routes AI through allowlisted env-key providers, baseUrl guards, redaction, untrusted-data wrapping, policies, audit, and scoped agent auth. Midscene has its own model config path; bypassing RASQ governance is unacceptable. |
| **Architectural fit** | RASQ domain objects are Screen/Control/Requirement/TestCase/Workflow/Run. Midscene is an automation/runtime capability, not the domain model. |
| **Scan input diversity** | Scan handles live capture, uploads, recordings, and saved scans. Midscene is strongest on live interactive pages; it does not replace offline frame perception. |
| **Downstream compatibility** | Existing controls feed test generation, workflow compiler, Playwright runner, desktop compiler, and reports. Control schema and anchor semantics cannot break silently. |
| **User value in Scan** | The improvement should be visible where users already work: discover controls, refine them, and try natural-language flows against the target. |
| **Operational cost/risk** | New dependency, model cost, runtime nondeterminism, browser lifecycle, and report/artifact storage need bounds. |
| **Reversibility** | Prefer an adapter/feature-flag path over irreversible replacement of perception or runner. |

## Current-State Constraints (Observed)

- **Perception is client-side and deterministic-ish**: useful for recordings/uploads without server browser automation beyond capture. It produces explainable geometry evidence but has low semantic confidence and heuristic type labels.
- **AI scan is one-shot enrichment**, not an interactive agent loop. It can label/miss controls but cannot act, wait, verify transitions, or run multi-step flows.
- **Playwright runner is anchor-execution oriented**: it validates dHash similarity before action and emits step evidence. It does not accept natural-language goals.
- **Provider routing is task-based** (`visual_scan`, `document_analysis`, `test_scenarios`, `workflow_creation`, `report_generation`). There is no task for interactive GUI-agent planning/execution.
- **Targets are SSRF-gated** by `assertSafeUrl` in `src/lib/runner.ts`; any new browser navigation must reuse it.
- **Desktop/Web execution contracts are explicit** (`rasq-desktop.v1`, workflow node types, review-only control rules). A natural-language web agent cannot silently become desktop authority.
- **Reports and audit depend on persisted facts**. Midscene reports are useful, but RASQ report generation must remain grounded in RASQ-run records.

## Options Considered

### Option A — Replace Scan Perception/Execution with Midscene

Use Midscene as the primary engine: Midscene agent discovers elements, executes NL steps, and its outputs become the scan/test artifacts.

**Pros**
- Fastest path to Midscene-native UX.
- Leverages Midscene planning, reports, and Playwright integration directly.
- Less custom agent code.

**Cons**
- Breaks RASQ's domain boundary: Midscene becomes system of record for UI understanding.
- Loses/dilutes deterministic perception for offline recordings/uploads.
- Risks bypassing RASQ provider governance, policy injection, redaction, and audit conventions if Midscene model config is used directly.
- Midscene element localization is not the same as RASQ's persisted dHash visual-anchor contract; downstream runner/compiler compatibility becomes fragile.
- Harder to preserve review-only control rules, coordinate-preserving enrichment, and traceability semantics.
- High lock-in and migration cost.

**Verdict:** Reject.

### Option B — Native RASQ Vision Agent (No Midscene Dependency)

Build an in-house natural-language GUI agent and E2E framework on top of existing Playwright, provider routing, and perception/control schemas.

**Pros**
- Full control over governance, data model, and evidence.
- No new heavy dependency or upstream runtime coupling.
- Can be tailored exactly to RASQ control anchors and report model.

**Cons**
- High implementation cost: planning loop, element grounding, action reliability, retries, replay/report UX, caching, flaky-test ergonomics.
- Slower time to value.
- Duplicates mature capabilities Midscene already provides.

**Verdict:** Not now; keep as fallback if adapter pilot fails.

### Option C — Midscene as Optional Adapter Behind RASQ Boundaries (Recommended)

Adopt Midscene incrementally as an **infrastructure adapter** for live-web vision-agent and NL E2E capabilities, while keeping RASQ's domain model, persistence, governance, and existing scan modes intact.

**Pros**
- Delivers requested capability with lower product risk.
- Preserves existing scan behavior for recordings/uploads/saved scans.
- Keeps RASQ control schema and downstream contracts authoritative.
- Allows evaluation of quality/cost before deeper adoption.
- Isolates Midscene-specific config/runtime behind a boundary.

**Cons**
- Requires adapter/mapping work and dual-path maintenance during pilot.
- Some Midscene features (YAML runner, full report format, cache semantics) may not map 1:1 to RASQ initially.
- Model governance integration needs careful design because Midscene expects its own model env/config conventions.

**Verdict:** Recommend.

### Option D — Use Midscene Only for Test Execution, Not Scan

Integrate Midscene under Workflows/Runs as NL executor, leave Scan unchanged.

**Pros**
- Clear execution-only scope.
- Minimal scan-page churn.

**Cons**
- Misses "better vision-based GUI Agent in /scan page" part of request.
- Users cannot interactively discover/refine controls with NL agent during scan.
- Loses opportunity to convert scan-time exploration into reusable anchors/tests.

**Verdict:** Reject as sole approach; execution may be a later phase.

## Recommended Decision

Adopt **Option C**: introduce Midscene.js as an **optional, feature-flagged Vision Agent adapter** for the Scan page, scoped initially to **live web targets** and **operator-initiated NL E2E sessions**.

Midscene will **not** replace the existing perception pipeline, saved control schema, Playwright visual-anchor runner, desktop compiler, or RASQ provider governance. It will be integrated as a bounded capability that can:

1. Inspect a live target through a vision-agent session.
2. Propose/discover controls and semantic labels.
3. Execute natural-language E2E steps/assertions.
4. Export results into RASQ-native artifacts (screens/controls, test drafts, workflow drafts, run evidence) with explicit provenance.

## Proposed Architecture

### 1. Capability Boundary

Add a new internal capability boundary, e.g. `src/lib/visionAgent/` (name illustrative):

```text
Scan UI / API
    │
    ▼
VisionAgentService (RASQ interface)
    ├── LiveScanSession
    ├── proposeControls()
    ├── runNaturalLanguageStep()
    ├── runNaturalLanguageScenario()
    └── exportArtifacts()
    │
    ├── MidsceneVisionAgentAdapter  (new, optional)
    └── ExistingPerceptionAdapter   (current client perception + /api/ai/scan)
```

**Rule:** Midscene types do not leak into DB schema or downstream domain contracts. Adapters map to RASQ DTOs.

### 2. Scan Page UX Mode

Add a Scan mode/tab or submode, tentatively **"Vision Agent (Beta)"**, alongside Record / Upload / Capture:

- **Input:** live URL (reusing existing capture/target validation rules) and optionally an existing saved screen as context.
- **Agent panel:** NL command box (`aiAct`-like), assertion box (`aiAssert`), extract/query (`aiQuery`), wait (`aiWaitFor`), and step timeline.
- **Live viewport:** screenshot/stream preview from the agent session; highlight located elements when Midscene returns coordinates/element info.
- **Artifact actions:** "Add as control", "Save as screen snapshot", "Create test draft", "Export NL steps".
- **Provenance badge:** `midscene:<model>` or `vision-agent:<adapter>:<model>` distinct from `perception` and existing `visual_scan` enrichment.

Existing Record/Upload/Capture behavior remains default and unchanged.

### 3. Integration Shape

#### Phase 1 — Live Vision Discovery (Scan)

- Start a server-managed Midscene Playwright agent session against an SSRF-approved URL.
- Use Midscene for:
  - natural-language element discovery ("find the login button", "list all form fields")
  - semantic labeling and assertion checks
  - optional control proposal extraction
- Map proposals into candidate controls compatible with existing scan table/editor.
- User confirms before saving. Saved controls get `source="ai"` or a more specific provenance field value; `evidence` includes Midscene grounding summary.

#### Phase 2 — NL E2E Authoring/Run in Scan

- Add a Scan-side NL scenario editor/run pane.
- Store NL steps in a RASQ-owned format, e.g. `naturalLanguageSteps[]` with action/assert/wait/query kinds and expected outcomes.
- Execute via Midscene adapter; capture per-step screenshots, timings, model output summary, and pass/fail/assertion evidence.
- Persist as RASQ run records with `runner="midscene-playwright"` (or similar) and evidence JSON; do not make Midscene HTML report the source of truth.

#### Phase 3 — Controlled Promotion to Workflows

- Allow converting confirmed NL scenarios into:
  - RASQ test cases (`test_scenarios`-compatible), and/or
  - workflow drafts where steps can be either bound visual-anchor actions or explicit NL-agent steps.
- NL-agent workflow steps must be clearly labeled as nondeterministic/model-dependent and excluded from desktop compilation unless separately designed.

### 4. Data / Contract Changes (Proposed)

Keep existing tables compatible. Prefer additive changes:

| Area | Proposed change | Notes |
|---|---|---|
| `controls.source` | allow `vision_agent` or keep `ai` + detailed `perceptionLabel`/evidence | Avoid enum breakage; preserve existing values. |
| `controls.aiModel` / provenance | store adapter+model, e.g. `midscene:provider:model` | Keep existing provenance display logic tolerant. |
| `screens.source` | allow `vision_agent` snapshot | Distinguish from recording/screenshot/capture. |
| `modelRoutes.task` | add `vision_agent` task or split `vision_scan` / `vision_e2e` | Needed if routed through RASQ providers. |
| `runs`/`runSteps` evidence | include `runner`, `nlStep`, `agentPlan`, `locateResult`, `reportPath?` | RASQ DB remains authoritative. |
| New table (optional) | `vision_agent_sessions` | Session lifecycle, target URL, adapter, model, status, audit, expiry. |

No change to `rasq-desktop.v1` contract in initial phases.

### 5. Governance / Security Design

This is the main architectural constraint.

1. **Target safety** — all Midscene navigations go through `assertSafeUrl`/existing target policy. No arbitrary local/private targets beyond current policy.
2. **Provider governance** — preferred: configure Midscene through RASQ-managed model settings, not ad-hoc user env edits. If Midscene requires env-style config, generate it in-process from the selected RASQ route and never expose secrets to client. Document any unsupported provider mappings.
3. **Audit** — record session start/stop, target, model route, actor, and NL instructions metadata in audit log (redacted as needed).
4. **Untrusted data** — page content, screenshots, and extracted text remain untrusted input; do not feed them back as system instructions.
5. **Data minimization** — screenshots sent to external models follow existing image-data cautions; warn users when route is external. Consider redaction/blur hooks for sensitive regions before send.
6. **Resource limits** — max session duration, max steps, max concurrent sessions, max screenshots/artifact size, timeout/cancellation, and cleanup on failure.
7. **Feature flag / kill switch** — gate by setting/env (`RASQ_VISION_AGENT=midscene` or settings toggle) and by selected model route availability.

### 6. Observability & Evidence

Midscene reports are useful for debugging, but RASQ should store:

- RASQ run/step rows with status, message, timestamps, evidence JSON.
- Step screenshots/artifacts under `data/` with retention policy.
- Optional link to Midscene HTML report artifact for drill-down.
- Model provenance and adapter version.

Reports generated from `/reports` must only summarize persisted RASQ facts; they may link to Midscene report artifacts but must not treat them as authoritative if absent.

## Consequences

### Positive

- Gives Scan a real interactive vision agent, not only static candidate detection.
- Enables natural-language E2E authoring where users already capture/review UI.
- Preserves RASQ's saved-control and evidence model.
- Limits blast radius by scoping to live web targets and feature-flagged adapter.

### Negative / Costs

- Adds dependency and runtime complexity (`@midscene/web`, possibly `@midscene/core`; Playwright already present).
- Midscene model configuration may not map cleanly to RASQ's provider abstraction.
- NL E2E runs are inherently less deterministic than bound visual-anchor actions.
- Duplicate-path UX risk: users may confuse "perception controls", "AI-enriched controls", and "agent-discovered controls".
- Session management introduces server resource/lifecycle concerns.

### Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Midscene bypasses RASQ model governance | Credential/policy/audit gap | Adapter-owned config translation; block direct client config; document supported providers; fail closed. |
| NL agent produces plausible but wrong actions | False confidence, bad tests | Require confirmation before saving controls/tests; label runs as agent-driven; keep evidence/screenshots. |
| Session/browser leaks | Cost, instability | Hard timeouts, max sessions, cleanup on disconnect, process supervision. |
| Control schema drift | Breaks downstream tests/workflows/desktop compiler | Map into existing Control DTO; additive provenance only; compatibility tests. |
| Duplicate/competing reports | Confusing evidence trail | RASQ run records authoritative; Midscene report is attachment/debug artifact. |
| Target abuse/SSRF | Security issue | Reuse `assertSafeUrl`; same-origin/target policy as capture; audit targets. |
| External model data exposure | Privacy/compliance | Explicit warning, route-aware consent, redaction hooks, allow Local/internal providers where possible. |

## Alternatives Not Recommended Now

- **Midscene YAML as primary test format** — useful later, but RASQ already has n8n-shaped workflows, test-case DB records, and report contracts. Import/export can be added after the adapter stabilizes.
- **Midscene Android/iOS/desktop in same phase** — out of Scan web scope; RASQ desktop is a separate attended RobotJS architecture.
- **Replacing dHash anchors with Midscene-only references** — would weaken deterministic replay/verification in existing runner.

## Implementation Plan (Phased)

### Phase 0 — Design Spike (1-2 sprints)

- Prototype Midscene Playwright agent behind a server-side adapter.
- Validate model-config mapping from RASQ provider routes.
- Measure latency/cost/quality on representative Scan targets (`/demo-target`, simple forms, canvas-heavy page).
- Decide provenance fields and session lifecycle.

**Exit criteria:** can run `aiAct`/`aiAssert` on a safe target with RASQ-selected model config and capture step evidence.

### Phase 1 — Scan Vision Agent Beta

- Add feature-flagged "Vision Agent" mode in `/scan`.
- Live URL session, NL command box, step timeline, screenshot/evidence panel.
- "Propose controls" and "Save selected controls" mapped into existing screen/control editor.
- Audit + limits + cleanup.

**Exit criteria:** user can discover controls via NL on live page and save them as normal RASQ controls with provenance.

### Phase 2 — NL E2E in Scan

- Scenario composer: NL steps + assertions + expected outcomes.
- Run via Midscene adapter; persist RASQ run/step evidence.
- Export to test-case draft / workflow draft.
- Add report linkage.

**Exit criteria:** user can author/run an NL E2E scenario from Scan and see pass/fail evidence in RASQ.

### Phase 3 — Workflow Integration

- Optional NL-agent node type or runner mode in Workflows/Runs.
- Clear separation from deterministic visual-anchor steps.
- Conversion/import/export strategy for Midscene YAML if needed.

## Validation / Acceptance Criteria

- Existing Scan modes (record/upload/capture/saved-scan edit) behave unchanged when feature flag is off.
- No Midscene code path can navigate to non-SSRF-approved targets.
- Saved controls created by Vision Agent pass existing normalization and appear in Tests/Workflows/Desktop compile flows with correct provenance.
- Agent runs create RASQ run/step evidence rows and screenshots; report generation can summarize them without reading Midscene-only files.
- Provider secrets never reach browser; Midscene config is derived server-side.
- Feature can be disabled without DB migration rollback beyond ignoring additive fields.

## Open Questions

1. **Model config compatibility:** Can Midscene's model configuration be driven entirely from RASQ's provider/route system, or do we need a constrained "Midscene-supported providers" allowlist?
2. **Session hosting:** Should agent sessions run in-process, worker process, or isolated job runner? In-process is simpler but risks blocking/scaling poorly.
3. **Canonical artifact:** Is the canonical output a saved Screen+Controls, a TestCase draft, a Workflow draft, or all three? Recommend: controls first, then test draft.
4. **Determinism boundary:** Which NL steps can be converted to deterministic RASQ anchor actions, and which must remain agentic?
5. **Midscene report retention:** Store full HTML report, or normalize key data into RASQ evidence and discard bulky artifacts by retention policy?
6. **Licensing/dependency review:** Confirm MIT license compatibility and dependency/security review for `@midscene/*` packages before adding.

## Recommendation Summary

Proceed with a **feature-flagged Midscene adapter pilot in Scan**, limited to live-web vision discovery and NL E2E authoring/execution. Keep RASQ's perception pipeline, control schema, governance, and evidence model authoritative. Treat Midscene as a replaceable infrastructure capability behind a RASQ-owned interface, not as the new domain core.
