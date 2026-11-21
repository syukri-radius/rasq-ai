/**
 * Foot trajectory planning and two-bone IK for the RASQ-Ai bot avatar.
 *
 * Why IK instead of keyframed joint angles:
 *
 * A forward-kinematic walk cycle rotates the thigh and knee to *angles*, and whatever position the foot
 * lands in is an emergent consequence. That consequence is almost never right: the foot ends up too high,
 * too low, or sliding backwards, because nothing in the system knows where the ground is. The result is
 * the classic "skating" look.
 *
 * Solving it the other way round — decide where the foot *should be* in world space, then ask the leg to
 * put it there — is how real animation rigs work, and it is what makes the walk read as a walk:
 *
 *   - During stance the foot is **pinned to the ground**. It does not move at all in world space while
 *     the body travels over it. This alone removes all sliding.
 *   - During swing the foot follows a **lifted arc** from the push-off position to the next plant.
 *
 * The leg is then solved with the standard two-bone IK: given the hip position, the ankle target, and the
 * thigh and shin lengths, find the thigh and knee angles that reach the target. There are two solutions
 * (knee forward or knee backward); the human knee only bends backward, so the backward solution is used.
 */

import { BONE_INDEX } from "./skeleton";
import { REST_BEND_RADIANS, REST_THIGH_TILT } from "./geometry";
import { ANKLE_Y, PROPORTIONS, STRIDE_LENGTH, footDepth, type FootSilhouette } from "./geometry";
import { clamp, lerp, smoothstep, TAU, type Vec3 } from "./math";
import { GAIT } from "./walk";

/**
 * The foot geometry's key dimensions, in metres, measured from the ankle joint.
 *
 * These are read from the shoe mesh so the trajectory planner and the geometry can never disagree about
 * where the foot's ends are. A mismatch here is what makes a character clip through the floor.
 */
export const FOOT_TOE_REACH = 0.175; // distance from the ankle to the tip of the toe
export const FOOT_HEEL_REACH = 0.055; // distance from the ankle to the back of the heel
export const FOOT_SOLE_DROP = 0.075; // distance from the ankle down to the sole
/** Distance from the ankle to the toe joint's pivot. */
export const FOOT_TOE_PIVOT = 0.135;
/** How much the sole rises at the toe joint when the toe folds under. */
export const FOOT_TOE_RISE = 0.012;

/** The world-space path of one foot through the gait cycle. */
export type FootPlan = {
  /** Ankle position in world space. */
  position: Vec3;
  /** Ankle pitch in radians (positive drives the toe down). */
  pitch: number;
  /** Toe joint bend in radians. */
  toe: number;
  /** True while the foot is planted. */
  planted: boolean;
};

/**
 * Computes the world-space trajectory of one foot for a given gait phase and body travel.
 *
 * @param phase    Gait phase in [0, 1). 0 is the left foot's heel strike.
 * @param side     -1 for the left leg, +1 for the right leg.
 * @param bodyX    The body's world position along the walk direction.
 * @param bodyY    The body's world height (the hip bob and any terrain offset).
 * @param silhouette  The measured foot geometry, used to work out how deep the foot hangs.
 * @param legAngle  The world rotation of the leg's chain about Z. The foot inherits it, so a leg swung
 *                   forward tips the shoe and changes how deep it hangs. The rig solves the IK first and
 *                   then re-plans with the angle it got, so the sole really does sit on the ground.
 * @param bodyPitch The hips' forward lean about X. The body leans into the walk and the feet go with it.
 * @param bodyYaw   The pelvis's twist about Y. The feet twist with the hips.
 */
