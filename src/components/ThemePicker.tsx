"use client";

import { useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { Check, Shuffle } from "lucide-react";
import { Btn } from "./ui";
import { PRESET_SPECS, THEME_HINTS, THEME_IDS, THEME_LABELS, THEME_STORAGE_KEY, TOKEN_NAMES, contrastSpec, parsePref, randomSeed, resolveTheme, serializePref, type ResolvedTheme, type ThemeId, type ThemePref } from "@/lib/theme";

/*
 * The theme preference lives in localStorage. This small store keeps every picker and the document in sync,
 * including across tabs, and falls back to memory when storage is unavailable.
 */
const listeners = new Set<() => void>();
let unsaved: string | null = null;
let resolved: { raw: string | null; pref: ThemePref; theme: ResolvedTheme } | null = null;

function read(): string | null {
  if (unsaved !== null) return unsaved;
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function write(pref: ThemePref) {
  const raw = serializePref(pref);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, raw);
    unsaved = null;
  } catch {
    unsaved = raw;
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

function resolve(raw: string | null) {
  if (!resolved || resolved.raw !== raw) {
    const pref = parsePref(raw);
    resolved = { raw, pref, theme: resolveTheme(pref) };
  }
  return resolved;
}

export function useTheme() {
  // The server and the hydrating render cannot know the stored choice: they show the default theme and report
  // `ready: false`. The stored choice follows right after hydration.
  const raw = useSyncExternalStore<string | null | undefined>(subscribe, read, () => undefined);
  const { pref, theme } = resolve(raw ?? null);
  return { pref, theme, setPref: write, ready: raw !== undefined };
}

/** Applies the active theme to the document. Mounted once by the app shell. */
export function ThemeEffect() {
  const { theme, ready } = useTheme();
  useEffect(() => {
    // Until the stored choice is known, leave the document exactly as the pre-paint script set it up.
    if (!ready) return;
    const root = document.documentElement;
    const inline = theme.id === "custom" || theme.id === "contrast";
    root.setAttribute("data-theme", theme.id);
    // The two presets come from the stylesheet; generated palettes are set inline and must be cleared when leaving them.
    for (const name of TOKEN_NAMES) {
      if (inline) root.style.setProperty(name, theme.vars[name]);
      else root.style.removeProperty(name);
    }
  }, [theme, ready]);
  return null;
}

const SHORT_LABELS: Record<ThemeId, string> = { "dark-purple": "Dark", "light-purple": "Light", custom: "Custom", contrast: "Random" };
const RAINBOW = "conic-gradient(#f43f5e, #f59e0b, #10b981, #0ea5e9, #8b5cf6, #f43f5e)";

function swatch(id: ThemeId, pref: ThemePref): CSSProperties {
  if (id === "contrast" && !pref.seed) return { background: RAINBOW };
  const { background, accent } = id === "custom" ? pref.custom : id === "contrast" ? contrastSpec(pref.seed) : PRESET_SPECS[id];
  return { background: `linear-gradient(135deg, ${background} 50%, ${accent} 50%)` };
}

export default function ThemePicker() {
  const { pref, theme, setPref } = useTheme();
  // The first visit to the random theme rolls a palette; after that it stays put until shuffled.
  const choose = (id: ThemeId) => setPref({ ...pref, id, seed: id === "contrast" && !pref.seed ? randomSeed() : pref.seed });
  const setCustom = (key: "accent" | "background", value: string) => setPref({ ...pref, custom: { ...pref.custom, [key]: value } });
  return (
    <div className="@container space-y-2">
      <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-4" role="group" aria-label="Theme">
        {THEME_IDS.map((id) => {
          const active = pref.id === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              aria-label={THEME_LABELS[id]}
              title={`${THEME_LABELS[id]} · ${THEME_HINTS[id]}`}
              onClick={() => choose(id)}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs text-ink transition ${active ? "border-accent-line bg-accent-soft font-semibold" : "border-line bg-raised hover:bg-raised-hover"}`}
            >
              <span className="h-4 w-4 shrink-0 rounded-full border border-line-strong" style={swatch(id, pref)} />
              <span className="truncate">{SHORT_LABELS[id]}</span>
              {active && <Check size={12} className="ml-auto shrink-0" />}
            </button>
          );
        })}
      </div>
      {pref.id === "custom" && (
        <div className="grid grid-cols-2 gap-1.5 text-xs @md:max-w-sm">
          {(["accent", "background"] as const).map((key) => (
            <label key={key} className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-field px-1.5 py-1 capitalize text-ink">
              <input type="color" value={pref.custom[key]} onChange={(e) => setCustom(key, e.target.value)} className="h-5 w-5 shrink-0 cursor-pointer bg-transparent" />
              <span className="truncate">{key}</span>
            </label>
          ))}
        </div>
      )}
      {pref.id === "contrast" && (
        <Btn className="w-full !py-1 text-xs @md:w-auto" onClick={() => setPref({ ...pref, seed: randomSeed() })}>
          <Shuffle size={13} /> Shuffle colors
        </Btn>
      )}
      <p className="text-[11px] leading-snug text-muted">
        {THEME_LABELS[pref.id]} · text contrast at least {(Math.floor(theme.audit.text * 10) / 10).toFixed(1)}:1 (WCAG {theme.level === "high" ? "AAA" : "AA"})
      </p>
    </div>
  );
}
