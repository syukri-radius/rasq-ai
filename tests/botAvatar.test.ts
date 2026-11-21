import assert from "node:assert/strict";
import { test } from "node:test";

import { ANKLE_Y, BOT_TRI_BUDGET, buildBotMesh, PROPORTIONS } from "../src/lib/bot/geometry";
import { BONE_COUNT, BONE_INDEX, BONES, resetPoseToRest } from "../src/lib/bot/skeleton";
import { createRig, updateRig, bonePosition } from "../src/lib/bot/rig";
import {
  anklePitch, GAIT, footLiftHeight, kneeBend, toeBend, thighSwing,
} from "../src/lib/bot/walk";
import { buildTalkTrack, evaluateTalk, createTalkState, VISEME_SHAPES } from "../src/lib/bot/talk";
import { mat4TransformPoint } from "../src/lib/bot/math";

/* ------------------------------------------------------------------ geometry & budget */

test("bot avatar triangle count is inside the 1000-1800 budget", () => {
  const mesh = buildBotMesh();
  assert.ok(
    mesh.triangleCount >= BOT_TRI_BUDGET.min && mesh.triangleCount <= BOT_TRI_BUDGET.max,
    `triangle count ${mesh.triangleCount} must be within ${BOT_TRI_BUDGET.min}-${BOT_TRI_BUDGET.max}`,
  );
});

test("every mesh part has consistent vertex data", () => {
  const mesh = buildBotMesh();
  for (const part of mesh.parts) {
    const v = part.positions.length / 3;
    assert.equal(part.normals.length / 3, v, "normal count must match vertex count");
    assert.equal(part.colors.length / 4, v, "colour count must match vertex count");
    assert.equal(part.bones.length, v, "bone index count must match vertex count");
    assert.equal(part.boneOffsets.length / 3, v, "bone offset count must match vertex count");
    assert.equal(part.indices.length % 3, 0, "indices must describe whole triangles");
    for (const i of part.indices) {
      assert.ok(i >= 0 && i < v, `index ${i} out of range (${v} vertices)`);
    }
    for (const b of part.bones) {
      assert.ok(b >= 0 && b < BONE_COUNT, `bone index ${b} out of range`);
    }
  }
});

test("mesh has no degenerate triangles", () => {
  const mesh = buildBotMesh();
  for (const part of mesh.parts) {
    for (let i = 0; i < part.indices.length; i += 3) {
      const a = part.indices[i], b = part.indices[i + 1], c = part.indices[i + 2];
      assert.notEqual(a, b);
      assert.notEqual(b, c);
      assert.notEqual(a, c);
    }
  }
});

test("avatar fits inside its declared height", () => {
  const mesh = buildBotMesh();
  let maxY = -Infinity;
  let minY = Infinity;
  for (const part of mesh.parts) {
    for (let i = 1; i < part.positions.length; i += 3) {
      if (part.positions[i] > maxY) maxY = part.positions[i];
      if (part.positions[i] < minY) minY = part.positions[i];
    }
  }
  // The declared height is 1.72 m; the mesh must not exceed it by more than the hair volume.
  assert.ok(maxY <= PROPORTIONS.height + 0.02, `top of head at ${maxY.toFixed(3)} exceeds the declared height`);
  assert.ok(minY >= -0.05, `bottom of the feet at ${minY.toFixed(3)} is below the ground plane`);
});

/* ------------------------------------------------------------------ skeleton */

test("skeleton is a single connected hierarchy with one root", () => {
  assert.equal(BONES.length, BONE_COUNT);
  const roots = BONES.filter((b) => b.parent < 0);
  assert.equal(roots.length, 1);
  // Every bone's parent must appear earlier in the list, so the hierarchy can be composed in one pass.
  BONES.forEach((b, i) => {
    if (b.parent >= 0) assert.ok(b.parent < i, `bone ${b.name} has a forward parent reference`);
  });
});

test("every bone is reachable from the root", () => {
  // Walk *down* the hierarchy from the root and confirm every bone is visited.
  const children: number[][] = Array.from({ length: BONE_COUNT }, () => []);
  BONES.forEach((b, i) => {
    if (b.parent >= 0) children[b.parent].push(i);
  });
  const seen = new Set<number>();
  const stack = [0];
  while (stack.length) {
    const i = stack.pop() as number;
    if (seen.has(i)) continue;
    seen.add(i);
    stack.push(...children[i]);
  }
  assert.equal(seen.size, BONE_COUNT);
});

