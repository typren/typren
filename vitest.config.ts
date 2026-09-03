import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const srcDir = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src`, import.meta.url));

export default defineConfig({
  // `@typren/core`'s exports map points at dist, because that is the shape every
  // real consumer resolves, including sibling workspace packages under raw Node
  // (the CLI's postbuild smoke test runs `node dist/cli.js`, which resolved the
  // workspace link to TypeScript source and died on extensionless imports).
  // Tests alias back to src so they need no build step first.
  // Order matters: the subpath rule must come first, since a bare-name rule
  // would otherwise swallow `@typren/core/api` too. Subpaths map by directory
  // (`/api` -> `src/api` -> `src/api/index.ts`), which is why this is a prefix
  // rewrite rather than one entry per export.
  resolve: {
    alias: [
      { find: /^@typren\/core\/(.*)$/, replacement: `${srcDir("core")}/$1` },
      { find: /^@typren\/core$/, replacement: `${srcDir("core")}/index.ts` },
    ],
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    css: false,
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov", "json-summary"],
      include: ["packages/*/src/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
        "**/dist/**",
        // Scaffold source strings, not executed code. `tsc` and vitest never run them.
        "packages/*/src/templates/**",
        // The ported editor UI has no tests yet, and apps/studio is an empty
        // stub. Excluded so the ratchet measures tested code; remove the
        // editor line when its tests land, and re-seed the thresholds then.
        "packages/editor/**",
        "apps/studio/**",
        // Thin `aws` CLI glue (parse `--output json`, done) — exercising it
        // for real needs a live AWS account. The actual logic it's glue for
        // (diff/chunk/ETag-chain, the guard/upsert flow) is fully unit-tested
        // against the same KvsClient/CloudFrontClient interface with fakes;
        // see sync.test.ts and bootstrap.test.ts.
        "packages/adapter-cloudfront/src/aws-cli-clients.ts",
        // A CloudFront Function: redirects.function.test.ts DOES exercise it
        // (loads the real source and runs its handler), but via `new
        // Function(...)`, not an import — v8 can't attribute coverage back
        // to eval'd code, so it reports 0% despite being tested. Same
        // "genuinely untestable [by this instrumentation]" case as the
        // templates/** line below.
        "packages/adapter-cloudfront/src/redirects.function.js",
      ],
      thresholds: {
        // Ratchets up as coverage improves, fails a regression below the last
        // seeded value. See package.json's "test:coverage" and the pre-push hook.
        autoUpdate: true,
        lines: 88.2,
        statements: 85.98,
        functions: 82.95,
        branches: 76.33,
      },
    },
  },
});
