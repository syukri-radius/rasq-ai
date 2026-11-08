import type { Edge, Node } from "@xyflow/react";
import type { TestStep } from "./types";

export type N8nNode = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  notes?: string;
};
export type N8nConnections = Record<string, { main: { node: string; type: string; index: number }[][] }>;
export type N8nWorkflow = {
  name: string;
  nodes: N8nNode[];
  connections: N8nConnections;
  active: boolean;
  settings: Record<string, unknown>;
  pinData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

export const NT = {
  trigger: "n8n-nodes-base.manualTrigger",
  section: "n8n-nodes-base.noOp",
  open: "rasq-ai.openTarget",
  action: "rasq-ai.action",
  assert: "rasq-ai.assert",
} as const;

export type ControlRef = {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locatorHash: string;
  screenW: number;
  screenH: number;
};
export type CaseRef = { caseKey: string; title: string; priority: string; category: string; requirementIds: string[]; steps: TestStep[] };
export type Binding = { controlId?: string | null; assertKind?: string | null; assertValue?: string | null };

const uid = () => crypto.randomUUID();

export function buildWorkflow(opts: {
  name: string;
  targetUrl: string;
  cases: CaseRef[];
  controls: Map<string, ControlRef>;
  bindings?: Map<string, Binding>;
  provenance: string;
}): N8nWorkflow {
  const nodes: N8nNode[] = [];
  const connections: N8nConnections = {};
  let prev: N8nNode | null = null;
  const push = (n: Omit<N8nNode, "id" | "typeVersion"> & { typeVersion?: number }, row: number, col: number) => {
    const node: N8nNode = { id: uid(), typeVersion: 1, ...n, position: [col * 230, row * 170] };
    nodes.push(node);
    if (prev) connections[prev.name] = { main: [[{ node: node.name, type: "main", index: 0 }]] };
    prev = node;
    return node;
  };
  push({ name: "Manual Trigger", type: NT.trigger, position: [0, 0], parameters: {}, notes: "Starts the RASQ-Ai test workflow." }, 0, 0);
  push({ name: "Open Target", type: NT.open, position: [0, 0], parameters: { url: opts.targetUrl, viewportWidth: 1280, viewportHeight: 800 } }, 0, 1);

  opts.cases.forEach((tc, row) => {
    const r = row + 1;
    push(
      {
        name: `${tc.caseKey} · ${tc.title}`.slice(0, 70),
        type: NT.section,
        position: [0, 0],
        parameters: { caseKey: tc.caseKey, priority: tc.priority, category: tc.category, requirementIds: tc.requirementIds },
        notes: `Traceability: ${tc.requirementIds.join(", ")}`,
      },
      r,
      0,
    );
    let col = 1;
    let lastAction: string | null = null;
    for (const s of [...tc.steps].sort((a, b) => a.order - b.order)) {
      const b = opts.bindings?.get(`${tc.caseKey}:${s.order}`);
      const cid = b?.controlId !== undefined ? b.controlId : s.controlId;
      const ctl = cid ? opts.controls.get(cid) : undefined;
      const base = { caseKey: tc.caseKey, step: s.order, requirementIds: tc.requirementIds };
      if (s.action === "assert") {
        let kind = b?.assertKind ?? null;
        let value = b?.assertValue ?? "";
        if (!kind) {
          const q = /"([^"]{2,80})"/.exec(s.expected ?? "");
          if (q) {
            kind = "textVisible";
            value = q[1];
          } else if (lastAction === "click") kind = "screenshotChanged";
          else kind = "manualReview";
        }
        // Performance oracle: measure time until a visual transition appears after the click.
        if (toMs(s.expected ?? "") !== null && lastAction === "click" && kind === "manualReview") kind = "screenshotChanged";
        push(
          { name: `${tc.caseKey}.${s.order} assert`, type: NT.assert, position: [0, 0], parameters: { ...base, kind, value, expected: s.expected ?? "", maxDurationMs: /within\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds|seconds|s)\b/i.exec(s.expected ?? "") ? toMs(s.expected ?? "") : null } },
          r,
          col++,
        );
        continue;
      }
      lastAction = s.action;
      push(
        {
          name: `${tc.caseKey}.${s.order} ${s.action}${ctl?.label ? " · " + ctl.label.slice(0, 24) : ""}`,
          type: NT.action,
          position: [0, 0],
          parameters: {
            ...base,
            action: s.action,
            target: s.target,
            data: s.data ?? "",
            controlId: ctl?.id ?? null,
            anchorStatus: ctl ? "bound" : s.action === "navigate" || s.action === "wait" ? "n/a" : "unresolved",
            region: ctl ? { x: ctl.x, y: ctl.y, w: ctl.w, h: ctl.h } : null,
            sourceWidth: ctl?.screenW ?? null,
            sourceHeight: ctl?.screenH ?? null,
            locatorHash: ctl?.locatorHash ?? "",
            anchorThreshold: 0.55,
            strict: false,
          },
        },
        r,
        col++,
      );
    }
  });
  return {
    name: opts.name,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: "v1" },
    pinData: {},
    meta: { generator: "RASQ-Ai", provenance: opts.provenance, note: "rasq-ai.* nodes are executed by the RASQ-Ai Playwright runner; stock n8n will show them as unknown nodes." },
  };
}

