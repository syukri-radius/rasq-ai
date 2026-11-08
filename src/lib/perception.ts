import type { ControlType } from "./types";

/** Internal RASQ-Ai perception model label. AI provenance is stored separately. */

export type Candidate = {
  id: string;
  /** Source image coordinate system (original pixels). */
  x: number;
  y: number;
  w: number;
  h: number;
  type: ControlType | "unknown";
  confidence: number;
  evidence: string;
  hash: string;
};

export type FrameAnalysis = {
  width: number;
  height: number;
  candidates: Candidate[];
  signature: number[];
  hash: string;
  stats: { edgeThreshold: number; components: number; merged: number };
};

const WORK_MAX = 1280;
const CELL = 4;
const SIG_W = 32;
const SIG_H = 18;

type Box = { x0: number; y0: number; x1: number; y1: number };

/** 9x8 difference hash (64 bit) of a region. The same algorithm is used by the Playwright runner. */
export function dhash(lumAt: (x: number, y: number) => number, x0: number, y0: number, w: number, h: number): string {
  const g: number[] = [];
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 9; cx++) {
      let s = 0;
      for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) s += lumAt(x0 + ((cx + (i + 0.5) / 6) * w) / 9, y0 + ((cy + (j + 0.5) / 6) * h) / 8);
      g.push(s / 36);
    }
  }
  let hex = "";
  let nib = 0;
  let n = 0;
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      nib = (nib << 1) | (g[cy * 9 + cx] > g[cy * 9 + cx + 1] ? 1 : 0);
      if (++n === 4) {
        hex += nib.toString(16);
        nib = 0;
        n = 0;
      }
    }
  }
  return "rq1:" + hex;
}

export function hashSimilarity(a: string, b: string): number {
  const ha = a.replace("rq1:", "");
  const hb = b.replace("rq1:", "");
  if (ha.length !== 16 || hb.length !== 16) return 0;
  let d = 0;
  for (let i = 0; i < 16; i++) {
    let v = parseInt(ha[i], 16) ^ parseInt(hb[i], 16);
    while (v) {
      d += v & 1;
      v >>= 1;
    }
  }
  return 1 - d / 64;
}

export function signatureDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

function classify(w: number, h: number, contrast: number, bump: number): { type: ControlType | "unknown"; confidence: number; why: string } {
  const aspect = w / h;
  const geo = `${Math.round(w)}×${Math.round(h)}px, aspect ${aspect.toFixed(1)}, fill contrast ${contrast.toFixed(0)}`;
  if (w < 12 || h < 8) return { type: "unknown", confidence: 0.1, why: `Too small to classify (${geo}).` };
  if (aspect >= 0.75 && aspect <= 1.3 && w <= 34) return { type: "checkbox", confidence: 0.42, why: `Small near-square region (${geo}); geometry only, a radio or icon is possible.` };
  if (aspect >= 1.6 && aspect <= 2.6 && h >= 14 && h <= 40 && w <= 80) return { type: "toggle", confidence: 0.38, why: `Pill-shaped region (${geo}); geometry only.` };
  if (aspect >= 10 && h <= 28) return { type: "slider", confidence: 0.33, why: `Thin, long track-like region (${geo}); geometry only.` };
  if (w >= 150 && h >= 70 && aspect >= 0.8 && aspect <= 5 && contrast < 18) return { type: "upload", confidence: 0.28, why: `Large low-fill bordered region (${geo}); could be an ordinary container, AI review advised.` };
  if (aspect >= 2.5 && aspect <= 14 && h >= 26 && h <= 60) {
    if (bump > 1.8) return { type: "dropdown", confidence: 0.35, why: `Field-shaped region with denser right edge (chevron/icon?) (${geo}, right-edge ratio ${bump.toFixed(1)}); could be a date picker.` };
    if (contrast < 35) return { type: "input", confidence: 0.4, why: `Field-shaped outlined region (${geo}).` };
    return { type: "button", confidence: 0.42, why: `Filled wide region (${geo}).` };
  }
  if (aspect >= 1.2 && aspect <= 8 && h >= 22 && h <= 70 && contrast >= 35) return { type: "button", confidence: 0.4, why: `Filled compact region (${geo}).` };
  if (aspect >= 1.2 && aspect <= 10 && h >= 20 && h <= 64) return { type: "button", confidence: 0.25, why: `Outlined compact region (${geo}); may be a link or label.` };
  return { type: "unknown", confidence: 0.1, why: `No interactive-control geometry matched (${geo}).` };
}

