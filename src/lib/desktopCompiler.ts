import { createHash } from "node:crypto";
import sharp from "sharp";
import { NT, type N8nNode, type N8nWorkflow } from "./n8n";
import {
  canonicalJson,
  DESKTOP_COMPILER_VERSION,
  DesktopManifestSchema,
  DesktopTargetSchema,
  type DesktopAction,
  type DesktopAnchor,
  type DesktopDiagnostic,
  type DesktopManifest,
  type DesktopStep,
  type DesktopTarget,
} from "./desktopContract";

export type DesktopScreenSource = {
  id: string;
  projectId: string;
  width: number;
  height: number;
  imagePath: string;
};
export type DesktopControlSource = {
  id: string;
  screenId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locatorHash: string;
};
export type DesktopWorkflowSource = {
  id: string;
  projectId: string;
  version: number;
  provenance: string;
  n8n: N8nWorkflow;
};
export type DesktopCompileInput = {
  workflow: DesktopWorkflowSource;
  screens: DesktopScreenSource[];
  controls: DesktopControlSource[];
  target?: Partial<DesktopTarget>;
  readImage: (screen: DesktopScreenSource) => Promise<Buffer>;
};
export type DesktopCompilation = {
  manifest: DesktopManifest;
  diagnostics: DesktopDiagnostic[];
  anchors: Record<string, Buffer>;
};

const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const text = (value: unknown, max = 4000) => String(value ?? "").slice(0, max);
const nullableText = (value: unknown) => value === null || value === undefined || value === "" ? null : text(value, 10_000);

function linearOrder(workflow: N8nWorkflow, diagnostics: DesktopDiagnostic[]): N8nNode[] {
  const nodes = workflow.nodes;
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const triggers = nodes.filter((n) => n.type === NT.trigger);
  const error = (code: string, message: string, nodeId: string | null = null, remediation = "Use one connected, sequential workflow path for desktop compilation.") => diagnostics.push({ severity: "error", code, message, nodeId, remediation });
  if (triggers.length !== 1) {
    error("DESKTOP_TRIGGER_COUNT", `Desktop compilation requires exactly one manual trigger; found ${triggers.length}.`, triggers[0]?.id ?? null);
    return [];
  }
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const node of nodes) {
    const targets = (workflow.connections[node.name]?.main ?? []).flatMap((outputs) => (outputs ?? []).map((edge) => edge.node));
    outgoing.set(node.name, targets);
    if (targets.length > 1) error("DESKTOP_BRANCH_UNSUPPORTED", `Node "${node.name}" has ${targets.length} outgoing paths.`, node.id);
    for (const target of targets) {
      if (!byName.has(target)) error("DESKTOP_MISSING_NODE", `Connection from "${node.name}" references missing node "${target}".`, node.id, "Repair or remove the broken connection.");
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
      if ((incoming.get(target) ?? 0) > 1) error("DESKTOP_JOIN_UNSUPPORTED", `Node "${target}" has multiple incoming paths.`, byName.get(target)?.id ?? null);
    }
  }
  const ordered: N8nNode[] = [];
  const seen = new Set<string>();
  let current: N8nNode | undefined = triggers[0];
  while (current && !seen.has(current.name)) {
    seen.add(current.name);
    ordered.push(current);
    const next: string | undefined = outgoing.get(current.name)?.[0];
    current = next ? byName.get(next) : undefined;
  }
  if (seen.size !== nodes.length) error("DESKTOP_GRAPH_NOT_LINEAR", `Only ${seen.size} of ${nodes.length} nodes form the trigger's sequential path.`, null, "Remove disconnected/cyclic nodes and connect every intended step in one path.");
  return ordered;
}

const supportedActions = new Set<DesktopAction>(["navigate", "wait", "click", "type", "select", "check", "uncheck", "toggle", "slider"]);

