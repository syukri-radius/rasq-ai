import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { DesktopCompilation } from "./desktopCompiler";
import { renderRobotScript } from "./desktopScript";
import {
  canonicalJson,
  DESKTOP_CONTRACT,
  DESKTOP_LIMITS,
  DesktopBundleManifestSchema,
  DesktopManifestSchema,
  type DesktopManifest,
} from "./desktopContract";

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const epoch = new Date("1980-01-01T00:00:00.000Z");

export type VerifiedDesktopBundle = {
  manifest: DesktopManifest;
  files: Record<string, Buffer>;
  bytes: Buffer;
  sha256: string;
};

export function createDesktopBundle(compilation: DesktopCompilation): VerifiedDesktopBundle {
  const errors = compilation.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) throw new Error(`Desktop compilation has ${errors.length} blocking diagnostic(s).`);
  const manifest = DesktopManifestSchema.parse(compilation.manifest);
  const source = renderRobotScript(manifest);
  const readme = `# RASQ-Ai Desktop Bundle\n\nContract: ${DESKTOP_CONTRACT}\nBundle: ${manifest.bundleId}\nWorkflow: ${manifest.workflowId} (version ${manifest.workflowVersion})\nCompiler: ${manifest.compilerVersion}\n\n## Safety\n\nThe default script mode is dry-run and dispatches no mouse/keyboard input. Review the manifest, target, anchors and script first. Run attended mode only on an isolated, unlocked, supervised desktop with synthetic data.\n\nThe portable script does not verify or focus the OS window. Manually open/focus the intended target and use --target-title to record your confirmation. The RASQ-Ai Desktop Agent uses its fixed trusted manifest runner and platform adapter instead of executing this source remotely.\n\n## Usage\n\nInstall the pinned RobotJS runtime beside this bundle, then run:\n\n    node robotjs.cjs --display "${manifest.target.displayId}" --target-title "${manifest.target.windowTitle}"\n    node robotjs.cjs --attended --yes --display "${manifest.target.displayId}" --target-title "${manifest.target.windowTitle}"\n\nEvidence is written beside the script in rasq-desktop-evidence. Secret references resolve from local environment variables and are never embedded in this bundle.\n\n## Limitations\n\n${manifest.limitations.map((x) => `- ${x}`).join("\n")}\n`;
  const files: Record<string, Buffer> = {
    "rasq-desktop.json": Buffer.from(JSON.stringify(manifest, null, 2)),
    "robotjs.cjs": Buffer.from(source),
    "package.json": Buffer.from(JSON.stringify({ name: "rasq-desktop-bundle", private: true, version: "1.0.0", scripts: { "dry-run": "node robotjs.cjs", attended: "node robotjs.cjs --attended --yes" }, dependencies: { robotjs: "0.9.1" } }, null, 2)),
    "README.md": Buffer.from(readme),
    ...compilation.anchors,
  };
  const fileManifest = {
    rasqDesktopVersion: DESKTOP_CONTRACT,
    bundleId: manifest.bundleId,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, { bytes: data.length, sha256: sha256(data) }])),
  };
  files["bundle-manifest.json"] = Buffer.from(canonicalJson(fileManifest));
  const zipInput = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, [new Uint8Array(data), { mtime: epoch }] as [Uint8Array, { mtime: Date }]]));
  const zipped = zipSync(zipInput, { level: 6 });
  const bytes = Buffer.from(zipped);
  if (bytes.length > DESKTOP_LIMITS.bundleBytes) throw new Error("Desktop bundle exceeds the 24 MiB limit.");
  return { manifest, files, bytes, sha256: sha256(bytes) };
}

export function verifyDesktopBundle(input: Uint8Array): VerifiedDesktopBundle {
  if (input.byteLength > DESKTOP_LIMITS.bundleBytes) throw new Error("Desktop bundle exceeds the 24 MiB limit.");
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(input);
  } catch {
    throw new Error("Desktop bundle is not a valid ZIP archive.");
  }
  const entries = Object.entries(unpacked);
  if (entries.length > DESKTOP_LIMITS.bundleFiles) throw new Error("Desktop bundle contains too many files.");
  let total = 0;
  const files: Record<string, Buffer> = {};
  for (const [name, data] of entries) {
    if (name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") || name.endsWith("/")) throw new Error(`Unsafe desktop bundle path "${name}".`);
    if (!["rasq-desktop.json", "robotjs.cjs", "bundle-manifest.json", "README.md", "package.json"].includes(name) && !/^anchors\/[a-f0-9]{24}\.png$/.test(name)) throw new Error(`Unexpected desktop bundle file "${name}".`);
    total += data.byteLength;
    if (data.byteLength > DESKTOP_LIMITS.fileBytes || total > DESKTOP_LIMITS.bundleBytes) throw new Error("Desktop bundle file/size limit exceeded.");
    files[name] = Buffer.from(data);
  }
  for (const required of ["rasq-desktop.json", "robotjs.cjs", "bundle-manifest.json", "README.md", "package.json"]) if (!files[required]) throw new Error(`Desktop bundle is missing ${required}.`);
  let fileManifest: ReturnType<typeof DesktopBundleManifestSchema.parse>;
  let manifest: DesktopManifest;
  try {
    fileManifest = DesktopBundleManifestSchema.parse(JSON.parse(strFromU8(new Uint8Array(files["bundle-manifest.json"]))));
    manifest = DesktopManifestSchema.parse(JSON.parse(strFromU8(new Uint8Array(files["rasq-desktop.json"]))));
  } catch (e) {
    throw new Error(`Desktop bundle contract validation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (fileManifest.bundleId !== manifest.bundleId) throw new Error("Desktop bundle IDs do not match.");
  for (const [name, expected] of Object.entries(fileManifest.files)) {
    const data = files[name];
    if (!data || data.length !== expected.bytes || sha256(data) !== expected.sha256) throw new Error(`Desktop bundle integrity check failed for "${name}".`);
  }
  for (const name of Object.keys(files)) if (name !== "bundle-manifest.json" && !fileManifest.files[name]) throw new Error(`Desktop bundle file "${name}" is not covered by the integrity manifest.`);
  for (const step of manifest.steps) {
    if (step.kind === "action" && step.anchor && !files[step.anchor.asset]) throw new Error(`Desktop bundle is missing anchor asset "${step.anchor.asset}".`);
  }
  return { manifest, files, bytes: Buffer.from(input), sha256: sha256(input) };
}
