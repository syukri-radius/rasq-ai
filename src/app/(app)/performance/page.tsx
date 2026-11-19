"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Badge, Btn, Card, inputCls, Notice, PageHeader, useProject } from "@/components/ui";
import type { PerformancePlan, PerformanceSummary } from "@/lib/performance";

type Case = { id: string; caseKey: string; title: string; requirementIds: string[] };
type Req = { id: string; docId: string; reqKey: string; text: string };
type Data = { cases: Case[]; docs: { id: string; name: string }[]; requirements: Req[]; plans: { id: string; caseId: string | null; config: PerformancePlan }[]; runs: Run[] };
type Run = { id: string; planId: string; status: string; error: string; summary: PerformanceSummary | null; startedAt: string };
const blank = (): PerformancePlan => ({ name: "REST load baseline", method: "GET", url: "", jsonBody: "", threads: 2, rampUpSeconds: 2, durationSeconds: 20, thinkTimeMs: 500, requirementIds: [] });

export default function PerformancePage() {
  const { current } = useProject();
  const [data, setData] = useState<Data | null>(null);
  const [planId, setPlanId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [plan, setPlan] = useState<PerformancePlan>(blank);
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const load = useCallback(async () => {
    if (!current) return;
    setData(await api<Data>(`/api/performance?projectId=${current.id}`));
  }, [current]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPlanId(""); setCaseId(""); setPlan(blank()); setActiveId(""); }, [current?.id]);
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const run = await api<Run>(`/api/performance/runs?id=${activeId}`);
        if (!cancelled && run.status !== "running") { setActiveId(""); void load(); }
      } catch { /* Keep the run ID for retry; do not invent completion. */ }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [activeId, load]);
  const save = async () => {
    if (!current || !caseId) return;
    setBusy(true); setMessage(null);
    try {
      const saved = await api<{ id: string }>("/api/performance", { method: planId ? "PUT" : "POST", json: planId ? { id: planId, caseId, plan } : { projectId: current.id, caseId, plan } });
      setPlanId(saved.id);
      await load();
      setMessage({ kind: "ok", text: "Restricted plan saved. No load has been generated." });
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Save failed" }); }
    finally { setBusy(false); }
  };
  const run = async () => {
    if (!planId || !confirm(`Generate up to ${plan.threads} concurrent JSON requests against ${plan.url} for ${plan.durationSeconds} seconds? Only run against an authorized target.`)) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ id: string }>("/api/performance/runs", { json: { planId, confirm: true } });
      setActiveId(result.id);
      await load();
    } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Run failed" }); }
    finally { setBusy(false); }
  };
  const setNumber = (key: "threads" | "rampUpSeconds" | "durationSeconds" | "thinkTimeMs", value: string) => setPlan({ ...plan, [key]: Number(value) });
  return <>
    <PageHeader title="REST performance testing" subtitle="Create a restricted JSON REST JMeter plan, run it only against an explicitly allowed origin, and review recorded samples against requirement SLAs." />
    {message && <div className="mb-3"><Notice kind={message.kind}>{message.text}</Notice></div>}
    <Card title="Plan editor">
      <p className="mb-3 text-xs text-muted">Requires preinstalled JMeter and RASQ_JMETER_ALLOWED_ORIGINS on the web server. No JMX uploads, scripts, cookies, authentication, redirects, or correlated request chains. Use synthetic data only. The operator must own or have permission to load-test the target.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={inputCls} aria-label="Saved plan" value={planId} onChange={(e) => { const id = e.target.value; setPlanId(id); const found = data?.plans.find((p) => p.id === id); if (found) { setPlan(found.config); setCaseId(found.caseId ?? ""); } else { setPlan(blank()); setCaseId(""); } }}><option value="">New plan</option>{data?.plans.map((p) => <option key={p.id} value={p.id}>{p.config.name}</option>)}</select>
        <select className={inputCls} aria-label="Test scenario" value={caseId} disabled={Boolean(planId && caseId)} onChange={(e) => { const id = e.target.value; setCaseId(id); setPlan({ ...plan, requirementIds: data?.cases.find((c) => c.id === id)?.requirementIds ?? [] }); }}><option value="">Choose Test Scenario</option>{data?.cases.map((c) => <option key={c.id} value={c.id}>{c.caseKey} · {c.title}</option>)}</select>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-sm">Plan name<input className={inputCls} value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} /></label>
        <label className="text-sm">Request URL (no query or credentials)<input className={inputCls} type="url" placeholder="https://allowed.example/api/items" value={plan.url} onChange={(e) => setPlan({ ...plan, url: e.target.value })} /></label>
        <label className="text-sm">Method<select className={inputCls} value={plan.method} onChange={(e) => setPlan({ ...plan, method: e.target.value as PerformancePlan["method"], jsonBody: ["GET", "DELETE"].includes(e.target.value) ? "" : plan.jsonBody || "{}" })}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="text-sm">JSON body (synthetic object only)<textarea className={`${inputCls} h-20 font-mono text-xs`} disabled={["GET", "DELETE"].includes(plan.method)} value={plan.jsonBody} onChange={(e) => setPlan({ ...plan, jsonBody: e.target.value })} placeholder="{}" /></label>
        {([ ["threads", "Virtual users (1–10)"], ["rampUpSeconds", "Ramp-up seconds (1–30)"], ["durationSeconds", "Duration seconds (5–60)"], ["thinkTimeMs", "Think time ms (300–5000)"] ] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input className={inputCls} type="number" value={plan[key]} onChange={(e) => setNumber(key, e.target.value)} /></label>)}
      </div>
      <p className="mt-2 text-xs text-muted">For a 1% error-rate limit, even zero observed errors need roughly 270 independent samples for a one-sided 95% bound; increase duration/users only with target-owner approval.</p>
      <div className="mt-3 text-sm font-medium">Applicable requirements (select from multiple documents)</div>
      <div className="mt-1 max-h-36 overflow-auto rounded border border-line p-2 text-xs">{data?.docs.map((d) => <div key={d.id}><b>{d.name}</b>{data.requirements.filter((r) => r.docId === d.id).map((r) => <label key={r.id} className="flex gap-2 p-1"><input type="checkbox" checked={plan.requirementIds.includes(r.id)} onChange={(e) => setPlan({ ...plan, requirementIds: e.target.checked ? [...plan.requirementIds, r.id] : plan.requirementIds.filter((id) => id !== r.id) })} />{r.reqKey}: {r.text.slice(0, 180)}</label>)}</div>)}</div>
      {plan.requirementIds.filter((id) => !data?.requirements.some((r) => r.id === id)).map((id) => <button key={id} className="mt-2 block text-xs text-warn-ink underline" onClick={() => setPlan({ ...plan, requirementIds: plan.requirementIds.filter((x) => x !== id) })}>Remove deleted requirement {id}</button>)}
      {planId && !caseId && <p className="mt-2 text-sm text-warn-ink">The linked Test Scenario was deleted. Select a replacement scenario and update this plan before running it.</p>}
      <div className="mt-3 flex flex-wrap gap-2"><Btn variant="primary" disabled={busy || !caseId || Boolean(activeId)} onClick={save}>{planId ? "Update plan" : "Create plan"}</Btn><Btn disabled={!planId || !caseId || busy || Boolean(activeId)} onClick={run}>Run approved plan</Btn>{activeId && <Btn variant="danger" onClick={async () => { try { await api(`/api/performance/runs?id=${activeId}`, { method: "DELETE" }); } catch (e) { setMessage({ kind: "error", text: e instanceof Error ? e.message : "Cancellation failed" }); } }}>Cancel run</Btn>}{planId && <Btn variant="danger" onClick={async () => { if (confirm("Delete this plan and its run history?")) { await api(`/api/performance?id=${planId}`, { method: "DELETE" }); setPlanId(""); setCaseId(""); setPlan(blank()); await load(); } }}>Delete plan</Btn>}</div>
      {activeId && <p className="mt-2 text-xs text-warn-ink">JMeter run {activeId} is running. This page polls until analysis finishes; reloading does not cancel server work.</p>}
    </Card>
    <Card title="Observed runs" className="mt-4">
      <div className="space-y-3">{data?.runs.map((r) => <div key={r.id} className="rounded border border-line p-3 text-sm"><div className="flex gap-2"><Badge tone={r.status === "passed" ? "passed" : r.status === "failed" || r.status === "error" ? "failed" : "warning"}>{r.status}</Badge><span className="text-muted">{data.plans.find((p) => p.id === r.planId)?.config.name ?? "Deleted plan"} · {new Date(r.startedAt).toLocaleString()}</span>{r.status === "running" && <Btn onClick={() => setActiveId(r.id)}>Monitor / cancel</Btn>}</div>{r.error && <p className="mt-2 text-danger-ink">{r.error}</p>}{r.summary && <div className="mt-2 space-y-1"><p>{r.summary.count} observed samples · p95 {r.summary.p95Ms} ms · errors {r.summary.errors} ({r.summary.errorPercent.toFixed(2)}%) · {r.summary.throughputRps.toFixed(2)} req/s</p>{r.summary.decisions.map((d, i) => <p key={i}><b>{d.status}:</b> {d.message}</p>)}{r.summary.notes.map((n, i) => <p key={i} className="text-warn-ink">needs review: {n}</p>)}<p className="text-xs text-muted">Requirement snapshot: {r.summary.requirementSnapshot.map((x) => `${x.docName} / ${x.reqKey}`).join(", ") || "none"}. Lab samples only; 95% Wilson bounds assume independent samples, not field Core Web Vitals.</p></div>}</div>)}{!data?.runs.length && <p className="text-sm text-muted">No JMeter execution recorded. Saved plans are not execution evidence.</p>}</div>
    </Card>
  </>;
}
