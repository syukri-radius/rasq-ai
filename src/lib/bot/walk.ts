/**
 * Procedural walk cycle for the RASQ-Ai bot avatar.
 *
 * The animation is *authored*, not simulated. A real walk cycle is a periodic sequence with a strict
 * ordering of events, and reproducing that ordering by hand produces motion that reads as human even
 * though every value is a closed-form function of time.
 *
 * The gait is decomposed into the standard four phases of a single leg's cycle:
 *
 *   stance (60%)  foot on the ground, weight borne, body passes over the foot
 *   swing  (40%)  foot lifts, travels forward, and is placed again
 *
 * Within stance there are two sub-events that carry most of the realism:
 *
 *   heel strike   the heel touches down first, at ~15% of the cycle
 *   toe off      the heel lifts and the body pushes off the toe, at ~50%
 *
 * Getting those two events wrong is what makes CG walk cycles look like skating or moonwalking. Here the
 * foot is pinned to the ground during stance (no sliding) and the ankle is driven by the heel/toe state
 * rather than by a single sinusoid.
 *
 * The upper body runs on the *complementary* phase: arms swing opposite to the legs, the pelvis rotates
 * about Y in the opposite direction to the chest, and the shoulders counter-rotate to compensate. This
 * pelvic/shoulder counter-rotation is the single strongest cue that a walk is human.
 */

import { STRIDE_LENGTH } from "./geometry";
import { catmullRom, clamp, lerp, smoothstep, TAU } from "./math";

export type GaitPhase = {
  /** Cycle position in [0, 1). 0 = heel strike of the left foot. */
  t: number;
};

/** Fraction of the cycle the foot spends in contact with the ground. 0.62 is a natural human cadence. */
const STANCE = 0.62;
/** Phase within stance at which the heel strikes. */
const HEEL_STRIKE = 0.04;
/** Phase within stance at which the heel lifts and the toe rolls over. */
const TOE_OFF = 0.46;
/** Fraction of the cycle at which the swing foot is directly under the hip (mid-swing). */
const MID_SWING = 0.81;

/**
 * The four control points of a keyframed curve, sampled with Catmull-Rom.
 *
 * Each joint gets a small set of keyframes per cycle. Using a curve instead of a bare sine lets the
 * motion have the "flat spot" that real joints have — for instance, the thigh is nearly still through
 * mid-stance and swings quickly through mid-swing.
 */
type Keys = readonly [number, number, number, number];

/**
 * Samples a Catmull-Rom curve through 4 keys at parameter `t` in [0, 1].
 *
 * The keys are treated as a looping segment: the curve that runs from key 3 back to key 0 closes the
 * cycle, so a keyframed joint never "snaps" at the wrap point. The index arithmetic below is wrapped
 * rather than clamped, because clamping would flatten the tangent at the seam and leave a visible kink
 * once per cycle.
 */
function sampleKeys(k: Keys, t: number): number {
  const x = ((t % 1) + 1) % 1;
  const seg = x * 3;
  const i = Math.min(2, Math.floor(seg));
  const f = seg - i;
  const k0 = k[(i + 3) % 4], k1 = k[i % 4], k2 = k[(i + 1) % 4], k3 = k[(i + 2) % 4];
  return catmullRom(k0, k1, k2, k3, f);
}

/**
 * Foot height above the ground for one leg, in metres.
 *
 * The swing leg traces a smooth arc: it leaves the ground just after toe-off, peaks at mid-swing, and
 * touches down at heel strike. The height uses a shaped curve rather than a sine so the foot lifts off
 * quickly and lands softly — the asymmetry of a real step.
 */
export function footLiftHeight(t: number, side: number): number {
  // The right leg is half a cycle out of phase with the left.
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  const swingStart = TOE_OFF + 0.5; // in absolute cycle terms
  // Work in the leg's own local timeline: 0 = heel strike, 1 = next heel strike.
  const local = p;
  const lift = 0.085;

  // Distance from the start of the swing phase, normalised to the swing duration.
  const swingDur = 1 - STANCE;
  const swingStartLocal = TOE_OFF + 0.5 - 0.5; // 0.46 in leg-local time
  const d = local - swingStartLocal;
  if (d < 0 || d > swingDur) return 0;
  const u = d / swingDur;
  // Asymmetric arc: fast rise, slower fall.
  const arc = Math.sin(Math.PI * Math.pow(u, 0.82));
  void swingStart;
  return lift * arc;
}

/**
 * Ankle pitch (rotation about X) for one leg.
 *
 * Sign convention, verified against the rig: a *positive* X rotation at the ankle drives the toe
 * **down** and lifts the heel; a negative rotation dorsiflexes the foot so the toe points up. The
 * schedule is:
 *
 *   - before heel strike  the foot is dorsiflexed (toe up), reaching for the ground
 *   - heel strike         the heel touches down; the foot rolls forward onto the sole
 *   - mid-stance          the foot is flat and the body passes over it
 *   - toe-off             the heel lifts and the foot pivots onto the ball of the foot
 *   - swing               the toe stays down briefly, then levels out for the next strike
 *
 * The heel-up / toe-down pivot at toe-off is the detail that most separates a believable walk from a
 * slide, so the extremes here are deliberately far apart.
 */
