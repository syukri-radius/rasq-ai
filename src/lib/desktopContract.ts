import { z } from "zod";

export const DESKTOP_CONTRACT = "rasq-desktop.v1" as const;
export const DESKTOP_PROTOCOL_VERSION = "1" as const;
export const DESKTOP_COMPILER_VERSION = "1.0.0" as const;
export const DESKTOP_LIMITS = {
  bundleFiles: 32,
  fileBytes: 8 * 1024 * 1024,
  bundleBytes: 24 * 1024 * 1024,
  evidenceBytes: 6 * 1024 * 1024,
  eventBatch: 100,
  pollMs: 750,
  staleAfterMs: 10_000,
} as const;

const id = z.string().min(1).max(160);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const boundedText = (max: number) => z.string().max(max);

export const DesktopRunStatusSchema = z.enum(["pending", "running", "passed", "failed", "warning", "skipped", "needs-review", "error"]);
export type DesktopRunStatus = z.infer<typeof DesktopRunStatusSchema>;
export const DesktopSessionStateSchema = z.enum(["queued", "assigned", "preflight", "awaiting-operator-confirmation", "running", "completing", "terminal"]);
export type DesktopSessionState = z.infer<typeof DesktopSessionStateSchema>;

export const DesktopDisplaySchema = z.object({
  id: z.string().min(1).max(128),
  x: z.number().int().min(-100_000).max(100_000),
  y: z.number().int().min(-100_000).max(100_000),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
  isMain: z.boolean(),
  scaleX: z.number().positive().max(16).optional(),
  scaleY: z.number().positive().max(16).optional(),
}).strict();
export type DesktopDisplay = z.infer<typeof DesktopDisplaySchema>;

export const DesktopTargetSchema = z.object({
  applicationName: boundedText(120),
  windowTitle: boundedText(200),
  displayId: z.string().max(128),
  requireFocus: z.boolean().default(true),
}).strict();
export type DesktopTarget = z.infer<typeof DesktopTargetSchema>;

export const DesktopCapabilitiesSchema = z.object({
  driver: z.enum(["robotjs", "mock"]),
  supportsInput: z.boolean(),
  actions: z.array(z.string().max(40)).max(30),
  platformNotes: z.array(boundedText(300)).max(10),
}).strict();
export type DesktopCapabilities = z.infer<typeof DesktopCapabilitiesSchema>;

export const DesktopPermissionsSchema = z.object({
  screenCapture: z.enum(["granted", "denied", "unknown"]),
  accessibility: z.enum(["granted", "denied", "unknown", "not-required"]),
  interactiveSession: z.enum(["confirmed", "locked", "unknown"]),
}).strict();
export type DesktopPermissions = z.infer<typeof DesktopPermissionsSchema>;

export const DesktopRegionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
}).strict();

export const DesktopAnchorSchema = z.object({
  controlId: id,
  screenId: id,
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
  region: DesktopRegionSchema,
  locatorHash: z.string().max(80),
  asset: z.string().regex(/^anchors\/[a-f0-9]{24}\.png$/),
  tolerance: z.number().min(0).max(0.5),
  strict: z.literal(true),
}).strict();
export type DesktopAnchor = z.infer<typeof DesktopAnchorSchema>;

const StepBase = z.object({
  nodeId: id,
  nodeName: boundedText(200),
  position: z.number().int().nonnegative(),
  caseKey: z.string().max(120).nullable(),
  requirementIds: z.array(z.string().max(160)).max(50),
}).strict();

export const DesktopMarkerStepSchema = StepBase.extend({
  kind: z.enum(["trigger", "target", "section"]),
}).strict();

export const DesktopActionSchema = z.enum(["navigate", "wait", "click", "hold", "hover", "type", "select", "check", "uncheck", "toggle", "slider"]);
export type DesktopAction = z.infer<typeof DesktopActionSchema>;
export const DesktopActionStepSchema = StepBase.extend({
  kind: z.literal("action"),
  action: DesktopActionSchema,
  anchor: DesktopAnchorSchema.nullable(),
  data: boundedText(10_000).nullable(),
  secretRef: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).nullable(),
}).strict();

