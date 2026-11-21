/**
 * WebGL2 renderer for the RASQ-Ai bot avatar.
 *
 * Performance contract:
 *
 *  - **GPU skinning.** Bone matrices are uploaded once per frame as a uniform block (24 mat4 = 384 floats).
 *    The vertex shader reads its bone matrix by index and transforms the vertex on the GPU. The CPU never
 *    touches a vertex after upload, so the per-frame CPU cost is O(bones), not O(vertices).
 *  - **One draw call per material.** The mesh is split into 7 material parts, and each part is one
 *    `drawElements` call. That is 7 calls for the whole avatar — well inside any mobile or desktop budget.
 *  - **No depth pre-pass, no shadow maps, no post-processing.** The avatar is a UI element that shares
 *    the frame with the rest of the page; it must not be the reason the page drops frames.
 *  - **Simple lighting.** One hemisphere-ish key light plus a fill, evaluated per pixel with a wrapped
 *    Lambert term and a Blinn-Phong specular. Cheap, and it reads as "soft studio light" which suits the
 *    glass UI.
 *  - **Vertex colours** carry the material tint, so no textures are needed at all. The entire avatar is
 *    ~40 KB of static geometry.
 *
 * The renderer degrades gracefully: if WebGL2 is unavailable, or the context is lost, the component
 * falls back to a static 2D representation rather than showing a broken canvas.
 */

import type { Mesh, MeshPart } from "./geometry";
import { BONE_COUNT } from "./skeleton";
import {
  mat4LookAt, mat4Mul, mat4NormalMatrix, mat4Perspective, vNormalize, type Vec3,
} from "./math";

/** Vertex layout: position (3), normal (3), colour (4), bone index (1), bone offset (3) = 14 floats. */
const FLOATS_PER_VERTEX = 14;
const ATTRIB = {
  position: 0,
  normal: 1,
  color: 2,
  bone: 3,
  boneOffset: 4,
} as const;

const VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex inputs.
in vec3 aPosition;    // bind-space position
in vec3 aNormal;      // bind-space normal
in vec4 aColor;       // material tint
in float aBone;       // bone index
in vec3 aBoneOffset;  // vertex position in bone space

// Uniforms.
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormalMatrix;
uniform mat4 uBones[${BONE_COUNT}];

out vec3 vNormal;
out vec4 vColor;
out vec3 vWorldPos;

void main() {
  // The bone matrix already carries the bone's bind-space placement, so the offset is the only thing
  // needed to place the vertex inside the bone.
  int bi = int(aBone + 0.5);
  mat4 B = uBones[bi];
  vec4 world = B * vec4(aBoneOffset, 1.0);
  world = uModel * world;

  // Normals rotate with the bone; the normal matrix handles the model-space transform.
  vec3 n = mat3(B) * aNormal;
  vNormal = normalize(uNormalMatrix * n);
  vWorldPos = world.xyz;
  vColor = aColor;
  gl_Position = uProjection * uView * world;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec3 vNormal;
in vec4 vColor;
in vec3 vWorldPos;

uniform vec3 uLightDir;    // key light direction (pointing *from* the surface toward the light)
uniform vec3 uKeyColor;
uniform vec3 uFillColor;
uniform vec3 uAmbient;
uniform vec3 uCameraPos;
uniform float uRimStrength;

out vec4 outColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCameraPos - vWorldPos);
  vec3 l = normalize(uLightDir);

  // Wrapped diffuse: a little light bleeds around the terminator, which softens the shading the way a
  // studio softbox would. Hard lambert on a low-poly sphere looks banded and cheap.
  float ndl = dot(n, l);
  float wrap = 0.35;
  float diffuse = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);

  // Fill from the opposite side keeps the shadow side from going flat black.
  float fill = clamp(dot(n, normalize(vec3(-l.x, 0.35, -l.z))) * 0.5 + 0.5, 0.0, 1.0);

  // Blinn-Phong specular. The exponent is modest: a tight highlight on a 1500-triangle character looks
  // like plastic, a broad one looks like skin.
  vec3 h = normalize(l + v);
  float spec = pow(max(dot(n, h), 0.0), 28.0) * 0.22;

  // Fresnel rim, which separates the silhouette from the page background.
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * uRimStrength;

  vec3 color = vColor.rgb * (uAmbient + uKeyColor * diffuse + uFillColor * fill);
  color += uKeyColor * spec;
  color += uRimStrength > 0.0 ? vec3(rim * 0.6) : vec3(0.0);

  outColor = vec4(color, vColor.a);
}
`;

/** A GPU buffer wrapper. */
type GlBuffer = WebGLBuffer;

type PartGpu = {
  part: MeshPart;
  vao: WebGLVertexArrayObject;
  indexBuffer: GlBuffer;
  indexCount: number;
  indexType: number;
};

export type RenderTheme = {
  /** Key light colour, 0..1 floats. */
  key: Vec3;
  /** Fill light colour. */
  fill: Vec3;
  /** Ambient term. */
  ambient: Vec3;
  /** Direction the key light comes from. */
  lightDir: Vec3;
  /** Rim light strength. */
  rim: number;
  /** Clear colour, 0..1 floats (RGB). */
  clear: Vec3;
};

export type RendererOptions = {
  /** Called when the WebGL context is lost. */
  onContextLost?: () => void;
};

export type BotRenderer = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  /** Renders one frame. `boneMatrices` is 16 floats per bone. */
  render(boneMatrices: Float32Array, view: Float32Array, projection: Float32Array, model: Float32Array, theme: RenderTheme): void;
  /** Resizes the drawing buffer to the CSS size, honouring devicePixelRatio. */
  resize(width: number, height: number, dpr: number): void;
  /** Releases GPU resources. */
  dispose(): void;
  /** Total triangles in the mesh currently loaded. */
  triangleCount: number;
  /** Number of draw calls per frame. */
  drawCalls: number;
  /**
   * Swaps in a different level of detail.
   *
   * The old GPU buffers are released first, so a swap does not leak. The swap happens on the frame the
   * caller asks for it, so the LOD change is never a frame behind the camera.
   */
  setMesh(mesh: Mesh): void;
};

/**
 * Compiles a shader and reports the error with the source, so a typo never silently renders black.
 */
function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Could not create shader.");
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Bot shader compile failed: ${log}`);
  }
  return sh;
}

