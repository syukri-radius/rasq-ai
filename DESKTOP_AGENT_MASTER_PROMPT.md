# RASQ-Ai Desktop Agent Master Prompt

Use this prompt to direct a senior coding agent to implement **RobotJS attended desktop execution** in `syukri-radius/rasq-ai`. It is intentionally specific about the ownership boundary: recordings, visual analysis, test cases, workflows, compiled execution bundles, and generated RobotJS scripts belong to the **RASQ-Ai Web Control Plane**. The desktop agent executes approved work and returns observed evidence; it does not design tests.

Read this prompt together with `MASTER_PROMPT.md` and `CONTEXT_MEMORY.md`. The current repository source always takes precedence over documentation. Do not treat the proposed paths, schemas, or APIs below as permission to rewrite existing contracts without migration and compatibility checks.

---

## Prompt

You are a senior TypeScript/Electron engineer, desktop-automation specialist, application-security reviewer, and test-automation architect working on **RASQ-Ai**.

Implement an end-to-end **RASQ-Ai Desktop Agent for attended desktop-execution mode using RobotJS**, and make RobotJS another deterministic compiler target for the existing scenario/workflow model. Deliver working vertical slices, tests, operator documentation, and honest platform-specific validation—not only an architecture document or UI mockup.

### 1. Product mission and ownership boundary

Preserve RASQ-Ai's central promise:

> Visual evidence and operator-approved scenarios drive automation. Inference is never presented as observation, and generated automation is never presented as executed or passed.

The required pipeline is:

```text
Recorded screen / uploaded screenshot / existing visual scan
                         │
                         ▼
             RASQ-Ai Web Control Plane
       perception → saved screens and controls
       test-case generation → traceable scenarios
       workflow generation and operator review
       RobotJS compiler → execution bundle + script
                         │
              authenticated delivery
                         ▼
              RASQ-Ai Desktop Agent
       preflight → visual anchor validation
       attended RobotJS mouse/keyboard execution
       emergency stop → live preview → evidence upload
                         │
                         ▼
       Web Control Plane run monitor and reports
```

The ownership requirements are non-negotiable:

| Component | Responsibilities |
|---|---|
| **Web Control Plane** | Recording ingestion, visual perception, optional AI semantics, control editing, test-case generation, requirement traceability, workflow creation/editing, compiler validation, desktop execution-bundle creation, deterministic RobotJS script generation, agent/run administration, evidence persistence, and reports. |
| **Desktop Agent** | Device enrollment, capability/permission reporting, target/display confirmation, bundle integrity validation, preflight checks, strict visual-anchor location, attended RobotJS input, local emergency stop, live status/frame streaming, and observed evidence return. |
| **Operator** | Reviews generated cases/workflows, selects an enrolled agent and target application, confirms the attended session, handles requested review, and can stop execution immediately. |

Do **not** move test-case generation, workflow generation, AI routing, requirement extraction, or script authorship into the desktop agent. The agent must not need an AI-provider credential and must not invent or repair test cases.

### 2. Establish repository facts before editing

1. Read the current task, repository status, `README.md`, `MASTER_PROMPT.md`, `CONTEXT_MEMORY.md`, `src/lib/types.ts`, `src/lib/n8n.ts`, `src/lib/runner.ts`, `src/lib/visualCases.ts`, `src/lib/perception.ts`, workflow/run APIs and UI, database schema/migrations, and recording/scan paths.
2. Trace the complete existing path from recorded screen to `recordings`, `screens`, `controls`, `test_cases`, `workflows`, `runs`, `run_steps`, evidence files, and reports.
3. Verify the installed RobotJS version and its actual API before using it. Consult the official documentation where necessary:
   - https://robotjs.dev/docs/
   - https://robotjs.dev/docs/syntax
   - https://robotjs.dev/docs/electron
   - https://robotjs.dev/docs/faq
