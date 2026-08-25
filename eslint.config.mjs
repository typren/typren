import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import { globalIgnores } from "eslint/config";

// Framework-agnostic flat config, shared across the whole Bun workspace:
// ESLint + typescript-eslint recommended, plus the two plugins the source's
// inline `eslint-disable` directives target (react-hooks, and Next's
// `no-img-element`). Only the referenced rules are wired; no full Next app
// ruleset.
export default tseslint.config(
  // `.claude/**` holds agent worktrees: full checkouts whose in-progress state
  // must not fail a repo-wide `eslint .` run from the primary checkout.
  globalIgnores([
    "**/dist/**",
    "**/coverage/**",
    "**/node_modules/**",
    "**/.tmp-scaffold-check/**",
    ".claude/**",
    // Generated snapshot of compiled .d.ts output (scripts/gen-api-surface.mjs),
    // not source — same reasoning as ignoring dist/ above.
    "etc/api-surface/**",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build scripts run under bare node.
    files: ["**/scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "error",
    },
  }
);
