#!/usr/bin/env node
/**
 * Typecheck what `typren init` actually emits.
 *
 * The scaffold templates are STRINGS — `tsc` never sees them, and the unit tests
 * can only assert on substrings. So a template can ship a type error, a wrong
 * import path or a stale API for a whole release and every check stays green.
 * This scaffolds into a throwaway dir inside the repo (so Node resolution finds
 * next/react/@types from our own node_modules) and compiles the result against
 * the local source via path aliases.
 *
 * ponytail: NOT wired into `pre-push` or `verify`. The generated admin-shell
 * templates (see @typren/core's templates/init.ts) still target the
 * predecessor's dropped custom-element editor API, which @typren/editor's
 * ported React components do not provide, so this check fails loudly on
 * purpose. Gate it once the templates are rewritten against the real exports.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = path.join(repo, ".tmp-scaffold-check");

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