4. Pin an exact, tested RobotJS version. Do not use an unreviewed floating native dependency. At the time this prompt was written, RobotJS 0.9.1 was current; verify that this remains appropriate rather than assuming it.
5. Preserve existing Playwright, dry-run, n8n import/export, visual-binding, provenance, requirement-traceability, and reporting behavior. Desktop execution is additive.
6. Make the smallest coherent architecture that supports the full vertical path. Do not rewrite the repository into an unrelated monorepo or introduce microservices that are not needed for the transport boundary.

### 3. Preserve existing evidence and workflow invariants

Apply every relevant invariant in `MASTER_PROMPT.md`, especially:

- Never invent coordinates, control IDs, selectors, application focus, assertions, requirement IDs, model output, execution results, or platform support.
- Generated cases and generated scripts are artifacts, not observed results.
- A dry run validates structure and anchors without dispatching mouse or keyboard input.
- An unresolved or unsafe anchor must block the associated desktop action. Never click a stale coordinate as a fallback.
- `manualReview` remains `needs-review`, never a pass.
- Pixel change proves only a visual transition. It does not prove business success, exact text, or an exact checkbox/toggle state.
- Preserve requirement IDs and many-to-many traceability. Visual-only cases do not acquire invented requirement links.
- Preserve provenance for perception, Local generation, provider generation, imported/manual edits, compiler output, and actual execution.
- Preserve existing run-status meanings and precedence unless a versioned migration explicitly changes the contract.
- Existing n8n connections use unique node names; ReactFlow uses node IDs. Do not break graph editing or traversal while adding a compiler target.
- Stock n8n still does not execute `rasq-ai.*` nodes. RobotJS compilation does not change that limitation.

### 4. Required user experience

Add an **Attended Desktop** execution option to the existing workflow/run experience. Do not replace the current Playwright buttons or overload dry-run semantics.

The operator must be able to:

1. Create or select test cases and a workflow produced by the existing Web Control Plane from recorded-screen evidence.
2. Open a RobotJS/Desktop preview that shows compiler diagnostics before execution.
3. Download an inspectable RobotJS script bundle generated by the Web Control Plane.
4. View enrolled desktop agents, online/offline state, OS/architecture, agent version, displays, permissions, and current availability.
5. Select an eligible agent, target application/window, and display.
6. Run a desktop dry run that performs capture and validation but no input.
7. Explicitly confirm attended execution after preflight succeeds.
8. Watch current step, real status, duration, anchor score, messages, and live screenshots in the Web Control Plane.
9. Stop the run from both the browser and a local agent emergency-stop hotkey.
10. Inspect persisted before/after evidence and distinguish desktop-attended runs from Playwright and dry runs.

Use a separate executor dimension such as:

```ts
type Executor = "playwright" | "robotjs-desktop";
type ExecutionMode = "attended" | "headless" | "dry-run";
```

Adapt this to the existing schema without claiming that RobotJS supports headless execution. `robotjs-desktop` supports attended execution and dry-run validation only. Keep `dry-run` distinct from the executor.

### 5. Architecture

#### 5.1 Web Control Plane

Implement focused modules with names equivalent to the following, adjusting paths only when the existing architecture provides a better boundary:

- `desktopContract.ts`: shared versioned Zod contracts, limits, event types, and compiler diagnostics.
- `desktopCompiler.ts`: existing approved workflow + authoritative controls/screens → deterministic desktop execution plan and RobotJS source.
- Desktop agent enrollment, capabilities, revocation, and heartbeat APIs.
- Desktop bundle compilation/download APIs.
- Desktop run creation, confirmation, cancellation, status, event, and evidence APIs.
- Workflow UI for compilation preview, agent selection, attended execution, cancellation, and live evidence.

Do not let browser code call `localhost` or `127.0.0.1` to reach the agent. The browser and desktop agent communicate through the control plane/gateway using relative browser APIs and authenticated server-side transport.

#### 5.2 Desktop transport

Use an **outbound authenticated agent connection**. Do not expose an unauthenticated agent HTTP server or require inbound connections to the operator's computer.

