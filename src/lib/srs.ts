import type { Category, Priority, TestStep } from "./types";
import { LOCAL_RULES_MODEL } from "./types";

export type ParsedReq = {
  reqKey: string;
  text: string;
  acceptance: string[];
  category: string;
  ambiguity: string | null;
};

const ID_RE = /^\s*(?:[-*•]\s*)?\[?([A-Z][A-Z0-9]{1,9}(?:-[A-Z][A-Z0-9]{0,9})*-\d+(?:\.\d+)*[a-z]?)\]?\s*[:.)–—-]?\s+(.+)$/;
const AC_RE = /^\s*(?:[-*•]\s*)?(?:AC\s*\d*\s*[:.)-]|Acceptance(?:\s+criteria)?\s*[:.-]|Given\b|When\b|Then\b|And\b)\s*(.*)$/i;
const VAGUE =
  /\b(fast|quick(?:ly)?|user[- ]friendly|appropriate(?:ly)?|easy|easily|as needed|etc\.?|tbd|approximately|reasonabl[ey]|robust|intuitive|seamless|adequate|minimal|sufficient|secure)\b/i;

export function classify(text: string): string {
  const t = text.toLowerCase();
  if (/password|auth|encrypt|token|permission|rbac|csrf|xss|injection|session|lockout/.test(t)) return "security";
  if (/pii|privacy|gdpr|personal data|consent|retention/.test(t)) return "privacy";
  if (/keyboard|screen reader|aria|wcag|contrast|focus order|accessib/.test(t)) return "accessibility";
  if (/within\s+\d|latency|response time|throughput|load time|\bms\b|milliseconds/.test(t)) return "performance";
  if (/retry|timeout|offline|recover|failover|unavailable|resilien/.test(t)) return "resilience";
  return "functional";
}

export function parseRequirements(raw: string): ParsedReq[] {
  const out: ParsedReq[] = [];
  let cur: ParsedReq | null = null;
  let inAc = false;
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const idm = ID_RE.exec(line);
    if (idm && !AC_RE.test(line)) {
      cur = { reqKey: idm[1], text: idm[2].trim(), acceptance: [], category: "functional", ambiguity: null };
      out.push(cur);
      inAc = false;
      continue;
    }
    if (!cur) continue;
    const acm = AC_RE.exec(line);
    if (acm) {
      inAc = /^\s*(?:[-*•]\s*)?Acceptance/i.test(line) && !acm[1];
      if (acm[1]) cur.acceptance.push(line.replace(/^\s*(?:[-*•]\s*)?(?:AC\s*\d*\s*[:.)-]\s*)?/i, "").trim());
      continue;
    }
    if (inAc && /^\s*[-*•\d]/.test(line)) {
      cur.acceptance.push(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim());
      continue;
    }
    inAc = false;
    cur.text += " " + line.trim();
  }
  for (const r of out) {
    r.category = classify(r.text + " " + r.acceptance.join(" "));
    if (VAGUE.test(r.text) && !/\d/.test(r.text) && r.acceptance.length === 0) {
      r.ambiguity = `Vague wording ("${VAGUE.exec(r.text)?.[0]}") with no measurable acceptance criterion; the test asserts only what is observable and flags the gap.`;
    }
  }
  return out;
}

export type BindableControl = { id: string; type: string; label: string };

export type LocalCase = {
  title: string;
  category: Category;
  priority: Priority;
  requirementIds: string[];
  preconditions: string[];
  testData: Record<string, string>;
  steps: TestStep[];
  expected: string;
  assumptions: string[];
  provenance: string;
};

const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "shall", "must", "should", "user", "system", "when", "that", "is", "be", "are", "can", "will"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

