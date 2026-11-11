export const CONTROL_TYPES = [
  "input",
  "button",
  "dropdown",
  "date_picker",
  "checkbox",
  "toggle",
  "slider",
  "upload",
  "download",
  "text",
  "w_button",
  "w_text",
  "s_input",
  "p_input",
  "p_button",
  "h_button",
  "timer",
  "gesture_arena",
] as const;
export type ControlType = (typeof CONTROL_TYPES)[number];

/** Visual subjects that require an explicit oracle/pattern before any input or automated assertion. */
export const REVIEW_ONLY_CONTROL_TYPES = ["text", "w_text", "timer", "gesture_arena"] as const satisfies readonly ControlType[];
export const isReviewOnlyControlType = (type: string): boolean => (REVIEW_ONLY_CONTROL_TYPES as readonly string[]).includes(type);

export const SURFACES = ["web", "desktop", "citrix", "vmware", "mobile", "design"] as const;
export type Surface = (typeof SURFACES)[number];

export const TASKS = [
  "visual_scan",
  "document_analysis",
  "test_scenarios",
  "workflow_creation",
  "report_generation",
] as const;
export type Task = (typeof TASKS)[number];

export const TASK_LABELS: Record<Task, string> = {
  visual_scan: "Visual scanning",
  document_analysis: "Document analysis",
  test_scenarios: "Test scenario creation",
  workflow_creation: "Test workflow creation",
  report_generation: "Report generation",
};

export const STEP_ACTIONS = [
  "navigate",
  "click",
  "hold",
  "hover",
  "type",
  "select",
  "check",
  "uncheck",
  "toggle",
  "slider",
  "upload",
  "download",
  "assert",
  "wait",
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export const CATEGORIES = [
  "positive",
  "negative",
  "boundary",
  "security",
  "privacy",
  "accessibility",
  "performance",
  "resilience",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type TestStep = {
  order: number;
  action: StepAction;
  /** Human description of the visual target (never a guessed DOM selector). */
  target: string;
  /** Saved RASQ-Ai control id acting as the visual anchor, when bound. */
  controlId: string | null;
  data: string | null;
  expected: string | null;
};

export type RunStatus = "pending" | "running" | "passed" | "failed" | "warning" | "skipped" | "needs-review" | "error";

export const PERCEPTION_MODEL = "rasq-perception-v1";
export const LOCAL_RULES_MODEL = "rasq-local-rules-v1";