export const DesktopAssertionStepSchema = StepBase.extend({
  kind: z.literal("assert"),
  assertion: z.enum(["screenshotChanged", "manualReview"]),
  expected: boundedText(4000),
  maxDurationMs: z.number().int().min(1).max(60_000).nullable(),
}).strict();

export const DesktopStepSchema = z.discriminatedUnion("kind", [DesktopMarkerStepSchema, DesktopActionStepSchema, DesktopAssertionStepSchema]);
export type DesktopStep = z.infer<typeof DesktopStepSchema>;

export const DesktopManifestSchema = z.object({
  rasqDesktopVersion: z.literal(DESKTOP_CONTRACT),
  compilerVersion: z.string().max(30),
  bundleId: sha256,
  projectId: id,
  workflowId: id,
  workflowVersion: z.number().int().positive(),
  sourceWorkflowSha256: sha256,
  sourceProvenance: boundedText(300),
  target: DesktopTargetSchema,
  limitations: z.array(boundedText(500)).max(30),
  steps: z.array(DesktopStepSchema).min(1).max(2000),
}).strict();
export type DesktopManifest = z.infer<typeof DesktopManifestSchema>;

export const DesktopDiagnosticSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string().max(80),
  message: boundedText(1000),
  nodeId: z.string().max(160).nullable(),
  remediation: boundedText(1000),
}).strict();
export type DesktopDiagnostic = z.infer<typeof DesktopDiagnosticSchema>;

export const DesktopBundleFileSchema = z.object({
  bytes: z.number().int().nonnegative().max(DESKTOP_LIMITS.fileBytes),
  sha256,
}).strict();
export const DesktopBundleManifestSchema = z.object({
  rasqDesktopVersion: z.literal(DESKTOP_CONTRACT),
  bundleId: sha256,
  files: z.record(z.string(), DesktopBundleFileSchema),
}).strict();

export const DesktopStepEventSchema = z.object({
  nodeId: id,
  status: DesktopRunStatusSchema.exclude(["pending", "running"]),
  message: boundedText(1000),
  durationMs: z.number().int().nonnegative().max(86_400_000),
  evidence: z.record(z.string(), z.unknown()).default({}),
}).strict();
export type DesktopStepEvent = z.infer<typeof DesktopStepEventSchema>;

export const DesktopSessionEventSchema = z.object({
  state: DesktopSessionStateSchema,
  message: boundedText(1000),
}).strict();

export const DesktopCompleteEventSchema = z.object({
  status: DesktopRunStatusSchema.exclude(["pending", "running"]),
  message: boundedText(1000),
  summary: z.record(z.string(), z.number().int().nonnegative()),
}).strict();

export const DesktopEventSchema = z.object({
  seq: z.number().int().positive(),
  type: z.enum(["session", "step", "complete"]),
  payload: z.unknown(),
}).strict();
export type DesktopEvent = z.infer<typeof DesktopEventSchema>;

export const DesktopAgentPollSchema = z.object({
  agentVersion: z.string().min(1).max(40),
  capabilities: DesktopCapabilitiesSchema,
  displays: z.array(DesktopDisplaySchema).max(16),
  permissions: DesktopPermissionsSchema,
  currentRunId: z.string().max(160).nullable(),
}).strict();
export type DesktopAgentPoll = z.infer<typeof DesktopAgentPollSchema>;

export const DesktopEvidenceSchema = z.object({
  nodeId: id.nullable(),
  kind: z.enum(["before", "after", "preview"]),
  mimeType: z.literal("image/png"),
  dataBase64: z.string().min(8).max(Math.ceil(DESKTOP_LIMITS.evidenceBytes * 4 / 3) + 8),
  sha256,
  capturedAt: z.string().datetime(),
  sequence: z.number().int().positive(),
  display: DesktopDisplaySchema.nullable(),
}).strict();
export type DesktopEvidence = z.infer<typeof DesktopEvidenceSchema>;

export type DesktopAssignment = {
  runId: string;
  mode: "attended" | "dry-run";
  state: string;
  nextSequence: number;
  confirmed: boolean;
  cancelRequested: boolean;
};

export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)]));
    return v;
  };
  return JSON.stringify(normalize(value));
}
