# RASQ-Ai — trustworthy visual test automation

Zero-DOM optical automation: client perception supplies geometry, an optional multimodal model supplies semantics, Playwright supplies execution evidence.

**Stack:** Next.js (App Router) · Drizzle ORM + libsql/SQLite (`data/rasq.db`) · Playwright · `@xyflow/react` (ReactFlow, the engine behind koolii/react-workflow-editor) · zod.

## Flow
1. **Record & Scan** – full-screen recorder (start / pause / stop / cancel), screenshot/video upload, or server-side URL capture. Perception pipeline: luminance → Sobel → density grid → connected components → merged candidate regions → geometric labels + dHash template hash. Frames are grouped per page/window. Saved recording/screen scans can be reopened, edited, and updated in place while preserving unchanged control IDs.
2. **SRS Documents** – PDF/MD/TXT; exact requirement IDs, acceptance criteria and ambiguity flags.
3. **Test Scenarios** – traceable (many-to-many) positive/negative/boundary/security/accessibility/performance/resilience cases from an SRS, or positive P2 visual-interaction cases from selected saved scans. Uses P0–P3 priorities and synthetic data; visual-only cases never invent requirement links. CSV/JSON export.
4. **Workflows & Runs** – convert filtered Test Scenarios directly into downloadable n8n-compatible JSON and a saved runnable workflow, or build on the ReactFlow canvas. Playwright executes visual-anchor actions with live per-node status and step screenshots. Dry-run mode validates without executing.
5. **Reports** – built only from recorded data.

## AI models
Every feature (visual scan, document analysis, test scenarios, workflow creation, reports) has its own model selector (Local engine or any configured provider/model). Providers store only the *name* of a server env var (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, …). Secrets/PANs/emails are redacted before any call; documents and images are wrapped as untrusted data.

## Database
`drizzle/` holds generated migrations (`npx drizzle-kit generate`); they are applied and seeded automatically on first request (`src/db/index.ts`, `src/db/seed.ts`). Override the location with `RASQ_DB_URL` (e.g. `file:./data/rasq.db` or a Turso URL).

## Playwright
Install the browser once: `npx playwright install chromium` (Linux: add `--with-deps`). Try the built-in target at `/demo-target`.

`rasq-ai.*` nodes in exported workflows are executed by RASQ-Ai; stock n8n shows them as unknown nodes.

## Agent documentation

- [Master Prompt](./MASTER_PROMPT.md) — reusable instructions for AI coding, QA, security, and architecture tasks, including RASQ-Ai's non-negotiable evidence, privacy, visual-locator, and traceability rules.
- [Context Memory](./CONTEXT_MEMORY.md) — a point-in-time architecture and behavior handoff covering routes, persistence, AI routing, perception, workflows, runs, reports, known constraints, and validation commands. Verify it against the current source and update it when architecture changes.
