"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileBarChart, Trash2 } from "lucide-react";
import ModelPicker from "@/components/ModelPicker";
import { api, Btn, Card, Notice, PageHeader, useProject } from "@/components/ui";

type Report = { id: string; title: string; markdown: string; provenance: string; createdAt: string };

function Md({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[-| ]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      i--;
      out.push(
        <table key={i} className="my-2 w-full text-sm">
          <thead><tr>{rows[0].map((c, j) => <th key={j} className="border-b p-1 text-left">{c}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border-b p-1">{c}</td>)}</tr>)}</tbody>
        </table>,
      );
    } else if (l.startsWith("# ")) out.push(<h1 key={i} className="mb-2 text-xl font-bold">{l.slice(2)}</h1>);
    else if (l.startsWith("## ")) out.push(<h2 key={i} className="mb-1 mt-4 text-base font-semibold text-accent-ink">{l.slice(3)}</h2>);
    else if (l.startsWith("- ")) out.push(<li key={i} className="ml-5 list-disc text-sm">{l.slice(2).replace(/\*\*/g, "")}</li>);
    else if (l.trim()) out.push(<p key={i} className="text-sm text-ink">{l.replace(/\*\*|_/g, "")}</p>);
  }
  return <div>{out}</div>;
}

export default function ReportsPage() {
  const { current } = useProject();
  const [list, setList] = useState<Report[]>([]);
  const [sel, setSel] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!current) return;
    const r = await api<Report[]>(`/api/reports?projectId=${current.id}`);
    setList(r);
    setSel((s) => r.find((x) => x.id === s?.id) ?? r[0] ?? null);
  }, [current]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader title="Reports" subtitle="Coverage, traceability, visual-evidence and execution reports built only from recorded data. If nothing was executed the report says so.">
        <ModelPicker task="report_generation" />
        <Btn variant="primary" disabled={!current || busy} onClick={async () => { setBusy(true); setErr(""); try { const r = await api<Report>("/api/reports", { json: { projectId: current!.id } }); setSel(r); await load(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); } }}><FileBarChart size={14} /> {busy ? "Generating…" : "Generate report"}</Btn>
      </PageHeader>
      {err && <div className="mb-3"><Notice kind="error">{err}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card title="History">
          <ul className="space-y-1 text-sm">
            {list.map((r) => (
              <li key={r.id} className={`flex items-center justify-between rounded-lg border p-2 ${sel?.id === r.id ? "border-accent-line bg-accent-soft" : ""}`}>
                <button className="text-left" onClick={() => setSel(r)}><div className="font-medium">{r.title}</div><div className="text-xs text-muted">{r.provenance}</div></button>
                <Btn variant="danger" className="!px-1.5 !py-0.5" onClick={async () => { await api(`/api/reports?id=${r.id}`, { method: "DELETE" }); void load(); }}><Trash2 size={12} /></Btn>
              </li>
            ))}
            {list.length === 0 && <li className="text-muted">No reports yet.</li>}
          </ul>
        </Card>
        <Card title="Preview" actions={sel && <a href={`/api/reports/${sel.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line-strong bg-raised px-3 py-1 text-sm text-ink hover:bg-raised-hover"><Download size={14} /> Markdown</a>}>
          {sel ? <Md text={sel.markdown} /> : <p className="py-10 text-center text-sm text-muted">Generate a report to preview it here.</p>}
        </Card>
      </div>
    </>
  );
}
