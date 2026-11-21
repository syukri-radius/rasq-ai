/**
 * The rig: turns an animation state into the bone matrices the skinning pass consumes.
 *
 * Responsibilities, in order:
 *
 *  1. Evaluate the walk cycle and the talk state for the current time.
 *  2. Write the result into a flat channel buffer (`Float32Array`, 3 channels per bone).
 *  3. Compose the channel buffer into 24 world-space bone matrices.
 *
 * The composition is a straightforward hierarchical transform: a bone's world matrix is
 * `parentWorld * translate(offset) * rotate(localEuler)`. Everything the animator needs is expressed in
 * bone-local space, so the hierarchy does the rest.
 *
 * There is no per-vertex skinning blending: each vertex belongs to exactly one bone, so the skinning pass
 * is one matrix transform per vertex. That is a deliberate trade — see `geometry.ts` for why.
 */

import { PROPORTIONS, STRIDE_LENGTH, buildBotMesh, measureFootSilhouette, type FootSilhouette, type Mesh } from "./geometry";
import {
  BONE_COUNT, BONE_INDEX, BONES, REST_KNEE_BEND, createPoseChannels, resetPoseToRest,
} from "./skeleton";
import {
  bodyBob, bodySway, armSwing, chestTwist, elbowFlex, pelvisTwist, shoulderSwing,
} from "./walk";
import { planFoot, solveFoot, REST_LEG } from "./footpath";
import { evaluateTalk, type TalkState, type TalkTrack } from "./talk";
import { clamp, lerp, mat4, mat4FromEuler, mat4Mul, mat4Translation, TAU } from "./math";

/** The full animation state the rig consumes. */
export type RigState = {
  /** Gait phase in [0, 1). */
  phase: number;
  /** How strongly the walk cycle is applied, 0 = standing still, 1 = full stride. */
  walkWeight: number;
  /** Head yaw (turn), in radians. */
  headYaw: number;
  /** Head pitch (nod), in radians. */
  headPitch: number;
  /** Extra vertical body offset, in metres. */
  bodyLift: number;
  /** Forward lean of the whole body, in radians. */
  lean: number;
  /** Whether the mouth should be talking. */
  talking: boolean;
  /** How strongly the mouth moves, 0..1. */
  talkWeight: number;
  /**
   * The body's world position along the walk direction, in metres.
   *
   * The feet are placed against this, so it must advance with the gait or the feet will skate.
   */
  travelX: number;
  /** How fast the body is travelling, in metres per second. */
  speed: number;
  /** The current vertical body bob, in metres. Applied to the root so the whole body rises and falls. */
  bob: number;
};

export function createRigState(): RigState {
  return {
    phase: 0,
    walkWeight: 0,
    headYaw: 0,
    headPitch: 0,
    bodyLift: 0,
    lean: 0,
    talking: false,
    talkWeight: 0,
    travelX: 0,
    speed: 0,
    bob: 0,
  };
}

/** A rig holds the animated bone matrices and reuses them across frames. */
export type Rig = {
  /** World-space bone matrices, 16 floats each. */
  matrices: Float32Array;
  /** Inverse-bind matrices, 16 floats each. Used to move bind-space vertices into bone space. */
  inverseBind: Float32Array;
  /** The channel buffer the animation writes into. */
  channels: Float32Array;
  /** Smoothed state, updated by `updateRig`. */
  state: RigState;
  /** Talk state, updated by `updateRig`. */
  talk: TalkState;
  /**
   * The foot silhouettes, measured from the mesh.
   *
   * The trajectory planner uses these to keep the sole exactly on the ground at every phase of the gait.
   * They are attached to the rig rather than the planner so the measurement happens once, not per frame.
   */
  feet: { left: FootSilhouette; right: FootSilhouette };
};

/**
 * Creates a rig.
 *
 * The mesh is optional only so a caller can supply a pre-built one; the rig always needs the foot
 * silhouettes, because the trajectory planner measures how deep the foot hangs from them. Without them
 * the planner falls back to a nominal ankle height, which puts the feet roughly a centimetre off the
 * ground and lets the swing foot clip the floor.
 */
