"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Activity, FileText, FlaskConical, LayoutDashboard, ScanEye, Settings, ShieldCheck, Workflow, ScrollText } from "lucide-react";
import { api, Btn, inputCls, ProjectProvider, useProject } from "./ui";
import { SURFACES } from "@/lib/types";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/scan", label: "Record & Scan", icon: ScanEye },
  { href: "/requirements", label: "SRS Documents", icon: FileText },
  { href: "/tests", label: "Test Scenarios", icon: FlaskConical },
  { href: "/workflows", label: "Workflows & Runs", icon: Workflow },
  { href: "/reports", label: "Reports", icon: ScrollText },
  { href: "/settings", label: "AI Models & Policy", icon: Settings },
];

function ProjectBar() {
  const { projects, current, setCurrent, reload } = useProject();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", surface: "web", targetUrl: "" });
  return (
    <div className="space-y-2 border-b border-slate-800 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Project</div>
      <select className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100" value={current?.id ?? ""} onChange={(e) => setCurrent(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.surface}
          </option>
        ))}
      </select>
      <button className="text-xs text-indigo-300 hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Cancel" : "+ New project"}
      </button>
      {open && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = await api<{ id: string }>("/api/projects", { json: f });
            await reload();
            setCurrent(p.id);
            setOpen(false);
            setF({ name: "", surface: "web", targetUrl: "" });
          }}
        >
          <input required className={inputCls} placeholder="Project name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select className={inputCls} value={f.surface} onChange={(e) => setF({ ...f, surface: e.target.value })}>
            {SURFACES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input className={inputCls} placeholder="Target URL (optional)" value={f.targetUrl} onChange={(e) => setF({ ...f, targetUrl: e.target.value })} />
          <Btn variant="primary" type="submit" className="w-full">
            Create
          </Btn>
        </form>
      )}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <ProjectProvider>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-slate-950 text-slate-300 md:flex">
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Activity size={20} />
            </div>
            <div>
              <div className="text-lg font-bold leading-none text-white">RASQ-Ai</div>
              <div className="text-[11px] text-slate-500">Optical test automation</div>
            </div>
          </div>
          <ProjectBar />
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link key={href} href={href} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-indigo-600 text-white" : "hover:bg-slate-900 hover:text-white"}`}>
                  <Icon size={17} />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="m-3 flex items-start gap-2 rounded-lg bg-slate-900 p-3 text-[11px] leading-snug text-slate-400">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
            Uploads &amp; SRS text are untrusted data. Nothing is sent to an AI provider unless you pick a model.
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <nav className="flex gap-1 overflow-x-auto border-b bg-slate-950 p-2 md:hidden">
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href} className={`whitespace-nowrap rounded px-2 py-1 text-xs ${path === href ? "bg-indigo-600 text-white" : "text-slate-300"}`}>
                {label}
              </Link>
            ))}
          </nav>
          <main className="mx-auto max-w-[1500px] p-5 md:p-7">{children}</main>
        </div>
      </div>
    </ProjectProvider>
  );
}
