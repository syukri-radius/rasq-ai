"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TASK_LABELS, type Task } from "@/lib/types";
import { api } from "./ui";

type Provider = { id: string; name: string; kind: string; models: string[]; enabled: boolean; keyConfigured: boolean; apiKeyEnv: string };
type Settings = { aiMode: string; providers: Provider[]; routes: { task: string; providerId: string | null; model: string }[] };

/** Lets the operator pick which multimodal model (or the local engine) powers a task. */
export default function ModelPicker({ task, onChange }: { task: Task; onChange?: (local: boolean) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const load = useCallback(async () => setS(await api<Settings>("/api/settings")), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const route = s?.routes.find((r) => r.task === task);
  const value = route?.providerId ? `${route.providerId}::${route.model}` : "local";
  useEffect(() => onChange?.(!route?.providerId || s?.aiMode !== "ai"), [route?.providerId, s?.aiMode, onChange]);
  if (!s) return <div className="h-9 w-56 animate-pulse rounded-lg bg-tint-2" />;
  const sel = s.providers.find((p) => p.id === route?.providerId);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        {TASK_LABELS[task]} model
        <select
          value={value}
          onChange={async (e) => {
            const [providerId, model] = e.target.value === "local" ? [null, ""] : e.target.value.split("::");
            await api("/api/settings", { method: "PUT", json: { route: { task, providerId, model } } });
            await load();
          }}
          className="rounded-lg border border-line-strong bg-field px-2 py-1.5 text-sm text-ink"
        >
          <option value="local">Local engine (no AI, no data sent)</option>
          {s.providers
            .filter((p) => p.enabled)
            .map((p) => (
              <optgroup key={p.id} label={`${p.name}${p.keyConfigured ? "" : " — key missing"}`}>
                {p.models.map((m) => (
                  <option key={m} value={`${p.id}::${m}`}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </label>
      {s.aiMode !== "ai" && <span className="text-xs text-warn-ink">AI kill switch is ON — <Link className="underline" href="/settings">Settings</Link></span>}
      {sel && !sel.keyConfigured && <span className="text-xs text-danger-ink">Server env {sel.apiKeyEnv} is not set; requests will fail.</span>}
      {sel && sel.keyConfigured && s.aiMode === "ai" && <span className="text-xs text-accent-ink">Data for this task will be sent to {sel.name}.</span>}
    </div>
  );
}
