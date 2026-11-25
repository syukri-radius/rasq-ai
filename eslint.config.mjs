import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  // Next 16 flat config: no FlatCompat, no legacy eslintrc preset.
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Data-fetch effects (setState after await in useEffect) and Date.now() inside
      // user-triggered recorder handlers are intentional patterns in this codebase;
      // the react-hooks v6 rules flag them as errors, so they stay off here.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  // desktop-agent is a separate package with its own toolchain and tests;
  // it is not part of the Next.js app build or its lint surface.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "desktop-agent/**", "data/**"]),
]);