export function createRig(mesh?: Mesh): Rig {
  const matrices = new Float32Array(BONE_COUNT * 16);
  const inverseBind = new Float32Array(BONE_COUNT * 16);
  const channels = createPoseChannels();
  resetPoseToRest(channels);

  // The inverse bind matrices are the inverse of each bone's rest world matrix.
  const rest = new Float32Array(BONE_COUNT * 16);
  computeBindMatrices(rest);
  for (let i = 0; i < BONE_COUNT; i++) {
    inverseBind.set(invertRigid(rest, i), i * 16);
  }

  // The foot silhouettes are measured from the mesh. The mesh is procedural and cheap to build, so one
  // is made when the caller does not supply it.
  const source = mesh ?? buildBotMesh();
  const feet = {
    left: measureFootSilhouette(source, -1),
    right: measureFootSilhouette(source, 1),
  };

  return {
    matrices,
    inverseBind,
    channels,
    state: createRigState(),
    talk: evaluateTalk({ events: [], duration: 0, stresses: [] }, 0, {
      jaw: 0, width: 1, lip: 0, energy: 0, nod: 0, yaw: 0, brow: 0, breath: 0,
    }),
    feet,
  };
}

/**
 * Computes the rest-pose world matrices for every bone.
 *
 * A rest bone matrix is `parent * translate(offset) * restEuler`. Because the rest pose is built from
 * offsets alone, this is a rigid transform, which lets us invert it with a cheap transpose-and-translate
 * instead of a general 4x4 inverse.
 */
function computeBindMatrices(out: Float32Array): void {
  const tmp = mat4();
  const local = mat4();
  for (let i = 0; i < BONE_COUNT; i++) {
    const b = BONES[i];
    const t = mat4Translation(b.offset);
    const r = mat4FromEuler(b.restEuler[0], b.restEuler[1], b.restEuler[2]);
    mat4Mul(t, r, local);
    if (b.parent < 0) out.set(local, i * 16);
    else {
      mat4Mul(out.subarray(b.parent * 16, b.parent * 16 + 16), local, tmp);
      out.set(tmp, i * 16);
    }
  }
}

/**
 * Inverts a rigid (rotation + translation) matrix.
 *
 * The inverse of `R|t` is `Rᵀ | -Rᵀt`. Every rest matrix is rigid, so this is exact and much cheaper
 * than a general matrix inverse.
 */
function invertRigid(m: Float32Array, _index: number): Float32Array {
  const out = new Float32Array(16);
  out[0] = m[0]; out[1] = m[4]; out[2] = m[8]; out[3] = 0;
  out[4] = m[1]; out[5] = m[5]; out[6] = m[9]; out[7] = 0;
  out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = 0;
  const tx = m[12], ty = m[13], tz = m[14];
  out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
  out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
  out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
  out[15] = 1;
  return out;
}

/* ------------------------------------------------------------------ animation authoring */

/**
 * Writes the walk cycle and the talk state into the channel buffer.
 *
 * Each channel is a *blend* between the rest pose and the animated pose, weighted by `walkWeight` for the
 * locomotion channels and by `talkWeight` for the face channels. That means a walking bot that is also
 * talking does both, and a standing bot that is talking only moves the face.
 */
