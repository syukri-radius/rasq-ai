/**
 * Procedural humanoid geometry for the RASQ-Ai bot avatar.
 *
 * Design constraints (see ART_BUDGET below and docs/ART_BUDGET.md):
 *
 *  - The whole avatar is built from *tapered capsule segments* — a cylinder of `radial` sides capped by
 *    hemispherical-ish caps. This is the cheapest way to get smooth, organic-looking limbs: a capsule
 *    silhouette hides the low vertex count far better than a box, because the shading gradient runs
 *    around a curved normal instead of snapping across flat facets.
 *  - Triangle count is a *hard contract*, not a hope. `assertTriangleBudget` throws at build time if the
 *    mesh drifts outside the 1000–1800 band, so a careless "add one more segment" edit fails CI instead of
 *    quietly shipping a heavier avatar.
 *  - The mesh is authored in *bind space*: every vertex is expressed in the rest pose of the rig, and each
 *    vertex remembers which bone it belongs to plus its offset inside that bone. The skinning step then
 *    transforms it by the animated bone matrices. This is a rigid-ish (one bone per vertex) skin, which is
 *    the standard trick for segmented characters: no blended weights means no candy-wrapper artefacts at
 *    the elbow, and the whole skinning pass costs one matrix per vertex.
 *
 * The result is a stylised-but-readable humanoid: not a photoreal human (impossible in 1800 triangles and
 * pointless for a UI mascot), but a character with believable proportions, a clear silhouette, and enough
 * surface detail — brow, nose, ears, fingers — that the head still reads as a *face* in close-up.
 */

import { TAU, mat4FromEuler, mat4Mul, mat4Translation, mat4TransformPoint } from "./math";

/** A bone index the geometry can be skinned to. Mirrors `BoneId` in `skeleton.ts`. */
export type BoneId =
  | "root"
  | "hips"
  | "spineLow"
  | "spineUp"
  | "chest"
  | "neck"
  | "head"
  | "jaw"
  | "shoulderL"
  | "upperArmL"
  | "foreArmL"
  | "handL"
  | "shoulderR"
  | "upperArmR"
  | "foreArmR"
  | "handR"
  | "thighL"
  | "shinL"
  | "footL"
  | "toeL"
  | "thighR"
  | "shinR"
  | "footR"
  | "toeR";

/**
 * The shipped triangle budget for the avatar.
 *
 * Lower bound 1000 and upper bound 1800 are both contractual: the brief asks for a human avatar between
 * 1000 and 1800 triangles. `BOT_TRI_BUDGET` is the number we actually aim for, with headroom on both sides
 * so the budget is not sitting exactly on a limit.
 */
export const BOT_TRI_BUDGET = { min: 1000, max: 1800, target: 1450 } as const;

/** Per-material index into `Mesh.parts`. Materials are batched so the whole avatar draws in a handful of calls. */
export const enum Part {
  Skin = 0,
  Hair = 1,
  Shirt = 2,
  Trousers = 3,
  Shoes = 4,
  Eye = 5,
  Mouth = 6,
  Accent = 7,
}

export const PART_COUNT = 8;

export type MeshPart = {
  /** Material slot. */
  part: Part;
  /** Flat XYZ triples. */
  positions: number[];
  /** Flat XYZ triples. */
  normals: number[];
  /** Flat RGBA bytes. */
  colors: number[];
  /** Triangle indices into the vertex arrays. */
  indices: number[];
  /** Bone index per vertex. */
  bones: number[];
  /** Vertex offset inside its bone's rest frame. */
  boneOffsets: number[];
};

export type Mesh = {
  parts: MeshPart[];
  /** Total triangle count across all parts. */
  triangleCount: number;
  /** Total vertex count across all parts. */
  vertexCount: number;
  /** AABBs per part, in bind space, for culling and shadow fitting. */
  bounds: { min: number[]; max: number[] }[];
};

/* ------------------------------------------------------------------ builder */

type PartBuilder = {
  part: Part;
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  bones: number[];
  boneOffsets: number[];
  color: number[];
  /**
   * Each bone's bind-space origin, indexed by bone index.
   *
   * The geometry is authored in world space, but the *skinning* offsets have to be relative to each
   * vertex's own bone, so that `boneMatrix * boneOffset` reproduces the bind position exactly. A part
   * usually spans several bones — the torso spans the hips, the spine and the neck — so the origin
   * cannot be a single value per part.
   */
  boneOrigins: Map<number, number[]>;
};

type Vec3 = readonly number[];

/**
 * A capsule-shaped limb segment.
 *
 * Built as a stack of rings. `rings` controls the vertical resolution: each ring pair costs `radial` quads
 * (2 triangles), and the two hemispherical caps cost `radial` triangles each.
 *
 * The `taper` array gives a per-ring radius scale, which is how shoulders, wrists and ankles get their
 * natural thinning without needing separate meshes.
 */
