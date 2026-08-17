#!/usr/bin/env node
/**
 * Typecheck what `typren init` actually emits.
 *
 * The scaffold templates are STRINGS — `tsc` never sees them, and the unit tests
 * can only assert on substrings. So a template can ship a type error, a wrong
 * import path or a stale API for a whole release and every check stays green.
 * This scaffolds into a throwaway dir inside the repo and compiles the result
 * against the local source via path aliases. Gated in both the root `verify`
 * script and `.husky/pre-push`, after `build` (it executes the built CLI), so
 * a template that drifts from the real API fails before the push lands.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = path.join(repo, ".tmp-scaffold-check");

// bun's isolated linker keeps next/react/@types inside each workspace
// package's own node_modules instead of hoisting them to the repo root, so
// the sandbox can't reach them by walking up. Symlinking them into a
// sandbox-local node_modules reproduces the flat layout a real consumer
// install would give the scaffolded app.
const LINKS = {
  react: "core/node_modules/react",
  "react-dom": "core/node_modules/react-dom",
  next: "core/node_modules/next",
  "@types/react": "editor/node_modules/@types/react",
  "@types/react-dom": "editor/node_modules/@types/react-dom",
};

const TSCONFIG = {
  compilerOptions: {
    target: "ES2020",
    lib: ["dom", "dom.iterable", "esnext"],
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    noEmit: true,
    baseUrl: ".",
    // The published package resolves these through its own exports map; here
    // they point at source so a template is checked against the CURRENT API.
    paths: {
      "@/*": ["./src/*"],
      "@typren/core": ["../../core/src/index.ts"],
      "@typren/core/auth/local": ["../../core/src/auth/local.ts"],
      "@typren/editor": ["../../editor/src/index.ts"],
    },
  },
  include: ["src/**/*.ts", "src/**/*.tsx"],
};

rmSync(sandbox, { recursive: true, force: true });
mkdirSync(path.join(sandbox, "src", "app"), { recursive: true });
mkdirSync(path.join(sandbox, "node_modules", "@types"), { recursive: true });
for (const [name, rel] of Object.entries(LINKS)) {
  symlinkSync(path.join(repo, "..", rel), path.join(sandbox, "node_modules", name), "dir");
}
try {
  // `init` picks src/ vs root by which app dir exists; src/ is the common layout.
  execFileSync(process.execPath, [path.join(repo, "dist", "cli.js"), "init"], { cwd: sandbox, stdio: "ignore" });
  writeFileSync(path.join(sandbox, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2));
  execFileSync(path.join(repo, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", "tsconfig.json"], {
    cwd: sandbox,
    stdio: "inherit",
  });
  console.log("check-scaffold: `typren init` output typechecks");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