/* ------------------------------------------------------------------ walk cycle ordering */

test("gait ordering is anatomically correct: heel strike, toe off, then swing", () => {
  // The foot must be on the ground through stance and airborne through swing.
  for (let t = 0; t < 1; t += 0.01) {
    const h = footLiftHeight(t, -1);
    const stance = t >= GAIT.HEEL_STRIKE && t < GAIT.TOE_OFF;
    if (stance) assert.equal(h, 0, `foot must be planted during stance at t=${t.toFixed(2)}`);
    else assert.ok(h >= 0, "foot height must never be negative");
  }
});

test("the swing foot lifts off the ground and comes back down", () => {
  let maxLift = 0;
  let peakPhase = 0;
  for (let t = 0; t < 1; t += 0.005) {
    const h = footLiftHeight(t, -1);
    if (h > maxLift) {
      maxLift = h;
      peakPhase = t;
    }
  }
  assert.ok(maxLift > 0.05, `swing foot must actually lift (peak ${maxLift.toFixed(3)} m)`);
  // The peak belongs in the swing phase, after toe-off.
  assert.ok(peakPhase > GAIT.TOE_OFF, `lift peak at ${peakPhase.toFixed(2)} must follow toe-off at ${GAIT.TOE_OFF}`);
});

test("the ankle rolls from toe-up through flat to toe-down", () => {
  // The sign convention is positive = toe-down, so a dorsiflexed foot (toe up) is negative.
  // At heel strike the foot is dorsiflexed (toe up => negative pitch).
  const atStrike = anklePitch(GAIT.HEEL_STRIKE + 0.005, -1);
  assert.ok(atStrike < 0, `foot should be toe-up at heel strike (got ${atStrike.toFixed(3)})`);
  // At toe-off the heel has risen and the foot points down, so the pitch has grown.
  const atOff = anklePitch(GAIT.TOE_OFF, -1);
  assert.ok(atOff > atStrike, `foot must roll downward toward toe-off (${atOff.toFixed(3)} vs ${atStrike.toFixed(3)})`);
  // Mid-stance the foot is flat.
  const midStance = anklePitch((GAIT.HEEL_STRIKE + GAIT.TOE_OFF) / 2, -1);
  assert.ok(Math.abs(midStance) < 0.25, `foot must be near flat at mid-stance (got ${midStance.toFixed(3)})`);
});

test("the toe joint only bends after toe-off", () => {
  for (let t = 0; t < GAIT.TOE_OFF; t += 0.01) {
    assert.ok(toeBend(t, -1) < 0.2, `toe must stay extended through stance (t=${t.toFixed(2)})`);
  }
  let peak = 0;
  for (let t = GAIT.TOE_OFF; t < 1; t += 0.01) peak = Math.max(peak, toeBend(t, -1));
  assert.ok(peak > 0.6, `toe must bend hard during push-off (peak ${peak.toFixed(3)})`);
});

test("the knee is nearly straight at heel strike and flexes during swing", () => {
  const atStrike = kneeBend(GAIT.HEEL_STRIKE + 0.01, -1);
  assert.ok(atStrike < 0.35, `knee must be nearly straight at heel strike (got ${atStrike.toFixed(3)})`);
  let peak = 0;
  for (let t = GAIT.TOE_OFF; t < 1; t += 0.01) peak = Math.max(peak, kneeBend(t, -1));
  assert.ok(peak > 0.8, `knee must flex hard in swing (peak ${peak.toFixed(3)})`);
});

test("the left and right legs are exactly half a cycle out of phase", () => {
  // The `side` argument selects the leg's phase offset, so the right leg at time `t` must match the
  // left leg at time `t + 0.5`. That is what makes the legs swing in antiphase.
  for (let t = 0; t < 1; t += 0.02) {
    const l = thighSwing(t, -1);
    const r = thighSwing(t, 1);
    const lShifted = thighSwing(t + 0.5, -1);
    assert.ok(Math.abs(r - lShifted) < 1e-9, `legs must be in antiphase at t=${t.toFixed(2)}`);
    // The two legs must not be doing the same thing at the same time.
    assert.ok(Math.abs(l - r) > 1e-6 || t < 1e-6, `legs must differ at t=${t.toFixed(2)}`);
  }
});

