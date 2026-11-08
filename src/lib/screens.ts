import { CONTROL_TYPES } from "./types";

export type InControl = {
  id?: string;
  type: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  evidence: string;
  locatorHash: string;
  perceptionLabel: string;
  aiModel: string | null;
  source: string;
};

/** Validates and normalizes controls shared by screen creation and saved-scan editing. */
export function normalizeControls(input: InControl[] | undefined) {
  return (Array.isArray(input) ? input : [])
    .filter((c) =>
      (CONTROL_TYPES as readonly string[]).includes(c.type) &&
      [c.x, c.y, c.w, c.h, c.confidence].every(Number.isFinite) &&
      c.w > 0 &&
      c.h > 0,
    )
    .slice(0, 500)
    .map((c) => ({
      id: c.id,
      type: c.type,
      label: (c.label ?? "").slice(0, 120),
      x: Math.round(c.x),
      y: Math.round(c.y),
      w: Math.round(c.w),
      h: Math.round(c.h),
      confidence: Math.max(0, Math.min(1, c.confidence)),
      evidence: (c.evidence ?? "").slice(0, 400),
      locatorHash: c.locatorHash ?? "",
      perceptionLabel: c.perceptionLabel ?? "",
      aiModel: c.aiModel ?? null,
      source: c.source ?? "perception",
    }));
}
