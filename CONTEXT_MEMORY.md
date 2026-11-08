# RASQ-Ai Context Memory

Point-in-time repository handoff for AI agents and maintainers. Read this with [`MASTER_PROMPT.md`](./MASTER_PROMPT.md), then verify the current source before making changes.

## Snapshot metadata

| Field | Value |
|---|---|
| Repository | `syukri-radius/rasq-ai` |
| Product | **RASQ-Ai — trustworthy visual test automation** |
| Source snapshot reviewed | `9dd7bc32feb24b36c18b03b65d443c0855694f41` (`first commit`) |
| Memory generated | 2026-11-08 |
| Review method | Static review of all tracked application, database, configuration, and documentation source |
| Runtime validation at generation | Not run; dependencies and Playwright browsers were not installed in the reviewed checkout |
| Application size at snapshot | 4,257 lines across tracked files under `src/` |
| License file | `Commercial Standard License`, naming PT Radius Data Solusi; see `LICENSE` for its usage/redistribution restrictions and remaining template language |

This document describes the snapshot above. Later commits may invalidate details. Statements in **Known constraints** are observations, not automatically approved feature work.

---

## 1. Product model and trust boundaries

RASQ-Ai converts visual evidence and software requirements into traceable test artifacts:

```text
screen recording / image / video / URL capture
  → browser-side optical candidate detection and page/window grouping
  → optional AI semantic enrichment
  → saved screens + visual controls (region + dHash)

PDF / Markdown / text SRS
  → local parser and optional AI extraction
  → exact requirements + acceptance criteria + ambiguity flags

requirements + saved controls
  → local rules or optional AI test design
  → test cases + many-to-many requirement traceability
  → n8n-shaped workflow JSON + ReactFlow editor
  → dry-run validation or in-process Playwright execution
  → run steps + evidence JSON + screenshots
  → Markdown reports based only on persisted facts
```

The central division of responsibility is deliberate:

- **Perception** proposes geometry and low-confidence geometric classifications in the browser.
- **Optional AI** enriches semantics or generates artifacts only through the operator-selected route.
- **Playwright** performs URL capture and real web execution and records evidence.
- **Reports** distinguish generated artifacts, dry runs, and actual Playwright runs.

The project is currently a compact single-operator application, not a demonstrated multi-tenant or distributed production system.

---

## 2. Technology and repository layout

### Runtime stack

- Next.js `^16.4.5`, App Router and route handlers.
- React/React DOM `19.2.6`, strict TypeScript `5.9.3`.
- Tailwind CSS `4.1.17` through `@tailwindcss/postcss`.
- Drizzle ORM `0.45.2` with `@libsql/client`; SQLite by default, with an alternate libsql URL configurable through `RASQ_DB_URL`. The README cites Turso URLs, but the reviewed code does not wire a separate auth-token option.
- Playwright `^1.65.0` for capture and execution.
- `@xyflow/react` `^12.12.1` for the workflow canvas.
- Zod `^4.6.7` for AI-output and workflow-step contracts.
- `unpdf` for server-side PDF text extraction.
- `lucide-react` for icons.
- `pg`, `@types/pg`, and `dotenv` are dependencies, but the reviewed runtime path uses libsql/SQLite rather than PostgreSQL.
- `package.json` still has the starter name `nextjs-postgresql-template`; UI metadata and runtime behavior identify the app as RASQ-Ai.

Playwright, libsql, and unpdf are listed in `serverExternalPackages` in `next.config.ts`. Server Actions have a configured 50 MB body limit, although the reviewed features primarily use route handlers rather than Server Actions.

### Source map

