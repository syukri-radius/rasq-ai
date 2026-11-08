import type { LocalCase } from "./srs";
import { LOCAL_RULES_MODEL, type StepAction, type TestStep } from "./types";

export type VisualCaseControl = {
  id: string;
  type: string;
  label: string;
  confidence: number;
  screenName: string;
};

function fixtureFor(c: VisualCaseControl): string | null {
  const label = c.label.toLowerCase();
  if (c.type === "date_picker") return "2030-01-15";
  if (c.type === "dropdown") return "first option";
  if (c.type === "slider") return "50";
  if (c.type === "upload") return "rasq-fixture.txt";
  if (c.type !== "input") return null;
  if (/password|passcode/.test(label)) return "<FIXTURE: synthetic password supplied by the test vault>";
  if (/e-?mail/.test(label)) return "qa.user01@example.test";
  if (/phone/.test(label)) return "+1-555-0100";
  if (/quantity|amount|count/.test(label)) return "2";
  return "RASQ-sample-001";
}

function actionFor(type: string): StepAction {
  if (type === "input" || type === "date_picker") return "type";
  if (type === "dropdown") return "select";
  if (type === "checkbox") return "check";
  if (type === "toggle") return "toggle";
  if (type === "slider") return "slider";
  if (type === "upload") return "upload";
  if (type === "download") return "download";
  return "click";
}

function expectationFor(c: VisualCaseControl, name: string): string {
  switch (c.type) {
    case "button":
      return `A visible response occurs after the saved button "${name}" is clicked. Pixel change is evidence of a transition, not proof of business behaviour.`;
    case "input":
    case "date_picker":
      return `The synthetic value is entered at the saved "${name}" anchor and the resulting visible value is reviewed.`;
    case "dropdown":
      return `The selected option is visibly applied to "${name}"; the exact selected value requires review.`;
    case "checkbox":
      return `The checked state of "${name}" is visibly updated; pixels alone do not prove the exact semantic state.`;
    case "toggle":
      return `The visible state of "${name}" changes; the exact on/off semantics require review.`;
    case "slider":
      return `The visible position of "${name}" changes after the 50% interaction.`;
    case "upload":
      return `A synthetic text fixture is attached through "${name}" and the attachment evidence is reviewed.`;
    case "download":
      return `A download starts from "${name}"; filename, byte count and SHA-256 are recorded. Integrity is verified only when a manifest is supplied.`;
    default:
      return `The interaction at the saved "${name}" visual anchor produces observable evidence for review.`;
  }
}

/**
 * Builds visual-only positive interaction cases. Pixels do not justify negative,
 * boundary, security or business-requirement variants, so none are invented.
 */
export function designVisualCases(input: VisualCaseControl[]): LocalCase[] {
  return input.map((c) => {
    const name = c.label.trim() || `unlabelled ${c.type.replaceAll("_", " ")}`;
    const action = actionFor(c.type);
    const data = fixtureFor(c);
    const expected = expectationFor(c, name);
    const steps: TestStep[] = [
      { order: 1, action: "navigate", target: "Application under test (clean session)", controlId: null, data: null, expected: null },
      { order: 2, action, target: `${c.type.replaceAll("_", " ")} "${name}" on ${c.screenName}`, controlId: c.id, data, expected: null },
      { order: 3, action: "assert", target: "Observable outcome for the saved visual control", controlId: null, data: null, expected },
    ];
    return {
      title: `Visual – ${c.screenName} – ${name} interaction`,
      category: "positive",
      priority: "P2",
      requirementIds: [],
      preconditions: [
        `Saved visual scan "${c.screenName}" is available and its source dimensions match the target layout.`,
        "Clean test environment with synthetic data only.",
      ],
      testData: (data ? { value: data } : {}) as Record<string, string>,
      steps,
      expected,
      assumptions: [
        "Generated from saved visual controls without an SRS. No requirement traceability or business-rule coverage is implied.",
        ...(c.confidence < 0.5 ? [`Saved control confidence is ${c.confidence.toFixed(2)}; review the visual anchor before execution.`] : []),
        ...(data?.startsWith("<FIXTURE") ? ["Credential data is a vault placeholder and will require manual handling during execution."] : []),
      ],
      provenance: LOCAL_RULES_MODEL,
    };
  });
}