export async function compileDesktopWorkflow(input: DesktopCompileInput): Promise<DesktopCompilation> {
  const diagnostics: DesktopDiagnostic[] = [];
  const anchors: Record<string, Buffer> = {};
  const { workflow } = input;
  const ordered = linearOrder(workflow.n8n, diagnostics);
  const screens = new Map(input.screens.filter((s) => s.projectId === workflow.projectId).map((s) => [s.id, s]));
  const controls = new Map(input.controls.map((c) => [c.id, c]));
  const target = DesktopTargetSchema.parse({
    applicationName: input.target?.applicationName ?? "",
    windowTitle: input.target?.windowTitle ?? "",
    displayId: input.target?.displayId ?? "",
    requireFocus: input.target?.requireFocus ?? true,
  });
  const steps: DesktopStep[] = [];
  let position = 0;

  const sourceContext = (node: N8nNode) => ({
    nodeId: node.id,
    nodeName: text(node.name, 200),
    position: position++,
    caseKey: nullableText(node.parameters.caseKey)?.slice(0, 120) ?? null,
    requirementIds: Array.isArray(node.parameters.requirementIds) ? node.parameters.requirementIds.slice(0, 50).map((x) => text(x, 160)) : [],
  });
  const addError = (node: N8nNode, code: string, message: string, remediation: string) => diagnostics.push({ severity: "error", code, message, nodeId: node.id, remediation });

  for (const node of ordered) {
    if (node.type === NT.trigger || node.type === NT.section || node.type === NT.open) {
      steps.push({ ...sourceContext(node), kind: node.type === NT.trigger ? "trigger" : node.type === NT.section ? "section" : "target" });
      continue;
    }
    if (node.type === NT.action) {
      const action = text(node.parameters.action, 40) as DesktopAction;
      if (!supportedActions.has(action)) {
        addError(node, "DESKTOP_ACTION_UNSUPPORTED", `Action "${action}" is not implemented by the desktop compiler.`, "Use click/type/select/check/uncheck/toggle/slider/wait/navigate, or add a separately tested native adapter.");
        continue;
      }
      let anchor: DesktopAnchor | null = null;
      if (!["navigate", "wait"].includes(action)) {
        const controlId = nullableText(node.parameters.controlId);
        const control = controlId ? controls.get(controlId) : undefined;
        if (!control || controlId !== control.id) {
          addError(node, "DESKTOP_ANCHOR_UNRESOLVED", `Action "${node.name}" has no authoritative saved control.`, "Bind a control from this project's saved visual scans before compiling.");
          continue;
        }
        const screen = screens.get(control.screenId);
        if (!screen) {
          addError(node, "DESKTOP_SCREEN_UNKNOWN", `Control "${controlId}" does not belong to a screen in this project.`, "Rebind the step to an authoritative project control.");
          continue;
        }
        const region = node.parameters.region as { x?: number; y?: number; w?: number; h?: number } | null;
        const box = {
          x: Math.round(Number(region?.x ?? control.x)),
          y: Math.round(Number(region?.y ?? control.y)),
          w: Math.round(Number(region?.w ?? control.w)),
          h: Math.round(Number(region?.h ?? control.h)),
        };
        if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0 || box.x + box.w > screen.width || box.y + box.h > screen.height) {
          addError(node, "DESKTOP_ANCHOR_BOUNDS", `Anchor "${controlId}" exceeds its ${screen.width}×${screen.height} source image.`, "Edit the control bounds against the original screen and compile again.");
          continue;
        }
        const asset = `anchors/${hash(controlId).slice(0, 24)}.png`;
        try {
          const source = await input.readImage(screen);
          anchors[asset] = await sharp(source, { limitInputPixels: 100_000_000 }).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
        } catch (e) {
          addError(node, "DESKTOP_ANCHOR_IMAGE", `Could not create anchor pixels for "${controlId}": ${e instanceof Error ? e.message : String(e)}`, "Restore the saved screen image or recreate the visual scan.");
          continue;
        }
        anchor = {
          controlId,
          screenId: screen.id,
          sourceWidth: screen.width,
          sourceHeight: screen.height,
          region: box,
          locatorHash: text(control.locatorHash, 80),
          asset,
          tolerance: typeof node.parameters.desktopTolerance === "number" ? Math.max(0, Math.min(0.5, node.parameters.desktopTolerance)) : 0.1,
          strict: true,
        };
      }
      let data = nullableText(node.parameters.data);
      let secretRef: string | null = null;
      if (typeof node.parameters.secretRef === "string" && node.parameters.secretRef) secretRef = text(node.parameters.secretRef, 64);
      if (data?.startsWith("<FIXTURE")) {
        if (!secretRef) {
          addError(node, "DESKTOP_SECRET_REF_REQUIRED", `Credential fixture in "${node.name}" has no explicit local secret reference.`, "Set secretRef to an environment-variable name available only on the enrolled desktop agent.");
          continue;
        }
        data = null;
      }
      if (secretRef && !/^[A-Z][A-Z0-9_]{0,63}$/.test(secretRef)) {
        addError(node, "DESKTOP_SECRET_REF_INVALID", `Secret reference "${secretRef}" is not a valid environment-variable name.`, "Use an uppercase environment-variable name; never place the secret value in the workflow.");
        continue;
      }
      if (secretRef) data = null;
      if (action === "wait") {
        const ms = Number(data ?? 500);
        if (!Number.isFinite(ms) || ms < 0 || ms > 10_000) {
          addError(node, "DESKTOP_WAIT_INVALID", `Wait "${node.name}" must be between 0 and 10000 ms.`, "Use a bounded numeric wait.");
          continue;
        }
        data = String(ms);
      }
      steps.push({ ...sourceContext(node), kind: "action", action, anchor, data, secretRef });
      continue;
    }
    if (node.type === NT.assert) {
      const assertion = text(node.parameters.kind || "manualReview", 80);
      if (assertion !== "screenshotChanged" && assertion !== "manualReview") {
        addError(node, "DESKTOP_ASSERTION_UNSUPPORTED", `Assertion "${assertion}" is web-specific or not implemented for desktop execution.`, "Use screenshotChanged or manualReview, or implement a separately tested desktop OCR/accessibility oracle.");
        continue;
      }
      const max = typeof node.parameters.maxDurationMs === "number" ? Math.round(node.parameters.maxDurationMs) : null;
      if (max !== null && (!Number.isFinite(max) || max < 1 || max > 60_000)) {
        addError(node, "DESKTOP_ASSERTION_TIMEOUT", `Assertion timeout "${node.parameters.maxDurationMs}" is outside 1–60000 ms.`, "Set a bounded numeric assertion timeout.");
        continue;
      }
      steps.push({ ...sourceContext(node), kind: "assert", assertion, expected: text(node.parameters.expected), maxDurationMs: max });
      continue;
    }
    addError(node, "DESKTOP_NODE_UNSUPPORTED", `Node type "${node.type}" is not supported by the desktop compiler.`, "Remove the node or provide a versioned desktop adapter.");
  }

  if (!target.windowTitle) diagnostics.push({ severity: "warning", code: "DESKTOP_TARGET_REQUIRED", message: "No target window title is embedded in this preview.", nodeId: null, remediation: "Select the exact target window before creating an attended run." });
  if (!target.displayId) diagnostics.push({ severity: "info", code: "DESKTOP_DISPLAY_MAIN", message: "No display is selected; the agent will request its main display.", nodeId: null, remediation: "Select an enrolled agent display for reproducible execution." });
  const limitations = [
    "Attended execution uses a fixed manifest runner; robotjs.cjs is a deterministic portable export, not remotely evaluated source.",
    "Desktop anchors require exactly one RobotJS image match. A missing or ambiguous match blocks input.",
    "Pixel changes prove visual transitions only, not exact business outcomes.",
    "The portable script cannot verify/focus the OS window; the desktop agent applies the available platform adapter or records its limitation.",
    "Native upload/download dialogs, web DOM text/URL assertions, branching, and autonomous anchor repair are not supported by this compiler version.",
    ...(target.requireFocus ? [] : ["Target focus verification was disabled by the operator; attended execution relies on local target confirmation."]),
  ];
  const unsigned = {
    rasqDesktopVersion: "rasq-desktop.v1" as const,
    compilerVersion: DESKTOP_COMPILER_VERSION,
    bundleId: "0".repeat(64),
    projectId: workflow.projectId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    sourceWorkflowSha256: hash(workflow.n8n),
    sourceProvenance: text(workflow.provenance, 300),
    target,
    limitations,
    steps,
  };
  const manifest = { ...unsigned, bundleId: hash(unsigned) } as DesktopManifest;
  if (steps.length) DesktopManifestSchema.parse(manifest);
  return { manifest, diagnostics, anchors };
}