function capsule(
  b: PartBuilder,
  opts: {
    /** Segment start, in the bone's local frame. */
    from: Vec3;
    /** Segment end, in the bone's local frame. */
    to: Vec3;
    /** Radius at the start. */
    r0: number;
    /** Radius at the end. */
    r1: number;
    /** Number of sides around the axis. */
    radial: number;
    /** Number of vertical rings along the axis. */
    rings: number;
    /** Extra radius scale per ring, applied on top of the linear taper. */
    bulge?: number[];
    /** Round the start cap. */
    capStart?: boolean;
    /** Round the end cap. */
    capEnd?: boolean;
    /** Bone this segment is skinned to. */
    bone: number;
  },
) {
  const { from, to, r0, r1, radial, rings, bone } = opts;
  const bulge = opts.bulge ?? [];
  const capStart = opts.capStart ?? true;
  const capEnd = opts.capEnd ?? true;

  const ax = to[0] - from[0], ay = to[1] - from[1], az = to[2] - from[2];
  const len = Math.hypot(ax, ay, az);
  if (len < 1e-6) return;
  const dir: Vec3 = [ax / len, ay / len, az / len];

  // Build an orthonormal frame around the segment axis. `up` is chosen to avoid a degenerate cross product.
  const helper: Vec3 = Math.abs(dir[1]) > 0.999 ? [1, 0, 0] : [0, 1, 0];
  const ux = helper[1] * dir[2] - helper[2] * dir[1];
  const uy = helper[2] * dir[0] - helper[0] * dir[2];
  const uz = helper[0] * dir[1] - helper[1] * dir[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  const U: Vec3 = [ux / ul, uy / ul, uz / ul];
  const V: Vec3 = [U[1] * dir[2] - U[2] * dir[1], U[2] * dir[0] - U[0] * dir[2], U[0] * dir[1] - U[1] * dir[0]];

  const startVertex = b.positions.length / 3;

  // --- side rings ---
  // Ring 0 is the flat start disc edge (or the start pole when capped), ring N is the end.
  const ringCount = rings + 1;
  const ringRadius: number[] = [];
  const ringPos: number[] = [];
  const ringNormal: number[] = [];

  for (let i = 0; i < ringCount; i++) {
    const t = i / rings;
    const y = len * t;
    const baseR = r0 + (r1 - r0) * t;
    const extra = bulge[i] ?? 1;
    const rad = baseR * extra;
    ringRadius.push(rad);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = U[0] * ca + V[0] * sa;
      const ny = U[1] * ca + V[1] * sa;
      const nz = U[2] * ca + V[2] * sa;
      b.positions.push(from[0] + dir[0] * y + nx * rad, from[1] + dir[1] * y + ny * rad, from[2] + dir[2] * y + nz * rad);
      b.normals.push(nx, ny, nz);
      b.colors.push(b.color[0], b.color[1], b.color[2], b.color[3]);
      b.bones.push(bone);
      const origin = b.boneOrigins.get(bone) ?? b.boneOrigins.values().next().value!;
      b.boneOffsets.push(
        from[0] + dir[0] * y + nx * rad - origin[0],
        from[1] + dir[1] * y + ny * rad - origin[1],
        from[2] + dir[2] * y + nz * rad - origin[2],
      );
    }
  }
  void ringPos;
  void ringNormal;

  // --- side quads ---
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = startVertex + i * radial + j;
      const bb = startVertex + i * radial + j2;
      const c = startVertex + (i + 1) * radial + j;
      const d = startVertex + (i + 1) * radial + j2;
      b.indices.push(a, c, d, a, d, bb);
    }
  }

  // --- caps ---
  // A cap is a triangle fan around a pole vertex. The pole sits slightly beyond the ring so the cap reads
  // as rounded rather than as a flat disc.
  const cap = (ringIndex: number, poleSign: 1 | -1) => {
    const t = ringIndex / rings;
    const ringR = ringRadius[ringIndex];
    const capH = ringR * 0.9;
    const y = len * t + poleSign * capH;
    const poleIdx = b.positions.length / 3;
    b.positions.push(from[0] + dir[0] * y, from[1] + dir[1] * y, from[2] + dir[2] * y);
    b.normals.push(dir[0] * poleSign, dir[1] * poleSign, dir[2] * poleSign);
    b.colors.push(b.color[0], b.color[1], b.color[2], b.color[3]);
    b.bones.push(bone);
    const origin = b.boneOrigins.get(bone) ?? b.boneOrigins.values().next().value!;
    b.boneOffsets.push(
      from[0] + dir[0] * y - origin[0],
      from[1] + dir[1] * y - origin[1],
      from[2] + dir[2] * y - origin[2],
    );
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const r1i = startVertex + ringIndex * radial + j;
      const r2i = startVertex + ringIndex * radial + j2;
      if (poleSign > 0) b.indices.push(poleIdx, r1i, r2i);
      else b.indices.push(poleIdx, r2i, r1i);
    }
  };
  if (capStart) cap(0, -1);
  if (capEnd) cap(rings, 1);
}

/**
 * An ellipsoid — used for the skull, cheeks, eyes and ears.
 *
 * `segU`/`segV` are the longitude/latitude divisions. Each quad is 2 triangles, so the cost is
 * `segU * segV * 2`, and poles are triangle fans.
 */
function ellipsoid(
  b: PartBuilder,
  opts: {
    center: Vec3;
    radius: Vec3;
    segU: number;
    segV: number;
    bone: number;
    /** Squashes the top of the shape — used to make the skull sit under the hair. */
    flattenTop?: number;
  },
) {
  const { center, radius, segU, segV, bone } = opts;
  const flattenTop = opts.flattenTop ?? 1;
  const startVertex = b.positions.length / 3;

  const push = (u: number, v: number) => {
    const phi = v * Math.PI; // 0 = top, PI = bottom
    const theta = u * TAU;
    const sx = Math.sin(phi) * Math.cos(theta);
    const sy = Math.cos(phi);
    const sz = Math.sin(phi) * Math.sin(theta);
    const yScale = sy > 0 ? sy * flattenTop + (1 - flattenTop) : sy;
    const px = center[0] + sx * radius[0];
    const py = center[1] + yScale * radius[1];
    const pz = center[2] + sz * radius[2];
    // Normal of the scaled ellipsoid.
    let nx = sx / radius[0], ny = sy / radius[1], nz = sz / radius[2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    b.positions.push(px, py, pz);
    b.normals.push(nx, ny, nz);
    b.colors.push(b.color[0], b.color[1], b.color[2], b.color[3]);
    b.bones.push(bone);
    const origin = b.boneOrigins.get(bone) ?? b.boneOrigins.values().next().value!;
    b.boneOffsets.push(px - origin[0], py - origin[1], pz - origin[2]);
  };

  for (let v = 0; v <= segV; v++) {
    for (let u = 0; u < segU; u++) push(u / segU, v / segV);
  }

  const idx = (v: number, u: number) => startVertex + v * segU + (u % segU);
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = idx(v, u), bb = idx(v, u + 1), c = idx(v + 1, u), d = idx(v + 1, u + 1);
      b.indices.push(a, c, d, a, d, bb);
    }
  }
}

/** A flat, single-sided quad in the XY plane facing +Z. Used for brows and the eye whites. */
function quad(
  b: PartBuilder,
  opts: { center: Vec3; halfW: number; halfH: number; bone: number; cornerRadius?: number },
) {
  const { center, halfW, halfH, bone } = opts;
  const cr = opts.cornerRadius ?? 0;
  const startVertex = b.positions.length / 3;
  const corners: Vec3[] = [
    [-halfW + cr, -halfH, 0],
    [halfW - cr, -halfH, 0],
    [halfW, -halfH + cr, 0],
    [halfW, halfH - cr, 0],
    [halfW - cr, halfH, 0],
    [-halfW + cr, halfH, 0],
    [-halfW, halfH - cr, 0],
    [-halfW, -halfH + cr, 0],
  ];
  for (const c of corners) {
    const px = center[0] + c[0], py = center[1] + c[1], pz = center[2] + c[2];
    b.positions.push(px, py, pz);
    b.normals.push(0, 0, 1);
    b.colors.push(b.color[0], b.color[1], b.color[2], b.color[3]);
    b.bones.push(bone);
    const origin = b.boneOrigins.get(bone) ?? b.boneOrigins.values().next().value!;
    b.boneOffsets.push(px - origin[0], py - origin[1], pz - origin[2]);
  }
  const tri = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  for (const t of tri) b.indices.push(startVertex + t);
}

/**
 * A tapered box, used for shoes and the hand "mitts".
 *
 * `seg` controls how many horizontal slices the box has along its length, which lets a shoe taper and
 * curve instead of reading as a brick.
 */
