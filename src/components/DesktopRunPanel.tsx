"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, Play, ShieldAlert, Square } from "lucide-react";
import { api, Badge, Btn, Card, inputCls, Notice } from "./ui";
import type { DesktopDiagnostic, DesktopDisplay, DesktopTarget } from "@/lib/desktopContract";

type Agent = {
  id: string;
  name: string;
  os: string;
  arch: string;
  agentVersion: string;
  capabilities: { driver: string; supportsInput: boolean; platformNotes: string[] };
  displays: DesktopDisplay[];
  permissions: Record<string, string>;
  availability: string;
  currentRunId: string | null;
  online: boolean;
  revokedAt: string | null;
};
export type DesktopRunView = {
  id: string;
  executor: string;
  mode: string;
  status: string;
  desktopSessionState: string;
  desktopDriver: string;
  desktopConfirmedAt: string | null;
  desktopPreview: { shot?: string; capturedAt?: string; sequence?: number };
};

export default function DesktopRunPanel({ workflowId, run, onRunCreated, onRefresh }: {
  workflowId: string;
  run: DesktopRunView | null;
  onRunCreated: (id: string) => void;
  onRefresh: () => void;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [target, setTarget] = useState<DesktopTarget>({ applicationName: "", windowTitle: "", displayId: "", requireFocus: true });
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnostic[]>([]);
  const [message, setMessage] = useState<{ kind: "info" | "error" | "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      const rows = await api<Agent[]>("/api/desktop/agents");
      setAgents(rows);
      setAgentId((current) => rows.some((a) => a.id === current && !a.revokedAt) ? current : rows.find((a) => a.online && !a.revokedAt)?.id ?? "");
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }); }
  }, []);
  useEffect(() => {
    void loadAgents();
    const timer = setInterval(() => void loadAgents(), 3000);
    return () => clearInterval(timer);
  }, [loadAgents]);

  const agent = agents.find((a) => a.id === agentId);
  useEffect(() => {
    if (!agent) return;
    setTarget((current) => agent.displays.some((d) => d.id === current.displayId) ? current : { ...current, displayId: agent.displays.find((d) => d.isMain)?.id ?? agent.displays[0]?.id ?? "" });
  }, [agent]);

  const preview = async () => {
    setBusy(true);
    try {
      const result = await api<{ diagnostics: DesktopDiagnostic[]; executable: boolean; bundleSha256: string | null; stepCount: number; anchorCount: number }>(`/api/desktop/workflows/${workflowId}`, { json: { target } });
      setDiagnostics(result.diagnostics);
      setMessage({ kind: result.executable ? "ok" : "error", text: `${result.stepCount} steps, ${result.anchorCount} anchor assets. ${result.executable ? `Bundle ${result.bundleSha256?.slice(0, 16)}… is ready.` : "Blocking diagnostics must be resolved."}` });
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const start = async (mode: "attended" | "dry-run") => {
    setBusy(true);
    try {
      const result = await api<{ id: string; bundleSha256: string }>("/api/desktop/runs", { json: { workflowId, agentId, mode, target } });
      setMessage({ kind: "info", text: mode === "dry-run" ? "Desktop dry run assigned; no mouse/keyboard input will be dispatched." : "Attended run assigned. Wait for no-input preflight, then confirm execution." });
      onRunCreated(result.id);
      void loadAgents();
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const action = async (kind: "confirm" | "cancel") => {
    if (!run) return;
    await api(`/api/desktop/runs/${run.id}/${kind}`, { method: "POST", json: {} });
    setMessage({ kind: kind === "confirm" ? "ok" : "warn", text: kind === "confirm" ? "Attended execution confirmed." : "Cancellation requested; wait for agent acknowledgment." });
    onRefresh();
  };

  const exportUrl = `/api/desktop/workflows/${workflowId}?applicationName=${encodeURIComponent(target.applicationName)}&windowTitle=${encodeURIComponent(target.windowTitle)}&displayId=${encodeURIComponent(target.displayId)}&requireFocus=${target.requireFocus}`;
  const desktopRun = run?.executor === "robotjs-desktop" ? run : null;
  const active = desktopRun && ["pending", "running"].includes(desktopRun.status);
  const canStart = agent?.online && agent.availability === "idle" && target.displayId && target.windowTitle && !active && !busy;

  return (
    <Card title="Attended Desktop · RobotJS" className="mb-4" actions={<Badge>{agent?.online ? agent.capabilities.driver : "agent offline"}</Badge>}>
      <div className="grid gap-3 lg:grid-cols-4">
        <label className="text-xs font-semibold text-slate-600">Enrolled agent
          <select className={`${inputCls} mt-1`} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Select an online agent</option>
            {agents.filter((a) => !a.revokedAt).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.online ? a.availability : "offline"} · {a.os}/{a.arch}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Application name
          <input className={`${inputCls} mt-1`} value={target.applicationName} onChange={(e) => setTarget({ ...target, applicationName: e.target.value })} placeholder="Synthetic Desktop Target" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Exact window title
          <input className={`${inputCls} mt-1`} value={target.windowTitle} onChange={(e) => setTarget({ ...target, windowTitle: e.target.value })} placeholder="Required before preflight" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Display
          <select className={`${inputCls} mt-1`} value={target.displayId} onChange={(e) => setTarget({ ...target, displayId: e.target.value })}>
            <option value="">Select display</option>
            {agent?.displays.map((d) => <option key={d.id} value={d.id}>{d.id} · {d.width}×{d.height} at {d.x},{d.y}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn onClick={preview} disabled={busy || !agent}><Monitor size={14} /> Compile / preview</Btn>
        <a href={exportUrl} className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">Download RobotJS bundle</a>
        <Btn onClick={() => start("dry-run")} disabled={!canStart}>Desktop dry run</Btn>
        <Btn variant="success" onClick={() => start("attended")} disabled={!canStart || !agent?.capabilities.supportsInput}><Play size={14} /> Attended Desktop</Btn>
        {desktopRun?.desktopSessionState === "awaiting-operator-confirmation" && <Btn variant="warn" onClick={() => action("confirm")}><ShieldAlert size={14} /> Confirm real input</Btn>}
        {active && <Btn variant="danger" onClick={() => action("cancel")}><Square size={14} /> Stop desktop run</Btn>}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={target.requireFocus} onChange={(e) => setTarget({ ...target, requireFocus: e.target.checked })} /> Require exact foreground-window verification (recommended)</label>
      {message && <div className="mt-3"><Notice kind={message.kind}>{message.text}</Notice></div>}
      {diagnostics.length > 0 && <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-xs">{diagnostics.map((d, i) => <li key={`${d.code}-${d.nodeId}-${i}`} className={d.severity === "error" ? "text-rose-700" : d.severity === "warning" ? "text-amber-700" : "text-slate-600"}><strong>{d.code}</strong> · {d.message} {d.remediation}</li>)}</ul>}
      {desktopRun && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><Badge>{desktopRun.desktopSessionState || desktopRun.status}</Badge><span>Executor: robotjs-desktop · driver: {desktopRun.desktopDriver || "unknown"} · mode: {desktopRun.mode}</span></div>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {desktopRun?.desktopPreview.shot && <img src={`/api/runs/${desktopRun.id}/shots/${desktopRun.desktopPreview.shot}?seq=${desktopRun.desktopPreview.sequence ?? 0}`} alt="Latest desktop agent preview" className="mt-3 max-h-72 rounded border" />}
      <p className="mt-3 text-xs text-slate-500">Single-operator development feature: browser routes inherit RASQ-Ai’s current lack of general authentication. Agent transport uses revocable device tokens. Set <code>RASQ_DESKTOP_ENROLLMENT_TOKEN</code> on the control plane and enroll through the desktop app. Dry runs dispatch no input; attended runs require preflight and confirmation.</p>
      {agent?.capabilities.platformNotes.map((note) => <p key={note} className="mt-1 text-xs text-slate-500">{note}</p>)}
    </Card>
  );
}
