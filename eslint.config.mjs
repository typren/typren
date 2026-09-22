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

// Local house-style rules, defined inline so they add no dependency.
const typrenPlugin = {
  rules: {
    // House rule: comments are complete sentences and never use an em dash
    // (U+2014). Rewrite with a comma, colon, semicolon, period, or
    // parentheses. Strings are not checked: UI copy and error messages own
    // their own punctuation.
    "no-emdash-comments": {
      meta: {
        type: "suggestion",
        docs: { description: "disallow em dashes in comments" },
        schema: [],
        messages: { emdash: "No em dashes in comments. Use a comma, colon, semicolon, period, or parentheses." },
      },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              if (comment.value.includes("—")) {
                context.report({ loc: comment.loc, messageId: "emdash" });
              }
            }
          },
        };
      },
    },
  },
};

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
    // not source, same reasoning as ignoring dist/ above.
    "etc/api-surface/**",
    // A CloudFront Function, not typren source: cloudfront-js-2.0's runtime
    // convention (a top-level `handler` the platform invokes by name, never
    // imported/exported) doesn't satisfy typren's own lint rules and isn't
    // meant to, see redirects.function.test.ts for how it's actually verified.
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
      // Lock in the existing convention: type-only names are imported with a
      // `type` marker, inline (`import { foo, type Bar }`) when mixed with
      // value imports and as `import type { ... }` when the import is
      // all-type. The whole tree already conforms.
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    plugins: { typren: typrenPlugin },
    rules: { "typren/no-emdash-comments": "error" },
  }
);