function taperedBox(
  b: PartBuilder,
  opts: {
    from: Vec3;
    to: Vec3;
    halfW0: number;
    halfH0: number;
    halfW1: number;
    halfH1: number;
    seg?: number;
    bone: number;
    /** Half-height of the cross-section at the mid-slice, for a curved shoe profile. */
    midBoost?: number;
  },
) {
  const { from, to, bone } = opts;
  const seg = opts.seg ?? 1;
  const midBoost = opts.midBoost ?? 0;
  const startVertex = b.positions.length / 3;

  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const hw = opts.halfW0 + (opts.halfW1 - opts.halfW0) * t;
    const hh = opts.halfH0 + (opts.halfH1 - opts.halfH0) * t;
    const boost = midBoost * Math.sin(t * Math.PI);
    const px = from[0] + (to[0] - from[0]) * t;
    const py = from[1] + (to[1] - from[1]) * t;
    const pz = from[2] + (to[2] - from[2]) * t;
    const ring: Vec3[] = [
      [-hw, -hh + boost, 0],
      [hw, -hh + boost, 0],
      [hw, hh, 0],
      [-hw, hh, 0],
    ];
    for (const c of ring) {
      const vx = px + c[0], vy = py + c[1], vz = pz + c[2];
      b.positions.push(vx, vy, vz);
      b.normals.push(0, 0, 1);
      b.colors.push(b.color[0], b.color[1], b.color[2], b.color[3]);
      b.bones.push(bone);
      const origin = b.boneOrigins.get(bone) ?? b.boneOrigins.values().next().value!;
      b.boneOffsets.push(vx - origin[0], vy - origin[1], vz - origin[2]);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < 4; j++) {
      const j2 = (j + 1) % 4;
      const a = startVertex + i * 4 + j;
      const bb = startVertex + i * 4 + j2;
      const c = startVertex + (i + 1) * 4 + j;
      const d = startVertex + (i + 1) * 4 + j2;
      b.indices.push(a, c, d, a, d, bb);
    }
  }
}

/* ------------------------------------------------------------------ palette */

/** Material colours, as 0–255 RGBA. Kept in one place so the renderer and the docs agree. */
export const PALETTE = {
  skin: [232, 197, 166, 255],
  skinShade: [214, 174, 143, 255],
  hair: [58, 46, 62, 255],
  shirt: [79, 70, 229, 255],
  shirtDark: [67, 56, 202, 255],
  trousers: [30, 41, 59, 255],
  shoes: [15, 23, 42, 255],
  eyeWhite: [248, 250, 252, 255],
  eyeIris: [22, 78, 99, 255],
  mouth: [122, 45, 62, 255],
  accent: [236, 72, 153, 255],
} as const;

/* ------------------------------------------------------------------ rig-space constants */

/**
 * Skeleton proportions, in metres. Roughly 1.72 m tall with a 7.5-head canon.
 *
 * These numbers are the single source of truth for the model's shape: the geometry builder places every
 * segment from them, and the walk cycle derives its stride length from them. Changing a value here moves
 * both the mesh and the animation consistently, which is what stops the classic "the feet float" bug.
 */
export const PROPORTIONS = {
  height: 1.72,
  hipY: 0.94,
  spineLowY: 1.06,
  spineUpY: 1.2,
  chestY: 1.34,
  neckY: 1.5,
  /**
   * The head joint sits at the base of the skull, not its centre, so the skull itself can extend above
   * it. `headY + skull half-height` lands just under the declared total height.
   */
  headY: 1.585,
  headRadius: 0.108,
  /** Half-height of the skull above the head joint. */
  skullHalfHeight: 0.118,
  jawY: 1.55,
  shoulderY: 1.44,
  shoulderX: 0.175,
  upperArmLen: 0.28,
  foreArmLen: 0.25,
  handLen: 0.09,
  /**
   * Leg segment lengths.
   *
   * The two segments sum to *slightly more* than the straight-line distance from the hip to the ankle.
   * That surplus is the slack the knee consumes: a human standing with a relaxed knee is never perfectly
   * straight, and the surplus is what lets the IK solver place a foot forward of the hip by bending the
   * knee instead of stretching the leg.
   *
   * The surplus sets the maximum stride: the foot can only reach `sqrt(chain^2 - drop^2)` ahead of the
   * hip while staying on the ground. Both numbers are derived in this file so the animation stays inside
   * the character's anatomy instead of stretching the legs.
   */
  thighLen: 0.462,
  shinLen: 0.443,
  footLen: 0.23,
  hipX: 0.09,
  /** Radius of the thigh at the top / knee / ankle. */
  thighR0: 0.082,
  thighR1: 0.055,
  shinR0: 0.055,
  shinR1: 0.037,
  armR0: 0.05,
  armR1: 0.038,
  /**
   * Nominal stride length: the distance the body travels in one full gait cycle.
   *
   * This is derived from the leg's reach rather than picked freely. The foot can be placed at most
   * `sqrt(chain^2 - drop^2)` ahead of the hip while staying on the ground, and the two feet swap places
   * each step, so the stride is capped at twice that distance. Using 90% of the cap keeps the feet inside
   * the reachable volume with margin for the body's vertical bob.
   */
  strideLength: 0,
} as const;

/* ------------------------------------------------------------------ foot constants */

/**
 * The shoe's sole rests on the ground plane (y = 0) in the rest pose.
 *
 * The shoe is a slab whose centre sits half its height above the ground. Anchoring the shoe to the
 * ground rather than to the ankle keeps the character's feet planted when the proportions change.
 */
/**
 * The toe joint's position, measured forward of the ankle along +Z.
 *
 * The toe bone's origin sits here, so the toe bends about a pivot at the ball of the foot rather than
 * about the ankle. The foot planner's depth calculation and the skeleton both read this constant, so the
 * two can never disagree about where the pivot is.
 */
export const TOE_PIVOT_Z = 0.135;

export const SOLE_HALF_HEIGHT = 0.028;
export const SOLE_CENTRE_Y = SOLE_HALF_HEIGHT;

/**
 * The rest-pose knee bend, in radians.
 *
 * This is the single source of truth for how the leg is posed when it is not walking. It is negative
 * because a human knee bends *backward*, and the rig's Z axis rotates a positive angle from -Y towards
 * +X.
 *
 * The bend buys the IK solver its reach: a bent chain is shorter than a straight one, so the foot can
 * travel further from the hip before the leg has to stretch. A perfectly straight rest leg would leave
 * the solver no slack at all and every forward step would clamp.
 */
export const REST_BEND_RADIANS = -0.26;

/**
 * The rest-pose thigh tilt, in radians.
 *
 * With the knee bent, the thigh has to lean *forward* for the ankle to end up underneath the hip. That
 * is how a standing human's leg is actually built: the femur angles down and forward, the tibia angles
 * down and back, and the knee sits over the ankle.
 *
 * Without this the bent leg would leave the ankle a hand's width behind the hip, and the character
 * would stand with its feet trailing behind it.
 */
export const REST_THIGH_TILT = (() => {
  const l1 = PROPORTIONS.thighLen;
  const l2 = PROPORTIONS.shinLen;
  const b = REST_BEND_RADIANS;
  // Solve `l1*sin(a) + l2*sin(a + b) = 0` for the tilt `a` that puts the ankle under the hip.
  return Math.atan2(-l2 * Math.sin(b), l1 + l2 * Math.cos(b));
})();

