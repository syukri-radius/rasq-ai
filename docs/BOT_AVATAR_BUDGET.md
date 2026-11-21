# Bot avatar — asset and performance budget

The avatar is a **procedural, GPU-skinned humanoid** that walks and talks in the browser. It is not a
downloaded model: there is no glTF, no texture atlas, no rig file and no runtime dependency beyond the
WebGL2 API the browser already provides.

Everything below is **enforced by the test suite**, not by a review comment. If a change pushes a number
past its limit, `npm test` fails.

---

## 1. Geometry budget

The brief asks for a human avatar between **1000 and 1800 triangles**. That band is contractual and is
asserted in `tests/botAvatar.test.ts` and `tests/botAvatarLod.test.ts`.

| Tier | Triangles | Vertices | Vertex bytes | When it is used |
|------|-----------|----------|--------------|------------------|
| LOD0 | **1 550** | 1 037 | 58 048 B (56.7 KB) | The default. Camera closer than 4.5 m. |
| LOD1 | 949 | 676 | 37 856 B (37.0 KB) | 4.5 m – 8 m. |
| LOD2 | 603 | 460 | 25 760 B (25.2 KB) | 8 m – 14 m. |
| LOD3 | 453 | 355 | 19 880 B (19.4 KB) | Beyond 14 m. A thumbnail. |

The LOD tiers are **built from the same code** as LOD0 — only the radial/segment counts change — so they
can never drift apart in proportion or in silhouette. Each tier is strictly cheaper than the one above
it in both triangles and vertices, and that is asserted too.

**Vertex layout:** 14 floats per vertex, interleaved.

| Offset | Attribute | Type | Source |
|--------|-----------|------|--------|
| 0 | `aPosition` | 3 × float | Bind-space position (used for the bounds and for the rest-pose measurement, not for skinning) |
| 4 | `aNormal` | 3 × float | Bind-space normal |
| 7 | `aColor` | 4 × float | Material tint, normalised from bytes |
| 11 | `aBone` | 1 × float | Bone index |
| 12 | `aBoneOffset` | 3 × float | The vertex's position inside its bone's rest frame |

## 2. Draw-call budget

| Metric | Budget | Actual | Notes |
|--------|--------|--------|-------|
| Draw calls per frame | ≤ 8 | **7** | One per material: Skin, Hair, Shirt, Trousers, Shoes, Eye, Mouth. |
| Shader programs | 1 | **1** | One vertex + one fragment shader. |
| Textures | 0 | **0** | All colour comes from vertex attributes. There is nothing to bind. |
| Texture memory | 0 B | **0 B** | No image data at all. |
| Uniform blocks | 1 | **1** | `uniform mat4 uBones[24]` — 384 floats, uploaded once per frame. |
| Framebuffers | 0 | **0** | No offscreen passes, no post-processing, no shadow maps. |

The avatar never causes a state change between material batches beyond the vertex/element buffers, so
the cost of drawing it is dominated by the GPU's vertex throughput, not by the driver.

## 3. CPU budget per frame

| Metric | Budget | Actual | Notes |
|--------|--------|--------|-------|
| Bone matrices composed | 24 | 24 | O(bones). |
| Vertices touched on the CPU | 0 | **0** | The CPU never touches a vertex after upload. Skinning happens in the vertex shader. |
| IK solves | 2 legs × 3 passes | 6 | Closed-form two-bone solve: one `acos` and two trig calls each. |
| Triangle budget assertions | — | 1 per LOD build | At mount, not per frame. |

## 4. Particle and transparency budget

The avatar uses **no particle system**. It is fully opaque: no sprites, no additive quads, no decals, no
volumetrics.

| Metric | Budget | Actual |
|--------|--------|--------|
| Particles | 0 | 0 |
| Transparent triangles | 0 | 0 |
| Additive overdraw | 0 | 0 |
| Overdraw factor | ≤ 1.0 | **1.0** |

