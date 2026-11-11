import { createHash } from "node:crypto";
import type { DesktopAnchor, DesktopDisplay, DesktopTarget } from "../../src/lib/desktopContract";
import type { DesktopDriver, DesktopFrame, DesktopMatch, TargetValidation } from "./driver";

const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4f0AAAAASUVORK5CYII=", "base64");

export class MockDesktopDriver implements DesktopDriver {
  matchCount = 1;
  targetFailure = false;
  inputCalls = 0;
  released = false;
  captureCount = 0;
  readonly calls: string[] = [];
  readonly display: DesktopDisplay = { id: "mock-main", x: 0, y: 0, width: 1280, height: 800, isMain: true, scaleX: 1, scaleY: 1 };

  capabilities() { return { driver: "mock" as const, supportsInput: true, actions: ["click", "hold", "hover", "type", "select", "check", "uncheck", "toggle", "slider", "wait", "navigate"], platformNotes: ["Simulated driver for automated tests; no OS input is dispatched."] }; }
  async displays() { return [this.display]; }
  async permissions() { return { screenCapture: "granted" as const, accessibility: "not-required" as const, interactiveSession: "confirmed" as const }; }
  async validateTarget(target: DesktopTarget, allowFocus: boolean): Promise<TargetValidation> {
    this.calls.push(allowFocus ? "focus-target" : "validate-target");
    if (this.targetFailure || (target.requireFocus && target.windowTitle === "wrong-window")) return { verified: false, message: "Mock target does not match." };
    return { verified: target.requireFocus, message: allowFocus ? "Mock target validated/focused; no OS input dispatched." : "Mock target validated without focus." };
  }
  async capture(displayId: string): Promise<DesktopFrame> {
    if (displayId !== this.display.id) throw new Error("Mock display unavailable");
    const png = (this.captureCount++ === 0 || this.inputCalls === 0 ? PNG_A : PNG_B);
    return { png: Buffer.from(png), sha256: createHash("sha256").update(png).digest("hex"), capturedAt: new Date().toISOString(), display: this.display };
  }
  async locate(_frame: DesktopFrame, anchor: DesktopAnchor): Promise<DesktopMatch[]> {
    this.calls.push(`locate:${anchor.controlId}`);
    return Array.from({ length: this.matchCount }, (_, i) => ({ x: 10 + i * 100, y: 20, width: anchor.region.w, height: anchor.region.h, screenX: 15 + i * 100, screenY: 30 }));
  }
  async click(_frame: DesktopFrame, _match: DesktopMatch, fraction = 0.5) { this.inputCalls++; this.calls.push(`click:${fraction}`); }
  async holdStart(_frame: DesktopFrame, _match: DesktopMatch) { this.inputCalls++; this.calls.push("hold-start"); }
  async hover(_frame: DesktopFrame, _match: DesktopMatch) { this.inputCalls++; this.calls.push("hover"); }
  async type(value: string) { this.inputCalls++; this.calls.push(`type:${value.length}`); }
  async select(value: string) { this.inputCalls++; this.calls.push(`select:${value}`); }
  async releaseAll() { this.released = true; this.calls.push("release-all"); }
}