/**
 * The ankle's height above the ground in the rest pose.
 *
 * The bind chain is straight, but the rest pose bends the knee by `REST_BEND_RADIANS`, which lifts the
 * ankle. This is the height the shoe's sole is built against, so the character's feet rest exactly on
 * the ground plane.
 */
export const ANKLE_Y = (() => {
  const l1 = PROPORTIONS.thighLen;
  const l2 = PROPORTIONS.shinLen;
  // The thigh leans forward by `REST_THIGH_TILT` and the shin swings back by the knee bend, so the
  // ankle ends up directly under the hip.
  const thighAngle = REST_THIGH_TILT;
  const shinAngle = thighAngle + REST_BEND_RADIANS;
  // The ankle's world height in the rest pose. The shoe's sole is `SOLE_HALF_HEIGHT` below it, so the
  // sole rests on y = 0.
  return PROPORTIONS.hipY - l1 * Math.cos(thighAngle) - l2 * Math.cos(shinAngle);
})();

/**
 * The ankle's world height in the rest pose, above the ground.
 *
 * The shoe's sole must rest on y = 0, and the sole is `SOLE_HALF_HEIGHT` below the ankle's centre, so
 * the ankle sits `SOLE_HALF_HEIGHT` above the ground. The shoe geometry is built against this.
 */
export const ANKLE_REST_Y = ANKLE_Y;

/**
 * How far the rest pose lifts the ankle above the straight bind position.
 *
 * The bind chain is straight, so the bind ankle sits at `hipY - thighLen - shinLen`. The rest pose
 * bends the knee, which lifts the ankle by this much. The shoe geometry is authored in bind space, so
 * it has to be built `ANKLE_REST_LIFT` lower for the sole to end up on the floor in the rest pose.
 */
/**
 * The ankle's height above the ground in the *bind* pose, where the leg is straight.
 *
 * The bind pose is the reference the geometry is authored in; the rest pose bends the knee and lifts
 * the ankle to `ANKLE_Y`.
 */
export const BIND_ANKLE_Y = PROPORTIONS.hipY - PROPORTIONS.thighLen - PROPORTIONS.shinLen;

export const ANKLE_REST_LIFT = ANKLE_Y - BIND_ANKLE_Y;

/**
 * How far the sole has to sit below the bind ankle for it to rest on the floor in the rest pose.
 *
 * The rest pose both lifts the ankle (by `ANKLE_REST_LIFT`) and rotates the shoe (by the knee bend),
 * and the rotation lowers the shoe's ends back down. The two effects do not cancel, so the combined
 * drop is measured rather than derived: it is the difference between the bind ankle and the rest
 * ankle, minus the amount the sole's own rotation raises it.
 *
 * The value is computed from the leg's geometry, not hand-tuned, so it follows any change to the
 * proportions.
 */
/**
 * How far the sole hangs below the ankle.
 *
 * The shoe is authored in the **rest** frame — the frame the character actually stands in — so that
 * the sole rests on y = 0 there. The bind frame is a different frame (the leg is straight in it), so
 * the shoe's vertices are pre-transformed from the rest frame into the bind frame when the mesh is
 * built. That is what keeps the shoe exactly on the floor without a hand-tuned drop.
 */
export const SOLE_DROP = SOLE_HALF_HEIGHT + SOLE_CENTRE_Y;

/**
 * The ankle's horizontal offset from the hip in the rest pose.
 *
 * The rest thigh tilt and the knee bend cancel out, so this is very close to zero. It is kept explicit
 * because the shoe geometry and the trajectory planner both place the foot relative to the hip.
 */
export const ANKLE_X_OFFSET = (() => {
  const l1 = PROPORTIONS.thighLen;
  const l2 = PROPORTIONS.shinLen;
  const thighAngle = REST_THIGH_TILT;
  const shinAngle = thighAngle + REST_BEND_RADIANS;
  return l1 * Math.sin(thighAngle) + l2 * Math.sin(shinAngle);
})();

/* ------------------------------------------------------------------ foot constants */

/**
 * The shoe's sole rests on the ground plane (y = 0) in the rest pose.
 *
 * The shoe is a slab whose centre sits half its height above the ground, and the ankle joint sits
 * `SOLE_TO_ANKLE` above the ground. Anchoring the shoe to the ground rather than to the ankle keeps the
 * character's feet planted when the proportions change.
 */

/**
 * The maximum horizontal distance the foot can reach ahead of the hip while the ankle stays on the
 * ground. Derived from the leg's geometry, never hand-tuned.
 */
export const MAX_FOOT_REACH = (() => {
  const chain = PROPORTIONS.thighLen + PROPORTIONS.shinLen;
  // The straight-line distance from the hip to the ankle in the rest pose, which is shorter than the
  // chain because the knee rests bent. The IK spends the difference as reach.
  const drop = PROPORTIONS.hipY - ANKLE_Y;
  return Math.sqrt(Math.max(0, chain * chain - drop * drop));
})();

/**
 * The stride length the walk cycle uses: the distance the body travels in one full gait cycle.
 *
 * The two feet swap places each step, so the stride is twice the distance one foot travels relative to
 * the body. That distance is bounded by the leg's reach at the ankle's height, minus a margin for the
 * ankle's offset from the sole contact point and for the foot's pitch at the extremes of the gait.
 *
 * The margin is not optional: without it the IK solver clamps at the ends of the stride, and a clamped
 * leg is a stretched leg — the foot leaves the ground exactly when it should be planted, which is the
 * single most obvious tell of a fake walk cycle.
 */
export const STRIDE_LENGTH = MAX_FOOT_REACH * 0.82;

/* ------------------------------------------------------------------ builder entry */

/**
 * Builds the full avatar mesh.
 *
 * Returns the mesh split into material parts. Each part can be drawn with one `drawElements` call, so
 * the whole avatar costs `PART_COUNT` draw calls at worst — 8 in practice, but many parts are empty and
 * get skipped (only parts with indices are uploaded).
 */
/**
 * The level-of-detail tiers the avatar ships with.
 *
 * The avatar is a hero asset: it is always on screen, it animates, and it shares the frame with the rest
 * of the page. So it has to survive being small. Four tiers, from the full mesh down to a silhouette
 * that still reads as a person:
 *
 *   LOD0  full detail, the default. Every mesh part at its authored resolution.
 *   LOD1  roughly half the triangles. The face and hands lose their small features first.
 *   LOD2  roughly a quarter. The head is a smooth ovoid and the fingers are gone.
 *   LOD3  a handful of triangles per limb. Only usable when the avatar is a thumbnail.
 *
 * The tiers are built from the same code as LOD0 — the only thing that changes is the detail scale —
 * so they can never drift apart in proportion or in silhouette.
 */
export const enum Lod {
  LOD0 = 0,
  LOD1 = 1,
  LOD2 = 2,
  LOD3 = 3,
}

/**
 * The detail multiplier for each tier.
 *
 * These are the *radial and segment counts*, not the triangle counts, because the triangle count follows
 * from the segment counts quadratically. The realised triangle counts are asserted by the test suite.
 */