A small WebSocket gateway is acceptable and may be necessary because Next.js route handlers are not a complete persistent WebSocket architecture. If you add one, keep it narrowly scoped to agent transport and run events; scenario/workflow ownership remains in the Web Control Plane. A documented outbound polling/streaming equivalent is acceptable for the first vertical slice only if it provides responsive cancellation and live status without pretending to be continuous video.

The transport must provide:

- Enrollment and subsequent device authentication.
- Heartbeats and capability updates.
- Run assignment and bundle retrieval.
- Monotonically increasing event sequence numbers.
- Cancellation and emergency-stop acknowledgment.
- Flow control and size limits for preview frames and evidence uploads.
- Disconnect detection and a terminal, truthful run outcome.
- No secret values in URLs, event payloads, logs, or persisted messages.

#### 5.3 Electron desktop agent

Build the agent as a small Electron/TypeScript application or an equivalently secure signed desktop shell.

- Load RobotJS only in the Electron main process or a utility process.
- Keep renderer `nodeIntegration` disabled and context isolation enabled.
- Expose only a narrow, typed preload/IPC API. Do not expose generic RobotJS, filesystem, shell, or module-loading functions.
- Use a fixed trusted execution runtime. Do not use `eval`, `new Function`, dynamic module loading from a bundle, or arbitrary JavaScript received from an API.
- Keep one active run per interactive desktop/display session. Do not run concurrent mouse/keyboard sessions on the same desktop.
- Register a documented local emergency-stop shortcut using Electron's supported facilities; RobotJS itself does not register global hotkeys.
- Release pressed keys and mouse buttons in `finally` cleanup after completion, cancellation, or failure.
- Make automation state visible locally and provide a clear local Stop control.
- Package native modules separately for each supported OS/CPU architecture and verify the packaged application, not only development mode.

### 6. Versioned compiler contract

Introduce a versioned contract named **`rasq-desktop.v1`**. It must be strict JSON/Zod data with bounded sizes and no executable template expressions.

A bundle should contain the equivalent of:

```text
rasq-desktop.json        validated execution manifest
robotjs.cjs              deterministic inspectable source export
anchors/                 immutable cropped/template assets and hashes
bundle-manifest.json     file sizes and SHA-256 hashes
README.md                generated run instructions and limitations
```

The execution manifest must include, as applicable:

- Contract version, bundle ID, project ID, workflow ID, workflow version/revision, and compiler version.
- Source workflow hash and deterministic bundle hash.
- Source provenance and generation provenance.
- Ordered case/step/node IDs and existing requirement IDs, without inventing links.
- Target application identity and operator-selected display requirements.
- Source screen/control IDs, source dimensions, region, locator hash, and anchor-asset references.
- Action data or a secret reference, never a resolved secret.
- Assertion kind, expected value, timeout, and strictness.
- Artifact names and hashes.
- Explicit limitations and unsupported/manual-review steps.

Do not persist resolved credentials in the manifest, generated source, browser response, database, screenshots, or logs. Use a vault alias or local agent secret reference and redact it from every event and artifact.

#### 6.1 Deterministic compiler requirements

The RobotJS compiler must:

1. Consume the same approved workflow and authoritative saved controls used by the existing RASQ-Ai workflow model.
2. Resolve every `controlId` against the selected project's saved controls and screen evidence. Reject cross-project or unknown IDs.
3. Preserve source coordinates, dimensions, hashes, case keys, step order, requirement IDs, and provenance.
4. Produce byte-stable output for identical normalized input and compiler version. Sort object keys/files where necessary and exclude wall-clock timestamps from deterministic hashes.
5. Emit structured diagnostics with severity, node/step ID, code, and remediation. Unknown actions, unsupported assertions, unresolved anchors, ambiguous branches, and invalid data must not disappear.
6. Reject unsupported graph behavior explicitly. The initial compiler may support a single sequential execution path only; it must not silently flatten branching into a different test.
7. Generate JavaScript only through fixed, reviewed code templates. AI may help create the upstream scenarios or bindings through existing RASQ-Ai paths, but AI output is never inserted as executable source.
8. Generate the manifest and `robotjs.cjs` from the same normalized execution plan. Add parity tests proving equivalent action order, anchors, data references, assertions, and failure behavior.
9. Include no shell execution, arbitrary network client, dynamic import, arbitrary filesystem path, or general-purpose code evaluator in generated scripts.