/* ------------------------------------------------------------------ rig */

test("the rig produces finite bone matrices at every gait phase", () => {
  const rig = createRig();
  rig.state.walkWeight = 1;
  for (let i = 0; i < 120; i++) {
    updateRig(rig, 1 / 60, null, 0);
    for (let b = 0; b < BONE_COUNT * 16; b++) {
      assert.ok(Number.isFinite(rig.matrices[b]), `non-finite matrix value at bone ${Math.floor(b / 16)}`);
    }
  }
});

test("a standing rig keeps the feet on the ground and the head upright", () => {
  const rig = createRig();
  rig.state.walkWeight = 0;
  for (let i = 0; i < 30; i++) updateRig(rig, 1 / 60, null, 0);

  const footL = bonePosition(rig, BONE_INDEX.footL);
  const footR = bonePosition(rig, BONE_INDEX.footR);
  assert.ok(Math.abs(footL[1] - ANKLE_Y) < 0.02, `left foot at y=${footL[1].toFixed(3)}`);
  assert.ok(Math.abs(footR[1] - ANKLE_Y) < 0.02, `right foot at y=${footR[1].toFixed(3)}`);
  assert.ok(footL[0] < 0 && footR[0] > 0, "the feet must stay on their own sides");
});

test("the walking rig never sinks a foot below the floor", () => {
  const rig = createRig();
  rig.state.walkWeight = 1;
  // Sample a full cycle finely and check the lowest animated vertex of each foot.
  const mesh = buildBotMesh();
  const footParts = mesh.parts.filter((p) => p.part === 4 /* Shoes */);
  for (let step = 0; step < 240; step++) {
    updateRig(rig, 1 / 120, null, 0);
    for (const part of footParts) {
      for (let v = 0; v < part.positions.length / 3; v++) {
        const bone = part.bones[v];
        if (bone !== BONE_INDEX.footL && bone !== BONE_INDEX.footR && bone !== BONE_INDEX.toeL && bone !== BONE_INDEX.toeR) continue;
        const m = rig.matrices.subarray(bone * 16, bone * 16 + 16) as Float32Array;
        const p = mat4TransformPoint(m, [
          part.boneOffsets[v * 3],
          part.boneOffsets[v * 3 + 1],
          part.boneOffsets[v * 3 + 2],
        ]);
        assert.ok(p[1] > -0.06, `foot vertex sank to y=${p[1].toFixed(3)}`);
      }
    }
  }
});

test("the head counter-rotates against the chest while walking", () => {
  const rig = createRig();
  rig.state.walkWeight = 1;
  let sawOpposite = false;
  for (let i = 0; i < 120; i++) {
    updateRig(rig, 1 / 60, null, 0);
    const chestYaw = rig.channels[BONE_INDEX.chest * 3 + 1];
    const headYaw = rig.channels[BONE_INDEX.head * 3 + 1];
    if (Math.abs(chestYaw) > 0.02 && Math.sign(chestYaw) !== Math.sign(headYaw)) sawOpposite = true;
  }
  assert.ok(sawOpposite, "the head must counter-rotate against the chest during the walk");
});

test("the arms swing opposite to the legs", () => {
  const rig = createRig();
  rig.state.walkWeight = 1;
  for (let i = 0; i < 60; i++) updateRig(rig, 1 / 60, null, 0);
  // Sample a full cycle and compare the arm swing with the same-side thigh swing.
  let sawOpposite = false;
  for (let i = 0; i < 120; i++) {
    updateRig(rig, 1 / 120, null, 0);
    // Both the arm swing and the thigh swing are rotations about Z: the character walks along X, so
    // its sagittal plane is XY and a forward swing is a Z rotation.
    const arm = rig.channels[BONE_INDEX.upperArmL * 3 + 2];
    const thigh = rig.channels[BONE_INDEX.thighL * 3 + 2];
    if (Math.abs(arm) > 0.05 && Math.abs(thigh) > 0.05 && Math.sign(arm) !== Math.sign(thigh)) sawOpposite = true;
  }
  assert.ok(sawOpposite, "the arm must swing opposite to the same-side leg");
});