export const LOD_DETAIL: Record<Lod, number> = {
  [Lod.LOD0]: 1,
  [Lod.LOD1]: 0.72,
  [Lod.LOD2]: 0.5,
  [Lod.LOD3]: 0.34,
};

/**
 * The triangle budget for each tier.
 *
 * The LOD0 band is the contractual one: the brief asks for 1000-1800 triangles. The lower tiers are
 * allowed to go under it — that is the whole point of an LOD — but each one must still be a *smaller*
 * mesh than the tier above it, which is what the test suite enforces.
 */
export const LOD_TRI_BUDGET: Record<Lod, { min: number; max: number }> = {
  [Lod.LOD0]: { min: BOT_TRI_BUDGET.min, max: BOT_TRI_BUDGET.max },
  [Lod.LOD1]: { min: 700, max: 1550 },
  [Lod.LOD2]: { min: 400, max: 900 },
  [Lod.LOD3]: { min: 150, max: 500 },
};

/**
 * The distance in metres at which each tier takes over.
 *
 * The avatar is 1.72 m tall and is framed at roughly 2.5-4 m in the dashboard panel. These cut-offs are
 * tuned so the full mesh is used whenever the character is actually readable, and the cheaper tiers only
 * take over when it is a few pixels tall.
 */
export const LOD_SWITCH_DISTANCE: Record<Lod, number> = {
  [Lod.LOD0]: 0,
  [Lod.LOD1]: 4.5,
  [Lod.LOD2]: 8,
  [Lod.LOD3]: 14,
};

/** Picks the LOD tier for a given camera distance. */
export function lodForDistance(distance: number): Lod {
  if (distance < LOD_SWITCH_DISTANCE[Lod.LOD1]) return Lod.LOD0;
  if (distance < LOD_SWITCH_DISTANCE[Lod.LOD2]) return Lod.LOD1;
  if (distance < LOD_SWITCH_DISTANCE[Lod.LOD3]) return Lod.LOD2;
  return Lod.LOD3;
}

/* ------------------------------------------------------------------ bind positions */

/**
 * The bind-space position of every bone, indexed by bone index.
 *
 * This is the single source of truth for where the joints are. The skeleton derives its hierarchy from
 * it, and the geometry derives its per-bone skinning offsets from it.
 *
 * That shared origin matters: the skinning offsets are the vertex's position *relative to its own bone*,
 * so if the geometry and the skeleton disagreed about a bone's position by even a millimetre, the mesh
 * would visibly come apart at the joints when it moved.
 */
export const BONE_BIND_POSITIONS: readonly (readonly [number, number, number])[] = (() => {
  const P = PROPORTIONS;
  const l1 = P.thighLen;
  const l2 = P.shinLen;

  // The leg's bind chain is **straight**: each bone's offset is its own length straight down.
  //
  // The rest pose — the thigh leaning forward and the knee bent back — lives in the bones' *rest
  // rotations*, not in the offsets. That split is what lets the IK solver and the rig agree: the
  // solver models the chain as two segments of `l1` and `l2` hinged at the knee, and the rig's rest
  // rotations are exactly the tilt and the bend that separate the two models. Rotating the target by
  // `-tilt` reconciles the frames.
  const leg = (side: number) => {
    const x = side * P.hipX;
    const kneeY = P.hipY - l1;
    return { x, kneeY, ankleY: kneeY - l2 };
  };
  const legL = leg(-1);
  const legR = leg(1);

  return [
    [0, 0, 0],                                  // 0  root
    [0, P.hipY, 0],                             // 1  hips
    [0, P.spineLowY, 0],                        // 2  spineLow
    [0, P.spineUpY, 0],                         // 3  spineUp
    [0, P.chestY, 0],                           // 4  chest
    [0, P.neckY, 0],                            // 5  neck
    [0, P.headY, 0],                            // 6  head
    [0, P.jawY, 0],                             // 7  jaw
    [-P.shoulderX, P.shoulderY, 0],             // 8  shoulderL
    [-P.shoulderX, P.shoulderY - P.upperArmLen, 0], // 9  upperArmL
    [-P.shoulderX, P.shoulderY - P.upperArmLen - P.foreArmLen, 0], // 10 foreArmL
    [-P.shoulderX, P.shoulderY - P.upperArmLen - P.foreArmLen - P.handLen, 0], // 11 handL
    [P.shoulderX, P.shoulderY, 0],              // 12 shoulderR
    [P.shoulderX, P.shoulderY - P.upperArmLen, 0], // 13 upperArmR
    [P.shoulderX, P.shoulderY - P.upperArmLen - P.foreArmLen, 0], // 14 foreArmR
    [P.shoulderX, P.shoulderY - P.upperArmLen - P.foreArmLen - P.handLen, 0], // 15 handR
    [legL.x, P.hipY, 0],                        // 16 thighL
    [legL.x, legL.kneeY, 0],                    // 17 shinL
    [legL.x, legL.ankleY, 0],                   // 18 footL
    [legL.x, legL.ankleY, TOE_PIVOT_Z],         // 19 toeL
    [legR.x, P.hipY, 0],                        // 20 thighR
    [legR.x, legR.kneeY, 0],                    // 21 shinR
    [legR.x, legR.ankleY, 0],                   // 22 footR
    [legR.x, legR.ankleY, TOE_PIVOT_Z],         // 23 toeR
  ];
})();

