"use client";

import { useCallback, useEffect, useState } from "react";
import { FileUp, Trash2 } from "lucide-react";
import ModelPicker from "@/components/ModelPicker";
import { api, Badge, Btn, Card, inputCls, Notice, PageHeader, useProject } from "@/components/ui";

type Doc = { id: string; name: string; mimeType: string; sha256: string; chars: number; analysisModel: string | null; createdAt: string };
type Req = { id: string; docId: string; reqKey: string; text: string; acceptance: string[]; category: string; ambiguity: string | null };

export default function RequirementsPage() {
  const { current } = useProject();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    const r = await api<{ docs: Doc[]; requirements: Req[] }>(`/api/requirements?projectId=${current.id}`);
    setDocs(r.docs);
    setReqs(r.requirements);
  }, [current]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!current) return;
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("projectId", current.id);
      fd.append("name", name || file?.name || "Pasted SRS");
      fd.append("text", text);
      if (file) fd.append("file", file);
      const res = await fetch("/api/requirements", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setMsg({ kind: "ok", text: `Extracted ${j.count} requirements using ${j.model}. IDs were preserved exactly as written.` });
      setText("");
      setFile(null);
      setName("");
      await load();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="SRS Documents" subtitle="Upload a PDF, Markdown or text SRS. The document is treated as untrusted data: instructions inside it are ignored, and secrets/PANs/personal data are redacted before any AI call.">
        <ModelPicker task="document_analysis" />
      </PageHeader>
      {msg && <div className="mb-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <div className="mb-4 grid gap-4 lg:grid-cols-[420px_1fr]">
        <Card title="Add document">
          <div className="space-y-3">
            <input className={inputCls} placeholder="Document name" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border-2 border-dashed border-line-strong p-3 text-sm text-muted hover:border-accent-line">
              <FileUp size={18} /> {file ? file.name : "Choose PDF / .md / .txt"}
              <input type="file" accept=".pdf,.txt,.md,.markdown,text/plain,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <textarea className={`${inputCls} h-48 font-mono text-xs`} placeholder={"…or paste SRS text. Start each requirement with its ID:\nREQ-001: The system shall …\n  AC1: Given … when … then …"} value={text} onChange={(e) => setText(e.target.value)} />
            <Btn variant="primary" className="w-full" onClick={submit} disabled={busy || !current || (!text && !file)}>{busy ? "Analysing…" : "Analyse document"}</Btn>
          </div>
        </Card>
        <Card title={`Documents (${docs.length})`}>
          <ul className="divide-y text-sm">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted">{d.chars.toLocaleString()} chars · sha256 {d.sha256.slice(0, 12)}… · {d.analysisModel ? `AI: ${d.analysisModel}` : "local parser"} · {reqs.filter((r) => r.docId === d.id).length} requirements</div>
                </div>
                <Btn variant="danger" onClick={async () => { await api(`/api/requirements?docId=${d.id}`, { method: "DELETE" }); void load(); }}><Trash2 size={14} /></Btn>
              </li>
            ))}
            {docs.length === 0 && <li className="py-6 text-center text-muted">No documents yet.</li>}
          </ul>
        </Card>
      </div>
      <Card title={`Requirements (${reqs.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr><th className="p-2">ID</th><th className="p-2">Requirement</th><th className="p-2">Acceptance criteria</th><th className="p-2">Category</th><th className="p-2">Ambiguity</th></tr></thead>
            <tbody>
              {reqs.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="whitespace-nowrap p-2 font-mono text-xs font-semibold text-accent-ink">{r.reqKey}</td>
                  <td className="p-2">{r.text}</td>
                  <td className="p-2 text-xs">{r.acceptance.length ? <ul className="list-disc pl-4">{r.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul> : <span className="text-faint">none stated</span>}</td>
                  <td className="p-2"><Badge>{r.category}</Badge></td>
                  <td className="p-2 text-xs text-warn-ink">{r.ambiguity ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