The attended agent should execute the validated manifest through its fixed trusted runner. The generated `robotjs.cjs` is a first-class portable/exportable implementation of that same plan. Do not silently execute arbitrary generated JavaScript in the agent. If direct execution of generated source is added later, require a separately reviewed signing, sandboxing, and threat-model design.

#### 6.2 Desktop action semantics

Map only behavior that is actually implemented and tested. Recommended initial behavior:

| Existing workflow item | Desktop compiler behavior |
|---|---|
| `wait` | Bounded wait with cancellation checks. |
| `navigate` | Revalidate/focus the approved desktop target and establish a clean case boundary; it is not a web URL reload. If focus cannot be verified, require explicit operator confirmation and record that limitation. |
| `click` | Strictly locate anchor, move real mouse, capture evidence, then click. |
| `type` | Strictly locate/focus anchor and type approved synthetic data or resolve an authorized local secret reference. Never log typed content. |
| `select` | Use documented keyboard interaction only after anchor focus; record that exact selected semantics require an appropriate assertion. |
| `check`, `uncheck`, `toggle`, `slider` | Implement only with explicit visual evidence and honest limitations. Pixel change alone cannot prove exact state. |
| `screenshotChanged` | Compare actual before/after desktop captures and record timing; do not claim exact content. |
| `manualReview` | Return `needs-review`. |
| `textVisible` | Do not reuse Playwright's DOM oracle. Require a real desktop OCR/accessibility implementation or reject/downgrade only through an explicit reviewed compiler diagnostic. |
| `urlContains` | Unsupported for a native desktop target unless a verified application-specific oracle exists. |
| Native upload/download dialogs | Reject until implemented and tested through a dedicated adapter; do not pretend a web file-chooser strategy automates native dialogs. |

Unsupported behavior must fail compilation or require explicit operator review before a run. Never mark it passed or silently skip it.

### 7. Visual anchors and coordinates

The existing `rq1:` dHash and scaled source region are useful evidence but are not sufficient for unrestricted desktop relocation.

For the first safe implementation:

- Create immutable cropped anchor assets from the authoritative saved screen image and control region, or use an equivalent verified image template already available.
- Preserve original screen/control IDs, source dimensions, region, and dHash.
- Use RobotJS display enumeration and display-aware capture. Do not assume the main display or a zero display origin.
- Keep signed global desktop coordinates, display-local coordinates, source-image pixels, scale factors, and DPI metadata explicitly separated.
- A capture rectangle must remain within one display.
- Refresh display metrics after display changes and invalidate preflight when geometry changes materially.
- Validate the anchor at the expected location and, when supported, search a bounded target window/display region.
- Record match location, score/tolerance, search bounds, display ID, and source anchor revision in evidence.
- Default consequential desktop actions to strict matching. A low score, multiple ambiguous matches, stale display geometry, or missing template means **no input dispatched**.
- Do not implement autonomous anchor identity changes in this task. A repair proposal is not an approved anchor.

Account for image encoding honestly. RobotJS BMP support and PNG support can differ by build; check runtime capabilities rather than assuming PNG support. Any added encoder/native dependency must be pinned, packaged, and tested.

### 8. Attended execution lifecycle

Use a desktop session state machine in addition to existing run/step statuses. Suggested session states are:

```text
queued
→ assigned
→ preflight
→ awaiting-operator-confirmation
→ running
→ completing
→ terminal
```

Cancellation, emergency stop, focus loss, agent disconnect, and fatal preflight failure must have explicit transitions. Do not overload a screenshot `passed` status to mean the whole business scenario passed.

Before starting:

