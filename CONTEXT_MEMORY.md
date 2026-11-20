# RASQ-Ai Context Memory

Point-in-time repository handoff for AI agents and maintainers. Read this with [`MASTER_PROMPT.md`](./MASTER_PROMPT.md), then verify the current source before making changes.

## Snapshot metadata

| Field | Value |
|---|---|
| Repository | `syukri-radius/rasq-ai` |
| Product | **RASQ-Ai — trustworthy visual test automation** |
| Wave 0 scope | Scoped 2026-11-20 in `WAVE_0_SCOPE.md` (not implemented): single-node SQLite + row-level tenancy; OIDC+SAML SSO; server-side sessions; five RBAC roles mapped onto existing scope bundles; SQLite-lease durable runs queue; S3-compatible artifacts + Vault/KMS secret refs; correlation IDs + AI-call ledger; sub-waves W0.1a–W0.5, migrations 0007–0011 |
| Application version | `1.3.0` for the web application; `desktop-agent/` is versioned separately at `0.1.0` |
| Source snapshot reviewed | REST performance feature reviewed on `arena/2be74e85-rasq-ai` from base `0eadc786a07a1cc12557eda81a634042f79a0bcf` (uncommitted working-tree change at this snapshot); earlier UI snapshot: `30fcac12bb65ef7f7e1e9b9045979f46c328ebeb` for the UI layer: the 1.0.0 glass-theme change merged onto `26985f028e1c4617acf89e4ef9a67ffa98112335`. Everything outside the UI layer was last reviewed at `8fb19db2143c7ec2ce86cd84d5cd9aaf7a3640a8` plus the attended RobotJS Desktop Agent implementation |
| Memory generated / updated | 2026-11-20 for Wave D governance at scale (DB-backed budgets, audit query/export, retention/GC, tenancy-lite key partitioning, GUARDRAILS.md); 2026-11-20 for Wave C interoperability (webhooks, MCP, stale-run sweeps); 2026-11-20 for the external-agent surface (API keys, scopes, audit, idempotency, OpenAPI, llms.txt); 2026-11-12 for REST performance testing; 2026-11-12 for OpenCode Go session header and provider option; 2026-11-11 for appearance, version and the browser steps for blocked downloads; 2026-11-09 for everything else |
| Review method | 2026-11-11: source review of the UI layer plus web typecheck, lint, unit tests, production build, and scripted Chromium checks of the themed UI. 2026-11-09: static source review plus typecheck, lint, production build, compiler/agent unit tests, fresh/upgrade migrations, and real HTTP integration with a headless mock desktop agent |
| Runtime validation at update | **2026-11-12 (REST performance feature):** web typecheck, 38 tests (fresh and legacy migrations, plan safety, SLA conflict/insufficient confidence, CLI fixture, cancellation, API create/update/approve/poll/report), lint (0 errors, 8 existing warnings), production build passed. Chromium 153 via `@sparticuz/chromium` rendered `/performance` in four themes at 1440×900 and 390×900 with HTTP 200, no page errors or document overflow; screenshots saved under ignored `data/` for local review. `/demo-target` 1280×800 screenshot was byte-identical to the earlier reference. No real JMeter CLI or field load test occurred. **2026-11-12 (Go session header):** local mock Go endpoint verified the prefixed session header, reuse across requests, user agent, unchanged key/JSON payload, and absence of the header on a non-Go endpoint. No live Go call was made. **2026-11-12 (OpenCode Go option):** typecheck, 32 web tests (including isolated fresh-database seed/Local kill-switch and local HTTP mock gateway contract), lint (0 errors, 8 existing unused-disable warnings), and production build passed. No real Go account/provider call or browser visual check was performed. **2026-11-11 (themes, version):** web typecheck, 30 web unit tests and the production build passed; lint retains the same eight unused-disable warnings. Chromium 153 with software rendering drove the production build. A rendered-pixel audit compared each visible text run with the pixels behind it across 15 UI states (about 2,300 text runs per theme at 1440×900): the lowest text contrast was 5.70:1 in dark purple, 5.48:1 in light purple, 5.48:1 to 6.42:1 in three custom palettes, and 7.50:1 or more in four random palettes (seeds 1, 2, 3 and 5). Dark purple, light purple and one random palette gave the same minimums at 390×844. Six of these twelve runs were repeated on the final build; the other six ran on an earlier build of the same day that differed only in layout classes and one sentence of interface copy. Theme selection, persistence, reload without a frame of another theme, cross-tab sync, keyboard use, refused storage writes and corrupt-storage fallback were exercised through the real UI. `/demo-target` screenshots were byte-identical to the previous build at 1280×800 and 1440×900, and the content box of `main` had the same position and width as in the previous build at eleven viewport widths from 800px to 2560px. Horizontal overflow at 390, 768, 1024 and 1440px matched the previous build, except that the run-summary badges on `/workflows` now wrap instead of overflowing. URL capture returned a byte-identical screenshot, and a Playwright run of a generated 98-step workflow produced the same status and message for every step as the previous build, but only through a local browser-launcher shim, because Playwright's own browser download was unavailable. Not validated: Firefox, Safari, real devices and external AI providers; `desktop-agent/` was neither changed nor re-tested. **2026-11-11 (browser steps):** starting from an empty sandbox, the two steps under **Browser checks when Playwright's download is blocked** produced a working Chromium 153. Through its launcher, URL capture of `/demo-target` and a two-node Playwright run of it passed, and `/settings` rendered in all four themes at 1440×900 and in light purple at 390×844. No application code changed. **2026-11-09 (desktop agent):** Web/agent typechecks and agent build passed; web production build and mock HTTP dry-run/attended/cancellation paths passed; lint retains eight existing unused-disable warnings. No real OS input, packaged agent, external AI provider, or Chromium execution was used. |
| 1.3.0 validation | 2026-11-20 (Wave D): web typecheck, 63 tests (incl. new `tests/governance.test.ts`: migration 0006, project-partition 404/filter semantics, workflow delete protection, per-key daily budget `daily_budget_exceeded`, usage-counter GC, operator-only audit API + CSV formula-escaping, retention windows, agent-keys partition fields), lint (0 errors, same 8 pre-existing warnings), production build passed. Live smoke against an isolated `RASQ_DB_URL`: see the PR for exact commands. |
| 1.2.0 validation | 2026-11-20 (Wave C): web typecheck, full test suite, lint, production build; migration `0005_webhooks` applied on fresh databases; live HTTP smoke against an isolated `RASQ_DB_URL` (webhook CRUD + test delivery to a local receiver, signature verification, stale-run sweep fires webhook, MCP server tools/list + tools/call over stdio). See the PR for exact commands. |
| 1.1.0 validation | 2026-11-20 (external-agent surface): web typecheck, 47 tests (incl. fresh-database `0004_agent_surface` migration via `getDb()` and the agent-surface suite), lint (0 errors, same 8 existing warnings), production build passed. Live HTTP smoke against an isolated `RASQ_DB_URL`: public health/OpenAPI, operator passthrough, 401 on garbage/revoked keys, 403 on missing scopes and on agent key-management, `audit_log` rows for ok/denied, `Idempotency-Key` replay (`idempotent-replay: true`) and 409 on body drift, CLI key mint/list/revoke, agent-driven Local test generation (16 cases), workflow creation and dry-run (50 steps skipped, no browser), report generation. No external provider, Playwright browser, JMeter CLI, or desktop agent was used. |
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

OR saved screens + visual controls, without an SRS
  → positive P2 visual-interaction cases with bound anchors and no requirement links

either case source
  → filtered cases convertible in Test Scenarios to saved/downloadable n8n JSON
  → n8n-shaped workflow JSON + ReactFlow editor
  → dry-run validation or in-process Playwright execution
  → OR Web `rasq-desktop.v1` compiler → deterministic RobotJS bundle/script
       → enrolled desktop agent → preflight/confirmation → fixed attended runner
  → run steps + evidence JSON + screenshots
  → Markdown reports based only on persisted facts
