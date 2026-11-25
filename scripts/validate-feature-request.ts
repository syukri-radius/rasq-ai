/**
 * scripts/validate-feature-request.ts
 *
 * Pre-flight validator for docs/feature-requests/*.md.
 * Checks that a feature-request doc carries the sections an implementing
 * agent needs before implementation starts — see docs/feature-requests/README.md
 * ("The loop", step 2).
 *
 * Run:  npm run validate:feature-request docs/feature-requests/your-request.md
 */
import { readFileSync, existsSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/validate-feature-request.ts <path-to-markdown>");
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`FAIL: file not found: ${file}`);
  process.exit(1);
}

const text = readFileSync(file, "utf8");

/** Body of the section whose heading matches `re`, up to the next `## ` heading. */
function sectionBody(re: RegExp): string {
  const m = text.match(re);
  if (!m || m.index === undefined) return "";
  const after = text.slice(m.index + m[0].length);
  const next = after.search(/\n^## /m);
  return (next === -1 ? after : after.slice(0, next)).replace(/\*\*\[required\]\*\*/g, "").trim();
}

const REQUIRED_SECTIONS: Array<[string, RegExp]> = [
  ["ID & metadata", /^## 1\. ID & metadata/m],
  ["Motivation", /^## 2\. Motivation/m],
  ["Goal / Desired Behavior", /^## 3\. Goal \/ Desired Behavior/m],
  ["Acceptance Criteria", /^## 4\. Acceptance Criteria/m],
  ["Scope", /^## 5\. Scope/m],
  ["Constraints & Must-Nots", /^## 6\. Constraints & Must-Nots/m],
  ["Evidence & Invariants", /^## 7\. Evidence & Product Invariants to Respect/m],
  ["Expected Deliverable", /^## 8\. Expected Deliverable/m],
  ["Validation Expected", /^## 9\. Validation Expected/m],
  ["Implementation Prompt", /^## 10\. Implementation Prompt/m],
  ["Open Questions / Assumptions", /^## 11\. Open Questions \/ Assumptions/m],
];

const failures: string[] = [];
let present = 0;
for (const [label, re] of REQUIRED_SECTIONS) {
  if (!text.match(re)) {
    failures.push(`missing section: ${label}`);
  } else if (sectionBody(re).length < 20) {
    failures.push(`section "${label}" is empty or too short`);
  } else {
    present += 1;
  }
}

// Acceptance criteria must contain at least one checkable item.
if (!/AC[-_][0-9]/.test(sectionBody(/^## 4\. Acceptance Criteria/m))) {
  failures.push('section "Acceptance Criteria" lacks checkable items (expect "AC-N: …")');
}

// The implementation prompt must carry the task block slots.
const promptBody = sectionBody(/^## 10\. Implementation Prompt/m);
for (const slot of ["Task:", "Current behavior:", "Desired behavior:", "Out of scope:"]) {
  if (!promptBody.includes(slot)) failures.push(`implementation prompt missing slot "${slot}"`);
}

if (failures.length > 0) {
  console.error(`FAIL: ${file}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS: ${file} — ${present} sections present, implementation prompt slots OK`);
