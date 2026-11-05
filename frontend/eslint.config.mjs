import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The app state is one mutable object in src/lib/store.ts, with a version counter that
    // re-renders subscribers. These React Compiler rules assume immutable state, so they
    // are off for the store's consumers.
    files: ["src/**/*.{ts,tsx}"],
    rules: { "react-hooks/immutability": "off", "react-hooks/purity": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
