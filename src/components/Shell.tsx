"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Activity, FileText, FlaskConical, LayoutDashboard, ScanEye, Settings, ShieldCheck, Workflow, ScrollText } from "lucide-react";
import { api, Btn, inputCls, ProjectProvider, useProject } from "./ui";
import ThemePicker, { ThemeEffect } from "./ThemePicker";
import { SURFACES } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";

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
    <div className="space-y-2 border-b p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Project</div>
      <select className={inputCls} aria-label="Project" value={current?.id ?? ""} onChange={(e) => setCurrent(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.surface}
          </option>
        ))}
      </select>
      <button className="text-xs text-accent-ink hover:underline" onClick={() => setOpen(!open)}>
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
      <ThemeEffect />
      <div className="rq-app flex min-h-screen">
        <aside className="rq-glass sticky top-3 my-3 ml-3 hidden h-[calc(100vh-1.5rem)] w-64 shrink-0 flex-col overflow-hidden rounded-2xl md:flex">
          <div className="flex items-center gap-2 border-b px-4 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-on-accent">
              <Activity size={20} />
            </div>
            <div>
              <div className="flex items-baseline gap-1.5 text-lg font-bold leading-none text-ink">
                RASQ-Ai
                <span className="text-[11px] font-medium text-muted">v{APP_VERSION}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted">Optical test automation</div>
            </div>
          </div>
          <ProjectBar />
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-tint-1 hover:text-ink"}`}>
                  <Icon size={17} />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="space-y-2 border-t p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Theme</div>
            <ThemePicker />
          </div>
          <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg bg-well p-3 text-[11px] leading-snug text-muted">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-ok-ink" />
            Uploads &amp; SRS text are untrusted data. Nothing is sent to an AI provider unless you pick a model.
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <nav className="rq-glass flex gap-1 overflow-x-auto border-x-0 border-t-0 p-2 md:hidden">
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={`whitespace-nowrap rounded px-2 py-1 text-xs ${path === href ? "bg-accent font-medium text-on-accent" : "text-muted"}`}>
                {label}
              </Link>
            ))}
          </nav>
          {/* The floating sidebar takes 12px more than the docked one did. Main gives them back (padding and cap), so every page keeps the content box it was laid out for. */}
          <main className="mx-auto max-w-[1500px] p-5 md:max-w-[1488px] md:p-7 md:pl-4">{children}</main>
        </div>
      </div>
    </ProjectProvider>
  );
}
