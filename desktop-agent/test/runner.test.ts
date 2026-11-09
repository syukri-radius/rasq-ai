import assert from "node:assert/strict";
import { test } from "node:test";
import type { DesktopManifest, DesktopRunStatus, DesktopSessionState, DesktopStepEvent } from "../../src/lib/desktopContract";
import { MockDesktopDriver } from "../src/mockDriver";
import { DesktopRunner, type RunnerHooks } from "../src/runner";
import type { DesktopFrame } from "../src/driver";

const anchor = { controlId: "control-1", screenId: "screen-1", sourceWidth: 100, sourceHeight: 100, region: { x: 1, y: 2, w: 20, h: 20 }, locatorHash: "rq1:0000000000000000", asset: "anchors/000000000000000000000000.png", tolerance: 0.1, strict: true as const };
const base = { caseKey: "VIS-1", requirementIds: [] };
const manifest: DesktopManifest = {
  rasqDesktopVersion: "rasq-desktop.v1",
  compilerVersion: "1.0.0",
  bundleId: "a".repeat(64),
  projectId: "project-1",
  workflowId: "workflow-1",
  workflowVersion: 1,
  sourceWorkflowSha256: "b".repeat(64),
  sourceProvenance: "rasq-local-rules-v1",
  target: { applicationName: "Fixture", windowTitle: "Fixture Window", displayId: "mock-main", requireFocus: true },
  limitations: [],
  steps: [
    { ...base, nodeId: "trigger", nodeName: "Trigger", position: 0, kind: "trigger" },
    { ...base, nodeId: "target", nodeName: "Target", position: 1, kind: "target" },
    { ...base, nodeId: "click", nodeName: "Click", position: 2, kind: "action", action: "click", anchor, data: null, secretRef: null },
    { ...base, nodeId: "changed", nodeName: "Changed", position: 3, kind: "assert", assertion: "screenshotChanged", expected: "Transition", maxDurationMs: 1500 },
  ],
};
function hooks(driver: MockDesktopDriver, cancel: { value: boolean } = { value: false }) {
  const steps: DesktopStepEvent[] = [];
  const sessions: DesktopSessionState[] = [];
  const completions: { status: DesktopRunStatus; summary: Record<string, number> }[] = [];
  const hooks: RunnerHooks = {
    session: async (state) => { sessions.push(state); },
    step: async (event) => { steps.push(event); },
    complete: async (status, _message, summary) => { completions.push({ status, summary }); },
    evidence: async (_nodeId: string | null, kind: "before" | "after" | "preview", _frame: DesktopFrame) => ({ shot: `${kind}.png` }),
    waitForConfirmation: async () => undefined,
    cancelled: () => cancel.value,
  };
  void driver;
  return { hooks, steps, sessions, completions };
}

test("dry run observes anchors but dispatches no input or key release", async () => {
  const driver = new MockDesktopDriver();
  const h = hooks(driver);
  const status = await new DesktopRunner(driver, h.hooks).run(manifest, "dry-run", "/tmp");
  assert.equal(status, "skipped");
  assert.equal(driver.inputCalls, 0);
  assert.equal(driver.released, false);
  assert.equal(h.steps.every((s) => s.status === "skipped"), true);
});

test("missing and ambiguous anchors block all input", async () => {
  for (const count of [0, 2]) {
    const driver = new MockDesktopDriver(); driver.matchCount = count;
    const h = hooks(driver);
    const status = await new DesktopRunner(driver, h.hooks).run(manifest, "attended", "/tmp");
    assert.equal(status, "error");
    assert.equal(driver.inputCalls, 0);
    assert.equal(h.sessions.includes("awaiting-operator-confirmation"), false);
  }
});

test("target failure blocks input before confirmation", async () => {
  const driver = new MockDesktopDriver(); driver.targetFailure = true;
  const h = hooks(driver);
  const status = await new DesktopRunner(driver, h.hooks).run(manifest, "attended", "/tmp");
  assert.equal(status, "error");
  assert.equal(driver.inputCalls, 0);
  assert.equal(driver.released, false);
});

test("simulated attended run follows confirmation but is not real execution evidence", async () => {
  const driver = new MockDesktopDriver();
  const h = hooks(driver);
  const status = await new DesktopRunner(driver, h.hooks).run(manifest, "attended", "/tmp");
  assert.equal(status, "skipped");
  assert.equal(driver.inputCalls > 0, true);
  assert.equal(driver.released, true);
  assert.equal(h.sessions.includes("awaiting-operator-confirmation"), true);
  assert.equal(h.completions[0].status, "skipped");
  assert.equal(h.steps.some((s) => s.message.includes("Simulation only")), true);
});

test("missing local secret blocks typing before click", async () => {
  const driver = new MockDesktopDriver();
  const h = hooks(driver);
  const typed: DesktopManifest = { ...manifest, steps: manifest.steps.map((s) => s.nodeId === "click" && s.kind === "action" ? { ...s, action: "type", secretRef: "MISSING_QA_SECRET" } : s) };
  delete process.env.MISSING_QA_SECRET;
  const status = await new DesktopRunner(driver, h.hooks).run(typed, "attended", "/tmp");
  assert.equal(status, "failed");
  assert.equal(driver.inputCalls, 0);
  assert.equal(driver.released, true);
});

test("emergency stop prevents subsequent actions and releases held inputs", async () => {
  const driver = new MockDesktopDriver();
  const cancel = { value: false };
  const h = hooks(driver, cancel);
  const originalStep = h.hooks.step;
  h.hooks.step = async (event) => { await originalStep(event); if (event.nodeId === "click") cancel.value = true; };
  const twoActions: DesktopManifest = { ...manifest, steps: [...manifest.steps.slice(0, 3), { ...manifest.steps[2], nodeId: "click-2", position: 3 }, manifest.steps[3]] };
  const status = await new DesktopRunner(driver, h.hooks).run(twoActions, "attended", "/tmp");
  assert.equal(status, "error");
  assert.equal(driver.inputCalls, 1);
  assert.equal(driver.released, true);
  assert.equal(h.steps.find((s) => s.nodeId === "click-2")?.status, "skipped");
});