```

The central division of responsibility is deliberate:

- **Perception** proposes geometry and low-confidence geometric classifications in the browser.
- **Optional AI** enriches semantics or generates artifacts only through the operator-selected route.
- **Playwright** performs URL capture and real web execution and records evidence.
- **Web desktop compiler** deterministically generates versioned manifests, anchor assets, integrity metadata, and inspectable RobotJS source from approved workflows; the agent does not design tests or evaluate downloaded source.
- **Desktop agent** performs outbound polling, no-input preflight, attended confirmation, strict visual matching, fixed-runner input, cancellation, and evidence return. Real input is a Windows x64 MVP; mock runs are simulations.
- **Reports** distinguish generated artifacts, dry runs, mock simulations, actual Playwright runs, and real attended RobotJS runs.

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
- Zod `^4.6.7` for AI-output, workflow-step, and `rasq-desktop.v1` contracts.
- `sharp` `0.34.5` for deterministic cropped desktop anchor PNGs and `fflate` `0.8.2` for verified desktop ZIP bundles.
- Isolated `desktop-agent/` Electron `43.3.0` / RobotJS `0.9.1` package with TypeScript, esbuild, and a mock driver.
- `unpdf` for server-side PDF text extraction.
- `lucide-react` for icons.
- `pg`, `@types/pg`, and `dotenv` are dependencies, but the reviewed runtime path uses libsql/SQLite rather than PostgreSQL.
- `package.json` still has the starter name `nextjs-postgresql-template` and now carries `version` `1.1.0`; UI metadata and runtime behavior identify the app as RASQ-Ai. `src/lib/version.ts` exports the same value as `APP_VERSION` for the sidebar, the root metadata (`<meta name="version">`) and `/api/health`; `tests/version.test.ts` fails when it drifts from `package.json` or `package-lock.json`. `desktop-agent/` is versioned separately and remains `0.1.0`.

Playwright, libsql, and unpdf are listed in `serverExternalPackages` in `next.config.ts`. Server Actions have a configured 50 MB body limit, although the reviewed features primarily use route handlers rather than Server Actions.

### Source map

| Path | Responsibility |
|---|---|
| `src/app/layout.tsx` | Root HTML/body shared by the app and `/demo-target`; the body keeps its original fixed light classes |
| `src/app/globals.css` | Tailwind import, `--rq-*` token-to-utility mapping (`@theme inline`), `.rq-app`-scoped base styles, `rq-glass`, React Flow variable mapping |
| `src/app/(app)/layout.tsx` | Shared application shell; emits the preset theme tokens and the first-paint theme script for app pages only |
| `src/components/Shell.tsx` | `.rq-app` theme wrapper, glass navigation, project selector, version label, sidebar theme picker |
| `src/components/ui.tsx` | Client API helper, project context, token-based UI primitives (`Card`, `Btn`, `Badge`, `Notice`, `inputCls`) |
| `src/components/ThemePicker.tsx` | `useTheme` browser store, `ThemeEffect` (applies the theme to `<html>`), theme picker UI |
| `src/components/ModelPicker.tsx` | Per-task model route selector |
| `src/components/DesktopRunPanel.tsx` | Desktop compiler preview/export, agent selection, confirmation, cancellation, live preview |
| `desktop-agent/` | Isolated secure Electron shell, fixed manifest runner, Windows/mock drivers, headless mock controller, packaging/target |
| `src/lib/agentAuth.ts` | External-agent API keys: `rasq_…` generation, SHA-256 hash storage, scope catalog, `resolveActor`/`authorize`/`requireOperator`, per-process rate limiter |
| `src/lib/audit.ts` | Append-only `audit_log` writer (best-effort; never throws into the request) |
| `src/lib/idempotency.ts` | `Idempotency-Key` begin/store for `POST /api/runs`, `POST /api/tests`, `POST /api/workflows` (24h TTL) |
| `src/lib/openapi.ts` + `src/app/api/openapi.json/route.ts` | Hand-maintained OpenAPI 3.1 public discovery document with per-operation `x-rasq-scope` |
| `src/app/api/agent-keys/route.ts` | Operator-only key mint/list/revoke; plaintext returned once |
| `scripts/create-agent-key.ts` | Shell bootstrap for keys (`npm run agent:key`) |
| `AGENT_GUIDE.md`, `public/llms.txt` | External-agent guide (threat model, scopes, recipes, errors, safety rules) and LLM entry point |
| `src/lib/webhooks.ts` | Stripe-style signed outbound webhooks for terminal run events (`run.completed`, `desktop.run.completed`, `performance.run.completed`, `webhook.test`); best-effort in-process delivery, 0s/+2s/+10s retry, every attempt recorded |
| `src/lib/performanceService.ts` | Shared `failStalePerformanceRuns()` / `notifyPerformanceRunCompleted()` used by the performance routes (deduplicated from inline copies) |
| `src/app/api/webhooks/route.ts` + `[id]/test/route.ts` + `deliveries/route.ts` | Operator-only webhook CRUD, synchronous synthetic `webhook.test` delivery, and delivery history |
| `src/mcp/server.ts` (`npm run mcp`) | stdio MCP server: thin HTTP adapter exposing read + safe-generation tools; no second auth path, no destructive/attending/load tools |
| `src/lib/rateLimit.ts` | Database-backed fixed-window rate limiter (`usage_counters`); per-key UTC-day mutation budgets; fail-closed 503 on limiter failure |
| `src/lib/projectAccess.ts` | Tenancy-lite: `projectAllowed`/`filterProjects`/`projectDeny` and project resolvers for workflows/runs/plans/docs/reports/screens/recordings; foreign artifacts answer 404 |
| `src/lib/retention.ts` + `scripts/retention-sweep.ts` (`npm run retention`) | Configurable retention sweeps for audit_log/idempotency_keys/webhook_deliveries/usage_counters |
| `src/app/api/audit/route.ts` | Operator-only audit query/export (`format=json|csv`, filters, ≤1000/10k caps, formula-injection-safe CSV) |
| `GUARDRAILS.md` | Non-negotiable domain guardrails and their trade-offs |
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
| `src/lib/ai.ts` | Mission, policies, task-route resolution, redaction, common model entry point, provenance |
| `src/lib/aiContract.ts` | Protocol catalog, provider-config Zod schema, canonical `rasq-ai.v1` request types |
| `src/lib/aiProtocols.ts` | OpenAI/Anthropic/Gemini adapters and generic JSON templates, headers, endpoints, response paths |
| `src/lib/opencodeGo.ts` | Shared OpenCode Go chat-completions provider preset for fresh seed and existing-database UI form |
| `src/lib/performance.ts`, `performanceRunner.ts` | Restricted REST plan/Zod, JMX renderer, SLA/JTL analysis; bounded single-server JMeter CLI execution |
| `src/lib/srs.ts` | Requirement parsing/classification and deterministic local test design |
| `src/lib/cases.ts` | Test-case loading with requirement keys |
| `src/lib/n8n.ts` | Workflow generation/validation and n8n ↔ ReactFlow conversion |
| `src/lib/runner.ts` | URL guard, screenshot capture, Playwright visual actions/assertions, run persistence |
| `src/lib/desktopContract.ts` | Shared strict desktop manifest, agent, event, evidence, and limit contracts |
| `src/lib/desktopCompiler.ts` | Sequential graph/source validation, deterministic desktop manifest and anchor crops |
| `src/lib/desktopScript.ts` | Fixed portable RobotJS source template generated from the same manifest |
| `src/lib/desktopBundle.ts` | Deterministic ZIP output and safe integrity-verified extraction |
| `src/lib/desktopAuth.ts` | Enrollment bootstrap and revocable device-token authentication |
| `src/lib/desktopService.ts` | Stored compilation, stale-run handling, monotonic desktop event persistence |
| `src/lib/schemas.ts` | Zod schemas for AI responses, SRS cases, and constrained visual-only cases |
| `src/lib/screens.ts` | Shared saved-control normalization for screen creation and update-in-place editing |
| `src/lib/visualCases.ts` | Deterministic positive P2 interaction cases from saved visual controls |
| `src/lib/types.ts` | Shared control/task/action/category/priority/status constants |
| `src/lib/theme.ts` | Pure theme engine: theme IDs, `--rq-*` token generation with WCAG contrast fitting and audit, stored-preference parsing, first-paint script |
| `src/lib/version.ts` | `APP_VERSION`, kept equal to the `package.json` version by a test |
| `src/lib/api.ts` | `ok`, `fail`, `body`, async route `Params` helpers |
| `src/db/schema.ts` | Eighteen Drizzle tables and relationships, including desktop agents/events and desktop run metadata |
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
- App pages and shared primitives take every colour from the theme tokens below; they contain no fixed palette classes such as `slate-*` or `indigo-*`.

### Appearance and themes (1.0.0)

The app UI is glassmorphic (translucent `rq-glass` panels over a tinted aurora backdrop) and has four themes, chosen per browser:

| Theme ID | Label | Source of colours |
|---|---|---|
| `dark-purple` | Dark purple (default) | Preset: background `#0e0a1f`, accent `#7c3aed` |
| `light-purple` | Light purple | Preset: background `#f1ecff`, accent `#7c3aed` |
| `custom` | Custom colors | User-chosen accent and background (defaults `#2dd4bf` on `#071a1f`) |
| `contrast` | Random high contrast | Seeded random palette, dark or light; **Shuffle colors** picks a new seed |

