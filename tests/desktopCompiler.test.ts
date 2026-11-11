import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { unzipSync, zipSync } from "fflate";
import { compileDesktopWorkflow, type DesktopCompileInput } from "../src/lib/desktopCompiler";
import { createDesktopBundle, verifyDesktopBundle } from "../src/lib/desktopBundle";
import { renderRobotScript } from "../src/lib/desktopScript";
import type { N8nWorkflow } from "../src/lib/n8n";

const png = sharp({ create: { width: 200, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).composite([{ input: Buffer.from([20, 80, 200, 255]), raw: { width: 1, height: 1, channels: 4 }, top: 20, left: 20 }]).png().toBuffer();
const ids = { trigger: "node-trigger", open: "node-open", section: "node-section", action: "node-action", assert: "node-assert" };
const nodes = [
  { id: ids.trigger, name: "Trigger", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [0, 0] as [number, number], parameters: {} },
  { id: ids.open, name: "Target", type: "rasq-ai.openTarget", typeVersion: 1, position: [0, 0] as [number, number], parameters: {} },
  { id: ids.section, name: "Case", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [0, 0] as [number, number], parameters: { caseKey: "VIS-1", requirementIds: [] } },
  { id: ids.action, name: "Click", type: "rasq-ai.action", typeVersion: 1, position: [0, 0] as [number, number], parameters: { action: "click", caseKey: "VIS-1", requirementIds: [], controlId: "control-1", region: { x: 20, y: 20, w: 30, h: 30 } } },
  { id: ids.assert, name: "Changed", type: "rasq-ai.assert", typeVersion: 1, position: [0, 0] as [number, number], parameters: { kind: "screenshotChanged", expected: "Visible transition", maxDurationMs: 1500 } },
];
const workflow: N8nWorkflow = {
  name: "Desktop fixture",
  nodes,
  connections: Object.fromEntries(nodes.slice(0, -1).map((n, i) => [n.name, { main: [[{ node: nodes[i + 1].name, type: "main", index: 0 }]] }])),
  active: false,
  settings: {},
};
async function input(): Promise<DesktopCompileInput> {
  const image = await png;
  return {
    workflow: { id: "workflow-1", projectId: "project-1", version: 3, provenance: "rasq-local-rules-v1", n8n: workflow },
    screens: [{ id: "screen-1", projectId: "project-1", width: 200, height: 120, imagePath: "screen.png" }],
    controls: [{ id: "control-1", type: "button", screenId: "screen-1", x: 20, y: 20, w: 30, h: 30, locatorHash: "rq1:0000000000000000" }],
    target: { applicationName: "Fixture", windowTitle: "Fixture Window", displayId: "main", requireFocus: true },
    readImage: async () => image,
  };
}

test("compiler and ZIP are deterministic and preserve source evidence", async () => {
  const source = await input();
  const a = createDesktopBundle(await compileDesktopWorkflow(source));
  const b = createDesktopBundle(await compileDesktopWorkflow(source));
  assert.equal(a.sha256, b.sha256);
  assert.deepEqual(a.bytes, b.bytes);
  const verified = verifyDesktopBundle(a.bytes);
  assert.equal(verified.manifest.workflowVersion, 3);
  assert.equal(verified.manifest.sourceProvenance, "rasq-local-rules-v1");
  assert.deepEqual(verified.manifest.steps.map((s) => s.nodeId), nodes.map((n) => n.id));
  assert.equal(verified.manifest.steps[3].kind, "action");
  assert.equal(Object.keys(a.files).filter((x) => x.startsWith("anchors/")).length, 1);
  assert.equal(a.files["robotjs.cjs"].toString(), renderRobotScript(a.manifest));
});

test("generated source has no dynamic code/shell and preserves action order", async () => {
  const bundle = createDesktopBundle(await compileDesktopWorkflow(await input()));
  const source = bundle.files["robotjs.cjs"].toString();
  for (const forbidden of ["eval(", "new Function", "child_process", "process.binding", "require(\"node:http"]) assert.equal(source.includes(forbidden), false, forbidden);
  assert.ok(source.indexOf('"nodeId": "node-trigger"') < source.indexOf('"nodeId": "node-action"'));
  assert.ok(source.includes('"nodeId": "node-assert"'));
});

test("unknown controls and web-only assertions block executable bundles", async () => {
  const unknown = await input();
  unknown.controls = [];
  const a = await compileDesktopWorkflow(unknown);
  assert.ok(a.diagnostics.some((d) => d.code === "DESKTOP_ANCHOR_UNRESOLVED"));
  assert.throws(() => createDesktopBundle(a));
  const web = await input();
  web.workflow.n8n = { ...workflow, nodes: nodes.map((n) => n.id === ids.assert ? { ...n, parameters: { kind: "textVisible", value: "Text" } } : n) };
  const b = await compileDesktopWorkflow(web);
  assert.ok(b.diagnostics.some((d) => d.code === "DESKTOP_ASSERTION_UNSUPPORTED"));
});

test("branching cannot be silently flattened", async () => {
  const source = await input();
  source.workflow.n8n = { ...workflow, connections: { ...workflow.connections, Case: { main: [[{ node: "Click", type: "main", index: 0 }], [{ node: "Changed", type: "main", index: 0 }]] } } };
  const result = await compileDesktopWorkflow(source);
  assert.ok(result.diagnostics.some((d) => d.code === "DESKTOP_BRANCH_UNSUPPORTED"));
});

test("credential fixtures require local secret references and never embed their values", async () => {
  const source = await input();
  source.workflow.n8n = { ...workflow, nodes: nodes.map((n) => n.id === ids.action ? { ...n, parameters: { ...n.parameters, action: "type", data: "<FIXTURE password>" } } : n) };
  const missing = await compileDesktopWorkflow(source);
  assert.ok(missing.diagnostics.some((d) => d.code === "DESKTOP_SECRET_REF_REQUIRED"));
  source.workflow.n8n = { ...workflow, nodes: nodes.map((n) => n.id === ids.action ? { ...n, parameters: { ...n.parameters, action: "type", data: "<FIXTURE password>", secretRef: "QA_PASSWORD" } } : n) };
  const compiled = createDesktopBundle(await compileDesktopWorkflow(source));
  assert.equal(compiled.files["robotjs.cjs"].toString().includes("<FIXTURE password>"), false);
  assert.equal(compiled.manifest.steps[3].kind === "action" && compiled.manifest.steps[3].secretRef, "QA_PASSWORD");
});

test("review-only controls reject manually injected desktop input", async () => {
  for (const type of ["text", "w_text", "timer", "gesture_arena"]) {
    const source = await input();
    source.controls = source.controls.map((control) => ({ ...control, type }));
    const result = await compileDesktopWorkflow(source);
    assert.ok(result.diagnostics.some((d) => d.code === "DESKTOP_CONTROL_REVIEW_ONLY"));
    assert.throws(() => createDesktopBundle(result));
  }
});

test("hold and hover are bounded deterministic desktop actions", async () => {
  for (const action of ["hold", "hover"] as const) {
    const source = await input();
    source.workflow.n8n = { ...workflow, nodes: nodes.map((n) => n.id === ids.action ? { ...n, parameters: { ...n.parameters, action, data: "100" } } : n) };
    const bundle = createDesktopBundle(await compileDesktopWorkflow(source));
    const step = bundle.manifest.steps[3];
    assert.ok(step.kind === "action" && step.action === action && step.data === "100");
    const script = bundle.files["robotjs.cjs"].toString();
    assert.ok(script.includes(`step.action === "${action}"`));
    source.workflow.n8n = { ...workflow, nodes: nodes.map((n) => n.id === ids.action ? { ...n, parameters: { ...n.parameters, action, data: "50" } } : n) };
    const invalid = await compileDesktopWorkflow(source);
    assert.ok(invalid.diagnostics.some((d) => d.code === "DESKTOP_ACTION_DURATION_INVALID"));
  }
});

test("integrity verification rejects modified bundle files", async () => {
  const bundle = createDesktopBundle(await compileDesktopWorkflow(await input()));
  const files = unzipSync(bundle.bytes);
  files["robotjs.cjs"] = new TextEncoder().encode("throw new Error('tampered')");
  const tampered = zipSync(files);
  assert.throws(() => verifyDesktopBundle(tampered), /integrity check failed/);
});
