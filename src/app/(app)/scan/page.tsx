"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Pause, Play, Square, X, Upload, Sparkles, Save, Trash2, Camera, Pencil } from "lucide-react";
import ModelPicker from "@/components/ModelPicker";
import { api, Badge, Btn, Card, inputCls, Notice, PageHeader, useProject } from "@/components/ui";
import { addFrame, analyze, dhash, type Candidate, type PageGroup } from "@/lib/perception";
import { CONTROL_TYPES, PERCEPTION_MODEL, type ControlType } from "@/lib/types";

type Item = {
  id: string; x: number; y: number; w: number; h: number;
  type: ControlType | "unknown"; label: string; confidence: number; evidence: string; hash: string;
  include: boolean; source: "perception" | "ai"; perceptionType: string; aiModel: string | null;
  controlId?: string;
};
type SavedControl = { id: string; type: ControlType; label: string; x: number; y: number; w: number; h: number; confidence: number; evidence: string; locatorHash: string; perceptionLabel: string; aiModel: string | null; source: string };
type SavedScreen = { id: string; recordingId: string | null; name: string; groupKey: string; width: number; height: number; frameCount: number; timestampMs: number; source: string; aiModel: string | null; controls: SavedControl[] };
type SavedRec = { id: string; name: string; durationMs: number; sizeBytes: number; sha256: string; createdAt: string };
type EditMeta = { screenId: string; groupKey: string };

const COLORS: Record<string, string> = { input: "#2563eb", button: "#7c3aed", dropdown: "#0891b2", date_picker: "#0d9488", checkbox: "#d97706", toggle: "#ea580c", slider: "#db2777", upload: "#65a30d", download: "#16a34a", text: "#475569", w_button: "#334155", w_text: "#64748b", s_input: "#0284c7", p_input: "#be123c", p_button: "#c026d3", h_button: "#9333ea", timer: "#b45309", gesture_arena: "#15803d", unknown: "#94a3b8" };

const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Cannot decode image")); i.src = src; });
const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Cannot read file")); r.readAsDataURL(f); });
const once = (el: HTMLVideoElement, ev: string, ms = 6000) => new Promise<void>((res, rej) => { const t = setTimeout(() => rej(new Error(`Video ${ev} timed out`)), ms); el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true }); });
const fmt = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function toItems(rep: PageGroup["rep"]): Item[] {
  return rep.analysis.candidates.map((c) => ({ ...c, label: "", include: c.type !== "unknown", source: "perception", perceptionType: c.type, aiModel: null }));
}