- **Tokens:** `buildTheme` in `src/lib/theme.ts` turns an accent, a background and a level into 59 `--rq-*` custom properties. `globals.css` exposes the colour tokens as Tailwind utilities of the same name (`text-ink`, `text-muted`, `text-faint`, `bg-raised`, `bg-field`, `border-line-strong`, `bg-ok-soft`, `text-danger-ink`, …). Use those utilities; do not add colour opacity modifiers, fixed palette colours or `opacity` on text, because the guarantee below is computed for the token set only.
- **Contrast guarantee:** because surfaces are translucent, each text token is fitted against the worst case of every surface stack the UI may compose. That contract (bases, one area fill, one item fill) is documented on the `Paint` type. Standard themes keep every text token at WCAG AA (at least 4.5:1); the random theme keeps them at AAA (at least 7:1) and additionally keeps solid fills and control borders at 3:1 or more against adjacent surfaces. `muted` and `faint` are only guaranteed on quiet surfaces, so secondary text never goes inside badges, notices or status-tinted rows. `rq-glass` panels are not nested. A disabled `Btn` is a dashed outline with `text-muted`, not a faded button.
- **Graceful degradation:** when a custom pair leaves too little contrast, the engine fades the backdrop glow and surface tints and moves text toward pure black or white instead of emitting unreadable text; the chosen background itself is kept. Unusable stored or typed values fall back to defaults. Without `backdrop-filter`, or with `prefers-reduced-transparency: reduce`, glass panels become opaque.
- **Status colours** (`ok`, `danger`, `warn`, `info`, `review`, `orange`) come from fixed hues and never follow the accent, because they report recorded outcomes. Solid status fills are identical in every standard palette of the same mode, and status text keeps its hue in both presets and every random palette. On a mid-tone or strongly saturated custom background no saturated colour can reach 4.5:1, so status text there fades toward black or white while badge outlines stay coloured; every status is also written out as a word. The control-type overlay/legend colours on `/scan` (`COLORS`) are fixed hexes and are not themed.
- **Persistence:** `localStorage` key `rasq.theme` holds `{ v, id, custom: { accent, background }, seed, vars? }`. `vars` is only a cache that lets an inline script paint Custom and Random themes before React loads; the picker always recomputes it. The script accepts only known theme IDs and `--rq-*` properties with plain colour/length values. If the browser refuses to store the value, the choice lasts until the page is reloaded. Themes are not stored on the server or per project.
- **Scope (do not break):** every theme rule is scoped to `.rq-app`, the wrapper rendered by `Shell`, or to `html:has(.rq-app)`. Preset tokens and the first-paint script are emitted by `src/app/(app)/layout.tsx`, not by the root layout. `/demo-target` uses only the root layout and must keep rendering exactly as before: saved `locatorHash` values and run screenshots are compared against its pixels. The `html:has(.rq-app)` rule must stay outside every `@layer`, otherwise the unlayered `:root { color-scheme: light }` wins and native controls stay light in dark themes.
- **Backdrop geometry:** the three aurora glows in `.rq-app::before` must not overlap; the engine assumes at most one glow behind any point.
- **Where it is chosen:** the desktop sidebar and the **Appearance** card on `/settings` (the only entry point on narrow screens).
- **Layout parity:** the sidebar floats with a 12px outer margin; `main` gives those 12px back through its left padding and width cap (`md:pl-4`, `md:max-w-[1488px]`), so the content box keeps the position and width it had before the redesign.
- **Tests:** `tests/theme.test.ts` checks the thresholds for the presets, a grid of custom pairs and 300 random seeds, re-measures emitted CSS with independent colour math, and covers the status-colour rules, preference parsing, the first-paint whitelist, token/utility parity, the scoping rules above and the glow geometry.

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

### Browser checks when Playwright's download is blocked

Some sandboxes reach the npm registry but not Playwright's download host, and lack Chromium's system libraries. There `npx playwright install chromium` ends with `Failed to download Chrome for Testing`, and the app reports "Chromium for Playwright is not available on this server". The npm package `@sparticuz/chromium` bundles a Chromium build with the libraries it needs and serves as a stand-in **for verification only**. The two steps below were run from an empty sandbox on 2026-11-11 (Debian 12 x64, Node 22, Playwright 1.65.0).

**1. Unpack the browser outside the repository.**

```bash
mkdir -p /tmp/rq-browser && cd /tmp/rq-browser && npm init -y && npm install @sparticuz/chromium@153.0.0
AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x node --input-type=module \
  -e 'import c from "@sparticuz/chromium"; console.log(await c.executablePath())'
```

This writes `/tmp/chromium` with its SwiftShader libraries, `/tmp/al2023/lib` and `/tmp/fonts`. The variable is what makes the package unpack the system libraries. If `/tmp/chromium` already exists without `/tmp/al2023/lib`, delete it and run the command again, because an existing binary skips the unpacking.

**2. Put a launcher where Playwright expects its headless browser.** The path is the one named in the "Executable doesn't exist at …" error; this is the path for Playwright 1.65.0.

```bash
r=~/.cache/ms-playwright/chromium_headless_shell-1254
mkdir -p "$r/chrome-headless-shell-linux64"
printf '%s\n' '#!/bin/bash' \
  'export LD_LIBRARY_PATH=/tmp/al2023/lib FONTCONFIG_PATH=/tmp/fonts' \
  'exec /tmp/chromium "$@" --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader' \
  > "$r/chrome-headless-shell-linux64/chrome-headless-shell"
chmod +x "$r/chrome-headless-shell-linux64/chrome-headless-shell" && touch "$r/INSTALLATION_COMPLETE"
```

Without the `INSTALLATION_COMPLETE` marker, a later `npx playwright install` attempt deletes the launcher.

After that, Playwright's default headless launch works unchanged for the app's URL capture and runs (`src/lib/runner.ts`) and for scripts. A script kept outside the repository can load the repository's Playwright with `createRequire("<repo>/package.json")("playwright")` and call `chromium.launch()`.

