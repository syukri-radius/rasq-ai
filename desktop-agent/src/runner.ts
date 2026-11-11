import path from "node:path";
import type { DesktopManifest, DesktopRunStatus, DesktopSessionState, DesktopStep, DesktopStepEvent } from "../../src/lib/desktopContract";
import type { DesktopDriver, DesktopFrame } from "./driver";

export type RunnerHooks = {
  session(state: DesktopSessionState, message: string): Promise<void>;
  step(event: DesktopStepEvent): Promise<void>;
  complete(status: DesktopRunStatus, message: string, summary: Record<string, number>): Promise<void>;
  evidence(nodeId: string | null, kind: "before" | "after" | "preview", frame: DesktopFrame): Promise<Record<string, unknown>>;
  waitForConfirmation(): Promise<void>;
  cancelled(): boolean;
};

class Cancelled extends Error { constructor() { super("Desktop execution stopped by operator cancellation or emergency stop."); } }
class StepFailure extends Error { constructor(readonly step: DesktopStep, message: string) { super(message); } }

type TerminalRunStatus = Exclude<DesktopRunStatus, "pending" | "running">;
const terminal = (status: DesktopRunStatus) => !["pending", "running"].includes(status);

export class DesktopRunner {
  constructor(private readonly driver: DesktopDriver, private readonly hooks: RunnerHooks) {}

