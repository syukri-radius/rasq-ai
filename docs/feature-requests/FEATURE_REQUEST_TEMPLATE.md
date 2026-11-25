# Feature Request Template — syukri-radius/rasq-ai

**Template version:** v1.0.0
**Last updated:** 2026-11-25 (UTC)
**Fill rule:** Every field marked **[required]** must be filled. A request missing a **[required]** field or containing an empty one should be returned to the author before an implementing agent starts — that is the ambiguity that causes rollback in prior requests.

> **Why this shape:** a request that carries "current behavior / desired behavior / must remain compatible with / validation expected / out of scope" removes a round-trip between the requester and the implementing agent. The **Implementation prompt (§8)** block at the end is written so an agent can paste it into [`MASTER_PROMPT.md`](../../MASTER_PROMPT.md) as its `{{TASK}}` and start without any clarification.

---

## 1. ID & metadata **[required]**

| Field | Value |
|---|---|
| ID | `FR-<YYYY-MM-DD>-<NNN>` — e.g. `FR-2026-11-25-001` (next number per date, assigned on the GitHub issue) |
| Title | Imperative, ≤ 80 chars: "Add browser-based clock skew detection to performane API" |
| Status | `proposed` → `planning` → `in-progress` → `done` |
| Requested by | Name/team |
| Issue | GitHub issue link (opened with the `enhancement` label) |

---

## 2. Motivation — the "why" **[required]**

One to three sentences. What problem does this solve? What pain exists today?

> Example: "Operators cannot tell whether a Playwright run's screenshots were taken after page-load, so `needs-review` from `manualReview` assertions gets reported as pass/fail without any time anchor."

---

## 3. Goal / Desired Behavior **[required]**

One paragraph describing the intended behavior in terms of user-visible outcomes. Avoid implementation details here; the **Implementation prompt (§8)** carries those.

---

## 4. Acceptance Criteria **[required]**

Define "done" as checkable items. Each item should be verifiable by a test, a run, or an artifact. Use IDs (`AC-1`, `AC-2`, …) — they are referenced from the validation record.

```text
AC-1: <observable outcome, e.g. "GET /api/runs/{id} returns run.startedAt and run.finishedAt ISO timestamps">
AC-2: <another outcome, e.g. "A dry-run of the affected route produces X without dispatching Y">
```

---

## 5. Scope

- **In scope:** bullets — what the change includes.
- **Out of scope:** bullets — explicitly what the change will *not* do. If a tempting adjacent item is out of scope, say so ("no change to existing route shapes").

---

## 6. Constraints & Must-Nots **[required if any]**

Non-negotiable behaviors the implementing agent must respect, e.g.:

- "Must not change existing route shapes or OpenAPI paths."
- "Must not store provider keys in the database."
- "All AI calls must go through `src/lib/ai.ts` `callModel`."

When none exist, write "None."

---

## 7. Evidence & Product Invariants to Respect

Link, with file paths where useful, the docs the implementing agent must read — prefer **section numbers** over prose so the agent gets exact rules:

- `GUARDRAILS.md` — applicable G-numbers (e.g., G-8 evidence outranks narrative; G-7 `manualReview` is never `passed`).
- `MASTER_PROMPT.md` — applicable invariants (e.g., Section 2 items: never invent identifiers; preserve route shapes).
- `CONTEXT_MEMORY.md` — architecture notes if relevant.
- `docs/reviews/` — any prior review findings affecting this area.

---

## 8. Expected Deliverable **[required]**

What "done" looks like as artifacts:

```text
- New route: src/app/api/<new>/route.ts
- Report format: Markdown section "<name>" (per MASTER_PROMPT §4 playbook)
- Report must include: <items, e.g. "evidence statement per fact, provenance string">
- Tests: <new focused tests per MASTER_PROMPT §6 / AGENT_GUIDE safety rules>
```

---

## 9. Validation Expected **[required]**

What the implementing agent must run, and the outcomes expected:

```text
- npm run typecheck            → clean
- npm run lint                 → 0 errors
- npm test                     → pass
- npm run build                → succeeds (13 static pages, all API routes compiled)
- <specific check for the feature, e.g. manual smoke on /demo-target>
```

---

## 10. Implementation Prompt (ready to paste into `MASTER_PROMPT.md`) **[required]**

Fill in the four `{{…}}` slots so the block works verbatim inside `MASTER_PROMPT.md`'s `{{TASK}}` section (§7). The schema mirrors MASTER_PROMPT §7: **Task / Current behavior / Desired behavior / Files already identified / Must remain compatible with / Validation expected / Out of scope**.

```text
Task:
  <one-line summary of the feature>

Current behavior:
  <what exists today, with file/area refs if known — "none; feature absent">

Desired behavior:
  <the filled Goal from §3>

Files already identified (optional):
  <list of files expected to change, or "none yet">

Must remain compatible with:
  <from §6>

Validation expected:
  <from §9>

Out of scope:
  <from §5>

Relevant files or constraints supplied by the user:
  {{OPTIONAL_CONTEXT}}

Expected deliverable:
  {{EXPECTED_DELIVERABLE}}
```

Where `{{OPTIONAL_CONTEXT}}` is this request's full text (or its ID + link) and `{{EXPECTED_DELIVERABLE}}` is this request's §8.

**Prompt version:** v1.0.0 (this template). Any future rewording of the task block bumps the version and appends a changelog note to this line — prompt changes are versioned like code.

---

## 11. Open Questions / Assumptions (filled by the implementing agent)

Anything the request left open: ambiguous edge cases, places where the agent chose a path, checks that remain unrun. MASTER_PROMPT §6 item 3 expects failures/risks stated clearly here.