- **Different browser:** this is Chromium 153, while Playwright 1.65.0 pins Chrome for Testing 158. It renders in software and has one font family (Open Sans), so line breaks differ from a user's machine, monospace text is drawn in Open Sans, and emoji, CJK and Arabic text are not drawn at all. Name it in the report; it does not replace a check in a normally installed browser.
- **Pixel comparisons:** compare screenshots only when both sides come from this same setup, viewport and scale factor. With the three SwiftShader arguments, 40 of 40 captures of `/demo-target` were byte-identical; with only the app's own launch arguments, 2 of 48 differed.
- **Reference for `/demo-target`:** on the production build of `30fcac1`, a viewport PNG at scale factor 1 taken 900 ms after `networkidle` has sha256 `5e53240a2235b043a84913015b6798100774350741e012e0f33b385985251a0f` at 1440×900 and `2dcafaab11b12c22ede3e020c7e9421f2868cd1e1a07c95c59602aaced6728a6` at 1280×800; `POST /api/capture` returns the same bytes. If a capture differs, capture the base commit in the same sandbox before concluding that the page changed.
- **Themes in scripts:** write the preference to `localStorage` before the page loads, for example `context.addInitScript(() => localStorage.setItem("rasq.theme", '{"id":"light-purple"}'))`. Add `custom` or `seed` for the custom and random themes; the format is under **Appearance and themes**.
- **Housekeeping:** none of this belongs in the repository or is needed where `npx playwright install chromium` works. `/tmp` and `~/.cache` can be emptied between sessions; repeat both steps then.

### Available scripts

| Command | Actual script |
|---|---|
| `npm run dev` | `next dev` |
| `npm run build` | `next build` |
| `npm run start` | `next start` |
| `npm run lint` | `eslint .` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `tsx --test tests/*.test.ts` |
| `cd desktop-agent && npm run typecheck` | Agent TypeScript checks |
| `cd desktop-agent && npm test` | Mock-driver safety tests |
| `cd desktop-agent && npm run build` | esbuild main/preload/headless bundles with Electron/RobotJS external |
| `cd desktop-agent && npm run package:win` | Windows-only unsigned development ZIP staging; not a signed installer |

Focused web and agent tests are checked in; no CI configuration was added. `npm test` picks up every `tests/*.test.ts`, including the theme-engine, version, and agent-surface tests (`tests/agentSurface.test.ts`). At the 1.1.0 snapshot, 47 tests pass, lint retains the eight existing unused-disable warnings, and the production build passed.

`npm run build` rewrites the tracked `next-env.d.ts`, because the committed copy points at the development type folder (`.next/dev/types`) and a production build points it at `.next/types`. Restore it with `git checkout -- next-env.d.ts` before committing.

### Environment and storage

| Setting | Meaning |
|---|---|
| `RASQ_DB_URL` | Optional database URL; default `file:./data/rasq.db` |
| `PORT` | Used by Next.js and by RASQ-Ai when resolving relative target URLs |
| `OPENAI_API_KEY` | Optional secret referenced by the seeded OpenAI provider |
| `ANTHROPIC_API_KEY` | Optional secret referenced by the seeded Anthropic provider |
| `GEMINI_API_KEY` | Optional secret referenced by the seeded Gemini provider |
| `OPENROUTER_API_KEY` | Optional secret referenced by the seeded OpenRouter provider |
| `OPENCODE_API_KEY` | Optional server secret referenced by OpenCode Go; not needed for Local |
| `RASQ_JMETER_ALLOWED_ORIGINS` | Required to run REST load tests: comma-separated exact HTTP(S) origins; empty by default |
| `RASQ_DESKTOP_ENROLLMENT_TOKEN` | Required on the control plane to enable one-time desktop enrollment |
| `RASQ_CONTROL_URL` | Agent/headless-mock control-plane base URL; plain HTTP only for loopback development |
| `RASQ_DEVICE_TOKEN` | Optional previously enrolled agent credential; otherwise the agent can enroll |
| `RASQ_DESKTOP_DRIVER` | `mock` for safe tests; omitted selects the real RobotJS driver |
| `RASQ_AGENT_RATE_LIMIT` | Optional per-process mutation budget per agent key per minute; default `120` |

No API key is needed for the default Local engine. The seeded Ollama provider has an empty key-env name and defaults to `http://127.0.0.1:11434/v1`; selecting it still uses the provider/model-call path.

The database stores only environment-variable **names**. `.env` is ignored, and no `.env.example` is checked in. Do not place actual key values in provider rows or documentation.

Local artifacts live below `data/`, which is ignored:

```text
data/rasq.db                 default database
data/recordings/<uuid>.webm|mp4
data/screens/<uuid>.png|jpg|webp
data/runs/<runId>/<position>.jpg
data/runs/<runId>/desktop-<sequence>-<before|after|preview>.png
data/desktop/bundles/<runId>.zip
```

`getDb()` enables foreign keys, applies `drizzle/` migrations, and seeds once per process. The database client and readiness Promise are cached on `globalThis`. Initialization resets its cached Promise after failure so a later request can retry.

`seed()` returns immediately if any project already exists. On an empty database it creates:

- `RASQ Demo Storefront` (`web`, target `/demo-target`) and `Citrix Claims Desktop` (`citrix`).
- OpenAI, Anthropic, Gemini, OpenRouter, Ollama, and OpenCode Go provider catalog entries. Go uses the OpenAI-compatible chat-completions endpoint and a curated text-model list from the Go documentation. On existing databases seeding still returns early; `/settings` offers a preset to fill the Add provider form instead.
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
| `/scan` | Record/upload/capture; save controls; reopen recording or individual screen scans and update them in place |
| `/requirements` | Add PDF/MD/TXT or pasted SRS; inspect documents, criteria, and ambiguity |
| `/tests` | Generate from SRS or selected saved scans, filter cases, view matrix, export CSV/JSON, convert displayed cases to n8n |
| `/performance` | Select a scenario and requirements across docs, create/edit restricted JSON REST JMeter plan, approve run, cancel and inspect observed SLA analysis |
| `/workflows` | Open a converted workflow by `?workflow=<id>`, generate/import/edit/export, dry-run or execute, inspect evidence |
| `/reports` | Generate and download evidence-based Markdown reports, including separate recorded JMeter REST metrics and needs-review SLA notes |
| `/settings` | AI data-sharing switch, per-task models, built-in/generic provider catalog and JSON protocol editor, policies, Appearance (theme picker) |
| `/demo-target` | Safe synthetic checkout target; no real payment processing. Deliberately outside the themed shell: it always renders its original light design |

The selected project ID is stored in browser `localStorage` under `rasq.project`. The provider prefers the first web project when there is no valid saved selection. The selected theme is stored under `rasq.theme` (see **Appearance and themes**).

### API routes

The `ok` helper returns the supplied JSON payload directly, not wrapped in a `data` property. The `fail` helper returns `{ "error": string }`, optionally with a machine-readable `"code"` (additive).