| Path | Responsibility |
|---|---|
| `src/app/(app)/layout.tsx` | Shared application shell |
| `src/components/Shell.tsx` | Navigation and project selector |
| `src/components/ui.tsx` | Client API helper, project context, UI primitives |
| `src/components/ModelPicker.tsx` | Per-task model route selector |
| `src/app/(app)/page.tsx` | Server-rendered dashboard and aggregate counts |
| `src/app/(app)/scan/page.tsx` | Recorder, uploads, capture UI, perception review, AI enrichment, saving |
| `src/app/(app)/requirements/page.tsx` | SRS upload/paste and requirement display |
| `src/app/(app)/tests/page.tsx` | Test generation, filtering, traceability matrix, exports |
| `src/app/(app)/workflows/page.tsx` | ReactFlow editor, n8n import/export, live run monitor |
| `src/app/(app)/reports/page.tsx` | Report generation, history, Markdown preview/download |
| `src/app/(app)/settings/page.tsx` | AI kill switch, providers, routes, editable policies |
| `src/app/demo-target/page.tsx` | Synthetic checkout exposing every supported control type |
| `src/app/api/**/route.ts` | JSON, upload, file, export, capture, and run endpoints |
| `src/lib/perception.ts` | Canvas image analysis, candidate classification, dHash, frame grouping |
| `src/lib/ai.ts` | Mission, policies, provider routing, redaction, provider HTTP calls, provenance |
| `src/lib/srs.ts` | Requirement parsing/classification and deterministic local test design |
| `src/lib/cases.ts` | Test-case loading with requirement keys |
| `src/lib/n8n.ts` | Workflow generation/validation and n8n ↔ ReactFlow conversion |
| `src/lib/runner.ts` | URL guard, screenshot capture, visual actions/assertions, run persistence |
| `src/lib/schemas.ts` | Zod schemas for AI responses and test steps |
| `src/lib/types.ts` | Shared control/task/action/category/priority/status constants |
| `src/lib/api.ts` | `ok`, `fail`, `body`, async route `Params` helpers |
| `src/db/schema.ts` | Sixteen Drizzle tables and relationships |
| `src/db/index.ts` | Global libsql client, migration and seed initialization |
| `src/db/seed.ts` | Demo projects, provider catalog, local routes, policies, sample SRS |
| `drizzle/` | Generated SQL migration and metadata; do not treat as hand-written domain source |

### Styling and TypeScript conventions

- Path alias `@/*` maps to `./src/*`.
- Strict TypeScript and `noEmit` are enabled.
- Existing code uses double quotes, semicolons, compact React components, and shared primitives.
- Browser-only perception imports must stay out of server-only execution paths except for pure functions such as `hashSimilarity` that do not touch `document` at module initialization.
- Dynamic route parameters use Next.js Promise-based `params`, wrapped by `Params<T>`.
- Many data-changing routes use `dynamic = "force-dynamic"`; AI routes also set `maxDuration = 300`.

---

## 3. Setup, configuration, and commands

### Local setup

```bash
npm ci
npm run dev
```

The default Next.js port is 3000. Relative targets such as `/demo-target` are resolved by the server runner against `http://127.0.0.1:${PORT ?? 3000}`; `PORT` must therefore match the actual app when using relative targets.

For URL capture and real workflow execution:

```bash
npx playwright install chromium
# Linux environments that also need OS dependencies:
npx playwright install chromium --with-deps
```

### Available scripts

| Command | Actual script |
|---|---|
| `npm run dev` | `next dev` |
| `npm run build` | `next build` |
| `npm run start` | `next start` |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc --noEmit` |

There is no `test` script, checked-in automated test suite, or CI configuration in the source snapshot.

### Environment and storage

| Setting | Meaning |
|---|---|
| `RASQ_DB_URL` | Optional database URL; default `file:./data/rasq.db` |
| `PORT` | Used by Next.js and by RASQ-Ai when resolving relative target URLs |
| `OPENAI_API_KEY` | Optional secret referenced by the seeded OpenAI provider |
| `ANTHROPIC_API_KEY` | Optional secret referenced by the seeded Anthropic provider |
| `GEMINI_API_KEY` | Optional secret referenced by the seeded Gemini provider |
| `OPENROUTER_API_KEY` | Optional secret referenced by the seeded OpenRouter provider |

No API key is needed for the default Local engine. The seeded Ollama provider has an empty key-env name and defaults to `http://127.0.0.1:11434/v1`; selecting it still uses the provider/model-call path.

