import assert from "node:assert/strict";
import { test } from "node:test";
import { AiScanSchema } from "../src/lib/schemas";
import { normalizeControls } from "../src/lib/screens";
import { designLocalCases } from "../src/lib/srs";
import { CONTROL_TYPES, REVIEW_ONLY_CONTROL_TYPES } from "../src/lib/types";
import { designVisualCases, type VisualCaseControl } from "../src/lib/visualCases";
import { buildWorkflow, NT, type ControlRef } from "../src/lib/n8n";

const added = ["text", "w_button", "w_text", "s_input", "p_input", "p_button", "h_button", "timer", "gesture_arena"] as const;
const visualControls: VisualCaseControl[] = added.map((type) => ({ id: `control-${type}`, type, label: `Sample ${type}`, confidence: 0.9, screenName: "Fixture Window" }));

test("all new control types pass AI and saved-screen contracts", () => {
  assert.equal(CONTROL_TYPES.length, 18);
  for (const type of added) assert.ok(CONTROL_TYPES.includes(type));
  const ai = AiScanSchema.parse({
    controls: added.map((type, index) => ({ candidateId: `candidate-${index}`, type, label: type, confidence: 0.8, evidence: "Explicit visible fixture" })),
    missed: [],
  });
  assert.deepEqual(ai.controls.map((control) => control.type), [...added]);
  const saved = normalizeControls(added.map((type, index) => ({
    id: `control-${index}`, type, label: type, x: index, y: 2, w: 40, h: 20, confidence: 0.8,
    evidence: "fixture", locatorHash: "rq1:0000000000000000", perceptionLabel: "unknown", aiModel: null, source: "human",
  })));
  assert.deepEqual(saved.map((control) => control.type), [...added]);
});

test("new visual controls generate type-specific safe scenarios", () => {
  const cases = designVisualCases(visualControls);
  assert.equal(cases.length, added.length);
  const actions = new Map(cases.map((testCase) => [testCase.title, testCase.steps.map((step) => step.action)]));
  for (const type of REVIEW_ONLY_CONTROL_TYPES) {
    const testCase = cases[added.indexOf(type)];
    const caseActions = testCase.steps.map((step) => step.action);
    assert.ok(caseActions.every((action) => ["navigate", "wait", "assert"].includes(action)), `${type} must not dispatch input`);
    const assertion = testCase.steps.find((step) => step.action === "assert");
    assert.equal(assertion?.controlId, `control-${type}`);
    assert.match(testCase.expected, /Human review/);
    assert.ok(actions.get(testCase.title)?.includes("assert"));
  }
  assert.equal(cases[added.indexOf("w_button")].steps[1].action, "click");
  assert.equal(cases[added.indexOf("s_input")].steps[1].action, "type");
  assert.equal(cases[added.indexOf("s_input")].steps[1].data, "RASQ sample search");
  assert.equal(cases[added.indexOf("p_input")].steps[1].action, "type");
  assert.match(cases[added.indexOf("p_input")].steps[1].data ?? "", /^<FIXTURE:/);
  assert.deepEqual([cases[added.indexOf("p_button")].steps[1].action, cases[added.indexOf("p_button")].steps[1].data], ["hold", "1000"]);
  assert.deepEqual([cases[added.indexOf("h_button")].steps[1].action, cases[added.indexOf("h_button")].steps[1].data], ["hover", "1000"]);
});

test("workflow compilation preserves review-only oracles and timed interactions", () => {
  const cases = designVisualCases(visualControls);
  const refs = new Map<string, ControlRef>(visualControls.map((control) => [control.id, { id: control.id, type: control.type, label: control.label, x: 1, y: 2, w: 30, h: 20, locatorHash: "rq1:0000000000000000", screenW: 100, screenH: 100 }]));
  const workflow = buildWorkflow({
    name: "New control types",
    targetUrl: "/demo-target",
    cases: cases.map((testCase, index) => ({ caseKey: `TC-${index + 1}`, title: testCase.title, priority: testCase.priority, category: testCase.category, requirementIds: [], steps: testCase.steps })),
    controls: refs,
    provenance: "test",
  });
  const assertions = workflow.nodes.filter((node) => node.type === NT.assert);
  for (const type of REVIEW_ONLY_CONTROL_TYPES) {
    const assertion = assertions.find((node) => node.parameters.controlId === `control-${type}`);
    assert.equal(assertion?.parameters.kind, "manualReview", `${type} must require manual review`);
  }
  const timed = workflow.nodes.filter((node) => node.type === NT.action && ["hold", "hover"].includes(String(node.parameters.action)));
  assert.deepEqual(timed.map((node) => [node.parameters.action, node.parameters.data]), [["hold", "1000"], ["hover", "1000"]]);
});

test("SRS design never turns review-only visual subjects into clicks", () => {
  const cases = designLocalCases(
    { reqKey: "REQ-TEXT-001", text: "The Confirmation heading shall use the approved wording and font.", acceptance: [], category: "functional", ambiguity: null },
    [{ id: "control-text", type: "text", label: "Confirmation heading" }],
  );
  assert.ok(cases.length > 0);
  for (const testCase of cases) {
    assert.ok(testCase.steps.every((step) => ["navigate", "assert"].includes(step.action)));
    assert.ok(testCase.assumptions.some((note) => note.includes("were not clicked")));
    assert.equal(testCase.steps.find((step) => step.action === "assert")?.controlId, "control-text");
  }
});
