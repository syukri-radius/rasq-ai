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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
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
    primary: "bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-600",
    ghost: "bg-white text-slate-700 hover:bg-slate-100 border-slate-300",
    danger: "bg-white text-rose-700 hover:bg-rose-50 border-rose-300",
    success: "bg-emerald-600 text-white hover:bg-emerald-500 border-emerald-600",
    warn: "bg-amber-500 text-white hover:bg-amber-400 border-amber-500",
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`} />;
}

const tones: Record<string, string> = {
  passed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  error: "bg-rose-100 text-rose-800",
  warning: "bg-amber-100 text-amber-800",
  "needs-review": "bg-violet-100 text-violet-800",
  skipped: "bg-slate-200 text-slate-700",
  running: "bg-sky-100 text-sky-800",
  pending: "bg-slate-100 text-slate-500",
  P0: "bg-rose-100 text-rose-800",
  P1: "bg-orange-100 text-orange-800",
  P2: "bg-amber-100 text-amber-800",
  P3: "bg-slate-200 text-slate-700",
};
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone ?? String(children)] ?? "bg-indigo-100 text-indigo-800"}`}>{children}</span>;
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  const c = { info: "border-sky-200 bg-sky-50 text-sky-900", error: "border-rose-200 bg-rose-50 text-rose-900", ok: "border-emerald-200 bg-emerald-50 text-emerald-900", warn: "border-amber-200 bg-amber-50 text-amber-900" }[kind];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</div>;
}

export const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

export function download(name: string, text: string, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
