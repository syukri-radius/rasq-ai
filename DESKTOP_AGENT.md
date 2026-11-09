# RASQ-Ai Desktop Agent

RASQ-Ai supports an additive **RobotJS attended desktop executor**. The Web Control Plane remains responsible for recorded-screen ingestion, visual analysis, test-case generation, requirement traceability, workflow review, deterministic compilation, and RobotJS script generation. The desktop agent only enrolls, validates assignments, performs preflight, executes the approved manifest through a fixed runner, and returns observed evidence.

> **Platform status:** the real-input driver is a Windows x64 MVP and has not been executed on a real desktop in this repository environment. Cross-platform automated tests use a mock driver. Do not interpret a mock run as real application execution or as proof of Windows/macOS/Linux support.

## Architecture

```text
Recorded screen / saved visual scan
  → Web Control Plane perception and saved controls
  → visual-only or SRS-linked test cases
  → reviewed n8n-shaped workflow
  → rasq-desktop.v1 compiler
       ├─ rasq-desktop.json
       ├─ robotjs.cjs
       ├─ package.json (RobotJS 0.9.1)
       ├─ anchors/*.png
       ├─ bundle-manifest.json (file hashes)
       └─ README.md
  → authenticated outbound agent polling
  → no-input preflight
  → explicit attended confirmation
  → fixed RobotJS manifest runner
  → monotonic run events + PNG evidence
  → existing runs/run_steps/history/reports
```

The agent never calls an AI provider and has no test-case, workflow, or script-generation API. It does not execute the generated `robotjs.cjs` downloaded from the control plane. Instead, the generated script and the agent manifest are deterministic outputs of the same normalized plan. This avoids turning the run API into an arbitrary remote-code-execution channel.

## Components

### Web Control Plane

- `src/lib/desktopContract.ts` — strict `rasq-desktop.v1` Zod contracts, event/evidence limits, and shared types.
- `src/lib/desktopCompiler.ts` — sequential graph validation, source-control binding, cropped anchors, diagnostics, and deterministic manifest generation.
- `src/lib/desktopScript.ts` — fixed reviewed portable RobotJS runner template.
- `src/lib/desktopBundle.ts` — deterministic ZIP creation, safe extraction, size/path checks, and SHA-256 integrity verification.
- `src/lib/desktopAuth.ts` — bootstrap enrollment validation and revocable bearer-device authentication.
- `src/lib/desktopService.ts` — stored-workflow compilation, stale-run handling, and monotonic event application.
- `src/app/api/desktop/**` — enrollment, polling, compiler/export, run, confirmation, cancellation, bundle, event, and evidence routes.
- `src/components/DesktopRunPanel.tsx` — compiler preview, bundle export, agent/display selection, dry run, attended execution, confirmation, cancellation, and live preview.

### Desktop agent

The isolated `desktop-agent/` package contains:

- Electron main/utility-process boundaries with renderer Node integration disabled, context isolation and sandboxing enabled, and narrow preload IPC.
- RobotJS `0.9.1` loaded only by the real desktop driver.
- A fixed manifest runner and a narrow `DesktopDriver` interface.
- A Windows x64 real driver with display-aware capture/image search and a fixed PowerShell/Win32 exact-foreground-window adapter.
- A mock driver for safe unit and HTTP integration tests.
- A local automation indicator, Stop button, and **Ctrl/Command + Alt + Shift + F12** emergency-stop shortcut.
- A headless mock controller used only for integration testing.
- An unsigned Windows packaging script and a synthetic desktop target for supervised validation.

## Supported compiler behavior

The initial compiler accepts one connected sequential path beginning at exactly one manual trigger. Branches, joins, cycles, disconnected nodes, unknown controls, and unsupported behavior produce blocking diagnostics.

| Workflow item | Desktop behavior |
|---|---|
| `navigate` | Validate/focus the approved target at a case boundary. It is not a URL reload. |
| `wait` | Bounded 0–10000 ms wait with cancellation checks. |
| `click` | Capture, require exactly one image match, move/click through the driver, and capture evidence. |
| `type` | Resolve synthetic data or a local environment-variable reference before clicking; select all and type. Typed content is not logged. |
| `select` | Focus the anchor and use the documented keyboard selection behavior. Exact semantics still require an appropriate oracle. |
| `check` / `uncheck` / `toggle` | Click after strict matching. Pixel change does not prove exact semantic state. |
| `slider` | Click a bounded percentage along the matched anchor. |
| `screenshotChanged` | Poll real capture hashes and record elapsed time. Only visual transition is asserted. |
| `manualReview` | Persist `needs-review`, never a pass. |
| `textVisible` / `urlContains` | Blocking compiler diagnostic; Playwright DOM/URL oracles are not reused for native desktop execution. |
| `upload` / `download` | Blocking compiler diagnostic until native-dialog adapters are separately implemented and tested. |
| Branching / unsupported nodes | Blocking diagnostic; never silently flattened or marked passed. |

