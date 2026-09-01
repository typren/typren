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
  globalIgnores([
    "**/dist/**",
    "**/coverage/**",
    "**/node_modules/**",
    "**/.tmp-scaffold-check/**",
    // Agent worktrees checked out under the main clone: their stale copies
    // must never be linted as if they were this checkout's source.
    "**/.claude/worktrees/**",
    // A CloudFront Function, not typren source: cloudfront-js-2.0's runtime
    // convention (a top-level `handler` the platform invokes by name, never
    // imported/exported) doesn't satisfy typren's own lint rules and isn't
    // meant to — see redirects.function.test.ts for how it's actually verified.
    "packages/adapter-cloudfront/src/redirects.function.js",
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
