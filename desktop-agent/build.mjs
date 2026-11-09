import { build } from "esbuild";

await build({
  entryPoints: {
    main: "src/main.ts",
    preload: "src/preload.ts",
    headless: "src/headless.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron", "robotjs"],
  logLevel: "info",
});