export function planFoot(
  phase: number,
  side: number,
  bodyX: number,
  bodyY: number,
  silhouette?: FootSilhouette,
  legAngle = 0,
  bodyPitch = 0,
  bodyYaw = 0,
): FootPlan {
  const p = (((phase + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;

  const stride = STRIDE_LENGTH;
  const stance = GAIT.STANCE;
  const strike = GAIT.HEEL_STRIKE;
  const off = GAIT.TOE_OFF;

  // The pitch schedule, evaluated first because the ankle's position depends on it.
  //
  // Sign convention: positive pitch drives the toe down and lifts the heel.
  const toeUp = -0.3;
  const flat = 0;
  const toeDown = 0.62;
  let pitch: number;
  if (p < strike) {
    pitch = lerp(toeDown * 0.55, toeUp, clamp(p / strike, 0, 1));
  } else if (p < off) {
    // Stance. The foot rolls flat within the first fifth of stance, then the heel starts to rise.
    const u = (p - strike) / (off - strike);
    const settle = smoothstep(clamp(u / 0.2, 0, 1));
    const liftHeel = smoothstep(clamp((u - 0.5) / 0.5, 0, 1));
    pitch = lerp(lerp(toeUp, flat, settle), toeDown, liftHeel);
  } else {
    // Swing: from toe-off through to the next heel strike.
    const u = (p - off) / (1 - off);
    const roll = smoothstep(clamp(u / 0.28, 0, 1));
    const level = smoothstep(clamp((u - 0.5) / 0.4, 0, 1));
    pitch = lerp(lerp(toeDown, toeDown * 0.7, roll), toeUp, level);
  }

  // The toe joint bends only after toe-off, and only while the foot is off the ground.
  let toe = 0.06;
  if (p >= off) {
    const u = (p - off) / (1 - off);
    toe = 0.06 + Math.sin(Math.PI * clamp(u / 0.72, 0, 1)) * 0.85;
  }

  // The sole's horizontal position relative to the *body centre*.
  //
  // In stance the foot is fixed in the world while the body moves over it, so relative to the body the
  // foot travels backwards by exactly the amount the body advances. In swing the foot swings forward to
  // the next plant.
  let relX: number;
  if (p < stance) {
    const u = p / stance;
    relX = lerp(stride / 2, -stride / 2, u);
  } else {
    const u = (p - stance) / (1 - stance);
    relX = lerp(-stride / 2, stride / 2, u);
  }

  // The sole's height above the ground. The sole stays on the ground through stance; during swing it
  // follows a shaped arc that lifts the foot quickly and lands it softly.
  const lift = 0.085;
  let soleY = 0;
  if (p >= stance) {
    const u = (p - stance) / (1 - stance);
    // The arc peaks just after mid-swing and is asymmetric: quick lift, softer landing.
    const arc = Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), 0.85));
    soleY = lift * arc;
  }

  // The ankle's position, derived from the foot geometry.
  //
  // The foot pivots about the ankle, so the sole swings underneath it. Two things must hold at once:
  //
  //   1. the sole must not sink below the ground, and
  //   2. the sole must actually touch the ground while the foot is planted.
  //
  // Both follow from the same relation: a point of the foot at distance `d` forward of the ankle and
  // `h` below it sits at height `ankleY - d*sin(pitch) - h*cos(pitch)` once the foot is pitched. The
  // lowest point of the foot is the toe when the foot is pitched toe-down and the heel when it is
  // pitched toe-up, so the ankle has to rise to compensate for whichever end is lower.
  //
  // Solving for the ankle's height this way is what keeps the sole exactly on the floor at every phase
  // instead of hovering above it or clipping through it.
  // The depth of the foot below the ankle, measured from the actual shoe vertices so the planner and the
  // geometry can never disagree.
  const lowestDrop = silhouette ? footDepth(silhouette, pitch, toe, legAngle, bodyPitch, bodyYaw) : ANKLE_Y;

  // The ankle must sit at least `lowestDrop` above the ground for the sole not to sink below it.
  const ankleY = Math.max(soleY + lowestDrop, ANKLE_Y * 0.35);

  // The ankle's horizontal position: the sole's contact point is what the gait schedules, and the ankle
  // sits `heelReach` behind the ball of the foot.
  //
  // The ankle pitches about X, which rolls the foot in the Y/Z plane and leaves its horizontal position
  // unchanged. The toe's forward offset therefore stays put; only the ankle's height moves with the roll.
  //
  // Each leg's foot travels around *its own* hip, which is offset to the side of the body centre.
  const soleX = bodyX + side * PROPORTIONS.hipX + relX;
  const ankleX = soleX - FOOT_HEEL_REACH;

  return { position: [ankleX, ankleY + bodyY, 0], pitch, toe, planted: p < stance };
}

/**
 * Solves a two-bone IK problem in a plane.
 *
 * The chain is: a root joint (the hip), a middle joint (the knee) at distance `l1`, and an end effector
 * (the ankle) at distance `l2` from the knee.
 *
 * The chain is described by its two **segment angles**, measured from straight down, which is how the rig
 * stores it:
 *
 *   - `angle1` is the direction of the thigh (hip to knee).
 *   - `angle2` is the direction of the shin (knee to ankle), also measured from straight down.
 *
 * Both are absolute, and the solver returns the pair that puts the ankle on the target. The rig stores
 * them as deltas from the rest pose, which it can compute because it knows the rest angles.
 *
 * The knee is constrained to bend backward, the way a human knee does, which picks one of the two mirror
 * solutions and removes the pop a naive solver produces when the target crosses the chain's reach.
 */
export type TwoBoneSolution = {
  /** The thigh's absolute direction from straight down. Positive swings the leg forward. */
  rootAngle: number;
  /** The shin's absolute direction from straight down. */
  middleAngle: number;
  /** True when the target is out of reach and the chain was extended fully. */
  clamped: boolean;
};

/**
 * Solves the leg chain.
 *
 * `rootX`/`rootY` are the hip's world position, `targetX`/`targetY` the desired ankle position. The leg
 * lies in the X/Y plane (the character walks along X, the ground is Y), so the problem reduces to 2D.
 *
 * The solver returns the two segment directions in absolute terms — the angle of the thigh and the angle
 * of the shin, both measured from straight down. The caller converts them into the rig's channels, which
 * are deltas from the rest pose.
 */
