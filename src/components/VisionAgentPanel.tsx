'use client';

import { useEffect, useRef, useState } from 'react';
import { api, Btn, inputCls, Notice } from './ui';
import type { LiveScanSession } from '@/lib/visionAgent';
import type { InControl } from '@/lib/screens';

export default function VisionAgentPanel({ projectId, regionHash, onSaved }: {
  projectId?: string; regionHash: (image: string, box: InControl) => Promise<string>; onSaved: () => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('List the visible interactive controls');
  const [assertion, setAssertion] = useState('');
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<LiveScanSession | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [savedId, setSavedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { setResult(null); setSelected([]); setSavedId(''); controller.current?.abort(); }, [projectId]);
  const discover = async () => {
    setBusy(true); setMessage(''); setResult(null); setSelected([]); setSavedId('');
    controller.current = new AbortController();
    try { setResult(await api<LiveScanSession>('/api/vision-agent', { json: { url, command, assertion, consent }, signal: controller.current.signal })); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Discovery failed'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!result || !projectId || savedId || !window.confirm(`Save this screenshot and ${selected.length} selected agent proposals as RASQ controls? Review their geometry and labels first.`)) return;
    setBusy(true);
    try {
      const controls = await Promise.all(selected.map(async i => ({ ...result.controls[i], locatorHash: await regionHash(result.imageDataUrl, result.controls[i]) })));
      const screen = await api<{ id: string }>('/api/screens', { headers: { 'Idempotency-Key': `vision-screen-${result.id}` }, json: { projectId, name: 'Vision Agent snapshot', source: 'vision_agent', width: result.width, height: result.height, imageDataUrl: result.imageDataUrl, aiModel: result.model, controls } });
      setSavedId(screen.id); setMessage('Screen saved. You can review/edit it in saved scans.'); await onSaved();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };
  const draft = async () => {
    if (!savedId || !projectId || !window.confirm('Append visual test drafts from this saved screen? These are generated cases, not executed tests.')) return;
    setBusy(true);
    try { await api('/api/tests', { json: { projectId, source: 'visual', screenIds: [savedId], replace: false }, headers: { 'Idempotency-Key': `vision-draft-${savedId}` } }); setMessage('Visual test drafts created in Tests (not executed).'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Draft creation failed'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3" aria-label="Vision Agent Beta">
    <Notice kind="warn">Live-page discovery only. Each request opens a fresh, isolated browser and closes it afterward. Actions and scenarios are not enabled. AI proposals and assertions are unverified, never test passes.</Notice>
    <label className="block text-sm">Live target URL<input className={inputCls} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://staging.example.com" disabled={busy} /></label>
    <label className="block text-sm">Natural-language discovery command<textarea className={inputCls} maxLength={1500} value={command} onChange={e => setCommand(e.target.value)} disabled={busy} /></label>
    <label className="block text-sm">Optional visual assertion<textarea className={inputCls} maxLength={1500} value={assertion} onChange={e => setAssertion(e.target.value)} disabled={busy} /></label>
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} />I reviewed the target for sensitive information. Screenshots are not pixel-redacted and are sent to the selected visual_scan provider, which may be external. Do not include secrets or personal data.</label>
    <Btn onClick={discover} disabled={busy || !projectId || !url || !command.trim() || !consent}>Propose controls</Btn>
    {busy && <Btn onClick={() => controller.current?.abort()}>Cancel discovery</Btn>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {result && <>
      <p className="break-all text-xs">Provenance: {result.model}</p>
      <h3 className="font-semibold">Step timeline</h3>
      <ol className="space-y-2 text-xs">{result.steps.map((s, i) => <li key={i}>{s.kind}: {s.instruction} — {s.status} ({s.durationMs} ms). {s.message}</li>)}</ol>
      <h3 className="font-semibold">Screenshot / evidence</h3>
      <p className="text-xs">Viewport captured after discovery. Dynamic content may differ from the model’s input; proposals are not observations.</p>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={result.imageDataUrl} alt="Captured live viewport; boxes are agent proposals" className="w-full" />
        {result.controls.map((c, i) => <div key={i} title={`${c.label}: ${c.evidence}`} className="pointer-events-none absolute border border-accent" style={{ left: `${100*c.x/result.width}%`, top: `${100*c.y/result.height}%`, width: `${100*c.w/result.width}%`, height: `${100*c.h/result.height}%` }} />)}
      </div>
      <p className="text-xs">Inspect each box against the screenshot before adding it. Selected proposals receive visual anchor hashes when saved.</p>
      <ul className="space-y-2">{result.controls.map((c, i) => <li key={i} className="text-xs"><label><input type="checkbox" checked={selected.includes(i)} disabled={busy || !!savedId} onChange={e => setSelected(s => e.target.checked ? [...s, i] : s.filter(n => n !== i))} /> Add as control: {c.type} — {c.label} ({c.x}, {c.y}, {c.w}×{c.h})</label><p>{c.evidence}</p></li>)}</ul>
      <div className="flex flex-wrap gap-2"><Btn onClick={save} disabled={busy || !!savedId || !projectId}>Save as screen</Btn><Btn onClick={draft} disabled={busy || !savedId || !selected.length}>Create test draft</Btn></div>
    </>}
  </section>;
}