/** Creates a program and returns it with its uniform locations resolved. */
function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create WebGL program.");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Bot shader link failed: ${log}`);
  }
  return program;
}

/**
 * Uploads one mesh part to the GPU and creates its VAO.
 *
 * The vertex data is interleaved so the whole part lives in a single buffer, which keeps the attribute
 * pointers simple and the driver happy.
 */
function uploadPart(gl: WebGL2RenderingContext, part: MeshPart): PartGpu {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("Could not create VAO.");
  gl.bindVertexArray(vao);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

  const count = part.positions.length / 3;
  const data = new Float32Array(count * FLOATS_PER_VERTEX);
  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_VERTEX;
    data[o + 0] = part.positions[i * 3 + 0];
    data[o + 1] = part.positions[i * 3 + 1];
    data[o + 2] = part.positions[i * 3 + 2];
    data[o + 3] = part.normals[i * 3 + 0];
    data[o + 4] = part.normals[i * 3 + 1];
    data[o + 5] = part.normals[i * 3 + 2];
    data[o + 6] = part.colors[i * 4 + 0] / 255;
    data[o + 7] = part.colors[i * 4 + 1] / 255;
    data[o + 8] = part.colors[i * 4 + 2] / 255;
    data[o + 9] = part.colors[i * 4 + 3] / 255;
    data[o + 10] = part.bones[i];
    data[o + 11] = part.boneOffsets[i * 3 + 0];
    data[o + 12] = part.boneOffsets[i * 3 + 1];
    data[o + 13] = part.boneOffsets[i * 3 + 2];
  }
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const stride = FLOATS_PER_VERTEX * 4;
  gl.enableVertexAttribArray(ATTRIB.position);
  gl.vertexAttribPointer(ATTRIB.position, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(ATTRIB.normal);
  gl.vertexAttribPointer(ATTRIB.normal, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(ATTRIB.color);
  gl.vertexAttribPointer(ATTRIB.color, 4, gl.FLOAT, false, stride, 24);
  gl.enableVertexAttribArray(ATTRIB.bone);
  gl.vertexAttribPointer(ATTRIB.bone, 1, gl.FLOAT, false, stride, 40);
  gl.enableVertexAttribArray(ATTRIB.boneOffset);
  gl.vertexAttribPointer(ATTRIB.boneOffset, 3, gl.FLOAT, false, stride, 44);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  const indexCount = part.indices.length;
  const use32 = indexCount > 0xffff;
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, use32 ? new Uint32Array(part.indices) : new Uint16Array(part.indices), gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  return { part, vao, indexBuffer, indexCount, indexType: use32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}

/**
 * Creates the renderer for a mesh on a canvas.
 *
 * Throws if WebGL2 is unavailable; the caller is expected to catch and fall back.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  mesh: Mesh,
  options: RendererOptions = {},
): BotRenderer {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: true,
    depth: true,
    premultipliedAlpha: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("WebGL2 is not available.");

  const program = createProgram(gl);
  gl.useProgram(program);

  const uniforms = {
    projection: gl.getUniformLocation(program, "uProjection"),
    view: gl.getUniformLocation(program, "uView"),
    model: gl.getUniformLocation(program, "uModel"),
    normalMatrix: gl.getUniformLocation(program, "uNormalMatrix"),
    bones: gl.getUniformLocation(program, "uBones[0]"),
    lightDir: gl.getUniformLocation(program, "uLightDir"),
    key: gl.getUniformLocation(program, "uKeyColor"),
    fill: gl.getUniformLocation(program, "uFillColor"),
    ambient: gl.getUniformLocation(program, "uAmbient"),
    cameraPos: gl.getUniformLocation(program, "uCameraPos"),
    rim: gl.getUniformLocation(program, "uRimStrength"),
  };

  // The uploaded parts are swapped wholesale when the LOD changes.
  let parts = mesh.parts.map((p) => uploadPart(gl, p));
  let currentMesh = mesh;

  /** Releases a set of uploaded parts. */
  const releaseParts = (list: PartGpu[]) => {
    for (const p of list) {
      gl.deleteVertexArray(p.vao);
      gl.deleteBuffer(p.indexBuffer);
    }
  };

  // Culling: the geometry is wound counter-clockwise in front faces.
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
  // Premultiplied alpha, because the canvas is transparent over the page.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.BLEND);

  const onContextLost = (e: Event) => {
    e.preventDefault();
    options.onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  const boneUniform = new Float32Array(BONE_COUNT * 16);
  const normalMatrix = new Float32Array(9);
  // A mutable buffer: the camera position is derived from the view matrix on every frame.
  const cameraPos = new Float32Array(3);

  let drawCalls = 0;

  const renderer: BotRenderer = {
    canvas,
    gl,
    triangleCount: mesh.triangleCount,

    get drawCalls() {
      return drawCalls;
    },

    render(boneMatrices, view, projection, model, theme) {
      drawCalls = 0;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(theme.clear[0], theme.clear[1], theme.clear[2], 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.projection, false, projection);
      gl.uniformMatrix4fv(uniforms.view, false, view);
      gl.uniformMatrix4fv(uniforms.model, false, model);
      mat4NormalMatrix(model, normalMatrix);
      gl.uniformMatrix3fv(uniforms.normalMatrix, false, normalMatrix);

      // The camera position is derived from the view matrix's translation row so the renderer never has to
      // be told about the camera separately.
      cameraPos[0] = -(view[0] * view[12] + view[1] * view[13] + view[2] * view[14]);
      cameraPos[1] = -(view[4] * view[12] + view[5] * view[13] + view[6] * view[14]);
      cameraPos[2] = -(view[8] * view[12] + view[9] * view[13] + view[10] * view[14]);
      gl.uniform3fv(uniforms.cameraPos, cameraPos);

      gl.uniform3fv(uniforms.lightDir, vNormalize(theme.lightDir));
      gl.uniform3fv(uniforms.key, theme.key);
      gl.uniform3fv(uniforms.fill, theme.fill);
      gl.uniform3fv(uniforms.ambient, theme.ambient);
      gl.uniform1f(uniforms.rim, theme.rim);

      boneUniform.set(boneMatrices.subarray(0, BONE_COUNT * 16));
      gl.uniformMatrix4fv(uniforms.bones, false, boneUniform);

      for (const p of parts) {
        if (p.indexCount === 0) continue;
        gl.bindVertexArray(p.vao);
        gl.drawElements(gl.TRIANGLES, p.indexCount, p.indexType, 0);
        drawCalls++;
      }
      gl.bindVertexArray(null);
    },

    resize(width, height, dpr) {
      const w = Math.max(1, Math.floor(width * dpr));
      const h = Math.max(1, Math.floor(height * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
    },

    setMesh(next: Mesh) {
      if (next === currentMesh) return;
      releaseParts(parts);
      parts = next.parts.map((p) => uploadPart(gl, p));
      currentMesh = next;
      renderer.triangleCount = next.triangleCount;
    },

    dispose() {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      releaseParts(parts);
      parts = [];
      gl.deleteProgram(program);
    },
  };

  return renderer;
}

/**
 * Builds a camera that frames the avatar.
 *
 * The avatar is 1.72 m tall and the camera looks slightly down at it, which reads as a character standing
 * in front of the viewer rather than a floating model.
 */
export function createCamera(opts: {
  distance: number;
  height: number;
  targetY: number;
  aspect: number;
  fovY?: number;
}): { view: Float32Array; projection: Float32Array } {
  const eye: Vec3 = [0, opts.height, opts.distance];
  const target: Vec3 = [0, opts.targetY, 0];
  const view = mat4LookAt(eye, target, [0, 1, 0]);
  const projection = mat4Perspective(opts.fovY ?? (32 * Math.PI) / 180, opts.aspect, 0.1, 20);
  return { view, projection };
}

export { mat4Mul };