export function buildBotMesh(lod: Lod = Lod.LOD0): Mesh {
  const P = PROPORTIONS;
  // The detail scale multiplies every radial and segment count. A count of 3 is the floor: below that a
  // capsule becomes a sliver and an ellipsoid becomes a tetrahedron with visible gaps.
  const d = LOD_DETAIL[lod];
  const detail = (n: number) => Math.max(3, Math.round(n * d));

  // Bone order must match `BONE_ORDER` in skeleton.ts.
  const BONE = {
    root: 0, hips: 1, spineLow: 2, spineUp: 3, chest: 4, neck: 5, head: 6, jaw: 7,
    shoulderL: 8, upperArmL: 9, foreArmL: 10, handL: 11,
    shoulderR: 12, upperArmR: 13, foreArmR: 14, handR: 15,
    thighL: 16, shinL: 17, footL: 18, toeL: 19,
    thighR: 20, shinR: 21, footR: 22, toeR: 23,
  } as const;

  const parts: MeshPart[] = [];
  const builders = new Map<Part, PartBuilder>();

  // Every builder shares the same per-bone origin table, so a vertex's skinning offset is always
  // measured against its own bone's bind position.
  const boneOrigins = new Map<number, number[]>();
  BONE_BIND_POSITIONS.forEach((p, i) => boneOrigins.set(i, [p[0], p[1], p[2]]));

  const make = (part: Part, color: number[], origin: number[]): PartBuilder => {
    let b = builders.get(part);
    if (!b) {
      b = {
        part, positions: [], normals: [], colors: [], indices: [], bones: [], boneOffsets: [],
        color, boneOrigins,
      };
      builders.set(part, b);
    }
    // The origin argument is the authoring convenience for the first bone this builder touches. It is
    // not used for the skinning offsets — those come from the shared table — but it is kept so the
    // authoring code reads the way it was written.
    void origin;
    return b;
  };

  // ---- torso ------------------------------------------------------------
  // The torso is one continuous tapered capsule from hips to neck, split across three bones. The split
  // points are the spine joints, so the geometry lines up exactly with the bones that bend it.
  {
    const b = make(Part.Shirt, [...PALETTE.shirt], [0, P.hipY, 0]);
    // Hips -> spineLow
    capsule(b, { from: [0, P.hipY - 0.06, 0], to: [0, P.spineLowY, 0], r0: 0.135, r1: 0.128, radial: detail(10), rings: 1, bone: BONE.hips, capStart: true, capEnd: false });
    capsule(b, { from: [0, P.spineLowY, 0], to: [0, P.spineUpY, 0], r0: 0.128, r1: 0.126, radial: detail(10), rings: 1, bone: BONE.spineLow, capStart: false, capEnd: false });
    capsule(b, { from: [0, P.spineUpY, 0], to: [0, P.chestY + 0.02, 0], r0: 0.126, r1: 0.145, radial: detail(10), rings: 1, bone: BONE.spineUp, capStart: false, capEnd: false });
    // Chest -> neck base. The shoulder yoke widens the silhouette, which is the biggest readability win
    // for a low-poly human: it creates the "V" that says "shoulders" at a glance.
    capsule(b, {
      from: [0, P.chestY + 0.02, 0], to: [0, P.neckY, 0], r0: 0.145, r1: 0.062, radial: detail(12), rings: 2, bone: BONE.chest,
      bulge: [1, 1.28, 1],
      capStart: false, capEnd: false,
    });
    // Neck
    capsule(b, { from: [0, P.neckY - 0.01, 0], to: [0, P.headY - 0.045, 0], r0: 0.052, r1: 0.05, radial: detail(8), rings: 1, bone: BONE.neck, capStart: false, capEnd: false });
  }

  // ---- pelvis block -----------------------------------------------------
  // The torso capsule is round; the pelvis needs to be wide and flat or the character looks like a
  // snowman. A squashed ellipsoid fixes the hip-to-leg transition.
  {
    const b = make(Part.Trousers, [...PALETTE.trousers], [0, P.hipY, 0]);
    ellipsoid(b, { center: [0, P.hipY + 0.02, 0], radius: [0.145, 0.105, 0.1], segU: detail(12), segV: detail(5), bone: BONE.hips });
  }

  // ---- head -------------------------------------------------------------
  {
    const b = make(Part.Skin, [...PALETTE.skin], [0, P.headY, 0]);
    // Skull: flattened top so the hair cap sits on it. The skull's vertical half-extent is the declared
    // `skullHalfHeight`, which keeps the crown inside the avatar's stated total height.
    ellipsoid(b, { center: [0, P.headY + 0.012, 0], radius: [P.headRadius, P.skullHalfHeight, 0.115], segU: detail(14), segV: detail(8), bone: BONE.head, flattenTop: 0.86 });
    // Jaw / chin, on the jaw bone so the mouth can open.
    ellipsoid(b, { center: [0, P.jawY - 0.005, 0.018], radius: [0.072, 0.05, 0.078], segU: detail(10), segV: detail(5), bone: BONE.jaw });
    // Nose.
    ellipsoid(b, { center: [0, P.headY + 0.012, 0.108], radius: [0.019, 0.03, 0.024], segU: detail(6), segV: detail(4), bone: BONE.head });
    // Ears.
    ellipsoid(b, { center: [-0.104, P.headY + 0.012, 0.005], radius: [0.014, 0.03, 0.022], segU: detail(6), segV: detail(4), bone: BONE.head });
    ellipsoid(b, { center: [0.104, P.headY + 0.012, 0.005], radius: [0.014, 0.03, 0.022], segU: detail(6), segV: detail(4), bone: BONE.head });
  }

  // ---- hair -------------------------------------------------------------
  // A skull cap: a slightly larger, flattened ellipsoid whose crown clears the skull by a few millimetres.
  // The extra thickness is what makes the hair read as a separate volume rather than as a painted scalp.
  {
    const b = make(Part.Hair, [...PALETTE.hair], [0, P.headY, 0]);
    ellipsoid(b, { center: [0, P.headY + 0.014, -0.004], radius: [P.headRadius + 0.009, P.skullHalfHeight + 0.008, 0.122], segU: detail(14), segV: detail(6), bone: BONE.head, flattenTop: 0.9 });
  }

  // ---- eyes + brows -----------------------------------------------------
  for (const sx of [-1, 1]) {
    const eb = make(Part.Eye, [...PALETTE.eyeWhite], [0, P.headY, 0]);
    quad(eb, { center: [sx * 0.042, P.headY + 0.022, 0.099], halfW: 0.026, halfH: 0.016, bone: BONE.head, cornerRadius: 0.008 });
    const ib = make(Part.Eye, [...PALETTE.eyeIris], [0, P.headY, 0]);
    ellipsoid(ib, { center: [sx * 0.042, P.headY + 0.02, 0.108], radius: [0.011, 0.011, 0.006], segU: detail(7), segV: detail(5), bone: BONE.head });
    const hb = make(Part.Hair, [...PALETTE.hair], [0, P.headY, 0]);
    quad(hb, { center: [sx * 0.045, P.headY + 0.055, 0.104], halfW: 0.026, halfH: 0.007, bone: BONE.head, cornerRadius: 0.004 });
  }

  // ---- mouth ------------------------------------------------------------
  // A dark interior quad on the jaw bone. Opening the jaw drops it and the visible "hole" reads as a mouth.
  {
    const b = make(Part.Mouth, [...PALETTE.mouth], [0, P.jawY, 0]);
    quad(b, { center: [0, P.jawY - 0.004, 0.086], halfW: 0.026, halfH: 0.006, bone: BONE.jaw, cornerRadius: 0.005 });
  }

  // ---- arms -------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const isLeft = side < 0;
    const sh = isLeft ? BONE.shoulderL : BONE.shoulderR;
    const ua = isLeft ? BONE.upperArmL : BONE.upperArmR;
    const fa = isLeft ? BONE.foreArmL : BONE.foreArmR;
    const hd = isLeft ? BONE.handL : BONE.handR;

    const sx = side * P.shoulderX;

    // Shoulder ball.
    {
      const b = make(Part.Shirt, [...PALETTE.shirt], [sx, P.shoulderY, 0]);
      ellipsoid(b, { center: [sx, P.shoulderY, 0], radius: [0.062, 0.062, 0.062], segU: detail(8), segV: detail(5), bone: sh });
    }
    // Upper arm: hangs down along -Y from the shoulder.
    {
      const b = make(Part.Shirt, [...PALETTE.shirtDark], [sx, P.shoulderY, 0]);
      capsule(b, {
        from: [sx, P.shoulderY, 0], to: [sx, P.shoulderY - P.upperArmLen, 0],
        r0: P.armR0, r1: P.armR1, radial: detail(8), rings: 2, bone: ua, capStart: false, capEnd: false,
        bulge: [1, 0.96, 1],
      });
    }
    // Forearm + hand.
    {
      const b = make(Part.Skin, [...PALETTE.skin], [sx, P.shoulderY - P.upperArmLen, 0]);
      capsule(b, {
        from: [sx, P.shoulderY - P.upperArmLen, 0], to: [sx, P.shoulderY - P.upperArmLen - P.foreArmLen, 0],
        r0: P.armR1, r1: 0.03, radial: detail(7), rings: 2, bone: fa, capStart: false, capEnd: false,
      });
      capsule(b, {
        from: [sx, P.shoulderY - P.upperArmLen - P.foreArmLen, 0], to: [sx, P.shoulderY - P.upperArmLen - P.foreArmLen - P.handLen, 0],
        r0: 0.031, r1: 0.026, radial: detail(6), rings: 1, bone: hd, capStart: false, capEnd: true,
      });
    }
  }

  // ---- legs -------------------------------------------------------------
  for (const side of [-1, 1] as const) {
    const isLeft = side < 0;
    const th = isLeft ? BONE.thighL : BONE.thighR;
    const sh = isLeft ? BONE.shinL : BONE.shinR;
    const ft = isLeft ? BONE.footL : BONE.footR;
    const toe = isLeft ? BONE.toeL : BONE.toeR;
    const sx = side * P.hipX;

    {
      const b = make(Part.Trousers, [...PALETTE.trousers], [sx, P.hipY, 0]);
      capsule(b, {
        from: [sx, P.hipY + 0.02, 0], to: [sx, P.hipY - P.thighLen, 0],
        r0: P.thighR0, r1: P.thighR1, radial: detail(9), rings: 2, bone: th, capStart: false, capEnd: false,
        bulge: [1, 1.02, 1],
      });
    }
    {
      const b = make(Part.Trousers, [...PALETTE.trousers], [sx, P.hipY - P.thighLen, 0]);
      capsule(b, {
        from: [sx, P.hipY - P.thighLen, 0], to: [sx, ANKLE_Y + 0.045, 0],
        r0: P.thighR1, r1: P.shinR1, radial: detail(8), rings: 2, bone: sh, capStart: false, capEnd: false,
        bulge: [1, 1.05, 1],
      });
    }
    // Foot: a rounded slab from heel to toe.
    //
    // The shoe is positioned from the **ground plane**, not from the ankle: the sole rests on y = 0 in
    // the rest pose. Anchoring the shoe to the ground is what keeps the character's feet from hovering
    // or sinking when the proportions change.
    //
    // The subtlety is that the geometry is authored in *bind* space, where the leg is straight and the
    // ankle sits at `BIND_ANKLE_Y`, while the sole has to rest on the floor once the rest pose has bent
    // the knee and lifted the ankle by `ANKLE_REST_LIFT`.
    //
    // The shoe is authored in the **rest frame**: its sole rests on y = 0 and its ankle sits at
    // `ANKLE_Y`, which is the frame the character actually stands in. The mesh's bind frame is a
    // different frame — the leg is straight in it — so the shoe's vertices are pre-transformed into
    // bind space once the whole mesh is built. That is what puts the sole exactly on the floor
    // without a hand-tuned drop.
    const shoeY = SOLE_CENTRE_Y;
    {
      const b = make(Part.Shoes, [...PALETTE.shoes], [sx, ANKLE_Y, 0]);
      taperedBox(b, {
        from: [sx, shoeY, -0.055], to: [sx, shoeY, TOE_PIVOT_Z],
        halfW0: 0.038, halfH0: SOLE_HALF_HEIGHT, halfW1: 0.042, halfH1: 0.018, seg: 2, bone: ft, midBoost: 0.012,
      });
    }
    // Toe cap, on its own bone so the foot can roll over the toe during the walk.
    {
      const b = make(Part.Shoes, [...PALETTE.shoes], [sx, ANKLE_Y, 0]);
      taperedBox(b, {
        from: [sx, shoeY, TOE_PIVOT_Z], to: [sx, shoeY + 0.007, 0.175],
        halfW0: 0.042, halfH0: 0.018, halfW1: 0.03, halfH1: 0.012, seg: 1, bone: toe,
      });
    }
  }

  // ---- materialise -----------------------------------------------------
  for (const b of builders.values()) {
    if (b.indices.length === 0) continue;
    parts.push({
      part: b.part,
      positions: b.positions,
      normals: b.normals,
      colors: b.colors,
      indices: b.indices,
      bones: b.bones,
      boneOffsets: b.boneOffsets,
    });
  }

  // The shoe is authored in the rest frame, so it has to be moved into the bind frame before it is
  // skinned. The bind frame is the leg's straight pose; the rest frame is the leg bent with the sole
  // on the floor. The transform between them is the foot bone's rest transform, and applying its
  // inverse to the shoe's vertices puts them where the straight leg expects them.
  //
  // Doing it here rather than hand-tuning a drop is what keeps the sole exactly on the floor: the
  // geometry, the rig and the planner can never disagree about where the floor is.
  moveShoesIntoBindSpace(parts);

  // Compute per-part AABB in bind space.
  const bounds = parts.map((p) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    return { min, max };
  });

  const triangleCount = parts.reduce((s, p) => s + p.indices.length / 3, 0);
  const vertexCount = parts.reduce((s, p) => s + p.positions.length / 3, 0);

  // Each tier is checked against its own budget. LOD0 is the contractual band; the lower tiers are
  // allowed to be smaller, but never larger than the tier above them.
  const band = LOD_TRI_BUDGET[lod];
  if (triangleCount < band.min || triangleCount > band.max) {
    throw new Error(
      `Bot avatar LOD${lod} triangle budget violated: ${triangleCount} triangles is outside the ${band.min}-${band.max} band.`,
    );
  }
  return { parts, triangleCount, vertexCount, bounds };
}