async function regionHash(dataUrl: string, b: { x: number; y: number; w: number; h: number }): Promise<string> {
  const img = await loadImg(dataUrl);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const lumAt = (x: number, y: number) => { const i = (Math.min(c.height - 1, Math.max(0, Math.floor(y))) * c.width + Math.min(c.width - 1, Math.max(0, Math.floor(x)))) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
  return dhash(lumAt, b.x, b.y, b.w, b.h);
}

export default function ScanPage() {
  const { current } = useProject();
  const [tab, setTab] = useState<"record" | "upload" | "capture">("record");
  const [groups, setGroups] = useState<PageGroup[]>([]);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [sel, setSel] = useState("");
  const [hi, setHi] = useState("");
  const [showUnknown, setShowUnknown] = useState(true);
  const [msg, setMsg] = useState<{ kind: "info" | "error" | "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [localModel, setLocalModel] = useState(true);
  const [saved, setSaved] = useState<SavedScreen[]>([]);
  const [recs, setRecs] = useState<SavedRec[]>([]);
  const [rstate, setRstate] = useState<"idle" | "recording" | "paused">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<{ blob: Blob; ms: number } | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, EditMeta>>({});
  const [capture, setCapture] = useState({ url: "", w: 1280, h: 800 });
  const [every, setEvery] = useState(1);

  const groupsRef = useRef<PageGroup[]>([]);
  const stateRef = useRef<"idle" | "recording" | "paused">("idle");
  const mr = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const vid = useRef<HTMLVideoElement | null>(null);
  const timers = useRef<{ s?: ReturnType<typeof setInterval>; t?: ReturnType<typeof setInterval> }>({});
  const clock = useRef({ start: 0, acc: 0 });
  const cancelled = useRef(false);

  const refresh = useCallback(async () => {
    if (!current) return;
    setSaved(await api<SavedScreen[]>(`/api/screens?projectId=${current.id}`));
    setRecs(await api<SavedRec[]>(`/api/recordings?projectId=${current.id}`));
  }, [current]);
  useEffect(() => { void refresh(); setCapture((c) => ({ ...c, url: current?.targetUrl ?? "" })); }, [refresh, current]);

  const ingest = useCallback((src: CanvasImageSource, w: number, h: number, tMs: number, dataUrl: string) => {
    const analysis = analyze(src, w, h);
    const before = groupsRef.current;
    const next = addFrame(before, { dataUrl, width: w, height: h, tMs, analysis });
    groupsRef.current = next;
    setGroups(next);
    setItems((prev) => {
      const out = { ...prev };
      for (const g of next) {
        const old = before.find((b) => b.key === g.key);
        if (!old || old.rep !== g.rep) out[g.key] = toItems(g.rep);
      }
      return out;
    });
    setSel((s) => s || next[0].key);
  }, []);

  const resetAll = () => { groupsRef.current = []; setGroups([]); setItems({}); setSel(""); setBlob(null); setRecordingId(null); setEditing({}); };

  /* ---------- recorder ---------- */
  const sample = useCallback(() => {
    const v = vid.current;
    if (stateRef.current !== "recording" || !v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    ingest(c, c.width, c.height, clock.current.acc + (Date.now() - clock.current.start), c.toDataURL("image/jpeg", 0.88));
  }, [ingest]);

  const cleanup = () => {
    clearInterval(timers.current.s); clearInterval(timers.current.t);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (vid.current) { vid.current.srcObject = null; }
  };
  const setRS = (s: "idle" | "recording" | "paused") => { stateRef.current = s; setRstate(s); };

  const start = async () => {
    try {
      resetAll(); setMsg(null); cancelled.current = false; chunks.current = [];
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
      stream.current = s;
      const v = document.createElement("video");
      v.muted = true; v.srcObject = s; await v.play();
      vid.current = v;
      const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      mr.current = rec;
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        if (cancelled.current) return;
        const ms = clock.current.acc;
        setBlob({ blob: new Blob(chunks.current, { type: rec.mimeType || "video/webm" }), ms });
      };
      s.getVideoTracks()[0].addEventListener("ended", () => stop());
      clock.current = { start: Date.now(), acc: 0 };
      rec.start(1000);
      setRS("recording"); setElapsed(0);
      timers.current.t = setInterval(() => setElapsed(clock.current.acc + (stateRef.current === "recording" ? Date.now() - clock.current.start : 0)), 250);
      setTimeout(sample, 600);
      timers.current.s = setInterval(sample, 1500);
    } catch (e) {
      cleanup(); setRS("idle");
      setMsg({ kind: "error", text: e instanceof Error ? `Screen capture unavailable: ${e.message}` : "Screen capture failed" });
    }
  };
  const pause = () => { if (stateRef.current !== "recording") return; clock.current.acc += Date.now() - clock.current.start; mr.current?.pause(); setRS("paused"); };
  const resume = () => { if (stateRef.current !== "paused") return; clock.current.start = Date.now(); mr.current?.resume(); setRS("recording"); };
  function stop() {
    if (stateRef.current === "idle") return;
    if (stateRef.current === "recording") { sample(); clock.current.acc += Date.now() - clock.current.start; }
    if (mr.current && mr.current.state !== "inactive") mr.current.stop();
    cleanup(); setRS("idle"); setElapsed(clock.current.acc);
    setMsg({ kind: "ok", text: "Recording stopped. Review the page groups, then save the recording and screens." });
  }
  const cancel = () => {
    cancelled.current = true;
    if (mr.current && mr.current.state !== "inactive") mr.current.stop();
    cleanup(); setRS("idle"); setElapsed(0); chunks.current = []; resetAll();
    setMsg({ kind: "warn", text: "Recording cancelled and discarded. Nothing was saved." });
  };
  useEffect(() => () => { cancelled.current = true; cleanup(); }, []);

  /* ---------- uploads ---------- */
  const scanVideo = async (url: string) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = url;
    await once(v, "loadedmetadata", 15000);
    if (!isFinite(v.duration)) { v.currentTime = 1e7; await once(v, "durationchange", 8000).catch(() => undefined); v.currentTime = 0; }
    if (!isFinite(v.duration) || !v.duration) throw new Error("Cannot determine video duration; re-encode to MP4 or re-record.");
    const total = Math.min(Math.floor(v.duration / every) + 1, 150);
    for (let i = 0; i < total; i++) {
      setBusy(`Scanning video frame ${i + 1}/${total}…`);
      v.currentTime = Math.min(v.duration - 0.05, i * every);
      await once(v, "seeked");
      const c = document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      ingest(c, c.width, c.height, Math.round(v.currentTime * 1000), c.toDataURL("image/jpeg", 0.88));
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      setMsg(null);
      for (const f of Array.from(files)) {
        if (f.type.startsWith("video/")) { setBusy("Loading video…"); await scanVideo(URL.createObjectURL(f)); }
        else if (f.type.startsWith("image/")) {
          setBusy(`Analysing ${f.name}…`);
          const d = await readFile(f); const img = await loadImg(d);
          ingest(img, img.naturalWidth, img.naturalHeight, 0, d);
        } else setMsg({ kind: "warn", text: `${f.name}: unsupported type ${f.type || "unknown"}` });
      }
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Scan failed" }); }
    finally { setBusy(""); }
  };

  const doCapture = async () => {
    try {
      setBusy("Capturing target with Playwright…"); setMsg(null);
      const r = await api<{ dataUrl: string; width: number; height: number }>("/api/capture", { json: capture });
      const img = await loadImg(r.dataUrl);
      ingest(img, r.width, r.height, 0, r.dataUrl);
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Capture failed" }); }
    finally { setBusy(""); }
  };

  /* ---------- saved-scan editing ---------- */
  const editSavedScreens = async (input: SavedScreen[]) => {
    if (!input.length) {
      setMsg({ kind: "warn", text: "No saved screen scan is associated with this recording yet. Rescan it and save the page groups first." });
      return;
    }
    try {
      setBusy("Loading saved scan for editing…");
      setMsg(null);
      resetAll();
      const list = [...input].sort((a, b) => a.timestampMs - b.timestampMs || a.name.localeCompare(b.name));
      const nextGroups: PageGroup[] = [];
      const nextItems: Record<string, Item[]> = {};
      const meta: Record<string, EditMeta> = {};
      for (const s of list) {
        const dataUrl = `/api/screens/${s.id}`;
        const img = await loadImg(dataUrl);
        const base = analyze(img, s.width, s.height);
        const candidates: Candidate[] = s.controls.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, type: c.type, confidence: c.confidence, evidence: c.evidence, hash: c.locatorHash }));
        const key = `saved-${s.id}`;
        nextGroups.push({
          key,
          name: s.name,
          frames: s.frameCount,
          firstMs: s.timestampMs,
          lastMs: s.timestampMs,
          rep: { dataUrl, width: s.width, height: s.height, tMs: s.timestampMs, analysis: { ...base, candidates } },
          sig: base.signature,
        });
        nextItems[key] = s.controls.map((c) => ({
          id: c.id,
          controlId: c.id,
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          type: c.type,
          label: c.label,
          confidence: c.confidence,
          evidence: c.evidence,
          hash: c.locatorHash,
          include: true,
          source: c.source === "ai" ? "ai" : "perception",
          perceptionType: c.perceptionLabel.split(":").pop() || c.type,
          aiModel: c.aiModel,
        }));
        meta[key] = { screenId: s.id, groupKey: s.groupKey };
      }
      groupsRef.current = nextGroups;
      setGroups(nextGroups);
      setItems(nextItems);
      setEditing(meta);
      setSel(nextGroups[0]?.key ?? "");
      setRecordingId(list[0].recordingId);
      setTab("upload");
      setMsg({ kind: "ok", text: `Loaded ${list.length} saved page/window group(s) for editing. Adjust labels, types or included controls, then Save all to update them without duplication.` });
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not load the saved scan" });
    } finally {
      setBusy("");
    }
  };

  /* ---------- AI enrichment ---------- */
  const enrich = async () => {
    const g = groups.find((x) => x.key === sel);
    if (!g) return;
    try {
      setBusy("Asking the selected multimodal model…"); setMsg(null);
      const img = await loadImg(g.rep.dataUrl);
      const f = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
      const aw = Math.round(img.naturalWidth * f), ah = Math.round(img.naturalHeight * f);
      const c = document.createElement("canvas"); c.width = aw; c.height = ah;
      c.getContext("2d")!.drawImage(img, 0, 0, aw, ah);
      const list = items[g.key] ?? [];
      const res = await api<{ model: string; controls: { candidateId: string; type: ControlType | null; label: string; confidence: number; evidence: string }[]; missed: { x: number; y: number; w: number; h: number; type: ControlType; label: string; confidence: number; evidence: string }[] }>("/api/ai/scan", {
        json: { name: g.name, width: aw, height: ah, imageDataUrl: c.toDataURL("image/jpeg", 0.85), candidates: list.map((i) => ({ id: i.id, x: Math.round(i.x * f), y: Math.round(i.y * f), w: Math.round(i.w * f), h: Math.round(i.h * f), type: i.perceptionType, confidence: i.confidence })) },
      });
      const byId = new Map(res.controls.map((x) => [x.candidateId, x]));
      const next: Item[] = list.map((i) => {
        const a = byId.get(i.id);
        if (!a) return i;
        if (!a.type) return { ...i, include: false, evidence: `AI: not a supported visual test object. ${a.evidence}`, aiModel: res.model };
        return { ...i, type: a.type, label: a.label, confidence: a.confidence, evidence: a.evidence || i.evidence, include: true, source: "ai", aiModel: res.model };
      });
      let n = 0;
      for (const m of res.missed) {
        const box = { x: Math.round(m.x / f), y: Math.round(m.y / f), w: Math.round(m.w / f), h: Math.round(m.h / f) };
        next.push({ ...box, id: `ai${++n}`, type: m.type, label: m.label, confidence: Math.min(m.confidence, 0.6), evidence: `AI-added (not in perception candidates): ${m.evidence}`, hash: await regionHash(g.rep.dataUrl, box), include: true, source: "ai", perceptionType: "unknown", aiModel: res.model });
      }
      setItems((p) => ({ ...p, [g.key]: next }));
      setMsg({ kind: "ok", text: `${res.model} enriched ${res.controls.length} candidates and added ${res.missed.length} missed controls. Coordinates of perception candidates were preserved.` });
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "AI scan failed" }); }
    finally { setBusy(""); }
  };

  /* ---------- save ---------- */
  const saveAll = async () => {
    if (!current || !groups.length) return;
    try {
      setBusy("Saving…");
      let rid = recordingId;
      if (blob && !rid) {
        const fd = new FormData();
        fd.append("file", blob.blob, "recording.webm"); fd.append("projectId", current.id); fd.append("durationMs", String(blob.ms));
        const r = await fetch("/api/recordings", { method: "POST", body: fd });
        if (!r.ok) throw new Error("Recording upload failed");
        rid = (await r.json()).id; setRecordingId(rid);
      }
      let total = 0;
      let created = 0;
      let updated = 0;
      const nextEditing = { ...editing };
      for (const g of groups) {
        const ctl = (items[g.key] ?? []).filter((i) => i.include && i.type !== "unknown");
        total += ctl.length;
        const meta = editing[g.key];
        const payload = {
          name: g.name,
          groupKey: meta?.groupKey ?? g.key,
          frameCount: g.frames,
          timestampMs: g.rep.tMs,
          aiModel: ctl.find((c) => c.aiModel)?.aiModel ?? null,
          controls: ctl.map((c) => ({ id: c.controlId, type: c.type, label: c.label, x: c.x, y: c.y, w: c.w, h: c.h, confidence: c.confidence, evidence: c.evidence, locatorHash: c.hash, perceptionLabel: `${PERCEPTION_MODEL}:${c.perceptionType}`, aiModel: c.aiModel, source: c.source })),
        };
        let savedControls: { id: string }[];
        if (meta) {
          const updatedScreen = await api<{ controls: { id: string }[] }>(`/api/screens/${meta.screenId}`, { method: "PUT", json: payload });
          savedControls = updatedScreen.controls;
          nextEditing[g.key] = meta;
          updated++;
        } else {
          const createdScreen = await api<{ id: string; controls: { id: string }[] }>("/api/screens", { json: { ...payload, projectId: current.id, recordingId: rid, source: rid ? "recording" : "screenshot", width: g.rep.width, height: g.rep.height, imageDataUrl: g.rep.dataUrl } });
          savedControls = createdScreen.controls;
          nextEditing[g.key] = { screenId: createdScreen.id, groupKey: payload.groupKey };
          created++;
        }
        // Adopt server IDs for new controls so every later save preserves scenario bindings too.
        let controlIndex = 0;
        setItems((prev) => ({
          ...prev,
          [g.key]: (prev[g.key] ?? []).map((item) => {
            if (!item.include || item.type === "unknown") return item;
            const savedControl = savedControls[controlIndex++];
            return savedControl ? { ...item, id: savedControl.id, controlId: savedControl.id } : item;
          }),
        }));
        // Checkpoint IDs so a retry after a partial failure updates instead of duplicating.
        setEditing({ ...nextEditing });
      }
      setMsg({ kind: "ok", text: `Saved ${groups.length} page/window group(s) with ${total} controls (${updated} updated, ${created} created)${rid ? " linked to the recording" : ""}.` });
      await refresh();
    } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Save failed" }); }
    finally { setBusy(""); }
  };

  const group = groups.find((g) => g.key === sel);
  const list = (group && items[group.key]) || [];
  const editingCount = Object.keys(editing).length;
  const upd = (id: string, p: Partial<Item>) => setItems((m) => ({ ...m, [sel]: (m[sel] ?? []).map((i) => (i.id === id ? { ...i, ...p } : i)) }));

  return (
    <>
      <PageHeader title="Record & Visual Scan" subtitle="Record, upload or capture evidence, then save and re-edit page/window controls. Client perception proposes geometry; an optional multimodal model supplies semantics. Saved controls feed visual-only Test Scenarios.">
        <ModelPicker task="visual_scan" onChange={setLocalModel} />
      </PageHeader>
      {msg && <div className="mb-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      {!current && <Notice kind="warn">Select or create a project first.</Notice>}
      {editingCount > 0 && <div className="mb-3"><Notice kind="info">Editing {editingCount} saved screen(s). Save changes updates the existing rows and preserves unchanged control IDs for scenario bindings. Clear to discard this editing session.</Notice></div>}

      <div className="mb-4 grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card title="Evidence source">
          <div className="mb-3 flex gap-1 rounded-lg bg-well p-1 text-sm">
            {(["record", "upload", "capture"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-md px-2 py-1 capitalize ${tab === t ? "bg-raised font-semibold text-ink shadow-sm" : "text-muted"}`}>{t === "capture" ? "Capture URL" : t === "upload" ? "Upload" : "Record screen"}</button>
            ))}
          </div>
          {tab === "record" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border bg-well px-4 py-3 text-ink">
                <span className={`h-3 w-3 rounded-full ${rstate === "recording" ? "animate-pulse bg-danger" : rstate === "paused" ? "bg-warn" : "bg-faint"}`} />
                <span className="font-mono text-2xl">{fmt(elapsed)}</span>
                <span className="ml-auto text-xs uppercase tracking-wide text-muted">{rstate}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Btn variant="danger" onClick={start} disabled={rstate !== "idle" || !current}><Circle size={14} /> Start</Btn>
                {rstate === "paused" ? <Btn variant="warn" onClick={resume}><Play size={14} /> Resume</Btn> : <Btn onClick={pause} disabled={rstate !== "recording"}><Pause size={14} /> Pause</Btn>}
                <Btn variant="primary" onClick={stop} disabled={rstate === "idle"}><Square size={14} /> Stop</Btn>
                <Btn onClick={cancel} disabled={rstate === "idle" && !blob}><X size={14} /> Cancel</Btn>
              </div>
              <p className="text-xs text-muted">Choose “Entire screen” in the browser prompt. Frames are sampled every 1.5 s and grouped by page/window similarity so a recording that visits several pages yields one group per page.</p>
              {blob && <video controls className="w-full rounded-lg" src={URL.createObjectURL(blob.blob)} />}
            </div>
          )}
          {tab === "upload" && (
            <div className="space-y-3">
              <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line-strong text-sm text-muted hover:border-accent-line">
                <Upload size={20} /> Screenshots (PNG/JPEG/WebP) or screen recordings
                <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted">Video sample interval (s)<input type="number" min={0.5} step={0.5} value={every} onChange={(e) => setEvery(Math.max(0.5, Number(e.target.value) || 1))} className={`${inputCls} w-20`} /></label>
              {recs.length > 0 && (
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-muted">Saved recordings</div>
                  {recs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 rounded border p-2">
                      <span className="truncate">{r.name} · {fmt(r.durationMs)} · {(r.sizeBytes / 1e6).toFixed(1)} MB</span>
                      <span className="flex gap-1">
                        <Btn className="!px-2 !py-0.5 text-xs" title="Load the saved controls and page groups for update-in-place editing" onClick={() => void editSavedScreens(saved.filter((s) => s.recordingId === r.id))}><Pencil size={12} /> Edit saved</Btn>
                        <Btn className="!px-2 !py-0.5 text-xs" title="Discard the current editor and analyze the recording frames again" onClick={async () => { try { resetAll(); setMsg(null); setBusy("Loading recording…"); await scanVideo(`/api/recordings/${r.id}`); setRecordingId(r.id); } catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Scan failed" }); } finally { setBusy(""); } }}>Rescan</Btn>
                        <Btn variant="danger" className="!px-2 !py-0.5 text-xs" onClick={async () => { await api(`/api/recordings/${r.id}`, { method: "DELETE" }); void refresh(); }}><Trash2 size={12} /></Btn>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === "capture" && (
            <div className="space-y-2">
              <input className={inputCls} placeholder="https://… or /demo-target" value={capture.url} onChange={(e) => setCapture({ ...capture, url: e.target.value })} />
              <div className="flex gap-2"><input type="number" className={inputCls} value={capture.w} onChange={(e) => setCapture({ ...capture, w: Number(e.target.value) })} /><input type="number" className={inputCls} value={capture.h} onChange={(e) => setCapture({ ...capture, h: Number(e.target.value) })} /></div>
              <Btn variant="primary" className="w-full" onClick={doCapture} disabled={!capture.url || !!busy}><Camera size={14} /> Capture screenshot</Btn>
              <p className="text-xs text-muted">Server-side Playwright takes one screenshot of the URL you supply. Try <code>/demo-target</code>.</p>
            </div>
          )}
          {busy && <div className="mt-3 flex items-center gap-2 text-sm text-accent-ink"><span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent-ink" />{busy}</div>}
        </Card>

        <Card title={`Page / window groups (${groups.length})`} actions={groups.length > 0 && <div className="flex gap-2"><Btn onClick={resetAll}>Clear</Btn><Btn variant="success" onClick={saveAll} disabled={!!busy}><Save size={14} /> {editingCount ? "Save changes" : "Save all"}</Btn></div>}>
          {groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No evidence yet. Record, upload or capture to see detected pages and controls.</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {groups.map((g) => (
                <button key={g.key} onClick={() => setSel(g.key)} className={`w-44 shrink-0 rounded-lg border p-2 text-left ${sel === g.key ? "border-accent-line bg-accent-soft" : "border-line"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={g.rep.dataUrl} alt={g.name} className="h-24 w-full rounded object-cover object-top" />
                  <input value={g.name} onClick={(e) => e.stopPropagation()} onChange={(e) => { const v = e.target.value; groupsRef.current = groupsRef.current.map((x) => (x.key === g.key ? { ...x, name: v } : x)); setGroups(groupsRef.current); }} className="mt-1 w-full rounded bg-transparent text-sm font-semibold" />
                  <div className="text-xs text-muted">{g.frames} frame(s) · {(items[g.key] ?? []).filter((i) => i.include).length} controls · {fmt(g.firstMs)}–{fmt(g.lastMs)}</div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {group && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card title={`${group.name} · ${group.rep.width}×${group.rep.height}px source`} actions={<label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={showUnknown} onChange={(e) => setShowUnknown(e.target.checked)} /> show non-controls</label>}>
            <div className="relative overflow-auto rounded-lg border bg-well">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={group.rep.dataUrl} alt="" className="block w-full" />
              <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${group.rep.width} ${group.rep.height}`} preserveAspectRatio="none">
                {list.filter((i) => showUnknown || i.type !== "unknown").map((i) => (
                  <g key={i.id} onClick={() => setHi(i.id)} className="cursor-pointer">
                    <rect x={i.x} y={i.y} width={i.w} height={i.h} fill={hi === i.id ? COLORS[i.type] + "55" : "transparent"} stroke={COLORS[i.type]} strokeWidth={hi === i.id ? 4 : 2} strokeDasharray={i.include ? undefined : "6 4"} opacity={i.include ? 1 : 0.5} vectorEffect="non-scaling-stroke" />
                  </g>
                ))}
              </svg>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">{CONTROL_TYPES.map((t) => <span key={t} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm border border-line-strong" style={{ background: COLORS[t] }} />{t.replace("_", " ")}</span>)}</div>
            <p className="mt-2 text-xs text-muted">perception stats: edge threshold {group.rep.analysis.stats.edgeThreshold}, {group.rep.analysis.stats.components} components, {group.rep.analysis.stats.merged} merges.</p>
          </Card>

          <Card title={`Controls (${list.filter((i) => i.include).length} selected of ${list.length})`} actions={<Btn variant="primary" onClick={enrich} disabled={localModel || !!busy} title={localModel ? "Pick an AI model above to enable" : ""}><Sparkles size={14} /> Enrich with AI</Btn>}>
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-sticky text-left text-muted"><tr><th className="p-1"></th><th className="p-1">Type</th><th className="p-1">Label</th><th className="p-1">Conf.</th><th className="p-1">Box (x,y,w,h)</th></tr></thead>
                <tbody>
                  {list.filter((i) => showUnknown || i.type !== "unknown").map((i) => (
                    <tr key={i.id} onClick={() => setHi(i.id)} className={`cursor-pointer border-t align-top ${hi === i.id ? "bg-accent-soft" : ""}`}>
                      <td className="p-1"><input type="checkbox" checked={i.include} disabled={i.type === "unknown"} onChange={(e) => upd(i.id, { include: e.target.checked })} /></td>
                      <td className="p-1">
                        <select value={i.type} onChange={(e) => upd(i.id, { type: e.target.value as Item["type"], include: e.target.value !== "unknown" })} className="rounded border px-1 py-0.5">
                          <option value="unknown">— none —</option>
                          {CONTROL_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                        </select>
                        <div className="mt-1"><Badge tone={i.source === "ai" ? undefined : "pending"}>{i.source === "ai" ? `AI ${i.aiModel ?? ""}` : "perception"}</Badge></div>
                      </td>
                      <td className="p-1"><input value={i.label} placeholder="visible label" onChange={(e) => upd(i.id, { label: e.target.value })} className="w-full rounded border px-1 py-0.5" /><div className="mt-1 text-[10px] leading-snug text-muted">{i.evidence}</div></td>
                      <td className="p-1">{i.confidence.toFixed(2)}</td>
                      <td className="p-1 font-mono text-[10px]">{i.x},{i.y},{i.w},{i.h}<div className="text-faint">{i.hash}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Confidence reflects visual evidence only. Perception labels come from geometry; AI provenance is stored separately. Locators are visual (region + template hash), never guessed DOM selectors.</p>
          </Card>
        </div>
      )}

      <Card title={`Saved screens (${saved.length})`} className="mt-4">
        {saved.length === 0 ? <p className="text-sm text-muted">Nothing saved for this project yet.</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {saved.map((s) => (
              <div key={s.id} className="rounded-lg border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/screens/${s.id}`} alt={s.name} className="h-28 w-full rounded object-cover object-top" />
                <div className="mt-1 flex items-center justify-between gap-1">
                  <div className="truncate text-sm font-semibold">{s.name}</div>
                  <div className="flex gap-1">
                    <Btn className="!px-1.5 !py-0.5" title="Re-edit this saved scan" onClick={() => void editSavedScreens([s])}><Pencil size={12} /></Btn>
                    <Btn variant="danger" className="!px-1.5 !py-0.5" onClick={async () => { await api(`/api/screens/${s.id}`, { method: "DELETE" }); void refresh(); }}><Trash2 size={12} /></Btn>
                  </div>
                </div>
                <div className="text-xs text-muted">{s.controls.length} controls · {s.width}×{s.height} · {s.groupKey} · {s.source}</div>
                {s.aiModel && <div className="text-[11px] text-accent-ink">AI: {s.aiModel}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