All desktop action anchors are strict regardless of the Playwright workflow's non-strict default. RobotJS `findImages` must return exactly one match. Zero or ambiguous matches block input. Source control IDs, screen IDs, source dimensions, regions, dHash values, requirement IDs, and provenance are retained in the manifest.

## Enrollment and setup

### Control plane

Set a strong one-time enrollment token and use an isolated database for development:

```bash
export RASQ_DESKTOP_ENROLLMENT_TOKEN='replace-with-a-long-random-token'
export RASQ_DB_URL='file:./data/rasq.db'
npm ci
npm run build
npm run start
```

The enrollment route is disabled with HTTP 503 when the environment variable is absent. Browser-facing desktop pages and run APIs inherit the repository's current lack of general user authentication. **This delivery is therefore a single-operator development feature, not an enterprise multi-tenant security boundary.** Do not expose it to untrusted networks without adding operator authentication/authorization and deployment egress controls.

### Windows x64 attended agent

On the supervised Windows x64 desktop:

1. Install the normal Node.js/Electron build prerequisites if RobotJS does not select a compatible prebuilt binary.
2. Use an unlocked, isolated desktop session with synthetic data and no unrelated work.
3. Install and build without `--ignore-scripts` so native modules are installed:

   ```bash
   cd desktop-agent
   npm ci
   npm run typecheck
   npm test
   npm run build
   npm start
   ```

4. In the agent window, enter the HTTPS control-plane URL, an agent name, and the one-time enrollment token. Plain HTTP is accepted only for loopback development.
5. The agent receives a random 32-byte device token. Only its SHA-256 hash is stored by the control plane. Electron `safeStorage` protects the local token when available; otherwise the user-profile configuration is written with owner-only file permissions.
6. Open the target application and leave its exact window title available for preflight.

RobotJS must report PNG support. The real driver refuses to enable input on non-Windows/non-x64 platforms. The Windows adapter verifies the exact foreground-window title and can focus an exact matching process window. Lock-state detection and enterprise process-signature verification are not implemented.

### Mock agent for safe integration tests

The headless mock controller uses the real enrollment, polling, bundle, event, evidence, and run APIs but performs no OS input:

```bash
cd desktop-agent
npm run build
RASQ_CONTROL_URL=http://127.0.0.1:3000 \
RASQ_DESKTOP_DRIVER=mock \
RASQ_DESKTOP_ENROLLMENT_TOKEN='replace-with-a-long-random-token' \
npm run start:mock
```

`RASQ_DEVICE_TOKEN` can be supplied instead of enrolling on each process start. Mock-attended steps are persisted as `skipped` with simulation messages. Reports exclude `desktopDriver: mock` from real execution counts.

## Operator workflow

1. Create a project and save a recorded-screen scan with reviewed controls.
2. Generate visual-only cases or SRS-linked cases in the Web Control Plane.
3. Generate/review a workflow. If workflow generation inferred `textVisible` or `urlContains`, explicitly choose a supported desktop assertion or leave the case for Playwright; the compiler will not silently downgrade it.
4. Under **Attended Desktop · RobotJS**, select an online idle agent, application name, exact window title, and display.
5. Choose **Compile / preview** and resolve every blocking diagnostic.
6. Optionally download and inspect the RobotJS ZIP bundle.
7. Choose **Desktop dry run** to perform capture/target/anchor validation without input. Dry-run steps end `skipped`.
8. Choose **Attended Desktop**. The agent downloads and verifies the bundle, then performs no-input preflight.
9. Only after `awaiting-operator-confirmation`, verify the target and select **Confirm real input**.
10. Watch real session/step states and preview/evidence. Use browser Stop or the local emergency shortcut when necessary.
11. Inspect persisted step messages, durations, match counts/coordinates, before/after PNGs, and final summaries.

