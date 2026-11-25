# Scan Vision Agent Beta (ADR-0001, Option C / Phase 1)

## Enable / disable

Set `RASQ_VISION_AGENT=midscene` on the **server** and restart. Any other value
(default: unset) hides the Scan tab and makes POST `/api/vision-agent` return 404.
No migration or rollback is needed. Existing Record / Upload / Capture modes stay
on their existing paths. This is an operator-only capability, not an additional
machine-agent execution grant.

Configure **visual_scan** in AI Models & Policy to a plain OpenAI-compatible,
vision-capable provider/model. The global Local/AI switch is respected. Anthropic,
Gemini, generic JSON and custom provider configurations are deliberately rejected
in this pilot, rather than silently discarding their configuration. No sixth task
route is added: Phase 1 performs visual discovery, not NL scenario execution.
Provider credentials are resolved from allowlisted environment-variable names on
the server and passed as instance-scoped SDK configuration, never global env edits.
Midscene configuration is not accepted from the client.

Install the server's normal Playwright Chromium runtime with
`npx playwright install --with-deps chromium`. Production needs a trusted,
single-operator host with an egress firewall/proxy for hostile targets. The shared
`assertSafeUrl` gate's documented DNS-rebinding limitation still applies.

## Operator workflow

1. Select a project, then **Vision Agent (Beta)** on Scan.
2. Enter a live URL, discovery command and optional visual assertion. Every request
   starts a fresh browser (no shared cookies or authenticated persistent session).
3. Review the image-data warning and explicitly consent. Screenshots are **not
   pixel-redacted** and may leave the server for the selected provider. Textual
   instructions and proposal labels/evidence pass the shared text redactor.
4. Review the screenshot, proposal boxes, source pixels, evidence and step timeline.
   Check **Add as control** for each proposal to retain. Nothing is selected by default.
   Coordinates outside the captured viewport are dropped, unknown types/malformed
   model output fail validation, and confidence is capped at 0.6.
5. **Save as screen** asks for confirmation and calls the existing `/api/screens`
   path with `source=vision_agent`. RASQ dHash anchors are computed from actual
   captured pixels, not requested from the model. Controls retain normal geometric
   semantics. Existing saved-scan editing preserves the new provenance.
6. **Create test draft** becomes available after saving controls. It asks for a
   separate confirmation and invokes existing visual-case generation for that
   exact saved screen, append-only. These are generated drafts, not executed tests.

Screen and draft actions send stable idempotency keys. `/api/screens` now honors
optional keys using the same helper as `/api/tests`; requests without a key retain
existing behavior. As with that helper, this is successful-response retry protection,
not a distributed in-flight transaction lock.

## Security / lifecycle

- Initial navigation, subframes, subresources and redirect destinations reuse
  `assertSafeUrl`. HTTP fetch auto-redirects are disabled and Location is validated
  before a redirect response is released to the browser. Service workers, downloads,
  WebSockets and popups are disabled; post-load navigations are blocked.
- Only query and assertion APIs are called. Action/scenario execution explicitly
  rejects as unsupported. An assertion supported by the model is `needs-review`,
  **never** `passed`; it is not a deterministic application oracle.
- One in-process session at a time; 90-second request deadline, 20-second navigation,
  15-second resource requests, 45-second model request timeout, no model retries,
  maximum 60 proposals, 1500 characters per instruction, one query/optional assertion,
  1280×800 viewport, maximum 8 MB PNG. Browser cleanup runs on failure, timeout,
  cancellation and completion. UI unmount/project switch aborts discovery.
- Both feature and AI kill switches are rechecked between discovery and assertion
  and before returning artifacts. An already-dispatched provider request may remain
  in flight until its abort/timeout; disabling is not a provider-side cancellation.
- Audit start/error/stop records contain route, target origin, instruction lengths,
  timing and unverified step status metadata, not raw prompts, screenshots or secrets.
- Midscene HTML reports, execution dumps and caches are disabled. SDK raw file logs
  are deliberately denied via the pinned SDK's log-directory resolver pointed at
  the OS null device (not a directory). SDK warning output is scoped/suppressed;
  sessions reject DEBUG/SDK raw-model logging settings. This needs re-review when
  upgrading Midscene. No SDK reports become RASQ report authority.

## Evidence and Phase boundary

Phase 1 returns the real viewport screenshot plus **model-generated** proposals and
assertion assessments. Until explicit confirmation, these remain ephemeral; save
persists the snapshot and normalized control provenance through existing screen
storage. Audit metadata is persisted independently. No model assertion is represented
as a passed test.

ADR §3.3 assigns persisted `runs`/`run_steps` NL execution evidence and the scenario
composer to **Phase 2**. This Phase 1 implementation does not create synthetic
workflows merely to satisfy the non-null `runs.workflow_id`, does not create NL run
rows, and does not promote discovery to Workflows/Runs. Consequently the cross-phase
ADR §7 run/step-row acceptance item remains for Phase 2. Reports continue to consume
only existing persisted RASQ facts, never the ephemeral timeline or SDK output.

## Validation and known limitations

Automated tests cover proposal normalization/bounds/provenance, legacy values,
consent, flag-off API behavior, unsupported scenario calls, server configuration,
private/metadata/scheme rejection, redirect/subresource interception, and confirmed `/api/screens` persistence/replay
plus downstream visual test generation. The normal
suite, typecheck, lint and production build are required before release.

An additional local smoke used real Chromium with mocked SDK query/assertion
responses: live PNG capture, `vision_agent` provenance, `needs-review` assertion,
metadata-redirect rejection and browser cleanup passed. No external model was called;
real model grounding quality, cost and end-to-end production provider compatibility
remain unvalidated. The browser used a temporary external launcher, not a new
application dependency.

`npm audit --omit=dev` after dependency installation reports vulnerabilities,
including transitive Midscene/Puppeteer/proxy/FTP and Zod chains (14 high, 1 moderate
in that production-only audit). Review/upgrade these dependencies before enabling
this pilot outside a controlled environment. The flag defaults off, but is not a
substitute for dependency remediation. No `npm audit fix --force` was applied.
