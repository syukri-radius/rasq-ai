/**
 * Minimal linear-algebra kit for the RASQ-Ai bot avatar.
 *
 * Everything is a plain `number[]` so it can be handed straight to WebGL's `uniformMatrix4fv` without
 * any wrapper allocation, and so the rig can be unit-tested without a DOM. Matrices are column-major
 * Float32Array(16), matching the layout GL expects for `uniformMatrix4fv(..., false, m)`.
 *
 * Convention: right-handed, +Y up, -Z into the screen, angles in radians.
 */

/** A 3-component vector. Read-only to callers; use the mutating `v*` helpers where allocation matters. */
export type Vec3 = readonly [number, number, number] | readonly number[];

/* ------------------------------------------------------------------ scalars */

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const TAU = Math.PI * 2;

/** Wraps an angle into (-PI, PI]. Used to keep Euler channels from accumulating drift over long sessions. */
export function wrapAngle(a: number): number {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

/**
 * Frame-rate independent exponential smoothing.
 *
 * `rate` is the reciprocal of the time constant in seconds: the result closes roughly `63%` of the gap
 * after `1 / rate` seconds. This is what keeps the animation continuous when a background tab throttles
 * the rAF loop and hands us a 2-second delta, instead of snapping the rig to a new pose.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/* ------------------------------------------------------------------ vectors */

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}
export const vAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vScale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const vDot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vLen = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const vLerp = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export function vNormalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-8 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
export function vCross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/* ------------------------------------------------------------------ matrices */

