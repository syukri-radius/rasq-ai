"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { api, Badge, Btn, Card, inputCls, Notice, PageHeader } from "@/components/ui";
import ThemePicker from "@/components/ThemePicker";
import { TASKS, TASK_LABELS } from "@/lib/types";
import { AI_PROTOCOL_LABELS, DEFAULT_JSON_PROVIDER_CONFIG, type AiProtocol, type ProviderConfig } from "@/lib/aiContract";

type Provider = { id: string; name: string; kind: AiProtocol; baseUrl: string; apiKeyEnv: string; models: string[]; enabled: boolean; keyConfigured: boolean; config: ProviderConfig };
type Policy = { id: string; name: string; priority: number; content: string; enabled: boolean };
type S = { aiMode: string; providers: Provider[]; routes: { task: string; providerId: string | null; model: string }[]; policies: Policy[] };

const defaultConfigText = () => JSON.stringify(DEFAULT_JSON_PROVIDER_CONFIG, null, 2);

export default function SettingsPage() {
  const [s, setS] = useState<S | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [np, setNp] = useState<{ name: string; kind: AiProtocol; baseUrl: string; apiKeyEnv: string; models: string; config: string }>({ name: "", kind: "openai", baseUrl: "", apiKeyEnv: "", models: "", config: defaultConfigText() });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [configEdit, setConfigEdit] = useState<Record<string, string>>({});
  const load = useCallback(async () => setS(await api<S>("/api/settings")), []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const run = async (f: () => Promise<unknown>, ok = "Saved") => {
    try { await f(); setMsg({ kind: "ok", text: ok }); await load(); } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed" }); }
  };
  if (!s) return <div className="h-40 animate-pulse rounded-xl bg-tint-2" />;
  return (
    <>
      <PageHeader title="AI Models & Policy" subtitle="Route each feature through OpenAI, Anthropic, Gemini, or a declarative REST/JSON integration. Credentials are never stored: providers reference the NAME of a server-side environment variable." />
      {msg && <div className="mb-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="AI data-sharing switch">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={s.aiMode === "ai"} onChange={(e) => run(() => api("/api/settings", { method: "PUT", json: { aiMode: e.target.checked ? "ai" : "local" } }))} />
            <span><b>Allow sending screenshots and SRS text to the AI provider selected per feature.</b><br /><span className="text-muted">Turn off to force the local deterministic engine everywhere (kill switch). Selecting “Local” for a feature also sends nothing.</span></span>
          </label>
        </Card>
        <Card title="Model routing per feature">
          <div className="space-y-2">
            {TASKS.map((t) => {
              const r = s.routes.find((x) => x.task === t);
              const v = r?.providerId ? `${r.providerId}::${r.model}` : "local";
              return (
                <label key={t} className="flex items-center justify-between gap-3 text-sm">
                  <span className="w-48 font-medium">{TASK_LABELS[t]}</span>
                  <select className={inputCls} value={v} onChange={(e) => { const [providerId, model] = e.target.value === "local" ? [null, ""] : e.target.value.split("::"); void run(() => api("/api/settings", { method: "PUT", json: { route: { task: t, providerId, model } } })); }}>
                    <option value="local">Local engine (no AI)</option>
                    {s.providers.filter((p) => p.enabled).map((p) => <optgroup key={p.id} label={p.name}>{p.models.map((m) => <option key={m} value={`${p.id}::${m}`}>{m}</option>)}</optgroup>)}
                  </select>
                </label>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Providers" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted"><tr><th className="p-2">Name</th><th className="p-2">Protocol</th><th className="p-2">Base URL</th><th className="p-2">Key env var</th><th className="p-2">Models</th><th className="p-2">Enabled</th><th /></tr></thead>
            <tbody>
              {s.providers.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="p-2 font-medium">{p.name}</td>
                  <td className="p-2">{p.kind}</td>
                  <td className="p-2 font-mono text-xs">{p.baseUrl}</td>
                  <td className="p-2"><span className="font-mono text-xs">{p.apiKeyEnv || "—"}</span> {p.apiKeyEnv ? <Badge tone={p.keyConfigured ? "passed" : "failed"}>{p.keyConfigured ? "configured" : "missing"}</Badge> : <Badge tone="pending">no key needed</Badge>}</td>
                  <td className="p-2"><input className={inputCls} defaultValue={p.models.join(", ")} onBlur={(e) => { const models = e.target.value.split(",").map((x) => x.trim()).filter(Boolean); if (models.join() !== p.models.join()) void run(() => api("/api/providers", { method: "PATCH", json: { ...p, models } })); }} /></td>
                  <td className="p-2"><input type="checkbox" checked={p.enabled} onChange={(e) => run(() => api("/api/providers", { method: "PATCH", json: { ...p, enabled: e.target.checked } }))} /></td>
                  <td className="p-2"><Btn variant="danger" onClick={() => run(() => api(`/api/providers?id=${p.id}`, { method: "DELETE" }))}><Trash2 size={14} /></Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="mt-4 grid gap-2 border-t pt-4 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/api/providers", { json: { ...np, models: np.models.split(","), config: np.kind === "json" ? JSON.parse(np.config) : {} } }); setNp({ name: "", kind: "openai", baseUrl: "", apiKeyEnv: "", models: "", config: defaultConfigText() }); }, "Provider added"); }}>
          <input required className={inputCls} placeholder="Name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
          <select className={inputCls} value={np.kind} onChange={(e) => setNp({ ...np, kind: e.target.value as AiProtocol })}>{Object.entries(AI_PROTOCOL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <input required={np.kind === "json"} className={inputCls} placeholder={np.kind === "json" ? "https://host/invoke?model={{model}}" : "Base URL"} value={np.baseUrl} onChange={(e) => setNp({ ...np, baseUrl: e.target.value })} />
          <input className={inputCls} placeholder="ENV_VAR_NAME" value={np.apiKeyEnv} onChange={(e) => setNp({ ...np, apiKeyEnv: e.target.value.toUpperCase() })} />
          <input className={inputCls} placeholder="model-a, model-b" value={np.models} onChange={(e) => setNp({ ...np, models: e.target.value })} />
          {np.kind === "json" && <textarea aria-label="New generic JSON provider configuration" className={`${inputCls} h-56 font-mono text-xs md:col-span-5`} value={np.config} onChange={(e) => setNp({ ...np, config: e.target.value })} />}
          <Btn variant="primary" type="submit"><KeyRound size={14} /> Add provider</Btn>
        </form>
        {np.kind === "json" && <p className="mt-2 text-xs text-muted">The default uses the canonical rasq-ai.v1 request and output.text response. Add requestTemplate only for a different body shape. API keys are resolved from the server environment only through header templates.</p>}
        <p className="mt-2 text-xs text-muted">Set secrets as environment variables on the server (e.g. OPENAI_API_KEY). Only the variable name is stored; the value never reaches the browser, database or reports.</p>
      </Card>

      {s.providers.some((p) => p.kind === "json") && (
        <Card title="Generic REST / JSON protocol configurations" className="mt-4">
          <div className="space-y-4">
            {s.providers.filter((p) => p.kind === "json").map((p) => (
              <div key={p.id} className="rounded-lg border p-3">
                <div className="mb-2 text-sm"><b>{p.name}</b> <span className="ml-2 font-mono text-xs text-muted">{p.baseUrl}</span></div>
                <textarea aria-label={`${p.name} JSON configuration`} className={`${inputCls} h-64 font-mono text-xs`} value={configEdit[p.id] ?? JSON.stringify(p.config, null, 2)} onChange={(e) => setConfigEdit({ ...configEdit, [p.id]: e.target.value })} />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Btn variant="primary" onClick={() => run(async () => { await api("/api/providers", { method: "PATCH", json: { ...p, config: JSON.parse(configEdit[p.id] ?? JSON.stringify(p.config)) } }); setConfigEdit((current) => { const next = { ...current }; delete next[p.id]; return next; }); }, "JSON protocol saved")}>Save JSON protocol</Btn>
                  <span className="text-xs text-muted">Placeholders: model, system, user, messages, images, responseFormat, standardRequest. Header-only secret: apiKey.</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Templates are JSON data, not executable code. responsePath uses dot and numeric-index syntax, for example output.text or result.items[0].text.</p>
        </Card>
      )}

      <Card title="System policies injected into every model call" className="mt-4">
        <div className="space-y-3">
          {s.policies.sort((a, b) => b.priority - a.priority).map((p) => (
            <div key={p.id} className="rounded-lg border p-3">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-sm font-semibold">{p.name} <Badge tone="pending">system · priority {p.priority}</Badge></div>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.enabled} onChange={(e) => run(() => api("/api/settings", { method: "PUT", json: { policy: { id: p.id, content: p.content, enabled: e.target.checked } } }))} /> enabled</label>
              </div>
              <textarea className={`${inputCls} h-24 text-xs`} value={edit[p.id] ?? p.content} onChange={(e) => setEdit({ ...edit, [p.id]: e.target.value })} />
              {edit[p.id] !== undefined && edit[p.id] !== p.content && <Btn className="mt-1" variant="primary" onClick={() => run(async () => { await api("/api/settings", { method: "PUT", json: { policy: { id: p.id, content: edit[p.id], enabled: p.enabled } } }); setEdit((x) => { const y = { ...x }; delete y[p.id]; return y; }); })}>Save policy</Btn>}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">The immutable RASQ-Ai mission, trust rules and output-schema rules are always prepended and cannot be disabled.</p>
      </Card>

      <Card title="Appearance" className="mt-4">
        <ThemePicker />
        <p className="mt-2 text-xs text-muted">The theme is stored in this browser only. Passed, failed, warning and review results use the same hues in every theme; on a mid-tone custom background their text fades toward black or white to stay readable.</p>
      </Card>
    </>
  );
}
