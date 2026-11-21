import Link from "next/link";
import { count, desc } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import { controls, projects, requirements, runs, screens, testCases, workflows, recordings } from "@/db/schema";
import { Badge, Card, PageHeader } from "@/components/ui";
import BotAvatarPanel from "@/components/BotAvatarPanel";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const db = await getDb();
  const n = async (t: SQLiteTable) => (await db.select({ c: count() }).from(t))[0].c;
  const stats = [
    { label: "Projects", v: await n(projects) },
    { label: "Recordings", v: await n(recordings) },
    { label: "Page/window groups", v: await n(screens) },
    { label: "Visual controls", v: await n(controls) },
    { label: "Requirements", v: await n(requirements) },
    { label: "Test cases", v: await n(testCases) },
    { label: "Workflows", v: await n(workflows) },
    { label: "Runs", v: await n(runs) },
  ];
  const latest = await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(6);
  const pipeline = [
    { href: "/scan", t: "1 · Record & scan", d: "Record the full screen (start / pause / stop / cancel) or upload evidence. Pixels become candidate regions, grouped per page or window." },
    { href: "/requirements", t: "2 · Analyse SRS", d: "Upload PDF/text. Exact requirement IDs, acceptance criteria and ambiguities are extracted." },
    { href: "/tests", t: "3 · Design tests", d: "Traceable positive, negative, boundary and non-functional cases with synthetic data and P0–P3 priority." },
    { href: "/workflows", t: "4 · Automate & monitor", d: "n8n-compatible workflow on a ReactFlow canvas, executed by Playwright with live node status." },
    { href: "/reports", t: "5 · Report", d: "Coverage and evidence report that never claims results that were not recorded." },
  ];
  return (
    <>
      <PageHeader title="RASQ-Ai Command Center" subtitle="Zero-DOM optical automation: client perception supplies geometry, an optional multimodal model supplies semantics, Playwright supplies execution evidence." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <div className="text-3xl font-bold text-accent-ink">{s.v}</div>
            <div className="text-sm text-muted">{s.label}</div>
          </Card>
        ))}
      </div>
      <div className="mb-6 grid gap-3 md:grid-cols-5">
        {pipeline.map((p) => (
          <Link key={p.href} href={p.href} className="rq-glass rounded-xl p-4 transition hover:border-accent-line">
            <div className="font-semibold text-ink">{p.t}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{p.d}</p>
          </Link>
        ))}
      </div>
      <div className="mb-6">
        <BotAvatarPanel />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Latest runs">
          {latest.length === 0 ? (
            <p className="text-sm text-muted">No runs yet. Nothing has been executed.</p>
          ) : (
            <ul className="divide-y text-sm">
              {latest.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span className="text-muted">{r.startedAt.toLocaleString()} · {r.mode}</span>
                  <Badge>{r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Trust & safety guarantees">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
            <li>Images, PDFs and SRS text are untrusted data — embedded instructions are never followed.</li>
            <li>No selectors, labels, coordinates or outcomes are invented; ambiguity is flagged.</li>
            <li>Secrets, production PANs and personal data are redacted before any model call.</li>
            <li>Provider credentials live only in server env vars and are never shown.</li>
            <li>Step results come only from real Playwright runs; dry-runs are labelled as not executed.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