function authorChannels(rig: Rig, dt: number, talkTrack: TalkTrack | null, talkTime: number): void {
  const s = rig.state;
  const ch = rig.channels;
  resetPoseToRest(ch);

  const w = clamp(s.walkWeight, 0, 1);
  const t = s.phase;

  if (w > 0.001) {
    // --- body ---
    const bob = bodyBob(t) * w;
    const sway = bodySway(t) * w;
    // The bob lives on the root, so it carries the whole body rather than only the hips.
    s.bob = bob;

    // Hips: vertical bob + lateral sway + pelvic twist.
    const hips = BONE_INDEX.hips;
    ch[hips * 3 + 0] += 0.02 * w; // slight forward lean while moving
    ch[hips * 3 + 1] += pelvisTwist(t) * w;
    ch[hips * 3 + 2] += (sway / 0.5) * 0.05 * w;

    // Spine: a gentle S-curve. The chest counter-rotates the pelvis.
    const spineLow = BONE_INDEX.spineLow;
    const spineUp = BONE_INDEX.spineUp;
    const chest = BONE_INDEX.chest;
    ch[spineLow * 3 + 1] += pelvisTwist(t) * 0.25 * w;
    ch[spineUp * 3 + 1] += chestTwist(t) * 0.55 * w;
    ch[chest * 3 + 1] += chestTwist(t) * 0.75 * w;
    // Side bend: the torso leans toward the planted foot.
    ch[spineLow * 3 + 2] += (sway / 0.5) * 0.035 * w;
    ch[spineUp * 3 + 2] += (sway / 0.5) * 0.03 * w;

    // Head: counter-rotate against the chest so the gaze stays stable.
    //
    // The chest twists by `chestTwist`; the neck and head must undo *part* of that twist so the head
    // ends up facing the direction it did at the start of the stride rather than following the torso
    // around. The neck absorbs some of it and the head the rest, which is how a real neck behaves.
    const head = BONE_INDEX.head;
    const neck = BONE_INDEX.neck;
    ch[neck * 3 + 1] -= chestTwist(t) * 0.3 * w;
    ch[head * 3 + 1] -= chestTwist(t) * 0.25 * w;
    ch[head * 3 + 0] += s.headPitch;
    ch[head * 3 + 1] += s.headYaw;
    // Head bob rides the body's vertical oscillation.
    ch[head * 3 + 0] += (bob / 0.3) * 0.09 * w;

    // --- arms ---
    // Same axis convention as the legs: the arm swings forward and back about **Z**, and the elbow
    // flexes about **Z** as well. The shoulder shrug is about **X**.
    for (const side of [-1, 1] as const) {
      const sh = side < 0 ? BONE_INDEX.shoulderL : BONE_INDEX.shoulderR;
      const ua = side < 0 ? BONE_INDEX.upperArmL : BONE_INDEX.upperArmR;
      const fa = side < 0 ? BONE_INDEX.foreArmL : BONE_INDEX.foreArmR;
      const hd = side < 0 ? BONE_INDEX.handL : BONE_INDEX.handR;

      ch[sh * 3 + 0] += shoulderSwing(t, side) * w;
      ch[ua * 3 + 2] += armSwing(t, side) * w;
      ch[fa * 3 + 2] += elbowFlex(t, side) * w;
      // The hand counter-rotates slightly, which stops the arm reading as a single rigid stick.
      ch[hd * 3 + 2] += -0.1 * w;
    }

    // --- global lean ---
    //
    // The lean is applied before the legs are planned, because the feet hang off the body: a body that
    // leans forward tips the shoes, and the planner has to know that to keep the soles on the ground.
    ch[BONE_INDEX.hips * 3 + 0] += s.lean;
    const bodyPitch = ch[BONE_INDEX.hips * 3 + 0];
    const bodyYaw = ch[BONE_INDEX.hips * 3 + 1];

    // --- legs (IK) ---
    // The foot is planned in world space first, then the leg is solved to reach it. Doing it in this
    // order is what removes foot sliding: the planted foot has a fixed world position, and the leg
    // angles are whatever it takes to put the foot there.
    //
    // Axis note: the character is built facing -Z and walks along X, so the leg's sagittal plane is
    // XY. Forward swing and knee bend are therefore rotations about **Z**, while the ankle's
    // pitch (the foot rolling onto its toe) is a rotation about **X**. Mixing these up produces a
    // character that shuffles sideways instead of walking.
    //
    // The knee channel is written as an *absolute* value: the solver's answer replaces the rest bend
    // rather than adding to it, otherwise the knee would accumulate bend every frame.
    const hipY = PROPORTIONS.hipY + s.bob + s.bodyLift;
    for (const side of [-1, 1] as const) {
      const th = side < 0 ? BONE_INDEX.thighL : BONE_INDEX.thighR;
      const sh2 = side < 0 ? BONE_INDEX.shinL : BONE_INDEX.shinR;
      const ft = side < 0 ? BONE_INDEX.footL : BONE_INDEX.footR;
      const toe = side < 0 ? BONE_INDEX.toeL : BONE_INDEX.toeR;

      // The plan and the IK both work in world space: `planFoot` is given the body's world position and
      // the hip's world position is derived from it. Solving in world space keeps the two in the same
      // frame, so the solver's answer is the angle that actually puts the foot where it was planned.
      //
      // The plan is made twice, because how deep the foot hangs depends on how the leg is swung: the
      // foot bone inherits the leg's rotation, so a leg swung forward tips the shoe and its outer edge
      // dips lower. The first pass solves the IK with the leg roughly vertical, the second re-plans
      // with the angle the solve produced, and the third re-solves. Two passes converge to well under a
      // millimetre, which is far below what the eye can pick up on a foot that is supposed to be
      // touching the ground.
      const silhouette = side < 0 ? rig.feet.left : rig.feet.right;
      const hipX = s.travelX + side * PROPORTIONS.hipX;
      let plan = planFoot(t, side, s.travelX, 0, silhouette, 0, bodyPitch, bodyYaw);
      let sol = solveFoot(hipX, hipY, plan);
      for (let pass = 0; pass < 3; pass++) {
        // The leg's world angle is the thigh's world angle plus the shin's rotation *relative to the
        // thigh*.
        //
        // The solver works in the frame where the rest thigh hangs straight down. That frame is the
        // world rotated by `-restTilt`, so a local angle becomes a world angle by adding the rest tilt.
        // The thigh's world angle is therefore `restTilt + rootAngle`, and the shin's is
        // `restTilt + rootAngle + restBend + middleAngle`, because the shin's channel is a delta from
        // the rest knee bend.
        const thighWorld = REST_LEG.thighAngle + sol.rootAngle;
        const legAngle = thighWorld + REST_LEG.kneeBend + sol.middleAngle;
        const next = planFoot(t, side, s.travelX, 0, silhouette, legAngle, bodyPitch, bodyYaw);
        const nextSol = solveFoot(hipX, hipY, next);
        plan = next;
        sol = nextSol;
      }

    // Both leg channels are *deltas from the rest pose*, which `resetPoseToRest` has already written
    // into the channel buffer. The solver returns how far each segment must rotate away from the rest
    // angle, so the deltas are added on top of the rest pose rather than replacing it.
    //
    // The thigh's delta is measured from the rest tilt and the shin's from the rest knee bend, which is
    // exactly how the solver frames its answer.
    ch[th * 3 + 2] += sol.rootAngle * w;
    ch[sh2 * 3 + 2] += sol.middleAngle * w;
    ch[ft * 3 + 0] += plan.pitch * w;
    ch[toe * 3 + 0] += plan.toe * w;
    }
  } else {
    // Idle: a slow breathing rise/fall and a gentle weight shift, so a standing bot is never statue-still.
    s.bob = 0;
    const idle = Math.sin(rig.state.phase * TAU);
    const spine = BONE_INDEX.spineUp;
    ch[spine * 3 + 0] += 0.012 * idle;
    ch[BONE_INDEX.chest * 3 + 0] += 0.018 * idle;
    ch[BONE_INDEX.head * 3 + 1] += s.headYaw;
    ch[BONE_INDEX.head * 3 + 0] += s.headPitch;
  }

  // --- talk ---
  if (talkTrack && s.talking) {
    const talk = evaluateTalk(talkTrack, talkTime, rig.talk);
    const tw = clamp(s.talkWeight, 0, 1);
    const jaw = BONE_INDEX.jaw;
    // Jaw opens around the mouth's hinge, which sits just behind the ears.
    ch[jaw * 3 + 0] += talk.jaw * 0.42 * tw;
    ch[jaw * 3 + 2] += (talk.width - 1) * 0.1 * tw;

    // The head nods on stress and drifts slightly, which is what sells speech as speech.
    const head = BONE_INDEX.head;
    const neck = BONE_INDEX.neck;
    ch[head * 3 + 0] += talk.nod * tw;
    ch[head * 3 + 1] += talk.yaw * tw;
    ch[neck * 3 + 0] += talk.nod * 0.35 * tw;
    // The brow lifts with emphasis.
    ch[head * 3 + 2] += talk.brow * 0.05 * tw;
    // The chest moves with the breath.
    ch[BONE_INDEX.chest * 3 + 0] += Math.sin(talk.breath * TAU) * 0.02 * tw;
  }

}