The canvas itself is alpha-blended against the page background — that is a single full-screen blend of
the *destination*, not of overdraw layers. There is no transparent geometry to overdraw.

**If a particle system is added later**, the following caps are mandatory, and the overdraw must be
re-audited:

| Rule | Cap |
|------|-----|
| Max simultaneous particles | 64 |
| Max transparent layers | 2 |
| Max screen coverage by transparent geometry | 25 % of the canvas |
| Particle quads must be sorted back-to-front | required |
| Additive blending limited to | emissive highlights only, ≤ 8 quads |

## 5. Animation system budget

| Metric | Budget | Actual |
|--------|--------|--------|
| Bones | ≤ 32 | **24** |
| Bone matrices per frame | 32 × 16 floats | 24 × 16 = 384 floats (1 536 B) |
| Draw calls | ≤ 8 | 7 |
| Skinning | GPU | GPU |
| IK | Closed-form, no iteration | 1 solve per pass, 3 passes per leg |

## 5a. Animation correctness budget

The avatar's cost is only worth paying if it is *correct*. These are the invariants the test suite
enforces, each of which corresponds to a bug that has actually been fixed during development:

| Invariant | Tolerance | Enforced by |
|-----------|-----------|-------------|
| The skinned mesh reproduces the bind positions | 2 mm | `botAvatarLod.test.ts` |
| Neighbouring bones overlap when skinned (no gaps at the joints) | 20 mm | `botAvatarLod.test.ts` |
| The sole rests on the floor in the rest pose | 2 mm | `botAvatarLod.test.ts` |
| The sole never sinks through the floor during the walk | 10 mm | `botAvatarLod.test.ts` |
| The planted foot tracks its world-space plan | 5 mm | `botAvatar.test.ts` |
| The measured foot depth matches the renderer's own matrices | 12 mm | `botAvatarLod.test.ts` |

The geometry, the rig and the trajectory planner all derive their numbers from the same constants, so
they cannot drift apart. Nothing about the foot's contact with the floor is hand-tuned: the shoe is
authored in the rest frame and pre-transformed into the bind frame by the builder itself.

## 6. Memory budget

| Asset | Bytes | Notes |
|-------|-------|-------|
| LOD0 vertex buffer | 56.7 KB | GPU |
| LOD0 index buffer | 9.1 KB | GPU |
| All four LOD tiers' vertex data | 138.3 KB (+20.8 KB of indices) | Only one tier is resident on the GPU at a time; the others are kept in JS memory. |
| Rig state (matrices, channels) | 1.7 KB | CPU |
| Total GPU memory | **65.8 KB** | One tier's buffers plus the uniform block. |

## 7. Failure behaviour

* **No WebGL2** → the component renders a static 2D silhouette. The page keeps working.
* **Context lost** → the renderer fires `onContextLost` and the component stops drawing.
* **Tab hidden** → the animation loop stops entirely. A background tab costs nothing.
* **Frame delta spike** → `dt` is clamped to 50 ms, so returning to a backgrounded tab does not fling
  the character across the screen.

## 8. How the budgets are enforced

| Budget | Enforced by |
|--------|-------------|
| Triangle band (LOD0) | `assertTriangleBudget` in `geometry.ts`, called from `buildBotMesh` |
| Triangle band (each LOD) | `LOD_TRI_BUDGET` check inside `buildBotMesh` |
| LOD ordering | `tests/botAvatarLod.test.ts` |
| Bone index range | `tests/botAvatarLod.test.ts` — a bad index would read past the uniform array |
| Vertex layout | `tests/botAvatarLod.test.ts` — reconstructs the packed buffer and re-derives the skinning |
| Sole contact | `tests/botAvatarLod.test.ts` — compares the measured foot depth against the renderer's own matrices |
| Draw calls | `tests/botAvatarLod.test.ts` — one part per material |
| Vertex data size | `tests/botAvatarLod.test.ts` — 64 KB ceiling |
| Avatar height | `tests/botAvatarLod.test.ts` |

Run them all with:

```bash
npm test
```
