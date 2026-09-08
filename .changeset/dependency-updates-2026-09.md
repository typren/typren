---
"@typren/core": patch
"typren": patch
"@typren/adapter-cloudfront": patch
---

Update all dependencies to latest, consolidating the open Dependabot PRs (#57–#61): js-yaml 5 (named exports, bundled types), jsdom 30, vitest 5, TypeScript 6 (typescript-eslint does not support TS 7.0 yet), @types/node 26, eslint 10.10 / @eslint/js 10, plus minor and patch bumps across the workspace. Package tsconfigs now declare `"types": ["node"]` explicitly, as TS 6+ no longer auto-includes hoisted @types packages.