/**
 * Moves the shoe geometry from the rest frame into the bind frame.
 *
 * The shoe is authored so that its sole rests on y = 0 and its ankle sits at `ANKLE_Y` — the frame the
 * character actually stands in. The mesh's bind frame is the leg's *straight* pose, so the shoe has to
 * be moved into it before it is skinned.
 *
 * The move is the inverse of the foot bone's rest transform:
 *
 *   - the ankle drops from `ANKLE_Y` to `BIND_ANKLE_Y`;
 *   - the shoe rotates back by the foot bone's world rotation at rest, which is the thigh's tilt plus
 *     the knee's bend.
 *
 * The shoe's vertices are rotated about the ankle and then translated, and their bone offsets are
 * recomputed from the new positions.
 */
function moveShoesIntoBindSpace(parts: MeshPart[]): void {
  const theta = REST_THIGH_TILT + REST_BEND_RADIANS;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // The ankle's height moves from the rest height to the bind height.
  const drop = ANKLE_Y - BIND_ANKLE_Y;

  for (const part of parts) {
    if (part.part !== Part.Shoes) continue;
    for (let v = 0; v < part.positions.length / 3; v++) {
      const bone = part.bones[v];
      const ankle = BONE_BIND_POSITIONS[bone];
      // The bone's own origin in the rest frame: the ankle, for both the foot and the toe.
      const ax = ankle[0];
      const ay = ANKLE_Y;
      const px = part.positions[v * 3 + 0];
      const py = part.positions[v * 3 + 1];
      const pz = part.positions[v * 3 + 2];
      // Rotate about the ankle by `-theta`, then drop the ankle to the bind height.
      const rx = ax + (px - ax) * cos + (py - ay) * sin;
      const ry = ay - (px - ax) * sin + (py - ay) * cos;
      const bx = rx;
      const by = ry - drop;
      part.positions[v * 3 + 0] = bx;
      part.positions[v * 3 + 1] = by;
      // The normal rotates with the vertex.
      const nx = part.normals[v * 3 + 0];
      const ny = part.normals[v * 3 + 1];
      const nz = part.normals[v * 3 + 2];
      part.normals[v * 3 + 0] = nx * cos + ny * sin;
      part.normals[v * 3 + 1] = -nx * sin + ny * cos;
      // The bone offset is recomputed against the bone's bind origin.
      const origin = BONE_BIND_POSITIONS[bone];
      part.boneOffsets[v * 3 + 0] = bx - origin[0];
      part.boneOffsets[v * 3 + 1] = by - origin[1];
      part.boneOffsets[v * 3 + 2] = pz - origin[2];
    }
  }
}

