/**
 * RASQ-Ai theme engine.
 *
 * Pure colour math with no DOM or React dependency, so one implementation drives the server-rendered
 * preset CSS, the client theme picker, and the unit tests that verify the contrast guarantees.
 *
 * Every theme is glassmorphic: translucent surfaces blur a tinted backdrop. Translucency means the
 * colour behind a label is not fixed, so each text colour is derived against the worst case of every
 * surface stack the UI is allowed to build (see `Paint`) rather than against one background.
 *
 * Status hues (passed, failed, warning, …) are fixed in every theme, including Custom and Random:
 * they report recorded run outcomes and are never recoloured by a user choice or a random seed.
 */

export const THEME_IDS = ["dark-purple", "light-purple", "custom", "contrast"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeMode = "dark" | "light";
export type ThemeLevel = "standard" | "high";
export type CustomColors = { accent: string; background: string };
export type ThemePref = { id: ThemeId; custom: CustomColors; seed: number };
export type ThemeVars = Record<string, string>;

export const THEME_LABELS: Record<ThemeId, string> = {
  "dark-purple": "Dark purple",
  "light-purple": "Light purple",
  custom: "Custom colors",
  contrast: "Random high contrast",
};
export const THEME_HINTS: Record<ThemeId, string> = {
  "dark-purple": "Deep violet glass",
  "light-purple": "Soft lavender glass",
  custom: "Your accent and background",
  contrast: "Shuffled palette, AAA text",
};

/** Minimum WCAG 2 contrast ratio guaranteed for every text token: AA for standard themes, AAA for high contrast. */
export const MIN_TEXT_CONTRAST: Record<ThemeLevel, number> = { standard: 4.5, high: 7 };
/** Minimum contrast of solid fills and control borders against adjacent surfaces in the high-contrast theme (WCAG 1.4.11). */
export const MIN_UI_CONTRAST = 3;

export const STATUS_KEYS = ["ok", "danger", "warn", "info", "review", "orange"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];
/** Statuses that are also used as solid fills (buttons, indicator dots). The others only tint text, badges and borders. */
export const STATUS_FILL_KEYS = ["ok", "danger", "warn"] as const satisfies readonly StatusKey[];

/* ------------------------------------------------------------------ colour primitives */

/** Gamma-encoded sRGB channels, 0–255. */
export type Rgb = readonly [number, number, number];
type Layer = { c: Rgb; a: number };
type Range = { min: number; max: number };

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function parseHex(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const toHex = (c: Rgb) => "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");

/** Normalises user input to `#rrggbb`, or returns null when it is not a hex colour. */
export const normalizeHex = (input: unknown) => {
  const c = parseHex(input);
  return c ? toHex(c) : null;
};

// sRGB → linear light through a lookup table: the surface model evaluates thousands of composites per theme.
const LINEAR = new Float64Array(257);
for (let i = 0; i <= 256; i++) {
  const s = Math.min(i, 255) / 255;
  LINEAR[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
const linear = (v: number) => {
  const x = v <= 0 ? 0 : v >= 255 ? 255 : v;
  const i = x | 0;
  return LINEAR[i] + (LINEAR[i + 1] - LINEAR[i]) * (x - i);
};
const gamma = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** WCAG 2 relative luminance. */
export const luminance = (c: Rgb) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** WCAG 2 contrast ratio between two opaque colours. */
export const contrast = (a: Rgb, b: Rgb) => ratio(luminance(a), luminance(b));

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const quant = (c: Rgb): Rgb => [Math.round(clamp(c[0], 0, 255)), Math.round(clamp(c[1], 0, 255)), Math.round(clamp(c[2], 0, 255))];
/** Source-over compositing in gamma space, as browsers do for CSS colours. */
const over = (top: Layer, base: Rgb): Rgb => mix(base, top.c, top.a);
/** A translucent layer rounded to exactly what the CSS will say, so the model and the stylesheet cannot drift. */
const layer = (c: Rgb, a: number): Layer => ({ c: quant(c), a: Math.round(clamp(a) * 1000) / 1000 });

/** The CSS `saturate()` filter matrix, which `backdrop-filter` applies to whatever is behind a glass panel. */
function saturate(c: Rgb, s: number): Rgb {
  const [r, g, b] = c;
  return [
    clamp((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b, 0, 255),
    clamp((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b, 0, 255),
    clamp((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b, 0, 255),
  ];
}

export type Oklch = { l: number; c: number; h: number };
export function toOklch(rgb: Rgb): Oklch {
  const r = linear(rgb[0]), g = linear(rgb[1]), b = linear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S];
}
/** OKLCH → sRGB. Out-of-gamut colours keep their hue and lightness and lose chroma. */
function oklch(l: number, c: number, h: number): Rgb {
  const L = clamp(l);
  const fits = (cc: number) => oklchToLinear(L, cc, h).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let chroma = Math.max(0, c);
  if (!fits(chroma)) {
    let lo = 0, hi = chroma;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  const [r, g, b] = oklchToLinear(L, chroma, h);
  return quant([gamma(clamp(r)), gamma(clamp(g)), gamma(clamp(b))]);
}

const css = (l: Layer) => (l.a >= 0.9995 ? toHex(l.c) : `rgba(${l.c[0]}, ${l.c[1]}, ${l.c[2]}, ${l.a})`);
function parseCss(value: string | undefined): Layer {
  const hex = parseHex(value);
  if (hex) return { c: hex, a: 1 };
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec((value ?? "").trim());
  if (!m) throw new Error(`Unreadable theme colour: ${String(value)}`);
  return { c: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
}

/* ------------------------------------------------------------------ surface model */

/**
 * Everything that can end up behind a label.
 *
 * The UI builds surfaces by stacking translucent fills on a base. This is the contract the pages follow,
 * and the contrast guarantee covers exactly these stacks:
 *
 * - Bases: the page backdrop, a glass panel (`rq-glass`) over the backdrop, the opaque surface, and the
 *   floating popover and sticky surfaces, which may cover anything. Glass panels are not nested.
 * - Area fills, for rows, boxes, notices and tracks: `tint-1`, `tint-2`, `well`, `field`, `accent-soft`
 *   and the status `*-soft` colours. One area fill may sit on a base.
 * - Item fills, for controls and chips: `raised`, `raised-hover`, `field`, `tint-2`, `accent-soft` and
 *   the status `*-soft` colours. One item fill may sit on a base or on an area fill.
 * - An item may also sit in a `field` box inside a `tint-1` row (the expanded table row).
 *
 * `ink`, `accent-ink` and the status inks are guaranteed on all of these. `muted` and `faint` are
 * guaranteed on the quiet subset: no status tint anywhere in the stack and no `accent-soft` item.
 * Secondary text therefore never goes inside badges, notices or status-tinted rows.
 */
type Paint = {
  canvas: Rgb;
  glows: Layer[];
  saturate: number;
  surface: Layer;
  sheen: Layer;
  opaque: Rgb;
  popover: Layer;
  sticky: Layer;
  tint1: Layer;
  tint2: Layer;
  well: Layer;
  field: Layer;
  raised: Layer;
  raisedHover: Layer;
  accentSoft: Layer;
  statusSoft: Layer[];
};
type Surfaces = { all: Range; quiet: Range; controls: Rgb[] };

/** The darkest value of each channel across some colours: a floor for the luminance of any blend of them. */
const channelFloor = (cs: Rgb[]): Rgb => [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.min(...cs.map((c) => c[2]))];

function surfacesOf(p: Paint): Surfaces {
  // The aurora glows never overlap (their geometry in globals.css is unit-tested), so every point of the backdrop
  // is the canvas, a glow at its peak, or something between the two. Blurring and partial glows only blend these
  // colours. A blend is never brighter than its brightest part, but two different hues can blend to something
  // slightly darker than either, so the per-channel minimum stands in for the darkest possible blend.
  const peaks: Rgb[] = [p.canvas, ...p.glows.map((g) => over(g, p.canvas))];
  const panes = peaks.map((b) => over(p.surface, saturate(b, p.saturate)));
  const pages = [...peaks, channelFloor(peaks)];
  const glass = [...panes, channelFloor(panes)];
  const bases: Rgb[] = [...pages, ...glass, ...glass.map((g) => over(p.sheen, g))];
  // Without backdrop-filter support, or with reduced transparency requested, glass falls back to the opaque surface.
  bases.push(p.opaque, over(p.sheen, p.opaque));
  // Floating panels can cover arbitrary content, including screenshots: assume pure black or white beneath.
  for (const under of [BLACK, WHITE]) bases.push(over(p.popover, under), over(p.sticky, under));

  const quietAreas = [p.tint1, p.tint2, p.well, p.field, p.accentSoft];
  const quietItems = [p.field, p.tint2, p.raised, p.raisedHover];
  const loudItems = [p.accentSoft, ...p.statusSoft];
  const all: Range = { min: Infinity, max: -Infinity };
  const quiet: Range = { min: Infinity, max: -Infinity };
  const see = (c: Rgb, isQuiet: boolean) => {
    const l = luminance(c);
    if (l < all.min) all.min = l;
    if (l > all.max) all.max = l;
    if (isQuiet) {
      if (l < quiet.min) quiet.min = l;
      if (l > quiet.max) quiet.max = l;
    }
  };
  // Bordered controls sit on a base or on an area fill.
  const controls: Rgb[] = [];
  const stack = (under: Rgb, isQuiet: boolean) => {
    see(under, isQuiet);
    for (const item of quietItems) see(over(item, under), isQuiet);
    for (const item of loudItems) see(over(item, under), false);
  };
  for (const base of bases) {
    controls.push(base);
    stack(base, true);
    for (const area of quietAreas) {
      const row = over(area, base);
      controls.push(row);
      stack(row, true);
    }
    for (const area of p.statusSoft) {
      const row = over(area, base);
      controls.push(row);
      stack(row, false);
    }
    stack(over(p.field, over(p.tint1, base)), true);
  }
  return { all, quiet, controls };
}

/** Lowest contrast of a colour against any background whose luminance lies in the range. */
function worst(c: Rgb, r: Range): number {
  const l = luminance(c);
  return l >= r.max ? ratio(l, r.max) : l <= r.min ? ratio(l, r.min) : 1;
}

/** Lowest contrast between a translucent border and the surface it is drawn on. */
const borderContrast = (border: Layer, s: Surfaces) => s.controls.reduce((m, c) => Math.min(m, contrast(over(border, c), c)), Infinity);

/* ------------------------------------------------------------------ theme construction */

export type ThemeSpec = {
  background: string;
  accent: string;
  level?: ThemeLevel;
  /** Three aurora colours. Derived from the accent hue when omitted. */
  glows?: readonly [string, string, string];
};
export type ThemeAudit = {
  /** Lowest contrast of any text token on any surface it may be used on (see `Paint`). */
  text: number;
  /** Lowest contrast of a label on its own solid fill (accent and status buttons, including hover). */
  onFill: number;
  /** Lowest contrast of a solid fill against any surface it can sit on. */
  fill: number;
  /** Lowest contrast of a control border against the surface it is drawn on. */
  border: number;
  tokens: Record<string, number>;
};
export type BuiltTheme = {
  mode: ThemeMode;
  level: ThemeLevel;
  vars: ThemeVars;
  audit: ThemeAudit;
  /** Share of the designed aurora strength that survived the contrast fit, 0–1. */
  glow: number;
  preview: { background: string; accent: string; text: string };
};

const FALLBACK_BACKGROUND: Rgb = [14, 10, 31];
const FALLBACK_ACCENT: Rgb = [124, 58, 237];

/** Fixed status hues per mode: bright fills with dark labels on dark themes, deep fills with light labels on light themes. */
const STATUS_BASE: Record<StatusKey, { dark: string; light: string }> = {
  ok: { dark: "#34d399", light: "#047857" },
  danger: { dark: "#fb7185", light: "#be123c" },
  warn: { dark: "#fbbf24", light: "#f59e0b" },
  info: { dark: "#38bdf8", light: "#0369a1" },
  review: { dark: "#c084fc", light: "#7e22ce" },
  orange: { dark: "#fb923c", light: "#c2410c" },
};
export const statusBase = (key: StatusKey, mode: ThemeMode) => STATUS_BASE[key][mode];

const hex = (v: string) => parseHex(v) as Rgb;

/** Shifts lightness toward the text pole, keeping hue, until `ok` holds. Ends at pure white or black. */
function tone(base: Rgb, dark: boolean, ok: (c: Rgb) => boolean): Rgb {
  const o = toOklch(base);
  for (let i = 0; i <= 120; i++) {
    const l = o.l + (dark ? 0.01 : -0.01) * i;
    if (l > 1 || l < 0) break;
    const c = i === 0 ? quant(base) : oklch(l, o.c, o.h);
    if (ok(c)) return c;
  }
  return dark ? WHITE : BLACK;
}

/** The dimmest blend of `text` toward `toward` that still satisfies `ok`. */
function dim(text: Rgb, toward: Rgb, ok: (c: Rgb) => boolean): Rgb {
  for (let t = 0.7; t > 0.001; t -= 0.02) {
    const c = quant(mix(text, toward, t));
    if (ok(c)) return c;
  }
  return text;
}

/** A label colour for a solid fill: white when readable enough, otherwise a dark ink of the fill hue, otherwise black. */
function labelFor(fill: Rgb, need: number): Rgb | null {
  const o = toOklch(fill);
  for (const c of [WHITE, oklch(0.2, Math.min(o.c, 0.06), o.h), BLACK]) if (contrast(c, fill) >= need) return c;
  return null;
}

/** Keeps a fill as chosen when possible; otherwise moves its lightness toward the text pole until label and edge contrast hold. */
function fitFill(base: Rgb, dark: boolean, need: number, edge: { range: Range; min: number } | null): { fill: Rgb; on: Rgb; hover: Rgb } {
  const o = toOklch(base);
  let found: { fill: Rgb; on: Rgb } = dark ? { fill: WHITE, on: BLACK } : { fill: BLACK, on: WHITE };
  for (let i = 0; i <= 120; i++) {
    const l = o.l + (dark ? 0.01 : -0.01) * i;
    if (l > 1 || l < 0) break;
    const fill = i === 0 ? quant(base) : oklch(l, o.c, o.h);
    const on = labelFor(fill, need);
    if (on && (!edge || worst(fill, edge.range) >= edge.min)) {
      found = { fill, on };
      break;
    }
  }
  // Hover moves the fill away from its label, so hovering can only raise the label contrast.
  return { ...found, hover: quant(mix(found.fill, luminance(found.on) > 0.5 ? BLACK : WHITE, 0.14)) };
}

export function buildTheme(spec: ThemeSpec): BuiltTheme {
  const level: ThemeLevel = spec.level === "high" ? "high" : "standard";
  const high = level === "high";
  const accent0 = quant(parseHex(spec.accent) ?? FALLBACK_ACCENT);
  let canvas = parseHex(spec.background) ?? FALLBACK_BACKGROUND;
  const dark = contrast(WHITE, canvas) >= contrast(BLACK, canvas);
  const pole = dark ? WHITE : BLACK;
  if (high) {
    // A high-contrast theme owns its background: push it away from the text pole until there is real headroom.
    const o = toOklch(canvas);
    for (let i = 0; contrast(pole, canvas) < 15 && i < 100; i++) canvas = oklch(o.l + (dark ? -0.01 : 0.01) * i, o.c, o.h);
  }
  canvas = quant(canvas);
  const hue = toOklch(accent0).h;
  const text: Rgb = high ? pole : dark ? oklch(0.965, 0.018, hue) : oklch(0.2, 0.045, hue);
  const glowColors: Rgb[] = spec.glows
    ? spec.glows.map((g) => parseHex(g) ?? accent0)
    : dark
      ? [oklch(0.56, 0.23, hue), oklch(0.58, 0.22, hue + 55), oklch(0.46, 0.2, hue - 50)]
      : [oklch(0.83, 0.11, hue), oklch(0.87, 0.1, hue + 55), oklch(0.85, 0.09, hue - 50)];
  const glowAlpha = high ? [0.3, 0.24, 0.24] : dark ? [0.5, 0.36, 0.42] : [0.8, 0.64, 0.7];
  const sat = high ? 1.25 : dark ? 1.5 : 1.7;
  // Dark glass is a tinted veil: slightly lighter than a deep canvas, darker than a bright one.
  const headroom = contrast(text, canvas);
  const veil: Rgb = dark ? (high ? mix(canvas, BLACK, 0.4) : headroom >= 12 ? mix(canvas, WHITE, 0.06) : headroom >= 9 ? canvas : mix(canvas, BLACK, 0.3)) : WHITE;
  const statusBases = STATUS_KEYS.map((k) => hex(STATUS_BASE[k][dark ? "dark" : "light"]));

  // Tints are bounded in lightness: they should shift the hue of a surface, not move it toward the text colour.
  const soften = (c: Rgb) => {
    const o = toOklch(c);
    return oklch(dark ? Math.min(o.l, high ? 0.5 : 0.6) : Math.max(o.l, 0.66), o.c, o.h);
  };

  // `glow` scales the aurora, `fill` scales every fill that moves a surface toward the text colour.
  const paint = (ink: Rgb, glow: number, fill: number): Paint => {
    const surface = layer(veil, dark ? (high ? 0.74 : 0.5) : high ? 0.86 : 0.58);
    const opaque = quant(over(surface, canvas));
    const tint1 = layer(ink, 0.05 * fill);
    const tint2 = layer(ink, 0.09 * fill);
    const well = dark ? layer(BLACK, 0.24) : layer(ink, 0.07 * fill);
    const field = dark ? layer(BLACK, 0.3) : layer(WHITE, 0.7);
    // Raised chips are mostly opaque, so what they show depends little on the row they sit in.
    const raised = dark ? layer(mix(opaque, WHITE, 0.09 * fill), 0.72) : layer(WHITE, 0.8);
    const raisedHover = dark ? layer(mix(opaque, WHITE, 0.16 * fill), 0.78) : layer(mix(WHITE, ink, 0.07 * fill), 0.92);
    const accentSoft = layer(soften(accent0), (dark ? 0.22 : 0.14) * fill);
    const statusSoft = statusBases.map((c) => layer(soften(c), (dark ? 0.19 : 0.15) * fill));
    return {
      canvas, saturate: sat, surface, opaque, tint1, tint2, well, field, raised, raisedHover, accentSoft, statusSoft,
      glows: glowColors.map((g, i) => layer(g, glowAlpha[i] * glow)),
      sheen: dark ? layer(WHITE, (high ? 0.03 : 0.05) * fill) : layer(WHITE, high ? 0.1 : 0.3),
      popover: layer(dark ? mix(opaque, WHITE, high ? 0 : 0.03) : opaque, high ? 0.985 : 0.94),
      sticky: layer(opaque, high ? 0.985 : 0.96),
    };
  };

  // Fade the aurora, then the fills, until text has headroom: body text on every stack, secondary text on quiet ones.
  // The high-contrast target also leaves room for status text that is still visibly green, red or amber at 7:1.
  const want = high ? { all: dark ? 12 : 14, quiet: dark ? 12 : 14 } : { all: 5.6, quiet: 7 };
  const must = high ? want.all : MIN_TEXT_CONTRAST[level] * 1.02;
  const glowFloor = high ? 0.25 : 0.45;
  let glow = 1, fill = 1;
  let p = paint(text, glow, fill);
  let s = surfacesOf(p);
  for (let i = 0; i < 80; i++) {
    const got = worst(text, s.all);
    if (got >= want.all && worst(text, s.quiet) >= want.quiet) break;
    if (glow > glowFloor) glow = Math.max(glowFloor, glow * 0.9);
    else if (got >= must) break;
    else {
      glow *= 0.9;
      fill *= 0.9;
      if (fill < 0.08) glow = fill = 0;
    }
    p = paint(text, glow, fill);
    s = surfacesOf(p);
    if (fill === 0) break;
  }
  let ink = text;
  if (worst(ink, s.all) < must) {
    // Nothing left to fade: a mid-tone background only leaves room for pure black or white text.
    ink = pole;
    p = paint(ink, glow, fill);
    s = surfacesOf(p);
  }

  const safety = 1.03;
  const floor = MIN_TEXT_CONTRAST[level] * safety;
  // Targets are capped by what the body text itself reaches, so a degenerate palette degrades to one text colour.
  const onAll = (min: number) => (c: Rgb) => worst(c, s.all) >= Math.min(min, worst(ink, s.all));
  const onQuiet = (min: number) => (c: Rgb) => worst(c, s.quiet) >= Math.min(min, worst(ink, s.quiet));
  const faint = dim(ink, p.opaque, onQuiet(floor));
  const muted = dim(ink, p.opaque, onQuiet(Math.sqrt(worst(ink, s.quiet) * floor)));
  const accentInk = tone(accent0, dark, onAll(floor));
  // Graphic tones keep a hue but hold 3:1 on every surface: selection borders, focus rings, status outlines.
  const graphic = (c: Rgb) => tone(c, dark, onAll(MIN_UI_CONTRAST * safety));
  const accentMark = graphic(accent0);
  const line = layer(ink, high ? 0.42 : dark ? 0.13 : 0.12);
  // The high-contrast theme guarantees a visible control border on every surface, not just on cards.
  let lineStrong = layer(ink, high ? 0.7 : dark ? 0.24 : 0.22);
  if (high) while (lineStrong.a < 1 && borderContrast(lineStrong, s) < MIN_UI_CONTRAST * safety) lineStrong = layer(ink, lineStrong.a + 0.02);

  const fillEdge = high ? { range: s.all, min: MIN_UI_CONTRAST * safety } : null;
  const accent = fitFill(accent0, dark, floor, fillEdge);
  const status = STATUS_KEYS.map((k, i) => {
    const inkColor = tone(statusBases[i], dark, onAll(floor));
    return { k, ...fitFill(statusBases[i], dark, floor, fillEdge), ink: inkColor, soft: p.statusSoft[i], line: layer(graphic(statusBases[i]), high ? 1 : 0.5) };
  });

  const shadowTint = dark ? BLACK : quant(mix(oklch(0.3, 0.12, hue), BLACK, 0.2));
  const vars: ThemeVars = {
    "--rq-scheme": dark ? "dark" : "light",
    "--rq-canvas": toHex(p.canvas),
    "--rq-glow-1": css(p.glows[0]),
    "--rq-glow-2": css(p.glows[1]),
    "--rq-glow-3": css(p.glows[2]),
    "--rq-surface": css(p.surface),
    "--rq-sheen": css(p.sheen),
    "--rq-edge": css(high ? layer(ink, 0.6) : dark ? layer(WHITE, 0.12) : layer(WHITE, 0.85)),
    "--rq-opaque": toHex(p.opaque),
    "--rq-popover": css(p.popover),
    "--rq-sticky": css(p.sticky),
    "--rq-raised": css(p.raised),
    "--rq-raised-hover": css(p.raisedHover),
    "--rq-field": css(p.field),
    "--rq-well": css(p.well),
    "--rq-tint-1": css(p.tint1),
    "--rq-tint-2": css(p.tint2),
    "--rq-line": css(line),
    "--rq-line-strong": css(lineStrong),
    "--rq-ink": toHex(ink),
    "--rq-muted": toHex(muted),
    "--rq-faint": toHex(faint),
    "--rq-accent": toHex(accent.fill),
    "--rq-accent-hover": toHex(accent.hover),
    "--rq-on-accent": toHex(accent.on),
    "--rq-accent-ink": toHex(accentInk),
    "--rq-accent-soft": css(p.accentSoft),
    "--rq-accent-line": css(layer(accentMark, high ? 1 : 0.7)),
    "--rq-focus": toHex(accentMark),
  };
  for (const st of status) {
    if ((STATUS_FILL_KEYS as readonly string[]).includes(st.k)) {
      vars[`--rq-${st.k}`] = toHex(st.fill);
      vars[`--rq-${st.k}-hover`] = toHex(st.hover);
      vars[`--rq-on-${st.k}`] = toHex(st.on);
    }
    vars[`--rq-${st.k}-ink`] = toHex(st.ink);
    vars[`--rq-${st.k}-soft`] = css(st.soft);
    vars[`--rq-${st.k}-line`] = css(st.line);
  }
  vars["--rq-shadow"] = `0 18px 40px -20px rgba(${shadowTint[0]}, ${shadowTint[1]}, ${shadowTint[2]}, ${dark ? 0.75 : 0.38})`;
  vars["--rq-blur"] = high ? "14px" : "18px";
  vars["--rq-saturate"] = String(sat);
  return { mode: dark ? "dark" : "light", level, vars, audit: auditTheme(vars), glow, preview: { background: toHex(p.canvas), accent: toHex(accent.fill), text: toHex(ink) } };
}

/**
 * Recomputes every contrast figure from the emitted CSS values alone, independently of how they were
 * derived. The unit tests assert these against the WCAG thresholds and the theme picker shows the text figure.
 */
export function auditTheme(vars: ThemeVars): ThemeAudit {
  const L = (name: string) => parseCss(vars[`--rq-${name}`]);
  const C = (name: string) => L(name).c;
  const s = surfacesOf({
    canvas: C("canvas"), glows: [L("glow-1"), L("glow-2"), L("glow-3")], saturate: Number(vars["--rq-saturate"]),
    surface: L("surface"), sheen: L("sheen"), opaque: C("opaque"), popover: L("popover"), sticky: L("sticky"),
    tint1: L("tint-1"), tint2: L("tint-2"), well: L("well"), field: L("field"), raised: L("raised"), raisedHover: L("raised-hover"),
    accentSoft: L("accent-soft"), statusSoft: STATUS_KEYS.map((k) => L(`${k}-soft`)),
  });
  const tokens: Record<string, number> = {};
  const text = [
    ...["ink", "accent-ink", ...STATUS_KEYS.map((k) => `${k}-ink`)].map((k) => (tokens[k] = worst(C(k), s.all))),
    ...["muted", "faint"].map((k) => (tokens[k] = worst(C(k), s.quiet))),
  ];
  const onFill: number[] = [];
  const fill: number[] = [];
  for (const k of ["accent", ...STATUS_FILL_KEYS]) {
    onFill.push((tokens[`on-${k}`] = contrast(C(`on-${k}`), C(k))), (tokens[`on-${k}:hover`] = contrast(C(`on-${k}`), C(`${k}-hover`))));
    fill.push((tokens[`${k}:fill`] = worst(C(k), s.all)));
  }
  return { text: Math.min(...text), onFill: Math.min(...onFill), fill: Math.min(...fill), border: borderContrast(L("line-strong"), s), tokens };
}

/* ------------------------------------------------------------------ the four themes */

export const PRESET_SPECS = {
  "dark-purple": { background: "#0e0a1f", accent: "#7c3aed", glows: ["#7c3aed", "#c026d3", "#4338ca"] },
  "light-purple": { background: "#f1ecff", accent: "#7c3aed", glows: ["#c4b5fd", "#f0abfc", "#a5b4fc"] },
} as const satisfies Record<string, ThemeSpec>;

export const DEFAULT_THEME_ID: ThemeId = "dark-purple";
export const DEFAULT_CUSTOM: CustomColors = { accent: "#2dd4bf", background: "#071a1f" };
export const DEFAULT_PREF: ThemePref = { id: DEFAULT_THEME_ID, custom: DEFAULT_CUSTOM, seed: 0 };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic random high-contrast palette: the same seed always yields the same colours. */
export function contrastSpec(seed: number): ThemeSpec {
  const rnd = mulberry32(seed);
  const hue = rnd() * 360;
  const dark = rnd() < 0.5;
  const second = hue + [120, 150, 180, 210, 240][Math.floor(rnd() * 5)];
  const third = hue + (rnd() < 0.5 ? -45 : 45);
  const canvasHue = rnd() < 0.5 ? hue : second;
  const a = rnd(), b = rnd();
  return dark
    ? { level: "high", background: toHex(oklch(0.13 + a * 0.04, 0.025 + b * 0.03, canvasHue)), accent: toHex(oklch(0.82 + a * 0.06, 0.22, hue)), glows: [toHex(oklch(0.62, 0.25, hue)), toHex(oklch(0.6, 0.25, second)), toHex(oklch(0.52, 0.22, third))] }
    : { level: "high", background: toHex(oklch(0.97 + a * 0.015, 0.01 + b * 0.015, canvasHue)), accent: toHex(oklch(0.4 + a * 0.06, 0.24, hue)), glows: [toHex(oklch(0.8, 0.15, hue)), toHex(oklch(0.82, 0.14, second)), toHex(oklch(0.84, 0.12, third))] };
}

/** A fresh non-zero 32-bit seed. Zero is reserved for "not shuffled yet". */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 4294967296);
  return buf[0] || 1;
}

export function specFor(pref: ThemePref): ThemeSpec {
  if (pref.id === "custom") return { background: pref.custom.background, accent: pref.custom.accent };
  if (pref.id === "contrast") return contrastSpec(pref.seed);
  return PRESET_SPECS[pref.id];
}

export const PRESET_THEMES = {
  "dark-purple": buildTheme(PRESET_SPECS["dark-purple"]),
  "light-purple": buildTheme(PRESET_SPECS["light-purple"]),
} as const;

export type ResolvedTheme = BuiltTheme & { id: ThemeId };
export const resolveTheme = (pref: ThemePref): ResolvedTheme => ({ id: pref.id, ...(pref.id === "custom" || pref.id === "contrast" ? buildTheme(specFor(pref)) : PRESET_THEMES[pref.id]) });

/** Every custom property a theme defines. The picker clears these when switching back to a preset. */
export const TOKEN_NAMES: readonly string[] = Object.keys(PRESET_THEMES["dark-purple"].vars);

/** Preset tokens as CSS. Dark purple is the default, so the shell is themed before any script runs. */
export function presetCss(): string {
  const block = (selector: string, vars: ThemeVars) => `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
  return block(":root", PRESET_THEMES["dark-purple"].vars) + block(":root[data-theme=light-purple]", PRESET_THEMES["light-purple"].vars);
}

/* ------------------------------------------------------------------ persistence */

export const THEME_STORAGE_KEY = "rasq.theme";
/** Bump when the token set changes, so a cached palette from an older release is not painted before React loads. */
export const THEME_STORAGE_VERSION = 1;

const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);

/** Reads a stored preference, tolerating missing, malformed or tampered values. */
export function parsePref(raw: string | null | undefined): ThemePref {
  if (!raw) return DEFAULT_PREF;
  try {
    const v = JSON.parse(raw) as { id?: unknown; custom?: { accent?: unknown; background?: unknown } | null; seed?: unknown } | null;
    if (!v || typeof v !== "object") return DEFAULT_PREF;
    const custom = v.custom && typeof v.custom === "object" ? v.custom : {};
    return {
      id: isThemeId(v.id) ? v.id : DEFAULT_THEME_ID,
      custom: { accent: normalizeHex(custom.accent) ?? DEFAULT_CUSTOM.accent, background: normalizeHex(custom.background) ?? DEFAULT_CUSTOM.background },
      seed: typeof v.seed === "number" && Number.isFinite(v.seed) ? Math.floor(Math.abs(v.seed)) % 4294967296 : 0,
    };
  } catch {
    return DEFAULT_PREF;
  }
}

/**
 * Serialises a preference together with its resolved tokens. The tokens are only a cache that lets
 * `THEME_INIT_SCRIPT` paint Custom and Random themes before React loads; the picker always recomputes them.
 */
export function serializePref(pref: ThemePref): string {
  const base = { v: THEME_STORAGE_VERSION, id: pref.id, custom: pref.custom, seed: pref.seed };
  return JSON.stringify(pref.id === "custom" || pref.id === "contrast" ? { ...base, vars: resolveTheme(pref).vars } : base);
}

/**
 * The only value shapes the engine emits, and therefore the only ones the pre-paint script will apply:
 * space-separated hex colours, numeric `rgba()` colours, numbers or pixel lengths, and `dark` / `light`.
 * Anything else, such as `url()`, `var()` or a keyword, is ignored.
 */
const CACHED_PART = "(?:#[0-9a-f]{6}|rgba\\([0-9., ]+\\)|-?[0-9.]+(?:px)?|dark|light)";
const CACHED_VALUE = `^${CACHED_PART}(?: ${CACHED_PART})*$`;

/**
 * Runs before first paint to apply the stored theme without a flash. It accepts only known theme IDs and
 * `--rq-*` custom properties whose values are literal colours, numbers or lengths, never throws, and leaves
 * the default theme in place on any problem.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,p=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"null");if(!p||${JSON.stringify(THEME_IDS)}.indexOf(p.id)<0)return;d.setAttribute("data-theme",p.id);if((p.id==="custom"||p.id==="contrast")&&p.v===${THEME_STORAGE_VERSION}&&p.vars&&typeof p.vars==="object")for(var k in p.vars)if(/^--rq-[a-z0-9-]+$/.test(k)&&typeof p.vars[k]==="string"&&p.vars[k].length<=120&&/${CACHED_VALUE}/i.test(p.vars[k]))d.style.setProperty(k,p.vars[k])}catch(e){}})()`;