The database stores only environment-variable **names**. `.env` is ignored, and no `.env.example` is checked in. Do not place actual key values in provider rows or documentation.

Local artifacts live below `data/`, which is ignored:

```text
data/rasq.db                 default database
data/recordings/<uuid>.webm|mp4
data/screens/<uuid>.png|jpg|webp
data/runs/<runId>/<position>.jpg
```

`getDb()` enables foreign keys, applies `drizzle/` migrations, and seeds once per process. The database client and readiness Promise are cached on `globalThis`. Initialization resets its cached Promise after failure so a later request can retry.

`seed()` returns immediately if any project already exists. On an empty database it creates:

- `RASQ Demo Storefront` (`web`, target `/demo-target`) and `Citrix Claims Desktop` (`citrix`).
- OpenAI, Anthropic, Gemini, OpenRouter, and Ollama provider catalog entries.
- Local routes for all five AI tasks and `aiMode = "ai"`.
- Five enabled product/security/testing policies.
- A synthetic checkout SRS and its parsed requirements for the demo project.

`aiMode = "ai"` means providers are allowed, not that a provider is selected. All seeded task routes still point to Local.

---

## 4. UI and API contract map

### Pages

| Route | Purpose |
|---|---|
| `/` | Global artifact/run counts, latest runs, pipeline overview |
| `/scan` | Record full screen; upload images/video; capture URL; edit and save visual controls |
| `/requirements` | Add PDF/MD/TXT or pasted SRS; inspect documents, criteria, and ambiguity |
| `/tests` | Generate/replace cases, filter cases, view matrix, export CSV/JSON |
| `/workflows` | Generate/import/edit/export workflows; dry-run or execute; inspect evidence |
| `/reports` | Generate and download evidence-based Markdown reports |
| `/settings` | AI data-sharing switch, per-task models, provider catalog, policies |
| `/demo-target` | Safe synthetic checkout target; no real payment processing |

The selected project ID is stored in browser `localStorage` under `rasq.project`. The provider prefers the first web project when there is no valid saved selection.

### API routes

The `ok` helper returns the supplied JSON payload directly, not wrapped in a `data` property. The `fail` helper returns `{ "error": string }`.

| Route | Methods and behavior |
|---|---|
| `/api/health` | `GET`: database `select 1`, app/engine health |
| `/api/projects` | `GET`: all projects; `POST`: create with validated surface fallback |
| `/api/settings` | `GET`: AI mode, providers plus key-configured flags, routes, policies; `PUT`: update mode/route/policy |
| `/api/providers` | `POST`/`PATCH`: validate provider catalog data; `DELETE?id=`: remove and reset routes using it |
| `/api/capture` | `POST`: Playwright screenshot returned as PNG data URL |
| `/api/ai/scan` | `POST`: enrich supplied candidates/image using `visual_scan`; Local selection returns HTTP 409 |
| `/api/recordings` | `GET[?projectId=]`; multipart `POST`: save recording and SHA-256 metadata |
| `/api/recordings/:id` | `GET`: binary recording; `DELETE`: file and row |
| `/api/screens` | `GET[?projectId=]`: screens with controls; `POST`: save image data URL and selected controls |
| `/api/screens/:id` | `GET`: binary image; `DELETE`: image and row |
| `/api/requirements` | `GET?projectId=`; multipart `POST`: parse/extract/persist; `DELETE?docId=` |
| `/api/tests` | `GET?projectId=`; `POST`: generate cases; `DELETE?id=` or `?projectId=` |
| `/api/tests/export` | `GET?projectId=&format=csv|json`: download cases |
| `/api/workflows` | `GET[?projectId=]`; `POST`: `generate`, `import`, or `blank` |
| `/api/workflows/:id` | `GET`; `PUT`: validate/save and increment version; `DELETE` |
| `/api/workflows/:id/export` | `GET`: saved n8n JSON download |
| `/api/runs` | `GET[?workflowId=]`; `POST`: start Playwright/dry run, HTTP 202 with run ID |
| `/api/runs/:id` | `GET`: run and ordered steps |
| `/api/runs/:id/shots/:file` | `GET`: constrained run-screenshot path, numeric JPEG filenames only |
| `/api/reports` | `GET[?projectId=]`; `POST`: generate/persist report; `DELETE?id=` |
| `/api/reports/:id` | `GET`: Markdown attachment |

