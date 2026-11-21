"use client";

/**
 * The bot avatar panel: the 3D character plus the controls that drive it.
 *
 * The panel is deliberately small. It is a status indicator, not a feature: the character walks while
 * the agent is working, talks while it is reporting, and stands idle otherwise. The mode buttons make
 * that state explicit and let a reviewer check each animation without hunting for a trigger.
 *
 * The performance budget is stated on the panel itself. A reviewer should be able to see the cost of the
 * avatar without reading the source: 1550 triangles, 7 draw calls, 24 bones, one shader.
 */

import { useState } from "react";

import BotAvatar from "@/components/BotAvatar";

const MODES = [
  { id: "idle", label: "Idle" },
  { id: "walk", label: "Walk" },
  { id: "talk", label: "Talk" },
] as const;

type Mode = (typeof MODES)[number]["id"];

const SPEECH =
  "Recording complete. I captured twelve screens, found forty-three candidate regions, and flagged two that need a human decision.";

export default function BotAvatarPanel() {
  const [mode, setMode] = useState<Mode>("walk");

  return (
    <section className="rq-glass rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Agent presence</h2>
        <div className="flex gap-1" role="group" aria-label="Avatar animation">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={`rounded-md border px-2 py-1 text-xs transition ${
                mode === m.id
                  ? "border-transparent bg-accent text-on-accent"
                  : "border-line-strong bg-raised text-ink hover:bg-raised-hover"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <BotAvatar mode={mode} speech={SPEECH} height={300} />

      <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
        {[
          ["Triangles", "1 550"],
          ["Draw calls", "7"],
          ["Bones", "24"],
          ["Textures", "0"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="mt-0.5 font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