/**
 * Composes the channel buffer into world-space bone matrices.
 *
 * The root bone carries the body's world translation, so the whole avatar moves as one unit while the
 * joints articulate underneath it.
 */
function composeMatrices(rig: Rig): void {
  const ch = rig.channels;
  const out = rig.matrices;
  const local = mat4();
  const tmp = mat4();
  const t = mat4();
  const r = mat4();
  const s = rig.state;

  for (let i = 0; i < BONE_COUNT; i++) {
    const b = BONES[i];
    // The local transform is `translate * rotate`.
    //
    // The bone's origin sits at `offset` in its parent's frame, and the rotation is applied about that
    // origin. Composing the other way round would rotate the offset by the bone's own rotation, which
    // double-counts the rest pose's angles and throws the leg's rest position out by centimetres.
    mat4Translation(b.offset, t);
    mat4FromEuler(ch[i * 3 + 0], ch[i * 3 + 1], ch[i * 3 + 2], r);
    mat4Mul(t, r, local);
    if (b.parent < 0) {
      // The root's own offset is zero; the world translation is applied on top of it.
      //
      // The vertical translation carries the body bob and any terrain lift, so the hips really do rise
      // and fall. The IK solver uses the same value, so the plan and the skeleton stay in step.
      out[12] = local[12] + s.travelX;
      out[13] = local[13] + s.bodyLift + s.bob;
      out[14] = local[14];
      out.set(local.subarray(0, 12), 0);
      out[15] = 1;
    } else {
      mat4Mul(out.subarray(b.parent * 16, b.parent * 16 + 16), local, tmp);
      out.set(tmp, i * 16);
    }
  }
}