1. Verify agent enrollment, revocation state, protocol compatibility, availability, and project/run authorization.
2. Verify manifest/schema limits, workflow/bundle hashes, compiler diagnostics, and anchor assets.
3. Verify the selected target application/window and display using an actual OS adapter where implemented.
4. Verify the interactive desktop is unlocked and suitable for automation. If lock/session state cannot be detected on a platform, disclose that limitation and require local confirmation.
5. Verify OS automation/capture permissions and native-module loading.
6. Verify no other automation session owns the desktop.
7. Run a no-input anchor/preflight validation and present its results to the operator.
8. Require explicit attended-run confirmation immediately before dispatching input.

For every action:

1. Reconfirm target/focus according to the implemented platform policy.
2. Capture before evidence without logging sensitive typed values.
3. Strictly locate the anchor and record observed match evidence.
4. Dispatch only the approved RobotJS operation.
5. Capture after evidence and execute the configured oracle.
6. Emit a monotonically sequenced step event with duration and truthful status.
7. Check cancellation/emergency stop between all bounded waits and steps.

On agent disconnect or fatal session loss, stop claiming the run is active. Mark it `error` or another existing truthful terminal state with an explicit message; do not infer the remaining steps or final application state.

RobotJS alone does not provide application launching, window enumeration/focus, global recording, or enterprise window identity. Implement a minimal OS-specific adapter for the selected MVP platform or keep those operations manual and clearly labeled. Do not hide the gap.

### 9. Live preview and observed evidence

Provide a responsive live monitor with:

- Agent and target identity.
- Current run/session/step state.
- Case/node name and action.
- Real anchor match score/location where available.
- Current and recent before/after screenshots.
- Duration, messages, cancellation state, and final summary.
- Browser Stop control and local emergency-stop state.

Start with step-boundary screenshots plus a bounded low-frame-rate preview if needed. Do not describe this as continuous real-time video unless an actual continuous stream has been implemented and tested.

Every preview/evidence frame should carry run ID, step ID where applicable, sequence number, capture timestamp, display metadata, and content hash. Preview frames are sensitive evidence: apply transport authentication, size/rate limits, retention rules, and cleanup. Do not store large base64 frame streams in SQLite JSON columns or browser state.

### 10. Security and safety requirements

This feature controls a real mouse and keyboard. Treat it as a privileged remote-operation capability, not a ordinary test-runner plugin.

Mandatory safeguards:

- Authenticated enrollment with revocable device identity; store only token hashes or public-key metadata as appropriate.
- Authorization binding among operator, project, workflow revision, agent, and run.
- Strict request/bundle/event size and schema limits.
- No arbitrary JavaScript, shell command, executable upload, dynamic module path, or unrestricted file path in a run bundle.
- Application/process allowlisting and active-target verification where supported.
- Strict anchors for consequential actions; no coordinate fallback after mismatch.
- Local emergency stop and browser cancellation with acknowledgment.
- Key/mouse release cleanup on every exit path.
- Synthetic data by default and redacted logs/events.
- Local secret references only; no secret values in generated scripts or evidence metadata.
- No concurrent input on one interactive desktop.
- Clear attended automation indicator and operator confirmation.
- Safe handling of unexpected focus loss and operator intervention.
- TLS for network transport and short-lived signed evidence URLs where the existing storage architecture supports them.
- No evidence or credentials committed to Git.

The repository currently has no general authentication/authorization layer unless the current source proves otherwise. Do not expose privileged desktop enrollment, execution, or evidence routes as production-safe unauthenticated network APIs. Either implement an appropriately scoped authentication boundary for this feature or explicitly restrict the delivery to a documented single-operator development mode. Do not claim enterprise readiness, tenant isolation, signed-agent deployment, or production security without the corresponding implementation and tests.

### 11. Persistence and compatibility

Extend persistence deliberately rather than creating a parallel run history.

Likely additions include:

- Desktop agent identity, capabilities, displays, version, heartbeat, availability, and revocation.
- Executor and agent/session association on runs.
- Workflow/bundle/compiler version and bundle hash on runs.
- Desktop session state, confirmation, cancellation, disconnect, and diagnostic metadata.
- Evidence references and content hashes without embedding frame streams in relational JSON.

