import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq, asc, and, inArray, lt } from "drizzle-orm";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, type Db } from "@/db";
import { runs, runSteps, workflows } from "@/db/schema";
import { executionOrder, NT, type N8nNode, type N8nWorkflow } from "./n8n";
import { hashSimilarity } from "./perception";
import { isReviewOnlyControlType, type RunStatus } from "./types";
import { notifyWebhooks, runCompletedData, loadRunForEvent } from "./webhooks";

export const DATA_DIR = path.resolve(process.cwd(), "data");
export const baseUrl = () => `http://127.0.0.1:${process.env.PORT ?? 3000}`;
export const resolveUrl = (u: string) => (u.startsWith("/") ? baseUrl() + u : u);

export function assertSafeUrl(u: string): URL {
  const url = new URL(resolveUrl(u));
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) targets are allowed.");
  if (/^(169\.254\.|metadata\.google)/.test(url.hostname)) throw new Error("Link-local / metadata addresses are blocked.");
  return url;
}

const INSTALL_HINT = "Chromium for Playwright is not available on this server. Run `npx playwright install chromium` (add `--with-deps` on Linux) and retry.";

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  } catch (e) {
    throw new Error(`${INSTALL_HINT}\n${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  }
}

export async function captureScreenshot(url: string, width: number, height: number): Promise<Buffer> {
  const u = assertSafeUrl(url);
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto(u.toString(), { waitUntil: "load", timeout: 20_000 });
    await page.waitForTimeout(400);
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

type Outcome = { status: RunStatus; message: string; evidence?: Record<string, unknown> };
type Ctx = {
  browser: Browser;
  context?: BrowserContext;
  page?: Page;
  helper?: Page;
  vw: number;
  vh: number;
  targetUrl: string;
  before?: Buffer;
  actionStart: number;
  lastMs: number;
};

async function hashPng(helper: Page, png: Buffer): Promise<string> {
  return helper.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext("2d")!;
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    const lumAt = (x: number, y: number) => {
      const xi = Math.min(c.width - 1, Math.max(0, Math.floor(x)));
      const yi = Math.min(c.height - 1, Math.max(0, Math.floor(y)));
      const i = (yi * c.width + xi) * 4;
      return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    };
    const g: number[] = [];
    for (let cy = 0; cy < 8; cy++)
      for (let cxx = 0; cxx < 9; cxx++) {
        let s = 0;
        for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) s += lumAt(((cxx + (i + 0.5) / 6) * c.width) / 9, ((cy + (j + 0.5) / 6) * c.height) / 8);
        g.push(s / 36);
      }
    let hex = "";
    let nib = 0;
    let n = 0;
    for (let cy = 0; cy < 8; cy++)
      for (let cxx = 0; cxx < 8; cxx++) {
        nib = (nib << 1) | (g[cy * 9 + cxx] > g[cy * 9 + cxx + 1] ? 1 : 0);
        if (++n === 4) {
          hex += nib.toString(16);
          nib = 0;
          n = 0;
        }
      }
    return "rq1:" + hex;
  }, png.toString("base64"));
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || d);

async function openTarget(ctx: Ctx, p: Record<string, unknown>): Promise<Outcome> {
  ctx.vw = num(p.viewportWidth, 1280);
  ctx.vh = num(p.viewportHeight, 800);
  const url = assertSafeUrl(String(p.url || ctx.targetUrl)).toString();
  ctx.targetUrl = url;
  ctx.context = await ctx.browser.newContext({ viewport: { width: ctx.vw, height: ctx.vh }, acceptDownloads: true });
  ctx.helper = await ctx.context.newPage();
  await ctx.helper.goto("about:blank");
  ctx.page = await ctx.context.newPage();
  const res = await ctx.page.goto(url, { waitUntil: "load", timeout: 20_000 });
  return { status: res && res.status() >= 400 ? "failed" : "passed", message: `Opened ${url} (HTTP ${res?.status() ?? "n/a"}) at ${ctx.vw}×${ctx.vh}` };
}

async function action(ctx: Ctx, p: Record<string, unknown>): Promise<Outcome> {
  const page = ctx.page!;
  const act = String(p.action);
  const data = String(p.data ?? "");
  if (act === "navigate") {
    await page.goto(ctx.targetUrl, { waitUntil: "load", timeout: 20_000 });
    return { status: "passed", message: `Reloaded target for a clean case start: ${ctx.targetUrl}` };
  }
  if (act === "wait") {
    await page.waitForTimeout(Math.min(10_000, num(data, 500)));
    return { status: "passed", message: `Waited ${num(data, 500)} ms` };
  }
  if (isReviewOnlyControlType(String(p.controlType ?? ""))) return { status: "needs-review", message: `Control type ${String(p.controlType)} is review-only; no mouse/keyboard input was dispatched. Define a manual oracle or explicit interaction pattern.` };
  const r = p.region as { x: number; y: number; w: number; h: number } | null;
  if (!r) return { status: "skipped", message: "No visual anchor is bound to this step, so it was NOT executed. Scan the screen and bind a control." };
  if (data.startsWith("<FIXTURE")) return { status: "needs-review", message: "Step data is a credential placeholder; RASQ-Ai does not type secrets. Supply from your vault." };

  const sx = ctx.vw / num(p.sourceWidth, ctx.vw);
  const sy = ctx.vh / num(p.sourceHeight, ctx.vh);
  const x = Math.max(0, Math.min(ctx.vw - 2, r.x * sx));
  const y = Math.max(0, Math.min(ctx.vh - 2, r.y * sy));
  const box = { x, y, width: Math.max(2, Math.min(ctx.vw - x, r.w * sx)), height: Math.max(2, Math.min(ctx.vh - y, r.h * sy)) };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const evidence: Record<string, unknown> = { box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } };

  const beforePng = await page.screenshot({ clip: box, type: "png" });
  let warn = "";
  const lh = String(p.locatorHash ?? "");
  if (lh) {
    const score = hashSimilarity(lh, await hashPng(ctx.helper!, beforePng));
    evidence.anchorScore = Number(score.toFixed(3));
    const thr = num(p.anchorThreshold, 0.55);
    if (score < thr) {
      if (p.strict) return { status: "failed", message: `Visual anchor mismatch: similarity ${score.toFixed(2)} < ${thr}. Action not performed.`, evidence };
      warn = ` Anchor similarity ${score.toFixed(2)} is below ${thr}; proceeded because strict mode is off.`;
    }
  }
  let msg = "";
  let status: RunStatus = "passed";
  switch (act) {
    case "hold": {
      const durationMs = Math.min(10_000, Math.max(100, num(data, 1000)));
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      try {
        await page.waitForTimeout(durationMs);
      } finally {
        await page.mouse.up();
      }
      evidence.holdMs = durationMs;
      msg = `Pressed and held the visual anchor for ${durationMs} ms, then released the left button.`;
      break;
    }
    case "hover": {
      const durationMs = Math.min(10_000, Math.max(100, num(data, 1000)));
      await page.mouse.move(cx, cy);
      await page.waitForTimeout(durationMs);
      evidence.hoverMs = durationMs;
      msg = `Hovered the visual anchor for ${durationMs} ms without clicking.`;
      break;
    }
    case "type": {
      await page.mouse.click(cx, cy);
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type(data, { delay: 8 });
      msg = `Typed ${data.length} synthetic characters at the anchor.`;
      break;
    }
    case "select": {
      await page.mouse.click(cx, cy);
      if (data && data !== "first option") await page.keyboard.type(data);
      else await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      msg = `Selected option "${data || "next"}" via keyboard after focusing the anchor.`;
      break;
    }
    case "slider": {
      const f = Math.max(0, Math.min(1, num(data, 50) / 100));
      await page.mouse.click(box.x + box.width * f, cy);
      msg = `Clicked slider at ${Math.round(f * 100)}% of its track.`;
      break;
    }
    case "upload": {
      try {
        const buf = Buffer.from("RASQ-Ai synthetic upload fixture\n");
        const [fc] = await Promise.all([page.waitForEvent("filechooser", { timeout: 4000 }), page.mouse.click(cx, cy)]);
        await fc.setFiles({ name: data || "rasq-fixture.txt", mimeType: "text/plain", buffer: buf });
        evidence.upload = { name: data || "rasq-fixture.txt", bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
        msg = "File chooser opened and a synthetic fixture was attached.";
      } catch {
        return { status: "failed", message: "No file chooser opened after clicking the anchor." + warn, evidence };
      }
      break;
    }
    case "download": {
      try {
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 6000 }), page.mouse.click(cx, cy)]);
        const h = createHash("sha256");
        let bytes = 0;
        const s = await dl.createReadStream();
        for await (const chunk of s) {
          h.update(chunk as Buffer);
          bytes += (chunk as Buffer).length;
        }
        const sha = h.digest("hex");
        evidence.download = { file: dl.suggestedFilename(), bytes, sha256: sha };
        if (/^[a-f0-9]{64}$/i.test(data)) {
          status = sha === data.toLowerCase() ? "passed" : "failed";
          msg = status === "passed" ? "Download SHA-256 matches the supplied manifest." : `Download SHA-256 ${sha} differs from manifest ${data}.`;
        } else msg = `Download received (${bytes} bytes). SHA-256 ${sha.slice(0, 16)}… recorded; no manifest supplied, so integrity was not verified.`;
      } catch {
        return { status: "failed", message: "No download started after clicking the anchor." + warn, evidence };
      }
      break;
    }
    default: {
      await page.mouse.click(cx, cy);
      msg = `Click dispatched at the visual anchor centre (${Math.round(cx)}, ${Math.round(cy)}).`;
    }
  }
  if (["check", "uncheck", "toggle", "slider"].includes(act)) {
    await page.waitForTimeout(150);
    const afterPng = await page.screenshot({ clip: box, type: "png" });
    const changed = !beforePng.equals(afterPng);
    evidence.regionChanged = changed;
    if (!changed) status = "warning";
    msg += changed ? " Region pixels changed (state change observed; exact on/off state is not provable from pixels)." : " Region pixels did NOT change; state change not observed.";
  }
  return { status, message: msg + warn, evidence };
}

async function assertNode(ctx: Ctx, p: Record<string, unknown>): Promise<Outcome> {
  const page = ctx.page!;
  const kind = String(p.kind);
  const value = String(p.value ?? "");
  const expected = String(p.expected ?? "");
  const max = typeof p.maxDurationMs === "number" ? p.maxDurationMs : null;
  if (kind === "screenshotChanged") {
    // Poll for a visual transition; when a time limit is defined, it is measured from the triggering action.
    const limit = max ?? 1500;
    for (;;) {
      const now = await page.screenshot({ type: "png" });
      const elapsed = Date.now() - ctx.actionStart;
      if (ctx.before && !ctx.before.equals(now)) {
        if (max !== null && elapsed > max) return { status: "failed", message: `A visual transition appeared after ${elapsed} ms, exceeding the ${max} ms limit.`, evidence: { elapsedMs: elapsed } };
        return { status: "passed", message: `Visual transition observed ${elapsed} ms after the action${max !== null ? ` (limit ${max} ms)` : ""}. Only pixel change was verified, not the exact content. Expected: ${expected}`, evidence: { elapsedMs: elapsed } };
      }
      if (elapsed > limit) return { status: "failed", message: `No visual transition within ${limit} ms of the action.`, evidence: { elapsedMs: elapsed } };
      await page.waitForTimeout(100);
    }
  }
  await page.waitForTimeout(300);
  if (max !== null && ctx.lastMs > max) return { status: "failed", message: `Previous action took ${ctx.lastMs} ms, exceeding the ${max} ms limit.` };
  if (kind === "urlContains") {
    const ok = page.url().includes(value);
    return { status: ok ? "passed" : "failed", message: ok ? `URL contains "${value}"` : `URL ${page.url()} does not contain "${value}"` };
  }
  if (kind === "textVisible") {
    try {
      await page.getByText(value).first().waitFor({ state: "visible", timeout: 3000 });
      return { status: "passed", message: `Supplied text "${value}" is visible.` };
    } catch {
      return { status: "failed", message: `Supplied text "${value}" was not visible within 3 s.` };
    }
  }
  return { status: "needs-review", message: `No automatable oracle was defined. A human must verify: ${expected || "(no expectation recorded)"}` };
}

async function step(ctx: Ctx, n: N8nNode): Promise<Outcome> {
  if (n.type === NT.trigger) return { status: "passed", message: "Run started." };
  if (n.type === NT.section) return { status: "passed", message: "Test case section." };
  if (n.type === NT.open) return openTarget(ctx, n.parameters);
  if (!ctx.page) return { status: "error", message: "No page is open; the workflow needs an Open Target node first." };
  if (n.type === NT.action) return action(ctx, n.parameters);
  if (n.type === NT.assert) return assertNode(ctx, n.parameters);
  return { status: "skipped", message: `Unsupported node type "${n.type}" was not executed by the RASQ-Ai runner.` };
}

const rank: RunStatus[] = ["error", "failed", "needs-review", "warning", "passed", "skipped"];

export async function startRun(workflowId: string, mode: "playwright" | "dry-run", targetUrl: string): Promise<string> {
  const db = await getDb();
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  if (!wf) throw new Error("Workflow not found");
  const order = executionOrder(wf.n8n as unknown as N8nWorkflow);
  if (order.length === 0) throw new Error("Workflow has no nodes");
  if (mode === "playwright" && targetUrl) assertSafeUrl(targetUrl);
  const [run] = await db.insert(runs).values({ workflowId, mode, targetUrl, status: "running" }).returning();
  await db.insert(runSteps).values(order.map((n, i) => ({ runId: run.id, position: i, nodeId: n.id, nodeName: n.name, nodeType: n.type, status: "pending" })));
  void executeRun(run.id, order, targetUrl, mode).catch(() => undefined);
  return run.id;
}

async function executeRun(runId: string, order: N8nNode[], targetUrl: string, mode: string) {
  const db = await getDb();
  const dir = path.join(DATA_DIR, "runs", runId);
  fs.mkdirSync(dir, { recursive: true });
  const statuses: RunStatus[] = [];
  let fatal: string | null = null;
  let ctx: Ctx | null = null;
  const rows = await db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.position));
  const update = (pos: number, o: Outcome, ms: number) => db.update(runSteps).set({ status: o.status, message: o.message.slice(0, 1000), durationMs: ms, evidence: o.evidence ?? {} }).where(eq(runSteps.id, rows[pos].id));

  try {
    if (mode === "dry-run") {
      for (let i = 0; i < order.length; i++) {
        const n = order[i];
        const p = n.parameters;
        const unbound = n.type === NT.action && p.anchorStatus === "unresolved";
        const o: Outcome = unbound
          ? { status: "warning", message: "Dry run: this step has no visual anchor and would be skipped at execution." }
          : { status: "skipped", message: "Dry run: structure validated only. Nothing was executed or observed." };
        statuses.push(o.status);
        await update(i, o, 0);
      }
    } else {
      const browser = await launch();
      ctx = { browser, vw: 1280, vh: 800, targetUrl: resolveUrl(targetUrl), actionStart: 0, lastMs: 0 };
      for (let i = 0; i < order.length; i++) {
        const n = order[i];
        await db.update(runSteps).set({ status: "running" }).where(eq(runSteps.id, rows[i].id));
        const t0 = Date.now();
        let o: Outcome;
        try {
          if (ctx.page && n.type !== NT.assert && n.type !== NT.section) {
            ctx.before = await ctx.page.screenshot({ type: "png" });
            ctx.actionStart = Date.now();
          }
          o = await step(ctx, n);
        } catch (e) {
          o = { status: "error", message: (e instanceof Error ? e.message : String(e)).split("\n")[0] };
        }
        const ms = Date.now() - t0;
        if (n.type === NT.action) ctx.lastMs = ms;
        if (ctx.page && n.type !== NT.section && n.type !== NT.trigger) {
          try {
            const jpg = await ctx.page.screenshot({ type: "jpeg", quality: 45 });
            fs.writeFileSync(path.join(dir, `${i}.jpg`), jpg);
            o.evidence = { ...(o.evidence ?? {}), shot: `${i}.jpg` };
          } catch {
            /* page may be closed */
          }
        }
        statuses.push(o.status);
        await update(i, o, ms);
      }
    }
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e);
    await db.update(runSteps).set({ status: "skipped", message: "Not executed because the run aborted." }).where(and(eq(runSteps.runId, runId), eq(runSteps.status, "pending")));
  } finally {
    await ctx?.browser.close().catch(() => undefined);
  }
  const summary: Record<string, number> = {};
  for (const s of statuses) summary[s] = (summary[s] ?? 0) + 1;
  const status: RunStatus = fatal ? "error" : rank.find((r) => statuses.includes(r)) ?? "skipped";
  await db.update(runs).set({ status, error: fatal, summary, finishedAt: new Date() }).where(eq(runs.id, runId));
  try {
    const finished = await loadRunForEvent(db, runId);
    if (finished) notifyWebhooks(db, "run.completed", runCompletedData(finished));
  } catch (e) {
    console.warn("run.completed webhook notification failed:", e instanceof Error ? e.message : e);
  }
}

/** In-process runs are not durable; a process restart can strand them. Mark playwright/dry-run rows that have been pending/running far beyond any plausible browser job as error so agents see honest terminal states. */
export const STALE_RUN_MS = 30 * 60_000;
export async function failStaleRuns(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  const stale = await db.select({ id: runs.id }).from(runs).where(and(inArray(runs.executor, ["playwright"]), inArray(runs.status, ["pending", "running"]), lt(runs.startedAt, cutoff)));
  if (!stale.length) return 0;
  await db.update(runs).set({ status: "error", error: "Run interrupted or exceeded the server deadline.", finishedAt: new Date() }).where(and(inArray(runs.id, stale.map((r) => r.id)), inArray(runs.status, ["pending", "running"])));
  for (const { id } of stale) {
    try {
      const finished = await loadRunForEvent(db, id);
      if (finished) notifyWebhooks(db, "run.completed", runCompletedData(finished));
    } catch (e) {
      console.warn("stale-run webhook notification failed:", e instanceof Error ? e.message : e);
    }
  }
  return stale.length;
}