/**
 * Builds every LOD tier of the avatar.
 *
 * The tiers are built eagerly so the swap can happen on the same frame the distance changes — a lazy
 * build would cost a frame of hitch exactly when the camera is moving, which is the worst possible
 * moment for one.
 */
export function buildBotMeshLods(): Record<Lod, Mesh> {
  return {
    [Lod.LOD0]: buildBotMesh(Lod.LOD0),
    [Lod.LOD1]: buildBotMesh(Lod.LOD1),
    [Lod.LOD2]: buildBotMesh(Lod.LOD2),
    [Lod.LOD3]: buildBotMesh(Lod.LOD3),
  };
}

/**
 * Fails loudly when the avatar drifts outside its contractual triangle band.
 *
 * This runs at module import in development and inside the test suite, so the budget is enforced by the
 * build rather than by a review comment that everyone forgets.
 */
export function assertTriangleBudget(count: number): void {
  if (count < BOT_TRI_BUDGET.min || count > BOT_TRI_BUDGET.max) {
    throw new Error(
      `Bot avatar triangle budget violated: ${count} triangles is outside the ${BOT_TRI_BUDGET.min}-${BOT_TRI_BUDGET.max} band.`,
    );
  }
}

/**
 * The foot's silhouette, measured from the mesh itself.
 *
 * The trajectory planner needs to know where the foot's lowest point ends up when the ankle pitches and
 * the toe folds. Rather than approximating that with hand-tuned constants — which drift the moment the
 * shoe geometry is edited — the measurement is taken from the actual vertices.
 *
 * The result is the depth of the foot below the ankle, in the foot's own frame, for a given pitch and toe
 * bend. The planner adds it to the ankle's height so the sole rests exactly on the ground.
 */
export type FootSilhouette = {
  /** Foot vertices in the ankle's frame: [x, y, z, boneIndex] with the toe bone folded separately. */
  vertices: number[];
  /** The toe bone's index. */
  toeBone: number;
};

/**
 * Extracts the foot's vertices, tagged with their bone, from the built mesh.
 *
 * The toe's vertices are kept separate because the toe joint rotates relative to the foot.
 */
export function measureFootSilhouette(mesh: Mesh, side: -1 | 1): FootSilhouette {
  const toeBone = side < 0 ? 19 : 23;
  const footBone = side < 0 ? 18 : 22;
  const out: number[] = [];
  for (const part of mesh.parts) {
    if (part.part !== Part.Shoes) continue;
    for (let v = 0; v < part.positions.length / 3; v++) {
      const bone = part.bones[v];
      if (bone !== footBone && bone !== toeBone) continue;
      out.push(
        part.boneOffsets[v * 3],
        part.boneOffsets[v * 3 + 1],
        part.boneOffsets[v * 3 + 2],
        bone === toeBone ? 1 : 0,
      );
    }
  }
  return { vertices: out, toeBone };
}

/**
 * The depth of the foot below the ankle for a given ankle pitch and toe bend.
 *
 * The computation mirrors the renderer's transform chain exactly, because a planner that disagrees with
 * the renderer by even a centimetre puts the character's foot through the floor:
 *
 *   foot bone: `Rz(legAngle) · Rx(anklePitch)`
 *   toe bone:  `foot bone · T(toePivot) · Rx(toeBend)`
 *
 * The ankle pitches about X (which rolls the foot onto its toe) and the toe joint bends about X as
 * well; a positive rotation moves a point at +Z (the toe) down. The vertices are stored relative to
 * their own bone's origin, so the toe bone's pivot translation has to be applied before the ankle's
 * pitch — which is exactly why the toe dips as the heel lifts.
 *
 * `legAngle` is the world rotation of the leg's chain about Z. The foot bone inherits it, so the foot's
 * pitch is applied in a frame that is itself tilted: with the leg swung forward, the shoe's outer edge
 * dips lower than its inner edge. Passing zero measures the depth as if the leg were vertical, which is
 * the right answer only for a leg hanging straight down.
 *
 * `bodyPitch` is the hips' forward lean about X and `bodyYaw` the pelvis's twist about Y. The whole body
 * leans and twists into the walk, and the feet go with it, so both have to be part of the measurement.
 *
 * The matrices are built with the same helpers the renderer uses, so the two cannot drift apart.
 */
export function footDepth(
  silhouette: FootSilhouette,
  anklePitch: number,
  toeBend: number,
  legAngle = 0,
  bodyPitch = 0,
  bodyYaw = 0,
): number {
  // The foot bone's world rotation: the body's lean and twist, then the leg's swing about Z, then the
  // ankle's pitch about X.
  //
  // The order matches the rig: the hips carry the body, the leg swings inside them, and the ankle
  // pitches inside the leg.
  const footRot = mat4Mul(
    mat4Mul(
      mat4FromEuler(bodyPitch, bodyYaw, 0),
      mat4FromEuler(0, 0, legAngle),
    ),
    mat4FromEuler(anklePitch, 0, 0),
  );
  // The toe bone's world rotation: the foot's, then the pivot offset and the toe's own bend.
  const toeRot = mat4Mul(
    footRot,
    mat4Mul(mat4Translation([0, 0, TOE_PIVOT_Z]), mat4FromEuler(toeBend, 0, 0)),
  );

  let lowest = Infinity;
  const v = silhouette.vertices;
  for (let i = 0; i < v.length; i += 4) {
    const isToe = v[i + 3] > 0.5;
    const p = mat4TransformPoint(isToe ? toeRot : footRot, [v[i], v[i + 1], v[i + 2]]);
    if (p[1] < lowest) lowest = p[1];
  }
  return Number.isFinite(lowest) ? -lowest : 0;
}