function bind(text: string, controls: BindableControl[]): BindableControl[] {
  const rw = new Set(words(text));
  return controls
    .map((c) => ({ c, score: words(c.label).filter((w) => rw.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.c);
}

function synth(text: string): { data: Record<string, string>; notes: string[] } {
  const t = text.toLowerCase();
  const data: Record<string, string> = {};
  const notes: string[] = [];
  if (/e-?mail/.test(t)) data.email = "qa.user01@example.test";
  if (/password|passcode/.test(t)) {
    data.password = "<FIXTURE: synthetic password supplied by the test vault>";
    notes.push("Password is a vault placeholder; RASQ-Ai never manufactures credentials.");
  }
  if (/\bname\b/.test(t)) data.fullName = "Test User Alpha";
  if (/phone/.test(t)) data.phone = "+1-555-0100";
  if (/date|calendar/.test(t)) data.date = "2030-01-15";
  if (/(sandbox|test card|card number|payment card)/.test(t)) {
    Object.assign(data, { cardNumber: "4242424242424242", expiry: "12/34", cvc: "123" });
    notes.push("Card values are the public sandbox fixture 4242…4242, used because the requirement calls for a card test value.");
  }
  if (/quantity|amount|count|items?/.test(t)) data.quantity = "2";
  return { data, notes };
}

function stepFor(c: BindableControl, data: Record<string, string>, order: number): TestStep {
  const base = { order, controlId: c.id, target: `${c.type.replace("_", " ")} "${c.label || "unlabelled"}"`, expected: null as string | null };
  switch (c.type) {
    case "input":
      return { ...base, action: "type", data: /card/i.test(c.label) && data.cardNumber ? data.cardNumber : data.email ?? data.fullName ?? data.quantity ?? "RASQ-sample-001" };
    case "date_picker":
      return { ...base, action: "type", data: data.date ?? "2030-01-15" };
    case "dropdown":
      return { ...base, action: "select", data: "first option" };
    case "checkbox":
      return { ...base, action: "check", data: null };
    case "toggle":
      return { ...base, action: "toggle", data: null };
    case "slider":
      return { ...base, action: "slider", data: "50" };
    case "upload":
      return { ...base, action: "upload", data: "rasq-fixture.txt" };
    case "download":
      return { ...base, action: "download", data: null };
    default:
      return { ...base, action: "click", data: null };
  }
}

function priorityOf(text: string, category: Category): Priority {
  const t = text.toLowerCase();
  if (/payment|card number|security|auth|password|encrypt|privacy|pii|integrity|permission|lockout|refund/.test(t) || category === "security") return "P0";
  if (/cosmetic|tooltip|polish|animation|colou?r|\bmay\b|optional/.test(t)) return "P3";
  if (category === "boundary" || category === "negative" || category === "accessibility" || category === "performance" || category === "resilience") return "P2";
  return "P1";
}

/** Deterministic, requirement-driven test design. Generates variants only where the source text justifies them. */
export function designLocalCases(req: ParsedReq, controls: BindableControl[]): LocalCase[] {
  const full = `${req.text} ${req.acceptance.join(" ")}`;
  const { data, notes } = synth(full);
  const bound = bind(full, controls);
  const assumptions = [...notes];
  if (req.ambiguity) assumptions.push(`Ambiguity: ${req.ambiguity}`);
  if (bound.length === 0) assumptions.push("No saved visual anchor matches this requirement; steps are unbound and need a scanned control before automated execution.");

  const mkSteps = (extra?: (s: TestStep[]) => void, expected?: string): TestStep[] => {
    const steps: TestStep[] = [{ order: 1, action: "navigate", target: "Application under test (clean session)", controlId: null, data: null, expected: null }];
    bound.forEach((c) => steps.push(stepFor(c, data, steps.length + 1)));
    extra?.(steps);
    steps.push({ order: steps.length + 1, action: "assert", target: "Observable outcome", controlId: null, data: null, expected: expected ?? req.acceptance[0] ?? req.text });
    return steps;
  };
  const pre = ["Clean test environment with synthetic data only", ...(req.ambiguity ? ["Assumption recorded: " + req.ambiguity] : [])];
  const mk = (cat: Category, title: string, expected: string, steps: TestStep[], td: Record<string, string> = data, extraNotes: string[] = []): LocalCase => ({
    title: `${req.reqKey} – ${title}`,
    category: cat,
    priority: priorityOf(full, cat),
    requirementIds: [req.reqKey],
    preconditions: pre,
    testData: td,
    steps,
    expected,
    assumptions: [...assumptions, ...extraNotes],
    provenance: LOCAL_RULES_MODEL,
  });
  /** Sets the data of the first typed step (the primary input) for variant cases. */
  const setInput = (v: string) => (s: TestStep[]) => {
    const t = s.find((x) => x.action === "type");
    if (t) t.data = v;
  };

  const cases: LocalCase[] = [];
  const posExpected = req.acceptance[0] ?? req.text;
  if (req.ambiguity && req.acceptance.length === 0) {
    const exp = "Requirement has no measurable oracle. The run records observable evidence only; a human must define a threshold before this can pass or fail.";
    cases.push(mk("positive", "exposes ambiguity", exp, mkSteps(undefined, exp), data, ["Do not treat a green run as proof of the vague quality attribute."]));
  } else {
    cases.push(mk("positive", "valid behaviour", `Observable result matches: ${posExpected}`, mkSteps(undefined, posExpected)));
  }

  const negAc = req.acceptance.filter((a) => /\b(not|invalid|reject|error|cannot|fail|denied|without)\b/i.test(a));
  negAc.forEach((a, i) => {
    const bad = /\b(\d+)\s*digits?\b/i.exec(a);
    cases.push(mk("negative", `rejects invalid input (AC ${i + 1})`, a, mkSteps(setInput(bad ? "1".repeat(Number(bad[1])) : "INVALID-INPUT"), a), { ...data, invalidInput: bad ? `${bad[1]} digits` : "INVALID-INPUT" }));
  });
  if (negAc.length === 0 && /\b(invalid|reject|must not|shall not|only|required|valid)\b/i.test(req.text)) {
    cases.push(mk("negative", "rejects invalid or missing input", "An observable validation message or blocked transition is shown; no data is accepted.", mkSteps(setInput(""), "Validation feedback is visible and the action does not complete."), { ...data, invalidInput: "empty value" }, ["Exact validation wording is not specified; assertion is limited to a visible rejection."]));
  }

  const bounds = new Map<number, { accept: boolean; src: string }>();
  for (const bm of full.matchAll(/(at least|at most|minimum|maximum|min\.?|max\.?|up to|no more than|limit)\D{0,20}(\d+)/gi)) {
    const n = Number(bm[2]);
    const isMin = /(at least|minimum|min)/i.test(bm[1]);
    const pair: [number, boolean][] = isMin ? [[n - 1, false], [n, true]] : [[n, true], [n + 1, false]];
    for (const [v, accept] of pair) if (!bounds.has(v)) bounds.set(v, { accept, src: `${bm[1]} ${n}` });
  }
  [...bounds.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([v, { accept, src }]) => {
      const exp = accept ? `Value ${v} is accepted.` : `Value ${v} is rejected with an observable indication.`;
      cases.push(mk("boundary", `boundary value ${v}`, exp, mkSteps(setInput(String(v)), exp), { ...data, boundaryValue: String(v), source: src }));
    });

  if (/password|auth|encrypt|token|permission|session|csrf|xss|injection|lockout|payment|card/i.test(full)) {
    cases.push(mk("security", "abuse and unauthorised-access check", "Protected behaviour is not reachable without valid, synthetic credentials; no secret is displayed in clear text.", mkSteps(setInput("' OR '1'='1"), "Request is rejected and no sensitive value is exposed in visible pixels.")));
  }
  if (/pii|privacy|gdpr|personal data|consent/i.test(full)) {
    cases.push(mk("privacy", "personal-data handling", "Only synthetic personal data is shown; consent state is observable.", mkSteps()));
  }
  if (/keyboard|screen reader|aria|wcag|contrast|focus/i.test(full)) {
    cases.push(mk("accessibility", "keyboard-only operation", "All referenced controls are reachable and operable with Tab/Enter/Space; focus is visibly indicated.", mkSteps(undefined, "Focus indicator visible on each control and action completes via keyboard.")));
  }
  const pm = /within\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds|seconds|s)\b/i.exec(full);
  if (pm) {
    cases.push(mk("performance", `completes within ${pm[1]} ${pm[2]}`, `Observable outcome appears within ${pm[1]} ${pm[2]} of the triggering action (measured from the action to the first visual transition).`, mkSteps(undefined, `Outcome visible within ${pm[1]} ${pm[2]}.`), { ...data, threshold: `${pm[1]} ${pm[2]}` }));
  }
  if (/retry|timeout|offline|recover|failover|unavailable/i.test(full)) {
    cases.push(mk("resilience", "recovery after interruption", "After a simulated interruption the application recovers or shows an observable, actionable error.", mkSteps(undefined, "Recovery or actionable error is visible."), data, ["Interruption method is not defined in the requirement; the tester must supply it."]));
  }
  return cases;
}