The client `api<T>()` helper sends JSON when given `json`, defaults such requests to `POST`, parses text/JSON responses, and throws the server-provided error message for non-2xx responses. Multipart uploads use `fetch` directly.

---

## 5. Persistence model

`src/db/schema.ts` defines sixteen tables:

| Table | Key fields and relationships |
|---|---|
| `projects` | Root project; `surface`, `targetUrl`, description |
| `ai_providers` | Protocol, base URL, key-env name, JSON model list, enabled flag; no credential value |
| `model_routes` | Task primary key; nullable provider means Local |
| `settings` | Key/value settings, including `aiMode` |
| `policies` | Named, prioritized, enableable system-policy text |
| `recordings` | Project FK cascade; file metadata and SHA-256 |
| `screens` | Project FK cascade; recording FK `set null`; source dimensions, image path, grouping/provenance |
| `controls` | Screen FK cascade; type, label, integer region, confidence, evidence, dHash, separate perception/AI provenance |
| `requirement_docs` | Project FK cascade; full extracted text, SHA-256, analysis model |
| `requirements` | Document FK cascade; exact `reqKey`, text, JSON acceptance criteria, category, ambiguity |
| `test_cases` | Project FK cascade; case key, category/priority, JSON preconditions/data/steps/assumptions, provenance |
| `test_traceability` | Composite PK on test case + requirement; both FKs cascade |
| `workflows` | Project FK cascade; n8n JSON, provenance, version, timestamps |
| `runs` | Workflow FK cascade; mode/status/target/error/summary/timestamps |
| `run_steps` | Run FK cascade; ordered node snapshot, status/message/duration/evidence JSON |
| `reports` | Project FK cascade; generated Markdown and provenance |

IDs default to `crypto.randomUUID()`; creation timestamps default in application code. SQLite JSON columns carry TypeScript types through Drizzle.

Database cascades and file deletion are separate concerns. Recording and screen DELETE handlers explicitly remove their files. Workflow deletion cascades run rows, but the reviewed handler does not remove the corresponding `data/runs/<runId>/` screenshot directories.

For schema changes, update `src/db/schema.ts` and generate a new migration:

```bash
npx drizzle-kit generate
```

`drizzle.config.json` uses SQLite dialect, `src/db/schema.ts`, `drizzle/`, and `file:./data/rasq.db`.

---

## 6. AI routing and model-call pipeline

### Shared task types

Defined in `src/lib/types.ts`:

```text
visual_scan         Visual scanning
document_analysis   Document analysis
test_scenarios      Test scenario creation
workflow_creation   Test workflow creation
report_generation   Report generation
```

Internal model labels:

```text
PERCEPTION_MODEL   = rasq-perception-v1
LOCAL_RULES_MODEL  = rasq-local-rules-v1
```

### Route resolution

`resolveRoute(db, task)`:

1. Reads `aiMode`, defaulting to `ai`.
2. Returns Local with a kill-switch reason when mode is not `ai`.
3. Returns Local when there is no route/provider ID.
4. Rejects a missing/disabled provider.
5. Rejects a configured key-env name whose server environment value is absent.
6. Otherwise returns provider and selected model.

`provenanceOf` returns `local` for deterministic routing or `ProviderName:model` for AI. Workflow/report persistence maps local generation to `rasq-local-rules-v1` where appropriate.