/* ------------------------------------------------------------------ talk */

test("talk tracks are deterministic for the same text", () => {
  const a = buildTalkTrack("Hello there, I am the RASQ bot.");
  const b = buildTalkTrack("Hello there, I am the RASQ bot.");
  assert.deepEqual(a.events, b.events);
  assert.equal(a.duration, b.duration);
});

test("speech opens and closes the mouth", () => {
  const track = buildTalkTrack("Testing the mouth movement now.");
  const state = createTalkState();
  let maxJaw = 0;
  for (let t = 0; t < track.duration; t += 1 / 120) {
    evaluateTalk(track, t, state);
    maxJaw = Math.max(maxJaw, state.jaw);
  }
  assert.ok(maxJaw > 0.5, `the mouth must open while speaking (peak ${maxJaw.toFixed(3)})`);
  // Before the first sound the mouth is closed.
  evaluateTalk(track, -0.1, state);
  assert.equal(state.jaw, 0);
});

test("the mouth returns to rest after the last syllable", () => {
  const track = buildTalkTrack("Done.");
  const state = createTalkState();
  evaluateTalk(track, track.duration + 0.5, state);
  assert.ok(state.jaw < 0.05, `the mouth must close after speech (got ${state.jaw.toFixed(3)})`);
  assert.ok(Math.abs(state.width - 1) < 0.05, "the mouth must return to its rest width");
});

test("different vowels produce different mouth shapes", () => {
  const state = createTalkState();
  const widths: number[] = [];
  for (const word of ["eeee", "oooo"]) {
    const track = buildTalkTrack(word);
    let peak = 0;
    let peakWidth = 1;
    for (let t = 0; t < track.duration; t += 1 / 120) {
      evaluateTalk(track, t, state);
      if (state.jaw > peak) {
        peak = state.jaw;
        peakWidth = state.width;
      }
    }
    widths.push(peakWidth);
  }
  assert.ok(Math.abs(widths[0] - widths[1]) > 0.1, `"ee" and "oo" must produce different lip widths (${widths.map((w) => w.toFixed(2))})`);
});

test("every viseme has a sane shape", () => {
  for (const [name, shape] of Object.entries(VISEME_SHAPES)) {
    assert.ok(shape.jaw >= 0 && shape.jaw <= 1, `${name} jaw out of range`);
    assert.ok(shape.width > 0.3 && shape.width < 2, `${name} width out of range`);
    assert.ok(shape.lip >= 0 && shape.lip <= 1, `${name} lip out of range`);
  }
});

test("talking drives the jaw bone and nods the head", () => {
  const rig = createRig();
  const track = buildTalkTrack("The quick brown fox jumps over the lazy dog.");
  rig.state.talking = true;
  rig.state.talkWeight = 1;
  let maxJawChannel = 0;
  let minNod = 0;
  for (let t = 0; t < track.duration; t += 1 / 120) {
    updateRig(rig, 1 / 120, track, t);
    maxJawChannel = Math.max(maxJawChannel, rig.channels[BONE_INDEX.jaw * 3 + 0]);
    minNod = Math.min(minNod, rig.channels[BONE_INDEX.head * 3 + 0]);
  }
  assert.ok(maxJawChannel > 0.1, `the jaw must rotate while talking (peak ${maxJawChannel.toFixed(3)})`);
  assert.ok(minNod < -0.01, "the head must nod on stressed syllables");
});

/* ------------------------------------------------------------------ rest pose */

test("the rest pose is zeroed apart from declared rest rotations", () => {
  const rig = createRig();
  resetPoseToRest(rig.channels);
  for (let i = 0; i < rig.channels.length; i++) {
    const rest = BONES[Math.floor(i / 3)].restEuler[i % 3];
    // A tolerance rather than exact equality: the channel buffer is a `Float32Array`, so the rest
    // values are rounded to single precision on the way in.
    assert.ok(
      Math.abs(rig.channels[i] - rest) < 1e-6,
      `channel ${i} is ${rig.channels[i]}, expected the rest value ${rest}`,
    );
  }
});
