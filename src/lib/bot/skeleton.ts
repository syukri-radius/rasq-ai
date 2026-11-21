/**
 * Skeleton definition for the RASQ-Ai bot avatar.
 *
 * The rig is a plain hierarchy of bones with three rotation channels each (X = bend, Y = twist, Z = swing).
 * Rotation is applied *relative to the parent*, so a bone's local frame is the parent's frame translated to
 * the joint position. That keeps the animation maths simple and, more importantly, makes the rotations
 * compositional: rotating the hips moves the whole upper body, and the walk cycle's counter-rotation of
 * the chest against the hips comes for free.
 *
 * Bind positions are the rest-pose world positions of each joint, expressed in metres.
 */

import { ANKLE_Y, PROPORTIONS, REST_BEND_RADIANS, REST_THIGH_TILT, TOE_PIVOT_Z } from "./geometry";
import type { Vec3 } from "./math";

export const BONE_ORDER = [
  "root", "hips", "spineLow", "spineUp", "chest", "neck", "head", "jaw",
  "shoulderL", "upperArmL", "foreArmL", "handL",
  "shoulderR", "upperArmR", "foreArmR", "handR",
  "thighL", "shinL", "footL", "toeL",
  "thighR", "shinR", "footR", "toeR",
] as const;

export type BoneName = (typeof BONE_ORDER)[number];

export type Bone = {
  name: BoneName;
  /** Index of the parent bone. -1 for the root. */
  parent: number;
  /** Rest position of the joint, in bind space (world metres). */
  bind: Vec3;
  /** Offset from the parent joint to this joint, in the parent's local frame. */
  offset: Vec3;
  /**
   * Rest orientation of the bone relative to its parent, as an XYZ Euler triple.
   *
   * Almost all bones rest at zero; the exceptions are the ones that must point down the limb axis rather
   * than up it (arms and legs hang along -Y, so their local "forward" is rotated 180 degrees about X).
   * Encoding that in the rest pose means the animation channels can stay intuitive: "knee bend" is a
   * positive rotation about X, not "bend by 180 minus something".
   */
  restEuler: [number, number, number];
};

const P = PROPORTIONS;

/**
 * The rest-pose knee bend, taken from the geometry module.
 *
 * The geometry owns this number because it also determines where the ankle sits and how much reach the
 * IK solver has. Re-exporting it here keeps the skeleton's vocabulary intact and guarantees the rig and
 * the geometry can never disagree about how bent the knee rests.
 */
export const REST_KNEE_BEND = REST_BEND_RADIANS;

/**
 * The rest world position of the ankle, in the posed rest pose.
 *
 * This differs from the straight-chain bind position: the thigh tilts forward and the knee bends back,
 * which puts the ankle directly under the hip but slightly higher than a straight leg would reach.
 * The shoe geometry is built against this value.
 */
export const REST_ANKLE_POSITION = (() => {
  const l1 = P.thighLen;
  const l2 = P.shinLen;
  const thighAngle = REST_THIGH_TILT;
  const shinAngle = thighAngle + REST_BEND_RADIANS;
  return {
    x: l1 * Math.sin(thighAngle) + l2 * Math.sin(shinAngle),
    y: P.hipY - l1 * Math.cos(thighAngle) - l2 * Math.cos(shinAngle),
  };
})();

/**
 * The joint positions of the leg chain in the **rest pose**, in bind space.
 *
 * The rest pose has the thigh leaning forward and the knee bent back, so the ankle ends up directly
 * under the hip.
 *
 * The bind chain *is* the rest pose: the leg bones' rest rotations are zero and the rest pose is
 * encoded in the offsets. That keeps the geometry and the IK solver in agreement — the solver models
 * the chain as two segments hinged at the knee, and the rig models it as a chain whose first segment is
 * already tilted, so rotating the target by `-tilt` reconciles the two frames exactly.
 */
function legBindPositions(side: number) {
  const x = side * P.hipX;
  // The thigh and shin form a straight bind chain: each bone's offset is its own length straight down.
  // The rest pose's thigh tilt and knee bend live in the bones' rest rotations, which the rig composes
  // on top.
  const kneeY = P.hipY - P.thighLen;
  const ankleY = kneeY - P.shinLen;
  return { x, kneeX: x, kneeY, ankleX: x, ankleY };
}