### Prompt and provider handling

`buildSystem` concatenates:

1. Immutable `MISSION` trust/output instructions.
2. Enabled policies ordered by descending priority.
3. Task-specific schema and rules.

`untrusted(label, body)` wraps data with explicit untrusted-data markers. `redact` performs regex-based redaction for many PAN-like numbers, non-example emails, common secret assignments, and several token formats; it preserves the public `4242424242424242` sandbox fixture. This is a mitigation, not comprehensive sensitive-data detection, and it does not redact pixels.

`callModel` supports:

- OpenAI-compatible `POST /chat/completions`, JSON response format, optional bearer key, data-URL images.
- Anthropic `POST /v1/messages`, base64 image blocks, 8192 max tokens.
- Gemini `:generateContent`, JSON MIME response configuration, inline base64 images.

Calls use `AbortSignal.timeout(180_000)`. `parseJson` tolerates Markdown fences and extracts the outermost object before `JSON.parse`; route handlers then apply Zod schemas and domain-specific source-ID checks. Provider errors include only a truncated response snippet and attempt to replace the configured key.

### Task-specific behavior

- **Visual scan:** requires a non-Local provider. Sends at most 120 candidates; accepts known candidate IDs only, and at most 30 in-bounds missed controls. Candidate coordinates cannot be changed by AI.
- **Document analysis:** local parser always runs first. AI receives at most 60,000 redacted characters. Returned IDs not literally present in source text are rejected.
- **Test scenarios:** AI processes requirements in batches of six and receives at most 150 bindable controls. Malformed cases are dropped with warnings; unknown requirement/control IDs are removed or rejected.
- **Workflow creation:** AI only proposes bindings and assertion kinds for open steps. Control IDs must exist in the supplied visual-control map.
- **Report generation:** AI receives computed project statistics only, wrapped as untrusted data, and is instructed not to invent execution/pass rates.

The global kill switch and per-task Local route avoid provider calls; they do not remove already-persisted screenshots, documents, run evidence, or reports.

---

## 7. Visual perception and recording details

### Client analysis pipeline

`analyze()` in `src/lib/perception.ts` uses browser canvas and source dimensions:

1. Downscales the working image so its longest side is at most 1280 pixels.
2. Computes luminance (`0.2126 R + 0.7152 G + 0.0722 B`).
3. Computes Sobel gradient magnitude and an adaptive threshold of at least 40.
4. Builds a 4-pixel density grid and applies horizontal bridging.
5. Finds 8-connected components.
6. Filters very small/huge regions and merges highly overlapping candidates.
7. Classifies up to 160 candidates using geometry, local contrast, and right-edge density.
8. Maps boxes back to original source pixels and computes each region hash.
9. Builds a 32×18 luminance signature for page/window grouping.

Geometric labels include `unknown`; confidence intentionally remains low and evidence describes visual geometry rather than business behavior.

The supported saved control taxonomy is:

```text
input, button, dropdown, date_picker, checkbox, toggle, slider, upload, download
```

### Hash and grouping contracts

- Region hashes are 9×8 sampled difference hashes producing 64 bits as 16 hex characters with prefix `rq1:`.
- `hashSimilarity` is `1 - differingBits/64` and returns 0 for malformed hash lengths.
- Frame grouping compares only equal-dimension frames using mean absolute signature distance; default grouping threshold is 9.
- A group's representative frame changes when a later frame has more non-unknown candidates.
- The runner independently computes the same dHash in a Playwright helper page. Changes to the algorithm must be synchronized.

### Evidence acquisition

