import type { DesktopAnchor, DesktopCapabilities, DesktopDisplay, DesktopPermissions, DesktopTarget } from "../../src/lib/desktopContract";

export type DesktopFrame = {
  png: Buffer;
  sha256: string;
  capturedAt: string;
  display: DesktopDisplay;
  raw?: unknown;
};
export type DesktopMatch = {
  x: number;
  y: number;
  width: number;
  height: number;
  screenX: number;
  screenY: number;
};
export type TargetValidation = { verified: boolean; message: string };

export interface DesktopDriver {
  capabilities(): DesktopCapabilities;
  displays(): Promise<DesktopDisplay[]>;
  permissions(): Promise<DesktopPermissions>;
  validateTarget(target: DesktopTarget, allowFocus: boolean): Promise<TargetValidation>;
  capture(displayId: string): Promise<DesktopFrame>;
  locate(frame: DesktopFrame, anchor: DesktopAnchor, anchorPath: string): Promise<DesktopMatch[]>;
  click(frame: DesktopFrame, match: DesktopMatch, fraction?: number): Promise<void>;
  holdStart(frame: DesktopFrame, match: DesktopMatch): Promise<void>;
  hover(frame: DesktopFrame, match: DesktopMatch): Promise<void>;
  type(value: string): Promise<void>;
  select(value: string): Promise<void>;
  releaseAll(): Promise<void>;
}
