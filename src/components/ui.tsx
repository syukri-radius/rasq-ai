"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export type Project = { id: string; name: string; surface: string; targetUrl: string; description: string };

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, json !== undefined ? { ...rest, method: rest.method ?? "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) } : rest);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

type Ctx = { projects: Project[]; current: Project | null; setCurrent: (id: string) => void; reload: () => Promise<void> };
export const ProjectCtx = createContext<Ctx>({ projects: [], current: null, setCurrent: () => {}, reload: async () => {} });
export const useProject = () => useContext(ProjectCtx);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [id, setId] = useState("");
  const reload = useCallback(async () => {
    const list = await api<Project[]>("/api/projects");
    setProjects(list);
    setId((cur) => (list.some((p) => p.id === cur) ? cur : localStorage.getItem("rasq.project") && list.some((p) => p.id === localStorage.getItem("rasq.project")) ? localStorage.getItem("rasq.project")! : (list.find((p) => p.surface === "web") ?? list[0])?.id ?? ""));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const setCurrent = (v: string) => {
    setId(v);
    localStorage.setItem("rasq.project", v);
  };
  return <ProjectCtx.Provider value={{ projects, current: projects.find((p) => p.id === id) ?? null, setCurrent, reload }}>{children}</ProjectCtx.Provider>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rq-glass rounded-xl p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "success" | "warn" };
export function Btn({ variant = "ghost", className = "", ...p }: BtnProps) {
  const v = {
    primary: "border-transparent bg-accent text-on-accent hover:bg-accent-hover",
    ghost: "border-line-strong bg-raised text-ink hover:bg-raised-hover",
    danger: "border-danger-line bg-raised text-danger-ink hover:bg-danger-soft",
    success: "border-transparent bg-ok text-on-ok hover:bg-ok-hover",
    warn: "border-transparent bg-warn text-on-warn hover:bg-warn-hover",
  }[variant];
  // A disabled button drops its fill for a dashed outline instead of fading, so its label stays readable in every theme.
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-dashed disabled:border-line-strong disabled:bg-transparent disabled:text-muted ${v} ${className}`} />;
}

// Status tones come from fixed status hues, not from the theme accent. Every badge also states its status in words.
const tones: Record<string, string> = {
  passed: "border-ok-line bg-ok-soft text-ok-ink",
  failed: "border-danger-line bg-danger-soft text-danger-ink",
  error: "border-danger-line bg-danger-soft text-danger-ink",
  warning: "border-warn-line bg-warn-soft text-warn-ink",
  "needs-review": "border-review-line bg-review-soft text-review-ink",
  skipped: "border-line-strong bg-tint-2 text-ink",
  running: "border-info-line bg-info-soft text-info-ink",
  pending: "border-line bg-tint-1 text-ink",
  P0: "border-danger-line bg-danger-soft text-danger-ink",
  P1: "border-orange-line bg-orange-soft text-orange-ink",
  P2: "border-warn-line bg-warn-soft text-warn-ink",
  P3: "border-line-strong bg-tint-2 text-ink",
};
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone ?? String(children)] ?? "border-accent-line bg-accent-soft text-accent-ink"}`}>{children}</span>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  const c = { info: "border-info-line bg-info-soft text-info-ink", error: "border-danger-line bg-danger-soft text-danger-ink", ok: "border-ok-line bg-ok-soft text-ok-ink", warn: "border-warn-line bg-warn-soft text-warn-ink" }[kind];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

export const inputCls = "w-full rounded-lg border border-line-strong bg-field px-3 py-1.5 text-sm text-ink";

export function download(name: string, text: string, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