Cancellation prevents subsequent steps; it cannot undo mouse/keyboard input already dispatched. Agent heartbeat expiry or revocation ends active runs as errors and marks unexecuted steps skipped rather than inferring the remaining application state.

## Portable RobotJS script

The ZIP bundle contains a standalone generated runner. It defaults to dry-run and has no network, shell, dynamic-code, or arbitrary module-loading behavior. Install the pinned dependency inside the extracted bundle:

```bash
npm install
node robotjs.cjs --display 'DISPLAY_ID' --target-title 'Exact target title'
node robotjs.cjs --attended --yes --display 'DISPLAY_ID' --target-title 'Exact target title'
```

The portable script cannot verify/focus the OS window. Manually open and focus the intended application, review every anchor/step, and use it only on an isolated supervised desktop. Local secret references resolve from environment variables before any click. Evidence is written under `rasq-desktop-evidence` beside the script.

The agent's fixed runner and portable script share action order, anchors, data references, assertions, and strict mismatch behavior. The Windows agent additionally provides foreground-window verification/focus and control-plane evidence transport.

## Transport and evidence integrity

- Agents poll outbound every 750 ms; no inbound agent server is required.
- Device credentials are revocable. Bundle retrieval/events/evidence require the device assigned to the run.
- Run assignment binds workflow revision, bundle hash, agent, target, display, and driver.
- Event sequence numbers are contiguous and idempotent. Gaps, unknown steps, invalid payloads, and new events after terminal completion are rejected.
- PNG evidence is size/hash checked. Identical sequence replays are idempotent; altered replays fail.
- Desktop event rows contain JSON metadata, not base64 frame streams. PNGs remain under ignored run-artifact storage.
- Preview consists of step/preflight frames, not continuous real-time video.
- Mock runs record `desktopDriver: mock`; real execution reporting requires `desktopDriver: robotjs` and attended mode.

## Emergency stop and safety limitations

The agent releases common held modifiers/buttons after attended execution starts, including failure and cancellation paths. It does not release inputs during a dry run because no input phase occurred.

Before production use, add and validate:

- Operator SSO/RBAC and tenant-scoped authorization.
- Signed agent updates/packages and enterprise device identity/mTLS as required.
- Desktop lock-state, secure-session, process-signature, and unexpected-user-input controls.
- Vault-backed secret providers and evidence encryption/retention policies.
- Durable worker scheduling and managed isolated VM sessions.
- OCR/accessibility oracles, native dialogs, and separately tested platform adapters.

Do not use the agent on production desktops with real customer data or unrestricted credentials.

## Synthetic target and Windows packaging

For supervised validation, `desktop-agent/synthetic-target.html` provides a local synthetic form:

```bash
cd desktop-agent
npm run start:target
```

The exact target title is **RASQ Synthetic Desktop Target**. Record/scan its controls through the existing Web Control Plane and generate reviewed cases/workflows there.

Create an unsigned Windows x64 development package on Windows after a normal native dependency install:

```powershell
npm run package:win
```

`scripts/package-win.ps1` stages Electron, the fixed runtime, and unpacked RobotJS runtime dependencies under `desktop-agent/out/`, then creates a ZIP. It does not sign an installer or prove real attended execution. Package smoke tests, code signing, and release hardening remain deployment responsibilities.

## Platform boundaries

- **Windows x64:** intended real-input MVP; real execution and packaging are unverified until run on a supervised Windows host.
- **macOS:** real input is not enabled by this MVP. Accessibility and Screen Recording permissions would be required by a future adapter.
- **Linux:** real input is not enabled by this MVP. RobotJS uses X11/XWayland, not native Wayland; this environment also could not complete a native source build because Node header download access failed.
- **Citrix/VMware/mobile:** no support claim is made. A visible remote window and an agent running inside a virtual session are different execution architectures.

## Validation commands

Web Control Plane:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Desktop agent:

```bash
cd desktop-agent
npm run typecheck
npm test
npm run build
```

The web tests cover deterministic compilation/ZIP integrity, source-ID binding, unsupported behavior, secret references, fresh/upgraded migrations, monotonic/idempotent events, terminal immutability, and stale agents. Agent tests use only the mock driver and cover dry runs, missing/ambiguous anchors, target failure, confirmation, missing secrets, emergency stop, and input cleanup. Real RobotJS input requires a separate supervised Windows acceptance run.
