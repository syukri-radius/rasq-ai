"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addEdge, Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, type Connection, type Node, type NodeProps } from "@xyflow/react";
import { Download, FileJson, FlaskConical, Play, Plus, Save, Sparkles, Trash2, Upload } from "lucide-react";
import ModelPicker from "@/components/ModelPicker";
import { api, Badge, Btn, Card, download, inputCls, Notice, PageHeader, useProject } from "@/components/ui";
import { fromFlow, NT, toFlow, type N8nWorkflow } from "@/lib/n8n";

type WfRow = { id: string; name: string; version: number; nodes: number; provenance: string };
type Step = { id: string; position: number; nodeId: string; nodeName: string; nodeType: string; status: string; message: string; durationMs: number; evidence: Record<string, unknown> };
type Run = { id: string; mode: string; status: string; error: string | null; summary: Record<string, number>; startedAt: string; finishedAt: string | null; targetUrl: string };

const RING: Record<string, string> = { idle: "border-slate-300", pending: "border-slate-300", running: "border-sky-500 ring-4 ring-sky-200 animate-pulse", passed: "border-emerald-500 bg-emerald-50", failed: "border-rose-500 bg-rose-50", error: "border-rose-600 bg-rose-50", warning: "border-amber-500 bg-amber-50", "needs-review": "border-violet-500 bg-violet-50", skipped: "border-slate-400 bg-slate-100" };
const KIND: Record<string, string> = { [NT.trigger]: "Trigger", [NT.open]: "Open target", [NT.section]: "Test case", [NT.action]: "Action", [NT.assert]: "Assert" };