export function solveLegIK(
  rootX: number,
  rootY: number,
  targetX: number,
  targetY: number,
  l1: number,
  l2: number,
): TwoBoneSolution {
  const dx = targetX - rootX;
  const dy = targetY - rootY;
  let dist = Math.hypot(dx, dy);

  // The chain's reach. The upper limit is a hair under `l1 + l2` so a fully straight leg is still
  // representable without the trigonometric terms exploding.
  const maxReach = (l1 + l2) * 0.9999;
  const minReach = Math.abs(l1 - l2) * 1.001 + 1e-4;
  let clamped = false;
  if (dist > maxReach) {
    dist = maxReach;
    clamped = true;
  } else if (dist < minReach) {
    dist = minReach;
    clamped = true;
  }

  // The angle at the hip between the thigh and the line to the target.
  const cosRoot = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const alpha = Math.acos(cosRoot);

  // The interior angle at the knee, where PI means a perfectly straight leg (law of cosines):
  //   dist^2 = l1^2 + l2^2 - 2*l1*l2*cos(interior)
  const cosKnee = clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1);
  const kneeInterior = Math.acos(cosKnee);
  const bend = Math.PI - kneeInterior;

  // The direction from the hip to the target, measured from straight down. A positive angle points
  // towards +X, which is the walking direction.
  const dir = Math.atan2(dx, -dy);

  // The thigh's direction. The knee bends *backward*, so the thigh leads the target line by `alpha` and
  // the shin trails it by the knee's bend.
  const angle1 = dir + alpha;
  // The shin's direction, trailing the thigh by the knee's bend.
  const angle2 = angle1 - bend;

  return {
    rootAngle: angle1,
    middleAngle: angle2,
    clamped,
  };
}

/**
 * The lengths of the leg chain, in metres.
 *
 * Read from the proportions so the IK solver and the geometry can never disagree about bone lengths.
 */
export const LEG_LENGTHS = {
  thigh: PROPORTIONS.thighLen,
  shin: PROPORTIONS.shinLen,
  /** The ankle sits this far below the knee joint. */
  ankleDrop: ANKLE_Y,
} as const;

/**
 * Converts a world-space foot plan into the thigh and knee angles that achieve it.
 *
 * The ankle joint is at `ankleY` above the ground, and the shin ends at the ankle, so the IK target for
 * the knee chain is the ankle position itself.
 */
export function solveFoot(
  hipX: number,
  hipY: number,
  plan: FootPlan,
): TwoBoneSolution {
  // The rig's chain does not start straight down: the thigh rests tilted forward by `REST_LEG.thighAngle`
  // and the knee bends back by `REST_LEG.kneeBend`. The solver's model starts straight down, so the two
  // are reconciled by measuring the target **relative to the rest chain** and solving for the rotation
  // that gets there.
  //
  // Concretely: the target is rotated into the frame where the chain hangs straight down, the closed-form
  // solution is applied there, and the result is rotated back. Because the rest chain's first segment is
  // a rigid rotation of a straight segment, that rotation is exactly the rest tilt.
  //
  // The rig's bind chain *is* the rest pose, so the frame the solver works in is the rig's own local
  // frame. The solved angles are therefore already deltas from the rest pose, and no rotation back is
  // needed.
  const tilt = REST_LEG.thighAngle;
  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);

  // The offset from the hip to the target, in world space.
  const dx = plan.position[0] - hipX;
  const dy = plan.position[1] - hipY;
  // Rotate into the straight-down frame. This is the world offset rotated by -tilt, which maps the
  // world's "down and forward by the rest tilt" direction onto the local frame's "straight down".
  const localX = dx * cosT + dy * sinT;
  const localY = -dx * sinT + dy * cosT;

  const sol = solveLegIK(0, 0, localX, localY, LEG_LENGTHS.thigh, LEG_LENGTHS.shin);

  // The solved directions are in the straight-down frame. The rig's rest pose has the thigh at the rest
  // tilt and the shin at the rest knee bend, so the world directions are the solved ones plus the rest
  // tilt, and the rig's channels are the differences from the rest pose:
  //
  //   thighChannel = (thigh direction in world) - restTilt
  //   shinChannel  = (shin direction in world) - (thigh direction in world) - restBend
  const world1 = sol.rootAngle + tilt;
  const world2 = sol.middleAngle + tilt;
  return {
    rootAngle: world1 - tilt,
    middleAngle: world2 - world1 - REST_LEG.kneeBend,
    clamped: sol.clamped,
  };
}

/**
 * The rest pose's leg geometry, expressed in the rig's frame.
 *
 * The IK solver reasons about an abstract chain — the hip, then a segment of `l1`, then a segment of
 * `l2` — but the rig's actual bones start from the rest pose's tilted offsets. These constants let the
 * solver's answer be converted into the rig's channels without the two disagreeing about where the
 * leg starts.
 */
export const REST_LEG = {
  /** The thigh's rest angle from straight down, in radians. */
  thighAngle: REST_THIGH_TILT,
  /** The knee's rest bend relative to the thigh, in radians. */
  kneeBend: REST_BEND_RADIANS,
  /** The hip's offset from the body's centre line. */
  hipX: PROPORTIONS.hipX,
};

export { BONE_INDEX, TAU };
