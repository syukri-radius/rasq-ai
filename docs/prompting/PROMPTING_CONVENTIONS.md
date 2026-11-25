# Prompting Conventions — how to write task blocks for syukri-radius/rasq-ai agents

**Version:** v1.0.0 — 2026-11-25 (UTC)
**Related:** [`MASTER_PROMPT.md`](../../MASTER_PROMPT.md), [`docs/feature-requests/FEATURE_REQUEST_TEMPLATE.md`](../feature-requests/FEATURE_REQUEST_TEMPLATE.md), [`AGENT_GUIDE.md`](../../AGENT_GUIDE.md)

Prompts are the interface between a feature request and an agent that implements it. This doc is the convention for writing them. An agent's first turn is the moment a bad prompt costs the most (rollbacks, invented identifiers, scope creep); these conventions exist so a request can land with one zero-question start.

---

## 1. Why task blocks matter

An agent starting with: `Task: fix the failing test` makes four reasonable guesses and gets them wrong on one or two — invisible to the requester until review. An agent starting with the block below ("Current behavior / Desired behavior / Must remain compatible with / Validation expected / Out of scope") starts with zero guesses and makes the requester do the thinking up front, once, at file-open time, where both sides can edit it cheaply.

---

## 2. The canonical task block (this repo)

[`MASTER_PROMPT.md`](../../MASTER_PROMPT.md) §7 defines the slots an implementing agent fills:

```text
Task:
Current behavior:
Desired behavior:
Files already identified (optional):
Must remain compatible with:
Validation expected:
Out of scope:
```

A second, shorter block follows it for requests that are already clear (§7 "Compact task handoff template"). In-repo short form: an agent that reads `MASTER_PROMPT.md` itself can start with just `Task:` + `Out of scope:`.

Rules when filling slots:

- **Task** — one line, imperative, ≤ 80 chars, *what the user would notice* (`"Add browser-based clock-skew detection to the performance API"`), not *how* (implementation details go in §3).
- **Current behavior** — what exists today with file/area refs when known; "none; feature absent" is a valid value.
- **Desired behavior** — the request's acceptance goal (§3 of the feature-request template), not the implementation plan.
- **Must remain compatible with** — from the request's §6: route shapes, contracts, IDs.
- **Validation expected** — the request's §9: commands + expected outcomes.

---

## 3. Anatomy of a good feature-request prompt

[`docs/feature-requests/FEATURE_REQUEST_TEMPLATE.md`](../feature-requests/FEATURE_REQUEST_TEMPLATE.md) is the requesting side. Its key fields and why each exists:

| Field | What the agent needs it for |
|---|---|
| **Motivation (§2)** | To reject or re-prioritize an inconsistent request before starting. |
| **Goal / Desired behavior (§3)** | The "desired behavior" slot. |
| **Acceptance criteria (§4)** | The observable, checkable done-criteria (`AC-1`, `AC-2`) — validation targets for agents that run tests. |
| **Scope: in / out (§5)** | Prevents silent scope creep ("no change to existing route shapes"). |
| **Constraints & must-nots (§6)** | The "must remain compatible with" slot. |
| **Evidence & invariants (§7)** | Tells the agent *where* the rules live — `GUARDRAILS.md` G-numbers, `MASTER_PROMPT.md` §2 items — instead of making the agent hunt. |
| **Expected deliverable (§8)** | The "expected deliverable" slot: artifacts, report shape, required tests. |
| **Validation expected (§9)** | Commands and expected outcomes the agent runs at the end. |

---

## 4. Versioning & provenance (prompts are versioned like code)

- Every request carries an ID: `FR-<date>-<NNN>`.
- The implementation prompt carries `Prompt version: vX.Y.Z` — bump to v2 when the task block's meaning changes, append a one-line changelog to the template file's header.
- Before shipping a prompt for production, decide the intended provider/temperature, and pin it where it runs (the template's `Validation expected` slot); behavior varies across models — MASTER_PROMPT §6 item 2.

## 5. Few-shot examples (when to include them)

Include 1–2 concrete examples only when the task has repeated failure modes — e.g. "generate a case whose steps have no ambiguity or manualReview" — or when the desired output shape is hard to describe precisely. Do not litter every prompt with examples; a feature request that pairs with the repo's own `docs/` explains more.

## 6. Pre-flight checklist (send this checklist to whoever writes a request)

Each item is a question; if the answer is not yet known, write it in the request rather than hoping the agent reads minds:

1. **Observable outcome:** what does "done" look like in one sentence (the `Desired behavior`)?
2. **What changes:** what files/routes/DB rows/reports appear, and what does *not* change (the `Out of scope`)?
3. **Done criteria:** what can be checked (the `Acceptance criteria`)?
4. **Validation:** which commands must pass (`npm run typecheck`, `npm test`, `npm run build`, …)?
5. **Ambiguity:** anything you expect the agent to have to ask, or that could reasonably mean two things? — if yes, put the choice in the issue §11 and let the agent pick the cheaper path when the outcomes differ little (MASTER_PROMPT: "An unclear request is a cost to weigh, not a reason to stop").

## 7. Test-case rule (for prompts that ask the agent to produce tests)

Every test an agent writes for a feature must cover: the happy path, one edge case, and one failure mode (this mirrors the repo's own rule: MASTER_PROMPT §6 "add focused tests where practical"; `tests/*.test.ts` + `npm test`). If the feature asks for AI-generated cases, require that AI output be parsed/validated through the shared path and checked against source-ID/data (MASTER_PROMPT §2, "AI routing, privacy, and provenance").

## 8. Anti-patterns

1. "Also do X while you're there" in a feature request → separate issue, or move to `Out of scope`.
2. Writing the implementation plan (file lists, diffs) into `Desired behavior` instead of `Task` — plans are the agent's job; they go in the agent's summary, not the request.
3. Acceptance criteria that say "and it should feel nice" — write the observable check ("does X within 2s", "returns 200 on replay").
4. A request with no `Out of scope` line when the task is broad (new features commonly have 5–10 real exclusions).

---

## 9. Where prompts live in this repo

- `MASTER_PROMPT.md` — the coding-agent task-block schema (§7) used by editing agents.
- `docs/feature-requests/FEATURE_REQUEST_TEMPLATE.md` — the requesting side.
- `AGENT_GUIDE.md` / `public/llms.txt` — external-agent (API-user) task blocks.
- `GUARDRAILS.md` — the invariants agents must respect (G-numbers for citations).
- `scripts/validate-feature-request.ts` — pre-flight checker for request docs.