**External-agent access (1.1.0):** every route except `/api/health` and `/api/openapi.json` requires either the single-operator browser session (no `Authorization` header; UI unchanged) or a scoped `Bearer rasq_…` API key. A present-but-invalid credential is `401 invalid_api_key` (never operator fallback); a missing scope is `403 insufficient_scope`; agent mutations over `RASQ_AGENT_RATE_LIMIT` are `429 rate_limited`; every agent/operator mutation is recorded in the append-only `audit_log` table. The device-authenticated routes (`/api/desktop/agents/enroll`, `…/poll`, `…/bundle`, `…/events`, `…/evidence`) keep their device-token auth and are not scope-gated. Scope-per-route is enforced in each handler via `authorize()` (`src/lib/agentAuth.ts`); `/api/runs` selects between `runs:start:dry-run` and `runs:start:playwright` by the requested `mode`. `POST /api/runs`, `POST /api/tests`, `POST /api/workflows` honor `Idempotency-Key` (24h replay of 2xx bodies with `idempotent-replay: true`; different body → `409 idempotency_conflict`). `/api/agent-keys` is operator-only; agents may not mint, list, or revoke keys. `GET /api/openapi.json` is the public discovery document. **Wave C (1.2.0):** operator-only `POST|GET|PATCH|DELETE /api/webhooks` manage outbound webhook endpoints (per-endpoint `whsec_…` secret shown once, HMAC-SHA256 `x-rasq-signature` over `<unix-ts>.<rawBody>`, stable `{id,type,createdAt,data}` envelope, `POST /api/webhooks/{id}/test` for a synthetic `webhook.test`, `GET /api/webhooks/deliveries` for attempts). Delivery is best-effort in-process and never blocks a run; terminal events only (`run.completed`, `desktop.run.completed`, `performance.run.completed`); stale in-process runs (desktop, Playwright ≥30 min, performance >120 s) are marked `error` by the list/poll endpoints and fire the matching webhook. `npm run mcp` starts a stdio MCP adapter over the same HTTP API (RASQ_AI_URL + RASQ_API_KEY) exposing health/projects/requirements/screens/test-cases/workflows/runs/reports reads, `tests:generate` and `runs:start:dry-run`; no destructive, attending or load tools. Webhook management is operator-only like key management — agents cannot register or reconfigure receivers. **Wave D (1.3.0):** rate limiting and per-key daily mutation budgets are database-backed (`usage_counters`) and fail closed (`503 rate_limiter_unavailable`); `GET /api/audit` is an operator-only audit query/export (`format=json|csv`); `npm run retention` prunes bounded stores on configurable windows; agent keys may carry a `project_ids` partition (foreign-project artifacts answer 404, lists filter silently; `POST /api/projects` → `403 scoped_key`). See `AGENT_GUIDE.md` §12.

| Route | Methods and behavior |
|---|---|
| `/api/health` | `GET`: database `select 1`; returns `{ ok, engine, app, version }` (public) |
| `/api/openapi.json` | `GET`: public OpenAPI 3.1 discovery document; no secrets |
| `/api/agent-keys` | `GET`/`POST`/`DELETE`: operator-only API-key list/mint/revoke; plaintext key returned once on create |
| `/api/projects` | `GET`: all projects; `POST`: create with validated surface fallback |
| `/api/settings` | `GET`: AI mode, providers plus key-configured flags, routes, policies; `PUT`: update mode/route/policy |
| `/api/providers` | `POST`/`PATCH`: validate protocol, endpoint, key-env name, models, and declarative JSON config; `DELETE?id=`: remove and reset routes using it |
| `/api/capture` | `POST`: Playwright screenshot returned as PNG data URL |
| `/api/ai/scan` | `POST`: enrich supplied candidates/image using `visual_scan`; Local selection returns HTTP 409 |
| `/api/recordings` | `GET[?projectId=]`; multipart `POST`: save recording and SHA-256 metadata |
| `/api/recordings/:id` | `GET`: binary recording; `DELETE`: file and row |
| `/api/screens` | `GET[?projectId=&recordingId=]`: screens with controls; `POST`: save image/controls and return persisted control IDs |
| `/api/screens/:id` | `GET`: binary image; `PUT`: update metadata/controls while retaining unchanged control IDs; `DELETE`: image and row |
| `/api/requirements` | `GET?projectId=`; multipart `POST`: parse/extract/persist; `DELETE?docId=` |
| `/api/tests` | `GET?projectId=`; `POST`: generate from `source: requirements|visual`, with optional screen selection and replace behavior; `DELETE?id=` or `?projectId=` |
| `/api/tests/export` | `GET?projectId=&format=csv|json`: download cases |
| `/api/performance` | `GET?projectId=`: plans, project scenarios/requirements, run history; `POST`/`PUT`: validated plan create/update; `DELETE?id=`: delete plan/history when not active |
| `/api/performance/runs` | `POST`: confirmed asynchronous CLI run (202, ID); `GET?id=`: poll status/analysis; `DELETE?id=`: cancel active process-local run |
| `/api/workflows` | `GET[?projectId=]`; `POST`: `generate`, `import`, or `blank` |
| `/api/workflows/:id` | `GET`; `PUT`: validate/save and increment version; `DELETE` |
| `/api/workflows/:id/export` | `GET`: saved n8n JSON download |
| `/api/runs` | `GET[?workflowId=]`; `POST`: start Playwright/dry run, HTTP 202 with run ID |
| `/api/runs/:id` | `GET`: run and ordered steps |
| `/api/runs/:id/shots/:file` | `GET`: constrained numeric Playwright JPEG or desktop before/after/preview PNG path |
| `/api/desktop/agents` | `GET`: sanitized agents/online state; `DELETE?id=`: revoke and terminate assigned active runs |
| `/api/desktop/agents/enroll` | `POST`: bootstrap-token enrollment; returns a device token once and stores only its hash |
| `/api/desktop/agents/poll` | Device-authenticated `POST`: heartbeat/capabilities and outbound run assignment/confirmation/cancellation state |
| `/api/desktop/workflows/:id` | `POST`: compiler manifest/diagnostics; `GET` with target query: deterministic RobotJS ZIP export |
| `/api/desktop/runs` | `POST`: compile and reserve an agent/display/target for attended or dry-run execution |
| `/api/desktop/runs/:id/bundle` | Assigned-agent `GET`: integrity-checked run ZIP |
| `/api/desktop/runs/:id/confirm` | `POST`: authorize input after no-input preflight |
| `/api/desktop/runs/:id/cancel` | `POST`: request browser cancellation; queued runs finish immediately |
| `/api/desktop/runs/:id/events` | Assigned-agent `POST`: bounded, contiguous, idempotent session/step/complete events |
| `/api/desktop/runs/:id/evidence` | Assigned-agent `POST`: size/hash-checked PNG preview and before/after evidence |
| `/api/reports` | `GET[?projectId=]`; `POST`: generate/persist report; `DELETE?id=` |
| `/api/reports/:id` | `GET`: Markdown attachment |

The client `api<T>()` helper sends JSON when given `json`, defaults such requests to `POST`, parses text/JSON responses, and throws the server-provided error message for non-2xx responses. Multipart uploads use `fetch` directly.

---

## 5. Persistence model

`src/db/schema.ts` defines eighteen pre-existing tables plus two performance tables, since 1.1.0 three agent-surface tables (`api_keys`, `audit_log`, `idempotency_keys`) via migration `0004_agent_surface.sql`, since 1.2.0 two webhook tables (`webhooks`, `webhook_deliveries`) via migration `0005_webhooks.sql`, and since 1.3.0 `usage_counters` plus `api_keys.project_ids`/`daily_mutation_limit` via migration `0006_governance_tenancy.sql`:

| Table | Key fields and relationships |
|---|---|
| `projects` | Root project; `surface`, `targetUrl`, description |
| `ai_providers` | Protocol, base URL, key-env name, JSON model list, declarative protocol `config`, enabled flag; no credential value |
| `model_routes` | Task primary key; nullable provider means Local |
| `settings` | Key/value settings, including `aiMode` |
| `policies` | Named, prioritized, enableable system-policy text |
| `desktop_agents` | Revocable device identity/token hash, OS/arch/version/protocol, capabilities/displays/permissions, availability/current run/heartbeat |
| `recordings` | Project FK cascade; file metadata and SHA-256 |
| `screens` | Project FK cascade; recording FK `set null`; source dimensions, image path, grouping/provenance |
| `controls` | Screen FK cascade; type, label, integer region, confidence, evidence, dHash, separate perception/AI provenance |
| `requirement_docs` | Project FK cascade; full extracted text, SHA-256, analysis model |
| `requirements` | Document FK cascade; exact `reqKey`, text, JSON acceptance criteria, category, ambiguity |
| `test_cases` | Project FK cascade; case key, category/priority, JSON preconditions/data/steps/assumptions, provenance |
| `test_traceability` | Composite PK on test case + requirement; both FKs cascade |
| `performance_plans` | Project FK cascade; nullable case FK set-null so scenario regeneration preserves run history but blocks execution until relinked; restricted JSON REST plan and selected requirement IDs |
| `performance_runs` | Plan FK cascade, status, snapshot of measured metrics/threshold sources and notes, sanitized error/timestamps; no raw JTL |
| `workflows` | Project FK cascade; n8n JSON, provenance, version, timestamps |
| `runs` | Workflow FK cascade; executor/mode/status/target/error/summary/timestamps plus desktop agent/driver/session/bundle/target/preview/confirmation/cancellation/event sequence |
| `run_steps` | Run FK cascade; ordered node snapshot, status/message/duration/evidence JSON |
| `desktop_events` | Run FK cascade; agent ID, unique run+sequence, session/step/complete payload, timestamp; no frame streams |
| `reports` | Project FK cascade; generated Markdown and provenance |
| `api_keys` | External-agent credentials: SHA-256 `key_hash` (unique), display `key_prefix`, JSON `scopes`, optional JSON `project_ids` partition (empty = all projects) and `daily_mutation_limit`, `expires_at`/`revoked_at`/`last_used_at`; plaintext never stored |
| `audit_log` | Append-only `actor_type`/`actor_id`/`actor_name`, `action` (`METHOD /path`), `status` (`ok`/`denied`), truncated `detail`, `ip`; indexed on `created_at` |
| `idempotency_keys` | Primary key (`actor`, `key`); `endpoint`, `body_hash`, stored status/response for 24h replay of 2xx outcomes |
| `usage_counters` | Fixed-window rate-limit / daily-budget counters keyed by (`key_id`, `period` (`minute`/`day`), `bucket`); cascade on key delete |
| `webhooks` | Outbound endpoints: `name`, `url`, per-endpoint `whsec_…` signing secret, JSON `events` subscription list, `enabled`, `last_delivery_at`/`last_status` |
| `webhook_deliveries` | Attempt log: `webhook_id` FK (cascade), `event_type`, `status` (`ok`/`failed`), nullable `http_status`, truncated `error`, `attempt`, indexed on (`webhook_id`, `created_at`) |

IDs default to `crypto.randomUUID()`; creation timestamps default in application code. SQLite JSON columns carry TypeScript types through Drizzle.

Migration `0003_performance_plans.sql` adds both performance tables. Migration `0005_webhooks.sql` adds `webhooks` and `webhook_deliveries`. Migration `0006_governance_tenancy.sql` adds `usage_counters` and the `project_ids`/`daily_mutation_limit` columns on `api_keys` (fresh databases apply it through the migrator; migration tests exercise the fresh path). Migration `0004_agent_surface.sql` (hand-written for the same drizzle-kit constraint) adds `api_keys`, `audit_log` and `idempotency_keys` plus their indexes, with a hand-built `0004_snapshot.json` chained to the `0003` snapshot and a journal entry; fresh databases apply it cleanly through the migrator and the existing migration tests exercise the fresh path. The repository-pinned drizzle-kit 0.18.1 cannot generate against ORM 0.45.x and modern drizzle-kit cannot parse the existing v6 snapshot, so additive migrations, journals and snapshots are created deliberately without rewriting applied migrations. JMeter temporary files under ignored `data/jmeter/<runId>/` are removed after each run. Database cascades and file deletion are separate concerns. Recording and screen DELETE handlers explicitly remove their files. Workflow deletion cascades run rows, but the reviewed handler does not remove the corresponding `data/runs/<runId>/` screenshot directories.

For schema changes, update `src/db/schema.ts` and generate a new migration:

```bash
npx drizzle-kit generate
```

`drizzle.config.json` uses SQLite dialect, `src/db/schema.ts`, `drizzle/`, and `file:./data/rasq.db`. Migration `0001_ai_provider_protocol_config.sql` adds the non-null JSON `ai_providers.config` column with `{}` as the legacy/default value. Migration `0002_desktop_agent.sql` adds desktop agents/events and desktop run metadata while defaulting existing runs to Playwright. Fresh and pre-0002 upgrade paths are exercised through Drizzle's migrator in `tests/desktopMigration.test.ts`.

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

`callModel` delegates every feature call to `callProtocolProvider`. The gateway first builds a canonical `rasq-ai.v1` request containing model, system instructions, user messages, optional base64/MIME images, and JSON response format, then adapts it to:

- OpenAI-compatible `POST /chat/completions`, JSON response format, optional bearer key, data-URL images. OpenCode Go's seeded/preset base URL is `https://opencode.ai/inference/go/openai/v1`, with `OPENCODE_API_KEY` and documented chat-completions model IDs; its other API families are not included. Calls to HTTPS `opencode.ai/inference/go/` (including existing provider rows) gain a RASQ-Ai user agent and an opaque random `ses_`-prefixed `x-opencode-session` header. The ID is kept in server-process memory and reused for later Go calls in that process; it is not conversation-scoped, does not persist across restarts/instances, and is not stored in database/browser/logs. No other provider endpoint gains the header. Go is intended for coding-agent traffic; live compatibility beyond the reported missing-header error, model-specific image/JSON support, and Go usage-policy fit for RASQ-Ai have not been validated.
- Anthropic `POST /v1/messages`, base64 image blocks, 8192 max tokens.
- Gemini `:generateContent`, JSON MIME response configuration, inline base64 images.
- Generic REST/JSON with a full endpoint, optional `{{model}}`, POST/PUT/PATCH, custom headers, typed declarative request templates, response paths, and timeouts.

Generic templates support model/system/user/messages/images/responseFormat/standardRequest placeholders. They are JSON data only and reject unknown placeholders or API-key use outside headers. `ProviderConfigSchema` limits config size, headers, nesting, methods, and timeout. Common authentication headers must reference `{{apiKey}}`, which resolves only from the named server environment variable.

Calls default to `AbortSignal.timeout(180_000)` and can be configured from 1,000 to 300,000 ms. Generic response text is extracted through dot/index paths such as `output.text` or `result.items[0].text`; built-ins retain their established extraction paths. `parseJson` then tolerates Markdown fences and extracts the outermost object before route-specific Zod/domain validation. Provider errors are truncated and scrub the configured key. The full contract is in `AI_API_JSON_INTEGRATION.md`.

### Task-specific behavior

