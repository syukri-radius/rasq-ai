# Implementation Prompt — ADR-0001: Midscene.js Vision Agent (Beta) in Scan

**Prompt version:** v1.0.0
**Date:** 2026-11-25 (UTC)
**Target:** coding-agent task block for an agentic session on `syukri-radius/rasq-ai` (arena.ai Agent Mode)
**Spec:** [docs/adr/ADR-0001-midscene-vision-agent-scan.md](../../adr/ADR-0001-midscene-vision-agent-scan.md) — status "Proposed"; the "Recommended Decision" is **Option C**: introduce Midscene.js as an optional, feature-flagged Vision Agent adapter for the Scan page, scoped initially to **live web targets** and **operator-initiated NL E2E sessions**.

Paste the `Task:` block below into [MASTER_PROMPT.md](../../../MASTER_PROMPT.md) as `{{TASK}}`. It is self-contained: any agent that reads MASTER_PROMPT.md can start without further context.

---

## Task:

```text
Implement the Recommended Decision from docs/adr/ADR-0001-midscene-vision-agent-scan.md (Option C) — Phase 1: "Scan Vision Agent Beta":

Add a feature-flagged "Vision Agent (Beta)" mode on the Scan page (src/app/(app)/scan/page.tsx), backed by a server-managed Midscene.js Playwright adapter (Phase 1, ADR §3.3):

1. Capability boundary: new internal module `src/lib/visionAgent/` with the interface from ADR §1 (LiveScanSession, proposeControls, runNaturalLanguageStep, runNaturalLanguageScenario, exportArtifacts) and two adapters: `MidsceneVisionAgentAdapter` (new, optional) + the existing perception path.
2. Scan page mode: "Vision Agent (Beta)" alongside record/upload/capture; NL command box, assertion box, step timeline, screenshot/evidence panel; artifact actions "Add as control", "Save as screen", "Create test draft". User must confirm before artifacts are saved.
3. Artifacts: save controls through the existing /api/screens path; provenance changes only (ADR §4): allow `controls.source` value `vision_agent`, extended `aiModel`/evidence; never store Midscene types in DB or domain contracts.
4. Governance (ADR §5): all Midscene navigation through the SSRF gate (`assertSafeUrl`, src/lib/runner.ts); feature flag `RASQ_VISION_AGENT` (ADR §5.7) gates the mode; provider secrets reach the browser never — derive Midscene config server-side from the RASQ route.
```

## Current behavior:

```text
- Scan page (src/app/(app)/scan/page.tsx) has tabs "record" | "upload" | "capture"; client perception (src/lib/perception.ts) proposes geometric candidates with dHash region hashes; /api/ai/scan (src/app/api/ai/scan/route.ts) enriches via RASQ visual_scan routing; controls saved via /api/screens into the `controls` table (src/db/schema.ts): type, label, x/y/w/h, confidence, evidence, locatorHash, perceptionLabel, aiModel, source.
- No natural-language agent path; TASKS (src/lib/types.ts) = visual_scan, document_analysis, test_scenarios, workflow_creation, report_generation only.
```

## Desired behavior (per ADR):

```text
Feature-flagged "Vision Agent (Beta)" mode on /scan: live URL input (reusing target validation), NL command/assertion boxes, step timeline, artifacts: proposeControls (natural-language element discovery) → user confirmation → save as RASQ controls with `vision_agent` provenance; optional NL scenario execution later (Phases 2–3 out of scope here).
```

## Files already identified (ADR-authoritative):

```text
- src/lib/visionAgent/ (new)
- src/app/(app)/scan/page.tsx (add mode/tab)
- src/lib/types.ts (ADR §4: possibly add a `vision_agent` task — decide with tests)
- src/db/schema.ts + drizzle/ (only if additive provenance fields are needed; prefer none)
- src/lib/netGuard.ts / src/lib/runner.ts (reuse assertSafeUrl — read, do not change)
- docs/adr/ADR-0001-midscene-vision-agent-scan.md
```

## Must remain compatible with:

```text
- MASTER_PROMPT.md invariants: never invent identifiers; preserve route shapes/DB identifiers; evidence honesty (never present agent output as observation) — MASTER_PROMPT.md §2.
- GUARDRAILS.md G-2 (SSRF allowlists), G-5 (idempotency), G-7 (manualReview never passed), G-9 (operator kill switch), G-10 (redaction speed bump).
- Existing Scan modes unchanged when the feature flag is off; existing `controls` values/fields unchanged; `npm test` passes.
- ADR §3: no Midscene code path may navigate to non-SSRF-approved targets; saved controls pass existing normalization and appear in Tests/Workflows/Desktop flows with correct provenance; reports summarize persisted RASQ facts only (G-8).
```

## Validation expected:

```text
- npm run typecheck → clean
- npm run lint → 0 errors
- npm test → pass
- npm run build → succeeds (13 static pages, all API routes compiled)
- ADR §7 "Validation / Acceptance Criteria" (docs/adr/ADR-0001-midscene-vision-agent-scan.md): existing scan modes unchanged with flag off; no Midscene navigation to non-approved targets; vision-agent controls pass normalization and appear downstream with correct provenance; agent runs create run/step evidence + screenshots; reports summarize persisted facts; secrets never reach the browser (Midscene config server-side); disabling via flag needs no migration rollback.
- Provenance check: new artifact provenance values are distinct from `perception`/`ai` (e.g. `vision_agent`); existing provenance strings unchanged.
```

## Out of scope:

```text
- Phases 2–3 of the ADR: NL E2E scenario composer/run pane, promotion to Workflows/Runs.
- Vision Agent against non-live targets (upload/recording frames).
- Replacing perception, runner, or the control schema semantics.
- Midscene YAML as a primary format, Android/iOS/desktop scope.
```
