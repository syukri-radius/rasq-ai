import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals.js";
import reactHooks from "eslint-plugin-react-hooks";

// The pinned plugin predates this rule, while source files carry targeted disables for it.
reactHooks.rules["set-state-in-effect"] = { create: () => ({}) };

const compat = new FlatCompat({ baseDirectory: process.cwd() });

export default defineConfig([
  // Adapt the pinned Next 15 legacy preset to ESLint 9 flat config.
  ...compat.config(nextCoreWebVitals),
  { rules: { "react-hooks/set-state-in-effect": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