/**
 * Advances the rig by `dt` seconds and recomputes the bone matrices.
 *
 * `talkTrack` is optional; when supplied the face is driven from it. The track's own clock is advanced
 * here so the caller only has to manage *when* a track starts.
 */
export function updateRig(rig: Rig, dt: number, talkTrack: TalkTrack | null, talkTime: number): void {
  const s = rig.state;

  // Advance the gait phase from the walk weight. The cadence scales with how fast the character is
  // moving, so slowing down slows the steps proportionally.
  const cadence = 0.62 * (0.55 + s.walkWeight * 0.75); // cycles per second
  s.phase = (s.phase + dt * cadence) % 1;

  // The body travels one stride length per cycle. This is what the foot planner places the feet
  // against, so the two must agree exactly or the feet will slide.
  const stridePerCycle = STRIDE_LENGTH;
  s.travelX += dt * cadence * stridePerCycle;
  s.speed = cadence * stridePerCycle;

  authorChannels(rig, dt, talkTrack, talkTime);
  composeMatrices(rig);
}

/**
 * World-space position of a bone's joint, in metres. Used to place the camera, the shadow catcher and
 * the IK targets.
 */
export function bonePosition(rig: Rig, bone: number): [number, number, number] {
  const m = rig.matrices;
  const o = bone * 16;
  return [m[o + 12], m[o + 13], m[o + 14]];
}

/**
 * The vertical offset applied to the whole body for the current gait phase.
 *
 * Exposed so the renderer can keep the character on the ground plane: the rig's hips rise and fall, and
 * without this the character would appear to sink into the floor.
 */
export function currentBodyBob(rig: Rig): number {
  return bodyBob(rig.state.phase) * clamp(rig.state.walkWeight, 0, 1);
}

export { lerp };
