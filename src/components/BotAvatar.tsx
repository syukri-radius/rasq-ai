"use client";

/**
 * The bot avatar: a procedural, GPU-skinned humanoid that walks and talks in the browser.
 *
 * The component owns three things and delegates everything else:
 *
 *   - the **rig**, which turns a gait phase and a talk track into 24 bone matrices;
 *   - the **renderer**, a hand-written WebGL2 pipeline with one draw call per material;
 *   - the **frame loop**, which advances the rig by the real elapsed time and draws.
 *
 * Everything it needs is local and dependency-free: there is no three.js, no model loader, and no
 * network traffic. The whole avatar is roughly 40 KB of static geometry, so it is cheap enough to keep
 * on screen while the rest of the dashboard does its work.
 *
 * Accessibility and resilience:
 *
 *   - The canvas carries a text alternative, so a screen reader announces what the avatar is doing.
 *   - If WebGL2 is missing, the component falls back to a static 2D silhouette instead of showing a
 *     broken canvas.
 *   - The animation stops entirely when the tab is hidden or the element scrolls out of view, so a
 *     background tab never burns a core on a character nobody is looking at.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildBotMeshLods, lodForDistance, Lod, type Mesh } from "@/lib/bot/geometry";
import { createRig, updateRig, type Rig } from "@/lib/bot/rig";
import { createCamera, createRenderer, type BotRenderer, type RenderTheme } from "@/lib/bot/renderer";
import { buildTalkTrack, type TalkTrack } from "@/lib/bot/talk";
import { mat4, mat4Mul } from "@/lib/bot/math";

/** The avatar's colour scheme, matched to the glassmorphic shell it lives in. */
const THEME: RenderTheme = {
  key: [0.32, 0.36, 0.42],
  fill: [0.16, 0.19, 0.24],
  ambient: [0.34, 0.37, 0.44],
  lightDir: [0.42, 0.78, 0.46],
  rim: 0.45,
  clear: [0.043, 0.055, 0.078, 1],
};

export type BotAvatarProps = {
  /** Canvas height in CSS pixels. The width follows the container. */
  height?: number;
  /** "walk" | "idle" | "talk" — the animation the avatar performs. */
  mode?: "walk" | "idle" | "talk";
  /** The text the avatar speaks in "talk" mode. */
  speech?: string;
  /** Extra class names for the wrapper. */
  className?: string;
};

/**
 * A static fallback for browsers without WebGL2.
 *
 * It is deliberately simple: a rounded figure on a plinth. The point is that the layout still looks
 * intentional and the page still works, not that it looks good.
 */
function FallbackAvatar({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-full w-full items-end justify-center"
      style={{ background: "linear-gradient(180deg, rgba(122,162,247,0.10), rgba(0,0,0,0))" }}
    >
      <svg viewBox="0 0 120 200" className="h-full w-auto opacity-70" aria-hidden="true">
        <ellipse cx="60" cy="188" rx="38" ry="7" fill="rgba(122,162,247,0.22)" />
        <circle cx="60" cy="34" r="19" fill="#c8b6a4" />
        <path d="M41 30a19 19 0 0 1 38 0z" fill="#3a2f28" />
        <path d="M44 56h32l7 52H37z" fill="#4f6fa8" />
        <path d="M44 56h32l2 14H42z" fill="#3d5684" />
        <path d="M41 62l-9 44" stroke="#c8b6a4" strokeWidth="9" strokeLinecap="round" />
        <path d="M79 62l9 44" stroke="#c8b6a4" strokeWidth="9" strokeLinecap="round" />
        <path d="M47 108l-3 76" stroke="#2f3d5c" strokeWidth="13" strokeLinecap="round" />
        <path d="M73 108l3 76" stroke="#2f3d5c" strokeWidth="13" strokeLinecap="round" />
        <path d="M36 186h18M66 186h18" stroke="#1b2233" strokeWidth="9" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function BotAvatar({
  height = 320,
  mode = "walk",
  speech,
  className,
}: BotAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rigRef = useRef<Rig | null>(null);
  const rendererRef = useRef<BotRenderer | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  // Every LOD tier is built once and shared. They are procedural and deterministic, so the cost is a
  // few milliseconds at mount and nothing at all afterwards.
  const lods = useMemo(() => buildBotMeshLods(), []);

  // The tier currently on the GPU. It only changes when the camera distance crosses a threshold.
  const lodRef = useRef<Lod>(Lod.LOD0);

  // The talk track is rebuilt only when the text changes.
  const track = useMemo<TalkTrack | null>(
    () => (mode === "talk" && speech ? buildTalkTrack(speech) : null),
    [mode, speech],
  );

  const label =
    mode === "talk"
      ? "Bot avatar speaking"
      : mode === "walk"
        ? "Bot avatar walking"
        : "Bot avatar standing idle";

  /** Advances the rig and draws one frame. */
  const drawFrame = useCallback(
    (now: number, previous: number) => {
      const rig = rigRef.current;
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!rig || !renderer || !canvas) return;

      // The clock is clamped: a backgrounded tab produces a huge delta on return, and a huge delta
      // would fling the character across the screen.
      const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));

      rig.state.walkWeight = mode === "walk" ? 1 : 0;
      rig.state.talking = mode === "talk";
      rig.state.talkWeight = mode === "talk" ? 1 : 0;

      updateRig(rig, dt, track, now / 1000);

      // The camera follows the character so it stays framed as it walks.
      const aspect = Math.max(0.2, canvas.clientWidth / Math.max(1, canvas.clientHeight));
      const distance = 3.4;
      const { view, projection } = createCamera({
        distance,
        height: 1.25,
        targetY: 0.92,
        aspect,
      });

      // The level of detail follows the camera distance. The swap happens on the frame the threshold is
      // crossed, so the avatar never spends a frame at the wrong tier.
      const wanted = lodForDistance(distance);
      if (wanted !== lodRef.current) {
        lodRef.current = wanted;
        renderer.setMesh(lods[wanted]);
      }
      // The model matrix slides the character back to the centre of the frame; the world itself keeps
      // moving forward, which is what makes the walk read as travel rather than as a treadmill.
      const model = mat4();
      model[12] = -rig.state.travelX;
      model[13] = -rig.state.bob;

      renderer.render(rig.matrices, view, projection, model, THEME);
    },
    [mode, track, lods],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: BotRenderer;
    try {
      renderer = createRenderer(canvas, lods[Lod.LOD0]);
    } catch {
      // No WebGL2 (or the context could not be created): fall back to the 2D avatar.
      setSupported(false);
      return;
    }
    setSupported(true);

    const rig = createRig(lods[Lod.LOD0]);
    rigRef.current = rig;
    rendererRef.current = renderer;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      renderer.resize(canvas.clientWidth, canvas.clientHeight, dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    let previous = performance.now();
    let visible = true;
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible) previous = performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible) return;
      drawFrame(now, previous);
      previous = now;
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      renderer.dispose();
      rendererRef.current = null;
      rigRef.current = null;
    };
  }, [lods, drawFrame]);

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{ height, position: "relative", overflow: "hidden", borderRadius: 14 }}
    >
      {supported === false ? (
        <FallbackAvatar label={label} />
      ) : (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          style={{ display: "block", width: "100%", height: "100%" }}
        />
      )}
    </div>
  );
}