export function analyze(src: CanvasImageSource, srcW: number, srcH: number): FrameAnalysis {
  const scale = Math.min(1, WORK_MAX / Math.max(srcW, srcH));
  const W = Math.max(8, Math.round(srcW * scale));
  const H = Math.max(8, Math.round(srcH * scale));
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  // 1. luminance
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = 0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2];

  // 2. Sobel gradient magnitude
  const mag = new Float32Array(W * H);
  let sum = 0;
  let sum2 = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -lum[i - W - 1] + lum[i - W + 1] - 2 * lum[i - 1] + 2 * lum[i + 1] - lum[i + W - 1] + lum[i + W + 1];
      const gy = -lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1] + lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[i] = m;
      sum += m;
      sum2 += m * m;
    }
  }
  const n = W * H;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const thr = Math.max(40, mean + std);

  // 3. density grid
  const gw = Math.ceil(W / CELL);
  const gh = Math.ceil(H / CELL);
  const dens = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mag[y * W + x] > thr) dens[Math.floor(y / CELL) * gw + Math.floor(x / CELL)]++;
  const active = new Uint8Array(gw * gh);
  for (let i = 0; i < dens.length; i++) active[i] = dens[i] / (CELL * CELL) > 0.06 ? 1 : 0;
  const dil = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      if (active[y * gw + x])
        // horizontal-only bridging: joins dashed borders and words without fusing stacked fields
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < gw) dil[y * gw + xx] = 1;
        }

  // 4. connected components (8-connectivity)
  const seen = new Uint8Array(gw * gh);
  let boxes: Box[] = [];
  let components = 0;
  for (let s = 0; s < dil.length; s++) {
    if (!dil[s] || seen[s]) continue;
    components++;
    const stack = [s];
    seen[s] = 1;
    let b: Box | null = null;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % gw;
      const cy = (c - cx) / gw;
      if (active[c]) {
        if (!b) b = { x0: cx, y0: cy, x1: cx, y1: cy };
        else {
          b.x0 = Math.min(b.x0, cx);
          b.y0 = Math.min(b.y0, cy);
          b.x1 = Math.max(b.x1, cx);
          b.y1 = Math.max(b.y1, cy);
        }
      }
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx;
          const yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const ni = yy * gw + xx;
          if (dil[ni] && !seen[ni]) {
            seen[ni] = 1;
            stack.push(ni);
          }
        }
    }
    if (b) boxes.push({ x0: b.x0 * CELL, y0: b.y0 * CELL, x1: Math.min(W, (b.x1 + 1) * CELL), y1: Math.min(H, (b.y1 + 1) * CELL) });
  }

  // 5. filter + merge overlapping candidates
  boxes = boxes.filter((b) => {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    return w >= 14 * scale && h >= 10 * scale && w * h < 0.4 * W * H && !(w > 0.92 * W && h > 0.2 * H);
  });
  let merged = 0;
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (iw <= 0 || ih <= 0) continue;
        const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
        const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
        const inter = iw * ih;
        if (inter / Math.min(areaA, areaB) > 0.8 && Math.max(areaA, areaB) / Math.min(areaA, areaB) < 2.5) {
          boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
          boxes.splice(j, 1);
          merged++;
          changed = true;
          break outer;
        }
      }
    }
  }

  const lumAt = (x: number, y: number) => lum[Math.min(H - 1, Math.max(0, Math.floor(y))) * W + Math.min(W - 1, Math.max(0, Math.floor(x)))];
  const region = (b: Box, f: (x: number, y: number) => void) => {
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) f(x, y);
  };

  // 6. classify by geometry + local contrast, then hash
  const candidates: Candidate[] = boxes
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    .slice(0, 160)
    .map((b, idx) => {
      let inner = 0;
      let cnt = 0;
      region(b, (x, y) => {
        inner += lum[y * W + x];
        cnt++;
      });
      inner /= Math.max(1, cnt);
      const ring = { x0: Math.max(0, b.x0 - 4), y0: Math.max(0, b.y0 - 4), x1: Math.min(W, b.x1 + 4), y1: Math.min(H, b.y1 + 4) };
      let outer = 0;
      let oc = 0;
      region(ring, (x, y) => {
        if (x < b.x0 || x >= b.x1 || y < b.y0 || y >= b.y1) {
          outer += lum[y * W + x];
          oc++;
        }
      });
      outer /= Math.max(1, oc);
      const w = b.x1 - b.x0;
      const rightStart = b.x0 + Math.floor(w * 0.78);
      let edgeRight = 0;
      let edgeAll = 0;
      region(b, (x, y) => {
        if (mag[y * W + x] > thr) {
          edgeAll++;
          if (x >= rightStart) edgeRight++;
        }
      });
      const bump = edgeAll > 0 ? edgeRight / edgeAll / 0.22 : 0;
      const c = classify(w / scale, (b.y1 - b.y0) / scale, Math.abs(inner - outer), bump);
      return {
        id: `c${idx + 1}`,
        x: Math.round(b.x0 / scale),
        y: Math.round(b.y0 / scale),
        w: Math.round(w / scale),
        h: Math.round((b.y1 - b.y0) / scale),
        type: c.type,
        confidence: c.confidence,
        evidence: c.why,
        hash: dhash(lumAt, b.x0, b.y0, w, b.y1 - b.y0),
      };
    });

  // frame signature for page/window grouping
  const signature: number[] = [];
  for (let sy = 0; sy < SIG_H; sy++)
    for (let sx = 0; sx < SIG_W; sx++) {
      let s = 0;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += lumAt(((sx + (i + 0.5) / 3) * W) / SIG_W, ((sy + (j + 0.5) / 3) * H) / SIG_H);
      signature.push(s / 9);
    }

  return {
    width: srcW,
    height: srcH,
    candidates,
    signature,
    hash: dhash(lumAt, 0, 0, W, H),
    stats: { edgeThreshold: Math.round(thr), components, merged },
  };
}

export type FrameRec = { dataUrl: string; width: number; height: number; tMs: number; analysis: FrameAnalysis };
export type PageGroup = { key: string; name: string; frames: number; firstMs: number; lastMs: number; rep: FrameRec; sig: number[] };

const known = (f: FrameRec) => f.analysis.candidates.filter((c) => c.type !== "unknown").length;

/** Groups frames that show the same page/window (similar luminance layout) so test objects stay together. */
export function addFrame(groups: PageGroup[], f: FrameRec, threshold = 9): PageGroup[] {
  let best = -1;
  let bd = Infinity;
  groups.forEach((g, i) => {
    if (g.rep.width !== f.width || g.rep.height !== f.height) return;
    const d = signatureDistance(g.sig, f.analysis.signature);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  if (best >= 0 && bd < threshold) {
    return groups.map((g, i) => (i === best ? { ...g, frames: g.frames + 1, lastMs: f.tMs, rep: known(f) > known(g.rep) ? f : g.rep } : g));
  }
  const n = groups.length + 1;
  return [...groups, { key: `grp-${n}`, name: `Page/window ${n}`, frames: 1, firstMs: f.tMs, lastMs: f.tMs, rep: f, sig: f.analysis.signature }];
}
