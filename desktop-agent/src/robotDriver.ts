import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DesktopAnchor, DesktopDisplay, DesktopTarget } from "../../src/lib/desktopContract";
import type { DesktopDriver, DesktopFrame, DesktopMatch, TargetValidation } from "./driver";
import { validateWindowsTarget } from "./windowsTarget";

type RobotImage = {
  width: number;
  height: number;
  save(file: string): boolean;
  findImages(needle: RobotImage, options: { tolerance: number }): { x: number; y: number }[];
  toScreenPoint(point: { x: number; y: number }): { x: number; y: number };
};
type Robot = {
  getDisplays(): { id: string | number; x: number; y: number; width: number; height: number; isMain: boolean }[];
  updateScreenMetrics(): void;
  screen: { capture(x: number, y: number, width: number, height: number): RobotImage };
  image: { supportsPNG: boolean; load(file: string): RobotImage };
  setMouseDelay(ms: number): void;
  setKeyboardDelay(ms: number): void;
  moveMouseSmooth(x: number, y: number): void;
  mouseClick(button: string): void;
  mouseToggle(direction: string, button: string): void;
  keyTap(key: string, modifier?: string | string[]): void;
  keyToggle(key: string, direction: string): void;
  typeString(value: string): void;
};

export class RobotDesktopDriver implements DesktopDriver {
  private readonly robot: Robot;
  private readonly temp: string;

  constructor() {
    this.robot = require("robotjs") as Robot;
    this.temp = fs.mkdtempSync(path.join(os.tmpdir(), "rasq-robot-"));
    this.robot.setMouseDelay(10);
    this.robot.setKeyboardDelay(10);
  }

  capabilities() {
    const supported = process.platform === "win32" && process.arch === "x64";
    return {
      driver: "robotjs" as const,
      supportsInput: supported && this.robot.image.supportsPNG,
      actions: supported ? ["click", "hold", "hover", "type", "select", "check", "uncheck", "toggle", "slider", "wait", "navigate"] : [],
      platformNotes: [
        supported ? "Windows x64 real-input MVP; exact foreground-window matching uses a fixed PowerShell/Win32 adapter." : "Real input is enabled only for the validated Windows x64 MVP on this build.",
        "An unlocked, isolated, supervised interactive desktop is required. Linux support is X11-only and is not validated by this MVP.",
      ],
    };
  }

  async displays(): Promise<DesktopDisplay[]> {
    this.robot.updateScreenMetrics();
    return this.robot.getDisplays().map((d) => ({ ...d, id: String(d.id) }));
  }

  async permissions() {
    return { screenCapture: "unknown" as const, accessibility: "unknown" as const, interactiveSession: "unknown" as const };
  }

  async validateTarget(target: DesktopTarget, allowFocus: boolean): Promise<TargetValidation> {
    return validateWindowsTarget(target, allowFocus);
  }

  async capture(displayId: string): Promise<DesktopFrame> {
    const displays = await this.displays();
    const display = displays.find((d) => d.id === displayId);
    if (!display) throw new Error("Selected display is unavailable.");
    if (!this.robot.image.supportsPNG) throw new Error("RobotJS PNG support is required for RASQ-Ai evidence bundles.");
    const image = this.robot.screen.capture(display.x, display.y, display.width, display.height);
    const file = path.join(this.temp, "capture.png");
    image.save(file);
    const png = await fs.promises.readFile(file);
    await fs.promises.unlink(file).catch(() => undefined);
    return { png, sha256: createHash("sha256").update(png).digest("hex"), capturedAt: new Date().toISOString(), display, raw: image };
  }

  async locate(frame: DesktopFrame, anchor: DesktopAnchor, anchorPath: string): Promise<DesktopMatch[]> {
    const image = frame.raw as RobotImage | undefined;
    if (!image) throw new Error("RobotJS capture is no longer available.");
    const needle = this.robot.image.load(anchorPath);
    const matches = image.findImages(needle, { tolerance: anchor.tolerance });
    return matches.map((match) => {
      const point = image.toScreenPoint({ x: match.x + Math.floor(needle.width / 2), y: match.y + Math.floor(needle.height / 2) });
      return { x: match.x, y: match.y, width: needle.width, height: needle.height, screenX: point.x, screenY: point.y };
    });
  }

  async click(frame: DesktopFrame, match: DesktopMatch, fraction = 0.5): Promise<void> {
    const image = frame.raw as RobotImage | undefined;
    if (!image) throw new Error("RobotJS capture is no longer available.");
    const point = image.toScreenPoint({ x: match.x + Math.floor(match.width * Math.max(0, Math.min(1, fraction))), y: match.y + Math.floor(match.height / 2) });
    this.robot.moveMouseSmooth(point.x, point.y);
    this.robot.mouseClick("left");
  }

  async holdStart(frame: DesktopFrame, match: DesktopMatch): Promise<void> {
    const image = frame.raw as RobotImage | undefined;
    if (!image) throw new Error("RobotJS capture is no longer available.");
    const point = image.toScreenPoint({ x: match.x + Math.floor(match.width / 2), y: match.y + Math.floor(match.height / 2) });
    this.robot.moveMouseSmooth(point.x, point.y);
    this.robot.mouseToggle("down", "left");
  }

  async hover(frame: DesktopFrame, match: DesktopMatch): Promise<void> {
    const image = frame.raw as RobotImage | undefined;
    if (!image) throw new Error("RobotJS capture is no longer available.");
    const point = image.toScreenPoint({ x: match.x + Math.floor(match.width / 2), y: match.y + Math.floor(match.height / 2) });
    this.robot.moveMouseSmooth(point.x, point.y);
  }

  async type(value: string): Promise<void> {
    this.robot.keyTap("a", process.platform === "darwin" ? "command" : "control");
    this.robot.typeString(value);
  }

  async select(value: string): Promise<void> {
    if (value && value !== "first option") this.robot.typeString(value);
    else this.robot.keyTap("down");
    this.robot.keyTap("enter");
  }

  async releaseAll(): Promise<void> {
    for (const key of ["control", "shift", "alt", "command"]) {
      try { this.robot.keyToggle(key, "up"); } catch { /* platform may not support command */ }
    }
    try { this.robot.mouseToggle("up", "left"); } catch { /* best-effort cleanup */ }
  }
}
