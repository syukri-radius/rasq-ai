import type { LocalCase } from "./srs";
import { isReviewOnlyControlType, LOCAL_RULES_MODEL, type StepAction, type TestStep } from "./types";

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
  if (c.type === "p_button" || c.type === "h_button") return "1000";
  if (c.type === "p_input" || ((c.type === "input") && /password|passcode/.test(label))) return "<FIXTURE: synthetic password supplied by the test vault>";
  if (c.type === "s_input") return "RASQ sample search";
  if (c.type !== "input") return null;
  if (/e-?mail/.test(label)) return "qa.user01@example.test";
  if (/phone/.test(label)) return "+1-555-0100";
  if (/quantity|amount|count/.test(label)) return "2";
  return "RASQ-sample-001";
}

function actionFor(type: string): StepAction {
  if (["input", "date_picker", "s_input", "p_input"].includes(type)) return "type";
  if (type === "dropdown") return "select";
  if (type === "checkbox") return "check";
  if (type === "toggle") return "toggle";
  if (type === "slider") return "slider";
  if (type === "upload") return "upload";
  if (type === "download") return "download";
  if (type === "p_button") return "hold";
  if (type === "h_button") return "hover";
  return "click";
}

function reviewExpectationFor(c: VisualCaseControl, name: string): string {
  if (c.type === "gesture_arena") {
    return `Human review of gesture arena ${name}: define the required signature/gesture pattern and confirm it remains inside the saved bounds. No pattern was generated or dispatched.`;
  }
  if (c.type === "timer") {
    return `Human review of timer ${name}: confirm wording/time format, font family or model, font size, font weight, and location against the approved reference, and observe that the value updates in real time. One saved frame does not prove realtime behavior.`;
  }
  const subject = c.type === "w_text" ? "main-window title" : "read-only text";
  return `Human review of ${subject} ${name}: confirm wording, font family or model, font size, font weight, and location against the approved reference and saved control bounds. No OCR, font, or geometry values were inferred.`;
}

function expectationFor(c: VisualCaseControl, name: string): string {
  switch (c.type) {
    case "button":
      return `A visible response occurs after the saved button "${name}" is clicked. Pixel change is evidence of a transition, not proof of business behaviour.`;
    case "w_button":
      return `A visible window response occurs after main-window button ${name} is clicked. Minimize, maximize/restore, or close semantics require review; pixel change alone is not proof of the exact OS action.`;
    case "p_button":
      return `A visible response occurs after push-and-hold button ${name} is pressed for 1000 ms. Exact hold behavior requires review.`;
    case "h_button":
      return `A visible response occurs after hover button ${name} is hovered for 1000 ms. Exact hover behavior requires review.`;
    case "input":
    case "date_picker":
      return `The synthetic value is entered at the saved "${name}" anchor and the resulting visible value is reviewed.`;
    case "s_input":
      return `The synthetic query is entered into composite search control ${name}, including its grouped icon/button area; the visible query/result requires review.`;
    case "p_input":
      return `A vault-supplied synthetic password is entered into password control ${name}; masking and the resulting visible state require review, and the secret value is not evidence.`;
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
 * Builds visual-only positive interaction/review cases. Pixels do not justify negative,
 * boundary, security or business-requirement variants, so none are invented.
 */
export function designVisualCases(input: VisualCaseControl[]): LocalCase[] {
  return input.map((c) => {
    const name = c.label.trim() || `unlabelled ${c.type.replaceAll("_", " ")}`;
    const reviewOnly = isReviewOnlyControlType(c.type);
    const action = actionFor(c.type);
    const data = fixtureFor(c);
    const expected = reviewOnly ? reviewExpectationFor(c, name) : expectationFor(c, name);
    const steps: TestStep[] = [
      { order: 1, action: "navigate", target: "Application under test (clean session)", controlId: null, data: null, expected: null },
      ...(c.type === "timer" ? [{ order: 2, action: "wait" as const, target: "Observe timer over a bounded interval", controlId: null, data: "1000", expected: null }] : []),
      reviewOnly
        ? { order: c.type === "timer" ? 3 : 2, action: "assert", target: `${c.type.replaceAll("_", " ")} "${name}" on ${c.screenName}`, controlId: c.id, data: null, expected }
        : { order: 2, action, target: `${c.type.replaceAll("_", " ")} "${name}" on ${c.screenName}`, controlId: c.id, data, expected: null },
      ...(!reviewOnly ? [{ order: 3, action: "assert" as const, target: "Observable outcome for the saved visual control", controlId: c.id, data: null, expected }] : []),
    ];
    return {
      title: `Visual – ${c.screenName} – ${name} ${reviewOnly ? "review" : "interaction"}`,
      category: "positive",
      priority: "P2",
      requirementIds: [],
      preconditions: [
        `Saved visual scan "${c.screenName}" is available and its source dimensions match the target layout.`,
        "Clean test environment with synthetic data only.",
        ...((c.type === "p_button" || c.type === "h_button") ? ["The 1000 ms interaction duration is a generated default and must be reviewed against the application specification."] : []),
      ],
      testData: (data && !reviewOnly ? { value: data } : {}) as Record<string, string>,
      steps,
      expected,
      assumptions: [
        "Generated from saved visual controls without an SRS. No requirement traceability or business-rule coverage is implied.",
        ...(reviewOnly ? ["This is a manual-review subject, not an automated wording, font, location, realtime, or gesture oracle."] : []),
        ...(c.type === "w_button" ? ["Consistency across other windows requires separately saved window evidence; it is not inferred from this control."] : []),
        ...(c.type === "s_input" ? ["The saved S_Input bounds are expected to include the search field and adjacent search icon/button as one composite object."] : []),
        ...(c.confidence < 0.5 ? [`Saved control confidence is ${c.confidence.toFixed(2)}; review the visual anchor before execution.`] : []),
        ...(data?.startsWith("<FIXTURE") ? ["Credential data is a vault placeholder and will require manual handling during execution."] : []),
      ],
      provenance: LOCAL_RULES_MODEL,
    };
  });
}