function RasqNode({ data, selected }: NodeProps) {
  const d = data as { name: string; nodeType: string; parameters: Record<string, unknown>; status: string };
  const p = d.parameters;
  const sub = d.nodeType === NT.action ? `${p.action}${p.anchorStatus === "unresolved" ? " · no anchor" : ""}` : d.nodeType === NT.assert ? String(p.kind) : d.nodeType === NT.open ? String(p.url ?? "") : "";
  return (
    <div className={`w-52 rounded-lg border-2 bg-white px-3 py-2 text-xs shadow ${RING[d.status] ?? RING.idle} ${selected ? "outline outline-2 outline-indigo-500" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">{KIND[d.nodeType] ?? d.nodeType}</div>
      <div className="truncate text-sm font-semibold" title={d.name}>{d.name}</div>
      {sub && <div className="truncate text-slate-500">{sub}</div>}
      {d.status !== "idle" && <div className="mt-1 text-[10px] font-semibold uppercase text-slate-600">{d.status}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { rasq: RasqNode };

function Editor() {
  const { current } = useProject();
  const [list, setList] = useState<WfRow[]>([]);
  const [wfId, setWfId] = useState("");
  const [base, setBase] = useState<N8nWorkflow | null>(null);
  const [name, setName] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<import("@xyflow/react").Edge>([]);
  const [selId, setSelId] = useState("");
  const [paramText, setParamText] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn" | "info"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [target, setTarget] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [addType, setAddType] = useState<string>(NT.action);
  const poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    if (!current) return;
    const l = await api<WfRow[]>(`/api/workflows?projectId=${current.id}`);
    setList(l);
    setWfId((c) => (l.some((w) => w.id === c) ? c : l[0]?.id ?? ""));
  }, [current]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadList(); }, [loadList]);

  const loadRuns = useCallback(async (id: string) => setRuns(await api<Run[]>(`/api/runs?workflowId=${id}`)), []);

  useEffect(() => {
    if (!wfId) { setBase(null); setNodes([]); setEdges([]); return; }
    void (async () => {
      const w = await api<{ name: string; n8n: N8nWorkflow }>(`/api/workflows/${wfId}`);
      setBase(w.n8n); setName(w.name);
      const f = toFlow(w.n8n);
      setNodes(f.nodes); setEdges(f.edges); setDirty(false); setSelId(""); setRun(null); setSteps([]);
      const open = w.n8n.nodes.find((n) => n.type === NT.open);
      setTarget(String(open?.parameters.url ?? current?.targetUrl ?? ""));
      void loadRuns(wfId);
    })();
  }, [wfId, setNodes, setEdges, loadRuns, current]);

  useEffect(() => () => clearInterval(poll.current), []);

  const sel = nodes.find((n) => n.id === selId);
  useEffect(() => { setParamText(sel ? JSON.stringify((sel.data as { parameters: unknown }).parameters, null, 2) : ""); }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyStatuses = useCallback((st: Step[]) => {
    const m = new Map(st.map((s) => [s.nodeId, s.status]));
    setNodes((ns) => ns.map((n) => ((n.data as { status: string }).status === (m.get(n.id) ?? "idle") ? n : { ...n, data: { ...n.data, status: m.get(n.id) ?? "idle" } })));
  }, [setNodes]);

  const watch = useCallback((id: string) => {
    clearInterval(poll.current);
    const tick = async () => {
      const r = await api<{ run: Run; steps: Step[] }>(`/api/runs/${id}`);
      setRun(r.run); setSteps(r.steps); applyStatuses(r.steps);
      if (r.run.status !== "running") { clearInterval(poll.current); void loadRuns(r.run ? wfId : ""); }
    };
    void tick();
    poll.current = setInterval(() => void tick().catch(() => undefined), 900);
  }, [applyStatuses, loadRuns, wfId]);

  const onConnect = useCallback((c: Connection) => { setEdges((e) => addEdge(c, e)); setDirty(true); }, [setEdges]);

  const current8n = () => (base ? fromFlow(base, nodes, edges) : null);
  const save = async () => {
    const wf = current8n();
    if (!wf) return false;
    try {
      await api(`/api/workflows/${wfId}`, { method: "PUT", json: { name, n8n: { ...wf, name } } });
      setDirty(false); setMsg({ kind: "ok", text: "Workflow saved (n8n-compatible JSON)." }); void loadList();
      return true;
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Save failed" }); return false; }
  };

  const generate = async () => {
    if (!current) return;
    try {
      setMsg({ kind: "info", text: "Building workflow from test cases…" });
      const r = await api<{ id: string; nodes: number; unresolvedAnchors: number; notes: string }>("/api/workflows", { json: { projectId: current.id, mode: "generate" } });
      await loadList(); setWfId(r.id);
      setMsg({ kind: r.unresolvedAnchors ? "warn" : "ok", text: `Created ${r.nodes} nodes. ${r.unresolvedAnchors} action step(s) have no visual anchor and will be skipped (not guessed) at run time. ${r.notes}` });
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed" }); }
  };

  const addNode = () => {
    const names = new Set(nodes.map((n) => (n.data as { name: string }).name));
    const base0 = addType === NT.action ? "Action" : addType === NT.assert ? "Assert" : addType === NT.open ? "Open Target" : "Section";
    let i = 1; let nm = base0;
    while (names.has(nm)) nm = `${base0} ${++i}`;
    const params = addType === NT.action ? { action: "click", target: "", data: "", controlId: null, anchorStatus: "unresolved", region: null, locatorHash: "", anchorThreshold: 0.55, strict: false } : addType === NT.assert ? { kind: "manualReview", value: "", expected: "" } : addType === NT.open ? { url: target, viewportWidth: 1280, viewportHeight: 800 } : {};
    const id = crypto.randomUUID();
    const from = sel ?? nodes[nodes.length - 1];
    setNodes((ns) => [...ns, { id, type: "rasq", position: { x: (from?.position.x ?? 0) + 240, y: (from?.position.y ?? 0) + (sel ? 0 : 0) }, data: { name: nm, nodeType: addType, parameters: params, notes: "", status: "idle" } }]);
    if (from) setEdges((es) => [...es, { id: `${from.id}-0-${id}`, source: from.id, target: id }]);
    setSelId(id); setDirty(true);
  };

  const applyNode = () => {
    if (!sel) return;
    try {
      const parameters = JSON.parse(paramText);
      setNodes((ns) => ns.map((n) => (n.id === sel.id ? { ...n, data: { ...n.data, parameters } } : n)));
      setDirty(true); setMsg({ kind: "ok", text: "Node parameters updated (remember to Save)." });
    } catch { setMsg({ kind: "error", text: "Parameters must be valid JSON." }); }
  };
  const rename = (v: string) => {
    if (!sel) return;
    if (nodes.some((n) => n.id !== sel.id && (n.data as { name: string }).name === v)) return setMsg({ kind: "warn", text: "Node names must be unique (n8n connects by name)." });
    setNodes((ns) => ns.map((n) => (n.id === sel.id ? { ...n, data: { ...n.data, name: v } } : n)));
    setDirty(true);
  };

  const start = async (mode: "playwright" | "dry-run") => {
    if (dirty && !(await save())) return;
    try {
      setSteps([]); applyStatuses([]);
      const r = await api<{ id: string }>("/api/runs", { json: { workflowId: wfId, mode, targetUrl: target } });
      watch(r.id);
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Run failed" }); }
  };

  const importFile = async (f: File | undefined) => {
    if (!f || !current) return;
    try {
      const n8n = JSON.parse(await f.text());
      const r = await api<{ id: string }>("/api/workflows", { json: { projectId: current.id, mode: "import", n8n, name: f.name.replace(/\.json$/i, "") } });
      await loadList(); setWfId(r.id); setMsg({ kind: "ok", text: "n8n workflow imported." });
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Import failed" }); }
  };

  const running = run?.status === "running";
  const selStep = steps.find((s) => s.nodeId === selId);
  const flowProps = useMemo(() => ({ nodeTypes, fitView: true, minZoom: 0.1, deleteKeyCode: ["Backspace", "Delete"] as string[] }), []);

  return (
    <>
      <PageHeader title="Workflows & Live Run Monitor" subtitle="Test workflows are n8n-compatible JSON edited on a ReactFlow canvas (react-workflow-editor architecture) and executed in-app by Playwright. Node colours show real step results as they happen.">
        <ModelPicker task="workflow_creation" />
      </PageHeader>
      {msg && <div className="mb-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${inputCls} !w-64`} value={wfId} onChange={(e) => setWfId(e.target.value)}>
            {list.length === 0 && <option value="">No workflows</option>}
            {list.map((w) => <option key={w.id} value={w.id}>{w.name} (v{w.version}, {w.nodes} nodes)</option>)}
          </select>
          <Btn variant="primary" onClick={generate} disabled={!current}><Sparkles size={14} /> Generate from test cases</Btn>
          <Btn onClick={async () => { if (!current) return; const r = await api<{ id: string }>("/api/workflows", { json: { projectId: current.id, mode: "blank" } }); await loadList(); setWfId(r.id); }}><Plus size={14} /> Blank</Btn>
          <Btn onClick={() => fileRef.current?.click()}><Upload size={14} /> Import n8n JSON</Btn>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
          {wfId && <>
            <input className={`${inputCls} !w-56`} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
            <Btn variant={dirty ? "success" : "ghost"} onClick={save}><Save size={14} /> Save{dirty ? " *" : ""}</Btn>
            <a href={`/api/workflows/${wfId}/export`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"><FileJson size={14} /> Export n8n</a>
            <Btn onClick={() => { const wf = current8n(); if (wf) download(`${name || "workflow"}.n8n.json`, JSON.stringify({ ...wf, name }, null, 2)); }}><Download size={14} /> Export (unsaved)</Btn>
            <Btn variant="danger" onClick={async () => { if (confirm("Delete this workflow and its runs?")) { await api(`/api/workflows/${wfId}`, { method: "DELETE" }); setWfId(""); void loadList(); } }}><Trash2 size={14} /></Btn>
          </>}
        </div>
      </Card>

      {wfId && (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Target URL</span>
              <input className={`${inputCls} !w-80`} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://… or /demo-target" />
              <Btn variant="success" onClick={() => start("playwright")} disabled={running || !target}><Play size={14} /> Run with Playwright</Btn>
              <Btn onClick={() => start("dry-run")} disabled={running}><FlaskConical size={14} /> Dry run (validate only)</Btn>
              {run && <span className="ml-auto flex items-center gap-2">Run {run.mode}: <Badge>{run.status}</Badge> {Object.entries(run.summary ?? {}).map(([k, v]) => <Badge key={k}>{`${k}: ${v}`}</Badge>)}</span>}
            </div>
            {run?.error && <div className="mt-2 whitespace-pre-wrap"><Notice kind="error">{run.error}</Notice></div>}
            <p className="mt-2 text-xs text-slate-500">Actions use visual anchors (scaled region + template-hash check). Steps without an anchor are skipped, never guessed. Assertions without an automatable oracle become “needs-review”. Dry runs execute nothing.</p>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <div className="h-[600px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <ReactFlow nodes={nodes} edges={edges} onNodesChange={(c) => { onNodesChange(c); if (c.some((x) => x.type === "position" || x.type === "remove")) setDirty(true); }} onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === "remove")) setDirty(true); }} onConnect={onConnect} onNodeClick={(_, n) => setSelId(n.id)} onPaneClick={() => setSelId("")} {...flowProps}>
                <Background gap={18} />
                <Controls />
                <MiniMap pannable zoomable />
              </ReactFlow>
            </div>
            <div className="space-y-4">
              <Card title="Node" actions={<div className="flex gap-1"><select className="rounded border px-1 text-xs" value={addType} onChange={(e) => setAddType(e.target.value)}><option value={NT.action}>Action</option><option value={NT.assert}>Assert</option><option value={NT.open}>Open target</option><option value={NT.section}>Section</option></select><Btn className="!px-2 !py-0.5 text-xs" onClick={addNode}><Plus size={12} /> Add</Btn></div>}>
                {sel ? (
                  <div className="space-y-2 text-sm">
                    <input className={inputCls} value={(sel.data as { name: string }).name} onChange={(e) => rename(e.target.value)} />
                    <div className="text-xs text-slate-500">{(sel.data as { nodeType: string }).nodeType}</div>
                    <textarea className={`${inputCls} h-48 font-mono text-xs`} value={paramText} onChange={(e) => setParamText(e.target.value)} />
                    <Btn onClick={applyNode}>Apply parameters</Btn>
                    {selStep && (
                      <div className="rounded-lg border bg-slate-50 p-2 text-xs">
                        <div className="mb-1 flex items-center gap-2"><Badge>{selStep.status}</Badge>{selStep.durationMs} ms</div>
                        <p>{selStep.message}</p>
                        {typeof selStep.evidence.shot === "string" && run && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/runs/${run.id}/shots/${selStep.evidence.shot}`} alt="step evidence" className="mt-2 w-full rounded border" />
                        )}
                      </div>
                    )}
                  </div>
                ) : <p className="text-sm text-slate-500">Select a node to edit its parameters or see its run evidence. Drag handles to connect nodes; press Delete to remove.</p>}
              </Card>
              <Card title="Run history">
                <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                  {runs.map((r) => (
                    <li key={r.id}><button onClick={() => watch(r.id)} className={`flex w-full items-center justify-between rounded border p-1.5 text-left ${run?.id === r.id ? "border-indigo-400 bg-indigo-50" : ""}`}><span>{new Date(r.startedAt).toLocaleString()} · {r.mode}</span><Badge>{r.status}</Badge></button></li>
                  ))}
                  {runs.length === 0 && <li className="text-slate-500">No runs yet.</li>}
                </ul>
              </Card>
            </div>
          </div>

          {steps.length > 0 && (
            <Card title="Execution log" className="mt-4">
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500"><tr><th className="p-1">#</th><th className="p-1">Node</th><th className="p-1">Status</th><th className="p-1">ms</th><th className="p-1">Message</th></tr></thead>
                  <tbody>
                    {steps.map((s) => (
                      <tr key={s.id} className="cursor-pointer border-t align-top hover:bg-slate-50" onClick={() => setSelId(s.nodeId)}>
                        <td className="p-1">{s.position + 1}</td><td className="p-1 font-medium">{s.nodeName}</td><td className="p-1"><Badge>{s.status}</Badge></td><td className="p-1">{s.durationMs}</td><td className="p-1">{s.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}

export default function WorkflowsPage() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}