export function anklePitch(t: number, side: number): number {
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  const strike = HEEL_STRIKE;
  const off = TOE_OFF;

  const toeUp = -0.30; // dorsiflexed: heel forward, toe raised
  const flat = 0.0;
  const toeDown = 0.62; // plantar-flexed: heel up, weight over the toe

  if (p < strike) {
    // Just before heel strike the foot is dorsiflexed, and it was plantar-flexed during the push-off
    // that preceded it, so the curve runs from toe-down up to toe-up.
    const u = clamp(p / strike, 0, 1);
    return lerp(toeDown * 0.55, toeUp, u);
  }
  if (p < off) {
    // Stance. The foot rolls flat within the first fifth of stance, then the heel starts to rise.
    const u = (p - strike) / (off - strike);
    const settle = smoothstep(clamp(u / 0.2, 0, 1));
    const lift = smoothstep(clamp((u - 0.5) / 0.5, 0, 1));
    return lerp(lerp(toeUp, flat, settle), toeDown, lift);
  }
  // Swing: from toe-off through to the next heel strike.
  const u = (p - off) / (1 - off);
  const roll = smoothstep(clamp(u / 0.28, 0, 1));
  const level = smoothstep(clamp((u - 0.5) / 0.4, 0, 1));
  return lerp(lerp(toeDown, toeDown * 0.7, roll), toeUp, level);
}

/**
 * Toe (MTP joint) bend for one leg.
 *
 * The toe joint is what actually leaves the ground at toe-off; the ankle only rolls over it. Giving the
 * toe its own channel is what produces the correct "push off" and keeps the foot from bending through
 * the floor.
 */
export function toeBend(t: number, side: number): number {
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  const off = TOE_OFF;
  if (p < off) return 0.06;
  const u = (p - off) / (1 - off);
  // Bend hard right after toe-off, then release before the next heel strike.
  const bend = Math.sin(Math.PI * clamp(u / 0.72, 0, 1));
  return 0.06 + bend * 0.85;
}

/**
 * Thigh swing (rotation about X) for one leg.
 *
 * Positive X swings the leg forward. The curve is authored so the thigh is furthest back just before
 * heel strike (the "push-off" position), passes under the hip at mid-stance, and swings forward to
 * furthest-forward just before the next strike.
 */
export function thighSwing(t: number, side: number): number {
  const k: Keys = [-0.30, 0.02, 0.46, 0.12];
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  // The curve keys are defined in leg-local time where 0 = heel strike.
  return sampleKeys(k, p);
}

/** Knee bend (positive bends the shin backwards) for one leg. */
export function kneeBend(t: number, side: number): number {
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  // The knee is nearly straight at heel strike, flexes through mid-stance, and flexes hard in swing.
  const stanceFlex = Math.sin(Math.PI * clamp((p - 0.06) / 0.46, 0, 1)) * 0.22;
  const swingFlex = Math.sin(Math.PI * clamp((p - TOE_OFF) / (1 - TOE_OFF), 0, 1)) * 1.05;
  return stanceFlex + swingFlex;
}

/**
 * Horizontal hip travel for one side, in metres relative to the body's centre.
 *
 * During stance the planted foot is stationary in world space while the body moves over it, so the hip
 * must travel backwards relative to the body. During swing the leg catches up and passes forward. This
 * relative-travel function is what makes the feet plant instead of slide.
 */
export function hipTravel(t: number, side: number): number {
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  const stride = 0.34;
  if (p < STANCE) {
    // Stance: the body travels forward over the planted foot, so relative travel decreases.
    const u = p / STANCE;
    return lerp(stride / 2, -stride / 2, u);
  }
  // Swing: the leg swings forward to the next plant.
  const u = (p - STANCE) / (1 - STANCE);
  return lerp(-stride / 2, stride / 2, u);
}

/**
 * Vertical body bob, in metres.
 *
 * The body rises twice per cycle (once per step) and dips at mid-stance, when the leg is straightest
 * and the body is lowest. A real walk also has a small lateral sway, which is included via the `side`
 * parameter.
 */
export function bodyBob(t: number): number {
  // Two peaks per full cycle because each foot plants once.
  return -0.022 * (1 - Math.cos(t * TAU * 2)) * 0.5;
}

/** Lateral body sway, in metres. Peaks once per cycle, on the same side as mid-stance. */
export function bodySway(t: number): number {
  return 0.016 * Math.sin(t * TAU);
}

/**
 * Pelvic (hip) rotation about Y, in radians.
 *
 * Positive rotates the pelvis so the left hip moves forward. The pelvis rotates *opposite* to the chest,
 * which is the counter-rotation that makes a walk look alive.
 */
export function pelvisTwist(t: number): number {
  return 0.14 * Math.sin(t * TAU);
}

/** Chest rotation about Y, in radians. Opposite in sign to the pelvis. */
export function chestTwist(t: number): number {
  return -0.19 * Math.sin(t * TAU);
}

/** Shoulder (clavicle) rotation about Z, in radians. */
export function shoulderSwing(t: number, side: number): number {
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  // The arm swings opposite to the leg on the same side.
  return -0.16 * Math.sin(p * TAU);
}

/** Upper-arm swing about X, in radians. Opposite to the same-side leg. */
export function armSwing(t: number, side: number): number {
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  return 0.42 * Math.sin(p * TAU);
}

/** Elbow flexion, in radians. The elbow stays slightly bent while walking. */
export function elbowFlex(t: number, side: number): number {
  const p = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  return 0.34 + 0.16 * Math.sin(p * TAU + 1.1);
}

/** Mid-swing marker, exported for tests that assert the gait ordering. */
export const GAIT = {
  STANCE,
  HEEL_STRIKE,
  TOE_OFF,
  MID_SWING,
  strideLength: STRIDE_LENGTH,
} as const;