- Screen recording uses `getDisplayMedia` and `MediaRecorder`, prefers WebM VP9/VP8, samples every 1.5 seconds, and supports start/pause/resume/stop/cancel.
- Uploaded videos are seeked at the chosen interval, with at most 150 sampled frames. Images are analyzed directly.
- Server capture takes one Playwright screenshot after page load and a 400 ms wait; requested dimensions are capped at 3840×2160.
- AI enrichment resizes the source to a longest side of at most 1568 pixels, maps candidate boxes into that coordinate system, and maps AI-added missed boxes back to source pixels.
- AI-added controls have confidence capped at 0.6 and receive a hash computed from the original image.
- Saving persists only selected, known control types. Screen rows always record `rasq-perception-v1`; AI provenance is stored separately.

---

## 8. SRS and test-design behavior

### Requirement extraction

Accepted input is pasted text or PDF/Markdown/text-like upload. File uploads are limited to 15 MB; extracted text must contain at least 10 non-whitespace characters after NUL removal.

The local parser:

- Recognizes structured uppercase IDs such as `REQ-001` and `FR-1.2` through its ID regex.
- Associates `AC`, acceptance-criteria, and Given/When/Then-style lines with the current requirement.
- Classifies functional/security/privacy/accessibility/performance/resilience text by keywords.
- Flags selected vague terms when no number or acceptance criterion supplies an oracle.
- Requires at least one recognized ID; otherwise the request fails with guidance to prefix requirements.

The original full extracted text and its SHA-256 are stored even when AI assists analysis.

### Deterministic local cases

`designLocalCases`:

- Binds up to four controls by overlapping normalized requirement/control-label words.
- Uses synthetic example data and vault placeholders for passwords.
- Uses the public sandbox card fixture only when source text calls for a sandbox/test/payment card value.
- Always starts with `navigate` and ends with `assert`.
- Creates a positive case, then evidence-justified negative, numeric boundary, security, privacy, accessibility, performance, and resilience cases.
- Derives numeric boundary pairs only from recognized minimum/maximum wording.
- Converts vague requirements without measurable criteria into an ambiguity-exposing case, not a fabricated quality guarantee.

Priority rules: payment/security/privacy/integrity-like content is P0; core behavior defaults to P1; boundary/non-functional/negative cases are P2; cosmetic/optional polish is P3.

### Generation and traceability

`POST /api/tests` accepts `projectId`, `docId`, optional `screenIds`, and optional `replace`.

- Local mode designs cases for every requirement in the selected document.
- AI mode validates each case with `AiTestCaseSchema`, renumbers steps, validates control IDs, and redacts generated data.
- By default (`replace !== false`), **all test cases for the project are deleted** before insertion, even though generation uses one selected document.
- Case keys are assigned as `TC-001`, `TC-002`, etc., based on existing count when appending.
- Requirement links are persisted in `test_traceability`; a case can link to many requirements and vice versa.
- CSV export quotes fields; JSON export removes internal row ID/project/creation fields but retains requirement keys and provenance.

---

## 9. Workflow and execution contracts

### n8n-shaped workflow model

Generated workflows begin with Manual Trigger and Open Target, followed by a no-op section and ordered steps for each selected case. Default viewport is 1280×800.

Custom node types:

```text
rasq-ai.openTarget
rasq-ai.action
rasq-ai.assert
```

Standard node types used for structure:

```text
n8n-nodes-base.manualTrigger
n8n-nodes-base.noOp
```

Action parameters include case/requirement traceability, action/target/data, nullable control ID, anchor status, region, source dimensions, locator hash, threshold `0.55`, and `strict: false`.

Assertion selection can be:

- `textVisible`, often derived from quoted expected text;
- `urlContains`;
- `screenshotChanged`, commonly after click or for recognized timing requirements;
- `manualReview` when there is no automatable oracle.

`within N ms/seconds` wording can become `maxDurationMs`.

n8n connections refer to unique node names. ReactFlow conversion uses IDs. Execution traverses connections breadth-first from the manual trigger, or from the first node if no trigger exists, and visits each name once. Imported workflows require `nodes` and `connections`, unique names, and string name/type values; other fields receive defaults.

Exports are structurally n8n-compatible JSON, but stock n8n will show `rasq-ai.*` as unknown nodes. RASQ-Ai executes those nodes itself.