Preserve existing rows and defaults through a new migration. Test both a fresh database and upgrade from the previous migration. Do not rewrite already-applied migrations. Do not delete existing evidence files as a side effect of schema changes.

Keep generated bundles and run evidence in ignored artifact storage, not Git. Reuse existing `runs`, `run_steps`, status precedence, run monitor, and reports wherever possible so a desktop-attended run remains distinguishable but not disconnected from project traceability.

### 12. Platform scope

Prefer a **Windows x64 attended MVP** unless the current task explicitly supplies and authorizes another real test platform. Implement and validate that platform deeply before claiming others.

Document these constraints:

- macOS mouse/keyboard control requires Accessibility permission; capture requires Screen Recording permission.
- Linux RobotJS currently depends on X11/XWayland and a valid `DISPLAY`; do not claim native Wayland support.
- Native binaries are OS/architecture specific and must be tested in packaged form.
- An unlocked interactive session is normally required for real desktop input.
- A visible Citrix window is not proof of certified Citrix support, and running inside versus outside a virtual session are different architectures.
- Desktop, mobile, VMware, and design surface labels are not execution evidence.

Do not run uncontrolled mouse/keyboard integration tests in shared CI. Unit and integration tests must use a mocked RobotJS driver. Real attended validation requires an isolated desktop, synthetic target, operator supervision, and an emergency stop.

### 13. Explicitly out of scope for the first implementation

Unless separately requested, do not expand this task into:

- Automatic global native input recording or global keylogging. Existing recorded-screen ingestion remains in the Web Control Plane.
- AI-authored JavaScript executed directly on the agent.
- Fully autonomous self-healing or anchor identity changes.
- Concurrent unattended sessions on one display.
- Native mobile automation.
- Arbitrary process/shell/file-system automation nodes.
- Native file-dialog support without a tested adapter.
- Claims of production-ready Citrix/VMware support.
- Full SSO/RBAC/tenant platform replacement, although the privileged feature boundary must not be misrepresented.
- Continuous WebRTC video when step/low-rate evidence satisfies the first vertical slice.

### 14. Implementation sequence

Deliver working vertical slices in this order, preserving a buildable application after each slice.

#### Slice 1 — Contract and Web compiler

- Add the versioned desktop contract and diagnostics.
- Compile an existing recorded-screen-derived workflow into a validated manifest.
- Generate deterministic `robotjs.cjs`, anchor assets, and bundle hashes.
- Add Web compiler preview and bundle export.
- Add unit tests for determinism, source binding, unsupported behavior, secrets, and script/manifest parity.

#### Slice 2 — Agent shell and simulated driver

- Add secure Electron process boundaries and enrollment/capability reporting.
- Define a narrow desktop driver interface with RobotJS and mock implementations.
- Implement preflight, state transitions, emergency stop, and event sequencing against the mock.
- Add agent/run selection and status UI without dispatching real input in automated tests.

#### Slice 3 — Attended RobotJS execution and live evidence

- Implement the pinned RobotJS driver, display-aware capture, strict anchors, supported actions, cancellation, and cleanup.
- Add live browser monitor, evidence upload/persistence, and run-history integration.
- Exercise the full recorded-screen → web-generated cases/workflow → web-compiled bundle/script → attended-agent execution path on a supervised synthetic desktop target.

#### Slice 4 — Packaging and hardening

- Package for the selected OS/architecture.
- Verify permissions, disconnects, revocation, focus loss, display changes, malformed bundles, replayed events, and artifact limits.
- Complete operator/setup/security documentation and record exactly which real-platform checks ran.

### 15. Required tests and acceptance criteria

At minimum, add focused automated tests for:

1. Identical normalized workflow input produces identical manifest/script content and hashes.
2. Test cases and RobotJS source originate from the Web Control Plane; the agent exposes no scenario/script-generation API.
3. Unknown/cross-project controls, unresolved anchors, unsupported actions/assertions, and ambiguous graph branches produce explicit diagnostics and no executable run.
4. Generated source contains no `eval`, `new Function`, arbitrary shell execution, dynamic module loading, or literal secret values.
5. Manifest and generated RobotJS script preserve equivalent action order, data references, assertions, and strict failure behavior.
6. Display/source coordinate conversions handle scale and signed display origins correctly.
7. Low/ambiguous anchor matches dispatch zero mouse/keyboard calls.
8. Dry run dispatches zero mouse/keyboard calls.
9. Target/focus validation failure dispatches zero input when verification is part of the selected platform policy.
10. Emergency stop and browser cancellation prevent subsequent actions and release held inputs.
11. Agent disconnect/revocation produces a truthful terminal run state and does not invent remaining evidence.
12. Event sequence, payload/frame limits, artifact hashes, and duplicate/replayed events are handled safely.
13. Existing Playwright and dry-run behavior remains operational.
14. Fresh and upgraded database migrations preserve existing projects, workflows, runs, and traceability.

A real-platform acceptance run is successful only when, on an isolated supervised desktop:

- The Web Control Plane creates the case/workflow/script from recorded-screen evidence.
- The correct enrolled agent receives the approved bundle.
- The operator can preview and confirm the run.
- The visible mouse/keyboard actions occur in the intended synthetic target.
- Browser live status and screenshots track actual execution.
- Anchor mismatch and emergency stop prevent further input.
- Final evidence and reports match observed results.

If no compatible physical/virtual desktop is available, implement and run all safe mocked checks, explicitly leave real attended execution unverified, and do not claim the acceptance run passed.

### 16. Documentation and validation deliverables

Add or update:

- `DESKTOP_AGENT.md`: architecture, ownership boundary, enrollment, setup, permissions, supported actions, operator workflow, emergency stop, script export, security model, and platform limitations.
- `README.md`: concise attended-desktop capability and documentation link, only for behavior actually implemented.
- `CONTEXT_MEMORY.md`: new routes, modules, persistence, state transitions, commands, and remaining limitations after implementation.
- Existing API/workflow/run documentation affected by the change.
- Agent and gateway package documentation where separate packages are introduced.

Run all relevant checks that actually exist after implementation, including the repository's:

```bash
npm run typecheck
npm run lint
npm run build
```

Also run the new compiler, contract, agent mock-driver, migration, and transport tests. Perform a production build of the Web Control Plane and a packaged-agent smoke test where the environment permits. Inspect the final diff for secrets, generated evidence, native binaries, `node_modules`, unrelated changes, and accidental contract breaks.

### 17. Final implementation report

Finish with a concise report containing:

1. The end-to-end behavior implemented.
2. Web Control Plane, compiler, transport, agent, persistence, and UI files changed.
3. The exact supported action/assertion matrix.
4. Validation performed and actual pass/fail outcomes.
5. Whether a real attended desktop was used; if so, OS/architecture/agent versions and observed result.
6. Security controls implemented and remaining exposure.
7. Unsupported platforms and follow-up work, clearly separated from completed functionality.

Do not claim that generated RobotJS code ran, that live execution was observed, that a platform is supported, or that a test passed unless corresponding execution evidence exists.

### 18. Task to execute

```text
Implement the RASQ-Ai Desktop Agent attended-execution vertical slice described in this prompt.

The Web Control Plane must remain responsible for recorded-screen ingestion, visual scans, test-case creation, workflow creation/review, deterministic rasq-desktop.v1 compilation, and RobotJS script generation.

Make RobotJS a new compiler target alongside the existing Playwright execution path. Deliver an inspectable web-generated RobotJS script bundle and a secure desktop agent that executes the same validated plan through a fixed trusted runtime. Include agent enrollment, preflight, strict visual-anchor checks, attended operator confirmation, visible mouse/keyboard execution, emergency stop, browser live monitoring, observed evidence, and existing run-history/traceability integration.

Prefer a deeply validated Windows x64 MVP with mocked cross-platform-safe tests over unverified claims of universal desktop support. Preserve all existing Playwright, dry-run, n8n, provenance, requirement-traceability, and evidence-integrity behavior.
```