function toMs(s: string): number | null {
  const m = /within\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds|seconds|s)\b/i.exec(s);
  if (!m) return null;
  return Math.round(Number(m[1]) * (/^ms|milli/i.test(m[2]) ? 1 : 1000));
}

export function executionOrder(wf: N8nWorkflow): N8nNode[] {
  const byName = new Map(wf.nodes.map((n) => [n.name, n]));
  const start = wf.nodes.find((n) => n.type === NT.trigger) ?? wf.nodes[0];
  if (!start) return [];
  const out: N8nNode[] = [];
  const seen = new Set<string>();
  const q = [start];
  while (q.length) {
    const n = q.shift()!;
    if (seen.has(n.name)) continue;
    seen.add(n.name);
    out.push(n);
    for (const outs of wf.connections[n.name]?.main ?? []) for (const c of outs ?? []) {
      const t = byName.get(c.node);
      if (t) q.push(t);
    }
  }
  return out;
}

export function validateN8n(x: unknown): N8nWorkflow {
  const w = x as Partial<N8nWorkflow> | null;
  if (!w || typeof w !== "object" || !Array.isArray(w.nodes) || typeof w.connections !== "object" || w.connections === null) {
    throw new Error("Not an n8n workflow: expected { nodes: [], connections: {} }");
  }
  const names = new Set<string>();
  const nodes = w.nodes.map((n, i) => {
    if (!n || typeof n.name !== "string" || typeof n.type !== "string") throw new Error(`Node #${i + 1} needs a name and a type`);
    if (names.has(n.name)) throw new Error(`Duplicate node name "${n.name}"`);
    names.add(n.name);
    const pos = Array.isArray(n.position) && n.position.length === 2 ? ([Number(n.position[0]) || 0, Number(n.position[1]) || 0] as [number, number]) : ([i * 220, 0] as [number, number]);
    return { id: n.id || uid(), name: n.name, type: n.type, typeVersion: n.typeVersion ?? 1, position: pos, parameters: (n.parameters ?? {}) as Record<string, unknown>, notes: n.notes };
  });
  return { name: w.name || "Imported workflow", nodes, connections: w.connections as N8nConnections, active: false, settings: w.settings ?? { executionOrder: "v1" }, pinData: w.pinData ?? {}, meta: w.meta };
}

export function toFlow(wf: N8nWorkflow): { nodes: Node[]; edges: Edge[] } {
  const idOf = new Map(wf.nodes.map((n) => [n.name, n.id]));
  const nodes: Node[] = wf.nodes.map((n) => ({
    id: n.id,
    type: "rasq",
    position: { x: n.position[0], y: n.position[1] },
    data: { name: n.name, nodeType: n.type, parameters: n.parameters, notes: n.notes ?? "", status: "idle" },
  }));
  const edges: Edge[] = [];
  for (const [src, v] of Object.entries(wf.connections)) {
    (v.main ?? []).forEach((outs, oi) =>
      (outs ?? []).forEach((c) => {
        const s = idOf.get(src);
        const t = idOf.get(c.node);
        if (s && t) edges.push({ id: `${s}-${oi}-${t}`, source: s, target: t, animated: false });
      }),
    );
  }
  return { nodes, edges };
}

export function fromFlow(base: N8nWorkflow, nodes: Node[], edges: Edge[]): N8nWorkflow {
  const nameOf = new Map(nodes.map((n) => [n.id, String((n.data as { name: string }).name)]));
  const connections: N8nConnections = {};
  for (const e of edges) {
    const s = nameOf.get(e.source);
    const t = nameOf.get(e.target);
    if (!s || !t) continue;
    connections[s] ??= { main: [[]] };
    connections[s].main[0].push({ node: t, type: "main", index: 0 });
  }
  return {
    ...base,
    nodes: nodes.map((n) => {
      const d = n.data as { name: string; nodeType: string; parameters: Record<string, unknown>; notes?: string };
      return { id: n.id, name: d.name, type: d.nodeType, typeVersion: 1, position: [Math.round(n.position.x), Math.round(n.position.y)] as [number, number], parameters: d.parameters, ...(d.notes ? { notes: d.notes } : {}) };
    }),
    connections,
  };
}
