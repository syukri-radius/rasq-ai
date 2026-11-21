/**
 * Talk animation for the RASQ-Ai bot avatar.
 *
 * Real speech is not "mouth opens and closes". It has:
 *
 *  - **Visemes**: a small set of mouth shapes that correspond to how the lips actually move for a given
 *    class of sound. A wide horizontal shape is an "ee", a rounded shape is an "oo", an open vertical
 *    shape is an "ah".
 *  - **Envelope**: loudness rises and falls over a syllable, and falls to zero between phrases. Without
 *    the envelope the mouth moves at constant speed and reads as mechanical.
 *  - **Coarticulation**: the mouth starts moving *before* the sound and continues *after* it, because the
 *    articulators are always in motion. A small lead/lag on the viseme transition captures this.
 *  - **Secondary motion**: the head nods on stressed syllables, the brows move with emphasis, and the
 *    body breathes. Without this the character looks like a puppet with only a jaw.
 *
 * The talk system takes a *text* and produces a deterministic sequence of visemes with timing, so the
 * animation is reproducible and testable — no randomness in the visual path. Randomness (if used) belongs
 * in the idle layer only.
 */

import { clamp, lerp, smoothstep } from "./math";

/** The mouth shapes the rig can pose. */
export type Viseme =
  | "rest" // silence
  | "aa" // open jaw
  | "ee" // wide, narrow
  | "oo" // rounded, closed
  | "mm" // lips pressed
  | "ff" // lower lip to teeth
  | "th"; // tongue / teeth

/** The set of shapes, with the jaw-opening amount and lip width each one implies. */
export const VISEME_SHAPES: Record<Viseme, { jaw: number; width: number; lip: number }> = {
  rest: { jaw: 0.0, width: 1.0, lip: 0.0 },
  aa: { jaw: 1.0, width: 0.86, lip: 0.35 },
  ee: { jaw: 0.26, width: 1.28, lip: 0.1 },
  oo: { jaw: 0.4, width: 0.7, lip: 0.55 },
  mm: { jaw: 0.05, width: 0.95, lip: 0.85 },
  ff: { jaw: 0.16, width: 1.05, lip: 0.6 },
  th: { jaw: 0.34, width: 1.0, lip: 0.25 },
};

/**
 * How a character maps to a viseme.
 *
 * The mapping is by *mouth shape*, not by phoneme. That is what a low-poly character can express: the
 * difference between "m" and "b" is a voice, not a mouth shape, and both close the lips the same way.
 * So the consonants that share a shape share a viseme.
 */
const CHAR_TO_VISEME: Record<string, Viseme> = {
  a: "aa", b: "mm", c: "oo", d: "aa", e: "ee", f: "ff", g: "oo", h: "aa", i: "ee",
  j: "aa", k: "mm", l: "mm", m: "mm", n: "mm", o: "oo", p: "mm", q: "oo", r: "oo",
  s: "ee", t: "th", u: "oo", v: "ff", w: "oo", x: "ff", y: "ee", z: "ee",
};

/**
 * One scheduled mouth event.
 *
 * `t` is the start time in seconds from the beginning of the utterance, `dur` its duration, and `gain`
 * the loudness of that syllable.
 */
export type MouthEvent = {
  t: number;
  dur: number;
  viseme: Viseme;
  gain: number;
};

/** A complete scheduled utterance. */
export type TalkTrack = {
  events: MouthEvent[];
  /** Total duration in seconds, including the trailing silence. */
  duration: number;
  /** Per-word stress peaks, used to drive head nods. */
  stresses: number[];
};

export type TalkState = {
  /** Mouth openness 0..1. */
  jaw: number;
  /** Lip width multiplier. */
  width: number;
  /** Lip round / pucker 0..1. */
  lip: number;
  /** Overall loudness 0..1. */
  energy: number;
  /** Head pitch offset in radians (nod). */
  nod: number;
  /** Head yaw offset in radians. */
  yaw: number;
  /** Brow raise 0..1. */
  brow: number;
  /** Breath phase 0..1. */
  breath: number;
};

export function createTalkState(): TalkState {
  return { jaw: 0, width: 1, lip: 0, energy: 0, nod: 0, yaw: 0, brow: 0, breath: 0 };
}

/**
 * How long a viseme is held, from the character itself.
 *
 * Vowels are long, consonants are short. This is what makes the speech rhythm sound like speech instead
 * of a machine gun.
 */
function visemeDuration(ch: string): number {
  const v = CHAR_TO_VISEME[ch] ?? "aa";
  switch (v) {
    case "aa":
    case "ee":
    case "oo":
      return 0.135;
    case "mm":
    case "ff":
      return 0.062;
    default:
      return 0.085;
  }
}

/**
 * Builds a talk track from text.
 *
 * The scheduler is deterministic: the same text always produces the same timing and the same viseme
 * sequence. That property is what makes the talk animation unit-testable, and it is also why the
 * character reads the same way every time it says the same thing.
 */