/** Identity matrix as a mutable 16-element column-major array. */
export function mat4(): Float32Array<ArrayBufferLike> {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Identity(): Float32Array<ArrayBufferLike> {
  return mat4();
}

/**
 * Multiplies `a * b` (apply b first, then a) and writes into `out`.
 *
 * The result is staged in a scratch buffer before being copied into `out`. This makes the function
 * alias-safe: `out` may be a window into the same array as `a` or `b` (the rig composes a bone hierarchy
 * in one buffer, where a child's window sits right after its parent's), and without the staging step the
 * write would clobber the operand mid-multiply.
 */
export function mat4Mul(a: Float32Array<ArrayBufferLike>, b: Float32Array<ArrayBufferLike>, out: Float32Array<ArrayBufferLike> = new Float32Array(16)): Float32Array<ArrayBufferLike> {
  // If `out` does not overlap its inputs we can write straight into it.
  if (!overlaps(out, a) && !overlaps(out, b)) {
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }
  const tmp = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    tmp[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    tmp[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    tmp[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    tmp[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  out.set(tmp);
  return out;
}

/** True when two typed-array views share any byte. */
function overlaps(a: Float32Array<ArrayBufferLike>, b: Float32Array<ArrayBufferLike>): boolean {
  const ab = a.byteOffset, abEnd = ab + a.byteLength;
  const bb = b.byteOffset, bbEnd = bb + b.byteLength;
  return ab < bbEnd && bb < abEnd;
}

/** Right-handed perspective projection with a [-1, 1] depth range (WebGL's clip space). */
export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array<ArrayBufferLike> {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** Right-handed look-at view matrix. */
export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array<ArrayBufferLike> {
  const z = vNormalize(vSub(eye, target));
  const x = vNormalize(vCross(up, z));
  const y = vCross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -vDot(x, eye);
  m[13] = -vDot(y, eye);
  m[14] = -vDot(z, eye);
  m[15] = 1;
  return m;
}

/**
 * Builds a translation matrix.
 *
 * When `out` is supplied the result is written into it, which lets the rig reuse scratch matrices
 * instead of allocating a new one per bone per frame.
 */
export function mat4Translation(t: Vec3, out: Float32Array<ArrayBufferLike> = new Float32Array(16)): Float32Array {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2];
  return out;
}

/** Builds a uniform scale matrix. */
export function mat4Scale(s: number, out: Float32Array<ArrayBufferLike> = new Float32Array(16)): Float32Array {
  out.fill(0);
  out[0] = out[5] = out[10] = s;
  out[15] = 1;
  return out;
}

/**
 * Builds a rotation matrix from an intrinsic XYZ Euler triple (radians).
 *
 * The order matters: the rig's joint channels are authored as "bend, then twist, then swing" and this
 * fixed order guarantees the composition is identical on every platform — no reliance on a matrix library's
 * internal convention.
 *
 * The composition is `R = Rz * Ry * Rx`: a point is first pitched about X, then twisted about Y, then
 * swung about Z, each in the frame the previous step left behind. That is the order the channels are
 * authored in — the ankle pitches, the pelvis twists, the thigh swings — so a bone's own channel is the
 * last thing applied and it moves the bone in the direction the animator expects.
 *
 * The matrix is stored column-major, which is what WebGL wants: element `m[c * 4 + r]` is row `r` of
 * column `c`.
 */
export function mat4FromEuler(rx: number, ry: number, rz: number, out: Float32Array<ArrayBufferLike> = new Float32Array(16)): Float32Array {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  out.fill(0);
  // Column 0: the image of the +X axis.
  out[0] = cz * cy;
  out[1] = sz * cy;
  out[2] = -sy;
  // Column 1: the image of the +Y axis.
  out[4] = cz * sy * sx - sz * cx;
  out[5] = sz * sy * sx + cz * cx;
  out[6] = cy * sx;
  // Column 2: the image of the +Z axis.
  out[8] = cz * sy * cx + sz * sx;
  out[9] = sz * sy * cx - cz * sx;
  out[10] = cy * cx;
  out[15] = 1;
  return out;
}

/** Builds a rotation matrix that maps +Y onto `dir` (used to orient limbs toward their IK target). */
export function mat4AlignY(dir: Vec3): Float32Array<ArrayBufferLike> {
  const y = vNormalize(dir);
  if (vLen(y) < 1e-6) return mat4();
  const helper: Vec3 = Math.abs(y[1]) > 0.999 ? [1, 0, 0] : [0, 1, 0];
  const x = vNormalize(vCross(helper, y));
  const z = vCross(x, y);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = x[1]; m[2] = x[2];
  m[4] = y[0]; m[5] = y[1]; m[6] = y[2];
  m[8] = z[0]; m[9] = z[1]; m[10] = z[2];
  m[15] = 1;
  return m;
}

/** Extracts the translation column (world-space position) from a matrix. */
export function mat4Position(m: Float32Array<ArrayBufferLike>): Vec3 {
  return [m[12], m[13], m[14]];
}

/** Extracts the upper-left 3x3 of `m` and writes the inverse-transpose into `out` (for normals under non-uniform scale). */
export function mat4NormalMatrix(m: Float32Array<ArrayBufferLike>, out = new Float32Array(9)): Float32Array {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[4], a11 = m[5], a12 = m[6];
  const a20 = m[8], a21 = m[9], a22 = m[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(det) < 1e-12) {
    out[0] = out[4] = out[8] = 1;
    out[1] = out[2] = out[3] = out[5] = out[6] = out[7] = 0;
    return out;
  }
  det = 1 / det;
  out[0] = b01 * det;
  out[1] = (-a22 * a01 + a02 * a21) * det;
  out[2] = (a12 * a01 - a02 * a11) * det;
  out[3] = b11 * det;
  out[4] = (a22 * a00 - a02 * a20) * det;
  out[5] = (-a12 * a00 + a02 * a10) * det;
  out[6] = (a21 * a00 - a01 * a20) * det;
  out[7] = b21 * det;
  out[8] = (-a21 * a00 + a01 * a10) * det;
  out[9] = (a11 * a00 - a01 * a10) * det;
  return out;
}

/** Transforms a point by a matrix (w = 1, then perspective divide skipped — the rig uses affine matrices). */
export function mat4TransformPoint(m: Float32Array<ArrayBufferLike>, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Transforms a direction by a matrix (w = 0). */
export function mat4TransformDir(m: Float32Array<ArrayBufferLike>, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ];
}

/* ------------------------------------------------------------------ curves */

/**
 * Catmull-Rom interpolation across four scalars.
 *
 * Used for the walk-cycle joint curves: four keyframed values per joint let the motion read as
 * "authored" rather than as a sine wave, and this keeps the curve C1-continuous through the keys.
 */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * A one-shot cubic ease, used to blend between animation states (idle -> walk -> talk) without a pop.
 */
export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