- **Visual scan:** requires a non-Local provider. Sends at most 120 candidates; accepts known candidate IDs only, and at most 30 in-bounds missed controls. Candidate coordinates cannot be changed by AI.
- **Document analysis:** local parser always runs first. AI receives at most 60,000 redacted characters. Returned IDs not literally present in source text are rejected.
- **Test scenarios:** SRS mode processes requirements in batches of six and receives at most 150 bindable controls. Visual mode processes saved controls in batches of 50, requires positive P2 cases with empty requirement IDs, a navigate/assert envelope, and supplied control IDs on every interaction. Malformed or unbound cases are dropped with warnings; textual data is redacted.
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
input, button, dropdown, date_picker, checkbox, toggle, slider, upload, download,
text, w_button, w_text, s_input, p_input, p_button, h_button, timer, gesture_arena
```

`text`, `w_text`, `timer`, and `gesture_arena` are review-only subjects until an explicit oracle/pattern exists; visual cases never click them. `s_input` is a composite search field/icon/button anchor and `p_input` uses a vault placeholder. `p_button` and `h_button` generate bounded `hold` and `hover` actions (default 1000 ms, allowed 100–10000 ms in both runners). AI enrichment may classify these types from explicit visible evidence, while local geometry does not claim semantic/font/realtime detection.

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
- **Edit saved** on a recording loads all associated saved screens; the pencil action on a saved screen loads just that screen. Labels, types, names, and included controls can be changed without rescanning pixels.
- `PUT /api/screens/:id` updates the existing row rather than duplicating it. Create/update responses return persisted controls, and the client adopts server IDs for new controls so repeated saves preserve unchanged anchor IDs used by scenarios/workflows. **Rescan** remains a separate fresh frame-analysis path.

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

### Visual-only local cases

`designVisualCases` creates one positive P2 interaction case per selected saved control. Each case starts with `navigate`, binds its interaction to the saved control ID, and ends with an observable-outcome `assert`. Control types map to type/click/select/check/toggle/slider/upload/download as appropriate; inputs use synthetic fixtures and password-like labels use vault placeholders.

These cases deliberately have no requirement IDs and do not imply business-rule, negative, boundary, or security coverage. Low-confidence anchors and manual-review limitations are recorded as assumptions. Visual generation appends by default so it does not erase SRS-based cases.

### Generation and traceability

`POST /api/tests` accepts `projectId`, `source` (`requirements` by default, or `visual`), optional `docId`, optional `screenIds`, and optional `replace`.

- SRS Local mode designs cases for every requirement in the selected document; visual Local mode designs cases for every control on selected saved screens. An omitted/empty screen selection means all project screens.
- AI mode validates SRS cases with `AiTestCaseSchema` and visual cases with `AiVisualTestCaseSchema`, renumbers steps, validates control IDs, and redacts generated data.
- SRS generation defaults to replacement: **all existing test cases for the project are deleted** before insertion. Visual generation defaults to append (`replace ?? !visual`).
- Case keys are assigned as `TC-001`, `TC-002`, etc. Appending starts after the highest existing numeric key rather than using row count, so deletions do not cause collisions.
- SRS requirement links are persisted in `test_traceability`; a case can link to many requirements and vice versa. Visual-only cases intentionally have no link rows and display as “Visual only.”
- CSV export quotes fields; JSON export removes internal row ID/project/creation fields but retains requirement keys and provenance.

---

## 9. Workflow and execution contracts

### n8n-shaped workflow model

Generated workflows begin with Manual Trigger and Open Target, followed by a no-op section and ordered steps for each selected case. Default viewport is 1280×800.

The Test Scenarios page can convert the currently displayed/filtered cases through the existing workflow generator. It saves a runnable workflow, offers its n8n JSON as a download, and deep-links to `/workflows?workflow=<id>` for the live monitor. This uses the same bindings and unresolved-anchor reporting as workflow generation on the Workflows page.

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

### Attended desktop compiler and agent

The Web Control Plane is the only owner of recordings, visual analysis, test cases, workflows, desktop manifests, and RobotJS source. `compileDesktopWorkflow` accepts exactly one connected sequential trigger path and authoritatively resolves every action control against the selected project's saved screens. Branches/joins/cycles/disconnected nodes, unknown controls, invalid bounds/timeouts, native upload/download actions, web-only `textVisible`/`urlContains` assertions, and unsupported nodes produce structured blocking diagnostics.

Supported desktop actions are `navigate`, bounded `wait`, `click`, `type`, `select`, `check`, `uncheck`, `toggle`, and `slider`. Supported assertions are `screenshotChanged` and `manualReview`. Desktop actions always use strict anchors. `type` resolves synthetic data or an uppercase local environment-variable reference before clicking; fixture placeholders without an explicit secret reference fail compilation.

`createDesktopBundle` deterministically emits `rasq-desktop.json`, `robotjs.cjs`, a package pinning RobotJS `0.9.1`, cropped PNG anchors, SHA-256 file metadata, and generated instructions. `verifyDesktopBundle` enforces file/path/count/byte limits, contract parsing, file hashes, and required anchors. The fixed agent runner consumes the manifest; the generated script is a portable export, not downloaded code evaluated by the agent. The portable script defaults to dry-run and explicitly lacks OS window verification/focus.

Desktop agents enroll with `RASQ_DESKTOP_ENROLLMENT_TOKEN`, receive a random device token stored by the server only as SHA-256, and poll outbound every 750 ms. No inbound agent server or browser-to-localhost call is used. The Electron renderer is sandboxed with Node integration disabled and narrow preload IPC. Local Stop and Ctrl/Command+Alt+Shift+F12 request emergency stop.

Desktop session states are `queued → assigned → preflight → awaiting-operator-confirmation → running → completing → terminal`, with cancellation/disconnect/error paths. Attended input starts only after web confirmation. RobotJS capture is display-aware and image search must return exactly one match. The real driver is limited to Windows x64 and uses a fixed PowerShell/Win32 exact-foreground-window adapter. The mock driver follows the same transport/preflight/confirmation paths without OS input.

Run events are schema validated, contiguous, unique per run/sequence, and immutable after terminal completion. Invalid payloads do not advance sequence numbers. PNG evidence has hash/size checks; identical replay is idempotent and altered replay fails. Heartbeat expiry/revocation produces an error and skipped unexecuted steps. Desktop screenshots use flat constrained filenames under existing run artifact storage.

Every desktop run records `desktopDriver`. Mock-attended actions become `skipped` with simulation messages, and reports exclude mock runs from real execution. Real attended reporting requires `desktopDriver: robotjs`; real Windows execution and packaged-agent behavior remain unverified in the current environment.

---

## 10. Reporting semantics

`POST /api/reports` computes persisted statistics for one project:

- Requirement total, covered/uncovered exact IDs, and ambiguity.
- Case count by category and priority.
- Screen/control counts, controls by type, and controls below 0.5 confidence.
- Workflow count, Playwright-run count, real attended RobotJS-run count, mock-simulation count, dry-run count, and latest executor/driver/status summaries.
- A requirement-to-test-case traceability table.

If there are no Playwright or real RobotJS attended runs, the report explicitly says no real test execution has been recorded and that artifact/simulation counts are not observed application results. Dry runs and `desktopDriver: mock` runs do not satisfy the executed-run count. Execution tables include executor and driver.

Optional AI receives only these computed statistics. Its executive summary, risks, and recommendations are labelled AI-authored with provenance. Reports are saved as Markdown and can be downloaded unchanged. The report does not infer a pass rate absent recorded data.

---

## 11. Known constraints and risk areas

These are current-source facts to preserve or address intentionally, not claims that the application is production-hardened:

1. **Focused tests, not full platform coverage:** compiler/migration/event tests and mock-driver safety tests are checked in, but there is no CI configuration, full browser suite, real RobotJS execution result, or packaged-agent smoke result.
2. **No auth layer:** reviewed API and page routes do not implement authentication, authorization, session handling, or tenant isolation. Project IDs are client supplied.
3. **Single-process execution:** detached in-process runs are not durable, scheduled, horizontally coordinated, or restart-safe.
4. **Local operational state:** SQLite/libsql plus synchronous local filesystem operations bind much of the state to one application instance/filesystem.
5. **Limited target URL guard:** HTTP(S) and a small metadata/link-local check do not constitute comprehensive SSRF protection, especially with redirects and DNS resolution.
6. **Partial input hardening:** AI outputs have Zod contracts, but API request bodies are not uniformly schema validated. The 15 MB limit is specific to SRS files; recording and image request limits are not equivalently explicit in handlers.
7. **Redaction is textual and heuristic:** images are not sanitized, and regexes cannot guarantee removal of all secrets or personal data.
8. **Filesystem cleanup is incomplete for run evidence:** deleting a workflow cascades database runs/steps but does not delete run screenshot directories in the reviewed handler.
9. **Seed is empty-database oriented:** adding seed policies/providers does not update an existing populated database automatically.
10. **SRS regeneration is broad by default:** generating from one SRS replaces the project's full case set unless `replace: false` is supplied. Visual generation appends by default; repeated visual generation can therefore create repeated interactions intentionally.
11. **Visual assertions have limited oracles:** pixel change and region change do not establish semantic correctness or exact control state.
12. **Custom n8n nodes are not stock-n8n executables:** compatibility refers to workflow JSON structure/import/export, not availability of RASQ-Ai custom nodes in n8n itself.
13. **Starter metadata remains:** the package is versioned `1.1.0`, but its name (`nextjs-postgresql-template`) and unused PostgreSQL-related dependencies do not describe the actual libsql runtime.
14. **No checked-in environment template/deployment manifest:** setup relies on source defaults and README; production topology is not defined here.
15. **License text needs deliberate handling:** `LICENSE` is not a permissive open-source license. It names PT Radius Data Solusi, states machine/usage/redistribution restrictions, and retains template/source-code language that should be reviewed rather than silently ignored or rewritten.
16. **AI gateway is synchronous:** the generic contract does not yet provide streaming, retries/failover, OAuth exchange, SigV4, mTLS, usage/cost metering, or provider health routing. Endpoint egress controls remain a deployment responsibility. See `ENTERPRISE_ROADMAP.md` for the recommended sequence.
17. **Desktop browser routes remain single-operator:** device transport is authenticated/revocable, but general browser enrollment/run/evidence routes inherit the application's missing user authZ and must not be exposed as enterprise multi-tenant APIs.
18. **Real desktop scope is narrow and unverified here:** the real driver enables only Windows x64 with PNG-enabled RobotJS. No real Windows, macOS, Linux, Citrix, VMware, mobile, or packaged-agent acceptance run has been performed. Linux native installation also hit blocked Node-header download access; `--ignore-scripts` is for mock development only.
19. **Desktop oracles/platform adapters remain limited:** there is no desktop OCR, native file-dialog, global input recorder, autonomous healing, continuous video, lock-state detection, process-signature validation, or managed VM pool. The portable script cannot focus/verify windows.
20. **Desktop polling is not a durable general worker fabric:** outbound assignment persists runs and handles stale agents, but it does not provide a general durable Playwright queue, autoscaling, session scheduling, or guaranteed recovery of an interrupted interactive desktop action.
21. **Theme contrast is a contract, not a lint rule:** the thresholds hold for the token utilities and surface stacks described under **Appearance and themes**. New UI that uses fixed palette classes, colour opacity modifiers, nested glass panels or `opacity` on text falls outside the guarantee and nothing fails automatically. Uploaded screenshots, evidence images and the fixed control-type overlay colours on `/scan` are content and are not themed. The stored theme is per browser, not per user or project.
22. **Blocked browser storage breaks the app (found during the 1.0.0 review, not changed):** when reading `localStorage` itself throws, `ProjectProvider` in `src/components/ui.tsx` fails and the shell shows the framework error page. The theme store tolerates blocked storage; the project selector does not.
23. **Narrow viewports overflow in two places (unchanged by the redesign):** with the demo data, the `/scan` editor at phone width and the `/reports` preview below about 1080px are wider than the viewport and scroll horizontally. The pages are laid out for desktop use.
24. **REST JMeter load testing is single-server and unverified with real JMeter:** only one independent JSON REST request per plan (no auth/correlation/chains); CLI must be installed on web server. `RASQ_JMETER_ALLOWED_ORIGINS` is opt-in, not a DNS-rebinding or tenant authorization control. Routes are unauthenticated; deploy only behind trusted single-operator access. Runs are in-process and can be lost on restart; stale rows are flagged after 120 seconds. Synthetic CLI fixture tests cannot validate JMeter's real JMX compatibility. Raw JTL is discarded; request bodies are screened heuristically, not with complete DLP. Performance criteria parser recognizes only explicitly quantified p95/error/throughput phrases; other wording and conflicts are needs-review. Wilson bounds assume independent samples; throughput has no confidence bound and cannot yield a confident pass. No RUM/field Web Vitals, load-scale forecasts, or distributed workers are provided.

25. **Agent surface (1.1.0) trade-offs:** the browser UI remains unauthenticated single-operator — API keys are the only machine boundary; deploys must stay behind trusted access or an outer SSO proxy. `/api/health` and `/api/openapi.json` are public by design (no data). The agent rate limiter is database-backed (usage_counters, single-node) and fails closed; it is still not a distributed limiter. `Idempotency-Key` replay is 24h and best-effort under concurrent identical requests (first executor wins; losers replay). The OpenAPI document is hand-maintained — review it when routes change (`src/lib/openapi.ts`). There is no `/api/v1` namespace; `openapi.info.version` is additive-only within 1.x. Scopes are coarse; since 1.3.0 keys may carry a `project_ids` partition (tenancy-lite, fail-closed 404s) but full SSO/RBAC/tenant isolation remains Wave 0 enterprise work. Audit rows are written only for mutations and denials (reads are not audited). Webhooks deliver terminal events only (no streaming/SSE), best-effort in-process with bounded retry; the receiver list is operator-managed. The MCP server is a thin adapter over the HTTP API (no tool-level authz of its own) and deliberately exposes no destructive/attending/load tools.
26. **Agent key management routes are operator-only by explicit check** (`requireOperator`): a valid agent key receives `403 operator_only` from `/api/agent-keys`. The operator path (no `Authorization` header) is indistinguishable from the UI; there is no second operator factor in this slice.

---

## 12. High-value smoke path

When dependencies and Chromium are available, this path exercises the main local-only flow without external AI credentials:

1. Start with an isolated `RASQ_DB_URL` and run the app on a known `PORT`.
2. Open `/api/health` and confirm database initialization and the reported `version`.
3. Open `/demo-target` and confirm the synthetic checkout works and keeps its light design whichever theme is selected.
4. In `/scan`, select the demo project and capture `/demo-target` at 1280×800.
5. Review geometric candidates; manually correct/save only defensible visible controls.
6. Reopen the saved recording/screen with **Edit saved**, change a label/type, and save. Confirm no duplicate screen appears and unchanged control IDs survive another save.
7. In `/requirements`, use the seeded sample SRS or upload a synthetic ID-prefixed document.
8. In `/tests`, generate Local SRS cases and verify exact requirement links, ordered steps, and expected results.
9. Switch to **From saved visual scans**, select screens, and append visual cases. Confirm positive P2 interactions, bound anchors, empty requirement links, and unique case keys.
10. Filter the case list and choose **Convert displayed to n8n**. Download the JSON and use **Open & run in Workflows**; confirm the same workflow and anchors loaded.
11. Verify unresolved anchors are visible and dry run executes nothing.
12. Run Playwright only against the synthetic demo target. Inspect anchor scores, step statuses, messages, and screenshots.
13. Generate a report and verify it separates generated coverage from observed run evidence; visual-only cases must not increase SRS coverage.
14. Toggle the AI kill switch and verify provider-backed operations cannot make a model call.
15. Switch through the four themes in the sidebar, change the custom colours, shuffle the random theme, and reload: the choice must persist without a flash of another theme, and text must stay readable on every page.
16. For desktop transport, enroll `desktop-agent` with `RASQ_DESKTOP_DRIVER=mock`, compile a bound sequential workflow, run dry-run and attended confirmation/cancellation, and verify mock outcomes remain `skipped`/simulation rather than real execution. Perform real input only in a separate supervised Windows x64 acceptance environment.
17. Delete isolated test data/artifacts afterward; do not commit the database or evidence files.

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
- **Appearance:** theme IDs, token set, surface contract, storage format, `.rq-app` scoping, application version.
- **Verification:** tests/CI added, commands and actual current limitations.
- **Snapshot:** replace the reviewed commit/date and state what was actually validated.

Keep historical claims tied to their snapshot. Do not record speculative plans as completed capabilities, and do not store secrets, real customer evidence, local database contents, or provider responses in this memory.
