import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyDesktopBundle } from "../../src/lib/desktopBundle";
import type { DesktopAssignment, DesktopEvent } from "../../src/lib/desktopContract";
import { ControlClient, pollPayload } from "./controlClient";
import type { DesktopDriver, DesktopFrame } from "./driver";
import { DesktopRunner } from "./runner";

export type AgentViewState = {
  connected: boolean;
  currentRunId: string | null;
  message: string;
  automationActive: boolean;
};

export class AgentController {
  readonly state: AgentViewState = { connected: false, currentRunId: null, message: "Agent is starting.", automationActive: false };
  private sequence = 1;
  private evidenceSequence = 1;
  private cancelRequested = false;
  private confirmed = false;
  private stopped = false;
  private polling = false;
  private confirmation: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly client: ControlClient, private readonly driver: DesktopDriver, private readonly onChange: (state: AgentViewState) => void = () => undefined) {}

  start(): void {
    this.stopped = false;
    void this.pollLoop();
  }

  stopPolling(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    void this.emergencyStop();
  }

  async emergencyStop(): Promise<void> {
    this.cancelRequested = true;
    this.confirmation?.reject(new Error("Local emergency stop activated."));
    this.confirmation = null;
    this.update("Emergency stop requested; no subsequent step will dispatch input.");
  }

  async pollOnce(): Promise<void> {
    const response = await this.client.poll(await pollPayload(this.driver, this.state.currentRunId));
    this.state.connected = true;
    if (this.state.currentRunId) {
      if (!response.assignment) {
        this.cancelRequested = true;
        this.confirmation?.reject(new Error("Control plane no longer has an active assignment."));
      } else {
        this.cancelRequested ||= response.assignment.cancelRequested;
        this.confirmed ||= response.assignment.confirmed;
        if (response.assignment.cancelRequested) this.confirmation?.reject(new Error("Browser cancellation requested."));
        if (response.assignment.confirmed && this.confirmation) {
          this.confirmation.resolve();
          this.confirmation = null;
        }
      }
      this.onChange(this.state);
      return;
    }
    if (response.assignment && !response.assignment.cancelRequested) void this.execute(response.assignment);
    this.onChange(this.state);
  }

  private async pollLoop(): Promise<void> {
    if (this.stopped) return;
    if (!this.polling) {
      this.polling = true;
      try { await this.pollOnce(); }
      catch (e) {
        this.state.connected = false;
        this.update(e instanceof Error ? e.message : String(e));
      } finally { this.polling = false; }
    }
    this.timer = setTimeout(() => void this.pollLoop(), 750);
  }

  private async execute(assignment: DesktopAssignment): Promise<void> {
    this.state.currentRunId = assignment.runId;
    this.state.automationActive = true;
    this.sequence = assignment.nextSequence;
    this.evidenceSequence = 1;
    this.cancelRequested = assignment.cancelRequested;
    this.confirmed = assignment.confirmed;
    let temp = "";
    try {
      if (assignment.state !== "queued") {
        await this.send(assignment.runId, "complete", { status: "error", message: "Agent restarted or lost its previous session; no actions were resumed.", summary: { error: 1 } });
        return;
      }
      this.update(assignment.mode === "dry-run" ? "Downloading bundle for no-input dry run." : "Downloading bundle for attended preflight.");
      const bytes = await this.client.bundle(assignment.runId);
      const bundle = verifyDesktopBundle(bytes);
      temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), `rasq-agent-${assignment.runId.slice(0, 8)}-`));
      for (const [name, data] of Object.entries(bundle.files)) {
        const file = path.join(temp, name);
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(file, data, { flag: "wx" });
      }
      const runner = new DesktopRunner(this.driver, {
        session: (state, message) => { this.update(message); return this.send(assignment.runId, "session", { state, message }); },
        step: (event) => this.send(assignment.runId, "step", event),
        complete: (status, message, summary) => this.send(assignment.runId, "complete", { status, message, summary }),
        evidence: (nodeId, kind, frame) => this.uploadEvidence(assignment.runId, nodeId, kind, frame),
        waitForConfirmation: () => this.confirmed ? Promise.resolve() : new Promise<void>((resolve, reject) => { this.confirmation = { resolve, reject }; }),
        cancelled: () => this.cancelRequested,
      });
      const status = await runner.run(bundle.manifest, assignment.mode, temp);
      this.update(`Run finished with ${status}.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.update(message);
      try {
        await this.send(assignment.runId, "session", { state: "completing", message: "Agent could not execute the assignment." });
        await this.send(assignment.runId, "complete", { status: "error", message, summary: { error: 1 } });
      } catch { /* server heartbeat timeout will provide a truthful terminal error */ }
    } finally {
      this.confirmation = null;
      this.state.currentRunId = null;
      this.state.automationActive = false;
      this.cancelRequested = false;
      this.confirmed = false;
      if (temp) await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => undefined);
      this.onChange(this.state);
    }
  }

  private async uploadEvidence(runId: string, nodeId: string | null, kind: "before" | "after" | "preview", frame: DesktopFrame): Promise<Record<string, unknown>> {
    return this.client.evidence(runId, {
      nodeId,
      kind,
      mimeType: "image/png",
      dataBase64: frame.png.toString("base64"),
      sha256: frame.sha256,
      capturedAt: frame.capturedAt,
      sequence: this.evidenceSequence++,
      display: frame.display,
    });
  }

  private async send(runId: string, type: DesktopEvent["type"], payload: unknown): Promise<void> {
    const seq = this.sequence;
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.client.event(runId, { seq, type, payload });
        this.sequence = seq + 1;
        return;
      } catch (e) {
        last = e;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  private update(message: string): void {
    this.state.message = message.slice(0, 1000);
    this.onChange(this.state);
  }
}