### Run lifecycle

`POST /api/runs` resolves target URL from the request or Open Target node, creates running/pending rows, returns HTTP 202, and starts `executeRun` with a detached Promise in the same process.

This is **not a durable job queue**. Process termination, some serverless platforms, or multi-instance deployment can interrupt or strand runs. The UI polls `/api/runs/:id` approximately every 900 ms until status is not `running`.

Playwright launches headless Chromium with `--no-sandbox` and `--disable-dev-shm-usage`. Missing browser installation produces an explicit installation hint.

Relative targets resolve to the app's own loopback URL. `assertSafeUrl` permits only HTTP(S) and rejects hostnames beginning with `169.254.` or `metadata.google`; it is not a complete SSRF defense for DNS, redirects, all loopback/private ranges, or IPv6.

### Visual actions

- `navigate`: reloads the current target for a clean case start.
- `wait`: waits supplied milliseconds, capped at 10 seconds.
- Bound regions scale independently by viewport/source width and height and are clamped to the viewport.
- Missing regions skip the action. `<FIXTURE...` data returns `needs-review` rather than typing a secret.
- The runner screenshots the region, computes dHash similarity, and records `anchorScore`.
- Below-threshold matches fail before action only in strict mode; otherwise they proceed with a warning.
- `type`: click, select all, keyboard-type synthetic data.
- `select`: click and choose through keyboard input.
- `slider`: click a percentage along the region.
- `upload`: attach a synthetic text buffer through a file chooser and record bytes/SHA-256.
- `download`: record filename, bytes, and SHA-256; compare only when a 64-hex manifest is supplied.
- Other actions, including click/check/uncheck/toggle, click the visual anchor center.
- Check/uncheck/toggle/slider compare region pixels afterward; no change becomes `warning`, while change is not treated as proof of exact state.

### Assertions and evidence

- `screenshotChanged`: polls for any full-page pixel difference, normally up to 1500 ms, or checks a derived duration limit. Exact content remains unverified.
- `urlContains`: checks the current page URL.
- `textVisible`: uses Playwright `getByText(value).first()` with a 3-second visibility timeout.
- Anything else returns `needs-review` for human verification.

After applicable real steps, the runner saves a quality-45 JPEG under `data/runs/<runId>/` and records its numeric filename in evidence. Step messages are truncated to 1000 characters.

Dry runs never launch a browser. Unresolved action anchors become `warning`; other nodes become `skipped` with “structure validated only” messaging.

Run status precedence is:

```text
error > failed > needs-review > warning > passed > skipped
```

A fatal runner error marks still-pending steps skipped and stores the run error. Unsupported node types produce skipped steps rather than being executed.

---

## 10. Reporting semantics

`POST /api/reports` computes persisted statistics for one project:

- Requirement total, covered/uncovered exact IDs, and ambiguity.
- Case count by category and priority.
- Screen/control counts, controls by type, and controls below 0.5 confidence.
- Workflow count, Playwright-run count, dry-run count, and latest run status summaries.
- A requirement-to-test-case traceability table.

If there are no Playwright runs, the report explicitly says no test execution has been recorded and that artifact counts are not observed results. Dry runs do not satisfy the executed-run count.

Optional AI receives only these computed statistics. Its executive summary, risks, and recommendations are labelled AI-authored with provenance. Reports are saved as Markdown and can be downloaded unchanged. The report does not infer a pass rate absent recorded data.

---

## 11. Known constraints and risk areas

These are current-source facts to preserve or address intentionally, not claims that the application is production-hardened:

1. **No automated verification suite:** no test script, test files, or CI configuration were present at the snapshot. Typecheck/lint/build are the available standard checks.
2. **No auth layer:** reviewed API and page routes do not implement authentication, authorization, session handling, or tenant isolation. Project IDs are client supplied.
3. **Single-process execution:** detached in-process runs are not durable, scheduled, horizontally coordinated, or restart-safe.
4. **Local operational state:** SQLite/libsql plus synchronous local filesystem operations bind much of the state to one application instance/filesystem.
5. **Limited target URL guard:** HTTP(S) and a small metadata/link-local check do not constitute comprehensive SSRF protection, especially with redirects and DNS resolution.
6. **Partial input hardening:** AI outputs have Zod contracts, but API request bodies are not uniformly schema validated. The 15 MB limit is specific to SRS files; recording and image request limits are not equivalently explicit in handlers.
7. **Redaction is textual and heuristic:** images are not sanitized, and regexes cannot guarantee removal of all secrets or personal data.
8. **Filesystem cleanup is incomplete for run evidence:** deleting a workflow cascades database runs/steps but does not delete run screenshot directories in the reviewed handler.
9. **Seed is empty-database oriented:** adding seed policies/providers does not update an existing populated database automatically.
10. **Regeneration is broad by default:** generating from one SRS replaces the project's full case set unless `replace: false` is supplied.
11. **Visual assertions have limited oracles:** pixel change and region change do not establish semantic correctness or exact control state.
12. **Custom n8n nodes are not stock-n8n executables:** compatibility refers to workflow JSON structure/import/export, not availability of RASQ-Ai custom nodes in n8n itself.
13. **Starter metadata remains:** package name and unused PostgreSQL-related dependencies do not describe the actual libsql runtime.
14. **No checked-in environment template/deployment manifest:** setup relies on source defaults and README; production topology is not defined here.
15. **License text needs deliberate handling:** `LICENSE` is not a permissive open-source license. It names PT Radius Data Solusi, states machine/usage/redistribution restrictions, and retains template/source-code language that should be reviewed rather than silently ignored or rewritten.

---

## 12. High-value smoke path

When dependencies and Chromium are available, this path exercises the main local-only flow without external AI credentials:

1. Start with an isolated `RASQ_DB_URL` and run the app on a known `PORT`.
2. Open `/api/health` and confirm database initialization.
3. Open `/demo-target` and confirm the synthetic checkout works.
4. In `/scan`, select the demo project and capture `/demo-target` at 1280×800.
5. Review geometric candidates; manually correct/save only defensible visible controls.
6. In `/requirements`, use the seeded sample SRS or upload a synthetic ID-prefixed document.
7. In `/tests`, generate Local cases and verify exact requirement links, ordered steps, and expected results.
8. In `/workflows`, generate a workflow; verify unresolved anchors are visible and dry run executes nothing.
9. Run Playwright only against the synthetic demo target. Inspect anchor scores, step statuses, messages, and screenshots.
10. Generate a report and verify it separates generated coverage from observed run evidence.
11. Toggle the AI kill switch and verify provider-backed operations cannot make a model call.
12. Delete isolated test data/artifacts afterward; do not commit the database or evidence files.

This is a manual checklist, not evidence that the path has already passed.

---

## 13. Change-impact and memory-update checklist

After a task, update this file when any relevant fact changes:

- **Stack/config:** package scripts, Next config, TypeScript aliases, env vars, storage paths.
- **Product pipeline:** page responsibilities, evidence flow, supported controls/actions/assertions.
- **API:** methods, payload/response contracts, status codes, limits, exports.
- **Database:** tables, relationships, cascade/file behavior, migration and seed semantics.
- **AI:** tasks, provider protocols, Local/kill-switch behavior, policies, redaction, provenance, schemas.
- **Perception:** coordinate systems, dHash, grouping, candidate limits, AI scaling.
- **Workflow/runs:** node types, connection rules, statuses, runner lifecycle, URL policy, evidence.
- **Reports:** fact sources and executed-versus-generated wording.
- **Verification:** tests/CI added, commands and actual current limitations.
- **Snapshot:** replace the reviewed commit/date and state what was actually validated.

Keep historical claims tied to their snapshot. Do not record speculative plans as completed capabilities, and do not store secrets, real customer evidence, local database contents, or provider responses in this memory.
