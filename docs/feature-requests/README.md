# Feature Requests — syukri-radius/rasq-ai

Docs and tooling for a structured feature-request loop: a request filed on GitHub is written so an implementing agent can start without back-and-forth.

## What's in this set

| File | Role |
|---|---|
| [`FEATURE_REQUEST_TEMPLATE.md`](FEATURE_REQUEST_TEMPLATE.md) | v1.0.0 template for every new feature. Contains the **Implementation prompt** block (§8–10) that goes into [`MASTER_PROMPT.md`](../../MASTER_PROMPT.md) as `{{TASK}}`. |
| [`../prompting/PROMPTING_CONVENTIONS.md`](../prompting/PROMPTING_CONVENTIONS.md) | Versioned prompting conventions for this repo — anatomy of a good task block, provenance, the pre-flight checklist before sending a request to an agent. |
| [`../../../.github/ISSUE_TEMPLATE/feature_request.yml`](../../../.github/ISSUE_TEMPLATE/feature_request.yml) | GitHub issue form: every new issue carries the structured fields automatically (motivation, acceptance criteria, scope, must-nots, expected deliverable, implementation prompt). |
| [`../../scripts/validate-feature-request.ts`](../../scripts/validate-feature-request.ts) | Pre-flight validator: `npm run validate:feature-request docs/feature-requests/your-request.md` checks required sections before implementation starts. |

## The loop

1. **File** — open the GitHub issue with the `enhancement` label using the issue form above.
2. **Validate** — run `npm run validate:feature-request <file>` on the request doc (or a page anchor). Missing `[required]` sections → return to the author before any implementing agent starts.
3. **Implement** — paste the filled **Implementation prompt** (§8–10 of the template) into [`MASTER_PROMPT.md`](../../MASTER_PROMPT.md) and run the coding agent.
4. **Report** — the agent returns its summary in the MASTER_PROMPT §6 shape; close the issue when validation (§9 of the template) passes.

## Rules of thumb

- A request that can be answered with one line of `Acceptance Criteria` or one `Must not` line usually **is** one — file it as a bug or a small enhancement, not a feature request.
- If "ambiguous → ask the author" is possible, the agent asks instead of assuming; `FEATURE_REQUEST_TEMPLATE.md` §11 ("Open Questions / Assumptions") collects those answers back on the issue.
