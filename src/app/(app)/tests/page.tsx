"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileJson, Trash2, Wand2, Workflow } from "lucide-react";
import ModelPicker from "@/components/ModelPicker";
import { api, Badge, Btn, Card, Notice, PageHeader, useProject } from "@/components/ui";
import { CATEGORIES, PRIORITIES, type TestStep } from "@/lib/types";

type Doc = { id: string; name: string };
type Req = { id: string; reqKey: string; docId: string; ambiguity: string | null };
type Case = { id: string; caseKey: string; title: string; category: string; priority: string; preconditions: string[]; testData: Record<string, string>; steps: TestStep[]; expected: string; assumptions: string[]; provenance: string; requirementKeys: string[] };
type Screen = { id: string; name: string; controls: { id: string }[] };
type Source = "requirements" | "visual";
type Converted = { id: string; nodes: number; unresolvedAnchors: number; notes: string };

export default function TestsPage() {
  const { current } = useProject();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [doc, setDoc] = useState("");
  const [cases, setCases] = useState<Case[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [source, setSource] = useState<Source>("requirements");
  // null means all saved screens; an empty array means explicitly none.
  const [selectedScreens, setSelectedScreens] = useState<string[] | null>(null);
  const [open, setOpen] = useState("");
  const [fc, setFc] = useState("");
  const [fp, setFp] = useState("");
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState<Converted | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "warn"; text: string } | null>(null);
  const [view, setView] = useState<"cases" | "matrix">("cases");

  const load = useCallback(async () => {
    if (!current) return;
    const r = await api<{ docs: Doc[] }>(`/api/requirements?projectId=${current.id}`);
    setDocs(r.docs);
    setDoc((d) => r.docs.some((x) => x.id === d) ? d : r.docs[0]?.id || "");
    const t = await api<{ cases: Case[]; reqs: Req[] }>(`/api/tests?projectId=${current.id}`);
    setCases(t.cases);
    setReqs(t.reqs);
    setScreens(await api<Screen[]>(`/api/screens?projectId=${current.id}`));
    setSelectedScreens(null);
  }, [current]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    if (!current || (source === "requirements" && !doc) || (source === "visual" && selectedScreens?.length === 0)) return;
    setBusy(true);
    setMsg(null);
    setConverted(null);
    try {
      const r = await api<{ count: number; model: string; warnings: string[]; replaced: boolean }>("/api/tests", {
        json: { projectId: current.id, source, docId: source === "requirements" ? doc : undefined, screenIds: source === "visual" ? selectedScreens ?? [] : undefined, replace: source === "requirements" },
      });
      setMsg({
        kind: r.warnings.length ? "warn" : "ok",
        text: `Generated ${r.count} ${source === "visual" ? "visual interaction" : "requirement-driven"} test cases (${r.model}); ${r.replaced ? "replaced the previous project cases" : "appended to the existing cases"}. ${r.warnings.join(" ")}`,
      });
      await load();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Generation failed" });
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => cases.filter((c) => (!fc || c.category === fc) && (!fp || c.priority === fp)), [cases, fc, fp]);

  const convert = async () => {
    if (!current || !shown.length) return;
    setConverting(true);
    setMsg(null);
    setConverted(null);
    try {
      const r = await api<Converted>("/api/workflows", { json: { projectId: current.id, mode: "generate", caseIds: shown.map((c) => c.id), name: `${current.name} – ${shown.length} scenario${shown.length === 1 ? "" : "s"}` } });
      setConverted(r);
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "n8n conversion failed" });
    } finally {
      setConverting(false);
    }
  };

  const toggleScreen = (id: string, checked: boolean) => {
    const currentIds = selectedScreens ?? screens.map((s) => s.id);
    const next = checked ? [...new Set([...currentIds, id])] : currentIds.filter((x) => x !== id);
    setSelectedScreens(next.length === screens.length ? null : next);
  };

  const docReqs = reqs.filter((r) => !doc || r.docId === doc);
  const sel = "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm";
  const totalControls = screens.reduce((n, s) => n + s.controls.length, 0);

  return (
    <>
      <PageHeader title="Test Scenarios" subtitle="Generate traceable cases from an SRS or visual-only interaction cases from saved Record & Visual Scan controls. Convert the displayed scenario JSON into an n8n workflow and run it in the live monitor.">
        <ModelPicker task="test_scenarios" />
      </PageHeader>
      {msg && <div className="mb-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      {converted && (
        <div className="mb-3">
          <Notice kind={converted.unresolvedAnchors ? "warn" : "ok"}>
            <div className="flex flex-wrap items-center gap-3">
              <span>Converted to n8n JSON: {converted.nodes} nodes. {converted.unresolvedAnchors} action step(s) have no visual anchor and will be skipped, never guessed.</span>
              <Link className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700" href={`/workflows?workflow=${converted.id}`}><Workflow size={14} /> Open &amp; run in Workflows</Link>
              <a className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" href={`/api/workflows/${converted.id}/export`}><FileJson size={14} /> Download n8n JSON</a>
            </div>
            {converted.notes && <p className="mt-2 text-xs">{converted.notes}</p>}
          </Notice>
        </div>
      )}

      <Card title="1 · Generate test scenarios" className="mb-4">
        <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm md:w-fit">
          {([{ id: "requirements", label: "From SRS document" }, { id: "visual", label: "From saved visual scans" }] as const).map((v) => (
            <button key={v.id} onClick={() => { setSource(v.id); setMsg(null); setConverted(null); }} className={`rounded-md px-3 py-1.5 ${source === v.id ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>{v.label}</button>
          ))}
        </div>
        {source === "requirements" ? (
          <div className="flex flex-wrap items-center gap-3">
            <select className={sel} value={doc} onChange={(e) => setDoc(e.target.value)}>
              {docs.length === 0 && <option value="">No SRS documents</option>}
              {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <Btn variant="primary" onClick={generate} disabled={busy || !doc}><Wand2 size={14} /> {busy ? "Generating…" : cases.length ? "Regenerate SRS cases (replaces all)" : "Generate SRS test cases"}</Btn>
            <span className="text-xs text-slate-500">Exact requirement IDs are preserved. Saved visual anchors bind by label match where justified.</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Btn variant="primary" onClick={generate} disabled={busy || !screens.length || selectedScreens?.length === 0}><Wand2 size={14} /> {busy ? "Generating…" : "Generate visual cases (append)"}</Btn>
              <span className="text-xs text-slate-500">{totalControls} saved controls on {screens.length} screens. Visual cases are positive P2 interactions with bound anchors and no invented SRS IDs.</span>
            </div>
            {screens.length ? (
              <div className="rounded-lg border border-slate-200 p-3">
                <label className="mb-2 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={selectedScreens === null} onChange={(e) => setSelectedScreens(e.target.checked ? null : [])} /> All saved screens</label>
                <div className="grid max-h-36 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
                  {screens.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5 text-xs">
                      <input type="checkbox" checked={selectedScreens === null || selectedScreens.includes(s.id)} onChange={(e) => toggleScreen(s.id, e.target.checked)} />
                      <span className="truncate">{s.name}</span><span className="ml-auto whitespace-nowrap text-slate-500">{s.controls.length} controls</span>
                    </label>
                  ))}
                </div>
                {selectedScreens?.length === 0 && <p className="mt-2 text-xs text-amber-700">Select at least one saved screen.</p>}
              </div>
            ) : <p className="text-sm text-slate-500">No saved scans yet. Save controls in Record &amp; Visual Scan first.</p>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="text-xs text-slate-500">Visual generation appends by default so it does not erase SRS-based scenarios.</span>
          <span className="flex gap-2">
            {current && <a className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100" href={`/api/tests/export?projectId=${current.id}&format=csv`}><Download size={14} /> CSV</a>}
            {current && <a className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100" href={`/api/tests/export?projectId=${current.id}&format=json`}><Download size={14} /> Scenario JSON</a>}
            <Btn variant="danger" disabled={!cases.length} onClick={async () => { if (current && confirm("Delete all test cases for this project?")) { await api(`/api/tests?projectId=${current.id}`, { method: "DELETE" }); setConverted(null); void load(); } }}><Trash2 size={14} /></Btn>
          </span>
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1 text-sm">
          {(["cases", "matrix"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 ${view === v ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}>{v === "cases" ? `Cases (${shown.length})` : "Traceability matrix"}</button>)}
        </div>
        <select className={sel} value={fc} onChange={(e) => setFc(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <select className={sel} value={fp} onChange={(e) => setFp(e.target.value)}><option value="">All priorities</option>{PRIORITIES.map((c) => <option key={c}>{c}</option>)}</select>
        <Btn variant="primary" className="ml-auto" onClick={convert} disabled={converting || !shown.length}><Workflow size={14} /> {converting ? "Converting…" : `2 · Convert displayed (${shown.length}) to n8n`}</Btn>
      </div>

      {view === "cases" ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Case</th><th className="p-2">Title</th><th className="p-2">Category</th><th className="p-2">Pri</th><th className="p-2">Requirements</th><th className="p-2">Anchors</th></tr></thead>
              <tbody>
                {shown.map((c) => {
                  const act = c.steps.filter((s) => !["navigate", "assert", "wait"].includes(s.action));
                  const bound = act.filter((s) => s.controlId).length;
                  return (
                    <Fragment key={c.id}>
                      <tr className="cursor-pointer border-t hover:bg-slate-50" onClick={() => setOpen(open === c.id ? "" : c.id)}>
                        <td className="p-2 font-mono text-xs font-semibold">{c.caseKey}</td>
                        <td className="p-2">{c.title}</td>
                        <td className="p-2"><Badge>{c.category}</Badge></td>
                        <td className="p-2"><Badge>{c.priority}</Badge></td>
                        <td className="p-2 font-mono text-xs text-indigo-700">{c.requirementKeys.length ? c.requirementKeys.join(", ") : <Badge tone="pending">Visual only</Badge>}</td>
                        <td className="p-2 text-xs">{act.length ? `${bound}/${act.length} bound` : "—"}</td>
                      </tr>
                      {open === c.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={6} className="p-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <h4 className="text-xs font-semibold uppercase text-slate-500">Preconditions</h4>
                                <ul className="mb-3 list-disc pl-5 text-sm">{c.preconditions.map((p, i) => <li key={i}>{p}</li>)}</ul>
                                <h4 className="text-xs font-semibold uppercase text-slate-500">Synthetic test data</h4>
                                <pre className="mb-3 overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(c.testData, null, 2)}</pre>
                                <h4 className="text-xs font-semibold uppercase text-slate-500">Expected result</h4>
                                <p className="mb-3 text-sm">{c.expected}</p>
                                {c.assumptions.length > 0 && <><h4 className="text-xs font-semibold uppercase text-amber-700">Assumptions / ambiguity</h4><ul className="list-disc pl-5 text-sm text-amber-900">{c.assumptions.map((p, i) => <li key={i}>{p}</li>)}</ul></>}
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold uppercase text-slate-500">Ordered steps</h4>
                                <ol className="space-y-1 text-sm">
                                  {c.steps.map((s) => (
                                    <li key={s.order} className="rounded border bg-white p-2">
                                      <b>{s.order}. {s.action}</b> — {s.target} {s.data ? <code className="rounded bg-slate-100 px-1">{s.data}</code> : null}
                                      {s.controlId ? <Badge>anchor bound</Badge> : !["navigate", "assert", "wait"].includes(s.action) ? <Badge tone="warning">no anchor</Badge> : null}
                                      {s.expected && <div className="text-xs text-emerald-800">expect: {s.expected}</div>}
                                    </li>
                                  ))}
                                </ol>
                                <p className="mt-2 text-xs text-slate-500">Provenance: {c.provenance}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No test cases match this view.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-auto">
            <table className="text-xs">
              <thead><tr><th className="sticky left-0 bg-white p-1 text-left">Requirement</th>{cases.map((c) => <th key={c.id} className="p-1 font-mono [writing-mode:vertical-rl]">{c.caseKey}</th>)}<th className="p-1">Σ</th></tr></thead>
              <tbody>
                {docReqs.map((r) => {
                  const n = cases.filter((c) => c.requirementKeys.includes(r.reqKey)).length;
                  return (
                    <tr key={r.id} className="border-t">
                      <td className="sticky left-0 whitespace-nowrap bg-white p-1 font-mono font-semibold text-indigo-700">{r.reqKey}</td>
                      {cases.map((c) => <td key={c.id} className="p-1 text-center">{c.requirementKeys.includes(r.reqKey) ? <span className="inline-block h-3 w-3 rounded-sm bg-indigo-600" /> : ""}</td>)}
                      <td className={`p-1 text-center font-bold ${n ? "" : "text-rose-600"}`}>{n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!docReqs.length && <p className="p-6 text-center text-sm text-slate-500">No SRS requirements in this view. Visual-only cases intentionally have no requirement links.</p>}
          </div>
          <p className="mt-2 text-xs text-slate-500">Rows with Σ = 0 are uncovered requirements. Visual-only cases do not imply SRS coverage.</p>
        </Card>
      )}
    </>
  );
}