  async run(manifest: DesktopManifest, mode: "attended" | "dry-run", anchorDirectory: string): Promise<DesktopRunStatus> {
    const results = new Map<string, DesktopRunStatus>();
    const simulated = this.driver.capabilities().driver === "mock";
    let current: DesktopStep | null = null;
    let inputPhase = false;
    let previousBefore: string | null = null;
    let actionStarted = 0;
    const sleep = async (ms: number) => {
      const end = Date.now() + Math.min(10_000, Math.max(0, ms));
      while (Date.now() < end) {
        this.checkCancelled();
        await new Promise((resolve) => setTimeout(resolve, Math.min(50, end - Date.now())));
      }
    };
    const emit = async (step: DesktopStep, status: TerminalRunStatus, message: string, started = Date.now(), evidence: Record<string, unknown> = {}) => {
      if (!terminal(status)) throw new Error("Runner emitted a non-terminal step status.");
      const recordedStatus = simulated && status === "passed" ? "skipped" : status;
      const recordedMessage = simulated && status === "passed" ? `Simulation only; no OS input or outcome was observed. ${message}` : message;
      results.set(step.nodeId, recordedStatus);
      await this.hooks.step({ nodeId: step.nodeId, status: recordedStatus, message: recordedMessage.slice(0, 1000), durationMs: Math.max(0, Date.now() - started), evidence });
    };
    const summary = () => {
      const out: Record<string, number> = {};
      for (const status of results.values()) out[status] = (out[status] ?? 0) + 1;
      return out;
    };
    const skipRemaining = async (message: string) => {
      for (const step of manifest.steps) if (!results.has(step.nodeId)) await emit(step, "skipped", message);
    };

    try {
      await this.hooks.session("assigned", "Validated assignment received from the Web Control Plane.");
      await this.hooks.session("preflight", mode === "dry-run" ? "Running capture/anchor validation without input." : "Running no-input preflight before operator confirmation.");
      this.checkCancelled();
      const displays = await this.driver.displays();
      const display = displays.find((d) => d.id === manifest.target.displayId) ?? (!manifest.target.displayId ? displays.find((d) => d.isMain) : undefined);
      if (!display) throw new Error("Selected display is unavailable; no input was dispatched.");
      const permissions = await this.driver.permissions();
      if (permissions.screenCapture === "denied" || permissions.accessibility === "denied" || permissions.interactiveSession === "locked") throw new Error("Desktop capture/accessibility permission or interactive-session preflight failed.");
      const target = await this.driver.validateTarget(manifest.target, false);
      if (manifest.target.requireFocus && !target.verified) throw new Error(`Target preflight failed: ${target.message}`);
      const preflight = await this.driver.capture(display.id);
      await this.hooks.evidence(null, "preview", preflight);
      for (const step of manifest.steps) {
        this.checkCancelled();
        if (step.kind !== "action" || !step.anchor) continue;
        const frame = step.anchor && preflight.display.id === display.id ? preflight : await this.driver.capture(display.id);
        const matches = await this.driver.locate(frame, step.anchor, path.join(anchorDirectory, step.anchor.asset));
        if (matches.length !== 1) throw new Error(`Preflight anchor "${step.anchor.controlId}" returned ${matches.length} matches; attended confirmation is blocked.`);
      }

      if (mode === "dry-run") {
        for (const step of manifest.steps) await emit(step, "skipped", step.kind === "action" && step.anchor ? "Dry run: one anchor observed; no mouse/keyboard input dispatched." : "Dry run: structure validated only; no input dispatched.");
        await this.hooks.session("completing", "Dry-run validation completed.");
        await this.hooks.complete("skipped", "Dry run completed without mouse/keyboard input.", summary());
        return "skipped";
      }

      await this.hooks.session("awaiting-operator-confirmation", "No-input preflight passed. Confirm the target in the Web Control Plane before real input.");
      await this.hooks.waitForConfirmation();
      this.checkCancelled();
      inputPhase = true;
      await this.hooks.session("running", "Operator confirmed attended desktop execution.");

      for (const step of manifest.steps) {
        this.checkCancelled();
        current = step;
        const started = Date.now();
        if (step.kind === "trigger" || step.kind === "section") {
          await emit(step, "passed", step.kind === "trigger" ? "Attended run started." : "Test case section.", started);
          continue;
        }
        if (step.kind === "target") {
          const checked = await this.driver.validateTarget(manifest.target, true);
          if (manifest.target.requireFocus && !checked.verified) throw new StepFailure(step, checked.message);
          await emit(step, "passed", checked.message, started);
          continue;
        }
        if (step.kind === "assert") {
          if (step.assertion === "manualReview") {
            await emit(step, "needs-review", `Human verification required: ${step.expected}`, started);
            continue;
          }
          const limit = step.maxDurationMs ?? 1500;
          const deadline = Date.now() + limit;
          let changed = false;
          let elapsed = Date.now() - actionStarted;
          let last: DesktopFrame | null = null;
          while (Date.now() <= deadline) {
            this.checkCancelled();
            last = await this.driver.capture(display.id);
            elapsed = Date.now() - actionStarted;
            changed = Boolean(previousBefore && last.sha256 !== previousBefore);
            if (changed) break;
            await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
          }
          const evidence = last ? await this.hooks.evidence(step.nodeId, "after", last) : {};
          if (!changed) throw new StepFailure(step, `No visual transition observed within ${limit} ms.`);
          if (step.maxDurationMs !== null && elapsed > step.maxDurationMs) throw new StepFailure(step, `Visual transition appeared after ${elapsed} ms, exceeding ${step.maxDurationMs} ms.`);
          await emit(step, "passed", `Pixels changed after ${elapsed} ms; exact business content was not verified.`, started, evidence);
          continue;
        }
        if (step.kind !== "action") continue;

        if (step.action === "navigate") {
          const checked = await this.driver.validateTarget(manifest.target, true);
          if (manifest.target.requireFocus && !checked.verified) throw new StepFailure(step, checked.message);
          await emit(step, "passed", checked.message, started);
          continue;
        }
        if (step.action === "wait") {
          await sleep(Number(step.data ?? 500));
          await emit(step, "passed", `Waited ${step.data} ms.`, started);
          continue;
        }
        if (!step.anchor) throw new StepFailure(step, "Action has no visual anchor; no input dispatched.");
        const secret = step.secretRef ? process.env[step.secretRef] : undefined;
        if (step.secretRef && !secret) throw new StepFailure(step, `Local secret reference ${step.secretRef} is unavailable; no input dispatched.`);
        const before = await this.driver.capture(display.id);
        const beforeEvidence = await this.hooks.evidence(step.nodeId, "before", before);
        const matches = await this.driver.locate(before, step.anchor, path.join(anchorDirectory, step.anchor.asset));
        if (matches.length !== 1) throw new StepFailure(step, `Strict anchor "${step.anchor.controlId}" returned ${matches.length} matches; no input dispatched.`);
        previousBefore = before.sha256;
        actionStarted = Date.now();
        const timedEvidence: Record<string, unknown> = {};
        if (step.action === "hold") {
          const durationMs = Number(step.data ?? 1000);
          await this.driver.holdStart(before, matches[0]);
          try {
            await sleep(durationMs);
          } finally {
            await this.driver.releaseAll();
          }
          timedEvidence.holdMs = durationMs;
        } else if (step.action === "hover") {
          const durationMs = Number(step.data ?? 1000);
          await this.driver.hover(before, matches[0]);
          await sleep(durationMs);
          timedEvidence.hoverMs = durationMs;
        } else if (step.action === "slider") {
          await this.driver.click(before, matches[0], Math.max(0, Math.min(1, Number(step.data ?? 50) / 100)));
        } else {
          await this.driver.click(before, matches[0]);
        }
        if (step.action === "type") await this.driver.type(secret ?? step.data ?? "");
        if (step.action === "select") await this.driver.select(step.data ?? "");
        const after = await this.driver.capture(display.id);
        const afterEvidence = await this.hooks.evidence(step.nodeId, "after", after);
        await emit(step, "passed", `${step.action} dispatched after exactly one strict anchor match; business success is not implied.`, started, {
          ...afterEvidence,
          beforeShot: beforeEvidence.shot,
          controlId: step.anchor.controlId,
          matchCount: 1,
          match: matches[0],
          regionChanged: before.sha256 !== after.sha256,
          ...(step.action === "type" ? { typedCharacters: (secret ?? step.data ?? "").length } : {}),
          ...timedEvidence,
        });
      }
      current = null;
      const statuses = [...results.values()];
      const status: DesktopRunStatus = statuses.includes("failed") ? "failed" : statuses.includes("needs-review") ? "needs-review" : statuses.includes("warning") ? "warning" : simulated ? "skipped" : "passed";
      await this.hooks.session("completing", "All attended steps reached terminal states.");
      await this.hooks.complete(status, simulated && status === "skipped" ? "Simulated attended flow completed; no OS execution evidence was produced." : status === "passed" ? "Attended desktop steps completed; review assertion evidence for business correctness." : "Attended desktop execution finished with review/failure outcomes.", summary());
      return status;
    } catch (error) {
      const cancelled = error instanceof Cancelled || this.hooks.cancelled();
      const message = error instanceof Error ? error.message : String(error);
      if (current && !results.has(current.nodeId)) await emit(current, cancelled ? "error" : "failed", message);
      await skipRemaining(cancelled ? "Not executed after operator stop." : "Not executed after desktop preflight/action failure.");
      await this.hooks.session("completing", cancelled ? "Emergency stop/cancellation acknowledged." : "Desktop execution stopped safely.");
      await this.hooks.complete(cancelled ? "error" : current ? "failed" : "error", cancelled ? "Desktop execution stopped by operator." : message, summary());
      return cancelled ? "error" : current ? "failed" : "error";
    } finally {
      if (inputPhase) await this.driver.releaseAll().catch(() => undefined);
    }
  }

  private checkCancelled(): void {
    if (this.hooks.cancelled()) throw new Cancelled();
  }
}