function buildBones(): Bone[] {
  const legL = legBindPositions(-1);
  const legR = legBindPositions(1);

  const defs: Array<Omit<Bone, "offset"> & { offset?: Vec3 }> = [
    { name: "root", parent: -1, bind: [0, 0, 0], restEuler: [0, 0, 0] },

    { name: "hips", parent: 0, bind: [0, P.hipY, 0], restEuler: [0, 0, 0] },
    { name: "spineLow", parent: 1, bind: [0, P.spineLowY, 0], restEuler: [0, 0, 0] },
    { name: "spineUp", parent: 2, bind: [0, P.spineUpY, 0], restEuler: [0, 0, 0] },
    { name: "chest", parent: 3, bind: [0, P.chestY, 0], restEuler: [0, 0, 0] },
    { name: "neck", parent: 4, bind: [0, P.neckY, 0], restEuler: [0, 0, 0] },
    { name: "head", parent: 5, bind: [0, P.headY, 0], restEuler: [0, 0, 0] },
    { name: "jaw", parent: 6, bind: [0, P.jawY, 0], restEuler: [0, 0, 0] },

    // Arms. The shoulder sits at the outer edge of the chest; the arm bones are offset outward so the
    // capsule geometry (authored along -Y from the shoulder) lines up with the joint chain.
    { name: "shoulderL", parent: 4, bind: [-P.shoulderX, P.shoulderY, 0], restEuler: [0, 0, 0] },
    { name: "upperArmL", parent: 8, bind: [-P.shoulderX, P.shoulderY - P.upperArmLen, 0], restEuler: [0, 0, 0] },
    { name: "foreArmL", parent: 9, bind: [-P.shoulderX, P.shoulderY - P.upperArmLen - P.foreArmLen, 0], restEuler: [0, 0, 0] },
    { name: "handL", parent: 10, bind: [-P.shoulderX, P.shoulderY - P.upperArmLen - P.foreArmLen - P.handLen, 0], restEuler: [0, 0, 0] },

    { name: "shoulderR", parent: 4, bind: [P.shoulderX, P.shoulderY, 0], restEuler: [0, 0, 0] },
    { name: "upperArmR", parent: 12, bind: [P.shoulderX, P.shoulderY - P.upperArmLen, 0], restEuler: [0, 0, 0] },
    { name: "foreArmR", parent: 13, bind: [P.shoulderX, P.shoulderY - P.upperArmLen - P.foreArmLen, 0], restEuler: [0, 0, 0] },
    { name: "handR", parent: 14, bind: [P.shoulderX, P.shoulderY - P.upperArmLen - P.foreArmLen - P.handLen, 0], restEuler: [0, 0, 0] },

    // Legs. The knee bend is about Z, the same axis the leg swings on, because both live in the
    // character's sagittal plane.
    { name: "thighL", parent: 1, bind: [legL.x, P.hipY, 0], restEuler: [0, 0, REST_THIGH_TILT] },
    { name: "shinL", parent: 16, bind: [legL.kneeX, legL.kneeY, 0], restEuler: [0, 0, REST_BEND_RADIANS] },
    { name: "footL", parent: 17, bind: [legL.ankleX, legL.ankleY, 0], restEuler: [0, 0, 0] },
    { name: "toeL", parent: 18, bind: [legL.ankleX, legL.ankleY, TOE_PIVOT_Z], restEuler: [0, 0, 0] },

    { name: "thighR", parent: 1, bind: [legR.x, P.hipY, 0], restEuler: [0, 0, REST_THIGH_TILT] },
    { name: "shinR", parent: 20, bind: [legR.kneeX, legR.kneeY, 0], restEuler: [0, 0, REST_BEND_RADIANS] },
    { name: "footR", parent: 21, bind: [legR.ankleX, legR.ankleY, 0], restEuler: [0, 0, 0] },
    { name: "toeR", parent: 22, bind: [legR.ankleX, legR.ankleY, TOE_PIVOT_Z], restEuler: [0, 0, 0] },
  ];

  return defs.map((d) => {
    const parentBind = d.parent >= 0 ? defs[d.parent].bind : ([0, 0, 0] as Vec3);
    const offset: Vec3 = d.offset ?? [
      d.bind[0] - parentBind[0],
      d.bind[1] - parentBind[1],
      d.bind[2] - parentBind[2],
    ];
    return { name: d.name, parent: d.parent, bind: d.bind, offset, restEuler: d.restEuler };
  });
}

export const BONES: Bone[] = buildBones();

/** Fast lookup from bone name to index. */
export const BONE_INDEX: Record<BoneName, number> = BONE_ORDER.reduce((acc, n, i) => {
  acc[n] = i;
  return acc;
}, {} as Record<BoneName, number>);

/** Number of bones in the rig. */
export const BONE_COUNT = BONES.length;

/**
 * The three rotation channels for every bone, in radians, in the rest pose.
 *
 * Indexing is `boneIndex * 3 + channel`, where channel 0 = X (bend), 1 = Y (twist), 2 = Z (swing).
 */
export function createPoseChannels(): Float32Array {
  return new Float32Array(BONE_COUNT * 3);
}

/**
 * Reset a channel buffer to the rest pose.
 *
 * The rest pose is not all-zero: limbs that hang along -Y need their own frame, otherwise "rotate the
 * thigh by 0" would point the thigh straight up. Those are expressed as a 180-degree flip about X on the
 * limb bones, which keeps every animation channel expressed in intuitive local space.
 */
export function resetPoseToRest(ch: Float32Array): void {
  ch.fill(0);
  for (let i = 0; i < BONE_COUNT; i++) {
    const r = BONES[i].restEuler;
    ch[i * 3 + 0] = r[0];
    ch[i * 3 + 1] = r[1];
    ch[i * 3 + 2] = r[2];
  }
}
