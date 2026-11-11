import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import {
  buildTheme, contrastSpec, DEFAULT_CUSTOM, DEFAULT_PREF, MIN_TEXT_CONTRAST, MIN_UI_CONTRAST, parseHex, parsePref, presetCss, PRESET_SPECS,
  PRESET_THEMES, resolveTheme, serializePref, STATUS_FILL_KEYS, STATUS_KEYS, statusBase, THEME_IDS, THEME_INIT_SCRIPT, THEME_STORAGE_VERSION,
  TOKEN_NAMES, toOklch, type BuiltTheme, type Rgb, type ThemePref, type ThemeVars,
} from "../src/lib/theme";

const AA = MIN_TEXT_CONTRAST.standard;
const AAA = MIN_TEXT_CONTRAST.high;
const globalsCss = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/* ---------------------------------------------------------------- independent contrast check */

// Separate, deliberately plain colour math: it reads the CSS strings a theme emits and rebuilds every surface
// stack the UI is allowed to compose (the contract on `Paint` in src/lib/theme.ts), then measures each text token.
type Color = number[];
function readColor(value: string): { c: Color; a: number } {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) return { c: hex.slice(1).map((h) => parseInt(h, 16)), a: 1 };
  const rgba = /^rgba\((\d+), (\d+), (\d+), (0|1|0?\.\d+)\)$/.exec(value);
  assert.ok(rgba, `unexpected colour syntax: ${value}`);
  return { c: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], a: Number(rgba[4]) };
}
const put = (top: { c: Color; a: number }, under: Color): Color => under.map((u, i) => u + (top.c[i] - u) * top.a);
const channel = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const lum = (c: Color) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
const ratio = (a: Color, b: Color) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const clamp255 = (v: number) => Math.min(255, Math.max(0, v));
const saturateFilter = ([r, g, b]: Color, s: number): Color => [
  clamp255((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
  clamp255((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
  clamp255((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
];
const darkest = (cs: Color[]): Color => [0, 1, 2].map((i) => Math.min(...cs.map((c) => c[i])));

function surfaceStacks(vars: ThemeVars): { c: Color; quiet: boolean }[] {
  const v = (name: string) => readColor(vars[`--rq-${name}`]);
  const canvas = v("canvas").c;
  const backdrop = [canvas, ...[1, 2, 3].map((i) => put(v(`glow-${i}`), canvas))];
  const panes = backdrop.map((b) => put(v("surface"), saturateFilter(b, Number(vars["--rq-saturate"]))));
  const glass = [...panes, darkest(panes)];
  const bases = [...backdrop, darkest(backdrop), ...glass, ...glass.map((g) => put(v("sheen"), g)), v("opaque").c, put(v("sheen"), v("opaque").c)];
  for (const under of [[0, 0, 0], [255, 255, 255]]) bases.push(put(v("popover"), under), put(v("sticky"), under));
  const statusSoft = STATUS_KEYS.map((k) => v(`${k}-soft`));
  const quietAreas = ["tint-1", "tint-2", "well", "field", "accent-soft"].map(v);
  const quietItems = ["field", "tint-2", "raised", "raised-hover"].map(v);
  const out: { c: Color; quiet: boolean }[] = [];
  const stack = (under: Color, quiet: boolean) => {
    out.push({ c: under, quiet });
    for (const item of quietItems) out.push({ c: put(item, under), quiet });
    for (const item of [v("accent-soft"), ...statusSoft]) out.push({ c: put(item, under), quiet: false });
  };
  for (const base of bases) {
    stack(base, true);
    for (const area of quietAreas) stack(put(area, base), true);
    for (const area of statusSoft) stack(put(area, base), false);
    stack(put(v("field"), put(v("tint-1"), base)), true);
  }
  return out;
}

/** Lowest contrast of any text token on any surface it may be used on, measured from the emitted CSS alone. */
function measuredTextContrast(vars: ThemeVars): number {
  const stacks = surfaceStacks(vars);
  const everywhere = ["ink", "accent-ink", ...STATUS_KEYS.map((k) => `${k}-ink`)];
  const quietOnly = ["muted", "faint"];
  let min = Infinity;
  for (const token of [...everywhere, ...quietOnly]) {
    const c = readColor(vars[`--rq-${token}`]);
    assert.equal(c.a, 1, `${token} must be opaque`);
    for (const s of stacks) if (s.quiet || everywhere.includes(token)) min = Math.min(min, ratio(c.c, s.c));
  }
  return min;
}

function measuredLabelContrast(vars: ThemeVars): number {
  let min = Infinity;
  for (const k of ["accent", ...STATUS_FILL_KEYS]) {
    const on = readColor(vars[`--rq-on-${k}`]).c;
    min = Math.min(min, ratio(on, readColor(vars[`--rq-${k}`]).c), ratio(on, readColor(vars[`--rq-${k}-hover`]).c));
  }
  return min;
}

function assertReadable(theme: BuiltTheme, label: string) {
  const need = MIN_TEXT_CONTRAST[theme.level];
  assert.ok(theme.audit.text >= need, `${label}: text contrast ${theme.audit.text.toFixed(2)} is below ${need}`);
  assert.ok(theme.audit.onFill >= need, `${label}: button label contrast ${theme.audit.onFill.toFixed(2)} is below ${need}`);
  assert.deepEqual(Object.keys(theme.vars), [...TOKEN_NAMES], `${label}: token set`);
}

/* ---------------------------------------------------------------- the four themes */

test("dark purple is the default and both purple presets meet WCAG AA", () => {
  assert.deepEqual([...THEME_IDS], ["dark-purple", "light-purple", "custom", "contrast"]);
  assert.equal(DEFAULT_PREF.id, "dark-purple");
  assert.equal(resolveTheme(DEFAULT_PREF).id, "dark-purple");
  assert.equal(PRESET_THEMES["dark-purple"].mode, "dark");
  assert.equal(PRESET_THEMES["light-purple"].mode, "light");
  for (const id of ["dark-purple", "light-purple"] as const) {
    const theme = PRESET_THEMES[id];
    assert.equal(theme.level, "standard");
    assert.equal(theme.vars["--rq-accent"], PRESET_SPECS[id].accent, `${id} keeps the brand purple as its accent`);
    assert.equal(theme.vars["--rq-canvas"], PRESET_SPECS[id].background);
    assertReadable(theme, id);
    assert.ok(theme.glow > 0.5, `${id} keeps most of its aurora`);
  }
});

test("the engine's contrast audit matches an independent measurement of the emitted CSS", () => {
  const themes: [string, BuiltTheme][] = [
    ["dark-purple", PRESET_THEMES["dark-purple"]],
    ["light-purple", PRESET_THEMES["light-purple"]],
    ["custom default", buildTheme(DEFAULT_CUSTOM)],
    ["custom orange on cream", buildTheme({ accent: "#ff6b00", background: "#fff7ed" })],
    ["custom green on mid grey", buildTheme({ accent: "#00ff00", background: "#808080" })],
    ["custom white on blue", buildTheme({ accent: "#ffffff", background: "#0000ff" })],
    ...[1, 2, 3, 5, 8, 13].map((seed): [string, BuiltTheme] => [`random seed ${seed}`, buildTheme(contrastSpec(seed))]),
  ];
  for (const [label, theme] of themes) {
    const need = MIN_TEXT_CONTRAST[theme.level];
    const text = measuredTextContrast(theme.vars);
    const labels = measuredLabelContrast(theme.vars);
    assert.ok(text >= need, `${label}: measured text contrast ${text.toFixed(2)} is below ${need}`);
    assert.ok(labels >= need, `${label}: measured button label contrast ${labels.toFixed(2)} is below ${need}`);
    assert.ok(Math.abs(text - theme.audit.text) < 0.02, `${label}: audit says ${theme.audit.text.toFixed(3)}, measured ${text.toFixed(3)}`);
    assert.ok(Math.abs(labels - theme.audit.onFill) < 0.02, `${label}: audit says ${theme.audit.onFill.toFixed(3)}, measured ${labels.toFixed(3)}`);
  }
});

test("custom colors stay readable for any accent and background, including mid-tones", () => {
  const accents = ["#7c3aed", "#2dd4bf", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff6b00", "#ffffff", "#000000", "#808080", "#f472b6", "#0ea5e9"];
  const backgrounds = ["#000000", "#ffffff", "#0e0a1f", "#f1ecff", "#071a1f", "#202020", "#404040", "#606060", "#808080", "#a0a0a0", "#c0c0c0", "#e0e0e0", "#7c3aed", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#3b1d0a", "#fde68a"];
  let lowest = Infinity;
  for (const accent of accents) {
    for (const background of backgrounds) {
      const theme = buildTheme({ accent, background });
      assertReadable(theme, `custom ${accent} on ${background}`);
      assert.equal(theme.vars["--rq-canvas"], background, "a standard theme keeps the chosen background");
      lowest = Math.min(lowest, theme.audit.text);
    }
  }
  assert.ok(lowest >= AA);
  // Light and dark backgrounds pick the matching mode, so native controls follow.
  assert.equal(buildTheme({ accent: "#7c3aed", background: "#fafafa" }).vars["--rq-scheme"], "light");
  assert.equal(buildTheme({ accent: "#7c3aed", background: "#101010" }).vars["--rq-scheme"], "dark");
});

test("unusable custom input falls back to safe colours instead of throwing", () => {
  for (const spec of [{ accent: "", background: "" }, { accent: "red", background: "rgb(1,2,3)" }, { accent: "#12", background: "#zzzzzz" }]) {
    const theme = buildTheme(spec);
    assertReadable(theme, JSON.stringify(spec));
    assert.equal(theme.vars["--rq-canvas"], PRESET_SPECS["dark-purple"].background);
  }
  assert.deepEqual(parseHex("#AbC"), [170, 187, 204]);
  assert.equal(parseHex("abc"), null);
  assert.equal(parseHex(7), null);
});

test("random high contrast meets WCAG AAA for every seed and is reproducible", () => {
  let dark = 0;
  const accents = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const theme = buildTheme(contrastSpec(seed));
    assert.equal(theme.level, "high");
    assertReadable(theme, `seed ${seed}`);
    assert.ok(theme.audit.text >= AAA && theme.audit.onFill >= AAA, `seed ${seed}: AAA`);
    assert.ok(theme.audit.fill >= MIN_UI_CONTRAST, `seed ${seed}: solid fills stand out from every surface (${theme.audit.fill.toFixed(2)})`);
    assert.ok(theme.audit.border >= MIN_UI_CONTRAST, `seed ${seed}: control borders are visible on every surface (${theme.audit.border.toFixed(2)})`);
    if (theme.mode === "dark") dark++;
    accents.add(theme.vars["--rq-accent"]);
  }
  assert.ok(dark > 90 && dark < 210, `shuffling yields both dark and light palettes (${dark} of 300 dark)`);
  assert.ok(accents.size > 250, `shuffling yields varied accents (${accents.size} distinct)`);
  assert.deepEqual(buildTheme(contrastSpec(4242)).vars, buildTheme(contrastSpec(4242)).vars);
  assert.notDeepEqual(buildTheme(contrastSpec(4242)).vars, buildTheme(contrastSpec(4243)).vars);
});

test("status colours keep their hue in the presets, the default custom palette and every random palette", () => {
  const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const themes = [PRESET_THEMES["dark-purple"], PRESET_THEMES["light-purple"], buildTheme(DEFAULT_CUSTOM), ...Array.from({ length: 300 }, (_, i) => buildTheme(contrastSpec(i + 1)))];
  for (const theme of themes) {
    for (const key of STATUS_KEYS) {
      const base = toOklch(parseHex(statusBase(key, theme.mode)) as Rgb);
      const ink = toOklch(parseHex(theme.vars[`--rq-${key}-ink`]) as Rgb);
      assert.ok(ink.c >= 0.05, `${key} text is still coloured (${theme.vars[`--rq-${key}-ink`]})`);
      assert.ok(hueGap(ink.h, base.h) <= 5, `${key} text keeps its hue (${theme.vars[`--rq-${key}-ink`]})`);
    }
  }
});

test("custom palettes never recolour status fills, and status outlines stay coloured on hard backgrounds", () => {
  const rgbOf = (value: string): Rgb => {
    const m = /^rgba\(([^)]+)\)$/.exec(value);
    return m ? (m[1].split(",").slice(0, 3).map(Number) as unknown as Rgb) : (parseHex(value) as Rgb);
  };
  const fills: Record<string, Set<string>> = {};
  for (const background of ["#000000", "#ffffff", "#0e0a1f", "#f1ecff", "#404040", "#606060", "#808080", "#a0a0a0", "#7c3aed", "#ff0000"]) {
    for (const accent of ["#7c3aed", "#2dd4bf", "#ff6b00", "#ffffff"]) {
      const theme = buildTheme({ accent, background });
      for (const key of STATUS_KEYS) {
        (fills[`${theme.mode} ${key}`] ??= new Set()).add(theme.vars[`--rq-${key}`]);
        // Badge and notice outlines stay recognisably coloured even where the text cannot.
        assert.ok(toOklch(rgbOf(theme.vars[`--rq-${key}-line`])).c >= 0.05, `${key} outline keeps its colour on ${background}`);
      }
    }
  }
  // A pass is the same green button in every palette of the same mode, whatever the accent and background.
  for (const [name, values] of Object.entries(fills)) assert.equal(values.size, 1, `${name} fill is the same in every palette`);
  // Status text is deliberately not asserted here: no saturated colour reaches 4.5:1 on a mid-tone background, so
  // there it fades toward black or white. Readability wins over hue; the custom-colours test covers its contrast.
});

/* ---------------------------------------------------------------- persistence and first paint */

test("stored preferences round-trip and tolerate malformed or tampered values", () => {
  const prefs: ThemePref[] = [
    DEFAULT_PREF,
    { id: "light-purple", custom: DEFAULT_CUSTOM, seed: 0 },
    { id: "custom", custom: { accent: "#ff6b00", background: "#fff7ed" }, seed: 0 },
    { id: "contrast", custom: DEFAULT_CUSTOM, seed: 3815463655 },
  ];
  for (const pref of prefs) {
    const raw = serializePref(pref);
    assert.deepEqual(parsePref(raw), pref);
    const stored = JSON.parse(raw) as { v: number; vars?: ThemeVars };
    assert.equal(stored.v, THEME_STORAGE_VERSION);
    // Only generated palettes carry a first-paint cache; the presets come from the stylesheet.
    if (pref.id === "custom" || pref.id === "contrast") assert.deepEqual(stored.vars, resolveTheme(pref).vars);
    else assert.equal(stored.vars, undefined);
  }
  for (const junk of [null, undefined, "", "{not json", "null", "42", "[]", JSON.stringify({ id: "nope" })]) assert.deepEqual(parsePref(junk), DEFAULT_PREF, String(junk));
  assert.deepEqual(parsePref(JSON.stringify({ id: "custom", custom: { accent: "red;}body{display:none", background: 5 }, seed: "x" })), { id: "custom", custom: DEFAULT_CUSTOM, seed: 0 });
  assert.deepEqual(parsePref(JSON.stringify({ id: "custom", custom: { accent: "#ABC", background: "#000" } })).custom, { accent: "#aabbcc", background: "#000000" });
  assert.equal(parsePref(JSON.stringify({ id: "contrast", seed: -7.9 })).seed, 7);
  assert.equal(parsePref(JSON.stringify({ id: "contrast", seed: 1e300 })).id, "contrast");
});

/** Runs the first-paint script against a fake document and reports what it changed. */
function runInitScript(stored: string | null | (() => never)) {
  const attrs: Record<string, string> = {};
  const props: Record<string, string> = {};
  const sandbox = {
    document: { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v), style: { setProperty: (k: string, v: string) => void (props[k] = v) } } },
    localStorage: { getItem: () => (typeof stored === "function" ? stored() : stored) },
  };
  vm.runInNewContext(THEME_INIT_SCRIPT, sandbox);
  return { attrs, props };
}

test("the first-paint script applies only whitelisted themes and tokens and never throws", () => {
  assert.deepEqual(runInitScript(null), { attrs: {}, props: {} });
  assert.deepEqual(runInitScript("{not json"), { attrs: {}, props: {} });
  assert.deepEqual(runInitScript(JSON.stringify({ v: 1, id: "nope", vars: { "--rq-canvas": "#ffffff" } })), { attrs: {}, props: {} });
  assert.deepEqual(runInitScript(() => { throw new Error("storage blocked"); }), { attrs: {}, props: {} });
  assert.deepEqual(runInitScript(serializePref({ id: "light-purple", custom: DEFAULT_CUSTOM, seed: 0 })), { attrs: { "data-theme": "light-purple" }, props: {} });

  // Generated palettes are painted from the cache in full: every value the engine emits passes the whitelist.
  const generated: ThemePref[] = [
    { id: "custom", custom: DEFAULT_CUSTOM, seed: 0 },
    { id: "custom", custom: { accent: "#ff6b00", background: "#fff7ed" }, seed: 0 },
    { id: "custom", custom: { accent: "#00ff00", background: "#808080" }, seed: 0 },
    { id: "custom", custom: { accent: "#ffffff", background: "#000000" }, seed: 0 },
    ...Array.from({ length: 40 }, (_, i): ThemePref => ({ id: "contrast", custom: DEFAULT_CUSTOM, seed: i + 1 })),
  ];
  for (const pref of generated) {
    const { attrs, props } = runInitScript(serializePref(pref));
    assert.equal(attrs["data-theme"], pref.id);
    assert.deepEqual(props, resolveTheme(pref).vars, `${pref.id} ${JSON.stringify(pref.custom)} seed ${pref.seed}`);
  }

  // A preset never takes inline tokens, even if some are stored.
  assert.deepEqual(runInitScript(JSON.stringify({ v: THEME_STORAGE_VERSION, id: "dark-purple", vars: { "--rq-canvas": "#ffffff" } })).props, {});
  // A cache written by another release is ignored; the picker recomputes it after load.
  assert.deepEqual(runInitScript(JSON.stringify({ v: THEME_STORAGE_VERSION + 1, id: "custom", vars: { "--rq-canvas": "#ffffff" } })), { attrs: { "data-theme": "custom" }, props: {} });
  // Tampered caches cannot set other properties, and can only supply literal colours, numbers and lengths:
  // no URLs (which the browser would fetch), no references to other values, no declarations or markup.
  const tampered = runInitScript(JSON.stringify({
    v: THEME_STORAGE_VERSION, id: "custom",
    vars: {
      "--rq-canvas": "#123456", "--rq-shadow": "0 18px 40px -20px rgba(0, 0, 0, 0.75)", "--rq-blur": "14px", "--rq-scheme": "light",
      "--evil": "#000000", color: "#000000", "--rq-accent": 7, "--rq-line": "1 ".repeat(60) + "1",
      "--rq-ink": "url(javascript:alert(1))", "--rq-glow-1": "url(x)", "--rq-glow-2": "var(--rq-accent)", "--rq-glow-3": "calc(1px + 2px)", "--rq-edge": "env(x)",
      "--rq-muted": "red;background:url(//x.test/a)", "--rq-faint": "</style><script>", "--rq-field": "rgba(0, 0, 0, 0.5", "--rq-well": "#12345", "--rq-raised": "#1234567",
      "--rq-opaque": "red", "--rq-popover": "transparent", "--rq-sticky": "inherit", "--rq-tint-1": "", "--rq-tint-2": " #123456", "--rq-saturate": "1.5 ",
    },
  }));
  assert.deepEqual(tampered, { attrs: { "data-theme": "custom" }, props: { "--rq-canvas": "#123456", "--rq-shadow": "0 18px 40px -20px rgba(0, 0, 0, 0.75)", "--rq-blur": "14px", "--rq-scheme": "light" } });
});

test("preset CSS defines every token for both purple themes and nothing else", () => {
  const cssText = presetCss();
  assert.equal(TOKEN_NAMES.length, 59);
  assert.ok(TOKEN_NAMES.every((name) => /^--rq-[a-z0-9-]+$/.test(name)));
  const blocks = [...cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1], names: m[2].split(";").map((d) => d.slice(0, d.indexOf(":"))) }));
  assert.deepEqual(blocks.map((b) => b.selector), [":root", ":root[data-theme=light-purple]"]);
  for (const block of blocks) assert.deepEqual(block.names, [...TOKEN_NAMES]);
  assert.ok(!/[<>]/.test(cssText), "safe to inline in a style element");
  assert.ok(cssText.includes(`--rq-canvas:${PRESET_SPECS["dark-purple"].background}`));
});

/* ---------------------------------------------------------------- stylesheet contract */

/** Top-level and nested rules of a stylesheet as `{ prelude, body, depth }`, without a CSS parser dependency. */
function cssRules(source: string, depth = 0): { prelude: string; body: string; depth: number }[] {
  const rules: { prelude: string; body: string; depth: number }[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    const semi = source.indexOf(";", i);
    if (open < 0) break;
    if (semi >= 0 && semi < open) {
      i = semi + 1;
      continue;
    }
    let level = 1, j = open + 1;
    for (; j < source.length && level > 0; j++) level += source[j] === "{" ? 1 : source[j] === "}" ? -1 : 0;
    const prelude = source.slice(i, open).trim().replace(/\s+/g, " ");
    const body = source.slice(open + 1, j - 1);
    rules.push({ prelude, body, depth });
    if (/^@(layer|media|supports)\b/.test(prelude)) rules.push(...cssRules(body, depth + 1));
    i = j;
  }
  return rules;
}

test("theme styles never leak outside the app shell, so /demo-target renders as before", () => {
  const rules = cssRules(globalsCss).filter((r) => !r.prelude.startsWith("@"));
  const unscoped = rules.filter((r) => !/\.rq-(app|glass|live)\b/.test(r.prelude)).map((r) => `${r.prelude} { ${r.body.trim().replace(/\s+/g, " ")} }`);
  // Exactly the three rules the stylesheet had before theming.
  assert.deepEqual(unscoped, [
    ":root { color-scheme: light; }",
    'body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }',
    ".react-flow__attribution { display: none; }",
  ]);
  assert.ok(rules.length > 15, "the stylesheet was parsed");
});

test("the document colour scheme follows the theme from an unlayered rule", () => {
  // `:root { color-scheme: light }` is unlayered, so an override inside any @layer would silently lose to it.
  const rule = cssRules(globalsCss).filter((r) => r.prelude === "html:has(.rq-app)");
  assert.equal(rule.length, 1);
  assert.equal(rule[0].depth, 0);
  assert.match(rule[0].body, /color-scheme:\s*var\(--rq-scheme, dark\)/);
});

test("the three aurora glows never overlap", () => {
  // The engine assumes at most one glow at full strength behind any point of the page.
  const glows = [...globalsCss.matchAll(/radial-gradient\(ellipse ([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%, var\(--rq-glow-(\d)\), transparent\)/g)]
    .map((m) => ({ rx: Number(m[1]) / 100, ry: Number(m[2]) / 100, cx: Number(m[3]) / 100, cy: Number(m[4]) / 100, id: m[5] }));
  assert.deepEqual(glows.map((g) => g.id), ["1", "2", "3"]);
  const steps = 500;
  for (let yi = 0; yi <= steps; yi++) {
    for (let xi = 0; xi <= steps; xi++) {
      const x = xi / steps, y = yi / steps;
      const inside = glows.filter((g) => ((x - g.cx) / g.rx) ** 2 + ((y - g.cy) / g.ry) ** 2 < 1);
      assert.ok(inside.length <= 1, `glows ${inside.map((g) => g.id).join(" and ")} overlap at ${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`);
    }
  }
});

test("every theme token is exposed as a Tailwind colour utility", () => {
  const mapped = new Set([...globalsCss.matchAll(/--color-([a-z0-9-]+):\s*var\(--rq-([a-z0-9-]+)\)/g)].map((m) => {
    assert.equal(m[1], m[2], "utility and token share a name");
    return `--rq-${m[2]}`;
  }));
  // Tokens consumed directly by the stylesheet rather than through a utility class.
  const structural = ["--rq-scheme", "--rq-glow-1", "--rq-glow-2", "--rq-glow-3", "--rq-surface", "--rq-sheen", "--rq-edge", "--rq-shadow", "--rq-blur", "--rq-saturate"];
  for (const name of structural) assert.ok(globalsCss.includes(`var(${name}`), `${name} is used by the stylesheet`);
  assert.deepEqual([...TOKEN_NAMES].filter((name) => !mapped.has(name) && !structural.includes(name)), []);
  for (const name of mapped) assert.ok(TOKEN_NAMES.includes(name), `${name} is defined by the engine`);
});