export function buildTalkTrack(text: string, opts?: { rate?: number }): TalkTrack {
  const rate = opts?.rate ?? 1;
  const events: MouthEvent[] = [];
  const stresses: number[] = [];

  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let t = 0;
  let wordIndex = 0;

  for (const word of words) {
    const chars = [...word.toLowerCase()];
    for (const ch of chars) {
      if (!/[a-z]/.test(ch)) {
        // Punctuation advances time but does not make a sound.
        t += (ch === "," || ch === ";" || ch === ":" ? 0.13 : ch === "." || ch === "!" || ch === "?" ? 0.2 : 0.04) / rate;
        continue;
      }
      const viseme = CHAR_TO_VISEME[ch] ?? "aa";
      const dur = visemeDuration(ch) / rate;
      // Stress: the first vowel of a word carries the emphasis.
      const isVowel = "aeiou".includes(ch);
      const stressed = isVowel && !/[aeiou]/.test(chars[Math.max(0, chars.indexOf(ch) - 1)] ?? "");
      const gain = stressed ? 1 : 0.62 + (ch === ch.toLowerCase() ? 0.06 : 0);
      events.push({ t, dur, viseme, gain });
      if (stressed) stresses.push(t + dur * 0.5);
      t += dur;
    }
    // Short inter-word gap; a comma adds more.
    t += 0.035 / rate;
    wordIndex++;
  }

  // A short tail so the mouth closes *after* the last sound rather than on it.
  const duration = t + 0.18;
  return { events, duration, stresses };
}

/**
 * Evaluates the talk state at a point in time.
 *
 * The mouth shape is a blend: the current viseme and the next one are cross-faded, and each event has a
 * short attack and release. `lead` makes the shape start slightly before its onset (coarticulation).
 */
export function evaluateTalk(track: TalkTrack, time: number, state: TalkState): TalkState {
  const LEAD = 0.035;

  let jaw = 0;
  let width = 1;
  let lip = 0;
  let energy = 0;

  for (const ev of track.events) {
    const start = ev.t - LEAD;
    const end = ev.t + ev.dur;
    if (time < start || time > end + 0.06) continue;

    const shape = VISEME_SHAPES[ev.viseme];
    // Attack: ramp up over the first 40% of the viseme. Release: fall off over the trailing 35%.
    const atk = clamp((time - start) / Math.max(0.001, ev.dur * 0.4), 0, 1);
    const rel = clamp((end + 0.06 - time) / 0.06, 0, 1);
    const w = smoothstep(atk) * smoothstep(rel) * ev.gain;

    jaw = Math.max(jaw, shape.jaw * w);
    lip = Math.max(lip, shape.lip * w);
    // Width blends toward the target rather than taking the max, so a wide shape after a narrow one
    // actually reads as a change of shape.
    width = lerp(width, shape.width, w * 0.9);
    energy = Math.max(energy, w);
  }

  // Head motion: nod on stressed syllables, with a small amount of lateral drift.
  let nod = 0;
  let brow = 0;
  for (const s of track.stresses) {
    const d = time - s;
    if (d < -0.06 || d > 0.34) continue;
    // A quick down-then-up motion around the stress.
    const u = clamp((d + 0.06) / 0.4, 0, 1);
    const shape = Math.sin(Math.PI * u);
    nod -= shape * 0.085;
    brow += shape * 0.42;
  }
  // A slow, small yaw sway keeps the head alive between stresses.
  const sway = Math.sin(time * 1.7) * 0.028 * energy;

  state.jaw = jaw;
  state.width = width;
  state.lip = lip;
  state.energy = energy;
  state.nod = nod;
  state.yaw = sway;
  state.brow = brow;
  state.breath = (time / 3.6) % 1;
  return state;
}

/**
 * A synthesised speech envelope for a duration, used when the bot should appear to talk without text
 * (for example while a run is executing and the status message is not natural speech).
 *
 * It produces a plausible sequence of syllables at a natural rate rather than a flat hum.
 */
export function buildGenericTalkTrack(duration: number, seed = 1): TalkTrack {
  const events: MouthEvent[] = [];
  const stresses: number[] = [];
  // A small deterministic PRNG keeps this reproducible across runs.
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
  const shapes: Viseme[] = ["aa", "ee", "oo", "mm", "aa", "oo", "ee", "ff"];
  let t = 0.1;
  while (t < duration - 0.2) {
    const dur = 0.09 + rnd() * 0.09;
    const viseme = shapes[Math.floor(rnd() * shapes.length)];
    const gain = 0.5 + rnd() * 0.5;
    events.push({ t, dur, viseme, gain });
    if (rnd() > 0.72) stresses.push(t + dur * 0.5);
    // Gaps between syllables: sometimes contiguous, sometimes not.
    t += dur + (rnd() > 0.55 ? 0.01 + rnd() * 0.06 : 0);
  }
  return { events, duration, stresses };
}
